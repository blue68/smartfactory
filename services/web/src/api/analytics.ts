/**
 * [artifact:接口联调代码] — 分析报表模块 API
 */

import { useQuery } from '@tanstack/react-query';
import request from '@/utils/request';

// ── 类型定义 ─────────────────────────────────

export interface DashboardKpi {
  monthlyRevenue: string;
  inventoryValue: string;
  inProgressOrders: number;
  pendingApproval: number;
  belowSafetyCount: number;
  capacityLoadRate: string;
}

export interface InventoryAnalysis {
  categoryBreakdown: Array<{
    category: string;
    skuCount: number;
    totalQty: string;
    pct: string;
  }>;
  trendLast30: Array<{
    date: string;
    totalQty: string;
  }>;
}

export interface ProductionEfficiency {
  avgCompletionRate: string;
  avgCycleTime: string;
  workerEfficiency: Array<{
    workerName: string;
    completedTasks: number;
    avgRate: string;
  }>;
}

export interface PurchaseCostAnalysis {
  monthlyTrend: Array<{
    month: string;
    totalAmount: string;
    orderCount: number;
  }>;
  topSuppliers: Array<{
    supplierName: string;
    totalAmount: string;
    orderCount: number;
  }>;
}

export interface MaterialCategoryRatio {
  categories: Array<{
    categoryName: string;
    skuCount: number;
    totalCost: string;
    percentage: string;
  }>;
  totalMaterialCost: string;
}

export interface PurchaseCategoryDistribution {
  categories: Array<{
    categoryName: string;
    orderCount: number;
    totalAmount: string;
    percentage: string;
  }>;
  totalPurchaseAmount: string;
  period: {
    days: number;
    from: string;
    to: string;
  };
}

export interface InventoryOperationReport {
  summary: {
    totalInventoryValue: string;
    avgTurnoverDays: string;
    highRiskSkuCount: number;
    healthScore: string;
  };
  quadrantThresholds: {
    inventoryValue: string;
    turnoverDays: string;
  };
  structureHealth: {
    score: string;
    healthyAmountPct: string;
    warningAmountPct: string;
    dangerousAmountPct: string;
    highValueRiskPct: string;
  };
  riskDistribution: Array<{
    riskLevel: 'high' | 'medium' | 'low' | 'healthy';
    count: number;
    pct: string;
  }>;
  quadrantAmountSummary: Array<{
    quadrant: 'core' | 'capital_risk' | 'stagnant_tail' | 'light_fast';
    label: string;
    inventoryValue: string;
    pct: string;
    skuCount: number;
  }>;
  categoryValueBreakdown: Array<{
    categoryName: string;
    inventoryValue: string;
    pct: string;
    skuCount: number;
  }>;
  categoryTurnover: Array<{
    categoryName: string;
    turnoverDays: string;
    skuCount: number;
  }>;
  quadrantBubble: Array<{
    skuId: number;
    skuCode: string;
    skuName: string;
    inventoryValue: string;
    turnoverDays: string;
    qtyOnHand: string;
    bubbleSize: number;
    quadrant: 'core' | 'capital_risk' | 'stagnant_tail' | 'light_fast';
    abcClass: 'A' | 'B' | 'C';
    riskIndex: number;
    riskLevel: 'high' | 'medium' | 'low' | 'healthy';
  }>;
  riskLeaderboard: Array<{
    skuId: number;
    skuCode: string;
    skuName: string;
    categoryName: string;
    qtyOnHand: string;
    inventoryValue: string;
    outboundPeriodQty: string;
    turnoverDays: string;
    quadrant: 'core' | 'capital_risk' | 'stagnant_tail' | 'light_fast';
    abcClass: 'A' | 'B' | 'C';
    riskIndex: number;
    riskLevel: 'high' | 'medium' | 'low' | 'healthy';
  }>;
  stagnantSkuTop50: Array<{
    skuId: number;
    skuCode: string;
    skuName: string;
    categoryName: string;
    qtyOnHand: string;
    inventoryValue: string;
    outboundPeriodQty: string;
    turnoverDays: string;
    quadrant: 'core' | 'capital_risk' | 'stagnant_tail' | 'light_fast';
    abcClass: 'A' | 'B' | 'C';
    riskIndex: number;
    riskLevel: 'high' | 'medium' | 'low' | 'healthy';
  }>;
}

// ── Query Keys ───────────────────────────────

