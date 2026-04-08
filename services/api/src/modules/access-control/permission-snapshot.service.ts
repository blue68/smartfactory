import { AppDataSource } from '../../config/database';
import { PermissionDataScope, PermissionSnapshot } from './access-control.types';

interface BuildPermissionSnapshotInput {
  tenantId: number;
  userId: number;
  roleCodes?: string[];
}

const ROLE_MENU_FALLBACK: Record<string, string[]> = {
  boss: [
    'system.management',
    'system.menu.config',
    'system.role.config',
    'system.user.config',
    'system.role.permission.config',
    'system.user.role.assignment',
  ],
  admin: [
    'system.management',
    'system.menu.config',
    'system.role.config',
    'system.user.config',
    'system.role.permission.config',
    'system.user.role.assignment',
  ],
  tenant_admin: [
    'system.management',
    'system.menu.config',
    'system.role.config',
    'system.user.config',
    'system.role.permission.config',
    'system.user.role.assignment',
  ],
};

const ROLE_ACTION_FALLBACK: Record<string, string[]> = {
  boss: [
    'system.menu.manage',
    'system.role.manage',
    'system.user.manage',
    'system.role.grant',
    'system.user.assign',
    'system.audit.view',
  ],
  admin: [
    'system.menu.manage',
    'system.role.manage',
    'system.user.manage',
    'system.role.grant',
    'system.user.assign',
    'system.audit.view',
  ],
  tenant_admin: [
    'system.menu.manage',
    'system.role.manage',
    'system.user.manage',
    'system.role.grant',
    'system.user.assign',
  ],
};

const BOSS_LIKE_ROLES = new Set(['boss', 'admin', 'tenant_admin']);

export class PermissionSnapshotService {
  async buildForUser(input: BuildPermissionSnapshotInput): Promise<PermissionSnapshot> {
    const roleCodes = input.roleCodes && input.roleCodes.length > 0
      ? unique(input.roleCodes)
      : await this.getUserRoleCodes(input.userId, input.tenantId);

    const roleMenus = new Set<string>();
    const roleActions = new Set<string>();
    const dataScopes: PermissionDataScope[] = [];
    const timestamps: number[] = [];

    for (const roleCode of roleCodes) {
      for (const menuCode of ROLE_MENU_FALLBACK[roleCode] ?? []) {
        roleMenus.add(menuCode);
      }
      for (const actionCode of ROLE_ACTION_FALLBACK[roleCode] ?? []) {
        roleActions.add(actionCode);
      }
    }

    try {
      const roleRows = await AppDataSource.query<Array<{ id: number; updated_at: string | null }>>(
        `SELECT id, updated_at
         FROM roles
         WHERE code IN (${buildInClause(roleCodes)})
           AND tenant_id IN (?, 0)`,
        [...roleCodes, input.tenantId],
      );

      for (const row of roleRows) {
        if (row.updated_at) {
          timestamps.push(new Date(row.updated_at).getTime());
        }
      }

      if (roleRows.length > 0) {
        const roleIds = roleRows.map((row) => row.id);
        const permissionRows = await AppDataSource.query<Array<{
          permission_type: 'menu' | 'action' | 'data_scope';
          permission_key: string;
          scope_type: string | null;
          scope_value_json: string | null;
          created_at: string | null;
        }>>(
          `SELECT permission_type, permission_key, scope_type, CAST(scope_value_json AS CHAR) AS scope_value_json, created_at
           FROM role_permissions
           WHERE role_id IN (${buildInClause(roleIds)})`,
          roleIds,
        );

        for (const row of permissionRows) {
          if (row.permission_type === 'menu') {
            roleMenus.add(row.permission_key);
          } else if (row.permission_type === 'action') {
            roleActions.add(row.permission_key);
          } else {
            dataScopes.push({
              scopeType: row.scope_type ?? 'all',
              scopeValues: parseScopeValues(row.scope_value_json),
            });
          }
          if (row.created_at) {
            timestamps.push(new Date(row.created_at).getTime());
          }
        }
      }
    } catch (err) {
      if (!isMissingTableError(err)) {
        throw err;
      }
      // migration 未执行时回退到角色预置映射，避免影响登录
    }

    let featureFlags: string[] = [];
    try {
      const featureRows = await AppDataSource.query<Array<{ feature_code: string; updated_at: string | null }>>(
        `SELECT feature_code, updated_at
         FROM tenant_feature_flags
         WHERE tenant_id = ?
           AND is_enabled = 1
           AND (expires_at IS NULL OR expires_at > NOW())`,
        [input.tenantId],
      );
      featureFlags = featureRows.map((row) => row.feature_code);
      for (const row of featureRows) {
        if (row.updated_at) {
          timestamps.push(new Date(row.updated_at).getTime());
        }
      }
    } catch (err) {
      if (!isMissingTableError(err)) {
        throw err;
      }
    }

    if (featureFlags.length === 0 && roleCodes.some((role) => BOSS_LIKE_ROLES.has(role))) {
      featureFlags = ['rbac_center'];
    }

    return {
      version: formatVersion(timestamps.length > 0 ? Math.max(...timestamps) : Date.now()),
      scopeLevel: 'tenant',
      originTenantId: input.tenantId,
      contextTenantId: input.tenantId,
      menuCodes: unique(Array.from(roleMenus)),
      actionCodes: unique(Array.from(roleActions)),
      dataScopes: normalizeDataScopes(dataScopes),
      featureFlags: unique(featureFlags),
    };
  }

