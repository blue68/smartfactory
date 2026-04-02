import Decimal from 'decimal.js';
import { AppDataSource } from '../../config/database';
import { TenantContext } from '../../shared/BaseRepository';
import { AppError } from '../../shared/AppError';
import { ResponseCode } from '../../shared/ApiResponse';
import { acquireLock, releaseLock, RedisKeys, RedisTTL, getRedisClient } from '../../config/redis';
import { UnitConverter } from '../../shared/unitConverter';
import { DyeLotAuthorizeService } from './dyeLotAuthorize.service';

// ─── 类型定义 ──────────────────────────────────────────────────

export type TransactionType =
  | 'PURCHASE_IN' | 'PRODUCTION_IN' | 'ADJUSTMENT_IN'
  | 'MATERIAL_OUT' | 'DELIVERY_OUT' | 'ADJUSTMENT_OUT' | 'STOCKTAKE_ADJUST';

export interface InboundParams {
  skuId: number;
  qtyInput: string;
  inputUnit: string;
  transactionType: Extract<TransactionType, 'PURCHASE_IN' | 'PRODUCTION_IN' | 'ADJUSTMENT_IN'>;
  dyeLotNo?: string;
  referenceType?: string;
  referenceId?: number;
  referenceNo?: string;
  batchCost?: string;
  notes?: string;
}

export interface OutboundParams {
  skuId: number;
  qtyInput: string;
  inputUnit: string;
  transactionType: Extract<TransactionType, 'MATERIAL_OUT' | 'DELIVERY_OUT' | 'ADJUSTMENT_OUT'>;
  dyeLotNo?: string;
  productionOrderId?: number;   // 用于缸号一致性校验
  authorizeId?: number;         // 跨色号授权申请ID（RISK-005）
  referenceType?: string;
  referenceId?: number;
  referenceNo?: string;
  notes?: string;
}

export interface DyeLotDetail {
  dyeLotNo: string;
  qtyOnHand: string;
  qtyReserved: string;
  qtyAvailable: string;
  firstInAt: Date;
  lastInAt: Date;
}

export interface InventorySnapshot {
  skuId: number;
  skuCode: string;
  skuName: string;
  qtyOnHand: string;
  qtyReserved: string;
  qtyInTransit: string;
  qtyAvailable: string;
  stockUnit: string;
  safetyStock: string;
  isBelowSafety: boolean;
  hasDyeLot: boolean;
  dyeLots?: DyeLotDetail[];
}

export interface DailyInventorySnapshotRow {
  snapshotDate: string;
  skuId: number;
  skuCode: string;
  skuName: string;
  stockUnit: string;
  qtyOnHand: string;
  qtyReserved: string;
  qtyAvailable: string;
}

export interface RebuildInventorySnapshotParams {
  snapshotDate?: string;
  skuId?: number;
  skuIds?: number[];
  dryRun?: boolean;
}

export interface ReconcileInventoryParams {
  skuId?: number;
  skuIds?: number[];
  dryRun?: boolean;
  includeReserved?: boolean;
  includeInTransit?: boolean;
}

export interface RepairInventoryParams extends ReconcileInventoryParams {
  snapshotDate?: string;
}

export interface DailyInventorySnapshotFilter {
  snapshotDate?: string;
  skuId?: number;
  keyword?: string;
  page: number;
  pageSize: number;
}

export interface InventoryReconcileItem {
  skuId: number;
  currentQtyOnHand: string;
  expectedQtyOnHand: string;
  deltaQtyOnHand: string;
  currentQtyReserved: string;
  expectedQtyReserved: string | null;
  deltaQtyReserved: string | null;
  currentQtyInTransit: string;
  expectedQtyInTransit: string | null;
  deltaQtyInTransit: string | null;
}

type InventoryQueryRunner = { query: typeof AppDataSource.query };

interface InventoryScope {
  targetSkuIds: number[];
  hasSkuFilter: boolean;
  whereSql: string;
  whereParams: unknown[];
}

type InventoryTrackedQueryRunner = InventoryQueryRunner & {
  __inventorySnapshotSkuIds?: Set<number>;
};

// ─── Inventory Service ─────────────────────────────────────────

export class InventoryService {
  private readonly tenantId: number;
  private readonly userId: number;
  private readonly roles: string[];

  constructor(ctx: TenantContext & { roles?: string[] }) {
    this.tenantId = ctx.tenantId;
    this.userId   = ctx.userId;
    this.roles    = ctx.roles ?? [];
  }

  private buildInventoryScope(params: { skuId?: number; skuIds?: number[] }): InventoryScope {
    const normalizedSkuIds = params.skuIds
      ? Array.from(new Set(params.skuIds)).sort((a, b) => a - b)
      : [];

    if (params.skuId && normalizedSkuIds.length > 0) {
      throw AppError.badRequest('skuId 和 skuIds 不能同时传入');
    }

    const targetSkuIds = params.skuId
      ? [params.skuId]
      : normalizedSkuIds;
    const hasSkuFilter = targetSkuIds.length > 0;
    const singleSku = targetSkuIds.length === 1;
    const skuPlaceholders = targetSkuIds.map(() => '?').join(', ');
    const whereSql = !hasSkuFilter
      ? 'tenant_id = ?'
      : singleSku
        ? 'tenant_id = ? AND sku_id = ?'
        : `tenant_id = ? AND sku_id IN (${skuPlaceholders})`;
    const whereParams = !hasSkuFilter
      ? [this.tenantId]
      : singleSku
        ? [this.tenantId, targetSkuIds[0]]
        : [this.tenantId, ...targetSkuIds];

    return {
      targetSkuIds,
      hasSkuFilter,
      whereSql,
      whereParams,
    };
  }

  // ── 库存总览（支持分类、关键字筛选） ─────────────────────

  async listInventory(params: {
    category1Id?: number;
    category2Id?: number;
    keyword?: string;
    belowSafety?: boolean;
    page: number;
    pageSize: number;
  }): Promise<{ list: InventorySnapshot[]; total: number }> {
    const conditions = ['s.tenant_id = ?'];
    const qParams: unknown[] = [this.tenantId];

    if (params.category1Id) { conditions.push('s.category1_id = ?'); qParams.push(params.category1Id); }
    if (params.category2Id) { conditions.push('s.category2_id = ?'); qParams.push(params.category2Id); }
    if (params.keyword) {
      conditions.push('(s.name LIKE ? OR s.sku_code LIKE ?)');
      qParams.push(`%${params.keyword}%`, `%${params.keyword}%`);
    }
    if (params.belowSafety) {
      conditions.push('(inv.qty_on_hand - inv.qty_reserved) < s.safety_stock');
    }

    const where = conditions.join(' AND ');
    const offset = (params.page - 1) * params.pageSize;

    const [rows, countRows] = await Promise.all([
      AppDataSource.query<any[]>(
        `SELECT s.id AS skuId, s.sku_code AS skuCode, s.name AS skuName,
                s.stock_unit AS stockUnit, s.safety_stock AS safetyStock, s.has_dye_lot AS hasDyeLot,
                COALESCE(inv.qty_on_hand, 0) AS qtyOnHand,
                COALESCE(inv.qty_reserved, 0) AS qtyReserved,
                COALESCE(inv.qty_in_transit, 0) AS qtyInTransit
         FROM skus s
         LEFT JOIN inventory inv ON inv.sku_id = s.id AND inv.tenant_id = s.tenant_id
         WHERE ${where}
         ORDER BY
           (COALESCE(inv.qty_on_hand, 0) + COALESCE(inv.qty_reserved, 0) + COALESCE(inv.qty_in_transit, 0)) DESC,
           s.id ASC
         LIMIT ? OFFSET ?`,
        [...qParams, params.pageSize, offset],
      ),
      AppDataSource.query<Array<{ total: number }>>(
        `SELECT COUNT(*) AS total FROM skus s
         LEFT JOIN inventory inv ON inv.sku_id = s.id AND inv.tenant_id = s.tenant_id
         WHERE ${where}`,
        qParams,
      ),
    ]);

    const list = rows.map((r) => ({
      ...r,
      qtyAvailable: new Decimal(r.qtyOnHand).minus(r.qtyReserved).toFixed(4),
      isBelowSafety: new Decimal(r.qtyOnHand).minus(r.qtyReserved).lt(new Decimal(r.safetyStock)),
      hasDyeLot: Boolean(r.hasDyeLot),
    }));

    return { list, total: Number(countRows[0]?.total ?? 0) };
  }

