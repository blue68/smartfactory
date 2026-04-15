/**
 * [artifact:接口联调代码] — 价格管理 API
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import request from '@/utils/request';
import type { PaginatedData } from '@/types/api';

// ─────────────────────────────────────────────
// 类型定义
// ─────────────────────────────────────────────

export interface Price {
  id: number;
  skuId: number;
  skuCode: string;
  skuName: string;
  supplierId: number;
  supplierName: string;
  /** 含税单价（元） */
  unitPrice: string;
  /** 采购单位 */
  purchaseUnit: string;
  /** 最小起订量 */
  moq?: number;
  /** 采购周期（天） */
  purchaseCycleDays?: number;
  /** 运输周期（天） */
  transportCycleDays?: number;
  /** 报价有效期开始 */
  validFrom: string;
  /** 报价有效期截止，null 表示长期有效 */
  validTo: string | null;
  /** 是否为当前有效价格 */
  isActive: boolean;
  /** 备注 */
  notes?: string;
  /** 税率（如 13.00） */
  taxRate?: string;
  /** 是否启用批次定价 */
  batchPricing?: boolean;
  /** 批次条件规则 */
  batchRule?: string;
  /** 协议文件URL */
  attachmentUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PriceListQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  supplierId?: number;
  skuId?: number;
  isActive?: boolean;
}

export interface CreatePricePayload {
  skuId: number;
  supplierId: number;
  unitPrice: string;
  purchaseUnit: string;
  moq?: number;
  purchaseCycleDays?: number;
  transportCycleDays?: number;
  validFrom: string;
  validTo?: string;
  notes?: string;
  taxRate?: string;
  batchPricing?: boolean;
  batchRule?: string;
  attachmentUrl?: string;
}

export type UpdatePricePayload = Partial<CreatePricePayload>;

export interface PriceHistoryItem {
  price: string;
  unit: string;
  supplierName: string;
  effectiveAt: string;
}

// ─────────────────────────────────────────────
// 批量导入相关类型
// ─────────────────────────────────────────────

/** 单条导入错误/警告 */
export interface ImportRowIssue {
  /** Excel 行号（从 2 起，1 为表头） */
  row: number;
  /** 错误列名（可选） */
  column?: string;
  /** 错误描述 */
  message: string;
  /** 导入单价（价格异常检测用，单位：元） */
  importedPrice?: number;
  /** 历史参考价（后端返回，用于前端判断价格偏差，单位：元） */
  historicalPrice?: number;
  /** 原始行数据（用于失败明细下载） */
  rawData?: Record<string, string | number | null>;
}

/** 导入接口返回结果 */
export interface ImportResult {
  successCount: number;
  failCount: number;
  /** 跳过的错误行数量（导入完成后由后端返回） */
  skipCount?: number;
  /** 重复追加行数量（同一 SKU+供应商 已有记录，将追加新版本） */
  duplicateCount?: number;
  errors: ImportRowIssue[];
  warnings: ImportRowIssue[];
  /** 价格异常行（偏差 > 30% 的行，由后端标记，可选） */
  anomalies?: ImportRowIssue[];
  /** 重复追加行（同一 SKU+供应商 已有记录的行，由后端标记） */
  duplicates?: ImportRowIssue[];
  /** 总行数（不含表头） */
  totalCount?: number;
}

/** 异步导入任务进度 */
export interface ImportTaskStatus {
  taskId: number;
  status: 'pending' | 'processing' | 'done' | 'failed';
  progress: number; // 0-100
  successCount?: number;
  failCount?: number;
  errors?: ImportRowIssue[];
  warnings?: ImportRowIssue[];
  message?: string;
}

// ─────────────────────────────────────────────
// Query Keys
// ─────────────────────────────────────────────

export const priceKeys = {
  all: ['prices'] as const,
  lists: () => [...priceKeys.all, 'list'] as const,
  list: (query: PriceListQuery) => [...priceKeys.lists(), query] as const,
  detail: (id: number) => [...priceKeys.all, 'detail', id] as const,
  history: (skuId: number, supplierId?: number) => [...priceKeys.all, 'history', skuId, supplierId] as const,
};

// ─────────────────────────────────────────────
// 原始请求函数
// ─────────────────────────────────────────────

