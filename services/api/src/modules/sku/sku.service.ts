import { TenantContext } from '../../shared/BaseRepository';
import { SkuRepository, SkuListFilter } from './sku.repository';
import { AppDataSource } from '../../config/database';
import { getRedisClient, RedisKeys, RedisTTL } from '../../config/redis';
import { AppError } from '../../shared/AppError';
import { ResponseCode } from '../../shared/ApiResponse';
import {
  AssetProfileInput,
  ConsumableProfileInput,
  SkuAssetTrackingMode,
  SkuBusinessClass,
  SkuControlMode,
} from './sku.types';

/** CSV 解析后每行的原始字段（全部为字符串，允许为空） */
export interface ImportSkuRow {
  skuCode?: string;
  name: string;
  spec?: string;
  category1Code: string;
  category2Code: string;
  stockUnit: string;
  purchaseUnit: string;
  productionUnit: string;
  safetyStock?: string;
  status?: string;
  description?: string;
}

/** importSkus 返回汇总 */
export interface ImportResult {
  imported: number;
  failed: number;
  errors: Array<{ row: number; message: string }>;
}

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
  stockConvFactor?: number;
  prodConvNote?: string;
  hasDyeLot?: boolean;
  useFifo?: boolean;
  safetyStock?: string;
  description?: string;
  brandScope?: 'factory' | 'customer';
  brandCustomerId?: number | null;
  customerRefs?: CustomerSkuRefParam[];
  businessClass?: SkuBusinessClass;
  controlMode?: SkuControlMode;
  allowBomComponent?: boolean;
  allowPurchase?: boolean;
  allowInventory?: boolean;
  allowProductionIssue?: boolean;
  requiresAssetAcceptance?: boolean;
  defaultWarehouseType?: string | null;
  approvalPolicyCode?: string | null;
  assetTrackingMode?: SkuAssetTrackingMode;
  consumableProfile?: ConsumableProfileInput;
  assetProfile?: AssetProfileInput;
}

export interface UnitConversionParam {
  fromUnit: string;
  toUnit: string;
  conversionRate: string;
  description?: string;
}

export interface CustomerSkuRefParam {
  customerId: number;
  customerSkuCode: string;
  customerSkuName?: string;
  status?: 'active' | 'inactive';
}

