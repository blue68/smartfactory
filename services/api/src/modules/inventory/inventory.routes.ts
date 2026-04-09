import { Router, Request, Response } from 'express';
import path from 'path';
import multer from 'multer';
import { inventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { authMiddleware, requirePermissionsOrRoles } from '../../middleware/auth';
import { asyncHandler } from '../../app';
import { triggerStockAlertScan } from '../../shared/queue';
import { success } from '../../shared/ApiResponse';

const router = Router();
router.use(authMiddleware);

const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowedMimes = ['text/csv', 'application/csv', 'application/vnd.ms-excel'];
    if (ext === '.csv' || allowedMimes.includes(file.mimetype)) {
      cb(null, true);
      return;
    }
    cb(new Error('仅支持 .csv 格式文件'));
  },
});

router.get('/',                              requirePermissionsOrRoles(['inventory:view'], 'boss', 'supervisor', 'warehouse', 'purchaser', 'purchase'), asyncHandler(inventoryController.list.bind(inventoryController)));
router.get('/warehouses',                    requirePermissionsOrRoles(['inventory:view'], 'boss', 'supervisor', 'warehouse', 'purchaser', 'purchase'), asyncHandler(inventoryController.listWarehouses.bind(inventoryController)));
router.get('/locations',                     requirePermissionsOrRoles(['inventory:view'], 'boss', 'supervisor', 'warehouse', 'purchaser', 'purchase'), asyncHandler(inventoryController.listLocations.bind(inventoryController)));
router.post(
  '/warehouses',
  requirePermissionsOrRoles(['warehouse:location:manage'], 'supervisor', 'boss', 'admin', 'warehouse'),
  asyncHandler(inventoryController.createWarehouse.bind(inventoryController)),
);
router.put(
  '/warehouses/:id',
  requirePermissionsOrRoles(['warehouse:location:manage'], 'supervisor', 'boss', 'admin', 'warehouse'),
  asyncHandler(inventoryController.updateWarehouse.bind(inventoryController)),
);
router.delete(
  '/warehouses/:id',
  requirePermissionsOrRoles(['warehouse:location:manage'], 'supervisor', 'boss', 'admin', 'warehouse'),
  asyncHandler(inventoryController.deleteWarehouse.bind(inventoryController)),
);
router.post(
  '/locations',
  requirePermissionsOrRoles(['warehouse:location:manage'], 'supervisor', 'boss', 'admin', 'warehouse'),
  asyncHandler(inventoryController.createLocation.bind(inventoryController)),
);
router.put(
  '/locations/:id',
  requirePermissionsOrRoles(['warehouse:location:manage'], 'supervisor', 'boss', 'admin', 'warehouse'),
  asyncHandler(inventoryController.updateLocation.bind(inventoryController)),
);
router.delete(
  '/locations/:id',
  requirePermissionsOrRoles(['warehouse:location:manage'], 'supervisor', 'boss', 'admin', 'warehouse'),
  asyncHandler(inventoryController.deleteLocation.bind(inventoryController)),
);
router.get('/warehouses/import-template/csv', requirePermissionsOrRoles(['warehouse:location:import'], 'supervisor', 'boss'), asyncHandler(inventoryController.downloadWarehouseImportTemplateCsv.bind(inventoryController)));
router.post(
  '/warehouses/import-csv',
  requirePermissionsOrRoles(['warehouse:location:import'], 'supervisor', 'boss'),
  csvUpload.single('file'),
  asyncHandler(inventoryController.importWarehousesCsv.bind(inventoryController)),
);
router.get('/locations/import-template/csv', requirePermissionsOrRoles(['warehouse:location:import'], 'supervisor', 'boss'), asyncHandler(inventoryController.downloadLocationImportTemplateCsv.bind(inventoryController)));
router.post(
  '/locations/import-csv',
  requirePermissionsOrRoles(['warehouse:location:import'], 'supervisor', 'boss'),
  csvUpload.single('file'),
  asyncHandler(inventoryController.importLocationsCsv.bind(inventoryController)),
);
// BE-P1-005: 库存汇总看板（必须在 /:skuId 参数路由之前注册，避免路由歧义）
router.get('/summary',                       requirePermissionsOrRoles(['inventory:view'], 'boss', 'supervisor', 'warehouse', 'purchaser', 'purchase'), asyncHandler(inventoryController.getSummary.bind(inventoryController)));
// BE-08-08: 库存实时查询
router.get('/check',                         requirePermissionsOrRoles(['inventory:view'], 'boss', 'supervisor', 'warehouse', 'purchaser', 'purchase'), asyncHandler(inventoryController.checkAvailability.bind(inventoryController)));
router.get('/daily-snapshots',               requirePermissionsOrRoles(['inventory:view'], 'boss', 'supervisor', 'warehouse', 'purchaser', 'purchase'), asyncHandler(inventoryController.listDailySnapshots.bind(inventoryController)));
router.get('/:skuId/transactions',           requirePermissionsOrRoles(['inventory:view'], 'boss', 'supervisor', 'warehouse', 'purchaser', 'purchase'), asyncHandler(inventoryController.listTransactions.bind(inventoryController)));
router.post('/snapshots/rebuild',
  requirePermissionsOrRoles(['inventory:maintain'], 'supervisor', 'boss'),
  asyncHandler(inventoryController.rebuildSnapshots.bind(inventoryController)),
);
router.post('/reconcile',
  requirePermissionsOrRoles(['inventory:maintain'], 'supervisor', 'boss'),
  asyncHandler(inventoryController.reconcileInventory.bind(inventoryController)),
);
router.post('/repair',
  requirePermissionsOrRoles(['inventory:maintain'], 'supervisor', 'boss'),
  asyncHandler(inventoryController.repairInventory.bind(inventoryController)),
);
router.get('/:skuId/dye-lots',              requirePermissionsOrRoles(['inventory:view'], 'boss', 'supervisor', 'warehouse', 'purchaser', 'purchase'), asyncHandler(inventoryController.getDyeLots.bind(inventoryController)));
router.get('/:skuId/available',             requirePermissionsOrRoles(['inventory:view'], 'boss', 'supervisor', 'warehouse', 'purchaser', 'purchase'), asyncHandler(inventoryController.getAvailable.bind(inventoryController)));
router.get('/:skuId/fifo-dye-lot',          requirePermissionsOrRoles(['inventory:view'], 'boss', 'supervisor', 'warehouse', 'purchaser', 'purchase'), asyncHandler(inventoryController.fifoDyeLot.bind(inventoryController)));
router.post('/waste',
  requirePermissionsOrRoles(['inventory:waste'], 'warehouse', 'supervisor', 'boss'),
  asyncHandler(inventoryController.recordWaste.bind(inventoryController)),
);
router.post('/inbound',
  requirePermissionsOrRoles(['inventory:inbound'], 'warehouse', 'boss', 'purchaser', 'purchase'),
  asyncHandler(inventoryController.inbound.bind(inventoryController)),
);
router.post('/outbound',
  requirePermissionsOrRoles(['inventory:outbound'], 'warehouse', 'supervisor'),
  asyncHandler(inventoryController.outbound.bind(inventoryController)),
);

