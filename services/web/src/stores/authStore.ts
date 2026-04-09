/**
 * [artifact:前端代码] — Zustand 认证状态管理
 */

import { create } from 'zustand';
import { config } from '@/config';
import { getAccessToken, saveAccessToken, clearTokens } from '@/utils/request';
import type { User } from '@/types/models';
import type { UserRole } from '@/types/enums';
import type { PermissionSnapshot } from '@/types/accessControl';
import { matchesRoleAccess } from '@/utils/roleAccess';

const PERMISSION_SNAPSHOT_KEY = 'sf_permission_snapshot';

interface AuthState {
  user: User | null;
  accessToken: string | null;
  permissionSnapshot: PermissionSnapshot | null;
  // refreshToken 已改为 HttpOnly Cookie，不再在前端状态中维护
  isAuthenticated: boolean;

  /** 登录后写入状态（由 api/auth.ts 调用） */
  setAuth: (
    user: User,
    accessToken: string,
    permissionSnapshot?: PermissionSnapshot | null,
  ) => void;

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

  /** 判断当前用户是否拥有某功能权限点 */
  hasPermission: (actionCode: string) => boolean;

  /** 判断当前用户是否可见某菜单编码 */
  hasMenu: (menuCode: string) => boolean;

  /** 判断当前租户功能开关是否启用 */
  hasFeature: (featureCode: string) => boolean;
}

export const useAuthStore = create<AuthState>()((set, get) => ({
  user: null,
  accessToken: null,
  permissionSnapshot: null,
  isAuthenticated: false,

  setAuth: (user, accessToken, permissionSnapshot = null) => {
    saveAccessToken(accessToken);
    localStorage.setItem(config.userKey, JSON.stringify(user));
    if (permissionSnapshot) {
      localStorage.setItem(PERMISSION_SNAPSHOT_KEY, JSON.stringify(permissionSnapshot));
    } else {
      localStorage.removeItem(PERMISSION_SNAPSHOT_KEY);
    }
    set({ user, accessToken, permissionSnapshot, isAuthenticated: true });
  },

  setAccessToken: (token) => {
    saveAccessToken(token);
    set({ accessToken: token });
  },

  logout: () => {
    clearTokens();
    localStorage.removeItem(PERMISSION_SNAPSHOT_KEY);
    // Refresh Token Cookie 由后端登出接口通过 Set-Cookie: max-age=0 清除
    set({ user: null, accessToken: null, permissionSnapshot: null, isAuthenticated: false });
  },

  hydrate: () => {
    try {
      // Access Token 从内存读取（页面刷新后为 null，由 refresh 机制重新获取）
      const token = getAccessToken();
      const userRaw = localStorage.getItem(config.userKey);
      const snapshotRaw = localStorage.getItem(PERMISSION_SNAPSHOT_KEY);
      const permissionSnapshot = snapshotRaw
        ? (JSON.parse(snapshotRaw) as PermissionSnapshot)
        : null;
      if (token && userRaw) {
        const user = JSON.parse(userRaw) as User;
        set({ user, accessToken: token, permissionSnapshot, isAuthenticated: true });
      } else if (userRaw) {
        // 有用户信息但无 Token（页面刷新场景），标记待刷新状态
        // refresh 拦截器会自动通过 Cookie 刷新获取新 Access Token
        const user = JSON.parse(userRaw) as User;
        set({ user, accessToken: null, permissionSnapshot, isAuthenticated: false });
      }
    } catch {
      // localStorage 读取失败时静默忽略，保持未认证状态
    }
  },

  hasRole: (role) => {
    const { user } = get();
    return matchesRoleAccess(user?.roles, [role], user?.scopeLevel);
  },

  hasAnyRole: (roles) => {
    const { user } = get();
    return matchesRoleAccess(user?.roles, roles, user?.scopeLevel);
  },

  hasPermission: (actionCode) => {
    const snapshot = get().permissionSnapshot;
    return snapshot?.actionCodes?.includes(actionCode) ?? false;
  },

  hasMenu: (menuCode) => {
    const snapshot = get().permissionSnapshot;
    return snapshot?.menuCodes?.includes(menuCode) ?? false;
  },

  hasFeature: (featureCode) => {
    const snapshot = get().permissionSnapshot;
    return snapshot?.featureFlags?.includes(featureCode) ?? false;
  },
}));
