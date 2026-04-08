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

function getRouteRoles(path: string, method: string): string[] | undefined {
  const layer = getRouteLayer(path, method);
  const roleLayer = layer?.route?.stack?.find((stackLayer: any) => (stackLayer.handle as any)?.allowedRoles);
  return (roleLayer?.handle as any)?.allowedRoles;
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

  it('declares expected role guards for reconcile/repair and key inventory routes', () => {
    expect(getRouteRoles('/daily-snapshots', 'get')).toBeUndefined();
    expect(getRouteRoles('/warehouses', 'post')).toEqual(['supervisor', 'boss', 'admin', 'warehouse']);
    expect(getRouteRoles('/warehouses/:id', 'put')).toEqual(['supervisor', 'boss', 'admin', 'warehouse']);
    expect(getRouteRoles('/warehouses/:id', 'delete')).toEqual(['supervisor', 'boss', 'admin', 'warehouse']);
    expect(getRouteRoles('/locations', 'post')).toEqual(['supervisor', 'boss', 'admin', 'warehouse']);
    expect(getRouteRoles('/locations/:id', 'put')).toEqual(['supervisor', 'boss', 'admin', 'warehouse']);
    expect(getRouteRoles('/locations/:id', 'delete')).toEqual(['supervisor', 'boss', 'admin', 'warehouse']);
    expect(getRouteRoles('/warehouses/import-csv', 'post')).toEqual(['supervisor', 'boss']);
    expect(getRouteRoles('/locations/import-csv', 'post')).toEqual(['supervisor', 'boss']);
    expect(getRouteRoles('/snapshots/rebuild', 'post')).toEqual(['supervisor', 'boss']);
    expect(getRouteRoles('/reconcile', 'post')).toEqual(['supervisor', 'boss']);
    expect(getRouteRoles('/repair', 'post')).toEqual(['supervisor', 'boss']);
    expect(getRouteRoles('/waste', 'post')).toEqual(['warehouse', 'supervisor', 'boss']);
    expect(getRouteRoles('/inbound', 'post')).toEqual(['warehouse', 'boss', 'purchaser']);
    expect(getRouteRoles('/outbound', 'post')).toEqual(['warehouse', 'supervisor']);
    expect(getRouteRoles('/stock-alert/trigger', 'post')).toEqual(['supervisor', 'boss']);
  });
});
