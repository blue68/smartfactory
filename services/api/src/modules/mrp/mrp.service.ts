import Decimal from 'decimal.js';
import { AppDataSource } from '../../config/database';
import { TenantContext } from '../../shared/BaseRepository';
import { AppError } from '../../shared/AppError';
import { ResponseCode } from '../../shared/ApiResponse';
import { generateNo } from '../../shared/generateNo';
import { EntityManager } from 'typeorm';

// ─── 내부 타입 정의 ──────────────────────────────────────────────

interface MaterialRequirementRow {
  id: number;
  production_order_id: number;
  bom_snapshot_id: number | null;
  sku_id: number;
  qty_required: string;
  qty_reserved: string;
  qty_shortage: string;
  status: 'shortage' | 'partial' | 'fulfilled';
  suggestion_id: number | null;
}

interface InventoryRow {
  qty_on_hand: string;
  qty_reserved: string;
  qty_in_transit: string;
}

interface SkuRow {
  id: number;
  sku_code: string;
  name: string;
  stock_unit: string;
  purchase_unit: string;
  safety_stock: string;
}

interface SupplierPriceRow {
  supplier_id: number;
  supplier_name: string;
  unit_price: string;
}

interface ProductionOrderRow {
  id: number;
  work_order_no: string;
  material_status: string;
}

export interface ShortageItem {
  requirementId: number;
  skuId: number;
  skuCode: string;
  skuName: string;
  stockUnit: string;
  purchaseUnit: string;
  qtyRequired: string;
  qtyAvailable: string;
  qtyInTransit: string;
  qtyShortage: string;
  status: string;
  suggestionId: number | null;
  hasPendingSuggestion: boolean;
}

export interface ShortageReportResult {
  productionOrderId: number;
  workOrderNo: string;
  materialStatus: string;
  items: ShortageItem[];
}

export interface GlobalShortageItem {
  skuId: number;
  skuCode: string;
  skuName: string;
  stockUnit: string;
  totalQtyRequired: string;
  totalQtyAvailable: string;
  totalQtyInTransit: string;
  totalQtyShortage: string;
  affectedOrderCount: number;
  affectedOrderIds: number[];
}

export interface GenerateSuggestionsResult {
  created: number;
  updated: number;
  skipped: number;
  suggestionIds: number[];
}

export interface ReevaluateResult {
  affectedOrderIds: number[];
  updatedRequirements: number;
}

export interface SupplyChainDashboard {
  pendingReceiptPOCount: number;
  shortageOrderCount: number;
  weeklyReceivedBatchCount: number;
  weeklyPendingSuggestionCount: number;
}

// ─── MRP Service ──────────────────────────────────────────────────

export class MrpService {
  private readonly tenantId: number;
  private readonly userId: number;

  constructor(ctx: TenantContext) {
    this.tenantId = ctx.tenantId;
    this.userId = ctx.userId;
  }

