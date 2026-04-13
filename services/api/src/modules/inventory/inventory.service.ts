import Decimal from 'decimal.js';
import { parse as parseCsv } from 'csv-parse/sync';
import { AppDataSource } from '../../config/database';
import { TenantContext } from '../../shared/BaseRepository';
import { AppError } from '../../shared/AppError';
import { ResponseCode } from '../../shared/ApiResponse';
import { acquireLock, releaseLock, RedisKeys, RedisTTL, getRedisClient } from '../../config/redis';
import { PermissionSnapshot } from '../access-control/access-control.types';
import {
  assertWarehouseInScope,
  resolveWarehouseDataScope,
  type WarehouseDataScope,
} from '../access-control/warehouse-data-scope';
import { UnitConverter } from '../../shared/unitConverter';
import { DyeLotAuthorizeService } from './dyeLotAuthorize.service';
import {
  ensureDefaultWarehouseLocation as ensureDefaultWarehouseLocationBinding,
  resolveWarehouseLocationBinding,
} from './warehouse-location.resolver';
import {
  rebuildInventoryDailySnapshotsForScope,
  syncInventoryDailySnapshotForSku,
} from './daily-snapshot.util';

// ─── 类型定义 ──────────────────────────────────────────────────

export type TransactionType =
  | 'PURCHASE_IN' | 'PRODUCTION_IN' | 'ADJUSTMENT_IN'
  | 'CONSUMABLE_IN'
  | 'MATERIAL_OUT' | 'DELIVERY_OUT' | 'ADJUSTMENT_OUT' | 'CONSUMABLE_OUT'
  | 'STOCKTAKE_ADJUST' | 'CONSUMABLE_ADJUST';

export interface InboundParams {
  skuId?: number;
  skuCode?: string;
  warehouseId?: number;
  locationId?: number;
  qtyInput: string;
  inputUnit: string;
  transactionType: Extract<TransactionType, 'PURCHASE_IN' | 'PRODUCTION_IN' | 'ADJUSTMENT_IN'>;
  dyeLotNo?: string;
  referenceType?: string;
  referenceId?: number;
  referenceNo?: string;
  batchCost?: string;
  notes?: string;
}

export interface OutboundParams {
  skuId: number;
  warehouseId?: number;
  locationId?: number;
  qtyInput: string;
  inputUnit: string;
  transactionType: Extract<TransactionType, 'MATERIAL_OUT' | 'DELIVERY_OUT' | 'ADJUSTMENT_OUT' | 'CONSUMABLE_OUT'>;
  dyeLotNo?: string;
  productionOrderId?: number;   // 用于缸号一致性校验
  authorizeId?: number;         // 跨色号授权申请ID（RISK-005）
  referenceType?: string;
  referenceId?: number;
  referenceNo?: string;
  notes?: string;
}

export interface DyeLotDetail {
  dyeLotNo: string;
  qtyOnHand: string;
  qtyReserved: string;
  qtyAvailable: string;
  firstInAt: Date;
  lastInAt: Date;
}

export interface InventorySnapshot {
  skuId: number;
  skuCode: string;
  skuName: string;
  qtyOnHand: string;
  qtyReserved: string;
  qtyInTransit: string;
  qtyAvailable: string;
  stockUnit: string;
  purchaseUnit?: string | null;
  stockConvFactor?: string | number | null;
  safetyStock: string;
  isBelowSafety: boolean;
  hasDyeLot: boolean;
  warehouseId?: number | null;
  warehouseCode?: string | null;
  warehouseName?: string | null;
  locationId?: number | null;
  locationCode?: string | null;
  locationName?: string | null;
  isDefaultLocation?: boolean;
  dyeLots?: DyeLotDetail[];
}

interface WarehouseLocationBinding {
  warehouseId: number;
  locationId: number;
  warehouseCode: string;
  locationCode: string;
  warningCode: string | null;
}

export interface WarehouseOption {
  id: number;
  code: string;
  name: string;
  type: string | null;
  plantCode: string | null;
  status: string;
}

export interface LocationOption {
  id: number;
  warehouseId: number;
  code: string;
  name: string;
  locationType: LocationType;
  aisleCode: string | null;
  rackCode: string | null;
  shelfCode: string | null;
  binCode: string | null;
  level: number;
  status: string;
}

export type MasterDataStatus = 'active' | 'inactive' | 'locked' | 'archived';
export type LocationType = 'general' | 'zone' | 'rack' | 'shelf' | 'bin';

export interface CreateWarehouseParams {
  code: string;
  name: string;
  type?: string;
  plantCode?: string;
  status: MasterDataStatus;
}

export interface UpdateWarehouseParams {
  code?: string;
  name?: string;
  type?: string;
  plantCode?: string;
  status?: MasterDataStatus;
}

export interface CreateLocationParams {
  warehouseId: number;
  code: string;
  name: string;
  locationType: LocationType;
  aisleCode?: string;
  rackCode?: string;
  shelfCode?: string;
  binCode?: string;
  level: number;
  parentId?: number;
  status: MasterDataStatus;
}

export interface UpdateLocationParams {
  warehouseId?: number;
  code?: string;
  name?: string;
  locationType?: LocationType;
  aisleCode?: string;
  rackCode?: string;
  shelfCode?: string;
  binCode?: string;
  level?: number;
  parentId?: number | null;
  status?: MasterDataStatus;
}

export interface MasterDataImportFailure {
  rowNo: number;
  reason: string;
  row: Record<string, string>;
}

export interface WarehouseCsvImportResult {
  totalRows: number;
  successCount: number;
  failCount: number;
  failures: MasterDataImportFailure[];
}

export interface LocationCsvImportResult {
  totalRows: number;
  successCount: number;
  failCount: number;
  failures: MasterDataImportFailure[];
}

export interface DailyInventorySnapshotRow {
  snapshotDate: string;
  warehouseId: number;
  warehouseCode: string | null;
  warehouseName: string | null;
  skuId: number;
  skuCode: string;
  skuName: string;
  stockUnit: string;
  qtyOnHand: string;
  qtyReserved: string;
  qtyAvailable: string;
}

export interface RebuildInventorySnapshotParams {
  snapshotDate?: string;
  skuId?: number;
  skuIds?: number[];
  dryRun?: boolean;
}

export interface ReconcileInventoryParams {
  skuId?: number;
  skuIds?: number[];
  dryRun?: boolean;
  includeReserved?: boolean;
  includeInTransit?: boolean;
}

export interface RepairInventoryParams extends ReconcileInventoryParams {
  snapshotDate?: string;
}

export interface DailyInventorySnapshotFilter {
  snapshotDate?: string;
  skuId?: number;
  warehouseId?: number;
  keyword?: string;
  page: number;
  pageSize: number;
}

export interface InventoryReconcileItem {
  skuId: number;
  currentQtyOnHand: string;
  expectedQtyOnHand: string;
  deltaQtyOnHand: string;
  currentQtyReserved: string;
  expectedQtyReserved: string | null;
  deltaQtyReserved: string | null;
  currentQtyInTransit: string;
  expectedQtyInTransit: string | null;
  deltaQtyInTransit: string | null;
}

type InventoryQueryRunner = { query: typeof AppDataSource.query };

interface InventoryScope {
  targetSkuIds: number[];
  hasSkuFilter: boolean;
  whereSql: string;
  whereParams: unknown[];
}

type InventoryTrackedQueryRunner = InventoryQueryRunner & {
  __inventorySnapshotSkuIds?: Set<number>;
};

const MASTER_DATA_STATUS = new Set(['active', 'inactive', 'locked', 'archived']);
const LOCATION_TYPES = new Set(['general', 'zone', 'rack', 'shelf', 'bin']);

// ─── Inventory Service ─────────────────────────────────────────

export class InventoryService {
  private readonly tenantId: number;
  private readonly userId: number;
  private readonly actionCodes: string[];
  private readonly permissionSnapshot?: PermissionSnapshot;
  private warehouseDataScopePromise: Promise<WarehouseDataScope> | null = null;

  constructor(ctx: TenantContext & { permissionSnapshot?: PermissionSnapshot }) {
    this.tenantId = ctx.tenantId;
    this.userId   = ctx.userId;
    this.actionCodes = ctx.actionCodes ?? [];
    this.permissionSnapshot = ctx.permissionSnapshot;
  }

  private async getWarehouseDataScope(): Promise<WarehouseDataScope> {
    this.warehouseDataScopePromise ??= resolveWarehouseDataScope(this.tenantId, this.permissionSnapshot);
    return this.warehouseDataScopePromise;
  }

  private buildInventoryScope(params: { skuId?: number; skuIds?: number[] }): InventoryScope {
    const normalizedSkuIds = params.skuIds
      ? Array.from(new Set(params.skuIds)).sort((a, b) => a - b)
      : [];

    if (params.skuId && normalizedSkuIds.length > 0) {
      throw AppError.badRequest('skuId 和 skuIds 不能同时传入');
    }

    const targetSkuIds = params.skuId
      ? [params.skuId]
      : normalizedSkuIds;
    const hasSkuFilter = targetSkuIds.length > 0;
    const singleSku = targetSkuIds.length === 1;
    const skuPlaceholders = targetSkuIds.map(() => '?').join(', ');
    const whereSql = !hasSkuFilter
      ? 'tenant_id = ?'
      : singleSku
        ? 'tenant_id = ? AND sku_id = ?'
        : `tenant_id = ? AND sku_id IN (${skuPlaceholders})`;
    const whereParams = !hasSkuFilter
      ? [this.tenantId]
      : singleSku
        ? [this.tenantId, targetSkuIds[0]]
        : [this.tenantId, ...targetSkuIds];

    return {
      targetSkuIds,
      hasSkuFilter,
      whereSql,
      whereParams,
    };
  }

  private async ensureDefaultWarehouseLocation(
    manager: InventoryQueryRunner,
  ): Promise<{ warehouseId: number; locationId: number; warehouseCode: string; locationCode: string }> {
    return ensureDefaultWarehouseLocationBinding(manager, this.tenantId);
  }

  private async resolveWarehouseLocation(
    manager: InventoryQueryRunner,
    params: { warehouseId?: number; locationId?: number },
    sourceRef: string,
  ): Promise<WarehouseLocationBinding> {
    return resolveWarehouseLocationBinding({
      manager,
      tenantId: this.tenantId,
      userId: this.userId,
      warehouseId: params.warehouseId,
      locationId: params.locationId,
      sourceRef,
    });
  }

  private normalizeLocationType(value?: string | null): LocationType {
    const normalized = String(value ?? '').trim().toLowerCase();
    return LOCATION_TYPES.has(normalized) ? (normalized as LocationType) : 'general';
  }

  private normalizeLocationCoord(value?: string | null): string | null {
    const normalized = String(value ?? '').trim().toUpperCase();
    return normalized ? normalized : null;
  }

  async listWarehouses(onlyActive = true): Promise<WarehouseOption[]> {
    const warehouseScope = await this.getWarehouseDataScope();
    if (warehouseScope.mode === 'none') {
      return [];
    }

    const conditions = ['tenant_id = ?'];
    const params: Array<string | number> = [this.tenantId];
    if (onlyActive) {
      conditions.push("status = 'active'");
    }
    if (warehouseScope.mode === 'assigned') {
      conditions.push(`id IN (${warehouseScope.warehouseIds.map(() => '?').join(',')})`);
      params.push(...warehouseScope.warehouseIds);
    }

    const rows = await AppDataSource.query<Array<WarehouseOption>>(
      `SELECT
         id,
         code,
         name,
         type,
         plant_code AS plantCode,
         status
       FROM warehouses
       WHERE ${conditions.join(' AND ')}
       ORDER BY code ASC`,
      params,
    );
    return rows.map((row) => ({
      id: Number(row.id),
      code: row.code,
      name: row.name,
      type: row.type ?? null,
      plantCode: row.plantCode ?? null,
      status: row.status,
    }));
  }

  async listLocations(params: { warehouseId?: number; onlyActive?: boolean }): Promise<LocationOption[]> {
    const warehouseScope = await this.getWarehouseDataScope();
    if (warehouseScope.mode === 'none') {
      return [];
    }
    if (warehouseScope.mode === 'assigned' && params.warehouseId && !warehouseScope.warehouseIds.includes(params.warehouseId)) {
      return [];
    }

    const conditions = ['tenant_id = ?'];
    const q: Array<string | number> = [this.tenantId];
    if (params.warehouseId) {
      conditions.push('warehouse_id = ?');
      q.push(params.warehouseId);
    } else if (warehouseScope.mode === 'assigned') {
      conditions.push(`warehouse_id IN (${warehouseScope.warehouseIds.map(() => '?').join(',')})`);
      q.push(...warehouseScope.warehouseIds);
    }
    if (params.onlyActive ?? true) {
      conditions.push("status = 'active'");
    }

    const rows = await AppDataSource.query<Array<LocationOption>>(
      `SELECT
         id,
         warehouse_id AS warehouseId,
         code,
         name,
         location_type AS locationType,
         aisle_code AS aisleCode,
         rack_code AS rackCode,
         shelf_code AS shelfCode,
         bin_code AS binCode,
         level,
         status
       FROM locations
       WHERE ${conditions.join(' AND ')}
       ORDER BY warehouse_id ASC, code ASC`,
      q,
    );

    return rows.map((row) => ({
      id: Number(row.id),
      warehouseId: Number(row.warehouseId),
      code: row.code,
      name: row.name,
      locationType: this.normalizeLocationType(row.locationType),
      aisleCode: row.aisleCode ?? null,
      rackCode: row.rackCode ?? null,
      shelfCode: row.shelfCode ?? null,
      binCode: row.binCode ?? null,
      level: Number(row.level),
      status: row.status,
    }));
  }

