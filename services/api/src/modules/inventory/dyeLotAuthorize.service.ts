import { AppDataSource } from '../../config/database';
import { TenantContext } from '../../shared/BaseRepository';
import { AppError } from '../../shared/AppError';
import { ResponseCode } from '../../shared/ApiResponse';

// ─── 常量 ──────────────────────────────────────────────────────

/** 默认授权申请有效期：2 小时（分钟数，可从租户配置中覆盖） */
const DEFAULT_EXPIRE_MINUTES = 120;

/** 允许执行授权审批的权限点 */
const AUTHORIZE_ALLOWED_ACTION_CODES = ['inventory:maintain'];

// ─── 放行原因枚举 ──────────────────────────────────────────────

export const DyeLotReason = {
  CUSTOMER_APPROVED: 'CUSTOMER_APPROVED',   // 客户已书面确认接受混色号出货
  STOCK_SHORTAGE:    'STOCK_SHORTAGE',      // 同色号库存不足，紧急生产需求
  QUALITY_VERIFIED:  'QUALITY_VERIFIED',    // 经实物比对色差在容忍范围内
  SAMPLE_ORDER:      'SAMPLE_ORDER',        // 样品订单，客户知悉
  OTHER:             'OTHER',               // 其他（需附自定义说明）
} as const;

export type DyeLotReasonValue = typeof DyeLotReason[keyof typeof DyeLotReason];

// ─── 数据类型 ──────────────────────────────────────────────────

export interface MixedDyeLots {
  boundDyeLotNo: string;       // 该生产订单已绑定的色号
  requestedDyeLotNo: string;   // 本次出库申请的色号
}

export interface CreateAuthorizeRequestParams {
  outboundOrderId: number;
  skuId: number;
  mixedDyeLots: MixedDyeLots;
  reason?: string;
}

export interface ApproveParams {
  reason: DyeLotReasonValue;
  rejectReason?: string;       // approve 时可以不填，为描述性备注
}

export interface AuthorizeRequestRecord {
  id: number;
  tenantId: number;
  requestUserId: number;
  authorizeUserId: number | null;
  outboundOrderId: number;
  skuId: number;
  mixedDyeLots: MixedDyeLots;
  reason: string | null;
  rejectReason: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  decidedAt: Date | null;
  expiresAt: Date;
  createdAt: Date;
}

// ─── DyeLotAuthorizeService ─────────────────────────────────────

export class DyeLotAuthorizeService {
  private readonly tenantId: number;
  private readonly userId: number;
  private readonly actionCodes: string[];

  constructor(ctx: TenantContext) {
    this.tenantId  = ctx.tenantId;
    this.userId    = ctx.userId;
    this.actionCodes = ctx.actionCodes ?? [];
  }

  // ── 创建授权申请（仓管提交） ──────────────────────────────

