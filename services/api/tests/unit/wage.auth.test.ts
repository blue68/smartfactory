import { authHeader } from '../helpers/setup';

jest.mock('../../src/modules/report/wage.service');

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
      .set('Authorization', authHeader({ roles: ['boss'] }));

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
      .set('Authorization', authHeader({ roles: ['manager'] }));

    expect(res.status).toBe(200);
    expect(MockService.prototype.getTaskWageReport).toHaveBeenCalledWith(expect.objectContaining({
      page: 1,
      pageSize: 20,
      productionOrderId: 9,
    }));
  });

  it('denies non-admin roles on /reports/wages and /reports/wages/tasks', async () => {
    const commonHeader = { Authorization: authHeader({ roles: ['sales'] }) };

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
      .set('Authorization', authHeader({ roles: ['worker'], userId: 33 }));

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
      .set('Authorization', authHeader({ roles: ['boss'] }));
    const managerRes = await request(app)
      .get('/api/reports/wages/export')
      .set('Authorization', authHeader({ roles: ['manager'] }));

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
      .set('Authorization', authHeader({ roles: ['sales'] }));

    expect(res.status).toBe(403);
    expect(MockService.prototype.exportWages).not.toHaveBeenCalled();
  });
});
