/**
 * QueueService — BullMQ 队列管理服务
 *
 * 职责：
 *   - 管理三个 BullMQ Queue 单例
 *   - 提供统一的 addJob / getJobStatus API
 *   - Redis 不可用时降级到同步 EventEmitter，确保业务不中断
 *
 * 降级策略：
 *   addJob() 调用 BullMQ 失败时捕获异常，打印 WARN 日志，
 *   然后通过内部 EventEmitter 同步 emit，保持与 Sprint 3 行为一致。
 */

import { Queue, JobsOptions, Job } from 'bullmq';
import { EventEmitter } from 'events';
import {
  BULLMQ_PREFIX,
  QUEUE_SHORTAGE_RECHECK,
  QUEUE_SUGGESTION_CALCULATE,
  QUEUE_NOTIFICATION_SEND,
  getBullMQConnectionOptions,
} from './queue.config';

// ─── Job Payload 类型定义 ────────────────────────────────────────────────────

/** 入库后缺料重检 Job Payload */
export interface ShortageRecheckJobData {
  tenantId: number;
  userId: number;
  skuId: number;
  receiptId: number;
  poId: number;
}

/** 每日调度建议计算 Job Payload */
export interface SuggestionCalculateJobData {
  triggeredAt: string;
  batchId?: number;
  tenantId?: number;
  userId?: number;
}

/** 通知发送 Job Payload */
export interface NotificationJobData {
  tenantId: number;
  userId: number;
  type: string;
  targetId: number;
  message: string;
}

/** 所有队列 Job Payload 的联合类型 */
export type AnyJobData = ShortageRecheckJobData | SuggestionCalculateJobData | NotificationJobData;

// ─── 已知队列名称类型 ────────────────────────────────────────────────────────

export type KnownQueueName =
  | typeof QUEUE_SHORTAGE_RECHECK
  | typeof QUEUE_SUGGESTION_CALCULATE
  | typeof QUEUE_NOTIFICATION_SEND;

// ─── QueueService ────────────────────────────────────────────────────────────

class QueueService {
  private static instance: QueueService;

  /** BullMQ Queue 实例映射 */
  private readonly queues: Map<string, Queue> = new Map();

  /** 降级用 EventEmitter（Redis 不可用时接管事件分发） */
  private readonly fallbackEmitter: EventEmitter = new EventEmitter();

  /** 标记 BullMQ 是否可用（初始化时检测，addJob 失败时重置） */
  private bullmqAvailable = true;

  private constructor() {
    this.fallbackEmitter.setMaxListeners(100);
    this.initQueues();
  }

  static getInstance(): QueueService {
    if (!QueueService.instance) {
      QueueService.instance = new QueueService();
    }
    return QueueService.instance;
  }

  /**
   * 初始化三个 BullMQ Queue 实例
   *
   * Queue 实例本身不建立连接，直到第一次 add() 调用时才真正连接 Redis，
   * 因此此处初始化不会因 Redis 不可用而抛出异常。
   */
  private initQueues(): void {
    const connection = getBullMQConnectionOptions();

    const queueNames: string[] = [
      QUEUE_SHORTAGE_RECHECK,
      QUEUE_SUGGESTION_CALCULATE,
      QUEUE_NOTIFICATION_SEND,
    ];

    for (const name of queueNames) {
      const queue = new Queue(name, {
        connection,
        prefix: BULLMQ_PREFIX,
        defaultJobOptions: {
          removeOnComplete: { count: 200 },
          removeOnFail: { count: 500 },
        },
      });

      queue.on('error', (err: Error) => {
        console.error(`[QueueService:${name}] Queue 错误:`, err.message);
      });

      this.queues.set(name, queue);
    }

    console.log('[QueueService] BullMQ 队列初始化完成，prefix=erp_bullmq');
  }

  /**
   * 向指定队列添加 Job
   *
   * 优先使用 BullMQ；若 Redis 不可用则降级到同步 EventEmitter，
   * 并打印 WARN 日志提示运维人员。
   *
   * @param queueName  目标队列名称（使用 QUEUE_* 常量）
   * @param data       Job Payload
   * @param options    BullMQ JobsOptions（可选，覆盖默认配置）
   * @returns          成功时返回 BullMQ Job 实例；降级时返回 null
   */
  async addJob(
    queueName: string,
    data: AnyJobData,
    options?: JobsOptions,
  ): Promise<Job | null> {
    const queue = this.queues.get(queueName);

    if (!queue) {
      console.error(`[QueueService] 未知队列名称: ${queueName}`);
      return null;
    }

    try {
      const job = await queue.add(queueName, data, options);
      return job;
    } catch (err) {
      // Redis 不可用时降级到 EventEmitter 同步处理
      console.warn(
        `[QueueService] BullMQ addJob 失败，降级到 EventEmitter 同步处理。队列: ${queueName}，原因:`,
        (err as Error).message,
      );
      this.bullmqAvailable = false;
      // 同步 emit，触发降级处理器（由 EventBusFacade 在 subscribe 时注册）
      this.fallbackEmitter.emit(queueName, data);
      return null;
    }
  }

  /**
   * 查询指定 Job 的状态
   *
   * @param queueName  目标队列名称
   * @param jobId      Job ID（BullMQ 返回的字符串 ID）
   * @returns          Job 实例，或 null（Job 不存在 / Redis 不可用）
   */
  async getJobStatus(queueName: string, jobId: string): Promise<Job | null> {
    const queue = this.queues.get(queueName);
    if (!queue) {
      console.error(`[QueueService] 未知队列名称: ${queueName}`);
      return null;
    }

    try {
      return (await queue.getJob(jobId)) ?? null;
    } catch (err) {
      console.error(
        `[QueueService] getJobStatus 失败。队列: ${queueName}，jobId: ${jobId}，原因:`,
        (err as Error).message,
      );
      return null;
    }
  }

  /**
   * 注册降级 EventEmitter 处理器
   *
   * 当 BullMQ 不可用时，addJob 会通过 fallbackEmitter.emit() 触发此处理器。
   * 由 EventBusFacade 在初始化时调用，保持与同步模式的行为一致。
   */
  onFallback(queueName: string, handler: (data: AnyJobData) => void | Promise<void>): void {
    this.fallbackEmitter.on(queueName, handler);
  }

  /**
   * 获取指定队列实例（供 Worker 初始化时使用）
   */
  getQueue(queueName: string): Queue | undefined {
    return this.queues.get(queueName);
  }

  /**
   * 当前 BullMQ 是否可用（供监控/健康检查使用）
   */
  isBullMQAvailable(): boolean {
    return this.bullmqAvailable;
  }

  /**
   * 优雅关闭所有队列连接
   *
   * 在进程退出时调用，确保正在处理的 Job 有机会完成。
   */
  async close(): Promise<void> {
    const closePromises = Array.from(this.queues.values()).map((q) =>
      q.close().catch((err) => {
        console.warn(`[QueueService] 关闭队列失败:`, (err as Error).message);
      }),
    );
    await Promise.all(closePromises);
    console.log('[QueueService] 所有 BullMQ 队列已关闭');
  }
}

export const queueService = QueueService.getInstance();
