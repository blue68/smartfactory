import Decimal from 'decimal.js';
import { AppDataSource } from '../../config/database';
import { TenantContext } from '../../shared/BaseRepository';
import { getRedisClient, RedisKeys, RedisTTL } from '../../config/redis';
import { AppError } from '../../shared/AppError';
import { ResponseCode } from '../../shared/ApiResponse';
import { ProductionPhase1Service } from './production-phase1.service';
import { WorkflowEngineService } from './workflow-engine.service';
import { syncInventoryDailySnapshotForSku } from '../inventory/daily-snapshot.util';
import { resolveWarehouseLocationBinding } from '../inventory/warehouse-location.resolver';

// ─── 类型定义 ──────────────────────────────────────────────────

/** 插单影响分析入参 */
export interface UrgentInsertParams {
  /** 新插单的工艺模板 ID（用于计算总工时） */
  processTemplateId: number;
  /** 新插单的计划数量 */
  qtyPlanned: string;
  /** 新插单将占用的工作站 ID */
  workstationId: number;
  /** 新插单插入后的优先级（高于此值的已有工单不受影响） */
  insertAfterPriority: number;
}

/** 单条受影响工单的分析结果 */
export interface ImpactedOrderResult {
  productionOrderId: number;
  workOrderNo: string;
  skuName: string;
  originalPlannedEnd: string | null;
  delayDays: number;
  newPlannedEnd: string;
  affectsDelivery: boolean;
  expectedDelivery: string;
}

/** 插单影响分析完整响应 */
export interface UrgentInsertImpactResult {
  delayDaysPerOrder: number;
  impactedCount: number;
  workstationName: string;
  dailyCapacity: number;
  urgentTotalHours: string;
  impactedOrders: ImpactedOrderResult[];
}

interface ProductionOrderRow {
  id: number;
  work_order_no: string;
  status: 'pending' | 'scheduled' | 'in_progress' | 'completed' | 'cancelled';
  sku_id: number;
  sku_name: string;
  qty_planned: string;
  priority: number;
  planned_end: string | null;
  sales_order_no: string;
  expected_delivery: string;
  process_template_id: number;
}

interface ProcessStepRow {
  id: number;
  step_no: number;
  step_name: string;
  standard_hours: string;
  workstation_type: string | null;
  workstation_id: number | null;
}

interface WorkerRow {
  id: number;
  real_name: string;
  skill_tags: string | null; // JSON array
}

interface WorkstationRow {
  id: number;
  name: string;
  type: string;
  capacity: number;
}

interface ScheduledOperationRow {
  operation_id: number;
  production_order_id: number;
  component_id: number;
  process_step_id: number;
  output_sku_id: number | null;
  planned_qty: string;
  work_order_no: string;
  step_name: string;
  standard_hours: string;
  workstation_type: string | null;
  workstation_id: number | null;
  output_sku_name: string | null;
}

interface WorkReportSchema {
  workerColumn: 'worker_id' | 'user_id';
  stepColumn: 'process_step_id' | 'step_id';
  dateColumn: 'work_date' | 'report_date';
  qtyColumn: 'qty_completed' | 'qty';
  modern: boolean;
}

export interface SchedulePlan {
  date: string;
  schedules: Array<{
    scheduleId: number;
    productionOrderId: number;
    operationId: number | null;
    componentId: number | null;
    workOrderNo: string;
    processStepId: number;
    stepName: string;
    outputSkuId: number | null;
    outputSkuName: string | null;
    workerId: number | null;
    workerName: string | null;
    workstationId: number | null;
    workstationName: string | null;
    plannedQty: string;
    estimatedHours: string;
    status: 'planned' | 'confirmed';
    updatedAt?: string;
  }>;
  summary: {
    totalOrders: number;
    totalSteps: number;
    capacityLoadRate: string;
    confirmed: boolean;
    confirmedAt: string | null;
  };
}

// ─── Phase 1 贪心排产调度算法 ─────────────────────────────────

/**
 * 排产算法设计（Phase 1 贪心策略）：
 *
 * 优先级规则（按权重加权排序）：
 *   1. 交期紧迫度（距交期天数越少优先级越高，权重 0.5）
 *   2. 销售订单优先级字段（权重 0.3）
 *   3. 插单标记（urgent 类型加权，权重 0.2）
 *
 * 工人分配：
 *   - 按工作站类型 → 工人技能标签匹配
 *   - 当日已分配工时 < 8h 的工人优先
 *   - 无法匹配技能时分配空闲工人（any-fit）
 *
 * 产能约束：
 *   - 每工作站每日 capacity 件/天
 *   - 超产能的工序顺延到次日
 */
export class SchedulerService {
  private readonly tenantId: number;
  private readonly userId: number;

  constructor(ctx: TenantContext) {
    this.tenantId = ctx.tenantId;
    this.userId = ctx.userId;
  }

  private phase1(): ProductionPhase1Service {
    return new ProductionPhase1Service({ tenantId: this.tenantId, userId: this.userId });
  }

  private workflow(): WorkflowEngineService {
    return new WorkflowEngineService({ tenantId: this.tenantId, userId: this.userId });
  }

  /**
   * 为指定日期生成排产计划
   * @param targetDate  排产日期（YYYY-MM-DD），默认明天
   */
  async generateSchedule(targetDate?: string, force = false): Promise<SchedulePlan> {
    const date = targetDate ?? this.getNextWorkday();
    const cacheKey = RedisKeys.schedule(this.tenantId, date);
    const lockKey = `lock:schedule:${this.tenantId}:${date}`;
    let redis: ReturnType<typeof getRedisClient> | null = null;
    let lockAcquired = false;

    try {
      redis = getRedisClient();
      // 分布式锁：防止并发请求重复生成同一日期的排产计划
      lockAcquired = Boolean(await redis.set(lockKey, '1', 'EX', 30, 'NX'));
      if (!lockAcquired) {
        // 未获得锁，等待短暂时间后尝试从缓存读取
        await new Promise((r) => setTimeout(r, 500));
        const cached = await this.safeRedisGet(redis, cacheKey, 'schedule-wait-cache');
        if (cached) return JSON.parse(cached) as SchedulePlan;
        throw AppError.conflict('排产计划正在生成中，请稍后重试');
      }
    } catch (err) {
      console.warn(
        `[SchedulerService] Redis unavailable during schedule generation for tenant=${this.tenantId} date=${date}, falling back to DB path: ${(err as Error).message}`,
      );
      redis = null;
      lockAcquired = false;
    }

    try {
      return await this._doGenerateSchedule(date, cacheKey, redis, force);
    } finally {
      if (redis && lockAcquired) {
        await this.safeRedisDel(redis, lockKey, 'schedule-lock-release');
      }
    }
  }

