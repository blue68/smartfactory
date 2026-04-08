const requireRolesMock = jest.fn((...allowedRoles: string[]) => {
  const middleware = (_req: unknown, _res: unknown, next: () => void) => next();
  (middleware as typeof middleware & { allowedRoles?: string[] }).allowedRoles = allowedRoles;
  return middleware;
});
const authMiddlewareMock = jest.fn((_req: unknown, _res: unknown, next: () => void) => next());

jest.mock('../../src/middleware/auth', () => ({
  authMiddleware: authMiddlewareMock,
  requireRoles: requireRolesMock,
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

function getRouteRoles(path: string, method: string): string[] | undefined {
  const layer = getRouteLayer(path, method);
  const roleLayer = layer?.route?.stack?.find((stackLayer: any) => (stackLayer.handle as any)?.allowedRoles);
  return (roleLayer?.handle as any)?.allowedRoles;
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

  it('declares expected role guards', () => {
    expect(getRouteRoles('/receivable', 'get')).toEqual(['boss', 'supervisor']);
    expect(getRouteRoles('/export/csv', 'get')).toEqual(['boss', 'supervisor']);
    expect(getRouteRoles('/', 'post')).toEqual(['boss', 'supervisor']);
    expect(getRouteRoles('/pending-orders', 'get')).toEqual(['boss', 'supervisor', 'sales']);
    expect(getRouteRoles('/', 'get')).toEqual(['boss', 'supervisor', 'sales']);
    expect(getRouteRoles('/:id/confirm', 'put')).toEqual(['boss']);
    expect(getRouteRoles('/:id/pay', 'put')).toEqual(['boss']);
    expect(getRouteRoles('/:id/cancel', 'put')).toEqual(['boss', 'supervisor']);
  });
});
