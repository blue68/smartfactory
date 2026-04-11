import { AppDataSource } from '../../config/database';
import { TenantContext } from '../../shared/BaseRepository';
import { AppError } from '../../shared/AppError';
import { ResponseCode } from '../../shared/ApiResponse';
import Decimal from 'decimal.js';
import { EntityManager } from 'typeorm';
import { getRedisClient, RedisKeys } from '../../config/redis';
import { PermissionSnapshot } from '../access-control/access-control.types';
import { resolveWarehouseDataScope, type WarehouseDataScope } from '../access-control/warehouse-data-scope';

export interface CreatePOParams {
  supplierId: number;
  suggestionId?: number;
  expectedDate?: string;
  notes?: string;
  items: Array<{
    skuId: number;
    qtyOrdered: string;
    purchaseUnit: string;
    unitPrice: string;
  }>;
}

export interface CreateDeliveryNoteParams {
  poId?: number;
  poNo?: string;
  deliveryDate: string;
  notes?: string;
  items: Array<{
    skuId: number;
    qtyDelivered: string;
    purchaseUnit: string;
    unitPrice: string;
    dyeLotNo?: string | null;
  }>;
}

export interface ClosePOParams {
  reason: string;
}

export interface UpdateReceiptNotesParams {
  notes: string;
}

export interface ListDeliveryNoteParams {
  status?: string;
  poId?: number;
  page: number;
  pageSize: number;
}

export class PurchaseService {
  private readonly tenantId: number;
  private readonly userId: number;
  private readonly permissionSnapshot?: PermissionSnapshot;
  private warehouseDataScopePromise: Promise<WarehouseDataScope> | null = null;
  private static purchaseOrderClosureColumnsSupported: boolean | null = null;
  private static purchaseReceiptDeliveryColumn: 'delivery_note_id' | 'dn_id' | null = null;
  private static purchaseReceiptItemsTableSupported: boolean | null = null;
  private static deliveryNoteItemDyeLotSupported: boolean | null = null;
  private static purchaseReceiptItemDyeLotSupported: boolean | null = null;
  private static incomingInspectionItemDyeLotSupported: boolean | null = null;

  constructor(ctx: TenantContext & { permissionSnapshot?: PermissionSnapshot }) {
    this.tenantId = ctx.tenantId;
    this.userId = ctx.userId;
    this.permissionSnapshot = ctx.permissionSnapshot;
  }

  private async getWarehouseDataScope(): Promise<WarehouseDataScope> {
    this.warehouseDataScopePromise ??= resolveWarehouseDataScope(this.tenantId, this.permissionSnapshot);
    return this.warehouseDataScopePromise;
  }

  private async buildReceiptWarehouseScopeFilter(alias: string): Promise<{ clause: string; params: Array<string | number> }> {
    const warehouseScope = await this.getWarehouseDataScope();
    if (warehouseScope.mode === 'all') {
      return { clause: '1 = 1', params: [] };
    }
    if (warehouseScope.mode === 'none') {
      return { clause: '1 = 0', params: [] };
    }

    return {
      clause: `EXISTS (
        SELECT 1
          FROM inventory_transactions it_scope
         WHERE it_scope.tenant_id = ${alias}.tenant_id
           AND it_scope.reference_type = 'purchase_receipt'
           AND it_scope.reference_id = ${alias}.id
           AND it_scope.warehouse_id IN (${warehouseScope.warehouseIds.map(() => '?').join(',')})
      )`,
      params: warehouseScope.warehouseIds,
    };
  }

  private async buildDeliveryWarehouseScopeFilter(alias: string): Promise<{ clause: string; params: Array<string | number> }> {
    const warehouseScope = await this.getWarehouseDataScope();
    if (warehouseScope.mode === 'all') {
      return { clause: '1 = 1', params: [] };
    }
    if (warehouseScope.mode === 'none') {
      return { clause: `${alias}.receipt_id IS NULL AND 1 = 0`, params: [] };
    }

    return {
      clause: `(
        ${alias}.receipt_id IS NULL
        OR EXISTS (
          SELECT 1
            FROM inventory_transactions it_scope
           WHERE it_scope.tenant_id = ${alias}.tenant_id
             AND it_scope.reference_type = 'purchase_receipt'
             AND it_scope.reference_id = ${alias}.receipt_id
             AND it_scope.warehouse_id IN (${warehouseScope.warehouseIds.map(() => '?').join(',')})
        )
      )`,
      params: warehouseScope.warehouseIds,
    };
  }

