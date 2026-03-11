/**
 * [artifact:前端代码] — 销售订单页
 * 功能：订单列表、约束引擎结果展示、紧急插单分析、审批
 */

import { useEffect, useState } from 'react';
import { useAppStore } from '@/stores/appStore';
import {
  useSalesOrderList,
  useSalesOrderDetail,
  useCreateSalesOrder,
  useApproveOrder,
  useUrgentAnalysis,
} from '@/api/sales';
import {
  SalesOrderStatus, SalesOrderStatusLabel,
  ConstraintResult, ApprovalAction, OrderType,
} from '@/types/enums';
import type { SalesOrder, UrgentAnalysisResult } from '@/types/models';
import type { Column } from '@/components/common/Table';
import Table from '@/components/common/Table';
import StatusBadge from '@/components/common/StatusBadge';
import Tag from '@/components/common/Tag';
import Button from '@/components/common/Button';
import Modal from '@/components/common/Modal';
import Drawer from '@/components/common/Drawer';
import AiThinkingState from '@/components/ai/AiThinkingState';
import { formatCNY, formatDate, formatDateTime } from '@/utils/format';
import styles from './OrderPage.module.css';

type OrderRecord = SalesOrder & Record<string, unknown>;

const CONSTRAINT_TAG: Record<ConstraintResult, { label: string; variant: 'success' | 'warning' | 'error' }> = {
  [ConstraintResult.PASS]:  { label: '通过', variant: 'success' },
  [ConstraintResult.WARN]:  { label: '警告', variant: 'warning' },
  [ConstraintResult.BLOCK]: { label: '被拦截', variant: 'error' },
};

function ConstraintResultDisplay({ result }: { result: ConstraintResult }) {
  const t = CONSTRAINT_TAG[result];
  return <Tag variant={t.variant}>{t.label}</Tag>;
}

