/**
 * [artifact:接口联调代码] — 智能调度建议模块 API
 * Sprint 4 / FE-S4-API
 *
 * 端点前缀：/api/schedule-suggestions
 */

import request from '@/utils/request';
import type { PaginatedData } from '@/types/api';

// ─── 枚举 / 字面量类型 ─────────────────────────
export type ScheduleJobStatus = 'pending' | 'running' | 'completed' | 'failed';
export type SuggestionItemStatus = 'pending' | 'accepted' | 'rejected' | 'applied';
export type SuggestionSource = 'ai_schedule' | 'shortage_trigger' | 'manual';

// ─── 采购建议条目 ──────────────────────────────
export interface PurchaseSuggestionItem {
  id: number;
  skuCode: string;
  skuName: string;
  suggestedQty: string;
  unit: string;
  supplierName: string | null;
  estimatedAmount: string | null;
  reason: string;
  neededByDate: string | null;
  status: SuggestionItemStatus;
  source: SuggestionSource;
}

// ─── 排产建议条目（工单维度） ───────────────────
export interface WorkOrderSuggestionItem {
  id: number;
  workOrderNo: string;
  skuName: string;
  totalScore: number;
  rank: number;
  deadlineScore: number;
  priorityScore: number;
  materialReadinessScore: number;
  recommendedWorkerId: number | null;
  recommendedWorkerName: string | null;
  recommendedWorkerSkill: string | null;
  status: SuggestionItemStatus;
}

// ─── 建议批次（计算结果快照） ──────────────────
export interface SuggestionBatch {
  batchId: string;
  calculatedAt: string;
  purchaseItems: PurchaseSuggestionItem[];
  productionItems: WorkOrderSuggestionItem[];
  isColdStart: boolean;
  summary: {
    totalPurchaseItems: number;
    totalProductionItems: number;
    estimatedTotalAmount: string | null;
  };
}

// ─── 历史记录批次摘要 ──────────────────────────
export interface SuggestionHistoryBatch {
  batchId: string;
  calculatedAt: string;
  isColdStart: boolean;
  summary: {
    totalPurchaseItems: number;
    totalProductionItems: number;
    estimatedTotalAmount: string | null;
  };
  snapshot?: SuggestionBatch;
}

// ─── 计算任务状态 ──────────────────────────────
export interface CalculationJob {
  jobId: string;
  status: ScheduleJobStatus;
  progress?: number;
  errorMessage?: string;
  batchId?: string;
}

// ─── 触发计算请求 ──────────────────────────────
export interface TriggerCalculationPayload {
  forceRecalculate?: boolean;
}

// ─── 接受/驳回/应用 响应 ────────────────────────
export interface ItemActionResult {
  success: boolean;
  message?: string;
}

// ─── 应用排产建议 ──────────────────────────────
export interface ApplyProductionPayload {
  itemIds: number[];
}

// ─── API 函数 ──────────────────────────────────
export const scheduleSuggestionApi = {
  /** 触发计算，返回 jobId */
  triggerCalculation: (payload?: TriggerCalculationPayload) =>
    request.post<{ jobId: string }>('/api/schedule-suggestions/calculate', payload ?? {}),

  /** 查询计算任务状态 */
  getCalculationStatus: (jobId: string) =>
    request.get<CalculationJob>('/api/schedule-suggestions/status', { jobId }),

  /** 获取最新建议批次结果 */
  getLatestSuggestion: () =>
    request.get<SuggestionBatch | null>('/api/schedule-suggestions/latest'),

  /** 历史记录（分页） */
  getHistory: (page: number, pageSize: number) =>
    request.get<PaginatedData<SuggestionHistoryBatch>>('/api/schedule-suggestions/history', {
      page,
      pageSize,
    }),

  /** 获取历史批次快照详情 — CR-S4-007 fix: 路径对齐后端 /:id */
  getBatchSnapshot: (batchId: string) =>
    request.get<SuggestionBatch>(`/api/schedule-suggestions/${batchId}`),

  /** 接受采购/排产建议条目 */
  acceptItem: (itemId: number, modifiedQty?: string) =>
    request.post<ItemActionResult>(`/api/schedule-suggestions/items/${itemId}/accept`, { modifiedQty }),

  /** 驳回条目 — CR-S4-006 fix: 传递 reason 参数 */
  rejectItem: (itemId: number, reason: string) =>
    request.post<ItemActionResult>(`/api/schedule-suggestions/items/${itemId}/reject`, { reason }),

  /** 应用排产建议（单条） — CR-S4-008 fix: 对齐后端单条路由 */
  applyProduction: (itemId: number) =>
    request.post<ItemActionResult>(`/api/schedule-suggestions/items/${itemId}/apply`),
};
