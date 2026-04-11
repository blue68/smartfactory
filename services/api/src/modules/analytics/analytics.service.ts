import { AppDataSource } from '../../config/database';
import { TenantContext } from '../../shared/BaseRepository';

/**
 * AnalyticsService — 分析报表数据查询
 *
 * IMP-004: 统一使用 TenantContext 接口，与其他模块保持一致。
 * 所有 SQL 均使用参数化查询（?），防止 SQL 注入。
 */
export class AnalyticsService {
  private readonly tenantId: number;
  private readonly userId: number;

  constructor(ctx: TenantContext) {
    this.tenantId = ctx.tenantId;
    this.userId = ctx.userId;
  }

  // ─── BE-P2-001: 老板驾驶舱 KPI ──────────────────────────────

  /**
   * 返回当月营收、库存价值、在制订单数、待审批订单数、
   * 低于安全库存 SKU 数、当日产能负荷率
   */
  async getDashboardKpi(): Promise<{
    monthlyRevenue: string;
    inventoryValue: string;
    inProgressOrders: number;
    pendingApproval: number;
    belowSafetyCount: number;
    capacityLoadRate: string;
  }> {
    // 当月已成交销售额（排除已取消订单）
    const [rev] = await AppDataSource.query(
      `SELECT COALESCE(SUM(total_amount), 0) AS val
       FROM sales_orders
       WHERE tenant_id = ?
         AND status NOT IN ('cancelled')
         AND MONTH(created_at) = MONTH(NOW())
         AND YEAR(created_at) = YEAR(NOW())`,
      [this.tenantId],
    );

    // 库存现值：在库数量 × 最新入库价
    const [inv] = await AppDataSource.query(
      `SELECT COALESCE(SUM(i.qty_on_hand * COALESCE(sp.price, 0)), 0) AS val
       FROM inventory i
       LEFT JOIN supplier_prices sp
         ON sp.sku_id = i.sku_id
        AND sp.tenant_id = i.tenant_id
        AND sp.is_current = 1
       WHERE i.tenant_id = ?`,
      [this.tenantId],
    );

    // 在制生产工单数（已排程 + 进行中）
    const [prod] = await AppDataSource.query(
      `SELECT COUNT(*) AS val
       FROM production_orders
       WHERE tenant_id = ? AND status IN ('scheduled', 'in_progress')`,
      [this.tenantId],
    );

    // 待审批销售订单数
    const [pend] = await AppDataSource.query(
      `SELECT COUNT(*) AS val
       FROM sales_orders
       WHERE tenant_id = ? AND status = 'pending_approval'`,
      [this.tenantId],
    );

    // 低于安全库存的 SKU 数（可用库存 = qty_on_hand - qty_reserved）
    const [safety] = await AppDataSource.query(
      `SELECT COUNT(*) AS val
       FROM inventory i
       INNER JOIN skus s ON s.id = i.sku_id AND s.tenant_id = i.tenant_id
       WHERE i.tenant_id = ?
         AND (i.qty_on_hand - i.qty_reserved) < COALESCE(s.safety_stock, 0)`,
      [this.tenantId],
    );

    // 当日产能负荷率：当日活跃工单计划量 / 工作站日产能均值
    const [cap] = await AppDataSource.query(
      `SELECT COALESCE(
         AVG(CASE WHEN po.status IN ('scheduled', 'in_progress') THEN po.qty_planned ELSE 0 END)
         / NULLIF(AVG(w.capacity), 0) * 100,
         0
       ) AS rate
       FROM production_orders po
       CROSS JOIN workstations w
       WHERE po.tenant_id = ?
         AND w.tenant_id = ?
         AND po.planned_start <= CURDATE()
         AND po.planned_end >= CURDATE()`,
      [this.tenantId, this.tenantId],
    );

    return {
      monthlyRevenue:    Number(rev.val).toFixed(2),
      inventoryValue:    Number(inv.val).toFixed(2),
      inProgressOrders:  Number(prod.val),
      pendingApproval:   Number(pend.val),
      belowSafetyCount:  Number(safety.val),
      capacityLoadRate:  `${Number(cap.rate).toFixed(1)}%`,
    };
  }

