import Decimal from 'decimal.js';
import { AppDataSource } from '../../config/database';
import { TenantContext } from '../../shared/BaseRepository';
import { AppError } from '../../shared/AppError';
import { ResponseCode } from '../../shared/ApiResponse';

// ─── 类型定义 ──────────────────────────────────────────────────

export interface MatchDiffItem {
  skuId: number;
  skuName: string;
  hasDyeLot?: boolean;
  deliveryDyeLots?: string[];
  receiptDyeLots?: string[];
  isDyeLotMismatch?: boolean;
  poQty: string;
  poUnit: string;
  poPrice: string;
  dnQty: string;
  dnPrice: string;
  receiptQty: string;
  qtyDiff: string;          // receipt - po（负数 = 少货）
  priceDiff: string;        // dn_price - po_price
  isPriceAnomaly: boolean;  // 当前价格超历史均价 20%
  historicalAvgPrice: string | null;
}

export type MatchStatus = 'matched' | 'qty_diff' | 'price_diff' | 'price_warning' | 'pending';

export interface ThreeWayMatchResult {
  matchId: number;
  poId: number;
  poNo: string;
  deliveryNoteId: number;
  deliveryNo: string;
  receiptId: number;
  receiptNo: string;
  matchStatus: MatchStatus;
  diffItems: MatchDiffItem[];
  createdAt: Date;
  confirmedAt: Date | null;
  confirmedBy: string | null;
  diffReason: string | null;
  diffNotes: string | null;
  supplierName?: string | null;
}

// ─── Three-Way Match Service ────────────────────────────────────

export class ThreeWayMatchService {
  private readonly tenantId: number;
  private readonly userId: number;
  private static purchaseReceiptDeliveryColumn: 'delivery_note_id' | 'dn_id' | null = null;
  private static purchaseReceiptItemsTableSupported: boolean | null = null;
  private static deliveryNoteItemDyeLotSupported: boolean | null = null;
  private static purchaseReceiptItemDyeLotSupported: boolean | null = null;
  private static incomingInspectionItemDyeLotSupported: boolean | null = null;

  constructor(ctx: TenantContext) {
    this.tenantId = ctx.tenantId;
    this.userId = ctx.userId;
  }

