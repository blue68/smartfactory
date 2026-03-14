import { AppDataSource } from '../../config/database';
import { TenantContext } from '../../shared/BaseRepository';
import { AppError } from '../../shared/AppError';
import { ResponseCode } from '../../shared/ApiResponse';
import { SchedulerService } from './scheduler.service';

export class ProductionService {
  private readonly tenantId: number;
  private readonly userId: number;
  private readonly scheduler: SchedulerService;

  constructor(ctx: TenantContext) {
    this.tenantId = ctx.tenantId;
    this.userId = ctx.userId;
    this.scheduler = new SchedulerService(ctx);
  }

  async generateSchedule(date?: string) {
    return this.scheduler.generateSchedule(date);
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
      `SELECT pt.*, u.real_name AS workerName, ps.step_name
       FROM production_tasks pt
       INNER JOIN users u ON u.id = pt.worker_id
       INNER JOIN process_steps ps ON ps.id = pt.process_step_id
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
         (tenant_id, work_order_no, sales_order_id, sku_id, bom_header_id,
          process_template_id, qty_planned, qty_completed, status, priority,
          planned_start, planned_end, notes, created_by, updated_by)
       VALUES (?,?,?,?,?,?,?,0,'pending',?,?,?,?,?,?)`,
      [
        this.tenantId, workOrderNo, params.salesOrderId, params.skuId,
        params.bomHeaderId, params.processTemplateId, params.qtyPlanned,
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
        `SELECT pt.id, pt.task_date AS taskDate, pt.status,
                pt.planned_qty AS plannedQty, pt.completed_qty AS completedQty,
                pt.scrap_qty AS scrapQty, pt.worker_id AS workerId,
                pt.workstation_id AS workstationId, pt.process_step_id AS processStepId,
                pt.production_order_id AS productionOrderId,
                pt.started_at AS startedAt, pt.completed_at AS completedAt,
                pt.created_at AS createdAt, pt.updated_at AS updatedAt,
                po.work_order_no AS orderNo, po.priority,
                po.sales_order_id AS salesOrderId, po.sku_id AS skuId,
                ps.step_name AS processName, ps.step_no AS stepNo,
                ps.standard_hours AS standardHours, ps.max_hours AS maxHours,
                ws.name AS workstationName,
                u.real_name AS workerName,
                s.name AS skuName, s.sku_code AS skuCode
         FROM production_tasks pt
         INNER JOIN production_orders po ON po.id = pt.production_order_id
         INNER JOIN process_steps ps ON ps.id = pt.process_step_id
         LEFT JOIN workstations ws ON ws.id = pt.workstation_id
         LEFT JOIN users u ON u.id = pt.worker_id
         LEFT JOIN skus s ON s.id = po.sku_id
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

    return { ...task, exceptions };
  }

  async listTasks(params: {
    page: number; pageSize: number; status?: string; keyword?: string;
    processId?: number; dateFrom?: string; dateTo?: string; priority?: number;
  }) {
    const conds = ['pt.tenant_id = ?'];
    const p: unknown[] = [this.tenantId];

    if (params.status) {
      conds.push('pt.status = ?');
      p.push(params.status);
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
        `SELECT pt.id, pt.task_date AS taskDate, pt.status,
                pt.planned_qty AS plannedQty, pt.completed_qty AS completedQty,
                pt.version, pt.actual_hours AS actualHours,
                po.work_order_no AS orderNo, po.priority,
                ps.step_name AS processName,
                ws.name AS workstationName, u.real_name AS workerName,
                s.name AS skuName, s.sku_code AS skuCode
         FROM production_tasks pt
         INNER JOIN production_orders po ON po.id = pt.production_order_id
         INNER JOIN process_steps ps ON ps.id = pt.process_step_id
         LEFT JOIN workstations ws ON ws.id = pt.workstation_id
         LEFT JOIN users u ON u.id = pt.worker_id
         LEFT JOIN skus s ON s.id = po.sku_id
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
    type: string; description: string; severity: string;
  }) {
    await AppDataSource.transaction(async (manager) => {
      // 更新任务状态为 exception
      await manager.query(
        `UPDATE production_tasks SET status = 'exception', updated_by = ?
         WHERE id = ? AND tenant_id = ?`,
        [this.userId, taskId, this.tenantId],
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

  // P2: 异常处理（恢复任务状态）
  async resolveException(taskId: number, resolution: string): Promise<void> {
    await AppDataSource.transaction(async (manager) => {
      // 恢复任务状态为 pending
      await manager.query(
        `UPDATE production_tasks SET status = 'pending', updated_by = ?
         WHERE id = ? AND tenant_id = ? AND status = 'exception'`,
        [this.userId, taskId, this.tenantId],
      );
      // 更新异常记录
      await manager.query(
        `UPDATE task_exceptions SET resolved_at = NOW(), resolved_by = ?, resolution = ?
         WHERE task_id = ? AND tenant_id = ? AND resolved_at IS NULL
         ORDER BY id DESC LIMIT 1`,
        [this.userId, resolution, taskId, this.tenantId],
      );
    });
  }

  // BE-P1: 排产手动调整
  async adjustSchedule(
    date: string,
    adjustments: Array<{
      taskId: number;
      workerId?: number;
      workstationId?: number;
      plannedQty?: string;
    }>,
  ): Promise<{ updated: number }> {
    let updated = 0;
    for (const adj of adjustments) {
      const sets: string[] = [];
      const vals: unknown[] = [];
      if (adj.workerId !== undefined) { sets.push('worker_id = ?'); vals.push(adj.workerId); }
      if (adj.workstationId !== undefined) { sets.push('workstation_id = ?'); vals.push(adj.workstationId); }
      if (adj.plannedQty !== undefined) { sets.push('planned_qty = ?'); vals.push(adj.plannedQty); }
      if (sets.length === 0) continue;
      vals.push(adj.taskId, this.tenantId);
      const [result] = await AppDataSource.query(
        `UPDATE production_tasks SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`,
        vals,
      );
      if (result?.affectedRows) updated++;
    }
    return { updated };
  }

  // BE-P1: 工人列表
  async listWorkers(): Promise<Array<{ id: number; name: string; station?: string }>> {
    const rows = await AppDataSource.query(
      `SELECT id, real_name AS name FROM users WHERE tenant_id = ? AND status = 'active' ORDER BY real_name`,
      [this.tenantId],
    );
    return rows;
  }

  // BE-P1: 工作站列表
  async listWorkstations(): Promise<Array<{ id: number; name: string; capacity: number }>> {
    const rows = await AppDataSource.query(
      `SELECT id, name, capacity FROM workstations WHERE tenant_id = ? AND status = 'active' ORDER BY name`,
      [this.tenantId],
    );
    return rows;
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
