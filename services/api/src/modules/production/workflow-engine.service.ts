import Decimal from 'decimal.js';
import { EntityManager } from 'typeorm';
import { TenantContext } from '../../shared/BaseRepository';
import { generateNo } from '../../shared/generateNo';
import { resolveWarehouseLocationBinding } from '../inventory/warehouse-location.resolver';

interface TaskRow {
  production_order_id: number;
  process_step_id: number;
  resolved_output_sku_id: number | null;
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

interface CompletionWorkflowOptions {
  syncOrderCompletion?: boolean;
}

type InventorySnapshotTrackedManager = EntityManager & {
  __inventorySnapshotSkuIds?: Set<number>;
};

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
    options: CompletionWorkflowOptions = {},
  ): Promise<void> {
    const { syncOrderCompletion = true } = options;

    // Step 1: 查询任务关联的工单 + 工序信息
    const taskRows: TaskRow[] = await manager.query(
      `SELECT
          pt.production_order_id,
          pt.process_step_id,
          COALESCE(poc.resolved_sku_id, po.output_sku_id, pt.output_sku_id) AS resolved_output_sku_id
       FROM production_tasks pt
       LEFT JOIN production_operations po
         ON po.id = pt.operation_id
        AND po.tenant_id = pt.tenant_id
       LEFT JOIN production_order_components poc
         ON poc.id = po.component_id
        AND poc.tenant_id = po.tenant_id
       WHERE pt.id = ? AND pt.tenant_id = ? LIMIT 1`,
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
    if (step.output_type === 'semi_finished' && task.resolved_output_sku_id) {
      await this._handleSemiFinishedInventory(
        taskId,
        task.production_order_id,
        task.resolved_output_sku_id,
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
    if (syncOrderCompletion) {
      await this._checkOrderCompletion(task.production_order_id, completedQty, manager);
    }
  }

  // ── 私有方法 ────────────────────────────────────────────────────────────

  /**
   * 写入半成品入库事务记录并更新库存
   */
  private async _handleSemiFinishedInventory(
    taskId: number,
    productionOrderId: number,
    outputSkuId: number,
    completedQty: string,
    manager: EntityManager,
  ): Promise<void> {
    const transactionNo = await generateNo('transaction', this.tenantId);
    const warehouseLocation = await resolveWarehouseLocationBinding({
      manager,
      tenantId: this.tenantId,
      userId: this.userId,
      sourceRef: 'production:workflow:semi_finished',
    });
    const [orderRow] = await manager.query<Array<{ work_order_no: string | null }>>(
      `SELECT work_order_no
       FROM production_orders
       WHERE id = ? AND tenant_id = ?
       LIMIT 1`,
      [productionOrderId, this.tenantId],
    );
    const workOrderNo = orderRow?.work_order_no ?? `WO#${productionOrderId}`;
    const notes = `生产工单 ${workOrderNo} 任务#${taskId} 工序完工，半成品自动入库`;

    const [existingTxRow] = await manager.query<Array<{ cnt: string }>>(
      `SELECT COUNT(*) AS cnt
       FROM inventory_transactions
       WHERE tenant_id = ?
         AND transaction_type = 'PRODUCTION_IN'
         AND reference_type = 'production_order'
         AND reference_id = ?
         AND sku_id = ?
         AND notes = ?`,
      [this.tenantId, productionOrderId, outputSkuId, notes],
    );

    if (Number(existingTxRow?.cnt ?? 0) > 0) {
      await this._syncInventoryDailySnapshot(manager, outputSkuId);
      return;
    }

    // 写入库存流水（半成品生产入库）
    await manager.query(
      `INSERT INTO inventory_transactions
         (tenant_id, transaction_no, sku_id, transaction_type, direction,
          warehouse_id, location_id, source_ref,
          qty_input, input_unit, qty_stock_unit, stock_unit,
          reference_type, reference_id, reference_no, notes, created_by, updated_by)
       VALUES (?, ?, ?, 'PRODUCTION_IN', 'IN', ?, ?, ?, ?, 'pcs', ?, 'pcs',
               'production_order', ?, ?, ?, ?, ?)`,
      [
        this.tenantId,
        transactionNo,
        outputSkuId,
        warehouseLocation.warehouseId,
        warehouseLocation.locationId,
        'production:workflow:semi_finished',
        completedQty,
        completedQty,
        productionOrderId,
        workOrderNo,
        notes,
        this.userId,
        this.userId,
      ],
    );

    // 更新库存（UPSERT：若无库存记录则插入，有则累加）
    await manager.query(
      `INSERT INTO inventory
         (tenant_id, sku_id, warehouse_id, location_id, source_ref,
          qty_on_hand, qty_reserved, qty_in_transit, last_in_at, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, 0, 0, NOW(), ?)
       ON DUPLICATE KEY UPDATE
         qty_on_hand = qty_on_hand + VALUES(qty_on_hand),
         warehouse_id = VALUES(warehouse_id),
         location_id = VALUES(location_id),
         source_ref = VALUES(source_ref),
         last_in_at  = NOW(),
         updated_by = VALUES(updated_by)`,
      [
        this.tenantId,
        outputSkuId,
        warehouseLocation.warehouseId,
        warehouseLocation.locationId,
        'production:workflow:semi_finished',
        completedQty,
        this.userId,
      ],
    );

    await this._syncInventoryDailySnapshot(manager, outputSkuId);
    this._trackInventorySnapshotCacheInvalidation(manager, outputSkuId);
  }

  private async _syncInventoryDailySnapshot(
    manager: EntityManager,
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

  private _trackInventorySnapshotCacheInvalidation(manager: EntityManager, skuId: number): void {
    const trackedManager = manager as InventorySnapshotTrackedManager;
    const tracked = (trackedManager.__inventorySnapshotSkuIds ??= new Set<number>());
    tracked.add(Number(skuId));
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
