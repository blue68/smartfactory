const requirePermissionsOrRolesMock = jest.fn((requiredPermissions: string[], ...allowedRoles: string[]) => {
  const middleware = (_req: unknown, _res: unknown, next: () => void) => next();
  (middleware as typeof middleware & { allowedRoles?: string[] }).allowedRoles = allowedRoles;
  (
    middleware as typeof middleware & { requiredPermissions?: string[] }
  ).requiredPermissions = requiredPermissions;
  return middleware;
});
const authMiddlewareMock = jest.fn((_req: unknown, _res: unknown, next: () => void) => next());

jest.mock('../../src/middleware/auth', () => ({
  authMiddleware: authMiddlewareMock,
  requirePermissionsOrRoles: requirePermissionsOrRolesMock,
}));

jest.mock('../../src/app', () => ({
  asyncHandler: (fn: unknown) => fn,
}));

jest.mock('../../src/modules/process-config/processConfig.controller', () => ({
  processConfigController: {
    list: jest.fn(),
    getStepMaterials: jest.fn(),
    putStepMaterials: jest.fn(),
    setDefault: jest.fn(),
    getOne: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    putMaxHours: jest.fn(),
    getWages: jest.fn(),
    putWages: jest.fn(),
    exportWageSummary: jest.fn(),
    getWageSummary: jest.fn(),
  },
  workstationTypeController: {
    list: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  },
}));

import router from '../../src/modules/process-config/processConfig.routes';

function getRouteLayer(path: string, method: string) {
  return router.stack.find((layer: any) =>
    layer.route &&
    layer.route.path === path &&
    Boolean(layer.route.methods?.[method]),
  );
}

function getRouteGuard(path: string, method: string) {
  const layer = getRouteLayer(path, method);
  return layer?.route?.stack?.find((stackLayer: any) =>
    (stackLayer.handle as any)?.allowedRoles || (stackLayer.handle as any)?.requiredPermissions,
  )?.handle as { allowedRoles?: string[]; requiredPermissions?: string[] } | undefined;
}

describe('processConfig.routes wiring', () => {
  it('mounts authMiddleware at router level', () => {
    expect(router.stack[0]?.handle).toBe(authMiddlewareMock);
  });

  it('keeps fixed routes before parameter route', () => {
    const routePaths = router.stack
      .filter((layer: any) => layer.route)
      .map((layer: any) => layer.route.path);

    expect(routePaths.indexOf('/workstation-types')).toBeLessThan(routePaths.indexOf('/:id'));
    expect(getRouteLayer('/:templateId/wage-summary/export', 'get')).toBeTruthy();
  });

  it('declares expected permission guards for process config routes', () => {
    expect(getRouteGuard('/workstation-types', 'get')?.requiredPermissions).toEqual(['process:config:view']);
    expect(getRouteGuard('/workstation-types', 'post')?.requiredPermissions).toEqual(['process:config:manage']);
    expect(getRouteGuard('/', 'post')?.requiredPermissions).toEqual(['process:config:manage']);
    expect(getRouteGuard('/steps/:stepId/max-hours', 'patch')?.requiredPermissions).toEqual(['process:config:wage:manage']);
    expect(getRouteGuard('/steps/:stepId/wages', 'get')?.requiredPermissions).toEqual(['process:config:view']);
    expect(getRouteGuard('/:templateId/wage-summary/export', 'get')?.requiredPermissions).toEqual(['process:config:wage:manage']);
  });
});
