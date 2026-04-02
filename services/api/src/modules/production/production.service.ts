import { AppDataSource } from '../../config/database';
import { getRedisClient, RedisKeys } from '../../config/redis';
import { TenantContext } from '../../shared/BaseRepository';
import { AppError } from '../../shared/AppError';
import { ResponseCode } from '../../shared/ApiResponse';
import { SchedulerService } from './scheduler.service';
import { WageService } from '../report/wage.service';

export class ProductionService {
  private readonly tenantId: number;
  private readonly userId: number;
  private readonly scheduler: SchedulerService;

  constructor(ctx: TenantContext) {
    this.tenantId = ctx.tenantId;
    this.userId = ctx.userId;
    this.scheduler = new SchedulerService(ctx);
  }

  private async invalidateScheduleCache(date: string): Promise<void> {
    try {
      await getRedisClient().del(RedisKeys.schedule(this.tenantId, date));
    } catch (err) {
      console.warn(
        `[ProductionService] Redis unavailable during manual schedule adjustment cache invalidation for tenant=${this.tenantId} date=${date}: ${(err as Error).message}`,
      );
    }
  }

  async generateSchedule(date?: string, force = false) {
    return this.scheduler.generateSchedule(date, force);
  }

  async confirmSchedule(date: string) {
    return this.scheduler.confirmSchedule(date);
  }

  async getWorkerTasks(workerId: number, date: string) {
    return this.scheduler.getWorkerTasks(workerId, date);
  }

  async startTask(taskId: number) {
    return this.scheduler.startTask(taskId);
  }

  async completeTask(taskId: number, params: {
    completedQty: string;
    actualHours?: number;        // R06-G02: 实际工时（小时）
    scrapQty?: string;
    scrapReason?: 'material_defect' | 'operation_error' | 'other';
    componentBarcode?: string;
    notes?: string;
    images?: string[];
  }) {
    return this.scheduler.completeTask(taskId, params);
  }

  async listProductionOrders(params: {
    status?: string; salesOrderId?: number; page: number; pageSize: number;
  }) {
    const conds = ['po.tenant_id = ?'];
    const p: unknown[] = [this.tenantId];
    if (params.status) { conds.push('po.status = ?'); p.push(params.status); }
    if (params.salesOrderId) { conds.push('po.sales_order_id = ?'); p.push(params.salesOrderId); }

    const where = conds.join(' AND ');
    const offset = (params.page - 1) * params.pageSize;

    const [list, countRows] = await Promise.all([
      AppDataSource.query(
        `SELECT po.*, s.name AS skuName, so.order_no AS salesOrderNo,
                so.expected_delivery,
                ROUND(po.qty_completed / po.qty_planned * 100, 1) AS progressPct
         FROM production_orders po
         INNER JOIN skus s ON s.id = po.sku_id
         INNER JOIN sales_orders so ON so.id = po.sales_order_id
         WHERE ${where}
         ORDER BY po.priority DESC, so.expected_delivery ASC
         LIMIT ? OFFSET ?`,
        [...p, params.pageSize, offset],
      ),
      AppDataSource.query<Array<{ total: number }>>(
        `SELECT COUNT(*) AS total FROM production_orders po WHERE ${where}`, p,
      ),
    ]);

    return { list, total: Number(countRows[0]?.total ?? 0) };
  }

  async getProductionOrderDetail(orderId: number) {
    const [order] = await AppDataSource.query(
      `SELECT po.*, s.name AS skuName, so.order_no AS salesOrderNo,
              so.expected_delivery, so.customer_id,
              ROUND(po.qty_completed / po.qty_planned * 100, 1) AS progressPct
       FROM production_orders po
       INNER JOIN skus s ON s.id = po.sku_id
       INNER JOIN sales_orders so ON so.id = po.sales_order_id
       WHERE po.id = ? AND po.tenant_id = ? LIMIT 1`,
      [orderId, this.tenantId],
    );
    if (!order) throw AppError.notFound('生产工单不存在', ResponseCode.PRODUCTION_ORDER_NOT_FOUND);

    const tasks = await AppDataSource.query(
      `SELECT pt.*,
              pt.task_no AS taskNo,
              pt.operation_id AS operationId,
              pt.output_sku_id AS outputSkuId,
              pt.actual_hours AS actualHours,
              CASE WHEN pt.status = 'started' THEN 'in_progress' ELSE pt.status END AS status,
              u.real_name AS workerName,
              ps.step_name AS stepName,
              outs.name AS outputSkuName
       FROM production_tasks pt
       LEFT JOIN users u ON u.id = pt.worker_id
       INNER JOIN process_steps ps ON ps.id = pt.process_step_id
       LEFT JOIN skus outs ON outs.id = pt.output_sku_id
       WHERE pt.production_order_id = ? AND pt.tenant_id = ?
       ORDER BY pt.task_date, ps.step_no`,
      [orderId, this.tenantId],
    );

    return { ...order, tasks };
  }

