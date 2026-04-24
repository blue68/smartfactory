/**
 * [artifact:接口联调代码] — 采购模块 API
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import request from '@/utils/request';
import type {
  PurchaseSuggestion,
  ApproveSuggestionPayload,
  PurchaseOrder,
  PurchaseOrderTailRow,
  DeliveryNote,
  PurchaseReceipt,
  CreatePurchaseOrderPayload,
  CreateDeliveryNotePayload,
  ClosePurchaseOrderPayload,
  UpdatePurchaseReceiptNotesPayload,
  ThreeWayMatch,
  ThreeWayMatchPayload,
  ConfirmMatchPayload,
} from '@/types/models';
import type { PaginatedData } from '@/types/api';
import type { SuggestionStatus, PurchaseOrderStatus, MatchStatus } from '@/types/enums';

export type PurchaseSettlementStatus = 'draft' | 'confirmed' | 'paid' | 'cancelled';

export const PurchaseSettlementStatusLabel: Record<PurchaseSettlementStatus, string> = {
  draft: '草稿',
  confirmed: '已确认',
  paid: '已付款',
  cancelled: '已取消',
};

export interface PurchaseSettlement {
  id: number;
  settlementNo: string;
  matchId: number;
  poId: number;
  poNo: string;
  deliveryNoteId: number;
  deliveryNo: string;
  receiptId: number;
  receiptNo: string;
  dyeLotSummary?: string[];
  supplierId: number;
  supplierName: string;
  totalAmount: string;
  status: PurchaseSettlementStatus;
  dueDate: string | null;
  notes: string | null;
  diffReason: string | null;
  diffNotes: string | null;
  returnOrderCount: number;
  completedReturnOrderCount: number;
  returnQty: string;
  returnAmount: string;
  confirmedBy: string | null;
  confirmedAt: string | null;
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PurchaseSettlementListQuery {
  page?: number;
  pageSize?: number;
  status?: PurchaseSettlementStatus | '';
  poId?: number;
  keyword?: string;
}

export interface CreatePurchaseSettlementPayload {
  matchId: number;
  notes?: string;
}

// ── Query Keys ───────────────────────────────
export const purchaseKeys = {
  all: ['purchase'] as const,
  suggestions: () => [...purchaseKeys.all, 'suggestions'] as const,
  suggestionList: (status?: SuggestionStatus) =>
    [...purchaseKeys.suggestions(), { status }] as const,
  orders: () => [...purchaseKeys.all, 'orders'] as const,
  orderList: (status?: PurchaseOrderStatus) => [...purchaseKeys.orders(), { status }] as const,
  orderDetail: (id: number) => [...purchaseKeys.orders(), 'detail', id] as const,
  orderTailTracking: (page: number, pageSize: number) =>
    [...purchaseKeys.orders(), 'tail-tracking', { page, pageSize }] as const,
  deliveries: () => [...purchaseKeys.all, 'deliveries'] as const,
  deliveryList: (params?: { status?: string; poId?: number; page?: number; pageSize?: number }) =>
    [...purchaseKeys.deliveries(), 'list', params] as const,
  deliveryDetail: (id: number) => [...purchaseKeys.deliveries(), 'detail', id] as const,
  receipts: () => [...purchaseKeys.all, 'receipts'] as const,
  receiptList: (params?: { status?: string; poId?: number; page?: number; pageSize?: number; assetAcceptanceOnly?: boolean }) =>
    [...purchaseKeys.receipts(), 'list', params] as const,
  receiptDetail: (id: number) => [...purchaseKeys.receipts(), 'detail', id] as const,
  matches: () => [...purchaseKeys.all, 'matches'] as const,
  matchList: (params?: { status?: MatchStatus; supplierId?: number; poId?: number; receiptId?: number; page?: number; pageSize?: number }) =>
    [...purchaseKeys.matches(), 'list', params] as const,
  matchDetail: (id: number) => [...purchaseKeys.matches(), 'detail', id] as const,
  settlements: () => [...purchaseKeys.all, 'settlements'] as const,
  settlementList: (params?: PurchaseSettlementListQuery) =>
    [...purchaseKeys.settlements(), 'list', params] as const,
  settlementDetail: (id: number) => [...purchaseKeys.settlements(), 'detail', id] as const,
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

  feedbackSuggestion: (id: number, payload: { feedback: string }) =>
    request.post<null>(`/api/purchase/suggestions/${id}/feedback`, payload),

  getOrders: (params?: { status?: PurchaseOrderStatus; supplierId?: number; keyword?: string; page?: number; pageSize?: number }) =>
    request.get<PaginatedData<PurchaseOrder>>(
      '/api/purchase/orders',
      params as Record<string, unknown>,
    ),

  getOrderById: (id: number) =>
    request.get<PurchaseOrder>(`/api/purchase/orders/${id}`),

  getTailTracking: (params?: { page?: number; pageSize?: number }) =>
    request.get<PaginatedData<PurchaseOrderTailRow>>(
      '/api/purchase/orders/tail-tracking',
      params as Record<string, unknown>,
    ),

  createOrder: (payload: CreatePurchaseOrderPayload) =>
    request.post<{ id: number; poNo: string }>('/api/purchase/orders', payload),

  closeOrder: (id: number, payload: ClosePurchaseOrderPayload) =>
    request.patch<null>(`/api/purchase/orders/${id}/close`, payload),

  createDelivery: (orderId: number, payload: CreateDeliveryNotePayload) =>
    request.post<{ id: number; deliveryNo: string }>(
      `/api/purchase/orders/${orderId}/delivery`,
      payload,
    ),

  getDeliveries: (params?: { status?: string; poId?: number; page?: number; pageSize?: number }) =>
    request.get<PaginatedData<DeliveryNote>>(
      '/api/purchase/delivery-notes',
      params as Record<string, unknown>,
    ),

  getDeliveryById: (id: number) =>
    request.get<DeliveryNote>(`/api/purchase/delivery-notes/${id}`),

  getReceipts: (params?: { status?: string; poId?: number; page?: number; pageSize?: number; assetAcceptanceOnly?: boolean }) =>
    request.get<PaginatedData<PurchaseReceipt>>(
      '/api/purchase/receipts',
      params as Record<string, unknown>,
    ),

  getReceiptById: (id: number) =>
    request.get<PurchaseReceipt>(`/api/purchase/receipts/${id}`),

  updateReceiptNotes: (id: number, payload: UpdatePurchaseReceiptNotesPayload) =>
    request.patch<null>(`/api/purchase/receipts/${id}/notes`, payload),

  executeThreeWayMatch: (payload: ThreeWayMatchPayload) =>
    request.post<ThreeWayMatch>('/api/purchase/three-way-match', payload),

  getMatches: (params?: { status?: MatchStatus; supplierId?: number; poId?: number; receiptId?: number; page?: number; pageSize?: number }) =>
    request.get<PaginatedData<ThreeWayMatch>>(
      '/api/purchase/three-way-match',
      params as Record<string, unknown>,
    ),

  getMatchById: (id: number) =>
    request.get<ThreeWayMatch>(`/api/purchase/three-way-match/${id}`),

  confirmMatch: (id: number, payload: ConfirmMatchPayload) =>
    request.post<null>(`/api/purchase/three-way-match/${id}/confirm`, payload),

  getSettlements: (params?: PurchaseSettlementListQuery) =>
    request.get<PaginatedData<PurchaseSettlement>>(
      '/api/purchase/settlements',
      params as Record<string, unknown>,
    ),

  getSettlementById: (id: number) =>
    request.get<PurchaseSettlement>(`/api/purchase/settlements/${id}`),

  createSettlement: (payload: CreatePurchaseSettlementPayload) =>
    request.post<PurchaseSettlement>('/api/purchase/settlements', payload),

  confirmSettlement: (id: number) =>
    request.put<PurchaseSettlement>(`/api/purchase/settlements/${id}/confirm`),

  paySettlement: (id: number) =>
    request.put<PurchaseSettlement>(`/api/purchase/settlements/${id}/pay`),

  cancelSettlement: (id: number) =>
    request.put<PurchaseSettlement>(`/api/purchase/settlements/${id}/cancel`),

  exportSettlementsCsv: async (query: PurchaseSettlementListQuery) => {
    const blob = await request.downloadBlob('/api/purchase/settlements/export/csv', {
      status: query.status || undefined,
      poId: query.poId,
      keyword: query.keyword || undefined,
    });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `采购结算_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  },
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

export function useFeedbackSuggestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: { feedback: string } }) =>
      purchaseApi.feedbackSuggestion(id, payload),
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
    placeholderData: (previous) => previous,
  });
}

/** 尾单追踪 */
export function usePurchaseOrderTailTracking(page = 1, pageSize = 20) {
  return useQuery({
    queryKey: purchaseKeys.orderTailTracking(page, pageSize),
    queryFn: () => purchaseApi.getTailTracking({ page, pageSize }),
  });
}

