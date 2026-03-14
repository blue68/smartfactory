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
