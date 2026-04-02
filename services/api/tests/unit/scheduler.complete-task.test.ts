const mockQuery = jest.fn();
const mockTransaction = jest.fn();

jest.mock('../../src/config/database', () => ({
  AppDataSource: {
    query: (...args: unknown[]) => mockQuery(...args),
    transaction: (...args: unknown[]) => mockTransaction(...args),
  },
}));

const mockRedisDel = jest.fn();

jest.mock('../../src/config/redis', () => ({
  RedisKeys: {
    schedule: (tenantId: number, date: string) => `schedule:${tenantId}:${date}`,
    inventorySnapshot: (tenantId: number, skuId: number) => `inventory:${tenantId}:${skuId}`,
  },
  RedisTTL: {
    SCHEDULE: 300,
  },
  getRedisClient: () => ({
    set: jest.fn(),
    get: jest.fn(),
    del: (...args: unknown[]) => mockRedisDel(...args),
    setex: jest.fn(),
  }),
}));

jest.mock('../../src/modules/production/production-phase1.service', () => ({
  ProductionPhase1Service: jest.fn().mockImplementation(() => ({
    releaseOrder: jest.fn().mockResolvedValue(undefined),
  })),
}));

jest.mock('../../src/modules/production/workflow-engine.service', () => ({
  WorkflowEngineService: jest.fn().mockImplementation(() => ({
    onTaskCompleted: jest.fn().mockResolvedValue(undefined),
  })),
}));

import { SchedulerService } from '../../src/modules/production/scheduler.service';

