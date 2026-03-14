import { AppDataSource } from '../../config/database';
import { SkuCategoryEntity, CategoryTreeNode } from './skuCategory.entity';
import { AppError } from '../../shared/AppError';
import { ResponseCode } from '../../shared/ApiResponse';

// ─── 业务错误码扩展（8xxx SKU类目模块）───────────────────────────────────────
// ResponseCode 中尚未定义类目专用码，暂借用 CONFLICT / FORBIDDEN 通用码。
// 后续可在 ApiResponse.ts 中添加 8xxx 区间。

export interface CreateCategoryParams {
  level: 1 | 2;
  parentId: number | null;
  code: string;
  name: string;
  sortOrder?: number;
  remark?: string;
}

export interface UpdateCategoryParams {
  name?: string;
  sortOrder?: number;
  isActive?: boolean;
  remark?: string;
}

export interface DeletePreviewResult {
  childCount: number;
  skuCount: number;
}

export class SkuCategoryService {
  private readonly tenantId: number;
  private readonly userId: number;

  constructor(ctx: { tenantId: number; userId: number }) {
    this.tenantId = ctx.tenantId;
    this.userId = ctx.userId;
  }

  // ───────────────────────────────── 查询 ──────────────────────────────────

  /**
   * 获取完整类目树（系统预置 + 租户自定义）
   * 支持 level 过滤、parentId 过滤、是否包含已停用
   */
  async getTree(opts: {
    level?: 1 | 2;
    parentId?: number;
    includeInactive?: boolean;
  }): Promise<CategoryTreeNode[]> {
    const conditions: string[] = [
      '(tenant_id = 0 OR tenant_id = ?)',
    ];
    const params: unknown[] = [this.tenantId];

    if (!opts.includeInactive) {
      conditions.push('is_active = 1');
    }
    if (opts.level) {
      conditions.push('level = ?');
      params.push(opts.level);
    }
    if (opts.parentId !== undefined) {
      conditions.push('parent_id = ?');
      params.push(opts.parentId);
    }

    const rows = await AppDataSource.query<SkuCategoryEntity[]>(
      `SELECT id, tenant_id AS tenantId, level, parent_id AS parentId,
              code, name, sort_order AS sortOrder,
              is_active AS isActive, remark, created_at AS createdAt
       FROM sku_categories
       WHERE ${conditions.join(' AND ')}
       ORDER BY sort_order ASC, id ASC`,
      params,
    );

    // R01-BE-01: 批量查询各类目关联 SKU 数量（category1_id 或 category2_id 匹配）
    const categoryIds = rows.map((r) => Number(r.id));
    const skuCountMap = new Map<number, number>();
    if (categoryIds.length > 0) {
      try {
        const placeholders = categoryIds.map(() => '?').join(',');
        const skuCountRows = await AppDataSource.query<Array<{ categoryId: number; cnt: number }>>(
          `SELECT category_id AS categoryId, SUM(cnt) AS cnt FROM (
             SELECT category1_id AS category_id, COUNT(*) AS cnt
             FROM skus
             WHERE tenant_id = ? AND category1_id IN (${placeholders})
             GROUP BY category1_id
             UNION ALL
             SELECT category2_id AS category_id, COUNT(*) AS cnt
             FROM skus
             WHERE tenant_id = ? AND category2_id IN (${placeholders})
             GROUP BY category2_id
           ) t
           GROUP BY category_id`,
          [this.tenantId, ...categoryIds, this.tenantId, ...categoryIds],
        );
        for (const row of skuCountRows) {
          skuCountMap.set(Number(row.categoryId), Number(row.cnt));
        }
      } catch {
        // skus 表不存在时静默降级，skuCount 默认 0
      }
    }

    const nodes: CategoryTreeNode[] = rows.map((r) => ({
      id: Number(r.id),
      tenantId: Number(r.tenantId),
      level: r.level,
      parentId: r.parentId ? Number(r.parentId) : null,
      code: r.code,
      name: r.name,
      sortOrder: Number(r.sortOrder),
      isActive: Boolean(r.isActive),
      isSystem: Number(r.tenantId) === 0,
      remark: r.remark ?? null,
      skuCount: skuCountMap.get(Number(r.id)) ?? 0,
      createdAt: r.createdAt,
    }));

    // 如果仅请求二级类目，直接返回平铺列表
    if (opts.level === 2 || opts.parentId !== undefined) {
      return nodes;
    }

    // 构建树形结构
    return this.buildTree(nodes);
  }

