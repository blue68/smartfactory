/**
 * [artifact:前端代码] — 侧边栏导航（权限过滤 + 折叠动画 + 分组标签）
 * T127: 对齐设计稿，新增 group 字段，按组渲染分组标签
 */

import { NavLink, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { useAppStore } from '@/stores/appStore';
import { UserRole } from '@/types/enums';
import styles from './Sidebar.module.css';

interface NavItem {
  path: string;
  label: string;
  icon: string;
  roles: UserRole[];
  badge?: number;
  group: string;
}

const NAV_ITEMS: NavItem[] = [
  {
    path: '/dashboard',
    label: '老板驾驶舱',
    icon: '📊',
    roles: [UserRole.BOSS, UserRole.SUPERVISOR],
    group: '概览',
  },
  {
    path: '/purchase/suggestions',
    label: 'AI 采购建议',
    icon: '🤖',
    roles: [UserRole.BOSS, UserRole.PURCHASER],
    group: '采购',
  },
  {
    path: '/purchase/match',
    label: '三单匹配',
    icon: '🔗',
    roles: [UserRole.BOSS, UserRole.PURCHASER],
    group: '采购',
  },
  {
    path: '/purchase/prices',
    label: '采购价格',
    icon: '💰',
    roles: [UserRole.BOSS, UserRole.PURCHASER],
    group: '采购',
  },
  {
    path: '/purchase/purchase-suggestions',
    label: '采购建议管理',
    icon: '📋',
    roles: [UserRole.BOSS, UserRole.PURCHASER, UserRole.SUPERVISOR],
    group: '采购',
  },
  {
    path: '/purchase/incoming-inspection',
    label: '来料质检',
    icon: '🔬',
    roles: [UserRole.BOSS, UserRole.QC, UserRole.PURCHASER, UserRole.SUPERVISOR],
    group: '采购',
  },
  {
    path: '/purchase/returns',
    label: '退货管理',
    icon: '↩️',
    roles: [UserRole.BOSS, UserRole.PURCHASER, UserRole.SUPERVISOR],
    group: '采购',
  },
  {
    path: '/sales/orders',
    label: '新建订单',
    icon: '📝',
    roles: [UserRole.BOSS, UserRole.SALES, UserRole.SUPERVISOR],
    group: '销售',
  },
  {
    path: '/sales/order-list',
    label: '订单管理',
    icon: '📋',
    roles: [UserRole.BOSS, UserRole.SALES, UserRole.SUPERVISOR],
    group: '销售',
  },
  {
    path: '/sales/customers',
    label: '客户管理',
    icon: '👥',
    roles: [UserRole.BOSS, UserRole.SALES, UserRole.SUPERVISOR],
    group: '销售',
  },
  {
    path: '/production/schedule',
    label: '排产计划',
    icon: '🏭',
    roles: [UserRole.BOSS, UserRole.SUPERVISOR],
    group: '生产',
  },
  {
    path: '/production/tasks',
    label: '生产任务',
    icon: '🔨',
    roles: [UserRole.BOSS, UserRole.SUPERVISOR, UserRole.WORKER],
    group: '生产',
  },
  {
    path: '/production/orders',
    label: '生产工单',
    icon: '📑',
    roles: [UserRole.BOSS, UserRole.SUPERVISOR],
    group: '生产',
  },
  {
    path: '/production/shortage',
    label: '缺料看板',
    icon: '⚠️',
    roles: [UserRole.BOSS, UserRole.SUPERVISOR, UserRole.PURCHASER],
    group: '生产',
  },
  {
    path: '/inventory',
    label: '库存总览',
    icon: '📦',
    roles: [UserRole.BOSS, UserRole.WAREHOUSE, UserRole.PURCHASER, UserRole.SUPERVISOR],
    group: '仓库',
  },
  {
    path: '/quality/trace',
    label: '质量溯源',
    icon: '🔍',
    roles: [UserRole.BOSS, UserRole.QC, UserRole.SUPERVISOR, UserRole.SALES],
    group: '质量',
  },
  {
    path: '/master-data/sku',
    label: 'SKU 主数据',
    icon: '🗂️',
    roles: [UserRole.BOSS, UserRole.PURCHASER, UserRole.WAREHOUSE, UserRole.SUPERVISOR],
    group: '主数据',
  },
  {
    path: '/master-data/bom',
    label: 'BOM 管理',
    icon: '🔧',
    roles: [UserRole.BOSS, UserRole.SUPERVISOR, UserRole.PURCHASER],
    group: '主数据',
  },
  {
    path: '/master-data/supplier',
    label: '供应商管理',
    icon: '🏢',
    roles: [UserRole.BOSS, UserRole.PURCHASER, UserRole.SUPERVISOR],
    group: '主数据',
  },
  {
    path: '/master-data/process-config',
    label: '工序配置',
    icon: '⚡',
    roles: [UserRole.BOSS, UserRole.SUPERVISOR],
    group: '主数据',
  },
  {
    path: '/master-data/sku-category',
    label: '类目配置',
    icon: '📁',
    roles: [UserRole.BOSS, UserRole.SUPERVISOR],
    group: '主数据',
  },
  {
    path: '/report/wages',
    label: '工资报表',
    icon: '📈',
    roles: [UserRole.BOSS, UserRole.SUPERVISOR],
    group: '报表',
  },
  {
    path: '/report/my-wages',
    label: '我的工资',
    icon: '💵',
    roles: [UserRole.BOSS, UserRole.SUPERVISOR, UserRole.WORKER],
    group: '报表',
  },
  {
    path: '/ai-chat',
    label: 'AI 助手',
    icon: '💬',
    roles: [UserRole.BOSS, UserRole.PURCHASER, UserRole.SUPERVISOR, UserRole.SALES],
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
  const { user } = useAuthStore();
  const { sidebarCollapsed } = useAppStore();
  // useLocation 保留：确保路由变化时组件重新渲染（active 状态依赖）
  useLocation();

  const visibleItems = NAV_ITEMS.filter(
    (item) => user?.roles?.some((r) => item.roles.includes(r)) ?? false,
  );

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
