jest.mock('../../src/config/database', () => ({
  AppDataSource: {
    transaction: jest.fn(),
    query: jest.fn(),
  },
}));

jest.mock('../../src/modules/inventory/warehouse-location.resolver', () => ({
  ensureProductionWipWarehouseLocation: jest.fn().mockResolvedValue({
    warehouseId: 88,
    locationId: 99,
    warehouseCode: 'PROD-WIP',
    locationCode: 'PROD-WIP-LINE',
  }),
  resolveWarehouseLocationBinding: jest.fn().mockResolvedValue({
    warehouseId: 11,
    locationId: 22,
    warehouseCode: 'WH-RM',
    locationCode: 'RM-01',
    warningCode: null,
  }),
}));

import { AppDataSource } from '../../src/config/database';
import { SchedulerService } from '../../src/modules/production/scheduler.service';

const mockTransaction = AppDataSource.transaction as jest.Mock;

describe('SchedulerService.issueTaskMaterials', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('routes issued materials into the production WIP warehouse/location', async () => {
    const manager = { query: jest.fn() };
    mockTransaction.mockImplementation(async (callback) => callback(manager));

    const svc = new SchedulerService({ tenantId: 1, userId: 99 });
    (svc as any).getLockedTask = jest.fn().mockResolvedValue({
      id: 1,
      task_no: 'TASK-001',
      status: 'pending',
      started_at: null,
      production_order_id: 3001,
      process_step_id: 4001,
      worker_id: 5001,
      operation_id: 6001,
      output_sku_id: null,
      planned_qty: '10.0000',
    });
    (svc as any).fetchTaskInputMaterialPlans = jest.fn().mockResolvedValue([]);
    (svc as any).ensureTaskInputTransactions = jest.fn().mockResolvedValue(new Map([[5, 7001]]));
    (svc as any).consumeTrackedInventorySnapshotSkuIds = jest.fn().mockReturnValue([]);
    (svc as any).invalidateInventorySnapshotCaches = jest.fn().mockResolvedValue(undefined);
    const transferSpy = jest.fn().mockResolvedValue({
      qty: '3.5000',
      warehouseId: 88,
      locationId: 99,
      transactionNo: 'TX-WIP-001',
    });
    (svc as any).transferTaskInventory = transferSpy;

    const result = await svc.issueTaskMaterials(1, {
      items: [{ skuId: 5, qty: '3.5', warehouseId: 11, locationId: 22 }],
    });

    expect(transferSpy).toHaveBeenCalledWith(
      manager,
      expect.objectContaining({
        taskId: 1,
        skuId: 5,
        sourceWarehouseId: 11,
        sourceLocationId: 22,
        targetWarehouseId: 88,
        targetLocationId: 99,
        movementType: 'issue',
      }),
    );
    expect(result).toEqual({
      taskId: 1,
      results: [{
        skuId: 5,
        qty: '3.5000',
        warehouseId: 88,
        locationId: 99,
        transactionNo: 'TX-WIP-001',
      }],
    });
  });
});
