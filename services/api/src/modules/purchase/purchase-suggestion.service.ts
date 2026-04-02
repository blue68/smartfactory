import Decimal from 'decimal.js';
import { AppDataSource } from '../../config/database';
import { TenantContext } from '../../shared/BaseRepository';
import { AppError } from '../../shared/AppError';
import { ResponseCode } from '../../shared/ApiResponse';
import { generateNo } from '../../shared/generateNo';
import { EntityManager } from 'typeorm';
import { getRedisClient, RedisKeys } from '../../config/redis';

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
  /** 审批人 ID；NULL 表示尚未经过人工审批（BE-S4-16） */
  approved_by: number | null;
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

  private async invalidateInventorySnapshotCaches(skuIds: number[]): Promise<void> {
    if (skuIds.length === 0) return;
    try {
      const redis = getRedisClient();
      await Promise.all(
        Array.from(new Set(skuIds)).map((skuId) =>
          redis.del(RedisKeys.inventorySnapshot(this.tenantId, skuId)),
        ),
      );
    } catch (err) {
      console.warn('[PurchaseSuggestionService] 库存缓存失效失败，已忽略:', (err as Error).message);
    }
  }

  private async syncPoInTransitToInventory(
    manager: Pick<EntityManager, 'query'>,
    poId: number,
  ): Promise<void> {
    await manager.query(
      `INSERT INTO inventory (tenant_id, sku_id, qty_on_hand, qty_reserved, qty_in_transit)
       SELECT
         poi.tenant_id,
         poi.sku_id,
         0,
         0,
         COALESCE(SUM(poi.qty_ordered * COALESCE(uc.conversion_rate, 1)), 0)
       FROM purchase_order_items poi
       LEFT JOIN sku_unit_conversions uc
         ON uc.sku_id = poi.sku_id
        AND uc.from_unit = poi.purchase_unit
        AND uc.tenant_id = poi.tenant_id
       WHERE poi.po_id = ? AND poi.tenant_id = ?
       GROUP BY poi.tenant_id, poi.sku_id
       ON DUPLICATE KEY UPDATE
         qty_in_transit = qty_in_transit + VALUES(qty_in_transit)`,
      [poId, this.tenantId],
    );
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
         LEFT JOIN suppliers sup ON sup.id = ps.suggested_supplier_id AND sup.tenant_id = ps.tenant_id
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
    await AppDataSource.transaction(async (manager) => {
      const [sugg] = await manager.query<SuggestionRow[]>(
        `SELECT id, status
         FROM purchase_suggestions
         WHERE id = ? AND tenant_id = ? LIMIT 1 FOR UPDATE`,
        [id, this.tenantId],
      );
      if (!sugg) throw AppError.notFound('采购建议不存在', ResponseCode.NOT_FOUND);
      if (sugg.status !== 'pending') {
        throw AppError.badRequest(`当前状态 "${sugg.status}" 不允许审批操作`, ResponseCode.INVALID_PARAMS);
      }

      await manager.query(
        `UPDATE purchase_suggestions
         SET status = 'approved', approved_by = ?, approved_at = NOW(),
             reject_reason = NULL, updated_by = ?, updated_at = NOW()
         WHERE id = ? AND tenant_id = ?`,
        [this.userId, this.userId, id, this.tenantId],
      );
    });
  }

  /**
   * 驳回采购建议
   */
  async rejectSuggestion(id: number, reason: string): Promise<void> {
    await AppDataSource.transaction(async (manager) => {
      const [sugg] = await manager.query<SuggestionRow[]>(
        `SELECT id, status
         FROM purchase_suggestions
         WHERE id = ? AND tenant_id = ? LIMIT 1 FOR UPDATE`,
        [id, this.tenantId],
      );
      if (!sugg) throw AppError.notFound('采购建议不存在', ResponseCode.NOT_FOUND);
      if (sugg.status !== 'pending') {
        throw AppError.badRequest(`当前状态 "${sugg.status}" 不允许驳回操作`, ResponseCode.INVALID_PARAMS);
      }

      await manager.query(
        `UPDATE purchase_suggestions
         SET status = 'rejected', approved_by = ?, approved_at = NOW(),
             reject_reason = ?, updated_by = ?, updated_at = NOW()
         WHERE id = ? AND tenant_id = ?`,
        [this.userId, reason, this.userId, id, this.tenantId],
      );
    });
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
    // FIND-S4-007 fix: Service 层双保险，防止绕过 Controller 直接调用
    if (suggestionIds.length > 100) {
      throw AppError.badRequest('单次最多处理 100 条采购建议', ResponseCode.INVALID_PARAMS);
    }
    const uniqueSuggestionIds = [...new Set(suggestionIds)];
    if (uniqueSuggestionIds.length !== suggestionIds.length) {
      throw AppError.badRequest('采购建议 ID 不允许重复，请检查选择结果', ResponseCode.INVALID_PARAMS);
    }

    const placeholders = uniqueSuggestionIds.map(() => '?').join(',');
    const result = await AppDataSource.transaction(async (manager) => {
      const suggestions = await manager.query<SuggestionRow[]>(
        `SELECT *
         FROM purchase_suggestions
         WHERE id IN (${placeholders}) AND tenant_id = ?
         ORDER BY id
         FOR UPDATE`,
        [...uniqueSuggestionIds, this.tenantId],
      );
      if (suggestions.length !== uniqueSuggestionIds.length) {
        const foundIds = new Set(suggestions.map((item) => item.id));
        const missingIds = uniqueSuggestionIds.filter((id) => !foundIds.has(id));
        throw AppError.notFound(
          `以下采购建议不存在或不属于当前租户：${missingIds.join(', ')}`,
          ResponseCode.NOT_FOUND,
        );
      }

      const unapprovedAiSuggs = suggestions.filter(
        (s) => s.source === 'ai_schedule' && !s.approved_by,
      );
      if (unapprovedAiSuggs.length > 0) {
        const ids = unapprovedAiSuggs.map((s) => s.id).join(', ');
        throw AppError.forbidden(
          `以下 AI 调度建议尚未经过人工审批，禁止直接转单：${ids}。请先由主管或老板完成审批。`,
        );
      }

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
            'confirmed',
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

        await this.syncPoInTransitToInventory(manager, poId);

        createdPOs.push({
          id: poId,
          poNo,
          supplierId,
          itemCount: group.length,
        });
      }

      return {
        createdPOs,
        executedSuggestionIds,
        affectedSkuIds: Array.from(new Set(suggestions.map((s) => Number(s.sku_id)))),
      };
    });

    await this.invalidateInventorySnapshotCaches(result.affectedSkuIds);
    return {
      createdPOs: result.createdPOs,
      executedSuggestionIds: result.executedSuggestionIds,
    };
  }
}