  // ─── BE-P2-002: 库存结构分析 ────────────────────────────────

  /**
   * 返回按一级分类汇总的库存结构（各类占比）
   * 以及近 30 天每日库存净变动趋势
   */
  async getInventoryAnalysis(): Promise<{
    categoryBreakdown: Array<{
      category: string;
      skuCount: number;
      totalQty: string;
      pct: string;
    }>;
    trendLast30: Array<{ date: string; totalQty: string }>;
  }> {
    // 按一级品类聚合库存数量
    const cats = await AppDataSource.query(
      `SELECT sc.name AS category,
              COUNT(DISTINCT i.sku_id) AS sku_count,
              SUM(i.qty_on_hand) AS total_qty
       FROM inventory i
       INNER JOIN skus s ON s.id = i.sku_id AND s.tenant_id = i.tenant_id
       INNER JOIN sku_categories sc ON sc.id = s.category1_id AND sc.level = 1
       WHERE i.tenant_id = ?
       GROUP BY sc.id, sc.name
       ORDER BY total_qty DESC`,
      [this.tenantId],
    );

    const grandTotal = cats.reduce((s: number, r: any) => s + Number(r.total_qty), 0) || 1;

    const categoryBreakdown = cats.map((r: any) => ({
      category:  r.category,
      skuCount:  Number(r.sku_count),
      totalQty:  Number(r.total_qty).toFixed(2),
      pct:       `${(Number(r.total_qty) / grandTotal * 100).toFixed(1)}%`,
    }));

    // 近 30 天库存净变动（入库记 +，出库记 -）
    // BUG-002 FIX: inventory_transactions 表中无 qty 列；
    // 使用 qty_stock_unit（换算后库存单位数量）代替，并改用 direction 字段（IN/OUT）
    // 判断方向，比原来的 transaction_type LIKE '%_IN' 更准确且不依赖命名约定。
    const trend = await AppDataSource.query(
      `SELECT DATE(it.created_at) AS date,
              SUM(CASE WHEN it.direction = 'IN' THEN it.qty_stock_unit ELSE -it.qty_stock_unit END) AS net
       FROM inventory_transactions it
       WHERE it.tenant_id = ?
         AND it.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
       GROUP BY DATE(it.created_at)
       ORDER BY date`,
      [this.tenantId],
    );

    return {
      categoryBreakdown,
      trendLast30: trend.map((r: any) => ({
        date:     String(r.date),
        totalQty: String(r.net),
      })),
    };
  }

  // ─── BE-P2-005: 生产效率分析 ────────────────────────────────

  /**
   * 返回整体完工率、平均生产周期，以及员工效率 Top10 排行
   */
  async getProductionEfficiency(): Promise<{
    avgCompletionRate: string;
    avgCycleTime: string;
    workerEfficiency: Array<{
      workerName: string;
      completedTasks: number;
      avgRate: string;
    }>;
  }> {
    // 已完工工单平均完工率
    const [rate] = await AppDataSource.query(
      `SELECT AVG(qty_completed / NULLIF(qty_planned, 0) * 100) AS val
       FROM production_orders
       WHERE tenant_id = ? AND status = 'completed'`,
      [this.tenantId],
    );

    // 已完工工单平均生产周期（天）
    const [cycle] = await AppDataSource.query(
      `SELECT AVG(DATEDIFF(actual_end, actual_start)) AS val
       FROM production_orders
       WHERE tenant_id = ?
         AND status = 'completed'
         AND actual_end IS NOT NULL`,
      [this.tenantId],
    );

    // 员工生产任务效率 Top10
    const workers = await AppDataSource.query(
      `SELECT u.real_name AS worker_name,
              COUNT(*) AS completed_tasks,
              AVG(pt.completed_qty / NULLIF(pt.planned_qty, 0) * 100) AS avg_rate
       FROM production_tasks pt
       INNER JOIN users u ON u.id = pt.worker_id
       WHERE pt.tenant_id = ? AND pt.status = 'completed'
       GROUP BY u.id, u.real_name
       ORDER BY avg_rate DESC
       LIMIT 10`,
      [this.tenantId],
    );

    return {
      avgCompletionRate: `${Number(rate.val ?? 0).toFixed(1)}%`,
      avgCycleTime:      `${Number(cycle.val ?? 0).toFixed(1)} 天`,
      workerEfficiency:  workers.map((r: any) => ({
        workerName:     r.worker_name,
        completedTasks: Number(r.completed_tasks),
        avgRate:        `${Number(r.avg_rate ?? 0).toFixed(1)}%`,
      })),
    };
  }

