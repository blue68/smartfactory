/**
 * [artifact:接口联调代码] — 销售订单 API (R-08)
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import request from '@/utils/request';
import type { PaginatedData } from '@/types/api';

// ─────────────────────────────────────────────
// 类型定义
// ─────────────────────────────────────────────

export type SalesOrderStatus =
  | 'draft'
  | 'pending_approval'
  | 'confirmed'
  | 'in_production'
  | 'shipped'
  | 'completed'
  | 'closed';

export interface SalesOrderItem {
  id?: number;
  orderId?: number;
  productId?: number;
  productCode?: string;
  productName: string;
  spec?: string;
  /** 后端 DECIMAL，字符串类型 */
  quantity: string;
  unit?: string;
  /** 后端 DECIMAL，字符串类型 */
  unitPrice: string;
  /** 后端 DECIMAL，字符串类型 */
  amount: string;
  notes?: string;
}

export interface SalesOrder {
  id: number;
  orderNo: string;
  customerId: number;
  customerName: string;
  customerCode?: string;
  orderDate: string;
  deliveryDate: string;
  isUrgent: boolean;
  status: SalesOrderStatus;
  /** 后端 DECIMAL，字符串类型 */
  totalAmount: string;
  notes?: string;
  approvalReason?: string;
  createdAt: string;
  updatedAt: string;
  items?: SalesOrderItem[];
}

export interface SalesOrderListQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  status?: SalesOrderStatus | '';
  customerId?: number | '';
  isUrgent?: boolean | '';
}

export interface CreateSalesOrderPayload {
  customerId: number;
  orderDate: string;
  deliveryDate: string;
  isUrgent: boolean;
  notes?: string;
  items: Array<{
    skuId: number;
    productId?: number;
    productName: string;
    spec?: string;
    quantity: number;
    unit?: string;
    unitPrice: string;
    notes?: string;
  }>;
}

export interface ApprovalTransitionPayload {
  targetStatus: SalesOrderStatus;
}

export interface RejectPayload {
  reason: string;
}

// ─────────────────────────────────────────────
// API 函数
// ─────────────────────────────────────────────

const BASE = '/api/sales-orders';

export async function fetchSalesOrders(query: SalesOrderListQuery): Promise<PaginatedData<SalesOrder>> {
  return request.get<PaginatedData<SalesOrder>>(BASE, query as Record<string, unknown>);
}

export async function fetchSalesOrder(id: number): Promise<SalesOrder> {
  return request.get<SalesOrder>(`${BASE}/${id}`);
}

export async function createSalesOrder(payload: CreateSalesOrderPayload): Promise<SalesOrder> {
  return request.post<SalesOrder>(BASE, payload);
}

export async function updateSalesOrderItems(id: number, items: SalesOrderItem[]): Promise<SalesOrder> {
  return request.put<SalesOrder>(`${BASE}/${id}/items`, { items });
}

export async function transitionSalesOrder(id: number, payload: ApprovalTransitionPayload): Promise<SalesOrder> {
  return request.post<SalesOrder>(`${BASE}/${id}/transition`, payload);
}

export async function submitSalesOrder(id: number): Promise<SalesOrder> {
  return request.post<SalesOrder>(`${BASE}/${id}/submit`);
}

export async function approveSalesOrder(id: number): Promise<SalesOrder> {
  return request.post<SalesOrder>(`${BASE}/${id}/approve`);
}

export async function rejectSalesOrder(id: number, payload: RejectPayload): Promise<SalesOrder> {
  return request.post<SalesOrder>(`${BASE}/${id}/reject`, payload);
}

export async function withdrawSalesOrder(id: number): Promise<SalesOrder> {
  return request.post<SalesOrder>(`${BASE}/${id}/withdraw`);
}

/** PUT /api/sales-orders/:id — 编辑订单（仅 draft 状态） */
export async function updateSalesOrder(id: number, payload: Partial<CreateSalesOrderPayload>): Promise<SalesOrder> {
  return request.put<SalesOrder>(`${BASE}/${id}`, payload);
}

/** POST /api/sales-orders/:id/confirm — 常规订单确认 */
export async function confirmSalesOrder(id: number): Promise<void> {
  return request.post<void>(`${BASE}/${id}/confirm`);
}

/** POST /api/sales-orders/:id/ship — 标记发货 */
export async function shipSalesOrder(id: number): Promise<void> {
  return request.post<void>(`${BASE}/${id}/ship`);
}

/** POST /api/sales-orders/:id/complete — 标记完成 */
export async function completeSalesOrder(id: number): Promise<void> {
  return request.post<void>(`${BASE}/${id}/complete`);
}

