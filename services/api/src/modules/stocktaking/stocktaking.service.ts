import { z } from 'zod';
import * as XLSX from 'xlsx';
import Decimal from 'decimal.js';
import { AppDataSource } from '../../config/database';
import { getRedisClient, RedisKeys } from '../../config/redis';
import { AppError } from '../../shared/AppError';
import { buildPaginated, PaginatedData } from '../../shared/ApiResponse';
import { TenantContext } from '../../shared/BaseRepository';
import { generateNo } from '../../shared/generateNo';
import { PermissionSnapshot } from '../access-control/access-control.types';
import {
  assertWarehouseInScope,
  resolveWarehouseDataScope,
  type WarehouseDataScope,
} from '../access-control/warehouse-data-scope';
import {
  ensureDefaultWarehouseLocation as ensureDefaultWarehouseLocationBinding,
  resolveWarehouseLocationBinding,
} from '../inventory/warehouse-location.resolver';
import { syncInventoryDailySnapshotForSku } from '../inventory/daily-snapshot.util';

// ─── 校验 Schema ──────────────────────────────────────────────────────────────

export const CreateTaskSchema = z.object({
  scope:      z.enum(['all', 'category', 'location']).default('all'),
  scopeValue: z.string().max(100).optional(),
  warehouseId: z.number().int().positive().optional(),
  locationId: z.number().int().positive().optional(),
});

export const ListTaskSchema = z.object({
  page:     z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status:   z.enum(['draft', 'in_progress', 'completed', 'confirmed']).optional(),
});

export const BatchItemSchema = z.array(
  z.object({
    skuId:     z.number().int().positive(),
    actualQty: z.string().regex(/^\d+(\.\d{1,4})?$/, '数量格式不合法'),
    notes:     z.string().max(500).optional(),
  }),
).min(1).max(1000);

// ─── 类型定义 ─────────────────────────────────────────────────────────────────

export type TaskStatus = 'draft' | 'in_progress' | 'completed' | 'confirmed';

