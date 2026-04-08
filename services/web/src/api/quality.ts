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
import type { InspectionStatus, IssueType } from '@/types/enums';

export type QualityIssueSeverity = 'minor' | 'normal' | 'severe';

// ── Query Keys ───────────────────────────────
export const qualityKeys = {
  all: ['quality'] as const,
  inspections: () => [...qualityKeys.all, 'inspections'] as const,
  inspectionList: (params: { status?: InspectionStatus; productionOrderId?: number }) =>
    [...qualityKeys.inspections(), params] as const,
  productionOrderOptions: (keyword: string, limit: number) =>
    [...qualityKeys.all, 'production-order-options', keyword, limit] as const,
  inspectionOptions: (keyword: string, limit: number) =>
    [...qualityKeys.all, 'inspection-options', keyword, limit] as const,
  traceability: (productionOrderId: number) =>
    [...qualityKeys.all, 'trace', productionOrderId] as const,
  stats: (periodDays: number) => [...qualityKeys.all, 'stats', periodDays] as const,
};

export interface QualityProductionOrderOption {
  id: number;
  workOrderNo: string;
  skuName: string;
  salesOrderNo: string;
  status: string;
  plannedStart: string | null;
  plannedEnd: string | null;
}

export interface QualityInspectionOption {
  id: number;
  inspectionNo: string;
  inspectionDate: string;
  workOrderNo: string;
  skuName: string;
  status: string;
}

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
    productionOrderNo: string;
    inspectionDate: string;
    qtyInspected: string;
  }) =>
    request.post<{ id: number; inspectionNo: string }>(
      '/api/quality/inspections',
      payload,
    ),

  createIssue: (payload: {
    inspectionNo: string;
    componentName: string;
    issueTypes: IssueType[];
    severity: QualityIssueSeverity;
    description: string;
    images?: string[];
  }) =>
    request.post<{ issueId: number }>('/api/quality/inspections/issues', payload),

  getProductionOrderOptions: (params?: { keyword?: string; limit?: number }) =>
    request.get<QualityProductionOrderOption[]>(
      '/api/quality/production-orders/options',
      params as Record<string, unknown>,
    ),

  getInspectionOptions: (params?: { keyword?: string; limit?: number }) =>
    request.get<QualityInspectionOption[]>(
      '/api/quality/inspection-options',
      params as Record<string, unknown>,
    ),

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
  const qc = useQueryClient();
  return useMutation({
    mutationFn: qualityApi.createIssue,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qualityKeys.all });
    },
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

/** 质量问题列表（分页 + 筛选） */
export function useIssueList(
  params: { severity?: QualityIssueSeverity; issueType?: IssueType } = {},
  page = 1,
  pageSize = 20,
  enabled = true,
) {
  return useQuery({
    queryKey: [...qualityKeys.all, 'issues', params, page, pageSize] as const,
    queryFn: () =>
      request.get<PaginatedData<{
        id: number;
        inspectionId: number;
        inspectionNo: string;
        productionOrderId: number;
        productionOrderNo: string;
        componentName: string;
        issueTypes: IssueType[];
        severity: QualityIssueSeverity;
        description: string | null;
        images: string[] | null;
        createdAt: string;
      }>>('/api/quality/issues', { ...params, page, pageSize } as Record<string, unknown>),
    enabled,
  });
}

/** 质量模块可选生产工单号（用于 QC 新建验货单） */
export function useQualityProductionOrderOptions(
  keyword = '',
  limit = 50,
  enabled = true,
) {
  return useQuery({
    queryKey: qualityKeys.productionOrderOptions(keyword, limit),
    queryFn: () => qualityApi.getProductionOrderOptions({ keyword, limit }),
    enabled,
  });
}

/** 质量模块可选验货单号（用于录入质量问题） */
export function useQualityInspectionOptions(
  keyword = '',
  limit = 50,
  enabled = true,
) {
  return useQuery({
    queryKey: qualityKeys.inspectionOptions(keyword, limit),
    queryFn: () => qualityApi.getInspectionOptions({ keyword, limit }),
    enabled,
  });
}

/** 上传质量问题图片（复用通用上传接口） */
export async function uploadQualityImage(file: File): Promise<{ url: string; originalName: string; size: number }> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await request.instance.post('/api/upload', formData, {
    headers: { 'Content-Type': undefined as unknown as string },
  });
  return res.data.data;
}

// 类型导出（供外部组件使用）
export type { QualityIssue };
