import { Request, Response } from 'express';
import { z } from 'zod';
import { created, success } from '../../shared/ApiResponse';
import { validate } from '../../middleware/validator';
import { accessControlService } from './access-control.service';

const ListQuerySchema = z.object({
  page: z.coerce.number().optional(),
  pageSize: z.coerce.number().optional(),
  keyword: z.string().optional(),
  status: z.string().optional(),
});

const AuditLogsQuerySchema = ListQuerySchema.extend({
  tenantId: z.coerce.number().optional(),
  module: z.string().optional(),
  targetType: z.string().optional(),
  operatorId: z.coerce.number().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
});

const CreateTenantSchema = z.object({
  code: z.string().min(1, '租户编码不能为空'),
  name: z.string().min(1, '租户名称不能为空'),
  status: z.string().optional(),
});

const UpdateTenantStatusSchema = z.object({
  status: z.string().min(1, '状态不能为空'),
});

const TenantFeatureFlagsSchema = z.object({
  flags: z.array(z.object({
    featureCode: z.string().min(1, '功能编码不能为空'),
    featureName: z.string().nullable().optional(),
    isEnabled: z.boolean().optional(),
    sourceType: z.string().optional(),
    expiresAt: z.string().nullable().optional(),
    remark: z.string().nullable().optional(),
  })),
});

const MenuSchema = z.object({
  tenantId: z.number().optional(),
  parentId: z.number().nullable().optional(),
  menuType: z.enum(['group', 'module', 'page']).optional(),
  code: z.string().min(1, '菜单编码不能为空'),
  name: z.string().min(1, '菜单名称不能为空'),
  routePath: z.string().nullable().optional(),
  icon: z.string().nullable().optional(),
  groupName: z.string().nullable().optional(),
  sortOrder: z.number().optional(),
  status: z.string().optional(),
  defaultVisible: z.boolean().optional(),
});

const ActionSchema = z.object({
  tenantId: z.number().optional(),
  menuId: z.number(),
  code: z.string().min(1, '功能编码不能为空'),
  name: z.string().min(1, '功能名称不能为空'),
  actionType: z.string().optional(),
  status: z.string().optional(),
  defaultEnabled: z.boolean().optional(),
});
const UpdateActionSchema = ActionSchema.omit({ tenantId: true, menuId: true });

const RoleSchema = z.object({
  tenantId: z.number().optional(),
  code: z.string().min(1, '角色编码不能为空'),
  name: z.string().min(1, '角色名称不能为空'),
  description: z.string().nullable().optional(),
  priority: z.number().optional(),
  status: z.string().optional(),
  dataScopeTemplate: z.string().optional(),
  assignable: z.boolean().optional(),
});

const UserSchema = z.object({
  tenantId: z.number().optional(),
  username: z.string().min(1, '账号不能为空'),
  realName: z.string().min(1, '姓名不能为空'),
  initialPassword: z.string().optional(),
  status: z.string().optional(),
});

const ResetUserPasswordSchema = z.object({
  newPassword: z.string().optional(),
});

const UpdateRolePermissionsSchema = z.object({
  menuCodes: z.array(z.string()).optional(),
  actionCodes: z.array(z.string()).optional(),
  dataScopes: z.array(
    z.object({
      scopeType: z.string(),
      scopeValues: z.array(z.union([z.string(), z.number()])),
    }),
  ).optional(),
});

const AssignUserRolesSchema = z.object({
  assignments: z.array(
    z.object({
      roleId: z.number(),
      isPrimary: z.boolean().optional(),
      effectiveFrom: z.string().nullable().optional(),
      effectiveTo: z.string().nullable().optional(),
    }),
  ),
});

function getCtx(req: Request) {
  return {
    tenantId: req.tenantId,
    userId: req.userId,
    roles: req.user?.roles ?? [],
    originTenantId: req.originTenantId,
    contextTenantId: req.contextTenantId,
    scopeLevel: req.scopeLevel,
  };
}

