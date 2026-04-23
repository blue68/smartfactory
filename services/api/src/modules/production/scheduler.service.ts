import Decimal from 'decimal.js';
import { AppDataSource } from '../../config/database';
import { TenantContext } from '../../shared/BaseRepository';
import { getRedisClient, RedisKeys, RedisTTL } from '../../config/redis';
import { AppError } from '../../shared/AppError';
import { ResponseCode } from '../../shared/ApiResponse';
import { generateNo } from '../../shared/generateNo';
import { UnitConverter } from '../../shared/unitConverter';
import { ProductionPhase1Service } from './production-phase1.service';
import { ProcessTemplateSnapshotBuilder } from './processTemplateSnapshotBuilder';
import { WorkflowEngineService } from './workflow-engine.service';
import { syncInventoryDailySnapshotForSku } from '../inventory/daily-snapshot.util';
import { ensureProductionWipWarehouseLocation, resolveWarehouseLocationBinding } from '../inventory/warehouse-location.resolver';
import { findNextWorkday, getResolvedWorkCalendarDay } from './work-calendar.util';

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
  joint_batch_id?: number | null;
  joint_batch_item_id?: number | null;
  batch_no?: string | null;
  plan_mode?: string | null;
  merge_group_key?: string | null;
  batch_sequence_no?: number | null;
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
  joint_batch_id?: number | null;
  joint_batch_item_id?: number | null;
  batch_no?: string | null;
  plan_mode?: string | null;
  merge_group_key?: string | null;
  batch_sequence_no?: number | null;
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

interface TaskInventoryActionItem {
  skuId: number;
  qty: string;
  unit?: string;
  warehouseId?: number;
  locationId?: number;
  dyeLotNo?: string;
  notes?: string;
}

interface LockedTaskRow {
  id: number;
  task_no: string;
  status: string;
  started_at: string | null;
  production_order_id: number;
  process_step_id: number;
  worker_id: number;
  operation_id: number | null;
  output_sku_id: number | null;
  planned_qty: string;
}

interface TaskInputPlanRow {
  inputSkuId: number;
  actualSkuId: number;
  itemType: string | null;
  usagePerUnit: string;
  lossRate: string;
  consumeTiming: 'start' | 'complete';
}

interface InventorySkuRow {
  stockUnit: string;
  purchaseUnit: string;
  productionUnit: string;
  hasDyeLot: boolean;
  skuName: string;
}

