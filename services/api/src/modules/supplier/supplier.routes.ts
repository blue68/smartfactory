import { Router } from 'express';
import { supplierController } from './supplier.controller';
import { authMiddleware } from '../../middleware/auth';
import { asyncHandler } from '../../app';

const router = Router();

router.use(authMiddleware);

router.get('/options',  asyncHandler(supplierController.options.bind(supplierController)));
router.get('/',         asyncHandler(supplierController.list.bind(supplierController)));
router.get('/:id',      asyncHandler(supplierController.getOne.bind(supplierController)));
router.post('/',        asyncHandler(supplierController.create.bind(supplierController)));
router.put('/:id',      asyncHandler(supplierController.update.bind(supplierController)));
router.get('/:id/performance', asyncHandler(supplierController.getPerformance.bind(supplierController)));
router.get('/:id/monthly-statement', asyncHandler(supplierController.getMonthlyStatement.bind(supplierController)));

export default router;
