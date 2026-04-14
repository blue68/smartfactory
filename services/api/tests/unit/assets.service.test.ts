const mockQuery = jest.fn();
const mockTransaction = jest.fn();
const mockGenerateNo = jest.fn();

jest.mock('../../src/config/database', () => ({
  AppDataSource: {
    query: (...args: unknown[]) => mockQuery(...args),
    transaction: (...args: unknown[]) => mockTransaction(...args),
  },
}));

jest.mock('../../src/shared/generateNo', () => ({
  generateNo: (...args: unknown[]) => mockGenerateNo(...args),
}));

import { AssetService } from '../../src/modules/assets/asset.service';

describe('AssetService.returnCard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGenerateNo.mockResolvedValue('AM-260413-00001');
    mockTransaction.mockImplementation(
      async (cb: (manager: { query: typeof mockQuery }) => Promise<unknown>) => cb({ query: mockQuery }),
    );
  });

  it('returns an asset to idle, clears ownership, and writes an asset movement', async () => {
    mockQuery
      .mockResolvedValueOnce([
        {
          department_id: 25,
          custodian_user_id: 301,
          location_text: '组装车间-A02',
          status: 'in_use',
        },
      ])
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce({ insertId: 901 });

    const svc = new AssetService({ tenantId: 7, userId: 11 });
    await svc.returnCard(99, {
      locationText: '资产中转区-A01',
      notes: '设备归还仓库',
    });

    expect(mockGenerateNo).toHaveBeenCalledWith('asset_movement', 7);

    const updateCall = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes('UPDATE asset_cards'),
    );
    expect(updateCall?.[1]).toEqual([
      '资产中转区-A01',
      '设备归还仓库',
      11,
      99,
      7,
    ]);

    const movementCall = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO asset_movements'),
    );
    expect(movementCall?.[1]).toEqual([
      7,
      99,
      'AM-260413-00001',
      25,
      '组装车间-A02',
      '资产中转区-A01',
      99,
      '设备归还仓库',
      11,
    ]);
  });

  it('keeps the existing location when return location is omitted', async () => {
    mockQuery
      .mockResolvedValueOnce([
        {
          department_id: 25,
          custodian_user_id: 301,
          location_text: '资产中转区-B03',
          status: 'in_use',
        },
      ])
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce({ insertId: 902 });

    const svc = new AssetService({ tenantId: 7, userId: 11 });
    await svc.returnCard(100, {});

    const updateCall = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes('UPDATE asset_cards'),
    );
    expect(updateCall?.[1]).toEqual([
      '资产中转区-B03',
      null,
      11,
      100,
      7,
    ]);
  });

  it('rejects returning a scrapped asset', async () => {
    mockQuery.mockResolvedValueOnce([
      {
        department_id: null,
        custodian_user_id: null,
        location_text: '报废区',
        status: 'scrapped',
      },
    ]);

    const svc = new AssetService({ tenantId: 7, userId: 11 });
    await expect(svc.returnCard(101, { notes: '重复操作' })).rejects.toThrow('已报废资产不允许退回');

    expect(mockGenerateNo).not.toHaveBeenCalled();
    expect(
      mockQuery.mock.calls.some(([sql]) => String(sql).includes('UPDATE asset_cards')),
    ).toBe(false);
  });
});

