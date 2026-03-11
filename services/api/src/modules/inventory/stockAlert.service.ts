/**
 * 安全库存预警服务 (BE-P2-010)
 *
 * 职责：
 *   1. 扫描所有活跃租户，找出可用库存低于安全库存的 SKU
 *   2. 按预警级别（error / warning）写入 ai_suggestions 表
 *   3. 利用 Redis key 实现 24 小时同 SKU 去重，避免重复打扰
 *   4. 作为 Bull 队列 processor 被调度，同时支持手动触发
 *
 * 预警级别规则：
 *   - available = 0          → level='error'，  title 含"库存耗尽"
 *   - 0 < available < safety → level='warning'，title 含"库存不足"
 *
 * 去重策略：
 *   Redis Key: alert_sent:{tenantId}:{skuId}:{YYYY-MM-DD}
 *   TTL: 24h（复用 RedisTTL.ALERT_SENT = 86400）
 *
 * 安全设计：
 *   - 全部使用参数化查询（AppDataSource.query），防止 SQL 注入
 *   - 单租户扫描失败不中断其他租户（catch 后继续循环）
 *   - dedup_key = SHA-256(stock_alert:{tenantId}:{skuId}:{date}) 前16字符
 */

import crypto from 'crypto';
import { AppDataSource } from '../../config/database';
import { getRedisClient, RedisKeys, RedisTTL } from '../../config/redis';
import { getStockAlertQueue } from '../../shared/queue';
import type Bull from 'bull';

// ─── 内部类型 ─────────────────────────────────────────────────────────────────

interface LowStockSku {
  skuId: number;
  skuCode: string;
  skuName: string;
  available: string;   // DECIMAL 在 mysql2 中以 string 返回
  safetyStock: string;
  stockUnit: string;
}

interface ActiveTenant {
  tenant_id: number;
}

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

/**
 * 生成 ai_suggestions.dedup_key
 * 格式：SHA-256(stock_alert:{tenantId}:{skuId}:{date}) 前16字符
 */
