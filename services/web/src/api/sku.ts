/**
 * [artifact:接口联调代码] — SKU 主数据 API
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import request from '@/utils/request';
import type {
  Sku,
  SkuCategory,
  SkuListQuery,
  CreateSkuPayload,
  UpdateSkuPayload,
  UnitConversion,
} from '@/types/models';
import type { PaginatedData } from '@/types/api';

// ── Query Keys ───────────────────────────────
export const skuKeys = {
  all: ['skus'] as const,
  lists: () => [...skuKeys.all, 'list'] as const,
  list: (query: SkuListQuery) => [...skuKeys.lists(), query] as const,
  detail: (id: number) => [...skuKeys.all, 'detail', id] as const,
  categories: () => [...skuKeys.all, 'categories'] as const,
};

// ── 原始请求函数 ─────────────────────────────
export const skuApi = {
  getCategories: () =>
    request.get<SkuCategory[]>('/api/skus/categories'),

  getList: (query: SkuListQuery) =>
    request.get<PaginatedData<Sku>>('/api/skus', query as Record<string, unknown>),

  getById: (id: number) =>
    request.get<Sku>(`/api/skus/${id}`),

  create: (payload: CreateSkuPayload) =>
    request.post<{ id: number; skuCode: string; tenantId: number; name: string }>('/api/skus', payload),

  update: (id: number, payload: UpdateSkuPayload) =>
    request.put<{ id: number; name: string }>(`/api/skus/${id}`, payload),

  updateUnitConversions: (id: number, conversions: Omit<UnitConversion, 'description'>[]) =>
    request.put<UnitConversion[]>(`/api/skus/${id}/unit-conversions`, { conversions }),
};

// ── React Query Hooks ────────────────────────

/** SKU 分类列表 */
export function useSkuCategories() {
  return useQuery({
    queryKey: skuKeys.categories(),
    queryFn: skuApi.getCategories,
    staleTime: 1000 * 60 * 10, // 分类变化少，缓存10分钟
  });
}

/** SKU 分页列表 */
export function useSkuList(query: SkuListQuery) {
  return useQuery({
    queryKey: skuKeys.list(query),
    queryFn: () => skuApi.getList(query),
  });
}

/** 单个 SKU 详情（含单位换算） */
export function useSkuDetail(id: number | null) {
  return useQuery({
    queryKey: skuKeys.detail(id!),
    queryFn: () => skuApi.getById(id!),
    enabled: id !== null && id > 0,
  });
}

/** 创建 SKU */
export function useCreateSku() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: skuApi.create,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: skuKeys.lists() });
    },
  });
}

/** 更新 SKU */
export function useUpdateSku(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: UpdateSkuPayload) => skuApi.update(id, payload),
    onMutate: async (payload) => {
      await qc.cancelQueries({ queryKey: skuKeys.detail(id) });
      const prev = qc.getQueryData<Sku>(skuKeys.detail(id));
      if (prev) {
        qc.setQueryData<Sku>(skuKeys.detail(id), { ...prev, ...payload });
      }
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(skuKeys.detail(id), ctx.prev);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: skuKeys.detail(id) });
      void qc.invalidateQueries({ queryKey: skuKeys.lists() });
    },
  });
}

/** 更新单位换算关系 */
export function useUpdateUnitConversions(skuId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (conversions: Omit<UnitConversion, 'description'>[]) =>
      skuApi.updateUnitConversions(skuId, conversions),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: skuKeys.detail(skuId) });
    },
  });
}
