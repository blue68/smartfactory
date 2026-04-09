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

jest.mock('../../src/modules/bom/bom.controller', () => ({
  bomController: {
    list: jest.fn(),
    getAiSuggestion: jest.fn(),
    getExpanded: jest.fn(),
    exportBom: jest.fn(),
    getCostBreakdown: jest.fn(),
    calcRequirements: jest.fn(),
    create: jest.fn(),
    activate: jest.fn(),
    update: jest.fn(),
    deleteBomItem: jest.fn(),
    updateBomItem: jest.fn(),
    copyBom: jest.fn(),
    addItem: jest.fn(),
  },
}));

import router from '../../src/modules/bom/bom.routes';

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

describe('bom.routes wiring', () => {
  it('mounts authMiddleware at router level', () => {
    expect(router.stack[0]?.handle).toBe(authMiddlewareMock);
  });

  it('keeps ai-suggestion before parameter route', () => {
    const routePaths = router.stack
      .filter((layer: any) => layer.route)
      .map((layer: any) => layer.route.path);

    expect(routePaths.indexOf('/ai-suggestion/:skuId')).toBeLessThan(routePaths.indexOf('/:id/expand'));
  });

  it('declares expected permission guards for bom routes', () => {
    expect(getRouteGuard('/', 'get')?.requiredPermissions).toEqual(['bom:view']);
    expect(getRouteGuard('/ai-suggestion/:skuId', 'get')?.requiredPermissions).toEqual(['bom:create']);
    expect(getRouteGuard('/:id/export', 'get')?.requiredPermissions).toEqual(['bom:view']);
    expect(getRouteGuard('/', 'post')?.requiredPermissions).toEqual(['bom:create']);
    expect(getRouteGuard('/:id/activate', 'post')?.requiredPermissions).toEqual(['bom:activate']);
    expect(getRouteGuard('/:id', 'put')?.requiredPermissions).toEqual(['bom:create']);
  });
});
