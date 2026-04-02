/**
 * [artifact:接口联调代码] — 通知中心模块 API
 *
 * 后端接口：
 *   GET  /api/notifications            — 通知列表（分页）
 *   GET  /api/notifications/unread-count — 未读数
 *   PUT  /api/notifications/:id/read   — 单条标记已读
 *   PUT  /api/notifications/read-all   — 全部已读
 */

import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { config } from '@/config';
import request, { getAccessToken } from '@/utils/request';

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

type NotificationStreamEvent =
  | {
    type: 'notification.created';
    data: {
      notification: Notification;
      unreadCount: number;
    };
  }
  | {
    type: 'notification.read';
    data: {
      id: number;
      unreadCount: number;
    };
  }
  | {
    type: 'notification.all_read';
    data: {
      unreadCount: number;
    };
  }
  | {
    type: 'heartbeat';
    data: {
      ts: string;
    };
  };

// ── Query Keys ─────────────────────────────────────────────

export const notificationKeys = {
  all: ['notifications'] as const,
  list: (query: NotificationListQuery) =>
    [...notificationKeys.all, 'list', query] as const,
  unreadCount: () => [...notificationKeys.all, 'unread-count'] as const,
};

function applyStreamEvent(
  qc: ReturnType<typeof useQueryClient>,
  event: NotificationStreamEvent,
): void {
  if (event.type === 'heartbeat') return;

  qc.setQueryData<UnreadCountResult>(
    notificationKeys.unreadCount(),
    { count: event.data.unreadCount },
  );

  void qc.invalidateQueries({ queryKey: notificationKeys.all });

  if (event.type === 'notification.created') {
    const relatedType = event.data.notification.relatedType;
    if (relatedType === 'approval_request' || relatedType === 'purchase_suggestion') {
      void qc.invalidateQueries({ queryKey: ['analytics'] });
      void qc.invalidateQueries({ queryKey: ['purchase'] });
    }
    if (relatedType === 'sales_order') {
      void qc.invalidateQueries({ queryKey: ['sales-orders'] });
    }
  }
}

function extractEventsFromChunk(chunk: string): NotificationStreamEvent[] {
  const frames = chunk.split('\n\n').filter(Boolean);
  const events: NotificationStreamEvent[] = [];

  for (const frame of frames) {
    const lines = frame.split('\n');
    const eventName = lines.find((line) => line.startsWith('event: '))?.slice(7);
    const dataPayload = lines
      .filter((line) => line.startsWith('data: '))
      .map((line) => line.slice(6))
      .join('\n');

    if (!dataPayload || dataPayload === '[DONE]') continue;

    try {
      const parsed = JSON.parse(dataPayload) as Record<string, unknown>;
      const type = (parsed.type ?? eventName) as NotificationStreamEvent['type'] | undefined;
      if (!type || !parsed.data) continue;
      events.push({ ...parsed, type } as NotificationStreamEvent);
    } catch {
      // ignore malformed SSE frames
    }
  }

  return events;
}

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
  });
}

/** 通知实时流 */
export function useNotificationStream(enabled = true) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!enabled) return;

    const token = getAccessToken();
    if (!token) return;

    let cancelled = false;
    let reconnectTimer: number | null = null;
    let activeController: AbortController | null = null;

    const connect = async () => {
      activeController = new AbortController();

      try {
        const response = await fetch(`${config.apiBaseUrl}/api/notifications/stream`, {
          headers: {
            Accept: 'text/event-stream',
            Authorization: `Bearer ${token}`,
          },
          signal: activeController.signal,
        });

        if (!response.ok || !response.body) {
          throw new Error(`HTTP ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (!cancelled) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const boundary = buffer.lastIndexOf('\n\n');
          if (boundary === -1) continue;

          const complete = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);

          for (const event of extractEventsFromChunk(complete)) {
            applyStreamEvent(qc, event);
          }
        }
      } catch {
        if (!cancelled) {
          reconnectTimer = window.setTimeout(() => {
            void connect();
          }, 3_000);
        }
      }
    };

    void connect();

    return () => {
      cancelled = true;
      activeController?.abort();
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
      }
    };
  }, [enabled, qc]);
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
