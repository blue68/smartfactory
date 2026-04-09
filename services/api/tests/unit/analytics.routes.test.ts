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

jest.mock('../../src/modules/analytics/analytics.controller', () => ({
  analyticsController: {
    getDashboardKpi: jest.fn(),
    getInventoryAnalysis: jest.fn(),
    getProductionEfficiency: jest.fn(),
    getPurchaseCostAnalysis: jest.fn(),
    getMaterialCategoryRatio: jest.fn(),
    getPurchaseCategoryDistribution: jest.fn(),
  },
}));

import router from '../../src/modules/analytics/analytics.routes';

describe('analytics.routes wiring', () => {
  it('mounts authMiddleware and analytics permission guard at router level', () => {
    expect(router.stack[0]?.handle).toBe(authMiddlewareMock);
    expect((router.stack[1]?.handle as any)?.requiredPermissions).toEqual(['report:analytics:view']);
    expect((router.stack[1]?.handle as any)?.allowedRoles).toEqual(['boss', 'supervisor']);
  });
});
