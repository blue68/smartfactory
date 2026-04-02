import { AppDataSource } from '../../config/database';
import { CustomerEntity, CustomerGrade, CustomerStatus } from './customer.entity';
import { CustomerContactEntity } from './customerContact.entity';
import { AppError } from '../../shared/AppError';
import { ResponseCode } from '../../shared/ApiResponse';

// ─── 导出筛选参数 ────────────────────────────────────────────────────────────

export interface CustomerExportFilter {
  keyword?: string;
  grade?: CustomerGrade;
  status?: CustomerStatus;
}

// ─── 参数接口定义 ────────────────────────────────────────────────────────────

export interface CustomerListFilter {
  page: number;
  pageSize: number;
  keyword?: string;
  grade?: CustomerGrade;
  status?: CustomerStatus;
}

export interface CreateCustomerParams {
  code?: string;
  name: string;
  grade?: CustomerGrade;
  contact?: string;
  phone?: string;
  email?: string;
  address?: string;
  region?: string;
  creditLimit?: string | null;
  paymentDays?: number | null;
  status?: CustomerStatus;
  notes?: string;
}

export interface CreateContactParams {
  name: string;
  title?: string;
  phone?: string;
  email?: string;
  isPrimary?: boolean;
}

// ─── Service ─────────────────────────────────────────────────────────────────

export class CustomerService {
  private readonly tenantId: number;
  private readonly userId: number;

  constructor(ctx: { tenantId: number; userId: number }) {
    this.tenantId = ctx.tenantId;
    this.userId = ctx.userId;
  }

  // ── 客户列表（支持关键字 / 等级 / 状态筛选，分页）──────────────────────────

  async list(filter: CustomerListFilter): Promise<[CustomerEntity[], number]> {
    const conds: string[] = ['c.tenant_id = ?'];
    const params: unknown[] = [this.tenantId];

    if (filter.keyword) {
      conds.push('(c.name LIKE ? OR c.code LIKE ? OR c.contact LIKE ?)');
      params.push(`%${filter.keyword}%`, `%${filter.keyword}%`, `%${filter.keyword}%`);
    }
    if (filter.grade) {
      conds.push('c.grade = ?');
      params.push(filter.grade);
    }
    if (filter.status) {
      conds.push('c.status = ?');
      params.push(filter.status);
    }

    const where = conds.join(' AND ');
    const offset = (filter.page - 1) * filter.pageSize;

    const [list, countRows] = await Promise.all([
      AppDataSource.query<CustomerEntity[]>(
        `SELECT * FROM customers c WHERE ${where}
         ORDER BY c.created_at DESC LIMIT ? OFFSET ?`,
        [...params, filter.pageSize, offset],
      ),
      AppDataSource.query<Array<{ total: string }>>(
        `SELECT COUNT(*) AS total FROM customers c WHERE ${where}`,
        params,
      ),
    ]);

    return [list, Number(countRows[0]?.total ?? 0)];
  }

  // ── 客户详情（含联系人列表）──────────────────────────────────────────────────

  async getById(id: number): Promise<CustomerEntity & { contacts?: CustomerContactEntity[] }> {
    const repo = AppDataSource.getRepository(CustomerEntity);
    const customer = await repo.findOne({ where: { id, tenantId: this.tenantId } });
    if (!customer) {
      throw AppError.notFound('客户不存在', ResponseCode.CUSTOMER_NOT_FOUND);
    }
    const contactRepo = AppDataSource.getRepository(CustomerContactEntity);
    const contacts = await contactRepo.find({
      where: { tenantId: this.tenantId, customerId: id },
      order: { isPrimary: 'DESC', createdAt: 'ASC' },
    });
    return Object.assign(customer, { contacts });
  }

  // ── 创建客户 ────────────────────────────────────────────────────────────────

  async create(params: CreateCustomerParams): Promise<CustomerEntity> {
    const repo = AppDataSource.getRepository(CustomerEntity);

    // 若未提供 code，自动生成 CUS-YYYY-XXX 格式
    if (!params.code) {
      const year = new Date().getFullYear();
      const [row] = await AppDataSource.query<Array<{ maxSeq: string | null }>>(
        `SELECT MAX(CAST(SUBSTRING_INDEX(code, '-', -1) AS UNSIGNED)) AS maxSeq
         FROM customers WHERE tenant_id = ? AND code LIKE ?`,
        [this.tenantId, `CUS-${year}-%`],
      );
      const nextSeq = (Number(row?.maxSeq ?? 0) + 1).toString().padStart(3, '0');
      params.code = `CUS-${year}-${nextSeq}`;
    }

    const exists = await repo.findOne({
      where: { tenantId: this.tenantId, code: params.code },
    });
    if (exists) {
      throw AppError.conflict(
        `客户编码 ${params.code} 已存在`,
        ResponseCode.CUSTOMER_CODE_DUPLICATE,
      );
    }

    const entity = repo.create({
      tenantId: this.tenantId,
      code: params.code!,
      name: params.name,
      grade: params.grade ?? 'B',
      contact: params.contact ?? null,
      phone: params.phone ?? null,
      email: params.email ?? null,
      address: params.address ?? null,
      region: params.region ?? null,
      creditLimit: params.creditLimit ?? null,
      paymentDays: params.paymentDays ?? null,
      status: params.status ?? 'active',
      notes: params.notes ?? null,
      createdBy: this.userId,
      updatedBy: this.userId,
    });

    return repo.save(entity);
  }

