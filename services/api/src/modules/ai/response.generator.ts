/**
 * [artifact:Prompt设计] — 响应生成器
 *
 * 职责：
 * 1. 根据意图 + 业务数据生成自然语言回复文本
 * 2. 生成结构化数据卡片（表格、列表、指标）
 * 3. 将完整响应拆分为 SSE 分段序列，模拟流式输出
 *
 * SSE 帧格式（与 AiChatPanel.tsx 兼容）：
 *   data: {"content": "文字片段"}\n\n
 *   data: {"dataCard": {...}}\n\n
 *   data: [DONE]\n\n
 *
 * Phase 2 升级方向：将模板文本替换为 LLM 生成，保持帧格式不变。
 */

import { Response } from 'express';
import { IntentType } from './intent.recognizer';

// ─── 数据卡片类型 ──────────────────────────────────────────────

export type CardType = 'table' | 'list' | 'metric' | 'alert' | 'suggestion';

export interface DataCard {
  type: CardType;
  title: string;
  data: unknown;
}

export interface TableCard extends DataCard {
  type: 'table';
  data: {
    columns: Array<{ key: string; label: string; width?: string }>;
    rows: Record<string, string | number | null>[];
  };
}

export interface ListCard extends DataCard {
  type: 'list';
  data: Array<{ label: string; value: string; tag?: string; tagColor?: 'red' | 'orange' | 'green' | 'blue' | 'gray' }>;
}

export interface MetricCard extends DataCard {
  type: 'metric';
  data: Array<{ label: string; value: string; unit?: string; trend?: 'up' | 'down' | 'flat'; delta?: string }>;
}

export interface AlertCard extends DataCard {
  type: 'alert';
  data: { level: 'error' | 'warning' | 'info'; items: string[] };
}

export interface SuggestionCard extends DataCard {
  type: 'suggestion';
  data: Array<{ text: string; action?: string; actionLabel?: string }>;
}

// ─── SSE 帧类型 ────────────────────────────────────────────────

export type SseFrame =
  | { content: string }
  | { dataCard: DataCardPayload }
  | { phase: 'thinking' | 'querying' | 'generating' | 'done'; label: string };

// ─── 生成结果结构 ──────────────────────────────────────────────

export interface GeneratedResponse {
  text: string;
  cards: DataCard[];
}

// ─── 前端 DataCardPayload 结构（与 AiChatPage.tsx 对齐） ──────

export interface DataCardPayload {
  mode: 'table' | 'kpi';
  title?: string;
  columns?: string[];
  rows?: string[][];
  kpis?: Array<{ label: string; value: string; status?: 'warning' | 'error' | 'success' }>;
}

// ─── 业务数据入参类型（松散结构，适配各意图） ─────────────────

export type BusinessData = Record<string, unknown>;

// ─── 响应生成器 ───────────────────────────────────────────────

export class ResponseGenerator {

  // ── 主入口：根据意图 + 数据生成响应结构 ──────────────────────

  generate(intent: IntentType, data: BusinessData): GeneratedResponse {
    switch (intent) {
      case 'inventory_query':   return this.buildInventoryResponse(data);
      case 'purchase_suggest':  return this.buildPurchaseResponse(data);
      case 'production_query':  return this.buildProductionResponse(data);
      case 'quality_stats':     return this.buildQualityResponse(data);
      case 'cost_analysis':     return this.buildCostResponse(data);
      case 'order_status':      return this.buildOrderResponse(data);
      default:                  return this.buildGeneralResponse(data);
    }
  }

  // ── SSE 流式输出：将生成结果写入 Express Response ─────────────

