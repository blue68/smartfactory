/**
 * [artifact:前端代码] — 顶部导航栏（含面包屑 T128）
 */

import { useState, useCallback, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { useAppStore } from '@/stores/appStore';
import { useAuth } from '@/hooks/useAuth';
import { useAuthStore } from '@/stores/authStore';
import { authApi } from '@/api/auth';
import { UserRole } from '@/types/enums';
import Breadcrumb, { BreadcrumbItem } from '@/components/common/Breadcrumb';
import styles from './Header.module.css';

interface HeaderProps {
  onAiSearch?: (query: string) => void;
}

/**
 * pathname -> 面包屑 items 映射表
 * 格式：{ label, group } — group 作为中间层级
 */
const PATH_MAP: Record<string, { label: string; group: string }> = {
  '/platform/home':              { label: '平台工作台',   group: '平台' },
  '/dashboard':                  { label: '老板驾驶舱',   group: '概览' },
  '/purchase/suggestions':       { label: 'AI 采购建议', group: '采购' },
  '/purchase/match':             { label: '三单匹配',    group: '采购' },
  '/purchase/prices':            { label: '采购价格',    group: '采购' },
  '/purchase/settlements':       { label: '采购结算',    group: '采购' },
  '/sales/orders':               { label: '新建订单',    group: '销售' },
  '/sales/order-list':           { label: '订单管理',    group: '销售' },
  '/sales/customers':            { label: '客户管理',    group: '销售' },
  '/production/schedule':        { label: '排产计划',    group: '生产' },
  '/production/tasks':           { label: '生产任务',    group: '生产' },
  '/inventory':                  { label: '库存总览',    group: '仓库' },
  '/quality/trace':              { label: '质量溯源',    group: '质量' },
  '/master-data/sku':            { label: 'SKU 主数据',  group: '主数据' },
  '/master-data/warehouse-location': { label: '仓库库位配置', group: '主数据' },
  '/master-data/bom':            { label: 'BOM 管理',   group: '主数据' },
  '/master-data/supplier':       { label: '供应商管理',  group: '主数据' },
  '/master-data/process-config': { label: '工序配置',    group: '主数据' },
  '/report/inventory-operation': { label: '库存经营',    group: '报表' },
  '/ai-chat':                    { label: 'AI 助手',    group: 'AI' },
};

/** 根据当前 pathname 生成面包屑 items */
function buildBreadcrumbs(pathname: string): BreadcrumbItem[] {
  const entry = PATH_MAP[pathname];
  if (!entry) {
    // 未命中映射：只展示首页
    return [{ label: '首页', path: '/dashboard' }];
  }
  const items: BreadcrumbItem[] = [{ label: '首页', path: '/dashboard' }];
  // 中间层：分组名（无路径，不可点击）
  items.push({ label: entry.group });
  // 末项：当前页面（无 path，不可点击）
  items.push({ label: entry.label });
  return items;
}

export default function Header({ onAiSearch }: HeaderProps) {
  const { toggleSidebar, sidebarCollapsed, pageTitle, toggleAiPanel, showToast } = useAppStore();
  const { user, logout } = useAuth();
  const setAuth = useAuthStore((s) => s.setAuth);
  const location = useLocation();
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [exitingTenant, setExitingTenant] = useState(false);

  const breadcrumbItems = useMemo(
    () => buildBreadcrumbs(location.pathname),
    [location.pathname],
  );
  const isPlatformSuperAdmin = user?.roles?.includes(UserRole.PLATFORM_SUPER_ADMIN) ?? false;
  const isManagedTenantContext = isPlatformSuperAdmin && user?.originTenantId === 0 && user?.contextTenantId !== null;
  const hideAiEntry = user?.scopeLevel === 'platform';
  const contextLabel = user?.scopeLevel === 'platform'
    ? '平台态'
    : isManagedTenantContext
      ? `代管租户 · ${user?.tenantName}`
      : `租户态 · ${user?.tenantName}`;

  const handleSearchSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (searchQuery.trim()) {
        toggleAiPanel();
        onAiSearch?.(searchQuery.trim());
        setSearchQuery('');
      }
    },
    [searchQuery, toggleAiPanel, onAiSearch],
  );

  const handleExitTenantContext = useCallback(async () => {
    setExitingTenant(true);
    try {
      const data = await authApi.exitTenantContext();
      setAuth(data.user, data.accessToken, data.permissionSnapshot ?? null);
      setUserMenuOpen(false);
      // 当前页通常是租户态专属页面，先落平台态登录信息，再强制跳到平台仍可访问的入口，避免被守卫重定向到 /dashboard。
      window.location.replace('/system/tenants');
    } catch (error) {
      showToast({ type: 'error', message: (error as Error).message || '退出租户上下文失败' });
    } finally {
      setExitingTenant(false);
    }
  }, [setAuth, showToast]);

  return (
    <header className={styles.topbar} role="banner">
      {/* 左侧：折叠按钮 + 面包屑导航 */}
      <div className={styles.topbar__left}>
        <button
          className={styles.topbar__collapse_btn}
          onClick={toggleSidebar}
          aria-label={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
          title={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
        >
          <span aria-hidden="true">☰</span>
        </button>
        <div className={styles.topbar__title_area}>
          <h1 className={styles.topbar__title}>{pageTitle}</h1>
          <Breadcrumb items={breadcrumbItems} />
        </div>
      </div>

      {/* 中部：AI 全局搜索框 */}
      {!hideAiEntry && (
        <form
          className={`${styles.topbar__search} ${searchFocused ? styles['topbar__search--focused'] : ''}`}
          onSubmit={handleSearchSubmit}
          role="search"
        >
          <span className={styles.topbar__search_icon} aria-hidden="true">🤖</span>
          <input
            type="search"
            className={styles.topbar__search_input}
            placeholder="问 AI 任何问题..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            aria-label="AI 智能搜索"
          />
          {searchQuery && (
            <button type="submit" className={styles.topbar__search_submit} aria-label="提交搜索">
              →
            </button>
          )}
        </form>
      )}

      {/* 右侧：AI 面板 + 通知 + 用户 */}
      <div className={styles.topbar__right}>
        {user && (
          <div className={styles.topbar__user_name} title={contextLabel}>
            {contextLabel}
          </div>
        )}
        {/* AI 对话按钮 */}
        {!hideAiEntry && (
          <button
            className={styles.topbar__ai_btn}
            onClick={toggleAiPanel}
            aria-label="打开 AI 助手"
            title="AI 助手"
          >
            <span aria-hidden="true">💬</span>
            <span className={styles.topbar__ai_label}>AI 助手</span>
          </button>
        )}

        {/* 用户菜单 */}
        <div className={styles.topbar__user}>
          <button
            className={styles.topbar__user_btn}
            onClick={() => setUserMenuOpen((v) => !v)}
            aria-label="用户菜单"
            aria-expanded={userMenuOpen}
            aria-haspopup="menu"
          >
            <div className={styles.topbar__avatar} aria-hidden="true">
              {user?.realName?.charAt(0) ?? '?'}
            </div>
            <span className={styles.topbar__user_name}>{user?.realName}</span>
            <span aria-hidden="true" className={styles.topbar__caret}>▾</span>
          </button>

          {userMenuOpen && (
            <>
              <div
                className={styles.topbar__overlay}
                onClick={() => setUserMenuOpen(false)}
                aria-hidden="true"
              />
              <ul className={styles.topbar__menu} role="menu" aria-label="用户操作">
                <li role="none">
                  <div className={styles.topbar__menu_info}>
                    <div className={styles.topbar__menu_name}>{user?.realName}</div>
                    <div className={styles.topbar__menu_tenant}>{user?.tenantName}</div>
                  </div>
                </li>
                <li role="none">
                  <hr className={styles.topbar__menu_divider} />
                </li>
                {isManagedTenantContext && (
                  <li role="none">
                    <button
                      className={styles.topbar__menu_item}
                      role="menuitem"
                      onClick={() => void handleExitTenantContext()}
                      disabled={exitingTenant}
                    >
                      <span aria-hidden="true">↩</span> 返回平台态
                    </button>
                  </li>
                )}
                <li role="none">
                  <button
                    className={styles.topbar__menu_item}
                    role="menuitem"
                    onClick={() => { setUserMenuOpen(false); logout(); }}
                  >
                    <span aria-hidden="true">🚪</span> 退出登录
                  </button>
                </li>
              </ul>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
