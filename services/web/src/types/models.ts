/**
 * [artifact:前端代码] — 业务实体类型定义
 * 严格对应 API 文档响应结构
 */

import type {
  BomStatus,
  Category1Code,
  Category2Code,
  Confidence,
  ConstraintResult,
  InspectionStatus,
  IssueType,
  IssueSeverity,
  MatchStatus,
  OrderType,
  ProductionOrderStatus,
  PurchaseOrderStatus,
  SalesOrderStatus,
  ScrapReason,
  SkuStatus,
  SuggestionStatus,
  TaskStatus,
  TransactionType,
  UserRole,
} from './enums';
import type { PermissionSnapshot } from './accessControl';

// ─────────────────────────────────────────────
// 认证 & 用户
// ─────────────────────────────────────────────
export interface User {
  id: number;
  username: string;
  realName: string;
  roles: UserRole[];
  tenantId: number;
  tenantName: string;
  scopeLevel: 'platform' | 'tenant';
  originTenantId: number;
  contextTenantId: number | null;
}

export interface AuthData {
  accessToken: string;
  /** refreshToken 已改为 HttpOnly Cookie，不再在 response body 中返回 */
  user: User;
  /** 权限快照：迁移期可能为空 */
  permissionSnapshot?: PermissionSnapshot;
}

export interface LoginPayload {
  loginMode?: 'tenant' | 'platform';
  username: string;
  password: string;
  tenantCode?: string;
}

// ─────────────────────────────────────────────
// SKU 分类
// ─────────────────────────────────────────────
export interface SkuCategory {
  id: number;
  level: 1 | 2;
  parentId: number | null;
  code: Category1Code | Category2Code;
  name: string;
  sortOrder: number;
}

/**
 * R-01: 类目管理完整模型（含 isSystem + children）
 * 对应 GET /api/sku-categories 响应结构
 */
export interface SkuCategoryFull {
  id: number;
  level: 1 | 2;
  parentId: number | null;
  code: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
  /** true = 系统预置（tenant_id=0），前端禁止删除 */
  isSystem: boolean;
  children?: SkuCategoryFull[];
}

/** POST /api/sku-categories Request Body */
export interface CreateCategoryPayload {
  level: 1 | 2;
  parentId?: number | null;
  code: string;
  name: string;
  sortOrder?: number;
}

/** PATCH /api/sku-categories/:id Request Body */
export interface UpdateCategoryPayload {
  name?: string;
  sortOrder?: number;
}

/** 批量排序更新 */
export interface ReorderCategoryPayload {
  orderedIds: number[];
}

// ─────────────────────────────────────────────
// 单位换算
// ─────────────────────────────────────────────
export interface UnitConversion {
  fromUnit: string;
  toUnit: string;
  /** 换算系数，例如 1 卷 = 50 m，则 conversionRate = "50"（后端 DECIMAL，字符串类型） */
  conversionRate: string;
  description?: string;
}

