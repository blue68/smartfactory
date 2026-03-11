/**
 * [artifact:AI架构] — 意图识别器
 *
 * Phase 1 规则引擎：基于关键词匹配 + 正则表达式识别用户意图，
 * 提取业务实体（SKU名称、订单号、日期范围等），
 * 返回意图类型、置信度、实体列表。
 *
 * Phase 2 升级方向：替换为 LLM NER（Named Entity Recognition）模型。
 */

// ─── 意图类型枚举 ─────────────────────────────────────────────

export type IntentType =
  | 'inventory_query'    // 库存查询：XX材料还有多少
  | 'purchase_suggest'   // 采购建议：需要采购什么
  | 'production_query'   // 排产查询：今天排产情况
  | 'quality_stats'      // 质量统计：最近良品率
  | 'cost_analysis'      // 成本分析：XX产品物料成本
  | 'order_status'       // 订单状态：XX订单什么状态
  | 'general_qa';        // 通用问答：兜底回复

export type ConfidenceLevel = 'high' | 'medium' | 'low';

// ─── 实体类型 ─────────────────────────────────────────────────

export interface ExtractedEntity {
  type: 'sku_name' | 'order_no' | 'date' | 'date_range' | 'category';
  value: string;
  /** 原始匹配文本 */
  raw: string;
}

// ─── 识别结果 ─────────────────────────────────────────────────

export interface RecognitionResult {
  intent: IntentType;
  confidence: ConfidenceLevel;
  /** 0.0 ~ 1.0 的数值置信度 */
  score: number;
  entities: ExtractedEntity[];
  /** 调试用：哪些规则命中 */
  matchedRules: string[];
}

// ─── 关键词规则定义 ───────────────────────────────────────────

interface IntentRule {
  intent: IntentType;
  /** 强匹配关键词（命中任一得 0.6 分） */
  strongKeywords: string[];
  /** 弱匹配关键词（命中任一得 0.3 分） */
  weakKeywords: string[];
  /** 正则模式（命中得 0.8 分） */
  patterns: RegExp[];
}

const INTENT_RULES: IntentRule[] = [
  {
    intent: 'inventory_query',
    strongKeywords: ['库存', '还有多少', '剩余', '库里', '仓库', '库存量', '现货', '存量'],
    weakKeywords: ['材料', '物料', '快没了', '不够', '缺料', '安全库存'],
    patterns: [
      /(.+?)还有多少/,
      /(.+?)的?库存/,
      /哪些.*(快没了|告急|不足|低于)/,
      /库存.*查询/,
    ],
  },
  {
    intent: 'purchase_suggest',
    strongKeywords: ['采购', '进货', '补货', '采购建议', '采购计划', '采购什么', '需要买'],
    weakKeywords: ['缺货', '缺口', '供应商', '报价', '下单', '订货'],
    patterns: [
      /需要采购/,
      /给我.*采购.*(计划|建议|清单)/,
      /出.*采购单/,
      /要.*买什么/,
      /哪些需要.*购/,
    ],
  },
  {
    intent: 'production_query',
    strongKeywords: ['排产', '生产计划', '工单', '工序', '排班', '产能', '生产进度'],
    weakKeywords: ['今天', '明天', '本周', '工人', '工作站', '完工', '在产'],
    patterns: [
      /今天.*排产/,
      /排产.*情况/,
      /([A-Z]{2}\d{6,}|WO\d+).*进度/,
      /生产.*计划/,
      /工单.*(状态|进度|情况)/,
    ],
  },
  {
    intent: 'quality_stats',
    strongKeywords: ['良品率', '质量', '不良品', '废品', '质检', '返工', '缺陷', '次品'],
    weakKeywords: ['合格', '通过', '检验', '报废', '质量问题'],
    patterns: [
      /良品率/,
      /不良.*率/,
      /(.+?)的?质量(问题|情况|统计)/,
      /质量.*分析/,
      /废品.*率/,
    ],
  },
  {
    intent: 'cost_analysis',
    strongKeywords: ['成本', '物料成本', '材料费', '成本分析', '费用', '占比'],
    weakKeywords: ['价格', '单价', '金额', '铁件', '面料', '辅料', '材质'],
    patterns: [
      /(.+?)的?物料成本/,
      /(.+?)成本.*多少/,
      /铁件.*占比/,
      /(.+类).*占.*(多少|比例)/,
      /成本.*分析/,
    ],
  },
  {
    intent: 'order_status',
    strongKeywords: ['订单', '单子', '逾期', '延期', '交期', '出货', '发货'],
    weakKeywords: ['客户', '什么状态', '进展', '催单', '在哪', '完成了吗'],
    patterns: [
      /([A-Z]{2}\d{6,}|SO\d+).*(状态|进展|怎样|如何)/,
      /订单.*(查询|状态|情况)/,
      /有哪些.*逾期/,
      /(逾期|延期).*(订单|单子)/,
      /客户.*什么时候/,
    ],
  },
];

// ─── 实体提取规则 ─────────────────────────────────────────────

