import { Request, Response } from 'express';
import { z } from 'zod';
import { BomService } from './bom.service';
import { success, created } from '../../shared/ApiResponse';

const CreateBomItemSchema: z.ZodType<any> = z.lazy(() =>
  z.object({
    componentSkuId: z.number().int().positive(),
    quantity: z.string().regex(/^\d+(\.\d{1,4})?$/),
    unit: z.string().min(1).max(20),
    scrapRate: z.string().regex(/^0(\.\d{1,4})?$/).optional(),
    sortOrder: z.number().int().min(0).optional(),
    notes: z.string().max(500).optional(),
    children: z.array(CreateBomItemSchema).optional(),
  }),
);

const CreateBomSchema = z.object({
  skuId: z.number().int().positive(),
  version: z.string().max(20).optional(),
  description: z.string().optional(),
  items: z.array(CreateBomItemSchema).min(1),
});

const CalcRequirementsSchema = z.object({
  productionQty: z.coerce.number().positive(),
});

export class BomController {
  private svc(req: Request): BomService {
    return new BomService({ tenantId: req.tenantId, userId: req.userId });
  }

  async list(req: Request, res: Response): Promise<void> {
    const skuId = req.query.skuId ? Number(req.query.skuId) : undefined;
    const data = await this.svc(req).listBoms(skuId);
    success(res, data);
  }

  async getExpanded(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    const data = await this.svc(req).getBomWithExpansion(id);
    success(res, data);
  }

  async calcRequirements(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    const { productionQty } = CalcRequirementsSchema.parse(req.query);
    const data = await this.svc(req).calcMaterialRequirements(id, productionQty);
    success(res, data);
  }

  async create(req: Request, res: Response): Promise<void> {
    const body = CreateBomSchema.parse(req.body);
    const data = await this.svc(req).createBom(body);
    created(res, data, 'BOM已创建');
  }

  async activate(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    await this.svc(req).activateBom(id);
    success(res, null, 'BOM已激活');
  }

  // ── BE-P1-001: 更新 BOM 头信息 ────────────────────────────

  async update(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    const UpdateBomSchema = z.object({
      version:     z.string().min(1).max(20).optional(),
      description: z.string().max(500).optional(),
      status:      z.enum(['draft', 'active', 'archived']).optional(),
    }).refine(
      (d) => d.version !== undefined || d.description !== undefined || d.status !== undefined,
      { message: '至少提供一个可更新字段（version / description / status）' },
    );
    const body = UpdateBomSchema.parse(req.body);
    await this.svc(req).updateBom(id, body);
    success(res, null, 'BOM已更新');
  }

  // ── BE-P1-001: 删除 BOM 明细行 ────────────────────────────

  async deleteBomItem(req: Request, res: Response): Promise<void> {
    const itemId = Number(req.params.itemId);
    await this.svc(req).deleteBomItem(itemId);
    success(res, null, 'BOM明细已删除');
  }

  // ── BE-P1-001: 复制 BOM ───────────────────────────────────

  async copyBom(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    const CopyBomSchema = z.object({
      newVersion: z.string().min(1).max(20),
    });
    const { newVersion } = CopyBomSchema.parse(req.body);
    const data = await this.svc(req).copyBom(id, newVersion);
    created(res, data, 'BOM已复制');
  }

  // ── BE-P1-002: AI 辅助 BOM 建议 ──────────────────────────

  async getAiSuggestion(req: Request, res: Response): Promise<void> {
    const skuId = Number(req.params.skuId);
    const data = await this.svc(req).getAiSuggestion(skuId);
    success(res, data);
  }
}

export const bomController = new BomController();