  /**
   * 执行三单匹配（PO ↔ 送货单 ↔ 入库单）
   *
   * 匹配规则：
   * 1. 按明细行逐一比对 PO 与送货单、入库单的数量与价格
   * 2. 全部一致 → matched（自动完成，无需人工）
   * 3. 数量差异 → qty_diff（需采购员确认原因）
   * 4. 价格差异 → price_diff（需采购员确认原因）
   * 5. 价格超历史均价 20% → price_warning（即使数量匹配也标注）
   */
  async runMatch(poId: number, deliveryNoteId: number, receiptId: number): Promise<ThreeWayMatchResult> {
    // 1. 校验三个单据均属于本租户且相互关联
    await this.validateRelationship(poId, deliveryNoteId, receiptId);

    // 2. 读取各单明细并按 sku_id 索引
    const [poItems, dnItems, receiptItems] = await Promise.all([
      this.getPOItems(poId),
      this.getDNItems(deliveryNoteId),
      this.getReceiptItems(receiptId),
    ]);
    const normalizedPoItems = poItems.map((item) => ({ ...item, sku_id: Number(item.sku_id) }));
    const normalizedDnItems = dnItems.map((item) => ({ ...item, sku_id: Number(item.sku_id) }));
    const normalizedReceiptItems = receiptItems.map((item) => ({ ...item, sku_id: Number(item.sku_id) }));

    // 3. 逐行比对
    const diffItems: MatchDiffItem[] = [];
    let hasQtyDiff = false;
    let hasPriceDiff = false;
    let hasPriceWarning = false;

    const allSkuIds = new Set([
      ...normalizedPoItems.map((i) => i.sku_id),
      ...normalizedDnItems.map((i) => i.sku_id),
      ...normalizedReceiptItems.map((i) => i.sku_id),
    ]);

    for (const skuId of allSkuIds) {
      const po = normalizedPoItems.find((i) => i.sku_id === skuId);
      const dn = normalizedDnItems.find((i) => i.sku_id === skuId);
      const receipt = normalizedReceiptItems.find((i) => i.sku_id === skuId);

      const poQty = new Decimal(po?.qty_ordered ?? 0);
      const dnQty = new Decimal(dn?.qty_delivered ?? 0);
      const receiptQty = new Decimal(receipt?.qty_received ?? 0);
      const poPrice = new Decimal(po?.unit_price ?? 0);
      const dnPrice = new Decimal(dn?.unit_price ?? 0);

      const qtyDiff = receiptQty.minus(poQty);
      const priceDiff = dnPrice.minus(poPrice);
      const deliveryDyeLots = Array.isArray(dn?.dye_lot_nos) ? dn.dye_lot_nos : [];
      const receiptDyeLots = Array.isArray(receipt?.dye_lot_nos) ? receipt.dye_lot_nos : [];
      const hasDyeLot = Boolean(Number(po?.has_dye_lot ?? dn?.has_dye_lot ?? 0));
      const isDyeLotMismatch = hasDyeLot
        && deliveryDyeLots.join('|') !== receiptDyeLots.join('|');

      // 价格异常检测：超历史均价 20%
      const historicalAvgPrice = await this.getHistoricalAvgPrice(skuId);
      const isPriceAnomaly = historicalAvgPrice !== null &&
        dnPrice.gt(new Decimal(historicalAvgPrice).mul('1.2'));

      if (!qtyDiff.isZero()) hasQtyDiff = true;
      if (!priceDiff.isZero()) hasPriceDiff = true;
      if (isPriceAnomaly) hasPriceWarning = true;
      if (isDyeLotMismatch) hasQtyDiff = true;

      diffItems.push({
        skuId,
        skuName: po?.sku_name ?? dn?.sku_name ?? `SKU#${skuId}`,
        hasDyeLot,
        deliveryDyeLots,
        receiptDyeLots,
        isDyeLotMismatch,
        poQty: poQty.toFixed(4),
        poUnit: po?.purchase_unit ?? '',
        poPrice: poPrice.toFixed(2),
        dnQty: dnQty.toFixed(4),
        dnPrice: dnPrice.toFixed(2),
        receiptQty: receiptQty.toFixed(4),
        qtyDiff: qtyDiff.toFixed(4),
        priceDiff: priceDiff.toFixed(2),
        isPriceAnomaly,
        historicalAvgPrice: historicalAvgPrice?.toFixed(2) ?? null,
      });
    }

    // 4. 计算整体匹配状态
    let matchStatus: MatchStatus = 'matched';
    if (hasQtyDiff) matchStatus = 'qty_diff';
    else if (hasPriceDiff) matchStatus = 'price_diff';
    else if (hasPriceWarning) matchStatus = 'price_warning';

    // 5. 写入或更新三单匹配记录
    const matchId = await this.upsertMatchRecord(
      poId, deliveryNoteId, receiptId, matchStatus, diffItems,
    );

    const poInfo = await this.getPOInfo(poId);
    const dnInfo = await this.getDNInfo(deliveryNoteId);
    const receiptInfo = await this.getReceiptInfo(receiptId);

    return {
      matchId,
      poId,
      poNo: poInfo.po_no,
      deliveryNoteId,
      deliveryNo: dnInfo.delivery_no,
      receiptId,
      receiptNo: receiptInfo.receipt_no,
      matchStatus,
      diffItems,
      createdAt: new Date(),
      confirmedAt: null,
      confirmedBy: null,
      diffReason: null,
      diffNotes: null,
    };
  }

