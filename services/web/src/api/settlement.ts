/**
 * [artifact:接口联调代码] — 销售结算模块 API
 *
 * 后端接口：
 *   GET  /api/settlements             — 结算单列表
 *   POST /api/settlements             — 从销售订单创建结算单
 *   PUT  /api/settlements/:id/confirm — 确认结算
 *   PUT  /api/settlements/:id/pay     — 标记已付款
 *   PUT  /api/settlements/:id/cancel  — 取消结算
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import request from '@/utils/request';

// ── 类型定义 ───────────────────────────────────────────────

export type SettlementStatus = 'draft' | 'confirmed' | 'paid' | 'cancelled';

export const SettlementStatusLabel: Record<SettlementStatus, string> = {
  draft: '草稿',
  confirmed: '已确认',
  paid: '已付款',
  cancelled: '已取消',
};

export interface Settlement {
  id: number;
  settlementNo: string;
  salesOrderId: number;
  salesOrderNo: string;
  customerId: number;
  customerName: string;
  totalAmount: string;
  paidAmount: string;
  status: SettlementStatus;
  dueDate?: string;
  createdAt: string;
  confirmedAt?: string;
  paidAt?: string;
  notes?: string;
}

export interface SettlementListResult {
  list: Settlement[];
  total: number;
  page: number;
  pageSize: number;
}

export interface SettlementListQuery {
  page?: number;
  pageSize?: number;
  status?: SettlementStatus | '';
  keyword?: string;
}

export interface CreateSettlementPayload {
  salesOrderId: number;
  notes?: string;
}

// ── Query Keys ─────────────────────────────────────────────

export const settlementKeys = {
  all: ['settlement'] as const,
  list: (query: SettlementListQuery) =>
    [...settlementKeys.all, 'list', query] as const,
};

// ── API 函数 ────────────────────────────────────────────────

export const settlementApi = {
  getList: (query: SettlementListQuery) => {
    const params: Record<string, unknown> = {
      page: query.page ?? 1,
      pageSize: query.pageSize ?? 20,
    };
    if (query.status) params.status = query.status;
    if (query.keyword) params.keyword = query.keyword;
    return request.get<SettlementListResult>('/api/settlements', params);
  },

  create: (payload: CreateSettlementPayload) =>
    request.post<Settlement>('/api/settlements', payload),

  confirm: (id: number) =>
    request.put<void>(`/api/settlements/${id}/confirm`),

  pay: (id: number) =>
    request.put<void>(`/api/settlements/${id}/pay`),

  cancel: (id: number) =>
    request.put<void>(`/api/settlements/${id}/cancel`),
};

// ── React Query Hooks ───────────────────────────────────────

export function useSettlementList(query: SettlementListQuery) {
  return useQuery({
    queryKey: settlementKeys.list(query),
    queryFn: () => settlementApi.getList(query),
    staleTime: 30_000,
  });
}

export function useCreateSettlement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateSettlementPayload) =>
      settlementApi.create(payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: settlementKeys.all });
    },
  });
}

export function useConfirmSettlement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => settlementApi.confirm(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: settlementKeys.all });
    },
  });
}

export function usePaySettlement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => settlementApi.pay(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: settlementKeys.all });
    },
  });
}

export function useCancelSettlement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => settlementApi.cancel(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: settlementKeys.all });
    },
  });
}