/** 采购送货单列表 */
export function usePurchaseDeliveryList(params?: { status?: string; poId?: number; page?: number; pageSize?: number }) {
  return useQuery({
    queryKey: purchaseKeys.deliveryList(params),
    queryFn: () => purchaseApi.getDeliveries(params),
    placeholderData: (previous) => previous,
  });
}

/** 采购送货单详情 */
export function usePurchaseDeliveryDetail(id: number | null) {
  return useQuery({
    queryKey: purchaseKeys.deliveryDetail(id!),
    queryFn: () => purchaseApi.getDeliveryById(id!),
    enabled: id !== null && id > 0,
    gcTime: 30_000,
  });
}

/** 创建采购送货单 */
export function useCreatePurchaseDelivery() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ orderId, payload }: { orderId: number; payload: CreateDeliveryNotePayload }) =>
      purchaseApi.createDelivery(orderId, payload),
    onSuccess: (_data, variables) => {
      void qc.invalidateQueries({ queryKey: purchaseKeys.deliveries() });
      void qc.invalidateQueries({ queryKey: purchaseKeys.orders() });
      void qc.invalidateQueries({ queryKey: purchaseKeys.orderDetail(variables.orderId) });
    },
  });
}

/** 采购入库记录列表 */
export function usePurchaseReceiptList(params?: { status?: string; poId?: number; page?: number; pageSize?: number; assetAcceptanceOnly?: boolean }) {
  return useQuery({
    queryKey: purchaseKeys.receiptList(params),
    queryFn: () => purchaseApi.getReceipts(params),
  });
}