  /**
   * 列出三单匹配记录（待处理/已匹配）
   */
  async listMatchRecords(params: {
    status?: string; supplierId?: number; poId?: number; receiptId?: number; page: number; pageSize: number;
  }): Promise<{ list: any[]; total: number }> {
    const conds = ['m.tenant_id = ?'];
    const p: unknown[] = [this.tenantId];

    if (params.status) { conds.push('m.match_status = ?'); p.push(params.status); }
    if (params.supplierId) { conds.push('po.supplier_id = ?'); p.push(params.supplierId); }
    if (params.poId) { conds.push('m.po_id = ?'); p.push(params.poId); }
    if (params.receiptId) { conds.push('m.receipt_id = ?'); p.push(params.receiptId); }

    const where = conds.join(' AND ');
    const offset = (params.page - 1) * params.pageSize;

    const [list, countRows] = await Promise.all([
      AppDataSource.query<Array<Record<string, unknown>>>(
        `SELECT
           m.id AS matchId,
           m.po_id AS poId,
           po.po_no AS poNo,
           m.delivery_note_id AS deliveryNoteId,
           dn.delivery_no AS deliveryNo,
           m.receipt_id AS receiptId,
           r.receipt_no AS receiptNo,
           m.match_status AS matchStatus,
           m.qty_diff_detail AS diffItemsJson,
           m.created_at AS createdAt,
           m.confirmed_at AS confirmedAt,
           confirmer.username AS confirmedBy,
           m.diff_reason AS diffReason,
           m.diff_notes AS diffNotes,
           po.supplier_id AS supplierId,
           sup.name AS supplierName
         FROM three_way_match_records m
         INNER JOIN purchase_orders po ON po.id = m.po_id AND po.tenant_id = m.tenant_id
         INNER JOIN suppliers sup ON sup.id = po.supplier_id AND sup.tenant_id = po.tenant_id
         INNER JOIN delivery_notes dn ON dn.id = m.delivery_note_id AND dn.tenant_id = m.tenant_id
         INNER JOIN purchase_receipts r ON r.id = m.receipt_id AND r.tenant_id = m.tenant_id
         LEFT JOIN users confirmer ON confirmer.id = m.confirmed_by AND confirmer.tenant_id = m.tenant_id
         WHERE ${where}
         ORDER BY m.id DESC LIMIT ? OFFSET ?`,
        [...p, params.pageSize, offset],
      ),
      AppDataSource.query<Array<{ total: number }>>(
        `SELECT COUNT(*) AS total FROM three_way_match_records m
         INNER JOIN purchase_orders po ON po.id = m.po_id AND po.tenant_id = m.tenant_id
         WHERE ${where}`,
        p,
      ),
    ]);

    return {
      list: list.map((row) => this.mapMatchRow(row)),
      total: Number(countRows[0]?.total ?? 0),
    };
  }

  async getMatchById(matchId: number): Promise<ThreeWayMatchResult> {
    const [row] = await AppDataSource.query<Array<Record<string, unknown>>>(
      `SELECT
         m.id AS matchId,
         m.po_id AS poId,
         po.po_no AS poNo,
         m.delivery_note_id AS deliveryNoteId,
         dn.delivery_no AS deliveryNo,
         m.receipt_id AS receiptId,
         r.receipt_no AS receiptNo,
         m.match_status AS matchStatus,
         m.qty_diff_detail AS diffItemsJson,
         m.created_at AS createdAt,
         m.confirmed_at AS confirmedAt,
         confirmer.username AS confirmedBy,
         m.diff_reason AS diffReason,
         m.diff_notes AS diffNotes,
         sup.name AS supplierName
       FROM three_way_match_records m
       INNER JOIN purchase_orders po ON po.id = m.po_id AND po.tenant_id = m.tenant_id
       INNER JOIN suppliers sup ON sup.id = po.supplier_id AND sup.tenant_id = po.tenant_id
       INNER JOIN delivery_notes dn ON dn.id = m.delivery_note_id AND dn.tenant_id = m.tenant_id
       INNER JOIN purchase_receipts r ON r.id = m.receipt_id AND r.tenant_id = m.tenant_id
       LEFT JOIN users confirmer ON confirmer.id = m.confirmed_by AND confirmer.tenant_id = m.tenant_id
       WHERE m.id = ? AND m.tenant_id = ?
       LIMIT 1`,
      [matchId, this.tenantId],
    );

    if (!row) {
      throw AppError.notFound('三单匹配记录不存在', ResponseCode.NOT_FOUND);
    }

    return this.mapMatchRow(row);
  }

