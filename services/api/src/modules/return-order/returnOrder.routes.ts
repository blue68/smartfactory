import { Router } from 'express';
import { returnOrderController } from './returnOrder.controller';
import { authMiddleware, requirePermissionsOrRoles } from '../../middleware/auth';
import { asyncHandler } from '../../app';

const router = Router();

// 所有路由均须通过 JWT 认证
router.use(authMiddleware);

/**
 * GET /api/return-orders
 * 分页查询退货单列表
 * 支持筛选：status / returnType / supplierId / dateFrom / dateTo
 */
router.get(
  '/',
  requirePermissionsOrRoles(['purchase:return:view'], 'warehouse', 'supervisor', 'boss', 'purchase', 'purchaser'),
  asyncHandler(returnOrderController.list.bind(returnOrderController)),
);

/**
 * GET /api/return-orders/:id
 * 退货单详情（含退货明细）
 */
router.get(
  '/:id',
  requirePermissionsOrRoles(['purchase:return:view'], 'warehouse', 'supervisor', 'boss', 'purchase', 'purchaser'),
  asyncHandler(returnOrderController.getById.bind(returnOrderController)),
);

/**
 * POST /api/return-orders
 * 手动创建退货单（质检自动触发走 incomingInspection.submit 内部路径）
 * 权限：warehouse / supervisor / boss
 */
router.post(
  '/',
  requirePermissionsOrRoles(['purchase:return:create'], 'warehouse', 'supervisor', 'boss'),
  asyncHandler(returnOrderController.create.bind(returnOrderController)),
);

/**
 * PUT /api/return-orders/:id/confirm
 * 确认退货单（draft → confirmed）
 * 权限：supervisor / boss
 */
router.put(
  '/:id/confirm',
  requirePermissionsOrRoles(['purchase:return:confirm'], 'supervisor', 'boss'),
  asyncHandler(returnOrderController.confirm.bind(returnOrderController)),
);

/**
 * PUT /api/return-orders/:id/ship
 * 标记退货货物已发出（confirmed → shipped）
 * 权限：warehouse / supervisor
 */
router.put(
  '/:id/ship',
  requirePermissionsOrRoles(['purchase:return:ship'], 'warehouse', 'supervisor'),
  asyncHandler(returnOrderController.ship.bind(returnOrderController)),
);

/**
 * PUT /api/return-orders/:id/complete
 * 标记退货完成（shipped → completed）
 * 权限：warehouse / supervisor / boss
 */
router.put(
  '/:id/complete',
  requirePermissionsOrRoles(['purchase:return:complete'], 'warehouse', 'supervisor', 'boss'),
  asyncHandler(returnOrderController.complete.bind(returnOrderController)),
);

export default router;
