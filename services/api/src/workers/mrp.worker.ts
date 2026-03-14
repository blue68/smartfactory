/**
 * MrpWorker — BullMQ 缺料重检消费者
 *
 * 职责：
 *   消费 erp.inventory.shortage-recheck 队列，
 *   在采购收货确认后，重新评估所有涉及该 SKU 的生产工单缺料状态。
 *
 * 重试策略：
 *   attempts 3 + 指数退避（10s / 20s / 40s）由 EventBusFacade 入队时配置，
 *   Worker 层无需重复设置 delay，仅需声明 concurrency。
 *
 * 关闭策略：
 *   进程收到 SIGTERM / SIGINT 时调用 worker.close()，
 *   等待当前正在处理的 Job 完成后再退出（BullMQ 默认行为）。
 */

import { Worker, Job } from 'bullmq';
import { getBullMQConnectionOptions, BULLMQ_PREFIX, QUEUE_SHORTAGE_RECHECK } from '../shared/queue.config';
import { ShortageRecheckJobData } from '../shared/queue-service';
import { MrpService } from '../modules/mrp/mrp.service';

// ─── Worker 实例 ─────────────────────────────────────────────────────────────

const mrpWorker = new Worker<ShortageRecheckJobData>(
  QUEUE_SHORTAGE_RECHECK,
  async (job: Job<ShortageRecheckJobData>) => {
    const { tenantId, userId, skuId, receiptId, poId } = job.data;

    console.log(
      `[MrpWorker] 开始处理 Job #${job.id}，` +
      `tenantId=${tenantId} skuId=${skuId} receiptId=${receiptId} poId=${poId}`,
    );

    // 构造租户上下文，实例化 MrpService
    const mrpService = new MrpService({ tenantId, userId });

    // 重新评估涉及该 SKU 的所有生产工单缺料状态
    const result = await mrpService.reevaluateAfterReceipt(skuId);

    console.log(
      `[MrpWorker] Job #${job.id} 完成，` +
      `受影响工单数=${result.affectedOrderIds.length}，` +
      `更新需求行数=${result.updatedRequirements}`,
    );
  },
  {
    connection: getBullMQConnectionOptions(),
    prefix: BULLMQ_PREFIX,
    // 同时最多并发处理 3 个 Job，避免数据库连接压力过大
    concurrency: 3,
  },
);

// ─── 事件监听 ────────────────────────────────────────────────────────────────

mrpWorker.on('completed', (job: Job) => {
  console.log(`[MrpWorker] Job #${job.id} 已成功完成`);
});

mrpWorker.on('failed', (job: Job | undefined, err: Error) => {
  console.error(
    `[MrpWorker] Job #${job?.id ?? 'unknown'} 最终失败，` +
    `attemptsMade=${job?.attemptsMade}，原因: ${err.message}`,
    err.stack,
  );
});

mrpWorker.on('error', (err: Error) => {
  console.error('[MrpWorker] Worker 连接错误:', err.message);
});

console.log(
  `[MrpWorker] 已启动，监听队列: ${QUEUE_SHORTAGE_RECHECK}，prefix=${BULLMQ_PREFIX}`,
);

// ─── 优雅关闭 ────────────────────────────────────────────────────────────────

/**
 * 关闭 MrpWorker 连接
 * 由 index.ts 的进程退出钩子调用，确保正在处理的 Job 有机会完成。
 */
export async function closeMrpWorker(): Promise<void> {
  await mrpWorker.close();
  console.log('[MrpWorker] 已关闭');
}

export { mrpWorker };