describe('SchedulerService completeTask idempotency', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRedisDel.mockResolvedValue(1);
    mockTransaction.mockImplementation(
      async (cb: (manager: { query: typeof mockQuery }) => Promise<unknown>) => cb({ query: mockQuery }),
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('rejects duplicate completion for an already completed task before any side effects are written', async () => {
    mockQuery.mockResolvedValueOnce([{
      id: 88,
      status: 'completed',
      production_order_id: 9,
      process_step_id: 3001,
      worker_id: 9001,
      operation_id: 7001,
    }]);

    const svc = new SchedulerService({ tenantId: 1, userId: 99 });

    await expect(svc.completeTask(88, {
      completedQty: '5',
      actualHours: 1.2,
    })).rejects.toThrow('禁止重复报工');

    expect(mockTransaction).toHaveBeenCalled();
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(String(mockQuery.mock.calls[0][0])).toContain('FOR UPDATE');

    const sideEffectSql = mockQuery.mock.calls.find(
      ([sql]) => typeof sql === 'string'
        && (
          sql.includes('INSERT INTO task_completions')
          || sql.includes('INSERT INTO work_reports')
          || sql.includes('INSERT INTO inventory_transactions')
          || sql.includes('UPDATE production_operations')
        ),
    );
    expect(sideEffectSql).toBeUndefined();
  });

  it('rejects completion for a cancelled task', async () => {
    mockQuery.mockResolvedValueOnce([{
      id: 89,
      status: 'cancelled',
      production_order_id: 9,
      process_step_id: 3001,
      worker_id: 9001,
      operation_id: null,
    }]);

    const svc = new SchedulerService({ tenantId: 1, userId: 99 });

    await expect(svc.completeTask(89, {
      completedQty: '1',
      actualHours: 0.5,
    })).rejects.toThrow('任务已取消');

    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('skips duplicate finished-good inventory transaction when the same completion ledger already exists', async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM production_tasks') && sql.includes('FOR UPDATE')) {
        return [{
          id: 88,
          status: 'started',
          production_order_id: 9,
          process_step_id: 3001,
          worker_id: 9001,
          operation_id: 7001,
          output_sku_id: 4001,
          planned_qty: '5.0000',
        }];
      }
      if (sql.startsWith('UPDATE production_tasks SET')) return { affectedRows: 1 };
      if (sql.includes('INSERT INTO task_completions')) return { insertId: 501 };
      if (sql.includes('UPDATE production_operations')) return { affectedRows: 1 };
      if (sql.includes('SELECT COUNT(*) AS remaining')) return [{ remaining: '0' }];
      if (sql.startsWith('UPDATE production_orders')) return { affectedRows: 1 };
      if (sql.includes('work_order_no') && sql.includes('stock_unit')) {
        return [{ sku_id: 44, work_order_no: 'WO-9', qty_completed: '5.0000', stock_unit: 'pcs' }];
      }
      if (sql.includes('FROM inventory_transactions')) {
        return [{ cnt: '1' }];
      }
      if (sql.includes('INSERT INTO inventory_daily_snapshots')) return { affectedRows: 1 };
      if (sql.includes('SELECT dye_lot_no FROM order_dye_lot_bindings')) return [];
      if (sql.includes('INSERT INTO traceability_records')) return { insertId: 601 };
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const svc = new SchedulerService({ tenantId: 1, userId: 99 });
    (svc as any).insertTaskInputTransactions = jest.fn().mockResolvedValue(undefined);
    (svc as any).insertTaskOutputTransaction = jest.fn().mockResolvedValue(undefined);
    (svc as any).insertWorkReport = jest.fn().mockResolvedValue(undefined);
    (svc as any).syncOrderCompletion = jest.fn().mockResolvedValue(undefined);
    const snapshotSpy = jest.fn().mockResolvedValue(undefined);
    (svc as any).syncInventoryDailySnapshot = snapshotSpy;

    await svc.completeTask(88, {
      completedQty: '5',
      actualHours: 1.2,
    });

    expect(snapshotSpy).toHaveBeenCalledWith(expect.anything(), 44);

    const inventoryInsertCall = mockQuery.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO inventory_transactions'),
    );
    expect(inventoryInsertCall).toBeUndefined();

    const inventoryUpsertCall = mockQuery.mock.calls.find(
      ([sql]) => typeof sql === 'string'
        && sql.includes('INSERT INTO inventory (tenant_id, sku_id, qty_on_hand'),
    );
    expect(inventoryUpsertCall).toBeUndefined();
    expect(mockRedisDel).toHaveBeenCalledWith('inventory:1:44');
  });

  it('uses sku stock unit instead of hardcoded pcs for finished-good inventory ledger', async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM production_tasks') && sql.includes('FOR UPDATE')) {
        return [{
          id: 88,
          status: 'started',
          production_order_id: 9,
          process_step_id: 3001,
          worker_id: 9001,
          operation_id: 7001,
          output_sku_id: 4001,
          planned_qty: '5.0000',
        }];
      }
      if (sql.startsWith('UPDATE production_tasks SET')) return { affectedRows: 1 };
      if (sql.includes('INSERT INTO task_completions')) return { insertId: 501 };
      if (sql.includes('UPDATE production_operations')) return { affectedRows: 1 };
      if (sql.includes('SELECT COUNT(*) AS remaining')) return [{ remaining: '0' }];
      if (sql.startsWith('UPDATE production_orders')) return { affectedRows: 1 };
      if (sql.includes('work_order_no') && sql.includes('stock_unit')) {
        return [{ sku_id: 44, work_order_no: 'WO-9', qty_completed: '5.0000', stock_unit: 'kg' }];
      }
      if (sql.includes('FROM inventory_transactions')) {
        return [{ cnt: '0' }];
      }
      if (sql.includes('INSERT INTO inventory_transactions')) return { insertId: 701 };
      if (sql.includes('INSERT INTO inventory (tenant_id, sku_id, qty_on_hand')) return { affectedRows: 1 };
      if (sql.includes('INSERT INTO inventory_daily_snapshots')) return { affectedRows: 1 };
      if (sql.includes('SELECT dye_lot_no FROM order_dye_lot_bindings')) return [];
      if (sql.includes('INSERT INTO traceability_records')) return { insertId: 601 };
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const svc = new SchedulerService({ tenantId: 1, userId: 99 });
    (svc as any).insertTaskInputTransactions = jest.fn().mockResolvedValue(undefined);
    (svc as any).insertTaskOutputTransaction = jest.fn().mockResolvedValue(undefined);
    (svc as any).insertWorkReport = jest.fn().mockResolvedValue(undefined);
    (svc as any).syncOrderCompletion = jest.fn().mockResolvedValue(undefined);
    (svc as any).workflow = jest.fn().mockReturnValue({
      onTaskCompleted: jest.fn().mockResolvedValue(undefined),
    });

    await svc.completeTask(88, {
      completedQty: '5',
      actualHours: 1.2,
    });

    const inventoryInsertCall = mockQuery.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO inventory_transactions'),
    );
    expect(inventoryInsertCall?.[1]).toEqual([
      1,
      expect.stringMatching(/^PROD-IN-/),
      44,
      '5.0000',
      'kg',
      '5.0000',
      'kg',
      9,
      'WO-9',
      '生产工单 WO-9 全部任务完工，成品自动入库',
      99,
    ]);
  });

  it('flushes workflow-tracked semi-finished inventory cache only after completeTask transaction commits', async () => {
    mockTransaction.mockImplementation(async (cb: (manager: { query: typeof mockQuery }) => Promise<unknown>) => {
      const manager = { query: mockQuery } as { query: typeof mockQuery; __inventorySnapshotSkuIds?: Set<number> };
      const result = await cb(manager);
      expect(mockRedisDel).not.toHaveBeenCalled();
      return result;
    });
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM production_tasks') && sql.includes('FOR UPDATE')) {
        return [{
          id: 88,
          status: 'started',
          production_order_id: 9,
          process_step_id: 3001,
          worker_id: 9001,
          operation_id: 7001,
          output_sku_id: 4001,
          planned_qty: '5.0000',
        }];
      }
      if (sql.startsWith('UPDATE production_tasks SET')) return { affectedRows: 1 };
      if (sql.includes('INSERT INTO task_completions')) return { insertId: 501 };
      if (sql.includes('UPDATE production_operations')) return { affectedRows: 1 };
      if (sql.includes('SELECT COUNT(*) AS remaining')) return [{ remaining: '1' }];
      if (sql.includes('SELECT dye_lot_no FROM order_dye_lot_bindings')) return [];
      if (sql.includes('INSERT INTO traceability_records')) return { insertId: 601 };
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const svc = new SchedulerService({ tenantId: 1, userId: 99 });
    (svc as any).insertTaskInputTransactions = jest.fn().mockResolvedValue(undefined);
    (svc as any).insertTaskOutputTransaction = jest.fn().mockResolvedValue(undefined);
    (svc as any).insertWorkReport = jest.fn().mockResolvedValue(undefined);
    (svc as any).syncOrderCompletion = jest.fn().mockResolvedValue(undefined);
    (svc as any).workflow = jest.fn().mockReturnValue({
      onTaskCompleted: jest.fn().mockImplementation(async (_taskId: number, _qty: string, manager: { __inventorySnapshotSkuIds?: Set<number> }) => {
        manager.__inventorySnapshotSkuIds = new Set([990915]);
      }),
    });

    await svc.completeTask(88, {
      completedQty: '5',
      actualHours: 1.2,
    });

    expect(mockRedisDel).toHaveBeenCalledTimes(1);
    expect(mockRedisDel).toHaveBeenCalledWith('inventory:1:990915');
  });

  it('does not invalidate inventory cache when completeTask commit fails after finished-good snapshot sync', async () => {
    mockTransaction.mockImplementation(async (cb: (manager: { query: typeof mockQuery }) => Promise<unknown>) => {
      const manager = { query: mockQuery } as { query: typeof mockQuery; __inventorySnapshotSkuIds?: Set<number> };
      await cb(manager);
      throw new Error('completeTask commit failed');
    });
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM production_tasks') && sql.includes('FOR UPDATE')) {
        return [{
          id: 88,
          status: 'started',
          production_order_id: 9,
          process_step_id: 3001,
          worker_id: 9001,
          operation_id: 7001,
          output_sku_id: 4001,
          planned_qty: '5.0000',
        }];
      }
      if (sql.startsWith('UPDATE production_tasks SET')) return { affectedRows: 1 };
      if (sql.includes('INSERT INTO task_completions')) return { insertId: 501 };
      if (sql.includes('UPDATE production_operations')) return { affectedRows: 1 };
      if (sql.includes('SELECT COUNT(*) AS remaining')) return [{ remaining: '0' }];
      if (sql.startsWith('UPDATE production_orders')) return { affectedRows: 1 };
      if (sql.includes('work_order_no') && sql.includes('stock_unit')) {
        return [{ sku_id: 44, work_order_no: 'WO-9', qty_completed: '5.0000', stock_unit: 'pcs' }];
      }
      if (sql.includes('FROM inventory_transactions')) {
        return [{ cnt: '0' }];
      }
      if (sql.includes('INSERT INTO inventory_transactions')) return { insertId: 701 };
      if (sql.includes('INSERT INTO inventory (tenant_id, sku_id, qty_on_hand')) return { affectedRows: 1 };
      if (sql.includes('INSERT INTO inventory_daily_snapshots')) return { affectedRows: 1 };
      if (sql.includes('SELECT dye_lot_no FROM order_dye_lot_bindings')) return [];
      if (sql.includes('INSERT INTO traceability_records')) return { insertId: 601 };
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const svc = new SchedulerService({ tenantId: 1, userId: 99 });
    (svc as any).insertTaskInputTransactions = jest.fn().mockResolvedValue(undefined);
    (svc as any).insertTaskOutputTransaction = jest.fn().mockResolvedValue(undefined);
    (svc as any).insertWorkReport = jest.fn().mockResolvedValue(undefined);
    (svc as any).syncOrderCompletion = jest.fn().mockResolvedValue(undefined);
    (svc as any).workflow = jest.fn().mockReturnValue({
      onTaskCompleted: jest.fn().mockResolvedValue(undefined),
    });

    await expect(svc.completeTask(88, {
      completedQty: '5',
      actualHours: 1.2,
    })).rejects.toThrow('completeTask commit failed');

    const snapshotCall = mockQuery.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO inventory_daily_snapshots'),
    );
    expect(snapshotCall).toBeDefined();
    expect(mockRedisDel).not.toHaveBeenCalled();
  });

  it('does not invalidate workflow-tracked inventory cache when completeTask commit fails', async () => {
    mockTransaction.mockImplementation(async (cb: (manager: { query: typeof mockQuery }) => Promise<unknown>) => {
      const manager = { query: mockQuery } as { query: typeof mockQuery; __inventorySnapshotSkuIds?: Set<number> };
      await cb(manager);
      throw new Error('completeTask commit failed');
    });
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM production_tasks') && sql.includes('FOR UPDATE')) {
        return [{
          id: 88,
          status: 'started',
          production_order_id: 9,
          process_step_id: 3001,
          worker_id: 9001,
          operation_id: 7001,
          output_sku_id: 4001,
          planned_qty: '5.0000',
        }];
      }
      if (sql.startsWith('UPDATE production_tasks SET')) return { affectedRows: 1 };
      if (sql.includes('INSERT INTO task_completions')) return { insertId: 501 };
      if (sql.includes('UPDATE production_operations')) return { affectedRows: 1 };
      if (sql.includes('SELECT COUNT(*) AS remaining')) return [{ remaining: '1' }];
      if (sql.includes('SELECT dye_lot_no FROM order_dye_lot_bindings')) return [];
      if (sql.includes('INSERT INTO traceability_records')) return { insertId: 601 };
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const svc = new SchedulerService({ tenantId: 1, userId: 99 });
    (svc as any).insertTaskInputTransactions = jest.fn().mockResolvedValue(undefined);
    (svc as any).insertTaskOutputTransaction = jest.fn().mockResolvedValue(undefined);
    (svc as any).insertWorkReport = jest.fn().mockResolvedValue(undefined);
    (svc as any).syncOrderCompletion = jest.fn().mockResolvedValue(undefined);
    (svc as any).workflow = jest.fn().mockReturnValue({
      onTaskCompleted: jest.fn().mockImplementation(async (_taskId: number, _qty: string, manager: { __inventorySnapshotSkuIds?: Set<number> }) => {
        manager.__inventorySnapshotSkuIds = new Set([990915]);
      }),
    });

    await expect(svc.completeTask(88, {
      completedQty: '5',
      actualHours: 1.2,
    })).rejects.toThrow('completeTask commit failed');

    expect(mockRedisDel).not.toHaveBeenCalled();
  });

  it('does not invalidate inventory cache when completeTask transaction rolls back after inventory writes', async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM production_tasks') && sql.includes('FOR UPDATE')) {
        return [{
          id: 88,
          status: 'started',
          production_order_id: 9,
          process_step_id: 3001,
          worker_id: 9001,
          operation_id: 7001,
          output_sku_id: 4001,
          planned_qty: '5.0000',
        }];
      }
      if (sql.startsWith('UPDATE production_tasks SET')) return { affectedRows: 1 };
      if (sql.includes('INSERT INTO task_completions')) return { insertId: 501 };
      if (sql.includes('UPDATE production_operations')) return { affectedRows: 1 };
      if (sql.includes('SELECT COUNT(*) AS remaining')) return [{ remaining: '0' }];
      if (sql.startsWith('UPDATE production_orders')) return { affectedRows: 1 };
      if (sql.includes('work_order_no') && sql.includes('stock_unit')) {
        return [{ sku_id: 44, work_order_no: 'WO-9', qty_completed: '5.0000', stock_unit: 'pcs' }];
      }
      if (sql.includes('FROM inventory_transactions')) {
        return [{ cnt: '0' }];
      }
      if (sql.includes('INSERT INTO inventory_transactions')) return { insertId: 701 };
      if (sql.includes('INSERT INTO inventory (tenant_id, sku_id, qty_on_hand')) return { affectedRows: 1 };
      if (sql.includes('INSERT INTO inventory_daily_snapshots')) return { affectedRows: 1 };
      if (sql.includes('SELECT dye_lot_no FROM order_dye_lot_bindings')) return [];
      if (sql.includes('INSERT INTO traceability_records')) {
        throw new Error('traceability insert failed');
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const svc = new SchedulerService({ tenantId: 1, userId: 99 });
    (svc as any).insertTaskInputTransactions = jest.fn().mockResolvedValue(undefined);
    (svc as any).insertTaskOutputTransaction = jest.fn().mockResolvedValue(undefined);
    (svc as any).insertWorkReport = jest.fn().mockResolvedValue(undefined);
    (svc as any).syncOrderCompletion = jest.fn().mockResolvedValue(undefined);
    (svc as any).workflow = jest.fn().mockReturnValue({
      onTaskCompleted: jest.fn().mockResolvedValue(undefined),
    });

    await expect(svc.completeTask(88, {
      completedQty: '5',
      actualHours: 1.2,
    })).rejects.toThrow('traceability insert failed');

    expect(mockRedisDel).not.toHaveBeenCalled();
  });

  it('writes work_reports.work_date with Asia/Shanghai local date near UTC day boundary', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-03-31T16:30:00.000Z'));

    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('information_schema.columns') && sql.includes("column_name = 'worker_id'")) {
        return [{ cnt: '1' }];
      }
      if (sql.includes('FROM users u') && sql.includes('process_wages pw')) {
        return [{ unit_price: '8.0000' }];
      }
      if (sql.includes('INSERT INTO work_reports')) {
        return { insertId: 501 };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const svc = new SchedulerService({ tenantId: 1, userId: 99 });

    await (svc as any).insertWorkReport(
      { query: mockQuery },
      {
        production_order_id: 9,
        process_step_id: 12,
        worker_id: 88,
      },
      68,
      {
        completedQty: '5.0000',
        actualHours: 1.5,
        scrapQty: '1.0000',
        notes: '跨日报工',
      },
    );

    const insertCall = mockQuery.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO work_reports'),
    );
    expect(insertCall).toBeDefined();
    expect(insertCall?.[1]).toEqual([
      1,
      expect.stringMatching(/^WR/),
      88,
      9,
      68,
      12,
      '2026-04-01',
      '5.0000',
      '4.0000',
      '1.0000',
      '1.50',
      '8.0000',
      '40.00',
      '跨日报工',
      99,
      99,
    ]);
  });
});
