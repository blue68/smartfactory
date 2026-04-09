/**
 * [artifact:前端代码] — 侧边栏导航（权限过滤 + 折叠动画 + 分组标签）
 * T127: 对齐设计稿，新增 group 字段，按组渲染分组标签
 */

import { NavLink, useLocation } from 'react-router-dom';
import { ACTION_CODES, MENU_CODES } from '@/constants/accessControl';
import { useAuthStore } from '@/stores/authStore';
import { useAppStore } from '@/stores/appStore';
import { UserRole } from '@/types/enums';
import { matchesRoleAccess } from '@/utils/roleAccess';
import styles from './Sidebar.module.css';

interface NavItem {
  path: string;
  label: string;
  icon: string;
  roles: UserRole[];
  menuCode?: string;
  actionCode?: string;
  badge?: number;
  group: string;
}

const NAV_ITEMS: NavItem[] = [
  {
    path: '/platform/home',
    label: '平台工作台',
    icon: '🛰️',
    roles: [UserRole.PLATFORM_SUPER_ADMIN],
    group: '平台',
  },
  {
    path: '/dashboard',
    label: '老板驾驶舱',
    icon: '📊',
    roles: [UserRole.BOSS, UserRole.SUPERVISOR],
    menuCode: MENU_CODES.DASHBOARD,
    group: '概览',
  },
  {
    path: '/purchase/suggestions',
    label: 'AI 采购建议',
    icon: '🤖',
    roles: [UserRole.BOSS, UserRole.PURCHASER],
    menuCode: MENU_CODES.PURCHASE_SUGGESTION_BOARD,
    group: '采购',
  },
  {
    path: '/purchase/match',
    label: '三单匹配',
    icon: '🔗',
    roles: [UserRole.BOSS, UserRole.PURCHASER],
    menuCode: MENU_CODES.PURCHASE_MATCH,
    group: '采购',
  },
  {
    path: '/purchase/prices',
    label: '采购价格',
    icon: '💰',
    roles: [UserRole.BOSS, UserRole.PURCHASER],
    menuCode: MENU_CODES.PURCHASE_PRICE,
    group: '采购',
  },
  {
    path: '/purchase/purchase-suggestions',
    label: '采购建议管理',
    icon: '📋',
    roles: [UserRole.BOSS, UserRole.PURCHASER, UserRole.SUPERVISOR],
    menuCode: MENU_CODES.PURCHASE_SUGGESTION_MANAGE,
    group: '采购',
  },
  {
    path: '/purchase/orders',
    label: '采购订单',
    icon: '📄',
    roles: [UserRole.BOSS, UserRole.PURCHASER, UserRole.SUPERVISOR],
    menuCode: MENU_CODES.PURCHASE_ORDER,
    group: '采购',
  },
  {
    path: '/purchase/deliveries',
    label: '到货管理',
    icon: '🚚',
    roles: [UserRole.BOSS, UserRole.PURCHASER, UserRole.SUPERVISOR, UserRole.WAREHOUSE],
    menuCode: MENU_CODES.PURCHASE_DELIVERY,
    group: '采购',
  },
  {
    path: '/purchase/receipts',
    label: '入库记录',
    icon: '📥',
    roles: [UserRole.BOSS, UserRole.PURCHASER, UserRole.SUPERVISOR, UserRole.WAREHOUSE],
    menuCode: MENU_CODES.PURCHASE_RECEIPT,
    group: '采购',
  },
  {
    path: '/purchase/incoming-inspection',
    label: '来料质检',
    icon: '🔬',
    roles: [UserRole.BOSS, UserRole.QC, UserRole.PURCHASER, UserRole.SUPERVISOR],
    menuCode: MENU_CODES.PURCHASE_INCOMING_INSPECTION,
    group: '采购',
  },
  {
    path: '/purchase/returns',
    label: '退货管理',
    icon: '↩️',
    roles: [UserRole.BOSS, UserRole.PURCHASER, UserRole.SUPERVISOR],
    menuCode: MENU_CODES.PURCHASE_RETURN,
    group: '采购',
  },
  {
    path: '/purchase/settlements',
    label: '采购结算',
    icon: '💸',
    roles: [UserRole.BOSS, UserRole.PURCHASER, UserRole.SUPERVISOR],
    menuCode: MENU_CODES.PURCHASE_SETTLEMENT,
    group: '采购',
  },
  {
    path: '/sales/orders',
    label: '新建订单',
    icon: '📝',
    roles: [UserRole.BOSS, UserRole.SALES, UserRole.SUPERVISOR],
    menuCode: MENU_CODES.SALES_ORDER_CREATE,
    group: '销售',
  },
  {
    path: '/sales/order-list',
    label: '订单管理',
    icon: '📋',
    roles: [UserRole.BOSS, UserRole.SALES, UserRole.SUPERVISOR],
    menuCode: MENU_CODES.SALES_ORDER_LIST,
    group: '销售',
  },
  {
    path: '/sales/customers',
    label: '客户管理',
    icon: '👥',
    roles: [UserRole.BOSS, UserRole.SALES, UserRole.SUPERVISOR],
    menuCode: MENU_CODES.SALES_CUSTOMER,
    group: '销售',
  },
  {
    path: '/settlement',
    label: '销售结算',
    icon: '💳',
    roles: [UserRole.BOSS, UserRole.SALES, UserRole.SUPERVISOR],
    menuCode: MENU_CODES.SALES_SETTLEMENT,
    group: '销售',
  },
  {
    path: '/schedule-suggestions',
    label: '智能调度',
    icon: '🧠',
    roles: [UserRole.BOSS, UserRole.SUPERVISOR, UserRole.PURCHASER],
    menuCode: MENU_CODES.SCHEDULE_SUGGESTION,
    group: '生产',
  },
  {
    path: '/production/schedule',
    label: '排产计划',
    icon: '🏭',
    roles: [UserRole.ADMIN, UserRole.BOSS, UserRole.SUPERVISOR],
    menuCode: MENU_CODES.PRODUCTION_SCHEDULE,
    group: '生产',
  },
  {
    path: '/production/tasks',
    label: '生产任务',
    icon: '🔨',
    roles: [UserRole.ADMIN, UserRole.BOSS, UserRole.SUPERVISOR, UserRole.WORKER],
    menuCode: MENU_CODES.PRODUCTION_TASK,
    group: '生产',
  },
  {
    path: '/production/orders',
    label: '生产工单',
    icon: '📑',
    roles: [UserRole.ADMIN, UserRole.BOSS, UserRole.SUPERVISOR],
    menuCode: MENU_CODES.PRODUCTION_ORDER,
    group: '生产',
  },
  {
    path: '/production/shortage',
    label: '缺料看板',
    icon: '⚠️',
    roles: [UserRole.BOSS, UserRole.SUPERVISOR, UserRole.PURCHASER],
    menuCode: MENU_CODES.PRODUCTION_SHORTAGE,
    group: '生产',
  },
  {
    path: '/inventory',
    label: '库存总览',
    icon: '📦',
    roles: [UserRole.BOSS, UserRole.WAREHOUSE, UserRole.PURCHASER, UserRole.SUPERVISOR],
    menuCode: MENU_CODES.INVENTORY,
    group: '仓库',
  },
  {
    path: '/stocktaking',
    label: '库存盘点',
    icon: '📝',
    roles: [UserRole.BOSS, UserRole.WAREHOUSE, UserRole.SUPERVISOR],
    menuCode: MENU_CODES.STOCKTAKING,
    group: '仓库',
  },
  {
    path: '/quality/trace',
    label: '质量溯源',
    icon: '🔍',
    roles: [UserRole.BOSS, UserRole.QC, UserRole.SUPERVISOR, UserRole.SALES],
    menuCode: MENU_CODES.QUALITY_TRACE,
    group: '质量',
  },
  {
    path: '/master-data/sku',
    label: 'SKU 主数据',
    icon: '🗂️',
    roles: [UserRole.BOSS, UserRole.PURCHASER, UserRole.WAREHOUSE, UserRole.SUPERVISOR],
    menuCode: MENU_CODES.MASTER_DATA_SKU,
    group: '主数据',
  },
  {
    path: '/master-data/warehouse-location',
    label: '仓库库位配置',
    icon: '🏬',
    roles: [UserRole.ADMIN, UserRole.BOSS, UserRole.PURCHASER, UserRole.WAREHOUSE, UserRole.SUPERVISOR],
    menuCode: MENU_CODES.MASTER_DATA_WAREHOUSE_LOCATION,
    group: '主数据',
  },
  {
    path: '/master-data/bom',
    label: 'BOM 管理',
    icon: '🔧',
    roles: [UserRole.BOSS, UserRole.SUPERVISOR, UserRole.PURCHASER],
    menuCode: MENU_CODES.MASTER_DATA_BOM,
    group: '主数据',
  },
  {
    path: '/master-data/supplier',
    label: '供应商管理',
    icon: '🏢',
    roles: [UserRole.BOSS, UserRole.PURCHASER, UserRole.SUPERVISOR],
    menuCode: MENU_CODES.MASTER_DATA_SUPPLIER,
    group: '主数据',
  },
  {
    path: '/master-data/process-config',
    label: '工序配置',
    icon: '⚡',
    roles: [UserRole.BOSS, UserRole.SUPERVISOR],
    menuCode: MENU_CODES.MASTER_DATA_PROCESS_CONFIG,
    group: '主数据',
  },
  {
    path: '/master-data/sku-process',
    label: 'SKU工序配置',
    icon: '🔗',
    roles: [UserRole.BOSS, UserRole.SUPERVISOR],
    menuCode: MENU_CODES.MASTER_DATA_SKU_PROCESS,
    group: '主数据',
  },
  {
    path: '/master-data/sku-category',
    label: '类目配置',
    icon: '📁',
    roles: [UserRole.BOSS, UserRole.SUPERVISOR],
    menuCode: MENU_CODES.MASTER_DATA_SKU_CATEGORY,
    group: '主数据',
  },
  {
    path: '/analytics',
    label: '经营分析',
    icon: '📊',
    roles: [UserRole.BOSS, UserRole.SUPERVISOR],
    menuCode: MENU_CODES.ANALYTICS,
    group: '报表',
  },
  {
    path: '/report/wages',
    label: '工资报表',
    icon: '📈',
    roles: [UserRole.BOSS, UserRole.SUPERVISOR],
    menuCode: MENU_CODES.REPORT_WAGE,
    group: '报表',
  },
  {
    path: '/report/my-wages',
    label: '我的工资',
    icon: '💵',
    roles: [UserRole.BOSS, UserRole.SUPERVISOR, UserRole.WORKER],
    menuCode: MENU_CODES.REPORT_MY_WAGE,
    group: '报表',
  },
  {
    path: '/notifications',
    label: '通知中心',
    icon: '🔔',
    roles: [UserRole.BOSS, UserRole.PURCHASER, UserRole.SUPERVISOR, UserRole.SALES, UserRole.WAREHOUSE, UserRole.WORKER, UserRole.QC],
    menuCode: MENU_CODES.NOTIFICATION,
    group: '系统',
  },
  {
    path: '/system/tenants',
    label: '租户配置',
    icon: '🏢',
    roles: [UserRole.ADMIN, UserRole.BOSS, UserRole.SUPERVISOR],
    menuCode: MENU_CODES.SYSTEM_TENANT_CONFIG,
    group: '系统管理',
  },
  {
    path: '/system/menus',
    label: '菜单与功能',
    icon: '🧭',
    roles: [UserRole.ADMIN, UserRole.BOSS, UserRole.SUPERVISOR],
    menuCode: MENU_CODES.SYSTEM_MENU_CONFIG,
    group: '系统管理',
  },
  {
    path: '/system/roles',
    label: '角色配置',
    icon: '🧩',
    roles: [UserRole.ADMIN, UserRole.BOSS, UserRole.SUPERVISOR],
    menuCode: MENU_CODES.SYSTEM_ROLE_CONFIG,
    group: '系统管理',
  },
  {
    path: '/system/users',
    label: '人员配置',
    icon: '👤',
    roles: [UserRole.ADMIN, UserRole.BOSS, UserRole.SUPERVISOR],
    menuCode: MENU_CODES.SYSTEM_USER_CONFIG,
    group: '系统管理',
  },
  {
    path: '/system/role-permissions',
    label: '角色授权',
    icon: '🔐',
    roles: [UserRole.ADMIN, UserRole.BOSS, UserRole.SUPERVISOR],
    menuCode: MENU_CODES.SYSTEM_ROLE_PERMISSION_CONFIG,
    group: '系统管理',
  },
  {
    path: '/system/user-role-assignments',
    label: '人员角色分配',
    icon: '🗃️',
    roles: [UserRole.ADMIN, UserRole.BOSS, UserRole.SUPERVISOR],
    menuCode: MENU_CODES.SYSTEM_USER_ROLE_ASSIGNMENT,
    group: '系统管理',
  },
  {
    path: '/system/audit-logs',
    label: '权限审计',
    icon: '🧾',
    roles: [UserRole.ADMIN, UserRole.BOSS],
    actionCode: ACTION_CODES.SYSTEM_AUDIT_VIEW,
    group: '系统管理',
  },
  {
    path: '/ai-chat',
    label: 'AI 助手',
    icon: '💬',
    roles: [UserRole.BOSS, UserRole.PURCHASER, UserRole.SUPERVISOR, UserRole.SALES],
    menuCode: MENU_CODES.AI_CHAT,
    group: 'AI',
  },
];