describe('AssetService transfer and scrap regressions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTransaction.mockImplementation(
      async (cb: (manager: { query: typeof mockQuery }) => Promise<unknown>) => cb({ query: mockQuery }),
    );
  });

  it('transfers an asset and records movement history', async () => {
    mockGenerateNo.mockResolvedValue('AM-260413-00011');
    mockQuery
      .mockResolvedValueOnce([
        {
          department_id: 25,
          location_text: '木工车间-A01',
          status: 'idle',
        },
      ])
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce({ insertId: 911 });

    const svc = new AssetService({ tenantId: 7, userId: 11 });
    await svc.transferCard(120, {
      departmentId: 36,
      custodianUserId: 501,
      locationText: '组装车间-B02',
      notes: '车间调拨',
    });

    const updateCall = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes('UPDATE asset_cards'),
    );
    expect(updateCall?.[1]).toEqual([
      36,
      501,
      '组装车间-B02',
      '车间调拨',
      11,
      120,
      7,
    ]);

    const movementCall = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO asset_movements'),
    );
    expect(movementCall?.[1]).toEqual([
      7,
      120,
      'AM-260413-00011',
      25,
      36,
      '木工车间-A01',
      '组装车间-B02',
      120,
      '车间调拨',
      11,
    ]);
  });

  it('scraps an asset and zeroes net value', async () => {
    mockGenerateNo.mockResolvedValue('AM-260413-00012');
    mockQuery
      .mockResolvedValueOnce([
        {
          department_id: 36,
          location_text: '组装车间-B02',
          status: 'in_use',
        },
      ])
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce({ insertId: 912 });

    const svc = new AssetService({ tenantId: 7, userId: 11 });
    await svc.scrapCard(121, { notes: '设备报废' });

    const updateCall = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes('UPDATE asset_cards'),
    );
    expect(updateCall?.[1]).toEqual([
      '设备报废',
      11,
      121,
      7,
    ]);

    const movementCall = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO asset_movements'),
    );
    expect(movementCall?.[1]).toEqual([
      7,
      121,
      'AM-260413-00012',
      36,
      '组装车间-B02',
      121,
      '设备报废',
      11,
    ]);
  });

  it('accepts fixed assets into cards and writes acceptance movement', async () => {
    mockGenerateNo
      .mockResolvedValueOnce('FA-260413-00001')
      .mockResolvedValueOnce('AM-260413-00021');
    mockQuery
      .mockResolvedValueOnce([{ id: 500, po_id: 88 }])
      .mockResolvedValueOnce([
        {
          id: 7001,
          sku_id: 9802001,
          qty_received: '1',
          unit_price: '68000.00',
          amount: '68000.00',
          po_item_id: 9901,
          business_class: 'fixed_asset',
          receipt_mode: 'asset_capitalization',
          requires_acceptance: 1,
          sku_business_class: 'fixed_asset',
          control_mode: 'asset',
          asset_tracking_mode: 'serial',
          sku_name: '数控开料机',
          asset_category: 'equipment',
          requires_serial_no: 1,
        },
      ])
      .mockResolvedValueOnce([{ acceptedCount: 0 }])
      .mockResolvedValueOnce({ insertId: 10001 })
      .mockResolvedValueOnce({ insertId: 11001 });

    const svc = new AssetService({ tenantId: 7, userId: 11 });
    jest.spyOn(svc as any, 'hasPurchaseReceiptItemControlColumns').mockResolvedValue(true);

    const result = await svc.acceptAssets({
      receiptId: 500,
      items: [
        {
          receiptItemId: 7001,
          cards: [
            {
              assetName: '数控开料机',
              serialNo: 'SN-CNC-001',
              assetTagNo: 'TAG-CNC-001',
              departmentId: 25,
              custodianUserId: 301,
              locationText: '设备区-A01',
              notes: '首台设备',
            },
          ],
        },
      ],
    });

    expect(result).toEqual({
      receiptId: 500,
      createdCount: 1,
      cards: [{ id: 10001, assetNo: 'FA-260413-00001', receiptItemId: 7001 }],
    });

    const cardInsertCall = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO asset_cards'),
    );
    expect(cardInsertCall?.[1]).toEqual([
      7,
      'FA-260413-00001',
      9802001,
      500,
      7001,
      88,
      9901,
      '数控开料机',
      'equipment',
      'serial',
      'SN-CNC-001',
      'TAG-CNC-001',
      25,
      301,
      '设备区-A01',
      '68000.00',
      '68000.00',
      '首台设备',
      11,
      11,
    ]);

    const movementCall = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO asset_movements'),
    );
    expect(movementCall?.[1]).toEqual([
      7,
      10001,
      'AM-260413-00021',
      25,
      '设备区-A01',
      500,
      '首台设备',
      11,
    ]);
  });

  it('rejects acceptance when serial number is required but omitted', async () => {
    mockQuery
      .mockResolvedValueOnce([{ id: 500, po_id: 88 }])
      .mockResolvedValueOnce([
        {
          id: 7002,
          sku_id: 9802002,
          qty_received: '1',
          unit_price: '1000.00',
          amount: '1000.00',
          po_item_id: 9902,
          business_class: 'fixed_asset',
          receipt_mode: 'asset_capitalization',
          requires_acceptance: 1,
          sku_business_class: 'fixed_asset',
          control_mode: 'asset',
          asset_tracking_mode: 'serial',
          sku_name: '扫码枪',
          asset_category: 'it',
          requires_serial_no: 1,
        },
      ])
      .mockResolvedValueOnce([{ acceptedCount: 0 }]);

    const svc = new AssetService({ tenantId: 7, userId: 11 });
    jest.spyOn(svc as any, 'hasPurchaseReceiptItemControlColumns').mockResolvedValue(true);

    await expect(
      svc.acceptAssets({
        receiptId: 500,
        items: [
          {
            receiptItemId: 7002,
            cards: [
              {
                assetName: '扫码枪',
              },
            ],
          },
        ],
      }),
    ).rejects.toThrow('要求录入序列号');
  });
});
