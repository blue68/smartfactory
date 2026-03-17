import { z } from 'zod';
import * as XLSX from 'xlsx';
import { AppDataSource } from '../../config/database';
import { AppError } from '../../shared/AppError';
import { buildPaginated, PaginatedData, ResponseCode } from '../../shared/ApiResponse';
import { TenantContext } from '../../shared/BaseRepository';
import { generateNo } from '../../shared/generateNo';

// ─── 校验 Schema ──────────────────────────────────────────────────────────────

export const CreateTaskSchema = z.object({
  scope:      z.enum(['all', 'category', 'location']).default('all'),
  scopeValue: z.string().max(100).optional(),
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

// ─── Service ──────────────────────────────────────────────────────────────────

export class StocktakingService {
  private readonly tenantId: number;
  private readonly userId: number;

  constructor(ctx: TenantContext) {
    this.tenantId = ctx.tenantId;
    this.userId = ctx.userId;
  }

  // ── 创建盘点任务 ────────────────────────────────────────────────────────────

  async createTask(params: z.infer<typeof CreateTaskSchema>): Promise<StocktakingTask> {
    const taskNo = await generateNo('stocktaking_task', this.tenantId);

    // 快照当前库存（依 scope 过滤）
    let inventoryQuery = `
      SELECT i.sku_id, i.qty_on_hand AS system_qty
      FROM inventory i
      WHERE i.tenant_id = ?
    `;
    const inventoryArgs: unknown[] = [this.tenantId];

    if (params.scope === 'category' && params.scopeValue) {
      inventoryQuery += `
        AND i.sku_id IN (
          SELECT id FROM skus WHERE tenant_id = ? AND category2_id = ?
        )
      `;
      inventoryArgs.push(this.tenantId, params.scopeValue);
    } else if (params.scope === 'location' && params.scopeValue) {
      // 如有仓位字段可在此过滤；当前库存表无仓位则返回全量
      inventoryQuery += ` AND 1=1 -- location filter placeholder`;
    }

    const inventoryRows: Array<{ sku_id: number; system_qty: string }> =
      await AppDataSource.query(inventoryQuery, inventoryArgs);

    const totalItems = inventoryRows.length;

    // 事务：插入主任务 + 批量插入明细快照
    const result = await AppDataSource.transaction(async (manager) => {
      const [insertResult] = await manager.query(
        `INSERT INTO stocktaking_tasks
           (tenant_id, task_no, scope, scope_value, status, total_items, diff_items, created_by)
         VALUES (?, ?, ?, ?, 'draft', ?, 0, ?)`,
        [this.tenantId, taskNo, params.scope, params.scopeValue ?? null, totalItems, this.userId],
      );
      const taskId: number = (insertResult as { insertId: number }).insertId;

      if (inventoryRows.length > 0) {
        const valuePlaceholders = inventoryRows.map(() => '(?,?,?,?)').join(',');
        const valueArgs = inventoryRows.flatMap((r) => [
          this.tenantId,
          taskId,
          r.sku_id,
          r.system_qty,
        ]);
        await manager.query(
          `INSERT INTO stocktaking_items (tenant_id, task_id, sku_id, system_qty)
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
    const { page, pageSize, status } = params;
    const offset = (page - 1) * pageSize;

    const whereClauses = ['tenant_id = ?'];
    const args: unknown[] = [this.tenantId];

    if (status) {
      whereClauses.push('status = ?');
      args.push(status);
    }

    const where = whereClauses.join(' AND ');

    const [[{ total }], rows] = await Promise.all([
      AppDataSource.query(
        `SELECT COUNT(*) AS total FROM stocktaking_tasks WHERE ${where}`,
        args,
      ) as Promise<[{ total: number }]>,
      AppDataSource.query(
        `SELECT * FROM stocktaking_tasks WHERE ${where}
         ORDER BY created_at DESC LIMIT ? OFFSET ?`,
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
              si.system_qty, si.actual_qty, si.diff_qty, si.notes
       FROM stocktaking_items si
       INNER JOIN skus s ON s.id = si.sku_id
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
        const [res] = await manager.query(
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

  // ── 差异分析报告 ────────────────────────────────────────────────────────────

  async getDiffReport(taskId: number): Promise<DiffReport> {
    await this.getTaskById(taskId);

    const rows: unknown[] = await AppDataSource.query(
      `SELECT si.id, si.sku_id, s.sku_code, s.name AS sku_name, s.stock_unit,
              si.system_qty, si.actual_qty, si.diff_qty, si.notes
       FROM stocktaking_items si
       INNER JOIN skus s ON s.id = si.sku_id
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
      diff_qty: string;
    }> = await AppDataSource.query(
      `SELECT sku_id, diff_qty
       FROM stocktaking_items
       WHERE task_id = ? AND tenant_id = ? AND actual_qty IS NOT NULL AND diff_qty <> 0`,
      [taskId, this.tenantId],
    );

    const confirmedAt = new Date().toISOString();

    await AppDataSource.transaction(async (manager) => {
      // 更新 inventory.qty_on_hand（STOCKTAKE_ADJUST）
      for (const row of diffRows) {
        await manager.query(
          `UPDATE inventory
           SET qty_on_hand = qty_on_hand + ?,
               updated_at  = NOW(3)
           WHERE tenant_id = ? AND sku_id = ?`,
          [row.diff_qty, this.tenantId, row.sku_id],
        );

        // 记录库存流水
        const direction = Number(row.diff_qty) > 0 ? 'IN' : 'OUT';
        const absQty = Math.abs(Number(row.diff_qty));
        await manager.query(
          `INSERT INTO inventory_transactions
             (tenant_id, sku_id, transaction_type, direction, qty_stock_unit,
              reference_type, reference_id, created_by, created_at)
           VALUES (?, ?, 'STOCKTAKE_ADJUST', ?, ?, 'stocktaking_task', ?, ?, NOW(3))`,
          [this.tenantId, row.sku_id, direction, absQty, taskId, this.userId],
        );
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

    return { confirmedAt };
  }

  // ── 私有辅助方法 ─────────────────────────────────────────────────────────────

  private async getTaskById(id: number): Promise<StocktakingTask> {
    const [row] = await AppDataSource.query(
      `SELECT * FROM stocktaking_tasks WHERE id = ? AND tenant_id = ? LIMIT 1`,
      [id, this.tenantId],
    );
    if (!row) throw AppError.notFound('盘点任务不存在');
    return this.mapTask(row);
  }

  private mapTask(r: Record<string, unknown>): StocktakingTask {
    return {
      id:          Number(r['id']),
      taskNo:      String(r['task_no']),
      scope:       r['scope'] as StocktakingTask['scope'],
      scopeValue:  r['scope_value'] != null ? String(r['scope_value']) : null,
      status:      r['status'] as TaskStatus,
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
      systemQty: String(r['system_qty']),
      actualQty: r['actual_qty'] != null ? String(r['actual_qty']) : null,
      diffQty:   String(r['diff_qty'] ?? '0'),
      notes:     r['notes'] != null ? String(r['notes']) : null,
    };
  }
}
