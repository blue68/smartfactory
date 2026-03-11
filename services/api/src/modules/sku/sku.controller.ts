import { Request, Response } from 'express';
import { z } from 'zod';
import { SkuService } from './sku.service';
import { success, created, buildPaginated } from '../../shared/ApiResponse';
import { PaginationSchema } from '../../middleware/validator';

const CreateSkuSchema = z.object({
  skuCode: z.string().max(50).optional(),
  barcode: z.string().max(100).optional(),
  name: z.string().min(1).max(200),
  spec: z.string().max(500).optional(),
  category1Id: z.number().int().positive(),
  category2Id: z.number().int().positive(),
  stockUnit: z.string().min(1).max(20),
  purchaseUnit: z.string().min(1).max(20),
  productionUnit: z.string().min(1).max(20),
  hasDyeLot: z.boolean().optional(),
  safetyStock: z.string().regex(/^\d+(\.\d{1,4})?$/).optional(),
  description: z.string().optional(),
});

const ListSkuQuerySchema = PaginationSchema.extend({
  category1Id: z.coerce.number().int().positive().optional(),
  category2Id: z.coerce.number().int().positive().optional(),
  keyword: z.string().max(100).optional(),
  hasDyeLot: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  status: z.enum(['active', 'inactive']).optional(),
});

const UnitConversionSchema = z.object({
  conversions: z.array(z.object({
    fromUnit: z.string().min(1).max(20),
    toUnit: z.string().min(1).max(20),
    conversionRate: z.string().regex(/^\d+(\.\d{1,6})?$/),
    description: z.string().max(100).optional(),
  })).min(1),
});

export class SkuController {
  private svc(req: Request): SkuService {
    return new SkuService({ tenantId: req.tenantId, userId: req.userId });
  }

  async list(req: Request, res: Response): Promise<void> {
    const q = ListSkuQuerySchema.parse(req.query);
    const [list, total] = await this.svc(req).listSkus({
      page: q.page,
      pageSize: q.pageSize,
      category1Id: q.category1Id,
      category2Id: q.category2Id,
      keyword: q.keyword,
      hasDyeLot: q.hasDyeLot,
      status: q.status,
    });
    success(res, buildPaginated(list, total, q.page, q.pageSize));
  }

  async getOne(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    const sku = await this.svc(req).getSkuById(id);
    success(res, sku);
  }

  async create(req: Request, res: Response): Promise<void> {
    const body = CreateSkuSchema.parse(req.body);
    const sku = await this.svc(req).createSku(body);
    created(res, sku, 'SKU已创建');
  }

  async update(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    const body = CreateSkuSchema.partial().parse(req.body);
    const sku = await this.svc(req).updateSku(id, body);
    success(res, sku, 'SKU已更新');
  }

  async setUnitConversions(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    const { conversions } = UnitConversionSchema.parse(req.body);
    const result = await this.svc(req).setUnitConversions(id, conversions);
    success(res, result, '单位换算关系已保存');
  }

  async getCategories(req: Request, res: Response): Promise<void> {
    const categories = await this.svc(req).getCategories();
    success(res, categories);
  }
}

export const skuController = new SkuController();
