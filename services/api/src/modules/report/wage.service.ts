import { AppDataSource } from '../../config/database';

/**
 * 工资报表行结构
 */
export interface WageReportRow {
  userId: number;
  userName: string;
  workerGrade: string;
  stepName: string;
  qty: number;
  unitPrice: string;
  subtotal: string;
  reportDate: string;
}

/**
 * 工资报表查询筛选条件
 */
export interface WageReportFilter {
  page: number;
  pageSize: number;
  dateFrom?: string;   // YYYY-MM-DD
  dateTo?: string;     // YYYY-MM-DD
  userId?: number;
  workerGrade?: 'skilled' | 'apprentice';
}

export interface WageTaskReportFilter extends WageReportFilter {
  productionOrderId?: number;
  taskId?: number;
}

/**
 * 工资导出筛选（无分页，上限5000条）
 */
export interface WageExportFilter {
  dateFrom?: string;
  dateTo?: string;
  userId?: number;
  workerGrade?: 'skilled' | 'apprentice';
}

export interface WageTaskReportRow {
  reportId: number;
  reportNo: string;
  reportDate: string;
  productionOrderId: number | null;
  orderNo: string | null;
  taskId: number | null;
  taskNo: string | null;
  taskStatus: string | null;
  userId: number;
  userName: string;
  workerGrade: string;
  processStepId: number | null;
  stepName: string;
  qtyCompleted: string;
  qtyQualified: string;
  qtyDefective: string;
  workHours: string;
  unitPrice: string;
  subtotal: string;
}

export class WageService {
  private readonly tenantId: number;
  private readonly currentUserId: number;

  constructor(ctx: { tenantId: number; userId: number }) {
    this.tenantId = ctx.tenantId;
    this.currentUserId = ctx.userId;
  }

  private mapWageReportRow(row: Record<string, unknown>): WageReportRow {
    return {
      userId: Number(row['userId']),
      userName: String(row['userName'] ?? ''),
      workerGrade: String(row['workerGrade'] ?? ''),
      stepName: String(row['stepName'] ?? ''),
      qty: Number(row['qty'] ?? 0),
      unitPrice: String(row['unitPrice'] ?? '0'),
      subtotal: String(row['subtotal'] ?? '0'),
      reportDate: String(row['reportDate'] ?? ''),
    };
  }

  private mapTaskWageReportRow(row: Record<string, unknown>): WageTaskReportRow {
    return {
      reportId: Number(row['reportId']),
      reportNo: String(row['reportNo'] ?? ''),
      reportDate: String(row['reportDate'] ?? ''),
      productionOrderId: row['productionOrderId'] != null ? Number(row['productionOrderId']) : null,
      orderNo: row['orderNo'] != null ? String(row['orderNo']) : null,
      taskId: row['taskId'] != null ? Number(row['taskId']) : null,
      taskNo: row['taskNo'] != null ? String(row['taskNo']) : null,
      taskStatus: row['taskStatus'] != null ? String(row['taskStatus']) : null,
      userId: Number(row['userId']),
      userName: String(row['userName'] ?? ''),
      workerGrade: String(row['workerGrade'] ?? ''),
      processStepId: row['processStepId'] != null ? Number(row['processStepId']) : null,
      stepName: String(row['stepName'] ?? ''),
      qtyCompleted: String(row['qtyCompleted'] ?? '0'),
      qtyQualified: String(row['qtyQualified'] ?? '0'),
      qtyDefective: String(row['qtyDefective'] ?? '0'),
      workHours: String(row['workHours'] ?? '0'),
      unitPrice: String(row['unitPrice'] ?? '0'),
      subtotal: String(row['subtotal'] ?? '0'),
    };
  }

  private async resolveSchema(): Promise<{
    workerColumn: 'worker_id' | 'user_id';
    stepColumn: 'process_step_id' | 'step_id';
    dateColumn: 'work_date' | 'report_date';
    qtyColumn: 'qty_completed' | 'qty';
  }> {
    const [row] = await AppDataSource.query<Array<{ cnt: string }>>(
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
      };
    }

