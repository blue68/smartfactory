import { Router } from 'express';
import { productionController } from './production.controller';
import { productionOrderController } from './production-order.controller';
import { authMiddleware, requirePermissionsOrRoles } from '../../middleware/auth';
import { asyncHandler } from '../../app';

const router = Router();
router.use(authMiddleware);

// BE-P2-009: 工作日历（固定路由段，必须在参数路由之前注册）
router.get('/work-calendar',
  requirePermissionsOrRoles(['production:schedule:view'], 'boss', 'supervisor', 'admin'),
  asyncHandler(productionController.getWorkCalendar.bind(productionController)),
);
router.post('/work-calendar/holiday',
  requirePermissionsOrRoles(['production:calendar:manage'], 'boss', 'supervisor', 'admin'),
  asyncHandler(productionController.setHoliday.bind(productionController)),
);

// BE-P1-008: 生产进度看板（必须在参数路由之前注册）
router.get('/dashboard',           requirePermissionsOrRoles(['production:schedule:view'], 'boss', 'supervisor', 'admin'), asyncHandler(productionController.getDashboard.bind(productionController)));

// BE-P1: 工人和工作站列表（固定路由，必须在 /:id 参数路由之前）
router.get('/workers',             requirePermissionsOrRoles(['production:schedule:view'], 'boss', 'supervisor', 'admin'), asyncHandler(productionController.listWorkers.bind(productionController)));
router.get('/workstations',        requirePermissionsOrRoles(['production:schedule:view'], 'boss', 'supervisor', 'admin'), asyncHandler(productionController.listWorkstations.bind(productionController)));
router.post('/workstations',
  requirePermissionsOrRoles(['production:workstation:manage'], 'supervisor', 'boss', 'admin'),
  asyncHandler(productionController.createWorkstation.bind(productionController)),
);
router.put('/workstations/:id',
  requirePermissionsOrRoles(['production:workstation:manage'], 'supervisor', 'boss', 'admin'),
  asyncHandler(productionController.updateWorkstation.bind(productionController)),
);
router.delete('/workstations/:id',
  requirePermissionsOrRoles(['production:workstation:manage'], 'supervisor', 'boss', 'admin'),
  asyncHandler(productionController.deleteWorkstation.bind(productionController)),
);

// BE-P1: 排产手动调整（固定路由段，必须在 /:date 参数路由之前）
router.put('/schedule/:date/adjust',
  requirePermissionsOrRoles(['production:schedule:adjust'], 'supervisor', 'boss', 'admin'),
  asyncHandler(productionController.adjustSchedule.bind(productionController)),
);

// 生产工单
router.get('/orders',              requirePermissionsOrRoles(['production:order:view'], 'supervisor', 'boss', 'worker'), asyncHandler(productionController.listOrders.bind(productionController)));

// Sprint 3: 销售订单触发工单创建（固定路由，必须在 /orders/:id 之前）
router.post('/orders/from-sales-order/:salesOrderId',
  requirePermissionsOrRoles(['production:order:create'], 'supervisor', 'boss'),
  asyncHandler(productionOrderController.createFromSalesOrder.bind(productionOrderController)),
);

router.get('/orders/:id',          requirePermissionsOrRoles(['production:order:view'], 'supervisor', 'boss', 'worker'), asyncHandler(productionController.getOrder.bind(productionController)));
router.post('/orders',
  requirePermissionsOrRoles(['production:order:create'], 'supervisor', 'boss'),
  asyncHandler(productionController.createOrder.bind(productionController)),
);

