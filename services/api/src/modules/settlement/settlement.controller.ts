import { Request, Response } from 'express';
import {
  SettlementService,
  CreateSettlementSchema,
  ListSettlementSchema,
  ListPendingSettlementOrderSchema,
  ReceivableQuerySchema,
} from './settlement.service';
import { success, created } from '../../shared/ApiResponse';
import { AppError } from '../../shared/AppError';

const SETTLEMENT_STATUS_LABEL: Record<string, string> = {
  draft: '草稿',
  confirmed: '已确认',
  paid: '已付款',
  cancelled: '已取消',
};

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function formatDateTime(value: unknown): string {
  if (value == null) return '';

  if (typeof value === 'string') {
    const normalized = value.trim().replace('T', ' ').replace(/\.\d{1,6}Z?$/, '');
    if (/^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}:\d{2})?$/.test(normalized)) {
      return normalized.length === 10 ? `${normalized} 00:00:00` : normalized;
    }
  }

  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

/**
 * SettlementController — F-707 销售财务结算
 */
export class SettlementController {
  private svc(req: Request): SettlementService {
    return new SettlementService({ tenantId: req.tenantId, userId: req.userId });
  }

  /** GET /api/settlements/receivable — 应收账款汇总（必须在 /:id 路由前注册） */
  async getReceivable(req: Request, res: Response): Promise<void> {
    const parsed = ReceivableQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw AppError.badRequest(parsed.error.issues.map((i) => i.message).join('; '));
    }
    const data = await this.svc(req).getReceivable(parsed.data.groupBy);
    success(res, data);
  }

  /** POST /api/settlements — 从已交付订单创建结算单 */
  async createSettlement(req: Request, res: Response): Promise<void> {
    const parsed = CreateSettlementSchema.safeParse(req.body);
    if (!parsed.success) {
      throw AppError.badRequest(parsed.error.issues.map((i) => i.message).join('; '));
    }
    const data = await this.svc(req).createSettlement(parsed.data);
    created(res, data, '结算单创建成功');
  }

  /** GET /api/settlements/pending-orders — 待结算销售订单列表 */
  async listPendingOrders(req: Request, res: Response): Promise<void> {
    const parsed = ListPendingSettlementOrderSchema.safeParse(req.query);
    if (!parsed.success) {
      throw AppError.badRequest(parsed.error.issues.map((i) => i.message).join('; '));
    }
    const data = await this.svc(req).listPendingSettlementOrders(parsed.data);
    success(res, data);
  }

  /** GET /api/settlements — 结算单列表 */
  async listSettlements(req: Request, res: Response): Promise<void> {
    const parsed = ListSettlementSchema.safeParse(req.query);
    if (!parsed.success) {
      throw AppError.badRequest(parsed.error.issues.map((i) => i.message).join('; '));
    }
    const data = await this.svc(req).listSettlements(parsed.data);
    success(res, data);
  }

  /** GET /api/settlements/export/csv — 导出结算单 CSV */
  async exportCsv(req: Request, res: Response): Promise<void> {
    const parsed = ListSettlementSchema.safeParse(req.query);
    if (!parsed.success) {
      throw AppError.badRequest(parsed.error.issues.map((i) => i.message).join('; '));
    }

    const rows = await this.svc(req).listSettlementExportRows(parsed.data);
    const headers = ['结算单号', '客户名称', '关联订单', '结算金额', '状态', '到期日', '是否逾期', '创建时间'];
    const escape = (s: string) => `"${String(s ?? '').replace(/"/g, '""')}"`;
    const encodedFilename = encodeURIComponent('销售结算.csv');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="settlements.csv"; filename*=UTF-8''${encodedFilename}`);
    res.write('\uFEFF' + headers.map(escape).join(',') + '\n');

    for (const row of rows) {
      const overdue = row.dueDate
        && ['draft', 'confirmed'].includes(row.status)
        && new Date(row.dueDate).getTime() < Date.now();
      res.write([
        row.settlementNo,
        row.customerName,
        row.orderNo,
        row.totalAmount,
        SETTLEMENT_STATUS_LABEL[row.status] ?? row.status,
        row.dueDate ?? '',
        overdue ? '是' : '否',
        formatDateTime(row.createdAt),
      ].map(escape).join(',') + '\n');
    }

    res.end();
  }

  /** GET /api/settlements/:id — 结算单详情 */
  async getSettlement(req: Request, res: Response): Promise<void> {
    const id = Number(req.params['id']);
    if (!Number.isInteger(id) || id <= 0) {
      throw AppError.badRequest('无效的结算单 ID');
    }
    const data = await this.svc(req).getDetail(id);
    success(res, data);
  }

  /** PUT /api/settlements/:id/confirm — 确认结算（仅 boss） */
  async confirmSettlement(req: Request, res: Response): Promise<void> {
    const id = Number(req.params['id']);
    if (!Number.isInteger(id) || id <= 0) {
      throw AppError.badRequest('无效的结算单 ID');
    }
    const data = await this.svc(req).confirmSettlement(id);
    success(res, data, '结算单确认成功');
  }

  /** PUT /api/settlements/:id/pay — 标记已付款（仅 boss） */
  async paySettlement(req: Request, res: Response): Promise<void> {
    const id = Number(req.params['id']);
    if (!Number.isInteger(id) || id <= 0) {
      throw AppError.badRequest('无效的结算单 ID');
    }
    const data = await this.svc(req).paySettlement(id);
    success(res, data, '结算单已标记为已付款');
  }

  /** PUT /api/settlements/:id/cancel — 取消结算单（boss / supervisor） */
  async cancelSettlement(req: Request, res: Response): Promise<void> {
    const id = Number(req.params['id']);
    if (!Number.isInteger(id) || id <= 0) {
      throw AppError.badRequest('无效的结算单 ID');
    }
    const data = await this.svc(req).cancelSettlement(id);
    success(res, data, '结算单已取消');
  }
}

export const settlementController = new SettlementController();
