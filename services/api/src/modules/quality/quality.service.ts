import { AppDataSource } from '../../config/database';
import { TenantContext } from '../../shared/BaseRepository';
import { AppError } from '../../shared/AppError';
import { ResponseCode } from '../../shared/ApiResponse';
import Decimal from 'decimal.js';

// ─── 类型定义 ──────────────────────────────────────────────────

export interface TraceabilityChain {
  productionOrderId: number;
  workOrderNo: string;
  skuName: string;
  salesOrderNo: string;
  customerName: string;
  components: ComponentTrace[];
  summary: {
    totalComponents: number;
    withScanRecord: number;
    dyeLots: string[];
  };
  aiAnalysis: {
    summary: string;
    rootCauses: string[];
    recommendations: string[];
    generatedAt: string;
  } | null;
}

export interface ComponentTrace {
  componentBarcode: string | null;
  componentName: string | null;
  processStepName: string;
  stepNo: number;
  workerName: string;
  workerId: number;
  operationTime: Date;
  skuName: string | null;
  dyeLotNo: string | null;
  hasScanRecord: boolean;
  missingDataNote: string | null;
}

export interface QualityStats {
  periodDays: number;
  totalInspected: number;
  totalFailed: number;
  failRate: string;
  traceCompletionRate: string;
  tracedIssueCount: number;
  totalIssueCount: number;
  trendData: Array<{ date: string; failCount: number; inspectCount: number }>;
  issueTypeBreakdown: Array<{ type: string; count: number; pct: string }>;
  top5Issues: Array<{
    description: string; count: number; orderCount: number;
    relatedWorkers: string[]; relatedProcesses: string[];
  }>;
}

// ─── Quality Service ────────────────────────────────────────────

export class QualityService {
  private readonly tenantId: number;
  private readonly userId: number;

  constructor(ctx: TenantContext) {
    this.tenantId = ctx.tenantId;
    this.userId = ctx.userId;
  }

