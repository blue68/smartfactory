import { Router } from 'express';
import { salesOrderController } from './salesOrder.controller';
import { authMiddleware, requirePermissionsOrRoles } from '../../middleware/auth';
import { asyncHandler } from '../../app';

const router = Router();

router.use(authMiddleware);

// ── 固定路由（必须在 /:id 之前）─────────────────────────────────────────────
router.get('/pending-count', requirePermissionsOrRoles(['sales:order:view'], 'boss', 'supervisor', 'sales'), asyncHandler(salesOrderController.getPendingCount.bind(salesOrderController)));
router.get('/pending-approvals', requirePermissionsOrRoles(['sales:order-list:approve'], 'boss'), asyncHandler(salesOrderController.getPendingApprovals.bind(salesOrderController)));
router.get('/stats', requirePermissionsOrRoles(['sales:order:view'], 'boss', 'supervisor', 'sales'), asyncHandler(salesOrderController.getStats.bind(salesOrderController)));
router.get(
  '/capacity-check',
  requirePermissionsOrRoles(['sales:order:urgent-analyze'], 'boss', 'supervisor', 'sales'),
  asyncHandler(salesOrderController.capacityCheck.bind(salesOrderController)),
);

// ── 列表与详情 ──────────────────────────────────────────────────────────────
router.get('/',    requirePermissionsOrRoles(['sales:order:view'], 'boss', 'supervisor', 'sales'), asyncHandler(salesOrderController.list.bind(salesOrderController)));
router.get('/:id', requirePermissionsOrRoles(['sales:order:view'], 'boss', 'supervisor', 'sales'), asyncHandler(salesOrderController.getOne.bind(salesOrderController)));

// ── 创建与编辑 ──────────────────────────────────────────────────────────────
router.post('/',           requirePermissionsOrRoles(['sales:order-list:create', 'sales:order:create'], 'boss', 'supervisor', 'sales'), asyncHandler(salesOrderController.create.bind(salesOrderController)));
router.put('/:id',         requirePermissionsOrRoles(['sales:order-list:create', 'sales:order:create'], 'boss', 'supervisor', 'sales'), asyncHandler(salesOrderController.update.bind(salesOrderController)));
router.put('/:id/items',   requirePermissionsOrRoles(['sales:order-list:create', 'sales:order:create'], 'boss', 'supervisor', 'sales'), asyncHandler(salesOrderController.updateItems.bind(salesOrderController)));

// ── 状态流转 ────────────────────────────────────────────────────────────────
router.post('/:id/transition',  requirePermissionsOrRoles(['sales:order-list:create', 'sales:order:create'], 'boss', 'supervisor', 'sales'), asyncHandler(salesOrderController.transition.bind(salesOrderController)));
router.post('/:id/submit',      requirePermissionsOrRoles(['sales:order-list:create', 'sales:order:create'], 'boss', 'supervisor', 'sales'), asyncHandler(salesOrderController.submitForApproval.bind(salesOrderController)));
router.post('/:id/withdraw',    requirePermissionsOrRoles(['sales:order-list:create', 'sales:order:create'], 'boss', 'supervisor', 'sales'), asyncHandler(salesOrderController.withdraw.bind(salesOrderController)));
router.post('/:id/confirm',     requirePermissionsOrRoles(['sales:order-list:create', 'sales:order:create'], 'boss', 'supervisor', 'sales'), asyncHandler(salesOrderController.confirm.bind(salesOrderController)));
router.post('/:id/ship',        requirePermissionsOrRoles(['sales:order-list:ship'], 'boss', 'supervisor'), asyncHandler(salesOrderController.ship.bind(salesOrderController)));
router.post('/:id/complete',    requirePermissionsOrRoles(['sales:order-list:ship'], 'boss', 'sales'), asyncHandler(salesOrderController.complete.bind(salesOrderController)));
router.post('/:id/close',       requirePermissionsOrRoles(['sales:order-list:approve'], 'boss'), asyncHandler(salesOrderController.close.bind(salesOrderController)));
router.post('/:id/production-orders', requirePermissionsOrRoles(['sales:order-list:ship'], 'boss', 'supervisor'), asyncHandler(salesOrderController.createProductionOrders.bind(salesOrderController)));

// ── 审批（仅 boss）─────────────────────────────────────────────────────────
router.post(
  '/:id/approve',
  requirePermissionsOrRoles(['sales:order-list:approve', 'sales:order:approve'], 'boss'),
  asyncHandler(salesOrderController.approve.bind(salesOrderController)),
);
router.post(
  '/:id/reject',
  requirePermissionsOrRoles(['sales:order-list:approve', 'sales:order:approve'], 'boss'),
  asyncHandler(salesOrderController.reject.bind(salesOrderController)),
);

export default router;
