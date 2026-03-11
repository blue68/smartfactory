/**
 * [artifact:接口联调代码] — 采购模块 API
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import request from '@/utils/request';
import type {
  PurchaseSuggestion,
  ApproveSuggestionPayload,
  PurchaseOrder,
  CreatePurchaseOrderPayload,
  ThreeWayMatch,
  ThreeWayMatchPayload,
  ConfirmMatchPayload,
} from '@/types/models';
import type { PaginatedData } from '@/types/api';
import type { SuggestionStatus, PurchaseOrderStatus, MatchStatus } from '@/types/enums';

// ── Query Keys ───────────────────────────────
export const purchaseKeys = {
  all: ['purchase'] as const,
  suggestions: () => [...purchaseKeys.all, 'suggestions'] as const,
  suggestionList: (status?: SuggestionStatus) =>
    [...purchaseKeys.suggestions(), { status }] as const,
  orders: () => [...purchaseKeys.all, 'orders'] as const,
  orderList: (status?: PurchaseOrderStatus) => [...purchaseKeys.orders(), { status }] as const,
  orderDetail: (id: number) => [...purchaseKeys.orders(), 'detail', id] as const,
  matches: () => [...purchaseKeys.all, 'matches'] as const,
  matchList: (status?: MatchStatus) => [...purchaseKeys.matches(), { status }] as const,
};

// ── 原始请求函数 ─────────────────────────────
export const purchaseApi = {
  generateSuggestions: () =>
    request.post<PurchaseSuggestion[]>('/api/purchase/suggestions/generate'),

  getSuggestions: (params?: { status?: SuggestionStatus; page?: number; pageSize?: number }) =>
    request.get<PaginatedData<PurchaseSuggestion>>(
      '/api/purchase/suggestions',
      params as Record<string, unknown>,
    ),

  approveSuggestion: (id: number, payload: ApproveSuggestionPayload) =>
    request.post<null>(`/api/purchase/suggestions/${id}/approve`, payload),

  getOrders: (params?: { status?: PurchaseOrderStatus; supplierId?: number; page?: number; pageSize?: number }) =>
    request.get<PaginatedData<PurchaseOrder>>(
      '/api/purchase/orders',
      params as Record<string, unknown>,
    ),

  getOrderById: (id: number) =>
    request.get<PurchaseOrder>(`/api/purchase/orders/${id}`),

  createOrder: (payload: CreatePurchaseOrderPayload) =>
    request.post<{ id: number; poNo: string }>('/api/purchase/orders', payload),

  createDelivery: (orderId: number, payload: unknown) =>
    request.post<{ id: number; deliveryNo: string }>(
      `/api/purchase/orders/${orderId}/delivery`,
      payload,
    ),

  executeThreeWayMatch: (payload: ThreeWayMatchPayload) =>
    request.post<ThreeWayMatch>('/api/purchase/three-way-match', payload),

  getMatches: (params?: { status?: MatchStatus; supplierId?: number; page?: number; pageSize?: number }) =>
    request.get<PaginatedData<ThreeWayMatch>>(
      '/api/purchase/three-way-match',
      params as Record<string, unknown>,
    ),

  confirmMatch: (id: number, payload: ConfirmMatchPayload) =>
    request.post<null>(`/api/purchase/three-way-match/${id}/confirm`, payload),
};

// ── React Query Hooks ────────────────────────

/** 采购建议列表 */
export function useSuggestionList(status?: SuggestionStatus, page = 1, pageSize = 20) {
  return useQuery({
    queryKey: purchaseKeys.suggestionList(status),
    queryFn: () => purchaseApi.getSuggestions({ status, page, pageSize }),
  });
}

/** 触发生成采购建议 */
export function useGenerateSuggestions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: purchaseApi.generateSuggestions,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: purchaseKeys.suggestions() });
    },
  });
}

/** 审批采购建议 */
export function useApproveSuggestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: ApproveSuggestionPayload }) =>
      purchaseApi.approveSuggestion(id, payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: purchaseKeys.suggestions() });
    },
  });
}

/** 采购订单列表 */
export function usePurchaseOrderList(status?: PurchaseOrderStatus, page = 1, pageSize = 20) {
  return useQuery({
    queryKey: purchaseKeys.orderList(status),
    queryFn: () => purchaseApi.getOrders({ status, page, pageSize }),
  });
}

/** 采购订单详情 */
export function usePurchaseOrderDetail(id: number | null) {
  return useQuery({
    queryKey: purchaseKeys.orderDetail(id!),
    queryFn: () => purchaseApi.getOrderById(id!),
    enabled: id !== null && id > 0,
  });
}

/** 创建采购订单 */
export function useCreatePurchaseOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: purchaseApi.createOrder,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: purchaseKeys.orders() });
    },
  });
}

/** 三单匹配列表 */
export function useMatchList(status?: MatchStatus, page = 1, pageSize = 20) {
  return useQuery({
    queryKey: purchaseKeys.matchList(status),
    queryFn: () => purchaseApi.getMatches({ status, page, pageSize }),
  });
}

/** 执行三单匹配 */
export function useExecuteThreeWayMatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: purchaseApi.executeThreeWayMatch,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: purchaseKeys.matches() });
    },
  });
}

/** 确认差异 */
export function useConfirmMatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: ConfirmMatchPayload }) =>
      purchaseApi.confirmMatch(id, payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: purchaseKeys.matches() });
    },
  });
}
