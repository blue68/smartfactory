import Decimal from 'decimal.js';
import { AppDataSource } from '../../config/database';
import { TenantContext } from '../../shared/BaseRepository';
import { AppError } from '../../shared/AppError';
import { ResponseCode } from '../../shared/ApiResponse';
import { acquireLock, releaseLock, RedisKeys, RedisTTL, getRedisClient } from '../../config/redis';
import { UnitConverter } from '../../shared/unitConverter';
import { DyeLotAuthorizeService } from './dyeLotAuthorize.service';

// ─── 类型定义 ──────────────────────────────────────────────────

export type TransactionType =
  | 'PURCHASE_IN' | 'PRODUCTION_IN' | 'ADJUSTMENT_IN'
  | 'MATERIAL_OUT' | 'DELIVERY_OUT' | 'ADJUSTMENT_OUT' | 'STOCKTAKE_ADJUST';

export interface InboundParams {
  skuId: number;
  qtyInput: string;
  inputUnit: string;
  transactionType: Extract<TransactionType, 'PURCHASE_IN' | 'PRODUCTION_IN' | 'ADJUSTMENT_IN'>;
  dyeLotNo?: string;
  referenceType?: string;
  referenceId?: number;
  referenceNo?: string;
  batchCost?: string;
  notes?: string;
}

export interface OutboundParams {
  skuId: number;
  qtyInput: string;
  inputUnit: string;
  transactionType: Extract<TransactionType, 'MATERIAL_OUT' | 'DELIVERY_OUT' | 'ADJUSTMENT_OUT'>;
  dyeLotNo?: string;
  productionOrderId?: number;   // 用于缸号一致性校验
  authorizeId?: number;         // 跨色号授权申请ID（RISK-005）
  referenceType?: string;
  referenceId?: number;
  referenceNo?: string;
  notes?: string;
}

export interface DyeLotDetail {
  dyeLotNo: string;
  qtyOnHand: string;
  qtyReserved: string;
  qtyAvailable: string;
  firstInAt: Date;
  lastInAt: Date;
}

export interface InventorySnapshot {
  skuId: number;
  skuCode: string;
  skuName: string;
  qtyOnHand: string;
  qtyReserved: string;
  qtyInTransit: string;
  qtyAvailable: string;
  stockUnit: string;
  safetyStock: string;
  isBelowSafety: boolean;
  hasDyeLot: boolean;
  dyeLots?: DyeLotDetail[];
}

// ─── Inventory Service ─────────────────────────────────────────

export class InventoryService {
  private readonly tenantId: number;
  private readonly userId: number;
  private readonly roles: string[];

  constructor(ctx: TenantContext & { roles?: string[] }) {
    this.tenantId = ctx.tenantId;
    this.userId   = ctx.userId;
    this.roles    = ctx.roles ?? [];
  }

  // ── 库存总览（支持分类、关键字筛选） ─────────────────────

  async listInventory(params: {
    category1Id?: number;
    category2Id?: number;
    keyword?: string;
    belowSafety?: boolean;
    page: number;
    pageSize: number;
  }): Promise<{ list: InventorySnapshot[]; total: number }> {
    const conditions = ['s.tenant_id = ?'];
    const qParams: unknown[] = [this.tenantId];

    if (params.category1Id) { conditions.push('s.category1_id = ?'); qParams.push(params.category1Id); }
    if (params.category2Id) { conditions.push('s.category2_id = ?'); qParams.push(params.category2Id); }
    if (params.keyword) {
      conditions.push('(s.name LIKE ? OR s.sku_code LIKE ?)');
      qParams.push(`%${params.keyword}%`, `%${params.keyword}%`);
    }
    if (params.belowSafety) {
      conditions.push('(inv.qty_on_hand - inv.qty_reserved) < s.safety_stock');
    }

    const where = conditions.join(' AND ');
    const offset = (params.page - 1) * params.pageSize;

    const [rows, countRows] = await Promise.all([
      AppDataSource.query<any[]>(
        `SELECT s.id AS skuId, s.sku_code AS skuCode, s.name AS skuName,
                s.stock_unit AS stockUnit, s.safety_stock AS safetyStock, s.has_dye_lot AS hasDyeLot,
                COALESCE(inv.qty_on_hand, 0) AS qtyOnHand,
                COALESCE(inv.qty_reserved, 0) AS qtyReserved,
                COALESCE(inv.qty_in_transit, 0) AS qtyInTransit
         FROM skus s
         LEFT JOIN inventory inv ON inv.sku_id = s.id AND inv.tenant_id = s.tenant_id
         WHERE ${where}
         ORDER BY s.id
         LIMIT ? OFFSET ?`,
        [...qParams, params.pageSize, offset],
      ),
      AppDataSource.query<Array<{ total: number }>>(
        `SELECT COUNT(*) AS total FROM skus s
         LEFT JOIN inventory inv ON inv.sku_id = s.id AND inv.tenant_id = s.tenant_id
         WHERE ${where}`,
        qParams,
      ),
    ]);

    const list = rows.map((r) => ({
      ...r,
      qtyAvailable: new Decimal(r.qtyOnHand).minus(r.qtyReserved).toFixed(4),
      isBelowSafety: new Decimal(r.qtyOnHand).minus(r.qtyReserved).lt(new Decimal(r.safetyStock)),
      hasDyeLot: Boolean(r.hasDyeLot),
    }));

    return { list, total: Number(countRows[0]?.total ?? 0) };
  }