  async createWarehouse(params: CreateWarehouseParams): Promise<WarehouseOption> {
    const code = params.code.trim().toUpperCase();
    const name = params.name.trim();
    const type = params.type?.trim() ? params.type.trim() : null;
    const plantCode = params.plantCode?.trim() ? params.plantCode.trim() : null;

    const [exists] = await AppDataSource.query<Array<{ id: number }>>(
      `SELECT id
       FROM warehouses
       WHERE tenant_id = ? AND code = ?
       LIMIT 1`,
      [this.tenantId, code],
    );
    if (exists) {
      throw AppError.conflict(`仓库编码 ${code} 已存在`);
    }

    const insertMeta = await AppDataSource.query(
      `INSERT INTO warehouses
         (tenant_id, code, name, type, plant_code, status, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [this.tenantId, code, name, type, plantCode, params.status, this.userId, this.userId],
    ) as unknown as { insertId?: number };

    const id = Number(insertMeta.insertId ?? 0);
    const [row] = await AppDataSource.query<Array<WarehouseOption>>(
      `SELECT id, code, name, type, plant_code AS plantCode, status
       FROM warehouses
       WHERE tenant_id = ? AND id = ?
       LIMIT 1`,
      [this.tenantId, id],
    );
    if (!row) {
      throw AppError.badRequest('仓库创建失败');
    }

    return {
      id: Number(row.id),
      code: row.code,
      name: row.name,
      type: row.type ?? null,
      plantCode: row.plantCode ?? null,
      status: row.status,
    };
  }

  async updateWarehouse(id: number, params: UpdateWarehouseParams): Promise<WarehouseOption> {
    const [existing] = await AppDataSource.query<Array<{
      id: number;
      code: string;
      name: string;
      type: string | null;
      plantCode: string | null;
      status: MasterDataStatus;
    }>>(
      `SELECT
         id,
         code,
         name,
         type,
         plant_code AS plantCode,
         status
       FROM warehouses
       WHERE tenant_id = ? AND id = ?
       LIMIT 1`,
      [this.tenantId, id],
    );
    if (!existing) {
      throw AppError.notFound('仓库不存在');
    }

    const nextCode = params.code ? params.code.trim().toUpperCase() : existing.code;
    const nextName = params.name ? params.name.trim() : existing.name;
    const nextType = params.type !== undefined ? (params.type.trim() ? params.type.trim() : null) : existing.type;
    const nextPlantCode = params.plantCode !== undefined
      ? (params.plantCode.trim() ? params.plantCode.trim() : null)
      : existing.plantCode;
    const nextStatus = params.status ?? existing.status;

    if (existing.code === 'DEFAULT') {
      if (nextCode !== 'DEFAULT') {
        throw AppError.badRequest('默认仓库编码不可修改');
      }
      if (nextStatus !== 'active') {
        throw AppError.badRequest('默认仓库状态不可修改为非启用');
      }
    }

    if (nextCode !== existing.code) {
      const [dup] = await AppDataSource.query<Array<{ id: number }>>(
        `SELECT id
         FROM warehouses
         WHERE tenant_id = ? AND code = ? AND id <> ?
         LIMIT 1`,
        [this.tenantId, nextCode, id],
      );
      if (dup) {
        throw AppError.conflict(`仓库编码 ${nextCode} 已存在`);
      }
    }

    await AppDataSource.query(
      `UPDATE warehouses
       SET code = ?, name = ?, type = ?, plant_code = ?, status = ?, updated_by = ?
       WHERE tenant_id = ? AND id = ?`,
      [nextCode, nextName, nextType, nextPlantCode, nextStatus, this.userId, this.tenantId, id],
    );

    return {
      id: Number(existing.id),
      code: nextCode,
      name: nextName,
      type: nextType,
      plantCode: nextPlantCode,
      status: nextStatus,
    };
  }

  async deleteWarehouse(id: number): Promise<{ id: number }> {
    const [existing] = await AppDataSource.query<Array<{ id: number; code: string }>>(
      `SELECT id, code
       FROM warehouses
       WHERE tenant_id = ? AND id = ?
       LIMIT 1`,
      [this.tenantId, id],
    );
    if (!existing) {
      throw AppError.notFound('仓库不存在');
    }
    if (existing.code === 'DEFAULT') {
      throw AppError.badRequest('默认仓库不可删除');
    }

    const [locationRef] = await AppDataSource.query<Array<{ cnt: number }>>(
      `SELECT COUNT(1) AS cnt
       FROM locations
       WHERE tenant_id = ? AND warehouse_id = ?`,
      [this.tenantId, id],
    );
    if (Number(locationRef?.cnt ?? 0) > 0) {
      throw AppError.badRequest('该仓库下存在库位，请先删除或迁移库位');
    }

    const [inventoryRef] = await AppDataSource.query<Array<{ cnt: number }>>(
      `SELECT COUNT(1) AS cnt
       FROM inventory
       WHERE tenant_id = ? AND warehouse_id = ?`,
      [this.tenantId, id],
    );
    if (Number(inventoryRef?.cnt ?? 0) > 0) {
      throw AppError.badRequest('该仓库已被库存记录引用，无法删除');
    }

    const [txRef] = await AppDataSource.query<Array<{ cnt: number }>>(
      `SELECT COUNT(1) AS cnt
       FROM inventory_transactions
       WHERE tenant_id = ? AND warehouse_id = ?`,
      [this.tenantId, id],
    );
    if (Number(txRef?.cnt ?? 0) > 0) {
      throw AppError.badRequest('该仓库已被库存流水引用，无法删除');
    }

    await AppDataSource.query(
      `DELETE FROM warehouses
       WHERE tenant_id = ? AND id = ?`,
      [this.tenantId, id],
    );

    return { id };
  }

  async createLocation(params: CreateLocationParams): Promise<LocationOption> {
    const code = params.code.trim().toUpperCase();
    const name = params.name.trim();
    const locationType = this.normalizeLocationType(params.locationType);
    const aisleCode = this.normalizeLocationCoord(params.aisleCode);
    const rackCode = this.normalizeLocationCoord(params.rackCode);
    const shelfCode = this.normalizeLocationCoord(params.shelfCode);
    const binCode = this.normalizeLocationCoord(params.binCode);

    const [warehouse] = await AppDataSource.query<Array<{ id: number; status: string }>>(
      `SELECT id, status
       FROM warehouses
       WHERE tenant_id = ? AND id = ?
       LIMIT 1`,
      [this.tenantId, params.warehouseId],
    );
    if (!warehouse) {
      throw AppError.badRequest('仓库不存在');
    }

    if (params.parentId) {
      const [parent] = await AppDataSource.query<Array<{ id: number }>>(
        `SELECT id
         FROM locations
         WHERE tenant_id = ? AND warehouse_id = ? AND id = ?
         LIMIT 1`,
        [this.tenantId, params.warehouseId, params.parentId],
      );
      if (!parent) {
        throw AppError.badRequest('父级库位不存在');
      }
    }

    const [dup] = await AppDataSource.query<Array<{ id: number }>>(
      `SELECT id
       FROM locations
       WHERE tenant_id = ? AND warehouse_id = ? AND code = ?
       LIMIT 1`,
      [this.tenantId, params.warehouseId, code],
    );
    if (dup) {
      throw AppError.conflict(`库位编码 ${code} 已存在`);
    }

    const insertMeta = await AppDataSource.query(
      `INSERT INTO locations
         (tenant_id, warehouse_id, code, name, location_type, aisle_code, rack_code, shelf_code, bin_code, level, parent_id, status, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        this.tenantId,
        params.warehouseId,
        code,
        name,
        locationType,
        aisleCode,
        rackCode,
        shelfCode,
        binCode,
        params.level,
        params.parentId ?? null,
        params.status,
        this.userId,
        this.userId,
      ],
    ) as unknown as { insertId?: number };

    const id = Number(insertMeta.insertId ?? 0);
    const [row] = await AppDataSource.query<Array<LocationOption>>(
      `SELECT
         id,
         warehouse_id AS warehouseId,
         code,
         name,
         location_type AS locationType,
         aisle_code AS aisleCode,
         rack_code AS rackCode,
         shelf_code AS shelfCode,
         bin_code AS binCode,
         level,
         status
       FROM locations
       WHERE tenant_id = ? AND id = ?
       LIMIT 1`,
      [this.tenantId, id],
    );
    if (!row) {
      throw AppError.badRequest('库位创建失败');
    }

    return {
      id: Number(row.id),
      warehouseId: Number(row.warehouseId),
      code: row.code,
      name: row.name,
      locationType: this.normalizeLocationType(row.locationType),
      aisleCode: row.aisleCode ?? null,
      rackCode: row.rackCode ?? null,
      shelfCode: row.shelfCode ?? null,
      binCode: row.binCode ?? null,
      level: Number(row.level),
      status: row.status,
    };
  }

  async updateLocation(id: number, params: UpdateLocationParams): Promise<LocationOption> {
    const [existing] = await AppDataSource.query<Array<{
      id: number;
      warehouseId: number;
      code: string;
      name: string;
      locationType: LocationType;
      aisleCode: string | null;
      rackCode: string | null;
      shelfCode: string | null;
      binCode: string | null;
      level: number;
      parentId: number | null;
      status: MasterDataStatus;
    }>>(
      `SELECT
         id,
         warehouse_id AS warehouseId,
         code,
         name,
         location_type AS locationType,
         aisle_code AS aisleCode,
         rack_code AS rackCode,
         shelf_code AS shelfCode,
         bin_code AS binCode,
         level,
         parent_id AS parentId,
         status
       FROM locations
       WHERE tenant_id = ? AND id = ?
       LIMIT 1`,
      [this.tenantId, id],
    );
    if (!existing) {
      throw AppError.notFound('库位不存在');
    }

    const nextWarehouseId = params.warehouseId ?? Number(existing.warehouseId);
    const nextCode = params.code ? params.code.trim().toUpperCase() : existing.code;
    const nextName = params.name ? params.name.trim() : existing.name;
    const nextLocationType = params.locationType
      ? this.normalizeLocationType(params.locationType)
      : this.normalizeLocationType(existing.locationType);
    const nextAisleCode = params.aisleCode !== undefined
      ? this.normalizeLocationCoord(params.aisleCode)
      : (existing.aisleCode ?? null);
    const nextRackCode = params.rackCode !== undefined
      ? this.normalizeLocationCoord(params.rackCode)
      : (existing.rackCode ?? null);
    const nextShelfCode = params.shelfCode !== undefined
      ? this.normalizeLocationCoord(params.shelfCode)
      : (existing.shelfCode ?? null);
    const nextBinCode = params.binCode !== undefined
      ? this.normalizeLocationCoord(params.binCode)
      : (existing.binCode ?? null);
    const nextLevel = params.level ?? Number(existing.level);
    const nextParentId = params.parentId === undefined ? existing.parentId : params.parentId;
    const nextStatus = params.status ?? existing.status;

    if (existing.code === 'DEFAULT-UNKNOWN') {
      if (nextCode !== 'DEFAULT-UNKNOWN') {
        throw AppError.badRequest('默认库位编码不可修改');
      }
      if (nextStatus !== 'active') {
        throw AppError.badRequest('默认库位状态不可修改为非启用');
      }
    }

    const [warehouse] = await AppDataSource.query<Array<{ id: number }>>(
      `SELECT id
       FROM warehouses
       WHERE tenant_id = ? AND id = ?
       LIMIT 1`,
      [this.tenantId, nextWarehouseId],
    );
    if (!warehouse) {
      throw AppError.badRequest('仓库不存在');
    }

    if (nextParentId !== null && nextParentId !== undefined) {
      if (Number(nextParentId) === id) {
        throw AppError.badRequest('父级库位不能是自身');
      }
      const [parent] = await AppDataSource.query<Array<{ id: number }>>(
        `SELECT id
         FROM locations
         WHERE tenant_id = ? AND warehouse_id = ? AND id = ?
         LIMIT 1`,
        [this.tenantId, nextWarehouseId, nextParentId],
      );
      if (!parent) {
        throw AppError.badRequest('父级库位不存在');
      }
    }

    if (nextCode !== existing.code || nextWarehouseId !== Number(existing.warehouseId)) {
      const [dup] = await AppDataSource.query<Array<{ id: number }>>(
        `SELECT id
         FROM locations
         WHERE tenant_id = ? AND warehouse_id = ? AND code = ? AND id <> ?
         LIMIT 1`,
        [this.tenantId, nextWarehouseId, nextCode, id],
      );
      if (dup) {
        throw AppError.conflict(`库位编码 ${nextCode} 已存在`);
      }
    }

    await AppDataSource.query(
      `UPDATE locations
       SET warehouse_id = ?, code = ?, name = ?, location_type = ?, aisle_code = ?, rack_code = ?, shelf_code = ?, bin_code = ?, level = ?, parent_id = ?, status = ?, updated_by = ?
       WHERE tenant_id = ? AND id = ?`,
      [
        nextWarehouseId,
        nextCode,
        nextName,
        nextLocationType,
        nextAisleCode,
        nextRackCode,
        nextShelfCode,
        nextBinCode,
        nextLevel,
        nextParentId ?? null,
        nextStatus,
        this.userId,
        this.tenantId,
        id,
      ],
    );

    return {
      id: Number(existing.id),
      warehouseId: nextWarehouseId,
      code: nextCode,
      name: nextName,
      locationType: nextLocationType,
      aisleCode: nextAisleCode,
      rackCode: nextRackCode,
      shelfCode: nextShelfCode,
      binCode: nextBinCode,
      level: nextLevel,
      status: nextStatus,
    };
  }

