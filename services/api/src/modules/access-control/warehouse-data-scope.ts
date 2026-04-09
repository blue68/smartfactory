import { AppDataSource } from '../../config/database';
import { AppError } from '../../shared/AppError';
import { PermissionSnapshot } from './access-control.types';

export type WarehouseDataScope =
  | { mode: 'all'; warehouseIds: [] }
  | { mode: 'assigned'; warehouseIds: number[] }
  | { mode: 'none'; warehouseIds: [] };

function buildInClause(values: Array<string | number>): string {
  if (values.length === 0) {
    return 'NULL';
  }
  return values.map(() => '?').join(',');
}

function uniqueNumbers(values: number[]): number[] {
  return Array.from(new Set(values.filter((value) => Number.isInteger(value) && value > 0))).sort((a, b) => a - b);
}

export async function resolveWarehouseDataScope(
  tenantId: number,
  snapshot?: PermissionSnapshot,
): Promise<WarehouseDataScope> {
  if (!snapshot || snapshot.dataScopes.length === 0) {
    return { mode: 'all', warehouseIds: [] };
  }

  if (snapshot.dataScopes.some((scope) => scope.scopeType === 'all')) {
    return { mode: 'all', warehouseIds: [] };
  }

  const warehouseScopes = snapshot.dataScopes.filter((scope) => scope.scopeType === 'warehouse_assigned');
  if (warehouseScopes.length === 0) {
    return { mode: 'all', warehouseIds: [] };
  }

  const requestedIds = new Set<number>();
  const requestedCodes = new Set<string>();

  warehouseScopes.forEach((scope) => {
    scope.scopeValues.forEach((value) => {
      if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
        requestedIds.add(value);
        return;
      }

      const numericValue = Number(String(value ?? '').trim());
      if (Number.isInteger(numericValue) && numericValue > 0) {
        requestedIds.add(numericValue);
        return;
      }

      const normalizedCode = String(value ?? '').trim().toUpperCase();
      if (normalizedCode) {
        requestedCodes.add(normalizedCode);
      }
    });
  });

  if (requestedIds.size === 0 && requestedCodes.size === 0) {
    return { mode: 'none', warehouseIds: [] };
  }

  const conditions: string[] = ['tenant_id = ?'];
  const params: Array<string | number> = [tenantId];

  if (requestedIds.size > 0 || requestedCodes.size > 0) {
    const scopeConditions: string[] = [];
    if (requestedIds.size > 0) {
      const ids = Array.from(requestedIds);
      scopeConditions.push(`id IN (${buildInClause(ids)})`);
      params.push(...ids);
    }
    if (requestedCodes.size > 0) {
      const codes = Array.from(requestedCodes);
      scopeConditions.push(`UPPER(code) IN (${buildInClause(codes)})`);
      params.push(...codes);
    }
    conditions.push(`(${scopeConditions.join(' OR ')})`);
  }

  const rows = await AppDataSource.query<Array<{ id: number }>>(
    `SELECT id
       FROM warehouses
      WHERE ${conditions.join(' AND ')}`,
    params,
  );

  const warehouseIds = uniqueNumbers(rows.map((row) => Number(row.id)));
  if (warehouseIds.length === 0) {
    return { mode: 'none', warehouseIds: [] };
  }

  return { mode: 'assigned', warehouseIds };
}

export function assertWarehouseInScope(
  scope: WarehouseDataScope,
  warehouseId: number | null | undefined,
  message = '所选仓库不在授权范围内',
): void {
  if (scope.mode === 'all') {
    return;
  }

  if (scope.mode !== 'assigned' || !warehouseId || !scope.warehouseIds.includes(Number(warehouseId))) {
    throw AppError.forbidden(message);
  }
}