export interface StocktakingTask {
  id: number;
  taskNo: string;
  scope: 'all' | 'category' | 'location';
  scopeValue: string | null;
  status: TaskStatus;
  warehouseId: number | null;
  locationId: number | null;
  warehouseCode: string | null;
  warehouseName: string | null;
  locationCode: string | null;
  locationName: string | null;
  totalItems: number;
  diffItems: number;
  createdBy: number;
  confirmedBy: number | null;
  confirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StocktakingItem {
  id: number;
  skuId: number;
  skuCode: string;
  skuName: string;
  stockUnit: string | null;
  warehouseId: number | null;
  warehouseCode: string | null;
  warehouseName: string | null;
  locationId: number | null;
  locationCode: string | null;
  locationName: string | null;
  systemQty: string;
  actualQty: string | null;
  diffQty: string;
  notes: string | null;
}

export interface DiffReport {
  totalItems: number;
  diffCount: number;
  diffRate: string;
  diffItems: Array<StocktakingItem & { diffType: 'over' | 'short' | 'match' }>;
}

export interface StocktakingAdjustmentOrderItem {
  skuId: number;
  skuCode: string;
  skuName: string;
  stockUnit: string | null;
  warehouseId: number | null;
  warehouseCode: string | null;
  warehouseName: string | null;
  locationId: number | null;
  locationCode: string | null;
  locationName: string | null;
  diffQty: string;
  direction: 'IN' | 'OUT';
  adjustQty: string;
}

export interface StocktakingAdjustmentOrder {
  adjustmentNo: string;
  taskId: number;
  taskNo: string;
  execute: boolean;
  confirmedAt: string | null;
  diffCount: number;
  totalAdjustQty: string;
  items: StocktakingAdjustmentOrderItem[];
}

interface InventoryLockRow {
  id: number;
  qtyOnHand: string;
  stockUnit: string | null;
  warehouseId: number | null;
  locationId: number | null;
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class StocktakingService {
  private readonly tenantId: number;
  private readonly userId: number;
  private readonly permissionSnapshot?: PermissionSnapshot;
  private warehouseDataScopePromise: Promise<WarehouseDataScope> | null = null;

  constructor(ctx: TenantContext & { permissionSnapshot?: PermissionSnapshot }) {
    this.tenantId = ctx.tenantId;
    this.userId = ctx.userId;
    this.permissionSnapshot = ctx.permissionSnapshot;
  }

  private async getWarehouseDataScope(): Promise<WarehouseDataScope> {
    this.warehouseDataScopePromise ??= resolveWarehouseDataScope(this.tenantId, this.permissionSnapshot);
    return this.warehouseDataScopePromise;
  }

  private async ensureDefaultWarehouseLocation(
    manager: { query: typeof AppDataSource.query },
  ): Promise<{ warehouseId: number; locationId: number }> {
    const fallback = await ensureDefaultWarehouseLocationBinding(manager, this.tenantId);
    return { warehouseId: fallback.warehouseId, locationId: fallback.locationId };
  }

  private async resolveWarehouseLocation(
    manager: { query: typeof AppDataSource.query },
    params: { warehouseId?: number; locationId?: number },
  ): Promise<{ warehouseId: number; locationId: number }> {
    const binding = await resolveWarehouseLocationBinding({
      manager,
      tenantId: this.tenantId,
      userId: this.userId,
      warehouseId: params.warehouseId,
      locationId: params.locationId,
      sourceRef: 'stocktaking:create',
    });
    return { warehouseId: binding.warehouseId, locationId: binding.locationId };
  }

  // ── 创建盘点任务 ────────────────────────────────────────────────────────────

  async createTask(params: z.infer<typeof CreateTaskSchema>): Promise<StocktakingTask> {
    const taskNo = await generateNo('stocktaking_task', this.tenantId);
    const result = await AppDataSource.transaction(async (manager) => {
      const warehouseLocation = await this.resolveWarehouseLocation(manager, params);
      assertWarehouseInScope(await this.getWarehouseDataScope(), warehouseLocation.warehouseId);

      // 快照当前库存（按仓库/库位 + scope 过滤）
      let inventoryQuery = `
        SELECT i.sku_id, i.qty_on_hand AS system_qty, i.warehouse_id, i.location_id
        FROM inventory i
        WHERE i.tenant_id = ?
          AND i.warehouse_id = ?
          AND i.location_id = ?
      `;
      const inventoryArgs: unknown[] = [
        this.tenantId,
        warehouseLocation.warehouseId,
        warehouseLocation.locationId,
      ];

      if (params.scope === 'category' && params.scopeValue) {
        inventoryQuery += `
          AND i.sku_id IN (
            SELECT id FROM skus WHERE tenant_id = ? AND category2_id = ?
          )
        `;
        inventoryArgs.push(this.tenantId, params.scopeValue);
      } else if (params.scope === 'location' && params.scopeValue) {
        const scopedLocationId = Number(params.scopeValue);
        if (Number.isInteger(scopedLocationId) && scopedLocationId > 0) {
          inventoryQuery += ` AND i.location_id = ?`;
          inventoryArgs.push(scopedLocationId);
        }
      }

      const inventoryRows: Array<{
        sku_id: number;
        system_qty: string;
        warehouse_id: number;
        location_id: number;
      }> = await manager.query(inventoryQuery, inventoryArgs);
      const totalItems = inventoryRows.length;

      const insertResult = await manager.query(
        `INSERT INTO stocktaking_tasks
           (tenant_id, task_no, scope, scope_value, warehouse_id, location_id, status, total_items, diff_items, created_by)
         VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, 0, ?)`,
        [
          this.tenantId,
          taskNo,
          params.scope,
          params.scopeValue ?? null,
          warehouseLocation.warehouseId,
          warehouseLocation.locationId,
          totalItems,
          this.userId,
        ],
      );
      const taskId: number = (insertResult as { insertId: number }).insertId;

      if (inventoryRows.length > 0) {
        const valuePlaceholders = inventoryRows.map(() => '(?,?,?,?,?,?)').join(',');
        const valueArgs = inventoryRows.flatMap((r) => [
          this.tenantId,
          taskId,
          r.sku_id,
          r.warehouse_id,
          r.location_id,
          r.system_qty,
        ]);
        await manager.query(
          `INSERT INTO stocktaking_items (tenant_id, task_id, sku_id, warehouse_id, location_id, system_qty)
           VALUES ${valuePlaceholders}`,
          valueArgs,
        );
      }

      return taskId;
    });

    return this.getTaskById(result);
  }

  // ── 任务列表（分页 + 状态筛选）──────────────────────────────────────────────

  async listTasks(params: z.infer<typeof ListTaskSchema>): Promise<PaginatedData<StocktakingTask>> {
    const warehouseScope = await this.getWarehouseDataScope();
    const { page, pageSize, status } = params;
    const offset = (page - 1) * pageSize;

    const whereClauses = ['st.tenant_id = ?'];
    const args: Array<string | number> = [this.tenantId];

    if (status) {
      whereClauses.push('st.status = ?');
      args.push(status);
    }
    if (warehouseScope.mode === 'none') {
      whereClauses.push('1 = 0');
    } else if (warehouseScope.mode === 'assigned') {
      whereClauses.push(`st.warehouse_id IN (${warehouseScope.warehouseIds.map(() => '?').join(',')})`);
      args.push(...warehouseScope.warehouseIds);
    }

    const where = whereClauses.join(' AND ');

    const [[{ total }], rows] = await Promise.all([
      AppDataSource.query(
        `SELECT COUNT(*) AS total FROM stocktaking_tasks st WHERE ${where}`,
        args,
      ) as Promise<[{ total: number }]>,
      AppDataSource.query(
        `SELECT
           st.*,
           w.code AS warehouse_code,
           w.name AS warehouse_name,
           l.code AS location_code,
           l.name AS location_name
         FROM stocktaking_tasks st
         LEFT JOIN warehouses w
           ON w.id = st.warehouse_id
          AND w.tenant_id = st.tenant_id
         LEFT JOIN locations l
           ON l.id = st.location_id
          AND l.tenant_id = st.tenant_id
         WHERE ${where}
         ORDER BY st.created_at DESC LIMIT ? OFFSET ?`,
        [...args, pageSize, offset],
      ),
    ]);

    return buildPaginated(rows.map(this.mapTask), Number(total), page, pageSize);
  }

  // ── 任务详情（含明细）───────────────────────────────────────────────────────

  async getTaskWithItems(id: number): Promise<{ task: StocktakingTask; items: StocktakingItem[] }> {
    const task = await this.getTaskById(id);

    const items: unknown[] = await AppDataSource.query(
      `SELECT si.id, si.sku_id, s.sku_code, s.name AS sku_name, s.stock_unit,
              si.warehouse_id, w.code AS warehouse_code, w.name AS warehouse_name,
              si.location_id, l.code AS location_code, l.name AS location_name,
              si.system_qty, si.actual_qty, si.diff_qty, si.notes
       FROM stocktaking_items si
       INNER JOIN skus s ON s.id = si.sku_id
       LEFT JOIN warehouses w
         ON w.id = si.warehouse_id
        AND w.tenant_id = si.tenant_id
       LEFT JOIN locations l
         ON l.id = si.location_id
        AND l.tenant_id = si.tenant_id
       WHERE si.task_id = ? AND si.tenant_id = ?
       ORDER BY s.sku_code`,
      [id, this.tenantId],
    );

    return { task, items: (items as any[]).map(this.mapItem) };
  }

  // ── 导出盘点表（Excel）──────────────────────────────────────────────────────

  async exportTaskExcel(id: number): Promise<Buffer> {
    const { task, items } = await this.getTaskWithItems(id);

    const header = [
      'SKU编码', 'SKU名称', '单位', '系统数量', '实盘数量', '差异数量', '备注',
    ];

    const rows = items.map((item) => [
      item.skuCode,
      item.skuName,
      item.stockUnit ?? '',
      item.systemQty,
      item.actualQty ?? '',
      item.diffQty,
      item.notes ?? '',
    ]);

    const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
    ws['!cols'] = [16, 24, 8, 12, 12, 12, 20].map((wch) => ({ wch }));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `盘点单_${task.taskNo}`);

    return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  }

