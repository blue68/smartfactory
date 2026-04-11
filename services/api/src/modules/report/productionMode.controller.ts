import { Request, Response } from 'express';
import { z } from 'zod';
import { buildPaginated, success } from '../../shared/ApiResponse';
import { PaginationSchema } from '../../middleware/validator';
import { ProductionModeReportService } from './productionMode.service';

const SemiFinishedModeQuerySchema = PaginationSchema.extend({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  keyword: z.string().trim().max(100).optional(),
  modeTag: z.enum(['internal_only', 'outsource_only', 'mixed', 'no_operation']).optional(),
});

export class ProductionModeReportController {
  private svc(req: Request): ProductionModeReportService {
    return new ProductionModeReportService({ tenantId: req.tenantId });
  }

  /** GET /api/reports/production-modes/semi-finished — 半成品外协/自产模式报表 */
  async getSemiFinishedModeReport(req: Request, res: Response): Promise<void> {
    const q = SemiFinishedModeQuerySchema.parse(req.query);
    const [list, total] = await this.svc(req).getSemiFinishedModeReport({
      page: q.page,
      pageSize: q.pageSize,
      from: q.from,
      to: q.to,
      keyword: q.keyword,
      modeTag: q.modeTag,
    });
    success(res, buildPaginated(list, total, q.page, q.pageSize));
  }
}

export const productionModeReportController = new ProductionModeReportController();
