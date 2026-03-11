import { Router } from 'express';
import { skuController } from './sku.controller';
import { authMiddleware } from '../../middleware/auth';
import { asyncHandler } from '../../app';

const router = Router();

router.use(authMiddleware);

router.get('/categories',    asyncHandler(skuController.getCategories.bind(skuController)));
router.get('/',              asyncHandler(skuController.list.bind(skuController)));
router.get('/:id',           asyncHandler(skuController.getOne.bind(skuController)));
router.post('/',             asyncHandler(skuController.create.bind(skuController)));
router.put('/:id',           asyncHandler(skuController.update.bind(skuController)));
router.put('/:id/unit-conversions', asyncHandler(skuController.setUnitConversions.bind(skuController)));

export default router;
