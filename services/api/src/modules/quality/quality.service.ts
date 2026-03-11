import { AppDataSource } from '../../config/database';
import { TenantContext } from '../../shared/BaseRepository';
import { AppError } from '../../shared/AppError';

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

  // ── 创建验货单 ────────────────────────────────────────────

  async createInspection(params: {
    productionOrderId: number;
    inspectionDate: string;
    qtyInspected: string;
  }): Promise<{ id: number; inspectionNo: string }> {
    const inspectionNo = `QC${Date.now()}${Math.floor(Math.random() * 999).toString().padStart(3, '0')}`;

    const result = await AppDataSource.query(
      `INSERT INTO inspection_records
         (tenant_id, inspection_no, production_order_id, inspector_id,
          inspection_date, qty_inspected, qty_passed, qty_failed, status, created_by, updated_by)
       VALUES (?,?,?,?,?,?,0,0,'draft',?,?)`,
      [
        this.tenantId, inspectionNo, params.productionOrderId, this.userId,
        params.inspectionDate, params.qtyInspected, this.userId, this.userId,
      ],
    );
    return { id: Number(result.insertId), inspectionNo };
  }

  // ── 录入质量问题 ─────────────────────────────────────────

  async recordQualityIssue(params: {
    inspectionId: number;
    componentName: string;
    issueTypes: string[];
    severity: 'minor' | 'normal' | 'severe';
    description?: string;
    images?: string[];
  }): Promise<{ issueId: number }> {
    // 校验验货单存在且属于本租户
    const [insp] = await AppDataSource.query<Array<{ id: number; qty_failed: number }>>(
      'SELECT id, qty_failed FROM inspection_records WHERE id = ? AND tenant_id = ? LIMIT 1',
      [params.inspectionId, this.tenantId],
    );
    if (!insp) throw AppError.notFound('验货单不存在');

    const result = await AppDataSource.query(
      `INSERT INTO quality_issues
         (tenant_id, inspection_id, component_name, issue_types, severity,
          description, images, created_by, updated_by)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [
        this.tenantId, params.inspectionId, params.componentName,
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
      [this.userId, params.inspectionId, this.tenantId],
    );

    return { issueId: Number(result.insertId) };
  }

  // ── 完成验货（计算合格数量） ──────────────────────────────

  async completeInspection(inspectionId: number, qtyPassed: string): Promise<void> {
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
    if (!order) throw AppError.notFound('生产工单不存在');

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

    return {
      productionOrderId,
      workOrderNo: order.work_order_no,
      skuName: order.sku_name,
      salesOrderNo: order.sales_order_no,
      customerName: order.customer_name,
      components,
      summary: {
        totalComponents: components.length,
        withScanRecord: components.filter((c) => c.hasScanRecord).length,
        dyeLots,
      },
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
      issueTypes: row.issue_types ? JSON.parse(row.issue_types) as string[] : [],
      severity: row.severity,
      description: row.description,
      images: row.images ? JSON.parse(row.images) as string[] : null,
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
    componentName: string; issueTypes: string[]; severity: string;
    description: string | null; createdAt: Date;
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
        component_name: string; issue_types: string; severity: string;
        description: string | null; created_at: Date;
      }>>(
        `SELECT qi.id, qi.inspection_id, ir.inspection_no,
                qi.component_name, qi.issue_types, qi.severity,
                qi.description, qi.created_at
         FROM quality_issues qi
         INNER JOIN inspection_records ir ON ir.id = qi.inspection_id
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
      componentName: r.component_name,
      issueTypes: r.issue_types ? JSON.parse(r.issue_types) as string[] : [],
      severity: r.severity,
      description: r.description,
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
