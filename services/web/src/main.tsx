/**
 * [artifact:前端代码] — 应用入口
 */

import { StrictMode } from 'react';
import ReactDOM from 'react-dom/client';
import RootProviders from './RootProviders';
import { useAuthStore } from '@/stores/authStore';
import { useAppStore } from '@/stores/appStore';
import { onGlobalLoading } from '@/utils/request';
import { authApi } from '@/api/auth';
import '@/styles/variables.css';
import '@/styles/global.css';

const isDev = import.meta.env.DEV;
const enableReactStrictMode =
  import.meta.env.VITE_REACT_STRICT_MODE === '1' ||
  (
    isDev &&
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('strictmode') === '1'
  );

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
  enableReactStrictMode ? (
    <StrictMode>
      <RootProviders />
    </StrictMode>
  ) : (
    <RootProviders />
  ),
);
