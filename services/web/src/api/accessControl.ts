/**
 * [artifact:接口联调代码] — 权限控制模块 API
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import request from '@/utils/request';
import type {
  ActionItem,
  ActionMutationPayload,
  AccessAuditLogListData,
  AccessAuditLogQuery,
  AccessUserListData,
  AccessUserListQuery,
  MenuMutationPayload,
  MenuTreeNode,
  ResetPasswordPayload,
  RoleListData,
  RoleListQuery,
  RoleMutationPayload,
  RolePermissionDetail,
  RolePermissionUpdatePayload,
  StatusPayload,
  TenantFeatureFlagItem,
  TenantFeatureFlagsPayload,
  TenantListData,
  TenantListQuery,
  TenantMutationPayload,
  UserMutationPayload,
  UserRoleAssignment,
  UserRoleAssignmentsPayload,
} from '@/types/accessControl';

const BASE = '/api/access-control';

export async function fetchTenantList(query: TenantListQuery): Promise<TenantListData> {
  return request.get<TenantListData>(`${BASE}/tenants`, query as Record<string, unknown>);
}

export async function fetchMenuTree(params?: {
  tenantId?: number;
  includeActions?: boolean;
  keyword?: string;
}): Promise<MenuTreeNode[]> {
  return request.get<MenuTreeNode[]>(`${BASE}/menus/tree`, (params ?? {}) as Record<string, unknown>);
}

export async function fetchMenuActions(menuId: number): Promise<ActionItem[]> {
  return request.get<ActionItem[]>(`${BASE}/menus/${menuId}/actions`);
}

export async function fetchRoleList(query: RoleListQuery): Promise<RoleListData> {
  return request.get<RoleListData>(`${BASE}/roles`, query as Record<string, unknown>);
}

export async function fetchAccessUserList(query: AccessUserListQuery): Promise<AccessUserListData> {
  return request.get<AccessUserListData>(`${BASE}/users`, query as Record<string, unknown>);
}

export async function fetchRolePermissionDetail(roleId: number): Promise<RolePermissionDetail> {
  return request.get<RolePermissionDetail>(`${BASE}/roles/${roleId}/permissions`);
}

export async function fetchUserRoleAssignments(userId: number): Promise<UserRoleAssignment[]> {
  return request.get<UserRoleAssignment[]>(`${BASE}/users/${userId}/role-assignments`);
}

export interface CreatedTenantResult {
  id: number;
  defaultAdminUserId?: number;
  defaultAdminUsername?: string;
  defaultAdminName?: string;
  defaultAdminPassword?: string;
  defaultAdminRoleCode?: string;
}

export async function createTenant(payload: TenantMutationPayload): Promise<CreatedTenantResult> {
  return request.post<CreatedTenantResult>(`${BASE}/tenants`, payload);
}

export async function updateTenant(id: number, payload: TenantMutationPayload): Promise<{ success: boolean }> {
  return request.put<{ success: boolean }>(`${BASE}/tenants/${id}`, payload);
}

export async function updateTenantStatus(id: number, payload: StatusPayload): Promise<{ success: boolean }> {
  return request.post<{ success: boolean }>(`${BASE}/tenants/${id}/status`, payload);
}

export async function fetchTenantFeatureFlags(id: number): Promise<TenantFeatureFlagItem[]> {
  return request.get<TenantFeatureFlagItem[]>(`${BASE}/tenants/${id}/feature-flags`);
}

export async function updateTenantFeatureFlags(id: number, payload: TenantFeatureFlagsPayload): Promise<{ success: boolean }> {
  return request.put<{ success: boolean }>(`${BASE}/tenants/${id}/feature-flags`, payload);
}

export async function createMenu(payload: MenuMutationPayload): Promise<{ id: number }> {
  return request.post<{ id: number }>(`${BASE}/menus`, payload);
}

export async function updateMenu(id: number, payload: MenuMutationPayload): Promise<{ success: boolean }> {
  return request.put<{ success: boolean }>(`${BASE}/menus/${id}`, payload);
}

export async function deleteMenu(id: number): Promise<{ success: boolean }> {
  return request.delete<{ success: boolean }>(`${BASE}/menus/${id}`);
}

export async function createAction(payload: ActionMutationPayload): Promise<{ id: number }> {
  return request.post<{ id: number }>(`${BASE}/actions`, payload);
}

export async function updateAction(id: number, payload: Omit<ActionMutationPayload, 'tenantId' | 'menuId'>): Promise<{ success: boolean }> {
  return request.put<{ success: boolean }>(`${BASE}/actions/${id}`, payload);
}

export async function deleteAction(id: number): Promise<{ success: boolean }> {
  return request.delete<{ success: boolean }>(`${BASE}/actions/${id}`);
}

export async function createRole(payload: RoleMutationPayload): Promise<{ id: number }> {
  return request.post<{ id: number }>(`${BASE}/roles`, payload);
}

export async function updateRole(id: number, payload: RoleMutationPayload): Promise<{ success: boolean }> {
  return request.put<{ success: boolean }>(`${BASE}/roles/${id}`, payload);
}

export async function updateRoleStatus(id: number, payload: StatusPayload): Promise<{ success: boolean }> {
  return request.post<{ success: boolean }>(`${BASE}/roles/${id}/status`, payload);
}

export async function createUser(payload: UserMutationPayload): Promise<{ id: number }> {
  return request.post<{ id: number }>(`${BASE}/users`, payload);
}

export async function updateUser(id: number, payload: Omit<UserMutationPayload, 'tenantId' | 'initialPassword'>): Promise<{ success: boolean }> {
  return request.put<{ success: boolean }>(`${BASE}/users/${id}`, payload);
}

export async function updateUserStatus(id: number, payload: StatusPayload): Promise<{ success: boolean }> {
  return request.post<{ success: boolean }>(`${BASE}/users/${id}/status`, payload);
}

export async function resetUserPassword(id: number, payload?: ResetPasswordPayload): Promise<{ success: boolean }> {
  return request.post<{ success: boolean }>(`${BASE}/users/${id}/reset-password`, payload ?? {});
}

export async function updateRolePermissions(
  roleId: number,
  payload: RolePermissionUpdatePayload,
): Promise<{ success: boolean }> {
  return request.put<{ success: boolean }>(`${BASE}/roles/${roleId}/permissions`, payload);
}

export async function assignUserRoles(
  userId: number,
  payload: UserRoleAssignmentsPayload,
): Promise<{ success: boolean }> {
  return request.put<{ success: boolean }>(`${BASE}/users/${userId}/role-assignments`, payload);
}

export async function fetchAccessAuditLogs(query: AccessAuditLogQuery): Promise<AccessAuditLogListData> {
  return request.get<AccessAuditLogListData>(`${BASE}/audit-logs`, query as Record<string, unknown>);
}

export function useTenantList(query: TenantListQuery) {
  return useQuery({
    queryKey: ['access-control', 'tenants', query],
    queryFn: () => fetchTenantList(query),
  });
}

export function useMenuTree(params?: { tenantId?: number; includeActions?: boolean; keyword?: string }) {
  return useQuery({
    queryKey: ['access-control', 'menus', 'tree', params ?? {}],
    queryFn: () => fetchMenuTree(params),
  });
}

export function useMenuActions(menuId: number | null) {
  return useQuery({
    queryKey: ['access-control', 'menus', menuId, 'actions'],
    queryFn: () => fetchMenuActions(menuId!),
    enabled: menuId !== null,
  });
}

export function useRoleList(query: RoleListQuery) {
  return useQuery({
    queryKey: ['access-control', 'roles', query],
    queryFn: () => fetchRoleList(query),
  });
}

export function useAccessUserList(query: AccessUserListQuery) {
  return useQuery({
    queryKey: ['access-control', 'users', query],
    queryFn: () => fetchAccessUserList(query),
  });
}

export function useRolePermissionDetail(roleId: number | null) {
  return useQuery({
    queryKey: ['access-control', 'roles', roleId, 'permissions'],
    queryFn: () => fetchRolePermissionDetail(roleId!),
    enabled: roleId !== null,
  });
}

export function useTenantFeatureFlags(tenantId: number | null) {
  return useQuery({
    queryKey: ['access-control', 'tenants', tenantId, 'feature-flags'],
    queryFn: () => fetchTenantFeatureFlags(tenantId!),
    enabled: tenantId !== null,
  });
}

export function useUserRoleAssignments(userId: number | null) {
  return useQuery({
    queryKey: ['access-control', 'users', userId, 'role-assignments'],
    queryFn: () => fetchUserRoleAssignments(userId!),
    enabled: userId !== null,
  });
}

export function useAccessAuditLogs(query: AccessAuditLogQuery) {
  return useQuery({
    queryKey: ['access-control', 'audit-logs', query],
    queryFn: () => fetchAccessAuditLogs(query),
  });
}

function invalidateSystemQueries(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['access-control', 'tenants'] });
  qc.invalidateQueries({ queryKey: ['access-control', 'menus'] });
  qc.invalidateQueries({ queryKey: ['access-control', 'roles'] });
  qc.invalidateQueries({ queryKey: ['access-control', 'users'] });
}

export function useCreateTenant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createTenant,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['access-control', 'tenants'] }),
  });
}

export function useUpdateTenant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: TenantMutationPayload }) => updateTenant(id, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['access-control', 'tenants'] }),
  });
}

export function useUpdateTenantStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: StatusPayload }) => updateTenantStatus(id, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['access-control', 'tenants'] }),
  });
}

export function useUpdateTenantFeatureFlags() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: TenantFeatureFlagsPayload }) => updateTenantFeatureFlags(id, payload),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['access-control', 'tenants'] });
      qc.invalidateQueries({ queryKey: ['access-control', 'tenants', vars.id, 'feature-flags'] });
    },
  });
}

export function useCreateMenu() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createMenu,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['access-control', 'menus'] }),
  });
}

export function useUpdateMenu() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: MenuMutationPayload }) => updateMenu(id, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['access-control', 'menus'] }),
  });
}

export function useDeleteMenu() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteMenu,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['access-control', 'menus'] }),
  });
}

export function useCreateAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createAction,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['access-control', 'menus'] }),
  });
}

export function useUpdateAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Omit<ActionMutationPayload, 'tenantId' | 'menuId'> }) => updateAction(id, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['access-control', 'menus'] }),
  });
}

export function useDeleteAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteAction,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['access-control', 'menus'] }),
  });
}

export function useCreateRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createRole,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['access-control', 'roles'] }),
  });
}

export function useUpdateRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: RoleMutationPayload }) => updateRole(id, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['access-control', 'roles'] }),
  });
}

export function useUpdateRoleStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: StatusPayload }) => updateRoleStatus(id, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['access-control', 'roles'] }),
  });
}

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createUser,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['access-control', 'users'] }),
  });
}

export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Omit<UserMutationPayload, 'tenantId' | 'initialPassword'> }) => updateUser(id, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['access-control', 'users'] }),
  });
}

export function useUpdateUserStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: StatusPayload }) => updateUserStatus(id, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['access-control', 'users'] }),
  });
}

export function useResetUserPassword() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload?: ResetPasswordPayload }) => resetUserPassword(id, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['access-control', 'users'] }),
  });
}

export function useUpdateRolePermissions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ roleId, payload }: { roleId: number; payload: RolePermissionUpdatePayload }) =>
      updateRolePermissions(roleId, payload),
    onSuccess: (_data, vars) => {
      invalidateSystemQueries(qc);
      qc.invalidateQueries({ queryKey: ['access-control', 'roles', vars.roleId, 'permissions'] });
    },
  });
}

export function useAssignUserRoles() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, payload }: { userId: number; payload: UserRoleAssignmentsPayload }) =>
      assignUserRoles(userId, payload),
    onSuccess: (_data, vars) => {
      invalidateSystemQueries(qc);
      qc.invalidateQueries({ queryKey: ['access-control', 'users', vars.userId, 'role-assignments'] });
    },
  });
}
