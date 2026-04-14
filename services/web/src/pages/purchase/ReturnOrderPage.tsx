import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  useReturnOrderList,
  useReturnOrderDetail,
  useConfirmReturnOrder,
  useShipReturnOrder,
  useCompleteReturnOrder,
  type ReturnOrder,
  type ReturnOrderItem,
} from '@/api/returnOrder';
import { useInspectionDetail } from '@/api/incomingInspection';
import { usePurchaseOrderDetail } from '@/api/purchase';
import { useWarehouseOptions, useLocationOptions } from '@/api/inventory';
import { useAppStore } from '@/stores/appStore';
import Drawer from '@/components/common/Drawer';
import Modal from '@/components/common/Modal';
import Table from '@/components/common/Table';
import type { Column } from '@/components/common/Table';
import Button from '@/components/common/Button';
import { formatDate, formatDateTime } from '@/utils/format';
import styles from './ReturnOrderPage.module.css';

type ReturnStatus = '' | 'draft' | 'confirmed' | 'shipped' | 'completed' | 'cancelled';
type ReturnType = '' | 'purchase_return' | 'production_return';

const STATUS_LABEL: Record<Exclude<ReturnStatus, ''>, string> = {
  draft: '待确认',
  confirmed: '待发出',
  shipped: '已发出',
  completed: '已完成',
  cancelled: '已取消',
};

const TYPE_LABEL: Record<Exclude<ReturnType, ''>, string> = {
  purchase_return: '采购退货',
  production_return: '生产退货',
};

const EMPTY_RETURN_ORDERS: ReturnOrder[] = [];

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatQty(value?: string | number | null): string {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return '0';
  return Number.isInteger(parsed) ? String(parsed) : parsed.toFixed(4);
}

function formatMoney(value?: string | number | null): string {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return '¥0.00';
  return `¥${parsed.toFixed(2)}`;
}

function getStatusTone(status?: string | null): string {
  if (!status) return styles.statusDraft;
  return {
    draft: styles.statusDraft,
    confirmed: styles.statusConfirmed,
    shipped: styles.statusShipped,
    completed: styles.statusCompleted,
    cancelled: styles.statusCancelled,
  }[status] ?? styles.statusDraft;
}

function buildTimeline(record: ReturnOrder | null | undefined) {
  if (!record) return [];
  return [
    record.createdAt ? {
      key: 'created',
      label: '退货单创建',
      time: record.createdAt,
      note: `${record.returnNo} 已创建`,
    } : null,
    record.confirmedAt ? {
      key: 'confirmed',
      label: '退货确认',
      time: record.confirmedAt,
      note: '已进入待发出阶段',
    } : null,
    record.shippedAt ? {
      key: 'shipped',
      label: '退货发出',
      time: record.shippedAt,
      note: '货物已发出，等待完成回执',
    } : null,
    record.completedAt ? {
      key: 'completed',
      label: '退货完成',
      time: record.completedAt,
      note: '本次退货流程已闭环',
    } : null,
  ].filter(Boolean) as Array<{ key: string; label: string; time: string; note: string }>;
}