  async deleteLocation(id: number): Promise<{ id: number }> {
    const [existing] = await AppDataSource.query<Array<{ id: number; code: string }>>(
      `SELECT id, code
       FROM locations
       WHERE tenant_id = ? AND id = ?
       LIMIT 1`,
      [this.tenantId, id],
    );
    if (!existing) {
      throw AppError.notFound('库位不存在');
    }
    if (existing.code === 'DEFAULT-UNKNOWN') {
      throw AppError.badRequest('默认库位不可删除');
    }

    const [children] = await AppDataSource.query<Array<{ cnt: number }>>(
      `SELECT COUNT(1) AS cnt
       FROM locations
       WHERE tenant_id = ? AND parent_id = ?`,
      [this.tenantId, id],
    );
    if (Number(children?.cnt ?? 0) > 0) {
      throw AppError.badRequest('该库位存在下级库位，无法删除');
    }

    const [inventoryRef] = await AppDataSource.query<Array<{ cnt: number }>>(
      `SELECT COUNT(1) AS cnt
       FROM inventory
       WHERE tenant_id = ? AND location_id = ?`,
      [this.tenantId, id],
    );
    if (Number(inventoryRef?.cnt ?? 0) > 0) {
      throw AppError.badRequest('该库位已被库存记录引用，无法删除');
    }

    const [txRef] = await AppDataSource.query<Array<{ cnt: number }>>(
      `SELECT COUNT(1) AS cnt
       FROM inventory_transactions
       WHERE tenant_id = ? AND location_id = ?`,
      [this.tenantId, id],
    );
    if (Number(txRef?.cnt ?? 0) > 0) {
      throw AppError.badRequest('该库位已被库存流水引用，无法删除');
    }

    await AppDataSource.query(
      `DELETE FROM locations
       WHERE tenant_id = ? AND id = ?`,
      [this.tenantId, id],
    );

    return { id };
  }

  generateWarehouseImportTemplateCsv(): string {
    return [
      'code,name,type,plantCode,status',
      'WH-MAIN,主仓库,physical,PLANT-01,active',
      'WH-RM,原料仓,raw_material,PLANT-01,active',
    ].join('\n');
  }

  generateLocationImportTemplateCsv(): string {
    return [
      'warehouseCode,code,name,locationType,aisleCode,rackCode,shelfCode,binCode,level,parentCode,status',
      'WH-MAIN,A,主仓A区,zone,,,,,1,,active',
      'WH-MAIN,A-01-02-03,A区1排2架3层,shelf,A,01,02,03,3,A,active',
    ].join('\n');
  }

  async importWarehousesFromCsv(fileBuffer: Buffer): Promise<WarehouseCsvImportResult> {
    const rows = this.parseCsvRows(fileBuffer);
    const failures: MasterDataImportFailure[] = [];
    const seenCode = new Set<string>();
    const validRows: Array<{
      rowNo: number;
      code: string;
      name: string;
      type: string | null;
      plantCode: string | null;
      status: string;
      raw: Record<string, string>;
    }> = [];

    rows.forEach((row, idx) => {
      const rowNo = idx + 2;
      const code = this.pickCsvValue(row, ['code', '仓库编码']).trim();
      const name = this.pickCsvValue(row, ['name', '仓库名称']).trim();
      const type = this.pickCsvValue(row, ['type', '仓库类型']).trim();
      const plantCode = this.pickCsvValue(row, ['plantCode', '厂区编码']).trim();
      const statusInput = this.pickCsvValue(row, ['status', '状态']).trim();
      const status = (statusInput || 'active').toLowerCase();
      const normalizedCode = code.toUpperCase();

      if (!code) {
        failures.push({ rowNo, reason: '仓库编码不能为空', row });
        return;
      }
      if (!name) {
        failures.push({ rowNo, reason: '仓库名称不能为空', row });
        return;
      }
      if (!MASTER_DATA_STATUS.has(status)) {
        failures.push({ rowNo, reason: `仓库状态非法: ${statusInput}`, row });
        return;
      }
      if (seenCode.has(normalizedCode)) {
        failures.push({ rowNo, reason: `仓库编码重复: ${code}`, row });
        return;
      }
      seenCode.add(normalizedCode);
      validRows.push({
        rowNo,
        code,
        name,
        type: type || null,
        plantCode: plantCode || null,
        status,
        raw: row,
      });
    });

    if (validRows.length > 0) {
      await AppDataSource.transaction(async (manager) => {
        for (const row of validRows) {
          await manager.query(
            `INSERT INTO warehouses
               (tenant_id, code, name, type, plant_code, status, created_by, updated_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
               name = VALUES(name),
               type = VALUES(type),
               plant_code = VALUES(plant_code),
               status = VALUES(status),
               updated_by = VALUES(updated_by)`,
            [
              this.tenantId,
              row.code,
              row.name,
              row.type,
              row.plantCode,
              row.status,
              this.userId,
              this.userId,
            ],
          );
        }
      });
    }

    return {
      totalRows: rows.length,
      successCount: validRows.length,
      failCount: failures.length,
      failures,
    };
  }

  async importLocationsFromCsv(fileBuffer: Buffer): Promise<LocationCsvImportResult> {
    const rows = this.parseCsvRows(fileBuffer);
    const failures: MasterDataImportFailure[] = [];
    const validRows: Array<{
      rowNo: number;
      warehouseCode: string;
      code: string;
      name: string;
      locationType: LocationType;
      aisleCode: string | null;
      rackCode: string | null;
      shelfCode: string | null;
      binCode: string | null;
      level: number;
      parentCode: string | null;
      status: string;
      raw: Record<string, string>;
    }> = [];
    const seenKey = new Set<string>();

    rows.forEach((row, idx) => {
      const rowNo = idx + 2;
      const warehouseCode = this.pickCsvValue(row, ['warehouseCode', '仓库编码']).trim();
      const code = this.pickCsvValue(row, ['code', '库位编码']).trim();
      const name = this.pickCsvValue(row, ['name', '库位名称']).trim();
      const locationTypeInput = this.pickCsvValue(row, ['locationType', '库位类型']).trim().toLowerCase();
      const aisleCode = this.normalizeLocationCoord(this.pickCsvValue(row, ['aisleCode', '巷道编码']).trim());
      const rackCode = this.normalizeLocationCoord(this.pickCsvValue(row, ['rackCode', '货架编码']).trim());
      const shelfCode = this.normalizeLocationCoord(this.pickCsvValue(row, ['shelfCode', '层编码']).trim());
      const binCode = this.normalizeLocationCoord(this.pickCsvValue(row, ['binCode', '格口编码']).trim());
      const levelInput = this.pickCsvValue(row, ['level', '层级']).trim();
      const parentCodeInput = this.pickCsvValue(row, ['parentCode', '父级库位编码']).trim();
      const statusInput = this.pickCsvValue(row, ['status', '状态']).trim();
      const status = (statusInput || 'active').toLowerCase();
      const locationType = this.normalizeLocationType(locationTypeInput || 'general');
      const level = levelInput ? Number(levelInput) : 1;
      const key = `${warehouseCode.toUpperCase()}::${code.toUpperCase()}`;

      if (!warehouseCode) {
        failures.push({ rowNo, reason: '仓库编码不能为空', row });
        return;
      }
      if (!code) {
        failures.push({ rowNo, reason: '库位编码不能为空', row });
        return;
      }
      if (!name) {
        failures.push({ rowNo, reason: '库位名称不能为空', row });
        return;
      }
      if (!Number.isInteger(level) || level <= 0) {
        failures.push({ rowNo, reason: `层级非法: ${levelInput}`, row });
        return;
      }
      if (!MASTER_DATA_STATUS.has(status)) {
        failures.push({ rowNo, reason: `库位状态非法: ${statusInput}`, row });
        return;
      }
      if (locationTypeInput && !LOCATION_TYPES.has(locationTypeInput)) {
        failures.push({ rowNo, reason: `库位类型非法: ${locationTypeInput}`, row });
        return;
      }
      if (seenKey.has(key)) {
        failures.push({ rowNo, reason: `同仓库下库位编码重复: ${warehouseCode}/${code}`, row });
        return;
      }

      seenKey.add(key);
      validRows.push({
        rowNo,
        warehouseCode,
        code,
        name,
        locationType,
        aisleCode,
        rackCode,
        shelfCode,
        binCode,
        level,
        parentCode: parentCodeInput || null,
        status,
        raw: row,
      });
    });

    if (validRows.length === 0) {
      return {
        totalRows: rows.length,
        successCount: 0,
        failCount: failures.length,
        failures,
      };
    }

    const warehouseCodes = Array.from(
      new Set(validRows.map((row) => row.warehouseCode.toUpperCase())),
    );
    const warehouseMap = await this.fetchWarehouseCodeMap(warehouseCodes);

    const candidatesAfterWarehouse = validRows.filter((row) => {
      const key = row.warehouseCode.toUpperCase();
      if (warehouseMap.has(key)) return true;
      failures.push({
        rowNo: row.rowNo,
        reason: `仓库不存在: ${row.warehouseCode}`,
        row: row.raw,
      });
      return false;
    });

    if (candidatesAfterWarehouse.length === 0) {
      return {
        totalRows: rows.length,
        successCount: 0,
        failCount: failures.length,
        failures,
      };
    }

    const existingLocationIdMap = await this.fetchExistingLocationIdMap(warehouseCodes);
    const candidateKeySet = new Set(
      candidatesAfterWarehouse.map((row) => `${row.warehouseCode.toUpperCase()}::${row.code.toUpperCase()}`),
    );
    const rowsAfterParentCheck: typeof candidatesAfterWarehouse = [];

    for (const row of candidatesAfterWarehouse) {
      if (!row.parentCode) {
        rowsAfterParentCheck.push(row);
        continue;
      }
      if (row.parentCode.toUpperCase() === row.code.toUpperCase()) {
        failures.push({
          rowNo: row.rowNo,
          reason: '父级库位不能指向自身',
          row: row.raw,
        });
        continue;
      }
      const parentKey = `${row.warehouseCode.toUpperCase()}::${row.parentCode.toUpperCase()}`;
      if (!existingLocationIdMap.has(parentKey) && !candidateKeySet.has(parentKey)) {
        failures.push({
          rowNo: row.rowNo,
          reason: `父级库位不存在: ${row.warehouseCode}/${row.parentCode}`,
          row: row.raw,
        });
        continue;
      }
      rowsAfterParentCheck.push(row);
    }

    const cycleKeys = this.detectLocationCycle(
      rowsAfterParentCheck.map((row) => ({
        key: `${row.warehouseCode.toUpperCase()}::${row.code.toUpperCase()}`,
        parentKey: row.parentCode
          ? `${row.warehouseCode.toUpperCase()}::${row.parentCode.toUpperCase()}`
          : null,
      })),
      candidateKeySet,
    );

    const rowsToPersist = rowsAfterParentCheck.filter((row) => {
      const key = `${row.warehouseCode.toUpperCase()}::${row.code.toUpperCase()}`;
      if (!cycleKeys.has(key)) return true;
      failures.push({
        rowNo: row.rowNo,
        reason: '库位父子层级存在循环引用',
        row: row.raw,
      });
      return false;
    });

    if (rowsToPersist.length === 0) {
      return {
        totalRows: rows.length,
        successCount: 0,
        failCount: failures.length,
        failures,
      };
    }

    const locationIdMap = new Map(existingLocationIdMap);
    const pending = new Map(
      rowsToPersist.map((row) => [`${row.warehouseCode.toUpperCase()}::${row.code.toUpperCase()}`, row] as const),
    );
    let persistedCount = 0;

    await AppDataSource.transaction(async (manager) => {
      while (pending.size > 0) {
        let progressed = false;

        for (const [key, row] of Array.from(pending.entries())) {
          const warehouseId = warehouseMap.get(row.warehouseCode.toUpperCase());
          if (!warehouseId) {
            failures.push({ rowNo: row.rowNo, reason: `仓库不存在: ${row.warehouseCode}`, row: row.raw });
            pending.delete(key);
            continue;
          }

          let parentId: number | null = null;
          if (row.parentCode) {
            const parentKey = `${row.warehouseCode.toUpperCase()}::${row.parentCode.toUpperCase()}`;
            if (!locationIdMap.has(parentKey)) continue;
            parentId = locationIdMap.get(parentKey) ?? null;
          }

          const upsertResult = await manager.query(
            `INSERT INTO locations
               (tenant_id, warehouse_id, code, name, location_type, aisle_code, rack_code, shelf_code, bin_code, level, parent_id, status, created_by, updated_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
               name = VALUES(name),
               location_type = VALUES(location_type),
               aisle_code = VALUES(aisle_code),
               rack_code = VALUES(rack_code),
               shelf_code = VALUES(shelf_code),
               bin_code = VALUES(bin_code),
               level = VALUES(level),
               parent_id = VALUES(parent_id),
               status = VALUES(status),
               updated_by = VALUES(updated_by),
               id = LAST_INSERT_ID(id)`,
            [
              this.tenantId,
              warehouseId,
              row.code,
              row.name,
              row.locationType,
              row.aisleCode,
              row.rackCode,
              row.shelfCode,
              row.binCode,
              row.level,
              parentId,
              row.status,
              this.userId,
              this.userId,
            ],
          );

          const upsertMeta = Array.isArray(upsertResult) ? upsertResult[0] : upsertResult;
          const locationId = Number((upsertMeta as { insertId?: number })?.insertId ?? 0);
          if (locationId > 0) {
            locationIdMap.set(key, locationId);
          }
          pending.delete(key);
          persistedCount += 1;
          progressed = true;
        }

        if (!progressed) {
          for (const [key, row] of pending.entries()) {
            failures.push({
              rowNo: row.rowNo,
              reason: `无法解析父级层级关系: ${key}`,
              row: row.raw,
            });
          }
          break;
        }
      }
    });

    const effectiveSuccessCount = persistedCount;
    return {
      totalRows: rows.length,
      successCount: effectiveSuccessCount,
      failCount: failures.length,
      failures,
    };
  }

