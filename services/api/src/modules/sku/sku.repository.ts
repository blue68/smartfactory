import { AppDataSource } from '../../config/database';
import { BaseRepository, TenantContext } from '../../shared/BaseRepository';
import { SkuEntity } from './sku.entity';
import { AppError } from '../../shared/AppError';
import { ResponseCode } from '../../shared/ApiResponse';

export interface SkuListFilter {
  category1Id?: number;
  category2Id?: number;
  keyword?: string;
  hasDyeLot?: boolean;
  status?: 'active' | 'inactive';
  page: number;
  pageSize: number;
}

export class SkuRepository extends BaseRepository<SkuEntity> {
  constructor(ctx: TenantContext) {
    super(SkuEntity, ctx);
  }

  async findById(id: number): Promise<SkuEntity> {
    const sku = await this.findOneByTenant({ where: { id } as any });
    if (!sku) throw AppError.notFound('SKU不存在', ResponseCode.SKU_NOT_FOUND);
    return sku;
  }

  async findBySkuCode(skuCode: string): Promise<SkuEntity | null> {
    return this.findOneByTenant({ where: { skuCode } as any });
  }

  async listSkus(filter: SkuListFilter): Promise<[SkuEntity[], number]> {
    const db = AppDataSource;
    const conditions: string[] = ['s.tenant_id = ?'];
    const params: unknown[] = [this.tenantId];

    if (filter.category1Id) {
      conditions.push('s.category1_id = ?');
      params.push(filter.category1Id);
    }
    if (filter.category2Id) {
      conditions.push('s.category2_id = ?');
      params.push(filter.category2Id);
    }
    if (filter.hasDyeLot !== undefined) {
      conditions.push('s.has_dye_lot = ?');
      params.push(filter.hasDyeLot ? 1 : 0);
    }
    if (filter.status) {
      conditions.push('s.status = ?');
      params.push(filter.status);
    }
    if (filter.keyword) {
      conditions.push('MATCH(s.name, s.spec) AGAINST (? IN BOOLEAN MODE)');
      params.push(`*${filter.keyword}*`);
    }

    const where = conditions.join(' AND ');
    const offset = (filter.page - 1) * filter.pageSize;

    const [rows, countRows] = await Promise.all([
      db.query<SkuEntity[]>(
        `SELECT s.*, c1.name AS category1Name, c2.name AS category2Name
         FROM skus s
         LEFT JOIN sku_categories c1 ON c1.id = s.category1_id
         LEFT JOIN sku_categories c2 ON c2.id = s.category2_id
         WHERE ${where}
         ORDER BY s.id DESC
         LIMIT ? OFFSET ?`,
        [...params, filter.pageSize, offset],
      ),
      db.query<Array<{ total: number }>>(
        `SELECT COUNT(*) AS total FROM skus s WHERE ${where}`,
        params,
      ),
    ]);

    return [rows, Number(countRows[0]?.total ?? 0)];
  }

  async create(data: Partial<SkuEntity>): Promise<SkuEntity> {
    const existing = await this.findBySkuCode(data.skuCode!);
    if (existing) {
      throw AppError.conflict('SKU编码已存在', ResponseCode.SKU_CODE_DUPLICATE);
    }
    const entity = this.repo.create(this.buildInsertData(data) as Partial<SkuEntity>);
    return this.repo.save(entity);
  }

  async update(id: number, data: Partial<SkuEntity>): Promise<SkuEntity> {
    const sku = await this.findById(id);
    Object.assign(sku, this.buildUpdateData(data));
    return this.repo.save(sku);
  }

  async getUnitConversions(skuId: number): Promise<Array<{
    fromUnit: string; toUnit: string; conversionRate: string; description: string | null;
  }>> {
    return AppDataSource.query(
      `SELECT from_unit AS fromUnit, to_unit AS toUnit,
              conversion_rate AS conversionRate, description
       FROM sku_unit_conversions
       WHERE tenant_id = ? AND sku_id = ?`,
      [this.tenantId, skuId],
    );
  }

  async upsertUnitConversion(
    skuId: number,
    fromUnit: string,
    toUnit: string,
    rate: string,
    description?: string,
  ): Promise<void> {
    await AppDataSource.query(
      `INSERT INTO sku_unit_conversions
         (tenant_id, sku_id, from_unit, to_unit, conversion_rate, description, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         conversion_rate = VALUES(conversion_rate),
         description     = VALUES(description),
         updated_by      = VALUES(updated_by)`,
      [this.tenantId, skuId, fromUnit, toUnit, rate, description ?? null,
        this.currentUserId, this.currentUserId],
    );
  }
}