  /**
   * 将响应分段写入 SSE 流。
   * 调用方负责提前设置好响应头，本方法只负责写帧。
   *
   * 流程：
   *   phase:thinking → phase:querying → phase:generating
   *   → 逐字输出文本 → 输出数据卡片 → [DONE]
   */
  async streamResponse(
    res: Response,
    intent: IntentType,
    data: BusinessData,
    options: { chunkSize?: number; chunkDelayMs?: number } = {},
  ): Promise<void> {
    const { chunkSize = 8, chunkDelayMs = 30 } = options;

    const write = (frame: SseFrame): void => {
      res.write(`data: ${JSON.stringify(frame)}\n\n`);
    };

    // 阶段帧：思考中
    write({ phase: 'thinking', label: '正在理解您的问题...' });
    await this.delay(120);

    // 阶段帧：查询数据
    write({ phase: 'querying', label: '检索业务数据...' });
    await this.delay(200);

    // 阶段帧：生成回复
    write({ phase: 'generating', label: '生成分析结论...' });
    await this.delay(80);

    // 生成完整响应
    const generated = this.generate(intent, data);

    // 逐字符分段输出文本（模拟流式打字）
    const text = generated.text;
    for (let i = 0; i < text.length; i += chunkSize) {
      const chunk = text.slice(i, i + chunkSize);
      write({ content: chunk });
      if (chunkDelayMs > 0) await this.delay(chunkDelayMs);
    }

    // 输出数据卡片（转换为前端 DataCardPayload 格式后发送）
    for (const card of generated.cards) {
      const payload = this.toPayload(card);
      if (payload) {
        write({ dataCard: payload });
        await this.delay(20);
      }
    }

    // 完成帧
    write({ phase: 'done', label: '已完成' });
    res.write('data: [DONE]\n\n');
  }

  // ── 设置 SSE 响应头（路由层调用） ─────────────────────────────

  static setSseHeaders(res: Response): void {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');   // 禁用 Nginx 缓冲
    res.flushHeaders();
  }

  // ── 错误帧输出 ─────────────────────────────────────────────────

  static writeError(res: Response, message: string): void {
    res.write(`data: ${JSON.stringify({ error: message })}\n\n`);
    res.write('data: [DONE]\n\n');
  }

  // ── 各意图响应构建 ─────────────────────────────────────────────

  private buildInventoryResponse(data: BusinessData): GeneratedResponse {
    const items = (data.items as InventoryItem[] | undefined) ?? [];
    const queryName = (data.queryName as string | undefined) ?? '';
    const lowStockCount = (data.lowStockCount as number | undefined) ?? 0;

    if (items.length === 0) {
      return {
        text: queryName
          ? `暂未找到"${queryName}"相关的库存记录，请确认物料名称是否正确，或联系仓库核实。`
          : '当前暂无库存数据，请先确认物料已录入系统。',
        cards: [],
      };
    }

    // 生成描述文本
    let text = '';
    if (queryName) {
      const item = items[0];
      text = `"${queryName}"当前库存 ${item.qtyAvailable} ${item.unit}，`;
      if (item.isBelowSafety) {
        text += `已低于安全库存（安全值 ${item.safetyStock} ${item.unit}），建议尽快补货。`;
      } else {
        text += `库存充足，安全库存为 ${item.safetyStock} ${item.unit}。`;
      }
    } else {
      text = `当前共有 ${items.length} 个物料库存记录。`;
      if (lowStockCount > 0) {
        text += `其中 ${lowStockCount} 个物料库存低于安全阈值，需关注补货。`;
      }
    }

    // 构建表格卡片
    const tableCard: TableCard = {
      type: 'table',
      title: queryName ? `"${queryName}"库存详情` : '库存一览',
      data: {
        columns: [
          { key: 'skuName', label: '物料名称', width: '30%' },
          { key: 'skuCode', label: '物料编码', width: '20%' },
          { key: 'qtyAvailable', label: '可用库存', width: '15%' },
          { key: 'unit', label: '单位', width: '10%' },
          { key: 'safetyStock', label: '安全库存', width: '15%' },
          { key: 'status', label: '状态', width: '10%' },
        ],
        rows: items.map((i) => ({
          skuName: i.skuName,
          skuCode: i.skuCode,
          qtyAvailable: i.qtyAvailable,
          unit: i.unit,
          safetyStock: i.safetyStock,
          status: i.isBelowSafety ? '库存偏低' : '正常',
        })),
      },
    };

    const cards: DataCard[] = [tableCard];

    // 若有低库存，追加警告卡片
    if (lowStockCount > 0) {
      const alertCard: AlertCard = {
        type: 'alert',
        title: '库存预警',
        data: {
          level: 'warning',
          items: items
            .filter((i) => i.isBelowSafety)
            .map((i) => `${i.skuName}：当前 ${i.qtyAvailable} ${i.unit}，安全库存 ${i.safetyStock} ${i.unit}`),
        },
      };
      cards.push(alertCard);
    }

    return { text, cards };
  }

