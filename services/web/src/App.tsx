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
import PricePage from '@/pages/purchase/PricePage';
import AiChatPage from '@/pages/ai/AiChatPage';
import LoginPage from '@/pages/auth/LoginPage';
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
            <Route path="/production/schedule" element={<SchedulePage />} />
            <Route path="/master-data/sku" element={<SkuPage />} />
            <Route path="/master-data/bom" element={<BomPage />} />
            <Route path="/quality/trace" element={<TracePage />} />
            <Route path="/master-data/supplier" element={<SupplierPage />} />
            <Route path="/master-data/process-config" element={<ProcessConfigPage />} />
            <Route path="/purchase/prices" element={<PricePage />} />
            <Route path="/ai-chat" element={<AiChatPage />} />
          </Route>
        </Route>

        {/* 兜底 404 */}
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </BrowserRouter>
  );
}
