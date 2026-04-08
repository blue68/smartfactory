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
  // 联表字段（查询明细时附带）
  sku_code?: string | null;
  sku_name?: string | null;
  supplier_name?: string | null;
  work_order_no?: string | null;
  production_sku_name?: string | null;
  sales_order_no?: string | null;
  expected_delivery?: string | null;
}

type SuggestionItemStatus = 'pending' | 'accepted' | 'rejected' | 'applied';
type SuggestionSource = 'ai_schedule' | 'shortage_trigger' | 'manual';
type ScheduleJobStatus = 'pending' | 'running' | 'completed' | 'failed';

interface PurchaseSuggestionItemDTO {
  id: number;
  skuCode: string;
  skuName: string;
  suggestedQty: string;
  unit: string;
  supplierName: string | null;
  estimatedAmount: string | null;
  reason: string;
  neededByDate: string | null;
  status: SuggestionItemStatus;
  source: SuggestionSource;
}

interface WorkOrderSuggestionItemDTO {
  id: number;
  workOrderNo: string;
  skuName: string;
  totalScore: number;
  rank: number;
  deadlineScore: number;
  priorityScore: number;
  materialReadinessScore: number;
  recommendedWorkerId: number | null;
  recommendedWorkerName: string | null;
  recommendedWorkerSkill: string | null;
  status: SuggestionItemStatus;
}

