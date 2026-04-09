jest.mock('../../src/config/database', () => ({
  AppDataSource: {
    query: jest.fn(),
  },
}));

import { AppDataSource } from '../../src/config/database';
import { InventoryService } from '../../src/modules/inventory/inventory.service';

const mockQuery = AppDataSource.query as jest.Mock;

describe('InventoryService.listTransactions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns paginated transaction traces with keyword/date filters', async () => {
    mockQuery
      .mockResolvedValueOnce([{
        id: 301,
        skuCode: 'SKU-301',
        skuName: '坯布 301',
        stockUnit: 'm',
      }])
      .mockResolvedValueOnce([{
        transactionId: 91,
        transactionNo: 'TX-91',
        transactionType: 'PRODUCTION_IN',
        direction: 'IN',
        qtyChange: '12.0000',
        createdAt: '2026-04-01 09:30:00',
        referenceType: 'production',
        referenceId: 66,
        referenceNo: 'WO-301',
        taskId: 88,
        workOrderNo: 'WO-301',
        processStepName: '裁剪',
        workerName: '张三',
        notes: '首工序入库',
      }])
      .mockResolvedValueOnce([{ total: '1' }]);

    const svc = new InventoryService({ tenantId: 1, userId: 9, roles: ['boss'] });
    const result = await svc.listTransactions(301, {
      page: 2,
      pageSize: 6,
      dateFrom: '2026-04-01',
      dateTo: '2026-04-02',
      keyword: 'WO-301',
    });

    expect(result).toEqual({
      skuId: 301,
      skuCode: 'SKU-301',
      skuName: '坯布 301',
      stockUnit: 'm',
      list: [{
        transactionId: 91,
        transactionNo: 'TX-91',
        transactionType: 'PRODUCTION_IN',
        direction: 'IN',
        qtyChange: '12.0000',
        createdAt: '2026-04-01 09:30:00',
        referenceType: 'production',
        referenceId: 66,
        referenceNo: 'WO-301',
        taskId: 88,
        workOrderNo: 'WO-301',
        processStepName: '裁剪',
        workerName: '张三',
        notes: '首工序入库',
      }],
      total: 1,
    });

    const listSql = mockQuery.mock.calls[1][0] as string;
    const listParams = mockQuery.mock.calls[1][1] as unknown[];
    const countSql = mockQuery.mock.calls[2][0] as string;

    expect(listSql).toContain('DATE(it.created_at) >= ?');
    expect(listSql).toContain('DATE(it.created_at) <= ?');
    expect(listSql).toContain('it.transaction_no LIKE ?');
    expect(listSql).toContain('LEFT JOIN task_material_transactions tmt');
    expect(countSql).toContain('COUNT(DISTINCT it.id) AS total');
    expect(listParams).toEqual([
      1,
      301,
      '2026-04-01',
      '2026-04-02',
      '%WO-301%',
      '%WO-301%',
      '%WO-301%',
      '%WO-301%',
      6,
      6,
    ]);
  });

  it('throws when sku does not exist', async () => {
    mockQuery.mockResolvedValueOnce([]);

    const svc = new InventoryService({ tenantId: 1, userId: 9, roles: ['boss'] });

    await expect(
      svc.listTransactions(999, {
        page: 1,
        pageSize: 6,
      }),
    ).rejects.toThrow('SKU 不存在');
  });

  it('applies warehouse_assigned filter to transaction traces', async () => {
    mockQuery
      .mockResolvedValueOnce([{ id: 9 }, { id: 11 }])
      .mockResolvedValueOnce([{
        id: 301,
        skuCode: 'SKU-301',
        skuName: '坯布 301',
        stockUnit: 'm',
      }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ total: '0' }]);

    const svc = new InventoryService({
      tenantId: 1,
      userId: 9,
      roles: ['warehouse'],
      permissionSnapshot: {
        version: 'test',
        scopeLevel: 'tenant',
        originTenantId: 1,
        contextTenantId: 1,
        menuCodes: [],
        actionCodes: [],
        featureFlags: [],
        dataScopes: [{ scopeType: 'warehouse_assigned', scopeValues: ['WH-A', 9] }],
      },
    });
    await svc.listTransactions(301, {
      page: 1,
      pageSize: 10,
    });

    const listSql = String(mockQuery.mock.calls[2]?.[0] ?? '');
    const listParams = mockQuery.mock.calls[2]?.[1] as unknown[];

    expect(listSql).toContain('it.warehouse_id IN (?,?)');
    expect(listParams).toEqual([1, 301, 9, 11, 10, 0]);
  });
});
