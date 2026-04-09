const mockQuery = jest.fn();
const mockTransaction = jest.fn();
const mockAcquireLock = jest.fn();
const mockReleaseLock = jest.fn();
const mockDel = jest.fn();
const mockGet = jest.fn();
const mockSetex = jest.fn();

jest.mock('../../src/config/database', () => ({
  AppDataSource: {
    query: (...args: unknown[]) => mockQuery(...args),
    transaction: (...args: unknown[]) => mockTransaction(...args),
  },
}));

jest.mock('../../src/config/redis', () => ({
  acquireLock: (...args: unknown[]) => mockAcquireLock(...args),
  releaseLock: (...args: unknown[]) => mockReleaseLock(...args),
  getRedisClient: () => ({
    del: (...args: unknown[]) => mockDel(...args),
    get: (...args: unknown[]) => mockGet(...args),
    setex: (...args: unknown[]) => mockSetex(...args),
  }),
  RedisKeys: {
    inventoryLock: (tenantId: number, skuId: number) => `lock:${tenantId}:${skuId}`,
    inventorySnapshot: (tenantId: number, skuId: number) => `snapshot:${tenantId}:${skuId}`,
    alertSent: (tenantId: number, skuId: number, date: string) => `alert:${tenantId}:${skuId}:${date}`,
  },
  RedisTTL: {
    INVENTORY: 300,
    ALERT_SENT: 86400,
  },
}));

import { InventoryService } from '../../src/modules/inventory/inventory.service';

type TxManager = { query: typeof mockQuery; __inventorySnapshotSkuIds?: Set<number> };

function resolveWarehouseSql(sql: string): unknown | undefined {
  if (sql.includes('INSERT INTO warehouses')) return { affectedRows: 1 };
  if (sql.includes('SELECT id, code') && sql.includes('FROM warehouses')) return [{ id: 901, code: 'DEFAULT' }];
  if (sql.includes('INSERT INTO locations')) return { affectedRows: 1 };
  if (sql.includes('SELECT id, code') && sql.includes('FROM locations')) return [{ id: 902, code: 'DEFAULT-UNKNOWN' }];
  return undefined;
}