  private parseCsvRows(fileBuffer: Buffer): Array<Record<string, string>> {
    let records: Array<Record<string, unknown>>;
    try {
      records = parseCsv(fileBuffer, {
        bom: true,
        columns: true,
        skip_empty_lines: true,
        trim: true,
      }) as Array<Record<string, unknown>>;
    } catch (err) {
      throw AppError.badRequest(`CSV 解析失败: ${(err as Error).message}`);
    }
    if (!records.length) {
      throw AppError.badRequest('CSV 内容为空');
    }
    return records.map((record) => {
      const normalized: Record<string, string> = {};
      Object.entries(record).forEach(([rawKey, rawValue]) => {
        const key = (rawKey ?? '').trim();
        if (!key) return;
        normalized[key] = rawValue == null ? '' : String(rawValue).trim();
      });
      return normalized;
    });
  }

  private pickCsvValue(row: Record<string, string>, aliases: string[]): string {
    for (const alias of aliases) {
      if (Object.prototype.hasOwnProperty.call(row, alias)) {
        return row[alias] ?? '';
      }
    }
    return '';
  }

  private async fetchWarehouseCodeMap(codesUpper: string[]): Promise<Map<string, number>> {
    if (!codesUpper.length) return new Map();
    const placeholders = codesUpper.map(() => '?').join(', ');
    const rows = await AppDataSource.query<Array<{ id: number; code: string }>>(
      `SELECT id, code
       FROM warehouses
       WHERE tenant_id = ?
         AND UPPER(code) IN (${placeholders})`,
      [this.tenantId, ...codesUpper],
    );
    return new Map(rows.map((row) => [String(row.code).toUpperCase(), Number(row.id)]));
  }

  private async fetchExistingLocationIdMap(codesUpper: string[]): Promise<Map<string, number>> {
    if (!codesUpper.length) return new Map();
    const placeholders = codesUpper.map(() => '?').join(', ');
    const rows = await AppDataSource.query<Array<{
      id: number;
      warehouseCode: string;
      locationCode: string;
    }>>(
      `SELECT
         l.id,
         w.code AS warehouseCode,
         l.code AS locationCode
       FROM locations l
       INNER JOIN warehouses w
         ON w.id = l.warehouse_id
        AND w.tenant_id = l.tenant_id
       WHERE l.tenant_id = ?
         AND UPPER(w.code) IN (${placeholders})`,
      [this.tenantId, ...codesUpper],
    );

    return new Map(
      rows.map((row) => [
        `${String(row.warehouseCode).toUpperCase()}::${String(row.locationCode).toUpperCase()}`,
        Number(row.id),
      ]),
    );
  }

  private detectLocationCycle(
    edges: Array<{ key: string; parentKey: string | null }>,
    candidateKeySet: Set<string>,
  ): Set<string> {
    const cycleKeys = new Set<string>();
    const parentMap = new Map<string, string | null>();
    const visiting = new Set<string>();
    const visited = new Set<string>();

    edges.forEach((edge) => {
      parentMap.set(edge.key, edge.parentKey && candidateKeySet.has(edge.parentKey) ? edge.parentKey : null);
    });

    const dfs = (key: string, stack: string[]): void => {
      if (visited.has(key) || cycleKeys.has(key)) return;
      if (visiting.has(key)) {
        const index = stack.indexOf(key);
        const loop = index >= 0 ? stack.slice(index) : [key];
        loop.forEach((node) => cycleKeys.add(node));
        return;
      }

      visiting.add(key);
      stack.push(key);
      const parentKey = parentMap.get(key);
      if (parentKey) dfs(parentKey, stack);
      stack.pop();
      visiting.delete(key);
      visited.add(key);
    };

    Array.from(parentMap.keys()).forEach((key) => dfs(key, []));
    return cycleKeys;
  }

  // ── 库存总览（支持分类、关键字筛选） ─────────────────────

  async listInventory(params: {
    category1Id?: number;
    category2Id?: number;
    warehouseId?: number;
    locationId?: number;
    onlyDefaultLocation?: boolean;
    keyword?: string;
    belowSafety?: boolean;
    page: number;
    pageSize: number;
  }): Promise<{ list: InventorySnapshot[]; total: number }> {
    const warehouseScope = await this.getWarehouseDataScope();
    const conditions = ['s.tenant_id = ?'];
    const qParams: unknown[] = [this.tenantId];

    if (params.category1Id) { conditions.push('s.category1_id = ?'); qParams.push(params.category1Id); }
    if (params.category2Id) { conditions.push('s.category2_id = ?'); qParams.push(params.category2Id); }
    if (params.keyword) {
      conditions.push('(s.name LIKE ? OR s.sku_code LIKE ?)');
      qParams.push(`%${params.keyword}%`, `%${params.keyword}%`);
    }
    if (params.warehouseId) {
      conditions.push('inv.warehouse_id = ?');
      qParams.push(params.warehouseId);
    }
    if (warehouseScope.mode === 'none') {
      conditions.push('1 = 0');
    } else if (warehouseScope.mode === 'assigned') {
      conditions.push(`inv.warehouse_id IN (${warehouseScope.warehouseIds.map(() => '?').join(',')})`);
      qParams.push(...warehouseScope.warehouseIds);
    }
    if (params.locationId) {
      conditions.push('inv.location_id = ?');
      qParams.push(params.locationId);
    }
    if (params.onlyDefaultLocation) {
      conditions.push("(w.code = 'DEFAULT' AND l.code = 'DEFAULT-UNKNOWN')");
    }
    if (params.belowSafety) {
      conditions.push('(inv.qty_on_hand - inv.qty_reserved) < s.safety_stock');
    }

    const where = conditions.join(' AND ');
    const offset = (params.page - 1) * params.pageSize;

    const [rows, countRows] = await Promise.all([
      AppDataSource.query<any[]>(
        `SELECT s.id AS skuId, s.sku_code AS skuCode, s.name AS skuName,
                s.stock_unit AS stockUnit, s.purchase_unit AS purchaseUnit,
                COALESCE(uc.conversion_rate, s.stock_conv_factor) AS stockConvFactor,
                s.safety_stock AS safetyStock, s.has_dye_lot AS hasDyeLot,
                COALESCE(inv.qty_on_hand, 0) AS qtyOnHand,
                COALESCE(inv.qty_reserved, 0) AS qtyReserved,
                COALESCE(inv.qty_in_transit, 0) AS qtyInTransit,
                inv.warehouse_id AS warehouseId,
                w.code AS warehouseCode,
                w.name AS warehouseName,
                inv.location_id AS locationId,
                l.code AS locationCode,
                l.name AS locationName
         FROM skus s
         LEFT JOIN sku_unit_conversions uc
           ON uc.sku_id = s.id
          AND uc.tenant_id = s.tenant_id
          AND uc.from_unit = s.purchase_unit
          AND uc.to_unit = s.stock_unit
         LEFT JOIN inventory inv ON inv.sku_id = s.id AND inv.tenant_id = s.tenant_id
         LEFT JOIN warehouses w ON w.id = inv.warehouse_id AND w.tenant_id = inv.tenant_id
         LEFT JOIN locations l ON l.id = inv.location_id AND l.tenant_id = inv.tenant_id
         WHERE ${where}
         ORDER BY
           (COALESCE(inv.qty_on_hand, 0) + COALESCE(inv.qty_reserved, 0) + COALESCE(inv.qty_in_transit, 0)) DESC,
           s.id ASC
         LIMIT ? OFFSET ?`,
        [...qParams, params.pageSize, offset],
      ),
      AppDataSource.query<Array<{ total: number }>>(
        `SELECT COUNT(*) AS total FROM skus s
         LEFT JOIN inventory inv ON inv.sku_id = s.id AND inv.tenant_id = s.tenant_id
         LEFT JOIN warehouses w ON w.id = inv.warehouse_id AND w.tenant_id = inv.tenant_id
         LEFT JOIN locations l ON l.id = inv.location_id AND l.tenant_id = inv.tenant_id
         WHERE ${where}`,
        qParams,
      ),
    ]);

    const list = rows.map((r) => ({
      ...r,
      qtyAvailable: new Decimal(r.qtyOnHand).minus(r.qtyReserved).toFixed(4),
      isBelowSafety: new Decimal(r.qtyOnHand).minus(r.qtyReserved).lt(new Decimal(r.safetyStock)),
      hasDyeLot: Boolean(r.hasDyeLot),
      warehouseId: r.warehouseId ? Number(r.warehouseId) : null,
      locationId: r.locationId ? Number(r.locationId) : null,
      isDefaultLocation: r.warehouseCode === 'DEFAULT' && r.locationCode === 'DEFAULT-UNKNOWN',
    }));

    return { list, total: Number(countRows[0]?.total ?? 0) };
  }

  async listDailySnapshots(params: DailyInventorySnapshotFilter): Promise<{
    list: DailyInventorySnapshotRow[];
    total: number;
    snapshotDate: string;
  }> {
    const warehouseScope = await this.getWarehouseDataScope();
    const snapshotDate = params.snapshotDate ?? new Date().toISOString().slice(0, 10);
    const conditions = ['ids.tenant_id = ?', 'ids.snapshot_date = ?'];
    const qParams: unknown[] = [this.tenantId, snapshotDate];

    if (params.skuId) {
      conditions.push('ids.sku_id = ?');
      qParams.push(params.skuId);
    }
    if (params.warehouseId) {
      conditions.push('ids.warehouse_id = ?');
      qParams.push(params.warehouseId);
    }
    if (warehouseScope.mode !== 'all') {
      if (warehouseScope.mode === 'assigned') {
        conditions.push(`ids.warehouse_id IN (${warehouseScope.warehouseIds.map(() => '?').join(',')})`);
        qParams.push(...warehouseScope.warehouseIds);
      } else {
        return { list: [], total: 0, snapshotDate };
      }
    }
    if (params.keyword) {
      conditions.push('(s.name LIKE ? OR s.sku_code LIKE ?)');
      qParams.push(`%${params.keyword}%`, `%${params.keyword}%`);
    }

    const where = conditions.join(' AND ');
    const offset = (params.page - 1) * params.pageSize;

    const [rows, countRows] = await Promise.all([
      AppDataSource.query<DailyInventorySnapshotRow[]>(
        `SELECT
           DATE_FORMAT(ids.snapshot_date, '%Y-%m-%d') AS snapshotDate,
           ids.warehouse_id AS warehouseId,
           w.code AS warehouseCode,
           w.name AS warehouseName,
           ids.sku_id AS skuId,
           s.sku_code AS skuCode,
           s.name AS skuName,
           s.stock_unit AS stockUnit,
           ids.qty_on_hand AS qtyOnHand,
           ids.qty_reserved AS qtyReserved,
           ids.qty_available AS qtyAvailable
         FROM inventory_daily_snapshots ids
         INNER JOIN skus s
           ON s.id = ids.sku_id
          AND s.tenant_id = ids.tenant_id
         LEFT JOIN warehouses w
           ON w.id = ids.warehouse_id
          AND w.tenant_id = ids.tenant_id
         WHERE ${where}
         ORDER BY ids.warehouse_id ASC, ids.sku_id ASC
         LIMIT ? OFFSET ?`,
        [...qParams, params.pageSize, offset],
      ),
      AppDataSource.query<Array<{ total: string }>>(
        `SELECT COUNT(*) AS total
         FROM inventory_daily_snapshots ids
         INNER JOIN skus s
           ON s.id = ids.sku_id
          AND s.tenant_id = ids.tenant_id
         LEFT JOIN warehouses w
           ON w.id = ids.warehouse_id
          AND w.tenant_id = ids.tenant_id
         WHERE ${where}`,
        qParams,
      ),
    ]);

    const list = rows.map((row) => ({
      ...row,
      warehouseId: Number(row.warehouseId ?? 0),
      skuId: Number(row.skuId),
      warehouseCode: row.warehouseCode != null ? String(row.warehouseCode) : null,
      warehouseName: row.warehouseName != null ? String(row.warehouseName) : null,
    }));

    return {
      list,
      total: Number(countRows[0]?.total ?? 0),
      snapshotDate,
    };
  }

