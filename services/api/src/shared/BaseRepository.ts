import { DataSource, EntityManager, FindManyOptions, FindOneOptions, ObjectLiteral, Repository } from 'typeorm';
import { AppDataSource } from '../config/database';

/**
 * 租户上下文接口
 */
export interface TenantContext {
  tenantId: number;
  userId: number;
}

/**
 * 基础仓储 — 自动注入 tenant_id 过滤
 *
 * 所有业务仓储继承此类，确保多租户行级隔离。
 * 核心规则：每个查询/写入均携带 tenant_id，杜绝跨租户数据泄漏。
 */
export abstract class BaseRepository<T extends ObjectLiteral> {
  protected readonly repo: Repository<T>;
  protected readonly tenantContext: TenantContext;

  constructor(
    entityClass: new () => T,
    tenantContext: TenantContext,
    dataSource: DataSource = AppDataSource,
  ) {
    this.repo = dataSource.getRepository(entityClass);
    this.tenantContext = tenantContext;
  }

  get tenantId(): number {
    return this.tenantContext.tenantId;
  }

  get currentUserId(): number {
    return this.tenantContext.userId;
  }

  /**
   * 查询单条记录，自动附加 tenant_id
   */
  protected async findOneByTenant(options: FindOneOptions<T>): Promise<T | null> {
    return this.repo.findOne({
      ...options,
      where: {
        ...(options.where as object),
        tenant_id: this.tenantId,
      } as unknown as FindOneOptions<T>['where'],
    });
  }

  /**
   * 查询列表，自动附加 tenant_id
   */
  protected async findManyByTenant(options: FindManyOptions<T> = {}): Promise<T[]> {
    return this.repo.find({
      ...options,
      where: {
        ...(options.where as object),
        tenant_id: this.tenantId,
      } as unknown as FindManyOptions<T>['where'],
    });
  }

  /**
   * 计数，自动附加 tenant_id
   */
  protected async countByTenant(where: Partial<T> = {}): Promise<number> {
    return this.repo.count({
      where: { ...where, tenant_id: this.tenantId } as unknown as FindManyOptions<T>['where'],
    });
  }

  /**
   * 插入数据，自动注入 tenant_id / created_by / updated_by
   */
  protected buildInsertData(data: Partial<T>): Partial<T> {
    return {
      ...data,
      tenant_id: this.tenantId,
      created_by: this.currentUserId,
      updated_by: this.currentUserId,
    };
  }

  /**
   * 更新数据，自动注入 updated_by
   */
  protected buildUpdateData(data: Partial<T>): Partial<T> {
    return {
      ...data,
      updated_by: this.currentUserId,
    };
  }

  /**
   * 使用事务管理器执行操作（需要跨表事务时使用）
   */
  protected async withTransaction<R>(
    fn: (manager: EntityManager) => Promise<R>,
  ): Promise<R> {
    return AppDataSource.transaction(fn);
  }

  /**
   * 分页查询（返回 [list, total]）
   */
  protected async findAndCountByTenant(
    options: FindManyOptions<T> = {},
  ): Promise<[T[], number]> {
    return this.repo.findAndCount({
      ...options,
      where: {
        ...(options.where as object),
        tenant_id: this.tenantId,
      } as unknown as FindManyOptions<T>['where'],
    });
  }
}
