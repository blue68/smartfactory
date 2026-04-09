process.env.JWT_SECRET =
  process.env.TEST_JWT_SECRET
  ?? process.env.JWT_SECRET
  ?? 'local-test-jwt-secret-key-2026-smartfactory-at-least-32-chars';

import { authHeader } from '../helpers/setup';

jest.mock('../../src/modules/inventory/inventory.service');
jest.mock('../../src/shared/queue-service', () => ({
  queueService: {
    addJob: jest.fn(),
    getJobStatus: jest.fn(),
  },
}));

const TEST_ROLE_MAP: Record<number, string[]> = {
  11: ['warehouse'],
  12: ['worker'],
  13: ['supervisor'],
  14: ['boss'],
};
const ACTIONS_BY_ROLE: Record<string, string[]> = {
  warehouse: ['inventory:view', 'inventory:inbound', 'inventory:outbound', 'inventory:waste', 'warehouse:location:manage', 'stocktaking:create', 'stocktaking:view'],
  supervisor: ['inventory:view', 'inventory:outbound', 'inventory:maintain', 'inventory:waste', 'warehouse:location:manage', 'warehouse:location:import', 'stocktaking:create', 'stocktaking:view'],
  boss: ['inventory:view', 'inventory:inbound', 'inventory:outbound', 'inventory:maintain', 'inventory:waste', 'warehouse:location:manage', 'warehouse:location:import', 'stocktaking:create', 'stocktaking:view', 'stocktaking:confirm'],
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

  it('allows warehouse role to read daily snapshots', async () => {
    MockService.prototype.listDailySnapshots = jest.fn().mockResolvedValue({
      list: [],
      total: 0,
      snapshotDate: '2026-03-31',
    });

    const res = await request(app)
      .get('/api/inventory/daily-snapshots?page=1&pageSize=20&snapshotDate=2026-03-31')
      .set('Authorization', authHeader({ userId: 11, roles: ['warehouse'] }));

    expect(res.status).toBe(200);
    expect(MockService.prototype.listDailySnapshots).toHaveBeenCalledWith({
      page: 1,
      pageSize: 20,
      snapshotDate: '2026-03-31',
    });
  });

  it('denies worker role on rebuild/reconcile/repair write endpoints', async () => {
    const commonHeader = { Authorization: authHeader({ userId: 12, roles: ['worker'] }) };

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
      .set('Authorization', authHeader({ userId: 13, roles: ['supervisor'] }))
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
      .set('Authorization', authHeader({ userId: 14, roles: ['boss'] }))
      .send({ dryRun: true, includeInTransit: false });

    expect(res.status).toBe(200);
    expect(MockService.prototype.repairInventoryState).toHaveBeenCalledWith({
      dryRun: true,
      includeReserved: true,
      includeInTransit: false,
    });
  });
});
