import { AppDataSource } from '../../config/database';
import { ProcessTemplateEntity, ProcessStepEntity } from './processConfig.entity';
import { ProcessStepMaterialEntity } from './processStepMaterial.entity';
import { ProcessWageEntity } from './processWage.entity';
import { WorkstationTypeEntity } from './workstationType.entity';
import { AppError } from '../../shared/AppError';
import { ResponseCode } from '../../shared/ApiResponse';

export interface ProcessConfigListFilter {
  page: number;
  pageSize: number;
  keyword?: string;
  type?: string;
}

export interface CreateProcessConfigParams {
  name: string;
  skuId: number;
  steps?: Array<{
    stepNo: number;
    stepName: string;
    standardHours?: number;
    workstationType?: string;
    workstationId?: number;
    executionMode?: 'internal' | 'outsource';
    outputType?: 'semi_finished' | 'final_product' | 'none';
    outputSkuId?: number | null;
    predecessorStepNos?: number[];
    routeGroupKey?: string | null;
    routeLevel?: number | null;
    guideText?: string;
    guideAttachmentUrl?: string;
    guideAttachmentName?: string;
  }>;
}

interface StepMaterialInput {
  stepNo: number;
  inputSkuId: number;
  usagePerUnit: number;
  lossRate?: number;
  consumeTiming?: 'start' | 'complete';
  isKeyMaterial?: boolean;
  specText?: string;
  processParams?: Record<string, unknown> | null;
}

interface ProcessStepMaterialView {
  id: number;
  tenantId: number;
  templateId: number;
  stepNo: number;
  inputSkuId: number;
  usagePerUnit: string;
  lossRate: string;
  consumeTiming: 'start' | 'complete';
  isKeyMaterial: boolean;
  specText: string | null;
  processParamsJson: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
  skuCode: string | null;
  skuName: string | null;
}

export class ProcessConfigService {
  private readonly tenantId: number;
  private readonly userId: number;

  constructor(ctx: { tenantId: number; userId: number }) {
    this.tenantId = ctx.tenantId;
    this.userId = ctx.userId;
  }

  async list(filter: ProcessConfigListFilter): Promise<[any[], number]> {
    const qb = AppDataSource.getRepository(ProcessTemplateEntity)
      .createQueryBuilder('t')
      .leftJoin('skus', 'k', 'k.id = t.sku_id')
      .select([
        't.id AS id',
        't.name AS name',
        't.sku_id AS skuId',
        'k.name AS skuName',
        'k.sku_code AS skuCode',
        't.status AS status',
        't.is_default AS isDefault',
        't.created_at AS createdAt',
        't.updated_at AS updatedAt',
      ])
      .where('t.tenant_id = :tenantId', { tenantId: this.tenantId });

    if (filter.keyword) {
      qb.andWhere('(t.name LIKE :kw OR k.name LIKE :kw)', { kw: `%${filter.keyword}%` });
    }

    const total = await qb.getCount();
    const list = await qb
      .orderBy('t.created_at', 'DESC')
      .offset((filter.page - 1) * filter.pageSize)
      .limit(filter.pageSize)
      .getRawMany();

    return [list, total];
  }

  async getById(id: number): Promise<{ template: ProcessTemplateEntity; steps: ProcessStepEntity[] }> {
    const templateRepo = AppDataSource.getRepository(ProcessTemplateEntity);
    const stepRepo = AppDataSource.getRepository(ProcessStepEntity);

    const template = await templateRepo.findOne({ where: { id, tenantId: this.tenantId } });
    if (!template) throw AppError.notFound('工序模板不存在');

    const steps = await stepRepo.find({
      where: { templateId: id, tenantId: this.tenantId },
      order: { stepNo: 'ASC' },
    });

    return { template, steps };
  }

