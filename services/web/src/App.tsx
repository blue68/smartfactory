/**
 * [artifact:前端代码] — 根组件（路由配置 + 权限守卫）
 */

import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import AppLayout from '@/components/Layout/AppLayout';
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
            <Route path="/dashboard" element={<DashboardRoute />} />
            <Route element={<RequirePlatformScope />}>
              <Route path="/platform/home" element={<PlatformHomePage />} />
            </Route>
            <Route path="/inventory" element={<InventoryPage />} />
            <Route path="/purchase/suggestions" element={<SuggestionPage />} />
            <Route path="/purchase/match" element={<MatchPage />} />
            <Route path="/sales/orders" element={<OrderPage />} />
            <Route path="/sales/order-list" element={<SalesOrderListPage />} />
            <Route path="/sales/customers" element={<CustomerPage />} />
            <Route path="/production/schedule" element={<SchedulePage />} />
            <Route path="/production/tasks" element={<TaskPage />} />
            <Route path="/master-data/sku" element={<SkuPage />} />
            <Route path="/master-data/bom" element={<BomPage />} />
            <Route path="/quality/trace" element={<TracePage />} />
            <Route path="/master-data/supplier" element={<SupplierPage />} />
            <Route path="/master-data/process-config" element={<ProcessConfigPage />} />
            <Route path="/master-data/sku-process" element={<SkuProcessPage />} />
            <Route path="/purchase/prices" element={<PricePage />} />
            <Route path="/master-data/sku-category" element={<CategoryConfigPage />} />
            <Route path="/master-data/warehouse-location" element={<WarehouseLocationPage />} />
            <Route path="/report/wages" element={<WageReportPage />} />
            <Route path="/report/my-wages" element={<MyWagePage />} />
            <Route path="/production/orders" element={<ProductionOrderPage />} />
            <Route path="/production/shortage" element={<ShortageBoard />} />
            <Route path="/purchase/purchase-suggestions" element={<PurchaseSuggestionPage />} />
            <Route path="/purchase/orders" element={<PurchaseOrderPage />} />
            <Route path="/purchase/deliveries" element={<PurchaseDeliveryPage />} />
            <Route path="/purchase/receipts" element={<PurchaseReceiptPage />} />
            <Route path="/purchase/incoming-inspection" element={<IncomingInspectionPage />} />
            <Route path="/purchase/returns" element={<ReturnOrderPage />} />
            <Route path="/purchase/settlements" element={<PurchaseSettlementPage />} />
            <Route path="/schedule-suggestions" element={<ScheduleSuggestionPage />} />
            <Route path="/ai-chat" element={<AiChatRoute />} />
            <Route path="/notifications" element={<NotificationPage />} />
            <Route path="/stocktaking" element={<StocktakingPage />} />
            <Route path="/settlement" element={<SettlementPage />} />
            <Route path="/analytics" element={<AnalyticsPage />} />
            <Route
              element={(
                <RequireMenuAccess
                  menuCode="system.tenant.config"
                  fallbackRoles={SYSTEM_ADMIN_ROLES}
                />
              )}
            >
              <Route path="/system/tenants" element={<TenantConfigPage />} />
            </Route>
            <Route
              element={(
                <RequireMenuAccess
                  menuCode="system.menu.config"
                  fallbackRoles={SYSTEM_ADMIN_ROLES}
                />
              )}
            >
              <Route path="/system/menus" element={<MenuFeaturePage />} />
            </Route>
            <Route
              element={(
                <RequireMenuAccess
                  menuCode="system.role.config"
                  fallbackRoles={SYSTEM_ADMIN_ROLES}
                />
              )}
            >
              <Route path="/system/roles" element={<RoleConfigPage />} />
            </Route>
            <Route
              element={(
                <RequireMenuAccess
                  menuCode="system.user.config"
                  fallbackRoles={SYSTEM_ADMIN_ROLES}
                />
              )}
            >
              <Route path="/system/users" element={<UserConfigPage />} />
            </Route>
            <Route
              element={(
                <RequireMenuAccess
                  menuCode="system.role.permission.config"
                  fallbackRoles={SYSTEM_ADMIN_ROLES}
                />
              )}
            >
              <Route path="/system/role-permissions" element={<RoleGrantPage />} />
            </Route>
            <Route
              element={(
                <RequireMenuAccess
                  menuCode="system.user.role.assignment"
                  fallbackRoles={SYSTEM_ADMIN_ROLES}
                />
              )}
            >
              <Route path="/system/user-role-assignments" element={<UserRoleAssignmentPage />} />
            </Route>
            <Route
              element={(
                <RequireActionAccess
                  actionCode="system.audit.view"
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
