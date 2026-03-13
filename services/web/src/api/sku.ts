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
import type { SkuStatus } from '@/types/enums';
import type { PaginatedData } from '@/types/api';

// ── 本地类型 ────────────────────────────────
/** SKU 统计信息（对应 GET /api/skus/stats） */
export interface SkuStats {
  total: number;
  rawMaterial: number;
  semiProduct: number;
  finished: number;
  noSafetyStock: number;
  incomplete: number;
}

// ── Query Keys ───────────────────────────────
export const skuKeys = {
  all: ['skus'] as const,
  lists: () => [...skuKeys.all, 'list'] as const,
  list: (query: SkuListQuery) => [...skuKeys.lists(), query] as const,
  detail: (id: number) => [...skuKeys.all, 'detail', id] as const,
  categories: () => [...skuKeys.all, 'categories'] as const,
  stats: () => [...skuKeys.all, 'stats'] as const,
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

  /** GET /api/skus/stats — 获取 SKU 统计信息 */
  getStats: () =>
    request.get<SkuStats>('/api/skus/stats'),

  /** PUT /api/skus/batch-status — 批量更新状态 */
  batchUpdateStatus: (ids: number[], status: SkuStatus) =>
    request.put<void>('/api/skus/batch-status', { ids, status }),

  /** PUT /api/skus/batch-safety-stock — 批量设置安全库存 */
  batchSetSafetyStock: (ids: number[], safetyStock: number) =>
    request.put<void>('/api/skus/batch-safety-stock', { ids, safetyStock }),

  /** GET /api/skus/export — 导出 SKU 列表（返回 Blob） */
  exportSkus: (query: SkuListQuery) =>
    request.get<Blob>('/api/skus/export', query as Record<string, unknown>),

  /** POST /api/skus/import — 导入 SKU（multipart/form-data） */
  importSkus: (file: File, mapping?: Record<string, string>) => {
    const form = new FormData();
    form.append('file', file);
    if (mapping) form.append('mapping', JSON.stringify(mapping));
    // 必须删除默认 Content-Type: application/json，让浏览器自动设置 multipart/form-data + boundary
    return request.post<{ imported: number; failed: number; errors?: Array<{ row: number; message: string }> }>(
      '/api/skus/import', form, { headers: { 'Content-Type': undefined as unknown as string } },
    );
  },
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

/** SKU 统计信息 */
export function useSkuStats() {
  return useQuery({
    queryKey: skuKeys.stats(),
    queryFn: skuApi.getStats,
    staleTime: 1000 * 60 * 2, // 统计数据2分钟缓存
  });
}

/** 创建 SKU */
export function useCreateSku() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: skuApi.create,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: skuKeys.lists() });
      void qc.invalidateQueries({ queryKey: skuKeys.stats() });
    },
  });
}

/**
 * 更新 SKU
 *
 * 修复：移除 hook 级别的 id 参数，改由 mutationFn 接收 `{ id, payload }` 对象，
 * 与页面侧调用 `updateMutation.mutateAsync({ id, payload })` 保持一致。
 */
export function useUpdateSku() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: UpdateSkuPayload }) =>
      skuApi.update(id, payload),
    onMutate: async ({ id, payload }) => {
      await qc.cancelQueries({ queryKey: skuKeys.detail(id) });
      const prev = qc.getQueryData<Sku>(skuKeys.detail(id));
      if (prev) {
        qc.setQueryData<Sku>(skuKeys.detail(id), { ...prev, ...payload });
      }
      return { prev, id };
    },
    onError: (_err, { id }, ctx) => {
      if (ctx?.prev) qc.setQueryData(skuKeys.detail(id), ctx.prev);
    },
    onSettled: (_data, _err, { id }) => {
      void qc.invalidateQueries({ queryKey: skuKeys.detail(id) });
      void qc.invalidateQueries({ queryKey: skuKeys.lists() });
    },
  });
}

/**
 * 更新单位换算关系
 *
 * 修复：移除 hook 级别的 skuId 参数，改由 mutationFn 接收 `{ id, conversions }` 对象。
 */
export function useUpdateUnitConversions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      conversions,
    }: {
      id: number;
      conversions: Omit<UnitConversion, 'description'>[];
    }) => skuApi.updateUnitConversions(id, conversions),
    onSuccess: (_data, { id }) => {
      void qc.invalidateQueries({ queryKey: skuKeys.detail(id) });
    },
  });
}

/**
 * 批量更新 SKU 状态
 *
 * 用法：`batchStatusMutation.mutateAsync({ ids: [1,2,3], status: 'active' })`
 */
export function useBatchUpdateStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, status }: { ids: number[]; status: SkuStatus }) =>
      skuApi.batchUpdateStatus(ids, status),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: skuKeys.lists() });
      void qc.invalidateQueries({ queryKey: skuKeys.stats() });
    },
  });
}

/**
 * 批量设置安全库存
 *
 * 用法：`batchSafetyMutation.mutateAsync({ ids: [1,2,3], safetyStock: 100 })`
 */
export function useBatchSetSafetyStock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, safetyStock }: { ids: number[]; safetyStock: number }) =>
      skuApi.batchSetSafetyStock(ids, safetyStock),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: skuKeys.lists() });
      void qc.invalidateQueries({ queryKey: skuKeys.stats() });
    },
  });
}
