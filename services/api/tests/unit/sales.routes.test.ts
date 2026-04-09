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

function getRouteGuard(path: string, method: string) {
  const layer = getRouteLayer(path, method);
  return layer?.route?.stack?.find((stackLayer: any) =>
    (stackLayer.handle as any)?.allowedRoles || (stackLayer.handle as any)?.requiredPermissions,
  )?.handle as { allowedRoles?: string[]; requiredPermissions?: string[] } | undefined;
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

  it('declares expected permission and role guards for critical sales routes', () => {
    expect(getRouteGuard('/', 'post')?.requiredPermissions).toEqual(['sales:order:create']);
    expect(getRouteGuard('/', 'post')?.allowedRoles).toEqual(['sales', 'boss']);
    expect(getRouteGuard('/:id/approve', 'post')?.requiredPermissions).toEqual(['sales:order:approve']);
    expect(getRouteGuard('/:id/approve', 'post')?.allowedRoles).toEqual(['boss']);
    expect(getRouteGuard('/analyze-urgent', 'post')?.requiredPermissions).toEqual(['sales:order:urgent-analyze']);
    expect(getRouteGuard('/analyze-urgent', 'post')?.allowedRoles).toEqual(['sales', 'boss', 'supervisor']);
    expect(getRouteGuard('/:id/ship', 'post')?.requiredPermissions).toEqual(['sales:order-list:ship']);
    expect(getRouteGuard('/:id/ship', 'post')?.allowedRoles).toEqual(['warehouse', 'supervisor']);
    expect(getRouteGuard('/:id/deliveries/:deliveryId/confirm', 'post')?.requiredPermissions).toEqual(['settlement:manage', 'settlement:pending:view']);
    expect(getRouteGuard('/:id/deliveries/:deliveryId/confirm', 'post')?.allowedRoles).toEqual(['boss', 'supervisor', 'sales']);
  });

  it('declares expected settlement and receivable permission guards', () => {
    expect(getRouteGuard('/receivables', 'get')?.requiredPermissions).toEqual(['settlement:receivable:view']);
    expect(getRouteGuard('/receivables', 'get')?.allowedRoles).toEqual(['boss', 'sales']);
    expect(getRouteGuard('/:id/settlement', 'post')?.requiredPermissions).toEqual(['settlement:manage', 'settlement:pending:view']);
    expect(getRouteGuard('/:id/settlement', 'post')?.allowedRoles).toEqual(['boss', 'sales']);
    expect(getRouteGuard('/settlements/:settlementId/payments', 'post')?.requiredPermissions).toEqual(['settlement:boss', 'settlement:manage']);
    expect(getRouteGuard('/settlements/:settlementId/payments', 'post')?.allowedRoles).toEqual(['boss', 'sales']);
    expect(getRouteGuard('/settlements/:settlementId/invoice', 'put')?.requiredPermissions).toEqual(['settlement:manage']);
    expect(getRouteGuard('/settlements/:settlementId/invoice', 'put')?.allowedRoles).toEqual(['boss', 'sales']);
  });
});
