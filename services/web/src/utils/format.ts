/**
 * [artifact:前端代码] — 格式化工具
 * 金额、日期、数字、百分比等统一格式化
 */

import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/zh-cn';

dayjs.extend(relativeTime);
dayjs.locale('zh-cn');

// ─────────────────────────────────────────────
// 金额格式化
// ─────────────────────────────────────────────

/**
 * 格式化金额，默认 2 位小数，带千分位
 * "3000.00" → "3,000.00"
 */
export function formatAmount(value: string | number, decimals = 2): string {
  const num = parseFloat(String(value));
  if (isNaN(num)) return '—';
  return num.toLocaleString('zh-CN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * 格式化金额，带人民币符号
 * "3000.00" → "¥3,000.00"
 */
export function formatCNY(value: string | number, decimals = 2): string {
  const num = parseFloat(String(value));
  if (isNaN(num)) return '—';
  return `¥${formatAmount(num, decimals)}`;
}

/**
 * 大金额简写（万元）
 * 50000 → "5.0万"
 */
export function formatAmountShort(value: string | number): string {
  const num = parseFloat(String(value));
  if (isNaN(num)) return '—';
  if (Math.abs(num) >= 10_000) {
    return `${(num / 10_000).toFixed(1)}万`;
  }
  return formatAmount(num, 0);
}

// ─────────────────────────────────────────────
// 日期格式化
// ─────────────────────────────────────────────

/**
 * 标准日期格式
 * "2026-03-11T07:00:00.000Z" → "2026-03-11"
 */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  return dayjs(value).format('YYYY-MM-DD');
}

/**
 * 日期时间格式
 * → "2026-03-11 07:00"
 */
export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  return dayjs(value).format('YYYY-MM-DD HH:mm');
}

/**
 * 相对时间
 * → "3分钟前"
 */
export function formatRelativeTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  return dayjs(value).fromNow();
}

/**
 * 日期区间显示
 * → "2026-03-12 ~ 2026-03-18"
 */
export function formatDateRange(start: string, end: string): string {
  return `${formatDate(start)} ~ ${formatDate(end)}`;
}

// ─────────────────────────────────────────────
// 数量/进度格式化
// ─────────────────────────────────────────────

/**
 * 格式化数量字符串（去掉多余小数零）
 * "50.0000" → "50"，"1.5000" → "1.5"
 */
export function formatQtyStr(value: string | number): string {
  const num = parseFloat(String(value));
  if (isNaN(num)) return '—';
  // 最多保留 4 位小数，去掉尾部零
  return parseFloat(num.toFixed(4)).toString();
}

/**
 * 百分比格式化
 * 40.0 → "40%"，"75.0%" → "75.0%"
 */
export function formatPercent(value: string | number): string {
  const str = String(value);
  if (str.endsWith('%')) return str;
  const num = parseFloat(str);
  if (isNaN(num)) return '—';
  return `${num.toFixed(1)}%`;
}

/**
 * 进度条数值（0-100）
 */
export function toProgressValue(pct: number | string): number {
  const num = typeof pct === 'string' ? parseFloat(pct) : pct;
  if (isNaN(num)) return 0;
  return Math.min(100, Math.max(0, num));
}

// ─────────────────────────────────────────────
// 文本工具
// ─────────────────────────────────────────────

/**
 * 超出字数截断
 */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...`;
}

/**
 * 将 null/undefined/"" 统一显示为占位符
 */
export function displayValue(value: string | null | undefined, fallback = '—'): string {
  if (value === null || value === undefined || value === '') return fallback;
  return value;
}

/**
 * 数字 > 99 显示 "99+"（用于徽章）
 */
export function formatBadge(count: number): string {
  if (count > 99) return '99+';
  return String(count);
}
