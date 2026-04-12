/**
 * [artifact:AI架构] — AI 主动建议引擎
 *
 * 职责：
 *   定时扫描业务数据，识别异常/风险场景，
 *   主动生成结构化建议并写入 ai_suggestions 表，
 *   前端通过 GET /api/ai/suggestions 轮询展示。
 *
 * 扫描场景（Phase 1）：
 *   1. 安全库存预警    — 库存低于安全库存阈值
 *   2. 订单逾期风险    — 距交期 ≤ 3 天且仍在生产
 *   3. 异常成本波动    — 本月采购均价超历史30%
 *   4. 产能超负荷提醒  — 当日产能负荷 ≥ 90%
 *   5. 质量下滑预警    — 近7天良品率 < 90%
 *
 * 幂等设计：
 *   每类场景 + 相关实体（skuId / orderId）组合的建议在同一自然日内仅生成一次，
 *   通过 dedup_key = MD5(type:entityId:YYYY-MM-DD) 实现。
 *
 * 调用方式：
 *   直接调用 ProactiveService.runAllScans() 即可（由 Bull 队列或 cron 触发）。
 *   后续 Phase 2 可接入 Bull Queue 的 job 处理器。
 */

import crypto from 'crypto';
import { AppDataSource } from '../../config/database';
import { TenantContext } from '../../shared/BaseRepository';
import { getResolvedWorkCalendarDay } from '../production/work-calendar.util';

// ─── 建议级别 ─────────────────────────────────────────────────

export type SuggestionLevel = 'info' | 'warning' | 'error';

// ─── 建议类型标识 ─────────────────────────────────────────────

export type SuggestionType =
  | 'low_stock_alert'       // 安全库存预警
  | 'order_overdue_risk'    // 订单逾期风险
  | 'cost_anomaly'          // 异常成本波动
  | 'capacity_overload'     // 产能超负荷
  | 'quality_drop';         // 质量下滑预警

// ─── 待写入的建议对象 ─────────────────────────────────────────

interface SuggestionDraft {
  type: SuggestionType;
  title: string;
  summary: string;
  level: SuggestionLevel;
  relatedData: Record<string, unknown>;
  /** 用于当日幂等去重 */
  dedupKey: string;
}

// ─── 主动建议引擎 ─────────────────────────────────────────────

export class ProactiveService {
  private readonly tenantId: number;
  private readonly userId: number;

  constructor(ctx: TenantContext) {
    this.tenantId = ctx.tenantId;
    this.userId = ctx.userId;
  }

  // ── 全量扫描入口（由 Bull 队列 Job 调用） ────────────────────

  async runAllScans(): Promise<{ inserted: number; skipped: number }> {
    const today = new Date().toISOString().slice(0, 10);

    const drafts: SuggestionDraft[] = [];

    // 并发执行所有扫描，单个失败不影响整体
    const results = await Promise.allSettled([
      this.scanLowStock(),
      this.scanOrderOverdueRisk(),
      this.scanCostAnomaly(),
      this.scanCapacityOverload(),
      this.scanQualityDrop(),
    ]);

    for (const result of results) {
      if (result.status === 'fulfilled') {
        drafts.push(...result.value);
      } else {
        console.error('[ProactiveService] 扫描子任务失败:', result.reason);
      }
    }

    // 批量写入，跳过已存在的（幂等）
    let inserted = 0;
    let skipped = 0;

    for (const draft of drafts) {
      const dedupKey = this.buildDedupKey(draft.type, draft.dedupKey, today);
      const exists = await this.checkExists(dedupKey);

      if (exists) {
        skipped++;
        continue;
      }

      await this.insert(draft, dedupKey);
      inserted++;
    }

    console.log(`[ProactiveService] 租户${this.tenantId} 扫描完成，写入${inserted}条，跳过${skipped}条`);
    return { inserted, skipped };
  }

  // ── 场景1：安全库存预警 ───────────────────────────────────────

