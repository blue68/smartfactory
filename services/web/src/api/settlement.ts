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
  overdueOnly?: boolean;
  customerId?: number;
}

export interface CreateSettlementPayload {
  salesOrderId: number;
  notes?: string;
}

export type ReceivableGroupBy = 'customer' | 'month' | 'aging';

export interface ReceivableByCustomer {
  customerId: number;
  customerName: string;
  totalAmount: string;
  pendingCount: number;
}

export interface ReceivableByMonth {
  month: string;
  totalAmount: string;
  count: number;
}

export interface ReceivableByAging {
  bucket: 'current' | '1_30' | '31_60' | '61_90' | '90_plus';
  label: string;
  totalAmount: string;
  count: number;
}

export interface ReceivableSummaryCustomer {
  groupBy: 'customer';
  data: ReceivableByCustomer[];
}

export interface ReceivableSummaryMonth {
  groupBy: 'month';
  data: ReceivableByMonth[];
}

export interface ReceivableSummaryAging {
  groupBy: 'aging';
  data: ReceivableByAging[];
  overdueAmount: string;
  overdueCount: number;
}

export type ReceivableSummary =
  | ReceivableSummaryCustomer
  | ReceivableSummaryMonth
  | ReceivableSummaryAging;

// ── Query Keys ─────────────────────────────────────────────

export const settlementKeys = {
  all: ['settlement'] as const,
  list: (query: SettlementListQuery) =>
    [...settlementKeys.all, 'list', query] as const,
  receivable: (groupBy: ReceivableGroupBy) =>
    [...settlementKeys.all, 'receivable', groupBy] as const,
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
    if (query.customerId) params.customerId = query.customerId;
    if (query.overdueOnly) params.overdueOnly = query.overdueOnly;
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

  getReceivable: (groupBy: ReceivableGroupBy) =>
    request.get<ReceivableSummary>('/api/settlements/receivable', { groupBy }),

  exportCsv: async (query: SettlementListQuery) => {
    const blob = await request.downloadBlob('/api/settlements/export/csv', {
      status: query.status || undefined,
      keyword: query.keyword || undefined,
      overdueOnly: query.overdueOnly || undefined,
      customerId: query.customerId,
    });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `销售结算_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  },
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

export function useSettlementReceivable(groupBy: ReceivableGroupBy, enabled = true) {
  return useQuery({
    queryKey: settlementKeys.receivable(groupBy),
    queryFn: () => settlementApi.getReceivable(groupBy),
    staleTime: 30_000,
    enabled,
  });
}
