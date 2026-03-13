import { Router, Request, Response } from 'express';
import { inventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { authMiddleware, requireRoles } from '../../middleware/auth';
import { asyncHandler } from '../../app';
import { triggerStockAlertScan } from '../../shared/queue';
import { success } from '../../shared/ApiResponse';

const router = Router();
router.use(authMiddleware);

router.get('/',                              asyncHandler(inventoryController.list.bind(inventoryController)));
// BE-P1-005: 库存汇总看板（必须在 /:skuId 参数路由之前注册，避免路由歧义）
router.get('/summary',                       asyncHandler(inventoryController.getSummary.bind(inventoryController)));
router.get('/:skuId/dye-lots',              asyncHandler(inventoryController.getDyeLots.bind(inventoryController)));
router.get('/:skuId/available',             asyncHandler(inventoryController.getAvailable.bind(inventoryController)));
router.get('/:skuId/fifo-dye-lot',          asyncHandler(inventoryController.fifoDyeLot.bind(inventoryController)));
router.post('/waste',
  requireRoles('warehouse', 'supervisor', 'boss'),
  asyncHandler(inventoryController.recordWaste.bind(inventoryController)),
);
router.post('/inbound',
  requireRoles('warehouse', 'boss', 'purchaser'),
  asyncHandler(inventoryController.inbound.bind(inventoryController)),
);
router.post('/outbound',
  requireRoles('warehouse', 'supervisor'),
  asyncHandler(inventoryController.outbound.bind(inventoryController)),
);

// BE-P1-003: 盘点接口
router.post('/stocktake',
  requireRoles('warehouse', 'supervisor', 'boss'),
  asyncHandler(inventoryController.startStocktake.bind(inventoryController)),
);
router.post('/stocktake/:id/items',
  requireRoles('warehouse', 'supervisor'),
  asyncHandler(inventoryController.submitStocktakeItem.bind(inventoryController)),
);
router.get('/stocktake/:id/diff',
  asyncHandler(inventoryController.getStocktakeDiff.bind(inventoryController)),
);

// BE-P2-010: 安全库存预警 — 手动触发接口
// 权限：supervisor / boss（warehouse 操作员无需手动触发系统任务）
router.post(
  '/stock-alert/trigger',
  requireRoles('supervisor', 'boss'),
  asyncHandler(async (req: Request, res: Response) => {
    const jobId = await triggerStockAlertScan();
    success(res, { jobId }, '安全库存预警扫描任务已入队，将在后台执行');
  }),
);

// BE-P2-014: 库存 CSV 导出（IMP-003: 分批流式写入，防止 OOM）
router.get('/export/csv', asyncHandler(async (req: Request, res: Response) => {
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