export const analyticsKeys = {
  all: ['analytics'] as const,
  dashboardKpi: () => [...analyticsKeys.all, 'dashboard-kpi'] as const,
  inventoryAnalysis: () => [...analyticsKeys.all, 'inventory-analysis'] as const,
  productionEfficiency: () => [...analyticsKeys.all, 'production-efficiency'] as const,
  purchaseCostAnalysis: () => [...analyticsKeys.all, 'purchase-cost'] as const,
  materialCategoryRatio: (periodDays?: number) =>
    [...analyticsKeys.all, 'material-category-ratio', periodDays] as const,
  purchaseCategoryDistribution: (periodDays?: number) =>
    [...analyticsKeys.all, 'purchase-category', periodDays] as const,
  inventoryOperation: (periodDays?: number) =>
    [...analyticsKeys.all, 'inventory-operation', periodDays] as const,
};

// ── 原始请求函数 ─────────────────────────────

export const analyticsApi = {
  getDashboardKpi: () =>
    request.get<DashboardKpi>('/api/analytics/dashboard-kpi'),

  getInventoryAnalysis: () =>
    request.get<InventoryAnalysis>('/api/analytics/inventory-analysis'),

  getProductionEfficiency: () =>
    request.get<ProductionEfficiency>('/api/analytics/production-efficiency'),

  getPurchaseCostAnalysis: () =>
    request.get<PurchaseCostAnalysis>('/api/analytics/purchase-cost'),

  getMaterialCategoryRatio: (periodDays?: number) => {
    const params = periodDays !== undefined ? `?period_days=${periodDays}` : '';
    return request.get<MaterialCategoryRatio>(
      `/api/analytics/material-category-ratio${params}`,
    );
  },

  getPurchaseCategoryDistribution: (periodDays?: number) => {
    const params = periodDays !== undefined ? `?periodDays=${periodDays}` : '';
    return request.get<PurchaseCategoryDistribution>(
      `/api/analytics/purchase-category${params}`,
    );
  },

  getInventoryOperationReport: (periodDays?: number) => {
    const params = periodDays !== undefined ? `?periodDays=${periodDays}` : '';
    return request.get<InventoryOperationReport>(
      `/api/analytics/inventory-operation${params}`,
    );
  },
};

// ── React Query Hooks ────────────────────────

/** 老板驾驶舱 KPI（BE-P2-001） */
export function useDashboardKpi() {
  return useQuery({
    queryKey: analyticsKeys.dashboardKpi(),
    queryFn: analyticsApi.getDashboardKpi,
    staleTime: 60_000, // 1分钟缓存
  });
}

/** 库存结构分析（BE-P2-002） */
export function useInventoryAnalysis() {
  return useQuery({
    queryKey: analyticsKeys.inventoryAnalysis(),
    queryFn: analyticsApi.getInventoryAnalysis,
    staleTime: 60_000, // 1分钟缓存
  });
}

/** 生产效率分析（BE-P2-005） */
export function useProductionEfficiency() {
  return useQuery({
    queryKey: analyticsKeys.productionEfficiency(),
    queryFn: analyticsApi.getProductionEfficiency,
    staleTime: 60_000, // 1分钟缓存
  });
}

/** 采购成本分析（BE-P2-006） */
export function usePurchaseCostAnalysis() {
  return useQuery({
    queryKey: analyticsKeys.purchaseCostAnalysis(),
    queryFn: analyticsApi.getPurchaseCostAnalysis,
    staleTime: 60_000, // 1分钟缓存
  });
}

/** 物料品类占比分析（BE-P2-003）
 *
 * @param periodDays 统计周期（天），默认 90，范围 1–365；不传则使用后端默认值
 */
export function useMaterialCategoryRatio(periodDays?: number) {
  return useQuery({
    queryKey: analyticsKeys.materialCategoryRatio(periodDays),
    queryFn: () => analyticsApi.getMaterialCategoryRatio(periodDays),
    staleTime: 60_000, // 1分钟缓存
  });
}

/** 采购品类分布分析（BE-P2-004）
 *
 * @param periodDays 统计周期（天），默认 90，范围 1–730；不传则使用后端默认值
 */
export function usePurchaseCategoryDistribution(periodDays?: number) {
  return useQuery({
    queryKey: analyticsKeys.purchaseCategoryDistribution(periodDays),
    queryFn: () => analyticsApi.getPurchaseCategoryDistribution(periodDays),
    staleTime: 60_000, // 1分钟缓存
  });
}

export function useInventoryOperationReport(periodDays?: number) {
  return useQuery({
    queryKey: analyticsKeys.inventoryOperation(periodDays),
    queryFn: () => analyticsApi.getInventoryOperationReport(periodDays),
    staleTime: 60_000,
  });
}
