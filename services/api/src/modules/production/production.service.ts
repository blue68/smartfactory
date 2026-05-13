import Decimal from 'decimal.js';
import { AppDataSource } from '../../config/database';
import { getRedisClient, RedisKeys } from '../../config/redis';
import { TenantContext } from '../../shared/BaseRepository';
import { AppError } from '../../shared/AppError';
import { ResponseCode } from '../../shared/ApiResponse';
import { SchedulerService } from './scheduler.service';
import { WageService } from '../report/wage.service';
import { loadWorkCalendarOverrides, resolveWorkCalendarDay, type WorkTimeRange } from './work-calendar.util';

export class ProductionService {
  private readonly tenantId: number;
  private readonly userId: number;
  private readonly roles: Set<string>;
  private readonly scheduler: SchedulerService;

  constructor(ctx: TenantContext) {
    this.tenantId = ctx.tenantId;
    this.userId = ctx.userId;
    this.roles = new Set(ctx.roles ?? []);
    this.scheduler = new SchedulerService(ctx);
  }

  private async invalidateScheduleCache(date: string): Promise<void> {
    try {
      const redis = getRedisClient();
      await redis.del(RedisKeys.schedule(this.tenantId, date));
      const extraKeys = await redis.keys(RedisKeys.schedulePattern(this.tenantId, date));
      if (extraKeys.length > 0) {
        await redis.del(...extraKeys);
      }
    } catch (err) {
      console.warn(
        `[ProductionService] Redis unavailable during manual schedule adjustment cache invalidation for tenant=${this.tenantId} date=${date}: ${(err as Error).message}`,
      );
    }
  }

  async generateSchedule(date?: string, force = false, batchId?: number) {
    return this.scheduler.generateSchedule(date, force, batchId);
  }

  async getScheduleHistory(limit: number) {
    const rows = await AppDataSource.query<Array<Record<string, unknown>>>(
      `SELECT
         DATE_FORMAT(ps.schedule_date, '%Y-%m-%d') AS date,
         COUNT(*) AS taskCount,
         COUNT(DISTINCT ps.production_order_id) AS orderCount,
         COUNT(DISTINCT ps.workstation_id) AS stationCount,
         COUNT(DISTINCT ps.worker_id) AS workerCount,
         ROUND(COALESCE(SUM(pt.planned_qty * COALESCE(proc.standard_hours, 0)), 0), 2) AS totalHours,
         MAX(CASE WHEN ps.status = 'confirmed' THEN 1 ELSE 0 END) AS confirmed,
         MAX(CASE WHEN ps.status = 'confirmed' THEN DATE_FORMAT(ps.updated_at, '%Y-%m-%d %H:%i:%s') END) AS confirmedAt,
         MIN(DATE_FORMAT(ps.created_at, '%Y-%m-%d %H:%i:%s')) AS generatedAt
       FROM production_schedules ps
       LEFT JOIN production_tasks pt
         ON pt.schedule_id = ps.id AND pt.tenant_id = ps.tenant_id
       LEFT JOIN process_steps proc
         ON proc.id = ps.process_step_id
       WHERE ps.tenant_id = ?
       GROUP BY ps.schedule_date
       ORDER BY ps.schedule_date DESC
       LIMIT ?`,
      [this.tenantId, limit],
    );

    return rows.map((row) => ({
      date: String(row.date ?? ''),
      taskCount: Number(row.taskCount ?? 0),
      orderCount: Number(row.orderCount ?? 0),
      stationCount: Number(row.stationCount ?? 0),
      workerCount: Number(row.workerCount ?? 0),
      totalHours: String(row.totalHours ?? '0'),
      confirmed: Number(row.confirmed ?? 0) === 1,
      confirmedAt: row.confirmedAt ? String(row.confirmedAt) : null,
      generatedAt: row.generatedAt ? String(row.generatedAt) : null,
    }));
  }

  async confirmSchedule(date: string, batchId?: number) {
    return this.scheduler.confirmSchedule(date, batchId);
  }

  async getWorkerTasks(workerId: number, date: string) {
    return this.scheduler.getWorkerTasks(workerId, date);
  }

  async startTask(taskId: number) {
    await this.assertTaskOperatorAllowed(taskId);
    await this.assertTaskDependenciesReady(taskId, 'start');
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
    await this.assertTaskOperatorAllowed(taskId);
    await this.assertTaskDependenciesReady(taskId, 'complete');
    return this.scheduler.completeTask(taskId, params);
  }

  async issueTaskMaterials(taskId: number, params: {
    items: Array<{
      skuId: number;
      qty: string;
      warehouseId?: number;
      locationId?: number;
      dyeLotNo?: string;
      notes?: string;
    }>;
  }) {
    await this.assertTaskOperatorAllowed(taskId);
    await this.assertTaskDependenciesReady(taskId, 'start');
    return this.scheduler.issueTaskMaterials(taskId, params);
  }

  async returnTaskMaterials(taskId: number, params: {
    items: Array<{
      skuId: number;
      qty: string;
      warehouseId?: number;
      locationId?: number;
      dyeLotNo?: string;
      notes?: string;
    }>;
  }) {
    await this.assertTaskOperatorAllowed(taskId);
    return this.scheduler.returnTaskMaterials(taskId, params);
  }

  async listProductionOrders(params: {
    status?: string; salesOrderId?: number; batchId?: number; page: number; pageSize: number;
  }) {
    const conds = ['po.tenant_id = ?'];
    const p: unknown[] = [this.tenantId];
    if (params.status) { conds.push('po.status = ?'); p.push(params.status); }
    if (params.salesOrderId) { conds.push('po.sales_order_id = ?'); p.push(params.salesOrderId); }
    if (params.batchId) { conds.push('po.joint_batch_id = ?'); p.push(params.batchId); }

    const where = conds.join(' AND ');
    const offset = (params.page - 1) * params.pageSize;

    const [list, countRows] = await Promise.all([
      AppDataSource.query(
        `SELECT po.*, s.name AS skuName, so.order_no AS salesOrderNo,
                jb.batch_no AS batchNo,
                so.expected_delivery,
                ROUND(po.qty_completed / po.qty_planned * 100, 1) AS progressPct
         FROM production_orders po
         INNER JOIN skus s ON s.id = po.sku_id
         INNER JOIN sales_orders so ON so.id = po.sales_order_id
         LEFT JOIN joint_production_batches jb ON jb.id = po.joint_batch_id AND jb.tenant_id = po.tenant_id
         WHERE ${where}
         ORDER BY po.priority DESC, so.expected_delivery ASC
         LIMIT ? OFFSET ?`,
        [...p, params.pageSize, offset],
      ),
      AppDataSource.query<Array<{ total: number }>>(
        `SELECT COUNT(*) AS total FROM production_orders po WHERE ${where}`, p,
      ),
    ]);

    const taskIds = (list as Array<{ id: number }>).map((item) => Number(item.id)).filter((id) => id > 0);
    const materialIssueStatusMap = await this.getTaskMaterialIssueStatusMap(taskIds);
    const enrichedList = (list as Array<Record<string, unknown>>).map((item) => ({
      ...item,
      ...(materialIssueStatusMap.get(Number(item.id)) ?? {
        materialIssueStatus: 'none',
        materialIssueLabel: '无需领料',
      }),
    }));

    return { list: enrichedList, total: Number(countRows[0]?.total ?? 0) };
  }

