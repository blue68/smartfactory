const mockQuery = jest.fn();
const mockTransaction = jest.fn();
const mockRedisDel = jest.fn();

jest.mock('../../src/config/database', () => ({
  AppDataSource: {
    query: (...args: unknown[]) => mockQuery(...args),
    transaction: (...args: unknown[]) => mockTransaction(...args),
  },
}));

jest.mock('../../src/config/redis', () => ({
  getRedisClient: () => ({
    del: (...args: unknown[]) => mockRedisDel(...args),
  }),
  RedisKeys: {
    inventorySnapshot: (tenantId: number, skuId: number) => `inventory:${tenantId}:${skuId}`,
  },
  RedisTTL: {},
  acquireLock: jest.fn(),
  releaseLock: jest.fn(),
}));

import { InventoryService } from '../../src/modules/inventory/inventory.service';

describe('InventoryService rebuildDailySnapshots', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRedisDel.mockResolvedValue(1);
    mockTransaction.mockImplementation(
      async (cb: (manager: { query: typeof mockQuery }) => Promise<unknown>) => {
        const manager = { query: mockQuery } as { query: typeof mockQuery; __inventorySnapshotSkuIds?: Set<number> };
        const result = await cb(manager);
        expect(mockRedisDel).not.toHaveBeenCalled();
        return result;
      },
    );
  });

  it('rebuilds snapshots for all inventory rows of the tenant', async () => {
    mockQuery
      .mockResolvedValueOnce([{ cnt: '3' }])
      .mockResolvedValueOnce([{ sku_id: 301 }, { sku_id: 302 }, { sku_id: 303 }])
      .mockResolvedValueOnce({ affectedRows: 3 })
      .mockResolvedValueOnce({ affectedRows: 3 });

    const svc = new InventoryService({ tenantId: 7, userId: 11, roles: ['boss'] });
    const result = await svc.rebuildDailySnapshots({ snapshotDate: '2026-03-30' });

    expect(result).toEqual({
      snapshotDate: '2026-03-30',
      rebuiltCount: 3,
      skuId: null,
      skuIds: null,
      dryRun: false,
    });

    expect(mockTransaction).toHaveBeenCalled();
    expect(String(mockQuery.mock.calls[0][0])).toContain('FROM inventory');
    expect(String(mockQuery.mock.calls[0][0])).toContain('tenant_id = ?');
    expect(mockQuery.mock.calls[0][1]).toEqual([7]);

    expect(String(mockQuery.mock.calls[1][0])).toContain('SELECT DISTINCT sku_id');
    expect(String(mockQuery.mock.calls[1][0])).toContain('ORDER BY sku_id ASC');
    expect(mockQuery.mock.calls[1][1]).toEqual([7]);

    expect(String(mockQuery.mock.calls[2][0])).toContain('DELETE FROM inventory_daily_snapshots');
    expect(mockQuery.mock.calls[2][1]).toEqual(['2026-03-30', 7]);
    expect(String(mockQuery.mock.calls[3][0])).toContain('INSERT INTO inventory_daily_snapshots');
    expect(String(mockQuery.mock.calls[3][0])).toContain('COALESCE(warehouse_id, 0)');
    expect(mockQuery.mock.calls[3][1]).toEqual(['2026-03-30', 7]);
    expect(mockRedisDel).toHaveBeenCalledTimes(3);
    expect(mockRedisDel).toHaveBeenNthCalledWith(1, 'inventory:7:301');
    expect(mockRedisDel).toHaveBeenNthCalledWith(2, 'inventory:7:302');
    expect(mockRedisDel).toHaveBeenNthCalledWith(3, 'inventory:7:303');
  });

  it('rebuilds snapshots only for the specified sku when skuId is provided', async () => {
    mockQuery
      .mockResolvedValueOnce([{ cnt: '1' }])
      .mockResolvedValueOnce([{ sku_id: 301 }])
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce({ affectedRows: 1 });

    const svc = new InventoryService({ tenantId: 7, userId: 11, roles: ['boss'] });
    const result = await svc.rebuildDailySnapshots({ snapshotDate: '2026-03-30', skuId: 301 });

    expect(result).toEqual({
      snapshotDate: '2026-03-30',
      rebuiltCount: 1,
      skuId: 301,
      skuIds: [301],
      dryRun: false,
    });

    expect(String(mockQuery.mock.calls[0][0])).toContain('tenant_id = ? AND sku_id = ?');
    expect(mockQuery.mock.calls[0][1]).toEqual([7, 301]);
    expect(mockQuery.mock.calls[2][1]).toEqual(['2026-03-30', 7, 301]);
    expect(mockQuery.mock.calls[3][1]).toEqual(['2026-03-30', 7, 301]);
    expect(mockRedisDel).toHaveBeenCalledWith('inventory:7:301');
  });

  it('rebuilds snapshots for a batch of skuIds', async () => {
    mockQuery
      .mockResolvedValueOnce([{ cnt: '2' }])
      .mockResolvedValueOnce([{ sku_id: 301 }, { sku_id: 302 }])
      .mockResolvedValueOnce({ affectedRows: 2 })
      .mockResolvedValueOnce({ affectedRows: 2 });

    const svc = new InventoryService({ tenantId: 7, userId: 11, roles: ['boss'] });
    const result = await svc.rebuildDailySnapshots({
      snapshotDate: '2026-03-30',
      skuIds: [302, 301, 302],
    });

    expect(result).toEqual({
      snapshotDate: '2026-03-30',
      rebuiltCount: 2,
      skuId: null,
      skuIds: [301, 302],
      dryRun: false,
    });

    expect(String(mockQuery.mock.calls[0][0])).toContain('sku_id IN (?, ?)');
    expect(mockQuery.mock.calls[0][1]).toEqual([7, 301, 302]);
    expect(mockQuery.mock.calls[2][1]).toEqual(['2026-03-30', 7, 301, 302]);
    expect(mockQuery.mock.calls[3][1]).toEqual(['2026-03-30', 7, 301, 302]);
    expect(mockRedisDel).toHaveBeenCalledTimes(2);
  });

  it('supports dryRun without writing snapshots', async () => {
    mockQuery
      .mockResolvedValueOnce([{ cnt: '2' }])
      .mockResolvedValueOnce([{ sku_id: 301 }, { sku_id: 302 }]);

    const svc = new InventoryService({ tenantId: 7, userId: 11, roles: ['boss'] });
    const result = await svc.rebuildDailySnapshots({
      snapshotDate: '2026-03-30',
      skuIds: [301, 302],
      dryRun: true,
    });

    expect(result).toEqual({
      snapshotDate: '2026-03-30',
      rebuiltCount: 2,
      skuId: null,
      skuIds: [301, 302],
      dryRun: true,
    });

    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(String(mockQuery.mock.calls[0][0])).toContain('sku_id IN (?, ?)');
    expect(mockQuery.mock.calls[0][1]).toEqual([7, 301, 302]);
    expect(mockRedisDel).not.toHaveBeenCalled();
  });

  it('does not invalidate inventory cache when rebuild commit fails after snapshot sync', async () => {
    mockTransaction.mockImplementation(
      async (cb: (manager: { query: typeof mockQuery }) => Promise<unknown>) => {
        const manager = { query: mockQuery } as { query: typeof mockQuery; __inventorySnapshotSkuIds?: Set<number> };
        await cb(manager);
        throw new Error('rebuild commit failed');
      },
    );
    mockQuery
      .mockResolvedValueOnce([{ cnt: '2' }])
      .mockResolvedValueOnce([{ sku_id: 301 }, { sku_id: 302 }])
      .mockResolvedValueOnce({ affectedRows: 2 })
      .mockResolvedValueOnce({ affectedRows: 2 });

    const svc = new InventoryService({ tenantId: 7, userId: 11, roles: ['boss'] });
    await expect(
      svc.rebuildDailySnapshots({
        snapshotDate: '2026-03-30',
        skuIds: [301, 302],
      }),
    ).rejects.toThrow('rebuild commit failed');

    const snapshotCall = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO inventory_daily_snapshots'),
    );
    expect(snapshotCall).toBeDefined();
    expect(mockRedisDel).not.toHaveBeenCalled();
  });
});
