import { Request, Response } from 'express';
import { z } from 'zod';
import { PurchaseService } from './purchase.service';
import { SuggestionService } from './suggestion.service';
import { ThreeWayMatchService } from './threeWayMatch.service';
import { success, created, buildPaginated } from '../../shared/ApiResponse';
import { PaginationSchema } from '../../middleware/validator';

const POItemSchema = z.object({
  skuId: z.number().int().positive(),
  qtyOrdered: z.string().regex(/^\d+(\.\d{1,4})?$/),
  purchaseUnit: z.string().min(1).max(20),
  unitPrice: z.string().regex(/^\d+(\.\d{1,2})?$/),
});

const CreatePOSchema = z.object({
  supplierId: z.number().int().positive(),
  suggestionId: z.number().int().positive().optional(),
  expectedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notes: z.string().max(500).optional(),
  items: z.array(POItemSchema).min(1),
});

const DeliveryNoteItemSchema = z.object({
  skuId: z.number().int().positive(),
  qtyDelivered: z.string().regex(/^\d+(\.\d{1,4})?$/),
  purchaseUnit: z.string().min(1).max(20),
  unitPrice: z.string().regex(/^\d+(\.\d{1,2})?$/),
});

const CreateDeliveryNoteSchema = z.object({
  poId: z.number().int().positive(),
  deliveryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().max(500).optional(),
  items: z.array(DeliveryNoteItemSchema).min(1),
});

const ApproveSchema = z.object({
  approved: z.boolean(),
  rejectReason: z.string().max(500).optional(),
});

const MatchParamsSchema = z.object({
  poId: z.number().int().positive(),
  deliveryNoteId: z.number().int().positive(),
  receiptId: z.number().int().positive(),
});

const ConfirmDiffSchema = z.object({
  diffReason: z.enum(['supplier_short', 'receipt_miss', 'price_adjust', 'other']),
  diffNotes: z.string().min(1).max(1000),
});

export class PurchaseController {
  private svc(req: Request) { return new PurchaseService({ tenantId: req.tenantId, userId: req.userId }); }
  private suggSvc(req: Request) { return new SuggestionService({ tenantId: req.tenantId, userId: req.userId }); }
  private matchSvc(req: Request) { return new ThreeWayMatchService({ tenantId: req.tenantId, userId: req.userId }); }

  // ── 采购建议 ──

  async generateSuggestions(req: Request, res: Response): Promise<void> {
    const data = await this.suggSvc(req).generateSuggestions();
    success(res, data, `已生成 ${data.length} 条采购建议`);
  }

  async listSuggestions(req: Request, res: Response): Promise<void> {
    const q = PaginationSchema.extend({ status: z.string().optional() }).parse(req.query);
    const { list, total } = await this.suggSvc(req).listSuggestions(q);
    success(res, buildPaginated(list, total, q.page, q.pageSize));
  }

  async approveSuggestion(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    const { approved, rejectReason } = ApproveSchema.parse(req.body);
    await this.suggSvc(req).approveSuggestion(id, approved, rejectReason);
    success(res, null, approved ? '审批通过' : '已驳回');
  }

  // ── 采购订单 ──

  async listPOs(req: Request, res: Response): Promise<void> {
    const q = PaginationSchema.extend({
      status: z.string().optional(),
      supplierId: z.coerce.number().int().positive().optional(),
    }).parse(req.query);
    const { list, total } = await this.svc(req).listPOs(q);
    success(res, buildPaginated(list, total, q.page, q.pageSize));
  }

  async createPO(req: Request, res: Response): Promise<void> {
    const body = CreatePOSchema.parse(req.body);
    const data = await this.svc(req).createPO(body);
    created(res, data, '采购订单已创建');
  }

  async createDeliveryNote(req: Request, res: Response): Promise<void> {
    const body = CreateDeliveryNoteSchema.parse(req.body);
    const data = await this.svc(req).createDeliveryNote(body);
    created(res, data, '送货单已录入');
  }

  // ── 三单匹配 ──

  async runMatch(req: Request, res: Response): Promise<void> {
    const { poId, deliveryNoteId, receiptId } = MatchParamsSchema.parse(req.body);
    const data = await this.matchSvc(req).runMatch(poId, deliveryNoteId, receiptId);
    success(res, data);
  }

  async listMatches(req: Request, res: Response): Promise<void> {
    const q = PaginationSchema.extend({
      status: z.string().optional(),
      supplierId: z.coerce.number().int().positive().optional(),
    }).parse(req.query);
    const { list, total } = await this.matchSvc(req).listMatchRecords(q);
    success(res, buildPaginated(list, total, q.page, q.pageSize));
  }

  async confirmDiff(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    const { diffReason, diffNotes } = ConfirmDiffSchema.parse(req.body);
    await this.matchSvc(req).confirmDiff(id, diffReason, diffNotes);
    success(res, null, '差异已确认');
  }
}

export const purchaseController = new PurchaseController();
