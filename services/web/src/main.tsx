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
