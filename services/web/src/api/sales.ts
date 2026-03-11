/**
 * [artifact:接口联调代码] — 销售订单模块 API
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import request from '@/utils/request';
import type {
  SalesOrder,
  CreateSalesOrderPayload,
  SalesOrderCreateResult,
  UrgentAnalysisPayload,
  UrgentAnalysisResult,
} from '@/types/models';
import type { PaginatedData } from '@/types/api';
import type { SalesOrderStatus, ApprovalAction } from '@/types/enums';
import { config } from '@/config';

// ── Query Keys ───────────────────────────────
export const salesKeys = {
  all: ['sales'] as const,
  orders: () => [...salesKeys.all, 'orders'] as const,
  orderList: (params: { status?: SalesOrderStatus; customerId?: number }) =>
    [...salesKeys.orders(), params] as const,
  orderDetail: (id: number) => [...salesKeys.orders(), 'detail', id] as const,
};

// ── 原始请求函数 ─────────────────────────────
export const salesApi = {
  getOrders: (params?: {
    status?: SalesOrderStatus;
    customerId?: number;
    page?: number;
    pageSize?: number;
  }) =>
    request.get<PaginatedData<SalesOrder>>(
      '/api/sales/orders',
      params as Record<string, unknown>,
    ),

  getOrderById: (id: number) =>
    request.get<SalesOrder>(`/api/sales/orders/${id}`),

  createOrder: (payload: CreateSalesOrderPayload) =>
    request.post<SalesOrderCreateResult>('/api/sales/orders', payload),

  approveOrder: (id: number, action: ApprovalAction, notes?: string) =>
    request.post<null>(`/api/sales/orders/${id}/approve`, { action, notes }),

  analyzeUrgent: (payload: UrgentAnalysisPayload) =>
    request.post<UrgentAnalysisResult>(
      '/api/sales/orders/analyze-urgent',
      payload,
      { timeout: config.aiRequestTimeout },
    ),
};

// ── React Query Hooks ────────────────────────

/** 销售订单列表 */
export function useSalesOrderList(
  params: { status?: SalesOrderStatus; customerId?: number } = {},
  page = 1,
  pageSize = 20,
) {
  return useQuery({
    queryKey: salesKeys.orderList(params),
    queryFn: () => salesApi.getOrders({ ...params, page, pageSize }),
  });
}

/** 销售订单详情 */
export function useSalesOrderDetail(id: number | null) {
  return useQuery({
    queryKey: salesKeys.orderDetail(id!),
    queryFn: () => salesApi.getOrderById(id!),
    enabled: id !== null && id > 0,
  });
}

/** 创建销售订单（内含约束引擎检查，1-3s 响应） */
export function useCreateSalesOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: salesApi.createOrder,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: salesKeys.orders() });
    },
  });
}

/** 审批超限订单 */
export function useApproveOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      action,
      notes,
    }: {
      id: number;
      action: ApprovalAction;
      notes?: string;
    }) => salesApi.approveOrder(id, action, notes),
    onSuccess: (_data, { id }) => {
      void qc.invalidateQueries({ queryKey: salesKeys.orderDetail(id) });
      void qc.invalidateQueries({ queryKey: salesKeys.orders() });
    },
  });
}

/** 紧急插单影响分析（最长 30s，展示 AI 思考状态） */
export function useUrgentAnalysis() {
  return useMutation({
    mutationFn: salesApi.analyzeUrgent,
  });
}
