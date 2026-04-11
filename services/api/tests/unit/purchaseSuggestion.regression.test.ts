import { AppDataSource } from '../../src/config/database';
import { PurchaseSuggestionService } from '../../src/modules/purchase/purchase-suggestion.service';
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

const mockAppDataSource = AppDataSource as unknown as {
  query: jest.Mock;
  transaction: jest.Mock;
};

describe('Purchase suggestion regressions', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    mockRedisDel.mockResolvedValue(1);
  });

  it('rejects duplicate suggestion ids in batch-to-po', async () => {
    const svc = new PurchaseSuggestionService({ tenantId: 7, userId: 11 });

    await expect(svc.batchCreatePOFromSuggestions([1, 1])).rejects.toThrow('ID 不允许重复');
    expect(mockAppDataSource.query).not.toHaveBeenCalled();
  });

  it('locks suggestion row before approving and rejects non-pending status', async () => {
    const manager = {
      query: jest
        .fn()
        .mockResolvedValueOnce([{ id: 1, status: 'pending' }])
        .mockResolvedValueOnce({ affectedRows: 1 }),
    };
    mockAppDataSource.transaction.mockImplementation(async (cb: any) => cb(manager));

    const svc = new PurchaseSuggestionService({ tenantId: 7, userId: 11 });
    await svc.approveSuggestion(1);

    expect(String(manager.query.mock.calls[0][0])).toContain('FOR UPDATE');
    expect(manager.query.mock.calls[0][1]).toEqual([1, 7]);
    expect(manager.query.mock.calls[1][1]).toEqual([11, 11, 1, 7]);
  });

  it('locks suggestion row before rejecting and blocks already approved suggestions', async () => {
    const manager = {
      query: jest.fn().mockResolvedValueOnce([{ id: 2, status: 'approved' }]),
    };
    mockAppDataSource.transaction.mockImplementation(async (cb: any) => cb(manager));

    const svc = new PurchaseSuggestionService({ tenantId: 7, userId: 11 });
    await expect(svc.rejectSuggestion(2, '无需采购')).rejects.toThrow('不允许驳回操作');

    expect(String(manager.query.mock.calls[0][0])).toContain('FOR UPDATE');
    expect(manager.query.mock.calls[0][1]).toEqual([2, 7]);
    expect(manager.query).toHaveBeenCalledTimes(1);
  });

  it('rejects missing suggestions instead of partially converting existing ones', async () => {
    const manager = {
      query: jest.fn().mockResolvedValueOnce([
        {
          id: 1,
          suggestion_no: 'SG-001',
          source: 'production_shortage',
          production_order_id: 9,
          sku_id: 101,
          suggested_supplier_id: 3,
          suggested_qty: '10',
          purchase_unit: 'kg',
          estimated_price: '8.00',
          estimated_amount: '80.00',
          shortage_qty: '10',
          reason: 'shortage',
          confidence: 'high',
          status: 'approved',
          approved_by: 88,
        },
      ]),
    };
    mockAppDataSource.transaction.mockImplementation(async (cb: any) => cb(manager));

    const svc = new PurchaseSuggestionService({ tenantId: 7, userId: 11 });

    await expect(svc.batchCreatePOFromSuggestions([1, 2])).rejects.toThrow('不存在或不属于当前租户');
    expect(String(manager.query.mock.calls[0][0])).toContain('FOR UPDATE');
    expect(manager.query.mock.calls[0][1]).toEqual([1, 2, 7]);
    expect(manager.query).toHaveBeenCalledTimes(1);
  });

  it('creates confirmed purchase orders when approved suggestions are converted', async () => {
    const manager = {
      query: jest
        .fn()
        .mockResolvedValueOnce([
          {
            id: 1,
            suggestion_no: 'SG-001',
            source: 'production_shortage',
            production_order_id: 9,
            production_operation_id: 7001,
            sku_id: 101,
            suggested_supplier_id: 3,
            suggested_qty: '10',
            purchase_unit: 'kg',
            estimated_price: '8.00',
            estimated_amount: '80.00',
            shortage_qty: '10',
            reason: 'shortage',
            confidence: 'high',
            status: 'approved',
            approved_by: 88,
          },
        ])
        .mockResolvedValueOnce({ insertId: 201 })
        .mockResolvedValueOnce({ insertId: 301 })
        .mockResolvedValueOnce({ affectedRows: 1 })
        .mockResolvedValueOnce({ affectedRows: 1 }),
    };
    mockAppDataSource.transaction.mockImplementation(async (cb: any) => cb(manager));
    jest.spyOn(generateNoModule, 'generateNo').mockResolvedValue('PO-250324-001');

    const svc = new PurchaseSuggestionService({ tenantId: 7, userId: 11 });
    await svc.batchCreatePOFromSuggestions([1]);

    expect(String(manager.query.mock.calls[0][0])).toContain('FOR UPDATE');
    expect(manager.query.mock.calls[1][1][3]).toBe('confirmed');
    const poItemInsertCall = manager.query.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO purchase_order_items'),
    );
    expect(poItemInsertCall?.[1]).toEqual(expect.arrayContaining([101, '10', 7001, 'kg', '8.00', '80.00']));
    expect(String(manager.query.mock.calls[4][0])).toContain(
      'qty_in_transit = qty_in_transit + VALUES(qty_in_transit)',
    );
    expect(manager.query.mock.calls[4][1]).toEqual([201, 7]);
    expect(mockRedisDel).toHaveBeenCalledWith('inventory:7:101');
  });

  it('locks selected suggestions before validation and blocks non-approved rows', async () => {
    const manager = {
      query: jest.fn().mockResolvedValueOnce([
        {
          id: 9,
          suggestion_no: 'SG-009',
          source: 'production_shortage',
          production_order_id: 19,
          sku_id: 201,
          suggested_supplier_id: 6,
          suggested_qty: '5',
          purchase_unit: 'kg',
          estimated_price: '10.00',
          estimated_amount: '50.00',
          shortage_qty: '5',
          reason: 'shortage',
          confidence: 'high',
          status: 'pending',
          approved_by: null,
        },
      ]),
    };
    mockAppDataSource.transaction.mockImplementation(async (cb: any) => cb(manager));

    const svc = new PurchaseSuggestionService({ tenantId: 7, userId: 11 });
    await expect(svc.batchCreatePOFromSuggestions([9])).rejects.toThrow(
      '未处于审批通过状态，无法转单：9',
    );

    expect(String(manager.query.mock.calls[0][0])).toContain('FOR UPDATE');
    expect(manager.query.mock.calls[0][1]).toEqual([9, 7]);
    expect(manager.query).toHaveBeenCalledTimes(1);
  });

  it('does not invalidate inventory cache when batch conversion transaction fails', async () => {
    const manager = {
      query: jest
        .fn()
        .mockResolvedValueOnce([
          {
            id: 11,
            suggestion_no: 'SG-011',
            source: 'production_shortage',
            production_order_id: 29,
            sku_id: 301,
            suggested_supplier_id: 8,
            suggested_qty: '6',
            purchase_unit: 'kg',
            estimated_price: '12.00',
            estimated_amount: '72.00',
            shortage_qty: '6',
            reason: 'shortage',
            confidence: 'high',
            status: 'approved',
            approved_by: 99,
          },
        ])
        .mockResolvedValueOnce({ insertId: 901 })
        .mockRejectedValueOnce(new Error('insert purchase item failed')),
    };
    mockAppDataSource.transaction.mockImplementation(async (cb: any) => cb(manager));
    jest.spyOn(generateNoModule, 'generateNo').mockResolvedValue('PO-260331-001');

    const svc = new PurchaseSuggestionService({ tenantId: 7, userId: 11 });
    await expect(svc.batchCreatePOFromSuggestions([11])).rejects.toThrow('insert purchase item failed');

    expect(String(manager.query.mock.calls[0][0])).toContain('FOR UPDATE');
    expect(mockRedisDel).not.toHaveBeenCalled();
  });

  it('does not invalidate inventory cache when batch conversion commit fails after in-transit sync', async () => {
    const manager = {
      query: jest
        .fn()
        .mockResolvedValueOnce([
          {
            id: 12,
            suggestion_no: 'SG-012',
            source: 'production_shortage',
            production_order_id: 30,
            sku_id: 302,
            suggested_supplier_id: 8,
            suggested_qty: '6',
            purchase_unit: 'kg',
            estimated_price: '12.00',
            estimated_amount: '72.00',
            shortage_qty: '6',
            reason: 'shortage',
            confidence: 'high',
            status: 'approved',
            approved_by: 99,
          },
        ])
        .mockResolvedValueOnce({ insertId: 902 })
        .mockResolvedValueOnce({ insertId: 903 })
        .mockResolvedValueOnce({ affectedRows: 1 })
        .mockResolvedValueOnce({ affectedRows: 1 }),
    };
    mockAppDataSource.transaction.mockImplementation(async (cb: any) => {
      await cb(manager);
      throw new Error('batch conversion commit failed');
    });
    jest.spyOn(generateNoModule, 'generateNo').mockResolvedValue('PO-260331-002');

    const svc = new PurchaseSuggestionService({ tenantId: 7, userId: 11 });
    await expect(svc.batchCreatePOFromSuggestions([12])).rejects.toThrow('batch conversion commit failed');

    const inTransitCall = manager.query.mock.calls.find(([sql]) =>
      String(sql).includes('qty_in_transit = qty_in_transit + VALUES(qty_in_transit)'),
    );
    expect(inTransitCall?.[1]).toEqual([902, 7]);
    expect(mockRedisDel).not.toHaveBeenCalled();
  });
});
