import Decimal from 'decimal.js';
import { AppDataSource } from '../../config/database';
import { TenantContext } from '../../shared/BaseRepository';
import { AppError } from '../../shared/AppError';
import { buildPaginated } from '../../shared/ApiResponse';
import { generateNo } from '../../shared/generateNo';
import { PermissionSnapshot } from '../access-control/access-control.types';
import {
  assertWarehouseInScope,
  resolveWarehouseDataScope,
  type WarehouseDataScope,
} from '../access-control/warehouse-data-scope';
import { resolveWarehouseLocationBinding } from '../inventory/warehouse-location.resolver';
import { UnitConverter } from '../../shared/unitConverter';
import { getRedisClient, RedisKeys } from '../../config/redis';
import { syncInventoryDailySnapshotForSku } from '../inventory/daily-snapshot.util';

export interface ListConsumableIssueParams {
  page: number;
  pageSize: number;
  status?: string;
  departmentId?: number;
  keyword?: string;
}

export interface CreateConsumableIssueParams {
  requestDepartmentId?: number;
  purpose?: string;
  notes?: string;
  items: Array<{
    skuId: number;
    qtyRequested: string;
    issueUnit: string;
    warehouseId?: number;
    locationId?: number;
    dyeLotNo?: string;
    budgetCode?: string;
    notes?: string;
  }>;
}

export interface ApproveConsumableIssueParams {
  approved: boolean;
  notes?: string;
}

export interface ExecuteConsumableIssueParams {
  notes?: string;
}

export interface ListConsumableStockParams {
  page: number;
  pageSize: number;
  warehouseId?: number;
  keyword?: string;
}

export class ConsumableService {
  private readonly tenantId: number;
  private readonly userId: number;
  private readonly permissionSnapshot?: PermissionSnapshot;
  private warehouseDataScopePromise: Promise<WarehouseDataScope> | null = null;
  private static inventoryTransactionBusinessColumnsSupported: boolean | null = null;

  constructor(ctx: TenantContext & { permissionSnapshot?: PermissionSnapshot }) {
    this.tenantId = ctx.tenantId;
    this.userId = ctx.userId;
    this.permissionSnapshot = ctx.permissionSnapshot;
  }

  private async getWarehouseDataScope(): Promise<WarehouseDataScope> {
    this.warehouseDataScopePromise ??= resolveWarehouseDataScope(this.tenantId, this.permissionSnapshot);
    return this.warehouseDataScopePromise;
  }

