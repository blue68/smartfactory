import { Router } from 'express';
import { authMiddleware, requirePermissionsOrRoles } from '../../middleware/auth';
import { asyncHandler } from '../../app';
import { productionModeReportController } from './productionMode.controller';

const router = Router();

router.use(authMiddleware);

router.get(
  '/semi-finished',
  requirePermissionsOrRoles(['report:analytics:view'], 'boss', 'supervisor', 'admin'),
  asyncHandler(productionModeReportController.getSemiFinishedModeReport.bind(productionModeReportController)),
);

export default router;
