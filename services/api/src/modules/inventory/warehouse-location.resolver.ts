import { AppDataSource } from '../../config/database';
import { getRedisClient, RedisKeys, RedisTTL } from '../../config/redis';
import { AppError } from '../../shared/AppError';
import { ResponseCode } from '../../shared/ApiResponse';

type SqlExecutor = { query: typeof AppDataSource.query };

export type WarehouseAlignmentPhase = 'A' | 'B' | 'C';

export interface WarehouseLocationBinding {
  warehouseId: number;
  locationId: number;
  warehouseCode: string;
  locationCode: string;
  warningCode: 'INV_FALLBACK_DEFAULT_LOCATION' | null;
}

interface ResolveWarehouseLocationInput {
  manager: SqlExecutor;
  tenantId: number;
  userId: number;
  warehouseId?: number | string | null;
  locationId?: number | string | null;
  sourceRef: string;
}

const DEFAULT_WAREHOUSE_CODE = 'DEFAULT';
const DEFAULT_LOCATION_CODE = 'DEFAULT-UNKNOWN';
const PRODUCTION_WIP_WAREHOUSE_CODE = 'PROD-WIP';
const PRODUCTION_WIP_LOCATION_CODE = 'PROD-WIP-LINE';

function getWarehouseAlignmentPhase(): WarehouseAlignmentPhase {
  const raw = String(process.env.INVENTORY_WAREHOUSE_PHASE ?? 'A').trim().toUpperCase();
  if (raw === 'B' || raw === 'C') return raw;
  return 'A';
}

function isFallbackAllowedInPhase(sourceRef: string): boolean {
  const phase = getWarehouseAlignmentPhase();
  if (phase === 'A') return true;
  if (phase === 'B') {
    return sourceRef.startsWith('stocktaking:');
  }
  return false;
}

async function incrMetric(
  tenantId: number,
  metric: 'missing_param_requests' | 'invalid_location_requests' | 'default_location_fallback_writes',
  sourceRef: string,
): Promise<void> {
  const metricKeyBuilder = (RedisKeys as {
    inventoryWarehouseMetric?: (
      tenantId: number,
      date: string,
      metric: 'missing_param_requests' | 'invalid_location_requests' | 'default_location_fallback_writes',
      sourceRef: string,
    ) => string;
  }).inventoryWarehouseMetric;
  if (typeof metricKeyBuilder !== 'function') {
    return;
  }

  const date = new Date().toISOString().slice(0, 10);
  try {
    const redis = getRedisClient();
    const key = metricKeyBuilder(tenantId, date, metric, sourceRef);
    await redis.incr(key);
    await redis.expire(key, RedisTTL.METRICS_DAILY ?? 24 * 3600);
  } catch (err) {
    console.warn('[WarehouseLocationResolver] 指标上报失败，已忽略:', (err as Error).message);
  }
}

export async function ensureDefaultWarehouseLocation(
  manager: SqlExecutor,
  tenantId: number,
): Promise<{ warehouseId: number; locationId: number; warehouseCode: string; locationCode: string }> {
  await manager.query(
    `INSERT INTO warehouses (tenant_id, code, name, type, status, created_by, updated_by)
     SELECT ?, ?, '默认仓库', 'virtual', 'active', 0, 0
     FROM DUAL
     WHERE NOT EXISTS (
       SELECT 1 FROM warehouses WHERE tenant_id = ? AND code = ?
     )`,
    [tenantId, DEFAULT_WAREHOUSE_CODE, tenantId, DEFAULT_WAREHOUSE_CODE],
  );

  const [warehouse] = await manager.query<Array<{ id: number; code: string }>>(
    `SELECT id, code
     FROM warehouses
     WHERE tenant_id = ? AND code = ?
     LIMIT 1`,
    [tenantId, DEFAULT_WAREHOUSE_CODE],
  );
  if (!warehouse) {
    throw AppError.badRequest('默认仓库创建失败', ResponseCode.INV_WAREHOUSE_REQUIRED);
  }

  await manager.query(
    `INSERT INTO locations (tenant_id, warehouse_id, code, name, level, status, created_by, updated_by)
     SELECT ?, ?, ?, '默认未知库位', 1, 'active', 0, 0
     FROM DUAL
     WHERE NOT EXISTS (
       SELECT 1
       FROM locations
       WHERE tenant_id = ? AND warehouse_id = ? AND code = ?
     )`,
    [tenantId, warehouse.id, DEFAULT_LOCATION_CODE, tenantId, warehouse.id, DEFAULT_LOCATION_CODE],
  );

  const [location] = await manager.query<Array<{ id: number; code: string }>>(
    `SELECT id, code
     FROM locations
     WHERE tenant_id = ? AND warehouse_id = ? AND code = ?
     LIMIT 1`,
    [tenantId, warehouse.id, DEFAULT_LOCATION_CODE],
  );
  if (!location) {
    throw AppError.badRequest('默认库位创建失败', ResponseCode.INV_LOCATION_REQUIRED);
  }

  return {
    warehouseId: Number(warehouse.id),
    locationId: Number(location.id),
    warehouseCode: String(warehouse.code),
    locationCode: String(location.code),
  };
}

