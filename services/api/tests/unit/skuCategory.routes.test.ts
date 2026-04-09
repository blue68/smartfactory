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

jest.mock('../../src/modules/sku-category/skuCategory.controller', () => ({
  skuCategoryController: {
    getTree: jest.fn(),
    deletePreview: jest.fn(),
    create: jest.fn(),
    getAuditLogs: jest.fn(),
    reorder: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
}));

import router from '../../src/modules/sku-category/skuCategory.routes';

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

describe('skuCategory.routes wiring', () => {
  it('mounts authMiddleware at router level', () => {
    expect(router.stack[0]?.handle).toBe(authMiddlewareMock);
  });

  it('keeps audit-logs before parameter route', () => {
    const routePaths = router.stack
      .filter((layer: any) => layer.route)
      .map((layer: any) => layer.route.path);

    expect(routePaths.indexOf('/audit-logs')).toBeLessThan(routePaths.indexOf('/:id'));
  });

  it('declares expected permission guards for sku category routes', () => {
    expect(getRouteGuard('/:id/delete-preview', 'get')?.requiredPermissions).toEqual(['sku:category:manage']);
    expect(getRouteGuard('/', 'post')?.requiredPermissions).toEqual(['sku:category:manage']);
    expect(getRouteGuard('/audit-logs', 'get')?.requiredPermissions).toEqual(['sku:category:audit:view']);
    expect(getRouteGuard('/reorder', 'patch')?.requiredPermissions).toEqual(['sku:category:manage']);
    expect(getRouteGuard('/:id', 'delete')?.requiredPermissions).toEqual(['sku:category:manage']);
  });
});
