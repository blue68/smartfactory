import { Request, Response } from 'express';
import { z } from 'zod';
import { ProcessConfigService } from './processConfig.service';
import { success, created, buildPaginated } from '../../shared/ApiResponse';
import { PaginationSchema } from '../../middleware/validator';

// ── R-05 参数 Schema ──────────────────────────────────────────────────────

const MaxHoursSchema = z.object({
  maxHours: z.number().positive().nullable(),
});

const SetWageSchema = z.object({
  workerGrade: z.enum(['skilled', 'apprentice']),
  unitPrice: z.number().min(0),
});

// BE-05-03: 批量工价设置 Schema（数组格式）
const SetWagesArraySchema = z.object({
  wages: z.array(
    z.object({
      grade: z.enum(['skilled', 'apprentice']),
      unitPrice: z.number().min(0),
    }),
  ).min(1),
});

// BE-05-01: 工资汇总查询 Schema
const WageSummaryQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  workerIds: z.string().optional(),
  grade: z.enum(['skilled', 'apprentice']).optional(),
});

const ListQuerySchema = PaginationSchema.extend({
  keyword: z.string().max(100).optional(),
  type: z.string().max(50).optional(),
});

const StepSchema = z.object({
  stepNo: z.number().int().positive(),
  stepName: z.string().min(1).max(100),
  standardHours: z.number().positive().optional(),
  workstationType: z.string().max(50).optional(),
  workstationId: z.number().int().positive().optional(),
  executionMode: z.enum(['internal', 'outsource']).optional(),
  outputType: z.enum(['semi_finished', 'final_product', 'none']).optional(),
  outputSkuId: z.number().int().positive().nullable().optional(),
  predecessorStepNos: z.array(z.number().int().positive()).optional(),
  routeGroupKey: z.string().max(120).nullable().optional(),
  routeLevel: z.number().int().positive().nullable().optional(),
  guideText: z.string().max(5000).optional(),
  guideAttachmentUrl: z.string().max(500).optional(),
  guideAttachmentName: z.string().max(255).optional(),
});

const StepMaterialSchema = z.object({
  stepNo: z.number().int().positive(),
  inputSkuId: z.number().int().positive(),
  usagePerUnit: z.number().positive(),
  lossRate: z.number().min(0).max(1).optional(),
  consumeTiming: z.enum(['start', 'complete']).optional(),
  isKeyMaterial: z.boolean().optional(),
  specText: z.string().max(255).optional(),
  processParams: z.record(z.string(), z.any()).nullable().optional(),
});

const StepMaterialsSchema = z.object({
  items: z.array(StepMaterialSchema),
});

const CreateSchema = z.object({
  name: z.string().min(1).max(200),
  skuId: z.number().int().positive(),
  steps: z.array(StepSchema).optional(),
});

export class ProcessConfigController {
  private svc(req: Request): ProcessConfigService {
    return new ProcessConfigService({ tenantId: req.tenantId, userId: req.userId });
  }

  async list(req: Request, res: Response): Promise<void> {
    const q = ListQuerySchema.parse(req.query);
    const [list, total] = await this.svc(req).list({
      page: q.page,
      pageSize: q.pageSize,
      keyword: q.keyword,
      type: q.type,
    });
    success(res, buildPaginated(list, total, q.page, q.pageSize));
  }

  async getOne(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    const result = await this.svc(req).getById(id);
    success(res, result);
  }

  async create(req: Request, res: Response): Promise<void> {
    const body = CreateSchema.parse(req.body);
    const template = await this.svc(req).create(body);
    created(res, template, '工序模板已创建');
  }

  async update(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    const body = CreateSchema.partial().parse(req.body);
    const template = await this.svc(req).update(id, body);
    success(res, template, '工序模板已更新');
  }

  async remove(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    await this.svc(req).remove(id);
    success(res, { id }, '工序模板已删除');
  }

  // ─── R-05: 极限工时 ────────────────────────────────────────────────────

  async putMaxHours(req: Request, res: Response): Promise<void> {
    const stepId = Number(req.params.stepId);
    const { maxHours } = MaxHoursSchema.parse(req.body);
    const result = await this.svc(req).setMaxHours(stepId, maxHours);
    success(res, result, '极限工时已更新');
  }

  // ─── R-05: 工价管理 ────────────────────────────────────────────────────

  async getWages(req: Request, res: Response): Promise<void> {
    const stepId = Number(req.params.stepId);
    const wages = await this.svc(req).getWages(stepId);
    success(res, wages);
  }

