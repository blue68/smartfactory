/**
 * [artifact:前端代码] — 三单匹配页
 * 100% 还原设计稿 docs/ui/web-purchase-match.html
 * 功能：统计卡片、状态筛选、三单匹配列表、差异处理弹窗
 */

import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAppStore } from '@/stores/appStore';
import {
  useMatchList,
  useMatchDetail,
  useExecuteThreeWayMatch,
  useConfirmMatch,
  useCreatePurchaseSettlement,
  usePurchaseOrderList,
  usePurchaseOrderDetail,
} from '@/api/purchase';
import { MatchStatus, DiffReason, PurchaseOrderStatusLabel } from '@/types/enums';
import type { ThreeWayMatch, ThreeWayMatchDiffItem } from '@/types/models';
import type { Column } from '@/components/common/Table';
import Table from '@/components/common/Table';
import Modal from '@/components/common/Modal';
import Button from '@/components/common/Button';
import { formatCNY, formatQtyStr } from '@/utils/format';
import styles from './MatchPage.module.css';

/* ----------------------------------------------------------------
   Types
---------------------------------------------------------------- */
type MatchRecord = ThreeWayMatch & Record<string, unknown>;

type TimeRange = 'month' | 'last-month' | 'quarter' | 'custom';

/** Derive diff badge variant from a match record */
function getDiffBadgeVariant(
  status: MatchStatus,
): 'none' | 'qty' | 'price' | 'spec' {
  if (status === MatchStatus.MATCHED || status === MatchStatus.CONFIRMED)
    return 'none';
  if (status === MatchStatus.PRICE_WARNING || status === MatchStatus.PRICE_DIFF)
    return 'price';
  return 'qty';
}

function getDiffBadgeLabel(record: ThreeWayMatch): string {
  const { matchStatus, diffItems } = record;
  if (matchStatus === MatchStatus.MATCHED || matchStatus === MatchStatus.CONFIRMED)
    return '无差异';
  if (matchStatus === MatchStatus.PRICE_WARNING) {
    const item = diffItems?.[0];
    if (item) {
      const pct = item.historicalAvgPrice
        ? Math.round(
            ((parseFloat(item.dnPrice) - parseFloat(item.historicalAvgPrice)) /
              parseFloat(item.historicalAvgPrice)) *
              100,
          )
        : 0;
      return `↑ 价格异常 +${pct}%`;
    }
    return '↑ 价格预警';
  }
  if (matchStatus === MatchStatus.PRICE_DIFF) return '↑ 价格差异';
  if (matchStatus === MatchStatus.QTY_DIFF) {
    const item = diffItems?.[0];
    if (item?.isDyeLotMismatch) return '缸号不一致';
    const diff = item ? formatQtyStr(item.qtyDiff) : '';
    return `▼ 数量差 ${diff}`;
  }
  return '差异';
}

/* ----------------------------------------------------------------
   Status cell helpers
---------------------------------------------------------------- */
type StatusVariant = 'ok' | 'warn' | 'error' | 'info';

function getStatusVariant(status: MatchStatus): StatusVariant {
  if (status === MatchStatus.MATCHED) return 'ok';
  if (status === MatchStatus.CONFIRMED) return 'info';
  if (status === MatchStatus.PRICE_WARNING) return 'error';
  return 'warn';
}

const STATUS_ICON: Record<StatusVariant, string> = {
  ok: '✓',
  warn: '⚠',
  error: '!',
  info: '✓',
};

const STATUS_LABEL: Record<MatchStatus, string> = {
  [MatchStatus.MATCHED]: '已匹配',
  [MatchStatus.QTY_DIFF]: '待处理',
  [MatchStatus.PRICE_DIFF]: '待处理',
  [MatchStatus.PRICE_WARNING]: '价格预警',
  [MatchStatus.CONFIRMED]: '已确认',
};

function formatDeliveryStatus(status?: string | null): string {
  if (!status) return '—';
  if (status === 'draft') return '草稿';
  if (status === 'pending') return '待质检';
  if (status === 'confirmed') return '已确认';
  if (status === 'received') return '已收货';
  if (status === 'cancelled') return '已取消';
  return status;
}

/* ----------------------------------------------------------------
   Diff reason card options (maps to design's 2×2 radio grid)
---------------------------------------------------------------- */
const DIFF_REASON_OPTIONS: { value: DiffReason; label: string; desc: string }[] = [
  { value: DiffReason.SUPPLIER_SHORT, label: '供应商少发',  desc: '供应商未足量发货' },
  { value: DiffReason.RECEIPT_MISS,   label: '入库漏录',    desc: '实际到货但未录入系统' },
  { value: DiffReason.PRICE_ADJUST,   label: '价格调整',    desc: '双方已协商价格变动' },
  { value: DiffReason.OTHER,          label: '其他原因',    desc: '请在备注中说明' },
];

/* ----------------------------------------------------------------
   Compare table row data derived from diffItems
---------------------------------------------------------------- */
interface CompareRow {
  dim: string;
  po: string;
  delivery: string;
  inbound: string;
  /** which column is the diff: 'po' | 'delivery' | 'inbound' | 'all' | null */
  diffCol: 'po' | 'delivery' | 'inbound' | 'all' | null;
}

