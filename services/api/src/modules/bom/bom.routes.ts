import { Router } from 'express';
import { bomController } from './bom.controller';
import { authMiddleware, requireRoles } from '../../middleware/auth';
import { asyncHandler } from '../../app';

const router = Router();
router.use(authMiddleware);

// P0-1: GET routes remain auth-only (no role restriction)
router.get('/',                          asyncHandler(bomController.list.bind(bomController)));

// BE-P1-002: AI 辅助 BOM 建议（必须在 /:id 参数路由之前注册，避免 Express 路由歧义）
router.get('/ai-suggestion/:skuId',      requireRoles('boss', 'supervisor'), asyncHandler(bomController.getAiSuggestion.bind(bomController)));

router.get('/:id/expand',               asyncHandler(bomController.getExpanded.bind(bomController)));
router.get('/:id/material-requirements', asyncHandler(bomController.calcRequirements.bind(bomController)));

// P0-1: Write routes require boss or supervisor role
router.post('/',                         requireRoles('boss', 'supervisor'), asyncHandler(bomController.create.bind(bomController)));
router.post('/:id/activate',             requireRoles('boss', 'supervisor'), asyncHandler(bomController.activate.bind(bomController)));

// BE-P1-001: BOM 操作补全
router.put('/:id',                       requireRoles('boss', 'supervisor'), asyncHandler(bomController.update.bind(bomController)));
router.delete('/:id/items/:itemId',      requireRoles('boss', 'supervisor'), asyncHandler(bomController.deleteBomItem.bind(bomController)));
router.post('/:id/copy',                 requireRoles('boss', 'supervisor'), asyncHandler(bomController.copyBom.bind(bomController)));
router.post('/:id/items',               requireRoles('boss', 'supervisor'), asyncHandler(bomController.addItem.bind(bomController)));

export default router;
