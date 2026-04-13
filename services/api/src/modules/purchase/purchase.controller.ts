import { Request, Response } from 'express';
import { z } from 'zod';
import { PurchaseService } from './purchase.service';
import { SuggestionService } from './suggestion.service';
import { ThreeWayMatchService } from './threeWayMatch.service';
import {
  PurchaseSettlementService,
  CreatePurchaseSettlementSchema,
  ListPurchaseSettlementSchema,
} from './purchaseSettlement.service';
import { success, created, buildPaginated } from '../../shared/ApiResponse';
import { PaginationSchema } from '../../middleware/validator';
import { PermissionSnapshot } from '../access-control/access-control.types';

const POItemSchema = z.object({
  skuId: z.number().int().positive(),
  qtyOrdered: z.string().regex(/^\d+(\.\d{1,4})?$/),
  purchaseUnit: z.string().min(1).max(20),
  unitPrice: z.string().regex(/^\d+(\.\d{1,2})?$/),
  businessClass: z.enum(['production_material', 'consumable', 'fixed_asset']).optional(),
  receiptMode: z.enum(['inventory', 'direct_expense', 'asset_capitalization']).optional(),
  requiresAcceptance: z.boolean().optional(),
  requestDepartmentId: z.number().int().positive().optional(),
  budgetCode: z.string().trim().max(50).optional(),
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
  dyeLotNo: z.string().trim().min(1).max(100).optional(),
});

const CreateDeliveryNoteSchema = z.object({
  poId: z.number().int().positive().optional(),
  poNo: z.string().trim().min(1).max(50).optional(),
  deliveryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().max(500).optional(),
  items: z.array(DeliveryNoteItemSchema).min(1),
}).refine((body) => Boolean(body.poId ?? body.poNo), {
  message: 'poId 或 poNo 至少提供一个',
});

const ClosePOSchema = z.object({
  reason: z.string().trim().min(1).max(200),
});

const UpdateReceiptNotesSchema = z.object({
  notes: z.string().trim().min(1).max(500),
});

const ApproveSchema = z.object({
  approved: z.boolean(),
  rejectReason: z.string().max(500).optional(),
});

