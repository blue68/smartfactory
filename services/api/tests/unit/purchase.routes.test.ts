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

jest.mock('../../src/modules/purchase/purchase.service', () => ({
  PurchaseService: jest.fn(),
}));

jest.mock('../../src/modules/purchase/purchase.controller', () => ({
  purchaseController: {
    generateSuggestions: jest.fn(),
    listSuggestions: jest.fn(),
    approveSuggestion: jest.fn(),
    feedbackSuggestion: jest.fn(),
    listPOs: jest.fn(),
    listTailOrders: jest.fn(),
    listOrderDeliveries: jest.fn(),
    getOrderById: jest.fn(),
    listDeliveryNotes: jest.fn(),
    getDeliveryNoteById: jest.fn(),
    listReceipts: jest.fn(),
    getReceiptById: jest.fn(),
    updateReceiptNotes: jest.fn(),
    createPO: jest.fn(),
    closeOrder: jest.fn(),
    createDeliveryNote: jest.fn(),
    runMatch: jest.fn(),
    listMatches: jest.fn(),
    getMatchById: jest.fn(),
    confirmDiff: jest.fn(),
    exportSettlements: jest.fn(),
    createSettlement: jest.fn(),
    listSettlements: jest.fn(),
    getSettlementById: jest.fn(),
    confirmSettlement: jest.fn(),
    paySettlement: jest.fn(),
    cancelSettlement: jest.fn(),
  },
}));

import router from '../../src/modules/purchase/purchase.routes';

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

describe('purchase.routes wiring', () => {
  it('mounts authMiddleware at router level', () => {
    expect(router.stack[0]?.handle).toBe(authMiddlewareMock);
  });

  it('declares expected permission and role guards for purchase routes', () => {
    expect(getRouteGuard('/suggestions/generate', 'post')?.requiredPermissions).toEqual(['purchase:suggestion:generate']);
    expect(getRouteGuard('/suggestions/generate', 'post')?.allowedRoles).toEqual(['boss', 'purchaser', 'purchase']);
    expect(getRouteGuard('/orders', 'get')?.requiredPermissions).toEqual(['purchase:order:view']);
    expect(getRouteGuard('/orders', 'get')?.allowedRoles).toEqual(['boss', 'supervisor', 'purchaser', 'purchase']);
    expect(getRouteGuard('/orders/:id/delivery', 'post')?.requiredPermissions).toEqual(['purchase:order:delivery']);
    expect(getRouteGuard('/orders/:id/delivery', 'post')?.allowedRoles).toEqual(['purchaser', 'purchase']);
    expect(getRouteGuard('/three-way-match/:id/confirm', 'post')?.requiredPermissions).toEqual(['purchase:match:confirm']);
    expect(getRouteGuard('/three-way-match/:id/confirm', 'post')?.allowedRoles).toEqual(['purchaser', 'purchase']);
    expect(getRouteGuard('/settlements/:id/pay', 'put')?.requiredPermissions).toEqual(['purchase:settlement:boss']);
    expect(getRouteGuard('/settlements/:id/pay', 'put')?.allowedRoles).toEqual(['boss']);
  });
});
