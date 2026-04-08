import { Request, Response } from 'express';
import { z } from 'zod';
import { ReturnOrderService } from './returnOrder.service';
import { success, created, buildPaginated } from '../../shared/ApiResponse';
import { PaginationSchema } from '../../middleware/validator';

// ─── Zod Schemas ─────────────────────────────────────────────────

const ReturnOrderItemSchema = z.object({
  skuId: z.number().int().positive({ message: 'skuId 必须为正整数' }),
  qtyReturn: z.string().regex(/^\d+(\.\d{1,4})?$/, '退货数量格式不合法'),
  purchaseUnit: z.string().min(1).max(20),
  unitPrice: z.string().regex(/^\d+(\.\d{1,2})?$/, '单价格式不合法'),
  defectReason: z.string().max(500).optional(),
});

const CreateReturnOrderSchema = z.object({
  returnType: z.enum(['purchase_return', 'production_return']),
  sourcePoId: z.number().int().positive().optional(),
  supplierId: z.number().int().positive().optional(),
  returnReason: z.string().min(1, '退货原因不能为空').max(500),
  notes: z.string().max(500).optional(),
  items: z.array(ReturnOrderItemSchema).min(1, '至少需要一条退货明细'),
});

const ListReturnOrderQuerySchema = PaginationSchema.extend({
  status: z.string().optional(),
  returnType: z.string().optional(),
  supplierId: z.coerce.number().int().positive().optional(),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  keyword: z.string().trim().max(100).optional(),
});

const ShipReturnOrderSchema = z.object({
  trackingNo: z.string().trim().max(100).optional(),
  notes: z.string().trim().max(500).optional(),
  warehouseId: z.number().int().positive().optional(),
  locationId: z.number().int().positive().optional(),
});

const CompleteReturnOrderSchema = z.object({
  notes: z.string().trim().max(500).optional(),
});

// ─── Controller ──────────────────────────────────────────────────

class ReturnOrderController {
  private svc(req: Request): ReturnOrderService {
    return new ReturnOrderService({
      tenantId: (req as any).tenantId,
      userId: (req as any).userId,
    });
  }

  async list(req: Request, res: Response): Promise<void> {
    const q = ListReturnOrderQuerySchema.parse(req.query);
    const { list, total } = await this.svc(req).list(q);
    success(res, buildPaginated(list, total, q.page, q.pageSize));
  }

  async getById(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    const data = await this.svc(req).getById(id);
    success(res, data);
  }

  async create(req: Request, res: Response): Promise<void> {
    const body = CreateReturnOrderSchema.parse(req.body);
    const data = await this.svc(req).create(body);
    created(res, data, '退货单已创建');
  }

  async confirm(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    await this.svc(req).confirm(id);
    success(res, null, '退货单已确认');
  }

  async ship(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    const body = ShipReturnOrderSchema.parse(req.body ?? {});
    await this.svc(req).ship(id, body);
    success(res, null, '退货已标记为发出');
  }

  async complete(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    const body = CompleteReturnOrderSchema.parse(req.body ?? {});
    await this.svc(req).complete(id, body);
    success(res, null, '退货已完成');
  }
}

export const returnOrderController = new ReturnOrderController();