  /**
   * 采购员确认差异（选择差异原因后完成结算）
   */
  async confirmDiff(
    matchId: number,
    diffReason: 'supplier_short' | 'receipt_miss' | 'price_adjust' | 'other',
    diffNotes: string,
  ): Promise<void> {
    const [record] = await AppDataSource.query<Array<{ id: number; match_status: string }>>(
      'SELECT id, match_status FROM three_way_match_records WHERE id = ? AND tenant_id = ? LIMIT 1',
      [matchId, this.tenantId],
    );
    if (!record) throw AppError.notFound('三单匹配记录不存在');
    if (record.match_status === 'matched') {
      throw AppError.badRequest('该记录已完成匹配，不能重复确认', ResponseCode.INVALID_PARAMS);
    }

    await AppDataSource.query(
      `UPDATE three_way_match_records
       SET match_status = 'matched', confirmed_by = ?, confirmed_at = NOW(),
           diff_reason = ?, diff_notes = ?, updated_by = ?
       WHERE id = ? AND tenant_id = ?`,
      [this.userId, diffReason, diffNotes, this.userId, matchId, this.tenantId],
    );
  }

  // ── 私有辅助 ──────────────────────────────────────────────

  private async validateRelationship(poId: number, dnId: number, receiptId: number): Promise<void> {
    const [dn] = await AppDataSource.query<Array<{ po_id: number }>>(
      'SELECT po_id FROM delivery_notes WHERE id = ? AND tenant_id = ? LIMIT 1',
      [dnId, this.tenantId],
    );
    if (!dn || Number(dn.po_id) !== poId) {
      throw AppError.badRequest('送货单与采购订单不匹配', ResponseCode.THREE_WAY_MATCH_DIFF);
    }
    const [receipt] = await AppDataSource.query<Array<{ po_id: number }>>(
      'SELECT po_id FROM purchase_receipts WHERE id = ? AND tenant_id = ? LIMIT 1',
      [receiptId, this.tenantId],
    );
    if (!receipt || Number(receipt.po_id) !== poId) {
      throw AppError.badRequest('入库单与采购订单不匹配', ResponseCode.THREE_WAY_MATCH_DIFF);
    }
  }

  private async getPOItems(poId: number) {
    return AppDataSource.query<Array<{
      sku_id: number; sku_name: string; qty_ordered: string;
      has_dye_lot: number;
      purchase_unit: string; unit_price: string;
    }>>(
      `SELECT poi.sku_id, s.name AS sku_name, s.has_dye_lot, poi.qty_ordered,
              poi.purchase_unit, poi.unit_price
       FROM purchase_order_items poi
       INNER JOIN skus s ON s.id = poi.sku_id
       WHERE poi.po_id = ? AND poi.tenant_id = ?`,
      [poId, this.tenantId],
    );
  }

  private async getDNItems(dnId: number) {
    const supportsDeliveryItemDyeLot = await this.hasDeliveryNoteItemDyeLotColumn();
    const rows = await AppDataSource.query<Array<{
      sku_id: number; sku_name: string; has_dye_lot: number; qty_delivered: string;
      unit_price: string; dye_lot_no?: string | null;
    }>>(
      `SELECT
         dni.sku_id,
         s.name AS sku_name,
         s.has_dye_lot,
         dni.qty_delivered,
         dni.unit_price,
         ${supportsDeliveryItemDyeLot ? 'dni.dye_lot_no AS dye_lot_no' : 'NULL AS dye_lot_no'}
       FROM delivery_note_items dni
       INNER JOIN skus s ON s.id = dni.sku_id
       WHERE dni.delivery_note_id = ? AND dni.tenant_id = ?`,
      [dnId, this.tenantId],
    );

    const grouped = new Map<number, {
      sku_id: number;
      sku_name: string;
      has_dye_lot: number;
      qty_delivered: Decimal;
      unit_price: string;
      dye_lot_nos: Set<string>;
    }>();
    for (const row of rows) {
      const skuId = Number(row.sku_id);
      const existing = grouped.get(skuId) ?? {
        sku_id: skuId,
        sku_name: row.sku_name,
        has_dye_lot: Number(row.has_dye_lot ?? 0),
        qty_delivered: new Decimal(0),
        unit_price: String(row.unit_price ?? '0'),
        dye_lot_nos: new Set<string>(),
      };
      existing.qty_delivered = existing.qty_delivered.plus(String(row.qty_delivered ?? '0'));
      const dyeLotNo = String(row.dye_lot_no ?? '').trim();
      if (dyeLotNo) existing.dye_lot_nos.add(dyeLotNo);
      grouped.set(skuId, existing);
    }

    return Array.from(grouped.values()).map((row) => ({
      ...row,
      qty_delivered: row.qty_delivered.toFixed(4),
      dye_lot_nos: Array.from(row.dye_lot_nos).sort(),
    }));
  }

