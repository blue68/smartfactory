const requireRolesMock = jest.fn((...allowedRoles: string[]) => {
  const middleware = (_req: unknown, _res: unknown, next: () => void) => next();
  (middleware as typeof middleware & { allowedRoles?: string[] }).allowedRoles = allowedRoles;
  return middleware;
});
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
  requireRoles: requireRolesMock,
  requirePermissionsOrRoles: requirePermissionsOrRolesMock,
}));

jest.mock('../../src/app', () => ({
  asyncHandler: (fn: unknown) => fn,
}));

jest.mock('../../src/modules/report/wage.controller', () => ({
  wageController: {
    exportExcel: jest.fn(),
    getTaskWageReport: jest.fn(),
    getWageReport: jest.fn(),
    getMyWages: jest.fn(),
  },
}));

import router from '../../src/modules/report/wage.routes';

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

describe('wage.routes wiring', () => {
  it('mounts authMiddleware at router level', () => {
    expect(router.stack[0]?.handle).toBe(authMiddlewareMock);
  });

  it('keeps fixed routes before root report route', () => {
    const routePaths = router.stack
      .filter((layer: any) => layer.route)
      .map((layer: any) => layer.route.path);

    expect(routePaths.indexOf('/export')).toBeLessThan(routePaths.indexOf('/'));
    expect(routePaths.indexOf('/tasks')).toBeLessThan(routePaths.indexOf('/'));
  });

  it('declares expected permission and role guards for report routes', () => {
    expect(getRouteGuard('/export', 'get')?.requiredPermissions).toEqual(['report:wage:manage']);
    expect(getRouteGuard('/export', 'get')?.allowedRoles).toEqual(['boss', 'manager']);
    expect(getRouteGuard('/tasks', 'get')?.requiredPermissions).toEqual(['report:wage:manage']);
    expect(getRouteGuard('/tasks', 'get')?.allowedRoles).toEqual(['boss', 'manager']);
    expect(getRouteGuard('/', 'get')?.requiredPermissions).toEqual(['report:wage:manage']);
    expect(getRouteGuard('/', 'get')?.allowedRoles).toEqual(['boss', 'manager']);
    expect(getRouteGuard('/my', 'get')).toBeUndefined();
  });
});
