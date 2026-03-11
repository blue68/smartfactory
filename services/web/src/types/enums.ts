/**
 * [artifact:前端代码] — 枚举定义
 * 覆盖所有业务状态、分类、角色枚举
 */

// ─────────────────────────────────────────────
// 用户角色
// ─────────────────────────────────────────────
export enum UserRole {
  BOSS = 'boss',
  PURCHASER = 'purchaser',
  WAREHOUSE = 'warehouse',
  SUPERVISOR = 'supervisor',
  WORKER = 'worker',
  QC = 'qc',
  SALES = 'sales',
}

export const UserRoleLabel: Record<UserRole, string> = {
  [UserRole.BOSS]: '工厂老板',
  [UserRole.PURCHASER]: '采购员',
  [UserRole.WAREHOUSE]: '仓库管理员',
  [UserRole.SUPERVISOR]: '车间主管',
  [UserRole.WORKER]: '生产工人',
  [UserRole.QC]: 'QC验货员',
  [UserRole.SALES]: '销售人员',
};

// ─────────────────────────────────────────────
// SKU 状态
// ─────────────────────────────────────────────
export enum SkuStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  PENDING = 'pending',
}

export const SkuStatusLabel: Record<SkuStatus, string> = {
  [SkuStatus.ACTIVE]: '启用',
  [SkuStatus.INACTIVE]: '停用',
  [SkuStatus.PENDING]: '待审',
};

/** 安全库存筛选状态（仅供前端筛选 UI 使用，非后端枚举） */
export enum SkuStockStatus {
  ALL = '',
  NORMAL = 'normal',
  NO_SAFETY = 'no_safety',
  INACTIVE = 'inactive',
}

// ─────────────────────────────────────────────
// SKU 一级分类 code（对应后端 category.code）
// ─────────────────────────────────────────────
export enum Category1Code {
  RAW_MATERIAL = 'RAW_MATERIAL',
  SEMI_PRODUCT = 'SEMI_PRODUCT',
  FINISHED = 'FINISHED',
}

export const Category1Label: Record<Category1Code, string> = {
  [Category1Code.RAW_MATERIAL]: '原材料',
  [Category1Code.SEMI_PRODUCT]: '半成品',
  [Category1Code.FINISHED]: '成品',
};

// ─────────────────────────────────────────────
// SKU 二级分类 code
// ─────────────────────────────────────────────
export enum Category2Code {
  // 原材料子类
  BOARD = 'BOARD',
  HARDWARE = 'HARDWARE',
  FABRIC = 'FABRIC',
  FOAM = 'FOAM',
  PAINT = 'PAINT',
  ADHESIVE = 'ADHESIVE',
  PACK = 'PACK',
  OTHER_RAW = 'OTHER_RAW',
  // 半成品子类
  FRAME = 'FRAME',
  COVER = 'COVER',
  ASSEMBLY = 'ASSEMBLY',
  // 成品子类
  SOFA = 'SOFA',
  CABINET = 'CABINET',
  TABLE = 'TABLE',
  BED = 'BED',
  CUSTOM = 'CUSTOM',
  // 未分类
  NONE = 'NONE',
}

export const Category2Label: Record<Category2Code, string> = {
  [Category2Code.BOARD]: '板材类',
  [Category2Code.HARDWARE]: '五金类',
  [Category2Code.FABRIC]: '面料类',
  [Category2Code.FOAM]: '海绵类',
  [Category2Code.PAINT]: '油漆涂料类',
  [Category2Code.ADHESIVE]: '胶粘剂类',
  [Category2Code.PACK]: '包装材料类',
  [Category2Code.OTHER_RAW]: '其他辅料',
  [Category2Code.FRAME]: '框架类',
  [Category2Code.COVER]: '面套类',
  [Category2Code.ASSEMBLY]: '组合件类',
  [Category2Code.SOFA]: '沙发类',
  [Category2Code.CABINET]: '柜类',
  [Category2Code.TABLE]: '桌类',
  [Category2Code.BED]: '床类',
  [Category2Code.CUSTOM]: '其他定制品',
  [Category2Code.NONE]: '未分类',
};

// ─────────────────────────────────────────────
// BOM 状态
// ─────────────────────────────────────────────
export enum BomStatus {
  DRAFT = 'draft',
  ACTIVE = 'active',
  ARCHIVED = 'archived',
}

export const BomStatusLabel: Record<BomStatus, string> = {
  [BomStatus.DRAFT]: '草稿',
  [BomStatus.ACTIVE]: '已激活',
  [BomStatus.ARCHIVED]: '已归档',
};

// ─────────────────────────────────────────────
// 库存流水类型
// ─────────────────────────────────────────────
export enum TransactionType {
  PURCHASE_IN = 'PURCHASE_IN',
  PRODUCTION_IN = 'PRODUCTION_IN',
  ADJUSTMENT_IN = 'ADJUSTMENT_IN',
  MATERIAL_OUT = 'MATERIAL_OUT',
  DELIVERY_OUT = 'DELIVERY_OUT',
  ADJUSTMENT_OUT = 'ADJUSTMENT_OUT',
}