/** 采购入库记录详情 */
export function usePurchaseReceiptDetail(id: number | null) {
  return useQuery({
    queryKey: purchaseKeys.receiptDetail(id!),
    queryFn: () => purchaseApi.getReceiptById(id!),
    enabled: id !== null && id > 0,
  });
}

/** 更新入库备注 */
export function useUpdatePurchaseReceiptNotes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: UpdatePurchaseReceiptNotesPayload }) =>
      purchaseApi.updateReceiptNotes(id, payload),
    onSuccess: (_data, variables) => {
      void qc.invalidateQueries({ queryKey: purchaseKeys.receipts() });
      void qc.invalidateQueries({ queryKey: purchaseKeys.receiptDetail(variables.id) });
    },
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

/** 关闭采购订单 */
export function useClosePurchaseOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: ClosePurchaseOrderPayload }) =>
      purchaseApi.closeOrder(id, payload),
    onSuccess: (_data, variables) => {
      void qc.invalidateQueries({ queryKey: purchaseKeys.orders() });
      void qc.invalidateQueries({ queryKey: purchaseKeys.orderDetail(variables.id) });
    },
  });
}

/** 三单匹配列表 */
export function useMatchList(params?: { status?: MatchStatus; supplierId?: number; poId?: number; receiptId?: number; page?: number; pageSize?: number }) {
  return useQuery({
    queryKey: purchaseKeys.matchList(params),
    queryFn: () => purchaseApi.getMatches(params),
  });
}

/** 三单匹配详情 */
export function useMatchDetail(id: number | null) {
  return useQuery({
    queryKey: purchaseKeys.matchDetail(id!),
    queryFn: () => purchaseApi.getMatchById(id!),
    enabled: id !== null && id > 0,
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

/** 采购结算列表 */
export function usePurchaseSettlementList(params?: PurchaseSettlementListQuery) {
  return useQuery({
    queryKey: purchaseKeys.settlementList(params),
    queryFn: () => purchaseApi.getSettlements(params),
  });
}

/** 采购结算详情 */
export function usePurchaseSettlementDetail(id: number | null) {
  return useQuery({
    queryKey: purchaseKeys.settlementDetail(id!),
    queryFn: () => purchaseApi.getSettlementById(id!),
    enabled: id !== null && id > 0,
  });
}

/** 创建采购结算单 */
export function useCreatePurchaseSettlement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: purchaseApi.createSettlement,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: purchaseKeys.matches() });
      void qc.invalidateQueries({ queryKey: purchaseKeys.settlements() });
    },
  });
}

/** 确认采购结算单 */
export function useConfirmPurchaseSettlement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => purchaseApi.confirmSettlement(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: purchaseKeys.settlements() });
    },
  });
}

/** 标记采购结算单已付款 */
export function usePayPurchaseSettlement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => purchaseApi.paySettlement(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: purchaseKeys.settlements() });
    },
  });
}

/** 取消采购结算单 */
export function useCancelPurchaseSettlement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => purchaseApi.cancelSettlement(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: purchaseKeys.settlements() });
    },
  });
}
