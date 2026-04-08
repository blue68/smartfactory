const mockQuery = jest.fn();
const mockBcryptCompare = jest.fn();
const mockRedisGet = jest.fn();
const mockRedisDel = jest.fn();
const mockRedisIncr = jest.fn();
const mockRedisExpire = jest.fn();
const mockPipelineSet = jest.fn();
const mockPipelineSadd = jest.fn();
const mockPipelineExpire = jest.fn();
const mockPipelineDel = jest.fn();
const mockPipelineSrem = jest.fn();
const mockPipelineExec = jest.fn();
const mockSignToken = jest.fn();
const mockSignRefreshToken = jest.fn();
const mockVerifyRefreshToken = jest.fn();
const mockResolveUserRoleCodes = jest.fn();
const mockBuildPermissionSnapshot = jest.fn();

const mockPipeline = {
  set: (...args: unknown[]) => {
    mockPipelineSet(...args);
    return mockPipeline;
  },
  sadd: (...args: unknown[]) => {
    mockPipelineSadd(...args);
    return mockPipeline;
  },
  expire: (...args: unknown[]) => {
    mockPipelineExpire(...args);
    return mockPipeline;
  },
  del: (...args: unknown[]) => {
    mockPipelineDel(...args);
    return mockPipeline;
  },
  srem: (...args: unknown[]) => {
    mockPipelineSrem(...args);
    return mockPipeline;
  },
  exec: (...args: unknown[]) => mockPipelineExec(...args),
};

const mockRedisClient = {
  get: (...args: unknown[]) => mockRedisGet(...args),
  del: (...args: unknown[]) => mockRedisDel(...args),
  incr: (...args: unknown[]) => mockRedisIncr(...args),
  expire: (...args: unknown[]) => mockRedisExpire(...args),
  pipeline: () => mockPipeline,
};

jest.mock('../../src/config/database', () => ({
  AppDataSource: {
    query: (...args: unknown[]) => mockQuery(...args),
  },
}));

jest.mock('../../src/config/redis', () => ({
  getRedisClient: () => mockRedisClient,
  RedisKeys: {
    refreshToken: (jti: string) => `rt:${jti}`,
    userRefreshTokenSet: (tenantId: number, userId: number) => `rt:user:${tenantId}:${userId}`,
  },
  RedisTTL: {
    REFRESH_TOKEN: 7 * 24 * 3600,
  },
}));

jest.mock('bcrypt', () => ({
  compare: (...args: unknown[]) => mockBcryptCompare(...args),
  hash: jest.fn(),
}));

jest.mock('../../src/middleware/auth', () => ({
  signToken: (...args: unknown[]) => mockSignToken(...args),
  signRefreshToken: (...args: unknown[]) => mockSignRefreshToken(...args),
  verifyRefreshToken: (...args: unknown[]) => mockVerifyRefreshToken(...args),
}));

jest.mock('../../src/modules/access-control/access-control.service', () => ({
  accessControlService: {
    resolveUserRoleCodes: (...args: unknown[]) => mockResolveUserRoleCodes(...args),
    buildPermissionSnapshot: (...args: unknown[]) => mockBuildPermissionSnapshot(...args),
  },
}));

import { AuthService } from '../../src/modules/auth/auth.service';