  private async scanLowStock(): Promise<SuggestionDraft[]> {
    const rows = await AppDataSource.query<Array<{
      sku_id: number; sku_code: string; name: string;
      stock_unit: string; qty_available: string; safety_stock: string;
    }>>(
      `SELECT s.id AS sku_id, s.sku_code, s.name, s.stock_unit,
              COALESCE(inv.qty_available, 0) AS qty_available,
              COALESCE(s.safety_stock, 0) AS safety_stock
       FROM skus s
       LEFT JOIN inventory_balances inv
         ON inv.sku_id = s.id AND inv.tenant_id = s.tenant_id
       WHERE s.tenant_id = ?
         AND s.status = 'active'
         AND COALESCE(inv.qty_available, 0) < COALESCE(s.safety_stock, 0) * 0.8
       ORDER BY (COALESCE(inv.qty_available, 0) / NULLIF(s.safety_stock, 0)) ASC
       LIMIT 20`,
      [this.tenantId],
    );

    return rows.map((r) => {
      const ratio = parseFloat(r.safety_stock) > 0
        ? ((parseFloat(r.qty_available) / parseFloat(r.safety_stock)) * 100).toFixed(0)
        : '0';
      const isCritical = parseFloat(ratio) < 30;

      return {
        type: 'low_stock_alert' as SuggestionType,
        title: `库存预警：${r.name} 库存仅剩 ${ratio}%`,
        summary: `${r.name}（${r.sku_code}）当前可用库存 ${r.qty_available}${r.stock_unit}，` +
          `低于安全库存 ${r.safety_stock}${r.stock_unit} 的80%，` +
          `${isCritical ? '已进入危险区，建议立即采购。' : '建议近期安排补货。'}`,
        level: isCritical ? 'error' : 'warning',
        relatedData: {
          skuId: r.sku_id,
          skuCode: r.sku_code,
          skuName: r.name,
          qtyAvailable: r.qty_available,
          safetyStock: r.safety_stock,
          unit: r.stock_unit,
          ratio: `${ratio}%`,
        },
        dedupKey: String(r.sku_id),
      } satisfies SuggestionDraft;
    });
  }

  // ── 场景2：订单逾期风险 ───────────────────────────────────────

  private async scanOrderOverdueRisk(): Promise<SuggestionDraft[]> {
    const today = new Date();
    const warnDate = new Date(today.getTime() + 3 * 24 * 3600 * 1000)
      .toISOString().slice(0, 10);

    const rows = await AppDataSource.query<Array<{
      order_id: number; order_no: string; customer_name: string;
      sku_name: string; expected_delivery: string; status: string;
      qty_planned: string | null;
    }>>(
      `SELECT so.id AS order_id, so.order_no, c.name AS customer_name,
              s.name AS sku_name, so.expected_delivery, so.status,
              po.qty_planned
       FROM sales_orders so
       INNER JOIN customers c ON c.id = so.customer_id AND c.tenant_id = so.tenant_id
       INNER JOIN sales_order_items soi ON soi.order_id = so.id AND soi.tenant_id = so.tenant_id
       INNER JOIN skus s ON s.id = soi.sku_id
       LEFT JOIN production_orders po
         ON po.sales_order_id = so.id AND po.tenant_id = so.tenant_id
          AND po.status NOT IN ('completed', 'cancelled')
       WHERE so.tenant_id = ?
         AND so.status IN ('confirmed', 'in_production')
         AND so.expected_delivery <= ?
       ORDER BY so.expected_delivery ASC
       LIMIT 15`,
      [this.tenantId, warnDate],
    );

    return rows.map((r) => {
      const deliveryDate = new Date(r.expected_delivery);
      const daysLeft = Math.ceil((deliveryDate.getTime() - today.getTime()) / (1000 * 3600 * 24));
      const isOverdue = daysLeft < 0;

      return {
        type: 'order_overdue_risk' as SuggestionType,
        title: isOverdue
          ? `订单逾期：${r.order_no} 已逾期 ${Math.abs(daysLeft)} 天`
          : `交期预警：${r.order_no} 距交期仅剩 ${daysLeft} 天`,
        summary: `客户${r.customer_name}的订单 ${r.order_no}（${r.sku_name}），` +
          `交期 ${r.expected_delivery}，当前状态：${this.translateOrderStatus(r.status)}。` +
          `${isOverdue ? '已逾期，请立即跟进处理并通知客户。' : '交期临近，请确认生产进度是否能按时完工。'}`,
        level: isOverdue ? 'error' : 'warning',
        relatedData: {
          orderId: r.order_id,
          orderNo: r.order_no,
          customerName: r.customer_name,
          skuName: r.sku_name,
          expectedDelivery: r.expected_delivery,
          daysLeft,
          isOverdue,
          status: r.status,
        },
        dedupKey: String(r.order_id),
      } satisfies SuggestionDraft;
    });
  }

  // ── 场景3：异常成本波动 ───────────────────────────────────────

