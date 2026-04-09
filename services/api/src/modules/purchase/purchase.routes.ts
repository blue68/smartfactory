import { Router, Request, Response } from 'express';
import { purchaseController } from './purchase.controller';
import { PurchaseService } from './purchase.service';
import { authMiddleware, requirePermissionsOrRoles } from '../../middleware/auth';
import { asyncHandler } from '../../app';

const router = Router();
router.use(authMiddleware);

// 采购建议
router.post('/suggestions/generate',
  requirePermissionsOrRoles(['purchase:suggestion:generate'], 'boss', 'purchaser', 'purchase'),
  asyncHandler(purchaseController.generateSuggestions.bind(purchaseController)),
);
router.get('/suggestions', requirePermissionsOrRoles(['purchase:suggestion:view'], 'boss', 'purchaser', 'purchase'), asyncHandler(purchaseController.listSuggestions.bind(purchaseController)));
router.post('/suggestions/:id/approve',
  requirePermissionsOrRoles(['purchase:suggestion:approve'], 'boss'),
  asyncHandler(purchaseController.approveSuggestion.bind(purchaseController)),
);
router.post('/suggestions/:id/feedback',
  requirePermissionsOrRoles(['purchase:suggestion:view'], 'purchaser', 'purchase', 'boss'),
  asyncHandler(purchaseController.feedbackSuggestion.bind(purchaseController)),
);

// BE-P2-014: 采购订单 CSV 导出
// 注意：固定路由 orders/export/csv 必须在参数路由 orders/:id 之前注册，避免 Express 路由歧义
router.get('/orders/export/csv', requirePermissionsOrRoles(['purchase:order:view'], 'boss', 'supervisor', 'purchaser', 'purchase'), asyncHandler(async (req: Request, res: Response) => {
  const svc = new PurchaseService({
    tenantId: req.tenantId,
    userId: req.userId,
    roles: req.roles ?? [],
    permissionSnapshot: req.permissionSnapshot,
  });
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
router.get('/orders', requirePermissionsOrRoles(['purchase:order:view'], 'boss', 'supervisor', 'purchaser', 'purchase'), asyncHandler(purchaseController.listPOs.bind(purchaseController)));
router.get('/orders/tail-tracking', requirePermissionsOrRoles(['purchase:order:view'], 'boss', 'supervisor', 'purchaser', 'purchase'), asyncHandler(purchaseController.listTailOrders.bind(purchaseController)));
router.get('/orders/:id/delivery', requirePermissionsOrRoles(['purchase:delivery:view'], 'boss', 'supervisor', 'purchaser', 'purchase', 'warehouse'), asyncHandler(purchaseController.listOrderDeliveries.bind(purchaseController)));
router.get('/orders/:id', requirePermissionsOrRoles(['purchase:order:view'], 'boss', 'supervisor', 'purchaser', 'purchase'), asyncHandler(purchaseController.getOrderById.bind(purchaseController)));
router.get('/delivery-notes', requirePermissionsOrRoles(['purchase:delivery:view'], 'boss', 'supervisor', 'purchaser', 'purchase', 'warehouse'), asyncHandler(purchaseController.listDeliveryNotes.bind(purchaseController)));
router.get('/delivery-notes/:id', requirePermissionsOrRoles(['purchase:delivery:view'], 'boss', 'supervisor', 'purchaser', 'purchase', 'warehouse'), asyncHandler(purchaseController.getDeliveryNoteById.bind(purchaseController)));
router.get('/receipts', requirePermissionsOrRoles(['purchase:receipt:view'], 'boss', 'supervisor', 'purchaser', 'purchase', 'warehouse'), asyncHandler(purchaseController.listReceipts.bind(purchaseController)));
router.get('/receipts/:id', requirePermissionsOrRoles(['purchase:receipt:view'], 'boss', 'supervisor', 'purchaser', 'purchase', 'warehouse'), asyncHandler(purchaseController.getReceiptById.bind(purchaseController)));
router.patch('/receipts/:id/notes',
  requirePermissionsOrRoles(['purchase:receipt:edit'], 'warehouse', 'supervisor', 'boss'),
  asyncHandler(purchaseController.updateReceiptNotes.bind(purchaseController)),
);
router.post('/orders',
  requirePermissionsOrRoles(['purchase:order:create'], 'purchaser', 'purchase', 'boss'),
  asyncHandler(purchaseController.createPO.bind(purchaseController)),
);
router.patch('/orders/:id/close',
  requirePermissionsOrRoles(['purchase:order:close'], 'boss', 'supervisor'),
  asyncHandler(purchaseController.closeOrder.bind(purchaseController)),
);
router.post('/orders/:id/delivery',
  requirePermissionsOrRoles(['purchase:order:delivery'], 'purchaser', 'purchase'),
  asyncHandler(purchaseController.createDeliveryNote.bind(purchaseController)),
);

// 三单匹配
router.post('/three-way-match',
  requirePermissionsOrRoles(['purchase:match:execute'], 'purchaser', 'purchase'),
  asyncHandler(purchaseController.runMatch.bind(purchaseController)),
);
router.get('/three-way-match', requirePermissionsOrRoles(['purchase:match:execute'], 'purchaser', 'purchase'), asyncHandler(purchaseController.listMatches.bind(purchaseController)));
router.get('/three-way-match/:id', requirePermissionsOrRoles(['purchase:match:execute'], 'purchaser', 'purchase'), asyncHandler(purchaseController.getMatchById.bind(purchaseController)));
router.post('/three-way-match/:id/confirm',
  requirePermissionsOrRoles(['purchase:match:confirm'], 'purchaser', 'purchase'),
  asyncHandler(purchaseController.confirmDiff.bind(purchaseController)),
);

// 采购结算
router.get('/settlements/export/csv',
  requirePermissionsOrRoles(['purchase:settlement:manage'], 'boss', 'supervisor', 'purchaser', 'purchase'),
  asyncHandler(purchaseController.exportSettlements.bind(purchaseController)),
);
router.post('/settlements',
  requirePermissionsOrRoles(['purchase:settlement:manage'], 'boss', 'supervisor', 'purchaser', 'purchase'),
  asyncHandler(purchaseController.createSettlement.bind(purchaseController)),
);
router.get('/settlements',
  requirePermissionsOrRoles(['purchase:settlement:manage'], 'boss', 'supervisor', 'purchaser', 'purchase'),
  asyncHandler(purchaseController.listSettlements.bind(purchaseController)),
);
router.get('/settlements/:id',
  requirePermissionsOrRoles(['purchase:settlement:manage'], 'boss', 'supervisor', 'purchaser', 'purchase'),
  asyncHandler(purchaseController.getSettlementById.bind(purchaseController)),
);
router.put('/settlements/:id/confirm',
  requirePermissionsOrRoles(['purchase:settlement:boss'], 'boss'),
  asyncHandler(purchaseController.confirmSettlement.bind(purchaseController)),
);
router.put('/settlements/:id/pay',
  requirePermissionsOrRoles(['purchase:settlement:boss'], 'boss'),
  asyncHandler(purchaseController.paySettlement.bind(purchaseController)),
);
router.put('/settlements/:id/cancel',
  requirePermissionsOrRoles(['purchase:settlement:manage'], 'boss', 'supervisor'),
  asyncHandler(purchaseController.cancelSettlement.bind(purchaseController)),
);

export default router;
