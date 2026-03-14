import { Request, Response } from 'express';
import { z } from 'zod';
import { PurchaseSuggestionService } from './purchase-suggestion.service';
import { success, buildPaginated } from '../../shared/ApiResponse';

const RejectSchema = z.object({
  reason: z.string().min(1).max(500),
});

const BatchToPOSchema = z.object({
  suggestionIds: z.array(z.number().int().positive()).min(1).max(100),
});

class PurchaseSuggestionController {
  async list(req: Request, res: Response): Promise<void> {
    const ctx = { tenantId: (req as any).tenantId, userId: (req as any).userId };
    const svc = new PurchaseSuggestionService(ctx);
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));
    const result = await svc.listSuggestions({
      status: req.query.status as string | undefined,
      source: req.query.source as string | undefined,
      skuId: req.query.skuId ? Number(req.query.skuId) : undefined,
      page,
      pageSize,
    });
    success(res, buildPaginated(result.list, result.total, page, pageSize));
  }

  async approve(req: Request, res: Response): Promise<void> {
    const ctx = { tenantId: (req as any).tenantId, userId: (req as any).userId };
    const svc = new PurchaseSuggestionService(ctx);
    await svc.approveSuggestion(Number(req.params.id));
    success(res, null, '审批通过');
  }

  async reject(req: Request, res: Response): Promise<void> {
    const ctx = { tenantId: (req as any).tenantId, userId: (req as any).userId };
    const svc = new PurchaseSuggestionService(ctx);
    const body = RejectSchema.parse(req.body);
    await svc.rejectSuggestion(Number(req.params.id), body.reason);
    success(res, null, '已驳回');
  }

  async batchToPO(req: Request, res: Response): Promise<void> {
    const ctx = { tenantId: (req as any).tenantId, userId: (req as any).userId };
    const svc = new PurchaseSuggestionService(ctx);
    const body = BatchToPOSchema.parse(req.body);
    const result = await svc.batchCreatePOFromSuggestions(body.suggestionIds);
    success(res, result, '批量转单成功');
  }
}

export const purchaseSuggestionController = new PurchaseSuggestionController();
