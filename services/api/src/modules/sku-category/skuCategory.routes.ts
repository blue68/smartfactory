import { Router } from 'express';
import { skuCategoryController } from './skuCategory.controller';
import { authMiddleware, requireRoles } from '../../middleware/auth';
import { asyncHandler } from '../../app';

const router = Router();

// 所有路由均需认证
router.use(authMiddleware);

// ─── 读取路由：全角色可访问（SKU 选择器依赖此接口）────────────────────────
router.get(
  '/',
  asyncHandler(skuCategoryController.getTree.bind(skuCategoryController)),
);

// ─── 删除预检：admin 可访问（前端据返回值决定确认弹窗文案）────────────────
router.get(
  '/:id/delete-preview',
  requireRoles('admin', 'boss'),
  asyncHandler(skuCategoryController.deletePreview.bind(skuCategoryController)),
);

// ─── 写入路由：仅 admin / boss 角色可操作 ─────────────────────────────────
router.post(
  '/',
  requireRoles('admin', 'boss'),
  asyncHandler(skuCategoryController.create.bind(skuCategoryController)),
);

// BE-01-02: 审计日志查询（固定路由段，必须在 /:id 之前注册）
router.get(
  '/audit-logs',
  requireRoles('admin', 'boss'),
  asyncHandler(skuCategoryController.getAuditLogs.bind(skuCategoryController)),
);

// BE-01-03: 拖拽重排（固定路由段，必须在 /:id 之前注册）
router.patch(
  '/reorder',
  requireRoles('admin', 'boss'),
  asyncHandler(skuCategoryController.reorder.bind(skuCategoryController)),
);

// BE-01-01: PUT → PATCH
router.patch(
  '/:id',
  requireRoles('admin', 'boss'),
  asyncHandler(skuCategoryController.update.bind(skuCategoryController)),
);

router.delete(
  '/:id',
  requireRoles('admin', 'boss'),
  asyncHandler(skuCategoryController.delete.bind(skuCategoryController)),
);

export default router;