export class AccessControlController {
  readonly listValidator = validate('query', ListQuerySchema);
  readonly createTenantValidator = validate('body', CreateTenantSchema);
  readonly updateTenantValidator = validate('body', CreateTenantSchema);
  readonly updateTenantStatusValidator = validate('body', UpdateTenantStatusSchema);
  readonly tenantFeatureFlagsValidator = validate('body', TenantFeatureFlagsSchema);
  readonly auditLogsValidator = validate('query', AuditLogsQuerySchema);
  readonly menuValidator = validate('body', MenuSchema);
  readonly actionValidator = validate('body', ActionSchema);
  readonly updateActionValidator = validate('body', UpdateActionSchema);
  readonly roleValidator = validate('body', RoleSchema);
  readonly userValidator = validate('body', UserSchema);
  readonly resetUserPasswordValidator = validate('body', ResetUserPasswordSchema);
  readonly updateRolePermissionsValidator = validate('body', UpdateRolePermissionsSchema);
  readonly assignUserRolesValidator = validate('body', AssignUserRolesSchema);

  async listTenants(req: Request, res: Response): Promise<void> {
    const data = await accessControlService.listTenants(getCtx(req), req.query as Record<string, string>);
    success(res, data);
  }

  async createTenant(req: Request, res: Response): Promise<void> {
    const data = await accessControlService.createTenant(getCtx(req), req.body);
    created(res, data);
  }

  async updateTenant(req: Request, res: Response): Promise<void> {
    const data = await accessControlService.updateTenant(getCtx(req), Number(req.params.id), req.body);
    success(res, data);
  }

  async updateTenantStatus(req: Request, res: Response): Promise<void> {
    const data = await accessControlService.updateTenantStatus(getCtx(req), Number(req.params.id), req.body);
    success(res, data);
  }

  async getTenantFeatureFlags(req: Request, res: Response): Promise<void> {
    const data = await accessControlService.getTenantFeatureFlags(getCtx(req), Number(req.params.id));
    success(res, data);
  }

  async updateTenantFeatureFlags(req: Request, res: Response): Promise<void> {
    const data = await accessControlService.updateTenantFeatureFlags(getCtx(req), Number(req.params.id), req.body);
    success(res, data);
  }

  async getMenuTree(req: Request, res: Response): Promise<void> {
    const data = await accessControlService.getMenuTree(getCtx(req), {
      tenantId: req.query.tenantId ? Number(req.query.tenantId) : undefined,
      keyword: req.query.keyword ? String(req.query.keyword) : undefined,
    });
    success(res, data);
  }

  async getMenuActions(req: Request, res: Response): Promise<void> {
    const data = await accessControlService.getMenuActions(getCtx(req), Number(req.params.id));
    success(res, data);
  }

  async createMenu(req: Request, res: Response): Promise<void> {
    const data = await accessControlService.createMenu(getCtx(req), req.body);
    created(res, data);
  }

  async updateMenu(req: Request, res: Response): Promise<void> {
    const data = await accessControlService.updateMenu(getCtx(req), Number(req.params.id), req.body);
    success(res, data);
  }

  async deleteMenu(req: Request, res: Response): Promise<void> {
    const data = await accessControlService.deleteMenu(getCtx(req), Number(req.params.id));
    success(res, data);
  }

  async createAction(req: Request, res: Response): Promise<void> {
    const data = await accessControlService.createAction(getCtx(req), req.body);
    created(res, data);
  }

  async updateAction(req: Request, res: Response): Promise<void> {
    const data = await accessControlService.updateAction(getCtx(req), Number(req.params.id), req.body);
    success(res, data);
  }

  async deleteAction(req: Request, res: Response): Promise<void> {
    const data = await accessControlService.deleteAction(getCtx(req), Number(req.params.id));
    success(res, data);
  }

