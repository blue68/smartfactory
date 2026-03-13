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

/**
 * 工资导出筛选（无分页，上限5000条）
 */
export interface WageExportFilter {
  dateFrom?: string;
  dateTo?: string;
  userId?: number;
  workerGrade?: 'skilled' | 'apprentice';
}

export class WageService {
  private readonly tenantId: number;
  private readonly currentUserId: number;

  constructor(ctx: { tenantId: number; userId: number }) {
    this.tenantId = ctx.tenantId;
    this.currentUserId = ctx.userId;
  }

  /**
   * 管理员工资报表
   * 联表：work_reports → process_steps → process_wages ← users
   *
   * work_reports 表结构假设：
   *   id, tenant_id, user_id, step_id, qty, report_date, ...
   */
  async getWageReport(filter: WageReportFilter): Promise<[WageReportRow[], number]> {
    const { page, pageSize, dateFrom, dateTo, userId, workerGrade } = filter;

    // 构建 WHERE 子句（位置参数 ? 防注入）
    const conditions: string[] = ['wr.tenant_id = ?'];
    const params: unknown[] = [this.tenantId];

    if (dateFrom) {
      conditions.push('wr.report_date >= ?');
      params.push(dateFrom);
    }
    if (dateTo) {
      conditions.push('wr.report_date <= ?');
      params.push(dateTo);
    }
    if (userId !== undefined) {
      conditions.push('wr.user_id = ?');
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
      INNER JOIN process_steps ps  ON ps.id = wr.step_id
      INNER JOIN users u           ON u.id  = wr.user_id
      LEFT  JOIN process_wages pw  ON pw.step_id = wr.step_id
                                  AND pw.tenant_id = wr.tenant_id
                                  AND pw.worker_grade = u.skill_level
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
        wr.qty                                        AS qty,
        COALESCE(pw.unit_price, 0)                    AS unitPrice,
        CAST(wr.qty * COALESCE(pw.unit_price, 0) AS DECIMAL(14,2)) AS subtotal,
        DATE_FORMAT(wr.report_date, '%Y-%m-%d')       AS reportDate
      FROM work_reports wr
      INNER JOIN process_steps ps  ON ps.id = wr.step_id
      INNER JOIN users u           ON u.id  = wr.user_id
      LEFT  JOIN process_wages pw  ON pw.step_id = wr.step_id
                                  AND pw.tenant_id = wr.tenant_id
                                  AND pw.worker_grade = u.skill_level
      WHERE ${where}
      ORDER BY wr.report_date DESC, wr.id DESC
      LIMIT ? OFFSET ?
    `;

    const rows: WageReportRow[] = await AppDataSource.query(
      listSql,
      [...params, pageSize, (page - 1) * pageSize],
    );

    return [rows, total];
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

  /**
   * 导出工资报表（无分页，最多5000条）
   */
  async exportWages(filter: WageExportFilter): Promise<WageReportRow[]> {
    const { dateFrom, dateTo, userId, workerGrade } = filter;

    const conditions: string[] = ['wr.tenant_id = ?'];
    const params: unknown[] = [this.tenantId];

    if (dateFrom) {
      conditions.push('wr.report_date >= ?');
      params.push(dateFrom);
    }
    if (dateTo) {
      conditions.push('wr.report_date <= ?');
      params.push(dateTo);
    }
    if (userId !== undefined) {
      conditions.push('wr.user_id = ?');
      params.push(userId);
    }
    if (workerGrade) {
      conditions.push('u.skill_level = ?');
      params.push(workerGrade);
    }

    const where = conditions.join(' AND ');

    const rows: WageReportRow[] = await AppDataSource.query(
      `SELECT
         u.id                                          AS userId,
         u.username                                    AS userName,
         COALESCE(u.skill_level, '')                   AS workerGrade,
         ps.step_name                                  AS stepName,
         wr.qty                                        AS qty,
         COALESCE(pw.unit_price, 0)                    AS unitPrice,
         CAST(wr.qty * COALESCE(pw.unit_price, 0) AS DECIMAL(14,2)) AS subtotal,
         DATE_FORMAT(wr.report_date, '%Y-%m-%d')       AS reportDate
       FROM work_reports wr
       INNER JOIN process_steps ps  ON ps.id = wr.step_id
       INNER JOIN users u           ON u.id  = wr.user_id
       LEFT  JOIN process_wages pw  ON pw.step_id = wr.step_id
                                   AND pw.tenant_id = wr.tenant_id
                                   AND pw.worker_grade = u.skill_level
       WHERE ${where}
       ORDER BY wr.report_date DESC, wr.id DESC
       LIMIT 5000`,
      params,
    );

    return rows;
  }
}