// BE-P1-003: 盘点接口
router.post('/stocktake',
  requirePermissionsOrRoles(['stocktaking:create'], 'warehouse', 'supervisor', 'boss'),
  asyncHandler(inventoryController.startStocktake.bind(inventoryController)),
);
router.post('/stocktake/:id/items',
  requirePermissionsOrRoles(['stocktaking:create'], 'warehouse', 'supervisor'),
  asyncHandler(inventoryController.submitStocktakeItem.bind(inventoryController)),
);
router.get('/stocktake/:id/diff',
  requirePermissionsOrRoles(['stocktaking:view'], 'warehouse', 'supervisor', 'boss'),
  asyncHandler(inventoryController.getStocktakeDiff.bind(inventoryController)),
);

// BE-P2-010: 安全库存预警 — 手动触发接口
// 权限：supervisor / boss（warehouse 操作员无需手动触发系统任务）
router.post(
  '/stock-alert/trigger',
  requirePermissionsOrRoles(['inventory:maintain'], 'supervisor', 'boss'),
  asyncHandler(async (req: Request, res: Response) => {
    const jobId = await triggerStockAlertScan();
    success(res, { jobId }, '安全库存预警扫描任务已入队，将在后台执行');
  }),
);

// BE-P2-014: 库存 CSV 导出（IMP-003: 分批流式写入，防止 OOM）
router.get('/export/csv', requirePermissionsOrRoles(['inventory:view'], 'boss', 'supervisor', 'warehouse', 'purchaser', 'purchase'), asyncHandler(async (req: Request, res: Response) => {
  const svc = new InventoryService({ tenantId: req.tenantId, userId: req.userId, roles: req.roles ?? [] });
  const { toCSV } = await import('../../shared/csvExport');
  const HEADERS = ['SKU编码', '物料名称', '在库数量', '预留数量', '可用库存', '安全库存', '单位'];

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename=inventory.csv');

  // 写入 BOM + 表头
  const escape = (s: string) => `"${String(s).replace(/"/g, '""')}"`;
  res.write('\uFEFF' + HEADERS.map(escape).join(',') + '\n');

  // 分批查询写入，每批 500 条，避免全量加载内存
  const BATCH_SIZE = 500;
  let page = 1;
  let hasMore = true;
  while (hasMore) {
    const { list } = await svc.listInventory({ page, pageSize: BATCH_SIZE });
    for (const i of list as unknown as Array<Record<string, unknown>>) {
      res.write([
        String(i.skuCode), String(i.skuName), String(i.qtyOnHand),
        String(i.qtyReserved), String(i.qtyAvailable), String(i.safetyStock), String(i.stockUnit),
      ].map(escape).join(',') + '\n');
    }
    hasMore = list.length === BATCH_SIZE;
    page++;
  }
  res.end();
}));

export default router;
