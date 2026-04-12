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

jest.mock('../../src/modules/production/production.controller', () => ({
  productionController: {
    getWorkCalendar: jest.fn(),
    setHoliday: jest.fn(),
    setWorkdayConfig: jest.fn(),
    getDashboard: jest.fn(),
    listWorkers: jest.fn(),
    listWorkstations: jest.fn(),
    createWorkstation: jest.fn(),
    updateWorkstation: jest.fn(),
    deleteWorkstation: jest.fn(),
    adjustSchedule: jest.fn(),
    listOrders: jest.fn(),
    getOrder: jest.fn(),
    createOrder: jest.fn(),
    getScheduleHistory: jest.fn(),
    generateSchedule: jest.fn(),
    confirmSchedule: jest.fn(),
    getTaskStats: jest.fn(),
    listTaskCategories: jest.fn(),
    listTasks: jest.fn(),
    getWorkerTasks: jest.fn(),
    getTask: jest.fn(),
    startTask: jest.fn(),
    completeTask: jest.fn(),
    completeTaskV2: jest.fn(),
    issueTaskMaterials: jest.fn(),
    returnTaskMaterials: jest.fn(),
    suspendTask: jest.fn(),
    resumeTask: jest.fn(),
    reportException: jest.fn(),
    resolveException: jest.fn(),
  },
}));

jest.mock('../../src/modules/production/production-order.controller', () => ({
  productionOrderController: {
    createFromSalesOrder: jest.fn(),
    getMaterialRequirements: jest.fn(),
    checkMaterialStatus: jest.fn(),
    releaseOrder: jest.fn(),
    getComponents: jest.fn(),
    getOperations: jest.fn(),
    cancelOrder: jest.fn(),
  },
}));

import router from '../../src/modules/production/production.routes';

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

describe('production.routes phase1 wiring', () => {
  it('mounts authMiddleware at router level', () => {
    expect(router.stack[0]?.handle).toBe(authMiddlewareMock);
  });

  it('declares expected permission and role guards for phase1 order endpoints', () => {
    expect(getRouteGuard('/work-calendar', 'get')?.requiredPermissions).toEqual(['production:schedule:view']);
    expect(getRouteGuard('/work-calendar/holiday', 'post')?.requiredPermissions).toEqual(['production:calendar:manage']);
    expect(getRouteGuard('/work-calendar/day', 'put')?.requiredPermissions).toEqual(['production:calendar:manage']);
    expect(getRouteGuard('/workstations', 'get')?.requiredPermissions).toEqual(['production:schedule:view']);
    expect(getRouteGuard('/workstations', 'post')?.requiredPermissions).toEqual(['production:workstation:manage']);
    expect(getRouteGuard('/schedule/:date/adjust', 'put')?.requiredPermissions).toEqual(['production:schedule:adjust']);
    expect(getRouteGuard('/orders/:id/release', 'post')?.requiredPermissions).toEqual(['production:order:create']);
    expect(getRouteGuard('/orders/:id/release', 'post')?.allowedRoles).toEqual(['supervisor', 'boss']);
    expect(getRouteGuard('/orders/:id/components', 'get')?.requiredPermissions).toEqual(['production:order:view']);
    expect(getRouteGuard('/orders/:id/components', 'get')?.allowedRoles).toEqual(['supervisor', 'boss', 'purchase', 'purchaser']);
    expect(getRouteGuard('/orders/:id/operations', 'get')?.requiredPermissions).toEqual(['production:order:view']);
    expect(getRouteGuard('/orders/:id/operations', 'get')?.allowedRoles).toEqual(['supervisor', 'boss']);
  });

  it('keeps phase1 order endpoints mounted', () => {
    expect(getRouteLayer('/orders/:id/release', 'post')).toBeTruthy();
    expect(getRouteLayer('/orders/:id/components', 'get')).toBeTruthy();
    expect(getRouteLayer('/orders/:id/operations', 'get')).toBeTruthy();
  });

  it('mounts task execution endpoints with worker/supervisor/boss/admin guard', () => {
    expect(getRouteLayer('/tasks/:id/start', 'post')).toBeTruthy();
    expect(getRouteGuard('/tasks/:id/start', 'post')?.requiredPermissions).toEqual(['production:task:operate']);
    expect(getRouteGuard('/tasks/:id/start', 'post')?.allowedRoles).toEqual(['worker', 'supervisor', 'boss', 'admin']);
    expect(getRouteLayer('/tasks/:id/complete-v2', 'post')).toBeTruthy();
    expect(getRouteGuard('/tasks/:id/complete-v2', 'post')?.requiredPermissions).toEqual(['production:task:complete', 'production:task:operate']);
    expect(getRouteGuard('/tasks/:id/complete-v2', 'post')?.allowedRoles).toEqual(['worker', 'supervisor', 'boss', 'admin']);
  });

  it('keeps fixed task routes ahead of /tasks/:taskId and mounts task detail route', () => {
    const routePaths = router.stack
      .filter((layer: any) => layer.route)
      .map((layer: any) => layer.route.path);

    expect(getRouteLayer('/tasks/:taskId', 'get')).toBeTruthy();
    expect(routePaths.indexOf('/tasks/stats')).toBeLessThan(routePaths.indexOf('/tasks/:taskId'));
    expect(routePaths.indexOf('/tasks/categories')).toBeLessThan(routePaths.indexOf('/tasks/:taskId'));
    expect(routePaths.indexOf('/tasks')).toBeLessThan(routePaths.indexOf('/tasks/:taskId'));
    expect(routePaths.indexOf('/tasks/worker/:workerId')).toBeLessThan(routePaths.indexOf('/tasks/:taskId'));
  });
});