function UrgentAnalysisReport({ data }: { data: UrgentAnalysisResult }) {
  const checks = [
    { label: '库存周转天数', ...data.inventoryTurnoverCheck },
    { label: '资金占用',     ...data.capitalOccupationCheck },
    { label: '生产成本',     ...data.productionCostCheck },
    { label: '产能负荷',     ...data.capacityLoadCheck },
  ];

  return (
    <div className={styles.analysis_report}>
      <div className={`${styles.analysis_overall} ${data.overallResult === ConstraintResult.BLOCK ? styles['analysis_overall--block'] : data.overallResult === ConstraintResult.WARN ? styles['analysis_overall--warn'] : styles['analysis_overall--pass']}`}>
        <strong>综合评估：</strong>
        {data.overallResult === ConstraintResult.PASS ? '✅ 可以接单' : data.overallResult === ConstraintResult.WARN ? '⚠️ 谨慎接单' : '🚫 建议拒绝'}
      </div>

      <div className={styles.analysis_checks}>
        {checks.map((c) => (
          <div key={c.label} className={`${styles.check_item} ${c.passed ? styles['check_item--pass'] : styles['check_item--fail']}`}>
            <span className={styles.check_icon} aria-hidden="true">{c.passed ? '✓' : '✗'}</span>
            <div>
              <div className={styles.check_label}>{c.label}</div>
              <div className={styles.check_detail}>{c.detail}</div>
            </div>
          </div>
        ))}
      </div>

      {data.blockedReasons.length > 0 && (
        <div className="alert alert--error">
          <span className="alert__icon" aria-hidden="true">🚫</span>
          <div className="alert__body">
            <div className="alert__title">拦截原因</div>
            <ul style={{ paddingLeft: 'var(--space-4)', marginTop: 'var(--space-2)' }}>
              {data.blockedReasons.map((r, i) => <li key={i} className="alert__desc">{r}</li>)}
            </ul>
          </div>
        </div>
      )}

      {data.impactAnalysis.affectedOrders.length > 0 && (
        <div className="alert alert--warning">
          <span className="alert__icon" aria-hidden="true">⚠️</span>
          <div className="alert__body">
            <div className="alert__title">影响分析</div>
            <div className="alert__desc">
              将导致 {data.impactAnalysis.affectedOrders.length} 个订单延期，
              额外占用资金 {formatCNY(data.impactAnalysis.additionalCapital)}，
              库存周转变化 {data.impactAnalysis.turnoverDaysChange} 天。
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function OrderPage() {
  const { setPageTitle, showToast } = useAppStore();
  const [statusFilter, setStatusFilter] = useState<SalesOrderStatus | ''>('');
  const [page, setPage] = useState(1);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [approveModal, setApproveModal] = useState<{ open: boolean; id: number | null; action: ApprovalAction }>({ open: false, id: null, action: ApprovalAction.APPROVED });
  const [approveNotes, setApproveNotes] = useState('');
  const [urgentDrawer, setUrgentDrawer] = useState(false);
  const [urgentResult, setUrgentResult] = useState<UrgentAnalysisResult | null>(null);

  useEffect(() => { setPageTitle('销售订单'); }, [setPageTitle]);

  const { data, isLoading, error } = useSalesOrderList({ status: statusFilter as SalesOrderStatus || undefined }, page, 20);
  const { data: detail } = useSalesOrderDetail(detailId);
  const approveMutation = useApproveOrder();
  const urgentMutation  = useUrgentAnalysis();

  const handleApprove = async () => {
    if (!approveModal.id) return;
    try {
      await approveMutation.mutateAsync({ id: approveModal.id, action: approveModal.action, notes: approveNotes });
      showToast({ type: 'success', message: '审批操作完成' });
      setApproveModal({ open: false, id: null, action: ApprovalAction.APPROVED });
      setApproveNotes('');
    } catch (e) {
      showToast({ type: 'error', message: (e as Error).message });
    }
  };

  const columns: Column<OrderRecord>[] = [
    {
      key: 'orderNo',
      title: '订单号',
      render: (_, r) => <span style={{ fontFamily: 'var(--font-family-mono)', fontSize: 13 }}>{(r as SalesOrder).orderNo}</span>,
    },
    { key: 'customerName', title: '客户', render: (_, r) => (r as SalesOrder).customerName },
    {
      key: 'orderType',
      title: '类型',
      width: 80,
      render: (_, r) => {
        const o = r as SalesOrder;
        return o.orderType === OrderType.URGENT
          ? <Tag variant="priority-urgent">紧急</Tag>
          : <Tag variant="priority-normal">普通</Tag>;
      },
    },
    {
      key: 'status',
      title: '状态',
      width: 110,
      render: (_, r) => <StatusBadge status={(r as SalesOrder).status} />,
    },
    {
      key: 'constraintResult',
      title: '约束检查',
      width: 90,
      render: (_, r) => <ConstraintResultDisplay result={(r as SalesOrder).constraintResult} />,
    },
    {
      key: 'totalAmount',
      title: '金额',
      align: 'right',
      render: (_, r) => <span style={{ fontFamily: 'var(--font-family-number)' }}>{formatCNY((r as SalesOrder).totalAmount)}</span>,
    },
    {
      key: 'expectedDelivery',
      title: '交期',
      render: (_, r) => formatDate((r as SalesOrder).expectedDelivery),
    },
    {
      key: 'actions',
      title: '操作',
      width: 160,
      render: (_, r) => {
        const o = r as SalesOrder;
        return (
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <Button variant="text" size="sm" onClick={() => setDetailId(o.id)}>详情</Button>
            {o.status === SalesOrderStatus.PENDING_APPROVAL && (
              <>
                <Button
                  variant="success"
                  size="sm"
                  onClick={() => setApproveModal({ open: true, id: o.id, action: ApprovalAction.APPROVED })}
                >
                  批准
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => setApproveModal({ open: true, id: o.id, action: ApprovalAction.REJECTED })}
                >
                  驳回
                </Button>
              </>
            )}
          </div>
        );
      },
    },
  ];

  const STATUS_TABS = [
    ['', '全部'],
    [SalesOrderStatus.PENDING_APPROVAL, '待审批'],
    [SalesOrderStatus.CONFIRMED,       '已确认'],
    [SalesOrderStatus.IN_PRODUCTION,   '生产中'],
    [SalesOrderStatus.COMPLETED,       '已完成'],
  ] as const;

  return (
    <div className={styles.page}>
      <div className="page-header">
        <h1 className="page-header__title">📋 销售订单</h1>
        <div className="page-header__actions">
          <Button
            variant="ai"
            size="md"
            icon="⚡"
            onClick={() => { setUrgentDrawer(true); setUrgentResult(null); }}
          >
            插单影响分析
          </Button>
        </div>
      </div>

      {/* 状态 Tabs */}
      <div className={styles.tabs} role="tablist">
        {STATUS_TABS.map(([val, label]) => (
          <button
            key={val}
            role="tab"
            aria-selected={statusFilter === val}
            className={`${styles.tab} ${statusFilter === val ? styles['tab--active'] : ''}`}
            onClick={() => { setStatusFilter(val as SalesOrderStatus | ''); setPage(1); }}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <Table<OrderRecord>
          columns={columns}
          dataSource={(data?.list ?? []) as OrderRecord[]}
          rowKey="id"
          loading={isLoading}
          error={error ? (error as Error).message : null}
          emptyText="暂无销售订单"
          pagination={data ? { page, pageSize: 20, total: data.total, onChange: setPage } : undefined}
        />
      </div>

      {/* 订单详情 Drawer */}
      <Drawer
        open={detailId !== null}
        title={detail?.orderNo ?? '订单详情'}
        onClose={() => setDetailId(null)}
        width={520}
      >
        {detail ? (
          <div className={styles.detail}>
            <div className={styles.detail_row}>
              <span className={styles.detail_label}>客户</span>
              <span>{detail.customerName}</span>
            </div>
            <div className={styles.detail_row}>
              <span className={styles.detail_label}>订单类型</span>
              <Tag variant={detail.orderType === OrderType.URGENT ? 'priority-urgent' : 'priority-normal'}>
                {detail.orderType === OrderType.URGENT ? '紧急' : '普通'}
              </Tag>
            </div>
            <div className={styles.detail_row}>
              <span className={styles.detail_label}>状态</span>
              <StatusBadge status={detail.status} />
            </div>
            <div className={styles.detail_row}>
              <span className={styles.detail_label}>约束检查</span>
              <ConstraintResultDisplay result={detail.constraintResult} />
            </div>
            <div className={styles.detail_row}>
              <span className={styles.detail_label}>交期</span>
              <span>{formatDate(detail.expectedDelivery)}</span>
            </div>
            <div className={styles.detail_row}>
              <span className={styles.detail_label}>金额</span>
              <span style={{ fontWeight: 600, fontSize: 'var(--text-body-l)' }}>{formatCNY(detail.totalAmount)}</span>
            </div>
            {detail.blockedReasons.length > 0 && (
              <div className="alert alert--error" style={{ marginTop: 'var(--space-3)' }}>
                <span className="alert__icon">🚫</span>
                <div className="alert__body">
                  <div className="alert__title">拦截原因</div>
                  {detail.blockedReasons.map((r, i) => (
                    <div key={i} className="alert__desc">{r}</div>
                  ))}
                </div>
              </div>
            )}
            {/* 订单明细 */}
            <h3 className={styles.detail_section_title}>订单明细</h3>
            {detail.items.map((item, i) => (
              <div key={i} className={styles.order_item}>
                <span>{item.skuName}</span>
                <span style={{ color: 'var(--text-secondary)' }}>{item.qtyOrdered} 件</span>
                <span style={{ fontFamily: 'var(--font-family-number)' }}>{formatCNY(item.amount ?? '0')}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="skeleton" style={{ height: 200, borderRadius: 8 }} />
        )}
      </Drawer>

      {/* 审批弹窗 */}
      <Modal
        open={approveModal.open}
        title={approveModal.action === ApprovalAction.APPROVED ? '批准订单' : '驳回订单'}
        onClose={() => setApproveModal({ open: false, id: null, action: ApprovalAction.APPROVED })}
        onConfirm={() => void handleApprove()}
        confirmLabel={approveModal.action === ApprovalAction.APPROVED ? '确认批准' : '确认驳回'}
        confirmVariant={approveModal.action === ApprovalAction.APPROVED ? 'success' : 'danger'}
        confirmLoading={approveMutation.isPending}
        size="sm"
      >
        <div className={styles.approve_form}>
          <label htmlFor="approve-notes" className={styles.approve_label}>
            {approveModal.action === ApprovalAction.REJECTED ? '驳回原因（必填）' : '备注（可选）'}
          </label>
          <textarea
            id="approve-notes"
            className={styles.approve_textarea}
            rows={3}
            value={approveNotes}
            onChange={(e) => setApproveNotes(e.target.value)}
            placeholder={approveModal.action === ApprovalAction.REJECTED ? '请说明驳回原因...' : '可选填写附条件说明...'}
          />
        </div>
      </Modal>

      {/* 插单分析 Drawer */}
      <Drawer
        open={urgentDrawer}
        title="⚡ 紧急插单影响分析"
        onClose={() => setUrgentDrawer(false)}
        width={540}
      >
        <div className={styles.urgent_form}>
          <p className={styles.urgent_desc}>
            输入拟接的紧急订单信息，AI 将在 30 秒内评估对现有在产订单的影响。
          </p>
          {urgentMutation.isPending ? (
            <AiThinkingState
              message="AI 正在评估插单影响..."
              steps={[
                { label: '计算 BOM 物料需求...', status: 'done' },
                { label: '检查库存与资金占用...', status: 'active' },
                { label: '评估产能负荷与交期...', status: 'pending' },
              ]}
            />
          ) : urgentResult ? (
            <UrgentAnalysisReport data={urgentResult} />
          ) : (
            <UrgentAnalysisForm
              onSubmit={async (payload) => {
                try {
                  const res = await urgentMutation.mutateAsync(payload);
                  setUrgentResult(res);
                } catch (e) {
                  showToast({ type: 'error', message: (e as Error).message });
                }
              }}
            />
          )}
          {urgentResult && (
            <Button variant="ghost" size="md" onClick={() => setUrgentResult(null)} style={{ marginTop: 'var(--space-4)' }}>
              重新分析
            </Button>
          )}
        </div>
      </Drawer>
    </div>
  );
}

// 插单分析简易表单
function UrgentAnalysisForm({ onSubmit }: { onSubmit: (p: { skuId: number; bomId: number; qty: string; expectedDelivery: string }) => void }) {
  const [form, setForm] = useState({ skuId: '', bomId: '', qty: '', expectedDelivery: '' });
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }));
  return (
    <form
      className={styles.urgent_fields}
      onSubmit={(e) => { e.preventDefault(); onSubmit({ skuId: Number(form.skuId), bomId: Number(form.bomId), qty: form.qty, expectedDelivery: form.expectedDelivery }); }}
    >
      {[
        { name: 'skuId', label: '成品 SKU ID', type: 'number', placeholder: '例：50' },
        { name: 'bomId', label: 'BOM ID', type: 'number', placeholder: '例：1' },
        { name: 'qty', label: '数量', type: 'number', placeholder: '例：5' },
        { name: 'expectedDelivery', label: '期望交期', type: 'date', placeholder: '' },
      ].map(({ name, label, type, placeholder }) => (
        <div key={name} className={styles.urgent_field}>
          <label htmlFor={name} className={styles.approve_label}>{label}</label>
          <input id={name} name={name} type={type} className={styles.approve_textarea} style={{ height: 40, resize: 'none' }} value={form[name as keyof typeof form]} onChange={handleChange} placeholder={placeholder} required />
        </div>
      ))}
      <Button type="submit" variant="ai" size="md" fullWidth>开始分析</Button>
    </form>
  );
}
