import { AppDataSource } from '../../config/database';
import { PriceEntity } from './price.entity';
import { AppError } from '../../shared/AppError';

export interface PriceListFilter {
  page: number;
  pageSize: number;
  keyword?: string;
  supplierId?: number;
  skuId?: number;
  isActive?: boolean;
}

export interface CreatePriceParams {
  supplierId: number;
  skuId: number;
  unitPrice: string;
  purchaseUnit: string;
  moq?: number;
  validFrom?: string;
  validTo?: string;
}

export class PriceService {
  private readonly tenantId: number;
  private readonly userId: number;

  constructor(ctx: { tenantId: number; userId: number }) {
    this.tenantId = ctx.tenantId;
    this.userId = ctx.userId;
  }

  async list(filter: PriceListFilter): Promise<[any[], number]> {
    const qb = AppDataSource.getRepository(PriceEntity)
      .createQueryBuilder('p')
      .leftJoin('suppliers', 's', 's.id = p.supplier_id')
      .leftJoin('skus', 'k', 'k.id = p.sku_id')
      .select([
        'p.id AS id',
        'p.supplier_id AS supplierId',
        's.name AS supplierName',
        'p.sku_id AS skuId',
        'k.sku_code AS skuCode',
        'k.name AS skuName',
        'p.price AS unitPrice',
        'p.unit AS purchaseUnit',
        'p.is_current AS isActive',
        'p.effective_at AS validFrom',
        'p.expired_at AS validTo',
        'p.created_at AS createdAt',
        'p.updated_at AS updatedAt',
      ])
      .where('p.tenant_id = :tenantId', { tenantId: this.tenantId });

    if (filter.supplierId) {
      qb.andWhere('p.supplier_id = :supplierId', { supplierId: filter.supplierId });
    }
    if (filter.skuId) {
      qb.andWhere('p.sku_id = :skuId', { skuId: filter.skuId });
    }
    if (filter.isActive !== undefined) {
      qb.andWhere('p.is_current = :isCurrent', { isCurrent: filter.isActive ? 1 : 0 });
    }
    if (filter.keyword) {
      qb.andWhere('(k.name LIKE :kw OR k.sku_code LIKE :kw OR s.name LIKE :kw)', {
        kw: `%${filter.keyword}%`,
      });
    }

    const total = await qb.getCount();
    const list = await qb
      .orderBy('p.created_at', 'DESC')
      .offset((filter.page - 1) * filter.pageSize)
      .limit(filter.pageSize)
      .getRawMany();

    return [list, total];
  }

  async getById(id: number): Promise<PriceEntity> {
    const repo = AppDataSource.getRepository(PriceEntity);
    const price = await repo.findOne({ where: { id, tenantId: this.tenantId } });
    if (!price) throw AppError.notFound('价格记录不存在');
    return price;
  }

  async create(params: CreatePriceParams): Promise<PriceEntity> {
    const repo = AppDataSource.getRepository(PriceEntity);

    // 价格异常检测：与历史均价对比
    const [avgRow] = await AppDataSource.query(
      `SELECT AVG(price) AS avgPrice FROM supplier_prices
       WHERE tenant_id = ? AND sku_id = ? AND is_current = 0`,
      [this.tenantId, params.skuId],
    ) as Array<{ avgPrice: string | null }>;

    const entity = repo.create({
      tenantId: this.tenantId,
      supplierId: params.supplierId,
      skuId: params.skuId,
      price: params.unitPrice,
      unit: params.purchaseUnit ?? '',
      isCurrent: true,
      effectiveAt: params.validFrom ?? null,
      expiredAt: params.validTo ?? null,
      createdBy: this.userId,
      updatedBy: this.userId,
    });

    // 将该供应商+SKU的旧价格标记为非当前
    await repo.update(
      { tenantId: this.tenantId, supplierId: params.supplierId, skuId: params.skuId, isCurrent: true },
      { isCurrent: false, updatedBy: this.userId },
    );

    const saved = await repo.save(entity);

    // 如果价格超历史均价 20%，添加异常标记（返回给前端判断）
    if (avgRow?.avgPrice) {
      const avg = parseFloat(avgRow.avgPrice);
      const current = parseFloat(params.unitPrice);
      if (avg > 0 && current > avg * 1.2) {
        (saved as any).priceAnomaly = true;
        (saved as any).avgPrice = avg.toFixed(4);
      }
    }

    return saved;
  }

  async update(id: number, params: Partial<CreatePriceParams>): Promise<PriceEntity> {
    const price = await this.getById(id);
    const repo = AppDataSource.getRepository(PriceEntity);

    Object.assign(price, {
      ...(params.unitPrice !== undefined ? { price: params.unitPrice } : {}),
      ...(params.purchaseUnit !== undefined ? { unit: params.purchaseUnit } : {}),
      ...(params.validFrom !== undefined ? { effectiveAt: params.validFrom } : {}),
      ...(params.validTo !== undefined ? { expiredAt: params.validTo } : {}),
      updatedBy: this.userId,
    });

    return repo.save(price);
  }

  // BE-P1-014: 采购价格历史
  async getPriceHistory(skuId: number, supplierId?: number): Promise<Array<{
    price: string; unit: string; supplierName: string; effectiveAt: string;
  }>> {
    let sql = `SELECT sp.price, sp.unit, s.name AS supplier_name, sp.effective_at
       FROM supplier_prices sp
       INNER JOIN suppliers s ON s.id = sp.supplier_id
       WHERE sp.tenant_id = ? AND sp.sku_id = ?`;
    const params: unknown[] = [this.tenantId, skuId];
    if (supplierId) {
      sql += ' AND sp.supplier_id = ?';
      params.push(supplierId);
    }
    sql += ' ORDER BY sp.effective_at DESC LIMIT 50';
    const rows = await AppDataSource.query(sql, params);
    return rows.map((r: Record<string, unknown>) => ({
      price: String(r.price),
      unit: String(r.unit),
      supplierName: String(r.supplier_name),
      effectiveAt: String(r.effective_at),
    }));
  }
}
