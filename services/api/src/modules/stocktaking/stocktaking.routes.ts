import { Router } from 'express';
import { stocktakingController } from './stocktaking.controller';
import { authMiddleware, requireRoles } from '../../middleware/auth';
import { asyncHandler } from '../../app';

const router = Router();

// 所有盘点接口需要登录
router.use(authMiddleware);

// F-105: 创建盘点任务
router.post(
  '/',
  requireRoles('boss', 'warehouse'),
  asyncHandler(stocktakingController.createTask.bind(stocktakingController)),
);

// F-105: 盘点任务列表
router.get(
  '/',
  requireRoles('boss', 'warehouse', 'supervisor'),
  asyncHandler(stocktakingController.listTasks.bind(stocktakingController)),
);

// F-105: 盘点任务详情（含明细）
router.get(
  '/:id',
  requireRoles('boss', 'warehouse', 'supervisor'),
  asyncHandler(stocktakingController.getTask.bind(stocktakingController)),
);

// F-105: 导出盘点表（Excel）
router.post(
  '/:id/export',
  requireRoles('boss', 'warehouse', 'supervisor'),
  asyncHandler(stocktakingController.exportTask.bind(stocktakingController)),
);

// F-105: 批量录入盘点结果
router.put(
  '/:id/items',
  requireRoles('boss', 'warehouse'),
  asyncHandler(stocktakingController.updateItems.bind(stocktakingController)),
);

// F-105: 差异分析报告
router.get(
  '/:id/diff',
  requireRoles('boss', 'warehouse', 'supervisor'),
  asyncHandler(stocktakingController.getDiff.bind(stocktakingController)),
);

// F-105: 确认盘点（仅 boss，调整库存）
router.post(
  '/:id/confirm',
  requireRoles('boss'),
  asyncHandler(stocktakingController.confirmTask.bind(stocktakingController)),
);

export default router;