// ─────────────────────────────────────────────
// SKU 主数据
// ─────────────────────────────────────────────
export interface Sku {
  id: number;
  tenantId: number;
  skuCode: string;
  barcode: string | null;
  name: string;
  spec: string | null;
  category1Id: number;
  category2Id: number;
  category1Name: string;
  category2Name: string;
  /** category1Code 供前端渲染标签色 */
  category1Code?: Category1Code;
  /** category2Code 供前端渲染标签色 */
  category2Code?: Category2Code;
  stockUnit: string;
  purchaseUnit: string;
  productionUnit: string;
  /** 生产单位换算系数（1 采购单位 = stockConvFactor 库存单位） */
  stockConvFactor?: number;
  /** 生产领用换算说明，如 "200×2400 mm²" */
  prodConvNote?: string;
  hasDyeLot: boolean;
  /** 是否启用 FIFO 出库，默认 true */
  useFifo: boolean;
  safetyStock: string | null;
  status: SkuStatus;
  description?: string;
  unitConversions?: UnitConversion[];
  /** 当前库存（联查，可能不存在） */
  qtyOnHand?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface SkuListQuery {
  page?: number;
  pageSize?: number;
  category1Id?: number;
  category2Id?: number;
  keyword?: string;
  hasDyeLot?: boolean;
  status?: SkuStatus;
  /** Comma-separated skuType values, e.g. "semi_finished,finished" */
  skuTypes?: string;
}

export interface CreateSkuPayload {
  name: string;
  spec?: string;
  category1Id: number;
  category2Id: number;
  stockUnit: string;
  purchaseUnit: string;
  productionUnit: string;
  skuCode?: string;
  hasDyeLot?: boolean;
  useFifo?: boolean;
  safetyStock?: string;
  description?: string;
  stockConvFactor?: number;
  prodConvNote?: string;
}

export type UpdateSkuPayload = Partial<CreateSkuPayload>;

// ─────────────────────────────────────────────
// BOM
// ─────────────────────────────────────────────
export interface BomHeader {
  id: number;
  skuId: number;
  skuCode?: string;
  skuName: string;
  version: string;
  status: BomStatus;
  description?: string;
  itemCount?: number;
}

export interface BomItem {
  bomItemId: number;
  componentSkuId: number;
  skuCode: string;
  skuName: string;
  spec: string | null;
  quantity: string;
  unit: string;
  scrapRate: string;
  netQuantity: string;
  level: number;
  children: BomItem[];
}

export interface BomDetail extends BomHeader {
  items: BomItem[];
}

export interface MaterialRequirement {
  skuId: number;
  skuCode: string;
  skuName: string;
  spec: string | null;
  stockUnit: string;
  purchaseUnit: string;
  hasDyeLot: boolean;
  totalQty: string;
  unit: string;
}

export interface CreateBomItemPayload {
  componentSkuId: number;
  quantity: string;
  unit: string;
  scrapRate?: string;
  sortOrder?: number;
  children?: CreateBomItemPayload[];
}

export interface CreateBomPayload {
  skuId: number;
  version: string;
  description?: string;
  items: CreateBomItemPayload[];
}

// ─────────────────────────────────────────────
// 库存
// ─────────────────────────────────────────────
export interface InventoryItem {
  skuId: number;
  skuCode: string;
  skuName: string;
  stockUnit: string;
  purchaseUnit?: string | null;
  stockConvFactor?: number | string | null;
  safetyStock: string;
  qtyOnHand: string;
  qtyReserved: string;
  qtyInTransit: string;
  qtyAvailable: string;
  isBelowSafety: boolean;
  hasDyeLot: boolean;
  warehouseId?: number | null;
  warehouseCode?: string | null;
  warehouseName?: string | null;
  locationId?: number | null;
  locationCode?: string | null;
  locationName?: string | null;
  isDefaultLocation?: boolean;
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
  locationType: 'general' | 'zone' | 'rack' | 'shelf' | 'bin';
  aisleCode: string | null;
  rackCode: string | null;
  shelfCode: string | null;
  binCode: string | null;
  level: number;
  status: string;
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

export interface SkuAvailability {
  qtyOnHand: string;
  qtyReserved: string;
  qtyAvailable: string;
  stockUnit: string;
}

export interface DyeLot {
  dyeLotNo: string;
  qtyOnHand: string;
  qtyReserved: string;
  qtyAvailable: string;
  firstInAt: string;
  lastInAt: string;
}

export interface InboundPayload {
  skuCode: string;
  skuId?: number;
  warehouseId?: number;
  locationId?: number;
  qtyInput: string;
  inputUnit: string;
  transactionType: TransactionType;
  dyeLotNo?: string;
  referenceType?: string;
  referenceId?: number;
  referenceNo?: string;
  batchCost?: string;
  notes?: string;
}

export interface OutboundPayload {
  skuId: number;
  warehouseId?: number;
  locationId?: number;
  qtyInput: string;
  inputUnit: string;
  transactionType: TransactionType;
  dyeLotNo?: string;
  productionOrderId?: number;
  referenceType?: string;
  referenceId?: number;
  referenceNo?: string;
}

export interface StockTransactionResult {
  transactionNo: string;
  newQtyOnHand: string;
  warehouseId?: number;
  locationId?: number;
  warningCode?: string;
}

export interface InventoryListQuery {
  page?: number;
  pageSize?: number;
  category1Id?: number;
  category2Id?: number;
  warehouseId?: number;
  locationId?: number;
  onlyDefaultLocation?: boolean;
  keyword?: string;
  belowSafety?: boolean;
}

export interface DailyInventorySnapshotItem {
  snapshotDate: string;
  skuId: number;
  skuCode: string;
  skuName: string;
  stockUnit: string;
  qtyOnHand: string;
  qtyReserved: string;
  qtyAvailable: string;
}

export interface DailyInventorySnapshotQuery {
  snapshotDate?: string;
  skuId?: number;
  keyword?: string;
  page?: number;
  pageSize?: number;
}

export interface InventorySummaryCategory {
  categoryId: number;
  categoryName: string;
  totalQty: number;
  skuCount: number;
  alertCount: number;
}

export interface InventorySummary {
  categories: InventorySummaryCategory[];
  totalSkuCount: number;
  totalAlertCount: number;
}

export interface InventoryTransactionTraceItem {
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
}

export interface InventoryTransactionTraceQuery {
  page?: number;
  pageSize?: number;
  dateFrom?: string;
  dateTo?: string;
  warehouseId?: number;
  locationId?: number;
  keyword?: string;
}

export interface InventoryTransactionTraceResult {
  skuId: number;
  skuCode: string;
  skuName: string;
  stockUnit: string;
  list: InventoryTransactionTraceItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// ─────────────────────────────────────────────
// 供应商
// ─────────────────────────────────────────────
export interface Supplier {
  id: number;
  name: string;
  contactName?: string;
  contactPhone?: string;
  address?: string;
}

// ─────────────────────────────────────────────
// 采购建议
// ─────────────────────────────────────────────
export interface PurchaseSuggestion {
  id: number;
  skuId: number;
  skuCode: string;
  skuName: string;
  suggestedSupplierId: number;
  supplierName: string;
  suggestedQty: string;
  purchaseUnit: string;
  estimatedPrice: string;
  estimatedAmount: string;
  shortageQty: string;
  reason: string;
  confidence: Confidence;
  confidenceDetail: string;
  dyeLotRequirement: string | null;
  status: SuggestionStatus;
  createdAt: string;
}

export interface ApproveSuggestionPayload {
  approved: boolean;
  rejectReason?: string;
}

// ─────────────────────────────────────────────
// 采购订单
// ─────────────────────────────────────────────
export interface PurchaseOrderItem {
  [key: string]: unknown;
  id?: number;
  skuId: number;
  skuCode?: string;
  skuName?: string;
  hasDyeLot?: boolean;
  qtyOrdered: string;
  qtyReceived?: string;
  gapQty?: string;
  progressPct?: number;
  purchaseUnit: string;
  unitPrice: string;
  amount?: string;
  deliveryHistory?: PurchaseOrderItemDeliveryHistory[];
}

export interface PurchaseOrderDelivery {
  [key: string]: unknown;
  id: number;
  deliveryNo: string;
  deliveryDate: string;
  status: string;
  notes?: string | null;
  totalDelivered: string;
  receiptId?: number | null;
  receiptNo?: string | null;
  receiptStatus?: string | null;
  receivedAt?: string | null;
}

export interface PurchaseOrderItemDeliveryHistory {
  [key: string]: unknown;
  deliveryId: number;
  deliveryNo: string;
  deliveryDate: string;
  deliveryStatus: string;
  dyeLotNo?: string | null;
  qtyDelivered: string;
  receiptId?: number | null;
  receiptNo?: string | null;
  receiptStatus?: string | null;
  qtyReceived?: string | null;
  receivedAt?: string | null;
}

export interface DeliveryNoteItem {
  [key: string]: unknown;
  id: number;
  skuId: number;
  skuCode?: string;
  skuName?: string;
  hasDyeLot?: boolean;
  dyeLotNo?: string | null;
  qtyDelivered: string;
  purchaseUnit: string;
  unitPrice: string;
  amount?: string;
}

export interface DeliveryNote {
  [key: string]: unknown;
  id: number;
  deliveryNo: string;
  poId: number;
  poNo?: string;
  supplierId?: number;
  supplierName?: string;
  deliveryDate: string;
  status: string;
  notes?: string | null;
  inspectionId?: number | null;
  inspectionNo?: string | null;
  inspectionCreatedAt?: string | null;
  receiptId?: number | null;
  receiptNo?: string | null;
  matchId?: number | null;
  matchStatus?: string | null;
  matchCreatedAt?: string | null;
  matchConfirmedAt?: string | null;
  receivedAt?: string | null;
  creatorName?: string | null;
  totalDelivered?: string;
  createdAt?: string | null;
  items?: DeliveryNoteItem[];
}

export interface PurchaseOrder {
  [key: string]: unknown;
  id: number;
  poNo: string;
  supplierId: number;
  supplierName: string;
  status: PurchaseOrderStatus;
  expectedDate?: string | null;
  totalAmount: string;
  notes?: string;
  closeReason?: string | null;
  closedAt?: string | null;
  closedByName?: string | null;
  overdueDays?: number;
  totalOrdered?: string;
  totalReceived?: string;
  totalGap?: string;
  items: PurchaseOrderItem[];
  deliveries?: PurchaseOrderDelivery[];
  createdAt: string;
}

export interface PurchaseOrderTailRow {
  [key: string]: unknown;
  id: number;
  poNo: string;
  supplierName: string;
  status: PurchaseOrderStatus;
  expectedDate: string;
  totalAmount: string;
  totalOrdered: string;
  totalReceived: string;
  totalGap: string;
  overdueDays: number;
}

export interface PurchaseReceiptItem {
  [key: string]: unknown;
  id: number;
  skuId: number;
  skuCode?: string;
  skuName?: string;
  dyeLotNo?: string | null;
  qtyReceived: string;
  purchaseUnit: string;
  unitPrice: string;
  amount?: string;
}

export interface PurchaseReceipt {
  [key: string]: unknown;
  id: number;
  receiptNo: string;
  poId: number;
  poNo?: string;
  poStatus?: PurchaseOrderStatus;
  deliveryNoteId?: number | null;
  deliveryNo?: string | null;
  status: 'pending' | 'confirmed' | 'cancelled' | string;
  totalAmount?: string;
  totalQty?: string;
  notes?: string | null;
  receivedAt?: string | null;
  supplierName?: string;
  inspectionNo?: string | null;
  operatorName?: string | null;
  items?: PurchaseReceiptItem[];
}

export interface UpdatePurchaseReceiptNotesPayload {
  notes: string;
}

export interface CreatePurchaseOrderPayload {
  supplierId: number;
  suggestionId?: number;
  expectedDate: string;
  notes?: string;
  items: PurchaseOrderItem[];
}

export interface CreateDeliveryNotePayload {
  poId?: number;
  poNo?: string;
  deliveryDate: string;
  notes?: string;
  items: Array<{
    skuId: number;
    qtyDelivered: string;
    purchaseUnit: string;
    unitPrice: string;
    dyeLotNo?: string;
  }>;
}

export interface ClosePurchaseOrderPayload {
  reason: string;
}

// ─────────────────────────────────────────────
// 三单匹配
// ─────────────────────────────────────────────
export interface ThreeWayMatchDiffItem {
  skuId: number;
  skuName: string;
  hasDyeLot?: boolean;
  deliveryDyeLots?: string[];
  receiptDyeLots?: string[];
  isDyeLotMismatch?: boolean;
  poQty: string;
  poUnit: string;
  poPrice: string;
  dnQty: string;
  dnPrice: string;
  receiptQty: string;
  qtyDiff: string;
  priceDiff: string;
  isPriceAnomaly: boolean;
  historicalAvgPrice: string;
}

export interface ThreeWayMatch {
  matchId: number;
  poId: number;
  poNo: string;
  deliveryNoteId: number;
  deliveryNo: string;
  receiptId: number;
  receiptNo: string;
  matchStatus: MatchStatus;
  diffItems: ThreeWayMatchDiffItem[];
  createdAt: string;
  confirmedAt: string | null;
  confirmedBy: string | null;
  diffReason: string | null;
  diffNotes: string | null;
  supplierName?: string | null;
}

export interface ConfirmMatchPayload {
  diffReason: string;
  diffNotes?: string;
}

export interface ThreeWayMatchPayload {
  poId: number;
  deliveryNoteId: number;
  receiptId: number;
}

// ─────────────────────────────────────────────
// 销售订单
// ─────────────────────────────────────────────
export interface ConstraintCheck {
  passed: boolean;
  currentValue: string;
  threshold: string;
  detail: string;
}

export interface ImpactAnalysis {
  affectedOrders: Array<{
    orderId: number;
    orderNo: string;
    delayDays: number;
  }>;
  additionalCapital: string;
  turnoverDaysChange: string;
  additionalProductionCost: string;
}

export interface SalesOrderItem {
  id?: number;
  skuId: number;
  skuName?: string;
  bomId?: number;
  qtyOrdered: string;
  unitPrice: string;
  amount?: string;
}

export interface SalesOrder {
  id: number;
  orderNo: string;
  customerName: string;
  orderType: OrderType;
  status: SalesOrderStatus;
  priority: number;
  expectedDelivery: string;
  totalAmount: string;
  constraintResult: ConstraintResult;
  blockedReasons: string[];
  impactAnalysis: ImpactAnalysis | null;
  items: SalesOrderItem[];
  createdAt?: string;
}

export interface CreateSalesOrderPayload {
  customerId: number;
  orderType?: OrderType;
  expectedDelivery: string;
  notes?: string;
  items: Array<{
    skuId: number;
    bomId: number;
    qtyOrdered: string;
    unitPrice: string;
  }>;
}

export interface SalesOrderCreateResult {
  orderId: number;
  orderNo: string;
  constraintResult: ConstraintResult;
  estimatedDelivery: string | null;
  requiresApproval: boolean;
}

export interface UrgentAnalysisPayload {
  skuId: number;
  bomId: number;
  qty: string;
  expectedDelivery: string;
}

export interface UrgentAnalysisResult {
  overallResult: ConstraintResult;
  inventoryTurnoverCheck: ConstraintCheck;
  capitalOccupationCheck: ConstraintCheck;
  productionCostCheck: ConstraintCheck;
  capacityLoadCheck: ConstraintCheck;
  blockedReasons: string[];
  impactAnalysis: ImpactAnalysis;
}

// ─────────────────────────────────────────────
// 生产工单
// ─────────────────────────────────────────────
export interface ProductionTask {
  id: number;
  taskNo?: string;
  workerName: string;
  stepName: string;
  taskDate: string;
  plannedQty: string;
  completedQty: string;
  status: TaskStatus;
  workOrderNo?: string;
  skuName?: string;
  processStepName?: string;
  salesOrderNo?: string;
}

/** WorkerTask = ProductionTask 的别名，排产页使用 */
export type WorkerTask = ProductionTask;

export interface ProductionOrder {
  id: number;
  workOrderNo: string;
  skuName: string;
  salesOrderNo: string;
  qtyPlanned: string;
  qtyCompleted: string;
  progressPct: number;
  status: ProductionOrderStatus;
  materialStatus?: 'unchecked' | 'shortage' | 'partial' | 'ready' | string;
  plannedStart: string;
  plannedEnd: string;
  processSnapshot?: {
    templateName?: string;
    snapshotAt?: string;
    steps?: Array<{
      id?: number | string;
      stepNo?: number | string;
      step_no?: number | string;
      stepName?: string;
      step_name?: string;
      workstationType?: string | null;
      workstation_type?: string | null;
      standardHours?: number | string | null;
      standard_hours?: number | string | null;
      maxHours?: number | string | null;
      max_hours?: number | string | null;
    }>;
  } | null;
  tasks?: ProductionTask[];
}

export interface CreateProductionOrderPayload {
  salesOrderId: number;
  salesOrderItemId: number;
  skuId: number;
  bomHeaderId: number;
  processTemplateId: number;
  qtyPlanned: string;
  priority?: number;
  plannedStart: string;
  plannedEnd: string;
}

export interface ScheduleItem {
  scheduleId: number;
  productionOrderId: number;
  operationId?: number | null;
  componentId?: number | null;
  workOrderNo: string;
  processStepId: number;
  stepName: string;
  outputSkuId?: number | null;
  outputSkuName?: string | null;
  workerId: number | null;
  workerName: string | null;
  workstationId: number | null;
  workstationName: string | null;
  plannedQty: string;
  estimatedHours: string;
  status: 'planned' | 'confirmed';
  updatedAt?: string;
}

export interface ScheduleResult {
  date: string;
  schedules: ScheduleItem[];
  summary: {
    totalOrders: number;
    totalSteps: number;
    capacityLoadRate: string;
    confirmed: boolean;
    confirmedAt: string | null;
  };
}

export interface CompleteTaskPayload {
  completedQty: string;
  actualHours?: string;
  scrapQty?: string;
  scrapReason?: ScrapReason;
  componentBarcode?: string;
  notes?: string;
  images?: string[];
}

export interface ProductionTaskDependency {
  operationId: number;
  stepName: string;
  requiredQty: string;
  completedQty: string;
  status: string;
  skuId: number | null;
  skuCode: string | null;
  skuName: string | null;
  unit: string | null;
}

export interface ProductionTaskDependencySummary {
  blocked: boolean;
  blockingReason: string | null;
  predecessors: ProductionTaskDependency[];
}

export interface ProductionTaskMaterialTransaction {
  id: number;
  ioType: 'input' | 'output';
  skuId: number;
  skuCode: string | null;
  skuName: string | null;
  stockUnit: string | null;
  plannedQty: string;
  actualQty: string;
  qtyAvailable: string;
  shortageQty: string;
  isShortage: boolean | 0 | 1 | '0' | '1';
  inventoryTxId: number | null;
  transactionNo: string | null;
  transactionType: string | null;
  direction: 'IN' | 'OUT' | null;
  transactionQty: string | null;
  transactionTime: string | null;
  referenceNo: string | null;
}

export interface ProductionTaskInputMaterial {
  itemType: 'material';
  sourceLabel: string;
  skuId: number;
  skuCode: string | null;
  skuName: string | null;
  unit: string | null;
  requiredQty: string;
  issuedQty: string;
  qtyAvailable: string;
  shortageQty: string;
  isShortage: boolean | 0 | 1 | '0' | '1';
  inventoryTxId: number | null;
}

export interface ProductionTaskInputItem {
  itemType: 'semi_finished' | 'material';
  sourceLabel: string;
  skuId: number;
  skuCode: string | null;
  skuName: string | null;
  unit: string | null;
  requiredQty: string;
  fulfilledQty: string;
  qtyAvailable: string;
  shortageQty: string;
  isShortage: boolean | 0 | 1 | '0' | '1';
  status: string | null;
  operationId: number | null;
  stepName: string | null;
  inventoryTxId: number | null;
}

export interface ProductionTaskOutputItem {
  itemType: 'finished' | 'semi_finished';
  skuId: number;
  skuCode: string | null;
  skuName: string | null;
  unit: string | null;
  plannedQty: string;
  actualQty: string;
}

export interface ProductionTaskWageReport {
  reportId: number;
  reportNo: string;
  reportDate: string;
  productionOrderId: number | null;
  orderNo: string | null;
  taskId: number | null;
  taskNo: string | null;
  taskStatus: string | null;
  userId: number;
  userName: string;
  workerGrade: string;
  processStepId: number | null;
  stepName: string;
  qtyCompleted: string;
  qtyQualified: string;
  qtyDefective: string;
  workHours: string;
  unitPrice: string;
  subtotal: string;
}

// ─────────────────────────────────────────────
// 质量溯源
// ─────────────────────────────────────────────
/** Inspection = QualityInspection 的别名，TracePage 使用 */
export type Inspection = QualityInspection;

export interface QualityInspection {
  id: number;
  inspectionNo: string;
  productionOrderId: number;
  inspectionDate: string;
  qtyInspected: string;
  qtyPassed: string | null;
  status: InspectionStatus;
}

export interface QualityIssue {
  issueId: number;
  inspectionId: number;
  componentName: string;
  issueTypes: IssueType[];
  severity: IssueSeverity;
  description: string;
  images: string[];
}

export interface TraceComponent {
  componentBarcode: string | null;
  componentName: string;
  processStepName: string;
  stepNo: number;
  workerName: string;
  workerId: number;
  operationTime: string;
  skuName: string;
  dyeLotNo: string | null;
  hasScanRecord: boolean;
  missingDataNote: string | null;
}

/** 溯源链节点（TracePage 使用） */
export interface TraceNode {
  id?: number | string;
  type: string;
  label: string;
  status?: 'ok' | 'warning' | 'error';
  detail?: string;
  timestamp?: string;
}

export interface TraceabilityChain {
  productionOrderId: number;
  workOrderNo: string;
  skuName: string;
  salesOrderNo: string;
  customerName: string;
  /** 查询值（TracePage 展示） */
  queryValue?: string;
  /** 节点列表（TracePage 使用扁平节点展示） */
  nodes?: TraceNode[];
  components: TraceComponent[];
  summary: {
    totalComponents: number;
    withScanRecord: number;
    dyeLots: string[];
  };
  aiAnalysis: {
    summary: string;
    rootCauses: string[];
    recommendations: string[];
    generatedAt: string;
  } | null;
}

export interface QualityStats {
  periodDays: number;
  totalInspected: number;
  totalFailed: number;
  failRate: string;
  traceCompletionRate: string;
  tracedIssueCount: number;
  totalIssueCount: number;
  trendData: Array<{
    date: string;
    failCount: number;
    inspectCount: number;
  }>;
  issueTypeBreakdown: Array<{
    type: IssueType;
    count: number;
    pct: string;
  }>;
  top5Issues: Array<{
    description: string;
    count: number;
    orderCount: number;
    relatedWorkers: string[];
    relatedProcesses: string[];
  }>;
}

// ─────────────────────────────────────────────
// 仪表盘
// ─────────────────────────────────────────────
export interface DashboardKpi {
  pendingApprovalCount: number;
  inProductionCount: number;
  belowSafetyCount: number;
  todayDeliveryCount: number;
  totalInventoryValue: string;
  capacityLoadRate: string;
}