  private buildPurchaseResponse(data: BusinessData): GeneratedResponse {
    const suggestions = (data.suggestions as PurchaseSuggestionItem[] | undefined) ?? [];
    const generatedAt = (data.generatedAt as string | undefined) ?? new Date().toLocaleString('zh-CN');

    if (suggestions.length === 0) {
      return {
        text: '根据当前库存和在产工单分析，目前物料储备充足，暂无需要紧急采购的物料。',
        cards: [],
      };
    }

    const highConfCount = suggestions.filter((s) => s.confidence === 'high').length;
    const totalEstimated = suggestions
      .filter((s) => s.estimatedAmount)
      .reduce((sum, s) => sum + parseFloat(s.estimatedAmount ?? '0'), 0);

    let text = `根据在产订单BOM需求分析，共有 ${suggestions.length} 项物料建议采购`;
    if (highConfCount > 0) {
      text += `（其中 ${highConfCount} 项高置信度）`;
    }
    text += `。`;
    if (totalEstimated > 0) {
      text += `预计采购总金额约 ¥${totalEstimated.toFixed(2)}。`;
    }
    text += `\n\n建议优先处理高置信度项目，生成时间：${generatedAt}。`;

    const tableCard: TableCard = {
      type: 'table',
      title: '采购建议清单',
      data: {
        columns: [
          { key: 'skuName', label: '物料名称', width: '25%' },
          { key: 'suggestedQty', label: '建议数量', width: '15%' },
          { key: 'purchaseUnit', label: '单位', width: '8%' },
          { key: 'supplierName', label: '推荐供应商', width: '20%' },
          { key: 'estimatedAmount', label: '预估金额', width: '15%' },
          { key: 'confidence', label: '置信度', width: '10%' },
          { key: 'reason', label: '原因', width: '20%' },
        ],
        rows: suggestions.map((s) => ({
          skuName: s.skuName,
          suggestedQty: s.suggestedQty,
          purchaseUnit: s.purchaseUnit,
          supplierName: s.supplierName ?? '待定',
          estimatedAmount: s.estimatedAmount ? `¥${s.estimatedAmount}` : '待询价',
          confidence: { high: '高', medium: '中', low: '低' }[s.confidence],
          reason: s.reason,
        })),
      },
    };

    return { text, cards: [tableCard] };
  }