  async listDailySnapshots(params: DailyInventorySnapshotFilter): Promise<{
    list: DailyInventorySnapshotRow[];
    total: number;
    snapshotDate: string;
  }> {
    const snapshotDate = params.snapshotDate ?? new Date().toISOString().slice(0, 10);
    const conditions = ['ids.tenant_id = ?', 'ids.snapshot_date = ?'];
    const qParams: unknown[] = [this.tenantId, snapshotDate];

    if (params.skuId) {
      conditions.push('ids.sku_id = ?');
      qParams.push(params.skuId);
    }
    if (params.keyword) {
      conditions.push('(s.name LIKE ? OR s.sku_code LIKE ?)');
      qParams.push(`%${params.keyword}%`, `%${params.keyword}%`);
    }

    const where = conditions.join(' AND ');
    const offset = (params.page - 1) * params.pageSize;

    const [rows, countRows] = await Promise.all([
      AppDataSource.query<DailyInventorySnapshotRow[]>(
        `SELECT
           DATE_FORMAT(ids.snapshot_date, '%Y-%m-%d') AS snapshotDate,
           ids.sku_id AS skuId,
           s.sku_code AS skuCode,
           s.name AS skuName,
           s.stock_unit AS stockUnit,
           ids.qty_on_hand AS qtyOnHand,
           ids.qty_reserved AS qtyReserved,
           ids.qty_available AS qtyAvailable
         FROM inventory_daily_snapshots ids
         INNER JOIN skus s
           ON s.id = ids.sku_id
          AND s.tenant_id = ids.tenant_id
         WHERE ${where}
         ORDER BY ids.sku_id ASC
         LIMIT ? OFFSET ?`,
        [...qParams, params.pageSize, offset],
      ),
      AppDataSource.query<Array<{ total: string }>>(
        `SELECT COUNT(*) AS total
         FROM inventory_daily_snapshots ids
         INNER JOIN skus s
           ON s.id = ids.sku_id
          AND s.tenant_id = ids.tenant_id
         WHERE ${where}`,
        qParams,
      ),
    ]);

    return {
      list: rows,
      total: Number(countRows[0]?.total ?? 0),
      snapshotDate,
    };
  }

  async listTransactions(
    skuId: number,
    params: {
      page: number;
      pageSize: number;
      dateFrom?: string;
      dateTo?: string;
      keyword?: string;
    },
  ): Promise<{
    skuId: number;
    skuCode: string;
    skuName: string;
    stockUnit: string;
    list: Array<{
      transactionId: number;
      transactionNo: string;
      transactionType: string;
      direction: 'IN' | 'OUT';
      qtyChange: string;
      createdAt: string;
      referenceType: string | null;
      referenceId: number | null;
      referenceNo: string | null;
      taskId: number | null;
      workOrderNo: string | null;
      processStepName: string | null;
      workerName: string | null;
      notes: string | null;
    }>;
    total: number;
  }> {
    const [sku] = await AppDataSource.query<Array<{
      id: number;
      skuCode: string;
      skuName: string;
      stockUnit: string;
    }>>(
      `SELECT id, sku_code AS skuCode, name AS skuName, stock_unit AS stockUnit
       FROM skus
       WHERE tenant_id = ? AND id = ?
       LIMIT 1`,
      [this.tenantId, skuId],
    );

    if (!sku) {
      throw AppError.notFound('SKU 不存在', ResponseCode.SKU_NOT_FOUND);
    }

    const conditions = ['it.tenant_id = ?', 'it.sku_id = ?'];
    const queryParams: unknown[] = [this.tenantId, skuId];

    if (params.dateFrom) {
      conditions.push('DATE(it.created_at) >= ?');
      queryParams.push(params.dateFrom);
    }
    if (params.dateTo) {
      conditions.push('DATE(it.created_at) <= ?');
      queryParams.push(params.dateTo);
    }
    if (params.keyword) {
      conditions.push(`(
        it.transaction_no LIKE ?
        OR COALESCE(it.reference_no, '') LIKE ?
        OR COALESCE(po.work_order_no, '') LIKE ?
        OR COALESCE(pt.task_no, '') LIKE ?
      )`);
      queryParams.push(
        `%${params.keyword}%`,
        `%${params.keyword}%`,
        `%${params.keyword}%`,
        `%${params.keyword}%`,
      );
    }

    const where = conditions.join(' AND ');
    const offset = (params.page - 1) * params.pageSize;

    const listSql = `
      SELECT
        it.id AS transactionId,
        it.transaction_no AS transactionNo,
        it.transaction_type AS transactionType,
        it.direction AS direction,
        CAST(it.qty_stock_unit AS CHAR) AS qtyChange,
        DATE_FORMAT(it.created_at, '%Y-%m-%d %H:%i:%s') AS createdAt,
        it.reference_type AS referenceType,
        it.reference_id AS referenceId,
        it.reference_no AS referenceNo,
        pt.id AS taskId,
        po.work_order_no AS workOrderNo,
        ps.step_name AS processStepName,
        u.real_name AS workerName,
        it.notes AS notes
      FROM inventory_transactions it
      LEFT JOIN task_material_transactions tmt
        ON tmt.inventory_tx_id = it.id
       AND tmt.tenant_id = it.tenant_id
      LEFT JOIN production_tasks pt
        ON pt.id = tmt.task_id
       AND pt.tenant_id = it.tenant_id
      LEFT JOIN production_orders po
        ON po.id = COALESCE(pt.production_order_id, it.production_order_id)
       AND po.tenant_id = it.tenant_id
      LEFT JOIN process_steps ps
        ON ps.id = pt.process_step_id
      LEFT JOIN users u
        ON u.id = pt.worker_id
      WHERE ${where}
      ORDER BY it.created_at DESC, it.id DESC
      LIMIT ? OFFSET ?
    `;

    const countSql = `
      SELECT COUNT(DISTINCT it.id) AS total
      FROM inventory_transactions it
      LEFT JOIN task_material_transactions tmt
        ON tmt.inventory_tx_id = it.id
       AND tmt.tenant_id = it.tenant_id
      LEFT JOIN production_tasks pt
        ON pt.id = tmt.task_id
       AND pt.tenant_id = it.tenant_id
      LEFT JOIN production_orders po
        ON po.id = COALESCE(pt.production_order_id, it.production_order_id)
       AND po.tenant_id = it.tenant_id
      WHERE ${where}
    `;

    const [list, countRows] = await Promise.all([
      AppDataSource.query(listSql, [...queryParams, params.pageSize, offset]),
      AppDataSource.query<Array<{ total: string }>>(countSql, queryParams),
    ]);

    return {
      skuId: sku.id,
      skuCode: sku.skuCode,
      skuName: sku.skuName,
      stockUnit: sku.stockUnit,
      list,
      total: Number(countRows[0]?.total ?? 0),
    };
  }

