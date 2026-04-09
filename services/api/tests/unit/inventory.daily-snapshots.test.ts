const mockQuery = jest.fn();

jest.mock('../../src/config/database', () => ({
  AppDataSource: {
    query: (...args: unknown[]) => mockQuery(...args),
    transaction: jest.fn(),
  },
}));

jest.mock('../../src/config/redis', () => ({
  getRedisClient: () => ({
    get: jest.fn(),
    setex: jest.fn(),
    del: jest.fn(),
  }),
  RedisKeys: {
    inventorySnapshot: (tenantId: number, skuId: number) => `inventory:${tenantId}:${skuId}`,
    inventoryLock: (tenantId: number, skuId: number) => `inventory-lock:${tenantId}:${skuId}`,
    alertSent: (tenantId: number, skuId: number, date: string) => `alert:${tenantId}:${skuId}:${date}`,
  },
  RedisTTL: {
    INVENTORY: 60,
    ALERT_SENT: 60,
  },
  acquireLock: jest.fn(),
  releaseLock: jest.fn(),
}));

import { InventoryService } from '../../src/modules/inventory/inventory.service';

describe('InventoryService listDailySnapshots', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('queries daily snapshots by snapshotDate with pagination', async () => {
    mockQuery
      .mockResolvedValueOnce([{
        snapshotDate: '2026-03-30',
        warehouseId: 5,
        warehouseCode: 'WH-A',
        warehouseName: 'A 仓',
        skuId: 301,
        skuCode: 'SKU-301',
        skuName: '半成品 A',
        stockUnit: 'kg',
        qtyOnHand: '12.0000',
        qtyReserved: '2.0000',
        qtyAvailable: '10.0000',
      }])
      .mockResolvedValueOnce([{ total: '1' }]);

    const svc = new InventoryService({ tenantId: 7, userId: 11, roles: ['boss'] });
    const result = await svc.listDailySnapshots({
      snapshotDate: '2026-03-30',
      page: 1,
      pageSize: 20,
    });

    expect(result).toEqual({
      list: [{
        snapshotDate: '2026-03-30',
        warehouseId: 5,
        warehouseCode: 'WH-A',
        warehouseName: 'A 仓',
        skuId: 301,
        skuCode: 'SKU-301',
        skuName: '半成品 A',
        stockUnit: 'kg',
        qtyOnHand: '12.0000',
        qtyReserved: '2.0000',
        qtyAvailable: '10.0000',
      }],
      total: 1,
      snapshotDate: '2026-03-30',
    });

    const listSql = String(mockQuery.mock.calls[0][0]);
    const countSql = String(mockQuery.mock.calls[1][0]);
    expect(listSql).toContain('FROM inventory_daily_snapshots ids');
    expect(listSql).toContain('ids.snapshot_date = ?');
    expect(listSql).toContain('LEFT JOIN warehouses w');
    expect(listSql).toContain('ORDER BY ids.warehouse_id ASC, ids.sku_id ASC');
    expect(countSql).toContain('COUNT(*) AS total');
    expect(mockQuery.mock.calls[0][1]).toEqual([7, '2026-03-30', 20, 0]);
    expect(mockQuery.mock.calls[1][1]).toEqual([7, '2026-03-30']);
  });

  it('supports skuId and keyword filters', async () => {
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ total: '0' }]);

    const svc = new InventoryService({ tenantId: 7, userId: 11, roles: ['boss'] });
    const result = await svc.listDailySnapshots({
      snapshotDate: '2026-03-30',
      skuId: 301,
      keyword: '半成品',
      page: 2,
      pageSize: 10,
    });

    expect(result).toEqual({
      list: [],
      total: 0,
      snapshotDate: '2026-03-30',
    });

    const listSql = String(mockQuery.mock.calls[0][0]);
    const listParams = mockQuery.mock.calls[0][1] as unknown[];
    expect(listSql).toContain('ids.sku_id = ?');
    expect(listSql).toContain('(s.name LIKE ? OR s.sku_code LIKE ?)');
    expect(listParams).toEqual([7, '2026-03-30', 301, '%半成品%', '%半成品%', 10, 10]);
  });

  it('applies warehouse_assigned scope to daily snapshots', async () => {
    mockQuery
      .mockResolvedValueOnce([{ id: 9 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ total: '0' }]);

    const svc = new InventoryService({
      tenantId: 7,
      userId: 11,
      roles: ['warehouse'],
      permissionSnapshot: {
        version: 'test',
        scopeLevel: 'tenant',
        originTenantId: 7,
        contextTenantId: 7,
        menuCodes: [],
        actionCodes: [],
        featureFlags: [],
        dataScopes: [{ scopeType: 'warehouse_assigned', scopeValues: ['WH-A'] }],
      },
    });

    const result = await svc.listDailySnapshots({
      snapshotDate: '2026-03-30',
      page: 1,
      pageSize: 20,
    });

    expect(result).toEqual({
      list: [],
      total: 0,
      snapshotDate: '2026-03-30',
    });

    const listSql = String(mockQuery.mock.calls[1]?.[0] ?? '');
    const listParams = mockQuery.mock.calls[1]?.[1] as unknown[];
    expect(listSql).toContain('ids.warehouse_id IN (?)');
    expect(listParams).toEqual([7, '2026-03-30', 9, 20, 0]);
  });
});
