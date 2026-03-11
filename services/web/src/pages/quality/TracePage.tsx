/**
 * [artifact:前端代码] — 质量溯源页
 * 功能：质检记录列表、问题录入、溯源链展示、质量统计看板
 */

import { useEffect, useState, useCallback } from 'react';
import { useAppStore } from '@/stores/appStore';
import KpiCardCommon from '@/components/common/KpiCard';
import {
  useInspectionList,
  useCreateInspection,
  useCreateIssue,
  useCompleteInspection,
  useTraceability,
  useQualityStats,
} from '@/api/quality';
import { InspectionStatus, IssueSeverity, IssueType, ScrapReason } from '@/types/enums';
import type { Inspection, QualityIssue, TraceabilityChain } from '@/types/models';
import type { Column } from '@/components/common/Table';
import Table from '@/components/common/Table';
import Modal from '@/components/common/Modal';
import Drawer from '@/components/common/Drawer';
import Tag from '@/components/common/Tag';
import Button from '@/components/common/Button';
import TraceChain from '@/components/common/TraceChain';
import { formatDateTime, formatDate, formatQtyStr, formatPercent } from '@/utils/format';
import styles from './TracePage.module.css';

type InspectionRecord = Inspection & Record<string, unknown>;

const INSP_STATUS_VARIANT: Record<InspectionStatus, 'neutral' | 'warning' | 'success' | 'error'> = {
  [InspectionStatus.PENDING]:   'neutral',
  [InspectionStatus.IN_PROGRESS]: 'warning',
  [InspectionStatus.PASSED]:    'success',
  [InspectionStatus.FAILED]:    'error',
  [InspectionStatus.WAIVED]:    'neutral',
};
const INSP_STATUS_LABEL: Record<InspectionStatus, string> = {
  [InspectionStatus.PENDING]:    '待检验',
  [InspectionStatus.IN_PROGRESS]: '检验中',
  [InspectionStatus.PASSED]:     '合格',
  [InspectionStatus.FAILED]:     '不合格',
  [InspectionStatus.WAIVED]:     '免检',
};

const SEVERITY_VARIANT: Record<IssueSeverity, 'error' | 'warning' | 'info' | 'neutral'> = {
  [IssueSeverity.CRITICAL]: 'error',
  [IssueSeverity.MAJOR]:    'warning',
  [IssueSeverity.MINOR]:    'info',
  [IssueSeverity.COSMETIC]: 'neutral',
};
const SEVERITY_LABEL: Record<IssueSeverity, string> = {
  [IssueSeverity.CRITICAL]: '严重',
  [IssueSeverity.MAJOR]:    '主要',
  [IssueSeverity.MINOR]:    '次要',
  [IssueSeverity.COSMETIC]: '外观',
};

type TraceQuery = { type: 'dyeLot' | 'sku' | 'order'; value: string };

type CreateInspectionForm = {
  productionOrderId: string;
  skuId: string;
  batchNo: string;
  qty: string;
  unit: string;
};

type CreateIssueForm = {
  inspectionId: string;
  type: IssueType | '';
  severity: IssueSeverity | '';
  description: string;
  affectedQty: string;
  scrapReason: ScrapReason | '';
};

