import { AppDataSource } from '../../config/database';
import { TenantContext } from '../../shared/BaseRepository';
import { AppError } from '../../shared/AppError';
import { ResponseCode } from '../../shared/ApiResponse';
import { NotificationEntity } from './notification.entity';

export type NotificationType = NotificationEntity['type'];

export class NotificationService {
  private readonly tenantId: number;
  private readonly userId: number;

  constructor(ctx: TenantContext) {
    this.tenantId = ctx.tenantId;
    this.userId = ctx.userId;
  }

  /**
   * 创建一条通知。
   * 通常由其他业务服务（审批、订单等）内部调用，不对外暴露 HTTP 写入接口。
   */
  async create(
    targetUserId: number,
    type: NotificationType,
    title: string,
    content: string,
    relatedType?: string,
    relatedId?: number,
  ): Promise<{ id: number }> {
    const result = await AppDataSource.query<{ insertId: number }>(
      `INSERT INTO notifications
         (tenant_id, user_id, type, title, content, is_read, related_type, related_id)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
      [
        this.tenantId,
        targetUserId,
        type,
        title,
        content,
        relatedType ?? null,
        relatedId ?? null,
      ],
    );
    return { id: Number(result.insertId) };
  }

  /**
   * 分页查询当前登录用户的通知列表，按创建时间倒序。
   */
  async listForUser(
    page: number,
    pageSize: number,
  ): Promise<{ list: NotificationEntity[]; total: number }> {
    const offset = (page - 1) * pageSize;

    const [list, countRows] = await Promise.all([
      AppDataSource.query<NotificationEntity[]>(
        `SELECT id, tenant_id, user_id, type, title, content, is_read,
                related_type, related_id, created_at
         FROM notifications
         WHERE tenant_id = ? AND user_id = ?
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?`,
        [this.tenantId, this.userId, pageSize, offset],
      ),
      AppDataSource.query<Array<{ total: number }>>(
        `SELECT COUNT(*) AS total
         FROM notifications
         WHERE tenant_id = ? AND user_id = ?`,
        [this.tenantId, this.userId],
      ),
    ]);

    return {
      list,
      total: Number(countRows[0]?.total ?? 0),
    };
  }

  /**
   * 将单条通知标记为已读。
   * 确保该通知属于当前租户且当前用户，防止越权修改。
   */
  async markAsRead(id: number): Promise<void> {
    const rows = await AppDataSource.query<Array<{ id: number }>>(
      `SELECT id FROM notifications
       WHERE id = ? AND tenant_id = ? AND user_id = ?
       LIMIT 1`,
      [id, this.tenantId, this.userId],
    );

    if (!rows.length) {
      throw AppError.notFound('通知不存在', ResponseCode.NOT_FOUND);
    }

    await AppDataSource.query(
      `UPDATE notifications SET is_read = 1
       WHERE id = ? AND tenant_id = ? AND user_id = ?`,
      [id, this.tenantId, this.userId],
    );
  }

  /**
   * 将当前用户所有未读通知批量标记为已读。
   */
  async markAllAsRead(): Promise<void> {
    await AppDataSource.query(
      `UPDATE notifications SET is_read = 1
       WHERE tenant_id = ? AND user_id = ? AND is_read = 0`,
      [this.tenantId, this.userId],
    );
  }

  /**
   * 获取当前用户未读通知数量。
   */
  async getUnreadCount(): Promise<number> {
    const rows = await AppDataSource.query<Array<{ count: number }>>(
      `SELECT COUNT(*) AS count
       FROM notifications
       WHERE tenant_id = ? AND user_id = ? AND is_read = 0`,
      [this.tenantId, this.userId],
    );
    return Number(rows[0]?.count ?? 0);
  }
}
