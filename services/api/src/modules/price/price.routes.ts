import { Router } from 'express';
import path from 'path';
import multer from 'multer';
import { priceController } from './price.controller';
import { authMiddleware, requireRoles } from '../../middleware/auth';
import { asyncHandler } from '../../app';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB 上限
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowedExts = ['.xls', '.xlsx'];
    const allowedMimes = [
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ];
    if (allowedExts.includes(ext) && allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('仅支持 .xls/.xlsx 格式文件'));
    }
  },
});
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
// #14: lightweight progress polling — must be declared before /import/:taskId
router.get('/import/:taskId/status', asyncHandler(priceController.getImportProgress.bind(priceController)));
router.get('/import/:taskId', asyncHandler(priceController.getImportStatus.bind(priceController)));

// ── 原有路由 ────────────────────────────────────────────────────────────
router.get('/',         asyncHandler(priceController.list.bind(priceController)));
router.get('/history/:skuId', asyncHandler(priceController.getPriceHistory.bind(priceController)));
router.get('/:id',      asyncHandler(priceController.getOne.bind(priceController)));
router.post('/',        requireRoles('boss', 'supervisor', 'purchaser'), asyncHandler(priceController.create.bind(priceController)));
router.put('/:id',      requireRoles('boss', 'supervisor', 'purchaser'), asyncHandler(priceController.update.bind(priceController)));

export default router;