  async createProductionOrder(params: {
    salesOrderId: number;
    salesOrderItemId: number;
    skuId: number;
    bomHeaderId: number;
    processTemplateId: number;
    qtyPlanned: string;
    priority?: number;
    plannedStart?: string;
    plannedEnd?: string;
    notes?: string;
  }) {
    const workOrderNo = `WO${Date.now()}${Math.floor(Math.random() * 999).toString().padStart(3, '0')}`;

    const result = await AppDataSource.query(
      `INSERT INTO production_orders
         (tenant_id, work_order_no, sales_order_id, sales_order_item_id, sku_id, bom_header_id,
          bom_snapshot_id, process_template_id, qty_planned, qty_completed, status, priority,
          planned_start, planned_end, notes, created_by, updated_by)
       VALUES (?,?,?,?,?,?,?,?,?,0,'pending',?,?,?,?,?,?)`,
      [
        this.tenantId, workOrderNo, params.salesOrderId, params.salesOrderItemId, params.skuId,
        params.bomHeaderId, params.bomHeaderId, params.processTemplateId, params.qtyPlanned,
        params.priority ?? 50, params.plannedStart ?? null, params.plannedEnd ?? null,
        params.notes ?? null, this.userId, this.userId,
      ],
    );

    return { id: Number(result.insertId), workOrderNo };
  }

  // R-06: 任务列表（支持分页、状态筛选、关键字搜索）
  // BE-06-01: 任务详情
  async getTaskDetail(taskId: number): Promise<unknown> {
    const tasks = await AppDataSource.query(
        `SELECT pt.id,
                pt.task_no AS taskNo,
                pt.task_date AS taskDate,
                CASE WHEN pt.status = 'started' THEN 'in_progress' ELSE pt.status END AS status,
                pt.planned_qty AS plannedQty, pt.completed_qty AS completedQty,
                pt.scrap_qty AS scrapQty, pt.worker_id AS workerId,
                pt.workstation_id AS workstationId, pt.process_step_id AS processStepId,
                pt.operation_id AS operationId, pt.output_sku_id AS outputSkuId,
                pt.actual_hours AS actualHours,
                pt.production_order_id AS productionOrderId,
                pt.started_at AS startedAt, pt.completed_at AS completedAt,
                pt.created_at AS createdAt, pt.updated_at AS updatedAt,
                po.work_order_no AS orderNo, po.priority,
                po.sales_order_id AS salesOrderId, po.sku_id AS skuId, po.qty_planned AS orderPlannedQty,
                ps.step_name AS processName, ps.step_no AS stepNo,
                ps.standard_hours AS standardHours, ps.max_hours AS maxHours,
                ws.name AS workstationName,
                u.real_name AS workerName,
                s.name AS skuName, s.sku_code AS skuCode,
                outs.name AS outputSkuName
         FROM production_tasks pt
         INNER JOIN production_orders po ON po.id = pt.production_order_id
         INNER JOIN process_steps ps ON ps.id = pt.process_step_id
         LEFT JOIN workstations ws ON ws.id = pt.workstation_id
         LEFT JOIN users u ON u.id = pt.worker_id
         LEFT JOIN skus s ON s.id = po.sku_id
         LEFT JOIN skus outs ON outs.id = COALESCE(pt.output_sku_id, ps.output_sku_id)
         WHERE pt.id = ? AND pt.tenant_id = ?`,
      [taskId, this.tenantId],
    );

    if (!tasks || tasks.length === 0) {
      throw AppError.notFound('任务不存在', ResponseCode.NOT_FOUND);
    }

    const task = tasks[0];

    // 获取异常记录作为操作时间线
    const exceptions = await AppDataSource.query(
      `SELECT te.id, te.exception_type AS type, te.description,
              te.severity, te.reported_by AS reportedBy,
              te.resolved_at AS resolvedAt, te.resolved_by AS resolvedBy,
              te.resolution, te.created_at AS createdAt,
              ru.real_name AS reporterName, resu.real_name AS resolverName
       FROM task_exceptions te
       LEFT JOIN users ru ON ru.id = te.reported_by
       LEFT JOIN users resu ON resu.id = te.resolved_by
       WHERE te.task_id = ? AND te.tenant_id = ?
       ORDER BY te.created_at ASC`,
      [taskId, this.tenantId],
    );

    const [dependencySummary, materialTransactions, wageRows] = await Promise.all([
      this.getTaskDependencySummary(Number(task.operationId ?? 0) || null),
      this.getTaskMaterialTransactions(taskId),
      new WageService({ tenantId: this.tenantId, userId: this.userId }).getTaskWageReport({
        page: 1,
        pageSize: 1,
        taskId,
      }),
    ]);

    return {
      ...task,
      statusLabel: this.getTaskStatusLabel(String(task.status ?? 'pending')),
      dependencySummary,
      materialTransactions,
      wageReport: wageRows[0][0] ?? null,
      exceptions,
    };
  }

