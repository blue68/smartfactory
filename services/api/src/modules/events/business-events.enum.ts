/**
 * Sprint 3 业务事件枚举
 * 进程内同步事件，通过 EventBus 发布/订阅
 */
export enum BusinessEvent {
  // 销售订单事件
  SALES_ORDER_CONFIRMED = 'sales_order.confirmed',
  SALES_ORDER_COMPLETED = 'sales_order.completed',
  SALES_ORDER_SHIPPED = 'sales_order.shipped',

  // 生产工单事件
  PRODUCTION_ORDER_CREATED = 'production_order.created',
  PRODUCTION_ORDER_COMPLETED = 'production_order.completed',

  // 生产任务事件
  TASK_STARTED = 'task.started',
  TASK_COMPLETED = 'task.completed',
  TASK_UNLOCKED = 'task.unlocked',

  // 质检事件
  INSPECTION_SUBMITTED = 'inspection.submitted',

  // 采购入库事件
  PURCHASE_RECEIPT_CONFIRMED = 'purchase_receipt.confirmed',

  // 退货事件
  RETURN_ORDER_AUTO_CREATED = 'return_order.auto_created',

  // 缺料事件
  MATERIAL_SHORTAGE_DETECTED = 'material.shortage_detected',
}

export interface BusinessEventPayload {
  tenantId: number;
  userId: number;
  [key: string]: unknown;
}

export interface SalesOrderConfirmedPayload extends BusinessEventPayload {
  salesOrderId: number;
}

export interface ProductionOrderCreatedPayload extends BusinessEventPayload {
  productionOrderId: number;
  salesOrderId: number;
  skuId: number;
}

export interface TaskCompletedPayload extends BusinessEventPayload {
  taskId: number;
  productionOrderId: number;
  processStepId: number;
  completedQty: string;
}

export interface InspectionSubmittedPayload extends BusinessEventPayload {
  inspectionId: number;
  poId: number;
  overallResult: 'pass' | 'fail' | 'conditional_pass';
}

export interface PurchaseReceiptConfirmedPayload extends BusinessEventPayload {
  receiptId: number;
  poId: number;
  skuId: number;
  qty: string;
}

export interface MaterialShortagePayload extends BusinessEventPayload {
  productionOrderId: number;
  shortageItems: Array<{ skuId: number; qtyShortage: string }>;
}
