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

jest.mock('../../src/modules/incoming-inspection/incomingInspection.controller', () => ({
  incomingInspectionController: {
    list: jest.fn(),
    getById: jest.fn(),
    create: jest.fn(),
    updateItems: jest.fn(),
    submit: jest.fn(),
    previewReceipt: jest.fn(),
  },
}));

import router from '../../src/modules/incoming-inspection/incomingInspection.routes';

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

describe('incomingInspection.routes wiring', () => {
  it('mounts authMiddleware at router level', () => {
    expect(router.stack[0]?.handle).toBe(authMiddlewareMock);
  });

  it('declares expected permission guards for incoming inspection routes', () => {
    expect(getRouteGuard('/', 'get')?.requiredPermissions).toEqual(['quality:view']);
    expect(getRouteGuard('/:id', 'get')?.requiredPermissions).toEqual(['quality:view']);
    expect(getRouteGuard('/', 'post')?.requiredPermissions).toEqual(['quality:create']);
    expect(getRouteGuard('/:id/items', 'put')?.requiredPermissions).toEqual(['quality:create']);
    expect(getRouteGuard('/:id/submit', 'post')?.requiredPermissions).toEqual(['quality:complete']);
    expect(getRouteGuard('/:id/preview-receipt', 'get')?.requiredPermissions).toEqual(['quality:view']);
  });
});
