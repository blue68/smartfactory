jest.mock('../../src/shared/generateNo', () => ({
  generateNo: jest.fn().mockResolvedValue('TX-TEST-1'),
}));

const mockRedisDel = jest.fn();

jest.mock('../../src/config/redis', () => ({
  getRedisClient: () => ({
    del: (...args: unknown[]) => mockRedisDel(...args),
  }),
  RedisKeys: {
    inventorySnapshot: (tenantId: number, skuId: number) => `inventory:${tenantId}:${skuId}`,
  },
}));

import { WorkflowEngineService } from '../../src/modules/production/workflow-engine.service';

describe('WorkflowEngineService inventory idempotency', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRedisDel.mockResolvedValue(1);
  });

  it('skips duplicate semi-finished inventory transaction when the same task ledger already exists', async () => {
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('FROM production_tasks pt') && sql.includes('LEFT JOIN production_operations po')) {
        return [{
          production_order_id: 9,
          process_step_id: 3001,
          resolved_output_sku_id: 990915,
        }];
      }
      if (sql.includes('FROM process_steps')) {
        return [{
          id: 3001,
          step_no: 1,
          template_id: 501,
          output_type: 'semi_finished',
          output_sku_id: 990903,
        }];
      }
      if (sql.includes('SELECT work_order_no')) {
        return [{ work_order_no: 'WO-9' }];
      }
      if (sql.includes('FROM inventory_transactions')) {
        return [{ cnt: '1' }];
      }
      if (sql.includes('INSERT INTO inventory_daily_snapshots')) {
        return { affectedRows: 1 };
      }
      if (sql.includes('FROM production_tasks pt') && sql.includes('INNER JOIN process_steps ps')) {
        return [{ id: 88, status: 'completed' }];
      }
      if (sql.includes('SELECT id, step_no FROM process_steps')) {
        return [];
      }
      if (sql.includes('pt.status NOT IN (\'completed\', \'cancelled\', \'started\')')) {
        return [];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const svc = new WorkflowEngineService({ tenantId: 1, userId: 99 });
    await svc.onTaskCompleted(88, '5.0000', { query } as never, { syncOrderCompletion: false });

    const inventoryInsertCall = query.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO inventory_transactions'),
    );
    expect(inventoryInsertCall).toBeUndefined();

    const inventoryUpsertCall = query.mock.calls.find(
      ([sql]) => typeof sql === 'string'
        && sql.includes('INSERT INTO inventory (tenant_id, sku_id, qty_on_hand'),
    );
    expect(inventoryUpsertCall).toBeUndefined();

    const snapshotCall = query.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO inventory_daily_snapshots'),
    );
    expect(snapshotCall).toBeDefined();
    expect(mockRedisDel).not.toHaveBeenCalled();
  });

  it('tracks semi-finished inventory cache invalidation on the transaction manager instead of deleting immediately', async () => {
    const manager = { query: jest.fn(async (sql: string) => {
      if (sql.includes('FROM production_tasks pt') && sql.includes('LEFT JOIN production_operations po')) {
        return [{
          production_order_id: 9,
          process_step_id: 3001,
          resolved_output_sku_id: 990915,
        }];
      }
      if (sql.includes('FROM process_steps')) {
        return [{
          id: 3001,
          step_no: 1,
          template_id: 501,
          output_type: 'semi_finished',
          output_sku_id: 990903,
        }];
      }
      if (sql.includes('SELECT work_order_no')) {
        return [{ work_order_no: 'WO-9' }];
      }
      if (sql.includes('FROM inventory_transactions')) {
        return [{ cnt: '0' }];
      }
      if (sql.includes('INSERT INTO inventory_transactions')) {
        return { insertId: 7001 };
      }
      if (sql.includes('INSERT INTO inventory (tenant_id, sku_id, qty_on_hand')) {
        return { affectedRows: 1 };
      }
      if (sql.includes('INSERT INTO inventory_daily_snapshots')) {
        return { affectedRows: 1 };
      }
      if (sql.includes('FROM production_tasks pt') && sql.includes('INNER JOIN process_steps ps')) {
        return [{ id: 88, status: 'completed' }];
      }
      if (sql.includes('SELECT id, step_no FROM process_steps')) {
        return [];
      }
      if (sql.includes('pt.status NOT IN (\'completed\', \'cancelled\', \'started\')')) {
        return [];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    }) };

    const svc = new WorkflowEngineService({ tenantId: 1, userId: 99 });
    await svc.onTaskCompleted(88, '5.0000', manager as never, { syncOrderCompletion: false });

    expect(mockRedisDel).not.toHaveBeenCalled();
    expect((manager as any).__inventorySnapshotSkuIds).toEqual(new Set([990915]));
  });
});
