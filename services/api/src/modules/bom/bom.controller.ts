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
  description: z.string().max(500).optional(),
  items: z.array(CreateBomItemSchema).default([]),
});

const CalcRequirementsSchema = z.object({
  productionQty: z.coerce.number().positive().max(1_000_000),
});

const AddBomItemSchema = z.object({
  componentSkuId: z.coerce.number().int().positive(),
  quantity: z.string().regex(/^\d+(\.\d{1,4})?$/),
  unit: z.string().min(1).max(20),
  // scrapRate 必须在 0~0.9999 之间（与 CreateBomItemSchema 对齐）
  scrapRate: z.string().regex(/^0(\.\d{1,4})?$/).optional(),
});

// P0-2: reusable query schema for listing BOMs
const ListQuerySchema = z.object({
  skuId: z.coerce.number().int().positive().optional(),
});

// P1-10: reusable route param schemas
const IdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const ItemIdParamSchema = z.object({
  itemId: z.coerce.number().int().positive(),
});

const SkuIdParamSchema = z.object({
  skuId: z.coerce.number().int().positive(),
});

const UpdateBomSchema = z.object({
  version:     z.string().min(1).max(20).optional(),
  description: z.string().max(500).optional(),
  status:      z.enum(['draft', 'active', 'archived']).optional(),
}).refine(
  (d) => d.version !== undefined || d.description !== undefined || d.status !== undefined,
  { message: '至少提供一个可更新字段（version / description / status）' },
);

const CopyBomSchema = z.object({
  newVersion: z.string().min(1).max(20),
});

export class BomController {
  private svc(req: Request): BomService {
    return new BomService({ tenantId: req.tenantId, userId: req.userId });
  }

  async list(req: Request, res: Response): Promise<void> {
    // P0-2: validate skuId query param with Zod
    const { skuId } = ListQuerySchema.parse(req.query);
    const data = await this.svc(req).listBoms(skuId);
    success(res, data);
  }

  async getExpanded(req: Request, res: Response): Promise<void> {
    // P1-10: validate id route param with Zod
    const { id } = IdParamSchema.parse(req.params);
    const data = await this.svc(req).getBomWithExpansion(id);
    success(res, data);
  }

  async calcRequirements(req: Request, res: Response): Promise<void> {
    // P1-10: validate id route param with Zod
    const { id } = IdParamSchema.parse(req.params);
    const { productionQty } = CalcRequirementsSchema.parse(req.query);
    const data = await this.svc(req).calcMaterialRequirements(id, productionQty);
    success(res, data);
  }

  async create(req: Request, res: Response): Promise<void> {
    const body = CreateBomSchema.parse(req.body);
    const data = await this.svc(req).createBom(body);
    created(res, data, 'BOM已创建');
  }

  async addItem(req: Request, res: Response): Promise<void> {
    // P1-10: validate id route param with Zod
    const { id: bomId } = IdParamSchema.parse(req.params);
    const body = AddBomItemSchema.parse(req.body);
    const data = await this.svc(req).addBomItem(bomId, body);
    created(res, data, 'BOM明细已添加');
  }

  async activate(req: Request, res: Response): Promise<void> {
    // P1-10: validate id route param with Zod
    const { id } = IdParamSchema.parse(req.params);
    await this.svc(req).activateBom(id);
    success(res, null, 'BOM已激活');
  }

  // ── BE-P1-001: 更新 BOM 头信息 ────────────────────────────

  async update(req: Request, res: Response): Promise<void> {
    // P1-10: validate id route param with Zod
    const { id } = IdParamSchema.parse(req.params);
    const body = UpdateBomSchema.parse(req.body);
    await this.svc(req).updateBom(id, body);
    success(res, null, 'BOM已更新');
  }

  // ── BE-P1-001: 删除 BOM 明细行 ────────────────────────────

  async deleteBomItem(req: Request, res: Response): Promise<void> {
    // P1-10: validate route params with Zod
    const { id: bomId } = IdParamSchema.parse(req.params);
    const { itemId } = ItemIdParamSchema.parse(req.params);
    await this.svc(req).deleteBomItem(itemId, bomId);
    success(res, null, 'BOM明细已删除');
  }

  // ── BE-P1-001: 复制 BOM ───────────────────────────────────

  async copyBom(req: Request, res: Response): Promise<void> {
    // P1-10: validate id route param with Zod
    const { id } = IdParamSchema.parse(req.params);
    const { newVersion } = CopyBomSchema.parse(req.body);
    const data = await this.svc(req).copyBom(id, newVersion);
    created(res, data, 'BOM已复制');
  }

  // ── BE-P1-002: AI 辅助 BOM 建议 ──────────────────────────

  async getAiSuggestion(req: Request, res: Response): Promise<void> {
    // P1-10: validate skuId route param with Zod
    const { skuId } = SkuIdParamSchema.parse(req.params);
    const data = await this.svc(req).getAiSuggestion(skuId);
    success(res, data);
  }
}

export const bomController = new BomController();
