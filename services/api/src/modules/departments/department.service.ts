import { AppDataSource } from '../../config/database';
import { AppError } from '../../shared/AppError';
import { buildPaginated } from '../../shared/ApiResponse';

interface TenantContext {
  tenantId: number;
  userId: number;
}

interface ListQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  status?: string;
}

interface DepartmentPayload {
  code: string;
  name: string;
  status?: string;
  sortOrder?: number;
  notes?: string | null;
}

function normalizePage(input?: number): number {
  return Number.isFinite(input) && (input ?? 0) > 0 ? Number(input) : 1;
}

function normalizePageSize(input?: number): number {
  return Number.isFinite(input) && (input ?? 0) > 0 ? Math.min(Number(input), 200) : 50;
}

function normalizeDepartmentCode(value: string): string {
  return value.trim().replace(/\s+/g, '_').slice(0, 50);
}

function normalizeDepartmentName(value: string): string {
  return value.trim().slice(0, 100);
}

function normalizeStatus(value?: string): string {
  return value?.trim() || 'active';
}

function normalizeSortOrder(value?: number): number {
  return Number.isFinite(value) ? Number(value) : 0;
}

export class DepartmentService {
  constructor(private readonly ctx: TenantContext) {}

  async list(query: ListQuery) {
    const page = normalizePage(query.page);
    const pageSize = normalizePageSize(query.pageSize);
    const where = ['tenant_id = ?'];
    const params: Array<string | number> = [this.ctx.tenantId];

    if (query.keyword?.trim()) {
      const keyword = `%${query.keyword.trim()}%`;
      where.push('(code LIKE ? OR name LIKE ? OR notes LIKE ?)');
      params.push(keyword, keyword, keyword);
    }
    if (query.status?.trim()) {
      where.push('status = ?');
      params.push(query.status.trim());
    }

    const [countRow] = await AppDataSource.query<Array<{ total: number }>>(
      `SELECT COUNT(*) AS total
         FROM departments
        WHERE ${where.join(' AND ')}`,
      params,
    );

    const rows = await AppDataSource.query<Array<Record<string, unknown>>>(
      `SELECT
         id,
         tenant_id AS tenantId,
         code,
         name,
         status,
         sort_order AS sortOrder,
         notes,
         created_at AS createdAt,
         updated_at AS updatedAt
       FROM departments
       WHERE ${where.join(' AND ')}
       ORDER BY
         CASE status
           WHEN 'active' THEN 0
           WHEN 'inactive' THEN 1
           WHEN 'locked' THEN 2
           ELSE 3
         END ASC,
         sort_order ASC,
         id DESC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, (page - 1) * pageSize],
    );

    return buildPaginated(rows, Number(countRow?.total ?? 0), page, pageSize);
  }

  async create(payload: DepartmentPayload) {
    const code = normalizeDepartmentCode(payload.code);
    const name = normalizeDepartmentName(payload.name);
    if (!code || !name) {
      throw AppError.badRequest('部门编码和名称不能为空');
    }

    const duplicate = await AppDataSource.query<Array<{ id: number; code: string; name: string }>>(
      `SELECT id, code, name
         FROM departments
        WHERE tenant_id = ?
          AND (code = ? OR name = ?)
        LIMIT 1`,
      [this.ctx.tenantId, code, name],
    );

    if (duplicate.length > 0) {
      const target = duplicate[0];
      if (String(target.code) === code) {
        throw AppError.badRequest('部门编码已存在');
      }
      throw AppError.badRequest('部门名称已存在');
    }

    const result = await AppDataSource.query<Array<never>>(
      `INSERT INTO departments
         (tenant_id, code, name, status, sort_order, notes, created_at, updated_at, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, NOW(3), NOW(3), ?, ?)`,
      [
        this.ctx.tenantId,
        code,
        name,
        normalizeStatus(payload.status),
        normalizeSortOrder(payload.sortOrder),
        payload.notes?.trim() || null,
        this.ctx.userId,
        this.ctx.userId,
      ],
    ) as unknown as { insertId?: number };

    return { id: Number(result.insertId ?? 0) };
  }

  async update(id: number, payload: DepartmentPayload) {
    const code = normalizeDepartmentCode(payload.code);
    const name = normalizeDepartmentName(payload.name);
    if (!code || !name) {
      throw AppError.badRequest('部门编码和名称不能为空');
    }

    const [department] = await AppDataSource.query<Array<{ id: number }>>(
      'SELECT id FROM departments WHERE id = ? AND tenant_id = ? LIMIT 1',
      [id, this.ctx.tenantId],
    );
    if (!department) {
      throw AppError.notFound('部门不存在');
    }

    const duplicate = await AppDataSource.query<Array<{ id: number; code: string; name: string }>>(
      `SELECT id, code, name
         FROM departments
        WHERE tenant_id = ?
          AND id <> ?
          AND (code = ? OR name = ?)
        LIMIT 1`,
      [this.ctx.tenantId, id, code, name],
    );

    if (duplicate.length > 0) {
      const target = duplicate[0];
      if (String(target.code) === code) {
        throw AppError.badRequest('部门编码已存在');
      }
      throw AppError.badRequest('部门名称已存在');
    }

    await AppDataSource.query(
      `UPDATE departments
          SET code = ?,
              name = ?,
              status = ?,
              sort_order = ?,
              notes = ?,
              updated_by = ?,
              updated_at = NOW(3)
        WHERE id = ? AND tenant_id = ?`,
      [
        code,
        name,
        normalizeStatus(payload.status),
        normalizeSortOrder(payload.sortOrder),
        payload.notes?.trim() || null,
        this.ctx.userId,
        id,
        this.ctx.tenantId,
      ],
    );

    return { success: true };
  }

  async updateStatus(id: number, status: string) {
    const result = await AppDataSource.query<Array<never>>(
      `UPDATE departments
          SET status = ?,
              updated_by = ?,
              updated_at = NOW(3)
        WHERE id = ? AND tenant_id = ?`,
      [normalizeStatus(status), this.ctx.userId, id, this.ctx.tenantId],
    ) as unknown as { affectedRows?: number };

    if (!Number(result.affectedRows ?? 0)) {
      throw AppError.notFound('部门不存在');
    }

    return { success: true };
  }
}
