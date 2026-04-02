/**
 * [artifact:接口联调代码] — MRP 物料需求计划模块 API (Sprint 3)
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import request from '@/utils/request';
import { useAppStore } from '@/stores/appStore';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ShortageItem {
  skuId: number;
  skuCode: string;
  skuName: string;
  unit?: string;
  stockUnit?: string;
  purchaseUnit?: string;
  requiredQty: string;
  availableQty: string;
  shortageQty: string;
  qtyRequired?: string;
  qtyAvailable?: string;
  qtyInTransit?: string;
  qtyShortage?: string;
  neededByDate: string;
  productionOrderId: number;
  productionOrderNo?: string;
  hasPendingSuggestion?: boolean;
  [key: string]: unknown;
}

export interface ShortageReport {
  productionOrderId: number;
  productionOrderNo: string;
  workOrderNo?: string;
  materialStatus?: 'unchecked' | 'shortage' | 'partial' | 'ready' | string;
  items: ShortageItem[];
  generatedAt: string;
  [key: string]: unknown;
}

export interface ShortageSummaryItem {
  skuId: number;
  skuCode: string;
  skuName: string;
  stockUnit: string;
  totalQtyRequired: string;
  totalQtyAvailable: string;
  totalQtyInTransit: string;
  totalQtyShortage: string;
  affectedOrderCount: number;
  affectedOrderIds: number[];
  [key: string]: unknown;
}

export interface ShortageSummary {
  list: ShortageSummaryItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  [key: string]: unknown;
}

export interface PurchaseSuggestionGenerated {
  id: number;
  skuId: number;
  skuCode: string;
  skuName: string;
  suggestedQty: string;
  unit: string;
  suggestedSupplierId: number | null;
  supplierName: string | null;
  estimatedPrice: string | null;
  estimatedAmount: string | null;
  reason: string;
  neededByDate: string;
  [key: string]: unknown;
}

export interface GenerateSuggestionsPayload {
  /** 对应后端 productionOrderId（单个工单 ID，可选） */
  productionOrderId?: number;
  forceRegenerate?: boolean;
}

/** 后端 generateSuggestions 实际返回结构 */
export interface GenerateSuggestionsResult {
  created: number;
  updated: number;
  skipped: number;
  suggestionIds: number[];
}

export interface ReevaluatePayload {
  receiptId: number;
  skuIds?: number[];
}

export interface SupplyChainDashboard {
  shortageSkuCount?: number;
  pendingSuggestionCount?: number;
  inProgressPoCount?: number;
  overduePoCount?: number;
  pendingReceiptPOCount?: number;
  shortageOrderCount?: number;
  weeklyReceivedBatchCount?: number;
  weeklyPendingSuggestionCount?: number;
  recentReceipts: Array<{
    id: number;
    receiptNo: string;
    receivedAt: string;
    itemCount: number;
  }>;
  [key: string]: unknown;
}

// ── Query Keys ─────────────────────────────────────────────────────────────────

export const mrpKeys = {
  all: ['mrp'] as const,
  shortageReport: (productionOrderId: number) =>
    [...mrpKeys.all, 'shortage-report', productionOrderId] as const,
  shortageSummary: () => [...mrpKeys.all, 'shortage-summary'] as const,
  dashboard: () => [...mrpKeys.all, 'dashboard'] as const,
};

// ── API Functions ──────────────────────────────────────────────────────────────

export const mrpApi = {
  getShortageReport: (productionOrderId: number) =>
    request.get<ShortageReport>(
      `/api/mrp/shortage-report/${productionOrderId}`,
    ),

  getShortageSummary: () =>
    request.get<ShortageSummary>('/api/mrp/shortage-summary'),

  generateSuggestions: (data?: GenerateSuggestionsPayload) =>
    request.post<GenerateSuggestionsResult>(
      '/api/mrp/generate-suggestions',
      data ?? {},
    ),

  reevaluate: (data: ReevaluatePayload) =>
    request.post<{ affectedSuggestions: number }>('/api/mrp/reevaluate', data),

  getDashboard: () =>
    request.get<SupplyChainDashboard>('/api/mrp/supply-chain-dashboard'),
};

// ── React Query Hooks ──────────────────────────────────────────────────────────

/** 获取单个生产订单的缺料报告 */
export function useShortageReport(productionOrderId: number | null) {
  return useQuery({
    queryKey: mrpKeys.shortageReport(productionOrderId!),
    queryFn: () => mrpApi.getShortageReport(productionOrderId!),
    enabled: productionOrderId !== null && productionOrderId > 0,
  });
}

/** 获取全局缺料汇总 */
export function useShortageSummary() {
  return useQuery({
    queryKey: mrpKeys.shortageSummary(),
    queryFn: () => mrpApi.getShortageSummary(),
  });
}

/** 生成采购建议 */
export function useGenerateMrpSuggestions() {
  const qc = useQueryClient();
  const { showToast } = useAppStore();
  return useMutation({
    mutationFn: (data?: GenerateSuggestionsPayload) =>
      mrpApi.generateSuggestions(data),
    onSuccess: (result) => {
      void qc.invalidateQueries({ queryKey: mrpKeys.all });
      void qc.invalidateQueries({ queryKey: ['purchase-suggestions'] });
      const { created, updated } = result;
      if (created === 0 && updated === 0) {
        showToast({ type: 'info', message: '暂无新的缺料，无需生成采购建议' });
      } else {
        const parts: string[] = [];
        if (created > 0) parts.push(`新增 ${created} 条`);
        if (updated > 0) parts.push(`更新 ${updated} 条`);
        showToast({ type: 'success', message: `采购建议已生成：${parts.join('、')}` });
      }
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : '生成采购建议失败，请重试';
      showToast({ type: 'error', message: msg });
    },
  });
}

/** 入库后重评缺料 */
export function useReevaluateMrp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: ReevaluatePayload) => mrpApi.reevaluate(data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: mrpKeys.all });
    },
  });
}

/** 供应链看板数据 */
export function useSupplyChainDashboard() {
  return useQuery({
    queryKey: mrpKeys.dashboard(),
    queryFn: () => mrpApi.getDashboard(),
    // 每 5 分钟自动刷新
    refetchInterval: 5 * 60 * 1000,
  });
}
