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

jest.mock('../../src/modules/purchase/purchaseSuggestion.controller', () => ({
  purchaseSuggestionController: {
    list: jest.fn(),
    approve: jest.fn(),
    reject: jest.fn(),
    batchToPO: jest.fn(),
  },
}));

import router from '../../src/modules/purchase/purchaseSuggestion.routes';

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

describe('purchaseSuggestion.routes wiring', () => {
  it('mounts authMiddleware at router level', () => {
    expect(router.stack[0]?.handle).toBe(authMiddlewareMock);
  });

  it('declares expected permission guards for purchase suggestion routes', () => {
    expect(getRouteGuard('/', 'get')?.requiredPermissions).toEqual(['purchase:suggestion:view']);
    expect(getRouteGuard('/:id/approve', 'put')?.requiredPermissions).toEqual(['purchase:suggestion:approve']);
    expect(getRouteGuard('/:id/reject', 'put')?.requiredPermissions).toEqual(['purchase:suggestion:approve']);
    expect(getRouteGuard('/batch-to-po', 'post')?.requiredPermissions).toEqual(['purchase:order:create']);
    expect(getRouteGuard('/batch-to-po', 'post')?.allowedRoles).toEqual(['purchase', 'purchaser', 'supervisor', 'boss']);
  });
});
