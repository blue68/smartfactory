/**
 * [artifact:接口联调代码] — 供应商管理 API
 * R-02 扩展：供应商导出 + 绩效对比
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import request, { getAccessToken } from '@/utils/request';
import type { PaginatedData } from '@/types/api';

// ─────────────────────────────────────────────
// 详情相关类型
// ─────────────────────────────────────────────

export interface SupplierRelatedSku {
  id: number;
  skuCode: string;
  name: string;
  spec?: string;
  currentPrice: string;
  priceUnit: string;
  isMainSupplier: boolean;
}

export interface SupplierPriceAgreement {
  id: number;
  skuId: number;
  skuName: string;
  unitPrice: string;
  purchaseUnit: string;
  moq?: number;
  validFrom: string;
  validTo: string | null;
  isCurrent: boolean;
  /** 有效 | 即将到期 | 已过期 */
  status: string;
}

export interface SupplierDeliveryRecord {
  orderId: string;
  skuName: string;
  scheduledDate: string;
  actualDate: string;
  remark: string;
}

export interface SupplierPerformance {
  onTimeRate: string;
  qualityRate: string;
  avgLeadDays: string;
  totalOrders: number;
  recentDeliveries: SupplierDeliveryRecord[];
}

export interface SupplierPerfSnapshot {
  supplierId: number;
  supplierName: string;
  /** e.g. "96.0%" */
  onTimeRate: string;
  totalOrders: number;
  recentAmounts: Array<{ month: string; amount: string }>;
  /** e.g. "95.0%" */
  qualityRate: string;
  /** 0–100 */
  priceScore: number;
  /** avg response hours */
  responseHours: number;
  /** e.g. "88.5%" */
  completionRate: string;
  /** 0–100 */
  satisfactionScore: number;
  cooperationYears: number;
  totalPurchaseAmount: string;
  avgLeadDays: number;
}

// ─────────────────────────────────────────────
// 类型定义
// ─────────────────────────────────────────────

export type SupplierRating = 'A' | 'B' | 'C' | 'D';

export interface Supplier {
  id: number;
  name: string;
  code: string;
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  address?: string;
  /** 供应商评级 A/B/C/D */
  rating: SupplierRating;
  /** 账期（天） */
  paymentDays?: number;
  /** 是否启用 */
  isActive: boolean;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SupplierListQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  rating?: SupplierRating;
  isActive?: boolean;
}

export interface CreateSupplierPayload {
  name: string;
  code: string;
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  address?: string;
  rating: SupplierRating;
  paymentDays?: number;
  leadDays?: number;
  category?: string;
  isActive?: boolean;
  notes?: string;
}

export type UpdateSupplierPayload = Partial<CreateSupplierPayload>;

// ─────────────────────────────────────────────
// Query Keys
// ─────────────────────────────────────────────

export const supplierKeys = {
  all: ['suppliers'] as const,
  lists: () => [...supplierKeys.all, 'list'] as const,
  list: (query: SupplierListQuery) => [...supplierKeys.lists(), query] as const,
  detail: (id: number) => [...supplierKeys.all, 'detail', id] as const,
  /** 用于下拉选择，全量不分页 */
  options: () => [...supplierKeys.all, 'options'] as const,
  skus: (id: number) => [...supplierKeys.all, 'skus', id] as const,
  priceAgreements: (id: number) => [...supplierKeys.all, 'price-agreements', id] as const,
  performance: (id: number) => [...supplierKeys.all, 'performance', id] as const,
};

// ─────────────────────────────────────────────
// 原始请求函数
// ─────────────────────────────────────────────

export const supplierApi = {
  getList: (query: SupplierListQuery) =>
    request.get<PaginatedData<Supplier>>('/api/suppliers', query as Record<string, unknown>),

  getById: (id: number) =>
    request.get<Supplier>(`/api/suppliers/${id}`),

  getOptions: () =>
    request.get<Supplier[]>('/api/suppliers/options'),

  create: (payload: CreateSupplierPayload) =>
    request.post<Supplier>('/api/suppliers', payload),

  update: (id: number, payload: UpdateSupplierPayload) =>
    request.put<Supplier>(`/api/suppliers/${id}`, payload),

  getRelatedSkus: (id: number) =>
    request.get<SupplierRelatedSku[]>(`/api/suppliers/${id}/skus`),

  getPriceAgreements: (id: number) =>
    request.get<SupplierPriceAgreement[]>(`/api/suppliers/${id}/price-agreements`),

  getPerformance: (id: number) =>
    request.get<SupplierPerformance>(`/api/suppliers/${id}/performance`),

  comparePerformance: (supplierIds: number[], months?: number) =>
    request.post<SupplierPerfSnapshot[]>('/api/suppliers/compare', { supplierIds, months }),
};

// ─────────────────────────────────────────────
// React Query Hooks
// ─────────────────────────────────────────────

/** 供应商分页列表 */
export function useSupplierList(query: SupplierListQuery) {
  return useQuery({
    queryKey: supplierKeys.list(query),
    queryFn: () => supplierApi.getList(query),
  });
}

/** 供应商全量列表（用于下拉） */
export function useSupplierOptions() {
  return useQuery({
    queryKey: supplierKeys.options(),
    queryFn: supplierApi.getOptions,
    staleTime: 1000 * 60 * 5,
  });
}

/** 创建供应商 */
export function useCreateSupplier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: supplierApi.create,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: supplierKeys.lists() });
      void qc.invalidateQueries({ queryKey: supplierKeys.options() });
    },
  });
}

/** 更新供应商 */
export function useUpdateSupplier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: UpdateSupplierPayload }) =>
      supplierApi.update(id, payload),
    onSuccess: (_data, variables) => {
      void qc.invalidateQueries({ queryKey: supplierKeys.lists() });
      void qc.invalidateQueries({ queryKey: supplierKeys.detail(variables.id) });
      void qc.invalidateQueries({ queryKey: supplierKeys.options() });
    },
  });
}

/** 供应商关联SKU列表 */
export function useSupplierSkus(id: number | null) {
  return useQuery({
    queryKey: supplierKeys.skus(id ?? 0),
    queryFn: () => supplierApi.getRelatedSkus(id!),
    enabled: id !== null,
    staleTime: 1000 * 60 * 2,
  });
}

/** 供应商价格协议列表 */
export function useSupplierPriceAgreements(id: number | null) {
  return useQuery({
    queryKey: supplierKeys.priceAgreements(id ?? 0),
    queryFn: () => supplierApi.getPriceAgreements(id!),
    enabled: id !== null,
    staleTime: 1000 * 60 * 2,
  });
}

/** 供应商绩效数据 */
export function useSupplierPerformance(id: number | null) {
  return useQuery({
    queryKey: supplierKeys.performance(id ?? 0),
    queryFn: () => supplierApi.getPerformance(id!),
    enabled: id !== null,
    staleTime: 1000 * 60 * 2,
  });
}

// ─────────────────────────────────────────────
// 供应商导出（文件下载，不走 request 工具）
// ─────────────────────────────────────────────

/**
 * 调用 GET /api/suppliers/export，后端返回 Excel 文件。
 * 使用浏览器原生 fetch + Blob URL 触发下载，不经过 request 工具，
 * 因为 request 工具只处理 JSON 响应。
 */
export async function exportSuppliers(): Promise<void> {
  const token = getAccessToken();
  const response = await fetch('/api/suppliers/export', {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) throw new Error('导出失败');
  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `suppliers_${new Date().toISOString().slice(0, 10)}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
}
