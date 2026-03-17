/**
 * [artifact:接口联调代码] — 库存盘点模块 API
 *
 * 后端接口：
 *   GET    /api/stocktaking           — 盘点任务列表
 *   POST   /api/stocktaking           — 创建盘点任务
 *   GET    /api/stocktaking/:id/items — 盘点明细
 *   PUT    /api/stocktaking/:id/items — 批量更新实盘数量
 *   POST   /api/stocktaking/:id/confirm — 确认盘点结果（boss only）
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import request from '@/utils/request';

// ── 类型定义 ───────────────────────────────────────────────

export type StocktakingScope = 'all' | 'category' | 'location';
export type StocktakingStatus = 'draft' | 'in_progress' | 'pending_confirm' | 'confirmed' | 'cancelled';

export const StocktakingScopeLabel: Record<StocktakingScope, string> = {
  all: '全库盘点',
  category: '按品类盘点',
  location: '按库位盘点',
};

export const StocktakingStatusLabel: Record<StocktakingStatus, string> = {
  draft: '草稿',
  in_progress: '盘点中',
  pending_confirm: '待确认',
  confirmed: '已确认',
  cancelled: '已取消',
};

export interface StocktakingTask {
  id: number;
  taskNo: string;
  scope: StocktakingScope;
  scopeValue?: string;
  status: StocktakingStatus;
  totalItems: number;
  diffItems: number;
  createdAt: string;
  confirmedAt?: string;
  createdBy?: string;
}

export interface StocktakingItem {
  id: number;
  taskId: number;
  skuId: number;
  skuCode: string;
  skuName: string;
  stockUnit: string;
  systemQty: string;
  actualQty: string | null;
  diffQty: string | null;
}

export interface StocktakingListResult {
  list: StocktakingTask[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CreateStocktakingPayload {
  scope: StocktakingScope;
  scopeValue?: string;
  notes?: string;
}

export interface UpdateItemsPayload {
  items: Array<{ id: number; actualQty: string }>;
}

// ── Query Keys ─────────────────────────────────────────────

export const stocktakingKeys = {
  all: ['stocktaking'] as const,
  list: (page: number, pageSize: number) =>
    [...stocktakingKeys.all, 'list', page, pageSize] as const,
  items: (taskId: number) => [...stocktakingKeys.all, 'items', taskId] as const,
};

// ── API 函数 ────────────────────────────────────────────────

export const stocktakingApi = {
  getList: (page = 1, pageSize = 20) =>
    request.get<StocktakingListResult>('/api/stocktaking', { page, pageSize }),

  create: (payload: CreateStocktakingPayload) =>
    request.post<StocktakingTask>('/api/stocktaking', payload),

  getItems: (taskId: number) =>
    request.get<StocktakingItem[]>(`/api/stocktaking/${taskId}/items`),

  updateItems: (taskId: number, payload: UpdateItemsPayload) =>
    request.put<void>(`/api/stocktaking/${taskId}/items`, payload),

  confirm: (taskId: number) =>
    request.post<void>(`/api/stocktaking/${taskId}/confirm`),
};

// ── React Query Hooks ───────────────────────────────────────

export function useStocktakingList(page = 1, pageSize = 20) {
  return useQuery({
    queryKey: stocktakingKeys.list(page, pageSize),
    queryFn: () => stocktakingApi.getList(page, pageSize),
    staleTime: 30_000,
  });
}

export function useStocktakingItems(taskId: number | null) {
  return useQuery({
    queryKey: stocktakingKeys.items(taskId ?? 0),
    queryFn: () => stocktakingApi.getItems(taskId!),
    enabled: taskId !== null,
    staleTime: 15_000,
  });
}

export function useCreateStocktaking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateStocktakingPayload) =>
      stocktakingApi.create(payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: stocktakingKeys.all });
    },
  });
}

export function useUpdateStocktakingItems(taskId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: UpdateItemsPayload) =>
      stocktakingApi.updateItems(taskId, payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: stocktakingKeys.items(taskId) });
    },
  });
}

export function useConfirmStocktaking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (taskId: number) => stocktakingApi.confirm(taskId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: stocktakingKeys.all });
    },
  });
}
