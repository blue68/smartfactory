/**
 * [artifact:前端代码] — 通知中心页面
 *
 * 功能：
 *   - Tab 筛选：全部 / 未读 / 已读
 *   - 通知列表：类型图标、标题、内容预览、相对时间、未读指示
 *   - 点击条目 → 标记已读
 *   - 页头"全部已读"按钮
 *   - 分页
 */

import { useEffect, useState, useCallback } from 'react';
import { useAppStore } from '@/stores/appStore';
import Button from '@/components/common/Button';
import {
  useNotifications,
  useUnreadCount,
  useNotificationStream,
  useMarkAsRead,
  useMarkAllAsRead,
  type NotificationType,
  type NotificationListQuery,
} from '@/api/notification';
import styles from './NotificationPage.module.css';

// ── 类型图标映射 ────────────────────────────────────────────

const TYPE_ICON: Record<NotificationType, string> = {
  approval_request: '📋',
  approval_result:  '✅',
  order_update:     '📦',
  system:           '🔔',
};

const TYPE_LABEL: Record<NotificationType, string> = {
  approval_request: '审批申请',
  approval_result:  '审批结果',
  order_update:     '订单更新',
  system:           '系统通知',
};

// ── Tab 定义 ────────────────────────────────────────────────

type TabKey = 'all' | 'unread' | 'read';

interface TabDef {
  key: TabKey;
  label: string;
  isRead: boolean | undefined;
}

const TABS: TabDef[] = [
  { key: 'all',    label: '全部', isRead: undefined },
  { key: 'unread', label: '未读', isRead: false },
  { key: 'read',   label: '已读', isRead: true },
];

// ── 相对时间格式化 ──────────────────────────────────────────

function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;

  const minutes = Math.floor(diff / 60_000);
  const hours   = Math.floor(diff / 3_600_000);
  const days    = Math.floor(diff / 86_400_000);

  if (minutes < 1)   return '刚刚';
  if (minutes < 60)  return `${minutes}分钟前`;
  if (hours < 24)    return `${hours}小时前`;
  if (days < 7)      return `${days}天前`;
  return new Date(dateStr).toLocaleDateString('zh-CN');
}

// ── 主页面 ──────────────────────────────────────────────────