  private buildTree(nodes: CategoryTreeNode[]): CategoryTreeNode[] {
    const level1 = nodes.filter((n) => n.level === 1);
    const level2 = nodes.filter((n) => n.level === 2);

    for (const parent of level1) {
      parent.children = level2.filter((c) => c.parentId === parent.id);
    }

    return level1;
  }

  // ───────────────────────────────── 新增 ──────────────────────────────────

  async create(params: CreateCategoryParams): Promise<SkuCategoryEntity> {
    const repo = AppDataSource.getRepository(SkuCategoryEntity);

    // level=2 时校验父类目存在且属于当前租户可见范围
    if (params.level === 2) {
      if (!params.parentId) {
        throw AppError.badRequest('二级类目必须指定 parentId');
      }
      const parent = await this.findVisibleById(params.parentId);
      if (!parent) {
        throw AppError.notFound('父类目不存在');
      }
      if (parent.level !== 1) {
        throw AppError.badRequest('parentId 必须指向一级类目');
      }
    }

    if (params.level === 1 && params.parentId !== null) {
      throw AppError.badRequest('一级类目的 parentId 必须为 null');
    }

    // code 唯一性已由数据库 uk_tenant_level_code 约束兜底，
    // 这里提前查询给出友好错误信息，避免 DB 级 ER_DUP_ENTRY。
    const existing = await AppDataSource.query<Array<{ cnt: number }>>(
      `SELECT COUNT(*) AS cnt
       FROM sku_categories
       WHERE (tenant_id = 0 OR tenant_id = ?) AND level = ? AND code = ?
       LIMIT 1`,
      [this.tenantId, params.level, params.code],
    );
    if (Number(existing[0]?.cnt ?? 0) > 0) {
      throw AppError.conflict(`编码 "${params.code}" 在当前级别下已存在`);
    }

    // 同名校验（同一租户同级别下名称不重复）
    const dupName = await AppDataSource.query<Array<{ cnt: number }>>(
      `SELECT COUNT(*) AS cnt
       FROM sku_categories
       WHERE tenant_id = ? AND level = ? AND name = ?
         AND parent_id ${params.parentId ? '= ?' : 'IS NULL'}
         AND is_active = 1
       LIMIT 1`,
      params.parentId
        ? [this.tenantId, params.level, params.name, params.parentId]
        : [this.tenantId, params.level, params.name],
    );
    if (Number(dupName[0]?.cnt ?? 0) > 0) {
      throw AppError.conflict('该类目名称已存在');
    }

    const entity = repo.create({
      tenantId: this.tenantId,
      level: params.level,
      parentId: params.parentId,
      code: params.code.toUpperCase(),
      name: params.name,
      sortOrder: params.sortOrder ?? 0,
      isActive: true,
      remark: params.remark ?? null,
      createdBy: this.userId,
      updatedBy: this.userId,
    });

    return repo.save(entity);
  }

  // ───────────────────────────────── 修改 ──────────────────────────────────

  async update(id: number, params: UpdateCategoryParams): Promise<SkuCategoryEntity> {
    const category = await this.findTenantOwnedById(id);

    if (params.name !== undefined) {
      // 同名校验（排除自身）
      const dupName = await AppDataSource.query<Array<{ cnt: number }>>(
        `SELECT COUNT(*) AS cnt
         FROM sku_categories
         WHERE tenant_id = ? AND level = ? AND name = ?
           AND parent_id ${category.parentId ? '= ?' : 'IS NULL'}
           AND id != ?
           AND is_active = 1
         LIMIT 1`,
        category.parentId
          ? [this.tenantId, category.level, params.name, category.parentId, id]
          : [this.tenantId, category.level, params.name, id],
      );
      if (Number(dupName[0]?.cnt ?? 0) > 0) {
        throw AppError.conflict('该类目名称已存在');
      }
      category.name = params.name;
    }

    if (params.sortOrder !== undefined) category.sortOrder = params.sortOrder;
    if (params.isActive !== undefined) category.isActive = params.isActive;
    if (params.remark !== undefined) category.remark = params.remark;
    category.updatedBy = this.userId;

    return AppDataSource.getRepository(SkuCategoryEntity).save(category);
  }

  // ───────────────────────────────── 删除预检 ──────────────────────────────