export interface SchedulePlan {
  date: string;
  schedules: Array<{
    scheduleId: number;
    productionOrderId: number;
    batchId?: number | null;
    batchItemId?: number | null;
    batchNo?: string | null;
    planMode?: string | null;
    mergeGroupKey?: string | null;
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
 *   - 当日已分配工时 < 当日配置可用工时 的工人优先
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
  async generateSchedule(targetDate?: string, force = false, batchId?: number): Promise<SchedulePlan> {
    const date = targetDate ?? await this.getNextWorkday();
    const cacheKey = RedisKeys.schedule(this.tenantId, date, batchId);
    const lockKey = `lock:schedule:${this.tenantId}:${date}:${batchId ?? 'all'}`;
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
      return await this._doGenerateSchedule(date, cacheKey, redis, force, batchId);
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
    batchId?: number,
  ): Promise<SchedulePlan> {
    const workdayConfig = await getResolvedWorkCalendarDay(this.tenantId, date);
    if (!workdayConfig.isWorkday || workdayConfig.totalMinutes <= 0) {
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

    // 如果该日期已有 confirmed 排产计划，直接返回，拒绝重新生成（P0-04）
    const confirmedRows = await AppDataSource.query<Array<{ id: number }>>(
      `SELECT ps.id
       FROM production_schedules ps
       INNER JOIN production_orders po
         ON po.id = ps.production_order_id
        AND po.tenant_id = ps.tenant_id
       WHERE ps.tenant_id = ?
         AND ps.schedule_date = ?
         AND ps.status = 'confirmed'
         AND (? IS NULL OR po.joint_batch_id = ?)
       LIMIT 1`,
      [this.tenantId, date, batchId ?? null, batchId ?? null],
    );
    if (confirmedRows.length > 0) {
      const confirmedPlan = await this.buildPlanFromDb(date, undefined, batchId);
      await this.safeRedisSetex(redis, cacheKey, JSON.stringify(confirmedPlan), 'confirmed-schedule-cache');
      return confirmedPlan;
    }

    // 已有缓存则直接返回
    if (!force) {
      const cached = await this.safeRedisGet(redis, cacheKey, 'schedule-cache-read');
      if (cached) return JSON.parse(cached) as SchedulePlan;
    }

    // 1. 读取所有待排产/进行中的生产工单，确保已生成 operation 视图
    const orders = await this.fetchPendingOrders(batchId);
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

    const operations = await this.fetchSchedulableOperations(batchId);
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
      batchId?: number | null;
      batchItemId?: number | null;
      batchNo?: string | null;
      planMode?: string | null;
      mergeGroupKey?: string | null;
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
        new Decimal(workdayConfig.totalHours),
      );

      if (worker) {
        workerLoad.set(worker.id, (workerLoad.get(worker.id) ?? new Decimal(0)).plus(estimatedHours));
      }
      if (ws) {
        wsLoad.set(ws.id, (wsLoad.get(ws.id) ?? new Decimal(0)).plus(plannedQty));
      }

      schedules.push({
        productionOrderId: operation.production_order_id,
        batchId: operation.joint_batch_id ?? null,
        batchItemId: operation.joint_batch_item_id ?? null,
        batchNo: operation.batch_no ?? null,
        planMode: operation.plan_mode ?? null,
        mergeGroupKey: operation.merge_group_key ?? null,
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
    const totalAvailableHours = new Decimal(workers.length).mul(new Decimal(workdayConfig.totalHours));
    const totalScheduledHours = [...workerLoad.values()].reduce((s, v) => s.plus(v), new Decimal(0));
    const loadRate = totalAvailableHours.gt(0)
      ? totalScheduledHours.div(totalAvailableHours).mul(100).toFixed(1) + '%'
      : '0%';

    // 5. 持久化排产记录到数据库
    await this.persistSchedule(date, schedules);

    // 6. 缓存
    const persistedPlan = await this.buildPlanFromDb(date, loadRate, batchId);
    await this.safeRedisSetex(redis, cacheKey, JSON.stringify(persistedPlan), 'schedule-cache-write');

    return persistedPlan;
  }

  /**
   * 确认排产计划（车间主管审核后下发给工人）
   */
  async confirmSchedule(date: string, batchId?: number): Promise<void> {
    await AppDataSource.query(
      `UPDATE production_schedules
       SET status = 'confirmed', updated_by = ?
       WHERE tenant_id = ? AND schedule_date = ? AND status = 'planned'
         AND (
           ? IS NULL OR EXISTS (
             SELECT 1
             FROM production_orders po
             WHERE po.id = production_schedules.production_order_id
               AND po.tenant_id = production_schedules.tenant_id
               AND po.joint_batch_id = ?
           )
         )`,
      [this.userId, this.tenantId, date, batchId ?? null, batchId ?? null],
    );

    // 同步创建工人任务记录
    const schedules = await AppDataSource.query<Array<{
      id: number; production_order_id: number; operation_id: number | null;
      component_id: number | null; process_step_id: number; output_sku_id: number | null;
      worker_id: number | null; planned_qty: string; has_dependencies: number;
    }>>(
      `SELECT ps.id, ps.production_order_id, ps.operation_id, ps.component_id, ps.process_step_id,
              ps.output_sku_id, ps.worker_id, ps.planned_qty,
              CASE
                WHEN EXISTS (
                  SELECT 1
                  FROM production_operation_dependencies dep
                  WHERE dep.tenant_id = ps.tenant_id
                    AND dep.operation_id = ps.operation_id
                ) THEN 1
                ELSE 0
              END AS has_dependencies
       FROM production_schedules ps
       INNER JOIN production_orders po
         ON po.id = ps.production_order_id
        AND po.tenant_id = ps.tenant_id
       WHERE ps.tenant_id = ? AND ps.schedule_date = ? AND ps.status = 'confirmed' AND ps.worker_id IS NOT NULL
         AND (? IS NULL OR po.joint_batch_id = ?)
         AND NOT EXISTS (
           SELECT 1
           FROM production_tasks pt
           WHERE pt.tenant_id = ps.tenant_id
             AND pt.schedule_id = ps.id
         )`,
      [this.tenantId, date, batchId ?? null, batchId ?? null],
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
        const placeholders = chunk.map(() => '(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').join(', ');
        const params: unknown[] = [];
        for (const { s, taskNo } of chunk) {
          const taskStatus = Number(s.has_dependencies ?? 0) > 0 ? 'suspended' : 'pending';
          params.push(
            this.tenantId, taskNo, s.id, s.production_order_id,
            s.operation_id, s.component_id, s.process_step_id, s.output_sku_id,
            s.worker_id, date, s.planned_qty, taskStatus,
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
          id: number; sku_id: number; process_template_id: number | null; process_snapshot: string | null;
        }>>(
          `SELECT id, sku_id, process_template_id, process_snapshot
           FROM production_orders WHERE id = ? AND tenant_id = ?`,
          [orderId, this.tenantId],
        );
        const order = orders[0];
        if (!order || order.process_snapshot || !order.process_template_id) continue;

        const snapshot = JSON.stringify(
          await new ProcessTemplateSnapshotBuilder(this.tenantId).build(
            AppDataSource,
            order.process_template_id,
            order.sku_id,
          ),
        );

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

  private async buildPlanFromDb(date: string, capacityLoadRate?: string, batchId?: number): Promise<SchedulePlan> {
    const scheduleRows = await AppDataSource.query<Array<{
      schedule_id: number;
      schedule_status: 'planned' | 'confirmed';
      schedule_updated_at: string | null;
      production_order_id: number;
      joint_batch_id: number | null;
      joint_batch_item_id: number | null;
      batch_no: string | null;
      plan_mode: string | null;
      merge_group_key: string | null;
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
          po.joint_batch_id,
          po.joint_batch_item_id,
          jb.batch_no,
          po.plan_mode,
          po.merge_group_key,
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
       LEFT JOIN joint_production_batches jb ON jb.id = po.joint_batch_id AND jb.tenant_id = po.tenant_id
       LEFT JOIN process_steps pst ON pst.id = ps.process_step_id
       LEFT JOIN skus outs ON outs.id = ps.output_sku_id
       LEFT JOIN users u ON u.id = ps.worker_id
       LEFT JOIN workstations w ON w.id = ps.workstation_id
       WHERE ps.tenant_id = ? AND ps.schedule_date = ? AND ps.status IN ('planned', 'confirmed')
         AND (? IS NULL OR po.joint_batch_id = ?)
       ORDER BY ps.id ASC`,
      [this.tenantId, date, batchId ?? null, batchId ?? null],
    );

    const resolvedCapacityLoadRate = capacityLoadRate ?? await this.calculateCapacityLoadRateForDate(date, scheduleRows);

    const confirmed = scheduleRows.some((row) => row.schedule_status === 'confirmed');
    const confirmedAt =
      scheduleRows.find((row) => row.schedule_status === 'confirmed')?.schedule_updated_at ?? null;

    return {
      date,
      schedules: scheduleRows.map((row) => ({
        scheduleId: row.schedule_id,
        productionOrderId: row.production_order_id,
        batchId: row.joint_batch_id,
        batchItemId: row.joint_batch_item_id,
        batchNo: row.batch_no,
        planMode: row.plan_mode,
        mergeGroupKey: row.merge_group_key,
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
        capacityLoadRate: resolvedCapacityLoadRate,
        confirmed,
        confirmedAt,
      },
    };
  }

  private async calculateCapacityLoadRateForDate(
    date: string,
    scheduleRows: Array<{ estimated_hours: string | null }>,
  ): Promise<string> {
    const workdayConfig = await getResolvedWorkCalendarDay(this.tenantId, date);
    if (!workdayConfig.isWorkday || workdayConfig.totalMinutes <= 0) {
      return '0%';
    }
    const [workerRow] = await AppDataSource.query<Array<{ cnt: string }>>(
      `SELECT COUNT(*) AS cnt
       FROM users u
       INNER JOIN user_roles ur ON ur.user_id = u.id
       INNER JOIN roles r ON r.id = ur.role_id
       WHERE u.tenant_id = ? AND r.code = 'worker' AND u.status = 'active'`,
      [this.tenantId],
    );
    const workerCount = Number(workerRow?.cnt ?? 0);
    const totalAvailableHours = new Decimal(workerCount).mul(new Decimal(workdayConfig.totalHours));
    if (totalAvailableHours.lte(0)) {
      return '0%';
    }
    const totalScheduledHours = scheduleRows.reduce(
      (sum, row) => sum.plus(new Decimal(row.estimated_hours ?? 0)),
      new Decimal(0),
    );
    return totalScheduledHours.div(totalAvailableHours).mul(100).toFixed(1) + '%';
  }

  /**
   * 工人开始任务
   */
  async startTask(taskId: number): Promise<void> {
    await AppDataSource.transaction(async (manager) => {
      const lockedTask = await this.getLockedTask(manager, taskId);

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
        await this.ensureTaskInputTransactions(manager, lockedTask, taskId);
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

  async issueTaskMaterials(taskId: number, params: { items: TaskInventoryActionItem[] }): Promise<{
    taskId: number;
    results: Array<{
      skuId: number;
      qty: string;
      warehouseId: number;
      locationId: number;
      transactionNo: string;
    }>;
  }> {
    const results: Array<{
      skuId: number;
      qty: string;
      warehouseId: number;
      locationId: number;
      transactionNo: string;
    }> = [];
    let trackedInventoryManager:
      | ({ query: typeof AppDataSource.query; __inventorySnapshotSkuIds?: Set<number> })
      | null = null;

    await AppDataSource.transaction(async (manager) => {
      trackedInventoryManager = manager as typeof trackedInventoryManager;
      const lockedTask = await this.getLockedTask(manager, taskId);
      if (!lockedTask) {
        throw AppError.notFound('生产任务不存在');
      }
      if (lockedTask.status === 'completed' || lockedTask.status === 'cancelled') {
        throw AppError.conflict('当前任务状态不允许继续领料');
      }

      const materialPlans = await this.fetchTaskInputMaterialPlans(manager, lockedTask);
      const taskMaterialMap = await this.ensureTaskInputTransactions(manager, lockedTask, taskId, materialPlans);
      const wipLocation = await ensureProductionWipWarehouseLocation(manager, this.tenantId, this.userId);

      for (const item of params.items) {
        const taskMaterialTxId = taskMaterialMap.get(Number(item.skuId));
        if (!taskMaterialTxId) {
          throw AppError.badRequest(`SKU#${item.skuId} 不是当前任务的输入项`);
        }

        const sourceLocation = await resolveWarehouseLocationBinding({
          manager,
          tenantId: this.tenantId,
          userId: this.userId,
          warehouseId: item.warehouseId,
          locationId: item.locationId,
          sourceRef: 'production:task:issue',
        });

        const transfer = await this.transferTaskInventory(manager, {
          taskId,
          taskMaterialTxId,
          productionOrderId: lockedTask.production_order_id,
          referenceNo: lockedTask.task_no,
          skuId: Number(item.skuId),
          qty: item.qty,
          inputUnit: item.unit,
          dyeLotNo: item.dyeLotNo ?? null,
          notes: item.notes ?? null,
          sourceWarehouseId: sourceLocation.warehouseId,
          sourceLocationId: sourceLocation.locationId,
          targetWarehouseId: wipLocation.warehouseId,
          targetLocationId: wipLocation.locationId,
          outboundType: 'PRODUCTION_ISSUE_OUT',
          inboundType: 'PRODUCTION_ISSUE_IN',
          movementType: 'issue',
          respectReservedOnSource: true,
          sourceRef: 'production:task:issue',
        });

        results.push({
          skuId: Number(item.skuId),
          qty: transfer.qty,
          warehouseId: transfer.warehouseId,
          locationId: transfer.locationId,
          transactionNo: transfer.transactionNo,
        });
      }
    });

    await this.invalidateInventorySnapshotCaches(
      this.consumeTrackedInventorySnapshotSkuIds(trackedInventoryManager),
    );

    return { taskId, results };
  }

  async returnTaskMaterials(taskId: number, params: { items: TaskInventoryActionItem[] }): Promise<{
    taskId: number;
    results: Array<{
      skuId: number;
      qty: string;
      warehouseId: number;
      locationId: number;
      transactionNo: string;
    }>;
  }> {
    const results: Array<{
      skuId: number;
      qty: string;
      warehouseId: number;
      locationId: number;
      transactionNo: string;
    }> = [];
    let trackedInventoryManager:
      | ({ query: typeof AppDataSource.query; __inventorySnapshotSkuIds?: Set<number> })
      | null = null;

    await AppDataSource.transaction(async (manager) => {
      trackedInventoryManager = manager as typeof trackedInventoryManager;
      const lockedTask = await this.getLockedTask(manager, taskId);
      if (!lockedTask) {
        throw AppError.notFound('生产任务不存在');
      }
      if (lockedTask.status === 'completed' || lockedTask.status === 'cancelled') {
        throw AppError.conflict('当前任务状态不允许继续退料');
      }

      const materialPlans = await this.fetchTaskInputMaterialPlans(manager, lockedTask);
      const taskMaterialMap = await this.ensureTaskInputTransactions(manager, lockedTask, taskId, materialPlans);
      const taskIssuedMap = await this.getTaskNetMovementAvailability(manager, taskId);
      const wipLocation = await ensureProductionWipWarehouseLocation(manager, this.tenantId, this.userId);

      for (const item of params.items) {
        const skuId = Number(item.skuId);
        const taskMaterialTxId = taskMaterialMap.get(skuId);
        if (!taskMaterialTxId) {
          throw AppError.badRequest(`SKU#${skuId} 不是当前任务的输入项`);
        }

        const availableToReturn = new Decimal(taskIssuedMap.get(this.buildTaskMovementKey(skuId, item.dyeLotNo ?? null)) ?? 0);
        const returnQty = new Decimal(item.qty);
        if (returnQty.gt(availableToReturn)) {
          throw AppError.conflict(`任务可退线边库存不足：SKU#${skuId} 当前仅剩 ${availableToReturn.toFixed(4)}`);
        }

        const targetLocation = await resolveWarehouseLocationBinding({
          manager,
          tenantId: this.tenantId,
          userId: this.userId,
          warehouseId: item.warehouseId,
          locationId: item.locationId,
          sourceRef: 'production:task:return',
        });

        const transfer = await this.transferTaskInventory(manager, {
          taskId,
          taskMaterialTxId,
          productionOrderId: lockedTask.production_order_id,
          referenceNo: lockedTask.task_no,
          skuId,
          qty: item.qty,
          inputUnit: item.unit,
          dyeLotNo: item.dyeLotNo ?? null,
          notes: item.notes ?? null,
          sourceWarehouseId: wipLocation.warehouseId,
          sourceLocationId: wipLocation.locationId,
          targetWarehouseId: targetLocation.warehouseId,
          targetLocationId: targetLocation.locationId,
          outboundType: 'PRODUCTION_RETURN_OUT',
          inboundType: 'PRODUCTION_RETURN_IN',
          movementType: 'return',
          respectReservedOnSource: false,
          sourceRef: 'production:task:return',
        });

        results.push({
          skuId,
          qty: transfer.qty,
          warehouseId: transfer.warehouseId,
          locationId: transfer.locationId,
          transactionNo: transfer.transactionNo,
        });
      }
    });

    await this.invalidateInventorySnapshotCaches(
      this.consumeTrackedInventorySnapshotSkuIds(trackedInventoryManager),
    );

    return { taskId, results };
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
      const lockedTask = await this.getLockedTask(manager, taskId);

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
        'scrap_qty = ?',
        'scrap_reason = ?',
        'completed_at = NOW()',
        'updated_by = ?',
      ];
      const scrapQty = new Decimal(params.scrapQty ?? 0);
      const qualifiedQty = Decimal.max(new Decimal(params.completedQty).minus(scrapQty), 0);
      const updateVals: unknown[] = [
        params.completedQty,
        scrapQty.toFixed(4),
        params.scrapReason ?? null,
        this.userId,
      ];

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

      const materialPlans = await this.fetchTaskInputMaterialPlans(manager, lockedTask);
      const taskMaterialMap = await this.ensureTaskInputTransactions(manager, lockedTask, taskId, materialPlans);
      const consumedSkuIds = await this.consumeTaskInputMaterials(
        manager,
        lockedTask,
        taskId,
        params.completedQty,
        materialPlans,
        taskMaterialMap,
      );
      consumedSkuIds.forEach((skuId) => affectedInventorySkuIds.add(skuId));

      await this.insertTaskOutputTransaction(manager, lockedTask, taskId, {
        completedQty: qualifiedQty.toFixed(4),
      });
      await this.workflow().onTaskCompleted(
        taskId,
        params.completedQty,
        qualifiedQty.toFixed(4),
        scrapQty.toFixed(4),
        manager as any,
        {
        syncOrderCompletion: false,
        },
      );
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

  private trackInventorySnapshotCacheInvalidation(
    manager: { __inventorySnapshotSkuIds?: Set<number> } | null,
    skuIds: number[],
  ): void {
    if (!manager || skuIds.length === 0) return;
    const tracked = (manager.__inventorySnapshotSkuIds ??= new Set<number>());
    for (const skuId of skuIds) {
      tracked.add(Number(skuId));
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

  private async getLockedTask(
    manager: { query: typeof AppDataSource.query },
    taskId: number,
  ): Promise<LockedTaskRow | null> {
    const [lockedTask] = await manager.query<Array<LockedTaskRow>>(
      `SELECT
          id,
          task_no,
          status,
          started_at,
          production_order_id,
          process_step_id,
          worker_id,
          operation_id,
          output_sku_id,
          planned_qty
       FROM production_tasks
       WHERE id = ? AND tenant_id = ?
       LIMIT 1 FOR UPDATE`,
      [taskId, this.tenantId],
    );

    return lockedTask ?? null;
  }

  private async fetchTaskInputMaterialPlans(
    manager: { query: typeof AppDataSource.query },
    task: {
      production_order_id: number;
      process_step_id: number;
      output_sku_id?: number | null;
    },
  ): Promise<TaskInputPlanRow[]> {
    const stepPlans = await manager.query<TaskInputPlanRow[]>(
      `SELECT
          psm.input_sku_id AS inputSkuId,
          COALESCE(poc.resolved_sku_id, poc.sku_id, psm.input_sku_id) AS actualSkuId,
          CASE
            WHEN c1.code = 'SEMIFIN' THEN 'semi_finished'
            ELSE 'material'
          END AS itemType,
          psm.usage_per_unit AS usagePerUnit,
          psm.loss_rate AS lossRate,
          psm.consume_timing AS consumeTiming
       FROM process_steps ps
       INNER JOIN process_step_materials psm
         ON psm.tenant_id = ps.tenant_id
        AND psm.template_id = ps.template_id
        AND psm.step_no = ps.step_no
       INNER JOIN skus si
         ON si.id = psm.input_sku_id
        AND si.tenant_id = ps.tenant_id
       LEFT JOIN sku_categories c1
         ON c1.id = si.category1_id
       LEFT JOIN production_order_components poc
         ON poc.tenant_id = ?
        AND poc.production_order_id = ?
        AND poc.sku_id = psm.input_sku_id
       WHERE ps.id = ? AND ps.tenant_id = ?
       ORDER BY psm.id ASC`,
      [this.tenantId, task.production_order_id, task.process_step_id, this.tenantId],
    );

    if (stepPlans.length > 0) {
      return stepPlans;
    }

    return this.fetchTaskBomInputMaterialPlans(manager, task);
  }

  private async fetchTaskBomInputMaterialPlans(
    manager: { query: typeof AppDataSource.query },
    task: {
      production_order_id: number;
      output_sku_id?: number | null;
    },
  ): Promise<TaskInputPlanRow[]> {
    const outputSkuId = await this.resolveTaskMaterialPlanOutputSku(manager, task);
    if (!outputSkuId) {
      return [];
    }

    return manager.query<TaskInputPlanRow[]>(
      `SELECT
          bi.component_sku_id AS inputSkuId,
          COALESCE(poc.resolved_sku_id, poc.sku_id, bi.component_sku_id) AS actualSkuId,
          CASE
            WHEN c1.code = 'SEMIFIN' THEN 'semi_finished'
            ELSE 'material'
          END AS itemType,
          CAST(bi.quantity AS CHAR) AS usagePerUnit,
          CAST(COALESCE(bi.scrap_rate, 0) AS CHAR) AS lossRate,
          'start' AS consumeTiming
       FROM bom_headers bh
       INNER JOIN bom_items bi
         ON bi.bom_header_id = bh.id
        AND bi.tenant_id = bh.tenant_id
        AND bi.parent_item_id IS NULL
       INNER JOIN skus cs
         ON cs.id = bi.component_sku_id
        AND cs.tenant_id = bh.tenant_id
       LEFT JOIN sku_categories c1
         ON c1.id = cs.category1_id
       LEFT JOIN production_order_components poc
         ON poc.tenant_id = bh.tenant_id
        AND poc.production_order_id = ?
        AND poc.sku_id = bi.component_sku_id
       WHERE bh.tenant_id = ?
         AND bh.sku_id = ?
         AND bh.status = 'active'
       ORDER BY bi.sort_order ASC, bi.id ASC`,
      [task.production_order_id, this.tenantId, outputSkuId],
    );
  }

  private async resolveTaskMaterialPlanOutputSku(
    manager: { query: typeof AppDataSource.query },
    task: {
      production_order_id: number;
      output_sku_id?: number | null;
    },
  ): Promise<number | null> {
    if (task.output_sku_id) {
      return Number(task.output_sku_id);
    }

    const [row] = await manager.query<Array<{ sku_id: number | null }>>(
      `SELECT sku_id
       FROM production_orders
       WHERE id = ? AND tenant_id = ?
       LIMIT 1`,
      [task.production_order_id, this.tenantId],
    );

    return row?.sku_id ? Number(row.sku_id) : null;
  }

  private async ensureTaskInputTransactions(
    manager: { query: typeof AppDataSource.query },
    task: {
      production_order_id: number;
      process_step_id: number;
      planned_qty: string;
      operation_id: number | null;
    },
    taskId: number,
    materialRows?: TaskInputPlanRow[],
  ): Promise<Map<number, number>> {
    const plans = materialRows ?? await this.fetchTaskInputMaterialPlans(manager, task);
    if (plans.length === 0) {
      return new Map();
    }

    const plannedQty = new Decimal(task.planned_qty);

    for (const material of plans) {
      const usagePerUnit = new Decimal(material.usagePerUnit ?? 0);
      const multiplier = new Decimal(1).plus(new Decimal(material.lossRate ?? 0));
      const plannedInputQty = plannedQty.mul(usagePerUnit).mul(multiplier);

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
          Number(material.actualSkuId ?? material.inputSkuId),
          plannedInputQty.toFixed(4),
          '0.0000',
          this.userId,
          this.tenantId,
          taskId,
          Number(material.actualSkuId ?? material.inputSkuId),
        ],
      );
    }

    const rows = await manager.query<Array<{ id: number; sku_id: number }>>(
      `SELECT id, sku_id
       FROM task_material_transactions
       WHERE tenant_id = ? AND task_id = ? AND io_type = 'input'`,
      [this.tenantId, taskId],
    );

    return new Map(rows.map((row) => [Number(row.sku_id), Number(row.id)]));
  }

  private buildTaskMovementKey(skuId: number, dyeLotNo: string | null): string {
    return `${skuId}::${dyeLotNo ?? ''}`;
  }

  private async getTaskNetMovementAvailability(
    manager: { query: typeof AppDataSource.query },
    taskId: number,
  ): Promise<Map<string, string>> {
    const rows = await manager.query<Array<{ skuId: number; dyeLotNo: string | null; qty: string }>>(
      `SELECT
          tim.sku_id AS skuId,
          it.dye_lot_no AS dyeLotNo,
          CAST(SUM(
            CASE
              WHEN tim.movement_type = 'issue' THEN tim.qty
              WHEN tim.movement_type IN ('return', 'consume', 'scrap') THEN -tim.qty
              ELSE 0
            END
          ) AS CHAR) AS qty
       FROM task_inventory_movements tim
       INNER JOIN inventory_transactions it
         ON it.id = tim.inventory_tx_id
        AND it.tenant_id = tim.tenant_id
       WHERE tim.tenant_id = ? AND tim.task_id = ?
       GROUP BY tim.sku_id, it.dye_lot_no`,
      [this.tenantId, taskId],
    );

    return new Map(
      rows.map((row) => [
        this.buildTaskMovementKey(Number(row.skuId), row.dyeLotNo ? String(row.dyeLotNo) : null),
        String(row.qty ?? '0'),
      ]),
    );
  }

  private async getSkuInfo(
    manager: { query: typeof AppDataSource.query },
    skuId: number,
  ): Promise<InventorySkuRow> {
    const [row] = await manager.query<Array<{
      stockUnit: string;
      purchaseUnit: string | null;
      productionUnit: string | null;
      hasDyeLot: number | boolean;
      skuName: string;
    }>>(
      `SELECT stock_unit AS stockUnit,
              purchase_unit AS purchaseUnit,
              production_unit AS productionUnit,
              has_dye_lot AS hasDyeLot,
              name AS skuName
       FROM skus
       WHERE id = ? AND tenant_id = ?
       LIMIT 1`,
      [skuId, this.tenantId],
    );

    if (!row) {
      throw AppError.notFound(`SKU不存在: ${skuId}`);
    }

    return {
      stockUnit: String(row.stockUnit ?? 'pcs'),
      purchaseUnit: String(row.purchaseUnit ?? row.stockUnit ?? 'pcs'),
      productionUnit: String(row.productionUnit ?? row.stockUnit ?? 'pcs'),
      hasDyeLot: Boolean(row.hasDyeLot),
      skuName: String(row.skuName ?? `SKU#${skuId}`),
    };
  }

  private async getUnitConversions(
    skuId: number,
  ): Promise<Array<{ fromUnit: string; toUnit: string; conversionRate: string }>> {
    return AppDataSource.query(
      `SELECT from_unit AS fromUnit, to_unit AS toUnit, conversion_rate AS conversionRate
       FROM sku_unit_conversions
       WHERE tenant_id = ? AND sku_id = ?`,
      [this.tenantId, skuId],
    );
  }

  private async lockInventoryRow(
    manager: { query: typeof AppDataSource.query },
    skuId: number,
    warehouseId: number,
    locationId: number,
  ): Promise<{ qtyOnHand: string; qtyReserved: string } | null> {
    const [inv] = await manager.query<Array<{ qtyOnHand: string; qtyReserved: string }>>(
      `SELECT qty_on_hand AS qtyOnHand, qty_reserved AS qtyReserved
       FROM inventory
       WHERE tenant_id = ? AND sku_id = ? AND warehouse_id = ? AND location_id = ?
       LIMIT 1
       FOR UPDATE`,
      [this.tenantId, skuId, warehouseId, locationId],
    );
    return inv ?? null;
  }

  private async createInventoryTransaction(
    manager: { query: typeof AppDataSource.query },
    params: {
      skuId: number;
      transactionType: string;
      direction: 'IN' | 'OUT';
      warehouseId: number;
      locationId: number;
      sourceRef: string;
      qtyInput: string;
      inputUnit: string;
      qtyStockUnit: string;
      stockUnit: string;
      dyeLotNo?: string | null;
      productionOrderId?: number | null;
      referenceType?: string | null;
      referenceId?: number | null;
      referenceNo?: string | null;
      notes?: string | null;
    },
  ): Promise<{ id: number; transactionNo: string }> {
    const transactionNo = await generateNo('transaction', this.tenantId);
    const result = await manager.query(
      `INSERT INTO inventory_transactions
         (tenant_id, transaction_no, sku_id, transaction_type, direction,
          warehouse_id, location_id, source_ref,
          qty_input, input_unit, qty_stock_unit, stock_unit, dye_lot_no,
          production_order_id, reference_type, reference_id, reference_no,
          notes, created_by, updated_by)
       VALUES (?,?,?,?,?, ?,?,?, ?,?,?,?,?, ?,?,?,?, ?, ?, ?)`,
      [
        this.tenantId,
        transactionNo,
        params.skuId,
        params.transactionType,
        params.direction,
        params.warehouseId,
        params.locationId,
        params.sourceRef,
        params.qtyInput,
        params.inputUnit,
        params.qtyStockUnit,
        params.stockUnit,
        params.dyeLotNo ?? null,
        params.productionOrderId ?? null,
        params.referenceType ?? null,
        params.referenceId ?? null,
        params.referenceNo ?? null,
        params.notes ?? null,
        this.userId,
        this.userId,
      ],
    );

    return {
      id: Number(result.insertId),
      transactionNo,
    };
  }

  private async addInventoryStock(
    manager: { query: typeof AppDataSource.query },
    params: {
      skuId: number;
      warehouseId: number;
      locationId: number;
      qty: string;
      sourceRef: string;
    },
  ): Promise<void> {
    await manager.query(
      `INSERT INTO inventory
         (tenant_id, sku_id, warehouse_id, location_id, source_ref,
          qty_on_hand, qty_reserved, qty_in_transit, last_in_at, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, 0, 0, NOW(), ?)
       ON DUPLICATE KEY UPDATE
         qty_on_hand = qty_on_hand + VALUES(qty_on_hand),
         source_ref = VALUES(source_ref),
         last_in_at = NOW(),
         updated_by = VALUES(updated_by)`,
      [
        this.tenantId,
        params.skuId,
        params.warehouseId,
        params.locationId,
        params.sourceRef,
        params.qty,
        this.userId,
      ],
    );
  }

  private async subtractInventoryStock(
    manager: { query: typeof AppDataSource.query },
    params: {
      skuId: number;
      warehouseId: number;
      locationId: number;
      qty: string;
      stockUnit: string;
      respectReserved: boolean;
    },
  ): Promise<void> {
    const lockedInventory = await this.lockInventoryRow(
      manager,
      params.skuId,
      params.warehouseId,
      params.locationId,
    );

    if (!lockedInventory) {
      throw new AppError('库存记录不存在', ResponseCode.INVENTORY_INSUFFICIENT);
    }

    const qty = new Decimal(params.qty);
    const onHand = new Decimal(lockedInventory.qtyOnHand ?? 0);
    const reserved = new Decimal(lockedInventory.qtyReserved ?? 0);
    const available = params.respectReserved ? onHand.minus(reserved) : onHand;

    if (qty.gt(available)) {
      throw new AppError(
        `库存不足：可用 ${available.toFixed(4)} ${params.stockUnit}，需要 ${qty.toFixed(4)} ${params.stockUnit}`,
        ResponseCode.INVENTORY_INSUFFICIENT,
      );
    }

    await manager.query(
      `UPDATE inventory
       SET qty_on_hand = qty_on_hand - ?, last_out_at = NOW(), updated_by = ?
       WHERE tenant_id = ? AND sku_id = ? AND warehouse_id = ? AND location_id = ?`,
      [
        params.qty,
        this.userId,
        this.tenantId,
        params.skuId,
        params.warehouseId,
        params.locationId,
      ],
    );
  }

  private async linkTaskInventoryMovement(
    manager: { query: typeof AppDataSource.query },
    params: {
      taskId: number;
      taskMaterialTxId: number | null;
      skuId: number;
      movementType: 'issue' | 'return' | 'consume' | 'scrap' | 'output';
      inventoryTxId: number;
      qty: string;
      notes?: string | null;
    },
  ): Promise<void> {
    await manager.query(
      `INSERT INTO task_inventory_movements
         (tenant_id, task_id, task_material_tx_id, sku_id, movement_type, inventory_tx_id, qty, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        this.tenantId,
        params.taskId,
        params.taskMaterialTxId,
        params.skuId,
        params.movementType,
        params.inventoryTxId,
        params.qty,
        params.notes ?? null,
        this.userId,
      ],
    );
  }

  private async transferTaskInventory(
    manager: { query: typeof AppDataSource.query; __inventorySnapshotSkuIds?: Set<number> },
    params: {
      taskId: number;
      taskMaterialTxId: number;
      productionOrderId: number;
      referenceNo: string;
      skuId: number;
      qty: string;
      inputUnit?: string;
      dyeLotNo: string | null;
      notes: string | null;
      sourceWarehouseId: number;
      sourceLocationId: number;
      targetWarehouseId: number;
      targetLocationId: number;
      outboundType: string;
      inboundType: string;
      movementType: 'issue' | 'return';
      respectReservedOnSource: boolean;
      sourceRef: string;
    },
  ): Promise<{ qty: string; warehouseId: number; locationId: number; transactionNo: string }> {
    const sku = await this.getSkuInfo(manager, params.skuId);
    if (sku.hasDyeLot && !params.dyeLotNo) {
      throw new AppError(`SKU ${sku.skuName} 需要指定缸号`, ResponseCode.INVENTORY_DYE_LOT_REQUIRED);
    }

    const inputUnit = String(params.inputUnit ?? sku.productionUnit ?? sku.stockUnit).trim() || sku.stockUnit;
    const conversions = await this.getUnitConversions(params.skuId);
    const converted = UnitConverter.convert(params.qty, inputUnit, conversions, sku.stockUnit);
    const qtyInput = new Decimal(params.qty).toFixed(4);
    const qty = converted.qty.toFixed(4);
    await this.subtractInventoryStock(manager, {
      skuId: params.skuId,
      warehouseId: params.sourceWarehouseId,
      locationId: params.sourceLocationId,
      qty,
      stockUnit: sku.stockUnit,
      respectReserved: params.respectReservedOnSource,
    });

    await this.createInventoryTransaction(manager, {
      skuId: params.skuId,
      transactionType: params.outboundType,
      direction: 'OUT',
      warehouseId: params.sourceWarehouseId,
      locationId: params.sourceLocationId,
      sourceRef: params.sourceRef,
      qtyInput,
      inputUnit,
      qtyStockUnit: qty,
      stockUnit: sku.stockUnit,
      dyeLotNo: params.dyeLotNo,
      productionOrderId: params.productionOrderId,
      referenceType: 'production_task',
      referenceId: params.taskId,
      referenceNo: params.referenceNo,
      notes: params.notes,
    });

    const inboundTx = await this.createInventoryTransaction(manager, {
      skuId: params.skuId,
      transactionType: params.inboundType,
      direction: 'IN',
      warehouseId: params.targetWarehouseId,
      locationId: params.targetLocationId,
      sourceRef: params.sourceRef,
      qtyInput,
      inputUnit,
      qtyStockUnit: qty,
      stockUnit: sku.stockUnit,
      dyeLotNo: params.dyeLotNo,
      productionOrderId: params.productionOrderId,
      referenceType: 'production_task',
      referenceId: params.taskId,
      referenceNo: params.referenceNo,
      notes: params.notes,
    });

    await this.addInventoryStock(manager, {
      skuId: params.skuId,
      warehouseId: params.targetWarehouseId,
      locationId: params.targetLocationId,
      qty,
      sourceRef: params.sourceRef,
    });

    await this.linkTaskInventoryMovement(manager, {
      taskId: params.taskId,
      taskMaterialTxId: params.taskMaterialTxId,
      skuId: params.skuId,
      movementType: params.movementType,
      inventoryTxId: inboundTx.id,
      qty,
      notes: params.notes,
    });

    await this.syncInventoryDailySnapshot(manager, params.skuId);
    this.trackInventorySnapshotCacheInvalidation(manager, [params.skuId]);

    return {
      qty,
      warehouseId: params.targetWarehouseId,
      locationId: params.targetLocationId,
      transactionNo: inboundTx.transactionNo,
    };
  }

  private async consumeTaskInputMaterials(
    manager: { query: typeof AppDataSource.query; __inventorySnapshotSkuIds?: Set<number> },
    task: LockedTaskRow,
    taskId: number,
    completedQty: string,
    materialPlans: TaskInputPlanRow[],
    taskMaterialMap: Map<number, number>,
  ): Promise<number[]> {
    const requiredBySku = new Map<number, Decimal>();
    const itemTypeBySku = new Map<number, string>();
    const completed = new Decimal(completedQty);
    for (const material of materialPlans) {
      const usagePerUnit = new Decimal(material.usagePerUnit ?? 0);
      const multiplier = new Decimal(1).plus(new Decimal(material.lossRate ?? 0));
      const requiredQty = completed.mul(usagePerUnit).mul(multiplier);
      if (requiredQty.lte(0)) continue;
      const key = Number(material.actualSkuId ?? material.inputSkuId);
      requiredBySku.set(key, (requiredBySku.get(key) ?? new Decimal(0)).plus(requiredQty));
      itemTypeBySku.set(key, String(material.itemType ?? 'material'));
    }

    if (requiredBySku.size === 0) {
      return [];
    }

    const taskIssuedMap = await this.getTaskNetMovementAvailability(manager, taskId);
    const wipLocation = await ensureProductionWipWarehouseLocation(manager, this.tenantId, this.userId);
    const affectedSkuIds: number[] = [];

    for (const [skuId, requiredQty] of requiredBySku.entries()) {
      const sku = await this.getSkuInfo(manager, skuId);
      const taskMaterialTxId = taskMaterialMap.get(skuId) ?? null;
      const itemType = itemTypeBySku.get(skuId) ?? 'material';
      const availableEntries = Array.from(taskIssuedMap.entries())
        .filter(([key, value]) => key.startsWith(`${skuId}::`) && new Decimal(value).gt(0))
        .map(([key, value]) => ({
          dyeLotNo: key.split('::')[1] || null,
          qty: new Decimal(value),
          warehouseId: wipLocation.warehouseId,
          locationId: wipLocation.locationId,
        }))
        .sort((left, right) => {
          if (left.dyeLotNo === right.dyeLotNo) return 0;
          if (left.dyeLotNo === null) return -1;
          if (right.dyeLotNo === null) return 1;
          return left.dyeLotNo.localeCompare(right.dyeLotNo);
        });

      let totalAvailable = availableEntries.reduce((sum, item) => sum.plus(item.qty), new Decimal(0));
      if (requiredQty.gt(totalAvailable) && itemType !== 'material') {
        const fallbackRows = await manager.query<Array<{
          warehouseId: number;
          locationId: number;
          dyeLotNo: string | null;
          qtyOnHand: string;
          qtyReserved: string;
        }>>(
          `SELECT
              warehouse_id AS warehouseId,
              location_id AS locationId,
              NULL AS dyeLotNo,
              qty_on_hand AS qtyOnHand,
              qty_reserved AS qtyReserved
           FROM inventory
           WHERE tenant_id = ? AND sku_id = ? AND qty_on_hand > 0
           ORDER BY qty_on_hand DESC, warehouse_id ASC, location_id ASC`,
          [this.tenantId, skuId],
        );

        for (const row of fallbackRows) {
          const onHand = new Decimal(row.qtyOnHand ?? 0);
          const reserved = new Decimal(row.qtyReserved ?? 0);
          const available = Decimal.max(onHand.minus(reserved), 0);
          if (available.lte(0)) continue;
          availableEntries.push({
            dyeLotNo: row.dyeLotNo ? String(row.dyeLotNo) : null,
            qty: available,
            warehouseId: Number(row.warehouseId),
            locationId: Number(row.locationId),
          });
          totalAvailable = totalAvailable.plus(available);
          if (requiredQty.lte(totalAvailable)) {
            break;
          }
        }
      }

      if (requiredQty.gt(totalAvailable)) {
        throw AppError.conflict(
          `任务线边库存不足：${sku.skuName} 仅有 ${totalAvailable.toFixed(4)} ${sku.stockUnit}，需要 ${requiredQty.toFixed(4)} ${sku.stockUnit}`,
        );
      }

      let remaining = requiredQty;
      for (const entry of availableEntries) {
        if (remaining.lte(0)) break;
        const consumeQty = Decimal.min(remaining, entry.qty);
        if (consumeQty.lte(0)) continue;

        await this.subtractInventoryStock(manager, {
          skuId,
          warehouseId: entry.warehouseId,
          locationId: entry.locationId,
          qty: consumeQty.toFixed(4),
          stockUnit: sku.stockUnit,
          respectReserved: itemType !== 'material',
        });

        if (entry.dyeLotNo) {
          await manager.query(
            `UPDATE inventory_dye_lots
             SET qty_on_hand = qty_on_hand - ?, last_in_at = NOW()
             WHERE tenant_id = ? AND sku_id = ? AND dye_lot_no = ?`,
            [consumeQty.toFixed(4), this.tenantId, skuId, entry.dyeLotNo],
          );
        }

        const tx = await this.createInventoryTransaction(manager, {
          skuId,
          transactionType: 'PRODUCTION_CONSUME_OUT',
          direction: 'OUT',
          warehouseId: entry.warehouseId,
          locationId: entry.locationId,
          sourceRef: 'production:task:consume',
          qtyInput: consumeQty.toFixed(4),
          inputUnit: sku.stockUnit,
          qtyStockUnit: consumeQty.toFixed(4),
          stockUnit: sku.stockUnit,
          dyeLotNo: entry.dyeLotNo,
          productionOrderId: task.production_order_id,
          referenceType: 'production_task',
          referenceId: taskId,
          referenceNo: task.task_no,
          notes: `生产任务 ${task.task_no} 报工消耗`,
        });

        await this.linkTaskInventoryMovement(manager, {
          taskId,
          taskMaterialTxId,
          skuId,
          movementType: 'consume',
          inventoryTxId: tx.id,
          qty: consumeQty.toFixed(4),
          notes: '报工消耗',
        });

        remaining = remaining.minus(consumeQty);
      }

      await manager.query(
        `UPDATE task_material_transactions
         SET actual_qty = ?
         WHERE tenant_id = ? AND id = ?`,
        [requiredQty.toFixed(4), this.tenantId, taskMaterialTxId],
      );

      await this.syncInventoryDailySnapshot(manager, skuId);
      this.trackInventorySnapshotCacheInvalidation(manager, [skuId]);
      affectedSkuIds.push(skuId);
    }

    return affectedSkuIds;
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
          COALESCE(MIN(GREATEST(completed_qty - COALESCE(scrap_qty, 0), 0)), 0) AS qtyCompleted,
          COUNT(*) AS totalOps,
          SUM(CASE WHEN completed_qty >= planned_qty THEN 1 ELSE 0 END) AS completedOps
       FROM production_tasks
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

    if (status === 'completed') {
      await this.releaseCompletedOrderMaterialReservations(manager, productionOrderId);
    }
  }

  private async releaseCompletedOrderMaterialReservations(
    manager: { query: typeof AppDataSource.query; __inventorySnapshotSkuIds?: Set<number> },
    productionOrderId: number,
  ): Promise<void> {
    const materialRows = await manager.query<Array<{ sku_id: number; qty_reserved: string }>>(
      `SELECT sku_id, qty_reserved
       FROM material_requirements
       WHERE production_order_id = ? AND tenant_id = ? AND qty_reserved > 0`,
      [productionOrderId, this.tenantId],
    );

    for (const mat of materialRows) {
      const reservedQty = new Decimal(mat.qty_reserved ?? 0);
      if (reservedQty.lte(0)) continue;

      await manager.query(
        `UPDATE inventory
         SET qty_reserved = GREATEST(qty_reserved - ?, 0), updated_at = NOW()
         WHERE sku_id = ? AND tenant_id = ?`,
        [reservedQty.toFixed(4), mat.sku_id, this.tenantId],
      );

      await this.syncInventoryDailySnapshot(manager, Number(mat.sku_id));
      this.trackInventorySnapshotCacheInvalidation(manager, [Number(mat.sku_id)]);
    }

    await manager.query(
      `UPDATE material_requirements
       SET qty_reserved = 0, qty_shortage = 0, status = 'fulfilled', updated_at = NOW()
       WHERE production_order_id = ? AND tenant_id = ?`,
      [productionOrderId, this.tenantId],
    );
  }

  // ── 私有辅助 ──────────────────────────────────────────────

  /**
   * 按综合优先级加权排序获取待排产工单
   * 权重：交期紧迫度 0.5 + 订单优先级 0.3 + 插单标记 0.2
   */
  private async fetchPendingOrders(batchId?: number): Promise<ProductionOrderRow[]> {
    return AppDataSource.query(
      `SELECT po.id, po.work_order_no, po.sku_id, s.name AS sku_name,
              po.joint_batch_id, po.joint_batch_item_id, po.plan_mode, po.merge_group_key, po.batch_sequence_no,
              jb.batch_no,
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
       LEFT JOIN joint_production_batches jb ON jb.id = po.joint_batch_id AND jb.tenant_id = po.tenant_id
       WHERE po.tenant_id = ? AND po.status IN ('pending', 'scheduled', 'in_progress')
         AND (? IS NULL OR po.joint_batch_id = ?)
       ORDER BY COALESCE(po.batch_sequence_no, 999999) ASC, composite_score DESC
       LIMIT 100`,
      [this.tenantId, batchId ?? null, batchId ?? null],
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

  private async fetchSchedulableOperations(batchId?: number): Promise<ScheduledOperationRow[]> {
    return AppDataSource.query(
      `SELECT
          op.id AS operation_id,
          op.production_order_id,
          po.joint_batch_id,
          po.joint_batch_item_id,
          jb.batch_no,
          po.plan_mode,
          po.merge_group_key,
          po.batch_sequence_no,
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
       LEFT JOIN joint_production_batches jb ON jb.id = po.joint_batch_id AND jb.tenant_id = po.tenant_id
       LEFT JOIN process_steps ps ON ps.id = op.process_step_id
       LEFT JOIN skus outs ON outs.id = op.output_sku_id
       WHERE op.tenant_id = ?
         AND po.tenant_id = ?
         AND (? IS NULL OR po.joint_batch_id = ?)
         AND po.status IN ('pending', 'scheduled', 'in_progress')
         AND op.execution_mode = 'internal'
         AND op.status IN ('pending', 'released', 'scheduled', 'in_progress')
         AND op.completed_qty < op.planned_qty
       ORDER BY
         COALESCE(po.batch_sequence_no, 999999) ASC,
         (
           50 * (1 - LEAST(DATEDIFF(so.expected_delivery, CURDATE()) / 30, 1)) +
           30 * (po.priority / 100) +
           20 * IF(so.order_type = 'urgent', 1, 0)
         ) DESC,
         COALESCE(ps.step_no, 9999) ASC,
         op.id ASC`,
      [this.tenantId, this.tenantId, batchId ?? null, batchId ?? null],
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
   * 贪心工人匹配：选当日已分配工时最少且未超当日可用工时的工人
   */
  private matchWorker(
    wsType: string | null,
    workers: WorkerRow[],
    load: Map<number, Decimal>,
    requiredHours: string,
    maxHoursPerWorker: Decimal,
  ): WorkerRow | null {
    void wsType; // Phase 2 按技能标签匹配，Phase 1 仅按负荷
    const available = workers.filter(
      (w) => (load.get(w.id) ?? new Decimal(0)).plus(new Decimal(requiredHours ?? 0)).lte(maxHoursPerWorker),
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
      const redis = getRedisClient();
      await this.safeRedisDel(
        redis,
        RedisKeys.schedule(this.tenantId, date),
        'schedule-cache-invalidate',
      );
      const extraKeys = await redis.keys(RedisKeys.schedulePattern(this.tenantId, date));
      for (const key of extraKeys) {
        if (key === RedisKeys.schedule(this.tenantId, date)) continue;
        await this.safeRedisDel(redis, key, 'schedule-cache-invalidate-pattern');
      }
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

  private async getNextWorkday(): Promise<string> {
    const today = new Date().toISOString().slice(0, 10);
    return findNextWorkday(this.tenantId, today);
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
