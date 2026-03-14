/**
 * BE-S4-10: ScheduleSuggestionService — 调度建议 Service 层
 *
 * 职责：
 *   - triggerCalculation   创建批次记录，推入 BullMQ 队列
 *   - executeCalculation   由 Worker 调用，执行实际计算并写入明细
 *   - getLatest            获取最近一次完成的计算结果（按角色过滤）
 *   - getStatus            查询计算状态（通过 BullMQ jobId）
 *   - getHistory           历史批次分页
 *   - getHistoryDetail     历史批次详情（含明细）
 *   - acceptItem           接受建议（更新状态 + 写审计日志）
 *   - rejectItem           驳回建议（更新状态 + 写审计日志）
 *   - applyProductionSuggestion  应用排产建议（仅更新 priority_score）
 *   - getPurchaseSteps     获取采购建议计算步骤
 *
 * 约束：
 *   - 所有 SQL 使用参数化查询，禁止字符串拼接传参
 *   - 多租户隔离：所有查询携带 tenant_id
 *   - 使用 AppDataSource.query() 访问数据库
 */

import { AppDataSource } from '../../config/database';
import { AppError } from '../../shared/AppError';
import { ResponseCode } from '../../shared/ApiResponse';
import { generateNo } from '../../shared/generateNo';
import { queueService } from '../../shared/queue-service';
import { QUEUE_SUGGESTION_CALCULATE } from '../../shared/queue.config';
import { PurchaseSuggestionEngine } from './purchase-suggestion.engine';
import { ProductionSuggestionEngine } from './production-suggestion.engine';
import type { TenantContext } from '../../shared/BaseRepository';

// ─── 内部行类型 ────────────────────────────────────────────────────────────────

interface ScheduleSuggestionRow {
  id: number;
  tenant_id: number;
  batch_no: string;
  trigger_type: string;
  triggered_by: number | null;
  status: string;
  job_id: string | null;
  purchase_count: number;
  production_count: number;
  calc_started_at: string | null;
  calc_finished_at: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

interface ScheduleSuggestionItemRow {
  id: number;
  tenant_id: number;
  suggestion_id: number;
  item_type: 'purchase' | 'production';
  sku_id: number | null;
  suggested_qty: string | null;
  purchase_unit: string | null;
  suggested_supplier_id: number | null;
  safety_stock_qty: string | null;
  current_stock_qty: string | null;
  shortage_qty: string | null;
  capital_cost: string | null;
  production_order_id: number | null;
  deadline_score: string | null;
  priority_score: string | null;
  material_score: string | null;
  total_score: string | null;
  suggested_rank: number | null;
  suggested_workers: unknown;
  calc_steps: unknown;
  status: string;
  created_at: string;
  updated_at: string;
}

// ─── ScheduleSuggestionService ─────────────────────────────────────────────────

export class ScheduleSuggestionService {
  private readonly tenantId: number;
  private readonly userId: number;
  private readonly roles: string[];

  private readonly purchaseEngine = new PurchaseSuggestionEngine();
  private readonly productionEngine = new ProductionSuggestionEngine();

  constructor(ctx: TenantContext) {
    this.tenantId = ctx.tenantId;
    this.userId = ctx.userId;
    this.roles = ctx.roles ?? [];
  }

  // ─── triggerCalculation ──────────────────────────────────────────────────────