  // ─── BE-P2-003: 物料品类占比分析 ────────────────────────────

  /**
   * 按 SKU 一级品类汇总 BOM 物料成本占比。
   *
   * @param periodDays 统计周期（天），默认 90 天
   *
   * 查询逻辑：
   *   1. 取指定周期内创建的 bom_items，关联 skus → sku_categories（一级）
   *   2. 关联 supplier_prices（is_current = 1）取当前采购单价
   *   3. 按品类聚合：SKU 去重数、成本小计（qty_required × price）
   *   4. 在应用层计算各品类成本占总成本百分比
   *
   * 所有 SQL 均使用参数化查询，防止 SQL 注入。
   */
  async getMaterialCategoryRatio(periodDays: number = 90): Promise<{
    categories: Array<{
      categoryName: string;
      skuCount: number;
      totalCost: string;
      percentage: string;
    }>;
    totalMaterialCost: string;
  }> {
    const rows = await AppDataSource.query(
      `SELECT sc.name                                          AS category_name,
              COUNT(DISTINCT bi.component_sku_id)             AS sku_count,
              COALESCE(SUM(bi.quantity * COALESCE(sp.price, 0)), 0) AS total_cost
       FROM bom_items bi
       INNER JOIN skus s
         ON s.id = bi.component_sku_id
        AND s.tenant_id = bi.tenant_id
       INNER JOIN sku_categories sc
         ON sc.id = s.category1_id
        AND sc.level = 1
       LEFT JOIN supplier_prices sp
         ON sp.sku_id = bi.component_sku_id
        AND sp.tenant_id = bi.tenant_id
        AND sp.is_current = 1
       WHERE bi.tenant_id = ?
         AND bi.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
       GROUP BY sc.id, sc.name
       ORDER BY total_cost DESC`,
      [this.tenantId, periodDays],
    );

    const grandTotal = rows.reduce(
      (sum: number, r: any) => sum + Number(r.total_cost),
      0,
    );

    const categories = rows.map((r: any) => ({
      categoryName: r.category_name as string,
      skuCount:     Number(r.sku_count),
      totalCost:    Number(r.total_cost).toFixed(2),
      percentage:   grandTotal > 0
        ? `${(Number(r.total_cost) / grandTotal * 100).toFixed(1)}%`
        : '0.0%',
    }));

    return {
      categories,
      totalMaterialCost: grandTotal.toFixed(2),
    };
  }

  // ─── BE-P2-004: 采购品类分布分析 ───────────────────────────

