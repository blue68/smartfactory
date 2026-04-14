import { Request, Response } from 'express';
import { z } from 'zod';
import { success, created } from '../../shared/ApiResponse';
import { PaginationSchema } from '../../middleware/validator';
import { DepartmentService } from './department.service';

const DepartmentSchema = z.object({
  code: z.string().trim().min(1, '部门编码不能为空').max(50, '部门编码最长 50 个字符'),
  name: z.string().trim().min(1, '部门名称不能为空').max(100, '部门名称最长 100 个字符'),
  status: z.enum(['active', 'inactive', 'locked', 'archived']).optional(),
  sortOrder: z.number().int().min(-9999).max(9999).optional(),
  notes: z.string().trim().max(255, '备注最长 255 个字符').nullable().optional(),
});

const DepartmentStatusSchema = z.object({
  status: z.enum(['active', 'inactive', 'locked', 'archived']),
});

export class DepartmentController {
  private svc(req: Request): DepartmentService {
    return new DepartmentService({
      tenantId: req.tenantId,
      userId: req.userId,
    });
  }

  async list(req: Request, res: Response): Promise<void> {
    const query = PaginationSchema.extend({
      keyword: z.string().trim().max(100).optional(),
      status: z.string().trim().max(20).optional(),
    }).parse(req.query);
    const data = await this.svc(req).list(query);
    success(res, data);
  }

  async create(req: Request, res: Response): Promise<void> {
    const data = await this.svc(req).create(DepartmentSchema.parse(req.body ?? {}));
    created(res, data, '部门已创建');
  }

  async update(req: Request, res: Response): Promise<void> {
    const data = await this.svc(req).update(
      Number(req.params.id),
      DepartmentSchema.parse(req.body ?? {}),
    );
    success(res, data, '部门已更新');
  }

  async updateStatus(req: Request, res: Response): Promise<void> {
    const body = DepartmentStatusSchema.parse(req.body ?? {});
    const data = await this.svc(req).updateStatus(Number(req.params.id), body.status);
    success(res, data, '部门状态已更新');
  }
}

export const departmentController = new DepartmentController();
