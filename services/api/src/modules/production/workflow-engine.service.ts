import Decimal from 'decimal.js';
import { EntityManager } from 'typeorm';
import { TenantContext } from '../../shared/BaseRepository';

interface TaskRow {
  production_order_id: number;
  process_step_id: number;
}

interface ProcessStepRow {
  id: number;
  step_no: number;
  template_id: number;
  output_type: 'semi_finished' | 'final_product' | 'none' | null;
  output_sku_id: number | null;
}

interface OrderRow {
  id: number;
  qty_planned: string;
  process_template_id: number;
  bom_snapshot_id: number | null;
}

interface SiblingTaskRow {
  id: number;
  status: string;
}

interface NextStepRow {
  id: number;
  step_no: number;
}

interface NextTaskRow {
  id: number;
  status: string;
  process_step_id: number;
}

interface CountRow {
  total: string;
}

/**
 * 工序完工工作流引擎
 * 在 completeTask 事务内调用，处理：
 *   1. 半成品自动入库（写入 inventory_transactions，更新 inventory）
 *   2. 下道工序解锁（前置工序全部 completed 后，将下道工序任务解锁为 pending）
 *   3. 工单完工检测（所有工序完成后更新工单状态为 completed，并汇总 qty_completed）
 */
export class WorkflowEngineService {
  private readonly tenantId: number;
  private readonly userId: number;

  constructor(ctx: TenantContext) {
    this.tenantId = ctx.tenantId;
    this.userId = ctx.userId;
  }

  /**
   * 任务完工后触发的工作流逻辑
   * @param taskId       完工任务 ID
   * @param completedQty 本次完工数量
   * @param manager      事务管理器（必须在 completeTask 事务内传入）
   */
  async onTaskCompleted(
    taskId: number,
    completedQty: string,
    manager: EntityManager,
  ): Promise<void> {
    // Step 1: 查询任务关联的工单 + 工序信息
    const taskRows: TaskRow[] = await manager.query(
      `SELECT production_order_id, process_step_id
       FROM production_tasks
       WHERE id = ? AND tenant_id = ? LIMIT 1`,
      [taskId, this.tenantId],
    );

    if (taskRows.length === 0) return;
    const task = taskRows[0];

    // Step 2: 查询工序步骤定义（获取 output_type、output_sku_id、step_no、template_id）
    const stepRows: ProcessStepRow[] = await manager.query(
      `SELECT id, step_no, template_id, output_type, output_sku_id
       FROM process_steps
       WHERE id = ? AND tenant_id = ? LIMIT 1`,
      [task.process_step_id, this.tenantId],
    );

    if (stepRows.length === 0) return;
    const step = stepRows[0];

    // Step 3: 半成品入库
    if (step.output_type === 'semi_finished' && step.output_sku_id) {
      await this._handleSemiFinishedInventory(
        task.production_order_id,
        step.output_sku_id,
        completedQty,
        manager,
      );
    }

    // Step 4: 解锁下道工序任务
    await this._unlockNextStep(
      task.production_order_id,
      step.step_no,
      step.template_id,
      manager,
    );

    // Step 5: 检查工单是否全部完工
    await this._checkOrderCompletion(task.production_order_id, completedQty, manager);
  }

  // ── 私有方法 ────────────────────────────────────────────────────────────

  /**
   * 写入半成品入库事务记录并更新库存
   */
  private async _handleSemiFinishedInventory(
    productionOrderId: number,
    outputSkuId: number,
    completedQty: string,
    manager: EntityManager,
  ): Promise<void> {
    const today = new Date();
    const dateStr = [
      today.getFullYear(),
      String(today.getMonth() + 1).padStart(2, '0'),
      String(today.getDate()).padStart(2, '0'),
    ].join('');
    const rand = Math.floor(Math.random() * 9999).toString().padStart(4, '0');
    const transactionNo = `TX-${dateStr}-${rand}`;

    // 写入库存流水（半成品生产入库）
    await manager.query(
      `INSERT INTO inventory_transactions
         (tenant_id, transaction_no, sku_id, transaction_type, direction,
          qty_input, input_unit, qty_stock_unit, stock_unit,
          reference_type, reference_id, production_order_id,
          created_by, updated_by)
       VALUES (?, ?, ?, 'PRODUCTION_IN', 'IN', ?, '件', ?, '件',
               'production_order', ?, ?, ?, ?)`,
      [
        this.tenantId,
        transactionNo,
        outputSkuId,
        completedQty,
        completedQty,
        productionOrderId,
        productionOrderId,
        this.userId,
        this.userId,
      ],
    );

    // 更新库存（UPSERT：若无库存记录则插入，有则累加）
    await manager.query(
      `INSERT INTO inventory (tenant_id, sku_id, qty_on_hand, qty_reserved, qty_in_transit, last_in_at)
       VALUES (?, ?, ?, 0, 0, NOW())
       ON DUPLICATE KEY UPDATE
         qty_on_hand = qty_on_hand + VALUES(qty_on_hand),
         last_in_at  = NOW()`,
      [this.tenantId, outputSkuId, completedQty],
    );
  }

