/**
 * [artifact:AI接口] — 对话上下文管理器
 *
 * 职责：
 * 1. 维护每个用户的对话历史（Redis 存储，TTL 30 分钟）
 * 2. 支持多轮对话中的实体引用解析（"那XX呢？"→ 继承上一轮实体）
 * 3. 提供上下文感知的实体补全（将当前轮缺失的实体从上下文中补全）
 * 4. 多轮状态机：idle → waiting_entity → completed
 *
 * Redis Key 格式：  ai:ctx:{tenantId}:{userId}
 * TTL：            1800 秒（30 分钟无操作自动过期）
 */

import { getRedisClient } from '../../config/redis';
import { AppDataSource } from '../../config/database';
import { IntentType, ExtractedEntity, RecognitionResult } from './intent.recognizer';

// ─── TTL & Key ────────────────────────────────────────────────

const CTX_TTL_SECONDS = 1800;   // 30 分钟

const ctxKey = (tenantId: number, userId: number): string =>
  `ai:ctx:${tenantId}:${userId}`;

// ─── 单轮对话记录 ─────────────────────────────────────────────

export interface ConversationTurn {
  turnId: string;
  timestamp: number;
  /** 用户原始输入 */
  userInput: string;
  /** 识别出的意图 */
  intent: IntentType;
  /** 本轮提取到的实体 */
  entities: ExtractedEntity[];
  /** AI 回复摘要（前100字符，节省 Redis 空间） */
  replySnippet: string;
}

// ─── 上下文状态机 ─────────────────────────────────────────────

export type ContextState =
  | 'idle'             // 无上下文，全新对话
  | 'waiting_entity'   // AI 等待用户补充实体（如询问"哪个SKU？"后等待回答）
  | 'completed';       // 上一轮已完成，可继承实体

// ─── 完整上下文结构 ───────────────────────────────────────────

export interface ConversationContext {
  tenantId: number;
  userId: number;
  state: ContextState;
  /** 最近 N 轮对话（最多保留 10 轮） */
  turns: ConversationTurn[];
  /** 当前会话中累积的实体（跨轮继承） */
  activeEntities: ExtractedEntity[];
  /** 上一轮的意图（用于上下文关联判断） */
  lastIntent: IntentType | null;
  /** 创建时间戳 */
  createdAt: number;
  /** 最后活跃时间戳 */
  lastActiveAt: number;
}

// ─── 指代词检测规则（用于判断是否需要从上下文继承实体） ────────

const REFERENCE_PATTERNS: RegExp[] = [
  /^(那|这|它|它的|他|他的|该)/,         // 代词开头
  /那.*(呢|怎么样|如何|怎样)/,            // "那XX呢"
  /^(还有|另外|还是|同样|也)/,            // 转折/并列
  /^(它|这个|那个).*(多少|怎样|怎么)/,
];

const MAX_TURNS = 10;

// ─── 上下文管理器 ─────────────────────────────────────────────

export class ContextManager {
  private readonly tenantId: number;
  private readonly userId: number;

  constructor(tenantId: number, userId: number) {
    this.tenantId = tenantId;
    this.userId = userId;
  }

  // ── 读取当前上下文 ────────────────────────────────────────────

  async getContext(): Promise<ConversationContext> {
    const redis = getRedisClient();
    const raw = await redis.get(ctxKey(this.tenantId, this.userId));

    if (!raw) {
      return this.makeEmptyContext();
    }

    try {
      return JSON.parse(raw) as ConversationContext;
    } catch {
      // 反序列化失败则重置
      return this.makeEmptyContext();
    }
  }

  // ── 保存上下文 ────────────────────────────────────────────────

  async saveContext(ctx: ConversationContext): Promise<void> {
    const redis = getRedisClient();
    ctx.lastActiveAt = Date.now();
    await redis.setex(
      ctxKey(this.tenantId, this.userId),
      CTX_TTL_SECONDS,
      JSON.stringify(ctx),
    );
  }

  // ── 清除上下文（用户主动重置或会话结束） ─────────────────────

  async clearContext(): Promise<void> {
    const redis = getRedisClient();
    await redis.del(ctxKey(this.tenantId, this.userId));
  }

  // ── 核心方法：基于上下文增强意图识别结果 ─────────────────────

  /**
   * 将当前轮的识别结果与历史上下文结合，补全缺失实体。
   *
   * 逻辑：
   * 1. 检测输入是否包含指代词（"那个"、"它"等）
   * 2. 若是指代，则将上一轮的 activeEntities 合并进当前结果
   * 3. 当前轮新提取的实体优先级高于继承实体（同 type 时覆盖）
   */
  async resolveWithContext(
    userInput: string,
    recognition: RecognitionResult,
  ): Promise<RecognitionResult> {
    const ctx = await this.getContext();

    // 没有历史则直接返回
    if (ctx.turns.length === 0) {
      return recognition;
    }

    const isReference = this.detectReference(userInput);
    if (!isReference && recognition.entities.length > 0) {
      // 用户明确提供了实体且无指代词，不继承
      return recognition;
    }

    // 合并历史实体：历史实体作为兜底，当前识别结果优先
    const mergedEntities = this.mergeEntities(ctx.activeEntities, recognition.entities);

    // 若意图置信度低但有上下文，提升置信度并继承上一轮意图
    let resolvedIntent = recognition.intent;
    let resolvedScore = recognition.score;

    if (recognition.intent === 'general_qa' && recognition.score < 0.3 && ctx.lastIntent) {
      resolvedIntent = ctx.lastIntent;
      resolvedScore = 0.5; // 上下文继承时给予中等置信度
    }

    return {
      ...recognition,
      intent: resolvedIntent,
      score: resolvedScore,
      confidence: resolvedScore >= 0.75 ? 'high' : resolvedScore >= 0.45 ? 'medium' : 'low',
      entities: mergedEntities,
      matchedRules: [...recognition.matchedRules, 'context:inherited'],
    };
  }

