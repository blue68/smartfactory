/**
 * BE-S4-12: 排产建议规则引擎（ProductionSuggestionEngine）
 *
 * 三维评分算法：
 *   维度 A: 交期紧迫度 (0-50分) — 余裕工时越少分越高
 *   维度 B: 订单优先级 (0-30分) — 根据销售订单 priority 映射
 *   维度 C: 物料就绪度 (0-20分) — 已齐料率 × 20
 *
 * 约束：
 *   - 纯计算模块，禁止调用 ProductionService.generateSchedule() 或确认接口
 *   - 所有 SQL 使用参数化查询
 *   - 所有数值运算使用 Decimal.js
 *   - 使用 AppDataSource.query() 访问数据库
 */

import Decimal from 'decimal.js';
import { AppDataSource } from '../../config/database';
import type { CalcStep } from './purchase-suggestion.engine';

// ─── 常量 ─────────────────────────────────────────────────────────

/** 工时/天 */
const HOURS_PER_DAY = 8;

/** 交期紧迫度满分对应的余裕工时上限 */
const DEADLINE_MAX_SLACK_HOURS = 80;

/** 优先级映射表（销售订单 priority 数值区间 → 维度 B 得分） */
const PRIORITY_SCORE_MAP: Record<string, number> = {
  urgent: 30,
  high: 22,
  normal: 15,
  low: 8,
};

/** 工人利用率阈值，超过此值不推荐 */
const WORKER_OVERLOAD_THRESHOLD = 0.8;

/** 每个工单最多推荐工人数 */
const MAX_RECOMMENDED_WORKERS = 3;

/** 本周标准工时（5天 × 8小时） */
const WEEKLY_CAPACITY_HOURS = 40;

// ─── 结果类型 ──────────────────────────────────────────────────────

export interface ProductionSuggestionResult {
  productionOrderId: number;
  workOrderNo: string;
  productName: string;
  salesOrderNo: string | null;
  expectedDelivery: string | null;
  qtyPlanned: string;
  deadlineScore: string;
  priorityScore: string;
  materialScore: string;
  totalScore: string;
  suggestedRank: number;
  suggestedWorkers: WorkerRecommendation[];
  calcSteps: CalcStep[];
}

export interface WorkerRecommendation {
  workerId: number;
  workerName: string;
  currentLoad: string; // 本周已分配工时
  utilization: string; // 利用率百分比
}

// ─── 内部中间类型 ──────────────────────────────────────────────────

interface OrderRow {
  id: number;
  work_order_no: string;
  sku_id: number;
  sku_name: string;
  qty_planned: string;
  planned_end: string | null;
  sales_order_id: number | null;
  order_no: string | null;
  order_type: string | null;
  priority: number | null;
  expected_delivery: string | null;
}

interface BomRequirement {
  production_order_id: number;
  total_materials: number;
  materials_in_stock: number;
}

interface WorkerLoad {
  worker_id: number;
  real_name: string;
  weekly_hours: string;
}

// ─── Engine ───────────────────────────────────────────────────────

