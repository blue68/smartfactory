import { Router } from 'express';
import { productionController } from './production.controller';
import { productionOrderController } from './production-order.controller';
import { authMiddleware, requireRoles } from '../../middleware/auth';
import { asyncHandler } from '../../app';

const router = Router();
router.use(authMiddleware);

// BE-P2-009: 工作日历（固定路由段，必须在参数路由之前注册）
router.get('/work-calendar',
  asyncHandler(productionController.getWorkCalendar.bind(productionController)),
);
router.post('/work-calendar/holiday',
  requireRoles('boss', 'supervisor'),
  asyncHandler(productionController.setHoliday.bind(productionController)),
);

// BE-P1-008: 生产进度看板（必须在参数路由之前注册）
router.get('/dashboard',           asyncHandler(productionController.getDashboard.bind(productionController)));

// BE-P1: 工人和工作站列表（固定路由，必须在 /:id 参数路由之前）
router.get('/workers',             asyncHandler(productionController.listWorkers.bind(productionController)));
router.get('/workstations',        asyncHandler(productionController.listWorkstations.bind(productionController)));

// BE-P1: 排产手动调整（固定路由段，必须在 /:date 参数路由之前）
router.put('/schedule/:date/adjust',
  requireRoles('supervisor', 'boss'),
  asyncHandler(productionController.adjustSchedule.bind(productionController)),
);

// 生产工单
router.get('/orders',              asyncHandler(productionController.listOrders.bind(productionController)));

// Sprint 3: 销售订单触发工单创建（固定路由，必须在 /orders/:id 之前）
router.post('/orders/from-sales-order/:salesOrderId',
  requireRoles('supervisor', 'boss'),
  asyncHandler(productionOrderController.createFromSalesOrder.bind(productionOrderController)),
);

router.get('/orders/:id',          asyncHandler(productionController.getOrder.bind(productionController)));
router.post('/orders',
  requireRoles('supervisor', 'boss'),
  asyncHandler(productionController.createOrder.bind(productionController)),
);

// Sprint 3: 工单物料需求和缺料检测
router.get('/orders/:id/materials',
  asyncHandler(productionOrderController.getMaterialRequirements.bind(productionOrderController)),
);
router.get('/orders/:id/material-check',
  asyncHandler(productionOrderController.checkMaterialStatus.bind(productionOrderController)),
);
router.put('/orders/:id/cancel',
  requireRoles('supervisor', 'boss'),
  asyncHandler(productionOrderController.cancelOrder.bind(productionOrderController)),
);

// 排产计划
router.get('/schedule/generate',
  requireRoles('supervisor', 'boss'),
  asyncHandler(productionController.generateSchedule.bind(productionController)),
);
router.post('/schedule/confirm',
  requireRoles('supervisor', 'boss'),
  asyncHandler(productionController.confirmSchedule.bind(productionController)),
);

// R-06: 任务列表（分页 + 筛选）
router.get('/tasks', asyncHandler(productionController.listTasks.bind(productionController)));

// 工人任务
router.get('/tasks/worker/:workerId',  asyncHandler(productionController.getWorkerTasks.bind(productionController)));

// BE-06-01: 任务详情
router.get('/tasks/:taskId', asyncHandler(productionController.getTask.bind(productionController)));
router.post('/tasks/:id/start',
  requireRoles('worker', 'supervisor'),
  asyncHandler(productionController.startTask.bind(productionController)),
);
router.post('/tasks/:id/complete',
  requireRoles('worker', 'supervisor'),
  asyncHandler(productionController.completeTask.bind(productionController)),
);
router.post('/tasks/:id/exception',
  asyncHandler(productionController.reportException.bind(productionController)),
);
router.post('/tasks/:id/resolve-exception',
  requireRoles('supervisor', 'boss'),
  asyncHandler(productionController.resolveException.bind(productionController)),
);

export default router;
