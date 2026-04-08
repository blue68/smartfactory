const mockQuery = jest.fn();
const mockTransaction = jest.fn();
const mockSchedulerStartTask = jest.fn();
const mockSchedulerCompleteTask = jest.fn();

jest.mock('../../src/config/database', () => ({
  AppDataSource: {
    query: (...args: unknown[]) => mockQuery(...args),
    transaction: (...args: unknown[]) => mockTransaction(...args),
  },
}));

jest.mock('../../src/modules/production/scheduler.service', () => ({
  SchedulerService: jest.fn().mockImplementation(() => ({
    startTask: (...args: unknown[]) => mockSchedulerStartTask(...args),
    completeTask: (...args: unknown[]) => mockSchedulerCompleteTask(...args),
  })),
}));

jest.mock('../../src/modules/report/wage.service', () => ({
  WageService: jest.fn().mockImplementation(() => ({
    getTaskWageReport: jest.fn(),
  })),
}));

import { ProductionService } from '../../src/modules/production/production.service';

describe('ProductionService dependency guard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  function mockTaskLookup(operationId: number | null) {
    mockQuery.mockResolvedValueOnce([{
      id: 41,
      operationId,
    }]);
  }

  function mockPredecessors(completedQty: string, requiredQty = '10.0000') {
    mockQuery.mockResolvedValueOnce([{
      operationId: 11,
      stepName: '开料',
      requiredQty,
      completedQty,
      status: completedQty === requiredQty ? 'completed' : 'started',
      skuId: 501,
      skuCode: 'WIP-501',
      skuName: '半成品 501',
      unit: 'pcs',
    }]);
  }

  it('rejects starting a task when predecessor completion is insufficient', async () => {
    mockTaskLookup(7001);
    mockPredecessors('5.0000');

    const svc = new ProductionService({ tenantId: 1, userId: 9 });

    await expect(svc.startTask(41)).rejects.toThrow('暂不允许开始生产');
    expect(mockSchedulerStartTask).not.toHaveBeenCalled();
  });

  it('rejects exception reporting before transaction side effects when dependencies are blocked', async () => {
    mockTaskLookup(7001);
    mockPredecessors('5.0000');

    const svc = new ProductionService({ tenantId: 1, userId: 9 });

    await expect(svc.reportException(41, {
      type: '物料缺失',
      description: '前置半成品未齐套，无法开工',
      severity: 'high',
      affectsProgress: true,
    })).rejects.toThrow('暂不允许异常上报');

    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('allows completion when dependencies are satisfied', async () => {
    mockTaskLookup(7001);
    mockPredecessors('10.0000');
    mockSchedulerCompleteTask.mockResolvedValueOnce({ success: true });

    const svc = new ProductionService({ tenantId: 1, userId: 9 });
    const payload = { completedQty: '10.0000', actualHours: 1.5 };

    await expect(svc.completeTask(41, payload)).resolves.toEqual({ success: true });
    expect(mockSchedulerCompleteTask).toHaveBeenCalledWith(41, payload);
  });
});