  /**
   * 返回指定周期内采购订单按 SKU 一级品类的金额分布。
   *
   * @param periodDays 统计周期（天），默认 90，最小 1，最大 730
   *
   * 查询逻辑：
   *   1. 关联 purchase_order_items → purchase_orders（排除已取消）
   *   2. 关联 skus → sku_categories（level = 1）取一级品类名称
   *   3. 按品类聚合：去重订单数、行金额小计（qty × unit_price）
   *   4. 在应用层计算各品类金额占周期总采购额百分比
   *
   * 所有 SQL 均使用参数化查询，防止 SQL 注入。
   */
  async getPurchaseCategoryDistribution(periodDays = 90): Promise<{
    categories: Array<{
      categoryName: string;
      orderCount: number;
      totalAmount: string;
      percentage: string;
    }>;
    totalPurchaseAmount: string;
    period: { days: number; from: string; to: string };
  }> {
    // 安全边界：周期最少 1 天，最多 730 天
    const safeDays = Math.min(Math.max(Math.floor(periodDays), 1), 730);

    // 按一级品类聚合采购订单行金额与去重订单数
    const rows = await AppDataSource.query(
      `SELECT
         sc.name                                              AS category_name,
         COUNT(DISTINCT poi.po_id)                            AS order_count,
         COALESCE(SUM(poi.qty_ordered * poi.unit_price), 0)   AS total_amount
       FROM purchase_order_items poi
       INNER JOIN purchase_orders po
          ON po.id = poi.po_id
         AND po.tenant_id = poi.tenant_id
       INNER JOIN skus s
          ON s.id = poi.sku_id
         AND s.tenant_id = poi.tenant_id
       INNER JOIN sku_categories sc
          ON sc.id = s.category1_id
         AND sc.level = 1
       WHERE poi.tenant_id = ?
         AND po.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
         AND po.status NOT IN ('cancelled')
       GROUP BY sc.id, sc.name
       ORDER BY total_amount DESC`,
      [this.tenantId, safeDays],
    );

    const grandTotal = rows.reduce(
      (sum: number, r: any) => sum + Number(r.total_amount),
      0,
    );

    // 计算统计区间边界字符串（供前端展示）
    const [periodBounds] = await AppDataSource.query(
      `SELECT
         DATE_FORMAT(DATE_SUB(NOW(), INTERVAL ? DAY), '%Y-%m-%d') AS from_date,
         DATE_FORMAT(NOW(), '%Y-%m-%d')                            AS to_date`,
      [safeDays],
    );

    return {
      categories: rows.map((r: any) => ({
        categoryName: r.category_name as string,
        orderCount:   Number(r.order_count),
        totalAmount:  Number(r.total_amount).toFixed(2),
        percentage:   grandTotal > 0
          ? `${(Number(r.total_amount) / grandTotal * 100).toFixed(1)}%`
          : '0.0%',
      })),
      totalPurchaseAmount: grandTotal.toFixed(2),
      period: {
        days: safeDays,
        from: periodBounds.from_date as string,
        to:   periodBounds.to_date as string,
      },
    };
  }

  // ─── BE-P2-006: 采购成本分析 ────────────────────────────────

  /**
   * 返回近 6 个月采购金额月度趋势，以及供应商采购金额 Top10
   */
  async getPurchaseCostAnalysis(): Promise<{
    monthlyTrend: Array<{
      month: string;
      totalAmount: string;
      orderCount: number;
    }>;
    topSuppliers: Array<{
      supplierName: string;
      totalAmount: string;
      orderCount: number;
    }>;
  }> {
    // 近 6 个月月度采购汇总
    const monthly = await AppDataSource.query(
      `SELECT DATE_FORMAT(created_at, '%Y-%m') AS month,
              SUM(total_amount) AS total,
              COUNT(*) AS cnt
       FROM purchase_orders
       WHERE tenant_id = ?
         AND created_at >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
       GROUP BY month
       ORDER BY month`,
      [this.tenantId],
    );

    // 全量供应商采购金额 Top10
    const suppliers = await AppDataSource.query(
      `SELECT s.name AS supplier_name,
              SUM(po.total_amount) AS total,
              COUNT(*) AS cnt
       FROM purchase_orders po
       INNER JOIN suppliers s ON s.id = po.supplier_id
       WHERE po.tenant_id = ?
       GROUP BY s.id, s.name
       ORDER BY total DESC
       LIMIT 10`,
      [this.tenantId],
    );

    return {
      monthlyTrend: monthly.map((r: any) => ({
        month:       r.month,
        totalAmount: Number(r.total).toFixed(2),
        orderCount:  Number(r.cnt),
      })),
      topSuppliers: suppliers.map((r: any) => ({
        supplierName: r.supplier_name,
        totalAmount:  Number(r.total).toFixed(2),
        orderCount:   Number(r.cnt),
      })),
    };
  }