  private async _doGenerateSchedule(
    date: string,
    cacheKey: string,
    redis: ReturnType<typeof getRedisClient> | null,
    force: boolean,
  ): Promise<SchedulePlan> {
    // 如果该日期已有 confirmed 排产计划，直接返回，拒绝重新生成（P0-04）
    const confirmedRows = await AppDataSource.query<Array<{ id: number }>>(
      `SELECT id FROM production_schedules
       WHERE tenant_id = ? AND schedule_date = ? AND status = 'confirmed' LIMIT 1`,
      [this.tenantId, date],
    );
    if (confirmedRows.length > 0) {
      const confirmedPlan = await this.buildPlanFromDb(date, '0%');
      await this.safeRedisSetex(redis, cacheKey, JSON.stringify(confirmedPlan), 'confirmed-schedule-cache');
      return confirmedPlan;
    }

    // 已有缓存则直接返回
    if (!force) {
      const cached = await this.safeRedisGet(redis, cacheKey, 'schedule-cache-read');
      if (cached) return JSON.parse(cached) as SchedulePlan;
    }

    // 1. 读取所有待排产/进行中的生产工单，确保已生成 operation 视图
    const orders = await this.fetchPendingOrders();
    if (orders.length === 0) {
      return {
        date,
        schedules: [],
        summary: {
          totalOrders: 0,
          totalSteps: 0,
          capacityLoadRate: '0%',
          confirmed: false,
          confirmedAt: null,
        },
      };
    }

    await this.ensureOperationsReady(orders);

    const operations = await this.fetchSchedulableOperations();
    if (operations.length === 0) {
      return {
        date,
        schedules: [],
        summary: {
          totalOrders: 0,
          totalSteps: 0,
          capacityLoadRate: '0%',
          confirmed: false,
          confirmedAt: null,
        },
      };
    }

    // 2. 读取工人与工作站资源
    const [workers, workstations] = await Promise.all([
      this.fetchWorkers(),
      this.fetchWorkstations(),
    ]);

    // 3. 贪心分配
    const schedules: Array<{
      productionOrderId: number;
      operationId: number;
      componentId: number;
      workOrderNo: string;
      processStepId: number;
      stepName: string;
      outputSkuId: number | null;
      outputSkuName: string | null;
      workerId: number | null;
      workerName: string | null;
      workstationId: number | null;
      workstationName: string | null;
      plannedQty: string;
      estimatedHours: string;
    }> = [];
    // workerLoad: workerId → 已分配工时（小时）
    const workerLoad = new Map<number, Decimal>(workers.map((w) => [w.id, new Decimal(0)]));
    // wsLoad: workstationId → 已分配产量
    const wsLoad = new Map<number, Decimal>(workstations.map((ws) => [ws.id, new Decimal(0)]));

    for (const operation of operations) {
      const plannedQty = new Decimal(operation.planned_qty);
      const estimatedHours = new Decimal(operation.standard_hours ?? 0).mul(plannedQty);

      const ws = this.matchWorkstation(
        operation.workstation_type,
        operation.workstation_id,
        workstations,
        wsLoad,
        operation.planned_qty,
      );
      const worker = this.matchWorker(
        operation.workstation_type,
        workers,
        workerLoad,
        estimatedHours.toFixed(2),
      );

      if (worker) {
        workerLoad.set(worker.id, (workerLoad.get(worker.id) ?? new Decimal(0)).plus(estimatedHours));
      }
      if (ws) {
        wsLoad.set(ws.id, (wsLoad.get(ws.id) ?? new Decimal(0)).plus(plannedQty));
      }

      schedules.push({
        productionOrderId: operation.production_order_id,
        operationId: operation.operation_id,
        componentId: operation.component_id,
        workOrderNo: operation.work_order_no,
        processStepId: operation.process_step_id,
        stepName: operation.step_name,
        outputSkuId: operation.output_sku_id,
        outputSkuName: operation.output_sku_name,
        workerId: worker?.id ?? null,
        workerName: worker?.real_name ?? null,
        workstationId: ws?.id ?? null,
        workstationName: ws?.name ?? null,
        plannedQty: plannedQty.toFixed(2),
        estimatedHours: estimatedHours.toFixed(2),
      });
    }

    // 4. 计算产能负荷率
    const totalAvailableHours = new Decimal(workers.length * 8);
    const totalScheduledHours = [...workerLoad.values()].reduce((s, v) => s.plus(v), new Decimal(0));
    const loadRate = totalAvailableHours.gt(0)
      ? totalScheduledHours.div(totalAvailableHours).mul(100).toFixed(1) + '%'
      : '0%';

    // 5. 持久化排产记录到数据库
    await this.persistSchedule(date, schedules);

    // 6. 缓存
    const persistedPlan = await this.buildPlanFromDb(date, loadRate);
    await this.safeRedisSetex(redis, cacheKey, JSON.stringify(persistedPlan), 'schedule-cache-write');

    return persistedPlan;
  }

  /**
   * 确认排产计划（车间主管审核后下发给工人）
   */
  async confirmSchedule(date: string): Promise<void> {
    await AppDataSource.query(
      `UPDATE production_schedules
       SET status = 'confirmed', updated_by = ?
       WHERE tenant_id = ? AND schedule_date = ? AND status = 'planned'`,
      [this.userId, this.tenantId, date],
    );

    // 同步创建工人任务记录
    const schedules = await AppDataSource.query<Array<{
      id: number; production_order_id: number; operation_id: number | null;
      component_id: number | null; process_step_id: number; output_sku_id: number | null;
      worker_id: number | null; planned_qty: string;
    }>>(
      `SELECT ps.id, ps.production_order_id, ps.operation_id, ps.component_id, ps.process_step_id,
              ps.output_sku_id, ps.worker_id, ps.planned_qty
       FROM production_schedules ps
       WHERE ps.tenant_id = ? AND ps.schedule_date = ? AND ps.status = 'confirmed' AND ps.worker_id IS NOT NULL
         AND NOT EXISTS (
           SELECT 1
           FROM production_tasks pt
           WHERE pt.tenant_id = ps.tenant_id
             AND pt.schedule_id = ps.id
         )`,
      [this.tenantId, date],
    );

    if (schedules.length > 0) {
      // task_no 基于 schedule_id 稳定生成，避免批量确认时随机撞号导致 INSERT IGNORE 静默丢任务。
      const dateToken = date.replace(/-/g, '');
      const rows = schedules.map((s) => {
        const taskNo = `TK${dateToken}${s.id}`;
        return { s, taskNo };
      });

      const CHUNK_SIZE = 500;
      for (let offset = 0; offset < rows.length; offset += CHUNK_SIZE) {
        const chunk = rows.slice(offset, offset + CHUNK_SIZE);
        const placeholders = chunk.map(() => '(?,?,?,?,?,?,?,?,?,?,?,\'pending\',?,?)').join(', ');
        const params: unknown[] = [];
        for (const { s, taskNo } of chunk) {
          params.push(
            this.tenantId, taskNo, s.id, s.production_order_id,
            s.operation_id, s.component_id, s.process_step_id, s.output_sku_id,
            s.worker_id, date, s.planned_qty,
            this.userId, this.userId,
          );
        }
        await AppDataSource.query(
          `INSERT IGNORE INTO production_tasks
             (tenant_id, task_no, schedule_id, production_order_id, operation_id, component_id,
              process_step_id, output_sku_id, worker_id, task_date, planned_qty, status, created_by, updated_by)
           VALUES ${placeholders}`,
          params,
        );
      }
    }

    // T-04: 工艺快照冻结 — 对本次排产涉及的工单写入不可变快照（幂等，仅当 process_snapshot IS NULL 时写入）
    const orderIds = [...new Set(schedules.map((s) => s.production_order_id).filter(Boolean))];
    if (orderIds.length > 0) {
      for (const orderId of orderIds) {
        const orders = await AppDataSource.query<Array<{
          id: number; process_template_id: number | null; process_snapshot: string | null;
        }>>(
          `SELECT id, process_template_id, process_snapshot
           FROM production_orders WHERE id = ? AND tenant_id = ?`,
          [orderId, this.tenantId],
        );
        const order = orders[0];
        if (!order || order.process_snapshot || !order.process_template_id) continue;

        const templates = await AppDataSource.query<Array<{
          id: number; name: string; version: string;
        }>>(
          `SELECT id, name, version FROM process_templates
           WHERE id = ? AND tenant_id = ?`,
          [order.process_template_id, this.tenantId],
        );
        const tmpl = templates[0];
        if (!tmpl) continue;

        const steps = await AppDataSource.query<Array<{
          id: number;
          step_no: number; step_name: string;
          workstation_type: string | null;
          workstation_id: number | null;
          standard_hours: string | null;
          max_hours: string | null;
          output_type: 'semi_finished' | 'final_product' | 'none' | null;
          output_sku_id: number | null;
        }>>(
          `SELECT id, step_no, step_name, workstation_type, workstation_id, standard_hours, max_hours,
                  output_type, output_sku_id
           FROM process_steps WHERE template_id = ? AND tenant_id = ?
           ORDER BY step_no ASC`,
          [tmpl.id, this.tenantId],
        );

        const snapshot = JSON.stringify({
          templateId: tmpl.id,
          templateName: tmpl.name,
          version: tmpl.version ?? '1.0',
          snapshotAt: new Date().toISOString(),
          steps: steps.map((s) => ({
            id: s.id,
            stepNo: s.step_no,
            stepName: s.step_name,
            workstationType: s.workstation_type ?? null,
            workstationId: s.workstation_id ?? null,
            standardHours: s.standard_hours ?? null,
            maxHours: s.max_hours ?? null,
            outputType: s.output_type ?? null,
            outputSkuId: s.output_sku_id ?? null,
          })),
        });

        await AppDataSource.query(
          `UPDATE production_orders
           SET process_snapshot = ?, dispatched_at = NOW(3)
           WHERE id = ? AND tenant_id = ? AND process_snapshot IS NULL`,
          [snapshot, orderId, this.tenantId],
        );
      }
    }

    await this.safeInvalidateScheduleCache(date);
  }

