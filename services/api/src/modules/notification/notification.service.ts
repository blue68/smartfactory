import { Response } from 'express';
import { AppDataSource } from '../../config/database';
import { TenantContext } from '../../shared/BaseRepository';
import { AppError } from '../../shared/AppError';
import { ResponseCode } from '../../shared/ApiResponse';
import { NotificationEntity } from './notification.entity';

export type NotificationType = NotificationEntity['type'];

type NotificationStreamPayload =
  | {
    type: 'notification.created';
    data: {
      notification: {
        id: number;
        type: NotificationType;
        title: string;
        content: string;
        isRead: boolean;
        relatedType?: string;
        relatedId?: number;
        createdAt: string;
      };
      unreadCount: number;
    };
  }
  | {
    type: 'notification.read';
    data: {
      id: number;
      unreadCount: number;
    };
  }
  | {
    type: 'notification.all_read';
    data: {
      unreadCount: number;
    };
  }
  | {
    type: 'heartbeat';
    data: {
      ts: string;
    };
  };

class NotificationStreamRegistry {
  private readonly clients = new Map<string, Set<Response>>();

  subscribe(tenantId: number, userId: number, res: Response): () => void {
    const key = this.getKey(tenantId, userId);
    const bucket = this.clients.get(key) ?? new Set<Response>();
    bucket.add(res);
    this.clients.set(key, bucket);

    return () => this.unsubscribe(key, res);
  }

  emit(tenantId: number, userId: number, payload: NotificationStreamPayload): void {
    const key = this.getKey(tenantId, userId);
    const bucket = this.clients.get(key);
    if (!bucket?.size) return;

    const frame = this.serialize(payload);
    const staleClients: Response[] = [];

    for (const res of bucket) {
      if (!this.writeFrame(res, frame)) {
        staleClients.push(res);
      }
    }

    for (const res of staleClients) {
      this.unsubscribe(key, res);
    }
  }

  private getKey(tenantId: number, userId: number): string {
    return `${tenantId}:${userId}`;
  }

  emitTo(res: Response, payload: NotificationStreamPayload): boolean {
    return this.writeFrame(res, this.serialize(payload));
  }

  private serialize(payload: NotificationStreamPayload): string {
    return `event: ${payload.type}\ndata: ${JSON.stringify(payload)}\n\n`;
  }

  private writeFrame(res: Response, frame: string): boolean {
    if (res.destroyed || res.writableEnded) return false;
    try {
      res.write(frame);
      return true;
    } catch {
      return false;
    }
  }

  private unsubscribe(key: string, res: Response): void {
    const current = this.clients.get(key);
    if (!current) return;
    current.delete(res);
    if (current.size === 0) {
      this.clients.delete(key);
    }
  }
}

const streamRegistry = new NotificationStreamRegistry();

export class NotificationService {
  private readonly tenantId: number;
  private readonly userId: number;

  constructor(ctx: TenantContext) {
    this.tenantId = ctx.tenantId;
    this.userId = ctx.userId;
  }

  private toStreamNotification(notification: NotificationEntity) {
    return {
      id: notification.id,
      type: notification.type,
      title: notification.title,
      content: notification.content,
      isRead: Boolean(notification.is_read),
      relatedType: notification.related_type,
      relatedId: notification.related_id,
      createdAt: new Date(notification.created_at).toISOString(),
    };
  }

  private async getNotificationById(
    id: number,
    userId = this.userId,
  ): Promise<NotificationEntity | null> {
    const rows = await AppDataSource.query<NotificationEntity[]>(
      `SELECT id, tenant_id, user_id, type, title, content, is_read,
              related_type, related_id, created_at
       FROM notifications
       WHERE id = ? AND tenant_id = ? AND user_id = ?
       LIMIT 1`,
      [id, this.tenantId, userId],
    );
    return rows[0] ?? null;
  }

  private async getUnreadCountForUser(userId = this.userId): Promise<number> {
    const rows = await AppDataSource.query<Array<{ count: number }>>(
      `SELECT COUNT(*) AS count
       FROM notifications
       WHERE tenant_id = ? AND user_id = ? AND is_read = 0`,
      [this.tenantId, userId],
    );
    return Number(rows[0]?.count ?? 0);
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

    const id = Number(result.insertId);
    const [notification, unreadCount] = await Promise.all([
      this.getNotificationById(id, targetUserId),
      this.getUnreadCountForUser(targetUserId),
    ]);

    if (notification) {
      streamRegistry.emit(this.tenantId, targetUserId, {
        type: 'notification.created',
        data: {
          notification: this.toStreamNotification(notification),
          unreadCount,
        },
      });
    }

    return { id };
  }

  /**
   * 分页查询当前登录用户的通知列表，按创建时间倒序。
   */
  async listForUser(
    page: number,
    pageSize: number,
    isRead?: boolean,
  ): Promise<{ list: NotificationEntity[]; total: number }> {
    const offset = (page - 1) * pageSize;
    const conditions = ['tenant_id = ?', 'user_id = ?'];
    const params: Array<number | boolean> = [this.tenantId, this.userId];

    if (isRead !== undefined) {
      conditions.push('is_read = ?');
      params.push(isRead);
    }

    const where = conditions.join(' AND ');

    const [list, countRows] = await Promise.all([
      AppDataSource.query<NotificationEntity[]>(
        `SELECT id, tenant_id, user_id, type, title, content, is_read,
                related_type, related_id, created_at
         FROM notifications
         WHERE ${where}
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?`,
        [...params, pageSize, offset],
      ),
      AppDataSource.query<Array<{ total: number }>>(
        `SELECT COUNT(*) AS total
         FROM notifications
         WHERE ${where}`,
        params,
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
    const rows = await AppDataSource.query<Array<{ id: number; is_read: number }>>(
      `SELECT id, is_read FROM notifications
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

    if (!rows[0]?.is_read) {
      streamRegistry.emit(this.tenantId, this.userId, {
        type: 'notification.read',
        data: {
          id,
          unreadCount: await this.getUnreadCountForUser(),
        },
      });
    }
  }

  /**
   * 将当前用户所有未读通知批量标记为已读。
   */
  async markAllAsRead(): Promise<void> {
    const result = await AppDataSource.query<{ affectedRows?: number }>(
      `UPDATE notifications SET is_read = 1
       WHERE tenant_id = ? AND user_id = ? AND is_read = 0`,
      [this.tenantId, this.userId],
    );

    if (Number(result.affectedRows ?? 0) > 0) {
      streamRegistry.emit(this.tenantId, this.userId, {
        type: 'notification.all_read',
        data: {
          unreadCount: await this.getUnreadCountForUser(),
        },
      });
    }
  }

  /**
   * 获取当前用户未读通知数量。
   */
  async getUnreadCount(): Promise<number> {
    return this.getUnreadCountForUser();
  }

  subscribe(res: Response): () => void {
    return streamRegistry.subscribe(this.tenantId, this.userId, res);
  }

  emitHeartbeat(res?: Response): boolean {
    const payload: NotificationStreamPayload = {
      type: 'heartbeat',
      data: {
        ts: new Date().toISOString(),
      },
    };
    if (res) {
      return streamRegistry.emitTo(res, payload);
    }
    streamRegistry.emit(this.tenantId, this.userId, payload);
    return true;
  }
}
