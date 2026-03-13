import { Router } from 'express';
import multer from 'multer';
import { skuController } from './sku.controller';
import { authMiddleware } from '../../middleware/auth';
import { asyncHandler } from '../../app';

const router = Router();

// multer: 内存存储，限制 10 MB，接受 CSV、xlsx/xls 及通用二进制流
// 注意：浏览器上传 CSV/xlsx 时 mimetype 不稳定，因此白名单较宽松，
// 实际文件类型由 controller 通过 buffer 魔数二次校验。
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'text/csv',
      'application/csv',
      'application/octet-stream',
      'text/plain',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
      'application/vnd.ms-excel',                                          // .xls
    ];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`不支持的文件类型: ${file.mimetype}，请上传 CSV 或 Excel 文件`));
    }
  },
});

router.use(authMiddleware);

router.get('/categories',          asyncHandler(skuController.getCategories.bind(skuController)));
router.get('/stats',               asyncHandler(skuController.getStats.bind(skuController)));
router.get('/',                    asyncHandler(skuController.list.bind(skuController)));
// export / import 路由须在 /:id 参数路由之前注册，防止被路由截获
router.get('/export',              asyncHandler(skuController.exportExcel.bind(skuController)));
router.post('/import',             upload.single('file'), asyncHandler(skuController.importSkus.bind(skuController)));
router.get('/:id',                 asyncHandler(skuController.getOne.bind(skuController)));
router.post('/',                   asyncHandler(skuController.create.bind(skuController)));
router.put('/batch-status',        asyncHandler(skuController.batchUpdateStatus.bind(skuController)));
router.put('/batch-safety-stock',  asyncHandler(skuController.batchUpdateSafetyStock.bind(skuController)));
router.put('/:id',                 asyncHandler(skuController.update.bind(skuController)));
router.put('/:id/unit-conversions', asyncHandler(skuController.setUnitConversions.bind(skuController)));

export default router;
