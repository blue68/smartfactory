import { Request, Response } from 'express';
import { z } from 'zod';
import { QualityService } from './quality.service';
import { success, created, buildPaginated } from '../../shared/ApiResponse';
import { PaginationSchema } from '../../middleware/validator';

const CreateInspectionSchema = z.object({
  productionOrderId: z.number().int().positive(),
  inspectionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  qtyInspected: z.string().regex(/^\d+(\.\d{1,4})?$/),
});

const RecordIssueSchema = z.object({
  inspectionId: z.number().int().positive(),
  componentName: z.string().min(1).max(200),
  issueTypes: z.array(z.enum(['appearance', 'dimension', 'function', 'material'])).min(1),
  severity: z.enum(['minor', 'normal', 'severe']),
  description: z.string().max(1000).optional(),
  images: z.array(z.string()).max(3).optional(),
});

const CompleteInspectionSchema = z.object({
  qtyPassed: z.string().regex(/^\d+(\.\d{1,4})?$/),
});

export class QualityController {
  private svc(req: Request) {
    return new QualityService({ tenantId: req.tenantId, userId: req.userId });
  }

  async listInspections(req: Request, res: Response): Promise<void> {
    const q = PaginationSchema.extend({
      status: z.string().optional(),
      productionOrderId: z.coerce.number().int().positive().optional(),
    }).parse(req.query);
    const { list, total } = await this.svc(req).listInspections(q);
    success(res, buildPaginated(list, total, q.page, q.pageSize));
  }

  async createInspection(req: Request, res: Response): Promise<void> {
    const body = CreateInspectionSchema.parse(req.body);
    const data = await this.svc(req).createInspection(body);
    created(res, data, '验货单已创建');
  }

  async recordIssue(req: Request, res: Response): Promise<void> {
    const body = RecordIssueSchema.parse(req.body);
    const data = await this.svc(req).recordQualityIssue(body);
    created(res, data, '质量问题已记录');
  }

  async completeInspection(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    const { qtyPassed } = CompleteInspectionSchema.parse(req.body);
    await this.svc(req).completeInspection(id, qtyPassed);
    success(res, null, '验货已完成');
  }

  async getTraceability(req: Request, res: Response): Promise<void> {
    const productionOrderId = Number(req.params.productionOrderId);
    const data = await this.svc(req).getTraceabilityChain(productionOrderId);
    success(res, data);
  }

  async getStats(req: Request, res: Response): Promise<void> {
    const periodDays = z.coerce.number().refine((v) => [7, 30, 90].includes(v))
      .transform((v) => v as 7 | 30 | 90)
      .parse(req.query.periodDays ?? '30');
    const data = await this.svc(req).getQualityStats(periodDays);
    success(res, data);
  }

  async listIssues(req: Request, res: Response): Promise<void> {
    const q = PaginationSchema.extend({
      severity: z.enum(['minor', 'normal', 'severe']).optional(),
      issueType: z.string().max(50).optional(),
    }).parse(req.query);
    const data = await this.svc(req).listIssues(q);
    success(res, buildPaginated(data.list, data.total, q.page, q.pageSize));
  }

  async getIssueDetail(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    const data = await this.svc(req).getIssueDetail(id);
    success(res, data);
  }
}

export const qualityController = new QualityController();