  private buildProductionResponse(data: BusinessData): GeneratedResponse {
    const plan = data.plan as ProductionPlanData | undefined;
    const date = (data.date as string | undefined) ?? '今天';

    if (!plan || plan.schedules.length === 0) {
      return {
        text: `${date}暂无排产计划，可能是当日工单已全部完工或尚未生成排产。`,
        cards: [],
      };
    }

    const { totalOrders, totalSteps, capacityLoadRate } = plan.summary;
    let text = `${date}排产计划已就绪：共安排 ${totalOrders} 个工单，${totalSteps} 道工序，产能负荷率 ${capacityLoadRate}。`;

    const loadNum = parseFloat(capacityLoadRate);
    if (loadNum >= 90) {
      text += '\n\n注意：当前产能负荷较高，建议谨慎接受新插单。';
    } else if (loadNum <= 50) {
      text += '\n\n当前产能有较多余量，可考虑适当提前安排其他订单。';
    }

    const tableCard: TableCard = {
      type: 'table',
      title: `${date}排产明细`,
      data: {
        columns: [
          { key: 'workOrderNo', label: '工单号', width: '18%' },
          { key: 'stepName', label: '工序', width: '18%' },
          { key: 'workerName', label: '负责工人', width: '16%' },
          { key: 'workstationName', label: '工作站', width: '16%' },
          { key: 'plannedQty', label: '计划数量', width: '12%' },
          { key: 'estimatedHours', label: '预计工时(h)', width: '12%' },
        ],
        rows: plan.schedules.slice(0, 20).map((s) => ({
          workOrderNo: s.workOrderNo,
          stepName: s.stepName,
          workerName: s.workerName ?? '待分配',
          workstationName: s.workstationName ?? '待分配',
          plannedQty: s.plannedQty,
          estimatedHours: s.estimatedHours,
        })),
      },
    };

    const metricCard: MetricCard = {
      type: 'metric',
      title: '排产汇总',
      data: [
        { label: '在产工单', value: String(totalOrders), unit: '个' },
        { label: '工序总数', value: String(totalSteps), unit: '道' },
        { label: '产能负荷率', value: capacityLoadRate },
      ],
    };

    return { text, cards: [metricCard, tableCard] };
  }

  private buildQualityResponse(data: BusinessData): GeneratedResponse {
    const stats = data.stats as QualityStatsData | undefined;
    const skuName = (data.skuName as string | undefined) ?? '';
    const period = (data.period as string | undefined) ?? '近30天';

    if (!stats) {
      return {
        text: `暂未获取到${skuName ? `"${skuName}"` : ''}的质量统计数据。`,
        cards: [],
      };
    }

    const passRate = parseFloat(stats.passRate);
    let text = `${period}${skuName ? `"${skuName}"` : '整体'}质量情况：`;
    text += `良品率 ${stats.passRate}%，`;
    text += `检验总数 ${stats.totalInspected} 件，`;
    text += `不良品 ${stats.defectCount} 件。`;

    if (passRate < 90) {
      text += `\n\n良品率偏低（行业基准 ≥95%），建议排查主要不良原因，重点关注：${stats.topDefects?.slice(0, 2).join('、') ?? '工艺问题'}。`;
    } else if (passRate >= 98) {
      text += '\n\n质量表现优秀，继续保持。';
    }

    const metricCard: MetricCard = {
      type: 'metric',
      title: `${period}质量指标`,
      data: [
        {
          label: '良品率',
          value: `${stats.passRate}%`,
          trend: passRate >= 95 ? 'up' : 'down',
          delta: stats.passRateDelta ?? undefined,
        },
        { label: '检验总数', value: String(stats.totalInspected), unit: '件' },
        { label: '不良品数', value: String(stats.defectCount), unit: '件' },
        { label: '返工数', value: String(stats.reworkCount ?? 0), unit: '件' },
      ],
    };

    const cards: DataCard[] = [metricCard];

    if (stats.topDefects && stats.topDefects.length > 0) {
      const listCard: ListCard = {
        type: 'list',
        title: '主要不良类型',
        data: stats.topDefects.map((d, idx) => ({
          label: `TOP ${idx + 1}`,
          value: d,
          tag: idx === 0 ? '最多' : undefined,
          tagColor: idx === 0 ? 'red' : 'orange',
        })),
      };
      cards.push(listCard);
    }

    return { text, cards };
  }