function buildCompareRows(record: ThreeWayMatch): CompareRow[] {
  const item: ThreeWayMatchDiffItem | undefined = record.diffItems?.[0];
  if (!item) return [];

  const rows: CompareRow[] = [
    {
      dim: '数量',
      po: `${formatQtyStr(item.poQty)} ${item.poUnit}`,
      delivery: `${formatQtyStr(item.dnQty)} ${item.poUnit}`,
      inbound: `${formatQtyStr(item.receiptQty)} ${item.poUnit}`,
      diffCol:
        parseFloat(item.qtyDiff) !== 0
          ? parseFloat(item.receiptQty) !== parseFloat(item.poQty)
            ? 'inbound'
            : null
          : null,
    },
    {
      dim: '差异',
      po: '—',
      delivery: parseFloat(item.qtyDiff) === 0 ? '匹配' : '匹配',
      inbound:
        parseFloat(item.qtyDiff) !== 0
          ? `${parseFloat(item.qtyDiff) > 0 ? '+' : ''}${formatQtyStr(item.qtyDiff)} ${item.poUnit}`
          : '匹配',
      diffCol: parseFloat(item.qtyDiff) !== 0 ? 'inbound' : null,
    },
    {
      dim: '单价',
      po: formatCNY(item.poPrice),
      delivery: formatCNY(item.dnPrice),
      inbound: formatCNY(item.dnPrice),
      diffCol:
        parseFloat(item.priceDiff) !== 0 ? 'all' : null,
    },
    {
      dim: '总金额',
      po: formatCNY(
        String(parseFloat(item.poQty) * parseFloat(item.poPrice)),
      ),
      delivery: formatCNY(
        String(parseFloat(item.dnQty) * parseFloat(item.dnPrice)),
      ),
      inbound: formatCNY(
        String(parseFloat(item.receiptQty) * parseFloat(item.dnPrice)),
      ),
      diffCol: parseFloat(item.priceDiff) !== 0 ? null : null,
    },
  ];

  if (item.hasDyeLot) {
    rows.splice(1, 0, {
      dim: '缸号',
      po: '到货后确认',
      delivery: item.deliveryDyeLots?.join('、') || '—',
      inbound: item.receiptDyeLots?.join('、') || '—',
      diffCol: item.isDyeLotMismatch ? 'all' : null,
    });
  }

  if (item.historicalAvgPrice) {
    rows.splice(3, 0, {
      dim: '历史均价',
      po: formatCNY(item.historicalAvgPrice),
      delivery: '—',
      inbound: '—',
      diffCol: null,
    });
  }

  return rows;
}

/** Build a human-readable warning message for a diff record */
function buildWarningText(record: ThreeWayMatch): string {
  const item = record.diffItems?.[0];
  if (record.matchStatus === MatchStatus.MATCHED || record.matchStatus === MatchStatus.CONFIRMED) {
    return '三单数据已完成核对，可直接作为后续结算与追溯依据。';
  }
  if (!item) return '该记录存在差异，请确认后方可进入结算流程。';

  if (record.matchStatus === MatchStatus.PRICE_WARNING) {
    const avg = parseFloat(item.historicalAvgPrice || '0');
    const actual = parseFloat(item.dnPrice || '0');
    const pct = avg > 0 ? Math.round(((actual - avg) / avg) * 100) : 0;
    return `实际结算单价（${formatCNY(item.dnPrice)}）超出历史均价（${formatCNY(item.historicalAvgPrice)}）${pct}%，超出系统预警阈值 20%。请核实价格变动原因。`;
  }

  if (item.isDyeLotMismatch) {
    return `送货单缸号（${item.deliveryDyeLots?.join('、') || '—'}）与入库单缸号（${item.receiptDyeLots?.join('、') || '—'}）不一致，请先核实面料缸号再进入结算。`;
  }

  const qtyDiff = parseFloat(item.qtyDiff);
  if (qtyDiff !== 0) {
    const abs = Math.abs(qtyDiff);
    return `入库单数量（${formatQtyStr(item.receiptQty)} ${item.poUnit}）少于 PO 单和送货单（均为 ${formatQtyStr(item.poQty)} ${item.poUnit}），差异 ${qtyDiff > 0 ? '+' : '-'}${abs} ${item.poUnit}。差异确认前，此采购单无法进入财务结算流程。`;
  }

  return '该记录存在差异，请确认后方可进入结算流程。';
}