const ORDER_NO_PATTERN = /\b([A-Z]{2}\d{6,}|SO\d{4,}|WO\d{4,}|PO\d{4,})\b/gi;

const DATE_PATTERNS: Array<{ regex: RegExp; type: 'date' | 'date_range' }> = [
  { regex: /今天/, type: 'date' },
  { regex: /明天/, type: 'date' },
  { regex: /昨天/, type: 'date' },
  { regex: /本周/, type: 'date_range' },
  { regex: /上周/, type: 'date_range' },
  { regex: /本月/, type: 'date_range' },
  { regex: /最近(\d+)(天|周|个月)/, type: 'date_range' },
  { regex: /(\d{4}[-/]\d{1,2}[-/]\d{1,2})/, type: 'date' },
];

const CATEGORY_PATTERNS: RegExp[] = [
  /铁件|五金|金属件/,
  /面料|皮料|布料/,
  /辅料|配件|零件/,
  /海绵|填充物/,
  /木材|木料|板材/,
];

// ─── 意图识别器主类 ───────────────────────────────────────────

export class IntentRecognizer {
  /**
   * 识别用户输入的意图
   * @param input  用户自然语言输入
   * @returns 识别结果，包含意图、置信度、实体
   */
  recognize(input: string): RecognitionResult {
    const normalizedInput = input.trim().toLowerCase();
    const matchedRules: string[] = [];

    // 对所有意图规则打分
    const scores: Array<{ intent: IntentType; score: number }> = INTENT_RULES.map((rule) => {
      let score = 0;

      // 强关键词匹配
      for (const kw of rule.strongKeywords) {
        if (normalizedInput.includes(kw)) {
          score += 0.6;
          matchedRules.push(`strong:${kw}`);
          break; // 同类关键词只计一次
        }
      }

      // 弱关键词匹配（可叠加，上限 0.4）
      let weakScore = 0;
      for (const kw of rule.weakKeywords) {
        if (normalizedInput.includes(kw)) {
          weakScore = Math.min(weakScore + 0.2, 0.4);
          matchedRules.push(`weak:${kw}`);
        }
      }
      score += weakScore;

      // 正则模式匹配（命中最高得分规则）
      for (const pattern of rule.patterns) {
        if (pattern.test(input)) {
          score = Math.max(score, 0.85);
          matchedRules.push(`pattern:${pattern.source}`);
          break;
        }
      }

      return { intent: rule.intent, score: Math.min(score, 1.0) };
    });

    // 找最高分意图
    const best = scores.reduce(
      (prev, cur) => (cur.score > prev.score ? cur : prev),
      { intent: 'general_qa' as IntentType, score: 0 },
    );

    // 分数过低时回退到通用问答
    const finalIntent: IntentType = best.score >= 0.3 ? best.intent : 'general_qa';
    const finalScore = best.score >= 0.3 ? best.score : 0.1;

    // 计算置信度级别
    const confidence: ConfidenceLevel =
      finalScore >= 0.75 ? 'high' :
      finalScore >= 0.45 ? 'medium' : 'low';

    // 提取实体
    const entities = this.extractEntities(input);

    return {
      intent: finalIntent,
      confidence,
      score: parseFloat(finalScore.toFixed(2)),
      entities,
      matchedRules: [...new Set(matchedRules)],
    };
  }

  /**
   * 从输入文本中提取业务实体
   */
  private extractEntities(input: string): ExtractedEntity[] {
    const entities: ExtractedEntity[] = [];

    // 提取订单号
    const orderMatches = [...input.matchAll(ORDER_NO_PATTERN)];
    for (const m of orderMatches) {
      entities.push({ type: 'order_no', value: m[1], raw: m[0] });
    }

    // 提取日期/时间范围
    for (const { regex, type } of DATE_PATTERNS) {
      const m = input.match(regex);
      if (m) {
        entities.push({ type, value: m[0], raw: m[0] });
      }
    }

    // 提取物料分类关键词
    for (const pattern of CATEGORY_PATTERNS) {
      const m = input.match(pattern);
      if (m) {
        entities.push({ type: 'category', value: m[0], raw: m[0] });
      }
    }

    // 提取疑似 SKU 名称（中文2-10字，排除常见停用词）
    const skuPattern = /[""「」]([^""「」]{2,20})[""「」]/g;
    const skuMatches = [...input.matchAll(skuPattern)];
    for (const m of skuMatches) {
      entities.push({ type: 'sku_name', value: m[1], raw: m[0] });
    }

    // 提取不带引号的疑似 SKU（"XX材料"、"XX产品"格式）
    const skuContextPattern = /([^\s，。？！,!?]{2,10})(材料|物料|产品|成品|配件|面料|皮料|板材)/g;
    const skuContextMatches = [...input.matchAll(skuContextPattern)];
    for (const m of skuContextMatches) {
      // 避免重复实体
      if (!entities.some((e) => e.value === m[1] + m[2])) {
        entities.push({ type: 'sku_name', value: m[1] + m[2], raw: m[0] });
      }
    }

    return entities;
  }
}
