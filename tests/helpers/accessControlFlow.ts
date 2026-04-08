import mysql, { type Pool, type RowDataPacket } from '../../services/api/node_modules/mysql2/promise';
import type { Page } from '@playwright/test';

export const APP_BASE_URL = (process.env.PLAYWRIGHT_APP_BASE_URL ?? 'http://127.0.0.1:5173').replace(/\/$/, '');

const DB_HOST = process.env.DB_HOST ?? '127.0.0.1';
const DB_PORT = Number(process.env.DB_PORT ?? '3307');
const DB_USER = process.env.DB_USER ?? 'sf_app';
const DB_PASS = process.env.DB_PASS ?? process.env.DB_PASSWORD ?? 'TestApp2026!Secure';
const DB_NAME = process.env.DB_NAME ?? 'smart_factory';
const TEST_USER_ID = 99001;
const ADMIN_USERNAME = process.env.PLAYWRIGHT_SYSTEM_ADMIN_USERNAME ?? 'admin_dev';
const ADMIN_PASSWORD = process.env.PLAYWRIGHT_SYSTEM_ADMIN_PASSWORD ?? 'Dev123!2026';
const ADMIN_TENANT_CODE = process.env.PLAYWRIGHT_SYSTEM_ADMIN_TENANT ?? 'FACTORY001';
const PLATFORM_USER_ID = 99002;
const PLATFORM_ROLE_ID = 99012;
const PLATFORM_USERNAME = process.env.PLAYWRIGHT_PLATFORM_ADMIN_USERNAME ?? 'platform_root_playwright';
const PLATFORM_PASSWORD = process.env.PLAYWRIGHT_PLATFORM_ADMIN_PASSWORD ?? 'Dev123!2026';
const PLATFORM_REAL_NAME = process.env.PLAYWRIGHT_PLATFORM_ADMIN_REAL_NAME ?? 'Playwright平台管理员';
const DEV_PASSWORD_HASH = '$2b$10$MmgwQ9xr9HEolYqOUjcpUumg/M3wle7C3ySCi4ziZSCnJfAl1zacO';

let dbPool: Pool | null = null;

interface AuditRow extends RowDataPacket {
  id: number;
  target_code: string;
  module: string;
  action: string;
}

interface FeatureFlagRow extends RowDataPacket {
  is_enabled: number;
}

interface CountRow extends RowDataPacket {
  total: number;
}

export interface AccessControlScenario {
  tenantId: number;
  tenantCode: string;
  tenantName: string;
  toggleFeatureCode: string;
}

function getDbPool(): Pool {
  if (!dbPool) {
    dbPool = mysql.createPool({
      host: DB_HOST,
      port: DB_PORT,
      user: DB_USER,
      password: DB_PASS,
      database: DB_NAME,
      connectionLimit: 4,
      waitForConnections: true,
    });
  }
  return dbPool;
}

function nextScenarioIds() {
  const suffix = `${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 10)}`;
  return {
    tenantId: Number(`97${suffix}`),
    suffix,
  };
}

