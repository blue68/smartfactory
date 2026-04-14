import type { BusinessClass, ControlMode, ReceiptMode } from '@/types/models';

export function formatBusinessClassLabel(value?: BusinessClass | string | null): string {
  if (value === 'consumable') return '损耗品';
  if (value === 'fixed_asset') return '固定资产';
  if (value === 'production_material') return '生产物料';
  return '待补配置';
}

export function formatReceiptModeLabel(value?: ReceiptMode | string | null): string {
  if (value === 'inventory') return '库存入库';
  if (value === 'direct_expense') return '直耗';
  if (value === 'asset_capitalization') return '资产待验收';
  return '待补配置';
}

export function resolveReceiptModeByControlMode(controlMode?: ControlMode | string | null): ReceiptMode {
  if (controlMode === 'direct_expense') return 'direct_expense';
  if (controlMode === 'asset') return 'asset_capitalization';
  return 'inventory';
}

export function formatReceiptNextStepLabel(receiptMode?: ReceiptMode | string | null): string {
  if (receiptMode === 'inventory') return '进入库存，可继续发起领用';
  if (receiptMode === 'direct_expense') return '到货即费用化，不进入库存';
  if (receiptMode === 'asset_capitalization') return '进入资产验收池，待建卡';
  return '按默认采购收货路径处理';
}
