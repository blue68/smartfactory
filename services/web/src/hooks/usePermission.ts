/**
 * [artifact:前端代码] — 权限 Hook
 * 基于角色的权限判断，对应 API 文档第十一节
 */

import { useAuthStore } from '@/stores/authStore';
import { UserRole } from '@/types/enums';

/** 功能权限映射：操作 → 允许的角色列表 */
const PERMISSION_MAP = {
  // 仪表盘
  'dashboard:view': [UserRole.BOSS, UserRole.SUPERVISOR, UserRole.PURCHASER, UserRole.SALES],

  // SKU 主数据
  'sku:view': [UserRole.BOSS, UserRole.PURCHASER, UserRole.WAREHOUSE, UserRole.SUPERVISOR],
  'sku:create': [UserRole.BOSS, UserRole.PURCHASER],
  'sku:edit': [UserRole.BOSS, UserRole.PURCHASER],

  // BOM
  'bom:view': [UserRole.BOSS, UserRole.SUPERVISOR, UserRole.PURCHASER],
  'bom:create': [UserRole.BOSS, UserRole.SUPERVISOR],
  'bom:activate': [UserRole.BOSS, UserRole.SUPERVISOR],

  // 库存
  'inventory:view': [
    UserRole.BOSS,
    UserRole.WAREHOUSE,
    UserRole.PURCHASER,
    UserRole.SUPERVISOR,
  ],
  'inventory:inbound': [UserRole.BOSS, UserRole.WAREHOUSE, UserRole.PURCHASER],
  'inventory:outbound': [UserRole.BOSS, UserRole.WAREHOUSE, UserRole.SUPERVISOR],

  // 采购建议
  'purchase:suggestion:view': [UserRole.BOSS, UserRole.PURCHASER],
  'purchase:suggestion:generate': [UserRole.BOSS, UserRole.PURCHASER],
  'purchase:suggestion:approve': [UserRole.BOSS],

  // 采购订单
  'purchase:order:view': [UserRole.BOSS, UserRole.PURCHASER],
  'purchase:order:create': [UserRole.BOSS, UserRole.PURCHASER],
  'purchase:order:delivery': [UserRole.PURCHASER],

  // 三单匹配
  'purchase:match:execute': [UserRole.PURCHASER],
  'purchase:match:confirm': [UserRole.PURCHASER],

  // 销售订单
  'sales:order:view': [UserRole.BOSS, UserRole.SALES, UserRole.SUPERVISOR],
  'sales:order:create': [UserRole.BOSS, UserRole.SALES],
  'sales:order:approve': [UserRole.BOSS],
  'sales:order:urgent-analyze': [UserRole.BOSS, UserRole.SALES, UserRole.SUPERVISOR],

  // 生产工单
  'production:order:view': [UserRole.BOSS, UserRole.SUPERVISOR, UserRole.WORKER],
  'production:order:create': [UserRole.BOSS, UserRole.SUPERVISOR],
  'production:schedule:view': [UserRole.BOSS, UserRole.SUPERVISOR],
  'production:schedule:generate': [UserRole.BOSS, UserRole.SUPERVISOR],
  'production:schedule:confirm': [UserRole.BOSS, UserRole.SUPERVISOR],
  'production:task:complete': [UserRole.WORKER, UserRole.SUPERVISOR],

  // 质量
  'quality:view': [
    UserRole.BOSS,
    UserRole.QC,
    UserRole.SUPERVISOR,
    UserRole.SALES,
  ],
  'quality:create': [UserRole.QC, UserRole.SUPERVISOR],
  'quality:issue:create': [UserRole.QC],
  'quality:complete': [UserRole.QC],
} as const;

export type PermissionKey = keyof typeof PERMISSION_MAP;

export function usePermission() {
  const { user } = useAuthStore();

  const can = (permission: PermissionKey): boolean => {
    if (!user?.roles?.length) return false;
    const allowed = PERMISSION_MAP[permission] as readonly UserRole[];
    return user.roles.some((role) => allowed.includes(role));
  };

  const canAny = (permissions: PermissionKey[]): boolean => {
    return permissions.some((p) => can(p));
  };

  const canAll = (permissions: PermissionKey[]): boolean => {
    return permissions.every((p) => can(p));
  };

  return { can, canAny, canAll };
}
