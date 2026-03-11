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
};

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
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: bomKeys.lists() });
    },
  });
}