function buildDedupKey(tenantId: number, skuId: number, date: string): string {
  const raw = `stock_alert:${tenantId}:${skuId}:${date}`;
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

/**
 * 返回北京时间 YYYY-MM-DD 字符串（用于去重 key 和 Redis key）
 */
function todayStr(): string {
  return new Date().toLocaleDateString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).replace(/\//g, '-');
}

// ─── 核心服务 ─────────────────────────────────────────────────────────────────

export class StockAlertService {
  private readonly redis = getRedisClient();

  /**
   * Bull processor 入口
   * 由队列调度或手动触发时执行
   */
  async process(_job: Bull.Job): Promise<{ scanned: number; alerted: number }> {
    console.log('[StockAlert] 开始扫描所有租户安全库存...');
    return this.scanAllTenants();
  }

  /**
   * 扫描所有活跃租户（顶层入口，供外部直接调用或 processor 使用）
   */
  async scanAllTenants(): Promise<{ scanned: number; alerted: number }> {
    const tenants = await this.fetchActiveTenants();
    console.log(`[StockAlert] 活跃租户数: ${tenants.length}`);

    let totalScanned = 0;
    let totalAlerted = 0;

    for (const { tenant_id } of tenants) {
      try {
        const { scanned, alerted } = await this.scanTenant(tenant_id);
        totalScanned += scanned;
        totalAlerted += alerted;
      } catch (err) {
        // 单租户失败不影响其他租户
        console.error(`[StockAlert] 租户 ${tenant_id} 扫描失败:`, (err as Error).message);
      }
    }

    console.log(
      `[StockAlert] 扫描完成 — 检查 SKU: ${totalScanned}，新增预警: ${totalAlerted}`,
    );
    return { scanned: totalScanned, alerted: totalAlerted };
  }

  // ─── 私有方法 ───────────────────────────────────────────────────────────────

  /**
   * 查询所有活跃租户
   * 通过 tenants 表的 status 字段过滤，避免扫描已停用租户
   */
  private async fetchActiveTenants(): Promise<ActiveTenant[]> {
    const rows = await AppDataSource.query<ActiveTenant[]>(
      `SELECT tenant_id FROM tenants WHERE status = 'active'`,
    );
    return rows;
  }

  /**
   * 扫描单个租户的安全库存预警
   *
   * 查询逻辑：
   *   (inventory.qty_on_hand - inventory.qty_reserved) < skus.safety_stock
   *   AND skus.safety_stock > 0（未设安全库存的 SKU 不预警）
   */
  private async scanTenant(
    tenantId: number,
  ): Promise<{ scanned: number; alerted: number }> {
    const rows = await this.queryLowStockSkus(tenantId);
    const date = todayStr();
    let alerted = 0;

    for (const sku of rows) {
      const deduped = await this.isDuplicated(tenantId, sku.skuId, date);
      if (deduped) continue;

      await this.writeAlert(tenantId, sku, date);
      await this.markAlertSent(tenantId, sku.skuId, date);
      alerted++;
    }

    return { scanned: rows.length, alerted };
  }

  /**
   * 查询低于安全库存的 SKU（参数化查询）
   *
   * qty_available = qty_on_hand - qty_reserved
   * 仅查询已启用、且设置了安全库存的 SKU
   */
  private async queryLowStockSkus(tenantId: number): Promise<LowStockSku[]> {
    const sql = `
      SELECT
        s.id            AS skuId,
        s.sku_code      AS skuCode,
        s.name          AS skuName,
        COALESCE(b.qty_on_hand - b.qty_reserved, 0) AS available,
        s.safety_stock  AS safetyStock,
        s.stock_unit    AS stockUnit
      FROM skus s
      LEFT JOIN inventory b
        ON b.sku_id = s.id AND b.tenant_id = s.tenant_id
      WHERE s.tenant_id = ?
        AND s.status = 'active'
        AND s.safety_stock > 0
        AND COALESCE(b.qty_on_hand - b.qty_reserved, 0) < s.safety_stock
      ORDER BY s.id
    `;
    return AppDataSource.query<LowStockSku[]>(sql, [tenantId]);
  }

  /**
   * 检查 Redis 中是否已在今日发送过该 SKU 的预警
   */
  private async isDuplicated(
    tenantId: number,
    skuId: number,
    date: string,
  ): Promise<boolean> {
    try {
      const key = RedisKeys.alertSent(tenantId, skuId, date);
      const val = await this.redis.get(key);
      return val !== null;
    } catch (err) {
      // Redis 不可用时降级：允许写入（宁可重复，不遗漏）
      console.warn('[StockAlert] Redis 去重检查失败，降级允许写入:', (err as Error).message);
      return false;
    }
  }

  /**
   * 向 ai_suggestions 写入预警记录（INSERT IGNORE 幂等保护）
   *
   * dedup_key + tenant_id 联合唯一（通过 idx_tenant_dedup 索引保证唯一性），
   * INSERT IGNORE 在 DB 层面兜底防重，配合 Redis 去重双保险。
   */
  private async writeAlert(
    tenantId: number,
    sku: LowStockSku,
    date: string,
  ): Promise<void> {
    const available = parseFloat(sku.available);
    const safetyStock = parseFloat(sku.safetyStock);

    const level: 'error' | 'warning' = available === 0 ? 'error' : 'warning';
    const title =
      available === 0
        ? `库存耗尽 — ${sku.skuName}（${sku.skuCode}）`
        : `库存不足 — ${sku.skuName}（${sku.skuCode}）`;

    const summary =
      available === 0
        ? `SKU【${sku.skuCode} ${sku.skuName}】可用库存已耗尽，请尽快补货。`
        : `SKU【${sku.skuCode} ${sku.skuName}】可用库存 ${available} ${sku.stockUnit}，` +
          `低于安全库存 ${safetyStock} ${sku.stockUnit}，建议及时补货。`;

    const relatedData = JSON.stringify({
      skuId: sku.skuId,
      skuCode: sku.skuCode,
      skuName: sku.skuName,
      available,
      safetyStock,
      unit: sku.stockUnit,
      alertDate: date,
    });

    const dedupKey = buildDedupKey(tenantId, sku.skuId, date);

    const sql = `
      INSERT IGNORE INTO ai_suggestions
        (tenant_id, type, title, summary, level, status, related_data, dedup_key, created_by)
      VALUES
        (?, 'stock_alert', ?, ?, ?, 'unread', ?, ?, 0)
    `;
    await AppDataSource.query(sql, [
      tenantId,
      title,
      summary,
      level,
      relatedData,
      dedupKey,
    ]);

    console.log(
      `[StockAlert] 租户 ${tenantId} SKU ${sku.skuCode} 写入预警 [${level}] dedup=${dedupKey}`,
    );
  }

  /**
   * 在 Redis 中标记该 SKU 今日已发送预警，TTL 24h
   */
  private async markAlertSent(
    tenantId: number,
    skuId: number,
    date: string,
  ): Promise<void> {
    try {
      const key = RedisKeys.alertSent(tenantId, skuId, date);
      await this.redis.set(key, '1', 'EX', RedisTTL.ALERT_SENT);
    } catch (err) {
      // Redis 写入失败不影响主流程，下次扫描可能重复写 DB（INSERT IGNORE 兜底）
      console.warn('[StockAlert] Redis 标记失败:', (err as Error).message);
    }
  }
}

// ─── 队列 Processor 注册 ─────────────────────────────────────────────────────

const stockAlertService = new StockAlertService();

/**
 * 将 StockAlertService.process 注册为 Bull 队列 processor
 *
 * 并发度设为 1：库存扫描为 I/O 密集型，单实例单并发即可；
 * 多实例部署时 Bull 自动分布式协调，不会重复执行同一 Job。
 */
export function registerStockAlertProcessor(): void {
  const queue = getStockAlertQueue();
  queue.process(1, async (job: Bull.Job) => {
    return stockAlertService.process(job);
  });
  console.log('[StockAlert] Bull processor 已注册');
}

export { stockAlertService };
