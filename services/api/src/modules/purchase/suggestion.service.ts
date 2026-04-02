import Decimal from 'decimal.js';
import { AppDataSource } from '../../config/database';
import { TenantContext } from '../../shared/BaseRepository';
import { AppError } from '../../shared/AppError';
import { ResponseCode } from '../../shared/ApiResponse';
import { BomService } from '../bom/bom.service';
import { InventoryService } from '../inventory/inventory.service';
import { UnitConverter } from '../../shared/unitConverter';

// ─── 类型定义 ──────────────────────────────────────────────────

export interface SuggestionItem {
  skuId: number;
  skuCode: string;
  skuName: string;
  spec: string | null;
  suggestedSupplierId: number | null;
  supplierName: string | null;
  suggestedQty: string;
  purchaseUnit: string;
  estimatedPrice: string | null;
  estimatedAmount: string | null;
  shortageQty: string;
  reason: string;
  confidence: 'high' | 'medium' | 'low';
  confidenceDetail: string;
  dyeLotRequirement: string | null;
}

// ─── Phase 1 规则引擎：AI 采购建议生成 ────────────────────────

export class SuggestionService {
  private readonly tenantId: number;
  private readonly userId: number;
  private readonly bomSvc: BomService;
  private readonly invSvc: InventoryService;

  constructor(ctx: TenantContext) {
    this.tenantId = ctx.tenantId;
    this.userId = ctx.userId;
    this.bomSvc = new BomService(ctx);
    this.invSvc = new InventoryService(ctx);
  }

