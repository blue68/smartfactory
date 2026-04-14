import type { DepartmentSummary } from '@/types/models';

export function normalizeDepartmentId(value?: string | number | null): number | null {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

export function buildDepartmentMap(list: DepartmentSummary[]): Map<number, DepartmentSummary> {
  return new Map(list.map((item) => [item.id, item]));
}

export function formatDepartmentLabel(
  value: string | number | null | undefined,
  departmentMap?: Map<number, DepartmentSummary>,
): string {
  const departmentId = normalizeDepartmentId(value);
  if (!departmentId) return '未指定';
  const department = departmentMap?.get(departmentId);
  if (!department) return `部门 #${departmentId}`;
  return `${department.name} (${department.code})`;
}