  /**
   * 获取工人当日任务列表
   */
  async getWorkerTasks(workerId: number, date: string): Promise<Array<{
    id: number; task_no: string; status: string; planned_qty: string;
    completed_qty: string | null; work_order_no: string; skuName: string;
    processStepName: string; salesOrderNo: string;
  }>> {
    return AppDataSource.query(
      `SELECT pt.*, po.work_order_no, s.name AS skuName,
              ps2.step_name AS processStepName, so.order_no AS salesOrderNo
       FROM production_tasks pt
       INNER JOIN production_orders po ON po.id = pt.production_order_id
       INNER JOIN skus s ON s.id = po.sku_id
       INNER JOIN process_steps ps2 ON ps2.id = pt.process_step_id
       INNER JOIN sales_orders so ON so.id = po.sales_order_id
       WHERE pt.tenant_id = ? AND pt.worker_id = ? AND pt.task_date = ?
       ORDER BY po.priority DESC`,
      [this.tenantId, workerId, date],
    );
  }

  private async buildPlanFromDb(date: string, capacityLoadRate: string): Promise<SchedulePlan> {
    const scheduleRows = await AppDataSource.query<Array<{
      schedule_id: number;
      schedule_status: 'planned' | 'confirmed';
      schedule_updated_at: string | null;
      production_order_id: number;
      operation_id: number | null;
      component_id: number | null;
      work_order_no: string;
      process_step_id: number;
      step_name: string;
      output_sku_id: number | null;
      output_sku_name: string | null;
      worker_id: number | null;
      worker_name: string | null;
      workstation_id: number | null;
      workstation_name: string | null;
      planned_qty: string;
      estimated_hours: string | null;
    }>>(
      `SELECT
          ps.id AS schedule_id,
          ps.status AS schedule_status,
          DATE_FORMAT(ps.updated_at, '%Y-%m-%d %H:%i:%s') AS schedule_updated_at,
          ps.production_order_id,
          ps.operation_id,
          ps.component_id,
          po.work_order_no,
          ps.process_step_id,
          COALESCE(pst.step_name, CONCAT('STEP#', ps.process_step_id)) AS step_name,
          ps.output_sku_id,
          outs.name AS output_sku_name,
          ps.worker_id,
          u.real_name AS worker_name,
          ps.workstation_id,
          w.name AS workstation_name,
          ps.planned_qty,
          CAST(COALESCE(pst.standard_hours, 0) * ps.planned_qty AS CHAR) AS estimated_hours
       FROM production_schedules ps
       INNER JOIN production_orders po ON po.id = ps.production_order_id
       LEFT JOIN process_steps pst ON pst.id = ps.process_step_id
       LEFT JOIN skus outs ON outs.id = ps.output_sku_id
       LEFT JOIN users u ON u.id = ps.worker_id
       LEFT JOIN workstations w ON w.id = ps.workstation_id
       WHERE ps.tenant_id = ? AND ps.schedule_date = ? AND ps.status IN ('planned', 'confirmed')
       ORDER BY ps.id ASC`,
      [this.tenantId, date],
    );

    const confirmed = scheduleRows.some((row) => row.schedule_status === 'confirmed');
    const confirmedAt =
      scheduleRows.find((row) => row.schedule_status === 'confirmed')?.schedule_updated_at ?? null;

    return {
      date,
      schedules: scheduleRows.map((row) => ({
        scheduleId: row.schedule_id,
        productionOrderId: row.production_order_id,
        operationId: row.operation_id,
        componentId: row.component_id,
        workOrderNo: row.work_order_no,
        processStepId: row.process_step_id,
        stepName: row.step_name,
        outputSkuId: row.output_sku_id,
        outputSkuName: row.output_sku_name,
        workerId: row.worker_id,
        workerName: row.worker_name,
        workstationId: row.workstation_id,
        workstationName: row.workstation_name,
        plannedQty: row.planned_qty,
        estimatedHours: row.estimated_hours ?? '0',
        status: row.schedule_status,
        updatedAt: row.schedule_updated_at ?? undefined,
      })),
      summary: {
        totalOrders: new Set(scheduleRows.map((row) => row.production_order_id)).size,
        totalSteps: scheduleRows.length,
        capacityLoadRate,
        confirmed,
        confirmedAt,
      },
    };
  }

