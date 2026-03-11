/**
 * [artifact:前端代码] — 三单匹配页
 * 功能：执行匹配、差异高亮、价格预警、确认差异
 */

import { useEffect, useMemo, useState } from 'react';
import { useAppStore } from '@/stores/appStore';
import {
  useMatchList,
  useExecuteThreeWayMatch,
  useConfirmMatch,
} from '@/api/purchase';
import { MatchStatus, DiffReason, DiffReasonLabel, MatchStatusLabel } from '@/types/enums';
import type { ThreeWayMatch } from '@/types/models';
import type { Column } from '@/components/common/Table';
import Table from '@/components/common/Table';
import Modal from '@/components/common/Modal';
import Tag from '@/components/common/Tag';
import Button from '@/components/common/Button';
import SummaryStrip from '@/components/common/SummaryStrip';
import type { SummaryStripItem } from '@/components/common/SummaryStrip';
import { formatCNY, formatQtyStr, formatDateTime } from '@/utils/format';
import styles from './MatchPage.module.css';

type MatchRecord = ThreeWayMatch & Record<string, unknown>;

const MATCH_STATUS_VARIANT: Record<MatchStatus, 'success' | 'warning' | 'error' | 'info' | 'neutral'> = {
  [MatchStatus.MATCHED]:       'success',
  [MatchStatus.QTY_DIFF]:      'warning',
  [MatchStatus.PRICE_DIFF]:    'warning',
  [MatchStatus.PRICE_WARNING]: 'error',
  [MatchStatus.CONFIRMED]:     'info',
};

