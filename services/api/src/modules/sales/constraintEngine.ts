import Decimal from 'decimal.js';
import { AppDataSource } from '../../config/database';
import { TenantContext } from '../../shared/BaseRepository';
import { BomService } from '../bom/bom.service';
import { InventoryService } from '../inventory/inventory.service';

// ─── 阈值配置（可从 tenant.settings 中读取，实现可配置化） ──

export interface ConstraintThresholds {
  /** 库存周转天数上限（天）超过则拦截 */
  maxInventoryTurnoverDays: number;
  /** 资金占用上限（元）超过则拦截 */
  maxCapitalOccupation: number;
  /** 资金占用预算占比上限（0-1），如 0.8 = 80% */
  maxCapitalBudgetRatio: number;
  /** 产能负荷上限（0-1），如 0.9 = 90% */
  maxCapacityLoadRatio: number;
}

const DEFAULT_THRESHOLDS: ConstraintThresholds = {
  maxInventoryTurnoverDays: 90,
  maxCapitalOccupation: 500000,
  maxCapitalBudgetRatio: 0.8,
  maxCapacityLoadRatio: 0.9,
};

// ─── 检查结果类型 ──────────────────────────────────────────────

export interface CheckResult {
  passed: boolean;
  currentValue: string;
  threshold: string;
  detail: string;
}

export interface ConstraintCheckReport {
  orderId?: number;
  overallResult: 'pass' | 'block' | 'warning';
  inventoryTurnoverCheck: CheckResult;
  capitalOccupationCheck: CheckResult;
  productionCostCheck: CheckResult;
  capacityLoadCheck: CheckResult;
  blockedReasons: string[];
  impactAnalysis: ImpactAnalysis;
}

export interface ImpactAnalysis {
  /** 受影响的订单（预计交期延后的订单） */
  affectedOrders: Array<{ orderId: number; orderNo: string; delayDays: number }>;
  /** 新增资金占用（元） */
  additionalCapital: string;
  /** 库存周转天数变化 */
  turnoverDaysChange: string;
  /** 预估新增生产成本（元） */
  additionalProductionCost: string;
}

// ─── Constraint Engine ─────────────────────────────────────────

export class ConstraintEngine {
  private readonly tenantId: number;
  private readonly bomSvc: BomService;
  private readonly invSvc: InventoryService;
  private thresholds: ConstraintThresholds = DEFAULT_THRESHOLDS;

  constructor(ctx: TenantContext) {
    this.tenantId = ctx.tenantId;
    this.bomSvc = new BomService(ctx);
    this.invSvc = new InventoryService(ctx);
  }

  /**
   * 四维约束检查（下单时调用）
   *
   * 维度1：库存周转天数 — 新订单所需物料加上现有库存后，周转天数是否超限
   * 维度2：资金占用     — 新订单采购成本 + 已占用资金是否超预算
   * 维度3：生产成本     — 按 BOM 物料成本估算是否异常
   * 维度4：产能负荷     — 当前产能利用率 + 新订单工时是否超限
   */
  async check(
    skuId: number,
    bomId: number,
    orderQty: string | number,
    expectedDelivery: string,
    isUrgent = false,
  ): Promise<ConstraintCheckReport> {
    await this.loadThresholds();

    const [
      inventoryCheck,
      capitalCheck,
      costCheck,
      capacityCheck,
      impact,
    ] = await Promise.all([
      this.checkInventoryTurnover(skuId, bomId, orderQty),
      this.checkCapitalOccupation(bomId, orderQty),
      this.checkProductionCost(bomId, orderQty),
      this.checkCapacityLoad(bomId, orderQty, expectedDelivery),
      this.calcImpactAnalysis(bomId, orderQty, expectedDelivery, isUrgent),
    ]);

    const allChecks = [inventoryCheck, capitalCheck, costCheck, capacityCheck];
    const blockedReasons = allChecks
      .filter((c) => !c.passed)
      .map((c) => c.detail);

    let overallResult: 'pass' | 'block' | 'warning' = 'pass';
    if (blockedReasons.length > 0) overallResult = 'block';
    else if (isUrgent) overallResult = 'warning'; // 紧急插单始终警告

    return {
      overallResult,
      inventoryTurnoverCheck: inventoryCheck,
      capitalOccupationCheck: capitalCheck,
      productionCostCheck: costCheck,
      capacityLoadCheck: capacityCheck,
      blockedReasons,
      impactAnalysis: impact,
    };
  }

  // ── 维度1：库存周转天数 ────────────────────────────────────

