const mockQuery = jest.fn();
const mockTransaction = jest.fn();

const asSql = (sql: unknown): string => (typeof sql === 'string' ? sql : '');

jest.mock('../../src/config/database', () => ({
  AppDataSource: {
    query: (...args: unknown[]) => mockQuery(...args),
    transaction: (...args: unknown[]) => mockTransaction(...args),
  },
}));

const mockGenerateNo = jest.fn();
jest.mock('../../src/shared/generateNo', () => ({
  generateNo: (...args: unknown[]) => mockGenerateNo(...args),
}));

import { ProductionPhase1Service } from '../../src/modules/production/production-phase1.service';

describe('ProductionPhase1Service', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockTransaction.mockReset();
    mockGenerateNo.mockReset();
    mockTransaction.mockImplementation(async (cb: (manager: { query: typeof mockQuery }) => unknown) => cb({ query: mockQuery }));
  });

  it('阻止 completed/cancelled 工单执行 release', async () => {
    mockQuery.mockResolvedValueOnce([{
      id: 88,
      sku_id: 1001,
      qty_planned: '50',
      status: 'completed',
      bom_snapshot_id: null,
      process_template_id: 9,
      process_snapshot: null,
    }]);

    const svc = new ProductionPhase1Service({ tenantId: 1, userId: 9 });
    await expect(svc.releaseOrder(88)).rejects.toThrow('completed');
  });

  it('优先使用 process_snapshot 中冻结的输出定义生成半成品节点和作业', async () => {
    let componentInsertId = 0;
    let operationInsertId = 10;
    mockQuery.mockImplementation(async (sql: unknown) => {
      const query = asSql(sql);
      if (query.includes('FROM production_orders') && query.includes('LIMIT 1')) {
        return [{
          id: 66,
          sku_id: 2001,
          qty_planned: '30',
          status: 'pending',
          bom_snapshot_id: 901,
          process_template_id: 12,
          process_snapshot: JSON.stringify({
            steps: [
              { stepNo: 1, name: '裁剪', outputType: 'semi_finished', outputSkuId: 3101 },
              { stepNo: 2, name: '包装', outputType: 'final_product', outputSkuId: null },
            ],
          }),
        }];
      }
      if (query.includes('(SELECT COUNT(*) FROM production_operations')) {
        return [{ operationCount: 0, componentCount: 0, resolutionCount: 0 }];
      }
      if (query.includes('FROM process_steps') && query.includes('WHERE template_id = ?')) {
        return [
          { id: 101, step_no: 1, step_name: '裁剪-live', output_type: 'none', output_sku_id: null },
          { id: 102, step_no: 2, step_name: '包装-live', output_type: 'none', output_sku_id: null },
        ];
      }
      if (query.includes('FROM process_templates') && query.includes('WHERE id = ?')) {
        return [{ id: 12, sku_id: 2001, name: '标准模板', version: '1.0' }];
      }
      if (query.includes('FROM process_step_materials')) {
        return [];
      }
      if (query.includes('FROM bom_headers')) {
        return [];
      }
      if (query.includes('UPDATE production_orders')) {
        return {};
      }
      if (query.includes('INSERT INTO production_order_components')) {
        componentInsertId += 1;
        return { insertId: componentInsertId };
      }
      if (query.includes('INSERT INTO production_order_sku_resolutions')) {
        return {};
      }
      if (query.includes('FROM bom_version_snapshots')) {
        return [{ snapshot_data: [] }];
      }
      if (query.includes('INSERT INTO production_operations')) {
        operationInsertId += 1;
        return { insertId: operationInsertId };
      }
      if (query.includes('INSERT INTO production_operation_dependencies')) {
        return {};
      }
      if (query.includes('SELECT COUNT(*) AS cnt') && query.includes('FROM production_order_components')) {
        return [{ cnt: 2 }];
      }
      if (query.includes('SELECT COUNT(*) AS cnt') && query.includes('FROM production_operations')) {
        return [{ cnt: 2 }];
      }
      if (query.includes('FROM production_operations op') && query.includes("op.execution_mode = 'outsource'")) {
        return [];
      }
      throw new Error(`Unexpected SQL: ${query}`);
    });

    const svc = new ProductionPhase1Service({ tenantId: 1, userId: 9 });
    const result = await svc.releaseOrder(66);

    expect(result).toEqual({
      productionOrderId: 66,
      reused: false,
      componentCount: 2,
      operationCount: 2,
    });

    const wipInsertCall = mockQuery.mock.calls.find(
      ([sql, params]) =>
        typeof sql === 'string'
        && sql.includes('INSERT INTO production_order_components')
        && Array.isArray(params)
        && params[3] === 3101
        && params[4] === 3101,
    );
    expect(wipInsertCall).toBeDefined();

    const operationInsertCalls = mockQuery.mock.calls.filter(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO production_operations'),
    );
    expect(operationInsertCalls).toHaveLength(2);
    expect(operationInsertCalls[0][1][4]).toBe(3101);
    expect(operationInsertCalls[1][1][4]).toBe(2001);

    const snapshotUpdateCall = mockQuery.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('SET process_snapshot = ?, updated_by = ?'),
    );
    expect(snapshotUpdateCall).toBeDefined();
  });

  it('工序未维护半成品输出时按 BOM 依赖生成作业和前置关系', async () => {
    let componentInsertId = 0;
    let operationInsertId = 10;
    const activeBomBySku = new Map<number, number>([
      [2001, 500],
      [3101, 501],
      [3201, 502],
      [3301, 503],
    ]);
    const bomItemsByHeader = new Map<number, unknown[]>([
      [500, [
        { id: 5001, component_sku_id: 3101, quantity: '1.0000', scrap_rate: '0.0000', sort_order: 1, child_bom_id: 501 },
        { id: 5002, component_sku_id: 3201, quantity: '1.0000', scrap_rate: '0.0000', sort_order: 2, child_bom_id: 502 },
        { id: 5003, component_sku_id: 9001, quantity: '1.0000', scrap_rate: '0.0000', sort_order: 3, child_bom_id: null },
      ]],
      [501, [
        { id: 5011, component_sku_id: 3301, quantity: '2.0000', scrap_rate: '0.0000', sort_order: 1, child_bom_id: 503 },
        { id: 5012, component_sku_id: 9002, quantity: '3.0000', scrap_rate: '0.0000', sort_order: 2, child_bom_id: null },
      ]],
      [502, []],
      [503, []],
    ]);

    mockQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM production_orders') && sql.includes('LIMIT 1')) {
        return [{
          id: 71,
          sku_id: 2001,
          qty_planned: '10',
          status: 'pending',
          bom_snapshot_id: 901,
          process_template_id: 12,
          process_snapshot: JSON.stringify({
            steps: [
              { processStepId: 101, stepNo: 1, name: '成品包装', outputType: 'final_product', outputSkuId: null },
            ],
          }),
        }];
      }
      if (sql.includes('(SELECT COUNT(*) FROM production_operations')) {
        return [{ operationCount: 0, componentCount: 0, resolutionCount: 0 }];
      }
      if (sql.includes('FROM process_steps') && sql.includes('WHERE template_id = ?')) {
        return [{
          id: 101,
          step_no: 1,
          step_name: '成品包装',
          output_type: 'final_product',
          output_sku_id: null,
          execution_mode: 'internal',
        }];
      }
      if (sql.includes('FROM bom_headers') && sql.includes('WHERE tenant_id = ?') && sql.includes('sku_id = ?')) {
        const skuId = Number(params?.[1]);
        const bomId = activeBomBySku.get(skuId);
        return bomId ? [{ id: bomId }] : [];
      }
      if (sql.includes('FROM bom_items bi') && sql.includes('child_bh.id AS child_bom_id')) {
        return bomItemsByHeader.get(Number(params?.[0])) ?? [];
      }
      if (sql.includes('INSERT INTO production_order_components')) {
        componentInsertId += 1;
        return { insertId: componentInsertId };
      }
      if (sql.includes('INSERT INTO production_order_sku_resolutions')) {
        return {};
      }
      if (sql.includes('INSERT INTO production_operations')) {
        operationInsertId += 1;
        return { insertId: operationInsertId };
      }
      if (sql.includes('INSERT INTO production_operation_dependencies')) {
        return {};
      }
      if (sql.includes('SELECT COUNT(*) AS cnt') && sql.includes('FROM production_order_components')) {
        return [{ cnt: '4' }];
      }
      if (sql.includes('SELECT COUNT(*) AS cnt') && sql.includes('FROM production_operations')) {
        return [{ cnt: '4' }];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const svc = new ProductionPhase1Service({ tenantId: 1, userId: 9 });
    const result = await svc.releaseOrder(71);

    expect(result).toEqual({
      productionOrderId: 71,
      reused: false,
      componentCount: 4,
      operationCount: 4,
    });

    const operationInsertCalls = mockQuery.mock.calls.filter(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO production_operations'),
    );
    expect(operationInsertCalls.map(([, params]) => Array.isArray(params) ? params[4] : null))
      .toEqual(expect.arrayContaining([2001, 3101, 3201, 3301]));

    const dependencyCalls = mockQuery.mock.calls.filter(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO production_operation_dependencies'),
    );
    expect(dependencyCalls).toHaveLength(3);
    expect(dependencyCalls.map(([, params]) => Array.isArray(params) ? params[3] : null))
      .toEqual(expect.arrayContaining(['10.0000', '20.0000']));
  });

  it('遇到不完整的 release 数据时拒绝静默复用', async () => {
    mockQuery
      .mockResolvedValueOnce([{
        id: 77,
        sku_id: 2001,
        qty_planned: '30',
        status: 'pending',
        bom_snapshot_id: 901,
        process_template_id: 12,
        process_snapshot: JSON.stringify({ steps: [] }),
      }])
      .mockResolvedValueOnce([{ operationCount: 2, componentCount: 1, resolutionCount: 0 }]);

    const svc = new ProductionPhase1Service({ tenantId: 1, userId: 9 });
    await expect(svc.releaseOrder(77)).rejects.toThrow('数据不完整');
  });

  it('连续半成品输出会形成清晰的 WIP 父子链', async () => {
    let componentInsertId = 0;
    let operationInsertId = 10;
    mockQuery.mockImplementation(async (sql: unknown) => {
      const query = asSql(sql);
      if (query.includes('FROM production_orders') && query.includes('LIMIT 1')) {
        return [{
          id: 68,
          sku_id: 2001,
          qty_planned: '30',
          status: 'pending',
          bom_snapshot_id: 901,
          process_template_id: 12,
          process_snapshot: JSON.stringify({
            steps: [
              { stepNo: 1, name: '裁剪', outputType: 'semi_finished', outputSkuId: 3101 },
              { stepNo: 2, name: '缝制', outputType: 'semi_finished', outputSkuId: 3201 },
              { stepNo: 3, name: '包装', outputType: 'final_product', outputSkuId: null },
            ],
          }),
        }];
      }
      if (query.includes('(SELECT COUNT(*) FROM production_operations')) {
        return [{ operationCount: 0, componentCount: 0, resolutionCount: 0 }];
      }
      if (query.includes('FROM process_steps') && query.includes('WHERE template_id = ?')) {
        return [
          { id: 101, step_no: 1, step_name: '裁剪-live', output_type: 'none', output_sku_id: null },
          { id: 102, step_no: 2, step_name: '缝制-live', output_type: 'none', output_sku_id: null },
          { id: 103, step_no: 3, step_name: '包装-live', output_type: 'none', output_sku_id: null },
        ];
      }
      if (query.includes('FROM process_templates') && query.includes('WHERE id = ?')) {
        return [{ id: 12, sku_id: 2001, name: '标准模板', version: '1.0' }];
      }
      if (query.includes('FROM process_step_materials')) {
        return [];
      }
      if (query.includes('FROM bom_headers')) {
        return [];
      }
      if (query.includes('UPDATE production_orders')) {
        return {};
      }
      if (query.includes('INSERT INTO production_order_components')) {
        componentInsertId += 1;
        return { insertId: componentInsertId };
      }
      if (query.includes('INSERT INTO production_order_sku_resolutions')) {
        return {};
      }
      if (query.includes('FROM bom_version_snapshots')) {
        return [{ snapshot_data: [] }];
      }
      if (query.includes('INSERT INTO production_operations')) {
        operationInsertId += 1;
        return { insertId: operationInsertId };
      }
      if (query.includes('INSERT INTO production_operation_dependencies')) {
        return {};
      }
      if (query.includes('SELECT COUNT(*) AS cnt') && query.includes('FROM production_order_components')) {
        return [{ cnt: 3 }];
      }
      if (query.includes('SELECT COUNT(*) AS cnt') && query.includes('FROM production_operations')) {
        return [{ cnt: 3 }];
      }
      if (query.includes('FROM production_operations op') && query.includes("op.execution_mode = 'outsource'")) {
        return [];
      }
      throw new Error(`Unexpected SQL: ${query}`);
    });

    const svc = new ProductionPhase1Service({ tenantId: 1, userId: 9 });
    const result = await svc.releaseOrder(68);

    expect(result).toEqual({
      productionOrderId: 68,
      reused: false,
      componentCount: 3,
      operationCount: 3,
    });

    const wipInsertCalls = mockQuery.mock.calls.filter(
      ([sql, params]) =>
        typeof sql === 'string'
        && sql.includes('INSERT INTO production_order_components')
        && Array.isArray(params)
        && params[5] === 'wip',
    );
    expect(wipInsertCalls).toHaveLength(2);
    expect(wipInsertCalls[0][1][2]).toBe(1);
    expect(wipInsertCalls[1][1][2]).toBe(2);
    expect(wipInsertCalls[0][1][8]).toBe('fg/wip:3101');
    expect(wipInsertCalls[1][1][8]).toBe('fg/wip:3101/wip:3201');
  });

  it('兼容 MySQL JSON 列直接返回对象而不是字符串', async () => {
    let componentInsertId = 0;
    let operationInsertId = 10;
    mockQuery.mockImplementation(async (sql: unknown) => {
      const query = asSql(sql);
      if (query.includes('FROM production_orders') && query.includes('LIMIT 1')) {
        return [{
          id: 69,
          sku_id: 2001,
          qty_planned: '30',
          status: 'pending',
          bom_snapshot_id: 901,
          process_template_id: 12,
          process_snapshot: {
            steps: [
              { id: 101, stepNo: 1, name: '裁剪', outputType: 'semi_finished', outputSkuId: 3101 },
              { id: 102, stepNo: 2, name: '包装', outputType: 'final_product', outputSkuId: null },
            ],
          },
        }];
      }
      if (query.includes('(SELECT COUNT(*) FROM production_operations')) {
        return [{ operationCount: 0, componentCount: 0, resolutionCount: 0 }];
      }
      if (query.includes('FROM process_steps') && query.includes('WHERE template_id = ?')) {
        return [
          { id: 101, step_no: 1, step_name: '裁剪-live', output_type: 'none', output_sku_id: null },
          { id: 102, step_no: 2, step_name: '包装-live', output_type: 'none', output_sku_id: null },
        ];
      }
      if (query.includes('FROM bom_headers')) {
        return [];
      }
      if (query.includes('INSERT INTO production_order_components')) {
        componentInsertId += 1;
        return { insertId: componentInsertId };
      }
      if (query.includes('INSERT INTO production_order_sku_resolutions')) {
        return {};
      }
      if (query.includes('FROM bom_version_snapshots')) {
        return [{ snapshot_data: [] }];
      }
      if (query.includes('INSERT INTO production_operations')) {
        operationInsertId += 1;
        return { insertId: operationInsertId };
      }
      if (query.includes('INSERT INTO production_operation_dependencies')) {
        return {};
      }
      if (query.includes('SELECT COUNT(*) AS cnt') && query.includes('FROM production_order_components')) {
        return [{ cnt: 2 }];
      }
      if (query.includes('SELECT COUNT(*) AS cnt') && query.includes('FROM production_operations')) {
        return [{ cnt: 2 }];
      }
      if (query.includes('FROM production_operations op') && query.includes("op.execution_mode = 'outsource'")) {
        return [];
      }
      throw new Error(`Unexpected SQL: ${query}`);
    });

    const svc = new ProductionPhase1Service({ tenantId: 1, userId: 9 });
    const result = await svc.releaseOrder(69);

    expect(result.reused).toBe(false);
    expect(result.operationCount).toBe(2);
  });

  it('复用 release 时为外协工序补齐采购建议并关联工序', async () => {
    mockGenerateNo.mockResolvedValueOnce('PS20260411-0001');
    mockQuery
      .mockResolvedValueOnce([{
        id: 70,
        work_order_no: 'WO-70',
        sku_id: 2001,
        qty_planned: '12',
        status: 'pending',
        bom_snapshot_id: 901,
        process_template_id: 12,
        process_snapshot: JSON.stringify({ steps: [] }),
      }])
      .mockResolvedValueOnce([{ operationCount: 2, componentCount: 2, resolutionCount: 2 }])
      .mockResolvedValueOnce([{
        operationId: 7001,
        productionOrderId: 70,
        outputSkuId: 3101,
        plannedQty: '12',
        stepName: '外协缝制',
        skuCode: 'WIP-3101',
        skuName: '半成品A',
        purchaseUnit: 'pcs',
      }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ supplierId: 501 }])
      .mockResolvedValueOnce([{ price: '8.80' }])
      .mockResolvedValueOnce({ affectedRows: 1 });

    const svc = new ProductionPhase1Service({ tenantId: 1, userId: 9 });
    const result = await svc.releaseOrder(70);

    expect(result).toEqual({
      productionOrderId: 70,
      reused: true,
      componentCount: 2,
      operationCount: 2,
    });
    expect(mockGenerateNo).toHaveBeenCalledWith('suggestion', 1);
    const suggestionInsertCall = mockQuery.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO purchase_suggestions'),
    );
    expect(suggestionInsertCall).toBeDefined();
    expect(String(suggestionInsertCall?.[0])).toContain("'outsource_operation'");
    expect(suggestionInsertCall?.[1]).toEqual(expect.arrayContaining([70, 7001, 3101, 501, '12.0000', '8.80', '105.60']));
  });

  it('查询工序链路时返回投入项、产出项和半成品来源状态', async () => {
    mockQuery.mockImplementation(async (sql: unknown) => {
      const query = asSql(sql);
      if (query.includes('SELECT id FROM production_orders')) {
        return [{ id: 80 }];
      }
      if (query.includes('FROM production_operations po')) {
        return [
          {
            id: 11,
            componentId: 2,
            componentType: 'wip',
            bomLevel: 1,
            bomPath: 'fg/wip:3101',
            processStepId: 101,
            stepNo: 1,
            stepName: '裁剪',
            outputSkuId: 3101,
            outputSkuCode: 'WIP-3101',
            outputSkuName: '半成品A',
            outputUnit: 'pcs',
            executionMode: 'internal',
            plannedQty: '5',
            completedQty: '4',
            status: 'in_progress',
          },
          {
            id: 12,
            componentId: 1,
            componentType: 'fg',
            bomLevel: 0,
            bomPath: 'fg',
            processStepId: 102,
            stepNo: 2,
            stepName: '包装',
            outputSkuId: 2001,
            outputSkuCode: 'FG-2001',
            outputSkuName: '成品',
            outputUnit: 'set',
            executionMode: 'internal',
            plannedQty: '5',
            completedQty: '0',
            status: 'pending',
          },
        ];
      }
      if (query.includes('JOIN bom_headers bh')) {
        return [
          {
            operationId: 11,
            skuId: 9001,
            skuCode: 'RM-9001',
            skuName: '面料',
            unit: 'm',
            itemType: 'material',
            requiredQty: '12.5',
          },
          {
            operationId: 12,
            skuId: 3101,
            skuCode: 'WIP-3101',
            skuName: '半成品A',
            unit: 'pcs',
            itemType: 'semi_finished',
            requiredQty: '5',
          },
        ];
      }
      if (query.includes('FROM production_operation_dependencies dep')) {
        return [{
          operationId: 12,
          sourceOperationId: 11,
          skuId: 3101,
          skuCode: 'WIP-3101',
          skuName: '半成品A',
          unit: 'pcs',
          itemType: 'semi_finished',
          requiredQty: '5',
          sourceStatus: 'in_progress',
          sourceCompletedQty: '4',
        }];
      }
      throw new Error(`Unexpected SQL: ${query}`);
    });

    const svc = new ProductionPhase1Service({ tenantId: 1, userId: 9 });
    const result = await svc.listOperations(80) as Array<{
      id: number;
      inputItems: Array<{
        skuId: number;
        itemType: string;
        requiredQty: string;
        sourceOperationId: number | null;
        sourceStatus: string | null;
        sourceCompletedQty: string | null;
      }>;
      outputItem: {
        skuId: number | null;
        itemType: string;
        plannedQty: string;
        completedQty: string;
      };
    }>;

    expect(result).toHaveLength(2);
    expect(result[0].outputItem).toEqual(expect.objectContaining({
      skuId: 3101,
      itemType: 'semi_finished',
      plannedQty: '5.0000',
      completedQty: '4.0000',
    }));
    expect(result[0].inputItems[0]).toEqual(expect.objectContaining({
      skuId: 9001,
      itemType: 'material',
      requiredQty: '12.5000',
    }));
    expect(result[1].inputItems[0]).toEqual(expect.objectContaining({
      skuId: 3101,
      itemType: 'semi_finished',
      requiredQty: '5.0000',
      sourceOperationId: 11,
      sourceStatus: 'in_progress',
      sourceCompletedQty: '4.0000',
    }));
  });
});