  // ── 缸号批次详情 ──────────────────────────────────────────

  async getDyeLotDetails(skuId: number): Promise<DyeLotDetail[]> {
    const rows = await AppDataSource.query<any[]>(
      `SELECT dye_lot_no AS dyeLotNo, qty_on_hand AS qtyOnHand,
              qty_reserved AS qtyReserved, first_in_at AS firstInAt, last_in_at AS lastInAt
       FROM inventory_dye_lots
       WHERE tenant_id = ? AND sku_id = ? AND status = 'active'
       ORDER BY first_in_at ASC`,
      [this.tenantId, skuId],
    );

    return rows.map((r) => ({
      ...r,
      qtyAvailable: new Decimal(r.qtyOnHand).minus(r.qtyReserved).toFixed(4),
    }));
  }

  // ── 可用库存查询（供采购/销售模块调用） ─────────────────

  async getAvailableStock(skuId: number): Promise<{
    qtyOnHand: Decimal; qtyReserved: Decimal; qtyAvailable: Decimal; stockUnit: string;
  }> {
    // 尝试从 Redis 缓存读取；Redis 不可用时静默降级到 DB，不影响业务
    try {
      const redis = getRedisClient();
      const cacheKey = RedisKeys.inventorySnapshot(this.tenantId, skuId);
      const cached = await redis.get(cacheKey);
      if (cached) {
        const d = JSON.parse(cached);
        return {
          qtyOnHand: new Decimal(d.qtyOnHand),
          qtyReserved: new Decimal(d.qtyReserved),
          qtyAvailable: new Decimal(d.qtyAvailable),
          stockUnit: d.stockUnit,
        };
      }
    } catch (err) {
      console.warn('[InventoryService] Redis 缓存读取失败，降级到 DB 查询:', (err as Error).message);
    }

    const [row] = await AppDataSource.query<any[]>(
      `SELECT COALESCE(inv.qty_on_hand, 0) AS qtyOnHand,
              COALESCE(inv.qty_reserved, 0) AS qtyReserved,
              s.stock_unit AS stockUnit
       FROM skus s
       LEFT JOIN inventory inv ON inv.sku_id = s.id AND inv.tenant_id = s.tenant_id
       WHERE s.id = ? AND s.tenant_id = ? LIMIT 1`,
      [skuId, this.tenantId],
    );
    if (!row) throw AppError.notFound('SKU不存在');

    const qtyOnHand = new Decimal(row.qtyOnHand);
    const qtyReserved = new Decimal(row.qtyReserved);
    const qtyAvailable = qtyOnHand.minus(qtyReserved);

    // 写缓存失败不影响正常返回
    try {
      const redis = getRedisClient();
      const cacheKey = RedisKeys.inventorySnapshot(this.tenantId, skuId);
      await redis.setex(cacheKey, RedisTTL.INVENTORY, JSON.stringify({
        qtyOnHand: qtyOnHand.toFixed(4),
        qtyReserved: qtyReserved.toFixed(4),
        qtyAvailable: qtyAvailable.toFixed(4),
        stockUnit: row.stockUnit,
      }));
    } catch (err) {
      console.warn('[InventoryService] Redis 缓存写入失败，已忽略:', (err as Error).message);
    }

    return { qtyOnHand, qtyReserved, qtyAvailable, stockUnit: row.stockUnit };
  }

  // ── 采购入库 ──────────────────────────────────────────────