  private async checkInventoryTurnover(
    skuId: number,
    bomId: number,
    orderQty: string | number,
  ): Promise<CheckResult> {
    // 计算本订单物料总成本（采购价 × 数量）
    const materials = await this.bomSvc.calcMaterialRequirements(bomId, orderQty);

    let totalInventoryValue = new Decimal(0);
    let totalDailyUsage = new Decimal(0);

    for (const m of materials) {
      // 当前库存金额
      const [priceRow] = await AppDataSource.query<Array<{ price: string | null }>>(
        `SELECT sp.price FROM supplier_prices sp
         WHERE sp.sku_id = ? AND sp.tenant_id = ? AND sp.is_current = 1
         ORDER BY sp.price ASC LIMIT 1`,
        [m.skuId, this.tenantId],
      );
      const unitPrice = new Decimal(priceRow?.price ?? 0);
      const stock = await this.invSvc.getAvailableStock(m.skuId).catch(
        () => ({ qtyAvailable: new Decimal(0) }),
      );
      totalInventoryValue = totalInventoryValue.plus(stock.qtyAvailable.mul(unitPrice));

      // 日均用量（近30天出库量 / 30）
      const [usageRow] = await AppDataSource.query<Array<{ qty: string }>>(
        `SELECT COALESCE(SUM(qty_stock_unit) / 30, 0) AS qty
         FROM inventory_transactions
         WHERE tenant_id = ? AND sku_id = ? AND direction = 'OUT'
           AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`,
        [this.tenantId, m.skuId],
      );
      const dailyUsage = new Decimal(usageRow?.qty ?? 0);
      totalDailyUsage = totalDailyUsage.plus(dailyUsage.mul(unitPrice));
    }

    const turnoverDays = totalDailyUsage.gt(0)
      ? totalInventoryValue.div(totalDailyUsage)
      : new Decimal(0);

    const threshold = this.thresholds.maxInventoryTurnoverDays;
    const passed = turnoverDays.lte(threshold);

    return {
      passed,
      currentValue: turnoverDays.toFixed(1),
      threshold: String(threshold),
      detail: passed
        ? `库存周转天数 ${turnoverDays.toFixed(1)} 天，正常`
        : `库存周转天数 ${turnoverDays.toFixed(1)} 天，超过上限 ${threshold} 天，存在积压风险`,
    };
  }

  // ── 维度2：资金占用 ────────────────────────────────────────

  private async checkCapitalOccupation(
    bomId: number,
    orderQty: string | number,
  ): Promise<CheckResult> {
    // 本订单预计采购金额
    const materials = await this.bomSvc.calcMaterialRequirements(bomId, orderQty);
    let newOrderCost = new Decimal(0);

    for (const m of materials) {
      const [priceRow] = await AppDataSource.query<Array<{ price: string | null }>>(
        `SELECT price FROM supplier_prices
         WHERE sku_id = ? AND tenant_id = ? AND is_current = 1
         ORDER BY price ASC LIMIT 1`,
        [m.skuId, this.tenantId],
      );
      newOrderCost = newOrderCost.plus(
        new Decimal(m.totalQty).mul(new Decimal(priceRow?.price ?? 0)),
      );
    }

    // 当前在产订单已占用资金（库存金额 + 已下PO未结算金额）
    const [existingCapital] = await AppDataSource.query<Array<{ total: string }>>(
      `SELECT COALESCE(SUM(po.total_amount), 0) AS total
       FROM purchase_orders po
       WHERE po.tenant_id = ? AND po.status IN ('confirmed', 'partial_received')`,
      [this.tenantId],
    );
    const currentCapital = new Decimal(existingCapital?.total ?? 0);
    const totalCapital = currentCapital.plus(newOrderCost);

    const threshold = this.thresholds.maxCapitalOccupation;
    const passed = totalCapital.lte(threshold);

    return {
      passed,
      currentValue: totalCapital.toFixed(2),
      threshold: String(threshold),
      detail: passed
        ? `资金占用 ¥${totalCapital.toFixed(2)}，在预算范围内`
        : `资金占用 ¥${totalCapital.toFixed(2)} 超过上限 ¥${threshold}，需老板审批`,
    };
  }

  // ── 维度3：生产成本检查 ────────────────────────────────────

