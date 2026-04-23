/**
 * [artifact:API接口代码] — 统一单号生成器
 * 使用 Redis INCR 原子递增，避免并发竞态
 */

import { getRedisClient } from '../config/redis';

const PREFIX_MAP: Record<string, string> = {
  purchase_order: 'PO',
  sales_order: 'SO',
  work_order: 'WO',
  suggestion: 'SG',
  inspection: 'QC',
  delivery_note: 'DN',
  receipt: 'RC',
  transaction: 'TX',
  // Sprint 3 新增
  incoming_inspection: 'IQC',
  return_order: 'RTN',
  settlement: 'ST',
  purchase_settlement: 'PST',
  bom_snapshot: 'SNAP',
  // Sprint 4 新增
  schedule_batch: 'SCH',
  production_batch: 'JB',
  // 2026-04-13 扩展
  consumable_issue: 'CI',
  asset_card: 'FA',
  asset_movement: 'AM',
};

/**
 * 生成业务单号
 * 格式: {PREFIX}{YYMMDD}{5位序号}，例如 PO250311-00001
 * @param type 业务类型 key（对应 PREFIX_MAP）
 * @param tenantId 租户 ID（隔离计数器）
 */
export async function generateNo(type: keyof typeof PREFIX_MAP, tenantId: number): Promise<string> {
  const prefix = PREFIX_MAP[type] ?? type.toUpperCase().slice(0, 2);
  const today = new Date();
  const dateStr = [
    String(today.getFullYear()).slice(2),
    String(today.getMonth() + 1).padStart(2, '0'),
    String(today.getDate()).padStart(2, '0'),
  ].join('');

  const redisKey = `no:${tenantId}:${type}:${dateStr}`;
  try {
    const redis = getRedisClient();
    const seq = await redis.incr(redisKey);

    // 首次创建时设置 48 小时过期（跨日安全）
    if (seq === 1) {
      await redis.expire(redisKey, 48 * 3600);
    }

    return `${prefix}${dateStr}-${String(seq).padStart(5, '0')}`;
  } catch (err) {
    // Redis 短暂抖动时退化为时间戳+随机数，保证业务不中断。
    const fallbackSeq = `${String(Date.now()).slice(-5)}${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`;
    console.warn(
      `[generateNo] Redis unavailable, fallback sequence used for ${type}: ${(err as Error).message}`,
    );
    return `${prefix}${dateStr}-${fallbackSeq}`;
  }
}