// Sprint 3: 工单物料需求和缺料检测
router.get('/orders/:id/materials',
  requirePermissionsOrRoles(['production:order:view'], 'supervisor', 'boss', 'purchase', 'purchaser'),
  asyncHandler(productionOrderController.getMaterialRequirements.bind(productionOrderController)),
);
router.get('/orders/:id/material-check',
  requirePermissionsOrRoles(['production:order:view'], 'supervisor', 'boss'),
  asyncHandler(productionOrderController.checkMaterialStatus.bind(productionOrderController)),
);
router.post('/orders/:id/release',
  requirePermissionsOrRoles(['production:order:create'], 'supervisor', 'boss'),
  asyncHandler(productionOrderController.releaseOrder.bind(productionOrderController)),
);
router.get('/orders/:id/components',
  requirePermissionsOrRoles(['production:order:view'], 'supervisor', 'boss', 'purchase', 'purchaser'),
  asyncHandler(productionOrderController.getComponents.bind(productionOrderController)),
);
router.get('/orders/:id/operations',
  requirePermissionsOrRoles(['production:order:view'], 'supervisor', 'boss'),
  asyncHandler(productionOrderController.getOperations.bind(productionOrderController)),
);
router.put('/orders/:id/cancel',
  requirePermissionsOrRoles(['production:order:create'], 'supervisor', 'boss'),
  asyncHandler(productionOrderController.cancelOrder.bind(productionOrderController)),
);

// 排产计划
router.get('/schedule/history',
  requirePermissionsOrRoles(['production:schedule:view'], 'supervisor', 'boss'),
  asyncHandler(productionController.getScheduleHistory.bind(productionController)),
);
router.get('/schedule/generate',
  requirePermissionsOrRoles(['production:schedule:generate'], 'supervisor', 'boss'),
  asyncHandler(productionController.generateSchedule.bind(productionController)),
);
router.post('/schedule/confirm',
  requirePermissionsOrRoles(['production:schedule:confirm'], 'supervisor', 'boss'),
  asyncHandler(productionController.confirmSchedule.bind(productionController)),
);

// P0-10: 任务统计（固定路由，必须在 /tasks/:id 之前）
router.get('/tasks/stats', requirePermissionsOrRoles(['production:task:operate'], 'worker', 'supervisor', 'boss', 'admin'), asyncHandler(productionController.getTaskStats.bind(productionController)));

// R-06: 任务列表（分页 + 筛选）
router.get('/tasks', requirePermissionsOrRoles(['production:task:operate'], 'worker', 'supervisor', 'boss', 'admin'), asyncHandler(productionController.listTasks.bind(productionController)));

// 工人任务
router.get('/tasks/worker/:workerId',  requirePermissionsOrRoles(['production:task:operate'], 'worker', 'supervisor', 'boss', 'admin'), asyncHandler(productionController.getWorkerTasks.bind(productionController)));

// BE-06-01: 任务详情
router.get('/tasks/:taskId', requirePermissionsOrRoles(['production:task:operate'], 'worker', 'supervisor', 'boss', 'admin'), asyncHandler(productionController.getTask.bind(productionController)));
router.post('/tasks/:id/start',
  requirePermissionsOrRoles(['production:task:operate'], 'worker', 'supervisor', 'boss', 'admin'),
  asyncHandler(productionController.startTask.bind(productionController)),
);
router.post('/tasks/:id/complete',
  requirePermissionsOrRoles(['production:task:operate', 'production:task:complete'], 'worker', 'supervisor', 'boss', 'admin'),
  asyncHandler(productionController.completeTask.bind(productionController)),
);
router.post('/tasks/:id/complete-v2',
  requirePermissionsOrRoles(['production:task:complete', 'production:task:operate'], 'worker', 'supervisor', 'boss', 'admin'),
  asyncHandler(productionController.completeTaskV2.bind(productionController)),
);
// P0-06: 暂停 / 恢复任务
router.post('/tasks/:id/suspend',
  requirePermissionsOrRoles(['production:task:supervise'], 'supervisor', 'boss', 'admin'),
  asyncHandler(productionController.suspendTask.bind(productionController)),
);
router.post('/tasks/:id/resume',
  requirePermissionsOrRoles(['production:task:supervise'], 'supervisor', 'boss', 'admin'),
  asyncHandler(productionController.resumeTask.bind(productionController)),
);

router.post('/tasks/:id/exception',
  requirePermissionsOrRoles(['production:task:operate'], 'worker', 'supervisor', 'boss', 'admin'),
  asyncHandler(productionController.reportException.bind(productionController)),
);
router.post('/tasks/:id/resolve-exception',
  requirePermissionsOrRoles(['production:task:supervise'], 'supervisor', 'boss', 'admin'),
  asyncHandler(productionController.resolveException.bind(productionController)),
);

export default router;
