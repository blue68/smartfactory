/**
 * BE-S4-09: 采购建议规则引擎（PurchaseSuggestionEngine）
 *
 * 四步规则引擎：
 *   Step 1: ShortageCalculation  — 净缺口计算
 *   Step 2: SafetyStockCalculation — 安全库存补充量计算
 *   Step 3: CapitalEvaluation — 资金占用评估
 *   Step 4: SupplierRecommendation — 供应商推荐
 *
 * 约束：
 *   - 纯计算模块，禁止调用 PurchaseOrderService.create() 或写入任何表
 *   - 所有 SQL 使用参数化查询
 *   - 所有数值运算使用 Decimal.js
 *   - 使用 AppDataSource.query() 访问数据库
 */

import Decimal from 'decimal.js';
import { AppDataSource } from '../../config/database';

// ─── 共享 CalcStep 类型 ────────────────────────────────────────────

export interface CalcStepInput {
  label: string;
  value: string | number;
  unit?: string;
}

export interface CalcStepResult {
  label: string;
  value: string | number;
  unit?: string;
}

export interface CalcStep {
  stepNo: number;
  title: string;
  description: string;
  inputs: CalcStepInput[];
  formula?: string;
  result: CalcStepResult;
}

// ─── 结果类型 ──────────────────────────────────────────────────────

export interface PurchaseSuggestionResult {
  skuId: number;
  skuCode: string;
  skuName: string;
  suggestedQty: string;
  purchaseUnit: string;
  currentStock: string;
  shortageQty: string;
  safetyStockQty: string;
  capitalCost: string;
  suggestedSupplierId: number | null;
  supplierName: string | null;
  supplierScore: string;
  leadTimeDays: number | null;
  lastPurchasePrice: string;
  calcSteps: CalcStep[];
}

// ─── 内部查询行类型 ────────────────────────────────────────────────

interface SkuShortageAggRow {
  sku_id: number;
  sku_code: string;
  sku_name: string;
  purchase_unit: string;
  safety_stock: string;
  total_shortage: string;
  order_demand: string;
}

interface InventoryRow {
  qty_on_hand: string;
  qty_reserved: string;
  qty_in_transit: string;
}

interface LastPurchasePriceRow {
  unit_price: string;
}

interface SupplierFreqRow {
  supplier_id: number;
  supplier_name: string;
  freq: string;
  avg_price: string;
}

interface SupplierPriceRow {
  supplier_id: number;
  supplier_name: string;
  unit_price: string;
  lead_time_days: number | null;
}

// ─── 引擎实现 ──────────────────────────────────────────────────────

