/**
 * [artifact:接口联调代码] — 通知中心模块 API
 *
 * 后端接口：
 *   GET  /api/notifications            — 通知列表（分页）
 *   GET  /api/notifications/unread-count — 未读数
 *   PUT  /api/notifications/:id/read   — 单条标记已读
 *   PUT  /api/notifications/read-all   — 全部已读
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import request from '@/utils/request';

// ── 类型定义 ───────────────────────────────────────────────

export type NotificationType =
  | 'approval_request'
  | 'approval_result'
  | 'order_update'
  | 'system';

export interface Notification {
  id: number;
  type: NotificationType;
  title: string;
  content: string;
  isRead: boolean;
  relatedType?: string;
  relatedId?: number;
  createdAt: string;
}

export interface NotificationListResult {
  list: Notification[];
  total: number;
  page: number;
  pageSize: number;
}

export interface UnreadCountResult {
  count: number;
}

export interface NotificationListQuery {
  page?: number;
  pageSize?: number;
  /** undefined=全部; true=未读; false=已读 */
  isRead?: boolean;
}

// ── Query Keys ─────────────────────────────────────────────

export const notificationKeys = {
  all: ['notifications'] as const,
  list: (query: NotificationListQuery) =>
    [...notificationKeys.all, 'list', query] as const,
  unreadCount: () => [...notificationKeys.all, 'unread-count'] as const,
};

// ── 原始请求函数 ────────────────────────────────────────────

export const notificationApi = {
  getList: (query: NotificationListQuery) => {
    const params: Record<string, unknown> = {
      page: query.page ?? 1,
      pageSize: query.pageSize ?? 20,
    };
    if (query.isRead !== undefined) {
      params.isRead = query.isRead;
    }
    return request.get<NotificationListResult>('/api/notifications', params);
  },

  getUnreadCount: () =>
    request.get<UnreadCountResult>('/api/notifications/unread-count'),

  markAsRead: (id: number) =>
    request.put<void>(`/api/notifications/${id}/read`),

  markAllAsRead: () => request.put<void>('/api/notifications/read-all'),
};

// ── React Query Hooks ───────────────────────────────────────

/** 通知列表（分页 + 已读筛选） */
export function useNotifications(query: NotificationListQuery) {
  return useQuery({
    queryKey: notificationKeys.list(query),
    queryFn: () => notificationApi.getList(query),
    staleTime: 30_000, // 30 秒缓存
  });
}

/** 未读数量 */
export function useUnreadCount() {
  return useQuery({
    queryKey: notificationKeys.unreadCount(),
    queryFn: () => notificationApi.getUnreadCount(),
    staleTime: 30_000,
    refetchInterval: 60_000, // 每分钟自动刷新
  });
}

/** 单条标记已读 */
export function useMarkAsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => notificationApi.markAsRead(id),
    onSuccess: (_data, id) => {
      // 乐观更新：修改所有列表缓存中对应条目的 isRead
      qc.setQueriesData<NotificationListResult>(
        { queryKey: notificationKeys.all },
        (old) => {
          if (!old) return old;
          return {
            ...old,
            list: old.list.map((n) =>
              n.id === id ? { ...n, isRead: true } : n,
            ),
          };
        },
      );
      // 刷新未读数
      void qc.invalidateQueries({ queryKey: notificationKeys.unreadCount() });
    },
  });
}

/** 全部标记已读 */
export function useMarkAllAsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => notificationApi.markAllAsRead(),
    onSuccess: () => {
      // 刷新列表和未读数
      void qc.invalidateQueries({ queryKey: notificationKeys.all });
    },
  });
}
