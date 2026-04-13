import { EntityManager } from 'typeorm';
import { AppDataSource } from '../../config/database';
import { getRedisClient, RedisKeys } from '../../config/redis';
import { TenantContext } from '../../shared/BaseRepository';
import { AppError } from '../../shared/AppError';
import { ResponseCode } from '../../shared/ApiResponse';
import Decimal from 'decimal.js';
import { generateNo } from '../../shared/generateNo';
import { UnitConverter, normalizeUnit } from '../../shared/unitConverter';
import { PermissionSnapshot } from '../access-control/access-control.types';
import {
  assertWarehouseInScope,
  resolveWarehouseDataScope,
  type WarehouseDataScope,
} from '../access-control/warehouse-data-scope';
import { MrpService } from '../mrp/mrp.service';
import { recalculatePurchaseOrderStatus } from '../purchase/purchase-order-status.util';
import { syncInventoryDailySnapshotForSku } from '../inventory/daily-snapshot.util';
import { resolveWarehouseLocationBinding } from '../inventory/warehouse-location.resolver';

// ─── 参数类型定义 ─────────────────────────────────────────────────

export interface ListInspectionFilter {
  page: number;
  pageSize: number;
  status?: string;
  poId?: number;
  dateFrom?: string;
  dateTo?: string;
  result?: string;
}

export interface CreateInspectionParams {
  poId: number;
  deliveryNoteId: number;
  inspectionDate: string;
  notes?: string;
}

export interface UpdateInspectionItemInput {
  id?: number;
  sourceItemIds?: number[];
  qtyDelivered?: string;
  qtysampled: string;
  qtyPassed: string;
  qtyFailed: string;
  acceptedStockQty?: string;
  dyeLotNo?: string;
  result: 'pass' | 'fail' | 'conditional_pass';
  defectTypes?: unknown[];
  defectImages?: string[];
  disposition: 'accept' | 'return' | 'rework' | 'scrap';
  notes?: string;
}

export interface SubmitInspectionParams {
  overallResult: 'pass' | 'fail' | 'conditional_pass';
  warehouseId?: number;
  locationId?: number;
  notes?: string;
}

interface InspectionSeedItem {
  sku_id: number;
  po_item_id: number | null;
  has_dye_lot?: number;
  dye_lot_no?: string | null;
  qty_delivered: string;
  purchase_unit: string;
  unit_price: string;
}

interface InspectionItemRow {
  id: number;
  sku_id: number;
  po_item_id: number | null;
  qty_delivered: string;
}

type InventorySnapshotTrackedManager = EntityManager & {
  __inventorySnapshotSkuIds?: Set<number>;
};

function formatInspectionQty(value: Decimal.Value): string {
  return new Decimal(value || 0).toFixed(4);
}

function allocateQtyAcrossCapacities(
  total: Decimal,
  capacities: Decimal[],
): Decimal[] {
  const allocations = capacities.map(() => new Decimal(0));
  let remaining = new Decimal(total);

  for (let index = 0; index < capacities.length; index += 1) {
    if (remaining.lte(0)) break;
    const allocation = Decimal.min(capacities[index], remaining);
    allocations[index] = allocation;
    remaining = remaining.minus(allocation);
  }

  if (!remaining.eq(0)) {
    throw AppError.badRequest('质检分缸数量超过原始到货数量');
  }

  return allocations;
}

function allocatePassedFailedAcrossCapacities(
  qtyPassed: Decimal,
  qtyFailed: Decimal,
  capacities: Decimal[],
): Array<{ qtyPassed: Decimal; qtyFailed: Decimal }> {
  const remainingCapacities = capacities.map((capacity) => new Decimal(capacity));
  const passedAllocations = capacities.map(() => new Decimal(0));
  const failedAllocations = capacities.map(() => new Decimal(0));
  let remainingPassed = new Decimal(qtyPassed);
  let remainingFailed = new Decimal(qtyFailed);

  for (let index = 0; index < remainingCapacities.length; index += 1) {
    if (remainingPassed.lte(0)) break;
    const allocation = Decimal.min(remainingCapacities[index], remainingPassed);
    passedAllocations[index] = allocation;
    remainingCapacities[index] = remainingCapacities[index].minus(allocation);
    remainingPassed = remainingPassed.minus(allocation);
  }

  for (let index = 0; index < remainingCapacities.length; index += 1) {
    if (remainingFailed.lte(0)) break;
    const allocation = Decimal.min(remainingCapacities[index], remainingFailed);
    failedAllocations[index] = allocation;
    remainingCapacities[index] = remainingCapacities[index].minus(allocation);
    remainingFailed = remainingFailed.minus(allocation);
  }

  if (!remainingPassed.eq(0) || !remainingFailed.eq(0)) {
    throw AppError.badRequest('质检分缸中的合格/不合格数量超过该缸到货数量');
  }

  return capacities.map((_, index) => ({
    qtyPassed: passedAllocations[index],
    qtyFailed: failedAllocations[index],
  }));
}

// ─── Service ─────────────────────────────────────────────────────

export class IncomingInspectionService {
  private readonly tenantId: number;
  private readonly userId: number;
  private readonly permissionSnapshot?: PermissionSnapshot;
  private warehouseDataScopePromise: Promise<WarehouseDataScope> | null = null;
  private static inventoryUpdatedByColumnSupported: boolean | null = null;
  private static purchaseReceiptDeliveryColumn: 'delivery_note_id' | 'dn_id' | null = null;
  private static purchaseReceiptItemsTableSupported: boolean | null = null;
  private static purchaseReceiptTotalAmountColumnSupported: boolean | null = null;
  private static inventoryTransactionQtyChangeColumnSupported: boolean | null = null;
  private static returnOrderItemUpdatedBySupported: boolean | null = null;
  private static deliveryReceivedStatusSupported: boolean | null = null;
  private static deliveryNoteItemPoItemSupported: boolean | null = null;
  private static deliveryNoteItemDyeLotSupported: boolean | null = null;
  private static incomingInspectionItemDyeLotSupported: boolean | null = null;
  private static purchaseReceiptItemDyeLotSupported: boolean | null = null;
  private static purchaseReceiptItemControlColumnsSupported: boolean | null = null;
  private static incomingInspectionItemAcceptedStockQtySupported: boolean | null = null;
  private static purchaseOrderItemControlColumnsSupported: boolean | null = null;

  constructor(ctx: TenantContext & { permissionSnapshot?: PermissionSnapshot }) {
    this.tenantId = ctx.tenantId;
    this.userId = ctx.userId;
    this.permissionSnapshot = ctx.permissionSnapshot;
  }

  private async getWarehouseDataScope(): Promise<WarehouseDataScope> {
    this.warehouseDataScopePromise ??= resolveWarehouseDataScope(this.tenantId, this.permissionSnapshot);
    return this.warehouseDataScopePromise;
  }

  private _mrpService(): MrpService {
    return new MrpService({ tenantId: this.tenantId, userId: this.userId });
  }

  private trackInventorySnapshotCacheInvalidation(manager: EntityManager, skuId: number): void {
    const trackedManager = manager as InventorySnapshotTrackedManager;
    const tracked = (trackedManager.__inventorySnapshotSkuIds ??= new Set<number>());
    tracked.add(Number(skuId));
  }

  private consumeTrackedInventorySnapshotSkuIds(
    manager: InventorySnapshotTrackedManager | null,
  ): number[] {
    const skuIds = Array.from(manager?.__inventorySnapshotSkuIds ?? []);
    if (manager) {
      delete manager.__inventorySnapshotSkuIds;
    }
    return skuIds;
  }

  private async invalidateInventorySnapshotCaches(skuIds: number[]): Promise<void> {
    if (skuIds.length === 0) return;
    try {
      const redis = getRedisClient();
      await Promise.all(
        Array.from(new Set(skuIds)).map((skuId) =>
          redis.del(RedisKeys.inventorySnapshot(this.tenantId, skuId)),
        ),
      );
    } catch (err) {
      console.warn('[IncomingInspectionService] 库存缓存失效失败，已忽略:', (err as Error).message);
    }
  }

  private async syncDailySnapshot(
    manager: Pick<EntityManager, 'query'>,
    skuId: number,
  ): Promise<void> {
    await syncInventoryDailySnapshotForSku(manager, this.tenantId, skuId);
  }

