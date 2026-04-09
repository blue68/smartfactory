import { AppDataSource } from '../../src/config/database';
import { StocktakingService } from '../../src/modules/stocktaking/stocktaking.service';

jest.mock('../../src/config/database', () => ({
  AppDataSource: {
    query: jest.fn(),
    transaction: jest.fn(),
  },
}));

const mockQuery = AppDataSource.query as jest.Mock;

describe('StocktakingService warehouse_assigned scope', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('applies warehouse scope to task list queries', async () => {
    mockQuery
      .mockResolvedValueOnce([{ id: 3 }])
      .mockResolvedValueOnce([{ total: 0 }])
      .mockResolvedValueOnce([]);

    const service = new StocktakingService({
      tenantId: 7,
      userId: 11,
      permissionSnapshot: {
        version: 'test',
        scopeLevel: 'tenant',
        originTenantId: 7,
        contextTenantId: 7,
        menuCodes: [],
        actionCodes: [],
        featureFlags: [],
        dataScopes: [{ scopeType: 'warehouse_assigned', scopeValues: ['WH-A'] }],
      },
    });

    await service.listTasks({ page: 1, pageSize: 20 });

    const countSql = String(mockQuery.mock.calls[1]?.[0] ?? '');
    const countParams = mockQuery.mock.calls[1]?.[1] as unknown[];

    expect(countSql).toContain('st.warehouse_id IN (?)');
    expect(countParams).toEqual([7, 3]);
  });

  it('blocks task detail outside assigned warehouses', async () => {
    mockQuery
      .mockResolvedValueOnce([{ id: 3 }])
      .mockResolvedValueOnce([]);

    const service = new StocktakingService({
      tenantId: 7,
      userId: 11,
      permissionSnapshot: {
        version: 'test',
        scopeLevel: 'tenant',
        originTenantId: 7,
        contextTenantId: 7,
        menuCodes: [],
        actionCodes: [],
        featureFlags: [],
        dataScopes: [{ scopeType: 'warehouse_assigned', scopeValues: [3] }],
      },
    });

    await expect(service.getTaskWithItems(88)).rejects.toThrow('盘点任务不存在');

    const taskSql = String(mockQuery.mock.calls[1]?.[0] ?? '');
    expect(taskSql).toContain('st.warehouse_id IN (?)');
  });
});
