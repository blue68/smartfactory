/**
 * [artifact:接口联调代码] — 采购建议审批模块 API (Sprint 3)
 * 注：此模块对应 /api/purchase-suggestions 独立路径，
 * 与旧版 /api/purchase/suggestions 并行，由 MRP 模块生成建议后使用。
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import request from '@/utils/request';
import type { PaginatedData } from '@/types/api';

// ── Types ─────────────────────────────────────────────────────────────────────

export type PurchaseSuggestionSource = 'mrp' | 'manual' | 'ai';
export type PurchaseSuggestionStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'converted';

export interface PurchaseSuggestionV2 {
  id: number;
  source: PurchaseSuggestionSource;
  status: PurchaseSuggestionStatus;
  skuId: number;
  skuCode: string;
  skuName: string;
  unit: string;
  suggestedQty: string;
  suggestedSupplierId: number | null;
  supplierName: string | null;
  estimatedPrice: string | null;
  estimatedAmount: string | null;
  reason: string;
  neededByDate: string | null;
  approvedById: number | null;
  approvedAt: string | null;
  rejectedReason: string | null;
  convertedPoId: number | null;
  createdAt: string;
  [key: string]: unknown;
}

export interface ApproveSuggestionV2Payload {
  notes?: string;
}

export interface RejectSuggestionPayload {
  reason: string;
}

export interface BatchToPoPayload {
  suggestionIds: number[];
  supplierId?: number;
  expectedDeliveryDate?: string;
  notes?: string;
}

export interface PurchaseSuggestionListParams {
  source?: PurchaseSuggestionSource;
  status?: PurchaseSuggestionStatus;
  skuId?: number;
  page?: number;
  pageSize?: number;
}

// ── Query Keys ─────────────────────────────────────────────────────────────────

export const purchaseSuggestionKeys = {
  all: ['purchase-suggestions'] as const,
  list: (params?: Record<string, unknown>) =>
    [...purchaseSuggestionKeys.all, 'list', params] as const,
  detail: (id: number) =>
    [...purchaseSuggestionKeys.all, 'detail', id] as const,
};

// ── API Functions ──────────────────────────────────────────────────────────────

export const purchaseSuggestionApi = {
  list: (params?: PurchaseSuggestionListParams) =>
    request.get<PaginatedData<PurchaseSuggestionV2>>(
      '/api/purchase-suggestions',
      params as Record<string, unknown>,
    ),

  approve: (id: number, data?: ApproveSuggestionV2Payload) =>
    request.put<null>(`/api/purchase-suggestions/${id}/approve`, data ?? {}),

  reject: (id: number, data: RejectSuggestionPayload) =>
    request.put<null>(`/api/purchase-suggestions/${id}/reject`, data),

  batchToPo: (data: BatchToPoPayload) =>
    request.post<{ poId: number; poNo: string }>(
      '/api/purchase-suggestions/batch-to-po',
      data,
    ),
};

// ── React Query Hooks ──────────────────────────────────────────────────────────

/** 采购建议列表 */
export function usePurchaseSuggestionList(params?: PurchaseSuggestionListParams) {
  return useQuery({
    queryKey: purchaseSuggestionKeys.list(params as Record<string, unknown>),
    queryFn: () => purchaseSuggestionApi.list(params),
  });
}

/** 审批通过 */
export function useApprovePurchaseSuggestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: number;
      data?: ApproveSuggestionV2Payload;
    }) => purchaseSuggestionApi.approve(id, data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: purchaseSuggestionKeys.all });
    },
  });
}

/** 驳回 */
export function useRejectPurchaseSuggestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: RejectSuggestionPayload }) =>
      purchaseSuggestionApi.reject(id, data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: purchaseSuggestionKeys.all });
    },
  });
}

/** 批量转采购单 */
export function useBatchToPo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: BatchToPoPayload) =>
      purchaseSuggestionApi.batchToPo(data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: purchaseSuggestionKeys.all });
      // 同时刷新采购订单列表
      void qc.invalidateQueries({ queryKey: ['purchase'] });
    },
  });
}