  async inbound(params: InboundParams): Promise<{ transactionNo: string; newQtyOnHand: string }> {
    const sku = await this.getSkuInfo(params.skuId);

    // 1. 校验面料缸号必填
    if (sku.hasDyeLot && !params.dyeLotNo) {
      throw new AppError('该物料需要填写缸号', ResponseCode.INVENTORY_DYE_LOT_REQUIRED);
    }

    // 2. 单位换算到库存单位
    const conversions = await this.getUnitConversions(params.skuId);
    const converted = UnitConverter.convert(
      params.qtyInput, params.inputUnit, conversions, sku.stockUnit,
    );

    // 3. 尝试获取 Redis 分布式锁
    //    - Redis 可用且锁空闲：正常加锁，事务内再加 DB 行锁（双重保障）
    //    - Redis 可用但锁已被占用：说明同一 SKU 正在操作，拒绝并发请求
    //    - Redis 不可用（抛出异常）：降级到纯 DB 行锁，保证高可用
    const lockKey = RedisKeys.inventoryLock(this.tenantId, params.skuId);
    let lockVal: string | null = null;
    let redisLockAcquired = false;

    try {
      lockVal = await acquireLock(lockKey, 5000);
      if (lockVal === null) {
        // Redis 可用但锁已被持有，说明并发操作同一 SKU，拒绝请求
        throw new AppError('库存操作繁忙，请稍后重试', ResponseCode.INVENTORY_LOCK_FAILED);
      }
      redisLockAcquired = true;
    } catch (err) {
      if (err instanceof AppError) throw err;
      // Redis 不可用（连接断开、超时等），记录告警并降级到 DB 行锁
      console.warn('[InventoryService] Redis 分布式锁不可用，降级到 DB 行锁（入库）:', (err as Error).message);
    }

    try {
      return await AppDataSource.transaction(async (manager) => {
        // 4. DB 行锁（入库时锁定 inventory 行）
        //    - Redis 锁可用时：提供跨进程互斥的第一层防护
        //    - Redis 降级时：DB 行锁作为唯一并发控制手段
        //    入库使用 SELECT ... FOR UPDATE 防止并发写冲突
        await manager.query(
          `SELECT id FROM inventory WHERE tenant_id = ? AND sku_id = ? LIMIT 1 FOR UPDATE`,
          [this.tenantId, params.skuId],
        );
        // 注意：若 inventory 行尚不存在（首次入库），INSERT ... ON DUPLICATE KEY UPDATE
        // 本身具有行级 gap lock，可安全处理并发首次入库

        const txNo = this.generateTxNo('IN');

        // 5. 写入库存流水
        await manager.query(
          `INSERT INTO inventory_transactions
             (tenant_id, transaction_no, sku_id, transaction_type, direction,
              qty_input, input_unit, qty_stock_unit, stock_unit, dye_lot_no,
              reference_type, reference_id, reference_no, batch_cost, notes, created_by)
           VALUES (?,?,?,?,?, ?,?,?,?,?, ?,?,?,?,?,?)`,
          [
            this.tenantId, txNo, params.skuId, params.transactionType, 'IN',
            params.qtyInput, params.inputUnit, converted.qty.toFixed(4), sku.stockUnit, params.dyeLotNo ?? null,
            params.referenceType ?? null, params.referenceId ?? null, params.referenceNo ?? null,
            params.batchCost ?? null, params.notes ?? null, this.userId,
          ],
        );

        // 6. 更新库存快照（UPSERT）
        await manager.query(
          `INSERT INTO inventory (tenant_id, sku_id, qty_on_hand, qty_reserved, qty_in_transit, last_in_at)
           VALUES (?, ?, ?, 0, 0, NOW())
           ON DUPLICATE KEY UPDATE
             qty_on_hand = qty_on_hand + VALUES(qty_on_hand),
             last_in_at  = NOW()`,
          [this.tenantId, params.skuId, converted.qty.toFixed(4)],
        );

        // 7. 更新缸号批次库存（面料类）
        if (params.dyeLotNo) {
          await manager.query(
            `INSERT INTO inventory_dye_lots
               (tenant_id, sku_id, dye_lot_no, qty_on_hand, qty_reserved, first_in_at, last_in_at)
             VALUES (?, ?, ?, ?, 0, NOW(), NOW())
             ON DUPLICATE KEY UPDATE
               qty_on_hand = qty_on_hand + VALUES(qty_on_hand),
               last_in_at  = NOW()`,
            [this.tenantId, params.skuId, params.dyeLotNo, converted.qty.toFixed(4)],
          );
        }

        // 8. 查询更新后的库存数量
        const [updated] = await manager.query<Array<{ qty: string }>>(
          'SELECT qty_on_hand AS qty FROM inventory WHERE tenant_id = ? AND sku_id = ? LIMIT 1',
          [this.tenantId, params.skuId],
        );

        return { transactionNo: txNo, newQtyOnHand: updated?.qty ?? converted.qty.toFixed(4) };
      });
    } finally {
      // 释放 Redis 锁（失败只打警告，不影响结果）
      if (redisLockAcquired && lockVal) {
        await releaseLock(lockKey, lockVal);
      }
      // 失效缓存（失败只打警告）
      try {
        await getRedisClient().del(RedisKeys.inventorySnapshot(this.tenantId, params.skuId));
      } catch (err) {
        console.warn('[InventoryService] 缓存失效失败（入库），下次查询将穿透到 DB:', (err as Error).message);
      }
      // 异步检查安全库存预警
      this.checkSafetyStockAlert(params.skuId, sku).catch(console.error);
    }
  }

