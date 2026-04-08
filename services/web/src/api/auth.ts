/**
 * [artifact:接口联调代码] — 认证模块 API
 */

import { useMutation } from '@tanstack/react-query';
import request from '@/utils/request';
import type { AuthData, LoginPayload } from '@/types/models';
import type { PermissionSnapshot } from '@/types/accessControl';

// ── 原始请求函数 ─────────────────────────────
export const authApi = {
  login: (payload: LoginPayload) =>
    request.post<AuthData>('/api/auth/login', payload),

  switchTenant: (targetTenantId: number) =>
    request.post<AuthData>('/api/auth/switch-tenant', { targetTenantId }),

  exitTenantContext: () =>
    request.post<AuthData>('/api/auth/exit-tenant-context'),

  wechatLogin: (openid: string, tenantCode: string) =>
    request.post<AuthData>('/api/auth/wechat-login', { openid, tenantCode }),

  /** Refresh Token 由浏览器通过 HttpOnly Cookie 自动携带，无需传参 */
  refresh: () =>
    request.post<{ accessToken: string; permissionSnapshot?: PermissionSnapshot }>('/api/auth/refresh'),
};

// ── React Query Hooks ────────────────────────

/** 账号密码登录 */
export function useLoginMutation() {
  return useMutation({
    mutationFn: authApi.login,
  });
}