  async listTasks(params: {
    page: number; pageSize: number; status?: string; keyword?: string;
    processId?: number; dateFrom?: string; dateTo?: string; priority?: number;
  }) {
    const conds = ['pt.tenant_id = ?'];
    const p: unknown[] = [this.tenantId];

    if (params.status) {
      if (params.status === 'in_progress') {
        conds.push("pt.status = 'started'");
      } else {
        conds.push('pt.status = ?');
        p.push(params.status);
      }
    }
    if (params.keyword) {
      conds.push('(po.work_order_no LIKE ? OR ps.step_name LIKE ? OR u.real_name LIKE ?)');
      p.push(`%${params.keyword}%`, `%${params.keyword}%`, `%${params.keyword}%`);
    }
    // BE-06-02: 新增筛选参数
    if (params.processId) {
      conds.push('ps.id = ?');
      p.push(params.processId);
    }
    if (params.dateFrom) {
      conds.push('pt.task_date >= ?');
      p.push(params.dateFrom);
    }
    if (params.dateTo) {
      conds.push('pt.task_date <= ?');
      p.push(params.dateTo);
    }
    if (params.priority) {
      conds.push('po.priority = ?');
      p.push(params.priority);
    }

    const where = conds.join(' AND ');
    const offset = (params.page - 1) * params.pageSize;

    const [list, countRows] = await Promise.all([
      AppDataSource.query(
        // R06-G12: 补充 priority、version、actual_hours、skuName（产品名）字段
        `SELECT pt.id, pt.task_no AS taskNo, pt.task_date AS taskDate,
                CASE WHEN pt.status = 'started' THEN 'in_progress' ELSE pt.status END AS status,
                pt.planned_qty AS plannedQty, pt.completed_qty AS completedQty,
                pt.version, pt.actual_hours AS actualHours, ps.id AS processStepId,
                pt.operation_id AS operationId, pt.output_sku_id AS outputSkuId,
                po.work_order_no AS orderNo, po.priority,
                ps.step_name AS processName,
                ws.name AS workstationName, u.real_name AS workerName,
                s.name AS skuName, s.sku_code AS skuCode,
                outs.name AS outputSkuName
         FROM production_tasks pt
         INNER JOIN production_orders po ON po.id = pt.production_order_id
         INNER JOIN process_steps ps ON ps.id = pt.process_step_id
         LEFT JOIN workstations ws ON ws.id = pt.workstation_id
         LEFT JOIN users u ON u.id = pt.worker_id
         LEFT JOIN skus s ON s.id = po.sku_id
         LEFT JOIN skus outs ON outs.id = COALESCE(pt.output_sku_id, ps.output_sku_id)
         WHERE ${where}
         ORDER BY pt.task_date DESC, pt.id DESC
         LIMIT ? OFFSET ?`,
        [...p, params.pageSize, offset],
      ),
      AppDataSource.query<Array<{ total: string }>>(
        `SELECT COUNT(*) AS total
         FROM production_tasks pt
         INNER JOIN production_orders po ON po.id = pt.production_order_id
         INNER JOIN process_steps ps ON ps.id = pt.process_step_id
         LEFT JOIN users u ON u.id = pt.worker_id
         WHERE ${where}`,
        p,
      ),
    ]);

    return { list, total: Number(countRows[0]?.total ?? 0) };
  }

  // R-06: 异常上报
  async reportException(taskId: number, params: {
    type: string; description: string; severity: string; affectsProgress?: boolean;
  }) {
    await AppDataSource.transaction(async (manager) => {
      const [task] = await manager.query<Array<{ id: number; status: string }>>(
        `SELECT id, status
         FROM production_tasks
         WHERE id = ? AND tenant_id = ?
         LIMIT 1 FOR UPDATE`,
        [taskId, this.tenantId],
      );

      if (!task) {
        throw AppError.notFound('任务不存在', ResponseCode.NOT_FOUND);
      }

      if (task.status !== 'started') {
        if (task.status === 'exception') {
          throw AppError.conflict('任务已处于异常处理中，请先解决当前异常');
        }

        throw AppError.badRequest(
          `任务状态为「${task.status}」，无法上报异常。只有 started 状态的任务可以上报异常`,
        );
      }

      // 更新任务状态为 exception，同时写入 affects_progress 标记
      await manager.query(
        `UPDATE production_tasks
         SET status = 'exception', affects_progress = ?, updated_by = ?
         WHERE id = ? AND tenant_id = ?`,
        [params.affectsProgress ? 1 : 0, this.userId, taskId, this.tenantId],
      );
      // 插入异常记录
      await manager.query(
        `INSERT INTO task_exceptions
           (tenant_id, task_id, exception_type, description, severity, reported_by)
         VALUES (?,?,?,?,?,?)`,
        [this.tenantId, taskId, params.type, params.description, params.severity, this.userId],
      );
    });
  }

