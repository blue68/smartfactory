const mockQuery = jest.fn();
const mockTransaction = jest.fn();
const mockRedisDel = jest.fn();

jest.mock('../../src/config/database', () => ({
  AppDataSource: {
    query: (...args: unknown[]) => mockQuery(...args),
    transaction: (...args: unknown[]) => mockTransaction(...args),
  },
}));

jest.mock('../../src/config/redis', () => ({
  getRedisClient: () => ({
    del: (...args: unknown[]) => mockRedisDel(...args),
  }),
  RedisKeys: {
    inventorySnapshot: (tenantId: number, skuId: number) => `inventory:${tenantId}:${skuId}`,
  },
  RedisTTL: {},
  acquireLock: jest.fn(),
  releaseLock: jest.fn(),
}));

import { InventoryService } from '../../src/modules/inventory/inventory.service';

describe('InventoryService repairInventoryState', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    mockRedisDel.mockResolvedValue(1);
    mockTransaction.mockImplementation(
      async (cb: (manager: { query: typeof mockQuery }) => Promise<unknown>) => {
        const manager = { query: mockQuery } as { query: typeof mockQuery; __inventorySnapshotSkuIds?: Set<number> };
        const result = await cb(manager);
        expect(mockRedisDel).not.toHaveBeenCalled();
        return result;
      },
    );
  });

  it('runs reconcile and snapshot rebuild in a single transaction with repair defaults', async () => {
    const svc = new InventoryService({ tenantId: 7, userId: 11, roles: ['boss'] });

    const reconcileSpy = jest
      .spyOn(svc as any, 'reconcileInventoryBalancesInTx')
      .mockResolvedValue({
        checkedCount: 2,
        changedCount: 1,
        dryRun: false,
        skuId: null,
        skuIds: [301, 302],
        items: [],
      });
    const rebuildSpy = jest
      .spyOn(svc as any, 'rebuildDailySnapshotsInTx')
      .mockResolvedValue({
        snapshotDate: '2026-03-30',
        rebuiltCount: 2,
        skuId: null,
        skuIds: [301, 302],
        dryRun: false,
      });

    const result = await svc.repairInventoryState({
      snapshotDate: '2026-03-30',
      skuIds: [301, 302],
      dryRun: false,
    });

    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(reconcileSpy).toHaveBeenCalledWith(
      expect.objectContaining({ query: mockQuery }),
      {
        skuId: undefined,
        skuIds: [301, 302],
        dryRun: false,
        includeReserved: true,
        includeInTransit: true,
      },
    );
    expect(rebuildSpy).toHaveBeenCalledWith(
      expect.objectContaining({ query: mockQuery }),
      {
        snapshotDate: '2026-03-30',
        skuId: undefined,
        skuIds: [301, 302],
        dryRun: false,
      },
    );
    expect(result).toEqual({
      dryRun: false,
      reconcile: {
        checkedCount: 2,
        changedCount: 1,
        dryRun: false,
        skuId: null,
        skuIds: [301, 302],
        items: [],
      },
      snapshots: {
        snapshotDate: '2026-03-30',
        rebuiltCount: 2,
        skuId: null,
        skuIds: [301, 302],
        dryRun: false,
      },
    });
  });

  it('keeps repair preview mode on by default', async () => {
    const svc = new InventoryService({ tenantId: 7, userId: 11, roles: ['boss'] });

    const reconcileSpy = jest
      .spyOn(svc as any, 'reconcileInventoryBalancesInTx')
      .mockResolvedValue({
        checkedCount: 1,
        changedCount: 0,
        dryRun: true,
        skuId: 301,
        skuIds: [301],
        items: [],
      });
    const rebuildSpy = jest
      .spyOn(svc as any, 'rebuildDailySnapshotsInTx')
      .mockResolvedValue({
        snapshotDate: '2026-03-30',
        rebuiltCount: 1,
        skuId: 301,
        skuIds: [301],
        dryRun: true,
      });

    await svc.repairInventoryState({ skuId: 301, snapshotDate: '2026-03-30' });

    expect(reconcileSpy).toHaveBeenCalledWith(
      expect.objectContaining({ query: mockQuery }),
      {
        skuId: 301,
        skuIds: undefined,
        dryRun: true,
        includeReserved: true,
        includeInTransit: true,
      },
    );
    expect(rebuildSpy).toHaveBeenCalledWith(
      expect.objectContaining({ query: mockQuery }),
      {
        snapshotDate: '2026-03-30',
        skuId: 301,
        skuIds: undefined,
        dryRun: true,
      },
    );
  });

  it('stops the repair when snapshot rebuild fails so the whole transaction can roll back', async () => {
    const svc = new InventoryService({ tenantId: 7, userId: 11, roles: ['boss'] });

    const reconcileSpy = jest
      .spyOn(svc as any, 'reconcileInventoryBalancesInTx')
      .mockResolvedValue({
        checkedCount: 1,
        changedCount: 1,
        dryRun: false,
        skuId: 301,
        skuIds: [301],
        items: [],
      });
    const rebuildSpy = jest
      .spyOn(svc as any, 'rebuildDailySnapshotsInTx')
      .mockRejectedValue(new Error('snapshot rebuild failed'));

    await expect(
      svc.repairInventoryState({
        skuId: 301,
        snapshotDate: '2026-03-30',
        dryRun: false,
      }),
    ).rejects.toThrow('snapshot rebuild failed');

    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(reconcileSpy).toHaveBeenCalledTimes(1);
    expect(rebuildSpy).toHaveBeenCalledTimes(1);
  });

  it('invalidates inventory cache only after repair transaction commits', async () => {
    const svc = new InventoryService({ tenantId: 7, userId: 11, roles: ['boss'] });

    jest
      .spyOn(svc as any, 'reconcileInventoryBalancesInTx')
      .mockImplementation(async (...args: unknown[]) => {
        const manager = args[0] as { __inventorySnapshotSkuIds?: Set<number> };
        manager.__inventorySnapshotSkuIds = new Set([301, 302]);
        return {
          checkedCount: 2,
          changedCount: 2,
          dryRun: false,
          skuId: null,
          skuIds: [301, 302],
          items: [],
        };
      });
    jest
      .spyOn(svc as any, 'rebuildDailySnapshotsInTx')
      .mockImplementation(async (...args: unknown[]) => {
        const manager = args[0] as { __inventorySnapshotSkuIds?: Set<number> };
        manager.__inventorySnapshotSkuIds = new Set([...(manager.__inventorySnapshotSkuIds ?? []), 302, 303]);
        return {
          snapshotDate: '2026-03-30',
          rebuiltCount: 3,
          skuId: null,
          skuIds: [301, 302, 303],
          dryRun: false,
        };
      });

    await svc.repairInventoryState({
      snapshotDate: '2026-03-30',
      dryRun: false,
    });

    expect(mockRedisDel).toHaveBeenCalledTimes(3);
    expect(mockRedisDel).toHaveBeenNthCalledWith(1, 'inventory:7:301');
    expect(mockRedisDel).toHaveBeenNthCalledWith(2, 'inventory:7:302');
    expect(mockRedisDel).toHaveBeenNthCalledWith(3, 'inventory:7:303');
  });

  it('does not invalidate inventory cache when repair commit fails after reconcile and rebuild sync', async () => {
    mockTransaction.mockImplementation(
      async (cb: (manager: { query: typeof mockQuery }) => Promise<unknown>) => {
        const manager = { query: mockQuery } as { query: typeof mockQuery; __inventorySnapshotSkuIds?: Set<number> };
        await cb(manager);
        throw new Error('repair commit failed');
      },
    );

    const svc = new InventoryService({ tenantId: 7, userId: 11, roles: ['boss'] });

    jest
      .spyOn(svc as any, 'reconcileInventoryBalancesInTx')
      .mockImplementation(async (...args: unknown[]) => {
        const manager = args[0] as { __inventorySnapshotSkuIds?: Set<number> };
        manager.__inventorySnapshotSkuIds = new Set([301, 302]);
        return {
          checkedCount: 2,
          changedCount: 2,
          dryRun: false,
          skuId: null,
          skuIds: [301, 302],
          items: [],
        };
      });
    jest
      .spyOn(svc as any, 'rebuildDailySnapshotsInTx')
      .mockImplementation(async (...args: unknown[]) => {
        const manager = args[0] as { __inventorySnapshotSkuIds?: Set<number> };
        manager.__inventorySnapshotSkuIds = new Set([...(manager.__inventorySnapshotSkuIds ?? []), 303]);
        return {
          snapshotDate: '2026-03-30',
          rebuiltCount: 3,
          skuId: null,
          skuIds: [301, 302, 303],
          dryRun: false,
        };
      });

    await expect(
      svc.repairInventoryState({
        snapshotDate: '2026-03-30',
        dryRun: false,
      }),
    ).rejects.toThrow('repair commit failed');
    expect(mockRedisDel).not.toHaveBeenCalled();
  });

  it('keeps a ledger-only sku consistent across reconcile and snapshot rebuild in one repair', async () => {
    const svc = new InventoryService({ tenantId: 7, userId: 11, roles: ['boss'] });

    const reconcileSpy = jest
      .spyOn(svc as any, 'reconcileInventoryBalancesInTx')
      .mockImplementation(async (...args: unknown[]) => {
        const manager = args[0] as { __inventorySnapshotSkuIds?: Set<number> };
        manager.__inventorySnapshotSkuIds = new Set([305]);
        return {
          checkedCount: 1,
          changedCount: 1,
          dryRun: false,
          skuId: 305,
          skuIds: [305],
          items: [{
            skuId: 305,
            currentQtyOnHand: '0.0000',
            expectedQtyOnHand: '6.5000',
            deltaQtyOnHand: '6.5000',
            currentQtyReserved: '0.0000',
            expectedQtyReserved: '1.5000',
            deltaQtyReserved: '1.5000',
            currentQtyInTransit: '0.0000',
            expectedQtyInTransit: '2.2500',
            deltaQtyInTransit: '2.2500',
          }],
        };
      });
    const rebuildSpy = jest
      .spyOn(svc as any, 'rebuildDailySnapshotsInTx')
      .mockImplementation(async (...args: unknown[]) => {
        const manager = args[0] as { __inventorySnapshotSkuIds?: Set<number> };
        manager.__inventorySnapshotSkuIds = new Set([...(manager.__inventorySnapshotSkuIds ?? []), 305]);
        return {
          snapshotDate: '2026-03-30',
          rebuiltCount: 1,
          skuId: 305,
          skuIds: [305],
          dryRun: false,
        };
      });

    const result = await svc.repairInventoryState({
      snapshotDate: '2026-03-30',
      skuId: 305,
      dryRun: false,
    });

    expect(reconcileSpy).toHaveBeenCalledWith(
      expect.objectContaining({ query: mockQuery }),
      {
        skuId: 305,
        skuIds: undefined,
        dryRun: false,
        includeReserved: true,
        includeInTransit: true,
      },
    );
    expect(rebuildSpy).toHaveBeenCalledWith(
      expect.objectContaining({ query: mockQuery }),
      {
        snapshotDate: '2026-03-30',
        skuId: 305,
        skuIds: undefined,
        dryRun: false,
      },
    );
    expect(result).toEqual({
      dryRun: false,
      reconcile: {
        checkedCount: 1,
        changedCount: 1,
        dryRun: false,
        skuId: 305,
        skuIds: [305],
        items: [{
          skuId: 305,
          currentQtyOnHand: '0.0000',
          expectedQtyOnHand: '6.5000',
          deltaQtyOnHand: '6.5000',
          currentQtyReserved: '0.0000',
          expectedQtyReserved: '1.5000',
          deltaQtyReserved: '1.5000',
          currentQtyInTransit: '0.0000',
          expectedQtyInTransit: '2.2500',
          deltaQtyInTransit: '2.2500',
        }],
      },
      snapshots: {
        snapshotDate: '2026-03-30',
        rebuiltCount: 1,
        skuId: 305,
        skuIds: [305],
        dryRun: false,
      },
    });
    expect(mockRedisDel).toHaveBeenCalledTimes(1);
    expect(mockRedisDel).toHaveBeenCalledWith('inventory:7:305');
  });
});
