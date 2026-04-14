import type { AssetMovement } from '@/types/models';

const ASSET_CATEGORY_LABELS: Record<string, string> = {
  equipment: '生产设备',
  it: 'IT 设备',
  office: '办公资产',
  vehicle: '车辆',
  fixture: '工装夹具',
  tooling: '工装治具',
};

const DEPRECIATION_METHOD_LABELS: Record<string, string> = {
  straight_line: '直线法',
  manual: '手工折旧',
  none: '不折旧',
};

export function formatAssetCategoryLabel(value?: string | null): string {
  if (!value) return '未配置';
  return ASSET_CATEGORY_LABELS[value] || value;
}

export function formatDepreciationMethodLabel(value?: string | null): string {
  if (!value) return '未配置';
  return DEPRECIATION_METHOD_LABELS[value] || value;
}

export function formatAssetReferenceTypeLabel(value?: string | null): string {
  if (value === 'purchase_receipt') return '采购入库单';
  if (value === 'asset_card') return '资产卡片';
  return value || '未知来源';
}

export function formatAssetMovementPosition(params: {
  departmentName?: string | null;
  departmentId?: number | null;
  locationText?: string | null;
}): string {
  const tokens: string[] = [];
  if (params.locationText) {
    tokens.push(String(params.locationText));
  }
  if (params.departmentName) {
    tokens.push(params.departmentName);
  } else if (params.departmentId) {
    tokens.push(`部门 #${params.departmentId}`);
  }
  return tokens.join(' / ') || '—';
}

export function formatAssetMovementSource(movement: AssetMovement): string {
  const typeLabel = formatAssetReferenceTypeLabel(movement.referenceType);
  const reference = movement.referenceNo || movement.referenceId || '—';
  return `${typeLabel} · ${reference}`;
}
