import { Request, Response } from 'express';
import { z } from 'zod';
import { SkuCategoryService } from './skuCategory.service';
import { success, created } from '../../shared/ApiResponse';
import { AppError } from '../../shared/AppError';

// ─── 请求校验 Schema ───────────────────────────────────────────────────────

const GetTreeQuerySchema = z.object({
  level: z.coerce.number().int().min(1).max(2).optional() as z.ZodOptional<z.ZodNumber>,
  parentId: z.coerce.number().int().positive().optional(),
  includeInactive: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  editableView: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

const CreateCategorySchema = z.object({
  level: z.union([z.literal(1), z.literal(2)]),
  parentId: z.number().int().positive().nullable().default(null),
  code: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[A-Z0-9_]+$/, 'code 只允许大写字母、数字、下划线'),
  name: z.string().min(1).max(100),
  sortOrder: z.number().int().min(0).max(9999).default(0),
  remark: z.string().max(200).optional(),
});

const UpdateCategorySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
  isActive: z.boolean().optional(),
  remark: z.string().max(200).optional(),
}).refine(
  (v) => Object.keys(v).length > 0,
  { message: '请求体不能为空' },
);

// BE-01-02: 审计日志查询 Schema
const AuditLogsQuerySchema = z.object({
  type: z.enum(['create', 'update', 'delete', 'add', 'edit']).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

// BE-01-03: 重排 Schema
const ReorderSchema = z.object({
  orders: z.array(
    z.object({
      id: z.number().int().positive(),
      sortOrder: z.number().int().min(0).max(9999),
    }),
  ).min(1),
});

// ─── Controller ────────────────────────────────────────────────────────────

export class SkuCategoryController {
  private svc(req: Request): SkuCategoryService {
    return new SkuCategoryService({
      tenantId: req.tenantId,
      userId: req.userId,
    });
  }

  /**
   * GET /api/sku-categories
   * 获取类目树。
   * editableView=true 时，租户管理视图仅返回：
   *   - 系统一级类目
   *   - 当前租户的二级类目
   */
  async getTree(req: Request, res: Response): Promise<void> {
    const q = GetTreeQuerySchema.parse(req.query);
    const tree = await this.svc(req).getTree({
      level: q.level as 1 | 2 | undefined,
      parentId: q.parentId,
      includeInactive: q.includeInactive,
      editableView: q.editableView,
    });
    success(res, tree);
  }

  /**
   * POST /api/sku-categories
   * 新增类目（仅租户自定义）
   */
  async create(req: Request, res: Response): Promise<void> {
    const body = CreateCategorySchema.parse(req.body);
    const category = await this.svc(req).create(body);
    created(res, category, '类目已创建');
  }

  /**
   * PUT /api/sku-categories/:id
   * 修改类目（名称、排序、启用状态）
   * 系统预置类目（tenant_id=0）禁止修改，Service 层抛 403
   */
  async update(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      throw AppError.badRequest('无效的类目 ID');
    }
    const body = UpdateCategorySchema.parse(req.body);
    const category = await this.svc(req).update(id, body);
    success(res, category, '类目已更新');
  }

  /**
   * GET /api/sku-categories/:id/delete-preview
   * 删除前预检：返回关联子类目数 + 关联 SKU 数
   * 前端据此决定是否展示二次确认弹窗及其文案
   */
  async deletePreview(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      throw AppError.badRequest('无效的类目 ID');
    }
    const preview = await this.svc(req).deletePreview(id);
    success(res, preview);
  }

  /**
   * DELETE /api/sku-categories/:id
   * 级联软删除：
   *   - 软删除该类目及所有子二级类目
   *   - 关联 SKU 的 category1_id / category2_id 置 NULL
   * 系统预置类目禁止删除，Service 层抛 403
   */
  async delete(req: Request, res: Response): Promise<void> {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      throw AppError.badRequest('无效的类目 ID');
    }
    await this.svc(req).delete(id);
    success(res, null, '类目已删除');
  }

  /**
   * GET /api/sku-categories/audit-logs
   * BE-01-02: 查询类目变更审计日志
   * 通过 created_at / updated_at / is_active 推断操作类型：
   *   add    - created_at = updated_at（新增后未修改）
   *   edit   - updated_at > created_at AND is_active = 1
   *   delete - is_active = 0
   */
  async getAuditLogs(req: Request, res: Response): Promise<void> {
    const q = AuditLogsQuerySchema.parse(req.query);
    // Normalize frontend type values (create→add, update→edit) to service layer values
    const typeMap: Record<string, 'add' | 'edit' | 'delete'> = {
      create: 'add', add: 'add',
      update: 'edit', edit: 'edit',
      delete: 'delete',
    };
    const logs = await this.svc(req).getAuditLogs({
      type: q.type ? typeMap[q.type] : undefined,
      from: q.from,
      to: q.to,
    });
    success(res, logs);
  }

  /**
   * PATCH /api/sku-categories/reorder
   * BE-01-03: 批量更新类目排序（拖拽重排）
   */
  async reorder(req: Request, res: Response): Promise<void> {
    const { orders } = ReorderSchema.parse(req.body);
    await this.svc(req).reorder(orders);
    success(res, null, '排序已更新');
  }
}

export const skuCategoryController = new SkuCategoryController();
