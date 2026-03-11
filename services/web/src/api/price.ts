/**
 * [artifact:接口联调代码] — 价格管理 API
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import request from '@/utils/request';
import type { PaginatedData } from '@/types/api';

// ─────────────────────────────────────────────
// 类型定义
// ─────────────────────────────────────────────

export interface Price {
  id: number;
  skuId: number;
  skuCode: string;
  skuName: string;
  supplierId: number;
  supplierName: string;
  /** 含税单价（元） */
  unitPrice: string;
  /** 采购单位 */
  purchaseUnit: string;
  /** 最小起订量 */
  moq?: number;
  /** 报价有效期开始 */
  validFrom: string;
  /** 报价有效期截止，null 表示长期有效 */
  validTo: string | null;
  /** 是否为当前有效价格 */
  isActive: boolean;
  /** 备注 */
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PriceListQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  supplierId?: number;
  skuId?: number;
  isActive?: boolean;
}

export interface CreatePricePayload {
  skuId: number;
  supplierId: number;
  unitPrice: string;
  purchaseUnit: string;
  moq?: number;
  validFrom: string;
  validTo?: string;
  notes?: string;
}

export type UpdatePricePayload = Partial<CreatePricePayload>;

// ─────────────────────────────────────────────
// Query Keys
// ─────────────────────────────────────────────

export const priceKeys = {
  all: ['prices'] as const,
  lists: () => [...priceKeys.all, 'list'] as const,
  list: (query: PriceListQuery) => [...priceKeys.lists(), query] as const,
  detail: (id: number) => [...priceKeys.all, 'detail', id] as const,
};

// ─────────────────────────────────────────────
// 原始请求函数
// ─────────────────────────────────────────────

export const priceApi = {
  getList: (query: PriceListQuery) =>
    request.get<PaginatedData<Price>>('/api/prices', query as Record<string, unknown>),

  getById: (id: number) =>
    request.get<Price>(`/api/prices/${id}`),

  create: (payload: CreatePricePayload) =>
    request.post<Price>('/api/prices', payload),

  update: (id: number, payload: UpdatePricePayload) =>
    request.put<Price>(`/api/prices/${id}`, payload),
};

// ─────────────────────────────────────────────
// React Query Hooks
// ─────────────────────────────────────────────

/** 价格分页列表 */
export function usePriceList(query: PriceListQuery) {
  return useQuery({
    queryKey: priceKeys.list(query),
    queryFn: () => priceApi.getList(query),
  });
}

/** 创建价格 */
export function useCreatePrice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: priceApi.create,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: priceKeys.lists() });
    },
  });
}

/** 更新价格 */
export function useUpdatePrice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: UpdatePricePayload }) =>
      priceApi.update(id, payload),
    onSuccess: (_data, variables) => {
      void qc.invalidateQueries({ queryKey: priceKeys.lists() });
      void qc.invalidateQueries({ queryKey: priceKeys.detail(variables.id) });
    },
  });
}
