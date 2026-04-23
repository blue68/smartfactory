import { Request, Response } from 'express';
import { z } from 'zod';
import { MrpService } from './mrp.service';
import { success, buildPaginated } from '../../shared/ApiResponse';
import { PaginationSchema } from '../../middleware/validator';

// ─── Zod Schemas ──────────────────────────────────────────────────

const ProductionOrderIdParamSchema = z.object({
  productionOrderId: z.coerce.number().int().positive('工单ID必须为正整数'),
});

const GlobalShortageSummaryQuerySchema = PaginationSchema.extend({
  status: z.string().optional(),
  skuId: z.coerce.number().int().positive().optional(),
  batchId: z.coerce.number().int().positive().optional(),
  warehouseId: z.coerce.number().int().positive().optional(),
  locationId: z.coerce.number().int().positive().optional(),
  onlyDefaultLocation: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

const GenerateSuggestionsBodySchema = z.object({
  productionOrderId: z.number().int().positive('工单ID必须为正整数').optional(),
  batchId: z.number().int().positive('联合生产批次ID必须为正整数').optional(),
});

const ReevaluateBodySchema = z.object({
  skuId: z.number().int().positive('SKU ID必须为正整数'),
});

// ─── Controller ───────────────────────────────────────────────────

export class MrpController {
  private svc(req: Request): MrpService {
    return new MrpService({ tenantId: req.tenantId, userId: req.userId });
  }

  /**
   * GET /mrp/shortage-report/:productionOrderId
   * 获取工单缺料报告明细
   */
  async getShortageReport(req: Request, res: Response): Promise<void> {
    const { productionOrderId } = ProductionOrderIdParamSchema.parse(req.params);
    const data = await this.svc(req).getShortageReport(productionOrderId);
    success(res, data, '缺料报告获取成功');
  }

  /**
   * GET /mrp/shortage-summary
   * 全局缺料汇总（跨工单合并同类项）
   */
  async getGlobalShortageSummary(req: Request, res: Response): Promise<void> {
    const q = GlobalShortageSummaryQuerySchema.parse(req.query);
    const { list, total } = await this.svc(req).getGlobalShortageSummary({
      status: q.status,
      skuId: q.skuId,
      batchId: q.batchId,
      warehouseId: q.warehouseId,
      locationId: q.locationId,
      onlyDefaultLocation: q.onlyDefaultLocation,
      page: q.page,
      pageSize: q.pageSize,
    });
    success(res, buildPaginated(list, total, q.page, q.pageSize));
  }

  /**
   * POST /mrp/generate-suggestions
   * 基于缺料生成采购建议
   * Body: { productionOrderId?: number }
   */
  async generateSuggestions(req: Request, res: Response): Promise<void> {
    const { productionOrderId, batchId } = GenerateSuggestionsBodySchema.parse(req.body);
    const result = await this.svc(req).generateSuggestions(productionOrderId, undefined, { batchId });
    success(
      res,
      result,
      `已生成 ${result.created} 条新建议，更新 ${result.updated} 条，跳过 ${result.skipped} 条`,
    );
  }

  /**
   * POST /mrp/reevaluate
   * 入库后重新评估缺料状态
   * Body: { skuId: number }
   */
  async reevaluateAfterReceipt(req: Request, res: Response): Promise<void> {
    const { skuId } = ReevaluateBodySchema.parse(req.body);
    const result = await this.svc(req).reevaluateAfterReceipt(skuId);
    success(
      res,
      result,
      `已重新评估 ${result.affectedOrderIds.length} 个工单，共更新 ${result.updatedRequirements} 条需求记录`,
    );
  }

  /**
   * GET /mrp/supply-chain-dashboard
   * 供应链状态看板数据
   */
  async getSupplyChainDashboard(req: Request, res: Response): Promise<void> {
    const data = await this.svc(req).getSupplyChainDashboard();
    success(res, data, '供应链看板数据获取成功');
  }
}

export const mrpController = new MrpController();