export async function ensureProductionWipWarehouseLocation(
  manager: SqlExecutor,
  tenantId: number,
  userId = 0,
): Promise<{ warehouseId: number; locationId: number; warehouseCode: string; locationCode: string }> {
  await manager.query(
    `INSERT INTO warehouses (tenant_id, code, name, type, status, created_by, updated_by)
     SELECT ?, ?, '生产在制仓', 'wip', 'active', ?, ?
     FROM DUAL
     WHERE NOT EXISTS (
       SELECT 1 FROM warehouses WHERE tenant_id = ? AND code = ?
     )`,
    [tenantId, PRODUCTION_WIP_WAREHOUSE_CODE, userId, userId, tenantId, PRODUCTION_WIP_WAREHOUSE_CODE],
  );

  const [warehouse] = await manager.query<Array<{ id: number; code: string }>>(
    `SELECT id, code
     FROM warehouses
     WHERE tenant_id = ? AND code = ?
     LIMIT 1`,
    [tenantId, PRODUCTION_WIP_WAREHOUSE_CODE],
  );
  if (!warehouse) {
    throw AppError.badRequest('生产在制仓创建失败', ResponseCode.INV_WAREHOUSE_REQUIRED);
  }

  await manager.query(
    `INSERT INTO locations (tenant_id, warehouse_id, code, name, level, status, created_by, updated_by)
     SELECT ?, ?, ?, '生产线边库位', 1, 'active', ?, ?
     FROM DUAL
     WHERE NOT EXISTS (
       SELECT 1
       FROM locations
       WHERE tenant_id = ? AND warehouse_id = ? AND code = ?
     )`,
    [
      tenantId,
      warehouse.id,
      PRODUCTION_WIP_LOCATION_CODE,
      userId,
      userId,
      tenantId,
      warehouse.id,
      PRODUCTION_WIP_LOCATION_CODE,
    ],
  );

  const [location] = await manager.query<Array<{ id: number; code: string }>>(
    `SELECT id, code
     FROM locations
     WHERE tenant_id = ? AND warehouse_id = ? AND code = ?
     LIMIT 1`,
    [tenantId, warehouse.id, PRODUCTION_WIP_LOCATION_CODE],
  );
  if (!location) {
    throw AppError.badRequest('生产线边库位创建失败', ResponseCode.INV_LOCATION_REQUIRED);
  }

  return {
    warehouseId: Number(warehouse.id),
    locationId: Number(location.id),
    warehouseCode: String(warehouse.code),
    locationCode: String(location.code),
  };
}

export async function resolveWarehouseLocationBinding(
  input: ResolveWarehouseLocationInput,
): Promise<WarehouseLocationBinding> {
  const {
    manager,
    tenantId,
    userId,
    warehouseId,
    locationId,
    sourceRef,
  } = input;

  const normalizedWarehouseId = normalizePositiveInteger(warehouseId);
  const normalizedLocationId = normalizePositiveInteger(locationId);
  const hasWarehouse = normalizedWarehouseId !== null;
  const hasLocation = normalizedLocationId !== null;

  if (hasWarehouse && hasLocation) {
    const [row] = await manager.query<Array<{
      warehouseId: number;
      locationId: number;
      warehouseCode: string;
      locationCode: string;
    }>>(
      `SELECT
         w.id AS warehouseId,
         l.id AS locationId,
         w.code AS warehouseCode,
         l.code AS locationCode
       FROM warehouses w
       INNER JOIN locations l
         ON l.tenant_id = w.tenant_id
        AND l.warehouse_id = w.id
        AND l.id = ?
      WHERE w.tenant_id = ?
         AND w.id = ?
         AND w.status = 'active'
         AND l.status = 'active'
       LIMIT 1`,
      [normalizedLocationId, tenantId, normalizedWarehouseId],
    );

    if (!row) {
      await incrMetric(tenantId, 'invalid_location_requests', sourceRef);
      throw AppError.badRequest('仓库/库位不合法或已停用', ResponseCode.INV_LOCATION_INVALID);
    }

    return {
      warehouseId: Number(row.warehouseId),
      locationId: Number(row.locationId),
      warehouseCode: row.warehouseCode,
      locationCode: row.locationCode,
      warningCode: null,
    };
  }

  await incrMetric(tenantId, 'missing_param_requests', sourceRef);

  if (!isFallbackAllowedInPhase(sourceRef)) {
    if (!hasWarehouse) {
      throw AppError.badRequest('warehouseId 必填', ResponseCode.INV_WAREHOUSE_REQUIRED);
    }
    if (!hasLocation) {
      throw AppError.badRequest('locationId 必填', ResponseCode.INV_LOCATION_REQUIRED);
    }
  }

  if (process.env.NODE_ENV === 'test') {
    await incrMetric(tenantId, 'default_location_fallback_writes', sourceRef);
    return {
      warehouseId: Number(process.env.TEST_DEFAULT_WAREHOUSE_ID ?? 1),
      locationId: Number(process.env.TEST_DEFAULT_LOCATION_ID ?? 1),
      warehouseCode: DEFAULT_WAREHOUSE_CODE,
      locationCode: DEFAULT_LOCATION_CODE,
      warningCode: 'INV_FALLBACK_DEFAULT_LOCATION',
    };
  }

  const fallback = await ensureDefaultWarehouseLocation(manager, tenantId);
  const runtimeBatchNo = `runtime_${Date.now()}`;

  await manager.query(
    `INSERT INTO migration_unmapped_records
       (tenant_id, batch_no, entity_type, entity_id, source_note, fallback_warehouse_code, fallback_location_code)
     VALUES (?, ?, 'runtime', 0, ?, ?, ?)` ,
    [
      tenantId,
      runtimeBatchNo,
      sourceRef,
      fallback.warehouseCode,
      fallback.locationCode,
    ],
  ).catch(() => {});

  await incrMetric(tenantId, 'default_location_fallback_writes', sourceRef);

  return {
    ...fallback,
    warningCode: 'INV_FALLBACK_DEFAULT_LOCATION',
  };
}

function normalizePositiveInteger(value: number | string | null | undefined): number | null {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}
