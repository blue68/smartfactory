import { AppDataSource } from '../../src/config/database';
import { StocktakingService } from '../../src/modules/stocktaking/stocktaking.service';

jest.mock('../../src/config/database', () => ({
  AppDataSource: {
    query: jest.fn(),
    transaction: jest.fn(),
  },
}));

const mockRedisDel = jest.fn();

jest.mock('../../src/config/redis', () => ({
  getRedisClient: () => ({
    del: (...args: unknown[]) => mockRedisDel(...args),
  }),
  RedisKeys: {
    inventorySnapshot: (tenantId: number, skuId: number) => `inventory:${tenantId}:${skuId}`,
  },
}));

describe('StocktakingService confirmTask snapshot sync', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    mockRedisDel.mockResolvedValue(1);
  });

  it('syncs inventory_daily_snapshots for each diff sku after stocktaking confirmation', async () => {
    (AppDataSource.query as jest.Mock)
      .mockResolvedValueOnce([{
        id: 88,
        task_no: 'PD260330-0001',
        scope: 'all',
        scope_value: null,
        status: 'in_progress',
        total_items: 2,
        diff_items: 0,
        created_by: 11,
        confirmed_by: null,
        confirmed_at: null,
        created_at: '2026-03-30T10:00:00.000Z',
        updated_at: '2026-03-30T10:00:00.000Z',
      }])
      .mockResolvedValueOnce([
        { sku_id: 301, diff_qty: '2.5000' },
        { sku_id: 302, diff_qty: '-1.0000' },
      ]);

    const manager = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes('SELECT qty_on_hand') && sql.includes('FOR UPDATE')) {
          if (sql.includes('sku_id = ?')) {
            return [{ qty_on_hand: '10.0000' }];
          }
        }
        if (sql.includes('UPDATE inventory')) return { affectedRows: 1 };
        if (sql.includes('INSERT INTO inventory_transactions')) return { insertId: 1 };
        if (sql.includes('INSERT INTO inventory_daily_snapshots')) return { affectedRows: 1 };
        if (sql.includes('UPDATE stocktaking_tasks')) return { affectedRows: 1 };
        return [];
      }),
    };

    (AppDataSource.transaction as jest.Mock).mockImplementation(async (callback: any) => callback(manager));

    const service = new StocktakingService({ tenantId: 7, userId: 11 });
    const result = await service.confirmTask(88);

    expect(result.confirmedAt).toEqual(expect.any(String));

    const snapshotCalls = (manager.query.mock.calls as unknown[][]).filter((call) =>
      String(call[0]).includes('INSERT INTO inventory_daily_snapshots'),
    );
    expect(snapshotCalls).toHaveLength(2);
    expect(snapshotCalls[0]?.[1]).toEqual([7, 301]);
    expect(snapshotCalls[1]?.[1]).toEqual([7, 302]);
    expect(mockRedisDel).toHaveBeenCalledWith('inventory:7:301');
    expect(mockRedisDel).toHaveBeenCalledWith('inventory:7:302');
  });

  it('rejects confirmation when stale diff would make inventory negative', async () => {
    (AppDataSource.query as jest.Mock)
      .mockResolvedValueOnce([{
        id: 88,
        task_no: 'PD260330-0001',
        scope: 'all',
        scope_value: null,
        status: 'in_progress',
        total_items: 1,
        diff_items: 0,
        created_by: 11,
        confirmed_by: null,
        confirmed_at: null,
        created_at: '2026-03-30T10:00:00.000Z',
        updated_at: '2026-03-30T10:00:00.000Z',
      }])
      .mockResolvedValueOnce([{ sku_id: 301, diff_qty: '-12.0000' }]);

    const manager = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes('SELECT qty_on_hand') && sql.includes('FOR UPDATE')) {
          return [{ qty_on_hand: '5.0000' }];
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
    };

    (AppDataSource.transaction as jest.Mock).mockImplementation(async (callback: any) => callback(manager));

    const service = new StocktakingService({ tenantId: 7, userId: 11 });

    await expect(service.confirmTask(88)).rejects.toThrow('盘点调整后在库将变为负数');

    const updateInventoryCall = (manager.query.mock.calls as unknown[][]).find((call) =>
      String(call[0]).includes('UPDATE inventory'),
    );
    expect(updateInventoryCall).toBeUndefined();
    expect(mockRedisDel).not.toHaveBeenCalled();
  });

  it('does not invalidate inventory cache when confirm transaction fails', async () => {
    (AppDataSource.query as jest.Mock)
      .mockResolvedValueOnce([{
        id: 88,
        task_no: 'PD260330-0001',
        scope: 'all',
        scope_value: null,
        status: 'in_progress',
        total_items: 1,
        diff_items: 0,
        created_by: 11,
        confirmed_by: null,
        confirmed_at: null,
        created_at: '2026-03-30T10:00:00.000Z',
        updated_at: '2026-03-30T10:00:00.000Z',
      }])
      .mockResolvedValueOnce([{ sku_id: 301, diff_qty: '2.0000' }]);

    const manager = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes('SELECT qty_on_hand') && sql.includes('FOR UPDATE')) {
          return [{ qty_on_hand: '5.0000' }];
        }
        if (sql.includes('UPDATE inventory')) return { affectedRows: 1 };
        if (sql.includes('INSERT INTO inventory_transactions')) return { insertId: 1 };
        if (sql.includes('INSERT INTO inventory_daily_snapshots')) return { affectedRows: 1 };
        if (sql.includes('UPDATE stocktaking_tasks')) {
          throw new Error('confirm stocktaking failed');
        }
        return [];
      }),
    };

    (AppDataSource.transaction as jest.Mock).mockImplementation(async (callback: any) => callback(manager));

    const service = new StocktakingService({ tenantId: 7, userId: 11 });

    await expect(service.confirmTask(88)).rejects.toThrow('confirm stocktaking failed');
    expect(mockRedisDel).not.toHaveBeenCalled();
  });

  it('does not invalidate inventory cache when confirm commit fails after snapshot sync', async () => {
    (AppDataSource.query as jest.Mock)
      .mockResolvedValueOnce([{
        id: 88,
        task_no: 'PD260330-0001',
        scope: 'all',
        scope_value: null,
        status: 'in_progress',
        total_items: 1,
        diff_items: 0,
        created_by: 11,
        confirmed_by: null,
        confirmed_at: null,
        created_at: '2026-03-30T10:00:00.000Z',
        updated_at: '2026-03-30T10:00:00.000Z',
      }])
      .mockResolvedValueOnce([{ sku_id: 301, diff_qty: '2.0000' }]);

    const manager = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes('SELECT qty_on_hand') && sql.includes('FOR UPDATE')) {
          return [{ qty_on_hand: '5.0000' }];
        }
        if (sql.includes('UPDATE inventory')) return { affectedRows: 1 };
        if (sql.includes('INSERT INTO inventory_transactions')) return { insertId: 1 };
        if (sql.includes('INSERT INTO inventory_daily_snapshots')) return { affectedRows: 1 };
        if (sql.includes('UPDATE stocktaking_tasks')) return { affectedRows: 1 };
        return [];
      }),
    };

    (AppDataSource.transaction as jest.Mock).mockImplementation(async (callback: any) => {
      await callback(manager);
      throw new Error('confirm stocktaking commit failed');
    });

    const service = new StocktakingService({ tenantId: 7, userId: 11 });

    await expect(service.confirmTask(88)).rejects.toThrow('confirm stocktaking commit failed');

    const snapshotCall = (manager.query.mock.calls as unknown[][]).find((call) =>
      String(call[0]).includes('INSERT INTO inventory_daily_snapshots'),
    );
    expect(snapshotCall).toBeDefined();
    expect(mockRedisDel).not.toHaveBeenCalled();
  });
});
