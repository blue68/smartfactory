/**
 * [artifact:接口联调代码] — 采购建议审批模块 API (Sprint 3)
 * 注：此模块对应 /api/purchase-suggestions 独立路径，
 * 与旧版 /api/purchase/suggestions 并行，由 MRP 模块生成建议后使用。
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import request from '@/utils/request';
import type { PaginatedData } from '@/types/api';

// ── Types ─────────────────────────────────────────────────────────────────────

export type PurchaseSuggestionSource = 'production_shortage' | 'manual' | 'ai_schedule';
export type PurchaseSuggestionStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'executed'
  | 'expired';

export interface PurchaseSuggestion {
  id: number;
  suggestion_no: string;
  source: PurchaseSuggestionSource;
  status: PurchaseSuggestionStatus;
  sku_id: number;
  sku_code: string;
  skuName: string;
  stock_unit?: string | null;
  purchase_unit?: string | null;
  suggested_supplier_id: number | null;
  supplierName: string | null;
  suggested_qty: string;
  estimated_price: string | null;
  estimated_amount: string | null;
  shortage_qty?: string | null;
  reason: string;
  confidence?: string | null;
  approved_by: number | null;
  approved_at: string | null;
  reject_reason?: string | null;
  created_at?: string;
  work_order_no?: string | null;
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

export interface BatchToPoResult {
  createdPOs: Array<{
    id: number;
    poNo: string;
    supplierId: number;
    itemCount: number;
  }>;
  executedSuggestionIds: number[];
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
    request.get<PaginatedData<PurchaseSuggestion>>(
      '/api/purchase-suggestions',
      params as Record<string, unknown>,
    ),

  approve: (id: number, data?: ApproveSuggestionV2Payload) =>
    request.put<null>(`/api/purchase-suggestions/${id}/approve`, data ?? {}),

  reject: (id: number, data: RejectSuggestionPayload) =>
    request.put<null>(`/api/purchase-suggestions/${id}/reject`, data),

  batchToPo: (data: BatchToPoPayload) =>
    request.post<BatchToPoResult>(
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