  // P0-06: 暂停任务（started / pending / exception 状态可暂停）
  async suspendTask(taskId: number, reason: string): Promise<unknown> {
    return AppDataSource.transaction(async (manager) => {
      const [task] = await manager.query(
        `SELECT id, status
         FROM production_tasks
         WHERE id = ? AND tenant_id = ? LIMIT 1 FOR UPDATE`,
        [taskId, this.tenantId],
      );
      if (!task) throw AppError.notFound('任务不存在', ResponseCode.NOT_FOUND);
      if (task.status !== 'started' && task.status !== 'pending' && task.status !== 'exception') {
        throw AppError.badRequest(
          `任务状态为「${task.status}」，无法暂停。只有 started、pending 或 exception 状态的任务可以暂停`,
        );
      }

      await manager.query(
        `UPDATE production_tasks
         SET status = 'suspended', suspend_reason = ?, updated_by = ?
         WHERE id = ? AND tenant_id = ?`,
        [reason, this.userId, taskId, this.tenantId],
      );

      const [updated] = await manager.query(
        `SELECT id, status, suspend_reason AS suspendReason, updated_at AS updatedAt
         FROM production_tasks WHERE id = ? AND tenant_id = ? LIMIT 1`,
        [taskId, this.tenantId],
      );
      return updated;
    });
  }

  // P0-06: 恢复任务（仅 suspended 状态可恢复，状态重置为 pending，清空暂停原因）
  async resumeTask(taskId: number): Promise<unknown> {
    return AppDataSource.transaction(async (manager) => {
      const [task] = await manager.query(
        `SELECT id, status
         FROM production_tasks
         WHERE id = ? AND tenant_id = ? LIMIT 1 FOR UPDATE`,
        [taskId, this.tenantId],
      );
      if (!task) throw AppError.notFound('任务不存在', ResponseCode.NOT_FOUND);
      if (task.status !== 'suspended') {
        throw AppError.badRequest(
          `任务状态为「${task.status}」，无法恢复。只有 suspended 状态的任务可以恢复`,
        );
      }

      await manager.query(
        `UPDATE production_tasks
         SET status = 'pending', suspend_reason = NULL, updated_by = ?
         WHERE id = ? AND tenant_id = ?`,
        [this.userId, taskId, this.tenantId],
      );

      const [updated] = await manager.query(
        `SELECT id, status, suspend_reason AS suspendReason, updated_at AS updatedAt
         FROM production_tasks WHERE id = ? AND tenant_id = ? LIMIT 1`,
        [taskId, this.tenantId],
      );
      return updated;
    });
  }

  // P2: 异常处理（恢复任务状态）
  async resolveException(taskId: number, resolution: string): Promise<void> {
    await AppDataSource.transaction(async (manager) => {
      const [task] = await manager.query<Array<{ id: number; status: string }>>(
        `SELECT id, status
         FROM production_tasks
         WHERE id = ? AND tenant_id = ?
         LIMIT 1 FOR UPDATE`,
        [taskId, this.tenantId],
      );

      if (!task) {
        throw AppError.notFound('任务不存在', ResponseCode.NOT_FOUND);
      }

      if (task.status !== 'exception') {
        throw AppError.badRequest(
          `任务状态为「${task.status}」，无法处理异常。只有 exception 状态的任务可以恢复`,
        );
      }

      // production_tasks 的活动态是 started，不是 in_progress；异常恢复后回到 started。
      await manager.query(
        `UPDATE production_tasks
         SET status = 'started',
             affects_progress = 0,
             updated_by = ?
         WHERE id = ? AND tenant_id = ? AND status = 'exception'`,
        [this.userId, taskId, this.tenantId],
      );
      // 更新异常记录
      const exceptionUpdateResult = await manager.query(
        `UPDATE task_exceptions SET resolved_at = NOW(), resolved_by = ?, resolution = ?
         WHERE task_id = ? AND tenant_id = ? AND resolved_at IS NULL
         ORDER BY id DESC LIMIT 1`,
        [this.userId, resolution, taskId, this.tenantId],
      );

      if (Number((exceptionUpdateResult as { affectedRows?: number })?.affectedRows ?? 0) === 0) {
        throw AppError.conflict('当前任务没有待处理的异常记录');
      }
    });
  }

