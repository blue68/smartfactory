const mockQuery = jest.fn();
const mockTransaction = jest.fn();
const mockRedisDel = jest.fn();
const mockGenerateNo = jest.fn();
const mockResolveWarehouseLocationBinding = jest.fn();
const mockResolveWarehouseDataScope = jest.fn();
const mockAssertWarehouseInScope = jest.fn();
const mockSyncInventoryDailySnapshotForSku = jest.fn();

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
}));

jest.mock('../../src/shared/generateNo', () => ({
  generateNo: (...args: unknown[]) => mockGenerateNo(...args),
}));

jest.mock('../../src/modules/access-control/warehouse-data-scope', () => ({
  resolveWarehouseDataScope: (...args: unknown[]) => mockResolveWarehouseDataScope(...args),
  assertWarehouseInScope: (...args: unknown[]) => mockAssertWarehouseInScope(...args),
}));

jest.mock('../../src/modules/inventory/warehouse-location.resolver', () => ({
  resolveWarehouseLocationBinding: (...args: unknown[]) => mockResolveWarehouseLocationBinding(...args),
}));

jest.mock('../../src/modules/inventory/daily-snapshot.util', () => ({
  syncInventoryDailySnapshotForSku: (...args: unknown[]) => mockSyncInventoryDailySnapshotForSku(...args),
}));

import { ConsumableService } from '../../src/modules/consumables/consumable.service';

