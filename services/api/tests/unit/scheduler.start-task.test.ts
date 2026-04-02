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
  RedisTTL: {
    SCHEDULE: 300,
  },
  getRedisClient: () => ({
    set: jest.fn(),
    get: jest.fn(),
    del: jest.fn(),
    setex: jest.fn(),
  }),
}));

jest.mock('../../src/modules/production/production-phase1.service', () => ({
  ProductionPhase1Service: jest.fn().mockImplementation(() => ({
    releaseOrder: jest.fn().mockResolvedValue(undefined),
  })),
}));

import { SchedulerService } from '../../src/modules/production/scheduler.service';

describe('SchedulerService startTask conflicts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTransaction.mockImplementation(
      async (cb: (manager: { query: typeof mockQuery }) => Promise<unknown>) => cb({ query: mockQuery }),
    );
  });

  it('starts a pending task inside a transaction with row lock', async () => {
    mockQuery
      .mockResolvedValueOnce([{ id: 41, status: 'pending' }])
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce({ affectedRows: 1 });

    const svc = new SchedulerService({ tenantId: 1, userId: 99 });
    await svc.startTask(41);

    expect(mockTransaction).toHaveBeenCalled();
    expect(String(mockQuery.mock.calls[0][0])).toContain('FOR UPDATE');
    expect(String(mockQuery.mock.calls[1][0])).toContain("SET status = 'started'");
    expect(String(mockQuery.mock.calls[2][0])).toContain('UPDATE production_orders po');
  });

  it('rejects starting a task that is already started', async () => {
    mockQuery.mockResolvedValueOnce([{ id: 41, status: 'started' }]);

    const svc = new SchedulerService({ tenantId: 1, userId: 99 });
    await expect(svc.startTask(41)).rejects.toThrow('无法开始');

    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});
