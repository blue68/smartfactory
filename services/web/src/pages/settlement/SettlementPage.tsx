/**
 * [artifact:前端代码] — 销售结算页
 *
 * 功能：
 *   - Tab 筛选：全部 / 草稿 / 已确认 / 已付款 / 已取消
 *   - 结算单列表：settlement_no / customer / total_amount / status / created_at / 操作
 *   - 操作按钮按 status + role 条件显示
 *   - 分页、骨架屏、空态、错误态
 */

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useAppStore } from '@/stores/appStore';
import { useAuthStore } from '@/stores/authStore';
import { UserRole } from '@/types/enums';
import Button from '@/components/common/Button';
import {
  settlementApi,
  useSettlementList,
  useSettlementReceivable,
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

function isOverdueSettlement(status: SettlementStatus, dueDate?: string): boolean {
  if (!dueDate) return false;
  if (!['draft', 'confirmed'].includes(status)) return false;
  return new Date(dueDate).getTime() < Date.now();
}

export default function SettlementPage() {
  const { setPageTitle } = useAppStore();
  const { hasAnyRole } = useAuthStore();
  const [activeTab, setActiveTab] = useState<TabKey>('');
  const [page, setPage] = useState(1);
  const [keywordInput, setKeywordInput] = useState('');
  const [keyword, setKeyword] = useState('');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [receivableGroup, setReceivableGroup] = useState<'customer' | 'month' | 'aging'>('customer');
  const [selectedCustomer, setSelectedCustomer] = useState<{ id: number; name: string } | null>(null);

  useEffect(() => { setPageTitle('销售结算'); }, [setPageTitle]);

  const isBoss = hasAnyRole([UserRole.BOSS]);
  const canManageSettlement = hasAnyRole([UserRole.BOSS, UserRole.SUPERVISOR]);
  const canViewReceivable = hasAnyRole([UserRole.BOSS, UserRole.SUPERVISOR]);

  const query: SettlementListQuery = useMemo(() => ({
    page,
    pageSize: PAGE_SIZE,
    status: activeTab || undefined,
    keyword: keyword || undefined,
    overdueOnly,
    customerId: selectedCustomer?.id,
  }), [activeTab, keyword, overdueOnly, page, selectedCustomer?.id]);

  const { data, isLoading, error } = useSettlementList(query);
  const { data: receivableSummary } = useSettlementReceivable(receivableGroup, canViewReceivable);
  const confirmMutation = useConfirmSettlement();
  const payMutation = usePaySettlement();
  const cancelMutation = useCancelSettlement();

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 1;
  const list = data?.list ?? [];
  const customerReceivables = receivableSummary?.groupBy === 'customer' ? receivableSummary.data : [];
  const monthReceivables = receivableSummary?.groupBy === 'month' ? receivableSummary.data : [];
  const agingReceivables = receivableSummary?.groupBy === 'aging' ? receivableSummary.data : [];
  const overdueAmount = receivableSummary?.groupBy === 'aging' ? receivableSummary.overdueAmount : '0.00';
  const overdueCount = receivableSummary?.groupBy === 'aging' ? receivableSummary.overdueCount : 0;
  const totalReceivableAmount = customerReceivables.reduce(
    (sum, item) => sum + Number(item.totalAmount ?? 0),
    0,
  );
  const maxCustomerAmount = customerReceivables.reduce(
    (max, item) => Math.max(max, Number(item.totalAmount ?? 0)),
    0,
  );

  const handleTabChange = useCallback((key: TabKey) => {
    setActiveTab(key);
    setPage(1);
  }, []);

  const handleSearch = useCallback(() => {
    setKeyword(keywordInput.trim());
    setPage(1);
  }, [keywordInput]);

  const handleReset = useCallback(() => {
    setKeywordInput('');
    setKeyword('');
    setOverdueOnly(false);
    setSelectedCustomer(null);
    setPage(1);
  }, []);

  const handleCustomerSummaryClick = useCallback((customerId: number, customerName: string) => {
    setSelectedCustomer({ id: customerId, name: customerName });
    setPage(1);
  }, []);

  const handleExport = useCallback(async () => {
    await settlementApi.exportCsv(query);
  }, [query]);

  const COL_SPAN = 7;

  return (
    <div className={styles.page}>
      {/* 页头 */}
      <div className={styles.page_header}>
        <h1 className={styles.page_title}>销售结算</h1>
        {canManageSettlement && (
          <Button variant="primary" size="md" disabled>
            + 新建结算
          </Button>
        )}
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

      <div className={styles.filter_bar}>
        <input
          value={keywordInput}
          onChange={(e) => setKeywordInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSearch();
          }}
          className={styles.filter_input}
          placeholder="筛选结算单号 / 客户 / 订单号"
          aria-label="筛选结算单"
        />
        <label className={styles.filter_checkbox}>
          <input
            type="checkbox"
            checked={overdueOnly}
            onChange={(e) => {
              setOverdueOnly(e.target.checked);
              setPage(1);
            }}
          />
          仅看逾期
        </label>
        <div className={styles.filter_actions}>
          <Button variant="secondary" size="sm" onClick={handleSearch}>
            查询
          </Button>
          <Button variant="ghost" size="sm" onClick={handleReset}>
            重置
          </Button>
          {canViewReceivable && (
            <Button variant="ghost" size="sm" onClick={() => void handleExport()}>
              导出 CSV
            </Button>
          )}
        </div>
      </div>

      {selectedCustomer && (
        <div className={styles.active_filter_bar}>
          <span className={styles.active_filter_chip}>
            客户：{selectedCustomer.name}
          </span>
          <button
            type="button"
            className={styles.active_filter_clear}
            onClick={() => {
              setSelectedCustomer(null);
              setPage(1);
            }}
          >
            清除客户过滤
          </button>
        </div>
      )}

      {canViewReceivable && (
        <section className={styles.receivable_grid} aria-label="应收账款汇总">
          <div className={styles.receivable_switch} role="tablist" aria-label="应收汇总维度">
            <button
              type="button"
              role="tab"
              aria-selected={receivableGroup === 'customer'}
              className={`${styles.receivable_switch_btn} ${receivableGroup === 'customer' ? styles['receivable_switch_btn--active'] : ''}`}
              onClick={() => setReceivableGroup('customer')}
            >
              按客户
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={receivableGroup === 'month'}
              className={`${styles.receivable_switch_btn} ${receivableGroup === 'month' ? styles['receivable_switch_btn--active'] : ''}`}
              onClick={() => setReceivableGroup('month')}
            >
              按月份
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={receivableGroup === 'aging'}
              className={`${styles.receivable_switch_btn} ${receivableGroup === 'aging' ? styles['receivable_switch_btn--active'] : ''}`}
              onClick={() => setReceivableGroup('aging')}
            >
              账龄
            </button>
          </div>

          {receivableGroup === 'customer' ? (
            <div className={styles.receivable_card}>
              <div className={styles.receivable_card_header}>
                <div className={styles.receivable_card_title}>按客户汇总</div>
                <span className={styles.receivable_card_meta}>
                  共 {customerReceivables.length} 个客户
                </span>
              </div>

              <div className={styles.receivable_list}>
                {customerReceivables.length === 0 ? (
                  <div className={styles.receivable_empty}>暂无客户应收数据</div>
                ) : (
                  customerReceivables.map((item) => {
                    const amount = Number(item.totalAmount ?? 0);
                    const width = maxCustomerAmount > 0 ? `${Math.max((amount / maxCustomerAmount) * 100, 8)}%` : '8%';
                    const isActive = selectedCustomer?.id === item.customerId;
                    return (
                      <button
                        key={item.customerId}
                        type="button"
                        className={`${styles.receivable_bar_row} ${isActive ? styles.receivable_bar_row_active : ''}`}
                        onClick={() => handleCustomerSummaryClick(item.customerId, item.customerName)}
                      >
                        <div className={styles.receivable_bar_label}>{item.customerName}</div>
                        <div className={styles.receivable_bar_track}>
                          <div className={styles.receivable_bar_fill} style={{ width }} />
                          <span className={styles.receivable_bar_value}>{formatAmount(item.totalAmount)}</span>
                        </div>
                        <div className={styles.receivable_bar_meta}>
                          {item.pendingCount} 笔
                        </div>
                      </button>
                    );
                  })
                )}
              </div>

              <div className={styles.receivable_total}>
                <span>应收合计</span>
                <strong>{formatAmount(totalReceivableAmount)}</strong>
              </div>
            </div>
          ) : receivableGroup === 'month' ? (
            <div className={styles.receivable_card}>
              <div className={styles.receivable_card_header}>
                <div className={styles.receivable_card_title}>按月份汇总</div>
                <span className={styles.receivable_card_meta}>近期待收概览</span>
              </div>

              <div className={styles.receivable_table_wrap}>
                <table className={styles.receivable_table}>
                  <thead>
                    <tr>
                      <th>月份</th>
                      <th>应收金额</th>
                      <th>结算单数</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monthReceivables.length === 0 ? (
                      <tr>
                        <td colSpan={3} className={styles.receivable_empty_cell}>
                          暂无月份汇总数据
                        </td>
                      </tr>
                    ) : (
                      monthReceivables.map((item) => (
                        <tr key={item.month}>
                          <td>{item.month}</td>
                          <td className={styles.receivable_amount_cell}>{formatAmount(item.totalAmount)}</td>
                          <td>{item.count}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className={styles.receivable_card}>
              <div className={styles.receivable_card_header}>
                <div className={styles.receivable_card_title}>应收账龄</div>
                <span className={styles.receivable_card_meta}>按到期日滚动计算</span>
              </div>

              <div className={styles.aging_summary}>
                <div className={styles.aging_metric}>
                  <span className={styles.aging_metric_label}>逾期金额</span>
                  <strong className={styles.aging_metric_value}>{formatAmount(overdueAmount)}</strong>
                </div>
                <div className={styles.aging_metric}>
                  <span className={styles.aging_metric_label}>逾期笔数</span>
                  <strong className={styles.aging_metric_value}>{overdueCount}</strong>
                </div>
              </div>

              <div className={styles.aging_list}>
                {agingReceivables.map((item) => (
                  <div key={item.bucket} className={styles.aging_row}>
                    <div className={styles.aging_label}>{item.label}</div>
                    <div className={styles.aging_track}>
                      <div
                        className={styles.aging_fill}
                        style={{
                          width: `${Math.max(
                            (Number(item.totalAmount) / Math.max(...agingReceivables.map((row) => Number(row.totalAmount)), 1)) * 100,
                            Number(item.totalAmount) > 0 ? 8 : 0,
                          )}%`,
                        }}
                      />
                      <span className={styles.aging_value}>{formatAmount(item.totalAmount)}</span>
                    </div>
                    <div className={styles.aging_meta}>{item.count} 笔</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {/* 表格 */}
      <div className={styles.table_wrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>结算单号</th>
              <th>客户</th>
              <th>结算金额</th>
              <th>状态</th>
              <th>到期日</th>
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
                <tr key={item.id} className={isOverdueSettlement(item.status, item.dueDate) ? styles.row_overdue : undefined}>
                  <td className={styles.cell_mono}>{item.settlementNo}</td>
                  <td>{item.customerName || '--'}</td>
                  <td className={styles.cell_amount}>{formatAmount(item.totalAmount)}</td>
                  <td>
                    <span className={`${styles.badge} ${BADGE_CLASS[item.status]}`}>
                      {SettlementStatusLabel[item.status]}
                    </span>
                  </td>
                  <td className={isOverdueSettlement(item.status, item.dueDate) ? styles.cell_overdue : styles.cell_secondary}>
                    {item.dueDate ? formatDate(item.dueDate) : '--'}
                    {isOverdueSettlement(item.status, item.dueDate) && (
                      <span className={styles.overdue_badge}>已逾期</span>
                    )}
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
                      {(item.status === 'draft' || item.status === 'confirmed') && canManageSettlement && (
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
