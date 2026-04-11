process.env.JWT_SECRET =
  process.env.TEST_JWT_SECRET
  ?? process.env.JWT_SECRET
  ?? 'local-test-jwt-secret-key-2026-smartfactory-at-least-32-chars';

/**
 * [artifact:自动化测试] — 生产任务 Controller 集成测试
 *
 * 覆盖范围：
 *   GET  /api/production/tasks              — 任务列表（分页 + 筛选）
 *   POST /api/production/tasks/:id/exception — 异常上报
 *   POST /api/production/tasks/:id/start     — 开始任务
 *   POST /api/production/tasks/:id/complete  — 完工上报
 */

import { authHeader } from '../helpers/setup';

jest.mock('../../src/modules/production/production.service');
jest.mock('../../src/shared/queue-service', () => ({
  queueService: {
    addJob: jest.fn(),
    getJobStatus: jest.fn(),
  },
}));

const TEST_ROLE_MAP: Record<number, string[]> = {
  41: ['boss'],
  42: ['worker'],
  43: ['supervisor'],
  44: ['sales'],
};
const ACTIONS_BY_ROLE: Record<string, string[]> = {
  boss: [
    'production:task:operate',
    'production:task:complete',
    'production:task:supervise',
    'production:schedule:confirm',
    'production:schedule:adjust',
  ],
  supervisor: [
    'production:task:operate',
    'production:task:complete',
    'production:task:supervise',
    'production:schedule:confirm',
    'production:schedule:adjust',
  ],
  worker: [
    'production:task:operate',
    'production:task:complete',
  ],
};

function buildActionCodes(roleCodes: string[]): string[] {
  return Array.from(new Set(roleCodes.flatMap((role) => ACTIONS_BY_ROLE[role] ?? [])));
}

jest.mock('../../src/modules/access-control/access-control.service', () => ({
  accessControlService: {
    resolveUserRoleCodes: jest.fn(async (userId: number) => TEST_ROLE_MAP[userId] ?? ['boss']),
    buildPermissionSnapshot: jest.fn(async (tenantId: number, roleCodes: string[]) => ({
      version: 'unit-test',
      scopeLevel: 'tenant',
      originTenantId: tenantId,
      contextTenantId: tenantId,
      menuCodes: [],
      actionCodes: buildActionCodes(roleCodes),
      dataScopes: [],
      featureFlags: ['rbac_center'],
    })),
  },
}));

import request from 'supertest';
import app from '../../src/app';
import { ProductionService } from '../../src/modules/production/production.service';

const MockService = ProductionService as jest.MockedClass<typeof ProductionService>;

const mockTask = {
  id: 1,
  taskDate: '2025-03-01',
  status: 'pending',
  plannedQty: 100,
  completedQty: 0,
  orderNo: 'PO-2025-001',
  processName: '裁剪',
  workstationName: '裁剪台1',
  workerName: '张三',
};

beforeEach(() => {
  jest.clearAllMocks();
});

// ── 认证 ─────────────────────────────────────────────────────────────────

describe('Auth', () => {
  it('无 token 时返回 401', async () => {
    const res = await request(app).get('/api/production/tasks');
    expect(res.status).toBe(401);
  });
});

// ── GET /api/production/tasks ─────────────────────────────────────────────