function buildPrintDocument(record: ReturnOrder, timeline: Array<{ key: string; label: string; time: string; note: string }>): string {
  const items = (record.items ?? []).map((item) => item as ReturnOrderItem);
  const itemRows = items.map((item) => `
    <tr>
      <td>${escapeHtml(item.skuCode ?? '—')}</td>
      <td>${escapeHtml(item.skuName ?? '—')}</td>
      <td>${escapeHtml(formatQty(item.qtyReturn))}</td>
      <td>${escapeHtml(item.purchaseUnit ?? '—')}</td>
      <td>${escapeHtml(formatMoney(item.unitPrice))}</td>
      <td>${escapeHtml(formatMoney(item.amount))}</td>
      <td>${escapeHtml(item.defectReason ?? '—')}</td>
    </tr>
  `).join('');
  const timelineRows = timeline.map((node) => `
    <div class="timeline-row">
      <div class="timeline-label">${escapeHtml(node.label)}</div>
      <div class="timeline-time">${escapeHtml(formatDateTime(node.time))}</div>
      <div class="timeline-note">${escapeHtml(node.note)}</div>
    </div>
  `).join('');

  return `<!doctype html>
  <html lang="zh-CN">
    <head>
      <meta charset="UTF-8" />
      <title>退货单打印 - ${escapeHtml(record.returnNo)}</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 24px; color: #0f172a; }
        .sheet { display: grid; gap: 20px; }
        .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #0f172a; padding-bottom: 16px; }
        .eyebrow { font-size: 12px; letter-spacing: 0.18em; text-transform: uppercase; color: #b45309; margin-bottom: 8px; }
        .title { font-size: 30px; font-weight: 800; margin: 0; }
        .sub { margin-top: 8px; color: #475569; font-size: 13px; }
        .badge { display: inline-flex; min-height: 28px; align-items: center; padding: 0 12px; border-radius: 999px; background: #fef3c7; color: #92400e; font-weight: 700; font-size: 12px; }
        .meta-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
        .meta-card { border: 1px solid #cbd5e1; border-radius: 14px; padding: 14px; display: grid; gap: 6px; }
        .meta-card span { font-size: 12px; color: #64748b; }
        .meta-card strong { font-size: 14px; word-break: break-word; }
        .meta-card.full { grid-column: 1 / -1; }
        .section-title { margin: 0 0 10px; font-size: 16px; font-weight: 800; }
        .reason-block { border: 1px solid #fecaca; background: #fff7f7; border-radius: 14px; padding: 16px; display: grid; gap: 8px; }
        .reason-title { font-size: 12px; color: #991b1b; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; }
        .reason-main { font-size: 16px; font-weight: 700; color: #7f1d1d; }
        .reason-note { font-size: 13px; color: #7f1d1d; line-height: 1.6; }
        table { width: 100%; border-collapse: collapse; }
        th, td { border: 1px solid #cbd5e1; padding: 10px 12px; text-align: left; vertical-align: top; font-size: 13px; }
        th { background: #f8fafc; }
        .timeline { display: grid; gap: 10px; }
        .timeline-row { display: grid; grid-template-columns: 140px 180px 1fr; gap: 12px; border-bottom: 1px dashed #cbd5e1; padding-bottom: 10px; }
        .timeline-label { font-weight: 700; }
        .timeline-time { color: #475569; }
        .timeline-note { color: #334155; }
        .footer { display: flex; justify-content: space-between; align-items: center; margin-top: 8px; color: #64748b; font-size: 12px; }
        @media print { body { margin: 16px; } .footer { position: fixed; bottom: 0; left: 0; right: 0; } }
      </style>
    </head>
    <body>
      <div class="sheet">
        <section class="header">
          <div>
            <div class="eyebrow">Return Order Print</div>
            <h1 class="title">退货单 ${escapeHtml(record.returnNo)}</h1>
            <div class="sub">用于对外打印退货明细、退货原因和关键节点，便于仓库、采购和供应商沟通。</div>
          </div>
          <div class="badge">${escapeHtml(STATUS_LABEL[record.status as Exclude<ReturnStatus, ''>] ?? record.status ?? '—')}</div>
        </section>

        <section>
          <h2 class="section-title">基本信息</h2>
          <div class="meta-grid">
            <div class="meta-card"><span>供应商</span><strong>${escapeHtml(record.supplierName ?? '—')}</strong></div>
            <div class="meta-card"><span>退货类型</span><strong>${escapeHtml(TYPE_LABEL[record.returnType as Exclude<ReturnType, ''>] ?? record.returnType ?? '—')}</strong></div>
            <div class="meta-card"><span>采购单号</span><strong>${escapeHtml(record.poNo ?? '—')}</strong></div>
            <div class="meta-card"><span>质检单号</span><strong>${escapeHtml(record.inspectionNo ?? '—')}</strong></div>
            <div class="meta-card"><span>退货数量</span><strong>${escapeHtml(formatQty(record.totalQty))}</strong></div>
            <div class="meta-card"><span>退货金额</span><strong>${escapeHtml(formatMoney(record.totalAmount))}</strong></div>
            <div class="meta-card"><span>创建时间</span><strong>${escapeHtml(formatDateTime(record.createdAt ?? ''))}</strong></div>
            <div class="meta-card"><span>完成时间</span><strong>${escapeHtml(formatDateTime(record.completedAt ?? ''))}</strong></div>
          </div>
        </section>

        <section class="reason-block">
          <div class="reason-title">退货原因</div>
          <div class="reason-main">${escapeHtml(record.returnReason ?? '—')}</div>
          <div class="reason-note">${escapeHtml(record.notes || '暂无补充说明')}</div>
        </section>

        <section>
          <h2 class="section-title">退货明细</h2>
          <table>
            <thead>
              <tr>
                <th>SKU编码</th>
                <th>物料名称</th>
                <th>退货数量</th>
                <th>单位</th>
                <th>单价</th>
                <th>金额</th>
                <th>缺陷原因</th>
              </tr>
            </thead>
            <tbody>${itemRows || '<tr><td colspan="7">暂无退货明细</td></tr>'}</tbody>
          </table>
        </section>

        <section>
          <h2 class="section-title">关键节点</h2>
          <div class="timeline">${timelineRows || '<div class="timeline-note">暂无节点记录</div>'}</div>
        </section>

        <div class="footer">
          <span>打印时间：${escapeHtml(formatDateTime(new Date().toISOString()))}</span>
          <span>退货单号：${escapeHtml(record.returnNo)}</span>
        </div>
      </div>
      <script>
        window.onload = function () {
          window.print();
        };
      </script>
    </body>
  </html>`;
}

