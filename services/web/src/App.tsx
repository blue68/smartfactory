/**
 * [artifact:前端代码] — 根组件（路由配置 + 权限守卫）
 */

import type { ReactElement } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import AppLayout from '@/components/Layout/AppLayout';
import { ACTION_CODES, MENU_CODES } from '@/constants/accessControl';
import DashboardPage from '@/pages/dashboard/DashboardPage';
import InventoryPage from '@/pages/inventory/InventoryPage';
import SuggestionPage from '@/pages/purchase/SuggestionPage';
import MatchPage from '@/pages/purchase/MatchPage';
import OrderPage from '@/pages/sales/OrderPage';
import SchedulePage from '@/pages/production/SchedulePage';
import SkuPage from '@/pages/master-data/SkuPage';
import BomPage from '@/pages/master-data/BomPage';
import TracePage from '@/pages/quality/TracePage';
import SupplierPage from '@/pages/master-data/SupplierPage';
import ProcessConfigPage from '@/pages/master-data/ProcessConfigPage';
import SkuProcessPage from '@/pages/master-data/SkuProcessPage';
import PricePage from '@/pages/purchase/PricePage';
import AiChatPage from '@/pages/ai/AiChatPage';
import CustomerPage from '@/pages/sales/CustomerPage';
import SalesOrderListPage from '@/pages/sales/SalesOrderListPage';
import TaskPage from '@/pages/production/TaskPage';
import CategoryConfigPage from '@/pages/master-data/CategoryConfigPage';
import WarehouseLocationPage from '@/pages/master-data/WarehouseLocationPage';
import WageReportPage from '@/pages/report/WageReportPage';
import MyWagePage from '@/pages/report/MyWagePage';
import LoginPage from '@/pages/auth/LoginPage';
import ProductionOrderPage from '@/pages/production/ProductionOrderPage';
import ShortageBoard from '@/pages/production/ShortageBoard';
import PurchaseSuggestionPage from '@/pages/purchase/PurchaseSuggestionPage';
import PurchaseOrderPage from '@/pages/purchase/PurchaseOrderPage';
import PurchaseDeliveryPage from '@/pages/purchase/PurchaseDeliveryPage';
import PurchaseReceiptPage from '@/pages/purchase/PurchaseReceiptPage';
import IncomingInspectionPage from '@/pages/purchase/IncomingInspectionPage';
import ReturnOrderPage from '@/pages/purchase/ReturnOrderPage';
import PurchaseSettlementPage from '@/pages/purchase/PurchaseSettlementPage';
import ScheduleSuggestionPage from '@/pages/schedule/ScheduleSuggestionPage';
import NotificationPage from '@/pages/notification/NotificationPage';
import StocktakingPage from '@/pages/stocktaking/StocktakingPage';
import SettlementPage from '@/pages/settlement/SettlementPage';
import AnalyticsPage from '@/pages/analytics/AnalyticsPage';
import NotFoundPage from '@/pages/NotFoundPage';
import TenantConfigPage from '@/pages/system/TenantConfigPage';
import MenuFeaturePage from '@/pages/system/MenuFeaturePage';
import RoleConfigPage from '@/pages/system/RoleConfigPage';
import UserConfigPage from '@/pages/system/UserConfigPage';
import RoleGrantPage from '@/pages/system/RoleGrantPage';
import UserRoleAssignmentPage from '@/pages/system/UserRoleAssignmentPage';
import SystemAuditPage from '@/pages/system/SystemAuditPage';
import PlatformHomePage from '@/pages/system/PlatformHomePage';
import { UserRole } from '@/types/enums';
import { matchesRoleAccess } from '@/utils/roleAccess';

/** 认证守卫：未登录跳转 /login */
function RequireAuth() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
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
  return <DashboardPage />;
}

function AiChatRoute() {
  const user = useAuthStore((s) => s.user);
  if (user?.scopeLevel === 'platform') {
    return <Navigate to="/platform/home" replace />;
  }
  return <AiChatPage />;
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
      <Routes>
        {/* 公开路由 */}
        <Route path="/login" element={<LoginPage />} />

        {/* 受保护路由 */}
        <Route element={<RequireAuth />}>
          <Route element={<AppLayout />}>
            <Route index element={<DefaultHomeRedirect />} />
            <Route element={<RequirePlatformScope />}>
              <Route path="/platform/home" element={<PlatformHomePage />} />
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
                <Route path={route.path} element={route.element} />
              </Route>
            ))}
            <Route
              element={(
                <RequireActionAccess
                  actionCode={ACTION_CODES.SYSTEM_AUDIT_VIEW}
                  fallbackRoles={[UserRole.ADMIN, UserRole.BOSS]}
                />
              )}
            >
              <Route path="/system/audit-logs" element={<SystemAuditPage />} />
            </Route>
          </Route>
        </Route>

        {/* 兜底 404 */}
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </BrowserRouter>
  );
}
