import { Router } from 'express';
import { supplierController } from './supplier.controller';
import { authMiddleware, requirePermissionsOrRoles } from '../../middleware/auth';
import { asyncHandler } from '../../app';

const router = Router();

router.use(authMiddleware);

router.get('/options',  requirePermissionsOrRoles(['supplier:view'], 'boss', 'supervisor', 'purchaser'), asyncHandler(supplierController.options.bind(supplierController)));
// R-02: 导出、绩效对比（必须在 /:id 路由之前注册，避免被 param 路由捕获）
router.get('/export',   requirePermissionsOrRoles(['supplier:view'], 'boss', 'supervisor', 'purchaser'), asyncHandler(supplierController.exportExcel.bind(supplierController)));
router.post('/compare', requirePermissionsOrRoles(['supplier:view'], 'boss', 'supervisor', 'purchaser'), asyncHandler(supplierController.comparePerformance.bind(supplierController)));
router.get('/',         requirePermissionsOrRoles(['supplier:view'], 'boss', 'supervisor', 'purchaser'), asyncHandler(supplierController.list.bind(supplierController)));
router.get('/:id',      requirePermissionsOrRoles(['supplier:view'], 'boss', 'supervisor', 'purchaser'), asyncHandler(supplierController.getOne.bind(supplierController)));
router.post('/',        requirePermissionsOrRoles(['supplier:manage'], 'boss', 'supervisor', 'purchaser'), asyncHandler(supplierController.create.bind(supplierController)));
router.put('/:id',      requirePermissionsOrRoles(['supplier:manage'], 'boss', 'supervisor', 'purchaser'), asyncHandler(supplierController.update.bind(supplierController)));
router.get('/:id/performance', requirePermissionsOrRoles(['supplier:view'], 'boss', 'supervisor', 'purchaser'), asyncHandler(supplierController.getPerformance.bind(supplierController)));
router.get('/:id/monthly-statement', requirePermissionsOrRoles(['supplier:view'], 'boss', 'supervisor', 'purchaser'), asyncHandler(supplierController.getMonthlyStatement.bind(supplierController)));
router.get('/:id/skus', requirePermissionsOrRoles(['supplier:view'], 'boss', 'supervisor', 'purchaser'), asyncHandler(supplierController.getRelatedSkus.bind(supplierController)));
router.get('/:id/price-agreements', requirePermissionsOrRoles(['supplier:view'], 'boss', 'supervisor', 'purchaser'), asyncHandler(supplierController.getPriceAgreements.bind(supplierController)));

export default router;