export class ProductionSuggestionEngine {
  /**
   * 对所有待排产工单执行三维评分，返回排序后的建议列表
   *
   * 只处理 status IN ('pending', 'confirmed', 'scheduled') 的工单
   */
  async calculate(tenantId: number): Promise<ProductionSuggestionResult[]> {
    // 1. 查询待排产工单（含关联销售订单）
    const orders: OrderRow[] = await AppDataSource.query(
      `SELECT po.id, po.work_order_no, po.sku_id, po.qty_planned,
              po.planned_end, po.sales_order_id,
              s.sku_name,
              so.order_no, so.order_type, so.priority, so.expected_delivery
       FROM production_orders po
       LEFT JOIN skus s ON s.id = po.sku_id AND s.tenant_id = po.tenant_id
       LEFT JOIN sales_orders so ON so.id = po.sales_order_id AND so.tenant_id = po.tenant_id
       WHERE po.tenant_id = ? AND po.status IN ('pending', 'confirmed', 'scheduled')
       ORDER BY po.id ASC`,
      [tenantId],
    );

    if (orders.length === 0) {
      return [];
    }

    const orderIds = orders.map((o) => o.id);

    // 2. 批量查询物料就绪度
    const materialReadiness = await this.batchQueryMaterialReadiness(tenantId, orderIds);

    // 3. 查询可用工人及本周工时
    const workerLoads = await this.queryWorkerLoads(tenantId);

    // 4. 逐工单计算三维得分
    const now = new Date();
    const results: ProductionSuggestionResult[] = [];

    for (const order of orders) {
      const deadlineResult = this.calcDeadlineScore(order, now);
      const priorityResult = this.calcPriorityScore(order);
      const materialResult = this.calcMaterialScore(order.id, materialReadiness);

      const totalScore = new Decimal(deadlineResult.score)
        .plus(priorityResult.score)
        .plus(materialResult.score);

      // 推荐工人（利用率 < 80%）
      const recommendedWorkers = this.recommendWorkers(workerLoads);

      results.push({
        productionOrderId: order.id,
        workOrderNo: order.work_order_no,
        productName: order.sku_name || `SKU#${order.sku_id}`,
        salesOrderNo: order.order_no ?? null,
        expectedDelivery: order.expected_delivery ?? order.planned_end ?? null,
        qtyPlanned: order.qty_planned,
        deadlineScore: deadlineResult.score.toFixed(2),
        priorityScore: priorityResult.score.toFixed(2),
        materialScore: materialResult.score.toFixed(2),
        totalScore: totalScore.toFixed(2),
        suggestedRank: 0, // 排序后填充
        suggestedWorkers: recommendedWorkers,
        calcSteps: [
          deadlineResult.step,
          priorityResult.step,
          materialResult.step,
        ],
      });
    }

    // 5. 按总分降序排名
    results.sort((a, b) => Number(b.totalScore) - Number(a.totalScore));
    results.forEach((r, idx) => {
      r.suggestedRank = idx + 1;
    });

    return results;
  }

  // ── 维度 A: 交期紧迫度 ─────────────────────────────────────────

  private calcDeadlineScore(
    order: OrderRow,
    now: Date,
  ): { score: Decimal; step: CalcStep } {
    // 取交期：优先销售订单 expected_delivery，其次工单 planned_end
    const deadlineStr = order.expected_delivery ?? order.planned_end;

    let slackHours: number;
    let deadlineLabel: string;

    if (!deadlineStr) {
      // 无交期，视为不紧急
      slackHours = DEADLINE_MAX_SLACK_HOURS;
      deadlineLabel = '未设置交期';
    } else {
      const deadline = new Date(deadlineStr);
      const diffMs = deadline.getTime() - now.getTime();
      slackHours = diffMs / (1000 * 60 * 60); // 转换为小时
      deadlineLabel = deadlineStr;
    }

    // 公式: MAX(0, 50 - (余裕工时 / 80 × 50))
    // 余裕 ≤ 0 → 50分（最紧急）
    // 余裕 ≥ 80 → 0分
    let score: Decimal;
    if (slackHours <= 0) {
      score = new Decimal(50);
    } else if (slackHours >= DEADLINE_MAX_SLACK_HOURS) {
      score = new Decimal(0);
    } else {
      score = new Decimal(50).minus(
        new Decimal(slackHours).div(DEADLINE_MAX_SLACK_HOURS).times(50),
      );
    }

    const slackDays = new Decimal(slackHours).div(HOURS_PER_DAY).toFixed(1);

    const step: CalcStep = {
      stepNo: 1,
      title: '交期紧迫度评分',
      description: '根据交期与当前时间的余裕工时计算紧迫度。余裕越少，得分越高（最高50分）。',
      inputs: [
        { label: '交期', value: deadlineLabel },
        { label: '余裕工时', value: Number(slackHours.toFixed(1)), unit: '小时' },
        { label: '余裕天数', value: Number(slackDays), unit: '天' },
      ],
      formula: 'MAX(0, 50 - (余裕工时 / 80 × 50))',
      result: { label: '交期紧迫度得分', value: Number(score.toFixed(2)), unit: '分' },
    };

    return { score, step };
  }