  // ── 出库 ──────────────────────────────────────────────────

  async outbound(params: OutboundParams): Promise<{ transactionNo: string; newQtyOnHand: string }> {
    const sku = await this.getSkuInfo(params.skuId);

    // 1. 面料缸号必填
    if (sku.hasDyeLot && !params.dyeLotNo) {
      throw new AppError('该物料出库需要指定缸号', ResponseCode.INVENTORY_DYE_LOT_REQUIRED);
    }

    // 2. 生产领料时校验缸号一致性（RISK-005）
    //    - isCrossDyeLot = true 时，默认强制阻断，不允许静默通过
    //    - 若携带有效 authorizeId，则通过授权服务校验，校验通过后记录授权信息到流水
    let isCrossDyeLot = false;
    let crossDyeLotAuthorizeInfo: {
      authorizeUserId: number;
      reason: string;
      decidedAt: Date;
    } | null = null;

    if (sku.hasDyeLot && params.dyeLotNo && params.productionOrderId) {
      isCrossDyeLot = await this.checkDyeLotConsistency(
        params.productionOrderId, params.skuId, params.dyeLotNo,
      );

      if (isCrossDyeLot) {
        // 获取绑定色号（用于错误详情，方便前端展示预警弹窗）
        const boundDyeLotNo = await this.getBoundDyeLotNo(params.productionOrderId, params.skuId);

        if (!params.authorizeId) {
          // 无授权ID → 强制阻断，返回 4004 + 色号对比信息供前端展示弹窗
          throw new AppError(
            '检测到跨色号出库风险，需要主管授权',
            ResponseCode.INVENTORY_CROSS_DYE_LOT,
            400,
            {
              boundDyeLotNo:        boundDyeLotNo ?? '未知',
              requestedDyeLotNo:    params.dyeLotNo,
              skuName:              sku.skuName ?? '',
              productionOrderId:    params.productionOrderId,
              riskLevel:            'high',
            },
          );
        }

        // 有授权ID → 通过授权服务校验，失败仍抛 AppError
        const authSvc = new DyeLotAuthorizeService({
          tenantId: this.tenantId,
          userId:   this.userId,
          roles:    this.roles,
        });
        crossDyeLotAuthorizeInfo = await authSvc.validateForOutbound(
          params.authorizeId,
          params.skuId,
        );
      }
    }

    // 3. 单位换算
    const conversions = await this.getUnitConversions(params.skuId);
    const converted = UnitConverter.convert(
      params.qtyInput, params.inputUnit, conversions, sku.stockUnit,
    );

    // 4. 尝试获取 Redis 分布式锁（策略同入库）
    const lockKey = RedisKeys.inventoryLock(this.tenantId, params.skuId);
    let lockVal: string | null = null;
    let redisLockAcquired = false;

    try {
      lockVal = await acquireLock(lockKey, 5000);
      if (lockVal === null) {
        throw new AppError('库存操作繁忙，请稍后重试', ResponseCode.INVENTORY_LOCK_FAILED);
      }
      redisLockAcquired = true;
    } catch (err) {
      if (err instanceof AppError) throw err;
      console.warn('[InventoryService] Redis 分布式锁不可用，降级到 DB 行锁（出库）:', (err as Error).message);
    }

    try {
      return await AppDataSource.transaction(async (manager) => {
        // 5. 检查库存充足性，使用 SELECT ... FOR UPDATE 行锁防止超卖
        //    这是防超卖的最终安全线，无论 Redis 锁是否可用均必须执行
        const [inv] = await manager.query<Array<{ qty_on_hand: string; qty_reserved: string }>>(
          'SELECT qty_on_hand, qty_reserved FROM inventory WHERE tenant_id = ? AND sku_id = ? LIMIT 1 FOR UPDATE',
          [this.tenantId, params.skuId],
        );
        if (!inv) throw new AppError('库存记录不存在', ResponseCode.INVENTORY_INSUFFICIENT);

        const available = new Decimal(inv.qty_on_hand).minus(inv.qty_reserved);
        if (converted.qty.gt(available)) {
          throw new AppError(
            `库存不足：可用 ${available.toFixed(4)} ${sku.stockUnit}，需要 ${converted.qty.toFixed(4)} ${sku.stockUnit}`,
            ResponseCode.INVENTORY_INSUFFICIENT,
          );
        }

        // 6. 面料缸号库存检查
        if (params.dyeLotNo) {
          const [dl] = await manager.query<Array<{ qty_on_hand: string; qty_reserved: string }>>(
            `SELECT qty_on_hand, qty_reserved FROM inventory_dye_lots
             WHERE tenant_id = ? AND sku_id = ? AND dye_lot_no = ? FOR UPDATE`,
            [this.tenantId, params.skuId, params.dyeLotNo],
          );
          if (!dl) throw new AppError(`缸号 ${params.dyeLotNo} 库存不存在`);
          const dlAvailable = new Decimal(dl.qty_on_hand).minus(dl.qty_reserved);
          if (converted.qty.gt(dlAvailable)) {
            throw new AppError(
              `缸号 ${params.dyeLotNo} 可用库存不足：${dlAvailable.toFixed(4)} ${sku.stockUnit}`,
              ResponseCode.INVENTORY_INSUFFICIENT,
            );
          }

          // 扣减缸号库存
          await manager.query(
            `UPDATE inventory_dye_lots
             SET qty_on_hand = qty_on_hand - ?, last_in_at = NOW()
             WHERE tenant_id = ? AND sku_id = ? AND dye_lot_no = ?`,
            [converted.qty.toFixed(4), this.tenantId, params.skuId, params.dyeLotNo],
          );
        }

        const txNo = this.generateTxNo('OUT');

        // 7. 写入流水（含 production_order_id，供溯源链反查该工单领用了哪些物料）
        await manager.query(
          `INSERT INTO inventory_transactions
             (tenant_id, transaction_no, sku_id, transaction_type, direction,
              qty_input, input_unit, qty_stock_unit, stock_unit, dye_lot_no,
              production_order_id, reference_type, reference_id, reference_no,
              is_cross_dye_lot, notes, created_by)
           VALUES (?,?,?,?,?, ?,?,?,?,?, ?,?,?,?,?,?,?)`,
          [
            this.tenantId, txNo, params.skuId, params.transactionType, 'OUT',
            params.qtyInput, params.inputUnit, converted.qty.toFixed(4), sku.stockUnit,
            params.dyeLotNo ?? null,
            params.productionOrderId ?? null,
            params.referenceType ?? null, params.referenceId ?? null, params.referenceNo ?? null,
            isCrossDyeLot ? 1 : 0, params.notes ?? null, this.userId,
          ],
        );

        // 8. 扣减库存快照
        await manager.query(
          'UPDATE inventory SET qty_on_hand = qty_on_hand - ?, last_out_at = NOW() WHERE tenant_id = ? AND sku_id = ?',
          [converted.qty.toFixed(4), this.tenantId, params.skuId],
        );

        const [updated] = await manager.query<Array<{ qty: string }>>(
          'SELECT qty_on_hand AS qty FROM inventory WHERE tenant_id = ? AND sku_id = ? LIMIT 1',
          [this.tenantId, params.skuId],
        );

        // 9. 若首次领料绑定缸号（生产订单）
        if (params.dyeLotNo && params.productionOrderId && !isCrossDyeLot) {
          await manager.query(
            `INSERT IGNORE INTO order_dye_lot_bindings
               (tenant_id, production_order_id, sku_id, dye_lot_no, bound_at, bound_by)
             VALUES (?, ?, ?, ?, NOW(), ?)`,
            [this.tenantId, params.productionOrderId, params.skuId, params.dyeLotNo, this.userId],
          );
        }

        return { transactionNo: txNo, newQtyOnHand: updated?.qty ?? '0' };
      });
    } finally {
      if (redisLockAcquired && lockVal) {
        await releaseLock(lockKey, lockVal);
      }
      try {
        await getRedisClient().del(RedisKeys.inventorySnapshot(this.tenantId, params.skuId));
      } catch (err) {
        console.warn('[InventoryService] 缓存失效失败（出库），下次查询将穿透到 DB:', (err as Error).message);
      }
    }
  }