  /**
   * 生成采购建议（Phase 1 规则引擎）
   *
   * 逻辑流程：
   * 1. 读取所有确认/生产中的销售订单，展开 BOM 计算物料总需求
   * 2. 读取当前库存 + 在途库存
   * 3. 计算缺口 = 需求 - 库存 - 在途
   * 4. 附加安全库存缓冲（触发阈值 = 安全库存 * 1.5）
   * 5. 查询推荐供应商（A级优先，按报价选最低价）
   * 6. 计算置信度（基于历史用量数据量）
   * 7. 写入 purchase_suggestions 表并触发通知
   */
  async generateSuggestions(): Promise<SuggestionItem[]> {
    // 1. 获取所有在产销售订单的BOM物料需求
    const materialNeeds = await this.calcTotalMaterialNeeds();

    const suggestions: SuggestionItem[] = [];

    for (const [skuId, need] of materialNeeds) {
      // 2. 读取当前可用库存
      const stock = await this.invSvc.getAvailableStock(skuId).catch(() => null);
      const qtyAvailable = stock ? stock.qtyAvailable : new Decimal(0);

      // 3. 读取在途库存（已下PO未到货）
      const [transitRow] = await AppDataSource.query<Array<{ qty: string }>>(
        `SELECT COALESCE(SUM(
           (poi.qty_ordered - poi.qty_received) *
           COALESCE(uc.conversion_rate, 1)
         ), 0) AS qty
         FROM purchase_order_items poi
         INNER JOIN purchase_orders po ON po.id = poi.po_id AND po.tenant_id = ?
         LEFT JOIN sku_unit_conversions uc
           ON uc.sku_id = poi.sku_id AND uc.from_unit = poi.purchase_unit
          AND uc.tenant_id = ?
         WHERE poi.sku_id = ? AND poi.tenant_id = ?
           AND po.status IN ('confirmed', 'partial_received')`,
        [this.tenantId, this.tenantId, skuId, this.tenantId],
      );
      const qtyInTransit = new Decimal(transitRow?.qty ?? 0);

      // 4. 计算净缺口
      const totalNeed = need.totalQty;
      const netShortage = totalNeed.minus(qtyAvailable).minus(qtyInTransit);

      // 5. 同时检查安全库存触发（即使不缺货，低于安全库存也建议补货）
      const [skuRow] = await AppDataSource.query<Array<{
        sku_code: string; name: string; spec: string | null;
        safety_stock: string; purchase_unit: string; has_dye_lot: number;
      }>>(
        `SELECT sku_code, name, spec, safety_stock, purchase_unit, has_dye_lot
         FROM skus WHERE id = ? AND tenant_id = ? LIMIT 1`,
        [skuId, this.tenantId],
      );
      if (!skuRow) continue;

      const safetyBuffer = new Decimal(skuRow.safety_stock).mul('1.5');
      const suggestQtyInStock = Decimal.max(Decimal.max(netShortage, safetyBuffer.minus(qtyAvailable)), new Decimal(0));

      if (suggestQtyInStock.lte(0)) continue; // 库存充足，无需采购

      // 6. 换算为采购单位
      const unitConversions = await AppDataSource.query<Array<{
        fromUnit: string; toUnit: string; conversionRate: string;
      }>>(
        'SELECT from_unit AS fromUnit, to_unit AS toUnit, conversion_rate AS conversionRate FROM sku_unit_conversions WHERE tenant_id = ? AND sku_id = ?',
        [this.tenantId, skuId],
      );

      let suggestQtyInPurchase: Decimal;
      try {
        const converted = UnitConverter.convertFromStock(
          suggestQtyInStock.toFixed(4),
          need.stockUnit,
          skuRow.purchase_unit,
          unitConversions,
        );
        suggestQtyInPurchase = converted;
      } catch {
        suggestQtyInPurchase = suggestQtyInStock; // 无换算关系时保持原单位
      }

      // 7. 查询推荐供应商（A级优先，最低现价）
      const [supplier] = await AppDataSource.query<Array<{
        supplier_id: number; supplier_name: string; price: string | null;
      }>>(
        `SELECT s.id AS supplier_id, s.name AS supplier_name, sp.price
         FROM suppliers s
         LEFT JOIN supplier_prices sp
           ON sp.supplier_id = s.id AND sp.sku_id = ? AND sp.is_current = 1
          AND sp.tenant_id = ?
         WHERE s.tenant_id = ? AND s.status = 'active'
           AND JSON_CONTAINS(s.main_skus, CAST(? AS JSON))
         ORDER BY FIELD(s.grade, 'A','B','C'), sp.price ASC
         LIMIT 1`,
        [skuId, this.tenantId, this.tenantId, skuId],
      );

      const estimatedPrice = supplier?.price ?? null;
      const estimatedAmount = estimatedPrice
        ? UnitConverter.calcAmount(suggestQtyInPurchase.toFixed(2), estimatedPrice).toFixed(2)
        : null;

      // 8. 计算置信度（基于历史流水数量）
      const [historyRow] = await AppDataSource.query<Array<{ cnt: number }>>(
        `SELECT COUNT(*) AS cnt FROM inventory_transactions
         WHERE tenant_id = ? AND sku_id = ? AND direction = 'OUT'
           AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`,
        [this.tenantId, skuId],
      );
      const historyCount = Number(historyRow?.cnt ?? 0);
      const confidence: 'high' | 'medium' | 'low' =
        historyCount >= 10 ? 'high' : historyCount >= 3 ? 'medium' : 'low';
      const confidenceDetail =
        confidence === 'low'
          ? `低置信度：该SKU近30天仅有${historyCount}次用量记录，数据不足`
          : confidence === 'medium'
          ? `中置信度：基于近30天${historyCount}次用量记录推算`
          : `高置信度：基于近30天${historyCount}次充足历史数据`;

      // 9. 面料类缸号说明
      const dyeLotRequirement = Boolean(skuRow.has_dye_lot)
        ? '该物料为面料/皮料类，采购时请与供应商确认缸号，确保与在产订单颜色批次一致'
        : null;

      const shortageQtyConverted = netShortage.lte(0) ? '0' : (() => {
        try {
          return UnitConverter.convertFromStock(
            netShortage.toFixed(4), need.stockUnit, skuRow.purchase_unit, unitConversions,
          ).toFixed(4);
        } catch { return netShortage.toFixed(4); }
      })();

      const reason = this.buildReason(
        need.orderCount, need.totalQty.toFixed(2), need.stockUnit,
        qtyAvailable.toFixed(2), netShortage.toFixed(2),
      );

      suggestions.push({
        skuId,
        skuCode: skuRow.sku_code,
        skuName: skuRow.name,
        spec: skuRow.spec,
        suggestedSupplierId: supplier?.supplier_id ?? null,
        supplierName: supplier?.supplier_name ?? null,
        suggestedQty: suggestQtyInPurchase.toFixed(2),
        purchaseUnit: skuRow.purchase_unit,
        estimatedPrice,
        estimatedAmount,
        shortageQty: shortageQtyConverted,
        reason,
        confidence,
        confidenceDetail,
        dyeLotRequirement,
      });
    }

    // 10. 批量写入 purchase_suggestions 表
    if (suggestions.length > 0) {
      await this.persistSuggestions(suggestions);
    }

    return suggestions;
  }

  // ── 查询采购建议列表 ───────────────────────────────────────

  async listSuggestions(params: {
    status?: string; page: number; pageSize: number;
  }): Promise<{ list: any[]; total: number }> {
    const conditions = ['ps.tenant_id = ?'];
    const qParams: unknown[] = [this.tenantId];

    if (params.status) { conditions.push('ps.status = ?'); qParams.push(params.status); }

    const where = conditions.join(' AND ');
    const offset = (params.page - 1) * params.pageSize;

    const [list, countRows] = await Promise.all([
      AppDataSource.query(
        `SELECT ps.*, s.name AS skuName, s.sku_code AS skuCode,
                sup.name AS supplierName
         FROM purchase_suggestions ps
         INNER JOIN skus s ON s.id = ps.sku_id
         LEFT JOIN suppliers sup ON sup.id = ps.suggested_supplier_id
         WHERE ${where}
         ORDER BY ps.id DESC LIMIT ? OFFSET ?`,
        [...qParams, params.pageSize, offset],
      ),
      AppDataSource.query<Array<{ total: number }>>(
        `SELECT COUNT(*) AS total FROM purchase_suggestions ps WHERE ${where}`,
        qParams,
      ),
    ]);

    return { list, total: Number(countRows[0]?.total ?? 0) };
  }

