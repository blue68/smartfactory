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
  list: (params?: { level?: number; parentId?: number; includeInactive?: boolean; editableView?: boolean }) =>
    [...skuCategoryKeys.lists(), params] as const,
  detail: (id: number) => [...skuCategoryKeys.all, 'detail', id] as const,
  deletePreview: (id: number) => [...skuCategoryKeys.all, 'delete-preview', id] as const,
  auditLogs: (params?: AuditLogParams) => [...skuCategoryKeys.all, 'audit-logs', params] as const,
};

// ── 审计日志参数 ──────────────────────────────
export interface AuditLogParams {
  type?: 'create' | 'update' | 'delete' | '';
  from?: string; // ISO date string
  to?: string;   // ISO date string
}

// ── 审计日志条目 ──────────────────────────────
export interface AuditLogEntry {
  id: number;
  type: 'create' | 'update' | 'delete';
  categoryId: number;
  categoryName: string;
  operatorName: string;
  operatedAt: string; // ISO datetime
  diff?: {
    field: string;
    oldValue: string;
    newValue: string;
  }[];
}

// ── 删除预览结果 ──────────────────────────────
export interface DeletePreviewResult {
  childCount: number;
  skuCount: number;
  isSystem: boolean;
}

// ── 排序载荷 ─────────────────────────────────
export interface ReorderPayload {
  ids: number[]; // ordered list of category ids
}

// ── 原始请求函数 ─────────────────────────────
export const skuCategoryApi = {
  /** GET /api/sku-categories — 获取类目列表（支持租户可管理视图） */
  getList: (params?: { level?: number; parentId?: number; includeInactive?: boolean; editableView?: boolean }) =>
    request.get<SkuCategoryFull[]>('/api/sku-categories', params as Record<string, unknown>),

  /** POST /api/sku-categories — 新增类目 */
  create: (payload: CreateCategoryPayload) =>
    request.post<SkuCategoryFull>('/api/sku-categories', payload),

  /** PATCH /api/sku-categories/:id — 编辑类目名称/排序（FE-01-06: PUT → PATCH） */
  update: (id: number, payload: UpdateCategoryPayload) =>
    request.patch<SkuCategoryFull>(`/api/sku-categories/${id}`, payload),

  /** DELETE /api/sku-categories/:id — 删除类目（软删除，含级联） */
  delete: (id: number) =>
    request.delete<void>(`/api/sku-categories/${id}`),

  /** GET /api/sku-categories/:id/delete-preview — 查询删除前关联数据（FE-01-04） */
  deletePreview: (id: number) =>
    request.get<DeletePreviewResult>(`/api/sku-categories/${id}/delete-preview`),

  /** PATCH /api/sku-categories/reorder — 批量更新排序（FE-01-02） */
  reorder: (payload: ReorderPayload) =>
    request.patch<void>('/api/sku-categories/reorder', payload),

  /** GET /api/sku-categories/audit-logs — 获取操作日志（FE-01-03） */
  getAuditLogs: (params?: AuditLogParams) =>
    request.get<AuditLogEntry[]>('/api/sku-categories/audit-logs', params as Record<string, unknown>),
};

// ── React Query Hooks ────────────────────────

/** 类目列表（默认获取全部，含 children） */
export function useSkuCategoryList(params?: {
  level?: number;
  parentId?: number;
  includeInactive?: boolean;
  editableView?: boolean;
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

/** 编辑类目 Mutation（PATCH） */
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

/** 删除预览查询（FE-01-04） */
export function useDeletePreview(id: number | null) {
  return useQuery({
    queryKey: skuCategoryKeys.deletePreview(id ?? 0),
    queryFn: () => skuCategoryApi.deletePreview(id!),
    enabled: id !== null,
    staleTime: 0, // 每次都重新获取最新关联数
  });
}

/** 批量排序 Mutation（FE-01-02） */
export function useReorderCategories() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: ReorderPayload) => skuCategoryApi.reorder(payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: skuCategoryKeys.lists() });
    },
  });
}

/** 操作日志查询（FE-01-03） */
export function useAuditLogs(params?: AuditLogParams) {
  return useQuery({
    queryKey: skuCategoryKeys.auditLogs(params),
    queryFn: () => skuCategoryApi.getAuditLogs(params),
    staleTime: 1000 * 30, // 30 秒缓存
  });
}

/** 获取单条分类的删除预览数据（命令式，用于弹框前查询） */
export async function fetchDeletePreview(id: number): Promise<DeletePreviewResult> {
  return skuCategoryApi.deletePreview(id);
}

/** 获取审计日志（命令式） */
export async function fetchAuditLogs(params?: AuditLogParams): Promise<AuditLogEntry[]> {
  return skuCategoryApi.getAuditLogs(params);
}
