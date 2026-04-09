import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import RoleConfigPage from '@/pages/system/RoleConfigPage';
import RoleGrantPage from '@/pages/system/RoleGrantPage';
import TenantConfigPage from '@/pages/system/TenantConfigPage';
import UserRoleAssignmentPage from '@/pages/system/UserRoleAssignmentPage';

const mocks = vi.hoisted(() => ({
  useRoleList: vi.fn(),
  useCreateRole: vi.fn(),
  useUpdateRole: vi.fn(),
  useUpdateRoleStatus: vi.fn(),
  useMenuTree: vi.fn(),
  useMenuActions: vi.fn(),
  useRolePermissionDetail: vi.fn(),
  useUpdateRolePermissions: vi.fn(),
  useTenantList: vi.fn(),
  useTenantFeatureFlags: vi.fn(),
  useCreateTenant: vi.fn(),
  useUpdateTenant: vi.fn(),
  useUpdateTenantFeatureFlags: vi.fn(),
  useUpdateTenantStatus: vi.fn(),
  useAccessUserList: vi.fn(),
  useUserRoleAssignments: vi.fn(),
  useAssignUserRoles: vi.fn(),
  setPageTitle: vi.fn(),
  showToast: vi.fn(),
  createRoleMutateAsync: vi.fn(),
  updateRoleMutateAsync: vi.fn(),
  updateRoleStatusMutateAsync: vi.fn(),
  updateRolePermissionsMutateAsync: vi.fn(),
  createTenantMutateAsync: vi.fn(),
  updateTenantMutateAsync: vi.fn(),
  updateTenantFeatureFlagsMutateAsync: vi.fn(),
  updateTenantStatusMutateAsync: vi.fn(),
  assignUserRolesMutateAsync: vi.fn(),
}));

vi.mock('@/api/accessControl', () => ({
  useRoleList: mocks.useRoleList,
  useCreateRole: mocks.useCreateRole,
  useUpdateRole: mocks.useUpdateRole,
  useUpdateRoleStatus: mocks.useUpdateRoleStatus,
  useMenuTree: mocks.useMenuTree,
  useMenuActions: mocks.useMenuActions,
  useRolePermissionDetail: mocks.useRolePermissionDetail,
  useUpdateRolePermissions: mocks.useUpdateRolePermissions,
  useTenantList: mocks.useTenantList,
  useTenantFeatureFlags: mocks.useTenantFeatureFlags,
  useCreateTenant: mocks.useCreateTenant,
  useUpdateTenant: mocks.useUpdateTenant,
  useUpdateTenantFeatureFlags: mocks.useUpdateTenantFeatureFlags,
  useUpdateTenantStatus: mocks.useUpdateTenantStatus,
  useAccessUserList: mocks.useAccessUserList,
  useUserRoleAssignments: mocks.useUserRoleAssignments,
  useAssignUserRoles: mocks.useAssignUserRoles,
}));

vi.mock('@/stores/appStore', () => ({
  useAppStore: (selector: (state: { setPageTitle: typeof mocks.setPageTitle; showToast: typeof mocks.showToast }) => unknown) => selector({
    setPageTitle: mocks.setPageTitle,
    showToast: mocks.showToast,
  }),
}));