describe('GET /api/production/tasks', () => {
  it('返回分页任务列表', async () => {
    MockService.prototype.listTasks = jest.fn().mockResolvedValue({
      list: [mockTask],
      total: 1,
    });

    const res = await request(app)
      .get('/api/production/tasks')
      .set('Authorization', authHeader());

    expect(res.status).toBe(200);
    expect(res.body.code).toBe(0);
    expect(res.body.data.list).toHaveLength(1);
    expect(res.body.data.total).toBe(1);
    expect(res.body.data.page).toBe(1);
  });

  it('支持 status 过滤', async () => {
    MockService.prototype.listTasks = jest.fn().mockResolvedValue({ list: [], total: 0 });

    await request(app)
      .get('/api/production/tasks?status=in_progress')
      .set('Authorization', authHeader());

    expect(MockService.prototype.listTasks).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'in_progress' }),
    );
  });

  it('支持 keyword 过滤', async () => {
    MockService.prototype.listTasks = jest.fn().mockResolvedValue({ list: [], total: 0 });

    await request(app)
      .get(`/api/production/tasks?keyword=${encodeURIComponent('裁剪')}`)
      .set('Authorization', authHeader());

    expect(MockService.prototype.listTasks).toHaveBeenCalledWith(
      expect.objectContaining({ keyword: '裁剪' }),
    );
  });

  it('支持自定义分页参数', async () => {
    MockService.prototype.listTasks = jest.fn().mockResolvedValue({ list: [], total: 0 });

    const res = await request(app)
      .get('/api/production/tasks?page=2&pageSize=10')
      .set('Authorization', authHeader());

    expect(res.status).toBe(200);
    expect(MockService.prototype.listTasks).toHaveBeenCalledWith(
      expect.objectContaining({ page: 2, pageSize: 10 }),
    );
  });
});

describe('GET /api/production/tasks/categories', () => {
  it('返回任务类别枚举（兼容旧版前端）', async () => {
    const res = await request(app)
      .get('/api/production/tasks/categories')
      .set('Authorization', authHeader());

    expect(res.status).toBe(200);
    expect(res.body.code).toBe(0);
    expect(res.body.data).toEqual([
      { code: 'finished', name: '成品任务' },
      { code: 'semi_finished', name: '半成品任务' },
    ]);
  });
});

// ── PUT /api/production/schedule/:date/adjust ─────────────────────────────

describe('PUT /api/production/schedule/:date/adjust', () => {
  it('accepts expectedUpdatedAt and passes adjustment payload to service', async () => {
    MockService.prototype.adjustSchedule = jest.fn().mockResolvedValue({ updated: 1 });

    const res = await request(app)
      .put('/api/production/schedule/2026-04-02/adjust')
      .set('Authorization', authHeader({ userId: 43, roles: ['supervisor'] }))
      .send({
        adjustments: [
          {
            scheduleId: 101,
            workerId: 201,
            plannedQty: '12.50',
            expectedUpdatedAt: '2026-04-02 09:30:00',
          },
        ],
      });

    expect(res.status).toBe(200);
    expect(MockService.prototype.adjustSchedule).toHaveBeenCalledWith(
      '2026-04-02',
      [
        {
          scheduleId: 101,
          workerId: 201,
          workstationId: undefined,
          plannedQty: '12.50',
          expectedUpdatedAt: '2026-04-02 09:30:00',
        },
      ],
    );
  });

  it('rejects invalid expectedUpdatedAt format', async () => {
    MockService.prototype.adjustSchedule = jest.fn();

    const res = await request(app)
      .put('/api/production/schedule/2026-04-02/adjust')
      .set('Authorization', authHeader({ userId: 43, roles: ['supervisor'] }))
      .send({
        adjustments: [
          {
            scheduleId: 101,
            plannedQty: '12.50',
            expectedUpdatedAt: '2026/04/02 09:30:00',
          },
        ],
      });

    expect(res.status).toBe(400);
    expect(MockService.prototype.adjustSchedule).not.toHaveBeenCalled();
  });
});

// ── POST /api/production/tasks/:id/exception ──────────────────────────────