  async listTransactions(
    skuId: number,
    params: {
      page: number;
      pageSize: number;
      dateFrom?: string;
      dateTo?: string;
      warehouseId?: number;
      locationId?: number;
      keyword?: string;
    },
  ): Promise<{
    skuId: number;
    skuCode: string;
    skuName: string;
    stockUnit: string;
    list: Array<{
      transactionId: number;
      transactionNo: string;
      transactionType: string;
      direction: 'IN' | 'OUT';
      qtyChange: string;
      createdAt: string;
      referenceType: string | null;
      referenceId: number | null;
      referenceNo: string | null;
      warehouseId: number | null;
      warehouseCode: string | null;
      warehouseName: string | null;
      locationId: number | null;
      locationCode: string | null;
      locationName: string | null;
      taskId: number | null;
      workOrderNo: string | null;
      processStepName: string | null;
      workerName: string | null;
      notes: string | null;
    }>;
    total: number;
  }> {
    const warehouseScope = await this.getWarehouseDataScope();
    const [sku] = await AppDataSource.query<Array<{
      id: number;
      skuCode: string;
      skuName: string;
      stockUnit: string;
    }>>(
      `SELECT id, sku_code AS skuCode, name AS skuName, stock_unit AS stockUnit
       FROM skus
       WHERE tenant_id = ? AND id = ?
       LIMIT 1`,
      [this.tenantId, skuId],
    );

    if (!sku) {
      throw AppError.notFound('SKU 不存在', ResponseCode.SKU_NOT_FOUND);
    }

    const conditions = ['it.tenant_id = ?', 'it.sku_id = ?'];
    const queryParams: unknown[] = [this.tenantId, skuId];

    if (params.dateFrom) {
      conditions.push('DATE(it.created_at) >= ?');
      queryParams.push(params.dateFrom);
    }
    if (params.dateTo) {
      conditions.push('DATE(it.created_at) <= ?');
      queryParams.push(params.dateTo);
    }
    if (params.warehouseId) {
      conditions.push('it.warehouse_id = ?');
      queryParams.push(params.warehouseId);
    }
    if (warehouseScope.mode === 'none') {
      conditions.push('1 = 0');
    } else if (warehouseScope.mode === 'assigned') {
      conditions.push(`it.warehouse_id IN (${warehouseScope.warehouseIds.map(() => '?').join(',')})`);
      queryParams.push(...warehouseScope.warehouseIds);
    }
    if (params.locationId) {
      conditions.push('it.location_id = ?');
      queryParams.push(params.locationId);
    }
    if (params.keyword) {
      conditions.push(`(
        it.transaction_no LIKE ?
        OR COALESCE(it.reference_no, '') LIKE ?
        OR COALESCE(po.work_order_no, '') LIKE ?
        OR COALESCE(pt.task_no, '') LIKE ?
      )`);
      queryParams.push(
        `%${params.keyword}%`,
        `%${params.keyword}%`,
        `%${params.keyword}%`,
        `%${params.keyword}%`,
      );
    }

    const where = conditions.join(' AND ');
    const offset = (params.page - 1) * params.pageSize;

    const listSql = `
      SELECT
        it.id AS transactionId,
        it.transaction_no AS transactionNo,
        it.transaction_type AS transactionType,
        it.direction AS direction,
        CAST(it.qty_stock_unit AS CHAR) AS qtyChange,
        DATE_FORMAT(it.created_at, '%Y-%m-%d %H:%i:%s') AS createdAt,
        it.reference_type AS referenceType,
        it.reference_id AS referenceId,
        it.reference_no AS referenceNo,
        it.warehouse_id AS warehouseId,
        w.code AS warehouseCode,
        w.name AS warehouseName,
        it.location_id AS locationId,
        l.code AS locationCode,
        l.name AS locationName,
        pt.id AS taskId,
        po.work_order_no AS workOrderNo,
        ps.step_name AS processStepName,
        u.real_name AS workerName,
        it.notes AS notes
      FROM inventory_transactions it
      LEFT JOIN task_material_transactions tmt
        ON tmt.inventory_tx_id = it.id
       AND tmt.tenant_id = it.tenant_id
      LEFT JOIN production_tasks pt
        ON pt.id = tmt.task_id
       AND pt.tenant_id = it.tenant_id
      LEFT JOIN production_orders po
        ON po.id = COALESCE(pt.production_order_id, it.production_order_id)
       AND po.tenant_id = it.tenant_id
      LEFT JOIN process_steps ps
        ON ps.id = pt.process_step_id
      LEFT JOIN users u
        ON u.id = pt.worker_id
      LEFT JOIN warehouses w
        ON w.id = it.warehouse_id
       AND w.tenant_id = it.tenant_id
      LEFT JOIN locations l
        ON l.id = it.location_id
       AND l.tenant_id = it.tenant_id
      WHERE ${where}
      ORDER BY it.created_at DESC, it.id DESC
      LIMIT ? OFFSET ?
    `;

    const countSql = `
      SELECT COUNT(DISTINCT it.id) AS total
      FROM inventory_transactions it
      LEFT JOIN task_material_transactions tmt
        ON tmt.inventory_tx_id = it.id
       AND tmt.tenant_id = it.tenant_id
      LEFT JOIN production_tasks pt
        ON pt.id = tmt.task_id
       AND pt.tenant_id = it.tenant_id
      LEFT JOIN production_orders po
        ON po.id = COALESCE(pt.production_order_id, it.production_order_id)
       AND po.tenant_id = it.tenant_id
      LEFT JOIN warehouses w
        ON w.id = it.warehouse_id
       AND w.tenant_id = it.tenant_id
      LEFT JOIN locations l
        ON l.id = it.location_id
       AND l.tenant_id = it.tenant_id
      WHERE ${where}
    `;

    const [list, countRows] = await Promise.all([
      AppDataSource.query(listSql, [...queryParams, params.pageSize, offset]),
      AppDataSource.query<Array<{ total: string }>>(countSql, queryParams),
    ]);

    return {
      skuId: sku.id,
      skuCode: sku.skuCode,
      skuName: sku.skuName,
      stockUnit: sku.stockUnit,
      list,
      total: Number(countRows[0]?.total ?? 0),
    };
  }

  // ── 缸号批次详情 ──────────────────────────────────────────

  async getDyeLotDetails(skuId: number): Promise<DyeLotDetail[]> {
    const rows = await AppDataSource.query<any[]>(
      `SELECT dye_lot_no AS dyeLotNo, qty_on_hand AS qtyOnHand,
              qty_reserved AS qtyReserved, first_in_at AS firstInAt, last_in_at AS lastInAt
       FROM inventory_dye_lots
       WHERE tenant_id = ? AND sku_id = ? AND status = 'active'
       ORDER BY first_in_at ASC`,
      [this.tenantId, skuId],
    );

    return rows.map((r) => ({
      ...r,
      qtyAvailable: new Decimal(r.qtyOnHand).minus(r.qtyReserved).toFixed(4),
    }));
  }

  // ── 可用库存查询（供采购/销售模块调用） ─────────────────

  async getAvailableStock(skuId: number): Promise<{
    qtyOnHand: Decimal; qtyReserved: Decimal; qtyAvailable: Decimal; stockUnit: string;
  }> {
    const warehouseScope = await this.getWarehouseDataScope();
    // 尝试从 Redis 缓存读取；Redis 不可用时静默降级到 DB，不影响业务
    if (warehouseScope.mode === 'all') {
      try {
        const redis = getRedisClient();
        const cacheKey = RedisKeys.inventorySnapshot(this.tenantId, skuId);
        const cached = await redis.get(cacheKey);
        if (cached) {
          const d = JSON.parse(cached);
          return {
            qtyOnHand: new Decimal(d.qtyOnHand),
            qtyReserved: new Decimal(d.qtyReserved),
            qtyAvailable: new Decimal(d.qtyAvailable),
            stockUnit: d.stockUnit,
          };
        }
      } catch (err) {
        console.warn('[InventoryService] Redis 缓存读取失败，降级到 DB 查询:', (err as Error).message);
      }
    }

    const inventoryJoinConditions = ['inv.sku_id = s.id', 'inv.tenant_id = s.tenant_id'];
    const inventoryJoinParams: Array<string | number> = [];
    if (warehouseScope.mode === 'none') {
      inventoryJoinConditions.push('1 = 0');
    } else if (warehouseScope.mode === 'assigned') {
      inventoryJoinConditions.push(`inv.warehouse_id IN (${warehouseScope.warehouseIds.map(() => '?').join(',')})`);
      inventoryJoinParams.push(...warehouseScope.warehouseIds);
    }

    const [row] = await AppDataSource.query<any[]>(
      `SELECT COALESCE(SUM(inv.qty_on_hand), 0) AS qtyOnHand,
              COALESCE(SUM(inv.qty_reserved), 0) AS qtyReserved,
              s.stock_unit AS stockUnit
       FROM skus s
       LEFT JOIN inventory inv ON ${inventoryJoinConditions.join(' AND ')}
       WHERE s.id = ? AND s.tenant_id = ?
       GROUP BY s.stock_unit
       LIMIT 1`,
      [...inventoryJoinParams, skuId, this.tenantId],
    );
    if (!row) throw AppError.notFound('SKU不存在');

    const qtyOnHand = new Decimal(row.qtyOnHand);
    const qtyReserved = new Decimal(row.qtyReserved);
    const qtyAvailable = qtyOnHand.minus(qtyReserved);

    // 写缓存失败不影响正常返回
    if (warehouseScope.mode === 'all') {
      try {
        const redis = getRedisClient();
        const cacheKey = RedisKeys.inventorySnapshot(this.tenantId, skuId);
        await redis.setex(cacheKey, RedisTTL.INVENTORY, JSON.stringify({
          qtyOnHand: qtyOnHand.toFixed(4),
          qtyReserved: qtyReserved.toFixed(4),
          qtyAvailable: qtyAvailable.toFixed(4),
          stockUnit: row.stockUnit,
        }));
      } catch (err) {
        console.warn('[InventoryService] Redis 缓存写入失败，已忽略:', (err as Error).message);
      }
    }

    return { qtyOnHand, qtyReserved, qtyAvailable, stockUnit: row.stockUnit };
  }

  async rebuildDailySnapshots(params: RebuildInventorySnapshotParams): Promise<{
    snapshotDate: string;
    rebuiltCount: number;
    skuId: number | null;
    skuIds: number[] | null;
    dryRun: boolean;
  }> {
    let trackedInventoryManager: InventoryTrackedQueryRunner | null = null;
    const result = await AppDataSource.transaction(async (manager) => {
      trackedInventoryManager = manager as InventoryTrackedQueryRunner;
      return this.rebuildDailySnapshotsInTx(manager, params);
    });
    await this.invalidateInventorySnapshotCaches(
      this.consumeTrackedInventorySnapshotSkuIds(trackedInventoryManager),
    );
    return result;
  }

  private async rebuildDailySnapshotsInTx(
    manager: InventoryQueryRunner,
    params: RebuildInventorySnapshotParams,
  ): Promise<{
    snapshotDate: string;
    rebuiltCount: number;
    skuId: number | null;
    skuIds: number[] | null;
    dryRun: boolean;
  }> {
    const snapshotDate = params.snapshotDate ?? new Date().toISOString().slice(0, 10);
    const { hasSkuFilter, whereSql, whereParams } = this.buildInventoryScope(params);

    const [countRow] = await manager.query<Array<{ cnt: string }>>(
      `SELECT COUNT(DISTINCT CONCAT(COALESCE(warehouse_id, 0), '#', sku_id)) AS cnt
       FROM inventory
       WHERE ${whereSql}`,
      whereParams,
    );
    const inventoryRows = await manager.query<Array<{ sku_id: number }>>(
      `SELECT DISTINCT sku_id
       FROM inventory
       WHERE ${whereSql}
       ORDER BY sku_id ASC`,
      whereParams,
    );
    const affectedSkuIds = inventoryRows.map((row) => Number(row.sku_id));

    if (!params.dryRun) {
      await rebuildInventoryDailySnapshotsForScope(manager, {
        snapshotDate,
        whereSql,
        whereParams,
      });
      this.trackInventorySnapshotCacheInvalidation(manager, affectedSkuIds);
    }

    return {
      snapshotDate,
      rebuiltCount: Number(countRow?.cnt ?? 0),
      skuId: affectedSkuIds.length === 1 ? affectedSkuIds[0] : null,
      skuIds: hasSkuFilter ? affectedSkuIds : null,
      dryRun: Boolean(params.dryRun),
    };
  }

  async reconcileInventoryBalances(params: ReconcileInventoryParams): Promise<{
    checkedCount: number;
    changedCount: number;
    dryRun: boolean;
    skuId: number | null;
    skuIds: number[] | null;
    items: InventoryReconcileItem[];
  }> {
    let trackedInventoryManager: InventoryTrackedQueryRunner | null = null;
    const result = await AppDataSource.transaction(async (manager) => {
      trackedInventoryManager = manager as InventoryTrackedQueryRunner;
      return this.reconcileInventoryBalancesInTx(manager, params);
    });
    await this.invalidateInventorySnapshotCaches(
      this.consumeTrackedInventorySnapshotSkuIds(trackedInventoryManager),
    );
    return result;
  }

