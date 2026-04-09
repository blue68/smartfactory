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

jest.mock('../../src/modules/sales-order/salesOrder.controller', () => ({
  salesOrderController: {
    getPendingCount: jest.fn(),
    getPendingApprovals: jest.fn(),
    getStats: jest.fn(),
    capacityCheck: jest.fn(),
    list: jest.fn(),
    getOne: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateItems: jest.fn(),
    transition: jest.fn(),
    submitForApproval: jest.fn(),
    withdraw: jest.fn(),
    confirm: jest.fn(),
    ship: jest.fn(),
    complete: jest.fn(),
    close: jest.fn(),
    createProductionOrders: jest.fn(),
    approve: jest.fn(),
    reject: jest.fn(),
  },
}));

import router from '../../src/modules/sales-order/salesOrder.routes';

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

describe('salesOrder.routes wiring', () => {
  it('mounts authMiddleware at router level', () => {
    expect(router.stack[0]?.handle).toBe(authMiddlewareMock);
  });

  it('keeps fixed routes before parameter route', () => {
    const routePaths = router.stack
      .filter((layer: any) => layer.route)
      .map((layer: any) => layer.route.path);

    expect(routePaths.indexOf('/pending-count')).toBeLessThan(routePaths.indexOf('/:id'));
    expect(routePaths.indexOf('/pending-approvals')).toBeLessThan(routePaths.indexOf('/:id'));
    expect(routePaths.indexOf('/stats')).toBeLessThan(routePaths.indexOf('/:id'));
    expect(routePaths.indexOf('/capacity-check')).toBeLessThan(routePaths.indexOf('/:id'));
  });

  it('declares expected permission and role guards for key sales order routes', () => {
    expect(getRouteGuard('/pending-approvals', 'get')?.requiredPermissions).toEqual(['sales:order-list:approve']);
    expect(getRouteGuard('/pending-approvals', 'get')?.allowedRoles).toEqual(['boss']);
    expect(getRouteGuard('/capacity-check', 'get')?.requiredPermissions).toEqual(['sales:order:urgent-analyze']);
    expect(getRouteGuard('/capacity-check', 'get')?.allowedRoles).toEqual(['boss', 'supervisor', 'sales']);
    expect(getRouteGuard('/', 'post')?.requiredPermissions).toEqual(['sales:order-list:create', 'sales:order:create']);
    expect(getRouteGuard('/', 'post')?.allowedRoles).toEqual(['boss', 'supervisor', 'sales']);
    expect(getRouteGuard('/:id/ship', 'post')?.requiredPermissions).toEqual(['sales:order-list:ship']);
    expect(getRouteGuard('/:id/ship', 'post')?.allowedRoles).toEqual(['boss', 'supervisor']);
    expect(getRouteGuard('/:id/approve', 'post')?.requiredPermissions).toEqual(['sales:order-list:approve', 'sales:order:approve']);
    expect(getRouteGuard('/:id/approve', 'post')?.allowedRoles).toEqual(['boss']);
  });
});
