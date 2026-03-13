import { Router } from 'express';
import { processConfigController } from './processConfig.controller';
import { authMiddleware, requireRoles } from '../../middleware/auth';
import { asyncHandler } from '../../app';

const router = Router();

router.use(authMiddleware);

// ── 工序模板 CRUD ──────────────────────────────────────────────────────────
router.get('/',       asyncHandler(processConfigController.list.bind(processConfigController)));
router.get('/:id',    asyncHandler(processConfigController.getOne.bind(processConfigController)));
router.post('/',      asyncHandler(processConfigController.create.bind(processConfigController)));
router.put('/:id',    asyncHandler(processConfigController.update.bind(processConfigController)));
router.delete('/:id', asyncHandler(processConfigController.remove.bind(processConfigController)));

// ── R-05: 工序步骤子资源 ──────────────────────────────────────────────────
// 极限工时（仅管理员可写）
router.put(
  '/steps/:stepId/max-hours',
  requireRoles('boss', 'manager'),
  asyncHandler(processConfigController.putMaxHours.bind(processConfigController)),
);

// 工价查询（所有已登录用户）
router.get(
  '/steps/:stepId/wages',
  asyncHandler(processConfigController.getWages.bind(processConfigController)),
);

// 工价设置（仅管理员可写）
router.put(
  '/steps/:stepId/wages',
  requireRoles('boss', 'manager'),
  asyncHandler(processConfigController.putWages.bind(processConfigController)),
);

export default router;
