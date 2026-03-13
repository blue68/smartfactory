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

router.put(
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
