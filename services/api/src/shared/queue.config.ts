/**
 * BullMQ 连接配置
 *
 * 职责：
 *   - 提供 BullMQ Queue / Worker 使用的 IORedis 连接选项
 *   - 导出队列名称常量与 prefix 常量
 *
 * prefix 设计说明：
 *   - 现有 bull 包（shared/queue.ts）使用默认 prefix "bull:"，
 *     其 Redis Key 形如 bull:stock-alert-scan:...
 *   - BullMQ 统一使用 prefix "erp_bullmq"，Key 形如 erp_bullmq:erp.inventory.shortage-recheck:...
 *   - 两套 prefix 完全隔离，避免 Key 命名冲突，保证两个库可同进程共存。
 */

import type { ConnectionOptions } from 'bullmq';

// ─── prefix 常量（避免与 bull 包默认 prefix "bull:" 冲突）──────────────────────
export const BULLMQ_PREFIX = 'erp_bullmq';

// ─── 队列名称常量 ───────────────────────────────────────────────────────────────

/** 入库后缺料重检队列：采购收货确认后触发，重新评估涉及该 SKU 的工单缺料状态 */
export const QUEUE_SHORTAGE_RECHECK = 'erp.inventory.shortage-recheck';

/** 每日调度建议计算队列：每日 06:00 触发，全局生成采购建议 */
export const QUEUE_SUGGESTION_CALCULATE = 'erp.schedule.suggestion-calculate';

/** 通知发送队列：业务事件触发站内通知/消息推送 */
export const QUEUE_NOTIFICATION_SEND = 'erp.notification.send';

// ─── Redis 连接选项工厂 ─────────────────────────────────────────────────────────

/**
 * 获取 BullMQ 使用的 Redis 连接配置
 *
 * BullMQ 要求独立的 ioredis 连接实例（不能复用业务连接），
 * 此处通过工厂函数返回配置，由 BullMQ 内部自行创建连接。
 *
 * 参数与 config/redis.ts 的 getRedisClient() 保持一致，
 * 统一从环境变量读取，便于运维统一配置。
 *
 * 注意：maxRetriesPerRequest 必须设为 null，
 * 否则 BullMQ Worker 的 BRPOPLPUSH 阻塞命令会被 ioredis 提前超时。
 */
export function getBullMQConnectionOptions(): ConnectionOptions {
  return {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: Number(process.env.REDIS_PORT ?? 6379),
    password: process.env.REDIS_PASSWORD ?? undefined,
    db: Number(process.env.REDIS_DB ?? 0),
    // BullMQ 内部使用长连接阻塞命令（BLPOP 等），必须禁用单次命令重试限制
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  };
}
