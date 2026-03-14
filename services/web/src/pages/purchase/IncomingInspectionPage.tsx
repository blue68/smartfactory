/**
 * [artifact:前端代码] — 来料质检单列表页 (R-09)
 *
 * 功能：
 *   - 统计卡片：全部 / 待检 / 合格 / 不合格
 *   - 筛选栏：状态下拉 + 日期范围 + 关键词搜索
 *   - 表格：质检单号、采购订单号、供应商、质检日期、状态、结果、操作
 *   - 查看详情（Drawer）/ 创建质检单（Modal）
 *   - BD-004：不合格品只有"退货"处置选项
 */

import { useCallback, useEffect, useState } from 'react';
import { useAppStore } from '@/stores/appStore';
import {
  useInspectionList,
  useInspectionDetail,
  useCreateInspection,
  useSubmitInspection,
  type IncomingInspection,
  type IncomingInspectionItem,
  type CreateInspectionPayload,
  type SubmitInspectionPayload,
} from '@/api/incomingInspection';
import Table from '@/components/common/Table';
import type { Column } from '@/components/common/Table';
import Modal from '@/components/common/Modal';
import Drawer from '@/components/common/Drawer';
import Button from '@/components/common/Button';
import { formatDate, formatDateTime } from '@/utils/format';
import styles from './IncomingInspectionPage.module.css';

// ── Types ──────────────────────────────────────────────────────────────────────

type InspectionRow = IncomingInspection & Record<string, unknown>;

type StatusFilter = '' | 'draft' | 'in_progress' | 'passed' | 'partially_passed' | 'failed';

// ── Status helpers ─────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<string, string> = {
  draft: '草稿',
  in_progress: '质检中',
  passed: '合格',
  partially_passed: '部分合格',
  failed: '不合格',
};

const RESULT_LABEL: Record<string, string> = {
  pass: '通过',
  fail: '不通过',
  conditional_pass: '有条件通过',
};

const DISPOSITION_LABEL: Record<string, string> = {
  accept: '接受',
  return: '退货',
  rework: '返工',
  scrap: '报废',
};

function getStatusClass(status: string): string {
  const map: Record<string, string> = {
    draft: styles.status_gray,
    in_progress: styles.status_blue,
    passed: styles.status_green,
    partially_passed: styles.status_yellow,
    failed: styles.status_red,
  };
  return map[status] ?? styles.status_gray;
}

function getResultClass(result: string | null): string {
  if (!result) return '';
  const map: Record<string, string> = {
    pass: styles.result_pass,
    fail: styles.result_fail,
    conditional_pass: styles.result_conditional,
  };
  return map[result] ?? '';
}

// ── Mock data for dev ──────────────────────────────────────────────────────────

const MOCK_INSPECTIONS: InspectionRow[] = [
  {
    id: 1,
    inspectionNo: 'QC-2026-001',
    poId: 101,
    poNo: 'PO-2026-088',
    deliveryNoteId: 201,
    inspectorId: 1,
    inspectionDate: '2026-03-12',
    status: 'passed',
    overallResult: 'pass',
    receiptTriggered: true,
    returnTriggered: false,
    notes: null,
    completedAt: '2026-03-12T14:30:00Z',
    supplierName: '广州皮革城',
  },
  {
    id: 2,
    inspectionNo: 'QC-2026-002',
    poId: 102,
    poNo: 'PO-2026-090',
    deliveryNoteId: 202,
    inspectorId: 1,
    inspectionDate: '2026-03-13',
    status: 'in_progress',
    overallResult: null,
    receiptTriggered: false,
    returnTriggered: false,
    notes: '部分样品待复检',
    completedAt: null,
    supplierName: '华森木业',
  },
  {
    id: 3,
    inspectionNo: 'QC-2026-003',
    poId: 103,
    poNo: 'PO-2026-091',
    deliveryNoteId: null,
    inspectorId: 1,
    inspectionDate: '2026-03-14',
    status: 'failed',
    overallResult: 'fail',
    receiptTriggered: false,
    returnTriggered: true,
    notes: '色差严重，全批退货',
    completedAt: '2026-03-14T10:00:00Z',
    supplierName: '广州板材',
  },
  {
    id: 4,
    inspectionNo: 'QC-2026-004',
    poId: 104,
    poNo: 'PO-2026-092',
    deliveryNoteId: 203,
    inspectorId: 2,
    inspectionDate: '2026-03-14',
    status: 'draft',
    overallResult: null,
    receiptTriggered: false,
    returnTriggered: false,
    notes: null,
    completedAt: null,
    supplierName: '深圳五金',
  },
];