  private async getReceiptItems(receiptId: number) {
    if (await this.hasPurchaseReceiptItemsTable()) {
      const supportsReceiptItemDyeLot = await this.hasPurchaseReceiptItemDyeLotColumn();
      const rows = await AppDataSource.query<Array<{
        sku_id: number;
        qty_received: string;
        dye_lot_no?: string | null;
      }>>(
        `SELECT
           sku_id,
           qty_received,
           ${supportsReceiptItemDyeLot ? 'dye_lot_no' : 'NULL AS dye_lot_no'}
         FROM purchase_receipt_items
         WHERE receipt_id = ? AND tenant_id = ?`,
        [receiptId, this.tenantId],
      );
      // Some historical receipts were created without receipt-item rows.
      // Fall back to inspection-pass aggregation so three-way match stays compatible.
      if (rows.length > 0) {
        return this.aggregateReceiptRows(rows);
      }
    }

    const receiptDeliveryColumn = await this.getPurchaseReceiptDeliveryColumn();
    const supportsInspectionItemDyeLot = await this.hasIncomingInspectionItemDyeLotColumn();
    const rows = await AppDataSource.query<Array<{
      sku_id: number;
      qty_received: string;
      dye_lot_no?: string | null;
    }>>(
      `SELECT
         ii.sku_id,
         ${supportsInspectionItemDyeLot ? 'ii.dye_lot_no' : 'NULL AS dye_lot_no'},
         SUM(ii.qty_passed) AS qty_received
       FROM purchase_receipts pr
       INNER JOIN incoming_inspection_records ir
         ON ir.delivery_note_id = pr.${receiptDeliveryColumn} AND ir.tenant_id = pr.tenant_id
       INNER JOIN incoming_inspection_items ii
         ON ii.inspection_id = ir.id AND ii.tenant_id = pr.tenant_id
       WHERE pr.id = ? AND pr.tenant_id = ?
         AND CAST(ii.qty_passed AS DECIMAL(16,4)) > 0
       GROUP BY ii.sku_id, ii.dye_lot_no`,
      [receiptId, this.tenantId],
    );
    return this.aggregateReceiptRows(rows);
  }

  private aggregateReceiptRows(rows: Array<{ sku_id: number; qty_received: string; dye_lot_no?: string | null }>) {
    const grouped = new Map<number, {
      sku_id: number;
      qty_received: Decimal;
      dye_lot_nos: Set<string>;
    }>();
    for (const row of rows) {
      const skuId = Number(row.sku_id);
      const current = grouped.get(skuId) ?? {
        sku_id: skuId,
        qty_received: new Decimal(0),
        dye_lot_nos: new Set<string>(),
      };
      current.qty_received = current.qty_received.plus(String(row.qty_received ?? '0'));
      const dyeLotNo = String(row.dye_lot_no ?? '').trim();
      if (dyeLotNo) current.dye_lot_nos.add(dyeLotNo);
      grouped.set(skuId, current);
    }
    return Array.from(grouped.values()).map((row) => ({
      sku_id: row.sku_id,
      qty_received: row.qty_received.toFixed(4),
      dye_lot_nos: Array.from(row.dye_lot_nos).sort(),
    }));
  }