describe('AuthService permission snapshot flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRedisGet.mockResolvedValue('1:9');
    mockRedisDel.mockResolvedValue(1);
    mockRedisIncr.mockResolvedValue(1);
    mockRedisExpire.mockResolvedValue(1);
    mockPipelineExec.mockResolvedValue([]);
    mockBcryptCompare.mockResolvedValue(true);
    mockSignToken.mockReturnValue('signed-access-token');
    mockSignRefreshToken.mockReturnValue({ token: 'signed-refresh-token', jti: 'new-jti-001' });
    mockVerifyRefreshToken.mockReturnValue({
      userId: 55,
      tenantId: 9,
      scopeLevel: 'tenant',
      originTenantId: 9,
      contextTenantId: 9,
      type: 'refresh',
      jti: 'old-jti-001',
    });
    mockResolveUserRoleCodes.mockResolvedValue(['boss', 'custom_admin']);
    mockBuildPermissionSnapshot.mockResolvedValue({
      version: 'db-snapshot',
      scopeLevel: 'tenant',
      originTenantId: 9,
      contextTenantId: 9,
      menuCodes: ['system.user.config'],
      actionCodes: ['system.user.manage'],
      dataScopes: [{ scopeType: 'all', scopeValues: [] }],
      featureFlags: ['rbac_center'],
    });
  });

  it('login returns DB-backed permission snapshot and registers refresh jti', async () => {
    mockQuery
      .mockResolvedValueOnce([{ id: 9, name: '演示租户', status: 'active' }])
      .mockResolvedValueOnce([{ id: 55, username: 'admin_dev', real_name: '管理员', password_hash: 'hashed', status: 'active' }])
      .mockResolvedValueOnce({ affectedRows: 1 });

    const service = new AuthService();
    const result = await service.login({
      username: 'admin_dev',
      password: 'Dev123!2026',
      tenantCode: 'FACTORY001',
    });

    expect(mockResolveUserRoleCodes).toHaveBeenCalledWith(55, 9);
    expect(mockBuildPermissionSnapshot).toHaveBeenCalledWith(9, ['boss', 'custom_admin'], {
      scopeLevel: 'tenant',
      originTenantId: 9,
      contextTenantId: 9,
    });
    expect(mockSignRefreshToken).toHaveBeenCalledWith(55, 9, {
      scopeLevel: 'tenant',
      originTenantId: 9,
      contextTenantId: 9,
    });
    expect(mockSignToken).toHaveBeenCalledWith({
      userId: 55,
      tenantId: 9,
      username: 'admin_dev',
      roles: ['boss', 'custom_admin'],
      scopeLevel: 'tenant',
      originTenantId: 9,
      contextTenantId: 9,
    });
    expect(mockPipelineSet).toHaveBeenCalledWith('rt:new-jti-001', '55:9', 'EX', 604800);
    expect(mockPipelineSadd).toHaveBeenCalledWith('rt:user:9:55', 'new-jti-001');
    expect(mockPipelineExpire).toHaveBeenCalledWith('rt:user:9:55', 604800);
    expect(result).toEqual({
      accessToken: 'signed-access-token',
      refreshToken: 'signed-refresh-token',
      permissionSnapshot: {
        version: 'db-snapshot',
        scopeLevel: 'tenant',
        originTenantId: 9,
        contextTenantId: 9,
        menuCodes: ['system.user.config'],
        actionCodes: ['system.user.manage'],
        dataScopes: [{ scopeType: 'all', scopeValues: [] }],
        featureFlags: ['rbac_center'],
      },
      user: {
        id: 55,
        username: 'admin_dev',
        realName: '管理员',
        roles: ['boss', 'custom_admin'],
        tenantId: 9,
        tenantName: '演示租户',
        scopeLevel: 'tenant',
        originTenantId: 9,
        contextTenantId: 9,
      },
    });
  });

  it('refreshToken rebuilds role codes and permission snapshot after rotating refresh jti', async () => {
    mockSignRefreshToken.mockReturnValue({ token: 'rotated-refresh-token', jti: 'new-jti-002' });
    mockSignToken.mockReturnValue('rotated-access-token');
    mockQuery.mockResolvedValueOnce([{ id: 55, username: 'admin_dev', real_name: '管理员', tenant_id: 9, status: 'active' }]);

    const service = new AuthService();
    const result = await service.refreshToken('refresh-token-value');

    expect(mockVerifyRefreshToken).toHaveBeenCalledWith('refresh-token-value');
    expect(mockRedisGet).toHaveBeenCalledWith('rt:old-jti-001');
    expect(mockPipelineDel).toHaveBeenCalledWith('rt:old-jti-001');
    expect(mockPipelineSrem).toHaveBeenCalledWith('rt:user:9:55', 'old-jti-001');
    expect(mockPipelineSet).toHaveBeenCalledWith('rt:new-jti-002', '55:9', 'EX', 604800);
    expect(mockPipelineSadd).toHaveBeenCalledWith('rt:user:9:55', 'new-jti-002');
    expect(mockResolveUserRoleCodes).toHaveBeenCalledWith(55, 9);
    expect(mockBuildPermissionSnapshot).toHaveBeenCalledWith(9, ['boss', 'custom_admin'], {
      scopeLevel: 'tenant',
      originTenantId: 9,
      contextTenantId: 9,
    });
    expect(mockSignToken).toHaveBeenCalledWith({
      userId: 55,
      tenantId: 9,
      username: 'admin_dev',
      roles: ['boss', 'custom_admin'],
      scopeLevel: 'tenant',
      originTenantId: 9,
      contextTenantId: 9,
    });
    expect(result).toEqual({
      accessToken: 'rotated-access-token',
      refreshToken: 'rotated-refresh-token',
      permissionSnapshot: {
        version: 'db-snapshot',
        scopeLevel: 'tenant',
        originTenantId: 9,
        contextTenantId: 9,
        menuCodes: ['system.user.config'],
        actionCodes: ['system.user.manage'],
        dataScopes: [{ scopeType: 'all', scopeValues: [] }],
        featureFlags: ['rbac_center'],
      },
    });
  });

  it('platform login issues platform-scoped tokens for platform_super_admin', async () => {
    mockResolveUserRoleCodes.mockResolvedValue(['platform_super_admin']);
    mockBuildPermissionSnapshot.mockResolvedValue({
      version: 'platform-snapshot',
      scopeLevel: 'platform',
      originTenantId: 0,
      contextTenantId: null,
      menuCodes: ['system.management', 'system.tenant.config'],
      actionCodes: ['system.tenant.manage', 'platform.tenant.switch'],
      dataScopes: [],
      featureFlags: ['rbac_center', 'tenant_admin'],
    });
    mockQuery
      .mockResolvedValueOnce([{ id: 7, username: 'platform_root', real_name: '平台管理员', password_hash: 'hashed', status: 'active' }])
      .mockResolvedValueOnce({ affectedRows: 1 });

    const service = new AuthService();
    const result = await service.login({
      loginMode: 'platform',
      username: 'platform_root',
      password: 'Dev123!2026',
    });

    expect(mockResolveUserRoleCodes).toHaveBeenCalledWith(7, 0);
    expect(mockBuildPermissionSnapshot).toHaveBeenCalledWith(0, ['platform_super_admin'], {
      scopeLevel: 'platform',
      originTenantId: 0,
      contextTenantId: null,
    });
    expect(mockSignRefreshToken).toHaveBeenCalledWith(7, 0, {
      scopeLevel: 'platform',
      originTenantId: 0,
      contextTenantId: null,
    });
    expect(result.user.scopeLevel).toBe('platform');
    expect(result.user.originTenantId).toBe(0);
    expect(result.user.contextTenantId).toBeNull();
  });

  it('switchTenantContext reissues tenant-scoped tokens for platform_super_admin', async () => {
    mockResolveUserRoleCodes.mockResolvedValue(['platform_super_admin']);
    mockBuildPermissionSnapshot.mockResolvedValue({
      version: 'managed-snapshot',
      scopeLevel: 'tenant',
      originTenantId: 0,
      contextTenantId: 23,
      menuCodes: ['system.management', 'system.role.config'],
      actionCodes: ['system.role.manage', 'platform.tenant.switch'],
      dataScopes: [{ scopeType: 'all', scopeValues: [] }],
      featureFlags: ['rbac_center', 'tenant_admin'],
    });
    mockQuery
      .mockResolvedValueOnce([{ id: 7, username: 'platform_root', real_name: '平台管理员', status: 'active' }])
      .mockResolvedValueOnce([{ id: 23, code: 'TENANT-23', name: '二十三号工厂', status: 'active' }])
      .mockResolvedValueOnce([{ total: 1 }])
      .mockResolvedValueOnce([]);

    const service = new AuthService();
    const result = await service.switchTenantContext({
      userId: 7,
      username: 'platform_root',
      originTenantId: 0,
      roles: ['platform_super_admin'],
      scopeLevel: 'platform',
      targetTenantId: 23,
    });

    expect(mockResolveUserRoleCodes).toHaveBeenCalledWith(7, 0);
    expect(mockBuildPermissionSnapshot).toHaveBeenCalledWith(23, ['platform_super_admin'], {
      scopeLevel: 'tenant',
      originTenantId: 0,
      contextTenantId: 23,
    });
    expect(mockSignRefreshToken).toHaveBeenCalledWith(7, 23, {
      scopeLevel: 'tenant',
      originTenantId: 0,
      contextTenantId: 23,
    });
    expect(mockPipelineSet).toHaveBeenCalledWith('rt:new-jti-001', '7:0', 'EX', 604800);
    expect(result.user.tenantId).toBe(23);
    expect(result.user.contextTenantId).toBe(23);
  });
});