  // ── 批量录入盘点结果 ────────────────────────────────────────────────────────

  async batchUpdateItems(
    taskId: number,
    inputs: z.infer<typeof BatchItemSchema>,
  ): Promise<{ updatedCount: number }> {
    const task = await this.getTaskById(taskId);

    if (task.status === 'confirmed') {
      throw AppError.badRequest('已确认的盘点任务不允许修改');
    }

    let updatedCount = 0;

    await AppDataSource.transaction(async (manager) => {
      for (const input of inputs) {
        const res = await manager.query(
          `UPDATE stocktaking_items
           SET actual_qty = ?, notes = ?, updated_at = NOW(3)
           WHERE task_id = ? AND sku_id = ? AND tenant_id = ?`,
          [input.actualQty, input.notes ?? null, taskId, input.skuId, this.tenantId],
        );
        updatedCount += (res as { affectedRows: number }).affectedRows;
      }

      // 更新主任务状态为 in_progress（如仍是 draft）
      if (task.status === 'draft') {
        await manager.query(
          `UPDATE stocktaking_tasks SET status = 'in_progress', updated_at = NOW(3)
           WHERE id = ? AND tenant_id = ?`,
          [taskId, this.tenantId],
        );
      }
    });

    return { updatedCount };
  }

  // ── 提交待确认（in_progress -> completed）──────────────────────────────────

