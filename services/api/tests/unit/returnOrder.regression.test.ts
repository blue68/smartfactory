const mockQuery = jest.fn();
const mockTransaction = jest.fn();
const mockRedisDel = jest.fn();
const mockGenerateNo = jest.fn();

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
}));

jest.mock('../../src/shared/generateNo', () => ({
  generateNo: (...args: unknown[]) => mockGenerateNo(...args),
}));

import { ReturnOrderService } from '../../src/modules/return-order/returnOrder.service';

describe('ReturnOrderService inventory regressions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRedisDel.mockResolvedValue(1);
    mockGenerateNo.mockResolvedValue('TX260331-00002');
    mockTransaction.mockImplementation(
      async (cb: (manager: { query: typeof mockQuery }) => Promise<unknown>) => cb({ query: mockQuery }),
    );
  });

  it('deducts inventory, writes return-out ledger, and refreshes snapshot cache when manual purchase return ships', async () => {
    mockQuery
      .mockResolvedValueOnce([
        {
          id: 12,
          status: 'confirmed',
          notes: '原始备注',
          return_type: 'purchase_return',
          source_inspection_id: null,
          return_no: 'RT-1001',
        },
      ])
      .mockResolvedValueOnce([
        {
          skuId: 101,
          qtyReturn: '3.0000',
          purchaseUnit: 'pcs',
          stockUnit: 'pcs',
          conversionRate: null,
        },
      ])
      .mockResolvedValueOnce([
        { sku_id: 101, qty_on_hand: '10.0000', qty_reserved: '2.0000' },
      ])
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce({ insertId: 801 })
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce({ affectedRows: 1 });

    const svc = new ReturnOrderService({ tenantId: 7, userId: 11 });
    await svc.ship(12, { trackingNo: 'TRACK-RT-01', notes: '仓库已发出' });

    expect(mockGenerateNo).toHaveBeenCalledWith('transaction', 7);

    const statusUpdateCall = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes('UPDATE return_orders'),
    );
    expect(statusUpdateCall?.[1]).toEqual([
      '原始备注\n物流单号：TRACK-RT-01\n发出备注：仓库已发出',
      11,
      12,
      7,
    ]);

    const inventoryTxCall = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO inventory_transactions'),
    );
    expect(inventoryTxCall?.[1]).toEqual([
      7,
      'TX260331-00002',
      101,
      1,
      1,
      'return_order:ship',
      '3.0000',
      'pcs',
      '3.0000',
      'pcs',
      12,
      'RT-1001',
      '采购退货 RT-1001 发货出库',
      11,
      11,
    ]);

    const inventoryUpdateCall = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes('UPDATE inventory'),
    );
    expect(inventoryUpdateCall?.[1]).toEqual(['3.0000', 11, 7, 101, 1, 1]);

    const snapshotCall = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO inventory_daily_snapshots'),
    );
    expect(snapshotCall?.[1]).toEqual([7, 101]);
    expect(mockRedisDel).toHaveBeenCalledWith('inventory:7:101');
  });

  it('skips inventory deduction for inspection-triggered return orders that never entered stock', async () => {
    mockQuery
      .mockResolvedValueOnce([
        {
          id: 12,
          status: 'confirmed',
          notes: null,
          return_type: 'purchase_return',
          source_inspection_id: 55,
          return_no: 'RT-1002',
        },
      ])
      .mockResolvedValueOnce({ affectedRows: 1 });

    const svc = new ReturnOrderService({ tenantId: 7, userId: 11 });
    await svc.ship(12);

    expect(mockGenerateNo).not.toHaveBeenCalled();
    expect(mockRedisDel).not.toHaveBeenCalled();
    expect(
      mockQuery.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO inventory_transactions')),
    ).toBe(false);
    expect(
      mockQuery.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO inventory_daily_snapshots')),
    ).toBe(false);
  });

  it('rejects manual purchase return ship when available inventory is insufficient', async () => {
    mockQuery
      .mockResolvedValueOnce([
        {
          id: 12,
          status: 'confirmed',
          notes: null,
          return_type: 'purchase_return',
          source_inspection_id: null,
          return_no: 'RT-1003',
        },
      ])
      .mockResolvedValueOnce([
        {
          skuId: 101,
          qtyReturn: '6.0000',
          purchaseUnit: 'pcs',
          stockUnit: 'pcs',
          conversionRate: null,
        },
      ])
      .mockResolvedValueOnce([
        { sku_id: 101, qty_on_hand: '5.0000', qty_reserved: '1.0000' },
      ]);

    const svc = new ReturnOrderService({ tenantId: 7, userId: 11 });

    await expect(svc.ship(12)).rejects.toThrow('库存不足');
    expect(mockGenerateNo).not.toHaveBeenCalled();
    expect(mockRedisDel).not.toHaveBeenCalled();
    expect(
      mockQuery.mock.calls.some(([sql]) => String(sql).includes('UPDATE return_orders')),
    ).toBe(false);
  });

  it('does not invalidate inventory cache when return-ship transaction fails', async () => {
    mockQuery
      .mockResolvedValueOnce([
        {
          id: 12,
          status: 'confirmed',
          notes: null,
          return_type: 'purchase_return',
          source_inspection_id: null,
          return_no: 'RT-1004',
        },
      ])
      .mockResolvedValueOnce([
        {
          skuId: 101,
          qtyReturn: '3.0000',
          purchaseUnit: 'pcs',
          stockUnit: 'pcs',
          conversionRate: null,
        },
      ])
      .mockResolvedValueOnce([
        { sku_id: 101, qty_on_hand: '10.0000', qty_reserved: '2.0000' },
      ])
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce({ insertId: 802 })
      .mockRejectedValueOnce(new Error('decrement inventory failed'));

    const svc = new ReturnOrderService({ tenantId: 7, userId: 11 });
    await expect(svc.ship(12, { trackingNo: 'TRACK-RT-02' })).rejects.toThrow(
      'decrement inventory failed',
    );

    expect(mockRedisDel).not.toHaveBeenCalled();
  });

  it('does not invalidate inventory cache when return-ship transaction fails after first sku snapshot sync', async () => {
    mockGenerateNo
      .mockResolvedValueOnce('TX260331-10001')
      .mockResolvedValueOnce('TX260331-10002');
    let inventoryUpdateCount = 0;

    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM return_orders')) {
        return [
          {
            id: 12,
            status: 'confirmed',
            notes: null,
            return_type: 'purchase_return',
            source_inspection_id: null,
            return_no: 'RT-1005',
          },
        ];
      }
      if (sql.includes('FROM return_order_items')) {
        return [
          { skuId: 101, qtyReturn: '3.0000', purchaseUnit: 'pcs', stockUnit: 'pcs', conversionRate: null },
          { skuId: 102, qtyReturn: '2.0000', purchaseUnit: 'pcs', stockUnit: 'pcs', conversionRate: null },
        ];
      }
      if (sql.includes('FROM inventory') && sql.includes('FOR UPDATE')) {
        return [
          { sku_id: 101, qty_on_hand: '10.0000', qty_reserved: '1.0000' },
          { sku_id: 102, qty_on_hand: '8.0000', qty_reserved: '1.0000' },
        ];
      }
      if (sql.includes('UPDATE return_orders')) return { affectedRows: 1 };
      if (sql.includes('INSERT INTO inventory_transactions')) return { insertId: 901 };
      if (sql.includes('UPDATE inventory') && String(sql).includes('qty_on_hand = qty_on_hand - ?')) {
        inventoryUpdateCount += 1;
        if (inventoryUpdateCount === 2) {
          throw new Error('second sku decrement failed');
        }
        return { affectedRows: 1 };
      }
      if (sql.includes('INSERT INTO inventory_daily_snapshots')) return { affectedRows: 1 };
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const svc = new ReturnOrderService({ tenantId: 7, userId: 11 });
    await expect(svc.ship(12, { trackingNo: 'TRACK-RT-03' })).rejects.toThrow(
      'second sku decrement failed',
    );

    const snapshotCall = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO inventory_daily_snapshots'),
    );
    expect(snapshotCall).toBeDefined();
    expect(mockRedisDel).not.toHaveBeenCalled();
  });

  it('does not invalidate inventory cache when return-ship transaction commit fails after snapshot sync', async () => {
    mockTransaction.mockImplementation(async (cb: (manager: { query: typeof mockQuery }) => Promise<unknown>) => {
      await cb({ query: mockQuery });
      throw new Error('return-ship commit failed');
    });

    mockQuery
      .mockResolvedValueOnce([
        {
          id: 12,
          status: 'confirmed',
          notes: null,
          return_type: 'purchase_return',
          source_inspection_id: null,
          return_no: 'RT-1006',
        },
      ])
      .mockResolvedValueOnce([
        {
          skuId: 101,
          qtyReturn: '3.0000',
          purchaseUnit: 'pcs',
          stockUnit: 'pcs',
          conversionRate: null,
        },
      ])
      .mockResolvedValueOnce([
        { sku_id: 101, qty_on_hand: '10.0000', qty_reserved: '2.0000' },
      ])
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce({ insertId: 903 })
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce({ affectedRows: 1 });

    const svc = new ReturnOrderService({ tenantId: 7, userId: 11 });
    await expect(svc.ship(12, { trackingNo: 'TRACK-RT-04' })).rejects.toThrow(
      'return-ship commit failed',
    );

    const snapshotCall = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO inventory_daily_snapshots'),
    );
    expect(snapshotCall).toBeDefined();
    expect(mockRedisDel).not.toHaveBeenCalled();
  });
});
