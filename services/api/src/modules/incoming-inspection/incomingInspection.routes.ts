import { Router } from 'express';
import { incomingInspectionController } from './incomingInspection.controller';
import { authMiddleware, requirePermissionsOrRoles } from '../../middleware/auth';
import { asyncHandler } from '../../app';

const router = Router();

// 所有路由均须通过 JWT 认证
router.use(authMiddleware);

/**
 * GET /api/incoming-inspections
 * 分页查询质检单列表
 * 支持筛选：status / poId / dateFrom / dateTo / result
 */
router.get(
  '/',
  requirePermissionsOrRoles(['quality:create'], 'warehouse', 'supervisor', 'boss', 'qc'),
  asyncHandler(incomingInspectionController.list.bind(incomingInspectionController)),
);

/**
 * GET /api/incoming-inspections/:id
 * 质检单详情（含质检明细）
 */
router.get(
  '/:id',
  requirePermissionsOrRoles(['quality:create'], 'warehouse', 'supervisor', 'boss', 'qc'),
  asyncHandler(incomingInspectionController.getById.bind(incomingInspectionController)),
);

/**
 * POST /api/incoming-inspections
 * 创建质检单（从送货单自动带入明细）
 * 权限：warehouse / supervisor / boss / qc
 */
router.post(
  '/',
  requirePermissionsOrRoles(['quality:create'], 'warehouse', 'supervisor', 'boss', 'qc'),
  asyncHandler(incomingInspectionController.create.bind(incomingInspectionController)),
);

/**
 * PUT /api/incoming-inspections/:id/items
 * 更新质检明细（逐行录入检验结果）
 * 权限：warehouse / supervisor / boss / qc
 */
router.put(
  '/:id/items',
  requirePermissionsOrRoles(['quality:create'], 'warehouse', 'supervisor', 'boss', 'qc'),
  asyncHandler(incomingInspectionController.updateItems.bind(incomingInspectionController)),
);

/**
 * POST /api/incoming-inspections/:id/submit
 * 提交质检结论
 * 核心事务：合格品自动入库 + 不合格品自动生成退货单（BD-004）
 * 权限：warehouse / supervisor / boss / qc
 */
router.post(
  '/:id/submit',
  requirePermissionsOrRoles(['quality:complete'], 'warehouse', 'supervisor', 'boss', 'qc'),
  asyncHandler(incomingInspectionController.submit.bind(incomingInspectionController)),
);

/**
 * GET /api/incoming-inspections/:id/preview-receipt
 * 预览质检通过后的入库单信息
 */
router.get(
  '/:id/preview-receipt',
  requirePermissionsOrRoles(['quality:create'], 'warehouse', 'supervisor', 'boss', 'qc'),
  asyncHandler(incomingInspectionController.previewReceipt.bind(incomingInspectionController)),
);

export default router;