  async submitTask(taskId: number): Promise<{ submittedAt: string }> {
    const task = await this.getTaskById(taskId);

    if (task.status === 'confirmed') {
      throw AppError.conflict('该盘点任务已确认，无需重复提交');
    }
    if (task.status === 'draft') {
      throw AppError.badRequest('请先录入盘点结果再提交确认');
    }
    if (task.status === 'completed') {
      return { submittedAt: task.updatedAt };
    }

    const [row] = await AppDataSource.query<Array<{
      countedItems: number | string | null;
      diffItems: number | string | null;
    }>>(
      `SELECT
         SUM(CASE WHEN actual_qty IS NOT NULL THEN 1 ELSE 0 END) AS countedItems,
         SUM(CASE WHEN actual_qty IS NOT NULL AND diff_qty <> 0 THEN 1 ELSE 0 END) AS diffItems
       FROM stocktaking_items
       WHERE task_id = ? AND tenant_id = ?`,
      [taskId, this.tenantId],
    );

    const countedItems = Number(row?.countedItems ?? 0);
    const diffItems = Number(row?.diffItems ?? 0);
    if (countedItems <= 0) {
      throw AppError.badRequest('请先录入至少一条实盘数量再提交确认');
    }

    await AppDataSource.query(
      `UPDATE stocktaking_tasks
       SET status = 'completed',
           diff_items = ?,
           updated_at = NOW(3)
       WHERE id = ? AND tenant_id = ?`,
      [diffItems, taskId, this.tenantId],
    );

    return { submittedAt: new Date().toISOString() };
  }

  // ── 差异分析报告 ────────────────────────────────────────────────────────────

  async getDiffReport(taskId: number): Promise<DiffReport> {
    await this.getTaskById(taskId);

    const rows: unknown[] = await AppDataSource.query(
      `SELECT si.id, si.sku_id, s.sku_code, s.name AS sku_name, s.stock_unit,
              si.warehouse_id, w.code AS warehouse_code, w.name AS warehouse_name,
              si.location_id, l.code AS location_code, l.name AS location_name,
              si.system_qty, si.actual_qty, si.diff_qty, si.notes
       FROM stocktaking_items si
       INNER JOIN skus s ON s.id = si.sku_id
       LEFT JOIN warehouses w
         ON w.id = si.warehouse_id
        AND w.tenant_id = si.tenant_id
       LEFT JOIN locations l
         ON l.id = si.location_id
        AND l.tenant_id = si.tenant_id
       WHERE si.task_id = ? AND si.tenant_id = ?
       ORDER BY ABS(si.diff_qty) DESC`,
      [taskId, this.tenantId],
    );

    const allItems = (rows as any[]).map(this.mapItem);
    const diffItems = allItems
      .filter((i) => Number(i.diffQty) !== 0 || i.actualQty !== null)
      .map((i) => ({
        ...i,
        diffType: (
          Number(i.diffQty) > 0 ? 'over' :
          Number(i.diffQty) < 0 ? 'short' : 'match'
        ) as 'over' | 'short' | 'match',
      }));

    const totalItems = allItems.length;
    const diffCount  = diffItems.filter((i) => i.diffType !== 'match').length;

    return {
      totalItems,
      diffCount,
      diffRate: totalItems > 0 ? `${((diffCount / totalItems) * 100).toFixed(1)}%` : '0.0%',
      diffItems,
    };
  }

  // ── 盘点差异一键生成调整单（可预览/可执行）──────────────────────────────────