  // ── 先进先出出库推荐（面料类） ────────────────────────────

  async recommendFifoDyeLot(skuId: number, requiredQty: string): Promise<DyeLotDetail[]> {
    const rows = await AppDataSource.query<any[]>(
      `SELECT dye_lot_no AS dyeLotNo, qty_on_hand AS qtyOnHand,
              qty_reserved AS qtyReserved, first_in_at AS firstInAt, last_in_at AS lastInAt
       FROM inventory_dye_lots
       WHERE tenant_id = ? AND sku_id = ? AND status = 'active'
         AND qty_on_hand - qty_reserved > 0
       ORDER BY first_in_at ASC`,
      [this.tenantId, skuId],
    );

    // 按 FIFO 顺序选取满足数量的缸号
    let remaining = new Decimal(requiredQty);
    const result: DyeLotDetail[] = [];
    for (const r of rows) {
      if (remaining.lte(0)) break;
      result.push({ ...r, qtyAvailable: new Decimal(r.qtyOnHand).minus(r.qtyReserved).toFixed(4) });
      remaining = remaining.minus(new Decimal(r.qtyOnHand).minus(r.qtyReserved));
    }
    return result;
  }

  // ── 私有辅助 ──────────────────────────────────────────────

  private async getSkuInfo(skuId: number): Promise<{
    stockUnit: string; purchaseUnit: string; productionUnit: string; hasDyeLot: boolean; safetyStock: string; skuName: string;
  }> {
    const [sku] = await AppDataSource.query<any[]>(
      `SELECT stock_unit AS stockUnit, purchase_unit AS purchaseUnit,
              production_unit AS productionUnit, has_dye_lot AS hasDyeLot,
              safety_stock AS safetyStock, name AS skuName
       FROM skus WHERE id = ? AND tenant_id = ? LIMIT 1`,
      [skuId, this.tenantId],
    );
    if (!sku) throw AppError.notFound('SKU不存在');
    return { ...sku, hasDyeLot: Boolean(sku.hasDyeLot) };
  }

