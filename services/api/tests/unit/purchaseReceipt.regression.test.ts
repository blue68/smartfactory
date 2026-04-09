import { AppDataSource } from '../../src/config/database';
import { PurchaseService } from '../../src/modules/purchase/purchase.service';
import { ThreeWayMatchService } from '../../src/modules/purchase/threeWayMatch.service';

jest.mock('../../src/config/database', () => ({
  AppDataSource: {
    query: jest.fn(),
    transaction: jest.fn(),
  },
}));

const mockAppDataSource = AppDataSource as unknown as {
  query: jest.Mock;
  transaction: jest.Mock;
};

describe('Purchase receipt regressions', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    mockAppDataSource.query.mockReset();
    mockAppDataSource.transaction.mockReset();
    (PurchaseService as any).purchaseReceiptDeliveryColumn = 'delivery_note_id';
    (PurchaseService as any).purchaseReceiptItemsTableSupported = true;
    (PurchaseService as any).purchaseReceiptItemDyeLotSupported = false;
    (PurchaseService as any).incomingInspectionItemDyeLotSupported = false;
    (ThreeWayMatchService as any).purchaseReceiptDeliveryColumn = 'delivery_note_id';
    (ThreeWayMatchService as any).purchaseReceiptItemsTableSupported = true;
    (ThreeWayMatchService as any).purchaseReceiptItemDyeLotSupported = false;
    (ThreeWayMatchService as any).incomingInspectionItemDyeLotSupported = false;
    (ThreeWayMatchService as any).deliveryNoteItemDyeLotSupported = false;
  });

  it('lists purchase receipts with receipt items total qty instead of inventory transaction aggregation', async () => {
    mockAppDataSource.query
      .mockResolvedValueOnce([
        {
          id: 1,
          receiptNo: 'PR-001',
          poId: 9,
          poNo: 'PO-001',
          poStatus: 'partial_received',
          deliveryNoteId: 5,
          deliveryNo: 'DN-001',
          status: 'confirmed',
          totalAmount: '1200.00',
          notes: null,
          receivedAt: '2026-03-24 10:00:00',
          supplierName: '供应商A',
          inspectionNo: 'IQC-001',
          operatorName: '仓管员A',
          totalQty: '60',
        },
      ])
      .mockResolvedValueOnce([{ total: 1 }]);

    const svc = new PurchaseService({ tenantId: 7, userId: 11 });
    const result = await svc.listReceipts({ page: 1, pageSize: 20 });

    expect(result.total).toBe(1);
    expect(result.list[0]).toMatchObject({ receiptNo: 'PR-001', totalQty: '60' });
    expect(String(mockAppDataSource.query.mock.calls[0][0])).toContain('LEFT JOIN purchase_receipt_items pri');
  });

  it('applies warehouse_assigned filter when listing purchase receipts', async () => {
    mockAppDataSource.query
      .mockResolvedValueOnce([{ id: 5 }])
      .mockResolvedValueOnce([
        {
          id: 1,
          receiptNo: 'PR-001',
          poId: 9,
          poNo: 'PO-001',
          poStatus: 'partial_received',
          deliveryNoteId: 5,
          deliveryNo: 'DN-001',
          status: 'confirmed',
          totalAmount: '1200.00',
          notes: null,
          receivedAt: '2026-03-24 10:00:00',
          supplierName: '供应商A',
          inspectionNo: 'IQC-001',
          operatorName: '仓管员A',
          totalQty: '60',
        },
      ])
      .mockResolvedValueOnce([{ total: 1 }]);

    const svc = new PurchaseService({
      tenantId: 7,
      userId: 11,
      permissionSnapshot: {
        version: 'test',
        scopeLevel: 'tenant',
        originTenantId: 7,
        contextTenantId: 7,
        menuCodes: [],
        actionCodes: [],
        featureFlags: [],
        dataScopes: [{ scopeType: 'warehouse_assigned', scopeValues: ['WH-A'] }],
      },
    });
    await svc.listReceipts({ page: 1, pageSize: 20 });

    const listSql = String(mockAppDataSource.query.mock.calls[1]?.[0] ?? '');
    const listParams = mockAppDataSource.query.mock.calls[1]?.[1] as unknown[];

    expect(listSql).toContain("it_scope.reference_type = 'purchase_receipt'");
    expect(listSql).toContain('it_scope.warehouse_id IN (?)');
    expect(listParams[0]).toBe(7);
    expect(listParams).toContain(5);
  });

  it('returns receipt detail with receipt items and inspection trace', async () => {
    mockAppDataSource.query
      .mockResolvedValueOnce([
        {
          id: 1,
          receiptNo: 'PR-001',
          poId: 9,
          deliveryNoteId: 5,
          poNo: 'PO-001',
          poStatus: 'received',
          deliveryNo: 'DN-001',
          supplierName: '供应商A',
          inspectionNo: 'IQC-001',
          operatorName: '仓管员A',
          receivedAt: '2026-03-24 10:00:00',
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 101,
          skuId: 201,
          skuCode: 'RM-201',
          skuName: '木板A',
          qtyReceived: '40',
          purchaseUnit: 'pcs',
          unitPrice: '30.00',
          amount: '1200.00',
        },
      ]);

    const svc = new PurchaseService({ tenantId: 7, userId: 11 });
    const detail = await svc.getReceiptById(1) as Record<string, any>;

    expect(detail.receiptNo).toBe('PR-001');
    expect(detail.inspectionNo).toBe('IQC-001');
    expect(detail.items[0]).toMatchObject({ skuCode: 'RM-201', qtyReceived: '40' });
  });

  it('rejects receipt detail outside warehouse_assigned scope', async () => {
    mockAppDataSource.query
      .mockResolvedValueOnce([{ id: 8 }])
      .mockResolvedValueOnce([]);

    const svc = new PurchaseService({
      tenantId: 7,
      userId: 11,
      permissionSnapshot: {
        version: 'test',
        scopeLevel: 'tenant',
        originTenantId: 7,
        contextTenantId: 7,
        menuCodes: [],
        actionCodes: [],
        featureFlags: [],
        dataScopes: [{ scopeType: 'warehouse_assigned', scopeValues: [8] }],
      },
    });

    await expect(svc.getReceiptById(1)).rejects.toThrow('采购入库单不存在');

    const detailSql = String(mockAppDataSource.query.mock.calls[1]?.[0] ?? '');
    expect(detailSql).toContain('it_scope.reference_id = pr.id');
    expect(detailSql).toContain('it_scope.warehouse_id IN (?)');
  });

  it('returns receipt detail with dye lot number when receipt item schema supports it', async () => {
    (PurchaseService as any).purchaseReceiptItemDyeLotSupported = true;
    mockAppDataSource.query
      .mockResolvedValueOnce([
        {
          id: 1,
          receiptNo: 'PR-002',
          poId: 9,
          deliveryNoteId: 5,
          poNo: 'PO-001',
          poStatus: 'received',
          deliveryNo: 'DN-001',
          supplierName: '供应商A',
          inspectionNo: 'IQC-001',
          operatorName: '仓管员A',
          receivedAt: '2026-03-24 10:00:00',
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 101,
          skuId: 201,
          skuCode: 'RM-201',
          skuName: '布料A',
          dyeLotNo: 'DY-20260327-C02',
          qtyReceived: '40',
          purchaseUnit: 'pcs',
          unitPrice: '30.00',
          amount: '1200.00',
        },
      ]);

    const svc = new PurchaseService({ tenantId: 7, userId: 11 });
    const detail = await svc.getReceiptById(1) as Record<string, any>;

    expect(detail.items[0]).toMatchObject({ skuCode: 'RM-201', dyeLotNo: 'DY-20260327-C02' });
  });

  it('loads receipt quantities from purchase_receipt_items in three-way match', async () => {
    mockAppDataSource.query.mockResolvedValue([{ sku_id: 201, qty_received: '40' }]);

    const svc = new ThreeWayMatchService({ tenantId: 7, userId: 11 });
    const result = await (svc as any).getReceiptItems(1);

    expect(result).toEqual([{ sku_id: 201, qty_received: '40.0000', dye_lot_nos: [] }]);
    expect(String(mockAppDataSource.query.mock.calls[0][0])).toContain('FROM purchase_receipt_items');
    expect(String(mockAppDataSource.query.mock.calls[0][0])).not.toContain('inventory_transactions');
  });

  it('falls back to inspection passed qty when receipt item table exists but current receipt has no item rows', async () => {
    (ThreeWayMatchService as any).purchaseReceiptDeliveryColumn = 'delivery_note_id';
    (ThreeWayMatchService as any).purchaseReceiptItemsTableSupported = true;

    mockAppDataSource.query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ sku_id: 201, qty_received: '12' }]);

    const svc = new ThreeWayMatchService({ tenantId: 7, userId: 11 });
    const result = await (svc as any).getReceiptItems(1);

    expect(result).toEqual([{ sku_id: 201, qty_received: '12.0000', dye_lot_nos: [] }]);
    expect(String(mockAppDataSource.query.mock.calls[0][0])).toContain('FROM purchase_receipt_items');
    expect(String(mockAppDataSource.query.mock.calls[1][0])).toContain('incoming_inspection_items ii');
    expect(String(mockAppDataSource.query.mock.calls[1][0])).toContain('pr.delivery_note_id');
  });

  it('groups receipt dye lots when purchase receipt items include dye lot numbers', async () => {
    (ThreeWayMatchService as any).purchaseReceiptItemDyeLotSupported = true;
    mockAppDataSource.query.mockResolvedValue([
      { sku_id: 201, qty_received: '20', dye_lot_no: 'DY-A01' },
      { sku_id: 201, qty_received: '10', dye_lot_no: 'DY-A02' },
      { sku_id: 201, qty_received: '10', dye_lot_no: 'DY-A01' },
    ]);

    const svc = new ThreeWayMatchService({ tenantId: 7, userId: 11 });
    const result = await (svc as any).getReceiptItems(1);

    expect(result).toEqual([
      { sku_id: 201, qty_received: '40.0000', dye_lot_nos: ['DY-A01', 'DY-A02'] },
    ]);
  });

  it('falls back to legacy dn_id and inspection passed qty when receipt item table is absent', async () => {
    (PurchaseService as any).purchaseReceiptDeliveryColumn = 'dn_id';
    (PurchaseService as any).purchaseReceiptItemsTableSupported = false;

    mockAppDataSource.query
      .mockResolvedValueOnce([
        {
          id: 1,
          receiptNo: 'PR-LEGACY-001',
          poId: 9,
          deliveryNoteId: 5,
          status: 'confirmed',
          notes: null,
          receivedAt: '2026-03-24 10:00:00',
          poNo: 'PO-001',
          poStatus: 'received',
          deliveryNo: 'DN-001',
          supplierName: '供应商A',
          inspectionNo: 'IQC-001',
          operatorName: '仓管员A',
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 101,
          skuId: 201,
          skuCode: 'RM-201',
          skuName: '木板A',
          qtyReceived: '40',
          purchaseUnit: 'pcs',
          unitPrice: '30.00',
          amount: '1200.00',
        },
      ]);

    const svc = new PurchaseService({ tenantId: 7, userId: 11 });
    const detail = await svc.getReceiptById(1) as Record<string, any>;

    expect(String(mockAppDataSource.query.mock.calls[0][0])).toContain('pr.dn_id AS deliveryNoteId');
    expect(String(mockAppDataSource.query.mock.calls[1][0])).toContain('incoming_inspection_items ii');
    expect(detail.totalAmount).toBe('1200.00');
    expect(detail.items[0]).toMatchObject({ skuCode: 'RM-201', qtyReceived: '40' });
  });

  it('falls back to inspection passed qty in three-way match when receipt item table is absent', async () => {
    (ThreeWayMatchService as any).purchaseReceiptDeliveryColumn = 'dn_id';
    (ThreeWayMatchService as any).purchaseReceiptItemsTableSupported = false;
    mockAppDataSource.query.mockResolvedValue([{ sku_id: 201, qty_received: '40' }]);

    const svc = new ThreeWayMatchService({ tenantId: 7, userId: 11 });
    const result = await (svc as any).getReceiptItems(1);

    expect(result).toEqual([{ sku_id: 201, qty_received: '40.0000', dye_lot_nos: [] }]);
    expect(String(mockAppDataSource.query.mock.calls[0][0])).toContain('pr.dn_id');
    expect(String(mockAppDataSource.query.mock.calls[0][0])).toContain('incoming_inspection_items ii');
  });

  it('maps three-way match list rows into frontend-friendly detail shape', async () => {
    mockAppDataSource.query
      .mockResolvedValueOnce([
        {
          matchId: 71,
          poId: 9,
          poNo: 'PO-001',
          deliveryNoteId: 5,
          deliveryNo: 'DN-001',
          receiptId: 3,
          receiptNo: 'PR-001',
          matchStatus: 'qty_diff',
          diffItemsJson: JSON.stringify([{ skuId: 201, skuName: '木板A', qtyDiff: '-1.0000' }]),
          createdAt: '2026-03-24 10:00:00',
          confirmedAt: null,
          confirmedBy: null,
          diffReason: null,
          diffNotes: null,
          supplierId: 12,
          supplierName: '供应商A',
        },
      ])
      .mockResolvedValueOnce([{ total: 1 }]);

    const svc = new ThreeWayMatchService({ tenantId: 7, userId: 11 });
    const result = await svc.listMatchRecords({ page: 1, pageSize: 20, poId: 9, receiptId: 3 });

    expect(String(mockAppDataSource.query.mock.calls[0][0])).toContain('m.po_id = ?');
    expect(String(mockAppDataSource.query.mock.calls[0][0])).toContain('m.receipt_id = ?');
    expect(result.list[0]).toMatchObject({
      matchId: 71,
      poNo: 'PO-001',
      receiptNo: 'PR-001',
      supplierName: '供应商A',
      diffItems: [{ skuId: 201, skuName: '木板A', qtyDiff: '-1.0000' }],
    });
  });

  it('returns three-way match detail with parsed diff items', async () => {
    mockAppDataSource.query.mockResolvedValueOnce([
      {
        matchId: 72,
        poId: 10,
        poNo: 'PO-002',
        deliveryNoteId: 6,
        deliveryNo: 'DN-002',
        receiptId: 4,
        receiptNo: 'PR-002',
        matchStatus: 'matched',
        diffItemsJson: JSON.stringify([{ skuId: 301, skuName: '布料B', priceDiff: '5.00' }]),
        createdAt: '2026-03-24 12:00:00',
        confirmedAt: '2026-03-24 13:00:00',
        confirmedBy: '采购员A',
        diffReason: 'price_adjust',
        diffNotes: '已沟通确认',
        supplierName: '供应商B',
      },
    ]);

    const svc = new ThreeWayMatchService({ tenantId: 7, userId: 11 });
    const detail = await svc.getMatchById(72);

    expect(detail).toMatchObject({
      matchId: 72,
      poNo: 'PO-002',
      confirmedBy: '采购员A',
      supplierName: '供应商B',
      diffItems: [{ skuId: 301, skuName: '布料B', priceDiff: '5.00' }],
    });
  });

  it('normalizes sku_id types in three-way match to avoid duplicated diff rows', async () => {
    (ThreeWayMatchService as any).purchaseReceiptItemsTableSupported = true;
    (ThreeWayMatchService as any).deliveryNoteItemDyeLotSupported = false;
    (ThreeWayMatchService as any).purchaseReceiptItemDyeLotSupported = false;

    mockAppDataSource.query.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT po_id FROM delivery_notes')) return [{ po_id: 9 }];
      if (sql.includes('SELECT po_id FROM purchase_receipts')) return [{ po_id: 9 }];
      if (sql.includes('FROM purchase_order_items poi')) {
        return [{
          sku_id: '990913',
          sku_name: 'E2E部分退货板材',
          has_dye_lot: 0,
          qty_ordered: '20',
          purchase_unit: '张',
          unit_price: '120.00',
        }];
      }
      if (sql.includes('FROM delivery_note_items dni')) {
        return [{
          sku_id: 990913,
          sku_name: 'E2E部分退货板材',
          has_dye_lot: 0,
          qty_delivered: '20',
          unit_price: '120.00',
          dye_lot_no: null,
        }];
      }
      if (sql.includes('FROM purchase_receipt_items')) {
        return [{ sku_id: 990913, qty_received: '12', dye_lot_no: null }];
      }
      if (sql.includes('SELECT AVG(unit_price) AS avg_price')) return [{ avg_price: '120.00' }];
      if (sql.includes('SELECT id FROM three_way_match_records')) return [];
      if (sql.includes('INSERT INTO three_way_match_records')) return { insertId: 9001 };
      if (sql.includes('SELECT po_no FROM purchase_orders')) return [{ po_no: 'PO-001' }];
      if (sql.includes('SELECT delivery_no FROM delivery_notes')) return [{ delivery_no: 'DN-001' }];
      if (sql.includes('SELECT receipt_no FROM purchase_receipts')) return [{ receipt_no: 'RC-001' }];
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const svc = new ThreeWayMatchService({ tenantId: 7, userId: 11 });
    const result = await svc.runMatch(9, 5, 3);

    expect(result.matchStatus).toBe('qty_diff');
    expect(result.diffItems).toHaveLength(1);
    expect(result.diffItems[0]).toMatchObject({
      skuId: 990913,
      poQty: '20.0000',
      dnQty: '20.0000',
      receiptQty: '12.0000',
      qtyDiff: '-8.0000',
    });
  });

  it('allows updating purchase receipt notes within 24 hours', async () => {
    mockAppDataSource.query
      .mockResolvedValueOnce([{ id: 1 }])
      .mockResolvedValueOnce([{ id: 1, createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() }])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    const svc = new PurchaseService({ tenantId: 7, userId: 11 });
    await svc.updateReceiptNotes(1, { notes: '补记：晚班完成复核' });

    expect(String(mockAppDataSource.query.mock.calls[2][0])).toContain('UPDATE purchase_receipts');
    expect(mockAppDataSource.query.mock.calls[2][1]).toEqual(['补记：晚班完成复核', 11, 1, 7]);
  });

  it('rejects updating purchase receipt notes after 24 hours', async () => {
    mockAppDataSource.query
      .mockResolvedValueOnce([{ id: 1 }])
      .mockResolvedValueOnce([
        { id: 1, createdAt: new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString() },
      ]);

    const svc = new PurchaseService({ tenantId: 7, userId: 11 });

    await expect(svc.updateReceiptNotes(1, { notes: '超时补记' })).rejects.toThrow(
      '入库单创建超过24小时，不能再补充备注',
    );
    expect(mockAppDataSource.query).toHaveBeenCalledTimes(2);
  });
});