  private parseJsonStringArray(value: unknown): string[] {
    if (Array.isArray(value)) {
      return value.map((item) => String(item));
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return [];
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (Array.isArray(parsed)) {
          return parsed.map((item) => String(item));
        }
        return [String(parsed)];
      } catch {
        return [trimmed];
      }
    }
    return [];
  }

  private parseOptionalJsonStringArray(value: unknown): string[] | null {
    if (value === null || value === undefined) return null;
    return this.parseJsonStringArray(value);
  }

  private buildAiAnalysis(
    components: ComponentTrace[],
    summary: TraceabilityChain['summary'],
  ): TraceabilityChain['aiAnalysis'] {
    if (components.length === 0) {
      return null;
    }

    const rootCauses: string[] = [];
    const recommendations: string[] = [];
    const missingScanCount = summary.totalComponents - summary.withScanRecord;

    if (summary.dyeLots.length > 1) {
      rootCauses.push(`同一生产单出现 ${summary.dyeLots.length} 个缸号，存在混用风险`);
      recommendations.push('锁定异常缸号批次并复核同批次成品');
    }

    if (missingScanCount > 0) {
      rootCauses.push(`有 ${missingScanCount} 个组件缺少扫码记录，过程追溯链不完整`);
      recommendations.push('要求相关工序补齐扫码报工，并核对缺失节点的人员与时间');
    }

    if (rootCauses.length === 0) {
      rootCauses.push('当前溯源链记录完整，未发现明显的跨缸号或扫码缺失异常');
      recommendations.push('继续按当前扫码与批次管理要求执行，保持追溯链完整性');
    }

    const summaryText = [
      summary.dyeLots.length > 1
        ? '主要风险集中在面料跨缸号使用'
        : '未发现明显跨缸号使用风险',
      missingScanCount > 0
        ? `与 ${missingScanCount} 个工序扫码缺失`
        : '且工序扫码记录完整',
    ].join('');

    return {
      summary: `${summaryText}。`,
      rootCauses,
      recommendations,
      generatedAt: new Date().toISOString(),
    };
  }

  // ── 创建验货单 ────────────────────────────────────────────

  async createInspection(params: {
    productionOrderNo: string;
    inspectionDate: string;
    qtyInspected: string;
  }): Promise<{ id: number; inspectionNo: string }> {
    const [order] = await AppDataSource.query<Array<{ id: number }>>(
      `SELECT id
       FROM production_orders
       WHERE tenant_id = ? AND work_order_no = ?
       ORDER BY id DESC
       LIMIT 1`,
      [this.tenantId, params.productionOrderNo],
    );
    if (!order) {
      throw AppError.notFound('生产工单号不存在', ResponseCode.PRODUCTION_ORDER_NOT_FOUND);
    }

    const inspectionNo = `QC${Date.now()}${Math.floor(Math.random() * 999).toString().padStart(3, '0')}`;

    const result = await AppDataSource.query(
      `INSERT INTO inspection_records
         (tenant_id, inspection_no, production_order_id, inspector_id,
          inspection_date, qty_inspected, qty_passed, qty_failed, status, created_by, updated_by)
       VALUES (?,?,?,?,?,?,0,0,'draft',?,?)`,
      [
        this.tenantId, inspectionNo, order.id, this.userId,
        params.inspectionDate, params.qtyInspected, this.userId, this.userId,
      ],
    );
    return { id: Number(result.insertId), inspectionNo };
  }

  async listProductionOrderOptions(params: {
    keyword?: string;
    limit: number;
  }): Promise<Array<{
    id: number;
    workOrderNo: string;
    skuName: string;
    salesOrderNo: string;
    status: string;
    plannedStart: string | null;
    plannedEnd: string | null;
  }>> {
    const conds = ['po.tenant_id = ?', "po.status <> 'cancelled'"];
    const queryParams: unknown[] = [this.tenantId];
    const keyword = params.keyword?.trim();

    if (keyword) {
      const like = `%${keyword}%`;
      conds.push('(po.work_order_no LIKE ? OR s.name LIKE ? OR so.order_no LIKE ?)');
      queryParams.push(like, like, like);
    }

    const where = conds.join(' AND ');
    const rows = await AppDataSource.query<Array<{
      id: number;
      work_order_no: string;
      sku_name: string;
      sales_order_no: string;
      status: string;
      planned_start: string | null;
      planned_end: string | null;
    }>>(
      `SELECT po.id,
              po.work_order_no,
              s.name AS sku_name,
              so.order_no AS sales_order_no,
              po.status,
              po.planned_start,
              po.planned_end
       FROM production_orders po
       INNER JOIN skus s ON s.id = po.sku_id
       INNER JOIN sales_orders so ON so.id = po.sales_order_id
       WHERE ${where}
       ORDER BY
         CASE po.status
           WHEN 'in_progress' THEN 1
           WHEN 'scheduled' THEN 2
           WHEN 'pending' THEN 3
           WHEN 'completed' THEN 4
           ELSE 5
         END,
         po.updated_at DESC
       LIMIT ?`,
      [...queryParams, params.limit],
    );

    return rows.map((row) => ({
      id: row.id,
      workOrderNo: row.work_order_no,
      skuName: row.sku_name,
      salesOrderNo: row.sales_order_no,
      status: row.status,
      plannedStart: row.planned_start,
      plannedEnd: row.planned_end,
    }));
  }

  async listInspectionOptions(params: {
    keyword?: string;
    limit: number;
  }): Promise<Array<{
    id: number;
    inspectionNo: string;
    inspectionDate: string;
    workOrderNo: string;
    skuName: string;
    status: string;
  }>> {
    const conds = ['ir.tenant_id = ?'];
    const queryParams: unknown[] = [this.tenantId];
    const keyword = params.keyword?.trim();

    if (keyword) {
      const like = `%${keyword}%`;
      conds.push('(ir.inspection_no LIKE ? OR po.work_order_no LIKE ? OR s.name LIKE ?)');
      queryParams.push(like, like, like);
    }

    const where = conds.join(' AND ');
    const rows = await AppDataSource.query<Array<{
      id: number;
      inspection_no: string;
      inspection_date: string;
      work_order_no: string;
      sku_name: string;
      status: string;
    }>>(
      `SELECT ir.id,
              ir.inspection_no,
              ir.inspection_date,
              po.work_order_no,
              s.name AS sku_name,
              ir.status
       FROM inspection_records ir
       INNER JOIN production_orders po ON po.id = ir.production_order_id
       INNER JOIN skus s ON s.id = po.sku_id
       WHERE ${where}
       ORDER BY ir.id DESC
       LIMIT ?`,
      [...queryParams, params.limit],
    );

    return rows.map((row) => ({
      id: row.id,
      inspectionNo: row.inspection_no,
      inspectionDate: row.inspection_date,
      workOrderNo: row.work_order_no,
      skuName: row.sku_name,
      status: row.status,
    }));
  }

  // ── 录入质量问题 ─────────────────────────────────────────

  async recordQualityIssue(params: {
    inspectionNo: string;
    componentName: string;
    issueTypes: string[];
    severity: 'minor' | 'normal' | 'severe';
    description?: string;
    images?: string[];
  }): Promise<{ issueId: number }> {
    const [inspection] = await AppDataSource.query<Array<{ id: number }>>(
      `SELECT id
       FROM inspection_records
       WHERE tenant_id = ? AND inspection_no = ?
       ORDER BY id DESC
       LIMIT 1`,
      [this.tenantId, params.inspectionNo],
    );
    if (!inspection) throw AppError.notFound('验货单号不存在');

    // 校验验货单存在且属于本租户
    const result = await AppDataSource.query(
      `INSERT INTO quality_issues
         (tenant_id, inspection_id, component_name, issue_types, severity,
          description, images, created_by, updated_by)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [
        this.tenantId, inspection.id, params.componentName,
        JSON.stringify(params.issueTypes), params.severity,
        params.description ?? null,
        params.images ? JSON.stringify(params.images) : null,
        this.userId, this.userId,
      ],
    );

    // 更新验货单不合格数量
    await AppDataSource.query(
      `UPDATE inspection_records
       SET qty_failed = qty_failed + 1, updated_by = ?
       WHERE id = ? AND tenant_id = ?`,
      [this.userId, inspection.id, this.tenantId],
    );

    return { issueId: Number(result.insertId) };
  }

  // ── 完成验货（计算合格数量） ──────────────────────────────

  async completeInspection(inspectionId: number, qtyPassed: string): Promise<void> {
    const [inspection] = await AppDataSource.query<Array<{
      qty_inspected: string;
      status: 'draft' | 'completed';
    }>>(
      `SELECT qty_inspected, status
       FROM inspection_records
       WHERE id = ? AND tenant_id = ?
       LIMIT 1`,
      [inspectionId, this.tenantId],
    );
    if (!inspection) {
      throw AppError.notFound('验货单不存在');
    }
    if (inspection.status === 'completed') {
      throw AppError.badRequest('验货单已完成，不能重复完成');
    }
    if (new Decimal(qtyPassed).gt(new Decimal(inspection.qty_inspected))) {
      throw AppError.badRequest('qtyPassed 不能超过 qtyInspected');
    }

    await AppDataSource.query(
      `UPDATE inspection_records
       SET status = 'completed', qty_passed = ?, updated_by = ?
       WHERE id = ? AND tenant_id = ?`,
      [qtyPassed, this.userId, inspectionId, this.tenantId],
    );
  }

  // ── 溯源链查询（核心功能）────────────────────────────────

  /**
   * 查询成品完整溯源链
   * 溯源链：成品 → 各部件 → 物料批次/缸号 → 工序 → 工人
   *
   * 数据来源：traceability_records + task_completions + inventory_transactions
   */
  async getTraceabilityChain(productionOrderId: number): Promise<TraceabilityChain> {
    // 1. 查询生产工单基本信息
    const [order] = await AppDataSource.query<Array<{
      id: number; work_order_no: string; sku_name: string;
      sales_order_no: string; customer_name: string;
    }>>(
      `SELECT po.id, po.work_order_no, s.name AS sku_name,
              so.order_no AS sales_order_no, c.name AS customer_name
       FROM production_orders po
       INNER JOIN skus s ON s.id = po.sku_id
       INNER JOIN sales_orders so ON so.id = po.sales_order_id
       INNER JOIN customers c ON c.id = so.customer_id
      WHERE po.id = ? AND po.tenant_id = ? LIMIT 1`,
      [productionOrderId, this.tenantId],
    );
    if (!order) {
      throw AppError.notFound('生产工单不存在', ResponseCode.PRODUCTION_ORDER_NOT_FOUND);
    }

    // 2. 查询溯源链记录
    const traceRows = await AppDataSource.query<Array<{
      id: number;
      component_barcode: string | null;
      component_name: string | null;
      step_name: string;
      step_no: number;
      real_name: string;
      worker_id: number;
      operation_time: Date;
      sku_name: string | null;
      dye_lot_no: string | null;
      has_scan_record: number;
    }>>(
      `SELECT tr.id, tr.component_barcode, tr.component_name,
              ps.step_name, ps.step_no,
              u.real_name, tr.worker_id, tr.operation_time,
              s.name AS sku_name, tr.dye_lot_no, tr.has_scan_record
       FROM traceability_records tr
       INNER JOIN process_steps ps ON ps.id = tr.process_step_id
       INNER JOIN users u ON u.id = tr.worker_id
       LEFT JOIN skus s ON s.id = tr.sku_id
       WHERE tr.production_order_id = ? AND tr.tenant_id = ?
       ORDER BY ps.step_no, tr.operation_time`,
      [productionOrderId, this.tenantId],
    );

    // 3. 组装溯源链
    const components: ComponentTrace[] = traceRows.map((r) => ({
      componentBarcode: r.component_barcode,
      componentName: r.component_name,
      processStepName: r.step_name,
      stepNo: r.step_no,
      workerName: r.real_name,
      workerId: r.worker_id,
      operationTime: r.operation_time,
      skuName: r.sku_name,
      dyeLotNo: r.dye_lot_no,
      hasScanRecord: Boolean(r.has_scan_record),
      missingDataNote: r.has_scan_record ? null : '工序数据缺失，仅可追溯至物料批次',
    }));

    // 4. 汇总唯一缸号
    const dyeLots = [...new Set(
      components.filter((c) => c.dyeLotNo).map((c) => c.dyeLotNo as string),
    )];

    const chainSummary = {
      totalComponents: components.length,
      withScanRecord: components.filter((c) => c.hasScanRecord).length,
      dyeLots,
    };

    return {
      productionOrderId,
      workOrderNo: order.work_order_no,
      skuName: order.sku_name,
      salesOrderNo: order.sales_order_no,
      customerName: order.customer_name,
      components,
      summary: chainSummary,
      aiAnalysis: this.buildAiAnalysis(components, chainSummary),
    };
  }

  // ── 质量统计分析 ──────────────────────────────────────────

  async getQualityStats(periodDays: 7 | 30 | 90): Promise<QualityStats> {
    const [totals] = await AppDataSource.query<Array<{
      total_inspected: string; total_failed: string;
    }>>(
      `SELECT COALESCE(SUM(qty_inspected), 0) AS total_inspected,
              COALESCE(SUM(qty_failed), 0) AS total_failed
       FROM inspection_records
       WHERE tenant_id = ? AND status = 'completed'
         AND inspection_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)`,
      [this.tenantId, periodDays],
    );

    const totalInspected = Number(totals?.total_inspected ?? 0);
    const totalFailed = Number(totals?.total_failed ?? 0);
    const failRate = totalInspected > 0
      ? ((totalFailed / totalInspected) * 100).toFixed(2) + '%'
      : '0%';

    const [issueCoverage] = await AppDataSource.query<Array<{
      traced_issue_count: string;
      total_issue_count: string;
    }>>(
      `SELECT
         COUNT(*) AS total_issue_count,
         SUM(
           CASE
             WHEN EXISTS (
               SELECT 1
               FROM inspection_records ir
               INNER JOIN traceability_records tr
                 ON tr.production_order_id = ir.production_order_id
                AND tr.tenant_id = qi.tenant_id
               WHERE ir.id = qi.inspection_id
                 AND ir.tenant_id = qi.tenant_id
               LIMIT 1
             ) THEN 1 ELSE 0
           END
         ) AS traced_issue_count
       FROM quality_issues qi
       WHERE qi.tenant_id = ?
         AND qi.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)`,
      [this.tenantId, periodDays],
    );

    const tracedIssueCount = Number(issueCoverage?.traced_issue_count ?? 0);
    const totalIssueCount = Number(issueCoverage?.total_issue_count ?? 0);
    const traceCompletionRate = totalIssueCount > 0
      ? `${((tracedIssueCount / totalIssueCount) * 100).toFixed(1)}%`
      : '0.0%';

    // 趋势数据（按日聚合）
    const trendData = await AppDataSource.query<Array<{
      date: string; fail_count: string; inspect_count: string;
    }>>(
      `SELECT DATE(inspection_date) AS date,
              SUM(qty_failed) AS fail_count,
              SUM(qty_inspected) AS inspect_count
       FROM inspection_records
       WHERE tenant_id = ? AND status = 'completed'
         AND inspection_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
       GROUP BY DATE(inspection_date)
       ORDER BY date`,
      [this.tenantId, periodDays],
    );

    // 问题类型分布（展开 JSON 数组）
    const issueTypeRows = await AppDataSource.query<Array<{
      issue_type: string; cnt: number;
    }>>(
      `SELECT jt.issue_type, COUNT(*) AS cnt
       FROM quality_issues qi,
            JSON_TABLE(qi.issue_types, '$[*]' COLUMNS (issue_type VARCHAR(50) PATH '$')) AS jt
       WHERE qi.tenant_id = ?
         AND qi.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
       GROUP BY jt.issue_type
       ORDER BY cnt DESC`,
      [this.tenantId, periodDays],
    );

    const totalIssues = issueTypeRows.reduce((s, r) => s + Number(r.cnt), 0);
    const issueTypeBreakdown = issueTypeRows.map((r) => ({
      type: r.issue_type,
      count: Number(r.cnt),
      pct: totalIssues > 0 ? ((Number(r.cnt) / totalIssues) * 100).toFixed(1) + '%' : '0%',
    }));

    // TOP5 高频问题：使用单次 JOIN 查询替代原来的 N+1（5 条 × 2 次子查询 = 10 次）
    // GROUP_CONCAT 在单条 SQL 内聚合关联工人和工序，无额外往返
    const top5Rows = await AppDataSource.query<Array<{
      component_name: string;
      cnt: string;
      order_cnt: string;
      workers: string | null;
      processes: string | null;
    }>>(
      `SELECT
         qi.component_name,
         COUNT(*) AS cnt,
         COUNT(DISTINCT po.sales_order_id) AS order_cnt,
         GROUP_CONCAT(DISTINCT u.real_name ORDER BY u.real_name SEPARATOR ',') AS workers,
         GROUP_CONCAT(DISTINCT ps.step_name ORDER BY ps.step_name SEPARATOR ',') AS processes
       FROM quality_issues qi
       INNER JOIN inspection_records ir ON ir.id = qi.inspection_id
       INNER JOIN production_orders po ON po.id = ir.production_order_id
       LEFT JOIN traceability_records tr ON tr.production_order_id = po.id
       LEFT JOIN users u ON u.id = tr.worker_id
       LEFT JOIN process_steps ps ON ps.id = tr.process_step_id
       WHERE qi.tenant_id = ?
         AND qi.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
       GROUP BY qi.component_name
       ORDER BY cnt DESC LIMIT 5`,
      [this.tenantId, periodDays],
    );

    const top5Issues = top5Rows.map((r) => ({
      description: r.component_name,
      count: Number(r.cnt),
      orderCount: Number(r.order_cnt),
      relatedWorkers: r.workers ? r.workers.split(',').slice(0, 5) : [],
      relatedProcesses: r.processes ? r.processes.split(',').slice(0, 5) : [],
    }));

    return {
      periodDays,
      totalInspected,
      totalFailed,
      failRate,
      traceCompletionRate,
      tracedIssueCount,
      totalIssueCount,
      trendData: trendData.map((r) => ({
        date: r.date,
        failCount: Number(r.fail_count),
        inspectCount: Number(r.inspect_count),
      })),
      issueTypeBreakdown,
      top5Issues,
    };
  }

  // ── 质量问题详情 ──────────────────────────────────────────

  async getIssueDetail(issueId: number): Promise<{
    id: number;
    inspectionId: number;
    inspectionNo: string;
    inspectionDate: string;
    productionOrderId: number;
    workOrderNo: string;
    skuName: string;
    componentName: string;
    issueTypes: string[];
    severity: string;
    description: string | null;
    images: string[] | null;
    createdAt: Date;
  }> {
    const [row] = await AppDataSource.query<Array<{
      id: number;
      inspection_id: number;
      inspection_no: string;
      inspection_date: string;
      production_order_id: number;
      work_order_no: string;
      sku_name: string;
      component_name: string;
      issue_types: string;
      severity: string;
      description: string | null;
      images: string | null;
      created_at: Date;
    }>>(
      `SELECT qi.id, qi.inspection_id,
              ir.inspection_no, ir.inspection_date,
              po.id AS production_order_id, po.work_order_no,
              s.name AS sku_name,
              qi.component_name, qi.issue_types, qi.severity,
              qi.description, qi.images, qi.created_at
       FROM quality_issues qi
       INNER JOIN inspection_records ir ON ir.id = qi.inspection_id
       INNER JOIN production_orders po ON po.id = ir.production_order_id
       INNER JOIN skus s ON s.id = po.sku_id
       WHERE qi.id = ? AND qi.tenant_id = ? LIMIT 1`,
      [issueId, this.tenantId],
    );
    if (!row) throw AppError.notFound('质量问题不存在');

    return {
      id: row.id,
      inspectionId: row.inspection_id,
      inspectionNo: row.inspection_no,
      inspectionDate: row.inspection_date,
      productionOrderId: row.production_order_id,
      workOrderNo: row.work_order_no,
      skuName: row.sku_name,
      componentName: row.component_name,
      issueTypes: this.parseJsonStringArray(row.issue_types),
      severity: row.severity,
      description: row.description,
      images: this.parseOptionalJsonStringArray(row.images),
      createdAt: row.created_at,
    };
  }

  // ── 质量问题列表（分页 + 筛选）────────────────────────────

  async listIssues(params: {
    page: number;
    pageSize: number;
    severity?: 'minor' | 'normal' | 'severe';
    issueType?: string;
  }): Promise<{ list: Array<{
    id: number; inspectionId: number; inspectionNo: string;
    productionOrderId: number; productionOrderNo: string;
    componentName: string; issueTypes: string[]; severity: string;
    description: string | null; images: string[] | null; createdAt: Date;
  }>; total: number }> {
    const conds = ['qi.tenant_id = ?'];
    const p: unknown[] = [this.tenantId];

    if (params.severity) {
      conds.push('qi.severity = ?');
      p.push(params.severity);
    }
    if (params.issueType) {
      // JSON_SEARCH 检测 issueTypes 数组中是否包含指定类型
      conds.push('JSON_SEARCH(qi.issue_types, \'one\', ?) IS NOT NULL');
      p.push(params.issueType);
    }

    const where = conds.join(' AND ');
    const offset = (params.page - 1) * params.pageSize;

    const [rows, countRows] = await Promise.all([
      AppDataSource.query<Array<{
        id: number; inspection_id: number; inspection_no: string;
        production_order_id: number; production_order_no: string;
        component_name: string; issue_types: string; severity: string;
        description: string | null; images: string | null; created_at: Date;
      }>>(
        `SELECT qi.id, qi.inspection_id, ir.inspection_no,
                ir.production_order_id, po.work_order_no AS production_order_no,
                qi.component_name, qi.issue_types, qi.severity,
                qi.description, qi.images, qi.created_at
         FROM quality_issues qi
         INNER JOIN inspection_records ir ON ir.id = qi.inspection_id
         INNER JOIN production_orders po ON po.id = ir.production_order_id
         WHERE ${where}
         ORDER BY qi.id DESC
         LIMIT ? OFFSET ?`,
        [...p, params.pageSize, offset],
      ),
      AppDataSource.query<Array<{ total: number }>>(
        `SELECT COUNT(*) AS total FROM quality_issues qi WHERE ${where}`, p,
      ),
    ]);

    const list = rows.map((r) => ({
      id: r.id,
      inspectionId: r.inspection_id,
      inspectionNo: r.inspection_no,
      productionOrderId: r.production_order_id,
      productionOrderNo: r.production_order_no,
      componentName: r.component_name,
      issueTypes: this.parseJsonStringArray(r.issue_types),
      severity: r.severity,
      description: r.description,
      images: this.parseOptionalJsonStringArray(r.images),
      createdAt: r.created_at,
    }));

    return { list, total: Number(countRows[0]?.total ?? 0) };
  }

  // ── 验货单列表 ────────────────────────────────────────────

  async listInspections(params: {
    status?: string; productionOrderId?: number; page: number; pageSize: number;
  }) {
    const conds = ['ir.tenant_id = ?'];
    const p: unknown[] = [this.tenantId];
    if (params.status) { conds.push('ir.status = ?'); p.push(params.status); }
    if (params.productionOrderId) {
      conds.push('ir.production_order_id = ?');
      p.push(params.productionOrderId);
    }

    const where = conds.join(' AND ');
    const offset = (params.page - 1) * params.pageSize;

    const [list, countRows] = await Promise.all([
      AppDataSource.query(
        `SELECT ir.*, po.work_order_no, s.name AS skuName, u.real_name AS inspectorName
         FROM inspection_records ir
         INNER JOIN production_orders po ON po.id = ir.production_order_id
         INNER JOIN skus s ON s.id = po.sku_id
         INNER JOIN users u ON u.id = ir.inspector_id
         WHERE ${where} ORDER BY ir.id DESC LIMIT ? OFFSET ?`,
        [...p, params.pageSize, offset],
      ),
      AppDataSource.query<Array<{ total: number }>>(
        `SELECT COUNT(*) AS total FROM inspection_records ir WHERE ${where}`, p,
      ),
    ]);

    return { list, total: Number(countRows[0]?.total ?? 0) };
  }
}
