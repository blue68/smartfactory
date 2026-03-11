import { Router } from 'express';
import { priceController } from './price.controller';
import { authMiddleware } from '../../middleware/auth';
import { asyncHandler } from '../../app';

const router = Router();

router.use(authMiddleware);

router.get('/',         asyncHandler(priceController.list.bind(priceController)));
router.get('/history/:skuId', asyncHandler(priceController.getPriceHistory.bind(priceController)));
router.get('/:id',      asyncHandler(priceController.getOne.bind(priceController)));
router.post('/',        asyncHandler(priceController.create.bind(priceController)));
router.put('/:id',      asyncHandler(priceController.update.bind(priceController)));

export default router;
