import { AppDataSource } from '../../src/config/database';
import { PurchaseSettlementService } from '../../src/modules/purchase/purchaseSettlement.service';
import * as generateNoModule from '../../src/shared/generateNo';
import Decimal from 'decimal.js';

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

describe('Purchase settlement regressions', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    (PurchaseSettlementService as any).purchaseReceiptItemsTableSupported = false;
    (PurchaseSettlementService as any).purchaseReceiptDeliveryColumn = 'dn_id';
    (PurchaseSettlementService as any).purchaseReceiptItemDyeLotSupported = false;
    (PurchaseSettlementService as any).incomingInspectionItemDyeLotSupported = true;
  });

  it('orders legacy receipt dye lots by selected alias to avoid MySQL DISTINCT errors', async () => {
    mockAppDataSource.query.mockResolvedValue([{ dyeLotNo: 'DY-001' }]);

    const svc = new PurchaseSettlementService({ tenantId: 7, userId: 11 });
    const result = await (svc as any).getReceiptDyeLots(144);

    expect(result).toEqual(['DY-001']);
    expect(String(mockAppDataSource.query.mock.calls[0][0])).toContain('SELECT DISTINCT NULLIF(TRIM(ii.dye_lot_no), \'\') AS dyeLotNo');
    expect(String(mockAppDataSource.query.mock.calls[0][0])).toContain('ORDER BY dyeLotNo ASC');
    expect(String(mockAppDataSource.query.mock.calls[0][0])).not.toContain('ORDER BY ii.dye_lot_no ASC');
  });

  it('locks match row before creating settlement and deduplicates inside the lock', async () => {
    const manager = {
      query: jest
        .fn()
        .mockResolvedValueOnce([
          {
            matchId: 21,
            matchStatus: 'matched',
            poId: 31,
            deliveryNoteId: 41,
            receiptId: 51,
            diffReason: null,
            diffNotes: null,
          },
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            matchId: 21,
            poId: 31,
            deliveryNoteId: 41,
            receiptId: 51,
            supplierId: 61,
            receiptDate: '2026-03-01T12:00:00.000Z',
          },
        ])
        .mockResolvedValueOnce({ insertId: 71 }),
    };
    mockAppDataSource.transaction.mockImplementation(async (cb: any) => cb(manager));

    const svc = new PurchaseSettlementService({ tenantId: 7, userId: 11 });
    jest.spyOn(svc as any, 'calculateReceiptAmount').mockResolvedValue(new Decimal('100.00'));
    jest.spyOn(generateNoModule, 'generateNo').mockResolvedValue('PS-00071');
    const getDetailSpy = jest
      .spyOn(svc, 'getDetail')
      .mockResolvedValue({ id: 71, status: 'draft' } as any);

    const result = await svc.createSettlement({ matchId: 21, notes: '首张采购结算单' });

    expect(String(manager.query.mock.calls[0][0])).toContain('FROM three_way_match_records');
    expect(String(manager.query.mock.calls[0][0])).toContain('FOR UPDATE');
    expect(manager.query.mock.calls[0][1]).toEqual([21, 7]);
    expect(manager.query.mock.calls[3][1]).toEqual([
      7,
      'PS-00071',
      21,
      31,
      41,
      51,
      61,
      '100.00',
      '2026-03-31',
      '首张采购结算单',
      11,
      11,
    ]);
    expect(getDetailSpy).toHaveBeenCalledWith(71);
    expect(result.id).toBe(71);
  });

  it('returns existing active settlement after locking the same match row', async () => {
    const manager = {
      query: jest
        .fn()
        .mockResolvedValueOnce([
          {
            matchId: 21,
            matchStatus: 'matched',
            poId: 31,
            deliveryNoteId: 41,
            receiptId: 51,
            diffReason: null,
            diffNotes: null,
          },
        ])
        .mockResolvedValueOnce([{ id: 88 }]),
    };
    mockAppDataSource.transaction.mockImplementation(async (cb: any) => cb(manager));

    const svc = new PurchaseSettlementService({ tenantId: 7, userId: 11 });
    const calcSpy = jest.spyOn(svc as any, 'calculateReceiptAmount');
    const getDetailSpy = jest
      .spyOn(svc, 'getDetail')
      .mockResolvedValue({ id: 88, status: 'draft' } as any);

    const result = await svc.createSettlement({ matchId: 21 });

    expect(String(manager.query.mock.calls[0][0])).toContain('FOR UPDATE');
    expect(manager.query).toHaveBeenCalledTimes(2);
    expect(calcSpy).not.toHaveBeenCalled();
    expect(getDetailSpy).toHaveBeenCalledWith(88);
    expect(result.id).toBe(88);
  });

  it('locks settlement row before confirming and updating status', async () => {
    const manager = {
      query: jest
        .fn()
        .mockResolvedValueOnce([{ id: 11, status: 'draft' }])
        .mockResolvedValueOnce({ affectedRows: 1 }),
    };
    mockAppDataSource.transaction.mockImplementation(async (cb: any) => cb(manager));
    mockAppDataSource.query
      .mockResolvedValueOnce([
        {
          id: 11,
          settlement_no: 'PS-001',
          match_id: 21,
          po_id: 31,
          poNo: 'PO-001',
          delivery_note_id: 41,
          deliveryNo: 'DN-001',
          receipt_id: 51,
          receiptNo: 'RC-001',
          supplier_id: 61,
          supplierName: '供应商A',
          total_amount: '100.00',
          status: 'confirmed',
          due_date: null,
          notes: null,
          diffReason: null,
          diffNotes: null,
          confirmed_at: '2026-03-31 10:00:00',
          paid_at: null,
          created_at: '2026-03-31 09:00:00',
          updated_at: '2026-03-31 10:00:00',
        },
      ])
      .mockResolvedValueOnce([]);

    const svc = new PurchaseSettlementService({ tenantId: 7, userId: 11 });
    const result = await svc.confirmSettlement(11);

    expect(String(manager.query.mock.calls[0][0])).toContain('FOR UPDATE');
    expect(manager.query.mock.calls[0][1]).toEqual([11, 7]);
    expect(manager.query.mock.calls[1][1]).toEqual([11, 11, 11, 7]);
    expect(result.status).toBe('confirmed');
  });

  it('locks settlement row before paying and blocks non-confirmed status', async () => {
    const manager = {
      query: jest.fn().mockResolvedValueOnce([{ id: 12, status: 'cancelled' }]),
    };
    mockAppDataSource.transaction.mockImplementation(async (cb: any) => cb(manager));

    const svc = new PurchaseSettlementService({ tenantId: 7, userId: 11 });
    await expect(svc.paySettlement(12)).rejects.toThrow('只有已确认的结算单才能标记付款');

    expect(String(manager.query.mock.calls[0][0])).toContain('FOR UPDATE');
    expect(manager.query.mock.calls[0][1]).toEqual([12, 7]);
    expect(manager.query).toHaveBeenCalledTimes(1);
  });

  it('locks settlement row before cancelling and blocks paid status', async () => {
    const manager = {
      query: jest.fn().mockResolvedValueOnce([{ id: 13, status: 'paid' }]),
    };
    mockAppDataSource.transaction.mockImplementation(async (cb: any) => cb(manager));

    const svc = new PurchaseSettlementService({ tenantId: 7, userId: 11 });
    await expect(svc.cancelSettlement(13)).rejects.toThrow('已付款的采购结算单无法取消');

    expect(String(manager.query.mock.calls[0][0])).toContain('FOR UPDATE');
    expect(manager.query.mock.calls[0][1]).toEqual([13, 7]);
    expect(manager.query).toHaveBeenCalledTimes(1);
  });
});