describe('ConsumableService regressions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGenerateNo.mockResolvedValue('CI-260413-00001');
    mockRedisDel.mockResolvedValue(1);
    mockResolveWarehouseDataScope.mockResolvedValue({ mode: 'all', warehouseIds: [] });
    mockAssertWarehouseInScope.mockImplementation(() => undefined);
    mockResolveWarehouseLocationBinding.mockResolvedValue({
      warehouseId: 1,
      locationId: 2,
      warehouseCode: 'WH-CONS',
      locationCode: 'LOC-A01',
      warningCode: null,
    });
    mockSyncInventoryDailySnapshotForSku.mockResolvedValue(undefined);
    mockTransaction.mockImplementation(
      async (cb: (manager: { query: typeof mockQuery }) => Promise<unknown>) => cb({ query: mockQuery }),
    );
  });

  it('creates issue order and embeds dye lot note on item rows', async () => {
    mockQuery
      .mockResolvedValueOnce({ insertId: 801 })
      .mockResolvedValueOnce({ insertId: 901 });

    const svc = new ConsumableService({ tenantId: 7, userId: 11 });
    jest.spyOn(svc as any, 'getSkuControl').mockResolvedValue({
      skuId: 301,
      skuCode: 'CONS-001',
      skuName: '砂纸',
      stockUnit: 'pcs',
      hasDyeLot: true,
      issueDeptRequired: true,
    });

    const result = await svc.createIssueOrder({
      requestDepartmentId: 25,
      purpose: '设备保养',
      notes: '月度领用',
      items: [
        {
          skuId: 301,
          qtyRequested: '5',
          issueUnit: 'pcs',
          warehouseId: 1,
          locationId: 2,
          dyeLotNo: 'LOT-01',
          budgetCode: 'BD-01',
          notes: '第一批',
        },
      ],
    });

    expect(result).toEqual({ id: 801, issueNo: 'CI-260413-00001' });
    expect(mockGenerateNo).toHaveBeenCalledWith('consumable_issue', 7);

    const itemInsertCall = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO consumable_issue_items'),
    );
    expect(itemInsertCall?.[1]).toEqual([
      7,
      801,
      301,
      1,
      2,
      '5',
      'pcs',
      'BD-01',
      'dyeLotNo=LOT-01\n第一批',
      11,
      11,
    ]);
  });

  it('approves draft issue orders only', async () => {
    mockQuery
      .mockResolvedValueOnce([{ status: 'draft', notes: '原始备注' }])
      .mockResolvedValueOnce({ affectedRows: 1 });

    const svc = new ConsumableService({ tenantId: 7, userId: 11 });
    await svc.approveIssueOrder(88, { approved: true, notes: '同意发放' });

    const updateCall = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes('UPDATE consumable_issue_orders'),
    );
    expect(updateCall?.[1]).toEqual([
      'approved',
      11,
      '原始备注\n同意发放',
      11,
      88,
      7,
    ]);
  });

  it('executes approved issue orders, writes inventory ledger and refreshes cache', async () => {
    mockGenerateNo.mockResolvedValue('TX-260413-00001');
    mockQuery
      .mockResolvedValueOnce([
        {
          issue_no: 'CI-260413-00001',
          status: 'approved',
          request_department_id: 25,
          purpose: '设备保养',
          notes: '领用备注',
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 901,
          sku_id: 301,
          warehouse_id: 1,
          location_id: 2,
          qty_requested: '5',
          issue_unit: 'pcs',
          budget_code: 'BD-01',
          notes: 'dyeLotNo=LOT-01\n第一批',
        },
      ])
      .mockResolvedValueOnce([
        { qty_on_hand: '20.0000', qty_reserved: '2.0000' },
      ])
      .mockResolvedValueOnce([
        { qty_on_hand: '10.0000', qty_reserved: '1.0000' },
      ])
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce({ insertId: 1001 })
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce({ affectedRows: 1 });

    const svc = new ConsumableService({ tenantId: 7, userId: 11 });
    jest.spyOn(svc as any, 'getSkuControl').mockResolvedValue({
      skuId: 301,
      skuCode: 'CONS-001',
      skuName: '砂纸',
      stockUnit: 'pcs',
      hasDyeLot: true,
      issueDeptRequired: true,
    });
    jest.spyOn(svc as any, 'getUnitConversions').mockResolvedValue([]);
    jest.spyOn(svc as any, 'hasInventoryTransactionBusinessColumns').mockResolvedValue(true);

    const result = await svc.executeIssueOrder(88, { notes: '仓库已发放' });

    expect(result).toEqual({ id: 88, issueNo: 'CI-260413-00001', issuedItemCount: 1 });
    expect(mockGenerateNo).toHaveBeenCalledWith('transaction', 7);
    expect(mockResolveWarehouseLocationBinding).toHaveBeenCalled();
    expect(mockAssertWarehouseInScope).toHaveBeenCalledWith({ mode: 'all', warehouseIds: [] }, 1);
    expect(mockSyncInventoryDailySnapshotForSku).toHaveBeenCalledWith({ query: mockQuery }, 7, 301);

    const txInsertCall = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO inventory_transactions'),
    );
    expect(txInsertCall?.[1]).toEqual([
      7,
      'TX-260413-00001',
      301,
      'consumable',
      25,
      88,
      'CONSUMABLE_OUT',
      'OUT',
      1,
      2,
      'consumable_issue:execute',
      '5',
      'pcs',
      '5.0000',
      'pcs',
      'LOT-01',
      'consumable_issue_order',
      88,
      'CI-260413-00001',
      '设备保养\n仓库已发放\ndyeLotNo=LOT-01\n第一批',
      11,
      11,
    ]);

    expect(mockRedisDel).toHaveBeenCalledWith('inventory:7:301');
  });

  it('rejects executing issue orders that are not approved', async () => {
    mockQuery.mockResolvedValueOnce([
      {
        issue_no: 'CI-260413-00002',
        status: 'draft',
        request_department_id: 25,
        purpose: '设备保养',
        notes: null,
      },
    ]);

    const svc = new ConsumableService({ tenantId: 7, userId: 11 });
    await expect(svc.executeIssueOrder(89, {})).rejects.toThrow('不允许发放');

    expect(
      mockQuery.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO inventory_transactions')),
    ).toBe(false);
    expect(mockRedisDel).not.toHaveBeenCalled();
  });
});
