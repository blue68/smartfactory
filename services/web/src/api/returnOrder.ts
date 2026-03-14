/**
 * [artifact:接口联调代码] — 退货管理模块 API (R-09)
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import request from '@/utils/request';
import type { PaginatedData } from '@/types/api';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ReturnOrderItem {
  id: number;
  returnOrderId: number;
  skuId: number;
  inspectionItemId: number | null;
  qty: string;
  unit: string;
  returnReason: string;
  notes: string | null;
  skuCode?: string;
  skuName?: string;
  [key: string]: unknown;
}

export interface ReturnOrder {
  id: number;
  returnNo: string;
  returnType: 'purchase_return' | 'production_return';
  sourcePoId: number | null;
  sourceInspectionId: number | null;
  supplierId: number | null;
  status: 'draft' | 'confirmed' | 'shipped' | 'completed' | 'cancelled';
  returnReason: string;
  totalQty: string;
  notes: string | null;
  createdAt?: string;
  confirmedAt?: string;
  shippedAt?: string;
  completedAt?: string;
  supplierName?: string;
  poNo?: string;
  items?: ReturnOrderItem[];
  [key: string]: unknown;
}

export interface CreateReturnOrderPayload {
  returnType: 'purchase_return' | 'production_return';
  sourcePoId?: number;
  sourceInspectionId?: number;
  supplierId?: number;
  returnReason: string;
  notes?: string;
  items: Array<{
    skuId: number;
    inspectionItemId?: number;
    qty: string;
    unit: string;
    returnReason: string;
  }>;
}

export interface ReturnOrderListParams {
  status?: string;
  supplierId?: number;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
}

// ── Query Keys ─────────────────────────────────────────────────────────────────

export const returnOrderKeys = {
  all: ['return-orders'] as const,
  list: (params?: Record<string, unknown>) =>
    [...returnOrderKeys.all, 'list', params] as const,
  detail: (id: number) => [...returnOrderKeys.all, 'detail', id] as const,
};

// ── API Functions ──────────────────────────────────────────────────────────────

export const returnOrderApi = {
  list: (params?: ReturnOrderListParams) =>
    request.get<PaginatedData<ReturnOrder>>(
      '/api/return-orders',
      params as Record<string, unknown>,
    ),

  getById: (id: number) =>
    request.get<ReturnOrder>(`/api/return-orders/${id}`),

  create: (data: CreateReturnOrderPayload) =>
    request.post<{ id: number; returnNo: string }>('/api/return-orders', data),

  confirm: (id: number) =>
    request.put<null>(`/api/return-orders/${id}/confirm`, {}),

  ship: (id: number, data?: { trackingNo?: string; notes?: string }) =>
    request.put<null>(`/api/return-orders/${id}/ship`, data ?? {}),

  complete: (id: number, data?: { notes?: string }) =>
    request.put<null>(`/api/return-orders/${id}/complete`, data ?? {}),
};

// ── React Query Hooks ──────────────────────────────────────────────────────────

/** 退货单列表 */
export function useReturnOrderList(params?: ReturnOrderListParams) {
  return useQuery({
    queryKey: returnOrderKeys.list(params as Record<string, unknown>),
    queryFn: () => returnOrderApi.list(params),
  });
}

/** 退货单详情 */
export function useReturnOrderDetail(id: number | null) {
  return useQuery({
    queryKey: returnOrderKeys.detail(id!),
    queryFn: () => returnOrderApi.getById(id!),
    enabled: id !== null && id > 0,
  });
}

/** 创建退货单 */
export function useCreateReturnOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: returnOrderApi.create,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: returnOrderKeys.all });
    },
  });
}

/** 确认退货 */
export function useConfirmReturnOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => returnOrderApi.confirm(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: returnOrderKeys.all });
    },
  });
}

/** 标记发出 */
export function useShipReturnOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data?: { trackingNo?: string; notes?: string } }) =>
      returnOrderApi.ship(id, data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: returnOrderKeys.all });
    },
  });
}

/** 标记完成 */
export function useCompleteReturnOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data?: { notes?: string } }) =>
      returnOrderApi.complete(id, data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: returnOrderKeys.all });
    },
  });
}
