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

// ── Query Keys ───────────────────────────────
export const analyticsKeys = {
  all: ['analytics'] as const,
  dashboardKpi: () => [...analyticsKeys.all, 'dashboard-kpi'] as const,
};

// ── 原始请求函数 ─────────────────────────────
export const analyticsApi = {
  getDashboardKpi: () =>
    request.get<DashboardKpi>('/analytics/dashboard-kpi'),
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
