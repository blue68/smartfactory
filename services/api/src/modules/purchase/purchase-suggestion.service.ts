import Decimal from 'decimal.js';
import { AppDataSource } from '../../config/database';
import { TenantContext } from '../../shared/BaseRepository';
import { AppError } from '../../shared/AppError';
import { ResponseCode } from '../../shared/ApiResponse';
import { generateNo } from '../../shared/generateNo';

// ─── 类型定义 ──────────────────────────────────────────────────────

interface SuggestionRow {
  id: number;
  suggestion_no: string;
  source: string;
  production_order_id: number | null;
  sku_id: number;
  suggested_supplier_id: number | null;
  suggested_qty: string;
  purchase_unit: string;
  estimated_price: string | null;
  estimated_amount: string | null;
  shortage_qty: string;
  reason: string;
  confidence: string;
  status: string;
}

export interface ListSuggestionsParams {
  status?: string;
  source?: string;
  skuId?: number;
  page: number;
  pageSize: number;
}

export interface BatchToPOResult {
  createdPOs: Array<{ id: number; poNo: string; supplierId: number; itemCount: number }>;
  executedSuggestionIds: number[];
}

// ─── PurchaseSuggestionService ────────────────────────────────────

export class PurchaseSuggestionService {
  private readonly tenantId: number;
  private readonly userId: number;

  constructor(ctx: TenantContext) {
    this.tenantId = ctx.tenantId;
    this.userId = ctx.userId;
  }

  /**
   * 查询采购建议列表（支持 source 筛选）
   */
  async listSuggestions(params: ListSuggestionsParams): Promise<{ list: unknown[]; total: number }> {
    const conds: string[] = ['ps.tenant_id = ?'];
    const qParams: unknown[] = [this.tenantId];

    if (params.status) {
      conds.push('ps.status = ?');
      qParams.push(params.status);
    }
    if (params.source) {
      conds.push('ps.source = ?');
      qParams.push(params.source);
    }
    if (params.skuId) {
      conds.push('ps.sku_id = ?');
      qParams.push(params.skuId);
    }

    const where = conds.join(' AND ');
    const offset = (params.page - 1) * params.pageSize;

    const [list, countRows] = await Promise.all([
      AppDataSource.query(
        `SELECT
           ps.*,
           s.sku_code, s.name AS skuName, s.stock_unit,
           sup.name AS supplierName,
           po.work_order_no
         FROM purchase_suggestions ps
         INNER JOIN skus s ON s.id = ps.sku_id AND s.tenant_id = ps.tenant_id
         LEFT JOIN suppliers sup ON sup.id = ps.suggested_supplier_id
         LEFT JOIN production_orders po ON po.id = ps.production_order_id AND po.tenant_id = ps.tenant_id
         WHERE ${where}
         ORDER BY ps.id DESC
         LIMIT ? OFFSET ?`,
        [...qParams, params.pageSize, offset],
      ),
      AppDataSource.query<Array<{ total: number }>>(
        `SELECT COUNT(*) AS total FROM purchase_suggestions ps WHERE ${where}`,
        qParams,
      ),
    ]);

    return { list, total: Number(countRows[0]?.total ?? 0) };
  }

  /**
   * 审批通过采购建议
   */
  async approveSuggestion(id: number): Promise<void> {
    const [sugg] = await AppDataSource.query<SuggestionRow[]>(
      `SELECT id, status FROM purchase_suggestions WHERE id = ? AND tenant_id = ? LIMIT 1`,
      [id, this.tenantId],
    );
    if (!sugg) throw AppError.notFound('采购建议不存在', ResponseCode.NOT_FOUND);
    if (sugg.status !== 'pending') {
      throw AppError.badRequest(`当前状态 "${sugg.status}" 不允许审批操作`, ResponseCode.INVALID_PARAMS);
    }

    await AppDataSource.query(
      `UPDATE purchase_suggestions
       SET status = 'approved', approved_by = ?, approved_at = NOW(),
           reject_reason = NULL, updated_by = ?, updated_at = NOW()
       WHERE id = ? AND tenant_id = ?`,
      [this.userId, this.userId, id, this.tenantId],
    );
  }

  /**
   * 驳回采购建议
   */
  async rejectSuggestion(id: number, reason: string): Promise<void> {
    const [sugg] = await AppDataSource.query<SuggestionRow[]>(
      `SELECT id, status FROM purchase_suggestions WHERE id = ? AND tenant_id = ? LIMIT 1`,
      [id, this.tenantId],
    );
    if (!sugg) throw AppError.notFound('采购建议不存在', ResponseCode.NOT_FOUND);
    if (sugg.status !== 'pending') {
      throw AppError.badRequest(`当前状态 "${sugg.status}" 不允许驳回操作`, ResponseCode.INVALID_PARAMS);
    }

    await AppDataSource.query(
      `UPDATE purchase_suggestions
       SET status = 'rejected', approved_by = ?, approved_at = NOW(),
           reject_reason = ?, updated_by = ?, updated_at = NOW()
       WHERE id = ? AND tenant_id = ?`,
      [this.userId, reason, this.userId, id, this.tenantId],
    );
  }