  /**
   * 检查前置工序是否全部完成，若是则解锁下道工序任务
   */
  private async _unlockNextStep(
    productionOrderId: number,
    currentStepNo: number,
    templateId: number,
    manager: EntityManager,
  ): Promise<void> {
    // 查询当前工序在同一工单内的所有同步任务（同一工序可能有多任务）
    const siblingTasks: SiblingTaskRow[] = await manager.query(
      `SELECT pt.id, pt.status
       FROM production_tasks pt
       INNER JOIN process_steps ps ON ps.id = pt.process_step_id
       WHERE pt.production_order_id = ? AND pt.tenant_id = ?
         AND ps.step_no = ? AND ps.template_id = ?`,
      [productionOrderId, this.tenantId, currentStepNo, templateId],
    );

    // 若当前工序还有未完成任务，不解锁下道工序
    const allCurrentCompleted = siblingTasks.every(
      (t) => t.status === 'completed' || t.status === 'cancelled',
    );
    if (!allCurrentCompleted) return;

    // 查询下道工序步骤（step_no + 1）
    const nextStepRows: NextStepRow[] = await manager.query(
      `SELECT id, step_no FROM process_steps
       WHERE template_id = ? AND tenant_id = ? AND step_no = ?
       LIMIT 1`,
      [templateId, this.tenantId, currentStepNo + 1],
    );

    if (nextStepRows.length === 0) return;

    const nextStep = nextStepRows[0];

    // 查询下道工序对应的任务（可能处于 suspended 或其他阻塞状态）
    const nextTasks: NextTaskRow[] = await manager.query(
      `SELECT pt.id, pt.status, pt.process_step_id
       FROM production_tasks pt
       WHERE pt.production_order_id = ? AND pt.tenant_id = ?
         AND pt.process_step_id = ?
         AND pt.status NOT IN ('completed', 'cancelled', 'started')`,
      [productionOrderId, this.tenantId, nextStep.id],
    );

    if (nextTasks.length === 0) return;

    // 解锁为 pending
    const nextTaskIds = nextTasks.map((t) => t.id);
    const placeholders = nextTaskIds.map(() => '?').join(',');
    await manager.query(
      `UPDATE production_tasks
       SET status = 'pending', updated_by = ?
       WHERE id IN (${placeholders}) AND tenant_id = ?`,
      [this.userId, ...nextTaskIds, this.tenantId],
    );
  }

  /**
   * 检查工单所有工序任务是否全部完成，若是则更新工单状态为 completed
   */
  private async _checkOrderCompletion(
    productionOrderId: number,
    completedQty: string,
    manager: EntityManager,
  ): Promise<void> {
    // 统计未完成任务数
    const countRows: CountRow[] = await manager.query(
      `SELECT COUNT(*) AS total
       FROM production_tasks
       WHERE production_order_id = ? AND tenant_id = ?
         AND status NOT IN ('completed', 'cancelled')`,
      [productionOrderId, this.tenantId],
    );

    const remaining = Number(countRows[0]?.total ?? 1);
    if (remaining > 0) return;

    // 查询工单计划数量（用于完工汇总）
    const orderRows: OrderRow[] = await manager.query(
      `SELECT id, qty_planned FROM production_orders
       WHERE id = ? AND tenant_id = ? LIMIT 1`,
      [productionOrderId, this.tenantId],
    );

    if (orderRows.length === 0) return;

    const order = orderRows[0];

    // 汇总所有已完工任务的完成数量
    const sumRows: Array<{ total_completed: string }> = await manager.query(
      `SELECT COALESCE(SUM(completed_qty), 0) AS total_completed
       FROM production_tasks
       WHERE production_order_id = ? AND tenant_id = ? AND status = 'completed'`,
      [productionOrderId, this.tenantId],
    );

    const totalCompleted = new Decimal(sumRows[0]?.total_completed ?? '0');

    await manager.query(
      `UPDATE production_orders
       SET status = 'completed',
           qty_completed = ?,
           actual_end = NOW(),
           updated_by = ?
       WHERE id = ? AND tenant_id = ? AND status != 'cancelled'`,
      [
        totalCompleted.toFixed(4),
        this.userId,
        productionOrderId,
        this.tenantId,
      ],
    );
  }
}
