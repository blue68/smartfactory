/**
 * [artifact:前端代码] — 生产工单管理页面 (R-10)
 * 对齐 design-production-order-v2.html 紧凑布局
 */
import { useState, useCallback, useMemo } from 'react';
import {
  useProductionOrderList,
  useProductionOrderDetail,
  useProductionOrderComponents,
  useProductionOrderOperations,
  useCreateFromSalesOrder,
  useMaterialRequirements,
  useCancelOrder,
  type ProductionOrderComponent,
  type ProductionOrderOperation,
} from '@/api/production';
import { fetchSalesOrders } from '@/api/salesOrder';
import type { MaterialRequirement } from '@/api/production';
import { useShortageSummary, useGenerateMrpSuggestions } from '@/api/mrp';
import Modal from '@/components/common/Modal';
import Button from '@/components/common/Button';
import Drawer from '@/components/common/Drawer';
import { useAppStore } from '@/stores/appStore';
import styles from './ProductionOrderPage.module.css';

// ── Types ──────────────────────────────────────────────────────────

interface OrderRow {
  id: number;
  workOrderNo: string;
  salesOrderNo: string;
  skuName: string;
  qtyPlanned: string;
  qtyCompleted: string;
  status: string;
  plannedStart: string;
  plannedEnd: string;
  progressPct: number;
  materialStatus?: string;
  [key: string]: unknown;
}

type MaterialRow = MaterialRequirement;
type ComponentRow = ProductionOrderComponent;
type OperationRow = ProductionOrderOperation;
const EMPTY_ORDER_ROWS: OrderRow[] = [];

// ── Constants ──────────────────────────────────────────────────────

const STATUS_MAP: Record<string, { label: string; cls: string; dot?: string }> = {
  pending:     { label: '待排产', cls: styles.badgePending },
  scheduled:   { label: '已排产', cls: styles.badgeScheduled },
  in_progress: { label: '生产中', cls: styles.badgeInProgress, dot: '● ' },
  completed:   { label: '已完工', cls: styles.badgeCompleted },
  cancelled:   { label: '已取消', cls: styles.badgeCancelled },
};

// 左边框颜色映射
function cardBorderClass(status: string): string {
  switch (status) {
    case 'in_progress': return styles['card--normal'];
    case 'scheduled':   return styles['card--warning'];
    case 'pending':     return styles['card--pending'];
    case 'completed':   return styles['card--completed'];
    default:            return styles['card--pending'];
  }
}

// 进度 pill 颜色 tier
function progressTier(pct: number): 'high' | 'medium' | 'low' {
  if (pct >= 80) return 'high';
  if (pct >= 40) return 'medium';
  return 'low';
}

// 旧进度条（Drawer 内使用）
function progressClass(pct: number): string {
  if (pct >= 80) return styles['progress--normal'];
  if (pct >= 40) return styles['progress--warning'];
  return styles['progress--danger'];
}

