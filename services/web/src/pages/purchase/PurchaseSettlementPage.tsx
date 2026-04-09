import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ACTION_CODES } from '@/constants/accessControl';
import { usePermission } from '@/hooks/usePermission';
import { useAppStore } from '@/stores/appStore';
import Button from '@/components/common/Button';
import {
  purchaseApi,
  PurchaseSettlementStatusLabel,
  type PurchaseSettlementStatus,
  type PurchaseSettlementListQuery,
  usePurchaseSettlementList,
  useConfirmPurchaseSettlement,
  usePayPurchaseSettlement,
  useCancelPurchaseSettlement,
} from '@/api/purchase';
import styles from './PurchaseSettlementPage.module.css';

type TabKey = '' | PurchaseSettlementStatus;

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: '', label: '全部' },
  { key: 'draft', label: '草稿' },
  { key: 'confirmed', label: '已确认' },
  { key: 'paid', label: '已付款' },
  { key: 'cancelled', label: '已取消' },
];

const BADGE_CLASS: Record<PurchaseSettlementStatus, string> = {
  draft: styles['badge--draft'],
  confirmed: styles['badge--confirmed'],
  paid: styles['badge--paid'],
  cancelled: styles['badge--cancelled'],
};

const PAGE_SIZE = 20;

function formatDate(value?: string | null): string {
  if (!value) return '--';
  try {
    return new Date(value).toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  } catch {
    return value;
  }
}