export const TransactionTypeLabel: Record<TransactionType, string> = {
  [TransactionType.PURCHASE_IN]: '采购入库',
  [TransactionType.PRODUCTION_IN]: '生产入库',
  [TransactionType.ADJUSTMENT_IN]: '盘盈调整',
  [TransactionType.MATERIAL_OUT]: '领料出库',
  [TransactionType.DELIVERY_OUT]: '发货出库',
  [TransactionType.ADJUSTMENT_OUT]: '盘亏调整',
};

// ─────────────────────────────────────────────
// 采购建议状态
// ─────────────────────────────────────────────
export enum SuggestionStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  EXECUTED = 'executed',
  EXPIRED = 'expired',
  /** 已转为采购单 */
  CONVERTED = 'converted',
}

export const SuggestionStatusLabel: Record<SuggestionStatus, string> = {
  [SuggestionStatus.PENDING]: '待审批',
  [SuggestionStatus.APPROVED]: '已批准',
  [SuggestionStatus.REJECTED]: '已驳回',
  [SuggestionStatus.EXECUTED]: '已执行',
  [SuggestionStatus.EXPIRED]: '已过期',
  [SuggestionStatus.CONVERTED]: '已转单',
};

// ─────────────────────────────────────────────
// AI 置信度
// ─────────────────────────────────────────────
export enum Confidence {
  HIGH = 'high',
  MEDIUM = 'medium',
  LOW = 'low',
}

export const ConfidenceLabel: Record<Confidence, string> = {
  [Confidence.HIGH]: '高置信度',
  [Confidence.MEDIUM]: '中置信度',
  [Confidence.LOW]: '低置信度',
};

// ─────────────────────────────────────────────
// 采购订单状态
// ─────────────────────────────────────────────
export enum PurchaseOrderStatus {
  DRAFT = 'draft',
  CONFIRMED = 'confirmed',
  PARTIAL = 'partial',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
}

export const PurchaseOrderStatusLabel: Record<PurchaseOrderStatus, string> = {
  [PurchaseOrderStatus.DRAFT]: '草稿',
  [PurchaseOrderStatus.CONFIRMED]: '已确认',
  [PurchaseOrderStatus.PARTIAL]: '部分到货',
  [PurchaseOrderStatus.COMPLETED]: '已完成',
  [PurchaseOrderStatus.CANCELLED]: '已取消',
};

// ─────────────────────────────────────────────
// 三单匹配状态
// ─────────────────────────────────────────────
export enum MatchStatus {
  MATCHED = 'matched',
  QTY_DIFF = 'qty_diff',
  PRICE_DIFF = 'price_diff',
  PRICE_WARNING = 'price_warning',
  CONFIRMED = 'confirmed',
}

export const MatchStatusLabel: Record<MatchStatus, string> = {
  [MatchStatus.MATCHED]: '完全匹配',
  [MatchStatus.QTY_DIFF]: '数量差异',
  [MatchStatus.PRICE_DIFF]: '价格差异',
  [MatchStatus.PRICE_WARNING]: '价格预警',
  [MatchStatus.CONFIRMED]: '已确认',
};

// ─────────────────────────────────────────────
// 差异原因
// ─────────────────────────────────────────────
export enum DiffReason {
  SUPPLIER_SHORT = 'supplier_short',
  RECEIPT_MISS = 'receipt_miss',
  PRICE_ADJUST = 'price_adjust',
  OTHER = 'other',
}

export const DiffReasonLabel: Record<DiffReason, string> = {
  [DiffReason.SUPPLIER_SHORT]: '供应商少发',
  [DiffReason.RECEIPT_MISS]: '入库漏录',
  [DiffReason.PRICE_ADJUST]: '价格调整',
  [DiffReason.OTHER]: '其他',
};

// ─────────────────────────────────────────────
// 销售订单状态
// ─────────────────────────────────────────────
export enum SalesOrderStatus {
  PENDING_APPROVAL = 'pending_approval',
  CONFIRMED = 'confirmed',
  IN_PRODUCTION = 'in_production',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
  REJECTED = 'rejected',
}

export const SalesOrderStatusLabel: Record<SalesOrderStatus, string> = {
  [SalesOrderStatus.PENDING_APPROVAL]: '待审批',
  [SalesOrderStatus.CONFIRMED]: '已确认',
  [SalesOrderStatus.IN_PRODUCTION]: '生产中',
  [SalesOrderStatus.COMPLETED]: '已完成',
  [SalesOrderStatus.CANCELLED]: '已取消',
  [SalesOrderStatus.REJECTED]: '已驳回',
};

// ─────────────────────────────────────────────
// 销售订单类型
// ─────────────────────────────────────────────
export enum OrderType {
  NORMAL = 'normal',
  URGENT = 'urgent',
}

