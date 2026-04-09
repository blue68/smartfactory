import { Router } from 'express';
import { customerController } from './customer.controller';
import { authMiddleware, requirePermissionsOrRoles } from '../../middleware/auth';
import { asyncHandler } from '../../app';

const router = Router();

// 所有客户接口均需 JWT 认证
router.use(authMiddleware);

// 固定路径路由必须在参数路由 /:id 之前注册
router.get('/options', requirePermissionsOrRoles(['sales:customer:view'], 'boss', 'supervisor', 'sales'), asyncHandler(customerController.getOptions.bind(customerController)));
router.get('/export', requirePermissionsOrRoles(['sales:customer:view'], 'boss', 'supervisor', 'sales'), asyncHandler(customerController.exportExcel.bind(customerController)));

router.get('/',    requirePermissionsOrRoles(['sales:customer:view'], 'boss', 'supervisor', 'sales'), asyncHandler(customerController.list.bind(customerController)));
router.post('/',   requirePermissionsOrRoles(['sales:customer:manage'], 'boss', 'supervisor', 'sales'), asyncHandler(customerController.create.bind(customerController)));
router.get('/:id', requirePermissionsOrRoles(['sales:customer:view'], 'boss', 'supervisor', 'sales'), asyncHandler(customerController.getOne.bind(customerController)));
router.put('/:id', requirePermissionsOrRoles(['sales:customer:manage'], 'boss', 'supervisor', 'sales'), asyncHandler(customerController.update.bind(customerController)));
router.patch('/:id/status', requirePermissionsOrRoles(['sales:customer:manage'], 'boss', 'supervisor', 'sales'), asyncHandler(customerController.updateStatus.bind(customerController)));

// 联系人子资源
router.get('/:id/contacts',                   requirePermissionsOrRoles(['sales:customer:view'], 'boss', 'supervisor', 'sales'), asyncHandler(customerController.getContacts.bind(customerController)));
router.post('/:id/contacts',                  requirePermissionsOrRoles(['sales:customer:manage'], 'boss', 'supervisor', 'sales'), asyncHandler(customerController.addContact.bind(customerController)));
router.put('/:id/contacts/:contactId',        requirePermissionsOrRoles(['sales:customer:manage'], 'boss', 'supervisor', 'sales'), asyncHandler(customerController.updateContact.bind(customerController)));
router.delete('/:id/contacts/:contactId',     requirePermissionsOrRoles(['sales:customer:manage'], 'boss', 'supervisor', 'sales'), asyncHandler(customerController.removeContact.bind(customerController)));

// 客户订单子资源
router.get('/:id/orders', requirePermissionsOrRoles(['sales:customer:view'], 'boss', 'supervisor', 'sales'), asyncHandler(customerController.getOrders.bind(customerController)));

export default router;
