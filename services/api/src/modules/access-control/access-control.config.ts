import type { AccessScopeLevel, PermissionSnapshot } from './access-control.types';

export type { AccessScopeLevel, PermissionSnapshot } from './access-control.types';

interface SnapshotContextOptions {
  scopeLevel?: AccessScopeLevel;
  originTenantId?: number;
  contextTenantId?: number | null;
}

export interface PermissionMenuSeed {
  id: number;
  tenantId: number;
  parentId: number | null;
  menuType: 'group' | 'module' | 'page';
  code: string;
  name: string;
  routePath: string | null;
  icon: string | null;
  groupName: string | null;
  sortOrder: number;
  status: 'active' | 'inactive';
  isSystem: boolean;
}

export interface PermissionActionSeed {
  id: number;
  tenantId: number;
  menuId: number;
  code: string;
  name: string;
  actionType: 'view' | 'create' | 'edit' | 'delete' | 'approve' | 'export' | 'print' | 'convert' | 'custom';
  status: 'active' | 'inactive';
  defaultEnabled: boolean;
}

const TENANT_RBAC_MENU_CODES = [
  'system.management',
  'system.menu.config',
  'system.role.config',
  'system.user.config',
  'system.role.permission.config',
  'system.user.role.assignment',
] as const;

const TENANT_RBAC_ACTION_CODES = [
  'system.menu.manage',
  'system.role.manage',
  'system.user.manage',
  'system.role.grant',
  'system.user.assign',
  'system.audit.view',
] as const;

const SYSTEM_MENU_SEEDS: PermissionMenuSeed[] = [
  {
    id: 9001001,
    tenantId: 0,
    parentId: null,
    menuType: 'group',
    code: 'system.management',
    name: '系统管理',
    routePath: null,
    icon: 'setting',
    groupName: '系统管理',
    sortOrder: 900,
    status: 'active',
    isSystem: true,
  },
  {
    id: 9001101,
    tenantId: 0,
    parentId: 9001001,
    menuType: 'page',
    code: 'system.tenant.config',
    name: '租户配置',
    routePath: '/system/tenants',
    icon: 'apartment',
    groupName: '平台治理',
    sortOrder: 10,
    status: 'active',
    isSystem: true,
  },
  {
    id: 9001102,
    tenantId: 0,
    parentId: 9001001,
    menuType: 'page',
    code: 'system.menu.config',
    name: '菜单与功能',
    routePath: '/system/menus',
    icon: 'menu',
    groupName: '平台治理',
    sortOrder: 20,
    status: 'active',
    isSystem: true,
  },
  {
    id: 9001103,
    tenantId: 0,
    parentId: 9001001,
    menuType: 'page',
    code: 'system.role.config',
    name: '角色配置',
    routePath: '/system/roles',
    icon: 'team',
    groupName: '组织权限',
    sortOrder: 30,
    status: 'active',
    isSystem: true,
  },
  {
    id: 9001104,
    tenantId: 0,
    parentId: 9001001,
    menuType: 'page',
    code: 'system.user.config',
    name: '人员配置',
    routePath: '/system/users',
    icon: 'user',
    groupName: '人员管理',
    sortOrder: 40,
    status: 'active',
    isSystem: true,
  },
  {
    id: 9001105,
    tenantId: 0,
    parentId: 9001001,
    menuType: 'page',
    code: 'system.role.permission.config',
    name: '角色授权',
    routePath: '/system/role-permissions',
    icon: 'safety',
    groupName: '授权中心',
    sortOrder: 50,
    status: 'active',
    isSystem: true,
  },
  {
    id: 9001106,
    tenantId: 0,
    parentId: 9001001,
    menuType: 'page',
    code: 'system.user.role.assignment',
    name: '人员角色分配',
    routePath: '/system/user-role-assignments',
    icon: 'idcard',
    groupName: '授权中心',
    sortOrder: 60,
    status: 'active',
    isSystem: true,
  },
];

const SYSTEM_ACTION_SEEDS: PermissionActionSeed[] = [
  { id: 9011001, tenantId: 0, menuId: 9001101, code: 'system.tenant.manage', name: '租户管理', actionType: 'custom', status: 'active', defaultEnabled: true },
  { id: 9011002, tenantId: 0, menuId: 9001102, code: 'system.menu.manage', name: '菜单管理', actionType: 'custom', status: 'active', defaultEnabled: true },
  { id: 9011003, tenantId: 0, menuId: 9001103, code: 'system.role.manage', name: '角色管理', actionType: 'custom', status: 'active', defaultEnabled: true },
  { id: 9011004, tenantId: 0, menuId: 9001104, code: 'system.user.manage', name: '人员管理', actionType: 'custom', status: 'active', defaultEnabled: true },
  { id: 9011005, tenantId: 0, menuId: 9001105, code: 'system.role.grant', name: '角色授权', actionType: 'custom', status: 'active', defaultEnabled: true },
  { id: 9011006, tenantId: 0, menuId: 9001106, code: 'system.user.assign', name: '人员角色分配', actionType: 'custom', status: 'active', defaultEnabled: true },
  { id: 9011007, tenantId: 0, menuId: 9001001, code: 'system.audit.view', name: '权限审计查看', actionType: 'custom', status: 'active', defaultEnabled: true },
  { id: 9011008, tenantId: 0, menuId: 9001101, code: 'platform.tenant.switch', name: '切换租户上下文', actionType: 'custom', status: 'active', defaultEnabled: true },
];

