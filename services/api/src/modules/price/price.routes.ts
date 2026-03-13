import { Router } from 'express';
import multer from 'multer';
import { priceController } from './price.controller';
import { authMiddleware, requireRoles } from '../../middleware/auth';
import { asyncHandler } from '../../app';

const upload = multer({ storage: multer.memoryStorage() });
const router = Router();

router.use(authMiddleware);

// ── R-03: 导入相关（放在 /:id 之前避免路由冲突）────────────────────────
router.get('/import-template', asyncHandler(priceController.downloadTemplate.bind(priceController)));
router.post(
  '/import',
  requireRoles('boss', 'manager'),
  upload.single('file'),
  asyncHandler(priceController.importPrices.bind(priceController)),
);
router.get('/import/:taskId', asyncHandler(priceController.getImportStatus.bind(priceController)));

// ── 原有路由 ────────────────────────────────────────────────────────────
router.get('/',         asyncHandler(priceController.list.bind(priceController)));
router.get('/history/:skuId', asyncHandler(priceController.getPriceHistory.bind(priceController)));
router.get('/:id',      asyncHandler(priceController.getOne.bind(priceController)));
router.post('/',        asyncHandler(priceController.create.bind(priceController)));
router.put('/:id',      asyncHandler(priceController.update.bind(priceController)));

export default router;
