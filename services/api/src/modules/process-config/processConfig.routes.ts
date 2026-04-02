import { Router } from 'express';
import { processConfigController, workstationTypeController } from './processConfig.controller';
import { authMiddleware, requireRoles } from '../../middleware/auth';
import { asyncHandler } from '../../app';

const router = Router();

router.use(authMiddleware);

// ── 工种类型 CRUD（固定路由段，必须在 /:id 之前注册）────────────────────────
router.get(
  '/workstation-types',
  asyncHandler(workstationTypeController.list.bind(workstationTypeController)),
);
router.post(
  '/workstation-types',
  requireRoles('boss', 'manager'),
  asyncHandler(workstationTypeController.create.bind(workstationTypeController)),
);
router.patch(
  '/workstation-types/:id',
  requireRoles('boss', 'manager'),
  asyncHandler(workstationTypeController.update.bind(workstationTypeController)),
);
router.delete(
  '/workstation-types/:id',
  requireRoles('boss', 'manager'),
  asyncHandler(workstationTypeController.remove.bind(workstationTypeController)),
);

// ── 工序模板 CRUD ──────────────────────────────────────────────────────────
router.get('/',       asyncHandler(processConfigController.list.bind(processConfigController)));
router.get(
  '/templates/:templateId/step-materials',
  asyncHandler(processConfigController.getStepMaterials.bind(processConfigController)),
);
router.put(
  '/templates/:templateId/step-materials',
  requireRoles('boss', 'manager'),
  asyncHandler(processConfigController.putStepMaterials.bind(processConfigController)),
);
// T-02: 设为默认（固定路由段，必须在 /:id 之前）
router.patch(
  '/:id/set-default',
  requireRoles('boss', 'manager'),
  asyncHandler(processConfigController.setDefault.bind(processConfigController)),
);
router.get('/:id',    asyncHandler(processConfigController.getOne.bind(processConfigController)));
router.post('/',      asyncHandler(processConfigController.create.bind(processConfigController)));
router.put('/:id',    asyncHandler(processConfigController.update.bind(processConfigController)));
router.delete('/:id', asyncHandler(processConfigController.remove.bind(processConfigController)));

// ── R-05: 工序步骤子资源 ──────────────────────────────────────────────────
// BE-05-02: PUT → PATCH for max-hours
router.patch(
  '/steps/:stepId/max-hours',
  requireRoles('boss', 'manager'),
  asyncHandler(processConfigController.putMaxHours.bind(processConfigController)),
);

// 工价查询（所有已登录用户）
router.get(
  '/steps/:stepId/wages',
  asyncHandler(processConfigController.getWages.bind(processConfigController)),
);

// BE-05-03: PUT → PATCH for wages（支持批量数组格式）
router.patch(
  '/steps/:stepId/wages',
  requireRoles('boss', 'manager'),
  asyncHandler(processConfigController.putWages.bind(processConfigController)),
);

// BE-05-01: 工资汇总报表（固定路由段，必须在 /:id 之前）
router.get(
  '/:templateId/wage-summary/export',
  requireRoles('boss', 'manager'),
  asyncHandler(processConfigController.exportWageSummary.bind(processConfigController)),
);

router.get(
  '/:templateId/wage-summary',
  asyncHandler(processConfigController.getWageSummary.bind(processConfigController)),
);

export default router;