  private async assertReceiptAccessible(id: number): Promise<void> {
    const warehouseScopeFilter = await this.buildReceiptWarehouseScopeFilter('pr');
    const [receipt] = await AppDataSource.query<Array<{ id: number }>>(
      `SELECT pr.id
         FROM purchase_receipts pr
        WHERE pr.id = ? AND pr.tenant_id = ?
          AND ${warehouseScopeFilter.clause}
        LIMIT 1`,
      [id, this.tenantId, ...warehouseScopeFilter.params],
    );

    if (!receipt) {
      throw AppError.notFound('采购入库单不存在', ResponseCode.NOT_FOUND);
    }
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
      console.warn('[PurchaseService] 库存缓存失效失败，已忽略:', (err as Error).message);
    }
  }

  private async syncPoInTransitToInventory(
    manager: Pick<EntityManager, 'query'>,
    poId: number,
  ): Promise<void> {
    await manager.query(
      `INSERT INTO inventory (tenant_id, sku_id, qty_on_hand, qty_reserved, qty_in_transit)
       SELECT
         poi.tenant_id,
         poi.sku_id,
         0,
         0,
         COALESCE(SUM(poi.qty_ordered * COALESCE(uc.conversion_rate, 1)), 0)
       FROM purchase_order_items poi
       LEFT JOIN sku_unit_conversions uc
         ON uc.sku_id = poi.sku_id
        AND uc.from_unit = poi.purchase_unit
        AND uc.tenant_id = poi.tenant_id
       WHERE poi.po_id = ? AND poi.tenant_id = ?
       GROUP BY poi.tenant_id, poi.sku_id
       ON DUPLICATE KEY UPDATE
         qty_in_transit = qty_in_transit + VALUES(qty_in_transit)`,
      [poId, this.tenantId],
    );
  }

  private async releasePoInTransitFromInventory(
    manager: Pick<EntityManager, 'query'>,
    poId: number,
  ): Promise<void> {
    await manager.query(
      `UPDATE inventory inv
       INNER JOIN (
         SELECT
           poi.tenant_id,
           poi.sku_id,
           COALESCE(
             SUM(
               GREATEST(poi.qty_ordered - poi.qty_received, 0) *
               COALESCE(uc.conversion_rate, 1)
             ),
             0
           ) AS qty_in_transit_delta
         FROM purchase_order_items poi
         LEFT JOIN sku_unit_conversions uc
           ON uc.sku_id = poi.sku_id
          AND uc.from_unit = poi.purchase_unit
          AND uc.tenant_id = poi.tenant_id
         WHERE poi.po_id = ? AND poi.tenant_id = ?
         GROUP BY poi.tenant_id, poi.sku_id
       ) delta
         ON delta.tenant_id = inv.tenant_id
        AND delta.sku_id = inv.sku_id
       SET inv.qty_in_transit = GREATEST(inv.qty_in_transit - delta.qty_in_transit_delta, 0),
           inv.updated_at = NOW()
       WHERE inv.tenant_id = ?`,
      [poId, this.tenantId, this.tenantId],
    );
  }

  private buildItemGroupKey(row: {
    skuId?: unknown;
    purchaseUnit?: unknown;
    unitPrice?: unknown;
  }): string {
    const normalizedUnitPrice = (() => {
      const rawValue = row.unitPrice;
      if (rawValue === null || rawValue === undefined || rawValue === '') return '';
      try {
        return new Decimal(String(rawValue)).toFixed(4);
      } catch {
        return String(rawValue);
      }
    })();

    return [
      String(row.skuId ?? ''),
      String(row.purchaseUnit ?? ''),
      normalizedUnitPrice,
    ].join('::');
  }

  private normalizeDyeLotNo(value?: unknown): string {
    const normalized = String(value ?? '').trim();
    return normalized || '';
  }

  private buildDeliveryLineGroupKey(row: {
    skuId?: unknown;
    purchaseUnit?: unknown;
    unitPrice?: unknown;
    dyeLotNo?: unknown;
  }): string {
    return [
      this.buildItemGroupKey(row),
      this.normalizeDyeLotNo(row.dyeLotNo),
    ].join('::');
  }

  private sumDecimalValues(...values: Array<unknown>): string {
    return values.reduce<Decimal>(
      (sum, value) => sum.plus(new Decimal(String(value ?? '0'))),
      new Decimal(0),
    ).toFixed(2);
  }

  private aggregateOrderItems(items: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
    const grouped = new Map<string, Record<string, unknown>>();

    for (const item of items) {
      const key = this.buildItemGroupKey(item);
      const existing = grouped.get(key);
      if (!existing) {
        grouped.set(key, { ...item });
        continue;
      }

      existing.qtyOrdered = this.sumDecimalValues(existing.qtyOrdered, item.qtyOrdered);
      existing.qtyReceived = this.sumDecimalValues(existing.qtyReceived, item.qtyReceived);
      existing.gapQty = this.sumDecimalValues(existing.gapQty, item.gapQty);
      existing.amount = this.sumDecimalValues(existing.amount, item.amount);
    }

    return Array.from(grouped.values());
  }

  private buildHistoryGroupKey(row: {
    deliveryId?: unknown;
    receiptId?: unknown;
    skuId?: unknown;
    purchaseUnit?: unknown;
    unitPrice?: unknown;
    dyeLotNo?: unknown;
  }): string {
    return [
      String(row.deliveryId ?? ''),
      String(row.receiptId ?? 'no-receipt'),
      this.buildDeliveryLineGroupKey(row),
    ].join('::');
  }

  private aggregateDeliveryHistory(rows: Array<Record<string, unknown>>): Map<string, Array<Record<string, unknown>>> {
    const groupedByItem = new Map<string, Array<Record<string, unknown>>>();
    const groupedHistory = new Map<string, Record<string, unknown>>();

    for (const row of rows) {
      const itemKey = this.buildItemGroupKey(row);
      const historyKey = this.buildHistoryGroupKey(row);
      const existing = groupedHistory.get(historyKey);

      if (existing) {
        existing.qtyDelivered = this.sumDecimalValues(existing.qtyDelivered, row.qtyDelivered);
        existing.qtyReceived = this.sumDecimalValues(existing.qtyReceived, row.qtyReceived);
        continue;
      }

      const normalized = {
        ...row,
        qtyDelivered: this.sumDecimalValues(row.qtyDelivered),
        qtyReceived: row.qtyReceived == null ? row.qtyReceived : this.sumDecimalValues(row.qtyReceived),
      };
      groupedHistory.set(historyKey, normalized);
      const historyList = groupedByItem.get(itemKey) ?? [];
      historyList.push(normalized);
      groupedByItem.set(itemKey, historyList);
    }

    return groupedByItem;
  }

  private aggregateDeliveryItems(
    items: CreateDeliveryNoteParams['items'],
  ): CreateDeliveryNoteParams['items'] {
    const grouped = new Map<string, CreateDeliveryNoteParams['items'][number]>();

    for (const item of items) {
      const key = this.buildDeliveryLineGroupKey(item);
      const existing = grouped.get(key);
      if (!existing) {
        grouped.set(key, { ...item, dyeLotNo: this.normalizeDyeLotNo(item.dyeLotNo) || undefined });
        continue;
      }

      existing.qtyDelivered = this.sumDecimalValues(existing.qtyDelivered, item.qtyDelivered);
    }

    return Array.from(grouped.values());
  }

  private sumQuantityValues(...values: Array<unknown>): string {
    return values.reduce<Decimal>(
      (sum, value) => sum.plus(new Decimal(String(value ?? '0'))),
      new Decimal(0),
    ).toFixed(4);
  }

  private async hasDeliveryNoteItemDyeLotColumn(): Promise<boolean> {
    if (PurchaseService.deliveryNoteItemDyeLotSupported !== null) {
      return PurchaseService.deliveryNoteItemDyeLotSupported;
    }

    const rows = await AppDataSource.query<Array<{ cnt: number }>>(
      `SELECT COUNT(*) AS cnt
         FROM information_schema.columns
        WHERE table_schema = DATABASE()
          AND table_name = 'delivery_note_items'
          AND column_name = 'dye_lot_no'`,
    );

    PurchaseService.deliveryNoteItemDyeLotSupported = Number(rows[0]?.cnt ?? 0) > 0;
    return PurchaseService.deliveryNoteItemDyeLotSupported;
  }

  private async hasPurchaseReceiptItemDyeLotColumn(): Promise<boolean> {
    if (PurchaseService.purchaseReceiptItemDyeLotSupported !== null) {
      return PurchaseService.purchaseReceiptItemDyeLotSupported;
    }

    const rows = await AppDataSource.query<Array<{ cnt: number }>>(
      `SELECT COUNT(*) AS cnt
         FROM information_schema.columns
        WHERE table_schema = DATABASE()
          AND table_name = 'purchase_receipt_items'
          AND column_name = 'dye_lot_no'`,
    );

    PurchaseService.purchaseReceiptItemDyeLotSupported = Number(rows[0]?.cnt ?? 0) > 0;
    return PurchaseService.purchaseReceiptItemDyeLotSupported;
  }

  private async hasIncomingInspectionItemDyeLotColumn(): Promise<boolean> {
    if (PurchaseService.incomingInspectionItemDyeLotSupported !== null) {
      return PurchaseService.incomingInspectionItemDyeLotSupported;
    }

    const rows = await AppDataSource.query<Array<{ cnt: number }>>(
      `SELECT COUNT(*) AS cnt
         FROM information_schema.columns
        WHERE table_schema = DATABASE()
          AND table_name = 'incoming_inspection_items'
          AND column_name = 'dye_lot_no'`,
    );

    PurchaseService.incomingInspectionItemDyeLotSupported = Number(rows[0]?.cnt ?? 0) > 0;
    return PurchaseService.incomingInspectionItemDyeLotSupported;
  }

  async createPO(params: CreatePOParams): Promise<{ id: number; poNo: string }> {
    const result = await AppDataSource.transaction(async (manager) => {
      const poNo = this.generateNo('PO');
      const totalAmount = params.items.reduce(
        (sum, i) => sum.plus(new Decimal(i.qtyOrdered).mul(i.unitPrice)),
        new Decimal(0),
      );

      const result = await manager.query(
        `INSERT INTO purchase_orders
           (tenant_id, po_no, supplier_id, suggestion_id, status, total_amount,
            expected_date, notes, created_by, updated_by)
         VALUES (?,?,?,?,  'confirmed',?,?,?,?,?)`,
        [
          this.tenantId, poNo, params.supplierId,
          params.suggestionId ?? null, totalAmount.toFixed(2),
          params.expectedDate ?? null, params.notes ?? null,
          this.userId, this.userId,
        ],
      );
      const poId = Number(result.insertId);
      const suggestionOperationMap = new Map<number, number>();

      if (params.suggestionId) {
        const suggestionRows = await manager.query<Array<{
          sku_id: number;
          production_operation_id: number | null;
        }>>(
          `SELECT sku_id, production_operation_id
           FROM purchase_suggestions
           WHERE id = ? AND tenant_id = ? LIMIT 1`,
          [params.suggestionId, this.tenantId],
        );
        const suggestion = suggestionRows[0];
        const operationId = Number(suggestion?.production_operation_id ?? 0);
        if (suggestion && Number.isInteger(operationId) && operationId > 0) {
          suggestionOperationMap.set(Number(suggestion.sku_id), operationId);
        }
      }

      for (const item of params.items) {
        const operationId = suggestionOperationMap.get(Number(item.skuId)) ?? null;
        await manager.query(
          `INSERT INTO purchase_order_items
             (tenant_id, po_id, sku_id, qty_ordered, qty_received, production_operation_id, purchase_unit,
              unit_price, amount, created_by, updated_by)
           VALUES (?,?,?,?,0,?,?,?,?,?,?)`,
          [
            this.tenantId, poId, item.skuId, item.qtyOrdered,
            operationId,
            item.purchaseUnit, item.unitPrice,
            new Decimal(item.qtyOrdered).mul(item.unitPrice).toFixed(2),
            this.userId, this.userId,
          ],
        );
      }

      // 更新关联建议状态为 executed
      if (params.suggestionId) {
        await manager.query(
          `UPDATE purchase_suggestions SET status = 'executed', updated_by = ?
           WHERE id = ? AND tenant_id = ?`,
          [this.userId, params.suggestionId, this.tenantId],
        );
      }

      await this.syncPoInTransitToInventory(manager, poId);

      return { id: poId, poNo };
    });

    await this.invalidateInventorySnapshotCaches(params.items.map((item) => Number(item.skuId)));
    return result;
  }

  async listPOs(params: { status?: string; supplierId?: number; keyword?: string; page: number; pageSize: number }) {
    const conds = ['po.tenant_id = ?'];
    const p: unknown[] = [this.tenantId];
    if (params.status) { conds.push('po.status = ?'); p.push(params.status); }
    if (params.supplierId) { conds.push('po.supplier_id = ?'); p.push(params.supplierId); }
    if (params.keyword?.trim()) {
      conds.push('(po.po_no LIKE ? OR sup.name LIKE ?)');
      p.push(`%${params.keyword.trim()}%`, `%${params.keyword.trim()}%`);
    }

    const where = conds.join(' AND ');
    const offset = (params.page - 1) * params.pageSize;

    const [list, countRows] = await Promise.all([
      AppDataSource.query(
        `SELECT po.*, sup.name AS supplierName
         FROM purchase_orders po
         INNER JOIN suppliers sup ON sup.id = po.supplier_id AND sup.tenant_id = po.tenant_id
         WHERE ${where} ORDER BY po.id DESC LIMIT ? OFFSET ?`,
        [...p, params.pageSize, offset],
      ),
      AppDataSource.query<Array<{ total: number }>>(
        `SELECT COUNT(*) AS total FROM purchase_orders po WHERE ${where}`, p,
      ),
    ]);

    return { list, total: Number(countRows[0]?.total ?? 0) };
  }

  private async resolveDeliveryOrder(params: Pick<CreateDeliveryNoteParams, 'poId' | 'poNo'>): Promise<{
    id: number;
    poNo: string;
    status: string;
  }> {
    if (params.poId) {
      const [row] = await AppDataSource.query<Array<{ id: number; po_no: string; status: string }>>(
        'SELECT id, po_no, status FROM purchase_orders WHERE id = ? AND tenant_id = ? LIMIT 1',
        [params.poId, this.tenantId],
      );
      if (!row) {
        throw AppError.notFound('采购订单不存在', ResponseCode.PO_NOT_FOUND);
      }
      return { id: Number(row.id), poNo: String(row.po_no), status: String(row.status) };
    }

    const normalizedPoNo = String(params.poNo ?? '').trim();
    const [row] = await AppDataSource.query<Array<{ id: number; po_no: string; status: string }>>(
      'SELECT id, po_no, status FROM purchase_orders WHERE po_no = ? AND tenant_id = ? LIMIT 1',
      [normalizedPoNo, this.tenantId],
    );
    if (!row) {
      throw AppError.notFound('采购订单不存在', ResponseCode.PO_NOT_FOUND);
    }
    return { id: Number(row.id), poNo: String(row.po_no), status: String(row.status) };
  }

  async getById(id: number) {
    const receiptDeliveryColumn = await this.getPurchaseReceiptDeliveryColumn();
    const supportsReceiptItemsTable = await this.hasPurchaseReceiptItemsTable();
    const supportsDeliveryItemDyeLot = await this.hasDeliveryNoteItemDyeLotColumn();
    const supportsClosureColumns = await this.hasPurchaseOrderClosureColumns();
    const [order] = supportsClosureColumns
      ? await AppDataSource.query<Array<Record<string, unknown>>>(
          `SELECT
             po.*,
             sup.name AS supplierName,
             closer.username AS closedByName
           FROM purchase_orders po
           INNER JOIN suppliers sup ON sup.id = po.supplier_id AND sup.tenant_id = po.tenant_id
           LEFT JOIN users closer ON closer.id = po.closed_by
           WHERE po.id = ? AND po.tenant_id = ?
           LIMIT 1`,
          [id, this.tenantId],
        )
      : await AppDataSource.query<Array<Record<string, unknown>>>(
          `SELECT
             po.*,
             sup.name AS supplierName,
             NULL AS closedByName
           FROM purchase_orders po
           INNER JOIN suppliers sup ON sup.id = po.supplier_id AND sup.tenant_id = po.tenant_id
           WHERE po.id = ? AND po.tenant_id = ?
           LIMIT 1`,
          [id, this.tenantId],
        );

    if (!order) {
      throw AppError.notFound('采购订单不存在', ResponseCode.PO_NOT_FOUND);
    }

    const [rawItems, deliveries, deliveriesByItem] = await Promise.all([
      AppDataSource.query<Array<Record<string, unknown>>>(
        `SELECT
           poi.id,
           poi.sku_id AS skuId,
           s.sku_code AS skuCode,
           s.name AS skuName,
           s.has_dye_lot AS hasDyeLot,
           poi.qty_ordered AS qtyOrdered,
           poi.qty_received AS qtyReceived,
           GREATEST(poi.qty_ordered - poi.qty_received, 0) AS gapQty,
           poi.purchase_unit AS purchaseUnit,
           poi.unit_price AS unitPrice,
           poi.amount
         FROM purchase_order_items poi
         INNER JOIN skus s ON s.id = poi.sku_id AND s.tenant_id = poi.tenant_id
         WHERE poi.po_id = ? AND poi.tenant_id = ?
         ORDER BY poi.id ASC`,
        [id, this.tenantId],
      ),
      AppDataSource.query<Array<Record<string, unknown>>>(
        `SELECT
           dn.id,
           dn.delivery_no AS deliveryNo,
           dn.delivery_date AS deliveryDate,
           CASE
             WHEN dn.receipt_id IS NOT NULL THEN 'received'
             WHEN dn.inspection_id IS NOT NULL AND ir.status IN ('passed', 'partially_passed', 'failed') THEN 'confirmed'
             ELSE dn.status
           END AS status,
           dn.notes,
           COALESCE(SUM(dni.qty_delivered), 0) AS totalDelivered,
           pr.id AS receiptId,
           pr.receipt_no AS receiptNo,
           pr.status AS receiptStatus,
           COALESCE(pr.received_at, pr.created_at) AS receivedAt
         FROM delivery_notes dn
         LEFT JOIN delivery_note_items dni
           ON dni.delivery_note_id = dn.id AND dni.tenant_id = dn.tenant_id
         LEFT JOIN incoming_inspection_records ir
           ON ir.id = dn.inspection_id AND ir.tenant_id = dn.tenant_id
         LEFT JOIN purchase_receipts pr
           ON pr.${receiptDeliveryColumn} = dn.id AND pr.tenant_id = dn.tenant_id
         WHERE dn.po_id = ? AND dn.tenant_id = ?
         GROUP BY
           dn.id, dn.delivery_no, dn.delivery_date, dn.status, dn.notes,
           pr.id, pr.receipt_no, pr.status, pr.received_at, pr.created_at
         ORDER BY dn.delivery_date DESC, dn.id DESC`,
        [id, this.tenantId],
      ),
      AppDataSource.query<Array<Record<string, unknown>>>(
        supportsReceiptItemsTable
          ? `SELECT
               dni.sku_id AS skuId,
               dn.id AS deliveryId,
               dn.delivery_no AS deliveryNo,
               dn.delivery_date AS deliveryDate,
               ${supportsDeliveryItemDyeLot ? 'dni.dye_lot_no AS dyeLotNo,' : 'NULL AS dyeLotNo,'}
               CASE
                 WHEN dn.receipt_id IS NOT NULL THEN 'received'
                 WHEN dn.inspection_id IS NOT NULL AND ir.status IN ('passed', 'partially_passed', 'failed') THEN 'confirmed'
                 ELSE dn.status
               END AS deliveryStatus,
               dni.qty_delivered AS qtyDelivered,
               dni.purchase_unit AS purchaseUnit,
               dni.unit_price AS unitPrice,
               pr.id AS receiptId,
               pr.receipt_no AS receiptNo,
               pr.status AS receiptStatus,
               pri.qty_received AS qtyReceived,
               COALESCE(pr.received_at, pr.created_at) AS receivedAt
             FROM delivery_notes dn
             INNER JOIN delivery_note_items dni
               ON dni.delivery_note_id = dn.id AND dni.tenant_id = dn.tenant_id
             LEFT JOIN incoming_inspection_records ir
               ON ir.id = dn.inspection_id AND ir.tenant_id = dn.tenant_id
             LEFT JOIN purchase_receipts pr
               ON pr.${receiptDeliveryColumn} = dn.id AND pr.tenant_id = dn.tenant_id
             LEFT JOIN purchase_receipt_items pri
               ON pri.receipt_id = pr.id AND pri.sku_id = dni.sku_id AND pri.tenant_id = dn.tenant_id
             WHERE dn.po_id = ? AND dn.tenant_id = ?
             ORDER BY dn.delivery_date DESC, dn.id DESC, dni.id DESC`
          : `SELECT
               dni.sku_id AS skuId,
               dn.id AS deliveryId,
               dn.delivery_no AS deliveryNo,
               dn.delivery_date AS deliveryDate,
               ${supportsDeliveryItemDyeLot ? 'dni.dye_lot_no AS dyeLotNo,' : 'NULL AS dyeLotNo,'}
               CASE
                 WHEN dn.receipt_id IS NOT NULL THEN 'received'
                 WHEN dn.inspection_id IS NOT NULL AND ir.status IN ('passed', 'partially_passed', 'failed') THEN 'confirmed'
                 ELSE dn.status
               END AS deliveryStatus,
               dni.qty_delivered AS qtyDelivered,
               dni.purchase_unit AS purchaseUnit,
               dni.unit_price AS unitPrice,
               pr.id AS receiptId,
               pr.receipt_no AS receiptNo,
               pr.status AS receiptStatus,
               receipt_qty.qtyReceived AS qtyReceived,
               COALESCE(pr.received_at, pr.created_at) AS receivedAt
             FROM delivery_notes dn
             INNER JOIN delivery_note_items dni
               ON dni.delivery_note_id = dn.id AND dni.tenant_id = dn.tenant_id
             LEFT JOIN incoming_inspection_records ir
               ON ir.id = dn.inspection_id AND ir.tenant_id = dn.tenant_id
             LEFT JOIN purchase_receipts pr
               ON pr.${receiptDeliveryColumn} = dn.id AND pr.tenant_id = dn.tenant_id
             LEFT JOIN (
               SELECT
                 ir.tenant_id AS tenantId,
                 ir.delivery_note_id AS deliveryNoteId,
                 ii.sku_id AS skuId,
                 SUM(ii.qty_passed) AS qtyReceived
               FROM incoming_inspection_records ir
               INNER JOIN incoming_inspection_items ii
                 ON ii.inspection_id = ir.id AND ii.tenant_id = ir.tenant_id
               GROUP BY ir.tenant_id, ir.delivery_note_id, ii.sku_id
             ) receipt_qty
               ON receipt_qty.tenantId = dn.tenant_id
              AND receipt_qty.deliveryNoteId = dn.id
              AND receipt_qty.skuId = dni.sku_id
             WHERE dn.po_id = ? AND dn.tenant_id = ?
             ORDER BY dn.delivery_date DESC, dn.id DESC, dni.id DESC`,
        [id, this.tenantId],
      ),
    ]);

    const items = this.aggregateOrderItems(rawItems);
    const itemHistoryMap = this.aggregateDeliveryHistory(deliveriesByItem);

    return {
      ...order,
      items: items.map((item) => {
        const qtyOrdered = new Decimal(String(item.qtyOrdered ?? '0'));
        const qtyReceived = new Decimal(String(item.qtyReceived ?? '0'));
        return {
          ...item,
          progressPct: qtyOrdered.gt(0)
            ? Number(qtyReceived.div(qtyOrdered).mul(100).toFixed(2))
            : 0,
          deliveryHistory: itemHistoryMap.get(this.buildItemGroupKey(item)) ?? [],
        };
      }),
      deliveries,
    };
  }

  async closeOrder(id: number, params: ClosePOParams): Promise<void> {
    const reason = params.reason.trim();
    if (!reason) {
      throw AppError.badRequest('关闭原因不能为空', ResponseCode.INVALID_PARAMS);
    }

    const supportsClosureColumns = await this.hasPurchaseOrderClosureColumns();
    const affectedSkuIds = await AppDataSource.transaction(async (manager) => {
      const [po] = await manager.query<Array<{ id: number; status: string }>>(
        `SELECT id, status FROM purchase_orders
         WHERE id = ? AND tenant_id = ? LIMIT 1
         FOR UPDATE`,
        [id, this.tenantId],
      );
      if (!po) {
        throw AppError.notFound('采购订单不存在', ResponseCode.PO_NOT_FOUND);
      }
      if (po.status === 'cancelled') {
        throw AppError.conflict('采购订单已关闭，无需重复操作');
      }

      const skuRows = await manager.query<Array<{ sku_id: number }>>(
        `SELECT DISTINCT sku_id
         FROM purchase_order_items
         WHERE po_id = ? AND tenant_id = ?`,
        [id, this.tenantId],
      );

      if (supportsClosureColumns) {
        await manager.query(
          `UPDATE purchase_orders
           SET status = 'cancelled',
               close_reason = ?,
               closed_at = NOW(3),
               closed_by = ?,
               updated_by = ?
           WHERE id = ? AND tenant_id = ?`,
          [reason, this.userId, this.userId, id, this.tenantId],
        );
      } else {
        await manager.query(
          `UPDATE purchase_orders
           SET status = 'cancelled',
               updated_by = ?
           WHERE id = ? AND tenant_id = ?`,
          [this.userId, id, this.tenantId],
        );
      }

      await this.releasePoInTransitFromInventory(manager, id);
      return skuRows.map((row) => Number(row.sku_id));
    });

    await this.invalidateInventorySnapshotCaches(affectedSkuIds);
  }

  async listTailOrders(params: { page: number; pageSize: number }) {
    const offset = (params.page - 1) * params.pageSize;

    const baseSql = `
      FROM purchase_orders po
      INNER JOIN suppliers sup ON sup.id = po.supplier_id AND sup.tenant_id = po.tenant_id
      INNER JOIN purchase_order_items poi ON poi.po_id = po.id AND poi.tenant_id = po.tenant_id
      WHERE po.tenant_id = ?
        AND po.status = 'partial_received'
        AND po.expected_date IS NOT NULL
        AND po.expected_date < CURDATE()
    `;

    const [list, countRows] = await Promise.all([
      AppDataSource.query<Array<Record<string, unknown>>>(
        `SELECT
           po.id,
           po.po_no AS poNo,
           po.expected_date AS expectedDate,
           sup.name AS supplierName,
           po.status,
           po.total_amount AS totalAmount,
           SUM(COALESCE(poi.qty_ordered, 0)) AS totalOrdered,
           SUM(COALESCE(poi.qty_received, 0)) AS totalReceived,
           SUM(GREATEST(COALESCE(poi.qty_ordered, 0) - COALESCE(poi.qty_received, 0), 0)) AS totalGap,
           DATEDIFF(CURDATE(), po.expected_date) AS overdueDays
         ${baseSql}
         GROUP BY po.id, po.po_no, po.expected_date, sup.name, po.status, po.total_amount
         ORDER BY overdueDays DESC, po.expected_date ASC, po.id DESC
         LIMIT ? OFFSET ?`,
        [this.tenantId, params.pageSize, offset],
      ),
      AppDataSource.query<Array<{ total: number }>>(
        `SELECT COUNT(*) AS total
         FROM (
           SELECT po.id
           ${baseSql}
           GROUP BY po.id
         ) t`,
        [this.tenantId],
      ),
    ]);

    return { list, total: Number(countRows[0]?.total ?? 0) };
  }

  async listReceipts(params: { status?: string; poId?: number; page: number; pageSize: number }) {
    const receiptDeliveryColumn = await this.getPurchaseReceiptDeliveryColumn();
    const supportsReceiptItemsTable = await this.hasPurchaseReceiptItemsTable();
    const conds = ['pr.tenant_id = ?'];
    const p: unknown[] = [this.tenantId];
    const warehouseScopeFilter = await this.buildReceiptWarehouseScopeFilter('pr');
    conds.push(warehouseScopeFilter.clause);
    p.push(...warehouseScopeFilter.params);
    if (params.status) { conds.push('pr.status = ?'); p.push(params.status); }
    if (params.poId) { conds.push('pr.po_id = ?'); p.push(params.poId); }

    const where = conds.join(' AND ');
    const offset = (params.page - 1) * params.pageSize;

    const [list, countRows] = await Promise.all([
      AppDataSource.query<Array<Record<string, unknown>>>(
        supportsReceiptItemsTable
          ? `SELECT
               pr.id,
               pr.receipt_no AS receiptNo,
               pr.po_id AS poId,
               po.po_no AS poNo,
               po.status AS poStatus,
               pr.${receiptDeliveryColumn} AS deliveryNoteId,
               dn.delivery_no AS deliveryNo,
               pr.status,
               COALESCE(SUM(pri.amount), 0) AS totalAmount,
               pr.notes,
               COALESCE(pr.received_at, pr.created_at) AS receivedAt,
               sup.name AS supplierName,
               ir.inspection_no AS inspectionNo,
               creator.username AS operatorName,
               COALESCE(SUM(pri.qty_received), 0) AS totalQty
             FROM purchase_receipts pr
             INNER JOIN purchase_orders po ON po.id = pr.po_id AND po.tenant_id = pr.tenant_id
             INNER JOIN suppliers sup ON sup.id = po.supplier_id AND sup.tenant_id = po.tenant_id
             LEFT JOIN delivery_notes dn ON dn.id = pr.${receiptDeliveryColumn} AND dn.tenant_id = pr.tenant_id
             LEFT JOIN incoming_inspection_records ir
               ON ir.delivery_note_id = pr.${receiptDeliveryColumn} AND ir.tenant_id = pr.tenant_id
             LEFT JOIN users creator ON creator.id = pr.created_by AND creator.tenant_id = pr.tenant_id
             LEFT JOIN purchase_receipt_items pri ON pri.receipt_id = pr.id AND pri.tenant_id = pr.tenant_id
             WHERE ${where}
             GROUP BY
               pr.id, pr.receipt_no, pr.po_id, po.po_no, po.status,
               pr.${receiptDeliveryColumn}, dn.delivery_no, pr.status,
               pr.notes, pr.received_at, pr.created_at, sup.name, ir.inspection_no, creator.username
             ORDER BY pr.id DESC
             LIMIT ? OFFSET ?`
          : `SELECT
               pr.id,
               pr.receipt_no AS receiptNo,
               pr.po_id AS poId,
               po.po_no AS poNo,
               po.status AS poStatus,
               pr.${receiptDeliveryColumn} AS deliveryNoteId,
               dn.delivery_no AS deliveryNo,
               pr.status,
               COALESCE(SUM(CAST(ii.qty_passed AS DECIMAL(16,4)) * CAST(COALESCE(poi.unit_price, 0) AS DECIMAL(14,4))), 0) AS totalAmount,
               pr.notes,
               COALESCE(pr.received_at, pr.created_at) AS receivedAt,
               sup.name AS supplierName,
               ir.inspection_no AS inspectionNo,
               creator.username AS operatorName,
               COALESCE(SUM(ii.qty_passed), 0) AS totalQty
             FROM purchase_receipts pr
             INNER JOIN purchase_orders po ON po.id = pr.po_id AND po.tenant_id = pr.tenant_id
             INNER JOIN suppliers sup ON sup.id = po.supplier_id AND sup.tenant_id = po.tenant_id
             LEFT JOIN delivery_notes dn ON dn.id = pr.${receiptDeliveryColumn} AND dn.tenant_id = pr.tenant_id
             LEFT JOIN incoming_inspection_records ir
               ON ir.delivery_note_id = pr.${receiptDeliveryColumn} AND ir.tenant_id = pr.tenant_id
             LEFT JOIN incoming_inspection_items ii
               ON ii.inspection_id = ir.id AND ii.tenant_id = pr.tenant_id
             LEFT JOIN purchase_order_items poi
               ON poi.id = ii.po_item_id AND poi.tenant_id = pr.tenant_id
             LEFT JOIN users creator ON creator.id = pr.created_by AND creator.tenant_id = pr.tenant_id
             WHERE ${where}
             GROUP BY
               pr.id, pr.receipt_no, pr.po_id, po.po_no, po.status,
               pr.${receiptDeliveryColumn}, dn.delivery_no, pr.status,
               pr.notes, pr.received_at, pr.created_at, sup.name, ir.inspection_no, creator.username
             ORDER BY pr.id DESC
             LIMIT ? OFFSET ?`,
        [...p, params.pageSize, offset],
      ),
      AppDataSource.query<Array<{ total: number }>>(
        `SELECT COUNT(*) AS total FROM purchase_receipts pr WHERE ${where}`,
        p,
      ),
    ]);

    return { list, total: Number(countRows[0]?.total ?? 0) };
  }

  async getReceiptById(id: number) {
    const receiptDeliveryColumn = await this.getPurchaseReceiptDeliveryColumn();
    const supportsReceiptItemsTable = await this.hasPurchaseReceiptItemsTable();
    const supportsReceiptItemDyeLot = supportsReceiptItemsTable
      ? await this.hasPurchaseReceiptItemDyeLotColumn()
      : false;
    const supportsInspectionItemDyeLot = supportsReceiptItemsTable
      ? false
      : await this.hasIncomingInspectionItemDyeLotColumn();
    const warehouseScopeFilter = await this.buildReceiptWarehouseScopeFilter('pr');
    const [receipt] = await AppDataSource.query<Array<Record<string, unknown>>>(
      `SELECT
         pr.id,
         pr.receipt_no AS receiptNo,
         pr.po_id AS poId,
         pr.${receiptDeliveryColumn} AS deliveryNoteId,
         pr.status,
         pr.notes,
         COALESCE(pr.received_at, pr.created_at) AS receivedAt,
         po.po_no AS poNo,
         po.status AS poStatus,
         dn.delivery_no AS deliveryNo,
         sup.name AS supplierName,
         ir.inspection_no AS inspectionNo,
         creator.username AS operatorName
       FROM purchase_receipts pr
       INNER JOIN purchase_orders po ON po.id = pr.po_id AND po.tenant_id = pr.tenant_id
       INNER JOIN suppliers sup ON sup.id = po.supplier_id AND sup.tenant_id = po.tenant_id
       LEFT JOIN delivery_notes dn ON dn.id = pr.${receiptDeliveryColumn} AND dn.tenant_id = pr.tenant_id
       LEFT JOIN incoming_inspection_records ir
         ON ir.delivery_note_id = pr.${receiptDeliveryColumn} AND ir.tenant_id = pr.tenant_id
       LEFT JOIN users creator ON creator.id = pr.created_by AND creator.tenant_id = pr.tenant_id
       WHERE pr.id = ? AND pr.tenant_id = ?
         AND ${warehouseScopeFilter.clause}
       LIMIT 1`,
      [id, this.tenantId, ...warehouseScopeFilter.params],
    );

    if (!receipt) {
      throw AppError.notFound('采购入库单不存在', ResponseCode.NOT_FOUND);
    }

    const items = await AppDataSource.query<Array<Record<string, unknown>>>(
      supportsReceiptItemsTable
        ? `SELECT
             pri.id,
             pri.sku_id AS skuId,
             s.sku_code AS skuCode,
             s.name AS skuName,
             ${supportsReceiptItemDyeLot ? 'pri.dye_lot_no AS dyeLotNo,' : 'NULL AS dyeLotNo,'}
             pri.qty_received AS qtyReceived,
             pri.purchase_unit AS purchaseUnit,
             pri.unit_price AS unitPrice,
             pri.amount
           FROM purchase_receipt_items pri
           INNER JOIN skus s ON s.id = pri.sku_id AND s.tenant_id = pri.tenant_id
           WHERE pri.receipt_id = ? AND pri.tenant_id = ?
           ORDER BY pri.id ASC`
        : `SELECT
             MIN(ii.id) AS id,
             ii.sku_id AS skuId,
             s.sku_code AS skuCode,
             s.name AS skuName,
             ${supportsInspectionItemDyeLot ? 'ii.dye_lot_no AS dyeLotNo,' : 'NULL AS dyeLotNo,'}
             SUM(ii.qty_passed) AS qtyReceived,
             MAX(COALESCE(poi.purchase_unit, s.purchase_unit)) AS purchaseUnit,
             MAX(COALESCE(poi.unit_price, 0)) AS unitPrice,
             SUM(CAST(ii.qty_passed AS DECIMAL(16,4)) * CAST(COALESCE(poi.unit_price, 0) AS DECIMAL(14,4))) AS amount
           FROM purchase_receipts pr
           INNER JOIN incoming_inspection_records ir
             ON ir.delivery_note_id = pr.${receiptDeliveryColumn} AND ir.tenant_id = pr.tenant_id
           INNER JOIN incoming_inspection_items ii
             ON ii.inspection_id = ir.id AND ii.tenant_id = pr.tenant_id
           INNER JOIN skus s ON s.id = ii.sku_id AND s.tenant_id = pr.tenant_id
           LEFT JOIN purchase_order_items poi
             ON poi.id = ii.po_item_id AND poi.tenant_id = pr.tenant_id
           WHERE pr.id = ? AND pr.tenant_id = ?
             AND CAST(ii.qty_passed AS DECIMAL(16,4)) > 0
           GROUP BY ii.sku_id, s.sku_code, s.name, ii.dye_lot_no
           ORDER BY MIN(ii.id) ASC`,
      [id, this.tenantId],
    );

    const totalAmount = items.reduce(
      (sum, item) => sum.plus(new Decimal(String(item.amount ?? '0'))),
      new Decimal(0),
    );

    return {
      ...receipt,
      totalAmount: totalAmount.toFixed(2),
      items,
    };
  }

  async listDeliveryNotes(params: ListDeliveryNoteParams) {
    const conds = ['dn.tenant_id = ?'];
    const p: unknown[] = [this.tenantId];
    const warehouseScopeFilter = await this.buildDeliveryWarehouseScopeFilter('dn');
    conds.push(warehouseScopeFilter.clause);
    p.push(...warehouseScopeFilter.params);
    if (params.status) { conds.push('dn.status = ?'); p.push(params.status); }
    if (params.poId) { conds.push('dn.po_id = ?'); p.push(params.poId); }

    const where = conds.join(' AND ');
    const offset = (params.page - 1) * params.pageSize;

    const [list, countRows] = await Promise.all([
      AppDataSource.query<Array<Record<string, unknown>>>(
        `SELECT
           dn.id,
           dn.delivery_no AS deliveryNo,
           dn.po_id AS poId,
           po.po_no AS poNo,
           dn.supplier_id AS supplierId,
           sup.name AS supplierName,
           dn.delivery_date AS deliveryDate,
           CASE
             WHEN dn.receipt_id IS NOT NULL THEN 'received'
             WHEN dn.inspection_id IS NOT NULL AND ir.status IN ('passed', 'partially_passed', 'failed') THEN 'confirmed'
             ELSE dn.status
           END AS status,
           dn.notes,
           dn.inspection_id AS inspectionId,
           ir.inspection_no AS inspectionNo,
           ir.created_at AS inspectionCreatedAt,
           dn.receipt_id AS receiptId,
           pr.receipt_no AS receiptNo,
           tm.id AS matchId,
           tm.match_status AS matchStatus,
           tm.created_at AS matchCreatedAt,
           tm.confirmed_at AS matchConfirmedAt,
           pr.created_at AS receivedAt,
           creator.username AS creatorName,
           COALESCE(SUM(dni.qty_delivered), 0) AS totalDelivered
         FROM delivery_notes dn
         INNER JOIN purchase_orders po ON po.id = dn.po_id AND po.tenant_id = dn.tenant_id
         INNER JOIN suppliers sup ON sup.id = dn.supplier_id AND sup.tenant_id = dn.tenant_id
         LEFT JOIN delivery_note_items dni ON dni.delivery_note_id = dn.id AND dni.tenant_id = dn.tenant_id
         LEFT JOIN incoming_inspection_records ir ON ir.id = dn.inspection_id AND ir.tenant_id = dn.tenant_id
         LEFT JOIN purchase_receipts pr ON pr.id = dn.receipt_id AND pr.tenant_id = dn.tenant_id
         LEFT JOIN three_way_match_records tm
           ON tm.po_id = dn.po_id
          AND tm.delivery_note_id = dn.id
          AND tm.receipt_id = dn.receipt_id
          AND tm.tenant_id = dn.tenant_id
         LEFT JOIN users creator ON creator.id = dn.created_by AND creator.tenant_id = dn.tenant_id
         WHERE ${where}
         GROUP BY
           dn.id, dn.delivery_no, dn.po_id, po.po_no, dn.supplier_id, sup.name,
           dn.delivery_date, dn.status, dn.notes, dn.inspection_id, ir.inspection_no, ir.created_at,
           dn.receipt_id, pr.receipt_no, tm.id, tm.match_status, tm.created_at, tm.confirmed_at,
           pr.created_at, creator.username
         ORDER BY dn.delivery_date DESC, dn.id DESC
         LIMIT ? OFFSET ?`,
        [...p, params.pageSize, offset],
      ),
      AppDataSource.query<Array<{ total: number }>>(
        `SELECT COUNT(*) AS total FROM delivery_notes dn WHERE ${where}`,
        p,
      ),
    ]);

    return { list, total: Number(countRows[0]?.total ?? 0) };
  }

  async listDeliveryNotesByOrderId(poId: number) {
    const { list } = await this.listDeliveryNotes({ poId, page: 1, pageSize: 200 });
    return list;
  }

  async getDeliveryNoteById(id: number) {
    const supportsDeliveryItemDyeLot = await this.hasDeliveryNoteItemDyeLotColumn();
    const warehouseScopeFilter = await this.buildDeliveryWarehouseScopeFilter('dn');
    const [delivery] = await AppDataSource.query<Array<Record<string, unknown>>>(
      `SELECT
         dn.id,
         dn.delivery_no AS deliveryNo,
         dn.po_id AS poId,
         po.po_no AS poNo,
         dn.supplier_id AS supplierId,
         sup.name AS supplierName,
         dn.delivery_date AS deliveryDate,
         CASE
           WHEN dn.receipt_id IS NOT NULL THEN 'received'
           WHEN dn.inspection_id IS NOT NULL AND ir.status IN ('passed', 'partially_passed', 'failed') THEN 'confirmed'
           ELSE dn.status
         END AS status,
         dn.notes,
         dn.inspection_id AS inspectionId,
         ir.inspection_no AS inspectionNo,
         ir.created_at AS inspectionCreatedAt,
         dn.receipt_id AS receiptId,
         pr.receipt_no AS receiptNo,
         tm.id AS matchId,
         tm.match_status AS matchStatus,
         tm.created_at AS matchCreatedAt,
         tm.confirmed_at AS matchConfirmedAt,
         pr.created_at AS receivedAt,
         creator.username AS creatorName,
         dn.created_at AS createdAt
       FROM delivery_notes dn
       INNER JOIN purchase_orders po ON po.id = dn.po_id AND po.tenant_id = dn.tenant_id
       INNER JOIN suppliers sup ON sup.id = dn.supplier_id AND sup.tenant_id = dn.tenant_id
       LEFT JOIN incoming_inspection_records ir ON ir.id = dn.inspection_id AND ir.tenant_id = dn.tenant_id
       LEFT JOIN purchase_receipts pr ON pr.id = dn.receipt_id AND pr.tenant_id = dn.tenant_id
       LEFT JOIN three_way_match_records tm
         ON tm.po_id = dn.po_id
        AND tm.delivery_note_id = dn.id
        AND tm.receipt_id = dn.receipt_id
        AND tm.tenant_id = dn.tenant_id
       LEFT JOIN users creator ON creator.id = dn.created_by AND creator.tenant_id = dn.tenant_id
       WHERE dn.id = ? AND dn.tenant_id = ?
         AND ${warehouseScopeFilter.clause}
       LIMIT 1`,
      [id, this.tenantId, ...warehouseScopeFilter.params],
    );

    if (!delivery) {
      throw AppError.notFound('送货单不存在', ResponseCode.NOT_FOUND);
    }

    const items = await AppDataSource.query<Array<Record<string, unknown>>>(
      `SELECT
         dni.id,
         dni.sku_id AS skuId,
         s.sku_code AS skuCode,
         s.name AS skuName,
         s.has_dye_lot AS hasDyeLot,
         ${supportsDeliveryItemDyeLot ? 'dni.dye_lot_no AS dyeLotNo,' : 'NULL AS dyeLotNo,'}
         dni.qty_delivered AS qtyDelivered,
         dni.purchase_unit AS purchaseUnit,
         dni.unit_price AS unitPrice,
         dni.amount
       FROM delivery_note_items dni
       INNER JOIN skus s ON s.id = dni.sku_id AND s.tenant_id = dni.tenant_id
       WHERE dni.delivery_note_id = ? AND dni.tenant_id = ?
       ORDER BY dni.id ASC`,
      [id, this.tenantId],
    );

    return {
      ...delivery,
      items,
    };
  }

  async updateReceiptNotes(id: number, params: UpdateReceiptNotesParams): Promise<void> {
    const notes = params.notes.trim();
    if (!notes) {
      throw AppError.badRequest('备注不能为空', ResponseCode.INVALID_PARAMS);
    }

    await this.assertReceiptAccessible(id);

    const [receipt] = await AppDataSource.query<Array<{ id: number; createdAt: string | Date }>>(
      `SELECT id, created_at AS createdAt
       FROM purchase_receipts
       WHERE id = ? AND tenant_id = ?
       LIMIT 1`,
      [id, this.tenantId],
    );

    if (!receipt) {
      throw AppError.notFound('采购入库单不存在', ResponseCode.NOT_FOUND);
    }

    const createdAt = new Date(receipt.createdAt);
    if (Number.isNaN(createdAt.getTime())) {
      throw AppError.conflict('入库单创建时间异常，无法更新备注');
    }

    const editDeadline = createdAt.getTime() + 24 * 60 * 60 * 1000;
    if (Date.now() > editDeadline) {
      throw AppError.conflict('入库单创建超过24小时，不能再补充备注');
    }

    await AppDataSource.query(
      `UPDATE purchase_receipts
       SET notes = ?, updated_by = ?
       WHERE id = ? AND tenant_id = ?`,
      [notes, this.userId, id, this.tenantId],
    );
  }

  async createDeliveryNote(params: CreateDeliveryNoteParams): Promise<{ id: number; deliveryNo: string }> {
    const supportsDeliveryItemDyeLot = await this.hasDeliveryNoteItemDyeLotColumn();
    const po = await this.resolveDeliveryOrder(params);
    if (!['confirmed', 'partial_received'].includes(po.status)) {
      throw AppError.badRequest(
        `当前采购订单状态「${po.status}」不允许录入送货单，仅 confirmed / partial_received 可操作`,
      );
    }

    const [rawOrderItems, rawDeliveredItems] = await Promise.all([
      AppDataSource.query<Array<Record<string, unknown>>>(
        `SELECT
           poi.sku_id AS skuId,
           s.has_dye_lot AS hasDyeLot,
           poi.qty_ordered AS qtyOrdered,
           poi.purchase_unit AS purchaseUnit,
           poi.unit_price AS unitPrice
         FROM purchase_order_items poi
         INNER JOIN skus s ON s.id = poi.sku_id AND s.tenant_id = poi.tenant_id
         WHERE poi.po_id = ? AND poi.tenant_id = ?`,
        [po.id, this.tenantId],
      ),
      AppDataSource.query<Array<Record<string, unknown>>>(
        `SELECT
           dni.sku_id AS skuId,
           dni.purchase_unit AS purchaseUnit,
           dni.unit_price AS unitPrice,
           SUM(dni.qty_delivered) AS qtyDelivered
         FROM delivery_notes dn
         INNER JOIN delivery_note_items dni
           ON dni.delivery_note_id = dn.id AND dni.tenant_id = dn.tenant_id
         WHERE dn.po_id = ? AND dn.tenant_id = ? AND dn.status <> 'rejected'
         GROUP BY dni.sku_id, dni.purchase_unit, dni.unit_price`,
        [po.id, this.tenantId],
      ),
    ]);

    const orderItems = this.aggregateOrderItems(
      rawOrderItems.map((item) => ({
        ...item,
        qtyReceived: '0',
        gapQty: item.qtyOrdered,
        amount: '0',
      })),
    );
    const deliveredMap = new Map(
      rawDeliveredItems.map((item) => [this.buildItemGroupKey(item), new Decimal(String(item.qtyDelivered ?? '0'))]),
    );
    const aggregatedItems = this.aggregateDeliveryItems(params.items);
    const orderItemMap = new Map(orderItems.map((item) => [this.buildItemGroupKey(item), item]));
    const requestedQtyMap = new Map<string, Decimal>();
    let hasRemainingDeliverable = false;

    for (const item of orderItems) {
      const key = this.buildItemGroupKey(item);
      const qtyOrdered = new Decimal(String(item.qtyOrdered ?? '0'));
      const qtyDelivered = deliveredMap.get(key) ?? new Decimal(0);
      if (qtyOrdered.minus(qtyDelivered).greaterThan(0)) {
        hasRemainingDeliverable = true;
        break;
      }
    }

    if (!hasRemainingDeliverable) {
      throw AppError.conflict('当前采购订单已完成送货登记，无需重复创建送货单');
    }

    for (const item of aggregatedItems) {
      const key = this.buildItemGroupKey(item);
      const matchingOrderItem = orderItemMap.get(key);
      if (!matchingOrderItem) {
        throw AppError.badRequest('送货明细与采购订单不匹配');
      }

      const requiresDyeLot = Boolean(Number(matchingOrderItem.hasDyeLot ?? 0));
      const normalizedDyeLotNo = this.normalizeDyeLotNo(item.dyeLotNo);
      if (requiresDyeLot && !normalizedDyeLotNo) {
        throw AppError.badRequest(
          `${matchingOrderItem.skuCode ? `物料 ${matchingOrderItem.skuCode}` : `SKU#${item.skuId}`} 需要登记缸号后才能创建送货单`,
        );
      }

      const qtyOrdered = new Decimal(String(matchingOrderItem.qtyOrdered ?? '0'));
      const qtyDelivered = deliveredMap.get(key) ?? new Decimal(0);
      const remainingQty = qtyOrdered.minus(qtyDelivered);
      const requestedQty = (requestedQtyMap.get(key) ?? new Decimal(0))
        .plus(new Decimal(String(item.qtyDelivered ?? '0')));
      requestedQtyMap.set(key, requestedQty);

      if (remainingQty.lte(0)) {
        throw AppError.conflict(
          `${item.skuId ? `SKU#${item.skuId}` : '当前物料'} 已完成送货登记，不能重复录入`,
        );
      }

      if (requestedQty.greaterThan(remainingQty)) {
        throw AppError.conflict(
          `${item.skuId ? `SKU#${item.skuId}` : '当前物料'} 的送货数量不能超过剩余可送货数量 ${this.sumQuantityValues(remainingQty)}`,
        );
      }
    }

    return AppDataSource.transaction(async (manager) => {
      const deliveryNo = this.generateNo('DN');
      const [poRow] = await manager.query<Array<{ supplier_id: number }>>(
        'SELECT supplier_id FROM purchase_orders WHERE id = ? AND tenant_id = ? LIMIT 1',
        [po.id, this.tenantId],
      );

      const result = await manager.query(
        `INSERT INTO delivery_notes
           (tenant_id, delivery_no, po_id, supplier_id, delivery_date, status, notes, created_by, updated_by)
         VALUES (?,?,?,?,?,'pending',?,?,?)`,
        [
          this.tenantId, deliveryNo, po.id, poRow.supplier_id,
          params.deliveryDate, params.notes ?? null, this.userId, this.userId,
        ],
      );
      const dnId = Number(result.insertId);

      for (const item of aggregatedItems) {
        const insertColumns = [
          'tenant_id',
          'delivery_note_id',
          'sku_id',
          ...(supportsDeliveryItemDyeLot ? ['dye_lot_no'] : []),
          'qty_delivered',
          'purchase_unit',
          'unit_price',
          'amount',
          'created_by',
          'updated_by',
        ];
        const insertValues = [
          this.tenantId,
          dnId,
          item.skuId,
          ...(supportsDeliveryItemDyeLot ? [this.normalizeDyeLotNo(item.dyeLotNo) || null] : []),
          item.qtyDelivered,
          item.purchaseUnit,
          item.unitPrice,
          new Decimal(item.qtyDelivered).mul(item.unitPrice).toFixed(2),
          this.userId,
          this.userId,
        ];
        await manager.query(
          `INSERT INTO delivery_note_items
             (${insertColumns.join(', ')})
           VALUES (${insertColumns.map(() => '?').join(',')})`,
          insertValues,
        );
      }

      return { id: dnId, deliveryNo };
    });
  }

  private generateNo(prefix: string): string {
    const ts = Date.now();
    const rand = Math.floor(Math.random() * 999).toString().padStart(3, '0');
    return `${prefix}${ts}${rand}`;
  }

  private async hasPurchaseOrderClosureColumns(): Promise<boolean> {
    if (PurchaseService.purchaseOrderClosureColumnsSupported !== null) {
      return PurchaseService.purchaseOrderClosureColumnsSupported;
    }

    const rows = await AppDataSource.query<Array<{ cnt: number }>>(
      `SELECT COUNT(*) AS cnt
       FROM information_schema.columns
       WHERE table_schema = DATABASE()
         AND table_name = 'purchase_orders'
         AND column_name = 'closed_by'`,
    );

    PurchaseService.purchaseOrderClosureColumnsSupported = Number(rows[0]?.cnt ?? 0) > 0;
    return PurchaseService.purchaseOrderClosureColumnsSupported;
  }

  private async getPurchaseReceiptDeliveryColumn(): Promise<'delivery_note_id' | 'dn_id'> {
    if (PurchaseService.purchaseReceiptDeliveryColumn) {
      return PurchaseService.purchaseReceiptDeliveryColumn;
    }

    const rows = await AppDataSource.query<Array<{ column_name: string }>>(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = DATABASE()
         AND table_name = 'purchase_receipts'
         AND column_name IN ('delivery_note_id', 'dn_id')`,
    );

    const columns = new Set(rows.map((row) => String(row.column_name)));
    PurchaseService.purchaseReceiptDeliveryColumn = columns.has('delivery_note_id')
      ? 'delivery_note_id'
      : 'dn_id';
    return PurchaseService.purchaseReceiptDeliveryColumn;
  }

  private async hasPurchaseReceiptItemsTable(): Promise<boolean> {
    if (PurchaseService.purchaseReceiptItemsTableSupported !== null) {
      return PurchaseService.purchaseReceiptItemsTableSupported;
    }

    const rows = await AppDataSource.query<Array<{ cnt: number }>>(
      `SELECT COUNT(*) AS cnt
       FROM information_schema.tables
       WHERE table_schema = DATABASE()
         AND table_name = 'purchase_receipt_items'`,
    );

    PurchaseService.purchaseReceiptItemsTableSupported = Number(rows[0]?.cnt ?? 0) > 0;
    return PurchaseService.purchaseReceiptItemsTableSupported;
  }
}