export default function NotificationPage() {
  const { setPageTitle } = useAppStore();
  const [activeTab, setActiveTab] = useState<TabKey>('all');
  const [page, setPage] = useState(1);

  useEffect(() => { setPageTitle('通知中心'); }, [setPageTitle]);
  useNotificationStream();

  const query: NotificationListQuery = {
    page,
    pageSize: 20,
    isRead: TABS.find((t) => t.key === activeTab)?.isRead,
  };

  const { data, isLoading, error } = useNotifications(query);
  const { data: unreadData } = useUnreadCount();
  const markAsRead = useMarkAsRead();
  const markAllAsRead = useMarkAllAsRead();

  const unreadCount = unreadData?.count ?? 0;
  const totalPages  = data ? Math.ceil(data.total / 20) : 1;

  const handleTabChange = useCallback((key: TabKey) => {
    setActiveTab(key);
    setPage(1);
  }, []);

  const handleItemClick = useCallback((id: number, isRead: boolean) => {
    if (!isRead) {
      markAsRead.mutate(id);
    }
  }, [markAsRead]);

  const handleMarkAllRead = useCallback(() => {
    markAllAsRead.mutate();
  }, [markAllAsRead]);

  return (
    <div className={styles.page}>
      {/* 页头 */}
      <div className={styles.page_header}>
        <div className={styles.page_title_wrap}>
          <h1 className={styles.page_title}>通知中心</h1>
          {unreadCount > 0 && (
            <span className={styles.unread_badge} aria-label={`${unreadCount}条未读`}>
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </div>
        <Button
          variant="ghost"
          size="md"
          onClick={handleMarkAllRead}
          loading={markAllAsRead.isPending}
          disabled={unreadCount === 0}
        >
          全部已读
        </Button>
      </div>

      {/* Tab 筛选栏 */}
      <div className={styles.tab_bar} role="tablist" aria-label="通知筛选">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            role="tab"
            aria-selected={activeTab === tab.key}
            className={`${styles.tab_item} ${activeTab === tab.key ? styles['tab_item--active'] : ''}`}
            onClick={() => handleTabChange(tab.key)}
          >
            {tab.label}
            {tab.key === 'unread' && unreadCount > 0 && (
              <span className={styles.tab_count}>{unreadCount > 99 ? '99+' : unreadCount}</span>
            )}
          </button>
        ))}
      </div>

      {/* 通知列表 */}
      <div className={styles.list_container} role="tabpanel">
        {isLoading ? (
          // 骨架屏
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className={styles.skeleton_item}>
              <div className={styles.skeleton_icon} />
              <div className={styles.skeleton_body}>
                <div className={styles.skeleton_line} style={{ width: '60%' }} />
                <div className={styles.skeleton_line} style={{ width: '85%' }} />
                <div className={styles.skeleton_line} style={{ width: '30%' }} />
              </div>
            </div>
          ))
        ) : error ? (
          <div className={styles.error_wrap}>
            <div className="alert alert--error">
              <span className="alert__icon" aria-hidden="true">X</span>
              <div className="alert__body">
                <div className="alert__title">加载失败</div>
                <div className="alert__desc">{(error as Error).message}</div>
              </div>
            </div>
          </div>
        ) : !data?.list.length ? (
          <div className={styles.empty_state} role="status">
            <span className={styles.empty_icon} aria-hidden="true">
              {activeTab === 'unread' ? '✓' : '🔔'}
            </span>
            <p className={styles.empty_text}>
              {activeTab === 'unread' ? '暂无未读通知' : '暂无通知'}
            </p>
          </div>
        ) : (
          data.list.map((notification) => {
            const isUnread = !notification.isRead;
            return (
              <div
                key={notification.id}
                role="button"
                tabIndex={0}
                className={`${styles.notification_item} ${isUnread ? styles['notification_item--unread'] : ''}`}
                onClick={() => handleItemClick(notification.id, notification.isRead)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleItemClick(notification.id, notification.isRead);
                  }
                }}
                aria-label={`${notification.title}，${isUnread ? '未读' : '已读'}`}
              >
                {/* 类型图标 */}
                <div
                  className={`${styles.icon_wrap} ${styles[`icon_wrap--${notification.type}`]}`}
                  aria-hidden="true"
                >
                  {TYPE_ICON[notification.type]}
                </div>

                {/* 内容区 */}
                <div className={styles.notification_body}>
                  <div
                    className={`${styles.notification_title} ${!isUnread ? styles['notification_title--read'] : ''}`}
                  >
                    {isUnread && (
                      <span className={styles.unread_dot} aria-hidden="true" />
                    )}
                    {notification.title}
                  </div>
                  <p className={styles.notification_content}>
                    {notification.content}
                  </p>
                  <div className={styles.notification_meta}>
                    <span className={styles.notification_time}>
                      {formatRelativeTime(notification.createdAt)}
                    </span>
                    <span
                      className={`${styles.notification_type_tag} ${styles[`type_tag--${notification.type}`]}`}
                    >
                      {TYPE_LABEL[notification.type]}
                    </span>
                  </div>
                </div>

                {/* 已读状态 */}
                <span className={styles.read_status} aria-hidden="true">
                  {isUnread ? '未读' : '已读'}
                </span>
              </div>
            );
          })
        )}
      </div>

      {/* 分页 */}
      {(data?.total ?? 0) > 0 && (
        <div className={styles.pagination}>
          <span className={styles.pagination__info}>
            共 {data?.total ?? 0} 条通知，第 {page} / {totalPages} 页
          </span>
          <div className={styles.pagination__btns}>
            <button
              className={styles.pagination__btn_ghost}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
            >
              上一页
            </button>
            {Array.from({ length: Math.min(totalPages, 5) }).map((_, i) => {
              const p = i + 1;
              const isActive = page === p;
              return (
                <button
                  key={p}
                  className={isActive ? styles.pagination__btn_primary : styles.pagination__btn_ghost}
                  onClick={() => setPage(p)}
                  aria-current={isActive ? 'page' : undefined}
                >
                  {p}
                </button>
              );
            })}
            <button
              className={styles.pagination__btn_ghost}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
            >
              下一页
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