  private buildCostResponse(data: BusinessData): GeneratedResponse {
    const breakdown = data.breakdown as CostBreakdownData | undefined;
    const skuName = (data.skuName as string | undefined) ?? '';

    if (!breakdown) {
      return {
        text: `暂未获取到${skuName ? `"${skuName}"` : ''}的成本数据，请确认产品BOM已录入。`,
        cards: [],
      };
    }

    const totalCost = breakdown.totalCost;
    let text = `${skuName ? `"${skuName}"` : '该产品'}物料成本分析：`;
    text += `总物料成本约 ¥${totalCost}。`;

    if (breakdown.categories && breakdown.categories.length > 0) {
      const topCategory = breakdown.categories[0];
      text += `\n\n占比最高的是${topCategory.name}，占总成本 ${topCategory.ratio}%（¥${topCategory.amount}）。`;
    }

    const tableCard: TableCard = {
      type: 'table',
      title: `${skuName ? `"${skuName}"` : ''}物料成本明细`,
      data: {
        columns: [
          { key: 'name', label: '物料/分类', width: '30%' },
          { key: 'qty', label: '用量', width: '15%' },
          { key: 'unit', label: '单位', width: '10%' },
          { key: 'unitPrice', label: '单价(¥)', width: '15%' },
          { key: 'amount', label: '小计(¥)', width: '15%' },
          { key: 'ratio', label: '占比', width: '15%' },
        ],
        rows: (breakdown.items ?? []).map((item) => ({
          name: item.name,
          qty: item.qty,
          unit: item.unit,
          unitPrice: item.unitPrice,
          amount: item.amount,
          ratio: `${item.ratio}%`,
        })),
      },
    };

    return { text, cards: [tableCard] };
  }

  private buildOrderResponse(data: BusinessData): GeneratedResponse {
    const orders = (data.orders as OrderStatusItem[] | undefined) ?? [];
    const overdueCount = (data.overdueCount as number | undefined) ?? 0;
    const orderNo = (data.orderNo as string | undefined) ?? '';

    if (orders.length === 0) {
      return {
        text: orderNo
          ? `未找到订单"${orderNo}"，请核对订单号是否正确。`
          : '暂无匹配的订单记录。',
        cards: [],
      };
    }

    let text = '';
    if (orderNo && orders.length === 1) {
      const o = orders[0];
      text = `订单 ${o.orderNo} 当前状态：${this.translateOrderStatus(o.status)}。`;
      text += `\n客户：${o.customerName}，产品：${o.skuName}，数量：${o.qty}${o.unit}。`;
      text += `\n预计交期：${o.expectedDelivery}`;
      if (o.isOverdue) {
        text += `（已逾期 ${o.overdueDays} 天，请及时跟进）`;
      }
      text += '。';
    } else {
      text = `共找到 ${orders.length} 条订单记录。`;
      if (overdueCount > 0) {
        text += `\n其中 ${overdueCount} 条订单已逾期，请优先处理。`;
      }
    }

    const tableCard: TableCard = {
      type: 'table',
      title: orderNo ? `订单 ${orderNo} 详情` : '订单列表',
      data: {
        columns: [
          { key: 'orderNo', label: '订单号', width: '18%' },
          { key: 'customerName', label: '客户', width: '18%' },
          { key: 'skuName', label: '产品', width: '18%' },
          { key: 'qty', label: '数量', width: '10%' },
          { key: 'status', label: '状态', width: '12%' },
          { key: 'expectedDelivery', label: '交期', width: '12%' },
          { key: 'overdue', label: '逾期', width: '12%' },
        ],
        rows: orders.map((o) => ({
          orderNo: o.orderNo,
          customerName: o.customerName,
          skuName: o.skuName,
          qty: `${o.qty}${o.unit}`,
          status: this.translateOrderStatus(o.status),
          expectedDelivery: o.expectedDelivery,
          overdue: o.isOverdue ? `逾期${o.overdueDays}天` : '正常',
        })),
      },
    };

    return { text, cards: [tableCard] };
  }

  private buildGeneralResponse(data: BusinessData): GeneratedResponse {
    const answer = (data.answer as string | undefined) ?? '';
    const suggestions = (data.suggestions as string[] | undefined) ?? [];

    const text = answer || '您好，我是智造管家 AI 助手。您可以向我咨询库存情况、采购建议、生产排产、质量统计、成本分析或订单状态等问题。';

    if (suggestions.length === 0) {
      return { text, cards: [] };
    }

    const suggCard: SuggestionCard = {
      type: 'suggestion',
      title: '您可能想问',
      data: suggestions.map((s) => ({ text: s })),
    };

    return { text, cards: [suggCard] };
  }