/** POST /api/sales-orders/:id/close — 关闭订单 */
export async function closeSalesOrder(id: number, reason: string): Promise<void> {
  return request.post<void>(`${BASE}/${id}/close`, { reason });
}

/** POST /api/sales-orders/:id/production-orders — 触发建工单 */
export async function createProductionOrders(id: number): Promise<{ productionOrderIds: number[] }> {
  return request.post<{ productionOrderIds: number[] }>(`${BASE}/${id}/production-orders`);
}

/** GET /api/sales-orders/pending-approvals — 待审批列表 */
export async function fetchPendingApprovals(): Promise<{ count: number; orders: SalesOrder[] }> {
  return request.get<{ count: number; orders: SalesOrder[] }>(`${BASE}/pending-approvals`);
}

export interface OrderStats {
  total: number;
  byStatus: {
    draft: number;
    submitted: number;
    confirmed: number;
    pending_approval: number;
    in_production: number;
    shipped: number;
    completed: number;
    closed: number;
    [key: string]: number;
  };
}

/** GET /api/sales-orders/stats — 聚合统计接口 */
export async function fetchOrderStats(): Promise<OrderStats> {
  return request.get<OrderStats>(`${BASE}/stats`);
}

/** GET /api/inventory/check — 库存实时查询 */
export async function checkInventory(skuId: number, qty?: number): Promise<{ available: number; sufficient: boolean; stockUnit: string }> {
  return request.get<{ available: number; sufficient: boolean; stockUnit: string }>('/api/inventory/check', { skuId, qty });
}

// ─────────────────────────────────────────────
// React Query Hooks
// ─────────────────────────────────────────────

export function useSalesOrderList(query: SalesOrderListQuery) {
  return useQuery({
    queryKey: ['sales-orders', query],
    queryFn: () => fetchSalesOrders(query),
  });
}

export function useSalesOrder(id: number | null) {
  return useQuery({
    queryKey: ['sales-order', id],
    queryFn: () => fetchSalesOrder(id!),
    enabled: id !== null,
  });
}

export function useCreateSalesOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createSalesOrder,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sales-orders'] });
    },
  });
}

export function useUpdateSalesOrderItems() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, items }: { id: number; items: SalesOrderItem[] }) =>
      updateSalesOrderItems(id, items),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: ['sales-orders'] });
      qc.invalidateQueries({ queryKey: ['sales-order', id] });
    },
  });
}

export function useTransitionSalesOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, targetStatus }: { id: number; targetStatus: SalesOrderStatus }) =>
      transitionSalesOrder(id, { targetStatus }),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: ['sales-orders'] });
      qc.invalidateQueries({ queryKey: ['sales-order', id] });
    },
  });
}

export function useSubmitSalesOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => submitSalesOrder(id),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['sales-orders'] });
      qc.invalidateQueries({ queryKey: ['sales-order', id] });
    },
  });
}

export function useApproveSalesOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => approveSalesOrder(id),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['sales-orders'] });
      qc.invalidateQueries({ queryKey: ['sales-order', id] });
    },
  });
}

export function useRejectSalesOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) =>
      rejectSalesOrder(id, { reason }),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: ['sales-orders'] });
      qc.invalidateQueries({ queryKey: ['sales-order', id] });
    },
  });
}

export function useWithdrawSalesOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => withdrawSalesOrder(id),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['sales-orders'] });
      qc.invalidateQueries({ queryKey: ['sales-order', id] });
    },
  });
}

export function useConfirmSalesOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => confirmSalesOrder(id),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['sales-orders'] });
      qc.invalidateQueries({ queryKey: ['sales-order', id] });
      qc.invalidateQueries({ queryKey: ['pending-approvals'] });
    },
  });
}

export function useShipSalesOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => shipSalesOrder(id),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['sales-orders'] });
      qc.invalidateQueries({ queryKey: ['sales-order', id] });
    },
  });
}

export function useCompleteSalesOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => completeSalesOrder(id),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['sales-orders'] });
      qc.invalidateQueries({ queryKey: ['sales-order', id] });
    },
  });
}

export function useCloseSalesOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => closeSalesOrder(id, reason),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: ['sales-orders'] });
      qc.invalidateQueries({ queryKey: ['sales-order', id] });
    },
  });
}

export function useCreateProductionOrders() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => createProductionOrders(id),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['sales-orders'] });
      qc.invalidateQueries({ queryKey: ['sales-order', id] });
    },
  });
}

export function usePendingApprovals() {
  return useQuery({
    queryKey: ['pending-approvals'],
    queryFn: fetchPendingApprovals,
    refetchInterval: 30_000,
  });
}

export function useOrderStats() {
  return useQuery({
    queryKey: ['sales-orders', 'stats'],
    queryFn: fetchOrderStats,
    staleTime: 30_000,
  });
}