const SKU_CODE_SEQUENCE_WIDTH = 7;
const FINISHED_CATEGORY_CODE = 'FINISHED';

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
    const customerRefs = await this.repo.getCustomerRefs(id);
    const [consumableProfile, assetProfile] = await Promise.all([
      this.repo.getConsumableProfile(id),
      this.repo.getAssetProfile(id),
    ]);
    return { ...sku, unitConversions: conversions, customerRefs, consumableProfile, assetProfile };
  }

  async createSku(params: CreateSkuParams) {
    // 校验一级二级分类层级关系（只需执行一次）
    await this.validateCategories(params.category1Id, params.category2Id);

    // 面料类 category2 强制开启缸号管理（只需执行一次）
    const hasDyeLot = await this.shouldEnableDyeLot(params.category2Id, params.hasDyeLot);
    const isFinished = await this.isFinishedCategory(params.category1Id);
    const category1Code = await this.getCategory1Code(params.category1Id);
    const normalizedBrandScope = isFinished ? (params.brandScope ?? 'factory') : 'factory';
    const normalizedBrandCustomerId = isFinished && normalizedBrandScope === 'customer'
      ? (params.brandCustomerId ?? null)
      : null;
    const normalizedCustomerRefs = isFinished ? (params.customerRefs ?? []) : [];
    await this.validateBranding(normalizedBrandScope, normalizedBrandCustomerId, normalizedCustomerRefs);
    const controlConfig = this.normalizeControlConfig(params, category1Code);

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
          brandScope: normalizedBrandScope,
          brandCustomerId: normalizedBrandCustomerId,
          hasDyeLot,
          safetyStock: params.safetyStock ?? '0',
          description: params.description ?? null,
          businessClass: controlConfig.businessClass,
          controlMode: controlConfig.controlMode,
          allowBomComponent: controlConfig.allowBomComponent,
          allowPurchase: controlConfig.allowPurchase,
          allowInventory: controlConfig.allowInventory,
          allowProductionIssue: controlConfig.allowProductionIssue,
          requiresAssetAcceptance: controlConfig.requiresAssetAcceptance,
          defaultWarehouseType: controlConfig.defaultWarehouseType,
          approvalPolicyCode: controlConfig.approvalPolicyCode,
          assetTrackingMode: controlConfig.assetTrackingMode,
        });

        await Promise.all([
          normalizedCustomerRefs.length > 0
            ? this.repo.replaceCustomerRefs(sku.id, normalizedCustomerRefs)
            : Promise.resolve(),
          this.syncProfilesByBusinessClass(sku.id, controlConfig.businessClass, params),
        ]);

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

  async updateSku(id: number, params: Partial<CreateSkuParams> & { status?: 'active' | 'inactive' }) {
    const currentSku = await this.repo.findById(id);
    if (params.category1Id && params.category2Id) {
      await this.validateCategories(params.category1Id, params.category2Id);
    }
    const nextCategory1Id = params.category1Id ?? currentSku.category1Id;
    const isFinished = await this.isFinishedCategory(nextCategory1Id);
    const category1Code = await this.getCategory1Code(nextCategory1Id);
    const nextBrandScope = isFinished ? (params.brandScope ?? currentSku.brandScope) : 'factory';
    const nextBrandCustomerId = isFinished
      ? (nextBrandScope === 'factory'
        ? null
        : (params.brandCustomerId ?? currentSku.brandCustomerId ?? null))
      : null;
    const nextCustomerRefs = isFinished ? (params.customerRefs ?? []) : [];
    await this.validateBranding(nextBrandScope, nextBrandCustomerId, nextCustomerRefs);
    const controlConfig = this.normalizeControlConfig(
      params,
      category1Code,
      {
        businessClass: currentSku.businessClass,
        controlMode: currentSku.controlMode,
        allowBomComponent: currentSku.allowBomComponent,
        allowPurchase: currentSku.allowPurchase,
        allowInventory: currentSku.allowInventory,
        allowProductionIssue: currentSku.allowProductionIssue,
        requiresAssetAcceptance: currentSku.requiresAssetAcceptance,
        defaultWarehouseType: currentSku.defaultWarehouseType,
        approvalPolicyCode: currentSku.approvalPolicyCode,
        assetTrackingMode: currentSku.assetTrackingMode,
      },
    );
    const updateData: Record<string, unknown> = {};
    if (params.name !== undefined) updateData.name = params.name;
    if (params.spec !== undefined) updateData.spec = params.spec;
    if (params.category1Id !== undefined) updateData.category1Id = params.category1Id;
    if (params.category2Id !== undefined) updateData.category2Id = params.category2Id;
    if (params.stockUnit !== undefined) updateData.stockUnit = params.stockUnit;
    if (params.purchaseUnit !== undefined) updateData.purchaseUnit = params.purchaseUnit;
    if (params.productionUnit !== undefined) updateData.productionUnit = params.productionUnit;
    if (params.stockConvFactor !== undefined) updateData.stockConvFactor = params.stockConvFactor;
    if (params.prodConvNote !== undefined) updateData.prodConvNote = params.prodConvNote;
    if (params.safetyStock !== undefined) updateData.safetyStock = params.safetyStock;
    if (params.hasDyeLot !== undefined) updateData.hasDyeLot = params.hasDyeLot;
    if (params.useFifo !== undefined) updateData.useFifo = params.useFifo;
    if (params.description !== undefined) updateData.description = params.description;
    updateData.businessClass = controlConfig.businessClass;
    updateData.controlMode = controlConfig.controlMode;
    updateData.allowBomComponent = controlConfig.allowBomComponent;
    updateData.allowPurchase = controlConfig.allowPurchase;
    updateData.allowInventory = controlConfig.allowInventory;
    updateData.allowProductionIssue = controlConfig.allowProductionIssue;
    updateData.requiresAssetAcceptance = controlConfig.requiresAssetAcceptance;
    updateData.defaultWarehouseType = controlConfig.defaultWarehouseType;
    updateData.approvalPolicyCode = controlConfig.approvalPolicyCode;
    updateData.assetTrackingMode = controlConfig.assetTrackingMode;
    if (isFinished) {
      if (params.brandScope !== undefined) updateData.brandScope = params.brandScope;
      if (params.brandScope === 'factory') {
        updateData.brandCustomerId = null;
      } else if (params.brandCustomerId !== undefined) {
        updateData.brandCustomerId = params.brandCustomerId;
      }
    } else {
      updateData.brandScope = 'factory';
      updateData.brandCustomerId = null;
    }
    if (params.status !== undefined) updateData.status = params.status;

    const updated = await this.repo.update(id, updateData as any);
    await this.repo.pruneCustomerRefsForScope(id, nextBrandScope, nextBrandCustomerId);
    if (isFinished && params.customerRefs) {
      await this.repo.replaceCustomerRefs(id, params.customerRefs);
    }
    if (!isFinished) {
      await this.repo.replaceCustomerRefs(id, []);
    }
    await this.syncProfilesByBusinessClass(id, controlConfig.businessClass, params);

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

  async getSkuStats() {
    return this.repo.getStats();
  }

  async batchUpdateStatus(ids: number[], status: string): Promise<{ affected: number }> {
    const affected = await this.repo.batchUpdateStatus(ids, status);
    // 批量操作后使列表缓存失效
    await getRedisClient().del(RedisKeys.skuList(this.repo.tenantId));
    return { affected };
  }

  async batchUpdateSafetyStock(ids: number[], safetyStock: number): Promise<{ affected: number }> {
    // 将数字转为 DECIMAL 字符串传入 repository，保留 4 位小数精度
    const affected = await this.repo.batchUpdateSafetyStock(ids, safetyStock.toFixed(4));
    await getRedisClient().del(RedisKeys.skuList(this.repo.tenantId));
    return { affected };
  }

  /**
   * 导出 SKU 列表（上限 5000 条），供 controller 生成 xlsx 文件。
   * 不分页，直接返回原始行数据。
   */
  async exportSkus(filter: Omit<import('./sku.repository').SkuListFilter, 'page' | 'pageSize'>) {
    return this.repo.exportSkus(filter);
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

  /**
   * 批量导入 SKU（CSV 解析结果）。
   * 逐行容错：单行失败不中断整批，汇总返回导入成功数、失败数及错误明细。
   */
  async importSkus(rows: ImportSkuRow[]): Promise<ImportResult> {
    const result: ImportResult = { imported: 0, failed: 0, errors: [] };

    if (rows.length === 0) return result;

    // 一次性加载租户分类映射，避免每行重复查库
    const catMap = await this.loadCategoryMap();

    for (let i = 0; i < rows.length; i++) {
      const rowNum = i + 2; // CSV 第1行为表头，数据从第2行开始
      const row = rows[i];

      try {
        // 校验必填字段
        if (!row.name?.trim()) {
          throw new Error('物料名称不能为空');
        }
        if (!row.stockUnit?.trim()) {
          throw new Error('基本单位不能为空');
        }
        if (!row.purchaseUnit?.trim()) {
          throw new Error('采购单位不能为空');
        }
        if (!row.productionUnit?.trim()) {
          throw new Error('计价单位不能为空');
        }

        // 解析一级分类
        // 查找顺序：原始值（支持中文名如"原材料"）→ 大写值（支持英文 code 如"MATERIAL"）
        const cat1Raw = row.category1Code?.trim();
        if (!cat1Raw) throw new Error('一级分类不能为空');
        const cat1 = catMap.get(cat1Raw) ?? catMap.get(cat1Raw.toUpperCase());
        if (!cat1 || cat1.level !== 1) {
          throw new Error(`一级分类 "${cat1Raw}" 不存在`);
        }

        // 解析二级分类
        const cat2Raw = row.category2Code?.trim();
        if (!cat2Raw) throw new Error('二级分类不能为空');
        const cat2 = catMap.get(cat2Raw) ?? catMap.get(cat2Raw.toUpperCase());
        if (!cat2 || cat2.level !== 2) {
          throw new Error(`二级分类 "${cat2Raw}" 不存在`);
        }

        // 校验层级关系
        if (cat2.parentId !== cat1.id) {
          throw new Error(`二级分类 "${cat2Raw}" 不属于一级分类 "${cat1Raw}"`);
        }

        // 校验并格式化安全库存（允许为空，默认 '0'）
        let safetyStock: string | undefined;
        if (row.safetyStock?.trim()) {
          const ss = row.safetyStock.trim();
          if (!/^\d+(\.\d{1,4})?$/.test(ss)) {
            throw new Error(`安全库存格式不正确: ${ss}`);
          }
          safetyStock = ss;
        }

        await this.createSku({
          skuCode:        row.skuCode?.trim() || undefined,
          name:           row.name.trim(),
          spec:           row.spec?.trim()    || undefined,
          category1Id:    cat1.id,
          category2Id:    cat2.id,
          stockUnit:      row.stockUnit.trim(),
          purchaseUnit:   row.purchaseUnit.trim(),
          productionUnit: row.productionUnit.trim(),
          safetyStock,
          description:    row.description?.trim() || undefined,
        });

        result.imported += 1;
      } catch (err: unknown) {
        result.failed += 1;
        const message = err instanceof Error ? err.message : '未知错误';
        result.errors.push({ row: rowNum, message });
      }
    }

    return result;
  }

  // ─── 私有辅助 ──────────────────────────────────────────────

  /**
   * 加载当前租户的全部分类，返回同时支持 code（大写）和 name（中文）查找的 Map。
   *
   * Map 键策略：
   *   - code.toUpperCase()  → 支持英文 code（如 MATERIAL）
   *   - name（原始字符串）   → 支持中文名称（如 原材料）
   *
   * 当 code 与 name 重复时，code 写入顺序靠后，优先级更高（后写覆盖先写）。
   * 实践中 code 和 name 不会重叠，此策略仅作保险。
   *
   * 仅在单次 importSkus() 调用内复用，不做跨请求缓存。
   */
  private async loadCategoryMap(): Promise<Map<string, { id: number; level: number; parentId: number | null }>> {
    const rows = await AppDataSource.query<Array<{
      id: number;
      code: string;
      name: string;
      level: number;
      parent_id: number | null;
    }>>(
      `SELECT id, code, name, level, parent_id
       FROM sku_categories
       WHERE tenant_id IN (0, ?) AND is_active = 1`,
      [this.repo.tenantId],
    );

    const map = new Map<string, { id: number; level: number; parentId: number | null }>();
    for (const row of rows) {
      const entry = {
        id:       Number(row.id),
        level:    Number(row.level),
        parentId: row.parent_id != null ? Number(row.parent_id) : null,
      };
      // 按中文 name 索引（支持用户在 Excel 中填写 "原材料" 等中文名称）
      if (row.name) {
        map.set(row.name, entry);
      }
      // 按 code 大写索引（覆盖同名 name 条目，优先级更高）
      if (row.code) {
        map.set(row.code.toUpperCase(), entry);
      }
    }
    return map;
  }

  private async generateSkuCode(cat1Id: number, cat2Id: number): Promise<string> {
    const [cat] = await AppDataSource.query<Array<{ code: string }>>(
      'SELECT code FROM sku_categories WHERE id = ? LIMIT 1',
      [cat2Id],
    );
    const prefix = cat?.code?.slice(0, 3).toUpperCase() ?? 'SKU';
    // 使用 MAX(sku_code) 提取最大序号，避免 COUNT 在删除行后产生重复编码
    const [row] = await AppDataSource.query<Array<{ max_code: string | null }>>(
      `SELECT MAX(sku_code) AS max_code FROM skus
       WHERE tenant_id = ? AND category2_id = ? AND sku_code LIKE ?`,
      [this.repo.tenantId, cat2Id, `${prefix}%`],
    );
    let seq = 1;
    if (row?.max_code) {
      const numPart = row.max_code.slice(prefix.length);
      const parsed = parseInt(numPart, 10);
      if (!isNaN(parsed)) seq = parsed + 1;
    }
    void cat1Id;
    return `${prefix}${String(seq).padStart(SKU_CODE_SEQUENCE_WIDTH, '0')}`;
  }

  private async validateCategories(cat1Id: number, cat2Id: number): Promise<void> {
    const [cat2] = await AppDataSource.query<Array<{ parent_id: number }>>(
      'SELECT parent_id FROM sku_categories WHERE id = ? LIMIT 1',
      [cat2Id],
    );
    if (!cat2 || Number(cat2.parent_id) !== cat1Id) {
      throw AppError.badRequest(
        `二级分类 ${cat2Id} 不属于一级分类 ${cat1Id}`,
        ResponseCode.SKU_CATEGORY_MISMATCH,
      );
    }
  }

  private async getCategory1Code(category1Id: number): Promise<string | null> {
    const [row] = await AppDataSource.query<Array<{ code: string }>>(
      'SELECT code FROM sku_categories WHERE id = ? LIMIT 1',
      [category1Id],
    );
    return row?.code ?? null;
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

  private async validateBranding(
    brandScope: 'factory' | 'customer',
    brandCustomerId: number | null,
    customerRefs: CustomerSkuRefParam[],
  ): Promise<void> {
    if (brandScope === 'customer' && !brandCustomerId) {
      throw AppError.badRequest('客户专属 SKU 必须选择所属客户');
    }

    const customerIds = Array.from(new Set([
      ...(brandCustomerId ? [brandCustomerId] : []),
      ...customerRefs.map((item) => item.customerId),
    ]));
    if (customerIds.length === 0) {
      return;
    }

    const rows = await AppDataSource.query<Array<{ id: number; status: string }>>(
      `SELECT id, status
       FROM customers
       WHERE tenant_id = ? AND id IN (${customerIds.map(() => '?').join(',')})`,
      [this.repo.tenantId, ...customerIds],
    );
    const rowMap = new Map(rows.map((row) => [Number(row.id), row.status]));

    for (const customerId of customerIds) {
      const status = rowMap.get(customerId);
      if (!status) {
        throw AppError.badRequest(`客户 #${customerId} 不存在`);
      }
      if (status !== 'active') {
        throw AppError.badRequest(`客户 #${customerId} 已停用，不能绑定 SKU`);
      }
    }

    if (brandScope === 'customer' && brandCustomerId) {
      for (const ref of customerRefs) {
        if (ref.customerId !== brandCustomerId) {
          throw AppError.badRequest('客户专属 SKU 只能维护所属客户的客户编码映射');
        }
      }
    }
  }

  private async isFinishedCategory(category1Id: number): Promise<boolean> {
    const [row] = await AppDataSource.query<Array<{ code: string }>>(
      'SELECT code FROM sku_categories WHERE id = ? LIMIT 1',
      [category1Id],
    );
    return row?.code === FINISHED_CATEGORY_CODE;
  }

  private normalizeControlConfig(
    params: Partial<CreateSkuParams>,
    category1Code: string | null,
    current?: {
      businessClass?: SkuBusinessClass;
      controlMode?: SkuControlMode;
      allowBomComponent?: boolean;
      allowPurchase?: boolean;
      allowInventory?: boolean;
      allowProductionIssue?: boolean;
      requiresAssetAcceptance?: boolean;
      defaultWarehouseType?: string | null;
      approvalPolicyCode?: string | null;
      assetTrackingMode?: SkuAssetTrackingMode;
    },
  ): {
    businessClass: SkuBusinessClass;
    controlMode: SkuControlMode;
    allowBomComponent: boolean;
    allowPurchase: boolean;
    allowInventory: boolean;
    allowProductionIssue: boolean;
    requiresAssetAcceptance: boolean;
    defaultWarehouseType: string | null;
    approvalPolicyCode: string | null;
    assetTrackingMode: SkuAssetTrackingMode;
  } {
    const resolvedBusinessClass = params.businessClass
      ?? current?.businessClass
      ?? (category1Code === 'PACKING' ? 'consumable' : 'production_material');

    const finishedDefaults = category1Code === FINISHED_CATEGORY_CODE;

    const defaultsByClass: Record<SkuBusinessClass, {
      controlMode: SkuControlMode;
      allowBomComponent: boolean;
      allowPurchase: boolean;
      allowInventory: boolean;
      allowProductionIssue: boolean;
      requiresAssetAcceptance: boolean;
      defaultWarehouseType: string | null;
      assetTrackingMode: SkuAssetTrackingMode;
    }> = {
      production_material: {
        controlMode: 'mrp',
        allowBomComponent: !finishedDefaults,
        allowPurchase: !finishedDefaults,
        allowInventory: true,
        allowProductionIssue: !finishedDefaults,
        defaultWarehouseType: finishedDefaults ? 'finished' : 'raw_material',
        requiresAssetAcceptance: false,
        assetTrackingMode: 'none',
      },
      consumable: {
        controlMode: 'stock_only',
        allowBomComponent: false,
        allowPurchase: true,
        allowInventory: true,
        allowProductionIssue: false,
        defaultWarehouseType: 'consumable',
        requiresAssetAcceptance: false,
        assetTrackingMode: 'none',
      },
      fixed_asset: {
        controlMode: 'asset',
        allowBomComponent: false,
        allowPurchase: true,
        allowInventory: false,
        allowProductionIssue: false,
        defaultWarehouseType: 'asset_pending',
        requiresAssetAcceptance: true,
        assetTrackingMode: 'serial',
      },
    };

    const defaults = defaultsByClass[resolvedBusinessClass];

    return {
      businessClass: resolvedBusinessClass,
      controlMode: params.controlMode ?? current?.controlMode ?? defaults.controlMode,
      allowBomComponent: params.allowBomComponent ?? current?.allowBomComponent ?? defaults.allowBomComponent,
      allowPurchase: params.allowPurchase ?? current?.allowPurchase ?? defaults.allowPurchase,
      allowInventory: params.allowInventory ?? current?.allowInventory ?? defaults.allowInventory,
      allowProductionIssue: params.allowProductionIssue ?? current?.allowProductionIssue ?? defaults.allowProductionIssue,
      requiresAssetAcceptance: params.requiresAssetAcceptance ?? current?.requiresAssetAcceptance ?? defaults.requiresAssetAcceptance,
      defaultWarehouseType: params.defaultWarehouseType ?? current?.defaultWarehouseType ?? defaults.defaultWarehouseType,
      approvalPolicyCode: params.approvalPolicyCode ?? current?.approvalPolicyCode ?? null,
      assetTrackingMode: params.assetTrackingMode ?? current?.assetTrackingMode ?? defaults.assetTrackingMode,
    };
  }

  private async syncProfilesByBusinessClass(
    skuId: number,
    businessClass: SkuBusinessClass,
    params: Partial<CreateSkuParams>,
  ): Promise<void> {
    await this.repo.deleteProfilesForBusinessClass(skuId, businessClass);

    if (businessClass === 'consumable' && params.consumableProfile) {
      await this.repo.upsertConsumableProfile(skuId, params.consumableProfile);
    }

    if (businessClass === 'fixed_asset' && params.assetProfile) {
      await this.repo.upsertAssetProfile(skuId, params.assetProfile);
    }
  }
}
