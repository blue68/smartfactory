import { Router } from 'express';
import { qualityController } from './quality.controller';
import { authMiddleware, requireRoles } from '../../middleware/auth';
import { asyncHandler } from '../../app';

const router = Router();
router.use(authMiddleware);

router.get('/inspections',               asyncHandler(qualityController.listInspections.bind(qualityController)));
router.post('/inspections',
  requireRoles('qc', 'supervisor'),
  asyncHandler(qualityController.createInspection.bind(qualityController)),
);
router.post('/inspections/issues',
  requireRoles('qc'),
  asyncHandler(qualityController.recordIssue.bind(qualityController)),
);
router.post('/inspections/:id/complete',
  requireRoles('qc'),
  asyncHandler(qualityController.completeInspection.bind(qualityController)),
);
router.get('/traceability/:productionOrderId', asyncHandler(qualityController.getTraceability.bind(qualityController)));
router.get('/stats',
  requireRoles('qc', 'supervisor', 'boss'),
  asyncHandler(qualityController.getStats.bind(qualityController)),
);
router.get('/issues',                          asyncHandler(qualityController.listIssues.bind(qualityController)));
router.get('/issues/:id',                      asyncHandler(qualityController.getIssueDetail.bind(qualityController)));

export default router;
