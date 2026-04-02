import { authHeader } from '../helpers/setup';

jest.mock('../../src/modules/inventory/inventory.service');

import request from 'supertest';
import app from '../../src/app';
import { InventoryService } from '../../src/modules/inventory/inventory.service';

const MockService = InventoryService as jest.MockedClass<typeof InventoryService>;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('Inventory route auth and role guards', () => {
  it('returns 401 for daily snapshots when missing token', async () => {
    const res = await request(app).get('/api/inventory/daily-snapshots?page=1&pageSize=20');
    expect(res.status).toBe(401);
  });

  it('allows authenticated worker to read daily snapshots', async () => {
    MockService.prototype.listDailySnapshots = jest.fn().mockResolvedValue({
      list: [],
      total: 0,
      snapshotDate: '2026-03-31',
    });

    const res = await request(app)
      .get('/api/inventory/daily-snapshots?page=1&pageSize=20&snapshotDate=2026-03-31')
      .set('Authorization', authHeader({ roles: ['worker'] }));

    expect(res.status).toBe(200);
    expect(MockService.prototype.listDailySnapshots).toHaveBeenCalledWith({
      page: 1,
      pageSize: 20,
      snapshotDate: '2026-03-31',
    });
  });

  it('denies worker role on rebuild/reconcile/repair write endpoints', async () => {
    const commonHeader = { Authorization: authHeader({ roles: ['worker'] }) };

    const rebuildRes = await request(app)
      .post('/api/inventory/snapshots/rebuild')
      .set(commonHeader)
      .send({ dryRun: true });
    const reconcileRes = await request(app)
      .post('/api/inventory/reconcile')
      .set(commonHeader)
      .send({ dryRun: true });
    const repairRes = await request(app)
      .post('/api/inventory/repair')
      .set(commonHeader)
      .send({ dryRun: true });

    expect(rebuildRes.status).toBe(403);
    expect(reconcileRes.status).toBe(403);
    expect(repairRes.status).toBe(403);
    expect(MockService.prototype.rebuildDailySnapshots).not.toHaveBeenCalled();
    expect(MockService.prototype.reconcileInventoryBalances).not.toHaveBeenCalled();
    expect(MockService.prototype.repairInventoryState).not.toHaveBeenCalled();
  });

  it('allows supervisor role to reconcile inventory', async () => {
    MockService.prototype.reconcileInventoryBalances = jest.fn().mockResolvedValue({
      checkedCount: 1,
      changedCount: 0,
      dryRun: true,
      skuId: null,
      skuIds: null,
      items: [],
    });

    const res = await request(app)
      .post('/api/inventory/reconcile')
      .set('Authorization', authHeader({ roles: ['supervisor'] }))
      .send({ dryRun: true, includeReserved: true });

    expect(res.status).toBe(200);
    expect(MockService.prototype.reconcileInventoryBalances).toHaveBeenCalledWith({
      dryRun: true,
      includeReserved: true,
      includeInTransit: false,
    });
  });

  it('allows boss role to repair inventory', async () => {
    MockService.prototype.repairInventoryState = jest.fn().mockResolvedValue({
      dryRun: true,
      reconcile: {
        checkedCount: 1,
        changedCount: 0,
        dryRun: true,
        skuId: null,
        skuIds: null,
        items: [],
      },
      snapshots: {
        snapshotDate: '2026-03-31',
        rebuiltCount: 0,
        skuId: null,
        skuIds: null,
        dryRun: true,
      },
    });

    const res = await request(app)
      .post('/api/inventory/repair')
      .set('Authorization', authHeader({ roles: ['boss'] }))
      .send({ dryRun: true, includeInTransit: false });

    expect(res.status).toBe(200);
    expect(MockService.prototype.repairInventoryState).toHaveBeenCalledWith({
      dryRun: true,
      includeReserved: true,
      includeInTransit: false,
    });
  });
});