  // ── 客户启用/停用 ────────────────────────────────────────────────────────────

  async updateStatus(id: number, status: CustomerStatus): Promise<CustomerEntity> {
    const customer = await this.getById(id);

    if (status === 'inactive') {
      const [row] = await AppDataSource.query<Array<{ cnt: string }>>(
        `SELECT COUNT(*) AS cnt FROM sales_orders
         WHERE tenant_id = ? AND customer_id = ?
         AND status IN ('draft', 'pending_approval', 'confirmed', 'in_production')`,
        [this.tenantId, id],
      );
      const activeOrderCount = Number(row?.cnt ?? 0);
      if (activeOrderCount > 0) {
        throw AppError.badRequest(
          `该客户有 ${activeOrderCount} 个进行中的订单，无法停用`,
          ResponseCode.CUSTOMER_HAS_ACTIVE_ORDERS,
        );
      }
    }

    const repo = AppDataSource.getRepository(CustomerEntity);
    customer.status = status;
    customer.updatedBy = this.userId;
    return repo.save(customer);
  }

  // ── 更新客户 ────────────────────────────────────────────────────────────────

  async update(id: number, params: Partial<CreateCustomerParams>): Promise<CustomerEntity> {
    const customer = await this.getById(id);
    const repo = AppDataSource.getRepository(CustomerEntity);

    if (params.code && params.code !== customer.code) {
      const exists = await repo.findOne({
        where: { tenantId: this.tenantId, code: params.code },
      });
      if (exists) {
        throw AppError.conflict(
          `客户编码 ${params.code} 已存在`,
          ResponseCode.CUSTOMER_CODE_DUPLICATE,
        );
      }
    }

    const updateFields: Partial<CustomerEntity> = { updatedBy: this.userId };
    if (params.code !== undefined)        updateFields.code        = params.code;
    if (params.name !== undefined)        updateFields.name        = params.name;
    if (params.grade !== undefined)       updateFields.grade       = params.grade;
    if (params.contact !== undefined)     updateFields.contact     = params.contact ?? null;
    if (params.phone !== undefined)       updateFields.phone       = params.phone ?? null;
    if (params.email !== undefined)       updateFields.email       = params.email ?? null;
    if (params.address !== undefined)     updateFields.address     = params.address ?? null;
    if (params.region !== undefined)      updateFields.region      = params.region ?? null;
    if (params.creditLimit !== undefined) updateFields.creditLimit = params.creditLimit ?? null;
    if (params.paymentDays !== undefined) updateFields.paymentDays = params.paymentDays ?? null;
    if (params.status !== undefined)      updateFields.status      = params.status;
    if (params.notes !== undefined)       updateFields.notes       = params.notes ?? null;

    Object.assign(customer, updateFields);
    return repo.save(customer);
  }

  // ── 客户下拉选项（仅活跃客户，id + name）──────────────────────────────────

  async getOptions(): Promise<Array<{ id: number; name: string; code: string }>> {
    const rows = await AppDataSource.query<Array<{ id: number; name: string; code: string }>>(
      `SELECT id, name, code FROM customers
       WHERE tenant_id = ? AND status = 'active'
       ORDER BY name ASC`,
      [this.tenantId],
    );
    return rows.map((r) => ({
      id: Number(r.id),
      name: String(r.name),
      code: String(r.code),
    }));
  }

  // ── 联系人：查询列表 ────────────────────────────────────────────────────────

  async getContacts(customerId: number): Promise<CustomerContactEntity[]> {
    // 先确认客户归属本租户
    await this.getById(customerId);

    const repo = AppDataSource.getRepository(CustomerContactEntity);
    return repo.find({
      where: { tenantId: this.tenantId, customerId },
      order: { isPrimary: 'DESC', createdAt: 'ASC' },
    });
  }

  // ── 联系人：新增 ────────────────────────────────────────────────────────────

