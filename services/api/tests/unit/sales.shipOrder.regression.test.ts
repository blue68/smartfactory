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

import { SalesService } from '../../src/modules/sales/sales.service';

describe('SalesService shipOrder inventory regression', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRedisDel.mockResolvedValue(1);
    mockGenerateNo.mockResolvedValue('TX260331-00001');
    mockTransaction.mockImplementation(
      async (cb: (manager: { query: typeof mockQuery }) => Promise<unknown>) => cb({ query: mockQuery }),
    );
  });

  it('writes delivery-out inventory transaction, decrements stock, and refreshes snapshot cache on ship', async () => {
    mockQuery
      .mockResolvedValueOnce([{ id: 3, status: 'produced', order_no: 'SO-1003' }])
      .mockResolvedValueOnce([
        { id: 11, sku_id: 101, stock_unit: 'pcs', qty_ordered: '10.0000', qty_delivered: '4.0000' },
      ])
      .mockResolvedValueOnce([
        { sku_id: 101, qty_on_hand: '10.0000', qty_reserved: '1.0000' },
      ])
      .mockResolvedValueOnce({ insertId: 21 })
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce({ affectedRows: 0 })
      .mockResolvedValueOnce([{ total: 1, fully_shipped: 1 }])
      .mockResolvedValueOnce({ affectedRows: 1 });

    const svc = new SalesService({ tenantId: 7, userId: 11 });
    const result = await svc.shipOrder(3, {
      trackingNo: 'TRACK-001',
      shippedItems: [{ orderItemId: 11, shippedQty: 6 }],
    });

    expect(result).toEqual({
      deliveryId: 21,
      deliveryNo: expect.any(String),
      orderStatus: 'shipped',
      warehouseId: 1,
      locationId: 1,
      warningCode: 'INV_FALLBACK_DEFAULT_LOCATION',
    });
    expect(mockGenerateNo).toHaveBeenCalledWith('transaction', 7);
    const inventoryTxCall = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO inventory_transactions'),
    );
    expect(String(inventoryTxCall?.[0])).toContain('INSERT INTO inventory_transactions');
    expect(inventoryTxCall?.[1]).toEqual([
      7,
      'TX260331-00001',
      101,
      1,
      1,
      'sales:ship',
      '6.0000',
      'pcs',
      '6.0000',
      'pcs',
      21,
      result.deliveryNo,
      '销售订单 SO-1003 发货出库',
      11,
      11,
    ]);
    const inventoryUpdateCall = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes('UPDATE inventory'),
    );
    expect(String(inventoryUpdateCall?.[0])).toContain('UPDATE inventory');
    expect(inventoryUpdateCall?.[1]).toEqual(['6.0000', 11, 7, 101, 1, 1]);
    const snapshotCall = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO inventory_daily_snapshots'),
    );
    expect(String(snapshotCall?.[0])).toContain('INSERT INTO inventory_daily_snapshots');
    expect(snapshotCall?.[1]).toEqual([7, 101]);
    expect(mockRedisDel).toHaveBeenCalledWith('inventory:7:101');
  });

  it('rejects shipping when available inventory is insufficient', async () => {
    mockQuery
      .mockResolvedValueOnce([{ id: 3, status: 'produced', order_no: 'SO-1003' }])
      .mockResolvedValueOnce([
        { id: 11, sku_id: 101, stock_unit: 'pcs', qty_ordered: '10.0000', qty_delivered: '4.0000' },
      ])
      .mockResolvedValueOnce([
        { sku_id: 101, qty_on_hand: '5.0000', qty_reserved: '1.0000' },
      ]);

    const svc = new SalesService({ tenantId: 7, userId: 11 });

    await expect(
      svc.shipOrder(3, {
        shippedItems: [{ orderItemId: 11, shippedQty: 6 }],
      }),
    ).rejects.toThrow('库存不足');

    expect(mockGenerateNo).not.toHaveBeenCalled();
    expect(mockRedisDel).not.toHaveBeenCalled();
  });

  it('does not invalidate inventory cache when ship transaction fails', async () => {
    mockQuery
      .mockResolvedValueOnce([{ id: 3, status: 'produced', order_no: 'SO-1003' }])
      .mockResolvedValueOnce([
        { id: 11, sku_id: 101, stock_unit: 'pcs', qty_ordered: '10.0000', qty_delivered: '4.0000' },
      ])
      .mockResolvedValueOnce([
        { sku_id: 101, qty_on_hand: '10.0000', qty_reserved: '1.0000' },
      ])
      .mockResolvedValueOnce({ insertId: 22 })
      .mockRejectedValueOnce(new Error('insert delivery item failed'));

    const svc = new SalesService({ tenantId: 7, userId: 11 });

    await expect(
      svc.shipOrder(3, {
        trackingNo: 'TRACK-002',
        shippedItems: [{ orderItemId: 11, shippedQty: 6 }],
      }),
    ).rejects.toThrow('insert delivery item failed');

    expect(mockRedisDel).not.toHaveBeenCalled();
  });

  it('does not invalidate inventory cache when ship transaction fails after inventory snapshot sync', async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT id, status, order_no FROM sales_orders')) {
        return [{ id: 3, status: 'produced', order_no: 'SO-1003' }];
      }
      if (sql.includes('FROM sales_order_items') && !sql.includes('FOR UPDATE')) {
        return [{ id: 11, sku_id: 101, stock_unit: 'pcs', qty_ordered: '10.0000', qty_delivered: '4.0000' }];
      }
      if (sql.includes('FROM sales_order_items') && sql.includes('FOR UPDATE')) {
        return [{ id: 11, sku_id: 101, stock_unit: 'pcs', qty_ordered: '10.0000', qty_delivered: '4.0000' }];
      }
      if (sql.includes('FROM inventory') && sql.includes('FOR UPDATE')) {
        return [{ sku_id: 101, qty_on_hand: '10.0000', qty_reserved: '1.0000' }];
      }
      if (sql.includes('INSERT INTO sales_deliveries')) return { insertId: 23 };
      if (sql.includes('INSERT INTO sales_delivery_items')) return { affectedRows: 1 };
      if (sql.includes('UPDATE sales_order_items')) return { affectedRows: 1 };
      if (sql.includes('INSERT INTO inventory_transactions')) return { insertId: 901 };
      if (sql.includes('UPDATE inventory')) return { affectedRows: 1 };
      if (sql.includes('INSERT INTO inventory_daily_snapshots')) return { affectedRows: 1 };
      if (sql.includes('DELETE ids') && sql.includes('FROM inventory_daily_snapshots ids')) return { affectedRows: 0 };
      if (sql.includes('COUNT(*) AS total')) return [{ total: 1, fully_shipped: 1 }];
      if (sql.includes('UPDATE sales_orders SET status = ?')) {
        throw new Error('finalize sales order status failed');
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const svc = new SalesService({ tenantId: 7, userId: 11 });
    await expect(
      svc.shipOrder(3, {
        trackingNo: 'TRACK-003',
        shippedItems: [{ orderItemId: 11, shippedQty: 6 }],
      }),
    ).rejects.toThrow('finalize sales order status failed');

    const snapshotCall = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO inventory_daily_snapshots'),
    );
    expect(snapshotCall).toBeDefined();
    expect(mockRedisDel).not.toHaveBeenCalled();
  });

  it('does not invalidate inventory cache when ship transaction commit fails after inventory snapshot sync', async () => {
    mockTransaction.mockImplementation(async (cb: (manager: { query: typeof mockQuery }) => Promise<unknown>) => {
      await cb({ query: mockQuery });
      throw new Error('ship-order commit failed');
    });

    mockQuery
      .mockResolvedValueOnce([{ id: 3, status: 'produced', order_no: 'SO-1003' }])
      .mockResolvedValueOnce([
        { id: 11, sku_id: 101, stock_unit: 'pcs', qty_ordered: '10.0000', qty_delivered: '4.0000' },
      ])
      .mockResolvedValueOnce([
        { sku_id: 101, qty_on_hand: '10.0000', qty_reserved: '1.0000' },
      ])
      .mockResolvedValueOnce({ insertId: 24 })
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce({ insertId: 902 })
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce({ affectedRows: 0 })
      .mockResolvedValueOnce([{ total: 1, fully_shipped: 1 }])
      .mockResolvedValueOnce({ affectedRows: 1 });

    const svc = new SalesService({ tenantId: 7, userId: 11 });
    await expect(
      svc.shipOrder(3, {
        trackingNo: 'TRACK-004',
        shippedItems: [{ orderItemId: 11, shippedQty: 6 }],
      }),
    ).rejects.toThrow('ship-order commit failed');

    const snapshotCall = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO inventory_daily_snapshots'),
    );
    expect(snapshotCall).toBeDefined();
    expect(mockRedisDel).not.toHaveBeenCalled();
  });
});
