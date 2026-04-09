import { Router } from 'express';
import { settlementController } from './settlement.controller';
import { authMiddleware, requirePermissionsOrRoles } from '../../middleware/auth';
import { asyncHandler } from '../../app';

const router = Router();

// 所有结算接口需要登录
router.use(authMiddleware);

// F-707: 应收账款汇总 — 必须在 /:id 路由之前注册，防止路径被参数捕获
router.get(
  '/receivable',
  requirePermissionsOrRoles(['settlement:receivable:view'], 'boss', 'supervisor'),
  asyncHandler(settlementController.getReceivable.bind(settlementController)),
);

router.get(
  '/export/csv',
  requirePermissionsOrRoles(['settlement:manage'], 'boss', 'supervisor'),
  asyncHandler(settlementController.exportCsv.bind(settlementController)),
);

// F-707: 创建结算单（从已交付订单生成）
router.post(
  '/',
  requirePermissionsOrRoles(['settlement:manage'], 'boss', 'supervisor'),
  asyncHandler(settlementController.createSettlement.bind(settlementController)),
);

// F-707: 待结算销售订单（用于新建结算入口）
router.get(
  '/pending-orders',
  requirePermissionsOrRoles(['settlement:pending:view'], 'boss', 'supervisor', 'sales'),
  asyncHandler(settlementController.listPendingOrders.bind(settlementController)),
);

// F-707: 结算单列表
router.get(
  '/',
  requirePermissionsOrRoles(['settlement:manage', 'settlement:pending:view'], 'boss', 'supervisor', 'sales'),
  asyncHandler(settlementController.listSettlements.bind(settlementController)),
);

// F-707: 结算单详情
router.get(
  '/:id',
  requirePermissionsOrRoles(['settlement:manage', 'settlement:pending:view'], 'boss', 'supervisor', 'sales'),
  asyncHandler(settlementController.getSettlement.bind(settlementController)),
);

// F-707: 确认结算（仅 boss）
router.put(
  '/:id/confirm',
  requirePermissionsOrRoles(['settlement:boss'], 'boss'),
  asyncHandler(settlementController.confirmSettlement.bind(settlementController)),
);

// F-707: 标记已付款（仅 boss）
router.put(
  '/:id/pay',
  requirePermissionsOrRoles(['settlement:boss'], 'boss'),
  asyncHandler(settlementController.paySettlement.bind(settlementController)),
);

// F-707: 取消结算单（boss / supervisor）
router.put(
  '/:id/cancel',
  requirePermissionsOrRoles(['settlement:manage'], 'boss', 'supervisor'),
  asyncHandler(settlementController.cancelSettlement.bind(settlementController)),
);

export default router;
