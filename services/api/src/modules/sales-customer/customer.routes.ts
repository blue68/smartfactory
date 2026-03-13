import { Router } from 'express';
import { customerController } from './customer.controller';
import { authMiddleware } from '../../middleware/auth';
import { asyncHandler } from '../../app';

const router = Router();

// 所有客户接口均需 JWT 认证
router.use(authMiddleware);

// 固定路径路由必须在参数路由 /:id 之前注册
router.get('/options', asyncHandler(customerController.getOptions.bind(customerController)));

router.get('/',    asyncHandler(customerController.list.bind(customerController)));
router.post('/',   asyncHandler(customerController.create.bind(customerController)));
router.get('/:id', asyncHandler(customerController.getOne.bind(customerController)));
router.put('/:id', asyncHandler(customerController.update.bind(customerController)));

// 联系人子资源
router.get('/:id/contacts',                   asyncHandler(customerController.getContacts.bind(customerController)));
router.post('/:id/contacts',                  asyncHandler(customerController.addContact.bind(customerController)));
router.put('/:id/contacts/:contactId',        asyncHandler(customerController.updateContact.bind(customerController)));
router.delete('/:id/contacts/:contactId',     asyncHandler(customerController.removeContact.bind(customerController)));

// 客户订单子资源
router.get('/:id/orders', asyncHandler(customerController.getOrders.bind(customerController)));

export default router;