  // ── 缸号批次详情 ──────────────────────────────────────────

  async getDyeLotDetails(skuId: number): Promise<DyeLotDetail[]> {
    const rows = await AppDataSource.query<any[]>(
      `SELECT dye_lot_no AS dyeLotNo, qty_on_hand AS qtyOnHand,
              qty_reserved AS qtyReserved, first_in_at AS firstInAt, last_in_at AS lastInAt
       FROM inventory_dye_lots
       WHERE tenant_id = ? AND sku_id = ? AND status = 'active'
       ORDER BY first_in_at ASC`,
      [this.tenantId, skuId],
    );

    return rows.map((r) => ({
      ...r,
      qtyAvailable: new Decimal(r.qtyOnHand).minus(r.qtyReserved).toFixed(4),
    }));
  }

  // ── 可用库存查询（供采购/销售模块调用） ─────────────────

  async getAvailableStock(skuId: number): Promise<{
    qtyOnHand: Decimal; qtyReserved: Decimal; qtyAvailable: Decimal; stockUnit: string;
  }> {
    // 尝试从 Redis 缓存读取；Redis 不可用时静默降级到 DB，不影响业务
    try {
      const redis = getRedisClient();
      const cacheKey = RedisKeys.inventorySnapshot(this.tenantId, skuId);
      const cached = await redis.get(cacheKey);
      if (cached) {
        const d = JSON.parse(cached);
        return {
          qtyOnHand: new Decimal(d.qtyOnHand),
          qtyReserved: new Decimal(d.qtyReserved),
          qtyAvailable: new Decimal(d.qtyAvailable),
          stockUnit: d.stockUnit,
        };
      }
    } catch (err) {
      console.warn('[InventoryService] Redis 缓存读取失败，降级到 DB 查询:', (err as Error).message);
    }

    const [row] = await AppDataSource.query<any[]>(
      `SELECT COALESCE(inv.qty_on_hand, 0) AS qtyOnHand,
              COALESCE(inv.qty_reserved, 0) AS qtyReserved,
              s.stock_unit AS stockUnit
       FROM skus s
       LEFT JOIN inventory inv ON inv.sku_id = s.id AND inv.tenant_id = s.tenant_id
       WHERE s.id = ? AND s.tenant_id = ? LIMIT 1`,
      [skuId, this.tenantId],
    );
    if (!row) throw AppError.notFound('SKU不存在');

    const qtyOnHand = new Decimal(row.qtyOnHand);
    const qtyReserved = new Decimal(row.qtyReserved);
    const qtyAvailable = qtyOnHand.minus(qtyReserved);

    // 写缓存失败不影响正常返回
    try {
      const redis = getRedisClient();
      const cacheKey = RedisKeys.inventorySnapshot(this.tenantId, skuId);
      await redis.setex(cacheKey, RedisTTL.INVENTORY, JSON.stringify({
        qtyOnHand: qtyOnHand.toFixed(4),
        qtyReserved: qtyReserved.toFixed(4),
        qtyAvailable: qtyAvailable.toFixed(4),
        stockUnit: row.stockUnit,
      }));
    } catch (err) {
      console.warn('[InventoryService] Redis 缓存写入失败，已忽略:', (err as Error).message);
    }

    return { qtyOnHand, qtyReserved, qtyAvailable, stockUnit: row.stockUnit };
  }

  async rebuildDailySnapshots(params: RebuildInventorySnapshotParams): Promise<{
    snapshotDate: string;
    rebuiltCount: number;
    skuId: number | null;
    skuIds: number[] | null;
    dryRun: boolean;
  }> {
    let trackedInventoryManager: InventoryTrackedQueryRunner | null = null;
    const result = await AppDataSource.transaction(async (manager) => {
      trackedInventoryManager = manager as InventoryTrackedQueryRunner;
      return this.rebuildDailySnapshotsInTx(manager, params);
    });
    await this.invalidateInventorySnapshotCaches(
      this.consumeTrackedInventorySnapshotSkuIds(trackedInventoryManager),
    );
    return result;
  }

  private async rebuildDailySnapshotsInTx(
    manager: InventoryQueryRunner,
    params: RebuildInventorySnapshotParams,
  ): Promise<{
    snapshotDate: string;
    rebuiltCount: number;
    skuId: number | null;
    skuIds: number[] | null;
    dryRun: boolean;
  }> {
    const snapshotDate = params.snapshotDate ?? new Date().toISOString().slice(0, 10);
    const { hasSkuFilter, whereSql, whereParams } = this.buildInventoryScope(params);

    const [countRow] = await manager.query<Array<{ cnt: string }>>(
      `SELECT COUNT(*) AS cnt
       FROM inventory
       WHERE ${whereSql}`,
      whereParams,
    );
    const inventoryRows = await manager.query<Array<{ sku_id: number }>>(
      `SELECT sku_id
       FROM inventory
       WHERE ${whereSql}
       ORDER BY sku_id ASC`,
      whereParams,
    );
    const affectedSkuIds = inventoryRows.map((row) => Number(row.sku_id));

    if (!params.dryRun) {
      await manager.query(
        `INSERT INTO inventory_daily_snapshots
           (tenant_id, snapshot_date, sku_id, qty_on_hand, qty_reserved, qty_available)
         SELECT
           tenant_id,
           ?,
           sku_id,
           qty_on_hand,
           qty_reserved,
           qty_on_hand - qty_reserved
         FROM inventory
         WHERE ${whereSql}
         ON DUPLICATE KEY UPDATE
           qty_on_hand = VALUES(qty_on_hand),
           qty_reserved = VALUES(qty_reserved),
           qty_available = VALUES(qty_available)`,
        [snapshotDate, ...whereParams],
      );
      this.trackInventorySnapshotCacheInvalidation(manager, affectedSkuIds);
    }

    return {
      snapshotDate,
      rebuiltCount: Number(countRow?.cnt ?? 0),
      skuId: affectedSkuIds.length === 1 ? affectedSkuIds[0] : null,
      skuIds: hasSkuFilter ? affectedSkuIds : null,
      dryRun: Boolean(params.dryRun),
    };
  }

  async reconcileInventoryBalances(params: ReconcileInventoryParams): Promise<{
    checkedCount: number;
    changedCount: number;
    dryRun: boolean;
    skuId: number | null;
    skuIds: number[] | null;
    items: InventoryReconcileItem[];
  }> {
    let trackedInventoryManager: InventoryTrackedQueryRunner | null = null;
    const result = await AppDataSource.transaction(async (manager) => {
      trackedInventoryManager = manager as InventoryTrackedQueryRunner;
      return this.reconcileInventoryBalancesInTx(manager, params);
    });
    await this.invalidateInventorySnapshotCaches(
      this.consumeTrackedInventorySnapshotSkuIds(trackedInventoryManager),
    );
    return result;
  }

