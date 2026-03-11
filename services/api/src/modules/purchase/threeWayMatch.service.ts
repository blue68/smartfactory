import Decimal from 'decimal.js';
import { AppDataSource } from '../../config/database';
import { TenantContext } from '../../shared/BaseRepository';
import { AppError } from '../../shared/AppError';
import { ResponseCode } from '../../shared/ApiResponse';

// ─── 类型定义 ──────────────────────────────────────────────────

export interface MatchDiffItem {
  skuId: number;
  skuName: string;
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
  confirmedBy: number | null;
  diffReason: string | null;
  diffNotes: string | null;
}

// ─── Three-Way Match Service ────────────────────────────────────

export class ThreeWayMatchService {
  private readonly tenantId: number;
  private readonly userId: number;

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

    // 3. 逐行比对
    const diffItems: MatchDiffItem[] = [];
    let hasQtyDiff = false;
    let hasPriceDiff = false;
    let hasPriceWarning = false;

    const allSkuIds = new Set([
      ...poItems.map((i) => i.sku_id),
      ...dnItems.map((i) => i.sku_id),
      ...receiptItems.map((i) => i.sku_id),
    ]);

    for (const skuId of allSkuIds) {
      const po = poItems.find((i) => i.sku_id === skuId);
      const dn = dnItems.find((i) => i.sku_id === skuId);
      const receipt = receiptItems.find((i) => i.sku_id === skuId);

      const poQty = new Decimal(po?.qty_ordered ?? 0);
      const dnQty = new Decimal(dn?.qty_delivered ?? 0);
      const receiptQty = new Decimal(receipt?.qty_received ?? 0);
      const poPrice = new Decimal(po?.unit_price ?? 0);
      const dnPrice = new Decimal(dn?.unit_price ?? 0);

      const qtyDiff = receiptQty.minus(poQty);
      const priceDiff = dnPrice.minus(poPrice);

      // 价格异常检测：超历史均价 20%
      const historicalAvgPrice = await this.getHistoricalAvgPrice(skuId);
      const isPriceAnomaly = historicalAvgPrice !== null &&
        dnPrice.gt(new Decimal(historicalAvgPrice).mul('1.2'));

      if (!qtyDiff.isZero()) hasQtyDiff = true;
      if (!priceDiff.isZero()) hasPriceDiff = true;
      if (isPriceAnomaly) hasPriceWarning = true;

      diffItems.push({
        skuId,
        skuName: po?.sku_name ?? dn?.sku_name ?? `SKU#${skuId}`,
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
    status?: string; supplierId?: number; page: number; pageSize: number;
  }): Promise<{ list: any[]; total: number }> {
    const conds = ['m.tenant_id = ?'];
    const p: unknown[] = [this.tenantId];

    if (params.status) { conds.push('m.match_status = ?'); p.push(params.status); }
    if (params.supplierId) { conds.push('po.supplier_id = ?'); p.push(params.supplierId); }

    const where = conds.join(' AND ');
    const offset = (params.page - 1) * params.pageSize;

    const [list, countRows] = await Promise.all([
      AppDataSource.query(
        `SELECT m.*, po.po_no, po.supplier_id,
                sup.name AS supplierName,
                dn.delivery_no, r.receipt_no
         FROM three_way_match_records m
         INNER JOIN purchase_orders po ON po.id = m.po_id
         INNER JOIN suppliers sup ON sup.id = po.supplier_id
         INNER JOIN delivery_notes dn ON dn.id = m.delivery_note_id
         INNER JOIN purchase_receipts r ON r.id = m.receipt_id
         WHERE ${where}
         ORDER BY m.id DESC LIMIT ? OFFSET ?`,
        [...p, params.pageSize, offset],
      ),
      AppDataSource.query<Array<{ total: number }>>(
        `SELECT COUNT(*) AS total FROM three_way_match_records m
         INNER JOIN purchase_orders po ON po.id = m.po_id
         WHERE ${where}`,
        p,
      ),
    ]);

    return { list, total: Number(countRows[0]?.total ?? 0) };
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
    if (!dn || dn.po_id !== poId) {
      throw AppError.badRequest('送货单与采购订单不匹配', ResponseCode.THREE_WAY_MATCH_DIFF);
    }
    const [receipt] = await AppDataSource.query<Array<{ po_id: number }>>(
      'SELECT po_id FROM purchase_receipts WHERE id = ? AND tenant_id = ? LIMIT 1',
      [receiptId, this.tenantId],
    );
    if (!receipt || receipt.po_id !== poId) {
      throw AppError.badRequest('入库单与采购订单不匹配', ResponseCode.THREE_WAY_MATCH_DIFF);
    }
  }

  private async getPOItems(poId: number) {
    return AppDataSource.query<Array<{
      sku_id: number; sku_name: string; qty_ordered: string;
      purchase_unit: string; unit_price: string;
    }>>(
      `SELECT poi.sku_id, s.name AS sku_name, poi.qty_ordered,
              poi.purchase_unit, poi.unit_price
       FROM purchase_order_items poi
       INNER JOIN skus s ON s.id = poi.sku_id
       WHERE poi.po_id = ? AND poi.tenant_id = ?`,
      [poId, this.tenantId],
    );
  }

  private async getDNItems(dnId: number) {
    return AppDataSource.query<Array<{
      sku_id: number; sku_name: string; qty_delivered: string;
      unit_price: string;
    }>>(
      `SELECT dni.sku_id, s.name AS sku_name, dni.qty_delivered, dni.unit_price
       FROM delivery_note_items dni
       INNER JOIN skus s ON s.id = dni.sku_id
       WHERE dni.delivery_note_id = ? AND dni.tenant_id = ?`,
      [dnId, this.tenantId],
    );
  }

  private async getReceiptItems(receiptId: number) {
    // 入库单明细从 inventory_transactions 中取（关联 reference_id = receipt）
    return AppDataSource.query<Array<{ sku_id: number; qty_received: string }>>(
      `SELECT sku_id, SUM(qty_stock_unit) AS qty_received
       FROM inventory_transactions
       WHERE reference_type = 'purchase_receipt' AND reference_id = ? AND tenant_id = ?
       GROUP BY sku_id`,
      [receiptId, this.tenantId],
    );
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
}