describe('InventoryService auto snapshot sync', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAcquireLock.mockResolvedValue('lock-token');
    mockReleaseLock.mockResolvedValue(1);
    mockDel.mockResolvedValue(1);
    mockGet.mockResolvedValue(null);
    mockSetex.mockResolvedValue('OK');
    mockTransaction.mockImplementation(
      async (cb: (manager: { query: typeof mockQuery }) => Promise<unknown>) => cb({ query: mockQuery }),
    );
  });

  it('syncs inventory_daily_snapshots after inbound', async () => {
    const manager: TxManager = { query: mockQuery };
    mockTransaction.mockImplementation(async (cb: (manager: TxManager) => Promise<unknown>) => {
      const result = await cb(manager);
      expect(mockDel).not.toHaveBeenCalled();
      return result;
    });
    mockQuery.mockImplementation(async (sql: string) => {
      const warehouseSqlResult = resolveWarehouseSql(sql);
      if (warehouseSqlResult !== undefined) return warehouseSqlResult;
      if (sql.includes('SELECT id') && sql.includes('FROM inventory')) return [];
      if (sql.includes('INSERT INTO inventory_transactions')) return { insertId: 1 };
      if (sql.includes('INSERT INTO inventory')) return { affectedRows: 1 };
      if (sql.includes('INSERT INTO inventory_daily_snapshots')) return { affectedRows: 1 };
      if (sql.includes('DELETE ids') && sql.includes('FROM inventory_daily_snapshots ids')) return { affectedRows: 0 };
      if (sql.includes('qty_on_hand AS qty') && sql.includes('FROM inventory')) return [{ qty: '15.0000' }];
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const svc = new InventoryService({ tenantId: 7, userId: 11, roles: ['boss'] });
    (svc as any).getSkuInfo = jest.fn().mockResolvedValue({
      stockUnit: 'pcs',
      purchaseUnit: 'pcs',
      productionUnit: 'pcs',
      hasDyeLot: false,
      safetyStock: '0',
      skuName: 'SKU-A',
    });
    (svc as any).getUnitConversions = jest.fn().mockResolvedValue([]);
    (svc as any).checkSafetyStockAlert = jest.fn().mockResolvedValue(undefined);

    await svc.inbound({
      skuId: 301,
      qtyInput: '5',
      inputUnit: 'pcs',
      transactionType: 'ADJUSTMENT_IN',
    });

    const snapshotCall = mockQuery.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO inventory_daily_snapshots'),
    );
    expect(snapshotCall).toBeDefined();
    expect(snapshotCall?.[1]).toEqual([7, 301]);
    expect(manager.__inventorySnapshotSkuIds).toBeUndefined();
    expect(mockDel).toHaveBeenCalledWith('snapshot:7:301');
  });

  it('syncs inventory_daily_snapshots after outbound', async () => {
    const manager: TxManager = { query: mockQuery };
    mockTransaction.mockImplementation(async (cb: (manager: TxManager) => Promise<unknown>) => {
      const result = await cb(manager);
      expect(mockDel).not.toHaveBeenCalled();
      return result;
    });
    mockQuery.mockImplementation(async (sql: string) => {
      const warehouseSqlResult = resolveWarehouseSql(sql);
      if (warehouseSqlResult !== undefined) return warehouseSqlResult;
      if (sql.includes('qty_on_hand, qty_reserved') && sql.includes('FROM inventory') && sql.includes('FOR UPDATE')) {
        return [{ qty_on_hand: '15.0000', qty_reserved: '0.0000' }];
      }
      if (sql.includes('INSERT INTO inventory_transactions')) return { insertId: 2 };
      if (sql.includes('UPDATE inventory')) return { affectedRows: 1 };
      if (sql.includes('INSERT INTO inventory_daily_snapshots')) return { affectedRows: 1 };
      if (sql.includes('DELETE ids') && sql.includes('FROM inventory_daily_snapshots ids')) return { affectedRows: 0 };
      if (sql.includes('qty_on_hand AS qty') && sql.includes('FROM inventory')) return [{ qty: '10.0000' }];
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const svc = new InventoryService({ tenantId: 7, userId: 11, roles: ['supervisor'] });
    (svc as any).getSkuInfo = jest.fn().mockResolvedValue({
      stockUnit: 'pcs',
      purchaseUnit: 'pcs',
      productionUnit: 'pcs',
      hasDyeLot: false,
      safetyStock: '0',
      skuName: 'SKU-A',
    });
    (svc as any).getUnitConversions = jest.fn().mockResolvedValue([]);

    await svc.outbound({
      skuId: 301,
      qtyInput: '5',
      inputUnit: 'pcs',
      transactionType: 'ADJUSTMENT_OUT',
    });

    const snapshotCall = mockQuery.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO inventory_daily_snapshots'),
    );
    expect(snapshotCall).toBeDefined();
    expect(snapshotCall?.[1]).toEqual([7, 301]);
    expect(manager.__inventorySnapshotSkuIds).toBeUndefined();
    expect(mockDel).toHaveBeenCalledWith('snapshot:7:301');
  });

  it('syncs inventory_daily_snapshots after waste recording', async () => {
    const manager: TxManager = { query: mockQuery };
    mockTransaction.mockImplementation(async (cb: (manager: TxManager) => Promise<unknown>) => {
      const result = await cb(manager);
      expect(mockDel).not.toHaveBeenCalled();
      return result;
    });
    mockQuery.mockImplementation(async (sql: string) => {
      const warehouseSqlResult = resolveWarehouseSql(sql);
      if (warehouseSqlResult !== undefined) return warehouseSqlResult;
      if (sql.includes('qty_on_hand, qty_reserved') && sql.includes('FROM inventory') && sql.includes('FOR UPDATE')) {
        return [{ qty_on_hand: '15.0000', qty_reserved: '0.0000' }];
      }
      if (sql.includes('INSERT INTO inventory_transactions')) return { insertId: 3 };
      if (sql.includes('UPDATE inventory')) return { affectedRows: 1 };
      if (sql.includes('INSERT INTO inventory_daily_snapshots')) return { affectedRows: 1 };
      if (sql.includes('DELETE ids') && sql.includes('FROM inventory_daily_snapshots ids')) return { affectedRows: 0 };
      if (sql.includes('qty_on_hand AS qty') && sql.includes('FROM inventory')) return [{ qty: '14.0000' }];
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const svc = new InventoryService({ tenantId: 7, userId: 11, roles: ['warehouse'] });
    (svc as any).getSkuInfo = jest.fn().mockResolvedValue({
      stockUnit: 'pcs',
      purchaseUnit: 'pcs',
      productionUnit: 'pcs',
      hasDyeLot: false,
      safetyStock: '0',
      skuName: 'SKU-A',
    });
    (svc as any).checkSafetyStockAlert = jest.fn().mockResolvedValue(undefined);

    await svc.recordWaste({
      skuId: 301,
      qty: '1',
      reason: 'broken',
    });

    const snapshotCall = mockQuery.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO inventory_daily_snapshots'),
    );
    expect(snapshotCall).toBeDefined();
    expect(snapshotCall?.[1]).toEqual([7, 301]);
    expect(manager.__inventorySnapshotSkuIds).toBeUndefined();
    expect(mockDel).toHaveBeenCalledWith('snapshot:7:301');
  });

  it('does not invalidate inventory snapshot cache when outbound transaction rolls back', async () => {
    const manager: TxManager = { query: mockQuery };
    mockTransaction.mockImplementation(async (cb: (manager: TxManager) => Promise<unknown>) => cb(manager));
    mockQuery.mockImplementation(async (sql: string) => {
      const warehouseSqlResult = resolveWarehouseSql(sql);
      if (warehouseSqlResult !== undefined) return warehouseSqlResult;
      if (sql.includes('qty_on_hand, qty_reserved') && sql.includes('FROM inventory') && sql.includes('FOR UPDATE')) {
        return [{ qty_on_hand: '15.0000', qty_reserved: '0.0000' }];
      }
      if (sql.includes('INSERT INTO inventory_transactions')) return { insertId: 2 };
      if (sql.includes('UPDATE inventory')) return { affectedRows: 1 };
      if (sql.includes('INSERT INTO inventory_daily_snapshots')) return { affectedRows: 1 };
      if (sql.includes('DELETE ids') && sql.includes('FROM inventory_daily_snapshots ids')) return { affectedRows: 0 };
      if (sql.includes('qty_on_hand AS qty') && sql.includes('FROM inventory')) {
        throw new Error('tx failed after snapshot sync');
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const svc = new InventoryService({ tenantId: 7, userId: 11, roles: ['supervisor'] });
    (svc as any).getSkuInfo = jest.fn().mockResolvedValue({
      stockUnit: 'pcs',
      purchaseUnit: 'pcs',
      productionUnit: 'pcs',
      hasDyeLot: false,
      safetyStock: '0',
      skuName: 'SKU-A',
    });
    (svc as any).getUnitConversions = jest.fn().mockResolvedValue([]);

    await expect(
      svc.outbound({
        skuId: 301,
        qtyInput: '5',
        inputUnit: 'pcs',
        transactionType: 'ADJUSTMENT_OUT',
      }),
    ).rejects.toThrow('tx failed after snapshot sync');

    expect(mockDel).not.toHaveBeenCalled();
  });

  it('does not invalidate inventory snapshot cache when inbound transaction rolls back', async () => {
    const manager: TxManager = { query: mockQuery };
    mockTransaction.mockImplementation(async (cb: (manager: TxManager) => Promise<unknown>) => cb(manager));
    mockQuery.mockImplementation(async (sql: string) => {
      const warehouseSqlResult = resolveWarehouseSql(sql);
      if (warehouseSqlResult !== undefined) return warehouseSqlResult;
      if (sql.includes('SELECT id') && sql.includes('FROM inventory')) return [];
      if (sql.includes('INSERT INTO inventory_transactions')) return { insertId: 1 };
      if (sql.includes('INSERT INTO inventory')) return { affectedRows: 1 };
      if (sql.includes('INSERT INTO inventory_daily_snapshots')) return { affectedRows: 1 };
      if (sql.includes('DELETE ids') && sql.includes('FROM inventory_daily_snapshots ids')) return { affectedRows: 0 };
      if (sql.includes('qty_on_hand AS qty') && sql.includes('FROM inventory')) {
        throw new Error('inbound tx failed after snapshot sync');
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const svc = new InventoryService({ tenantId: 7, userId: 11, roles: ['boss'] });
    (svc as any).getSkuInfo = jest.fn().mockResolvedValue({
      stockUnit: 'pcs',
      purchaseUnit: 'pcs',
      productionUnit: 'pcs',
      hasDyeLot: false,
      safetyStock: '0',
      skuName: 'SKU-A',
    });
    (svc as any).getUnitConversions = jest.fn().mockResolvedValue([]);
    (svc as any).checkSafetyStockAlert = jest.fn().mockResolvedValue(undefined);

    await expect(
      svc.inbound({
        skuId: 301,
        qtyInput: '5',
        inputUnit: 'pcs',
        transactionType: 'ADJUSTMENT_IN',
      }),
    ).rejects.toThrow('inbound tx failed after snapshot sync');

    expect(mockDel).not.toHaveBeenCalled();
  });

  it('does not invalidate inventory snapshot cache when waste transaction rolls back', async () => {
    const manager: TxManager = { query: mockQuery };
    mockTransaction.mockImplementation(async (cb: (manager: TxManager) => Promise<unknown>) => cb(manager));
    mockQuery.mockImplementation(async (sql: string) => {
      const warehouseSqlResult = resolveWarehouseSql(sql);
      if (warehouseSqlResult !== undefined) return warehouseSqlResult;
      if (sql.includes('qty_on_hand, qty_reserved') && sql.includes('FROM inventory') && sql.includes('FOR UPDATE')) {
        return [{ qty_on_hand: '15.0000', qty_reserved: '0.0000' }];
      }
      if (sql.includes('INSERT INTO inventory_transactions')) return { insertId: 3 };
      if (sql.includes('UPDATE inventory')) return { affectedRows: 1 };
      if (sql.includes('INSERT INTO inventory_daily_snapshots')) return { affectedRows: 1 };
      if (sql.includes('DELETE ids') && sql.includes('FROM inventory_daily_snapshots ids')) return { affectedRows: 0 };
      if (sql.includes('qty_on_hand AS qty') && sql.includes('FROM inventory')) {
        throw new Error('waste tx failed after snapshot sync');
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const svc = new InventoryService({ tenantId: 7, userId: 11, roles: ['warehouse'] });
    (svc as any).getSkuInfo = jest.fn().mockResolvedValue({
      stockUnit: 'pcs',
      purchaseUnit: 'pcs',
      productionUnit: 'pcs',
      hasDyeLot: false,
      safetyStock: '0',
      skuName: 'SKU-A',
    });
    (svc as any).checkSafetyStockAlert = jest.fn().mockResolvedValue(undefined);

    await expect(
      svc.recordWaste({
        skuId: 301,
        qty: '1',
        reason: 'broken',
      }),
    ).rejects.toThrow('waste tx failed after snapshot sync');

    expect(mockDel).not.toHaveBeenCalled();
  });

  it('does not invalidate inventory snapshot cache when outbound transaction commit fails after snapshot sync', async () => {
    const manager: TxManager = { query: mockQuery };
    mockTransaction.mockImplementation(async (cb: (manager: TxManager) => Promise<unknown>) => {
      await cb(manager);
      throw new Error('outbound commit failed');
    });
    mockQuery.mockImplementation(async (sql: string) => {
      const warehouseSqlResult = resolveWarehouseSql(sql);
      if (warehouseSqlResult !== undefined) return warehouseSqlResult;
      if (sql.includes('qty_on_hand, qty_reserved') && sql.includes('FROM inventory') && sql.includes('FOR UPDATE')) {
        return [{ qty_on_hand: '15.0000', qty_reserved: '0.0000' }];
      }
      if (sql.includes('INSERT INTO inventory_transactions')) return { insertId: 2 };
      if (sql.includes('UPDATE inventory')) return { affectedRows: 1 };
      if (sql.includes('INSERT INTO inventory_daily_snapshots')) return { affectedRows: 1 };
      if (sql.includes('DELETE ids') && sql.includes('FROM inventory_daily_snapshots ids')) return { affectedRows: 0 };
      if (sql.includes('qty_on_hand AS qty') && sql.includes('FROM inventory')) return [{ qty: '10.0000' }];
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const svc = new InventoryService({ tenantId: 7, userId: 11, roles: ['supervisor'] });
    (svc as any).getSkuInfo = jest.fn().mockResolvedValue({
      stockUnit: 'pcs',
      purchaseUnit: 'pcs',
      productionUnit: 'pcs',
      hasDyeLot: false,
      safetyStock: '0',
      skuName: 'SKU-A',
    });
    (svc as any).getUnitConversions = jest.fn().mockResolvedValue([]);

    await expect(
      svc.outbound({
        skuId: 301,
        qtyInput: '5',
        inputUnit: 'pcs',
        transactionType: 'ADJUSTMENT_OUT',
      }),
    ).rejects.toThrow('outbound commit failed');

    const snapshotCall = mockQuery.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO inventory_daily_snapshots'),
    );
    expect(snapshotCall).toBeDefined();
    expect(mockDel).not.toHaveBeenCalled();
  });

  it('does not invalidate inventory snapshot cache when inbound transaction commit fails after snapshot sync', async () => {
    const manager: TxManager = { query: mockQuery };
    mockTransaction.mockImplementation(async (cb: (manager: TxManager) => Promise<unknown>) => {
      await cb(manager);
      throw new Error('inbound commit failed');
    });
    mockQuery.mockImplementation(async (sql: string) => {
      const warehouseSqlResult = resolveWarehouseSql(sql);
      if (warehouseSqlResult !== undefined) return warehouseSqlResult;
      if (sql.includes('SELECT id') && sql.includes('FROM inventory')) return [];
      if (sql.includes('INSERT INTO inventory_transactions')) return { insertId: 1 };
      if (sql.includes('INSERT INTO inventory')) return { affectedRows: 1 };
      if (sql.includes('INSERT INTO inventory_daily_snapshots')) return { affectedRows: 1 };
      if (sql.includes('DELETE ids') && sql.includes('FROM inventory_daily_snapshots ids')) return { affectedRows: 0 };
      if (sql.includes('qty_on_hand AS qty') && sql.includes('FROM inventory')) return [{ qty: '15.0000' }];
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const svc = new InventoryService({ tenantId: 7, userId: 11, roles: ['boss'] });
    (svc as any).getSkuInfo = jest.fn().mockResolvedValue({
      stockUnit: 'pcs',
      purchaseUnit: 'pcs',
      productionUnit: 'pcs',
      hasDyeLot: false,
      safetyStock: '0',
      skuName: 'SKU-A',
    });
    (svc as any).getUnitConversions = jest.fn().mockResolvedValue([]);
    (svc as any).checkSafetyStockAlert = jest.fn().mockResolvedValue(undefined);

    await expect(
      svc.inbound({
        skuId: 301,
        qtyInput: '5',
        inputUnit: 'pcs',
        transactionType: 'ADJUSTMENT_IN',
      }),
    ).rejects.toThrow('inbound commit failed');

    const snapshotCall = mockQuery.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO inventory_daily_snapshots'),
    );
    expect(snapshotCall).toBeDefined();
    expect(mockDel).not.toHaveBeenCalled();
  });

  it('does not invalidate inventory snapshot cache when waste transaction commit fails after snapshot sync', async () => {
    const manager: TxManager = { query: mockQuery };
    mockTransaction.mockImplementation(async (cb: (manager: TxManager) => Promise<unknown>) => {
      await cb(manager);
      throw new Error('waste commit failed');
    });
    mockQuery.mockImplementation(async (sql: string) => {
      const warehouseSqlResult = resolveWarehouseSql(sql);
      if (warehouseSqlResult !== undefined) return warehouseSqlResult;
      if (sql.includes('qty_on_hand, qty_reserved') && sql.includes('FROM inventory') && sql.includes('FOR UPDATE')) {
        return [{ qty_on_hand: '15.0000', qty_reserved: '0.0000' }];
      }
      if (sql.includes('INSERT INTO inventory_transactions')) return { insertId: 3 };
      if (sql.includes('UPDATE inventory')) return { affectedRows: 1 };
      if (sql.includes('INSERT INTO inventory_daily_snapshots')) return { affectedRows: 1 };
      if (sql.includes('DELETE ids') && sql.includes('FROM inventory_daily_snapshots ids')) return { affectedRows: 0 };
      if (sql.includes('qty_on_hand AS qty') && sql.includes('FROM inventory')) return [{ qty: '14.0000' }];
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const svc = new InventoryService({ tenantId: 7, userId: 11, roles: ['warehouse'] });
    (svc as any).getSkuInfo = jest.fn().mockResolvedValue({
      stockUnit: 'pcs',
      purchaseUnit: 'pcs',
      productionUnit: 'pcs',
      hasDyeLot: false,
      safetyStock: '0',
      skuName: 'SKU-A',
    });
    (svc as any).checkSafetyStockAlert = jest.fn().mockResolvedValue(undefined);

    await expect(
      svc.recordWaste({
        skuId: 301,
        qty: '1',
        reason: 'broken',
      }),
    ).rejects.toThrow('waste commit failed');

    const snapshotCall = mockQuery.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO inventory_daily_snapshots'),
    );
    expect(snapshotCall).toBeDefined();
    expect(mockDel).not.toHaveBeenCalled();
  });
});
