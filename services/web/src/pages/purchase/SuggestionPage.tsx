/**
 * [artifact:前端代码] — AI 采购建议页
 * 功能：生成建议、置信度标签、审批、缸号提示
 * T109 AiStatusPanel / T110 InfoGrid缺口量 / T111 ReasonAccordion动画
 * T113 已转单Tab / T114 卡片hover动效
 */

import { useEffect, useState } from 'react';
import { useAppStore } from '@/stores/appStore';
import {
  useSuggestionList,
  useGenerateSuggestions,
  useApproveSuggestion,
} from '@/api/purchase';
import { SuggestionStatus } from '@/types/enums';
import type { PurchaseSuggestion } from '@/types/models';
import ConfidenceTag from '@/components/common/ConfidenceTag';
import StatusBadge from '@/components/common/StatusBadge';
import Tag from '@/components/common/Tag';
import Button from '@/components/common/Button';
import Modal from '@/components/common/Modal';
import EmptyState from '@/components/common/EmptyState';
import { formatCNY, formatQtyStr } from '@/utils/format';
import styles from './SuggestionPage.module.css';

export default function SuggestionPage() {
  const { setPageTitle, showToast } = useAppStore();
  const [statusFilter, setStatusFilter] = useState<SuggestionStatus | ''>('');
  const [page, setPage] = useState(1);
  const [rejectModal, setRejectModal] = useState<{ open: boolean; id: number | null }>({ open: false, id: null });
  const [rejectReason, setRejectReason] = useState('');
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

  useEffect(() => { setPageTitle('AI 采购建议'); }, [setPageTitle]);

  const { data, isLoading, error } = useSuggestionList(
    statusFilter as SuggestionStatus || undefined, page, 20,
  );
  const generateMutation = useGenerateSuggestions();
  const approveMutation  = useApproveSuggestion();

  const handleGenerate = async () => {
    try {
      await generateMutation.mutateAsync(undefined);
      showToast({ type: 'success', message: '采购建议已生成' });
    } catch (e) {
      showToast({ type: 'error', message: (e as Error).message });
    }
  };

  const handleApprove = async (id: number) => {
    try {
      await approveMutation.mutateAsync({ id, payload: { approved: true } });
      showToast({ type: 'success', message: '已批准采购建议' });
    } catch (e) {
      showToast({ type: 'error', message: (e as Error).message });
    }
  };

  const handleReject = async () => {
    if (!rejectModal.id || !rejectReason.trim()) return;
    try {
      await approveMutation.mutateAsync({
        id: rejectModal.id,
        payload: { approved: false, rejectReason: rejectReason.trim() },
      });
      showToast({ type: 'info', message: '已驳回采购建议' });
      setRejectModal({ open: false, id: null });
      setRejectReason('');
    } catch (e) {
      showToast({ type: 'error', message: (e as Error).message });
    }
  };

  const toggleExpand = (id: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const suggestions: PurchaseSuggestion[] = data?.list ?? [];

  return (
    <div className={styles.page}>
      {/* 页面头 */}
      <div className="page-header">
        <h1 className="page-header__title">🤖 AI 采购建议</h1>
        <div className="page-header__actions">
          <Button
            variant="ai"
            size="md"
            loading={generateMutation.isPending}
            onClick={() => void handleGenerate()}
            icon="✨"
          >
            生成采购建议
          </Button>
        </div>
      </div>

      {/* T109 AI 状态面板 */}
      <div className={styles.ai_status} role="status" aria-label="AI 分析状态">
        <span className={styles.ai_status__dot} aria-hidden="true" />
        <span className={styles.ai_status__text}>
          AI 已分析 · 覆盖 {data?.list?.length ?? 0} 个 SKU
        </span>
        {data?.list && data.list.length > 0 && (
          <span className={styles.ai_status__meta}>
            最近更新：{new Date(data.list[0]?.createdAt ?? '').toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
      </div>

      {/* 状态筛选 Tabs */}
      <div className={styles.tabs} role="tablist" aria-label="筛选状态">
        {([
          ['', '全部'],
          [SuggestionStatus.PENDING, '待审批'],
          [SuggestionStatus.APPROVED, '已批准'],
          [SuggestionStatus.REJECTED, '已驳回'],
          [SuggestionStatus.CONVERTED, '已转单'],
        ] as const).map(([val, label]) => (
          <button
            key={val}
            role="tab"
            aria-selected={statusFilter === val}
            className={`${styles.tab} ${statusFilter === val ? styles['tab--active'] : ''}`}
            onClick={() => { setStatusFilter(val as SuggestionStatus | ''); setPage(1); }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* 内容区 */}
      {isLoading ? (
        <div className={styles.loading_grid}>
          {[1,2,3].map(i => <div key={i} className={`card skeleton ${styles.card_skeleton}`} />)}
        </div>
      ) : error ? (
        <div className="alert alert--error">
          <span className="alert__icon">❌</span>
          <div className="alert__body"><div className="alert__desc">{(error as Error).message}</div></div>
        </div>
      ) : suggestions.length === 0 ? (
        <EmptyState
          icon="🤖"
          title="暂无采购建议"
          description={statusFilter === SuggestionStatus.PENDING ? '当前没有待审批的采购建议' : '点击"生成采购建议"让 AI 分析库存缺口'}
          actionLabel={statusFilter === '' ? '立即生成' : undefined}
          onAction={statusFilter === '' ? () => void handleGenerate() : undefined}
        />
      ) : (
        <div className={styles.card_grid}>
          {suggestions.map((s) => {
            const expanded = expandedIds.has(s.id);
            const isPending = s.status === SuggestionStatus.PENDING;
            return (
              <article key={s.id} className={`card ${styles.suggestion_card}`} aria-label={`采购建议：${s.skuName}`}>
                {/* 顶部：置信度 + 状态 */}
                <div className={styles.card_header}>
                  <ConfidenceTag confidence={s.confidence} detail={s.confidenceDetail} />
                  <StatusBadge status={s.status} />
                </div>

                {/* 物料名 + AI 橙线 */}
                <h3 className={styles.card_sku}>{s.skuName}</h3>
                <p className={styles.card_code}>{s.skuCode}</p>

                {/* 缸号提示 */}
                {s.dyeLotRequirement && (
                  <div className="alert alert--ai" style={{ marginBottom: 'var(--space-3)' }}>
                    <span className="alert__icon" aria-hidden="true">🧵</span>
                    <div className="alert__body">
                      <div className="alert__title">缸号要求</div>
                      <div className="alert__desc">{s.dyeLotRequirement}</div>
                    </div>
                  </div>
                )}

                {/* 建议数量 + 金额 */}
                <div className={styles.card_amounts}>
                  <div className={styles.card_amount_item}>
                    <div className={styles.card_amount_label}>建议数量</div>
                    <div className={styles.card_amount_value}>
                      {formatQtyStr(s.suggestedQty)} <span className={styles.card_amount_unit}>{s.purchaseUnit}</span>
                    </div>
                  </div>
                  <div className={styles.card_amount_item}>
                    <div className={styles.card_amount_label}>预估金额</div>
                    <div className={styles.card_amount_value}>{formatCNY(s.estimatedAmount)}</div>
                  </div>
                  <div className={styles.card_amount_item}>
                    <div className={styles.card_amount_label}>供应商</div>
                    <div className={styles.card_amount_value}>{s.supplierName}</div>
                  </div>
                </div>

                {/* AI 推理（折叠） */}
                <button
                  className={styles.card_reason_toggle}
                  onClick={() => toggleExpand(s.id)}
                  aria-expanded={expanded}
                >
                  <span>AI 推理依据</span>
                  <span aria-hidden="true">{expanded ? '▾' : '▸'}</span>
                </button>
                {expanded && (
                  <p className={styles.card_reason_body}>{s.reason}</p>
                )}

                {/* 操作按钮 */}
                {isPending && (
                  <div className={styles.card_actions}>
                    <Button
                      variant="success"
                      size="sm"
                      loading={approveMutation.isPending}
                      onClick={() => void handleApprove(s.id)}
                    >
                      批准
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => setRejectModal({ open: true, id: s.id })}
                    >
                      驳回
                    </Button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      {/* 分页 */}
      {data && data.totalPages > 1 && (
        <div className={styles.pagination}>
          <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>上一页</Button>
          <span style={{ fontSize: 'var(--text-body-s)', color: 'var(--text-secondary)' }}>
            {page} / {data.totalPages}
          </span>
          <Button variant="ghost" size="sm" disabled={page >= data.totalPages} onClick={() => setPage(p => p + 1)}>下一页</Button>
        </div>
      )}

      {/* 驳回原因弹窗 */}
      <Modal
        open={rejectModal.open}
        title="驳回采购建议"
        onClose={() => setRejectModal({ open: false, id: null })}
        onConfirm={() => void handleReject()}
        confirmLabel="确认驳回"
        confirmVariant="danger"
        confirmLoading={approveMutation.isPending}
        size="sm"
      >
        <div className={styles.reject_form}>
          <label htmlFor="reject-reason" className={styles.reject_label}>
            驳回原因 <span style={{ color: 'var(--color-error-500)' }}>*</span>
          </label>
          <textarea
            id="reject-reason"
            className={styles.reject_textarea}
            rows={4}
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="请说明驳回原因..."
          />
        </div>
      </Modal>
    </div>
  );
}
