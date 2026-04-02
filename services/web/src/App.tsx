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

/** 认证守卫：未登录跳转 /login */
function RequireAuth() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  return <Outlet />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* 公开路由 */}
        <Route path="/login" element={<LoginPage />} />

        {/* 受保护路由 */}
        <Route element={<RequireAuth />}>
          <Route element={<AppLayout />}>
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<DashboardPage />} />
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
            <Route path="/ai-chat" element={<AiChatPage />} />
            <Route path="/notifications" element={<NotificationPage />} />
            <Route path="/stocktaking" element={<StocktakingPage />} />
            <Route path="/settlement" element={<SettlementPage />} />
            <Route path="/analytics" element={<AnalyticsPage />} />
          </Route>
        </Route>

        {/* 兜底 404 */}
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </BrowserRouter>
  );
}
