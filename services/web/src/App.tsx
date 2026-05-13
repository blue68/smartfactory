/**
 * [artifact:前端代码] — 根组件（路由配置 + 权限守卫）
 */

import { Suspense, lazy, useEffect, useRef, type ReactElement } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { BrowserRouter, Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { ACTION_CODES, MENU_CODES } from '@/constants/accessControl';
import { UserRole } from '@/types/enums';
import { matchesRoleAccess } from '@/utils/roleAccess';

const AppLayout = lazy(() => import('@/components/Layout/AppLayout'));
const DashboardPage = lazy(() => import('@/pages/dashboard/DashboardPage'));
const InventoryPage = lazy(() => import('@/pages/inventory/InventoryPage'));
const SuggestionPage = lazy(() => import('@/pages/purchase/SuggestionPage'));
const MatchPage = lazy(() => import('@/pages/purchase/MatchPage'));
const OrderPage = lazy(() => import('@/pages/sales/OrderPage'));
const SchedulePage = lazy(() => import('@/pages/production/SchedulePage'));
const SkuPage = lazy(() => import('@/pages/master-data/SkuPage'));
const BomPage = lazy(() => import('@/pages/master-data/BomPage'));
const TracePage = lazy(() => import('@/pages/quality/TracePage'));
const SupplierPage = lazy(() => import('@/pages/master-data/SupplierPage'));
const ProcessConfigPage = lazy(() => import('@/pages/master-data/ProcessConfigPage'));
const SkuProcessPage = lazy(() => import('@/pages/master-data/SkuProcessPage'));
const PricePage = lazy(() => import('@/pages/purchase/PricePage'));
const AiChatPage = lazy(() => import('@/pages/ai/AiChatPage'));
const CustomerPage = lazy(() => import('@/pages/sales/CustomerPage'));
const SalesOrderListPage = lazy(() => import('@/pages/sales/SalesOrderListPage'));
const TaskPage = lazy(() => import('@/pages/production/TaskPage'));
const CategoryConfigPage = lazy(() => import('@/pages/master-data/CategoryConfigPage'));
const WarehouseLocationPage = lazy(() => import('@/pages/master-data/WarehouseLocationPage'));
const WageReportPage = lazy(() => import('@/pages/report/WageReportPage'));
const MyWagePage = lazy(() => import('@/pages/report/MyWagePage'));
const SemiFinishedModeReportPage = lazy(() => import('@/pages/report/SemiFinishedModeReportPage'));
const InventoryOperationReportPage = lazy(() => import('@/pages/report/InventoryOperationReportPage'));
const LoginPage = lazy(() => import('@/pages/auth/LoginPage'));
const MobileOpsPage = lazy(() => import('@/pages/mobile/MobileOpsPage'));
const ProductionOrderPage = lazy(() => import('@/pages/production/ProductionOrderPage'));
const ShortageBoard = lazy(() => import('@/pages/production/ShortageBoard'));
const PurchaseSuggestionPage = lazy(() => import('@/pages/purchase/PurchaseSuggestionPage'));
const PurchaseOrderPage = lazy(() => import('@/pages/purchase/PurchaseOrderPage'));
const PurchaseDeliveryPage = lazy(() => import('@/pages/purchase/PurchaseDeliveryPage'));
const PurchaseReceiptPage = lazy(() => import('@/pages/purchase/PurchaseReceiptPage'));
const IncomingInspectionPage = lazy(() => import('@/pages/purchase/IncomingInspectionPage'));
const ReturnOrderPage = lazy(() => import('@/pages/purchase/ReturnOrderPage'));
const PurchaseSettlementPage = lazy(() => import('@/pages/purchase/PurchaseSettlementPage'));
const ConsumableIssuePage = lazy(() => import('@/pages/consumables/ConsumableIssuePage'));
const AssetAcceptancePage = lazy(() => import('@/pages/assets/AssetAcceptancePage'));
const AssetLedgerPage = lazy(() => import('@/pages/assets/AssetLedgerPage'));
const ScheduleSuggestionPage = lazy(() => import('@/pages/schedule/ScheduleSuggestionPage'));
const NotificationPage = lazy(() => import('@/pages/notification/NotificationPage'));
const StocktakingPage = lazy(() => import('@/pages/stocktaking/StocktakingPage'));
const SettlementPage = lazy(() => import('@/pages/settlement/SettlementPage'));
const AnalyticsPage = lazy(() => import('@/pages/analytics/AnalyticsPage'));
const NotFoundPage = lazy(() => import('@/pages/NotFoundPage'));
const TenantConfigPage = lazy(() => import('@/pages/system/TenantConfigPage'));
const MenuFeaturePage = lazy(() => import('@/pages/system/MenuFeaturePage'));
const RoleConfigPage = lazy(() => import('@/pages/system/RoleConfigPage'));
const UserConfigPage = lazy(() => import('@/pages/system/UserConfigPage'));
const RoleGrantPage = lazy(() => import('@/pages/system/RoleGrantPage'));
const UserRoleAssignmentPage = lazy(() => import('@/pages/system/UserRoleAssignmentPage'));
const SystemAuditPage = lazy(() => import('@/pages/system/SystemAuditPage'));
const PlatformHomePage = lazy(() => import('@/pages/system/PlatformHomePage'));
const DesignSystemPage = lazy(() => import('@/pages/system/DesignSystemPage'));

function renderRouteElement(element: ReactElement) {
  return (
    <Suspense fallback={<div style={{ padding: 24, color: 'var(--text-secondary)' }}>页面加载中...</div>}>
      {element}
    </Suspense>
  );
}

const ROUTE_INACTIVE_QUERY_CLEANUP_DELAY_MS = 1200;

/**
 * Route-level memory guard.
 *
 * React Query deliberately keeps inactive page data alive for fast back/forward
 * navigation. In this ERP shell, users often scan through many heavy menus in
 * one session, so keeping old list/detail/chart payloads around quickly creates
 * a staircase-shaped heap profile. After the new route has mounted, inactive
 * queries are cancelled and removed so only the current screen keeps data.
 */
function RouteMemoryGuard() {
  const location = useLocation();
  const queryClient = useQueryClient();
  const previousPathRef = useRef(location.pathname);

  useEffect(() => {
    if (previousPathRef.current === location.pathname) return undefined;
    previousPathRef.current = location.pathname;

    const timer = window.setTimeout(() => {
      void queryClient.cancelQueries({ type: 'inactive' });
      queryClient.removeQueries({ type: 'inactive' });
    }, ROUTE_INACTIVE_QUERY_CLEANUP_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [location.pathname, queryClient]);

  return null;
}

/** 认证守卫：未登录跳转 /login */
function RequireAuth() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const location = useLocation();
  if (!isAuthenticated) {
    const redirectPath = `${location.pathname}${location.search}${location.hash}`;
    return <Navigate to="/login" replace state={{ from: redirectPath }} />;
  }
  return <Outlet />;
}

function DefaultHomeRedirect() {
  const user = useAuthStore((s) => s.user);
  return <Navigate to={user?.scopeLevel === 'platform' ? '/platform/home' : '/dashboard'} replace />;
}

function RequirePlatformScope() {
  const user = useAuthStore((s) => s.user);
  if (user?.scopeLevel !== 'platform') {
    return <Navigate to="/dashboard" replace />;
  }
  return <Outlet />;
}

function DashboardRoute() {
  const user = useAuthStore((s) => s.user);
  if (user?.scopeLevel === 'platform') {
    return <Navigate to="/platform/home" replace />;
  }
  return renderRouteElement(<DashboardPage />);
}

function AiChatRoute() {
  const user = useAuthStore((s) => s.user);
  if (user?.scopeLevel === 'platform') {
    return <Navigate to="/platform/home" replace />;
  }
  return renderRouteElement(<AiChatPage />);
}

function RequireMenuAccess({
  menuCode,
  fallbackRoles,
}: {
  menuCode: string;
  fallbackRoles: UserRole[];
}) {
  const user = useAuthStore((s) => s.user);
  const permissionSnapshot = useAuthStore((s) => s.permissionSnapshot);

  const hasAccess = permissionSnapshot
    ? permissionSnapshot.menuCodes.includes(menuCode)
    : matchesRoleAccess(user?.roles, fallbackRoles, user?.scopeLevel);

  if (!hasAccess) {
    return <Navigate to="/dashboard" replace />;
  }
  return <Outlet />;
}

function RequireActionAccess({
  actionCode,
  fallbackRoles,
}: {
  actionCode: string;
  fallbackRoles: UserRole[];
}) {
  const user = useAuthStore((s) => s.user);
  const permissionSnapshot = useAuthStore((s) => s.permissionSnapshot);

  const hasAccess = permissionSnapshot
    ? permissionSnapshot.actionCodes.includes(actionCode)
    : matchesRoleAccess(user?.roles, fallbackRoles, user?.scopeLevel);

  if (!hasAccess) {
    return <Navigate to="/dashboard" replace />;
  }
  return <Outlet />;
}

function RequireMobileOpsAccess() {
  const user = useAuthStore((s) => s.user);
  const hasAccess = matchesRoleAccess(
    user?.roles,
    [UserRole.ADMIN, UserRole.BOSS, UserRole.SUPERVISOR, UserRole.WORKER, UserRole.WAREHOUSE, UserRole.QC],
    user?.scopeLevel,
  );
  if (!hasAccess) {
    return <Navigate to="/dashboard" replace />;
  }
  return <Outlet />;
}

const SYSTEM_ADMIN_ROLES = [UserRole.ADMIN, UserRole.BOSS, UserRole.SUPERVISOR];

const MENU_GUARDED_ROUTES: Array<{
  path: string;
  element: ReactElement;
  menuCode: string;
  fallbackRoles: UserRole[];
}> = [
  { path: '/dashboard', element: <DashboardRoute />, menuCode: MENU_CODES.DASHBOARD, fallbackRoles: [UserRole.BOSS, UserRole.SUPERVISOR] },
  { path: '/inventory', element: <InventoryPage />, menuCode: MENU_CODES.INVENTORY, fallbackRoles: [UserRole.BOSS, UserRole.WAREHOUSE, UserRole.PURCHASER, UserRole.SUPERVISOR] },
  { path: '/purchase/suggestions', element: <SuggestionPage />, menuCode: MENU_CODES.PURCHASE_SUGGESTION_BOARD, fallbackRoles: [UserRole.BOSS, UserRole.PURCHASER] },
  { path: '/purchase/match', element: <MatchPage />, menuCode: MENU_CODES.PURCHASE_MATCH, fallbackRoles: [UserRole.BOSS, UserRole.PURCHASER] },
  { path: '/purchase/prices', element: <PricePage />, menuCode: MENU_CODES.PURCHASE_PRICE, fallbackRoles: [UserRole.BOSS, UserRole.PURCHASER] },
  { path: '/purchase/purchase-suggestions', element: <PurchaseSuggestionPage />, menuCode: MENU_CODES.PURCHASE_SUGGESTION_MANAGE, fallbackRoles: [UserRole.BOSS, UserRole.PURCHASER, UserRole.SUPERVISOR] },
  { path: '/purchase/orders', element: <PurchaseOrderPage />, menuCode: MENU_CODES.PURCHASE_ORDER, fallbackRoles: [UserRole.BOSS, UserRole.PURCHASER, UserRole.SUPERVISOR] },
  { path: '/purchase/deliveries', element: <PurchaseDeliveryPage />, menuCode: MENU_CODES.PURCHASE_DELIVERY, fallbackRoles: [UserRole.BOSS, UserRole.PURCHASER, UserRole.SUPERVISOR, UserRole.WAREHOUSE] },
  { path: '/purchase/receipts', element: <PurchaseReceiptPage />, menuCode: MENU_CODES.PURCHASE_RECEIPT, fallbackRoles: [UserRole.BOSS, UserRole.PURCHASER, UserRole.SUPERVISOR, UserRole.WAREHOUSE] },
  { path: '/purchase/incoming-inspection', element: <IncomingInspectionPage />, menuCode: MENU_CODES.PURCHASE_INCOMING_INSPECTION, fallbackRoles: [UserRole.BOSS, UserRole.QC, UserRole.PURCHASER, UserRole.SUPERVISOR] },
  { path: '/purchase/returns', element: <ReturnOrderPage />, menuCode: MENU_CODES.PURCHASE_RETURN, fallbackRoles: [UserRole.BOSS, UserRole.PURCHASER, UserRole.SUPERVISOR] },
  { path: '/purchase/settlements', element: <PurchaseSettlementPage />, menuCode: MENU_CODES.PURCHASE_SETTLEMENT, fallbackRoles: [UserRole.BOSS, UserRole.PURCHASER, UserRole.SUPERVISOR] },
  { path: '/sales/orders', element: <OrderPage />, menuCode: MENU_CODES.SALES_ORDER_CREATE, fallbackRoles: [UserRole.BOSS, UserRole.SALES, UserRole.SUPERVISOR] },
  { path: '/sales/order-list', element: <SalesOrderListPage />, menuCode: MENU_CODES.SALES_ORDER_LIST, fallbackRoles: [UserRole.BOSS, UserRole.SALES, UserRole.SUPERVISOR] },
  { path: '/sales/customers', element: <CustomerPage />, menuCode: MENU_CODES.SALES_CUSTOMER, fallbackRoles: [UserRole.BOSS, UserRole.SALES, UserRole.SUPERVISOR] },
  { path: '/settlement', element: <SettlementPage />, menuCode: MENU_CODES.SALES_SETTLEMENT, fallbackRoles: [UserRole.BOSS, UserRole.SALES, UserRole.SUPERVISOR] },
  { path: '/schedule-suggestions', element: <ScheduleSuggestionPage />, menuCode: MENU_CODES.SCHEDULE_SUGGESTION, fallbackRoles: [UserRole.BOSS, UserRole.SUPERVISOR, UserRole.PURCHASER] },
  { path: '/production/schedule', element: <SchedulePage />, menuCode: MENU_CODES.PRODUCTION_SCHEDULE, fallbackRoles: [UserRole.ADMIN, UserRole.BOSS, UserRole.SUPERVISOR] },
  { path: '/production/tasks', element: <TaskPage />, menuCode: MENU_CODES.PRODUCTION_TASK, fallbackRoles: [UserRole.ADMIN, UserRole.BOSS, UserRole.SUPERVISOR, UserRole.WORKER] },
  { path: '/production/orders', element: <ProductionOrderPage />, menuCode: MENU_CODES.PRODUCTION_ORDER, fallbackRoles: [UserRole.ADMIN, UserRole.BOSS, UserRole.SUPERVISOR] },
  { path: '/production/shortage', element: <ShortageBoard />, menuCode: MENU_CODES.PRODUCTION_SHORTAGE, fallbackRoles: [UserRole.BOSS, UserRole.SUPERVISOR, UserRole.PURCHASER] },
  { path: '/stocktaking', element: <StocktakingPage />, menuCode: MENU_CODES.STOCKTAKING, fallbackRoles: [UserRole.BOSS, UserRole.WAREHOUSE, UserRole.SUPERVISOR] },
  { path: '/quality/trace', element: <TracePage />, menuCode: MENU_CODES.QUALITY_TRACE, fallbackRoles: [UserRole.BOSS, UserRole.QC, UserRole.SUPERVISOR, UserRole.SALES] },
  { path: '/master-data/sku', element: <SkuPage />, menuCode: MENU_CODES.MASTER_DATA_SKU, fallbackRoles: [UserRole.BOSS, UserRole.PURCHASER, UserRole.WAREHOUSE, UserRole.SUPERVISOR] },
  { path: '/master-data/warehouse-location', element: <WarehouseLocationPage />, menuCode: MENU_CODES.MASTER_DATA_WAREHOUSE_LOCATION, fallbackRoles: [UserRole.ADMIN, UserRole.BOSS, UserRole.PURCHASER, UserRole.WAREHOUSE, UserRole.SUPERVISOR] },
  { path: '/master-data/bom', element: <BomPage />, menuCode: MENU_CODES.MASTER_DATA_BOM, fallbackRoles: [UserRole.BOSS, UserRole.SUPERVISOR, UserRole.PURCHASER] },
  { path: '/master-data/supplier', element: <SupplierPage />, menuCode: MENU_CODES.MASTER_DATA_SUPPLIER, fallbackRoles: [UserRole.BOSS, UserRole.PURCHASER, UserRole.SUPERVISOR] },
  { path: '/master-data/process-config', element: <ProcessConfigPage />, menuCode: MENU_CODES.MASTER_DATA_PROCESS_CONFIG, fallbackRoles: [UserRole.BOSS, UserRole.SUPERVISOR] },
  { path: '/master-data/sku-process', element: <SkuProcessPage />, menuCode: MENU_CODES.MASTER_DATA_SKU_PROCESS, fallbackRoles: [UserRole.BOSS, UserRole.SUPERVISOR] },
  { path: '/master-data/sku-category', element: <CategoryConfigPage />, menuCode: MENU_CODES.MASTER_DATA_SKU_CATEGORY, fallbackRoles: [UserRole.BOSS, UserRole.SUPERVISOR] },
  { path: '/analytics', element: <AnalyticsPage />, menuCode: MENU_CODES.ANALYTICS, fallbackRoles: [UserRole.BOSS, UserRole.SUPERVISOR] },
  { path: '/report/wages', element: <WageReportPage />, menuCode: MENU_CODES.REPORT_WAGE, fallbackRoles: [UserRole.BOSS, UserRole.SUPERVISOR] },
  { path: '/report/my-wages', element: <MyWagePage />, menuCode: MENU_CODES.REPORT_MY_WAGE, fallbackRoles: [UserRole.BOSS, UserRole.SUPERVISOR, UserRole.WORKER] },
  { path: '/report/semi-finished-modes', element: <SemiFinishedModeReportPage />, menuCode: MENU_CODES.REPORT_SEMI_FINISHED_MODE, fallbackRoles: [UserRole.BOSS, UserRole.SUPERVISOR] },
  { path: '/report/inventory-operation', element: <InventoryOperationReportPage />, menuCode: MENU_CODES.REPORT_INVENTORY_OPERATION, fallbackRoles: [UserRole.BOSS, UserRole.SUPERVISOR] },
  { path: '/notifications', element: <NotificationPage />, menuCode: MENU_CODES.NOTIFICATION, fallbackRoles: [UserRole.BOSS, UserRole.PURCHASER, UserRole.SUPERVISOR, UserRole.SALES, UserRole.WAREHOUSE, UserRole.WORKER, UserRole.QC] },
  { path: '/ai-chat', element: <AiChatRoute />, menuCode: MENU_CODES.AI_CHAT, fallbackRoles: [UserRole.BOSS, UserRole.PURCHASER, UserRole.SUPERVISOR, UserRole.SALES] },
  { path: '/system/tenants', element: <TenantConfigPage />, menuCode: MENU_CODES.SYSTEM_TENANT_CONFIG, fallbackRoles: SYSTEM_ADMIN_ROLES },
  { path: '/system/menus', element: <MenuFeaturePage />, menuCode: MENU_CODES.SYSTEM_MENU_CONFIG, fallbackRoles: SYSTEM_ADMIN_ROLES },
  { path: '/system/roles', element: <RoleConfigPage />, menuCode: MENU_CODES.SYSTEM_ROLE_CONFIG, fallbackRoles: SYSTEM_ADMIN_ROLES },
  { path: '/system/users', element: <UserConfigPage />, menuCode: MENU_CODES.SYSTEM_USER_CONFIG, fallbackRoles: SYSTEM_ADMIN_ROLES },
  { path: '/system/role-permissions', element: <RoleGrantPage />, menuCode: MENU_CODES.SYSTEM_ROLE_PERMISSION_CONFIG, fallbackRoles: SYSTEM_ADMIN_ROLES },
  { path: '/system/user-role-assignments', element: <UserRoleAssignmentPage />, menuCode: MENU_CODES.SYSTEM_USER_ROLE_ASSIGNMENT, fallbackRoles: SYSTEM_ADMIN_ROLES },
];

export default function App() {
  return (
    <BrowserRouter>
      <RouteMemoryGuard />
      <Routes>
        {/* 公开路由 */}
        <Route path="/login" element={renderRouteElement(<LoginPage />)} />

        {/* 受保护路由 */}
        <Route element={<RequireAuth />}>
          <Route element={<RequireMobileOpsAccess />}>
            <Route path="/m" element={renderRouteElement(<MobileOpsPage />)} />
            <Route path="/m/scan" element={renderRouteElement(<MobileOpsPage />)} />
            <Route path="/m/tasks/:taskId" element={renderRouteElement(<MobileOpsPage />)} />
            <Route path="/m/warehouse" element={renderRouteElement(<MobileOpsPage />)} />
            <Route path="/m/warehouse/scan" element={renderRouteElement(<MobileOpsPage />)} />
            <Route path="/m/warehouse/inbound" element={renderRouteElement(<MobileOpsPage />)} />
            <Route path="/m/warehouse/stocktaking/:stocktakingId" element={renderRouteElement(<MobileOpsPage />)} />
            <Route path="/m/qc" element={renderRouteElement(<MobileOpsPage />)} />
            <Route path="/m/qc/inspections/:inspectionId" element={renderRouteElement(<MobileOpsPage />)} />
            <Route path="/mobile" element={<Navigate to="/m" replace />} />
          </Route>
          <Route element={renderRouteElement(<AppLayout />)}>
            <Route index element={<DefaultHomeRedirect />} />
            <Route element={<RequirePlatformScope />}>
              <Route path="/platform/home" element={renderRouteElement(<PlatformHomePage />)} />
              <Route path="/platform/design-system" element={renderRouteElement(<DesignSystemPage />)} />
            </Route>
            {MENU_GUARDED_ROUTES.map((route) => (
              <Route
                key={route.path}
                element={(
                  <RequireMenuAccess
                    menuCode={route.menuCode}
                    fallbackRoles={route.fallbackRoles}
                  />
                )}
              >
                <Route path={route.path} element={renderRouteElement(route.element)} />
              </Route>
            ))}
            <Route
              element={(
                <RequireActionAccess
                  actionCode={ACTION_CODES.CONSUMABLE_ISSUE_VIEW}
                  fallbackRoles={[UserRole.BOSS, UserRole.SUPERVISOR, UserRole.WAREHOUSE, UserRole.PURCHASER]}
                />
              )}
            >
              <Route path="/consumables/issues" element={renderRouteElement(<ConsumableIssuePage />)} />
            </Route>
            <Route
              element={(
                <RequireActionAccess
                  actionCode={ACTION_CODES.ASSET_ACCEPTANCE_CREATE}
                  fallbackRoles={[UserRole.BOSS, UserRole.SUPERVISOR, UserRole.WAREHOUSE]}
                />
              )}
            >
              <Route path="/assets/acceptance" element={renderRouteElement(<AssetAcceptancePage />)} />
            </Route>
            <Route
              element={(
                <RequireActionAccess
                  actionCode={ACTION_CODES.ASSET_VIEW}
                  fallbackRoles={[UserRole.BOSS, UserRole.SUPERVISOR, UserRole.WAREHOUSE, UserRole.PURCHASER]}
                />
              )}
            >
              <Route path="/assets/ledger" element={renderRouteElement(<AssetLedgerPage />)} />
            </Route>
            <Route element={<RequirePlatformScope />}>
              <Route
                element={(
                  <RequireActionAccess
                    actionCode={ACTION_CODES.SYSTEM_AUDIT_VIEW}
                    fallbackRoles={[UserRole.ADMIN, UserRole.BOSS]}
                  />
                )}
              >
                <Route path="/system/audit-logs" element={renderRouteElement(<SystemAuditPage />)} />
              </Route>
            </Route>
          </Route>
        </Route>

        {/* 兜底 404 */}
        <Route path="*" element={renderRouteElement(<NotFoundPage />)} />
      </Routes>
    </BrowserRouter>
  );
}
