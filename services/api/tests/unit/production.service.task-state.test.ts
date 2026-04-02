const mockQuery = jest.fn();
const mockTransaction = jest.fn();

jest.mock('../../src/config/database', () => ({
  AppDataSource: {
    query: (...args: unknown[]) => mockQuery(...args),
    transaction: (...args: unknown[]) => mockTransaction(...args),
  },
}));

jest.mock('../../src/config/redis', () => ({
  RedisKeys: {
    schedule: (tenantId: number, date: string) => `schedule:${tenantId}:${date}`,
  },
  getRedisClient: () => ({
    del: jest.fn().mockResolvedValue(1),
  }),
}));

jest.mock('../../src/modules/production/scheduler.service', () => ({
  SchedulerService: jest.fn().mockImplementation(() => ({
    generateSchedule: jest.fn(),
    confirmSchedule: jest.fn(),
    getWorkerTasks: jest.fn(),
    startTask: jest.fn(),
    completeTask: jest.fn(),
  })),
}));

import { ProductionService } from '../../src/modules/production/production.service';

describe('ProductionService task state transitions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTransaction.mockImplementation(
      async (cb: (manager: { query: typeof mockQuery }) => Promise<unknown>) => cb({ query: mockQuery }),
    );
  });

  it('suspendTask 允许 pending 任务进入 suspended 并记录原因', async () => {
    mockQuery
      .mockResolvedValueOnce([{ id: 11, status: 'pending' }])
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce([{ id: 11, status: 'suspended', suspendReason: '待料', updatedAt: '2026-03-29 22:00:00' }]);

    const svc = new ProductionService({ tenantId: 1, userId: 99 });
    const result = await svc.suspendTask(11, '待料');

    expect(result).toEqual({
      id: 11,
      status: 'suspended',
      suspendReason: '待料',
      updatedAt: '2026-03-29 22:00:00',
    });
    expect(mockTransaction).toHaveBeenCalled();

    const updateCall = mockQuery.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes("SET status = 'suspended'"),
    );
    expect(updateCall).toBeDefined();
    expect(updateCall?.[1]).toEqual(['待料', 99, 11, 1]);
    expect(String(mockQuery.mock.calls[0][0])).toContain('FOR UPDATE');
  });

  it('suspendTask 允许 exception 任务进入 suspended 并保留挂起原因', async () => {
    mockQuery
      .mockResolvedValueOnce([{ id: 12, status: 'exception' }])
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce([{ id: 12, status: 'suspended', suspendReason: '等待主管复盘', updatedAt: '2026-04-02 11:00:00' }]);

    const svc = new ProductionService({ tenantId: 1, userId: 99 });
    const result = await svc.suspendTask(12, '等待主管复盘');

    expect(result).toEqual({
      id: 12,
      status: 'suspended',
      suspendReason: '等待主管复盘',
      updatedAt: '2026-04-02 11:00:00',
    });

    const updateCall = mockQuery.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes("SET status = 'suspended'"),
    );
    expect(updateCall).toBeDefined();
    expect(updateCall?.[1]).toEqual(['等待主管复盘', 99, 12, 1]);
  });

  it('resumeTask 只允许 suspended 任务恢复为 pending', async () => {
    mockQuery
      .mockResolvedValueOnce([{ id: 11, status: 'suspended' }])
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce([{ id: 11, status: 'pending', suspendReason: null, updatedAt: '2026-03-29 22:05:00' }]);

    const svc = new ProductionService({ tenantId: 1, userId: 99 });
    const result = await svc.resumeTask(11);

    expect(result).toEqual({
      id: 11,
      status: 'pending',
      suspendReason: null,
      updatedAt: '2026-03-29 22:05:00',
    });
    expect(mockTransaction).toHaveBeenCalled();

    const updateCall = mockQuery.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes("SET status = 'pending'"),
    );
    expect(updateCall).toBeDefined();
    expect(updateCall?.[1]).toEqual([99, 11, 1]);
    expect(String(mockQuery.mock.calls[0][0])).toContain('FOR UPDATE');
  });

  it('resumeTask 遇到非 suspended 状态时拒绝恢复', async () => {
    mockQuery.mockResolvedValueOnce([{ id: 11, status: 'completed' }]);

    const svc = new ProductionService({ tenantId: 1, userId: 99 });
    await expect(svc.resumeTask(11)).rejects.toThrow('无法恢复');
  });

  it('reportException 只允许 started 任务进入 exception', async () => {
    mockQuery
      .mockResolvedValueOnce([{ id: 12, status: 'started' }])
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce({ insertId: 31 });

    const svc = new ProductionService({ tenantId: 1, userId: 99 });
    await svc.reportException(12, {
      type: '设备故障',
      description: '主轴停机',
      severity: 'high',
      affectsProgress: true,
    });

    expect(mockTransaction).toHaveBeenCalled();

    const lockCall = mockQuery.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('FROM production_tasks') && sql.includes('FOR UPDATE'),
    );
    expect(lockCall?.[1]).toEqual([12, 1]);

    const taskUpdateCall = mockQuery.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes("SET status = 'exception'"),
    );
    expect(taskUpdateCall?.[1]).toEqual([1, 99, 12, 1]);

    const exceptionInsertCall = mockQuery.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO task_exceptions'),
    );
    expect(exceptionInsertCall?.[1]).toEqual([1, 12, '设备故障', '主轴停机', 'high', 99]);
  });

  it('reportException 遇到 pending 任务时拒绝上报', async () => {
    mockQuery.mockResolvedValueOnce([{ id: 12, status: 'pending' }]);

    const svc = new ProductionService({ tenantId: 1, userId: 99 });

    await expect(svc.reportException(12, {
      type: '设备故障',
      description: '主轴停机',
      severity: 'high',
    })).rejects.toThrow('只有 started 状态的任务可以上报异常');

    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('reportException 遇到已在 exception 的任务时拒绝重复上报', async () => {
    mockQuery.mockResolvedValueOnce([{ id: 12, status: 'exception' }]);

    const svc = new ProductionService({ tenantId: 1, userId: 99 });

    await expect(svc.reportException(12, {
      type: '设备故障',
      description: '主轴停机',
      severity: 'high',
    })).rejects.toThrow('任务已处于异常处理中');

    const insertCall = mockQuery.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO task_exceptions'),
    );
    expect(insertCall).toBeUndefined();
  });

  it('resolveException 会把任务恢复到 started 并清理阻塞标记', async () => {
    mockQuery
      .mockResolvedValueOnce([{ id: 12, status: 'exception' }])
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce({ affectedRows: 1 });

    const svc = new ProductionService({ tenantId: 1, userId: 99 });
    await svc.resolveException(12, '已更换刀片并复机');

    expect(mockTransaction).toHaveBeenCalled();

    const taskUpdateCall = mockQuery.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes("SET status = 'started'"),
    );
    expect(taskUpdateCall).toBeDefined();
    expect(taskUpdateCall?.[1]).toEqual([99, 12, 1]);
    expect(String(taskUpdateCall?.[0])).toContain('affects_progress = 0');

    const exceptionUpdateCall = mockQuery.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('UPDATE task_exceptions SET resolved_at = NOW()'),
    );
    expect(exceptionUpdateCall).toBeDefined();
    expect(exceptionUpdateCall?.[1]).toEqual([99, '已更换刀片并复机', 12, 1]);

    const legacyInvalidStatusCall = mockQuery.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes("status = 'in_progress'"),
    );
    expect(legacyInvalidStatusCall).toBeUndefined();
  });

  it('resolveException 遇到非 exception 状态时拒绝恢复', async () => {
    mockQuery.mockResolvedValueOnce([{ id: 12, status: 'started' }]);

    const svc = new ProductionService({ tenantId: 1, userId: 99 });

    await expect(svc.resolveException(12, '误报解除')).rejects.toThrow('无法处理异常');

    const exceptionUpdateCall = mockQuery.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('UPDATE task_exceptions SET resolved_at = NOW()'),
    );
    expect(exceptionUpdateCall).toBeUndefined();
  });

  it('resolveException 遇到缺失待处理异常记录时拒绝静默成功', async () => {
    mockQuery
      .mockResolvedValueOnce([{ id: 12, status: 'exception' }])
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce({ affectedRows: 0 });

    const svc = new ProductionService({ tenantId: 1, userId: 99 });

    await expect(svc.resolveException(12, '误报解除')).rejects.toThrow('没有待处理的异常记录');
  });
});