  // ─── 库存经营报表 ──────────────────────────────────────────────
  async getInventoryOperationReport(periodDays = 90): Promise<{
    summary: {
      totalInventoryValue: string;
      avgTurnoverDays: string;
      highRiskSkuCount: number;
      healthScore: string;
    };
    quadrantThresholds: {
      inventoryValue: string;
      turnoverDays: string;
    };
    structureHealth: {
      score: string;
      healthyAmountPct: string;
      warningAmountPct: string;
      dangerousAmountPct: string;
      highValueRiskPct: string;
    };
    riskDistribution: Array<{ riskLevel: 'high' | 'medium' | 'low' | 'healthy'; count: number; pct: string }>;
    quadrantAmountSummary: Array<{
      quadrant: 'core' | 'capital_risk' | 'stagnant_tail' | 'light_fast';
      label: string;
      inventoryValue: string;
      pct: string;
      skuCount: number;
    }>;
    categoryValueBreakdown: Array<{ categoryName: string; inventoryValue: string; pct: string; skuCount: number }>;
    categoryTurnover: Array<{ categoryName: string; turnoverDays: string; skuCount: number }>;
    quadrantBubble: Array<{
      skuId: number;
      skuCode: string;
      skuName: string;
      inventoryValue: string;
      turnoverDays: string;
      qtyOnHand: string;
      bubbleSize: number;
      quadrant: 'core' | 'capital_risk' | 'stagnant_tail' | 'light_fast';
      abcClass: 'A' | 'B' | 'C';
      riskIndex: number;
      riskLevel: 'high' | 'medium' | 'low' | 'healthy';
    }>;
    riskLeaderboard: Array<{
      skuId: number;
      skuCode: string;
      skuName: string;
      categoryName: string;
      qtyOnHand: string;
      inventoryValue: string;
      outboundPeriodQty: string;
      turnoverDays: string;
      quadrant: 'core' | 'capital_risk' | 'stagnant_tail' | 'light_fast';
      abcClass: 'A' | 'B' | 'C';
      riskIndex: number;
      riskLevel: 'high' | 'medium' | 'low' | 'healthy';
    }>;
    stagnantSkuTop50: Array<{
      skuId: number;
      skuCode: string;
      skuName: string;
      categoryName: string;
      qtyOnHand: string;
      inventoryValue: string;
      outboundPeriodQty: string;
      turnoverDays: string;
      quadrant: 'core' | 'capital_risk' | 'stagnant_tail' | 'light_fast';
      abcClass: 'A' | 'B' | 'C';
      riskIndex: number;
      riskLevel: 'high' | 'medium' | 'low' | 'healthy';
    }>;
  }> {
    const safeDays = Math.min(Math.max(Math.floor(periodDays), 7), 365);
    const skuRows = await AppDataSource.query<Array<{
      skuId: number;
      skuCode: string;
      skuName: string;
      categoryName: string;
      qtyOnHand: string;
      unitPrice: string;
      outboundPeriodQty: string;
      outbound90Qty: string;
    }>>(
      `SELECT
         s.id AS skuId,
         s.sku_code AS skuCode,
         s.name AS skuName,
         COALESCE(sc.name, '未分类') AS categoryName,
         CAST(COALESCE(inv.qtyOnHand, 0) AS CHAR) AS qtyOnHand,
         CAST(COALESCE(sp.price, 0) AS CHAR) AS unitPrice,
         CAST(COALESCE(tx.outboundPeriodQty, 0) AS CHAR) AS outboundPeriodQty,
         CAST(COALESCE(tx.outbound90Qty, 0) AS CHAR) AS outbound90Qty
       FROM skus s
       LEFT JOIN sku_categories sc
         ON sc.id = s.category1_id
        AND sc.level = 1
       LEFT JOIN (
         SELECT sku_id AS skuId, SUM(qty_on_hand) AS qtyOnHand
         FROM inventory
         WHERE tenant_id = ?
         GROUP BY sku_id
       ) inv ON inv.skuId = s.id
       LEFT JOIN supplier_prices sp
         ON sp.sku_id = s.id
        AND sp.tenant_id = s.tenant_id
        AND sp.is_current = 1
       LEFT JOIN (
         SELECT
           sku_id AS skuId,
           SUM(CASE WHEN direction = 'OUT' AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY) THEN qty_stock_unit ELSE 0 END) AS outboundPeriodQty,
           SUM(CASE WHEN direction = 'OUT' AND created_at >= DATE_SUB(NOW(), INTERVAL 90 DAY) THEN qty_stock_unit ELSE 0 END) AS outbound90Qty
         FROM inventory_transactions
         WHERE tenant_id = ?
         GROUP BY sku_id
       ) tx ON tx.skuId = s.id
       WHERE s.tenant_id = ?
         AND s.status <> 'inactive'
         AND COALESCE(inv.qtyOnHand, 0) > 0`,
      [this.tenantId, safeDays, this.tenantId, this.tenantId],
    );

    type RiskLevel = 'high' | 'medium' | 'low' | 'healthy';
    type Quadrant = 'core' | 'capital_risk' | 'stagnant_tail' | 'light_fast';
    type AbcClass = 'A' | 'B' | 'C';
    const quadrantLabelMap: Record<Quadrant, string> = {
      core: '核心动销',
      capital_risk: '资金占压',
      stagnant_tail: '长尾呆滞',
      light_fast: '轻量快动',
    };

    const percentile50 = (values: number[]): number => {
      if (values.length === 0) return 0;
      const sorted = [...values].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      if (sorted.length % 2 === 0) {
        return (sorted[mid - 1] + sorted[mid]) / 2;
      }
      return sorted[mid];
    };

    const baseRows = skuRows.map((row) => {
      const qtyOnHand = Number(row.qtyOnHand ?? 0);
      const unitPrice = Number(row.unitPrice ?? 0);
      const outboundPeriod = Number(row.outboundPeriodQty ?? 0);
      const outbound90 = Number(row.outbound90Qty ?? 0);
      const dailyOutbound = outboundPeriod > 0 ? outboundPeriod / safeDays : 0;
      const turnoverDays = dailyOutbound > 0 ? qtyOnHand / dailyOutbound : 999;
      const inventoryValue = qtyOnHand * unitPrice;
      return {
        ...row,
        qtyOnHand,
        outboundPeriod,
        outbound90,
        turnoverDays,
        inventoryValue,
      };
    });

    const totalValue = baseRows.reduce((sum, item) => sum + item.inventoryValue, 0);
    const avgTurnoverDays = baseRows.length > 0
      ? baseRows.reduce((sum, item) => sum + Math.min(item.turnoverDays, 365), 0) / baseRows.length
      : 0;
    const inventoryValueThreshold = percentile50(baseRows.map((item) => item.inventoryValue));
    const turnoverDaysThreshold = percentile50(baseRows.map((item) => Math.min(item.turnoverDays, 365)));
    const maxInventoryValue = Math.max(...baseRows.map((item) => item.inventoryValue), 0);

    const valueSorted = [...baseRows].sort((a, b) => b.inventoryValue - a.inventoryValue);
    let cumulativeValue = 0;
    const abcBySkuId = new Map<number, AbcClass>();
    valueSorted.forEach((item) => {
      cumulativeValue += item.inventoryValue;
      const cumulativePct = totalValue > 0 ? cumulativeValue / totalValue : 0;
      let abcClass: AbcClass = 'C';
      if (cumulativePct <= 0.8) {
        abcClass = 'A';
      } else if (cumulativePct <= 0.95) {
        abcClass = 'B';
      }
      abcBySkuId.set(Number(item.skuId), abcClass);
    });

    const toQuadrant = (inventoryValue: number, turnoverDays: number): Quadrant => {
      const highValue = inventoryValue >= inventoryValueThreshold;
      const highTurnoverDays = turnoverDays >= turnoverDaysThreshold;
      if (highValue && highTurnoverDays) return 'capital_risk';
      if (highValue) return 'core';
      if (highTurnoverDays) return 'stagnant_tail';
      return 'light_fast';
    };

    const toRiskIndex = (input: {
      turnoverDays: number;
      inventoryValue: number;
      quadrant: Quadrant;
      abcClass: AbcClass;
    }): number => {
      const turnoverScore = Math.min(input.turnoverDays, 180) / 180 * 45;
      const valueScore = maxInventoryValue > 0 ? (input.inventoryValue / maxInventoryValue) * 20 : 0;
      const abcScore = input.abcClass === 'A' ? 20 : input.abcClass === 'B' ? 12 : 6;
      const quadrantScore = input.quadrant === 'capital_risk'
        ? 15
        : input.quadrant === 'stagnant_tail'
          ? 10
          : input.quadrant === 'core'
            ? 4
            : 0;
      return Math.min(100, Math.round(turnoverScore + valueScore + abcScore + quadrantScore));
    };

    const toRiskLevel = (riskIndex: number): RiskLevel => {
      if (riskIndex >= 80) return 'high';
      if (riskIndex >= 60) return 'medium';
      if (riskIndex >= 35) return 'low';
      return 'healthy';
    };

    const bubbleSize = (qtyOnHand: number): number => {
      const maxQty = Math.max(...baseRows.map((item) => item.qtyOnHand), 1);
      return Number((10 + (qtyOnHand / maxQty) * 26).toFixed(1));
    };

    const enriched = baseRows.map((row) => {
      const abcClass = abcBySkuId.get(Number(row.skuId)) ?? 'C';
      const quadrant = toQuadrant(row.inventoryValue, row.turnoverDays);
      const riskIndex = toRiskIndex({
        turnoverDays: row.turnoverDays,
        inventoryValue: row.inventoryValue,
        quadrant,
        abcClass,
      });
      const riskLevel = toRiskLevel(riskIndex);
      return {
        ...row,
        abcClass,
        quadrant,
        riskIndex,
        riskLevel,
        bubbleSize: bubbleSize(row.qtyOnHand),
      };
    });

    const riskCounts: Record<RiskLevel, number> = {
      high: 0,
      medium: 0,
      low: 0,
      healthy: 0,
    };
    enriched.forEach((item) => { riskCounts[item.riskLevel] += 1; });
    const totalSku = enriched.length || 1;

    const byCategory = new Map<string, { value: number; turnover: number; skuCount: number }>();
    enriched.forEach((item) => {
      const key = item.categoryName || '未分类';
      const current = byCategory.get(key) ?? { value: 0, turnover: 0, skuCount: 0 };
      current.value += item.inventoryValue;
      current.turnover += Math.min(item.turnoverDays, 365);
      current.skuCount += 1;
      byCategory.set(key, current);
    });

    const categoryValueBreakdown = Array.from(byCategory.entries())
      .map(([categoryName, data]) => ({
        categoryName,
        inventoryValue: data.value.toFixed(2),
        pct: totalValue > 0 ? `${((data.value / totalValue) * 100).toFixed(1)}%` : '0.0%',
        skuCount: data.skuCount,
      }))
      .sort((a, b) => Number(b.inventoryValue) - Number(a.inventoryValue));

    const categoryTurnover = Array.from(byCategory.entries())
      .map(([categoryName, data]) => ({
        categoryName,
        turnoverDays: (data.turnover / Math.max(data.skuCount, 1)).toFixed(1),
        skuCount: data.skuCount,
      }))
      .sort((a, b) => Number(b.turnoverDays) - Number(a.turnoverDays));

    const byQuadrant = new Map<Quadrant, { inventoryValue: number; skuCount: number }>([
      ['core', { inventoryValue: 0, skuCount: 0 }],
      ['capital_risk', { inventoryValue: 0, skuCount: 0 }],
      ['stagnant_tail', { inventoryValue: 0, skuCount: 0 }],
      ['light_fast', { inventoryValue: 0, skuCount: 0 }],
    ]);
    enriched.forEach((item) => {
      const current = byQuadrant.get(item.quadrant)!;
      current.inventoryValue += item.inventoryValue;
      current.skuCount += 1;
    });

    const quadrantAmountSummary = (Array.from(byQuadrant.entries()) as Array<[Quadrant, { inventoryValue: number; skuCount: number }]>)
      .map(([quadrant, data]) => ({
        quadrant,
        label: quadrantLabelMap[quadrant],
        inventoryValue: data.inventoryValue.toFixed(2),
        pct: totalValue > 0 ? `${((data.inventoryValue / totalValue) * 100).toFixed(1)}%` : '0.0%',
        skuCount: data.skuCount,
      }));

    const healthyAmount = (byQuadrant.get('core')?.inventoryValue ?? 0) + (byQuadrant.get('light_fast')?.inventoryValue ?? 0);
    const warningAmount = byQuadrant.get('stagnant_tail')?.inventoryValue ?? 0;
    const dangerousAmount = byQuadrant.get('capital_risk')?.inventoryValue ?? 0;
    const highValueRiskAmount = enriched
      .filter((item) => item.abcClass === 'A' && item.riskLevel !== 'healthy')
      .reduce((sum, item) => sum + item.inventoryValue, 0);
    const totalValueSafe = totalValue || 1;
    const healthScore = Math.max(
      0,
      100
      - (dangerousAmount / totalValueSafe) * 55
      - (warningAmount / totalValueSafe) * 25
      - (highValueRiskAmount / totalValueSafe) * 20,
    );

    const toBoardRow = (item: typeof enriched[number]) => ({
        skuId: Number(item.skuId),
        skuCode: item.skuCode,
        skuName: item.skuName,
        categoryName: item.categoryName || '未分类',
        qtyOnHand: item.qtyOnHand.toFixed(2),
        inventoryValue: item.inventoryValue.toFixed(2),
        outboundPeriodQty: item.outboundPeriod.toFixed(2),
        turnoverDays: Math.min(item.turnoverDays, 999).toFixed(1),
        quadrant: item.quadrant,
        abcClass: item.abcClass,
        riskIndex: item.riskIndex,
        riskLevel: item.riskLevel,
      });

    const quadrantBubble = [...enriched]
      .sort((a, b) => b.inventoryValue - a.inventoryValue || b.riskIndex - a.riskIndex)
      .slice(0, 240)
      .map((item) => ({
        skuId: Number(item.skuId),
        skuCode: item.skuCode,
        skuName: item.skuName,
        inventoryValue: item.inventoryValue.toFixed(2),
        turnoverDays: Math.min(item.turnoverDays, 999).toFixed(1),
        qtyOnHand: item.qtyOnHand.toFixed(2),
        bubbleSize: item.bubbleSize,
        quadrant: item.quadrant,
        abcClass: item.abcClass,
        riskIndex: item.riskIndex,
        riskLevel: item.riskLevel,
      }));

    const riskLeaderboard = [...enriched]
      .sort((a, b) => b.riskIndex - a.riskIndex || b.inventoryValue - a.inventoryValue)
      .slice(0, 50)
      .map(toBoardRow);

    const stagnantSkuTop50 = [...enriched]
      .sort((a, b) => b.turnoverDays - a.turnoverDays || b.inventoryValue - a.inventoryValue)
      .slice(0, 50)
      .map(toBoardRow);

    return {
      summary: {
        totalInventoryValue: totalValue.toFixed(2),
        avgTurnoverDays: avgTurnoverDays.toFixed(1),
        highRiskSkuCount: riskCounts.high,
        healthScore: healthScore.toFixed(1),
      },
      quadrantThresholds: {
        inventoryValue: inventoryValueThreshold.toFixed(2),
        turnoverDays: turnoverDaysThreshold.toFixed(1),
      },
      structureHealth: {
        score: healthScore.toFixed(1),
        healthyAmountPct: `${((healthyAmount / totalValueSafe) * 100).toFixed(1)}%`,
        warningAmountPct: `${((warningAmount / totalValueSafe) * 100).toFixed(1)}%`,
        dangerousAmountPct: `${((dangerousAmount / totalValueSafe) * 100).toFixed(1)}%`,
        highValueRiskPct: `${((highValueRiskAmount / totalValueSafe) * 100).toFixed(1)}%`,
      },
      riskDistribution: (['high', 'medium', 'low', 'healthy'] as RiskLevel[]).map((riskLevel) => ({
        riskLevel,
        count: riskCounts[riskLevel],
        pct: `${((riskCounts[riskLevel] / totalSku) * 100).toFixed(1)}%`,
      })),
      quadrantAmountSummary,
      categoryValueBreakdown,
      categoryTurnover,
      quadrantBubble,
      riskLeaderboard,
      stagnantSkuTop50,
    };
  }
}