  async createRequest(params: CreateAuthorizeRequestParams): Promise<{ id: number; expiresAt: Date }> {
    // 同一出库单 + 同一 SKU 不得重复提交 pending 申请
    const [existing] = await AppDataSource.query<Array<{ id: number }>>(
      `SELECT id FROM cross_dye_lot_authorize_requests
       WHERE tenant_id = ? AND outbound_order_id = ? AND sku_id = ?
         AND status = 'pending' AND expires_at > NOW()
       LIMIT 1`,
      [this.tenantId, params.outboundOrderId, params.skuId],
    );
    if (existing) {
      throw AppError.conflict(
        `该出库单的跨色号授权申请已存在（ID: ${existing.id}），请等待主管审批`,
        ResponseCode.CONFLICT,
      );
    }

    // 从租户配置读取过期分钟数，不可用则使用默认值
    const expireMinutes = await this.getExpireMinutes();
    const expiresAt = new Date(Date.now() + expireMinutes * 60 * 1000);

    const result = await AppDataSource.query<{ insertId: number }>(
      `INSERT INTO cross_dye_lot_authorize_requests
         (tenant_id, request_user_id, outbound_order_id, sku_id, mixed_dye_lots, reason, status, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
      [
        this.tenantId,
        this.userId,
        params.outboundOrderId,
        params.skuId,
        JSON.stringify(params.mixedDyeLots),
        params.reason ?? null,
        expiresAt,
      ],
    );

    return { id: result.insertId, expiresAt };
  }

  // ── 主管批准 ──────────────────────────────────────────────

  async approveRequest(id: number, approveParams: ApproveParams): Promise<void> {
    this.assertAuthorizeRole();

    const req = await this.getValidPendingRequest(id);

    // reason 必填（业务强制要求留痕）
    if (!approveParams.reason) {
      throw AppError.badRequest('批准时必须填写放行原因（reason 字段）');
    }

    await AppDataSource.query(
      `UPDATE cross_dye_lot_authorize_requests
       SET status = 'approved',
           authorize_user_id = ?,
           reason = ?,
           decided_at = NOW()
       WHERE id = ? AND tenant_id = ?`,
      [this.userId, approveParams.reason, req.id, this.tenantId],
    );
  }

  // ── 主管拒绝 ──────────────────────────────────────────────

  async rejectRequest(id: number, rejectReason: string): Promise<void> {
    this.assertAuthorizeRole();

    if (!rejectReason?.trim()) {
      throw AppError.badRequest('拒绝时必须填写拒绝说明（rejectReason 字段）');
    }

    const req = await this.getValidPendingRequest(id);

    await AppDataSource.query(
      `UPDATE cross_dye_lot_authorize_requests
       SET status = 'rejected',
           authorize_user_id = ?,
           reject_reason = ?,
           decided_at = NOW()
       WHERE id = ? AND tenant_id = ?`,
      [this.userId, rejectReason.trim(), req.id, this.tenantId],
    );
  }

  // ── 查询单条申请详情 ──────────────────────────────────────

  async getRequestById(id: number): Promise<AuthorizeRequestRecord> {
    const [row] = await AppDataSource.query<any[]>(
      `SELECT id, tenant_id AS tenantId, request_user_id AS requestUserId,
              authorize_user_id AS authorizeUserId, outbound_order_id AS outboundOrderId,
              sku_id AS skuId, mixed_dye_lots AS mixedDyeLots, reason,
              reject_reason AS rejectReason, status, decided_at AS decidedAt,
              expires_at AS expiresAt, created_at AS createdAt
       FROM cross_dye_lot_authorize_requests
       WHERE id = ? AND tenant_id = ? LIMIT 1`,
      [id, this.tenantId],
    );

    if (!row) {
      throw AppError.notFound('授权申请不存在');
    }

    // 惰性过期：查询时检测到过期则同步状态
    const record = this.parseRow(row);
    if (record.status === 'pending' && new Date() > record.expiresAt) {
      await this.markExpired(id);
      record.status = 'expired';
    }

    return record;
  }

  // ── 查询待审批列表（主管视角） ────────────────────────────

  async getPendingRequests(page = 1, pageSize = 20): Promise<{
    list: AuthorizeRequestRecord[];
    total: number;
  }> {
    this.assertAuthorizeRole();

    // 先批量标记已过期的记录（惰性清理，避免主管看到实际已超时的单据）
    await AppDataSource.query(
      `UPDATE cross_dye_lot_authorize_requests
       SET status = 'expired'
       WHERE tenant_id = ? AND status = 'pending' AND expires_at <= NOW()`,
      [this.tenantId],
    );

    const offset = (page - 1) * pageSize;

    const [rows, countRows] = await Promise.all([
      AppDataSource.query<any[]>(
        `SELECT r.id, r.tenant_id AS tenantId, r.request_user_id AS requestUserId,
                r.authorize_user_id AS authorizeUserId, r.outbound_order_id AS outboundOrderId,
                r.sku_id AS skuId, r.mixed_dye_lots AS mixedDyeLots, r.reason,
                r.reject_reason AS rejectReason, r.status,
                r.decided_at AS decidedAt, r.expires_at AS expiresAt, r.created_at AS createdAt,
                u.username AS requestUsername,
                s.name AS skuName, s.sku_code AS skuCode
         FROM cross_dye_lot_authorize_requests r
         LEFT JOIN users u ON u.id = r.request_user_id AND u.tenant_id = r.tenant_id
         LEFT JOIN skus  s ON s.id = r.sku_id          AND s.tenant_id  = r.tenant_id
         WHERE r.tenant_id = ? AND r.status = 'pending'
         ORDER BY r.created_at DESC
         LIMIT ? OFFSET ?`,
        [this.tenantId, pageSize, offset],
      ),
      AppDataSource.query<Array<{ total: number }>>(
        `SELECT COUNT(*) AS total
         FROM cross_dye_lot_authorize_requests
         WHERE tenant_id = ? AND status = 'pending'`,
        [this.tenantId],
      ),
    ]);

    return {
      list:  rows.map((r) => this.parseRow(r)),
      total: Number(countRows[0]?.total ?? 0),
    };
  }

  // ── 出库时校验授权是否有效（供 inventory.service 调用） ──

  /**
   * 校验授权申请是否可用于当次出库
   * 返回授权记录（包含 reason 和 authorizeUserId 用于写流水）
   *
   * @throws AppError(4004) 授权不存在 / 已过期 / 已拒绝 / 状态不符
   */
  async validateForOutbound(
    authorizeId: number,
    skuId: number,
  ): Promise<{ authorizeUserId: number; reason: string; decidedAt: Date }> {
    const [row] = await AppDataSource.query<any[]>(
      `SELECT id, status, authorize_user_id AS authorizeUserId,
              reason, decided_at AS decidedAt, expires_at AS expiresAt, sku_id AS skuId
       FROM cross_dye_lot_authorize_requests
       WHERE id = ? AND tenant_id = ? LIMIT 1`,
      [authorizeId, this.tenantId],
    );

    if (!row) {
      throw new AppError(
        '授权申请不存在，无法放行跨色号出库',
        ResponseCode.INVENTORY_CROSS_DYE_LOT,
      );
    }

    // SKU 一致性校验（防止授权被复用到其他物料）
    if (Number(row.skuId) !== skuId) {
      throw new AppError(
        '授权申请与本次出库物料不匹配，无法放行',
        ResponseCode.INVENTORY_CROSS_DYE_LOT,
      );
    }

    // 惰性过期检测
    if (row.status === 'pending' && new Date() > new Date(row.expiresAt)) {
      await this.markExpired(authorizeId);
      throw new AppError(
        '授权申请已过期，请重新发起申请',
        ResponseCode.INVENTORY_CROSS_DYE_LOT,
      );
    }

    if (row.status === 'expired') {
      throw new AppError(
        '授权申请已过期，请重新发起申请',
        ResponseCode.INVENTORY_CROSS_DYE_LOT,
      );
    }

    if (row.status === 'rejected') {
      throw new AppError(
        '主管已拒绝该跨色号出库申请',
        ResponseCode.INVENTORY_CROSS_DYE_LOT,
      );
    }

    if (row.status === 'pending') {
      throw new AppError(
        '授权申请尚未审批，请等待主管确认',
        ResponseCode.INVENTORY_CROSS_DYE_LOT,
      );
    }

    // status === 'approved'，验证通过
    return {
      authorizeUserId: Number(row.authorizeUserId),
      reason:          row.reason as string,
      decidedAt:       new Date(row.decidedAt),
    };
  }

  // ── 私有辅助 ──────────────────────────────────────────────

  /** 获取 pending 且未过期的记录（approve/reject 前置校验） */
  private async getValidPendingRequest(id: number): Promise<{ id: number }> {
    const [row] = await AppDataSource.query<Array<{
      id: number; status: string; expires_at: string;
    }>>(
      `SELECT id, status, expires_at FROM cross_dye_lot_authorize_requests
       WHERE id = ? AND tenant_id = ? LIMIT 1`,
      [id, this.tenantId],
    );

    if (!row) {
      throw AppError.notFound('授权申请不存在');
    }

    if (row.status === 'expired' || (row.status === 'pending' && new Date() > new Date(row.expires_at))) {
      if (row.status === 'pending') {
        await this.markExpired(id);
      }
      throw AppError.badRequest('授权申请已过期，不可再操作');
    }

    if (row.status !== 'pending') {
      throw AppError.badRequest(`授权申请状态为 ${row.status}，不可重复操作`);
    }

    return { id: row.id };
  }

  /** 将申请标记为过期（惰性更新） */
  private async markExpired(id: number): Promise<void> {
    await AppDataSource.query(
      `UPDATE cross_dye_lot_authorize_requests
       SET status = 'expired' WHERE id = ? AND tenant_id = ? AND status = 'pending'`,
      [id, this.tenantId],
    );
  }

  /** 从租户配置读取过期分钟数，降级到默认值 */
  private async getExpireMinutes(): Promise<number> {
    try {
      const [tenant] = await AppDataSource.query<Array<{ settings: string | null }>>(
        'SELECT settings FROM tenants WHERE id = ? LIMIT 1',
        [this.tenantId],
      );
      if (tenant?.settings) {
        const cfg = JSON.parse(tenant.settings) as Record<string, unknown>;
        const minutes = Number(cfg.cross_dye_lot_authorize_timeout_minutes);
        if (!Number.isNaN(minutes) && minutes > 0) return minutes;
      }
    } catch {
      // 读取失败静默降级
    }
    return DEFAULT_EXPIRE_MINUTES;
  }

  /** 断言当前用户具备授权角色 */
  private assertAuthorizeRole(): void {
    const hasPermission = AUTHORIZE_ALLOWED_ACTION_CODES.some((actionCode) =>
      this.actionCodes.includes(actionCode),
    );
    if (!hasPermission) {
      throw AppError.forbidden(
        `该操作需要以下权限之一：${AUTHORIZE_ALLOWED_ACTION_CODES.join(', ')}`,
      );
    }
  }

  /** 将 DB 行映射为领域类型 */
  private parseRow(r: any): AuthorizeRequestRecord {
    return {
      id:               Number(r.id),
      tenantId:         Number(r.tenantId),
      requestUserId:    Number(r.requestUserId),
      authorizeUserId:  r.authorizeUserId != null ? Number(r.authorizeUserId) : null,
      outboundOrderId:  Number(r.outboundOrderId),
      skuId:            Number(r.skuId),
      mixedDyeLots:     typeof r.mixedDyeLots === 'string'
        ? JSON.parse(r.mixedDyeLots)
        : r.mixedDyeLots,
      reason:           r.reason     ?? null,
      rejectReason:     r.rejectReason ?? null,
      status:           r.status as AuthorizeRequestRecord['status'],
      decidedAt:        r.decidedAt  ? new Date(r.decidedAt)  : null,
      expiresAt:        new Date(r.expiresAt),
      createdAt:        new Date(r.createdAt),
      // 附加的关联字段（getPendingRequests 中 JOIN 得到，getRequestById 中为 undefined）
      ...( r.requestUsername !== undefined && { requestUsername: r.requestUsername }),
      ...( r.skuName         !== undefined && { skuName: r.skuName }),
      ...( r.skuCode         !== undefined && { skuCode: r.skuCode }),
    } as AuthorizeRequestRecord;
  }
}
