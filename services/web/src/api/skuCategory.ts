/**
 * [artifact:接口联调代码] — SKU 类目管理 API
 * R-01: SKU 类目自定义配置
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import request from '@/utils/request';
import type {
  SkuCategoryFull,
  CreateCategoryPayload,
  UpdateCategoryPayload,
} from '@/types/models';

// ── Query Keys ───────────────────────────────
export const skuCategoryKeys = {
  all: ['sku-categories'] as const,
  lists: () => [...skuCategoryKeys.all, 'list'] as const,
  list: (params?: { level?: number; parentId?: number; includeInactive?: boolean }) =>
    [...skuCategoryKeys.lists(), params] as const,
  detail: (id: number) => [...skuCategoryKeys.all, 'detail', id] as const,
};

// ── 原始请求函数 ─────────────────────────────
export const skuCategoryApi = {
  /** GET /api/sku-categories — 获取类目列表（树形，含系统预置+租户自定义） */
  getList: (params?: { level?: number; parentId?: number; includeInactive?: boolean }) =>
    request.get<SkuCategoryFull[]>('/api/sku-categories', params as Record<string, unknown>),

  /** POST /api/sku-categories — 新增类目 */
  create: (payload: CreateCategoryPayload) =>
    request.post<SkuCategoryFull>('/api/sku-categories', payload),

  /** PUT /api/sku-categories/:id — 编辑类目名称/排序 */
  update: (id: number, payload: UpdateCategoryPayload) =>
    request.put<SkuCategoryFull>(`/api/sku-categories/${id}`, payload),

  /** DELETE /api/sku-categories/:id — 删除类目（软删除，含级联） */
  delete: (id: number) =>
    request.delete<void>(`/api/sku-categories/${id}`),
};

// ── React Query Hooks ────────────────────────

/** 类目列表（默认获取全部，含 children） */
export function useSkuCategoryList(params?: {
  level?: number;
  parentId?: number;
  includeInactive?: boolean;
}) {
  return useQuery({
    queryKey: skuCategoryKeys.list(params),
    queryFn: () => skuCategoryApi.getList(params),
    staleTime: 1000 * 60 * 5, // 5 分钟缓存
  });
}

/** 新增类目 Mutation */
export function useCreateCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateCategoryPayload) => skuCategoryApi.create(payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: skuCategoryKeys.lists() });
    },
  });
}

/** 编辑类目 Mutation */
export function useUpdateCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: UpdateCategoryPayload }) =>
      skuCategoryApi.update(id, payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: skuCategoryKeys.lists() });
    },
  });
}

/** 删除类目 Mutation */
export function useDeleteCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => skuCategoryApi.delete(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: skuCategoryKeys.lists() });
    },
  });
}
