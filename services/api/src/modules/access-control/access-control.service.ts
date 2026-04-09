import bcrypt from 'bcrypt';
import { AppDataSource } from '../../config/database';
import { AppError } from '../../shared/AppError';
import { buildPaginated, ResponseCode } from '../../shared/ApiResponse';
import {
  buildFallbackPermissionSnapshot,
  getSystemActionSeeds,
  getSystemMenuSeeds,
  type PermissionSnapshot,
} from './access-control.config';

const RBAC_CENTER_MENU_CODES = new Set(getSystemMenuSeeds().map((item) => item.code));
const RBAC_CENTER_ACTION_CODES = new Set(getSystemActionSeeds().map((item) => item.code));
const PLATFORM_ONLY_MENU_CODES = new Set(['system.tenant.config']);
const PLATFORM_ONLY_ACTION_CODES = new Set(['system.tenant.manage', 'platform.tenant.switch', 'system.audit.view']);
const TENANT_HIDDEN_ROLE_CODES = new Set(['purchase']);

interface TenantContext {
  tenantId: number;
  userId: number;
  roles: string[];
  originTenantId: number;
  contextTenantId: number | null;
  scopeLevel: 'platform' | 'tenant';
}

interface ListQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  status?: string;
}

interface RoleAssignmentPayload {
  roleId: number;
  isPrimary?: boolean;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
}

interface AuditLogPayload {
  tenantId?: number;
  module: string;
  action: string;
  targetType: string;
  targetId?: number | null;
  targetCode?: string | null;
  beforeJson?: Record<string, unknown> | null;
  afterJson?: Record<string, unknown> | null;
  diffJson?: Record<string, unknown> | null;
}

interface DefaultAdminPayload {
  username: string;
  realName: string;
  initialPassword?: string;
}

function normalizePage(input?: number): number {
  return Number.isFinite(input) && (input ?? 0) > 0 ? Number(input) : 1;
}

function normalizePageSize(input?: number): number {
  return Number.isFinite(input) && (input ?? 0) > 0 ? Math.min(Number(input), 100) : 20;
}

function buildInClause(values: Array<string | number>): string {
  if (values.length === 0) {
    return 'NULL';
  }
  return values.map(() => '?').join(',');
}

function isAssignmentEffectiveNow(assignment: RoleAssignmentPayload): boolean {
  const now = Date.now();
  const effectiveFrom = assignment.effectiveFrom ? new Date(assignment.effectiveFrom).getTime() : null;
  const effectiveTo = assignment.effectiveTo ? new Date(assignment.effectiveTo).getTime() : null;

  if (effectiveFrom !== null && Number.isFinite(effectiveFrom) && effectiveFrom > now) {
    return false;
  }
  if (effectiveTo !== null && Number.isFinite(effectiveTo) && effectiveTo < now) {
    return false;
  }
  return true;
}

function normalizeStatus(value: string | undefined, fallback: string) {
  return value?.trim() || fallback;
}

