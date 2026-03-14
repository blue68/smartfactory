/**
 * NotificationWorker — BullMQ 通知发送消费者
 *
 * 职责：
 *   消费 erp.notification.send 队列，执行站内通知/消息推送。
 *
 * MVP 阶段：
 *   仅打印通知内容到日志，不对接真实推送渠道（钉钉/邮件等）。
 *   后续迭代替换 processor 函数体即可，不需要修改 Worker 配置。
 *
 * 重试策略：
 *   attempts 3 + 固定 10s 间隔由 EventBusFacade 入队时配置，
 *   Worker 层仅声明 concurrency。
 *
 * 关闭策略：
 *   进程收到 SIGTERM / SIGINT 时调用 closeNotificationWorker()，
 *   等待当前正在处理的 Job 完成后退出。
 */

import { Worker, Job } from 'bullmq';
import { getBullMQConnectionOptions, BULLMQ_PREFIX, QUEUE_NOTIFICATION_SEND } from '../shared/queue.config';
import { NotificationJobData } from '../shared/queue-service';

// ─── Worker 实例 ─────────────────────────────────────────────────────────────

const notificationWorker = new Worker<NotificationJobData>(
  QUEUE_NOTIFICATION_SEND,
  async (job: Job<NotificationJobData>) => {
    const { tenantId, userId, type, targetId, message } = job.data;

    // MVP：只打日志，不对接真实推送渠道
    console.log(
      `[NotificationWorker] 发送通知 Job #${job.id}：` +
      `tenantId=${tenantId} userId=${userId} type=${type} targetId=${targetId}`,
    );
    // FIND-S4-003 fix: 不输出完整 message 到日志，避免敏感数据泄露
    console.log(`[NotificationWorker] 通知内容长度: ${message?.length ?? 0} 字符`);

    // TODO（下一迭代）：对接钉钉 Webhook / 邮件 / 站内消息表
  },
  {
    connection: getBullMQConnectionOptions(),
    prefix: BULLMQ_PREFIX,
    // 通知发送为轻量 I/O，允许更高并发
    concurrency: 5,
  },
);

// ─── 事件监听 ────────────────────────────────────────────────────────────────

notificationWorker.on('completed', (job: Job) => {
  console.log(`[NotificationWorker] Job #${job.id} 已成功完成`);
});

notificationWorker.on('failed', (job: Job | undefined, err: Error) => {
  console.error(
    `[NotificationWorker] Job #${job?.id ?? 'unknown'} 最终失败，` +
    `attemptsMade=${job?.attemptsMade}，原因: ${err.message}`,
    err.stack,
  );
});

notificationWorker.on('error', (err: Error) => {
  console.error('[NotificationWorker] Worker 连接错误:', err.message);
});

console.log(
  `[NotificationWorker] 已启动，监听队列: ${QUEUE_NOTIFICATION_SEND}，prefix=${BULLMQ_PREFIX}`,
);

// ─── 优雅关闭 ────────────────────────────────────────────────────────────────

/**
 * 关闭 NotificationWorker 连接
 * 由 index.ts 的进程退出钩子调用。
 */
export async function closeNotificationWorker(): Promise<void> {
  await notificationWorker.close();
  console.log('[NotificationWorker] 已关闭');
}

export { notificationWorker };