  async approveSuggestion(id: number, approved: boolean, rejectReason?: string): Promise<void> {
    const normalizedRejectReason = rejectReason?.trim();
    if (!approved && !normalizedRejectReason) {
      throw AppError.badRequest('驳回采购建议时必须填写驳回原因');
    }

    const status = approved ? 'approved' : 'rejected';
    const result = await AppDataSource.query(
      `UPDATE purchase_suggestions
       SET status = ?, approved_by = ?, approved_at = NOW(),
           reject_reason = ?, updated_by = ?
       WHERE id = ? AND tenant_id = ?`,
      [status, this.userId, normalizedRejectReason ?? null, this.userId, id, this.tenantId],
    );

    if (!result?.affectedRows) {
      throw AppError.notFound('采购建议不存在');
    }
  }

  // ── 私有辅助 ──────────────────────────────────────────────

  /**
   * 汇总所有在产销售订单的 BOM 物料总需求
   * Map<skuId, { totalQty, stockUnit, orderCount }>
   */
  private async calcTotalMaterialNeeds(): Promise<Map<number, {
    totalQty: Decimal; stockUnit: string; orderCount: number;
  }>> {
    // 查询所有确认/在产的生产工单
    const productionOrders = await AppDataSource.query<Array<{
      id: number; bom_header_id: number; qty_planned: string;
    }>>(
      `SELECT id, bom_header_id, qty_planned
       FROM production_orders
       WHERE tenant_id = ? AND status IN ('pending', 'scheduled', 'in_progress')`,
      [this.tenantId],
    );

    const accumulator = new Map<number, { totalQty: Decimal; stockUnit: string; orderCount: number }>();

    for (const po of productionOrders) {
      let materials;
      try {
        materials = await this.bomSvc.calcMaterialRequirements(
          po.bom_header_id, po.qty_planned,
        );
      } catch (err) {
        if (
          err instanceof AppError
          && (
            err.code === ResponseCode.BOM_NOT_FOUND
            || err.code === ResponseCode.SKU_NOT_FOUND
          )
        ) {
          // 跳过历史脏数据（工单关联 BOM/SKU 已失效），避免整批建议生成失败。
          console.warn(
            `[SuggestionService] 跳过异常工单，原因=${err.message}, tenantId=${this.tenantId}, productionOrderId=${po.id}, bomId=${po.bom_header_id}`,
          );
          continue;
        }
        throw err;
      }
      for (const m of materials) {
        const existing = accumulator.get(m.skuId);
        if (existing) {
          existing.totalQty = existing.totalQty.plus(new Decimal(m.totalQty));
          existing.orderCount += 1;
        } else {
          accumulator.set(m.skuId, {
            totalQty: new Decimal(m.totalQty),
            stockUnit: m.stockUnit,
            orderCount: 1,
          });
        }
      }
    }

    return accumulator;
  }

  private buildReason(
    orderCount: number,
    totalNeed: string,
    unit: string,
    available: string,
    shortage: string,
  ): string {
    return `当前有${orderCount}个在产订单共需要${totalNeed}${unit}，` +
      `当前可用库存${available}${unit}，` +
      (parseFloat(shortage) > 0
        ? `缺口${shortage}${unit}，建议立即采购`
        : `已低于安全库存缓冲，建议适量补货`);
  }

  private async persistSuggestions(items: SuggestionItem[]): Promise<void> {
    if (items.length === 0) return;

    return AppDataSource.transaction(async (manager) => {
      const expiredAt = new Date(Date.now() + 24 * 3600 * 1000);

      // 先清除本租户当前 pending 状态的旧建议，避免重复堆积
      await manager.query(
        `DELETE FROM purchase_suggestions WHERE tenant_id = ? AND status = 'pending'`,
        [this.tenantId],
      );

      // 批量 INSERT：所有建议通过单条 SQL 一次性写入，消除 N 次 DB 往返
      const placeholders = items.map(() => '(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').join(',');
      const values = items.flatMap((item) => [
        this.tenantId,
        // suggestion_no 使用时间戳 + index 保证同批次内唯一
        `SG${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
        item.skuId,
        item.suggestedSupplierId,
        item.suggestedQty,
        item.purchaseUnit,
        item.estimatedPrice,
        item.estimatedAmount,
        item.shortageQty,
        item.reason,
        item.confidence,
        item.confidenceDetail,
        item.dyeLotRequirement,
        'pending',
        expiredAt,
        this.userId,
        this.userId,
      ]);

      await manager.query(
        `INSERT INTO purchase_suggestions
           (tenant_id, suggestion_no, sku_id, suggested_supplier_id, suggested_qty,
            purchase_unit, estimated_price, estimated_amount, shortage_qty, reason,
            confidence, confidence_detail, dye_lot_requirement, status, expired_at,
            created_by, updated_by)
         VALUES ${placeholders}`,
        values,
      );
    });
  }
}