  private async buildInspectionSeedItems(
    runner: Pick<EntityManager, 'query'> | typeof AppDataSource,
    poId: number,
    deliveryNoteId: number,
  ): Promise<InspectionSeedItem[]> {
    const deliveryNoteItemPoItemSupported = await this.supportsDeliveryNoteItemPoItemColumn();
    const deliveryNoteItemDyeLotSupported = await this.supportsDeliveryNoteItemDyeLotColumn();
    const inspectionItemDyeLotSupported = await this.supportsIncomingInspectionItemDyeLotColumn();
    const deliveryRows = await runner.query<Array<{
      po_item_id?: number | null;
      sku_id: number;
      has_dye_lot?: number;
      dye_lot_no?: string | null;
      purchase_unit: string | null;
      unit_price: string | null;
      qty_delivered: string;
    }>>(
      deliveryNoteItemPoItemSupported
        ? `SELECT
             dni.po_item_id,
             dni.sku_id,
             MAX(s.has_dye_lot) AS has_dye_lot,
             ${deliveryNoteItemDyeLotSupported ? 'NULLIF(TRIM(dni.dye_lot_no), \'\') AS dye_lot_no,' : 'NULL AS dye_lot_no,'}
             MAX(dni.purchase_unit) AS purchase_unit,
             MAX(dni.unit_price) AS unit_price,
             SUM(CAST(dni.qty_delivered AS DECIMAL(16,4))) AS qty_delivered
           FROM delivery_note_items dni
           INNER JOIN skus s ON s.id = dni.sku_id AND s.tenant_id = dni.tenant_id
           WHERE dni.delivery_note_id = ? AND dni.tenant_id = ?
           GROUP BY dni.po_item_id, dni.sku_id, ${deliveryNoteItemDyeLotSupported ? 'NULLIF(TRIM(dni.dye_lot_no), \'\')' : 'NULL'}
           ORDER BY MIN(dni.id) ASC`
        : `SELECT
             dni.sku_id,
             MAX(s.has_dye_lot) AS has_dye_lot,
             ${deliveryNoteItemDyeLotSupported ? 'NULLIF(TRIM(dni.dye_lot_no), \'\') AS dye_lot_no,' : 'NULL AS dye_lot_no,'}
             MAX(dni.purchase_unit) AS purchase_unit,
             MAX(dni.unit_price) AS unit_price,
             SUM(CAST(dni.qty_delivered AS DECIMAL(16,4))) AS qty_delivered
           FROM delivery_note_items dni
           INNER JOIN skus s ON s.id = dni.sku_id AND s.tenant_id = dni.tenant_id
           WHERE dni.delivery_note_id = ? AND dni.tenant_id = ?
           GROUP BY dni.sku_id, ${deliveryNoteItemDyeLotSupported ? 'NULLIF(TRIM(dni.dye_lot_no), \'\')' : 'NULL'}
           ORDER BY MIN(dni.id) ASC`,
      [deliveryNoteId, this.tenantId],
    );

    const poRows = await runner.query<Array<{
      id: number;
      sku_id: number;
      purchase_unit: string | null;
      unit_price: string | null;
      qty_open: string;
    }>>(
      `SELECT
         poi.id,
         poi.sku_id,
         poi.purchase_unit,
         poi.unit_price,
         GREATEST(
           CAST(COALESCE(poi.qty_ordered, 0) AS DECIMAL(16,4))
           - CAST(COALESCE(poi.qty_received, 0) AS DECIMAL(16,4)),
           0
         ) AS qty_open
       FROM purchase_order_items poi
       WHERE poi.po_id = ? AND poi.tenant_id = ?
       ORDER BY poi.sku_id ASC, qty_open ASC, poi.id ASC`,
      [poId, this.tenantId],
    );

    const occupiedRows = await runner.query<Array<{
      po_item_id?: number | null;
      sku_id: number;
      qty_delivered: string;
    }>>(
      deliveryNoteItemPoItemSupported
        ? `SELECT
             dni.po_item_id,
             dni.sku_id,
             SUM(CAST(dni.qty_delivered AS DECIMAL(16,4))) AS qty_delivered
           FROM delivery_notes dn
           INNER JOIN delivery_note_items dni
             ON dni.delivery_note_id = dn.id AND dni.tenant_id = dn.tenant_id
           WHERE dn.po_id = ? AND dn.tenant_id = ? AND dn.id <> ? AND dn.status <> 'rejected'
           GROUP BY dni.po_item_id, dni.sku_id`
        : `SELECT
             dni.sku_id,
             SUM(CAST(dni.qty_delivered AS DECIMAL(16,4))) AS qty_delivered
           FROM delivery_notes dn
           INNER JOIN delivery_note_items dni
             ON dni.delivery_note_id = dn.id AND dni.tenant_id = dn.tenant_id
           WHERE dn.po_id = ? AND dn.tenant_id = ? AND dn.id <> ? AND dn.status <> 'rejected'
           GROUP BY dni.sku_id`,
      [poId, this.tenantId, deliveryNoteId],
    );

    const poMap = new Map<number, Array<{
      id: number;
      purchase_unit: string | null;
      unit_price: string | null;
      qtyOpen: Decimal;
    }>>();
    const occupiedByPoItemId = new Map<number, Decimal>();

    for (const row of poRows) {
      const list = poMap.get(Number(row.sku_id)) ?? [];
      list.push({
        id: Number(row.id),
        purchase_unit: row.purchase_unit,
        unit_price: row.unit_price,
        qtyOpen: new Decimal(String(row.qty_open ?? '0')),
      });
      poMap.set(Number(row.sku_id), list);
    }

    for (const occupiedRow of occupiedRows) {
      const occupiedQty = new Decimal(String(occupiedRow.qty_delivered ?? '0'));
      if (occupiedQty.lte(0)) continue;

      const occupiedPoItemId = occupiedRow.po_item_id == null ? null : Number(occupiedRow.po_item_id);
      if (occupiedPoItemId) {
        const candidates = poMap.get(Number(occupiedRow.sku_id)) ?? [];
        const linkedCandidate = candidates.find((candidate) => candidate.id === occupiedPoItemId);
        occupiedByPoItemId.set(
          occupiedPoItemId,
          (occupiedByPoItemId.get(occupiedPoItemId) ?? new Decimal(0)).plus(occupiedQty),
        );
        if (linkedCandidate) {
          linkedCandidate.qtyOpen = Decimal.max(linkedCandidate.qtyOpen.minus(occupiedQty), 0);
        }
        continue;
      }

      let remainingOccupiedQty = occupiedQty;
      const candidates = poMap.get(Number(occupiedRow.sku_id)) ?? [];
      for (const candidate of candidates) {
        if (remainingOccupiedQty.lte(0)) break;
        if (candidate.qtyOpen.lte(0)) continue;

        const consumedQty = Decimal.min(candidate.qtyOpen, remainingOccupiedQty);
        candidate.qtyOpen = candidate.qtyOpen.minus(consumedQty);
        remainingOccupiedQty = remainingOccupiedQty.minus(consumedQty);
      }
    }

    const poItemById = new Map<number, {
      id: number;
      purchase_unit: string | null;
      unit_price: string | null;
      qtyOpen: Decimal;
    }>();
    for (const candidates of poMap.values()) {
      for (const candidate of candidates) {
        poItemById.set(candidate.id, candidate);
      }
    }

    const seedItems: InspectionSeedItem[] = [];

    for (const deliveryRow of deliveryRows) {
      const skuId = Number(deliveryRow.sku_id);
      const poItemId = deliveryRow.po_item_id == null ? null : Number(deliveryRow.po_item_id);
      if (poItemId) {
        const linkedPoItem = poItemById.get(poItemId);
        const deliveryQty = new Decimal(String(deliveryRow.qty_delivered ?? '0'));
        const occupiedLinkedQty = occupiedByPoItemId.get(poItemId) ?? new Decimal(0);
        const allocatableQty = linkedPoItem
          ? (linkedPoItem.qtyOpen.lte(0) && occupiedLinkedQty.eq(0)
              ? deliveryQty
              : Decimal.min(linkedPoItem.qtyOpen, deliveryQty))
          : deliveryQty;

        if (allocatableQty.gt(0)) {
          seedItems.push({
            sku_id: skuId,
            po_item_id: poItemId,
            has_dye_lot: Number(deliveryRow.has_dye_lot ?? 0),
            dye_lot_no: deliveryRow.dye_lot_no ?? null,
            qty_delivered: allocatableQty.toFixed(4),
            purchase_unit: linkedPoItem?.purchase_unit ?? deliveryRow.purchase_unit ?? 'pcs',
            unit_price: String(linkedPoItem?.unit_price ?? deliveryRow.unit_price ?? '0'),
          });
        }

        seedItems.push({
          sku_id: skuId,
          po_item_id: null,
          has_dye_lot: Number(deliveryRow.has_dye_lot ?? 0),
          dye_lot_no: deliveryRow.dye_lot_no ?? null,
          qty_delivered: Decimal.max(deliveryQty.minus(allocatableQty), 0).toFixed(4),
          purchase_unit: deliveryRow.purchase_unit ?? linkedPoItem?.purchase_unit ?? 'pcs',
          unit_price: String(deliveryRow.unit_price ?? linkedPoItem?.unit_price ?? '0'),
        });
        if (linkedPoItem && allocatableQty.gt(0)) {
          linkedPoItem.qtyOpen = Decimal.max(linkedPoItem.qtyOpen.minus(allocatableQty), 0);
        }
        continue;
      }

      let remainingQty = new Decimal(String(deliveryRow.qty_delivered ?? '0'));
      const candidates = poMap.get(skuId) ?? [];

      for (const candidate of candidates) {
        if (remainingQty.lte(0)) break;
        if (candidate.qtyOpen.lte(0)) continue;

        const allocatedQty = Decimal.min(candidate.qtyOpen, remainingQty);
        if (allocatedQty.lte(0)) continue;

        seedItems.push({
          sku_id: skuId,
          po_item_id: candidate.id,
          has_dye_lot: Number(deliveryRow.has_dye_lot ?? 0),
          dye_lot_no: deliveryRow.dye_lot_no ?? null,
          qty_delivered: allocatedQty.toFixed(4),
          purchase_unit: candidate.purchase_unit ?? deliveryRow.purchase_unit ?? 'pcs',
          unit_price: String(candidate.unit_price ?? deliveryRow.unit_price ?? '0'),
        });

        candidate.qtyOpen = candidate.qtyOpen.minus(allocatedQty);
        remainingQty = remainingQty.minus(allocatedQty);
      }

      if (remainingQty.gt(0)) {
        seedItems.push({
          sku_id: skuId,
          po_item_id: null,
          has_dye_lot: Number(deliveryRow.has_dye_lot ?? 0),
          dye_lot_no: deliveryRow.dye_lot_no ?? null,
          qty_delivered: remainingQty.toFixed(4),
          purchase_unit: deliveryRow.purchase_unit ?? 'pcs',
          unit_price: String(deliveryRow.unit_price ?? '0'),
        });
      }
    }

    return seedItems
      .filter((item) => new Decimal(String(item.qty_delivered ?? '0')).gt(0))
      .map((item) => ({
        ...item,
        dye_lot_no: inspectionItemDyeLotSupported ? (item.dye_lot_no ?? null) : null,
      }));
  }

  private async supportsDeliveryNoteItemPoItemColumn(): Promise<boolean> {
    if (IncomingInspectionService.deliveryNoteItemPoItemSupported != null) {
      return IncomingInspectionService.deliveryNoteItemPoItemSupported;
    }

    const rows = await AppDataSource.query<Array<{ cnt: number | string }>>(
      `SELECT COUNT(*) AS cnt
         FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'delivery_note_items'
          AND COLUMN_NAME = 'po_item_id'`,
    );
    const supported = Number(rows?.[0]?.cnt ?? 0) > 0;
    IncomingInspectionService.deliveryNoteItemPoItemSupported = supported;
    return supported;
  }

  private async supportsDeliveryNoteItemDyeLotColumn(): Promise<boolean> {
    if (IncomingInspectionService.deliveryNoteItemDyeLotSupported != null) {
      return IncomingInspectionService.deliveryNoteItemDyeLotSupported;
    }

    const rows = await AppDataSource.query<Array<{ cnt: number | string }>>(
      `SELECT COUNT(*) AS cnt
         FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'delivery_note_items'
          AND COLUMN_NAME = 'dye_lot_no'`,
    );
    const supported = Number(rows?.[0]?.cnt ?? 0) > 0;
    IncomingInspectionService.deliveryNoteItemDyeLotSupported = supported;
    return supported;
  }

  private async supportsIncomingInspectionItemDyeLotColumn(): Promise<boolean> {
    if (IncomingInspectionService.incomingInspectionItemDyeLotSupported != null) {
      return IncomingInspectionService.incomingInspectionItemDyeLotSupported;
    }

    const rows = await AppDataSource.query<Array<{ cnt: number | string }>>(
      `SELECT COUNT(*) AS cnt
         FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'incoming_inspection_items'
          AND COLUMN_NAME = 'dye_lot_no'`,
    );
    const supported = Number(rows?.[0]?.cnt ?? 0) > 0;
    IncomingInspectionService.incomingInspectionItemDyeLotSupported = supported;
    return supported;
  }

  private async supportsPurchaseReceiptItemDyeLotColumn(manager?: EntityManager): Promise<boolean> {
    if (IncomingInspectionService.purchaseReceiptItemDyeLotSupported != null) {
      return IncomingInspectionService.purchaseReceiptItemDyeLotSupported;
    }

    const runner = manager ?? AppDataSource;
    const rows = await runner.query<Array<{ cnt: number | string }>>(
      `SELECT COUNT(*) AS cnt
         FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'purchase_receipt_items'
          AND COLUMN_NAME = 'dye_lot_no'`,
    );
    const supported = Number(rows?.[0]?.cnt ?? 0) > 0;
    IncomingInspectionService.purchaseReceiptItemDyeLotSupported = supported;
    return supported;
  }

