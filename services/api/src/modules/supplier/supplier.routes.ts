import { Router } from 'express';
import { supplierController } from './supplier.controller';
import { authMiddleware, requireRoles } from '../../middleware/auth';
import { asyncHandler } from '../../app';

const router = Router();

router.use(authMiddleware);

router.get('/options',  asyncHandler(supplierController.options.bind(supplierController)));
// R-02: 导出、绩效对比（必须在 /:id 路由之前注册，避免被 param 路由捕获）
router.get('/export',   asyncHandler(supplierController.exportExcel.bind(supplierController)));
router.post('/compare', asyncHandler(supplierController.comparePerformance.bind(supplierController)));
router.get('/',         asyncHandler(supplierController.list.bind(supplierController)));
router.get('/:id',      asyncHandler(supplierController.getOne.bind(supplierController)));
router.post('/',        requireRoles('boss', 'supervisor', 'purchaser'), asyncHandler(supplierController.create.bind(supplierController)));
router.put('/:id',      requireRoles('boss', 'supervisor', 'purchaser'), asyncHandler(supplierController.update.bind(supplierController)));
router.get('/:id/performance', asyncHandler(supplierController.getPerformance.bind(supplierController)));
router.get('/:id/monthly-statement', asyncHandler(supplierController.getMonthlyStatement.bind(supplierController)));
router.get('/:id/skus', asyncHandler(supplierController.getRelatedSkus.bind(supplierController)));
router.get('/:id/price-agreements', asyncHandler(supplierController.getPriceAgreements.bind(supplierController)));

export default router;