  async createAdjustmentOrder(
    taskId: number,
    params: { execute?: boolean } = {},
  ): Promise<StocktakingAdjustmentOrder> {
    const execute = params.execute ?? true;
    const task = await this.getTaskById(taskId);

    if (task.status === 'confirmed') {
      throw AppError.conflict('该盘点任务已确认');
    }
    if (task.status === 'draft') {
      throw AppError.badRequest('请先录入盘点结果再生成调整单');
    }

    const diffRows = await this.getAdjustmentDiffRows(taskId);
    if (diffRows.length === 0) {
      throw AppError.badRequest('无差异数据，无需生成调整单');
    }

    const adjustmentNo = await generateNo('stocktaking_adjustment', this.tenantId);
    const items = diffRows.map((row) => this.mapAdjustmentItem(row));

    if (!execute) {
      return {
        adjustmentNo,
        taskId,
        taskNo: task.taskNo,
        execute: false,
        confirmedAt: null,
        diffCount: items.length,
        totalAdjustQty: this.sumAdjustmentQty(items),
        items,
      };
    }

    const confirmedAt = new Date().toISOString();

    await AppDataSource.transaction(async (manager) => {
      for (const row of diffRows) {
        const inventoryRow = await this.lockInventoryRowForStocktaking(manager, {
          skuId: Number(row.sku_id),
          warehouseId: row.warehouse_id != null ? Number(row.warehouse_id) : null,
          locationId: row.location_id != null ? Number(row.location_id) : null,
          sourceRef: 'stocktaking:adjustment-order',
          missingActionText: '执行调整单',
        });

        const nextQtyOnHand = new Decimal(inventoryRow.qtyOnHand).plus(row.diff_qty);
        if (nextQtyOnHand.lt(0)) {
          throw AppError.badRequest(
            `SKU#${row.sku_id} 调整后在库将变为负数，请刷新盘点任务后重试`,
          );
        }

        await manager.query(
          `UPDATE inventory
           SET qty_on_hand = qty_on_hand + ?,
               updated_at = NOW(3),
               updated_by = ?
           WHERE id = ? AND tenant_id = ?`,
          [row.diff_qty, this.userId, inventoryRow.id, this.tenantId],
        );

        const direction: 'IN' | 'OUT' = Number(row.diff_qty) > 0 ? 'IN' : 'OUT';
        const absQty = new Decimal(row.diff_qty).abs().toFixed(4);
        const stockUnit = String(inventoryRow.stockUnit ?? '');
        const transactionNo = await generateNo('transaction', this.tenantId);
        await manager.query(
          `INSERT INTO inventory_transactions
             (tenant_id, transaction_no, sku_id, transaction_type, direction,
              warehouse_id, location_id, source_ref,
              qty_input, input_unit, qty_stock_unit, stock_unit,
              reference_type, reference_id, reference_no, notes, created_by, updated_by, created_at)
           VALUES (?, ?, ?, 'STOCKTAKE_ADJUST', ?, ?, ?, ?, ?, ?, ?, ?, 'stocktaking_adjustment', ?, ?, ?, ?, ?, NOW(3))`,
          [
            this.tenantId,
            transactionNo,
            row.sku_id,
            direction,
            inventoryRow.warehouseId,
            inventoryRow.locationId,
            'stocktaking:adjustment-order',
            absQty,
            stockUnit,
            absQty,
            stockUnit,
            taskId,
            adjustmentNo,
            `盘点差异调整单 ${adjustmentNo}`,
            this.userId,
            this.userId,
          ],
        );

        await this.syncDailySnapshot(manager, row.sku_id);
      }

      await manager.query(
        `UPDATE stocktaking_tasks
         SET status = 'confirmed',
             diff_items = ?,
             confirmed_by = ?,
             confirmed_at = NOW(3),
             updated_at = NOW(3)
         WHERE id = ? AND tenant_id = ?`,
        [diffRows.length, this.userId, taskId, this.tenantId],
      );
    });

    await this.invalidateInventorySnapshotCaches(diffRows.map((row) => Number(row.sku_id)));

    return {
      adjustmentNo,
      taskId,
      taskNo: task.taskNo,
      execute: true,
      confirmedAt,
      diffCount: items.length,
      totalAdjustQty: this.sumAdjustmentQty(items),
      items,
    };
  }

  // ── 确认盘点（调整库存）─────────────────────────────────────────────────────

