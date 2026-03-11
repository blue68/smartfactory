/**
 * [artifact:AI接口] — AI Agent 核心服务
 *
 * 完整处理链路：
 *   用户输入
 *     → 上下文增强（ContextManager）
 *     → 意图识别（IntentRecognizer）
 *     → 业务数据路由查询（各业务模块 DataSource）
 *     → 响应生成（ResponseGenerator）
 *     → SSE 流式输出
 *
 * AI 状态设计（遵循 CLAUDE.md AI Agent 特殊规范）：
 *   - 思考中：phase:thinking 帧
 *   - 流式输出：content 帧逐字输出
 *   - 超时处理：30 秒全局超时，写 error 帧后关闭
 *   - 错误恢复：catch 所有异常写 error 帧，不让 SSE 连接无响应挂起
 *   - 重试机制：业务查询最多重试 3 次（指数退避）
 *
 * Phase 1：纯规则引擎 + 直接 SQL 查询，不依赖外部 LLM。
 * Phase 2：在 queryBusinessData 中替换为 LangChain/LlamaIndex Tool 调用。
 */

import { Response } from 'express';
import { AppDataSource } from '../../config/database';
import { TenantContext } from '../../shared/BaseRepository';
import { IntentRecognizer, IntentType, RecognitionResult } from './intent.recognizer';
import { ResponseGenerator, BusinessData } from './response.generator';
import { ContextManager } from './context.manager';
import { SuggestionService } from '../purchase/suggestion.service';
import { SchedulerService } from '../production/scheduler.service';

// ─── 超时 & 重试配置 ──────────────────────────────────────────

const STREAM_TIMEOUT_MS   = 30_000;   // 30 秒全局超时
const QUERY_MAX_RETRIES   = 3;        // 业务查询最大重试次数
const QUERY_RETRY_BASE_MS = 200;      // 重试基础延迟（指数退避：200/400/800ms）

// ─── 聊天请求参数 ─────────────────────────────────────────────

export interface ChatRequest {
  message: string;
  /** 可选：前端传入会话ID（暂留，Phase 2 多会话使用） */
  sessionId?: string;
}

// ─── 建议列表查询参数 ──────────────────────────────────────────

export interface SuggestionsQueryParams {
  page: number;
  pageSize: number;
  status?: 'unread' | 'read' | 'adopted' | 'ignored';
}

// ─── 反馈参数 ─────────────────────────────────────────────────

export interface FeedbackParams {
  messageId: string;
  rating: 'helpful' | 'unhelpful';
  comment?: string;
}

// ─── AI Agent 核心服务 ────────────────────────────────────────

export class AiService {
  private readonly tenantId: number;
  private readonly userId: number;
  private readonly recognizer: IntentRecognizer;
  private readonly generator: ResponseGenerator;

  constructor(ctx: TenantContext) {
    this.tenantId = ctx.tenantId;
    this.userId = ctx.userId;
    this.recognizer = new IntentRecognizer();
    this.generator = new ResponseGenerator();
  }

  // ── 主入口：处理用户消息并以 SSE 流式响应 ─────────────────────

  async handleChat(req: ChatRequest, res: Response): Promise<void> {
    ResponseGenerator.setSseHeaders(res);

    // 超时保护：30 秒后强制结束
    const timeoutHandle = setTimeout(() => {
      ResponseGenerator.writeError(res, '响应超时，请稍后重试');
      res.end();
    }, STREAM_TIMEOUT_MS);

    try {
      const ctxManager = new ContextManager(this.tenantId, this.userId);

      // 1. 意图识别
      const rawRecognition = this.recognizer.recognize(req.message);

      // 2. 上下文增强（多轮对话实体继承）
      const recognition = await ctxManager.resolveWithContext(req.message, rawRecognition);

      // 3. 查询业务数据（带重试）
      const businessData = await this.withRetry(
        () => this.queryBusinessData(recognition, req.message),
        QUERY_MAX_RETRIES,
        QUERY_RETRY_BASE_MS,
      );

      // 4. 流式生成响应并写入 SSE
      await this.generator.streamResponse(res, recognition.intent, businessData, {
        chunkSize: 6,
        chunkDelayMs: 25,
      });

      // 5. 更新对话上下文（记录本轮，不阻塞响应）
      const preview = this.generator.generate(recognition.intent, businessData).text;
      ctxManager.appendTurn(req.message, recognition, preview, req.sessionId).catch((err: unknown) => {
        console.error('[AiService] 上下文保存失败:', err instanceof Error ? err.message : err);
      });

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '未知错误';
      console.error('[AiService] handleChat 异常:', msg);
      ResponseGenerator.writeError(res, `AI 服务暂时不可用：${msg}`);
    } finally {
      clearTimeout(timeoutHandle);
      if (!res.writableEnded) res.end();
    }
  }