  private async supportsIncomingInspectionAcceptedStockQtyColumn(manager?: EntityManager): Promise<boolean> {
    if (IncomingInspectionService.incomingInspectionItemAcceptedStockQtySupported != null) {
      return IncomingInspectionService.incomingInspectionItemAcceptedStockQtySupported;
    }

    const runner = manager ?? AppDataSource;
    const rows = await runner.query<Array<{ cnt: number | string }>>(
      `SELECT COUNT(*) AS cnt
         FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'incoming_inspection_items'
          AND COLUMN_NAME = 'accepted_stock_qty'`,
    );
    const supported = Number(rows?.[0]?.cnt ?? 0) > 0;
    IncomingInspectionService.incomingInspectionItemAcceptedStockQtySupported = supported;
    return supported;
  }

  private requiresMeasuredStockQty(purchaseUnit: string | null | undefined, stockUnit: string | null | undefined): boolean {
    return normalizeUnit(String(purchaseUnit ?? '')) === '卷' && normalizeUnit(String(stockUnit ?? '')) === '米';
  }

  private distributeDecimalAcrossWeights(total: Decimal, weights: Decimal[]): Decimal[] {
    if (!weights.length) return [];

    const totalWeight = weights.reduce((sum, weight) => sum.plus(weight), new Decimal(0));
    if (totalWeight.lte(0)) {
      throw AppError.badRequest('无法分配实际入库数量');
    }

    let remaining = new Decimal(total);
    return weights.map((weight, index) => {
      if (index === weights.length - 1) {
        const allocation = remaining;
        remaining = new Decimal(0);
        return allocation;
      }

      const allocation = new Decimal(total)
        .mul(weight)
        .div(totalWeight)
        .toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
      remaining = remaining.minus(allocation);
      return allocation;
    });
  }

  private async normalizeDraftInspectionItems(
    manager: EntityManager,
    inspectionId: number,
    record: { po_id: number; delivery_note_id: number | null },
    rawItems: Array<Record<string, unknown>>,
  ): Promise<void> {
    if (!record.delivery_note_id) return;

    const untouched = rawItems.every((item) =>
      new Decimal(String(item.qty_sampled ?? item.qtySampled ?? '0')).eq(0)
      && new Decimal(String(item.qty_passed ?? item.qtyPassed ?? '0')).eq(0)
      && new Decimal(String(item.qty_failed ?? item.qtyFailed ?? '0')).eq(0)
      && !item.result
      && (!item.notes || String(item.notes).trim() === ''),
    );
    if (!untouched) return;

    const seedItems = await this.buildInspectionSeedItems(manager, Number(record.po_id), Number(record.delivery_note_id));

    const currentSignature = rawItems.map((item) => [
      String(item.sku_id ?? item.skuId ?? ''),
      String(item.po_item_id ?? item.poItemId ?? ''),
      String(item.dye_lot_no ?? item.dyeLotNo ?? ''),
      String(item.qty_delivered ?? item.qtyDelivered ?? ''),
      String(item.accepted_stock_qty ?? item.acceptedStockQty ?? ''),
    ].join('::')).sort().join('|');

    const nextSignature = seedItems.map((item) => [
      String(item.sku_id),
      String(item.po_item_id ?? ''),
      String(item.dye_lot_no ?? ''),
      item.qty_delivered,
      '',
    ].join('::')).sort().join('|');

    if (currentSignature === nextSignature) return;

    await manager.query(
      `DELETE FROM incoming_inspection_items
       WHERE inspection_id = ? AND tenant_id = ?`,
      [inspectionId, this.tenantId],
    );

    const supportsInspectionItemDyeLot = await this.supportsIncomingInspectionItemDyeLotColumn();
    const supportsAcceptedStockQty = await this.supportsIncomingInspectionAcceptedStockQtyColumn(manager);
    for (const item of seedItems) {
      const insertColumns = [
        'tenant_id',
        'inspection_id',
        'sku_id',
        'po_item_id',
        ...(supportsInspectionItemDyeLot ? ['dye_lot_no'] : []),
        ...(supportsAcceptedStockQty ? ['accepted_stock_qty'] : []),
        'qty_delivered',
        'qty_sampled',
        'qty_passed',
        'qty_failed',
        'result',
        'defect_types',
        'defect_images',
        'disposition',
        'notes',
        'created_by',
        'updated_by',
      ];
      const insertValues = [
        this.tenantId,
        inspectionId,
        item.sku_id,
        item.po_item_id,
        ...(supportsInspectionItemDyeLot ? [item.dye_lot_no ?? null] : []),
        ...(supportsAcceptedStockQty ? [null] : []),
        item.qty_delivered,
        this.userId,
        this.userId,
      ];
      await manager.query(
        `INSERT INTO incoming_inspection_items
           (${insertColumns.join(', ')})
         VALUES (${insertColumns.map((column, index) => {
           if (column === 'qty_sampled') return '0';
           if (column === 'qty_passed') return '0';
           if (column === 'qty_failed') return '0';
           if (column === 'result') return 'NULL';
           if (column === 'defect_types') return '\'[]\'';
           if (column === 'defect_images') return '\'[]\'';
           if (column === 'disposition') return '\'accept\'';
           if (column === 'notes') return 'NULL';
           return '?';
         }).join(', ')})`,
        insertValues,
      );
    }
  }

  private async hasInventoryUpdatedByColumn(manager?: EntityManager): Promise<boolean> {
    if (IncomingInspectionService.inventoryUpdatedByColumnSupported !== null) {
      return IncomingInspectionService.inventoryUpdatedByColumnSupported;
    }

    const runner = manager ?? AppDataSource;
    const rows = await runner.query<Array<{ cnt: number }>>(
      `SELECT COUNT(*) AS cnt
       FROM information_schema.columns
       WHERE table_schema = DATABASE()
         AND table_name = 'inventory'
         AND column_name = 'updated_by'`,
    );

    IncomingInspectionService.inventoryUpdatedByColumnSupported = Number(rows[0]?.cnt ?? 0) > 0;
    return IncomingInspectionService.inventoryUpdatedByColumnSupported;
  }

