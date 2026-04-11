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

interface MenuSeedDefinition extends PermissionMenuSeed {
  roleCodes?: string[];
}

interface ActionSeedDefinition extends PermissionActionSeed {
  roleCodes?: string[];
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
] as const;

const SYSTEM_MENU_DEFINITIONS: MenuSeedDefinition[] = [
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
    roleCodes: ['admin', 'tenant_admin', 'boss', 'supervisor', 'platform_super_admin'],
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
    roleCodes: ['platform_super_admin'],
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
    roleCodes: ['admin', 'tenant_admin', 'boss', 'supervisor', 'platform_super_admin'],
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
    roleCodes: ['admin', 'tenant_admin', 'boss', 'supervisor', 'platform_super_admin'],
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
    roleCodes: ['admin', 'tenant_admin', 'boss', 'supervisor', 'platform_super_admin'],
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
    roleCodes: ['admin', 'tenant_admin', 'boss', 'supervisor', 'platform_super_admin'],
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
    roleCodes: ['admin', 'tenant_admin', 'boss', 'supervisor', 'platform_super_admin'],
  },
  {
    id: 9002001,
    tenantId: 0,
    parentId: null,
    menuType: 'group',
    code: 'overview.module',
    name: '概览',
    routePath: null,
    icon: 'dashboard',
    groupName: '概览',
    sortOrder: 10,
    status: 'active',
    isSystem: true,
    roleCodes: ['boss', 'supervisor'],
  },
  {
    id: 9002101,
    tenantId: 0,
    parentId: 9002001,
    menuType: 'page',
    code: 'overview.dashboard',
    name: '老板驾驶舱',
    routePath: '/dashboard',
    icon: 'dashboard',
    groupName: '概览',
    sortOrder: 10,
    status: 'active',
    isSystem: true,
    roleCodes: ['boss', 'supervisor'],
  },
  {
    id: 9003001,
    tenantId: 0,
    parentId: null,
    menuType: 'group',
    code: 'purchase.module',
    name: '采购',
    routePath: null,
    icon: 'shopping-cart',
    groupName: '采购',
    sortOrder: 20,
    status: 'active',
    isSystem: true,
    roleCodes: ['boss', 'supervisor', 'purchaser', 'warehouse', 'qc'],
  },
  {
    id: 9003101,
    tenantId: 0,
    parentId: 9003001,
    menuType: 'page',
    code: 'purchase.suggestion.board',
    name: 'AI采购建议',
    routePath: '/purchase/suggestions',
    icon: 'robot',
    groupName: '采购',
    sortOrder: 10,
    status: 'active',
    isSystem: true,
    roleCodes: ['boss', 'purchaser'],
  },
  {
    id: 9003102,
    tenantId: 0,
    parentId: 9003001,
    menuType: 'page',
    code: 'purchase.match',
    name: '三单匹配',
    routePath: '/purchase/match',
    icon: 'link',
    groupName: '采购',
    sortOrder: 20,
    status: 'active',
    isSystem: true,
    roleCodes: ['boss', 'purchaser'],
  },
  {
    id: 9003103,
    tenantId: 0,
    parentId: 9003001,
    menuType: 'page',
    code: 'purchase.price',
    name: '采购价格',
    routePath: '/purchase/prices',
    icon: 'dollar',
    groupName: '采购',
    sortOrder: 30,
    status: 'active',
    isSystem: true,
    roleCodes: ['boss', 'purchaser'],
  },
  {
    id: 9003104,
    tenantId: 0,
    parentId: 9003001,
    menuType: 'page',
    code: 'purchase.suggestion.manage',
    name: '采购建议管理',
    routePath: '/purchase/purchase-suggestions',
    icon: 'unordered-list',
    groupName: '采购',
    sortOrder: 40,
    status: 'active',
    isSystem: true,
    roleCodes: ['boss', 'supervisor', 'purchaser'],
  },
  {
    id: 9003105,
    tenantId: 0,
    parentId: 9003001,
    menuType: 'page',
    code: 'purchase.order',
    name: '采购订单',
    routePath: '/purchase/orders',
    icon: 'file-text',
    groupName: '采购',
    sortOrder: 50,
    status: 'active',
    isSystem: true,
    roleCodes: ['boss', 'supervisor', 'purchaser'],
  },
  {
    id: 9003106,
    tenantId: 0,
    parentId: 9003001,
    menuType: 'page',
    code: 'purchase.delivery',
    name: '到货管理',
    routePath: '/purchase/deliveries',
    icon: 'car',
    groupName: '采购',
    sortOrder: 60,
    status: 'active',
    isSystem: true,
    roleCodes: ['boss', 'supervisor', 'purchaser', 'warehouse'],
  },
  {
    id: 9003107,
    tenantId: 0,
    parentId: 9003001,
    menuType: 'page',
    code: 'purchase.receipt',
    name: '入库记录',
    routePath: '/purchase/receipts',
    icon: 'inbox',
    groupName: '采购',
    sortOrder: 70,
    status: 'active',
    isSystem: true,
    roleCodes: ['boss', 'supervisor', 'purchaser', 'warehouse'],
  },
  {
    id: 9003108,
    tenantId: 0,
    parentId: 9003001,
    menuType: 'page',
    code: 'purchase.incoming_inspection',
    name: '来料质检',
    routePath: '/purchase/incoming-inspection',
    icon: 'experiment',
    groupName: '采购',
    sortOrder: 80,
    status: 'active',
    isSystem: true,
    roleCodes: ['boss', 'supervisor', 'purchaser', 'warehouse', 'qc'],
  },
  {
    id: 9003109,
    tenantId: 0,
    parentId: 9003001,
    menuType: 'page',
    code: 'purchase.return',
    name: '退货管理',
    routePath: '/purchase/returns',
    icon: 'rollback',
    groupName: '采购',
    sortOrder: 90,
    status: 'active',
    isSystem: true,
    roleCodes: ['boss', 'supervisor', 'purchaser'],
  },
  {
    id: 9003110,
    tenantId: 0,
    parentId: 9003001,
    menuType: 'page',
    code: 'purchase.settlement',
    name: '采购结算',
    routePath: '/purchase/settlements',
    icon: 'wallet',
    groupName: '采购',
    sortOrder: 100,
    status: 'active',
    isSystem: true,
    roleCodes: ['boss', 'supervisor', 'purchaser'],
  },
  {
    id: 9004001,
    tenantId: 0,
    parentId: null,
    menuType: 'group',
    code: 'sales.module',
    name: '销售',
    routePath: null,
    icon: 'shop',
    groupName: '销售',
    sortOrder: 30,
    status: 'active',
    isSystem: true,
    roleCodes: ['boss', 'supervisor', 'sales'],
  },
  {
    id: 9004101,
    tenantId: 0,
    parentId: 9004001,
    menuType: 'page',
    code: 'sales.order.create',
    name: '新建订单',
    routePath: '/sales/orders',
    icon: 'edit',
    groupName: '销售',
    sortOrder: 10,
    status: 'active',
    isSystem: true,
    roleCodes: ['boss', 'supervisor', 'sales'],
  },
  {
    id: 9004102,
    tenantId: 0,
    parentId: 9004001,
    menuType: 'page',
    code: 'sales.order.list',
    name: '订单管理',
    routePath: '/sales/order-list',
    icon: 'profile',
    groupName: '销售',
    sortOrder: 20,
    status: 'active',
    isSystem: true,
    roleCodes: ['boss', 'supervisor', 'sales'],
  },
  {
    id: 9004103,
    tenantId: 0,
    parentId: 9004001,
    menuType: 'page',
    code: 'sales.customer',
    name: '客户管理',
    routePath: '/sales/customers',
    icon: 'team',
    groupName: '销售',
    sortOrder: 30,
    status: 'active',
    isSystem: true,
    roleCodes: ['boss', 'supervisor', 'sales'],
  },
  {
    id: 9004104,
    tenantId: 0,
    parentId: 9004001,
    menuType: 'page',
    code: 'sales.settlement',
    name: '销售结算',
    routePath: '/settlement',
    icon: 'credit-card',
    groupName: '销售',
    sortOrder: 40,
    status: 'active',
    isSystem: true,
    roleCodes: ['boss', 'supervisor', 'sales'],
  },
  {
    id: 9005001,
    tenantId: 0,
    parentId: null,
    menuType: 'group',
    code: 'production.module',
    name: '生产',
    routePath: null,
    icon: 'build',
    groupName: '生产',
    sortOrder: 40,
    status: 'active',
    isSystem: true,
    roleCodes: ['admin', 'boss', 'supervisor', 'purchaser', 'worker'],
  },
  {
    id: 9005101,
    tenantId: 0,
    parentId: 9005001,
    menuType: 'page',
    code: 'production.schedule_suggestion',
    name: '智能调度',
    routePath: '/schedule-suggestions',
    icon: 'thunderbolt',
    groupName: '生产',
    sortOrder: 10,
    status: 'active',
    isSystem: true,
    roleCodes: ['boss', 'supervisor', 'purchaser'],
  },
  {
    id: 9005102,
    tenantId: 0,
    parentId: 9005001,
    menuType: 'page',
    code: 'production.schedule',
    name: '排产计划',
    routePath: '/production/schedule',
    icon: 'calendar',
    groupName: '生产',
    sortOrder: 20,
    status: 'active',
    isSystem: true,
    roleCodes: ['admin', 'boss', 'supervisor'],
  },
  {
    id: 9005103,
    tenantId: 0,
    parentId: 9005001,
    menuType: 'page',
    code: 'production.task',
    name: '生产任务',
    routePath: '/production/tasks',
    icon: 'tool',
    groupName: '生产',
    sortOrder: 30,
    status: 'active',
    isSystem: true,
    roleCodes: ['admin', 'boss', 'supervisor', 'worker'],
  },
  {
    id: 9005104,
    tenantId: 0,
    parentId: 9005001,
    menuType: 'page',
    code: 'production.order',
    name: '生产工单',
    routePath: '/production/orders',
    icon: 'file-protect',
    groupName: '生产',
    sortOrder: 40,
    status: 'active',
    isSystem: true,
    roleCodes: ['admin', 'boss', 'supervisor'],
  },
  {
    id: 9005105,
    tenantId: 0,
    parentId: 9005001,
    menuType: 'page',
    code: 'production.shortage',
    name: '缺料看板',
    routePath: '/production/shortage',
    icon: 'alert',
    groupName: '生产',
    sortOrder: 50,
    status: 'active',
    isSystem: true,
    roleCodes: ['boss', 'supervisor', 'purchaser'],
  },
  {
    id: 9006001,
    tenantId: 0,
    parentId: null,
    menuType: 'group',
    code: 'warehouse.module',
    name: '仓库',
    routePath: null,
    icon: 'appstore',
    groupName: '仓库',
    sortOrder: 50,
    status: 'active',
    isSystem: true,
    roleCodes: ['admin', 'boss', 'supervisor', 'purchaser', 'warehouse'],
  },
  {
    id: 9006101,
    tenantId: 0,
    parentId: 9006001,
    menuType: 'page',
    code: 'warehouse.inventory',
    name: '库存总览',
    routePath: '/inventory',
    icon: 'database',
    groupName: '仓库',
    sortOrder: 10,
    status: 'active',
    isSystem: true,
    roleCodes: ['boss', 'supervisor', 'purchaser', 'warehouse'],
  },
  {
    id: 9006102,
    tenantId: 0,
    parentId: 9006001,
    menuType: 'page',
    code: 'warehouse.stocktaking',
    name: '库存盘点',
    routePath: '/stocktaking',
    icon: 'audit',
    groupName: '仓库',
    sortOrder: 20,
    status: 'active',
    isSystem: true,
    roleCodes: ['boss', 'supervisor', 'warehouse'],
  },
  {
    id: 9007001,
    tenantId: 0,
    parentId: null,
    menuType: 'group',
    code: 'quality.module',
    name: '质量',
    routePath: null,
    icon: 'safety',
    groupName: '质量',
    sortOrder: 60,
    status: 'active',
    isSystem: true,
    roleCodes: ['boss', 'supervisor', 'qc', 'sales'],
  },
  {
    id: 9007101,
    tenantId: 0,
    parentId: 9007001,
    menuType: 'page',
    code: 'quality.trace',
    name: '质量溯源',
    routePath: '/quality/trace',
    icon: 'search',
    groupName: '质量',
    sortOrder: 10,
    status: 'active',
    isSystem: true,
    roleCodes: ['boss', 'supervisor', 'qc', 'sales'],
  },
  {
    id: 9008001,
    tenantId: 0,
    parentId: null,
    menuType: 'group',
    code: 'master_data.module',
    name: '主数据',
    routePath: null,
    icon: 'deployment-unit',
    groupName: '主数据',
    sortOrder: 70,
    status: 'active',
    isSystem: true,
    roleCodes: ['admin', 'boss', 'supervisor', 'purchaser', 'warehouse'],
  },
  {
    id: 9008101,
    tenantId: 0,
    parentId: 9008001,
    menuType: 'page',
    code: 'master_data.sku',
    name: 'SKU主数据',
    routePath: '/master-data/sku',
    icon: 'tags',
    groupName: '主数据',
    sortOrder: 10,
    status: 'active',
    isSystem: true,
    roleCodes: ['boss', 'supervisor', 'purchaser', 'warehouse'],
  },
  {
    id: 9008102,
    tenantId: 0,
    parentId: 9008001,
    menuType: 'page',
    code: 'master_data.warehouse_location',
    name: '仓库库位配置',
    routePath: '/master-data/warehouse-location',
    icon: 'environment',
    groupName: '主数据',
    sortOrder: 20,
    status: 'active',
    isSystem: true,
    roleCodes: ['admin', 'boss', 'supervisor', 'purchaser', 'warehouse'],
  },
  {
    id: 9008103,
    tenantId: 0,
    parentId: 9008001,
    menuType: 'page',
    code: 'master_data.bom',
    name: 'BOM管理',
    routePath: '/master-data/bom',
    icon: 'cluster',
    groupName: '主数据',
    sortOrder: 30,
    status: 'active',
    isSystem: true,
    roleCodes: ['boss', 'supervisor', 'purchaser'],
  },
  {
    id: 9008104,
    tenantId: 0,
    parentId: 9008001,
    menuType: 'page',
    code: 'master_data.supplier',
    name: '供应商管理',
    routePath: '/master-data/supplier',
    icon: 'bank',
    groupName: '主数据',
    sortOrder: 40,
    status: 'active',
    isSystem: true,
    roleCodes: ['boss', 'supervisor', 'purchaser'],
  },
  {
    id: 9008105,
    tenantId: 0,
    parentId: 9008001,
    menuType: 'page',
    code: 'master_data.process_config',
    name: '工序配置',
    routePath: '/master-data/process-config',
    icon: 'setting',
    groupName: '主数据',
    sortOrder: 50,
    status: 'active',
    isSystem: true,
    roleCodes: ['boss', 'supervisor'],
  },
  {
    id: 9008106,
    tenantId: 0,
    parentId: 9008001,
    menuType: 'page',
    code: 'master_data.sku_process',
    name: 'SKU工序配置',
    routePath: '/master-data/sku-process',
    icon: 'branches',
    groupName: '主数据',
    sortOrder: 60,
    status: 'active',
    isSystem: true,
    roleCodes: ['boss', 'supervisor'],
  },
  {
    id: 9008107,
    tenantId: 0,
    parentId: 9008001,
    menuType: 'page',
    code: 'master_data.sku_category',
    name: '类目配置',
    routePath: '/master-data/sku-category',
    icon: 'folder-open',
    groupName: '主数据',
    sortOrder: 70,
    status: 'active',
    isSystem: true,
    roleCodes: ['boss', 'supervisor'],
  },
  {
    id: 9009001,
    tenantId: 0,
    parentId: null,
    menuType: 'group',
    code: 'report.module',
    name: '报表',
    routePath: null,
    icon: 'bar-chart',
    groupName: '报表',
    sortOrder: 80,
    status: 'active',
    isSystem: true,
    roleCodes: ['boss', 'supervisor', 'worker'],
  },
  {
    id: 9009101,
    tenantId: 0,
    parentId: 9009001,
    menuType: 'page',
    code: 'report.analytics',
    name: '经营分析',
    routePath: '/analytics',
    icon: 'line-chart',
    groupName: '报表',
    sortOrder: 10,
    status: 'active',
    isSystem: true,
    roleCodes: ['boss', 'supervisor'],
  },
  {
    id: 9009102,
    tenantId: 0,
    parentId: 9009001,
    menuType: 'page',
    code: 'report.wage',
    name: '工资报表',
    routePath: '/report/wages',
    icon: 'area-chart',
    groupName: '报表',
    sortOrder: 20,
    status: 'active',
    isSystem: true,
    roleCodes: ['boss', 'supervisor'],
  },
  {
    id: 9009103,
    tenantId: 0,
    parentId: 9009001,
    menuType: 'page',
    code: 'report.my_wage',
    name: '我的工资',
    routePath: '/report/my-wages',
    icon: 'pay-circle',
    groupName: '报表',
    sortOrder: 30,
    status: 'active',
    isSystem: true,
    roleCodes: ['boss', 'supervisor', 'worker'],
  },
  {
    id: 9009104,
    tenantId: 0,
    parentId: 9009001,
    menuType: 'page',
    code: 'report.semi_finished_mode',
    name: '半成品模式报表',
    routePath: '/report/semi-finished-modes',
    icon: 'table',
    groupName: '报表',
    sortOrder: 40,
    status: 'active',
    isSystem: true,
    roleCodes: ['boss', 'supervisor'],
  },
  {
    id: 9009105,
    tenantId: 0,
    parentId: 9009001,
    menuType: 'page',
    code: 'report.inventory_operation',
    name: '库存经营',
    routePath: '/report/inventory-operation',
    icon: 'fund-projection-screen',
    groupName: '报表',
    sortOrder: 50,
    status: 'active',
    isSystem: true,
    roleCodes: ['boss', 'supervisor'],
  },
  {
    id: 9010001,
    tenantId: 0,
    parentId: null,
    menuType: 'group',
    code: 'system.biz.module',
    name: '系统',
    routePath: null,
    icon: 'notification',
    groupName: '系统',
    sortOrder: 90,
    status: 'active',
    isSystem: true,
    roleCodes: ['boss', 'supervisor', 'purchaser', 'sales', 'warehouse', 'worker', 'qc'],
  },
  {
    id: 9010101,
    tenantId: 0,
    parentId: 9010001,
    menuType: 'page',
    code: 'system.notification',
    name: '通知中心',
    routePath: '/notifications',
    icon: 'bell',
    groupName: '系统',
    sortOrder: 10,
    status: 'active',
    isSystem: true,
    roleCodes: ['boss', 'supervisor', 'purchaser', 'sales', 'warehouse', 'worker', 'qc'],
  },
  {
    id: 9011001,
    tenantId: 0,
    parentId: null,
    menuType: 'group',
    code: 'ai.module',
    name: 'AI',
    routePath: null,
    icon: 'robot',
    groupName: 'AI',
    sortOrder: 100,
    status: 'active',
    isSystem: true,
    roleCodes: ['boss', 'supervisor', 'purchaser', 'sales'],
  },
  {
    id: 9011101,
    tenantId: 0,
    parentId: 9011001,
    menuType: 'page',
    code: 'ai.chat',
    name: 'AI助手',
    routePath: '/ai-chat',
    icon: 'message',
    groupName: 'AI',
    sortOrder: 10,
    status: 'active',
    isSystem: true,
    roleCodes: ['boss', 'supervisor', 'purchaser', 'sales'],
  },
];

