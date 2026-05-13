import { AppDataSource } from '../../src/config/database';
import { ProductionService } from '../../src/modules/production/production.service';

const redisDelMock = jest.fn().mockResolvedValue(1);
const redisKeysMock = jest.fn().mockResolvedValue([]);

jest.mock('../../src/config/database', () => ({
  AppDataSource: {
    query: jest.fn(),
    transaction: jest.fn(),
  },
}));

jest.mock('../../src/config/redis', () => ({
  getRedisClient: () => ({
    del: redisDelMock,
    keys: redisKeysMock,
  }),
  RedisKeys: {
    schedule: (tenantId: number, date: string) => `schedule:${tenantId}:${date}`,
    schedulePattern: (tenantId: number, date: string) => `schedule:${tenantId}:${date}*`,
  },
}));

const mockAppDataSource = AppDataSource as unknown as {
  query: jest.Mock;
  transaction: jest.Mock;
};

describe('Production schedule regressions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    redisKeysMock.mockResolvedValue([]);
    mockAppDataSource.transaction.mockImplementation(async (callback: (manager: { query: jest.Mock }) => Promise<unknown>) =>
      callback({ query: mockAppDataSource.query }));
  });

  it('persists manual schedule adjustment to production_schedules and clears schedule cache', async () => {
    mockAppDataSource.query
      .mockResolvedValueOnce([{ id: 201 }])
      .mockResolvedValueOnce([{ id: 301 }])
      .mockResolvedValueOnce([{ id: 101, updatedAt: '2026-03-28 08:00:00' }])
      .mockResolvedValueOnce({ affectedRows: 1 });

    const svc = new ProductionService({ tenantId: 7, userId: 11 });
    const result = await svc.adjustSchedule('2026-03-29', [
      {
        scheduleId: 101,
        workerId: 201,
        workstationId: 301,
        plannedQty: '12.50',
        expectedUpdatedAt: '2026-03-28 08:00:00',
      },
    ]);

    expect(result).toEqual({ updated: 1 });
    expect(String(mockAppDataSource.query.mock.calls[0][0])).toContain("r.code = 'worker'");
    expect(mockAppDataSource.query.mock.calls[0][1]).toEqual([7, 201]);
    expect(String(mockAppDataSource.query.mock.calls[1][0])).toContain('FROM workstations');
    expect(mockAppDataSource.query.mock.calls[1][1]).toEqual([7, 301]);
    expect(String(mockAppDataSource.query.mock.calls[2][0])).toContain('DATE_FORMAT(updated_at');
    expect(String(mockAppDataSource.query.mock.calls[2][0])).toContain('FOR UPDATE');
    expect(mockAppDataSource.query.mock.calls[2][1]).toEqual([101, 7, '2026-03-29']);
    expect(String(mockAppDataSource.query.mock.calls[3][0])).toContain('UPDATE production_schedules');
    expect(String(mockAppDataSource.query.mock.calls[3][0])).toContain("status = 'planned'");
    expect(mockAppDataSource.query.mock.calls[3][1]).toEqual([201, 301, '12.50', 11, 101, 7, '2026-03-29']);
    expect(redisDelMock).toHaveBeenCalledWith('schedule:7:2026-03-29');
  });

  it('manual schedule adjustment still succeeds when Redis cache invalidation fails', async () => {
    mockAppDataSource.query
      .mockResolvedValueOnce([{ id: 202 }])
      .mockResolvedValueOnce([{ id: 102, updatedAt: '2026-03-29 08:00:00' }])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);
    redisDelMock.mockRejectedValueOnce(new Error('Command timed out'));
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    const svc = new ProductionService({ tenantId: 7, userId: 11 });
    const result = await svc.adjustSchedule('2026-03-30', [
      {
        scheduleId: 102,
        workerId: 202,
      },
    ]);

    expect(result).toEqual({ updated: 1 });
    expect(redisDelMock).toHaveBeenCalledWith('schedule:7:2026-03-30');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Redis unavailable during manual schedule adjustment cache invalidation'),
    );

    warnSpy.mockRestore();
  });

  it('accepts update query results returned as direct OkPacket objects from TypeORM', async () => {
    mockAppDataSource.query
      .mockResolvedValueOnce([{ id: 103, updatedAt: '2026-03-30 08:00:00' }])
      .mockResolvedValueOnce({ affectedRows: 1 });

    const svc = new ProductionService({ tenantId: 7, userId: 11 });
    const result = await svc.adjustSchedule('2026-03-31', [
      {
        scheduleId: 103,
        plannedQty: '9.00',
      },
    ]);

    expect(result).toEqual({ updated: 1 });
    expect(redisDelMock).toHaveBeenCalledWith('schedule:7:2026-03-31');
  });

  it('locks schedule rows in ascending id order before updating to reduce overlapping adjust races', async () => {
    mockAppDataSource.query
      .mockResolvedValueOnce([{ id: 101, updatedAt: '2026-03-31 08:00:00' }])
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce([{ id: 102, updatedAt: '2026-03-31 08:05:00' }])
      .mockResolvedValueOnce({ affectedRows: 1 });

    const svc = new ProductionService({ tenantId: 7, userId: 11 });
    const result = await svc.adjustSchedule('2026-04-01', [
      {
        scheduleId: 102,
        plannedQty: '8.00',
      },
      {
        scheduleId: 101,
        plannedQty: '6.00',
      },
    ]);

    expect(result).toEqual({ updated: 2 });
    expect(mockAppDataSource.query.mock.calls[0][1]).toEqual([101, 7, '2026-04-01']);
    expect(mockAppDataSource.query.mock.calls[2][1]).toEqual([102, 7, '2026-04-01']);
  });

  it('rejects stale manual adjustment when expectedUpdatedAt mismatches locked row', async () => {
    mockAppDataSource.query.mockResolvedValueOnce([{ id: 104, updatedAt: '2026-04-02 09:30:00' }]);

    const svc = new ProductionService({ tenantId: 7, userId: 11 });
    await expect(
      svc.adjustSchedule('2026-04-02', [
        {
          scheduleId: 104,
          plannedQty: '10.00',
          expectedUpdatedAt: '2026-04-02 09:00:00',
        },
      ]),
    ).rejects.toThrow('已被其他人修改');

    expect(String(mockAppDataSource.query.mock.calls[0][0])).toContain('FOR UPDATE');
    expect(mockAppDataSource.query).toHaveBeenCalledTimes(1);
    expect(redisDelMock).not.toHaveBeenCalled();
  });

  it('lists only worker role users for schedule adjustment options', async () => {
    mockAppDataSource.query.mockResolvedValueOnce([{ id: 1, name: '张伟' }]);

    const svc = new ProductionService({ tenantId: 7, userId: 11 });
    await svc.listWorkers();

    expect(String(mockAppDataSource.query.mock.calls[0][0])).toContain("r.code = 'worker'");
  });

  it('lists workstations with type linkage and optional inactive records for maintenance', async () => {
    mockAppDataSource.query.mockResolvedValueOnce([
      { id: 3, name: '开料区 A 线', type: '开料区', capacity: 120, status: 'inactive', linkedProcessCount: 2 },
    ]);

    const svc = new ProductionService({ tenantId: 7, userId: 11 });
    const result = await svc.listWorkstations(true);

    expect(result).toHaveLength(1);
    expect(String(mockAppDataSource.query.mock.calls[0][0])).toContain('LEFT JOIN (');
    expect(String(mockAppDataSource.query.mock.calls[0][0])).toContain("(? = 1 OR ws.status = 'active')");
    expect(mockAppDataSource.query.mock.calls[0][1]).toEqual([7, 7, 1]);
  });

  it('creates workstation records for schedule resource maintenance', async () => {
    mockAppDataSource.query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ insertId: 55 });

    const svc = new ProductionService({ tenantId: 7, userId: 11 });
    const result = await svc.createWorkstation({
      name: '装配区 B 线',
      type: '装配区',
      capacity: 180,
    });

    expect(result).toEqual({
      id: 55,
      name: '装配区 B 线',
      type: '装配区',
      capacity: 180,
      status: 'active',
    });
    expect(String(mockAppDataSource.query.mock.calls[1][0])).toContain('INSERT INTO workstations');
  });
});