  async getStepMaterials(templateId: number): Promise<ProcessStepMaterialView[]> {
    const templateRepo = AppDataSource.getRepository(ProcessTemplateEntity);
    const template = await templateRepo.findOne({ where: { id: templateId, tenantId: this.tenantId } });
    if (!template) throw AppError.notFound('工序模板不存在');

    const rows = await AppDataSource.getRepository(ProcessStepMaterialEntity)
      .createQueryBuilder('psm')
      .leftJoin('skus', 'sku', 'sku.id = psm.input_sku_id AND sku.tenant_id = psm.tenant_id')
      .select([
        'psm.id AS id',
        'psm.tenant_id AS tenantId',
        'psm.template_id AS templateId',
        'psm.step_no AS stepNo',
        'psm.input_sku_id AS inputSkuId',
        'psm.usage_per_unit AS usagePerUnit',
        'psm.loss_rate AS lossRate',
        'psm.consume_timing AS consumeTiming',
        'psm.is_key_material AS isKeyMaterial',
        'psm.spec_text AS specText',
        'psm.process_params_json AS processParamsJson',
        'psm.created_at AS createdAt',
        'psm.updated_at AS updatedAt',
        'sku.sku_code AS skuCode',
        'sku.name AS skuName',
      ])
      .where('psm.tenant_id = :tenantId', { tenantId: this.tenantId })
      .andWhere('psm.template_id = :templateId', { templateId })
      .orderBy('psm.step_no', 'ASC')
      .addOrderBy('psm.input_sku_id', 'ASC')
      .getRawMany();

    return rows.map((row) => {
      let parsedProcessParams: Record<string, unknown> | null = null;
      if (typeof row.processParamsJson === 'string') {
        try {
          parsedProcessParams = JSON.parse(row.processParamsJson);
        } catch {
          parsedProcessParams = null;
        }
      } else if (row.processParamsJson && typeof row.processParamsJson === 'object') {
        parsedProcessParams = row.processParamsJson;
      }

      return {
      id: Number(row.id),
      tenantId: Number(row.tenantId),
      templateId: Number(row.templateId),
      stepNo: Number(row.stepNo),
      inputSkuId: Number(row.inputSkuId),
      usagePerUnit: String(row.usagePerUnit ?? '0'),
      lossRate: String(row.lossRate ?? '0'),
      consumeTiming: row.consumeTiming === 'complete' ? 'complete' : 'start',
      isKeyMaterial: Boolean(Number(row.isKeyMaterial)),
      specText: row.specText ?? null,
      processParamsJson: parsedProcessParams,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      skuCode: row.skuCode ?? null,
      skuName: row.skuName ?? null,
      };
    });
  }

  async setStepMaterials(templateId: number, items: StepMaterialInput[]): Promise<ProcessStepMaterialEntity[]> {
    const templateRepo = AppDataSource.getRepository(ProcessTemplateEntity);
    const stepRepo = AppDataSource.getRepository(ProcessStepEntity);
    const template = await templateRepo.findOne({ where: { id: templateId, tenantId: this.tenantId } });
    if (!template) throw AppError.notFound('工序模板不存在');

    const steps = await stepRepo.find({
      where: { tenantId: this.tenantId, templateId },
      order: { stepNo: 'ASC' },
    });
    const validStepNos = new Set(steps.map((step) => step.stepNo));

    for (const item of items) {
      if (!validStepNos.has(item.stepNo)) {
        throw AppError.badRequest(`模板 ${templateId} 不存在 stepNo=${item.stepNo} 的工序步骤`);
      }
    }

    return AppDataSource.transaction(async (manager) => {
      await manager.delete(ProcessStepMaterialEntity, {
        tenantId: this.tenantId,
        templateId,
      });

      if (items.length === 0) return [];

      const entities = items.map((item) => manager.create(ProcessStepMaterialEntity, {
        tenantId: this.tenantId,
        templateId,
        stepNo: item.stepNo,
        inputSkuId: item.inputSkuId,
        usagePerUnit: item.usagePerUnit.toFixed(4),
        lossRate: (item.lossRate ?? 0).toFixed(4),
        consumeTiming: item.consumeTiming ?? 'start',
        isKeyMaterial: Boolean(item.isKeyMaterial),
        specText: item.specText?.trim() || null,
        processParamsJson: item.processParams && Object.keys(item.processParams).length > 0
          ? item.processParams
          : null,
        createdBy: this.userId,
        updatedBy: this.userId,
      }));

      return manager.save(ProcessStepMaterialEntity, entities);
    });
  }

