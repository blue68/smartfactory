import { Request, Response } from 'express';
import { z } from 'zod';
import { ProductionBatchService } from './production-batch.service';
import { buildPaginated, created, success } from '../../shared/ApiResponse';
import { PaginationSchema } from '../../middleware/validator';

const BatchModeSchema = z.enum(['priority_sequential', 'compatible_merge']);

const BatchListQuerySchema = PaginationSchema.extend({
  status: z.string().optional(),
  keyword: z.string().max(100).optional(),
});

const EligibleSalesOrderQuerySchema = PaginationSchema.extend({
  keyword: z.string().max(100).optional(),
  customerId: z.coerce.number().int().positive().optional(),
});

const CreateBatchBodySchema = z.object({
  mode: BatchModeSchema,
  salesOrderIds: z.array(z.number().int().positive()).min(1),
  notes: z.string().max(500).optional(),
  name: z.string().max(100).optional(),
});

class ProductionBatchController {
  private svc(req: Request): ProductionBatchService {
    return new ProductionBatchService({ tenantId: req.tenantId, userId: req.userId });
  }

  async listEligibleSalesOrders(req: Request, res: Response): Promise<void> {
    const query = EligibleSalesOrderQuerySchema.parse(req.query);
    const { list, total } = await this.svc(req).listEligibleSalesOrders(query);
    success(res, buildPaginated(list, total, query.page, query.pageSize));
  }

  async listBatches(req: Request, res: Response): Promise<void> {
    const query = BatchListQuerySchema.parse(req.query);
    const { list, total } = await this.svc(req).listBatches(query);
    success(res, buildPaginated(list, total, query.page, query.pageSize));
  }

  async createBatch(req: Request, res: Response): Promise<void> {
    const body = CreateBatchBodySchema.parse(req.body);
    const data = await this.svc(req).createBatch(body);
    created(res, data, '联合生产批次已创建');
  }

  async getBatchDetail(req: Request, res: Response): Promise<void> {
    const batchId = z.coerce.number().int().positive().parse(req.params.id);
    const data = await this.svc(req).getBatchDetail(batchId);
    success(res, data);
  }

  async confirmBatch(req: Request, res: Response): Promise<void> {
    const batchId = z.coerce.number().int().positive().parse(req.params.id);
    const data = await this.svc(req).confirmBatch(batchId);
    success(res, data, '联合生产批次已确认并生成执行工单');
  }

  async getBatchShortages(req: Request, res: Response): Promise<void> {
    const batchId = z.coerce.number().int().positive().parse(req.params.id);
    const data = await this.svc(req).getBatchShortages(batchId);
    success(res, data);
  }

  async generateBatchPurchaseSuggestions(req: Request, res: Response): Promise<void> {
    const batchId = z.coerce.number().int().positive().parse(req.params.id);
    const data = await this.svc(req).generateBatchPurchaseSuggestions(batchId);
    success(res, data, '联合生产批次采购建议已生成');
  }
}

export const productionBatchController = new ProductionBatchController();