  /**
   * 删除前预检：返回关联子类目数和关联 SKU 数，供前端展示确认弹窗文案
   */
  async deletePreview(id: number): Promise<DeletePreviewResult> {
    await this.findTenantOwnedById(id);

    const [childRows, skuRows] = await Promise.all([
      AppDataSource.query<Array<{ cnt: number }>>(
        `SELECT COUNT(*) AS cnt
         FROM sku_categories
         WHERE (tenant_id = 0 OR tenant_id = ?) AND parent_id = ? AND is_active = 1`,
        [this.tenantId, id],
      ),
      AppDataSource.query<Array<{ cnt: number }>>(
        `SELECT COUNT(*) AS cnt
         FROM skus
         WHERE tenant_id = ? AND (category1_id = ? OR category2_id = ?)`,
        [this.tenantId, id, id],
      ),
    ]);

    return {
      childCount: Number(childRows[0]?.cnt ?? 0),
      skuCount: Number(skuRows[0]?.cnt ?? 0),
    };
  }

  // ───────────────────────────────── 删除（P0-R01-01 级联删除）────────────

  /**
   * 级联删除：
   *   1. 软删除该类目本身（is_active = 0）
   *   2. 如果是一级类目，同时软删除所有子二级类目
   *   3. 关联 SKU 的 category1_id / category2_id 置 NULL
   *
   * 以上操作在同一数据库事务中执行，保证原子性。
   */
  async delete(id: number): Promise<void> {
    const category = await this.findTenantOwnedById(id);

    await AppDataSource.transaction(async (manager) => {
      const now = new Date();
      const updatedBy = this.userId;

      // 1. 收集本次要删除的所有类目 ID（含子类目）
      const deleteIds: number[] = [id];

      if (category.level === 1) {
        // 查找所有活跃子二级类目（含系统预置的子类目不在此处，因为不可见；
        // 但实际上系统预置类目的子类目 tenant_id 也是 0，不会被级联到——
        // 此处只操作当前租户的子类目）
        const children = await manager.query<Array<{ id: number }>>(
          `SELECT id FROM sku_categories
           WHERE tenant_id = ? AND parent_id = ? AND is_active = 1`,
          [this.tenantId, id],
        );
        children.forEach((c) => deleteIds.push(Number(c.id)));
      }

      // 2. 软删除所有目标类目
      if (deleteIds.length > 0) {
        const placeholders = deleteIds.map(() => '?').join(',');
        await manager.query(
          `UPDATE sku_categories
           SET is_active = 0, updated_by = ?, updated_at = CURRENT_TIMESTAMP(3)
           WHERE tenant_id = ? AND id IN (${placeholders})`,
          [updatedBy, this.tenantId, ...deleteIds],
        );
      }

      // 3. 关联 SKU 的 category 字段置 NULL（P0-R01-01 修正项）
      // category1_id 置 NULL（当删除的是一级类目）
      // category2_id 置 NULL（当删除的是任意类目 ID）
      if (category.level === 1) {
        await manager.query(
          `UPDATE skus
           SET category1_id = NULL, updated_by = ?, updated_at = CURRENT_TIMESTAMP(3)
           WHERE tenant_id = ? AND category1_id = ?`,
          [updatedBy, this.tenantId, id],
        );
      }

      // 无论一级还是二级，将 category2_id 引用的全部 deleteIds 置 NULL
      if (deleteIds.length > 0) {
        const placeholders = deleteIds.map(() => '?').join(',');
        await manager.query(
          `UPDATE skus
           SET category2_id = NULL, updated_by = ?, updated_at = CURRENT_TIMESTAMP(3)
           WHERE tenant_id = ? AND category2_id IN (${placeholders})`,
          [updatedBy, this.tenantId, ...deleteIds],
        );
      }
    });
  }

  // ───────────────────────── BE-01-02: 审计日志 ────────────────────────────