  /**
   * 检测单个工单的缺料情况
   * - 读取 material_requirements
   * - 对每种 SKU 计算可用库存与在途量
   * - 更新 material_requirements 的 qty_reserved / qty_shortage / status
   * - 更新 production_orders.material_status
   */
  async detectShortage(productionOrderId: number, outerManager?: EntityManager): Promise<{
    shortageItems: ShortageItem[];
    materialStatus: string;
  }> {
    const run = async (manager: EntityManager): Promise<{
      shortageItems: ShortageItem[];
      materialStatus: string;
    }> => {
      // 验证工单存在且属于当前租户
      const [order] = await manager.query<ProductionOrderRow[]>(
        `SELECT id, work_order_no, material_status
         FROM production_orders
         WHERE id = ? AND tenant_id = ? LIMIT 1`,
        [productionOrderId, this.tenantId],
      );
      if (!order) throw AppError.notFound('生产工单不存在', ResponseCode.PRODUCTION_ORDER_NOT_FOUND);

      // 读取物料需求记录
      const requirements = await manager.query<MaterialRequirementRow[]>(
        `SELECT id, production_order_id, bom_snapshot_id, sku_id,
                qty_required, qty_reserved, qty_shortage, status, suggestion_id
         FROM material_requirements
         WHERE production_order_id = ? AND tenant_id = ?`,
        [productionOrderId, this.tenantId],
      );

      if (requirements.length === 0) {
        return { shortageItems: [], materialStatus: 'ready' };
      }

      const shortageItems: ShortageItem[] = [];
      let hasShortage = false;
      let hasPartial = false;

      for (const req of requirements) {
        // 查询当前可用库存（qty_on_hand - qty_reserved）和在途量
        const [inv] = await manager.query<InventoryRow[]>(
          `SELECT
             COALESCE(qty_on_hand, 0) AS qty_on_hand,
             COALESCE(qty_reserved, 0) AS qty_reserved,
             COALESCE(qty_in_transit, 0) AS qty_in_transit
           FROM inventory
           WHERE sku_id = ? AND tenant_id = ? LIMIT 1`,
          [req.sku_id, this.tenantId],
        );

        const qtyOnHand = new Decimal(inv?.qty_on_hand ?? 0);
        const qtyReserved = new Decimal(inv?.qty_reserved ?? 0);
        const qtyInTransit = new Decimal(inv?.qty_in_transit ?? 0);
        const qtyAvailable = Decimal.max(qtyOnHand.minus(qtyReserved), new Decimal(0));

        const qtyRequired = new Decimal(req.qty_required);
        const reservedForThisOrder = Decimal.min(
          Decimal.max(new Decimal(req.qty_reserved ?? 0), new Decimal(0)),
          qtyRequired,
        );
        const remainingNeed = Decimal.max(qtyRequired.minus(reservedForThisOrder), new Decimal(0));

        // 净缺口 = 剩余需求量 - 当前可用库存 - 在途量
        const netShortage = Decimal.max(
          remainingNeed.minus(qtyAvailable).minus(qtyInTransit),
          new Decimal(0),
        );
        const totalCovered = reservedForThisOrder.plus(
          Decimal.min(remainingNeed, qtyAvailable.plus(qtyInTransit)),
        );

        // 确定需求状态
        let itemStatus: 'shortage' | 'partial' | 'fulfilled';
        if (totalCovered.gte(qtyRequired)) {
          itemStatus = 'fulfilled';
        } else if (totalCovered.gt(0)) {
          itemStatus = 'partial';
          hasPartial = true;
        } else {
          itemStatus = 'shortage';
          hasShortage = true;
        }

        // 更新 material_requirements
        await manager.query(
          `UPDATE material_requirements
           SET qty_reserved = ?, qty_shortage = ?, status = ?, updated_at = NOW()
           WHERE id = ? AND tenant_id = ?`,
          [
            reservedForThisOrder.toFixed(4),
            netShortage.toFixed(4),
            itemStatus,
            req.id,
            this.tenantId,
          ],
        );

        // 检查是否已有 pending 采购建议
        const [pendingSugg] = await manager.query<Array<{ id: number }>>(
          `SELECT id FROM purchase_suggestions
           WHERE sku_id = ? AND tenant_id = ? AND status = 'pending' LIMIT 1`,
          [req.sku_id, this.tenantId],
        );

        // 读取 SKU 基本信息
        const [sku] = await manager.query<SkuRow[]>(
          `SELECT id, sku_code, name, stock_unit, purchase_unit, safety_stock
           FROM skus WHERE id = ? AND tenant_id = ? LIMIT 1`,
          [req.sku_id, this.tenantId],
        );

        shortageItems.push({
          requirementId: req.id,
          skuId: req.sku_id,
          skuCode: sku?.sku_code ?? String(req.sku_id),
          skuName: sku?.name ?? '',
          stockUnit: sku?.stock_unit ?? '',
          purchaseUnit: sku?.purchase_unit ?? '',
          qtyRequired: qtyRequired.toFixed(4),
          qtyAvailable: qtyAvailable.toFixed(4),
          qtyInTransit: qtyInTransit.toFixed(4),
          qtyShortage: netShortage.toFixed(4),
          status: itemStatus,
          suggestionId: req.suggestion_id,
          hasPendingSuggestion: Boolean(pendingSugg),
        });
      }

      // 汇总工单物料状态
      let materialStatus: string;
      if (hasShortage && !hasPartial) {
        materialStatus = 'shortage';
      } else if (hasShortage || hasPartial) {
        materialStatus = 'partial';
      } else {
        materialStatus = 'ready';
      }

      // 更新生产工单的物料状态
      await manager.query(
        `UPDATE production_orders
         SET material_status = ?, updated_at = NOW()
         WHERE id = ? AND tenant_id = ?`,
        [materialStatus, productionOrderId, this.tenantId],
      );

      return { shortageItems, materialStatus };
    };

    if (outerManager) {
      return run(outerManager);
    }
    return AppDataSource.transaction(run);
  }