  // BE-P1: 排产手动调整
  async adjustSchedule(
    date: string,
    adjustments: Array<{
      scheduleId: number;
      workerId?: number;
      workstationId?: number;
      plannedQty?: string;
      expectedUpdatedAt?: string;
    }>,
  ): Promise<{ updated: number }> {
    let updated = 0;
    const normalizedAdjustments = [...adjustments].sort((a, b) => a.scheduleId - b.scheduleId);

    await AppDataSource.transaction(async (manager) => {
      for (const adj of normalizedAdjustments) {
        const sets: string[] = [];
        const vals: unknown[] = [];
        if (adj.workerId !== undefined) { sets.push('worker_id = ?'); vals.push(adj.workerId); }
        if (adj.workstationId !== undefined) { sets.push('workstation_id = ?'); vals.push(adj.workstationId); }
        if (adj.plannedQty !== undefined) { sets.push('planned_qty = ?'); vals.push(adj.plannedQty); }
        if (sets.length === 0) continue;

        const rows = await manager.query<Array<{ id: number; updatedAt: string }>>(
          `SELECT
             id,
             DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i:%s') AS updatedAt
           FROM production_schedules
           WHERE id = ? AND tenant_id = ? AND schedule_date = ? AND status = 'planned'
           FOR UPDATE`,
          [adj.scheduleId, this.tenantId, date],
        );
        if (!rows.length) continue;
        if (adj.expectedUpdatedAt && rows[0].updatedAt !== adj.expectedUpdatedAt) {
          throw AppError.conflict(
            `排产行 ${adj.scheduleId} 已被其他人修改，请刷新后重试`,
          );
        }

        sets.push('updated_by = ?');
        vals.push(this.userId, adj.scheduleId, this.tenantId, date);
        const queryResult = await manager.query(
          `UPDATE production_schedules
           SET ${sets.join(', ')}
           WHERE id = ? AND tenant_id = ? AND schedule_date = ? AND status = 'planned'`,
          vals,
        );
        const result = Array.isArray(queryResult) ? queryResult[0] : queryResult;
        if (result?.affectedRows) updated++;
      }
    });

    if (updated > 0) {
      await this.invalidateScheduleCache(date);
    }
    return { updated };
  }

  // BE-P1: 工人列表
  async listWorkers(): Promise<Array<{ id: number; name: string; station?: string }>> {
    const rows = await AppDataSource.query(
      `SELECT DISTINCT u.id, u.real_name AS name
       FROM users u
       INNER JOIN user_roles ur ON ur.user_id = u.id
       INNER JOIN roles r ON r.id = ur.role_id
       WHERE u.tenant_id = ? AND u.status = 'active' AND r.code = 'worker'
       ORDER BY u.real_name`,
      [this.tenantId],
    );
    return rows;
  }

  // BE-P1: 工作站列表
  async listWorkstations(includeInactive = false): Promise<Array<{
    id: number;
    name: string;
    type: string;
    capacity: number;
    status: 'active' | 'inactive';
    linkedProcessCount: number;
  }>> {
    const rows = await AppDataSource.query(
      `SELECT
          ws.id,
          ws.name,
          ws.type,
          ws.capacity,
          ws.status,
          COALESCE(step_usage.linked_process_count, 0) AS linkedProcessCount
       FROM workstations ws
       LEFT JOIN (
         SELECT workstation_type, COUNT(*) AS linked_process_count
         FROM process_steps
         WHERE tenant_id = ?
         GROUP BY workstation_type
       ) step_usage ON step_usage.workstation_type = ws.type
       WHERE ws.tenant_id = ?
         AND (? = 1 OR ws.status = 'active')
       ORDER BY
         CASE ws.status WHEN 'active' THEN 0 ELSE 1 END,
         ws.type ASC,
         ws.name ASC`,
      [this.tenantId, this.tenantId, includeInactive ? 1 : 0],
    );
    return rows;
  }

