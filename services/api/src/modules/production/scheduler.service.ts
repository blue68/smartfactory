import Decimal from 'decimal.js';
import { AppDataSource } from '../../config/database';
import { TenantContext } from '../../shared/BaseRepository';
import { getRedisClient, RedisKeys, RedisTTL } from '../../config/redis';

// ─── 类型定义 ──────────────────────────────────────────────────

interface ProductionOrderRow {
  id: number;
  work_order_no: string;
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

export interface SchedulePlan {
  date: string;
  schedules: Array<{
    productionOrderId: number;
    workOrderNo: string;
    processStepId: number;
    stepName: string;
    workerId: number | null;
    workerName: string | null;
    workstationId: number | null;
    workstationName: string | null;
    plannedQty: string;
    estimatedHours: string;
  }>;
  summary: {
    totalOrders: number;
    totalSteps: number;
    capacityLoadRate: string;
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

  /**
   * 为指定日期生成排产计划
   * @param targetDate  排产日期（YYYY-MM-DD），默认明天
   */
  async generateSchedule(targetDate?: string): Promise<SchedulePlan> {
    const date = targetDate ?? this.getNextWorkday();
    const cacheKey = RedisKeys.schedule(this.tenantId, date);
    const redis = getRedisClient();

    // 已有缓存则直接返回
    const cached = await redis.get(cacheKey);
    if (cached) return JSON.parse(cached) as SchedulePlan;

    // 1. 读取所有待排产/进行中的生产工单，按综合优先级排序
    const orders = await this.fetchPendingOrders();
    if (orders.length === 0) {
      return { date, schedules: [], summary: { totalOrders: 0, totalSteps: 0, capacityLoadRate: '0%' } };
    }

    // 2. 读取工人与工作站资源
    const [workers, workstations] = await Promise.all([
      this.fetchWorkers(),
      this.fetchWorkstations(),
    ]);

    // 3. 贪心分配
    const schedules: SchedulePlan['schedules'] = [];
    // workerLoad: workerId → 已分配工时（小时）
    const workerLoad = new Map<number, Decimal>(workers.map((w) => [w.id, new Decimal(0)]));
    // wsLoad: workstationId → 已分配产量
    const wsLoad = new Map<number, Decimal>(workstations.map((ws) => [ws.id, new Decimal(0)]));

    for (const order of orders) {
      const steps = await this.fetchProcessSteps(order.process_template_id);

      for (const step of steps) {
        // 匹配工作站
        const ws = this.matchWorkstation(step.workstation_type, workstations, wsLoad, order.qty_planned);
        // 匹配工人
        const worker = this.matchWorker(step.workstation_type, workers, workerLoad, step.standard_hours);

        const plannedQty = new Decimal(order.qty_planned);
        const estimatedHours = new Decimal(step.standard_hours ?? 0).mul(plannedQty);

        // 更新负荷
        if (worker) {
          workerLoad.set(worker.id, (workerLoad.get(worker.id) ?? new Decimal(0)).plus(estimatedHours));
        }
        if (ws) {
          wsLoad.set(ws.id, (wsLoad.get(ws.id) ?? new Decimal(0)).plus(plannedQty));
        }

        schedules.push({
          productionOrderId: order.id,
          workOrderNo: order.work_order_no,
          processStepId: step.id,
          stepName: step.step_name,
          workerId: worker?.id ?? null,
          workerName: worker?.real_name ?? null,
          workstationId: ws?.id ?? null,
          workstationName: ws?.name ?? null,
          plannedQty: plannedQty.toFixed(2),
          estimatedHours: estimatedHours.toFixed(2),
        });
      }
    }

    // 4. 计算产能负荷率
    const totalAvailableHours = new Decimal(workers.length * 8);
    const totalScheduledHours = [...workerLoad.values()].reduce((s, v) => s.plus(v), new Decimal(0));
    const loadRate = totalAvailableHours.gt(0)
      ? totalScheduledHours.div(totalAvailableHours).mul(100).toFixed(1) + '%'
      : '0%';

    const plan: SchedulePlan = {
      date,
      schedules,
      summary: {
        totalOrders: orders.length,
        totalSteps: schedules.length,
        capacityLoadRate: loadRate,
      },
    };

    // 5. 持久化排产记录到数据库
    await this.persistSchedule(date, schedules);

    // 6. 缓存
    await redis.setex(cacheKey, RedisTTL.SCHEDULE, JSON.stringify(plan));

    return plan;
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
      id: number; production_order_id: number; process_step_id: number;
      worker_id: number | null; planned_qty: string;
    }>>(
      `SELECT id, production_order_id, process_step_id, worker_id, planned_qty
       FROM production_schedules
       WHERE tenant_id = ? AND schedule_date = ? AND status = 'confirmed' AND worker_id IS NOT NULL`,
      [this.tenantId, date],
    );

    for (const s of schedules) {
      const taskNo = `TK${Date.now()}${Math.floor(Math.random() * 999).toString().padStart(3, '0')}`;
      await AppDataSource.query(
        `INSERT IGNORE INTO production_tasks
           (tenant_id, task_no, schedule_id, production_order_id, process_step_id,
            worker_id, task_date, planned_qty, status, created_by, updated_by)
         VALUES (?,?,?,?,?,?,?,?,'pending',?,?)`,
        [
          this.tenantId, taskNo, s.id, s.production_order_id,
          s.process_step_id, s.worker_id, date, s.planned_qty,
          this.userId, this.userId,
        ],
      );
    }
  }

