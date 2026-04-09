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

jest.mock('../../src/modules/quality/quality.controller', () => ({
  qualityController: {
    listInspections: jest.fn(),
    listProductionOrderOptions: jest.fn(),
    listInspectionOptions: jest.fn(),
    createInspection: jest.fn(),
    recordIssue: jest.fn(),
    completeInspection: jest.fn(),
    getTraceability: jest.fn(),
    getStats: jest.fn(),
    listIssues: jest.fn(),
    getIssueDetail: jest.fn(),
  },
}));

import router from '../../src/modules/quality/quality.routes';

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

describe('quality.routes wiring', () => {
  it('mounts authMiddleware at router level', () => {
    expect(router.stack[0]?.handle).toBe(authMiddlewareMock);
  });

  it('declares expected permission guards for quality routes', () => {
    expect(getRouteGuard('/inspections', 'get')?.requiredPermissions).toEqual(['quality:view']);
    expect(getRouteGuard('/production-orders/options', 'get')?.requiredPermissions).toEqual(['quality:create']);
    expect(getRouteGuard('/inspection-options', 'get')?.requiredPermissions).toEqual(['quality:create']);
    expect(getRouteGuard('/inspections', 'post')?.requiredPermissions).toEqual(['quality:create']);
    expect(getRouteGuard('/inspections/issues', 'post')?.requiredPermissions).toEqual(['quality:issue:create']);
    expect(getRouteGuard('/inspections/:id/complete', 'post')?.requiredPermissions).toEqual(['quality:complete']);
    expect(getRouteGuard('/traceability/:productionOrderId', 'get')?.requiredPermissions).toEqual(['quality:view']);
    expect(getRouteGuard('/issues', 'get')?.requiredPermissions).toEqual(['quality:view']);
  });
});