const SYSTEM_ACTION_DEFINITIONS: ActionSeedDefinition[] = [
  { id: 9021001, tenantId: 0, menuId: 9001101, code: 'system.tenant.manage', name: '租户管理', actionType: 'custom', status: 'active', defaultEnabled: true, roleCodes: ['platform_super_admin'] },
  { id: 9021002, tenantId: 0, menuId: 9001102, code: 'system.menu.manage', name: '菜单管理', actionType: 'custom', status: 'active', defaultEnabled: true, roleCodes: ['admin', 'tenant_admin', 'boss', 'supervisor', 'platform_super_admin'] },
  { id: 9021003, tenantId: 0, menuId: 9001103, code: 'system.role.manage', name: '角色管理', actionType: 'custom', status: 'active', defaultEnabled: true, roleCodes: ['admin', 'tenant_admin', 'boss', 'supervisor', 'platform_super_admin'] },
  { id: 9021004, tenantId: 0, menuId: 9001104, code: 'system.user.manage', name: '人员管理', actionType: 'custom', status: 'active', defaultEnabled: true, roleCodes: ['admin', 'tenant_admin', 'boss', 'supervisor', 'platform_super_admin'] },
  { id: 9021005, tenantId: 0, menuId: 9001105, code: 'system.role.grant', name: '角色授权', actionType: 'custom', status: 'active', defaultEnabled: true, roleCodes: ['admin', 'tenant_admin', 'boss', 'supervisor', 'platform_super_admin'] },
  { id: 9021006, tenantId: 0, menuId: 9001106, code: 'system.user.assign', name: '人员角色分配', actionType: 'custom', status: 'active', defaultEnabled: true, roleCodes: ['admin', 'tenant_admin', 'boss', 'supervisor', 'platform_super_admin'] },
  { id: 9021007, tenantId: 0, menuId: 9001001, code: 'system.audit.view', name: '权限审计查看', actionType: 'custom', status: 'active', defaultEnabled: true, roleCodes: ['platform_super_admin'] },
  { id: 9021008, tenantId: 0, menuId: 9001101, code: 'platform.tenant.switch', name: '切换租户上下文', actionType: 'custom', status: 'active', defaultEnabled: true, roleCodes: ['platform_super_admin'] },
  { id: 9022001, tenantId: 0, menuId: 9002101, code: 'dashboard:view', name: '查看概览', actionType: 'view', status: 'active', defaultEnabled: true, roleCodes: ['admin', 'tenant_admin', 'boss', 'supervisor'] },
  { id: 9023001, tenantId: 0, menuId: 9008101, code: 'sku:view', name: '查看SKU', actionType: 'view', status: 'active', defaultEnabled: true, roleCodes: ['admin', 'tenant_admin', 'boss', 'supervisor', 'purchaser', 'warehouse'] },
  { id: 9023002, tenantId: 0, menuId: 9008101, code: 'sku:create', name: '新增SKU', actionType: 'create', status: 'active', defaultEnabled: true, roleCodes: ['admin', 'tenant_admin', 'boss', 'purchaser'] },
  { id: 9023003, tenantId: 0, menuId: 9008101, code: 'sku:edit', name: '编辑SKU', actionType: 'edit', status: 'active', defaultEnabled: true, roleCodes: ['admin', 'tenant_admin', 'boss', 'purchaser'] },
  { id: 9023101, tenantId: 0, menuId: 9008103, code: 'bom:view', name: '查看BOM', actionType: 'view', status: 'active', defaultEnabled: true, roleCodes: ['admin', 'tenant_admin', 'boss', 'supervisor', 'purchaser'] },
  { id: 9023102, tenantId: 0, menuId: 9008103, code: 'bom:create', name: '新增BOM', actionType: 'create', status: 'active', defaultEnabled: true, roleCodes: ['admin', 'tenant_admin', 'boss', 'supervisor'] },
  { id: 9023103, tenantId: 0, menuId: 9008103, code: 'bom:activate', name: '启用BOM', actionType: 'approve', status: 'active', defaultEnabled: true, roleCodes: ['admin', 'tenant_admin', 'boss', 'supervisor'] },
  { id: 9023201, tenantId: 0, menuId: 9006101, code: 'inventory:view', name: '查看库存', actionType: 'view', status: 'active', defaultEnabled: true, roleCodes: ['admin', 'tenant_admin', 'boss', 'supervisor', 'purchaser', 'warehouse'] },
  { id: 9023202, tenantId: 0, menuId: 9006101, code: 'inventory:inbound', name: '库存入库', actionType: 'create', status: 'active', defaultEnabled: true, roleCodes: ['admin', 'tenant_admin', 'boss', 'purchaser', 'warehouse'] },
  { id: 9023203, tenantId: 0, menuId: 9006101, code: 'inventory:outbound', name: '库存出库', actionType: 'edit', status: 'active', defaultEnabled: true, roleCodes: ['admin', 'tenant_admin', 'boss', 'supervisor', 'warehouse'] },
  { id: 9023301, tenantId: 0, menuId: 9003101, code: 'purchase:suggestion:view', name: '查看采购建议', actionType: 'view', status: 'active', defaultEnabled: true, roleCodes: ['admin', 'tenant_admin', 'boss', 'purchaser'] },
  { id: 9023302, tenantId: 0, menuId: 9003101, code: 'purchase:suggestion:generate', name: '生成采购建议', actionType: 'create', status: 'active', defaultEnabled: true, roleCodes: ['admin', 'tenant_admin', 'boss', 'purchaser'] },
  { id: 9023303, tenantId: 0, menuId: 9003104, code: 'purchase:suggestion:approve', name: '审批采购建议', actionType: 'approve', status: 'active', defaultEnabled: true, roleCodes: ['admin', 'tenant_admin', 'boss'] },
  { id: 9023401, tenantId: 0, menuId: 9003102, code: 'purchase:match:execute', name: '执行三单匹配', actionType: 'custom', status: 'active', defaultEnabled: true, roleCodes: ['admin', 'tenant_admin', 'purchaser'] },
  { id: 9023402, tenantId: 0, menuId: 9003102, code: 'purchase:match:confirm', name: '确认三单匹配', actionType: 'approve', status: 'active', defaultEnabled: true, roleCodes: ['admin', 'tenant_admin', 'purchaser'] },
  { id: 9023501, tenantId: 0, menuId: 9003105, code: 'purchase:order:view', name: '查看采购订单', actionType: 'view', status: 'active', defaultEnabled: true, roleCodes: ['admin', 'tenant_admin', 'boss', 'supervisor', 'purchaser'] },
  { id: 9023502, tenantId: 0, menuId: 9003105, code: 'purchase:order:create', name: '创建采购订单', actionType: 'create', status: 'active', defaultEnabled: true, roleCodes: ['admin', 'tenant_admin', 'boss', 'purchaser'] },
  { id: 9023503, tenantId: 0, menuId: 9003105, code: 'purchase:order:delivery', name: '到货登记', actionType: 'edit', status: 'active', defaultEnabled: true, roleCodes: ['admin', 'tenant_admin', 'purchaser'] },
  { id: 9023504, tenantId: 0, menuId: 9003105, code: 'purchase:order:close', name: '关闭采购订单', actionType: 'approve', status: 'active', defaultEnabled: true, roleCodes: ['admin', 'tenant_admin', 'boss', 'supervisor'] },
  { id: 9023601, tenantId: 0, menuId: 9003106, code: 'purchase:delivery:view', name: '查看到货', actionType: 'view', status: 'active', defaultEnabled: true, roleCodes: ['admin', 'tenant_admin', 'boss', 'supervisor', 'purchaser', 'warehouse'] },
  { id: 9023701, tenantId: 0, menuId: 9003107, code: 'purchase:receipt:view', name: '查看入库', actionType: 'view', status: 'active', defaultEnabled: true, roleCodes: ['admin', 'tenant_admin', 'boss', 'supervisor', 'purchaser', 'warehouse'] },
  { id: 9023702, tenantId: 0, menuId: 9003107, code: 'purchase:receipt:edit', name: '编辑入库', actionType: 'edit', status: 'active', defaultEnabled: true, roleCodes: ['admin', 'tenant_admin', 'boss', 'supervisor', 'warehouse'] },
  { id: 9023801, tenantId: 0, menuId: 9004101, code: 'sales:order:view', name: '查看销售订单', actionType: 'view', status: 'active', defaultEnabled: true, roleCodes: ['admin', 'tenant_admin', 'boss', 'supervisor', 'sales'] },
  { id: 9023802, tenantId: 0, menuId: 9004101, code: 'sales:order:create', name: '新建销售订单', actionType: 'create', status: 'active', defaultEnabled: true, roleCodes: ['admin', 'tenant_admin', 'boss', 'sales'] },
  { id: 9023803, tenantId: 0, menuId: 9004102, code: 'sales:order:approve', name: '审批销售订单', actionType: 'approve', status: 'active', defaultEnabled: true, roleCodes: ['admin', 'tenant_admin', 'boss'] },
  { id: 9023804, tenantId: 0, menuId: 9004102, code: 'sales:order:urgent-analyze', name: '紧急单评估', actionType: 'custom', status: 'active', defaultEnabled: true, roleCodes: ['admin', 'tenant_admin', 'boss', 'supervisor', 'sales'] },
  { id: 9023805, tenantId: 0, menuId: 9004102, code: 'sales:order-list:create', name: '订单列表创建/提交审批', actionType: 'create', status: 'active', defaultEnabled: true, roleCodes: ['admin', 'tenant_admin', 'boss', 'supervisor', 'sales'] },
  { id: 9023806, tenantId: 0, menuId: 9004102, code: 'sales:order-list:approve', name: '订单列表审批', actionType: 'approve', status: 'active', defaultEnabled: true, roleCodes: ['admin', 'tenant_admin', 'boss'] },
  { id: 9023807, tenantId: 0, menuId: 9004102, code: 'sales:order-list:ship', name: '订单列表发货/完结', actionType: 'custom', status: 'active', defaultEnabled: true, roleCodes: ['admin', 'tenant_admin', 'boss', 'supervisor'] },
  { id: 9023808, tenantId: 0, menuId: 9004103, code: 'sales:customer:view', name: '查看客户', actionType: 'view', status: 'active', defaultEnabled: true, roleCodes: ['admin', 'tenant_admin', 'boss', 'supervisor', 'sales'] },
  { id: 9023809, tenantId: 0, menuId: 9004103, code: 'sales:customer:manage', name: '维护客户', actionType: 'edit', status: 'active', defaultEnabled: true, roleCodes: ['admin', 'tenant_admin', 'boss', 'supervisor', 'sales'] },
  { id: 9023901, tenantId: 0, menuId: 9005104, code: 'production:order:view', name: '查看生产工单', actionType: 'view', status: 'active', defaultEnabled: true, roleCodes: ['admin', 'tenant_admin', 'boss', 'supervisor', 'worker'] },
  { id: 9023902, tenantId: 0, menuId: 9005104, code: 'production:order:create', name: '创建生产工单', actionType: 'create', status: 'active', defaultEnabled: true, roleCodes: ['admin', 'tenant_admin', 'boss', 'supervisor'] },
  { id: 9023910, tenantId: 0, menuId: 9005102, code: 'production:schedule:view', name: '查看排产计划', actionType: 'view', status: 'active', defaultEnabled: true, roleCodes: ['admin', 'tenant_admin', 'boss', 'supervisor'] },
  { id: 9023911, tenantId: 0, menuId: 9005102, code: 'production:schedule:generate', name: '生成排产计划', actionType: 'create', status: 'active', defaultEnabled: true, roleCodes: ['admin', 'tenant_admin', 'boss', 'supervisor'] },
  { id: 9023912, tenantId: 0, menuId: 9005102, code: 'production:schedule:confirm', name: '确认排产计划', actionType: 'approve', status: 'active', defaultEnabled: true, roleCodes: ['admin', 'tenant_admin', 'boss', 'supervisor'] },
  { id: 9023920, tenantId: 0, menuId: 9005103, code: 'production:task:complete', name: '完成生产任务', actionType: 'approve', status: 'active', defaultEnabled: true, roleCodes: ['admin', 'tenant_admin', 'boss', 'supervisor', 'worker'] },
  { id: 9023921, tenantId: 0, menuId: 9005103, code: 'production:task:operate', name: '操作生产任务', actionType: 'custom', status: 'active', defaultEnabled: true, roleCodes: ['admin', 'tenant_admin', 'boss', 'supervisor', 'worker'] },
  { id: 9023922, tenantId: 0, menuId: 9005103, code: 'production:task:supervise', name: '主管处置任务', actionType: 'custom', status: 'active', defaultEnabled: true, roleCodes: ['admin', 'tenant_admin', 'boss', 'supervisor'] },
  { id: 9023930, tenantId: 0, menuId: 9005101, code: 'schedule:suggestion:purchase:view', name: '查看采购侧建议', actionType: 'view', status: 'active', defaultEnabled: true, roleCodes: ['admin', 'tenant_admin', 'boss', 'supervisor', 'purchaser'] },
  { id: 9023931, tenantId: 0, menuId: 9005101, code: 'schedule:suggestion:production:view', name: '查看生产侧建议', actionType: 'view', status: 'active', defaultEnabled: true, roleCodes: ['admin', 'tenant_admin', 'boss', 'supervisor'] },
  { id: 9023932, tenantId: 0, menuId: 9005101, code: 'schedule:suggestion:trigger', name: '触发调度计算', actionType: 'custom', status: 'active', defaultEnabled: true, roleCodes: ['admin', 'tenant_admin', 'boss', 'supervisor'] },
  { id: 9023940, tenantId: 0, menuId: 9007101, code: 'quality:view', name: '查看质量溯源', actionType: 'view', status: 'active', defaultEnabled: true, roleCodes: ['admin', 'tenant_admin', 'boss', 'supervisor', 'qc', 'sales'] },
  { id: 9023941, tenantId: 0, menuId: 9007101, code: 'quality:create', name: '新增质检记录', actionType: 'create', status: 'active', defaultEnabled: true, roleCodes: ['admin', 'tenant_admin', 'supervisor', 'qc'] },
  { id: 9023942, tenantId: 0, menuId: 9007101, code: 'quality:issue:create', name: '创建质量问题', actionType: 'create', status: 'active', defaultEnabled: true, roleCodes: ['admin', 'tenant_admin', 'qc'] },
  { id: 9023943, tenantId: 0, menuId: 9007101, code: 'quality:complete', name: '完成质检', actionType: 'approve', status: 'active', defaultEnabled: true, roleCodes: ['admin', 'tenant_admin', 'qc'] },
  { id: 9023944, tenantId: 0, menuId: 9009101, code: 'report:analytics:view', name: '查看经营分析', actionType: 'view', status: 'active', defaultEnabled: true, roleCodes: ['admin', 'tenant_admin', 'boss', 'supervisor'] },
  { id: 9023950, tenantId: 0, menuId: 9009102, code: 'report:wage:manage', name: '管理工资报表', actionType: 'export', status: 'active', defaultEnabled: true, roleCodes: ['admin', 'tenant_admin', 'boss', 'supervisor'] },
  { id: 9023960, tenantId: 0, menuId: 9004104, code: 'settlement:manage', name: '管理销售结算', actionType: 'custom', status: 'active', defaultEnabled: true, roleCodes: ['admin', 'tenant_admin', 'boss', 'supervisor'] },
  { id: 9023961, tenantId: 0, menuId: 9004104, code: 'settlement:boss', name: '老板确认销售结算', actionType: 'approve', status: 'active', defaultEnabled: true, roleCodes: ['admin', 'tenant_admin', 'boss'] },
  { id: 9023962, tenantId: 0, menuId: 9004104, code: 'settlement:receivable:view', name: '查看应收汇总', actionType: 'view', status: 'active', defaultEnabled: true, roleCodes: ['admin', 'tenant_admin', 'boss', 'supervisor'] },
  { id: 9023963, tenantId: 0, menuId: 9004104, code: 'settlement:pending:view', name: '查看待结算订单', actionType: 'view', status: 'active', defaultEnabled: true, roleCodes: ['admin', 'tenant_admin', 'boss', 'supervisor', 'sales'] },
  { id: 9023970, tenantId: 0, menuId: 9003110, code: 'purchase:settlement:manage', name: '管理采购结算', actionType: 'custom', status: 'active', defaultEnabled: true, roleCodes: ['admin', 'tenant_admin', 'boss', 'supervisor'] },
  { id: 9023971, tenantId: 0, menuId: 9003110, code: 'purchase:settlement:boss', name: '老板确认采购结算', actionType: 'approve', status: 'active', defaultEnabled: true, roleCodes: ['admin', 'tenant_admin', 'boss'] },
  { id: 9023980, tenantId: 0, menuId: 9008102, code: 'warehouse:location:manage', name: '维护仓库库位', actionType: 'edit', status: 'active', defaultEnabled: true, roleCodes: ['admin', 'tenant_admin', 'boss', 'supervisor', 'warehouse'] },
  { id: 9023981, tenantId: 0, menuId: 9008102, code: 'warehouse:location:import', name: '导入仓库库位', actionType: 'custom', status: 'active', defaultEnabled: true, roleCodes: ['admin', 'tenant_admin', 'boss', 'supervisor'] },
  { id: 9023982, tenantId: 0, menuId: 9008104, code: 'supplier:view', name: '查看供应商', actionType: 'view', status: 'active', defaultEnabled: true, roleCodes: ['admin', 'tenant_admin', 'boss', 'supervisor', 'purchaser'] },
  { id: 9023983, tenantId: 0, menuId: 9008104, code: 'supplier:manage', name: '维护供应商', actionType: 'edit', status: 'active', defaultEnabled: true, roleCodes: ['admin', 'tenant_admin', 'boss', 'supervisor', 'purchaser'] },
  { id: 9023984, tenantId: 0, menuId: 9003103, code: 'price:view', name: '查看采购价格', actionType: 'view', status: 'active', defaultEnabled: true, roleCodes: ['admin', 'tenant_admin', 'boss', 'supervisor', 'purchaser'] },
  { id: 9023985, tenantId: 0, menuId: 9003103, code: 'price:manage', name: '维护采购价格', actionType: 'edit', status: 'active', defaultEnabled: true, roleCodes: ['admin', 'tenant_admin', 'boss', 'supervisor', 'purchaser'] },
  { id: 9023986, tenantId: 0, menuId: 9003103, code: 'price:import', name: '导入采购价格', actionType: 'custom', status: 'active', defaultEnabled: true, roleCodes: ['admin', 'tenant_admin', 'boss', 'supervisor'] },
  { id: 9023987, tenantId: 0, menuId: 9003109, code: 'purchase:return:view', name: '查看退货单', actionType: 'view', status: 'active', defaultEnabled: true, roleCodes: ['admin', 'tenant_admin', 'boss', 'supervisor', 'purchaser', 'warehouse'] },
  { id: 9023988, tenantId: 0, menuId: 9003109, code: 'purchase:return:create', name: '创建退货单', actionType: 'create', status: 'active', defaultEnabled: true, roleCodes: ['admin', 'tenant_admin', 'boss', 'supervisor', 'warehouse'] },
  { id: 9023989, tenantId: 0, menuId: 9003109, code: 'purchase:return:confirm', name: '确认退货单', actionType: 'approve', status: 'active', defaultEnabled: true, roleCodes: ['admin', 'tenant_admin', 'boss', 'supervisor'] },
  { id: 9023990, tenantId: 0, menuId: 9003109, code: 'purchase:return:ship', name: '退货发运', actionType: 'custom', status: 'active', defaultEnabled: true, roleCodes: ['admin', 'tenant_admin', 'supervisor', 'warehouse'] },
  { id: 9023991, tenantId: 0, menuId: 9003109, code: 'purchase:return:complete', name: '完成退货', actionType: 'approve', status: 'active', defaultEnabled: true, roleCodes: ['admin', 'tenant_admin', 'boss', 'supervisor', 'warehouse'] },
  { id: 9023992, tenantId: 0, menuId: 9006102, code: 'stocktaking:view', name: '查看盘点任务', actionType: 'view', status: 'active', defaultEnabled: true, roleCodes: ['admin', 'tenant_admin', 'boss', 'supervisor', 'warehouse'] },
  { id: 9023993, tenantId: 0, menuId: 9006102, code: 'stocktaking:create', name: '创建/录入盘点', actionType: 'create', status: 'active', defaultEnabled: true, roleCodes: ['admin', 'tenant_admin', 'boss', 'warehouse'] },
  { id: 9023994, tenantId: 0, menuId: 9006102, code: 'stocktaking:submit', name: '提交盘点任务', actionType: 'custom', status: 'active', defaultEnabled: true, roleCodes: ['admin', 'tenant_admin', 'boss', 'warehouse'] },
  { id: 9023995, tenantId: 0, menuId: 9006102, code: 'stocktaking:confirm', name: '确认盘点结果', actionType: 'approve', status: 'active', defaultEnabled: true, roleCodes: ['admin', 'tenant_admin', 'boss'] },
  { id: 9023996, tenantId: 0, menuId: 9011101, code: 'ai:scan', name: '触发AI扫描', actionType: 'custom', status: 'active', defaultEnabled: true, roleCodes: ['admin', 'tenant_admin', 'boss', 'supervisor'] },
  { id: 9023997, tenantId: 0, menuId: 9005105, code: 'production:shortage:view', name: '查看缺料看板', actionType: 'view', status: 'active', defaultEnabled: true, roleCodes: ['admin', 'tenant_admin', 'boss', 'supervisor', 'purchaser', 'purchase'] },
  { id: 9023998, tenantId: 0, menuId: 9005105, code: 'production:shortage:reevaluate', name: '重评缺料状态', actionType: 'custom', status: 'active', defaultEnabled: true, roleCodes: ['admin', 'tenant_admin', 'boss', 'supervisor'] },
  { id: 9023999, tenantId: 0, menuId: 9008105, code: 'process:config:view', name: '查看工序配置', actionType: 'view', status: 'active', defaultEnabled: true, roleCodes: ['admin', 'tenant_admin', 'boss', 'supervisor', 'manager'] },
  { id: 9024000, tenantId: 0, menuId: 9008105, code: 'process:config:manage', name: '维护工序配置', actionType: 'edit', status: 'active', defaultEnabled: true, roleCodes: ['admin', 'tenant_admin', 'boss', 'supervisor', 'manager'] },
  { id: 9024001, tenantId: 0, menuId: 9008105, code: 'process:config:wage:manage', name: '维护工序工价', actionType: 'custom', status: 'active', defaultEnabled: true, roleCodes: ['admin', 'tenant_admin', 'boss', 'supervisor', 'manager'] },
  { id: 9024002, tenantId: 0, menuId: 9008107, code: 'sku:category:manage', name: '维护SKU类目', actionType: 'edit', status: 'active', defaultEnabled: true, roleCodes: ['admin', 'tenant_admin', 'boss'] },
  { id: 9024003, tenantId: 0, menuId: 9008107, code: 'sku:category:audit:view', name: '查看类目审计', actionType: 'view', status: 'active', defaultEnabled: true, roleCodes: ['admin', 'tenant_admin', 'boss'] },
  { id: 9024004, tenantId: 0, menuId: 9005102, code: 'production:calendar:manage', name: '维护生产日历', actionType: 'custom', status: 'active', defaultEnabled: true, roleCodes: ['admin', 'tenant_admin', 'boss', 'supervisor'] },
  { id: 9024005, tenantId: 0, menuId: 9005102, code: 'production:workstation:manage', name: '维护工作站', actionType: 'edit', status: 'active', defaultEnabled: true, roleCodes: ['admin', 'tenant_admin', 'boss', 'supervisor'] },
  { id: 9024006, tenantId: 0, menuId: 9005102, code: 'production:schedule:adjust', name: '调整排产计划', actionType: 'custom', status: 'active', defaultEnabled: true, roleCodes: ['admin', 'tenant_admin', 'boss', 'supervisor'] },
  { id: 9024007, tenantId: 0, menuId: 9006101, code: 'inventory:maintain', name: '维护库存账务', actionType: 'custom', status: 'active', defaultEnabled: true, roleCodes: ['admin', 'tenant_admin', 'boss', 'supervisor'] },
  { id: 9024008, tenantId: 0, menuId: 9006101, code: 'inventory:waste', name: '登记库存损耗', actionType: 'edit', status: 'active', defaultEnabled: true, roleCodes: ['admin', 'tenant_admin', 'boss', 'supervisor', 'warehouse'] },
];