  // ── 维度 B: 订单优先级 ─────────────────────────────────────────

  private calcPriorityScore(
    order: OrderRow,
  ): { score: Decimal; step: CalcStep } {
    let priorityLabel: string;
    let score: number;

    if (order.order_type && PRIORITY_SCORE_MAP[order.order_type]) {
      // 使用 order_type（urgent/normal 等）
      priorityLabel = order.order_type;
      score = PRIORITY_SCORE_MAP[order.order_type];
    } else if (order.priority !== null && order.priority !== undefined) {
      // 基于 priority 数值映射
      const p = order.priority;
      if (p >= 80) {
        priorityLabel = 'urgent';
        score = PRIORITY_SCORE_MAP.urgent;
      } else if (p >= 60) {
        priorityLabel = 'high';
        score = PRIORITY_SCORE_MAP.high;
      } else if (p >= 30) {
        priorityLabel = 'normal';
        score = PRIORITY_SCORE_MAP.normal;
      } else {
        priorityLabel = 'low';
        score = PRIORITY_SCORE_MAP.low;
      }
    } else {
      // 无关联销售订单，默认 normal
      priorityLabel = 'normal（默认）';
      score = PRIORITY_SCORE_MAP.normal;
    }

    const step: CalcStep = {
      stepNo: 2,
      title: '订单优先级评分',
      description: '根据关联销售订单的优先级映射得分。urgent=30, high=22, normal=15, low=8。',
      inputs: [
        { label: '销售订单号', value: order.order_no ?? '无关联' },
        { label: '优先级类型', value: priorityLabel },
        { label: '原始 priority 值', value: order.priority ?? 'N/A' },
      ],
      formula: 'PRIORITY_MAP[orderType]',
      result: { label: '订单优先级得分', value: score, unit: '分' },
    };

    return { score: new Decimal(score), step };
  }

  // ── 维度 C: 物料就绪度 ─────────────────────────────────────────

  private calcMaterialScore(
    orderId: number,
    readinessMap: Map<number, BomRequirement>,
  ): { score: Decimal; step: CalcStep } {
    const readiness = readinessMap.get(orderId);

    let totalMaterials = 0;
    let materialsInStock = 0;
    let readyRate = new Decimal(0);

    if (readiness && readiness.total_materials > 0) {
      totalMaterials = readiness.total_materials;
      materialsInStock = readiness.materials_in_stock;
      readyRate = new Decimal(materialsInStock).div(totalMaterials);
    } else if (!readiness || readiness.total_materials === 0) {
      // 无 BOM 或无物料需求，视为全齐
      readyRate = new Decimal(1);
      totalMaterials = 0;
      materialsInStock = 0;
    }

    const score = readyRate.times(20);

    const step: CalcStep = {
      stepNo: 3,
      title: '物料就绪度评分',
      description: '根据工单 BOM 所需物料的库存满足情况计算。已齐料率 × 20分。',
      inputs: [
        { label: 'BOM 物料总数', value: totalMaterials, unit: '种' },
        { label: '库存已满足', value: materialsInStock, unit: '种' },
        { label: '已齐料率', value: `${readyRate.times(100).toFixed(1)}%` },
      ],
      formula: '已齐料率 × 20',
      result: { label: '物料就绪度得分', value: Number(score.toFixed(2)), unit: '分' },
    };

    return { score, step };
  }

  // ── 批量查询物料就绪度 ─────────────────────────────────────────

