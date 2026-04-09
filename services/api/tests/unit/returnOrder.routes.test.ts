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

jest.mock('../../src/modules/return-order/returnOrder.controller', () => ({
  returnOrderController: {
    list: jest.fn(),
    getById: jest.fn(),
    create: jest.fn(),
    confirm: jest.fn(),
    ship: jest.fn(),
    complete: jest.fn(),
  },
}));

import router from '../../src/modules/return-order/returnOrder.routes';

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

describe('returnOrder.routes wiring', () => {
  it('mounts authMiddleware at router level', () => {
    expect(router.stack[0]?.handle).toBe(authMiddlewareMock);
  });

  it('declares expected permission guards for return order routes', () => {
    expect(getRouteGuard('/', 'get')?.requiredPermissions).toEqual(['purchase:return:view']);
    expect(getRouteGuard('/:id', 'get')?.requiredPermissions).toEqual(['purchase:return:view']);
    expect(getRouteGuard('/', 'post')?.requiredPermissions).toEqual(['purchase:return:create']);
    expect(getRouteGuard('/:id/confirm', 'put')?.requiredPermissions).toEqual(['purchase:return:confirm']);
    expect(getRouteGuard('/:id/ship', 'put')?.requiredPermissions).toEqual(['purchase:return:ship']);
    expect(getRouteGuard('/:id/complete', 'put')?.requiredPermissions).toEqual(['purchase:return:complete']);
  });
});
