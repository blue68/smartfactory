import { Request, Response } from 'express';
import { AnalyticsService } from './analytics.service';
import { success } from '../../shared/ApiResponse';

/**
 * AnalyticsController — 分析报表接口控制器
 *
 * 每个方法从 req.tenantId 中获取租户上下文，
 * 委托 AnalyticsService 完成数据查询，统一通过 success() 返回。
 */
export class AnalyticsController {
  /** 根据当前请求构建租户隔离的 Service 实例（IMP-004: 统一 TenantContext） */
  private svc(req: Request): AnalyticsService {
    return new AnalyticsService({ tenantId: req.tenantId, userId: req.userId });
  }

  /** GET /api/analytics/dashboard-kpi — 老板驾驶舱 KPI（BE-P2-001） */
  async getDashboardKpi(req: Request, res: Response): Promise<void> {
    const data = await this.svc(req).getDashboardKpi();
    success(res, data);
  }

  /** GET /api/analytics/inventory-analysis — 库存结构分析（BE-P2-002） */
  async getInventoryAnalysis(req: Request, res: Response): Promise<void> {
    const data = await this.svc(req).getInventoryAnalysis();
    success(res, data);
  }

  /** GET /api/analytics/production-efficiency — 生产效率分析（BE-P2-005） */
  async getProductionEfficiency(req: Request, res: Response): Promise<void> {
    const data = await this.svc(req).getProductionEfficiency();
    success(res, data);
  }

  /** GET /api/analytics/purchase-cost — 采购成本分析（BE-P2-006） */
  async getPurchaseCostAnalysis(req: Request, res: Response): Promise<void> {
    const data = await this.svc(req).getPurchaseCostAnalysis();
    success(res, data);
  }

  /**
   * GET /api/analytics/material-category-ratio — 物料品类占比分析（BE-P2-003）
   *
   * Query params:
   *   period_days {number} 统计周期天数，默认 90，范围 1–365
   */
  async getMaterialCategoryRatio(req: Request, res: Response): Promise<void> {
    const raw = Number(req.query['period_days']);
    // 校验范围：1–365；超出范围或缺省时使用默认值 90
    const periodDays =
      Number.isInteger(raw) && raw >= 1 && raw <= 365 ? raw : 90;

    const data = await this.svc(req).getMaterialCategoryRatio(periodDays);
    success(res, data);
  }

  /**
   * GET /api/analytics/purchase-category — 采购品类分布分析（BE-P2-004）
   *
   * Query params:
   *   periodDays  number  统计天数，默认 90，范围 [1, 730]
   */
  async getPurchaseCategoryDistribution(req: Request, res: Response): Promise<void> {
    const raw = Number(req.query['periodDays']);
    const periodDays = Number.isFinite(raw) && raw > 0 ? raw : 90;
    const data = await this.svc(req).getPurchaseCategoryDistribution(periodDays);
    success(res, data);
  }
}

export const analyticsController = new AnalyticsController();
