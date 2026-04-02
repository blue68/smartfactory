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

jest.mock('../../src/modules/production/production.controller', () => ({
  productionController: {
    getWorkCalendar: jest.fn(),
    setHoliday: jest.fn(),
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
    generateSchedule: jest.fn(),
    confirmSchedule: jest.fn(),
    getTaskStats: jest.fn(),
    listTasks: jest.fn(),
    getWorkerTasks: jest.fn(),
    getTask: jest.fn(),
    startTask: jest.fn(),
    completeTask: jest.fn(),
    completeTaskV2: jest.fn(),
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

function getRouteRoles(path: string, method: string): string[] | undefined {
  const layer = getRouteLayer(path, method);
  const roleLayer = layer?.route?.stack?.find((stackLayer: any) => (stackLayer.handle as any)?.allowedRoles);
  return (roleLayer?.handle as any)?.allowedRoles;
}

describe('production.routes phase1 wiring', () => {
  it('mounts authMiddleware at router level', () => {
    expect(router.stack[0]?.handle).toBe(authMiddlewareMock);
  });

  it('declares expected role guards for phase1 order endpoints', () => {
    expect(getRouteRoles('/orders/:id/release', 'post')).toEqual(['supervisor', 'boss']);
    expect(getRouteRoles('/orders/:id/components', 'get')).toEqual(['supervisor', 'boss', 'purchase']);
    expect(getRouteRoles('/orders/:id/operations', 'get')).toEqual(['supervisor', 'boss']);
  });

  it('keeps phase1 order endpoints mounted', () => {
    expect(getRouteLayer('/orders/:id/release', 'post')).toBeTruthy();
    expect(getRouteLayer('/orders/:id/components', 'get')).toBeTruthy();
    expect(getRouteLayer('/orders/:id/operations', 'get')).toBeTruthy();
  });

  it('mounts complete-v2 task endpoint with worker/supervisor guard', () => {
    expect(getRouteLayer('/tasks/:id/complete-v2', 'post')).toBeTruthy();
    expect(getRouteRoles('/tasks/:id/complete-v2', 'post')).toEqual(['worker', 'supervisor']);
  });

  it('keeps fixed task routes ahead of /tasks/:taskId and mounts task detail route', () => {
    const routePaths = router.stack
      .filter((layer: any) => layer.route)
      .map((layer: any) => layer.route.path);

    expect(getRouteLayer('/tasks/:taskId', 'get')).toBeTruthy();
    expect(routePaths.indexOf('/tasks/stats')).toBeLessThan(routePaths.indexOf('/tasks/:taskId'));
    expect(routePaths.indexOf('/tasks')).toBeLessThan(routePaths.indexOf('/tasks/:taskId'));
    expect(routePaths.indexOf('/tasks/worker/:workerId')).toBeLessThan(routePaths.indexOf('/tasks/:taskId'));
  });
});
