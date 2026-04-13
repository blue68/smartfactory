import { Request, Response } from 'express';
import { z } from 'zod';
import { created, success } from '../../shared/ApiResponse';
import { PaginationSchema } from '../../middleware/validator';
import { PermissionSnapshot } from '../access-control/access-control.types';
import { ConsumableService } from './consumable.service';

const ConsumableIssueItemSchema = z.object({
  skuId: z.number().int().positive(),
  qtyRequested: z.string().regex(/^\d+(\.\d{1,4})?$/),
  issueUnit: z.string().trim().min(1).max(20),
  warehouseId: z.number().int().positive().optional(),
  locationId: z.number().int().positive().optional(),
  dyeLotNo: z.string().trim().min(1).max(100).optional(),
  budgetCode: z.string().trim().max(50).optional(),
  notes: z.string().trim().max(500).optional(),
});

const CreateConsumableIssueSchema = z.object({
  requestDepartmentId: z.number().int().positive().optional(),
  purpose: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(500).optional(),
  items: z.array(ConsumableIssueItemSchema).min(1),
});

const ApproveConsumableIssueSchema = z.object({
  approved: z.boolean(),
  notes: z.string().trim().max(500).optional(),
});

const ExecuteConsumableIssueSchema = z.object({
  notes: z.string().trim().max(500).optional(),
});

export class ConsumableController {
  private svc(req: Request): ConsumableService {
    return new ConsumableService({
      tenantId: req.tenantId,
      userId: req.userId,
      permissionSnapshot: req.permissionSnapshot as PermissionSnapshot | undefined,
    });
  }

  async listIssueOrders(req: Request, res: Response): Promise<void> {
    const q = PaginationSchema.extend({
      status: z.string().optional(),
      departmentId: z.coerce.number().int().positive().optional(),
      keyword: z.string().trim().max(100).optional(),
    }).parse(req.query);

    const data = await this.svc(req).listIssueOrders(q);
    success(res, data);
  }

  async getIssueOrderById(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    const data = await this.svc(req).getIssueOrderById(id);
    success(res, data);
  }

  async createIssueOrder(req: Request, res: Response): Promise<void> {
    const body = CreateConsumableIssueSchema.parse(req.body);
    const data = await this.svc(req).createIssueOrder(body);
    created(res, data, '损耗品领用单已创建');
  }

  async approveIssueOrder(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    const body = ApproveConsumableIssueSchema.parse(req.body);
    await this.svc(req).approveIssueOrder(id, body);
    success(res, null, body.approved ? '领用单审批通过' : '领用单已驳回');
  }

  async executeIssueOrder(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    const body = ExecuteConsumableIssueSchema.parse(req.body ?? {});
    const data = await this.svc(req).executeIssueOrder(id, body);
    success(res, data, '损耗品领用已执行');
  }

  async listStock(req: Request, res: Response): Promise<void> {
    const q = PaginationSchema.extend({
      warehouseId: z.coerce.number().int().positive().optional(),
      keyword: z.string().trim().max(100).optional(),
    }).parse(req.query);
    const data = await this.svc(req).listConsumableStock(q);
    success(res, data);
  }
}

export const consumableController = new ConsumableController();
