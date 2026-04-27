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
  skuId?: number | null;
  baseTemplateId?: number | null;
  version?: string;
  steps?: ProcessStepInput[];
}

interface ProcessStepInput {
  stepNo: number;
  stepName: string;
  standardHours?: number;
  maxHours?: number | null;
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
}

interface ProcessTemplateView extends ProcessTemplateEntity {
  templateMode: 'standard' | 'variant' | 'independent';
  baseTemplateName: string | null;
  skuName: string | null;
  skuCode: string | null;
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
      .leftJoin('process_templates', 'bt', 'bt.id = t.base_template_id AND bt.tenant_id = t.tenant_id')
      .select([
        't.id AS id',
        't.name AS name',
        't.sku_id AS skuId',
        't.base_template_id AS baseTemplateId',
        't.version AS version',
        'k.name AS skuName',
        'k.sku_code AS skuCode',
        'bt.name AS baseTemplateName',
        't.status AS status',
        't.is_default AS isDefault',
        't.created_at AS createdAt',
        't.updated_at AS updatedAt',
      ])
      .where('t.tenant_id = :tenantId', { tenantId: this.tenantId });

    if (filter.keyword) {
      qb.andWhere('(t.name LIKE :kw OR k.name LIKE :kw OR bt.name LIKE :kw)', { kw: `%${filter.keyword}%` });
    }

    if (filter.type === 'standard') {
      qb.andWhere('t.sku_id IS NULL');
    } else if (filter.type === 'variant') {
      qb.andWhere('t.base_template_id IS NOT NULL');
    } else if (filter.type === 'independent') {
      qb.andWhere('t.sku_id IS NOT NULL AND t.base_template_id IS NULL');
    }

    const total = await qb.getCount();
    const rows = await qb
      .orderBy('t.created_at', 'DESC')
      .offset((filter.page - 1) * filter.pageSize)
      .limit(filter.pageSize)
      .getRawMany();

    const list = rows.map((row) => {
      const skuId = row.skuId !== null && row.skuId !== undefined ? Number(row.skuId) : null;
      const baseTemplateId = row.baseTemplateId !== null && row.baseTemplateId !== undefined
        ? Number(row.baseTemplateId)
        : null;
      return {
        ...row,
        skuId,
        baseTemplateId,
        isDefault: Boolean(Number(row.isDefault)),
        templateMode: this.resolveTemplateMode({ skuId, baseTemplateId }),
      };
    });

