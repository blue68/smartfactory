import request from "supertest";
import bcrypt from "bcrypt";
import mysql, { Pool, type RowDataPacket } from "mysql2/promise";

const BASE_URL = process.env.TEST_API_URL ?? "http://localhost:3000";
const TEST_TENANT_ID = 9997;
const TEST_TENANT_CODE = "TEST9997";
const TEST_TENANT_NAME = "权限集成测试租户";

const ADMIN_USER_ID = 997001;
const TARGET_USER_ID = 997002;
const ADMIN_ROLE_ID = 997101;
const TARGET_ROLE_ID = 997102;
const PLATFORM_USER_ID = 997003;
const PLATFORM_ROLE_SEED_ID = 997103;

const ADMIN_USERNAME = "access_admin_int";
const TARGET_USERNAME = "access_user_int";
const PLATFORM_USERNAME = "platform_root_int";
const LOGIN_PASSWORD = "AccessInt!2026";

const ADMIN_ROLE_CODE = "ac_int_admin";
const TARGET_ROLE_CODE = "ac_int_operator";
const PLATFORM_ROLE_CODE = "platform_super_admin";

const MENU_MANAGE_ACTION_CODE = "system.menu.manage";
const GRANTED_MENU_CODE = "system.role.permission.config";
const GRANTED_ACTION_CODE = "system.audit.view";
const REFRESHED_ACTION_CODE = "system.menu.manage";
const CUSTOM_MENU_CODE = "access.control.integration.menu";
const CUSTOM_ACTION_CODE = "access.control.integration.action";

let dbPool: Pool | null = null;
let platformRoleId = PLATFORM_ROLE_SEED_ID;
let platformRoleCreated = false;

interface RolePermRow extends RowDataPacket {
  permission_type: "menu" | "action" | "data_scope";
  permission_key: string;
}

interface AssignmentRow extends RowDataPacket {
  role_id: number;
  is_primary: number;
  assignment_status: string;
}

interface CountRow extends RowDataPacket {
  total: number;
}

interface IdRow extends RowDataPacket {
  id: number;
}

interface TenantFeatureRow extends RowDataPacket {
  feature_code: string;
  is_enabled: number;
}

interface BootstrapAssignmentRow extends RowDataPacket {
  role_code: string;
  source_type: string;
}

