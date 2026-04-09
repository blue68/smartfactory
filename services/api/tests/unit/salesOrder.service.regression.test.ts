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

  it('closes draft orders without touching approval_notes when the legacy column is absent', async () => {
    mockAppDataSource.getRepository.mockReturnValue({
      findOne: jest.fn().mockResolvedValue({
        id: 41,
        tenantId: 9999,
        orderNo: 'SO-LEGACY-001',
        status: 'draft',
      }),
    } as any);

    mockAppDataSource.query
      .mockResolvedValueOnce([{ cnt: 0 }])
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce({ insertId: 1 });

    const svc = new SalesOrderService({ tenantId: 9999, userId: 99001 });

    await expect(svc.close(41, '客户取消，关闭草稿订单')).resolves.toBeUndefined();

    expect(String(mockAppDataSource.query.mock.calls[0][0])).toContain('information_schema.columns');
    expect(String(mockAppDataSource.query.mock.calls[1][0])).toContain("SET status = ?, updated_by = ?");
    expect(String(mockAppDataSource.query.mock.calls[1][0])).not.toContain('approval_notes');
    expect(mockAppDataSource.query.mock.calls[1][1]).toEqual(['closed', 99001, 41, 9999]);
  });
});