  async getUserRoleCodes(userId: number, tenantId: number): Promise<string[]> {
    try {
      const assignmentRoles = await AppDataSource.query<Array<{ code: string }>>(
        `SELECT DISTINCT r.code
         FROM user_role_assignments ura
         INNER JOIN roles r ON r.id = ura.role_id
         WHERE ura.user_id = ?
           AND ura.tenant_id = ?
           AND ura.assignment_status = 'active'
           AND (ura.effective_from IS NULL OR ura.effective_from <= NOW())
           AND (ura.effective_to IS NULL OR ura.effective_to >= NOW())`,
        [userId, tenantId],
      );
      if (assignmentRoles.length > 0) {
        return unique(assignmentRoles.map((row) => row.code));
      }
    } catch (err) {
      if (!isMissingTableError(err)) {
        throw err;
      }
    }

    const userRoles = await AppDataSource.query<Array<{ code: string }>>(
      `SELECT DISTINCT r.code
       FROM user_roles ur
       INNER JOIN roles r ON r.id = ur.role_id
       WHERE ur.user_id = ?
         AND ur.tenant_id = ?`,
      [userId, tenantId],
    );
    return unique(userRoles.map((row) => row.code));
  }
}

function buildInClause(values: Array<string | number>): string {
  if (values.length === 0) {
    return 'NULL';
  }
  return values.map(() => '?').join(',');
}

function parseScopeValues(raw: string | null): Array<string | number> {
  if (!raw) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .filter((item): item is string | number => typeof item === 'string' || typeof item === 'number');
    }
  } catch {
    // ignore malformed JSON
  }
  return [];
}

function normalizeDataScopes(items: PermissionDataScope[]): PermissionDataScope[] {
  const grouped = new Map<string, Set<string | number>>();
  for (const item of items) {
    const existing = grouped.get(item.scopeType) ?? new Set<string | number>();
    for (const value of item.scopeValues) {
      existing.add(value);
    }
    grouped.set(item.scopeType, existing);
  }

  return Array.from(grouped.entries()).map(([scopeType, values]) => ({
    scopeType,
    scopeValues: Array.from(values),
  }));
}

function formatVersion(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hour = String(date.getUTCHours()).padStart(2, '0');
  const minute = String(date.getUTCMinutes()).padStart(2, '0');
  const second = String(date.getUTCSeconds()).padStart(2, '0');
  return `${year}${month}${day}T${hour}${minute}${second}Z`;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function isMissingTableError(error: unknown): boolean {
  const err = error as { code?: string; errno?: number };
  return err.code === 'ER_NO_SUCH_TABLE' || err.code === 'ER_BAD_FIELD_ERROR' || err.errno === 1146;
}

export const permissionSnapshotService = new PermissionSnapshotService();