  private async checkProductionCost(
    bomId: number,
    orderQty: string | number,
  ): Promise<CheckResult> {
    const materials = await this.bomSvc.calcMaterialRequirements(bomId, orderQty);
    let cost = new Decimal(0);

    for (const m of materials) {
      const [priceRow] = await AppDataSource.query<Array<{ price: string | null }>>(
        `SELECT price FROM supplier_prices
         WHERE sku_id = ? AND tenant_id = ? AND is_current = 1 LIMIT 1`,
        [m.skuId, this.tenantId],
      );
      cost = cost.plus(new Decimal(m.totalQty).mul(new Decimal(priceRow?.price ?? 0)));
    }

    // 与历史均值对比（近3个月同BOM成品的平均物料成本）
    const [histRow] = await AppDataSource.query<Array<{ avg_cost: string | null }>>(
      `SELECT AVG(unit_price * qty_ordered) AS avg_cost
       FROM purchase_order_items poi
       INNER JOIN purchase_orders po ON po.id = poi.po_id
       WHERE po.tenant_id = ? AND po.created_at >= DATE_SUB(NOW(), INTERVAL 90 DAY)`,
      [this.tenantId],
    );
    const histAvg = new Decimal(histRow?.avg_cost ?? 0);

    // 若成本超历史均值 30% 发出警告（不拦截，仅提示）
    const anomalyThreshold = histAvg.mul('1.3');
    const isAnomaly = histAvg.gt(0) && cost.gt(anomalyThreshold);

    return {
      passed: true, // 成本检查仅做提示，不拦截
      currentValue: cost.toFixed(2),
      threshold: anomalyThreshold.toFixed(2),
      detail: isAnomaly
        ? `估算物料成本 ¥${cost.toFixed(2)} 超过历史均值30%（历史均值 ¥${histAvg.toFixed(2)}），请确认`
        : `估算物料成本 ¥${cost.toFixed(2)}，在正常范围`,
    };
  }

  // ── 维度4：产能负荷检查 ────────────────────────────────────

  private async checkCapacityLoad(
    bomId: number,
    orderQty: string | number,
    expectedDelivery: string,
  ): Promise<CheckResult> {
    // 计算新订单所需工时
    const [templateRow] = await AppDataSource.query<Array<{
      template_id: number; total_hours: string;
    }>>(
      `SELECT pt.id AS template_id,
              COALESCE(SUM(ps.standard_hours), 0) AS total_hours
       FROM bom_headers bh
       INNER JOIN process_templates pt ON pt.sku_id = bh.sku_id AND pt.status = 'active'
       INNER JOIN process_steps ps ON ps.template_id = pt.id
       WHERE bh.id = ? AND bh.tenant_id = ?
       GROUP BY pt.id LIMIT 1`,
      [bomId, this.tenantId],
    );
    const hoursPerUnit = new Decimal(templateRow?.total_hours ?? 0);
    const newOrderHours = hoursPerUnit.mul(new Decimal(orderQty));

    // 计算交期前已排产的工时总量
    const [scheduledRow] = await AppDataSource.query<Array<{ total: string }>>(
      `SELECT COALESCE(SUM(ps2.standard_hours * psc.planned_qty), 0) AS total
       FROM production_schedules psc
       INNER JOIN process_steps ps2 ON ps2.id = psc.process_step_id
       WHERE psc.tenant_id = ? AND psc.schedule_date <= ?
         AND psc.status IN ('planned', 'confirmed', 'in_progress')`,
      [this.tenantId, expectedDelivery],
    );
    const scheduledHours = new Decimal(scheduledRow?.total ?? 0);

    // 计算期间可用总工时（工作站数 × 8小时 × 工作日数）
    const [wsRow] = await AppDataSource.query<Array<{ cnt: number }>>(
      `SELECT COUNT(*) AS cnt FROM workstations
       WHERE tenant_id = ? AND status = 'active'`,
      [this.tenantId],
    );
    const workstationCount = Number(wsRow?.cnt ?? 1);
    // 简化：假设从今天到交期都是工作日
    const deliveryDate = new Date(expectedDelivery);
    const today = new Date();
    const workDays = Math.max(
      1,
      Math.ceil((deliveryDate.getTime() - today.getTime()) / (1000 * 3600 * 24)),
    );
    const totalAvailableHours = new Decimal(workstationCount * 8 * workDays);

    const loadRatio = totalAvailableHours.gt(0)
      ? scheduledHours.plus(newOrderHours).div(totalAvailableHours)
      : new Decimal(1);

    const threshold = this.thresholds.maxCapacityLoadRatio;
    const passed = loadRatio.lte(threshold);

    return {
      passed,
      currentValue: loadRatio.mul(100).toFixed(1) + '%',
      threshold: `${threshold * 100}%`,
      detail: passed
        ? `产能负荷 ${loadRatio.mul(100).toFixed(1)}%，在安全范围内`
        : `产能负荷 ${loadRatio.mul(100).toFixed(1)}% 超过上限 ${threshold * 100}%，当前排产已满，新订单将延期`,
    };
  }

