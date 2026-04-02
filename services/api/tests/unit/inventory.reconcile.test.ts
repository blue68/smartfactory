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

describe('InventoryService reconcileInventoryBalances', () => {
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

  it('previews qty_on_hand drift from inventory_transactions without writing when dryRun is true', async () => {
    mockQuery
      .mockResolvedValueOnce([
        { sku_id: 301, qty_on_hand: '8.0000', qty_reserved: '2.0000', qty_in_transit: '1.0000' },
      ])
      .mockResolvedValueOnce([
        { sku_id: 301, expected_qty_on_hand: '10.0000' },
      ]);

    const svc = new InventoryService({ tenantId: 7, userId: 11, roles: ['boss'] });
    const result = await svc.reconcileInventoryBalances({ skuId: 301, dryRun: true });

    expect(result).toEqual({
      checkedCount: 1,
      changedCount: 1,
      dryRun: true,
      skuId: 301,
      skuIds: [301],
      items: [{
        skuId: 301,
        currentQtyOnHand: '8.0000',
        expectedQtyOnHand: '10.0000',
        deltaQtyOnHand: '2.0000',
        currentQtyReserved: '2.0000',
        expectedQtyReserved: null,
        deltaQtyReserved: null,
        currentQtyInTransit: '1.0000',
        expectedQtyInTransit: null,
        deltaQtyInTransit: null,
      }],
    });

    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(String(mockQuery.mock.calls[0][0])).toContain('FROM inventory');
    expect(String(mockQuery.mock.calls[1][0])).toContain('FROM inventory_transactions');
  });

  it('reconciles batch skuIds and refreshes snapshots when dryRun is false', async () => {
    mockQuery
      .mockResolvedValueOnce([
        { sku_id: 301, qty_on_hand: '8.0000', qty_reserved: '2.0000', qty_in_transit: '1.0000' },
        { sku_id: 302, qty_on_hand: '4.0000', qty_reserved: '0.5000', qty_in_transit: '0.0000' },
      ])
      .mockResolvedValueOnce([
        { sku_id: 301, expected_qty_on_hand: '10.0000' },
        { sku_id: 302, expected_qty_on_hand: '4.0000' },
      ])
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce({ affectedRows: 1 });

    const svc = new InventoryService({ tenantId: 7, userId: 11, roles: ['boss'] });
    const result = await svc.reconcileInventoryBalances({ skuIds: [302, 301], dryRun: false });

    expect(result).toEqual({
      checkedCount: 2,
      changedCount: 1,
      dryRun: false,
      skuId: null,
      skuIds: [301, 302],
      items: [{
        skuId: 301,
        currentQtyOnHand: '8.0000',
        expectedQtyOnHand: '10.0000',
        deltaQtyOnHand: '2.0000',
        currentQtyReserved: '2.0000',
        expectedQtyReserved: null,
        deltaQtyReserved: null,
        currentQtyInTransit: '1.0000',
        expectedQtyInTransit: null,
        deltaQtyInTransit: null,
      }],
    });

    expect(String(mockQuery.mock.calls[2][0])).toContain('INSERT INTO inventory');
    expect(mockQuery.mock.calls[2][1]).toEqual([7, 301, '10.0000', '2.0000', '1.0000']);
    expect(String(mockQuery.mock.calls[3][0])).toContain('INSERT INTO inventory_daily_snapshots');
    expect(mockQuery.mock.calls[3][1]).toEqual([7, 301]);
    expect(mockRedisDel).toHaveBeenCalledWith('inventory:7:301');
  });

  it('can reconcile reserved quantity from active material requirements when includeReserved is enabled', async () => {
    mockQuery
      .mockResolvedValueOnce([
        { sku_id: 301, qty_on_hand: '10.0000', qty_reserved: '1.0000', qty_in_transit: '1.0000' },
      ])
      .mockResolvedValueOnce([
        { sku_id: 301, expected_qty_on_hand: '10.0000' },
      ])
      .mockResolvedValueOnce([
        { sku_id: 301, expected_qty_reserved: '3.5000' },
      ])
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce({ affectedRows: 1 });

    const svc = new InventoryService({ tenantId: 7, userId: 11, roles: ['boss'] });
    const result = await svc.reconcileInventoryBalances({
      skuId: 301,
      includeReserved: true,
      dryRun: false,
    });

    expect(result).toEqual({
      checkedCount: 1,
      changedCount: 1,
      dryRun: false,
      skuId: 301,
      skuIds: [301],
      items: [{
        skuId: 301,
        currentQtyOnHand: '10.0000',
        expectedQtyOnHand: '10.0000',
        deltaQtyOnHand: '0.0000',
        currentQtyReserved: '1.0000',
        expectedQtyReserved: '3.5000',
        deltaQtyReserved: '2.5000',
        currentQtyInTransit: '1.0000',
        expectedQtyInTransit: null,
        deltaQtyInTransit: null,
      }],
    });

    expect(String(mockQuery.mock.calls[2][0])).toContain('FROM material_requirements mr');
    expect(String(mockQuery.mock.calls[3][0])).toContain('INSERT INTO inventory');
    expect(mockQuery.mock.calls[3][1]).toEqual([7, 301, '10.0000', '3.5000', '1.0000']);
    expect(String(mockQuery.mock.calls[4][0])).toContain('INSERT INTO inventory_daily_snapshots');
    expect(mockQuery.mock.calls[4][1]).toEqual([7, 301]);
    expect(mockRedisDel).toHaveBeenCalledWith('inventory:7:301');
  });

  it('can reconcile in-transit quantity from active purchase orders when includeInTransit is enabled', async () => {
    mockQuery
      .mockResolvedValueOnce([
        { sku_id: 301, qty_on_hand: '10.0000', qty_reserved: '1.0000', qty_in_transit: '1.0000' },
      ])
      .mockResolvedValueOnce([
        { sku_id: 301, expected_qty_on_hand: '10.0000' },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { sku_id: 301, expected_qty_in_transit: '4.5000' },
      ])
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce({ affectedRows: 1 });

    const svc = new InventoryService({ tenantId: 7, userId: 11, roles: ['boss'] });
    const result = await svc.reconcileInventoryBalances({
      skuId: 301,
      includeReserved: true,
      includeInTransit: true,
      dryRun: false,
    });

    expect(result).toEqual({
      checkedCount: 1,
      changedCount: 1,
      dryRun: false,
      skuId: 301,
      skuIds: [301],
      items: [{
        skuId: 301,
        currentQtyOnHand: '10.0000',
        expectedQtyOnHand: '10.0000',
        deltaQtyOnHand: '0.0000',
        currentQtyReserved: '1.0000',
        expectedQtyReserved: '0.0000',
        deltaQtyReserved: '-1.0000',
        currentQtyInTransit: '1.0000',
        expectedQtyInTransit: '4.5000',
        deltaQtyInTransit: '3.5000',
      }],
    });

    expect(String(mockQuery.mock.calls[3][0])).toContain('FROM purchase_order_items poi');
    expect(String(mockQuery.mock.calls[4][0])).toContain('INSERT INTO inventory');
    expect(mockQuery.mock.calls[4][1]).toEqual([7, 301, '10.0000', '0.0000', '4.5000']);
    expect(String(mockQuery.mock.calls[5][0])).toContain('INSERT INTO inventory_daily_snapshots');
    expect(mockQuery.mock.calls[5][1]).toEqual([7, 301]);
    expect(mockRedisDel).toHaveBeenCalledWith('inventory:7:301');
  });

  it('can recreate a missing inventory row from ledger, reserved, and in-transit sources in one pass', async () => {
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { sku_id: 305, expected_qty_on_hand: '6.5000' },
      ])
      .mockResolvedValueOnce([
        { sku_id: 305, expected_qty_reserved: '1.5000' },
      ])
      .mockResolvedValueOnce([
        { sku_id: 305, expected_qty_in_transit: '2.2500' },
      ])
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce({ affectedRows: 1 });

    const svc = new InventoryService({ tenantId: 7, userId: 11, roles: ['boss'] });
    const result = await svc.reconcileInventoryBalances({
      skuId: 305,
      includeReserved: true,
      includeInTransit: true,
      dryRun: false,
    });

    expect(result).toEqual({
      checkedCount: 1,
      changedCount: 1,
      dryRun: false,
      skuId: 305,
      skuIds: [305],
      items: [{
        skuId: 305,
        currentQtyOnHand: '0.0000',
        expectedQtyOnHand: '6.5000',
        deltaQtyOnHand: '6.5000',
        currentQtyReserved: '0.0000',
        expectedQtyReserved: '1.5000',
        deltaQtyReserved: '1.5000',
        currentQtyInTransit: '0.0000',
        expectedQtyInTransit: '2.2500',
        deltaQtyInTransit: '2.2500',
      }],
    });

    expect(mockQuery.mock.calls[4][1]).toEqual([7, 305, '6.5000', '1.5000', '2.2500']);
    expect(mockQuery.mock.calls[5][1]).toEqual([7, 305]);
    expect(mockRedisDel).toHaveBeenCalledWith('inventory:7:305');
  });

  it('does not invalidate inventory cache when reconcile commit fails after snapshot sync', async () => {
    mockTransaction.mockImplementation(
      async (cb: (manager: { query: typeof mockQuery }) => Promise<unknown>) => {
        const manager = { query: mockQuery } as { query: typeof mockQuery; __inventorySnapshotSkuIds?: Set<number> };
        await cb(manager);
        throw new Error('reconcile commit failed');
      },
    );

    mockQuery
      .mockResolvedValueOnce([
        { sku_id: 301, qty_on_hand: '8.0000', qty_reserved: '2.0000', qty_in_transit: '1.0000' },
      ])
      .mockResolvedValueOnce([
        { sku_id: 301, expected_qty_on_hand: '10.0000' },
      ])
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce({ affectedRows: 1 });

    const svc = new InventoryService({ tenantId: 7, userId: 11, roles: ['boss'] });
    await expect(
      svc.reconcileInventoryBalances({ skuId: 301, dryRun: false }),
    ).rejects.toThrow('reconcile commit failed');

    const snapshotCall = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO inventory_daily_snapshots'),
    );
    expect(snapshotCall).toBeDefined();
    expect(mockRedisDel).not.toHaveBeenCalled();
  });
});