  async create(params: CreateProcessConfigParams): Promise<ProcessTemplateEntity> {
    const templateRepo = AppDataSource.getRepository(ProcessTemplateEntity);
    const stepRepo = AppDataSource.getRepository(ProcessStepEntity);

    const template = templateRepo.create({
      tenantId: this.tenantId,
      skuId: params.skuId,
      name: params.name,
      status: 'active',
      createdBy: this.userId,
      updatedBy: this.userId,
    });
    const saved = await templateRepo.save(template);

    if (params.steps?.length) {
      const normalizedSteps = await this.normalizeSteps(params.steps);
      const stepEntities = normalizedSteps.map((s) =>
        stepRepo.create({
          tenantId: this.tenantId,
          templateId: saved.id,
          stepNo: s.stepNo,
          stepName: s.stepName,
          standardHours: s.standardHours?.toString() ?? null,
          workstationType: s.workstationType ?? null,
          workstationId: s.workstationId ?? null,
          executionMode: s.executionMode ?? 'internal',
          outputType: s.outputType ?? 'none',
          outputSkuId: s.outputSkuId ?? null,
          predecessorStepNosJson: s.predecessorStepNos ?? null,
          routeGroupKey: s.routeGroupKey ?? null,
          routeLevel: s.routeLevel ?? null,
          guideText: s.guideText ?? null,
          guideAttachmentUrl: s.guideAttachmentUrl ?? null,
          guideAttachmentName: s.guideAttachmentName ?? null,
        }),
      );
      await stepRepo.save(stepEntities);
    }

    return saved;
  }

  async update(id: number, params: Partial<CreateProcessConfigParams>): Promise<ProcessTemplateEntity> {
    const { template } = await this.getById(id);
    const templateRepo = AppDataSource.getRepository(ProcessTemplateEntity);
    const stepRepo = AppDataSource.getRepository(ProcessStepEntity);

    if (params.name !== undefined) template.name = params.name;
    if (params.skuId !== undefined) template.skuId = params.skuId;
    template.updatedBy = this.userId;

    const saved = await templateRepo.save(template);

    if (params.steps) {
      // 删除旧步骤，重建
      await stepRepo.delete({ templateId: id, tenantId: this.tenantId });
      const normalizedSteps = await this.normalizeSteps(params.steps);
      const stepEntities = normalizedSteps.map((s) =>
        stepRepo.create({
          tenantId: this.tenantId,
          templateId: id,
          stepNo: s.stepNo,
          stepName: s.stepName,
          standardHours: s.standardHours?.toString() ?? null,
          workstationType: s.workstationType ?? null,
          workstationId: s.workstationId ?? null,
          executionMode: s.executionMode ?? 'internal',
          outputType: s.outputType ?? 'none',
          outputSkuId: s.outputSkuId ?? null,
          predecessorStepNosJson: s.predecessorStepNos ?? null,
          routeGroupKey: s.routeGroupKey ?? null,
          routeLevel: s.routeLevel ?? null,
          guideText: s.guideText ?? null,
          guideAttachmentUrl: s.guideAttachmentUrl ?? null,
          guideAttachmentName: s.guideAttachmentName ?? null,
        }),
      );
      await stepRepo.save(stepEntities);
    }

    return saved;
  }

  async remove(id: number): Promise<void> {
    await this.getById(id);
    const templateRepo = AppDataSource.getRepository(ProcessTemplateEntity);
    const stepRepo = AppDataSource.getRepository(ProcessStepEntity);

    await stepRepo.delete({ templateId: id, tenantId: this.tenantId });
    await templateRepo.delete({ id });
  }

  // ─── R-05: 极限工时 ──────────────────────────────────────────────────────

  /**
   * 更新指定工序步骤的极限工时。
   * maxHours 为 null 时表示清除限制（不设上限）。
   */
  async setMaxHours(stepId: number, maxHours: number | null): Promise<{ stepId: number; maxHours: string | null }> {
    const stepRepo = AppDataSource.getRepository(ProcessStepEntity);
    const step = await stepRepo.findOne({ where: { id: stepId, tenantId: this.tenantId } });
    if (!step) throw AppError.notFound('工序步骤不存在');

    step.maxHours = maxHours !== null ? maxHours.toString() : null;
    await stepRepo.save(step);

    return { stepId: step.id, maxHours: step.maxHours };
  }

  // ─── R-05: 工价管理 ──────────────────────────────────────────────────────

