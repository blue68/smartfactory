import { Request, Response } from 'express';
import { z } from 'zod';
import { PriceService } from './price.service';
import { success, created, buildPaginated } from '../../shared/ApiResponse';
import { PaginationSchema } from '../../middleware/validator';

const ListQuerySchema = PaginationSchema.extend({
  keyword: z.string().max(100).optional(),
  supplierId: z.coerce.number().int().positive().optional(),
  skuId: z.coerce.number().int().positive().optional(),
  isActive: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
});

const CreateSchema = z.object({
  supplierId: z.number().int().positive(),
  skuId: z.number().int().positive(),
  unitPrice: z.string().regex(/^\d+(\.\d{1,4})?$/),
  purchaseUnit: z.string().min(1).max(20),
  moq: z.number().int().positive().optional(),
  validFrom: z.string().optional(),
  validTo: z.string().optional(),
});

export class PriceController {
  private svc(req: Request): PriceService {
    return new PriceService({ tenantId: req.tenantId, userId: req.userId });
  }

  async list(req: Request, res: Response): Promise<void> {
    const q = ListQuerySchema.parse(req.query);
    const [list, total] = await this.svc(req).list({
      page: q.page,
      pageSize: q.pageSize,
      keyword: q.keyword,
      supplierId: q.supplierId,
      skuId: q.skuId,
      isActive: q.isActive,
    });
    success(res, buildPaginated(list, total, q.page, q.pageSize));
  }

  async getOne(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    const price = await this.svc(req).getById(id);
    success(res, price);
  }

  async create(req: Request, res: Response): Promise<void> {
    const body = CreateSchema.parse(req.body);
    const price = await this.svc(req).create(body);
    created(res, price, '价格协议已创建');
  }

  async update(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    const body = CreateSchema.partial().parse(req.body);
    const price = await this.svc(req).update(id, body);
    success(res, price, '价格协议已更新');
  }

  // BE-P1-014: 价格历史
  async getPriceHistory(req: Request, res: Response): Promise<void> {
    const skuId = Number(req.params.skuId);
    const supplierId = req.query.supplierId ? Number(req.query.supplierId) : undefined;
    const data = await this.svc(req).getPriceHistory(skuId, supplierId);
    success(res, data);
  }
}

export const priceController = new PriceController();