  /**
   * 从 sku_categories 表推断操作类型作为简易审计日志。
   * 推断规则：
   *   add    - created_at = updated_at（创建后未变更）
   *   edit   - updated_at > created_at AND is_active = 1
   *   delete - is_active = 0
   */
  async getAuditLogs(filter: {
    type?: 'add' | 'edit' | 'delete';
    from?: string;
    to?: string;
  }): Promise<Array<{
    id: number;
    type: 'add' | 'edit' | 'delete';
    categoryName: string;
    operator: number;
    timestamp: string;
    detail: string;
  }>> {
    const conditions: string[] = [
      '(tenant_id = 0 OR tenant_id = ?)',
    ];
    const params: unknown[] = [this.tenantId];

    // 日期范围过滤（以 updated_at 为基准）
    if (filter.from) {
      conditions.push('updated_at >= ?');
      params.push(`${filter.from} 00:00:00`);
    }
    if (filter.to) {
      conditions.push('updated_at <= ?');
      params.push(`${filter.to} 23:59:59`);
    }

    // 操作类型过滤（转换为 SQL 条件）
    if (filter.type === 'add') {
      conditions.push('(ABS(TIMESTAMPDIFF(SECOND, created_at, updated_at)) <= 1)');
    } else if (filter.type === 'edit') {
      conditions.push('(TIMESTAMPDIFF(SECOND, created_at, updated_at) > 1 AND is_active = 1)');
    } else if (filter.type === 'delete') {
      conditions.push('is_active = 0');
    }

    const rows = await AppDataSource.query<Array<{
      id: number;
      name: string;
      is_active: number;
      updated_by: number;
      created_at: string;
      updated_at: string;
    }>>(
      `SELECT id, name, is_active, updated_by, created_at, updated_at
       FROM sku_categories
       WHERE ${conditions.join(' AND ')}
       ORDER BY updated_at DESC
       LIMIT 200`,
      params,
    );

    return rows.map((r) => {
      let type: 'add' | 'edit' | 'delete';
      const diffSeconds = Math.abs(
        new Date(r.updated_at).getTime() - new Date(r.created_at).getTime(),
      ) / 1000;

      if (Number(r.is_active) === 0) {
        type = 'delete';
      } else if (diffSeconds <= 1) {
        type = 'add';
      } else {
        type = 'edit';
      }

      const typeLabel: Record<string, string> = {
        add: '新增类目',
        edit: '修改类目',
        delete: '删除类目',
      };

      return {
        id: Number(r.id),
        type,
        categoryName: r.name,
        operator: Number(r.updated_by),
        timestamp: r.updated_at,
        detail: `${typeLabel[type]}：${r.name}`,
      };
    });
  }

  // ───────────────────────── BE-01-03: 拖拽重排 ────────────────────────────

  /**
   * 批量更新类目 sort_order（拖拽重排）。
   * 在事务中执行，校验所有 ID 均属于当前租户。
   */
  async reorder(orders: Array<{ id: number; sortOrder: number }>): Promise<void> {
    const ids = orders.map((o) => o.id);
    const placeholders = ids.map(() => '?').join(',');

    // 一次性校验所有 ID 的归属
    const owned = await AppDataSource.query<Array<{ id: number }>>(
      `SELECT id FROM sku_categories
       WHERE tenant_id = ? AND id IN (${placeholders}) AND is_active = 1`,
      [this.tenantId, ...ids],
    );
    const ownedIds = new Set(owned.map((r) => Number(r.id)));
    const invalid = ids.filter((id) => !ownedIds.has(id));
    if (invalid.length > 0) {
      throw AppError.forbidden(`以下类目 ID 无操作权限或不存在：${invalid.join(', ')}`);
    }

    await AppDataSource.transaction(async (manager) => {
      for (const item of orders) {
        await manager.query(
          `UPDATE sku_categories
           SET sort_order = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP(3)
           WHERE id = ? AND tenant_id = ?`,
          [item.sortOrder, this.userId, item.id, this.tenantId],
        );
      }
    });
  }

  // ───────────────────────────────── 私有辅助 ──────────────────────────────

  /**
   * 查找当前租户可见的类目（含系统预置）
   */
  private async findVisibleById(id: number): Promise<SkuCategoryEntity | null> {
    const rows = await AppDataSource.query<SkuCategoryEntity[]>(
      `SELECT * FROM sku_categories
       WHERE id = ? AND (tenant_id = 0 OR tenant_id = ?)
       LIMIT 1`,
      [id, this.tenantId],
    );
    return rows[0] ?? null;
  }

  /**
   * 查找当前租户「自有」类目（tenant_id = 当前租户，非系统预置）
   * 对系统预置类目抛 403。
   */
  private async findTenantOwnedById(id: number): Promise<SkuCategoryEntity> {
    const rows = await AppDataSource.query<SkuCategoryEntity[]>(
      `SELECT * FROM sku_categories
       WHERE id = ? AND is_active = 1
       LIMIT 1`,
      [id],
    );
    const category = rows[0];

    if (!category) {
      throw AppError.notFound('类目不存在');
    }

    // 系统预置：tenant_id = 0
    if (Number(category.tenantId) === 0) {
      throw AppError.forbidden('系统预置类目不允许修改或删除');
    }

    // 跨租户保护
    if (Number(category.tenantId) !== this.tenantId) {
      throw AppError.forbidden('无权操作该类目');
    }

    return category;
  }
}