async function poll<T>(
  fn: () => Promise<T | null>,
  timeoutMs = 12_000,
  intervalMs = 300,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await fn();
    if (result) return result;
    if (Date.now() >= deadline) {
      throw new Error('Timed out while polling access control flow data');
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

async function tableExists(tableName: string): Promise<boolean> {
  const [rows] = await getDbPool().query<CountRow[]>(
    `SELECT COUNT(*) AS total
       FROM information_schema.tables
      WHERE table_schema = DATABASE()
        AND table_name = ?`,
    [tableName],
  );
  return Number(rows[0]?.total ?? 0) > 0;
}

async function columnExists(tableName: string, columnName: string): Promise<boolean> {
  const [rows] = await getDbPool().query<CountRow[]>(
    `SELECT COUNT(*) AS total
       FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = ?
        AND column_name = ?`,
    [tableName, columnName],
  );
  return Number(rows[0]?.total ?? 0) > 0;
}

export async function closeAccessControlFlowDbPool(): Promise<void> {
  if (dbPool) {
    const pool = dbPool;
    dbPool = null;
    await pool.end();
  }
}

export async function loginAsSystemAdmin(page: Page): Promise<void> {
  await page.goto(`${APP_BASE_URL}/login`);
  await page.locator('#username').fill(ADMIN_USERNAME);
  await page.locator('#password').fill(ADMIN_PASSWORD);
  await page.locator('#tenantCode').fill(ADMIN_TENANT_CODE);
  await Promise.all([
    page.waitForURL(/\/dashboard$/),
    page.getByRole('button', { name: '登录' }).click(),
  ]);
}

export async function loginAsPlatformSuperAdmin(page: Page): Promise<void> {
  await page.goto(`${APP_BASE_URL}/login`);
  await page.locator('#loginMode').selectOption('platform');
  await page.locator('#username').fill(PLATFORM_USERNAME);
  await page.locator('#password').fill(PLATFORM_PASSWORD);
  await Promise.all([
    page.waitForURL(/\/dashboard$/),
    page.getByRole('button', { name: '登录' }).click(),
  ]);
}

export async function ensurePlatformSuperAdminAccount(): Promise<void> {
  const pool = getDbPool();
  const [
    hasRoleScope,
    hasRoleType,
    hasRoleStatus,
    hasRolePriority,
    hasDataScopeTemplate,
    hasAssignable,
    hasRolePermissions,
    hasRoleCreatedBy,
    hasRoleUpdatedBy,
    hasUserRoleAssignments,
  ] = await Promise.all([
    columnExists('roles', 'role_scope'),
    columnExists('roles', 'role_type'),
    columnExists('roles', 'status'),
    columnExists('roles', 'priority'),
    columnExists('roles', 'data_scope_template'),
    columnExists('roles', 'assignable'),
    columnExists('roles', 'permissions'),
    columnExists('roles', 'created_by'),
    columnExists('roles', 'updated_by'),
    tableExists('user_role_assignments'),
  ]);

  const roleColumns = ['id', 'tenant_id', 'code', 'name', 'description'];
  const rolePlaceholders = ['?', '?', '?', '?', '?'];
  const roleValues: Array<number | string> = [
    PLATFORM_ROLE_ID,
    0,
    'platform_super_admin',
    '平台超级管理员',
    'Playwright 平台登录测试角色',
  ];
  const roleUpdates = [
    'code = VALUES(code)',
    'name = VALUES(name)',
    'description = VALUES(description)',
  ];

  if (hasRoleType) {
    roleColumns.push('role_type');
    rolePlaceholders.push('?');
    roleValues.push('system');
    roleUpdates.push('role_type = VALUES(role_type)');
  }
  if (hasRoleStatus) {
    roleColumns.push('status');
    rolePlaceholders.push('?');
    roleValues.push('active');
    roleUpdates.push('status = VALUES(status)');
  }
  if (hasRoleScope) {
    roleColumns.push('role_scope');
    rolePlaceholders.push('?');
    roleValues.push('platform');
    roleUpdates.push('role_scope = VALUES(role_scope)');
  }
  if (hasRolePriority) {
    roleColumns.push('priority');
    rolePlaceholders.push('?');
    roleValues.push(999);
    roleUpdates.push('priority = VALUES(priority)');
  }
  if (hasDataScopeTemplate) {
    roleColumns.push('data_scope_template');
    rolePlaceholders.push('?');
    roleValues.push('all');
    roleUpdates.push('data_scope_template = VALUES(data_scope_template)');
  }
  if (hasAssignable) {
    roleColumns.push('assignable');
    rolePlaceholders.push('?');
    roleValues.push(1);
    roleUpdates.push('assignable = VALUES(assignable)');
  }
  if (hasRolePermissions) {
    roleColumns.push('permissions');
    rolePlaceholders.push('JSON_ARRAY()');
    roleUpdates.push('permissions = VALUES(permissions)');
  }
  if (hasRoleCreatedBy) {
    roleColumns.push('created_by');
    rolePlaceholders.push('?');
    roleValues.push(0);
  }
  if (hasRoleUpdatedBy) {
    roleColumns.push('updated_by');
    rolePlaceholders.push('?');
    roleValues.push(0);
    roleUpdates.push('updated_by = VALUES(updated_by)');
  }

  await pool.execute(
    `INSERT INTO roles
      (${roleColumns.join(', ')})
     VALUES
      (${rolePlaceholders.join(', ')})
     ON DUPLICATE KEY UPDATE
      ${roleUpdates.join(', ')},
      updated_at = NOW(3)`,
    roleValues,
  );

  await pool.execute(
    `INSERT INTO users
      (id, tenant_id, username, password_hash, real_name, status, created_by, updated_by)
     VALUES
      (?, 0, ?, ?, ?, 'active', 0, 0)
     ON DUPLICATE KEY UPDATE
      username = VALUES(username),
      password_hash = VALUES(password_hash),
      real_name = VALUES(real_name),
      status = VALUES(status),
      updated_by = VALUES(updated_by),
      updated_at = NOW(3)`,
    [PLATFORM_USER_ID, PLATFORM_USERNAME, DEV_PASSWORD_HASH, PLATFORM_REAL_NAME],
  );

  await pool.execute(
    `INSERT INTO role_permissions
      (tenant_id, role_id, permission_type, permission_key, permission_ref_id, scope_type, scope_value_json, created_by)
     VALUES
      (0, ?, 'menu', 'system.management', NULL, NULL, NULL, 0),
      (0, ?, 'menu', 'system.tenant.config', NULL, NULL, NULL, 0),
      (0, ?, 'action', 'system.tenant.manage', NULL, NULL, NULL, 0),
      (0, ?, 'action', 'platform.tenant.switch', NULL, NULL, NULL, 0),
      (0, ?, 'action', 'system.audit.view', NULL, NULL, NULL, 0)
     ON DUPLICATE KEY UPDATE
      permission_key = VALUES(permission_key)`,
    [PLATFORM_ROLE_ID, PLATFORM_ROLE_ID, PLATFORM_ROLE_ID, PLATFORM_ROLE_ID, PLATFORM_ROLE_ID],
  );

  if (hasUserRoleAssignments) {
    const [
      hasAssignmentRoleScope,
      hasIsPrimary,
      hasEffectiveFrom,
      hasEffectiveTo,
      hasAssignmentStatus,
      hasSourceType,
      hasRemark,
      hasAssignmentCreatedBy,
      hasAssignmentUpdatedBy,
    ] = await Promise.all([
      columnExists('user_role_assignments', 'role_scope'),
      columnExists('user_role_assignments', 'is_primary'),
      columnExists('user_role_assignments', 'effective_from'),
      columnExists('user_role_assignments', 'effective_to'),
      columnExists('user_role_assignments', 'assignment_status'),
      columnExists('user_role_assignments', 'source_type'),
      columnExists('user_role_assignments', 'remark'),
      columnExists('user_role_assignments', 'created_by'),
      columnExists('user_role_assignments', 'updated_by'),
    ]);

    const assignmentColumns = ['tenant_id', 'user_id', 'role_id'];
    const assignmentPlaceholders = ['?', '?', '?'];
    const assignmentValues: Array<number | string | null> = [0, PLATFORM_USER_ID, PLATFORM_ROLE_ID];
    const assignmentUpdates = ['role_id = VALUES(role_id)'];

    if (hasAssignmentRoleScope) {
      assignmentColumns.push('role_scope');
      assignmentPlaceholders.push('?');
      assignmentValues.push('platform');
      assignmentUpdates.push('role_scope = VALUES(role_scope)');
    }
    if (hasIsPrimary) {
      assignmentColumns.push('is_primary');
      assignmentPlaceholders.push('?');
      assignmentValues.push(1);
      assignmentUpdates.push('is_primary = VALUES(is_primary)');
    }
    if (hasEffectiveFrom) {
      assignmentColumns.push('effective_from');
      assignmentPlaceholders.push('?');
      assignmentValues.push(null);
    }
    if (hasEffectiveTo) {
      assignmentColumns.push('effective_to');
      assignmentPlaceholders.push('?');
      assignmentValues.push(null);
    }
    if (hasAssignmentStatus) {
      assignmentColumns.push('assignment_status');
      assignmentPlaceholders.push('?');
      assignmentValues.push('active');
      assignmentUpdates.push('assignment_status = VALUES(assignment_status)');
    }
    if (hasSourceType) {
      assignmentColumns.push('source_type');
      assignmentPlaceholders.push('?');
      assignmentValues.push('manual');
    }
    if (hasRemark) {
      assignmentColumns.push('remark');
      assignmentPlaceholders.push('?');
      assignmentValues.push('Playwright seeded platform admin');
    }
    if (hasAssignmentCreatedBy) {
      assignmentColumns.push('created_by');
      assignmentPlaceholders.push('?');
      assignmentValues.push(0);
    }
    if (hasAssignmentUpdatedBy) {
      assignmentColumns.push('updated_by');
      assignmentPlaceholders.push('?');
      assignmentValues.push(0);
      assignmentUpdates.push('updated_by = VALUES(updated_by)');
    }

    await pool.execute(
      `INSERT INTO user_role_assignments
        (${assignmentColumns.join(', ')})
       VALUES
        (${assignmentPlaceholders.join(', ')})
       ON DUPLICATE KEY UPDATE
        ${assignmentUpdates.join(', ')},
        updated_at = NOW(3)`,
      assignmentValues,
    );

    return;
  }

  await pool.execute(
    `INSERT IGNORE INTO user_roles (tenant_id, user_id, role_id)
     VALUES (?, ?, ?)`,
    [0, PLATFORM_USER_ID, PLATFORM_ROLE_ID],
  );
}

export async function seedAccessControlScenario(): Promise<AccessControlScenario> {
  const pool = getDbPool();
  const { tenantId, suffix } = nextScenarioIds();
  const tenantCode = `PWAC${suffix}`;
  const tenantName = `Playwright权限租户-${suffix}`;
  const toggleFeatureCode = 'tenant_admin';

  await pool.execute(
    `INSERT INTO tenants (id, code, name, status, settings, created_at, updated_at)
     VALUES (?, ?, ?, 'active', JSON_OBJECT(), NOW(3), NOW(3))
     ON DUPLICATE KEY UPDATE
       code = VALUES(code),
       name = VALUES(name),
       status = VALUES(status),
       settings = VALUES(settings),
       updated_at = NOW(3)`,
    [tenantId, tenantCode, tenantName],
  );

  await pool.execute(
    `INSERT INTO tenant_feature_flags
       (tenant_id, feature_code, feature_name, is_enabled, source_type, remark, created_by, updated_by)
     VALUES
       (?, 'rbac_center', '权限中心', 1, 'manual', 'Playwright seeded flag', ?, ?),
       (?, 'tenant_admin', '租户治理能力', 1, 'manual', 'Playwright seeded flag', ?, ?)
     ON DUPLICATE KEY UPDATE
       feature_name = VALUES(feature_name),
       is_enabled = VALUES(is_enabled),
       source_type = VALUES(source_type),
       remark = VALUES(remark),
       updated_by = VALUES(updated_by),
       updated_at = NOW(3)`,
    [tenantId, TEST_USER_ID, TEST_USER_ID, tenantId, TEST_USER_ID, TEST_USER_ID],
  );

  await pool.execute(
    'DELETE FROM access_audit_logs WHERE target_code = ? AND module = ?',
    [tenantCode, 'tenant_feature'],
  );

  return { tenantId, tenantCode, tenantName, toggleFeatureCode };
}

export async function cleanupAccessControlScenario(scenario: AccessControlScenario): Promise<void> {
  const pool = getDbPool();
  await pool.execute('DELETE FROM access_audit_logs WHERE target_code = ?', [scenario.tenantCode]);
  await pool.execute('DELETE FROM tenant_feature_flags WHERE tenant_id = ?', [scenario.tenantId]);
  await pool.execute('DELETE FROM tenants WHERE id = ?', [scenario.tenantId]);
}

export async function waitForFeatureFlagState(
  tenantId: number,
  featureCode: string,
  enabled: boolean,
): Promise<void> {
  await poll(async () => {
    const [rows] = await getDbPool().query<FeatureFlagRow[]>(
      'SELECT is_enabled FROM tenant_feature_flags WHERE tenant_id = ? AND feature_code = ? LIMIT 1',
      [tenantId, featureCode],
    );
    if (rows[0] && Boolean(rows[0].is_enabled) === enabled) {
      return rows[0];
    }
    return null;
  });
}

export async function waitForAuditLog(
  tenantCode: string,
  module = 'tenant_feature',
): Promise<AuditRow> {
  return poll(async () => {
    const [rows] = await getDbPool().query<AuditRow[]>(
      `SELECT id, target_code, module, action
         FROM access_audit_logs
        WHERE target_code = ?
          AND module = ?
        ORDER BY id DESC
        LIMIT 1`,
      [tenantCode, module],
    );
    return rows[0] ?? null;
  });
}
