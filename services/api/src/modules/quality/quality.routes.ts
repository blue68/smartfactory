import { Router } from 'express';
import { qualityController } from './quality.controller';
import { authMiddleware, requirePermissionsOrRoles } from '../../middleware/auth';
import { asyncHandler } from '../../app';

const router = Router();
router.use(authMiddleware);

router.get('/inspections', requirePermissionsOrRoles(['quality:view'], 'qc', 'supervisor', 'boss', 'admin'), asyncHandler(qualityController.listInspections.bind(qualityController)));
router.get('/production-orders/options',
  requirePermissionsOrRoles(['quality:create'], 'qc', 'supervisor', 'boss', 'admin'),
  asyncHandler(qualityController.listProductionOrderOptions.bind(qualityController)),
);
router.get('/inspection-options',
  requirePermissionsOrRoles(['quality:create'], 'qc', 'supervisor', 'boss', 'admin'),
  asyncHandler(qualityController.listInspectionOptions.bind(qualityController)),
);
router.post('/inspections',
  requirePermissionsOrRoles(['quality:create'], 'qc', 'supervisor'),
  asyncHandler(qualityController.createInspection.bind(qualityController)),
);
router.post('/inspections/issues',
  requirePermissionsOrRoles(['quality:issue:create'], 'qc'),
  asyncHandler(qualityController.recordIssue.bind(qualityController)),
);
router.post('/inspections/:id/complete',
  requirePermissionsOrRoles(['quality:complete'], 'qc'),
  asyncHandler(qualityController.completeInspection.bind(qualityController)),
);
router.get('/traceability/:productionOrderId', requirePermissionsOrRoles(['quality:view'], 'qc', 'supervisor', 'boss', 'admin', 'sales'), asyncHandler(qualityController.getTraceability.bind(qualityController)));
router.get('/stats',
  requirePermissionsOrRoles(['quality:view'], 'qc', 'supervisor', 'boss'),
  asyncHandler(qualityController.getStats.bind(qualityController)),
);
router.get('/issues', requirePermissionsOrRoles(['quality:view'], 'qc', 'supervisor', 'boss', 'admin', 'sales'), asyncHandler(qualityController.listIssues.bind(qualityController)));
router.get('/issues/:id', requirePermissionsOrRoles(['quality:view'], 'qc', 'supervisor', 'boss', 'admin', 'sales'), asyncHandler(qualityController.getIssueDetail.bind(qualityController)));

export default router;