  private async batchQueryMaterialReadiness(
    tenantId: number,
    orderIds: number[],
  ): Promise<Map<number, BomRequirement>> {
    if (orderIds.length === 0) return new Map();

    const placeholders = orderIds.map(() => '?').join(',');

    // 查询每个工单的 BOM 物料需求及库存满足情况
    // 通过 production_orders.bom_header_id 关联 bom_items，
    // 再与 inventory_summary（或 skus.current_stock）对比
    const rows: Array<{
      production_order_id: number;
      total_materials: number;
      materials_in_stock: number;
    }> = await AppDataSource.query(
      `SELECT
         po.id AS production_order_id,
         COUNT(DISTINCT bi.material_sku_id) AS total_materials,
         SUM(CASE
           WHEN COALESCE(inv.qty_available, 0) >= (bi.qty_per_unit * po.qty_planned)
           THEN 1 ELSE 0
         END) AS materials_in_stock
       FROM production_orders po
       INNER JOIN bom_items bi ON bi.header_id = po.bom_header_id AND bi.tenant_id = po.tenant_id
       LEFT JOIN (
         SELECT tenant_id, sku_id, SUM(qty_available) AS qty_available
         FROM inventory_summary
         WHERE tenant_id = ?
         GROUP BY tenant_id, sku_id
       ) inv ON inv.sku_id = bi.material_sku_id AND inv.tenant_id = po.tenant_id
       WHERE po.tenant_id = ? AND po.id IN (${placeholders})
       GROUP BY po.id`,
      [tenantId, tenantId, ...orderIds],
    );

    const map = new Map<number, BomRequirement>();
    for (const row of rows) {
      map.set(row.production_order_id, {
        production_order_id: row.production_order_id,
        total_materials: Number(row.total_materials),
        materials_in_stock: Number(row.materials_in_stock),
      });
    }

    return map;
  }

  // ── 查询可用工人及本周工时 ──────────────────────────────────────

  private async queryWorkerLoads(tenantId: number): Promise<WorkerLoad[]> {
    // CR-S4-009 fix: planned_qty 是生产件数不是工时
    // 使用任务数量 × 8 小时估算工作负载（每个任务约 1 个工作日）
    const weekStart = this.getWeekStart();
    const weekEnd = this.getWeekEnd();

    const rows: WorkerLoad[] = await AppDataSource.query(
      `SELECT
         u.id AS worker_id,
         u.real_name,
         COALESCE(
           COUNT(CASE WHEN pt.status IN ('pending', 'started') THEN 1 END) * 8,
           0
         ) AS weekly_hours
       FROM users u
       INNER JOIN user_roles ur ON ur.user_id = u.id AND ur.tenant_id = u.tenant_id
       INNER JOIN roles r ON r.id = ur.role_id AND r.code = 'worker'
       LEFT JOIN production_tasks pt ON pt.worker_id = u.id
         AND pt.tenant_id = u.tenant_id
         AND pt.task_date BETWEEN ? AND ?
         AND pt.status != 'cancelled'
       WHERE u.tenant_id = ? AND u.status = 'active'
       GROUP BY u.id, u.real_name
       ORDER BY weekly_hours ASC`,
      [weekStart, weekEnd, tenantId],
    );

    return rows;
  }

  // ── 工人推荐 ───────────────────────────────────────────────────

  private recommendWorkers(workerLoads: WorkerLoad[]): WorkerRecommendation[] {
    const recommendations: WorkerRecommendation[] = [];

    for (const w of workerLoads) {
      const hours = new Decimal(w.weekly_hours);
      const utilization = hours.div(WEEKLY_CAPACITY_HOURS);

      if (utilization.lessThan(WORKER_OVERLOAD_THRESHOLD)) {
        recommendations.push({
          workerId: w.worker_id,
          workerName: w.real_name || `工人#${w.worker_id}`,
          currentLoad: hours.toFixed(1),
          utilization: `${utilization.times(100).toFixed(0)}%`,
        });

        if (recommendations.length >= MAX_RECOMMENDED_WORKERS) {
          break;
        }
      }
    }

    return recommendations;
  }

  // ── 工具方法 ───────────────────────────────────────────────────

  private getWeekStart(): string {
    const now = new Date();
    const day = now.getDay();
    const diff = day === 0 ? 6 : day - 1; // Monday = 0
    const monday = new Date(now);
    monday.setDate(now.getDate() - diff);
    return monday.toISOString().slice(0, 10);
  }

  private getWeekEnd(): string {
    const now = new Date();
    const day = now.getDay();
    const diff = day === 0 ? 0 : 7 - day; // Sunday = 6
    const sunday = new Date(now);
    sunday.setDate(now.getDate() + diff);
    return sunday.toISOString().slice(0, 10);
  }
}

export const productionSuggestionEngine = new ProductionSuggestionEngine();