  /**
   * 触发调度建议计算
   * - 生成批次编号（前缀 SCH）
   * - 写入 schedule_suggestions 记录（status=pending）
   * - 将 { batchId, tenantId } 推入 BullMQ 队列
   * - 返回 batchNo 和 jobId
   */
  async triggerCalculation(
    triggerType: 'manual' | 'cron' | 'event' = 'manual',
  ): Promise<{ batchId: number; batchNo: string; jobId: string | null }> {
    const batchNo = await generateNo('schedule_batch', this.tenantId);

    // 插入批次记录
    const insertResult = await AppDataSource.query(
      `INSERT INTO schedule_suggestions
         (tenant_id, batch_no, trigger_type, triggered_by, status,
          created_by, updated_by)
       VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
      [
        this.tenantId,
        batchNo,
        triggerType,
        triggerType === 'manual' ? this.userId : null,
        this.userId,
        this.userId,
      ],
    );
    const batchId = Number(insertResult.insertId);

    // 推入 BullMQ 队列
    const job = await queueService.addJob(
      QUEUE_SUGGESTION_CALCULATE,
      { batchId, tenantId: this.tenantId, triggeredAt: new Date().toISOString() },
      {
        jobId: `schedule-suggestion-${batchId}`,
        attempts: 3,
        backoff: { type: 'fixed', delay: 30_000 },
      },
    );

    // 将 jobId 回写到批次记录
    const jobId = job?.id ?? null;
    if (jobId) {
      await AppDataSource.query(
        `UPDATE schedule_suggestions SET job_id = ?, updated_by = ?
         WHERE id = ? AND tenant_id = ?`,
        [jobId, this.userId, batchId, this.tenantId],
      );
    }

    return { batchId, batchNo, jobId };
  }

  // ─── executeCalculation ──────────────────────────────────────────────────────

  /**
   * 执行实际计算（由 SuggestionWorker 调用）
   * - 更新 status='calculating'
   * - 调用 PurchaseSuggestionEngine.calculate()
   * - 调用 ProductionSuggestionEngine.calculate()
   * - 将结果写入 schedule_suggestion_items
   * - 更新 status='completed' + 计数
   * - 异常时更新 status='failed' + error_message
   */
  async executeCalculation(batchId: number, tenantId: number): Promise<void> {
    // 检查批次是否存在且属于正确租户
    const [batch] = await AppDataSource.query<ScheduleSuggestionRow[]>(
      `SELECT id, status FROM schedule_suggestions
       WHERE id = ? AND tenant_id = ? LIMIT 1`,
      [batchId, tenantId],
    );
    if (!batch) {
      throw AppError.notFound(`调度批次 #${batchId} 不存在`, ResponseCode.NOT_FOUND);
    }
    if (batch.status !== 'pending') {
      // 防止重复执行（BullMQ 重试场景）
      console.warn(`[ScheduleSuggestionService] 批次 #${batchId} 状态为 ${batch.status}，跳过重复执行`);
      return;
    }

    // 标记为计算中
    await AppDataSource.query(
      `UPDATE schedule_suggestions
       SET status = 'calculating', calc_started_at = NOW(), updated_by = ?
       WHERE id = ? AND tenant_id = ?`,
      [0, batchId, tenantId], // 系统操作 updated_by=0
    );

    try {
      // ── 执行两个引擎计算 ──────────────────────────────────────────────────
      const [purchaseResults, productionResults] = await Promise.all([
        this.purchaseEngine.calculate(tenantId),
        this.productionEngine.calculate(tenantId),
      ]);

      // ── 清理旧明细（同批次重算场景，正常情况不存在旧明细） ──────────────
      await AppDataSource.query(
        `DELETE FROM schedule_suggestion_items
         WHERE suggestion_id = ? AND tenant_id = ?`,
        [batchId, tenantId],
      );

      // ── 写入采购建议明细 ─────────────────────────────────────────────────
      for (const item of purchaseResults) {
        await AppDataSource.query(
          `INSERT INTO schedule_suggestion_items
             (tenant_id, suggestion_id, item_type,
              sku_id, suggested_qty, purchase_unit, suggested_supplier_id,
              safety_stock_qty, current_stock_qty, shortage_qty, capital_cost,
              calc_steps, status)
           VALUES (?, ?, 'purchase', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
          [
            tenantId,
            batchId,
            item.skuId,
            item.suggestedQty,
            item.purchaseUnit,
            item.suggestedSupplierId,
            item.safetyStockQty,
            item.currentStock,
            item.shortageQty,
            item.capitalCost,
            JSON.stringify(item.calcSteps),
          ],
        );
      }

      // ── 写入排产建议明细 ─────────────────────────────────────────────────
      for (const item of productionResults) {
        await AppDataSource.query(
          `INSERT INTO schedule_suggestion_items
             (tenant_id, suggestion_id, item_type,
              production_order_id, deadline_score, priority_score,
              material_score, total_score, suggested_rank,
              suggested_workers, calc_steps, status)
           VALUES (?, ?, 'production', ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
          [
            tenantId,
            batchId,
            item.productionOrderId,
            item.deadlineScore,
            item.priorityScore,
            item.materialScore,
            item.totalScore,
            item.suggestedRank,
            JSON.stringify(item.suggestedWorkers),
            JSON.stringify(item.calcSteps),
          ],
        );
      }

      // ── 更新批次状态为 completed ─────────────────────────────────────────
      await AppDataSource.query(
        `UPDATE schedule_suggestions
         SET status = 'completed',
             purchase_count = ?,
             production_count = ?,
             calc_finished_at = NOW(),
             error_message = NULL,
             updated_by = ?
         WHERE id = ? AND tenant_id = ?`,
        [purchaseResults.length, productionResults.length, 0, batchId, tenantId],
      );

      console.info(
        `[ScheduleSuggestionService] 批次 #${batchId} 计算完成：` +
          `采购建议 ${purchaseResults.length} 条，排产建议 ${productionResults.length} 条`,
      );
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[ScheduleSuggestionService] 批次 #${batchId} 计算失败:`, errMsg);

      await AppDataSource.query(
        `UPDATE schedule_suggestions
         SET status = 'failed',
             calc_finished_at = NOW(),
             error_message = ?,
             updated_by = ?
         WHERE id = ? AND tenant_id = ?`,
        [errMsg.slice(0, 2000), 0, batchId, tenantId],
      );

      // 向上抛出，让 Worker 知道任务失败
      throw err;
    }
  }

  // ─── getLatest ───────────────────────────────────────────────────────────────

  /**
   * 获取最近一次计算完成的批次及其明细
   * - purchase 角色：仅返回 item_type='purchase' 的明细
   * - supervisor/boss：返回全部明细
   */
  async getLatest(): Promise<{
    batch: ScheduleSuggestionRow | null;
    items: ScheduleSuggestionItemRow[];
  }> {
    const [batch] = await AppDataSource.query<ScheduleSuggestionRow[]>(
      `SELECT * FROM schedule_suggestions
       WHERE tenant_id = ? AND status = 'completed'
       ORDER BY created_at DESC
       LIMIT 1`,
      [this.tenantId],
    );

    if (!batch) {
      return { batch: null, items: [] };
    }

    // 角色过滤：purchase 角色只看采购建议
    const isPurchaseOnly =
      this.roles.includes('purchase') &&
      !this.roles.includes('supervisor') &&
      !this.roles.includes('boss');

    const itemTypeCond = isPurchaseOnly ? `AND ssi.item_type = 'purchase'` : '';

    const items = await AppDataSource.query<ScheduleSuggestionItemRow[]>(
      `SELECT ssi.*,
              s.sku_code, s.name AS sku_name,
              sup.name AS supplier_name,
              po.work_order_no
       FROM schedule_suggestion_items ssi
       LEFT JOIN skus s ON s.id = ssi.sku_id AND s.tenant_id = ssi.tenant_id
       LEFT JOIN suppliers sup ON sup.id = ssi.suggested_supplier_id
       LEFT JOIN production_orders po
         ON po.id = ssi.production_order_id AND po.tenant_id = ssi.tenant_id
       WHERE ssi.suggestion_id = ? AND ssi.tenant_id = ?
       ${itemTypeCond}
       ORDER BY COALESCE(ssi.suggested_rank, 9999) ASC, ssi.id ASC`,
      [batch.id, this.tenantId],
    );

    return { batch, items };
  }

  // ─── getStatus ───────────────────────────────────────────────────────────────

  /**
   * 查询计算状态
   * - 从 schedule_suggestions 表查询批次信息
   * - 可附加 BullMQ jobId 查询队列状态
   */
  async getStatus(jobId?: string): Promise<{
    batch: ScheduleSuggestionRow | null;
    jobState: string | null;
  }> {
    let batch: ScheduleSuggestionRow | null = null;

    if (jobId) {
      const [row] = await AppDataSource.query<ScheduleSuggestionRow[]>(
        `SELECT * FROM schedule_suggestions
         WHERE tenant_id = ? AND job_id = ?
         ORDER BY created_at DESC LIMIT 1`,
        [this.tenantId, jobId],
      );
      batch = row ?? null;
    } else {
      // 无 jobId 时返回最近一条批次
      const [row] = await AppDataSource.query<ScheduleSuggestionRow[]>(
        `SELECT * FROM schedule_suggestions
         WHERE tenant_id = ?
         ORDER BY created_at DESC LIMIT 1`,
        [this.tenantId],
      );
      batch = row ?? null;
    }

    // 尝试从 BullMQ 获取 job 状态
    let jobState: string | null = null;
    const targetJobId = jobId ?? batch?.job_id ?? null;
    if (targetJobId) {
      try {
        const job = await queueService.getJobStatus(QUEUE_SUGGESTION_CALCULATE, targetJobId);
        jobState = job ? await job.getState() : null;
      } catch {
        // BullMQ 不可用时忽略，以数据库状态为准
      }
    }

    return { batch, jobState };
  }

  // ─── getHistory ──────────────────────────────────────────────────────────────

  /**
   * 历史批次分页查询
   */
  async getHistory(
    page: number,
    pageSize: number,
  ): Promise<{ list: ScheduleSuggestionRow[]; total: number }> {
    const offset = (page - 1) * pageSize;

    const [list, countRows] = await Promise.all([
      AppDataSource.query<ScheduleSuggestionRow[]>(
        `SELECT * FROM schedule_suggestions
         WHERE tenant_id = ?
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?`,
        [this.tenantId, pageSize, offset],
      ),
      AppDataSource.query<Array<{ total: number }>>(
        `SELECT COUNT(*) AS total FROM schedule_suggestions WHERE tenant_id = ?`,
        [this.tenantId],
      ),
    ]);

    return { list, total: Number(countRows[0]?.total ?? 0) };
  }

  // ─── getHistoryDetail ────────────────────────────────────────────────────────

  /**
   * 获取历史批次详情（含明细列表）
   */
  async getHistoryDetail(suggestionId: number): Promise<{
    batch: ScheduleSuggestionRow;
    items: ScheduleSuggestionItemRow[];
  }> {
    const [batch] = await AppDataSource.query<ScheduleSuggestionRow[]>(
      `SELECT * FROM schedule_suggestions
       WHERE id = ? AND tenant_id = ? LIMIT 1`,
      [suggestionId, this.tenantId],
    );
    if (!batch) {
      throw AppError.notFound(`调度批次 #${suggestionId} 不存在`, ResponseCode.NOT_FOUND);
    }

    const items = await AppDataSource.query<ScheduleSuggestionItemRow[]>(
      `SELECT ssi.*,
              s.sku_code, s.name AS sku_name,
              sup.name AS supplier_name,
              po.work_order_no
       FROM schedule_suggestion_items ssi
       LEFT JOIN skus s ON s.id = ssi.sku_id AND s.tenant_id = ssi.tenant_id
       LEFT JOIN suppliers sup ON sup.id = ssi.suggested_supplier_id
       LEFT JOIN production_orders po
         ON po.id = ssi.production_order_id AND po.tenant_id = ssi.tenant_id
       WHERE ssi.suggestion_id = ? AND ssi.tenant_id = ?
       ORDER BY COALESCE(ssi.suggested_rank, 9999) ASC, ssi.id ASC`,
      [suggestionId, this.tenantId],
    );

    return { batch, items };
  }

  // ─── acceptItem ──────────────────────────────────────────────────────────────

  /**
   * 接受建议
   * - 若提供 modifiedQty，则更新 suggested_qty 并记录 action='modify'
   * - 否则记录 action='accept'
   */
  async acceptItem(itemId: number, modifiedQty?: string): Promise<void> {
    const item = await this.findItem(itemId);

    if (item.status !== 'pending') {
      throw AppError.badRequest(
        `建议 #${itemId} 状态为 "${item.status}"，不允许重复操作`,
        ResponseCode.INVALID_PARAMS,
      );
    }

    const action = modifiedQty ? 'modify' : 'accept';
    const newStatus = modifiedQty ? 'modified' : 'accepted';

    const oldValue: Record<string, unknown> = { status: item.status };
    const newValue: Record<string, unknown> = { status: newStatus };

    if (modifiedQty) {
      oldValue.suggested_qty = item.suggested_qty;
      newValue.suggested_qty = modifiedQty;

      await AppDataSource.query(
        `UPDATE schedule_suggestion_items
         SET status = ?, suggested_qty = ?, updated_at = NOW()
         WHERE id = ? AND tenant_id = ?`,
        [newStatus, modifiedQty, itemId, this.tenantId],
      );
    } else {
      await AppDataSource.query(
        `UPDATE schedule_suggestion_items
         SET status = ?, updated_at = NOW()
         WHERE id = ? AND tenant_id = ?`,
        [newStatus, itemId, this.tenantId],
      );
    }

    await this.writeAuditLog(itemId, action, oldValue, newValue, null);
  }

  // ─── rejectItem ──────────────────────────────────────────────────────────────

  /**
   * 驳回建议
   */
  async rejectItem(itemId: number, reason: string): Promise<void> {
    const item = await this.findItem(itemId);

    if (item.status !== 'pending') {
      throw AppError.badRequest(
        `建议 #${itemId} 状态为 "${item.status}"，不允许重复操作`,
        ResponseCode.INVALID_PARAMS,
      );
    }

    const oldValue = { status: item.status };
    const newValue = { status: 'rejected', reason };

    await AppDataSource.query(
      `UPDATE schedule_suggestion_items
       SET status = 'rejected', updated_at = NOW()
       WHERE id = ? AND tenant_id = ?`,
      [itemId, this.tenantId],
    );

    await this.writeAuditLog(itemId, 'reject', oldValue, newValue, reason);
  }

  // ─── applyProductionSuggestion ───────────────────────────────────────────────

  /**
   * 应用排产建议（仅更新 production_orders.priority_score）
   * 约束：仅允许操作 item_type='production' 的明细
   */
  async applyProductionSuggestion(itemId: number): Promise<void> {
    const item = await this.findItem(itemId);

    if (item.item_type !== 'production') {
      throw AppError.badRequest(
        `建议 #${itemId} 不是排产建议，无法应用`,
        ResponseCode.INVALID_PARAMS,
      );
    }
    if (!item.production_order_id) {
      throw AppError.badRequest(
        `建议 #${itemId} 未关联生产工单`,
        ResponseCode.INVALID_PARAMS,
      );
    }

    const oldValue = { status: item.status };

    // 将 total_score 写入 production_orders.priority_score
    // （作为排产优先级参考，生产调度系统可按此字段排序）
    if (item.total_score !== null) {
      await AppDataSource.query(
        `UPDATE production_orders
         SET priority_score = ?, updated_at = NOW()
         WHERE id = ? AND tenant_id = ?`,
        [item.total_score, item.production_order_id, this.tenantId],
      );
    }

    // 更新建议状态
    await AppDataSource.query(
      `UPDATE schedule_suggestion_items
       SET status = 'accepted', updated_at = NOW()
       WHERE id = ? AND tenant_id = ?`,
      [itemId, this.tenantId],
    );

    const newValue = {
      status: 'accepted',
      applied_priority_score: item.total_score,
      production_order_id: item.production_order_id,
    };

    await this.writeAuditLog(itemId, 'apply', oldValue, newValue, null);
  }

  // ─── getPurchaseSteps ────────────────────────────────────────────────────────

  /**
   * 获取采购建议明细的计算步骤（calc_steps JSON）
   */
  async getPurchaseSteps(purchaseSuggestionItemId: number): Promise<{
    item: ScheduleSuggestionItemRow;
    calcSteps: unknown;
  }> {
    const [item] = await AppDataSource.query<ScheduleSuggestionItemRow[]>(
      `SELECT ssi.*,
              s.sku_code, s.name AS sku_name,
              sup.name AS supplier_name
       FROM schedule_suggestion_items ssi
       LEFT JOIN skus s ON s.id = ssi.sku_id AND s.tenant_id = ssi.tenant_id
       LEFT JOIN suppliers sup ON sup.id = ssi.suggested_supplier_id
       WHERE ssi.id = ? AND ssi.tenant_id = ? AND ssi.item_type = 'purchase'
       LIMIT 1`,
      [purchaseSuggestionItemId, this.tenantId],
    );

    if (!item) {
      throw AppError.notFound(
        `采购建议明细 #${purchaseSuggestionItemId} 不存在`,
        ResponseCode.NOT_FOUND,
      );
    }

    // calc_steps 存储为 JSON 字符串或对象，统一解析
    let calcSteps: unknown = item.calc_steps;
    if (typeof calcSteps === 'string') {
      try {
        calcSteps = JSON.parse(calcSteps);
      } catch {
        calcSteps = [];
      }
    }

    return { item, calcSteps };
  }

  // ─── 私有辅助方法 ────────────────────────────────────────────────────────────

  private async findItem(itemId: number): Promise<ScheduleSuggestionItemRow> {
    const [item] = await AppDataSource.query<ScheduleSuggestionItemRow[]>(
      `SELECT * FROM schedule_suggestion_items
       WHERE id = ? AND tenant_id = ? LIMIT 1`,
      [itemId, this.tenantId],
    );
    if (!item) {
      throw AppError.notFound(`调度建议明细 #${itemId} 不存在`, ResponseCode.NOT_FOUND);
    }
    return item;
  }

  private async writeAuditLog(
    itemId: number,
    action: 'accept' | 'modify' | 'reject' | 'apply',
    oldValue: Record<string, unknown> | null,
    newValue: Record<string, unknown> | null,
    reason: string | null,
  ): Promise<void> {
    await AppDataSource.query(
      `INSERT INTO suggestion_audit_logs
         (tenant_id, suggestion_item_id, action, old_value, new_value, reason, operated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        this.tenantId,
        itemId,
        action,
        oldValue ? JSON.stringify(oldValue) : null,
        newValue ? JSON.stringify(newValue) : null,
        reason,
        this.userId,
      ],
    );
  }
}
