import { AppDataSource } from '../../src/config/database';
import { PurchaseService } from '../../src/modules/purchase/purchase.service';

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

describe('Purchase delivery regressions', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('lists delivery notes with poId filter and trace fields', async () => {
    mockAppDataSource.query
      .mockResolvedValueOnce([
        {
          id: 11,
          deliveryNo: 'DN-001',
          poId: 9,
          poNo: 'PO-001',
          supplierName: '供应商A',
          status: 'received',
          inspectionId: 21,
          inspectionNo: 'IQC-001',
          receiptId: 31,
          receiptNo: 'PR-001',
          matchId: 41,
          matchStatus: 'matched',
          totalDelivered: '60',
        },
      ])
      .mockResolvedValueOnce([{ total: 1 }]);

    const svc = new PurchaseService({ tenantId: 7, userId: 11 });
    const result = await svc.listDeliveryNotes({ poId: 9, page: 1, pageSize: 20 });

    expect(String(mockAppDataSource.query.mock.calls[0][0])).toContain('dn.po_id = ?');
    expect(result.total).toBe(1);
    expect(result.list[0]).toMatchObject({
      deliveryNo: 'DN-001',
      status: 'received',
      inspectionNo: 'IQC-001',
      receiptNo: 'PR-001',
      matchStatus: 'matched',
      totalDelivered: '60',
    });
  });

  it('treats completed inspection without receipt as confirmed in delivery list', async () => {
    mockAppDataSource.query
      .mockResolvedValueOnce([
        {
          id: 12,
          deliveryNo: 'DN-002',
          poId: 9,
          poNo: 'PO-001',
          supplierName: '供应商A',
          status: 'confirmed',
          inspectionId: 22,
          inspectionNo: 'IQC-002',
          receiptId: null,
          receiptNo: null,
          matchId: null,
          matchStatus: null,
          totalDelivered: '60',
        },
      ])
      .mockResolvedValueOnce([{ total: 1 }]);

    const svc = new PurchaseService({ tenantId: 7, userId: 11 });
    const result = await svc.listDeliveryNotes({ poId: 9, page: 1, pageSize: 20 });

    expect(String(mockAppDataSource.query.mock.calls[0][0])).toContain("WHEN dn.inspection_id IS NOT NULL AND ir.status IN ('passed', 'partially_passed', 'failed') THEN 'confirmed'");
    expect(result.list[0]).toMatchObject({
      deliveryNo: 'DN-002',
      status: 'confirmed',
      inspectionNo: 'IQC-002',
    });
  });

  it('returns delivery note detail with line items and linked receipt', async () => {
    mockAppDataSource.query
      .mockResolvedValueOnce([
        {
          id: 11,
          deliveryNo: 'DN-001',
          poId: 9,
          poNo: 'PO-001',
          supplierName: '供应商A',
          deliveryDate: '2026-03-24',
          status: 'received',
          inspectionId: 21,
          inspectionNo: 'IQC-001',
          inspectionCreatedAt: '2026-03-24 09:30:00',
          receiptId: 31,
          receiptNo: 'PR-001',
          matchId: 41,
          matchStatus: 'qty_diff',
          matchCreatedAt: '2026-03-24 11:20:00',
          matchConfirmedAt: null,
          creatorName: '采购员A',
          createdAt: '2026-03-24 08:30:00',
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 101,
          skuId: 201,
          skuCode: 'RM-201',
          skuName: '木板A',
          qtyDelivered: '60',
          purchaseUnit: 'pcs',
          unitPrice: '20.00',
          amount: '1200.00',
        },
      ]);

    const svc = new PurchaseService({ tenantId: 7, userId: 11 });
    const detail = await svc.getDeliveryNoteById(11);

    expect(detail).toMatchObject({
      deliveryNo: 'DN-001',
      status: 'received',
      receiptNo: 'PR-001',
      inspectionNo: 'IQC-001',
      matchId: 41,
      matchStatus: 'qty_diff',
      inspectionCreatedAt: '2026-03-24 09:30:00',
      matchCreatedAt: '2026-03-24 11:20:00',
    });
    expect(detail.items?.[0]).toMatchObject({
      skuCode: 'RM-201',
      qtyDelivered: '60',
    });
  });
});
