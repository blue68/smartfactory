/**
 * [artifact:前端代码] — 权限控制模块类型定义
 */

import type { PaginationParams, PaginatedData } from './api';

export interface DataScopeItem {
  scopeType: string;
  scopeValues: Array<number | string>;
}

export interface PermissionSnapshot {
  version: string;
  scopeLevel: 'platform' | 'tenant';
  originTenantId: number;
  contextTenantId: number | null;
  menuCodes: string[];
  actionCodes: string[];
  dataScopes: DataScopeItem[];
  featureFlags: string[];
}

export interface TenantSummary {
  id: number;
  code: string;
  name: string;
  status: 'active' | 'suspended' | 'cancelled' | 'inactive';
  packageType?: string;
  featureCount?: number;
  defaultAdminName?: string | null;
  expiresAt?: string | null;
  updatedAt?: string;
}

export interface TenantMutationPayload {
  code: string;
  name: string;
  status?: string;
  defaultAdmin?: {
    username: string;
    realName: string;
    initialPassword?: string;
  };
}

export interface TenantFeatureFlagItem {
  id: number;
  tenantId: number;
  featureCode: string;
  featureName?: string | null;
  isEnabled?: boolean | number;
  sourceType?: string | null;
  expiresAt?: string | null;
  remark?: string | null;
  updatedAt?: string | null;
}

export interface TenantFeatureFlagsPayload {
  flags: Array<{
    featureCode: string;
    featureName?: string | null;
    isEnabled?: boolean;
    sourceType?: string;
    expiresAt?: string | null;
    remark?: string | null;
  }>;
}

export type TenantPayload = TenantMutationPayload;

export interface AccessControlListQuery extends PaginationParams {
  keyword?: string;
  status?: string;
}

export interface TenantListQuery extends AccessControlListQuery {
  packageType?: string;
}

export interface MenuTreeNode {
  id: number;
  tenantId: number;
  parentId: number | null;
  code: string;
  name: string;
  routePath?: string | null;
  menuType?: 'group' | 'module' | 'page';
  groupName?: string | null;
  icon?: string | null;
  sortOrder?: number;
  status?: string;
  isSystem?: boolean;
  children?: MenuTreeNode[];
}

export interface MenuMutationPayload {
  tenantId?: number;
  parentId?: number | null;
  menuType?: 'group' | 'module' | 'page';
  code: string;
  name: string;
  routePath?: string | null;
  icon?: string | null;
  groupName?: string | null;
  sortOrder?: number;
  status?: string;
  defaultVisible?: boolean;
}

export type MenuPayload = MenuMutationPayload;

export interface ActionItem {
  id: number;
  tenantId: number;
  menuId: number;
  code: string;
  name: string;
  actionType: string;
  status: string;
  defaultEnabled?: boolean;
}

export interface ActionMutationPayload {
  tenantId?: number;
  menuId: number;
  code: string;
  name: string;
  actionType?: string;
  status?: string;
  defaultEnabled?: boolean;
}

export type ActionPayload = ActionMutationPayload;

export interface RoleSummary {
  id: number;
  tenantId: number;
  code: string;
  name: string;
  description?: string | null;
  roleType?: 'system' | 'custom';
  status?: 'active' | 'inactive';
  priority?: number;
  assignable?: boolean | number;
  dataScopeTemplate?: string | null;
  assignedUserCount?: number;
  updatedAt?: string;
}

export interface RoleMutationPayload {
  tenantId?: number;
  code: string;
  name: string;
  description?: string | null;
  priority?: number;
  status?: string;
  dataScopeTemplate?: string;
  assignable?: boolean;
}

export type RolePayload = RoleMutationPayload;

export interface RoleListQuery extends AccessControlListQuery {
  roleType?: 'system' | 'custom' | '';
}

export interface AccessUserSummary {
  id: number;
  tenantId: number;
  username: string;
  realName: string;
  phone?: string | null;
  email?: string | null;
  departmentId?: number | null;
  department?: string | null;
  position?: string | null;
  status?: 'active' | 'inactive' | 'locked';
  roleCount?: number;
  primaryRoleName?: string | null;
  updatedAt?: string;
}

export interface UserMutationPayload {
  tenantId?: number;
  username: string;
  realName: string;
  departmentId?: number | null;
  position?: string | null;
  initialPassword?: string;
  status?: string;
}

export type AccessUserPayload = UserMutationPayload;

export interface AccessUserListQuery extends AccessControlListQuery {
  roleId?: number;
  department?: string;
}

export interface RolePermissionDetail {
  roleId: number;
  roleCode: string;
  roleName: string;
  menuCodes: string[];
  actionCodes: string[];
  dataScopes: DataScopeItem[];
  updatedAt?: string;
}

export interface RolePermissionUpdatePayload {
  menuCodes?: string[];
  actionCodes?: string[];
  dataScopes?: DataScopeItem[];
}

export interface UserRoleAssignment {
  id: number;
  userId: number;
  roleId: number;
  roleCode: string;
  roleName: string;
  isPrimary?: boolean;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  assignmentStatus?: string;
}

export interface UserRoleAssignmentsPayload {
  assignments: Array<{
    roleId: number;
    isPrimary?: boolean;
    effectiveFrom?: string | null;
    effectiveTo?: string | null;
  }>;
}

export type UserRoleAssignmentPayload = UserRoleAssignmentsPayload;

export interface StatusPayload {
  status: string;
}

export interface ResetPasswordPayload {
  newPassword?: string;
}

export interface AccessAuditLogItem {
  id: number;
  tenantId: number;
  module: string;
  action: string;
  targetType: string;
  targetId?: number | null;
  targetCode?: string | null;
  beforeJson?: Record<string, unknown> | null;
  afterJson?: Record<string, unknown> | null;
  diffJson?: Record<string, unknown> | null;
  operatorId?: number | null;
  operatorName?: string | null;
  traceId?: string | null;
  createdAt?: string;
}

export interface AccessAuditLogQuery extends AccessControlListQuery {
  tenantId?: number;
  module?: string;
  targetType?: string;
  operatorId?: number;
  dateFrom?: string;
  dateTo?: string;
}

export type TenantListData = PaginatedData<TenantSummary>;
export type RoleListData = PaginatedData<RoleSummary>;
export type AccessUserListData = PaginatedData<AccessUserSummary>;
export type AccessAuditLogListData = PaginatedData<AccessAuditLogItem>;
