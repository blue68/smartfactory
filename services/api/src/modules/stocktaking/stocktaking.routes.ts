import { Router } from 'express';
import { stocktakingController } from './stocktaking.controller';
import { authMiddleware, requirePermissionsOrRoles } from '../../middleware/auth';
import { asyncHandler } from '../../app';

const router = Router();

// 所有盘点接口需要登录
router.use(authMiddleware);

// F-105: 创建盘点任务
router.post(
  '/',
  requirePermissionsOrRoles(['stocktaking:create'], 'boss', 'warehouse'),
  asyncHandler(stocktakingController.createTask.bind(stocktakingController)),
);

// F-105: 盘点任务列表
router.get(
  '/',
  requirePermissionsOrRoles(['stocktaking:view'], 'boss', 'warehouse', 'supervisor'),
  asyncHandler(stocktakingController.listTasks.bind(stocktakingController)),
);

// F-105: 盘点任务详情（含明细）
router.get(
  '/:id',
  requirePermissionsOrRoles(['stocktaking:view'], 'boss', 'warehouse', 'supervisor'),
  asyncHandler(stocktakingController.getTask.bind(stocktakingController)),
);

// F-105: 导出盘点表（Excel）
router.post(
  '/:id/export',
  requirePermissionsOrRoles(['stocktaking:view'], 'boss', 'warehouse', 'supervisor'),
  asyncHandler(stocktakingController.exportTask.bind(stocktakingController)),
);

// F-105: 批量录入盘点结果
router.put(
  '/:id/items',
  requirePermissionsOrRoles(['stocktaking:create'], 'boss', 'warehouse'),
  asyncHandler(stocktakingController.updateItems.bind(stocktakingController)),
);

// F-105: 差异分析报告
router.get(
  '/:id/diff',
  requirePermissionsOrRoles(['stocktaking:view'], 'boss', 'warehouse', 'supervisor'),
  asyncHandler(stocktakingController.getDiff.bind(stocktakingController)),
);

// F-105: 提交待确认（warehouse/boss）
router.post(
  '/:id/submit',
  requirePermissionsOrRoles(['stocktaking:submit'], 'boss', 'warehouse'),
  asyncHandler(stocktakingController.submitTask.bind(stocktakingController)),
);

// 库存仓位对齐：盘点差异一键生成调整单（支持预览/执行）
router.post(
  '/:id/adjustment-order',
  requirePermissionsOrRoles(['stocktaking:confirm'], 'boss'),
  asyncHandler(stocktakingController.createAdjustmentOrder.bind(stocktakingController)),
);

// F-105: 确认盘点（仅 boss，调整库存）
router.post(
  '/:id/confirm',
  requirePermissionsOrRoles(['stocktaking:confirm'], 'boss'),
  asyncHandler(stocktakingController.confirmTask.bind(stocktakingController)),
);

export default router;
