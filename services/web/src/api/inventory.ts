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
  DailyInventorySnapshotItem,
  DailyInventorySnapshotQuery,
  InventorySummary,
  InventoryTransactionTraceQuery,
  InventoryTransactionTraceResult,
  InboundPayload,
  OutboundPayload,
  StockTransactionResult,
  InventoryListQuery,
  WarehouseOption,
  LocationOption,
  WarehouseCsvImportResult,
  LocationCsvImportResult,
} from '@/types/models';
import type { PaginatedData } from '@/types/api';

// ── Query Keys ───────────────────────────────
export const inventoryKeys = {
  all: ['inventory'] as const,
  lists: () => [...inventoryKeys.all, 'list'] as const,
  list: (query: InventoryListQuery) => [...inventoryKeys.lists(), query] as const,
  dailySnapshots: () => [...inventoryKeys.all, 'daily-snapshots'] as const,
  dailySnapshotList: (query: DailyInventorySnapshotQuery) =>
    [...inventoryKeys.dailySnapshots(), query] as const,
  summary: () => [...inventoryKeys.all, 'summary'] as const,
  transactions: (skuId: number, query: InventoryTransactionTraceQuery) =>
    [...inventoryKeys.all, 'transactions', skuId, query] as const,
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
  if (query.warehouseId !== undefined) params.warehouseId = query.warehouseId;
  if (query.locationId !== undefined) params.locationId = query.locationId;
  if (query.onlyDefaultLocation !== undefined) params.onlyDefaultLocation = String(query.onlyDefaultLocation);
  return params;
}

function serializeDailySnapshotQuery(query: DailyInventorySnapshotQuery): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  if (query.snapshotDate) params.snapshotDate = query.snapshotDate;
  if (query.skuId !== undefined) params.skuId = query.skuId;
  if (query.warehouseId !== undefined) params.warehouseId = query.warehouseId;
  if (query.keyword !== undefined && query.keyword !== '') params.keyword = query.keyword;
  if (query.page !== undefined) params.page = query.page;
  if (query.pageSize !== undefined) params.pageSize = query.pageSize;
  return params;
}

function serializeTransactionQuery(query: InventoryTransactionTraceQuery): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  if (query.page !== undefined) params.page = query.page;
  if (query.pageSize !== undefined) params.pageSize = query.pageSize;
  if (query.dateFrom) params.dateFrom = query.dateFrom;
  if (query.dateTo) params.dateTo = query.dateTo;
  if (query.warehouseId !== undefined) params.warehouseId = query.warehouseId;
  if (query.locationId !== undefined) params.locationId = query.locationId;
  if (query.keyword !== undefined && query.keyword !== '') params.keyword = query.keyword;
  return params;
}