  async createWorkstation(params: {
    name: string;
    type: string;
    capacity?: number;
    status?: 'active' | 'inactive';
  }): Promise<{
    id: number;
    name: string;
    type: string;
    capacity: number;
    status: 'active' | 'inactive';
  }> {
    const name = params.name.trim();
    const type = params.type.trim();
    const capacity = params.capacity ?? 100;
    const status = params.status ?? 'active';

    const [exists] = await AppDataSource.query<Array<{ id: number }>>(
      `SELECT id
       FROM workstations
       WHERE tenant_id = ? AND name = ?
       LIMIT 1`,
      [this.tenantId, name],
    );
    if (exists) {
      throw new AppError('工作站名称已存在', ResponseCode.CONFLICT, 409);
    }

    const result = await AppDataSource.query(
      `INSERT INTO workstations
         (tenant_id, name, type, capacity, status)
       VALUES (?,?,?,?,?)`,
      [this.tenantId, name, type, capacity, status],
    );

    return {
      id: Number(result.insertId),
      name,
      type,
      capacity,
      status,
    };
  }

  async updateWorkstation(id: number, params: {
    name?: string;
    type?: string;
    capacity?: number;
    status?: 'active' | 'inactive';
  }): Promise<{
    id: number;
    name: string;
    type: string;
    capacity: number;
    status: 'active' | 'inactive';
  }> {
    const [current] = await AppDataSource.query<Array<{
      id: number;
      name: string;
      type: string;
      capacity: number;
      status: 'active' | 'inactive';
    }>>(
      `SELECT id, name, type, capacity, status
       FROM workstations
       WHERE id = ? AND tenant_id = ?
       LIMIT 1`,
      [id, this.tenantId],
    );
    if (!current) {
      throw AppError.notFound('工作站不存在', ResponseCode.WORKSTATION_NOT_FOUND);
    }

    const nextName = params.name?.trim() || current.name;
    const nextType = params.type?.trim() || current.type;
    const nextCapacity = params.capacity ?? Number(current.capacity);
    const nextStatus = params.status ?? current.status;

    const [duplicate] = await AppDataSource.query<Array<{ id: number }>>(
      `SELECT id
       FROM workstations
       WHERE tenant_id = ? AND name = ? AND id <> ?
       LIMIT 1`,
      [this.tenantId, nextName, id],
    );
    if (duplicate) {
      throw new AppError('工作站名称已存在', ResponseCode.CONFLICT, 409);
    }

    await AppDataSource.query(
      `UPDATE workstations
       SET name = ?, type = ?, capacity = ?, status = ?
       WHERE id = ? AND tenant_id = ?`,
      [nextName, nextType, nextCapacity, nextStatus, id, this.tenantId],
    );

    return {
      id,
      name: nextName,
      type: nextType,
      capacity: nextCapacity,
      status: nextStatus,
    };
  }

  async deleteWorkstation(id: number): Promise<void> {
    const [current] = await AppDataSource.query<Array<{ id: number }>>(
      `SELECT id
       FROM workstations
       WHERE id = ? AND tenant_id = ?
       LIMIT 1`,
      [id, this.tenantId],
    );
    if (!current) {
      throw AppError.notFound('工作站不存在', ResponseCode.WORKSTATION_NOT_FOUND);
    }

    await AppDataSource.query(
      `UPDATE workstations
       SET status = 'inactive'
       WHERE id = ? AND tenant_id = ?`,
      [id, this.tenantId],
    );
  }

  // BE-P2-009: 工作日历 — 获取月度日历
  async getWorkCalendar(year: number, month: number): Promise<Array<{
    date: string;
    isWorkday: boolean;
    isHoliday: boolean;
    holidayName?: string;
  }>> {
    // Build all dates in the requested month
    const firstDay = new Date(Date.UTC(year, month - 1, 1));
    const lastDay  = new Date(Date.UTC(year, month, 0));       // day 0 of next month = last day of this month
    const totalDays = lastDay.getUTCDate();

    // Attempt to fetch custom overrides from work_calendar; gracefully degrade if table absent
    let overrideMap = new Map<string, { isWorkday: boolean; holidayName?: string }>();
    try {
      const startStr = `${year}-${String(month).padStart(2, '0')}-01`;
      const endStr   = `${year}-${String(month).padStart(2, '0')}-${String(totalDays).padStart(2, '0')}`;
      const rows: Array<{ date: string; is_workday: number; holiday_name: string | null }> =
        await AppDataSource.query(
          `SELECT DATE_FORMAT(date, '%Y-%m-%d') AS date, is_workday, holiday_name
           FROM work_calendar
           WHERE tenant_id = ? AND date BETWEEN ? AND ?`,
          [this.tenantId, startStr, endStr],
        );
      for (const row of rows) {
        overrideMap.set(row.date, {
          isWorkday:   row.is_workday === 1,
          holidayName: row.holiday_name ?? undefined,
        });
      }
    } catch {
      // work_calendar table may not yet exist — fall through with empty overrideMap
    }

    const result: Array<{ date: string; isWorkday: boolean; isHoliday: boolean; holidayName?: string }> = [];

    for (let d = 1; d <= totalDays; d++) {
      const dateObj  = new Date(Date.UTC(year, month - 1, d));
      const dateStr  = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dow      = dateObj.getUTCDay();          // 0 = Sunday, 6 = Saturday
      const override = overrideMap.get(dateStr);

      let isWorkday: boolean;
      let isHoliday = false;
      let holidayName: string | undefined;

      if (override !== undefined) {
        // Custom override takes precedence over weekend default
        isWorkday   = override.isWorkday;
        isHoliday   = !override.isWorkday;
        holidayName = override.holidayName;
      } else {
        // Default rule: Mon–Fri are workdays; Sat/Sun are not
        isWorkday = dow !== 0 && dow !== 6;
        isHoliday = !isWorkday;
      }

      const entry: { date: string; isWorkday: boolean; isHoliday: boolean; holidayName?: string } = {
        date: dateStr,
        isWorkday,
        isHoliday,
      };
      if (holidayName) entry.holidayName = holidayName;
      result.push(entry);
    }

    return result;
  }

