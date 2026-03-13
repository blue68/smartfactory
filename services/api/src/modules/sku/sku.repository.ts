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
      conditions.push('(s.name LIKE ? OR s.sku_code LIKE ? OR s.spec LIKE ?)');
      const kw = `%${filter.keyword}%`;
      params.push(kw, kw, kw);
    }

    const where = conditions.join(' AND ');
    const offset = (filter.page - 1) * filter.pageSize;

    const [rows, countRows] = await Promise.all([
      db.query<SkuEntity[]>(
        `SELECT s.*, c1.name AS category1Name, c2.name AS category2Name,
                c1.code AS category1Code, c2.code AS category2Code
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

  /**
   * 导出查询：复用 listSkus 的 WHERE 条件，但不分页，上限 5000 条。
   */
  async exportSkus(
    filter: Omit<SkuListFilter, 'page' | 'pageSize'>,
  ): Promise<Array<Record<string, unknown>>> {
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
      conditions.push('(s.name LIKE ? OR s.sku_code LIKE ? OR s.spec LIKE ?)');
      const kw = `%${filter.keyword}%`;
      params.push(kw, kw, kw);
    }

    const where = conditions.join(' AND ');

    return db.query<Array<Record<string, unknown>>>(
      `SELECT s.sku_code      AS skuCode,
              s.name,
              s.spec,
              c1.name         AS category1Name,
              c2.name         AS category2Name,
              s.stock_unit    AS stockUnit,
              s.purchase_unit AS purchaseUnit,
              s.production_unit AS productionUnit,
              s.safety_stock  AS safetyStock,
              s.status,
              s.has_dye_lot   AS hasDyeLot,
              s.description,
              s.created_at    AS createdAt
       FROM skus s
       LEFT JOIN sku_categories c1 ON c1.id = s.category1_id
       LEFT JOIN sku_categories c2 ON c2.id = s.category2_id
       WHERE ${where}
       ORDER BY s.id DESC
       LIMIT 5000`,
      params,
    );
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

  async getStats(): Promise<{
    total: number;
    rawMaterial: number;
    semiProduct: number;
    finished: number;
    noSafetyStock: number;
    incomplete: number;
  }> {
    const db = AppDataSource;
    const tid = this.tenantId;

    // 并行执行各项统计查询，减少总延迟
    const [
      [totalRow],
      [rawRow],
      [semiRow],
      [finRow],
      [noStockRow],
      [incompleteRow],
    ] = await Promise.all([
      db.query<Array<{ cnt: number }>>(
        `SELECT COUNT(*) AS cnt
         FROM skus
         WHERE tenant_id = ? AND status != 'inactive'`,
        [tid],
      ),
      db.query<Array<{ cnt: number }>>(
        `SELECT COUNT(*) AS cnt
         FROM skus s
         JOIN sku_categories c1 ON c1.id = s.category1_id
         WHERE s.tenant_id = ? AND s.status != 'inactive' AND c1.code = 'MATERIAL'`,
        [tid],
      ),
      db.query<Array<{ cnt: number }>>(
        `SELECT COUNT(*) AS cnt
         FROM skus s
         JOIN sku_categories c1 ON c1.id = s.category1_id
         WHERE s.tenant_id = ? AND s.status != 'inactive' AND c1.code = 'SEMIFIN'`,
        [tid],
      ),
      db.query<Array<{ cnt: number }>>(
        `SELECT COUNT(*) AS cnt
         FROM skus s
         JOIN sku_categories c1 ON c1.id = s.category1_id
         WHERE s.tenant_id = ? AND s.status != 'inactive' AND c1.code = 'FINISHED'`,
        [tid],
      ),
      db.query<Array<{ cnt: number }>>(
        `SELECT COUNT(*) AS cnt
         FROM skus
         WHERE tenant_id = ? AND status != 'inactive'
           AND (safety_stock IS NULL OR safety_stock = 0)`,
        [tid],
      ),
      db.query<Array<{ cnt: number }>>(
        `SELECT COUNT(*) AS cnt
         FROM skus
         WHERE tenant_id = ? AND status != 'inactive'
           AND category2_id IS NULL`,
        [tid],
      ),
    ]);

    return {
      total:        Number(totalRow?.cnt      ?? 0),
      rawMaterial:  Number(rawRow?.cnt        ?? 0),
      semiProduct:  Number(semiRow?.cnt       ?? 0),
      finished:     Number(finRow?.cnt        ?? 0),
      noSafetyStock: Number(noStockRow?.cnt   ?? 0),
      incomplete:   Number(incompleteRow?.cnt ?? 0),
    };
  }

  async batchUpdateStatus(ids: number[], status: string): Promise<number> {
    if (ids.length === 0) return 0;
    const placeholders = ids.map(() => '?').join(',');
    const result = await AppDataSource.query(
      `UPDATE skus
       SET status = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP(3)
       WHERE tenant_id = ? AND id IN (${placeholders})`,
      [status, this.currentUserId, this.tenantId, ...ids],
    );
    return Number(result?.affectedRows ?? 0);
  }

  async batchUpdateSafetyStock(ids: number[], safetyStock: string): Promise<number> {
    if (ids.length === 0) return 0;
    const placeholders = ids.map(() => '?').join(',');
    const result = await AppDataSource.query(
      `UPDATE skus
       SET safety_stock = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP(3)
       WHERE tenant_id = ? AND id IN (${placeholders})`,
      [safetyStock, this.currentUserId, this.tenantId, ...ids],
    );
    return Number(result?.affectedRows ?? 0);
  }
}
