import Redis from 'ioredis';

let redisClient: Redis | null = null;

/**
 * 获取 Redis 单例客户端
 *
 * 高可用配置说明：
 * - retryStrategy: 指数退避重连，最大 5s 间隔，避免雪崩
 * - maxRetriesPerRequest: 单次命令最多重试 2 次后立即 reject，防止请求长时间阻塞
 * - connectTimeout: 连接超时 5s
 * - commandTimeout: 命令执行超时 3s，超时后命令 reject，业务层可捕获降级
 * - enableOfflineQueue: false，Redis 断线期间命令立即 reject 而非排队等待，配合业务降级
 */
export function getRedisClient(): Redis {
  if (!redisClient) {
    redisClient = new Redis({
      host: process.env.REDIS_HOST ?? 'localhost',
      port: Number(process.env.REDIS_PORT ?? 6379),
      password: process.env.REDIS_PASSWORD ?? undefined,
      db: Number(process.env.REDIS_DB ?? 0),
      retryStrategy: (times) => {
        if (times > 20) {
          // 超过重试上限，停止重连，由健康检查恢复
          console.error('[Redis] 重连次数超过上限，停止重试');
          return null;
        }
        return Math.min(times * 200, 5000);
      },
      maxRetriesPerRequest: 2,
      connectTimeout: 5000,
      commandTimeout: 3000,
      // 断线期间命令立即 reject，业务层捕获后可降级到 DB
      enableOfflineQueue: false,
      lazyConnect: false,
    });

    redisClient.on('connect', () => console.log('[Redis] 连接成功'));
    redisClient.on('ready', () => console.log('[Redis] 就绪，可接受命令'));
    redisClient.on('error', (err) => console.error('[Redis] 连接错误:', err.message));
    redisClient.on('close', () => console.warn('[Redis] 连接关闭，等待重连'));
    redisClient.on('reconnecting', (delay: number) =>
      console.warn(`[Redis] 重连中，${delay}ms 后重试`),
    );
  }
  return redisClient;
}

/**
 * 检测 Redis 是否可用（用于业务层降级判断）
 */
export async function isRedisAvailable(): Promise<boolean> {
  try {
    const result = await getRedisClient().ping();
    return result === 'PONG';
  } catch {
    return false;
  }
}

/**
 * Redis Key 命名规范（集中管理，防止 Key 散落各处）
 */
export const RedisKeys = {
  inventoryLock: (tenantId: number, skuId: number) =>
    `lock:inventory:${tenantId}:${skuId}`,
  inventorySnapshot: (tenantId: number, skuId: number) =>
    `inventory:${tenantId}:${skuId}`,
  skuList: (tenantId: number) =>
    `sku:${tenantId}`,
  bomExpanded: (tenantId: number, bomId: number, version: string) =>
    `bom:${tenantId}:${bomId}:${version}`,
  userSession: (token: string) =>
    `session:${token}`,
  aiSuggestion: (requestId: string) =>
    `ai_suggestion:${requestId}`,
  schedule: (tenantId: number, date: string, batchId?: number | null) =>
    batchId ? `schedule:${tenantId}:${date}:batch:${batchId}` : `schedule:${tenantId}:${date}`,
  schedulePattern: (tenantId: number, date: string) =>
    `schedule:${tenantId}:${date}*`,
  alertSent: (tenantId: number, skuId: number, date: string) =>
    `alert_sent:${tenantId}:${skuId}:${date}`,
  /**
   * SEC-004: Refresh Token 吊销
   * key: rt:{jti}  value: {userId}:{tenantId}
   */
  refreshToken: (jti: string) => `rt:${jti}`,
  /**
   * SEC-004: 用户级 Refresh Token 反向索引（Redis Set）
   * key: rt:user:{tenantId}:{userId}
   * members: 该用户当前所有活跃 jti
   * 用于密码修改等场景批量吊销该用户全部 Refresh Token
   */
  userRefreshTokenSet: (tenantId: number, userId: number) =>
    `rt:user:${tenantId}:${userId}`,
  inventoryWarehouseMetric: (
    tenantId: number,
    date: string,
    metric: 'missing_param_requests' | 'invalid_location_requests' | 'default_location_fallback_writes',
    sourceRef: string,
  ) => `metrics:inv_wh:${tenantId}:${date}:${metric}:${sourceRef}`,
} as const;

/**
 * TTL 常量（秒）
 */
export const RedisTTL = {
  INVENTORY: 60,
  SKU_LIST: 300,
  BOM_EXPANDED: 1800,
  USER_SESSION: 7 * 24 * 3600,
  AI_SUGGESTION: 600,
  SCHEDULE: 12 * 3600,
  ALERT_SENT: 24 * 3600,
  LOCK: 5,
  /** SEC-004: Refresh Token 有效期，与 JWT 签发时保持一致：7 天 */
  REFRESH_TOKEN: 7 * 24 * 3600,
  /** 仓库/库位治理指标（日维度） */
  METRICS_DAILY: 45 * 24 * 3600,
} as const;

/**
 * 分布式锁：获取锁
 *
 * 使用 SET NX PX 原子操作。
 * 返回 lockValue（用于释放时验证所有权）；
 * 若锁已被占用返回 null（由调用方决定是否降级）；
 * 若 Redis 不可用抛出带 cause 标记的错误，调用方可据此降级到 DB 行锁。
 */
export async function acquireLock(
  key: string,
  ttlMs = RedisTTL.LOCK * 1000,
): Promise<string | null> {
  const redis = getRedisClient();
  const lockValue = `${Date.now()}_${Math.random()}`;
  const result = await redis.set(key, lockValue, 'PX', ttlMs, 'NX');
  if (result !== 'OK') {
    // 锁被其他进程持有，返回 null，由业务层决策
    return null;
  }
  return lockValue;
}

/**
 * 释放锁（Lua 脚本保证原子性）
 *
 * 释放失败（Redis 不可用或锁已过期）时只记录警告，不抛出异常，
 * 避免 finally 块中的释放失败掩盖原始业务错误。
 */
export async function releaseLock(key: string, lockValue: string): Promise<void> {
  const redis = getRedisClient();
  const script = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
      return redis.call("del", KEYS[1])
    else
      return 0
    end
  `;
  try {
    await redis.eval(script, 1, key, lockValue);
  } catch (err) {
    // 释放锁失败不影响业务结果，锁的 TTL 到期后会自动释放
    console.warn('[Redis] 释放锁失败（TTL 到期后自动释放）:', (err as Error).message);
  }
}