  /**
   * 查询指定工序步骤的所有工价配置（skilled + apprentice）。
   */
  async getWages(stepId: number): Promise<ProcessWageEntity[]> {
    const stepRepo = AppDataSource.getRepository(ProcessStepEntity);
    const step = await stepRepo.findOne({ where: { id: stepId, tenantId: this.tenantId } });
    if (!step) throw AppError.notFound('工序步骤不存在');

    return AppDataSource.getRepository(ProcessWageEntity).find({
      where: { stepId, tenantId: this.tenantId },
      order: { workerGrade: 'ASC' },
    });
  }

  /**
   * 设置（UPSERT）指定工序步骤某等级的工价。
   * 依赖数据库唯一约束 uk_tenant_step_grade 实现 INSERT ... ON DUPLICATE KEY UPDATE。
   */
  async setWages(
    stepId: number,
    workerGrade: 'skilled' | 'apprentice',
    unitPrice: number,
  ): Promise<ProcessWageEntity> {
    const stepRepo = AppDataSource.getRepository(ProcessStepEntity);
    const step = await stepRepo.findOne({ where: { id: stepId, tenantId: this.tenantId } });
    if (!step) throw AppError.notFound('工序步骤不存在');

    const wageRepo = AppDataSource.getRepository(ProcessWageEntity);

    // 尝试找到已有记录，有则更新，无则插入（代码层 UPSERT）
    let wage = await wageRepo.findOne({
      where: { tenantId: this.tenantId, stepId, workerGrade },
    });

    if (wage) {
      wage.unitPrice = unitPrice.toString();
      wage.updatedBy = this.userId;
    } else {
      wage = wageRepo.create({
        tenantId: this.tenantId,
        stepId,
        workerGrade,
        unitPrice: unitPrice.toString(),
        createdBy: this.userId,
        updatedBy: this.userId,
      });
    }

    return wageRepo.save(wage);
  }

  // ─── BE-05-03: 批量工价设置 ──────────────────────────────────────────────

  /**
   * 批量 UPSERT 指定工序步骤的所有等级工价。
   * 在事务中处理，保证原子性。
   */
  async setWagesBatch(
    stepId: number,
    wages: Array<{ grade: 'skilled' | 'apprentice'; unitPrice: number }>,
  ): Promise<ProcessWageEntity[]> {
    const stepRepo = AppDataSource.getRepository(ProcessStepEntity);
    const step = await stepRepo.findOne({ where: { id: stepId, tenantId: this.tenantId } });
    if (!step) throw AppError.notFound('工序步骤不存在');

    const wageRepo = AppDataSource.getRepository(ProcessWageEntity);
    const results: ProcessWageEntity[] = [];

    await AppDataSource.transaction(async (manager) => {
      for (const item of wages) {
        let wage = await manager.findOne(ProcessWageEntity, {
          where: { tenantId: this.tenantId, stepId, workerGrade: item.grade },
        });

        if (wage) {
          wage.unitPrice = item.unitPrice.toString();
          wage.updatedBy = this.userId;
        } else {
          wage = manager.create(ProcessWageEntity, {
            tenantId: this.tenantId,
            stepId,
            workerGrade: item.grade,
            unitPrice: item.unitPrice.toString(),
            createdBy: this.userId,
            updatedBy: this.userId,
          });
        }

        const saved = await manager.save(ProcessWageEntity, wage);
        results.push(saved);
      }
    });

    return results;
  }

  // ─── BE-05-01: 工资汇总报表 ──────────────────────────────────────────────

