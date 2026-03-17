/**
 * [artifact:前端代码] — 销售结算页
 *
 * 功能：
 *   - Tab 筛选：全部 / 草稿 / 已确认 / 已付款 / 已取消
 *   - 结算单列表：settlement_no / customer / total_amount / status / created_at / 操作
 *   - 操作按钮按 status + role 条件显示
 *   - 分页、骨架屏、空态、错误态
 */

import { useEffect, useState, useCallback } from 'react';
import { useAppStore } from '@/stores/appStore';
import { useAuthStore } from '@/stores/authStore';
import { UserRole } from '@/types/enums';
import Button from '@/components/common/Button';
import {
  useSettlementList,
  useConfirmSettlement,
  usePaySettlement,
  useCancelSettlement,
  SettlementStatusLabel,
  type SettlementStatus,
  type SettlementListQuery,
} from '@/api/settlement';
import styles from './SettlementPage.module.css';

// ── Tab 定义 ────────────────────────────────────────────────

type TabKey = '' | SettlementStatus;

interface TabDef {
  key: TabKey;
  label: string;
}

const TABS: TabDef[] = [
  { key: '',          label: '全部' },
  { key: 'draft',     label: '草稿' },
  { key: 'confirmed', label: '已确认' },
  { key: 'paid',      label: '已付款' },
  { key: 'cancelled', label: '已取消' },
];

// ── 徽章样式映射 ──────────────────────────────────────────────

const BADGE_CLASS: Record<SettlementStatus, string> = {
  draft:     styles['badge--draft'],
  confirmed: styles['badge--confirmed'],
  paid:      styles['badge--paid'],
  cancelled: styles['badge--cancelled'],
};

// ── 日期格式化 ──────────────────────────────────────────────

function formatDate(str: string): string {
  try {
    return new Date(str).toLocaleDateString('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit',
    });
  } catch {
    return str;
  }
}

// ── 金额格式化 ──────────────────────────────────────────────

function formatAmount(val: string | number): string {
  const num = typeof val === 'string' ? parseFloat(val) : val;
  return isNaN(num) ? '--' : `¥${num.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}`;
}

// ── 主页面 ──────────────────────────────────────────────────

const PAGE_SIZE = 20;

export default function SettlementPage() {
  const { setPageTitle } = useAppStore();
  const { hasAnyRole } = useAuthStore();
  const [activeTab, setActiveTab] = useState<TabKey>('');
  const [page, setPage] = useState(1);

  useEffect(() => { setPageTitle('销售结算'); }, [setPageTitle]);

  const isBoss = hasAnyRole([UserRole.BOSS]);

  const query: SettlementListQuery = {
    page,
    pageSize: PAGE_SIZE,
    status: activeTab || undefined,
  };

  const { data, isLoading, error } = useSettlementList(query);
  const confirmMutation = useConfirmSettlement();
  const payMutation = usePaySettlement();
  const cancelMutation = useCancelSettlement();

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 1;
  const list = data?.list ?? [];

  const handleTabChange = useCallback((key: TabKey) => {
    setActiveTab(key);
    setPage(1);
  }, []);

  const COL_SPAN = 6;

  return (
    <div className={styles.page}>
      {/* 页头 */}
      <div className={styles.page_header}>
        <h1 className={styles.page_title}>销售结算</h1>
        <Button variant="primary" size="md" disabled>
          + 新建结算
        </Button>
      </div>

      {/* Tab 筛选 */}
      <div className={styles.tab_bar} role="tablist">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            role="tab"
            aria-selected={activeTab === tab.key}
            className={`${styles.tab_item} ${activeTab === tab.key ? styles['tab_item--active'] : ''}`}
            onClick={() => handleTabChange(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 表格 */}
      <div className={styles.table_wrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>结算单号</th>
              <th>客户</th>
              <th>结算金额</th>
              <th>状态</th>
              <th>创建时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className={styles.skeleton_row}>
                  {Array.from({ length: COL_SPAN }).map((__, j) => (
                    <td key={j}>
                      <div className={styles.skeleton_cell} style={{ width: j === 0 ? '120px' : '70%' }} />
                    </td>
                  ))}
                </tr>
              ))
            ) : error ? (
              <tr>
                <td colSpan={COL_SPAN}>
                  <div className={styles.error_wrap}>
                    <p>加载失败：{(error as Error).message}</p>
                  </div>
                </td>
              </tr>
            ) : list.length === 0 ? (
              <tr>
                <td colSpan={COL_SPAN}>
                  <div className={styles.empty_state}>
                    <span className={styles.empty_icon}>📄</span>
                    <p className={styles.empty_text}>暂无结算单</p>
                  </div>
                </td>
              </tr>
            ) : (
              list.map((item) => (
                <tr key={item.id}>
                  <td className={styles.cell_mono}>{item.settlementNo}</td>
                  <td>{item.customerName || '--'}</td>
                  <td className={styles.cell_amount}>{formatAmount(item.totalAmount)}</td>
                  <td>
                    <span className={`${styles.badge} ${BADGE_CLASS[item.status]}`}>
                      {SettlementStatusLabel[item.status]}
                    </span>
                  </td>
                  <td className={styles.cell_secondary}>{formatDate(item.createdAt)}</td>
                  <td>
                    <div className={styles.action_cell}>
                      {item.status === 'draft' && isBoss && (
                        <button
                          className={`${styles.action_btn} ${styles['action_btn--confirm']}`}
                          onClick={() => confirmMutation.mutate(item.id)}
                          disabled={confirmMutation.isPending}
                        >
                          确认
                        </button>
                      )}
                      {item.status === 'confirmed' && isBoss && (
                        <button
                          className={`${styles.action_btn} ${styles['action_btn--pay']}`}
                          onClick={() => payMutation.mutate(item.id)}
                          disabled={payMutation.isPending}
                        >
                          标记已付
                        </button>
                      )}
                      {(item.status === 'draft' || item.status === 'confirmed') && (
                        <button
                          className={`${styles.action_btn} ${styles['action_btn--cancel']}`}
                          onClick={() => cancelMutation.mutate(item.id)}
                          disabled={cancelMutation.isPending}
                        >
                          取消
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* 分页 */}
      {(data?.total ?? 0) > 0 && (
        <div className={styles.pagination}>
          <span className={styles.pagination__info}>
            共 {data?.total ?? 0} 条，第 {page} / {totalPages} 页
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
              return (
                <button
                  key={p}
                  className={page === p ? styles.pagination__btn_primary : styles.pagination__btn_ghost}
                  onClick={() => setPage(p)}
                  aria-current={page === p ? 'page' : undefined}
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
