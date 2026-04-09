import { Router } from 'express';
import { wageController } from './wage.controller';
import { authMiddleware, requirePermissionsOrRoles } from '../../middleware/auth';
import { asyncHandler } from '../../app';

const router = Router();

router.use(authMiddleware);

// GET /api/reports/wages/export — 导出工资报表（固定路由，必须在 / 之前）
router.get(
  '/export',
  requirePermissionsOrRoles(['report:wage:manage'], 'boss', 'manager'),
  asyncHandler(wageController.exportExcel.bind(wageController)),
);

router.get(
  '/tasks',
  requirePermissionsOrRoles(['report:wage:manage'], 'boss', 'manager'),
  asyncHandler(wageController.getTaskWageReport.bind(wageController)),
);

// GET /api/reports/wages — 管理员工资报表
router.get(
  '/',
  requirePermissionsOrRoles(['report:wage:manage'], 'boss', 'manager'),
  asyncHandler(wageController.getWageReport.bind(wageController)),
);

// GET /api/reports/wages/my — 当前用户自查工资
router.get(
  '/my',
  asyncHandler(wageController.getMyWages.bind(wageController)),
);

export default router;