  // BE-P2-009: 工作日历 — 设置节假日 / 调休
  // NOTE: work_calendar 表由迁移脚本创建，见 migrations/create_work_calendar.sql
  async setHoliday(params: { date: string; isWorkday: boolean; name?: string }): Promise<void> {
    await AppDataSource.query(
      `INSERT INTO work_calendar (tenant_id, date, is_workday, holiday_name, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         is_workday   = VALUES(is_workday),
         holiday_name = VALUES(holiday_name),
         updated_by   = VALUES(updated_by)`,
      [
        this.tenantId,
        params.date,
        params.isWorkday ? 1 : 0,
        params.name ?? null,
        this.userId,
        this.userId,
      ],
    );
  }

  // BE-P2-009: 工作日历 — 统计两日期之间的工作日数（供约束引擎调用）
  async countWorkdays(startDate: string, endDate: string): Promise<number> {
    const start = new Date(startDate + 'T00:00:00Z');
    const end   = new Date(endDate   + 'T00:00:00Z');

    if (start > end) return 0;

    // Fetch all overrides in the range in one query
    let overrideMap = new Map<string, boolean>();
    try {
      const rows: Array<{ date: string; is_workday: number }> =
        await AppDataSource.query(
          `SELECT DATE_FORMAT(date, '%Y-%m-%d') AS date, is_workday
           FROM work_calendar
           WHERE tenant_id = ? AND date BETWEEN ? AND ?`,
          [this.tenantId, startDate, endDate],
        );
      for (const row of rows) {
        overrideMap.set(row.date, row.is_workday === 1);
      }
    } catch {
      // Graceful fallback: treat all weekdays as workdays
    }

    let count = 0;
    const cursor = new Date(start);
    while (cursor <= end) {
      const dateStr = cursor.toISOString().slice(0, 10);
      const dow     = cursor.getUTCDay();

      const override = overrideMap.get(dateStr);
      const isWorkday = override !== undefined
        ? override
        : (dow !== 0 && dow !== 6);

      if (isWorkday) count++;
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    return count;
  }

  // P0-10: 任务统计 — 按状态分组全量计数
  async getTaskStats(): Promise<{ total: number; byStatus: Record<string, number> }> {
    const rows = await AppDataSource.query<Array<{ status: string; count: string }>>(
      `SELECT CASE WHEN status = 'started' THEN 'in_progress' ELSE status END AS status,
              COUNT(*) AS count
       FROM production_tasks
       WHERE tenant_id = ?
       GROUP BY CASE WHEN status = 'started' THEN 'in_progress' ELSE status END`,
      [this.tenantId],
    );

    const byStatus: Record<string, number> = {};
    let total = 0;
    for (const row of rows) {
      const cnt = Number(row.count);
      byStatus[row.status] = cnt;
      total += cnt;
    }

    return { total, byStatus };
  }

  private getTaskStatusLabel(status: string): string {
    switch (status) {
      case 'pending': return '待开始';
      case 'in_progress': return '进行中';
      case 'completed': return '已完成';
      case 'exception': return '异常';
      case 'suspended': return '已挂起';
      default: return status;
    }
  }

  private async getTaskDependencySummary(operationId: number | null): Promise<{
    blocked: boolean;
    blockingReason: string | null;
    predecessors: Array<{
      operationId: number;
      stepName: string;
      requiredQty: string;
      completedQty: string;
      status: string;
    }>;
  }> {
    if (!operationId) {
      return { blocked: false, blockingReason: null, predecessors: [] };
    }

    const predecessors = await AppDataSource.query<Array<{
      operationId: number;
      stepName: string;
      requiredQty: string;
      completedQty: string;
      status: string;
    }>>(
      `SELECT
          dep.predecessor_operation_id AS operationId,
          COALESCE(ps.step_name, CONCAT('STEP#', pred.process_step_id)) AS stepName,
          dep.required_qty AS requiredQty,
          pred.completed_qty AS completedQty,
          pred.status AS status
       FROM production_operation_dependencies dep
       INNER JOIN production_operations pred
         ON pred.id = dep.predecessor_operation_id
        AND pred.tenant_id = dep.tenant_id
       LEFT JOIN process_steps ps
         ON ps.id = pred.process_step_id
       WHERE dep.tenant_id = ? AND dep.operation_id = ?
       ORDER BY COALESCE(ps.step_no, 9999) ASC, dep.predecessor_operation_id ASC`,
      [this.tenantId, operationId],
    );

    const blockedItem = predecessors.find((item) => Number(item.completedQty ?? 0) < Number(item.requiredQty ?? 0));

    return {
      blocked: Boolean(blockedItem),
      blockingReason: blockedItem
        ? `${blockedItem.stepName} 未达到可开工数量（需 ${blockedItem.requiredQty}，当前 ${blockedItem.completedQty}）`
        : null,
      predecessors,
    };
  }

  private async getTaskMaterialTransactions(taskId: number): Promise<Array<{
    id: number;
    ioType: 'input' | 'output';
    skuId: number;
    skuCode: string | null;
    skuName: string | null;
    plannedQty: string;
    actualQty: string;
    inventoryTxId: number | null;
    transactionNo: string | null;
    transactionType: string | null;
    direction: 'IN' | 'OUT' | null;
    transactionQty: string | null;
    transactionTime: string | null;
    referenceNo: string | null;
  }>> {
    return AppDataSource.query(
      `SELECT
          tmt.id,
          tmt.io_type AS ioType,
          tmt.sku_id AS skuId,
          s.sku_code AS skuCode,
          s.name AS skuName,
          tmt.planned_qty AS plannedQty,
          tmt.actual_qty AS actualQty,
          tmt.inventory_tx_id AS inventoryTxId,
          it.transaction_no AS transactionNo,
          it.transaction_type AS transactionType,
          it.direction AS direction,
          CAST(COALESCE(it.qty_stock_unit, tmt.actual_qty) AS CHAR) AS transactionQty,
          DATE_FORMAT(it.created_at, '%Y-%m-%d %H:%i:%s') AS transactionTime,
          it.reference_no AS referenceNo
       FROM task_material_transactions tmt
       LEFT JOIN skus s
         ON s.id = tmt.sku_id
       LEFT JOIN inventory_transactions it
         ON it.id = tmt.inventory_tx_id
        AND it.tenant_id = tmt.tenant_id
       WHERE tmt.tenant_id = ? AND tmt.task_id = ?
       ORDER BY FIELD(tmt.io_type, 'output', 'input'), tmt.id ASC`,
      [this.tenantId, taskId],
    );
  }

  // BE-P1-008: 生产进度看板
  async getDashboard(): Promise<{
    inProgressCount: number;
    completionRate: string;
    overdueOrders: Array<{
      workOrderNo: string;
      skuName: string;
      plannedEnd: string;
      delayDays: number;
    }>;
  }> {
    const [countRow] = await AppDataSource.query(
      `SELECT COUNT(*) AS cnt FROM production_orders WHERE tenant_id = ? AND status IN ('scheduled','in_progress')`,
      [this.tenantId],
    );
    const [rateRow] = await AppDataSource.query(
      `SELECT COALESCE(AVG(qty_completed / NULLIF(qty_planned, 0) * 100), 0) AS rate
       FROM production_orders WHERE tenant_id = ? AND status IN ('in_progress','completed')
       AND planned_start >= CURDATE()`,
      [this.tenantId],
    );
    const overdueRows = await AppDataSource.query(
      `SELECT po.work_order_no, s.name AS sku_name, po.planned_end,
              DATEDIFF(CURDATE(), po.planned_end) AS delay_days
       FROM production_orders po
       INNER JOIN skus s ON s.id = po.sku_id
       WHERE po.tenant_id = ? AND po.status NOT IN ('completed','cancelled')
         AND po.planned_end < CURDATE()
       ORDER BY delay_days DESC LIMIT 10`,
      [this.tenantId],
    );
    return {
      inProgressCount: Number(countRow.cnt),
      completionRate: `${Number(rateRow.rate).toFixed(1)}%`,
      overdueOrders: overdueRows.map((r: any) => ({
        workOrderNo: r.work_order_no,
        skuName: r.sku_name,
        plannedEnd: r.planned_end,
        delayDays: Number(r.delay_days),
      })),
    };
  }
}
