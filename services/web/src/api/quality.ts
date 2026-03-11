/**
 * [artifact:接口联调代码] — 质量溯源模块 API
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import request from '@/utils/request';
import type {
  QualityInspection,
  QualityIssue,
  TraceabilityChain,
  QualityStats,
} from '@/types/models';
import type { PaginatedData } from '@/types/api';
import type { InspectionStatus, IssueType, IssueSeverity } from '@/types/enums';

// ── Query Keys ───────────────────────────────
export const qualityKeys = {
  all: ['quality'] as const,
  inspections: () => [...qualityKeys.all, 'inspections'] as const,
  inspectionList: (params: { status?: InspectionStatus; productionOrderId?: number }) =>
    [...qualityKeys.inspections(), params] as const,
  traceability: (productionOrderId: number) =>
    [...qualityKeys.all, 'trace', productionOrderId] as const,
  stats: (periodDays: number) => [...qualityKeys.all, 'stats', periodDays] as const,
};

// ── 原始请求函数 ─────────────────────────────
export const qualityApi = {
  getInspections: (params?: {
    status?: InspectionStatus;
    productionOrderId?: number;
    page?: number;
    pageSize?: number;
  }) =>
    request.get<PaginatedData<QualityInspection>>(
      '/api/quality/inspections',
      params as Record<string, unknown>,
    ),

  createInspection: (payload: {
    productionOrderId: number;
    inspectionDate: string;
    qtyInspected: string;
  }) =>
    request.post<{ id: number; inspectionNo: string }>(
      '/api/quality/inspections',
      payload,
    ),

  createIssue: (payload: {
    inspectionId: number;
    componentName: string;
    issueTypes: IssueType[];
    severity: IssueSeverity;
    description: string;
    images?: string[];
  }) =>
    request.post<{ issueId: number }>('/api/quality/inspections/issues', payload),

  completeInspection: (id: number, qtyPassed: string) =>
    request.post<null>(`/api/quality/inspections/${id}/complete`, { qtyPassed }),

  getTraceability: (productionOrderId: number) =>
    request.get<TraceabilityChain>(
      `/api/quality/traceability/${productionOrderId}`,
    ),

  getStats: (periodDays: 7 | 30 | 90 = 30) =>
    request.get<QualityStats>('/api/quality/stats', { periodDays }),
};

// ── React Query Hooks ────────────────────────

/** 验货单列表 */
export function useInspectionList(
  params: { status?: InspectionStatus; productionOrderId?: number } = {},
  page = 1,
  pageSize = 20,
) {
  return useQuery({
    queryKey: qualityKeys.inspectionList(params),
    queryFn: () => qualityApi.getInspections({ ...params, page, pageSize }),
  });
}

/** 创建验货单 */
export function useCreateInspection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: qualityApi.createInspection,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qualityKeys.inspections() });
    },
  });
}

/** 录入质量问题 */
export function useCreateIssue() {
  return useMutation({
    mutationFn: qualityApi.createIssue,
  });
}

/** 完成验货 */
export function useCompleteInspection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, qtyPassed }: { id: number; qtyPassed: string }) =>
      qualityApi.completeInspection(id, qtyPassed),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qualityKeys.inspections() });
    },
  });
}

/** 溯源链查询 */
export function useTraceability(productionOrderId: number | null) {
  return useQuery({
    queryKey: qualityKeys.traceability(productionOrderId!),
    queryFn: () => qualityApi.getTraceability(productionOrderId!),
    enabled: productionOrderId !== null && productionOrderId > 0,
  });
}

/** 质量统计分析 */
export function useQualityStats(periodDays: 7 | 30 | 90 = 30) {
  return useQuery({
    queryKey: qualityKeys.stats(periodDays),
    queryFn: () => qualityApi.getStats(periodDays),
  });
}

// 类型导出（供外部组件使用）
export type { QualityIssue };
