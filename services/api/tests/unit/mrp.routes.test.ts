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

jest.mock('../../src/modules/mrp/mrp.controller', () => ({
  mrpController: {
    getShortageReport: jest.fn(),
    getGlobalShortageSummary: jest.fn(),
    generateSuggestions: jest.fn(),
    reevaluateAfterReceipt: jest.fn(),
    getSupplyChainDashboard: jest.fn(),
  },
}));

import router from '../../src/modules/mrp/mrp.routes';

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

describe('mrp.routes wiring', () => {
  it('mounts authMiddleware at router level', () => {
    expect(router.stack[0]?.handle).toBe(authMiddlewareMock);
  });

  it('declares expected permission guards for mrp routes', () => {
    expect(getRouteGuard('/shortage-report/:productionOrderId', 'get')?.requiredPermissions).toEqual(['production:shortage:view']);
    expect(getRouteGuard('/shortage-summary', 'get')?.requiredPermissions).toEqual(['production:shortage:view']);
    expect(getRouteGuard('/generate-suggestions', 'post')?.requiredPermissions).toEqual(['purchase:suggestion:generate']);
    expect(getRouteGuard('/reevaluate', 'post')?.requiredPermissions).toEqual(['production:shortage:reevaluate']);
    expect(getRouteGuard('/supply-chain-dashboard', 'get')?.requiredPermissions).toEqual(['production:shortage:view']);
  });
});