  private async reconcileInventoryBalancesInTx(
    manager: InventoryQueryRunner,
    params: ReconcileInventoryParams,
  ): Promise<{
    checkedCount: number;
    changedCount: number;
    dryRun: boolean;
    skuId: number | null;
    skuIds: number[] | null;
    items: InventoryReconcileItem[];
  }> {
    const { targetSkuIds, hasSkuFilter, whereSql, whereParams } = this.buildInventoryScope(params);
    const singleSku = targetSkuIds.length === 1;
    const skuPlaceholders = targetSkuIds.map(() => '?').join(', ');

    const inventoryRows = await manager.query<Array<{
      sku_id: number;
      qty_on_hand: string;
      qty_reserved: string;
      qty_in_transit: string;
    }>>(
      `SELECT sku_id, qty_on_hand, qty_reserved, qty_in_transit
       FROM inventory
       WHERE ${whereSql}`,
      whereParams,
    );

    const ledgerRows = await manager.query<Array<{
      sku_id: number;
      expected_qty_on_hand: string;
    }>>(
      `SELECT
         sku_id,
         COALESCE(SUM(
           CASE WHEN direction = 'IN' THEN qty_stock_unit ELSE -qty_stock_unit END
         ), 0) AS expected_qty_on_hand
       FROM inventory_transactions
       WHERE ${whereSql}
       GROUP BY sku_id`,
      whereParams,
    );

    const reservedRows = params.includeReserved
      ? await manager.query<Array<{
        sku_id: number;
        expected_qty_reserved: string;
      }>>(
        `SELECT
           mr.sku_id,
           COALESCE(SUM(mr.qty_reserved), 0) AS expected_qty_reserved
         FROM material_requirements mr
         INNER JOIN production_orders po
           ON po.id = mr.production_order_id
          AND po.tenant_id = mr.tenant_id
         WHERE mr.tenant_id = ?
           ${hasSkuFilter
  ? singleSku
    ? 'AND mr.sku_id = ?'
    : `AND mr.sku_id IN (${skuPlaceholders})`
  : ''}
           AND po.status IN ('pending', 'scheduled', 'in_progress')
         GROUP BY mr.sku_id`,
        whereParams,
      )
      : [];

    const inTransitRows = params.includeInTransit
      ? await manager.query<Array<{
        sku_id: number;
        expected_qty_in_transit: string;
      }>>(
        `SELECT
           poi.sku_id,
           COALESCE(SUM(
             GREATEST(poi.qty_ordered - poi.qty_received, 0) *
             COALESCE(uc.conversion_rate, 1)
           ), 0) AS expected_qty_in_transit
         FROM purchase_order_items poi
         INNER JOIN purchase_orders po
           ON po.id = poi.po_id
          AND po.tenant_id = poi.tenant_id
         LEFT JOIN sku_unit_conversions uc
           ON uc.sku_id = poi.sku_id
          AND uc.from_unit = poi.purchase_unit
          AND uc.tenant_id = poi.tenant_id
         WHERE poi.tenant_id = ?
           ${hasSkuFilter
  ? singleSku
    ? 'AND poi.sku_id = ?'
    : `AND poi.sku_id IN (${skuPlaceholders})`
  : ''}
           AND po.status IN ('confirmed', 'partial_received')
         GROUP BY poi.sku_id`,
        whereParams,
      )
      : [];

    const inventoryMap = new Map(
      inventoryRows.map((row) => [Number(row.sku_id), row]),
    );
    const ledgerMap = new Map(
      ledgerRows.map((row) => [Number(row.sku_id), row]),
    );
    const reservedMap = new Map(
      reservedRows.map((row) => [Number(row.sku_id), row]),
    );
    const inTransitMap = new Map(
      inTransitRows.map((row) => [Number(row.sku_id), row]),
    );
    const skuIds = Array.from(new Set([
      ...inventoryMap.keys(),
      ...ledgerMap.keys(),
      ...reservedMap.keys(),
      ...inTransitMap.keys(),
    ])).sort((a, b) => a - b);

    const items: InventoryReconcileItem[] = [];
    const updatedSkuIds: number[] = [];
    const defaultWarehouseLocation = params.dryRun
      ? null
      : await this.ensureDefaultWarehouseLocation(manager);

    for (const skuId of skuIds) {
      const inventoryRow = inventoryMap.get(skuId);
      const ledgerRow = ledgerMap.get(skuId);
      const currentQtyOnHand = new Decimal(inventoryRow?.qty_on_hand ?? '0');
      const currentQtyReserved = new Decimal(inventoryRow?.qty_reserved ?? '0');
      const currentQtyInTransit = new Decimal(inventoryRow?.qty_in_transit ?? '0');
      const expectedQtyOnHand = new Decimal(ledgerRow?.expected_qty_on_hand ?? '0');
      const deltaQtyOnHand = expectedQtyOnHand.minus(currentQtyOnHand);
      const expectedQtyReserved = params.includeReserved
        ? new Decimal(reservedMap.get(skuId)?.expected_qty_reserved ?? '0')
        : null;
      const deltaQtyReserved = expectedQtyReserved
        ? expectedQtyReserved.minus(currentQtyReserved)
        : null;
      const expectedQtyInTransit = params.includeInTransit
        ? new Decimal(inTransitMap.get(skuId)?.expected_qty_in_transit ?? '0')
        : null;
      const deltaQtyInTransit = expectedQtyInTransit
        ? expectedQtyInTransit.minus(currentQtyInTransit)
        : null;
      const hasOnHandDrift = !deltaQtyOnHand.eq(0);
      const hasReservedDrift = deltaQtyReserved ? !deltaQtyReserved.eq(0) : false;
      const hasInTransitDrift = deltaQtyInTransit ? !deltaQtyInTransit.eq(0) : false;

      if (!hasOnHandDrift && !hasReservedDrift && !hasInTransitDrift) continue;

      items.push({
        skuId,
        currentQtyOnHand: currentQtyOnHand.toFixed(4),
        expectedQtyOnHand: expectedQtyOnHand.toFixed(4),
        deltaQtyOnHand: deltaQtyOnHand.toFixed(4),
        currentQtyReserved: currentQtyReserved.toFixed(4),
        expectedQtyReserved: expectedQtyReserved?.toFixed(4) ?? null,
        deltaQtyReserved: deltaQtyReserved?.toFixed(4) ?? null,
        currentQtyInTransit: currentQtyInTransit.toFixed(4),
        expectedQtyInTransit: expectedQtyInTransit?.toFixed(4) ?? null,
        deltaQtyInTransit: deltaQtyInTransit?.toFixed(4) ?? null,
      });

      if (!params.dryRun) {
        await manager.query(
          `INSERT INTO inventory
             (tenant_id, sku_id, warehouse_id, location_id, source_ref,
              qty_on_hand, qty_reserved, qty_in_transit, last_in_at, updated_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?)
           ON DUPLICATE KEY UPDATE
             qty_on_hand = VALUES(qty_on_hand),
             qty_reserved = VALUES(qty_reserved),
             qty_in_transit = VALUES(qty_in_transit),
             source_ref = COALESCE(source_ref, VALUES(source_ref)),
             updated_by = VALUES(updated_by)`,
          [
            this.tenantId,
            skuId,
            defaultWarehouseLocation?.warehouseId ?? null,
            defaultWarehouseLocation?.locationId ?? null,
            'reconcile:auto',
            expectedQtyOnHand.toFixed(4),
            (expectedQtyReserved ?? currentQtyReserved).toFixed(4),
            (expectedQtyInTransit ?? currentQtyInTransit).toFixed(4),
            this.userId,
          ],
        );

        await this.syncDailySnapshot(manager, skuId);
        updatedSkuIds.push(skuId);
      }
    }

    if (!params.dryRun) {
      this.trackInventorySnapshotCacheInvalidation(manager, updatedSkuIds);
    }

    return {
      checkedCount: skuIds.length,
      changedCount: items.length,
      dryRun: params.dryRun ?? true,
      skuId: targetSkuIds.length === 1 ? targetSkuIds[0] : null,
      skuIds: hasSkuFilter ? targetSkuIds : null,
      items,
    };
  }

  async repairInventoryState(params: RepairInventoryParams): Promise<{
    dryRun: boolean;
    reconcile: Awaited<ReturnType<InventoryService['reconcileInventoryBalances']>>;
    snapshots: Awaited<ReturnType<InventoryService['rebuildDailySnapshots']>>;
  }> {
    let trackedInventoryManager: InventoryTrackedQueryRunner | null = null;
    const result = await AppDataSource.transaction(async (manager) => {
      trackedInventoryManager = manager as InventoryTrackedQueryRunner;
      const dryRun = params.dryRun ?? true;
      const reconcile = await this.reconcileInventoryBalancesInTx(manager, {
        skuId: params.skuId,
        skuIds: params.skuIds,
        dryRun,
        includeReserved: params.includeReserved ?? true,
        includeInTransit: params.includeInTransit ?? true,
      });
      const snapshots = await this.rebuildDailySnapshotsInTx(manager, {
        snapshotDate: params.snapshotDate,
        skuId: params.skuId,
        skuIds: params.skuIds,
        dryRun,
      });

      return {
        dryRun,
        reconcile,
        snapshots,
      };
    });
    await this.invalidateInventorySnapshotCaches(
      this.consumeTrackedInventorySnapshotSkuIds(trackedInventoryManager),
    );
    return result;
  }

  private trackInventorySnapshotCacheInvalidation(
    manager: InventoryQueryRunner,
    skuIds: number[],
  ): void {
    if (skuIds.length === 0) return;
    const trackedManager = manager as InventoryTrackedQueryRunner;
    const tracked = (trackedManager.__inventorySnapshotSkuIds ??= new Set<number>());
    for (const skuId of skuIds) {
      tracked.add(Number(skuId));
    }
  }

  private consumeTrackedInventorySnapshotSkuIds(
    manager: InventoryTrackedQueryRunner | null,
  ): number[] {
    const skuIds = Array.from(manager?.__inventorySnapshotSkuIds ?? []);
    if (manager) {
      delete manager.__inventorySnapshotSkuIds;
    }
    return skuIds;
  }

  private async invalidateInventorySnapshotCaches(skuIds: number[]): Promise<void> {
    if (skuIds.length === 0) return;
    try {
      const redis = getRedisClient();
      await Promise.all(
        Array.from(new Set(skuIds)).map((skuId) =>
          redis.del(RedisKeys.inventorySnapshot(this.tenantId, skuId)),
        ),
      );
    } catch (err) {
      console.warn('[InventoryService] 库存修复后的缓存失效失败，已忽略:', (err as Error).message);
    }
  }

  // ── 采购入库 ──────────────────────────────────────────────

  async inbound(params: InboundParams): Promise<{
    transactionNo: string;
    newQtyOnHand: string;
    warehouseId: number;
    locationId: number;
    warningCode?: string;
  }> {
    const skuId = await this.resolveInboundSkuId(params);
    const sku = await this.getSkuInfo(skuId);
    let trackedInventoryManager: InventoryTrackedQueryRunner | null = null;

    // 1. 校验面料缸号必填
    if (sku.hasDyeLot && !params.dyeLotNo) {
      throw new AppError('该物料需要填写缸号', ResponseCode.INVENTORY_DYE_LOT_REQUIRED);
    }

    // 2. 单位换算到库存单位
    const conversions = await this.getUnitConversions(skuId);
    const converted = UnitConverter.convert(
      params.qtyInput, params.inputUnit, conversions, sku.stockUnit,
    );

    // 3. 尝试获取 Redis 分布式锁
    //    - Redis 可用且锁空闲：正常加锁，事务内再加 DB 行锁（双重保障）
    //    - Redis 可用但锁已被占用：说明同一 SKU 正在操作，拒绝并发请求
    //    - Redis 不可用（抛出异常）：降级到纯 DB 行锁，保证高可用
    const lockKey = RedisKeys.inventoryLock(this.tenantId, skuId);
    let lockVal: string | null = null;
    let redisLockAcquired = false;

    try {
      lockVal = await acquireLock(lockKey, 5000);
      if (lockVal === null) {
        // Redis 可用但锁已被持有，说明并发操作同一 SKU，拒绝请求
        throw new AppError('库存操作繁忙，请稍后重试', ResponseCode.INVENTORY_LOCK_FAILED);
      }
      redisLockAcquired = true;
    } catch (err) {
      if (err instanceof AppError) throw err;
      // Redis 不可用（连接断开、超时等），记录告警并降级到 DB 行锁
      console.warn('[InventoryService] Redis 分布式锁不可用，降级到 DB 行锁（入库）:', (err as Error).message);
    }

    let result: {
      transactionNo: string;
      newQtyOnHand: string;
      warehouseId: number;
      locationId: number;
      warningCode?: string;
    };
    try {
      result = await AppDataSource.transaction(async (manager) => {
        trackedInventoryManager = manager as InventoryTrackedQueryRunner;
        const resolvedSourceRef = params.referenceType ?? 'api:inventory:inbound';
        const warehouseLocation = await this.resolveWarehouseLocation(
          manager,
          params,
          resolvedSourceRef,
        );
        assertWarehouseInScope(await this.getWarehouseDataScope(), warehouseLocation.warehouseId);
        // 4. DB 行锁（入库时锁定 inventory 行）
        //    - Redis 锁可用时：提供跨进程互斥的第一层防护
        //    - Redis 降级时：DB 行锁作为唯一并发控制手段
        //    入库使用 SELECT ... FOR UPDATE 防止并发写冲突
        await manager.query(
          `SELECT id
           FROM inventory
           WHERE tenant_id = ? AND sku_id = ? AND warehouse_id = ? AND location_id = ?
           LIMIT 1
           FOR UPDATE`,
          [
            this.tenantId,
            skuId,
            warehouseLocation.warehouseId,
            warehouseLocation.locationId,
          ],
        );
        // 注意：若 inventory 行尚不存在（首次入库），INSERT ... ON DUPLICATE KEY UPDATE
        // 本身具有行级 gap lock，可安全处理并发首次入库

        const txNo = this.generateTxNo('IN');

        // 5. 写入库存流水
        await manager.query(
          `INSERT INTO inventory_transactions
             (tenant_id, transaction_no, sku_id, transaction_type, direction,
              warehouse_id, location_id, source_ref,
              qty_input, input_unit, qty_stock_unit, stock_unit, dye_lot_no,
              reference_type, reference_id, reference_no, batch_cost, notes, created_by, updated_by)
           VALUES (?,?,?,?,?, ?,?,?, ?,?,?,?,?, ?,?,?,?,?,?,?)`,
          [
            this.tenantId, txNo, skuId, params.transactionType, 'IN',
            warehouseLocation.warehouseId, warehouseLocation.locationId, resolvedSourceRef,
            params.qtyInput, params.inputUnit, converted.qty.toFixed(4), sku.stockUnit, params.dyeLotNo ?? null,
            params.referenceType ?? null, params.referenceId ?? null, params.referenceNo ?? null,
            params.batchCost ?? null, params.notes ?? null, this.userId, this.userId,
          ],
        );

        // 6. 更新库存快照（UPSERT）
        await manager.query(
          `INSERT INTO inventory
             (tenant_id, sku_id, warehouse_id, location_id, source_ref, qty_on_hand, qty_reserved, qty_in_transit, last_in_at, updated_by)
           VALUES (?, ?, ?, ?, ?, ?, 0, 0, NOW(), ?)
           ON DUPLICATE KEY UPDATE
             qty_on_hand = qty_on_hand + VALUES(qty_on_hand),
             warehouse_id = VALUES(warehouse_id),
             location_id = VALUES(location_id),
             source_ref = VALUES(source_ref),
             last_in_at  = NOW(),
             updated_by = VALUES(updated_by)`,
          [
            this.tenantId,
            skuId,
            warehouseLocation.warehouseId,
            warehouseLocation.locationId,
            resolvedSourceRef,
            converted.qty.toFixed(4),
            this.userId,
          ],
        );

        await this.syncDailySnapshot(manager, skuId);
        this.trackInventorySnapshotCacheInvalidation(manager, [skuId]);

        // 7. 更新缸号批次库存（面料类）
        if (params.dyeLotNo) {
          await manager.query(
            `INSERT INTO inventory_dye_lots
               (tenant_id, sku_id, dye_lot_no, qty_on_hand, qty_reserved, first_in_at, last_in_at)
             VALUES (?, ?, ?, ?, 0, NOW(), NOW())
             ON DUPLICATE KEY UPDATE
               qty_on_hand = qty_on_hand + VALUES(qty_on_hand),
               last_in_at  = NOW()`,
            [this.tenantId, skuId, params.dyeLotNo, converted.qty.toFixed(4)],
          );
        }

        // 8. 查询更新后的库存数量
        const [updated] = await manager.query<Array<{ qty: string }>>(
          `SELECT qty_on_hand AS qty
           FROM inventory
           WHERE tenant_id = ? AND sku_id = ? AND warehouse_id = ? AND location_id = ?
           LIMIT 1`,
          [
            this.tenantId,
            skuId,
            warehouseLocation.warehouseId,
            warehouseLocation.locationId,
          ],
        );

        return {
          transactionNo: txNo,
          newQtyOnHand: updated?.qty ?? converted.qty.toFixed(4),
          warehouseId: warehouseLocation.warehouseId,
          locationId: warehouseLocation.locationId,
          warningCode: warehouseLocation.warningCode ?? undefined,
        };
      });
    } finally {
      // 释放 Redis 锁（失败只打警告，不影响结果）
      if (redisLockAcquired && lockVal) {
        await releaseLock(lockKey, lockVal);
      }
    }

    await this.invalidateInventorySnapshotCaches(
      this.consumeTrackedInventorySnapshotSkuIds(trackedInventoryManager),
    );
    this.checkSafetyStockAlert(skuId, sku).catch(console.error);
    return result;
  }

