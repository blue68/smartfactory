import { AppDataSource } from '../../config/database';
import { SupplierEntity } from './supplier.entity';
import { AppError } from '../../shared/AppError';
import { Like, FindOptionsWhere } from 'typeorm';

export interface SupplierListFilter {
  page: number;
  pageSize: number;
  keyword?: string;
  rating?: string;
  isActive?: boolean;
}

export interface CreateSupplierParams {
  code: string;
  name: string;
  grade?: 'A' | 'B' | 'C';
  contact?: string;
  phone?: string;
  address?: string;
  mainSkus?: number[];
}

export class SupplierService {
  private readonly tenantId: number;
  private readonly userId: number;

  constructor(ctx: { tenantId: number; userId: number }) {
    this.tenantId = ctx.tenantId;
    this.userId = ctx.userId;
  }

  async list(filter: SupplierListFilter): Promise<[SupplierEntity[], number]> {
    const repo = AppDataSource.getRepository(SupplierEntity);
    const where: FindOptionsWhere<SupplierEntity> = { tenantId: this.tenantId };

    if (filter.rating) {
      where.grade = filter.rating as 'A' | 'B' | 'C';
    }
    if (filter.isActive !== undefined) {
      where.status = filter.isActive ? 'active' : 'inactive';
    }
    if (filter.keyword) {
      // keyword 搜索 name 和 code
      return repo.createQueryBuilder('s')
        .where('s.tenant_id = :tenantId', { tenantId: this.tenantId })
        .andWhere('(s.name LIKE :kw OR s.code LIKE :kw)', { kw: `%${filter.keyword}%` })
        .andWhere(filter.rating ? 's.grade = :grade' : '1=1', { grade: filter.rating })
        .andWhere(filter.isActive !== undefined ? 's.status = :status' : '1=1', {
          status: filter.isActive ? 'active' : 'inactive',
        })
        .orderBy('s.created_at', 'DESC')
        .skip((filter.page - 1) * filter.pageSize)
        .take(filter.pageSize)
        .getManyAndCount();
    }

    return repo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (filter.page - 1) * filter.pageSize,
      take: filter.pageSize,
    });
  }

  async getOptions(): Promise<SupplierEntity[]> {
    const repo = AppDataSource.getRepository(SupplierEntity);
    return repo.find({
      where: { tenantId: this.tenantId, status: 'active' },
      order: { name: 'ASC' },
    });
  }

  async getById(id: number): Promise<SupplierEntity> {
    const repo = AppDataSource.getRepository(SupplierEntity);
    const supplier = await repo.findOne({ where: { id, tenantId: this.tenantId } });
    if (!supplier) throw AppError.notFound('供应商不存在');
    return supplier;
  }

  async create(params: CreateSupplierParams): Promise<SupplierEntity> {
    const repo = AppDataSource.getRepository(SupplierEntity);

    // 检查编码唯一性
    const exists = await repo.findOne({
      where: { tenantId: this.tenantId, code: params.code },
    });
    if (exists) throw AppError.conflict(`供应商编码 ${params.code} 已存在`);

    const entity = repo.create({
      tenantId: this.tenantId,
      code: params.code,
      name: params.name,
      grade: params.grade ?? 'B',
      contact: params.contact ?? null,
      phone: params.phone ?? null,
      address: params.address ?? null,
      mainSkus: params.mainSkus ?? null,
      createdBy: this.userId,
      updatedBy: this.userId,
    });
    return repo.save(entity);
  }

  // BE-P1: 供应商绩效
  async getPerformance(supplierId: number): Promise<{
    onTimeRate: string;
    totalOrders: number;
    recentAmounts: Array<{ month: string; amount: string }>;
  }> {
    const [totalRow] = await AppDataSource.query(
      `SELECT COUNT(*) AS total FROM purchase_orders WHERE tenant_id = ? AND supplier_id = ?`,
      [this.tenantId, supplierId],
    );
    const [onTimeRow] = await AppDataSource.query(
      `SELECT COUNT(*) AS cnt FROM purchase_orders
       WHERE tenant_id = ? AND supplier_id = ? AND status = 'completed'
         AND actual_delivery_date <= expected_date`,
      [this.tenantId, supplierId],
    );
    const total = Number(totalRow?.total || 0);
    const onTime = Number(onTimeRow?.cnt || 0);
    const onTimeRate = total > 0 ? `${((onTime / total) * 100).toFixed(1)}%` : '0%';

    const amountRows = await AppDataSource.query(
      `SELECT DATE_FORMAT(created_at, '%Y-%m') AS month, SUM(total_amount) AS amount
       FROM purchase_orders WHERE tenant_id = ? AND supplier_id = ?
       GROUP BY month ORDER BY month DESC LIMIT 6`,
      [this.tenantId, supplierId],
    );

    return {
      onTimeRate,
      totalOrders: total,
      recentAmounts: amountRows.map((r: any) => ({ month: r.month, amount: String(r.amount || 0) })),
    };
  }

  async update(id: number, params: Partial<CreateSupplierParams>): Promise<SupplierEntity> {
    const supplier = await this.getById(id);
    const repo = AppDataSource.getRepository(SupplierEntity);

    if (params.code && params.code !== supplier.code) {
      const exists = await repo.findOne({
        where: { tenantId: this.tenantId, code: params.code },
      });
      if (exists) throw AppError.conflict(`供应商编码 ${params.code} 已存在`);
    }

    Object.assign(supplier, {
      ...(params.code !== undefined ? { code: params.code } : {}),
      ...(params.name !== undefined ? { name: params.name } : {}),
      ...(params.grade !== undefined ? { grade: params.grade } : {}),
      ...(params.contact !== undefined ? { contact: params.contact } : {}),
      ...(params.phone !== undefined ? { phone: params.phone } : {}),
      ...(params.address !== undefined ? { address: params.address } : {}),
      ...(params.mainSkus !== undefined ? { mainSkus: params.mainSkus } : {}),
      updatedBy: this.userId,
    });

    return repo.save(supplier);
  }

  // BE-P1-013: 供应商月度对账单
  async getMonthlyStatement(supplierId: number, month: string): Promise<{
    orders: Array<{ poNo: string; amount: string; status: string; createdAt: string }>;
    totalAmount: string;
  }> {
    const rows = await AppDataSource.query(
      `SELECT po_no, total_amount AS amount, status, created_at
       FROM purchase_orders
       WHERE tenant_id = ? AND supplier_id = ? AND DATE_FORMAT(created_at, '%Y-%m') = ?
       ORDER BY created_at DESC`,
      [this.tenantId, supplierId, month],
    );
    const totalAmount = rows.reduce((s: number, r: Record<string, unknown>) => s + parseFloat(String(r.amount || 0)), 0);
    return {
      orders: rows.map((r: Record<string, unknown>) => ({
        poNo: String(r.po_no),
        amount: String(r.amount),
        status: String(r.status),
        createdAt: String(r.created_at),
      })),
      totalAmount: totalAmount.toFixed(2),
    };
  }
}