  async addContact(customerId: number, params: CreateContactParams): Promise<CustomerContactEntity> {
    // 先确认客户归属本租户
    await this.getById(customerId);

    const repo = AppDataSource.getRepository(CustomerContactEntity);

    return AppDataSource.transaction(async (manager) => {
      // 若新联系人设为主要联系人，则先将同客户其他主联系人取消
      if (params.isPrimary) {
        await manager.query(
          `UPDATE customer_contacts SET is_primary = 0
           WHERE tenant_id = ? AND customer_id = ?`,
          [this.tenantId, customerId],
        );
      }

      const contact = repo.create({
        tenantId: this.tenantId,
        customerId,
        name: params.name,
        title: params.title ?? null,
        phone: params.phone ?? null,
        email: params.email ?? null,
        isPrimary: params.isPrimary ?? false,
      });

      return manager.save(contact);
    });
  }

  // ── 联系人：更新 ────────────────────────────────────────────────────────────

  async updateContact(
    customerId: number,
    contactId: number,
    params: Partial<CreateContactParams>,
  ): Promise<CustomerContactEntity> {
    await this.getById(customerId); // verify tenant ownership

    const repo = AppDataSource.getRepository(CustomerContactEntity);
    const contact = await repo.findOne({
      where: { id: contactId, tenantId: this.tenantId, customerId },
    });
    if (!contact) {
      throw AppError.notFound('联系人不存在', ResponseCode.CONTACT_NOT_FOUND);
    }

    return AppDataSource.transaction(async (manager) => {
      if (params.isPrimary) {
        await manager.query(
          `UPDATE customer_contacts SET is_primary = 0
           WHERE tenant_id = ? AND customer_id = ? AND id != ?`,
          [this.tenantId, customerId, contactId],
        );
      }

      if (params.name !== undefined) contact.name = params.name;
      if (params.title !== undefined) contact.title = params.title ?? null;
      if (params.phone !== undefined) contact.phone = params.phone ?? null;
      if (params.email !== undefined) contact.email = params.email ?? null;
      if (params.isPrimary !== undefined) contact.isPrimary = params.isPrimary;

      return manager.save(contact);
    });
  }

  // ── 联系人：删除 ────────────────────────────────────────────────────────────

  async removeContact(contactId: number): Promise<void> {
    const repo = AppDataSource.getRepository(CustomerContactEntity);
    const contact = await repo.findOne({
      where: { id: contactId, tenantId: this.tenantId },
    });
    if (!contact) {
      throw AppError.notFound('联系人不存在', ResponseCode.CONTACT_NOT_FOUND);
    }
    // 主联系人不允许直接删除（需先切换主联系人）
    if (contact.isPrimary) {
      throw AppError.badRequest(
        '主要联系人不可直接删除，请先将其他联系人设为主要联系人',
        ResponseCode.CONTACT_IS_PRIMARY,
      );
    }
    await repo.remove(contact);
  }

  // ── 导出客户列表（上限 5000 条）─────────────────────────────────────────────

  async exportCustomers(filter: CustomerExportFilter): Promise<CustomerEntity[]> {
    const conds: string[] = ['c.tenant_id = ?'];
    const params: unknown[] = [this.tenantId];

    if (filter.keyword) {
      conds.push('(c.name LIKE ? OR c.code LIKE ? OR c.contact LIKE ?)');
      params.push(`%${filter.keyword}%`, `%${filter.keyword}%`, `%${filter.keyword}%`);
    }
    if (filter.grade) {
      conds.push('c.grade = ?');
      params.push(filter.grade);
    }
    if (filter.status) {
      conds.push('c.status = ?');
      params.push(filter.status);
    }

    const where = conds.join(' AND ');
    return AppDataSource.query<CustomerEntity[]>(
      `SELECT * FROM customers c WHERE ${where} ORDER BY c.created_at DESC LIMIT 5000`,
      params,
    );
  }

  // ── 客户关联销售订单（分页）──────────────────────────────────────────────────

  async getCustomerOrders(
    customerId: number,
    page: number,
    pageSize: number,
  ): Promise<[unknown[], number]> {
    await this.getById(customerId);

    const offset = (page - 1) * pageSize;
    const [list, countRows] = await Promise.all([
      AppDataSource.query(
        `SELECT id, order_no AS orderNo, status, total_amount AS totalAmount,
                DATE(created_at) AS orderDate, expected_delivery AS deliveryDate,
                (order_type = 'urgent') AS isUrgent, created_at AS createdAt
         FROM sales_orders
         WHERE tenant_id = ? AND customer_id = ?
         ORDER BY id DESC LIMIT ? OFFSET ?`,
        [this.tenantId, customerId, pageSize, offset],
      ),
      AppDataSource.query<Array<{ total: string }>>(
        `SELECT COUNT(*) AS total FROM sales_orders
         WHERE tenant_id = ? AND customer_id = ?`,
        [this.tenantId, customerId],
      ),
    ]);
    return [list, Number(countRows[0]?.total ?? 0)];
  }
}