  async confirmTask(taskId: number): Promise<{ confirmedAt: string }> {
    const task = await this.getTaskById(taskId);

    if (task.status === 'confirmed') {
      throw AppError.conflict('该盘点任务已确认');
    }
    if (task.status === 'draft') {
      throw AppError.badRequest('请先录入盘点结果再确认');
    }

    // 获取有差异的明细行
    const diffRows: Array<{
      sku_id: number;
      warehouse_id: number | null;
      location_id: number | null;
      diff_qty: string;
    }> = await AppDataSource.query(
      `SELECT sku_id, warehouse_id, location_id, diff_qty
       FROM stocktaking_items
       WHERE task_id = ? AND tenant_id = ? AND actual_qty IS NOT NULL AND diff_qty <> 0`,
      [taskId, this.tenantId],
    );

    const confirmedAt = new Date().toISOString();

    await AppDataSource.transaction(async (manager) => {
      // 更新 inventory.qty_on_hand（STOCKTAKE_ADJUST）
      for (const row of diffRows) {
        const inventoryRow = await this.lockInventoryRowForStocktaking(manager, {
          skuId: Number(row.sku_id),
          warehouseId: row.warehouse_id != null ? Number(row.warehouse_id) : null,
          locationId: row.location_id != null ? Number(row.location_id) : null,
          sourceRef: 'stocktaking:confirm',
          missingActionText: '确认盘点',
        });

        const nextQtyOnHand = new Decimal(inventoryRow.qtyOnHand).plus(row.diff_qty);
        if (nextQtyOnHand.lt(0)) {
          throw AppError.badRequest(
            `SKU#${row.sku_id} 盘点调整后在库将变为负数，请刷新盘点任务后重试`,
          );
        }

        await manager.query(
          `UPDATE inventory
           SET qty_on_hand = qty_on_hand + ?,
               updated_at  = NOW(3),
               updated_by = ?
           WHERE id = ? AND tenant_id = ?`,
          [row.diff_qty, this.userId, inventoryRow.id, this.tenantId],
        );

        // 记录库存流水
        const direction = Number(row.diff_qty) > 0 ? 'IN' : 'OUT';
        const absQty = Math.abs(Number(row.diff_qty));
        const stockUnit = String(inventoryRow.stockUnit ?? '');
        const transactionNo = await generateNo('transaction', this.tenantId);
        await manager.query(
          `INSERT INTO inventory_transactions
             (tenant_id, transaction_no, sku_id, transaction_type, direction,
              warehouse_id, location_id, source_ref,
              qty_input, input_unit, qty_stock_unit, stock_unit,
              reference_type, reference_id, reference_no, notes, created_by, updated_by, created_at)
           VALUES (?, ?, ?, 'STOCKTAKE_ADJUST', ?, ?, ?, ?, ?, ?, ?, ?, 'stocktaking_task', ?, ?, ?, ?, ?, NOW(3))`,
          [
            this.tenantId,
            transactionNo,
            row.sku_id,
            direction,
            inventoryRow.warehouseId,
            inventoryRow.locationId,
            'stocktaking:confirm',
            absQty,
            stockUnit,
            absQty,
            stockUnit,
            taskId,
            task.taskNo,
            '盘点确认差异调整',
            this.userId,
            this.userId,
          ],
        );

        await this.syncDailySnapshot(manager, row.sku_id);
      }

      // 计算 diff_items 数量并更新主任务
      const diffCount = diffRows.length;
      await manager.query(
        `UPDATE stocktaking_tasks
         SET status       = 'confirmed',
             diff_items   = ?,
             confirmed_by = ?,
             confirmed_at = NOW(3),
             updated_at   = NOW(3)
         WHERE id = ? AND tenant_id = ?`,
        [diffCount, this.userId, taskId, this.tenantId],
      );
    });

    await this.invalidateInventorySnapshotCaches(diffRows.map((row) => Number(row.sku_id)));

    return { confirmedAt };
  }

  // ── 私有辅助方法 ─────────────────────────────────────────────────────────────

  private async getTaskById(id: number): Promise<StocktakingTask> {
    const warehouseScope = await this.getWarehouseDataScope();
    const whereClauses = ['st.id = ?', 'st.tenant_id = ?'];
    const params: Array<string | number> = [id, this.tenantId];
    if (warehouseScope.mode === 'none') {
      whereClauses.push('1 = 0');
    } else if (warehouseScope.mode === 'assigned') {
      whereClauses.push(`st.warehouse_id IN (${warehouseScope.warehouseIds.map(() => '?').join(',')})`);
      params.push(...warehouseScope.warehouseIds);
    }

    const [row] = await AppDataSource.query(
      `SELECT
         st.*,
         w.code AS warehouse_code,
         w.name AS warehouse_name,
         l.code AS location_code,
         l.name AS location_name
       FROM stocktaking_tasks st
       LEFT JOIN warehouses w
         ON w.id = st.warehouse_id
        AND w.tenant_id = st.tenant_id
       LEFT JOIN locations l
         ON l.id = st.location_id
        AND l.tenant_id = st.tenant_id
       WHERE ${whereClauses.join(' AND ')}
       LIMIT 1`,
      params,
    );
    if (!row) throw AppError.notFound('盘点任务不存在');
    return this.mapTask(row);
  }

