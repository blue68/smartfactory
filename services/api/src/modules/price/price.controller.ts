import { Request, Response } from 'express';
import { z } from 'zod';
import { PriceService } from './price.service';
import { success, created, buildPaginated } from '../../shared/ApiResponse';
import { PaginationSchema } from '../../middleware/validator';

const ListQuerySchema = PaginationSchema.extend({
  keyword: z.string().max(100).optional(),
  supplierId: z.coerce.number().int().positive().optional(),
  skuId: z.coerce.number().int().positive().optional(),
  isActive: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
});

const CreateSchema = z.object({
  supplierId: z.number().int().positive(),
  skuId: z.number().int().positive(),
  unitPrice: z.string().regex(/^\d+(\.\d{1,4})?$/),
  purchaseUnit: z.string().min(1).max(20),
  moq: z.number().int().nonnegative().optional(),
  purchaseCycleDays: z.number().int().nonnegative().optional(),
  transportCycleDays: z.number().int().nonnegative().optional(),
  validFrom: z.string().optional(),
  validTo: z.string().optional(),
  notes: z.string().max(2000).optional(),
  taxRate: z.string().regex(/^\d{1,3}(\.\d{1,2})?$/).optional(),
  batchPricing: z.boolean().optional(),
  batchRule: z.string().max(500).optional(),
  attachmentUrl: z.string().max(500).optional(),
});

export class PriceController {
  private svc(req: Request): PriceService {
    return new PriceService({ tenantId: req.tenantId, userId: req.userId });
  }

  // ── R-03: 导入模板下载 ───────────────────────────────────────────────────
  async downloadTemplate(_req: Request, res: Response): Promise<void> {
    const svc = new PriceService({ tenantId: 0, userId: 0 });
    const buf = svc.generateImportTemplate();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=price-import-template.xlsx');
    res.send(buf);
  }

  // ── R-03: 批量导入 ─────────────────────────────────────────────────────
  async importPrices(req: Request, res: Response): Promise<void> {
    if (!req.file) {
      res.status(400).json({ code: 400, data: null, message: '请上传 Excel 文件' });
      return;
    }
    const result = await this.svc(req).importPrices(
      req.file.buffer,
      req.file.originalname,
      req.tenantId,
      req.userId,
    );
    success(res, result, `导入完成：成功 ${result.successCount} 条，失败 ${result.failCount} 条`);
  }

  // ── R-03: 导入任务进度查询（DB entity，保留兼容） ────────────────────────
  async getImportStatus(req: Request, res: Response): Promise<void> {
    const taskId = Number(req.params.taskId);
    const task = await this.svc(req).getImportTaskStatus(taskId);
    success(res, task);
  }

  // ── #14: 实时进度轮询端点 GET /import/:taskId/status ────────────────────
  // Returns { status, total, processed, errors[] } from in-memory store
  async getImportProgress(req: Request, res: Response): Promise<void> {
    const taskId = Number(req.params.taskId);
    const progressData = await this.svc(req).getImportProgress(taskId);
    success(res, progressData);
  }

  async list(req: Request, res: Response): Promise<void> {
    const q = ListQuerySchema.parse(req.query);
    const [list, total] = await this.svc(req).list({
      page: q.page,
      pageSize: q.pageSize,
      keyword: q.keyword,
      supplierId: q.supplierId,
      skuId: q.skuId,
      isActive: q.isActive,
    });
    success(res, buildPaginated(list, total, q.page, q.pageSize));
  }

  async getOne(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    const price = await this.svc(req).getById(id);
    success(res, price);
  }

  async create(req: Request, res: Response): Promise<void> {
    const body = CreateSchema.parse(req.body);
    const price = await this.svc(req).create(body);
    created(res, price, '价格协议已创建');
  }

  async update(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    const body = CreateSchema.partial().parse(req.body);
    const price = await this.svc(req).update(id, body);
    success(res, price, '价格协议已更新');
  }

  // BE-P1-014: 价格历史
  async getPriceHistory(req: Request, res: Response): Promise<void> {
    const skuId = Number(req.params.skuId);
    const supplierId = req.query.supplierId ? Number(req.query.supplierId) : undefined;
    const data = await this.svc(req).getPriceHistory(skuId, supplierId);
    success(res, data);
  }
}

export const priceController = new PriceController();