  /**
   * 按工序模板汇总工人工资。
   * 关联路径：process_steps → process_wages → production_tasks → users
   * 支持日期范围、工人 ID 列表、工种等级过滤。
   */
  async getWageSummary(
    templateId: number,
    filter: {
      from?: string;
      to?: string;
      workerIds?: number[];
      grade?: 'skilled' | 'apprentice';
    },
  ): Promise<Array<{
    userId: number;
    userName: string;
    workerGrade: string;
    steps: Array<{ stepName: string; qty: number; unitPrice: number; subtotal: number }>;
    totalWage: number;
  }>> {
    const conditions: string[] = [
      'wr.tenant_id = ?',
      'ps.template_id = ?',
    ];
    const params: unknown[] = [this.tenantId, templateId];

    if (filter.from) {
      conditions.push('wr.work_date >= ?');
      params.push(filter.from);
    }
    if (filter.to) {
      conditions.push('wr.work_date <= ?');
      params.push(filter.to);
    }
    if (filter.workerIds && filter.workerIds.length > 0) {
      const ph = filter.workerIds.map(() => '?').join(',');
      conditions.push(`wr.worker_id IN (${ph})`);
      params.push(...filter.workerIds);
    }
    if (filter.grade) {
      conditions.push('u.skill_level = ?');
      params.push(filter.grade);
    }

    const rows = await AppDataSource.query<Array<{
      userId: number;
      userName: string;
      workerGrade: string;
      stepId: number;
      stepName: string;
      completedQty: string;
      unitPrice: string | null;
      wageAmount: string;
    }>>(
      `SELECT
         u.id                AS userId,
         u.real_name         AS userName,
         COALESCE(u.skill_level, '') AS workerGrade,
         ps.id               AS stepId,
         ps.step_name        AS stepName,
         SUM(wr.qty_completed) AS completedQty,
         COALESCE(MAX(wr.unit_wage), 0) AS unitPrice,
         SUM(wr.wage_amount) AS wageAmount
       FROM work_reports wr
       INNER JOIN process_steps ps ON ps.id = wr.process_step_id
       INNER JOIN users u ON u.id = wr.worker_id
       WHERE ${conditions.join(' AND ')}
         AND wr.status IN ('confirmed', 'settled')
       GROUP BY u.id, u.real_name, u.skill_level, ps.id, ps.step_name
       ORDER BY u.real_name, ps.step_name`,
      params,
    );

    // 按工人聚合
    const workerMap = new Map<number, {
      userId: number;
      userName: string;
      workerGrade: string;
      steps: Array<{ stepName: string; qty: number; unitPrice: number; subtotal: number }>;
      totalWage: number;
    }>();

    for (const row of rows) {
      const uid = Number(row.userId);
      const qty = Number(row.completedQty ?? 0);
      const price = Number(row.unitPrice ?? 0);
      const subtotal = Math.round(Number(row.wageAmount ?? 0) * 100) / 100;

      if (!workerMap.has(uid)) {
        workerMap.set(uid, {
          userId: uid,
          userName: row.userName,
          workerGrade: row.workerGrade ?? '',
          steps: [],
          totalWage: 0,
        });
      }

      const worker = workerMap.get(uid)!;
      worker.steps.push({
        stepName: row.stepName,
        qty,
        unitPrice: price,
        subtotal,
      });
      worker.totalWage = Math.round((worker.totalWage + subtotal) * 100) / 100;
    }

    return Array.from(workerMap.values());
  }

  // ─── T-02: 设为默认模板 ──────────────────────────────────────────────────────

  async setDefault(id: number): Promise<ProcessTemplateEntity> {
    const templateRepo = AppDataSource.getRepository(ProcessTemplateEntity);
    const tmpl = await templateRepo.findOne({ where: { id, tenantId: this.tenantId } });
    if (!tmpl) throw new AppError('工序模板不存在', ResponseCode.NOT_FOUND, 404);

    await AppDataSource.transaction(async (manager) => {
      // 清除同 SKU 下所有默认标记
      await manager.update(
        ProcessTemplateEntity,
        { tenantId: this.tenantId, skuId: tmpl.skuId },
        { isDefault: false },
      );
      // 设置当前模板为默认
      await manager.update(ProcessTemplateEntity, { id }, { isDefault: true });
    });

    tmpl.isDefault = true;
    return tmpl;
  }

  // ─── 工种类型管理 ──────────────────────────────────────────────────────────

  private get wtRepo() {
    return AppDataSource.getRepository(WorkstationTypeEntity);
  }

  async listWorkstationTypes(): Promise<WorkstationTypeEntity[]> {
    return this.wtRepo.find({
      where: { tenantId: this.tenantId },
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });
  }

  async createWorkstationType(name: string, sortOrder = 0): Promise<WorkstationTypeEntity> {
    const exists = await this.wtRepo.findOne({
      where: { tenantId: this.tenantId, name },
    });
    if (exists) throw new AppError(`工种类型"${name}"已存在`, ResponseCode.CONFLICT, 409);

    const entity = this.wtRepo.create({ tenantId: this.tenantId, name, sortOrder });
    return this.wtRepo.save(entity);
  }

