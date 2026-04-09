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

jest.mock('../../src/shared/queue', () => ({
  triggerStockAlertScan: jest.fn(),
}));

jest.mock('../../src/modules/inventory/inventory.service', () => ({
  InventoryService: jest.fn(),
}));

jest.mock('../../src/modules/inventory/inventory.controller', () => ({
  inventoryController: {
    list: jest.fn(),
    listWarehouses: jest.fn(),
    listLocations: jest.fn(),
    createWarehouse: jest.fn(),
    updateWarehouse: jest.fn(),
    deleteWarehouse: jest.fn(),
    createLocation: jest.fn(),
    updateLocation: jest.fn(),
    deleteLocation: jest.fn(),
    downloadWarehouseImportTemplateCsv: jest.fn(),
    importWarehousesCsv: jest.fn(),
    downloadLocationImportTemplateCsv: jest.fn(),
    importLocationsCsv: jest.fn(),
    getSummary: jest.fn(),
    checkAvailability: jest.fn(),
    listDailySnapshots: jest.fn(),
    listTransactions: jest.fn(),
    rebuildSnapshots: jest.fn(),
    reconcileInventory: jest.fn(),
    repairInventory: jest.fn(),
    getDyeLots: jest.fn(),
    getAvailable: jest.fn(),
    fifoDyeLot: jest.fn(),
    recordWaste: jest.fn(),
    inbound: jest.fn(),
    outbound: jest.fn(),
    startStocktake: jest.fn(),
    submitStocktakeItem: jest.fn(),
    getStocktakeDiff: jest.fn(),
  },
}));

import router from '../../src/modules/inventory/inventory.routes';

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

describe('inventory.routes wiring', () => {
  it('mounts authMiddleware at router level', () => {
    expect(router.stack[0]?.handle).toBe(authMiddlewareMock);
  });

  it('keeps fixed routes before parameterized sku routes', () => {
    const routePaths = router.stack
      .filter((layer: any) => layer.route)
      .map((layer: any) => layer.route.path);

    expect(routePaths.indexOf('/summary')).toBeLessThan(routePaths.indexOf('/:skuId/dye-lots'));
    expect(routePaths.indexOf('/check')).toBeLessThan(routePaths.indexOf('/:skuId/dye-lots'));
    expect(routePaths.indexOf('/daily-snapshots')).toBeLessThan(routePaths.indexOf('/:skuId/dye-lots'));
    expect(routePaths.indexOf('/warehouses/import-template/csv')).toBeLessThan(routePaths.indexOf('/:skuId/dye-lots'));
    expect(routePaths.indexOf('/locations/import-template/csv')).toBeLessThan(routePaths.indexOf('/:skuId/dye-lots'));
    expect(routePaths.indexOf('/reconcile')).toBeLessThan(routePaths.indexOf('/:skuId/dye-lots'));
    expect(routePaths.indexOf('/repair')).toBeLessThan(routePaths.indexOf('/:skuId/dye-lots'));
  });

  it('declares expected permission and role guards for key inventory routes', () => {
    expect(getRouteGuard('/daily-snapshots', 'get')?.requiredPermissions).toEqual(['inventory:view']);
    expect(getRouteGuard('/warehouses', 'post')?.requiredPermissions).toEqual(['warehouse:location:manage']);
    expect(getRouteGuard('/warehouses', 'post')?.allowedRoles).toEqual(['supervisor', 'boss', 'admin', 'warehouse']);
    expect(getRouteGuard('/warehouses/:id', 'put')?.requiredPermissions).toEqual(['warehouse:location:manage']);
    expect(getRouteGuard('/warehouses/:id', 'put')?.allowedRoles).toEqual(['supervisor', 'boss', 'admin', 'warehouse']);
    expect(getRouteGuard('/warehouses/:id', 'delete')?.requiredPermissions).toEqual(['warehouse:location:manage']);
    expect(getRouteGuard('/warehouses/:id', 'delete')?.allowedRoles).toEqual(['supervisor', 'boss', 'admin', 'warehouse']);
    expect(getRouteGuard('/locations', 'post')?.requiredPermissions).toEqual(['warehouse:location:manage']);
    expect(getRouteGuard('/locations', 'post')?.allowedRoles).toEqual(['supervisor', 'boss', 'admin', 'warehouse']);
    expect(getRouteGuard('/locations/:id', 'put')?.requiredPermissions).toEqual(['warehouse:location:manage']);
    expect(getRouteGuard('/locations/:id', 'put')?.allowedRoles).toEqual(['supervisor', 'boss', 'admin', 'warehouse']);
    expect(getRouteGuard('/locations/:id', 'delete')?.requiredPermissions).toEqual(['warehouse:location:manage']);
    expect(getRouteGuard('/locations/:id', 'delete')?.allowedRoles).toEqual(['supervisor', 'boss', 'admin', 'warehouse']);
    expect(getRouteGuard('/warehouses/import-csv', 'post')?.requiredPermissions).toEqual(['warehouse:location:import']);
    expect(getRouteGuard('/warehouses/import-csv', 'post')?.allowedRoles).toEqual(['supervisor', 'boss']);
    expect(getRouteGuard('/locations/import-csv', 'post')?.requiredPermissions).toEqual(['warehouse:location:import']);
    expect(getRouteGuard('/locations/import-csv', 'post')?.allowedRoles).toEqual(['supervisor', 'boss']);
    expect(getRouteGuard('/snapshots/rebuild', 'post')?.requiredPermissions).toEqual(['inventory:maintain']);
    expect(getRouteGuard('/snapshots/rebuild', 'post')?.allowedRoles).toEqual(['supervisor', 'boss']);
    expect(getRouteGuard('/reconcile', 'post')?.requiredPermissions).toEqual(['inventory:maintain']);
    expect(getRouteGuard('/reconcile', 'post')?.allowedRoles).toEqual(['supervisor', 'boss']);
    expect(getRouteGuard('/repair', 'post')?.requiredPermissions).toEqual(['inventory:maintain']);
    expect(getRouteGuard('/repair', 'post')?.allowedRoles).toEqual(['supervisor', 'boss']);
    expect(getRouteGuard('/waste', 'post')?.requiredPermissions).toEqual(['inventory:waste']);
    expect(getRouteGuard('/waste', 'post')?.allowedRoles).toEqual(['warehouse', 'supervisor', 'boss']);
    expect(getRouteGuard('/inbound', 'post')?.requiredPermissions).toEqual(['inventory:inbound']);
    expect(getRouteGuard('/inbound', 'post')?.allowedRoles).toEqual(['warehouse', 'boss', 'purchaser', 'purchase']);
    expect(getRouteGuard('/outbound', 'post')?.requiredPermissions).toEqual(['inventory:outbound']);
    expect(getRouteGuard('/outbound', 'post')?.allowedRoles).toEqual(['warehouse', 'supervisor']);
    expect(getRouteGuard('/stocktake', 'post')?.requiredPermissions).toEqual(['stocktaking:create']);
    expect(getRouteGuard('/stocktake/:id/items', 'post')?.requiredPermissions).toEqual(['stocktaking:create']);
    expect(getRouteGuard('/stocktake/:id/diff', 'get')?.requiredPermissions).toEqual(['stocktaking:view']);
    expect(getRouteGuard('/stock-alert/trigger', 'post')?.requiredPermissions).toEqual(['inventory:maintain']);
    expect(getRouteGuard('/stock-alert/trigger', 'post')?.allowedRoles).toEqual(['supervisor', 'boss']);
  });
});
