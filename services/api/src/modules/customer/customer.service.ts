import { AppDataSource } from '../../config/database';
import { CustomerEntity } from './customer.entity';
import { AppError } from '../../shared/AppError';

export interface CustomerListFilter {
  page: number;
  pageSize: number;
  keyword?: string;
  status?: string;
}

export interface CreateCustomerParams {
  code: string;
  name: string;
  contact?: string;
  phone?: string;
  address?: string;
}

export class CustomerService {
  private readonly tenantId: number;
  private readonly userId: number;

  constructor(ctx: { tenantId: number; userId: number }) {
    this.tenantId = ctx.tenantId;
    this.userId = ctx.userId;
  }

  async list(filter: CustomerListFilter): Promise<[CustomerEntity[], number]> {
    const repo = AppDataSource.getRepository(CustomerEntity);

    if (filter.keyword) {
      return repo.createQueryBuilder('c')
        .where('c.tenant_id = :tenantId', { tenantId: this.tenantId })
        .andWhere('(c.name LIKE :kw OR c.code LIKE :kw)', { kw: `%${filter.keyword}%` })
        .andWhere(filter.status ? 'c.status = :status' : '1=1', { status: filter.status })
        .orderBy('c.created_at', 'DESC')
        .skip((filter.page - 1) * filter.pageSize)
        .take(filter.pageSize)
        .getManyAndCount();
    }

    const where: any = { tenantId: this.tenantId };
    if (filter.status) where.status = filter.status;

    return repo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (filter.page - 1) * filter.pageSize,
      take: filter.pageSize,
    });
  }

  async getOptions(): Promise<CustomerEntity[]> {
    const repo = AppDataSource.getRepository(CustomerEntity);
    return repo.find({
      where: { tenantId: this.tenantId, status: 'active' },
      order: { name: 'ASC' },
    });
  }

  async getById(id: number): Promise<CustomerEntity> {
    const repo = AppDataSource.getRepository(CustomerEntity);
    const customer = await repo.findOne({ where: { id, tenantId: this.tenantId } });
    if (!customer) throw AppError.notFound('客户不存在');
    return customer;
  }

  async create(params: CreateCustomerParams): Promise<CustomerEntity> {
    const repo = AppDataSource.getRepository(CustomerEntity);

    const exists = await repo.findOne({
      where: { tenantId: this.tenantId, code: params.code },
    });
    if (exists) throw AppError.conflict(`客户编码 ${params.code} 已存在`);

    const entity = repo.create({
      tenantId: this.tenantId,
      code: params.code,
      name: params.name,
      contact: params.contact ?? null,
      phone: params.phone ?? null,
      address: params.address ?? null,
      createdBy: this.userId,
      updatedBy: this.userId,
    });
    return repo.save(entity);
  }

  async update(id: number, params: Partial<CreateCustomerParams>): Promise<CustomerEntity> {
    const customer = await this.getById(id);
    const repo = AppDataSource.getRepository(CustomerEntity);

    if (params.code && params.code !== customer.code) {
      const exists = await repo.findOne({
        where: { tenantId: this.tenantId, code: params.code },
      });
      if (exists) throw AppError.conflict(`客户编码 ${params.code} 已存在`);
    }

    Object.assign(customer, {
      ...(params.code !== undefined ? { code: params.code } : {}),
      ...(params.name !== undefined ? { name: params.name } : {}),
      ...(params.contact !== undefined ? { contact: params.contact } : {}),
      ...(params.phone !== undefined ? { phone: params.phone } : {}),
      ...(params.address !== undefined ? { address: params.address } : {}),
      updatedBy: this.userId,
    });

    return repo.save(customer);
  }
}