function escapeCsvField(value: unknown): string {
  const raw = String(value ?? '');
  if (/[",\n]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

function normalizeBusinessNo(value: string): string {
  return value.trim().toLowerCase();
}

function formatQty(value: number | string | null | undefined): string {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) return '0';
  return Number.isInteger(numeric) ? `${numeric}` : numeric.toFixed(2);
}

function componentTypeLabel(type: ComponentRow['componentType']): string {
  switch (type) {
    case 'fg': return '成品';
    case 'wip': return '半成品';
    case 'rm': return '原材料';
    default: return '组件';
  }
}

// ── Progress Pill 内联组件 ──────────────────────────────────────────

function ProgressPill({ pct }: { pct: number }) {
  const tier = progressTier(pct);
  return (
    <div className={styles.orderCard__progressPill}>
      <div className={styles.progressPillWrap}>
        <div className={styles.progressPillLabel}>进度</div>
        <div className={styles.progressPillTrack}>
          <div
            className={`${styles.progressPillFill} ${styles[`progressFill--${tier}`]}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
      <span className={`${styles.progressPillPct} ${styles[`progressPillPct--${tier}`]}`}>
        {pct}%
      </span>
    </div>
  );
}

// ── BOM 状态条 ─────────────────────────────────────────────────────

function BomStatusBar({ materialStatus }: { materialStatus?: string }) {
  if (!materialStatus || materialStatus === 'unchecked') return null;
  const cfg: Record<string, { cls: string; text: string }> = {
    ready:    { cls: styles['bomBar--ready'],    text: '物料全部齐套，生产正常推进' },
    partial:  { cls: styles['bomBar--partial'],  text: '物料部分缺失，请关注采购进度' },
    shortage: { cls: styles['bomBar--shortage'], text: '严重缺料，需立即发起采购' },
  };
  const item = cfg[materialStatus];
  if (!item) return null;
  return (
    <div className={`${styles.bomBar} ${item.cls}`}>
      <span className={styles.bomBarDot} />
      <span>{item.text}</span>
    </div>
  );
}

// ── 物料需求表格（替代 Table 组件，对齐设计规范）─────────────────────

function MaterialTable({ materials }: { materials: MaterialRow[] }) {
  if (!materials.length) {
    return <div style={{ color: '#9ca3af', fontSize: '0.875rem', textAlign: 'center', padding: '2rem 0' }}>暂无物料需求数据</div>;
  }
  return (
    <div style={{ overflowX: 'auto', border: '1px solid #E2E8F0', borderRadius: 10, boxShadow: '0 1px 2px rgba(15,23,42,.04)' }}>
      <table className={styles.bomTable}>
        <thead>
          <tr>
            <th className={styles.colCode}>SKU编码</th>
            <th className={styles.colName}>SKU名称</th>
            <th className={styles.colUnit}>采购单位</th>
            <th className={`${styles.colNum} ${styles.alignRight}`}>需求量</th>
            <th className={`${styles.colNum} ${styles.alignRight}`}>可用库存</th>
            <th className={`${styles.colNum} ${styles.alignRight}`}>在途</th>
            <th className={`${styles.colNum} ${styles.alignRight}`}>缺口</th>
            <th className={styles.colStatus}>状态</th>
          </tr>
        </thead>
        <tbody>
          {materials.map((m) => {
            const shortage = Number(m.qtyShortage);
            const statusLabel = m.status === 'fulfilled' ? '充足' : m.status === 'partial' ? '部分' : '缺料';
            const statusCls = m.status === 'fulfilled'
              ? styles.badgeTableFulfilled
              : m.status === 'partial'
              ? styles.badgeTablePartial
              : styles.badgeTableShortage;
            return (
              <tr key={m.id}>
                <td className={styles.colCode}>
                  <span className={styles.matCode}>{m.skuCode}</span>
                </td>
                <td className={styles.colName}>
                  <span className={styles.matName}>{m.skuName}</span>
                </td>
                <td className={styles.colUnit}>{m.purchaseUnit ?? '—'}</td>
                <td className={styles.colNum}>{m.qtyRequired}</td>
                <td className={styles.colNum}>{m.currentStock}</td>
                <td className={styles.colNum}>{m.inTransit}</td>
                <td className={styles.colNum}>
                  {shortage > 0
                    ? <span className={styles.shortagePositive}>{m.qtyShortage}</span>
                    : <span className={styles.shortageZero}>{m.qtyShortage}</span>
                  }
                </td>
                <td className={styles.colStatus}>
                  <span className={statusCls}>{statusLabel}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── 工艺快照组件 ────────────────────────────────────────────────────

interface SnapshotStep {
  stepNo: number;
  name: string;
  workstationType?: string;
  standardHours?: number | string;
  maxHours?: number | string;
}

function ProcessSnapshot({ detail }: { detail: Record<string, unknown> }) {
  const snapshot = detail.processSnapshot as { templateName?: string; snapshotAt?: string; steps?: SnapshotStep[] } | null | undefined;

  if (!snapshot) {
    return (
      <div className={styles.emptySnapshot}>
        <div className={styles.emptySnapshot__icon}>📷</div>
        <div className={styles.emptySnapshot__title}>暂无工艺快照</div>
        <div className={styles.emptySnapshot__desc}>工单下发后，系统将自动锁定当时的工序模板作为工艺快照</div>
      </div>
    );
  }

  return (
    <div>
      <div className={styles.snapshotBanner}>
        <strong>模板：</strong>{snapshot.templateName ?? '—'}
        {snapshot.snapshotAt && (
          <span style={{ marginLeft: '1rem', color: '#64748b' }}>
            快照时间：{new Date(snapshot.snapshotAt).toLocaleString('zh-CN')}
          </span>
        )}
      </div>
      {snapshot.steps && snapshot.steps.length > 0 ? (
        <table className={styles.bomTable}>
          <thead>
            <tr>
              <th>序号</th>
              <th>工序名称</th>
              <th>工种</th>
              <th className={styles.alignRight}>标准工时(h)</th>
              <th className={styles.alignRight}>极限工时(h)</th>
            </tr>
          </thead>
          <tbody>
            {snapshot.steps.map((s) => (
              <tr key={s.stepNo}>
                <td style={{ color: '#94a3b8', fontFamily: 'monospace' }}>{s.stepNo}</td>
                <td style={{ fontWeight: 500 }}>{s.name}</td>
                <td style={{ color: '#475569' }}>{s.workstationType ?? '—'}</td>
                <td style={{ textAlign: 'right', color: '#475569' }}>{s.standardHours ?? '—'}</td>
                <td style={{ textAlign: 'right', color: '#475569' }}>{s.maxHours ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div style={{ color: '#9ca3af', fontSize: '0.875rem', textAlign: 'center', padding: '1rem' }}>快照中无工序步骤</div>
      )}
    </div>
  );
}

interface OrderTaskLite {
  id: number;
  taskNo?: string;
  operationId?: number | null;
  processStepId?: number;
  status?: string;
  workerName?: string;
  taskDate?: string;
  completedQty?: string;
}

function ComponentStructure({ components }: { components: ComponentRow[] }) {
  if (!components.length) {
    return (
      <div className={styles.emptySnapshot}>
        <div className={styles.emptySnapshot__icon}>🧩</div>
        <div className={styles.emptySnapshot__title}>尚未生成结构快照</div>
        <div className={styles.emptySnapshot__desc}>工单 release 后，这里会展示成品、半成品与原材料冻结结构</div>
      </div>
    );
  }

  const stats = components.reduce((acc, component) => {
    acc.total += 1;
    acc[component.componentType] += 1;
    if (component.resolvedSkuId && component.resolvedSkuId !== component.skuId) {
      acc.resolved += 1;
    }
    return acc;
  }, { total: 0, fg: 0, wip: 0, rm: 0, resolved: 0 });

  const childrenByParent = new Map<number | null, ComponentRow[]>();
  components.forEach((component) => {
    const key = component.parentComponentId ?? null;
    const bucket = childrenByParent.get(key) ?? [];
    bucket.push(component);
    childrenByParent.set(key, bucket);
  });

  const renderNodes = (parentId: number | null, depth = 0): React.ReactNode =>
    (childrenByParent.get(parentId) ?? []).map((component) => {
      const resolved = component.resolvedSkuId && component.resolvedSkuId !== component.skuId;
      return (
        <div key={component.id} className={styles.componentNode} style={{ '--component-depth': depth } as React.CSSProperties}>
          <div className={styles.componentNode__line} />
          <div className={styles.componentNode__card}>
            <div className={styles.componentNode__header}>
              <span className={`${styles.componentType} ${styles[`componentType--${component.componentType}`]}`}>
                {componentTypeLabel(component.componentType)}
              </span>
              <span className={styles.componentQty}>需求 {formatQty(component.qtyRequired)}</span>
            </div>
            <div className={styles.componentNode__title}>{component.skuName}</div>
            {resolved ? (
              <div className={styles.componentNode__resolved}>
                通配解析：{component.skuName} → {component.resolvedSkuName}
              </div>
            ) : (
              <div className={styles.componentNode__resolvedMuted}>
                冻结 SKU：{component.resolvedSkuName ?? component.skuName}
              </div>
            )}
            {component.bomPath && (
              <div className={styles.componentNode__path}>路径 {component.bomPath}</div>
            )}
          </div>
          {renderNodes(component.id, depth + 1)}
        </div>
      );
    });

  return (
    <div className={styles.structurePanel}>
      <div className={styles.structureStats}>
        <div className={styles.structureStat}>
          <strong>{stats.total}</strong>
          <span>冻结节点</span>
        </div>
        <div className={styles.structureStat}>
          <strong>{stats.wip}</strong>
          <span>半成品</span>
        </div>
        <div className={styles.structureStat}>
          <strong>{stats.rm}</strong>
          <span>原材料</span>
        </div>
        <div className={styles.structureStat}>
          <strong>{stats.resolved}</strong>
          <span>通配解析</span>
        </div>
      </div>
      <div className={styles.componentTree}>
        {renderNodes(null)}
      </div>
    </div>
  );
}

function OperationLane({
  operations,
  tasks,
}: {
  operations: OperationRow[];
  tasks: OrderTaskLite[];
}) {
  if (!operations.length) {
    return (
      <div className={styles.emptySnapshot}>
        <div className={styles.emptySnapshot__icon}>🛠</div>
        <div className={styles.emptySnapshot__title}>尚未生成工序链路</div>
        <div className={styles.emptySnapshot__desc}>release 后会在这里展示半成品工序、计划产出和任务落点</div>
      </div>
    );
  }

  return (
    <div className={styles.operationLane}>
      {operations.map((operation, index) => {
        const relatedTasks = tasks.filter((task) =>
          (task.operationId && task.operationId === operation.id)
          || (!task.operationId && task.processStepId === operation.processStepId)
        );
        const completePct = Math.min(
          100,
          Math.round((Number(operation.completedQty ?? 0) / Math.max(Number(operation.plannedQty ?? 0), 1)) * 100),
        );
        return (
          <div key={operation.id} className={styles.operationCard}>
            <div className={styles.operationCard__eyebrow}>
              <span>工序 {operation.stepNo}</span>
              <span className={`${styles.operationStatus} ${styles[`operationStatus--${operation.status}`] ?? ''}`}>
                {operation.status}
              </span>
            </div>
            <div className={styles.operationCard__title}>{operation.stepName}</div>
            <div className={styles.operationCard__sku}>
              产出 {operation.outputSkuName ?? '未配置半成品'}
            </div>
            <div className={styles.operationCard__metrics}>
              <div>
                <span>计划</span>
                <strong>{formatQty(operation.plannedQty)}</strong>
              </div>
              <div>
                <span>完成</span>
                <strong>{formatQty(operation.completedQty)}</strong>
              </div>
              <div>
                <span>任务</span>
                <strong>{relatedTasks.length}</strong>
              </div>
            </div>
            <div className={styles.operationCard__progress}>
              <div className={styles.operationCard__progressTrack}>
                <div className={styles.operationCard__progressFill} style={{ width: `${completePct}%` }} />
              </div>
              <span>{completePct}%</span>
            </div>
            {relatedTasks.length > 0 ? (
              <div className={styles.operationTaskList}>
                {relatedTasks.slice(0, 3).map((task) => (
                  <div key={task.id} className={styles.operationTask}>
                    <strong>{task.taskNo ?? `任务 #${task.id}`}</strong>
                    <span>{task.workerName || '待分配'} · {task.taskDate?.slice(0, 10) ?? '未排日'}</span>
                  </div>
                ))}
                {relatedTasks.length > 3 && (
                  <div className={styles.operationTaskMore}>还有 {relatedTasks.length - 3} 个任务</div>
                )}
              </div>
            ) : (
              <div className={styles.operationTaskMore}>尚未下发任务</div>
            )}
            {index < operations.length - 1 && <div className={styles.operationConnector}>→</div>}
          </div>
        );
      })}
    </div>
  );
}

