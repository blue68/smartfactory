import { Request, Response } from 'express';
import { z } from 'zod';
import { ProcessConfigService } from './processConfig.service';
import { success, created, buildPaginated } from '../../shared/ApiResponse';
import { PaginationSchema } from '../../middleware/validator';

const ListQuerySchema = PaginationSchema.extend({
  keyword: z.string().max(100).optional(),
  type: z.string().max(50).optional(),
});

const StepSchema = z.object({
  stepNo: z.number().int().positive(),
  stepName: z.string().min(1).max(100),
  standardHours: z.number().positive().optional(),
  workstationType: z.string().max(50).optional(),
});

const CreateSchema = z.object({
  name: z.string().min(1).max(200),
  skuId: z.number().int().positive(),
  steps: z.array(StepSchema).optional(),
});

export class ProcessConfigController {
  private svc(req: Request): ProcessConfigService {
    return new ProcessConfigService({ tenantId: req.tenantId, userId: req.userId });
  }

  async list(req: Request, res: Response): Promise<void> {
    const q = ListQuerySchema.parse(req.query);
    const [list, total] = await this.svc(req).list({
      page: q.page,
      pageSize: q.pageSize,
      keyword: q.keyword,
      type: q.type,
    });
    success(res, buildPaginated(list, total, q.page, q.pageSize));
  }

  async getOne(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    const result = await this.svc(req).getById(id);
    success(res, result);
  }

  async create(req: Request, res: Response): Promise<void> {
    const body = CreateSchema.parse(req.body);
    const template = await this.svc(req).create(body);
    created(res, template, '工序模板已创建');
  }

  async update(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    const body = CreateSchema.partial().parse(req.body);
    const template = await this.svc(req).update(id, body);
    success(res, template, '工序模板已更新');
  }

  async remove(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    await this.svc(req).remove(id);
    success(res, { id }, '工序模板已删除');
  }
}

export const processConfigController = new ProcessConfigController();