  private async hasInventoryTransactionBusinessColumns(
    runner: Pick<typeof AppDataSource, 'query'> = AppDataSource,
  ): Promise<boolean> {
    if (ConsumableService.inventoryTransactionBusinessColumnsSupported !== null) {
      return ConsumableService.inventoryTransactionBusinessColumnsSupported;
    }

    const rows = await runner.query<Array<{ cnt: number }>>(
      `SELECT COUNT(*) AS cnt
       FROM information_schema.columns
       WHERE table_schema = DATABASE()
         AND table_name = 'inventory_transactions'
         AND column_name = 'business_class'`,
    );

    ConsumableService.inventoryTransactionBusinessColumnsSupported = Number(rows[0]?.cnt ?? 0) > 0;
    return ConsumableService.inventoryTransactionBusinessColumnsSupported;
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
      console.warn('[ConsumableService] 库存缓存失效失败，已忽略:', (err as Error).message);
    }
  }

  private mergeNotes(...values: Array<unknown>): string | null {
    const merged = values
      .map((value) => String(value ?? '').trim())
      .filter(Boolean)
      .join('\n');
    return merged || null;
  }

  private async getSkuControl(
    runner: Pick<typeof AppDataSource, 'query'>,
    skuId: number,
  ): Promise<{
    skuId: number;
    skuCode: string;
    skuName: string;
    stockUnit: string;
    hasDyeLot: boolean;
    issueDeptRequired: boolean;
  }> {
    const [sku] = await runner.query<Array<{
      skuId: number;
      skuCode: string;
      skuName: string;
      stockUnit: string;
      business_class: string;
      has_dye_lot: number;
      issueDeptRequired: number | null;
    }>>(
      `SELECT
         s.id AS skuId,
         s.sku_code AS skuCode,
         s.name AS skuName,
         s.stock_unit AS stockUnit,
         s.business_class,
         s.has_dye_lot,
         cp.issue_dept_required AS issueDeptRequired
       FROM skus s
       LEFT JOIN sku_consumable_profiles cp
         ON cp.sku_id = s.id AND cp.tenant_id = s.tenant_id
       WHERE s.id = ? AND s.tenant_id = ?
       LIMIT 1`,
      [skuId, this.tenantId],
    );

    if (!sku) {
      throw AppError.notFound(`损耗品 SKU 不存在：${skuId}`);
    }
    if (sku.business_class !== 'consumable') {
      throw AppError.badRequest(`SKU#${skuId} 不是损耗品，不能创建领用单`);
    }

    return {
      skuId: Number(sku.skuId),
      skuCode: String(sku.skuCode),
      skuName: String(sku.skuName),
      stockUnit: String(sku.stockUnit),
      hasDyeLot: Boolean(Number(sku.has_dye_lot ?? 0)),
      issueDeptRequired: Boolean(Number(sku.issueDeptRequired ?? 1)),
    };
  }

  private async getUnitConversions(
    runner: Pick<typeof AppDataSource, 'query'>,
    skuId: number,
  ): Promise<Array<{ fromUnit: string; toUnit: string; conversionRate: string }>> {
    const rows = await runner.query<Array<{
      from_unit: string;
      to_unit: string;
      conversion_rate: string;
    }>>(
      `SELECT from_unit, to_unit, conversion_rate
       FROM sku_unit_conversions
       WHERE tenant_id = ? AND sku_id = ?`,
      [this.tenantId, skuId],
    );

    return rows.map((row) => ({
      fromUnit: row.from_unit,
      toUnit: row.to_unit,
      conversionRate: row.conversion_rate,
    }));
  }

  async listIssueOrders(params: ListConsumableIssueParams) {
    const conds = ['cio.tenant_id = ?'];
    const args: unknown[] = [this.tenantId];
    if (params.status) {
      conds.push('cio.status = ?');
      args.push(params.status);
    }
    if (params.departmentId) {
      conds.push('cio.request_department_id = ?');
      args.push(params.departmentId);
    }
    if (params.keyword?.trim()) {
      const keyword = `%${params.keyword.trim()}%`;
      conds.push('(cio.issue_no LIKE ? OR cio.purpose LIKE ?)');
      args.push(keyword, keyword);
    }

    const where = conds.join(' AND ');
    const offset = (params.page - 1) * params.pageSize;

    const [list, countRows] = await Promise.all([
      AppDataSource.query<Array<Record<string, unknown>>>(
        `SELECT
           cio.id,
           cio.issue_no AS issueNo,
           cio.request_department_id AS requestDepartmentId,
           cio.purpose,
           cio.status,
           cio.notes,
           cio.approved_at AS approvedAt,
           cio.issued_at AS issuedAt,
           cio.created_at AS createdAt,
           COUNT(cii.id) AS itemCount,
           COALESCE(SUM(cii.qty_requested), 0) AS totalQtyRequested,
           COALESCE(SUM(cii.qty_issued), 0) AS totalQtyIssued
         FROM consumable_issue_orders cio
         LEFT JOIN consumable_issue_items cii
           ON cii.issue_order_id = cio.id AND cii.tenant_id = cio.tenant_id
         WHERE ${where}
         GROUP BY
           cio.id, cio.issue_no, cio.request_department_id, cio.purpose, cio.status,
           cio.notes, cio.approved_at, cio.issued_at, cio.created_at
         ORDER BY cio.id DESC
         LIMIT ? OFFSET ?`,
        [...args, params.pageSize, offset],
      ),
      AppDataSource.query<Array<{ total: number }>>(
        `SELECT COUNT(*) AS total
         FROM consumable_issue_orders cio
         WHERE ${where}`,
        args,
      ),
    ]);

    return buildPaginated(list, Number(countRows[0]?.total ?? 0), params.page, params.pageSize);
  }

  async getIssueOrderById(id: number) {
    const [order] = await AppDataSource.query<Array<Record<string, unknown>>>(
      `SELECT
         cio.id,
         cio.issue_no AS issueNo,
         cio.request_department_id AS requestDepartmentId,
         cio.purpose,
         cio.status,
         cio.notes,
         cio.approved_by AS approvedBy,
         cio.approved_at AS approvedAt,
         cio.issued_by AS issuedBy,
         cio.issued_at AS issuedAt,
         cio.created_at AS createdAt,
         cio.updated_at AS updatedAt
       FROM consumable_issue_orders cio
       WHERE cio.id = ? AND cio.tenant_id = ?
       LIMIT 1`,
      [id, this.tenantId],
    );

    if (!order) {
      throw AppError.notFound('损耗品领用单不存在');
    }

    const items = await AppDataSource.query<Array<Record<string, unknown>>>(
      `SELECT
         cii.id,
         cii.sku_id AS skuId,
         s.sku_code AS skuCode,
         s.name AS skuName,
         cii.warehouse_id AS warehouseId,
         cii.location_id AS locationId,
         cii.qty_requested AS qtyRequested,
         cii.qty_issued AS qtyIssued,
         cii.issue_unit AS issueUnit,
         cii.budget_code AS budgetCode,
         cii.notes
       FROM consumable_issue_items cii
       INNER JOIN skus s ON s.id = cii.sku_id AND s.tenant_id = cii.tenant_id
       WHERE cii.issue_order_id = ? AND cii.tenant_id = ?
       ORDER BY cii.id ASC`,
      [id, this.tenantId],
    );

    return { ...order, items };
  }

  async createIssueOrder(params: CreateConsumableIssueParams) {
    const issueNo = await generateNo('consumable_issue', this.tenantId);

    const result = await AppDataSource.transaction(async (manager) => {
      for (const item of params.items) {
        const sku = await this.getSkuControl(manager, item.skuId);
        if (sku.issueDeptRequired && !params.requestDepartmentId) {
          throw AppError.badRequest(`SKU#${item.skuId} 领用时必须指定部门`);
        }
        if (sku.hasDyeLot && !String(item.dyeLotNo ?? '').trim()) {
          throw AppError.badRequest(`SKU#${item.skuId} 启用了缸号管理，领用时必须指定缸号`);
        }
      }

      const orderResult = await manager.query(
        `INSERT INTO consumable_issue_orders
           (tenant_id, issue_no, request_department_id, purpose, status, notes, created_by, updated_by)
         VALUES (?, ?, ?, ?, 'draft', ?, ?, ?)`,
        [
          this.tenantId,
          issueNo,
          params.requestDepartmentId ?? null,
          params.purpose?.trim() || null,
          params.notes?.trim() || null,
          this.userId,
          this.userId,
        ],
      );
      const issueOrderId = Number(orderResult.insertId);

      for (const item of params.items) {
        await manager.query(
          `INSERT INTO consumable_issue_items
             (tenant_id, issue_order_id, sku_id, warehouse_id, location_id, qty_requested, qty_issued, issue_unit, budget_code, notes, created_by, updated_by)
           VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
          [
            this.tenantId,
            issueOrderId,
            item.skuId,
            item.warehouseId ?? null,
            item.locationId ?? null,
            item.qtyRequested,
            item.issueUnit,
            item.budgetCode?.trim() || null,
            this.mergeNotes(item.dyeLotNo ? `dyeLotNo=${item.dyeLotNo.trim()}` : null, item.notes),
            this.userId,
            this.userId,
          ],
        );
      }

      return { id: issueOrderId, issueNo };
    });

    return result;
  }

  async approveIssueOrder(id: number, params: ApproveConsumableIssueParams): Promise<void> {
    await AppDataSource.transaction(async (manager) => {
      const [order] = await manager.query<Array<{ status: string; notes: string | null }>>(
        `SELECT status, notes
         FROM consumable_issue_orders
         WHERE id = ? AND tenant_id = ?
         LIMIT 1
         FOR UPDATE`,
        [id, this.tenantId],
      );

      if (!order) {
        throw AppError.notFound('损耗品领用单不存在');
      }
      if (order.status !== 'draft') {
        throw AppError.conflict(`当前状态「${order.status}」不允许审批`);
      }

      await manager.query(
        `UPDATE consumable_issue_orders
         SET status = ?, approved_by = ?, approved_at = NOW(3), notes = ?, updated_by = ?
         WHERE id = ? AND tenant_id = ?`,
        [
          params.approved ? 'approved' : 'rejected',
          this.userId,
          this.mergeNotes(order.notes, params.notes),
          this.userId,
          id,
          this.tenantId,
        ],
      );
    });
  }

  async executeIssueOrder(id: number, params: ExecuteConsumableIssueParams) {
    const issuedSkuIds: number[] = [];
    const result = await AppDataSource.transaction(async (manager) => {
      const [order] = await manager.query<Array<{
        issue_no: string;
        status: string;
        request_department_id: number | null;
        purpose: string | null;
        notes: string | null;
      }>>(
        `SELECT issue_no, status, request_department_id, purpose, notes
         FROM consumable_issue_orders
         WHERE id = ? AND tenant_id = ?
         LIMIT 1
         FOR UPDATE`,
        [id, this.tenantId],
      );

      if (!order) {
        throw AppError.notFound('损耗品领用单不存在');
      }
      if (order.status !== 'approved') {
        throw AppError.conflict(`当前状态「${order.status}」不允许发放`);
      }

      const items = await manager.query<Array<{
        id: number;
        sku_id: number;
        warehouse_id: number | null;
        location_id: number | null;
        qty_requested: string;
        issue_unit: string;
        budget_code: string | null;
        notes: string | null;
      }>>(
        `SELECT id, sku_id, warehouse_id, location_id, qty_requested, issue_unit, budget_code, notes
         FROM consumable_issue_items
         WHERE issue_order_id = ? AND tenant_id = ?
         ORDER BY id ASC`,
        [id, this.tenantId],
      );

      if (items.length === 0) {
        throw AppError.badRequest('领用单没有可发放明细');
      }

      const supportsBusinessColumns = await this.hasInventoryTransactionBusinessColumns(manager);

      for (const item of items) {
        const sku = await this.getSkuControl(manager, Number(item.sku_id));
        const warehouseLocation = await resolveWarehouseLocationBinding({
          manager,
          tenantId: this.tenantId,
          userId: this.userId,
          warehouseId: item.warehouse_id ?? undefined,
          locationId: item.location_id ?? undefined,
          sourceRef: 'consumable_issue:execute',
        });
        assertWarehouseInScope(await this.getWarehouseDataScope(), warehouseLocation.warehouseId);

        const dyeLotNoMatch = String(item.notes ?? '').match(/(?:^|\n)dyeLotNo=(.+?)(?:\n|$)/);
        const dyeLotNo = dyeLotNoMatch?.[1]?.trim() || null;
        if (sku.hasDyeLot && !dyeLotNo) {
          throw AppError.badRequest(`SKU#${item.sku_id} 启用了缸号管理，发放前必须指定缸号`);
        }

        const conversions = await this.getUnitConversions(manager, Number(item.sku_id));
        const converted = UnitConverter.convert(
          item.qty_requested,
          item.issue_unit,
          conversions,
          sku.stockUnit,
        );

        const [inventory] = await manager.query<Array<{ qty_on_hand: string; qty_reserved: string }>>(
          `SELECT qty_on_hand, qty_reserved
           FROM inventory
           WHERE tenant_id = ? AND sku_id = ? AND warehouse_id = ? AND location_id = ?
           LIMIT 1
           FOR UPDATE`,
          [this.tenantId, item.sku_id, warehouseLocation.warehouseId, warehouseLocation.locationId],
        );

        if (!inventory) {
          throw AppError.badRequest(`SKU#${item.sku_id} 在指定仓库/库位没有库存记录`);
        }

        const available = new Decimal(inventory.qty_on_hand).minus(inventory.qty_reserved);
        if (converted.qty.gt(available)) {
          throw AppError.badRequest(
            `SKU#${item.sku_id} 库存不足：可用 ${available.toFixed(4)} ${sku.stockUnit}，请求 ${converted.qty.toFixed(4)} ${sku.stockUnit}`,
          );
        }

        if (dyeLotNo) {
          const [dyeLot] = await manager.query<Array<{ qty_on_hand: string; qty_reserved: string }>>(
            `SELECT qty_on_hand, qty_reserved
             FROM inventory_dye_lots
             WHERE tenant_id = ? AND sku_id = ? AND dye_lot_no = ?
             LIMIT 1
             FOR UPDATE`,
            [this.tenantId, item.sku_id, dyeLotNo],
          );
          if (!dyeLot) {
            throw AppError.badRequest(`SKU#${item.sku_id} 的缸号 ${dyeLotNo} 不存在`);
          }
          const dyeAvailable = new Decimal(dyeLot.qty_on_hand).minus(dyeLot.qty_reserved);
          if (converted.qty.gt(dyeAvailable)) {
            throw AppError.badRequest(`SKU#${item.sku_id} 的缸号 ${dyeLotNo} 可用库存不足`);
          }
          await manager.query(
            `UPDATE inventory_dye_lots
             SET qty_on_hand = qty_on_hand - ?, last_in_at = NOW(3)
             WHERE tenant_id = ? AND sku_id = ? AND dye_lot_no = ?`,
            [converted.qty.toFixed(4), this.tenantId, item.sku_id, dyeLotNo],
          );
        }

        const txNo = await generateNo('transaction', this.tenantId);
        const inventoryTxColumns = [
          'tenant_id',
          'transaction_no',
          'sku_id',
          ...(supportsBusinessColumns ? ['business_class', 'department_id', 'issue_order_id'] : []),
          'transaction_type',
          'direction',
          'warehouse_id',
          'location_id',
          'source_ref',
          'qty_input',
          'input_unit',
          'qty_stock_unit',
          'stock_unit',
          'dye_lot_no',
          'reference_type',
          'reference_id',
          'reference_no',
          'notes',
          'created_by',
          'updated_by',
        ];
        const inventoryTxValues = [
          this.tenantId,
          txNo,
          item.sku_id,
          ...(supportsBusinessColumns ? ['consumable', order.request_department_id ?? null, id] : []),
          'CONSUMABLE_OUT',
          'OUT',
          warehouseLocation.warehouseId,
          warehouseLocation.locationId,
          'consumable_issue:execute',
          item.qty_requested,
          item.issue_unit,
          converted.qty.toFixed(4),
          sku.stockUnit,
          dyeLotNo,
          'consumable_issue_order',
          id,
          order.issue_no,
          this.mergeNotes(order.purpose, params.notes, item.notes),
          this.userId,
          this.userId,
        ];
        await manager.query(
          `INSERT INTO inventory_transactions
             (${inventoryTxColumns.join(', ')})
           VALUES (${inventoryTxColumns.map(() => '?').join(', ')})`,
          inventoryTxValues,
        );

        await manager.query(
          `UPDATE inventory
           SET qty_on_hand = qty_on_hand - ?, last_out_at = NOW(3), updated_by = ?
           WHERE tenant_id = ? AND sku_id = ? AND warehouse_id = ? AND location_id = ?`,
          [
            converted.qty.toFixed(4),
            this.userId,
            this.tenantId,
            item.sku_id,
            warehouseLocation.warehouseId,
            warehouseLocation.locationId,
          ],
        );
        await syncInventoryDailySnapshotForSku(manager, this.tenantId, Number(item.sku_id));

        await manager.query(
          `UPDATE consumable_issue_items
           SET qty_issued = qty_requested,
               warehouse_id = ?,
               location_id = ?,
               updated_by = ?
           WHERE id = ? AND tenant_id = ?`,
          [
            warehouseLocation.warehouseId,
            warehouseLocation.locationId,
            this.userId,
            item.id,
            this.tenantId,
          ],
        );

        issuedSkuIds.push(Number(item.sku_id));
      }

      await manager.query(
        `UPDATE consumable_issue_orders
         SET status = 'issued',
             issued_by = ?,
             issued_at = NOW(3),
             notes = ?,
             updated_by = ?
         WHERE id = ? AND tenant_id = ?`,
        [
          this.userId,
          this.mergeNotes(order.notes, params.notes),
          this.userId,
          id,
          this.tenantId,
        ],
      );

      return { id, issueNo: order.issue_no, issuedItemCount: items.length };
    });

    await this.invalidateInventorySnapshotCaches(issuedSkuIds);
    return result;
  }

  async listConsumableStock(params: ListConsumableStockParams) {
    const warehouseScope = await this.getWarehouseDataScope();
    const conds = ['i.tenant_id = ?', "s.business_class = 'consumable'"];
    const args: Array<string | number> = [this.tenantId];
    if (params.warehouseId) {
      conds.push('i.warehouse_id = ?');
      args.push(params.warehouseId);
    }
    if (params.keyword?.trim()) {
      const keyword = `%${params.keyword.trim()}%`;
      conds.push('(s.sku_code LIKE ? OR s.name LIKE ?)');
      args.push(keyword, keyword);
    }
    if (warehouseScope.mode === 'none') {
      conds.push('1 = 0');
    } else if (warehouseScope.mode === 'assigned') {
      conds.push(`i.warehouse_id IN (${warehouseScope.warehouseIds.map(() => '?').join(',')})`);
      args.push(...warehouseScope.warehouseIds);
    }

    const where = conds.join(' AND ');
    const offset = (params.page - 1) * params.pageSize;

    const [list, countRows] = await Promise.all([
      AppDataSource.query<Array<Record<string, unknown>>>(
        `SELECT
           i.sku_id AS skuId,
           s.sku_code AS skuCode,
           s.name AS skuName,
           i.warehouse_id AS warehouseId,
           w.code AS warehouseCode,
           w.name AS warehouseName,
           i.location_id AS locationId,
           l.code AS locationCode,
           l.name AS locationName,
           i.qty_on_hand AS qtyOnHand,
           i.qty_reserved AS qtyReserved,
           i.qty_in_transit AS qtyInTransit,
           (i.qty_on_hand - i.qty_reserved) AS qtyAvailable,
           s.stock_unit AS stockUnit
         FROM inventory i
         INNER JOIN skus s ON s.id = i.sku_id AND s.tenant_id = i.tenant_id
         LEFT JOIN warehouses w ON w.id = i.warehouse_id AND w.tenant_id = i.tenant_id
         LEFT JOIN locations l ON l.id = i.location_id AND l.tenant_id = i.tenant_id
         WHERE ${where}
         ORDER BY s.sku_code ASC, i.warehouse_id ASC, i.location_id ASC
         LIMIT ? OFFSET ?`,
        [...args, params.pageSize, offset],
      ),
      AppDataSource.query<Array<{ total: number }>>(
        `SELECT COUNT(*) AS total
         FROM inventory i
         INNER JOIN skus s ON s.id = i.sku_id AND s.tenant_id = i.tenant_id
         WHERE ${where}`,
        args,
      ),
    ]);

    return buildPaginated(list, Number(countRows[0]?.total ?? 0), params.page, params.pageSize);
  }
}
