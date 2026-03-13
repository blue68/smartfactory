/**
 * [artifact:前端代码] — Zustand 认证状态管理
 */

import { create } from 'zustand';
import { config } from '@/config';
import { getAccessToken, saveAccessToken, clearTokens } from '@/utils/request';
import type { User } from '@/types/models';
import type { UserRole } from '@/types/enums';

interface AuthState {
  user: User | null;
  accessToken: string | null;
  // refreshToken 已改为 HttpOnly Cookie，不再在前端状态中维护
  isAuthenticated: boolean;

  /** 登录后写入状态（由 api/auth.ts 调用） */
  setAuth: (user: User, accessToken: string) => void;

  /** 仅更新 accessToken（静默刷新后调用） */
  setAccessToken: (token: string) => void;

  /** 登出，清除 accessToken 和用户信息；Refresh Token Cookie 由后端 Set-Cookie 清除 */
  logout: () => void;

  /** 初始化时恢复状态：Access Token 从内存读取，User 从 localStorage 恢复 */
  hydrate: () => void;

  /** 判断当前用户是否拥有某角色 */
  hasRole: (role: UserRole) => boolean;

  /** 判断当前用户是否拥有任意一个角色 */
  hasAnyRole: (roles: UserRole[]) => boolean;
}

export const useAuthStore = create<AuthState>()((set, get) => ({
  user: null,
  accessToken: null,
  isAuthenticated: false,

  setAuth: (user, accessToken) => {
    saveAccessToken(accessToken);
    localStorage.setItem(config.userKey, JSON.stringify(user));
    set({ user, accessToken, isAuthenticated: true });
  },

  setAccessToken: (token) => {
    saveAccessToken(token);
    set({ accessToken: token });
  },

  logout: () => {
    clearTokens();
    // Refresh Token Cookie 由后端登出接口通过 Set-Cookie: max-age=0 清除
    set({ user: null, accessToken: null, isAuthenticated: false });
  },

  hydrate: () => {
    try {
      // Access Token 从内存读取（页面刷新后为 null，由 refresh 机制重新获取）
      const token = getAccessToken();
      const userRaw = localStorage.getItem(config.userKey);
      if (token && userRaw) {
        const user = JSON.parse(userRaw) as User;
        set({ user, accessToken: token, isAuthenticated: true });
      } else if (userRaw) {
        // 有用户信息但无 Token（页面刷新场景），标记待刷新状态
        // refresh 拦截器会自动通过 Cookie 刷新获取新 Access Token
        const user = JSON.parse(userRaw) as User;
        set({ user, accessToken: null, isAuthenticated: false });
      }
    } catch {
      // localStorage 读取失败时静默忽略，保持未认证状态
    }
  },

  hasRole: (role) => {
    const { user } = get();
    return user?.roles?.includes(role) ?? false;
  },

  hasAnyRole: (roles) => {
    const { user } = get();
    if (!user?.roles) return false;
    return roles.some((r) => user.roles.includes(r));
  },
}));
