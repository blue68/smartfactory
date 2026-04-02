const mockQuery = jest.fn();
const mockSet = jest.fn();
const mockGet = jest.fn();
const mockDel = jest.fn();
const mockSetex = jest.fn();

jest.mock('../../src/config/database', () => ({
  AppDataSource: {
    query: (...args: unknown[]) => mockQuery(...args),
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
    set: (...args: unknown[]) => mockSet(...args),
    get: (...args: unknown[]) => mockGet(...args),
    del: (...args: unknown[]) => mockDel(...args),
    setex: (...args: unknown[]) => mockSetex(...args),
  }),
}));

jest.mock('../../src/modules/production/production-phase1.service', () => ({
  ProductionPhase1Service: jest.fn().mockImplementation(() => ({
    releaseOrder: jest.fn().mockResolvedValue(undefined),
  })),
}));

import { SchedulerService } from '../../src/modules/production/scheduler.service';

describe('SchedulerService phase2 operation scheduling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSet.mockResolvedValue('OK');
    mockGet.mockResolvedValue(null);
    mockDel.mockResolvedValue(1);
    mockSetex.mockResolvedValue('OK');
  });

  it('generateSchedule 使用 production_operations 作为排产输入', async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM production_schedules') && sql.includes("status = 'confirmed'")) return [];
      if (sql.includes('FROM production_orders po')) {
        return [{
          id: 101,
          work_order_no: 'WO-101',
          sku_id: 501,
          sku_name: '成品A',
          qty_planned: '5',
          priority: 50,
          planned_end: null,
          sales_order_no: 'SO-1',
          expected_delivery: '2026-04-10',
          process_template_id: 11,
        }];
      }
      if (sql.includes('SELECT COUNT(*) AS cnt') && sql.includes('FROM production_operations')) {
        return [{ cnt: 1 }];
      }
      if (sql.includes("FROM users u")) {
        return [{ id: 9001, real_name: '工人A', skill_tags: null }];
      }
      if (sql.includes('FROM workstations')) {
        return [{ id: 8001, name: '裁剪台', type: 'cut', capacity: 100 }];
      }
      if (sql.includes('FROM production_operations op')) {
        return [{
          operation_id: 7001,
          production_order_id: 101,
          component_id: 6001,
          process_step_id: 3001,
          output_sku_id: 4001,
          planned_qty: '5',
          work_order_no: 'WO-101',
          step_name: '裁剪',
          standard_hours: '0.5',
          workstation_type: 'cut',
          workstation_id: 8001,
          output_sku_name: '半成品A',
        }];
      }
      if (sql.startsWith('DELETE FROM production_schedules')) return { affectedRows: 0 };
      if (sql.startsWith('INSERT INTO production_schedules')) {
        expect(sql).toContain('(?,?,?,?,?,?,?,?,?,?,\'planned\',1,?,?)');
        return { affectedRows: 1 };
      }
      if (sql.includes('FROM production_schedules ps')) {
        return [{
          schedule_id: 1,
          schedule_status: 'planned',
          schedule_updated_at: null,
          production_order_id: 101,
          operation_id: 7001,
          component_id: 6001,
          work_order_no: 'WO-101',
          process_step_id: 3001,
          step_name: '裁剪',
          output_sku_id: 4001,
          output_sku_name: '半成品A',
          worker_id: 9001,
          worker_name: '工人A',
          workstation_id: 8001,
          workstation_name: '裁剪台',
          planned_qty: '5.00',
          estimated_hours: '2.50',
        }];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const svc = new SchedulerService({ tenantId: 1, userId: 99 });
    const plan = await svc.generateSchedule('2026-03-30', true);

    expect(plan.schedules).toHaveLength(1);
    expect(plan.schedules[0].operationId).toBe(7001);
    expect(plan.schedules[0].componentId).toBe(6001);
    expect(plan.schedules[0].outputSkuId).toBe(4001);

    const operationQuery = mockQuery.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('FROM production_operations op'),
    );
    expect(operationQuery).toBeDefined();

    const legacyStepQuery = mockQuery.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('FROM process_steps') && sql.includes('WHERE template_id = ?'),
    );
    expect(legacyStepQuery).toBeUndefined();
  });

  it('confirmSchedule 写入 operation/component/output 关联字段到 production_tasks', async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.startsWith('UPDATE production_schedules')) return { affectedRows: 1 };
      if (sql.includes('FROM production_schedules ps')) {
        return [{
          id: 1,
          production_order_id: 101,
          operation_id: 7001,
          component_id: 6001,
          process_step_id: 3001,
          output_sku_id: 4001,
          worker_id: 9001,
          planned_qty: '5.00',
        }];
      }
      if (sql.startsWith('INSERT IGNORE INTO production_tasks')) return { affectedRows: 1 };
      if (sql.includes('FROM production_orders WHERE id = ?')) {
        return [{ id: 101, process_template_id: 11, process_snapshot: '{}' }];
      }
      return [];
    });

    const svc = new SchedulerService({ tenantId: 1, userId: 99 });
    await svc.confirmSchedule('2026-03-30');

    const insertCall = mockQuery.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.startsWith('INSERT IGNORE INTO production_tasks'),
    );
    expect(insertCall).toBeDefined();
    expect(insertCall?.[0]).toContain('operation_id');
    expect(insertCall?.[0]).toContain('component_id');
    expect(insertCall?.[0]).toContain('output_sku_id');
    expect(insertCall?.[1]).toContain('TK202603301');
    expect(insertCall?.[1]).toEqual(expect.arrayContaining([7001, 6001, 4001]));
  });

  it('confirmSchedule 不会为已生成任务的 confirmed 排产重复建任务', async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.startsWith('UPDATE production_schedules')) return { affectedRows: 0 };
      if (sql.includes('FROM production_schedules ps')) return [];
      return [];
    });

    const svc = new SchedulerService({ tenantId: 1, userId: 99 });
    await svc.confirmSchedule('2026-03-31');

    const scheduleSelect = mockQuery.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('FROM production_schedules ps'),
    );
    expect(scheduleSelect).toBeDefined();
    expect(String(scheduleSelect?.[0])).toContain('NOT EXISTS');
    expect(String(scheduleSelect?.[0])).toContain('pt.schedule_id = ps.id');

    const insertCall = mockQuery.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.startsWith('INSERT IGNORE INTO production_tasks'),
    );
    expect(insertCall).toBeUndefined();
  });
});
