/**
 * [artifact:接口联调代码] — BOM 模块 API
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import request from '@/utils/request';
import type {
  BomHeader,
  BomDetail,
  MaterialRequirement,
  CreateBomPayload,
} from '@/types/models';

// ── Query Keys ───────────────────────────────
export const bomKeys = {
  all: ['bom'] as const,
  lists: () => [...bomKeys.all, 'list'] as const,
  list: (skuId?: number) => [...bomKeys.lists(), { skuId }] as const,
  detail: (id: number) => [...bomKeys.all, 'detail', id] as const,
  expanded: (id: number) => [...bomKeys.all, 'expanded', id] as const,
  requirements: (id: number, qty: number) => [...bomKeys.all, 'requirements', id, qty] as const,
  aiSuggestion: (skuId: number) => [...bomKeys.all, 'ai-suggestion', skuId] as const,
  costBreakdown: (id: number) => [...bomKeys.all, 'cost-breakdown', id] as const,
};

// ── 品类成本占比响应类型 ─────────────────────
export interface CostSegment {
  categoryName: string;
  totalCost: string;
  percentage: number;
}

export interface CostBreakdownResult {
  bomTotal: string;
  segments: CostSegment[];
  missingPriceCount: number;
}

// ── AI BOM 建议响应类型 ───────────────────────
export interface AiSuggestionItem {
  skuId: number;
  skuName: string;
  quantity: string;
  unit: string;
  /** 0–100 的置信度数值 */
  confidence: number;
  reason: string;
}

export interface AiBomSuggestion {
  suggestedItems: AiSuggestionItem[];
}

// ── 原始请求函数 ─────────────────────────────
export const bomApi = {
  getList: (skuId?: number) =>
    request.get<BomHeader[]>('/api/bom', skuId ? { skuId } : undefined),

  getExpanded: (id: number) =>
    request.get<BomDetail>(`/api/bom/${id}/expand`),

  getMaterialRequirements: (id: number, productionQty: number) =>
    request.get<MaterialRequirement[]>(
      `/api/bom/${id}/material-requirements`,
      { productionQty },
    ),

  create: (payload: CreateBomPayload) =>
    request.post<{ id: number }>('/api/bom', payload),

  activate: (id: number) =>
    request.post<null>(`/api/bom/${id}/activate`),

  /** PUT /api/bom/:id — 更新 BOM 头信息（版本号、描述等） */
  update: (id: number, data: Partial<CreateBomPayload>) =>
    request.put<null>(`/api/bom/${id}`, data),

  /** DELETE /api/bom/:bomId/items/:itemId — 删除 BOM 子项 */
  deleteItem: (bomId: number, itemId: number) =>
    request.delete<null>(`/api/bom/${bomId}/items/${itemId}`),

  /** POST /api/bom/:id/copy — 复制 BOM 为新草稿 */
  copy: (id: number, newVersion: string) =>
    request.post<{ id: number }>(`/api/bom/${id}/copy`, { newVersion }),

  /** BE-P1-002: 根据 skuId 获取 AI 辅助 BOM 建议（同品类 BOM 频次统计） */
  getAiSuggestion: (skuId: number) =>
    request.get<AiBomSuggestion>(`/api/bom/ai-suggestion/${skuId}`),

  /** 向已有 BOM 追加一条子项 */
  addItem: (bomId: number, item: { componentSkuId: number; quantity: string; unit: string; scrapRate?: string }) =>
    request.post<{ bomItemId: number }>(`/api/bom/${bomId}/items`, item),

  /** PATCH /api/bom/:bomId/items/:itemId — 修改 BOM 子项用量 */
  updateItem: (bomId: number, itemId: number, data: { quantity?: string; unit?: string; scrapRate?: string }) =>
    request.patch<null>(`/api/bom/${bomId}/items/${itemId}`, data),

  /** GET /api/bom/:id/cost-breakdown — 品类成本占比 */
  getCostBreakdown: (id: number) =>
    request.get<CostBreakdownResult>(`/api/bom/${id}/cost-breakdown`),
};

// ── React Query Hooks ────────────────────────

/** BOM 列表 */
export function useBomList(skuId?: number) {
  return useQuery({
    queryKey: bomKeys.list(skuId),
    queryFn: () => bomApi.getList(skuId),
  });
}

