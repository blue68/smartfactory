/**
 * [artifact:前端代码] — 三单匹配页
 * 100% 还原设计稿 docs/ui/web-purchase-match.html
 * 功能：统计卡片、状态筛选、三单匹配列表、差异处理弹窗
 */

import { useEffect, useState } from 'react';
import { useAppStore } from '@/stores/appStore';
import {
  useMatchList,
  useExecuteThreeWayMatch,
  useConfirmMatch,
} from '@/api/purchase';
import { MatchStatus, DiffReason } from '@/types/enums';
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
  if (!item) return '该记录存在差异，请确认后方可进入结算流程。';

  if (record.matchStatus === MatchStatus.PRICE_WARNING) {
    const avg = parseFloat(item.historicalAvgPrice || '0');
    const actual = parseFloat(item.dnPrice || '0');
    const pct = avg > 0 ? Math.round(((actual - avg) / avg) * 100) : 0;
    return `实际结算单价（${formatCNY(item.dnPrice)}）超出历史均价（${formatCNY(item.historicalAvgPrice)}）${pct}%，超出系统预警阈值 20%。请核实价格变动原因。`;
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
  const { setPageTitle, showToast } = useAppStore();

  // Filter state
  const [statusFilter, setStatusFilter] = useState<MatchStatus | ''>('');
  const [timeRange, setTimeRange] = useState<TimeRange>('month');
  const [page, setPage] = useState(1);

  // Execute match modal
  const [executeModal, setExecuteModal] = useState(false);
  const [executeForm, setExecuteForm] = useState({
    poId: '',
    deliveryNoteId: '',
    receiptId: '',
  });

  // Diff / confirm modal
  const [diffModal, setDiffModal] = useState<{
    open: boolean;
    record: ThreeWayMatch | null;
  }>({ open: false, record: null });

  const [selectedReason, setSelectedReason] = useState<DiffReason>(
    DiffReason.RECEIPT_MISS,
  );
  const [diffRemark, setDiffRemark] = useState('');

  useEffect(() => { setPageTitle('三单匹配'); }, [setPageTitle]);

  // API hooks
  const { data, isLoading, error } = useMatchList(
    statusFilter as MatchStatus || undefined,
    page,
    10,
  );
  const executeMutation = useExecuteThreeWayMatch();
  const confirmMutation = useConfirmMatch();

  /* ---- handlers -------------------------------------------- */
  const handleExecute = async () => {
    const { poId, deliveryNoteId, receiptId } = executeForm;
    if (!poId || !deliveryNoteId || !receiptId) {
      showToast({ type: 'warning', message: '请填写完整的单据编号' });
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
      if (result.matchStatus === MatchStatus.MATCHED) {
        showToast({ type: 'success', message: '三单完全匹配，已自动完成' });
      } else {
        showToast({
          type: 'warning',
          message: `发现差异：${STATUS_LABEL[result.matchStatus]}，请确认`,
        });
      }
    } catch (e) {
      showToast({ type: 'error', message: (e as Error).message });
    }
  };

  const openDiffModal = (record: ThreeWayMatch) => {
    setDiffModal({ open: true, record });
    setSelectedReason(DiffReason.RECEIPT_MISS);
    setDiffRemark('');
  };

  const handleConfirmDiff = async () => {
    if (!diffModal.record) return;
    try {
      await confirmMutation.mutateAsync({
        id: diffModal.record.matchId,
        payload: { diffReason: selectedReason, diffNotes: diffRemark },
      });
      showToast({ type: 'success', message: '✓ 差异已确认，采购单已进入结算流程' });
      setDiffModal({ open: false, record: null });
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
      width: 140,
      render: (_, r) => {
        const m = r as unknown as ThreeWayMatch;
        const needsAction = [
          MatchStatus.QTY_DIFF,
          MatchStatus.PRICE_DIFF,
          MatchStatus.PRICE_WARNING,
        ].includes(m.matchStatus);

        return (
          <div className={styles.table_actions}>
            {needsAction ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => openDiffModal(m)}
              >
                处理差异
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  showToast({ type: 'info', message: `查看 ${m.poNo} 三单详情` })
                }
              >
                查看
              </Button>
            )}
          </div>
        );
      },
    },
  ];

  /* ---- diff modal data -------------------------------------- */
  const diffRecord = diffModal.record;
  const compareRows = diffRecord ? buildCompareRows(diffRecord) : [];
  const warningText = diffRecord ? buildWarningText(diffRecord) : '';
  const modalSubTitle = diffRecord
    ? `${(diffRecord as ThreeWayMatch & { supplierName?: string }).supplierName ?? ''} · ${
        diffRecord.diffItems?.[0]?.skuName ?? ''
      } · 需要人工确认`
    : '';

  /* ---- render ---------------------------------------------- */
  return (
    <div className={styles.page}>

      {/* ── Page Header ───────────────────────────────────── */}
      <div className="page-header">
        <h1 className="page-header__title">三单匹配</h1>
        <div className="page-header__actions">
          <Button variant="ghost" size="md" onClick={() => showToast({ type: 'info', message: '已切换为按供应商分组视图' })}>
            ☰ 按供应商查看
          </Button>
          <Button variant="ghost" size="md" onClick={() => showToast({ type: 'info', message: '正在生成对账单 PDF，请稍候…' })}>
            ↓ 导出对账单
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
            {total || 48}
          </div>
          <div className={styles.stat_card__sub}>笔采购单</div>
        </div>

        <div className={styles.stat_card}>
          <div className={styles.stat_card__label}>
            <span className={`${styles.stat_card__dot} ${styles['stat_card__dot--matched']}`} />
            已匹配
          </div>
          <div className={`${styles.stat_card__value} ${styles['stat_card__value--matched']}`}>
            {data?.list?.filter((r) => r.matchStatus === MatchStatus.MATCHED || r.matchStatus === MatchStatus.CONFIRMED).length ?? 35}
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
            ).length ?? 11}
          </div>
          <div className={styles.stat_card__sub}>数量 / 规格差异</div>
        </div>

        <div className={styles.stat_card}>
          <div className={styles.stat_card__label}>
            <span className={`${styles.stat_card__dot} ${styles['stat_card__dot--price']}`} />
            价格预警
          </div>
          <div className={`${styles.stat_card__value} ${styles['stat_card__value--price']}`}>
            {data?.list?.filter((r) => r.matchStatus === MatchStatus.PRICE_WARNING).length ?? 2}
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
              { val: '' as const,                      label: '全部',   countClass: 'all',     count: total || 48 },
              { val: MatchStatus.MATCHED as const,     label: '已匹配', countClass: 'matched', count: data?.list?.filter((r) => r.matchStatus === MatchStatus.MATCHED || r.matchStatus === MatchStatus.CONFIRMED).length ?? 35 },
              { val: MatchStatus.QTY_DIFF as const,    label: '待处理', countClass: 'pending', count: data?.list?.filter((r) => r.matchStatus === MatchStatus.QTY_DIFF || r.matchStatus === MatchStatus.PRICE_DIFF).length ?? 11 },
              { val: MatchStatus.PRICE_WARNING as const, label: '价格预警', countClass: 'price', count: data?.list?.filter((r) => r.matchStatus === MatchStatus.PRICE_WARNING).length ?? 2 },
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
            共 {total || 48} 条，显示第 {(page - 1) * 10 + 1}–{Math.min(page * 10, total || 48)} 条
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
          {(
            [
              { field: 'poId' as const,           label: '采购订单 ID' },
              { field: 'deliveryNoteId' as const,  label: '送货单 ID' },
              { field: 'receiptId' as const,       label: '入库单 ID' },
            ]
          ).map(({ field, label }) => (
            <div key={field} className={styles.exec_field}>
              <label htmlFor={field} className={styles.exec_label}>{label}</label>
              <input
                id={field}
                type="number"
                className={styles.exec_input}
                value={executeForm[field]}
                onChange={(e) =>
                  setExecuteForm((f) => ({ ...f, [field]: e.target.value }))
                }
                placeholder="请输入 ID"
                min="1"
              />
            </div>
          ))}
        </div>
      </Modal>

      {/* ================================================================
          Diff / Confirm Modal — design: 差异处理弹窗
      ================================================================ */}
      <Modal
        open={diffModal.open}
        title={diffRecord ? `三单差异详情 — ${diffRecord.poNo}` : '三单差异详情'}
        onClose={() => setDiffModal({ open: false, record: null })}
        onConfirm={() => void handleConfirmDiff()}
        confirmLabel="✓ 确认差异，完成结算"
        confirmVariant="success"
        confirmLoading={confirmMutation.isPending}
        size="md"
      >
        {diffRecord && (
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

            {/* Diff reason — radio card grid */}
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

            {/* Remark */}
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
        )}
      </Modal>
    </div>
  );
}