  /**
   * 获取工单缺料报告明细
   * 返回每种原材料的: SKU信息、需求量、可用库存、在途量、缺口量、是否已有采购建议
   */
  async getShortageReport(productionOrderId: number): Promise<ShortageReportResult> {
    const [order] = await AppDataSource.query<ProductionOrderRow[]>(
      `SELECT id, work_order_no, material_status
       FROM production_orders
       WHERE id = ? AND tenant_id = ? LIMIT 1`,
      [productionOrderId, this.tenantId],
    );
    if (!order) throw AppError.notFound('生产工单不存在', ResponseCode.PRODUCTION_ORDER_NOT_FOUND);

    // 先执行缺料检测以确保数据最新
    const { shortageItems, materialStatus } = await this.detectShortage(productionOrderId);

    return {
      productionOrderId,
      workOrderNo: order.work_order_no,
      materialStatus,
      items: shortageItems,
    };
  }

  /**
   * 全局缺料汇总（跨工单合并同类项）
   * 合并所有 pending/scheduled 工单的缺料，按 sku_id 汇总
   * 返回按缺口严重程度排序
   */
  async getGlobalShortageSummary(filter?: {
    status?: string;
    skuId?: number;
    page: number;
    pageSize: number;
  }): Promise<{ list: GlobalShortageItem[]; total: number }> {
    const page = filter?.page ?? 1;
    const pageSize = filter?.pageSize ?? 20;
    const offset = (page - 1) * pageSize;

    const conds: string[] = [
      'mr.tenant_id = ?',
      `po.status IN ('pending', 'scheduled', 'in_progress')`,
      `mr.status IN ('shortage', 'partial')`,
    ];
    const params: unknown[] = [this.tenantId];

    if (filter?.skuId) {
      conds.push('mr.sku_id = ?');
      params.push(filter.skuId);
    }

    const where = conds.join(' AND ');

    const aggregateRows = await AppDataSource.query<Array<{
      sku_id: number;
      sku_code: string;
      sku_name: string;
      stock_unit: string;
      total_qty_required: string;
      total_qty_shortage: string;
      affected_order_count: number;
      order_ids: string;
    }>>(
      `SELECT
         mr.sku_id,
         s.sku_code,
         s.name AS sku_name,
         s.stock_unit,
         SUM(mr.qty_required) AS total_qty_required,
         SUM(mr.qty_shortage) AS total_qty_shortage,
         COUNT(DISTINCT mr.production_order_id) AS affected_order_count,
         GROUP_CONCAT(DISTINCT mr.production_order_id ORDER BY mr.production_order_id) AS order_ids
       FROM material_requirements mr
       INNER JOIN production_orders po ON po.id = mr.production_order_id AND po.tenant_id = mr.tenant_id
       INNER JOIN skus s ON s.id = mr.sku_id AND s.tenant_id = mr.tenant_id
       WHERE ${where}
       GROUP BY mr.sku_id, s.sku_code, s.name, s.stock_unit
       ORDER BY SUM(mr.qty_shortage) DESC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset],
    );

    const [countRow] = await AppDataSource.query<Array<{ total: number }>>(
      `SELECT COUNT(DISTINCT mr.sku_id) AS total
       FROM material_requirements mr
       INNER JOIN production_orders po ON po.id = mr.production_order_id AND po.tenant_id = mr.tenant_id
       WHERE ${where}`,
      params,
    );

    // 查询每个SKU的可用库存和在途量（合并计算）
    const list: GlobalShortageItem[] = await Promise.all(
      aggregateRows.map(async (row) => {
        const [inv] = await AppDataSource.query<InventoryRow[]>(
          `SELECT
             COALESCE(qty_on_hand, 0) AS qty_on_hand,
             COALESCE(qty_reserved, 0) AS qty_reserved,
             COALESCE(qty_in_transit, 0) AS qty_in_transit
           FROM inventory
           WHERE sku_id = ? AND tenant_id = ? LIMIT 1`,
          [row.sku_id, this.tenantId],
        );

        const qtyOnHand = new Decimal(inv?.qty_on_hand ?? 0);
        const qtyReservedInv = new Decimal(inv?.qty_reserved ?? 0);
        const qtyInTransit = new Decimal(inv?.qty_in_transit ?? 0);
        const qtyAvailable = Decimal.max(qtyOnHand.minus(qtyReservedInv), new Decimal(0));

        const orderIds = row.order_ids
          ? row.order_ids.split(',').map(Number)
          : [];

        return {
          skuId: row.sku_id,
          skuCode: row.sku_code,
          skuName: row.sku_name,
          stockUnit: row.stock_unit,
          totalQtyRequired: new Decimal(row.total_qty_required).toFixed(4),
          totalQtyAvailable: qtyAvailable.toFixed(4),
          totalQtyInTransit: qtyInTransit.toFixed(4),
          totalQtyShortage: new Decimal(row.total_qty_shortage).toFixed(4),
          affectedOrderCount: Number(row.affected_order_count),
          affectedOrderIds: orderIds,
        };
      }),
    );

    return { list, total: Number(countRow?.total ?? 0) };
  }

  /**
   * 基于缺料生成采购建议
   * - 对每种缺料 SKU：检查防重复 → 更新或新建建议
   * - 查询最优供应商（supplier_prices 最低价）
   * - source = 'production_shortage'
   */
  async generateSuggestions(
    productionOrderId?: number,
    outerManager?: EntityManager,
  ): Promise<GenerateSuggestionsResult> {
    let shortageByRequirementId = new Map<number, ShortageItem>();

    // 如果指定工单，先做缺料检测刷新数据
    if (productionOrderId) {
      const detection = await this.detectShortage(productionOrderId, outerManager);
      shortageByRequirementId = new Map(
        detection.shortageItems.map((item) => [item.requirementId, item]),
      );
    }

    const run = async (manager: EntityManager): Promise<GenerateSuggestionsResult> => {
      // 构建查询条件
      const conds: string[] = [
        'mr.tenant_id = ?',
        `mr.status IN ('shortage', 'partial')`,
        `mr.qty_shortage > 0`,
        `po.status IN ('pending', 'scheduled', 'in_progress')`,
      ];
      const params: unknown[] = [this.tenantId];

      if (productionOrderId) {
        conds.push('mr.production_order_id = ?');
        params.push(productionOrderId);
      }

      const where = conds.join(' AND ');

      // 查询缺料明细（关联工单信息）
      const requirements = await manager.query<Array<
        MaterialRequirementRow & {
          work_order_no: string;
          sku_code: string;
          sku_name: string;
          stock_unit: string;
          purchase_unit: string;
        }
      >>(
        `SELECT mr.*,
                po.work_order_no,
                s.sku_code, s.name AS sku_name,
                s.stock_unit, s.purchase_unit
         FROM material_requirements mr
         INNER JOIN production_orders po ON po.id = mr.production_order_id AND po.tenant_id = mr.tenant_id
         INNER JOIN skus s ON s.id = mr.sku_id AND s.tenant_id = mr.tenant_id
         WHERE ${where}
         ORDER BY mr.sku_id, mr.production_order_id`,
        params,
      );

      if (requirements.length === 0) {
        return { created: 0, updated: 0, skipped: 0, suggestionIds: [] };
      }

      let created = 0;
      let updated = 0;
      let skipped = 0;
      const suggestionIds: number[] = [];

      for (const req of requirements) {
        const qtyShortage = new Decimal(req.qty_shortage);
        if (qtyShortage.lte(0)) {
          skipped++;
          continue;
        }

        // 检查是否已有 pending 状态的采购建议（防重复）
          const [existingSugg] = await manager.query<Array<{
            id: number;
            suggested_qty: string;
            production_order_id: number | null;
            suggested_supplier_id: number | null;
            estimated_price: string | null;
          }>>(
          `SELECT id, suggested_qty, production_order_id, suggested_supplier_id, estimated_price
           FROM purchase_suggestions
           WHERE sku_id = ? AND tenant_id = ? AND status = 'pending'
             AND source = 'production_shortage'
           LIMIT 1`,
          [req.sku_id, this.tenantId],
        );

        if (existingSugg) {
          // 已有建议：更新 suggested_qty = max(现有, 新缺口)
          const existingQty = new Decimal(existingSugg.suggested_qty);
          const newQty = Decimal.max(existingQty, qtyShortage);
          const needsSupplierBackfill =
            existingSugg.suggested_supplier_id == null || existingSugg.estimated_price == null;

          let suggestedSupplierId = existingSugg.suggested_supplier_id;
          let estimatedPrice = existingSugg.estimated_price;
          let estimatedAmount = estimatedPrice
            ? newQty.mul(new Decimal(estimatedPrice)).toFixed(2)
            : null;

          if (needsSupplierBackfill) {
            const [bestSupplier] = await manager.query<SupplierPriceRow[]>(
              `SELECT sp.supplier_id, sup.name AS supplier_name, sp.price AS unit_price
               FROM supplier_prices sp
               INNER JOIN suppliers sup ON sup.id = sp.supplier_id AND sup.tenant_id = sp.tenant_id
               WHERE sp.sku_id = ? AND sp.tenant_id = ?
                 AND sp.is_current = 1
                 AND (sp.expired_at IS NULL OR sp.expired_at >= CURDATE())
                 AND (sp.effective_at IS NULL OR sp.effective_at <= CURDATE())
               ORDER BY CAST(sp.price AS DECIMAL(20,6)) ASC
               LIMIT 1`,
              [req.sku_id, this.tenantId],
            );

            suggestedSupplierId = bestSupplier?.supplier_id ?? null;
            estimatedPrice = bestSupplier?.unit_price ?? null;
            estimatedAmount = estimatedPrice
              ? newQty.mul(new Decimal(estimatedPrice)).toFixed(2)
              : null;
          }

          if (newQty.gt(existingQty) || needsSupplierBackfill) {
            await manager.query(
              `UPDATE purchase_suggestions
               SET suggested_qty = ?, shortage_qty = ?, suggested_supplier_id = ?,
                   estimated_price = ?, estimated_amount = ?, updated_by = ?, updated_at = NOW()
               WHERE id = ? AND tenant_id = ?`,
              [
                newQty.toFixed(4),
                qtyShortage.toFixed(4),
                suggestedSupplierId,
                estimatedPrice,
                estimatedAmount,
                this.userId,
                existingSugg.id,
                this.tenantId,
              ],
            );
            updated++;
          } else {
            skipped++;
          }

          // 更新 material_requirements.suggestion_id
          await manager.query(
            `UPDATE material_requirements
             SET suggestion_id = ?, updated_at = NOW()
             WHERE id = ? AND tenant_id = ?`,
            [existingSugg.id, req.id, this.tenantId],
          );

          if (!suggestionIds.includes(existingSugg.id)) {
            suggestionIds.push(existingSugg.id);
          }
          continue;
        }

        // 无已有建议：查询最优供应商（按单价升序取最低价）
        const [bestSupplier] = await manager.query<SupplierPriceRow[]>(
          `SELECT sp.supplier_id, sup.name AS supplier_name, sp.price AS unit_price
           FROM supplier_prices sp
           INNER JOIN suppliers sup ON sup.id = sp.supplier_id AND sup.tenant_id = sp.tenant_id
           WHERE sp.sku_id = ? AND sp.tenant_id = ?
             AND sp.is_current = 1
             AND (sp.expired_at IS NULL OR sp.expired_at >= CURDATE())
             AND (sp.effective_at IS NULL OR sp.effective_at <= CURDATE())
           ORDER BY CAST(sp.price AS DECIMAL(20,6)) ASC
           LIMIT 1`,
          [req.sku_id, this.tenantId],
        );

        const suggestedSupplierId = bestSupplier?.supplier_id ?? null;
        const estimatedPrice = bestSupplier?.unit_price ?? null;
        const estimatedAmount = estimatedPrice
          ? qtyShortage.mul(new Decimal(estimatedPrice)).toFixed(2)
          : null;
        const shortageCtx = shortageByRequirementId.get(req.id);

        const reason =
          `生产工单 ${req.work_order_no} 需要 ${new Decimal(req.qty_required).toFixed(4)} ${req.stock_unit}，` +
          `当前可用库存 ${shortageCtx?.qtyAvailable ?? '0.0000'}，` +
          `在途 ${shortageCtx?.qtyInTransit ?? '0.0000'}，` +
          `缺口 ${qtyShortage.toFixed(4)}`;

        // 生成建议单号
        const suggestionNo = await generateNo('suggestion', this.tenantId);

        const insertResult = await manager.query(
          `INSERT INTO purchase_suggestions
             (tenant_id, suggestion_no, source, production_order_id, sku_id,
              suggested_supplier_id, suggested_qty, purchase_unit,
              estimated_price, estimated_amount, shortage_qty, reason,
              confidence, status, created_by, updated_by)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            this.tenantId,
            suggestionNo,
            'production_shortage',
            req.production_order_id,
            req.sku_id,
            suggestedSupplierId,
            qtyShortage.toFixed(4),
            req.purchase_unit,
            estimatedPrice,
            estimatedAmount,
            qtyShortage.toFixed(4),
            reason,
            'high',
            'pending',
            this.userId,
            this.userId,
          ],
        );

