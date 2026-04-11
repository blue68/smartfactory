/**
 * [artifact:前端代码] — 采购建议管理页面
 */
import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  usePurchaseSuggestionList,
  useApprovePurchaseSuggestion,
  useRejectPurchaseSuggestion,
  useBatchToPo,
  type PurchaseSuggestion,
  type PurchaseSuggestionSource,
  type PurchaseSuggestionStatus,
} from '@/api/purchaseSuggestion';
import { useSupplierOptions } from '@/api/supplier';
import { useAppStore } from '@/stores/appStore';
import styles from './PurchaseSuggestionPage.module.css';

type UrgencyLevel = 'urgent' | 'normal';
type ReviewAction = 'approve' | 'reject';

interface SuggestionRow {
  id: number;
  suggestionNo: string;
  source: PurchaseSuggestionSource;
  status: PurchaseSuggestionStatus;
  skuId: number;
  suggestedSupplierId: number | null;
  skuCode: string;
  skuName: string;
  purchaseUnit: string;
  supplierName: string;
  suggestedQty: string;
  estimatedPrice: string | null;
  estimatedAmount: string | null;
  shortageQty: string | null;
  reason: string;
  rejectReason: string | null;
  workOrderNo: string | null;
  createdAt: string | null;
  approvedAt: string | null;
  confidence: string | null;
  urgency: UrgencyLevel;
}

interface LinkedOrderInfo {
  poId: number;
  poNo: string;
}

const SOURCE_META: Record<PurchaseSuggestionSource, { label: string; tone: string }> = {
  production_shortage: { label: '生产缺料', tone: 'shortage' },
  ai_schedule: { label: 'AI 排产', tone: 'ai' },
  manual: { label: '手动', tone: 'manual' },
  outsource_operation: { label: '外协半成品', tone: 'outsource' },
};

const STATUS_META: Record<PurchaseSuggestionStatus, { label: string; tone: string; icon: string }> = {
  pending: { label: '待审批', tone: 'pending', icon: '⏳' },
  approved: { label: '已通过', tone: 'approved', icon: '✓' },
  rejected: { label: '已驳回', tone: 'rejected', icon: '✕' },
  executed: { label: '已执行', tone: 'executed', icon: '→' },
  expired: { label: '已过期', tone: 'expired', icon: '•' },
};

function toNumber(value: string | number | null | undefined): number {
  const num = Number(value ?? 0);
  return Number.isFinite(num) ? num : 0;
}

function formatMoney(value: string | number | null | undefined): string {
  const amount = toNumber(value);
  const hasFraction = Math.abs(amount % 1) > 0.0001;
  return `¥${amount.toLocaleString('zh-CN', {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: hasFraction ? 2 : 0,
  })}`;
}

function formatQty(value: string | number | null | undefined): string {
  const num = toNumber(value);
  return Number.isInteger(num) ? String(num) : num.toFixed(2);
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  return value.replace('T', ' ').slice(0, 16);
}

function formatConfidence(value: string | null | undefined): string {
  if (!value) return '—';
  const num = Number(value);
  if (!Number.isFinite(num)) return String(value);
  const ratio = num > 1 ? num / 100 : num;
  return `${Math.round(ratio * 100)}%`;
}

function normalizeSuggestion(item: PurchaseSuggestion): SuggestionRow {
  const record = item as PurchaseSuggestion & Record<string, unknown>;
  const source = (record.source as PurchaseSuggestionSource | undefined) ?? 'manual';
  return {
    id: Number(record.id ?? 0),
    suggestionNo: String(record.suggestionNo ?? record.suggestion_no ?? `PS-${record.id ?? '0000'}`),
    source,
    status: (record.status as PurchaseSuggestionStatus | undefined) ?? 'pending',
    skuId: Number(record.skuId ?? record.sku_id ?? 0),
    suggestedSupplierId: (record.suggestedSupplierId ?? record.suggested_supplier_id ?? null) as number | null,
    skuCode: String(record.skuCode ?? record.sku_code ?? '—'),
    skuName: String(record.skuName ?? record.sku_name ?? '未命名物料'),
    purchaseUnit: String(record.purchaseUnit ?? record.purchase_unit ?? record.stockUnit ?? record.stock_unit ?? '个'),
    supplierName: String(record.supplierName ?? record.supplier_name ?? '待补充'),
    suggestedQty: String(record.suggestedQty ?? record.suggested_qty ?? '0'),
    estimatedPrice: (record.estimatedPrice ?? record.estimated_price ?? null) as string | null,
    estimatedAmount: (record.estimatedAmount ?? record.estimated_amount ?? null) as string | null,
    shortageQty: (record.shortageQty ?? record.shortage_qty ?? null) as string | null,
    reason: String(record.reason ?? ''),
    rejectReason: (record.rejectReason ?? record.reject_reason ?? null) as string | null,
    workOrderNo: (record.workOrderNo ?? record.work_order_no ?? null) as string | null,
    createdAt: (record.createdAt ?? record.created_at ?? null) as string | null,
    approvedAt: (record.approvedAt ?? record.approved_at ?? null) as string | null,
    confidence: (record.confidence ?? null) as string | null,
    urgency: source === 'production_shortage' ? 'urgent' : 'normal',
  };
}

function buildPageItems(current: number, totalPages: number): Array<number | 'ellipsis'> {
  if (totalPages <= 5) return Array.from({ length: totalPages }, (_, idx) => idx + 1);
  if (current <= 3) return [1, 2, 3, 'ellipsis', totalPages];
  if (current >= totalPages - 2) return [1, 'ellipsis', totalPages - 2, totalPages - 1, totalPages];
  return [1, 'ellipsis', current, 'ellipsis', totalPages];
}

