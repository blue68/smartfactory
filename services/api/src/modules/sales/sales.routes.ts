import { Router } from 'express';
import { salesController } from './sales.controller';
import { authMiddleware, requireRoles } from '../../middleware/auth';
import { asyncHandler } from '../../app';

const router = Router();
router.use(authMiddleware);

router.get('/',                   asyncHandler(salesController.list.bind(salesController)));

// BE-P2-008: 应收账款汇总（必须在 /:id 之前注册）
router.get('/receivables',
  requireRoles('boss', 'sales'),
  asyncHandler(salesController.getReceivables.bind(salesController)),
);

router.get('/:id',                asyncHandler(salesController.getOne.bind(salesController)));
router.post('/',
  requireRoles('sales', 'boss'),
  asyncHandler(salesController.create.bind(salesController)),
);
router.post('/:id/approve',
  requireRoles('boss'),
  asyncHandler(salesController.approve.bind(salesController)),
);
router.post('/analyze-urgent',
  requireRoles('sales', 'boss', 'supervisor'),
  asyncHandler(salesController.analyzeUrgent.bind(salesController)),
);

// BE-P1-006: 修改销售订单（注意：必须在 /:id/cancel 之前注册，避免路由冲突）
router.put('/orders/:id',
  requireRoles('sales', 'boss'),
  asyncHandler(salesController.updateOrder.bind(salesController)),
);

// BE-P1-007: 取消销售订单
router.post('/orders/:id/cancel',
  requireRoles('sales', 'boss'),
  asyncHandler(salesController.cancelOrder.bind(salesController)),
);

// BE-P2-007: 发货确认（仓库/主管操作）
router.post('/:id/ship',
  requireRoles('warehouse', 'supervisor'),
  asyncHandler(salesController.shipOrder.bind(salesController)),
);

// BE-P2-007: 收货确认（老板/主管/销售确认）
router.post('/:id/deliveries/:deliveryId/confirm',
  requireRoles('boss', 'supervisor', 'sales'),
  asyncHandler(salesController.confirmReceipt.bind(salesController)),
);

// BE-P2-008: 财务结算
router.post('/:id/settlement',
  requireRoles('boss', 'sales'),
  asyncHandler(salesController.createSettlement.bind(salesController)),
);
router.post('/settlements/:settlementId/payments',
  requireRoles('boss', 'sales'),
  asyncHandler(salesController.recordPayment.bind(salesController)),
);
router.put('/settlements/:settlementId/invoice',
  requireRoles('boss', 'sales'),
  asyncHandler(salesController.updateInvoice.bind(salesController)),
);

export default router;
