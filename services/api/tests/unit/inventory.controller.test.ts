jest.mock('../../src/modules/inventory/inventory.service', () => ({
  InventoryService: jest.fn(),
}));

import type { Request, Response } from 'express';
import { errorHandler } from '../../src/middleware/errorHandler';
import { inventoryController } from '../../src/modules/inventory/inventory.controller';
import { InventoryService } from '../../src/modules/inventory/inventory.service';

const MockService = InventoryService as jest.MockedClass<typeof InventoryService>;
let consoleErrorSpy: jest.SpyInstance;
let consoleWarnSpy: jest.SpyInstance;

function createReq(overrides: Partial<Request> = {}): Request {
  return {
    tenantId: 1,
    userId: 9,
    roles: ['boss'],
    body: {},
    params: {},
    query: {},
    method: 'POST',
    path: '/api/inventory/reconcile',
    ...overrides,
  } as Request;
}

function createRes(): Response {
  const res = {
    status: jest.fn(),
    json: jest.fn(),
  } as unknown as Response;

  (res.status as unknown as jest.Mock).mockReturnValue(res);
  return res;
}

async function runWithErrorHandler(
  fn: () => Promise<void>,
  req: Request,
  res: Response,
): Promise<void> {
  try {
    await fn();
  } catch (err) {
    errorHandler(err, req, res, jest.fn());
  }
}

beforeEach(() => {
  jest.clearAllMocks();
  consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
  consoleWarnSpy.mockRestore();
});

describe('InventoryController.listDailySnapshots', () => {
  it('parses snapshot list query and returns paginated payload with snapshotDate', async () => {
    MockService.prototype.listDailySnapshots = jest.fn().mockResolvedValue({
      list: [{ skuId: 301, skuCode: 'SKU-301' }],
      total: 1,
      snapshotDate: '2026-03-31',
    });

    const req = createReq({
      method: 'GET',
      query: {
        page: '2',
        pageSize: '5',
        snapshotDate: '2026-03-31',
        skuId: '301',
        keyword: '面料',
      },
      path: '/api/inventory/daily-snapshots',
    });
    const res = createRes();

    await inventoryController.listDailySnapshots(req, res);

    expect(MockService.prototype.listDailySnapshots).toHaveBeenCalledWith({
      page: 2,
      pageSize: 5,
      snapshotDate: '2026-03-31',
      skuId: 301,
      keyword: '面料',
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      code: 0,
      data: expect.objectContaining({
        list: [{ skuId: 301, skuCode: 'SKU-301' }],
        total: 1,
        page: 2,
        pageSize: 5,
        snapshotDate: '2026-03-31',
      }),
    }));
  });

  it('rejects invalid snapshotDate query format', async () => {
    const req = createReq({
      method: 'GET',
      query: {
        page: '1',
        pageSize: '20',
        snapshotDate: '2026/03/31',
      },
      path: '/api/inventory/daily-snapshots',
    });
    const res = createRes();

    await runWithErrorHandler(() => inventoryController.listDailySnapshots(req, res), req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      code: 1001,
    }));
    expect(MockService.prototype.listDailySnapshots).not.toHaveBeenCalled();
  });
});

describe('InventoryController.listTransactions', () => {
  it('parses trace query and returns paginated transaction payload', async () => {
    MockService.prototype.listTransactions = jest.fn().mockResolvedValue({
      skuId: 301,
      skuCode: 'SKU-301',
      skuName: '坯布 301',
      stockUnit: 'm',
      list: [{ transactionId: 91, transactionNo: 'TX-91' }],
      total: 1,
    });

    const req = createReq({
      method: 'GET',
      params: { skuId: '301' },
      query: {
        page: '2',
        pageSize: '6',
        dateFrom: '2026-04-01',
        dateTo: '2026-04-02',
        keyword: 'WO-301',
      },
      path: '/api/inventory/301/transactions',
    });
    const res = createRes();

    await inventoryController.listTransactions(req, res);

    expect(MockService.prototype.listTransactions).toHaveBeenCalledWith(301, {
      page: 2,
      pageSize: 6,
      dateFrom: '2026-04-01',
      dateTo: '2026-04-02',
      keyword: 'WO-301',
    });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      code: 0,
      data: expect.objectContaining({
        skuId: 301,
        skuCode: 'SKU-301',
        list: [{ transactionId: 91, transactionNo: 'TX-91' }],
        total: 1,
        page: 2,
        pageSize: 6,
      }),
    }));
  });
});

