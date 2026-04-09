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

jest.mock('../../src/modules/price/price.controller', () => ({
  priceController: {
    downloadTemplate: jest.fn(),
    importPrices: jest.fn(),
    getImportProgress: jest.fn(),
    getImportStatus: jest.fn(),
    list: jest.fn(),
    getPriceHistory: jest.fn(),
    getOne: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
}));

import router from '../../src/modules/price/price.routes';

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

describe('price.routes wiring', () => {
  it('mounts authMiddleware at router level', () => {
    expect(router.stack[0]?.handle).toBe(authMiddlewareMock);
  });

  it('keeps import routes before parameter route', () => {
    const routePaths = router.stack
      .filter((layer: any) => layer.route)
      .map((layer: any) => layer.route.path);

    expect(routePaths.indexOf('/import-template')).toBeLessThan(routePaths.indexOf('/:id'));
    expect(routePaths.indexOf('/import')).toBeLessThan(routePaths.indexOf('/:id'));
    expect(routePaths.indexOf('/import/:taskId')).toBeLessThan(routePaths.indexOf('/:id'));
  });

  it('declares expected permission guards for price routes', () => {
    expect(getRouteGuard('/import-template', 'get')?.requiredPermissions).toEqual(['price:view']);
    expect(getRouteGuard('/import', 'post')?.requiredPermissions).toEqual(['price:import']);
    expect(getRouteGuard('/import', 'post')?.allowedRoles).toEqual(['boss', 'manager']);
    expect(getRouteGuard('/', 'get')?.requiredPermissions).toEqual(['price:view']);
    expect(getRouteGuard('/', 'post')?.requiredPermissions).toEqual(['price:manage']);
    expect(getRouteGuard('/:id', 'put')?.requiredPermissions).toEqual(['price:manage']);
  });
});