const FeedbackSchema = z.object({
  feedback: z.string().trim().min(1).max(500),
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
  private svc(req: Request) {
    return new PurchaseService({
      tenantId: req.tenantId,
      userId: req.userId,
      permissionSnapshot: req.permissionSnapshot as PermissionSnapshot | undefined,
    });
  }
  private suggSvc(req: Request) { return new SuggestionService({ tenantId: req.tenantId, userId: req.userId }); }
  private matchSvc(req: Request) { return new ThreeWayMatchService({ tenantId: req.tenantId, userId: req.userId }); }
  private settlementSvc(req: Request) { return new PurchaseSettlementService({ tenantId: req.tenantId, userId: req.userId }); }

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

  async feedbackSuggestion(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    const { feedback } = FeedbackSchema.parse(req.body);
    await this.suggSvc(req).feedbackSuggestion(id, feedback);
    success(res, null, '采购员反馈已记录');
  }

  // ── 采购订单 ──

  async listPOs(req: Request, res: Response): Promise<void> {
    const q = PaginationSchema.extend({
      status: z.string().optional(),
      supplierId: z.coerce.number().int().positive().optional(),
      keyword: z.string().trim().max(100).optional(),
    }).parse(req.query);
    const { list, total } = await this.svc(req).listPOs(q);
    success(res, buildPaginated(list, total, q.page, q.pageSize));
  }

  async createPO(req: Request, res: Response): Promise<void> {
    const body = CreatePOSchema.parse(req.body);
    const data = await this.svc(req).createPO(body);
    created(res, data, '采购订单已创建');
  }

  async getOrderById(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    const data = await this.svc(req).getById(id);
    success(res, data);
  }

  async closeOrder(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    const body = ClosePOSchema.parse(req.body);
    await this.svc(req).closeOrder(id, body);
    success(res, null, '采购订单已关闭');
  }

  async listTailOrders(req: Request, res: Response): Promise<void> {
    const q = PaginationSchema.parse(req.query);
    const { list, total } = await this.svc(req).listTailOrders(q);
    success(res, buildPaginated(list, total, q.page, q.pageSize));
  }

  async listOrderDeliveries(req: Request, res: Response): Promise<void> {
    const poId = Number(req.params.id);
    const data = await this.svc(req).listDeliveryNotesByOrderId(poId);
    success(res, data);
  }

  async listDeliveryNotes(req: Request, res: Response): Promise<void> {
    const q = PaginationSchema.extend({
      status: z.string().optional(),
      poId: z.coerce.number().int().positive().optional(),
    }).parse(req.query);
    const { list, total } = await this.svc(req).listDeliveryNotes(q);
    success(res, buildPaginated(list, total, q.page, q.pageSize));
  }

  async getDeliveryNoteById(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    const data = await this.svc(req).getDeliveryNoteById(id);
    success(res, data);
  }

  async listReceipts(req: Request, res: Response): Promise<void> {
    const q = PaginationSchema.extend({
      status: z.string().optional(),
      poId: z.coerce.number().int().positive().optional(),
    }).parse(req.query);
    const { list, total } = await this.svc(req).listReceipts(q);
    success(res, buildPaginated(list, total, q.page, q.pageSize));
  }

  async getReceiptById(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    const data = await this.svc(req).getReceiptById(id);
    success(res, data);
  }

  async updateReceiptNotes(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    const body = UpdateReceiptNotesSchema.parse(req.body);
    await this.svc(req).updateReceiptNotes(id, body);
    success(res, null, '入库备注已更新');
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
      poId: z.coerce.number().int().positive().optional(),
      receiptId: z.coerce.number().int().positive().optional(),
    }).parse(req.query);
    const { list, total } = await this.matchSvc(req).listMatchRecords(q);
    success(res, buildPaginated(list, total, q.page, q.pageSize));
  }

  async getMatchById(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    const data = await this.matchSvc(req).getMatchById(id);
    success(res, data);
  }

  async confirmDiff(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    const { diffReason, diffNotes } = ConfirmDiffSchema.parse(req.body);
    await this.matchSvc(req).confirmDiff(id, diffReason, diffNotes);
    success(res, null, '差异已确认');
  }

  // ── 采购结算 ──

  async createSettlement(req: Request, res: Response): Promise<void> {
    const body = CreatePurchaseSettlementSchema.parse(req.body);
    const data = await this.settlementSvc(req).createSettlement(body);
    created(res, data, '采购结算单创建成功');
  }

  async listSettlements(req: Request, res: Response): Promise<void> {
    const q = ListPurchaseSettlementSchema.parse(req.query);
    const data = await this.settlementSvc(req).listSettlements(q);
    success(res, data);
  }

  async exportSettlements(req: Request, res: Response): Promise<void> {
    const q = ListPurchaseSettlementSchema.parse(req.query);
    const rows = await this.settlementSvc(req).listSettlementExportRows(q);
    const headers = ['结算单号', '采购单号', '供应商', '入库单号', '结算金额', '状态', '到期日', '创建时间'];
    const escape = (s: string) => `"${String(s ?? '').replace(/"/g, '""')}"`;
    const encodedFilename = encodeURIComponent('采购结算.csv');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="purchase_settlements.csv"; filename*=UTF-8''${encodedFilename}`);
    res.write('\uFEFF' + headers.map(escape).join(',') + '\n');

    for (const row of rows) {
      res.write([
        row.settlementNo,
        row.poNo,
        row.supplierName,
        row.receiptNo,
        row.totalAmount,
        row.status,
        row.dueDate ?? '',
        row.createdAt,
      ].map(escape).join(',') + '\n');
    }

    res.end();
  }

  async getSettlementById(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    const data = await this.settlementSvc(req).getDetail(id);
    success(res, data);
  }

  async confirmSettlement(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    const data = await this.settlementSvc(req).confirmSettlement(id);
    success(res, data, '采购结算单确认成功');
  }

  async paySettlement(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    const data = await this.settlementSvc(req).paySettlement(id);
    success(res, data, '采购结算单已标记为已付款');
  }

  async cancelSettlement(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    const data = await this.settlementSvc(req).cancelSettlement(id);
    success(res, data, '采购结算单已取消');
  }
}

export const purchaseController = new PurchaseController();
