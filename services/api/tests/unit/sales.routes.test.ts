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

jest.mock('../../src/modules/sales/sales.controller', () => ({
  salesController: {
    list: jest.fn(),
    getOne: jest.fn(),
    create: jest.fn(),
    approve: jest.fn(),
    analyzeUrgent: jest.fn(),
    updateOrder: jest.fn(),
    cancelOrder: jest.fn(),
    shipOrder: jest.fn(),
    confirmReceipt: jest.fn(),
    createSettlement: jest.fn(),
    recordPayment: jest.fn(),
    updateInvoice: jest.fn(),
    getReceivables: jest.fn(),
  },
}));

jest.mock('../../src/modules/sales/sales.service', () => ({
  SalesService: jest.fn(),
}));

import router from '../../src/modules/sales/sales.routes';

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

describe('sales.routes wiring', () => {
  it('mounts authMiddleware at router level', () => {
    expect(router.stack[0]?.handle).toBe(authMiddlewareMock);
  });

  it('keeps fixed routes before parameter route to avoid ambiguity', () => {
    const routePaths = router.stack
      .filter((layer: any) => layer.route)
      .map((layer: any) => layer.route.path);

    expect(routePaths.indexOf('/receivables')).toBeLessThan(routePaths.indexOf('/:id'));
    expect(routePaths.indexOf('/export/csv')).toBeLessThan(routePaths.indexOf('/:id'));
  });

  it('declares expected role guards for critical sales routes', () => {
    expect(getRouteRoles('/', 'post')).toEqual(['sales', 'boss']);
    expect(getRouteRoles('/:id/approve', 'post')).toEqual(['boss']);
    expect(getRouteRoles('/analyze-urgent', 'post')).toEqual(['sales', 'boss', 'supervisor']);
    expect(getRouteRoles('/:id/ship', 'post')).toEqual(['warehouse', 'supervisor']);
    expect(getRouteRoles('/:id/deliveries/:deliveryId/confirm', 'post')).toEqual([
      'boss',
      'supervisor',
      'sales',
    ]);
  });

  it('declares expected settlement and receivable role guards', () => {
    expect(getRouteRoles('/receivables', 'get')).toEqual(['boss', 'sales']);
    expect(getRouteRoles('/:id/settlement', 'post')).toEqual(['boss', 'sales']);
    expect(getRouteRoles('/settlements/:settlementId/payments', 'post')).toEqual(['boss', 'sales']);
    expect(getRouteRoles('/settlements/:settlementId/invoice', 'put')).toEqual(['boss', 'sales']);
  });
});