  private async getHistoricalAvgPrice(skuId: number): Promise<Decimal | null> {
    const [row] = await AppDataSource.query<Array<{ avg_price: string | null }>>(
      `SELECT AVG(unit_price) AS avg_price
       FROM purchase_order_items poi
       INNER JOIN purchase_orders po ON po.id = poi.po_id
       WHERE poi.sku_id = ? AND po.tenant_id = ?
         AND po.created_at >= DATE_SUB(NOW(), INTERVAL 90 DAY)`,
      [skuId, this.tenantId],
    );
    return row?.avg_price ? new Decimal(row.avg_price) : null;
  }

  private async upsertMatchRecord(
    poId: number,
    dnId: number,
    receiptId: number,
    matchStatus: MatchStatus,
    diffItems: MatchDiffItem[],
  ): Promise<number> {
    const [existing] = await AppDataSource.query<Array<{ id: number }>>(
      'SELECT id FROM three_way_match_records WHERE po_id = ? AND delivery_note_id = ? AND receipt_id = ? LIMIT 1',
      [poId, dnId, receiptId],
    );

    if (existing) {
      await AppDataSource.query(
        `UPDATE three_way_match_records
         SET match_status = ?, qty_diff_detail = ?, price_diff_detail = ?, updated_by = ?
         WHERE id = ?`,
        [matchStatus, JSON.stringify(diffItems), JSON.stringify(diffItems), this.userId, existing.id],
      );
      return existing.id;
    }

    const result = await AppDataSource.query(
      `INSERT INTO three_way_match_records
         (tenant_id, po_id, delivery_note_id, receipt_id, match_status,
          qty_diff_detail, price_diff_detail, created_by, updated_by)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [
        this.tenantId, poId, dnId, receiptId, matchStatus,
        JSON.stringify(diffItems), JSON.stringify(diffItems),
        this.userId, this.userId,
      ],
    );
    return Number(result.insertId);
  }

  private async getPOInfo(poId: number) {
    const [r] = await AppDataSource.query<Array<{ po_no: string }>>(
      'SELECT po_no FROM purchase_orders WHERE id = ? LIMIT 1', [poId],
    );
    return r ?? { po_no: '' };
  }

  private async getDNInfo(dnId: number) {
    const [r] = await AppDataSource.query<Array<{ delivery_no: string }>>(
      'SELECT delivery_no FROM delivery_notes WHERE id = ? LIMIT 1', [dnId],
    );
    return r ?? { delivery_no: '' };
  }

  private async getReceiptInfo(receiptId: number) {
    const [r] = await AppDataSource.query<Array<{ receipt_no: string }>>(
      'SELECT receipt_no FROM purchase_receipts WHERE id = ? LIMIT 1', [receiptId],
    );
    return r ?? { receipt_no: '' };
  }

  private mapMatchRow(row: Record<string, unknown>): ThreeWayMatchResult {
    const rawDiffItems = row.diffItemsJson;
    let diffItems: MatchDiffItem[] = [];
    if (typeof rawDiffItems === 'string' && rawDiffItems.trim()) {
      try {
        diffItems = JSON.parse(rawDiffItems) as MatchDiffItem[];
      } catch {
        diffItems = [];
      }
    } else if (Array.isArray(rawDiffItems)) {
      diffItems = rawDiffItems as MatchDiffItem[];
    }

    return {
      matchId: Number(row.matchId),
      poId: Number(row.poId),
      poNo: String(row.poNo ?? ''),
      deliveryNoteId: Number(row.deliveryNoteId),
      deliveryNo: String(row.deliveryNo ?? ''),
      receiptId: Number(row.receiptId),
      receiptNo: String(row.receiptNo ?? ''),
      matchStatus: String(row.matchStatus ?? 'pending') as MatchStatus,
      diffItems,
      createdAt: new Date(String(row.createdAt ?? '')),
      confirmedAt: row.confirmedAt ? new Date(String(row.confirmedAt)) : null,
      confirmedBy: row.confirmedBy ? String(row.confirmedBy) : null,
      diffReason: row.diffReason ? String(row.diffReason) : null,
      diffNotes: row.diffNotes ? String(row.diffNotes) : null,
      supplierName: row.supplierName ? String(row.supplierName) : null,
    };
  }

  private async getPurchaseReceiptDeliveryColumn(): Promise<'delivery_note_id' | 'dn_id'> {
    if (ThreeWayMatchService.purchaseReceiptDeliveryColumn) {
      return ThreeWayMatchService.purchaseReceiptDeliveryColumn;
    }

    const rows = await AppDataSource.query<Array<{ column_name: string }>>(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = DATABASE()
         AND table_name = 'purchase_receipts'
         AND column_name IN ('delivery_note_id', 'dn_id')`,
    );

    const columns = new Set(rows.map((row) => String(row.column_name)));
    ThreeWayMatchService.purchaseReceiptDeliveryColumn = columns.has('delivery_note_id')
      ? 'delivery_note_id'
      : 'dn_id';
    return ThreeWayMatchService.purchaseReceiptDeliveryColumn;
  }