  // ── 追加一轮对话记录 ──────────────────────────────────────────

  async appendTurn(
    userInput: string,
    recognition: RecognitionResult,
    replySnippet: string,
    sessionId?: string,
  ): Promise<void> {
    const ctx = await this.getContext();

    const turn: ConversationTurn = {
      turnId: `t_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Date.now(),
      userInput,
      intent: recognition.intent,
      entities: recognition.entities,
      replySnippet: replySnippet.slice(0, 100),
    };

    // 追加并限制历史长度
    ctx.turns.push(turn);
    if (ctx.turns.length > MAX_TURNS) {
      ctx.turns = ctx.turns.slice(-MAX_TURNS);
    }

    // 更新活跃实体（将本轮新实体合并进去）
    ctx.activeEntities = this.mergeEntities(ctx.activeEntities, recognition.entities);

    // 更新状态机
    ctx.lastIntent = recognition.intent;
    ctx.state = 'completed';

    await this.saveContext(ctx);

    // AS-04 修复：同步持久化到 ai_messages 表，供 listConversations / getConversationMessages 使用
    const sid = sessionId || `s_${this.tenantId}_${this.userId}`;
    try {
      await AppDataSource.query(
        `INSERT INTO ai_messages (tenant_id, user_id, session_id, role, content, intent, created_at)
         VALUES (?, ?, ?, 'user', ?, ?, NOW()),
                (?, ?, ?, 'assistant', ?, ?, NOW())`,
        [
          this.tenantId, this.userId, sid, userInput, recognition.intent,
          this.tenantId, this.userId, sid, replySnippet, recognition.intent,
        ],
      );
    } catch (err: unknown) {
      // 持久化失败不影响主流程（Redis 上下文已保存）
      console.error('[ContextManager] ai_messages 持久化失败:', err instanceof Error ? err.message : err);
    }
  }

  // ── 标记等待补充实体状态 ──────────────────────────────────────

  async setWaitingEntity(entityType: ExtractedEntity['type']): Promise<void> {
    const ctx = await this.getContext();
    ctx.state = 'waiting_entity';
    // 在 activeEntities 中记录等待的类型（通过特殊占位符）
    ctx.activeEntities = ctx.activeEntities.filter((e) => e.type !== entityType);
    await this.saveContext(ctx);
  }

  // ── 获取上下文摘要（供 ai.service.ts 构建提示词） ────────────

  async getSummary(): Promise<{
    hasContext: boolean;
    lastIntent: IntentType | null;
    activeEntities: ExtractedEntity[];
    recentTurns: Array<{ input: string; intent: IntentType; replySnippet: string }>;
  }> {
    const ctx = await this.getContext();
    const recentTurns = ctx.turns.slice(-3).map((t) => ({
      input: t.userInput,
      intent: t.intent,
      replySnippet: t.replySnippet,
    }));

    return {
      hasContext: ctx.turns.length > 0,
      lastIntent: ctx.lastIntent,
      activeEntities: ctx.activeEntities,
      recentTurns,
    };
  }

  // ── 私有辅助 ──────────────────────────────────────────────────

  private makeEmptyContext(): ConversationContext {
    const now = Date.now();
    return {
      tenantId: this.tenantId,
      userId: this.userId,
      state: 'idle',
      turns: [],
      activeEntities: [],
      lastIntent: null,
      createdAt: now,
      lastActiveAt: now,
    };
  }

  /**
   * 检测用户输入是否包含指代词或上下文关联词
   */
  private detectReference(input: string): boolean {
    return REFERENCE_PATTERNS.some((p) => p.test(input.trim()));
  }

  /**
   * 合并实体列表：新实体优先，相同 type+value 去重
   * 当同类型（如都是 sku_name）时，新实体覆盖旧实体
   */
  private mergeEntities(
    historical: ExtractedEntity[],
    current: ExtractedEntity[],
  ): ExtractedEntity[] {
    const result: ExtractedEntity[] = [...current];
    const currentTypes = new Set(current.map((e) => e.type));

    for (const h of historical) {
      // 若当前已有该类型实体，历史的不再补入（避免混乱）
      if (currentTypes.has(h.type)) continue;
      // 避免完全重复
      if (!result.some((e) => e.type === h.type && e.value === h.value)) {
        result.push(h);
      }
    }

    return result;
  }
}
