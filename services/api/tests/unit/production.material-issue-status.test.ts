jest.mock('../../src/config/database', () => ({
  AppDataSource: {
    query: jest.fn(),
  },
}));

jest.mock('../../src/modules/production/scheduler.service', () => ({
  SchedulerService: jest.fn().mockImplementation(() => ({})),
}));

import { AppDataSource } from '../../src/config/database';
import { ProductionService } from '../../src/modules/production/production.service';

const mockQuery = AppDataSource.query as jest.Mock;

describe('ProductionService material issue status aggregation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('aggregates by sku instead of letting one over-issued sku hide another pending sku', async () => {
    mockQuery
      .mockResolvedValueOnce([
        { taskId: 101, skuId: 11, requiredQty: '10.0000' },
        { taskId: 101, skuId: 12, requiredQty: '10.0000' },
        { taskId: 102, skuId: 21, requiredQty: '8.0000' },
      ])
      .mockResolvedValueOnce([
        { taskId: 101, skuId: 11, issuedNetQty: '12.0000', lineSideQty: '2.0000' },
        { taskId: 101, skuId: 12, issuedNetQty: '0.0000', lineSideQty: '0.0000' },
        { taskId: 102, skuId: 21, issuedNetQty: '8.0000', lineSideQty: '3.0000' },
      ]);

    const svc = new ProductionService({ tenantId: 1, userId: 9 });
    const result = await (svc as any).getTaskMaterialIssueStatusMap([101, 102]);

    expect(result.get(101)).toEqual({
      materialIssueStatus: 'partial_issue',
      materialIssueLabel: '部分领料',
    });
    expect(result.get(102)).toEqual({
      materialIssueStatus: 'line_side_remaining',
      materialIssueLabel: '线边有余料',
    });
  });
});
