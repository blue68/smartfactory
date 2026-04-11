/**
 * [artifact:前端代码] — 应用入口
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import App from './App';
import { useAuthStore } from '@/stores/authStore';
import { useAppStore } from '@/stores/appStore';
import { onGlobalLoading } from '@/utils/request';
import { authApi } from '@/api/auth';
import 'antd/dist/reset.css';
import '@/styles/variables.css';
import '@/styles/global.css';

// ── React Query 客户端配置 ──────────────────────
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 30,          // 30 秒内不重新请求
      gcTime: 1000 * 60 * 5,         // 5 分钟后回收缓存
      retry: (failureCount, error) => {
        // ApiError 的业务错误不重试，网络错误最多重试 2 次
        if (error instanceof Error && error.name === 'ApiError') return false;
        return failureCount < 2;
      },
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: false,
    },
  },
});

// ── 初始化：恢复认证状态 ──────────────────────
useAuthStore.getState().hydrate();

// 启动时静默刷新一次权限快照，确保新增菜单/权限能即时生效
void (async () => {
  const store = useAuthStore.getState();
  if (!store.user) return;
  try {
    const data = await authApi.refresh();
    store.setAuth(
      store.user,
      data.accessToken,
      data.permissionSnapshot ?? store.permissionSnapshot ?? null,
    );
  } catch {
    // 无刷新凭证且本地也无 access token 时，回退为未登录态
    if (!store.accessToken) {
      store.logout();
    }
  }
})();

// ── 订阅全局 loading 状态 ─────────────────────
onGlobalLoading((loading) => {
  useAppStore.getState().setGlobalLoading(loading);
});

// ── 挂载应用 ──────────────────────────────────
const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element not found');

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
      {import.meta.env.DEV && (
        <ReactQueryDevtools initialIsOpen={false} position="bottom" />
      )}
    </QueryClientProvider>
  </React.StrictMode>,
);
