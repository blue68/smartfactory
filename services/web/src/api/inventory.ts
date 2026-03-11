/**
 * [artifact:接口联调代码] — 库存模块 API
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import request from '@/utils/request';
import type {
  InventoryItem,
  SkuAvailability,
  DyeLot,
  InboundPayload,
  OutboundPayload,
  StockTransactionResult,
  InventoryListQuery,
} from '@/types/models';
import type { PaginatedData } from '@/types/api';

// ── Query Keys ───────────────────────────────
export const inventoryKeys = {
  all: ['inventory'] as const,
  lists: () => [...inventoryKeys.all, 'list'] as const,
  list: (query: InventoryListQuery) => [...inventoryKeys.lists(), query] as const,
  available: (skuId: number) => [...inventoryKeys.all, 'available', skuId] as const,
  dyeLots: (skuId: number) => [...inventoryKeys.all, 'dyeLots', skuId] as const,
  fifoDyeLot: (skuId: number, qty: string) =>
    [...inventoryKeys.all, 'fifoDyeLot', skuId, qty] as const,
};

// ── 原始请求函数 ─────────────────────────────
export const inventoryApi = {
  getList: (query: InventoryListQuery) =>
    request.get<PaginatedData<InventoryItem>>(
      '/api/inventory',
      query as Record<string, unknown>,
    ),

  getAvailable: (skuId: number) =>
    request.get<SkuAvailability>(`/api/inventory/${skuId}/available`),

  getDyeLots: (skuId: number) =>
    request.get<DyeLot[]>(`/api/inventory/${skuId}/dye-lots`),

  getFifoDyeLot: (skuId: number, qty: string) =>
    request.get<DyeLot[]>(`/api/inventory/${skuId}/fifo-dye-lot`, { qty }),

  inbound: (payload: InboundPayload) =>
    request.postWithLockRetry<StockTransactionResult>('/api/inventory/inbound', payload),

  outbound: (payload: OutboundPayload) =>
    request.postWithLockRetry<StockTransactionResult>('/api/inventory/outbound', payload),
};

// ── React Query Hooks ────────────────────────

/** 库存总览列表 */
export function useInventoryList(query: InventoryListQuery) {
  return useQuery({
    queryKey: inventoryKeys.list(query),
    queryFn: () => inventoryApi.getList(query),
  });
}

/** 单 SKU 可用库存 */
export function useSkuAvailability(skuId: number | null) {
  return useQuery({
    queryKey: inventoryKeys.available(skuId!),
    queryFn: () => inventoryApi.getAvailable(skuId!),
    enabled: skuId !== null && skuId > 0,
  });
}

/** 缸号批次详情 */
export function useDyeLots(skuId: number | null) {
  return useQuery({
    queryKey: inventoryKeys.dyeLots(skuId!),
    queryFn: () => inventoryApi.getDyeLots(skuId!),
    enabled: skuId !== null && skuId > 0,
  });
}

/** FIFO 缸号推荐 */
export function useFifoDyeLot(skuId: number | null, qty: string) {
  return useQuery({
    queryKey: inventoryKeys.fifoDyeLot(skuId!, qty),
    queryFn: () => inventoryApi.getFifoDyeLot(skuId!, qty),
    enabled: skuId !== null && skuId > 0 && parseFloat(qty) > 0,
  });
}

/** 采购入库 */
export function useInbound() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: inventoryApi.inbound,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: inventoryKeys.lists() });
    },
  });
}

/** 领料出库 */
export function useOutbound() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: inventoryApi.outbound,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: inventoryKeys.lists() });
    },
  });
}
