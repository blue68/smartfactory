import { Request, Response } from 'express';
import { z } from 'zod';
import { ProductionService } from './production.service';
import { success, created, buildPaginated } from '../../shared/ApiResponse';
import { PaginationSchema } from '../../middleware/validator';

const CreateProductionOrderSchema = z.object({
  salesOrderId: z.number().int().positive(),
  salesOrderItemId: z.number().int().positive(),
  skuId: z.number().int().positive(),
  bomHeaderId: z.number().int().positive(),
  processTemplateId: z.number().int().positive(),
  qtyPlanned: z.string().regex(/^\d+(\.\d{1,4})?$/),
  priority: z.number().int().min(1).max(100).optional(),
  plannedStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  plannedEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notes: z.string().max(500).optional(),
});

const CompleteTaskSchema = z.object({
  completedQty: z.string().regex(/^\d+(\.\d{1,4})?$/),
  scrapQty: z.string().regex(/^\d+(\.\d{1,4})?$/).optional(),
  scrapReason: z.enum(['material_defect', 'operation_error', 'other']).optional(),
  componentBarcode: z.string().max(100).optional(),
  notes: z.string().max(500).optional(),
  images: z.array(z.string().url()).max(3).optional(),
});

export class ProductionController {
  private svc(req: Request) {
    return new ProductionService({ tenantId: req.tenantId, userId: req.userId });
  }

  async listOrders(req: Request, res: Response): Promise<void> {
    const q = PaginationSchema.extend({
      status: z.string().optional(),
      salesOrderId: z.coerce.number().int().positive().optional(),
    }).parse(req.query);
    const { list, total } = await this.svc(req).listProductionOrders(q);
    success(res, buildPaginated(list, total, q.page, q.pageSize));
  }

  async getOrder(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    const data = await this.svc(req).getProductionOrderDetail(id);
    success(res, data);
  }

  async createOrder(req: Request, res: Response): Promise<void> {
    const body = CreateProductionOrderSchema.parse(req.body);
    const data = await this.svc(req).createProductionOrder(body);
    created(res, data, '生产工单已创建');
  }

  async generateSchedule(req: Request, res: Response): Promise<void> {
    const date = req.query.date as string | undefined;
    const data = await this.svc(req).generateSchedule(date);
    success(res, data, `排产计划已生成（${data.date}）`);
  }

  async confirmSchedule(req: Request, res: Response): Promise<void> {
    const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(req.body.date);
    await this.svc(req).confirmSchedule(date);
    success(res, null, '排产计划已确认下发');
  }

  async getWorkerTasks(req: Request, res: Response): Promise<void> {
    const workerId = Number(req.params.workerId);
    const date = (req.query.date as string) ?? new Date().toISOString().slice(0, 10);
    const data = await this.svc(req).getWorkerTasks(workerId, date);
    success(res, data);
  }

  async startTask(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    await this.svc(req).startTask(id);
    success(res, null, '任务已开始');
  }

  async completeTask(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    const body = CompleteTaskSchema.parse(req.body);
    await this.svc(req).completeTask(id, body);
    success(res, null, '完工已上报');
  }

  // BE-06-01: 任务详情
  async getTask(req: Request, res: Response): Promise<void> {
    const taskId = Number(req.params.taskId);
    const data = await this.svc(req).getTaskDetail(taskId);
    success(res, data);
  }

  // R-06: 任务列表 (BE-06-02: 增加筛选参数)
  async listTasks(req: Request, res: Response): Promise<void> {
    const q = PaginationSchema.extend({
      status: z.string().optional(),
      keyword: z.string().max(100).optional(),
      processId: z.coerce.number().int().positive().optional(),
      dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      priority: z.coerce.number().int().optional(),
    }).parse(req.query);
    const { list, total } = await this.svc(req).listTasks(q);
    success(res, buildPaginated(list, total, q.page, q.pageSize));
  }

  // R-06: 异常上报
  async reportException(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    const body = z.object({
      type: z.enum(['设备故障', '物料缺失', '质量异常', '其他']),
      description: z.string().min(1).max(1000),
      severity: z.enum(['low', 'medium', 'high']),
      affectsProgress: z.boolean().optional(),
    }).parse(req.body);
    await this.svc(req).reportException(id, body);
    success(res, null, '异常已上报');
  }

  // P0-06: 暂停任务
  async suspendTask(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    const body = z.object({
      reason: z.string().min(1).max(500),
    }).parse(req.body);
    const data = await this.svc(req).suspendTask(id, body.reason);
    success(res, data, '任务已暂停');
  }

  // P0-06: 恢复任务
  async resumeTask(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    const data = await this.svc(req).resumeTask(id);
    success(res, data, '任务已恢复');
  }

  // P2: 异常处理（恢复任务）
  async resolveException(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    const body = z.object({
      resolution: z.string().min(1).max(1000),
    }).parse(req.body);
    await this.svc(req).resolveException(id, body.resolution);
    success(res, null, '异常已处理');
  }

  // BE-P2-009: 工作日历 — 查询月度日历
  async getWorkCalendar(req: Request, res: Response): Promise<void> {
    const schema = z.object({
      year:  z.coerce.number().int().min(2000).max(2100),
      month: z.coerce.number().int().min(1).max(12),
    });
    const { year, month } = schema.parse(req.query);
    const data = await this.svc(req).getWorkCalendar(year, month);
    res.json({ code: 0, data, message: 'ok' });
  }

  // BE-P2-009: 工作日历 — 设置节假日 / 调休
  async setHoliday(req: Request, res: Response): Promise<void> {
    const schema = z.object({
      date:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式必须为 YYYY-MM-DD'),
      isWorkday: z.boolean(),
      name:      z.string().max(50).optional(),
    });
    const body = schema.parse(req.body);
    await this.svc(req).setHoliday(body);
    res.json({ code: 0, data: null, message: '日历已更新' });
  }

  // BE-P1-008: 生产进度看板
  async getDashboard(req: Request, res: Response): Promise<void> {
    const result = await this.svc(req).getDashboard();
    success(res, result);
  }

  // BE-P1: 排产手动调整
  async adjustSchedule(req: Request, res: Response): Promise<void> {
    const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式必须为 YYYY-MM-DD').parse(req.params.date);
    const schema = z.object({
      adjustments: z.array(z.object({
        taskId: z.number().int().positive(),
        workerId: z.number().int().positive().optional(),
        workstationId: z.number().int().positive().optional(),
        plannedQty: z.string().optional(),
      })).min(1),
    });
    const { adjustments } = schema.parse(req.body);
    const result = await this.svc(req).adjustSchedule(date, adjustments);
    success(res, result, '排产已调整');
  }

  // BE-P1: 工人列表
  async listWorkers(req: Request, res: Response): Promise<void> {
    const data = await this.svc(req).listWorkers();
    success(res, data);
  }

  // BE-P1: 工作站列表
  async listWorkstations(req: Request, res: Response): Promise<void> {
    const data = await this.svc(req).listWorkstations();
    success(res, data);
  }

  // P0-10: 任务统计
  async getTaskStats(req: Request, res: Response): Promise<void> {
    const data = await this.svc(req).getTaskStats();
    success(res, data);
  }
}

export const productionController = new ProductionController();
