import { Request, Response } from 'express';
import { z } from 'zod';
import {
  StocktakingService,
  CreateTaskSchema,
  ListTaskSchema,
  BatchItemSchema,
} from './stocktaking.service';
import { success, created } from '../../shared/ApiResponse';
import { AppError } from '../../shared/AppError';

/**
 * StocktakingController — F-105 库存盘点
 *
 * 每个方法委托 StocktakingService 执行业务逻辑，
 * 使用 Zod 做请求参数校验，统一返回 ApiResponse 格式。
 */
export class StocktakingController {
  private svc(req: Request): StocktakingService {
    return new StocktakingService({ tenantId: req.tenantId, userId: req.userId });
  }

  /** POST /api/stocktaking — 创建盘点任务 */
  async createTask(req: Request, res: Response): Promise<void> {
    const parsed = CreateTaskSchema.safeParse(req.body);
    if (!parsed.success) {
      throw AppError.badRequest(parsed.error.issues.map((i) => i.message).join('; '));
    }
    const task = await this.svc(req).createTask(parsed.data);
    created(res, task, '盘点任务创建成功');
  }

  /** GET /api/stocktaking — 盘点任务列表 */
  async listTasks(req: Request, res: Response): Promise<void> {
    const parsed = ListTaskSchema.safeParse(req.query);
    if (!parsed.success) {
      throw AppError.badRequest(parsed.error.issues.map((i) => i.message).join('; '));
    }
    const data = await this.svc(req).listTasks(parsed.data);
    success(res, data);
  }

  /** GET /api/stocktaking/:id — 盘点任务详情（含明细） */
  async getTask(req: Request, res: Response): Promise<void> {
    const id = Number(req.params['id']);
    if (!Number.isInteger(id) || id <= 0) {
      throw AppError.badRequest('无效的任务 ID');
    }
    const data = await this.svc(req).getTaskWithItems(id);
    success(res, data);
  }

  /** POST /api/stocktaking/:id/export — 导出盘点表（Excel） */
  async exportTask(req: Request, res: Response): Promise<void> {
    const id = Number(req.params['id']);
    if (!Number.isInteger(id) || id <= 0) {
      throw AppError.badRequest('无效的任务 ID');
    }
    const buf = await this.svc(req).exportTaskExcel(id);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="stocktaking_${id}.xlsx"`);
    res.send(buf);
  }

  /** PUT /api/stocktaking/:id/items — 批量录入盘点结果 */
  async updateItems(req: Request, res: Response): Promise<void> {
    const id = Number(req.params['id']);
    if (!Number.isInteger(id) || id <= 0) {
      throw AppError.badRequest('无效的任务 ID');
    }

    const parsed = BatchItemSchema.safeParse(req.body);
    if (!parsed.success) {
      throw AppError.badRequest(parsed.error.issues.map((i) => i.message).join('; '));
    }

    const data = await this.svc(req).batchUpdateItems(id, parsed.data);
    success(res, data, '盘点结果录入成功');
  }

  /** GET /api/stocktaking/:id/diff — 差异分析报告 */
  async getDiff(req: Request, res: Response): Promise<void> {
    const id = Number(req.params['id']);
    if (!Number.isInteger(id) || id <= 0) {
      throw AppError.badRequest('无效的任务 ID');
    }
    const data = await this.svc(req).getDiffReport(id);
    success(res, data);
  }

  /** POST /api/stocktaking/:id/confirm — 确认盘点（仅 boss） */
  async confirmTask(req: Request, res: Response): Promise<void> {
    const id = Number(req.params['id']);
    if (!Number.isInteger(id) || id <= 0) {
      throw AppError.badRequest('无效的任务 ID');
    }
    const data = await this.svc(req).confirmTask(id);
    success(res, data, '盘点确认成功，库存已调整');
  }
}

export const stocktakingController = new StocktakingController();