  /**
   * 工人开始任务
   */
  async startTask(taskId: number): Promise<void> {
    await AppDataSource.transaction(async (manager) => {
      const [lockedTask] = await manager.query<Array<{
        id: number;
        status: string;
        started_at: string | null;
        production_order_id: number;
        process_step_id: number;
        operation_id: number | null;
        planned_qty: string;
      }>>(
        `SELECT id, status, started_at, production_order_id, process_step_id, operation_id, planned_qty
         FROM production_tasks
         WHERE id = ? AND tenant_id = ?
         LIMIT 1 FOR UPDATE`,
        [taskId, this.tenantId],
      );

      if (!lockedTask) {
        throw AppError.notFound('生产任务不存在');
      }

      if (lockedTask.status !== 'pending') {
        throw AppError.conflict(`任务状态为「${lockedTask.status}」，无法开始`);
      }

      await manager.query(
        `UPDATE production_tasks
         SET status = 'started', started_at = NOW(), updated_by = ?
         WHERE id = ? AND tenant_id = ? AND status = 'pending'`,
        [this.userId, taskId, this.tenantId],
      );

      if (!lockedTask.started_at) {
        await this.insertTaskInputTransactions(
          manager,
          lockedTask,
          taskId,
          lockedTask.planned_qty,
          'start',
        );
      }

      await manager.query(
        `UPDATE production_orders po
         INNER JOIN production_tasks pt
           ON pt.production_order_id = po.id
          AND pt.tenant_id = po.tenant_id
         SET po.status = 'in_progress',
             po.actual_start = COALESCE(po.actual_start, NOW()),
             po.updated_by = ?
         WHERE pt.id = ? AND pt.tenant_id = ?
           AND po.status IN ('pending', 'scheduled')`,
        [this.userId, taskId, this.tenantId],
      );
    });
  }

