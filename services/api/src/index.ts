import 'reflect-metadata';
import { initDatabase } from './config/database';
import { getRedisClient } from './config/redis';
import app from './app';

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

    // 2. 预热 Redis 连接（等待 ready 事件后再 ping）
    const redis = getRedisClient();
    if (redis.status !== 'ready') {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Redis 连接超时')), 10000);
        redis.once('ready', () => { clearTimeout(timeout); resolve(); });
        redis.once('error', (err) => { clearTimeout(timeout); reject(err); });
      });
    }
    await redis.ping();
    console.log('[Redis] 连接就绪');

    // 3. 启动 HTTP 服务
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

// 优雅退出
process.on('SIGTERM', () => {
  console.log('[API] 收到 SIGTERM，正在优雅退出...');
  process.exit(0);
});
process.on('SIGINT', () => {
  console.log('[API] 收到 SIGINT，正在优雅退出...');
  process.exit(0);
});

bootstrap();