  /**
   * 获取生产工单绑定的色号（用于跨色号出库警告信息）
   */
  private async getBoundDyeLotNo(productionOrderId: number, skuId: number): Promise<string | null> {
    const [row] = await AppDataSource.query<Array<{ dyeLotNo: string }>>(
      `SELECT dye_lot_no AS dyeLotNo FROM inventory_transactions
       WHERE tenant_id = ? AND production_order_id = ? AND sku_id = ? AND dye_lot_no IS NOT NULL
       ORDER BY created_at ASC LIMIT 1`,
      [this.tenantId, productionOrderId, skuId],
    );
    return row?.dyeLotNo ?? null;
  }

  private async getUnitConversions(skuId: number) {
    return AppDataSource.query<Array<{ fromUnit: string; toUnit: string; conversionRate: string }>>(
      `SELECT from_unit AS fromUnit, to_unit AS toUnit, conversion_rate AS conversionRate
       FROM sku_unit_conversions WHERE tenant_id = ? AND sku_id = ?`,
      [this.tenantId, skuId],
    );
  }

  /**
   * 检查缸号一致性：该生产订单是否已绑定不同缸号
   * @returns true 表示跨缸号（需要警告）
   */
  private async checkDyeLotConsistency(
    productionOrderId: number, skuId: number, dyeLotNo: string,
  ): Promise<boolean> {
    const [binding] = await AppDataSource.query<Array<{ dye_lot_no: string }>>(
      `SELECT dye_lot_no FROM order_dye_lot_bindings
       WHERE production_order_id = ? AND sku_id = ? LIMIT 1`,
      [productionOrderId, skuId],
    );
    if (!binding) return false; // 首次领用，无约束
    return binding.dye_lot_no !== dyeLotNo;
  }