function parseJsonColumn<T>(value: unknown, fallback: T): T {
  if (value == null) {
    return fallback;
  }
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

function normalizeAccountCode(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

function toTree<T extends { id: number; parentId: number | null; children?: T[] }>(items: T[]): T[] {
  const map = new Map<number, T>();
  const roots: T[] = [];

  items.forEach((item) => {
    map.set(item.id, { ...item, children: [] });
  });

  map.forEach((item) => {
    if (item.parentId && map.has(item.parentId)) {
      map.get(item.parentId)!.children!.push(item);
      return;
    }
    roots.push(item);
  });

  return roots;
}

export class AccessControlService {
  private normalizeTenantId(value: number | string | null | undefined): number {
    return Number(value ?? 0);
  }

  private isPlatformSuperAdmin(ctx: TenantContext): boolean {
    return this.normalizeTenantId(ctx.originTenantId) === 0 && ctx.roles.includes('platform_super_admin');
  }

  private resolveScopedTenantId(ctx: TenantContext, requestedTenantId?: number | null): number {
    const currentTenantId = this.normalizeTenantId(ctx.tenantId);
    if (this.isPlatformSuperAdmin(ctx)) {
      return this.normalizeTenantId(requestedTenantId ?? currentTenantId);
    }

    if (requestedTenantId != null && this.normalizeTenantId(requestedTenantId) !== currentTenantId) {
      throw AppError.forbidden('普通系统管理员不能跨租户访问');
    }
    return currentTenantId;
  }

  private assertPlatformOnly(ctx: TenantContext): void {
    if (!this.isPlatformSuperAdmin(ctx)) {
      throw AppError.forbidden('仅 platform_super_admin 可执行该操作');
    }
  }

  private async buildRoleVisibilityFilter(
    ctx: TenantContext,
    alias: string,
  ): Promise<{ clause: string; params: Array<string | number> }> {
    if (this.isPlatformSuperAdmin(ctx)) {
      return { clause: '1=1', params: [] };
    }

    const hasRoleScope = await this.columnExists('roles', 'role_scope');
    if (hasRoleScope) {
      return {
        clause: `COALESCE(${alias}.role_scope, 'tenant') <> 'platform'`,
        params: [],
      };
    }

    return {
      clause: `${alias}.code <> ?`,
      params: ['platform_super_admin'],
    };
  }

  private async isRoleVisibleToContext(
    ctx: TenantContext,
    role: { code?: string | null; roleScope?: string | null },
  ): Promise<boolean> {
    if (this.isPlatformSuperAdmin(ctx)) {
      return true;
    }

    const hasRoleScope = await this.columnExists('roles', 'role_scope');
    if (hasRoleScope) {
      return (role.roleScope ?? 'tenant') !== 'platform';
    }

    return role.code !== 'platform_super_admin';
  }

  private applyTenantFeatureGuards(
    snapshot: PermissionSnapshot,
    enabledFeatureFlags: string[],
  ): PermissionSnapshot {
    if (snapshot.scopeLevel !== 'tenant') {
      return snapshot;
    }

    const tenantScopedSnapshot: PermissionSnapshot = {
      ...snapshot,
      menuCodes: snapshot.menuCodes.filter((code) => !PLATFORM_ONLY_MENU_CODES.has(code)),
      actionCodes: snapshot.actionCodes.filter((code) => !PLATFORM_ONLY_ACTION_CODES.has(code)),
    };

    if (enabledFeatureFlags.includes('rbac_center')) {
      return tenantScopedSnapshot;
    }

    return {
      ...tenantScopedSnapshot,
      menuCodes: tenantScopedSnapshot.menuCodes.filter((code) => !RBAC_CENTER_MENU_CODES.has(code)),
      actionCodes: tenantScopedSnapshot.actionCodes.filter((code) => !RBAC_CENTER_ACTION_CODES.has(code)),
    };
  }

  private filterPlatformOnlyMenus<T extends { code?: unknown }>(ctx: TenantContext, menus: T[]): T[] {
    if (ctx.scopeLevel !== 'tenant') {
      return menus;
    }
    return menus.filter((item) => !PLATFORM_ONLY_MENU_CODES.has(String(item.code ?? '')));
  }

  private filterPlatformOnlyActions<T extends { code?: unknown }>(ctx: TenantContext, actions: T[]): T[] {
    if (ctx.scopeLevel !== 'tenant') {
      return actions;
    }
    return actions.filter((item) => !PLATFORM_ONLY_ACTION_CODES.has(String(item.code ?? '')));
  }

  private buildTenantHiddenRoleFilter(
    ctx: TenantContext,
    alias: string,
  ): { clause: string; params: Array<string | number> } {
    if (ctx.scopeLevel !== 'tenant' || TENANT_HIDDEN_ROLE_CODES.size === 0) {
      return { clause: '1=1', params: [] };
    }

    const codes = Array.from(TENANT_HIDDEN_ROLE_CODES);
    return {
      clause: `${alias}.code NOT IN (${buildInClause(codes)})`,
      params: codes,
    };
  }

  private async tableExists(tableName: string): Promise<boolean> {
    const [row] = await AppDataSource.query<Array<{ total: number }>>(
      `SELECT COUNT(*) AS total
         FROM information_schema.tables
        WHERE table_schema = DATABASE()
          AND table_name = ?`,
      [tableName],
    );
    return Number(row?.total ?? 0) > 0;
  }

  private async columnExists(tableName: string, columnName: string): Promise<boolean> {
    const [row] = await AppDataSource.query<Array<{ total: number }>>(
      `SELECT COUNT(*) AS total
         FROM information_schema.columns
        WHERE table_schema = DATABASE()
          AND table_name = ?
          AND column_name = ?`,
      [tableName, columnName],
    );
    return Number(row?.total ?? 0) > 0;
  }

  private async getOperatorName(ctx: TenantContext): Promise<string | null> {
    const [user] = await AppDataSource.query<Array<{ real_name: string | null; username: string | null }>>(
      'SELECT real_name, username FROM users WHERE id = ? AND tenant_id = ? LIMIT 1',
      [ctx.userId, ctx.tenantId],
    );
    return user?.real_name || user?.username || null;
  }

  private async writeAuditLog(ctx: TenantContext, payload: AuditLogPayload): Promise<void> {
    if (!(await this.tableExists('access_audit_logs'))) {
      return;
    }

    const operatorName = await this.getOperatorName(ctx);
    await AppDataSource.query(
      `INSERT INTO access_audit_logs
         (tenant_id, module, action, target_type, target_id, target_code, before_json, after_json, diff_json, operator_id, operator_name, trace_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NOW(3))`,
      [
        payload.tenantId ?? ctx.tenantId,
        payload.module,
        payload.action,
        payload.targetType,
        payload.targetId ?? null,
        payload.targetCode ?? null,
        payload.beforeJson ? JSON.stringify(payload.beforeJson) : null,
        payload.afterJson ? JSON.stringify(payload.afterJson) : null,
        payload.diffJson ? JSON.stringify(payload.diffJson) : null,
        ctx.userId,
        operatorName,
      ],
    );
  }

  private async resolveDefaultAdminRole(): Promise<{ id: number; code: string; tenantId: number }> {
    const hasStatus = await this.columnExists('roles', 'status');
    const rows = await AppDataSource.query<Array<{ id: number; code: string; tenantId: number }>>(
      `SELECT id, code, tenant_id AS tenantId
         FROM roles
        WHERE tenant_id = 0
          AND code IN ('tenant_admin', 'admin', 'boss')${hasStatus ? " AND status = 'active'" : ''}
        ORDER BY CASE code
          WHEN 'tenant_admin' THEN 1
          WHEN 'admin' THEN 2
          WHEN 'boss' THEN 3
          ELSE 9
        END ASC
        LIMIT 1`,
    );

    if (!rows[0]) {
      throw AppError.badRequest('未找到可分配的默认管理员角色，请先初始化系统预置角色', ResponseCode.NOT_FOUND);
    }

    return rows[0];
  }

  private buildDefaultAdminPayload(payload: DefaultAdminPayload | undefined, tenant: { code: string; name: string }): Required<DefaultAdminPayload> {
    const normalizedCode = normalizeAccountCode(payload?.username || tenant.code) || 'tenant';
    return {
      username: payload?.username?.trim() || `${normalizedCode}_admin`,
      realName: payload?.realName?.trim() || `${tenant.name}管理员`,
      initialPassword: payload?.initialPassword?.trim() || '123456',
    };
  }

  async resolveUserRoleCodes(userId: number, tenantId: number): Promise<string[]> {
    if (await this.tableExists('user_role_assignments')) {
      const assignmentRoles = await AppDataSource.query<Array<{ code: string }>>(
        `SELECT DISTINCT r.code
           FROM user_role_assignments ura
           INNER JOIN roles r ON r.id = ura.role_id
          WHERE ura.user_id = ?
            AND ura.tenant_id = ?
            AND r.tenant_id IN (0, ?)
            AND ura.assignment_status = 'active'
            AND (ura.effective_from IS NULL OR ura.effective_from <= NOW())
            AND (ura.effective_to IS NULL OR ura.effective_to >= NOW())`,
        [userId, tenantId, tenantId],
      );
      if (assignmentRoles.length > 0) {
        return Array.from(new Set(assignmentRoles.map((row) => row.code)));
      }
    }

    const userRoles = await AppDataSource.query<Array<{ code: string }>>(
      `SELECT DISTINCT r.code
         FROM user_roles ur
         INNER JOIN roles r ON r.id = ur.role_id
        WHERE ur.user_id = ?
          AND ur.tenant_id = ?
          AND r.tenant_id IN (0, ?)`,
      [userId, tenantId, tenantId],
    );
    return Array.from(new Set(userRoles.map((row) => row.code)));
  }

  async buildPermissionSnapshot(
    tenantId: number,
    roleCodes: string[],
    options?: {
      scopeLevel?: 'platform' | 'tenant';
      originTenantId?: number;
      contextTenantId?: number | null;
    },
  ): Promise<PermissionSnapshot> {
    const fallback = buildFallbackPermissionSnapshot(roleCodes, {
      scopeLevel: options?.scopeLevel,
      originTenantId: options?.originTenantId ?? tenantId,
      contextTenantId: options?.contextTenantId,
    });
    if (roleCodes.length === 0) {
      return {
        version: `empty-${new Date().toISOString()}`,
        scopeLevel: options?.scopeLevel ?? 'tenant',
        originTenantId: options?.originTenantId ?? tenantId,
        contextTenantId: options?.contextTenantId ?? tenantId,
        menuCodes: [],
        actionCodes: [],
        dataScopes: [],
        featureFlags: [],
      };
    }

    if (!(await this.tableExists('role_permissions'))) {
      return fallback;
    }

    try {
      const perms = await AppDataSource.query<
        Array<{ permission_type: 'menu' | 'action' | 'data_scope'; permission_key: string; scope_type?: string; scope_value_json?: string | null }>
      >(
        `SELECT rp.permission_type, rp.permission_key, rp.scope_type, rp.scope_value_json
           FROM role_permissions rp
           INNER JOIN roles r ON r.id = rp.role_id AND r.tenant_id = rp.tenant_id
          WHERE rp.tenant_id IN (0, ?)
            AND r.code IN (${roleCodes.map(() => '?').join(',')})`,
        [tenantId, ...roleCodes],
      );

      const hasTenantFeatureFlagsTable = await this.tableExists('tenant_feature_flags');
      const shouldUseTenantFeatureFlags = hasTenantFeatureFlagsTable && fallback.scopeLevel === 'tenant';
      const featureFlags = shouldUseTenantFeatureFlags
        ? await AppDataSource.query<Array<{ feature_code: string }>>(
            `SELECT feature_code
               FROM tenant_feature_flags
              WHERE tenant_id = ?
                AND is_enabled = 1
                AND (expires_at IS NULL OR expires_at > NOW())`,
            [tenantId],
          )
        : [];

      const snapshot: PermissionSnapshot = {
        version: `db-${new Date().toISOString()}`,
        scopeLevel: fallback.scopeLevel,
        originTenantId: fallback.originTenantId,
        contextTenantId: fallback.contextTenantId,
        menuCodes: Array.from(new Set([
          ...perms.filter((item) => item.permission_type === 'menu').map((item) => item.permission_key),
          ...fallback.menuCodes,
        ])),
        actionCodes: Array.from(new Set([
          ...perms.filter((item) => item.permission_type === 'action').map((item) => item.permission_key),
          ...fallback.actionCodes,
        ])),
        dataScopes: [
          ...perms
            .filter((item) => item.permission_type === 'data_scope')
            .map((item) => ({
              scopeType: item.scope_type ?? item.permission_key,
              scopeValues: parseJsonColumn<Array<number | string>>(item.scope_value_json, []),
            })),
          ...fallback.dataScopes,
        ],
        featureFlags: shouldUseTenantFeatureFlags
          ? Array.from(new Set(featureFlags.map((item) => item.feature_code)))
          : fallback.featureFlags,
      };

      if (snapshot.scopeLevel === 'tenant') {
        return this.applyTenantFeatureGuards(snapshot, snapshot.featureFlags);
      }
      return snapshot;
    } catch {
      return fallback;
    }
  }

  async listTenants(_ctx: TenantContext, query: ListQuery & { packageType?: string }) {
    const page = normalizePage(query.page);
    const pageSize = normalizePageSize(query.pageSize);
    const where: string[] = ['1 = 1'];
    const params: Array<string | number> = [];
    const ctx = _ctx;

    if (!this.isPlatformSuperAdmin(ctx)) {
      where.push('id = ?');
      params.push(ctx.tenantId);
    }

    if (query.keyword) {
      where.push('(name LIKE ? OR code LIKE ?)');
      params.push(`%${query.keyword}%`, `%${query.keyword}%`);
    }
    if (query.status) {
      where.push('status = ?');
      params.push(query.status);
    }

    const [countRow] = await AppDataSource.query<Array<{ total: number }>>(
      `SELECT COUNT(*) AS total FROM tenants WHERE ${where.join(' AND ')}`,
      params,
    );

    const hasTimedAssignments = await this.tableExists('user_role_assignments');
    const defaultAdminNameSelect = hasTimedAssignments
      ? `(
           SELECT COALESCE(MIN(u.real_name), MIN(u.username))
             FROM users u
             INNER JOIN user_role_assignments ura
               ON ura.user_id = u.id
              AND ura.tenant_id = u.tenant_id
             INNER JOIN roles r
               ON r.id = ura.role_id
              AND r.tenant_id IN (0, ura.tenant_id)
            WHERE u.tenant_id = tenants.id
              AND u.status = 'active'
              AND ura.assignment_status = 'active'
              AND (ura.effective_from IS NULL OR ura.effective_from <= NOW())
              AND (ura.effective_to IS NULL OR ura.effective_to >= NOW())
              AND r.code IN ('tenant_admin', 'admin', 'boss')
         )`
      : `(
           SELECT COALESCE(MIN(u.real_name), MIN(u.username))
             FROM users u
             INNER JOIN user_roles ur
               ON ur.user_id = u.id
              AND ur.tenant_id = u.tenant_id
             INNER JOIN roles r
               ON r.id = ur.role_id
              AND r.tenant_id IN (0, ur.tenant_id)
            WHERE u.tenant_id = tenants.id
              AND u.status = 'active'
              AND r.code IN ('tenant_admin', 'admin', 'boss')
         )`;

    const rows = await AppDataSource.query<Array<Record<string, unknown>>>(
      `SELECT id,
              code,
              name,
              status,
              NULL AS packageType,
              NULL AS featureCount,
              ${defaultAdminNameSelect} AS defaultAdminName,
              NULL AS expiresAt,
              updated_at AS updatedAt
         FROM tenants
        WHERE ${where.join(' AND ')}
        ORDER BY id DESC
        LIMIT ? OFFSET ?`,
      [...params, pageSize, (page - 1) * pageSize],
    );

    return buildPaginated(rows, Number(countRow?.total ?? 0), page, pageSize);
  }

  async createTenant(ctx: TenantContext, payload: { code: string; name: string; status?: string; defaultAdmin?: DefaultAdminPayload }) {
    this.assertPlatformOnly(ctx);

    const existing = await AppDataSource.query<Array<{ id: number }>>(
      'SELECT id FROM tenants WHERE code = ? LIMIT 1',
      [payload.code],
    );
    if (existing.length > 0) {
      throw new AppError('租户编码已存在', ResponseCode.CONFLICT, 409);
    }

    const defaultAdmin = this.buildDefaultAdminPayload(payload.defaultAdmin, {
      code: payload.code,
      name: payload.name,
    });
    const defaultAdminRole = await this.resolveDefaultAdminRole();
    const hasTimedAssignments = await this.tableExists('user_role_assignments');
    const hasRoleScope = hasTimedAssignments && await this.columnExists('user_role_assignments', 'role_scope');
    const hasTenantFeatureFlags = await this.tableExists('tenant_feature_flags');

    const created = await AppDataSource.transaction(async (manager) => {
      const tenantResult = await manager.query<{ insertId: number } & Array<never>>(
        `INSERT INTO tenants (code, name, status, settings, created_at, updated_at)
         VALUES (?, ?, ?, JSON_OBJECT(), NOW(3), NOW(3))`,
        [payload.code, payload.name, payload.status ?? 'active'],
      );
      const tenantId = Number((tenantResult as unknown as { insertId?: number }).insertId ?? 0);

      if (hasTenantFeatureFlags) {
        await manager.query(
          `INSERT INTO tenant_feature_flags
             (tenant_id, feature_code, feature_name, is_enabled, source_type, remark, created_by, updated_by)
           VALUES
             (?, 'rbac_center', '权限中心', 1, 'manual', 'default enabled when tenant is created', ?, ?),
             (?, 'tenant_admin', '租户治理能力', 1, 'manual', 'default enabled when tenant is created', ?, ?)
           ON DUPLICATE KEY UPDATE
             feature_name = VALUES(feature_name),
             is_enabled = VALUES(is_enabled),
             source_type = VALUES(source_type),
             remark = VALUES(remark),
             updated_by = VALUES(updated_by),
             updated_at = NOW(3)`,
          [tenantId, ctx.userId, ctx.userId, tenantId, ctx.userId, ctx.userId],
        );
      }

      const passwordHash = await bcrypt.hash(defaultAdmin.initialPassword, 10);
      const userResult = await manager.query<Array<never>>(
        `INSERT INTO users
           (tenant_id, username, password_hash, real_name, status, created_at, updated_at, created_by, updated_by)
         VALUES (?, ?, ?, ?, 'active', NOW(3), NOW(3), ?, ?)`,
        [tenantId, defaultAdmin.username, passwordHash, defaultAdmin.realName, ctx.userId, ctx.userId],
      ) as unknown as { insertId?: number };
      const defaultAdminUserId = Number(userResult.insertId ?? 0);

      if (hasTimedAssignments) {
        const assignmentColumns = [
          'tenant_id',
          'user_id',
          'role_id',
          'is_primary',
          'effective_from',
          'effective_to',
          'assignment_status',
          'source_type',
          'remark',
          'created_by',
          'updated_by',
        ];
        const assignmentValues: Array<number | string | null> = [
          tenantId,
          defaultAdminUserId,
          defaultAdminRole.id,
          1,
          null,
          null,
          'active',
          'template',
          'default tenant admin',
          ctx.userId,
          ctx.userId,
        ];
        if (hasRoleScope) {
          assignmentColumns.splice(3, 0, 'role_scope');
          assignmentValues.splice(3, 0, 'tenant');
        }

        await manager.query(
          `INSERT INTO user_role_assignments
             (${assignmentColumns.join(', ')}, created_at, updated_at)
           VALUES (${assignmentColumns.map(() => '?').join(', ')}, NOW(3), NOW(3))`,
          assignmentValues,
        );
      }

      await manager.query(
        `INSERT INTO user_roles (tenant_id, user_id, role_id, created_at)
         VALUES (?, ?, ?, NOW(3))`,
        [tenantId, defaultAdminUserId, defaultAdminRole.id],
      );

      return {
        tenantId,
        defaultAdminUserId,
      };
    });

    await this.writeAuditLog(ctx, {
      tenantId: created.tenantId,
      module: 'tenant',
      action: 'create',
      targetType: 'tenant',
      targetId: created.tenantId,
      targetCode: payload.code,
      afterJson: {
        code: payload.code,
        name: payload.name,
        status: payload.status ?? 'active',
        defaultAdmin: {
          username: defaultAdmin.username,
          realName: defaultAdmin.realName,
          roleCode: defaultAdminRole.code,
        },
      },
      diffJson: { created: true },
    });
    return {
      id: created.tenantId,
      defaultAdminUserId: created.defaultAdminUserId,
      defaultAdminUsername: defaultAdmin.username,
      defaultAdminName: defaultAdmin.realName,
      defaultAdminPassword: defaultAdmin.initialPassword,
      defaultAdminRoleCode: defaultAdminRole.code,
    };
  }

  async updateTenant(ctx: TenantContext, tenantId: number, payload: { code: string; name: string; status?: string }) {
    tenantId = this.resolveScopedTenantId(ctx, tenantId);

    const existing = await AppDataSource.query<Array<{ id: number; code: string; name: string; status: string }>>(
      'SELECT id, code, name, status FROM tenants WHERE id = ? LIMIT 1',
      [tenantId],
    );
    if (existing.length === 0) {
      throw AppError.notFound('租户不存在', ResponseCode.NOT_FOUND);
    }

    const duplicate = await AppDataSource.query<Array<{ id: number }>>(
      'SELECT id FROM tenants WHERE code = ? AND id <> ? LIMIT 1',
      [payload.code, tenantId],
    );
    if (duplicate.length > 0) {
      throw new AppError('租户编码已存在', ResponseCode.ACCESS_TENANT_CODE_DUPLICATE, 409);
    }

    await AppDataSource.query(
      `UPDATE tenants
          SET code = ?,
              name = ?,
              status = ?,
              updated_at = NOW(3)
        WHERE id = ?`,
      [payload.code, payload.name, normalizeStatus(payload.status, 'active'), tenantId],
    );

    await this.writeAuditLog(ctx, {
      tenantId,
      module: 'tenant',
      action: 'update',
      targetType: 'tenant',
      targetId: tenantId,
      targetCode: payload.code,
      beforeJson: existing[0],
      afterJson: { id: tenantId, code: payload.code, name: payload.name, status: normalizeStatus(payload.status, 'active') },
      diffJson: {
        code: [existing[0].code, payload.code],
        name: [existing[0].name, payload.name],
        status: [existing[0].status, normalizeStatus(payload.status, 'active')],
      },
    });

    return { success: true };
  }

  async updateTenantStatus(ctx: TenantContext, tenantId: number, payload: { status: string }) {
    tenantId = this.resolveScopedTenantId(ctx, tenantId);

    const [before] = await AppDataSource.query<Array<{ id: number; code: string; status: string }>>(
      'SELECT id, code, status FROM tenants WHERE id = ? LIMIT 1',
      [tenantId],
    );
    const result = await AppDataSource.query<Array<never>>(
      'UPDATE tenants SET status = ?, updated_at = NOW(3) WHERE id = ?',
      [payload.status, tenantId],
    ) as unknown as { affectedRows?: number };

    if (Number(result.affectedRows ?? 0) === 0) {
      throw AppError.notFound('租户不存在', ResponseCode.NOT_FOUND);
    }
    await this.writeAuditLog(ctx, {
      tenantId,
      module: 'tenant',
      action: 'status',
      targetType: 'tenant',
      targetId: tenantId,
      targetCode: before?.code ?? null,
      beforeJson: before ?? null,
      afterJson: before ? { ...before, status: payload.status } : { status: payload.status },
      diffJson: { status: [before?.status ?? null, payload.status] },
    });
    return { success: true };
  }

  async getTenantFeatureFlags(ctx: TenantContext, tenantId: number) {
    tenantId = this.resolveScopedTenantId(ctx, tenantId);

    if (!(await this.tableExists('tenant_feature_flags'))) {
      return [];
    }

    const [tenant] = await AppDataSource.query<Array<{ id: number; code: string; name: string }>>(
      'SELECT id, code, name FROM tenants WHERE id = ? LIMIT 1',
      [tenantId],
    );
    if (!tenant) {
      throw AppError.notFound('租户不存在', ResponseCode.NOT_FOUND);
    }

    const rows = await AppDataSource.query<Array<Record<string, unknown>>>(
      `SELECT id,
              tenant_id AS tenantId,
              feature_code AS featureCode,
              feature_name AS featureName,
              is_enabled AS isEnabled,
              source_type AS sourceType,
              expires_at AS expiresAt,
              remark,
              updated_at AS updatedAt
         FROM tenant_feature_flags
        WHERE tenant_id = ?
        ORDER BY feature_code ASC`,
      [tenantId],
    );

    if (rows.length > 0) {
      return rows;
    }

    return [
      {
        id: 0,
        tenantId,
        featureCode: 'rbac_center',
        featureName: '权限中心',
        isEnabled: 0,
        sourceType: 'manual',
        expiresAt: null,
        remark: null,
        updatedAt: null,
      },
      {
        id: 0,
        tenantId,
        featureCode: 'tenant_admin',
        featureName: '租户治理能力',
        isEnabled: 0,
        sourceType: 'manual',
        expiresAt: null,
        remark: null,
        updatedAt: null,
      },
    ];
  }

  async updateTenantFeatureFlags(
    ctx: TenantContext,
    tenantId: number,
    payload: {
      flags: Array<{
        featureCode: string;
        featureName?: string | null;
        isEnabled?: boolean;
        sourceType?: string;
        expiresAt?: string | null;
        remark?: string | null;
      }>;
    },
  ) {
    tenantId = this.resolveScopedTenantId(ctx, tenantId);

    if (!(await this.tableExists('tenant_feature_flags'))) {
      throw AppError.badRequest('请先执行权限控制模块 migration', ResponseCode.NOT_FOUND);
    }

    const [tenant] = await AppDataSource.query<Array<{ id: number; code: string }>>(
      'SELECT id, code FROM tenants WHERE id = ? LIMIT 1',
      [tenantId],
    );
    if (!tenant) {
      throw AppError.notFound('租户不存在', ResponseCode.NOT_FOUND);
    }

    const before = await this.getTenantFeatureFlags(ctx, tenantId);

    await AppDataSource.transaction(async (manager) => {
      for (const flag of payload.flags) {
        await manager.query(
          `INSERT INTO tenant_feature_flags
             (tenant_id, feature_code, feature_name, is_enabled, source_type, expires_at, remark, created_by, updated_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             feature_name = VALUES(feature_name),
             is_enabled = VALUES(is_enabled),
             source_type = VALUES(source_type),
             expires_at = VALUES(expires_at),
             remark = VALUES(remark),
             updated_by = VALUES(updated_by),
             updated_at = NOW(3)`,
          [
            tenantId,
            flag.featureCode,
            flag.featureName?.trim() || flag.featureCode,
            flag.isEnabled === false ? 0 : 1,
            flag.sourceType?.trim() || 'manual',
            flag.expiresAt ?? null,
            flag.remark ?? null,
            ctx.userId,
            ctx.userId,
          ],
        );
      }
    });

    const after = await this.getTenantFeatureFlags(ctx, tenantId);
    await this.writeAuditLog(ctx, {
      tenantId,
      module: 'tenant_feature',
      action: 'update',
      targetType: 'tenant',
      targetId: tenantId,
      targetCode: tenant.code,
      beforeJson: { flags: before },
      afterJson: { flags: after },
      diffJson: {
        updatedFlags: payload.flags.map((flag) => ({
          featureCode: flag.featureCode,
          isEnabled: flag.isEnabled === false ? 0 : 1,
        })),
      },
    });

    return { success: true };
  }

  async getMenuTree(ctx: TenantContext, query: { tenantId?: number; keyword?: string }) {
    const tenantId = this.resolveScopedTenantId(
      ctx,
      query.tenantId ?? (this.isPlatformSuperAdmin(ctx) ? 0 : ctx.tenantId),
    );
    if (!(await this.tableExists('permission_menus'))) {
      const seeds = getSystemMenuSeeds();
      const filtered = query.keyword
        ? seeds.filter((item) => item.name.includes(query.keyword!) || item.code.includes(query.keyword!))
        : seeds;
      return toTree(this.filterPlatformOnlyMenus(ctx, filtered).map((item) => ({ ...item, children: [] })));
    }

    const params: Array<number | string> = [tenantId];
    let sql = `SELECT id,
                      tenant_id AS tenantId,
                      parent_id AS parentId,
                      menu_type AS menuType,
                      code,
                      name,
                      route_path AS routePath,
                      icon,
                      group_name AS groupName,
                      sort_order AS sortOrder,
                      status,
                      is_system AS isSystem
                 FROM permission_menus
                WHERE tenant_id IN (0, ?)`;
    if (query.keyword) {
      sql += ' AND (name LIKE ? OR code LIKE ?)';
      params.push(`%${query.keyword}%`, `%${query.keyword}%`);
    }
    sql += ' ORDER BY parent_id ASC, sort_order ASC, id ASC';

    const rows = await AppDataSource.query<Array<Record<string, unknown>>>(sql, params);
    const filteredRows = this.filterPlatformOnlyMenus(ctx, rows);
    return toTree(filteredRows.map((item) => ({ ...(item as Record<string, unknown>), children: [] })) as Array<any>);
  }

  async getMenuActions(ctx: TenantContext, menuId: number) {
    if (!(await this.tableExists('permission_actions'))) {
      return this.filterPlatformOnlyActions(ctx, getSystemActionSeeds().filter((item) => item.menuId === menuId));
    }

    const rows = await AppDataSource.query(
      `SELECT id,
              tenant_id AS tenantId,
              menu_id AS menuId,
              code,
              name,
              action_type AS actionType,
              status,
              default_enabled AS defaultEnabled
         FROM permission_actions
        WHERE menu_id = ?
        ORDER BY id ASC`,
      [menuId],
    );
    return this.filterPlatformOnlyActions(ctx, rows);
  }

  async createMenu(ctx: TenantContext, payload: {
    tenantId?: number;
    parentId?: number | null;
    menuType?: 'group' | 'module' | 'page';
    code: string;
    name: string;
    routePath?: string | null;
    icon?: string | null;
    groupName?: string | null;
    sortOrder?: number;
    status?: string;
    defaultVisible?: boolean;
  }) {
    if (!(await this.tableExists('permission_menus'))) {
      throw AppError.badRequest('请先执行权限控制模块 migration', ResponseCode.NOT_FOUND);
    }

    const tenantId = this.resolveScopedTenantId(ctx, payload.tenantId ?? ctx.tenantId);
    const duplicate = await AppDataSource.query<Array<{ id: number }>>(
      'SELECT id FROM permission_menus WHERE tenant_id = ? AND code = ? LIMIT 1',
      [tenantId, payload.code],
    );
    if (duplicate.length > 0) {
      throw new AppError('菜单编码已存在', ResponseCode.ACCESS_MENU_CODE_DUPLICATE, 409);
    }

    const result = await AppDataSource.query<Array<never>>(
      `INSERT INTO permission_menus
         (tenant_id, parent_id, menu_type, code, name, route_path, icon, group_name, sort_order, status, is_system, default_visible, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
      [
        tenantId,
        payload.parentId ?? null,
        payload.menuType ?? 'page',
        payload.code,
        payload.name,
        payload.routePath ?? null,
        payload.icon ?? null,
        payload.groupName ?? null,
        payload.sortOrder ?? 0,
        normalizeStatus(payload.status, 'active'),
        payload.defaultVisible === false ? 0 : 1,
        ctx.userId,
        ctx.userId,
      ],
    ) as unknown as { insertId?: number };

    return { id: Number(result.insertId ?? 0) };
  }

  async updateMenu(ctx: TenantContext, menuId: number, payload: {
    parentId?: number | null;
    menuType?: 'group' | 'module' | 'page';
    code: string;
    name: string;
    routePath?: string | null;
    icon?: string | null;
    groupName?: string | null;
    sortOrder?: number;
    status?: string;
    defaultVisible?: boolean;
  }) {
    if (!(await this.tableExists('permission_menus'))) {
      throw AppError.badRequest('请先执行权限控制模块 migration', ResponseCode.NOT_FOUND);
    }

    const [menu] = await AppDataSource.query<Array<{ id: number; tenant_id: number; is_system: number }>>(
      'SELECT id, tenant_id, is_system FROM permission_menus WHERE id = ? AND tenant_id IN (0, ?) LIMIT 1',
      [menuId, ctx.tenantId],
    );
    if (!menu) {
      throw AppError.notFound('菜单不存在', ResponseCode.NOT_FOUND);
    }
    if (Number(menu.is_system) === 1 || Number(menu.tenant_id) === 0) {
      throw new AppError('系统预置菜单不允许直接修改', ResponseCode.ACCESS_SYSTEM_OBJECT_PROTECTED, 403);
    }

    const duplicate = await AppDataSource.query<Array<{ id: number }>>(
      'SELECT id FROM permission_menus WHERE tenant_id = ? AND code = ? AND id <> ? LIMIT 1',
      [menu.tenant_id, payload.code, menuId],
    );
    if (duplicate.length > 0) {
      throw new AppError('菜单编码已存在', ResponseCode.ACCESS_MENU_CODE_DUPLICATE, 409);
    }

    await AppDataSource.query(
      `UPDATE permission_menus
          SET parent_id = ?,
              menu_type = ?,
              code = ?,
              name = ?,
              route_path = ?,
              icon = ?,
              group_name = ?,
              sort_order = ?,
              status = ?,
              default_visible = ?,
              updated_by = ?,
              updated_at = NOW(3)
        WHERE id = ?`,
      [
        payload.parentId ?? null,
        payload.menuType ?? 'page',
        payload.code,
        payload.name,
        payload.routePath ?? null,
        payload.icon ?? null,
        payload.groupName ?? null,
        payload.sortOrder ?? 0,
        normalizeStatus(payload.status, 'active'),
        payload.defaultVisible === false ? 0 : 1,
        ctx.userId,
        menuId,
      ],
    );

    return { success: true };
  }

  async deleteMenu(ctx: TenantContext, menuId: number) {
    if (!(await this.tableExists('permission_menus'))) {
      throw AppError.badRequest('请先执行权限控制模块 migration', ResponseCode.NOT_FOUND);
    }

    const [menu] = await AppDataSource.query<Array<{ id: number; tenant_id: number; is_system: number }>>(
      'SELECT id, tenant_id, is_system FROM permission_menus WHERE id = ? AND tenant_id IN (0, ?) LIMIT 1',
      [menuId, ctx.tenantId],
    );
    if (!menu) {
      throw AppError.notFound('菜单不存在', ResponseCode.NOT_FOUND);
    }
    if (Number(menu.is_system) === 1 || Number(menu.tenant_id) === 0) {
      throw new AppError('系统预置菜单不允许删除', ResponseCode.ACCESS_SYSTEM_OBJECT_PROTECTED, 403);
    }

    const [childRow] = await AppDataSource.query<Array<{ total: number }>>(
      'SELECT COUNT(*) AS total FROM permission_menus WHERE parent_id = ? AND tenant_id = ?',
      [menuId, menu.tenant_id],
    );
    const [actionRow] = await AppDataSource.query<Array<{ total: number }>>(
      'SELECT COUNT(*) AS total FROM permission_actions WHERE menu_id = ? AND tenant_id = ?',
      [menuId, menu.tenant_id],
    );
    if (Number(childRow?.total ?? 0) > 0 || Number(actionRow?.total ?? 0) > 0) {
      throw AppError.badRequest('请先删除子菜单或功能点后再删除菜单', ResponseCode.CONFLICT);
    }

    await AppDataSource.query('DELETE FROM permission_menus WHERE id = ? AND tenant_id = ?', [menuId, menu.tenant_id]);
    return { success: true };
  }

  async createAction(ctx: TenantContext, payload: {
    tenantId?: number;
    menuId: number;
    code: string;
    name: string;
    actionType?: string;
    status?: string;
    defaultEnabled?: boolean;
  }) {
    if (!(await this.tableExists('permission_actions'))) {
      throw AppError.badRequest('请先执行权限控制模块 migration', ResponseCode.NOT_FOUND);
    }

    const tenantId = this.resolveScopedTenantId(ctx, payload.tenantId ?? ctx.tenantId);
    const duplicate = await AppDataSource.query<Array<{ id: number }>>(
      'SELECT id FROM permission_actions WHERE tenant_id = ? AND code = ? LIMIT 1',
      [tenantId, payload.code],
    );
    if (duplicate.length > 0) {
      throw new AppError('功能编码已存在', ResponseCode.ACCESS_ACTION_CODE_DUPLICATE, 409);
    }

    const result = await AppDataSource.query<Array<never>>(
      `INSERT INTO permission_actions
         (tenant_id, menu_id, code, name, action_type, status, default_enabled, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        tenantId,
        payload.menuId,
        payload.code,
        payload.name,
        payload.actionType ?? 'custom',
        normalizeStatus(payload.status, 'active'),
        payload.defaultEnabled === false ? 0 : 1,
        ctx.userId,
        ctx.userId,
      ],
    ) as unknown as { insertId?: number };

    return { id: Number(result.insertId ?? 0) };
  }

  async updateAction(ctx: TenantContext, actionId: number, payload: {
    code: string;
    name: string;
    actionType?: string;
    status?: string;
    defaultEnabled?: boolean;
  }) {
    if (!(await this.tableExists('permission_actions'))) {
      throw AppError.badRequest('请先执行权限控制模块 migration', ResponseCode.NOT_FOUND);
    }

    const [action] = await AppDataSource.query<Array<{ id: number; tenant_id: number }>>(
      'SELECT id, tenant_id FROM permission_actions WHERE id = ? AND tenant_id IN (0, ?) LIMIT 1',
      [actionId, ctx.tenantId],
    );
    if (!action) {
      throw AppError.notFound('功能点不存在', ResponseCode.NOT_FOUND);
    }
    if (Number(action.tenant_id) === 0) {
      throw new AppError('系统预置功能点不允许直接修改', ResponseCode.ACCESS_SYSTEM_OBJECT_PROTECTED, 403);
    }

    const duplicate = await AppDataSource.query<Array<{ id: number }>>(
      'SELECT id FROM permission_actions WHERE tenant_id = ? AND code = ? AND id <> ? LIMIT 1',
      [action.tenant_id, payload.code, actionId],
    );
    if (duplicate.length > 0) {
      throw new AppError('功能编码已存在', ResponseCode.ACCESS_ACTION_CODE_DUPLICATE, 409);
    }

    await AppDataSource.query(
      `UPDATE permission_actions
          SET code = ?,
              name = ?,
              action_type = ?,
              status = ?,
              default_enabled = ?,
              updated_by = ?,
              updated_at = NOW(3)
        WHERE id = ?`,
      [
        payload.code,
        payload.name,
        payload.actionType ?? 'custom',
        normalizeStatus(payload.status, 'active'),
        payload.defaultEnabled === false ? 0 : 1,
        ctx.userId,
        actionId,
      ],
    );

    return { success: true };
  }

  async deleteAction(ctx: TenantContext, actionId: number) {
    if (!(await this.tableExists('permission_actions'))) {
      throw AppError.badRequest('请先执行权限控制模块 migration', ResponseCode.NOT_FOUND);
    }

    const [action] = await AppDataSource.query<Array<{ id: number; tenant_id: number }>>(
      'SELECT id, tenant_id FROM permission_actions WHERE id = ? AND tenant_id IN (0, ?) LIMIT 1',
      [actionId, ctx.tenantId],
    );
    if (!action) {
      throw AppError.notFound('功能点不存在', ResponseCode.NOT_FOUND);
    }
    if (Number(action.tenant_id) === 0) {
      throw new AppError('系统预置功能点不允许删除', ResponseCode.ACCESS_SYSTEM_OBJECT_PROTECTED, 403);
    }

    await AppDataSource.query('DELETE FROM permission_actions WHERE id = ? AND tenant_id = ?', [actionId, action.tenant_id]);
    return { success: true };
  }

  async listRoles(ctx: TenantContext, query: ListQuery & { tenantId?: number; roleType?: string }) {
    const page = normalizePage(query.page);
    const pageSize = normalizePageSize(query.pageSize);
    const effectiveTenantId = this.resolveScopedTenantId(ctx, query.tenantId ?? ctx.tenantId);
    const hasStatus = await this.columnExists('roles', 'status');
    const hasRoleScope = await this.columnExists('roles', 'role_scope');
    const hasDataScopeTemplate = await this.columnExists('roles', 'data_scope_template');
    const hasPriority = await this.columnExists('roles', 'priority');
    const hasAssignable = await this.columnExists('roles', 'assignable');
    const where: string[] = ['r.tenant_id IN (0, ?)'];
    const params: Array<string | number> = [effectiveTenantId];
    const visibilityFilter = await this.buildRoleVisibilityFilter(ctx, 'r');
    const hiddenRoleFilter = this.buildTenantHiddenRoleFilter(ctx, 'r');
    where.push(visibilityFilter.clause);
    params.push(...visibilityFilter.params);
    where.push(hiddenRoleFilter.clause);
    params.push(...hiddenRoleFilter.params);

    if (query.keyword) {
      where.push('(r.name LIKE ? OR r.code LIKE ?)');
      params.push(`%${query.keyword}%`, `%${query.keyword}%`);
    }
    if (query.status && hasStatus) {
      where.push('r.status = ?');
      params.push(query.status);
    }
    if (query.roleType === 'system') {
      where.push('r.tenant_id = 0');
    } else if (query.roleType === 'custom') {
      where.push('r.tenant_id = ?');
      params.push(effectiveTenantId);
    }

    const [countRow] = await AppDataSource.query<Array<{ total: number }>>(
      `SELECT COUNT(*) AS total FROM roles r WHERE ${where.join(' AND ')}`,
      params,
    );

    const rows = await AppDataSource.query<Array<Record<string, unknown>>>(
      `SELECT r.id,
              r.tenant_id AS tenantId,
              r.code,
              r.name,
              r.description,
              CASE WHEN r.tenant_id = 0 THEN 'system' ELSE 'custom' END AS roleType,
              ${hasRoleScope ? 'r.role_scope' : "'tenant'"} AS roleScope,
              ${hasStatus ? 'r.status' : "'active'"} AS status,
              ${hasPriority ? 'r.priority' : '0'} AS priority,
              ${hasAssignable ? 'r.assignable' : '1'} AS assignable,
              ${hasDataScopeTemplate ? 'r.data_scope_template' : "'all'"} AS dataScopeTemplate,
              COUNT(DISTINCT ur.user_id) AS assignedUserCount,
              r.updated_at AS updatedAt
         FROM roles r
         LEFT JOIN user_roles ur ON ur.role_id = r.id AND ur.tenant_id = r.tenant_id
        WHERE ${where.join(' AND ')}
        GROUP BY r.id, r.tenant_id, r.code, r.name, r.description, r.updated_at${hasRoleScope ? ', r.role_scope' : ''}${hasStatus ? ', r.status' : ''}${hasPriority ? ', r.priority' : ''}${hasAssignable ? ', r.assignable' : ''}${hasDataScopeTemplate ? ', r.data_scope_template' : ''}
        ORDER BY r.tenant_id ASC, r.id ASC
        LIMIT ? OFFSET ?`,
      [...params, pageSize, (page - 1) * pageSize],
    );

    return buildPaginated(rows, Number(countRow?.total ?? 0), page, pageSize);
  }

  async listUsers(ctx: TenantContext, query: ListQuery & { tenantId?: number; roleId?: number; department?: string }) {
    const page = normalizePage(query.page);
    const pageSize = normalizePageSize(query.pageSize);
    const effectiveTenantId = this.resolveScopedTenantId(ctx, query.tenantId ?? ctx.tenantId);
    const where: string[] = ['u.tenant_id = ?'];
    const params: Array<string | number> = [effectiveTenantId];

    if (query.keyword) {
      where.push('(u.username LIKE ? OR u.real_name LIKE ?)');
      params.push(`%${query.keyword}%`, `%${query.keyword}%`);
    }
    if (query.status) {
      where.push('u.status = ?');
      params.push(query.status);
    }
    if (query.roleId) {
      where.push('ur.role_id = ?');
      params.push(query.roleId);
    }

    const [countRow] = await AppDataSource.query<Array<{ total: number }>>(
      `SELECT COUNT(DISTINCT u.id) AS total
         FROM users u
         LEFT JOIN user_roles ur ON ur.user_id = u.id AND ur.tenant_id = u.tenant_id
        WHERE ${where.join(' AND ')}`,
      params,
    );

    const rows = await AppDataSource.query<Array<Record<string, unknown>>>(
      `SELECT u.id,
              u.tenant_id AS tenantId,
              u.username,
              u.real_name AS realName,
              NULL AS phone,
              NULL AS email,
              NULL AS department,
              NULL AS position,
              u.status,
              COUNT(DISTINCT ur.role_id) AS roleCount,
              MIN(r.name) AS primaryRoleName,
              u.updated_at AS updatedAt
         FROM users u
         LEFT JOIN user_roles ur ON ur.user_id = u.id AND ur.tenant_id = u.tenant_id
         LEFT JOIN roles r ON r.id = ur.role_id AND r.tenant_id = ur.tenant_id
        WHERE ${where.join(' AND ')}
        GROUP BY u.id, u.tenant_id, u.username, u.real_name, u.status, u.updated_at
        ORDER BY u.id DESC
        LIMIT ? OFFSET ?`,
      [...params, pageSize, (page - 1) * pageSize],
    );

    return buildPaginated(rows, Number(countRow?.total ?? 0), page, pageSize);
  }

  async createRole(ctx: TenantContext, payload: {
    tenantId?: number;
    code: string;
    name: string;
    description?: string | null;
    priority?: number;
    status?: string;
    dataScopeTemplate?: string;
    assignable?: boolean;
  }) {
    const tenantId = this.resolveScopedTenantId(ctx, payload.tenantId ?? ctx.tenantId);
    const duplicate = await AppDataSource.query<Array<{ id: number }>>(
      'SELECT id FROM roles WHERE tenant_id = ? AND code = ? LIMIT 1',
      [tenantId, payload.code],
    );
    if (duplicate.length > 0) {
      throw new AppError('角色编码已存在', ResponseCode.ACCESS_ROLE_CODE_DUPLICATE, 409);
    }

    const hasStatus = await this.columnExists('roles', 'status');
    const hasPriority = await this.columnExists('roles', 'priority');
    const hasDataScopeTemplate = await this.columnExists('roles', 'data_scope_template');
    const hasAssignable = await this.columnExists('roles', 'assignable');
    const hasRoleType = await this.columnExists('roles', 'role_type');
    const hasCreatedBy = await this.columnExists('roles', 'created_by');
    const hasUpdatedBy = await this.columnExists('roles', 'updated_by');

    const columns = ['tenant_id', 'code', 'name', 'description', 'created_at', 'updated_at'];
    const values: Array<string | number | null> = [tenantId, payload.code, payload.name, payload.description ?? null];
    const placeholders = ['?', '?', '?', '?', 'NOW(3)', 'NOW(3)'];

    if (hasRoleType) {
      columns.push('role_type');
      placeholders.push('?');
      values.push('custom');
    }
    if (hasStatus) {
      columns.push('status');
      placeholders.push('?');
      values.push(normalizeStatus(payload.status, 'active'));
    }
    if (hasPriority) {
      columns.push('priority');
      placeholders.push('?');
      values.push(payload.priority ?? 0);
    }
    if (hasDataScopeTemplate) {
      columns.push('data_scope_template');
      placeholders.push('?');
      values.push(payload.dataScopeTemplate ?? 'all');
    }
    if (hasAssignable) {
      columns.push('assignable');
      placeholders.push('?');
      values.push(payload.assignable === false ? 0 : 1);
    }
    if (hasCreatedBy) {
      columns.push('created_by');
      placeholders.push('?');
      values.push(ctx.userId);
    }
    if (hasUpdatedBy) {
      columns.push('updated_by');
      placeholders.push('?');
      values.push(ctx.userId);
    }

    const result = await AppDataSource.query<Array<never>>(
      `INSERT INTO roles (${columns.join(', ')})
       VALUES (${placeholders.join(', ')})`,
      values,
    ) as unknown as { insertId?: number };

    const roleId = Number(result.insertId ?? 0);
    await this.writeAuditLog(ctx, {
      module: 'role',
      action: 'create',
      targetType: 'role',
      targetId: roleId,
      targetCode: payload.code,
      afterJson: { ...payload, tenantId },
      diffJson: { created: true },
    });
    return { id: roleId };
  }

  async updateRole(ctx: TenantContext, roleId: number, payload: {
    code: string;
    name: string;
    description?: string | null;
    priority?: number;
    status?: string;
    dataScopeTemplate?: string;
    assignable?: boolean;
  }) {
    const [role] = await AppDataSource.query<Array<{ id: number; tenant_id: number }>>(
      'SELECT id, tenant_id FROM roles WHERE id = ? AND tenant_id IN (0, ?) LIMIT 1',
      [roleId, ctx.tenantId],
    );
    if (!role) {
      throw AppError.notFound('角色不存在', ResponseCode.NOT_FOUND);
    }
    if (Number(role.tenant_id) === 0) {
      throw new AppError('系统预置角色不允许直接修改，请复制为租户角色后再编辑', ResponseCode.ACCESS_SYSTEM_OBJECT_PROTECTED, 403);
    }

    const duplicate = await AppDataSource.query<Array<{ id: number }>>(
      'SELECT id FROM roles WHERE tenant_id = ? AND code = ? AND id <> ? LIMIT 1',
      [role.tenant_id, payload.code, roleId],
    );
    if (duplicate.length > 0) {
      throw new AppError('角色编码已存在', ResponseCode.ACCESS_ROLE_CODE_DUPLICATE, 409);
    }

    const hasStatus = await this.columnExists('roles', 'status');
    const hasPriority = await this.columnExists('roles', 'priority');
    const hasDataScopeTemplate = await this.columnExists('roles', 'data_scope_template');
    const hasAssignable = await this.columnExists('roles', 'assignable');
    const hasUpdatedBy = await this.columnExists('roles', 'updated_by');

    const sets = ['code = ?', 'name = ?', 'description = ?', 'updated_at = NOW(3)'];
    const params: Array<string | number | null> = [payload.code, payload.name, payload.description ?? null];
    if (hasStatus) {
      sets.push('status = ?');
      params.push(normalizeStatus(payload.status, 'active'));
    }
    if (hasPriority) {
      sets.push('priority = ?');
      params.push(payload.priority ?? 0);
    }
    if (hasDataScopeTemplate) {
      sets.push('data_scope_template = ?');
      params.push(payload.dataScopeTemplate ?? 'all');
    }
    if (hasAssignable) {
      sets.push('assignable = ?');
      params.push(payload.assignable === false ? 0 : 1);
    }
    if (hasUpdatedBy) {
      sets.push('updated_by = ?');
      params.push(ctx.userId);
    }
    params.push(roleId);

    await AppDataSource.query(`UPDATE roles SET ${sets.join(', ')} WHERE id = ?`, params);
    await this.writeAuditLog(ctx, {
      module: 'role',
      action: 'update',
      targetType: 'role',
      targetId: roleId,
      targetCode: payload.code,
      afterJson: { ...payload, roleId },
      diffJson: { updated: ['code', 'name', 'description', 'status', 'priority', 'dataScopeTemplate', 'assignable'] },
    });
    return { success: true };
  }

  async updateRoleStatus(ctx: TenantContext, roleId: number, payload: { status: string }) {
    const [role] = await AppDataSource.query<Array<{ id: number; tenant_id: number }>>(
      'SELECT id, tenant_id FROM roles WHERE id = ? AND tenant_id IN (0, ?) LIMIT 1',
      [roleId, ctx.tenantId],
    );
    if (!role) {
      throw AppError.notFound('角色不存在', ResponseCode.NOT_FOUND);
    }
    if (Number(role.tenant_id) === 0) {
      throw new AppError('系统预置角色不允许直接停用', ResponseCode.ACCESS_SYSTEM_OBJECT_PROTECTED, 403);
    }

    const hasUpdatedBy = await this.columnExists('roles', 'updated_by');
    const sets = ['status = ?', 'updated_at = NOW(3)'];
    const params: Array<string | number> = [payload.status];
    if (hasUpdatedBy) {
      sets.push('updated_by = ?');
      params.push(ctx.userId);
    }
    params.push(roleId);

    await AppDataSource.query(`UPDATE roles SET ${sets.join(', ')} WHERE id = ?`, params);
    await this.writeAuditLog(ctx, {
      module: 'role',
      action: 'status',
      targetType: 'role',
      targetId: roleId,
      afterJson: { roleId, status: payload.status },
      diffJson: { status: payload.status },
    });
    return { success: true };
  }

  async createUser(ctx: TenantContext, payload: {
    tenantId?: number;
    username: string;
    realName: string;
    initialPassword?: string;
    status?: string;
  }) {
    const tenantId = this.resolveScopedTenantId(ctx, payload.tenantId ?? ctx.tenantId);
    const duplicate = await AppDataSource.query<Array<{ id: number }>>(
      'SELECT id FROM users WHERE tenant_id = ? AND username = ? LIMIT 1',
      [tenantId, payload.username],
    );
    if (duplicate.length > 0) {
      throw new AppError('人员账号已存在', ResponseCode.ACCESS_USER_DUPLICATE, 409);
    }

    const passwordHash = await bcrypt.hash(payload.initialPassword?.trim() || '123456', 10);
    const result = await AppDataSource.query<Array<never>>(
      `INSERT INTO users
         (tenant_id, username, password_hash, real_name, status, created_at, updated_at, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, NOW(3), NOW(3), ?, ?)`,
      [tenantId, payload.username, passwordHash, payload.realName, normalizeStatus(payload.status, 'active'), ctx.userId, ctx.userId],
    ) as unknown as { insertId?: number };

    const createdUserId = Number(result.insertId ?? 0);
    await this.writeAuditLog(ctx, {
      module: 'user',
      action: 'create',
      targetType: 'user',
      targetId: createdUserId,
      targetCode: payload.username,
      afterJson: { userId: createdUserId, username: payload.username, realName: payload.realName, status: normalizeStatus(payload.status, 'active') },
      diffJson: { created: true },
    });
    return { id: createdUserId };
  }

  async updateUser(ctx: TenantContext, userId: number, payload: {
    username: string;
    realName: string;
    status?: string;
  }) {
    const [user] = await AppDataSource.query<Array<{ id: number; tenant_id: number }>>(
      'SELECT id, tenant_id FROM users WHERE id = ? AND tenant_id = ? LIMIT 1',
      [userId, ctx.tenantId],
    );
    if (!user) {
      throw AppError.notFound('人员不存在', ResponseCode.NOT_FOUND);
    }

    const duplicate = await AppDataSource.query<Array<{ id: number }>>(
      'SELECT id FROM users WHERE tenant_id = ? AND username = ? AND id <> ? LIMIT 1',
      [ctx.tenantId, payload.username, userId],
    );
    if (duplicate.length > 0) {
      throw new AppError('人员账号已存在', ResponseCode.ACCESS_USER_DUPLICATE, 409);
    }

    await AppDataSource.query(
      `UPDATE users
          SET username = ?,
              real_name = ?,
              status = ?,
              updated_by = ?,
              updated_at = NOW(3)
        WHERE id = ? AND tenant_id = ?`,
      [payload.username, payload.realName, normalizeStatus(payload.status, 'active'), ctx.userId, userId, ctx.tenantId],
    );

    await this.writeAuditLog(ctx, {
      module: 'user',
      action: 'update',
      targetType: 'user',
      targetId: userId,
      targetCode: payload.username,
      afterJson: { userId, username: payload.username, realName: payload.realName, status: normalizeStatus(payload.status, 'active') },
      diffJson: { updated: ['username', 'realName', 'status'] },
    });

    return { success: true };
  }

  async updateUserStatus(ctx: TenantContext, userId: number, payload: { status: string }) {
    await AppDataSource.query(
      `UPDATE users
          SET status = ?,
              updated_by = ?,
              updated_at = NOW(3)
        WHERE id = ? AND tenant_id = ?`,
      [payload.status, ctx.userId, userId, ctx.tenantId],
    );
    await this.writeAuditLog(ctx, {
      module: 'user',
      action: 'status',
      targetType: 'user',
      targetId: userId,
      afterJson: { userId, status: payload.status },
      diffJson: { status: payload.status },
    });
    return { success: true };
  }

  async resetUserPassword(ctx: TenantContext, userId: number, payload: { newPassword?: string }) {
    const passwordHash = await bcrypt.hash(payload.newPassword?.trim() || '123456', 10);
    await AppDataSource.query(
      `UPDATE users
          SET password_hash = ?,
              updated_by = ?,
              updated_at = NOW(3)
        WHERE id = ? AND tenant_id = ?`,
      [passwordHash, ctx.userId, userId, ctx.tenantId],
    );
    await this.writeAuditLog(ctx, {
      module: 'user',
      action: 'reset_password',
      targetType: 'user',
      targetId: userId,
      diffJson: { passwordReset: true },
    });
    return { success: true };
  }

  async getRolePermissionDetail(ctx: TenantContext, roleId: number) {
    const hasRoleScope = await this.columnExists('roles', 'role_scope');
    const [role] = await AppDataSource.query<Array<{ id: number; code: string; name: string; tenant_id: number; roleScope?: string | null }>>(
      `SELECT id, code, name, tenant_id, ${hasRoleScope ? 'role_scope' : 'NULL'} AS roleScope
         FROM roles
        WHERE id = ? AND tenant_id IN (0, ?)
        LIMIT 1`,
      [roleId, ctx.tenantId],
    );
    if (!role) {
      throw AppError.notFound('角色不存在', ResponseCode.NOT_FOUND);
    }
    if (!(await this.isRoleVisibleToContext(ctx, role))) {
      throw AppError.notFound('角色不存在', ResponseCode.NOT_FOUND);
    }

    if (!(await this.tableExists('role_permissions'))) {
      const fallback = buildFallbackPermissionSnapshot([role.code]);
      return {
        roleId: role.id,
        roleCode: role.code,
        roleName: role.name,
        menuCodes: fallback.menuCodes,
        actionCodes: fallback.actionCodes,
        dataScopes: fallback.dataScopes,
        updatedAt: new Date().toISOString(),
      };
    }

    const rows = await AppDataSource.query<
      Array<{ permission_type: 'menu' | 'action' | 'data_scope'; permission_key: string; scope_type?: string; scope_value_json?: string | null }>
    >(
      `SELECT permission_type, permission_key, scope_type, scope_value_json
         FROM role_permissions
        WHERE tenant_id = ?
          AND role_id = ?`,
      [role.tenant_id, roleId],
    );

    return {
      roleId: role.id,
      roleCode: role.code,
      roleName: role.name,
      menuCodes: rows.filter((item) => item.permission_type === 'menu').map((item) => item.permission_key),
      actionCodes: rows.filter((item) => item.permission_type === 'action').map((item) => item.permission_key),
      dataScopes: rows
        .filter((item) => item.permission_type === 'data_scope')
        .map((item) => ({
          scopeType: item.scope_type ?? item.permission_key,
          scopeValues: parseJsonColumn<Array<number | string>>(item.scope_value_json, []),
        })),
      updatedAt: new Date().toISOString(),
    };
  }

  async updateRolePermissions(
    ctx: TenantContext,
    roleId: number,
    payload: { menuCodes?: string[]; actionCodes?: string[]; dataScopes?: Array<{ scopeType: string; scopeValues: Array<number | string> }> },
  ) {
    const [role] = await AppDataSource.query<Array<{ id: number; tenant_id: number }>>(
      'SELECT id, tenant_id FROM roles WHERE id = ? AND tenant_id IN (?, 0) LIMIT 1',
      [roleId, ctx.tenantId],
    );
    if (!role) {
      throw AppError.notFound('角色不存在', ResponseCode.NOT_FOUND);
    }
    if (Number(role.tenant_id) === 0) {
      throw AppError.forbidden('系统预置角色不允许直接修改，请复制为租户角色后再授权');
    }
    if (!(await this.tableExists('role_permissions'))) {
      return { success: true };
    }

    const before = await this.getRolePermissionDetail(ctx, roleId);

    await AppDataSource.transaction(async (manager) => {
      await manager.query('DELETE FROM role_permissions WHERE tenant_id = ? AND role_id = ?', [role.tenant_id, roleId]);

      const inserts: Array<Array<unknown>> = [];
      (payload.menuCodes ?? []).forEach((menuCode) => {
        inserts.push([role.tenant_id, roleId, 'menu', menuCode, null, null, null, ctx.userId]);
      });
      (payload.actionCodes ?? []).forEach((actionCode) => {
        inserts.push([role.tenant_id, roleId, 'action', actionCode, null, null, null, ctx.userId]);
      });
      (payload.dataScopes ?? []).forEach((scope) => {
        inserts.push([
          role.tenant_id,
          roleId,
          'data_scope',
          scope.scopeType,
          null,
          scope.scopeType,
          JSON.stringify(scope.scopeValues ?? []),
          ctx.userId,
        ]);
      });

      for (const row of inserts) {
        await manager.query(
          `INSERT INTO role_permissions
             (tenant_id, role_id, permission_type, permission_key, permission_ref_id, scope_type, scope_value_json, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          row,
        );
      }
    });

    const after = await this.getRolePermissionDetail(ctx, roleId);
    await this.writeAuditLog(ctx, {
      tenantId: role.tenant_id,
      module: 'role_permission',
      action: 'grant',
      targetType: 'role',
      targetId: roleId,
      targetCode: after.roleCode,
      beforeJson: before,
      afterJson: after,
      diffJson: {
        menuCodes: after.menuCodes,
        actionCodes: after.actionCodes,
        dataScopes: after.dataScopes,
      },
    });

    return { success: true };
  }

  async getUserRoleAssignments(ctx: TenantContext, userId: number) {
    const hasRoleScope = await this.columnExists('roles', 'role_scope');
    const visibilityFilter = await this.buildRoleVisibilityFilter(ctx, 'r');
    const hiddenRoleFilter = this.buildTenantHiddenRoleFilter(ctx, 'r');
    if (await this.tableExists('user_role_assignments')) {
      return AppDataSource.query(
        `SELECT ura.id,
                ura.user_id AS userId,
                ura.role_id AS roleId,
                r.code AS roleCode,
                r.name AS roleName,
                ura.is_primary AS isPrimary,
                ura.effective_from AS effectiveFrom,
                ura.effective_to AS effectiveTo,
                ura.assignment_status AS assignmentStatus
           FROM user_role_assignments ura
           INNER JOIN roles r ON r.id = ura.role_id AND r.tenant_id IN (0, ura.tenant_id)
          WHERE ura.tenant_id = ?
            AND ura.user_id = ?
            AND ${visibilityFilter.clause}
            AND ${hiddenRoleFilter.clause}
          ORDER BY ura.is_primary DESC, ura.id ASC`,
        [ctx.tenantId, userId, ...visibilityFilter.params, ...hiddenRoleFilter.params],
      );
    }

    return AppDataSource.query(
      `SELECT ur.id,
              ur.user_id AS userId,
              ur.role_id AS roleId,
              r.code AS roleCode,
              r.name AS roleName,
              0 AS isPrimary,
              NULL AS effectiveFrom,
              NULL AS effectiveTo,
              'active' AS assignmentStatus
         FROM user_roles ur
         INNER JOIN roles r ON r.id = ur.role_id AND r.tenant_id IN (0, ur.tenant_id)
        WHERE ur.tenant_id = ?
          AND ur.user_id = ?
          AND ${hasRoleScope ? "COALESCE(r.role_scope, 'tenant') <> 'platform'" : 'r.code <> ?'}
          AND ${hiddenRoleFilter.clause}
        ORDER BY ur.id ASC`,
      hasRoleScope
        ? [ctx.tenantId, userId, ...hiddenRoleFilter.params]
        : [ctx.tenantId, userId, 'platform_super_admin', ...hiddenRoleFilter.params],
    );
  }

  async assignUserRoles(
    ctx: TenantContext,
    userId: number,
    payload: { assignments: RoleAssignmentPayload[] },
  ) {
    const [user] = await AppDataSource.query<Array<{ id: number }>>(
      'SELECT id FROM users WHERE id = ? AND tenant_id = ? LIMIT 1',
      [userId, ctx.tenantId],
    );
    if (!user) {
      throw AppError.notFound('人员不存在', ResponseCode.NOT_FOUND);
    }

    const beforeAssignments = await this.getUserRoleAssignments(ctx, userId);
    const primaryCount = payload.assignments.filter((item) => item.isPrimary).length;
    if (primaryCount > 1) {
      throw AppError.badRequest('仅允许设置一个主角色', ResponseCode.INVALID_PARAMS);
    }

    const roleIds = Array.from(new Set(payload.assignments.map((item) => item.roleId)));
    const roleHasStatus = await this.columnExists('roles', 'status');
    const roleHasAssignable = await this.columnExists('roles', 'assignable');
    const roleHasScope = await this.columnExists('roles', 'role_scope');
    const roles = roleIds.length > 0
      ? await AppDataSource.query<Array<{
          id: number;
          tenantId: number;
          code: string;
          name: string;
          roleScope?: string | null;
          status?: string;
          assignable?: number;
        }>>(
          `SELECT id,
                  tenant_id AS tenantId,
                  code,
                  name,
                  ${roleHasScope ? 'role_scope' : 'NULL'} AS roleScope
                  ${roleHasStatus ? ', status' : ''}${roleHasAssignable ? ', assignable' : ''}
             FROM roles
            WHERE id IN (${buildInClause(roleIds)})
              AND tenant_id IN (0, ?)`,
          [...roleIds, ctx.tenantId],
        )
      : [];

    if (roles.length !== roleIds.length) {
      throw AppError.badRequest('存在不属于当前租户的角色，无法分配', ResponseCode.INVALID_PARAMS);
    }

    const platformRole = roles.find((role) =>
      roleHasScope
        ? (role.roleScope ?? 'tenant') === 'platform'
        : role.code === 'platform_super_admin',
    );
    if (platformRole && !this.isPlatformSuperAdmin(ctx)) {
      throw AppError.badRequest(`角色 ${platformRole.name} 不允许在租户态分配`, ResponseCode.INVALID_PARAMS);
    }

    const hiddenTenantRole = roles.find((role) => ctx.scopeLevel === 'tenant' && TENANT_HIDDEN_ROLE_CODES.has(role.code));
    if (hiddenTenantRole) {
      throw AppError.badRequest(`角色 ${hiddenTenantRole.name} 已停用旧编码，请改用 purchaser`, ResponseCode.INVALID_PARAMS);
    }

    const invalidRole = roles.find((role) => {
      if (roleHasStatus && role.status !== 'active') {
        return true;
      }
      if (roleHasAssignable && Number(role.assignable ?? 1) !== 1) {
        return true;
      }
      return false;
    });
    if (invalidRole) {
      throw AppError.badRequest(`角色 ${invalidRole.name} 当前不可分配`, ResponseCode.INVALID_PARAMS);
    }

    const invalidEffectiveWindow = payload.assignments.find(
      (assignment) => assignment.effectiveFrom
        && assignment.effectiveTo
        && new Date(assignment.effectiveFrom).getTime() > new Date(assignment.effectiveTo).getTime(),
    );
    if (invalidEffectiveWindow) {
      throw AppError.badRequest('角色生效时间不能晚于失效时间', ResponseCode.INVALID_PARAMS);
    }

    const hasTimedAssignments = await this.tableExists('user_role_assignments');

    await AppDataSource.transaction(async (manager) => {
      if (hasTimedAssignments) {
        await manager.query('DELETE FROM user_role_assignments WHERE tenant_id = ? AND user_id = ?', [ctx.tenantId, userId]);
      }
      await manager.query('DELETE FROM user_roles WHERE tenant_id = ? AND user_id = ?', [ctx.tenantId, userId]);

      for (const assignment of payload.assignments) {
        if (hasTimedAssignments) {
          await manager.query(
            `INSERT INTO user_role_assignments
               (tenant_id, user_id, role_id, is_primary, effective_from, effective_to, assignment_status, source_type, created_by, updated_by)
             VALUES (?, ?, ?, ?, ?, ?, 'active', 'manual', ?, ?)`,
            [
              ctx.tenantId,
              userId,
              assignment.roleId,
              assignment.isPrimary ? 1 : 0,
              assignment.effectiveFrom ?? null,
              assignment.effectiveTo ?? null,
              ctx.userId,
              ctx.userId,
            ],
          );
        }

        if (!hasTimedAssignments || isAssignmentEffectiveNow(assignment)) {
          await manager.query(
            `INSERT INTO user_roles (tenant_id, user_id, role_id, created_at)
             VALUES (?, ?, ?, NOW(3))`,
            [ctx.tenantId, userId, assignment.roleId],
          );
        }
      }
    });

    const afterAssignments = await this.getUserRoleAssignments(ctx, userId);
    await this.writeAuditLog(ctx, {
      module: 'user_role_assignment',
      action: 'assign',
      targetType: 'user',
      targetId: userId,
      beforeJson: { assignments: beforeAssignments },
      afterJson: { assignments: afterAssignments },
      diffJson: {
        roleIds: payload.assignments.map((item) => item.roleId),
        primaryRoleId: payload.assignments.find((item) => item.isPrimary)?.roleId ?? null,
      },
    });

    return { success: true };
  }

  async listAuditLogs(
    ctx: TenantContext,
    query: ListQuery & {
      tenantId?: number;
      module?: string;
      targetType?: string;
      operatorId?: number;
      dateFrom?: string;
      dateTo?: string;
    },
  ) {
    if (!(await this.tableExists('access_audit_logs'))) {
      return buildPaginated([], 0, normalizePage(query.page), normalizePageSize(query.pageSize));
    }

    const page = normalizePage(query.page);
    const pageSize = normalizePageSize(query.pageSize);
    const tenantId = this.resolveScopedTenantId(ctx, query.tenantId ?? ctx.tenantId);
    const where: string[] = ['tenant_id = ?'];
    const params: Array<string | number> = [tenantId];

    if (query.keyword) {
      where.push('(target_code LIKE ? OR operator_name LIKE ?)');
      params.push(`%${query.keyword}%`, `%${query.keyword}%`);
    }
    if (query.module) {
      where.push('module = ?');
      params.push(query.module);
    }
    if (query.targetType) {
      where.push('target_type = ?');
      params.push(query.targetType);
    }
    if (query.operatorId) {
      where.push('operator_id = ?');
      params.push(query.operatorId);
    }
    if (query.dateFrom) {
      where.push('created_at >= ?');
      params.push(query.dateFrom);
    }
    if (query.dateTo) {
      where.push('created_at <= ?');
      params.push(query.dateTo);
    }

    const [countRow] = await AppDataSource.query<Array<{ total: number }>>(
      `SELECT COUNT(*) AS total FROM access_audit_logs WHERE ${where.join(' AND ')}`,
      params,
    );

    const rows = await AppDataSource.query<Array<Record<string, unknown>>>(
      `SELECT id,
              tenant_id AS tenantId,
              module,
              action,
              target_type AS targetType,
              target_id AS targetId,
              target_code AS targetCode,
              before_json AS beforeJson,
              after_json AS afterJson,
              diff_json AS diffJson,
              operator_id AS operatorId,
              operator_name AS operatorName,
              trace_id AS traceId,
              created_at AS createdAt
         FROM access_audit_logs
        WHERE ${where.join(' AND ')}
        ORDER BY created_at DESC, id DESC
        LIMIT ? OFFSET ?`,
      [...params, pageSize, (page - 1) * pageSize],
    );

    return buildPaginated(rows.map((row) => ({
      ...row,
      beforeJson: parseJsonColumn<Record<string, unknown> | null>(row.beforeJson, null),
      afterJson: parseJsonColumn<Record<string, unknown> | null>(row.afterJson, null),
      diffJson: parseJsonColumn<Record<string, unknown> | null>(row.diffJson, null),
    })), Number(countRow?.total ?? 0), page, pageSize);
  }
}

export const accessControlService = new AccessControlService();
