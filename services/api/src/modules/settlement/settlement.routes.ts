import { Router } from 'express';
import { settlementController } from './settlement.controller';
import { authMiddleware, requireRoles } from '../../middleware/auth';
import { asyncHandler } from '../../app';

const router = Router();

// 所有结算接口需要登录
router.use(authMiddleware);

// F-707: 应收账款汇总 — 必须在 /:id 路由之前注册，防止路径被参数捕获
router.get(
  '/receivable',
  requireRoles('boss', 'supervisor'),
  asyncHandler(settlementController.getReceivable.bind(settlementController)),
);

router.get(
  '/export/csv',
  requireRoles('boss', 'supervisor'),
  asyncHandler(settlementController.exportCsv.bind(settlementController)),
);

// F-707: 创建结算单（从已交付订单生成）
router.post(
  '/',
  requireRoles('boss', 'supervisor'),
  asyncHandler(settlementController.createSettlement.bind(settlementController)),
);

// F-707: 结算单列表
router.get(
  '/',
  requireRoles('boss', 'supervisor', 'sales'),
  asyncHandler(settlementController.listSettlements.bind(settlementController)),
);

// F-707: 结算单详情
router.get(
  '/:id',
  requireRoles('boss', 'supervisor', 'sales'),
  asyncHandler(settlementController.getSettlement.bind(settlementController)),
);

// F-707: 确认结算（仅 boss）
router.put(
  '/:id/confirm',
  requireRoles('boss'),
  asyncHandler(settlementController.confirmSettlement.bind(settlementController)),
);

// F-707: 标记已付款（仅 boss）
router.put(
  '/:id/pay',
  requireRoles('boss'),
  asyncHandler(settlementController.paySettlement.bind(settlementController)),
);

// F-707: 取消结算单（boss / supervisor）
router.put(
  '/:id/cancel',
  requireRoles('boss', 'supervisor'),
  asyncHandler(settlementController.cancelSettlement.bind(settlementController)),
);

export default router;
