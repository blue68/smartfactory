import { Router, Request, Response } from 'express';
import { purchaseController } from './purchase.controller';
import { PurchaseService } from './purchase.service';
import { authMiddleware, requireRoles } from '../../middleware/auth';
import { asyncHandler } from '../../app';

const router = Router();
router.use(authMiddleware);

// 采购建议
router.post('/suggestions/generate',
  requireRoles('boss', 'purchaser'),
  asyncHandler(purchaseController.generateSuggestions.bind(purchaseController)),
);
router.get('/suggestions',  asyncHandler(purchaseController.listSuggestions.bind(purchaseController)));
router.post('/suggestions/:id/approve',
  requireRoles('boss'),
  asyncHandler(purchaseController.approveSuggestion.bind(purchaseController)),
);
router.post('/suggestions/:id/feedback',
  requireRoles('purchaser', 'boss'),
  asyncHandler(purchaseController.feedbackSuggestion.bind(purchaseController)),
);

// BE-P2-014: 采购订单 CSV 导出
// 注意：固定路由 orders/export/csv 必须在参数路由 orders/:id 之前注册，避免 Express 路由歧义
router.get('/orders/export/csv', asyncHandler(async (req: Request, res: Response) => {
  const svc = new PurchaseService({ tenantId: req.tenantId, userId: req.userId, roles: req.roles ?? [] });
  const HEADERS = ['采购单号', '供应商名称', '总金额', '状态', '创建时间'];

  // RFC 5987 编码中文文件名，兼容主流浏览器
  const encodedFilename = encodeURIComponent('采购订单.csv');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="purchase_orders.csv"; filename*=UTF-8''${encodedFilename}`);

  // 字段值转义：包含逗号、引号、换行时用双引号包裹，内部引号加倍
  const escape = (s: string) => `"${String(s ?? '').replace(/"/g, '""')}"`;

  // 写入 UTF-8 BOM + 表头，确保 Excel 正确识别中文
  res.write('\uFEFF' + HEADERS.map(escape).join(',') + '\n');

  // 分批查询写入，每批 500 条，避免全量加载内存 (IMP-003)
  const BATCH_SIZE = 500;
  let page = 1;
  let hasMore = true;
  while (hasMore) {
    const { list } = await svc.listPOs({ page, pageSize: BATCH_SIZE });
    for (const po of list as Array<Record<string, unknown>>) {
      // created_at 可能是 Date 对象或字符串，统一格式化为 YYYY-MM-DD HH:mm:ss
      const createdAt = po.created_at instanceof Date
        ? po.created_at.toISOString().replace('T', ' ').slice(0, 19)
        : String(po.created_at ?? '');
      res.write([
        String(po.po_no ?? ''),
        String(po.supplierName ?? ''),
        String(po.total_amount ?? ''),
        String(po.status ?? ''),
        createdAt,
      ].map(escape).join(',') + '\n');
    }
    hasMore = list.length === BATCH_SIZE;
    page++;
  }
  res.end();
}));

// 采购订单
router.get('/orders',       asyncHandler(purchaseController.listPOs.bind(purchaseController)));
router.get('/orders/tail-tracking', asyncHandler(purchaseController.listTailOrders.bind(purchaseController)));
router.get('/orders/:id/delivery', asyncHandler(purchaseController.listOrderDeliveries.bind(purchaseController)));
router.get('/orders/:id', asyncHandler(purchaseController.getOrderById.bind(purchaseController)));
router.get('/delivery-notes', asyncHandler(purchaseController.listDeliveryNotes.bind(purchaseController)));
router.get('/delivery-notes/:id', asyncHandler(purchaseController.getDeliveryNoteById.bind(purchaseController)));
router.get('/receipts', asyncHandler(purchaseController.listReceipts.bind(purchaseController)));
router.get('/receipts/:id', asyncHandler(purchaseController.getReceiptById.bind(purchaseController)));
router.patch('/receipts/:id/notes',
  requireRoles('warehouse', 'supervisor', 'boss'),
  asyncHandler(purchaseController.updateReceiptNotes.bind(purchaseController)),
);
router.post('/orders',
  requireRoles('purchaser', 'boss'),
  asyncHandler(purchaseController.createPO.bind(purchaseController)),
);
router.patch('/orders/:id/close',
  requireRoles('boss', 'supervisor'),
  asyncHandler(purchaseController.closeOrder.bind(purchaseController)),
);
router.post('/orders/:id/delivery',
  requireRoles('purchaser'),
  asyncHandler(purchaseController.createDeliveryNote.bind(purchaseController)),
);

// 三单匹配
router.post('/three-way-match',
  requireRoles('purchaser'),
  asyncHandler(purchaseController.runMatch.bind(purchaseController)),
);
router.get('/three-way-match',  asyncHandler(purchaseController.listMatches.bind(purchaseController)));
router.get('/three-way-match/:id', asyncHandler(purchaseController.getMatchById.bind(purchaseController)));
router.post('/three-way-match/:id/confirm',
  requireRoles('purchaser'),
  asyncHandler(purchaseController.confirmDiff.bind(purchaseController)),
);

// 采购结算
router.get('/settlements/export/csv',
  requireRoles('boss', 'supervisor', 'purchaser'),
  asyncHandler(purchaseController.exportSettlements.bind(purchaseController)),
);
router.post('/settlements',
  requireRoles('boss', 'supervisor', 'purchaser'),
  asyncHandler(purchaseController.createSettlement.bind(purchaseController)),
);
router.get('/settlements',
  requireRoles('boss', 'supervisor', 'purchaser'),
  asyncHandler(purchaseController.listSettlements.bind(purchaseController)),
);
router.get('/settlements/:id',
  requireRoles('boss', 'supervisor', 'purchaser'),
  asyncHandler(purchaseController.getSettlementById.bind(purchaseController)),
);
router.put('/settlements/:id/confirm',
  requireRoles('boss'),
  asyncHandler(purchaseController.confirmSettlement.bind(purchaseController)),
);
router.put('/settlements/:id/pay',
  requireRoles('boss'),
  asyncHandler(purchaseController.paySettlement.bind(purchaseController)),
);
router.put('/settlements/:id/cancel',
  requireRoles('boss', 'supervisor'),
  asyncHandler(purchaseController.cancelSettlement.bind(purchaseController)),
);

export default router;
