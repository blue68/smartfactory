/**
 * [artifact:接口联调代码] — 来料质检模块 API (R-09)
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import request from '@/utils/request';
import type { PaginatedData } from '@/types/api';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface IncomingInspectionItem {
  id: number;
  inspectionId: number;
  skuId: number;
  poItemId: number;
  qtyDelivered: string;
  qtySampled: string;
  qtyPassed: string;
  qtyFailed: string;
  acceptedStockQty?: string | null;
  dyeLotNo?: string | null;
  hasDyeLot?: boolean;
  purchaseUnit?: string;
  stockUnit?: string;
  result: 'pass' | 'fail' | 'conditional_pass' | null;
  defectTypes: string[] | null;
  defectImages: string[] | null;
  disposition: 'accept' | 'return' | 'rework' | 'scrap' | null;
  notes: string | null;
  skuCode?: string;
  skuName?: string;
  [key: string]: unknown;
}

export interface IncomingInspection {
  id: number;
  inspectionNo: string;
  poId: number;
  deliveryNoteId: number | null;
  inspectorId: number;
  inspectionDate: string;
  status: 'draft' | 'in_progress' | 'passed' | 'partially_passed' | 'failed';
  overallResult: 'pass' | 'fail' | 'conditional_pass' | null;
  receiptTriggered: boolean;
  returnTriggered: boolean;
  notes: string | null;
  completedAt: string | null;
  // joined fields
  poNo?: string;
  supplierName?: string;
  items?: IncomingInspectionItem[];
  [key: string]: unknown;
}

export interface CreateInspectionPayload {
  poId: number;
  deliveryNoteId?: number;
  inspectorId: number;
  inspectionDate: string;
  notes?: string;
}

export interface UpdateInspectionItemsPayload {
  items: Array<{
    id?: number;
    sourceItemIds?: number[];
    qtyDelivered?: string;
    qtysampled: string;
    qtyPassed: string;
    qtyFailed: string;
    acceptedStockQty?: string;
    dyeLotNo?: string;
    result: 'pass' | 'fail' | 'conditional_pass' | null;
    defectTypes?: string[];
    disposition?: 'accept' | 'return' | 'rework' | 'scrap' | null;
    notes?: string;
  }>;
}

export interface SubmitInspectionPayload {
  overallResult: 'pass' | 'fail' | 'conditional_pass';
  warehouseId?: number;
  locationId?: number;
  notes?: string;
}

export interface InspectionListParams {
  status?: string;
  poId?: number;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
}

// ── Query Keys ─────────────────────────────────────────────────────────────────

export const inspectionKeys = {
  all: ['incoming-inspections'] as const,
  list: (params?: Record<string, unknown>) =>
    [...inspectionKeys.all, 'list', params] as const,
  detail: (id: number) => [...inspectionKeys.all, 'detail', id] as const,
  previewReceipt: (id: number) => [...inspectionKeys.all, 'preview-receipt', id] as const,
};

// ── API Functions ──────────────────────────────────────────────────────────────

export const incomingInspectionApi = {
  list: (params?: InspectionListParams) =>
    request.get<PaginatedData<IncomingInspection>>(
      '/api/incoming-inspections',
      params as Record<string, unknown>,
    ),

  getById: (id: number) =>
    request.get<IncomingInspection>(`/api/incoming-inspections/${id}`),

  create: (data: CreateInspectionPayload) =>
    request.post<{ id: number; inspectionNo: string }>(
      '/api/incoming-inspections',
      data,
    ),

  updateItems: (id: number, data: UpdateInspectionItemsPayload) =>
    request.put<null>(`/api/incoming-inspections/${id}/items`, data),

  submit: (id: number, data: SubmitInspectionPayload) =>
    request.post<null>(`/api/incoming-inspections/${id}/submit`, data),

  previewReceipt: (id: number) =>
    request.get<{ receiptId: number; receiptNo: string }>(
      `/api/incoming-inspections/${id}/preview-receipt`,
    ),
};

// ── React Query Hooks ──────────────────────────────────────────────────────────

/** 来料质检单列表 */
export function useInspectionList(params?: InspectionListParams) {
  return useQuery({
    queryKey: inspectionKeys.list(params as Record<string, unknown>),
    queryFn: () => incomingInspectionApi.list(params),
  });
}

/** 来料质检单详情 */
export function useInspectionDetail(id: number | null) {
  return useQuery({
    queryKey: inspectionKeys.detail(id!),
    queryFn: () => incomingInspectionApi.getById(id!),
    enabled: id !== null && id > 0,
  });
}

/** 创建来料质检单 */
export function useCreateInspection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: incomingInspectionApi.create,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: inspectionKeys.all });
    },
  });
}

/** 更新质检明细 */
export function useUpdateInspectionItems() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: UpdateInspectionItemsPayload }) =>
      incomingInspectionApi.updateItems(id, data),
    onSuccess: (_data, { id }) => {
      void qc.invalidateQueries({ queryKey: inspectionKeys.detail(id) });
      void qc.invalidateQueries({ queryKey: inspectionKeys.all });
    },
  });
}

/** 提交质检结论 */
export function useSubmitInspection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: SubmitInspectionPayload }) =>
      incomingInspectionApi.submit(id, data),
    onSuccess: (_data, variables) => {
      void qc.invalidateQueries({ queryKey: inspectionKeys.all });
      void qc.invalidateQueries({ queryKey: inspectionKeys.detail(variables.id) });
      void qc.invalidateQueries({ queryKey: inspectionKeys.previewReceipt(variables.id) });
    },
  });
}

/** 预览质检关联入库单 */
export function useInspectionPreviewReceipt(id: number | null, enabled = true) {
  return useQuery({
    queryKey: inspectionKeys.previewReceipt(id!),
    queryFn: () => incomingInspectionApi.previewReceipt(id!),
    enabled: enabled && id !== null && id > 0,
  });
}
