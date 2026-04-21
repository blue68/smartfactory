import { Router } from 'express';
import { bomController } from './bom.controller';
import { authMiddleware, requirePermissionsOrRoles } from '../../middleware/auth';
import { asyncHandler } from '../../app';

const router = Router();
router.use(authMiddleware);

// P0-1: GET routes remain auth-only (no role restriction)
router.get('/',                          requirePermissionsOrRoles(['bom:view'], 'boss', 'supervisor', 'purchaser'), asyncHandler(bomController.list.bind(bomController)));

// BE-P1-002: AI 辅助 BOM 建议（必须在 /:id 参数路由之前注册，避免 Express 路由歧义）
router.get('/ai-suggestion/:skuId',      requirePermissionsOrRoles(['bom:create'], 'boss', 'supervisor'), asyncHandler(bomController.getAiSuggestion.bind(bomController)));
router.get('/sku/:skuId/referenced-by',  requirePermissionsOrRoles(['bom:view'], 'boss', 'supervisor', 'purchaser'), asyncHandler(bomController.getReferencedBy.bind(bomController)));

router.get('/:id/expand',               requirePermissionsOrRoles(['bom:view'], 'boss', 'supervisor', 'purchaser'), asyncHandler(bomController.getExpanded.bind(bomController)));
router.get('/:id/export',               requirePermissionsOrRoles(['bom:view'], 'boss', 'supervisor'), asyncHandler(bomController.exportBom.bind(bomController)));
router.get('/:id/cost-breakdown',        requirePermissionsOrRoles(['bom:view'], 'boss', 'supervisor'), asyncHandler(bomController.getCostBreakdown.bind(bomController)));
router.get('/:id/material-requirements', requirePermissionsOrRoles(['bom:view'], 'boss', 'supervisor'), asyncHandler(bomController.calcRequirements.bind(bomController)));

// P0-1: Write routes require boss or supervisor role
router.post('/',                         requirePermissionsOrRoles(['bom:create'], 'boss', 'supervisor'), asyncHandler(bomController.create.bind(bomController)));
router.post('/:id/activate',             requirePermissionsOrRoles(['bom:activate'], 'boss', 'supervisor'), asyncHandler(bomController.activate.bind(bomController)));

// BE-P1-001: BOM 操作补全
router.put('/:id',                       requirePermissionsOrRoles(['bom:create'], 'boss', 'supervisor'), asyncHandler(bomController.update.bind(bomController)));
router.delete('/:id/items/:itemId',      requirePermissionsOrRoles(['bom:create'], 'boss', 'supervisor'), asyncHandler(bomController.deleteBomItem.bind(bomController)));
router.patch('/:id/items/:itemId',       requirePermissionsOrRoles(['bom:create'], 'boss', 'supervisor'), asyncHandler(bomController.updateBomItem.bind(bomController)));
router.post('/:id/copy',                 requirePermissionsOrRoles(['bom:create'], 'boss', 'supervisor'), asyncHandler(bomController.copyBom.bind(bomController)));
router.post('/:id/items',               requirePermissionsOrRoles(['bom:create'], 'boss', 'supervisor'), asyncHandler(bomController.addItem.bind(bomController)));

export default router;
