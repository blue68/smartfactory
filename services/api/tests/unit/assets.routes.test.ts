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

jest.mock('../../src/modules/assets/asset.controller', () => ({
  assetController: {
    listCards: jest.fn(),
    getCardById: jest.fn(),
    acceptAssets: jest.fn(),
    transferCard: jest.fn(),
    returnCard: jest.fn(),
    scrapCard: jest.fn(),
  },
}));

import router from '../../src/modules/assets/asset.routes';

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

describe('asset.routes wiring', () => {
  it('mounts authMiddleware at router level', () => {
    expect(router.stack[0]?.handle).toBe(authMiddlewareMock);
  });

  it('declares expected permission guards for asset routes', () => {
    expect(getRouteGuard('/cards', 'get')?.requiredPermissions).toEqual(['asset:view']);
    expect(getRouteGuard('/acceptance', 'post')?.requiredPermissions).toEqual(['asset:acceptance:create']);
    expect(getRouteGuard('/cards/:id/transfer', 'post')?.requiredPermissions).toEqual(['asset:transfer']);
    expect(getRouteGuard('/cards/:id/return', 'post')?.requiredPermissions).toEqual(['asset:return']);
    expect(getRouteGuard('/cards/:id/return', 'post')?.allowedRoles).toEqual(['boss', 'supervisor', 'warehouse']);
    expect(getRouteGuard('/cards/:id/scrap', 'post')?.requiredPermissions).toEqual(['asset:scrap']);
  });
});
