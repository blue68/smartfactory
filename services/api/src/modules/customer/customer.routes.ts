import { Router } from 'express';
import { customerController } from './customer.controller';
import { authMiddleware } from '../../middleware/auth';
import { asyncHandler } from '../../app';

const router = Router();

router.use(authMiddleware);

router.get('/options',  asyncHandler(customerController.options.bind(customerController)));
router.get('/',         asyncHandler(customerController.list.bind(customerController)));
router.get('/:id',      asyncHandler(customerController.getOne.bind(customerController)));
router.post('/',        asyncHandler(customerController.create.bind(customerController)));
router.put('/:id',      asyncHandler(customerController.update.bind(customerController)));

export default router;