const SYSTEM_MENU_SEEDS: PermissionMenuSeed[] = SYSTEM_MENU_DEFINITIONS.map(({ roleCodes: _roleCodes, ...item }) => ({ ...item }));
const SYSTEM_ACTION_SEEDS: PermissionActionSeed[] = SYSTEM_ACTION_DEFINITIONS.map(({ roleCodes: _roleCodes, ...item }) => ({ ...item }));

function buildRolePermissionGrants() {
  const grants = new Map<string, { menuCodes: Set<string>; actionCodes: Set<string> }>();
  const parentByCode = new Map<string, string | null>();
  const menuById = new Map<number, MenuSeedDefinition>();

  SYSTEM_MENU_DEFINITIONS.forEach((menu) => {
    menuById.set(menu.id, menu);
    const parentCode = menu.parentId ? menuById.get(menu.parentId)?.code ?? null : null;
    parentByCode.set(menu.code, parentCode);
  });

  const ensureGrant = (roleCode: string) => {
    if (!grants.has(roleCode)) {
      grants.set(roleCode, { menuCodes: new Set<string>(), actionCodes: new Set<string>() });
    }
    return grants.get(roleCode)!;
  };

  const grantMenuWithAncestors = (roleCode: string, menuCode: string) => {
    const grant = ensureGrant(roleCode);
    let current: string | null | undefined = menuCode;
    while (current) {
      grant.menuCodes.add(current);
      current = parentByCode.get(current) ?? null;
    }
  };

  SYSTEM_MENU_DEFINITIONS.forEach((menu) => {
    for (const roleCode of menu.roleCodes ?? []) {
      if (roleCode === 'platform_super_admin') {
        continue;
      }
      grantMenuWithAncestors(roleCode, menu.code);
    }
  });

  SYSTEM_ACTION_DEFINITIONS.forEach((action) => {
    const menu = menuById.get(action.menuId);
    for (const roleCode of action.roleCodes ?? []) {
      if (roleCode === 'platform_super_admin') {
        continue;
      }
      const grant = ensureGrant(roleCode);
      grant.actionCodes.add(action.code);
      if (menu) {
        grantMenuWithAncestors(roleCode, menu.code);
      }
    }
  });

  const tenantMenuCodes = SYSTEM_MENU_DEFINITIONS
    .map((item) => item.code)
    .filter((code) => code !== 'system.tenant.config');
  const tenantActionCodes = SYSTEM_ACTION_DEFINITIONS
    .map((item) => item.code)
    .filter((code) => code !== 'system.tenant.manage' && code !== 'platform.tenant.switch');

  return {
    base: Object.fromEntries(
      Array.from(grants.entries()).map(([roleCode, grant]) => [
        roleCode,
        {
          menuCodes: Array.from(grant.menuCodes),
          actionCodes: Array.from(grant.actionCodes),
        },
      ]),
    ) as Record<string, { menuCodes: string[]; actionCodes: string[] }>,
    tenantMenuCodes,
    tenantActionCodes,
  };
}