  private async scanCostAnomaly(): Promise<SuggestionDraft[]> {
    // 对比本月采购均价 vs 历史3个月均价，超过30%则预警
    const rows = await AppDataSource.query<Array<{
      sku_id: number; sku_name: string; sku_code: string;
      current_avg: string; historical_avg: string;
    }>>(
      `SELECT
         s.id AS sku_id, s.name AS sku_name, s.sku_code,
         AVG(CASE WHEN po.created_at >= DATE_FORMAT(NOW(), '%Y-%m-01')
               THEN poi.unit_price END) AS current_avg,
         AVG(CASE WHEN po.created_at < DATE_FORMAT(NOW(), '%Y-%m-01')
                   AND po.created_at >= DATE_SUB(NOW(), INTERVAL 3 MONTH)
               THEN poi.unit_price END) AS historical_avg
       FROM purchase_order_items poi
       INNER JOIN purchase_orders po
         ON po.id = poi.po_id AND po.tenant_id = ?
       INNER JOIN skus s ON s.id = poi.sku_id AND s.tenant_id = ?
       WHERE po.created_at >= DATE_SUB(NOW(), INTERVAL 3 MONTH)
         AND poi.unit_price > 0
       GROUP BY s.id, s.name, s.sku_code
       HAVING current_avg IS NOT NULL
          AND historical_avg IS NOT NULL
          AND historical_avg > 0
          AND current_avg > historical_avg * 1.3
       LIMIT 10`,
      [this.tenantId, this.tenantId],
    );

    return rows.map((r) => {
      const currentAvg = parseFloat(r.current_avg);
      const histAvg = parseFloat(r.historical_avg);
      const riseRatio = ((currentAvg - histAvg) / histAvg * 100).toFixed(1);

      return {
        type: 'cost_anomaly' as SuggestionType,
        title: `成本异常：${r.sku_name} 采购价格上涨 ${riseRatio}%`,
        summary: `${r.sku_name}（${r.sku_code}）本月采购均价 ¥${currentAvg.toFixed(2)}，` +
          `较近3个月均价 ¥${histAvg.toFixed(2)} 上涨 ${riseRatio}%，` +
          `超过预警阈值（30%）。建议核查供应商报价，考虑比价或寻找替代供应商。`,
        level: 'warning',
        relatedData: {
          skuId: r.sku_id,
          skuCode: r.sku_code,
          skuName: r.sku_name,
          currentAvg: currentAvg.toFixed(2),
          historicalAvg: histAvg.toFixed(2),
          riseRatio: `${riseRatio}%`,
        },
        dedupKey: String(r.sku_id),
      } satisfies SuggestionDraft;
    });
  }

  // ── 场景4：产能超负荷提醒 ─────────────────────────────────────

  private async scanCapacityOverload(): Promise<SuggestionDraft[]> {
    const today = new Date().toISOString().slice(0, 10);

    // 统计今日已排产工时 vs 可用工时
    const [scheduledRow] = await AppDataSource.query<Array<{ total_hours: string }>>(
      `SELECT COALESCE(SUM(ps2.standard_hours * psc.planned_qty), 0) AS total_hours
       FROM production_schedules psc
       INNER JOIN process_steps ps2 ON ps2.id = psc.process_step_id
       WHERE psc.tenant_id = ? AND psc.schedule_date = ?
         AND psc.status IN ('planned', 'confirmed', 'in_progress')`,
      [this.tenantId, today],
    );

    const [workerRow] = await AppDataSource.query<Array<{ cnt: number }>>(
      `SELECT COUNT(*) AS cnt FROM users u
       INNER JOIN user_roles ur ON ur.user_id = u.id
       INNER JOIN roles r ON r.id = ur.role_id
       WHERE u.tenant_id = ? AND r.code = 'worker' AND u.status = 'active'`,
      [this.tenantId],
    );

    const workdayConfig = await getResolvedWorkCalendarDay(this.tenantId, today);
    const scheduledHours = parseFloat(scheduledRow?.total_hours ?? '0');
    const workerCount = Number(workerRow?.cnt ?? 0);
    const availableHours = workerCount * Number(workdayConfig.totalHours);

    if (availableHours === 0) return [];

    const loadRate = (scheduledHours / availableHours) * 100;

    if (loadRate < 90) return [];

    const isCritical = loadRate >= 100;

    return [{
      type: 'capacity_overload' as SuggestionType,
      title: `产能预警：今日排产负荷 ${loadRate.toFixed(0)}%${isCritical ? '（已超载）' : ''}`,
      summary: `${today} 排产工时 ${scheduledHours.toFixed(1)}h，` +
        `可用工时 ${availableHours.toFixed(1)}h（${workerCount} 名工人 × ${workdayConfig.totalHours}h），` +
        `负荷率 ${loadRate.toFixed(1)}%。` +
        `${isCritical
          ? '当前已超载，部分工单将无法按时完工，建议推迟非紧急工单或安排加班。'
          : '接近满载，谨慎接受新插单。'}`,
      level: isCritical ? 'error' : 'warning',
      relatedData: {
        date: today,
        scheduledHours: scheduledHours.toFixed(1),
        availableHours: String(availableHours),
        workerCount,
        loadRate: `${loadRate.toFixed(1)}%`,
        isCritical,
      },
      dedupKey: today,  // 产能预警以日期为唯一键
    } satisfies SuggestionDraft];
  }

