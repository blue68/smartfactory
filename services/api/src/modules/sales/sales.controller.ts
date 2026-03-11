import { Request, Response } from 'express';
import { z } from 'zod';
import { SalesService } from './sales.service';
import { success, created, buildPaginated } from '../../shared/ApiResponse';
import { PaginationSchema } from '../../middleware/validator';
import { UpdateOrderParams } from './sales.service';

const OrderItemSchema = z.object({
  skuId: z.number().int().positive(),
  bomId: z.number().int().positive(),
  qtyOrdered: z.string().regex(/^\d+(\.\d{1,4})?$/),
  unitPrice: z.string().regex(/^\d+(\.\d{1,2})?$/),
});

const CreateOrderSchema = z.object({
  customerId: z.number().int().positive(),
  orderType: z.enum(['normal', 'urgent']).default('normal'),
  expectedDelivery: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().max(500).optional(),
  items: z.array(OrderItemSchema).min(1),
});

const ApproveOrderSchema = z.object({
  action: z.enum(['approved', 'rejected', 'conditional']),
  notes: z.string().max(1000).optional(),
});

const AnalyzeUrgentSchema = z.object({
  skuId: z.number().int().positive(),
  bomId: z.number().int().positive(),
  qty: z.string().regex(/^\d+(\.\d{1,4})?$/),
  expectedDelivery: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

// BE-P1-006: 修改订单 schema
// items、expectedDelivery、notes 均为可选，但至少需传入其中一个
const UpdateOrderSchema = z
  .object({
    expectedDelivery: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    notes: z.string().max(500).optional(),
    items: z.array(OrderItemSchema).min(1).optional(),
  })
  .refine(
    (data) =>
      data.expectedDelivery !== undefined ||
      data.notes !== undefined ||
      (data.items !== undefined && data.items.length > 0),
    { message: '至少需要提供 expectedDelivery、notes 或 items 中的一个字段' },
  );

// BE-P1-007: 取消订单 schema
const CancelOrderSchema = z.object({
  reason: z.string().max(500).optional(),
});

// BE-P2-007: 发货 schema
const ShipOrderSchema = z.object({
  trackingNo: z.string().max(128).optional(),
  shippedItems: z
    .array(
      z.object({
        orderItemId: z.number().int().positive(),
        shippedQty: z.number().positive(),
      }),
    )
    .min(1, 'shippedItems 至少包含一条明细'),
});

export class SalesController {
  private svc(req: Request) {
    return new SalesService({ tenantId: req.tenantId, userId: req.userId });
  }

  async list(req: Request, res: Response): Promise<void> {
    const q = PaginationSchema.extend({
      status: z.string().optional(),
      customerId: z.coerce.number().int().positive().optional(),
    }).parse(req.query);
    const { list, total } = await this.svc(req).listOrders(q);
    success(res, buildPaginated(list, total, q.page, q.pageSize));
  }

  async getOne(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    const data = await this.svc(req).getOrderWithConstraint(id);
    success(res, data);
  }

  async create(req: Request, res: Response): Promise<void> {
    const body = CreateOrderSchema.parse(req.body);
    const data = await this.svc(req).createOrder(body);
    created(res, data, data.requiresApproval ? '订单已提交，等待审批' : '订单创建成功');
  }

  async approve(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    const { action, notes } = ApproveOrderSchema.parse(req.body);
    await this.svc(req).approveOrder(id, action, notes);
    success(res, null, '审批操作已完成');
  }

  async analyzeUrgent(req: Request, res: Response): Promise<void> {
    const body = AnalyzeUrgentSchema.parse(req.body);
    const data = await this.svc(req).analyzeUrgentOrder(body);
    success(res, data, '插单影响分析完成');
  }

  // BE-P1-006: 修改销售订单
  async updateOrder(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    const payload = UpdateOrderSchema.parse(req.body) as UpdateOrderParams;
    const data = await this.svc(req).updateOrder(id, payload);
    success(
      res,
      data,
      data.requiresApproval ? '订单已更新，因约束检查未通过需重新审批' : '订单更新成功',
    );
  }

  // BE-P1-007: 取消销售订单
  async cancelOrder(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    const { reason } = CancelOrderSchema.parse(req.body);
    const data = await this.svc(req).cancelOrder(id, reason);
    success(res, data, '订单已取消');
  }

  // BE-P2-007: 发货确认
  async shipOrder(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    const body = ShipOrderSchema.parse(req.body);
    const data = await this.svc(req).shipOrder(id, body);
    success(res, data, '发货记录已创建');
  }

  // BE-P2-007: 收货确认
  async confirmReceipt(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    const deliveryId = Number(req.params.deliveryId);
    if (!Number.isInteger(deliveryId) || deliveryId <= 0) {
      throw new Error('deliveryId 必须为正整数');
    }
    const data = await this.svc(req).confirmReceipt(id, deliveryId);
    success(res, data, data.orderCompleted ? '收货已确认，订单已完成' : '收货已确认');
  }
  // BE-P2-008: 创建结算单
  async createSettlement(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    const body = z.object({
      dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      notes: z.string().max(500).optional(),
    }).parse(req.body);
    const data = await this.svc(req).createSettlement(id, body);
    created(res, data, '结算单创建成功');
  }

  // BE-P2-008: 录入付款
  async recordPayment(req: Request, res: Response): Promise<void> {
    const settlementId = Number(req.params.settlementId);
    const body = z.object({
      paymentAmount: z.string().regex(/^\d+(\.\d{1,2})?$/),
      paymentMethod: z.string().max(32).optional(),
      paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      referenceNo: z.string().max(64).optional(),
      notes: z.string().max(500).optional(),
    }).parse(req.body);
    const data = await this.svc(req).recordPayment(settlementId, body);
    success(res, data, '付款记录已录入');
  }

  // BE-P2-008: 更新开票信息
  async updateInvoice(req: Request, res: Response): Promise<void> {
    const settlementId = Number(req.params.settlementId);
    const body = z.object({
      invoiceNo: z.string().max(64),
      invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }).parse(req.body);
    await this.svc(req).updateInvoice(settlementId, body);
    success(res, null, '开票信息已更新');
  }

  // BE-P2-008: 应收账款汇总
  async getReceivables(req: Request, res: Response): Promise<void> {
    const data = await this.svc(req).getReceivableSummary();
    success(res, data);
  }
}

export const salesController = new SalesController();
