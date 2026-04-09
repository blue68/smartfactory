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

jest.mock('../../src/modules/supplier/supplier.controller', () => ({
  supplierController: {
    options: jest.fn(),
    exportExcel: jest.fn(),
    comparePerformance: jest.fn(),
    list: jest.fn(),
    getOne: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    getPerformance: jest.fn(),
    getMonthlyStatement: jest.fn(),
    getRelatedSkus: jest.fn(),
    getPriceAgreements: jest.fn(),
  },
}));

import router from '../../src/modules/supplier/supplier.routes';

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

describe('supplier.routes wiring', () => {
  it('mounts authMiddleware at router level', () => {
    expect(router.stack[0]?.handle).toBe(authMiddlewareMock);
  });

  it('keeps fixed routes before parameter route', () => {
    const routePaths = router.stack
      .filter((layer: any) => layer.route)
      .map((layer: any) => layer.route.path);

    expect(routePaths.indexOf('/export')).toBeLessThan(routePaths.indexOf('/:id'));
    expect(routePaths.indexOf('/compare')).toBeLessThan(routePaths.indexOf('/:id'));
  });

  it('declares expected permission guards for supplier routes', () => {
    expect(getRouteGuard('/', 'get')?.requiredPermissions).toEqual(['supplier:view']);
    expect(getRouteGuard('/', 'post')?.requiredPermissions).toEqual(['supplier:manage']);
    expect(getRouteGuard('/:id', 'put')?.requiredPermissions).toEqual(['supplier:manage']);
    expect(getRouteGuard('/:id/performance', 'get')?.requiredPermissions).toEqual(['supplier:view']);
  });
});
