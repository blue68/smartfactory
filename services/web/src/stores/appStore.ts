/**
 * [artifact:前端代码] — Zustand 全局 UI 状态
 * 管理：侧边栏折叠、全局 loading、Toast 通知队列、AI 面板开关
 */

import { create } from 'zustand';

export type ToastType = 'success' | 'warning' | 'error' | 'info';

export interface Toast {
  id: string;
  type: ToastType;
  title?: string;
  message: string;
  duration?: number; // 毫秒，undefined 表示不自动关闭
}

interface AppState {
  /** 侧边栏是否折叠 */
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;

  /** 全局 loading（由 request.ts 的 onGlobalLoading 驱动） */
  globalLoading: boolean;
  setGlobalLoading: (loading: boolean) => void;

  /** Toast 通知队列（最多 3 条） */
  toasts: Toast[];
  showToast: (toast: Omit<Toast, 'id'>) => void;
  dismissToast: (id: string) => void;

  /** AI 对话浮层 */
  aiPanelOpen: boolean;
  setAiPanelOpen: (open: boolean) => void;
  toggleAiPanel: () => void;

  /** 当前页面标题（供 Header 显示） */
  pageTitle: string;
  setPageTitle: (title: string) => void;
}

let toastIdCounter = 0;

export const useAppStore = create<AppState>()((set, get) => ({
  sidebarCollapsed: false,
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),

  globalLoading: false,
  setGlobalLoading: (loading) => set({ globalLoading: loading }),

  toasts: [],
  showToast: (toast) => {
    const id = `toast_${++toastIdCounter}`;
    const newToast: Toast = { id, ...toast };

    // 默认停留时长
    const defaultDuration =
      toast.type === 'success' ? 3000 : toast.type === 'warning' ? 5000 : undefined;
    const duration = toast.duration ?? defaultDuration;

    set((s) => ({
      toasts: [...s.toasts.slice(-2), newToast], // 最多显示 3 条
    }));

    if (duration !== undefined) {
      setTimeout(() => {
        get().dismissToast(id);
      }, duration);
    }
  },
  dismissToast: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  aiPanelOpen: false,
  setAiPanelOpen: (open) => set({ aiPanelOpen: open }),
  toggleAiPanel: () => set((s) => ({ aiPanelOpen: !s.aiPanelOpen })),

  pageTitle: '智造管家',
  setPageTitle: (title) => set({ pageTitle: title }),
}));