interface SuggestionBatchDTO {
  batchId: string;
  calculatedAt: string;
  purchaseItems: PurchaseSuggestionItemDTO[];
  productionItems: WorkOrderSuggestionItemDTO[];
  isColdStart: boolean;
  summary: {
    totalPurchaseItems: number;
    totalProductionItems: number;
    estimatedTotalAmount: string | null;
  };
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
  ): Promise<{ batchId: number; batchNo: string; jobId: string }> {
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

    // 将 jobId 回写到批次记录；当 Redis/BullMQ 不可用时同步降级执行计算
    const jobId =
      job?.id != null
        ? String(job.id)
        : `schedule-suggestion-sync-${batchId}-${Date.now()}`;

    await AppDataSource.query(
      `UPDATE schedule_suggestions SET job_id = ?, updated_by = ?
       WHERE id = ? AND tenant_id = ?`,
      [jobId, this.userId, batchId, this.tenantId],
    );

    // Redis 不可用时，fallback emitter 当前未注册建议计算消费者，改为同步执行，保证“触发计算”可用
    if (!job) {
      await this.executeCalculation(batchId, this.tenantId);
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

    // CR-S4-003 fix: 乐观锁防并发竞态（TOCTOU）
    // 使用 WHERE status='pending' 原子性检查+更新，affectedRows=0 说明已被其他 Worker 抢占
    const updateResult = await AppDataSource.query(
      `UPDATE schedule_suggestions
       SET status = 'calculating', calc_started_at = NOW(), updated_by = ?
       WHERE id = ? AND tenant_id = ? AND status = 'pending'`,
      [0, batchId, tenantId],
    );
    if (updateResult.affectedRows === 0) {
      console.warn(`[ScheduleSuggestionService] 批次 #${batchId} 已被其他 Worker 处理或状态非 pending，跳过`);
      return;
    }

    try {
      // ── 执行两个引擎计算 ──────────────────────────────────────────────────
      const [purchaseResults, productionResults] = await Promise.all([
        this.purchaseEngine.calculate(tenantId),
        this.productionEngine.calculate(tenantId),
      ]);

      // CR-S4-005 fix: 事务包裹明细写入，防止 partial write
      await AppDataSource.transaction(async (manager) => {
        // 清理旧明细（同批次重算场景）
        await manager.query(
          `DELETE FROM schedule_suggestion_items
           WHERE suggestion_id = ? AND tenant_id = ?`,
          [batchId, tenantId],
        );

        // 写入采购建议明细
        for (const item of purchaseResults) {
          await manager.query(
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

        // 写入排产建议明细
        for (const item of productionResults) {
          await manager.query(
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

        // 更新批次状态为 completed
        await manager.query(
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
      });

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
  async getLatest(): Promise<SuggestionBatchDTO | null> {
    const [batch] = await AppDataSource.query<ScheduleSuggestionRow[]>(
      `SELECT * FROM schedule_suggestions
       WHERE tenant_id = ? AND status = 'completed'
       ORDER BY created_at DESC
       LIMIT 1`,
      [this.tenantId],
    );

    if (!batch) return null;

    const items = await this.queryBatchItems(batch.id, this.isPurchaseOnlyRole());
    return this.mapBatchToDTO(batch, items);
  }

  // ─── getStatus ───────────────────────────────────────────────────────────────

  /**
   * 查询计算状态
   * - 从 schedule_suggestions 表查询批次信息
   * - 可附加 BullMQ jobId 查询队列状态
   */
  async getStatus(jobId?: string): Promise<{
    jobId: string;
    status: ScheduleJobStatus;
    progress?: number;
    errorMessage?: string;
    batchId?: string;
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

    const status = this.resolveCalculationStatus(batch?.status, jobState);
    const responseJobId = (jobId ?? batch?.job_id ?? '').toString();

    return {
      jobId: responseJobId,
      status,
      progress:
        status === 'completed'
          ? 100
          : status === 'running'
          ? 60
          : status === 'pending'
          ? 10
          : undefined,
      errorMessage: batch?.error_message ?? undefined,
      batchId: batch ? String(batch.id) : undefined,
    };
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
  async getHistoryDetail(suggestionId: number): Promise<SuggestionBatchDTO> {
    const [batch] = await AppDataSource.query<ScheduleSuggestionRow[]>(
      `SELECT * FROM schedule_suggestions
       WHERE id = ? AND tenant_id = ? LIMIT 1`,
      [suggestionId, this.tenantId],
    );
    if (!batch) {
      throw AppError.notFound(`调度批次 #${suggestionId} 不存在`, ResponseCode.NOT_FOUND);
    }

    const items = await this.queryBatchItems(suggestionId, this.isPurchaseOnlyRole());
    return this.mapBatchToDTO(batch, items);
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

  private isPurchaseOnlyRole(): boolean {
    return (
      this.roles.includes('purchase') &&
      !this.roles.includes('supervisor') &&
      !this.roles.includes('boss')
    );
  }

  private async queryBatchItems(
    suggestionId: number,
    purchaseOnly: boolean,
  ): Promise<ScheduleSuggestionItemRow[]> {
    const params: unknown[] = [suggestionId, this.tenantId];
    let itemTypeFilter = '';
    if (purchaseOnly) {
      itemTypeFilter = 'AND ssi.item_type = ?';
      params.push('purchase');
    }

    return AppDataSource.query<ScheduleSuggestionItemRow[]>(
      `SELECT ssi.*,
              s.sku_code,
              s.name AS sku_name,
              sup.name AS supplier_name,
              po.work_order_no,
              so.expected_delivery,
              so.order_no AS sales_order_no,
              psku.name AS production_sku_name
       FROM schedule_suggestion_items ssi
       LEFT JOIN skus s ON s.id = ssi.sku_id AND s.tenant_id = ssi.tenant_id
       LEFT JOIN suppliers sup ON sup.id = ssi.suggested_supplier_id
       LEFT JOIN production_orders po
         ON po.id = ssi.production_order_id AND po.tenant_id = ssi.tenant_id
       LEFT JOIN sales_orders so
         ON so.id = po.sales_order_id AND so.tenant_id = po.tenant_id
       LEFT JOIN skus psku
         ON psku.id = po.sku_id AND psku.tenant_id = po.tenant_id
       WHERE ssi.suggestion_id = ? AND ssi.tenant_id = ?
       ${itemTypeFilter}
       ORDER BY COALESCE(ssi.suggested_rank, 9999) ASC, ssi.id ASC`,
      params,
    );
  }

  private mapBatchToDTO(
    batch: ScheduleSuggestionRow,
    items: ScheduleSuggestionItemRow[],
  ): SuggestionBatchDTO {
    const source: SuggestionSource =
      batch.trigger_type === 'event'
        ? 'shortage_trigger'
        : batch.trigger_type === 'manual'
        ? 'manual'
        : 'ai_schedule';

    const purchaseRows = items.filter((item) => item.item_type === 'purchase');
    const productionRows = items.filter((item) => item.item_type === 'production');

    const purchaseItems: PurchaseSuggestionItemDTO[] = purchaseRows.map((item) => ({
      id: Number(item.id),
      skuCode: item.sku_code ?? (item.sku_id ? `SKU-${item.sku_id}` : '—'),
      skuName: item.sku_name ?? (item.sku_id ? `SKU#${item.sku_id}` : '未知物料'),
      suggestedQty: item.suggested_qty ?? '0',
      unit: item.purchase_unit ?? '',
      supplierName: item.supplier_name ?? null,
      estimatedAmount: item.capital_cost ?? null,
      reason: this.buildPurchaseReason(item),
      neededByDate: null,
      status: this.normalizeItemStatus(item.status),
      source,
    }));

    const productionItems: WorkOrderSuggestionItemDTO[] = productionRows.map((item, index) => {
      const workers = this.parseJsonArray(item.suggested_workers);
      const firstWorker = workers[0];

      return {
        id: Number(item.id),
        workOrderNo: item.work_order_no ?? (item.production_order_id ? `WO#${item.production_order_id}` : '未知工单'),
        skuName: item.production_sku_name ?? item.sku_name ?? '未关联产品',
        totalScore: Number(item.total_score ?? 0),
        rank: Number(item.suggested_rank ?? index + 1),
        deadlineScore: Number(item.deadline_score ?? 0),
        priorityScore: Number(item.priority_score ?? 0),
        materialReadinessScore: Number(item.material_score ?? 0),
        recommendedWorkerId: this.readNumber(firstWorker, ['workerId', 'worker_id']),
        recommendedWorkerName: this.readString(firstWorker, ['workerName', 'name', 'worker_name']),
        recommendedWorkerSkill: this.readString(firstWorker, ['skillLevel', 'skill_level', 'skill']),
        status: this.normalizeItemStatus(item.status),
      };
    });

    const estimatedTotalAmount = purchaseItems.reduce((sum, item) => {
      const value = Number(item.estimatedAmount ?? 0);
      return sum + (Number.isNaN(value) ? 0 : value);
    }, 0);

    return {
      batchId: String(batch.id),
      calculatedAt: batch.calc_finished_at ?? batch.updated_at ?? batch.created_at,
      purchaseItems,
      productionItems,
      isColdStart: batch.trigger_type !== 'manual',
      summary: {
        totalPurchaseItems: purchaseItems.length,
        totalProductionItems: productionItems.length,
        estimatedTotalAmount: estimatedTotalAmount > 0 ? estimatedTotalAmount.toFixed(2) : null,
      },
    };
  }

  private buildPurchaseReason(item: ScheduleSuggestionItemRow): string {
    const unit = item.purchase_unit ?? '';
    const shortage = item.shortage_qty ?? '0';
    const safetyStock = item.safety_stock_qty ?? '0';
    const currentStock = item.current_stock_qty ?? '0';
    return `净缺口 ${shortage}${unit}，安全库存 ${safetyStock}${unit}，当前库存 ${currentStock}${unit}`;
  }

  private normalizeItemStatus(status: string): SuggestionItemStatus {
    if (status === 'modified') return 'accepted';
    if (status === 'accepted' || status === 'rejected' || status === 'applied') return status;
    return 'pending';
  }

  private resolveCalculationStatus(
    batchStatus?: string | null,
    jobState?: string | null,
  ): ScheduleJobStatus {
    if (batchStatus === 'completed') return 'completed';
    if (batchStatus === 'failed') return 'failed';
    if (batchStatus === 'calculating') return 'running';
    if (batchStatus === 'pending') return 'pending';

    if (!jobState) return 'pending';
    if (jobState === 'completed') return 'completed';
    if (jobState === 'failed') return 'failed';
    if (jobState === 'active') return 'running';
    return 'pending';
  }

  private parseJsonArray(value: unknown): Record<string, unknown>[] {
    if (Array.isArray(value)) {
      return value.filter((item) => item && typeof item === 'object') as Record<string, unknown>[];
    }
    if (typeof value === 'string' && value.trim()) {
      try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) {
          return parsed.filter((item) => item && typeof item === 'object') as Record<string, unknown>[];
        }
      } catch {
        return [];
      }
    }
    return [];
  }

  private readString(
    obj: Record<string, unknown> | undefined,
    keys: string[],
  ): string | null {
    if (!obj) return null;
    for (const key of keys) {
      const value = obj[key];
      if (typeof value === 'string' && value.trim()) return value;
    }
    return null;
  }

  private readNumber(
    obj: Record<string, unknown> | undefined,
    keys: string[],
  ): number | null {
    if (!obj) return null;
    for (const key of keys) {
      const value = obj[key];
      const num = typeof value === 'number' ? value : Number(value);
      if (!Number.isNaN(num) && Number.isFinite(num)) return num;
    }
    return null;
  }

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
