/**
 * Bull 队列初始化工具
 *
 * 职责：
 *   - 提供 Bull 队列单例工厂（复用已有 Redis 配置）
 *   - 注册安全库存扫描定时任务（cron 每小时整点）
 *   - 队列名称: stock-alert-scan
 *
 * 设计约束：
 *   - Bull 内部自行管理两个独立的 ioredis 连接（client + subscriber），
 *     不能复用同一个 ioredis 实例，因此通过 createClient 工厂传入连接参数。
 *   - 生产者（trigger 接口）与 worker（processor）共用同一 queue 实例。
 */

import Bull from 'bull';

// ─── 队列常量 ─────────────────────────────────────────────────────────────────

export const STOCK_ALERT_QUEUE_NAME = 'stock-alert-scan';

/**
 * cron 表达式：每小时整点执行（0 分 0 秒）
 * Bull 使用 node-cron 语法（5 字段，秒级精度可选）
 */
const STOCK_ALERT_CRON = '0 * * * *';

/** 重复任务去重 ID，避免 restart 后产生多个重复调度 */
const STOCK_ALERT_JOB_ID = 'stock-alert-hourly';

// ─── Redis 连接配置（从环境变量读取，与 config/redis.ts 保持一致）────────────

function buildRedisConnectionOptions() {
  return {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: Number(process.env.REDIS_PORT ?? 6379),
    password: process.env.REDIS_PASSWORD ?? undefined,
    db: Number(process.env.REDIS_DB ?? 0),
    // Bull 的连接不设 commandTimeout，避免长轮询被提前断开
    maxRetriesPerRequest: null as unknown as number,
    enableReadyCheck: false,
    connectTimeout: 5000,
    retryStrategy: (times: number) => {
      if (times > 20) return null;
      return Math.min(times * 250, 5000);
    },
  };
}

// ─── 队列单例 ─────────────────────────────────────────────────────────────────

let stockAlertQueue: Bull.Queue | null = null;

/**
 * 获取安全库存预警 Bull 队列单例
 *
 * Bull 内部需要两个独立 Redis 连接（client / subscriber），
 * 通过 createClient 工厂函数注入，保证连接参数与项目 Redis 配置一致。
 */
export function getStockAlertQueue(): Bull.Queue {
  if (!stockAlertQueue) {
    const redisOpts = buildRedisConnectionOptions();

    stockAlertQueue = new Bull(STOCK_ALERT_QUEUE_NAME, {
      createClient: (type) => {
        // Bull 要求 subscriber 连接独立；其余类型共享配置即可
        const opts = type === 'subscriber'
          ? { ...redisOpts, enableReadyCheck: false }
          : redisOpts;

        // 动态 import ioredis 保持与项目一致
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const Redis = require('ioredis');
        return new Redis(opts);
      },
      defaultJobOptions: {
        removeOnComplete: 100,  // 保留最近 100 条成功记录，便于排查
        removeOnFail: 200,      // 保留最近 200 条失败记录
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 10_000,        // 失败后 10s / 20s / 40s 重试
        },
      },
    });

    stockAlertQueue.on('error', (err) => {
      console.error(`[Queue:${STOCK_ALERT_QUEUE_NAME}] 队列错误:`, err.message);
    });

    stockAlertQueue.on('failed', (job, err) => {
      console.error(
        `[Queue:${STOCK_ALERT_QUEUE_NAME}] Job #${job.id} 失败 (attempt ${job.attemptsMade}):`,
        err.message,
      );
    });

    stockAlertQueue.on('completed', (job) => {
      console.log(`[Queue:${STOCK_ALERT_QUEUE_NAME}] Job #${job.id} 完成`);
    });

    console.log(`[Queue:${STOCK_ALERT_QUEUE_NAME}] 队列初始化完成`);
  }

  return stockAlertQueue;
}

// ─── 定时调度注册 ─────────────────────────────────────────────────────────────

/**
 * 注册安全库存扫描 cron 重复任务
 *
 * 幂等：Bull 的 repeat jobId 保证同一 jobId 在 Redis 中唯一，
 * 重启服务不会产生重复调度。
 *
 * 调用位置：services/api/src/index.ts 启动完成后调用一次。
 */
export async function initStockAlertScheduler(): Promise<void> {
  const queue = getStockAlertQueue();

  // 注册 processor 在调用方（index.ts）完成，此处只负责添加 cron job
  await queue.add(
    {},
    {
      repeat: { cron: STOCK_ALERT_CRON },
      jobId: STOCK_ALERT_JOB_ID,
    },
  );

  console.log(
    `[Queue:${STOCK_ALERT_QUEUE_NAME}] 定时任务已注册，cron=${STOCK_ALERT_CRON}`,
  );
}

/**
 * 手动触发一次安全库存扫描（非 cron，立即入队）
 *
 * 供 POST /api/inventory/stock-alert/trigger 接口调用。
 * 返回 Bull Job id，供前端展示或轮询状态。
 */
export async function triggerStockAlertScan(): Promise<string | number> {
  const queue = getStockAlertQueue();
  const job = await queue.add({ triggeredManually: true }, { priority: 1 });
  console.log(`[Queue:${STOCK_ALERT_QUEUE_NAME}] 手动触发 Job #${job.id}`);
  return job.id;
}
