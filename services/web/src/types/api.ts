/**
 * [artifact:前端代码] — API 响应类型定义
 * 与后端 ApiResponse.ts 保持一致
 */

/** 统一响应结构 */
export interface ApiResponse<T = unknown> {
  code: number;
  data: T;
  message: string;
}

/** 分页数据包装结构 */
export interface PaginatedData<T> {
  list: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  /** 各状态全量计数（可选，由特定列表接口返回，如销售订单列表） */
  statusCounts?: Record<string, number>;
}

/** 分页响应 */
export type PaginatedResponse<T> = ApiResponse<PaginatedData<T>>;

/** 通用分页查询参数 */
export interface PaginationParams {
  page?: number;
  pageSize?: number;
}

/** 全局业务错误码（与后端 ResponseCode 一致） */
export const ApiCode = {
  SUCCESS: 0,
  INVALID_PARAMS: 1001,
  UNAUTHORIZED: 1002,
  FORBIDDEN: 1003,
  NOT_FOUND: 1004,
  CONFLICT: 1005,
  INTERNAL_ERROR: 1099,
  // SKU
  SKU_NOT_FOUND: 2001,
  SKU_CODE_DUPLICATE: 2002,
  SKU_CATEGORY_MISMATCH: 2003,
  // BOM
  BOM_NOT_FOUND: 3001,
  BOM_CIRCULAR_REF: 3002,
  BOM_ITEM_DUPLICATE: 3003,
  // 库存
  INVENTORY_INSUFFICIENT: 4001,
  INVENTORY_DYE_LOT_REQUIRED: 4002,
  INVENTORY_LOCK_FAILED: 4003,
  INVENTORY_CROSS_DYE_LOT: 4004,
  // 采购
  PO_NOT_FOUND: 5001,
  THREE_WAY_MATCH_DIFF: 5002,
  PRICE_ANOMALY: 5003,
  // 销售
  ORDER_CONSTRAINT_BLOCKED: 6001,
  ORDER_NOT_FOUND: 6002,
  ORDER_CANNOT_MODIFY: 6003,
  // 客户管理
  CUSTOMER_NOT_FOUND: 6004,
  CUSTOMER_CODE_DUPLICATE: 6005,
  CUSTOMER_HAS_ACTIVE_ORDERS: 6006,
  CONTACT_NOT_FOUND: 6007,
  CONTACT_LAST_ONE: 6008,
  CONTACT_IS_PRIMARY: 6009,
  // 销售订单流转
  ORDER_URGENT_NEED_APPROVAL: 6010,
  ORDER_NOT_DRAFT: 6011,
  ORDER_INVALID_TRANSITION: 6012,
  // 生产
  PRODUCTION_ORDER_NOT_FOUND: 7001,
  SCHEDULE_CONFLICT: 7002,
  WORKSTATION_NOT_FOUND: 7003,
} as const;

export type ApiCodeValue = (typeof ApiCode)[keyof typeof ApiCode];

/** 业务异常（request.ts 中抛出） */
export class ApiError extends Error {
  constructor(
    public readonly code: number,
    public readonly message: string,
    public readonly data?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
