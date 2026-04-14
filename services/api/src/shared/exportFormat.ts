/**
 * [artifact:API接口代码] — 导出格式化工具
 * 统一导出中的状态中文和值时间格式，避免各模块各自拼接导致口径不一致。
 */

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

export function formatExportDateTime(value: unknown): string {
  if (value == null || value === '') return '';

  if (typeof value === 'string') {
    const normalized = value.trim().replace('T', ' ').replace(/\.\d{1,6}Z?$/, '');
    if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
      return `${normalized} 00:00:00`;
    }
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(normalized)) {
      return `${normalized}:00`;
    }
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(normalized)) {
      return normalized;
    }
  }

  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

function formatStatus(value: unknown, labels: Record<string, string>): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  return labels[raw] ?? raw;
}

const ACTIVE_STATUS_LABELS: Record<string, string> = {
  active: '启用',
  inactive: '停用',
  locked: '锁定',
  archived: '已归档',
  suspended: '暂停',
  cancelled: '已取消',
};

const CUSTOMER_STATUS_LABELS: Record<string, string> = {
  active: '活跃',
  inactive: '停用',
};

const BOM_STATUS_LABELS: Record<string, string> = {
  draft: '草稿',
  active: '已激活',
  archived: '已归档',
};

const PURCHASE_ORDER_STATUS_LABELS: Record<string, string> = {
  draft: '草稿',
  confirmed: '已确认',
  partial_received: '部分到货',
  received: '已收货',
  cancelled: '已取消',
};

const PURCHASE_SETTLEMENT_STATUS_LABELS: Record<string, string> = {
  draft: '草稿',
  confirmed: '已确认',
  paid: '已付款',
  cancelled: '已取消',
};

const SALES_ORDER_STATUS_LABELS: Record<string, string> = {
  draft: '草稿',
  pending_approval: '待审批',
  confirmed: '已确认',
  in_production: '生产中',
  produced: '待发货',
  partial_shipped: '部分发货',
  shipped: '已发货',
  completed: '已完成',
  closed: '已关闭',
  cancelled: '已取消',
  rejected: '已驳回',
};

export function formatActiveStatus(value: unknown): string {
  return formatStatus(value, ACTIVE_STATUS_LABELS);
}

export function formatCustomerStatus(value: unknown): string {
  return formatStatus(value, CUSTOMER_STATUS_LABELS);
}

export function formatBomStatus(value: unknown): string {
  return formatStatus(value, BOM_STATUS_LABELS);
}

export function formatPurchaseOrderStatus(value: unknown): string {
  return formatStatus(value, PURCHASE_ORDER_STATUS_LABELS);
}

export function formatPurchaseSettlementStatus(value: unknown): string {
  return formatStatus(value, PURCHASE_SETTLEMENT_STATUS_LABELS);
}

export function formatSalesOrderStatus(value: unknown): string {
  return formatStatus(value, SALES_ORDER_STATUS_LABELS);
}

export function formatSalesSettlementStatus(value: unknown): string {
  return formatStatus(value, PURCHASE_SETTLEMENT_STATUS_LABELS);
}