  // ── 出库 ──────────────────────────────────────────────────

  async outbound(params: OutboundParams): Promise<{
    transactionNo: string;
    newQtyOnHand: string;
    warehouseId: number;
    locationId: number;
    warningCode?: string;
  }> {
    const sku = await this.getSkuInfo(params.skuId);
    let trackedInventoryManager: InventoryTrackedQueryRunner | null = null;

    // 1. 面料缸号必填
    if (sku.hasDyeLot && !params.dyeLotNo) {
      throw new AppError('该物料出库需要指定缸号', ResponseCode.INVENTORY_DYE_LOT_REQUIRED);
    }

    // 2. 生产领料时校验缸号一致性（RISK-005）
    //    - isCrossDyeLot = true 时，默认强制阻断，不允许静默通过
    //    - 若携带有效 authorizeId，则通过授权服务校验，校验通过后记录授权信息到流水
    let isCrossDyeLot = false;
    let crossDyeLotAuthorizeInfo: {
      authorizeUserId: number;
      reason: string;
      decidedAt: Date;
    } | null = null;

    if (sku.hasDyeLot && params.dyeLotNo && params.productionOrderId) {
      isCrossDyeLot = await this.checkDyeLotConsistency(
        params.productionOrderId, params.skuId, params.dyeLotNo,
      );

      if (isCrossDyeLot) {
        // 获取绑定色号（用于错误详情，方便前端展示预警弹窗）
        const boundDyeLotNo = await this.getBoundDyeLotNo(params.productionOrderId, params.skuId);

        if (!params.authorizeId) {
          // 无授权ID → 强制阻断，返回 4004 + 色号对比信息供前端展示弹窗
          throw new AppError(
            '检测到跨色号出库风险，需要主管授权',
            ResponseCode.INVENTORY_CROSS_DYE_LOT,
            400,
            {
              boundDyeLotNo:        boundDyeLotNo ?? '未知',
              requestedDyeLotNo:    params.dyeLotNo,
              skuName:              sku.skuName ?? '',
              productionOrderId:    params.productionOrderId,
              riskLevel:            'high',
            },
          );
        }

        // 有授权ID → 通过授权服务校验，失败仍抛 AppError
        const authSvc = new DyeLotAuthorizeService({
          tenantId: this.tenantId,
          userId:   this.userId,
          actionCodes: this.actionCodes,
        });
        crossDyeLotAuthorizeInfo = await authSvc.validateForOutbound(
          params.authorizeId,
          params.skuId,
        );
      }
    }

    // 3. 单位换算
    const conversions = await this.getUnitConversions(params.skuId);
    const converted = UnitConverter.convert(
      params.qtyInput, params.inputUnit, conversions, sku.stockUnit,
    );

    // 4. 尝试获取 Redis 分布式锁（策略同入库）
    const lockKey = RedisKeys.inventoryLock(this.tenantId, params.skuId);
    let lockVal: string | null = null;
    let redisLockAcquired = false;

    try {
      lockVal = await acquireLock(lockKey, 5000);
      if (lockVal === null) {
        throw new AppError('库存操作繁忙，请稍后重试', ResponseCode.INVENTORY_LOCK_FAILED);
      }
      redisLockAcquired = true;
    } catch (err) {
      if (err instanceof AppError) throw err;
      console.warn('[InventoryService] Redis 分布式锁不可用，降级到 DB 行锁（出库）:', (err as Error).message);
    }

    let result: {
      transactionNo: string;
      newQtyOnHand: string;
      warehouseId: number;
      locationId: number;
      warningCode?: string;
    };
    try {
      result = await AppDataSource.transaction(async (manager) => {
        trackedInventoryManager = manager as InventoryTrackedQueryRunner;
        const resolvedSourceRef = params.referenceType ?? 'api:inventory:outbound';
        const warehouseLocation = await this.resolveWarehouseLocation(
          manager,
          params,
          resolvedSourceRef,
        );
        // 5. 检查库存充足性，使用 SELECT ... FOR UPDATE 行锁防止超卖
        //    这是防超卖的最终安全线，无论 Redis 锁是否可用均必须执行
        const [inv] = await manager.query<Array<{ qty_on_hand: string; qty_reserved: string }>>(
          `SELECT qty_on_hand, qty_reserved
           FROM inventory
           WHERE tenant_id = ? AND sku_id = ? AND warehouse_id = ? AND location_id = ?
           LIMIT 1
           FOR UPDATE`,
          [
            this.tenantId,
            params.skuId,
            warehouseLocation.warehouseId,
            warehouseLocation.locationId,
          ],
        );
        if (!inv) throw new AppError('库存记录不存在', ResponseCode.INVENTORY_INSUFFICIENT);

        const available = new Decimal(inv.qty_on_hand).minus(inv.qty_reserved);
        if (converted.qty.gt(available)) {
          throw new AppError(
            `库存不足：可用 ${available.toFixed(4)} ${sku.stockUnit}，需要 ${converted.qty.toFixed(4)} ${sku.stockUnit}`,
            ResponseCode.INVENTORY_INSUFFICIENT,
          );
        }

        // 6. 面料缸号库存检查
        if (params.dyeLotNo) {
          const [dl] = await manager.query<Array<{ qty_on_hand: string; qty_reserved: string }>>(
            `SELECT qty_on_hand, qty_reserved FROM inventory_dye_lots
             WHERE tenant_id = ? AND sku_id = ? AND dye_lot_no = ? FOR UPDATE`,
            [this.tenantId, params.skuId, params.dyeLotNo],
          );
          if (!dl) throw new AppError(`缸号 ${params.dyeLotNo} 库存不存在`);
          const dlAvailable = new Decimal(dl.qty_on_hand).minus(dl.qty_reserved);
          if (converted.qty.gt(dlAvailable)) {
            throw new AppError(
              `缸号 ${params.dyeLotNo} 可用库存不足：${dlAvailable.toFixed(4)} ${sku.stockUnit}`,
              ResponseCode.INVENTORY_INSUFFICIENT,
            );
          }

          // 扣减缸号库存
          await manager.query(
            `UPDATE inventory_dye_lots
             SET qty_on_hand = qty_on_hand - ?, last_in_at = NOW()
             WHERE tenant_id = ? AND sku_id = ? AND dye_lot_no = ?`,
            [converted.qty.toFixed(4), this.tenantId, params.skuId, params.dyeLotNo],
          );
        }

        const txNo = this.generateTxNo('OUT');

        // 7. 写入流水（含 production_order_id，供溯源链反查该工单领用了哪些物料）
        await manager.query(
          `INSERT INTO inventory_transactions
             (tenant_id, transaction_no, sku_id, transaction_type, direction,
              warehouse_id, location_id, source_ref,
              qty_input, input_unit, qty_stock_unit, stock_unit, dye_lot_no,
              production_order_id, reference_type, reference_id, reference_no,
              is_cross_dye_lot, notes, created_by, updated_by)
           VALUES (?,?,?,?,?, ?,?,?, ?,?,?,?,?, ?,?,?,?,?,?,?,?)`,
          [
            this.tenantId, txNo, params.skuId, params.transactionType, 'OUT',
            warehouseLocation.warehouseId, warehouseLocation.locationId, resolvedSourceRef,
            params.qtyInput, params.inputUnit, converted.qty.toFixed(4), sku.stockUnit,
            params.dyeLotNo ?? null,
            params.productionOrderId ?? null,
            params.referenceType ?? null, params.referenceId ?? null, params.referenceNo ?? null,
            isCrossDyeLot ? 1 : 0, params.notes ?? null, this.userId, this.userId,
          ],
        );

        // 8. 扣减库存快照
        await manager.query(
          `UPDATE inventory
           SET qty_on_hand = qty_on_hand - ?, last_out_at = NOW(), updated_by = ?
           WHERE tenant_id = ? AND sku_id = ? AND warehouse_id = ? AND location_id = ?`,
          [
            converted.qty.toFixed(4),
            this.userId,
            this.tenantId,
            params.skuId,
            warehouseLocation.warehouseId,
            warehouseLocation.locationId,
          ],
        );

        await this.syncDailySnapshot(manager, params.skuId);
        this.trackInventorySnapshotCacheInvalidation(manager, [params.skuId]);

        const [updated] = await manager.query<Array<{ qty: string }>>(
          `SELECT qty_on_hand AS qty
           FROM inventory
           WHERE tenant_id = ? AND sku_id = ? AND warehouse_id = ? AND location_id = ?
           LIMIT 1`,
          [
            this.tenantId,
            params.skuId,
            warehouseLocation.warehouseId,
            warehouseLocation.locationId,
          ],
        );

        // 9. 若首次领料绑定缸号（生产订单）
        if (params.dyeLotNo && params.productionOrderId && !isCrossDyeLot) {
          await manager.query(
            `INSERT IGNORE INTO order_dye_lot_bindings
               (tenant_id, production_order_id, sku_id, dye_lot_no, bound_at, bound_by)
             VALUES (?, ?, ?, ?, NOW(), ?)`,
            [this.tenantId, params.productionOrderId, params.skuId, params.dyeLotNo, this.userId],
          );
        }

        return {
          transactionNo: txNo,
          newQtyOnHand: updated?.qty ?? '0',
          warehouseId: warehouseLocation.warehouseId,
          locationId: warehouseLocation.locationId,
          warningCode: warehouseLocation.warningCode ?? undefined,
        };
      });
    } finally {
      if (redisLockAcquired && lockVal) {
        await releaseLock(lockKey, lockVal);
      }
    }

    await this.invalidateInventorySnapshotCaches(
      this.consumeTrackedInventorySnapshotSkuIds(trackedInventoryManager),
    );
    return result;
  }

  // ── 先进先出出库推荐（面料类） ────────────────────────────

  async recommendFifoDyeLot(skuId: number, requiredQty: string): Promise<DyeLotDetail[]> {
    const rows = await AppDataSource.query<any[]>(
      `SELECT dye_lot_no AS dyeLotNo, qty_on_hand AS qtyOnHand,
              qty_reserved AS qtyReserved, first_in_at AS firstInAt, last_in_at AS lastInAt
       FROM inventory_dye_lots
       WHERE tenant_id = ? AND sku_id = ? AND status = 'active'
         AND qty_on_hand - qty_reserved > 0
       ORDER BY first_in_at ASC`,
      [this.tenantId, skuId],
    );

    // 按 FIFO 顺序选取满足数量的缸号
    let remaining = new Decimal(requiredQty);
    const result: DyeLotDetail[] = [];
    for (const r of rows) {
      if (remaining.lte(0)) break;
      result.push({ ...r, qtyAvailable: new Decimal(r.qtyOnHand).minus(r.qtyReserved).toFixed(4) });
      remaining = remaining.minus(new Decimal(r.qtyOnHand).minus(r.qtyReserved));
    }
    return result;
  }

  // ── 私有辅助 ──────────────────────────────────────────────

  private async getSkuInfo(skuId: number): Promise<{
    stockUnit: string; purchaseUnit: string; productionUnit: string; hasDyeLot: boolean; safetyStock: string; skuName: string;
  }> {
    const [sku] = await AppDataSource.query<any[]>(
      `SELECT stock_unit AS stockUnit, purchase_unit AS purchaseUnit,
              production_unit AS productionUnit, has_dye_lot AS hasDyeLot,
              safety_stock AS safetyStock, name AS skuName
       FROM skus WHERE id = ? AND tenant_id = ? LIMIT 1`,
      [skuId, this.tenantId],
    );
    if (!sku) throw AppError.notFound('SKU不存在');
    return { ...sku, hasDyeLot: Boolean(sku.hasDyeLot) };
  }