export default function TracePage() {
  const { setPageTitle, showToast } = useAppStore();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<InspectionStatus | ''>('');
  const [activeTab, setActiveTab] = useState<'list' | 'stats' | 'trace'>('list');

  // 质检记录详情 Drawer
  const [detailDrawer, setDetailDrawer] = useState<{ open: boolean; inspection: Inspection | null }>({ open: false, inspection: null });
  // 新建质检 Modal
  const [createInspModal, setCreateInspModal] = useState(false);
  const [inspForm, setInspForm] = useState<CreateInspectionForm>({ productionOrderId: '', skuId: '', batchNo: '', qty: '', unit: '' });
  // 新建问题 Modal
  const [createIssueModal, setCreateIssueModal] = useState(false);
  const [issueForm, setIssueForm] = useState<CreateIssueForm>({ inspectionId: '', type: '', severity: '', description: '', affectedQty: '', scrapReason: '' });
  // 完成质检 Modal
  const [completeModal, setCompleteModal] = useState<{ open: boolean; inspection: Inspection | null }>({ open: false, inspection: null });
  const [completeResult, setCompleteResult] = useState<InspectionStatus.PASSED | InspectionStatus.FAILED>(InspectionStatus.PASSED);
  const [completeNote, setCompleteNote] = useState('');
  // 溯源查询
  const [traceQuery, setTraceQuery] = useState<TraceQuery>({ type: 'dyeLot', value: '' });
  const [traceInput, setTraceInput] = useState('');

  useEffect(() => { setPageTitle('质量溯源'); }, [setPageTitle]);

  const { data, isLoading, error } = useInspectionList(
    statusFilter as InspectionStatus || undefined,
    page,
    20,
  );

  const { data: statsData, isLoading: statsLoading } = useQualityStats(
    { enabled: activeTab === 'stats' },
  );

  const { data: traceData, isLoading: traceLoading } = useTraceability(
    traceQuery.type,
    traceQuery.value,
    { enabled: activeTab === 'trace' && !!traceQuery.value },
  );

  const createInspMutation  = useCreateInspection();
  const createIssueMutation  = useCreateIssue();
  const completeMutation     = useCompleteInspection();

  const openDetail = useCallback((insp: Inspection) => setDetailDrawer({ open: true, inspection: insp }), []);

  const openIssueModal = useCallback((insp: Inspection) => {
    setIssueForm((f) => ({ ...f, inspectionId: insp.id }));
    setCreateIssueModal(true);
  }, []);

  const handleCreateInspection = async () => {
    const { productionOrderId, skuId, batchNo, qty, unit } = inspForm;
    if (!skuId || !qty || !unit) {
      showToast({ type: 'warning', message: '请填写 SKU ID、数量和单位' });
      return;
    }
    try {
      await createInspMutation.mutateAsync({ productionOrderId: productionOrderId || undefined, skuId, batchNo: batchNo || undefined, qty: Number(qty), unit });
      showToast({ type: 'success', message: '质检记录已创建' });
      setCreateInspModal(false);
      setInspForm({ productionOrderId: '', skuId: '', batchNo: '', qty: '', unit: '' });
    } catch (e) {
      showToast({ type: 'error', message: (e as Error).message });
    }
  };

  const handleCreateIssue = async () => {
    const { inspectionId, type, severity, description, affectedQty } = issueForm;
    if (!inspectionId || !type || !severity || !description) {
      showToast({ type: 'warning', message: '请填写问题类型、严重级别和描述' });
      return;
    }
    try {
      await createIssueMutation.mutateAsync({
        inspectionId,
        type: type as IssueType,
        severity: severity as IssueSeverity,
        description,
        affectedQty: affectedQty ? Number(affectedQty) : undefined,
        scrapReason: issueForm.scrapReason as ScrapReason || undefined,
      });
      showToast({ type: 'success', message: '质量问题已记录' });
      setCreateIssueModal(false);
      setIssueForm({ inspectionId: '', type: '', severity: '', description: '', affectedQty: '', scrapReason: '' });
    } catch (e) {
      showToast({ type: 'error', message: (e as Error).message });
    }
  };

  const handleComplete = async () => {
    if (!completeModal.inspection) return;
    try {
      await completeMutation.mutateAsync({ id: completeModal.inspection.id, result: completeResult, note: completeNote || undefined });
      showToast({ type: 'success', message: `质检已${completeResult === InspectionStatus.PASSED ? '通过' : '标记为不合格'}` });
      setCompleteModal({ open: false, inspection: null });
      setCompleteNote('');
    } catch (e) {
      showToast({ type: 'error', message: (e as Error).message });
    }
  };

  const handleTrace = () => {
    if (!traceInput.trim()) {
      showToast({ type: 'warning', message: '请输入溯源查询值' });
      return;
    }
    setTraceQuery((q) => ({ ...q, value: traceInput.trim() }));
  };

  const columns: Column<InspectionRecord>[] = [
    {
      key: 'inspectionNo',
      title: '质检编号',
      width: 150,
      render: (_, r) => (
        <span style={{ fontFamily: 'var(--font-family-mono)', fontSize: 13 }}>{(r as unknown as Inspection).inspectionNo}</span>
      ),
    },
    {
      key: 'skuName',
      title: 'SKU',
      render: (_, r) => {
        const insp = r as unknown as Inspection;
        return (
          <div>
            <div style={{ fontWeight: 500 }}>{insp.skuName}</div>
            {insp.batchNo && <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontFamily: 'var(--font-family-mono)' }}>批次：{insp.batchNo}</div>}
          </div>
        );
      },
    },
    {
      key: 'qty',
      title: '检验数量',
      width: 110,
      render: (_, r) => {
        const insp = r as unknown as Inspection;
        return `${formatQtyStr(insp.qty, 2)} ${insp.unit}`;
      },
    },
    {
      key: 'status',
      title: '状态',
      width: 90,
      render: (_, r) => {
        const insp = r as unknown as Inspection;
        return <Tag variant={INSP_STATUS_VARIANT[insp.status]}>{INSP_STATUS_LABEL[insp.status]}</Tag>;
      },
    },
    {
      key: 'issueCount',
      title: '问题数',
      width: 80,
      render: (_, r) => {
        const c = (r as unknown as Inspection).issueCount ?? 0;
        return c > 0 ? <Tag variant="error">{c} 项</Tag> : <span style={{ color: 'var(--text-secondary)' }}>—</span>;
      },
    },
    {
      key: 'inspector',
      title: '检验员',
      width: 100,
      render: (_, r) => (r as unknown as Inspection).inspectorName ?? '—',
    },
    {
      key: 'createdAt',
      title: '创建时间',
      width: 150,
      render: (_, r) => formatDateTime((r as unknown as Inspection).createdAt),
    },
    {
      key: 'actions',
      title: '操作',
      width: 180,
      render: (_, r) => {
        const insp = r as unknown as Inspection;
        return (
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <Button variant="ghost" size="sm" onClick={() => openDetail(insp)}>详情</Button>
            {(insp.status === InspectionStatus.PENDING || insp.status === InspectionStatus.IN_PROGRESS) && (
              <>
                <Button variant="ghost" size="sm" onClick={() => openIssueModal(insp)}>录问题</Button>
                <Button variant="ghost" size="sm" onClick={() => { setCompleteModal({ open: true, inspection: insp }); }}>完成</Button>
              </>
            )}
          </div>
        );
      },
    },
  ];

  const inspList = (data?.list ?? []) as InspectionRecord[];

  return (
    <div className={styles.page}>
      <div className="page-header">
        <h1 className="page-header__title">质量溯源</h1>
        <div className="page-header__actions">
          <Button variant="primary" size="md" onClick={() => setCreateInspModal(true)}>新建质检</Button>
        </div>
      </div>

      {/* 顶部 Tab */}
      <div className={styles.tabs}>
        {([
          { key: 'list',  label: '质检记录' },
          { key: 'stats', label: '质量统计' },
          { key: 'trace', label: '溯源查询' },
        ] as const).map(({ key, label }) => (
          <button
            key={key}
            className={`${styles.tab} ${activeTab === key ? styles['tab--active'] : ''}`}
            onClick={() => setActiveTab(key)}
          >{label}</button>
        ))}
      </div>

      {/* 质检记录 Tab */}
      {activeTab === 'list' && (
        <>
          <div className={styles.filter_bar}>
            <select
              className={styles.filter_select}
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value as InspectionStatus | ''); setPage(1); }}
              aria-label="状态筛选"
            >
              <option value="">全部状态</option>
              {Object.entries(INSP_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <Table<InspectionRecord>
              columns={columns}
              dataSource={inspList}
              rowKey="id"
              loading={isLoading}
              error={error ? (error as Error).message : null}
              emptyText="暂无质检记录"
              pagination={data ? { page, pageSize: 20, total: data.total, onChange: setPage } : undefined}
            />
          </div>
        </>
      )}

      {/* 质量统计 Tab */}
      {activeTab === 'stats' && (
        <QualityStatsDashboard data={statsData ?? null} loading={statsLoading} />
      )}

      {/* 溯源查询 Tab */}
      {activeTab === 'trace' && (
        <TraceabilityPanel
          traceInput={traceInput}
          traceQuery={traceQuery}
          onInputChange={setTraceInput}
          onTypeChange={(t) => setTraceQuery((q) => ({ ...q, type: t, value: '' }))}
          onSearch={handleTrace}
          data={traceData ?? null}
          loading={traceLoading}
        />
      )}

      {/* 质检详情 Drawer */}
      <Drawer
        open={detailDrawer.open}
        title={`质检详情 — ${detailDrawer.inspection?.inspectionNo ?? ''}`}
        width={560}
        onClose={() => setDetailDrawer({ open: false, inspection: null })}
      >
        {detailDrawer.inspection && <InspectionDetailView inspection={detailDrawer.inspection} />}
      </Drawer>

      {/* 新建质检 Modal */}
      <Modal
        open={createInspModal}
        title="新建质检记录"
        onClose={() => setCreateInspModal(false)}
        onConfirm={() => void handleCreateInspection()}
        confirmLabel="创建"
        confirmLoading={createInspMutation.isPending}
        size="md"
      >
        <div className={styles.create_form}>
          <div className={styles.form_row}>
            <div className={styles.form_field}>
              <label className={styles.form_label}>SKU ID <span className={styles.required}>*</span></label>
              <input className={styles.form_input} value={inspForm.skuId}
                onChange={(e) => setInspForm((f) => ({ ...f, skuId: e.target.value }))} placeholder="SKU 内部 ID" />
            </div>
            <div className={styles.form_field}>
              <label className={styles.form_label}>批次号</label>
              <input className={styles.form_input} value={inspForm.batchNo}
                onChange={(e) => setInspForm((f) => ({ ...f, batchNo: e.target.value }))} placeholder="可选" />
            </div>
          </div>
          <div className={styles.form_row}>
            <div className={styles.form_field}>
              <label className={styles.form_label}>检验数量 <span className={styles.required}>*</span></label>
              <input className={styles.form_input} type="number" min="0" step="0.01"
                value={inspForm.qty} onChange={(e) => setInspForm((f) => ({ ...f, qty: e.target.value }))} placeholder="0.00" />
            </div>
            <div className={styles.form_field}>
              <label className={styles.form_label}>单位 <span className={styles.required}>*</span></label>
              <input className={styles.form_input} value={inspForm.unit}
                onChange={(e) => setInspForm((f) => ({ ...f, unit: e.target.value }))} placeholder="如：件" />
            </div>
          </div>
          <div className={styles.form_field}>
            <label className={styles.form_label}>生产工单 ID</label>
            <input className={styles.form_input} value={inspForm.productionOrderId}
              onChange={(e) => setInspForm((f) => ({ ...f, productionOrderId: e.target.value }))} placeholder="可选，关联工单" />
          </div>
        </div>
      </Modal>

      {/* 录入问题 Modal */}
      <Modal
        open={createIssueModal}
        title="录入质量问题"
        onClose={() => setCreateIssueModal(false)}
        onConfirm={() => void handleCreateIssue()}
        confirmLabel="录入"
        confirmLoading={createIssueMutation.isPending}
        size="md"
      >
        <div className={styles.create_form}>
          <div className={styles.form_row}>
            <div className={styles.form_field}>
              <label className={styles.form_label}>问题类型 <span className={styles.required}>*</span></label>
              <select className={styles.form_input} value={issueForm.type}
                onChange={(e) => setIssueForm((f) => ({ ...f, type: e.target.value as IssueType }))}>
                <option value="">请选择</option>
                {Object.values(IssueType).map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className={styles.form_field}>
              <label className={styles.form_label}>严重级别 <span className={styles.required}>*</span></label>
              <select className={styles.form_input} value={issueForm.severity}
                onChange={(e) => setIssueForm((f) => ({ ...f, severity: e.target.value as IssueSeverity }))}>
                <option value="">请选择</option>
                {Object.entries(SEVERITY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
          </div>
          <div className={styles.form_field}>
            <label className={styles.form_label}>问题描述 <span className={styles.required}>*</span></label>
            <textarea
              className={styles.form_textarea}
              rows={3}
              value={issueForm.description}
              onChange={(e) => setIssueForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="请详细描述质量问题..."
            />
          </div>
          <div className={styles.form_row}>
            <div className={styles.form_field}>
              <label className={styles.form_label}>影响数量</label>
              <input className={styles.form_input} type="number" min="0" step="0.01"
                value={issueForm.affectedQty} onChange={(e) => setIssueForm((f) => ({ ...f, affectedQty: e.target.value }))} placeholder="0" />
            </div>
            <div className={styles.form_field}>
              <label className={styles.form_label}>报废原因</label>
              <select className={styles.form_input} value={issueForm.scrapReason}
                onChange={(e) => setIssueForm((f) => ({ ...f, scrapReason: e.target.value as ScrapReason }))}>
                <option value="">不报废</option>
                {Object.values(ScrapReason).map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
          </div>
        </div>
      </Modal>

      {/* 完成质检 Modal */}
      <Modal
        open={completeModal.open}
        title={`完成质检 — ${completeModal.inspection?.inspectionNo ?? ''}`}
        onClose={() => { setCompleteModal({ open: false, inspection: null }); setCompleteNote(''); }}
        onConfirm={() => void handleComplete()}
        confirmLabel="确认完成"
        confirmLoading={completeMutation.isPending}
        size="sm"
      >
        <div className={styles.complete_form}>
          <div className={styles.result_tabs}>
            <button
              className={`${styles.result_tab} ${completeResult === InspectionStatus.PASSED ? styles['result_tab--pass'] : ''}`}
              onClick={() => setCompleteResult(InspectionStatus.PASSED)}
            >合格</button>
            <button
              className={`${styles.result_tab} ${completeResult === InspectionStatus.FAILED ? styles['result_tab--fail'] : ''}`}
              onClick={() => setCompleteResult(InspectionStatus.FAILED)}
            >不合格</button>
          </div>
          <div className={styles.form_field}>
            <label className={styles.form_label}>备注</label>
            <textarea
              className={styles.form_textarea}
              rows={3}
              value={completeNote}
              onChange={(e) => setCompleteNote(e.target.value)}
              placeholder="可选备注..."
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}

/* ——— 质检详情 ——— */

function InspectionDetailView({ inspection }: { inspection: Inspection }) {
  return (
    <div className={styles.detail_view}>
      <div className={styles.detail_grid}>
        <InfoRow label="质检编号" value={inspection.inspectionNo} />
        <InfoRow label="状态"     value={INSP_STATUS_LABEL[inspection.status]} />
        <InfoRow label="SKU"      value={`${inspection.skuName ?? ''} (${inspection.skuCode ?? ''})`} />
        <InfoRow label="批次号"   value={inspection.batchNo ?? '—'} />
        <InfoRow label="检验数量" value={`${formatQtyStr(inspection.qty, 2)} ${inspection.unit}`} />
        <InfoRow label="检验员"   value={inspection.inspectorName ?? '—'} />
        <InfoRow label="创建时间" value={formatDateTime(inspection.createdAt)} />
        {inspection.completedAt && <InfoRow label="完成时间" value={formatDateTime(inspection.completedAt)} />}
        {inspection.note && <div style={{ gridColumn: '1 / -1' }}><InfoRow label="备注" value={inspection.note} /></div>}
      </div>

      {inspection.issues && inspection.issues.length > 0 && (
        <div>
          <div className={styles.detail_section_title}>质量问题 ({inspection.issues.length})</div>
          {inspection.issues.map((issue: QualityIssue) => (
            <div key={issue.id} className={styles.issue_item}>
              <div className={styles.issue_header}>
                <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                  <Tag variant={SEVERITY_VARIANT[issue.severity]}>{SEVERITY_LABEL[issue.severity]}</Tag>
                  <span style={{ fontSize: 'var(--text-body-s)', fontWeight: 500 }}>{issue.type}</span>
                </div>
                {issue.affectedQty && (
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>影响：{formatQtyStr(issue.affectedQty, 2)}</span>
                )}
              </div>
              <p className={styles.issue_desc}>{issue.description}</p>
              {issue.scrapReason && (
                <div className={styles.issue_scrap}>报废原因：{issue.scrapReason}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ——— 质量统计看板 ——— */

type QualityStats = {
  totalInspections: number;
  passRate: number;
  criticalIssues: number;
  avgInspectionTime: number;
  recentTrend: Array<{ date: string; passRate: number; total: number }>;
  topIssueTypes: Array<{ type: string; count: number }>;
};

function QualityStatsDashboard({ data, loading }: { data: QualityStats | null; loading: boolean }) {
  if (loading) {
    return (
      <div className={styles.stats_loading}>
        <div className="spinner" aria-label="加载中" />
        <span>加载统计数据...</span>
      </div>
    );
  }
  if (!data) return <div className="card"><p style={{ color: 'var(--text-secondary)', padding: 'var(--space-4)' }}>暂无统计数据</p></div>;

  return (
    <div className={styles.stats_panel}>
      {/* KPI 卡片行 */}
      <div className={styles.stats_kpi_grid}>
        <KpiCardCommon title="总质检次数" value={data.totalInspections} unit="次" color="var(--color-primary-500)" />
        <KpiCardCommon
          title="合格率"
          value={formatPercent(data.passRate)}
          color={data.passRate >= 0.95 ? 'var(--color-success-500)' : data.passRate >= 0.9 ? 'var(--color-warning-500)' : 'var(--color-error-500)'}
        />
        <KpiCardCommon title="严重问题" value={data.criticalIssues} unit="项" color={data.criticalIssues > 0 ? 'var(--color-error-500)' : 'var(--color-success-500)'} />
        <KpiCardCommon title="平均检验时长" value={Math.round(data.avgInspectionTime)} unit="分钟" color="var(--color-info-500)" />
      </div>

      {/* 趋势与问题类型 */}
      <div className={styles.stats_charts_row}>
        <div className="card">
          <div className={styles.chart_title}>近期合格率趋势</div>
          <div className={styles.trend_list}>
            {data.recentTrend.map((row) => (
              <div key={row.date} className={styles.trend_row}>
                <span className={styles.trend_date}>{formatDate(row.date)}</span>
                <div className={styles.trend_bar_wrap}>
                  <div
                    className={styles.trend_bar}
                    style={{
                      width: `${row.passRate * 100}%`,
                      background: row.passRate >= 0.95
                        ? 'var(--color-success-500)'
                        : row.passRate >= 0.9
                          ? 'var(--color-warning-500)'
                          : 'var(--color-error-500)',
                    }}
                  />
                </div>
                <span className={styles.trend_value}>{formatPercent(row.passRate)}</span>
                <span className={styles.trend_count}>({row.total})</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className={styles.chart_title}>TOP 问题类型</div>
          {data.topIssueTypes.map((item, i) => {
            const max = data.topIssueTypes[0]?.count ?? 1;
            return (
              <div key={item.type} className={styles.issue_type_row}>
                <span className={styles.issue_rank}>{i + 1}</span>
                <span className={styles.issue_type_name}>{item.type}</span>
                <div className={styles.issue_type_bar_wrap}>
                  <div className={styles.issue_type_bar} style={{ width: `${(item.count / max) * 100}%` }} />
                </div>
                <span className={styles.issue_type_count}>{item.count}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ——— 溯源查询面板 ——— */

function TraceabilityPanel({
  traceInput,
  traceQuery,
  onInputChange,
  onTypeChange,
  onSearch,
  data,
  loading,
}: {
  traceInput: string;
  traceQuery: TraceQuery;
  onInputChange: (v: string) => void;
  onTypeChange: (t: TraceQuery['type']) => void;
  onSearch: () => void;
  data: TraceabilityChain | null;
  loading: boolean;
}) {
  return (
    <div className={styles.trace_panel}>
      {/* 查询控件 */}
      <div className={styles.trace_search_bar}>
        <select
          className={styles.filter_select}
          value={traceQuery.type}
          onChange={(e) => onTypeChange(e.target.value as TraceQuery['type'])}
          aria-label="溯源维度"
        >
          <option value="dyeLot">按染色批次</option>
          <option value="sku">按 SKU 编码</option>
          <option value="order">按生产工单号</option>
        </select>
        <input
          type="search"
          className={styles.trace_input}
          placeholder={traceQuery.type === 'dyeLot' ? '输入染色批次号...' : traceQuery.type === 'sku' ? '输入 SKU 编码...' : '输入工单号...'}
          value={traceInput}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onSearch()}
          aria-label="溯源查询输入"
        />
        <Button variant="primary" size="md" onClick={onSearch} loading={loading}>查询</Button>
      </div>

      {loading && (
        <div className={styles.stats_loading}>
          <div className="spinner" aria-label="查询中" />
          <span>溯源查询中...</span>
        </div>
      )}

      {!loading && !data && traceQuery.value && (
        <div className="card">
          <p style={{ color: 'var(--text-secondary)', padding: 'var(--space-4)', textAlign: 'center' }}>未找到相关溯源数据</p>
        </div>
      )}

      {!loading && !traceQuery.value && (
        <div className="card">
          <p style={{ color: 'var(--text-secondary)', padding: 'var(--space-6)', textAlign: 'center', lineHeight: 1.8 }}>
            输入染色批次号、SKU 编码或生产工单号，查询完整质量溯源链。<br />
            溯源链涵盖：原料来源 → 投料批次 → 生产工序 → 质检结果 → 成品流向。
          </p>
        </div>
      )}

      {!loading && data && <TraceChainView chain={data} />}
    </div>
  );
}

function TraceChainView({ chain }: { chain: TraceabilityChain }) {
  return (
    <div className={styles.trace_chain_wrap}>
      <div className={styles.trace_chain_header}>
        <h3 className={styles.trace_chain_title}>溯源链</h3>
        <div className={styles.trace_chain_meta}>
          <span>查询对象：<strong>{chain.queryValue}</strong></span>
          <span>节点数：{chain.nodes?.length ?? 0}</span>
        </div>
      </div>

      {/* 使用 TraceChain 组件渲染水平溯源链 */}
      {chain.nodes && chain.nodes.length > 0 ? (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <TraceChain nodes={chain.nodes} />
        </div>
      ) : (
        <div className="card">
          <p style={{ color: 'var(--text-secondary)', padding: 'var(--space-4)', textAlign: 'center' }}>
            该溯源记录暂无节点数据
          </p>
        </div>
      )}
    </div>
  );
}

function getNodeTypeLabel(type: string): string {
  const map: Record<string, string> = {
    raw_material:  '原料',
    dye_lot:       '染色批次',
    inbound:       '入库',
    production:    '生产工序',
    inspection:    '质检',
    outbound:      '出库',
    sales_order:   '销售出货',
  };
  return map[type] ?? type;
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</span>
      <span style={{ fontSize: 'var(--text-body-m)', color: 'var(--text-primary)' }}>{value}</span>
    </div>
  );
}
