import { Request, Response } from 'express';
import { z } from 'zod';
import { IncomingInspectionService } from './incomingInspection.service';
import { success, created, buildPaginated } from '../../shared/ApiResponse';
import { PaginationSchema } from '../../middleware/validator';
import { PermissionSnapshot } from '../access-control/access-control.types';

// ─── Zod Schemas ─────────────────────────────────────────────────

const CreateInspectionSchema = z.object({
  poId: z.number().int().positive({ message: 'poId 必须为正整数' }),
  deliveryNoteId: z.number().int().positive({ message: 'deliveryNoteId 必须为正整数' }),
  inspectionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式须为 YYYY-MM-DD'),
  notes: z.string().max(500).optional(),
});

const InspectionItemSchema = z.object({
  id: z.number().int().positive().optional(),
  sourceItemIds: z.array(z.number().int().positive()).min(1).optional(),
  qtyDelivered: z.string().regex(/^\d+(\.\d{1,4})?$/, '数量格式不合法').optional(),
  qtysampled: z.string().regex(/^\d+(\.\d{1,4})?$/, '数量格式不合法'),
  qtyPassed: z.string().regex(/^\d+(\.\d{1,4})?$/, '数量格式不合法'),
  qtyFailed: z.string().regex(/^\d+(\.\d{1,4})?$/, '数量格式不合法'),
  dyeLotNo: z.string().trim().max(100).optional(),
  result: z.enum(['pass', 'fail', 'conditional_pass']),
  defectTypes: z.array(z.unknown()).optional(),
  defectImages: z.array(z.string()).optional(),
  disposition: z.enum(['accept', 'return', 'rework', 'scrap']),
  notes: z.string().max(1000).optional(),
}).superRefine((value, ctx) => {
  if (!value.id && !(value.sourceItemIds && value.sourceItemIds.length > 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: '质检明细必须包含 id 或 sourceItemIds',
      path: ['id'],
    });
  }
});

const UpdateItemsSchema = z.object({
  items: z.array(InspectionItemSchema).min(1, '至少需要一条质检明细'),
});

const SubmitInspectionSchema = z.object({
  overallResult: z.enum(['pass', 'fail', 'conditional_pass'], {
    errorMap: () => ({ message: '总体结论须为 pass / fail / conditional_pass' }),
  }),
  warehouseId: z.coerce.number().int().positive().optional(),
  locationId: z.coerce.number().int().positive().optional(),
  notes: z.string().max(500).optional(),
});

const ListInspectionQuerySchema = PaginationSchema.extend({
  status: z.string().optional(),
  poId: z.coerce.number().int().positive().optional(),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  result: z.string().optional(),
});

// ─── Controller ──────────────────────────────────────────────────

class IncomingInspectionController {
  private svc(req: Request): IncomingInspectionService {
    return new IncomingInspectionService({
      tenantId: (req as any).tenantId,
      userId: (req as any).userId,
      permissionSnapshot: (req as any).permissionSnapshot as PermissionSnapshot | undefined,
    });
  }

  async list(req: Request, res: Response): Promise<void> {
    const q = ListInspectionQuerySchema.parse(req.query);
    const { list, total } = await this.svc(req).list(q);
    success(res, buildPaginated(list, total, q.page, q.pageSize));
  }

  async getById(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    const data = await this.svc(req).getById(id);
    success(res, data);
  }

  async create(req: Request, res: Response): Promise<void> {
    const body = CreateInspectionSchema.parse(req.body);
    const data = await this.svc(req).create(body);
    created(res, data, '质检单已创建');
  }

  async updateItems(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    const { items } = UpdateItemsSchema.parse(req.body);
    await this.svc(req).updateItems(id, items);
    success(res, null, '质检明细已更新');
  }

  async submit(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    const body = SubmitInspectionSchema.parse(req.body);
    await this.svc(req).submit(id, body);
    success(res, null, '质检结论已提交，入库/退货单据已自动生成');
  }

  async previewReceipt(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    const data = await this.svc(req).previewReceipt(id);
    success(res, data);
  }
}

export const incomingInspectionController = new IncomingInspectionController();
