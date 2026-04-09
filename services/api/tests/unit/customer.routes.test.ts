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

jest.mock('../../src/modules/sales-customer/customer.controller', () => ({
  customerController: {
    getOptions: jest.fn(),
    exportExcel: jest.fn(),
    list: jest.fn(),
    create: jest.fn(),
    getOne: jest.fn(),
    update: jest.fn(),
    updateStatus: jest.fn(),
    getContacts: jest.fn(),
    addContact: jest.fn(),
    updateContact: jest.fn(),
    removeContact: jest.fn(),
    getOrders: jest.fn(),
  },
}));

import router from '../../src/modules/sales-customer/customer.routes';

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

describe('customer.routes wiring', () => {
  it('mounts authMiddleware at router level', () => {
    expect(router.stack[0]?.handle).toBe(authMiddlewareMock);
  });

  it('keeps fixed routes before parameter route', () => {
    const routePaths = router.stack
      .filter((layer: any) => layer.route)
      .map((layer: any) => layer.route.path);

    expect(routePaths.indexOf('/options')).toBeLessThan(routePaths.indexOf('/:id'));
    expect(routePaths.indexOf('/export')).toBeLessThan(routePaths.indexOf('/:id'));
  });

  it('declares expected permission guards for customer routes', () => {
    expect(getRouteGuard('/options', 'get')?.requiredPermissions).toEqual(['sales:customer:view']);
    expect(getRouteGuard('/', 'get')?.requiredPermissions).toEqual(['sales:customer:view']);
    expect(getRouteGuard('/', 'post')?.requiredPermissions).toEqual(['sales:customer:manage']);
    expect(getRouteGuard('/:id', 'put')?.requiredPermissions).toEqual(['sales:customer:manage']);
    expect(getRouteGuard('/:id/contacts', 'get')?.requiredPermissions).toEqual(['sales:customer:view']);
    expect(getRouteGuard('/:id/contacts/:contactId', 'delete')?.requiredPermissions).toEqual(['sales:customer:manage']);
  });
});