  // ── 影响分析 ──────────────────────────────────────────────

  private async calcImpactAnalysis(
    bomId: number,
    orderQty: string | number,
    expectedDelivery: string,
    isUrgent: boolean,
  ): Promise<ImpactAnalysis> {
    const materials = await this.bomSvc.calcMaterialRequirements(bomId, orderQty);

    let additionalCapital = new Decimal(0);
    for (const m of materials) {
      const [priceRow] = await AppDataSource.query<Array<{ price: string | null }>>(
        `SELECT price FROM supplier_prices WHERE sku_id = ? AND tenant_id = ? AND is_current = 1 LIMIT 1`,
        [m.skuId, this.tenantId],
      );
      additionalCapital = additionalCapital.plus(
        new Decimal(m.totalQty).mul(new Decimal(priceRow?.price ?? 0)),
      );
    }

    // 插单影响分析：若为紧急插单，基于实际产能负载估算现有订单的延期天数
    const affectedOrders: ImpactAnalysis['affectedOrders'] = [];
    if (isUrgent) {
      const existingOrders = await AppDataSource.query<Array<{
        id: number; order_no: string; expected_delivery: string;
      }>>(
        `SELECT id, order_no, expected_delivery
         FROM sales_orders
         WHERE tenant_id = ? AND status IN ('confirmed', 'in_production')
           AND expected_delivery >= ? ORDER BY expected_delivery ASC LIMIT 10`,
        [this.tenantId, new Date().toISOString().slice(0, 10)],
      );

      if (existingOrders.length > 0) {
        // 计算新插单所需工时
        const [templateRow] = await AppDataSource.query<Array<{ total_hours: string }>>(
          `SELECT COALESCE(SUM(ps.standard_hours), 0) AS total_hours
           FROM bom_headers bh
           INNER JOIN process_templates pt ON pt.sku_id = bh.sku_id AND pt.status = 'active'
           INNER JOIN process_steps ps ON ps.template_id = pt.id
           WHERE bh.id = ? AND bh.tenant_id = ?
           LIMIT 1`,
          [bomId, this.tenantId],
        );
        const hoursPerUnit = new Decimal(templateRow?.total_hours ?? 0);
        const urgentOrderHours = hoursPerUnit.mul(new Decimal(orderQty));

        // 获取活跃工作站数量，用于计算日产能
        const [wsRow] = await AppDataSource.query<Array<{ cnt: number }>>(
          `SELECT COUNT(*) AS cnt FROM workstations
           WHERE tenant_id = ? AND status = 'active'`,
          [this.tenantId],
        );
        const workstationCount = Math.max(1, Number(wsRow?.cnt ?? 1));
        const dailyCapacityHours = new Decimal(workstationCount * 8);

        // 延期天数 = ceil(插单工时 / 日产能)，最少 1 天
        const delayDays = Math.max(
          1,
          Math.ceil(urgentOrderHours.div(dailyCapacityHours).toNumber()),
        );

        // 查询当前排队工单数量，排队越长延期系数越大
        const [queueRow] = await AppDataSource.query<Array<{ cnt: number }>>(
          `SELECT COUNT(*) AS cnt FROM sales_orders
           WHERE tenant_id = ? AND status IN ('confirmed', 'in_production')`,
          [this.tenantId],
        );
        const queueCount = Math.max(1, Number(queueRow?.cnt ?? 1));
        // 排队系数：队列中每 5 个订单增加 1 天延期
        const queueFactor = Math.floor(queueCount / 5);
        const estimatedDelay = delayDays + queueFactor;

        for (const o of existingOrders) {
          affectedOrders.push({ orderId: o.id, orderNo: o.order_no, delayDays: estimatedDelay });
        }
      }
    }

    return {
      affectedOrders,
      additionalCapital: additionalCapital.toFixed(2),
      turnoverDaysChange: isUrgent ? '+2~5' : '+0~2',
      additionalProductionCost: additionalCapital.mul('0.15').toFixed(2), // 假设加工成本约为物料成本15%
    };
  }

  // ── 加载租户阈值配置 ──────────────────────────────────────

  private async loadThresholds(): Promise<void> {
    const [tenant] = await AppDataSource.query<Array<{ settings: string | null }>>(
      'SELECT settings FROM tenants WHERE id = ? LIMIT 1',
      [this.tenantId],
    );
    if (tenant?.settings) {
      const cfg = JSON.parse(tenant.settings) as Partial<ConstraintThresholds>;
      this.thresholds = { ...DEFAULT_THRESHOLDS, ...cfg };
    }
  }
}
