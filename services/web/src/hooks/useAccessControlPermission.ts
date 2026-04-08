/**
 * [artifact:前端代码] — 权限快照 Hook
 */

import { useAuthStore } from '@/stores/authStore';

export function useAccessControlPermission() {
  const snapshot = useAuthStore((s) => s.permissionSnapshot);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const hasMenu = useAuthStore((s) => s.hasMenu);
  const hasFeature = useAuthStore((s) => s.hasFeature);

  return {
    snapshot,
    hasPermission,
    hasMenu,
    hasFeature,
    hasAnyPermission: (actionCodes: string[]) => actionCodes.some((code) => hasPermission(code)),
    hasAllPermissions: (actionCodes: string[]) => actionCodes.every((code) => hasPermission(code)),
  };
}