  async updateWorkstationType(
    id: number,
    data: { name?: string; sortOrder?: number },
  ): Promise<WorkstationTypeEntity> {
    const entity = await this.wtRepo.findOne({ where: { id, tenantId: this.tenantId } });
    if (!entity) throw new AppError('工种类型不存在', ResponseCode.NOT_FOUND, 404);

    if (data.name !== undefined) entity.name = data.name;
    if (data.sortOrder !== undefined) entity.sortOrder = data.sortOrder;
    return this.wtRepo.save(entity);
  }

  async deleteWorkstationType(id: number): Promise<void> {
    const entity = await this.wtRepo.findOne({ where: { id, tenantId: this.tenantId } });
    if (!entity) throw new AppError('工种类型不存在', ResponseCode.NOT_FOUND, 404);
    await this.wtRepo.remove(entity);
  }

  private async normalizeSteps(
    steps: Array<{
      stepNo: number;
      stepName: string;
      standardHours?: number;
      workstationType?: string;
      workstationId?: number;
      executionMode?: 'internal' | 'outsource';
      outputType?: 'semi_finished' | 'final_product' | 'none';
      outputSkuId?: number | null;
      predecessorStepNos?: number[];
      routeGroupKey?: string | null;
      routeLevel?: number | null;
      guideText?: string;
      guideAttachmentUrl?: string;
      guideAttachmentName?: string;
    }>,
  ) {
    const workstationIds = [...new Set(
      steps
        .map((item) => item.workstationId)
        .filter((value): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0),
    )];

    const workstationMap = new Map<number, { id: number; type: string }>();
    if (workstationIds.length > 0) {
      const placeholders = workstationIds.map(() => '?').join(', ');
      const rows = await AppDataSource.query<Array<{ id: number; type: string }>>(
        `SELECT id, type
         FROM workstations
         WHERE tenant_id = ? AND id IN (${placeholders})`,
        [this.tenantId, ...workstationIds],
      );
      rows.forEach((row) => {
        workstationMap.set(Number(row.id), { id: Number(row.id), type: row.type });
      });
    }

    const stepNoSet = new Set(steps.map((step) => Number(step.stepNo)));

    return steps.map((step) => {
      const linkedWorkstation = step.workstationId ? workstationMap.get(Number(step.workstationId)) : null;
      if (step.workstationId && !linkedWorkstation) {
        throw AppError.badRequest(`工序“${step.stepName}”关联的工作站不存在`);
      }
      if (linkedWorkstation && step.workstationType && step.workstationType !== linkedWorkstation.type) {
        throw AppError.badRequest(`工序“${step.stepName}”的工作站类型与具体工作站不一致`);
      }
      const outputType = step.outputType ?? 'none';
      const outputSkuId = step.outputSkuId ?? null;
      if (outputType === 'none' && outputSkuId) {
        throw AppError.badRequest(`工序“${step.stepName}”未指定产出类型时，不能填写产出 SKU`);
      }
      if (outputType !== 'none' && !outputSkuId) {
        throw AppError.badRequest(`工序“${step.stepName}”指定了产出类型，但缺少产出 SKU`);
      }
      const predecessorStepNos = [...new Set((step.predecessorStepNos ?? []).map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0))];
      for (const predecessorStepNo of predecessorStepNos) {
        if (!stepNoSet.has(predecessorStepNo)) {
          throw AppError.badRequest(`工序“${step.stepName}”引用了不存在的前置步骤 Step ${predecessorStepNo}`);
        }
        if (predecessorStepNo >= step.stepNo) {
          throw AppError.badRequest(`工序“${step.stepName}”的前置步骤必须小于当前步骤号`);
        }
      }
      return {
        ...step,
        workstationType: linkedWorkstation?.type ?? step.workstationType,
        workstationId: linkedWorkstation?.id ?? step.workstationId,
        executionMode: step.executionMode ?? 'internal',
        outputType,
        outputSkuId,
        predecessorStepNos,
        routeGroupKey: step.routeGroupKey?.trim() || null,
        routeLevel: step.routeLevel ?? null,
        guideText: step.guideText?.trim() || undefined,
        guideAttachmentUrl: step.guideAttachmentUrl?.trim() || undefined,
        guideAttachmentName: step.guideAttachmentName?.trim() || undefined,
      };
    });
  }
}