export class PurchaseSuggestionEngine {
  /**
   * 执行采购建议四步规则引擎计算。
   *
   * 数据范围：所有 pending/scheduled/in_progress 工单中存在缺口的 SKU，
   * 按 sku_id 汇总，每个 SKU 生成一条建议。
   */
  async calculate(tenantId: number): Promise<PurchaseSuggestionResult[]> {
    // ── 查询所有有缺口的 SKU（跨工单汇总） ──────────────────────────
    // 同时关联 skus 表拿 safety_stock、purchase_unit 等基础信息
    const skuRows = await AppDataSource.query<SkuShortageAggRow[]>(
      `SELECT
         mr.sku_id,
         s.sku_code,
         s.name        AS sku_name,
         s.purchase_unit,
         COALESCE(s.safety_stock, 0) AS safety_stock,
         SUM(mr.qty_shortage)        AS total_shortage,
         SUM(mr.qty_required)        AS order_demand
       FROM material_requirements mr
       INNER JOIN production_orders po
         ON po.id = mr.production_order_id AND po.tenant_id = mr.tenant_id
       INNER JOIN skus s
         ON s.id = mr.sku_id AND s.tenant_id = mr.tenant_id
       WHERE mr.tenant_id = ?
         AND mr.status IN ('shortage', 'partial')
         AND mr.qty_shortage > 0
         AND po.status IN ('pending', 'scheduled', 'in_progress')
       GROUP BY mr.sku_id, s.sku_code, s.name, s.purchase_unit, s.safety_stock
       ORDER BY SUM(mr.qty_shortage) DESC`,
      [tenantId],
    );

    if (skuRows.length === 0) {
      return [];
    }

    const results: PurchaseSuggestionResult[] = [];

    for (const row of skuRows) {
      const skuId = Number(row.sku_id);
      const calcSteps: CalcStep[] = [];

      // ── Step 1: 缺口计算（ShortageCalculation） ──────────────────

      // 查询当前库存快照
      const [inv] = await AppDataSource.query<InventoryRow[]>(
        `SELECT
           COALESCE(qty_on_hand, 0)    AS qty_on_hand,
           COALESCE(qty_reserved, 0)   AS qty_reserved,
           COALESCE(qty_in_transit, 0) AS qty_in_transit
         FROM inventory
         WHERE sku_id = ? AND tenant_id = ? LIMIT 1`,
        [skuId, tenantId],
      );

      const qtyOnHand    = new Decimal(inv?.qty_on_hand    ?? 0);
      const qtyReserved  = new Decimal(inv?.qty_reserved   ?? 0);
      const qtyInTransit = new Decimal(inv?.qty_in_transit ?? 0);
      // 可用库存 = 在手 - 已预留（不得为负）
      const qtyAvailable = Decimal.max(qtyOnHand.minus(qtyReserved), new Decimal(0));

      const orderDemand  = new Decimal(row.order_demand);
      // 净需求 = 工单需求 - 可用库存 - 在途量（不得为负）
      const shortageQty  = Decimal.max(
        orderDemand.minus(qtyAvailable).minus(qtyInTransit),
        new Decimal(0),
      );

      calcSteps.push({
        stepNo: 1,
        title: '缺口计算',
        description: '计算当前工单需求与可用库存和在途采购之间的净缺口',
        inputs: [
          { label: '工单总需求',   value: orderDemand.toFixed(4),  unit: row.purchase_unit },
          { label: '当前在手库存', value: qtyOnHand.toFixed(4),    unit: row.purchase_unit },
          { label: '已预留库存',   value: qtyReserved.toFixed(4),  unit: row.purchase_unit },
          { label: '可用库存',     value: qtyAvailable.toFixed(4), unit: row.purchase_unit },
          { label: '在途采购量',   value: qtyInTransit.toFixed(4), unit: row.purchase_unit },
        ],
        formula: '净缺口 = MAX(0, 工单需求 - 可用库存 - 在途采购)',
        result: { label: '净缺口数量', value: shortageQty.toFixed(4), unit: row.purchase_unit },
      });

      // ── Step 2: 安全库存补充（SafetyStockCalculation） ───────────

      const safetyStockQty = new Decimal(row.safety_stock);
      // 安全库存补充量 = MAX(0, 安全库存 - 可用库存 + 缺口)
      const safetyStockComplement = Decimal.max(
        safetyStockQty.minus(qtyAvailable).plus(shortageQty),
        new Decimal(0),
      );
      // 建议采购量 = 缺口量 + 安全库存补充（若安全库存补充已包含缺口，则取较大值）
      // 实际上公式已经是 safetyStockComplement >= shortageQty，因此直接取 safetyStockComplement
      const suggestedQty = Decimal.max(shortageQty, safetyStockComplement);

      calcSteps.push({
        stepNo: 2,
        title: '安全库存补充',
        description: '在净缺口基础上叠加安全库存补充量，确保补货后达到安全库存水位',
        inputs: [
          { label: '安全库存设置', value: safetyStockQty.toFixed(4),        unit: row.purchase_unit },
          { label: '当前可用库存', value: qtyAvailable.toFixed(4),          unit: row.purchase_unit },
          { label: '净缺口数量',   value: shortageQty.toFixed(4),           unit: row.purchase_unit },
          { label: '安全库存补充', value: safetyStockComplement.toFixed(4), unit: row.purchase_unit },
        ],
        formula: '建议采购量 = MAX(净缺口, MAX(0, 安全库存 - 可用库存 + 缺口))',
        result: { label: '建议采购量', value: suggestedQty.toFixed(4), unit: row.purchase_unit },
      });

      // ── Step 3: 资金占用评估（CapitalEvaluation） ────────────────

      // 查询历史最近采购单价（purchase_order_items 最新一条）
      const [lastPriceRow] = await AppDataSource.query<LastPurchasePriceRow[]>(
        `SELECT poi.unit_price
         FROM purchase_order_items poi
         INNER JOIN purchase_orders po
           ON po.id = poi.po_id AND po.tenant_id = poi.tenant_id
         WHERE poi.sku_id = ? AND poi.tenant_id = ?
           AND po.status NOT IN ('draft', 'cancelled')
         ORDER BY poi.created_at DESC
         LIMIT 1`,
        [skuId, tenantId],
      );

      const lastPurchasePrice = new Decimal(lastPriceRow?.unit_price ?? 0);
      const capitalCost = suggestedQty.mul(lastPurchasePrice);

      calcSteps.push({
        stepNo: 3,
        title: '资金占用评估',
        description: '以历史最近采购单价估算本次采购的资金占用',
        inputs: [
          { label: '建议采购量',     value: suggestedQty.toFixed(4),     unit: row.purchase_unit },
          { label: '最近采购单价',   value: lastPurchasePrice.toFixed(4), unit: '元' },
        ],
        formula: '预估资金 = 建议采购量 × 最近采购单价',
        result: { label: '预估采购成本', value: capitalCost.toFixed(2), unit: '元' },
      });

      // ── Step 4: 供应商推荐（SupplierRecommendation） ─────────────

      // 查询近6个月历史采购频次和平均价格（按 supplier_id 分组）
      const freqRows = await AppDataSource.query<SupplierFreqRow[]>(
        `SELECT
           poi.supplier_id,
           sup.name       AS supplier_name,
           COUNT(poi.id)  AS freq,
           AVG(CAST(poi.unit_price AS DECIMAL(20,6))) AS avg_price
         FROM purchase_order_items poi
         INNER JOIN purchase_orders po
           ON po.id = poi.po_id AND po.tenant_id = poi.tenant_id
         INNER JOIN suppliers sup
           ON sup.id = poi.supplier_id AND sup.tenant_id = poi.tenant_id
         WHERE poi.sku_id = ?
           AND poi.tenant_id = ?
           AND po.status NOT IN ('draft', 'cancelled')
           AND po.created_at >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
         GROUP BY poi.supplier_id, sup.name
         ORDER BY freq DESC`,
        [skuId, tenantId],
      );

      // 查询当前有效供应商报价（用于交期和基准价）
      const supplierPriceRows = await AppDataSource.query<SupplierPriceRow[]>(
        `SELECT
           sp.supplier_id,
           sup.name AS supplier_name,
           sp.unit_price,
           sp.lead_time_days
         FROM supplier_prices sp
         INNER JOIN suppliers sup
           ON sup.id = sp.supplier_id AND sup.tenant_id = sp.tenant_id
         WHERE sp.sku_id = ?
           AND sp.tenant_id = ?
           AND sp.status = 'active'
           AND (sp.effective_to IS NULL OR sp.effective_to >= CURDATE())
           AND (sp.effective_from IS NULL OR sp.effective_from <= CURDATE())`,
        [skuId, tenantId],
      );

      // 构建供应商报价 Map（supplier_id -> 报价行）
      const priceMap = new Map<number, SupplierPriceRow>();
      for (const sp of supplierPriceRows) {
        priceMap.set(Number(sp.supplier_id), sp);
      }

      // 计算综合评分：频次权重60% + 价格权重40%
      // 价格评分：价格越低分越高（归一化到0-100）
      let suggestedSupplierId: number | null = null;
      let supplierName: string | null = null;
      let supplierScore = new Decimal(0);
      let leadTimeDays: number | null = null;

      if (freqRows.length > 0) {
        const maxFreq = new Decimal(freqRows[0].freq); // 已按 freq DESC 排序

        // 找出所有供应商的最低和最高均价，用于价格归一化
        const allPrices = freqRows
          .map((r) => new Decimal(r.avg_price))
          .filter((p) => p.gt(0));
        const minPrice = allPrices.length > 0 ? Decimal.min(...allPrices) : new Decimal(1);
        const maxPrice = allPrices.length > 0 ? Decimal.max(...allPrices) : new Decimal(1);
        const priceRange = maxPrice.minus(minPrice);

        let bestScore = new Decimal(-1);

        for (const freqRow of freqRows) {
          const freq        = new Decimal(freqRow.freq);
          const avgPrice    = new Decimal(freqRow.avg_price);
          const supplierId  = Number(freqRow.supplier_id);

          // 频次评分（0-100）
          const freqScore = maxFreq.gt(0)
            ? freq.div(maxFreq).mul(100)
            : new Decimal(0);

          // 价格评分（0-100，价格越低分越高）
          const priceScore = priceRange.gt(0)
            ? maxPrice.minus(avgPrice).div(priceRange).mul(100)
            : new Decimal(100);

          // 综合评分 = 频次权重60% + 价格权重40%
          const compositeScore = freqScore.mul('0.6').plus(priceScore.mul('0.4'));

          if (compositeScore.gt(bestScore)) {
            bestScore           = compositeScore;
            suggestedSupplierId = supplierId;
            supplierName        = freqRow.supplier_name;
            supplierScore       = compositeScore;
            // 从报价表取交期（若有）
            const priceInfo     = priceMap.get(supplierId);
            leadTimeDays        = priceInfo?.lead_time_days ?? null;
          }
        }
      } else if (supplierPriceRows.length > 0) {
        // 无历史采购记录时，取报价最低的供应商
        const sorted = [...supplierPriceRows].sort(
          (a, b) => new Decimal(a.unit_price).minus(new Decimal(b.unit_price)).toNumber(),
        );
        const best        = sorted[0];
        suggestedSupplierId = Number(best.supplier_id);
        supplierName        = best.supplier_name;
        leadTimeDays        = best.lead_time_days ?? null;
        supplierScore       = new Decimal(50); // 无频次数据，给基准分50
      }

      calcSteps.push({
        stepNo: 4,
        title: '供应商推荐',
        description: '综合历史采购频次（权重60%）与平均采购价格（权重40%）评分，推荐最优供应商',
        inputs: [
          { label: '历史采购供应商数量', value: freqRows.length,                       unit: '家' },
          { label: '有效报价供应商数量', value: supplierPriceRows.length,              unit: '家' },
          { label: '评分权重-采购频次',  value: '60%' },
          { label: '评分权重-采购价格',  value: '40%' },
        ],
        formula: '综合评分 = 频次得分 × 0.6 + 价格得分 × 0.4（价格越低得分越高）',
        result: {
          label: '推荐供应商',
          value: supplierName ?? '暂无推荐',
          unit: supplierScore.gt(0) ? `综合评分 ${supplierScore.toFixed(2)}` : undefined,
        },
      });

      results.push({
        skuId,
        skuCode:             row.sku_code,
        skuName:             row.sku_name,
        suggestedQty:        suggestedQty.toFixed(4),
        purchaseUnit:        row.purchase_unit,
        currentStock:        qtyAvailable.toFixed(4),
        shortageQty:         shortageQty.toFixed(4),
        safetyStockQty:      safetyStockQty.toFixed(4),
        capitalCost:         capitalCost.toFixed(2),
        suggestedSupplierId,
        supplierName,
        supplierScore:       supplierScore.toFixed(2),
        leadTimeDays,
        lastPurchasePrice:   lastPurchasePrice.toFixed(4),
        calcSteps,
      });
    }

    return results;
  }
}