  // ── 场景5：质量下滑预警 ───────────────────────────────────────

  private async scanQualityDrop(): Promise<SuggestionDraft[]> {
    // 查询近7天各SKU良品率 < 90% 的情况
    const rows = await AppDataSource.query<Array<{
      sku_id: number; sku_name: string;
      total: number; defect: number;
    }>>(
      `SELECT po.sku_id, s.name AS sku_name,
              COUNT(*) AS total,
              SUM(CASE WHEN qi.result IN ('fail', 'rework') THEN 1 ELSE 0 END) AS defect
       FROM quality_inspections qi
       INNER JOIN production_orders po ON po.id = qi.production_order_id AND po.tenant_id = ?
       INNER JOIN skus s ON s.id = po.sku_id AND s.tenant_id = ?
       WHERE qi.tenant_id = ?
         AND qi.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
       GROUP BY po.sku_id, s.name
       HAVING total >= 5
          AND (total - defect) / total < 0.9
       ORDER BY (defect / total) DESC
       LIMIT 10`,
      [this.tenantId, this.tenantId, this.tenantId],
    );

    return rows.map((r) => {
      const total = Number(r.total);
      const defect = Number(r.defect);
      const passRate = ((1 - defect / total) * 100).toFixed(1);
      const isCritical = defect / total > 0.2;  // 不良率 > 20% 为严重

      return {
        type: 'quality_drop' as SuggestionType,
        title: `质量预警：${r.sku_name} 近7天良品率 ${passRate}%`,
        summary: `${r.sku_name} 近7天检验 ${total} 件，` +
          `不良品 ${defect} 件，良品率 ${passRate}%，` +
          `低于合格基准（90%）。` +
          `${isCritical
            ? '不良率严重偏高，建议暂停生产，排查工艺或材料问题。'
            : '建议组织质量分析会议，找出不良原因并制定改善措施。'}`,
        level: isCritical ? 'error' : 'warning',
        relatedData: {
          skuId: r.sku_id,
          skuName: r.sku_name,
          totalInspected: total,
          defectCount: defect,
          passRate: `${passRate}%`,
          period: '近7天',
          isCritical,
        },
        dedupKey: String(r.sku_id),
      } satisfies SuggestionDraft;
    });
  }

  // ── 写入数据库 ────────────────────────────────────────────────

  private async insert(draft: SuggestionDraft, dedupKey: string): Promise<void> {
    await AppDataSource.query(
      `INSERT INTO ai_suggestions
         (tenant_id, type, title, summary, level, status,
          related_data, dedup_key, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'unread', ?, ?, ?, NOW(), NOW())`,
      [
        this.tenantId,
        draft.type,
        draft.title,
        draft.summary,
        draft.level,
        JSON.stringify(draft.relatedData),
        dedupKey,
        this.userId,
      ],
    );
  }

  // ── 幂等检查 ──────────────────────────────────────────────────

  private async checkExists(dedupKey: string): Promise<boolean> {
    const [row] = await AppDataSource.query<Array<{ cnt: number }>>(
      `SELECT COUNT(*) AS cnt FROM ai_suggestions
       WHERE tenant_id = ? AND dedup_key = ?
         AND created_at >= CURDATE()`,
      [this.tenantId, dedupKey],
    );
    return Number(row?.cnt ?? 0) > 0;
  }

  // ── 构建去重 Key（SHA256 前16位） ─────────────────────────────

  private buildDedupKey(type: SuggestionType, entityKey: string, date: string): string {
    const raw = `${type}:${entityKey}:${date}`;
    return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);
  }

  // ── 订单状态翻译 ──────────────────────────────────────────────

  private translateOrderStatus(status: string): string {
    const map: Record<string, string> = {
      draft: '草稿', confirmed: '已确认',
      in_production: '生产中', completed: '已完工',
      shipped: '已发货', cancelled: '已取消',
    };
    return map[status] ?? status;
  }
}

// ─── 静态工具：供 Bull Job / cron 调用的扫描入口 ─────────────

export async function runProactiveScan(tenantId: number, userId = 1): Promise<void> {
  const svc = new ProactiveService({ tenantId, userId });
  await svc.runAllScans();
}
