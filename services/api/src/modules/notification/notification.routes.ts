import { Router } from 'express';
import { notificationController } from './notification.controller';
import { authMiddleware } from '../../middleware/auth';
import { asyncHandler } from '../../app';

const router = Router();

// 所有通知接口均需认证
router.use(authMiddleware);

// 注意：固定路径 /unread-count 和 /read-all 必须在参数路径 /:id/read 之前注册，
// 否则 Express 会将 "unread-count" / "read-all" 错误匹配为 :id 参数。

// GET /api/notifications — 分页查询通知列表
router.get(
  '/',
  asyncHandler(notificationController.list.bind(notificationController)),
);

// GET /api/notifications/unread-count — 未读数量
router.get(
  '/unread-count',
  asyncHandler(notificationController.unreadCount.bind(notificationController)),
);

// GET /api/notifications/stream — SSE 实时通知流
router.get(
  '/stream',
  asyncHandler(notificationController.stream.bind(notificationController)),
);

// PUT /api/notifications/read-all — 全部标记已读（固定路由，必须在 /:id/read 之前）
router.put(
  '/read-all',
  asyncHandler(notificationController.markAllAsRead.bind(notificationController)),
);

// PUT /api/notifications/:id/read — 单条标记已读
router.put(
  '/:id/read',
  asyncHandler(notificationController.markAsRead.bind(notificationController)),
);

export default router;
