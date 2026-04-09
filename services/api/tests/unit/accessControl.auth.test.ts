import { AppDataSource } from '../../src/config/database';
import { accessControlService } from '../../src/modules/access-control/access-control.service';
import { buildFallbackPermissionSnapshot } from '../../src/modules/access-control/access-control.config';
import { AppError } from '../../src/shared/AppError';
import {
  authMiddleware,
  requireDirectRoles,
  requireRoles,
  requirePermissions,
  requireTenantFeature,
  signRefreshToken,
  signToken,
} from '../../src/middleware/auth';

function flushAsyncMiddleware(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('Access control service and middleware', () => {
  const querySpy = jest.spyOn(AppDataSource, 'query');
  const transactionSpy = jest.spyOn(AppDataSource, 'transaction');

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll(() => {
    querySpy.mockRestore();
    transactionSpy.mockRestore();
  });

  describe('authMiddleware', () => {
    it('hydrates request context and fallback permission snapshot from access token', () => {
      const token = signToken({
        userId: 21,
        tenantId: 4,
        username: 'qa.admin',
        roles: ['boss'],
      });
      const req = {
        headers: {
          authorization: `Bearer ${token}`,
        },
      } as any;
      const next = jest.fn();

      authMiddleware(req, {} as any, next);

      expect(req.userId).toBe(21);
      expect(req.tenantId).toBe(4);
      expect(req.originTenantId).toBe(4);
      expect(req.contextTenantId).toBe(4);
      expect(req.scopeLevel).toBe('tenant');
      expect(req.roles).toEqual(['boss']);
      expect(req.permissionSnapshot?.featureFlags).toContain('rbac_center');
      expect(next).toHaveBeenCalledWith();
    });

    it('rejects refresh token on API authentication path', () => {
      const { token } = signRefreshToken(7, 3);
      const req = {
        headers: {
          authorization: `Bearer ${token}`,
        },
      } as any;
      const next = jest.fn();

      expect(() => authMiddleware(req, {} as any, next)).toThrow(AppError);
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('resolveUserRoleCodes', () => {
    it('prefers active user_role_assignments when table exists and rows are effective', async () => {
      querySpy
        .mockResolvedValueOnce([{ total: 1 }])
        .mockResolvedValueOnce([{ code: 'planner' }, { code: 'boss' }, { code: 'planner' }]);

      const result = await accessControlService.resolveUserRoleCodes(12, 34);

      expect(result).toEqual(['planner', 'boss']);
      expect(querySpy).toHaveBeenCalledTimes(2);
      expect(querySpy.mock.calls[1]?.[0]).toContain('FROM user_role_assignments ura');
    });

    it('falls back to user_roles when assignment table is absent', async () => {
      querySpy
        .mockResolvedValueOnce([{ total: 0 }])
        .mockResolvedValueOnce([{ code: 'admin' }, { code: 'admin' }, { code: 'supervisor' }]);

      const result = await accessControlService.resolveUserRoleCodes(7, 8);

      expect(result).toEqual(['admin', 'supervisor']);
      expect(querySpy).toHaveBeenCalledTimes(2);
      expect(querySpy.mock.calls[1]?.[0]).toContain('FROM user_roles ur');
    });
  });

  describe('buildPermissionSnapshot', () => {
    it('builds DB-backed permission snapshot, preserves parsed JSON scope values, and respects enabled tenant features', async () => {
      querySpy
        .mockResolvedValueOnce([{ total: 1 }])
        .mockResolvedValueOnce([
          { permission_type: 'menu', permission_key: 'system.role.config', scope_type: null, scope_value_json: null },
          { permission_type: 'menu', permission_key: 'system.role.config', scope_type: null, scope_value_json: null },
          { permission_type: 'action', permission_key: 'system.role.manage', scope_type: null, scope_value_json: null },
          { permission_type: 'data_scope', permission_key: 'department', scope_type: 'department', scope_value_json: ['A1', 9] },
        ])
        .mockResolvedValueOnce([{ total: 1 }])
        .mockResolvedValueOnce([{ feature_code: 'rbac_center' }, { feature_code: 'warehouse_slotting' }]);

      const result = await accessControlService.buildPermissionSnapshot(66, ['supervisor']);

      expect(result.version.startsWith('db-')).toBe(true);
      expect(result.scopeLevel).toBe('tenant');
      expect(result.originTenantId).toBe(66);
      expect(result.contextTenantId).toBe(66);
      expect(result.menuCodes).toEqual(expect.arrayContaining(['system.role.config']));
      expect(result.actionCodes).toEqual(expect.arrayContaining(['system.role.manage']));
      expect(result.dataScopes).toEqual(expect.arrayContaining([
        { scopeType: 'department', scopeValues: ['A1', 9] },
      ]));
      expect(result.featureFlags).toEqual(expect.arrayContaining(['rbac_center', 'warehouse_slotting']));
    });

    it('prunes system-management permissions when tenant feature flag rbac_center is disabled', async () => {
      querySpy
        .mockResolvedValueOnce([{ total: 1 }])
        .mockResolvedValueOnce([
          { permission_type: 'menu', permission_key: 'system.role.config', scope_type: null, scope_value_json: null },
          { permission_type: 'action', permission_key: 'system.role.manage', scope_type: null, scope_value_json: null },
        ])
        .mockResolvedValueOnce([{ total: 1 }])
        .mockResolvedValueOnce([{ feature_code: 'warehouse_slotting' }]);

      const result = await accessControlService.buildPermissionSnapshot(66, ['supervisor']);

      expect(result.featureFlags).toEqual(['warehouse_slotting']);
      expect(result.menuCodes).not.toContain('system.management');
      expect(result.menuCodes).not.toContain('system.role.config');
      expect(result.actionCodes).not.toContain('system.role.manage');
    });

    it('keeps tenant RBAC permissions but removes platform-only tenant-config permissions in tenant scope', async () => {
      querySpy
        .mockResolvedValueOnce([{ total: 1 }])
        .mockResolvedValueOnce([
          { permission_type: 'menu', permission_key: 'system.tenant.config', scope_type: null, scope_value_json: null },
          { permission_type: 'menu', permission_key: 'system.role.config', scope_type: null, scope_value_json: null },
          { permission_type: 'action', permission_key: 'system.tenant.manage', scope_type: null, scope_value_json: null },
          { permission_type: 'action', permission_key: 'system.role.manage', scope_type: null, scope_value_json: null },
        ])
        .mockResolvedValueOnce([{ total: 1 }])
        .mockResolvedValueOnce([{ feature_code: 'rbac_center' }]);

      const result = await accessControlService.buildPermissionSnapshot(66, ['admin']);

      expect(result.featureFlags).toEqual(['rbac_center']);
      expect(result.menuCodes).toContain('system.role.config');
      expect(result.actionCodes).toContain('system.role.manage');
      expect(result.menuCodes).not.toContain('system.tenant.config');
      expect(result.actionCodes).not.toContain('system.tenant.manage');
      expect(result.actionCodes).not.toContain('platform.tenant.switch');
    });

    it('keeps platform-scoped fallback features when tenant feature table exists', async () => {
      querySpy
        .mockResolvedValueOnce([{ total: 1 }])
        .mockResolvedValueOnce([
          { permission_type: 'menu', permission_key: 'system.tenant.config', scope_type: null, scope_value_json: null },
          { permission_type: 'action', permission_key: 'system.tenant.manage', scope_type: null, scope_value_json: null },
        ])
        .mockResolvedValueOnce([{ total: 1 }]);

      const result = await accessControlService.buildPermissionSnapshot(0, ['platform_super_admin'], {
        scopeLevel: 'platform',
        originTenantId: 0,
        contextTenantId: null,
      });

      expect(result.scopeLevel).toBe('platform');
      expect(result.featureFlags).toEqual(expect.arrayContaining(['rbac_center', 'tenant_admin']));
      expect(result.menuCodes).toEqual(expect.arrayContaining(['system.tenant.config']));
      expect(result.actionCodes).toEqual(expect.arrayContaining(['system.tenant.manage']));
      expect(querySpy).toHaveBeenCalledTimes(3);
    });

    it('falls back to seeded snapshot when role_permissions table is absent', async () => {
      querySpy.mockResolvedValueOnce([{ total: 0 }]);

      const result = await accessControlService.buildPermissionSnapshot(1, ['boss']);
      const fallback = buildFallbackPermissionSnapshot(['boss']);

      expect(result.menuCodes).toEqual(fallback.menuCodes);
      expect(result.actionCodes).toEqual(fallback.actionCodes);
      expect(result.featureFlags).toEqual(fallback.featureFlags);
      expect(querySpy).toHaveBeenCalledTimes(1);
    });

    it('grants tenant RBAC menus and actions to tenant_admin fallback role', async () => {
      querySpy.mockResolvedValueOnce([{ total: 0 }]);

      const result = await accessControlService.buildPermissionSnapshot(1, ['tenant_admin']);

      expect(result.menuCodes).toEqual(expect.arrayContaining([
        'system.management',
        'system.menu.config',
        'system.role.config',
        'system.user.config',
        'system.role.permission.config',
        'system.user.role.assignment',
      ]));
      expect(result.actionCodes).toEqual(expect.arrayContaining([
        'system.menu.manage',
        'system.role.manage',
        'system.user.manage',
        'system.role.grant',
        'system.user.assign',
        'system.audit.view',
      ]));
      expect(result.featureFlags).toEqual(expect.arrayContaining(['rbac_center', 'tenant_admin']));
    });
  });

  describe('requireRoles', () => {
    it('allows tenant admin-like roles to pass tenant-scoped legacy role guards', () => {
      const middleware = requireRoles('boss');
      const req = {
        scopeLevel: 'tenant',
        user: {
          roles: ['tenant_admin'],
        },
      } as any;
      const next = jest.fn();

      middleware(req, {} as any, next);

      expect(next).toHaveBeenCalledWith();
    });

    it('does not bypass platform_super_admin-only legacy role guards', () => {
      const middleware = requireRoles('platform_super_admin');
      const req = {
        scopeLevel: 'tenant',
        user: {
          roles: ['tenant_admin'],
        },
      } as any;
      const next = jest.fn();

      expect(() => middleware(req, {} as any, next)).toThrow(AppError);
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('requireDirectRoles', () => {
    it('does not allow tenant_admin to bypass direct boss-only guards', () => {
      const middleware = requireDirectRoles('boss');
      const req = {
        scopeLevel: 'tenant',
        user: {
          roles: ['tenant_admin'],
        },
      } as any;
      const next = jest.fn();

      expect(() => middleware(req, {} as any, next)).toThrow(AppError);
      expect(next).not.toHaveBeenCalled();
    });

    it('allows exact boss role to pass direct guards', () => {
      const middleware = requireDirectRoles('boss');
      const req = {
        scopeLevel: 'tenant',
        user: {
          roles: ['boss'],
        },
      } as any;
      const next = jest.fn();

      middleware(req, {} as any, next);

      expect(next).toHaveBeenCalledWith();
    });
  });

  describe('menu tree scope filtering', () => {
    it('hides platform-only tenant config menu from tenant-scoped menu tree fallback', async () => {
      querySpy.mockResolvedValueOnce([{ total: 0 }]);

      const result = await accessControlService.getMenuTree({
        tenantId: 1,
        userId: 5,
        roles: ['admin'],
        originTenantId: 1,
        contextTenantId: 1,
        scopeLevel: 'tenant',
      }, {});

      const flatten = (nodes: Array<{ code: string; children?: any[] }>): string[] => nodes.flatMap((node) => [
        node.code,
        ...(node.children ? flatten(node.children) : []),
      ]);

      const codes = flatten(result as Array<{ code: string; children?: any[] }>);
      expect(codes).toContain('system.management');
      expect(codes).toContain('system.menu.config');
      expect(codes).not.toContain('system.tenant.config');
    });

    it('hides platform-only actions from tenant-scoped action list fallback', async () => {
      querySpy.mockResolvedValueOnce([{ total: 0 }]);

      const result = await accessControlService.getMenuActions({
        tenantId: 1,
        userId: 5,
        roles: ['admin'],
        originTenantId: 1,
        contextTenantId: 1,
        scopeLevel: 'tenant',
      }, 9001101);

      const actionCodes = (result as Array<{ code: string }>).map((item) => item.code);
      expect(actionCodes).not.toContain('system.tenant.manage');
      expect(actionCodes).not.toContain('platform.tenant.switch');
    });
  });

  describe('createTenant', () => {
    it('creates default admin, enables tenant features, and writes template-scoped role assignment', async () => {
      const managerQuery = jest.fn()
        .mockResolvedValueOnce({ insertId: 31 })
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ insertId: 501 })
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({});

      transactionSpy.mockImplementationOnce(async (callback: any) => callback({ query: managerQuery }));
      querySpy
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ total: 1 }])
        .mockResolvedValueOnce([{ id: 9001, code: 'tenant_admin', tenantId: 0 }])
        .mockResolvedValueOnce([{ total: 1 }])
        .mockResolvedValueOnce([{ total: 1 }])
        .mockResolvedValueOnce([{ total: 1 }])
        .mockResolvedValueOnce([{ total: 0 }]);

      const result = await accessControlService.createTenant({
        tenantId: 0,
        userId: 7,
        roles: ['platform_super_admin'],
        originTenantId: 0,
        contextTenantId: null,
        scopeLevel: 'platform',
      }, {
        code: 'FACTORY001',
        name: '华东一厂',
        defaultAdmin: {
          username: 'factory001_admin',
          realName: '张厂长',
          initialPassword: 'Init@123456',
        },
      });

      expect(result).toMatchObject({
        id: 31,
        defaultAdminUserId: 501,
        defaultAdminUsername: 'factory001_admin',
        defaultAdminName: '张厂长',
        defaultAdminPassword: 'Init@123456',
        defaultAdminRoleCode: 'tenant_admin',
      });
      expect(managerQuery.mock.calls[1]?.[0]).toContain('INSERT INTO tenant_feature_flags');
      expect(managerQuery.mock.calls[3]?.[0]).toContain('INSERT INTO user_role_assignments');
      expect(managerQuery.mock.calls[3]?.[1]).toEqual(expect.arrayContaining([
        31,
        501,
        9001,
        'tenant',
        'active',
        'template',
      ]));
      expect(managerQuery.mock.calls[4]?.[0]).toContain('INSERT INTO user_roles');
    });
  });

  describe('requireTenantFeature', () => {
    it('uses rebuilt DB snapshot instead of stale req.permissionSnapshot fallback', async () => {
      const resolveSpy = jest
        .spyOn(accessControlService, 'resolveUserRoleCodes')
        .mockResolvedValue(['custom_admin']);
      const snapshotSpy = jest
        .spyOn(accessControlService, 'buildPermissionSnapshot')
        .mockResolvedValue({
          version: 'db-unit-test',
          scopeLevel: 'tenant',
          originTenantId: 9,
          contextTenantId: 9,
          menuCodes: [],
          actionCodes: [],
          dataScopes: [],
          featureFlags: ['rbac_center'],
        });

      const middleware = requireTenantFeature('rbac_center');
      const req = {
        userId: 3,
        tenantId: 9,
        originTenantId: 9,
        contextTenantId: 9,
        scopeLevel: 'tenant',
        user: { userId: 3, tenantId: 9, username: 'tester', roles: ['worker'] },
        permissionSnapshot: {
          version: 'fallback-stale',
          scopeLevel: 'tenant',
          originTenantId: 9,
          contextTenantId: 9,
          menuCodes: [],
          actionCodes: [],
          dataScopes: [],
          featureFlags: [],
        },
        roles: ['worker'],
      } as any;
      const next = jest.fn();

      middleware(req, {} as any, next);
      await flushAsyncMiddleware();

      expect(resolveSpy).toHaveBeenCalledWith(3, 9);
      expect(snapshotSpy).toHaveBeenCalledWith(9, ['custom_admin'], {
        scopeLevel: 'tenant',
        originTenantId: 9,
        contextTenantId: 9,
      });
      expect(req.roles).toEqual(['custom_admin']);
      expect(req.user.roles).toEqual(['custom_admin']);
      expect(req.permissionSnapshot.featureFlags).toEqual(['rbac_center']);
      expect(next).toHaveBeenCalledWith();

      resolveSpy.mockRestore();
      snapshotSpy.mockRestore();
    });

    it('returns AppError(403) when tenant feature is missing from rebuilt snapshot', async () => {
      const resolveSpy = jest
        .spyOn(accessControlService, 'resolveUserRoleCodes')
        .mockResolvedValue(['custom_admin']);
      const snapshotSpy = jest
        .spyOn(accessControlService, 'buildPermissionSnapshot')
        .mockResolvedValue({
          version: 'db-unit-test',
          scopeLevel: 'tenant',
          originTenantId: 11,
          contextTenantId: 11,
          menuCodes: [],
          actionCodes: [],
          dataScopes: [],
          featureFlags: ['tenant_admin'],
        });

      const middleware = requireTenantFeature('rbac_center');
      const req = {
        userId: 5,
        tenantId: 11,
        originTenantId: 11,
        contextTenantId: 11,
        scopeLevel: 'tenant',
        user: { userId: 5, tenantId: 11, username: 'tester', roles: ['worker'] },
        roles: ['worker'],
      } as any;
      const next = jest.fn();

      middleware(req, {} as any, next);
      await flushAsyncMiddleware();

      expect(next).toHaveBeenCalledTimes(1);
      const error = next.mock.calls[0]?.[0];
      expect(error).toBeInstanceOf(AppError);
      expect(error.statusCode).toBe(403);
      expect(error.message).toContain('rbac_center');

      resolveSpy.mockRestore();
      snapshotSpy.mockRestore();
    });
  });

  describe('requirePermissions', () => {
    it('uses rebuilt DB action permissions instead of stale fallback snapshot', async () => {
      const resolveSpy = jest
        .spyOn(accessControlService, 'resolveUserRoleCodes')
        .mockResolvedValue(['custom_operator']);
      const snapshotSpy = jest
        .spyOn(accessControlService, 'buildPermissionSnapshot')
        .mockResolvedValue({
          version: 'db-unit-test',
          scopeLevel: 'tenant',
          originTenantId: 12,
          contextTenantId: 12,
          menuCodes: ['system.user.config'],
          actionCodes: ['system.user.manage'],
          dataScopes: [],
          featureFlags: ['rbac_center'],
        });

      const middleware = requirePermissions('system.user.manage');
      const req = {
        userId: 6,
        tenantId: 12,
        originTenantId: 12,
        contextTenantId: 12,
        scopeLevel: 'tenant',
        user: { userId: 6, tenantId: 12, username: 'tester', roles: ['worker'] },
        permissionSnapshot: {
          version: 'fallback-stale',
          scopeLevel: 'tenant',
          originTenantId: 12,
          contextTenantId: 12,
          menuCodes: [],
          actionCodes: [],
          dataScopes: [],
          featureFlags: [],
        },
        roles: ['worker'],
      } as any;
      const next = jest.fn();

      middleware(req, {} as any, next);
      await flushAsyncMiddleware();

      expect(resolveSpy).toHaveBeenCalledWith(6, 12);
      expect(snapshotSpy).toHaveBeenCalledWith(12, ['custom_operator'], {
        scopeLevel: 'tenant',
        originTenantId: 12,
        contextTenantId: 12,
      });
      expect(req.permissionSnapshot.actionCodes).toEqual(['system.user.manage']);
      expect(next).toHaveBeenCalledWith();

      resolveSpy.mockRestore();
      snapshotSpy.mockRestore();
    });

    it('returns AppError(403) when action permission is missing from rebuilt snapshot', async () => {
      const resolveSpy = jest
        .spyOn(accessControlService, 'resolveUserRoleCodes')
        .mockResolvedValue(['custom_operator']);
      const snapshotSpy = jest
        .spyOn(accessControlService, 'buildPermissionSnapshot')
        .mockResolvedValue({
          version: 'db-unit-test',
          scopeLevel: 'tenant',
          originTenantId: 15,
          contextTenantId: 15,
          menuCodes: ['system.user.config'],
          actionCodes: ['system.audit.view'],
          dataScopes: [],
          featureFlags: ['rbac_center'],
        });

      const middleware = requirePermissions('system.user.manage');
      const req = {
        userId: 10,
        tenantId: 15,
        originTenantId: 15,
        contextTenantId: 15,
        scopeLevel: 'tenant',
        user: { userId: 10, tenantId: 15, username: 'tester', roles: ['worker'] },
        roles: ['worker'],
      } as any;
      const next = jest.fn();

      middleware(req, {} as any, next);
      await flushAsyncMiddleware();

      expect(next).toHaveBeenCalledTimes(1);
      const error = next.mock.calls[0]?.[0];
      expect(error).toBeInstanceOf(AppError);
      expect(error.statusCode).toBe(403);
      expect(error.message).toContain('system.user.manage');

      resolveSpy.mockRestore();
      snapshotSpy.mockRestore();
    });
  });
});
