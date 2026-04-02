import { Request, Response } from 'express';
import { z } from 'zod';
import { NotificationService } from './notification.service';
import { success, buildPaginated } from '../../shared/ApiResponse';
import { PaginationSchema } from '../../middleware/validator';
import { ResponseGenerator } from '../ai/response.generator';

const NotificationListQuerySchema = PaginationSchema.extend({
  isRead: z.coerce.boolean().optional(),
});

export class NotificationController {
  /** 从请求上下文构造 service 实例（租户 + 用户隔离） */
  private svc(req: Request): NotificationService {
    return new NotificationService({ tenantId: req.tenantId, userId: req.userId });
  }

  /**
   * GET /api/notifications
   * 分页查询当前用户通知列表
   */
  async list(req: Request, res: Response): Promise<void> {
    const q = NotificationListQuerySchema.parse(req.query);
    const { list, total } = await this.svc(req).listForUser(q.page, q.pageSize, q.isRead);
    success(res, buildPaginated(list, total, q.page, q.pageSize));
  }

  /**
   * GET /api/notifications/unread-count
   * 获取当前用户未读通知数
   */
  async unreadCount(req: Request, res: Response): Promise<void> {
    const count = await this.svc(req).getUnreadCount();
    success(res, { count });
  }

  async stream(req: Request, res: Response): Promise<void> {
    ResponseGenerator.setSseHeaders(res);

    const svc = this.svc(req);
    const unsubscribe = svc.subscribe(res);
    const heartbeat = setInterval(() => svc.emitHeartbeat(), 25_000);

    svc.emitHeartbeat();

    req.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
      res.end();
    });
  }

  /**
   * PUT /api/notifications/:id/read
   * 标记单条通知为已读
   */
  async markAsRead(req: Request, res: Response): Promise<void> {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    await this.svc(req).markAsRead(id);
    success(res, null, '已标记为已读');
  }

  /**
   * PUT /api/notifications/read-all
   * 标记当前用户全部通知为已读
   */
  async markAllAsRead(req: Request, res: Response): Promise<void> {
    await this.svc(req).markAllAsRead();
    success(res, null, '全部已标记为已读');
  }
}

export const notificationController = new NotificationController();
