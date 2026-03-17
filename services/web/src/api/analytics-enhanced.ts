/**
 * [artifact:接口联调代码] — 数据分析增强封装
 *
 * 重导出 analytics.ts 中所有 hooks，并提供 mock fallback 数据工具函数。
 * AnalyticsPage 通过此模块统一引入，不直接依赖 analytics.ts。
 */

export {
  useDashboardKpi,
  useInventoryAnalysis,
  useProductionEfficiency,
  usePurchaseCostAnalysis,
  useMaterialCategoryRatio,
  usePurchaseCategoryDistribution,
  type DashboardKpi,
  type InventoryAnalysis,
  type ProductionEfficiency,
  type PurchaseCostAnalysis,
  type MaterialCategoryRatio,
  type PurchaseCategoryDistribution,
} from '@/api/analytics';

// ── Mock fallback helpers ────────────────────────────────────────────

/** 库存结构 mock（API 返回空时兜底） */
export const MOCK_INVENTORY_ANALYSIS = {
  categoryBreakdown: [
    { category: '木材', skuCount: 12, totalQty: '860', pct: '42' },
    { category: '五金', skuCount: 8,  totalQty: '3200', pct: '28' },
    { category: '面料', skuCount: 5,  totalQty: '420', pct: '18' },
    { category: '油漆辅料', skuCount: 4, totalQty: '160', pct: '12' },
  ],
  trendLast30: [] as Array<{ date: string; totalQty: string }>,
};

/** 生产效率 mock */
export const MOCK_PRODUCTION_EFFICIENCY = {
  avgCompletionRate: '78.5',
  avgCycleTime: '4.2',
  workerEfficiency: [
    { workerName: '张师傅', completedTasks: 24, avgRate: '92.3' },
    { workerName: '李学徒', completedTasks: 11, avgRate: '74.1' },
    { workerName: '王师傅', completedTasks: 19, avgRate: '88.6' },
  ],
};

/** 采购成本 mock */
export const MOCK_PURCHASE_COST = {
  monthlyTrend: [
    { month: '2025-10', totalAmount: '28400', orderCount: 6 },
    { month: '2025-11', totalAmount: '31200', orderCount: 8 },
    { month: '2025-12', totalAmount: '26800', orderCount: 5 },
    { month: '2026-01', totalAmount: '34100', orderCount: 9 },
    { month: '2026-02', totalAmount: '29600', orderCount: 7 },
    { month: '2026-03', totalAmount: '18900', orderCount: 4 },
  ],
  topSuppliers: [
    { supplierName: '华森木业', totalAmount: '62400', orderCount: 14 },
    { supplierName: '明辉五金', totalAmount: '28700', orderCount: 22 },
    { supplierName: '顺德面料', totalAmount: '18500', orderCount: 8 },
  ],
};

/** 物料占比 mock */
export const MOCK_MATERIAL_CATEGORY = {
  categories: [
    { categoryName: '木材',   skuCount: 12, totalCost: '62400',  percentage: '42' },
    { categoryName: '五金',   skuCount: 8,  totalCost: '28700',  percentage: '19' },
    { categoryName: '面料',   skuCount: 5,  totalCost: '38500',  percentage: '26' },
    { categoryName: '油漆辅料', skuCount: 4, totalCost: '19400', percentage: '13' },
  ],
  totalMaterialCost: '149000',
};