function exportCsv(rows: SuggestionRow[]) {
  const headers = [
    '建议编号',
    '来源',
    'SKU编码',
    '物料名称',
    '推荐供应商',
    '建议数量',
    '单位',
    '单价',
    '预估金额',
    '关联工单',
    '紧迫程度',
    '状态',
  ];
  const lines = rows.map((row) => [
    row.suggestionNo,
    SOURCE_META[row.source].label,
    row.skuCode,
    row.skuName,
    row.supplierName,
    row.suggestedQty,
    row.purchaseUnit,
    row.estimatedPrice ?? '',
    row.estimatedAmount ?? '',
    row.workOrderNo ?? '',
    row.urgency === 'urgent' ? '紧急' : '一般',
    STATUS_META[row.status].label,
  ]);
  const content = [headers, ...lines]
    .map((cols) => cols.map((col) => `"${String(col ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const blob = new Blob([`\uFEFF${content}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `采购建议_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export default function PurchaseSuggestionPage() {
  const navigate = useNavigate();
  const setPageTitle = useAppStore((state) => state.setPageTitle);
  const showToast = useAppStore((state) => state.showToast);
  const [keyword, setKeyword] = useState('');
  const [sourceFilter, setSourceFilter] = useState<PurchaseSuggestionSource | ''>('');
  const [statusFilter, setStatusFilter] = useState<PurchaseSuggestionStatus | ''>('');
  const [urgencyFilter, setUrgencyFilter] = useState<UrgencyLevel | ''>('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelIds, setPanelIds] = useState<number[]>([]);
  const [panelAction, setPanelAction] = useState<ReviewAction>('approve');
  const [detailId, setDetailId] = useState<number | null>(null);
  const [linkedOrders, setLinkedOrders] = useState<Record<number, LinkedOrderInfo>>({});
  const [rejectReason, setRejectReason] = useState('');
  const [reviewNotes, setReviewNotes] = useState('');
  const [supplierPickerOpen, setSupplierPickerOpen] = useState(false);
  const [supplierPickerIds, setSupplierPickerIds] = useState<number[]>([]);
  const [supplierPickerValue, setSupplierPickerValue] = useState('');

  useEffect(() => {
    setPageTitle('采购建议管理');
  }, [setPageTitle]);

  const listQuery = usePurchaseSuggestionList({
    source: sourceFilter || undefined,
    status: statusFilter || undefined,
    page: 1,
    pageSize: 200,
  });
  const approveMutation = useApprovePurchaseSuggestion();
  const rejectMutation = useRejectPurchaseSuggestion();
  const batchToPOMutation = useBatchToPo();
  const supplierOptionsQuery = useSupplierOptions();
  const deferredKeyword = useDeferredValue(keyword);

  const rows = useMemo(
    () => (listQuery.data?.list ?? []).map(normalizeSuggestion),
    [listQuery.data],
  );

  const filteredRows = useMemo(() => {
    const kw = deferredKeyword.trim().toLowerCase();
    return rows.filter((row) => {
      if (urgencyFilter && row.urgency !== urgencyFilter) return false;
      if (!kw) return true;
      return [
        row.suggestionNo,
        row.skuCode,
        row.skuName,
        row.supplierName,
        row.workOrderNo ?? '',
        row.reason,
        row.rejectReason ?? '',
      ].some((value) => value.toLowerCase().includes(kw));
    });
  }, [deferredKeyword, rows, urgencyFilter]);

  const total = filteredRows.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pagedRows = filteredRows.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const allVisibleSelected = pagedRows.length > 0 && pagedRows.every((row) => selectedIds.has(row.id));

  const selectedRows = rows.filter((row) => selectedIds.has(row.id));
  const selectedPendingIds = selectedRows.filter((row) => row.status === 'pending').map((row) => row.id);
  const selectedApprovedIds = selectedRows.filter((row) => row.status === 'approved').map((row) => row.id);

  const panelRows = rows.filter((row) => panelIds.includes(row.id));
  const panelIsBatch = panelRows.length > 1;
  const primaryRow = panelRows[0] ?? null;
  const detailRow = rows.find((row) => row.id === detailId) ?? null;
  const detailOrderLink = detailRow ? linkedOrders[detailRow.id] ?? null : null;
  const supplierPickerRows = rows.filter((row) => supplierPickerIds.includes(row.id));
  const supplierPickerMissingRows = supplierPickerRows.filter((row) => row.suggestedSupplierId === null);
  const supplierOptions = useMemo(
    () => (supplierOptionsQuery.data ?? []).map((item) => ({ id: item.id, label: `${item.name}（${item.code}）` })),
    [supplierOptionsQuery.data],
  );
  const submittingReview = approveMutation.isPending || rejectMutation.isPending;
  const overlayOpen = panelOpen || detailId !== null || supplierPickerOpen;

  const {
    pendingCount,
    pendingUrgentCount,
    approvedCount,
    rejectedCount,
    pendingAmount,
    lastUpdated,
  } = useMemo(() => {
    const visibleUpdateCandidates = filteredRows
      .map((row) => row.approvedAt ?? row.createdAt)
      .filter(Boolean)
      .sort();
    const fallbackUpdateCandidates = rows
      .map((row) => row.approvedAt ?? row.createdAt)
      .filter(Boolean)
      .sort();
    const visibleUpdatedAt = visibleUpdateCandidates[visibleUpdateCandidates.length - 1] ?? null;
    const fallbackUpdatedAt = fallbackUpdateCandidates[fallbackUpdateCandidates.length - 1] ?? null;

    return {
      pendingCount: filteredRows.filter((row) => row.status === 'pending').length,
      pendingUrgentCount: filteredRows.filter((row) => row.status === 'pending' && row.urgency === 'urgent').length,
      approvedCount: filteredRows.filter((row) => row.status === 'approved').length,
      rejectedCount: filteredRows.filter((row) => row.status === 'rejected').length,
      pendingAmount: filteredRows
        .filter((row) => row.status === 'pending')
        .reduce((sum, row) => sum + toNumber(row.estimatedAmount), 0),
      lastUpdated: visibleUpdatedAt ?? fallbackUpdatedAt ?? null,
    };
  }, [filteredRows, rows]);

  useEffect(() => {
    setPage(1);
  }, [keyword, sourceFilter, statusFilter, urgencyFilter, pageSize]);

  useEffect(() => {
    if (detailId !== null && !rows.some((row) => row.id === detailId)) {
      setDetailId(null);
    }
  }, [detailId, rows]);

  useEffect(() => {
    if (!overlayOpen) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (supplierPickerOpen) {
        setSupplierPickerOpen(false);
        setSupplierPickerIds([]);
        setSupplierPickerValue('');
        return;
      }
      if (panelOpen) {
        closePanel();
        return;
      }
      if (detailId !== null) {
        closeDetailPanel();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [detailId, overlayOpen, panelOpen, supplierPickerOpen]);

  const openReviewPanel = (ids: number[], action: ReviewAction) => {
    if (ids.length === 0) {
      showToast({ type: 'warning', message: '请先选择待审批的采购建议' });
      return;
    }
    setDetailId(null);
    setPanelIds(ids);
    setPanelAction(action);
    setRejectReason('');
    setReviewNotes('');
    setPanelOpen(true);
  };

  const openDetailPanel = (id: number) => {
    setPanelOpen(false);
    setPanelIds([]);
    setDetailId(id);
  };

  const closePanel = () => {
    setPanelOpen(false);
    setPanelIds([]);
    setRejectReason('');
    setReviewNotes('');
    setPanelAction('approve');
  };

  const closeDetailPanel = () => {
    setDetailId(null);
  };

  const closeSupplierPicker = () => {
    setSupplierPickerOpen(false);
    setSupplierPickerIds([]);
    setSupplierPickerValue('');
  };

  const handleOpenPurchaseOrder = (row: SuggestionRow) => {
    const linkedOrder = linkedOrders[row.id];
    if (!linkedOrder) {
      openDetailPanel(row.id);
      return;
    }
    navigate(`/purchase/orders?orderId=${linkedOrder.poId}`);
  };

  const handleToggleRow = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleToggleAllVisible = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        pagedRows.forEach((row) => next.delete(row.id));
      } else {
        pagedRows.forEach((row) => next.add(row.id));
      }
      return next;
    });
  };

  const executeBatchTransfer = async (ids: number[], fallbackSupplierId?: number) => {
    const transferRows = rows.filter((row) => ids.includes(row.id));
    const result = await batchToPOMutation.mutateAsync({
      suggestionIds: ids,
      supplierId: fallbackSupplierId,
    });
    const poBySupplier = new Map(result.createdPOs.map((po) => [po.supplierId, po]));
    setLinkedOrders((prev) => {
      const next = { ...prev };
      transferRows.forEach((row) => {
        const effectiveSupplierId = row.suggestedSupplierId ?? fallbackSupplierId ?? null;
        if (!effectiveSupplierId) return;
        const linked = poBySupplier.get(effectiveSupplierId);
        if (linked) {
          next[row.id] = { poId: linked.id, poNo: linked.poNo };
        }
      });
      return next;
    });
    setSelectedIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.delete(id));
      return next;
    });
    showToast({
      type: 'success',
      message: `已转 ${result.executedSuggestionIds.length} 条建议，生成 ${result.createdPOs.length} 张采购单`,
    });
  };

  const handleBatchTransfer = async (ids: number[]) => {
    if (ids.length === 0) {
      showToast({ type: 'warning', message: '请先选择已通过的采购建议' });
      return;
    }

    const transferRows = rows.filter((row) => ids.includes(row.id));
    const noSupplierRows = transferRows.filter((row) => row.suggestedSupplierId === null);
    if (noSupplierRows.length > 0) {
      setSupplierPickerIds(ids);
      setSupplierPickerValue('');
      setSupplierPickerOpen(true);
      return;
    }

    try {
      await executeBatchTransfer(ids);
    } catch (error) {
      showToast({
        type: 'error',
        message: error instanceof Error ? error.message : '转采购单失败',
      });
    }
  };

  const handleConfirmSupplierTransfer = async () => {
    if (supplierPickerIds.length === 0) return;
    const supplierId = Number(supplierPickerValue);
    if (!Number.isInteger(supplierId) || supplierId <= 0) {
      showToast({ type: 'warning', message: '请先选择供应商' });
      return;
    }

    try {
      await executeBatchTransfer(supplierPickerIds, supplierId);
      closeSupplierPicker();
    } catch (error) {
      showToast({
        type: 'error',
        message: error instanceof Error ? error.message : '转采购单失败',
      });
    }
  };

  const handleConfirmReview = async () => {
    if (panelIds.length === 0) return;
    if (panelAction === 'reject' && !rejectReason.trim()) {
      showToast({ type: 'warning', message: '请填写驳回原因' });
      return;
    }

    try {
      if (panelAction === 'approve') {
        await Promise.all(
          panelIds.map((id) =>
            approveMutation.mutateAsync({
              id,
              data: reviewNotes.trim() ? { notes: reviewNotes.trim() } : undefined,
            })),
        );
        showToast({
          type: 'success',
          message: panelIds.length > 1 ? `已批量通过 ${panelIds.length} 条建议` : '采购建议已通过',
        });
      } else {
        await Promise.all(
          panelIds.map((id) =>
            rejectMutation.mutateAsync({
              id,
              data: { reason: rejectReason.trim() },
            })),
        );
        showToast({
          type: 'success',
          message: panelIds.length > 1 ? `已批量驳回 ${panelIds.length} 条建议` : '采购建议已驳回',
        });
      }
      setSelectedIds((prev) => {
        const next = new Set(prev);
        panelIds.forEach((id) => next.delete(id));
        return next;
      });
      closePanel();
    } catch (error) {
      showToast({
        type: 'error',
        message: error instanceof Error ? error.message : '审批提交失败',
      });
    }
  };

  return (
    <div className={styles.page}>
      <section className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>
            <span className={styles.pageTitleIcon}>🛒</span>
            采购建议管理
          </h1>
          <p className={styles.pageSubtitle}>
            <span className={styles.subtitleDot} />
            AI 自动生成的采购建议，需人工审批后转为采购单
            <span className={styles.subtitleDot} />
            最后更新：{formatDateTime(lastUpdated)}
          </p>
        </div>
        <div className={styles.pageActions}>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={() => exportCsv(filteredRows)}
            disabled={filteredRows.length === 0}
          >
            <span>⬇</span>
            导出
          </button>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={() => void handleBatchTransfer(selectedApprovedIds)}
            disabled={selectedApprovedIds.length === 0 || batchToPOMutation.isPending}
          >
            <span>↗</span>
            批量转采购订单
          </button>
        </div>
      </section>

      <section className={styles.kpiGrid} aria-label="汇总统计">
        <article className={`${styles.kpiCard} ${styles.kpiOrange}`}>
          <div className={styles.kpiBgIcon}>⏳</div>
          <div className={styles.kpiHeader}>
            <span className={styles.kpiLabel}>待审批</span>
            <span className={`${styles.kpiBadge} ${styles.kpiBadgeOrange}`}>需处理</span>
          </div>
          <div className={`${styles.kpiValue} ${styles.kpiValueOrange}`}>{pendingCount}</div>
          <div className={styles.kpiSub}>📋 含 {pendingUrgentCount} 条紧急建议，请优先处理</div>
        </article>

        <article className={`${styles.kpiCard} ${styles.kpiGreen}`}>
          <div className={styles.kpiBgIcon}>✓</div>
          <div className={styles.kpiHeader}>
            <span className={styles.kpiLabel}>已通过</span>
            <span className={`${styles.kpiBadge} ${styles.kpiBadgeGreen}`}>本页</span>
          </div>
          <div className={`${styles.kpiValue} ${styles.kpiValueGreen}`}>{approvedCount}</div>
          <div className={styles.kpiSub}>📅 当前筛选结果中的已通过建议</div>
        </article>

        <article className={`${styles.kpiCard} ${styles.kpiGray}`}>
          <div className={styles.kpiBgIcon}>✕</div>
          <div className={styles.kpiHeader}>
            <span className={styles.kpiLabel}>已驳回</span>
            <span className={`${styles.kpiBadge} ${styles.kpiBadgeGray}`}>本页</span>
          </div>
          <div className={`${styles.kpiValue} ${styles.kpiValueGray}`}>{rejectedCount}</div>
          <div className={styles.kpiSub}>📝 可查看驳回原因</div>
        </article>

        <article className={`${styles.kpiCard} ${styles.kpiBlue}`}>
          <div className={styles.kpiBgIcon}>¥</div>
          <div className={styles.kpiHeader}>
            <span className={styles.kpiLabel}>预计采购金额</span>
            <span className={`${styles.kpiBadge} ${styles.kpiBadgeBlue}`}>待审批合计</span>
          </div>
          <div className={`${styles.kpiValue} ${styles.kpiValueBlue}`}>{formatMoney(pendingAmount)}</div>
          <div className={styles.kpiSub}>📊 {pendingCount} 条待审批建议合计金额</div>
        </article>
      </section>

      <section className={styles.filterBar} aria-label="筛选条件">
        <div className={styles.searchBox}>
          <span className={styles.searchIcon}>🔍</span>
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            className={styles.searchInput}
            placeholder="搜索 SKU 编码 / 物料名称..."
            aria-label="搜索物料"
          />
        </div>

        <div className={styles.filterDivider} />

        <select
          className={styles.filterSelect}
          value={sourceFilter}
          onChange={(e) => setSourceFilter((e.target.value || '') as PurchaseSuggestionSource | '')}
          aria-label="筛选来源"
        >
          <option value="">全部来源</option>
          <option value="production_shortage">生产缺料</option>
          <option value="manual">手动</option>
          <option value="ai_schedule">AI 排产</option>
          <option value="outsource_operation">外协半成品</option>
        </select>

        <select
          className={styles.filterSelect}
          value={statusFilter}
          onChange={(e) => setStatusFilter((e.target.value || '') as PurchaseSuggestionStatus | '')}
          aria-label="筛选状态"
        >
          <option value="">全部状态</option>
          <option value="pending">待审批</option>
          <option value="approved">已通过</option>
          <option value="rejected">已驳回</option>
          <option value="executed">已执行</option>
          <option value="expired">已过期</option>
        </select>

        <select
          className={styles.filterSelect}
          value={urgencyFilter}
          onChange={(e) => setUrgencyFilter((e.target.value || '') as UrgencyLevel | '')}
          aria-label="筛选紧迫程度"
        >
          <option value="">全部紧迫度</option>
          <option value="urgent">紧急</option>
          <option value="normal">一般</option>
        </select>

        <div className={styles.filterDivider} />

        <div className={styles.filterCount}>
          共 <strong>{total}</strong> 条建议
        </div>
      </section>

      <section className={styles.tableCard} aria-label="采购建议列表">
        <div className={styles.tableWrap}>
          <table className={styles.table} aria-busy={listQuery.isLoading}>
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    className={styles.rowCheckbox}
                    checked={allVisibleSelected}
                    onChange={handleToggleAllVisible}
                    aria-label="全选当前页"
                  />
                </th>
                <th>建议编号</th>
                <th>来源</th>
                <th>SKU 编码</th>
                <th>物料名称</th>
                <th>推荐供应商</th>
                <th className={styles.numCell}>建议数量</th>
                <th>单位</th>
                <th className={styles.numCell}>单价</th>
                <th className={styles.numCell}>预估金额</th>
                <th>关联工单</th>
                <th>紧迫程度</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {listQuery.isLoading && (
                Array.from({ length: 6 }).map((_, idx) => (
                  <tr key={`skeleton-${idx}`}>
                    {Array.from({ length: 14 }).map((__, cellIdx) => (
                      <td key={cellIdx}>
                        <div className={styles.skeletonLine} />
                      </td>
                    ))}
                  </tr>
                ))
              )}

              {!listQuery.isLoading && pagedRows.length === 0 && (
                <tr>
                  <td colSpan={14} className={styles.emptyCell}>
                    暂无符合条件的采购建议
                  </td>
                </tr>
              )}

              {!listQuery.isLoading && pagedRows.map((row) => {
                const sourceMeta = SOURCE_META[row.source];
                const statusMeta = STATUS_META[row.status];
                return (
                  <tr key={row.id} className={row.urgency === 'urgent' ? styles.rowUrgent : ''}>
                    <td>
                      <input
                        type="checkbox"
                        className={styles.rowCheckbox}
                        checked={selectedIds.has(row.id)}
                        onChange={() => handleToggleRow(row.id)}
                        aria-label={`选择 ${row.suggestionNo}`}
                      />
                    </td>
                    <td>
                      <button type="button" className={styles.idLink} onClick={() => openDetailPanel(row.id)}>
                        {row.suggestionNo}
                      </button>
                    </td>
                    <td>
                      <span className={`${styles.sourceBadge} ${styles[`sourceBadge--${sourceMeta.tone}`]}`}>
                        {sourceMeta.label}
                      </span>
                    </td>
                    <td><span className={styles.skuCode}>{row.skuCode}</span></td>
                    <td><span className={styles.skuName}>{row.skuName}</span></td>
                    <td><span className={styles.supplierName}>{row.supplierName}</span></td>
                    <td className={styles.numCell}>{formatQty(row.suggestedQty)}</td>
                    <td>{row.purchaseUnit}</td>
                    <td className={styles.numCell}>{formatMoney(row.estimatedPrice)}</td>
                    <td className={styles.numCell}>
                      <span className={toNumber(row.estimatedAmount) >= 10000 ? styles.highlightAmount : styles.amountValue}>
                        {formatMoney(row.estimatedAmount)}
                      </span>
                    </td>
                    <td>
                      {row.workOrderNo ? (
                        <span className={styles.workOrderLink}>{row.workOrderNo}</span>
                      ) : (
                        <span className={styles.workOrderEmpty}>—</span>
                      )}
                    </td>
                    <td>
                      <span className={`${styles.urgencyBadge} ${styles[`urgencyBadge--${row.urgency}`]}`}>
                        <span className={`${styles.urgencyDot} ${styles[`urgencyDot--${row.urgency}`]}`} />
                        {row.urgency === 'urgent' ? '紧急' : '一般'}
                      </span>
                    </td>
                    <td>
                      <span className={`${styles.statusBadge} ${styles[`statusBadge--${statusMeta.tone}`]}`}>
                        <span>{statusMeta.icon}</span>
                        {statusMeta.label}
                      </span>
                    </td>
                    <td>
                      <div className={styles.actionGroup}>
                        {row.status === 'pending' && (
                          <>
                            <button
                              type="button"
                              className={`${styles.tableButton} ${styles.tableButtonApprove}`}
                              onClick={() => openReviewPanel([row.id], 'approve')}
                            >
                              通过
                            </button>
                            <button
                              type="button"
                              className={`${styles.tableButton} ${styles.tableButtonReject}`}
                              onClick={() => openReviewPanel([row.id], 'reject')}
                            >
                              驳回
                            </button>
                          </>
                        )}
                        {row.status === 'approved' && (
                          <>
                            <button
                              type="button"
                              className={`${styles.actionLink} ${styles.actionLinkTransfer}`}
                              onClick={() => void handleBatchTransfer([row.id])}
                            >
                              转采购单
                            </button>
                            <button
                              type="button"
                              className={`${styles.actionLink} ${styles.actionLinkMuted}`}
                              onClick={() => openDetailPanel(row.id)}
                            >
                              详情
                            </button>
                          </>
                        )}
                        {row.status === 'rejected' && (
                          <button
                            type="button"
                            className={`${styles.actionLink} ${styles.actionLinkMuted}`}
                            onClick={() => openDetailPanel(row.id)}
                          >
                            查看原因
                          </button>
                        )}
                        {row.status === 'executed' && (
                          <button
                            type="button"
                            className={`${styles.actionLink} ${linkedOrders[row.id] ? styles.actionLinkTransfer : styles.actionLinkMuted}`}
                            onClick={() => handleOpenPurchaseOrder(row)}
                          >
                            查看采购单
                          </button>
                        )}
                        {row.status === 'expired' && (
                          <button
                            type="button"
                            className={`${styles.actionLink} ${styles.actionLinkMuted}`}
                            onClick={() => openDetailPanel(row.id)}
                          >
                            详情
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className={styles.batchBar} role="toolbar" aria-label="批量操作">
          <span className={styles.batchCount}>
            已选 <strong>{selectedIds.size}</strong> 条
          </span>
          <span className={styles.batchDivider} />
          <span className={styles.batchLabel}>批量操作：</span>
          <button
            type="button"
            className={`${styles.tableButton} ${styles.tableButtonApprove}`}
            disabled={selectedPendingIds.length === 0}
            onClick={() => openReviewPanel(selectedPendingIds, 'approve')}
          >
            批量通过
          </button>
          <button
            type="button"
            className={`${styles.tableButton} ${styles.tableButtonReject}`}
            disabled={selectedPendingIds.length === 0}
            onClick={() => openReviewPanel(selectedPendingIds, 'reject')}
          >
            批量驳回
          </button>
          <button
            type="button"
            className={styles.secondaryButtonSmall}
            disabled={selectedApprovedIds.length === 0 || batchToPOMutation.isPending}
            onClick={() => void handleBatchTransfer(selectedApprovedIds)}
          >
            <span>↗</span>
            转采购订单
          </button>
          <span className={styles.batchSpacer} />
          <button
            type="button"
            className={styles.clearButton}
            onClick={() => setSelectedIds(new Set())}
            disabled={selectedIds.size === 0}
          >
            清除选择
          </button>
        </div>

        <div className={styles.paginationBar} role="navigation" aria-label="分页控制">
          <div className={styles.paginationLeft}>
            <div className={styles.perPageGroup}>
              <span>每页显示</span>
              <select
                className={styles.perPageSelect}
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
                aria-label="每页条数"
              >
                <option value={10}>10 条</option>
                <option value={20}>20 条</option>
                <option value={50}>50 条</option>
              </select>
            </div>
            <span className={styles.paginationMeta}>共 <strong>{total}</strong> 条记录</span>
          </div>

          <div className={styles.paginationRight}>
            <button
              type="button"
              className={styles.pageButton}
              onClick={() => setPage(Math.max(1, currentPage - 1))}
              disabled={currentPage <= 1}
              aria-label="上一页"
            >
              ‹
            </button>
            {buildPageItems(currentPage, totalPages).map((item, idx) =>
              item === 'ellipsis' ? (
                <span key={`ellipsis-${idx}`} className={styles.pageEllipsis}>…</span>
              ) : (
                <button
                  key={item}
                  type="button"
                  className={`${styles.pageButton} ${currentPage === item ? styles.pageButtonActive : ''}`}
                  onClick={() => setPage(item)}
                  aria-current={currentPage === item ? 'page' : undefined}
                >
                  {item}
                </button>
              ),
            )}
            <button
              type="button"
              className={styles.pageButton}
              onClick={() => setPage(Math.min(totalPages, currentPage + 1))}
              disabled={currentPage >= totalPages}
              aria-label="下一页"
            >
              ›
            </button>
          </div>
        </div>
      </section>

      {panelOpen && primaryRow && (
        <div className={styles.panelOverlay} role="presentation" onClick={closePanel}>
          <aside
            className={styles.reviewPanel}
            role="dialog"
            aria-modal="true"
            aria-label="审批采购建议"
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.panelHeader}>
              <div className={styles.panelTitleWrap}>
                <div className={styles.panelTitleIcon}>📋</div>
                <div className={styles.panelTitle}>审批采购建议</div>
              </div>
              <button type="button" className={styles.panelClose} onClick={closePanel} aria-label="关闭">
                ✕
              </button>
            </div>

            <div className={styles.panelBody}>
              <section className={styles.infoCard}>
                <div className={styles.infoCardTitle}>物料 &amp; 建议信息</div>
                {!panelIsBatch && (
                  <div className={styles.infoGrid}>
                    <div>
                      <div className={styles.infoLabel}>建议编号</div>
                      <div className={`${styles.infoValue} ${styles.infoMono}`}>{primaryRow.suggestionNo}</div>
                    </div>
                    <div>
                      <div className={styles.infoLabel}>来源</div>
                      <div className={styles.infoValue}>
                        <span className={`${styles.sourceBadge} ${styles[`sourceBadge--${SOURCE_META[primaryRow.source].tone}`]}`}>
                          {SOURCE_META[primaryRow.source].label}
                        </span>
                      </div>
                    </div>
                    <div>
                      <div className={styles.infoLabel}>SKU 编码</div>
                      <div className={`${styles.infoValue} ${styles.infoMono}`}>{primaryRow.skuCode}</div>
                    </div>
                    <div>
                      <div className={styles.infoLabel}>物料名称</div>
                      <div className={styles.infoValue}>{primaryRow.skuName}</div>
                    </div>
                    <div>
                      <div className={styles.infoLabel}>推荐供应商</div>
                      <div className={styles.infoValue}>{primaryRow.supplierName}</div>
                    </div>
                    <div>
                      <div className={styles.infoLabel}>关联工单</div>
                      <div className={`${styles.infoValue} ${styles.infoMono}`}>{primaryRow.workOrderNo ?? '—'}</div>
                    </div>
                    <div>
                      <div className={styles.infoLabel}>建议数量</div>
                      <div className={styles.infoValue}>
                        {formatQty(primaryRow.suggestedQty)} <span className={styles.infoMuted}>{primaryRow.purchaseUnit}</span>
                      </div>
                    </div>
                    <div>
                      <div className={styles.infoLabel}>预估金额</div>
                      <div className={`${styles.infoValue} ${styles.infoAmount}`}>{formatMoney(primaryRow.estimatedAmount)}</div>
                    </div>
                  </div>
                )}
                {panelIsBatch && (
                  <div className={styles.infoGrid}>
                    <div>
                      <div className={styles.infoLabel}>批量条数</div>
                      <div className={`${styles.infoValue} ${styles.infoMono}`}>{panelRows.length} 条</div>
                    </div>
                    <div>
                      <div className={styles.infoLabel}>待审批金额</div>
                      <div className={`${styles.infoValue} ${styles.infoAmount}`}>
                        {formatMoney(panelRows.reduce((sum, row) => sum + toNumber(row.estimatedAmount), 0))}
                      </div>
                    </div>
                    <div className={styles.infoSpanTwo}>
                      <div className={styles.infoLabel}>批量对象</div>
                      <div className={styles.batchSummaryList}>
                        {panelRows.slice(0, 4).map((row) => (
                          <span key={row.id} className={styles.batchSummaryChip}>
                            {row.suggestionNo} · {row.skuName}
                          </span>
                        ))}
                        {panelRows.length > 4 && (
                          <span className={styles.batchSummaryChip}>另 {panelRows.length - 4} 条</span>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </section>

              <section>
                <div className={styles.panelSectionTitle}>
                  审批操作 <span>*</span>
                </div>
                <div className={styles.actionChoiceGroup} role="radiogroup" aria-label="审批结果">
                  <label className={`${styles.actionChoice} ${panelAction === 'approve' ? styles.actionChoiceActiveApprove : ''}`}>
                    <input
                      type="radio"
                      name="review-action"
                      checked={panelAction === 'approve'}
                      onChange={() => setPanelAction('approve')}
                    />
                    <span className={styles.actionChoiceIcon}>✅</span>
                    <span className={styles.actionChoiceText}>
                      <strong>通过</strong>
                      <small>建议转入采购执行</small>
                    </span>
                  </label>
                  <label className={`${styles.actionChoice} ${panelAction === 'reject' ? styles.actionChoiceActiveReject : ''}`}>
                    <input
                      type="radio"
                      name="review-action"
                      checked={panelAction === 'reject'}
                      onChange={() => setPanelAction('reject')}
                    />
                    <span className={styles.actionChoiceIcon}>❌</span>
                    <span className={styles.actionChoiceText}>
                      <strong>驳回</strong>
                      <small>需填写驳回原因</small>
                    </span>
                  </label>
                </div>
              </section>

              <section className={styles.fieldBlock}>
                <div className={`${styles.fieldLabel} ${panelAction === 'reject' ? styles.fieldLabelDanger : ''}`}>
                  驳回原因 <span>*</span>
                  <span className={styles.fieldHint}>选择“驳回”时必填</span>
                </div>
                <textarea
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  rows={3}
                  disabled={panelAction !== 'reject'}
                  className={`${styles.textarea} ${panelAction === 'reject' ? styles.textareaReject : ''}`}
                  placeholder="请填写驳回原因，例如：当前库存充足，暂不需要采购..."
                />
              </section>

              <section className={styles.fieldBlock}>
                <div className={styles.fieldLabel}>
                  备注说明
                  <span className={styles.fieldHint}>可选</span>
                </div>
                <textarea
                  value={reviewNotes}
                  onChange={(e) => setReviewNotes(e.target.value)}
                  rows={2}
                  className={styles.textarea}
                  placeholder="补充说明（可选）..."
                />
              </section>
            </div>

            <div className={styles.panelFooter}>
              <button type="button" className={styles.panelCancelButton} onClick={closePanel}>
                取消
              </button>
              <button
                type="button"
                className={panelAction === 'approve' ? styles.panelApproveButton : styles.panelRejectButton}
                onClick={() => void handleConfirmReview()}
                disabled={submittingReview}
              >
                <span>{panelAction === 'approve' ? '✓' : '✕'}</span>
                {panelAction === 'approve'
                  ? panelIsBatch ? '确认批量通过' : '确认通过'
                  : panelIsBatch ? '确认批量驳回' : '确认驳回'}
              </button>
            </div>
          </aside>
        </div>
      )}

      {supplierPickerOpen && (
        <div className={styles.dialogOverlay} role="presentation" onClick={closeSupplierPicker}>
          <section
            className={styles.supplierDialog}
            role="dialog"
            aria-modal="true"
            aria-label="补充供应商后转采购单"
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.supplierDialogHeader}>
              <div className={styles.panelTitleWrap}>
                <div className={styles.panelTitleIcon}>🏷️</div>
                <div className={styles.panelTitle}>补充供应商后转采购单</div>
              </div>
              <button type="button" className={styles.panelClose} onClick={closeSupplierPicker} aria-label="关闭">
                ✕
              </button>
            </div>

            <div className={styles.supplierDialogBody}>
              <p className={styles.supplierDialogDescription}>
                当前选中 {supplierPickerIds.length} 条建议，其中 {supplierPickerMissingRows.length} 条未指定供应商。
                请选择一个供应商作为本次缺失项的统一补充值。
              </p>

              {supplierPickerMissingRows.length > 0 && (
                <div className={styles.supplierMissingList}>
                  {supplierPickerMissingRows.slice(0, 6).map((row) => (
                    <span key={row.id} className={styles.batchSummaryChip}>
                      {row.suggestionNo} · {row.skuName}
                    </span>
                  ))}
                  {supplierPickerMissingRows.length > 6 && (
                    <span className={styles.batchSummaryChip}>
                      另 {supplierPickerMissingRows.length - 6} 条
                    </span>
                  )}
                </div>
              )}

              <label className={styles.fieldLabel} htmlFor="fallback-supplier-select">
                补充供应商 <span>*</span>
              </label>
              <select
                id="fallback-supplier-select"
                className={`${styles.filterSelect} ${styles.supplierSelect}`}
                value={supplierPickerValue}
                onChange={(e) => setSupplierPickerValue(e.target.value)}
                disabled={supplierOptionsQuery.isLoading}
              >
                <option value="">请选择供应商</option>
                {supplierOptions.map((option) => (
                  <option key={option.id} value={String(option.id)}>
                    {option.label}
                  </option>
                ))}
              </select>

              {supplierOptionsQuery.isLoading && (
                <p className={styles.supplierDialogHint}>供应商列表加载中...</p>
              )}
              {!supplierOptionsQuery.isLoading && supplierOptions.length === 0 && (
                <p className={styles.supplierDialogHint}>暂无可用供应商，请先在供应商主数据维护中新增。</p>
              )}
            </div>

            <div className={styles.supplierDialogFooter}>
              <button type="button" className={styles.panelCancelButton} onClick={closeSupplierPicker}>
                取消
              </button>
              <button
                type="button"
                className={styles.panelApproveButton}
                onClick={() => void handleConfirmSupplierTransfer()}
                disabled={batchToPOMutation.isPending || supplierOptionsQuery.isLoading}
              >
                <span>↗</span>
                确认转采购单
              </button>
            </div>
          </section>
        </div>
      )}

      {detailRow && (
        <div className={styles.panelOverlay} role="presentation" onClick={closeDetailPanel}>
          <aside
            className={`${styles.reviewPanel} ${styles.detailPanel}`}
            role="dialog"
            aria-modal="true"
            aria-label="采购建议详情"
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.panelHeader}>
              <div className={styles.panelTitleWrap}>
                <div className={styles.panelTitleIcon}>🧾</div>
                <div>
                  <div className={styles.panelTitle}>采购建议详情</div>
                  <div className={styles.detailSubtitle}>{detailRow.suggestionNo}</div>
                </div>
              </div>
              <button type="button" className={styles.panelClose} onClick={closeDetailPanel} aria-label="关闭">
                ✕
              </button>
            </div>

            <div className={styles.panelBody}>
              <section className={styles.detailHero}>
                <div className={styles.detailHeroHeader}>
                  <div>
                    <div className={styles.detailEyebrow}>物料建议</div>
                    <div className={styles.detailTitle}>{detailRow.skuName}</div>
                    <div className={styles.detailSubtitleRow}>
                      <span className={styles.skuCode}>{detailRow.skuCode}</span>
                      <span className={`${styles.urgencyBadge} ${styles[`urgencyBadge--${detailRow.urgency}`]}`}>
                        <span className={`${styles.urgencyDot} ${styles[`urgencyDot--${detailRow.urgency}`]}`} />
                        {detailRow.urgency === 'urgent' ? '紧急' : '一般'}
                      </span>
                    </div>
                  </div>
                  <span className={`${styles.statusBadge} ${styles[`statusBadge--${STATUS_META[detailRow.status].tone}`]}`}>
                    <span>{STATUS_META[detailRow.status].icon}</span>
                    {STATUS_META[detailRow.status].label}
                  </span>
                </div>
              </section>

              <section className={styles.infoCard}>
                <div className={styles.infoCardTitle}>基础信息</div>
                <div className={styles.infoGrid}>
                  <div>
                    <div className={styles.infoLabel}>来源</div>
                    <div className={styles.infoValue}>
                      <span className={`${styles.sourceBadge} ${styles[`sourceBadge--${SOURCE_META[detailRow.source].tone}`]}`}>
                        {SOURCE_META[detailRow.source].label}
                      </span>
                    </div>
                  </div>
                  <div>
                    <div className={styles.infoLabel}>推荐供应商</div>
                    <div className={styles.infoValue}>{detailRow.supplierName}</div>
                  </div>
                  <div>
                    <div className={styles.infoLabel}>建议数量</div>
                    <div className={styles.infoValue}>
                      {formatQty(detailRow.suggestedQty)} <span className={styles.infoMuted}>{detailRow.purchaseUnit}</span>
                    </div>
                  </div>
                  <div>
                    <div className={styles.infoLabel}>预估金额</div>
                    <div className={`${styles.infoValue} ${styles.infoAmount}`}>{formatMoney(detailRow.estimatedAmount)}</div>
                  </div>
                  <div>
                    <div className={styles.infoLabel}>短缺数量</div>
                    <div className={styles.infoValue}>
                      {detailRow.shortageQty ? formatQty(detailRow.shortageQty) : '—'}
                    </div>
                  </div>
                  <div>
                    <div className={styles.infoLabel}>关联工单</div>
                    <div className={`${styles.infoValue} ${styles.infoMono}`}>{detailRow.workOrderNo ?? '—'}</div>
                  </div>
                  <div>
                    <div className={styles.infoLabel}>创建时间</div>
                    <div className={styles.infoValue}>{formatDateTime(detailRow.createdAt)}</div>
                  </div>
                  <div>
                    <div className={styles.infoLabel}>审批时间</div>
                    <div className={styles.infoValue}>{formatDateTime(detailRow.approvedAt)}</div>
                  </div>
                </div>
              </section>

              <section className={styles.infoCard}>
                <div className={styles.infoCardTitle}>建议依据</div>
                <div className={styles.detailTextBlock}>
                  <div className={styles.detailTextTitle}>建议说明</div>
                  <p>{detailRow.reason || '未提供建议说明'}</p>
                </div>
                {detailRow.rejectReason && (
                  <div className={styles.detailTextBlock}>
                    <div className={styles.detailTextTitle}>驳回原因</div>
                    <p>{detailRow.rejectReason}</p>
                  </div>
                )}
                <div className={styles.detailMetaRow}>
                  <span className={styles.batchSummaryChip}>置信度 {formatConfidence(detailRow.confidence)}</span>
                  {detailOrderLink && (
                    <span className={styles.batchSummaryChip}>采购单 {detailOrderLink.poNo}</span>
                  )}
                </div>
                {detailRow.status === 'executed' && !detailOrderLink && (
                  <div className={styles.inlineNotice}>
                    当前列表未回填采购单号；如果这是本次会话刚转出的建议，刷新后仍未出现时请到采购订单页按时间范围核对。
                  </div>
                )}
              </section>
            </div>

            <div className={styles.panelFooter}>
              <button type="button" className={styles.panelCancelButton} onClick={closeDetailPanel}>
                关闭
              </button>
              {detailRow.status === 'pending' && (
                <>
                  <button
                    type="button"
                    className={styles.panelRejectButton}
                    onClick={() => {
                      closeDetailPanel();
                      openReviewPanel([detailRow.id], 'reject');
                    }}
                  >
                    <span>✕</span>
                    驳回建议
                  </button>
                  <button
                    type="button"
                    className={styles.panelApproveButton}
                    onClick={() => {
                      closeDetailPanel();
                      openReviewPanel([detailRow.id], 'approve');
                    }}
                  >
                    <span>✓</span>
                    通过建议
                  </button>
                </>
              )}
              {detailRow.status === 'approved' && (
                <button
                  type="button"
                  className={styles.panelApproveButton}
                  onClick={() => void handleBatchTransfer([detailRow.id])}
                  disabled={batchToPOMutation.isPending}
                >
                  <span>↗</span>
                  转采购订单
                </button>
              )}
              {detailRow.status === 'executed' && detailOrderLink && (
                <button
                  type="button"
                  className={styles.panelApproveButton}
                  onClick={() => navigate(`/purchase/orders?orderId=${detailOrderLink.poId}`)}
                >
                  <span>↗</span>
                  查看采购订单
                </button>
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