/* ----------------------------------------------------------------
   Component
---------------------------------------------------------------- */
export default function MatchPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { setPageTitle, showToast } = useAppStore();

  // Filter state
  const statusParam = (searchParams.get('status') || '') as MatchStatus | '';
  const poIdParam = Number(searchParams.get('poId') ?? '') || undefined;
  const deliveryNoteIdParam = Number(searchParams.get('deliveryNoteId') ?? '') || undefined;
  const receiptIdParam = Number(searchParams.get('receiptId') ?? '') || undefined;
  const matchIdParam = Number(searchParams.get('matchId') ?? '') || null;
  const executeParam = searchParams.get('execute') === '1';
  const implicitDiffContextKey = `${poIdParam ?? ''}:${deliveryNoteIdParam ?? ''}:${receiptIdParam ?? ''}`;
  const [statusFilter, setStatusFilter] = useState<MatchStatus | ''>(statusParam);
  const [poIdFilter, setPoIdFilter] = useState<number | undefined>(poIdParam);
  const [receiptIdFilter, setReceiptIdFilter] = useState<number | undefined>(receiptIdParam);
  const [timeRange, setTimeRange] = useState<TimeRange>('month');
  const [page, setPage] = useState(1);
  const [activeMatchId, setActiveMatchId] = useState<number | null>(matchIdParam);
  const [activeMatchAllowConfirm, setActiveMatchAllowConfirm] = useState(false);
  const [dismissedImplicitDiffContext, setDismissedImplicitDiffContext] = useState<string | null>(null);

  // Execute match modal
  const [executeModal, setExecuteModal] = useState(false);
  const [executeForm, setExecuteForm] = useState({
    poId: '',
    deliveryNoteId: '',
    receiptId: '',
  });

  const [selectedReason, setSelectedReason] = useState<DiffReason>(
    DiffReason.RECEIPT_MISS,
  );
  const [diffRemark, setDiffRemark] = useState('');

  useEffect(() => { setPageTitle('三单匹配'); }, [setPageTitle]);

  // API hooks
  const { data, isLoading, error } = useMatchList({
    status: statusFilter || undefined,
    poId: poIdFilter,
    receiptId: receiptIdFilter,
    page,
    pageSize: 10,
  });
  const executeOrderListQuery = usePurchaseOrderList(undefined, 1, 100);
  const { data: activeMatchDetail, isLoading: activeMatchLoading } = useMatchDetail(activeMatchId);
  const executePoId = Number(executeForm.poId) || null;
  const executeDeliveryId = Number(executeForm.deliveryNoteId) || null;
  const executeReceiptId = Number(executeForm.receiptId) || null;
  const { data: executeOrder } = usePurchaseOrderDetail(executeModal ? executePoId : null);
  const executeMutation = useExecuteThreeWayMatch();
  const confirmMutation = useConfirmMatch();
  const createSettlementMutation = useCreatePurchaseSettlement();
  const executeOrderOptions = executeOrderListQuery.data?.list ?? [];
  const executeDeliveryOptions = executeOrder?.deliveries ?? [];
  const executeSelectedDelivery = executeDeliveryOptions.find((item) => Number(item.id) === executeDeliveryId) ?? null;
  const executeReceiptOptions = executeSelectedDelivery?.receiptId
    ? [{
        id: Number(executeSelectedDelivery.receiptId),
        receiptNo: executeSelectedDelivery.receiptNo ?? `RC#${executeSelectedDelivery.receiptId}`,
      }]
    : [];

  useEffect(() => {
    setStatusFilter(statusParam);
  }, [statusParam]);

  useEffect(() => {
    setPoIdFilter(poIdParam);
  }, [poIdParam]);

  useEffect(() => {
    setReceiptIdFilter(receiptIdParam);
  }, [receiptIdParam]);

  useEffect(() => {
    if (!matchIdParam) {
      setActiveMatchId(null);
      setActiveMatchAllowConfirm(false);
      return;
    }
    setActiveMatchId((current) => (current === matchIdParam ? current : matchIdParam));
  }, [matchIdParam]);

  useEffect(() => {
    if (!matchIdParam || !data?.list?.length) return;
    const current = data.list.find((item) => item.matchId === matchIdParam);
    if (!current) return;
    const nextAllowConfirm = [
      MatchStatus.QTY_DIFF,
      MatchStatus.PRICE_DIFF,
      MatchStatus.PRICE_WARNING,
    ].includes(current.matchStatus);
    setActiveMatchAllowConfirm((prev) => (prev === nextAllowConfirm ? prev : nextAllowConfirm));
  }, [data?.list, matchIdParam]);

  useEffect(() => {
    if (dismissedImplicitDiffContext === implicitDiffContextKey) return;
    if (matchIdParam || activeMatchId || !data?.list?.length) return;
    if ((receiptIdParam || poIdParam) && data.list.length === 1) {
      const only = data.list[0];
      const needsConfirm = [
        MatchStatus.QTY_DIFF,
        MatchStatus.PRICE_DIFF,
        MatchStatus.PRICE_WARNING,
      ].includes(only.matchStatus);
      if (!needsConfirm) return;
      setActiveMatchId(only.matchId);
      setActiveMatchAllowConfirm(true);
    }
  }, [activeMatchId, data?.list, dismissedImplicitDiffContext, implicitDiffContextKey, matchIdParam, poIdParam, receiptIdParam]);

  useEffect(() => {
    if (!executeParam) return;
    setExecuteForm({
      poId: poIdParam ? String(poIdParam) : '',
      deliveryNoteId: deliveryNoteIdParam ? String(deliveryNoteIdParam) : '',
      receiptId: receiptIdParam ? String(receiptIdParam) : '',
    });
    setExecuteModal(true);
  }, [deliveryNoteIdParam, executeParam, poIdParam, receiptIdParam]);

  useEffect(() => {
    if (!executeModal || !executePoId || !executeOrder?.deliveries?.length) return;
    setExecuteForm((current) => {
      const deliveries = executeOrder.deliveries ?? [];
      let nextDeliveryId = current.deliveryNoteId;
      let nextReceiptId = current.receiptId;

      if (!nextDeliveryId && nextReceiptId) {
        const matchedDelivery = deliveries.find(
          (item) => Number(item.receiptId) === Number(nextReceiptId),
        );
        if (matchedDelivery) {
          nextDeliveryId = String(matchedDelivery.id);
        }
      }

      if (nextDeliveryId && !nextReceiptId) {
        const matchedDelivery = deliveries.find(
          (item) => Number(item.id) === Number(nextDeliveryId),
        );
        if (matchedDelivery?.receiptId) {
          nextReceiptId = String(matchedDelivery.receiptId);
        }
      }

      if (!nextDeliveryId && deliveries.length === 1) {
        const onlyDelivery = deliveries[0];
        nextDeliveryId = String(onlyDelivery.id);
        nextReceiptId = onlyDelivery.receiptId ? String(onlyDelivery.receiptId) : '';
      }

      if (nextDeliveryId === current.deliveryNoteId && nextReceiptId === current.receiptId) {
        return current;
      }
      return { ...current, deliveryNoteId: nextDeliveryId, receiptId: nextReceiptId };
    });
  }, [executeModal, executeOrder, executePoId]);

  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (statusFilter) next.set('status', statusFilter);
    else next.delete('status');
    if (poIdFilter) next.set('poId', String(poIdFilter));
    else next.delete('poId');
    if (deliveryNoteIdParam) next.set('deliveryNoteId', String(deliveryNoteIdParam));
    else next.delete('deliveryNoteId');
    if (receiptIdFilter) next.set('receiptId', String(receiptIdFilter));
    else next.delete('receiptId');
    if (activeMatchId) next.set('matchId', String(activeMatchId));
    else next.delete('matchId');
    if (executeModal) next.set('execute', '1');
    else next.delete('execute');

    const nextQuery = next.toString();
    if (nextQuery !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
  }, [activeMatchId, deliveryNoteIdParam, executeModal, poIdFilter, receiptIdFilter, searchParams, setSearchParams, statusFilter]);

  /* ---- handlers -------------------------------------------- */
  const handleExecute = async () => {
    const { poId, deliveryNoteId, receiptId } = executeForm;
    if (!poId || !deliveryNoteId || !receiptId) {
      showToast({ type: 'warning', message: '请选择完整的采购订单、送货单号和入库单号' });
      return;
    }
    try {
      const result = await executeMutation.mutateAsync({
        poId: Number(poId),
        deliveryNoteId: Number(deliveryNoteId),
        receiptId: Number(receiptId),
      });
      setExecuteModal(false);
      setExecuteForm({ poId: '', deliveryNoteId: '', receiptId: '' });
      setPoIdFilter(result.poId);
      setReceiptIdFilter(result.receiptId);
      if (result.matchStatus === MatchStatus.MATCHED) {
        setActiveMatchId(null);
        setActiveMatchAllowConfirm(false);
        showToast({ type: 'success', message: '三单完全匹配，已自动完成' });
      } else {
        setDismissedImplicitDiffContext(null);
        setActiveMatchId(result.matchId);
        setActiveMatchAllowConfirm(
          [MatchStatus.QTY_DIFF, MatchStatus.PRICE_DIFF, MatchStatus.PRICE_WARNING].includes(result.matchStatus),
        );
        showToast({
          type: 'warning',
          message: `发现差异：${STATUS_LABEL[result.matchStatus]}，请确认`,
        });
      }
    } catch (e) {
      showToast({ type: 'error', message: (e as Error).message });
    }
  };

  const openMatchModal = (record: ThreeWayMatch, allowConfirm: boolean) => {
    setDismissedImplicitDiffContext(null);
    setActiveMatchId(record.matchId);
    setActiveMatchAllowConfirm(allowConfirm);
    setSelectedReason(DiffReason.RECEIPT_MISS);
    setDiffRemark('');
  };

  const handleConfirmDiff = async () => {
    if (!activeMatchDetail) return;
    try {
      await confirmMutation.mutateAsync({
        id: activeMatchDetail.matchId,
        payload: { diffReason: selectedReason, diffNotes: diffRemark },
      });
      showToast({ type: 'success', message: '✓ 差异已确认，采购单已进入结算流程' });
      setActiveMatchId(null);
      setActiveMatchAllowConfirm(false);
    } catch (e) {
      showToast({ type: 'error', message: (e as Error).message });
    }
  };

  const handleCreateSettlement = async (record: ThreeWayMatch) => {
    try {
      const settlement = await createSettlementMutation.mutateAsync({
        matchId: record.matchId,
      });
      showToast({ type: 'success', message: '采购结算单已生成，正在打开' });
      navigate(`/purchase/settlements?poId=${settlement.poId}`);
    } catch (e) {
      showToast({ type: 'error', message: (e as Error).message });
    }
  };

  /* ---- tab counts (from real data or fallback to list total) -- */
  const total = data?.total ?? 0;

  /* ---- table columns --------------------------------------- */
  const columns: Column<MatchRecord>[] = [
    {
      key: 'matchStatus',
      title: '状态',
      width: 100,
      render: (_, r) => {
        const m = r as unknown as ThreeWayMatch;
        const variant = getStatusVariant(m.matchStatus);
        return (
          <div className={styles.status_cell}>
            <div
              className={`${styles.match_icon} ${styles[`match_icon--${variant}`]}`}
              title={STATUS_LABEL[m.matchStatus]}
              aria-label={STATUS_LABEL[m.matchStatus]}
            >
              {STATUS_ICON[variant]}
            </div>
            <span
              className={`${styles.status_label} ${
                variant === 'ok'
                  ? styles['status_label--ok']
                  : variant === 'error'
                  ? styles['status_label--err']
                  : variant === 'info'
                  ? styles['status_label--info']
                  : styles['status_label--warn']
              }`}
            >
              {STATUS_LABEL[m.matchStatus]}
            </span>
          </div>
        );
      },
    },
    {
      key: 'poNo',
      title: 'PO 单号',
      width: 120,
      render: (_, r) => (
        <span className={styles.po_code}>{(r as unknown as ThreeWayMatch).poNo}</span>
      ),
    },
    {
      key: 'supplierName',
      title: '供应商',
      render: (_, r) => {
        // supplierName is not on ThreeWayMatch model; use deliveryNo prefix as fallback
        const m = r as unknown as ThreeWayMatch & { supplierName?: string };
        return m.supplierName ?? '—';
      },
    },
    {
      key: 'skuName',
      title: '物料名称',
      render: (_, r) => {
        const m = r as unknown as ThreeWayMatch;
        return m.diffItems?.[0]?.skuName ?? '—';
      },
    },
    {
      key: 'poQty',
      title: '采购数量',
      width: 100,
      render: (_, r) => {
        const m = r as unknown as ThreeWayMatch;
        const item = m.diffItems?.[0];
        if (!item) return '—';
        return `${formatQtyStr(item.poQty)} ${item.poUnit}`;
      },
    },
    {
      key: 'amount',
      title: '金额',
      width: 110,
      render: (_, r) => {
        const m = r as unknown as ThreeWayMatch;
        const item = m.diffItems?.[0];
        if (!item) return '—';
        const amt = parseFloat(item.poQty) * parseFloat(item.poPrice);
        const isPriceWarning = m.matchStatus === MatchStatus.PRICE_WARNING;
        return (
          <span
            className={`${styles.amount} ${isPriceWarning ? styles['amount--error'] : ''}`}
          >
            {formatCNY(String(amt))}
          </span>
        );
      },
    },
    {
      key: 'diffItems',
      title: '差异项',
      width: 130,
      render: (_, r) => {
        const m = r as unknown as ThreeWayMatch;
        const variant = getDiffBadgeVariant(m.matchStatus);
        const label = getDiffBadgeLabel(m);
        return (
          <span className={`${styles.diff_badge} ${styles[`diff_badge--${variant}`]}`}>
            {label}
          </span>
        );
      },
    },
    {
      key: 'actions',
      title: '操作',
      width: 220,
      render: (_, r) => {
        const m = r as unknown as ThreeWayMatch;
        const needsAction = [
          MatchStatus.QTY_DIFF,
          MatchStatus.PRICE_DIFF,
          MatchStatus.PRICE_WARNING,
        ].includes(m.matchStatus);
        const canSettle = m.matchStatus === MatchStatus.MATCHED || m.matchStatus === MatchStatus.CONFIRMED;

        return (
          <div className={styles.table_actions}>
            {needsAction ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => openMatchModal(m, true)}
              >
                处理差异
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => openMatchModal(m, false)}
              >
                详情
              </Button>
            )}
            {canSettle && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void handleCreateSettlement(m)}
                loading={createSettlementMutation.isPending}
              >
                采购结算
              </Button>
            )}
          </div>
        );
      },
    },
  ];

  /* ---- diff modal data -------------------------------------- */
  const diffRecord = activeMatchDetail;
  const compareRows = diffRecord ? buildCompareRows(diffRecord) : [];
  const warningText = diffRecord ? buildWarningText(diffRecord) : '';
  const modalSubTitle = diffRecord
    ? `${diffRecord.supplierName ?? ''} · ${diffRecord.diffItems?.[0]?.skuName ?? ''}`
    : '';
  const showConfirmButton = Boolean(
    diffRecord && activeMatchAllowConfirm &&
    [MatchStatus.QTY_DIFF, MatchStatus.PRICE_DIFF, MatchStatus.PRICE_WARNING].includes(diffRecord.matchStatus),
  );
  const activePoNo = useMemo(
    () => data?.list?.find((item) => item.poId === poIdFilter)?.poNo ?? null,
    [data?.list, poIdFilter],
  );
  const activeReceiptNo = useMemo(
    () => data?.list?.find((item) => item.receiptId === receiptIdFilter)?.receiptNo ?? null,
    [data?.list, receiptIdFilter],
  );
  const activeFilters = useMemo(
    () =>
      [
        poIdFilter
          ? {
              key: 'poId',
              label: activePoNo ? `采购单 ${activePoNo}` : `采购单 #${poIdFilter}`,
              onClear: () => setPoIdFilter(undefined),
            }
          : null,
        receiptIdFilter
          ? {
              key: 'receiptId',
              label: activeReceiptNo ? `入库单 ${activeReceiptNo}` : `入库单 #${receiptIdFilter}`,
              onClear: () => setReceiptIdFilter(undefined),
            }
          : null,
      ].filter(Boolean) as Array<{ key: string; label: string; onClear: () => void }>,
    [activePoNo, activeReceiptNo, poIdFilter, receiptIdFilter],
  );
  /* ---- render ---------------------------------------------- */
  return (
    <div className={styles.page}>

      {/* ── Page Header ───────────────────────────────────── */}
      <div className="page-header">
        <h1 className="page-header__title">三单匹配</h1>
        <div className="page-header__actions">
          <Button variant="ghost" size="md" onClick={() => navigate('/purchase/deliveries')}>
            查看送货管理
          </Button>
          <Button variant="ghost" size="md" onClick={() => navigate('/purchase/settlements')}>
            查看采购结算
          </Button>
          <Button variant="primary" size="md" onClick={() => setExecuteModal(true)}>
            执行三单匹配
          </Button>
        </div>
      </div>

      {/* ── Stats Strip ───────────────────────────────────── */}
      <div className={styles.stats_strip} role="region" aria-label="汇总统计">
        <div className={styles.stat_card}>
          <div className={styles.stat_card__label}>
            <span className={`${styles.stat_card__dot} ${styles['stat_card__dot--all']}`} />
            本月总采购
          </div>
          <div className={`${styles.stat_card__value} ${styles['stat_card__value--all']}`}>
            {total ?? 0}
          </div>
          <div className={styles.stat_card__sub}>笔采购单</div>
        </div>

        <div className={styles.stat_card}>
          <div className={styles.stat_card__label}>
            <span className={`${styles.stat_card__dot} ${styles['stat_card__dot--matched']}`} />
            已匹配
          </div>
          <div className={`${styles.stat_card__value} ${styles['stat_card__value--matched']}`}>
            {data?.list?.filter((r) => r.matchStatus === MatchStatus.MATCHED || r.matchStatus === MatchStatus.CONFIRMED).length ?? 0}
          </div>
          <div className={styles.stat_card__sub}>三单完全匹配</div>
        </div>

        <div className={styles.stat_card}>
          <div className={styles.stat_card__label}>
            <span className={`${styles.stat_card__dot} ${styles['stat_card__dot--pending']}`} />
            待处理
          </div>
          <div className={`${styles.stat_card__value} ${styles['stat_card__value--pending']}`}>
            {data?.list?.filter((r) =>
              r.matchStatus === MatchStatus.QTY_DIFF ||
              r.matchStatus === MatchStatus.PRICE_DIFF,
            ).length ?? 0}
          </div>
          <div className={styles.stat_card__sub}>数量 / 规格差异</div>
        </div>

        <div className={styles.stat_card}>
          <div className={styles.stat_card__label}>
            <span className={`${styles.stat_card__dot} ${styles['stat_card__dot--price']}`} />
            价格预警
          </div>
          <div className={`${styles.stat_card__value} ${styles['stat_card__value--price']}`}>
            {data?.list?.filter((r) => r.matchStatus === MatchStatus.PRICE_WARNING).length ?? 0}
          </div>
          <div className={styles.stat_card__sub}>超历史均价 20%</div>
        </div>
      </div>

      {/* ── Filter Bar ────────────────────────────────────── */}
      <div className={styles.filter_bar} role="toolbar" aria-label="筛选工具栏">
        {/* Tab group — pill style */}
        <div className={styles.tab_group} role="tablist" aria-label="匹配状态筛选">
          {(
            [
              { val: '' as const,                      label: '全部',   countClass: 'all',     count: total ?? 0 },
              { val: MatchStatus.MATCHED as const,     label: '已匹配', countClass: 'matched', count: data?.list?.filter((r) => r.matchStatus === MatchStatus.MATCHED || r.matchStatus === MatchStatus.CONFIRMED).length ?? 0 },
              { val: MatchStatus.QTY_DIFF as const,    label: '待处理', countClass: 'pending', count: data?.list?.filter((r) => r.matchStatus === MatchStatus.QTY_DIFF || r.matchStatus === MatchStatus.PRICE_DIFF).length ?? 0 },
              { val: MatchStatus.PRICE_WARNING as const, label: '价格预警', countClass: 'price', count: data?.list?.filter((r) => r.matchStatus === MatchStatus.PRICE_WARNING).length ?? 0 },
            ] as const
          ).map(({ val, label, countClass, count }) => (
            <button
              key={val}
              role="tab"
              aria-selected={statusFilter === val}
              className={`${styles.tab_btn} ${statusFilter === val ? styles['tab_btn--active'] : ''}`}
              onClick={() => { setStatusFilter(val); setPage(1); }}
            >
              {label}
              <span className={`${styles.tab_count} ${styles[`tab_count--${countClass}`]}`}>
                {count}
              </span>
            </button>
          ))}
        </div>

        {/* Right side: time range selector */}
        <div className={styles.filter_right}>
          {activeFilters.map((filter) => (
            <button
              key={filter.key}
              type="button"
              className={styles.filter_chip}
              onClick={filter.onClear}
            >
              {filter.label} ×
            </button>
          ))}
          <label htmlFor="timeRange" className="sr-only">时间范围</label>
          <select
            id="timeRange"
            className={styles.filter_select}
            value={timeRange}
            onChange={(e) => setTimeRange(e.target.value as TimeRange)}
          >
            <option value="month">本月</option>
            <option value="last-month">上月</option>
            <option value="quarter">本季度</option>
            <option value="custom">自定义</option>
          </select>
        </div>
      </div>

      {/* ── Table Card ────────────────────────────────────── */}
      <div className={styles.table_card}>
        {/* Table card header */}
        <div className={styles.table_card__header}>
          <span style={{ fontSize: '1.125rem' }}>📋</span>
          <span className={styles.table_card__title}>三单匹配明细</span>
          <span className={styles.table_card__meta}>
            共 {total ?? 0} 条，显示第 {(page - 1) * 10 + 1}–{Math.min(page * 10, total ?? 0)} 条
          </span>
        </div>

        <Table<MatchRecord>
          columns={columns}
          dataSource={(data?.list ?? []) as MatchRecord[]}
          rowKey="matchId"
          loading={isLoading}
          error={error ? (error as Error).message : null}
          emptyText="暂无匹配记录"
          pagination={
            data
              ? { page, pageSize: 10, total: data.total, onChange: setPage }
              : undefined
          }
        />
      </div>

      {/* ================================================================
          Execute Match Modal
      ================================================================ */}
      <Modal
        open={executeModal}
        title="执行三单匹配"
        onClose={() => setExecuteModal(false)}
        onConfirm={() => void handleExecute()}
        confirmLabel="执行匹配"
        confirmLoading={executeMutation.isPending}
        size="sm"
      >
        <div className={styles.exec_form}>
          <div className={styles.exec_field}>
            <label htmlFor="poId" className={styles.exec_label}>采购订单</label>
            <select
              id="poId"
              className={styles.exec_input}
              value={executeForm.poId}
              onChange={(e) => {
                setExecuteForm({
                  poId: e.target.value,
                  deliveryNoteId: '',
                  receiptId: '',
                });
              }}
            >
              <option value="">请选择采购订单</option>
              {executeOrderOptions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.poNo} · {item.supplierName}
                </option>
              ))}
            </select>
            {executeOrder ? (
              <div className={styles.exec_hint}>
                当前订单：{executeOrder.poNo} · {executeOrder.supplierName} · 状态 {PurchaseOrderStatusLabel[executeOrder.status] ?? executeOrder.status}
              </div>
            ) : null}
          </div>

          <div className={styles.exec_field}>
            <label htmlFor="deliveryNoteId" className={styles.exec_label}>送货单号</label>
            <select
              id="deliveryNoteId"
              className={styles.exec_input}
              value={executeForm.deliveryNoteId}
              onChange={(e) => {
                const nextDeliveryId = e.target.value;
                const matchedDelivery = executeDeliveryOptions.find((item) => String(item.id) === nextDeliveryId);
                setExecuteForm((current) => ({
                  ...current,
                  deliveryNoteId: nextDeliveryId,
                  receiptId: matchedDelivery?.receiptId ? String(matchedDelivery.receiptId) : '',
                }));
              }}
              disabled={!executeForm.poId}
            >
              <option value="">{executeForm.poId ? '请选择送货单号' : '请先选择采购订单'}</option>
              {executeDeliveryOptions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.deliveryNo} · {formatDeliveryStatus(String(item.status ?? item.deliveryStatus ?? ''))}
                </option>
              ))}
            </select>
            {executeSelectedDelivery ? (
              <div className={styles.exec_hint}>
                送货日期 {String(executeSelectedDelivery.deliveryDate || '').slice(0, 10) || '—'}
                {executeSelectedDelivery.receiptNo ? ` · 已关联入库单 ${executeSelectedDelivery.receiptNo}` : ' · 尚未生成入库单'}
              </div>
            ) : null}
          </div>

          <div className={styles.exec_field}>
            <label htmlFor="receiptId" className={styles.exec_label}>入库单号</label>
            <select
              id="receiptId"
              className={styles.exec_input}
              value={executeForm.receiptId}
              onChange={(e) =>
                setExecuteForm((current) => ({ ...current, receiptId: e.target.value }))
              }
              disabled={!executeForm.deliveryNoteId || executeReceiptOptions.length === 0}
            >
              <option value="">
                {!executeForm.deliveryNoteId
                  ? '请先选择送货单号'
                  : executeReceiptOptions.length > 0
                    ? '请选择入库单号'
                    : '该送货单尚未生成入库单'}
              </option>
              {executeReceiptOptions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.receiptNo}
                </option>
              ))}
            </select>
            {executeReceiptId && executeReceiptOptions.length > 0 ? (
              <div className={styles.exec_hint}>
                本次将按 {executeOrder?.poNo || '所选采购订单'} / {executeSelectedDelivery?.deliveryNo || '所选送货单'} / {executeReceiptOptions[0].receiptNo} 执行匹配
              </div>
            ) : null}
          </div>
        </div>
      </Modal>

      {/* ================================================================
          Diff / Confirm Modal — design: 差异处理弹窗
      ================================================================ */}
      <Modal
        open={activeMatchId !== null}
        title={diffRecord ? `三单差异详情 — ${diffRecord.poNo}` : '三单差异详情'}
        onClose={() => {
          setDismissedImplicitDiffContext(implicitDiffContextKey);
          setActiveMatchId(null);
          setActiveMatchAllowConfirm(false);
        }}
        onConfirm={showConfirmButton ? () => void handleConfirmDiff() : undefined}
        confirmLabel="✓ 确认差异，完成结算"
        confirmVariant="success"
        confirmLoading={confirmMutation.isPending}
        size="md"
      >
        {activeMatchLoading || !diffRecord ? (
          <div className={styles.detailLoading}>加载中...</div>
        ) : (
          <>
            {/* Sub-title shown inside body (header from Modal component) */}
            <p
              style={{
                fontSize: '0.8125rem',
                color: 'var(--text-secondary)',
                marginBottom: 'var(--space-4)',
              }}
            >
              {modalSubTitle}
            </p>

            <div className={styles.detail_links}>
              <Button
                variant="text"
                size="sm"
                onClick={() => navigate(`/purchase/deliveries?deliveryId=${diffRecord.deliveryNoteId}&poId=${diffRecord.poId}`)}
              >
                查看送货单
              </Button>
              <Button
                variant="text"
                size="sm"
                onClick={() => navigate(`/purchase/orders?orderId=${diffRecord.poId}`)}
              >
                查看采购订单
              </Button>
              <Button
                variant="text"
                size="sm"
                onClick={() => navigate(`/purchase/receipts?receiptId=${diffRecord.receiptId}&poId=${diffRecord.poId}`)}
              >
                查看入库单
              </Button>
            </div>

            {/* Warning strip */}
            <div className={styles.modal_warning_strip}>
              <span className={styles.modal_warning_icon} aria-hidden="true">✗</span>
              <span>{warningText}</span>
            </div>

            {/* Three-way comparison table */}
            <div className={styles.section_label}>三单数据对比</div>
            <table className={styles.compare_table} aria-label="三单对比">
              <thead>
                <tr>
                  <th>维度</th>
                  <th>PO 单</th>
                  <th>送货单</th>
                  <th>入库单</th>
                </tr>
              </thead>
              <tbody>
                {compareRows.map((row, i) => (
                  <tr key={i}>
                    <td>{row.dim}</td>
                    {(['po', 'delivery', 'inbound'] as const).map((col) => {
                      const isDiff =
                        row.diffCol === col || row.diffCol === 'all';
                      const val = row[col];
                      const isMatch = val === '匹配';
                      const isNeutral = val === '—';
                      return (
                        <td
                          key={col}
                          className={
                            isDiff
                              ? styles['compare_cell--diff']
                              : isMatch
                              ? styles['compare_cell--match']
                              : isNeutral
                              ? styles['compare_cell--neutral']
                              : ''
                          }
                        >
                          {val}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>

            {showConfirmButton ? (
              <>
                <div className={styles.modal_form_group}>
                  <div className={styles.section_label}>差异说明（必填）</div>
                  <div
                    className={styles.radio_group_grid}
                    role="radiogroup"
                    aria-label="差异原因"
                  >
                    {DIFF_REASON_OPTIONS.map((opt) => (
                      <label
                        key={opt.value}
                        className={`${styles.radio_card} ${
                          selectedReason === opt.value
                            ? styles['radio_card--selected']
                            : ''
                        }`}
                        onClick={() => setSelectedReason(opt.value)}
                      >
                        <div className={styles.radio_circle} />
                        <div>
                          <div className={styles.radio_card__label}>{opt.label}</div>
                          <div className={styles.radio_card__desc}>{opt.desc}</div>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

                <div className={styles.modal_form_group}>
                  <label htmlFor="diffRemark" className={styles.modal_form_label}>
                    备注
                  </label>
                  <textarea
                    id="diffRemark"
                    className={styles.modal_textarea}
                    value={diffRemark}
                    onChange={(e) => setDiffRemark(e.target.value)}
                    placeholder="补充说明差异详情，如联系供应商结果、盘点记录编号等…"
                    rows={3}
                  />
                </div>
              </>
            ) : (
              <div className={styles.readonly_group}>
                <div className={styles.section_label}>确认记录</div>
                <div className={styles.readonly_meta}>
                  <span>确认人：{diffRecord.confirmedBy ?? '系统自动匹配'}</span>
                  <span>确认时间：{diffRecord.confirmedAt ? String(diffRecord.confirmedAt).replace('T', ' ').slice(0, 19) : '—'}</span>
                  <span>差异原因：{diffRecord.diffReason ?? '—'}</span>
                </div>
                {diffRecord.diffNotes ? (
                  <div className={styles.readonly_notes}>{diffRecord.diffNotes}</div>
                ) : null}
              </div>
            )}
          </>
        )}
      </Modal>
    </div>
  );
}
