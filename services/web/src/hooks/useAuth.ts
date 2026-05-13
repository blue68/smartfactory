/**
 * [artifact:前端代码] — 认证 Hook
 */

import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/authStore';
import { authApi } from '@/api/auth';
import { useAppStore } from '@/stores/appStore';
import type { LoginPayload } from '@/types/models';

export function useAuth() {
  const store = useAuthStore();
  const { showToast } = useAppStore();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const login = useCallback(
    async (payload: LoginPayload) => {
      const data = await authApi.login(payload);
      // Refresh Token 由后端通过 Set-Cookie 写入 HttpOnly Cookie，前端无需处理
      queryClient.clear();
      store.setAuth(data.user, data.accessToken, data.permissionSnapshot ?? null);
      showToast({ type: 'success', message: '登录成功，欢迎回来！' });
      navigate('/', { replace: true });
    },
    [queryClient, store, showToast, navigate],
  );

  const logout = useCallback(() => {
    store.logout();
    queryClient.clear();
    navigate('/login', { replace: true });
  }, [queryClient, store, navigate]);

  return {
    user: store.user,
    isAuthenticated: store.isAuthenticated,
    login,
    logout,
    hasRole: store.hasRole,
    hasAnyRole: store.hasAnyRole,
  };
}