function formatAmount(value: string | number): string {
  const num = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(num)) return '--';
  return `¥${num.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function PurchaseSettlementPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { setPageTitle, showToast } = useAppStore();
  const { can } = usePermission();

  const statusParam = (searchParams.get('status') || '') as TabKey;
  const poIdParam = Number(searchParams.get('poId') ?? '') || undefined;
  const keywordParam = searchParams.get('keyword') || '';

  const [activeTab, setActiveTab] = useState<TabKey>(statusParam);
  const [poIdFilter, setPoIdFilter] = useState<number | undefined>(poIdParam);
  const [page, setPage] = useState(1);
  const [keywordInput, setKeywordInput] = useState(keywordParam);
  const [keyword, setKeyword] = useState(keywordParam);

  const isBoss = can(ACTION_CODES.PURCHASE_SETTLEMENT_BOSS);
  const canManage = can(ACTION_CODES.PURCHASE_SETTLEMENT_MANAGE);

  useEffect(() => {
    setPageTitle('采购结算');
  }, [setPageTitle]);

  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (activeTab) next.set('status', activeTab);
    else next.delete('status');
    if (poIdFilter) next.set('poId', String(poIdFilter));
    else next.delete('poId');
    if (keyword) next.set('keyword', keyword);
    else next.delete('keyword');
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
  }, [activeTab, keyword, poIdFilter, searchParams, setSearchParams]);

  const query: PurchaseSettlementListQuery = {
    page,
    pageSize: PAGE_SIZE,
    status: activeTab || undefined,
    poId: poIdFilter,
    keyword: keyword || undefined,
  };

  const { data, isLoading, error } = usePurchaseSettlementList(query);
  const confirmMutation = useConfirmPurchaseSettlement();
  const payMutation = usePayPurchaseSettlement();
  const cancelMutation = useCancelPurchaseSettlement();

  const list = useMemo(() => data?.list ?? [], [data?.list]);
  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const stats = useMemo(() => {
    const totalAmount = list.reduce((sum, item) => sum + Number(item.totalAmount || 0), 0);
    return {
      totalAmount,
      draftCount: list.filter((item) => item.status === 'draft').length,
      confirmedCount: list.filter((item) => item.status === 'confirmed').length,
      paidCount: list.filter((item) => item.status === 'paid').length,
    };
  }, [list]);

  const handleSearch = () => {
    setKeyword(keywordInput.trim());
    setPage(1);
  };

  const handleReset = () => {
    setKeywordInput('');
    setKeyword('');
    setPoIdFilter(undefined);
    setActiveTab('');
    setPage(1);
  };

  const handleExport = async () => {
    try {
      await purchaseApi.exportSettlementsCsv(query);
      showToast({ type: 'success', message: '采购结算 CSV 已导出' });
    } catch (err) {
      showToast({ type: 'error', message: (err as Error).message });
    }
  };

  const COL_SPAN = 9;

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>采购结算</h1>
          <p className={styles.pageDesc}>承接三单匹配后的应付结算，统一查看待确认、待付款与已付款状态。</p>
        </div>
        <div className={styles.pageActions}>
          <Button variant="ghost" size="sm" onClick={() => navigate('/purchase/match')}>
            返回三单匹配
          </Button>
          <Button variant="secondary" size="sm" onClick={() => void handleExport()}>
            导出 CSV
          </Button>
        </div>
      </div>

      <section className={styles.statsGrid} aria-label="采购结算概览">
        <div className={styles.statCard}>
          <span className={styles.statLabel}>当前页结算金额</span>
          <strong className={styles.statValue}>{formatAmount(stats.totalAmount)}</strong>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>草稿</span>
          <strong className={styles.statValue}>{stats.draftCount}</strong>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>待付款</span>
          <strong className={styles.statValue}>{stats.confirmedCount}</strong>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>已付款</span>
          <strong className={styles.statValue}>{stats.paidCount}</strong>
        </div>
      </section>

      <div className={styles.tabBar} role="tablist" aria-label="采购结算状态筛选">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.key}
            className={`${styles.tabItem} ${activeTab === tab.key ? styles['tabItem--active'] : ''}`}
            onClick={() => {
              setActiveTab(tab.key);
              setPage(1);
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className={styles.filterBar}>
        <input
          value={keywordInput}
          onChange={(e) => setKeywordInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSearch();
          }}
          className={styles.filterInput}
          placeholder="筛选结算单号 / 采购单号 / 供应商 / 入库单号"
          aria-label="筛选采购结算单"
        />
        <div className={styles.filterActions}>
          <Button variant="secondary" size="sm" onClick={handleSearch}>
            查询
          </Button>
          <Button variant="ghost" size="sm" onClick={handleReset}>
            重置
          </Button>
        </div>
      </div>

      {poIdFilter && (
        <div className={styles.activeFilterBar}>
          <span className={styles.activeFilterChip}>采购单 #{poIdFilter}</span>
          <button
            type="button"
            className={styles.activeFilterClear}
            onClick={() => {
              setPoIdFilter(undefined);
              setPage(1);
            }}
          >
            清除过滤
          </button>
        </div>
      )}

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>结算单号</th>
              <th>采购单号</th>
              <th>供应商</th>
              <th>入库单号</th>
              <th>结算金额</th>
              <th>状态</th>
              <th>到期日</th>
              <th>创建时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, index) => (
                <tr key={index} className={styles.skeletonRow}>
                  {Array.from({ length: COL_SPAN }).map((__, cellIndex) => (
                    <td key={cellIndex}>
                      <div className={styles.skeletonCell} />
                    </td>
                  ))}
                </tr>
              ))
            ) : error ? (
              <tr>
                <td colSpan={COL_SPAN}>
                  <div className={styles.emptyState}>加载失败：{(error as Error).message}</div>
                </td>
              </tr>
            ) : list.length === 0 ? (
              <tr>
                <td colSpan={COL_SPAN}>
                  <div className={styles.emptyState}>暂无采购结算单</div>
                </td>
              </tr>
            ) : (
              list.map((item) => (
                <tr key={item.id}>
                  <td className={styles.cellMono}>{item.settlementNo}</td>
                  <td className={styles.cellMono}>{item.poNo}</td>
                  <td>{item.supplierName}</td>
                  <td className={styles.cellMono}>
                    <div>{item.receiptNo}</div>
                    {item.dyeLotSummary?.length ? (
                      <div className={styles.inlineMeta}>缸号：{item.dyeLotSummary.join('、')}</div>
                    ) : null}
                  </td>
                  <td className={styles.cellAmount}>{formatAmount(item.totalAmount)}</td>
                  <td>
                    <span className={`${styles.badge} ${BADGE_CLASS[item.status]}`}>
                      {PurchaseSettlementStatusLabel[item.status]}
                    </span>
                  </td>
                  <td className={styles.cellSecondary}>{formatDate(item.dueDate)}</td>
                  <td className={styles.cellSecondary}>{formatDate(item.createdAt)}</td>
                  <td>
                    <div className={styles.actionCell}>
                      <button
                        type="button"
                        className={styles.actionBtn}
                        onClick={() => navigate(`/purchase/match?poId=${item.poId}&matchId=${item.matchId}`)}
                      >
                        查看匹配
                      </button>
                      {item.status === 'draft' && isBoss && (
                        <button
                          type="button"
                          className={`${styles.actionBtn} ${styles['actionBtn--primary']}`}
                          onClick={() => confirmMutation.mutate(item.id)}
                          disabled={confirmMutation.isPending}
                        >
                          确认
                        </button>
                      )}
                      {item.status === 'confirmed' && isBoss && (
                        <button
                          type="button"
                          className={`${styles.actionBtn} ${styles['actionBtn--success']}`}
                          onClick={() => payMutation.mutate(item.id)}
                          disabled={payMutation.isPending}
                        >
                          标记已付
                        </button>
                      )}
                      {(item.status === 'draft' || item.status === 'confirmed') && canManage && (
                        <button
                          type="button"
                          className={`${styles.actionBtn} ${styles['actionBtn--danger']}`}
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

      {(data?.total ?? 0) > 0 && (
        <div className={styles.pagination}>
          <span className={styles.paginationInfo}>
            共 {data?.total ?? 0} 条，第 {page} / {totalPages} 页
          </span>
          <div className={styles.paginationBtns}>
            <button
              type="button"
              className={styles.paginationBtn}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={page <= 1}
            >
              上一页
            </button>
            <button
              type="button"
              className={styles.paginationBtn}
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
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