  private async lockInventoryRowForStocktaking(
    manager: { query: typeof AppDataSource.query },
    params: {
      skuId: number;
      warehouseId: number | null;
      locationId: number | null;
      sourceRef: string;
      missingActionText: string;
    },
  ): Promise<InventoryLockRow> {
    const baseSelect = `
      SELECT i.id, i.qty_on_hand, i.warehouse_id, i.location_id, s.stock_unit
      FROM inventory i
      INNER JOIN skus s
        ON s.id = i.sku_id
       AND s.tenant_id = i.tenant_id
      WHERE i.tenant_id = ? AND i.sku_id = ?
    `;

    if (params.warehouseId != null && params.locationId != null) {
      const [exact] = await manager.query<Array<{
        id: number;
        qty_on_hand: string;
        warehouse_id: number | null;
        location_id: number | null;
        stock_unit: string | null;
      }>>(
        `${baseSelect} AND i.warehouse_id = ? AND i.location_id = ? LIMIT 1 FOR UPDATE`,
        [this.tenantId, params.skuId, params.warehouseId, params.locationId],
      );
      if (exact) {
        return {
          id: Number(exact.id),
          qtyOnHand: String(exact.qty_on_hand),
          stockUnit: exact.stock_unit != null ? String(exact.stock_unit) : null,
          warehouseId: exact.warehouse_id != null ? Number(exact.warehouse_id) : null,
          locationId: exact.location_id != null ? Number(exact.location_id) : null,
        };
      }
    }

    // 兼容 inventory 仍按 tenant+sku 唯一的历史数据：库位不匹配时退化到 sku 粒度锁。
    const [fallback] = await manager.query<Array<{
      id: number;
      qty_on_hand: string;
      warehouse_id: number | null;
      location_id: number | null;
      stock_unit: string | null;
    }>>(
      `${baseSelect} LIMIT 1 FOR UPDATE`,
      [this.tenantId, params.skuId],
    );
    if (fallback) {
      return {
        id: Number(fallback.id),
        qtyOnHand: String(fallback.qty_on_hand),
        stockUnit: fallback.stock_unit != null ? String(fallback.stock_unit) : null,
        warehouseId: fallback.warehouse_id != null ? Number(fallback.warehouse_id) : null,
        locationId: fallback.location_id != null ? Number(fallback.location_id) : null,
      };
    }

    const ensuredWarehouseLocation =
      params.warehouseId != null && params.locationId != null
        ? { warehouseId: params.warehouseId, locationId: params.locationId }
        : await this.ensureDefaultWarehouseLocation(manager);

    await manager.query(
      `INSERT INTO inventory
         (tenant_id, sku_id, warehouse_id, location_id, source_ref, qty_on_hand, qty_reserved, qty_in_transit, updated_by)
       VALUES (?, ?, ?, ?, ?, 0, 0, 0, ?)
       ON DUPLICATE KEY UPDATE
         warehouse_id = COALESCE(warehouse_id, VALUES(warehouse_id)),
         location_id = COALESCE(location_id, VALUES(location_id)),
         source_ref = COALESCE(source_ref, VALUES(source_ref)),
         updated_by = VALUES(updated_by)`,
      [
        this.tenantId,
        params.skuId,
        ensuredWarehouseLocation.warehouseId,
        ensuredWarehouseLocation.locationId,
        params.sourceRef,
        this.userId,
      ],
    );

    const [created] = await manager.query<Array<{
      id: number;
      qty_on_hand: string;
      warehouse_id: number | null;
      location_id: number | null;
      stock_unit: string | null;
    }>>(
      `${baseSelect} LIMIT 1 FOR UPDATE`,
      [this.tenantId, params.skuId],
    );
    if (!created) {
      throw AppError.notFound(`SKU#${params.skuId} 的库存记录不存在，无法${params.missingActionText}`);
    }
    return {
      id: Number(created.id),
      qtyOnHand: String(created.qty_on_hand),
      stockUnit: created.stock_unit != null ? String(created.stock_unit) : null,
      warehouseId: created.warehouse_id != null ? Number(created.warehouse_id) : null,
      locationId: created.location_id != null ? Number(created.location_id) : null,
    };
  }

  private async getAdjustmentDiffRows(taskId: number): Promise<Array<{
    sku_id: number;
    sku_code: string;
    sku_name: string;
    stock_unit: string | null;
    warehouse_id: number | null;
    warehouse_code: string | null;
    warehouse_name: string | null;
    location_id: number | null;
    location_code: string | null;
    location_name: string | null;
    diff_qty: string;
  }>> {
    return AppDataSource.query(
      `SELECT
         si.sku_id,
         s.sku_code,
         s.name AS sku_name,
         s.stock_unit,
         si.warehouse_id,
         w.code AS warehouse_code,
         w.name AS warehouse_name,
         si.location_id,
         l.code AS location_code,
         l.name AS location_name,
         si.diff_qty
       FROM stocktaking_items si
       INNER JOIN skus s
         ON s.id = si.sku_id
        AND s.tenant_id = si.tenant_id
       LEFT JOIN warehouses w
         ON w.id = si.warehouse_id
        AND w.tenant_id = si.tenant_id
       LEFT JOIN locations l
         ON l.id = si.location_id
        AND l.tenant_id = si.tenant_id
       WHERE si.task_id = ?
         AND si.tenant_id = ?
         AND si.actual_qty IS NOT NULL
         AND si.diff_qty <> 0
       ORDER BY ABS(si.diff_qty) DESC, si.sku_id ASC`,
      [taskId, this.tenantId],
    );
  }

