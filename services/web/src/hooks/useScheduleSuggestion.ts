/**
 * [artifact:接口联调代码] — 智能调度建议 React Query Hooks
 * Sprint 4 / FE-S4-API
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  scheduleSuggestionApi,
  type TriggerCalculationPayload,
  type ApplyProductionPayload,
} from '@/api/scheduleSuggestion';

// ─── Query Keys ────────────────────────────────
export const scheduleKeys = {
  all: ['schedule-suggestions'] as const,
  latest: () => [...scheduleKeys.all, 'latest'] as const,
  status: (jobId: string) => [...scheduleKeys.all, 'status', jobId] as const,
  history: (page: number, pageSize: number) =>
    [...scheduleKeys.all, 'history', { page, pageSize }] as const,
  snapshot: (batchId: string) => [...scheduleKeys.all, 'snapshot', batchId] as const,
};

// ─── Hooks ────────────────────────────────────

/**
 * 触发计算任务
 * 返回 jobId 后，使用 useCalculationStatus 轮询
 */
export function useTriggerCalculation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload?: TriggerCalculationPayload) =>
      scheduleSuggestionApi.triggerCalculation(payload),
    onSuccess: () => {
      // 计算完成后使历史记录缓存失效
      void qc.invalidateQueries({ queryKey: scheduleKeys.all });
    },
  });
}

/**
 * 轮询计算任务状态（每 2 秒一次）
 * jobId 为 null 时不触发请求
 */
export function useCalculationStatus(jobId: string | null) {
  return useQuery({
    queryKey: scheduleKeys.status(jobId ?? ''),
    queryFn: () => scheduleSuggestionApi.getCalculationStatus(jobId!),
    enabled: jobId !== null && jobId.length > 0,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      // 任务完成或失败后停止轮询
      if (status === 'completed' || status === 'failed') return false;
      return 2000;
    },
    staleTime: 0,
  });
}

/**
 * 获取最新建议结果
 */
export function useLatestSuggestion() {
  return useQuery({
    queryKey: scheduleKeys.latest(),
    queryFn: () => scheduleSuggestionApi.getLatestSuggestion(),
    staleTime: 30_000,
  });
}

/**
 * 历史记录列表（分页）
 */
export function useSuggestionHistory(page: number, pageSize: number) {
  return useQuery({
    queryKey: scheduleKeys.history(page, pageSize),
    queryFn: () => scheduleSuggestionApi.getHistory(page, pageSize),
    staleTime: 60_000,
    placeholderData: (previousData) => previousData,
  });
}

/**
 * 历史批次快照详情
 */
export function useBatchSnapshot(batchId: string | null) {
  return useQuery({
    queryKey: scheduleKeys.snapshot(batchId ?? ''),
    queryFn: () => scheduleSuggestionApi.getBatchSnapshot(batchId!),
    enabled: batchId !== null && batchId.length > 0,
    staleTime: 5 * 60_000,
  });
}

/**
 * 接受建议条目
 */
export function useAcceptItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (itemId: number) => scheduleSuggestionApi.acceptItem(itemId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: scheduleKeys.latest() });
    },
  });
}

/**
 * 驳回建议条目
 */
export function useRejectItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, reason }: { itemId: number; reason: string }) =>
      scheduleSuggestionApi.rejectItem(itemId, reason),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: scheduleKeys.latest() });
    },
  });
}

/**
 * 应用排产建议（批量）
 */
export function useApplyProduction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: ApplyProductionPayload) =>
      scheduleSuggestionApi.applyProduction(payload.itemIds[0]),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: scheduleKeys.all });
    },
  });
}
