import { Router } from 'express';
import { salesOrderController } from './salesOrder.controller';
import { authMiddleware, requireRoles } from '../../middleware/auth';
import { asyncHandler } from '../../app';

const router = Router();

router.use(authMiddleware);

// ── 固定路由（必须在 /:id 之前）─────────────────────────────────────────────
router.get('/pending-count', asyncHandler(salesOrderController.getPendingCount.bind(salesOrderController)));
router.get('/pending-approvals', requireRoles('boss'), asyncHandler(salesOrderController.getPendingApprovals.bind(salesOrderController)));

// ── 列表与详情 ──────────────────────────────────────────────────────────────
router.get('/',    asyncHandler(salesOrderController.list.bind(salesOrderController)));
router.get('/:id', asyncHandler(salesOrderController.getOne.bind(salesOrderController)));

// ── 创建与编辑 ──────────────────────────────────────────────────────────────
router.post('/',           requireRoles('boss', 'supervisor', 'sales'), asyncHandler(salesOrderController.create.bind(salesOrderController)));
router.put('/:id',         requireRoles('boss', 'supervisor', 'sales'), asyncHandler(salesOrderController.update.bind(salesOrderController)));
router.put('/:id/items',   requireRoles('boss', 'supervisor', 'sales'), asyncHandler(salesOrderController.updateItems.bind(salesOrderController)));

// ── 状态流转 ────────────────────────────────────────────────────────────────
router.post('/:id/transition',  requireRoles('boss', 'supervisor', 'sales'), asyncHandler(salesOrderController.transition.bind(salesOrderController)));
router.post('/:id/submit',      requireRoles('boss', 'supervisor', 'sales'), asyncHandler(salesOrderController.submitForApproval.bind(salesOrderController)));
router.post('/:id/withdraw',    requireRoles('boss', 'supervisor', 'sales'), asyncHandler(salesOrderController.withdraw.bind(salesOrderController)));
router.post('/:id/confirm',     requireRoles('boss', 'supervisor', 'sales'), asyncHandler(salesOrderController.confirm.bind(salesOrderController)));
router.post('/:id/ship',        requireRoles('boss', 'supervisor'), asyncHandler(salesOrderController.ship.bind(salesOrderController)));
router.post('/:id/complete',    requireRoles('boss', 'supervisor'), asyncHandler(salesOrderController.complete.bind(salesOrderController)));
router.post('/:id/close',       requireRoles('boss'), asyncHandler(salesOrderController.close.bind(salesOrderController)));
router.post('/:id/production-orders', requireRoles('boss', 'supervisor'), asyncHandler(salesOrderController.createProductionOrders.bind(salesOrderController)));

// ── 审批（仅 boss）─────────────────────────────────────────────────────────
router.post(
  '/:id/approve',
  requireRoles('boss'),
  asyncHandler(salesOrderController.approve.bind(salesOrderController)),
);
router.post(
  '/:id/reject',
  requireRoles('boss'),
  asyncHandler(salesOrderController.reject.bind(salesOrderController)),
);

export default router;
