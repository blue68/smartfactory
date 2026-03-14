import { Router } from 'express';
import { mrpController } from './mrp.controller';
import { authMiddleware, requireRoles } from '../../middleware/auth';
import { asyncHandler } from '../../app';

const router = Router();
router.use(authMiddleware);

// GET /api/mrp/shortage-report/:productionOrderId — 获取工单缺料报告明细
router.get(
  '/shortage-report/:productionOrderId',
  asyncHandler(mrpController.getShortageReport.bind(mrpController)),
);

// GET /api/mrp/shortage-summary — 全局缺料汇总（跨工单合并同类项）
router.get(
  '/shortage-summary',
  asyncHandler(mrpController.getGlobalShortageSummary.bind(mrpController)),
);

// POST /api/mrp/generate-suggestions — 基于缺料生成采购建议
// 权限：采购员、主管、老板
router.post(
  '/generate-suggestions',
  requireRoles('purchase', 'supervisor', 'boss'),
  asyncHandler(mrpController.generateSuggestions.bind(mrpController)),
);

// POST /api/mrp/reevaluate — 入库后重新评估缺料状态
router.post(
  '/reevaluate',
  asyncHandler(mrpController.reevaluateAfterReceipt.bind(mrpController)),
);

// GET /api/mrp/supply-chain-dashboard — 供应链状态看板数据
router.get(
  '/supply-chain-dashboard',
  asyncHandler(mrpController.getSupplyChainDashboard.bind(mrpController)),
);

export default router;