function renderWithRouter(ui: ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('Access control system pages', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    const roleListData = {
      list: [
        {
          id: 1,
          tenantId: 0,
          code: 'boss',
          name: '老板',
          roleType: 'system',
          status: 'active',
          dataScopeTemplate: 'all',
          assignable: true,
          assignedUserCount: 3,
        },
        {
          id: 2,
          tenantId: 9,
          code: 'custom_admin',
          name: '租户管理员',
          roleType: 'custom',
          status: 'active',
          dataScopeTemplate: 'department',
          assignable: true,
          assignedUserCount: 2,
        },
      ],
      total: 2,
      page: 1,
      pageSize: 30,
      totalPages: 1,
    };

    const menuTreeData = [
      {
        id: 100,
        tenantId: 0,
        parentId: null,
        code: 'ai.module',
        name: 'AI',
        routePath: null,
        children: [
          {
            id: 102,
            tenantId: 0,
            parentId: 100,
            code: 'ai.chat',
            name: 'AI 助手',
            routePath: '/ai-chat',
            children: [],
          },
        ],
      },
      {
        id: 101,
        tenantId: 0,
        parentId: null,
        code: 'system.role.config',
        name: '角色配置',
        routePath: '/system/roles',
        children: [],
      },
    ];

    const rolePermissionDetails = new Map([
      [1, {
        roleId: 1,
        roleCode: 'boss',
        roleName: '老板',
        menuCodes: ['system.role.config'],
        actionCodes: ['system.role.manage'],
        dataScopes: [{ scopeType: 'all', scopeValues: [] }],
      }],
      [2, {
        roleId: 2,
        roleCode: 'custom_admin',
        roleName: '租户管理员',
        menuCodes: ['system.role.config'],
        actionCodes: ['system.role.manage'],
        dataScopes: [{ scopeType: 'department', scopeValues: [1, 2] }],
      }],
    ]);

    const menuActionsData = [
      {
        id: 1001,
        tenantId: 0,
        menuId: 101,
        code: 'system.role.manage',
        name: '角色管理',
        actionType: 'custom',
        status: 'active',
      },
      {
        id: 1002,
        tenantId: 0,
        menuId: 102,
        code: 'ai:chat:view',
        name: '使用 AI 助手',
        actionType: 'view',
        status: 'active',
      },
    ];

    const tenantListData = {
      list: [
        {
          id: 9,
          code: 'FACTORY001',
          name: '演示租户',
          status: 'active',
          packageType: 'pro',
          defaultAdminName: '管理员',
          expiresAt: '2026-12-31',
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    };

    const tenantFeatureFlags = [
      {
        id: 1,
        tenantId: 9,
        featureCode: 'rbac_center',
        featureName: '权限中心',
        isEnabled: true,
        sourceType: 'manual',
        expiresAt: null,
        remark: null,
      },
    ];

    const accessUserListData = {
      list: [
        {
          id: 21,
          tenantId: 9,
          username: 'qc_user',
          realName: '验货员',
          status: 'active',
          roleCount: 1,
          primaryRoleName: '租户管理员',
        },
      ],
      total: 1,
      page: 1,
      pageSize: 100,
      totalPages: 1,
    };

    const userAssignments = [
      {
        id: 501,
        userId: 21,
        roleId: 2,
        roleCode: 'custom_admin',
        roleName: '租户管理员',
        isPrimary: true,
        effectiveFrom: '2026-04-01',
        effectiveTo: '2026-12-31',
        assignmentStatus: 'active',
      },
    ];

    const emptyAssignments: never[] = [];

    mocks.useCreateRole.mockReturnValue({ mutateAsync: mocks.createRoleMutateAsync, isPending: false });
    mocks.useUpdateRole.mockReturnValue({ mutateAsync: mocks.updateRoleMutateAsync, isPending: false });
    mocks.useUpdateRoleStatus.mockReturnValue({ mutateAsync: mocks.updateRoleStatusMutateAsync, isPending: false });
    mocks.useUpdateRolePermissions.mockReturnValue({ mutateAsync: mocks.updateRolePermissionsMutateAsync, isPending: false });
    mocks.useCreateTenant.mockReturnValue({ mutateAsync: mocks.createTenantMutateAsync, isPending: false });
    mocks.useUpdateTenant.mockReturnValue({ mutateAsync: mocks.updateTenantMutateAsync, isPending: false });
    mocks.useUpdateTenantFeatureFlags.mockReturnValue({ mutateAsync: mocks.updateTenantFeatureFlagsMutateAsync, isPending: false });
    mocks.useUpdateTenantStatus.mockReturnValue({ mutateAsync: mocks.updateTenantStatusMutateAsync, isPending: false });
    mocks.useAssignUserRoles.mockReturnValue({ mutateAsync: mocks.assignUserRolesMutateAsync, isPending: false });

    mocks.useRoleList.mockReturnValue({ data: roleListData, isLoading: false, error: null });
    mocks.useMenuTree.mockReturnValue({ data: menuTreeData, isLoading: false, error: null });
    mocks.useRolePermissionDetail.mockImplementation((roleId: number | null) => ({
      data: roleId ? rolePermissionDetails.get(roleId) : undefined,
      isLoading: false,
      error: null,
    }));
    mocks.useMenuActions.mockReturnValue({ data: menuActionsData, isLoading: false, error: null });
    mocks.useTenantList.mockReturnValue({ data: tenantListData, isLoading: false, error: null });
    mocks.useTenantFeatureFlags.mockReturnValue({ data: tenantFeatureFlags, isLoading: false, error: null });
    mocks.useAccessUserList.mockReturnValue({ data: accessUserListData, isLoading: false, error: null });
    mocks.useUserRoleAssignments.mockImplementation((userId: number | null) => ({
      data: userId === 21 ? userAssignments : emptyAssignments,
      isLoading: false,
      error: null,
    }));
  });

  it('RoleConfigPage shows empty state when role list is empty', () => {
    mocks.useRoleList.mockReturnValue({
      data: { list: [], total: 0, page: 1, pageSize: 30, totalPages: 0 },
      isLoading: false,
      error: null,
    });

    render(<RoleConfigPage />);

    expect(screen.getByText('暂无角色数据。')).toBeInTheDocument();
    expect(screen.getByText('角色总数')).toBeInTheDocument();
  });

  it('RoleConfigPage marks system roles as read-only and hides edit/disable actions in that row', () => {
    render(<RoleConfigPage />);

    const bossRow = screen.getByText('boss').closest('tr');
    expect(bossRow).not.toBeNull();
    expect(within(bossRow!).getAllByText('系统预置')).toHaveLength(2);
    expect(within(bossRow!).queryByRole('button', { name: '编辑' })).not.toBeInTheDocument();
    expect(within(bossRow!).queryByRole('button', { name: '停用' })).not.toBeInTheDocument();
  });

  it('RoleGrantPage renders 403-style role list error state', () => {
    mocks.useRoleList.mockReturnValue({ data: undefined, isLoading: false, error: new Error('403 Forbidden') });

    render(<RoleGrantPage />);

    expect(screen.getByText('角色加载失败：403 Forbidden')).toBeInTheDocument();
  });

  it('RoleGrantPage shows warning and disables save for system roles', () => {
    render(<RoleGrantPage />);

    expect(screen.getByText('当前为系统预置角色，仅支持查看授权明细，不允许直接保存修改。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存授权' })).toBeDisabled();
  });

  it('RoleGrantPage lists business menus from the online permission catalog', () => {
    render(<RoleGrantPage />);

    expect(screen.getByText('AI 助手')).toBeInTheDocument();
  });

  it('RoleGrantPage warns when trying to save a system preset role', async () => {
    render(<RoleGrantPage />);

    const saveButton = screen.getByRole('button', { name: '保存授权' });
    expect(saveButton).toBeDisabled();

    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(mocks.showToast).not.toHaveBeenCalled();
    });
  });

  it('TenantConfigPage shows empty state when tenant list is empty', () => {
    mocks.useTenantList.mockReturnValue({
      data: { list: [], total: 0, page: 1, pageSize: 20, totalPages: 0 },
      isLoading: false,
      error: null,
    });

    renderWithRouter(<TenantConfigPage />);

    expect(screen.getByText('暂无租户数据。')).toBeInTheDocument();
  });

  it('TenantConfigPage renders 403-style list error state', () => {
    mocks.useTenantList.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('403 Forbidden'),
    });

    renderWithRouter(<TenantConfigPage />);

    expect(screen.getByText('租户加载失败：403 Forbidden')).toBeInTheDocument();
  });

  it('TenantConfigPage shows validation warning when saving empty tenant form', async () => {
    renderWithRouter(<TenantConfigPage />);

    fireEvent.click(screen.getByRole('button', { name: '+ 新建租户' }));
    fireEvent.click(screen.getByRole('button', { name: '创建租户' }));

    await waitFor(() => {
      expect(mocks.showToast).toHaveBeenCalledWith({
        type: 'warning',
        message: '请填写租户编码和租户名称',
      });
    });
  });

  it('UserRoleAssignmentPage shows empty state when user list is empty', () => {
    mocks.useAccessUserList.mockReturnValue({
      data: { list: [], total: 0, page: 1, pageSize: 100, totalPages: 0 },
      isLoading: false,
      error: null,
    });

    render(<UserRoleAssignmentPage />);

    expect(screen.getByText('暂无人员数据。')).toBeInTheDocument();
  });

  it('UserRoleAssignmentPage renders assignment error state for 403 responses', () => {
    mocks.useUserRoleAssignments.mockReturnValue({
      data: [],
      isLoading: false,
      error: new Error('403 Forbidden'),
    });

    render(<UserRoleAssignmentPage />);

    expect(screen.getByText('角色分配加载失败：403 Forbidden')).toBeInTheDocument();
  });

  it('UserRoleAssignmentPage warns when saving without any selected roles', async () => {
    mocks.useUserRoleAssignments.mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
    });

    render(<UserRoleAssignmentPage />);

    fireEvent.click(screen.getByRole('button', { name: '保存分配' }));

    await waitFor(() => {
      expect(mocks.showToast).toHaveBeenCalledWith({
        type: 'warning',
        message: '请至少选择一个角色',
      });
    });
  });

  it('UserRoleAssignmentPage warns when effective date is later than expiry date', async () => {
    render(<UserRoleAssignmentPage />);

    const dateInputs = screen.getAllByDisplayValue(/2026-/);
    fireEvent.change(dateInputs[0], { target: { value: '2026-12-31' } });
    fireEvent.change(dateInputs[1], { target: { value: '2026-04-01' } });
    fireEvent.click(screen.getByRole('button', { name: '保存分配' }));

    await waitFor(() => {
      expect(mocks.showToast).toHaveBeenCalledWith({
        type: 'warning',
        message: '生效日期不能晚于失效日期',
      });
    });
  });
});
