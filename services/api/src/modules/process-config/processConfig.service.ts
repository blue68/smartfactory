import { AppDataSource } from '../../config/database';
import { ProcessTemplateEntity, ProcessStepEntity } from './processConfig.entity';
import { ProcessWageEntity } from './processWage.entity';
import { AppError } from '../../shared/AppError';

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
  }>;
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
      const stepEntities = params.steps.map((s) =>
        stepRepo.create({
          tenantId: this.tenantId,
          templateId: saved.id,
          stepNo: s.stepNo,
          stepName: s.stepName,
          standardHours: s.standardHours?.toString() ?? null,
          workstationType: s.workstationType ?? null,
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
      const stepEntities = params.steps.map((s) =>
        stepRepo.create({
          tenantId: this.tenantId,
          templateId: id,
          stepNo: s.stepNo,
          stepName: s.stepName,
          standardHours: s.standardHours?.toString() ?? null,
          workstationType: s.workstationType ?? null,
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
      'pt.tenant_id = ?',
      'ps.template_id = ?',
    ];
    const params: unknown[] = [this.tenantId, templateId];

    if (filter.from) {
      conditions.push('pt.task_date >= ?');
      params.push(filter.from);
    }
    if (filter.to) {
      conditions.push('pt.task_date <= ?');
      params.push(filter.to);
    }
    if (filter.workerIds && filter.workerIds.length > 0) {
      const ph = filter.workerIds.map(() => '?').join(',');
      conditions.push(`pt.worker_id IN (${ph})`);
      params.push(...filter.workerIds);
    }
    if (filter.grade) {
      conditions.push('u.worker_grade = ?');
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
    }>>(
      `SELECT
         u.id            AS userId,
         u.real_name     AS userName,
         u.worker_grade  AS workerGrade,
         ps.id           AS stepId,
         ps.step_name    AS stepName,
         SUM(pt.completed_qty) AS completedQty,
         pw.unit_price   AS unitPrice
       FROM production_tasks pt
       INNER JOIN process_steps ps ON ps.id = pt.process_step_id
       INNER JOIN users u ON u.id = pt.worker_id
       LEFT JOIN process_wages pw
         ON pw.step_id = ps.id
         AND pw.tenant_id = pt.tenant_id
         AND pw.worker_grade = u.worker_grade
       WHERE ${conditions.join(' AND ')}
         AND pt.status = 'completed'
       GROUP BY u.id, u.real_name, u.worker_grade, ps.id, ps.step_name, pw.unit_price
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
      const subtotal = Math.round(qty * price * 100) / 100;

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
}
