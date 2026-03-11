import { AppDataSource } from '../../config/database';
import { ProcessTemplateEntity, ProcessStepEntity } from './processConfig.entity';
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
}
