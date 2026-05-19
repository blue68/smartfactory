jest.mock('../../src/config/database', () => ({
  AppDataSource: {
    query: jest.fn(),
  },
}));

jest.mock('../../src/modules/production/scheduler.service', () => ({
  SchedulerService: jest.fn().mockImplementation(() => ({})),
}));

const mockGetTaskWageReport = jest.fn();

jest.mock('../../src/modules/report/wage.service', () => ({
  WageService: jest.fn().mockImplementation(() => ({
    getTaskWageReport: mockGetTaskWageReport,
  })),
}));

import { AppDataSource } from '../../src/config/database';
import { ProductionService } from '../../src/modules/production/production.service';

const mockQuery = AppDataSource.query as jest.Mock;

describe('ProductionService.getTaskDetail', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetTaskWageReport.mockReset();
    mockQuery.mockResolvedValue([]);
  });

  it('aggregates dependency, material transaction and wage report fields', async () => {
    mockQuery
      .mockResolvedValueOnce([{
        id: 68,
        taskNo: 'TASK-068',
        taskDate: '2026-04-01',
        status: 'in_progress',
        plannedQty: '12.0000',
        completedQty: '6.0000',
        scrapQty: '1.0000',
        workerId: 9,
        workstationId: 3,
        processStepId: 12,
        operationId: 88,
        outputSkuId: 501,
        actualHours: '2.50',
        productionOrderId: 66,
        orderNo: 'WO-301',
        priority: 80,
        plannedFinishTime: '2026-04-03 18:00:00',
        salesOrderId: 99,
        skuId: 301,
        orderPlannedQty: '12.0000',
        processName: '裁剪',
        stepNo: 1,
        standardHours: '2.00',
        maxHours: '3.00',
        workstationName: '裁剪台 1',
        workerName: '张三',
        skuName: '成品 301',
        skuCode: 'FG-301',
        outputSkuName: '半成品 501',
        taskType: 'semi_finished',
      }])
      .mockResolvedValueOnce([{
        id: 901,
        type: '设备故障',
        description: '刀片断裂',
        severity: 'high',
        createdAt: '2026-04-01 09:00:00',
      }])
      .mockResolvedValueOnce([{
        operationId: 77,
        stepName: '开料',
        requiredQty: '12.0000',
        completedQty: '6.0000',
        status: 'started',
      }])
      .mockResolvedValueOnce([{
        id: 5011,
        ioType: 'output',
        skuId: 501,
        skuCode: 'WIP-501',
        skuName: '半成品 501',
        plannedQty: '12.0000',
        actualQty: '6.0000',
        inventoryTxId: 888,
        transactionNo: 'TX-888',
        transactionType: 'PRODUCTION_IN',
        direction: 'IN',
        transactionQty: '6.0000',
        transactionTime: '2026-04-01 11:30:00',
        referenceNo: 'WO-301',
        warehouseId: 9,
        warehouseCode: 'WH-A',
        warehouseName: '成品仓',
        locationId: 99,
        locationCode: 'A-01',
        locationName: 'A-01',
      }]);
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          skuId: 501,
          warehouseId: 9,
          warehouseCode: 'WH-A',
          warehouseName: '成品仓',
          locationId: 99,
          locationCode: 'A-01',
          locationName: 'A-01',
        },
      ])
      .mockResolvedValueOnce([
        {
          warehouseId: 1,
          warehouseCode: 'DEFAULT',
          warehouseName: '默认仓库',
          locationId: 11,
          locationCode: 'DEFAULT-UNKNOWN',
          locationName: '默认未知库位',
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    mockGetTaskWageReport.mockResolvedValue([
      [{
        reportId: 1001,
        reportNo: 'WR-1001',
        reportDate: '2026-04-01',
        workerGrade: 'skilled',
        stepName: '裁剪',
        qtyQualified: '5.0000',
        workHours: '2.50',
        unitPrice: '8.0000',
        subtotal: '40.00',
      }],
      1,
    ]);

    const svc = new ProductionService({ tenantId: 1, userId: 9 });
    const result = await svc.getTaskDetail(68) as Record<string, any>;

    expect(result.statusLabel).toBe('进行中');
    expect(result.dependencySummary).toEqual({
      blocked: true,
      blockingReason: '开料 未达到可开工数量（需 12.0000，当前 6.0000）',
      predecessors: [{
        operationId: 77,
        stepName: '开料',
        requiredQty: '12.0000',
        completedQty: '6.0000',
        status: 'started',
      }],
    });
    expect(result.materialTransactions).toEqual([{
      id: 5011,
      ioType: 'output',
      skuId: 501,
      skuCode: 'WIP-501',
      skuName: '半成品 501',
      plannedQty: '12.0000',
      actualQty: '6.0000',
      inventoryTxId: 888,
      transactionNo: 'TX-888',
      transactionType: 'PRODUCTION_IN',
      direction: 'IN',
      transactionQty: '6.0000',
      transactionTime: '2026-04-01 11:30:00',
      referenceNo: 'WO-301',
      warehouseId: 9,
      warehouseCode: 'WH-A',
      warehouseName: '成品仓',
      locationId: 99,
      locationCode: 'A-01',
      locationName: 'A-01',
    }]);
    expect(result.outputItems).toEqual([{
      itemType: 'semi_finished',
      skuId: 501,
      skuCode: 'WIP-501',
      skuName: '半成品 501',
      unit: undefined,
      plannedQty: '12.0000',
      actualQty: '6.0000',
      processStepId: 12,
      processName: '裁剪',
      warehouseId: 9,
      warehouseCode: 'WH-A',
      warehouseName: '成品仓',
      locationId: 99,
      locationCode: 'A-01',
      locationName: 'A-01',
    }]);
    expect(result.plannedFinishTime).toBe('2026-04-03 18:00:00');
    expect(result.wageReport).toEqual({
      reportId: 1001,
      reportNo: 'WR-1001',
      reportDate: '2026-04-01',
      workerGrade: 'skilled',
      stepName: '裁剪',
      qtyQualified: '5.0000',
      workHours: '2.50',
      unitPrice: '8.0000',
      subtotal: '40.00',
    });
    expect(result.exceptions).toEqual([{
      id: 901,
      type: '设备故障',
      description: '刀片断裂',
      severity: 'high',
      createdAt: '2026-04-01 09:00:00',
    }]);
    const dependencySql = mockQuery.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('FROM production_operation_dependencies dep'),
    )?.[0] as string | undefined;
    expect(dependencySql).toContain('pred_display_sku');
    expect(dependencySql).toContain('pred_proc_tpl');
    expect(mockGetTaskWageReport).toHaveBeenCalledWith({
      page: 1,
      pageSize: 1,
      taskId: 68,
    });
  });

  it('falls back to empty dependency summary when operationId is missing', async () => {
    mockQuery
      .mockResolvedValueOnce([{
        id: 69,
        taskNo: 'TASK-069',
        taskDate: '2026-04-01',
        status: 'pending',
        operationId: null,
      }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    mockGetTaskWageReport.mockResolvedValue([[], 0]);

    const svc = new ProductionService({ tenantId: 1, userId: 9 });
    const result = await svc.getTaskDetail(69) as Record<string, any>;

    expect(result.dependencySummary).toEqual({
      blocked: false,
      blockingReason: null,
      predecessors: [],
    });
    expect(result.materialTransactions).toEqual([]);
    expect(result.wageReport).toBeNull();
    expect(mockQuery).toHaveBeenCalled();
  });

  it('preserves mixed resolved and unresolved exceptions while returning wage summary fields', async () => {
    mockQuery
      .mockResolvedValueOnce([{
        id: 70,
        taskNo: 'TASK-070',
        taskDate: '2026-04-02',
        status: 'in_progress',
        actualHours: '3.80',
        maxHours: '3.00',
        operationId: 91,
      }])
      .mockResolvedValueOnce([
        {
          id: 910,
          type: '质量异常',
          description: '返工复检已通过',
          severity: 'medium',
          createdAt: '2026-03-31 09:00:00',
          resolvedAt: '2026-04-01 08:00:00',
          resolution: '返工后复检通过',
        },
        {
          id: 911,
          type: '其他',
          description: '工装偏移待确认',
          severity: 'medium',
          createdAt: '2026-04-01 09:30:00',
          resolvedAt: null,
          resolution: null,
        },
        {
          id: 912,
          type: '设备故障',
          description: '刀片断裂等待更换',
          severity: 'high',
          createdAt: '2026-04-02 10:00:00',
          resolvedAt: null,
          resolution: null,
        },
      ])
      .mockResolvedValueOnce([{
        operationId: 90,
        stepName: '开料',
        requiredQty: '12.0000',
        completedQty: '12.0000',
        status: 'completed',
      }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    mockGetTaskWageReport.mockResolvedValue([
      [{
        reportId: 1002,
        reportNo: 'WR-1002',
        reportDate: '2026-04-02',
        workerGrade: 'skilled',
        stepName: '裁剪',
        qtyQualified: '5.5000',
        workHours: '4.20',
        unitPrice: '9.50',
        subtotal: '52.25',
      }],
      1,
    ]);

    const svc = new ProductionService({ tenantId: 1, userId: 9 });
    const result = await svc.getTaskDetail(70) as Record<string, any>;

    expect(result.dependencySummary).toEqual({
      blocked: false,
      blockingReason: null,
      predecessors: [{
        operationId: 90,
        stepName: '开料',
        requiredQty: '12.0000',
        completedQty: '12.0000',
        status: 'completed',
      }],
    });
    expect(result.wageReport).toEqual({
      reportId: 1002,
      reportNo: 'WR-1002',
      reportDate: '2026-04-02',
      workerGrade: 'skilled',
      stepName: '裁剪',
      qtyQualified: '5.5000',
      workHours: '4.20',
      unitPrice: '9.50',
      subtotal: '52.25',
    });
    expect(result.exceptions).toHaveLength(3);
    expect(result.exceptions[0]).toMatchObject({
      description: '返工复检已通过',
      resolvedAt: '2026-04-01 08:00:00',
    });
    expect(result.exceptions[1]).toMatchObject({
      description: '工装偏移待确认',
      resolvedAt: null,
    });
    expect(result.exceptions[2]).toMatchObject({
      description: '刀片断裂等待更换',
      severity: 'high',
    });
  });
});
