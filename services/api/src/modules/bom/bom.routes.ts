import { Router } from 'express';
import { bomController } from './bom.controller';
import { authMiddleware } from '../../middleware/auth';
import { asyncHandler } from '../../app';

const router = Router();
router.use(authMiddleware);

router.get('/',                          asyncHandler(bomController.list.bind(bomController)));

// BE-P1-002: AI 辅助 BOM 建议（必须在 /:id 参数路由之前注册，避免 Express 路由歧义）
router.get('/ai-suggestion/:skuId',      asyncHandler(bomController.getAiSuggestion.bind(bomController)));

router.get('/:id/expand',               asyncHandler(bomController.getExpanded.bind(bomController)));
router.get('/:id/material-requirements', asyncHandler(bomController.calcRequirements.bind(bomController)));
router.post('/',                         asyncHandler(bomController.create.bind(bomController)));
router.post('/:id/activate',             asyncHandler(bomController.activate.bind(bomController)));

// BE-P1-001: BOM 操作补全
router.put('/:id',                       asyncHandler(bomController.update.bind(bomController)));
router.delete('/:id/items/:itemId',      asyncHandler(bomController.deleteBomItem.bind(bomController)));
router.post('/:id/copy',                 asyncHandler(bomController.copyBom.bind(bomController)));

export default router;