/** BOM 多层展开详情 */
export function useBomExpanded(id: number | null) {
  return useQuery({
    queryKey: bomKeys.expanded(id!),
    queryFn: () => bomApi.getExpanded(id!),
    enabled: id !== null && id > 0,
  });
}

/** 物料需求计算 */
export function useMaterialRequirements(bomId: number | null, productionQty: number) {
  return useQuery({
    queryKey: bomKeys.requirements(bomId!, productionQty),
    queryFn: () => bomApi.getMaterialRequirements(bomId!, productionQty),
    enabled: bomId !== null && bomId > 0 && productionQty > 0,
  });
}

/** 创建 BOM */
export function useCreateBom() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: bomApi.create,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: bomKeys.lists() });
    },
  });
}

/** 激活 BOM */
export function useActivateBom() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: bomApi.activate,
    onSuccess: (_data, id) => {
      void qc.invalidateQueries({ queryKey: bomKeys.lists() });
      void qc.invalidateQueries({ queryKey: bomKeys.expanded(id) });
    },
  });
}

/** 向已有 BOM 追加子项 */
export function useAddBomItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ bomId, item }: { bomId: number; item: { componentSkuId: number; quantity: string; unit: string; scrapRate?: string } }) =>
      bomApi.addItem(bomId, item),
    onSuccess: (_data, { bomId }) => {
      void qc.invalidateQueries({ queryKey: bomKeys.expanded(bomId) });
      void qc.invalidateQueries({ queryKey: bomKeys.lists() });
      void qc.invalidateQueries({ queryKey: bomKeys.costBreakdown(bomId) });
    },
  });
}

/** 更新 BOM 头信息 */
export function useUpdateBom() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<CreateBomPayload> }) =>
      bomApi.update(id, data),
    onSuccess: (_data, { id }) => {
      void qc.invalidateQueries({ queryKey: bomKeys.lists() });
      void qc.invalidateQueries({ queryKey: bomKeys.expanded(id) });
    },
  });
}

/** 删除 BOM 子项 */
export function useDeleteBomItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ bomId, itemId }: { bomId: number; itemId: number }) =>
      bomApi.deleteItem(bomId, itemId),
    onSuccess: (_data, { bomId }) => {
      void qc.invalidateQueries({ queryKey: bomKeys.expanded(bomId) });
      void qc.invalidateQueries({ queryKey: bomKeys.lists() });
      void qc.invalidateQueries({ queryKey: bomKeys.costBreakdown(bomId) });
    },
  });
}

/** 复制 BOM 为新草稿 */
export function useCopyBom() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, newVersion }: { id: number; newVersion: string }) =>
      bomApi.copy(id, newVersion),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: bomKeys.lists() });
    },
  });
}

/** AI 辅助 BOM 建议（BE-P1-002）：同品类 BOM 频次统计 */
export function useAiBomSuggestion(skuId: number | null) {
  return useQuery({
    queryKey: bomKeys.aiSuggestion(skuId!),
    queryFn: () => bomApi.getAiSuggestion(skuId!),
    enabled: skuId !== null && skuId > 0,
    // AI 建议数据不需要高频刷新，5 分钟 stale
    staleTime: 5 * 60 * 1000,
  });
}

/** 修改 BOM 子项用量 */
export function useUpdateBomItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ bomId, itemId, data }: { bomId: number; itemId: number; data: { quantity?: string; unit?: string; scrapRate?: string } }) =>
      bomApi.updateItem(bomId, itemId, data),
    onSuccess: (_data, { bomId }) => {
      void qc.invalidateQueries({ queryKey: bomKeys.expanded(bomId) });
      void qc.invalidateQueries({ queryKey: bomKeys.detail(bomId) });
      void qc.invalidateQueries({ queryKey: bomKeys.lists() });
      void qc.invalidateQueries({ queryKey: bomKeys.costBreakdown(bomId) });
    },
  });
}

/** 品类成本占比 */
export function useCostBreakdown(bomId: number | null) {
  return useQuery({
    queryKey: bomKeys.costBreakdown(bomId!),
    queryFn: () => bomApi.getCostBreakdown(bomId!),
    enabled: bomId !== null && bomId > 0,
    staleTime: 2 * 60 * 1000,
  });
}
