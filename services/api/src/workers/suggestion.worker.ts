/**
 * BE-S4-11: SuggestionWorker — BullMQ 调度建议计算消费者
 *
 * 职责：
 *   消费 erp.schedule.suggestion-calculate 队列，
 *   调用 ScheduleSuggestionService.executeCalculation() 执行实际计算。
 *
 * 重试策略：
 *   - attempts: 3（最多重试 3 次）
 *   - backoff: fixed 30s（30 秒固定间隔重试）
 *   - 计算失败由 Service 层将 status 更新为 'failed'，Worker 层同步抛出保证 BullMQ 记录失败
 *
 * 并发策略：
 *   - concurrency: 1（调度建议计算为重量级操作，同一时刻仅允许一个任务执行，避免数据库竞争）
 *
 * 关闭策略：
 *   进程收到 SIGTERM / SIGINT 时调用 closeSuggestionWorker()，
 *   等待当前正在处理的 Job 完成后再退出（BullMQ 默认行为）。
 */

import { Worker, Job } from 'bullmq';
import {
  getBullMQConnectionOptions,
  BULLMQ_PREFIX,
  QUEUE_SUGGESTION_CALCULATE,
} from '../shared/queue.config';
import { ScheduleSuggestionService } from '../modules/schedule-suggestion/schedule-suggestion.service';

// ─── Job Payload 类型（扩展自 SuggestionCalculateJobData）──────────────────────

interface SuggestionCalculatePayload {
  /** 批次 ID（schedule_suggestions.id） */
  batchId: number;
  /** 租户 ID */
  tenantId: number;
  /** 触发时间（ISO 字符串，可选，用于日志追踪） */
  triggeredAt?: string;
}

// ─── Worker 实例 ─────────────────────────────────────────────────────────────

const suggestionWorker = new Worker<SuggestionCalculatePayload>(
  QUEUE_SUGGESTION_CALCULATE,
  async (job: Job<SuggestionCalculatePayload>) => {
    const { batchId, tenantId, triggeredAt } = job.data;

    console.log(
      `[SuggestionWorker] 开始处理 Job #${job.id}，` +
        `batchId=${batchId} tenantId=${tenantId}` +
        (triggeredAt ? ` triggeredAt=${triggeredAt}` : ''),
    );

    // 构造系统级上下文（Worker 属于异步后台任务，userId=0 表示系统操作）
    const service = new ScheduleSuggestionService({
      tenantId,
      userId: 0,
      roles: ['supervisor', 'boss'], // 系统级权限，可访问全量数据
    });

    // 执行计算（内部异常时 Service 层会将 status 更新为 failed，然后重抛）
    await service.executeCalculation(batchId, tenantId);

    console.log(`[SuggestionWorker] Job #${job.id} 执行完成，batchId=${batchId}`);
  },
  {
    connection: getBullMQConnectionOptions(),
    prefix: BULLMQ_PREFIX,
    // 调度建议计算属于重量级操作，同一时刻仅处理 1 个 Job
    concurrency: 1,
  },
);

// ─── 事件监听 ────────────────────────────────────────────────────────────────

suggestionWorker.on('completed', (job: Job) => {
  console.log(`[SuggestionWorker] Job #${job.id} 已成功完成`);
});

suggestionWorker.on('failed', (job: Job | undefined, err: Error) => {
  console.error(
    `[SuggestionWorker] Job #${job?.id ?? 'unknown'} 最终失败，` +
      `attemptsMade=${job?.attemptsMade}，原因: ${err.message}`,
    err.stack,
  );
  // 注意：status='failed' 已由 ScheduleSuggestionService.executeCalculation() 写入数据库，
  // 此处仅打印日志，无需重复更新。
});

suggestionWorker.on('error', (err: Error) => {
  console.error('[SuggestionWorker] Worker 连接错误:', err.message);
});

console.log(
  `[SuggestionWorker] 已启动，监听队列: ${QUEUE_SUGGESTION_CALCULATE}，prefix=${BULLMQ_PREFIX}`,
);

// ─── 优雅关闭 ────────────────────────────────────────────────────────────────

/**
 * 关闭 SuggestionWorker 连接
 * 由 index.ts 的进程退出钩子调用，确保正在处理的 Job 有机会完成。
 */
export async function closeSuggestionWorker(): Promise<void> {
  await suggestionWorker.close();
  console.log('[SuggestionWorker] 已关闭');
}

export { suggestionWorker };