function ActionButtons({
  record,
  onConfirm,
  onShip,
  onComplete,
  confirmLoading,
  shipLoading,
  completeLoading,
}: {
  record: ReturnOrder;
  onConfirm: (record: ReturnOrder) => void;
  onShip: (record: ReturnOrder) => void;
  onComplete: (record: ReturnOrder) => void;
  confirmLoading: boolean;
  shipLoading: boolean;
  completeLoading: boolean;
}) {
  if (record.status === 'draft') {
    return (
      <Button size="sm" loading={confirmLoading} onClick={() => onConfirm(record)}>
        确认退货
      </Button>
    );
  }
  if (record.status === 'confirmed') {
    return (
      <Button size="sm" loading={shipLoading} onClick={() => onShip(record)}>
        发出退货
      </Button>
    );
  }
  if (record.status === 'shipped') {
    return (
      <Button size="sm" variant="success" loading={completeLoading} onClick={() => onComplete(record)}>
        完成退货
      </Button>
    );
  }
  return <span className={styles.actionHint}>已归档</span>;
}

export default function ReturnOrderPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const setPageTitle = useAppStore((state) => state.setPageTitle);
  const showToast = useAppStore((state) => state.showToast);
  const returnIdParam = Number(searchParams.get('returnId') ?? '') || null;
  const sourcePoIdParam = Number(searchParams.get('poId') ?? '') || null;
  const sourceInspectionIdParam = Number(searchParams.get('inspectionId') ?? '') || null;

  const [statusFilter, setStatusFilter] = useState<ReturnStatus>('');
  const [typeFilter, setTypeFilter] = useState<ReturnType>('');
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [shipTarget, setShipTarget] = useState<ReturnOrder | null>(null);
  const [completeTarget, setCompleteTarget] = useState<ReturnOrder | null>(null);
  const [trackingNo, setTrackingNo] = useState('');
  const [shipNotes, setShipNotes] = useState('');
  const [shipWarehouseId, setShipWarehouseId] = useState<number | ''>('');
  const [shipLocationId, setShipLocationId] = useState<number | ''>('');
  const [completeNotes, setCompleteNotes] = useState('');

  const { data, isLoading } = useReturnOrderList({
    status: statusFilter || undefined,
    returnType: typeFilter || undefined,
    sourcePoId: sourcePoIdParam ?? undefined,
    sourceInspectionId: sourceInspectionIdParam ?? undefined,
    keyword: keyword.trim() || undefined,
    page,
    pageSize: 20,
  });
  const { data: detail, isLoading: detailLoading } = useReturnOrderDetail(selectedId);
  const { data: sourcePoDetail } = usePurchaseOrderDetail(sourcePoIdParam);
  const { data: sourceInspectionDetail } = useInspectionDetail(sourceInspectionIdParam);
  const confirmMutation = useConfirmReturnOrder();
  const shipMutation = useShipReturnOrder();
  const completeMutation = useCompleteReturnOrder();
  const { data: warehouseOptions = [] } = useWarehouseOptions(true);
  const { data: locationOptions = [] } = useLocationOptions(
    shipWarehouseId === '' ? undefined : Number(shipWarehouseId),
    true,
  );

  useEffect(() => {
    setPageTitle('退货管理');
  }, [setPageTitle]);

  useEffect(() => {
    if (!returnIdParam) return;
    setSelectedId(returnIdParam);
  }, [returnIdParam]);

  const list = (data?.list ?? EMPTY_RETURN_ORDERS) as ReturnOrder[];
  const total = Number(data?.total ?? 0);

  const summary = useMemo(() => {
    const totalQty = list.reduce((sum, record) => sum + Number(record.totalQty ?? 0), 0);
    const totalAmount = list.reduce((sum, record) => sum + Number(record.totalAmount ?? 0), 0);
    return {
      total: total || list.length,
      pending: list.filter((record) => record.status === 'draft' || record.status === 'confirmed').length,
      shipped: list.filter((record) => record.status === 'shipped').length,
      completed: list.filter((record) => record.status === 'completed').length,
      totalQty,
      totalAmount,
    };
  }, [list, total]);

  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (selectedId) {
      next.set('returnId', String(selectedId));
    } else {
      next.delete('returnId');
    }
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, selectedId, setSearchParams]);

  const openDrawer = useCallback((id: number) => {
    setSelectedId(id);
  }, []);

  const handleConfirm = useCallback(async (record: ReturnOrder) => {
    try {
      await confirmMutation.mutateAsync(record.id);
      showToast({ type: 'success', message: `退货单 ${record.returnNo} 已确认` });
    } catch (error) {
      showToast({ type: 'error', message: (error as Error).message || '确认退货失败' });
    }
  }, [confirmMutation, showToast]);

  const activeFilters = useMemo(() => {
    const filters: Array<{ key: 'poId' | 'inspectionId'; label: string }> = [];
    if (sourcePoIdParam) {
      const resolvedPoNo = list.find((record) => Number(record.sourcePoId) === sourcePoIdParam)?.poNo
        ?? sourcePoDetail?.poNo;
      filters.push({
        key: 'poId',
        label: resolvedPoNo ? `采购单 ${resolvedPoNo}` : `采购单 #${sourcePoIdParam}`,
      });
    }
    if (sourceInspectionIdParam) {
      const resolvedInspectionNo = list.find((record) => Number(record.sourceInspectionId) === sourceInspectionIdParam)?.inspectionNo
        ?? sourceInspectionDetail?.inspectionNo;
      filters.push({
        key: 'inspectionId',
        label: resolvedInspectionNo ? `质检单 ${resolvedInspectionNo}` : `质检单 #${sourceInspectionIdParam}`,
      });
    }
    return filters;
  }, [list, sourceInspectionDetail?.inspectionNo, sourceInspectionIdParam, sourcePoDetail?.poNo, sourcePoIdParam]);

  const clearSearchParamFilter = useCallback((key: 'poId' | 'inspectionId') => {
    const next = new URLSearchParams(searchParams);
    next.delete(key);
    if (key === 'inspectionId') {
      next.delete('returnId');
      setSelectedId(null);
    }
    setPage(1);
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const openShipModal = useCallback((record: ReturnOrder) => {
    setShipTarget(record);
    setTrackingNo('');
    setShipNotes('');
    setShipWarehouseId('');
    setShipLocationId('');
  }, []);

  useEffect(() => {
    if (!shipTarget || warehouseOptions.length === 0 || shipWarehouseId !== '') return;
    setShipWarehouseId(Number(warehouseOptions[0].id));
  }, [shipTarget, warehouseOptions, shipWarehouseId]);

  useEffect(() => {
    if (!shipTarget) return;
    setShipLocationId('');
  }, [shipWarehouseId, shipTarget]);

  useEffect(() => {
    if (!shipTarget || locationOptions.length === 0 || shipLocationId !== '') return;
    setShipLocationId(Number(locationOptions[0].id));
  }, [shipTarget, locationOptions, shipLocationId]);

  const openCompleteModal = useCallback((record: ReturnOrder) => {
    setCompleteTarget(record);
    setCompleteNotes('');
  }, []);

  const submitShip = async () => {
    if (!shipTarget) return;
    if (shipWarehouseId === '' || shipLocationId === '') {
      showToast({ type: 'warning', message: '请选择仓库和库位' });
      return;
    }
    try {
      await shipMutation.mutateAsync({
        id: shipTarget.id,
        data: {
          trackingNo: trackingNo.trim() || undefined,
          notes: shipNotes.trim() || undefined,
          warehouseId: Number(shipWarehouseId),
          locationId: Number(shipLocationId),
        },
      });
      showToast({ type: 'success', message: `退货单 ${shipTarget.returnNo} 已标记发出` });
      setShipTarget(null);
      setTrackingNo('');
      setShipNotes('');
      setShipWarehouseId('');
      setShipLocationId('');
    } catch (error) {
      showToast({ type: 'error', message: (error as Error).message || '标记发出失败' });
    }
  };

  const submitComplete = async () => {
    if (!completeTarget) return;
    try {
      await completeMutation.mutateAsync({
        id: completeTarget.id,
        data: {
          notes: completeNotes.trim() || undefined,
        },
      });
      showToast({ type: 'success', message: `退货单 ${completeTarget.returnNo} 已完成` });
      setCompleteTarget(null);
      setCompleteNotes('');
    } catch (error) {
      showToast({ type: 'error', message: (error as Error).message || '完成退货失败' });
    }
  };

  const columns: Column<ReturnOrder>[] = useMemo(() => [
    {
      key: 'returnNo',
      title: '退货单',
      width: 170,
      render: (_, record) => (
        <div className={styles.primaryCell}>
          <button className={styles.linkButton} onClick={() => openDrawer(record.id)}>
            {record.returnNo}
          </button>
          <span className={styles.subtleText}>{TYPE_LABEL[record.returnType] ?? record.returnType}</span>
        </div>
      ),
    },
    {
      key: 'supplierName',
      title: '来源单据',
      width: 230,
      render: (_, record) => (
        <div className={styles.sourceCell}>
          <strong>{record.supplierName ?? '—'}</strong>
          <span>采购单：{record.poNo ?? '—'}</span>
          <span>质检单：{record.inspectionNo ?? '—'}</span>
        </div>
      ),
    },
    {
      key: 'totalQty',
      title: '退货规模',
      width: 180,
      render: (_, record) => (
        <div className={styles.metricCell}>
          <strong>{formatQty(record.totalQty)}</strong>
          <span>{formatMoney(record.totalAmount)} / {record.itemCount ?? 0} 条明细</span>
        </div>
      ),
    },
    {
      key: 'returnReason',
      title: '退货原因',
      width: 260,
      render: (_, record) => (
        <div className={styles.reasonCell}>
          <div>{record.returnReason}</div>
          <span>{record.notes || '暂无补充说明'}</span>
        </div>
      ),
    },
    {
      key: 'status',
      title: '节点',
      width: 120,
      render: (_, record) => (
        <span className={`${styles.statusBadge} ${getStatusTone(record.status)}`}>
          {STATUS_LABEL[record.status] ?? record.status}
        </span>
      ),
    },
    {
      key: 'createdAt',
      title: '时间',
      width: 180,
      render: (_, record) => (
        <div className={styles.timeCell}>
          <strong>{formatDate(record.createdAt ?? '')}</strong>
          <span>{record.completedAt ? `完成：${formatDateTime(record.completedAt)}` : '流程进行中'}</span>
        </div>
      ),
    },
    {
      key: 'id',
      title: '操作',
      width: 170,
      render: (_, record) => (
        <div className={styles.actionRow}>
          <Button size="sm" variant="text" onClick={() => openDrawer(record.id)}>
            详情
          </Button>
          <ActionButtons
            record={record}
            onConfirm={() => void handleConfirm(record)}
            onShip={openShipModal}
            onComplete={openCompleteModal}
            confirmLoading={confirmMutation.isPending}
            shipLoading={shipMutation.isPending}
            completeLoading={completeMutation.isPending}
          />
        </div>
      ),
    },
  ], [
    completeMutation.isPending,
    confirmMutation.isPending,
    handleConfirm,
    openCompleteModal,
    openDrawer,
    openShipModal,
    shipMutation.isPending,
  ]);

  const activeRecord = detail ?? list.find((record) => record.id === selectedId) ?? null;
  const timeline = buildTimeline(activeRecord);

  const handlePrint = (record: ReturnOrder | null) => {
    if (!record) return;
    const printWindow = window.open('', '_blank', 'noopener,noreferrer,width=980,height=760');
    if (!printWindow) {
      showToast({ type: 'warning', message: '浏览器阻止了打印窗口，请允许弹窗后重试' });
      return;
    }
    printWindow.document.open();
    printWindow.document.write(buildPrintDocument(record, buildTimeline(record)));
    printWindow.document.close();
    showToast({ type: 'success', message: `退货单 ${record.returnNo} 已打开打印页` });
  };

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div>
          <div className={styles.eyebrow}>Return Operations</div>
          <h1 className={styles.title}>退货管理中台</h1>
          <p className={styles.subtitle}>统一管理采购不合格退货、发出节点、完成回执和来源质检上下文，避免退货链路脱节。</p>
        </div>
        <div className={styles.heroMetrics}>
          <div className={styles.heroMetric}>
            <span>待处理退货</span>
            <strong>{summary.pending}</strong>
          </div>
          <div className={styles.heroMetric}>
            <span>退货总金额</span>
            <strong>{formatMoney(summary.totalAmount)}</strong>
          </div>
        </div>
      </section>

      <section className={styles.summaryGrid}>
        <article className={styles.summaryCard}>
          <span>退货单总数</span>
          <strong>{summary.total}</strong>
          <p>当前筛选范围内的全部退货单。</p>
        </article>
        <article className={styles.summaryCard}>
          <span>待确认 / 待发出</span>
          <strong>{summary.pending}</strong>
          <p>需要主管或仓库继续推进的节点。</p>
        </article>
        <article className={styles.summaryCard}>
          <span>运输途中</span>
          <strong>{summary.shipped}</strong>
          <p>已发出但还未完成回执的退货。</p>
        </article>
        <article className={styles.summaryCard}>
          <span>已完成</span>
          <strong>{summary.completed}</strong>
          <p>已经闭环，可用于追溯和结案。</p>
        </article>
        <article className={styles.summaryCard}>
          <span>退货总数量</span>
          <strong>{formatQty(summary.totalQty)}</strong>
          <p>当前列表合计退货数量。</p>
        </article>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <div>
            <div className={styles.panelTitle}>退货任务看板</div>
            <div className={styles.panelDesc}>按状态、类型和关键字快速定位退货单，并在详情抽屉里完成确认、发出和完结操作。</div>
          </div>
          <div className={styles.filterStack}>
            <input
              className={styles.searchInput}
              value={keyword}
              onChange={(event) => {
                setKeyword(event.target.value);
                setPage(1);
              }}
              placeholder="退货单号 / 采购单号 / 质检单号 / 供应商"
            />
            <select
              className={styles.select}
              value={typeFilter}
              onChange={(event) => {
                setTypeFilter(event.target.value as ReturnType);
                setPage(1);
              }}
            >
              <option value="">全部类型</option>
              <option value="purchase_return">采购退货</option>
              <option value="production_return">生产退货</option>
            </select>
            <select
              className={styles.select}
              value={statusFilter}
              onChange={(event) => {
                setStatusFilter(event.target.value as ReturnStatus);
                setPage(1);
              }}
            >
              <option value="">全部状态</option>
              <option value="draft">待确认</option>
              <option value="confirmed">待发出</option>
              <option value="shipped">已发出</option>
              <option value="completed">已完成</option>
              <option value="cancelled">已取消</option>
            </select>
          </div>
        </div>

        <div className={styles.segmentRow}>
          {[
            { value: '', label: '全部' },
            { value: 'draft', label: '待确认' },
            { value: 'confirmed', label: '待发出' },
            { value: 'shipped', label: '已发出' },
            { value: 'completed', label: '已完成' },
          ].map((option) => (
            <button
              key={option.value || 'all'}
              className={`${styles.segment} ${statusFilter === option.value ? styles.segmentActive : ''}`}
              onClick={() => {
                setStatusFilter(option.value as ReturnStatus);
                setPage(1);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>

        {activeFilters.length ? (
          <div className={styles.activeFilters} aria-label="当前来源筛选">
            {activeFilters.map((filter) => (
              <button
                key={filter.key}
                type="button"
                className={styles.activeFilterChip}
                onClick={() => clearSearchParamFilter(filter.key)}
              >
                <span>{filter.label}</span>
                <span aria-hidden="true">×</span>
              </button>
            ))}
          </div>
        ) : null}

        <Table<ReturnOrder>
          columns={columns}
          dataSource={list}
          rowKey="id"
          loading={isLoading}
          pagination={{ page, pageSize: 20, total, onChange: setPage }}
          emptyText={activeFilters.length ? '当前来源单据下暂无退货单' : '暂无退货单'}
        />
      </section>

      <Drawer
        open={selectedId !== null}
        onClose={() => setSelectedId(null)}
        title={`退货详情${activeRecord?.returnNo ? ` - ${activeRecord.returnNo}` : ''}`}
        width={860}
        footer={(
          <div className={styles.drawerFooter}>
            {activeRecord?.sourcePoId ? (
              <Button variant="text" onClick={() => navigate(`/purchase/orders?orderId=${activeRecord.sourcePoId}`)}>
                查看采购单
              </Button>
            ) : null}
            {activeRecord?.sourceInspectionId ? (
              <Button variant="text" onClick={() => navigate(`/purchase/incoming-inspection?inspectionId=${activeRecord.sourceInspectionId}`)}>
                查看来料质检
              </Button>
            ) : null}
            {activeRecord ? (
              <Button variant="text" onClick={() => handlePrint(activeRecord)}>
                打印退货单
              </Button>
            ) : null}
            {activeRecord ? (
              <ActionButtons
                record={activeRecord}
                onConfirm={() => void handleConfirm(activeRecord)}
                onShip={openShipModal}
                onComplete={openCompleteModal}
                confirmLoading={confirmMutation.isPending}
                shipLoading={shipMutation.isPending}
                completeLoading={completeMutation.isPending}
              />
            ) : null}
            <Button variant="ghost" onClick={() => setSelectedId(null)}>关闭</Button>
          </div>
        )}
      >
        {detailLoading || !activeRecord ? (
          <div className={styles.drawerLoading}>正在加载退货详情...</div>
        ) : (
          <div className={styles.drawerBody}>
            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>基本信息</h3>
              <div className={styles.metaGrid}>
                <div className={styles.kv}><span>退货单号</span><strong>{activeRecord.returnNo}</strong></div>
                <div className={styles.kv}><span>状态</span><strong>{STATUS_LABEL[activeRecord.status] ?? activeRecord.status}</strong></div>
                <div className={styles.kv}><span>供应商</span><strong>{activeRecord.supplierName ?? '—'}</strong></div>
                <div className={styles.kv}><span>退货类型</span><strong>{TYPE_LABEL[activeRecord.returnType] ?? activeRecord.returnType}</strong></div>
                <div className={styles.kv}><span>采购单</span><strong>{activeRecord.poNo ?? '—'}</strong></div>
                <div className={styles.kv}><span>质检单</span><strong>{activeRecord.inspectionNo ?? '—'}</strong></div>
                <div className={styles.kv}><span>退货数量</span><strong>{formatQty(activeRecord.totalQty)}</strong></div>
                <div className={styles.kv}><span>退货金额</span><strong>{formatMoney(activeRecord.totalAmount)}</strong></div>
                <div className={styles.kv}><span>创建时间</span><strong>{formatDateTime(activeRecord.createdAt ?? '')}</strong></div>
                <div className={styles.kv}><span>完成时间</span><strong>{formatDateTime(activeRecord.completedAt ?? '')}</strong></div>
                <div className={`${styles.kv} ${styles.kvFull}`}><span>退货原因</span><strong>{activeRecord.returnReason}</strong></div>
                {activeRecord.notes ? (
                  <div className={`${styles.kv} ${styles.kvFull}`}><span>备注</span><strong>{activeRecord.notes}</strong></div>
                ) : null}
              </div>
            </section>

            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>关键节点</h3>
              {timeline.length ? (
                <div className={styles.timeline}>
                  {timeline.map((node) => (
                    <div key={node.key} className={styles.timelineItem}>
                      <div className={styles.timelineDot} />
                      <div className={styles.timelineContent}>
                        <div className={styles.timelineTop}>
                          <strong>{node.label}</strong>
                          <span>{formatDateTime(node.time)}</span>
                        </div>
                        <div className={styles.timelineNote}>{node.note}</div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className={styles.emptyHint}>暂无节点记录</div>
              )}
            </section>

            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>退货明细</h3>
              <div className={styles.itemList}>
                {(activeRecord.items ?? []).map((item) => {
                  const row = item as ReturnOrderItem;
                  return (
                    <article key={row.id} className={styles.itemCard}>
                      <div className={styles.itemHeader}>
                        <div>
                          <div className={styles.itemCode}>{row.skuCode ?? '—'}</div>
                          <strong>{row.skuName ?? '—'}</strong>
                        </div>
                        <div className={styles.itemAmount}>{formatMoney(row.amount)}</div>
                      </div>
                      <div className={styles.itemMeta}>
                        <span>退货数量：{formatQty(row.qtyReturn)}</span>
                        <span>单位：{row.purchaseUnit}</span>
                        <span>单价：{formatMoney(row.unitPrice)}</span>
                        <span>缺陷原因：{row.defectReason ?? '—'}</span>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          </div>
        )}
      </Drawer>

      <Modal
        open={shipTarget !== null}
        onClose={() => {
          setShipTarget(null);
          setShipWarehouseId('');
          setShipLocationId('');
        }}
        onConfirm={() => void submitShip()}
        confirmLabel="确认发出"
        confirmLoading={shipMutation.isPending}
        title={shipTarget ? `发出退货单 - ${shipTarget.returnNo}` : '发出退货单'}
        size="md"
      >
        <div className={styles.formGrid}>
          <label className={styles.formField}>
            <span>物流单号</span>
            <input
              className={styles.formInput}
              value={trackingNo}
              onChange={(event) => setTrackingNo(event.target.value)}
              placeholder="选填，记录发出物流单号"
            />
          </label>
          <label className={styles.formField}>
            <span>发出仓库</span>
            <select
              className={styles.select}
              value={shipWarehouseId === '' ? '' : String(shipWarehouseId)}
              onChange={(event) => {
                const nextValue = event.target.value;
                setShipWarehouseId(nextValue ? Number(nextValue) : '');
              }}
            >
              <option value="">请选择仓库</option>
              {warehouseOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.code} · {option.name}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.formField}>
            <span>发出库位</span>
            <select
              className={styles.select}
              value={shipLocationId === '' ? '' : String(shipLocationId)}
              onChange={(event) => {
                const nextValue = event.target.value;
                setShipLocationId(nextValue ? Number(nextValue) : '');
              }}
              disabled={shipWarehouseId === ''}
            >
              <option value="">
                {shipWarehouseId === '' ? '请先选择仓库' : '请选择库位'}
              </option>
              {locationOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.code} · {option.name}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.formField}>
            <span>发出备注</span>
            <textarea
              className={styles.formTextarea}
              rows={4}
              value={shipNotes}
              onChange={(event) => setShipNotes(event.target.value)}
              placeholder="可填写发出车次、打包情况、承运信息"
            />
          </label>
        </div>
      </Modal>

      <Modal
        open={completeTarget !== null}
        onClose={() => setCompleteTarget(null)}
        onConfirm={() => void submitComplete()}
        confirmLabel="确认完成"
        confirmLoading={completeMutation.isPending}
        title={completeTarget ? `完成退货单 - ${completeTarget.returnNo}` : '完成退货单'}
        size="md"
      >
        <div className={styles.formGrid}>
          <label className={styles.formField}>
            <span>完成备注</span>
            <textarea
              className={styles.formTextarea}
              rows={4}
              value={completeNotes}
              onChange={(event) => setCompleteNotes(event.target.value)}
              placeholder="可填写签收结果、回执说明或异常备注"
            />
          </label>
        </div>
      </Modal>
    </div>
  );
}
