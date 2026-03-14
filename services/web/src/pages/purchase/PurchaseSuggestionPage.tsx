/**
 * [artifact:前端代码] — 采购建议管理页面 (R-11)
 */
import { useState, useCallback, useMemo } from 'react';
import { usePurchaseSuggestionList, useApprovePurchaseSuggestion, useRejectPurchaseSuggestion, useBatchToPo } from '@/api/purchaseSuggestion';
import Modal from '@/components/common/Modal';
import Button from '@/components/common/Button';
import Table from '@/components/common/Table';
import type { Column } from '@/components/common/Table';
import styles from './PurchaseSuggestionPage.module.css';

interface SuggestionRow {
  id: number;
  suggestion_no: string;
  source: 'production_shortage' | 'ai_schedule' | 'manual';
  sku_code: string;
  skuName: string;
  supplierName: string | null;
  suggested_qty: string;
  estimated_price: string | null;
  estimated_amount: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'executed' | 'expired';
  work_order_no?: string;
  [key: string]: unknown;
}

const SOURCE_MAP: Record<string, { label: string; cls: string }> = {
  production_shortage: { label: '生产缺料', cls: styles.sourceProduction },
  ai_schedule: { label: 'AI调度', cls: styles.sourceAi },
  manual: { label: '手动', cls: styles.sourceManual },
};

const STATUS_MAP: Record<string, { label: string; cls: string }> = {
  pending: { label: '待审批', cls: styles.statusPending },
  approved: { label: '已通过', cls: styles.statusApproved },
  rejected: { label: '已驳回', cls: styles.statusRejected },
  executed: { label: '已转单', cls: styles.statusExecuted },
  expired: { label: '已过期', cls: styles.statusPending },
};

export default function PurchaseSuggestionPage() {
  const [sourceFilter, setSourceFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectId, setRejectId] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const { data, isLoading } = usePurchaseSuggestionList({
    source: (sourceFilter || undefined) as any,
    status: (statusFilter || undefined) as any,
    page,
    pageSize: 20,
  });
  const approve = useApprovePurchaseSuggestion();
  const reject = useRejectPurchaseSuggestion();
  const batchToPO = useBatchToPo();

  const list = (data as any)?.list ?? [];
  const total = (data as any)?.total ?? 0;

  const toggleSelect = useCallback((id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const handleReject = useCallback(async () => {
    if (!rejectId || !rejectReason.trim()) return;
    await reject.mutateAsync({ id: rejectId, data: { reason: rejectReason } });
    setShowRejectModal(false);
    setRejectId(null);
    setRejectReason('');
  }, [rejectId, rejectReason, reject]);

  const handleBatchToPO = useCallback(async () => {
    if (selectedIds.size === 0) return;
    await batchToPO.mutateAsync({ suggestionIds: Array.from(selectedIds) });
    setSelectedIds(new Set());
  }, [selectedIds, batchToPO]);

  const columns: Column<SuggestionRow>[] = useMemo(() => [
    {
      key: 'id', title: '', width: 40,
      render: (_, r) => (
        <input
          type="checkbox"
          checked={selectedIds.has(r.id)}
          onChange={() => toggleSelect(r.id)}
          disabled={r.status !== 'approved'}
        />
      ),
    },
    { key: 'suggestion_no', title: '建议编号', width: 140 },
    {
      key: 'source', title: '来源', width: 90,
      render: (v) => {
        const s = SOURCE_MAP[v as string] ?? SOURCE_MAP.manual;
        return <span className={`${styles.badge} ${s.cls}`}>{s.label}</span>;
      },
    },
    { key: 'sku_code', title: 'SKU', width: 100 },
    { key: 'skuName', title: '名称', width: 150 },
    { key: 'supplierName', title: '推荐供应商', width: 130, render: (v) => String(v ?? '-') },
    { key: 'suggested_qty', title: '建议数量', width: 90, align: 'right' },
    { key: 'estimated_price', title: '单价', width: 80, align: 'right', render: (v) => String(v ?? '-') },
    { key: 'estimated_amount', title: '金额', width: 90, align: 'right', render: (v) => String(v ?? '-') },
    {
      key: 'status', title: '状态', width: 80,
      render: (v) => {
        const s = STATUS_MAP[v as string] ?? STATUS_MAP.pending;
        return <span className={`${styles.badge} ${s.cls}`}>{s.label}</span>;
      },
    },
    {
      key: 'id', title: '操作', width: 140,
      render: (_, r) => (
        <div style={{ display: 'flex', gap: 4 }}>
          {r.status === 'pending' && (
            <>
              <Button size="sm" onClick={() => approve.mutate({ id: r.id })}>通过</Button>
              <Button size="sm" variant="text" onClick={() => { setRejectId(r.id); setShowRejectModal(true); }}>驳回</Button>
            </>
          )}
        </div>
      ),
    },
  ], [selectedIds, toggleSelect, approve]);

  return (
    <div className={styles.container}>
      <div className={styles.actions}>
        <Button
          onClick={handleBatchToPO}
          loading={batchToPO.isPending}
          disabled={selectedIds.size === 0}
        >
          批量转采购订单
        </Button>
        {selectedIds.size > 0 && (
          <span className={styles.selectedCount}>已选 {selectedIds.size} 条</span>
        )}
      </div>

      <div className={styles.filterRow}>
        <select value={sourceFilter} onChange={(e) => { setSourceFilter(e.target.value); setPage(1); }}>
          <option value="">全部来源</option>
          <option value="production_shortage">生产缺料</option>
          <option value="ai_schedule">AI调度</option>
          <option value="manual">手动</option>
        </select>
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}>
          <option value="">全部状态</option>
          <option value="pending">待审批</option>
          <option value="approved">已通过</option>
          <option value="rejected">已驳回</option>
          <option value="executed">已转单</option>
        </select>
      </div>

      <Table<SuggestionRow>
        columns={columns}
        dataSource={list}
        loading={isLoading}
        pagination={{ page, pageSize: 20, total, onChange: setPage }}
        rowKey="id"
      />

      {/* 驳回原因 Modal */}
      <Modal
        open={showRejectModal}
        onClose={() => { setShowRejectModal(false); setRejectReason(''); }}
        title="驳回采购建议"
        onConfirm={handleReject}
        confirmLoading={reject.isPending}
        confirmVariant="danger"
      >
        <div style={{ padding: '1rem 0' }}>
          <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem' }}>驳回原因（必填）</label>
          <textarea
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            rows={3}
            style={{ width: '100%', border: '1px solid #d1d5db', borderRadius: 6, padding: '0.5rem 0.75rem', resize: 'vertical' }}
            placeholder="请填写驳回原因..."
          />
        </div>
      </Modal>
    </div>
  );
}