  private async resolveInboundSkuId(params: InboundParams): Promise<number> {
    if (params.skuId && Number(params.skuId) > 0) {
      return Number(params.skuId);
    }

    const skuCode = String(params.skuCode ?? '').trim();
    if (!skuCode) {
      throw AppError.badRequest('skuId 或 skuCode 至少传一个');
    }

    const [row] = await AppDataSource.query<Array<{ id: number }>>(
      `SELECT id
       FROM skus
       WHERE tenant_id = ? AND sku_code = ?
       LIMIT 1`,
      [this.tenantId, skuCode],
    );

    if (!row?.id) {
      throw AppError.notFound(`SKU编码不存在: ${skuCode}`);
    }
    return Number(row.id);
  }

  /**
   * 获取生产工单绑定的色号（用于跨色号出库警告信息）
   */
  private async getBoundDyeLotNo(productionOrderId: number, skuId: number): Promise<string | null> {
    const [row] = await AppDataSource.query<Array<{ dyeLotNo: string }>>(
      `SELECT dye_lot_no AS dyeLotNo FROM inventory_transactions
       WHERE tenant_id = ? AND production_order_id = ? AND sku_id = ? AND dye_lot_no IS NOT NULL
       ORDER BY created_at ASC LIMIT 1`,
      [this.tenantId, productionOrderId, skuId],
    );
    return row?.dyeLotNo ?? null;
  }

  private async getUnitConversions(skuId: number) {
    return AppDataSource.query<Array<{ fromUnit: string; toUnit: string; conversionRate: string }>>(
      `SELECT from_unit AS fromUnit, to_unit AS toUnit, conversion_rate AS conversionRate
       FROM sku_unit_conversions WHERE tenant_id = ? AND sku_id = ?`,
      [this.tenantId, skuId],
    );
  }

  /**
   * 检查缸号一致性：该生产订单是否已绑定不同缸号
   * @returns true 表示跨缸号（需要警告）
   */
  private async checkDyeLotConsistency(
    productionOrderId: number, skuId: number, dyeLotNo: string,
  ): Promise<boolean> {
    const [binding] = await AppDataSource.query<Array<{ dye_lot_no: string }>>(
      `SELECT dye_lot_no FROM order_dye_lot_bindings
       WHERE production_order_id = ? AND sku_id = ? LIMIT 1`,
      [productionOrderId, skuId],
    );
    if (!binding) return false; // 首次领用，无约束
    return binding.dye_lot_no !== dyeLotNo;
  }

  private async syncDailySnapshot(
    manager: { query: typeof AppDataSource.query },
    skuId: number,
  ): Promise<void> {
    await syncInventoryDailySnapshotForSku(manager, this.tenantId, skuId);
  }

  private generateTxNo(direction: 'IN' | 'OUT'): string {
    const now = new Date();
    const ts = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
      String(now.getHours()).padStart(2, '0'),
      String(now.getMinutes()).padStart(2, '0'),
      String(now.getSeconds()).padStart(2, '0'),
    ].join('');
    const rand = Math.floor(Math.random() * 9999).toString().padStart(4, '0');
    return `${direction}${ts}${rand}`;
  }

  private async checkSafetyStockAlert(
    skuId: number,
    sku: { safetyStock: string; stockUnit: string },
  ): Promise<void> {
    const { qtyAvailable } = await this.getAvailableStock(skuId);
    if (qtyAvailable.lt(new Decimal(sku.safetyStock))) {
      // 检查今日是否已发送过预警（防止消息轰炸）
      const today = new Date().toISOString().slice(0, 10);
      const alertKey = RedisKeys.alertSent(this.tenantId, skuId, today);
      const redis = getRedisClient();
      const alreadySent = await redis.get(alertKey);
      if (!alreadySent) {
        await redis.setex(alertKey, RedisTTL.ALERT_SENT, '1');
        // 将预警推入通知队列（实际实现中对接 Bull 队列）
        console.info(`[InventoryAlert] 租户${this.tenantId} SKU${skuId} 库存低于安全库存`);
      }
    }
  }

  // ── BE-P1-004: 物料损耗录入 ───────────────────────────────

  /**
   * 记录物料损耗：
   * 1. 扣减 inventory.qty_on_hand
   * 2. 插入 inventory_transactions（type = 'waste_out'，direction = 'OUT'）
   * 3. 失效 Redis 库存快照缓存
   *
   * 返回事务编号和损耗后的新库存量。
   */
  async recordWaste(params: {
    skuId: number;
    warehouseId?: number;
    locationId?: number;
    qty: string;
    reason: string;
    notes?: string;
  }): Promise<{
    transactionNo: string;
    newQtyOnHand: string;
    warehouseId: number;
    locationId: number;
    warningCode?: string;
  }> {
    const sku = await this.getSkuInfo(params.skuId);
    let trackedInventoryManager: InventoryTrackedQueryRunner | null = null;

    // 尝试获取 Redis 分布式锁（与入库/出库保持一致策略）
    const lockKey = RedisKeys.inventoryLock(this.tenantId, params.skuId);
    let lockVal: string | null = null;
    let redisLockAcquired = false;

    try {
      lockVal = await acquireLock(lockKey, 5000);
      if (lockVal === null) {
        throw new AppError('库存操作繁忙，请稍后重试', ResponseCode.INVENTORY_LOCK_FAILED);
      }
      redisLockAcquired = true;
    } catch (err) {
      if (err instanceof AppError) throw err;
      console.warn('[InventoryService] Redis 分布式锁不可用，降级到 DB 行锁（损耗录入）:', (err as Error).message);
    }

    const wasteQty = new Decimal(params.qty);

    let result: {
      transactionNo: string;
      newQtyOnHand: string;
      warehouseId: number;
      locationId: number;
      warningCode?: string;
    };
    try {
      result = await AppDataSource.transaction(async (manager) => {
        trackedInventoryManager = manager as InventoryTrackedQueryRunner;
        const resolvedSourceRef = 'api:inventory:waste';
        const warehouseLocation = await this.resolveWarehouseLocation(
          manager,
          params,
          resolvedSourceRef,
        );
        // DB 行锁：防止并发超扣
        const [inv] = await manager.query<Array<{ qty_on_hand: string; qty_reserved: string }>>(
          `SELECT qty_on_hand, qty_reserved
           FROM inventory
           WHERE tenant_id = ? AND sku_id = ? AND warehouse_id = ? AND location_id = ?
           LIMIT 1
           FOR UPDATE`,
          [
            this.tenantId,
            params.skuId,
            warehouseLocation.warehouseId,
            warehouseLocation.locationId,
          ],
        );
        if (!inv) throw new AppError('库存记录不存在', ResponseCode.INVENTORY_INSUFFICIENT);

        const onHand = new Decimal(inv.qty_on_hand);
        if (wasteQty.gt(onHand)) {
          throw new AppError(
            `在库数量不足：在库 ${onHand.toFixed(4)} ${sku.stockUnit}，损耗录入 ${wasteQty.toFixed(4)} ${sku.stockUnit}`,
            ResponseCode.INVENTORY_INSUFFICIENT,
          );
        }

        const txNo = this.generateTxNo('OUT');

        // 插入损耗流水（transaction_type = 'waste_out'）
        await manager.query(
          `INSERT INTO inventory_transactions
             (tenant_id, transaction_no, sku_id, transaction_type, direction,
              warehouse_id, location_id, source_ref,
              qty_input, input_unit, qty_stock_unit, stock_unit,
              notes, created_by, updated_by)
           VALUES (?,?,?,'waste_out','OUT', ?,?,?, ?,?,?,?, ?)`,
          [
            this.tenantId, txNo, params.skuId,
            warehouseLocation.warehouseId, warehouseLocation.locationId, resolvedSourceRef,
            params.qty, sku.stockUnit, wasteQty.toFixed(4), sku.stockUnit,
            params.notes ? `[${params.reason}] ${params.notes}` : params.reason,
            this.userId, this.userId,
          ],
        );

        // 扣减库存快照
        await manager.query(
          `UPDATE inventory
           SET qty_on_hand = qty_on_hand - ?, last_out_at = NOW(), updated_by = ?
           WHERE tenant_id = ? AND sku_id = ? AND warehouse_id = ? AND location_id = ?`,
          [
            wasteQty.toFixed(4),
            this.userId,
            this.tenantId,
            params.skuId,
            warehouseLocation.warehouseId,
            warehouseLocation.locationId,
          ],
        );

        await this.syncDailySnapshot(manager, params.skuId);
        this.trackInventorySnapshotCacheInvalidation(manager, [params.skuId]);

        const [updated] = await manager.query<Array<{ qty: string }>>(
          `SELECT qty_on_hand AS qty
           FROM inventory
           WHERE tenant_id = ? AND sku_id = ? AND warehouse_id = ? AND location_id = ?
           LIMIT 1`,
          [
            this.tenantId,
            params.skuId,
            warehouseLocation.warehouseId,
            warehouseLocation.locationId,
          ],
        );

        return {
          transactionNo: txNo,
          newQtyOnHand: updated?.qty ?? '0',
          warehouseId: warehouseLocation.warehouseId,
          locationId: warehouseLocation.locationId,
          warningCode: warehouseLocation.warningCode ?? undefined,
        };
      });
    } finally {
      if (redisLockAcquired && lockVal) {
        await releaseLock(lockKey, lockVal);
      }
    }

    await this.invalidateInventorySnapshotCaches(
      this.consumeTrackedInventorySnapshotSkuIds(trackedInventoryManager),
    );
    this.checkSafetyStockAlert(params.skuId, sku).catch(console.error);
    return result;
  }

  // ── BE-P1-005: 库存汇总（按一级分类聚合） ─────────────────

  async getSummary(): Promise<{
    categories: Array<{
      categoryId: number;
      categoryName: string;
      totalQty: number;
      skuCount: number;
      alertCount: number;
    }>;
    totalSkuCount: number;
    totalAlertCount: number;
  }> {
    const warehouseScope = await this.getWarehouseDataScope();
    const conditions = ['i.tenant_id = ?'];
    const params: Array<string | number> = [this.tenantId];
    if (warehouseScope.mode === 'none') {
      conditions.push('1 = 0');
    } else if (warehouseScope.mode === 'assigned') {
      conditions.push(`i.warehouse_id IN (${warehouseScope.warehouseIds.map(() => '?').join(',')})`);
      params.push(...warehouseScope.warehouseIds);
    }

    const rows = await AppDataSource.query(
      `SELECT
         sc.id AS categoryId, sc.name AS categoryName,
         COUNT(DISTINCT i.sku_id) AS skuCount,
         COALESCE(SUM(i.qty_on_hand), 0) AS totalQty,
         SUM(CASE WHEN i.qty_on_hand - i.qty_reserved < COALESCE(s.safety_stock, 0) THEN 1 ELSE 0 END) AS alertCount
       FROM inventory i
       INNER JOIN skus s ON s.id = i.sku_id AND s.tenant_id = i.tenant_id
       INNER JOIN sku_categories sc ON sc.id = s.category1_id AND sc.level = 1
       WHERE ${conditions.join(' AND ')}
       GROUP BY sc.id, sc.name
       ORDER BY sc.id`,
      params,
    );
    const categories = rows.map((r: any) => ({
      categoryId: Number(r.categoryId),
      categoryName: r.categoryName,
      totalQty: Number(r.totalQty),
      skuCount: Number(r.skuCount),
      alertCount: Number(r.alertCount),
    }));
    return {
      categories,
      totalSkuCount: categories.reduce((a: number, c: { skuCount: number }) => a + c.skuCount, 0),
      totalAlertCount: categories.reduce((a: number, c: { alertCount: number }) => a + c.alertCount, 0),
    };
  }

  // ─── BE-P1-003: 库存盘点接口 ──────────────────────────────

  async startStocktake(): Promise<{ stocktakeId: number; stocktakeNo: string }> {
    const no = `ST${Date.now()}`;
    const [result] = await AppDataSource.query(
      `INSERT INTO inventory_stocktakes (tenant_id, stocktake_no, status, created_by)
       VALUES (?, ?, 'in_progress', ?)`,
      [this.tenantId, no, this.userId],
    );
    return { stocktakeId: result.insertId, stocktakeNo: no };
  }

  async submitStocktakeItem(stocktakeId: number, skuId: number, countedQty: string): Promise<void> {
    const [inv] = await AppDataSource.query(
      `SELECT qty_on_hand FROM inventory WHERE tenant_id = ? AND sku_id = ?`,
      [this.tenantId, skuId],
    );
    const systemQty = inv?.qty_on_hand ?? '0';
    const diff = new Decimal(countedQty).minus(systemQty).toFixed(4);
    await AppDataSource.query(
      `INSERT INTO inventory_stocktake_items
         (stocktake_id, tenant_id, sku_id, system_qty, counted_qty, diff_qty)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE counted_qty = VALUES(counted_qty), diff_qty = VALUES(diff_qty)`,
      [stocktakeId, this.tenantId, skuId, systemQty, countedQty, diff],
    );
  }

  async getStocktakeDiff(stocktakeId: number): Promise<Array<{
    skuId: number; skuName: string; systemQty: string; countedQty: string; diffQty: string;
  }>> {
    const rows = await AppDataSource.query(
      `SELECT si.sku_id, s.name AS sku_name, si.system_qty, si.counted_qty, si.diff_qty
       FROM inventory_stocktake_items si
       INNER JOIN skus s ON s.id = si.sku_id
       WHERE si.stocktake_id = ? AND si.tenant_id = ? AND si.diff_qty != 0
       ORDER BY ABS(si.diff_qty) DESC`,
      [stocktakeId, this.tenantId],
    );
    return rows.map((r: Record<string, unknown>) => ({
      skuId: Number(r.sku_id),
      skuName: String(r.sku_name),
      systemQty: String(r.system_qty),
      countedQty: String(r.counted_qty),
      diffQty: String(r.diff_qty),
    }));
  }
}
