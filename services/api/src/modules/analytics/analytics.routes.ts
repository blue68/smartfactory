import { Router } from 'express';
import { analyticsController } from './analytics.controller';
import { authMiddleware, requirePermissionsOrRoles } from '../../middleware/auth';
import { asyncHandler } from '../../app';

const router = Router();

// 所有报表接口必须携带有效 JWT
router.use(authMiddleware);

// 经营分析接口：权限点优先，旧角色兜底
router.use(requirePermissionsOrRoles(['report:analytics:view'], 'boss', 'supervisor'));

// BE-P2-001: 老板驾驶舱 KPI
router.get(
  '/dashboard-kpi',
  asyncHandler(analyticsController.getDashboardKpi.bind(analyticsController)),
);

// BE-P2-002: 库存结构分析
router.get(
  '/inventory-analysis',
  asyncHandler(analyticsController.getInventoryAnalysis.bind(analyticsController)),
);

// BE-P2-005: 生产效率分析
router.get(
  '/production-efficiency',
  asyncHandler(analyticsController.getProductionEfficiency.bind(analyticsController)),
);

// BE-P2-006: 采购成本分析
router.get(
  '/purchase-cost',
  asyncHandler(analyticsController.getPurchaseCostAnalysis.bind(analyticsController)),
);

// BE-P2-003: 物料品类占比分析
router.get(
  '/material-category-ratio',
  asyncHandler(analyticsController.getMaterialCategoryRatio.bind(analyticsController)),
);

// BE-P2-004: 采购品类分布分析
router.get(
  '/purchase-category',
  asyncHandler(analyticsController.getPurchaseCategoryDistribution.bind(analyticsController)),
);

// 前端兼容别名：/material-ratio → getMaterialCategoryRatio（默认 period_days=90）
router.get(
  '/material-ratio',
  asyncHandler(analyticsController.getMaterialCategoryRatio.bind(analyticsController)),
);

router.get(
  '/inventory-operation',
  asyncHandler(analyticsController.getInventoryOperationReport.bind(analyticsController)),
);

export default router;