  /**
   * 工人上报完工
   */
  async completeTask(taskId: number, params: {
    completedQty: string;
    actualHours?: number;        // R06-G02: 实际工时（小时）
    scrapQty?: string;
    scrapReason?: 'material_defect' | 'operation_error' | 'other';
    componentBarcode?: string;
    notes?: string;
    images?: string[];
  }): Promise<void> {
    const affectedInventorySkuIds = new Set<number>();
    let trackedInventoryManager:
      | ({ query: typeof AppDataSource.query; __inventorySnapshotSkuIds?: Set<number> })
      | null = null;
    await AppDataSource.transaction(async (manager) => {
      trackedInventoryManager = manager as typeof trackedInventoryManager;
      const [lockedTask] = await manager.query<Array<{
        id: number;
        status: string;
        production_order_id: number;
        process_step_id: number;
        worker_id: number;
        operation_id: number | null;
        output_sku_id: number | null;
        planned_qty: string;
      }>>(
        `SELECT id, status, production_order_id, process_step_id, worker_id, operation_id, output_sku_id, planned_qty
         FROM production_tasks
         WHERE id = ? AND tenant_id = ?
         LIMIT 1 FOR UPDATE`,
        [taskId, this.tenantId],
      );

      if (!lockedTask) {
        throw AppError.notFound('生产任务不存在');
      }

      if (lockedTask.status === 'completed') {
        throw AppError.conflict('任务已完工，禁止重复报工');
      }

      if (lockedTask.status === 'cancelled') {
        throw AppError.conflict('任务已取消，禁止报工');
      }

      // 更新任务状态，若提供了实际工时则同步写入 actual_hours 列
      const updateSets = [
        'status = \'completed\'',
        'completed_qty = ?',
        'completed_at = NOW()',
        'updated_by = ?',
      ];
      const updateVals: unknown[] = [params.completedQty, this.userId];

      if (params.actualHours !== undefined && params.actualHours !== null) {
        updateSets.push('actual_hours = ?');
        updateVals.push(params.actualHours);
      }

      updateVals.push(taskId, this.tenantId);

      await manager.query(
        `UPDATE production_tasks SET ${updateSets.join(', ')} WHERE id = ? AND tenant_id = ?`,
        updateVals,
      );

      // 写入完工记录
      await manager.query(
        `INSERT INTO task_completions
           (tenant_id, task_id, completed_qty, scrap_qty, scrap_reason,
            component_barcode, notes, images, created_by)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [
          this.tenantId, taskId, params.completedQty,
          params.scrapQty ?? '0', params.scrapReason ?? null,
          params.componentBarcode ?? null, params.notes ?? null,
          params.images ? JSON.stringify(params.images) : null,
          this.userId,
        ],
      );

      if (lockedTask.operation_id) {
        await manager.query(
          `UPDATE production_operations
           SET completed_qty = LEAST(planned_qty, ?),
               status = CASE WHEN LEAST(planned_qty, ?) >= planned_qty THEN 'completed' ELSE 'in_progress' END,
               updated_by = ?
           WHERE id = ? AND tenant_id = ?`,
          [params.completedQty, params.completedQty, this.userId, lockedTask.operation_id, this.tenantId],
        );
      }

      await this.insertTaskInputTransactions(manager, lockedTask, taskId, params.completedQty, 'complete');
      await this.insertTaskOutputTransaction(manager, lockedTask, taskId, params);
      await this.workflow().onTaskCompleted(taskId, params.completedQty, manager as any, {
        syncOrderCompletion: false,
      });
      await this.syncOrderCompletion(manager, lockedTask.production_order_id);
      await this.insertWorkReport(manager, lockedTask, taskId, params);

      // ── 检查该工单所有任务是否已全部完工 ──────────────────────────────────
      // 若无剩余待处理/进行中任务，则将工单标记为 completed 并触发成品入库
      const [remainingRow] = await manager.query<Array<{ remaining: string }>>(
        `SELECT COUNT(*) AS remaining
         FROM production_tasks
         WHERE production_order_id = ? AND tenant_id = ?
           AND status NOT IN ('completed', 'cancelled')`,
        [lockedTask.production_order_id, this.tenantId],
      );

      if (Number(remainingRow.remaining) === 0) {
        // 1. 将工单状态更新为 completed（仅当当前状态为 in_progress，幂等保护）
        await manager.query(
          `UPDATE production_orders
           SET status = 'completed', actual_end = NOW(), updated_by = ?
           WHERE id = ? AND tenant_id = ? AND status = 'in_progress'`,
          [this.userId, lockedTask.production_order_id, this.tenantId],
        );

        // 2. 获取工单的 sku_id 与实际完工数量（用于成品入库）
        const [order] = await manager.query<Array<{
          sku_id: number;
          work_order_no: string;
          qty_completed: string;
          stock_unit: string | null;
        }>>(
          `SELECT production_orders.sku_id, production_orders.work_order_no, production_orders.qty_completed, s.stock_unit
           FROM production_orders
           LEFT JOIN skus s
             ON s.id = production_orders.sku_id
            AND s.tenant_id = production_orders.tenant_id
           WHERE production_orders.id = ? AND production_orders.tenant_id = ? LIMIT 1`,
          [lockedTask.production_order_id, this.tenantId],
        );

        if (order && new Decimal(order.qty_completed).gt(0)) {
          const completedQty = new Decimal(order.qty_completed);
          const inventoryNote = `生产工单 ${order.work_order_no} 全部任务完工，成品自动入库`;
          const stockUnit = String(order.stock_unit ?? 'pcs');
          const warehouseLocation = await resolveWarehouseLocationBinding({
            manager,
            tenantId: this.tenantId,
            userId: this.userId,
            sourceRef: 'production:scheduler:complete',
          });

          const [existingTxRow] = await manager.query<Array<{ cnt: string }>>(
            `SELECT COUNT(*) AS cnt
             FROM inventory_transactions
             WHERE tenant_id = ?
               AND transaction_type = 'PRODUCTION_IN'
               AND reference_type = 'production_order'
               AND reference_id = ?
               AND sku_id = ?
               AND notes = ?`,
            [
              this.tenantId,
              lockedTask.production_order_id,
              order.sku_id,
              inventoryNote,
            ],
          );

          if (Number(existingTxRow?.cnt ?? 0) > 0) {
            await this.syncInventoryDailySnapshot(manager, order.sku_id);
            affectedInventorySkuIds.add(Number(order.sku_id));
            return;
          }

          // 生成成品入库流水号：格式 PROD-IN-{timestamp}{random}
          const txNo = `PROD-IN-${Date.now()}${Math.floor(Math.random() * 999).toString().padStart(3, '0')}`;

          // 3. 写入库存流水（PRODUCTION_IN，成品入库）
          await manager.query(
            `INSERT INTO inventory_transactions
               (tenant_id, transaction_no, sku_id, transaction_type, direction,
                warehouse_id, location_id, source_ref,
                qty_input, input_unit, qty_stock_unit, stock_unit,
                reference_type, reference_id, reference_no, notes, created_by, updated_by)
             VALUES (?,?,?,'PRODUCTION_IN','IN',
                     ?,?,?, 
                     ?,?,?,?,
                     'production_order',?,?,?, ?, ?)`,
            [
              this.tenantId,
              txNo,
              order.sku_id,
              warehouseLocation.warehouseId,
              warehouseLocation.locationId,
              'production:scheduler:complete',
              completedQty.toFixed(4),     // qty_input（原始数量，已是库存单位）
              stockUnit,
              completedQty.toFixed(4),     // qty_stock_unit
              stockUnit,
              lockedTask.production_order_id,
              order.work_order_no,
              inventoryNote,
              this.userId,
              this.userId,
            ],
          );

          // 4. UPSERT 库存快照：增加 qty_on_hand（首次则新建行）
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
              order.sku_id,
              warehouseLocation.warehouseId,
              warehouseLocation.locationId,
              'production:scheduler:complete',
              completedQty.toFixed(4),
              this.userId,
            ],
          );

          await this.syncInventoryDailySnapshot(manager, order.sku_id);
          affectedInventorySkuIds.add(Number(order.sku_id));

          console.info(
            `[SchedulerService] 工单 ${order.work_order_no} 全部完工 → 成品入库 SKU#${order.sku_id} qty=${completedQty.toFixed(4)} tx=${txNo}`,
          );
        }
      }

      // 异步写入溯源链（通过队列，此处直接写简化版）
      const [orderDyeLot] = await manager.query<Array<{ dye_lot_no: string }>>(
        `SELECT dye_lot_no FROM order_dye_lot_bindings
         WHERE production_order_id = ? AND tenant_id = ? LIMIT 1`,
        [lockedTask.production_order_id, this.tenantId],
      );

      await manager.query(
        `INSERT INTO traceability_records
           (tenant_id, production_order_id, task_id, component_barcode,
            process_step_id, worker_id, dye_lot_no, operation_time, has_scan_record, created_by)
         VALUES (?,?,?,?,?,?,?,NOW(),?,?)`,
        [
          this.tenantId, lockedTask.production_order_id, taskId,
          params.componentBarcode ?? null,
          lockedTask.process_step_id, lockedTask.worker_id,
          orderDyeLot?.dye_lot_no ?? null,
          params.componentBarcode ? 1 : 0,
          this.userId,
        ],
      );
    });
    const trackedInventorySkuIds = this.consumeTrackedInventorySnapshotSkuIds(trackedInventoryManager);
    await this.invalidateInventorySnapshotCaches([
      ...affectedInventorySkuIds,
      ...trackedInventorySkuIds,
    ]);
  }

  private async resolveWorkReportSchema(
    manager: { query: typeof AppDataSource.query },
  ): Promise<WorkReportSchema> {
    const [row] = await manager.query<Array<{ cnt: string }>>(
      `SELECT COUNT(*) AS cnt
       FROM information_schema.columns
       WHERE table_schema = DATABASE()
         AND table_name = 'work_reports'
         AND column_name = 'worker_id'`,
    );

    if (Number(row?.cnt ?? 0) > 0) {
      return {
        workerColumn: 'worker_id',
        stepColumn: 'process_step_id',
        dateColumn: 'work_date',
        qtyColumn: 'qty_completed',
        modern: true,
      };
    }

    return {
      workerColumn: 'user_id',
      stepColumn: 'step_id',
      dateColumn: 'report_date',
      qtyColumn: 'qty',
      modern: false,
    };
  }

  private getShanghaiDateString(date: Date = new Date()): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);

    const year = parts.find((part) => part.type === 'year')?.value;
    const month = parts.find((part) => part.type === 'month')?.value;
    const day = parts.find((part) => part.type === 'day')?.value;

    if (!year || !month || !day) {
      throw new Error('无法格式化报工日期');
    }

    return `${year}-${month}-${day}`;
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
      console.warn('[SchedulerService] 库存缓存失效失败，已忽略:', (err as Error).message);
    }
  }

  private consumeTrackedInventorySnapshotSkuIds(
    manager:
      | ({ __inventorySnapshotSkuIds?: Set<number> })
      | null,
  ): number[] {
    const skuIds = Array.from(manager?.__inventorySnapshotSkuIds ?? []);
    if (manager) {
      delete manager.__inventorySnapshotSkuIds;
    }
    return skuIds;
  }

  private async insertWorkReport(
    manager: { query: typeof AppDataSource.query },
    task: {
      production_order_id: number;
      process_step_id: number;
      worker_id: number;
    },
    taskId: number,
    params: {
      completedQty: string;
      actualHours?: number;
      scrapQty?: string;
      notes?: string;
    },
  ): Promise<void> {
    const schema = await this.resolveWorkReportSchema(manager);
    const [wageRow] = await manager.query<Array<{ unit_price: string | null }>>(
      `SELECT COALESCE(pw.unit_price, 0) AS unit_price
       FROM users u
       LEFT JOIN process_wages pw
         ON pw.tenant_id = u.tenant_id
        AND pw.step_id = ?
        AND pw.worker_grade = COALESCE(u.skill_level, 'apprentice')
       WHERE u.id = ? AND u.tenant_id = ?
       LIMIT 1`,
      [task.process_step_id, task.worker_id, this.tenantId],
    );

    const qtyCompleted = new Decimal(params.completedQty);
    const workHours = new Decimal(params.actualHours ?? 0);
    const unitWage = new Decimal(wageRow?.unit_price ?? 0);
    const scrapQty = new Decimal(params.scrapQty ?? 0);
    const qualifiedQty = Decimal.max(qtyCompleted.minus(scrapQty), 0);
    const wageAmount = unitWage.mul(qtyCompleted);
    const reportNo = `WR${Date.now()}${taskId}`;
    const workDate = this.getShanghaiDateString();

    const columns = [
      'tenant_id',
      'report_no',
      schema.workerColumn,
      'production_order_id',
      'task_id',
      schema.stepColumn,
      schema.dateColumn,
      schema.qtyColumn,
      'qty_qualified',
      'qty_defective',
      'work_hours',
      'unit_wage',
      'wage_amount',
      'status',
      'notes',
      'created_by',
      'updated_by',
    ];

    await manager.query(
      `INSERT INTO work_reports (${columns.join(', ')})
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?)`,
      [
        this.tenantId,
        reportNo,
        task.worker_id,
        task.production_order_id,
        taskId,
        task.process_step_id,
        workDate,
        qtyCompleted.toFixed(4),
        qualifiedQty.toFixed(4),
        scrapQty.toFixed(4),
        workHours.toFixed(2),
        unitWage.toFixed(4),
        wageAmount.toFixed(2),
        params.notes ?? null,
        this.userId,
        this.userId,
      ],
    );
  }

  private async insertTaskOutputTransaction(
    manager: { query: typeof AppDataSource.query },
    task: {
      operation_id: number | null;
      output_sku_id: number | null;
      planned_qty: string;
    },
    taskId: number,
    params: {
      completedQty: string;
    },
  ): Promise<void> {
    const resolvedOutputSkuId = await this.resolveTaskOutputSku(manager, task);

    if (!resolvedOutputSkuId) {
      return;
    }

    await manager.query(
      `INSERT INTO task_material_transactions
         (tenant_id, task_id, operation_id, sku_id, io_type, planned_qty, actual_qty, inventory_tx_id, created_by)
       VALUES (?, ?, ?, ?, 'output', ?, ?, NULL, ?)`,
      [
        this.tenantId,
        taskId,
        task.operation_id,
        resolvedOutputSkuId,
        task.planned_qty,
        params.completedQty,
        this.userId,
      ],
    );
  }

  private async resolveTaskOutputSku(
    manager: { query: typeof AppDataSource.query },
    task: {
      operation_id: number | null;
      output_sku_id: number | null;
    },
  ): Promise<number | null> {
    if (task.operation_id) {
      const [resolved] = await manager.query<Array<{ resolved_output_sku_id: number | null }>>(
        `SELECT COALESCE(poc.resolved_sku_id, po.output_sku_id) AS resolved_output_sku_id
         FROM production_operations po
         LEFT JOIN production_order_components poc
           ON poc.id = po.component_id
          AND poc.tenant_id = po.tenant_id
         WHERE po.id = ? AND po.tenant_id = ?
         LIMIT 1`,
        [task.operation_id, this.tenantId],
      );

      if (resolved?.resolved_output_sku_id) {
        return Number(resolved.resolved_output_sku_id);
      }
    }

    return task.output_sku_id ? Number(task.output_sku_id) : null;
  }

  private async syncInventoryDailySnapshot(
    manager: { query: typeof AppDataSource.query },
    skuId: number,
  ): Promise<void> {
    await syncInventoryDailySnapshotForSku(manager, this.tenantId, skuId);
  }

  private async insertTaskInputTransactions(
    manager: { query: typeof AppDataSource.query },
    task: {
      production_order_id: number;
      process_step_id: number;
      planned_qty: string;
      operation_id: number | null;
    },
    taskId: number,
    actualCompletedQty: string,
    consumeTiming: 'start' | 'complete',
  ): Promise<void> {
    const materialRows = await manager.query<Array<{
      input_sku_id: number;
      actual_sku_id: number;
      usage_per_unit: string;
      loss_rate: string;
    }>>(
      `SELECT
          psm.input_sku_id,
          COALESCE(poc.resolved_sku_id, poc.sku_id, psm.input_sku_id) AS actual_sku_id,
          psm.usage_per_unit,
          psm.loss_rate
       FROM process_steps ps
       INNER JOIN process_step_materials psm
         ON psm.tenant_id = ps.tenant_id
        AND psm.template_id = ps.template_id
        AND psm.step_no = ps.step_no
       LEFT JOIN production_order_components poc
         ON poc.tenant_id = ?
        AND poc.production_order_id = ?
        AND poc.sku_id = psm.input_sku_id
       WHERE ps.id = ? AND ps.tenant_id = ?
         AND psm.consume_timing = ?`,
      [this.tenantId, task.production_order_id, task.process_step_id, this.tenantId, consumeTiming],
    );

    if (materialRows.length === 0) {
      return;
    }

    const plannedQty = new Decimal(task.planned_qty);
    const actualQty = new Decimal(actualCompletedQty);

    for (const material of materialRows) {
      const usagePerUnit = new Decimal(material.usage_per_unit ?? 0);
      const multiplier = new Decimal(1).plus(new Decimal(material.loss_rate ?? 0));
      const plannedInputQty = plannedQty.mul(usagePerUnit).mul(multiplier);
      const actualInputQty = actualQty.mul(usagePerUnit).mul(multiplier);

      await manager.query(
        `INSERT INTO task_material_transactions
           (tenant_id, task_id, operation_id, sku_id, io_type, planned_qty, actual_qty, inventory_tx_id, created_by)
         SELECT ?, ?, ?, ?, 'input', ?, ?, NULL, ?
         WHERE NOT EXISTS (
           SELECT 1
           FROM task_material_transactions
           WHERE tenant_id = ? AND task_id = ? AND io_type = 'input' AND sku_id = ?
         )`,
        [
          this.tenantId,
          taskId,
          task.operation_id,
          Number(material.actual_sku_id ?? material.input_sku_id),
          plannedInputQty.toFixed(4),
          actualInputQty.toFixed(4),
          this.userId,
          this.tenantId,
          taskId,
          Number(material.actual_sku_id ?? material.input_sku_id),
        ],
      );
    }
  }

  private async syncOrderCompletion(
    manager: { query: typeof AppDataSource.query },
    productionOrderId: number,
  ): Promise<void> {
    const [row] = await manager.query<Array<{
      qtyCompleted: string | null;
      totalOps: string;
      completedOps: string;
    }>>(
      `SELECT
          COALESCE(MIN(completed_qty), 0) AS qtyCompleted,
          COUNT(*) AS totalOps,
          SUM(CASE WHEN completed_qty >= planned_qty THEN 1 ELSE 0 END) AS completedOps
       FROM production_operations
       WHERE production_order_id = ? AND tenant_id = ? AND status <> 'cancelled'`,
      [productionOrderId, this.tenantId],
    );

    const completedOps = Number(row?.completedOps ?? 0);
    const totalOps = Number(row?.totalOps ?? 0);
    const status = totalOps > 0 && completedOps === totalOps ? 'completed' : 'in_progress';
    const actualEndClause = status === 'completed' ? 'actual_end = NOW(),' : '';
    const actualStartClause = status === 'in_progress' ? 'actual_start = COALESCE(actual_start, NOW()),' : '';

    await manager.query(
      `UPDATE production_orders
       SET qty_completed = ?,
           status = ?,
           ${actualStartClause}
           ${actualEndClause}
           updated_by = ?
       WHERE id = ? AND tenant_id = ?`,
      [row?.qtyCompleted ?? '0', status, this.userId, productionOrderId, this.tenantId],
    );
  }

  // ── 私有辅助 ──────────────────────────────────────────────

  /**
   * 按综合优先级加权排序获取待排产工单
   * 权重：交期紧迫度 0.5 + 订单优先级 0.3 + 插单标记 0.2
   */
  private async fetchPendingOrders(): Promise<ProductionOrderRow[]> {
    return AppDataSource.query(
      `SELECT po.id, po.work_order_no, po.sku_id, s.name AS sku_name,
              po.status, po.qty_planned, po.priority, po.planned_end,
              so.order_no AS sales_order_no, so.expected_delivery,
              po.process_template_id,
              -- 综合优先级评分：交期越近分越高
              (
                50 * (1 - LEAST(DATEDIFF(so.expected_delivery, CURDATE()) / 30, 1)) +
                30 * (po.priority / 100) +
                20 * IF(so.order_type = 'urgent', 1, 0)
              ) AS composite_score
       FROM production_orders po
       INNER JOIN skus s ON s.id = po.sku_id
       INNER JOIN sales_orders so ON so.id = po.sales_order_id
       WHERE po.tenant_id = ? AND po.status IN ('pending', 'scheduled', 'in_progress')
       ORDER BY composite_score DESC
       LIMIT 100`,
      [this.tenantId],
    );
  }

  private async ensureOperationsReady(orders: ProductionOrderRow[]): Promise<void> {
    const phase1 = this.phase1();
    for (const order of orders) {
      const [existing] = await AppDataSource.query<Array<{ cnt: string }>>(
        `SELECT COUNT(*) AS cnt
         FROM production_operations
         WHERE production_order_id = ? AND tenant_id = ?`,
        [order.id, this.tenantId],
      );
      if (Number(existing?.cnt ?? 0) === 0) {
        if (order.status === 'in_progress') {
          // 兼容历史数据：进行中工单缺少 release 产物时不阻断整批排产
          continue;
        }
        await phase1.releaseOrder(order.id);
      }
    }
  }

  private async fetchSchedulableOperations(): Promise<ScheduledOperationRow[]> {
    return AppDataSource.query(
      `SELECT
          op.id AS operation_id,
          op.production_order_id,
          op.component_id,
          op.process_step_id,
          op.output_sku_id,
          op.planned_qty,
          po.work_order_no,
          COALESCE(ps.step_name, CONCAT('STEP#', op.process_step_id)) AS step_name,
          COALESCE(ps.standard_hours, 0) AS standard_hours,
          ps.workstation_type,
          ps.workstation_id,
          outs.name AS output_sku_name
       FROM production_operations op
       INNER JOIN production_orders po ON po.id = op.production_order_id
       INNER JOIN sales_orders so ON so.id = po.sales_order_id
       LEFT JOIN process_steps ps ON ps.id = op.process_step_id
       LEFT JOIN skus outs ON outs.id = op.output_sku_id
       WHERE op.tenant_id = ?
         AND po.tenant_id = ?
         AND po.status IN ('pending', 'scheduled', 'in_progress')
         AND op.status IN ('pending', 'released', 'scheduled', 'in_progress')
         AND op.completed_qty < op.planned_qty
       ORDER BY
         (
           50 * (1 - LEAST(DATEDIFF(so.expected_delivery, CURDATE()) / 30, 1)) +
           30 * (po.priority / 100) +
           20 * IF(so.order_type = 'urgent', 1, 0)
         ) DESC,
         COALESCE(ps.step_no, 9999) ASC,
         op.id ASC`,
      [this.tenantId, this.tenantId],
    );
  }

  private async fetchProcessSteps(templateId: number): Promise<ProcessStepRow[]> {
    return AppDataSource.query(
      `SELECT id, step_no, step_name,
              COALESCE(standard_hours, 0) AS standard_hours,
              workstation_type,
              workstation_id
       FROM process_steps
       WHERE template_id = ? AND tenant_id = ?
       ORDER BY step_no`,
      [templateId, this.tenantId],
    );
  }

  private async fetchWorkers(): Promise<WorkerRow[]> {
    return AppDataSource.query(
      `SELECT u.id, u.real_name, NULL AS skill_tags
       FROM users u
       INNER JOIN user_roles ur ON ur.user_id = u.id
       INNER JOIN roles r ON r.id = ur.role_id
       WHERE u.tenant_id = ? AND r.code = 'worker' AND u.status = 'active'`,
      [this.tenantId],
    );
  }

  private async fetchWorkstations(): Promise<WorkstationRow[]> {
    return AppDataSource.query(
      `SELECT id, name, type, capacity
       FROM workstations WHERE tenant_id = ? AND status = 'active'`,
      [this.tenantId],
    );
  }

  /**
   * 贪心工作站匹配：优先匹配类型，次选负荷最低
   */
  private matchWorkstation(
    type: string | null,
    preferredStationId: number | null,
    stations: WorkstationRow[],
    load: Map<number, Decimal>,
    qty: string,
  ): WorkstationRow | null {
    if (preferredStationId) {
      const preferred = stations.find((ws) => ws.id === preferredStationId);
      if (preferred) return preferred;
    }

    const candidates = type
      ? stations.filter((ws) => ws.type === type)
      : stations;

    // 过滤已满产能的工作站
    const available = candidates.filter(
      (ws) => (load.get(ws.id) ?? new Decimal(0)).lt(ws.capacity),
    );
    if (available.length === 0) return candidates[0] ?? null; // 超产能时仍分配（标注超载）

    // 选负荷最低的
    return available.sort(
      (a, b) => (load.get(a.id) ?? new Decimal(0)).comparedTo(load.get(b.id) ?? new Decimal(0)),
    )[0];
  }

  /**
   * 贪心工人匹配：选当日已分配工时最少且未超8小时的工人
   */
  private matchWorker(
    wsType: string | null,
    workers: WorkerRow[],
    load: Map<number, Decimal>,
    requiredHours: string,
  ): WorkerRow | null {
    void wsType; // Phase 2 按技能标签匹配，Phase 1 仅按负荷
    const available = workers.filter(
      (w) => (load.get(w.id) ?? new Decimal(0)).plus(new Decimal(requiredHours ?? 0)).lte(8),
    );
    if (available.length === 0) {
      // 所有工人满载时选负荷最低的
      return workers.sort(
        (a, b) => (load.get(a.id) ?? new Decimal(0)).comparedTo(load.get(b.id) ?? new Decimal(0)),
      )[0] ?? null;
    }
    return available.sort(
      (a, b) => (load.get(a.id) ?? new Decimal(0)).comparedTo(load.get(b.id) ?? new Decimal(0)),
    )[0];
  }

  private async safeRedisGet(
    redis: ReturnType<typeof getRedisClient> | null,
    key: string,
    context: string,
  ): Promise<string | null> {
    if (!redis) return null;
    try {
      return await redis.get(key);
    } catch (err) {
      console.warn(
        `[SchedulerService] Redis GET failed in ${context} for tenant=${this.tenantId} key=${key}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  private async safeRedisSetex(
    redis: ReturnType<typeof getRedisClient> | null,
    key: string,
    value: string,
    context: string,
  ): Promise<void> {
    if (!redis) return;
    try {
      await redis.setex(key, RedisTTL.SCHEDULE, value);
    } catch (err) {
      console.warn(
        `[SchedulerService] Redis SETEX failed in ${context} for tenant=${this.tenantId} key=${key}: ${(err as Error).message}`,
      );
    }
  }

  private async safeRedisDel(
    redis: ReturnType<typeof getRedisClient> | null,
    key: string,
    context: string,
  ): Promise<void> {
    if (!redis) return;
    try {
      await redis.del(key);
    } catch (err) {
      console.warn(
        `[SchedulerService] Redis DEL failed in ${context} for tenant=${this.tenantId} key=${key}: ${(err as Error).message}`,
      );
    }
  }

  private async safeInvalidateScheduleCache(date: string): Promise<void> {
    try {
      await this.safeRedisDel(
        getRedisClient(),
        RedisKeys.schedule(this.tenantId, date),
        'schedule-cache-invalidate',
      );
    } catch (err) {
      console.warn(
        `[SchedulerService] Redis unavailable during schedule cache invalidation for tenant=${this.tenantId} date=${date}: ${(err as Error).message}`,
      );
    }
  }

  private async persistSchedule(
    date: string,
    schedules: Array<{
      productionOrderId: number;
      operationId: number;
      componentId: number;
      workOrderNo: string;
      processStepId: number;
      stepName: string;
      outputSkuId: number | null;
      outputSkuName: string | null;
      workerId: number | null;
      workerName: string | null;
      workstationId: number | null;
      workstationName: string | null;
      plannedQty: string;
      estimatedHours: string;
    }>,
  ): Promise<void> {
    if (schedules.length === 0) return;

    // 先清除当日旧的 AI 生成排产（保留人工调整的）
    await AppDataSource.query(
      `DELETE FROM production_schedules
       WHERE tenant_id = ? AND schedule_date = ? AND ai_generated = 1 AND status = 'planned'`,
      [this.tenantId, date],
    );

    // Batch INSERT in chunks of 500 to respect MySQL max_allowed_packet limits.
    const CHUNK_SIZE = 500;
    for (let offset = 0; offset < schedules.length; offset += CHUNK_SIZE) {
      const chunk = schedules.slice(offset, offset + CHUNK_SIZE);
      const placeholders = chunk.map(() => '(?,?,?,?,?,?,?,?,?,?,\'planned\',1,?,?)').join(', ');
      const params: unknown[] = [];
      for (const s of chunk) {
        params.push(
          this.tenantId, date, s.productionOrderId, s.operationId, s.componentId, s.processStepId,
          s.outputSkuId, s.workstationId, s.workerId, s.plannedQty,
          this.userId, this.userId,
        );
      }
      await AppDataSource.query(
        `INSERT INTO production_schedules
           (tenant_id, schedule_date, production_order_id, operation_id, component_id, process_step_id,
            output_sku_id, workstation_id, worker_id, planned_qty, status, ai_generated, created_by, updated_by)
         VALUES ${placeholders}`,
        params,
      );
    }
  }

  private getNextWorkday(): string {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    // 跳过周末
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  }

  // ── BE-P2-011: 插单影响分析（真实延期天数计算）─────────────────

  /**
   * 分析紧急插单对当前已排产工单的影响。
   *
   * 算法：
   *   1. 查询目标工作站信息（名称 + 日产能）
   *   2. 计算新插单在该工作站上的总工时（步骤标准工时 × 数量，仅统计匹配工作站类型的工序）
   *   3. 延期天数 = ceil(总工时 / 工作站日产能)
   *   4. 查询优先级 <= insertAfterPriority 且状态非完成/取消的已排产工单
   *   5. 为每个受影响工单计算：
   *      - newPlannedEnd = originalPlannedEnd + delayDays（跳过周末）
   *      - affectsDelivery = newPlannedEnd > salesOrder.expectedDelivery
   */
  async analyzeUrgentInsertImpact(
    params: UrgentInsertParams,
  ): Promise<UrgentInsertImpactResult> {
    // Step 1: 查询工作站信息（参数化，租户隔离）
    const wsRows = await AppDataSource.query<Array<{
      id: number;
      name: string;
      type: string;
      capacity: number;
    }>>(
      `SELECT id, name, type,
              capacity,
              capacity AS daily_capacity
       FROM workstations
       WHERE id = ? AND tenant_id = ? AND status = 'active'
       LIMIT 1`,
      [params.workstationId, this.tenantId],
    );

    if (wsRows.length === 0) {
      throw AppError.notFound('工作站不存在或已停用', ResponseCode.WORKSTATION_NOT_FOUND);
    }

    const ws = wsRows[0];
    const dailyCapacity = Number(ws.capacity);

    if (dailyCapacity <= 0) {
      throw AppError.badRequest(
        `工作站「${ws.name}」日产能未配置，无法计算延期天数`,
        ResponseCode.WORKSTATION_NOT_FOUND,
      );
    }

    // Step 2: 计算新插单在该工作站的总工时
    //         仅累加 workstation_type 与工作站 type 匹配（或未指定类型）的工序
    const stepRows = await AppDataSource.query<Array<{
      standard_hours: string;
      workstation_type: string | null;
    }>>(
      `SELECT COALESCE(standard_hours, 0) AS standard_hours, workstation_type
       FROM process_steps
       WHERE template_id = ? AND tenant_id = ?
       ORDER BY step_no`,
      [params.processTemplateId, this.tenantId],
    );

    const qtyDecimal = new Decimal(params.qtyPlanned);
    let urgentTotalHours = new Decimal(0);

    for (const step of stepRows) {
      // 无类型约束的工序视为通用，参与计算；类型匹配则计入
      if (!step.workstation_type || step.workstation_type === ws.type) {
        urgentTotalHours = urgentTotalHours.plus(
          new Decimal(step.standard_hours).mul(qtyDecimal),
        );
      }
    }

    // Step 3: 延期天数（向上取整）
    const delayDays = Math.ceil(urgentTotalHours.div(dailyCapacity).toNumber());

    // Step 4: 查询受影响工单（优先级 <= insertAfterPriority，非完成/取消）
    //         内联关联 sales_orders 获取交期
    const affectedRows = await AppDataSource.query<Array<{
      id: number;
      work_order_no: string;
      sku_name: string;
      planned_end: string | null;
      expected_delivery: string;
    }>>(
      `SELECT po.id,
              po.work_order_no,
              s.name        AS sku_name,
              po.planned_end,
              so.expected_delivery
       FROM production_orders po
       INNER JOIN skus s         ON s.id  = po.sku_id
       INNER JOIN sales_orders so ON so.id = po.sales_order_id
       WHERE po.tenant_id = ?
         AND po.priority <= ?
         AND po.status NOT IN ('completed', 'cancelled')
       ORDER BY po.priority ASC, po.planned_end ASC`,
      [this.tenantId, params.insertAfterPriority],
    );

    // Step 5: 为每个受影响工单计算延后结果
    const impactedOrders: ImpactedOrderResult[] = affectedRows.map((row) => {
      const newPlannedEnd = this.addCalendarDays(row.planned_end, delayDays);
      const affectsDelivery =
        row.expected_delivery
          ? newPlannedEnd > row.expected_delivery
          : false;

      return {
        productionOrderId: row.id,
        workOrderNo: row.work_order_no,
        skuName: row.sku_name,
        originalPlannedEnd: row.planned_end,
        delayDays,
        newPlannedEnd,
        affectsDelivery,
        expectedDelivery: row.expected_delivery,
      };
    });

    return {
      delayDaysPerOrder: delayDays,
      impactedCount: impactedOrders.length,
      workstationName: ws.name,
      dailyCapacity,
      urgentTotalHours: urgentTotalHours.toFixed(2),
      impactedOrders,
    };
  }

  /**
   * 将日期字符串（YYYY-MM-DD）加上指定的自然日天数（跳过周六/周日）。
   * 若 baseDateStr 为 null，以当天为基准。
   */
  private addCalendarDays(baseDateStr: string | null, days: number): string {
    const base = baseDateStr
      ? new Date(baseDateStr + 'T00:00:00Z')
      : new Date();
    base.setUTCHours(0, 0, 0, 0);

    let remaining = days;
    const cursor = new Date(base);

    while (remaining > 0) {
      cursor.setUTCDate(cursor.getUTCDate() + 1);
      const dow = cursor.getUTCDay(); // 0=Sun, 6=Sat
      if (dow !== 0 && dow !== 6) {
        remaining--;
      }
    }

    return cursor.toISOString().slice(0, 10);
  }
}
