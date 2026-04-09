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

jest.mock('../../src/modules/sku/sku.controller', () => ({
  skuController: {
    getCategories: jest.fn(),
    getStats: jest.fn(),
    list: jest.fn(),
    exportExcel: jest.fn(),
    importSkus: jest.fn(),
    getOne: jest.fn(),
    create: jest.fn(),
    batchUpdateStatus: jest.fn(),
    batchUpdateSafetyStock: jest.fn(),
    update: jest.fn(),
    setUnitConversions: jest.fn(),
  },
}));

import router from '../../src/modules/sku/sku.routes';

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

describe('sku.routes wiring', () => {
  it('mounts authMiddleware at router level', () => {
    expect(router.stack[0]?.handle).toBe(authMiddlewareMock);
  });

  it('keeps export/import before parameter route', () => {
    const routePaths = router.stack
      .filter((layer: any) => layer.route)
      .map((layer: any) => layer.route.path);

    expect(routePaths.indexOf('/export')).toBeLessThan(routePaths.indexOf('/:id'));
    expect(routePaths.indexOf('/import')).toBeLessThan(routePaths.indexOf('/:id'));
  });

  it('declares expected permission guards for sku routes', () => {
    expect(getRouteGuard('/', 'get')?.requiredPermissions).toEqual(['sku:view']);
    expect(getRouteGuard('/import', 'post')?.requiredPermissions).toEqual(['sku:create']);
    expect(getRouteGuard('/import', 'post')?.allowedRoles).toEqual(['boss', 'purchaser']);
    expect(getRouteGuard('/', 'post')?.requiredPermissions).toEqual(['sku:create']);
    expect(getRouteGuard('/batch-status', 'put')?.requiredPermissions).toEqual(['sku:edit']);
    expect(getRouteGuard('/:id', 'put')?.requiredPermissions).toEqual(['sku:edit']);
    expect(getRouteGuard('/:id/unit-conversions', 'put')?.requiredPermissions).toEqual(['sku:edit']);
  });
});