function getDbPool(): Pool {
  if (!dbPool) {
    dbPool = mysql.createPool({
      host: process.env.DB_HOST ?? "127.0.0.1",
      port: Number(process.env.DB_PORT ?? "3307"),
      user: process.env.DB_USER ?? "sf_app",
      password:
        process.env.DB_PASS ?? process.env.DB_PASSWORD ?? "TestApp2026!Secure",
      database: process.env.DB_NAME ?? "smart_factory",
      connectionLimit: 2,
      waitForConnections: true,
    });
  }
  return dbPool;
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

async function cleanupTenantCascade(tenantId: number) {
  const pool = getDbPool();
  await pool.execute("DELETE FROM access_audit_logs WHERE tenant_id = ?", [tenantId]);
  await pool.execute("DELETE FROM user_role_assignments WHERE tenant_id = ?", [tenantId]);
  await pool.execute("DELETE FROM user_roles WHERE tenant_id = ?", [tenantId]);
  await pool.execute("DELETE FROM tenant_feature_flags WHERE tenant_id = ?", [tenantId]);
  await pool.execute("DELETE FROM users WHERE tenant_id = ?", [tenantId]);
  await pool.execute("DELETE FROM tenants WHERE id = ?", [tenantId]);
}

async function login(
  agent: ReturnType<typeof request.agent>,
  username: string,
  tenantCode = TEST_TENANT_CODE,
  password = LOGIN_PASSWORD,
) {
  const response = await agent.post("/api/auth/login").send({
    username,
    password,
    tenantCode,
  });

  expect(response.status).toBe(200);
  expect(response.body.code).toBe(0);
  expect(response.body.data.accessToken).toEqual(expect.any(String));
  return response.body.data as {
    accessToken: string;
    permissionSnapshot: {
      scopeLevel?: string;
      originTenantId?: number;
      contextTenantId?: number | null;
      menuCodes: string[];
      actionCodes: string[];
      featureFlags: string[];
    };
    user?: {
      scopeLevel?: string;
      originTenantId?: number;
      contextTenantId?: number | null;
      tenantId?: number;
      tenantName?: string;
      roles?: string[];
    };
  };
}

async function platformLogin(agent: ReturnType<typeof request.agent>) {
  const response = await agent.post("/api/auth/login").send({
    loginMode: "platform",
    username: PLATFORM_USERNAME,
    password: LOGIN_PASSWORD,
  });

  expect(response.status).toBe(200);
  expect(response.body.code).toBe(0);
  expect(response.body.data.accessToken).toEqual(expect.any(String));
  return response.body.data as {
    accessToken: string;
    permissionSnapshot: {
      scopeLevel: string;
      originTenantId: number;
      contextTenantId: number | null;
      menuCodes: string[];
      actionCodes: string[];
      featureFlags: string[];
    };
    user: {
      scopeLevel: string;
      originTenantId: number;
      contextTenantId: number | null;
      tenantId: number;
      tenantName: string;
      roles: string[];
    };
  };
}

describe("权限控制模块 API 集成测试", () => {
  beforeAll(async () => {
    const pool = getDbPool();
    const passwordHash = await bcrypt.hash(LOGIN_PASSWORD, 10);
    const [hasRoleScopeColumn, hasAssignmentRoleScopeColumn] = await Promise.all([
      columnExists("roles", "role_scope"),
      columnExists("user_role_assignments", "role_scope"),
    ]);
    const [existingPlatformRoles] = await pool.query<IdRow[]>(
      "SELECT id FROM roles WHERE tenant_id = 0 AND code = ? LIMIT 1",
      [PLATFORM_ROLE_CODE],
    );
    platformRoleId = Number(existingPlatformRoles[0]?.id ?? PLATFORM_ROLE_SEED_ID);
    platformRoleCreated = existingPlatformRoles.length === 0;

    await pool.execute(
      `INSERT INTO tenants (id, code, name, status, settings)
       VALUES (?, ?, ?, 'active', JSON_OBJECT())
       ON DUPLICATE KEY UPDATE
         code = VALUES(code),
         name = VALUES(name),
         status = VALUES(status),
         settings = VALUES(settings)`,
      [TEST_TENANT_ID, TEST_TENANT_CODE, TEST_TENANT_NAME],
    );

    await pool.execute("DELETE FROM access_audit_logs WHERE tenant_id = ?", [
      TEST_TENANT_ID,
    ]);
    await pool.execute(
      "DELETE FROM user_role_assignments WHERE tenant_id = ?",
      [TEST_TENANT_ID],
    );
    await pool.execute(
      "DELETE FROM user_role_assignments WHERE tenant_id = 0 AND user_id = ?",
      [PLATFORM_USER_ID],
    );
    await pool.execute("DELETE FROM user_roles WHERE tenant_id = ?", [
      TEST_TENANT_ID,
    ]);
    await pool.execute("DELETE FROM role_permissions WHERE tenant_id = ?", [
      TEST_TENANT_ID,
    ]);
    await pool.execute("DELETE FROM users WHERE tenant_id = 0 AND id = ?", [
      PLATFORM_USER_ID,
    ]);
    await pool.execute("DELETE FROM users WHERE tenant_id = ?", [
      TEST_TENANT_ID,
    ]);
    await pool.execute("DELETE FROM roles WHERE tenant_id = ?", [
      TEST_TENANT_ID,
    ]);
    await pool.execute("DELETE FROM tenant_feature_flags WHERE tenant_id = ?", [
      TEST_TENANT_ID,
    ]);

    await pool.execute(
      `INSERT INTO tenant_feature_flags
         (tenant_id, feature_code, feature_name, is_enabled, source_type, remark, created_by, updated_by)
       VALUES
         (?, 'rbac_center', '权限中心', 1, 'manual', 'access control integration', 0, 0),
         (?, 'tenant_admin', '租户治理能力', 1, 'manual', 'access control integration', 0, 0)
       ON DUPLICATE KEY UPDATE
         is_enabled = VALUES(is_enabled),
         updated_by = VALUES(updated_by),
         updated_at = NOW(3)`,
      [TEST_TENANT_ID, TEST_TENANT_ID],
    );

    await pool.execute(
      `INSERT INTO roles
        (id, tenant_id, code, name, description, role_type, status, priority, data_scope_template, assignable, permissions, created_by, updated_by)
       VALUES
        (?, ?, ?, '权限集成管理员', '权限集成测试管理员', 'custom', 'active', 100, 'all', 1, JSON_ARRAY(), 0, 0),
        (?, ?, ?, '权限集成目标角色', '用于验证角色授权与快照刷新', 'custom', 'active', 10, 'self', 1, JSON_ARRAY(), 0, 0)
       ON DUPLICATE KEY UPDATE
        code = VALUES(code),
        name = VALUES(name),
        description = VALUES(description),
        role_type = VALUES(role_type),
        status = VALUES(status),
        priority = VALUES(priority),
        data_scope_template = VALUES(data_scope_template),
        assignable = VALUES(assignable),
        permissions = VALUES(permissions),
        updated_by = VALUES(updated_by),
        updated_at = NOW(3)`,
      [
        ADMIN_ROLE_ID,
        TEST_TENANT_ID,
        ADMIN_ROLE_CODE,
        TARGET_ROLE_ID,
        TEST_TENANT_ID,
        TARGET_ROLE_CODE,
      ],
    );

    await pool.execute(
      hasRoleScopeColumn
        ? `INSERT INTO roles
            (id, tenant_id, code, name, description, role_type, status, role_scope, priority, data_scope_template, assignable, permissions, created_by, updated_by)
           VALUES
            (?, 0, ?, '平台超级管理员', '用于验证平台态登录与显式切租户', 'system', 'active', 'platform', 999, 'all', 1, JSON_ARRAY(), 0, 0)
           ON DUPLICATE KEY UPDATE
            code = VALUES(code),
            name = VALUES(name),
            description = VALUES(description),
            role_type = VALUES(role_type),
            status = VALUES(status),
            role_scope = VALUES(role_scope),
            priority = VALUES(priority),
            data_scope_template = VALUES(data_scope_template),
            assignable = VALUES(assignable),
            permissions = VALUES(permissions),
            updated_by = VALUES(updated_by),
            updated_at = NOW(3)`
        : `INSERT INTO roles
            (id, tenant_id, code, name, description, role_type, status, priority, data_scope_template, assignable, permissions, created_by, updated_by)
           VALUES
            (?, 0, ?, '平台超级管理员', '用于验证平台态登录与显式切租户', 'system', 'active', 999, 'all', 1, JSON_ARRAY(), 0, 0)
           ON DUPLICATE KEY UPDATE
            code = VALUES(code),
            name = VALUES(name),
            description = VALUES(description),
            role_type = VALUES(role_type),
            status = VALUES(status),
            priority = VALUES(priority),
            data_scope_template = VALUES(data_scope_template),
            assignable = VALUES(assignable),
            permissions = VALUES(permissions),
            updated_by = VALUES(updated_by),
            updated_at = NOW(3)`,
      [platformRoleId, PLATFORM_ROLE_CODE],
    );

    await pool.execute(
      `INSERT INTO role_permissions
        (tenant_id, role_id, permission_type, permission_key, permission_ref_id, scope_type, scope_value_json, created_by)
       VALUES
        (?, ?, 'menu', 'system.management', NULL, NULL, NULL, 0),
        (?, ?, 'menu', 'system.tenant.config', NULL, NULL, NULL, 0),
        (?, ?, 'menu', 'system.menu.config', NULL, NULL, NULL, 0),
        (?, ?, 'menu', 'system.role.permission.config', NULL, NULL, NULL, 0),
        (?, ?, 'menu', 'system.user.role.assignment', NULL, NULL, NULL, 0),
        (?, ?, 'menu', 'system.user.config', NULL, NULL, NULL, 0),
        (?, ?, 'action', 'system.tenant.manage', NULL, NULL, NULL, 0),
        (?, ?, 'action', 'system.menu.manage', NULL, NULL, NULL, 0),
        (?, ?, 'action', 'system.role.grant', NULL, NULL, NULL, 0),
        (?, ?, 'action', 'system.user.assign', NULL, NULL, NULL, 0),
        (?, ?, 'action', 'system.user.manage', NULL, NULL, NULL, 0),
        (?, ?, 'action', 'system.audit.view', NULL, NULL, NULL, 0)
       ON DUPLICATE KEY UPDATE
        permission_key = VALUES(permission_key)`,
      [
        TEST_TENANT_ID,
        ADMIN_ROLE_ID,
        TEST_TENANT_ID,
        ADMIN_ROLE_ID,
        TEST_TENANT_ID,
        ADMIN_ROLE_ID,
        TEST_TENANT_ID,
        ADMIN_ROLE_ID,
        TEST_TENANT_ID,
        ADMIN_ROLE_ID,
        TEST_TENANT_ID,
        ADMIN_ROLE_ID,
        TEST_TENANT_ID,
        ADMIN_ROLE_ID,
        TEST_TENANT_ID,
        ADMIN_ROLE_ID,
        TEST_TENANT_ID,
        ADMIN_ROLE_ID,
        TEST_TENANT_ID,
        ADMIN_ROLE_ID,
        TEST_TENANT_ID,
        ADMIN_ROLE_ID,
        TEST_TENANT_ID,
        ADMIN_ROLE_ID,
      ],
    );

    await pool.execute(
      `INSERT INTO users
        (id, tenant_id, username, password_hash, real_name, status, created_by, updated_by)
       VALUES
        (?, ?, ?, ?, '权限管理员', 'active', 0, 0),
        (?, ?, ?, ?, '权限目标人员', 'active', 0, 0)
       ON DUPLICATE KEY UPDATE
        username = VALUES(username),
        password_hash = VALUES(password_hash),
        real_name = VALUES(real_name),
        status = VALUES(status),
        updated_by = VALUES(updated_by)`,
      [
        ADMIN_USER_ID,
        TEST_TENANT_ID,
        ADMIN_USERNAME,
        passwordHash,
        TARGET_USER_ID,
        TEST_TENANT_ID,
        TARGET_USERNAME,
        passwordHash,
      ],
    );

    await pool.execute(
      `INSERT INTO users
        (id, tenant_id, username, password_hash, real_name, status, created_by, updated_by)
       VALUES
        (?, 0, ?, ?, '平台权限管理员', 'active', 0, 0)
       ON DUPLICATE KEY UPDATE
        username = VALUES(username),
        password_hash = VALUES(password_hash),
        real_name = VALUES(real_name),
        status = VALUES(status),
        updated_by = VALUES(updated_by)`,
      [PLATFORM_USER_ID, PLATFORM_USERNAME, passwordHash],
    );

    await pool.execute(
      `INSERT INTO user_role_assignments
        (tenant_id, user_id, role_id, is_primary, effective_from, effective_to, assignment_status, source_type, remark, created_by, updated_by)
       VALUES
        (?, ?, ?, 1, NULL, NULL, 'active', 'manual', 'access control integration', 0, 0)
       ON DUPLICATE KEY UPDATE
        is_primary = VALUES(is_primary),
        assignment_status = VALUES(assignment_status),
        updated_by = VALUES(updated_by),
        updated_at = NOW(3)`,
      [TEST_TENANT_ID, ADMIN_USER_ID, ADMIN_ROLE_ID],
    );

    await pool.execute(
      hasAssignmentRoleScopeColumn
        ? `INSERT INTO user_role_assignments
            (tenant_id, user_id, role_id, role_scope, is_primary, effective_from, effective_to, assignment_status, source_type, remark, created_by, updated_by)
           VALUES
            (0, ?, ?, 'platform', 1, NULL, NULL, 'active', 'manual', 'platform access control integration', 0, 0)
           ON DUPLICATE KEY UPDATE
            role_scope = VALUES(role_scope),
            is_primary = VALUES(is_primary),
            assignment_status = VALUES(assignment_status),
            updated_by = VALUES(updated_by),
            updated_at = NOW(3)`
        : `INSERT INTO user_role_assignments
            (tenant_id, user_id, role_id, is_primary, effective_from, effective_to, assignment_status, source_type, remark, created_by, updated_by)
           VALUES
            (0, ?, ?, 1, NULL, NULL, 'active', 'manual', 'platform access control integration', 0, 0)
           ON DUPLICATE KEY UPDATE
            is_primary = VALUES(is_primary),
            assignment_status = VALUES(assignment_status),
            updated_by = VALUES(updated_by),
            updated_at = NOW(3)`,
      [PLATFORM_USER_ID, platformRoleId],
    );

    await pool.execute(
      `INSERT INTO user_roles (tenant_id, user_id, role_id, created_at)
       VALUES (?, ?, ?, NOW(3))
       ON DUPLICATE KEY UPDATE
        role_id = VALUES(role_id)`,
      [TEST_TENANT_ID, ADMIN_USER_ID, ADMIN_ROLE_ID],
    );
  });

  afterAll(async () => {
    if (dbPool) {
      await dbPool.execute(
        "DELETE FROM access_audit_logs WHERE tenant_id = ?",
        [TEST_TENANT_ID],
      );
      await dbPool.execute(
        "DELETE FROM user_role_assignments WHERE tenant_id = ?",
        [TEST_TENANT_ID],
      );
      await dbPool.execute(
        "DELETE FROM user_role_assignments WHERE tenant_id = 0 AND user_id = ?",
        [PLATFORM_USER_ID],
      );
      await dbPool.execute("DELETE FROM user_roles WHERE tenant_id = ?", [
        TEST_TENANT_ID,
      ]);
      await dbPool.execute("DELETE FROM role_permissions WHERE tenant_id = ?", [
        TEST_TENANT_ID,
      ]);
      await dbPool.execute("DELETE FROM users WHERE tenant_id = 0 AND id = ?", [
        PLATFORM_USER_ID,
      ]);
      await dbPool.execute("DELETE FROM users WHERE tenant_id = ?", [
        TEST_TENANT_ID,
      ]);
      await dbPool.execute("DELETE FROM roles WHERE tenant_id = ?", [
        TEST_TENANT_ID,
      ]);
      if (platformRoleCreated) {
        await dbPool.execute(
          "DELETE FROM role_permissions WHERE tenant_id = 0 AND role_id = ?",
          [platformRoleId],
        );
        await dbPool.execute("DELETE FROM roles WHERE tenant_id = 0 AND id = ?", [
          platformRoleId,
        ]);
      }
      await dbPool.execute(
        "DELETE FROM tenant_feature_flags WHERE tenant_id = ?",
        [TEST_TENANT_ID],
      );
      await dbPool.execute("DELETE FROM tenants WHERE id = ?", [
        TEST_TENANT_ID,
      ]);
      await dbPool.end();
      dbPool = null;
    }
  });

  test("管理员可更新角色授权并读取最新授权明细", async () => {
    const adminAgent = request.agent(BASE_URL);
    const adminLogin = await login(adminAgent, ADMIN_USERNAME);

    expect(adminLogin.permissionSnapshot.actionCodes).toEqual(
      expect.arrayContaining([
        MENU_MANAGE_ACTION_CODE,
        "system.role.grant",
        "system.user.assign",
      ]),
    );
    expect(adminLogin.permissionSnapshot.featureFlags).toContain("rbac_center");

    const grantResponse = await adminAgent
      .put(`/api/access-control/roles/${TARGET_ROLE_ID}/permissions`)
      .set("Authorization", `Bearer ${adminLogin.accessToken}`)
      .send({
        menuCodes: [GRANTED_MENU_CODE],
        actionCodes: [GRANTED_ACTION_CODE],
        dataScopes: [{ scopeType: "warehouse", scopeValues: ["WH-A"] }],
      });

    expect(grantResponse.status).toBe(200);
    expect(grantResponse.body.code).toBe(0);

    const detailResponse = await adminAgent
      .get(`/api/access-control/roles/${TARGET_ROLE_ID}/permissions`)
      .set("Authorization", `Bearer ${adminLogin.accessToken}`);

    expect(detailResponse.status).toBe(200);
    expect(detailResponse.body.code).toBe(0);
    expect(detailResponse.body.data.roleCode).toBe(TARGET_ROLE_CODE);
    expect(detailResponse.body.data.menuCodes).toEqual(
      expect.arrayContaining([GRANTED_MENU_CODE]),
    );
    expect(detailResponse.body.data.actionCodes).toEqual(
      expect.arrayContaining([GRANTED_ACTION_CODE]),
    );
    expect(detailResponse.body.data.dataScopes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          scopeType: "warehouse",
          scopeValues: ["WH-A"],
        }),
      ]),
    );

    const [rows] = await getDbPool().query<RolePermRow[]>(
      `SELECT permission_type, permission_key
         FROM role_permissions
        WHERE tenant_id = ? AND role_id = ?
        ORDER BY permission_type, permission_key`,
      [TEST_TENANT_ID, TARGET_ROLE_ID],
    );
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          permission_type: "menu",
          permission_key: GRANTED_MENU_CODE,
        }),
        expect.objectContaining({
          permission_type: "action",
          permission_key: GRANTED_ACTION_CODE,
        }),
        expect.objectContaining({
          permission_type: "data_scope",
          permission_key: "warehouse",
        }),
      ]),
    );
  });

  test("人员分配后登录可拿到权限快照，角色改权后 refresh 返回最新快照", async () => {
    const adminAgent = request.agent(BASE_URL);
    const adminLogin = await login(adminAgent, ADMIN_USERNAME);

    const assignResponse = await adminAgent
      .put(`/api/access-control/users/${TARGET_USER_ID}/role-assignments`)
      .set("Authorization", `Bearer ${adminLogin.accessToken}`)
      .send({
        assignments: [
          {
            roleId: TARGET_ROLE_ID,
            isPrimary: true,
            effectiveFrom: null,
            effectiveTo: null,
          },
        ],
      });

    expect(assignResponse.status).toBe(200);
    expect(assignResponse.body.code).toBe(0);

    const assignmentDetailResponse = await adminAgent
      .get(`/api/access-control/users/${TARGET_USER_ID}/role-assignments`)
      .set("Authorization", `Bearer ${adminLogin.accessToken}`);

    expect(assignmentDetailResponse.status).toBe(200);
    expect(assignmentDetailResponse.body.code).toBe(0);
    expect(assignmentDetailResponse.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          roleId: String(TARGET_ROLE_ID),
          roleCode: TARGET_ROLE_CODE,
          isPrimary: 1,
        }),
      ]),
    );

    const [assignmentRows] = await getDbPool().query<AssignmentRow[]>(
      `SELECT role_id, is_primary, assignment_status
         FROM user_role_assignments
        WHERE tenant_id = ? AND user_id = ?`,
      [TEST_TENANT_ID, TARGET_USER_ID],
    );
    expect(
      assignmentRows.some(
        (row) =>
          Number(row.role_id) === TARGET_ROLE_ID &&
          Number(row.is_primary) === 1 &&
          row.assignment_status === "active",
      ),
    ).toBe(true);

    const targetAgent = request.agent(BASE_URL);
    const targetLogin = await login(targetAgent, TARGET_USERNAME);

    expect(targetLogin.permissionSnapshot.menuCodes).toEqual(
      expect.arrayContaining([GRANTED_MENU_CODE]),
    );
    expect(targetLogin.permissionSnapshot.actionCodes).toEqual(
      expect.arrayContaining([GRANTED_ACTION_CODE]),
    );
    expect(targetLogin.permissionSnapshot.actionCodes).not.toContain(
      REFRESHED_ACTION_CODE,
    );

    const regrantResponse = await adminAgent
      .put(`/api/access-control/roles/${TARGET_ROLE_ID}/permissions`)
      .set("Authorization", `Bearer ${adminLogin.accessToken}`)
      .send({
        menuCodes: ["system.menu.config"],
        actionCodes: [REFRESHED_ACTION_CODE],
        dataScopes: [{ scopeType: "department", scopeValues: ["CUTTING"] }],
      });

    expect(regrantResponse.status).toBe(200);
    expect(regrantResponse.body.code).toBe(0);

    const refreshResponse = await targetAgent.post("/api/auth/refresh");
    expect(refreshResponse.status).toBe(200);
    expect(refreshResponse.body.code).toBe(0);
    expect(refreshResponse.body.data.permissionSnapshot.actionCodes).toEqual(
      expect.arrayContaining([REFRESHED_ACTION_CODE]),
    );
    expect(
      refreshResponse.body.data.permissionSnapshot.actionCodes,
    ).not.toContain(GRANTED_ACTION_CODE);
    expect(refreshResponse.body.data.permissionSnapshot.menuCodes).toEqual(
      expect.arrayContaining(["system.menu.config"]),
    );
    expect(
      refreshResponse.body.data.permissionSnapshot.menuCodes,
    ).not.toContain(GRANTED_MENU_CODE);
  });

  test("管理员可维护租户功能开关并通过审计接口查询变更", async () => {
    const platformAgent = request.agent(BASE_URL);
    const platformAuth = await platformLogin(platformAgent);

    const featureListResponse = await platformAgent
      .get(`/api/access-control/tenants/${TEST_TENANT_ID}/feature-flags`)
      .set("Authorization", `Bearer ${platformAuth.accessToken}`);

    expect(featureListResponse.status).toBe(200);
    expect(featureListResponse.body.code).toBe(0);
    expect(featureListResponse.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ featureCode: "rbac_center", isEnabled: 1 }),
        expect.objectContaining({ featureCode: "tenant_admin", isEnabled: 1 }),
      ]),
    );

    const updateResponse = await platformAgent
      .put(`/api/access-control/tenants/${TEST_TENANT_ID}/feature-flags`)
      .set("Authorization", `Bearer ${platformAuth.accessToken}`)
      .send({
        flags: [
          {
            featureCode: "rbac_center",
            featureName: "权限中心",
            isEnabled: true,
            sourceType: "manual",
            remark: "access-control-test",
          },
          {
            featureCode: "tenant_admin",
            featureName: "租户治理能力",
            isEnabled: false,
            sourceType: "manual",
            remark: "access-control-test",
          },
        ],
      });

    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body.code).toBe(0);

    const auditResponse = await platformAgent
      .get(
        `/api/access-control/audit-logs?tenantId=${TEST_TENANT_ID}&module=tenant_feature&keyword=${TEST_TENANT_CODE}`,
      )
      .set("Authorization", `Bearer ${platformAuth.accessToken}`);

    expect(auditResponse.status).toBe(200);
    expect(auditResponse.body.code).toBe(0);
    expect(auditResponse.body.data.list).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          module: "tenant_feature",
          action: "update",
          targetCode: TEST_TENANT_CODE,
        }),
      ]),
    );
    expect(auditResponse.body.data.list[0].diffJson.updatedFlags).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ featureCode: "tenant_admin", isEnabled: 0 }),
      ]),
    );
  });

  test("管理员可完成菜单与功能点 CRUD", async () => {
    const adminAgent = request.agent(BASE_URL);
    const adminLogin = await login(adminAgent, ADMIN_USERNAME);

    const createMenuResponse = await adminAgent
      .post("/api/access-control/menus")
      .set("Authorization", `Bearer ${adminLogin.accessToken}`)
      .send({
        parentId: 9001001,
        menuType: "page",
        code: CUSTOM_MENU_CODE,
        name: "权限集成菜单",
        routePath: "/system/access-control-test",
        icon: "tool",
        groupName: "权限测试",
        sortOrder: 880,
        status: "active",
        defaultVisible: true,
      });

    expect(createMenuResponse.status).toBe(201);
    expect(createMenuResponse.body.code).toBe(0);
    const menuId = Number(createMenuResponse.body.data.id);
    expect(menuId).toBeGreaterThan(0);

    const updateMenuResponse = await adminAgent
      .put(`/api/access-control/menus/${menuId}`)
      .set("Authorization", `Bearer ${adminLogin.accessToken}`)
      .send({
        parentId: 9001001,
        menuType: "page",
        code: CUSTOM_MENU_CODE,
        name: "权限集成菜单-更新",
        routePath: "/system/access-control-test-updated",
        icon: "tool",
        groupName: "权限测试",
        sortOrder: 881,
        status: "active",
        defaultVisible: true,
      });

    expect(updateMenuResponse.status).toBe(200);
    expect(updateMenuResponse.body.code).toBe(0);

    const treeResponse = await adminAgent
      .get(
        `/api/access-control/menus/tree?tenantId=${TEST_TENANT_ID}&keyword=${CUSTOM_MENU_CODE}`,
      )
      .set("Authorization", `Bearer ${adminLogin.accessToken}`);

    expect(treeResponse.status).toBe(200);
    expect(treeResponse.body.code).toBe(0);
    expect(JSON.stringify(treeResponse.body.data)).toContain(CUSTOM_MENU_CODE);
    expect(JSON.stringify(treeResponse.body.data)).toContain("权限集成菜单-更新");

    const createActionResponse = await adminAgent
      .post("/api/access-control/actions")
      .set("Authorization", `Bearer ${adminLogin.accessToken}`)
      .send({
        menuId,
        code: CUSTOM_ACTION_CODE,
        name: "权限集成功能点",
        actionType: "custom",
        status: "active",
        defaultEnabled: true,
      });

    expect(createActionResponse.status).toBe(201);
    expect(createActionResponse.body.code).toBe(0);
    const actionId = Number(createActionResponse.body.data.id);
    expect(actionId).toBeGreaterThan(0);

    const listActionsResponse = await adminAgent
      .get(`/api/access-control/menus/${menuId}/actions`)
      .set("Authorization", `Bearer ${adminLogin.accessToken}`);

    expect(listActionsResponse.status).toBe(200);
    expect(listActionsResponse.body.code).toBe(0);
    expect(listActionsResponse.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: String(actionId), code: CUSTOM_ACTION_CODE }),
      ]),
    );

    const updateActionResponse = await adminAgent
      .put(`/api/access-control/actions/${actionId}`)
      .set("Authorization", `Bearer ${adminLogin.accessToken}`)
      .send({
        code: CUSTOM_ACTION_CODE,
        name: "权限集成功能点-更新",
        actionType: "custom",
        status: "inactive",
        defaultEnabled: false,
      });

    expect(updateActionResponse.status).toBe(200);
    expect(updateActionResponse.body.code).toBe(0);

    const deleteActionResponse = await adminAgent
      .delete(`/api/access-control/actions/${actionId}`)
      .set("Authorization", `Bearer ${adminLogin.accessToken}`);

    expect(deleteActionResponse.status).toBe(200);
    expect(deleteActionResponse.body.code).toBe(0);

    const deleteMenuResponse = await adminAgent
      .delete(`/api/access-control/menus/${menuId}`)
      .set("Authorization", `Bearer ${adminLogin.accessToken}`);

    expect(deleteMenuResponse.status).toBe(200);
    expect(deleteMenuResponse.body.code).toBe(0);
  });

  test("platform_super_admin 可平台登录、切入租户，再退出回平台态", async () => {
    const platformAgent = request.agent(BASE_URL);
    const platformAuth = await platformLogin(platformAgent);

    expect(platformAuth.user.scopeLevel).toBe("platform");
    expect(platformAuth.user.originTenantId).toBe(0);
    expect(platformAuth.user.contextTenantId).toBeNull();
    expect(platformAuth.user.tenantId).toBe(0);
    expect(platformAuth.user.roles).toEqual(
      expect.arrayContaining([PLATFORM_ROLE_CODE]),
    );
    expect(platformAuth.permissionSnapshot.actionCodes).toEqual(
      expect.arrayContaining(["platform.tenant.switch", "system.tenant.manage"]),
    );

    const switchResponse = await platformAgent
      .post("/api/auth/switch-tenant")
      .set("Authorization", `Bearer ${platformAuth.accessToken}`)
      .send({ targetTenantId: TEST_TENANT_ID });

    expect(switchResponse.status).toBe(200);
    expect(switchResponse.body.code).toBe(0);
    expect(switchResponse.body.data.user.scopeLevel).toBe("tenant");
    expect(switchResponse.body.data.user.originTenantId).toBe(0);
    expect(switchResponse.body.data.user.contextTenantId).toBe(TEST_TENANT_ID);
    expect(Number(switchResponse.body.data.user.tenantId)).toBe(TEST_TENANT_ID);
    expect(switchResponse.body.data.permissionSnapshot.scopeLevel).toBe("tenant");
    expect(switchResponse.body.data.permissionSnapshot.contextTenantId).toBe(
      TEST_TENANT_ID,
    );
    expect(switchResponse.body.data.permissionSnapshot.actionCodes).toEqual(
      expect.arrayContaining(["system.role.manage"]),
    );
    expect(switchResponse.body.data.permissionSnapshot.menuCodes).not.toContain(
      "system.tenant.config",
    );
    expect(switchResponse.body.data.permissionSnapshot.actionCodes).not.toContain(
      "system.tenant.manage",
    );
    expect(switchResponse.body.data.permissionSnapshot.actionCodes).not.toContain(
      "platform.tenant.switch",
    );

    const tenantListResponse = await platformAgent
      .get("/api/access-control/tenants")
      .set("Authorization", `Bearer ${switchResponse.body.data.accessToken}`);

    expect(tenantListResponse.status).toBe(403);
    expect(tenantListResponse.body.code).not.toBe(0);
    expect(tenantListResponse.body.message).toContain("system.tenant.manage");

    const platformTenantListResponse = await platformAgent
      .get("/api/access-control/tenants")
      .set("Authorization", `Bearer ${platformAuth.accessToken}`);

    expect(platformTenantListResponse.status).toBe(200);
    expect(platformTenantListResponse.body.code).toBe(0);
    expect(platformTenantListResponse.body.data.list).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: String(TEST_TENANT_ID), code: TEST_TENANT_CODE }),
      ]),
    );

    const exitResponse = await platformAgent
      .post("/api/auth/exit-tenant-context")
      .set("Authorization", `Bearer ${switchResponse.body.data.accessToken}`)
      .send({});

    expect(exitResponse.status).toBe(200);
    expect(exitResponse.body.code).toBe(0);
    expect(exitResponse.body.data.user.scopeLevel).toBe("platform");
    expect(exitResponse.body.data.user.contextTenantId).toBeNull();
    expect(Number(exitResponse.body.data.user.tenantId)).toBe(0);

    const auditResponse = await platformAgent
      .get(
        `/api/access-control/audit-logs?tenantId=${TEST_TENANT_ID}&module=platform_context`,
      )
      .set("Authorization", `Bearer ${switchResponse.body.data.accessToken}`);

    expect(auditResponse.status).toBe(200);
    expect(auditResponse.body.code).toBe(0);
    expect(auditResponse.body.data.list).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          module: "platform_context",
          action: "switch_tenant",
          targetId: String(TEST_TENANT_ID),
        }),
      ]),
    );
  });

  test("platform_super_admin 新建租户后默认管理员可登录并拿到权限中心快照", async () => {
    const suffix = `${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 10)}`;
    const tenantCode = `ACBOOT${suffix}`;
    const tenantName = `权限自助租户-${suffix}`;
    const defaultAdminUsername = `acboot_${suffix}_admin`;
    const defaultAdminPassword = "AccessInt!2026";
    let createdTenantId = 0;

    try {
      const platformAgent = request.agent(BASE_URL);
      const platformAuth = await platformLogin(platformAgent);

      const createResponse = await platformAgent
        .post("/api/access-control/tenants")
        .set("Authorization", `Bearer ${platformAuth.accessToken}`)
        .send({
          code: tenantCode,
          name: tenantName,
          status: "active",
          defaultAdmin: {
            username: defaultAdminUsername,
            realName: "权限租户管理员",
            initialPassword: defaultAdminPassword,
          },
        });

      expect(createResponse.status).toBe(201);
      expect(createResponse.body.code).toBe(0);
      createdTenantId = Number(createResponse.body.data.id);
      expect(createdTenantId).toBeGreaterThan(0);
      expect(createResponse.body.data.defaultAdminUsername).toBe(defaultAdminUsername);
      expect(createResponse.body.data.defaultAdminPassword).toBe(defaultAdminPassword);
      expect(["tenant_admin", "admin", "boss"]).toContain(createResponse.body.data.defaultAdminRoleCode);

      const [featureRows] = await getDbPool().query<TenantFeatureRow[]>(
        `SELECT feature_code, is_enabled
           FROM tenant_feature_flags
          WHERE tenant_id = ?
          ORDER BY feature_code`,
        [createdTenantId],
      );
      expect(featureRows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ feature_code: "rbac_center", is_enabled: 1 }),
          expect.objectContaining({ feature_code: "tenant_admin", is_enabled: 1 }),
        ]),
      );

      if (await columnExists("user_role_assignments", "source_type")) {
        const [assignmentRows] = await getDbPool().query<BootstrapAssignmentRow[]>(
          `SELECT r.code AS role_code, ura.source_type
             FROM user_role_assignments ura
             INNER JOIN roles r ON r.id = ura.role_id
            WHERE ura.tenant_id = ?
              AND ura.user_id = ?`,
          [createdTenantId, Number(createResponse.body.data.defaultAdminUserId)],
        );
        expect(assignmentRows).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              role_code: createResponse.body.data.defaultAdminRoleCode,
              source_type: "template",
            }),
          ]),
        );
      }

      const tenantAdminAgent = request.agent(BASE_URL);
      const tenantAdminLogin = await login(
        tenantAdminAgent,
        defaultAdminUsername,
        tenantCode,
        defaultAdminPassword,
      );

      expect(tenantAdminLogin.permissionSnapshot.featureFlags).toEqual(
        expect.arrayContaining(["rbac_center", "tenant_admin"]),
      );
      expect(tenantAdminLogin.permissionSnapshot.menuCodes).toEqual(
        expect.arrayContaining([
          "system.management",
          "system.menu.config",
          "system.role.config",
          "system.user.config",
          "system.user.role.assignment",
        ]),
      );
      expect(tenantAdminLogin.permissionSnapshot.actionCodes).toEqual(
        expect.arrayContaining([
          "system.menu.manage",
          "system.role.manage",
          "system.user.manage",
          "system.user.assign",
        ]),
      );

      const menuTreeResponse = await tenantAdminAgent
        .get("/api/access-control/menus/tree")
        .set("Authorization", `Bearer ${tenantAdminLogin.accessToken}`);
      expect(menuTreeResponse.status).toBe(200);
      expect(menuTreeResponse.body.code).toBe(0);

      const roleListResponse = await tenantAdminAgent
        .get("/api/access-control/roles?page=1&pageSize=20")
        .set("Authorization", `Bearer ${tenantAdminLogin.accessToken}`);
      expect(roleListResponse.status).toBe(200);
      expect(roleListResponse.body.code).toBe(0);

      const userListResponse = await tenantAdminAgent
        .get("/api/access-control/users?page=1&pageSize=20")
        .set("Authorization", `Bearer ${tenantAdminLogin.accessToken}`);
      expect(userListResponse.status).toBe(200);
      expect(userListResponse.body.code).toBe(0);
    } finally {
      if (createdTenantId > 0) {
        await cleanupTenantCascade(createdTenantId);
      }
    }
  });

  test("普通租户管理员不能通过 tenantId 参数天然跨租户", async () => {
    const adminAgent = request.agent(BASE_URL);
    const adminLogin = await login(adminAgent, ADMIN_USERNAME);

    const forbiddenResponse = await adminAgent
      .get("/api/access-control/menus/tree?tenantId=0")
      .set("Authorization", `Bearer ${adminLogin.accessToken}`);

    expect(forbiddenResponse.status).toBe(403);
    expect(forbiddenResponse.body.code).not.toBe(0);
    expect(forbiddenResponse.body.message).toContain("跨租户");
  });
});
