import { Router } from 'express';
import { authMiddleware, requirePermissionsOrRoles } from '../../middleware/auth';
import { asyncHandler } from '../../app';
import { consumableController } from './consumable.controller';

const router = Router();

router.use(authMiddleware);

router.get(
  '/issues',
  requirePermissionsOrRoles(['consumable:issue:view'], 'warehouse', 'supervisor', 'boss', 'purchase', 'purchaser'),
  asyncHandler(consumableController.listIssueOrders.bind(consumableController)),
);

router.get(
  '/issues/:id',
  requirePermissionsOrRoles(['consumable:issue:view'], 'warehouse', 'supervisor', 'boss', 'purchase', 'purchaser'),
  asyncHandler(consumableController.getIssueOrderById.bind(consumableController)),
);

router.post(
  '/issues',
  requirePermissionsOrRoles(['consumable:issue:create'], 'warehouse', 'supervisor', 'boss'),
  asyncHandler(consumableController.createIssueOrder.bind(consumableController)),
);

router.post(
  '/issues/:id/approve',
  requirePermissionsOrRoles(['consumable:issue:approve'], 'supervisor', 'boss'),
  asyncHandler(consumableController.approveIssueOrder.bind(consumableController)),
);

router.post(
  '/issues/:id/execute',
  requirePermissionsOrRoles(['consumable:issue:execute'], 'warehouse', 'supervisor', 'boss'),
  asyncHandler(consumableController.executeIssueOrder.bind(consumableController)),
);

router.get(
  '/stock',
  requirePermissionsOrRoles(['consumable:stock:view'], 'warehouse', 'supervisor', 'boss', 'purchase', 'purchaser'),
  asyncHandler(consumableController.listStock.bind(consumableController)),
);

export default router;