export default function MatchPage() {
  const { setPageTitle, showToast } = useAppStore();
  const [statusFilter, setStatusFilter] = useState<MatchStatus | ''>('');
  const [page, setPage] = useState(1);
  const [executeForm, setExecuteForm] = useState({ poId: '', deliveryNoteId: '', receiptId: '' });
  const [executeModal, setExecuteModal] = useState(false);
  const [confirmModal, setConfirmModal] = useState<{ open: boolean; matchId: number | null }>({ open: false, matchId: null });
  const [confirmForm, setConfirmForm] = useState({ diffReason: DiffReason.SUPPLIER_SHORT, diffNotes: '' });

  useEffect(() => { setPageTitle('三单匹配'); }, [setPageTitle]);

  const { data, isLoading, error } = useMatchList(statusFilter as MatchStatus || undefined, page, 20);
  const executeMutation = useExecuteThreeWayMatch();
  const confirmMutation = useConfirmMatch();

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
        showToast({ type: 'warning', message: `发现差异：${MatchStatusLabel[result.matchStatus]}，请确认` });
      }
    } catch (e) {
      showToast({ type: 'error', message: (e as Error).message });
    }
  };

  const handleConfirm = async () => {
    if (!confirmModal.matchId) return;
    try {
      await confirmMutation.mutateAsync({
        id: confirmModal.matchId,
        payload: { diffReason: confirmForm.diffReason, diffNotes: confirmForm.diffNotes },
      });
      showToast({ type: 'success', message: '差异已确认' });
      setConfirmModal({ open: false, matchId: null });
    } catch (e) {
      showToast({ type: 'error', message: (e as Error).message });
    }
  };

  const columns: Column<MatchRecord>[] = [
    {
      key: 'poNo',
      title: '采购订单号',
      render: (_, r) => {
        const m = r as unknown as ThreeWayMatch;
        return <span style={{ fontFamily: 'var(--font-family-mono)', fontSize: 13 }}>{m.poNo}</span>;
      },
    },
    {
      key: 'deliveryNo',
      title: '送货单号',
      render: (_, r) => <span style={{ fontFamily: 'var(--font-family-mono)', fontSize: 13 }}>{(r as unknown as ThreeWayMatch).deliveryNo}</span>,
    },
    {
      key: 'receiptNo',
      title: '入库单号',
      render: (_, r) => <span style={{ fontFamily: 'var(--font-family-mono)', fontSize: 13 }}>{(r as unknown as ThreeWayMatch).receiptNo}</span>,
    },
    {
      key: 'matchStatus',
      title: '匹配状态',
      width: 120,
      render: (_, r) => {
        const m = r as unknown as ThreeWayMatch;
        return (
          <Tag variant={MATCH_STATUS_VARIANT[m.matchStatus]}>
            {MatchStatusLabel[m.matchStatus]}
          </Tag>
        );
      },
    },
    {
      key: 'createdAt',
      title: '匹配时间',
      render: (_, r) => formatDateTime((r as unknown as ThreeWayMatch).createdAt),
    },
    {
      key: 'actions',
      title: '操作',
      width: 100,
      render: (_, r) => {
        const m = r as unknown as ThreeWayMatch;
        const needsConfirm = [MatchStatus.QTY_DIFF, MatchStatus.PRICE_DIFF, MatchStatus.PRICE_WARNING].includes(m.matchStatus);
        if (!needsConfirm) return null;
        return (
          <Button
            variant="warning"
            size="sm"
            onClick={() => setConfirmModal({ open: true, matchId: m.matchId })}
          >
            确认差异
          </Button>
        );
      },
    },
  ];

  // 展开行：差异明细
  const expandedRowRender = (record: MatchRecord): React.ReactNode => {
    const m = record as unknown as ThreeWayMatch;
    if (!m.diffItems?.length) return null;
    return (
      <div className={styles.diff_expand}>
        <h4 className={styles.diff_title}>差异明细</h4>
        <table className={styles.diff_table}>
          <thead>
            <tr>
              <th>物料</th>
              <th>PO数量</th>
              <th>送货数量</th>
              <th>入库数量</th>
              <th>数量差异</th>
              <th>价格差异</th>
              <th>价格预警</th>
            </tr>
          </thead>
          <tbody>
            {m.diffItems.map((item) => (
              <tr key={item.skuId}>
                <td>{item.skuName}</td>
                <td>{formatQtyStr(item.poQty)} {item.poUnit}</td>
                <td>{formatQtyStr(item.dnQty)}</td>
                <td>{formatQtyStr(item.receiptQty)}</td>
                <td style={{ color: parseFloat(item.qtyDiff) !== 0 ? 'var(--color-error-600)' : 'inherit', fontWeight: 600 }}>
                  {parseFloat(item.qtyDiff) > 0 ? '+' : ''}{formatQtyStr(item.qtyDiff)}
                </td>
                <td style={{ color: parseFloat(item.priceDiff) !== 0 ? 'var(--color-warning-700)' : 'inherit' }}>
                  {parseFloat(item.priceDiff) > 0 ? '+' : ''}{formatCNY(item.priceDiff)}
                </td>
                <td>
                  {item.isPriceAnomaly
                    ? <Tag variant="error">超均价20%</Tag>
                    : <Tag variant="neutral">正常</Tag>
                  }
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {m.diffReason && (
          <p className={styles.diff_note}>
            差异原因：{DiffReasonLabel[m.diffReason as DiffReason] ?? m.diffReason}
            {m.diffNotes && ` — ${m.diffNotes}`}
          </p>
        )}
      </div>
    );
  };

  return (
    <div className={styles.page}>
      <div className="page-header">
        <h1 className="page-header__title">🔗 三单匹配</h1>
        <div className="page-header__actions">
          <Button variant="primary" size="md" onClick={() => setExecuteModal(true)}>
            执行三单匹配
          </Button>
        </div>
      </div>

      {/* 状态 Tabs */}
      <div className={styles.tabs} role="tablist">
        {([
          ['', '全部'],
          [MatchStatus.MATCHED,       '完全匹配'],
          [MatchStatus.QTY_DIFF,      '数量差异'],
          [MatchStatus.PRICE_WARNING, '价格预警'],
          [MatchStatus.CONFIRMED,     '已确认'],
        ] as const).map(([val, label]) => (
          <button
            key={val}
            role="tab"
            aria-selected={statusFilter === val}
            className={`${styles.tab} ${statusFilter === val ? styles['tab--active'] : ''}`}
            onClick={() => { setStatusFilter(val as MatchStatus | ''); setPage(1); }}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <Table<MatchRecord>
          columns={columns}
          dataSource={(data?.list ?? []) as MatchRecord[]}
          rowKey="matchId"
          loading={isLoading}
          error={error ? (error as Error).message : null}
          emptyText="暂无匹配记录"
          expandedRowRender={expandedRowRender}
          pagination={data ? { page, pageSize: 20, total: data.total, onChange: setPage } : undefined}
        />
      </div>

      {/* 执行匹配弹窗 */}
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
          {(['poId', 'deliveryNoteId', 'receiptId'] as const).map((field) => (
            <div key={field} className={styles.exec_field}>
              <label htmlFor={field} className={styles.exec_label}>
                {field === 'poId' ? '采购订单 ID' : field === 'deliveryNoteId' ? '送货单 ID' : '入库单 ID'}
              </label>
              <input
                id={field}
                type="number"
                className={styles.exec_input}
                value={executeForm[field]}
                onChange={(e) => setExecuteForm((f) => ({ ...f, [field]: e.target.value }))}
                placeholder="请输入 ID"
                min="1"
              />
            </div>
          ))}
        </div>
      </Modal>

      {/* 确认差异弹窗 */}
      <Modal
        open={confirmModal.open}
        title="确认差异原因"
        onClose={() => setConfirmModal({ open: false, matchId: null })}
        onConfirm={() => void handleConfirm()}
        confirmLabel="确认提交"
        confirmLoading={confirmMutation.isPending}
        size="sm"
      >
        <div className={styles.exec_form}>
          <div className={styles.exec_field}>
            <label htmlFor="diffReason" className={styles.exec_label}>差异原因</label>
            <select
              id="diffReason"
              className={styles.exec_input}
              value={confirmForm.diffReason}
              onChange={(e) => setConfirmForm((f) => ({ ...f, diffReason: e.target.value as DiffReason }))}
            >
              {Object.entries(DiffReasonLabel).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          <div className={styles.exec_field}>
            <label htmlFor="diffNotes" className={styles.exec_label}>备注说明</label>
            <textarea
              id="diffNotes"
              className={styles.exec_textarea}
              rows={3}
              value={confirmForm.diffNotes}
              onChange={(e) => setConfirmForm((f) => ({ ...f, diffNotes: e.target.value }))}
              placeholder="可选，补充说明..."
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}