  private generateTxNo(direction: 'IN' | 'OUT'): string {
    const now = new Date();
    const ts = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
      String(now.getHours()).padStart(2, '0'),
      String(now.getMinutes()).padStart(2, '0'),
      String(now.getSeconds()).padStart(2, '0'),
    ].join('');
    const rand = Math.floor(Math.random() * 9999).toString().padStart(4, '0');
    return `${direction}${ts}${rand}`;
  }

  private async checkSafetyStockAlert(
    skuId: number,
    sku: { safetyStock: string; stockUnit: string },
  ): Promise<void> {
    const { qtyAvailable } = await this.getAvailableStock(skuId);
    if (qtyAvailable.lt(new Decimal(sku.safetyStock))) {
      // 检查今日是否已发送过预警（防止消息轰炸）
      const today = new Date().toISOString().slice(0, 10);
      const alertKey = RedisKeys.alertSent(this.tenantId, skuId, today);
      const redis = getRedisClient();
      const alreadySent = await redis.get(alertKey);
      if (!alreadySent) {
        await redis.setex(alertKey, RedisTTL.ALERT_SENT, '1');
        // 将预警推入通知队列（实际实现中对接 Bull 队列）
        console.info(`[InventoryAlert] 租户${this.tenantId} SKU${skuId} 库存低于安全库存`);
      }
    }
  }

  // ── BE-P1-004: 物料损耗录入 ───────────────────────────────

  /**
   * 记录物料损耗：
   * 1. 扣减 inventory.qty_on_hand
   * 2. 插入 inventory_transactions（type = 'waste_out'，direction = 'OUT'）
   * 3. 失效 Redis 库存快照缓存
   *
   * 返回事务编号和损耗后的新库存量。
   */
  async recordWaste(params: {
    skuId: number;
    qty: string;
    reason: string;
    notes?: string;
  }): Promise<{ transactionNo: string; newQtyOnHand: string }> {
    const sku = await this.getSkuInfo(params.skuId);

    // 尝试获取 Redis 分布式锁（与入库/出库保持一致策略）
    const lockKey = RedisKeys.inventoryLock(this.tenantId, params.skuId);
    let lockVal: string | null = null;
    let redisLockAcquired = false;

    try {
      lockVal = await acquireLock(lockKey, 5000);
      if (lockVal === null) {
        throw new AppError('库存操作繁忙，请稍后重试', ResponseCode.INVENTORY_LOCK_FAILED);
      }
      redisLockAcquired = true;
    } catch (err) {
      if (err instanceof AppError) throw err;
      console.warn('[InventoryService] Redis 分布式锁不可用，降级到 DB 行锁（损耗录入）:', (err as Error).message);
    }

    const wasteQty = new Decimal(params.qty);

    try {
      return await AppDataSource.transaction(async (manager) => {
        // DB 行锁：防止并发超扣
        const [inv] = await manager.query<Array<{ qty_on_hand: string; qty_reserved: string }>>(
          'SELECT qty_on_hand, qty_reserved FROM inventory WHERE tenant_id = ? AND sku_id = ? LIMIT 1 FOR UPDATE',
          [this.tenantId, params.skuId],
        );
        if (!inv) throw new AppError('库存记录不存在', ResponseCode.INVENTORY_INSUFFICIENT);

        const onHand = new Decimal(inv.qty_on_hand);
        if (wasteQty.gt(onHand)) {
          throw new AppError(
            `在库数量不足：在库 ${onHand.toFixed(4)} ${sku.stockUnit}，损耗录入 ${wasteQty.toFixed(4)} ${sku.stockUnit}`,
            ResponseCode.INVENTORY_INSUFFICIENT,
          );
        }

        const txNo = this.generateTxNo('OUT');

        // 插入损耗流水（transaction_type = 'waste_out'）
        await manager.query(
          `INSERT INTO inventory_transactions
             (tenant_id, transaction_no, sku_id, transaction_type, direction,
              qty_input, input_unit, qty_stock_unit, stock_unit,
              notes, created_by)
           VALUES (?,?,?,'waste_out','OUT', ?,?,?,?, ?,?)`,
          [
            this.tenantId, txNo, params.skuId,
            params.qty, sku.stockUnit, wasteQty.toFixed(4), sku.stockUnit,
            params.notes ? `[${params.reason}] ${params.notes}` : params.reason,
            this.userId,
          ],
        );

        // 扣减库存快照
        await manager.query(
          `UPDATE inventory SET qty_on_hand = qty_on_hand - ?, last_out_at = NOW()
           WHERE tenant_id = ? AND sku_id = ?`,
          [wasteQty.toFixed(4), this.tenantId, params.skuId],
        );

        const [updated] = await manager.query<Array<{ qty: string }>>(
          'SELECT qty_on_hand AS qty FROM inventory WHERE tenant_id = ? AND sku_id = ? LIMIT 1',
          [this.tenantId, params.skuId],
        );

        return { transactionNo: txNo, newQtyOnHand: updated?.qty ?? '0' };
      });
    } finally {
      if (redisLockAcquired && lockVal) {
        await releaseLock(lockKey, lockVal);
      }
      // 失效库存快照缓存
      try {
        await getRedisClient().del(RedisKeys.inventorySnapshot(this.tenantId, params.skuId));
      } catch (err) {
        console.warn('[InventoryService] 缓存失效失败（损耗录入）:', (err as Error).message);
      }
      // 异步安全库存预警检查
      this.checkSafetyStockAlert(params.skuId, sku).catch(console.error);
    }
  }

  // ── BE-P1-005: 库存汇总（按一级分类聚合） ─────────────────

  async getSummary(): Promise<{
    categories: Array<{
      categoryId: number;
      categoryName: string;
      totalQty: number;
      skuCount: number;
      alertCount: number;
    }>;
    totalSkuCount: number;
    totalAlertCount: number;
  }> {
    const rows = await AppDataSource.query(
      `SELECT
         sc.id AS categoryId, sc.name AS categoryName,
         COUNT(DISTINCT i.sku_id) AS skuCount,
         COALESCE(SUM(i.qty_on_hand), 0) AS totalQty,
         SUM(CASE WHEN i.qty_on_hand - i.qty_reserved < COALESCE(s.safety_stock, 0) THEN 1 ELSE 0 END) AS alertCount
       FROM inventory i
       INNER JOIN skus s ON s.id = i.sku_id AND s.tenant_id = i.tenant_id
       INNER JOIN sku_categories sc ON sc.id = s.category1_id AND sc.level = 1
       WHERE i.tenant_id = ?
       GROUP BY sc.id, sc.name
       ORDER BY sc.id`,
      [this.tenantId],
    );
    const categories = rows.map((r: any) => ({
      categoryId: Number(r.categoryId),
      categoryName: r.categoryName,
      totalQty: Number(r.totalQty),
      skuCount: Number(r.skuCount),
      alertCount: Number(r.alertCount),
    }));
    return {
      categories,
      totalSkuCount: categories.reduce((a: number, c: { skuCount: number }) => a + c.skuCount, 0),
      totalAlertCount: categories.reduce((a: number, c: { alertCount: number }) => a + c.alertCount, 0),
    };
  }

  // ─── BE-P1-003: 库存盘点接口 ──────────────────────────────

  async startStocktake(): Promise<{ stocktakeId: number; stocktakeNo: string }> {
    const no = `ST${Date.now()}`;
    const [result] = await AppDataSource.query(
      `INSERT INTO inventory_stocktakes (tenant_id, stocktake_no, status, created_by)
       VALUES (?, ?, 'in_progress', ?)`,
      [this.tenantId, no, this.userId],
    );
    return { stocktakeId: result.insertId, stocktakeNo: no };
  }

  async submitStocktakeItem(stocktakeId: number, skuId: number, countedQty: string): Promise<void> {
    const [inv] = await AppDataSource.query(
      `SELECT qty_on_hand FROM inventory WHERE tenant_id = ? AND sku_id = ?`,
      [this.tenantId, skuId],
    );
    const systemQty = inv?.qty_on_hand ?? '0';
    const diff = new Decimal(countedQty).minus(systemQty).toFixed(4);
    await AppDataSource.query(
      `INSERT INTO inventory_stocktake_items
         (stocktake_id, tenant_id, sku_id, system_qty, counted_qty, diff_qty)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE counted_qty = VALUES(counted_qty), diff_qty = VALUES(diff_qty)`,
      [stocktakeId, this.tenantId, skuId, systemQty, countedQty, diff],
    );
  }

  async getStocktakeDiff(stocktakeId: number): Promise<Array<{
    skuId: number; skuName: string; systemQty: string; countedQty: string; diffQty: string;
  }>> {
    const rows = await AppDataSource.query(
      `SELECT si.sku_id, s.name AS sku_name, si.system_qty, si.counted_qty, si.diff_qty
       FROM inventory_stocktake_items si
       INNER JOIN skus s ON s.id = si.sku_id
       WHERE si.stocktake_id = ? AND si.tenant_id = ? AND si.diff_qty != 0
       ORDER BY ABS(si.diff_qty) DESC`,
      [stocktakeId, this.tenantId],
    );
    return rows.map((r: Record<string, unknown>) => ({
      skuId: Number(r.sku_id),
      skuName: String(r.sku_name),
      systemQty: String(r.system_qty),
      countedQty: String(r.counted_qty),
      diffQty: String(r.diff_qty),
    }));
  }
}