export const priceApi = {
  getList: (query: PriceListQuery) =>
    request.get<PaginatedData<Price>>('/api/prices', query as Record<string, unknown>),

  getById: (id: number) =>
    request.get<Price>(`/api/prices/${id}`),

  create: (payload: CreatePricePayload) =>
    request.post<Price>('/api/prices', payload),

  update: (id: number, payload: UpdatePricePayload) =>
    request.put<Price>(`/api/prices/${id}`, payload),

  getHistory: (skuId: number, supplierId?: number) =>
    request.get<PriceHistoryItem[]>(`/api/prices/history/${skuId}`, supplierId ? { supplierId } as Record<string, unknown> : undefined),

  /**
   * 下载导入模板（返回 Blob，由调用方触发浏览器下载）
   */
  downloadTemplate: async (): Promise<void> => {
    const res = await request.instance.get('/api/prices/import-template', {
      responseType: 'blob',
    });
    const blob: Blob = res.data as Blob;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    // 优先从 Content-Disposition 获取文件名，否则使用默认名
    const disposition: string = (res.headers['content-disposition'] as string) ?? '';
    const match = /filename[^;=\n]*=(?:(['"])(.+?)\1|([^;\n]*))/i.exec(disposition);
    a.download = match?.[2] ?? match?.[3] ?? '采购价格导入模板.xlsx';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  /**
   * 上传 Excel 文件进行批量导入
   * 使用 multipart/form-data，字段名为 file
   */
  importPrices: async (file: File): Promise<ImportResult> => {
    const formData = new FormData();
    formData.append('file', file);
    const res = await request.instance.post('/api/prices/import', formData, {
      headers: { 'Content-Type': undefined as unknown as string },
    });
    // 通过 instance 调用时响应拦截器已做 camelCase 转换
    return res.data.data as ImportResult;
  },

  /**
   * 查询异步导入任务进度（预留）
   */
  getImportStatus: (taskId: number) =>
    request.get<ImportTaskStatus>(`/api/prices/import/${taskId}`),
};

// ─────────────────────────────────────────────
// React Query Hooks
// ─────────────────────────────────────────────

/** 价格分页列表 */
export function usePriceList(query: PriceListQuery) {
  return useQuery({
    queryKey: priceKeys.list(query),
    queryFn: () => priceApi.getList(query),
  });
}

/** 创建价格 */
export function useCreatePrice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: priceApi.create,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: priceKeys.lists() });
    },
  });
}

/** 价格历史 */
export function usePriceHistory(skuId: number | null, supplierId?: number) {
  return useQuery({
    queryKey: priceKeys.history(skuId!, supplierId),
    queryFn: () => priceApi.getHistory(skuId!, supplierId),
    enabled: skuId !== null && skuId > 0,
  });
}

/** 更新价格 */
export function useUpdatePrice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: UpdatePricePayload }) =>
      priceApi.update(id, payload),
    onSuccess: (_data, variables) => {
      void qc.invalidateQueries({ queryKey: priceKeys.lists() });
      void qc.invalidateQueries({ queryKey: priceKeys.detail(variables.id) });
    },
  });
}

/** 上传协议文件（multipart/form-data） */
export async function uploadPriceFile(file: File): Promise<{ id: number; url: string; originalName: string; size: number; path: string; storageDriver: 'local' | 'oss' }> {
  const formData = new FormData();
  formData.append('file', file);
  // Use instance directly — delete Content-Type so browser sets multipart boundary
  const res = await request.instance.post('/api/upload', formData, {
    headers: { 'Content-Type': undefined as unknown as string },
  });
  return res.data.data;
}

/** 批量导入价格结果 */
export interface ImportPriceResult {
  taskId: number;
  totalRows: number;
  successCount: number;
  failCount: number;
  skipCount: number;
  warningCount: number;
  errors: Array<{ row: number; field: string; message: string }>;
  warnings: Array<{ row: number; field: string; message: string }>;
}

/** 批量导入价格（POST /api/prices/import） */
export async function importPrices(file: File, errorStrategy?: string): Promise<ImportPriceResult> {
  const formData = new FormData();
  formData.append('file', file);
  if (errorStrategy) formData.append('errorStrategy', errorStrategy);
  const res = await request.instance.post('/api/prices/import', formData, {
    headers: { 'Content-Type': undefined as unknown as string },
  });
  return res.data.data;
}

/** 下载导入模板 */
export async function downloadImportTemplate(): Promise<void> {
  const res = await request.instance.get('/api/prices/import-template', {
    responseType: 'blob',
  });
  const blob = new Blob([res.data]);
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'price-import-template.xlsx';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
}