    return [list, total];
  }

  async getById(id: number): Promise<{ template: ProcessTemplateView; steps: ProcessStepEntity[] }> {
    const template = await this.requireTemplateEntity(id);
    const baseTemplate = template.baseTemplateId
      ? await AppDataSource.getRepository(ProcessTemplateEntity).findOne({
        where: { id: template.baseTemplateId, tenantId: this.tenantId },
      })
      : null;
    const skuMeta = template.skuId
      ? await AppDataSource
        .createQueryBuilder()
        .select([
          'sku.name AS skuName',
          'sku.sku_code AS skuCode',
        ])
        .from('skus', 'sku')
        .where('sku.id = :skuId', { skuId: template.skuId })
        .andWhere('sku.tenant_id = :tenantId', { tenantId: this.tenantId })
        .getRawOne<{ skuName: string | null; skuCode: string | null }>()
      : null;

    const steps = await AppDataSource.getRepository(ProcessStepEntity).find({
      where: { templateId: id, tenantId: this.tenantId },
      order: { stepNo: 'ASC' },
    });

    return {
      template: {
        ...template,
        templateMode: this.resolveTemplateMode(template),
        baseTemplateName: baseTemplate?.name ?? null,
        skuName: skuMeta?.skuName ?? null,
        skuCode: skuMeta?.skuCode ?? null,
      },
      steps,
    };
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
    const baseTemplate = params.baseTemplateId
      ? await this.requireStandardBaseTemplate(params.baseTemplateId)
      : null;
    const nextSkuId = params.skuId ?? null;

    if (baseTemplate && !nextSkuId) {
      throw AppError.badRequest('引用标准模板创建 SKU 工艺时，必须选择关联 SKU');
    }

    const template = templateRepo.create({
      tenantId: this.tenantId,
      skuId: nextSkuId,
      baseTemplateId: baseTemplate?.id ?? null,
      name: params.name,
      status: 'active',
      templateType: baseTemplate || nextSkuId ? 'custom' : 'standard',
      version: this.normalizeVersion(params.version),
      createdBy: this.userId,
      updatedBy: this.userId,
    });
    const saved = await templateRepo.save(template);

    if (baseTemplate) {
      const baseSteps = await this.getTemplateSteps(baseTemplate.id);
      const normalizedSteps = params.steps?.length
        ? this.mergeVariantSteps(baseSteps, await this.normalizeSteps(params.steps))
        : this.buildNormalizedStepsFromEntities(baseSteps);
      await AppDataSource.transaction(async (manager) => {
        await this.replaceTemplateSteps(manager, saved.id, normalizedSteps);
        await this.syncTemplateWagesFromBase(manager, baseTemplate.id, saved.id);
      });
    } else if (params.steps?.length) {
      const normalizedSteps = await this.normalizeSteps(params.steps, { allowUnboundFinalOutput: !nextSkuId });
      await AppDataSource.transaction(async (manager) => {
        await this.replaceTemplateSteps(manager, saved.id, normalizedSteps);
      });
    }

    return saved;
  }

  async update(id: number, params: Partial<CreateProcessConfigParams>): Promise<ProcessTemplateEntity> {
    const template = await this.requireTemplateEntity(id);
    const templateRepo = AppDataSource.getRepository(ProcessTemplateEntity);
    const currentBaseTemplateId = template.baseTemplateId ?? null;
    const nextBaseTemplateId = params.baseTemplateId !== undefined ? (params.baseTemplateId ?? null) : currentBaseTemplateId;
    const nextSkuId = params.skuId !== undefined ? (params.skuId ?? null) : template.skuId;
    const baseTemplate = nextBaseTemplateId
      ? await this.requireStandardBaseTemplate(nextBaseTemplateId, id)
      : null;

    if (baseTemplate && !nextSkuId) {
      throw AppError.badRequest('引用标准模板的 SKU 工艺必须绑定具体 SKU');
    }
    if (params.name !== undefined) template.name = params.name;
    if (params.skuId !== undefined) template.skuId = nextSkuId;
    if (params.baseTemplateId !== undefined) template.baseTemplateId = nextBaseTemplateId;
    if (params.version !== undefined) template.version = this.normalizeVersion(params.version);
    template.templateType = baseTemplate || nextSkuId ? 'custom' : 'standard';
    template.updatedBy = this.userId;

    const saved = await templateRepo.save(template);

    if (baseTemplate) {
      if (params.steps) {
        const normalizedSteps = this.mergeVariantSteps(
          await this.getTemplateSteps(baseTemplate.id),
          await this.normalizeSteps(params.steps),
        );
        await AppDataSource.transaction(async (manager) => {
          await this.replaceTemplateSteps(manager, id, normalizedSteps);
          await this.syncTemplateWagesFromBase(manager, baseTemplate.id, id);
        });
      } else if (params.baseTemplateId !== undefined) {
        await this.syncVariantTemplateFromBase(id, baseTemplate.id);
      }
    } else if (params.steps) {
      const normalizedSteps = await this.normalizeSteps(params.steps, { allowUnboundFinalOutput: !nextSkuId });
      await AppDataSource.transaction(async (manager) => {
        await this.replaceTemplateSteps(manager, id, normalizedSteps);
      });
      await this.syncDerivedTemplatesFromBase(id);
    }

    return saved;
  }

  async remove(id: number): Promise<void> {
    const templateRepo = AppDataSource.getRepository(ProcessTemplateEntity);
    const template = await this.requireTemplateEntity(id);
    const derivedCount = await templateRepo.count({
      where: { tenantId: this.tenantId, baseTemplateId: template.id },
    });
    if (derivedCount > 0) {
      throw new AppError('请先解除或删除引用该标准模板的 SKU 工艺，再删除当前模板', ResponseCode.CONFLICT, 409);
    }

    await AppDataSource.transaction(async (manager) => {
      await this.deleteTemplateArtifacts(manager, id);
      await manager.delete(ProcessTemplateEntity, { id, tenantId: this.tenantId });
    });
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
    const template = await this.requireTemplateEntity(Number(step.templateId));
    if (template.baseTemplateId) {
      throw AppError.badRequest('引用标准模板的 SKU 工艺不能单独修改共享工时，请到标准模板中维护');
    }

    step.maxHours = maxHours !== null ? maxHours.toString() : null;
    await stepRepo.save(step);
    await this.syncDerivedTemplatesFromBase(Number(step.templateId));

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
    const template = await this.requireTemplateEntity(Number(step.templateId));
    if (template.baseTemplateId) {
      throw AppError.badRequest('引用标准模板的 SKU 工艺不能单独修改共享工价，请到标准模板中维护');
    }

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

    const saved = await wageRepo.save(wage);
    await this.syncDerivedTemplatesFromBase(Number(step.templateId));
    return saved;
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
    const template = await this.requireTemplateEntity(Number(step.templateId));
    if (template.baseTemplateId) {
      throw AppError.badRequest('引用标准模板的 SKU 工艺不能单独修改共享工价，请到标准模板中维护');
    }

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

    await this.syncDerivedTemplatesFromBase(Number(step.templateId));
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
    if (!tmpl.skuId) {
      throw AppError.badRequest('标准模板不能直接设为默认，请先创建绑定 SKU 的工艺模板');
    }

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

  private resolveTemplateMode(template: { skuId: number | null; baseTemplateId: number | null }): 'standard' | 'variant' | 'independent' {
    if (template.baseTemplateId) return 'variant';
    if (template.skuId) return 'independent';
    return 'standard';
  }

  private normalizeVersion(version?: string | null): string {
    const normalized = typeof version === 'string' ? version.trim() : '';
    return normalized || '1.0';
  }

  private async requireTemplateEntity(id: number): Promise<ProcessTemplateEntity> {
    const template = await AppDataSource.getRepository(ProcessTemplateEntity).findOne({
      where: { id, tenantId: this.tenantId },
    });
    if (!template) throw AppError.notFound('工序模板不存在');
    return template;
  }

  private async requireStandardBaseTemplate(baseTemplateId: number, excludeTemplateId?: number): Promise<ProcessTemplateEntity> {
    const template = await this.requireTemplateEntity(baseTemplateId);
    if (excludeTemplateId && Number(template.id) === Number(excludeTemplateId)) {
      throw AppError.badRequest('工序模板不能引用自身作为标准模板');
    }
    if (template.baseTemplateId) {
      throw AppError.badRequest('当前模板本身已是变体模板，不能继续作为标准模板被引用');
    }
    if (template.skuId) {
      throw AppError.badRequest('只有未绑定 SKU 的标准模板才能作为共享模板被引用');
    }
    return template;
  }

  private async getTemplateSteps(templateId: number): Promise<ProcessStepEntity[]> {
    return AppDataSource.getRepository(ProcessStepEntity).find({
      where: { tenantId: this.tenantId, templateId },
      order: { stepNo: 'ASC' },
    });
  }

  private buildNormalizedStepsFromEntities(steps: ProcessStepEntity[]): ProcessStepInput[] {
    return steps.map((step) => ({
      stepNo: Number(step.stepNo),
      stepName: step.stepName,
      standardHours: step.standardHours !== null ? Number(step.standardHours) : undefined,
      maxHours: step.maxHours !== null ? Number(step.maxHours) : null,
      workstationType: step.workstationType ?? undefined,
      workstationId: step.workstationId ?? undefined,
      executionMode: step.executionMode ?? 'internal',
      outputType: step.outputType ?? 'none',
      outputSkuId: step.outputType === 'none' ? null : (step.outputSkuId ?? null),
      predecessorStepNos: Array.isArray(step.predecessorStepNosJson)
        ? step.predecessorStepNosJson.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0)
        : [],
      routeGroupKey: step.routeGroupKey ?? null,
      routeLevel: step.routeLevel ?? null,
      guideText: step.guideText ?? undefined,
      guideAttachmentUrl: step.guideAttachmentUrl ?? undefined,
      guideAttachmentName: step.guideAttachmentName ?? undefined,
    }));
  }

  private mergeVariantSteps(baseSteps: ProcessStepEntity[], overrides: ProcessStepInput[]): ProcessStepInput[] {
    const baseByStepNo = new Map(baseSteps.map((step) => [Number(step.stepNo), step]));
    const overrideByStepNo = new Map(overrides.map((step) => [Number(step.stepNo), step]));
    if (baseByStepNo.size !== overrideByStepNo.size) {
      throw AppError.badRequest('SKU 变体模板必须与标准模板保持相同的工序数量和编号');
    }

    return baseSteps.map((baseStep) => {
      const override = overrideByStepNo.get(Number(baseStep.stepNo));
      if (!override) {
        throw AppError.badRequest(`SKU 变体模板缺少 Step ${baseStep.stepNo} 的输出配置`);
      }
      return {
        stepNo: Number(baseStep.stepNo),
        stepName: baseStep.stepName,
        standardHours: baseStep.standardHours !== null ? Number(baseStep.standardHours) : undefined,
        maxHours: baseStep.maxHours !== null ? Number(baseStep.maxHours) : null,
        workstationType: baseStep.workstationType ?? undefined,
        workstationId: baseStep.workstationId ?? undefined,
        executionMode: baseStep.executionMode ?? 'internal',
        outputType: override.outputType ?? (baseStep.outputType ?? 'none'),
        outputSkuId: (override.outputType ?? baseStep.outputType ?? 'none') === 'none'
          ? null
          : (override.outputSkuId ?? baseStep.outputSkuId ?? null),
        predecessorStepNos: Array.isArray(baseStep.predecessorStepNosJson)
          ? baseStep.predecessorStepNosJson.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0)
          : [],
        routeGroupKey: baseStep.routeGroupKey ?? null,
        routeLevel: baseStep.routeLevel ?? null,
        guideText: baseStep.guideText ?? undefined,
        guideAttachmentUrl: baseStep.guideAttachmentUrl ?? undefined,
        guideAttachmentName: baseStep.guideAttachmentName ?? undefined,
      };
    });
  }

  private async replaceTemplateSteps(manager: any, templateId: number, steps: ProcessStepInput[]): Promise<ProcessStepEntity[]> {
    const existingSteps = await manager.find(ProcessStepEntity, {
      where: { tenantId: this.tenantId, templateId },
      order: { stepNo: 'ASC' },
    });
    const existingStepIds = existingSteps.map((step: ProcessStepEntity) => Number(step.id)).filter((id: number) => id > 0);
    if (existingStepIds.length > 0) {
      const placeholders = existingStepIds.map(() => '?').join(', ');
      await manager.query(
        `DELETE FROM process_wages WHERE tenant_id = ? AND step_id IN (${placeholders})`,
        [this.tenantId, ...existingStepIds],
      );
    }

    await manager.delete(ProcessStepEntity, { tenantId: this.tenantId, templateId });

    if (steps.length === 0) {
      await manager.delete(ProcessStepMaterialEntity, { tenantId: this.tenantId, templateId });
      return [];
    }

    const entities = steps.map((step) => manager.create(ProcessStepEntity, {
      tenantId: this.tenantId,
      templateId,
      stepNo: step.stepNo,
      stepName: step.stepName,
      standardHours: step.standardHours?.toString() ?? null,
      maxHours: step.maxHours !== undefined && step.maxHours !== null ? step.maxHours.toString() : null,
      workstationType: step.workstationType ?? null,
      workstationId: step.workstationId ?? null,
      executionMode: step.executionMode ?? 'internal',
      outputType: step.outputType ?? 'none',
      outputSkuId: step.outputType === 'none' ? null : (step.outputSkuId ?? null),
      predecessorStepNosJson: step.predecessorStepNos ?? null,
      routeGroupKey: step.routeGroupKey ?? null,
      routeLevel: step.routeLevel ?? null,
      guideText: step.guideText ?? null,
      guideAttachmentUrl: step.guideAttachmentUrl ?? null,
      guideAttachmentName: step.guideAttachmentName ?? null,
      createdBy: this.userId,
      updatedBy: this.userId,
    }));
    const savedSteps = await manager.save(ProcessStepEntity, entities);

    const validStepNos = steps.map((step) => Number(step.stepNo));
    const placeholders = validStepNos.map(() => '?').join(', ');
    await manager.query(
      `DELETE FROM process_step_materials
       WHERE tenant_id = ? AND template_id = ? AND step_no NOT IN (${placeholders})`,
      [this.tenantId, templateId, ...validStepNos],
    );

    return savedSteps;
  }

  private async deleteTemplateArtifacts(manager: any, templateId: number): Promise<void> {
    const steps = await manager.find(ProcessStepEntity, {
      where: { tenantId: this.tenantId, templateId },
    });
    const stepIds = steps.map((step: ProcessStepEntity) => Number(step.id)).filter((id: number) => id > 0);
    if (stepIds.length > 0) {
      const placeholders = stepIds.map(() => '?').join(', ');
      await manager.query(
        `DELETE FROM process_wages WHERE tenant_id = ? AND step_id IN (${placeholders})`,
        [this.tenantId, ...stepIds],
      );
    }
    await manager.delete(ProcessStepMaterialEntity, { tenantId: this.tenantId, templateId });
    await manager.delete(ProcessStepEntity, { tenantId: this.tenantId, templateId });
  }

  private async syncTemplateWagesFromBase(manager: any, baseTemplateId: number, targetTemplateId: number): Promise<void> {
    const rows = await manager.query(
      `SELECT ps.step_no AS stepNo, pw.worker_grade AS workerGrade, pw.unit_price AS unitPrice
       FROM process_wages pw
       INNER JOIN process_steps ps ON ps.id = pw.step_id
       WHERE pw.tenant_id = ? AND ps.tenant_id = ? AND ps.template_id = ?`,
      [this.tenantId, this.tenantId, baseTemplateId],
    ) as Array<{
      stepNo: number;
      workerGrade: 'skilled' | 'apprentice';
      unitPrice: string;
    }>;

    const targetSteps = await manager.find(ProcessStepEntity, {
      where: { tenantId: this.tenantId, templateId: targetTemplateId },
      order: { stepNo: 'ASC' },
    }) as ProcessStepEntity[];
    const targetStepByNo = new Map(targetSteps.map((step: ProcessStepEntity) => [Number(step.stepNo), step]));

    const wages: ProcessWageEntity[] = rows
      .map((row) => {
        const targetStep = targetStepByNo.get(Number(row.stepNo));
        if (!targetStep) return null;
        return manager.create(ProcessWageEntity, {
          tenantId: this.tenantId,
          stepId: Number(targetStep.id),
          workerGrade: row.workerGrade,
          unitPrice: row.unitPrice,
          createdBy: this.userId,
          updatedBy: this.userId,
        });
      })
      .filter((item): item is ProcessWageEntity => Boolean(item));

    if (wages.length > 0) {
      await manager.save(ProcessWageEntity, wages);
    }
  }

  private async syncVariantTemplateFromBase(templateId: number, baseTemplateId: number): Promise<void> {
    await AppDataSource.transaction(async (manager) => {
      const baseSteps = await manager.find(ProcessStepEntity, {
        where: { tenantId: this.tenantId, templateId: baseTemplateId },
        order: { stepNo: 'ASC' },
      });
      const existingVariantSteps = await manager.find(ProcessStepEntity, {
        where: { tenantId: this.tenantId, templateId },
        order: { stepNo: 'ASC' },
      });
      const outputOverrideByStepNo = new Map(existingVariantSteps.map((step: ProcessStepEntity) => [
        Number(step.stepNo),
        { outputType: step.outputType, outputSkuId: step.outputSkuId },
      ]));

      const merged = baseSteps.map((baseStep: ProcessStepEntity) => {
        const outputOverride = outputOverrideByStepNo.get(Number(baseStep.stepNo));
        return {
          ...this.buildNormalizedStepsFromEntities([baseStep])[0],
          outputType: outputOverride?.outputType ?? (baseStep.outputType ?? 'none'),
          outputSkuId: (outputOverride?.outputType ?? baseStep.outputType ?? 'none') === 'none'
            ? null
            : (outputOverride?.outputSkuId ?? baseStep.outputSkuId ?? null),
        } satisfies ProcessStepInput;
      });

      await this.replaceTemplateSteps(manager, templateId, merged);
      await this.syncTemplateWagesFromBase(manager, baseTemplateId, templateId);
    });
  }

  private async syncDerivedTemplatesFromBase(baseTemplateId: number): Promise<void> {
    const variants = await AppDataSource.getRepository(ProcessTemplateEntity).find({
      where: { tenantId: this.tenantId, baseTemplateId },
      order: { id: 'ASC' },
    });
    for (const variant of variants) {
      await this.syncVariantTemplateFromBase(Number(variant.id), baseTemplateId);
    }
  }

  private async normalizeSteps(
    steps: ProcessStepInput[],
    options: { allowUnboundFinalOutput?: boolean } = {},
  ): Promise<ProcessStepInput[]> {
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
      if (outputType !== 'none' && !outputSkuId && !(options.allowUnboundFinalOutput && outputType === 'final_product')) {
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