  private async reconcileInventoryBalancesInTx(
    manager: InventoryQueryRunner,
    params: ReconcileInventoryParams,
  ): Promise<{
    checkedCount: number;
    changedCount: number;
    dryRun: boolean;
    skuId: number | null;
    skuIds: number[] | null;
    items: InventoryReconcileItem[];
  }> {
    const { targetSkuIds, hasSkuFilter, whereSql, whereParams } = this.buildInventoryScope(params);
    const singleSku = targetSkuIds.length === 1;
    const skuPlaceholders = targetSkuIds.map(() => '?').join(', ');

    const inventoryRows = await manager.query<Array<{
      sku_id: number;
      qty_on_hand: string;
      qty_reserved: string;
      qty_in_transit: string;
    }>>(
      `SELECT sku_id, qty_on_hand, qty_reserved, qty_in_transit
       FROM inventory
       WHERE ${whereSql}`,
      whereParams,
    );

    const ledgerRows = await manager.query<Array<{
      sku_id: number;
      expected_qty_on_hand: string;
    }>>(
      `SELECT
         sku_id,
         COALESCE(SUM(
           CASE WHEN direction = 'IN' THEN qty_stock_unit ELSE -qty_stock_unit END
         ), 0) AS expected_qty_on_hand
       FROM inventory_transactions
       WHERE ${whereSql}
       GROUP BY sku_id`,
      whereParams,
    );

    const reservedRows = params.includeReserved
      ? await manager.query<Array<{
        sku_id: number;
        expected_qty_reserved: string;
      }>>(
        `SELECT
           mr.sku_id,
           COALESCE(SUM(mr.qty_reserved), 0) AS expected_qty_reserved
         FROM material_requirements mr
         INNER JOIN production_orders po
           ON po.id = mr.production_order_id
          AND po.tenant_id = mr.tenant_id
         WHERE mr.tenant_id = ?
           ${hasSkuFilter
  ? singleSku
    ? 'AND mr.sku_id = ?'
    : `AND mr.sku_id IN (${skuPlaceholders})`
  : ''}
           AND po.status IN ('pending', 'scheduled', 'in_progress')
         GROUP BY mr.sku_id`,
        whereParams,
      )
      : [];

    const inTransitRows = params.includeInTransit
      ? await manager.query<Array<{
        sku_id: number;
        expected_qty_in_transit: string;
      }>>(
        `SELECT
           poi.sku_id,
           COALESCE(SUM(
             GREATEST(poi.qty_ordered - poi.qty_received, 0) *
             COALESCE(uc.conversion_rate, 1)
           ), 0) AS expected_qty_in_transit
         FROM purchase_order_items poi
         INNER JOIN purchase_orders po
           ON po.id = poi.po_id
          AND po.tenant_id = poi.tenant_id
         LEFT JOIN sku_unit_conversions uc
           ON uc.sku_id = poi.sku_id
          AND uc.from_unit = poi.purchase_unit
          AND uc.tenant_id = poi.tenant_id
         WHERE poi.tenant_id = ?
           ${hasSkuFilter
  ? singleSku
    ? 'AND poi.sku_id = ?'
    : `AND poi.sku_id IN (${skuPlaceholders})`
  : ''}
           AND po.status IN ('confirmed', 'partial_received')
         GROUP BY poi.sku_id`,
        whereParams,
      )
      : [];

    const inventoryMap = new Map(
      inventoryRows.map((row) => [Number(row.sku_id), row]),
    );
    const ledgerMap = new Map(
      ledgerRows.map((row) => [Number(row.sku_id), row]),
    );
    const reservedMap = new Map(
      reservedRows.map((row) => [Number(row.sku_id), row]),
    );
    const inTransitMap = new Map(
      inTransitRows.map((row) => [Number(row.sku_id), row]),
    );
    const skuIds = Array.from(new Set([
      ...inventoryMap.keys(),
      ...ledgerMap.keys(),
      ...reservedMap.keys(),
      ...inTransitMap.keys(),
    ])).sort((a, b) => a - b);

    const items: InventoryReconcileItem[] = [];
    const updatedSkuIds: number[] = [];

    for (const skuId of skuIds) {
      const inventoryRow = inventoryMap.get(skuId);
      const ledgerRow = ledgerMap.get(skuId);
      const currentQtyOnHand = new Decimal(inventoryRow?.qty_on_hand ?? '0');
      const currentQtyReserved = new Decimal(inventoryRow?.qty_reserved ?? '0');
      const currentQtyInTransit = new Decimal(inventoryRow?.qty_in_transit ?? '0');
      const expectedQtyOnHand = new Decimal(ledgerRow?.expected_qty_on_hand ?? '0');
      const deltaQtyOnHand = expectedQtyOnHand.minus(currentQtyOnHand);
      const expectedQtyReserved = params.includeReserved
        ? new Decimal(reservedMap.get(skuId)?.expected_qty_reserved ?? '0')
        : null;
      const deltaQtyReserved = expectedQtyReserved
        ? expectedQtyReserved.minus(currentQtyReserved)
        : null;
      const expectedQtyInTransit = params.includeInTransit
        ? new Decimal(inTransitMap.get(skuId)?.expected_qty_in_transit ?? '0')
        : null;
      const deltaQtyInTransit = expectedQtyInTransit
        ? expectedQtyInTransit.minus(currentQtyInTransit)
        : null;
      const hasOnHandDrift = !deltaQtyOnHand.eq(0);
      const hasReservedDrift = deltaQtyReserved ? !deltaQtyReserved.eq(0) : false;
      const hasInTransitDrift = deltaQtyInTransit ? !deltaQtyInTransit.eq(0) : false;

      if (!hasOnHandDrift && !hasReservedDrift && !hasInTransitDrift) continue;

      items.push({
        skuId,
        currentQtyOnHand: currentQtyOnHand.toFixed(4),
        expectedQtyOnHand: expectedQtyOnHand.toFixed(4),
        deltaQtyOnHand: deltaQtyOnHand.toFixed(4),
        currentQtyReserved: currentQtyReserved.toFixed(4),
        expectedQtyReserved: expectedQtyReserved?.toFixed(4) ?? null,
        deltaQtyReserved: deltaQtyReserved?.toFixed(4) ?? null,
        currentQtyInTransit: currentQtyInTransit.toFixed(4),
        expectedQtyInTransit: expectedQtyInTransit?.toFixed(4) ?? null,
        deltaQtyInTransit: deltaQtyInTransit?.toFixed(4) ?? null,
      });

      if (!params.dryRun) {
        await manager.query(
          `INSERT INTO inventory
             (tenant_id, sku_id, qty_on_hand, qty_reserved, qty_in_transit, last_in_at)
           VALUES (?, ?, ?, ?, ?, NOW())
           ON DUPLICATE KEY UPDATE
             qty_on_hand = VALUES(qty_on_hand),
             qty_reserved = VALUES(qty_reserved),
             qty_in_transit = VALUES(qty_in_transit)`,
          [
            this.tenantId,
            skuId,
            expectedQtyOnHand.toFixed(4),
            (expectedQtyReserved ?? currentQtyReserved).toFixed(4),
            (expectedQtyInTransit ?? currentQtyInTransit).toFixed(4),
          ],
        );

        await this.syncDailySnapshot(manager, skuId);
        updatedSkuIds.push(skuId);
      }
    }

    if (!params.dryRun) {
      this.trackInventorySnapshotCacheInvalidation(manager, updatedSkuIds);
    }

    return {
      checkedCount: skuIds.length,
      changedCount: items.length,
      dryRun: params.dryRun ?? true,
      skuId: targetSkuIds.length === 1 ? targetSkuIds[0] : null,
      skuIds: hasSkuFilter ? targetSkuIds : null,
      items,
    };
  }