// ── 原始请求函数 ─────────────────────────────
export const inventoryApi = {
  getList: (query: InventoryListQuery) =>
    request.get<PaginatedData<InventoryItem>>(
      '/api/inventory',
      serializeQuery(query),
    ),

  getDailySnapshots: (query: DailyInventorySnapshotQuery) =>
    request.get<PaginatedData<DailyInventorySnapshotItem> & { snapshotDate: string }>(
      '/api/inventory/daily-snapshots',
      serializeDailySnapshotQuery(query),
    ),

  getSummary: () =>
    request.get<InventorySummary>('/api/inventory/summary'),

  getWarehouses: (onlyActive = true) =>
    request.get<WarehouseOption[]>('/api/inventory/warehouses', { onlyActive: String(onlyActive) }),

  getLocations: (warehouseId?: number, onlyActive = true) =>
    request.get<LocationOption[]>('/api/inventory/locations', {
      warehouseId,
      onlyActive: String(onlyActive),
    }),

  createWarehouse: (payload: { code: string; name: string; type?: string; status?: string; plantCode?: string }) =>
    request.post<WarehouseOption>('/api/inventory/warehouses', payload),

  updateWarehouse: (
    id: number,
    payload: { code?: string; name?: string; type?: string; status?: string; plantCode?: string },
  ) => request.put<WarehouseOption>(`/api/inventory/warehouses/${id}`, payload),

  deleteWarehouse: (id: number) =>
    request.delete<{ id: number }>(`/api/inventory/warehouses/${id}`),

  createLocation: (
    payload: {
      warehouseId: number;
      code: string;
      name: string;
      locationType?: 'general' | 'zone' | 'rack' | 'shelf' | 'bin';
      aisleCode?: string;
      rackCode?: string;
      shelfCode?: string;
      binCode?: string;
      level?: number;
      parentId?: number;
      status?: string;
    },
  ) => request.post<LocationOption>('/api/inventory/locations', payload),

  updateLocation: (
    id: number,
    payload: {
      warehouseId?: number;
      code?: string;
      name?: string;
      locationType?: 'general' | 'zone' | 'rack' | 'shelf' | 'bin';
      aisleCode?: string;
      rackCode?: string;
      shelfCode?: string;
      binCode?: string;
      level?: number;
      parentId?: number | null;
      status?: string;
    },
  ) => request.put<LocationOption>(`/api/inventory/locations/${id}`, payload),

  deleteLocation: (id: number) =>
    request.delete<{ id: number }>(`/api/inventory/locations/${id}`),

  importWarehousesCsv: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request.post<WarehouseCsvImportResult>(
      '/api/inventory/warehouses/import-csv',
      form,
      { headers: { 'Content-Type': undefined as unknown as string } },
    );
  },

  importLocationsCsv: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request.post<LocationCsvImportResult>(
      '/api/inventory/locations/import-csv',
      form,
      { headers: { 'Content-Type': undefined as unknown as string } },
    );
  },

  downloadWarehouseImportTemplateCsv: async (): Promise<void> => {
    const token = getAccessToken();
    const baseURL = config.apiBaseUrl;
    const res = await axios.get(`${baseURL}/api/inventory/warehouses/import-template/csv`, {
      responseType: 'blob',
      withCredentials: true,
      timeout: 30_000,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const blob = new Blob([res.data as BlobPart], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'warehouse-import-template.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  downloadLocationImportTemplateCsv: async (): Promise<void> => {
    const token = getAccessToken();
    const baseURL = config.apiBaseUrl;
    const res = await axios.get(`${baseURL}/api/inventory/locations/import-template/csv`, {
      responseType: 'blob',
      withCredentials: true,
      timeout: 30_000,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const blob = new Blob([res.data as BlobPart], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'location-import-template.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  getTransactions: (skuId: number, query: InventoryTransactionTraceQuery) =>
    request.get<InventoryTransactionTraceResult>(
      `/api/inventory/${skuId}/transactions`,
      serializeTransactionQuery(query),
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

export function useInventoryDailySnapshots(query: DailyInventorySnapshotQuery, enabled = true) {
  return useQuery({
    queryKey: inventoryKeys.dailySnapshotList(query),
    queryFn: () => inventoryApi.getDailySnapshots(query),
    enabled,
    placeholderData: (prev) => prev,
  });
}

export function useInventorySummary(enabled = true) {
  return useQuery({
    queryKey: inventoryKeys.summary(),
    queryFn: () => inventoryApi.getSummary(),
    enabled,
    staleTime: 60_000,
  });
}

export function useWarehouseOptions(onlyActive = true, enabled = true) {
  return useQuery({
    queryKey: [...inventoryKeys.all, 'warehouses', onlyActive] as const,
    queryFn: () => inventoryApi.getWarehouses(onlyActive),
    enabled,
    staleTime: 60_000,
  });
}

export function useLocationOptions(warehouseId?: number, onlyActive = true, enabled = true) {
  return useQuery({
    queryKey: [...inventoryKeys.all, 'locations', warehouseId ?? 0, onlyActive] as const,
    queryFn: () => inventoryApi.getLocations(warehouseId, onlyActive),
    enabled,
    staleTime: 60_000,
  });
}

export function useImportWarehousesCsv() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => inventoryApi.importWarehousesCsv(file),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: inventoryKeys.all });
    },
  });
}

export function useImportLocationsCsv() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => inventoryApi.importLocationsCsv(file),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: inventoryKeys.all });
    },
  });
}

export function useCreateWarehouse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { code: string; name: string; type?: string; status?: string; plantCode?: string }) =>
      inventoryApi.createWarehouse(payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: inventoryKeys.all });
    },
  });
}

export function useUpdateWarehouse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: number;
      payload: { code?: string; name?: string; type?: string; status?: string; plantCode?: string };
    }) => inventoryApi.updateWarehouse(id, payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: inventoryKeys.all });
    },
  });
}

export function useDeleteWarehouse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => inventoryApi.deleteWarehouse(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: inventoryKeys.all });
    },
  });
}

export function useCreateLocation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      warehouseId: number;
      code: string;
      name: string;
      locationType?: 'general' | 'zone' | 'rack' | 'shelf' | 'bin';
      aisleCode?: string;
      rackCode?: string;
      shelfCode?: string;
      binCode?: string;
      level?: number;
      parentId?: number;
      status?: string;
    }) =>
      inventoryApi.createLocation(payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: inventoryKeys.all });
    },
  });
}

export function useUpdateLocation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: number;
      payload: {
        warehouseId?: number;
        code?: string;
        name?: string;
        locationType?: 'general' | 'zone' | 'rack' | 'shelf' | 'bin';
        aisleCode?: string;
        rackCode?: string;
        shelfCode?: string;
        binCode?: string;
        level?: number;
        parentId?: number | null;
        status?: string;
      };
    }) => inventoryApi.updateLocation(id, payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: inventoryKeys.all });
    },
  });
}

export function useDeleteLocation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => inventoryApi.deleteLocation(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: inventoryKeys.all });
    },
  });
}

export function useInventoryTransactions(skuId: number | null, query: InventoryTransactionTraceQuery, enabled = true) {
  return useQuery({
    queryKey: inventoryKeys.transactions(skuId!, query),
    queryFn: () => inventoryApi.getTransactions(skuId!, query),
    enabled: enabled && skuId !== null && skuId > 0,
    placeholderData: (prev) => prev,
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
      void qc.invalidateQueries({ queryKey: inventoryKeys.all });
    },
  });
}

/** 领料出库 */
export function useOutbound() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: inventoryApi.outbound,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: inventoryKeys.all });
    },
  });
}