  // ── 辅助方法 ──────────────────────────────────────────────────

  private translateOrderStatus(status: string): string {
    const map: Record<string, string> = {
      draft: '草稿',
      confirmed: '已确认',
      in_production: '生产中',
      completed: '已完工',
      shipped: '已发货',
      cancelled: '已取消',
    };
    return map[status] ?? status;
  }

  /**
   * NEW-01 修复：将内部 DataCard 转换为前端 DataCardPayload 格式
   *
   * 映射规则：
   *   table → mode:'table', columns 取 label, rows 取各列 value
   *   metric → mode:'kpi', kpis 取 label/value
   *   list / alert / suggestion → mode:'table'（降级为表格展示）
   */
  private toPayload(card: DataCard): DataCardPayload | null {
    switch (card.type) {
      case 'table': {
        const d = card.data as {
          columns: Array<{ key: string; label: string }>;
          rows: Record<string, string | number | null>[];
        };
        return {
          mode: 'table',
          title: card.title,
          columns: d.columns.map((c) => c.label),
          rows: d.rows.map((row) =>
            d.columns.map((c) => String(row[c.key] ?? '')),
          ),
        };
      }
      case 'metric': {
        const items = card.data as Array<{
          label: string; value: string; trend?: 'up' | 'down' | 'flat';
        }>;
        return {
          mode: 'kpi',
          title: card.title,
          kpis: items.map((m) => ({
            label: m.label,
            value: m.value,
            status: m.trend === 'down' ? 'error' as const
                  : m.trend === 'up' ? 'success' as const
                  : undefined,
          })),
        };
      }
      case 'list': {
        const items = card.data as Array<{ label: string; value: string }>;
        return {
          mode: 'table',
          title: card.title,
          columns: ['序号', '内容'],
          rows: items.map((item) => [item.label, item.value]),
        };
      }
      case 'alert': {
        const d = card.data as { level: string; items: string[] };
        return {
          mode: 'table',
          title: card.title,
          columns: ['预警项'],
          rows: d.items.map((text) => [text]),
        };
      }
      case 'suggestion': {
        const items = card.data as Array<{ text: string }>;
        return {
          mode: 'table',
          title: card.title,
          columns: ['建议'],
          rows: items.map((s) => [s.text]),
        };
      }
      default:
        return null;
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ─── 内部数据类型定义（避免与业务层强耦合） ──────────────────

interface InventoryItem {
  skuName: string;
  skuCode: string;
  qtyAvailable: string;
  unit: string;
  safetyStock: string;
  isBelowSafety: boolean;
}

interface PurchaseSuggestionItem {
  skuName: string;
  suggestedQty: string;
  purchaseUnit: string;
  supplierName: string | null;
  estimatedAmount: string | null;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}

interface ProductionPlanData {
  schedules: Array<{
    workOrderNo: string;
    stepName: string;
    workerName: string | null;
    workstationName: string | null;
    plannedQty: string;
    estimatedHours: string;
  }>;
  summary: {
    totalOrders: number;
    totalSteps: number;
    capacityLoadRate: string;
  };
}

interface QualityStatsData {
  passRate: string;
  totalInspected: number;
  defectCount: number;
  reworkCount?: number;
  passRateDelta?: string;
  topDefects?: string[];
}

interface CostBreakdownData {
  totalCost: string;
  categories?: Array<{ name: string; amount: string; ratio: string }>;
  items?: Array<{ name: string; qty: string; unit: string; unitPrice: string; amount: string; ratio: string }>;
}

interface OrderStatusItem {
  orderNo: string;
  customerName: string;
  skuName: string;
  qty: string;
  unit: string;
  status: string;
  expectedDelivery: string;
  isOverdue: boolean;
  overdueDays: number;
}