  async getProductionOrderDetail(orderId: number) {
    const [order] = await AppDataSource.query(
      `SELECT po.*, s.name AS skuName, so.order_no AS salesOrderNo,
              jb.batch_no AS batchNo,
              so.expected_delivery, so.customer_id,
              ROUND(po.qty_completed / po.qty_planned * 100, 1) AS progressPct
       FROM production_orders po
       INNER JOIN skus s ON s.id = po.sku_id
       INNER JOIN sales_orders so ON so.id = po.sales_order_id
       LEFT JOIN joint_production_batches jb ON jb.id = po.joint_batch_id AND jb.tenant_id = po.tenant_id
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
                COALESCE(op.execution_mode, 'internal') AS executionMode,
                pt.actual_hours AS actualHours,
                pt.production_order_id AS productionOrderId,
                pt.started_at AS startedAt, pt.completed_at AS completedAt,
                pt.created_at AS createdAt, pt.updated_at AS updatedAt,
                po.work_order_no AS orderNo, po.priority,
                po.joint_batch_id AS jointBatchId,
                jb.batch_no AS batchNo,
                po.planned_end AS plannedFinishTime,
                po.sales_order_id AS salesOrderId, po.sku_id AS skuId, po.qty_planned AS orderPlannedQty,
                COALESCE(ps.step_name, CONCAT('STEP#', pt.process_step_id)) AS processName, ps.step_no AS stepNo,
                ps.standard_hours AS standardHours, ps.max_hours AS maxHours,
                ps.guide_text AS processGuideText,
                ps.guide_attachment_url AS processGuideAttachmentUrl,
                ps.guide_attachment_name AS processGuideAttachmentName,
                ws.name AS workstationName,
                u.real_name AS workerName,
                s.name AS skuName, s.sku_code AS skuCode,
                outs.name AS outputSkuName,
                outs.sku_code AS outputSkuCode,
                outs.stock_unit AS outputStockUnit,
                CASE
                  WHEN COALESCE(pt.output_sku_id, ps.output_sku_id) IS NOT NULL
                    AND COALESCE(pt.output_sku_id, ps.output_sku_id) <> po.sku_id
                  THEN 'semi_finished'
                  ELSE 'finished'
                END AS taskType
         FROM production_tasks pt
         INNER JOIN production_orders po ON po.id = pt.production_order_id
         LEFT JOIN joint_production_batches jb
           ON jb.id = po.joint_batch_id
          AND jb.tenant_id = po.tenant_id
         LEFT JOIN process_steps ps ON ps.id = pt.process_step_id
         LEFT JOIN production_operations op
           ON op.id = pt.operation_id
          AND op.tenant_id = pt.tenant_id
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
    const inputItems = await this.getTaskInputItems(
      task,
      dependencySummary.predecessors,
      materialTransactions,
    );
    const outputItems = this.buildTaskOutputItems(task, materialTransactions);
    const inputSkuIds = [...new Set(
      inputItems.map((item) => Number(item.skuId)).filter((skuId) => Number.isFinite(skuId) && skuId > 0),
    )];
    const outputSkuIds = [...new Set(
      outputItems.map((item) => Number(item.skuId)).filter((skuId) => Number.isFinite(skuId) && skuId > 0),
    )];
    const preferredInputStorageMap = await this.getPreferredSkuStorageMap(inputSkuIds, {
      excludeWarehouseCodes: ['PROD-WIP'],
    });
    const preferredOutputStorageMap = await this.getPreferredSkuStorageMap(outputSkuIds);
    const defaultStorageLocation = await this.getDefaultStorageLocation();
    const enrichedInputItems = inputItems.map((item) => {
      const latestReturnTransaction = [...materialTransactions]
        .reverse()
        .find((row) => (
          row.ioType === 'input'
          && row.movementType === 'return'
          && Number(row.skuId) === Number(item.skuId)
        ));
      const storage = this.pickStorageLocation(
        latestReturnTransaction,
        preferredInputStorageMap.get(Number(item.skuId)),
        null,
      );
      return {
        ...item,
        ...storage,
      };
    });
    const enrichedOutputItems = outputItems.map((item) => {
      const transaction = materialTransactions.find((row) => row.ioType === 'output' && Number(row.skuId) === Number(item.skuId));
      const storage = this.pickStorageLocation(
        transaction,
        preferredOutputStorageMap.get(Number(item.skuId)),
        defaultStorageLocation,
      );
      return {
        ...item,
        processStepId: task.processStepId ?? null,
        processName: task.processName ?? null,
        ...storage,
      };
    });
    const materialIssueStatus = (await this.getTaskMaterialIssueStatusMap([taskId])).get(taskId) ?? {
      materialIssueStatus: 'none',
      materialIssueLabel: '无需领料',
    };

    return {
      ...task,
      statusLabel: this.getTaskStatusLabel(String(task.status ?? 'pending')),
      ...materialIssueStatus,
      dependencySummary,
      inputItems: enrichedInputItems,
      inputMaterials: enrichedInputItems.filter((item) => item.itemType === 'material'),
      outputItems: enrichedOutputItems,
      materialTransactions,
      wageReport: wageRows[0][0] ?? null,
      exceptions,
    };
  }

  private async getTaskMaterialIssueStatusMap(taskIds: number[]): Promise<Map<number, {
    materialIssueStatus: 'none' | 'pending_issue' | 'partial_issue' | 'fully_issued' | 'line_side_remaining';
    materialIssueLabel: string;
  }>> {
    if (taskIds.length === 0) {
      return new Map();
    }

    const placeholders = taskIds.map(() => '?').join(', ');
    const stepRequiredRows = await AppDataSource.query<Array<{ taskId: number; skuId: number; requiredQty: string }>>(
      `SELECT
          pt.id AS taskId,
          COALESCE(poc.resolved_sku_id, poc.sku_id, psm.input_sku_id) AS skuId,
          CAST(COALESCE(SUM(
            pt.planned_qty
            * psm.usage_per_unit
            * (1 + COALESCE(psm.loss_rate, 0))
          ), 0) AS CHAR) AS requiredQty
       FROM production_tasks pt
       INNER JOIN process_steps ps
         ON ps.id = pt.process_step_id
        AND ps.tenant_id = pt.tenant_id
       LEFT JOIN process_step_materials psm
         ON psm.tenant_id = ps.tenant_id
        AND psm.template_id = ps.template_id
        AND psm.step_no = ps.step_no
       LEFT JOIN production_order_components poc
         ON poc.tenant_id = pt.tenant_id
        AND poc.production_order_id = pt.production_order_id
        AND poc.sku_id = psm.input_sku_id
       WHERE pt.tenant_id = ?
         AND pt.id IN (${placeholders})
       GROUP BY pt.id, COALESCE(poc.resolved_sku_id, poc.sku_id, psm.input_sku_id)`,
      [this.tenantId, ...taskIds],
    );

    const stepMaterialCountRows = await AppDataSource.query<Array<{ taskId: number; materialCount: string }>>(
      `SELECT
          pt.id AS taskId,
          COUNT(psm.id) AS materialCount
       FROM production_tasks pt
       INNER JOIN process_steps ps
         ON ps.id = pt.process_step_id
        AND ps.tenant_id = pt.tenant_id
       LEFT JOIN process_step_materials psm
         ON psm.tenant_id = ps.tenant_id
        AND psm.template_id = ps.template_id
        AND psm.step_no = ps.step_no
       WHERE pt.tenant_id = ?
         AND pt.id IN (${placeholders})
       GROUP BY pt.id`,
      [this.tenantId, ...taskIds],
    );

    const fallbackTaskIds = stepMaterialCountRows
      .filter((row) => Number(row.materialCount ?? 0) === 0)
      .map((row) => Number(row.taskId))
      .filter((taskId) => Number.isFinite(taskId) && taskId > 0);

    const bomFallbackRows = fallbackTaskIds.length > 0
      ? await AppDataSource.query<Array<{ taskId: number; skuId: number; requiredQty: string }>>(
        `SELECT
            pt.id AS taskId,
            COALESCE(poc.resolved_sku_id, poc.sku_id, bi.component_sku_id) AS skuId,
            CAST(
              pt.planned_qty
              * bi.quantity
              * (1 + COALESCE(bi.scrap_rate, 0))
              AS CHAR
            ) AS requiredQty
         FROM production_tasks pt
         INNER JOIN process_steps ps
           ON ps.id = pt.process_step_id
          AND ps.tenant_id = pt.tenant_id
         INNER JOIN bom_headers bh
           ON bh.tenant_id = pt.tenant_id
          AND bh.sku_id = COALESCE(pt.output_sku_id, ps.output_sku_id)
          AND bh.status = 'active'
         INNER JOIN bom_items bi
           ON bi.bom_header_id = bh.id
          AND bi.tenant_id = bh.tenant_id
          AND bi.parent_item_id IS NULL
         LEFT JOIN production_order_components poc
           ON poc.tenant_id = pt.tenant_id
          AND poc.production_order_id = pt.production_order_id
          AND poc.sku_id = bi.component_sku_id
         WHERE pt.tenant_id = ?
           AND pt.id IN (${fallbackTaskIds.map(() => '?').join(', ')})
           AND NOT EXISTS (
             SELECT 1
             FROM bom_headers sub_bh
             WHERE sub_bh.tenant_id = bh.tenant_id
               AND sub_bh.sku_id = bi.component_sku_id
               AND sub_bh.status = 'active'
             LIMIT 1
           )`,
        [this.tenantId, ...fallbackTaskIds],
      )
      : [];

    const movementRows = await AppDataSource.query<Array<{
      taskId: number;
      skuId: number;
      issuedNetQty: string;
      lineSideQty: string;
    }>>(
      `SELECT
          tim.task_id AS taskId,
          tim.sku_id AS skuId,
          CAST(SUM(CASE
            WHEN tim.movement_type = 'issue' THEN tim.qty
            WHEN tim.movement_type = 'return' THEN -tim.qty
            ELSE 0
          END) AS CHAR) AS issuedNetQty,
          CAST(SUM(CASE
            WHEN tim.movement_type = 'issue' THEN tim.qty
            WHEN tim.movement_type = 'return' THEN -tim.qty
            WHEN tim.movement_type = 'consume' THEN -tim.qty
            WHEN tim.movement_type = 'scrap' THEN -tim.qty
            ELSE 0
          END) AS CHAR) AS lineSideQty
       FROM task_inventory_movements tim
       WHERE tim.tenant_id = ?
         AND tim.task_id IN (${placeholders})
       GROUP BY tim.task_id, tim.sku_id`,
      [this.tenantId, ...taskIds],
    );

    const normalizedRequiredRows = [
      ...(Array.isArray(stepRequiredRows) ? stepRequiredRows : []),
      ...(Array.isArray(bomFallbackRows) ? bomFallbackRows : []),
    ];
    const normalizedMovementRows = Array.isArray(movementRows) ? movementRows : [];

    const requiredMap = new Map(
      normalizedRequiredRows.map((row) => [
        `${Number(row.taskId)}::${Number(row.skuId)}`,
        new Decimal(row.requiredQty ?? 0),
      ]),
    );
    const movementMap = new Map(
      normalizedMovementRows.map((row) => [
        `${Number(row.taskId)}::${Number(row.skuId)}`,
        {
          issuedNetQty: new Decimal(row.issuedNetQty ?? 0),
          lineSideQty: new Decimal(row.lineSideQty ?? 0),
        },
      ]),
    );

    const result = new Map<number, {
      materialIssueStatus: 'none' | 'pending_issue' | 'partial_issue' | 'fully_issued' | 'line_side_remaining';
      materialIssueLabel: string;
    }>();

    for (const taskId of taskIds) {
      const skuIds = new Set<number>();
      normalizedRequiredRows.forEach((row) => {
        if (Number(row.taskId) === taskId) {
          skuIds.add(Number(row.skuId));
        }
      });
      normalizedMovementRows.forEach((row) => {
        if (Number(row.taskId) === taskId) {
          skuIds.add(Number(row.skuId));
        }
      });

      if (skuIds.size === 0) {
        result.set(taskId, { materialIssueStatus: 'none', materialIssueLabel: '无需领料' });
        continue;
      }

      let hasPending = false;
      let hasPartial = false;
      let hasLineSideRemaining = false;
      let hasPositiveIssuedOrLineSide = false;

      for (const skuId of skuIds) {
        const requiredQty = requiredMap.get(`${taskId}::${skuId}`) ?? new Decimal(0);
        const movement = movementMap.get(`${taskId}::${skuId}`) ?? {
          issuedNetQty: new Decimal(0),
          lineSideQty: new Decimal(0),
        };

        if (requiredQty.lte(0)) {
          continue;
        }

        if (movement.lineSideQty.gt(0)) {
          hasLineSideRemaining = true;
          hasPositiveIssuedOrLineSide = true;
          continue;
        }

        if (movement.issuedNetQty.lte(0)) {
          hasPending = true;
          continue;
        }

        hasPositiveIssuedOrLineSide = true;
        if (movement.issuedNetQty.lt(requiredQty)) {
          hasPartial = true;
        }
      }

      if (hasPending && !hasPositiveIssuedOrLineSide) {
        result.set(taskId, { materialIssueStatus: 'pending_issue', materialIssueLabel: '待领料' });
      } else if (hasPending || hasPartial) {
        result.set(taskId, { materialIssueStatus: 'partial_issue', materialIssueLabel: '部分领料' });
      } else if (hasLineSideRemaining) {
        result.set(taskId, { materialIssueStatus: 'line_side_remaining', materialIssueLabel: '线边有余料' });
      } else {
        result.set(taskId, { materialIssueStatus: 'fully_issued', materialIssueLabel: '已齐料' });
      }
    }

    return result;
  }

  async listTasks(params: {
    page: number; pageSize: number; status?: string; keyword?: string;
    processId?: number;
    workerId?: number;
    batchId?: number;
    taskType?: 'finished' | 'semi_finished';
    executionMode?: 'internal' | 'outsource';
    dateFrom?: string;
    dateTo?: string;
    priority?: number;
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
      conds.push('(po.work_order_no LIKE ? OR COALESCE(jb.batch_no, \'\') LIKE ? OR COALESCE(ps.step_name, CONCAT(\'STEP#\', pt.process_step_id)) LIKE ? OR u.real_name LIKE ?)');
      p.push(`%${params.keyword}%`, `%${params.keyword}%`, `%${params.keyword}%`, `%${params.keyword}%`);
    }
    // BE-06-02: 新增筛选参数
    if (params.processId) {
      conds.push('pt.process_step_id = ?');
      p.push(params.processId);
    }
    if (params.workerId) {
      conds.push('pt.worker_id = ?');
      p.push(params.workerId);
    }
    if (params.batchId) {
      conds.push('po.joint_batch_id = ?');
      p.push(params.batchId);
    }
    if (params.taskType === 'semi_finished') {
      conds.push('COALESCE(pt.output_sku_id, ps.output_sku_id) IS NOT NULL');
      conds.push('COALESCE(pt.output_sku_id, ps.output_sku_id) <> po.sku_id');
    }
    if (params.taskType === 'finished') {
      conds.push('(COALESCE(pt.output_sku_id, ps.output_sku_id) IS NULL OR COALESCE(pt.output_sku_id, ps.output_sku_id) = po.sku_id)');
    }
    if (params.executionMode) {
      conds.push('COALESCE(pt.execution_mode, ps.execution_mode, \'internal\') = ?');
      p.push(params.executionMode);
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

    try {
      const [list, countRows] = await Promise.all([
        AppDataSource.query(
          // R06-G12 + dependency-aware priority sort
          `SELECT
              task_rows.*,
              CASE
                WHEN task_rows.priorityScore >= 110 THEN 'critical'
                WHEN task_rows.priorityScore >= 85 THEN 'high'
                WHEN task_rows.priorityScore >= 60 THEN 'medium'
                ELSE 'normal'
              END AS priorityLevel,
              CASE
                WHEN task_rows.priorityScore >= 110 THEN '关键优先'
                WHEN task_rows.priorityScore >= 85 THEN '高优先'
                WHEN task_rows.priorityScore >= 60 THEN '优先'
                ELSE '普通'
              END AS priorityLabel,
              CASE
                WHEN task_rows.activeDownstreamTaskCount > 0 AND task_rows.dependencyBlocked = 0
                  THEN CONCAT('关键链路，影响 ', task_rows.activeDownstreamTaskCount, ' 个后续任务')
                WHEN task_rows.downstreamTaskCount > 0 AND task_rows.dependencyBlocked = 0
                  THEN CONCAT('前置任务，关联 ', task_rows.downstreamTaskCount, ' 个后续任务')
                WHEN task_rows.dependencyBlocked = 1
                  THEN '存在前置阻塞，当前不可直接开工'
                WHEN task_rows.priority >= 80
                  THEN '工单基础优先级较高'
                ELSE '常规优先级'
              END AS priorityReason
           FROM (
             SELECT
               pt.id,
               pt.task_no AS taskNo,
               pt.task_date AS taskDate,
               CASE WHEN pt.status = 'started' THEN 'in_progress' ELSE pt.status END AS status,
               pt.planned_qty AS plannedQty,
               pt.completed_qty AS completedQty,
               pt.version,
               pt.actual_hours AS actualHours,
               ps.id AS processStepId,
               pt.operation_id AS operationId,
               pt.output_sku_id AS outputSkuId,
               po.work_order_no AS orderNo,
               po.joint_batch_id AS jointBatchId,
               jb.batch_no AS batchNo,
               po.priority,
               po.planned_end AS plannedFinishTime,
               COALESCE(ps.step_name, CONCAT('STEP#', pt.process_step_id)) AS processName,
               ws.name AS workstationName,
               u.real_name AS workerName,
               s.name AS skuName,
               s.sku_code AS skuCode,
               outs.name AS outputSkuName,
               CASE
                 WHEN COALESCE(pt.output_sku_id, ps.output_sku_id) IS NOT NULL
                   AND COALESCE(pt.output_sku_id, ps.output_sku_id) <> po.sku_id
                 THEN 'semi_finished'
                 ELSE 'finished'
               END AS taskType,
               COALESCE(pt.execution_mode, ps.execution_mode, 'internal') AS executionMode,
               COALESCE(dep_out.downstreamTaskCount, 0) AS downstreamTaskCount,
               COALESCE(dep_out.activeDownstreamTaskCount, 0) AS activeDownstreamTaskCount,
               CASE WHEN COALESCE(dep_in.blockedDependencyCount, 0) > 0 THEN 1 ELSE 0 END AS dependencyBlocked,
               (
                 po.priority
                 + LEAST(COALESCE(dep_out.activeDownstreamTaskCount, 0), 5) * 15
                 + LEAST(COALESCE(dep_out.downstreamTaskCount, 0), 5) * 5
                 + CASE WHEN pt.status = 'started' THEN 10 ELSE 0 END
                 + CASE
                     WHEN COALESCE(dep_out.activeDownstreamTaskCount, 0) > 0
                          AND COALESCE(dep_in.blockedDependencyCount, 0) = 0
                     THEN 10
                     ELSE 0
                   END
                 - CASE WHEN COALESCE(dep_in.blockedDependencyCount, 0) > 0 THEN 25 ELSE 0 END
               ) AS priorityScore
             FROM production_tasks pt
             INNER JOIN production_orders po ON po.id = pt.production_order_id
             LEFT JOIN joint_production_batches jb
               ON jb.id = po.joint_batch_id
              AND jb.tenant_id = po.tenant_id
             LEFT JOIN process_steps ps ON ps.id = pt.process_step_id
             LEFT JOIN workstations ws ON ws.id = pt.workstation_id
             LEFT JOIN users u ON u.id = pt.worker_id
             LEFT JOIN skus s ON s.id = po.sku_id
             LEFT JOIN skus outs ON outs.id = COALESCE(pt.output_sku_id, ps.output_sku_id)
             LEFT JOIN (
               SELECT
                 dep.tenant_id,
                 dep.predecessor_operation_id AS operationId,
                 COUNT(DISTINCT dep.operation_id) AS downstreamTaskCount,
                 COUNT(DISTINCT CASE
                   WHEN succ_task.status IN ('pending', 'started', 'exception', 'suspended')
                   THEN succ_task.id
                   ELSE NULL
                 END) AS activeDownstreamTaskCount
               FROM production_operation_dependencies dep
               LEFT JOIN (
                 SELECT tenant_id, operation_id, MAX(id) AS task_id
                 FROM production_tasks
                 GROUP BY tenant_id, operation_id
               ) succ_task_ref
                 ON succ_task_ref.tenant_id = dep.tenant_id
                AND succ_task_ref.operation_id = dep.operation_id
               LEFT JOIN production_tasks succ_task
                 ON succ_task.id = succ_task_ref.task_id
               GROUP BY dep.tenant_id, dep.predecessor_operation_id
             ) dep_out
               ON dep_out.tenant_id = pt.tenant_id
              AND dep_out.operationId = pt.operation_id
             LEFT JOIN (
               SELECT
                 dep.tenant_id,
                 dep.operation_id AS operationId,
                 SUM(CASE
                   WHEN COALESCE(pred.completed_qty, 0) < dep.required_qty THEN 1
                   ELSE 0
                 END) AS blockedDependencyCount
               FROM production_operation_dependencies dep
               INNER JOIN production_operations pred
                 ON pred.id = dep.predecessor_operation_id
                AND pred.tenant_id = dep.tenant_id
               GROUP BY dep.tenant_id, dep.operation_id
             ) dep_in
               ON dep_in.tenant_id = pt.tenant_id
              AND dep_in.operationId = pt.operation_id
             WHERE ${where}
           ) task_rows
           ORDER BY task_rows.priorityScore DESC, task_rows.priority DESC, task_rows.taskDate DESC, task_rows.id DESC
           LIMIT ? OFFSET ?`,
          [...p, params.pageSize, offset],
        ),
        AppDataSource.query<Array<{ total: string }>>(
          `SELECT COUNT(*) AS total
           FROM production_tasks pt
           INNER JOIN production_orders po ON po.id = pt.production_order_id
           LEFT JOIN joint_production_batches jb
             ON jb.id = po.joint_batch_id
            AND jb.tenant_id = po.tenant_id
           LEFT JOIN process_steps ps ON ps.id = pt.process_step_id
           LEFT JOIN users u ON u.id = pt.worker_id
           WHERE ${where}`,
        p,
        ),
      ]);

      return { list, total: Number(countRows[0]?.total ?? 0) };
    } catch (error) {
      if (!this.shouldFallbackTaskListQuery(error)) {
        throw error;
      }
      console.warn(`[ProductionService] listTasks fallback to legacy schema: ${(error as Error).message}`);
      return this.listTasksWithLegacySchema(params);
    }
  }

  private shouldFallbackTaskListQuery(error: unknown): boolean {
    const message = String((error as { message?: string })?.message ?? '').toLowerCase();
    return message.includes('unknown column')
      || message.includes('doesn\'t exist')
      || message.includes('unknown table');
  }

  private async getTableColumns(
    table: 'production_tasks' | 'process_steps',
    columns: string[],
  ): Promise<Set<string>> {
    const rows = await AppDataSource.query<Array<{ columnName: string }>>(
      `SELECT column_name AS columnName
       FROM information_schema.columns
       WHERE table_schema = DATABASE()
         AND table_name = ?
         AND column_name IN (${columns.map(() => '?').join(', ')})`,
      [table, ...columns],
    );
    return new Set(rows.map((item) => item.columnName));
  }

  private async listTasksWithLegacySchema(params: {
    page: number; pageSize: number; status?: string; keyword?: string;
    processId?: number;
    workerId?: number;
    batchId?: number;
    taskType?: 'finished' | 'semi_finished';
    executionMode?: 'internal' | 'outsource';
    dateFrom?: string;
    dateTo?: string;
    priority?: number;
  }) {
    const [taskCols, stepCols] = await Promise.all([
      this.getTableColumns('production_tasks', ['version', 'actual_hours', 'output_sku_id', 'execution_mode', 'workstation_id']),
      this.getTableColumns('process_steps', ['output_sku_id', 'execution_mode']),
    ]);

    const hasTaskVersion = taskCols.has('version');
    const hasTaskActualHours = taskCols.has('actual_hours');
    const hasTaskOutputSku = taskCols.has('output_sku_id');
    const hasTaskExecutionMode = taskCols.has('execution_mode');
    const hasTaskWorkstation = taskCols.has('workstation_id');
    const hasStepOutputSku = stepCols.has('output_sku_id');
    const hasStepExecutionMode = stepCols.has('execution_mode');

    const outputSkuExpr = hasTaskOutputSku && hasStepOutputSku
      ? 'COALESCE(pt.output_sku_id, ps.output_sku_id)'
      : hasTaskOutputSku
        ? 'pt.output_sku_id'
        : hasStepOutputSku
          ? 'ps.output_sku_id'
          : 'NULL';

    const executionModeExpr = hasTaskExecutionMode && hasStepExecutionMode
      ? "COALESCE(pt.execution_mode, ps.execution_mode, 'internal')"
      : hasTaskExecutionMode
        ? "COALESCE(pt.execution_mode, 'internal')"
        : hasStepExecutionMode
          ? "COALESCE(ps.execution_mode, 'internal')"
          : "'internal'";

    const workstationRef = hasTaskWorkstation ? 'pt.workstation_id' : 'sched.workstation_id';

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
      conds.push('(po.work_order_no LIKE ? OR COALESCE(jb.batch_no, \'\') LIKE ? OR COALESCE(ps.step_name, CONCAT(\'STEP#\', pt.process_step_id)) LIKE ? OR u.real_name LIKE ?)');
      p.push(`%${params.keyword}%`, `%${params.keyword}%`, `%${params.keyword}%`, `%${params.keyword}%`);
    }
    if (params.processId) {
      conds.push('pt.process_step_id = ?');
      p.push(params.processId);
    }
    if (params.workerId) {
      conds.push('pt.worker_id = ?');
      p.push(params.workerId);
    }
    if (params.batchId) {
      conds.push('po.joint_batch_id = ?');
      p.push(params.batchId);
    }
    if (params.taskType === 'semi_finished' && outputSkuExpr !== 'NULL') {
      conds.push(`${outputSkuExpr} IS NOT NULL`);
      conds.push(`${outputSkuExpr} <> po.sku_id`);
    }
    if (params.taskType === 'finished' && outputSkuExpr !== 'NULL') {
      conds.push(`(${outputSkuExpr} IS NULL OR ${outputSkuExpr} = po.sku_id)`);
    }
    if (params.executionMode && executionModeExpr !== "'internal'") {
      conds.push(`${executionModeExpr} = ?`);
      p.push(params.executionMode);
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
    const versionExpr = hasTaskVersion ? 'pt.version' : '1';
    const actualHoursExpr = hasTaskActualHours ? 'pt.actual_hours' : 'NULL';

    const [list, countRows] = await Promise.all([
      AppDataSource.query(
        `SELECT
            task_rows.*,
            CASE
              WHEN task_rows.priorityScore >= 110 THEN 'critical'
              WHEN task_rows.priorityScore >= 85 THEN 'high'
              WHEN task_rows.priorityScore >= 60 THEN 'medium'
              ELSE 'normal'
            END AS priorityLevel,
            CASE
              WHEN task_rows.priorityScore >= 110 THEN '关键优先'
              WHEN task_rows.priorityScore >= 85 THEN '高优先'
              WHEN task_rows.priorityScore >= 60 THEN '优先'
              ELSE '普通'
            END AS priorityLabel,
            '常规优先级' AS priorityReason
         FROM (
           SELECT
             pt.id,
             pt.task_no AS taskNo,
             pt.task_date AS taskDate,
             CASE WHEN pt.status = 'started' THEN 'in_progress' ELSE pt.status END AS status,
             pt.planned_qty AS plannedQty,
             pt.completed_qty AS completedQty,
             ${versionExpr} AS version,
             ${actualHoursExpr} AS actualHours,
             ps.id AS processStepId,
             NULL AS operationId,
             ${outputSkuExpr} AS outputSkuId,
             po.work_order_no AS orderNo,
             po.joint_batch_id AS jointBatchId,
             jb.batch_no AS batchNo,
             po.priority,
             po.planned_end AS plannedFinishTime,
             COALESCE(ps.step_name, CONCAT('STEP#', pt.process_step_id)) AS processName,
             ws.name AS workstationName,
             u.real_name AS workerName,
             s.name AS skuName,
             s.sku_code AS skuCode,
             outs.name AS outputSkuName,
             CASE
               WHEN ${outputSkuExpr} IS NOT NULL AND ${outputSkuExpr} <> po.sku_id
               THEN 'semi_finished'
               ELSE 'finished'
             END AS taskType,
             ${executionModeExpr} AS executionMode,
             0 AS downstreamTaskCount,
             0 AS activeDownstreamTaskCount,
             0 AS dependencyBlocked,
             po.priority AS priorityScore
           FROM production_tasks pt
           INNER JOIN production_orders po ON po.id = pt.production_order_id
           LEFT JOIN joint_production_batches jb
             ON jb.id = po.joint_batch_id
            AND jb.tenant_id = po.tenant_id
           LEFT JOIN process_steps ps ON ps.id = pt.process_step_id
           LEFT JOIN production_schedules sched ON sched.id = pt.schedule_id AND sched.tenant_id = pt.tenant_id
           LEFT JOIN workstations ws ON ws.id = ${workstationRef}
           LEFT JOIN users u ON u.id = pt.worker_id
           LEFT JOIN skus s ON s.id = po.sku_id
           LEFT JOIN skus outs ON outs.id = ${outputSkuExpr}
           WHERE ${where}
         ) task_rows
         ORDER BY task_rows.priorityScore DESC, task_rows.priority DESC, task_rows.taskDate DESC, task_rows.id DESC
         LIMIT ? OFFSET ?`,
        [...p, params.pageSize, offset],
      ),
      AppDataSource.query<Array<{ total: string }>>(
        `SELECT COUNT(*) AS total
         FROM production_tasks pt
         INNER JOIN production_orders po ON po.id = pt.production_order_id
         LEFT JOIN joint_production_batches jb
           ON jb.id = po.joint_batch_id
          AND jb.tenant_id = po.tenant_id
         LEFT JOIN process_steps ps ON ps.id = pt.process_step_id
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
    await this.assertTaskOperatorAllowed(taskId);
    await this.assertTaskDependenciesReady(taskId, 'exception');
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
    const workerIds = [...new Set(
      normalizedAdjustments
        .map((item) => item.workerId)
        .filter((workerId): workerId is number => workerId !== undefined),
    )];
    const workstationIds = [...new Set(
      normalizedAdjustments
        .map((item) => item.workstationId)
        .filter((workstationId): workstationId is number => workstationId !== undefined),
    )];

    if (workerIds.length > 0) {
      const placeholders = workerIds.map(() => '?').join(', ');
      const rows = await AppDataSource.query<Array<{ id: number }>>(
        `SELECT DISTINCT u.id
         FROM users u
         INNER JOIN user_roles ur ON ur.user_id = u.id
         INNER JOIN roles r ON r.id = ur.role_id
         WHERE u.tenant_id = ?
           AND u.status = 'active'
           AND r.code = 'worker'
           AND u.id IN (${placeholders})`,
        [this.tenantId, ...workerIds],
      );
      const validWorkerIds = new Set(rows.map((row) => Number(row.id)));
      const invalidWorkerIds = workerIds.filter((workerId) => !validWorkerIds.has(workerId));
      if (invalidWorkerIds.length > 0) {
        throw AppError.badRequest(`存在无效或非生产工人账号：${invalidWorkerIds.join(', ')}`);
      }
    }

    if (workstationIds.length > 0) {
      const placeholders = workstationIds.map(() => '?').join(', ');
      const rows = await AppDataSource.query<Array<{ id: number }>>(
        `SELECT id
         FROM workstations
         WHERE tenant_id = ?
           AND status = 'active'
           AND id IN (${placeholders})`,
        [this.tenantId, ...workstationIds],
      );
      const validWorkstationIds = new Set(rows.map((row) => Number(row.id)));
      const invalidWorkstationIds = workstationIds.filter((workstationId) => !validWorkstationIds.has(workstationId));
      if (invalidWorkstationIds.length > 0) {
        throw AppError.badRequest(`存在无效或停用工作站：${invalidWorkstationIds.join(', ')}`);
      }
    }

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
    normalRanges: WorkTimeRange[];
    overtimeRanges: WorkTimeRange[];
    normalHours: string;
    overtimeHours: string;
    totalHours: string;
  }>> {
    const lastDay  = new Date(Date.UTC(year, month, 0));
    const totalDays = lastDay.getUTCDate();
    const startStr = `${year}-${String(month).padStart(2, '0')}-01`;
    const endStr   = `${year}-${String(month).padStart(2, '0')}-${String(totalDays).padStart(2, '0')}`;
    const overrideMap = await loadWorkCalendarOverrides(this.tenantId, startStr, endStr);
    const result: Array<{
      date: string;
      isWorkday: boolean;
      isHoliday: boolean;
      holidayName?: string;
      normalRanges: WorkTimeRange[];
      overtimeRanges: WorkTimeRange[];
      normalHours: string;
      overtimeHours: string;
      totalHours: string;
    }> = [];

    for (let d = 1; d <= totalDays; d++) {
      const dateStr  = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      result.push(resolveWorkCalendarDay(dateStr, overrideMap.get(dateStr)));
    }

    return result;
  }

  // BE-P2-009: 工作日历 — 设置节假日 / 调休
  // NOTE: work_calendar 表由迁移脚本创建，见 migrations/create_work_calendar.sql
  async setHoliday(params: { date: string; isWorkday: boolean; name?: string }): Promise<void> {
    await this.setWorkdayConfig({
      ...params,
      normalRanges: undefined,
      overtimeRanges: undefined,
    });
  }

  async setWorkdayConfig(params: {
    date: string;
    isWorkday: boolean;
    name?: string;
    normalRanges?: WorkTimeRange[];
    overtimeRanges?: WorkTimeRange[];
  }): Promise<void> {
    await AppDataSource.query(
      `INSERT INTO work_calendar
         (tenant_id, date, is_workday, holiday_name, normal_ranges, overtime_ranges, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         is_workday   = VALUES(is_workday),
         holiday_name = VALUES(holiday_name),
         normal_ranges = VALUES(normal_ranges),
         overtime_ranges = VALUES(overtime_ranges),
         updated_by   = VALUES(updated_by)`,
      [
        this.tenantId,
        params.date,
        params.isWorkday ? 1 : 0,
        params.name ?? null,
        params.isWorkday ? JSON.stringify(params.normalRanges ?? null) : JSON.stringify([]),
        params.isWorkday ? JSON.stringify(params.overtimeRanges ?? []) : JSON.stringify([]),
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
  async getTaskStats(batchId?: number): Promise<{ total: number; byStatus: Record<string, number> }> {
    const rows = await AppDataSource.query<Array<{ status: string; count: string }>>(
      `SELECT CASE WHEN pt.status = 'started' THEN 'in_progress' ELSE pt.status END AS status,
              COUNT(*) AS count
       FROM production_tasks pt
       INNER JOIN production_orders po
         ON po.id = pt.production_order_id
        AND po.tenant_id = pt.tenant_id
       WHERE pt.tenant_id = ?
         AND (? IS NULL OR po.joint_batch_id = ?)
       GROUP BY CASE WHEN pt.status = 'started' THEN 'in_progress' ELSE pt.status END`,
      [this.tenantId, batchId ?? null, batchId ?? null],
    );

    const byStatus: Record<string, number> = {};
    let total = 0;
    const normalizedRows = Array.isArray(rows) ? rows : [];
    for (const row of normalizedRows) {
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

  private canManageAnyTask(): boolean {
    return ['admin', 'boss', 'supervisor'].some((role) => this.roles.has(role));
  }

  private async assertTaskOperatorAllowed(taskId: number): Promise<void> {
    if (this.roles.size === 0 || this.canManageAnyTask()) {
      return;
    }

    if (!this.roles.has('worker')) {
      throw AppError.forbidden('当前账号没有生产任务操作权限');
    }

    const [task] = await AppDataSource.query<Array<{
      id: number;
      workerId: number | null;
      workerName: string | null;
    }>>(
      `SELECT
          pt.id,
          pt.worker_id AS workerId,
          u.real_name AS workerName
       FROM production_tasks pt
       LEFT JOIN users u ON u.id = pt.worker_id
       WHERE pt.id = ? AND pt.tenant_id = ?
       LIMIT 1`,
      [taskId, this.tenantId],
    );

    if (!task) {
      throw AppError.notFound('任务不存在', ResponseCode.NOT_FOUND);
    }

    if (task.workerId == null) {
      throw AppError.forbidden('任务未绑定到具体工人，当前账号不能报工，请联系主管分派');
    }

    if (Number(task.workerId) !== this.userId) {
      throw AppError.forbidden(`该任务已分配给 ${task.workerName || '其他工人'}，当前账号不能代报工`);
    }
  }

  private async assertTaskDependenciesReady(
    taskId: number,
    action: 'start' | 'complete' | 'exception',
  ): Promise<void> {
    const [task] = await AppDataSource.query<Array<{
      id: number;
      operationId: number | null;
    }>>(
      `SELECT id, operation_id AS operationId
       FROM production_tasks
       WHERE id = ? AND tenant_id = ?
       LIMIT 1`,
      [taskId, this.tenantId],
    );

    if (!task) {
      throw AppError.notFound('任务不存在', ResponseCode.NOT_FOUND);
    }

    if (!task.operationId) {
      return;
    }

    const dependencySummary = await this.getTaskDependencySummary(Number(task.operationId));
    if (!dependencySummary.blocked) {
      return;
    }

    const actionLabel = action === 'start'
      ? '开始生产'
      : action === 'complete'
        ? '完工上报'
        : '异常上报';
    throw AppError.badRequest(
      `${dependencySummary.blockingReason ?? '存在未完成的前置依赖'}，暂不允许${actionLabel}`,
      ResponseCode.INVALID_PARAMS,
    );
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
      skuId: number | null;
      skuCode: string | null;
      skuName: string | null;
      unit: string | null;
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
      skuId: number | null;
      skuCode: string | null;
      skuName: string | null;
      unit: string | null;
    }>>(
      `SELECT
          dep.predecessor_operation_id AS operationId,
          COALESCE(ps.step_name, CONCAT('STEP#', pred.process_step_id)) AS stepName,
          dep.required_qty AS requiredQty,
          pred.completed_qty AS completedQty,
          pred.status AS status,
          COALESCE(pred_task.output_sku_id, pred.output_sku_id, pred_component.resolved_sku_id, pred_component.sku_id) AS skuId,
          sku.sku_code AS skuCode,
          sku.name AS skuName,
          sku.stock_unit AS unit
       FROM production_operation_dependencies dep
       INNER JOIN production_operations pred
         ON pred.id = dep.predecessor_operation_id
        AND pred.tenant_id = dep.tenant_id
       LEFT JOIN process_steps ps
         ON ps.id = pred.process_step_id
       LEFT JOIN (
         SELECT tenant_id, operation_id, MAX(id) AS task_id
         FROM production_tasks
         GROUP BY tenant_id, operation_id
       ) pred_task_ref
         ON pred_task_ref.tenant_id = pred.tenant_id
        AND pred_task_ref.operation_id = pred.id
       LEFT JOIN production_tasks pred_task
         ON pred_task.id = pred_task_ref.task_id
       LEFT JOIN production_order_components pred_component
         ON pred_component.id = pred.component_id
        AND pred_component.tenant_id = pred.tenant_id
       LEFT JOIN skus sku
         ON sku.id = COALESCE(pred_task.output_sku_id, pred.output_sku_id, pred_component.resolved_sku_id, pred_component.sku_id)
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
    movementType: 'issue' | 'return' | 'consume' | 'scrap' | 'output';
    skuId: number;
    skuCode: string | null;
    skuName: string | null;
    hasDyeLot: boolean;
    stockUnit: string | null;
    plannedQty: string;
    actualQty: string;
    qtyAvailable: string;
    shortageQty: string;
    isShortage: boolean;
    inventoryTxId: number | null;
    transactionNo: string | null;
    transactionType: string | null;
    direction: 'IN' | 'OUT' | null;
    transactionQty: string | null;
    transactionTime: string | null;
    referenceNo: string | null;
    warehouseId: number | null;
    warehouseCode: string | null;
    warehouseName: string | null;
    locationId: number | null;
    locationCode: string | null;
    locationName: string | null;
    notes: string | null;
  }>> {
    return AppDataSource.query(
      `SELECT
          tim.id,
          COALESCE(tmt.io_type, CASE WHEN tim.movement_type = 'output' THEN 'output' ELSE 'input' END) AS ioType,
          tim.movement_type AS movementType,
          tim.sku_id AS skuId,
          s.sku_code AS skuCode,
          s.name AS skuName,
          s.has_dye_lot AS hasDyeLot,
          s.stock_unit AS stockUnit,
          COALESCE(tmt.planned_qty, 0) AS plannedQty,
          CAST(tim.qty AS CHAR) AS actualQty,
          CAST(COALESCE(inv.qtyAvailable, 0) AS CHAR) AS qtyAvailable,
          CAST(GREATEST(COALESCE(tmt.planned_qty, 0) - COALESCE(inv.qtyAvailable, 0), 0) AS CHAR) AS shortageQty,
          CASE WHEN COALESCE(inv.qtyAvailable, 0) < COALESCE(tmt.planned_qty, 0) THEN TRUE ELSE FALSE END AS isShortage,
          tim.inventory_tx_id AS inventoryTxId,
          it.transaction_no AS transactionNo,
          it.transaction_type AS transactionType,
          it.direction AS direction,
          CAST(COALESCE(it.qty_stock_unit, tim.qty) AS CHAR) AS transactionQty,
          DATE_FORMAT(it.created_at, '%Y-%m-%d %H:%i:%s') AS transactionTime,
          it.reference_no AS referenceNo,
          it.warehouse_id AS warehouseId,
          txw.code AS warehouseCode,
          txw.name AS warehouseName,
          it.location_id AS locationId,
          txl.code AS locationCode,
          txl.name AS locationName,
          it.notes AS notes
       FROM task_inventory_movements tim
       LEFT JOIN task_material_transactions tmt
         ON tmt.id = tim.task_material_tx_id
        AND tmt.tenant_id = tim.tenant_id
       LEFT JOIN skus s
         ON s.id = tim.sku_id
       LEFT JOIN (
         SELECT tenant_id, sku_id, SUM(qty_on_hand - qty_reserved) AS qtyAvailable
         FROM inventory
         GROUP BY tenant_id, sku_id
       ) inv
         ON inv.sku_id = tim.sku_id
        AND inv.tenant_id = tim.tenant_id
       LEFT JOIN inventory_transactions it
         ON it.id = tim.inventory_tx_id
        AND it.tenant_id = tim.tenant_id
       LEFT JOIN warehouses txw
         ON txw.id = it.warehouse_id
        AND txw.tenant_id = it.tenant_id
       LEFT JOIN locations txl
         ON txl.id = it.location_id
        AND txl.tenant_id = it.tenant_id
       WHERE tim.tenant_id = ? AND tim.task_id = ?
       ORDER BY FIELD(COALESCE(tmt.io_type, CASE WHEN tim.movement_type = 'output' THEN 'output' ELSE 'input' END), 'output', 'input'),
                tim.created_at ASC,
                tim.id ASC`,
      [this.tenantId, taskId],
    );
  }

  private summarizeTaskMaterialFlows(
    materialTransactions: Array<{
      ioType: 'input' | 'output';
      movementType: 'issue' | 'return' | 'consume' | 'scrap' | 'output';
      skuId: number;
      hasDyeLot: boolean;
      actualQty: string;
      inventoryTxId: number | null;
    }>,
  ): Map<number, {
    issuedQty: Decimal;
    returnedQty: Decimal;
    consumedQty: Decimal;
    scrapQty: Decimal;
    outputQty: Decimal;
    inventoryTxId: number | null;
  }> {
    const summary = new Map<number, {
      issuedQty: Decimal;
      returnedQty: Decimal;
      consumedQty: Decimal;
      scrapQty: Decimal;
      outputQty: Decimal;
      inventoryTxId: number | null;
    }>();

    for (const item of materialTransactions) {
      const key = Number(item.skuId);
      const current = summary.get(key) ?? {
        issuedQty: new Decimal(0),
        returnedQty: new Decimal(0),
        consumedQty: new Decimal(0),
        scrapQty: new Decimal(0),
        outputQty: new Decimal(0),
        inventoryTxId: null,
      };
      const qty = new Decimal(item.actualQty ?? 0);
      if (item.movementType === 'issue') current.issuedQty = current.issuedQty.plus(qty);
      if (item.movementType === 'return') current.returnedQty = current.returnedQty.plus(qty);
      if (item.movementType === 'consume') current.consumedQty = current.consumedQty.plus(qty);
      if (item.movementType === 'scrap') current.scrapQty = current.scrapQty.plus(qty);
      if (item.movementType === 'output') current.outputQty = current.outputQty.plus(qty);
      if (item.inventoryTxId) current.inventoryTxId = item.inventoryTxId;
      summary.set(key, current);
    }

    return summary;
  }

  private async getTaskInputMaterials(
    task: {
      id: number;
      productionOrderId: number;
      processStepId: number;
      plannedQty: string;
      orderPlannedQty: string;
      taskType: 'finished' | 'semi_finished';
    },
    materialTransactions: Array<{
      id: number;
      ioType: 'input' | 'output';
      movementType: 'issue' | 'return' | 'consume' | 'scrap' | 'output';
      skuId: number;
      skuCode: string | null;
      skuName: string | null;
      hasDyeLot: boolean;
      stockUnit: string | null;
      plannedQty: string;
      actualQty: string;
      qtyAvailable: string;
      shortageQty: string;
      isShortage: boolean;
      inventoryTxId: number | null;
    }>,
  ): Promise<Array<{
    itemType: 'material';
    sourceLabel: string;
    skuId: number;
    skuCode: string | null;
    skuName: string | null;
    unit: string | null;
    stockUnit: string | null;
    purchaseUnit: string | null;
    productionUnit: string | null;
    hasDyeLot: boolean;
    requiredQty: string;
    issuedQty: string;
    qtyAvailable: string;
    shortageQty: string;
    isShortage: boolean;
    inventoryTxId: number | null;
    movementStatus: string;
    specText?: string | null;
    processParams?: Record<string, unknown> | null;
  }>> {
    const inputTransactions = materialTransactions.filter((item) => item.ioType === 'input');
    const flowSummary = this.summarizeTaskMaterialFlows(inputTransactions);

    const stepMaterials = await AppDataSource.query<Array<{
      skuId: number;
      skuCode: string | null;
      skuName: string | null;
      unit: string | null;
      stockUnit: string | null;
      purchaseUnit: string | null;
      productionUnit: string | null;
      hasDyeLot: boolean;
      usagePerUnit: string;
      lossRate: string;
      consumeTiming: 'start' | 'complete';
      qtyAvailable: string;
      specText: string | null;
      processParamsJson: string | Record<string, unknown> | null;
    }>>(
      `SELECT
          COALESCE(poc.resolved_sku_id, poc.sku_id, psm.input_sku_id) AS skuId,
          sku.sku_code AS skuCode,
          sku.name AS skuName,
          sku.stock_unit AS unit,
          sku.stock_unit AS stockUnit,
          sku.purchase_unit AS purchaseUnit,
          sku.production_unit AS productionUnit,
          sku.has_dye_lot AS hasDyeLot,
          psm.usage_per_unit AS usagePerUnit,
          psm.loss_rate AS lossRate,
          psm.consume_timing AS consumeTiming,
          psm.spec_text AS specText,
          psm.process_params_json AS processParamsJson,
          CAST(COALESCE(inv.qtyAvailable, 0) AS CHAR) AS qtyAvailable
       FROM process_steps ps
       INNER JOIN process_step_materials psm
         ON psm.tenant_id = ps.tenant_id
        AND psm.template_id = ps.template_id
        AND psm.step_no = ps.step_no
       LEFT JOIN production_order_components poc
         ON poc.tenant_id = ?
        AND poc.production_order_id = ?
        AND poc.sku_id = psm.input_sku_id
       LEFT JOIN skus sku
         ON sku.id = COALESCE(poc.resolved_sku_id, poc.sku_id, psm.input_sku_id)
       LEFT JOIN (
         SELECT tenant_id, sku_id, SUM(qty_on_hand - qty_reserved) AS qtyAvailable
         FROM inventory
         GROUP BY tenant_id, sku_id
       ) inv
         ON inv.tenant_id = ?
        AND inv.sku_id = COALESCE(poc.resolved_sku_id, poc.sku_id, psm.input_sku_id)
       WHERE ps.id = ? AND ps.tenant_id = ?
       ORDER BY psm.id ASC`,
      [this.tenantId, task.productionOrderId, this.tenantId, task.processStepId, this.tenantId],
    );

    if (stepMaterials.length > 0) {
      const taskQty = new Decimal(task.plannedQty ?? 0);
      return stepMaterials.map((item) => {
        const requiredQty = taskQty
          .mul(new Decimal(item.usagePerUnit ?? 0))
          .mul(new Decimal(1).plus(new Decimal(item.lossRate ?? 0)));
        const summary = flowSummary.get(Number(item.skuId));
        const issuedQty = Decimal.max(
          (summary?.issuedQty ?? new Decimal(0)).minus(summary?.returnedQty ?? 0),
          0,
        );
        const lineSideQty = Decimal.max(
          issuedQty.minus(summary?.consumedQty ?? 0).minus(summary?.scrapQty ?? 0),
          0,
        );
        const qtyAvailable = new Decimal(item.qtyAvailable ?? 0);
        const shortageQty = Decimal.max(requiredQty.minus(qtyAvailable), 0);

        return {
          itemType: 'material' as const,
          sourceLabel: item.consumeTiming === 'complete' ? '工序完工投料' : '工序开工投料',
          skuId: Number(item.skuId),
          skuCode: item.skuCode,
          skuName: item.skuName,
          unit: item.unit,
          stockUnit: item.stockUnit,
          purchaseUnit: item.purchaseUnit,
          productionUnit: item.productionUnit,
          hasDyeLot: Boolean(item.hasDyeLot),
          requiredQty: requiredQty.toFixed(4),
          issuedQty: issuedQty.toFixed(4),
          qtyAvailable: qtyAvailable.toFixed(4),
          shortageQty: shortageQty.toFixed(4),
          isShortage: shortageQty.gt(0),
          inventoryTxId: summary?.inventoryTxId ?? null,
          movementStatus: `已领 ${issuedQty.toFixed(4)} / 已耗 ${(summary?.consumedQty ?? new Decimal(0)).toFixed(4)} / 在线边 ${lineSideQty.toFixed(4)}`,
          specText: item.specText ?? null,
          processParams: (() => {
            if (!item.processParamsJson) return null;
            if (typeof item.processParamsJson === 'string') {
              try {
                return JSON.parse(item.processParamsJson) as Record<string, unknown>;
              } catch {
                return null;
              }
            }
            return item.processParamsJson;
          })(),
        };
      });
    }

    if (inputTransactions.length > 0) {
      return Array.from(flowSummary.entries()).map(([skuId, summary]) => {
        const transaction = inputTransactions.find((item) => Number(item.skuId) === Number(skuId));
        const issuedQty = Decimal.max(summary.issuedQty.minus(summary.returnedQty), 0);
        const lineSideQty = Decimal.max(issuedQty.minus(summary.consumedQty).minus(summary.scrapQty), 0);
        return {
        itemType: 'material' as const,
        sourceLabel: '任务投料记录',
        skuId: Number(skuId),
        skuCode: transaction?.skuCode ?? null,
        skuName: transaction?.skuName ?? null,
        unit: transaction?.stockUnit ?? null,
        stockUnit: transaction?.stockUnit ?? null,
        purchaseUnit: transaction?.stockUnit ?? null,
        productionUnit: transaction?.stockUnit ?? null,
        hasDyeLot: Boolean(transaction?.hasDyeLot),
        requiredQty: transaction?.plannedQty ?? '0.0000',
        issuedQty: issuedQty.toFixed(4),
        qtyAvailable: transaction?.qtyAvailable ?? '0.0000',
        shortageQty: transaction?.shortageQty ?? '0.0000',
        isShortage: Number(transaction?.shortageQty ?? 0) > 0,
        inventoryTxId: summary.inventoryTxId,
        movementStatus: `已领 ${issuedQty.toFixed(4)} / 已耗 ${summary.consumedQty.toFixed(4)} / 在线边 ${lineSideQty.toFixed(4)}`,
        specText: null,
        processParams: null,
      };
      });
    }

    if (task.taskType !== 'finished') {
      return [];
    }

    const fallbackMaterials = await AppDataSource.query<Array<{
      skuId: number;
      skuCode: string | null;
      skuName: string | null;
      unit: string | null;
      stockUnit: string | null;
      purchaseUnit: string | null;
      productionUnit: string | null;
      hasDyeLot: boolean;
      qtyRequired: string;
      availableQty: string;
      qtyShortage: string;
    }>>(
      `SELECT
          mr.sku_id AS skuId,
          sku.sku_code AS skuCode,
          sku.name AS skuName,
          sku.stock_unit AS unit,
          sku.stock_unit AS stockUnit,
          sku.purchase_unit AS purchaseUnit,
          sku.production_unit AS productionUnit,
          sku.has_dye_lot AS hasDyeLot,
          mr.qty_required AS qtyRequired,
          CAST(COALESCE(inv.qtyAvailable, 0) AS CHAR) AS availableQty,
          CAST(mr.qty_shortage AS CHAR) AS qtyShortage
       FROM material_requirements mr
       INNER JOIN skus sku
         ON sku.id = mr.sku_id
       LEFT JOIN (
         SELECT tenant_id, sku_id, SUM(qty_on_hand - qty_reserved) AS qtyAvailable
         FROM inventory
         GROUP BY tenant_id, sku_id
       ) inv
         ON inv.tenant_id = mr.tenant_id
        AND inv.sku_id = mr.sku_id
       WHERE mr.tenant_id = ? AND mr.production_order_id = ?
       ORDER BY mr.id ASC`,
      [this.tenantId, task.productionOrderId],
    );

    const orderQty = new Decimal(task.orderPlannedQty ?? 0);
    const ratio = orderQty.gt(0)
      ? new Decimal(task.plannedQty ?? 0).div(orderQty)
      : new Decimal(1);

    return fallbackMaterials.map((item) => {
      const scaledRequiredQty = new Decimal(item.qtyRequired ?? 0).mul(ratio);
      const qtyAvailable = new Decimal(item.availableQty ?? 0);
      const shortageQty = Decimal.max(scaledRequiredQty.minus(qtyAvailable), 0);

      return {
        itemType: 'material' as const,
        sourceLabel: '工单原材料需求',
        skuId: Number(item.skuId),
        skuCode: item.skuCode,
        skuName: item.skuName,
        unit: item.unit,
        stockUnit: item.stockUnit,
        purchaseUnit: item.purchaseUnit,
        productionUnit: item.productionUnit,
        hasDyeLot: Boolean(item.hasDyeLot),
        requiredQty: scaledRequiredQty.toFixed(4),
        issuedQty: '0.0000',
        qtyAvailable: qtyAvailable.toFixed(4),
        shortageQty: shortageQty.toFixed(4),
        isShortage: shortageQty.gt(0),
        inventoryTxId: null,
        movementStatus: shortageQty.gt(0) ? '缺料待领' : '待领料',
        specText: null,
        processParams: null,
      };
    });
  }

  private async hasTaskStepInputMaterials(processStepId: number): Promise<boolean> {
    const [row] = await AppDataSource.query<Array<{ cnt: string }>>(
      `SELECT COUNT(*) AS cnt
       FROM process_steps ps
       INNER JOIN process_step_materials psm
         ON psm.tenant_id = ps.tenant_id
        AND psm.template_id = ps.template_id
        AND psm.step_no = ps.step_no
       WHERE ps.id = ? AND ps.tenant_id = ?
       LIMIT 1`,
      [processStepId, this.tenantId],
    );
    return Number(row?.cnt ?? 0) > 0;
  }

  private async getTaskInputItems(
    task: {
      id: number;
      productionOrderId: number;
      processStepId: number;
      plannedQty: string;
      orderPlannedQty: string;
      outputSkuId?: number | null;
      taskType: 'finished' | 'semi_finished';
    },
    predecessors: Array<{
      operationId: number;
      stepName: string;
      requiredQty: string;
      completedQty: string;
      status: string;
      skuId: number | null;
      skuCode: string | null;
      skuName: string | null;
      unit: string | null;
    }>,
    materialTransactions: Array<{
      id: number;
      ioType: 'input' | 'output';
      movementType: 'issue' | 'return' | 'consume' | 'scrap' | 'output';
      skuId: number;
      skuCode: string | null;
      skuName: string | null;
      hasDyeLot: boolean;
      stockUnit: string | null;
      plannedQty: string;
      actualQty: string;
      qtyAvailable: string;
      shortageQty: string;
      isShortage: boolean;
      inventoryTxId: number | null;
    }>,
  ): Promise<Array<{
    itemType: 'semi_finished' | 'material';
    sourceLabel: string;
    skuId: number;
    skuCode: string | null;
    skuName: string | null;
    unit: string | null;
    stockUnit: string | null;
    purchaseUnit: string | null;
    productionUnit: string | null;
    hasDyeLot: boolean;
    requiredQty: string;
    fulfilledQty: string;
    qtyAvailable: string;
    shortageQty: string;
    isShortage: boolean;
    status: string | null;
    operationId: number | null;
    stepName: string | null;
    inventoryTxId: number | null;
  }>> {
    const predecessorItems = predecessors
      .filter((item) => item.skuId != null)
      .map((item) => {
        const requiredQty = new Decimal(item.requiredQty ?? 0);
        const fulfilledQty = new Decimal(item.completedQty ?? 0);
        const shortageQty = Decimal.max(requiredQty.minus(fulfilledQty), 0);
        return {
          itemType: 'semi_finished' as const,
          sourceLabel: '前置工序依赖',
          skuId: Number(item.skuId),
          skuCode: item.skuCode,
          skuName: item.skuName,
          unit: item.unit,
          stockUnit: item.unit,
          purchaseUnit: item.unit,
          productionUnit: item.unit,
          hasDyeLot: false,
          requiredQty: requiredQty.toFixed(4),
          fulfilledQty: fulfilledQty.toFixed(4),
          qtyAvailable: fulfilledQty.toFixed(4),
          shortageQty: shortageQty.toFixed(4),
          isShortage: shortageQty.gt(0),
          status: item.status,
          operationId: item.operationId,
          stepName: item.stepName,
          inventoryTxId: null,
        };
      });

    const hasExplicitStepMaterials = await this.hasTaskStepInputMaterials(task.processStepId);
    if (!hasExplicitStepMaterials && task.outputSkuId) {
      const bomInputItems = await this.getTaskBomInputItems(task, predecessors, materialTransactions);
      if (bomInputItems.length > 0) {
        return bomInputItems;
      }
    }

    const materialItems = await this.getTaskInputMaterials(task, materialTransactions);
    if (materialItems.length > 0) {
      return [
        ...predecessorItems,
        ...materialItems.map((item) => ({
          itemType: 'material' as const,
          sourceLabel: item.sourceLabel,
          skuId: item.skuId,
          skuCode: item.skuCode,
          skuName: item.skuName,
          unit: item.unit,
          stockUnit: item.stockUnit ?? item.unit,
          purchaseUnit: item.purchaseUnit ?? item.unit,
          productionUnit: item.productionUnit ?? item.stockUnit ?? item.unit,
          hasDyeLot: item.hasDyeLot,
          requiredQty: item.requiredQty,
          fulfilledQty: item.issuedQty,
          qtyAvailable: item.qtyAvailable,
          shortageQty: item.shortageQty,
          isShortage: item.isShortage,
          status: item.movementStatus || (item.inventoryTxId ? '已投料' : Number(item.shortageQty ?? 0) > 0 ? '缺料' : '待投料'),
          operationId: null,
          stepName: null,
          inventoryTxId: item.inventoryTxId,
        })),
      ];
    }

    if (task.outputSkuId) {
      const bomInputItems = await this.getTaskBomInputItems(task, predecessors, materialTransactions);
      if (bomInputItems.length > 0) {
        return bomInputItems;
      }
    }

    return predecessorItems;
  }

  private async getTaskBomInputItems(
    task: {
      plannedQty: string;
      outputSkuId?: number | null;
    },
    predecessors: Array<{
      operationId: number;
      stepName: string;
      requiredQty: string;
      completedQty: string;
      status: string;
      skuId: number | null;
      skuCode: string | null;
      skuName: string | null;
      unit: string | null;
    }>,
    materialTransactions: Array<{
      id: number;
      ioType: 'input' | 'output';
      skuId: number;
      skuCode: string | null;
      skuName: string | null;
      hasDyeLot: boolean;
      stockUnit: string | null;
      plannedQty: string;
      actualQty: string;
      qtyAvailable: string;
      shortageQty: string;
      isShortage: boolean;
      inventoryTxId: number | null;
    }>,
  ): Promise<Array<{
    itemType: 'semi_finished' | 'material';
    sourceLabel: string;
    skuId: number;
    skuCode: string | null;
    skuName: string | null;
    unit: string | null;
    stockUnit: string | null;
    purchaseUnit: string | null;
    productionUnit: string | null;
    hasDyeLot: boolean;
    requiredQty: string;
    fulfilledQty: string;
    qtyAvailable: string;
    shortageQty: string;
    isShortage: boolean;
    status: string | null;
    operationId: number | null;
    stepName: string | null;
    inventoryTxId: number | null;
  }>> {
    if (!task.outputSkuId) {
      return [];
    }

    const inputTransactions = materialTransactions.filter((item) => item.ioType === 'input');
    const txBySkuId = new Map(inputTransactions.map((item) => [Number(item.skuId), item]));
    const predecessorBySkuId = new Map(
      predecessors
        .filter((item) => item.skuId != null)
        .map((item) => [Number(item.skuId), item]),
    );

    const bomRows = await AppDataSource.query<Array<{
      skuId: number;
      skuCode: string | null;
      skuName: string | null;
      unit: string | null;
      stockUnit: string | null;
      purchaseUnit: string | null;
      productionUnit: string | null;
      hasDyeLot: boolean;
      quantity: string;
      scrapRate: string;
      qtyAvailable: string;
      itemType: 'semi_finished' | 'material';
    }>>(
      `SELECT
          bi.component_sku_id AS skuId,
          sku.sku_code AS skuCode,
          sku.name AS skuName,
          COALESCE(NULLIF(bi.unit, ''), sku.stock_unit) AS unit,
          sku.stock_unit AS stockUnit,
          sku.purchase_unit AS purchaseUnit,
          sku.production_unit AS productionUnit,
          sku.has_dye_lot AS hasDyeLot,
          bi.quantity AS quantity,
          bi.scrap_rate AS scrapRate,
          CAST(COALESCE(inv.qtyAvailable, 0) AS CHAR) AS qtyAvailable,
          CASE
            WHEN EXISTS (
              SELECT 1
              FROM bom_headers sub_bh
              WHERE sub_bh.tenant_id = bh.tenant_id
                AND sub_bh.sku_id = bi.component_sku_id
                AND sub_bh.status = 'active'
              LIMIT 1
            ) THEN 'semi_finished'
            ELSE 'material'
          END AS itemType
       FROM bom_headers bh
       INNER JOIN bom_items bi
         ON bi.bom_header_id = bh.id
        AND bi.tenant_id = bh.tenant_id
        AND bi.parent_item_id IS NULL
       LEFT JOIN skus sku
         ON sku.id = bi.component_sku_id
       LEFT JOIN (
         SELECT tenant_id, sku_id, SUM(qty_on_hand - qty_reserved) AS qtyAvailable
         FROM inventory
         GROUP BY tenant_id, sku_id
       ) inv
         ON inv.tenant_id = bh.tenant_id
        AND inv.sku_id = bi.component_sku_id
       WHERE bh.tenant_id = ?
         AND bh.sku_id = ?
         AND bh.status = 'active'
       ORDER BY bi.sort_order ASC, bi.id ASC`,
      [this.tenantId, task.outputSkuId],
    );

    if (bomRows.length === 0) {
      return [];
    }

    const taskQty = new Decimal(task.plannedQty ?? 0);
    return bomRows.map((item) => {
      const requiredQty = taskQty
        .mul(new Decimal(item.quantity ?? 0))
        .mul(new Decimal(1).plus(new Decimal(item.scrapRate ?? 0)));

      if (item.itemType === 'semi_finished') {
        const predecessor = predecessorBySkuId.get(Number(item.skuId));
        const transaction = txBySkuId.get(Number(item.skuId));
        const producedQty = new Decimal(predecessor?.completedQty ?? 0);
        const issuedQty = new Decimal(transaction?.actualQty ?? 0);
        const shortageQty = Decimal.max(requiredQty.minus(producedQty), 0);
        const issueShortageQty = shortageQty.gt(0)
          ? shortageQty
          : Decimal.max(requiredQty.minus(issuedQty), 0);

        return {
          itemType: 'semi_finished' as const,
          sourceLabel: 'BOM汇总回退 · 半成品依赖',
          skuId: Number(item.skuId),
          skuCode: item.skuCode,
          skuName: item.skuName,
          unit: item.unit,
          stockUnit: item.stockUnit,
          purchaseUnit: item.purchaseUnit,
          productionUnit: item.productionUnit,
          hasDyeLot: false,
          requiredQty: requiredQty.toFixed(4),
          fulfilledQty: issuedQty.gt(0) ? issuedQty.toFixed(4) : producedQty.toFixed(4),
          qtyAvailable: producedQty.toFixed(4),
          shortageQty: issueShortageQty.toFixed(4),
          isShortage: issueShortageQty.gt(0),
          status: shortageQty.gt(0)
            ? '待齐套'
            : transaction?.inventoryTxId
              ? '已投料'
              : issuedQty.gt(0)
                ? '部分投料'
                : '待投料',
          operationId: predecessor?.operationId ?? null,
          stepName: predecessor?.stepName ?? null,
          inventoryTxId: transaction?.inventoryTxId ?? null,
        };
      }

      const transaction = txBySkuId.get(Number(item.skuId));
      const qtyAvailable = new Decimal(item.qtyAvailable ?? 0);
      const shortageQty = Decimal.max(requiredQty.minus(qtyAvailable), 0);

      return {
        itemType: 'material' as const,
        sourceLabel: 'BOM汇总回退 · 原材料',
        skuId: Number(item.skuId),
        skuCode: item.skuCode,
        skuName: item.skuName,
        unit: item.unit,
        stockUnit: item.stockUnit,
        purchaseUnit: item.purchaseUnit,
        productionUnit: item.productionUnit,
        hasDyeLot: Boolean(item.hasDyeLot),
        requiredQty: requiredQty.toFixed(4),
        fulfilledQty: transaction?.actualQty ?? '0.0000',
        qtyAvailable: qtyAvailable.toFixed(4),
        shortageQty: shortageQty.toFixed(4),
        isShortage: shortageQty.gt(0),
        status: transaction?.inventoryTxId ? '已投料' : shortageQty.gt(0) ? '缺料' : '待投料',
        operationId: null,
        stepName: null,
        inventoryTxId: transaction?.inventoryTxId ?? null,
      };
    });
  }

  private buildTaskOutputItems(
    task: {
      taskType: 'finished' | 'semi_finished';
      outputSkuId?: number | null;
      outputSkuCode?: string | null;
      outputSkuName?: string | null;
      outputStockUnit?: string | null;
      skuId?: number | null;
      skuCode?: string | null;
      skuName?: string | null;
      plannedQty: string;
      completedQty: string;
    },
    materialTransactions: Array<{
      ioType: 'input' | 'output';
      skuId: number;
      skuCode: string | null;
      skuName: string | null;
      stockUnit: string | null;
      plannedQty: string;
      actualQty: string;
      warehouseId?: number | null;
      warehouseCode?: string | null;
      warehouseName?: string | null;
      locationId?: number | null;
      locationCode?: string | null;
      locationName?: string | null;
    }>,
  ): Array<{
    itemType: 'finished' | 'semi_finished';
    skuId: number;
    skuCode: string | null;
    skuName: string | null;
    unit: string | null;
    plannedQty: string;
    actualQty: string;
    processStepId: number | null;
    processName: string | null;
    warehouseId: number | null;
    warehouseCode: string | null;
    warehouseName: string | null;
    locationId: number | null;
    locationCode: string | null;
    locationName: string | null;
  }> {
    const outputTransactions = materialTransactions.filter((item) => item.ioType === 'output');
    if (outputTransactions.length > 0) {
      return outputTransactions.map((item) => ({
        itemType: task.taskType,
        skuId: Number(item.skuId),
        skuCode: item.skuCode,
        skuName: item.skuName,
        unit: item.stockUnit,
        plannedQty: item.plannedQty,
        actualQty: item.actualQty,
        processStepId: null,
        processName: null,
        warehouseId: item.warehouseId ?? null,
        warehouseCode: item.warehouseCode ?? null,
        warehouseName: item.warehouseName ?? null,
        locationId: item.locationId ?? null,
        locationCode: item.locationCode ?? null,
        locationName: item.locationName ?? null,
      }));
    }

    return [{
      itemType: task.taskType,
      skuId: Number(task.outputSkuId ?? task.skuId ?? 0),
      skuCode: task.outputSkuCode ?? task.skuCode ?? null,
      skuName: task.outputSkuName ?? task.skuName ?? null,
      unit: task.outputStockUnit ?? null,
      plannedQty: String(task.plannedQty ?? '0'),
      actualQty: String(task.completedQty ?? '0'),
      processStepId: null,
      processName: null,
      warehouseId: null,
      warehouseCode: null,
      warehouseName: null,
      locationId: null,
      locationCode: null,
      locationName: null,
    }];
  }

  private async getPreferredSkuStorageMap(
    skuIds: number[],
    options: {
      excludeWarehouseCodes?: string[];
    } = {},
  ): Promise<Map<number, {
    warehouseId: number | null;
    warehouseCode: string | null;
    warehouseName: string | null;
    locationId: number | null;
    locationCode: string | null;
    locationName: string | null;
  }>> {
    if (skuIds.length === 0) {
      return new Map();
    }

    const excludedCodes = (options.excludeWarehouseCodes ?? []).filter((code) => code.trim().length > 0);
    const excludeClause = excludedCodes.length > 0
      ? ` AND COALESCE(w.code, '') NOT IN (${excludedCodes.map(() => '?').join(',')})`
      : '';

    const rows = await AppDataSource.query<Array<{
      skuId: number;
      warehouseId: number | null;
      warehouseCode: string | null;
      warehouseName: string | null;
      locationId: number | null;
      locationCode: string | null;
      locationName: string | null;
    }>>(
      `SELECT
          inv.sku_id AS skuId,
          inv.warehouse_id AS warehouseId,
          w.code AS warehouseCode,
          w.name AS warehouseName,
          inv.location_id AS locationId,
          l.code AS locationCode,
          l.name AS locationName
       FROM inventory inv
       LEFT JOIN warehouses w
         ON w.id = inv.warehouse_id
        AND w.tenant_id = inv.tenant_id
       LEFT JOIN locations l
         ON l.id = inv.location_id
        AND l.tenant_id = inv.tenant_id
       WHERE inv.tenant_id = ?
         AND inv.sku_id IN (${skuIds.map(() => '?').join(',')})
         ${excludeClause}
       ORDER BY inv.sku_id ASC, (inv.qty_on_hand - inv.qty_reserved) DESC, inv.warehouse_id ASC, inv.location_id ASC`,
      [this.tenantId, ...skuIds, ...excludedCodes],
    );

    const result = new Map<number, {
      warehouseId: number | null;
      warehouseCode: string | null;
      warehouseName: string | null;
      locationId: number | null;
      locationCode: string | null;
      locationName: string | null;
    }>();
    const normalizedRows = Array.isArray(rows) ? rows : [];
    for (const row of normalizedRows) {
      const skuId = Number(row.skuId);
      if (!result.has(skuId)) {
        result.set(skuId, {
          warehouseId: row.warehouseId != null ? Number(row.warehouseId) : null,
          warehouseCode: row.warehouseCode ?? null,
          warehouseName: row.warehouseName ?? null,
          locationId: row.locationId != null ? Number(row.locationId) : null,
          locationCode: row.locationCode ?? null,
          locationName: row.locationName ?? null,
        });
      }
    }
    return result;
  }

  private async getDefaultStorageLocation(): Promise<{
    warehouseId: number | null;
    warehouseCode: string | null;
    warehouseName: string | null;
    locationId: number | null;
    locationCode: string | null;
    locationName: string | null;
  } | null> {
    const rows = await AppDataSource.query<Array<{
      warehouseId: number;
      warehouseCode: string;
      warehouseName: string;
      locationId: number;
      locationCode: string;
      locationName: string;
    }>>(
      `SELECT
          w.id AS warehouseId,
          w.code AS warehouseCode,
          w.name AS warehouseName,
          l.id AS locationId,
          l.code AS locationCode,
          l.name AS locationName
       FROM warehouses w
       INNER JOIN locations l
         ON l.tenant_id = w.tenant_id
        AND l.warehouse_id = w.id
       WHERE w.tenant_id = ?
         AND w.code = 'DEFAULT'
         AND l.code = 'DEFAULT-UNKNOWN'
       LIMIT 1`,
      [this.tenantId],
    );
    const row = Array.isArray(rows) ? rows[0] : null;

    if (!row) {
      return null;
    }

    return {
      warehouseId: Number(row.warehouseId),
      warehouseCode: row.warehouseCode,
      warehouseName: row.warehouseName,
      locationId: Number(row.locationId),
      locationCode: row.locationCode,
      locationName: row.locationName,
    };
  }

  private pickStorageLocation(
    transaction: {
      warehouseId?: number | null;
      warehouseCode?: string | null;
      warehouseName?: string | null;
      locationId?: number | null;
      locationCode?: string | null;
      locationName?: string | null;
    } | undefined,
    preferredStorage: {
      warehouseId: number | null;
      warehouseCode: string | null;
      warehouseName: string | null;
      locationId: number | null;
      locationCode: string | null;
      locationName: string | null;
    } | undefined,
    fallbackStorage: {
      warehouseId: number | null;
      warehouseCode: string | null;
      warehouseName: string | null;
      locationId: number | null;
      locationCode: string | null;
      locationName: string | null;
    } | null,
  ): {
    warehouseId: number | null;
    warehouseCode: string | null;
    warehouseName: string | null;
    locationId: number | null;
    locationCode: string | null;
    locationName: string | null;
  } {
    const transactionHasLocation = Boolean(transaction?.warehouseId || transaction?.locationId || transaction?.warehouseCode || transaction?.locationCode);
    if (transactionHasLocation) {
      return {
        warehouseId: transaction?.warehouseId != null ? Number(transaction.warehouseId) : null,
        warehouseCode: transaction?.warehouseCode ?? null,
        warehouseName: transaction?.warehouseName ?? null,
        locationId: transaction?.locationId != null ? Number(transaction.locationId) : null,
        locationCode: transaction?.locationCode ?? null,
        locationName: transaction?.locationName ?? null,
      };
    }

    if (preferredStorage) {
      return preferredStorage;
    }

    return fallbackStorage ?? {
      warehouseId: null,
      warehouseCode: null,
      warehouseName: null,
      locationId: null,
      locationCode: null,
      locationName: null,
    };
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
