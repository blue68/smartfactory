import { Router, Request, Response } from 'express';
import { salesController } from './sales.controller';
import { SalesService } from './sales.service';
import { authMiddleware, requireRoles } from '../../middleware/auth';
import { asyncHandler } from '../../app';

const router = Router();
router.use(authMiddleware);

router.get('/',                   asyncHandler(salesController.list.bind(salesController)));

// BE-P2-008: 应收账款汇总（必须在 /:id 之前注册）
router.get('/receivables',
  requireRoles('boss', 'sales'),
  asyncHandler(salesController.getReceivables.bind(salesController)),
);

// BE-P2-014: 销售订单 CSV 导出
// 注意：固定路由 export/csv 必须在参数路由 /:id 之前注册，避免 Express 路由歧义
router.get('/export/csv', asyncHandler(async (req: Request, res: Response) => {
  const svc = new SalesService({ tenantId: req.tenantId, userId: req.userId, roles: req.roles ?? [] });
  const HEADERS = ['订单号', '客户名称', '总金额', '状态', '预计交期', '创建时间'];

  // RFC 5987 编码中文文件名，兼容主流浏览器
  const encodedFilename = encodeURIComponent('销售订单.csv');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="sales_orders.csv"; filename*=UTF-8''${encodedFilename}`);

  // 字段值转义：包含逗号、引号、换行时用双引号包裹，内部引号加倍
  const escape = (s: string) => `"${String(s ?? '').replace(/"/g, '""')}"`;

  // 写入 UTF-8 BOM + 表头，确保 Excel 正确识别中文
  res.write('\uFEFF' + HEADERS.map(escape).join(',') + '\n');

  // 分批查询写入，每批 500 条，避免全量加载内存 (IMP-003)
  const BATCH_SIZE = 500;
  let page = 1;
  let hasMore = true;
  while (hasMore) {
    const { list } = await svc.listOrders({ page, pageSize: BATCH_SIZE });
    for (const so of list as Array<Record<string, unknown>>) {
      // expected_delivery 可能是 Date 对象，取 YYYY-MM-DD 部分
      const expectedDelivery = so.expected_delivery instanceof Date
        ? so.expected_delivery.toISOString().slice(0, 10)
        : String(so.expected_delivery ?? '');
      // created_at 可能是 Date 对象或字符串，统一格式化为 YYYY-MM-DD HH:mm:ss
      const createdAt = so.created_at instanceof Date
        ? so.created_at.toISOString().replace('T', ' ').slice(0, 19)
        : String(so.created_at ?? '');
      res.write([
        String(so.order_no ?? ''),
        String(so.customerName ?? ''),
        String(so.total_amount ?? ''),
        String(so.status ?? ''),
        expectedDelivery,
        createdAt,
      ].map(escape).join(',') + '\n');
    }
    hasMore = list.length === BATCH_SIZE;
    page++;
  }
  res.end();
}));

router.get('/:id',                asyncHandler(salesController.getOne.bind(salesController)));
router.post('/',
  requireRoles('sales', 'boss'),
  asyncHandler(salesController.create.bind(salesController)),
);
router.post('/:id/approve',
  requireRoles('boss'),
  asyncHandler(salesController.approve.bind(salesController)),
);
router.post('/analyze-urgent',
  requireRoles('sales', 'boss', 'supervisor'),
  asyncHandler(salesController.analyzeUrgent.bind(salesController)),
);

// BE-P1-006: 修改销售订单（注意：必须在 /:id/cancel 之前注册，避免路由冲突）
router.put('/orders/:id',
  requireRoles('sales', 'boss'),
  asyncHandler(salesController.updateOrder.bind(salesController)),
);

// BE-P1-007: 取消销售订单
router.post('/orders/:id/cancel',
  requireRoles('sales', 'boss'),
  asyncHandler(salesController.cancelOrder.bind(salesController)),
);

// BE-P2-007: 发货确认（仓库/主管操作）
router.post('/:id/ship',
  requireRoles('warehouse', 'supervisor'),
  asyncHandler(salesController.shipOrder.bind(salesController)),
);

// BE-P2-007: 收货确认（老板/主管/销售确认）
router.post('/:id/deliveries/:deliveryId/confirm',
  requireRoles('boss', 'supervisor', 'sales'),
  asyncHandler(salesController.confirmReceipt.bind(salesController)),
);

// BE-P2-008: 财务结算
router.post('/:id/settlement',
  requireRoles('boss', 'sales'),
  asyncHandler(salesController.createSettlement.bind(salesController)),
);
router.post('/settlements/:settlementId/payments',
  requireRoles('boss', 'sales'),
  asyncHandler(salesController.recordPayment.bind(salesController)),
);
router.put('/settlements/:settlementId/invoice',
  requireRoles('boss', 'sales'),
  asyncHandler(salesController.updateInvoice.bind(salesController)),
);

export default router;
