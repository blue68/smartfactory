import { Router } from 'express';
import { salesOrderController } from './salesOrder.controller';
import { authMiddleware, requireRoles } from '../../middleware/auth';
import { asyncHandler } from '../../app';

const router = Router();

router.use(authMiddleware);

// ── 待审批数量（固定路由，必须在 /:id 之前）─────────────────────────────────
router.get('/pending-count', asyncHandler(salesOrderController.getPendingCount.bind(salesOrderController)));

// ── 列表与详情 ──────────────────────────────────────────────────────────────
router.get('/',    asyncHandler(salesOrderController.list.bind(salesOrderController)));
router.get('/:id', asyncHandler(salesOrderController.getOne.bind(salesOrderController)));

// ── 创建与编辑 ──────────────────────────────────────────────────────────────
router.post('/',           asyncHandler(salesOrderController.create.bind(salesOrderController)));
router.put('/:id/items',   asyncHandler(salesOrderController.updateItems.bind(salesOrderController)));

// ── 状态流转 ────────────────────────────────────────────────────────────────
router.post('/:id/transition',  asyncHandler(salesOrderController.transition.bind(salesOrderController)));
router.post('/:id/submit',      asyncHandler(salesOrderController.submitForApproval.bind(salesOrderController)));
router.post('/:id/withdraw',    asyncHandler(salesOrderController.withdraw.bind(salesOrderController)));

// ── 审批（仅 boss）─────────────────────────────────────────────────────────
// 系统中不存在 admin 角色，审批权限统一由 boss 角色持有
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
