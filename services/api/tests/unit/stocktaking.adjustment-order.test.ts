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

describe('StocktakingService createAdjustmentOrder', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    mockRedisDel.mockResolvedValue(1);
  });

  it('returns adjustment preview when execute=false', async () => {
    (AppDataSource.query as jest.Mock)
      .mockResolvedValueOnce([{
        id: 88,
        task_no: 'PD260403-0001',
        scope: 'all',
        scope_value: null,
        status: 'in_progress',
        warehouse_id: 1,
        location_id: 2,
        total_items: 2,
        diff_items: 0,
        created_by: 11,
        confirmed_by: null,
        confirmed_at: null,
        created_at: '2026-04-03T10:00:00.000Z',
        updated_at: '2026-04-03T10:00:00.000Z',
      }])
      .mockResolvedValueOnce([
        {
          sku_id: 301,
          sku_code: 'SKU-301',
          sku_name: '原料301',
          stock_unit: 'kg',
          warehouse_id: 1,
          warehouse_code: 'WH-MAIN',
          warehouse_name: '主仓',
          location_id: 2,
          location_code: 'A-01',
          location_name: 'A01',
          diff_qty: '2.5000',
        },
        {
          sku_id: 302,
          sku_code: 'SKU-302',
          sku_name: '原料302',
          stock_unit: 'kg',
          warehouse_id: 1,
          warehouse_code: 'WH-MAIN',
          warehouse_name: '主仓',
          location_id: 2,
          location_code: 'A-01',
          location_name: 'A01',
          diff_qty: '-1.0000',
        },
      ]);

    const service = new StocktakingService({ tenantId: 7, userId: 11 });
    const result = await service.createAdjustmentOrder(88, { execute: false });

    expect(result.execute).toBe(false);
    expect(result.diffCount).toBe(2);
    expect(result.totalAdjustQty).toBe('3.5000');
    expect(result.items[0]?.direction).toBe('IN');
    expect(result.items[1]?.direction).toBe('OUT');
    expect(AppDataSource.transaction).not.toHaveBeenCalled();
    expect(mockRedisDel).not.toHaveBeenCalled();
  });

  it('executes adjustment order and writes stocktake-adjust transactions', async () => {
    (AppDataSource.query as jest.Mock)
      .mockResolvedValueOnce([{
        id: 88,
        task_no: 'PD260403-0001',
        scope: 'all',
        scope_value: null,
        status: 'in_progress',
        warehouse_id: 1,
        location_id: 2,
        total_items: 1,
        diff_items: 0,
        created_by: 11,
        confirmed_by: null,
        confirmed_at: null,
        created_at: '2026-04-03T10:00:00.000Z',
        updated_at: '2026-04-03T10:00:00.000Z',
      }])
      .mockResolvedValueOnce([
        {
          sku_id: 301,
          sku_code: 'SKU-301',
          sku_name: '原料301',
          stock_unit: 'kg',
          warehouse_id: 1,
          warehouse_code: 'WH-MAIN',
          warehouse_name: '主仓',
          location_id: 2,
          location_code: 'A-01',
          location_name: 'A01',
          diff_qty: '2.0000',
        },
      ]);

    const manager = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes('SELECT i.id, i.qty_on_hand') && sql.includes('FOR UPDATE')) {
          return [{
            id: 991,
            qty_on_hand: '5.0000',
            warehouse_id: 1,
            location_id: 2,
            stock_unit: 'kg',
          }];
        }
        if (sql.includes('UPDATE inventory')) return { affectedRows: 1 };
        if (sql.includes('INSERT INTO inventory_transactions')) return { insertId: 1 };
        if (sql.includes('INSERT INTO inventory_daily_snapshots')) return { affectedRows: 1 };
        if (sql.includes('UPDATE stocktaking_tasks')) return { affectedRows: 1 };
        return [];
      }),
    };
    (AppDataSource.transaction as jest.Mock).mockImplementation(async (cb: any) => cb(manager));

    const service = new StocktakingService({ tenantId: 7, userId: 11 });
    const result = await service.createAdjustmentOrder(88, { execute: true });

    expect(result.execute).toBe(true);
    expect(result.confirmedAt).toEqual(expect.any(String));
    expect(result.items).toHaveLength(1);

    const txInsert = (manager.query.mock.calls as unknown[][]).find((call) =>
      String(call[0]).includes('INSERT INTO inventory_transactions'),
    );
    expect(String(txInsert?.[0])).toContain("'stocktaking_adjustment'");
    expect(String(txInsert?.[0])).toContain('warehouse_id');
    expect(String(txInsert?.[0])).toContain('location_id');
    expect(mockRedisDel).toHaveBeenCalledWith('inventory:7:301');
  });

  it('rejects execution when adjustment would make inventory negative', async () => {
    (AppDataSource.query as jest.Mock)
      .mockResolvedValueOnce([{
        id: 88,
        task_no: 'PD260403-0001',
        scope: 'all',
        scope_value: null,
        status: 'in_progress',
        warehouse_id: 1,
        location_id: 2,
        total_items: 1,
        diff_items: 0,
        created_by: 11,
        confirmed_by: null,
        confirmed_at: null,
        created_at: '2026-04-03T10:00:00.000Z',
        updated_at: '2026-04-03T10:00:00.000Z',
      }])
      .mockResolvedValueOnce([
        {
          sku_id: 301,
          sku_code: 'SKU-301',
          sku_name: '原料301',
          stock_unit: 'kg',
          warehouse_id: 1,
          warehouse_code: 'WH-MAIN',
          warehouse_name: '主仓',
          location_id: 2,
          location_code: 'A-01',
          location_name: 'A01',
          diff_qty: '-12.0000',
        },
      ]);

    const manager = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes('SELECT i.id, i.qty_on_hand') && sql.includes('FOR UPDATE')) {
          return [{
            id: 992,
            qty_on_hand: '5.0000',
            warehouse_id: 1,
            location_id: 2,
            stock_unit: 'kg',
          }];
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
    };
    (AppDataSource.transaction as jest.Mock).mockImplementation(async (cb: any) => cb(manager));

    const service = new StocktakingService({ tenantId: 7, userId: 11 });

    await expect(service.createAdjustmentOrder(88, { execute: true })).rejects.toThrow('调整后在库将变为负数');

    const inventoryUpdate = (manager.query.mock.calls as unknown[][]).find((call) =>
      String(call[0]).includes('UPDATE inventory'),
    );
    expect(inventoryUpdate).toBeUndefined();
    expect(mockRedisDel).not.toHaveBeenCalled();
  });
});