export const OrderTypeLabel: Record<OrderType, string> = {
  [OrderType.NORMAL]: '普通',
  [OrderType.URGENT]: '紧急插单',
};

// ─────────────────────────────────────────────
// 约束检查结果
// ─────────────────────────────────────────────
export enum ConstraintResult {
  PASS = 'pass',
  WARN = 'warn',
  BLOCK = 'block',
}

// ─────────────────────────────────────────────
// 审批动作
// ─────────────────────────────────────────────
export enum ApprovalAction {
  APPROVED = 'approved',
  REJECTED = 'rejected',
  CONDITIONAL = 'conditional',
}

export const ApprovalActionLabel: Record<ApprovalAction, string> = {
  [ApprovalAction.APPROVED]: '批准',
  [ApprovalAction.REJECTED]: '驳回',
  [ApprovalAction.CONDITIONAL]: '附条件批准',
};

// ─────────────────────────────────────────────
// 生产工单状态
// ─────────────────────────────────────────────
export enum ProductionOrderStatus {
  PENDING = 'pending',
  DRAFT = 'draft',
  SCHEDULED = 'scheduled',
  IN_PROGRESS = 'in_progress',
  PAUSED = 'paused',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
}

export const ProductionOrderStatusLabel: Record<ProductionOrderStatus, string> = {
  [ProductionOrderStatus.PENDING]: '待生产',
  [ProductionOrderStatus.DRAFT]: '草稿',
  [ProductionOrderStatus.SCHEDULED]: '已排产',
  [ProductionOrderStatus.IN_PROGRESS]: '生产中',
  [ProductionOrderStatus.PAUSED]: '已暂停',
  [ProductionOrderStatus.COMPLETED]: '已完工',
  [ProductionOrderStatus.CANCELLED]: '已取消',
};

// ─────────────────────────────────────────────
// 工人任务状态
// ─────────────────────────────────────────────
export enum TaskStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  SKIPPED = 'skipped',
  PAUSED = 'paused',
}

export const TaskStatusLabel: Record<TaskStatus, string> = {
  [TaskStatus.PENDING]: '待开始',
  [TaskStatus.IN_PROGRESS]: '进行中',
  [TaskStatus.COMPLETED]: '已完成',
  [TaskStatus.SKIPPED]: '已跳过',
  [TaskStatus.PAUSED]: '已暂停',
};

// ─────────────────────────────────────────────
// 质量问题类型
// ─────────────────────────────────────────────
export enum IssueType {
  APPEARANCE = 'appearance',
  DIMENSION = 'dimension',
  FUNCTION = 'function',
  MATERIAL = 'material',
}

export const IssueTypeLabel: Record<IssueType, string> = {
  [IssueType.APPEARANCE]: '外观',
  [IssueType.DIMENSION]: '尺寸',
  [IssueType.FUNCTION]: '功能',
  [IssueType.MATERIAL]: '材质',
};

// ─────────────────────────────────────────────
// 质量问题严重程度（4级体系：对应 TracePage 实际使用）
// ─────────────────────────────────────────────
export enum IssueSeverity {
  CRITICAL = 'critical',
  MAJOR    = 'major',
  MINOR    = 'minor',
  COSMETIC = 'cosmetic',
}

export const IssueSeverityLabel: Record<IssueSeverity, string> = {
  [IssueSeverity.CRITICAL]: '严重',
  [IssueSeverity.MAJOR]:    '主要',
  [IssueSeverity.MINOR]:    '次要',
  [IssueSeverity.COSMETIC]: '外观',
};

// ─────────────────────────────────────────────
// 验货单状态
// ─────────────────────────────────────────────
export enum InspectionStatus {
  PENDING     = 'pending',
  IN_PROGRESS = 'in_progress',
  PASSED      = 'passed',
  FAILED      = 'failed',
  PARTIAL     = 'partial',
  /** 免检（TracePage 使用） */
  WAIVED      = 'waived',
}

export const InspectionStatusLabel: Record<InspectionStatus, string> = {
  [InspectionStatus.PENDING]:     '待验货',
  [InspectionStatus.IN_PROGRESS]: '验货中',
  [InspectionStatus.PASSED]:      '全部通过',
  [InspectionStatus.FAILED]:      '验货不通过',
  [InspectionStatus.PARTIAL]:     '部分通过',
  [InspectionStatus.WAIVED]:      '免检',
};

// ─────────────────────────────────────────────
// 损耗原因
// ─────────────────────────────────────────────
export enum ScrapReason {
  MATERIAL_DEFECT = 'material_defect',
  OPERATION_ERROR = 'operation_error',
  OTHER = 'other',
}

export const ScrapReasonLabel: Record<ScrapReason, string> = {
  [ScrapReason.MATERIAL_DEFECT]: '材料缺陷',
  [ScrapReason.OPERATION_ERROR]: '操作失误',
  [ScrapReason.OTHER]: '其他',
};