  private async getPurchaseReceiptDeliveryColumn(
    manager?: EntityManager,
  ): Promise<'delivery_note_id' | 'dn_id'> {
    if (IncomingInspectionService.purchaseReceiptDeliveryColumn) {
      return IncomingInspectionService.purchaseReceiptDeliveryColumn;
    }

    const runner = manager ?? AppDataSource;
    const rows = await runner.query<Array<{ column_name: string }>>(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = DATABASE()
         AND table_name = 'purchase_receipts'
         AND column_name IN ('delivery_note_id', 'dn_id')`,
    );

    const columns = new Set(rows.map((row) => String(row.column_name)));
    IncomingInspectionService.purchaseReceiptDeliveryColumn = columns.has('delivery_note_id')
      ? 'delivery_note_id'
      : 'dn_id';
    return IncomingInspectionService.purchaseReceiptDeliveryColumn;
  }

  private async hasPurchaseReceiptItemsTable(manager?: EntityManager): Promise<boolean> {
    if (IncomingInspectionService.purchaseReceiptItemsTableSupported !== null) {
      return IncomingInspectionService.purchaseReceiptItemsTableSupported;
    }

    const runner = manager ?? AppDataSource;
    const rows = await runner.query<Array<{ cnt: number }>>(
      `SELECT COUNT(*) AS cnt
       FROM information_schema.tables
       WHERE table_schema = DATABASE()
         AND table_name = 'purchase_receipt_items'`,
    );

    IncomingInspectionService.purchaseReceiptItemsTableSupported = Number(rows[0]?.cnt ?? 0) > 0;
    return IncomingInspectionService.purchaseReceiptItemsTableSupported;
  }

  private async hasPurchaseReceiptTotalAmountColumn(manager?: EntityManager): Promise<boolean> {
    if (IncomingInspectionService.purchaseReceiptTotalAmountColumnSupported !== null) {
      return IncomingInspectionService.purchaseReceiptTotalAmountColumnSupported;
    }

    const runner = manager ?? AppDataSource;
    const rows = await runner.query<Array<{ cnt: number }>>(
      `SELECT COUNT(*) AS cnt
       FROM information_schema.columns
       WHERE table_schema = DATABASE()
         AND table_name = 'purchase_receipts'
         AND column_name = 'total_amount'`,
    );

    IncomingInspectionService.purchaseReceiptTotalAmountColumnSupported = Number(rows[0]?.cnt ?? 0) > 0;
    return IncomingInspectionService.purchaseReceiptTotalAmountColumnSupported;
  }

  private async hasPurchaseReceiptItemControlColumns(manager?: EntityManager): Promise<boolean> {
    if (IncomingInspectionService.purchaseReceiptItemControlColumnsSupported !== null) {
      return IncomingInspectionService.purchaseReceiptItemControlColumnsSupported;
    }

    try {
      const runner = manager ?? AppDataSource;
      const rows = await runner.query<Array<{ cnt: number }>>(
        `SELECT COUNT(*) AS cnt
         FROM information_schema.columns
         WHERE table_schema = DATABASE()
           AND table_name = 'purchase_receipt_items'
           AND column_name = 'receipt_mode'`,
      );

      IncomingInspectionService.purchaseReceiptItemControlColumnsSupported = Number(rows[0]?.cnt ?? 0) > 0;
    } catch {
      IncomingInspectionService.purchaseReceiptItemControlColumnsSupported = false;
    }
    return IncomingInspectionService.purchaseReceiptItemControlColumnsSupported;
  }

  private async hasInventoryTransactionQtyChangeColumn(manager?: EntityManager): Promise<boolean> {
    if (IncomingInspectionService.inventoryTransactionQtyChangeColumnSupported !== null) {
      return IncomingInspectionService.inventoryTransactionQtyChangeColumnSupported;
    }

    const runner = manager ?? AppDataSource;
    const rows = await runner.query<Array<{ cnt: number }>>(
      `SELECT COUNT(*) AS cnt
       FROM information_schema.columns
       WHERE table_schema = DATABASE()
         AND table_name = 'inventory_transactions'
         AND column_name = 'qty_change'`,
    );

    IncomingInspectionService.inventoryTransactionQtyChangeColumnSupported = Number(rows[0]?.cnt ?? 0) > 0;
    return IncomingInspectionService.inventoryTransactionQtyChangeColumnSupported;
  }

  private async hasReturnOrderItemUpdatedByColumn(manager?: EntityManager): Promise<boolean> {
    if (IncomingInspectionService.returnOrderItemUpdatedBySupported !== null) {
      return IncomingInspectionService.returnOrderItemUpdatedBySupported;
    }

    const runner = manager ?? AppDataSource;
    const rows = await runner.query<Array<{ cnt: number }>>(
      `SELECT COUNT(*) AS cnt
       FROM information_schema.columns
       WHERE table_schema = DATABASE()
         AND table_name = 'return_order_items'
         AND column_name = 'updated_by'`,
    );

    IncomingInspectionService.returnOrderItemUpdatedBySupported = Number(rows[0]?.cnt ?? 0) > 0;
    return IncomingInspectionService.returnOrderItemUpdatedBySupported;
  }

  private async supportsDeliveryReceivedStatus(manager?: EntityManager): Promise<boolean> {
    if (IncomingInspectionService.deliveryReceivedStatusSupported !== null) {
      return IncomingInspectionService.deliveryReceivedStatusSupported;
    }

    const runner = manager ?? AppDataSource;
    const rows = await runner.query<Array<{ column_type: string }>>(
      `SELECT column_type
       FROM information_schema.columns
       WHERE table_schema = DATABASE()
         AND table_name = 'delivery_notes'
         AND column_name = 'status'
       LIMIT 1`,
    );

    const columnType = String(rows[0]?.column_type ?? '').toLowerCase();
    IncomingInspectionService.deliveryReceivedStatusSupported = columnType.includes("'received'");
    return IncomingInspectionService.deliveryReceivedStatusSupported;
  }

  // ── 分页列表 ─────────────────────────────────────────────────
  async list(filter: ListInspectionFilter) {
    const conds = ['r.tenant_id = ?'];
    const params: unknown[] = [this.tenantId];

    if (filter.status) {
      conds.push('r.status = ?');
      params.push(filter.status);
    }
    if (filter.poId) {
      conds.push('r.po_id = ?');
      params.push(filter.poId);
    }
    if (filter.dateFrom) {
      conds.push('r.inspection_date >= ?');
      params.push(filter.dateFrom);
    }
    if (filter.dateTo) {
      conds.push('r.inspection_date <= ?');
      params.push(filter.dateTo);
    }
    if (filter.result) {
      conds.push('r.overall_result = ?');
      params.push(filter.result);
    }

    const where = conds.join(' AND ');
    const offset = (filter.page - 1) * filter.pageSize;

    const [list, countRows] = await Promise.all([
      AppDataSource.query(
        `SELECT r.*,
                po.po_no AS poNo,
                sup.name AS supplierName,
                dn.delivery_no AS deliveryNo,
                u.username AS inspectorName
         FROM incoming_inspection_records r
         LEFT JOIN purchase_orders po ON po.id = r.po_id
         LEFT JOIN suppliers sup ON sup.id = po.supplier_id
         LEFT JOIN delivery_notes dn ON dn.id = r.delivery_note_id
         LEFT JOIN users u ON u.id = r.inspector_id
         WHERE ${where}
         ORDER BY r.id DESC
         LIMIT ? OFFSET ?`,
        [...params, filter.pageSize, offset],
      ),
      AppDataSource.query<Array<{ total: number }>>(
        `SELECT COUNT(*) AS total FROM incoming_inspection_records r WHERE ${where}`,
        params,
      ),
    ]);

    return { list, total: Number(countRows[0]?.total ?? 0) };
  }

  // ── 详情（含 items）──────────────────────────────────────────
  async getById(id: number) {
    const supportsInspectionItemDyeLot = await this.supportsIncomingInspectionItemDyeLotColumn();
    const supportsAcceptedStockQty = await this.supportsIncomingInspectionAcceptedStockQtyColumn();
    const [record] = await AppDataSource.query(
      `SELECT r.*,
              po.po_no AS poNo,
              sup.name AS supplierName,
              dn.delivery_no AS deliveryNo
       FROM incoming_inspection_records r
       LEFT JOIN purchase_orders po ON po.id = r.po_id
       LEFT JOIN suppliers sup ON sup.id = po.supplier_id
       LEFT JOIN delivery_notes dn ON dn.id = r.delivery_note_id
       WHERE r.id = ? AND r.tenant_id = ?
       LIMIT 1`,
      [id, this.tenantId],
    );

    if (!record) {
      throw AppError.notFound('质检单不存在', ResponseCode.NOT_FOUND);
    }

    let rawItems = await AppDataSource.query<Array<Record<string, unknown>>>(
      `SELECT i.*,
              s.sku_code AS skuCode,
              s.name AS skuName,
              s.stock_unit AS stockUnit,
              poi.purchase_unit AS purchaseUnit,
              s.has_dye_lot AS hasDyeLot,
              ${supportsInspectionItemDyeLot ? 'i.dye_lot_no AS dyeLotNo' : 'NULL AS dyeLotNo'},
              ${supportsAcceptedStockQty ? 'CAST(i.accepted_stock_qty AS CHAR) AS acceptedStockQty' : 'NULL AS acceptedStockQty'}
       FROM incoming_inspection_items i
       LEFT JOIN skus s ON s.id = i.sku_id
       LEFT JOIN purchase_order_items poi ON poi.id = i.po_item_id AND poi.tenant_id = i.tenant_id
       WHERE i.inspection_id = ? AND i.tenant_id = ?
       ORDER BY i.id ASC`,
      [id, this.tenantId],
    );

    if ((record.status === 'draft' || record.status === 'in_progress') && record.delivery_note_id) {
      await AppDataSource.transaction(async (manager) => {
        await this.normalizeDraftInspectionItems(manager, id, record, rawItems);
      });
      rawItems = await AppDataSource.query<Array<Record<string, unknown>>>(
        `SELECT i.*,
                s.sku_code AS skuCode,
                s.name AS skuName,
                s.stock_unit AS stockUnit,
                poi.purchase_unit AS purchaseUnit,
                s.has_dye_lot AS hasDyeLot,
                ${supportsInspectionItemDyeLot ? 'i.dye_lot_no AS dyeLotNo' : 'NULL AS dyeLotNo'},
                ${supportsAcceptedStockQty ? 'CAST(i.accepted_stock_qty AS CHAR) AS acceptedStockQty' : 'NULL AS acceptedStockQty'}
         FROM incoming_inspection_items i
         LEFT JOIN skus s ON s.id = i.sku_id
         LEFT JOIN purchase_order_items poi ON poi.id = i.po_item_id AND poi.tenant_id = i.tenant_id
         WHERE i.inspection_id = ? AND i.tenant_id = ?
         ORDER BY i.id ASC`,
        [id, this.tenantId],
      );
    }

    const items = rawItems.map((item) => ({
      ...item,
      id: Number(item.id),
      inspectionId: Number(item.inspection_id ?? item.inspectionId ?? 0),
      skuId: Number(item.sku_id ?? item.skuId ?? 0),
      poItemId: Number(item.po_item_id ?? item.poItemId ?? 0),
      qtyDelivered: String(item.qty_delivered ?? item.qtyDelivered ?? '0'),
      qtySampled: String(item.qty_sampled ?? item.qtySampled ?? '0'),
      qtyPassed: String(item.qty_passed ?? item.qtyPassed ?? '0'),
      qtyFailed: String(item.qty_failed ?? item.qtyFailed ?? '0'),
      dyeLotNo: item.dyeLotNo ?? item.dye_lot_no ?? null,
      hasDyeLot: Boolean(Number(item.hasDyeLot ?? item.has_dye_lot ?? 0)),
      skuCode: String(item.skuCode ?? ''),
      skuName: String(item.skuName ?? ''),
      stockUnit: String(item.stockUnit ?? ''),
      purchaseUnit: String(item.purchaseUnit ?? item.stockUnit ?? ''),
      acceptedStockQty: item.acceptedStockQty == null ? null : String(item.acceptedStockQty),
    }));

    return { ...record, items };
  }

  // ── 创建质检单，从送货单带入明细 ───────────────────────────────
  async create(params: CreateInspectionParams): Promise<{ id: number; inspectionNo: string }> {
    // 验证送货单存在且属于该租户
    const [dn] = await AppDataSource.query(
      `SELECT dn.id, dn.po_id, dn.status
       FROM delivery_notes dn
       WHERE dn.id = ? AND dn.tenant_id = ?
       LIMIT 1`,
      [params.deliveryNoteId, this.tenantId],
    );
    if (!dn) throw AppError.notFound('送货单不存在', ResponseCode.NOT_FOUND);
    if (Number(dn.po_id) !== params.poId) {
      throw AppError.badRequest('送货单不属于该采购订单');
    }

    // 检查是否已有质检单
    const [existingInspection] = await AppDataSource.query(
      `SELECT id FROM incoming_inspection_records
       WHERE delivery_note_id = ? AND tenant_id = ?
       LIMIT 1`,
      [params.deliveryNoteId, this.tenantId],
    );
    if (existingInspection) {
      throw AppError.conflict('该送货单已存在质检单');
    }

    // 读取送货单明细
    const dnItems = await this.buildInspectionSeedItems(AppDataSource, params.poId, params.deliveryNoteId);

    if (!dnItems.length) {
      throw AppError.conflict('当前送货单已无可质检数量，不能重复创建质检单');
    }

    const allocatableQty = dnItems.reduce(
      (sum, item) => item.po_item_id ? sum.plus(item.qty_delivered) : sum,
      new Decimal(0),
    );
    const totalQty = dnItems.reduce(
      (sum, item) => sum.plus(item.qty_delivered),
      new Decimal(0),
    );

    if (allocatableQty.lte(0) || !allocatableQty.eq(totalQty)) {
      throw AppError.conflict('当前送货单数量已超出采购订单剩余可质检数量，不能创建质检单');
    }

    return AppDataSource.transaction(async (manager) => {
      const inspectionNo = await generateNo('incoming_inspection', this.tenantId);
      const supportsInspectionItemDyeLot = await this.supportsIncomingInspectionItemDyeLotColumn();

      const result = await manager.query(
        `INSERT INTO incoming_inspection_records
           (tenant_id, inspection_no, po_id, delivery_note_id, inspector_id,
            inspection_date, status, overall_result, receipt_triggered, return_triggered,
            notes, created_by, updated_by)
         VALUES (?,?,?,?,?,?,'draft',NULL,0,0,?,?,?)`,
        [
          this.tenantId,
          inspectionNo,
          params.poId,
          params.deliveryNoteId,
          this.userId,
          params.inspectionDate,
          params.notes ?? null,
          this.userId,
          this.userId,
        ],
      );
      const inspectionId = Number(result.insertId);

      // 从送货单明细生成质检明细
      for (const item of dnItems) {
        const insertColumns = [
          'tenant_id',
          'inspection_id',
          'sku_id',
          'po_item_id',
          ...(supportsInspectionItemDyeLot ? ['dye_lot_no'] : []),
          'qty_delivered',
          'qty_sampled',
          'qty_passed',
          'qty_failed',
          'result',
          'defect_types',
          'defect_images',
          'disposition',
          'notes',
          'created_by',
          'updated_by',
        ];
        const insertValues = [
          this.tenantId,
          inspectionId,
          item.sku_id,
          item.po_item_id ?? null,
          ...(supportsInspectionItemDyeLot ? [item.dye_lot_no ?? null] : []),
          item.qty_delivered,
          this.userId,
          this.userId,
        ];
        await manager.query(
          `INSERT INTO incoming_inspection_items
             (${insertColumns.join(', ')})
           VALUES (${insertColumns.map((column) => {
             if (column === 'qty_sampled') return '0';
             if (column === 'qty_passed') return '0';
             if (column === 'qty_failed') return '0';
             if (column === 'result') return 'NULL';
             if (column === 'defect_types') return '\'[]\'';
             if (column === 'defect_images') return '\'[]\'';
             if (column === 'disposition') return '\'accept\'';
             if (column === 'notes') return 'NULL';
             return '?';
           }).join(', ')})`,
          insertValues,
        );
      }

      // 关联送货单的 inspection_id
      await manager.query(
        `UPDATE delivery_notes SET inspection_id = ? WHERE id = ? AND tenant_id = ?`,
        [inspectionId, params.deliveryNoteId, this.tenantId],
      );

      return { id: inspectionId, inspectionNo };
    });
  }

  private resolveAcceptedReceiptQty(item: any): Decimal {
    const qtyDelivered = new Decimal(item.qty_delivered || '0');
    const qtySampled = new Decimal(item.qty_sampled || '0');
    const qtyPassed = new Decimal(item.qty_passed || '0');

    // 全检 + 通过 + 接受时，默认整批入库；抽检场景继续使用人工录入的合格数量。
    if (
      item.disposition === 'accept' &&
      item.result === 'pass' &&
      qtyDelivered.gt(0) &&
      qtySampled.eq(qtyDelivered)
    ) {
      return qtyDelivered;
    }

    return qtyPassed;
  }

  private async getSkuStockUnit(
    manager: EntityManager,
    skuId: number,
  ): Promise<string> {
    const [skuRow] = await manager.query<Array<{ stock_unit: string | null }>>(
      `SELECT stock_unit FROM skus WHERE id = ? AND tenant_id = ? LIMIT 1`,
      [skuId, this.tenantId],
    );
    return skuRow?.stock_unit ?? 'pcs';
  }

  private async getUnitConversions(
    manager: EntityManager,
    skuId: number,
  ): Promise<Array<{ fromUnit: string; toUnit: string; conversionRate: string }>> {
    return manager.query(
      `SELECT
         from_unit AS fromUnit,
         to_unit AS toUnit,
         conversion_rate AS conversionRate
       FROM sku_unit_conversions
       WHERE tenant_id = ? AND sku_id = ?`,
      [this.tenantId, skuId],
    );
  }

  private buildInspectionSourceGroupKey(sourceItemIds: number[]): string {
    return Array.from(new Set(sourceItemIds))
      .map((id) => Number(id))
      .filter((id) => Number.isInteger(id) && id > 0)
      .sort((a, b) => a - b)
      .join(',');
  }

  private async replaceInspectionGroupItems(
    manager: EntityManager,
    inspectionId: number,
    supportsInspectionItemDyeLot: boolean,
    sourceItemIds: number[],
    items: UpdateInspectionItemInput[],
  ): Promise<void> {
    const supportsAcceptedStockQty = await this.supportsIncomingInspectionAcceptedStockQtyColumn(manager);
    const normalizedSourceIds = Array.from(new Set(sourceItemIds))
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0);

    if (!normalizedSourceIds.length) {
      throw AppError.badRequest('缺少待拆分的原始质检明细');
    }

    const placeholders = normalizedSourceIds.map(() => '?').join(', ');
    const sourceRowsRaw = await manager.query<Array<InspectionItemRow>>(
      `SELECT id, sku_id, po_item_id, qty_delivered
       FROM incoming_inspection_items
       WHERE inspection_id = ? AND tenant_id = ? AND id IN (${placeholders})`,
      [inspectionId, this.tenantId, ...normalizedSourceIds],
    );

    if (sourceRowsRaw.length !== normalizedSourceIds.length) {
      throw AppError.notFound('部分原始质检明细不存在，无法按缸号拆分');
    }

    const sourceRowMap = new Map<number, InspectionItemRow>(
      sourceRowsRaw.map((row) => [
        Number(row.id),
        {
          id: Number(row.id),
          sku_id: Number(row.sku_id),
          po_item_id: row.po_item_id == null ? null : Number(row.po_item_id),
          qty_delivered: String(row.qty_delivered ?? '0'),
        },
      ]),
    );

    const sourceRows = normalizedSourceIds.map((id) => sourceRowMap.get(id)).filter(Boolean) as InspectionItemRow[];
    const totalDelivered = sourceRows.reduce(
      (sum, row) => sum.plus(row.qty_delivered || '0'),
      new Decimal(0),
    );
    const requestedDelivered = items.reduce(
      (sum, item) => sum.plus(item.qtyDelivered || '0'),
      new Decimal(0),
    );

    if (!requestedDelivered.eq(totalDelivered)) {
      throw AppError.badRequest(
        `缸号分段的到货数量合计(${requestedDelivered.toFixed(4)})必须等于原始到货数量(${totalDelivered.toFixed(4)})`,
      );
    }

    await manager.query(
      `DELETE FROM incoming_inspection_items
       WHERE inspection_id = ? AND tenant_id = ? AND id IN (${placeholders})`,
      [inspectionId, this.tenantId, ...normalizedSourceIds],
    );

    const remainingSourceCapacities = sourceRows.map((row) => new Decimal(row.qty_delivered || '0'));
    for (const item of items) {
      const qtyDelivered = new Decimal(item.qtyDelivered || '0');
      const qtySampled = new Decimal(item.qtysampled || '0');
      const qtyPassed = new Decimal(item.qtyPassed || '0');
      const qtyFailed = new Decimal(item.qtyFailed || '0');
      const acceptedStockQty = String(item.acceptedStockQty ?? '').trim()
        ? new Decimal(String(item.acceptedStockQty))
        : null;

      if (qtyDelivered.lte(0)) {
        throw AppError.badRequest('缸号分段的到货数量必须大于 0');
      }
      if (qtySampled.gt(qtyDelivered)) {
        throw AppError.badRequest('抽检数量不能超过该缸到货数量');
      }
      if (qtyPassed.plus(qtyFailed).gt(qtyDelivered)) {
        throw AppError.badRequest('缸号分段的合格数量与不合格数量之和不能超过该缸到货数量');
      }
      if (acceptedStockQty && acceptedStockQty.lte(0)) {
        throw AppError.badRequest('缸号分段的实际入库数量必须大于 0');
      }

      const segmentAllocations = allocateQtyAcrossCapacities(qtyDelivered, remainingSourceCapacities);
      segmentAllocations.forEach((allocation, index) => {
        remainingSourceCapacities[index] = remainingSourceCapacities[index].minus(allocation);
      });

      const sampledAllocations = allocateQtyAcrossCapacities(qtySampled, segmentAllocations);
      const passFailAllocations = allocatePassedFailedAcrossCapacities(
        qtyPassed,
        qtyFailed,
        segmentAllocations,
      );
      const acceptedStockAllocations = acceptedStockQty
        ? this.distributeDecimalAcrossWeights(acceptedStockQty, segmentAllocations)
        : segmentAllocations.map(() => null);

      for (let index = 0; index < segmentAllocations.length; index += 1) {
        const allocatedDelivered = segmentAllocations[index];
        if (allocatedDelivered.lte(0)) continue;

        const sourceRow = sourceRows[index];
        const insertColumns = [
          'tenant_id',
          'inspection_id',
          'sku_id',
          'po_item_id',
          ...(supportsInspectionItemDyeLot ? ['dye_lot_no'] : []),
          ...(supportsAcceptedStockQty ? ['accepted_stock_qty'] : []),
          'qty_delivered',
          'qty_sampled',
          'qty_passed',
          'qty_failed',
          'result',
          'defect_types',
          'defect_images',
          'disposition',
          'notes',
          'created_by',
          'updated_by',
        ];
        const insertValues = [
          this.tenantId,
          inspectionId,
          sourceRow.sku_id,
          sourceRow.po_item_id,
          ...(supportsInspectionItemDyeLot ? [String(item.dyeLotNo ?? '').trim() || null] : []),
          ...(supportsAcceptedStockQty
            ? [acceptedStockAllocations[index] ? formatInspectionQty(acceptedStockAllocations[index] as Decimal) : null]
            : []),
          formatInspectionQty(allocatedDelivered),
          formatInspectionQty(sampledAllocations[index]),
          formatInspectionQty(passFailAllocations[index].qtyPassed),
          formatInspectionQty(passFailAllocations[index].qtyFailed),
          item.result,
          JSON.stringify(item.defectTypes ?? []),
          JSON.stringify(item.defectImages ?? []),
          item.disposition,
          item.notes ?? null,
          this.userId,
          this.userId,
        ];
        await manager.query(
          `INSERT INTO incoming_inspection_items
             (${insertColumns.join(', ')})
           VALUES (${insertColumns.map(() => '?').join(', ')})`,
          insertValues,
        );
      }
    }
  }

  // ── 更新质检明细（逐行录入结果）────────────────────────────────
  async updateItems(id: number, items: UpdateInspectionItemInput[]): Promise<void> {
    const [record] = await AppDataSource.query(
      `SELECT id, status FROM incoming_inspection_records
       WHERE id = ? AND tenant_id = ? LIMIT 1`,
      [id, this.tenantId],
    );
    if (!record) throw AppError.notFound('质检单不存在', ResponseCode.NOT_FOUND);
    if (record.status === 'passed' || record.status === 'failed' || record.status === 'partially_passed') {
      throw AppError.conflict('质检单已提交，无法修改明细');
    }

    await AppDataSource.transaction(async (manager) => {
      const supportsInspectionItemDyeLot = await this.supportsIncomingInspectionItemDyeLotColumn();
      const supportsAcceptedStockQty = await this.supportsIncomingInspectionAcceptedStockQtyColumn(manager);
      const groupedReplaceItems = new Map<string, UpdateInspectionItemInput[]>();
      const directItems: UpdateInspectionItemInput[] = [];

      // 更新质检单状态为 in_progress
      await manager.query(
        `UPDATE incoming_inspection_records
         SET status = 'in_progress', updated_by = ?
         WHERE id = ? AND tenant_id = ?`,
        [this.userId, id, this.tenantId],
      );

      for (const item of items) {
        const normalizedSourceItemIds = Array.isArray(item.sourceItemIds)
          ? item.sourceItemIds.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0)
          : [];
        if (normalizedSourceItemIds.length > 0) {
          const groupKey = this.buildInspectionSourceGroupKey(normalizedSourceItemIds);
          const existing = groupedReplaceItems.get(groupKey);
          if (existing) {
            existing.push({ ...item, sourceItemIds: normalizedSourceItemIds });
          } else {
            groupedReplaceItems.set(groupKey, [{ ...item, sourceItemIds: normalizedSourceItemIds }]);
          }
          continue;
        }
        directItems.push(item);
      }

      for (const item of directItems) {
        if (Array.isArray(item.sourceItemIds) && item.sourceItemIds.length > 0) {
          continue;
        }
        if (!item.id) {
          throw AppError.badRequest('质检明细缺少 id');
        }

        // BUG-S3-001: 校验 qty_passed + qty_failed <= qty_delivered
        const [dbItem] = await manager.query(
          `SELECT qty_delivered FROM incoming_inspection_items
           WHERE id = ? AND inspection_id = ? AND tenant_id = ? LIMIT 1`,
          [item.id, id, this.tenantId],
        );
        if (!dbItem) {
          throw AppError.notFound(`质检明细 id=${item.id} 不存在`, ResponseCode.NOT_FOUND);
        }
        const qtyDelivered = new Decimal(dbItem.qty_delivered || '0');
        const qtySampled = new Decimal(item.qtysampled || '0');
        const qtyPassed = new Decimal(item.qtyPassed || '0');
        const qtyFailed = new Decimal(item.qtyFailed || '0');
        const acceptedStockQty = String(item.acceptedStockQty ?? '').trim()
          ? new Decimal(String(item.acceptedStockQty))
          : null;
        if (qtySampled.gt(qtyDelivered)) {
          throw AppError.badRequest(
            `质检明细 id=${item.id} 的抽检数量(${qtySampled.toString()})超过到货数量(${qtyDelivered.toString()})`,
          );
        }
        if (qtyPassed.plus(qtyFailed).gt(qtyDelivered)) {
          throw AppError.badRequest(
            `质检明细 id=${item.id} 的合格数量+不合格数量(${qtyPassed.plus(qtyFailed).toString()})超过到货数量(${qtyDelivered.toString()})`,
          );
        }
        if (acceptedStockQty && acceptedStockQty.lte(0)) {
          throw AppError.badRequest(`质检明细 id=${item.id} 的实际入库数量必须大于 0`);
        }

        await manager.query(
          `UPDATE incoming_inspection_items
           SET qty_sampled = ?,
               qty_passed = ?,
               qty_failed = ?,
               ${supportsAcceptedStockQty ? 'accepted_stock_qty = ?,' : ''}
               ${supportsInspectionItemDyeLot ? 'dye_lot_no = ?,' : ''}
               result = ?,
               defect_types = ?,
               defect_images = ?,
               disposition = ?,
               notes = ?,
               updated_by = ?
           WHERE id = ? AND inspection_id = ? AND tenant_id = ?`,
          [
            item.qtysampled,
            item.qtyPassed,
            item.qtyFailed,
            ...(supportsAcceptedStockQty ? [acceptedStockQty?.toFixed(4) ?? null] : []),
            ...(supportsInspectionItemDyeLot ? [String(item.dyeLotNo ?? '').trim() || null] : []),
            item.result,
            JSON.stringify(item.defectTypes ?? []),
            JSON.stringify(item.defectImages ?? []),
            item.disposition,
            item.notes ?? null,
            this.userId,
            item.id,
            id,
            this.tenantId,
          ],
        );
      }

      for (const groupedItems of groupedReplaceItems.values()) {
        await this.replaceInspectionGroupItems(
          manager,
          id,
          supportsInspectionItemDyeLot,
          groupedItems[0].sourceItemIds ?? [],
          groupedItems,
        );
      }
    });
  }

  // ── 提交质检结论（核心事务逻辑）────────────────────────────────
  async submit(id: number, params: SubmitInspectionParams): Promise<void> {
    // 事务外仅做存在性校验，不读取 receipt_triggered / return_triggered。
    // 幂等位的状态检查必须在事务内通过 FOR UPDATE 行锁读取，
    // 以防止并发请求同时通过检查后重复执行入库（CR-002）。
    const [preCheck] = await AppDataSource.query(
      `SELECT id FROM incoming_inspection_records
       WHERE id = ? AND tenant_id = ? LIMIT 1`,
      [id, this.tenantId],
    );
    if (!preCheck) throw AppError.notFound('质检单不存在', ResponseCode.NOT_FOUND);

    // 读取所有质检明细（明细数据在事务外读取即可，不涉及幂等控制）
    const items = await AppDataSource.query(
      `SELECT ii.*,
              poi.purchase_unit, poi.unit_price,
              s.has_dye_lot AS has_dye_lot
       FROM incoming_inspection_items ii
       LEFT JOIN purchase_order_items poi ON poi.id = ii.po_item_id
       LEFT JOIN skus s ON s.id = ii.sku_id AND s.tenant_id = ii.tenant_id
       WHERE ii.inspection_id = ? AND ii.tenant_id = ?`,
      [id, this.tenantId],
    );

    if (!items.length) {
      throw AppError.badRequest('质检单无明细，请先录入质检结果');
    }

    // BUG-S3-002: BD-004 校验 — 不合格品（result=fail）仅允许退货处置
    const invalidDispositionItems = items.filter(
      (i: any) => i.result === 'fail' && i.disposition !== 'return',
    );
    if (invalidDispositionItems.length > 0) {
      throw AppError.badRequest('不合格品仅允许退货处置(BD-004)');
    }

    let trackedInventoryManager: InventorySnapshotTrackedManager | null = null;
    await AppDataSource.transaction(async (manager) => {
      trackedInventoryManager = manager as InventorySnapshotTrackedManager;
      // 事务内使用 SELECT ... FOR UPDATE 获取行级锁，
      // 保证同一质检单的并发请求串行执行，幂等位检查在锁保护下进行。
      const [record] = await manager.query(
        `SELECT id, status, receipt_triggered, return_triggered, po_id, delivery_note_id
         FROM incoming_inspection_records
         WHERE id = ? AND tenant_id = ? LIMIT 1 FOR UPDATE`,
        [id, this.tenantId],
      );

      if (record.status === 'passed' || record.status === 'failed' || record.status === 'partially_passed') {
        throw AppError.conflict('质检单已完成提交，禁止重复操作');
      }

      // 确定最终状态
      const allPassed = items.every((i: any) => i.result === 'pass');
      const allFailed = items.every((i: any) => i.result === 'fail');
      let finalStatus: string;
      if (allPassed) {
        finalStatus = 'passed';
      } else if (allFailed) {
        finalStatus = 'failed';
      } else {
        finalStatus = 'partially_passed';
      }

      // 更新质检单状态
      await manager.query(
        `UPDATE incoming_inspection_records
         SET status = ?,
             overall_result = ?,
             notes = ?,
             completed_at = NOW(),
             updated_by = ?
         WHERE id = ? AND tenant_id = ?`,
        [finalStatus, params.overallResult, params.notes ?? null, this.userId, id, this.tenantId],
      );

      if (record.delivery_note_id) {
        await manager.query(
          `UPDATE delivery_notes
           SET status = 'confirmed', updated_by = ?
           WHERE id = ? AND tenant_id = ?`,
          [this.userId, record.delivery_note_id, this.tenantId],
        );
      }

      // ── 合格品处理：生成入库单 + 库存事务 ─────────────────────
      const passedItems = items.filter(
        (i: any) => new Decimal(i.qty_passed || '0').gt(0),
      );

      if (passedItems.length > 0 && !record.receipt_triggered) {
        await this.handlePassedItems(manager, id, record, passedItems, params);
      }

      // ── 不合格品处理（BD-004）：disposition=return 自动生成退货单 ───
      const failedForReturn = items.filter(
        (i: any) =>
          new Decimal(i.qty_failed || '0').gt(0) && i.disposition === 'return',
      );

      if (failedForReturn.length > 0 && !record.return_triggered) {
        await this.handleFailedItems(manager, id, record, failedForReturn);
      }
    });

    await this.invalidateInventorySnapshotCaches(
      this.consumeTrackedInventorySnapshotSkuIds(trackedInventoryManager),
    );
  }

  // 合格品处理：生成 purchase_receipts + inventory_transactions + 更新库存
  private async handlePassedItems(
    manager: EntityManager,
    inspectionId: number,
    record: any,
    passedItems: any[],
    submitParams?: Pick<SubmitInspectionParams, 'warehouseId' | 'locationId'>,
  ): Promise<void> {
    const [purchaseOrder] = await manager.query<Array<{ id: number; status: string }>>(
      `SELECT id, status FROM purchase_orders
       WHERE id = ? AND tenant_id = ? LIMIT 1 FOR UPDATE`,
      [record.po_id, this.tenantId],
    );
    if (!purchaseOrder) {
      throw AppError.notFound('采购订单不存在', ResponseCode.PO_NOT_FOUND);
    }
    if (!['confirmed', 'partial_received'].includes(purchaseOrder.status)) {
      throw AppError.conflict(
        `当前采购订单状态「${purchaseOrder.status}」不允许确认入库，仅 confirmed / partial_received 可操作`,
      );
    }

    const receiptNo = await generateNo('receipt', this.tenantId);
    const receiptDeliveryColumn = await this.getPurchaseReceiptDeliveryColumn(manager);
    const supportsReceiptItemsTable = await this.hasPurchaseReceiptItemsTable(manager);
    const supportsReceiptTotalAmount = await this.hasPurchaseReceiptTotalAmountColumn(manager);
    const supportsReceiptItemDyeLot = supportsReceiptItemsTable
      ? await this.supportsPurchaseReceiptItemDyeLotColumn(manager)
      : false;
    const supportsReceiptItemControlColumns = supportsReceiptItemsTable
      ? await this.hasPurchaseReceiptItemControlColumns(manager)
      : false;
    const deliveryStatusAfterReceipt = (await this.supportsDeliveryReceivedStatus(manager))
      ? 'received'
      : 'confirmed';

    // 计算入库总金额
    const totalAmount = passedItems.reduce((sum: Decimal, item: any) => {
      const qty = this.resolveAcceptedReceiptQty(item);
      const price = new Decimal(item.unit_price || '0');
      return sum.plus(qty.mul(price));
    }, new Decimal(0));

    // 生成 purchase_receipts
    const receiptInsertColumns = [
      'tenant_id',
      'receipt_no',
      'po_id',
      receiptDeliveryColumn,
      'status',
      ...(supportsReceiptTotalAmount ? ['total_amount'] : []),
      'notes',
      'received_at',
      'created_by',
      'updated_by',
    ];
    const receiptInsertParams: unknown[] = [
      this.tenantId,
      receiptNo,
      record.po_id,
      record.delivery_note_id,
      'confirmed',
      ...(supportsReceiptTotalAmount ? [totalAmount.toFixed(2)] : []),
      null,
      this.userId,
      this.userId,
    ];

    const receiptResult = await manager.query(
      `INSERT INTO purchase_receipts
         (${receiptInsertColumns.join(', ')})
       VALUES (${receiptInsertColumns.map((column) => (column === 'received_at' ? 'NOW(3)' : '?')).join(', ')})`,
      receiptInsertParams,
    );
    const receiptId = Number(receiptResult.insertId);

    // 更新 delivery_notes.receipt_id
    await manager.query(
      `UPDATE delivery_notes
       SET receipt_id = ?, status = ?, updated_by = ?
       WHERE id = ? AND tenant_id = ?`,
      [receiptId, deliveryStatusAfterReceipt, this.userId, record.delivery_note_id, this.tenantId],
    );

    const receivedSkuIds = new Set<number>();
    const affectedOperationIds = new Set<number>();
    const supportsInventoryUpdatedBy = await this.hasInventoryUpdatedByColumn(manager);
    const supportsInventoryQtyChange = await this.hasInventoryTransactionQtyChangeColumn(manager);
    let warehouseLocation: Awaited<ReturnType<typeof resolveWarehouseLocationBinding>> | null = null;

    for (const item of passedItems) {
      const qtyPassed = this.resolveAcceptedReceiptQty(item);
      const unitPrice = new Decimal(item.unit_price || '0');
      const dyeLotNo = String(item.dye_lot_no ?? '').trim() || null;
      const hasDyeLot = Boolean(Number(item.has_dye_lot ?? 0));
      const stockUnit = await this.getSkuStockUnit(manager, Number(item.sku_id));
      const purchaseUnit = item.purchase_unit ?? stockUnit;
      const controlConfig = await this.resolveReceiptItemControlConfig(manager, item);
      const acceptedStockQtyRaw = String(item.accepted_stock_qty ?? item.acceptedStockQty ?? '').trim();
      if (
        controlConfig.receiptMode === 'inventory'
        && this.requiresMeasuredStockQty(purchaseUnit, stockUnit)
        && qtyPassed.gt(0)
        && !acceptedStockQtyRaw
      ) {
        throw AppError.badRequest(`物料 SKU#${item.sku_id} 需要填写实际米数后才能提交质检结论`);
      }
      const convertedQty = acceptedStockQtyRaw
        ? new Decimal(acceptedStockQtyRaw)
        : UnitConverter.convert(
            qtyPassed.toString(),
            purchaseUnit,
            purchaseUnit === stockUnit
              ? []
              : await this.getUnitConversions(manager, Number(item.sku_id)),
            stockUnit,
          ).qty;

      if (controlConfig.receiptMode === 'inventory' && hasDyeLot && !dyeLotNo) {
        throw AppError.badRequest(`物料 SKU#${item.sku_id} 启用了缸号管理，入库前必须确认缸号`);
      }

      if (controlConfig.receiptMode === 'inventory' && warehouseLocation === null) {
        warehouseLocation = await resolveWarehouseLocationBinding({
          manager,
          tenantId: this.tenantId,
          userId: this.userId,
          warehouseId: submitParams?.warehouseId,
          locationId: submitParams?.locationId,
          sourceRef: 'incoming_inspection:submit',
        });
        assertWarehouseInScope(await this.getWarehouseDataScope(), warehouseLocation.warehouseId);
      }

      // 写入 purchase_receipt_items
      if (supportsReceiptItemsTable) {
        const receiptItemColumns = [
          'tenant_id',
          'receipt_id',
          'sku_id',
          ...(supportsReceiptItemControlColumns ? ['po_item_id', 'business_class', 'receipt_mode', 'requires_acceptance', 'request_department_id', 'budget_code'] : []),
          ...(supportsReceiptItemDyeLot ? ['dye_lot_no'] : []),
          'qty_received',
          'purchase_unit',
          'unit_price',
          'amount',
          'created_by',
          'updated_by',
        ];
        const receiptItemValues = [
          this.tenantId,
          receiptId,
          item.sku_id,
          ...(supportsReceiptItemControlColumns
            ? [
                item.po_item_id ?? null,
                controlConfig.businessClass,
                controlConfig.receiptMode,
                controlConfig.requiresAcceptance ? 1 : 0,
                controlConfig.requestDepartmentId ?? null,
                controlConfig.budgetCode ?? null,
              ]
            : []),
          ...(supportsReceiptItemDyeLot ? [dyeLotNo] : []),
          qtyPassed.toString(),
          item.purchase_unit ?? 'pcs',
          unitPrice.toString(),
          qtyPassed.mul(unitPrice).toFixed(2),
          this.userId,
          this.userId,
        ];
        await manager.query(
          `INSERT INTO purchase_receipt_items
             (${receiptItemColumns.join(', ')})
           VALUES (${receiptItemColumns.map(() => '?').join(',')})`,
          receiptItemValues,
        );
      }

      if (controlConfig.receiptMode === 'inventory') {
        receivedSkuIds.add(Number(item.sku_id));
        let txResult;
        if (supportsInventoryQtyChange) {
          txResult = await manager.query(
            `INSERT INTO inventory_transactions
               (tenant_id, sku_id, transaction_type, warehouse_id, location_id, qty_change, reference_type,
                reference_id, reference_no, source_ref, notes, dye_lot_no, created_by, updated_by)
             VALUES (?,?,'PURCHASE_IN',?,?,?,?,?,?,?,?,?,?,?)`,
            [
              this.tenantId,
              item.sku_id,
              warehouseLocation!.warehouseId,
              warehouseLocation!.locationId,
              convertedQty.toFixed(4),
              'purchase_receipt',
              receiptId,
              receiptNo,
              'incoming_inspection:submit',
              `质检入库 IQC#${inspectionId}`,
              dyeLotNo,
              this.userId,
              this.userId,
            ],
          );
        } else {
          const txNo = await generateNo('transaction', this.tenantId);
          const txColumns = [
            'tenant_id',
            'transaction_no',
            'sku_id',
            'transaction_type',
            'direction',
            'warehouse_id',
            'location_id',
            'source_ref',
            'qty_input',
            'input_unit',
            'qty_stock_unit',
            'stock_unit',
            'reference_type',
            'reference_id',
            'reference_no',
            'notes',
            'dye_lot_no',
            'created_by',
            'updated_by',
          ];
          const txValues = [
            this.tenantId,
            txNo,
            item.sku_id,
            'PURCHASE_IN',
            'IN',
            warehouseLocation!.warehouseId,
            warehouseLocation!.locationId,
            'incoming_inspection:submit',
            acceptedStockQtyRaw ? convertedQty.toFixed(4) : qtyPassed.toString(),
            acceptedStockQtyRaw ? stockUnit : purchaseUnit,
            convertedQty.toFixed(4),
            stockUnit,
            'purchase_receipt',
            receiptId,
            receiptNo,
            `质检入库 IQC#${inspectionId}`,
            dyeLotNo,
            this.userId,
            this.userId,
          ];
          txResult = await manager.query(
            `INSERT INTO inventory_transactions
               (${txColumns.join(', ')})
             VALUES (${txColumns.map(() => '?').join(', ')})`,
            txValues,
          );
        }
        void txResult;

        if (supportsInventoryUpdatedBy) {
          await manager.query(
            `INSERT INTO inventory
               (tenant_id, sku_id, warehouse_id, location_id, source_ref, qty_on_hand, qty_reserved, qty_in_transit, updated_by)
             VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?)
             ON DUPLICATE KEY UPDATE
               qty_on_hand = qty_on_hand + VALUES(qty_on_hand),
               qty_in_transit = GREATEST(qty_in_transit - VALUES(qty_on_hand), 0),
               warehouse_id = VALUES(warehouse_id),
               location_id = VALUES(location_id),
               source_ref = VALUES(source_ref),
               updated_by = VALUES(updated_by)`,
            [
              this.tenantId,
              item.sku_id,
              warehouseLocation!.warehouseId,
              warehouseLocation!.locationId,
              'incoming_inspection:submit',
              convertedQty.toFixed(4),
              this.userId,
            ],
          );
        } else {
          await manager.query(
            `INSERT INTO inventory
               (tenant_id, sku_id, warehouse_id, location_id, source_ref, qty_on_hand, qty_reserved, qty_in_transit, last_in_at)
             VALUES (?, ?, ?, ?, ?, ?, 0, 0, NOW(3))
             ON DUPLICATE KEY UPDATE
               qty_on_hand = qty_on_hand + VALUES(qty_on_hand),
               qty_in_transit = GREATEST(qty_in_transit - VALUES(qty_on_hand), 0),
               warehouse_id = VALUES(warehouse_id),
               location_id = VALUES(location_id),
               source_ref = VALUES(source_ref),
               last_in_at = NOW(3)`,
            [
              this.tenantId,
              item.sku_id,
              warehouseLocation!.warehouseId,
              warehouseLocation!.locationId,
              'incoming_inspection:submit',
              convertedQty.toFixed(4),
            ],
          );
        }
        await this.syncDailySnapshot(manager, item.sku_id);

        if (hasDyeLot && dyeLotNo) {
          await manager.query(
            `INSERT INTO inventory_dye_lots
               (tenant_id, sku_id, dye_lot_no, qty_on_hand, qty_reserved, first_in_at, last_in_at)
             VALUES (?, ?, ?, ?, 0, NOW(3), NOW(3))
             ON DUPLICATE KEY UPDATE
               qty_on_hand = qty_on_hand + VALUES(qty_on_hand),
               last_in_at = NOW(3)`,
            [this.tenantId, item.sku_id, dyeLotNo, convertedQty.toFixed(4)],
          );
        }
      } else {
        await manager.query(
          `UPDATE inventory
           SET qty_in_transit = GREATEST(qty_in_transit - ?, 0),
               updated_at = NOW()
           WHERE tenant_id = ? AND sku_id = ?`,
          [convertedQty.toFixed(4), this.tenantId, item.sku_id],
        );
      }

      // 更新 purchase_order_items.qty_received 和 qty_passed
      if (item.po_item_id) {
        const [poItem] = await manager.query<Array<{ production_operation_id: number | null }>>(
          `SELECT production_operation_id
           FROM purchase_order_items
           WHERE id = ? AND tenant_id = ?
           LIMIT 1`,
          [item.po_item_id, this.tenantId],
        );
        await manager.query(
          `UPDATE purchase_order_items
           SET qty_received = qty_received + ?,
               qty_passed = COALESCE(qty_passed, 0) + ?,
               updated_by = ?
           WHERE id = ? AND tenant_id = ?`,
          [
            qtyPassed.toString(),
            qtyPassed.toString(),
            this.userId,
            item.po_item_id,
            this.tenantId,
          ],
        );
        const operationId = Number(poItem?.production_operation_id ?? 0);
        if (Number.isInteger(operationId) && operationId > 0) {
          affectedOperationIds.add(operationId);
        }
      }
    }