const GENERATED_ROLE_GRANTS = buildRolePermissionGrants();

const ROLE_PERMISSION_GRANTS: Record<
  string,
  {
    menuCodes: string[];
    actionCodes: string[];
    dataScopes?: Array<{ scopeType: string; scopeValues: Array<number | string> }>;
    featureFlags?: string[];
  }
> = {
  ...GENERATED_ROLE_GRANTS.base,
  admin: {
    menuCodes: GENERATED_ROLE_GRANTS.tenantMenuCodes,
    actionCodes: GENERATED_ROLE_GRANTS.tenantActionCodes,
    dataScopes: [{ scopeType: 'all', scopeValues: [] }],
    featureFlags: ['rbac_center', 'tenant_admin'],
  },
  tenant_admin: {
    menuCodes: GENERATED_ROLE_GRANTS.tenantMenuCodes,
    actionCodes: GENERATED_ROLE_GRANTS.tenantActionCodes,
    dataScopes: [{ scopeType: 'all', scopeValues: [] }],
    featureFlags: ['rbac_center', 'tenant_admin'],
  },
  boss: {
    ...(GENERATED_ROLE_GRANTS.base.boss ?? { menuCodes: [], actionCodes: [] }),
    dataScopes: [{ scopeType: 'all', scopeValues: [] }],
    featureFlags: ['rbac_center', 'tenant_admin'],
  },
  supervisor: {
    ...(GENERATED_ROLE_GRANTS.base.supervisor ?? { menuCodes: [], actionCodes: [] }),
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
    actionCodes: [...TENANT_RBAC_ACTION_CODES, 'system.audit.view'],
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

export function supportsFallbackPermissionRoles(roleCodes: string[]): boolean {
  return roleCodes.every((roleCode) => roleCode === 'platform_super_admin' || Boolean(ROLE_PERMISSION_GRANTS[roleCode]));
}

export function hasPermissionByRoles(roleCodes: string[], requiredPermissions: string[]): boolean {
  const snapshot = buildFallbackPermissionSnapshot(roleCodes);
  return requiredPermissions.some((permission) => snapshot.actionCodes.includes(permission));
}