/** 按 group 字段聚合，保留原始顺序中各组首次出现的顺序 */
function groupNavItems(items: NavItem[]): Array<{ group: string; items: NavItem[] }> {
  const groupMap = new Map<string, NavItem[]>();
  for (const item of items) {
    if (!groupMap.has(item.group)) {
      groupMap.set(item.group, []);
    }
    groupMap.get(item.group)!.push(item);
  }
  return Array.from(groupMap.entries()).map(([group, items]) => ({ group, items }));
}

export default function Sidebar() {
  const { user, permissionSnapshot } = useAuthStore();
  const { sidebarCollapsed } = useAppStore();
  // useLocation 保留：确保路由变化时组件重新渲染（active 状态依赖）
  useLocation();

  const menuCodeSet = permissionSnapshot
    ? new Set(permissionSnapshot.menuCodes)
    : null;
  const actionCodeSet = permissionSnapshot
    ? new Set(permissionSnapshot.actionCodes)
    : null;

  const visibleItems = NAV_ITEMS.filter((item) => {
    if (menuCodeSet && item.menuCode) {
      return menuCodeSet.has(item.menuCode);
    }
    if (actionCodeSet && item.actionCode) {
      return actionCodeSet.has(item.actionCode);
    }
    return matchesRoleAccess(user?.roles, item.roles, user?.scopeLevel);
  });

  const groupedItems = groupNavItems(visibleItems);

  return (
    <nav className={`${styles.sidebar} ${sidebarCollapsed ? styles['sidebar--collapsed'] : ''}`} aria-label="主导航">
      {/* Logo 区域 */}
      <div className={styles.sidebar__logo}>
        <span className={styles.sidebar__logo_icon} aria-hidden="true">⚙️</span>
        {!sidebarCollapsed && (
          <span className={styles.sidebar__logo_text}>智造管家</span>
        )}
      </div>

      {/* 导航菜单（按分组渲染） */}
      <div className={styles.sidebar__menu} role="navigation" aria-label="功能导航">
        {groupedItems.map(({ group, items }) => (
          <div key={group} className={styles.sidebar__group}>
            {/* 展开模式下显示分组标签，折叠模式下隐藏 */}
            {!sidebarCollapsed && (
              <div className={styles.sidebar__group_label} aria-hidden="true">
                {group}
              </div>
            )}
            <ul role="list" className={styles.sidebar__group_list}>
              {items.map((item) => (
                <li key={item.path}>
                  <NavLink
                    to={item.path}
                    className={({ isActive }) =>
                      [styles.sidebar__item, isActive ? styles['sidebar__item--active'] : ''].join(' ')
                    }
                    title={sidebarCollapsed ? item.label : undefined}
                  >
                    <span className={styles.sidebar__icon} aria-hidden="true">
                      {item.icon}
                    </span>
                    {!sidebarCollapsed && (
                      <span className={styles.sidebar__label}>{item.label}</span>
                    )}
                    {item.badge && item.badge > 0 && (
                      <span className={styles.sidebar__badge} aria-label={`${item.badge}条待处理`}>
                        {item.badge > 99 ? '99+' : item.badge}
                      </span>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {/* 用户信息（底部） */}
      {!sidebarCollapsed && user && (
        <div className={styles.sidebar__user}>
          <div className={styles.sidebar__user_avatar} aria-hidden="true">
            {user.realName.charAt(0)}
          </div>
          <div className={styles.sidebar__user_info}>
            <div className={styles.sidebar__user_name}>{user.realName}</div>
            <div className={styles.sidebar__user_role}>{user.tenantName}</div>
          </div>
        </div>
      )}
    </nav>
  );
}
