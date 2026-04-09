process.env.JWT_SECRET =
  process.env.TEST_JWT_SECRET
  ?? process.env.JWT_SECRET
  ?? 'local-test-jwt-secret-key-2026-smartfactory-at-least-32-chars';

import { authHeader } from '../helpers/setup';

jest.mock('../../src/modules/report/wage.service');
jest.mock('../../src/shared/queue-service', () => ({
  queueService: {
    addJob: jest.fn(),
    getJobStatus: jest.fn(),
  },
}));

const TEST_ROLE_MAP: Record<number, string[]> = {
  21: ['boss'],
  22: ['manager'],
  23: ['sales'],
  24: ['worker'],
};

jest.mock('../../src/modules/access-control/access-control.service', () => ({
  accessControlService: {
    resolveUserRoleCodes: jest.fn(async (userId: number) => TEST_ROLE_MAP[userId] ?? ['boss']),
    buildPermissionSnapshot: jest.fn(async (tenantId: number, roleCodes: string[]) => ({
      version: 'unit-test',
      scopeLevel: 'tenant',
      originTenantId: tenantId,
      contextTenantId: tenantId,
      menuCodes: [],
      actionCodes: roleCodes.includes('boss') || roleCodes.includes('manager')
        ? ['report:wage:manage']
        : [],
      dataScopes: [],
      featureFlags: ['rbac_center'],
    })),
  },
}));

import request from 'supertest';
import app from '../../src/app';
import { WageService } from '../../src/modules/report/wage.service';

const MockService = WageService as jest.MockedClass<typeof WageService>;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('Wage report route auth and role guards', () => {
  it('returns 401 when missing token', async () => {
    const res = await request(app).get('/api/reports/wages?page=1&pageSize=20');
    expect(res.status).toBe(401);
  });

  it('allows boss to access admin wage report', async () => {
    MockService.prototype.getWageReport = jest.fn().mockResolvedValue([[], 0]);

    const res = await request(app)
      .get('/api/reports/wages?page=1&pageSize=20&workerGrade=skilled')
      .set('Authorization', authHeader({ userId: 21, roles: ['boss'] }));

    expect(res.status).toBe(200);
    expect(MockService.prototype.getWageReport).toHaveBeenCalledWith(expect.objectContaining({
      page: 1,
      pageSize: 20,
      workerGrade: 'skilled',
    }));
  });

  it('allows manager to access task-level wage report', async () => {
    MockService.prototype.getTaskWageReport = jest.fn().mockResolvedValue([[], 0]);

    const res = await request(app)
      .get('/api/reports/wages/tasks?page=1&pageSize=20&productionOrderId=9')
      .set('Authorization', authHeader({ userId: 22, roles: ['manager'] }));

    expect(res.status).toBe(200);
    expect(MockService.prototype.getTaskWageReport).toHaveBeenCalledWith(expect.objectContaining({
      page: 1,
      pageSize: 20,
      productionOrderId: 9,
    }));
  });

  it('denies non-admin roles on /reports/wages and /reports/wages/tasks', async () => {
    const commonHeader = { Authorization: authHeader({ userId: 23, roles: ['sales'] }) };

    const summaryRes = await request(app)
      .get('/api/reports/wages?page=1&pageSize=20')
      .set(commonHeader);
    const taskRes = await request(app)
      .get('/api/reports/wages/tasks?page=1&pageSize=20')
      .set(commonHeader);

    expect(summaryRes.status).toBe(403);
    expect(taskRes.status).toBe(403);
    expect(MockService.prototype.getWageReport).not.toHaveBeenCalled();
    expect(MockService.prototype.getTaskWageReport).not.toHaveBeenCalled();
  });

  it('allows authenticated user to access /reports/wages/my', async () => {
    MockService.prototype.getMyWages = jest.fn().mockResolvedValue([[], 0]);

    const res = await request(app)
      .get('/api/reports/wages/my?page=1&pageSize=20&dateFrom=2026-03-01')
      .set('Authorization', authHeader({ roles: ['worker'], userId: 24 }));

    expect(res.status).toBe(200);
    expect(MockService.prototype.getMyWages).toHaveBeenCalledWith({
      page: 1,
      pageSize: 20,
      dateFrom: '2026-03-01',
      dateTo: undefined,
    });
  });

  it('allows boss and manager to export wage report', async () => {
    MockService.prototype.exportWages = jest.fn().mockResolvedValue([]);

    const bossRes = await request(app)
      .get('/api/reports/wages/export')
      .set('Authorization', authHeader({ userId: 21, roles: ['boss'] }));
    const managerRes = await request(app)
      .get('/api/reports/wages/export')
      .set('Authorization', authHeader({ userId: 22, roles: ['manager'] }));

    expect(bossRes.status).toBe(200);
    expect(managerRes.status).toBe(200);
    expect(bossRes.header['content-type']).toContain(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(MockService.prototype.exportWages).toHaveBeenCalledTimes(2);
  });

  it('denies non-admin role on /reports/wages/export', async () => {
    const res = await request(app)
      .get('/api/reports/wages/export')
      .set('Authorization', authHeader({ userId: 23, roles: ['sales'] }));

    expect(res.status).toBe(403);
    expect(MockService.prototype.exportWages).not.toHaveBeenCalled();
  });
});
