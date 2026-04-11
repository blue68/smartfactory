import { AppDataSource } from '../../src/config/database';
import { PurchaseService } from '../../src/modules/purchase/purchase.service';
import { recalculatePurchaseOrderStatus } from '../../src/modules/purchase/purchase-order-status.util';

const mockRedisDel = jest.fn();

jest.mock('../../src/config/database', () => ({
  AppDataSource: {
    query: jest.fn(),
    transaction: jest.fn(),
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

const mockAppDataSource = AppDataSource as unknown as {
  query: jest.Mock;
  transaction: jest.Mock;
};

describe('Purchase order regressions', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    mockRedisDel.mockResolvedValue(1);
    (PurchaseService as any).purchaseReceiptDeliveryColumn = 'delivery_note_id';
    (PurchaseService as any).purchaseReceiptItemsTableSupported = true;
    (PurchaseService as any).purchaseOrderClosureColumnsSupported = true;
    (PurchaseService as any).deliveryNoteItemDyeLotSupported = false;
    (PurchaseService as any).purchaseReceiptItemDyeLotSupported = false;
    (PurchaseService as any).incomingInspectionItemDyeLotSupported = false;
  });

  it('creates manual purchase orders in confirmed status', async () => {
    const manager = {
      query: jest
        .fn()
        .mockResolvedValueOnce({ insertId: 301 })
        .mockResolvedValueOnce({ insertId: 401 }),
      };
    manager.query.mockResolvedValueOnce({ affectedRows: 1 });
    mockAppDataSource.transaction.mockImplementation(async (cb: any) => cb(manager));

    const svc = new PurchaseService({ tenantId: 7, userId: 11 });
    jest.spyOn(svc as any, 'generateNo').mockReturnValue('PO-250324-001');

    await svc.createPO({
      supplierId: 3,
      expectedDate: '2026-03-30',
      items: [
        {
          skuId: 101,
          qtyOrdered: '10',
          purchaseUnit: 'kg',
          unitPrice: '8.50',
        },
      ],
    });

    const poInsertCall = manager.query.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO purchase_orders'),
    );
    expect(String(poInsertCall?.[0])).toContain("'confirmed'");
    const inTransitCall = manager.query.mock.calls.find(([sql]) =>
      String(sql).includes('qty_in_transit = qty_in_transit + VALUES(qty_in_transit)'),
    );
    expect(String(inTransitCall?.[0])).toContain('FROM purchase_order_items poi');
    expect(inTransitCall?.[1]).toEqual([301, 7]);
    expect(mockRedisDel).toHaveBeenCalledWith('inventory:7:101');
  });

  it('maps suggestion production operation to po item when create-po uses suggestionId', async () => {
    const manager = {
      query: jest
        .fn()
        .mockResolvedValueOnce({ insertId: 304 })
        .mockResolvedValueOnce([{ sku_id: 101, production_operation_id: 8801 }])
        .mockResolvedValueOnce({ insertId: 404 })
        .mockResolvedValueOnce({ affectedRows: 1 })
        .mockResolvedValueOnce({ affectedRows: 1 }),
    };
    mockAppDataSource.transaction.mockImplementation(async (cb: any) => cb(manager));

    const svc = new PurchaseService({ tenantId: 7, userId: 11 });
    jest.spyOn(svc as any, 'generateNo').mockReturnValue('PO-250324-004');

    await svc.createPO({
      supplierId: 3,
      suggestionId: 901,
      expectedDate: '2026-03-30',
      items: [
        {
          skuId: 101,
          qtyOrdered: '10',
          purchaseUnit: 'kg',
          unitPrice: '8.50',
        },
      ],
    });

    const suggestionLookupCall = manager.query.mock.calls.find(([sql]) =>
      String(sql).includes('SELECT sku_id, production_operation_id'),
    );
    expect(suggestionLookupCall?.[1]).toEqual([901, 7]);
    const poItemInsertCall = manager.query.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO purchase_order_items'),
    );
    expect(poItemInsertCall?.[1]).toEqual(expect.arrayContaining([304, 101, '10', 8801, 'kg', '8.50', '85.00']));
    const suggestionUpdateCall = manager.query.mock.calls.find(([sql]) =>
      String(sql).includes('UPDATE purchase_suggestions SET status = \'executed\''),
    );
    expect(suggestionUpdateCall?.[1]).toEqual([11, 901, 7]);
  });

  it('does not invalidate inventory cache when create-po transaction fails', async () => {
    const manager = {
      query: jest
        .fn()
        .mockResolvedValueOnce({ insertId: 302 })
        .mockRejectedValueOnce(new Error('insert po item failed')),
    };
    mockAppDataSource.transaction.mockImplementation(async (cb: any) => cb(manager));

    const svc = new PurchaseService({ tenantId: 7, userId: 11 });
    jest.spyOn(svc as any, 'generateNo').mockReturnValue('PO-250324-002');

    await expect(
      svc.createPO({
        supplierId: 3,
        expectedDate: '2026-03-30',
        items: [
          {
            skuId: 101,
            qtyOrdered: '10',
            purchaseUnit: 'kg',
            unitPrice: '8.50',
          },
        ],
      }),
    ).rejects.toThrow('insert po item failed');

    expect(mockRedisDel).not.toHaveBeenCalled();
  });

  it('does not invalidate inventory cache when create-po transaction commit fails after in-transit sync', async () => {
    const manager = {
      query: jest
        .fn()
        .mockResolvedValueOnce({ insertId: 303 })
        .mockResolvedValueOnce({ insertId: 403 })
        .mockResolvedValueOnce({ affectedRows: 1 }),
    };
    mockAppDataSource.transaction.mockImplementation(async (cb: any) => {
      await cb(manager);
      throw new Error('create-po commit failed');
    });

    const svc = new PurchaseService({ tenantId: 7, userId: 11 });
    jest.spyOn(svc as any, 'generateNo').mockReturnValue('PO-250324-003');

    await expect(
      svc.createPO({
        supplierId: 3,
        expectedDate: '2026-03-30',
        items: [
          {
            skuId: 101,
            qtyOrdered: '10',
            purchaseUnit: 'kg',
            unitPrice: '8.50',
          },
        ],
      }),
    ).rejects.toThrow('create-po commit failed');

    const inTransitCall = manager.query.mock.calls.find(([sql]) =>
      String(sql).includes('qty_in_transit = qty_in_transit + VALUES(qty_in_transit)'),
    );
    expect(inTransitCall?.[1]).toEqual([303, 7]);
    expect(mockRedisDel).not.toHaveBeenCalled();
  });

  it('only allows confirmed or partial_received purchase orders to create delivery notes', async () => {
    mockAppDataSource.query.mockResolvedValue([{ id: 1, status: 'received', tenant_id: 7 }]);

    const svc = new PurchaseService({ tenantId: 7, userId: 11 });

    await expect(
      svc.createDeliveryNote({
        poId: 1,
        deliveryDate: '2026-03-24',
        items: [
          {
            skuId: 101,
            qtyDelivered: '5',
            purchaseUnit: 'kg',
            unitPrice: '8.50',
          },
        ],
      }),
    ).rejects.toThrow('仅 confirmed / partial_received 可操作');
  });

  it('creates delivery notes with delivery_date and pending status in correct columns', async () => {
    const manager = {
      query: jest
        .fn()
        .mockResolvedValueOnce([{ supplier_id: 3 }])
        .mockResolvedValueOnce({ insertId: 501 })
        .mockResolvedValueOnce({ insertId: 601 }),
    };
    mockAppDataSource.query
      .mockResolvedValueOnce([{ id: 1, status: 'confirmed', tenant_id: 7 }])
      .mockResolvedValueOnce([
        { skuId: 101, qtyOrdered: '10', purchaseUnit: 'kg', unitPrice: '8.50' },
      ])
      .mockResolvedValueOnce([]);
    mockAppDataSource.transaction.mockImplementation(async (cb: any) => cb(manager));

    const svc = new PurchaseService({ tenantId: 7, userId: 11 });
    jest.spyOn(svc as any, 'generateNo').mockReturnValue('DN-250324-001');

    await svc.createDeliveryNote({
      poId: 1,
      deliveryDate: '2026-03-24',
      notes: '第一批到货',
      items: [
        {
          skuId: 101,
          qtyDelivered: '5',
          purchaseUnit: 'kg',
          unitPrice: '8.50',
        },
      ],
    });

    expect(String(manager.query.mock.calls[1][0])).toContain("delivery_date, status");
    expect(manager.query.mock.calls[1][1]).toEqual([7, 'DN-250324-001', 1, 3, '2026-03-24', '第一批到货', 11, 11]);
  });

  it('merges duplicate sku rows before creating delivery note items', async () => {
    const manager = {
      query: jest
        .fn()
        .mockResolvedValueOnce([{ supplier_id: 3 }])
        .mockResolvedValueOnce({ insertId: 701 })
        .mockResolvedValueOnce({ insertId: 801 }),
    };
    mockAppDataSource.query
      .mockResolvedValueOnce([{ id: 1, status: 'confirmed', tenant_id: 7 }])
      .mockResolvedValueOnce([
        { skuId: 101, qtyOrdered: '10', purchaseUnit: 'kg', unitPrice: '8.50' },
      ])
      .mockResolvedValueOnce([]);
    mockAppDataSource.transaction.mockImplementation(async (cb: any) => cb(manager));

    const svc = new PurchaseService({ tenantId: 7, userId: 11 });
    jest.spyOn(svc as any, 'generateNo').mockReturnValue('DN-250324-002');

    await svc.createDeliveryNote({
      poId: 1,
      deliveryDate: '2026-03-24',
      items: [
        {
          skuId: 101,
          qtyDelivered: '2.5',
          purchaseUnit: 'kg',
          unitPrice: '8.50',
        },
        {
          skuId: 101,
          qtyDelivered: '1.5',
          purchaseUnit: 'kg',
          unitPrice: '8.50',
        },
      ],
    });

    expect(manager.query).toHaveBeenCalledTimes(3);
    expect(manager.query.mock.calls[2][1]).toEqual([7, 701, 101, '4.00', 'kg', '8.50', '34.00', 11, 11]);
  });

  it('accepts delivery items when frontend price precision differs from purchase order precision', async () => {
    const manager = {
      query: jest
        .fn()
        .mockResolvedValueOnce([{ supplier_id: 3 }])
        .mockResolvedValueOnce({ insertId: 901 })
        .mockResolvedValueOnce({ insertId: 902 }),
    };
    mockAppDataSource.query
      .mockResolvedValueOnce([{ id: 1, status: 'confirmed', tenant_id: 7 }])
      .mockResolvedValueOnce([
        { skuId: 101, qtyOrdered: '10', purchaseUnit: 'kg', unitPrice: '8.5000' },
      ])
      .mockResolvedValueOnce([]);
    mockAppDataSource.transaction.mockImplementation(async (cb: any) => cb(manager));

    const svc = new PurchaseService({ tenantId: 7, userId: 11 });
    jest.spyOn(svc as any, 'generateNo').mockReturnValue('DN-250324-003');

    await expect(
      svc.createDeliveryNote({
        poId: 1,
        deliveryDate: '2026-03-24',
        items: [
          {
            skuId: 101,
            qtyDelivered: '5',
            purchaseUnit: 'kg',
            unitPrice: '8.50',
          },
        ],
      }),
    ).resolves.toEqual({ id: 901, deliveryNo: 'DN-250324-003' });
  });

  it('requires dye lot number for fabric delivery items', async () => {
    mockAppDataSource.query
      .mockResolvedValueOnce([{ id: 1, status: 'confirmed', tenant_id: 7 }])
      .mockResolvedValueOnce([
        { skuId: 101, skuCode: 'RM-00057', hasDyeLot: 1, qtyOrdered: '10', purchaseUnit: 'kg', unitPrice: '8.5000' },
      ])
      .mockResolvedValueOnce([]);

    const svc = new PurchaseService({ tenantId: 7, userId: 11 });

    await expect(
      svc.createDeliveryNote({
        poId: 1,
        deliveryDate: '2026-03-24',
        items: [
          {
            skuId: 101,
            qtyDelivered: '5',
            purchaseUnit: 'kg',
            unitPrice: '8.50',
          },
        ],
      }),
    ).rejects.toThrow('需要登记缸号');
  });

  it('stores dye lot number on delivery note items when schema supports it', async () => {
    (PurchaseService as any).deliveryNoteItemDyeLotSupported = true;
    const manager = {
      query: jest
        .fn()
        .mockResolvedValueOnce([{ supplier_id: 3 }])
        .mockResolvedValueOnce({ insertId: 903 })
        .mockResolvedValueOnce({ insertId: 904 }),
    };
    mockAppDataSource.query
      .mockResolvedValueOnce([{ id: 1, status: 'confirmed', tenant_id: 7 }])
      .mockResolvedValueOnce([
        { skuId: 101, skuCode: 'RM-00057', hasDyeLot: 1, qtyOrdered: '10', purchaseUnit: 'kg', unitPrice: '8.5000' },
      ])
      .mockResolvedValueOnce([]);
    mockAppDataSource.transaction.mockImplementation(async (cb: any) => cb(manager));

    const svc = new PurchaseService({ tenantId: 7, userId: 11 });
    jest.spyOn(svc as any, 'generateNo').mockReturnValue('DN-250324-004');

    await svc.createDeliveryNote({
      poId: 1,
      deliveryDate: '2026-03-24',
      items: [
        {
          skuId: 101,
          qtyDelivered: '5',
          purchaseUnit: 'kg',
          unitPrice: '8.50',
          dyeLotNo: 'DY-20260324-A01',
        },
      ],
    });

    expect(String(manager.query.mock.calls[2][0])).toContain('dye_lot_no');
    expect(manager.query.mock.calls[2][1]).toEqual([
      7, 903, 101, 'DY-20260324-A01', '5', 'kg', '8.50', '42.50', 11, 11,
    ]);
  });

  it('keeps multiple dye lot lines separate for the same sku when creating delivery notes', async () => {
    (PurchaseService as any).deliveryNoteItemDyeLotSupported = true;
    const manager = {
      query: jest
        .fn()
        .mockResolvedValueOnce([{ supplier_id: 3 }])
        .mockResolvedValueOnce({ insertId: 905 })
        .mockResolvedValueOnce({ insertId: 906 })
        .mockResolvedValueOnce({ insertId: 907 }),
    };
    mockAppDataSource.query
      .mockResolvedValueOnce([{ id: 1, status: 'confirmed', tenant_id: 7 }])
      .mockResolvedValueOnce([
        { skuId: 101, skuCode: 'RM-00057', hasDyeLot: 1, qtyOrdered: '2000', purchaseUnit: 'm', unitPrice: '8.5000' },
      ])
      .mockResolvedValueOnce([]);
    mockAppDataSource.transaction.mockImplementation(async (cb: any) => cb(manager));

    const svc = new PurchaseService({ tenantId: 7, userId: 11 });
    jest.spyOn(svc as any, 'generateNo').mockReturnValue('DN-250324-005');

    await svc.createDeliveryNote({
      poId: 1,
      deliveryDate: '2026-03-24',
      items: [
        {
          skuId: 101,
          qtyDelivered: '1000',
          purchaseUnit: 'm',
          unitPrice: '8.50',
          dyeLotNo: 'DY-20260324-A01',
        },
        {
          skuId: 101,
          qtyDelivered: '1000',
          purchaseUnit: 'm',
          unitPrice: '8.50',
          dyeLotNo: 'DY-20260324-A02',
        },
      ],
    });

    expect(manager.query).toHaveBeenCalledTimes(4);
    expect(manager.query.mock.calls[2][1]).toEqual([
      7, 905, 101, 'DY-20260324-A01', '1000', 'm', '8.50', '8500.00', 11, 11,
    ]);
    expect(manager.query.mock.calls[3][1]).toEqual([
      7, 905, 101, 'DY-20260324-A02', '1000', 'm', '8.50', '8500.00', 11, 11,
    ]);
  });

  it('rejects over-delivery when multiple dye lot lines exceed the same sku remaining quantity in total', async () => {
    (PurchaseService as any).deliveryNoteItemDyeLotSupported = true;
    mockAppDataSource.query
      .mockResolvedValueOnce([{ id: 1, status: 'confirmed', tenant_id: 7 }])
      .mockResolvedValueOnce([
        { skuId: 101, skuCode: 'RM-00057', hasDyeLot: 1, qtyOrdered: '2000', purchaseUnit: 'm', unitPrice: '8.5000' },
      ])
      .mockResolvedValueOnce([]);

    const svc = new PurchaseService({ tenantId: 7, userId: 11 });

    await expect(
      svc.createDeliveryNote({
        poId: 1,
        deliveryDate: '2026-03-24',
        items: [
          {
            skuId: 101,
            qtyDelivered: '1200',
            purchaseUnit: 'm',
            unitPrice: '8.50',
            dyeLotNo: 'DY-20260324-A01',
          },
          {
            skuId: 101,
            qtyDelivered: '1000',
            purchaseUnit: 'm',
            unitPrice: '8.50',
            dyeLotNo: 'DY-20260324-A02',
          },
        ],
      }),
    ).rejects.toThrow('送货数量不能超过剩余可送货数量 2000.0000');
  });

  it('rejects duplicate delivery creation when purchase order has already been fully delivered', async () => {
    mockAppDataSource.query
      .mockResolvedValueOnce([{ id: 1, status: 'confirmed', tenant_id: 7 }])
      .mockResolvedValueOnce([
        { skuId: 101, qtyOrdered: '10', purchaseUnit: 'kg', unitPrice: '8.50' },
      ])
      .mockResolvedValueOnce([
        { skuId: 101, qtyDelivered: '10', purchaseUnit: 'kg', unitPrice: '8.50' },
      ]);

    const svc = new PurchaseService({ tenantId: 7, userId: 11 });

    await expect(
      svc.createDeliveryNote({
        poId: 1,
        deliveryDate: '2026-03-24',
        items: [
          {
            skuId: 101,
            qtyDelivered: '5',
            purchaseUnit: 'kg',
            unitPrice: '8.50',
          },
        ],
      }),
    ).rejects.toThrow('当前采购订单已完成送货登记，无需重复创建送货单');
  });

  it('recalculates purchase order status to partial_received when some qty has been received', async () => {
    const manager = {
      query: jest
        .fn()
        .mockResolvedValueOnce([{ id: 1, status: 'confirmed' }])
        .mockResolvedValueOnce([{ total_ordered: '10', total_received: '4' }])
        .mockResolvedValueOnce({ affectedRows: 1 }),
    };

    const nextStatus = await recalculatePurchaseOrderStatus({
      manager: manager as any,
      tenantId: 7,
      userId: 11,
      poId: 1,
    });

    expect(nextStatus).toBe('partial_received');
    expect(String(manager.query.mock.calls[0][0])).toContain('FOR UPDATE');
    expect(manager.query.mock.calls[2][1]).toEqual(['partial_received', 11, 1, 7]);
  });

  it('recalculates purchase order status to received when all qty has been received', async () => {
    const manager = {
      query: jest
        .fn()
        .mockResolvedValueOnce([{ id: 2, status: 'partial_received' }])
        .mockResolvedValueOnce([{ total_ordered: '10', total_received: '10' }])
        .mockResolvedValueOnce({ affectedRows: 1 }),
    };

    const nextStatus = await recalculatePurchaseOrderStatus({
      manager: manager as any,
      tenantId: 7,
      userId: 11,
      poId: 2,
    });

    expect(nextStatus).toBe('received');
    expect(String(manager.query.mock.calls[0][0])).toContain('FOR UPDATE');
    expect(manager.query.mock.calls[2][1]).toEqual(['received', 11, 2, 7]);
  });

  it('does not reopen a cancelled purchase order during receipt status recalculation', async () => {
    const manager = {
      query: jest.fn().mockResolvedValueOnce([{ id: 3, status: 'cancelled' }]),
    };

    const nextStatus = await recalculatePurchaseOrderStatus({
      manager: manager as any,
      tenantId: 7,
      userId: 11,
      poId: 3,
    });

    expect(nextStatus).toBe('cancelled');
    expect(String(manager.query.mock.calls[0][0])).toContain('FOR UPDATE');
    expect(manager.query).toHaveBeenCalledTimes(1);
  });

  it('requires close reason, marks purchase order as cancelled, and releases remaining in-transit qty', async () => {
    (PurchaseService as any).purchaseOrderClosureColumnsSupported = null;
    mockAppDataSource.query.mockResolvedValueOnce([{ cnt: 1 }]);
    const manager = {
      query: jest
        .fn()
        .mockResolvedValueOnce([{ id: 5, status: 'partial_received' }])
        .mockResolvedValueOnce([{ sku_id: 101 }])
        .mockResolvedValueOnce({ affectedRows: 1 })
        .mockResolvedValueOnce({ affectedRows: 1 }),
    };
    mockAppDataSource.transaction.mockImplementation(async (cb: any) => cb(manager));

    const svc = new PurchaseService({ tenantId: 7, userId: 11 });
    await svc.closeOrder(5, { reason: '尾单确认关闭' });

    expect(manager.query.mock.calls[2][1]).toEqual(['尾单确认关闭', 11, 11, 5, 7]);
    expect(String(manager.query.mock.calls[3][0])).toContain('SET inv.qty_in_transit = GREATEST');
    expect(manager.query.mock.calls[3][1]).toEqual([5, 7, 7]);
    expect(mockRedisDel).toHaveBeenCalledWith('inventory:7:101');
  });

  it('does not invalidate inventory cache when close-order transaction fails', async () => {
    const manager = {
      query: jest
        .fn()
        .mockResolvedValueOnce([{ id: 6, status: 'partial_received' }])
        .mockResolvedValueOnce([{ sku_id: 101 }])
        .mockResolvedValueOnce({ affectedRows: 1 })
        .mockRejectedValueOnce(new Error('release in-transit failed')),
    };
    mockAppDataSource.transaction.mockImplementation(async (cb: any) => cb(manager));

    const svc = new PurchaseService({ tenantId: 7, userId: 11 });
    await expect(svc.closeOrder(6, { reason: '异常关闭' })).rejects.toThrow('release in-transit failed');

    expect(String(manager.query.mock.calls[0][0])).toContain('FOR UPDATE');
    expect(mockRedisDel).not.toHaveBeenCalled();
  });

  it('does not invalidate inventory cache when close-order transaction commit fails after in-transit release', async () => {
    const manager = {
      query: jest
        .fn()
        .mockResolvedValueOnce([{ id: 7, status: 'partial_received' }])
        .mockResolvedValueOnce([{ sku_id: 101 }])
        .mockResolvedValueOnce({ affectedRows: 1 })
        .mockResolvedValueOnce({ affectedRows: 1 }),
    };
    mockAppDataSource.transaction.mockImplementation(async (cb: any) => {
      await cb(manager);
      throw new Error('close-order commit failed');
    });

    const svc = new PurchaseService({ tenantId: 7, userId: 11 });
    await expect(svc.closeOrder(7, { reason: '异常关闭' })).rejects.toThrow('close-order commit failed');

    const releaseInTransitCall = manager.query.mock.calls.find(([sql]) =>
      String(sql).includes('SET inv.qty_in_transit = GREATEST'),
    );
    expect(releaseInTransitCall?.[1]).toEqual([7, 7, 7]);
    expect(mockRedisDel).not.toHaveBeenCalled();
  });

  it('lists overdue partial_received orders for tail tracking only', async () => {
    mockAppDataSource.query
      .mockResolvedValueOnce([
        {
          id: 5,
          poNo: 'PO-001',
          expectedDate: '2026-03-20',
          supplierName: '供应商A',
          status: 'partial_received',
          totalAmount: '1200.00',
          totalOrdered: '100',
          totalReceived: '60',
          totalGap: '40',
          overdueDays: 4,
        },
      ])
      .mockResolvedValueOnce([{ total: 1 }]);

    const svc = new PurchaseService({ tenantId: 7, userId: 11 });
    const result = await svc.listTailOrders({ page: 1, pageSize: 20 });

    expect(result.total).toBe(1);
    expect(result.list[0]).toMatchObject({
      status: 'partial_received',
      overdueDays: 4,
      totalGap: '40',
    });
    expect(String(mockAppDataSource.query.mock.calls[0][0])).toContain("po.status = 'partial_received'");
    expect(String(mockAppDataSource.query.mock.calls[0][0])).toContain('po.expected_date < CURDATE()');
  });

  it('returns item-level delivery history in purchase order detail', async () => {
    mockAppDataSource.query
      .mockResolvedValueOnce([
        {
          id: 5,
          po_no: 'PO-001',
          supplier_id: 9,
          supplierName: '供应商A',
          status: 'partial_received',
          expected_date: '2026-03-20',
          total_amount: '1200.00',
          created_at: '2026-03-18 10:00:00',
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 51,
          skuId: 101,
          skuCode: 'RM-101',
          skuName: '面料A',
          qtyOrdered: '100',
          qtyReceived: '60',
          gapQty: '40',
          purchaseUnit: 'm',
          unitPrice: '12.00',
          amount: '1200.00',
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 201,
          deliveryNo: 'DN-001',
          deliveryDate: '2026-03-19',
          status: 'pending',
          notes: null,
          totalDelivered: '60',
          receiptNo: 'PR-001',
          receiptStatus: 'confirmed',
          receivedAt: '2026-03-20 12:00:00',
        },
      ])
      .mockResolvedValueOnce([
        {
          skuId: 101,
          purchaseUnit: 'm',
          unitPrice: '12.00',
          deliveryId: 201,
          deliveryNo: 'DN-001',
          deliveryDate: '2026-03-19',
          deliveryStatus: 'pending',
          qtyDelivered: '60',
          receiptId: 301,
          receiptNo: 'PR-001',
          receiptStatus: 'confirmed',
          qtyReceived: '60',
          receivedAt: '2026-03-20 12:00:00',
        },
      ]);

    const svc = new PurchaseService({ tenantId: 7, userId: 11 });
    const detail = await svc.getById(5);

    expect(String(mockAppDataSource.query.mock.calls[2][0])).toContain('LEFT JOIN incoming_inspection_records ir');
    expect(detail.items).toHaveLength(1);
    expect(detail.items[0].deliveryHistory).toHaveLength(1);
    expect(detail.items[0].deliveryHistory?.[0]).toMatchObject({
      deliveryNo: 'DN-001',
      deliveryStatus: 'pending',
      qtyDelivered: '60.00',
      receiptNo: 'PR-001',
      qtyReceived: '60.00',
    });
  });

  it('aggregates duplicate purchase-order sku rows and delivery history in detail view', async () => {
    mockAppDataSource.query
      .mockResolvedValueOnce([
        {
          id: 5,
          po_no: 'PO-002',
          supplier_id: 9,
          supplierName: '供应商B',
          status: 'partial_received',
          expected_date: '2026-03-20',
          total_amount: '1777.80',
          created_at: '2026-03-18 10:00:00',
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 61,
          skuId: 201,
          skuCode: 'RM-201',
          skuName: 'EPE珍珠棉',
          qtyOrdered: '2869.60',
          qtyReceived: '287.96',
          gapQty: '2581.64',
          purchaseUnit: '卷',
          unitPrice: '5.00',
          amount: '14348.00',
        },
        {
          id: 62,
          skuId: 201,
          skuCode: 'RM-201',
          skuName: 'EPE珍珠棉',
          qtyOrdered: '287.96',
          qtyReceived: '0',
          gapQty: '287.96',
          purchaseUnit: '卷',
          unitPrice: '5.00',
          amount: '1439.80',
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 211,
          deliveryNo: 'DN-002',
          deliveryDate: '2026-03-19',
          status: 'pending',
          notes: null,
          totalDelivered: '1287.96',
          receiptId: null,
          receiptNo: null,
          receiptStatus: null,
          receivedAt: null,
        },
      ])
      .mockResolvedValueOnce([
        {
          skuId: 201,
          purchaseUnit: '卷',
          unitPrice: '5.00',
          deliveryId: 211,
          deliveryNo: 'DN-002',
          deliveryDate: '2026-03-19',
          deliveryStatus: 'pending',
          qtyDelivered: '287.96',
          receiptId: null,
          receiptNo: null,
          receiptStatus: null,
          qtyReceived: null,
          receivedAt: null,
        },
        {
          skuId: 201,
          purchaseUnit: '卷',
          unitPrice: '5.00',
          deliveryId: 211,
          deliveryNo: 'DN-002',
          deliveryDate: '2026-03-19',
          deliveryStatus: 'pending',
          qtyDelivered: '1000',
          receiptId: null,
          receiptNo: null,
          receiptStatus: null,
          qtyReceived: null,
          receivedAt: null,
        },
      ]);

    const svc = new PurchaseService({ tenantId: 7, userId: 11 });
    const detail = await svc.getById(5);

    expect(detail.items).toHaveLength(1);
    expect(detail.items[0]).toMatchObject({
      skuId: 201,
      qtyOrdered: '3157.56',
      qtyReceived: '287.96',
      gapQty: '2869.60',
      amount: '15787.80',
    });
    expect(detail.items[0].deliveryHistory).toHaveLength(1);
    expect(detail.items[0].deliveryHistory?.[0]).toMatchObject({
      deliveryNo: 'DN-002',
      deliveryStatus: 'pending',
      qtyDelivered: '1287.96',
    });
  });

  it('derives received delivery status in purchase-order item history when receipt exists', async () => {
    mockAppDataSource.query
      .mockResolvedValueOnce([
        {
          id: 6,
          po_no: 'PO-003',
          supplier_id: 9,
          supplierName: '供应商C',
          status: 'partial_received',
          expected_date: '2026-03-20',
          total_amount: '6439.80',
          created_at: '2026-03-18 10:00:00',
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 71,
          skuId: 301,
          skuCode: 'RM-301',
          skuName: 'EPE珍珠棉',
          qtyOrdered: '1287.96',
          qtyReceived: '650',
          gapQty: '637.96',
          purchaseUnit: '卷',
          unitPrice: '5.00',
          amount: '6439.80',
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 311,
          deliveryNo: 'DN1774519770130660',
          deliveryDate: '2026-03-25',
          status: 'received',
          notes: null,
          totalDelivered: '1287.96',
          receiptId: 144,
          receiptNo: 'RC260326-00001',
          receiptStatus: 'confirmed',
          receivedAt: '2026-03-26 10:54:25',
        },
      ])
      .mockResolvedValueOnce([
        {
          skuId: 301,
          purchaseUnit: '卷',
          unitPrice: '5.00',
          deliveryId: 311,
          deliveryNo: 'DN1774519770130660',
          deliveryDate: '2026-03-25',
          deliveryStatus: 'received',
          qtyDelivered: '1287.96',
          receiptId: 144,
          receiptNo: 'RC260326-00001',
          receiptStatus: 'confirmed',
          qtyReceived: '650',
          receivedAt: '2026-03-26 10:54:25',
        },
      ]);

    const svc = new PurchaseService({ tenantId: 7, userId: 11 });
    const detail = await svc.getById(6);

    expect(String(mockAppDataSource.query.mock.calls[3][0])).toContain('LEFT JOIN incoming_inspection_records ir');
    expect(detail.items[0].deliveryHistory?.[0]).toMatchObject({
      deliveryNo: 'DN1774519770130660',
      deliveryStatus: 'received',
      receiptNo: 'RC260326-00001',
    });
  });
});
