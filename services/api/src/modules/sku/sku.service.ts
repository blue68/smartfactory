import { TenantContext } from '../../shared/BaseRepository';
import { SkuRepository, SkuListFilter } from './sku.repository';
import { AppDataSource } from '../../config/database';
import { getRedisClient, RedisKeys, RedisTTL } from '../../config/redis';

export interface CreateSkuParams {
  skuCode?: string;           // 不传则自动生成
  barcode?: string;
  name: string;
  spec?: string;
  category1Id: number;
  category2Id: number;
  stockUnit: string;
  purchaseUnit: string;
  productionUnit: string;
  hasDyeLot?: boolean;
  safetyStock?: string;
  description?: string;
}

export interface UnitConversionParam {
  fromUnit: string;
  toUnit: string;
  conversionRate: string;
  description?: string;
}

export class SkuService {
  private readonly repo: SkuRepository;

  constructor(ctx: TenantContext) {
    this.repo = new SkuRepository(ctx);
  }

  async listSkus(filter: SkuListFilter) {
    return this.repo.listSkus(filter);
  }

  async getSkuById(id: number) {
    const sku = await this.repo.findById(id);
    const conversions = await this.repo.getUnitConversions(id);
    return { ...sku, unitConversions: conversions };
  }

  async createSku(params: CreateSkuParams) {
    // 校验一级二级分类层级关系（只需执行一次）
    await this.validateCategories(params.category1Id, params.category2Id);

    // 面料类 category2 强制开启缸号管理（只需执行一次）
    const hasDyeLot = await this.shouldEnableDyeLot(params.category2Id, params.hasDyeLot);

    // 若外部已传入 skuCode，直接使用；否则带重试生成，防止并发 UNIQUE KEY 冲突
    const MAX_RETRIES = 3;
    let lastError: unknown;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const skuCode =
        params.skuCode ?? (await this.generateSkuCode(params.category1Id, params.category2Id));

      try {
        const sku = await this.repo.create({
          skuCode,
          barcode: params.barcode ?? null,
          name: params.name,
          spec: params.spec ?? null,
          category1Id: params.category1Id,
          category2Id: params.category2Id,
          stockUnit: params.stockUnit,
          purchaseUnit: params.purchaseUnit,
          productionUnit: params.productionUnit,
          hasDyeLot,
          safetyStock: params.safetyStock ?? '0',
          description: params.description ?? null,
        });

        // 失效 SKU 列表缓存
        await getRedisClient().del(RedisKeys.skuList(this.repo.tenantId));
        return sku;
      } catch (err: unknown) {
        // ER_DUP_ENTRY (MySQL error code 1062)：skuCode UNIQUE KEY 冲突
        // 仅当自动生成编码时重试；外部传入的编码冲突应直接抛出
        const isDupEntry =
          err instanceof Error &&
          (err.message.includes('ER_DUP_ENTRY') || err.message.includes('Duplicate entry'));

        if (params.skuCode || !isDupEntry) {
          throw err;
        }

        lastError = err;
        // 继续下一次循环，重新生成编码后重试
      }
    }

    throw lastError;
  }

  async updateSku(id: number, params: Partial<CreateSkuParams>) {
    if (params.category1Id && params.category2Id) {
      await this.validateCategories(params.category1Id, params.category2Id);
    }
    const updated = await this.repo.update(id, {
      ...(params.name ? { name: params.name } : {}),
      ...(params.spec !== undefined ? { spec: params.spec } : {}),
      ...(params.safetyStock !== undefined ? { safetyStock: params.safetyStock } : {}),
      ...(params.hasDyeLot !== undefined ? { hasDyeLot: params.hasDyeLot } : {}),
      ...(params.description !== undefined ? { description: params.description } : {}),
    });

    await getRedisClient().del(RedisKeys.skuList(this.repo.tenantId));
    return updated;
  }

  async setUnitConversions(skuId: number, conversions: UnitConversionParam[]) {
    // 校验 SKU 存在
    await this.repo.findById(skuId);

    for (const c of conversions) {
      await this.repo.upsertUnitConversion(
        skuId, c.fromUnit, c.toUnit, c.conversionRate, c.description,
      );
    }

    await getRedisClient().del(RedisKeys.skuList(this.repo.tenantId));
    return this.repo.getUnitConversions(skuId);
  }

  async getCategories() {
    return AppDataSource.query(
      `SELECT id, level, parent_id AS parentId, code, name, sort_order AS sortOrder
       FROM sku_categories
       WHERE tenant_id IN (0, ?) AND is_active = 1
       ORDER BY level, sort_order`,
      [this.repo.tenantId],
    );
  }

  // ─── 私有辅助 ──────────────────────────────────────────────

  private async generateSkuCode(cat1Id: number, cat2Id: number): Promise<string> {
    const [cat] = await AppDataSource.query<Array<{ code: string }>>(
      'SELECT code FROM sku_categories WHERE id = ? LIMIT 1',
      [cat2Id],
    );
    const prefix = cat?.code?.slice(0, 3).toUpperCase() ?? 'SKU';
    const [row] = await AppDataSource.query<Array<{ seq: number }>>(
      `SELECT COUNT(*) + 1 AS seq FROM skus
       WHERE tenant_id = ? AND category2_id = ?`,
      [this.repo.tenantId, cat2Id],
    );
    void cat1Id;
    return `${prefix}${String(row?.seq ?? 1).padStart(5, '0')}`;
  }

  private async validateCategories(cat1Id: number, cat2Id: number): Promise<void> {
    const [cat2] = await AppDataSource.query<Array<{ parent_id: number }>>(
      'SELECT parent_id FROM sku_categories WHERE id = ? LIMIT 1',
      [cat2Id],
    );
    if (!cat2 || Number(cat2.parent_id) !== cat1Id) {
      throw new Error(`二级分类 ${cat2Id} 不属于一级分类 ${cat1Id}`);
    }
  }

  private async shouldEnableDyeLot(cat2Id: number, requested?: boolean): Promise<boolean> {
    const [cat] = await AppDataSource.query<Array<{ code: string }>>(
      'SELECT code FROM sku_categories WHERE id = ? LIMIT 1',
      [cat2Id],
    );
    // 面料类和皮料类强制开启
    if (cat?.code === 'FABRIC' || cat?.code === 'LEATHER') return true;
    return requested ?? false;
  }
}