    for (const operationId of affectedOperationIds) {
      await this.refreshOutsourceOperationProgress(manager, operationId);
    }

    await recalculatePurchaseOrderStatus({
      manager,
      tenantId: this.tenantId,
      userId: this.userId,
      poId: record.po_id,
    });

    for (const skuId of receivedSkuIds) {
      this.trackInventorySnapshotCacheInvalidation(manager, skuId);
      await this._mrpService().reevaluateAfterReceipt(skuId, manager);
    }

    // 标记幂等位
    await manager.query(
      `UPDATE incoming_inspection_records
       SET receipt_triggered = 1, updated_by = ?
      WHERE id = ? AND tenant_id = ?`,
      [this.userId, inspectionId, this.tenantId],
    );
  }

  private async hasPurchaseOrderItemControlColumns(
    manager: Pick<EntityManager, 'query'>,
  ): Promise<boolean> {
    if (IncomingInspectionService.purchaseOrderItemControlColumnsSupported !== null) {
      return IncomingInspectionService.purchaseOrderItemControlColumnsSupported;
    }

    try {
      const rows = await manager.query<Array<{ cnt: number }>>(
        `SELECT COUNT(*) AS cnt
         FROM information_schema.columns
         WHERE table_schema = DATABASE()
           AND table_name = 'purchase_order_items'
           AND column_name = 'business_class'`,
      );

      IncomingInspectionService.purchaseOrderItemControlColumnsSupported = Number(rows[0]?.cnt ?? 0) > 0;
    } catch {
      IncomingInspectionService.purchaseOrderItemControlColumnsSupported = false;
    }
    return IncomingInspectionService.purchaseOrderItemControlColumnsSupported;
  }

  private async resolveReceiptItemControlConfig(
    manager: EntityManager,
    item: any,
  ): Promise<{
    businessClass: 'production_material' | 'consumable' | 'fixed_asset';
    receiptMode: 'inventory' | 'direct_expense' | 'asset_capitalization';
    requiresAcceptance: boolean;
    requestDepartmentId?: number;
    budgetCode?: string;
  }> {
    if (!(await this.hasPurchaseOrderItemControlColumns(manager))) {
      return {
        businessClass: 'production_material',
        receiptMode: 'inventory',
        requiresAcceptance: false,
        requestDepartmentId: undefined,
        budgetCode: undefined,
      };
    }

    if (item.po_item_id) {
      const [poItem] = await manager.query<Array<{
        business_class: 'production_material' | 'consumable' | 'fixed_asset';
        receipt_mode: 'inventory' | 'direct_expense' | 'asset_capitalization';
        requires_acceptance: number;
        request_department_id: number | null;
        budget_code: string | null;
      }>>(
        `SELECT business_class, receipt_mode, requires_acceptance, request_department_id, budget_code
         FROM purchase_order_items
         WHERE id = ? AND tenant_id = ?
         LIMIT 1`,
        [item.po_item_id, this.tenantId],
      );

      if (poItem) {
        return {
          businessClass: poItem.business_class,
          receiptMode: poItem.receipt_mode,
          requiresAcceptance: Boolean(poItem.requires_acceptance),
          requestDepartmentId: poItem.request_department_id ?? undefined,
          budgetCode: poItem.budget_code ?? undefined,
        };
      }
    }

    const [sku] = await manager.query<Array<{
      business_class: 'production_material' | 'consumable' | 'fixed_asset';
      control_mode: 'mrp' | 'stock_only' | 'direct_expense' | 'asset';
      requires_asset_acceptance: number;
    }>>(
      `SELECT business_class, control_mode, requires_asset_acceptance
       FROM skus
       WHERE id = ? AND tenant_id = ?
       LIMIT 1`,
      [item.sku_id, this.tenantId],
    );

    if (!sku) {
      return {
        businessClass: 'production_material',
        receiptMode: 'inventory',
        requiresAcceptance: false,
        requestDepartmentId: undefined,
        budgetCode: undefined,
      };
    }

    return {
      businessClass: sku.business_class,
      receiptMode: sku.control_mode === 'direct_expense'
        ? 'direct_expense'
        : sku.control_mode === 'asset'
          ? 'asset_capitalization'
          : 'inventory',
      requiresAcceptance: Boolean(sku.requires_asset_acceptance),
      requestDepartmentId: undefined,
      budgetCode: undefined,
    };
  }

  private async refreshOutsourceOperationProgress(
    manager: EntityManager,
    operationId: number,
  ): Promise<void> {
    const [aggregate] = await manager.query<Array<{
      plannedQty: string;
      receivedQty: string;
    }>>(
      `SELECT
          op.planned_qty AS plannedQty,
          COALESCE(
            SUM(
              poi.qty_received * COALESCE(uc.conversion_rate, 1)
            ),
            0
          ) AS receivedQty
       FROM production_operations op
       LEFT JOIN purchase_order_items poi
         ON poi.production_operation_id = op.id
        AND poi.tenant_id = op.tenant_id
       LEFT JOIN sku_unit_conversions uc
         ON uc.tenant_id = poi.tenant_id
        AND uc.sku_id = poi.sku_id
        AND uc.from_unit = poi.purchase_unit
       WHERE op.id = ? AND op.tenant_id = ? AND op.execution_mode = 'outsource'
       GROUP BY op.id, op.planned_qty`,
      [operationId, this.tenantId],
    );

    if (!aggregate) return;

    const plannedQty = new Decimal(aggregate.plannedQty ?? '0');
    const receivedQty = new Decimal(aggregate.receivedQty ?? '0');
    const completedQty = Decimal.min(plannedQty, Decimal.max(receivedQty, 0));
    const nextStatus = completedQty.gte(plannedQty)
      ? 'completed'
      : completedQty.gt(0)
        ? 'in_progress'
        : 'pending';

    await manager.query(
      `UPDATE production_operations
       SET completed_qty = ?, status = ?, updated_by = ?, updated_at = NOW()
       WHERE id = ? AND tenant_id = ?`,
      [
        completedQty.toFixed(4),
        nextStatus,
        this.userId,
        operationId,
        this.tenantId,
      ],
    );
  }

  // 不合格品处理：生成 return_orders + return_order_items
  private async handleFailedItems(
    manager: EntityManager,
    inspectionId: number,
    record: any,
    failedItems: any[],
  ): Promise<void> {
    // 获取供应商 ID
    const [po] = await manager.query(
      `SELECT supplier_id FROM purchase_orders WHERE id = ? AND tenant_id = ? LIMIT 1`,
      [record.po_id, this.tenantId],
    );
    const supportsReturnOrderItemUpdatedBy = await this.hasReturnOrderItemUpdatedByColumn(manager);

    const returnNo = await generateNo('return_order', this.tenantId);

    const totalQty = failedItems.reduce((sum: Decimal, item: any) => {
      return sum.plus(new Decimal(item.qty_failed || '0'));
    }, new Decimal(0));

    const returnResult = await manager.query(
      `INSERT INTO return_orders
         (tenant_id, return_no, return_type, source_po_id, source_inspection_id,
          supplier_id, status, return_reason, total_qty, notes,
          confirmed_at, created_by, updated_by)
       VALUES (?,?,'purchase_return',?,?,?,'confirmed',?,?,?,NOW(),?,?)`,
      [
        this.tenantId,
        returnNo,
        record.po_id,
        inspectionId,
        po?.supplier_id ?? null,
        '质检不合格退货（BD-004）',
        totalQty.toString(),
        null,
        this.userId,
        this.userId,
      ],
    );
    const returnId = Number(returnResult.insertId);

    for (const item of failedItems) {
      const qtyFailed = new Decimal(item.qty_failed || '0');

      await manager.query(
        supportsReturnOrderItemUpdatedBy
          ? `INSERT INTO return_order_items
               (tenant_id, return_id, sku_id, qty_return, purchase_unit,
                unit_price, defect_reason, created_by, updated_by)
             VALUES (?,?,?,?,?,?,?,?,?)`
          : `INSERT INTO return_order_items
               (tenant_id, return_id, sku_id, qty_return, purchase_unit,
                unit_price, defect_reason, created_by)
             VALUES (?,?,?,?,?,?,?,?)`,
        supportsReturnOrderItemUpdatedBy
          ? [
              this.tenantId,
              returnId,
              item.sku_id,
              qtyFailed.toString(),
              item.purchase_unit ?? 'pcs',
              item.unit_price ?? '0.00',
              '质检不合格',
              this.userId,
              this.userId,
            ]
          : [
              this.tenantId,
              returnId,
              item.sku_id,
              qtyFailed.toString(),
              item.purchase_unit ?? 'pcs',
              item.unit_price ?? '0.00',
              '质检不合格',
              this.userId,
            ],
      );

      // 更新 purchase_order_items.qty_rejected
      if (item.po_item_id) {
        await manager.query(
          `UPDATE purchase_order_items
           SET qty_rejected = COALESCE(qty_rejected, 0) + ?,
               updated_by = ?
           WHERE id = ? AND tenant_id = ?`,
          [qtyFailed.toString(), this.userId, item.po_item_id, this.tenantId],
        );
      }
    }

    // 标记幂等位
    await manager.query(
      `UPDATE incoming_inspection_records
       SET return_triggered = 1, updated_by = ?
       WHERE id = ? AND tenant_id = ?`,
      [this.userId, inspectionId, this.tenantId],
    );
  }

  // ── 预览入库单 ───────────────────────────────────────────────
  async previewReceipt(id: number) {
    const [record] = await AppDataSource.query(
      `SELECT r.id, r.inspection_no, r.po_id, r.delivery_note_id,
              r.overall_result, r.status, r.receipt_triggered,
              po.po_no AS poNo,
              sup.name AS supplierName,
              dn.delivery_no AS deliveryNo,
              dn.receipt_id AS receiptId,
              pr.receipt_no AS receiptNo
       FROM incoming_inspection_records r
       LEFT JOIN purchase_orders po ON po.id = r.po_id
       LEFT JOIN suppliers sup ON sup.id = po.supplier_id
       LEFT JOIN delivery_notes dn ON dn.id = r.delivery_note_id
       LEFT JOIN purchase_receipts pr ON pr.id = dn.receipt_id AND pr.tenant_id = r.tenant_id
       WHERE r.id = ? AND r.tenant_id = ? LIMIT 1`,
      [id, this.tenantId],
    );
    if (!record) throw AppError.notFound('质检单不存在', ResponseCode.NOT_FOUND);

    const passedItems = await AppDataSource.query(
      `SELECT ii.sku_id,
              s.sku_code AS skuCode,
              s.name AS skuName,
              ii.dye_lot_no AS dyeLotNo,
              ii.qty_passed,
              poi.purchase_unit,
              poi.unit_price,
              (CAST(ii.qty_passed AS DECIMAL(14,4)) * CAST(poi.unit_price AS DECIMAL(14,4))) AS amount
       FROM incoming_inspection_items ii
       LEFT JOIN skus s ON s.id = ii.sku_id
       LEFT JOIN purchase_order_items poi ON poi.id = ii.po_item_id
       WHERE ii.inspection_id = ? AND ii.tenant_id = ?
         AND CAST(ii.qty_passed AS DECIMAL(14,4)) > 0`,
      [id, this.tenantId],
    );

    const totalAmount = passedItems.reduce((sum: Decimal, item: any) => {
      return sum.plus(new Decimal(item.amount || '0'));
    }, new Decimal(0));

    return {
      ...record,
      items: passedItems,
      totalAmount: totalAmount.toFixed(2),
      receiptTriggered: Boolean(record.receipt_triggered),
    };
  }
}
