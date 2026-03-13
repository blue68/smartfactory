import { Response } from 'express';

/**
 * 统一API响应结构
 */
export interface ApiResponseBody<T = unknown> {
  code: number;
  data: T;
  message: string;
}

/**
 * 标准响应码定义
 */
export const ResponseCode = {
  SUCCESS: 0,
  // 通用错误 1xxx
  INVALID_PARAMS: 1001,
  UNAUTHORIZED: 1002,
  FORBIDDEN: 1003,
  NOT_FOUND: 1004,
  CONFLICT: 1005,
  INTERNAL_ERROR: 1099,
  // SKU模块 2xxx
  SKU_NOT_FOUND: 2001,
  SKU_CODE_DUPLICATE: 2002,
  SKU_CATEGORY_MISMATCH: 2003,
  // BOM模块 3xxx
  BOM_NOT_FOUND: 3001,
  BOM_CIRCULAR_REF: 3002,
  BOM_ITEM_DUPLICATE: 3003,
  BOM_VERSION_DUPLICATE: 3004,
  BOM_STATUS_CONFLICT: 3005,
  // 库存模块 4xxx
  INVENTORY_INSUFFICIENT: 4001,
  INVENTORY_DYE_LOT_REQUIRED: 4002,
  INVENTORY_LOCK_FAILED: 4003,
  INVENTORY_CROSS_DYE_LOT: 4004,
  // 采购模块 5xxx
  PO_NOT_FOUND: 5001,
  THREE_WAY_MATCH_DIFF: 5002,
  PRICE_ANOMALY: 5003,
  // 销售模块 6xxx
  ORDER_CONSTRAINT_BLOCKED: 6001,
  ORDER_NOT_FOUND: 6002,
  ORDER_CANNOT_MODIFY: 6003,
  // R-07 客户管理
  CUSTOMER_NOT_FOUND: 6004,
  CUSTOMER_CODE_DUPLICATE: 6005,
  CUSTOMER_HAS_ACTIVE_ORDERS: 6006,
  CONTACT_NOT_FOUND: 6007,
  CONTACT_LAST_ONE: 6008,
  CONTACT_IS_PRIMARY: 6009,
  // R-08 销售订单
  ORDER_URGENT_NEED_APPROVAL: 6010,
  ORDER_NOT_DRAFT: 6011,
  ORDER_INVALID_TRANSITION: 6012,
  // 生产模块 7xxx
  PRODUCTION_ORDER_NOT_FOUND: 7001,
  SCHEDULE_CONFLICT: 7002,
  WORKSTATION_NOT_FOUND: 7003,
} as const;

export type ResponseCodeValue = typeof ResponseCode[keyof typeof ResponseCode];

/**
 * 成功响应
 */
export function success<T>(res: Response, data: T, message = '操作成功', statusCode = 200): void {
  res.status(statusCode).json({
    code: ResponseCode.SUCCESS,
    data,
    message,
  } satisfies ApiResponseBody<T>);
}

/**
 * 创建成功响应（201）
 */
export function created<T>(res: Response, data: T, message = '创建成功'): void {
  success(res, data, message, 201);
}

/**
 * 错误响应
 */
export function error(
  res: Response,
  code: ResponseCodeValue,
  message: string,
  statusCode = 400,
  data: unknown = null,
): void {
  res.status(statusCode).json({
    code,
    data,
    message,
  } satisfies ApiResponseBody);
}

/**
 * 分页响应数据结构
 */
export interface PaginatedData<T> {
  list: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/**
 * 构建分页数据
 */
export function buildPaginated<T>(
  list: T[],
  total: number,
  page: number,
  pageSize: number,
): PaginatedData<T> {
  return {
    list,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}
