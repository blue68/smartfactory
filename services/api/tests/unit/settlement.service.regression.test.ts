import { AppDataSource } from '../../src/config/database';
import { SettlementService } from '../../src/modules/settlement/settlement.service';
import * as generateNoModule from '../../src/shared/generateNo';

jest.mock('../../src/config/database', () => ({
  AppDataSource: {
    query: jest.fn(),
    transaction: jest.fn(),
  },
}));

const mockAppDataSource = AppDataSource as unknown as {
  query: jest.Mock;
  transaction: jest.Mock;
};

describe('Settlement service regressions', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('locks sales order row before creating settlement and prevents duplicate creation race', async () => {
    const manager = {
      query: jest
        .fn()
        .mockResolvedValueOnce([
          { id: 8, order_no: 'SO-8', customer_id: 3, total_amount: '1000.00', status: 'shipped' },
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ insertId: 71 }]),
    };
    mockAppDataSource.transaction.mockImplementation(async (cb: any) => cb(manager));
    jest.spyOn(generateNoModule, 'generateNo').mockResolvedValue('ST-71');
    mockAppDataSource.query.mockResolvedValueOnce([
      {
        id: 71,
        settlement_no: 'ST-71',
        customer_id: 3,
        customer_name: '华东客户',
        order_id: 8,
        order_no: 'SO-8',
        total_amount: '1000.00',
        status: 'draft',
        due_date: null,
        confirmed_by: null,
        confirmed_at: null,
        paid_at: null,
        notes: null,
        created_by: 100,
        created_at: '2026-03-31 09:00:00',
        updated_at: '2026-03-31 09:00:00',
      },
    ]);

    const svc = new SettlementService({ tenantId: 9, userId: 100 });
    const result = await svc.createSettlement({ orderId: 8, notes: '首单' });

    const orderLockCall = (manager.query.mock.calls as unknown[][]).find((call) =>
      String(call[0]).includes('FROM sales_orders') && String(call[0]).includes('FOR UPDATE'),
    );
    expect(orderLockCall?.[1]).toEqual([8, 9]);
    expect(manager.query.mock.calls[2][1]).toEqual([9, 'ST-71', 3, 8, '1000.00', '首单', 100, 100]);
    expect(result.id).toBe(71);
  });

  it('locks sales order row before duplicate settlement check and rejects existing active settlement', async () => {
    const manager = {
      query: jest
        .fn()
        .mockResolvedValueOnce([
          { id: 8, order_no: 'SO-8', customer_id: 3, total_amount: '1000.00', status: 'shipped' },
        ])
        .mockResolvedValueOnce([{ id: 71 }]),
    };
    mockAppDataSource.transaction.mockImplementation(async (cb: any) => cb(manager));

    const svc = new SettlementService({ tenantId: 9, userId: 100 });
    await expect(
      svc.createSettlement({ orderId: 8 }),
    ).rejects.toThrow('该订单已存在有效结算单，请勿重复创建');

    const orderLockCall = (manager.query.mock.calls as unknown[][]).find((call) =>
      String(call[0]).includes('FROM sales_orders') && String(call[0]).includes('FOR UPDATE'),
    );
    expect(orderLockCall?.[1]).toEqual([8, 9]);
    expect(manager.query).toHaveBeenCalledTimes(2);
  });

  it('allows creating settlement for partial_shipped sales order', async () => {
    const manager = {
      query: jest
        .fn()
        .mockResolvedValueOnce([
          { id: 9, order_no: 'SO-9', customer_id: 4, total_amount: '800.00', status: 'partial_shipped' },
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ insertId: 72 }]),
    };
    mockAppDataSource.transaction.mockImplementation(async (cb: any) => cb(manager));
    jest.spyOn(generateNoModule, 'generateNo').mockResolvedValue('ST-72');
    mockAppDataSource.query.mockResolvedValueOnce([
      {
        id: 72,
        settlement_no: 'ST-72',
        customer_id: 4,
        customer_name: '华南客户',
        order_id: 9,
        order_no: 'SO-9',
        total_amount: '800.00',
        status: 'draft',
        due_date: null,
        confirmed_by: null,
        confirmed_at: null,
        paid_at: null,
        notes: null,
        created_by: 100,
        created_at: '2026-03-31 11:00:00',
        updated_at: '2026-03-31 11:00:00',
      },
    ]);

    const svc = new SettlementService({ tenantId: 9, userId: 100 });
    const result = await svc.createSettlement({ orderId: 9 });

    expect(result.orderId).toBe(9);
    expect(result.status).toBe('draft');
  });

  it('locks settlement row before confirming and updates draft to confirmed', async () => {
    const manager = {
      query: jest
        .fn()
        .mockResolvedValueOnce([{ id: 21, status: 'draft' }])
        .mockResolvedValueOnce({ affectedRows: 1 }),
    };
    mockAppDataSource.transaction.mockImplementation(async (cb: any) => cb(manager));
    mockAppDataSource.query.mockResolvedValueOnce([
      {
        id: 21,
        settlement_no: 'ST-21',
        customer_id: 3,
        customer_name: '华东客户',
        order_id: 8,
        order_no: 'SO-8',
        total_amount: '1000.00',
        status: 'confirmed',
        due_date: null,
        confirmed_by: 100,
        confirmed_at: '2026-03-31 10:00:00',
        paid_at: null,
        notes: null,
        created_by: 100,
        created_at: '2026-03-31 09:00:00',
        updated_at: '2026-03-31 10:00:00',
      },
    ]);

    const svc = new SettlementService({ tenantId: 9, userId: 100 });
    const result = await svc.confirmSettlement(21);

    expect(String(manager.query.mock.calls[0][0])).toContain('FOR UPDATE');
    expect(manager.query.mock.calls[0][1]).toEqual([21, 9]);
    expect(manager.query.mock.calls[1][1]).toEqual([100, 100, 21, 9]);
    expect(result.status).toBe('confirmed');
  });

  it('locks settlement row before paying and blocks non-confirmed status', async () => {
    const manager = {
      query: jest.fn().mockResolvedValueOnce([{ id: 22, status: 'cancelled' }]),
    };
    mockAppDataSource.transaction.mockImplementation(async (cb: any) => cb(manager));

    const svc = new SettlementService({ tenantId: 9, userId: 100 });
    await expect(svc.paySettlement(22)).rejects.toThrow('只有已确认的结算单才能标记付款');

    expect(String(manager.query.mock.calls[0][0])).toContain('FOR UPDATE');
    expect(manager.query.mock.calls[0][1]).toEqual([22, 9]);
    expect(manager.query).toHaveBeenCalledTimes(1);
  });

  it('locks settlement row before cancelling and blocks paid status', async () => {
    const manager = {
      query: jest.fn().mockResolvedValueOnce([{ id: 23, status: 'paid' }]),
    };
    mockAppDataSource.transaction.mockImplementation(async (cb: any) => cb(manager));

    const svc = new SettlementService({ tenantId: 9, userId: 100 });
    await expect(svc.cancelSettlement(23)).rejects.toThrow('已付款的结算单无法取消');

    expect(String(manager.query.mock.calls[0][0])).toContain('FOR UPDATE');
    expect(manager.query.mock.calls[0][1]).toEqual([23, 9]);
    expect(manager.query).toHaveBeenCalledTimes(1);
  });
});
