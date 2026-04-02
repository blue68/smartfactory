import { Request, Response } from 'express';
import { z } from 'zod';
import { SalesOrderService } from './salesOrder.service';
import type { SalesOrderStatus } from './salesOrder.entity';
import { success, created, buildPaginated } from '../../shared/ApiResponse';
import { PaginationSchema } from '../../middleware/validator';

// ─── 状态枚举值列表 ────────────────────────────────────────────────────────
const SALES_ORDER_STATUSES = [
  'draft', 'pending_approval', 'confirmed',
  'produced', 'in_production', 'partial_shipped', 'shipped', 'completed', 'closed',
] as const;

// ─── Schema ─────────────────────────────────────────────────────────────────

const ListQuerySchema = PaginationSchema.extend({
  keyword: z.string().max(100).optional(),
  status: z.enum(SALES_ORDER_STATUSES).optional(),
  customerId: z.coerce.number().int().positive().optional(),
  isUrgent: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
});

const CreateSchema = z.object({
  customerId: z.number().int().positive(),
  orderDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  deliveryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  isUrgent: z.boolean().default(false),
  saveAsDraft: z.boolean().optional(),
  notes: z.string().max(2000).optional(),
  items: z.array(z.object({
    skuId: z.number().int().positive(),
    quantity: z.union([
      z.number().int().positive(),
      z.string().regex(/^\d+$/),
    ]),
    unitPrice: z.string().regex(/^\d+(\.\d{1,2})?$/),
    notes: z.string().max(500).optional(),
  })).default([]),
});

const UpdateItemsSchema = z.object({
  items: z.array(z.object({
    skuId: z.number().int().positive(),
    quantity: z.number().int().positive(),
    unitPrice: z.string().regex(/^\d+(\.\d{1,2})?$/),
    notes: z.string().max(500).optional(),
  })),
});

const TransitionSchema = z.object({
  targetStatus: z.enum(SALES_ORDER_STATUSES),
});

const RejectSchema = z.object({
  reason: z.string().min(1).max(500),
});

const CloseSchema = z.object({
  reason: z.string().min(1).max(500),
});

const ShipSchema = z.object({
  trackingNo: z.string().max(128).optional(),
  shippedItems: z.array(z.object({
    orderItemId: z.coerce.number().int().positive(),
    shippedQty: z.coerce.number().positive(),
  })).optional(),
});

const CapacityCheckQuerySchema = z.object({
  skuId: z.coerce.number().int().positive(),
  quantity: z.coerce.number().int().positive(),
  expectedDelivery: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式必须为 YYYY-MM-DD'),
});

// ─── Controller ─────────────────────────────────────────────────────────────

export class SalesOrderController {
  private svc(req: Request): SalesOrderService {
    return new SalesOrderService({ tenantId: req.tenantId, userId: req.userId });
  }

  async getPendingCount(req: Request, res: Response): Promise<void> {
    const count = await this.svc(req).getPendingApprovalCount();
    success(res, { count });
  }

  async list(req: Request, res: Response): Promise<void> {
    const q = ListQuerySchema.parse(req.query);
    // GAP-R08-04: statusCounts 为全量状态统计，不依赖当前分页/过滤条件
    const { list, total, statusCounts } = await this.svc(req).list({
      page: q.page,
      pageSize: q.pageSize,
      keyword: q.keyword,
      status: q.status as SalesOrderStatus | undefined,
      customerId: q.customerId,
      isUrgent: q.isUrgent,
    });
    success(res, { ...buildPaginated(list, total, q.page, q.pageSize), statusCounts });
  }

  async getOne(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    const data = await this.svc(req).getById(id);
    success(res, data);
  }

  async create(req: Request, res: Response): Promise<void> {
    const body = CreateSchema.parse(req.body);
    const data = await this.svc(req).create({
      ...body,
      items: body.items.map((item) => ({
        skuId: item.skuId,
        quantity: String(item.quantity),
        unitPrice: item.unitPrice,
        notes: item.notes,
      })),
    });
    created(res, data, '销售订单已创建');
  }

  async updateItems(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    const { items } = UpdateItemsSchema.parse(req.body);
    await this.svc(req).updateItems(id, items.map((item) => ({
      skuId: item.skuId,
      quantity: String(item.quantity),
      unitPrice: item.unitPrice,
      notes: item.notes,
    })));
    success(res, null, '订单明细已更新');
  }

  async transition(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    const { targetStatus } = TransitionSchema.parse(req.body);
    await this.svc(req).transition(id, targetStatus as SalesOrderStatus);
    success(res, null, '订单状态已更新');
  }

  async submitForApproval(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    await this.svc(req).submitForApproval(id);
    success(res, null, '已提交审批');
  }

  async approve(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    await this.svc(req).approve(id, req.userId);
    success(res, null, '订单已审批通过');
  }

  async reject(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    const { reason } = RejectSchema.parse(req.body);
    await this.svc(req).reject(id, req.userId, reason);
    success(res, null, '订单已驳回');
  }

  async withdraw(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    await this.svc(req).withdraw(id);
    success(res, null, '审批已撤回');
  }

  /** PUT /sales-orders/:id — 编辑订单（仅 draft） */
  async update(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    const body = CreateSchema.partial().parse(req.body);
    const data = await this.svc(req).updateOrder(id, {
      ...body,
      items: body.items?.map((item) => ({
        skuId: item.skuId,
        quantity: String(item.quantity),
        unitPrice: item.unitPrice,
        notes: item.notes,
      })),
    });
    success(res, data, '订单已更新');
  }

  /** POST /sales-orders/:id/confirm */
  async confirm(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    await this.svc(req).confirm(id);
    success(res, null, '订单已确认');
  }

  /** POST /sales-orders/:id/ship */
  async ship(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    const { trackingNo, shippedItems } = ShipSchema.parse(req.body ?? {});
    await this.svc(req).ship(id, trackingNo, shippedItems);
    success(res, null, '订单已发货');
  }

  /** POST /sales-orders/:id/complete */
  async complete(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    await this.svc(req).complete(id);
    success(res, null, '订单已完成');
  }

  /** POST /sales-orders/:id/close */
  async close(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    const { reason } = CloseSchema.parse(req.body);
    await this.svc(req).close(id, reason);
    success(res, null, '订单已关闭');
  }

  /** POST /sales-orders/:id/production-orders */
  async createProductionOrders(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    const result = await this.svc(req).createProductionOrders(id);
    created(res, result, '生产工单已创建');
  }

  /** GET /sales-orders/pending-approvals */
  async getPendingApprovals(req: Request, res: Response): Promise<void> {
    const data = await this.svc(req).getPendingApprovals();
    success(res, data);
  }

  /**
   * GET /sales-orders/capacity-check
   * 下单前产能可行性预检，不修改任何数据。
   * Query params: skuId, quantity, expectedDelivery (YYYY-MM-DD)
   */
  async capacityCheck(req: Request, res: Response): Promise<void> {
    const query = CapacityCheckQuerySchema.parse(req.query);
    const result = await this.svc(req).capacityCheck({
      skuId: query.skuId,
      quantity: query.quantity,
      expectedDelivery: query.expectedDelivery,
    });
    success(res, result);
  }

  /** GET /sales-orders/stats */
  async getStats(req: Request, res: Response): Promise<void> {
    const data = await this.svc(req).getStats();
    success(res, data);
  }
}

export const salesOrderController = new SalesOrderController();
