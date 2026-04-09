const requireRolesMock = jest.fn((...allowedRoles: string[]) => {
  const middleware = (_req: unknown, _res: unknown, next: () => void) => next();
  (middleware as typeof middleware & { allowedRoles?: string[] }).allowedRoles = allowedRoles;
  return middleware;
});
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
  requireRoles: requireRolesMock,
  requirePermissionsOrRoles: requirePermissionsOrRolesMock,
}));

jest.mock('../../src/app', () => ({
  asyncHandler: (fn: unknown) => fn,
}));

jest.mock('../../src/modules/settlement/settlement.controller', () => ({
  settlementController: {
    getReceivable: jest.fn(),
    exportCsv: jest.fn(),
    createSettlement: jest.fn(),
    listPendingOrders: jest.fn(),
    listSettlements: jest.fn(),
    getSettlement: jest.fn(),
    confirmSettlement: jest.fn(),
    paySettlement: jest.fn(),
    cancelSettlement: jest.fn(),
  },
}));

import router from '../../src/modules/settlement/settlement.routes';

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

describe('settlement.routes wiring', () => {
  it('mounts authMiddleware at router level', () => {
    expect(router.stack[0]?.handle).toBe(authMiddlewareMock);
  });

  it('keeps fixed routes before parameter route', () => {
    const routePaths = router.stack
      .filter((layer: any) => layer.route)
      .map((layer: any) => layer.route.path);

    expect(routePaths.indexOf('/receivable')).toBeLessThan(routePaths.indexOf('/:id'));
    expect(routePaths.indexOf('/export/csv')).toBeLessThan(routePaths.indexOf('/:id'));
    expect(routePaths.indexOf('/pending-orders')).toBeLessThan(routePaths.indexOf('/:id'));
  });

  it('declares expected permission and role guards', () => {
    expect(getRouteGuard('/receivable', 'get')?.requiredPermissions).toEqual(['settlement:receivable:view']);
    expect(getRouteGuard('/receivable', 'get')?.allowedRoles).toEqual(['boss', 'supervisor']);
    expect(getRouteGuard('/export/csv', 'get')?.requiredPermissions).toEqual(['settlement:manage']);
    expect(getRouteGuard('/export/csv', 'get')?.allowedRoles).toEqual(['boss', 'supervisor']);
    expect(getRouteGuard('/', 'post')?.requiredPermissions).toEqual(['settlement:manage']);
    expect(getRouteGuard('/', 'post')?.allowedRoles).toEqual(['boss', 'supervisor']);
    expect(getRouteGuard('/pending-orders', 'get')?.requiredPermissions).toEqual(['settlement:pending:view']);
    expect(getRouteGuard('/pending-orders', 'get')?.allowedRoles).toEqual(['boss', 'supervisor', 'sales']);
    expect(getRouteGuard('/', 'get')?.requiredPermissions).toEqual(['settlement:manage', 'settlement:pending:view']);
    expect(getRouteGuard('/', 'get')?.allowedRoles).toEqual(['boss', 'supervisor', 'sales']);
    expect(getRouteGuard('/:id/confirm', 'put')?.requiredPermissions).toEqual(['settlement:boss']);
    expect(getRouteGuard('/:id/confirm', 'put')?.allowedRoles).toEqual(['boss']);
    expect(getRouteGuard('/:id/pay', 'put')?.requiredPermissions).toEqual(['settlement:boss']);
    expect(getRouteGuard('/:id/pay', 'put')?.allowedRoles).toEqual(['boss']);
    expect(getRouteGuard('/:id/cancel', 'put')?.requiredPermissions).toEqual(['settlement:manage']);
    expect(getRouteGuard('/:id/cancel', 'put')?.allowedRoles).toEqual(['boss', 'supervisor']);
  });
});
