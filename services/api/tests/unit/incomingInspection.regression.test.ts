import { AppDataSource } from '../../src/config/database';
import { IncomingInspectionService } from '../../src/modules/incoming-inspection/incomingInspection.service';
import { MrpService } from '../../src/modules/mrp/mrp.service';
import * as generateNoModule from '../../src/shared/generateNo';

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

describe('Incoming inspection regressions', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    mockRedisDel.mockResolvedValue(1);
    (IncomingInspectionService as any).inventoryUpdatedByColumnSupported = true;
    (IncomingInspectionService as any).purchaseReceiptDeliveryColumn = 'delivery_note_id';
    (IncomingInspectionService as any).purchaseReceiptItemsTableSupported = true;
    (IncomingInspectionService as any).purchaseReceiptTotalAmountColumnSupported = true;
    (IncomingInspectionService as any).purchaseOrderItemControlColumnsSupported = null;
    (IncomingInspectionService as any).purchaseReceiptItemControlColumnsSupported = null;
    (IncomingInspectionService as any).inventoryTransactionQtyChangeColumnSupported = true;
    (IncomingInspectionService as any).inventoryTransactionBusinessClassColumnSupported = false;
    (IncomingInspectionService as any).returnOrderItemUpdatedBySupported = true;
    (IncomingInspectionService as any).deliveryReceivedStatusSupported = true;
    (IncomingInspectionService as any).deliveryNoteItemPoItemSupported = true;
    (IncomingInspectionService as any).deliveryNoteItemDyeLotSupported = false;
    (IncomingInspectionService as any).incomingInspectionItemDyeLotSupported = false;
    (IncomingInspectionService as any).purchaseReceiptItemDyeLotSupported = false;
    (IncomingInspectionService as any).incomingInspectionItemAcceptedStockQtySupported = true;
  });

  it('decrements qty_in_transit on receipt and triggers shortage reevaluation', async () => {
    const manager = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes('SELECT production_operation_id') && sql.includes('FROM purchase_order_items')) {
          return [{ production_operation_id: 7001 }];
        }
        if (sql.includes('SELECT id, status FROM purchase_orders')) {
          return [{ id: 100, status: 'confirmed' }];
        }
        if (sql.includes('FROM production_operations op') && sql.includes("op.execution_mode = 'outsource'")) {
          return [{ plannedQty: '20', receivedQty: '12' }];
        }
        if (sql.includes('INSERT INTO purchase_receipts')) return { insertId: 501 };
        if (sql.includes('UPDATE delivery_notes')) return { affectedRows: 1 };
        if (sql.includes('SELECT stock_unit FROM skus')) return [{ stock_unit: 'g' }];
        if (sql.includes('FROM sku_unit_conversions')) {
          return [{ fromUnit: 'kg', toUnit: 'g', conversionRate: '2' }];
        }
        if (sql.includes('UPDATE production_operations')) return { affectedRows: 1 };
        if (sql.includes('INSERT INTO purchase_receipt_items')) return { insertId: 601 };
        if (sql.includes('INSERT INTO inventory_transactions')) return { insertId: 701 };
        if (/INSERT INTO inventory\s*\(/.test(sql)) return { affectedRows: 1 };
        if (sql.includes('INSERT INTO inventory_daily_snapshots')) return { affectedRows: 1 };
        if (sql.includes('DELETE ids') && sql.includes('FROM inventory_daily_snapshots ids')) return { affectedRows: 0 };
        if (sql.includes('UPDATE purchase_order_items')) return { affectedRows: 1 };
        if (sql.includes('SUM(COALESCE(qty_ordered, 0)) AS total_ordered')) {
          return [{ total_ordered: '20', total_received: '12' }];
        }
        if (sql.includes('UPDATE purchase_orders')) return { affectedRows: 1 };
        if (sql.includes('UPDATE incoming_inspection_records')) return { affectedRows: 1 };
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
    };

    const generateNoSpy = jest
      .spyOn(generateNoModule, 'generateNo')
      .mockResolvedValue('RC250324-00001');
    const reevaluateSpy = jest
      .spyOn(MrpService.prototype, 'reevaluateAfterReceipt')
      .mockResolvedValue({ affectedOrderIds: [11], updatedRequirements: 2 });

    const svc = new IncomingInspectionService({ tenantId: 7, userId: 11 });
    await (svc as any).handlePassedItems(
      manager,
      10,
      { po_id: 100, delivery_note_id: 200 },
      [
        {
          sku_id: 301,
          qty_passed: '12',
          unit_price: '8.50',
          purchase_unit: 'kg',
          po_item_id: 901,
        },
      ],
    );

    const inventoryUpsertCall = manager.query.mock.calls.find(([sql]) =>
      /INSERT INTO inventory\s*\(/.test(String(sql)),
    ) as unknown[] | undefined;
    expect(String(inventoryUpsertCall?.[0])).toContain('qty_in_transit = GREATEST(qty_in_transit - VALUES(qty_on_hand), 0)');
    expect(inventoryUpsertCall?.[1]).toEqual([
      7,
      301,
      1,
      1,
      'incoming_inspection:submit',
      '24.0000',
      11,
    ]);
    const inventoryTxCall = manager.query.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO inventory_transactions'),
    ) as unknown[] | undefined;
    expect(inventoryTxCall?.[1]).toEqual([
      7,
      301,
      'PURCHASE_IN',
      1,
      1,
      '24.0000',
      'purchase_receipt',
      501,
      'RC250324-00001',
      'incoming_inspection:submit',
      '质检入库 IQC#10',
      null,
      11,
      11,
    ]);
    const snapshotCall = manager.query.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO inventory_daily_snapshots'),
    ) as unknown[] | undefined;
    expect(snapshotCall?.[1]).toEqual([7, 301]);
    const deliveryReceiptUpdateCall = manager.query.mock.calls.find(([sql]) =>
      String(sql).includes('UPDATE delivery_notes') && String(sql).includes('SET receipt_id = ?, status = ?, updated_by = ?'),
    ) as unknown[] | undefined;
    expect(deliveryReceiptUpdateCall?.[1]).toEqual([501, 'received', 11, 200, 7]);
    const poStatusUpdateCall = manager.query.mock.calls.find(([sql]) =>
      String(sql).includes('UPDATE purchase_orders'),
    ) as unknown[] | undefined;
    expect(poStatusUpdateCall?.[1]).toEqual(['partial_received', 11, 100, 7]);
    const operationProgressUpdateCall = manager.query.mock.calls.find(([sql]) =>
      String(sql).includes('UPDATE production_operations'),
    ) as unknown[] | undefined;
    expect(operationProgressUpdateCall?.[1]).toEqual(['12.0000', 'in_progress', 11, 7001, 7]);
    expect(reevaluateSpy).toHaveBeenCalledWith(301, manager);
    expect((manager as any).__inventorySnapshotSkuIds).toEqual(new Set([301]));
    expect(mockRedisDel).not.toHaveBeenCalled();
    expect(generateNoSpy).toHaveBeenCalledWith('receipt', 7);
  });

  it('rejects receipt creation when the purchase order has already been cancelled', async () => {
    const manager = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes('SELECT production_operation_id') && sql.includes('FROM purchase_order_items')) {
          return [{ production_operation_id: null }];
        }
        if (sql.includes('SELECT id, status FROM purchase_orders')) {
          return [{ id: 100, status: 'cancelled' }];
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
    };

    const svc = new IncomingInspectionService({ tenantId: 7, userId: 11 });
    await expect(
      (svc as any).handlePassedItems(
        manager,
        10,
        { po_id: 100, delivery_note_id: 200 },
        [
          {
            sku_id: 301,
            qty_passed: '12',
            unit_price: '8.50',
            purchase_unit: 'kg',
            po_item_id: 901,
          },
        ],
      ),
    ).rejects.toThrow('仅 confirmed / partial_received 可操作');

    expect(String(manager.query.mock.calls[0][0])).toContain('FOR UPDATE');
    expect(manager.query).toHaveBeenCalledTimes(1);
  });

  it('requires measured meter quantity before submitting roll-to-meter fabric receipts', async () => {
    const manager = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes('SELECT production_operation_id') && sql.includes('FROM purchase_order_items')) {
          return [{ production_operation_id: null }];
        }
        if (sql.includes('SELECT id, status FROM purchase_orders')) {
          return [{ id: 100, status: 'confirmed' }];
        }
        if (sql.includes('INSERT INTO purchase_receipts')) return { insertId: 551 };
        if (sql.includes('UPDATE delivery_notes')) return { affectedRows: 1 };
        if (sql.includes('SELECT stock_unit FROM skus')) return [{ stock_unit: 'm' }];
        if (sql.includes('FROM sku_unit_conversions')) {
          return [{ fromUnit: '卷', toUnit: '米', conversionRate: '100.000000' }];
        }
        if (sql.includes('INSERT INTO purchase_receipt_items')) return { insertId: 651 };
        if (sql.includes('INSERT INTO inventory_transactions')) return { insertId: 751 };
        if (/INSERT INTO inventory\s*\(/.test(sql)) return { affectedRows: 1 };
        if (sql.includes('INSERT INTO inventory_daily_snapshots')) return { affectedRows: 1 };
        if (sql.includes('DELETE ids') && sql.includes('FROM inventory_daily_snapshots ids')) return { affectedRows: 0 };
        if (sql.includes('UPDATE purchase_order_items')) return { affectedRows: 1 };
        if (sql.includes('SUM(COALESCE(qty_ordered, 0)) AS total_ordered')) {
          return [{ total_ordered: '10', total_received: '1' }];
        }
        if (sql.includes('UPDATE incoming_inspection_records') && sql.includes('receipt_triggered = 1')) {
          return { affectedRows: 1 };
        }
        if (sql.includes('UPDATE purchase_orders')) return { affectedRows: 1 };
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
    };

    const generateNoSpy = jest
      .spyOn(generateNoModule, 'generateNo')
      .mockResolvedValue('RC250324-00003');
    const reevaluateSpy = jest
      .spyOn(MrpService.prototype, 'reevaluateAfterReceipt')
      .mockResolvedValue({ affectedOrderIds: [18], updatedRequirements: 1 });

    const svc = new IncomingInspectionService({ tenantId: 7, userId: 11 });
    await expect((svc as any).handlePassedItems(
      manager,
      12,
      { po_id: 100, delivery_note_id: 200 },
      [
        {
          sku_id: 302,
          qty_passed: '1',
          unit_price: '20.00',
          purchase_unit: '卷',
          po_item_id: 903,
        },
      ],
    )).rejects.toThrow('需要填写实际米数');
    expect(reevaluateSpy).not.toHaveBeenCalled();
    expect(generateNoSpy).toHaveBeenCalledWith('receipt', 7);
  });

  it('uses accepted stock quantity override for roll-to-meter fabric receipts', async () => {
    const manager = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes('SELECT production_operation_id') && sql.includes('FROM purchase_order_items')) {
          return [{ production_operation_id: null }];
        }
        if (sql.includes('SELECT id, status FROM purchase_orders')) {
          return [{ id: 100, status: 'confirmed' }];
        }
        if (sql.includes('INSERT INTO purchase_receipts')) return { insertId: 561 };
        if (sql.includes('UPDATE delivery_notes')) return { affectedRows: 1 };
        if (sql.includes('SELECT stock_unit FROM skus')) return [{ stock_unit: 'm' }];
        if (sql.includes('INSERT INTO purchase_receipt_items')) return { insertId: 661 };
        if (sql.includes('INSERT INTO inventory_transactions')) return { insertId: 761 };
        if (/INSERT INTO inventory\s*\(/.test(sql)) return { affectedRows: 1 };
        if (sql.includes('INSERT INTO inventory_daily_snapshots')) return { affectedRows: 1 };
        if (sql.includes('DELETE ids') && sql.includes('FROM inventory_daily_snapshots ids')) return { affectedRows: 0 };
        if (sql.includes('UPDATE purchase_order_items')) return { affectedRows: 1 };
        if (sql.includes('SUM(COALESCE(qty_ordered, 0)) AS total_ordered')) {
          return [{ total_ordered: '10', total_received: '1' }];
        }
        if (sql.includes('UPDATE incoming_inspection_records') && sql.includes('receipt_triggered = 1')) {
          return { affectedRows: 1 };
        }
        if (sql.includes('UPDATE purchase_orders')) return { affectedRows: 1 };
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
    };

    const generateNoSpy = jest
      .spyOn(generateNoModule, 'generateNo')
      .mockResolvedValue('RC250324-00004');
    const reevaluateSpy = jest
      .spyOn(MrpService.prototype, 'reevaluateAfterReceipt')
      .mockResolvedValue({ affectedOrderIds: [19], updatedRequirements: 1 });

    const svc = new IncomingInspectionService({ tenantId: 7, userId: 11 });
    await (svc as any).handlePassedItems(
      manager,
      13,
      { po_id: 100, delivery_note_id: 200 },
      [
        {
          sku_id: 303,
          qty_passed: '1',
          accepted_stock_qty: '95.5000',
          unit_price: '20.00',
          purchase_unit: '卷',
          po_item_id: 904,
        },
      ],
    );

    const inventoryTxCall = manager.query.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO inventory_transactions'),
    ) as unknown[] | undefined;
    expect(inventoryTxCall?.[1]).toEqual([
      7,
      303,
      'PURCHASE_IN',
      1,
      1,
      '95.5000',
      'purchase_receipt',
      561,
      'RC250324-00004',
      'incoming_inspection:submit',
      '质检入库 IQC#13',
      null,
      11,
      11,
    ]);

    const inventoryUpsertCall = manager.query.mock.calls.find(([sql]) =>
      /INSERT INTO inventory\s*\(/.test(String(sql)),
    ) as unknown[] | undefined;
    expect(inventoryUpsertCall?.[1]).toEqual([
      7,
      303,
      1,
      1,
      'incoming_inspection:submit',
      '95.5000',
      11,
    ]);
    expect(reevaluateSpy).toHaveBeenCalledWith(303, manager);
    expect(generateNoSpy).toHaveBeenCalledWith('receipt', 7);
  });

  it('submits inspection through receipt creation without blocking on MRP reevaluation', async () => {
    const manager = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes('SELECT production_operation_id') && sql.includes('FROM purchase_order_items')) {
          return [{ production_operation_id: null }];
        }
        if (sql.includes('FROM incoming_inspection_records') && sql.includes('FOR UPDATE')) {
          return [{ id: 10, status: 'in_progress', receipt_triggered: 0, return_triggered: 0, po_id: 100, delivery_note_id: 200 }];
        }
        if (sql.includes('INSERT INTO purchase_receipts')) {
          return { insertId: 601 };
        }
        if (sql.includes('SELECT stock_unit FROM skus')) {
          return [{ stock_unit: 'kg' }];
        }
        if (sql.includes('SELECT id, status FROM purchase_orders')) {
          return [{ id: 100, status: 'confirmed' }];
        }
        if (sql.includes('SUM(COALESCE(qty_ordered, 0)) AS total_ordered')) {
          return [{ total_ordered: '20', total_received: '12' }];
        }
        return { affectedRows: 1, insertId: 1 };
      }),
    };

    (AppDataSource.query as jest.Mock)
      .mockResolvedValueOnce([{ id: 10 }])
      .mockResolvedValueOnce([
        {
          id: 1001,
          sku_id: 301,
          qty_passed: '5',
          qty_failed: '0',
          result: 'pass',
          disposition: 'accept',
          purchase_unit: 'kg',
          unit_price: '8.50',
          po_item_id: 901,
        },
        {
          id: 1002,
          sku_id: 301,
          qty_passed: '7',
          qty_failed: '0',
          result: 'pass',
          disposition: 'accept',
          purchase_unit: 'kg',
          unit_price: '8.50',
          po_item_id: 902,
        },
      ]);
    (AppDataSource.transaction as jest.Mock).mockImplementation(async (cb: any) => {
      const result = await cb(manager);
      expect(mockRedisDel).not.toHaveBeenCalled();
      return result;
    });

    const generateNoSpy = jest
      .spyOn(generateNoModule, 'generateNo')
      .mockResolvedValue('RC250324-00002');
    const reevaluateSpy = jest
      .spyOn(MrpService.prototype, 'reevaluateAfterReceipt')
      .mockResolvedValue({ affectedOrderIds: [11], updatedRequirements: 2 });

    const svc = new IncomingInspectionService({ tenantId: 7, userId: 11 });
    await svc.submit(10, { overallResult: 'pass', notes: '整单合格入库' });

    expect(generateNoSpy).toHaveBeenCalledWith('receipt', 7);
    expect(reevaluateSpy).not.toHaveBeenCalled();

    const receiptInsertCall = manager.query.mock.calls.find(([sql]: [string]) =>
      String(sql).includes('INSERT INTO purchase_receipts'),
    ) as unknown[] | undefined;
    expect(receiptInsertCall?.[1]).toEqual([
      7,
      'RC250324-00002',
      100,
      200,
      'confirmed',
      '102.00',
      null,
      11,
      11,
    ]);

    const inspectionStatusCall = manager.query.mock.calls.find(([sql]: [string]) =>
      String(sql).includes('SET status = ?') && String(sql).includes('overall_result = ?'),
    ) as unknown[] | undefined;
    expect(inspectionStatusCall?.[1]).toEqual(['passed', 'pass', '整单合格入库', 11, 10, 7]);

    const deliveryConfirmedCall = manager.query.mock.calls.find(([sql]: [string]) =>
      String(sql).includes('UPDATE delivery_notes') && String(sql).includes("status = 'confirmed'"),
    ) as unknown[] | undefined;
    expect(deliveryConfirmedCall?.[1]).toEqual([11, 200, 7]);

    const deliveryReceivedCall = manager.query.mock.calls.find(([sql]: [string]) =>
      String(sql).includes('UPDATE delivery_notes') && String(sql).includes('SET receipt_id = ?, status = ?, updated_by = ?'),
    ) as unknown[] | undefined;
    expect(deliveryReceivedCall?.[1]).toEqual([601, 'received', 11, 200, 7]);
    expect(mockRedisDel).toHaveBeenCalledTimes(1);
    expect(mockRedisDel).toHaveBeenCalledWith('inventory:7:301');
  });

  it('does not invalidate inventory cache when submit transaction fails', async () => {
    const manager = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes('SELECT production_operation_id') && sql.includes('FROM purchase_order_items')) {
          return [{ production_operation_id: null }];
        }
        if (sql.includes('FROM incoming_inspection_records') && sql.includes('FOR UPDATE')) {
          return [{ id: 10, status: 'in_progress', receipt_triggered: 0, return_triggered: 0, po_id: 100, delivery_note_id: 200 }];
        }
        if (sql.includes('UPDATE incoming_inspection_records')) {
          throw new Error('update inspection status failed');
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
    };

    (AppDataSource.query as jest.Mock)
      .mockResolvedValueOnce([{ id: 10 }])
      .mockResolvedValueOnce([
        {
          id: 1001,
          sku_id: 301,
          qty_passed: '5',
          qty_failed: '0',
          result: 'pass',
          disposition: 'accept',
          purchase_unit: 'kg',
          unit_price: '8.50',
          po_item_id: 901,
        },
      ]);
    (AppDataSource.transaction as jest.Mock).mockImplementation(async (cb: any) => cb(manager));

    const svc = new IncomingInspectionService({ tenantId: 7, userId: 11 });
    await expect(
      svc.submit(10, { overallResult: 'pass', notes: '事务失败回滚验证' }),
    ).rejects.toThrow('update inspection status failed');

    expect(mockRedisDel).not.toHaveBeenCalled();
  });

  it('does not invalidate inventory cache when submit fails after receipt inventory snapshot sync', async () => {
    let snapshotSynced = false;
    const manager = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes('SELECT production_operation_id') && sql.includes('FROM purchase_order_items')) {
          return [{ production_operation_id: null }];
        }
        if (sql.includes('FROM incoming_inspection_records') && sql.includes('FOR UPDATE')) {
          return [{ id: 10, status: 'in_progress', receipt_triggered: 0, return_triggered: 0, po_id: 100, delivery_note_id: 200 }];
        }
        if (sql.includes('UPDATE incoming_inspection_records') && sql.includes('overall_result = ?')) {
          return { affectedRows: 1 };
        }
        if (sql.includes("UPDATE delivery_notes") && sql.includes("status = 'confirmed'")) {
          return { affectedRows: 1 };
        }
        if (sql.includes('SELECT id, status FROM purchase_orders')) {
          return [{ id: 100, status: 'confirmed' }];
        }
        if (sql.includes('INSERT INTO purchase_receipts')) {
          return { insertId: 601 };
        }
        if (sql.includes('UPDATE delivery_notes') && sql.includes('SET receipt_id = ?, status = ?, updated_by = ?')) {
          return { affectedRows: 1 };
        }
        if (sql.includes('SELECT stock_unit FROM skus')) {
          return [{ stock_unit: 'kg' }];
        }
        if (sql.includes('INSERT INTO purchase_receipt_items')) {
          return { insertId: 701 };
        }
        if (sql.includes('INSERT INTO inventory_transactions')) {
          return { insertId: 801 };
        }
        if (/INSERT INTO inventory\s*\(/.test(sql)) {
          return { affectedRows: 1 };
        }
        if (sql.includes('INSERT INTO inventory_daily_snapshots')) {
          snapshotSynced = true;
          return { affectedRows: 1 };
        }
        if (sql.includes('DELETE ids') && sql.includes('FROM inventory_daily_snapshots ids')) return { affectedRows: 0 };
        if (sql.includes('UPDATE purchase_order_items') && sql.includes('qty_received = qty_received + ?')) {
          return { affectedRows: 1 };
        }
        if (sql.includes('SUM(COALESCE(qty_ordered, 0)) AS total_ordered')) {
          return [{ total_ordered: '20', total_received: '12' }];
        }
        if (sql.includes('UPDATE purchase_orders')) {
          return { affectedRows: 1 };
        }
        if (sql.includes('UPDATE incoming_inspection_records') && sql.includes('SET receipt_triggered = 1')) {
          return { affectedRows: 1 };
        }
        if (sql.includes('SELECT supplier_id FROM purchase_orders')) {
          return [{ supplier_id: 88 }];
        }
        if (sql.includes('INSERT INTO return_orders')) {
          return { insertId: 901 };
        }
        if (sql.includes('INSERT INTO return_order_items')) {
          throw new Error('insert return_order_items failed');
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
    };

    (AppDataSource.query as jest.Mock)
      .mockResolvedValueOnce([{ id: 10 }])
      .mockResolvedValueOnce([
        {
          id: 1001,
          sku_id: 301,
          qty_passed: '5',
          qty_failed: '0',
          result: 'pass',
          disposition: 'accept',
          purchase_unit: 'kg',
          unit_price: '8.50',
          po_item_id: 901,
        },
        {
          id: 1002,
          sku_id: 302,
          qty_passed: '0',
          qty_failed: '3',
          result: 'fail',
          disposition: 'return',
          purchase_unit: 'kg',
          unit_price: '6.20',
          po_item_id: 902,
        },
      ]);
    (AppDataSource.transaction as jest.Mock).mockImplementation(async (cb: any) => cb(manager));

    jest.spyOn(generateNoModule, 'generateNo').mockImplementation(async (type: string) => {
      if (type === 'receipt') return 'RC250324-00007';
      if (type === 'return_order') return 'RO250324-00001';
      return 'NO250324-00001';
    });
    jest
      .spyOn(MrpService.prototype, 'reevaluateAfterReceipt')
      .mockResolvedValue({ affectedOrderIds: [11], updatedRequirements: 2 });

    const svc = new IncomingInspectionService({ tenantId: 7, userId: 11 });
    await expect(
      svc.submit(10, { overallResult: 'conditional_pass', notes: '深回滚验证' }),
    ).rejects.toThrow('insert return_order_items failed');

    expect(snapshotSynced).toBe(true);
    expect(mockRedisDel).not.toHaveBeenCalled();
  });

  it('uses delivered quantity for receipt when full inspection passes with accept disposition', async () => {
    const manager = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes('SELECT production_operation_id') && sql.includes('FROM purchase_order_items')) {
          return [{ production_operation_id: null }];
        }
        if (sql.includes('INSERT INTO purchase_receipts')) return { insertId: 801 };
        if (sql.includes('UPDATE delivery_notes')) return { affectedRows: 1 };
        if (sql.includes('SELECT stock_unit FROM skus')) return [{ stock_unit: 'kg' }];
        if (sql.includes('INSERT INTO purchase_receipt_items')) return { insertId: 901 };
        if (sql.includes('INSERT INTO inventory_transactions')) return { insertId: 1001 };
        if (/INSERT INTO inventory\s*\(/.test(sql)) return { affectedRows: 1 };
        if (sql.includes('INSERT INTO inventory_daily_snapshots')) return { affectedRows: 1 };
        if (sql.includes('DELETE ids') && sql.includes('FROM inventory_daily_snapshots ids')) return { affectedRows: 0 };
        if (sql.includes('UPDATE purchase_order_items')) return { affectedRows: 1 };
        if (sql.includes('SELECT id, status FROM purchase_orders')) return [{ id: 100, status: 'confirmed' }];
        if (sql.includes('SUM(COALESCE(qty_ordered, 0)) AS total_ordered')) {
          return [{ total_ordered: '20', total_received: '12' }];
        }
        if (sql.includes('UPDATE purchase_orders')) return { affectedRows: 1 };
        if (sql.includes('UPDATE incoming_inspection_records')) return { affectedRows: 1 };
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
    };

    jest.spyOn(generateNoModule, 'generateNo').mockResolvedValue('RC250324-00003');
    jest
      .spyOn(MrpService.prototype, 'reevaluateAfterReceipt')
      .mockResolvedValue({ affectedOrderIds: [11], updatedRequirements: 2 });

    const svc = new IncomingInspectionService({ tenantId: 7, userId: 11 });
    await (svc as any).handlePassedItems(
      manager,
      10,
      { po_id: 100, delivery_note_id: 200 },
      [
        {
          sku_id: 301,
          qty_delivered: '100',
          qty_sampled: '100',
          qty_passed: '20',
          result: 'pass',
          disposition: 'accept',
          unit_price: '8.50',
          purchase_unit: 'kg',
          po_item_id: 901,
        },
      ],
    );

    const receiptInsertCall = manager.query.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO purchase_receipts'),
    ) as unknown[] | undefined;
    expect(receiptInsertCall?.[1]).toEqual([
      7,
      'RC250324-00003',
      100,
      200,
      'confirmed',
      '850.00',
      null,
      11,
      11,
    ]);

    const receiptItemCall = manager.query.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO purchase_receipt_items'),
    ) as unknown[] | undefined;
    expect(receiptItemCall?.[1]).toEqual([
      7,
      801,
      301,
      '100',
      'kg',
      '8.5',
      '850.00',
      11,
      11,
    ]);
  });

  it('keeps manual accepted quantity for sampled inspections', async () => {
    const manager = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes('SELECT production_operation_id') && sql.includes('FROM purchase_order_items')) {
          return [{ production_operation_id: null }];
        }
        if (sql.includes('INSERT INTO purchase_receipts')) return { insertId: 811 };
        if (sql.includes('UPDATE delivery_notes')) return { affectedRows: 1 };
        if (sql.includes('SELECT stock_unit FROM skus')) return [{ stock_unit: 'kg' }];
        if (sql.includes('INSERT INTO purchase_receipt_items')) return { insertId: 911 };
        if (sql.includes('INSERT INTO inventory_transactions')) return { insertId: 1011 };
        if (/INSERT INTO inventory\s*\(/.test(sql)) return { affectedRows: 1 };
        if (sql.includes('INSERT INTO inventory_daily_snapshots')) return { affectedRows: 1 };
        if (sql.includes('DELETE ids') && sql.includes('FROM inventory_daily_snapshots ids')) return { affectedRows: 0 };
        if (sql.includes('UPDATE purchase_order_items')) return { affectedRows: 1 };
        if (sql.includes('SELECT id, status FROM purchase_orders')) return [{ id: 100, status: 'confirmed' }];
        if (sql.includes('SUM(COALESCE(qty_ordered, 0)) AS total_ordered')) {
          return [{ total_ordered: '20', total_received: '12' }];
        }
        if (sql.includes('UPDATE purchase_orders')) return { affectedRows: 1 };
        if (sql.includes('UPDATE incoming_inspection_records')) return { affectedRows: 1 };
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
    };

    jest.spyOn(generateNoModule, 'generateNo').mockResolvedValue('RC250324-00004');
    jest
      .spyOn(MrpService.prototype, 'reevaluateAfterReceipt')
      .mockResolvedValue({ affectedOrderIds: [11], updatedRequirements: 2 });

    const svc = new IncomingInspectionService({ tenantId: 7, userId: 11 });
    await (svc as any).handlePassedItems(
      manager,
      10,
      { po_id: 100, delivery_note_id: 200 },
      [
        {
          sku_id: 301,
          qty_delivered: '100',
          qty_sampled: '20',
          qty_passed: '20',
          result: 'pass',
          disposition: 'accept',
          unit_price: '8.50',
          purchase_unit: 'kg',
          po_item_id: 901,
        },
      ],
    );

    const receiptItemCall = manager.query.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO purchase_receipt_items'),
    ) as unknown[] | undefined;
    expect(receiptItemCall?.[1]).toEqual([
      7,
      811,
      301,
      '20',
      'kg',
      '8.5',
      '170.00',
      11,
      11,
    ]);
  });

  it('creates inspection items by allocating duplicate sku deliveries across po items without duplication', async () => {
    (AppDataSource.query as jest.Mock)
      .mockResolvedValueOnce([{ id: 203, po_id: 14, status: 'pending' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { sku_id: 46, purchase_unit: '卷', unit_price: '5.00', qty_delivered: '1287.9600' },
      ])
      .mockResolvedValueOnce([
        { id: 27, sku_id: 46, purchase_unit: '卷', unit_price: '5.00', qty_open: '287.9600' },
        { id: 26, sku_id: 46, purchase_unit: '卷', unit_price: '5.00', qty_open: '2869.6000' },
      ])
      .mockResolvedValueOnce([]);

    const manager = {
      query: jest
        .fn()
        .mockResolvedValueOnce({ insertId: 182 })
        .mockResolvedValueOnce({ insertId: 1 })
        .mockResolvedValueOnce({ insertId: 2 })
        .mockResolvedValueOnce({ affectedRows: 1 }),
    };
    (AppDataSource.transaction as jest.Mock).mockImplementation(async (cb: any) => cb(manager));
    jest.spyOn(generateNoModule, 'generateNo').mockResolvedValue('IQC260326-00002');

    const svc = new IncomingInspectionService({ tenantId: 7, userId: 11 });
    await svc.create({
      poId: 14,
      deliveryNoteId: 203,
      inspectionDate: '2026-03-26',
      notes: '重复 SKU 分配回归',
    });

    const insertCalls = manager.query.mock.calls.filter(([sql]) =>
      String(sql).includes('INSERT INTO incoming_inspection_items'),
    );
    expect(insertCalls).toHaveLength(2);
    expect(insertCalls[0][1]).toEqual([7, 182, 46, 27, '287.9600', 11, 11]);
    expect(insertCalls[1][1]).toEqual([7, 182, 46, 26, '1000.0000', 11, 11]);
  });

  it('preserves linked po_item_id from delivery items when creating inspection items', async () => {
    (AppDataSource.query as jest.Mock)
      .mockResolvedValueOnce([{ id: 204, po_id: 14, status: 'pending' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { po_item_id: 27, sku_id: 46, purchase_unit: '卷', unit_price: '5.00', qty_delivered: '500.0000' },
        { po_item_id: 26, sku_id: 46, purchase_unit: '卷', unit_price: '5.00', qty_delivered: '869.6000' },
      ])
      .mockResolvedValueOnce([
        { id: 27, sku_id: 46, purchase_unit: '卷', unit_price: '5.00', qty_open: '0.0000' },
        { id: 26, sku_id: 46, purchase_unit: '卷', unit_price: '5.00', qty_open: '0.0000' },
      ])
      .mockResolvedValueOnce([]);

    const manager = {
      query: jest
        .fn()
        .mockResolvedValueOnce({ insertId: 184 })
        .mockResolvedValueOnce({ insertId: 1 })
        .mockResolvedValueOnce({ insertId: 2 })
        .mockResolvedValueOnce({ affectedRows: 1 }),
    };
    (AppDataSource.transaction as jest.Mock).mockImplementation(async (cb: any) => cb(manager));
    jest.spyOn(generateNoModule, 'generateNo').mockResolvedValue('IQC260326-00003');

    const svc = new IncomingInspectionService({ tenantId: 7, userId: 11 });
    await svc.create({
      poId: 14,
      deliveryNoteId: 204,
      inspectionDate: '2026-03-26',
      notes: '保留送货明细映射回归',
    });

    const insertCalls = manager.query.mock.calls.filter(([sql]) =>
      String(sql).includes('INSERT INTO incoming_inspection_items'),
    );
    expect(insertCalls).toHaveLength(2);
    expect(insertCalls[0][1]).toEqual([7, 184, 46, 27, '500.0000', 11, 11]);
    expect(insertCalls[1][1]).toEqual([7, 184, 46, 26, '869.6000', 11, 11]);
  });

  it('treats rejected quantity as still pending for old delivery schema without po_item_id', async () => {
    (IncomingInspectionService as any).deliveryNoteItemPoItemSupported = false;

    (AppDataSource.query as jest.Mock)
      .mockResolvedValueOnce([{ id: 205, po_id: 14, status: 'pending' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { sku_id: 46, purchase_unit: '卷', unit_price: '5.00', qty_delivered: '1369.6000' },
      ])
      .mockResolvedValueOnce([
        { id: 26, sku_id: 46, purchase_unit: '卷', unit_price: '5.00', qty_open: '1369.6000' },
        { id: 27, sku_id: 46, purchase_unit: '卷', unit_price: '5.00', qty_open: '0.0000' },
      ])
      .mockResolvedValueOnce([]);

    const manager = {
      query: jest
        .fn()
        .mockResolvedValueOnce({ insertId: 185 })
        .mockResolvedValueOnce({ insertId: 1 })
        .mockResolvedValueOnce({ affectedRows: 1 }),
    };
    (AppDataSource.transaction as jest.Mock).mockImplementation(async (cb: any) => cb(manager));
    jest.spyOn(generateNoModule, 'generateNo').mockResolvedValue('IQC260326-00004');

    const svc = new IncomingInspectionService({ tenantId: 7, userId: 11 });
    await svc.create({
      poId: 14,
      deliveryNoteId: 205,
      inspectionDate: '2026-03-26',
      notes: '旧 schema 退货补送回归',
    });

    const insertCalls = manager.query.mock.calls.filter(([sql]) =>
      String(sql).includes('INSERT INTO incoming_inspection_items'),
    );
    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0][1]).toEqual([7, 185, 46, 26, '1369.6000', 11, 11]);
  });

  it('rejects creating inspection for duplicate delivery note when prior deliveries already occupy full po quantity', async () => {
    (AppDataSource.query as jest.Mock)
      .mockResolvedValueOnce([{ id: 206, po_id: 14, status: 'pending' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { sku_id: 46, purchase_unit: '卷', unit_price: '5.00', qty_delivered: '400.0000' },
      ])
      .mockResolvedValueOnce([
        { id: 26, sku_id: 46, purchase_unit: '卷', unit_price: '5.00', qty_open: '400.0000' },
      ])
      .mockResolvedValueOnce([
        { sku_id: 46, qty_delivered: '400.0000' },
      ]);

    const svc = new IncomingInspectionService({ tenantId: 7, userId: 11 });

    await expect(
      svc.create({
        poId: 14,
        deliveryNoteId: 206,
        inspectionDate: '2026-03-27',
        notes: '重复送货单质检拦截回归',
      }),
    ).rejects.toThrow('当前送货单数量已超出采购订单剩余可质检数量，不能创建质检单');
  });

  it('carries dye lot number from delivery items into inspection seed items', async () => {
    (IncomingInspectionService as any).deliveryNoteItemDyeLotSupported = true;
    (IncomingInspectionService as any).incomingInspectionItemDyeLotSupported = true;

    (AppDataSource.query as jest.Mock)
      .mockResolvedValueOnce([{ id: 206, po_id: 14, status: 'pending' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { po_item_id: 26, sku_id: 46, has_dye_lot: 1, dye_lot_no: 'DY-20260327-A01', purchase_unit: '卷', unit_price: '5.00', qty_delivered: '400.0000' },
      ])
      .mockResolvedValueOnce([
        { id: 26, sku_id: 46, purchase_unit: '卷', unit_price: '5.00', qty_open: '400.0000' },
      ])
      .mockResolvedValueOnce([]);

    const manager = {
      query: jest
        .fn()
        .mockResolvedValueOnce({ insertId: 186 })
        .mockResolvedValueOnce({ insertId: 1 })
        .mockResolvedValueOnce({ affectedRows: 1 }),
    };
    (AppDataSource.transaction as jest.Mock).mockImplementation(async (cb: any) => cb(manager));
    jest.spyOn(generateNoModule, 'generateNo').mockResolvedValue('IQC260327-00005');

    const svc = new IncomingInspectionService({ tenantId: 7, userId: 11 });
    await svc.create({
      poId: 14,
      deliveryNoteId: 206,
      inspectionDate: '2026-03-27',
      notes: '面料缸号质检建单回归',
    });

    const insertCall = manager.query.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO incoming_inspection_items'),
    );
    expect(String(insertCall?.[0])).toContain('dye_lot_no');
    expect(insertCall?.[1]).toEqual([7, 186, 46, 26, 'DY-20260327-A01', '400.0000', 11, 11]);
  });

  it('writes dye lot inventory and receipt detail when passed fabric items are received', async () => {
    (IncomingInspectionService as any).purchaseReceiptItemDyeLotSupported = true;

    const manager = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes('SELECT production_operation_id') && sql.includes('FROM purchase_order_items')) {
          return [{ production_operation_id: null }];
        }
        if (sql.includes('INSERT INTO purchase_receipts')) return { insertId: 831 };
        if (sql.includes('UPDATE delivery_notes')) return { affectedRows: 1 };
        if (sql.includes('SELECT stock_unit FROM skus')) return [{ stock_unit: 'kg' }];
        if (sql.includes('INSERT INTO purchase_receipt_items')) return { insertId: 931 };
        if (sql.includes('INSERT INTO inventory_transactions')) return { insertId: 1031 };
        if (/INSERT INTO inventory\s*\(/.test(sql)) return { affectedRows: 1 };
        if (sql.includes('INSERT INTO inventory_daily_snapshots')) return { affectedRows: 1 };
        if (sql.includes('DELETE ids') && sql.includes('FROM inventory_daily_snapshots ids')) return { affectedRows: 0 };
        if (sql.includes('INSERT INTO inventory_dye_lots')) return { affectedRows: 1 };
        if (sql.includes('UPDATE purchase_order_items')) return { affectedRows: 1 };
        if (sql.includes('SELECT id, status FROM purchase_orders')) return [{ id: 100, status: 'confirmed' }];
        if (sql.includes('SUM(COALESCE(qty_ordered, 0)) AS total_ordered')) {
          return [{ total_ordered: '20', total_received: '12' }];
        }
        if (sql.includes('UPDATE purchase_orders')) return { affectedRows: 1 };
        if (sql.includes('UPDATE incoming_inspection_records')) return { affectedRows: 1 };
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
    };

    jest.spyOn(generateNoModule, 'generateNo').mockResolvedValue('RC250324-00006');
    jest
      .spyOn(MrpService.prototype, 'reevaluateAfterReceipt')
      .mockResolvedValue({ affectedOrderIds: [11], updatedRequirements: 2 });

    const svc = new IncomingInspectionService({ tenantId: 7, userId: 11 });
    await (svc as any).handlePassedItems(
      manager,
      10,
      { po_id: 100, delivery_note_id: 200 },
      [
        {
          sku_id: 301,
          has_dye_lot: 1,
          dye_lot_no: 'DY-20260327-B03',
          qty_delivered: '12',
          qty_sampled: '12',
          qty_passed: '12',
          result: 'pass',
          disposition: 'accept',
          unit_price: '8.50',
          purchase_unit: 'kg',
          po_item_id: 901,
        },
      ],
    );

    const receiptItemInsertCall = manager.query.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO purchase_receipt_items'),
    ) as unknown[] | undefined;
    expect(String(receiptItemInsertCall?.[0])).toContain('dye_lot_no');
    expect(receiptItemInsertCall?.[1]).toEqual([
      7, 831, 301, 'DY-20260327-B03', '12', 'kg', '8.5', '102.00', 11, 11,
    ]);

    const inventoryDyeLotCall = manager.query.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO inventory_dye_lots'),
    ) as unknown[] | undefined;
    expect(inventoryDyeLotCall?.[1]).toEqual([7, 301, 'DY-20260327-B03', '12.0000']);
  });

  it('routes direct-expense consumables through receipt items without writing inventory ledger', async () => {
    (IncomingInspectionService as any).purchaseOrderItemControlColumnsSupported = true;
    (IncomingInspectionService as any).purchaseReceiptItemControlColumnsSupported = true;

    const reevaluateSpy = jest
      .spyOn(MrpService.prototype, 'reevaluateAfterReceipt')
      .mockResolvedValue({ affectedOrderIds: [], updatedRequirements: 0 });

    const manager = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes('SELECT id, status FROM purchase_orders')) return [{ id: 100, status: 'confirmed' }];
        if (sql.includes('INSERT INTO purchase_receipts')) return { insertId: 841 };
        if (sql.includes('UPDATE delivery_notes')) return { affectedRows: 1 };
        if (sql.includes('SELECT stock_unit FROM skus')) return [{ stock_unit: 'pcs' }];
        if (
          sql.includes('SELECT business_class, receipt_mode, requires_acceptance, request_department_id, budget_code')
          && sql.includes('FROM purchase_order_items')
        ) {
          return [{
            business_class: 'consumable',
            receipt_mode: 'direct_expense',
            requires_acceptance: 0,
            request_department_id: 25,
            budget_code: 'BD-001',
          }];
        }
        if (sql.includes('INSERT INTO purchase_receipt_items')) return { insertId: 941 };
        if (sql.includes('UPDATE inventory') && sql.includes('qty_in_transit = GREATEST(qty_in_transit - ?, 0)')) {
          return { affectedRows: 1 };
        }
        if (
          sql.includes('SELECT production_operation_id')
          && sql.includes('FROM purchase_order_items')
        ) {
          return [{ production_operation_id: null }];
        }
        if (sql.includes('UPDATE purchase_order_items')) return { affectedRows: 1 };
        if (sql.includes('SUM(COALESCE(qty_ordered, 0)) AS total_ordered')) {
          return [{ total_ordered: '20', total_received: '12' }];
        }
        if (sql.includes('UPDATE purchase_orders')) return { affectedRows: 1 };
        if (sql.includes('UPDATE incoming_inspection_records')) return { affectedRows: 1 };
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
    };

    jest.spyOn(generateNoModule, 'generateNo').mockResolvedValue('RC260413-00001');

    const svc = new IncomingInspectionService({ tenantId: 7, userId: 11 });
    await (svc as any).handlePassedItems(
      manager,
      10,
      { po_id: 100, delivery_note_id: 200 },
      [
        {
          sku_id: 401,
          qty_delivered: '5',
          qty_sampled: '5',
          qty_passed: '5',
          result: 'pass',
          disposition: 'accept',
          unit_price: '20.00',
          purchase_unit: 'pcs',
          po_item_id: 1201,
        },
      ],
    );

    const receiptItemCall = manager.query.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO purchase_receipt_items'),
    ) as unknown[] | undefined;
    expect(receiptItemCall?.[1]).toEqual([
      7,
      841,
      401,
      1201,
      'consumable',
      'direct_expense',
      0,
      25,
      'BD-001',
      '5',
      'pcs',
      '20',
      '100.00',
      11,
      11,
    ]);

    const inventoryUpdateCall = manager.query.mock.calls.find(([sql]) =>
      String(sql).includes('UPDATE inventory') && String(sql).includes('qty_in_transit = GREATEST(qty_in_transit - ?, 0)'),
    ) as unknown[] | undefined;
    expect(inventoryUpdateCall?.[1]).toEqual(['5.0000', 7, 401]);
    expect(
      manager.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO inventory_transactions')),
    ).toBe(false);
    expect(
      manager.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO inventory_daily_snapshots')),
    ).toBe(false);
    expect(reevaluateSpy).not.toHaveBeenCalled();
  });

  it('routes fixed assets through capitalization receipt items without inventory side effects', async () => {
    (IncomingInspectionService as any).purchaseOrderItemControlColumnsSupported = true;
    (IncomingInspectionService as any).purchaseReceiptItemControlColumnsSupported = true;

    const reevaluateSpy = jest
      .spyOn(MrpService.prototype, 'reevaluateAfterReceipt')
      .mockResolvedValue({ affectedOrderIds: [], updatedRequirements: 0 });

    const manager = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes('SELECT id, status FROM purchase_orders')) return [{ id: 100, status: 'confirmed' }];
        if (sql.includes('INSERT INTO purchase_receipts')) return { insertId: 851 };
        if (sql.includes('UPDATE delivery_notes')) return { affectedRows: 1 };
        if (sql.includes('SELECT stock_unit FROM skus')) return [{ stock_unit: '台' }];
        if (
          sql.includes('SELECT business_class, receipt_mode, requires_acceptance, request_department_id, budget_code')
          && sql.includes('FROM purchase_order_items')
        ) {
          return [{
            business_class: 'fixed_asset',
            receipt_mode: 'asset_capitalization',
            requires_acceptance: 1,
            request_department_id: 36,
            budget_code: 'CAPEX-01',
          }];
        }
        if (sql.includes('INSERT INTO purchase_receipt_items')) return { insertId: 951 };
        if (sql.includes('UPDATE inventory') && sql.includes('qty_in_transit = GREATEST(qty_in_transit - ?, 0)')) {
          return { affectedRows: 1 };
        }
        if (
          sql.includes('SELECT production_operation_id')
          && sql.includes('FROM purchase_order_items')
        ) {
          return [{ production_operation_id: null }];
        }
        if (sql.includes('UPDATE purchase_order_items')) return { affectedRows: 1 };
        if (sql.includes('SUM(COALESCE(qty_ordered, 0)) AS total_ordered')) {
          return [{ total_ordered: '3', total_received: '1' }];
        }
        if (sql.includes('UPDATE purchase_orders')) return { affectedRows: 1 };
        if (sql.includes('UPDATE incoming_inspection_records')) return { affectedRows: 1 };
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
    };

    jest.spyOn(generateNoModule, 'generateNo').mockResolvedValue('RC260413-00002');

    const svc = new IncomingInspectionService({ tenantId: 7, userId: 11 });
    await (svc as any).handlePassedItems(
      manager,
      11,
      { po_id: 100, delivery_note_id: 201 },
      [
        {
          sku_id: 501,
          qty_delivered: '1',
          qty_sampled: '1',
          qty_passed: '1',
          result: 'pass',
          disposition: 'accept',
          unit_price: '68000.00',
          purchase_unit: '台',
          po_item_id: 1301,
        },
      ],
    );

    const receiptItemCall = manager.query.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO purchase_receipt_items'),
    ) as unknown[] | undefined;
    expect(receiptItemCall?.[1]).toEqual([
      7,
      851,
      501,
      1301,
      'fixed_asset',
      'asset_capitalization',
      1,
      36,
      'CAPEX-01',
      '1',
      '台',
      '68000',
      '68000.00',
      11,
      11,
    ]);

    const inventoryUpdateCall = manager.query.mock.calls.find(([sql]) =>
      String(sql).includes('UPDATE inventory') && String(sql).includes('qty_in_transit = GREATEST(qty_in_transit - ?, 0)'),
    ) as unknown[] | undefined;
    expect(inventoryUpdateCall?.[1]).toEqual(['1.0000', 7, 501]);
    expect(
      manager.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO inventory_transactions')),
    ).toBe(false);
    expect(
      manager.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO inventory_daily_snapshots')),
    ).toBe(false);
    expect(reevaluateSpy).not.toHaveBeenCalled();
  });

  it('persists dye lot when updating editable inspection items', async () => {
    (IncomingInspectionService as any).incomingInspectionItemDyeLotSupported = true;

    const manager = {
      query: jest
        .fn()
        .mockResolvedValueOnce({ affectedRows: 1 })
        .mockResolvedValueOnce([{ qty_delivered: '400.0000' }])
        .mockResolvedValueOnce({ affectedRows: 1 }),
    };

    (AppDataSource.query as jest.Mock).mockResolvedValueOnce([{ id: 10, status: 'draft' }]);
    (AppDataSource.transaction as jest.Mock).mockImplementation(async (cb: any) => cb(manager));

    const svc = new IncomingInspectionService({ tenantId: 7, userId: 11 });
    await svc.updateItems(10, [
      {
        id: 1001,
        qtysampled: '50.0000',
        qtyPassed: '50.0000',
        qtyFailed: '0.0000',
        dyeLotNo: 'DY-20260327-C08',
        result: 'pass',
        disposition: 'accept',
        notes: '登记缸号',
      },
    ]);

    const updateCall = manager.query.mock.calls.find(([sql]) =>
      String(sql).includes('UPDATE incoming_inspection_items'),
    );
    expect(String(updateCall?.[0])).toContain('dye_lot_no = ?');
    expect(updateCall?.[1]).toEqual([
      '50.0000',
      '50.0000',
      '0.0000',
      null,
      'DY-20260327-C08',
      'pass',
      '[]',
      '[]',
      'accept',
      '登记缸号',
      11,
      1001,
      10,
      7,
    ]);
  });

  it('splits one editable fabric inspection row into multiple dye lot segments', async () => {
    (IncomingInspectionService as any).incomingInspectionItemDyeLotSupported = true;

    const manager = {
      query: jest
        .fn()
        .mockResolvedValueOnce({ affectedRows: 1 })
        .mockResolvedValueOnce([
          { id: 1001, sku_id: 301, po_item_id: 901, qty_delivered: '200.0000' },
        ])
        .mockResolvedValueOnce({ affectedRows: 1 })
        .mockResolvedValueOnce({ insertId: 1 })
        .mockResolvedValueOnce({ insertId: 2 }),
    };

    (AppDataSource.query as jest.Mock).mockResolvedValueOnce([{ id: 10, status: 'draft' }]);
    (AppDataSource.transaction as jest.Mock).mockImplementation(async (cb: any) => cb(manager));

    const svc = new IncomingInspectionService({ tenantId: 7, userId: 11 });
    await svc.updateItems(10, [
      {
        sourceItemIds: [1001],
        qtyDelivered: '120.0000',
        qtysampled: '20.0000',
        qtyPassed: '20.0000',
        qtyFailed: '0.0000',
        dyeLotNo: 'DY-20260327-D01',
        result: 'pass',
        disposition: 'accept',
        notes: '首缸',
      },
      {
        sourceItemIds: [1001],
        qtyDelivered: '80.0000',
        qtysampled: '20.0000',
        qtyPassed: '15.0000',
        qtyFailed: '5.0000',
        dyeLotNo: 'DY-20260327-D02',
        result: 'conditional_pass',
        disposition: 'accept',
        notes: '次缸',
      },
    ]);

    const deleteCall = manager.query.mock.calls.find(([sql]) =>
      String(sql).includes('DELETE FROM incoming_inspection_items'),
    );
    expect(deleteCall?.[1]).toEqual([10, 7, 1001]);

    const insertCalls = manager.query.mock.calls.filter(([sql]) =>
      String(sql).includes('INSERT INTO incoming_inspection_items'),
    );
    expect(insertCalls).toHaveLength(2);
    expect(insertCalls[0][1]).toEqual([
      7,
      10,
      301,
      901,
      'DY-20260327-D01',
      null,
      '120.0000',
      '20.0000',
      '20.0000',
      '0.0000',
      'pass',
      '[]',
      '[]',
      'accept',
      '首缸',
      11,
      11,
    ]);
    expect(insertCalls[1][1]).toEqual([
      7,
      10,
      301,
      901,
      'DY-20260327-D02',
      null,
      '80.0000',
      '20.0000',
      '15.0000',
      '5.0000',
      'conditional_pass',
      '[]',
      '[]',
      'accept',
      '次缸',
      11,
      11,
    ]);
  });

  it('falls back to confirmed delivery status after receipt when received enum is unsupported', async () => {
    (IncomingInspectionService as any).deliveryReceivedStatusSupported = false;

    const manager = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes('SELECT production_operation_id') && sql.includes('FROM purchase_order_items')) {
          return [{ production_operation_id: null }];
        }
        if (sql.includes('INSERT INTO purchase_receipts')) return { insertId: 821 };
        if (sql.includes('UPDATE delivery_notes')) return { affectedRows: 1 };
        if (sql.includes('SELECT stock_unit FROM skus')) return [{ stock_unit: 'kg' }];
        if (sql.includes('INSERT INTO purchase_receipt_items')) return { insertId: 921 };
        if (sql.includes('INSERT INTO inventory_transactions')) return { insertId: 1021 };
        if (/INSERT INTO inventory\s*\(/.test(sql)) return { affectedRows: 1 };
        if (sql.includes('INSERT INTO inventory_daily_snapshots')) return { affectedRows: 1 };
        if (sql.includes('DELETE ids') && sql.includes('FROM inventory_daily_snapshots ids')) return { affectedRows: 0 };
        if (sql.includes('UPDATE purchase_order_items')) return { affectedRows: 1 };
        if (sql.includes('SELECT id, status FROM purchase_orders')) return [{ id: 100, status: 'confirmed' }];
        if (sql.includes('SUM(COALESCE(qty_ordered, 0)) AS total_ordered')) {
          return [{ total_ordered: '20', total_received: '12' }];
        }
        if (sql.includes('UPDATE purchase_orders')) return { affectedRows: 1 };
        if (sql.includes('UPDATE incoming_inspection_records')) return { affectedRows: 1 };
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
    };

    jest.spyOn(generateNoModule, 'generateNo').mockResolvedValue('RC250324-00005');
    jest
      .spyOn(MrpService.prototype, 'reevaluateAfterReceipt')
      .mockResolvedValue({ affectedOrderIds: [11], updatedRequirements: 2 });

    const svc = new IncomingInspectionService({ tenantId: 7, userId: 11 });
    await (svc as any).handlePassedItems(
      manager,
      10,
      { po_id: 100, delivery_note_id: 200 },
      [
        {
          sku_id: 301,
          qty_delivered: '12',
          qty_sampled: '12',
          qty_passed: '12',
          result: 'pass',
          disposition: 'accept',
          unit_price: '8.50',
          purchase_unit: 'kg',
          po_item_id: 901,
        },
      ],
    );

    const deliveryReceiptUpdateCall = manager.query.mock.calls.find(([sql]) =>
      String(sql).includes('UPDATE delivery_notes') && String(sql).includes('SET receipt_id = ?, status = ?, updated_by = ?'),
    ) as unknown[] | undefined;
    expect(deliveryReceiptUpdateCall?.[1]).toEqual([821, 'confirmed', 11, 200, 7]);
  });
});
