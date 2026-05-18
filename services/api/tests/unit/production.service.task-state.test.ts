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

  it('listTasks 对通用工艺模板直接使用当前产出名作为展示工序名', async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (String(sql).includes('SELECT COUNT(*) AS total')) {
        return [{ total: '0' }];
      }
      return [];
    });

    const svc = new ProductionService({ tenantId: 1, userId: 99 });
    await svc.listTasks({ page: 1, pageSize: 20 });

    const listCall = mockQuery.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('task_rows.*'),
    );
    const listSql = String(listCall?.[0] ?? '');

    expect(listSql).toContain('LEFT JOIN process_templates proc_tpl');
    expect(listSql).toContain('proc_tpl.id IS NOT NULL');
    expect(listSql).toContain('proc_tpl.sku_id IS NULL');
    expect(listSql).toContain('THEN outs.name');
    expect(listSql).not.toContain("CONCAT(SUBSTRING_INDEX(ps.step_name, '：', 1)");
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
      .mockResolvedValueOnce([{ id: 12, operationId: null }])
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
    mockQuery
      .mockResolvedValueOnce([{ id: 12, operationId: null }])
      .mockResolvedValueOnce([{ id: 12, status: 'pending' }]);

    const svc = new ProductionService({ tenantId: 1, userId: 99 });

    await expect(svc.reportException(12, {
      type: '设备故障',
      description: '主轴停机',
      severity: 'high',
    })).rejects.toThrow('只有 started 状态的任务可以上报异常');

    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it('reportException 遇到已在 exception 的任务时拒绝重复上报', async () => {
    mockQuery
      .mockResolvedValueOnce([{ id: 12, operationId: null }])
      .mockResolvedValueOnce([{ id: 12, status: 'exception' }]);

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

  it('worker 不能操作分配给其他工人的任务', async () => {
    mockQuery.mockResolvedValueOnce([{ id: 15, workerId: 8, workerName: '李工' }]);

    const svc = new ProductionService({ tenantId: 1, userId: 99, roles: ['worker'] });

    await expect(svc.startTask(15)).rejects.toThrow('当前账号不能代报工');
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('worker 不能操作未绑定工人的任务', async () => {
    mockQuery.mockResolvedValueOnce([{ id: 16, workerId: null, workerName: null }]);

    const svc = new ProductionService({ tenantId: 1, userId: 99, roles: ['worker'] });

    await expect(svc.completeTask(16, {
      completedQty: '8',
      actualHours: 1.5,
    })).rejects.toThrow('任务未绑定到具体工人');
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('supervisor 可跳过工人绑定校验直接操作任务', async () => {
    mockQuery.mockResolvedValueOnce([{ id: 18, operationId: null }]);

    const svc = new ProductionService({ tenantId: 1, userId: 77, roles: ['supervisor'] });
    const startSpy = jest.fn().mockResolvedValue({ success: true });
    (svc as any).scheduler.startTask = startSpy;

    await svc.startTask(18);

    expect(startSpy).toHaveBeenCalledWith(18);
    expect(mockQuery).toHaveBeenCalledTimes(1);
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

  it('listTasks 在新字段缺失时自动降级到兼容查询', async () => {
    mockQuery
      .mockRejectedValueOnce(new Error("Unknown column 'pt.execution_mode' in 'field list'"))
      .mockResolvedValueOnce([{ total: '0' }])
      .mockResolvedValueOnce([{ columnName: 'version' }, { columnName: 'actual_hours' }])
      .mockResolvedValueOnce([{ columnName: 'output_sku_id' }, { columnName: 'execution_mode' }])
      .mockResolvedValueOnce([{
        id: 101,
        taskNo: 'TASK-001',
        taskDate: '2026-04-11',
        status: 'in_progress',
        plannedQty: '10.0000',
        completedQty: '2.0000',
        version: 1,
        actualHours: '1.50',
        processStepId: 12,
        operationId: null,
        outputSkuId: null,
        orderNo: 'WO-001',
        priority: 60,
        plannedFinishTime: '2026-04-12',
        processName: '缝制',
        workstationName: 'A1',
        workerName: '张工',
        skuName: '成衣A',
        skuCode: 'SKU-001',
        outputSkuName: null,
        taskType: 'finished',
        executionMode: 'internal',
        downstreamTaskCount: 0,
        activeDownstreamTaskCount: 0,
        dependencyBlocked: 0,
        priorityScore: 60,
        priorityLevel: 'medium',
        priorityLabel: '优先',
        priorityReason: '常规优先级',
      }])
      .mockResolvedValueOnce([{ total: '1' }]);

    const svc = new ProductionService({ tenantId: 1, userId: 99 });
    const result = await svc.listTasks({
      page: 1,
      pageSize: 20,
      executionMode: 'internal',
    });

    expect(result.total).toBe(1);
    expect(result.list).toHaveLength(1);
    expect(result.list[0]).toMatchObject({
      id: 101,
      taskNo: 'TASK-001',
      executionMode: 'internal',
    });

    const fallbackQueryCall = mockQuery.mock.calls.find(
      ([sql]) =>
        typeof sql === 'string'
        && sql.includes('LEFT JOIN production_schedules sched')
        && !sql.includes('production_operation_dependencies'),
    );
    expect(fallbackQueryCall).toBeDefined();
  });

  it('listTasks 支持按工人筛选', async () => {
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ total: '0' }]);

    const svc = new ProductionService({ tenantId: 1, userId: 99 });
    await svc.listTasks({
      page: 1,
      pageSize: 20,
      workerId: 55,
    });

    expect(String(mockQuery.mock.calls[0][0])).toContain('pt.worker_id = ?');
    expect(mockQuery.mock.calls[0][1]).toEqual([1, 55, 20, 0]);
    expect(mockQuery.mock.calls[1][1]).toEqual([1, 55]);
  });

  it('listTasks 在工序定义已删除时仍返回任务列表', async () => {
    mockQuery
      .mockResolvedValueOnce([{
        id: 101,
        taskNo: 'TASK-001',
        taskDate: '2026-04-11',
        status: 'pending',
        plannedQty: '10.0000',
        completedQty: '0.0000',
        version: 1,
        actualHours: null,
        processStepId: 910311,
        operationId: null,
        outputSkuId: null,
        orderNo: 'WO-001',
        priority: 60,
        plannedFinishTime: '2026-04-12',
        processName: 'STEP#910311',
        workstationName: null,
        workerName: null,
        skuName: '成衣A',
        skuCode: 'SKU-001',
        outputSkuName: null,
        taskType: 'finished',
        executionMode: 'internal',
        downstreamTaskCount: 0,
        activeDownstreamTaskCount: 0,
        dependencyBlocked: 0,
        priorityScore: 60,
        priorityLevel: 'medium',
        priorityLabel: '优先',
        priorityReason: '常规优先级',
      }])
      .mockResolvedValueOnce([{ total: '1' }]);

    const svc = new ProductionService({ tenantId: 1, userId: 99 });
    const result = await svc.listTasks({
      page: 1,
      pageSize: 20,
    });

    expect(result.total).toBe(1);
    expect(result.list).toHaveLength(1);
    expect(result.list[0]).toMatchObject({
      id: 101,
      processName: 'STEP#910311',
    });
    expect(String(mockQuery.mock.calls[0][0])).toContain('LEFT JOIN process_steps ps ON ps.id = pt.process_step_id');
    expect(String(mockQuery.mock.calls[1][0])).toContain('LEFT JOIN process_steps ps ON ps.id = pt.process_step_id');
  });

  it('getWorkCalendar 返回每天的正常班次与加班时段', async () => {
    mockQuery.mockResolvedValueOnce([
      {
        date: '2026-04-13',
        is_workday: 1,
        holiday_name: '调休上班',
        normal_ranges: JSON.stringify([
          { startTime: '08:00', endTime: '12:00' },
          { startTime: '13:30', endTime: '17:30' },
        ]),
        overtime_ranges: JSON.stringify([
          { startTime: '18:30', endTime: '20:30' },
        ]),
      },
    ]);

    const svc = new ProductionService({ tenantId: 1, userId: 99 });
    const result = await svc.getWorkCalendar(2026, 4);
    const target = result.find((item) => item.date === '2026-04-13');

    expect(target).toMatchObject({
      isWorkday: true,
      holidayName: '调休上班',
      normalHours: '8.0',
      overtimeHours: '2.0',
      totalHours: '10.0',
    });
    expect(target?.normalRanges).toEqual([
      { startTime: '08:00', endTime: '12:00' },
      { startTime: '13:30', endTime: '17:30' },
    ]);
    expect(target?.overtimeRanges).toEqual([
      { startTime: '18:30', endTime: '20:30' },
    ]);
  });

  it('setWorkdayConfig 会保存正常班次和加班时段', async () => {
    mockQuery.mockResolvedValueOnce({ affectedRows: 1 });

    const svc = new ProductionService({ tenantId: 1, userId: 99 });
    await svc.setWorkdayConfig({
      date: '2026-04-13',
      isWorkday: true,
      name: '加班日',
      normalRanges: [
        { startTime: '08:00', endTime: '12:00' },
        { startTime: '13:30', endTime: '17:30' },
      ],
      overtimeRanges: [
        { startTime: '18:30', endTime: '20:30' },
      ],
    });

    expect(String(mockQuery.mock.calls[0][0])).toContain('normal_ranges');
    expect(mockQuery.mock.calls[0][1]).toEqual([
      1,
      '2026-04-13',
      1,
      '加班日',
      JSON.stringify([
        { startTime: '08:00', endTime: '12:00' },
        { startTime: '13:30', endTime: '17:30' },
      ]),
      JSON.stringify([
        { startTime: '18:30', endTime: '20:30' },
      ]),
      99,
      99,
    ]);
  });
});
