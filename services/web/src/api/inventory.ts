/**
 * [artifact:接口联调代码] — 库存模块 API
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import request, { getAccessToken } from '@/utils/request';
import { config } from '@/config';
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

/**
 * 将 InventoryListQuery 序列化为 Record<string, unknown>，
 * 确保 belowSafety boolean 以字符串 'true'/'false' 传递（Axios params 序列化兼容）
 */
function serializeQuery(query: InventoryListQuery): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  if (query.page !== undefined) params.page = query.page;
  if (query.pageSize !== undefined) params.pageSize = query.pageSize;
  if (query.category1Id !== undefined) params.category1Id = query.category1Id;
  if (query.category2Id !== undefined) params.category2Id = query.category2Id;
  if (query.keyword !== undefined && query.keyword !== '') params.keyword = query.keyword;
  if (query.belowSafety !== undefined) params.belowSafety = String(query.belowSafety);
  return params;
}

// ── 原始请求函数 ─────────────────────────────
export const inventoryApi = {
  getList: (query: InventoryListQuery) =>
    request.get<PaginatedData<InventoryItem>>(
      '/api/inventory',
      serializeQuery(query),
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

  /**
   * 导出库存 CSV。
   * 后端 GET /api/inventory/export/csv 直接流式返回文件内容（非 JSON）。
   * 必须使用独立的 axios 实例绕过全局响应拦截器（拦截器会尝试解包 JSON，而 blob 不是 JSON）。
   */
  exportCsv: async (): Promise<void> => {
    const token = getAccessToken();
    const baseURL = config.apiBaseUrl;
    const res = await axios.get(`${baseURL}/api/inventory/export/csv`, {
      responseType: 'blob',
      withCredentials: true,
      timeout: 60_000,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const blob = new Blob([res.data as BlobPart], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    // 从响应头取文件名，fallback 到默认名
    const disposition = res.headers['content-disposition'] as string | undefined;
    const filenameMatch = disposition?.match(/filename=([^;]+)/);
    a.download = filenameMatch ? filenameMatch[1].trim() : 'inventory.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
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
