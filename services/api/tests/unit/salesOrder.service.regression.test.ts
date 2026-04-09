import { AppDataSource } from '../../src/config/database';
import { SalesOrderService } from '../../src/modules/sales-order/salesOrder.service';

jest.mock('../../src/config/database', () => ({
  AppDataSource: {
    query: jest.fn(),
    getRepository: jest.fn(),
    transaction: jest.fn(),
  },
}));

jest.mock('../../src/modules/notification/notification.service', () => ({
  NotificationService: jest.fn().mockImplementation(() => ({
    create: jest.fn(),
  })),
}));

jest.mock('../../src/modules/production/production-order.service', () => ({
  ProductionOrderService: jest.fn().mockImplementation(() => ({
    createFromSalesOrder: jest.fn(),
    invalidateInventorySnapshotCaches: jest.fn(),
  })),
}));

jest.mock('../../src/modules/sales/sales.service', () => ({
  SalesService: jest.fn().mockImplementation(() => ({
    confirmReceipt: jest.fn(),
  })),
}));

const mockAppDataSource = AppDataSource as jest.Mocked<typeof AppDataSource>;

describe('SalesOrderService regressions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (SalesOrderService as any).approvalNotesColumnSupported = null;
  });

  it('closes draft orders without reading or touching approval_notes when the legacy column is absent', async () => {
    mockAppDataSource.query
      .mockResolvedValueOnce([{ cnt: 0 }])
      .mockResolvedValueOnce([{
        id: 41,
        tenantId: 9999,
        orderNo: 'SO-LEGACY-001',
        status: 'draft',
        createdBy: 99001,
      }])
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce({ insertId: 1 });

    const svc = new SalesOrderService({ tenantId: 9999, userId: 99001 });

    await expect(svc.close(41, '客户取消，关闭草稿订单')).resolves.toBeUndefined();

    expect(String(mockAppDataSource.query.mock.calls[0][0])).toContain('information_schema.columns');
    expect(String(mockAppDataSource.query.mock.calls[1][0])).toContain('FROM sales_orders so');
    expect(String(mockAppDataSource.query.mock.calls[1][0])).not.toContain('approval_notes');
    expect(String(mockAppDataSource.query.mock.calls[2][0])).toContain("SET status = ?, updated_by = ?");
    expect(String(mockAppDataSource.query.mock.calls[2][0])).not.toContain('approval_notes');
    expect(mockAppDataSource.query.mock.calls[2][1]).toEqual(['closed', 99001, 41, 9999]);
  });

  it('loads order detail without selecting approval_notes when the legacy column is absent', async () => {
    mockAppDataSource.query
      .mockResolvedValueOnce([{ cnt: 0 }])
      .mockResolvedValueOnce([{
        id: 41,
        tenantId: 9999,
        orderNo: 'SO-LEGACY-001',
        customerId: 7,
        orderDate: '2026-04-10',
        deliveryDate: '2026-04-20',
        isUrgent: 0,
        status: 'draft',
        totalAmount: '100.00',
        approvalStatus: 'not_required',
        approvalNotes: null,
        customerName: '华东直营样板客户',
      }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const svc = new SalesOrderService({ tenantId: 9999, userId: 99001 });

    const detail = await svc.getById(41);

    expect(String(mockAppDataSource.query.mock.calls[1][0])).toContain('NULL AS approvalNotes');
    expect(String(mockAppDataSource.query.mock.calls[1][0])).not.toContain('so.approval_notes AS approvalNotes');
    expect(detail).toMatchObject({
      id: 41,
      orderNo: 'SO-LEGACY-001',
      status: 'draft',
      approvalNotes: null,
    });
  });
});
