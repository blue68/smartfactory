import { AppDataSource } from '../../config/database';
import { BaseRepository, TenantContext } from '../../shared/BaseRepository';
import { SkuEntity } from './sku.entity';
import { AppError } from '../../shared/AppError';
import { ResponseCode } from '../../shared/ApiResponse';

export interface SkuListFilter {
  category1Id?: number;
  category2Id?: number;
  /**
   * Filter by level-1 category code (e.g. 'MATERIAL' | 'SEMIFIN' | 'FINISHED' | 'PACKING').
   * Translated to a category1_id sub-query at query time so no schema change is needed.
   * Ignored when category1Id is also supplied (category1Id takes precedence).
   */
  category1Code?: string;
  /**
   * Filter by multiple level-1 category codes (IN clause).
   * Ignored when category1Id or category1Code is supplied.
   */
  category1Codes?: string[];
  keyword?: string;
  hasDyeLot?: boolean;
  status?: 'active' | 'inactive';
  customerId?: number;
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
    const customerJoinParams: unknown[] = [];

    if (filter.category1Id) {
      conditions.push('s.category1_id = ?');
      params.push(filter.category1Id);
    } else if (filter.category1Code) {
      // Resolve code → id via sub-query; tenant_id = 0 covers system-seeded categories
      conditions.push(
        's.category1_id = (SELECT id FROM sku_categories WHERE code = ? AND level = 1 AND tenant_id IN (0, ?) LIMIT 1)',
      );
      params.push(filter.category1Code, this.tenantId);
    } else if (filter.category1Codes && filter.category1Codes.length > 0) {
      const placeholders = filter.category1Codes.map(() => '?').join(', ');
      conditions.push(
        `s.category1_id IN (SELECT id FROM sku_categories WHERE code IN (${placeholders}) AND level = 1 AND tenant_id IN (0, ?))`,
      );
      params.push(...filter.category1Codes, this.tenantId);
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
    if (filter.customerId) {
      conditions.push(`(
        s.brand_scope = 'factory'
        OR (s.brand_scope = 'customer' AND s.brand_customer_id = ?)
      )`);
      params.push(filter.customerId);
      customerJoinParams.push(filter.customerId);
    }

    const where = conditions.join(' AND ');
    const offset = (filter.page - 1) * filter.pageSize;
    const customerRefJoin = filter.customerId
      ? `LEFT JOIN customer_sku_refs csr
           ON csr.sku_id = s.id
          AND csr.tenant_id = s.tenant_id
          AND csr.customer_id = ?
          AND csr.status = 'active'`
      : '';
    const customerRefSelect = filter.customerId
      ? `,
                csr.customer_sku_code AS customerSkuCode,
                csr.customer_sku_name AS customerSkuName`
      : `,
                NULL AS customerSkuCode,
                NULL AS customerSkuName`;

    const [rows, countRows] = await Promise.all([
      db.query<SkuEntity[]>(
        `SELECT s.*, c1.name AS category1Name, c2.name AS category2Name,
                c1.code AS category1Code, c2.code AS category2Code
                ${customerRefSelect}
         FROM skus s
         LEFT JOIN sku_categories c1 ON c1.id = s.category1_id
         LEFT JOIN sku_categories c2 ON c2.id = s.category2_id
         ${customerRefJoin}
         WHERE ${where}
         ORDER BY s.id DESC
         LIMIT ? OFFSET ?`,
        [...customerJoinParams, ...params, filter.pageSize, offset],
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
    } else if (filter.category1Code) {
      conditions.push(
        's.category1_id = (SELECT id FROM sku_categories WHERE code = ? AND level = 1 AND tenant_id IN (0, ?) LIMIT 1)',
      );
      params.push(filter.category1Code, this.tenantId);
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

  async getCustomerRefs(skuId: number): Promise<Array<{
    customerId: number;
    customerCode: string;
    customerName: string;
    customerSkuCode: string;
    customerSkuName: string | null;
    status: 'active' | 'inactive';
  }>> {
    return AppDataSource.query(
      `SELECT
         csr.customer_id AS customerId,
         c.code AS customerCode,
         c.name AS customerName,
         csr.customer_sku_code AS customerSkuCode,
         csr.customer_sku_name AS customerSkuName,
         csr.status AS status
       FROM customer_sku_refs csr
       INNER JOIN customers c
         ON c.id = csr.customer_id
        AND c.tenant_id = csr.tenant_id
       WHERE csr.tenant_id = ? AND csr.sku_id = ?
       ORDER BY c.name ASC`,
      [this.tenantId, skuId],
    );
  }

  async replaceCustomerRefs(
    skuId: number,
    refs: Array<{
      customerId: number;
      customerSkuCode: string;
      customerSkuName?: string;
      status?: 'active' | 'inactive';
    }>,
  ): Promise<void> {
    await AppDataSource.transaction(async (manager) => {
      await manager.query(
        `DELETE FROM customer_sku_refs
         WHERE tenant_id = ? AND sku_id = ?`,
        [this.tenantId, skuId],
      );

      for (const ref of refs) {
        await manager.query(
          `INSERT INTO customer_sku_refs
             (tenant_id, customer_id, sku_id, customer_sku_code, customer_sku_name, status, created_by, updated_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            this.tenantId,
            ref.customerId,
            skuId,
            ref.customerSkuCode,
            ref.customerSkuName ?? null,
            ref.status ?? 'active',
            this.currentUserId,
            this.currentUserId,
          ],
        );
      }
    });
  }

  async pruneCustomerRefsForScope(
    skuId: number,
    brandScope: 'factory' | 'customer',
    brandCustomerId: number | null,
  ): Promise<void> {
    if (brandScope !== 'customer' || !brandCustomerId) {
      return;
    }

    await AppDataSource.query(
      `DELETE FROM customer_sku_refs
       WHERE tenant_id = ? AND sku_id = ? AND customer_id <> ?`,
      [this.tenantId, skuId, brandCustomerId],
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