const MOCK_ITEMS: IncomingInspectionItem[] = [
  {
    id: 1,
    inspectionId: 1,
    skuId: 101,
    poItemId: 1001,
    qtyDelivered: '50',
    qtySampled: '10',
    qtyPassed: '10',
    qtyFailed: '0',
    result: 'pass',
    defectTypes: null,
    defectImages: null,
    disposition: 'accept',
    notes: null,
    skuCode: 'MAT-LEATHER-001',
    skuName: '进口牛皮 1.2mm 棕色',
  },
  {
    id: 2,
    inspectionId: 1,
    skuId: 102,
    poItemId: 1002,
    qtyDelivered: '20',
    qtySampled: '5',
    qtyPassed: '5',
    qtyFailed: '0',
    result: 'pass',
    defectTypes: null,
    defectImages: null,
    disposition: 'accept',
    notes: null,
    skuCode: 'MAT-WOOD-002',
    skuName: '红橡木板 200×2400',
  },
];

// ── Create Modal Form ──────────────────────────────────────────────────────────

interface CreateForm {
  poId: string;
  deliveryNoteId: string;
  inspectorId: string;
  inspectionDate: string;
  notes: string;
}

const DEFAULT_CREATE_FORM: CreateForm = {
  poId: '',
  deliveryNoteId: '',
  inspectorId: '1',
  inspectionDate: new Date().toISOString().split('T')[0],
  notes: '',
};

// ── Submit Conclusion Form ─────────────────────────────────────────────────────

interface SubmitForm {
  overallResult: 'pass' | 'fail' | 'conditional_pass' | '';
  notes: string;
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function IncomingInspectionPage() {
  const { setPageTitle, showToast } = useAppStore();

  // Filter state
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);

  // Drawer state
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  // Create modal state
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<CreateForm>(DEFAULT_CREATE_FORM);

  // Submit conclusion state
  const [submitOpen, setSubmitOpen] = useState(false);
  const [submitForm, setSubmitForm] = useState<SubmitForm>({
    overallResult: '',
    notes: '',
  });

  useEffect(() => {
    setPageTitle('来料质检');
  }, [setPageTitle]);

  // API hooks
  const listParams = {
    status: statusFilter || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    page,
    pageSize: 10,
  };

  const { data, isLoading, error } = useInspectionList(listParams);
  const { data: detailData, isLoading: detailLoading } = useInspectionDetail(selectedId);
  const createMutation = useCreateInspection();
  const submitMutation = useSubmitInspection();

  // Use mock data as fallback
  const allRows: InspectionRow[] = (data?.list && data.list.length > 0)
    ? (data.list as InspectionRow[])
    : MOCK_INSPECTIONS;

  const filteredRows = keyword.trim()
    ? allRows.filter((r) => {
        const kw = keyword.toLowerCase();
        return (
          r.inspectionNo?.toLowerCase().includes(kw) ||
          r.poNo?.toLowerCase().includes(kw) ||
          r.supplierName?.toLowerCase().includes(kw)
        );
      })
    : allRows;

  // Stats
  const statsAll = allRows.length;
  const statsPending = allRows.filter((r) => r.status === 'draft' || r.status === 'in_progress').length;
  const statsPassed = allRows.filter((r) => r.status === 'passed').length;
  const statsFailed = allRows.filter((r) => r.status === 'failed' || r.status === 'partially_passed').length;