  // ── 获取 AI 主动建议列表 ──────────────────────────────────────

  async getSuggestions(params: SuggestionsQueryParams): Promise<{
    list: AiSuggestion[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const conditions = ['tenant_id = ?'];
    const qParams: unknown[] = [this.tenantId];

    if (params.status) {
      conditions.push('status = ?');
      qParams.push(params.status);
    }

    const where = conditions.join(' AND ');
    const offset = (params.page - 1) * params.pageSize;

    const [list, countRows] = await Promise.all([
      AppDataSource.query<AiSuggestion[]>(
        `SELECT id, type, title, summary, level, status,
                related_data, created_at, read_at
         FROM ai_suggestions
         WHERE ${where}
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?`,
        [...qParams, params.pageSize, offset],
      ),
      AppDataSource.query<Array<{ total: number }>>(
        `SELECT COUNT(*) AS total FROM ai_suggestions WHERE ${where}`,
        qParams,
      ),
    ]);

    return {
      list,
      total: Number(countRows[0]?.total ?? 0),
      page: params.page,
      pageSize: params.pageSize,
    };
  }

  // ── 更新建议状态 ──────────────────────────────────────────────

  async updateSuggestionStatus(
    id: number,
    status: 'read' | 'adopted' | 'ignored',
  ): Promise<void> {
    const now = new Date();
    await AppDataSource.query(
      `UPDATE ai_suggestions
       SET status = ?,
           read_at = CASE WHEN status = 'unread' THEN ? ELSE read_at END,
           updated_at = ?
       WHERE id = ? AND tenant_id = ?`,
      [status, now, now, id, this.tenantId],
    );
  }

  // ── 保存用户反馈 ──────────────────────────────────────────────

  async saveFeedback(params: FeedbackParams): Promise<void> {
    await AppDataSource.query(
      `INSERT INTO ai_feedbacks
         (tenant_id, user_id, message_id, rating, comment, created_at)
       VALUES (?, ?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE
         rating = VALUES(rating),
         comment = VALUES(comment)`,
      [
        this.tenantId,
        this.userId,
        params.messageId,
        params.rating,
        params.comment ?? null,
      ],
    );
  }

  // ── 业务数据路由查询 ──────────────────────────────────────────

  /**
   * 根据意图识别结果，路由到对应的业务查询函数，
   * 返回 BusinessData（松散 Record）供 ResponseGenerator 使用。
   */
  private async queryBusinessData(recognition: RecognitionResult, userInput?: string): Promise<BusinessData> {
    const ctx: TenantContext = { tenantId: this.tenantId, userId: this.userId };

    switch (recognition.intent) {
      case 'inventory_query':
        return this.queryInventory(recognition, ctx);
      case 'purchase_suggest':
        return this.queryPurchaseSuggestions(recognition, ctx);
      case 'production_query':
        return this.queryProductionSchedule(recognition, ctx);
      case 'quality_stats':
        return this.queryQualityStats(recognition, ctx);
      case 'cost_analysis':
        return this.queryCostAnalysis(recognition, ctx);
      case 'order_status':
        return this.queryOrderStatus(recognition, ctx);
      default:
        return this.buildGeneralAnswer(recognition, userInput);
    }
  }

  // ── 库存查询 ──────────────────────────────────────────────────

  private async queryInventory(
    recognition: RecognitionResult,
    _ctx: TenantContext,
  ): Promise<BusinessData> {
    const skuEntity = recognition.entities.find((e) => e.type === 'sku_name');
    const categoryEntity = recognition.entities.find((e) => e.type === 'category');

    let rows: Array<{
      sku_name: string; sku_code: string; qty_available: string;
      stock_unit: string; safety_stock: string;
    }>;

    if (skuEntity) {
      // 精确查询指定物料
      // 从 inventory 主表实时聚合：在手量 - 预留量 = 可用量
      rows = await AppDataSource.query(
        `SELECT s.name AS sku_name, s.sku_code, s.stock_unit,
                COALESCE(
                  (SELECT SUM(i.qty_on_hand) - SUM(i.qty_reserved)
                   FROM inventory i
                   WHERE i.sku_id = s.id AND i.tenant_id = s.tenant_id),
                  0
                ) AS qty_available,
                COALESCE(s.safety_stock, 0) AS safety_stock
         FROM skus s
         WHERE s.tenant_id = ?
           AND s.name LIKE ?
         LIMIT 10`,
        [this.tenantId, `%${skuEntity.value}%`],
      );
    } else if (categoryEntity) {
      // 按分类查询低库存物料，实时聚合 inventory 主表
      rows = await AppDataSource.query(
        `SELECT s.name AS sku_name, s.sku_code, s.stock_unit,
                COALESCE(
                  (SELECT SUM(i.qty_on_hand) - SUM(i.qty_reserved)
                   FROM inventory i
                   WHERE i.sku_id = s.id AND i.tenant_id = s.tenant_id),
                  0
                ) AS qty_available,
                COALESCE(s.safety_stock, 0) AS safety_stock
         FROM skus s
         INNER JOIN sku_categories sc
           ON sc.id = s.category_id AND sc.tenant_id = s.tenant_id
         WHERE s.tenant_id = ?
           AND (sc.name LIKE ? OR s.name LIKE ?)
         ORDER BY (
           COALESCE(
             (SELECT SUM(i.qty_on_hand) - SUM(i.qty_reserved)
              FROM inventory i
              WHERE i.sku_id = s.id AND i.tenant_id = s.tenant_id),
             0
           ) / NULLIF(s.safety_stock, 0)
         ) ASC
         LIMIT 20`,
        [this.tenantId, `%${categoryEntity.value}%`, `%${categoryEntity.value}%`],
      );
    } else {
      // 查询所有低于安全库存的物料，实时聚合 inventory 主表
      rows = await AppDataSource.query(
        `SELECT s.name AS sku_name, s.sku_code, s.stock_unit,
                COALESCE(
                  (SELECT SUM(i.qty_on_hand) - SUM(i.qty_reserved)
                   FROM inventory i
                   WHERE i.sku_id = s.id AND i.tenant_id = s.tenant_id),
                  0
                ) AS qty_available,
                COALESCE(s.safety_stock, 0) AS safety_stock
         FROM skus s
         WHERE s.tenant_id = ?
           AND COALESCE(
                 (SELECT SUM(i.qty_on_hand) - SUM(i.qty_reserved)
                  FROM inventory i
                  WHERE i.sku_id = s.id AND i.tenant_id = s.tenant_id),
                 0
               ) < COALESCE(s.safety_stock, 0)
         ORDER BY (
           COALESCE(
             (SELECT SUM(i.qty_on_hand) - SUM(i.qty_reserved)
              FROM inventory i
              WHERE i.sku_id = s.id AND i.tenant_id = s.tenant_id),
             0
           ) / NULLIF(s.safety_stock, 0)
         ) ASC
         LIMIT 20`,
        [this.tenantId],
      );
    }

    const items = rows.map((r) => ({
      skuName: r.sku_name,
      skuCode: r.sku_code,
      qtyAvailable: r.qty_available,
      unit: r.stock_unit,
      safetyStock: r.safety_stock,
      isBelowSafety: parseFloat(r.qty_available) < parseFloat(r.safety_stock),
    }));

    return {
      items,
      queryName: skuEntity?.value ?? categoryEntity?.value ?? '',
      lowStockCount: items.filter((i) => i.isBelowSafety).length,
    };
  }

  // ── 采购建议查询 ──────────────────────────────────────────────

  private async queryPurchaseSuggestions(
    _recognition: RecognitionResult,
    ctx: TenantContext,
  ): Promise<BusinessData> {
    // 先查现有未处理建议
    const existing = await AppDataSource.query<Array<{
      sku_name: string; suggested_qty: string; purchase_unit: string;
      supplier_name: string | null; estimated_amount: string | null;
      confidence: string; reason: string;
    }>>(
      `SELECT s.name AS sku_name, ps.suggested_qty, ps.purchase_unit,
              sup.name AS supplier_name, ps.estimated_amount,
              ps.confidence, ps.reason
       FROM purchase_suggestions ps
       INNER JOIN skus s ON s.id = ps.sku_id
       LEFT JOIN suppliers sup ON sup.id = ps.suggested_supplier_id
       WHERE ps.tenant_id = ? AND ps.status = 'pending'
         AND ps.expired_at > NOW()
       ORDER BY FIELD(ps.confidence, 'high', 'medium', 'low'), ps.id DESC
       LIMIT 20`,
      [this.tenantId],
    );

    // 若有有效建议直接返回，否则触发实时生成
    if (existing.length > 0) {
      return {
        suggestions: existing.map((r) => ({
          skuName: r.sku_name,
          suggestedQty: r.suggested_qty,
          purchaseUnit: r.purchase_unit,
          supplierName: r.supplier_name,
          estimatedAmount: r.estimated_amount,
          confidence: r.confidence as 'high' | 'medium' | 'low',
          reason: r.reason,
        })),
        generatedAt: new Date().toLocaleString('zh-CN'),
      };
    }

    // 实时生成采购建议
    const svc = new SuggestionService(ctx);
    const fresh = await svc.generateSuggestions();

    return {
      suggestions: fresh.map((s) => ({
        skuName: s.skuName,
        suggestedQty: s.suggestedQty,
        purchaseUnit: s.purchaseUnit,
        supplierName: s.supplierName,
        estimatedAmount: s.estimatedAmount,
        confidence: s.confidence,
        reason: s.reason,
      })),
      generatedAt: new Date().toLocaleString('zh-CN'),
    };
  }

  // ── 排产查询 ──────────────────────────────────────────────────

  private async queryProductionSchedule(
    recognition: RecognitionResult,
    ctx: TenantContext,
  ): Promise<BusinessData> {
    const dateEntity = recognition.entities.find((e) => e.type === 'date');
    const orderEntity = recognition.entities.find((e) => e.type === 'order_no');

    // 若问的是特定工单进度
    if (orderEntity) {
      const rows = await AppDataSource.query(
        `SELECT po.work_order_no, s.name AS sku_name, po.qty_planned,
                po.qty_completed, po.status,
                so.order_no AS sales_order_no, so.expected_delivery
         FROM production_orders po
         INNER JOIN skus s ON s.id = po.sku_id
         INNER JOIN sales_orders so ON so.id = po.sales_order_id
         WHERE po.tenant_id = ?
           AND (po.work_order_no = ? OR so.order_no = ?)
         LIMIT 5`,
        [this.tenantId, orderEntity.value, orderEntity.value],
      );

      return { plan: this.buildSimplePlan(rows), date: orderEntity.value };
    }

    // 查询指定日期或今日排产
    const targetDate = this.parseDateEntity(dateEntity?.value);
    const svc = new SchedulerService(ctx);

    try {
      const plan = await svc.generateSchedule(targetDate);
      return { plan, date: this.formatDateLabel(dateEntity?.value) };
    } catch {
      return { plan: null, date: this.formatDateLabel(dateEntity?.value) };
    }
  }

  // ── 质量统计查询 ──────────────────────────────────────────────

  private async queryQualityStats(
    recognition: RecognitionResult,
    _ctx: TenantContext,
  ): Promise<BusinessData> {
    const skuEntity = recognition.entities.find((e) => e.type === 'sku_name');
    const dateRangeEntity = recognition.entities.find((e) => e.type === 'date_range' || e.type === 'date');

    const dayRange = this.parseDateRangeDays(dateRangeEntity?.value);

    const baseCondition = `qi.tenant_id = ? AND qi.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)`;
    const baseParams: unknown[] = [this.tenantId, dayRange];

    let skuCondition = '';
    if (skuEntity) {
      skuCondition = ` AND s.name LIKE ?`;
      baseParams.push(`%${skuEntity.value}%`);
    }

    const [statsRow] = await AppDataSource.query<Array<{
      total: number; defect: number; rework: number;
    }>>(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN qi.result = 'fail' THEN 1 ELSE 0 END) AS defect,
         SUM(CASE WHEN qi.result = 'rework' THEN 1 ELSE 0 END) AS rework
       FROM quality_inspections qi
       INNER JOIN production_orders po ON po.id = qi.production_order_id
       INNER JOIN skus s ON s.id = po.sku_id
       WHERE ${baseCondition}${skuCondition}`,
      baseParams,
    );

    const total = Number(statsRow?.total ?? 0);
    const defect = Number(statsRow?.defect ?? 0);
    const rework = Number(statsRow?.rework ?? 0);
    const passRate = total > 0 ? (((total - defect) / total) * 100).toFixed(1) : '0.0';

    // 查询主要不良类型（TOP 5）
    const defectRows = await AppDataSource.query<Array<{ issue_type: string; cnt: number }>>(
      `SELECT qi.issue_type, COUNT(*) AS cnt
       FROM quality_inspections qi
       INNER JOIN production_orders po ON po.id = qi.production_order_id
       INNER JOIN skus s ON s.id = po.sku_id
       WHERE ${baseCondition}${skuCondition}
         AND qi.result IN ('fail', 'rework')
         AND qi.issue_type IS NOT NULL
       GROUP BY qi.issue_type
       ORDER BY cnt DESC LIMIT 5`,
      baseParams,
    );

    return {
      stats: {
        passRate,
        totalInspected: total,
        defectCount: defect,
        reworkCount: rework,
        topDefects: defectRows.map((d) => d.issue_type),
      },
      skuName: skuEntity?.value ?? '',
      period: this.formatPeriodLabel(dateRangeEntity?.value, dayRange),
    };
  }

  // ── 成本分析查询 ──────────────────────────────────────────────

  private async queryCostAnalysis(
    recognition: RecognitionResult,
    _ctx: TenantContext,
  ): Promise<BusinessData> {
    const skuEntity = recognition.entities.find((e) => e.type === 'sku_name');
    const categoryEntity = recognition.entities.find((e) => e.type === 'category');

    if (!skuEntity && !categoryEntity) {
      return this.buildGeneralAnswer(recognition);
    }

    const searchName = skuEntity?.value ?? categoryEntity?.value ?? '';

    // 查询BOM物料成本明细
    const rows = await AppDataSource.query<Array<{
      material_name: string; qty: string; stock_unit: string;
      unit_price: string | null; amount: string;
      category_name: string;
    }>>(
      `SELECT
         s2.name AS material_name,
         bi.qty_per_unit AS qty,
         s2.stock_unit,
         sp.price AS unit_price,
         COALESCE(bi.qty_per_unit * sp.price, 0) AS amount,
         sc.name AS category_name
       FROM bom_headers bh
       INNER JOIN skus s ON s.id = bh.sku_id
       INNER JOIN bom_items bi ON bi.bom_header_id = bh.id AND bi.tenant_id = bh.tenant_id
       INNER JOIN skus s2 ON s2.id = bi.material_sku_id
       INNER JOIN sku_categories sc ON sc.id = s2.category_id
       LEFT JOIN supplier_prices sp
         ON sp.sku_id = bi.material_sku_id AND sp.tenant_id = bh.tenant_id AND sp.is_current = 1
       WHERE bh.tenant_id = ?
         AND s.name LIKE ?
         AND bh.is_active = 1
       ORDER BY amount DESC
       LIMIT 30`,
      [this.tenantId, `%${searchName}%`],
    );

    if (rows.length === 0) {
      return { breakdown: null, skuName: searchName };
    }

    const totalCost = rows.reduce((sum, r) => sum + parseFloat(r.amount ?? '0'), 0);

    // 按分类汇总
    const categoryMap = new Map<string, number>();
    for (const r of rows) {
      const existing = categoryMap.get(r.category_name) ?? 0;
      categoryMap.set(r.category_name, existing + parseFloat(r.amount ?? '0'));
    }
    const categories = [...categoryMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, amount]) => ({
        name,
        amount: amount.toFixed(2),
        ratio: totalCost > 0 ? ((amount / totalCost) * 100).toFixed(1) : '0',
      }));

    const items = rows.map((r) => ({
      name: r.material_name,
      qty: r.qty,
      unit: r.stock_unit,
      unitPrice: r.unit_price ?? '未知',
      amount: parseFloat(r.amount).toFixed(2),
      ratio: totalCost > 0 ? ((parseFloat(r.amount) / totalCost) * 100).toFixed(1) : '0',
    }));

    return {
      breakdown: { totalCost: totalCost.toFixed(2), categories, items },
      skuName: searchName,
    };
  }

  // ── 订单状态查询 ──────────────────────────────────────────────

  private async queryOrderStatus(
    recognition: RecognitionResult,
    _ctx: TenantContext,
  ): Promise<BusinessData> {
    const orderEntity = recognition.entities.find((e) => e.type === 'order_no');
    const today = new Date().toISOString().slice(0, 10);

    // 是否查询逾期订单
    const isOverdueQuery = recognition.matchedRules.some((r) =>
      r.includes('逾期') || r.includes('delay'),
    ) || recognition.entities.length === 0;

    let rows: Array<{
      order_no: string; customer_name: string; sku_name: string;
      qty: string; unit: string; status: string; expected_delivery: string;
    }>;

    if (orderEntity) {
      rows = await AppDataSource.query(
        `SELECT so.order_no, c.name AS customer_name, s.name AS sku_name,
                soi.qty, s.stock_unit AS unit, so.status, so.expected_delivery
         FROM sales_orders so
         INNER JOIN customers c ON c.id = so.customer_id
         INNER JOIN sales_order_items soi ON soi.order_id = so.id AND soi.tenant_id = so.tenant_id
         INNER JOIN skus s ON s.id = soi.sku_id
         WHERE so.tenant_id = ? AND so.order_no = ?
         LIMIT 5`,
        [this.tenantId, orderEntity.value],
      );
    } else if (isOverdueQuery) {
      rows = await AppDataSource.query(
        `SELECT so.order_no, c.name AS customer_name, s.name AS sku_name,
                soi.qty, s.stock_unit AS unit, so.status, so.expected_delivery
         FROM sales_orders so
         INNER JOIN customers c ON c.id = so.customer_id
         INNER JOIN sales_order_items soi ON soi.order_id = so.id AND soi.tenant_id = so.tenant_id
         INNER JOIN skus s ON s.id = soi.sku_id
         WHERE so.tenant_id = ?
           AND so.status IN ('confirmed', 'in_production')
           AND so.expected_delivery < ?
         ORDER BY so.expected_delivery ASC
         LIMIT 20`,
        [this.tenantId, today],
      );
    } else {
      rows = await AppDataSource.query(
        `SELECT so.order_no, c.name AS customer_name, s.name AS sku_name,
                soi.qty, s.stock_unit AS unit, so.status, so.expected_delivery
         FROM sales_orders so
         INNER JOIN customers c ON c.id = so.customer_id
         INNER JOIN sales_order_items soi ON soi.order_id = so.id AND soi.tenant_id = so.tenant_id
         INNER JOIN skus s ON s.id = soi.sku_id
         WHERE so.tenant_id = ?
           AND so.status IN ('confirmed', 'in_production')
         ORDER BY so.expected_delivery ASC
         LIMIT 20`,
        [this.tenantId],
      );
    }

    const orders = rows.map((r) => {
      const deliveryDate = new Date(r.expected_delivery);
      const now = new Date();
      const isOverdue = deliveryDate < now && !['completed', 'shipped', 'cancelled'].includes(r.status);
      const overdueDays = isOverdue
        ? Math.ceil((now.getTime() - deliveryDate.getTime()) / (1000 * 3600 * 24))
        : 0;
      return {
        orderNo: r.order_no,
        customerName: r.customer_name,
        skuName: r.sku_name,
        qty: r.qty,
        unit: r.unit,
        status: r.status,
        expectedDelivery: r.expected_delivery,
        isOverdue,
        overdueDays,
      };
    });

    return {
      orders,
      orderNo: orderEntity?.value ?? '',
      overdueCount: orders.filter((o) => o.isOverdue).length,
    };
  }

  // ── 通用问答兜底 ──────────────────────────────────────────────

  private buildGeneralAnswer(recognition: RecognitionResult, userInput?: string): BusinessData {
    const guideItems: string[] = [
      '查询库存："XX材料还有多少？" 或 "哪些物料快没了？"',
      '采购建议："给我出个采购计划" 或 "需要采购什么？"',
      '生产排产："今天的排产情况" 或 "WO001234工单进度怎样？"',
      '质量统计："最近的良品率" 或 "沙发的质量问题"',
      '成本分析："沙发的物料成本" 或 "铁件占比多少？"',
      '订单状态："SO202501001订单什么状态？" 或 "有哪些逾期订单？"',
    ];

    // AS-05 修复：使用原始用户输入检测问候语，而非实体列表
    const textToCheck = userInput ?? recognition.entities.map((e) => e.raw).join('');
    const isGreeting = /你好|您好|hi|hello|嗨/i.test(textToCheck);

    const answer = isGreeting
      ? '你好！我是智造管家 AI 助手，可以帮您查询库存、采购建议、生产排产、质量统计、成本分析和订单状态。请问有什么可以帮您？'
      : '我暂时无法理解您的问题，以下是我能回答的问题类型，供您参考：';

    return { answer, suggestions: isGreeting ? [] : guideItems };
  }

  // ── 重试包装器 ────────────────────────────────────────────────

  private async withRetry<T>(
    fn: () => Promise<T>,
    maxRetries: number,
    baseDelayMs: number,
  ): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err: unknown) {
        lastError = err;
        if (attempt < maxRetries - 1) {
          await new Promise((r) => setTimeout(r, baseDelayMs * Math.pow(2, attempt)));
        }
      }
    }

    throw lastError;
  }

  // ── 私有辅助 ──────────────────────────────────────────────────

  private parseDateEntity(value?: string): string {
    if (!value) return new Date().toISOString().slice(0, 10);
    const today = new Date();
    if (value === '今天') return today.toISOString().slice(0, 10);
    if (value === '明天') {
      today.setDate(today.getDate() + 1);
      return today.toISOString().slice(0, 10);
    }
    if (value === '昨天') {
      today.setDate(today.getDate() - 1);
      return today.toISOString().slice(0, 10);
    }
    // 尝试解析 YYYY-MM-DD 格式
    if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(value)) {
      return value.replace(/\//g, '-');
    }
    return today.toISOString().slice(0, 10);
  }

  private formatDateLabel(value?: string): string {
    if (!value) return '今天';
    return value;
  }

  private parseDateRangeDays(value?: string): number {
    if (!value) return 30;
    const match = value.match(/最近(\d+)(天|周|个月)/);
    if (match) {
      const num = parseInt(match[1], 10);
      if (match[2] === '天') return num;
      if (match[2] === '周') return num * 7;
      if (match[2] === '个月') return num * 30;
    }
    if (value === '本周') return 7;
    if (value === '上周') return 14;
    if (value === '本月') return 30;
    return 30;
  }

  private formatPeriodLabel(raw: string | undefined, days: number): string {
    if (raw) return raw;
    return `近${days}天`;
  }

  /**
   * 将生产工单行数据包装成 SchedulePlan 兼容结构（单工单进度查询场景）
   */
  private buildSimplePlan(rows: Array<{
    work_order_no: string; sku_name: string; qty_planned: string;
    qty_completed: string; status: string;
    sales_order_no: string; expected_delivery: string;
  }>): {
    schedules: Array<{
      workOrderNo: string; stepName: string;
      workerName: string | null; workstationName: string | null;
      plannedQty: string; estimatedHours: string;
    }>;
    summary: { totalOrders: number; totalSteps: number; capacityLoadRate: string };
  } {
    return {
      schedules: rows.map((r) => ({
        workOrderNo: r.work_order_no,
        stepName: `${r.sku_name}（${this.translateProductionStatus(r.status)}）`,
        workerName: null,
        workstationName: null,
        plannedQty: r.qty_planned,
        estimatedHours: '—',
      })),
      summary: {
        totalOrders: rows.length,
        totalSteps: rows.length,
        capacityLoadRate: '—',
      },
    };
  }

  private translateProductionStatus(status: string): string {
    const map: Record<string, string> = {
      pending: '待排产', scheduled: '已排产',
      in_progress: '生产中', completed: '已完工', cancelled: '已取消',
    };
    return map[status] ?? status;
  }

  // ─── BE-P1-016: AI 对话历史接口 ──────────────────────────────

  async listConversations(): Promise<Array<{ sessionId: string; lastMessage: string; updatedAt: string }>> {
    const rows = await AppDataSource.query(
      `SELECT session_id,
              MAX(created_at) AS updated_at,
              SUBSTRING_INDEX(GROUP_CONCAT(content ORDER BY created_at DESC SEPARATOR '|||'), '|||', 1) AS last_message
       FROM ai_messages
       WHERE tenant_id = ? AND user_id = ?
       GROUP BY session_id
       ORDER BY updated_at DESC
       LIMIT 20`,
      [this.tenantId, this.userId],
    );
    return rows.map((r: Record<string, unknown>) => ({
      sessionId: String(r.session_id),
      lastMessage: String(r.last_message ?? ''),
      updatedAt: String(r.updated_at),
    }));
  }

  async getConversationMessages(sessionId: string): Promise<Array<{ role: string; content: string; createdAt: string }>> {
    const rows = await AppDataSource.query(
      `SELECT role, content, created_at
       FROM ai_messages
       WHERE tenant_id = ? AND user_id = ? AND session_id = ?
       ORDER BY created_at ASC`,
      [this.tenantId, this.userId, sessionId],
    );
    return rows.map((r: Record<string, unknown>) => ({
      role: String(r.role),
      content: String(r.content),
      createdAt: String(r.created_at),
    }));
  }

  async clearConversation(sessionId: string): Promise<void> {
    await AppDataSource.query(
      `DELETE FROM ai_messages WHERE tenant_id = ? AND user_id = ? AND session_id = ?`,
      [this.tenantId, this.userId, sessionId],
    );
  }
}

// ─── 内部类型（ai_suggestions 表行结构） ─────────────────────

export interface AiSuggestion {
  id: number;
  type: string;
  title: string;
  summary: string;
  level: 'info' | 'warning' | 'error';
  status: 'unread' | 'read' | 'adopted' | 'ignored';
  related_data: string | null;
  created_at: string;
  read_at: string | null;
}
