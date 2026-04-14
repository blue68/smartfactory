import { Router } from 'express';
import { asyncHandler } from '../../app';
import { authMiddleware, requirePermissionsOrRoles } from '../../middleware/auth';
import { departmentController } from './department.controller';

const router = Router();

router.use(authMiddleware);

router.get(
  '/',
  requirePermissionsOrRoles(
    ['system.user.manage', 'asset:view', 'consumable:issue:view'],
    'boss',
    'supervisor',
    'warehouse',
    'purchase',
    'purchaser',
    'admin',
  ),
  asyncHandler(departmentController.list.bind(departmentController)),
);

router.post(
  '/',
  requirePermissionsOrRoles(['system.user.manage'], 'boss', 'supervisor', 'admin'),
  asyncHandler(departmentController.create.bind(departmentController)),
);

router.put(
  '/:id',
  requirePermissionsOrRoles(['system.user.manage'], 'boss', 'supervisor', 'admin'),
  asyncHandler(departmentController.update.bind(departmentController)),
);

router.post(
  '/:id/status',
  requirePermissionsOrRoles(['system.user.manage'], 'boss', 'supervisor', 'admin'),
  asyncHandler(departmentController.updateStatus.bind(departmentController)),
);

export default router;
