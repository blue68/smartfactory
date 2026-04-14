import { z } from 'zod';
import Decimal from 'decimal.js';
import { AppDataSource } from '../../config/database';
import { AppError } from '../../shared/AppError';
import { buildPaginated, PaginatedData } from '../../shared/ApiResponse';
import { TenantContext } from '../../shared/BaseRepository';
import { generateNo } from '../../shared/generateNo';

export const CreatePurchaseSettlementSchema = z.object({
  matchId: z.number().int().positive('三单匹配记录 ID 必须为正整数'),
  notes: z.string().max(500).optional(),
});

export const ListPurchaseSettlementSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['draft', 'confirmed', 'paid', 'cancelled']).optional(),
  poId: z.coerce.number().int().positive().optional(),
  keyword: z.string().trim().max(100).optional(),
});

export type PurchaseSettlementStatus = 'draft' | 'confirmed' | 'paid' | 'cancelled';

export interface PurchaseSettlement {
  id: number;
  settlementNo: string;
  matchId: number;
  poId: number;
  poNo: string;
  deliveryNoteId: number;
  deliveryNo: string;
  receiptId: number;
  receiptNo: string;
  dyeLotSummary?: string[];
  supplierId: number;
  supplierName: string;
  totalAmount: string;
  status: PurchaseSettlementStatus;
  dueDate: string | null;
  notes: string | null;
  diffReason: string | null;
  diffNotes: string | null;
  returnOrderCount: number;
  completedReturnOrderCount: number;
  returnQty: string;
  returnAmount: string;
  confirmedBy: string | null;
  confirmedAt: string | null;
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export class PurchaseSettlementService {
  private readonly tenantId: number;
  private readonly userId: number;
  private static purchaseReceiptItemsTableSupported: boolean | null = null;
  private static purchaseReceiptDeliveryColumn: 'delivery_note_id' | 'dn_id' | null = null;
  private static purchaseReceiptItemDyeLotSupported: boolean | null = null;
  private static incomingInspectionItemDyeLotSupported: boolean | null = null;

  constructor(ctx: TenantContext) {
    this.tenantId = ctx.tenantId;
    this.userId = ctx.userId;
  }

  async createSettlement(
    params: z.infer<typeof CreatePurchaseSettlementSchema>,
  ): Promise<PurchaseSettlement> {
    const settlementId = await AppDataSource.transaction(async (manager) => {
      const [lockedMatch] = await manager.query<Array<Record<string, unknown>>>(
        `SELECT
           id AS matchId,
           match_status AS matchStatus,
           po_id AS poId,
           delivery_note_id AS deliveryNoteId,
           receipt_id AS receiptId,
           diff_reason AS diffReason,
           diff_notes AS diffNotes
         FROM three_way_match_records
         WHERE id = ? AND tenant_id = ?
         LIMIT 1 FOR UPDATE`,
        [params.matchId, this.tenantId],
      );
      if (!lockedMatch) {
        throw AppError.notFound('采购三单匹配记录不存在');
      }
      if (String(lockedMatch.matchStatus) !== 'matched') {
        throw AppError.badRequest('仅已完成三单匹配的记录可发起采购结算');
      }

      const [existing] = await manager.query<Array<{ id: number }>>(
        `SELECT id
         FROM purchase_settlements
         WHERE tenant_id = ? AND match_id = ? AND status != 'cancelled'
         ORDER BY id DESC
         LIMIT 1`,
        [this.tenantId, params.matchId],
      );
      if (existing) {
        return Number(existing.id);
      }

      const [matchDetail] = await manager.query<Array<Record<string, unknown>>>(
        `SELECT
           m.id AS matchId,
           m.po_id AS poId,
           m.delivery_note_id AS deliveryNoteId,
           m.receipt_id AS receiptId,
           po.supplier_id AS supplierId,
           COALESCE(pr.received_at, pr.created_at, NOW(3)) AS receiptDate
         FROM three_way_match_records m
         INNER JOIN purchase_orders po ON po.id = m.po_id AND po.tenant_id = m.tenant_id
         INNER JOIN purchase_receipts pr ON pr.id = m.receipt_id AND pr.tenant_id = m.tenant_id
         WHERE m.id = ? AND m.tenant_id = ?
         LIMIT 1`,
        [params.matchId, this.tenantId],
      );
      if (!matchDetail) {
        throw AppError.notFound('采购三单匹配记录不存在');
      }

      const totalAmount = await this.calculateReceiptAmount(Number(matchDetail.receiptId));
      if (totalAmount.lte(0)) {
        throw AppError.badRequest('当前匹配记录没有可结算的入库金额');
      }

      const settlementNo = await generateNo('purchase_settlement', this.tenantId);
      const receiptDate = new Date(String(matchDetail.receiptDate ?? new Date().toISOString()));
      const dueDate = new Date(receiptDate.getTime());
      dueDate.setDate(dueDate.getDate() + 30);
      const dueDateStr = dueDate.toISOString().slice(0, 10);

      const result = await manager.query(
        `INSERT INTO purchase_settlements
           (tenant_id, settlement_no, match_id, po_id, delivery_note_id, receipt_id,
            supplier_id, total_amount, status, due_date, notes, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)`,
        [
          this.tenantId,
          settlementNo,
          params.matchId,
          Number(matchDetail.poId),
          Number(matchDetail.deliveryNoteId),
          Number(matchDetail.receiptId),
          Number(matchDetail.supplierId),
          totalAmount.toFixed(2),
          dueDateStr,
          params.notes ?? null,
          this.userId,
          this.userId,
        ],
      );
      return Number((result as { insertId: number }).insertId);
    });

    return this.getDetail(settlementId);
  }

  async listSettlements(
    params: z.infer<typeof ListPurchaseSettlementSchema>,
  ): Promise<PaginatedData<PurchaseSettlement>> {
    const offset = (params.page - 1) * params.pageSize;
    const { where, args } = this.buildListWhere(params);

    const [[{ total }], rows] = await Promise.all([
      AppDataSource.query<Array<{ total: number }>>(
        `SELECT COUNT(*) AS total
         FROM purchase_settlements ps
         INNER JOIN purchase_orders po ON po.id = ps.po_id AND po.tenant_id = ps.tenant_id
         INNER JOIN suppliers sup ON sup.id = ps.supplier_id AND sup.tenant_id = ps.tenant_id
         INNER JOIN purchase_receipts pr ON pr.id = ps.receipt_id AND pr.tenant_id = ps.tenant_id
         WHERE ${where}`,
        args,
      ),
      AppDataSource.query<Array<Record<string, unknown>>>(
        `SELECT
           ps.*,
           po.po_no AS poNo,
           dn.delivery_no AS deliveryNo,
           pr.receipt_no AS receiptNo,
           sup.name AS supplierName,
           m.diff_reason AS diffReason,
           m.diff_notes AS diffNotes,
           confirmer.username AS confirmedBy
         FROM purchase_settlements ps
         INNER JOIN purchase_orders po ON po.id = ps.po_id AND po.tenant_id = ps.tenant_id
         INNER JOIN suppliers sup ON sup.id = ps.supplier_id AND sup.tenant_id = ps.tenant_id
         INNER JOIN purchase_receipts pr ON pr.id = ps.receipt_id AND pr.tenant_id = ps.tenant_id
         LEFT JOIN delivery_notes dn ON dn.id = ps.delivery_note_id AND dn.tenant_id = ps.tenant_id
         LEFT JOIN three_way_match_records m ON m.id = ps.match_id AND m.tenant_id = ps.tenant_id
         LEFT JOIN users confirmer ON confirmer.id = ps.confirmed_by AND confirmer.tenant_id = ps.tenant_id
         WHERE ${where}
         ORDER BY ps.created_at DESC, ps.id DESC
         LIMIT ? OFFSET ?`,
        [...args, params.pageSize, offset],
      ),
    ]);

    const rowsWithDyeLots = await Promise.all(rows.map(async (row) => ({
      ...row,
      dyeLotSummary: await this.getReceiptDyeLots(Number(row.receipt_id)),
      returnSummary: await this.getSettlementReturnSummary(
        Number(row.po_id),
        row.delivery_note_id == null ? null : Number(row.delivery_note_id),
      ),
    })));

    return buildPaginated(
      rowsWithDyeLots.map((row) => this.mapRow(row)),
      Number(total),
      params.page,
      params.pageSize,
    );
  }

  async listSettlementExportRows(
    params: z.infer<typeof ListPurchaseSettlementSchema>,
  ): Promise<PurchaseSettlement[]> {
    const { where, args } = this.buildListWhere(params);
    const rows = await AppDataSource.query<Array<Record<string, unknown>>>(
      `SELECT
         ps.*,
         po.po_no AS poNo,
         dn.delivery_no AS deliveryNo,
         pr.receipt_no AS receiptNo,
         sup.name AS supplierName,
         m.diff_reason AS diffReason,
         m.diff_notes AS diffNotes,
         confirmer.username AS confirmedBy
       FROM purchase_settlements ps
       INNER JOIN purchase_orders po ON po.id = ps.po_id AND po.tenant_id = ps.tenant_id
       INNER JOIN suppliers sup ON sup.id = ps.supplier_id AND sup.tenant_id = ps.tenant_id
       INNER JOIN purchase_receipts pr ON pr.id = ps.receipt_id AND pr.tenant_id = ps.tenant_id
       LEFT JOIN delivery_notes dn ON dn.id = ps.delivery_note_id AND dn.tenant_id = ps.tenant_id
       LEFT JOIN three_way_match_records m ON m.id = ps.match_id AND m.tenant_id = ps.tenant_id
       LEFT JOIN users confirmer ON confirmer.id = ps.confirmed_by AND confirmer.tenant_id = ps.tenant_id
       WHERE ${where}
       ORDER BY ps.created_at DESC, ps.id DESC`,
      args,
    );

    const rowsWithDyeLots = await Promise.all(rows.map(async (row) => ({
      ...row,
      dyeLotSummary: await this.getReceiptDyeLots(Number(row.receipt_id)),
      returnSummary: await this.getSettlementReturnSummary(
        Number(row.po_id),
        row.delivery_note_id == null ? null : Number(row.delivery_note_id),
      ),
    })));
    return rowsWithDyeLots.map((row) => this.mapRow(row));
  }

  async getDetail(id: number): Promise<PurchaseSettlement> {
    const [row] = await AppDataSource.query<Array<Record<string, unknown>>>(
      `SELECT
         ps.*,
         po.po_no AS poNo,
         dn.delivery_no AS deliveryNo,
         pr.receipt_no AS receiptNo,
         sup.name AS supplierName,
         m.diff_reason AS diffReason,
         m.diff_notes AS diffNotes,
         confirmer.username AS confirmedBy
       FROM purchase_settlements ps
       INNER JOIN purchase_orders po ON po.id = ps.po_id AND po.tenant_id = ps.tenant_id
       INNER JOIN suppliers sup ON sup.id = ps.supplier_id AND sup.tenant_id = ps.tenant_id
       INNER JOIN purchase_receipts pr ON pr.id = ps.receipt_id AND pr.tenant_id = ps.tenant_id
       LEFT JOIN delivery_notes dn ON dn.id = ps.delivery_note_id AND dn.tenant_id = ps.tenant_id
       LEFT JOIN three_way_match_records m ON m.id = ps.match_id AND m.tenant_id = ps.tenant_id
       LEFT JOIN users confirmer ON confirmer.id = ps.confirmed_by AND confirmer.tenant_id = ps.tenant_id
       WHERE ps.id = ? AND ps.tenant_id = ?
       LIMIT 1`,
      [id, this.tenantId],
    );

    if (!row) {
      throw AppError.notFound('采购结算单不存在');
    }

    return this.mapRow({
      ...row,
      dyeLotSummary: await this.getReceiptDyeLots(Number(row.receipt_id)),
      returnSummary: await this.getSettlementReturnSummary(
        Number(row.po_id),
        row.delivery_note_id == null ? null : Number(row.delivery_note_id),
      ),
    });
  }

  async confirmSettlement(id: number): Promise<PurchaseSettlement> {
    await AppDataSource.transaction(async (manager) => {
      const [settlement] = await manager.query<Array<{ id: number; status: PurchaseSettlementStatus }>>(
        `SELECT id, status
         FROM purchase_settlements
         WHERE id = ? AND tenant_id = ? LIMIT 1 FOR UPDATE`,
        [id, this.tenantId],
      );
      if (!settlement) {
        throw AppError.notFound('采购结算单不存在');
      }
      if (settlement.status !== 'draft') {
        throw AppError.badRequest(`当前状态为 ${settlement.status}，无法确认`);
      }

      await manager.query(
        `UPDATE purchase_settlements
         SET status = 'confirmed',
             confirmed_by = ?,
             confirmed_at = NOW(3),
             updated_by = ?,
             updated_at = NOW(3)
         WHERE id = ? AND tenant_id = ?`,
        [this.userId, this.userId, id, this.tenantId],
      );
    });

    return this.getDetail(id);
  }

  async paySettlement(id: number): Promise<PurchaseSettlement> {
    await AppDataSource.transaction(async (manager) => {
      const [settlement] = await manager.query<Array<{ id: number; status: PurchaseSettlementStatus }>>(
        `SELECT id, status
         FROM purchase_settlements
         WHERE id = ? AND tenant_id = ? LIMIT 1 FOR UPDATE`,
        [id, this.tenantId],
      );
      if (!settlement) {
        throw AppError.notFound('采购结算单不存在');
      }
      if (settlement.status !== 'confirmed') {
        throw AppError.badRequest(`当前状态为 ${settlement.status}，只有已确认的结算单才能标记付款`);
      }

      await manager.query(
        `UPDATE purchase_settlements
         SET status = 'paid',
             paid_at = NOW(3),
             updated_by = ?,
             updated_at = NOW(3)
         WHERE id = ? AND tenant_id = ?`,
        [this.userId, id, this.tenantId],
      );
    });

    return this.getDetail(id);
  }

  async cancelSettlement(id: number): Promise<PurchaseSettlement> {
    await AppDataSource.transaction(async (manager) => {
      const [settlement] = await manager.query<Array<{ id: number; status: PurchaseSettlementStatus }>>(
        `SELECT id, status
         FROM purchase_settlements
         WHERE id = ? AND tenant_id = ? LIMIT 1 FOR UPDATE`,
        [id, this.tenantId],
      );
      if (!settlement) {
        throw AppError.notFound('采购结算单不存在');
      }
      if (settlement.status === 'paid') {
        throw AppError.badRequest('已付款的采购结算单无法取消');
      }
      if (settlement.status === 'cancelled') {
        throw AppError.badRequest('采购结算单已处于取消状态');
      }

      await manager.query(
        `UPDATE purchase_settlements
         SET status = 'cancelled',
             updated_by = ?,
             updated_at = NOW(3)
         WHERE id = ? AND tenant_id = ?`,
        [this.userId, id, this.tenantId],
      );
    });

    return this.getDetail(id);
  }

  private async calculateReceiptAmount(receiptId: number): Promise<Decimal> {
    if (await this.hasPurchaseReceiptItemsTable()) {
      const [row] = await AppDataSource.query<Array<{ total_amount: string | null }>>(
        `SELECT SUM(amount) AS total_amount
         FROM purchase_receipt_items
         WHERE receipt_id = ? AND tenant_id = ?`,
        [receiptId, this.tenantId],
      );
      return new Decimal(row?.total_amount ?? '0');
    }

    const receiptDeliveryColumn = await this.getPurchaseReceiptDeliveryColumn();
    const [row] = await AppDataSource.query<Array<{ total_amount: string | null }>>(
      `SELECT
         SUM(CAST(ii.qty_passed AS DECIMAL(16,4)) * CAST(COALESCE(poi.unit_price, 0) AS DECIMAL(14,4))) AS total_amount
       FROM purchase_receipts pr
       INNER JOIN incoming_inspection_records ir
         ON ir.delivery_note_id = pr.${receiptDeliveryColumn} AND ir.tenant_id = pr.tenant_id
       INNER JOIN incoming_inspection_items ii
         ON ii.inspection_id = ir.id AND ii.tenant_id = pr.tenant_id
       LEFT JOIN purchase_order_items poi
         ON poi.id = ii.po_item_id AND poi.tenant_id = pr.tenant_id
       WHERE pr.id = ? AND pr.tenant_id = ?
         AND CAST(ii.qty_passed AS DECIMAL(16,4)) > 0`,
      [receiptId, this.tenantId],
    );
    return new Decimal(row?.total_amount ?? '0');
  }

  private buildListWhere(params: z.infer<typeof ListPurchaseSettlementSchema>) {
    const conds = ['ps.tenant_id = ?'];
    const args: unknown[] = [this.tenantId];

    if (params.status) {
      conds.push('ps.status = ?');
      args.push(params.status);
    }
    if (params.poId) {
      conds.push('ps.po_id = ?');
      args.push(params.poId);
    }
    if (params.keyword) {
      conds.push('(ps.settlement_no LIKE ? OR po.po_no LIKE ? OR sup.name LIKE ? OR pr.receipt_no LIKE ?)');
      const kw = `%${params.keyword}%`;
      args.push(kw, kw, kw, kw);
    }

    return { where: conds.join(' AND '), args };
  }

  private async getReceiptDyeLots(receiptId: number): Promise<string[]> {
    if (!receiptId) return [];

    if (await this.hasPurchaseReceiptItemsTable()) {
      if (!(await this.hasPurchaseReceiptItemDyeLotColumn())) return [];
      const rows = await AppDataSource.query<Array<{ dyeLotNo: string | null }>>(
        `SELECT DISTINCT NULLIF(TRIM(dye_lot_no), '') AS dyeLotNo
         FROM purchase_receipt_items
         WHERE tenant_id = ? AND receipt_id = ? AND NULLIF(TRIM(dye_lot_no), '') IS NOT NULL
         ORDER BY dyeLotNo ASC`,
        [this.tenantId, receiptId],
      );
      return rows.map((row) => String(row.dyeLotNo)).filter(Boolean);
    }

    if (!(await this.hasIncomingInspectionItemDyeLotColumn())) return [];
    const receiptDeliveryColumn = await this.getPurchaseReceiptDeliveryColumn();
    const rows = await AppDataSource.query<Array<{ dyeLotNo: string | null }>>(
      `SELECT DISTINCT NULLIF(TRIM(ii.dye_lot_no), '') AS dyeLotNo
       FROM purchase_receipts pr
       INNER JOIN incoming_inspection_records ir
         ON ir.delivery_note_id = pr.${receiptDeliveryColumn} AND ir.tenant_id = pr.tenant_id
       INNER JOIN incoming_inspection_items ii
         ON ii.inspection_id = ir.id AND ii.tenant_id = pr.tenant_id
       WHERE pr.id = ? AND pr.tenant_id = ?
         AND NULLIF(TRIM(ii.dye_lot_no), '') IS NOT NULL
       ORDER BY dyeLotNo ASC`,
      [receiptId, this.tenantId],
    );
    return rows.map((row) => String(row.dyeLotNo)).filter(Boolean);
  }

  private mapRow(row: Record<string, unknown>): PurchaseSettlement {
    const dueDateRaw = row.due_date;
    const dueDate = dueDateRaw instanceof Date
      ? [
          String(dueDateRaw.getFullYear()),
          String(dueDateRaw.getMonth() + 1).padStart(2, '0'),
          String(dueDateRaw.getDate()).padStart(2, '0'),
        ].join('-')
      : (dueDateRaw ? String(dueDateRaw).slice(0, 10) : null);

    return {
      id: Number(row.id),
      settlementNo: String(row.settlement_no ?? ''),
      matchId: Number(row.match_id),
      poId: Number(row.po_id),
      poNo: String(row.poNo ?? ''),
      deliveryNoteId: Number(row.delivery_note_id),
      deliveryNo: String(row.deliveryNo ?? ''),
      receiptId: Number(row.receipt_id),
      receiptNo: String(row.receiptNo ?? ''),
      dyeLotSummary: Array.isArray(row.dyeLotSummary) ? row.dyeLotSummary as string[] : [],
      supplierId: Number(row.supplier_id),
      supplierName: String(row.supplierName ?? ''),
      totalAmount: String(row.total_amount ?? '0.00'),
      status: String(row.status ?? 'draft') as PurchaseSettlementStatus,
      dueDate,
      notes: row.notes ? String(row.notes) : null,
      diffReason: row.diffReason ? String(row.diffReason) : null,
      diffNotes: row.diffNotes ? String(row.diffNotes) : null,
      returnOrderCount: Number((row.returnSummary as Record<string, unknown> | undefined)?.returnOrderCount ?? 0),
      completedReturnOrderCount: Number((row.returnSummary as Record<string, unknown> | undefined)?.completedReturnOrderCount ?? 0),
      returnQty: String((row.returnSummary as Record<string, unknown> | undefined)?.returnQty ?? '0.0000'),
      returnAmount: String((row.returnSummary as Record<string, unknown> | undefined)?.returnAmount ?? '0.00'),
      confirmedBy: row.confirmedBy ? String(row.confirmedBy) : null,
      confirmedAt: row.confirmed_at ? String(row.confirmed_at) : null,
      paidAt: row.paid_at ? String(row.paid_at) : null,
      createdAt: String(row.created_at ?? ''),
      updatedAt: String(row.updated_at ?? ''),
    };
  }

  private async hasPurchaseReceiptItemsTable(): Promise<boolean> {
    if (PurchaseSettlementService.purchaseReceiptItemsTableSupported !== null) {
      return PurchaseSettlementService.purchaseReceiptItemsTableSupported;
    }

    const rows = await AppDataSource.query<Array<{ cnt: number }>>(
      `SELECT COUNT(*) AS cnt
       FROM information_schema.tables
       WHERE table_schema = DATABASE()
         AND table_name = 'purchase_receipt_items'`,
    );

    PurchaseSettlementService.purchaseReceiptItemsTableSupported = Number(rows[0]?.cnt ?? 0) > 0;
    return PurchaseSettlementService.purchaseReceiptItemsTableSupported;
  }

  private async hasPurchaseReceiptItemDyeLotColumn(): Promise<boolean> {
    if (PurchaseSettlementService.purchaseReceiptItemDyeLotSupported !== null) {
      return PurchaseSettlementService.purchaseReceiptItemDyeLotSupported;
    }

    const rows = await AppDataSource.query<Array<{ cnt: number }>>(
      `SELECT COUNT(*) AS cnt
       FROM information_schema.columns
       WHERE table_schema = DATABASE()
         AND table_name = 'purchase_receipt_items'
         AND column_name = 'dye_lot_no'`,
    );

    PurchaseSettlementService.purchaseReceiptItemDyeLotSupported = Number(rows[0]?.cnt ?? 0) > 0;
    return PurchaseSettlementService.purchaseReceiptItemDyeLotSupported;
  }

  private async hasIncomingInspectionItemDyeLotColumn(): Promise<boolean> {
    if (PurchaseSettlementService.incomingInspectionItemDyeLotSupported !== null) {
      return PurchaseSettlementService.incomingInspectionItemDyeLotSupported;
    }

    const rows = await AppDataSource.query<Array<{ cnt: number }>>(
      `SELECT COUNT(*) AS cnt
       FROM information_schema.columns
       WHERE table_schema = DATABASE()
         AND table_name = 'incoming_inspection_items'
         AND column_name = 'dye_lot_no'`,
    );

    PurchaseSettlementService.incomingInspectionItemDyeLotSupported = Number(rows[0]?.cnt ?? 0) > 0;
    return PurchaseSettlementService.incomingInspectionItemDyeLotSupported;
  }

  private async getPurchaseReceiptDeliveryColumn(): Promise<'delivery_note_id' | 'dn_id'> {
    if (PurchaseSettlementService.purchaseReceiptDeliveryColumn) {
      return PurchaseSettlementService.purchaseReceiptDeliveryColumn;
    }

    const rows = await AppDataSource.query<Array<{ column_name: string }>>(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = DATABASE()
         AND table_name = 'purchase_receipts'
         AND column_name IN ('delivery_note_id', 'dn_id')`,
    );

    const columns = new Set(rows.map((row) => String(row.column_name)));
    PurchaseSettlementService.purchaseReceiptDeliveryColumn = columns.has('delivery_note_id')
      ? 'delivery_note_id'
      : 'dn_id';
    return PurchaseSettlementService.purchaseReceiptDeliveryColumn;
  }

  private async getSettlementReturnSummary(poId: number, deliveryNoteId: number | null): Promise<{
    returnOrderCount: number;
    completedReturnOrderCount: number;
    returnQty: string;
    returnAmount: string;
  }> {
    const [row] = await AppDataSource.query<Array<{
      returnOrderCount: number;
      completedReturnOrderCount: number;
      returnQty: string;
      returnAmount: string;
    }>>(
      `SELECT
         COUNT(ro.id) AS returnOrderCount,
         COALESCE(SUM(CASE WHEN ro.status = 'completed' THEN 1 ELSE 0 END), 0) AS completedReturnOrderCount,
         COALESCE(SUM(CAST(ro.total_qty AS DECIMAL(16,4))), 0) AS returnQty,
         COALESCE(SUM(COALESCE(roi.total_amount, 0)), 0) AS returnAmount
       FROM return_orders ro
       LEFT JOIN incoming_inspection_records ir
         ON ir.id = ro.source_inspection_id
        AND ir.tenant_id = ro.tenant_id
       LEFT JOIN (
         SELECT
           tenant_id,
           return_id,
           SUM(CAST(qty_return AS DECIMAL(16,4)) * CAST(unit_price AS DECIMAL(14,4))) AS total_amount
         FROM return_order_items
         GROUP BY tenant_id, return_id
       ) roi
         ON roi.return_id = ro.id
        AND roi.tenant_id = ro.tenant_id
       WHERE ro.tenant_id = ?
         AND ro.source_po_id = ?
         AND (
           ? IS NULL
           OR ro.source_inspection_id IS NULL
           OR ir.delivery_note_id = ?
         )`,
      [this.tenantId, poId, deliveryNoteId, deliveryNoteId],
    );

    return {
      returnOrderCount: Number(row?.returnOrderCount ?? 0),
      completedReturnOrderCount: Number(row?.completedReturnOrderCount ?? 0),
      returnQty: String(row?.returnQty ?? '0.0000'),
      returnAmount: String(row?.returnAmount ?? '0.00'),
    };
  }
}