  /**
   * 批量将审批通过的建议转为采购订单
   * - 按 supplier_id 分组，每组生成一张 PO 含多个明细行
   * - 更新建议 status = 'executed'
   */
  async batchCreatePOFromSuggestions(suggestionIds: number[]): Promise<BatchToPOResult> {
    if (suggestionIds.length === 0) {
      throw AppError.badRequest('至少选择一条采购建议', ResponseCode.INVALID_PARAMS);
    }

    // 查询所有选中的建议
    const placeholders = suggestionIds.map(() => '?').join(',');
    const suggestions = await AppDataSource.query<SuggestionRow[]>(
      `SELECT * FROM purchase_suggestions
       WHERE id IN (${placeholders}) AND tenant_id = ?`,
      [...suggestionIds, this.tenantId],
    );

    // 验证：全部必须是 approved 状态
    const nonApproved = suggestions.filter((s) => s.status !== 'approved');
    if (nonApproved.length > 0) {
      const ids = nonApproved.map((s) => s.id).join(', ');
      throw AppError.badRequest(
        `以下采购建议未处于审批通过状态，无法转单：${ids}`,
        ResponseCode.INVALID_PARAMS,
      );
    }

    // 按 supplier_id 分组（无供应商的单独分组）
    const groupMap = new Map<number | null, SuggestionRow[]>();
    for (const sugg of suggestions) {
      const key = sugg.suggested_supplier_id;
      const group = groupMap.get(key) ?? [];
      group.push(sugg);
      groupMap.set(key, group);
    }

    // 检查是否存在无供应商的建议
    if (groupMap.has(null)) {
      const noSupplierSuggs = groupMap.get(null)!;
      const ids = noSupplierSuggs.map((s) => s.id).join(', ');
      throw AppError.badRequest(
        `以下采购建议未指定供应商，无法转单：${ids}`,
        ResponseCode.INVALID_PARAMS,
      );
    }

    const createdPOs: BatchToPOResult['createdPOs'] = [];
    const executedSuggestionIds: number[] = [];

    return AppDataSource.transaction(async (manager) => {
      for (const [supplierId, group] of groupMap.entries()) {
        if (supplierId === null) continue;

        // 计算合计金额
        const totalAmount = group.reduce((sum, s) => {
          if (!s.estimated_amount) return sum;
          return sum.plus(new Decimal(s.estimated_amount));
        }, new Decimal(0));

        // 生成 PO 单号
        const poNo = await generateNo('purchase_order', this.tenantId);

        // 创建采购订单头
        const poResult = await manager.query(
          `INSERT INTO purchase_orders
             (tenant_id, po_no, supplier_id, status, total_amount,
              notes, created_by, updated_by)
           VALUES (?,?,?,?,?,?,?,?)`,
          [
            this.tenantId,
            poNo,
            supplierId,
            'draft',
            totalAmount.toFixed(2),
            `批量转单，来源建议：${group.map((s) => s.suggestion_no).join(', ')}`,
            this.userId,
            this.userId,
          ],
        );
        const poId = Number(poResult.insertId);

        // 创建采购订单明细行（每个建议一行）
        for (const sugg of group) {
          const unitPrice = sugg.estimated_price ?? '0';
          const qtyOrdered = sugg.suggested_qty;
          const amount = new Decimal(qtyOrdered).mul(new Decimal(unitPrice)).toFixed(2);

          await manager.query(
            `INSERT INTO purchase_order_items
               (tenant_id, po_id, sku_id, qty_ordered, qty_received,
                purchase_unit, unit_price, amount, created_by, updated_by)
             VALUES (?,?,?,?,0,?,?,?,?,?)`,
            [
              this.tenantId,
              poId,
              sugg.sku_id,
              qtyOrdered,
              sugg.purchase_unit,
              unitPrice,
              amount,
              this.userId,
              this.userId,
            ],
          );
        }

        // 更新所有建议状态为 executed，并关联 PO
        for (const sugg of group) {
          await manager.query(
            `UPDATE purchase_suggestions
             SET status = 'executed', updated_by = ?, updated_at = NOW()
             WHERE id = ? AND tenant_id = ?`,
            [this.userId, sugg.id, this.tenantId],
          );
          executedSuggestionIds.push(sugg.id);
        }

        createdPOs.push({
          id: poId,
          poNo,
          supplierId,
          itemCount: group.length,
        });
      }

      return { createdPOs, executedSuggestionIds };
    });
  }
}