const ROLE_PERMISSION_GRANTS: Record<
  string,
  {
    menuCodes: string[];
    actionCodes: string[];
    dataScopes?: Array<{ scopeType: string; scopeValues: Array<number | string> }>;
    featureFlags?: string[];
  }
> = {
  admin: {
    menuCodes: [...TENANT_RBAC_MENU_CODES],
    actionCodes: [...TENANT_RBAC_ACTION_CODES],
    dataScopes: [{ scopeType: 'all', scopeValues: [] }],
    featureFlags: ['rbac_center', 'tenant_admin'],
  },
  boss: {
    menuCodes: [...TENANT_RBAC_MENU_CODES],
    actionCodes: [...TENANT_RBAC_ACTION_CODES],
    dataScopes: [{ scopeType: 'all', scopeValues: [] }],
    featureFlags: ['rbac_center', 'tenant_admin'],
  },
  supervisor: {
    menuCodes: [
      'system.management',
      'system.role.config',
      'system.user.config',
      'system.role.permission.config',
      'system.user.role.assignment',
    ],
    actionCodes: [
      'system.role.manage',
      'system.user.manage',
      'system.role.grant',
      'system.user.assign',
    ],
    dataScopes: [{ scopeType: 'department', scopeValues: [] }],
    featureFlags: ['rbac_center'],
  },
};

function uniq<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

export function getSystemMenuSeeds(): PermissionMenuSeed[] {
  return SYSTEM_MENU_SEEDS.map((item) => ({ ...item }));
}

export function getSystemActionSeeds(): PermissionActionSeed[] {
  return SYSTEM_ACTION_SEEDS.map((item) => ({ ...item }));
}

function buildPlatformSuperAdminGrant(scopeLevel: AccessScopeLevel) {
  if (scopeLevel === 'platform') {
    return {
      menuCodes: ['system.management', 'system.tenant.config'],
      actionCodes: ['system.tenant.manage', 'platform.tenant.switch', 'system.audit.view'],
      dataScopes: [] as Array<{ scopeType: string; scopeValues: Array<number | string> }>,
      featureFlags: ['rbac_center', 'tenant_admin'],
    };
  }

  return {
    menuCodes: [...TENANT_RBAC_MENU_CODES],
    actionCodes: [...TENANT_RBAC_ACTION_CODES],
    dataScopes: [{ scopeType: 'all', scopeValues: [] }],
    featureFlags: ['rbac_center', 'tenant_admin'],
  };
}

export function buildFallbackPermissionSnapshot(
  roleCodes: string[],
  options: SnapshotContextOptions = {},
): PermissionSnapshot {
  const scopeLevel = options.scopeLevel ?? 'tenant';
  const originTenantId = options.originTenantId ?? 0;
  const contextTenantId = options.contextTenantId ?? (scopeLevel === 'tenant' ? originTenantId : null);

  const grants = roleCodes.map((roleCode) => {
    if (roleCode === 'platform_super_admin') {
      return buildPlatformSuperAdminGrant(scopeLevel);
    }
    return ROLE_PERMISSION_GRANTS[roleCode];
  }).filter(Boolean);
  const dataScopes = grants.flatMap((grant) => grant.dataScopes ?? []);
  const featureFlags = grants.flatMap((grant) => grant.featureFlags ?? []);

  return {
    version: `fallback-${new Date().toISOString()}`,
    scopeLevel,
    originTenantId,
    contextTenantId,
    menuCodes: uniq(grants.flatMap((grant) => grant.menuCodes)),
    actionCodes: uniq(grants.flatMap((grant) => grant.actionCodes)),
    dataScopes,
    featureFlags: uniq(featureFlags),
  };
}

export function hasPermissionByRoles(roleCodes: string[], requiredPermissions: string[]): boolean {
  const snapshot = buildFallbackPermissionSnapshot(roleCodes);
  return requiredPermissions.some((permission) => snapshot.actionCodes.includes(permission));
}