describe('POST /api/production/tasks/:id/exception', () => {
  const validPayload = {
    type: '设备故障',
    description: '裁剪机刀片断裂',
    severity: 'high',
  };

  it('异常上报返回 200', async () => {
    MockService.prototype.reportException = jest.fn().mockResolvedValue(undefined);

    const res = await request(app)
      .post('/api/production/tasks/1/exception')
      .set('Authorization', authHeader())
      .send(validPayload);

    expect(res.status).toBe(200);
    expect(res.body.code).toBe(0);
    expect(res.body.message).toBe('异常已上报');
  });

  it('type 参数校验 — 仅允许指定枚举值', async () => {
    const res = await request(app)
      .post('/api/production/tasks/1/exception')
      .set('Authorization', authHeader())
      .send({ type: '未知类型', description: '测试', severity: 'low' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe(1001);
  });

  it('severity 参数校验 — 仅允许 low/medium/high', async () => {
    const res = await request(app)
      .post('/api/production/tasks/1/exception')
      .set('Authorization', authHeader())
      .send({ type: '设备故障', description: '测试', severity: 'critical' });

    expect(res.status).toBe(400);
  });

  it('缺少 description 返回 400', async () => {
    const res = await request(app)
      .post('/api/production/tasks/1/exception')
      .set('Authorization', authHeader())
      .send({ type: '设备故障', severity: 'medium' });

    expect(res.status).toBe(400);
  });

  it('description 为空字符串返回 400', async () => {
    const res = await request(app)
      .post('/api/production/tasks/1/exception')
      .set('Authorization', authHeader())
      .send({ type: '设备故障', description: '', severity: 'medium' });

    expect(res.status).toBe(400);
  });

  it('各异常类型均可正常提交', async () => {
    MockService.prototype.reportException = jest.fn().mockResolvedValue(undefined);

    for (const type of ['设备故障', '物料缺失', '质量异常', '其他']) {
      const res = await request(app)
        .post('/api/production/tasks/1/exception')
        .set('Authorization', authHeader())
        .send({ type, description: '测试描述', severity: 'medium' });

      expect(res.status).toBe(200);
    }
  });

  it('非 worker/supervisor/boss 角色返回 403', async () => {
    const res = await request(app)
      .post('/api/production/tasks/1/exception')
      .set('Authorization', authHeader({ userId: 44, roles: ['sales'] }))
      .send(validPayload);

    expect(res.status).toBe(403);
  });
});

// ── POST /api/production/tasks/:id/start ──────────────────────────────────

describe('POST /api/production/tasks/:id/start', () => {
  it('worker 角色可开始任务', async () => {
    MockService.prototype.startTask = jest.fn().mockResolvedValue(undefined);

    const res = await request(app)
      .post('/api/production/tasks/1/start')
      .set('Authorization', authHeader({ userId: 42, roles: ['worker'] }));

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('任务已开始');
  });

  it('supervisor 角色可开始任务', async () => {
    MockService.prototype.startTask = jest.fn().mockResolvedValue(undefined);

    const res = await request(app)
      .post('/api/production/tasks/1/start')
      .set('Authorization', authHeader({ userId: 43, roles: ['supervisor'] }));

    expect(res.status).toBe(200);
  });

  it('非 worker/supervisor 角色返回 403', async () => {
    const res = await request(app)
      .post('/api/production/tasks/1/start')
      .set('Authorization', authHeader({ userId: 44, roles: ['sales'] }));

    expect(res.status).toBe(403);
  });
});

// ── POST /api/production/tasks/:id/complete ───────────────────────────────

describe('POST /api/production/tasks/:id/complete', () => {
  it('完工上报返回 200', async () => {
    MockService.prototype.completeTask = jest.fn().mockResolvedValue(undefined);

    const res = await request(app)
      .post('/api/production/tasks/1/complete')
      .set('Authorization', authHeader({ userId: 42, roles: ['worker'] }))
      .send({ completedQty: '100' });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('完工已上报');
  });

  it('completedQty 格式错误返回 400', async () => {
    const res = await request(app)
      .post('/api/production/tasks/1/complete')
      .set('Authorization', authHeader({ userId: 42, roles: ['worker'] }))
      .send({ completedQty: 'abc' });

    expect(res.status).toBe(400);
  });

  it('含可选字段 scrapQty 和 notes', async () => {
    MockService.prototype.completeTask = jest.fn().mockResolvedValue(undefined);

    const res = await request(app)
      .post('/api/production/tasks/1/complete')
      .set('Authorization', authHeader({ userId: 42, roles: ['worker'] }))
      .send({
        completedQty: '95',
        scrapQty: '5',
        scrapReason: 'material_defect',
        notes: '5件布料有色差',
      });

    expect(res.status).toBe(200);
  });

  it('非 worker/supervisor 角色返回 403', async () => {
    const res = await request(app)
      .post('/api/production/tasks/1/complete')
      .set('Authorization', authHeader({ userId: 44, roles: ['sales'] }))
      .send({ completedQty: '100' });

    expect(res.status).toBe(403);
  });
});