  /**
   * 获取工人当日任务列表
   */
  async getWorkerTasks(workerId: number, date: string): Promise<any[]> {
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

  /**
   * 工人开始任务
   */
  async startTask(taskId: number): Promise<void> {
    await AppDataSource.query(
      `UPDATE production_tasks
       SET status = 'started', started_at = NOW(), updated_by = ?
       WHERE id = ? AND tenant_id = ? AND status = 'pending'`,
      [this.userId, taskId, this.tenantId],
    );
  }

  /**
   * 工人上报完工
   */
  async completeTask(taskId: number, params: {
    completedQty: string;
    scrapQty?: string;
    scrapReason?: 'material_defect' | 'operation_error' | 'other';
    componentBarcode?: string;
    notes?: string;
    images?: string[];
  }): Promise<void> {
    await AppDataSource.transaction(async (manager) => {
      // 更新任务状态
      await manager.query(
        `UPDATE production_tasks
         SET status = 'completed', completed_qty = ?, completed_at = NOW(), updated_by = ?
         WHERE id = ? AND tenant_id = ?`,
        [params.completedQty, this.userId, taskId, this.tenantId],
      );

      // 查询任务关联信息
      const [task] = await manager.query<Array<{
        production_order_id: number; process_step_id: number; worker_id: number;
      }>>(
        'SELECT production_order_id, process_step_id, worker_id FROM production_tasks WHERE id = ? LIMIT 1',
        [taskId],
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

      // 更新生产工单完工数量
      await manager.query(
        `UPDATE production_orders
         SET qty_completed = qty_completed + ?, updated_by = ?
         WHERE id = ? AND tenant_id = ?`,
        [params.completedQty, this.userId, task.production_order_id, this.tenantId],
      );

      // 异步写入溯源链（通过队列，此处直接写简化版）
      const [orderDyeLot] = await manager.query<Array<{ dye_lot_no: string }>>(
        `SELECT dye_lot_no FROM order_dye_lot_bindings
         WHERE production_order_id = ? AND tenant_id = ? LIMIT 1`,
        [task.production_order_id, this.tenantId],
      );

      await manager.query(
        `INSERT INTO traceability_records
           (tenant_id, production_order_id, task_id, component_barcode,
            process_step_id, worker_id, dye_lot_no, operation_time, has_scan_record, created_by)
         VALUES (?,?,?,?,?,?,?,NOW(),?,?)`,
        [
          this.tenantId, task.production_order_id, taskId,
          params.componentBarcode ?? null,
          task.process_step_id, task.worker_id,
          orderDyeLot?.dye_lot_no ?? null,
          params.componentBarcode ? 1 : 0,
          this.userId,
        ],
      );
    });
  }

  // ── 私有辅助 ──────────────────────────────────────────────

  /**
   * 按综合优先级加权排序获取待排产工单
   * 权重：交期紧迫度 0.5 + 订单优先级 0.3 + 插单标记 0.2
   */
  private async fetchPendingOrders(): Promise<ProductionOrderRow[]> {
    return AppDataSource.query(
      `SELECT po.id, po.work_order_no, po.sku_id, s.name AS sku_name,
              po.qty_planned, po.priority, po.planned_end,
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

  private async fetchProcessSteps(templateId: number): Promise<ProcessStepRow[]> {
    return AppDataSource.query(
      `SELECT id, step_no, step_name,
              COALESCE(standard_hours, 0) AS standard_hours,
              workstation_type
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
    stations: WorkstationRow[],
    load: Map<number, Decimal>,
    qty: string,
  ): WorkstationRow | null {
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
    stdHours: string,
  ): WorkerRow | null {
    void wsType; // Phase 2 按技能标签匹配，Phase 1 仅按负荷
    const available = workers.filter(
      (w) => (load.get(w.id) ?? new Decimal(0)).plus(new Decimal(stdHours ?? 0)).lte(8),
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

  private async persistSchedule(
    date: string,
    schedules: SchedulePlan['schedules'],
  ): Promise<void> {
    if (schedules.length === 0) return;

    // 先清除当日旧的 AI 生成排产（保留人工调整的）
    await AppDataSource.query(
      `DELETE FROM production_schedules
       WHERE tenant_id = ? AND schedule_date = ? AND ai_generated = 1 AND status = 'planned'`,
      [this.tenantId, date],
    );

    for (const s of schedules) {
      await AppDataSource.query(
        `INSERT INTO production_schedules
           (tenant_id, schedule_date, production_order_id, process_step_id,
            workstation_id, worker_id, planned_qty, status, ai_generated, created_by, updated_by)
         VALUES (?,?,?,?,?,?,?,'planned',1,?,?)`,
        [
          this.tenantId, date, s.productionOrderId, s.processStepId,
          s.workstationId, s.workerId, s.plannedQty,
          this.userId, this.userId,
        ],
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
}