// ── 主页面 ──────────────────────────────────────────────────────────

export default function ProductionOrderPage() {
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [keyword, setKeyword]           = useState('');
  const [page, setPage]                 = useState(1);
  const [selectedId, setSelectedId]     = useState<number | null>(null);
  const [drawerTab, setDrawerTab]       = useState<'info' | 'structure' | 'operations' | 'materials' | 'snapshot'>('info');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [salesOrderIdInput, setSalesOrderIdInput] = useState('');
  // 已成功发起采购的工单 ID 集合（localStorage 持久化，刷新不丢失）
  const [suggestedOrderIds, setSuggestedOrderIds] = useState<Set<number>>(() => {
    try {
      const raw = localStorage.getItem('sf_suggested_order_ids');
      if (raw) return new Set(JSON.parse(raw) as number[]);
    } catch { /* ignore */ }
    return new Set();
  });

  const addSuggestedOrderId = useCallback((id: number) => {
    setSuggestedOrderIds((prev) => {
      const next = new Set([...prev, id]);
      try { localStorage.setItem('sf_suggested_order_ids', JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  }, []);

  // ── 列表数据 ──
  const { data: listData, isLoading } = useProductionOrderList(
    { status: (statusFilter || undefined) as any },
    page,
    20,
  );
  // 各状态计数用（只取 total）
  const { data: inProgressData }  = useProductionOrderList({ status: 'in_progress' as any }, 1, 1);
  const { data: pendingData }     = useProductionOrderList({ status: 'pending' as any }, 1, 1);
  const { data: scheduledData }   = useProductionOrderList({ status: 'scheduled' as any }, 1, 1);
  const { data: completedData }   = useProductionOrderList({ status: 'completed' as any }, 1, 1);
  const { data: allData }         = useProductionOrderList({}, 1, 1);
  const { data: shortageSummary } = useShortageSummary();

  const { data: detailData }   = useProductionOrderDetail(selectedId);
  const { data: componentData } = useProductionOrderComponents(selectedId);
  const { data: operationData } = useProductionOrderOperations(selectedId);
  const { data: materialsData } = useMaterialRequirements(selectedId);
  const createFromSO          = useCreateFromSalesOrder();
  const cancelOrder           = useCancelOrder();
  const generateSuggestions   = useGenerateMrpSuggestions();
  const { showToast }         = useAppStore();

  const list      = ((listData as any)?.list ?? EMPTY_ORDER_ROWS) as OrderRow[];
  const total     = (listData as any)?.total ?? 0;
  const detail    = detailData as OrderRow | undefined;
  const components = (componentData ?? []) as ComponentRow[];
  const operations = (operationData ?? []) as OperationRow[];
  const materials = (materialsData ?? []) as MaterialRow[];

  // 统计卡片数据
  const stats = useMemo(() => ({
    all:        (allData as any)?.total ?? 0,
    inProgress: (inProgressData as any)?.total ?? 0,
    waiting:    ((pendingData as any)?.total ?? 0) + ((scheduledData as any)?.total ?? 0),
    completed:  (completedData as any)?.total ?? 0,
    shortage:   (shortageSummary as any)?.total ?? 0,
  }), [allData, inProgressData, pendingData, scheduledData, completedData, shortageSummary]);

  // 筛选后显示的条数描述
  const countLabel = useMemo(() => {
    const label = statusFilter ? STATUS_MAP[statusFilter]?.label : '全部';
    return `共 ${total} 条${label ? `（${label}）` : ''}`;
  }, [total, statusFilter]);

  const handleCreate = useCallback(async () => {
    const orderNo = salesOrderIdInput.trim();
    if (!orderNo) {
      showToast({ type: 'warning', message: '请先输入销售订单单号' });
      return;
    }

    try {
      const result = await fetchSalesOrders({
        keyword: orderNo,
        page: 1,
        pageSize: 200,
      });
      const matchedOrder = result.list.find(
        (order) => normalizeBusinessNo(order.orderNo) === normalizeBusinessNo(orderNo),
      );

      if (!matchedOrder) {
        showToast({ type: 'warning', message: '未找到对应的销售订单单号' });
        return;
      }

      await createFromSO.mutateAsync(Number(matchedOrder.id));
      showToast({ type: 'success', message: `已按销售订单 ${matchedOrder.orderNo} 创建生产工单` });
      setShowCreateModal(false);
      setSalesOrderIdInput('');
    } catch (error) {
      showToast({ type: 'error', message: (error as Error).message });
    }
  }, [salesOrderIdInput, createFromSO, showToast]);

  const handleExport = useCallback(() => {
    if (!list.length) {
      showToast({ type: 'warning', message: '当前没有可导出的生产工单数据' });
      return;
    }

    const header = [
      '工单号',
      '销售订单号',
      '产品名称',
      '工单状态',
      '物料状态',
      '计划数量',
      '已完成数量',
      '完成进度(%)',
      '计划开始',
      '计划完工',
    ];
    const rows = list.map((order) => [
      order.workOrderNo ?? '',
      order.salesOrderNo ?? '',
      order.skuName ?? '',
      STATUS_MAP[order.status]?.label ?? order.status ?? '',
      order.materialStatus === 'ready'
        ? '全部齐套'
        : order.materialStatus === 'partial'
          ? '部分缺料'
          : order.materialStatus === 'shortage'
            ? '缺料'
            : '',
      order.qtyPlanned ?? '',
      order.qtyCompleted ?? '0',
      order.progressPct ?? 0,
      order.plannedStart ? String(order.plannedStart).slice(0, 10) : '',
      order.plannedEnd ? String(order.plannedEnd).slice(0, 10) : '',
    ]);
    const csv = [header, ...rows]
      .map((row) => row.map(escapeCsvField).join(','))
      .join('\n');
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `production-orders-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
    showToast({ type: 'success', message: '生产工单报表已开始下载' });
  }, [list, showToast]);

  const handleCancel = useCallback(async () => {
    if (!selectedId) return;
    await cancelOrder.mutateAsync(selectedId);
    setShowCancelModal(false);
    setSelectedId(null);
  }, [selectedId, cancelOrder]);

  const openDetail = useCallback((id: number) => {
    setSelectedId(id);
    setDrawerTab('info');
  }, []);

  // ── 统计卡片配置 ──
  const statCards = [
    { key: '',            label: '全部工单',  value: stats.all,        sub: '所有工单',        color: '' },
    { key: 'in_progress', label: '进行中',    value: stats.inProgress, sub: '正在生产',        color: '#2563EB' },
    { key: 'waiting',     label: '待开始',    value: stats.waiting,    sub: '已排产/待排产',   color: '#64748B' },
    { key: 'completed',   label: '已完成',    value: stats.completed,  sub: '本月完工',        color: '#16A34A' },
    { key: 'shortage',    label: '物料缺口',  value: stats.shortage,   sub: '缺料待采购',      color: '#DC2626', danger: true },
  ];

  return (
    <div className={styles.page}>
      {/* ── 页头 ── */}
      <div className={styles.pageHeader}>
        <div>
          <div className={styles.pageTitle}>🏭 生产工单</div>
          <div className={styles.pageSubtitle}>
            共 {stats.inProgress} 个在产工单{stats.shortage > 0 ? ` · ${stats.shortage} 个物料缺口` : ''}
          </div>
        </div>
        <div className={styles.pageActions}>
          <button className={`${styles.btn} ${styles['btn--secondary']}`} onClick={handleExport}>📤 导出报表</button>
          <button className={`${styles.btn} ${styles['btn--primary']}`} onClick={() => setShowCreateModal(true)}>
            + 手动创建工单
          </button>
        </div>
      </div>

      {/* ── 统计条 ── */}
      <div className={styles.statCards}>
        {statCards.map((sc) => {
          const filterKey = sc.key === 'waiting' ? '' : sc.key;
          const isActive = filterKey !== '' && statusFilter === filterKey;
          return (
            <div
              key={sc.label}
              className={`${styles.statCard} ${isActive ? styles['statCard--active'] : ''} ${sc.danger ? styles['statCard--danger'] : ''}`}
              onClick={() => {
                if (sc.key === 'shortage' || sc.key === 'waiting') return;
                setStatusFilter(isActive ? '' : filterKey);
                setPage(1);
              }}
              title={sc.key && sc.key !== 'shortage' && sc.key !== 'waiting' ? '点击筛选' : undefined}
            >
              <div className={styles.statCard__top}>
                <div className={styles.statCard__value} style={sc.color ? { color: sc.color } : undefined}>
                  {sc.value}
                </div>
              </div>
              <div className={styles.statCard__bottom}>
                <span className={styles.statCard__label}>{sc.label}</span>
                <span className={styles.statCard__sub}>{sc.sub}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── 筛选栏 ── */}
      <div className={styles.filterBar}>
        <div className={styles.searchBox}>
          <span className={styles.searchBox__icon}>
            <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
              <circle cx="8.5" cy="8.5" r="5.5" />
              <path d="M14.5 14.5l3.5 3.5" />
            </svg>
          </span>
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索工单号、产品名称..."
          />
        </div>
        <select
          className={styles.filterSelect}
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
        >
          <option value="">全部状态</option>
          <option value="in_progress">生产中</option>
          <option value="scheduled">已排产</option>
          <option value="pending">待排产</option>
          <option value="completed">已完工</option>
          <option value="cancelled">已取消</option>
        </select>
        <select className={styles.filterSelect}>
          <option>全部优先级</option>
          <option>紧急</option>
          <option>高</option>
          <option>普通</option>
        </select>
        <select className={styles.filterSelect}>
          <option>物料齐套状态</option>
          <option>全部齐套</option>
          <option>部分缺料</option>
          <option>严重缺料</option>
        </select>
        <span className={styles.filterCount}>{countLabel}</span>
      </div>

      {/* ── 工单卡片列表 ── */}
      {isLoading ? (
        <div className={styles.loadingWrap}>
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className={styles.skeleton} />
          ))}
        </div>
      ) : list.length === 0 ? (
        <div className={styles.emptyState}>
          <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>🏭</div>
          <div style={{ fontWeight: 600, color: '#374151' }}>暂无工单数据</div>
          <div style={{ color: '#9ca3af', fontSize: '0.875rem', marginTop: '0.25rem' }}>
            {statusFilter ? '当前筛选条件下无工单' : '还没有生产工单，可从销售订单创建'}
          </div>
        </div>
      ) : (
        <div className={styles.orderList}>
          {list.map((order) => {
            const s = STATUS_MAP[order.status] ?? STATUS_MAP.pending;
            const pct = Number(order.progressPct ?? 0);
            const matStatus = order.materialStatus as string | undefined;

            // material status badge class
            const matBadgeCls =
              matStatus === 'ready'    ? styles.badgeMatReady :
              matStatus === 'partial'  ? styles.badgeMatPartial :
              matStatus === 'shortage' ? styles.badgeMatShortage :
              null;

            return (
              <div key={order.id} className={`${styles.orderCard} ${cardBorderClass(order.status)}`}>

                {/* ─ Row 1: Header ─ */}
                <div className={styles.orderCard__header}>
                  <div className={styles.orderCard__headerLeft}>
                    {/* 工单号 · 关联销售单 */}
                    <div className={styles.orderCard__headerTop}>
                      <span className={styles.orderCard__id}>{order.workOrderNo}</span>
                      {order.salesOrderNo && (
                        <>
                          <span className={styles.orderCard__sep}>·</span>
                          <span className={styles.orderCard__so}>关联销售单 {order.salesOrderNo}</span>
                        </>
                      )}
                    </div>
                    {/* 产品名称 */}
                    <div className={styles.orderCard__title}>{order.skuName}</div>
                  </div>

                  {/* Badges */}
                  <div className={styles.orderCard__badges}>
                    {matBadgeCls && (
                      <span className={`${styles.badge} ${matBadgeCls}`}>
                        {matStatus === 'ready' ? '齐套' : matStatus === 'partial' ? '部分缺料' : '缺料'}
                      </span>
                    )}
                    <span className={`${styles.badge} ${s.cls}`}>
                      {s.dot ?? ''}{s.label}
                    </span>
                    {suggestedOrderIds.has(Number(order.id)) && (
                      <span className={`${styles.badge} ${styles.badgePurchased}`}>
                        ✓ 采购已发起
                      </span>
                    )}
                  </div>
                </div>

                {/* ─ Row 2: Data Row ─ */}
                <div className={styles.orderCard__data}>
                  <div className={styles.orderCard__metrics}>
                    {/* Col 1: 计划量 */}
                    <div className={styles.orderCard__metric}>
                      <div className={styles.orderCard__metricLabel}>计划量</div>
                      <div className={styles.orderCard__metricValue}>{order.qtyPlanned}</div>
                    </div>
                    {/* Col 2: 已完成 */}
                    <div className={styles.orderCard__metric}>
                      <div className={styles.orderCard__metricLabel}>已完成</div>
                      <div className={styles.orderCard__metricValue}>{order.qtyCompleted ?? '0'}</div>
                    </div>
                    {/* Col 3: 计划开始 */}
                    <div className={styles.orderCard__metric}>
                      <div className={styles.orderCard__metricLabel}>计划开始</div>
                      <div className={`${styles.orderCard__metricValue} ${styles['orderCard__metricValue--muted']}`}>
                        {order.plannedStart?.slice(0, 10) ?? '-'}
                      </div>
                    </div>
                    {/* Col 4: 计划完工 */}
                    <div className={styles.orderCard__metric}>
                      <div className={styles.orderCard__metricLabel}>计划完工</div>
                      <div className={`${styles.orderCard__metricValue} ${styles['orderCard__metricValue--muted']}`}>
                        {order.plannedEnd?.slice(0, 10) ?? '-'}
                      </div>
                    </div>
                  </div>

                  {/* Col 5: 进度 Pill */}
                  <ProgressPill pct={pct} />
                </div>

                {/* ─ Row 2.5: BOM 状态条（仅缺料时显示）─ */}
                <BomStatusBar materialStatus={matStatus} />

                {/* ─ Row 3: Footer ─ */}
                <div className={styles.orderCard__footer}>
                  <span className={styles.orderCard__footerText}>
                    {order.status === 'completed' ? '✓ 工单已完成' :
                     order.status === 'cancelled' ? '工单已取消' :
                     matStatus === 'shortage' ? '🔴 当前工序因缺料暂停，需立即处理' :
                     matStatus === 'partial'  ? '⚠ 部分物料缺失，请关注采购进度' :
                     `进行中 · ${pct}% 完成`}
                  </span>
                  <div className={styles.orderCard__footerActions}>
                    <button
                      className={`${styles.btn} ${styles['btn--sm']} ${styles['btn--secondary']}`}
                      onClick={() => openDetail(order.id)}
                    >
                      查看详情
                    </button>
                    {matStatus === 'shortage' && (
                      suggestedOrderIds.has(Number(order.id)) ? (
                        <button
                          className={`${styles.btn} ${styles['btn--sm']} ${styles['btn--secondary']}`}
                          disabled
                          style={{ color: '#059669', borderColor: '#A7F3D0', cursor: 'not-allowed' }}
                        >
                          ✓ 已发起
                        </button>
                      ) : (
                        <button
                          className={`${styles.btn} ${styles['btn--sm']} ${styles['btn--primary']}`}
                          disabled={generateSuggestions.isPending}
                          onClick={async () => {
                            const result = await generateSuggestions.mutateAsync({ productionOrderId: Number(order.id) });
                            if (result.created > 0 || result.updated > 0) {
                              addSuggestedOrderId(Number(order.id));
                            }
                          }}
                        >
                          {generateSuggestions.isPending ? '处理中…' : '发起采购'}
                        </button>
                      )
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── 分页 ── */}
      {total > 20 && (
        <div className={styles.pagination}>
          <button
            className={styles.pageBtn}
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >‹</button>
          <span className={styles.pageInfo}>第 {page} 页 / 共 {Math.ceil(total / 20)} 页</span>
          <button
            className={styles.pageBtn}
            disabled={page >= Math.ceil(total / 20)}
            onClick={() => setPage((p) => p + 1)}
          >›</button>
        </div>
      )}

      {/* ── 详情 Drawer ── */}
      <Drawer
        open={selectedId !== null}
        onClose={() => setSelectedId(null)}
        title={detail?.workOrderNo ?? '工单详情'}
        width={780}
      >
        {detail && (
          <>
            {/* Drawer 头部信息 */}
            <div className={styles.drawerHead}>
              <div className={styles.drawerHead__top}>
                <span className={`${styles.badge} ${STATUS_MAP[detail.status]?.cls ?? styles.badgePending}`}>
                  {(STATUS_MAP[detail.status]?.dot ?? '') + (STATUS_MAP[detail.status]?.label ?? detail.status)}
                </span>
              </div>
              <div className={styles.drawerHead__subtitle}>
                {detail.skuName}
                {detail.plannedEnd ? ` · 计划完工 ${String(detail.plannedEnd).slice(0, 10)}` : ''}
              </div>
              <div className={styles.drawerHead__meta}>
                <span>冻结结构 {components.length} 节点</span>
                <span>工序链 {operations.length} 道</span>
                <span>任务 {(detail.tasks as OrderTaskLite[] | undefined)?.length ?? 0} 条</span>
              </div>
              {/* 进度 */}
              <div className={styles.progressWrap} style={{ marginTop: '0.75rem' }}>
                <div className={styles.progressHeader}>
                  <span className={styles.progressLabel}>整体进度</span>
                  <span className={styles.progressPct} style={{ color: '#2563EB' }}>{detail.progressPct ?? 0}%</span>
                </div>
                <div className={styles.progressBar}>
                  <div
                    className={`${styles.progressFill} ${progressClass(Number(detail.progressPct ?? 0))}`}
                    style={{ width: `${detail.progressPct ?? 0}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Tabs */}
            <div className={styles.tabRow}>
              {(['info', 'structure', 'operations', 'materials', 'snapshot'] as const).map((t) => (
                <div
                  key={t}
                  className={`${styles.tab} ${drawerTab === t ? styles.tabActive : ''}`}
                  onClick={() => setDrawerTab(t)}
                >
                  {t === 'info'
                    ? '基本信息'
                    : t === 'structure'
                      ? '结构快照'
                      : t === 'operations'
                        ? '工序链路'
                        : t === 'materials'
                          ? '物料需求'
                          : '工艺快照'}
                </div>
              ))}
            </div>

            {/* Tab 内容 */}
            {drawerTab === 'info' && (
              <div className={styles.drawerSection}>
                <div className={styles.drawerSection__title}>基本信息</div>
                <dl className={styles.infoGrid}>
                  <dt>工单号</dt><dd>{detail.workOrderNo}</dd>
                  <dt>关联销售单</dt><dd>{detail.salesOrderNo ?? '-'}</dd>
                  <dt>产品名称</dt><dd>{detail.skuName}</dd>
                  <dt>计划数量</dt><dd>{detail.qtyPlanned}</dd>
                  <dt>已完成数量</dt><dd>{detail.qtyCompleted}</dd>
                  <dt>工单状态</dt>
                  <dd>
                    <span className={`${styles.badge} ${STATUS_MAP[detail.status]?.cls ?? styles.badgePending}`}>
                      {STATUS_MAP[detail.status]?.label ?? detail.status}
                    </span>
                  </dd>
                  <dt>完成进度</dt><dd>{detail.progressPct ?? 0}%</dd>
                  <dt>计划开始</dt><dd>{String(detail.plannedStart ?? '-').slice(0, 10)}</dd>
                  <dt>计划完工</dt><dd>{String(detail.plannedEnd ?? '-').slice(0, 10)}</dd>
                  <dt>物料状态</dt>
                  <dd>
                    {detail.materialStatus === 'ready'    ? '✓ 全部齐套' :
                     detail.materialStatus === 'partial'  ? '⚠ 部分缺料' :
                     detail.materialStatus === 'shortage' ? '🔴 严重缺料' : '—'}
                  </dd>
                </dl>
                {detail.status === 'pending' && (
                  <div style={{ marginTop: '1.25rem' }}>
                    <Button variant="danger" onClick={() => setShowCancelModal(true)}>取消工单</Button>
                  </div>
                )}
              </div>
            )}

            {drawerTab === 'materials' && (
              <div className={styles.drawerSection}>
                <div className={styles.drawerSection__title}>原材料需求明细</div>
                <MaterialTable materials={materials} />
              </div>
            )}

            {drawerTab === 'structure' && (
              <div className={styles.drawerSection}>
                <div className={styles.drawerSection__title}>冻结结构快照</div>
                <ComponentStructure components={components} />
              </div>
            )}

            {drawerTab === 'operations' && (
              <div className={styles.drawerSection}>
                <div className={styles.drawerSection__title}>半成品工序链路</div>
                <OperationLane operations={operations} tasks={(detail.tasks as OrderTaskLite[] | undefined) ?? []} />
              </div>
            )}

            {drawerTab === 'snapshot' && (
              <div className={styles.drawerSection}>
                <div className={styles.drawerSection__title}>工艺快照</div>
                <ProcessSnapshot detail={detail as Record<string, unknown>} />
              </div>
            )}
          </>
        )}
      </Drawer>

      {/* ── 创建工单 Modal ── */}
      <Modal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="从销售订单创建工单"
        onConfirm={handleCreate}
        confirmLoading={createFromSO.isPending}
      >
        <div style={{ padding: '1rem 0' }}>
          <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', color: '#374151', fontWeight: 500 }}>
            销售订单单号
          </label>
          <input
            type="text"
            value={salesOrderIdInput}
            onChange={(e) => setSalesOrderIdInput(e.target.value)}
            placeholder="输入销售订单单号，例如 SO260325-00002"
            style={{ width: '100%', height: 38, border: '1px solid #E2E8F0', borderRadius: 8, padding: '0 0.75rem', fontSize: '0.875rem' }}
          />
        </div>
      </Modal>

      {/* ── 取消工单 Modal ── */}
      <Modal
        open={showCancelModal}
        onClose={() => setShowCancelModal(false)}
        title="确认取消工单"
        onConfirm={handleCancel}
        confirmLoading={cancelOrder.isPending}
        confirmVariant="danger"
      >
        <p style={{ fontSize: '0.875rem', color: '#374151' }}>
          确定要取消工单 <strong>{detail?.workOrderNo}</strong> 吗？<br />
          此操作将级联取消所有工序任务并释放库存预留。
        </p>
      </Modal>
    </div>
  );
}
