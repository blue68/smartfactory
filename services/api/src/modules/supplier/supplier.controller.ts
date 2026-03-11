import { Request, Response } from 'express';
import { z } from 'zod';
import { SupplierService } from './supplier.service';
import { success, created, buildPaginated } from '../../shared/ApiResponse';
import { PaginationSchema } from '../../middleware/validator';

const ListQuerySchema = PaginationSchema.extend({
  keyword: z.string().max(100).optional(),
  rating: z.enum(['A', 'B', 'C']).optional(),
  isActive: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
});

const CreateSchema = z.object({
  code: z.string().min(1).max(50),
  name: z.string().min(1).max(200),
  grade: z.enum(['A', 'B', 'C']).optional(),
  contact: z.string().max(100).optional(),
  phone: z.string().max(30).optional(),
  address: z.string().max(300).optional(),
  mainSkus: z.array(z.number().int().positive()).optional(),
});

export class SupplierController {
  private svc(req: Request): SupplierService {
    return new SupplierService({ tenantId: req.tenantId, userId: req.userId });
  }

  async list(req: Request, res: Response): Promise<void> {
    const q = ListQuerySchema.parse(req.query);
    const [list, total] = await this.svc(req).list({
      page: q.page,
      pageSize: q.pageSize,
      keyword: q.keyword,
      rating: q.rating,
      isActive: q.isActive,
    });
    success(res, buildPaginated(list, total, q.page, q.pageSize));
  }

  async options(req: Request, res: Response): Promise<void> {
    const list = await this.svc(req).getOptions();
    success(res, list);
  }

  async getOne(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    const supplier = await this.svc(req).getById(id);
    success(res, supplier);
  }

  async create(req: Request, res: Response): Promise<void> {
    const body = CreateSchema.parse(req.body);
    const supplier = await this.svc(req).create(body);
    created(res, supplier, '供应商已创建');
  }

  async update(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    const body = CreateSchema.partial().parse(req.body);
    const supplier = await this.svc(req).update(id, body);
    success(res, supplier, '供应商已更新');
  }

  // BE-P1: 供应商绩效
  async getPerformance(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    const data = await this.svc(req).getPerformance(id);
    success(res, data);
  }

  // BE-P1-013: 月度对账单
  async getMonthlyStatement(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    const month = z.string().regex(/^\d{4}-\d{2}$/).parse(req.query.month as string);
    const data = await this.svc(req).getMonthlyStatement(id, month);
    success(res, data);
  }
}

export const supplierController = new SupplierController();
