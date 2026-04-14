import { Request, Response } from 'express';
import { z } from 'zod';
import * as XLSX from 'xlsx';
import { CustomerService } from './customer.service';
import { success, created, buildPaginated } from '../../shared/ApiResponse';
import { PaginationSchema } from '../../middleware/validator';
import { formatCustomerStatus, formatExportDateTime } from '../../shared/exportFormat';

// ─── 校验 Schema ──────────────────────────────────────────────────────────────

const ListQuerySchema = PaginationSchema.extend({
  keyword: z.string().max(100).optional(),
  grade: z.enum(['VIP', 'A', 'B', 'C']).optional(),
  status: z.enum(['active', 'inactive']).optional(),
});

/** 导出查询参数（无分页） */
const ExportQuerySchema = z.object({
  keyword: z.string().max(100).optional(),
  grade: z.enum(['VIP', 'A', 'B', 'C']).optional(),
  status: z.enum(['active', 'inactive']).optional(),
});

const CreateSchema = z.object({
  code: z.string().min(1).max(50).optional(),
  name: z.string().min(1).max(200),
  grade: z.enum(['VIP', 'A', 'B', 'C']).optional(),
  contact: z.string().max(100).optional(),
  phone: z.string().max(30).optional(),
  email: z.string().max(200).optional().nullable()
    .transform((v): string | undefined => (v == null || v === '' ? undefined : v))
    .refine((v) => v == null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), {
      message: 'Invalid email',
    }),
  address: z.string().max(300).optional(),
  region: z.string().max(100).optional(),
  creditLimit: z.string().regex(/^\d+(\.\d{1,2})?$/).optional().nullable(),
  paymentDays: z.number().int().min(0).max(365).optional().nullable(),
  status: z.enum(['active', 'inactive']).optional(),
  notes: z.string().max(2000).optional(),
});

const UpdateStatusSchema = z.object({
  status: z.enum(['active', 'inactive']),
});

const ContactSchema = z.object({
  name: z.string().min(1).max(100),
  title: z.string().max(100).optional(),
  phone: z.string().max(30).optional(),
  email: z.string().email().max(200).optional(),
  isPrimary: z.boolean().optional(),
});

// ─── Controller ──────────────────────────────────────────────────────────────

export class CustomerController {
  private svc(req: Request): CustomerService {
    return new CustomerService({ tenantId: req.tenantId, userId: req.userId });
  }

  /** GET /customers?page=&pageSize=&keyword=&grade=&status= */
  async list(req: Request, res: Response): Promise<void> {
    const q = ListQuerySchema.parse(req.query);
    const [list, total] = await this.svc(req).list({
      page: q.page,
      pageSize: q.pageSize,
      keyword: q.keyword,
      grade: q.grade,
      status: q.status,
    });
    success(res, buildPaginated(list, total, q.page, q.pageSize));
  }

  /** GET /customers/options */
  async getOptions(req: Request, res: Response): Promise<void> {
    const data = await this.svc(req).getOptions();
    success(res, data);
  }

  /** GET /customers/:id */
  async getOne(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    const customer = await this.svc(req).getById(id);
    success(res, customer);
  }

  /** POST /customers */
  async create(req: Request, res: Response): Promise<void> {
    const body = CreateSchema.parse(req.body);
    const customer = await this.svc(req).create(body);
    created(res, customer, '客户已创建');
  }

  /** PUT /customers/:id */
  async update(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    const body = CreateSchema.partial().parse(req.body);
    const customer = await this.svc(req).update(id, body);
    success(res, customer, '客户已更新');
  }

  /** PATCH /customers/:id/status */
  async updateStatus(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    const { status } = UpdateStatusSchema.parse(req.body);
    const result = await this.svc(req).updateStatus(id, status);
    success(res, result, status === 'active' ? '客户已启用' : '客户已停用');
  }

  /** GET /customers/:id/contacts */
  async getContacts(req: Request, res: Response): Promise<void> {
    const customerId = Number(req.params.id);
    const contacts = await this.svc(req).getContacts(customerId);
    success(res, contacts);
  }

  /** POST /customers/:id/contacts */
  async addContact(req: Request, res: Response): Promise<void> {
    const customerId = Number(req.params.id);
    const body = ContactSchema.parse(req.body);
    const contact = await this.svc(req).addContact(customerId, body);
    created(res, contact, '联系人已添加');
  }

  /** PUT /customers/:id/contacts/:contactId */
  async updateContact(req: Request, res: Response): Promise<void> {
    const customerId = Number(req.params.id);
    const contactId = Number(req.params.contactId);
    const body = ContactSchema.partial().parse(req.body);
    const contact = await this.svc(req).updateContact(customerId, contactId, body);
    success(res, contact, '联系人已更新');
  }

  /** DELETE /customers/:id/contacts/:contactId */
  async removeContact(req: Request, res: Response): Promise<void> {
    const contactId = Number(req.params.contactId);
    await this.svc(req).removeContact(contactId);
    success(res, null, '联系人已删除');
  }

  /** GET /customers/:id/orders */
  async getOrders(req: Request, res: Response): Promise<void> {
    const customerId = Number(req.params.id);
    const q = PaginationSchema.parse(req.query);
    const [list, total] = await this.svc(req).getCustomerOrders(customerId, q.page, q.pageSize);
    success(res, buildPaginated(list, total, q.page, q.pageSize));
  }

  /**
   * GET /customers/export
   * 将符合筛选条件的客户（上限 5000）导出为 xlsx 文件并流式返回。
   */
  async exportExcel(req: Request, res: Response): Promise<void> {
    const q = ExportQuerySchema.parse(req.query);
    const list = await this.svc(req).exportCustomers({
      keyword: q.keyword,
      grade: q.grade,
      status: q.status,
    });

    // ── 构建工作表数据 ────────────────────────────────────────────────────────
    const header = [
      '客户编码', '客户名称', '等级', '状态',
      '主要联系人', '联系电话', '联系邮箱',
      '地址', '区域', '信用额度(元)', '账期(天)', '备注', '创建时间',
    ];
    const rows = list.map((c) => [
      c.code,
      c.name,
      c.grade,
      formatCustomerStatus(c.status),
      c.contact ?? '',
      c.phone ?? '',
      c.email ?? '',
      c.address ?? '',
      c.region ?? '',
      c.creditLimit != null ? Number(c.creditLimit) : '',
      c.paymentDays ?? '',
      c.notes ?? '',
      formatExportDateTime(c.createdAt),
    ]);

    const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
    ws['!cols'] = [
      { wch: 14 }, { wch: 28 }, { wch: 6  }, { wch: 6  },
      { wch: 12 }, { wch: 14 }, { wch: 26 },
      { wch: 30 }, { wch: 12 }, { wch: 14 }, { wch: 10 },
      { wch: 20 }, { wch: 20 },
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '客户列表');

    const xlsxBuf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

    const filename = encodeURIComponent(`客户列表_${new Date().toISOString().slice(0, 10)}.xlsx`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`);
    res.setHeader('Content-Length', String(xlsxBuf.length));
    res.end(xlsxBuf);
  }
}

export const customerController = new CustomerController();
