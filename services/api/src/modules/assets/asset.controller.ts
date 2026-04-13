import { Request, Response } from 'express';
import { z } from 'zod';
import { success, created } from '../../shared/ApiResponse';
import { PaginationSchema } from '../../middleware/validator';
import { AssetService } from './asset.service';

const AssetAcceptanceCardSchema = z.object({
  assetName: z.string().trim().max(200).optional(),
  serialNo: z.string().trim().max(100).optional(),
  assetTagNo: z.string().trim().max(100).optional(),
  departmentId: z.number().int().positive().optional(),
  custodianUserId: z.number().int().positive().optional(),
  locationText: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(500).optional(),
});

const AssetAcceptanceItemSchema = z.object({
  receiptItemId: z.number().int().positive(),
  cards: z.array(AssetAcceptanceCardSchema).min(1),
});

const CreateAssetAcceptanceSchema = z.object({
  receiptId: z.number().int().positive(),
  items: z.array(AssetAcceptanceItemSchema).min(1),
});

const AssetTransferSchema = z.object({
  departmentId: z.number().int().positive().optional(),
  custodianUserId: z.number().int().positive().optional(),
  locationText: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(500).optional(),
});

const AssetScrapSchema = z.object({
  notes: z.string().trim().max(500).optional(),
});

export class AssetController {
  private svc(req: Request): AssetService {
    return new AssetService({
      tenantId: req.tenantId,
      userId: req.userId,
    });
  }

  async listCards(req: Request, res: Response): Promise<void> {
    const q = PaginationSchema.extend({
      status: z.string().optional(),
      departmentId: z.coerce.number().int().positive().optional(),
      keyword: z.string().trim().max(100).optional(),
    }).parse(req.query);
    const data = await this.svc(req).listCards(q);
    success(res, data);
  }

  async getCardById(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    const data = await this.svc(req).getCardById(id);
    success(res, data);
  }

  async acceptAssets(req: Request, res: Response): Promise<void> {
    const body = CreateAssetAcceptanceSchema.parse(req.body);
    const data = await this.svc(req).acceptAssets(body);
    created(res, data, '固定资产验收建卡完成');
  }

  async transferCard(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    const body = AssetTransferSchema.parse(req.body ?? {});
    await this.svc(req).transferCard(id, body);
    success(res, null, '固定资产调拨完成');
  }

  async scrapCard(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    const body = AssetScrapSchema.parse(req.body ?? {});
    await this.svc(req).scrapCard(id, body);
    success(res, null, '固定资产已报废');
  }
}

export const assetController = new AssetController();
