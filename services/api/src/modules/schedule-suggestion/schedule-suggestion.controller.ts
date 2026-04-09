/**
 * BE-S4-13~15: ScheduleSuggestionController — 调度建议 Controller 层
 *
 * 职责：
 *   - 参数校验（Zod）
 *   - 构建 TenantContext（tenantId / userId / roles）
 *   - 调用 ScheduleSuggestionService 对应方法
 *   - 统一 ApiResponse 格式返回
 *
 * 约束：
 *   - 所有方法均通过 asyncHandler 包裹，异常由 errorHandler 统一处理
 *   - 不在 Controller 层编写业务逻辑
 */

import { Request, Response } from 'express';
import { z } from 'zod';
import { ScheduleSuggestionService } from './schedule-suggestion.service';
import { success, created, buildPaginated } from '../../shared/ApiResponse';
import { PaginationSchema } from '../../middleware/validator';

// ─── Zod Schema 定义 ────────────────────────────────────────────────────────

const TriggerCalculationSchema = z.object({
  triggerType: z.enum(['manual']).optional().default('manual'),
});

const GetStatusQuerySchema = z.object({
  jobId: z.string().optional(),
});

const AcceptItemSchema = z.object({
  modifiedQty: z
    .string()
    .regex(/^\d+(\.\d{1,4})?$/, '数量格式不正确，支持最多4位小数')
    .optional(),
});

const RejectItemSchema = z.object({
  reason: z.string().min(1, '驳回原因不能为空').max(500, '驳回原因不超过500字'),
});

// ─── ScheduleSuggestionController ───────────────────────────────────────────

export class ScheduleSuggestionController {
  /**
   * 构建 Service 实例（携带租户上下文与角色信息）
   */
  private svc(req: Request): ScheduleSuggestionService {
    return new ScheduleSuggestionService({
      tenantId: req.tenantId,
      userId: req.userId,
      roles: req.roles ?? [],
      actionCodes: req.permissionSnapshot?.actionCodes ?? [],
    });
  }

  /**
   * BE-S4-13: 触发调度建议计算
   * POST /api/schedule-suggestions/calculate
   * body: { triggerType?: 'manual' }
   */
  async triggerCalculation(req: Request, res: Response): Promise<void> {
    const { triggerType } = TriggerCalculationSchema.parse(req.body);
    const result = await this.svc(req).triggerCalculation(triggerType);
    created(res, result, '调度建议计算已触发，请通过 jobId 查询进度');
  }

  /**
   * BE-S4-13: 查询计算状态
   * GET /api/schedule-suggestions/status?jobId=xxx
   */
  async getStatus(req: Request, res: Response): Promise<void> {
    const { jobId } = GetStatusQuerySchema.parse(req.query);
    const data = await this.svc(req).getStatus(jobId);
    success(res, data);
  }

  /**
   * BE-S4-14: 获取最近一次计算结果（按角色过滤）
   * GET /api/schedule-suggestions/latest
   */
  async getLatest(req: Request, res: Response): Promise<void> {
    const data = await this.svc(req).getLatest();
    success(res, data);
  }

  /**
   * BE-S4-14: 历史批次分页查询
   * GET /api/schedule-suggestions/history?page=1&pageSize=20
   */
  async getHistory(req: Request, res: Response): Promise<void> {
    const { page, pageSize } = PaginationSchema.parse(req.query);
    const { list, total } = await this.svc(req).getHistory(page, pageSize);
    success(res, buildPaginated(list, total, page, pageSize));
  }

  /**
   * BE-S4-14: 历史批次详情（含明细）
   * GET /api/schedule-suggestions/:id
   */
  async getHistoryDetail(req: Request, res: Response): Promise<void> {
    const id = z.coerce.number().int().positive('批次 ID 必须为正整数').parse(req.params.id);
    const data = await this.svc(req).getHistoryDetail(id);
    success(res, data);
  }

  /**
   * BE-S4-15: 接受建议（支持修改数量）
   * POST /api/schedule-suggestions/items/:itemId/accept
   * body: { modifiedQty?: string }
   */
  async acceptItem(req: Request, res: Response): Promise<void> {
    const itemId = z.coerce.number().int().positive('建议明细 ID 必须为正整数').parse(req.params.itemId);
    const { modifiedQty } = AcceptItemSchema.parse(req.body);
    await this.svc(req).acceptItem(itemId, modifiedQty);
    success(res, null, modifiedQty ? '建议已修改并接受' : '建议已接受');
  }

  /**
   * BE-S4-15: 驳回建议
   * POST /api/schedule-suggestions/items/:itemId/reject
   * body: { reason: string }
   */
  async rejectItem(req: Request, res: Response): Promise<void> {
    const itemId = z.coerce.number().int().positive('建议明细 ID 必须为正整数').parse(req.params.itemId);
    const { reason } = RejectItemSchema.parse(req.body);
    await this.svc(req).rejectItem(itemId, reason);
    success(res, null, '建议已驳回');
  }

  /**
   * BE-S4-15: 应用排产建议（写入 production_orders.priority_score）
   * POST /api/schedule-suggestions/items/:itemId/apply
   */
  async applyProduction(req: Request, res: Response): Promise<void> {
    const itemId = z.coerce.number().int().positive('建议明细 ID 必须为正整数').parse(req.params.itemId);
    await this.svc(req).applyProductionSuggestion(itemId);
    success(res, null, '排产建议已应用，优先级评分已更新');
  }

  /**
   * BE-S4-15: 获取采购建议计算步骤
   * GET /api/schedule-suggestions/purchase-steps/:id
   */
  async getPurchaseSteps(req: Request, res: Response): Promise<void> {
    const id = z.coerce.number().int().positive('采购建议明细 ID 必须为正整数').parse(req.params.id);
    const data = await this.svc(req).getPurchaseSteps(id);
    success(res, data);
  }
}

export const scheduleSuggestionController = new ScheduleSuggestionController();