  async listRoles(req: Request, res: Response): Promise<void> {
    const data = await accessControlService.listRoles(getCtx(req), {
      page: req.query.page ? Number(req.query.page) : undefined,
      pageSize: req.query.pageSize ? Number(req.query.pageSize) : undefined,
      keyword: req.query.keyword ? String(req.query.keyword) : undefined,
      status: req.query.status ? String(req.query.status) : undefined,
      roleType: req.query.roleType ? String(req.query.roleType) : undefined,
      tenantId: req.query.tenantId ? Number(req.query.tenantId) : undefined,
    });
    success(res, data);
  }

  async createRole(req: Request, res: Response): Promise<void> {
    const data = await accessControlService.createRole(getCtx(req), req.body);
    created(res, data);
  }

  async updateRole(req: Request, res: Response): Promise<void> {
    const data = await accessControlService.updateRole(getCtx(req), Number(req.params.id), req.body);
    success(res, data);
  }

  async updateRoleStatus(req: Request, res: Response): Promise<void> {
    const data = await accessControlService.updateRoleStatus(getCtx(req), Number(req.params.id), req.body);
    success(res, data);
  }

  async listUsers(req: Request, res: Response): Promise<void> {
    const data = await accessControlService.listUsers(getCtx(req), {
      page: req.query.page ? Number(req.query.page) : undefined,
      pageSize: req.query.pageSize ? Number(req.query.pageSize) : undefined,
      keyword: req.query.keyword ? String(req.query.keyword) : undefined,
      status: req.query.status ? String(req.query.status) : undefined,
      roleId: req.query.roleId ? Number(req.query.roleId) : undefined,
      tenantId: req.query.tenantId ? Number(req.query.tenantId) : undefined,
    });
    success(res, data);
  }

  async createUser(req: Request, res: Response): Promise<void> {
    const data = await accessControlService.createUser(getCtx(req), req.body);
    created(res, data);
  }

  async updateUser(req: Request, res: Response): Promise<void> {
    const data = await accessControlService.updateUser(getCtx(req), Number(req.params.id), req.body);
    success(res, data);
  }

  async updateUserStatus(req: Request, res: Response): Promise<void> {
    const data = await accessControlService.updateUserStatus(getCtx(req), Number(req.params.id), req.body);
    success(res, data);
  }

  async resetUserPassword(req: Request, res: Response): Promise<void> {
    const data = await accessControlService.resetUserPassword(getCtx(req), Number(req.params.id), req.body);
    success(res, data);
  }

  async getRolePermissions(req: Request, res: Response): Promise<void> {
    const data = await accessControlService.getRolePermissionDetail(getCtx(req), Number(req.params.id));
    success(res, data);
  }

  async updateRolePermissions(req: Request, res: Response): Promise<void> {
    const data = await accessControlService.updateRolePermissions(getCtx(req), Number(req.params.id), req.body);
    success(res, data);
  }

  async getUserRoleAssignments(req: Request, res: Response): Promise<void> {
    const data = await accessControlService.getUserRoleAssignments(getCtx(req), Number(req.params.id));
    success(res, data);
  }

  async assignUserRoles(req: Request, res: Response): Promise<void> {
    const data = await accessControlService.assignUserRoles(getCtx(req), Number(req.params.id), req.body);
    success(res, data);
  }

  async listAuditLogs(req: Request, res: Response): Promise<void> {
    const data = await accessControlService.listAuditLogs(getCtx(req), {
      page: req.query.page ? Number(req.query.page) : undefined,
      pageSize: req.query.pageSize ? Number(req.query.pageSize) : undefined,
      keyword: req.query.keyword ? String(req.query.keyword) : undefined,
      tenantId: req.query.tenantId ? Number(req.query.tenantId) : undefined,
      module: req.query.module ? String(req.query.module) : undefined,
      targetType: req.query.targetType ? String(req.query.targetType) : undefined,
      operatorId: req.query.operatorId ? Number(req.query.operatorId) : undefined,
      dateFrom: req.query.dateFrom ? String(req.query.dateFrom) : undefined,
      dateTo: req.query.dateTo ? String(req.query.dateTo) : undefined,
    });
    success(res, data);
  }
}

export const accessControlController = new AccessControlController();