  async repairInventoryState(params: RepairInventoryParams): Promise<{
    dryRun: boolean;
    reconcile: Awaited<ReturnType<InventoryService['reconcileInventoryBalances']>>;
    snapshots: Awaited<ReturnType<InventoryService['rebuildDailySnapshots']>>;
  }> {
    let trackedInventoryManager: InventoryTrackedQueryRunner | null = null;
    const result = await AppDataSource.transaction(async (manager) => {
      trackedInventoryManager = manager as InventoryTrackedQueryRunner;
      const dryRun = params.dryRun ?? true;
      const reconcile = await this.reconcileInventoryBalancesInTx(manager, {
        skuId: params.skuId,
        skuIds: params.skuIds,
        dryRun,
        includeReserved: params.includeReserved ?? true,
        includeInTransit: params.includeInTransit ?? true,
      });
      const snapshots = await this.rebuildDailySnapshotsInTx(manager, {
        snapshotDate: params.snapshotDate,
        skuId: params.skuId,
        skuIds: params.skuIds,
        dryRun,
      });

      return {
        dryRun,
        reconcile,
        snapshots,
      };
    });
    await this.invalidateInventorySnapshotCaches(
      this.consumeTrackedInventorySnapshotSkuIds(trackedInventoryManager),
    );
    return result;
  }

  private trackInventorySnapshotCacheInvalidation(
    manager: InventoryQueryRunner,
    skuIds: number[],
  ): void {
    if (skuIds.length === 0) return;
    const trackedManager = manager as InventoryTrackedQueryRunner;
    const tracked = (trackedManager.__inventorySnapshotSkuIds ??= new Set<number>());
    for (const skuId of skuIds) {
      tracked.add(Number(skuId));
    }
  }

