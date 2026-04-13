export const SKU_BUSINESS_CLASSES = [
  'production_material',
  'consumable',
  'fixed_asset',
] as const;

export const SKU_CONTROL_MODES = [
  'mrp',
  'stock_only',
  'direct_expense',
  'asset',
] as const;

export const SKU_ASSET_TRACKING_MODES = [
  'none',
  'batch',
  'serial',
] as const;

export const SKU_APPROVAL_LEVELS = [
  'none',
  'normal',
  'strict',
] as const;

export const SKU_CONSUMABLE_ISSUE_MODES = [
  'department_issue',
  'direct_expense',
] as const;

export const SKU_DEPRECIATION_METHODS = [
  'straight_line',
  'manual',
  'none',
] as const;

export type SkuBusinessClass = typeof SKU_BUSINESS_CLASSES[number];
export type SkuControlMode = typeof SKU_CONTROL_MODES[number];
export type SkuAssetTrackingMode = typeof SKU_ASSET_TRACKING_MODES[number];
export type SkuApprovalLevel = typeof SKU_APPROVAL_LEVELS[number];
export type SkuConsumableIssueMode = typeof SKU_CONSUMABLE_ISSUE_MODES[number];
export type SkuDepreciationMethod = typeof SKU_DEPRECIATION_METHODS[number];

export interface ConsumableProfileInput {
  issueMode?: SkuConsumableIssueMode;
  approvalLevel?: SkuApprovalLevel;
  expenseSubject?: string;
  minStock?: string;
  maxStock?: string | null;
  purchaseLeadDays?: number | null;
  issueDeptRequired?: boolean;
  notes?: string;
}

export interface AssetProfileInput {
  assetCategory: string;
  depreciationMethod?: SkuDepreciationMethod;
  usefulLifeMonths?: number | null;
  residualRate?: string;
  capexSubject?: string;
  requiresSerialNo?: boolean;
  maintenanceCycleDays?: number | null;
  warrantyMonths?: number | null;
  notes?: string;
}