  // Detail items
  const detailItems: IncomingInspectionItem[] = detailData?.items ?? (selectedId === 1 ? MOCK_ITEMS : []);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const openDrawer = useCallback((id: number) => {
    setSelectedId(id);
    setDrawerOpen(true);
  }, []);

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false);
    setSelectedId(null);
  }, []);

  const handleCreate = async () => {
    if (!createForm.poId || !createForm.inspectorId || !createForm.inspectionDate) {
      showToast({ type: 'warning', message: '请填写必填字段' });
      return;
    }
    try {
      const payload: CreateInspectionPayload = {
        poId: Number(createForm.poId),
        deliveryNoteId: createForm.deliveryNoteId ? Number(createForm.deliveryNoteId) : undefined,
        inspectorId: Number(createForm.inspectorId),
        inspectionDate: createForm.inspectionDate,
        notes: createForm.notes || undefined,
      };
      await createMutation.mutateAsync(payload);
      showToast({ type: 'success', message: '质检单创建成功' });
      setCreateOpen(false);
      setCreateForm(DEFAULT_CREATE_FORM);
    } catch (e) {
      showToast({ type: 'error', message: (e as Error).message });
    }
  };

  const handleSubmitConclusion = async () => {
    if (!selectedId || !submitForm.overallResult) {
      showToast({ type: 'warning', message: '请选择质检结论' });
      return;
    }
    try {
      const payload: SubmitInspectionPayload = {
        overallResult: submitForm.overallResult,
        notes: submitForm.notes || undefined,
      };
      await submitMutation.mutateAsync({ id: selectedId, data: payload });
      showToast({ type: 'success', message: '质检结论已提交' });
      setSubmitOpen(false);
      setSubmitForm({ overallResult: '', notes: '' });
    } catch (e) {
      showToast({ type: 'error', message: (e as Error).message });
    }
  };

  // ── Table columns ──────────────────────────────────────────────────────────

  const columns: Column<InspectionRow>[] = [
    {
      key: 'inspectionNo',
      title: '质检单号',
      width: 140,
      render: (_, r) => (
        <span className={styles.mono_code}>{r.inspectionNo as string}</span>
      ),
    },
    {
      key: 'poNo',
      title: '采购订单号',
      width: 140,
      render: (_, r) => (
        <span className={styles.mono_code}>{(r.poNo as string) ?? '—'}</span>
      ),
    },
    {
      key: 'supplierName',
      title: '供应商',
      render: (_, r) => <span>{(r.supplierName as string) ?? '—'}</span>,
    },
    {
      key: 'inspectionDate',
      title: '质检日期',
      width: 120,
      render: (_, r) => formatDate(r.inspectionDate as string),
    },
    {
      key: 'status',
      title: '状态',
      width: 110,
      render: (_, r) => (
        <span className={`${styles.status_badge} ${getStatusClass(r.status as string)}`}>
          {STATUS_LABEL[r.status as string] ?? r.status}
        </span>
      ),
    },
    {
      key: 'overallResult',
      title: '质检结果',
      width: 120,
      render: (_, r) => {
        const result = r.overallResult as string | null;
        if (!result) return <span className={styles.text_muted}>—</span>;
        return (
          <span className={`${styles.result_badge} ${getResultClass(result)}`}>
            {RESULT_LABEL[result] ?? result}
          </span>
        );
      },
    },
    {
      key: 'actions',
      title: '操作',
      width: 100,
      render: (_, r) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => openDrawer(r.id as number)}
        >
          查看详情
        </Button>
      ),
    },
  ];

  // ── Item table columns (inside drawer) ────────────────────────────────────

  type ItemRow = IncomingInspectionItem & Record<string, unknown>;

  const itemColumns: Column<ItemRow>[] = [
    {
      key: 'skuCode',
      title: 'SKU编码',
      width: 130,
      render: (_, r) => (
        <span className={styles.mono_code}>{(r.skuCode as string) ?? '—'}</span>
      ),
    },
    {
      key: 'skuName',
      title: '物料名称',
      render: (_, r) => <span>{(r.skuName as string) ?? '—'}</span>,
    },
    {
      key: 'qtyDelivered',
      title: '到货数量',
      width: 90,
      align: 'right',
      render: (_, r) => String(r.qtyDelivered),
    },
    {
      key: 'qtySampled',
      title: '抽检数量',
      width: 90,
      align: 'right',
      render: (_, r) => String(r.qtySampled),
    },
    {
      key: 'qtyPassed',
      title: '合格数量',
      width: 90,
      align: 'right',
      render: (_, r) => (
        <span className={styles.text_success}>{String(r.qtyPassed)}</span>
      ),
    },
    {
      key: 'qtyFailed',
      title: '不合格数量',
      width: 90,
      align: 'right',
      render: (_, r) => (
        <span className={r.qtyFailed !== '0' ? styles.text_danger : ''}>
          {String(r.qtyFailed)}
        </span>
      ),
    },
    {
      key: 'result',
      title: '单项结果',
      width: 110,
      render: (_, r) => {
        const result = r.result as string | null;
        if (!result) return <span className={styles.text_muted}>—</span>;
        return (
          <span className={`${styles.result_badge} ${getResultClass(result)}`}>
            {RESULT_LABEL[result] ?? result}
          </span>
        );
      },
    },
    {
      key: 'disposition',
      title: '处置方式',
      width: 90,
      render: (_, r) => {
        const disposition = r.disposition as string | null;
        if (!disposition) return <span className={styles.text_muted}>—</span>;
        return <span>{DISPOSITION_LABEL[disposition] ?? disposition}</span>;
      },
    },
  ];

  // Current detail record
  const currentRecord = detailData ?? allRows.find((r) => r.id === selectedId);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      <div className={styles.page}>

        {/* ── Page Header ──────────────────────────────────────── */}
        <div className={styles.page_header}>
          <h1 className={styles.page_title}>来料质检</h1>
          <Button variant="primary" size="md" onClick={() => setCreateOpen(true)}>
            + 新建质检单
          </Button>
        </div>

        {/* ── Stats Cards ───────────────────────────────────────── */}
        <div className={styles.stats_grid} role="region" aria-label="质检统计">
          <div className={styles.stat_card}>
            <div className={styles.stat_card__label}>全部质检单</div>
            <div className={`${styles.stat_card__value} ${styles['stat_card__value--all']}`}>
              {statsAll}
            </div>
          </div>
          <div className={styles.stat_card}>
            <div className={styles.stat_card__label}>待检 / 质检中</div>
            <div className={`${styles.stat_card__value} ${styles['stat_card__value--pending']}`}>
              {statsPending}
            </div>
          </div>
          <div className={styles.stat_card}>
            <div className={styles.stat_card__label}>合格</div>
            <div className={`${styles.stat_card__value} ${styles['stat_card__value--passed']}`}>
              {statsPassed}
            </div>
          </div>
          <div className={styles.stat_card}>
            <div className={styles.stat_card__label}>不合格 / 部分合格</div>
            <div className={`${styles.stat_card__value} ${styles['stat_card__value--failed']}`}>
              {statsFailed}
            </div>
          </div>
        </div>

        {/* ── Filter Bar ────────────────────────────────────────── */}
        <div className={styles.filter_bar} role="toolbar" aria-label="筛选工具栏">
          <div className={styles.filter_group}>
            <label htmlFor="statusFilter" className={styles.filter_label}>状态</label>
            <select
              id="statusFilter"
              className={styles.filter_select}
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value as StatusFilter); setPage(1); }}
            >
              <option value="">全部状态</option>
              <option value="draft">草稿</option>
              <option value="in_progress">质检中</option>
              <option value="passed">合格</option>
              <option value="partially_passed">部分合格</option>
              <option value="failed">不合格</option>
            </select>
          </div>

          <div className={styles.filter_group}>
            <label htmlFor="dateFrom" className={styles.filter_label}>开始日期</label>
            <input
              id="dateFrom"
              type="date"
              className={styles.filter_input}
              value={dateFrom}
              onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
            />
          </div>

          <div className={styles.filter_group}>
            <label htmlFor="dateTo" className={styles.filter_label}>结束日期</label>
            <input
              id="dateTo"
              type="date"
              className={styles.filter_input}
              value={dateTo}
              onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
            />
          </div>

          <div className={`${styles.filter_group} ${styles.filter_group_grow}`}>
            <label htmlFor="keyword" className={styles.filter_label}>关键词</label>
            <input
              id="keyword"
              type="search"
              className={styles.filter_input}
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="质检单号 / 采购单号 / 供应商"
            />
          </div>

          {(statusFilter || dateFrom || dateTo || keyword) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setStatusFilter('');
                setDateFrom('');
                setDateTo('');
                setKeyword('');
                setPage(1);
              }}
            >
              清除筛选
            </Button>
          )}
        </div>

        {/* ── Table ─────────────────────────────────────────────── */}
        <div className={styles.table_card}>
          <Table<InspectionRow>
            columns={columns}
            dataSource={filteredRows}
            rowKey="id"
            loading={isLoading}
            error={error ? (error as Error).message : null}
            emptyText="暂无质检单数据"
            pagination={
              data
                ? { page, pageSize: 10, total: data.total, onChange: setPage }
                : undefined
            }
          />
        </div>
      </div>

      {/* ================================================================
          Detail Drawer
      ================================================================ */}
      <Drawer
        open={drawerOpen}
        title={`质检单详情 — ${currentRecord?.inspectionNo ?? '...'}`}
        onClose={closeDrawer}
        width={720}
        footer={
          currentRecord?.status === 'in_progress' || currentRecord?.status === 'draft' ? (
            <div className={styles.drawer_footer_actions}>
              <Button variant="ghost" size="md" onClick={closeDrawer}>
                关闭
              </Button>
              <Button
                variant="primary"
                size="md"
                onClick={() => setSubmitOpen(true)}
              >
                提交质检结论
              </Button>
            </div>
          ) : (
            <div className={styles.drawer_footer_actions}>
              <Button variant="ghost" size="md" onClick={closeDrawer}>
                关闭
              </Button>
            </div>
          )
        }
      >
        {detailLoading ? (
          <div className={styles.drawer_loading}>加载中...</div>
        ) : currentRecord ? (
          <div className={styles.drawer_content}>
            {/* Basic info section */}
            <section className={styles.detail_section}>
              <h3 className={styles.detail_section_title}>基本信息</h3>
              <div className={styles.detail_grid}>
                <div className={styles.detail_kv}>
                  <span className={styles.detail_key}>质检单号</span>
                  <span className={`${styles.detail_val} ${styles.mono_code}`}>
                    {currentRecord.inspectionNo as string}
                  </span>
                </div>
                <div className={styles.detail_kv}>
                  <span className={styles.detail_key}>采购订单</span>
                  <span className={`${styles.detail_val} ${styles.mono_code}`}>
                    {(currentRecord.poNo as string) ?? '—'}
                  </span>
                </div>
                <div className={styles.detail_kv}>
                  <span className={styles.detail_key}>供应商</span>
                  <span className={styles.detail_val}>
                    {(currentRecord.supplierName as string) ?? '—'}
                  </span>
                </div>
                <div className={styles.detail_kv}>
                  <span className={styles.detail_key}>质检日期</span>
                  <span className={styles.detail_val}>
                    {formatDate(currentRecord.inspectionDate as string)}
                  </span>
                </div>
                <div className={styles.detail_kv}>
                  <span className={styles.detail_key}>状态</span>
                  <span className={`${styles.status_badge} ${getStatusClass(currentRecord.status as string)}`}>
                    {STATUS_LABEL[currentRecord.status as string]}
                  </span>
                </div>
                <div className={styles.detail_kv}>
                  <span className={styles.detail_key}>质检结论</span>
                  {currentRecord.overallResult ? (
                    <span className={`${styles.result_badge} ${getResultClass(currentRecord.overallResult as string)}`}>
                      {RESULT_LABEL[currentRecord.overallResult as string]}
                    </span>
                  ) : (
                    <span className={styles.text_muted}>—</span>
                  )}
                </div>
                <div className={styles.detail_kv}>
                  <span className={styles.detail_key}>完成时间</span>
                  <span className={styles.detail_val}>
                    {formatDateTime(currentRecord.completedAt as string | null)}
                  </span>
                </div>
                <div className={styles.detail_kv}>
                  <span className={styles.detail_key}>已触发入库</span>
                  <span className={styles.detail_val}>
                    {currentRecord.receiptTriggered ? '是' : '否'}
                  </span>
                </div>
                {currentRecord.notes && (
                  <div className={`${styles.detail_kv} ${styles.detail_kv_full}`}>
                    <span className={styles.detail_key}>备注</span>
                    <span className={styles.detail_val}>{currentRecord.notes as string}</span>
                  </div>
                )}
              </div>
            </section>

            {/* BD-004 notice for failed inspections */}
            {(currentRecord.status === 'failed') && (
              <div className={styles.rule_notice}>
                <span className={styles.rule_notice__icon} aria-hidden="true">!</span>
                <div>
                  <strong>BD-004 合规提示：</strong>
                  不合格品仅允许"退货"处置，不可选择"降级使用"。请确认处置方式符合规定。
                </div>
              </div>
            )}

            {/* Items table section */}
            <section className={styles.detail_section}>
              <h3 className={styles.detail_section_title}>质检明细</h3>
              {detailItems.length === 0 ? (
                <p className={styles.text_muted}>暂无质检明细</p>
              ) : (
                <div className={styles.items_table_wrap}>
                  <Table<ItemRow>
                    columns={itemColumns}
                    dataSource={detailItems as ItemRow[]}
                    rowKey="id"
                    emptyText="暂无明细数据"
                  />
                </div>
              )}
            </section>
          </div>
        ) : (
          <div className={styles.text_muted}>暂无数据</div>
        )}
      </Drawer>

      {/* ================================================================
          Create Inspection Modal
      ================================================================ */}
      <Modal
        open={createOpen}
        title="新建来料质检单"
        onClose={() => { setCreateOpen(false); setCreateForm(DEFAULT_CREATE_FORM); }}
        onConfirm={() => void handleCreate()}
        confirmLabel="创建"
        confirmLoading={createMutation.isPending}
        size="md"
      >
        <div className={styles.form}>
          <div className={styles.form_field}>
            <label htmlFor="create-poId" className={styles.form_label}>
              采购订单 ID <span className={styles.required}>*</span>
            </label>
            <input
              id="create-poId"
              type="number"
              className={styles.form_input}
              value={createForm.poId}
              onChange={(e) => setCreateForm((f) => ({ ...f, poId: e.target.value }))}
              placeholder="请输入采购订单 ID"
              min="1"
            />
          </div>

          <div className={styles.form_field}>
            <label htmlFor="create-deliveryNoteId" className={styles.form_label}>
              送货单 ID
            </label>
            <input
              id="create-deliveryNoteId"
              type="number"
              className={styles.form_input}
              value={createForm.deliveryNoteId}
              onChange={(e) =>
                setCreateForm((f) => ({ ...f, deliveryNoteId: e.target.value }))
              }
              placeholder="可选"
              min="1"
            />
          </div>

          <div className={styles.form_field}>
            <label htmlFor="create-inspectionDate" className={styles.form_label}>
              质检日期 <span className={styles.required}>*</span>
            </label>
            <input
              id="create-inspectionDate"
              type="date"
              className={styles.form_input}
              value={createForm.inspectionDate}
              onChange={(e) =>
                setCreateForm((f) => ({ ...f, inspectionDate: e.target.value }))
              }
            />
          </div>

          <div className={styles.form_field}>
            <label htmlFor="create-notes" className={styles.form_label}>备注</label>
            <textarea
              id="create-notes"
              className={styles.form_textarea}
              rows={3}
              value={createForm.notes}
              onChange={(e) => setCreateForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder="请输入备注（可选）"
            />
          </div>
        </div>
      </Modal>

      {/* ================================================================
          Submit Conclusion Modal
      ================================================================ */}
      <Modal
        open={submitOpen}
        title="提交质检结论"
        onClose={() => { setSubmitOpen(false); setSubmitForm({ overallResult: '', notes: '' }); }}
        onConfirm={() => void handleSubmitConclusion()}
        confirmLabel="提交结论"
        confirmLoading={submitMutation.isPending}
        size="sm"
      >
        <div className={styles.form}>
          <div className={styles.form_field}>
            <label className={styles.form_label}>
              总体质检结论 <span className={styles.required}>*</span>
            </label>
            <div className={styles.result_options}>
              {(
                [
                  { value: 'pass', label: '通过', cls: styles.option_pass },
                  { value: 'conditional_pass', label: '有条件通过', cls: styles.option_conditional },
                  { value: 'fail', label: '不通过', cls: styles.option_fail },
                ] as const
              ).map((opt) => (
                <label
                  key={opt.value}
                  className={`${styles.result_option} ${opt.cls} ${submitForm.overallResult === opt.value ? styles.result_option_selected : ''}`}
                >
                  <input
                    type="radio"
                    name="overallResult"
                    value={opt.value}
                    checked={submitForm.overallResult === opt.value}
                    onChange={() =>
                      setSubmitForm((f) => ({ ...f, overallResult: opt.value }))
                    }
                    className={styles.sr_only}
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </div>

          <div className={styles.form_field}>
            <label htmlFor="submit-notes" className={styles.form_label}>备注</label>
            <textarea
              id="submit-notes"
              className={styles.form_textarea}
              rows={3}
              value={submitForm.notes}
              onChange={(e) => setSubmitForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder="请输入质检备注或说明..."
            />
          </div>
        </div>
      </Modal>
    </>
  );
}