        const newSuggestionId = Number(insertResult.insertId);
        created++;
        suggestionIds.push(newSuggestionId);

        // 更新 material_requirements.suggestion_id
        await manager.query(
          `UPDATE material_requirements
           SET suggestion_id = ?, updated_at = NOW()
           WHERE id = ? AND tenant_id = ?`,
          [newSuggestionId, req.id, this.tenantId],
        );
      }

      return { created, updated, skipped, suggestionIds };
    };

    if (outerManager) {
      return run(outerManager);
    }
    return AppDataSource.transaction(run);
  }

  /**
   * 入库后重新评估缺料状态
   * - 查询所有涉及该 SKU 的 pending/scheduled 工单的 material_requirements
   * - 重新计算缺口
   * - 更新 material_requirements 和 production_orders.material_status
   * - 返回受影响的工单列表
   */
  async reevaluateAfterReceipt(skuId: number, outerManager?: EntityManager): Promise<ReevaluateResult> {
    const run = async (manager: EntityManager): Promise<ReevaluateResult> => {
      // 查询所有涉及该 SKU 且工单状态为 pending/scheduled 的 production_order_id
      const affectedOrders = await manager.query<Array<{ production_order_id: number }>>(
        `SELECT DISTINCT mr.production_order_id
         FROM material_requirements mr
         INNER JOIN production_orders po ON po.id = mr.production_order_id AND po.tenant_id = mr.tenant_id
         WHERE mr.sku_id = ? AND mr.tenant_id = ?
           AND po.status IN ('pending', 'scheduled', 'in_progress')`,
        [skuId, this.tenantId],
      );

      if (affectedOrders.length === 0) {
        return { affectedOrderIds: [], updatedRequirements: 0 };
      }

      const affectedOrderIds: number[] = [];
      let updatedRequirements = 0;

      for (const { production_order_id } of affectedOrders) {
        const { shortageItems } = await this.detectShortage(production_order_id, manager);
        affectedOrderIds.push(production_order_id);
        updatedRequirements += shortageItems.length;
      }

      return { affectedOrderIds, updatedRequirements };
    };

    if (outerManager) {
      return run(outerManager);
    }
    return AppDataSource.transaction(run);
  }

  /**
   * 供应链状态看板数据
   * - 待入库物料数
   * - 当前有缺料的工单数
   * - 本周已完成入库批次数
   * - 本周采购建议待审批数
   */
  async getSupplyChainDashboard(): Promise<SupplyChainDashboard> {
    const [
      pendingReceiptResult,
      shortageOrderResult,
      weeklyReceiptResult,
      weeklyPendingResult,
    ] = await Promise.all([
      // 待入库物料数（采购订单状态为 confirmed 或 partial_received）
      AppDataSource.query<Array<{ cnt: number }>>(
        `SELECT COUNT(*) AS cnt
         FROM purchase_orders
         WHERE tenant_id = ? AND status IN ('confirmed', 'partial_received')`,
        [this.tenantId],
      ),

      // 当前有缺料的工单数
      AppDataSource.query<Array<{ cnt: number }>>(
        `SELECT COUNT(DISTINCT po.id) AS cnt
         FROM production_orders po
         INNER JOIN material_requirements mr ON mr.production_order_id = po.id AND mr.tenant_id = po.tenant_id
         WHERE po.tenant_id = ?
           AND po.status IN ('pending', 'scheduled', 'in_progress')
           AND po.material_status IN ('shortage', 'partial')`,
        [this.tenantId],
      ),

      // 本周已完成入库批次数（以 delivery_notes 表或 receipts 表为准）
      AppDataSource.query<Array<{ cnt: number }>>(
        `SELECT COUNT(*) AS cnt
         FROM purchase_orders
         WHERE tenant_id = ?
           AND status = 'received'
           AND updated_at >= DATE_SUB(NOW(), INTERVAL WEEKDAY(NOW()) DAY)`,
        [this.tenantId],
      ),

      // 本周采购建议待审批数
      AppDataSource.query<Array<{ cnt: number }>>(
        `SELECT COUNT(*) AS cnt
         FROM purchase_suggestions
         WHERE tenant_id = ? AND status = 'pending'
           AND created_at >= DATE_SUB(NOW(), INTERVAL WEEKDAY(NOW()) DAY)`,
        [this.tenantId],
      ),
    ]);

    return {
      pendingReceiptPOCount: Number(pendingReceiptResult[0]?.cnt ?? 0),
      shortageOrderCount: Number(shortageOrderResult[0]?.cnt ?? 0),
      weeklyReceivedBatchCount: Number(weeklyReceiptResult[0]?.cnt ?? 0),
      weeklyPendingSuggestionCount: Number(weeklyPendingResult[0]?.cnt ?? 0),
    };
  }
}
