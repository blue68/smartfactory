const mockQuery = jest.fn();
const mockTransaction = jest.fn();

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
    mockQuery
      .mockResolvedValueOnce([{
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
      }])
      .mockResolvedValueOnce([{ operationCount: 0, componentCount: 0, resolutionCount: 0 }])
      .mockResolvedValueOnce([
        { id: 101, step_no: 1, step_name: '裁剪-live', output_type: 'none', output_sku_id: null },
        { id: 102, step_no: 2, step_name: '包装-live', output_type: 'none', output_sku_id: null },
      ])
      .mockResolvedValueOnce([{ id: 12, name: '标准模板', version: '1.0' }])
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ insertId: 1 })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ insertId: 2 })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ insertId: 11 })
      .mockResolvedValueOnce({ insertId: 12 })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce([{ cnt: 2 }])
      .mockResolvedValueOnce([{ cnt: 2 }])
      .mockResolvedValueOnce([]);

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
    mockQuery
      .mockResolvedValueOnce([{
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
      }])
      .mockResolvedValueOnce([{ operationCount: 0, componentCount: 0, resolutionCount: 0 }])
      .mockResolvedValueOnce([
        { id: 101, step_no: 1, step_name: '裁剪-live', output_type: 'none', output_sku_id: null },
        { id: 102, step_no: 2, step_name: '缝制-live', output_type: 'none', output_sku_id: null },
        { id: 103, step_no: 3, step_name: '包装-live', output_type: 'none', output_sku_id: null },
      ])
      .mockResolvedValueOnce([{ id: 12, name: '标准模板', version: '1.0' }])
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ insertId: 1 })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ insertId: 2 })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ insertId: 3 })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ insertId: 11 })
      .mockResolvedValueOnce({ insertId: 12 })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ insertId: 13 })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce([{ cnt: 3 }])
      .mockResolvedValueOnce([{ cnt: 3 }])
      .mockResolvedValueOnce([]);

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
    mockQuery
      .mockResolvedValueOnce([{
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
      }])
      .mockResolvedValueOnce([{ operationCount: 0, componentCount: 0, resolutionCount: 0 }])
      .mockResolvedValueOnce([
        { id: 101, step_no: 1, step_name: '裁剪-live', output_type: 'none', output_sku_id: null },
        { id: 102, step_no: 2, step_name: '包装-live', output_type: 'none', output_sku_id: null },
      ])
      .mockResolvedValueOnce({ insertId: 1 })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ insertId: 2 })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ insertId: 11 })
      .mockResolvedValueOnce({ insertId: 12 })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce([{ cnt: 2 }])
      .mockResolvedValueOnce([{ cnt: 2 }])
      .mockResolvedValueOnce([]);

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
});