  private mapAdjustmentItem(row: {
    sku_id: number;
    sku_code: string;
    sku_name: string;
    stock_unit: string | null;
    warehouse_id: number | null;
    warehouse_code: string | null;
    warehouse_name: string | null;
    location_id: number | null;
    location_code: string | null;
    location_name: string | null;
    diff_qty: string;
  }): StocktakingAdjustmentOrderItem {
    const direction: 'IN' | 'OUT' = Number(row.diff_qty) > 0 ? 'IN' : 'OUT';
    return {
      skuId: Number(row.sku_id),
      skuCode: String(row.sku_code),
      skuName: String(row.sku_name),
      stockUnit: row.stock_unit != null ? String(row.stock_unit) : null,
      warehouseId: row.warehouse_id != null ? Number(row.warehouse_id) : null,
      warehouseCode: row.warehouse_code != null ? String(row.warehouse_code) : null,
      warehouseName: row.warehouse_name != null ? String(row.warehouse_name) : null,
      locationId: row.location_id != null ? Number(row.location_id) : null,
      locationCode: row.location_code != null ? String(row.location_code) : null,
      locationName: row.location_name != null ? String(row.location_name) : null,
      diffQty: String(row.diff_qty),
      direction,
      adjustQty: new Decimal(row.diff_qty).abs().toFixed(4),
    };
  }

  private sumAdjustmentQty(items: StocktakingAdjustmentOrderItem[]): string {
    return items
      .reduce((sum, item) => sum.plus(item.adjustQty), new Decimal(0))
      .toFixed(4);
  }

  private async syncDailySnapshot(
    manager: { query: typeof AppDataSource.query },
    skuId: number,
  ): Promise<void> {
    await syncInventoryDailySnapshotForSku(manager, this.tenantId, skuId);
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
      console.warn('[StocktakingService] 库存缓存失效失败，已忽略:', (err as Error).message);
    }
  }

  private mapTask(r: Record<string, unknown>): StocktakingTask {
    return {
      id:          Number(r['id']),
      taskNo:      String(r['task_no']),
      scope:       r['scope'] as StocktakingTask['scope'],
      scopeValue:  r['scope_value'] != null ? String(r['scope_value']) : null,
      status:      r['status'] as TaskStatus,
      warehouseId: r['warehouse_id'] != null ? Number(r['warehouse_id']) : null,
      locationId:  r['location_id'] != null ? Number(r['location_id']) : null,
      warehouseCode: r['warehouse_code'] != null ? String(r['warehouse_code']) : null,
      warehouseName: r['warehouse_name'] != null ? String(r['warehouse_name']) : null,
      locationCode: r['location_code'] != null ? String(r['location_code']) : null,
      locationName: r['location_name'] != null ? String(r['location_name']) : null,
      totalItems:  Number(r['total_items']),
      diffItems:   Number(r['diff_items']),
      createdBy:   Number(r['created_by']),
      confirmedBy: r['confirmed_by'] != null ? Number(r['confirmed_by']) : null,
      confirmedAt: r['confirmed_at'] != null ? String(r['confirmed_at']) : null,
      createdAt:   String(r['created_at']),
      updatedAt:   String(r['updated_at']),
    };
  }

  private mapItem(r: Record<string, unknown>): StocktakingItem {
    return {
      id:        Number(r['id']),
      skuId:     Number(r['sku_id']),
      skuCode:   String(r['sku_code']),
      skuName:   String(r['sku_name']),
      stockUnit: r['stock_unit'] != null ? String(r['stock_unit']) : null,
      warehouseId: r['warehouse_id'] != null ? Number(r['warehouse_id']) : null,
      locationId: r['location_id'] != null ? Number(r['location_id']) : null,
      warehouseCode: r['warehouse_code'] != null ? String(r['warehouse_code']) : null,
      warehouseName: r['warehouse_name'] != null ? String(r['warehouse_name']) : null,
      locationCode: r['location_code'] != null ? String(r['location_code']) : null,
      locationName: r['location_name'] != null ? String(r['location_name']) : null,
      systemQty: String(r['system_qty']),
      actualQty: r['actual_qty'] != null ? String(r['actual_qty']) : null,
      diffQty:   String(r['diff_qty'] ?? '0'),
      notes:     r['notes'] != null ? String(r['notes']) : null,
    };
  }
}
