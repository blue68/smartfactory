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

jest.mock('../../src/modules/stocktaking/stocktaking.controller', () => ({
  stocktakingController: {
    createTask: jest.fn(),
    listTasks: jest.fn(),
    getTask: jest.fn(),
    exportTask: jest.fn(),
    updateItems: jest.fn(),
    getDiff: jest.fn(),
    submitTask: jest.fn(),
    createAdjustmentOrder: jest.fn(),
    confirmTask: jest.fn(),
  },
}));

import router from '../../src/modules/stocktaking/stocktaking.routes';

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

describe('stocktaking.routes wiring', () => {
  it('mounts authMiddleware at router level', () => {
    expect(router.stack[0]?.handle).toBe(authMiddlewareMock);
  });

  it('declares expected permission guards for stocktaking routes', () => {
    expect(getRouteGuard('/', 'post')?.requiredPermissions).toEqual(['stocktaking:create']);
    expect(getRouteGuard('/', 'get')?.requiredPermissions).toEqual(['stocktaking:view']);
    expect(getRouteGuard('/:id/export', 'post')?.requiredPermissions).toEqual(['stocktaking:view']);
    expect(getRouteGuard('/:id/items', 'put')?.requiredPermissions).toEqual(['stocktaking:create']);
    expect(getRouteGuard('/:id/submit', 'post')?.requiredPermissions).toEqual(['stocktaking:submit']);
    expect(getRouteGuard('/:id/confirm', 'post')?.requiredPermissions).toEqual(['stocktaking:confirm']);
  });
});
