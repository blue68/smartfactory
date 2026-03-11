import { Request, Response } from 'express';
import { z } from 'zod';
import { CustomerService } from './customer.service';
import { success, created, buildPaginated } from '../../shared/ApiResponse';
import { PaginationSchema } from '../../middleware/validator';

const ListQuerySchema = PaginationSchema.extend({
  keyword: z.string().max(100).optional(),
  status: z.enum(['active', 'inactive']).optional(),
});

const CreateSchema = z.object({
  code: z.string().min(1).max(50),
  name: z.string().min(1).max(200),
  contact: z.string().max(100).optional(),
  phone: z.string().max(30).optional(),
  address: z.string().max(300).optional(),
});

export class CustomerController {
  private svc(req: Request): CustomerService {
    return new CustomerService({ tenantId: req.tenantId, userId: req.userId });
  }

  async list(req: Request, res: Response): Promise<void> {
    const q = ListQuerySchema.parse(req.query);
    const [list, total] = await this.svc(req).list({
      page: q.page,
      pageSize: q.pageSize,
      keyword: q.keyword,
      status: q.status,
    });
    success(res, buildPaginated(list, total, q.page, q.pageSize));
  }

  async options(req: Request, res: Response): Promise<void> {
    const list = await this.svc(req).getOptions();
    success(res, list);
  }

  async getOne(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    const customer = await this.svc(req).getById(id);
    success(res, customer);
  }

  async create(req: Request, res: Response): Promise<void> {
    const body = CreateSchema.parse(req.body);
    const customer = await this.svc(req).create(body);
    created(res, customer, '客户已创建');
  }

  async update(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    const body = CreateSchema.partial().parse(req.body);
    const customer = await this.svc(req).update(id, body);
    success(res, customer, '客户已更新');
  }
}

export const customerController = new CustomerController();