    return {
      workerColumn: 'user_id',
      stepColumn: 'step_id',
      dateColumn: 'report_date',
      qtyColumn: 'qty',
    };
  }

  private async supportsTaskReport(): Promise<boolean> {
    const [row] = await AppDataSource.query<Array<{ cnt: string }>>(
      `SELECT COUNT(*) AS cnt
       FROM information_schema.columns
       WHERE table_schema = DATABASE()
         AND table_name = 'work_reports'
         AND column_name IN ('task_id', 'production_order_id', 'work_hours', 'qty_qualified', 'qty_defective')`,
    );

    return Number(row?.cnt ?? 0) >= 5;
  }

  /**
   * 管理员工资报表
   * 联表：work_reports → process_steps ← users
   *
   * 实际表结构来自迁移 V2_schema_fixes.sql：
   *   worker_id / process_step_id / qty_completed / work_date / unit_wage / wage_amount
   */
  async getWageReport(filter: WageReportFilter): Promise<[WageReportRow[], number]> {
    const { page, pageSize, dateFrom, dateTo, userId, workerGrade } = filter;
    const schema = await this.resolveSchema();

    // 构建 WHERE 子句（位置参数 ? 防注入）
    const conditions: string[] = ['wr.tenant_id = ?', "wr.status IN ('confirmed', 'settled')"];
    const params: unknown[] = [this.tenantId];

    if (dateFrom) {
      conditions.push(`wr.${schema.dateColumn} >= ?`);
      params.push(dateFrom);
    }
    if (dateTo) {
      conditions.push(`wr.${schema.dateColumn} <= ?`);
      params.push(dateTo);
    }
    if (userId !== undefined) {
      conditions.push(`wr.${schema.workerColumn} = ?`);
      params.push(userId);
    }
    if (workerGrade) {
      conditions.push('u.skill_level = ?');
      params.push(workerGrade);
    }

    const where = conditions.join(' AND ');

    // 计算总数
    const countSql = `
      SELECT COUNT(*) AS cnt
      FROM work_reports wr
      INNER JOIN process_steps ps  ON ps.id = wr.${schema.stepColumn}
      INNER JOIN users u           ON u.id  = wr.${schema.workerColumn}
      WHERE ${where}
    `;
    const countResult = await AppDataSource.query(countSql, params);
    const total: number = Number(countResult[0]?.cnt ?? 0);

    if (total === 0) {
      return [[], 0];
    }

    // 分页列表查询
    const listSql = `
      SELECT
        u.id                                          AS userId,
        u.username                                    AS userName,
        COALESCE(u.skill_level, '')                   AS workerGrade,
        ps.step_name                                  AS stepName,
        wr.${schema.qtyColumn}                        AS qty,
        COALESCE(wr.unit_wage, 0)                     AS unitPrice,
        COALESCE(wr.wage_amount, 0)                   AS subtotal,
        DATE_FORMAT(wr.${schema.dateColumn}, '%Y-%m-%d') AS reportDate
      FROM work_reports wr
      INNER JOIN process_steps ps  ON ps.id = wr.${schema.stepColumn}
      INNER JOIN users u           ON u.id  = wr.${schema.workerColumn}
      WHERE ${where}
      ORDER BY wr.${schema.dateColumn} DESC, wr.id DESC
      LIMIT ? OFFSET ?
    `;

    const rows = await AppDataSource.query(
      listSql,
      [...params, pageSize, (page - 1) * pageSize],
    );

    return [(rows as Record<string, unknown>[]).map((row) => this.mapWageReportRow(row)), total];
  }

  /**
   * 当前用户自查工资（强制锁定 userId 为当前登录人）
   */
  async getMyWages(filter: Omit<WageReportFilter, 'userId' | 'workerGrade'>): Promise<[WageReportRow[], number]> {
    return this.getWageReport({
      ...filter,
      userId: this.currentUserId,
    });
  }

  async getTaskWageReport(filter: WageTaskReportFilter): Promise<[WageTaskReportRow[], number]> {
    const { page, pageSize, dateFrom, dateTo, userId, workerGrade, productionOrderId, taskId } = filter;
    const [schema, taskReportReady] = await Promise.all([
      this.resolveSchema(),
      this.supportsTaskReport(),
    ]);

    if (!taskReportReady) {
      return [[], 0];
    }

    const conditions: string[] = ['wr.tenant_id = ?', "wr.status IN ('confirmed', 'settled')"];
    const params: unknown[] = [this.tenantId];

    if (dateFrom) {
      conditions.push(`wr.${schema.dateColumn} >= ?`);
      params.push(dateFrom);
    }
    if (dateTo) {
      conditions.push(`wr.${schema.dateColumn} <= ?`);
      params.push(dateTo);
    }
    if (userId !== undefined) {
      conditions.push(`wr.${schema.workerColumn} = ?`);
      params.push(userId);
    }
    if (workerGrade) {
      conditions.push('u.skill_level = ?');
      params.push(workerGrade);
    }
    if (productionOrderId !== undefined) {
      conditions.push('wr.production_order_id = ?');
      params.push(productionOrderId);
    }
    if (taskId !== undefined) {
      conditions.push('wr.task_id = ?');
      params.push(taskId);
    }

    const where = conditions.join(' AND ');

    const countSql = `
      SELECT COUNT(*) AS cnt
      FROM work_reports wr
      INNER JOIN users u
        ON u.id = wr.${schema.workerColumn}
       AND u.tenant_id = wr.tenant_id
      LEFT JOIN process_steps ps
        ON ps.id = wr.${schema.stepColumn}
      LEFT JOIN production_tasks pt
        ON pt.id = wr.task_id
       AND pt.tenant_id = wr.tenant_id
      LEFT JOIN production_orders po
        ON po.id = wr.production_order_id
       AND po.tenant_id = wr.tenant_id
      WHERE ${where}
    `;
    const countResult = await AppDataSource.query(countSql, params);
    const total: number = Number(countResult[0]?.cnt ?? 0);

    if (total === 0) {
      return [[], 0];
    }

    const listSql = `
      SELECT
        wr.id AS reportId,
        wr.report_no AS reportNo,
        DATE_FORMAT(wr.${schema.dateColumn}, '%Y-%m-%d') AS reportDate,
        wr.production_order_id AS productionOrderId,
        po.work_order_no AS orderNo,
        wr.task_id AS taskId,
        pt.task_no AS taskNo,
        pt.status AS taskStatus,
        u.id AS userId,
        u.username AS userName,
        COALESCE(u.skill_level, '') AS workerGrade,
        ps.id AS processStepId,
        COALESCE(ps.step_name, '') AS stepName,
        wr.${schema.qtyColumn} AS qtyCompleted,
        COALESCE(wr.qty_qualified, wr.${schema.qtyColumn}) AS qtyQualified,
        COALESCE(wr.qty_defective, 0) AS qtyDefective,
        COALESCE(wr.work_hours, 0) AS workHours,
        COALESCE(wr.unit_wage, 0) AS unitPrice,
        COALESCE(wr.wage_amount, 0) AS subtotal
      FROM work_reports wr
      INNER JOIN users u
        ON u.id = wr.${schema.workerColumn}
       AND u.tenant_id = wr.tenant_id
      LEFT JOIN process_steps ps
        ON ps.id = wr.${schema.stepColumn}
      LEFT JOIN production_tasks pt
        ON pt.id = wr.task_id
       AND pt.tenant_id = wr.tenant_id
      LEFT JOIN production_orders po
        ON po.id = wr.production_order_id
       AND po.tenant_id = wr.tenant_id
      WHERE ${where}
      ORDER BY wr.${schema.dateColumn} DESC, wr.id DESC
      LIMIT ? OFFSET ?
    `;

    const rows = await AppDataSource.query(
      listSql,
      [...params, pageSize, (page - 1) * pageSize],
    );

    return [(rows as Record<string, unknown>[]).map((row) => this.mapTaskWageReportRow(row)), total];
  }

  /**
   * 导出工资报表（无分页，最多5000条）
   */
  async exportWages(filter: WageExportFilter): Promise<WageReportRow[]> {
    const { dateFrom, dateTo, userId, workerGrade } = filter;
    const schema = await this.resolveSchema();

    const conditions: string[] = ['wr.tenant_id = ?', "wr.status IN ('confirmed', 'settled')"];
    const params: unknown[] = [this.tenantId];

    if (dateFrom) {
      conditions.push(`wr.${schema.dateColumn} >= ?`);
      params.push(dateFrom);
    }
    if (dateTo) {
      conditions.push(`wr.${schema.dateColumn} <= ?`);
      params.push(dateTo);
    }
    if (userId !== undefined) {
      conditions.push(`wr.${schema.workerColumn} = ?`);
      params.push(userId);
    }
    if (workerGrade) {
      conditions.push('u.skill_level = ?');
      params.push(workerGrade);
    }

    const where = conditions.join(' AND ');

    const rows = await AppDataSource.query(
      `SELECT
         u.id                                          AS userId,
         u.username                                    AS userName,
         COALESCE(u.skill_level, '')                   AS workerGrade,
         ps.step_name                                  AS stepName,
         wr.${schema.qtyColumn}                        AS qty,
         COALESCE(wr.unit_wage, 0)                     AS unitPrice,
         COALESCE(wr.wage_amount, 0)                   AS subtotal,
         DATE_FORMAT(wr.${schema.dateColumn}, '%Y-%m-%d') AS reportDate
       FROM work_reports wr
       INNER JOIN process_steps ps  ON ps.id = wr.${schema.stepColumn}
       INNER JOIN users u           ON u.id  = wr.${schema.workerColumn}
       WHERE ${where}
       ORDER BY wr.${schema.dateColumn} DESC, wr.id DESC
       LIMIT 5000`,
      params,
    );

    return (rows as Record<string, unknown>[]).map((row) => this.mapWageReportRow(row));
  }
}
