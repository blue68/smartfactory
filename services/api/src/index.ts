import 'reflect-metadata';
import { initDatabase } from './config/database';
import { getRedisClient } from './config/redis';
import app from './app';
// Sprint 4：BullMQ Worker（import 即在同进程内启动消费者）
import { closeMrpWorker } from './workers/mrp.worker';
import { closeNotificationWorker } from './workers/notification.worker';
import { closeSuggestionWorker } from './workers/suggestion.worker';
import { queueService } from './shared/queue-service';
import { QUEUE_SUGGESTION_CALCULATE } from './shared/queue.config';
import type { SuggestionCalculateJobData } from './shared/queue-service';

const PORT = Number(process.env.PORT ?? 3000);

async function bootstrap(): Promise<void> {
  try {
    // 0. 安全校验：生产环境强制检查 JWT_SECRET
    const jwtSecret = process.env.JWT_SECRET;
    if (process.env.NODE_ENV === 'production') {
      if (!jwtSecret || jwtSecret === 'change-me-in-production' || jwtSecret.length < 32) {
        console.error('[Security] JWT_SECRET 未配置或长度不足 32 位，拒绝启动。');
        console.error('[Security] 请在 .env 中设置强密钥：openssl rand -base64 48');
        process.exit(1);
      }
    } else if (!jwtSecret || jwtSecret === 'change-me-in-production') {
      console.warn('[Security] 警告：JWT_SECRET 使用默认值，请勿在生产环境使用！');
    }

    // 1. 初始化数据库连接（带重试）
    await initDatabase();

    // 2. 预热 Redis 连接（允许降级）
    let redisReady = false;
    try {
      const redis = getRedisClient();
      if (redis.status !== 'ready') {
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Redis 连接超时')), 10000);
          redis.once('ready', () => { clearTimeout(timeout); resolve(); });
          redis.once('error', (err) => { clearTimeout(timeout); reject(err); });
        });
      }
      await redis.ping();
      redisReady = true;
      console.log('[Redis] 连接就绪');
    } catch (redisErr) {
      console.warn(
        '[Bootstrap] Redis 预热失败，API 将以降级模式启动:',
        (redisErr as Error).message,
      );
    }

    // 3. 注册每日 06:00 采购建议计算 cron job（BullMQ repeat job）
    //    BullMQ 使用 cron 表达式，repeat job 在 Queue 层维护，不依赖进程常驻定时器。
    //    第一次注册后 Redis 会持久化调度计划，进程重启后自动恢复。
    if (redisReady) {
      try {
        const jobData: SuggestionCalculateJobData = {
          triggeredAt: new Date().toISOString(),
        };
        await queueService.addJob(
          QUEUE_SUGGESTION_CALCULATE,
          jobData,
          {
            repeat: {
              // 每天 06:00（服务器本地时间）
              pattern: '0 6 * * *',
            },
            jobId: 'daily-suggestion-calculate',
            attempts: 3,
            backoff: {
              type: 'exponential',
              delay: 60_000,
            },
          },
        );
        console.log('[Bootstrap] 每日采购建议计算 cron job 已注册（每天 06:00）');
      } catch (cronErr) {
        // cron 注册失败不影响主服务启动，仅告警
        console.warn('[Bootstrap] cron job 注册失败（Redis 不可用？）:', (cronErr as Error).message);
      }
    } else {
      console.warn('[Bootstrap] 跳过 cron job 注册：Redis 当前不可用');
    }

    // 4. 启动 HTTP 服务
    app.listen(PORT, () => {
      console.log(`[API] 智造管家 API 服务已启动，监听端口 ${PORT}`);
      console.log(`[API] 环境：${process.env.NODE_ENV ?? 'development'}`);
      console.log(`[API] 健康检查：http://localhost:${PORT}/health`);
    });
  } catch (err) {
    console.error('[Bootstrap] 服务启动失败：', err);
    process.exit(1);
  }
}

// ─── 优雅退出 ────────────────────────────────────────────────────────────────
// 收到终止信号时：先等待 BullMQ Worker 完成当前 Job，再关闭 Queue 连接，最后退出进程。
// 最长等待时间由 BullMQ Worker.close() 的 force 参数控制（默认等待当前 Job 完成）。
async function gracefulShutdown(signal: string): Promise<void> {
  console.log(`[API] 收到 ${signal}，正在优雅退出...`);
  try {
    // 并行关闭所有 Worker（等待当前正在处理的 Job 完成）
    // CR-S4-002 fix: 补充 SuggestionWorker 优雅退出
    await Promise.all([
      closeMrpWorker(),
      closeNotificationWorker(),
      closeSuggestionWorker(),
    ]);
    // 关闭 BullMQ Queue 连接
    await queueService.close();
  } catch (err) {
    console.warn('[API] 优雅退出过程中出现错误:', (err as Error).message);
  }
  process.exit(0);
}

process.on('SIGTERM', () => { void gracefulShutdown('SIGTERM'); });
process.on('SIGINT',  () => { void gracefulShutdown('SIGINT'); });

bootstrap();