  private async hasPurchaseReceiptItemsTable(): Promise<boolean> {
    if (ThreeWayMatchService.purchaseReceiptItemsTableSupported !== null) {
      return ThreeWayMatchService.purchaseReceiptItemsTableSupported;
    }

    const rows = await AppDataSource.query<Array<{ cnt: number }>>(
      `SELECT COUNT(*) AS cnt
       FROM information_schema.tables
       WHERE table_schema = DATABASE()
         AND table_name = 'purchase_receipt_items'`,
    );

    ThreeWayMatchService.purchaseReceiptItemsTableSupported = Number(rows[0]?.cnt ?? 0) > 0;
    return ThreeWayMatchService.purchaseReceiptItemsTableSupported;
  }

  private async hasDeliveryNoteItemDyeLotColumn(): Promise<boolean> {
    if (ThreeWayMatchService.deliveryNoteItemDyeLotSupported !== null) {
      return ThreeWayMatchService.deliveryNoteItemDyeLotSupported;
    }

    const rows = await AppDataSource.query<Array<{ cnt: number }>>(
      `SELECT COUNT(*) AS cnt
         FROM information_schema.columns
        WHERE table_schema = DATABASE()
          AND table_name = 'delivery_note_items'
          AND column_name = 'dye_lot_no'`,
    );

    ThreeWayMatchService.deliveryNoteItemDyeLotSupported = Number(rows[0]?.cnt ?? 0) > 0;
    return ThreeWayMatchService.deliveryNoteItemDyeLotSupported;
  }

  private async hasPurchaseReceiptItemDyeLotColumn(): Promise<boolean> {
    if (ThreeWayMatchService.purchaseReceiptItemDyeLotSupported !== null) {
      return ThreeWayMatchService.purchaseReceiptItemDyeLotSupported;
    }

    const rows = await AppDataSource.query<Array<{ cnt: number }>>(
      `SELECT COUNT(*) AS cnt
         FROM information_schema.columns
        WHERE table_schema = DATABASE()
          AND table_name = 'purchase_receipt_items'
          AND column_name = 'dye_lot_no'`,
    );

    ThreeWayMatchService.purchaseReceiptItemDyeLotSupported = Number(rows[0]?.cnt ?? 0) > 0;
    return ThreeWayMatchService.purchaseReceiptItemDyeLotSupported;
  }

  private async hasIncomingInspectionItemDyeLotColumn(): Promise<boolean> {
    if (ThreeWayMatchService.incomingInspectionItemDyeLotSupported !== null) {
      return ThreeWayMatchService.incomingInspectionItemDyeLotSupported;
    }

    const rows = await AppDataSource.query<Array<{ cnt: number }>>(
      `SELECT COUNT(*) AS cnt
         FROM information_schema.columns
        WHERE table_schema = DATABASE()
          AND table_name = 'incoming_inspection_items'
          AND column_name = 'dye_lot_no'`,
    );

    ThreeWayMatchService.incomingInspectionItemDyeLotSupported = Number(rows[0]?.cnt ?? 0) > 0;
    return ThreeWayMatchService.incomingInspectionItemDyeLotSupported;
  }
}