describe('InventoryController.rebuildSnapshots', () => {
  it('passes rebuild payload and returns preview message when dryRun is true', async () => {
    MockService.prototype.rebuildDailySnapshots = jest.fn().mockResolvedValue({
      snapshotDate: '2026-03-31',
      rebuiltCount: 2,
      skuId: null,
      skuIds: [301, 302],
      dryRun: true,
    });

    const req = createReq({
      body: {
        snapshotDate: '2026-03-31',
        skuIds: [301, 302],
        dryRun: true,
      },
      path: '/api/inventory/snapshots/rebuild',
    });
    const res = createRes();

    await inventoryController.rebuildSnapshots(req, res);

    expect(MockService.prototype.rebuildDailySnapshots).toHaveBeenCalledWith({
      snapshotDate: '2026-03-31',
      skuIds: [301, 302],
      dryRun: true,
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      code: 0,
      message: '库存日结快照预览完成',
    }));
  });

  it('returns rebuild message when dryRun is false', async () => {
    MockService.prototype.rebuildDailySnapshots = jest.fn().mockResolvedValue({
      snapshotDate: '2026-03-31',
      rebuiltCount: 2,
      skuId: null,
      skuIds: [301, 302],
      dryRun: false,
    });

    const req = createReq({
      body: {
        snapshotDate: '2026-03-31',
        skuIds: [301, 302],
        dryRun: false,
      },
      path: '/api/inventory/snapshots/rebuild',
    });
    const res = createRes();

    await inventoryController.rebuildSnapshots(req, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      code: 0,
      message: '库存日结快照已重建',
    }));
  });

  it('rejects rebuild payload when skuId and skuIds are both provided', async () => {
    const req = createReq({
      body: {
        snapshotDate: '2026-03-31',
        skuId: 301,
        skuIds: [301, 302],
      },
      path: '/api/inventory/snapshots/rebuild',
    });
    const res = createRes();

    await runWithErrorHandler(() => inventoryController.rebuildSnapshots(req, res), req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      code: 1001,
    }));
    expect(MockService.prototype.rebuildDailySnapshots).not.toHaveBeenCalled();
  });
});

describe('InventoryController.reconcileInventory', () => {
  it('applies reconcile defaults and returns preview message', async () => {
    MockService.prototype.reconcileInventoryBalances = jest.fn().mockResolvedValue({
      changedCount: 0,
      items: [],
      dryRun: true,
    });

    const req = createReq({
      body: {},
      path: '/api/inventory/reconcile',
    });
    const res = createRes();

    await inventoryController.reconcileInventory(req, res);

    expect(MockService.prototype.reconcileInventoryBalances).toHaveBeenCalledWith({
      dryRun: true,
      includeReserved: false,
      includeInTransit: false,
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      code: 0,
      message: '库存账本差异预览完成',
    }));
  });

  it('passes explicit reconcile switches and returns repair message when dryRun is false', async () => {
    MockService.prototype.reconcileInventoryBalances = jest.fn().mockResolvedValue({
      changedCount: 1,
      items: [],
      dryRun: false,
    });

    const req = createReq({
      body: {
        skuIds: [301, 302],
        dryRun: false,
        includeReserved: true,
        includeInTransit: true,
      },
      path: '/api/inventory/reconcile',
    });
    const res = createRes();

    await inventoryController.reconcileInventory(req, res);

    expect(MockService.prototype.reconcileInventoryBalances).toHaveBeenCalledWith({
      skuIds: [301, 302],
      dryRun: false,
      includeReserved: true,
      includeInTransit: true,
    });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      code: 0,
      message: '库存账本已对账修复',
    }));
  });

  it('rejects reconcile payload when skuId and skuIds are both provided', async () => {
    const req = createReq({
      body: {
        skuId: 301,
        skuIds: [301, 302],
      },
      path: '/api/inventory/reconcile',
    });
    const res = createRes();

    await runWithErrorHandler(() => inventoryController.reconcileInventory(req, res), req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      code: 1001,
    }));
    expect(MockService.prototype.reconcileInventoryBalances).not.toHaveBeenCalled();
  });
});

describe('InventoryController.repairInventory', () => {
  it('applies repair defaults and returns preview message', async () => {
    MockService.prototype.repairInventoryState = jest.fn().mockResolvedValue({
      dryRun: true,
      reconcile: { changedCount: 0, items: [], dryRun: true },
      snapshots: { rebuiltCount: 0, items: [], dryRun: true },
    });

    const req = createReq({
      body: {},
      path: '/api/inventory/repair',
    });
    const res = createRes();

    await inventoryController.repairInventory(req, res);

    expect(MockService.prototype.repairInventoryState).toHaveBeenCalledWith({
      dryRun: true,
      includeReserved: true,
      includeInTransit: true,
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      code: 0,
      message: '库存修复预览完成',
    }));
  });

  it('passes explicit repair switches and returns execution message when dryRun is false', async () => {
    MockService.prototype.repairInventoryState = jest.fn().mockResolvedValue({
      dryRun: false,
      reconcile: { changedCount: 1, items: [], dryRun: false },
      snapshots: { rebuiltCount: 1, items: [], dryRun: false },
    });

    const req = createReq({
      body: {
        skuId: 301,
        snapshotDate: '2026-03-31',
        dryRun: false,
        includeReserved: false,
        includeInTransit: true,
      },
      path: '/api/inventory/repair',
    });
    const res = createRes();

    await inventoryController.repairInventory(req, res);

    expect(MockService.prototype.repairInventoryState).toHaveBeenCalledWith({
      skuId: 301,
      snapshotDate: '2026-03-31',
      dryRun: false,
      includeReserved: false,
      includeInTransit: true,
    });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      code: 0,
      message: '库存修复已执行',
    }));
  });

  it('rejects repair payload when skuId and skuIds are both provided', async () => {
    const req = createReq({
      body: {
        snapshotDate: '2026-03-31',
        skuId: 301,
        skuIds: [301, 302],
      },
      path: '/api/inventory/repair',
    });
    const res = createRes();

    await runWithErrorHandler(() => inventoryController.repairInventory(req, res), req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      code: 1001,
    }));
    expect(MockService.prototype.repairInventoryState).not.toHaveBeenCalled();
  });
});