  // BE-05-03: 工价设置（支持单条旧格式 + 批量数组格式）
  async putWages(req: Request, res: Response): Promise<void> {
    const stepId = Number(req.params.stepId);

    // 优先尝试数组格式
    const arrayResult = SetWagesArraySchema.safeParse(req.body);
    if (arrayResult.success) {
      const result = await this.svc(req).setWagesBatch(stepId, arrayResult.data.wages);
      success(res, result, '工价已批量更新');
      return;
    }

    // 兼容旧的单条格式
    const { workerGrade, unitPrice } = SetWageSchema.parse(req.body);
    const wage = await this.svc(req).setWages(stepId, workerGrade, unitPrice);
    success(res, wage, '工价已更新');
  }

  // BE-05-01: 工资汇总报表
  async getWageSummary(req: Request, res: Response): Promise<void> {
    const templateId = Number(req.params.templateId);
    const q = WageSummaryQuerySchema.parse(req.query);
    const workerIds = q.workerIds
      ? q.workerIds.split(',').map((s) => Number(s.trim())).filter((n) => n > 0)
      : undefined;
    const data = await this.svc(req).getWageSummary(templateId, {
      from: q.from,
      to: q.to,
      workerIds,
      grade: q.grade,
    });
    success(res, data);
  }

  async getStepMaterials(req: Request, res: Response): Promise<void> {
    const templateId = Number(req.params.templateId);
    const data = await this.svc(req).getStepMaterials(templateId);
    success(res, data);
  }

  async putStepMaterials(req: Request, res: Response): Promise<void> {
    const templateId = Number(req.params.templateId);
    const body = StepMaterialsSchema.parse(req.body);
    const data = await this.svc(req).setStepMaterials(templateId, body.items);
    success(res, data, '工序投入物料已更新');
  }

  // T-02: 设为默认模板
  async setDefault(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    if (!id || isNaN(id)) {
      res.status(400).json({ code: 400, message: '无效的模板ID', data: null });
      return;
    }
    const template = await this.svc(req).setDefault(id);
    success(res, template, '已设为默认模板');
  }

  // BE-05-04: 工资汇总 CSV 导出
  async exportWageSummary(req: Request, res: Response): Promise<void> {
    const templateId = Number(req.params.templateId);
    const q = WageSummaryQuerySchema.parse(req.query);
    const workerIds = q.workerIds
      ? q.workerIds.split(',').map((s) => Number(s.trim())).filter((n) => n > 0)
      : undefined;
    const data = await this.svc(req).getWageSummary(templateId, {
      from: q.from,
      to: q.to,
      workerIds,
      grade: q.grade,
    });

    // 生成 CSV
    const lines: string[] = [];
    lines.push('工人ID,工人姓名,工种等级,工序名称,完成数量,单价,小计,合计工资');
    for (const worker of data) {
      for (const step of worker.steps) {
        lines.push(
          [
            worker.userId,
            `"${worker.userName}"`,
            worker.workerGrade,
            `"${step.stepName}"`,
            step.qty,
            step.unitPrice,
            step.subtotal,
            worker.totalWage,
          ].join(','),
        );
      }
    }
    const csv = lines.join('\n');
    const filename = `wage-summary-${templateId}-${Date.now()}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', Buffer.byteLength(csv, 'utf-8'));
    res.send(csv);
  }
}

// ─── 工种类型 Schema ────────────────────────────────────────────────────────

const WorkstationTypeCreateSchema = z.object({
  name: z.string().min(1).max(100),
  sortOrder: z.number().int().min(0).optional(),
});

const WorkstationTypeUpdateSchema = WorkstationTypeCreateSchema.partial();

// ─── ProcessConfigController 追加工种类型方法 ────────────────────────────────

export class WorkstationTypeController {
  private svc(req: Request): ProcessConfigService {
    return new ProcessConfigService({ tenantId: req.tenantId, userId: req.userId });
  }

  async list(req: Request, res: Response): Promise<void> {
    const data = await this.svc(req).listWorkstationTypes();
    success(res, data);
  }

  async create(req: Request, res: Response): Promise<void> {
    const { name, sortOrder } = WorkstationTypeCreateSchema.parse(req.body);
    const data = await this.svc(req).createWorkstationType(name, sortOrder);
    created(res, data, '工种类型已创建');
  }

  async update(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    const body = WorkstationTypeUpdateSchema.parse(req.body);
    const data = await this.svc(req).updateWorkstationType(id, body);
    success(res, data, '工种类型已更新');
  }

  async remove(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    await this.svc(req).deleteWorkstationType(id);
    success(res, { id }, '工种类型已删除');
  }
}

export const workstationTypeController = new WorkstationTypeController();
export const processConfigController = new ProcessConfigController();
