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

jest.mock('../../src/modules/schedule-suggestion/schedule-suggestion.controller', () => ({
  scheduleSuggestionController: {
    triggerCalculation: jest.fn(),
    getStatus: jest.fn(),
    getLatest: jest.fn(),
    getHistory: jest.fn(),
    acceptItem: jest.fn(),
    rejectItem: jest.fn(),
    applyProduction: jest.fn(),
    getPurchaseSteps: jest.fn(),
    getHistoryDetail: jest.fn(),
  },
}));

import router from '../../src/modules/schedule-suggestion/schedule-suggestion.routes';

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

describe('schedule-suggestion.routes wiring', () => {
  it('mounts authMiddleware at router level', () => {
    expect(router.stack[0]?.handle).toBe(authMiddlewareMock);
  });

  it('keeps fixed routes before parameter route', () => {
    const routePaths = router.stack
      .filter((layer: any) => layer.route)
      .map((layer: any) => layer.route.path);

    expect(routePaths.indexOf('/calculate')).toBeLessThan(routePaths.indexOf('/:id'));
    expect(routePaths.indexOf('/status')).toBeLessThan(routePaths.indexOf('/:id'));
    expect(routePaths.indexOf('/purchase-steps/:id')).toBeLessThan(routePaths.indexOf('/:id'));
  });

  it('declares expected permission and role guards for schedule suggestion routes', () => {
    expect(getRouteGuard('/calculate', 'post')?.requiredPermissions).toEqual(['schedule:suggestion:trigger']);
    expect(getRouteGuard('/calculate', 'post')?.allowedRoles).toEqual(['supervisor', 'boss']);
    expect(getRouteGuard('/latest', 'get')?.requiredPermissions).toEqual(['schedule:suggestion:purchase:view', 'schedule:suggestion:production:view']);
    expect(getRouteGuard('/latest', 'get')?.allowedRoles).toEqual(['supervisor', 'boss', 'purchase', 'purchaser']);
    expect(getRouteGuard('/items/:itemId/apply', 'post')?.requiredPermissions).toEqual(['production:schedule:confirm']);
    expect(getRouteGuard('/items/:itemId/apply', 'post')?.allowedRoles).toEqual(['supervisor', 'boss']);
    expect(getRouteGuard('/purchase-steps/:id', 'get')?.requiredPermissions).toEqual(['schedule:suggestion:purchase:view']);
    expect(getRouteGuard('/purchase-steps/:id', 'get')?.allowedRoles).toEqual(['supervisor', 'boss', 'purchase', 'purchaser']);
  });
});
