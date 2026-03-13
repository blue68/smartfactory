import { Request, Response } from 'express';
import { z } from 'zod';
import { CustomerService } from './customer.service';
import { success, created, buildPaginated } from '../../shared/ApiResponse';
import { PaginationSchema } from '../../middleware/validator';

// ─── 校验 Schema ──────────────────────────────────────────────────────────────

const ListQuerySchema = PaginationSchema.extend({
  keyword: z.string().max(100).optional(),
  grade: z.enum(['VIP', 'A', 'B', 'C']).optional(),
  status: z.enum(['active', 'inactive']).optional(),
});

const CreateSchema = z.object({
  code: z.string().min(1).max(50),
  name: z.string().min(1).max(200),
  grade: z.enum(['VIP', 'A', 'B', 'C']).optional(),
  contact: z.string().max(100).optional(),
  phone: z.string().max(30).optional(),
  email: z.string().email().max(200).optional(),
  address: z.string().max(300).optional(),
  creditLimit: z.string().regex(/^\d+(\.\d{1,2})?$/).optional().nullable(),
  paymentDays: z.number().int().min(0).max(365).optional().nullable(),
  status: z.enum(['active', 'inactive']).optional(),
  notes: z.string().max(2000).optional(),
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
}

export const customerController = new CustomerController();