  private consumeTrackedInventorySnapshotSkuIds(
    manager: InventoryTrackedQueryRunner | null,
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
      console.warn('[InventoryService] 库存修复后的缓存失效失败，已忽略:', (err as Error).message);
    }
  }

  // ── 采购入库 ──────────────────────────────────────────────

  async inbound(params: InboundParams): Promise<{ transactionNo: string; newQtyOnHand: string }> {
    const sku = await this.getSkuInfo(params.skuId);
    let trackedInventoryManager: InventoryTrackedQueryRunner | null = null;

    // 1. 校验面料缸号必填
    if (sku.hasDyeLot && !params.dyeLotNo) {
      throw new AppError('该物料需要填写缸号', ResponseCode.INVENTORY_DYE_LOT_REQUIRED);
    }

    // 2. 单位换算到库存单位
    const conversions = await this.getUnitConversions(params.skuId);
    const converted = UnitConverter.convert(
      params.qtyInput, params.inputUnit, conversions, sku.stockUnit,
    );

    // 3. 尝试获取 Redis 分布式锁
    //    - Redis 可用且锁空闲：正常加锁，事务内再加 DB 行锁（双重保障）
    //    - Redis 可用但锁已被占用：说明同一 SKU 正在操作，拒绝并发请求
    //    - Redis 不可用（抛出异常）：降级到纯 DB 行锁，保证高可用
    const lockKey = RedisKeys.inventoryLock(this.tenantId, params.skuId);
    let lockVal: string | null = null;
    let redisLockAcquired = false;

    try {
      lockVal = await acquireLock(lockKey, 5000);
      if (lockVal === null) {
        // Redis 可用但锁已被持有，说明并发操作同一 SKU，拒绝请求
        throw new AppError('库存操作繁忙，请稍后重试', ResponseCode.INVENTORY_LOCK_FAILED);
      }
      redisLockAcquired = true;
    } catch (err) {
      if (err instanceof AppError) throw err;
      // Redis 不可用（连接断开、超时等），记录告警并降级到 DB 行锁
      console.warn('[InventoryService] Redis 分布式锁不可用，降级到 DB 行锁（入库）:', (err as Error).message);
    }

    let result: { transactionNo: string; newQtyOnHand: string };
    try {
      result = await AppDataSource.transaction(async (manager) => {
        trackedInventoryManager = manager as InventoryTrackedQueryRunner;
        // 4. DB 行锁（入库时锁定 inventory 行）
        //    - Redis 锁可用时：提供跨进程互斥的第一层防护
        //    - Redis 降级时：DB 行锁作为唯一并发控制手段
        //    入库使用 SELECT ... FOR UPDATE 防止并发写冲突
        await manager.query(
          `SELECT id FROM inventory WHERE tenant_id = ? AND sku_id = ? LIMIT 1 FOR UPDATE`,
          [this.tenantId, params.skuId],
        );
        // 注意：若 inventory 行尚不存在（首次入库），INSERT ... ON DUPLICATE KEY UPDATE
        // 本身具有行级 gap lock，可安全处理并发首次入库

        const txNo = this.generateTxNo('IN');

        // 5. 写入库存流水
        await manager.query(
          `INSERT INTO inventory_transactions
             (tenant_id, transaction_no, sku_id, transaction_type, direction,
              qty_input, input_unit, qty_stock_unit, stock_unit, dye_lot_no,
              reference_type, reference_id, reference_no, batch_cost, notes, created_by)
           VALUES (?,?,?,?,?, ?,?,?,?,?, ?,?,?,?,?,?)`,
          [
            this.tenantId, txNo, params.skuId, params.transactionType, 'IN',
            params.qtyInput, params.inputUnit, converted.qty.toFixed(4), sku.stockUnit, params.dyeLotNo ?? null,
            params.referenceType ?? null, params.referenceId ?? null, params.referenceNo ?? null,
            params.batchCost ?? null, params.notes ?? null, this.userId,
          ],
        );

        // 6. 更新库存快照（UPSERT）
        await manager.query(
          `INSERT INTO inventory (tenant_id, sku_id, qty_on_hand, qty_reserved, qty_in_transit, last_in_at)
           VALUES (?, ?, ?, 0, 0, NOW())
           ON DUPLICATE KEY UPDATE
             qty_on_hand = qty_on_hand + VALUES(qty_on_hand),
             last_in_at  = NOW()`,
          [this.tenantId, params.skuId, converted.qty.toFixed(4)],
        );

        await this.syncDailySnapshot(manager, params.skuId);
        this.trackInventorySnapshotCacheInvalidation(manager, [params.skuId]);

        // 7. 更新缸号批次库存（面料类）
        if (params.dyeLotNo) {
          await manager.query(
            `INSERT INTO inventory_dye_lots
               (tenant_id, sku_id, dye_lot_no, qty_on_hand, qty_reserved, first_in_at, last_in_at)
             VALUES (?, ?, ?, ?, 0, NOW(), NOW())
             ON DUPLICATE KEY UPDATE
               qty_on_hand = qty_on_hand + VALUES(qty_on_hand),
               last_in_at  = NOW()`,
            [this.tenantId, params.skuId, params.dyeLotNo, converted.qty.toFixed(4)],
          );
        }

        // 8. 查询更新后的库存数量
        const [updated] = await manager.query<Array<{ qty: string }>>(
          'SELECT qty_on_hand AS qty FROM inventory WHERE tenant_id = ? AND sku_id = ? LIMIT 1',
          [this.tenantId, params.skuId],
        );

        return { transactionNo: txNo, newQtyOnHand: updated?.qty ?? converted.qty.toFixed(4) };
      });
    } finally {
      // 释放 Redis 锁（失败只打警告，不影响结果）
      if (redisLockAcquired && lockVal) {
        await releaseLock(lockKey, lockVal);
      }
    }

    await this.invalidateInventorySnapshotCaches(
      this.consumeTrackedInventorySnapshotSkuIds(trackedInventoryManager),
    );
    this.checkSafetyStockAlert(params.skuId, sku).catch(console.error);
    return result;
  }

  // ── 出库 ──────────────────────────────────────────────────

  async outbound(params: OutboundParams): Promise<{ transactionNo: string; newQtyOnHand: string }> {
    const sku = await this.getSkuInfo(params.skuId);
    let trackedInventoryManager: InventoryTrackedQueryRunner | null = null;

    // 1. 面料缸号必填
    if (sku.hasDyeLot && !params.dyeLotNo) {
      throw new AppError('该物料出库需要指定缸号', ResponseCode.INVENTORY_DYE_LOT_REQUIRED);
    }

    // 2. 生产领料时校验缸号一致性（RISK-005）
    //    - isCrossDyeLot = true 时，默认强制阻断，不允许静默通过
    //    - 若携带有效 authorizeId，则通过授权服务校验，校验通过后记录授权信息到流水
    let isCrossDyeLot = false;
    let crossDyeLotAuthorizeInfo: {
      authorizeUserId: number;
      reason: string;
      decidedAt: Date;
    } | null = null;

    if (sku.hasDyeLot && params.dyeLotNo && params.productionOrderId) {
      isCrossDyeLot = await this.checkDyeLotConsistency(
        params.productionOrderId, params.skuId, params.dyeLotNo,
      );

      if (isCrossDyeLot) {
        // 获取绑定色号（用于错误详情，方便前端展示预警弹窗）
        const boundDyeLotNo = await this.getBoundDyeLotNo(params.productionOrderId, params.skuId);

        if (!params.authorizeId) {
          // 无授权ID → 强制阻断，返回 4004 + 色号对比信息供前端展示弹窗
          throw new AppError(
            '检测到跨色号出库风险，需要主管授权',
            ResponseCode.INVENTORY_CROSS_DYE_LOT,
            400,
            {
              boundDyeLotNo:        boundDyeLotNo ?? '未知',
              requestedDyeLotNo:    params.dyeLotNo,
              skuName:              sku.skuName ?? '',
              productionOrderId:    params.productionOrderId,
              riskLevel:            'high',
            },
          );
        }

        // 有授权ID → 通过授权服务校验，失败仍抛 AppError
        const authSvc = new DyeLotAuthorizeService({
          tenantId: this.tenantId,
          userId:   this.userId,
          roles:    this.roles,
        });
        crossDyeLotAuthorizeInfo = await authSvc.validateForOutbound(
          params.authorizeId,
          params.skuId,
        );
      }
    }

    // 3. 单位换算
    const conversions = await this.getUnitConversions(params.skuId);
    const converted = UnitConverter.convert(
      params.qtyInput, params.inputUnit, conversions, sku.stockUnit,
    );

    // 4. 尝试获取 Redis 分布式锁（策略同入库）
    const lockKey = RedisKeys.inventoryLock(this.tenantId, params.skuId);
    let lockVal: string | null = null;
    let redisLockAcquired = false;

    try {
      lockVal = await acquireLock(lockKey, 5000);
      if (lockVal === null) {
        throw new AppError('库存操作繁忙，请稍后重试', ResponseCode.INVENTORY_LOCK_FAILED);
      }
      redisLockAcquired = true;
    } catch (err) {
      if (err instanceof AppError) throw err;
      console.warn('[InventoryService] Redis 分布式锁不可用，降级到 DB 行锁（出库）:', (err as Error).message);
    }

    let result: { transactionNo: string; newQtyOnHand: string };
    try {
      result = await AppDataSource.transaction(async (manager) => {
        trackedInventoryManager = manager as InventoryTrackedQueryRunner;
        // 5. 检查库存充足性，使用 SELECT ... FOR UPDATE 行锁防止超卖
        //    这是防超卖的最终安全线，无论 Redis 锁是否可用均必须执行
        const [inv] = await manager.query<Array<{ qty_on_hand: string; qty_reserved: string }>>(
          'SELECT qty_on_hand, qty_reserved FROM inventory WHERE tenant_id = ? AND sku_id = ? LIMIT 1 FOR UPDATE',
          [this.tenantId, params.skuId],
        );
        if (!inv) throw new AppError('库存记录不存在', ResponseCode.INVENTORY_INSUFFICIENT);

        const available = new Decimal(inv.qty_on_hand).minus(inv.qty_reserved);
        if (converted.qty.gt(available)) {
          throw new AppError(
            `库存不足：可用 ${available.toFixed(4)} ${sku.stockUnit}，需要 ${converted.qty.toFixed(4)} ${sku.stockUnit}`,
            ResponseCode.INVENTORY_INSUFFICIENT,
          );
        }

        // 6. 面料缸号库存检查
        if (params.dyeLotNo) {
          const [dl] = await manager.query<Array<{ qty_on_hand: string; qty_reserved: string }>>(
            `SELECT qty_on_hand, qty_reserved FROM inventory_dye_lots
             WHERE tenant_id = ? AND sku_id = ? AND dye_lot_no = ? FOR UPDATE`,
            [this.tenantId, params.skuId, params.dyeLotNo],
          );
          if (!dl) throw new AppError(`缸号 ${params.dyeLotNo} 库存不存在`);
          const dlAvailable = new Decimal(dl.qty_on_hand).minus(dl.qty_reserved);
          if (converted.qty.gt(dlAvailable)) {
            throw new AppError(
              `缸号 ${params.dyeLotNo} 可用库存不足：${dlAvailable.toFixed(4)} ${sku.stockUnit}`,
              ResponseCode.INVENTORY_INSUFFICIENT,
            );
          }

          // 扣减缸号库存
          await manager.query(
            `UPDATE inventory_dye_lots
             SET qty_on_hand = qty_on_hand - ?, last_in_at = NOW()
             WHERE tenant_id = ? AND sku_id = ? AND dye_lot_no = ?`,
            [converted.qty.toFixed(4), this.tenantId, params.skuId, params.dyeLotNo],
          );
        }

        const txNo = this.generateTxNo('OUT');

        // 7. 写入流水（含 production_order_id，供溯源链反查该工单领用了哪些物料）
        await manager.query(
          `INSERT INTO inventory_transactions
             (tenant_id, transaction_no, sku_id, transaction_type, direction,
              qty_input, input_unit, qty_stock_unit, stock_unit, dye_lot_no,
              production_order_id, reference_type, reference_id, reference_no,
              is_cross_dye_lot, notes, created_by)
           VALUES (?,?,?,?,?, ?,?,?,?,?, ?,?,?,?,?,?,?)`,
          [
            this.tenantId, txNo, params.skuId, params.transactionType, 'OUT',
            params.qtyInput, params.inputUnit, converted.qty.toFixed(4), sku.stockUnit,
            params.dyeLotNo ?? null,
            params.productionOrderId ?? null,
            params.referenceType ?? null, params.referenceId ?? null, params.referenceNo ?? null,
            isCrossDyeLot ? 1 : 0, params.notes ?? null, this.userId,
          ],
        );

        // 8. 扣减库存快照
        await manager.query(
          'UPDATE inventory SET qty_on_hand = qty_on_hand - ?, last_out_at = NOW() WHERE tenant_id = ? AND sku_id = ?',
          [converted.qty.toFixed(4), this.tenantId, params.skuId],
        );

        await this.syncDailySnapshot(manager, params.skuId);
        this.trackInventorySnapshotCacheInvalidation(manager, [params.skuId]);

        const [updated] = await manager.query<Array<{ qty: string }>>(
          'SELECT qty_on_hand AS qty FROM inventory WHERE tenant_id = ? AND sku_id = ? LIMIT 1',
          [this.tenantId, params.skuId],
        );

        // 9. 若首次领料绑定缸号（生产订单）
        if (params.dyeLotNo && params.productionOrderId && !isCrossDyeLot) {
          await manager.query(
            `INSERT IGNORE INTO order_dye_lot_bindings
               (tenant_id, production_order_id, sku_id, dye_lot_no, bound_at, bound_by)
             VALUES (?, ?, ?, ?, NOW(), ?)`,
            [this.tenantId, params.productionOrderId, params.skuId, params.dyeLotNo, this.userId],
          );
        }

        return { transactionNo: txNo, newQtyOnHand: updated?.qty ?? '0' };
      });
    } finally {
      if (redisLockAcquired && lockVal) {
        await releaseLock(lockKey, lockVal);
      }
    }

    await this.invalidateInventorySnapshotCaches(
      this.consumeTrackedInventorySnapshotSkuIds(trackedInventoryManager),
    );
    return result;
  }

  // ── 先进先出出库推荐（面料类） ────────────────────────────

  async recommendFifoDyeLot(skuId: number, requiredQty: string): Promise<DyeLotDetail[]> {
    const rows = await AppDataSource.query<any[]>(
      `SELECT dye_lot_no AS dyeLotNo, qty_on_hand AS qtyOnHand,
              qty_reserved AS qtyReserved, first_in_at AS firstInAt, last_in_at AS lastInAt
       FROM inventory_dye_lots
       WHERE tenant_id = ? AND sku_id = ? AND status = 'active'
         AND qty_on_hand - qty_reserved > 0
       ORDER BY first_in_at ASC`,
      [this.tenantId, skuId],
    );

    // 按 FIFO 顺序选取满足数量的缸号
    let remaining = new Decimal(requiredQty);
    const result: DyeLotDetail[] = [];
    for (const r of rows) {
      if (remaining.lte(0)) break;
      result.push({ ...r, qtyAvailable: new Decimal(r.qtyOnHand).minus(r.qtyReserved).toFixed(4) });
      remaining = remaining.minus(new Decimal(r.qtyOnHand).minus(r.qtyReserved));
    }
    return result;
  }

  // ── 私有辅助 ──────────────────────────────────────────────

  private async getSkuInfo(skuId: number): Promise<{
    stockUnit: string; purchaseUnit: string; productionUnit: string; hasDyeLot: boolean; safetyStock: string; skuName: string;
  }> {
    const [sku] = await AppDataSource.query<any[]>(
      `SELECT stock_unit AS stockUnit, purchase_unit AS purchaseUnit,
              production_unit AS productionUnit, has_dye_lot AS hasDyeLot,
              safety_stock AS safetyStock, name AS skuName
       FROM skus WHERE id = ? AND tenant_id = ? LIMIT 1`,
      [skuId, this.tenantId],
    );
    if (!sku) throw AppError.notFound('SKU不存在');
    return { ...sku, hasDyeLot: Boolean(sku.hasDyeLot) };
  }

  /**
   * 获取生产工单绑定的色号（用于跨色号出库警告信息）
   */
  private async getBoundDyeLotNo(productionOrderId: number, skuId: number): Promise<string | null> {
    const [row] = await AppDataSource.query<Array<{ dyeLotNo: string }>>(
      `SELECT dye_lot_no AS dyeLotNo FROM inventory_transactions
       WHERE tenant_id = ? AND production_order_id = ? AND sku_id = ? AND dye_lot_no IS NOT NULL
       ORDER BY created_at ASC LIMIT 1`,
      [this.tenantId, productionOrderId, skuId],
    );
    return row?.dyeLotNo ?? null;
  }

  private async getUnitConversions(skuId: number) {
    return AppDataSource.query<Array<{ fromUnit: string; toUnit: string; conversionRate: string }>>(
      `SELECT from_unit AS fromUnit, to_unit AS toUnit, conversion_rate AS conversionRate
       FROM sku_unit_conversions WHERE tenant_id = ? AND sku_id = ?`,
      [this.tenantId, skuId],
    );
  }

  /**
   * 检查缸号一致性：该生产订单是否已绑定不同缸号
   * @returns true 表示跨缸号（需要警告）
   */
  private async checkDyeLotConsistency(
    productionOrderId: number, skuId: number, dyeLotNo: string,
  ): Promise<boolean> {
    const [binding] = await AppDataSource.query<Array<{ dye_lot_no: string }>>(
      `SELECT dye_lot_no FROM order_dye_lot_bindings
       WHERE production_order_id = ? AND sku_id = ? LIMIT 1`,
      [productionOrderId, skuId],
    );
    if (!binding) return false; // 首次领用，无约束
    return binding.dye_lot_no !== dyeLotNo;
  }

  private async syncDailySnapshot(
    manager: { query: typeof AppDataSource.query },
    skuId: number,
  ): Promise<void> {
    await manager.query(
      `INSERT INTO inventory_daily_snapshots
         (tenant_id, snapshot_date, sku_id, qty_on_hand, qty_reserved, qty_available)
       SELECT
         tenant_id,
         CURDATE(),
         sku_id,
         qty_on_hand,
         qty_reserved,
         qty_on_hand - qty_reserved
       FROM inventory
       WHERE tenant_id = ? AND sku_id = ?
       ON DUPLICATE KEY UPDATE
         qty_on_hand = VALUES(qty_on_hand),
         qty_reserved = VALUES(qty_reserved),
         qty_available = VALUES(qty_available)`,
      [this.tenantId, skuId],
    );
  }

  private generateTxNo(direction: 'IN' | 'OUT'): string {
    const now = new Date();
    const ts = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
      String(now.getHours()).padStart(2, '0'),
      String(now.getMinutes()).padStart(2, '0'),
      String(now.getSeconds()).padStart(2, '0'),
    ].join('');
    const rand = Math.floor(Math.random() * 9999).toString().padStart(4, '0');
    return `${direction}${ts}${rand}`;
  }

  private async checkSafetyStockAlert(
    skuId: number,
    sku: { safetyStock: string; stockUnit: string },
  ): Promise<void> {
    const { qtyAvailable } = await this.getAvailableStock(skuId);
    if (qtyAvailable.lt(new Decimal(sku.safetyStock))) {
      // 检查今日是否已发送过预警（防止消息轰炸）
      const today = new Date().toISOString().slice(0, 10);
      const alertKey = RedisKeys.alertSent(this.tenantId, skuId, today);
      const redis = getRedisClient();
      const alreadySent = await redis.get(alertKey);
      if (!alreadySent) {
        await redis.setex(alertKey, RedisTTL.ALERT_SENT, '1');
        // 将预警推入通知队列（实际实现中对接 Bull 队列）
        console.info(`[InventoryAlert] 租户${this.tenantId} SKU${skuId} 库存低于安全库存`);
      }
    }
  }

  // ── BE-P1-004: 物料损耗录入 ───────────────────────────────

  /**
   * 记录物料损耗：
   * 1. 扣减 inventory.qty_on_hand
   * 2. 插入 inventory_transactions（type = 'waste_out'，direction = 'OUT'）
   * 3. 失效 Redis 库存快照缓存
   *
   * 返回事务编号和损耗后的新库存量。
   */
  async recordWaste(params: {
    skuId: number;
    qty: string;
    reason: string;
    notes?: string;
  }): Promise<{ transactionNo: string; newQtyOnHand: string }> {
    const sku = await this.getSkuInfo(params.skuId);
    let trackedInventoryManager: InventoryTrackedQueryRunner | null = null;

    // 尝试获取 Redis 分布式锁（与入库/出库保持一致策略）
    const lockKey = RedisKeys.inventoryLock(this.tenantId, params.skuId);
    let lockVal: string | null = null;
    let redisLockAcquired = false;

    try {
      lockVal = await acquireLock(lockKey, 5000);
      if (lockVal === null) {
        throw new AppError('库存操作繁忙，请稍后重试', ResponseCode.INVENTORY_LOCK_FAILED);
      }
      redisLockAcquired = true;
    } catch (err) {
      if (err instanceof AppError) throw err;
      console.warn('[InventoryService] Redis 分布式锁不可用，降级到 DB 行锁（损耗录入）:', (err as Error).message);
    }

    const wasteQty = new Decimal(params.qty);

    let result: { transactionNo: string; newQtyOnHand: string };
    try {
      result = await AppDataSource.transaction(async (manager) => {
        trackedInventoryManager = manager as InventoryTrackedQueryRunner;
        // DB 行锁：防止并发超扣
        const [inv] = await manager.query<Array<{ qty_on_hand: string; qty_reserved: string }>>(
          'SELECT qty_on_hand, qty_reserved FROM inventory WHERE tenant_id = ? AND sku_id = ? LIMIT 1 FOR UPDATE',
          [this.tenantId, params.skuId],
        );
        if (!inv) throw new AppError('库存记录不存在', ResponseCode.INVENTORY_INSUFFICIENT);

        const onHand = new Decimal(inv.qty_on_hand);
        if (wasteQty.gt(onHand)) {
          throw new AppError(
            `在库数量不足：在库 ${onHand.toFixed(4)} ${sku.stockUnit}，损耗录入 ${wasteQty.toFixed(4)} ${sku.stockUnit}`,
            ResponseCode.INVENTORY_INSUFFICIENT,
          );
        }

        const txNo = this.generateTxNo('OUT');

        // 插入损耗流水（transaction_type = 'waste_out'）
        await manager.query(
          `INSERT INTO inventory_transactions
             (tenant_id, transaction_no, sku_id, transaction_type, direction,
              qty_input, input_unit, qty_stock_unit, stock_unit,
              notes, created_by)
           VALUES (?,?,?,'waste_out','OUT', ?,?,?,?, ?,?)`,
          [
            this.tenantId, txNo, params.skuId,
            params.qty, sku.stockUnit, wasteQty.toFixed(4), sku.stockUnit,
            params.notes ? `[${params.reason}] ${params.notes}` : params.reason,
            this.userId,
          ],
        );

        // 扣减库存快照
        await manager.query(
          `UPDATE inventory SET qty_on_hand = qty_on_hand - ?, last_out_at = NOW()
           WHERE tenant_id = ? AND sku_id = ?`,
          [wasteQty.toFixed(4), this.tenantId, params.skuId],
        );

        await this.syncDailySnapshot(manager, params.skuId);
        this.trackInventorySnapshotCacheInvalidation(manager, [params.skuId]);

        const [updated] = await manager.query<Array<{ qty: string }>>(
          'SELECT qty_on_hand AS qty FROM inventory WHERE tenant_id = ? AND sku_id = ? LIMIT 1',
          [this.tenantId, params.skuId],
        );

        return { transactionNo: txNo, newQtyOnHand: updated?.qty ?? '0' };
      });
    } finally {
      if (redisLockAcquired && lockVal) {
        await releaseLock(lockKey, lockVal);
      }
    }

    await this.invalidateInventorySnapshotCaches(
      this.consumeTrackedInventorySnapshotSkuIds(trackedInventoryManager),
    );
    this.checkSafetyStockAlert(params.skuId, sku).catch(console.error);
    return result;
  }

  // ── BE-P1-005: 库存汇总（按一级分类聚合） ─────────────────

  async getSummary(): Promise<{
    categories: Array<{
      categoryId: number;
      categoryName: string;
      totalQty: number;
      skuCount: number;
      alertCount: number;
    }>;
    totalSkuCount: number;
    totalAlertCount: number;
  }> {
    const rows = await AppDataSource.query(
      `SELECT
         sc.id AS categoryId, sc.name AS categoryName,
         COUNT(DISTINCT i.sku_id) AS skuCount,
         COALESCE(SUM(i.qty_on_hand), 0) AS totalQty,
         SUM(CASE WHEN i.qty_on_hand - i.qty_reserved < COALESCE(s.safety_stock, 0) THEN 1 ELSE 0 END) AS alertCount
       FROM inventory i
       INNER JOIN skus s ON s.id = i.sku_id AND s.tenant_id = i.tenant_id
       INNER JOIN sku_categories sc ON sc.id = s.category1_id AND sc.level = 1
       WHERE i.tenant_id = ?
       GROUP BY sc.id, sc.name
       ORDER BY sc.id`,
      [this.tenantId],
    );
    const categories = rows.map((r: any) => ({
      categoryId: Number(r.categoryId),
      categoryName: r.categoryName,
      totalQty: Number(r.totalQty),
      skuCount: Number(r.skuCount),
      alertCount: Number(r.alertCount),
    }));
    return {
      categories,
      totalSkuCount: categories.reduce((a: number, c: { skuCount: number }) => a + c.skuCount, 0),
      totalAlertCount: categories.reduce((a: number, c: { alertCount: number }) => a + c.alertCount, 0),
    };
  }

  // ─── BE-P1-003: 库存盘点接口 ──────────────────────────────

  async startStocktake(): Promise<{ stocktakeId: number; stocktakeNo: string }> {
    const no = `ST${Date.now()}`;
    const [result] = await AppDataSource.query(
      `INSERT INTO inventory_stocktakes (tenant_id, stocktake_no, status, created_by)
       VALUES (?, ?, 'in_progress', ?)`,
      [this.tenantId, no, this.userId],
    );
    return { stocktakeId: result.insertId, stocktakeNo: no };
  }

  async submitStocktakeItem(stocktakeId: number, skuId: number, countedQty: string): Promise<void> {
    const [inv] = await AppDataSource.query(
      `SELECT qty_on_hand FROM inventory WHERE tenant_id = ? AND sku_id = ?`,
      [this.tenantId, skuId],
    );
    const systemQty = inv?.qty_on_hand ?? '0';
    const diff = new Decimal(countedQty).minus(systemQty).toFixed(4);
    await AppDataSource.query(
      `INSERT INTO inventory_stocktake_items
         (stocktake_id, tenant_id, sku_id, system_qty, counted_qty, diff_qty)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE counted_qty = VALUES(counted_qty), diff_qty = VALUES(diff_qty)`,
      [stocktakeId, this.tenantId, skuId, systemQty, countedQty, diff],
    );
  }

  async getStocktakeDiff(stocktakeId: number): Promise<Array<{
    skuId: number; skuName: string; systemQty: string; countedQty: string; diffQty: string;
  }>> {
    const rows = await AppDataSource.query(
      `SELECT si.sku_id, s.name AS sku_name, si.system_qty, si.counted_qty, si.diff_qty
       FROM inventory_stocktake_items si
       INNER JOIN skus s ON s.id = si.sku_id
       WHERE si.stocktake_id = ? AND si.tenant_id = ? AND si.diff_qty != 0
       ORDER BY ABS(si.diff_qty) DESC`,
      [stocktakeId, this.tenantId],
    );
    return rows.map((r: Record<string, unknown>) => ({
      skuId: Number(r.sku_id),
      skuName: String(r.sku_name),
      systemQty: String(r.system_qty),
      countedQty: String(r.counted_qty),
      diffQty: String(r.diff_qty),
    }));
  }
}
