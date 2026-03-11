/**
 * [artifact:前端代码] — 排产计划页（重构）
 *
 * 重构依据：frontend-sdd-analysis.md T017–T021（P08 排产计划）
 *
 * 本次实现范围（静态结构）：
 *   T017 — GanttChart 组件（工作站行×时间槽列，纯布局）
 *   T018 — TaskBlock 组件（3 态：normal / warning / danger）
 *   T019 — StatusBar + AiRiskAlert + ViewToggle + GanttChart 集成
 *   T020 — WorkerTaskCards 视图（WorkerCard 网格布局）
 *   T021 — StickyActionBar（底部固定确认栏）
 *
 * 暂不实现：
 *   T022 — 甘特图拖拽（同行调整时段 + 跨行换站）
 */

import { useEffect, useState, useCallback } from 'react';
import { useAppStore } from '@/stores/appStore';
import {
  useProductionOrderList,
  useProductionOrderDetail,
  useCreateProductionOrder,
  useSchedule,
  useConfirmSchedule,
  useWorkerTasks,
  useStartTask,
  useCompleteTask,
} from '@/api/production';
import { ProductionOrderStatus, TaskStatus } from '@/types/enums';
import type { ProductionOrder, ScheduleResult, WorkerTask } from '@/types/models';
import type { Column } from '@/components/common/Table';
import Table from '@/components/common/Table';
import Modal from '@/components/common/Modal';
import Drawer from '@/components/common/Drawer';
import Tag from '@/components/common/Tag';
import Button from '@/components/common/Button';
import StatusDot from '@/components/common/StatusDot';
import AiThinkingState from '@/components/ai/AiThinkingState';
import { formatDateTime, formatDate, formatQtyStr } from '@/utils/format';
import styles from './SchedulePage.module.css';

// ─── 类型定义 ─────────────────────────────────────────────

/** 甘特图时间槽枚举 */
type TimeSlot = '08:00' | '10:00' | '14:00' | '16:00';

/** 物料备料状态 */
type MaterialStatus = 'ready' | 'pending' | 'missing';

/** 甘特图任务块状态 */
type TaskBlockStatus = 'normal' | 'warning' | 'danger';

/** 甘特图任务数据 */
interface GanttTask {
  id: string;
  orderNo: string;
  processName: string;
  workerName: string;
  qty: number;
  unit: string;
  status: TaskBlockStatus;
  materialStatus: MaterialStatus;
  timeSlot: TimeSlot;
  /** 任务块横跨的时间槽格数，默认 1 */
  span?: number;
}

/** 甘特图工作站行 */
interface StationRow {
  stationId: string;
  stationName: string;
  workerInCharge: string;
  materialStatus: MaterialStatus;
  tasks: GanttTask[];
}

/** 视图切换类型 */
type ScheduleView = 'gantt' | 'worker';

/** 工人卡片任务项 */
interface WorkerTaskItem {
  timeRange: string;
  priority: 'high' | 'normal' | 'low';
  description: string;
  status: TaskBlockStatus;
}

/** 工人卡片数据 */
interface WorkerCardData {
  workerId: string;
  name: string;
  avatarInitial: string;
  station: string;
  taskCount: number;
  tasks: WorkerTaskItem[];
}

// ─── 静态 Mock 数据（T019：集成前使用静态数据） ─────────────

const TIME_SLOTS: TimeSlot[] = ['08:00', '10:00', '14:00', '16:00'];

const MOCK_STATIONS: StationRow[] = [
  {
    stationId: 'ST01',
    stationName: '开料区',
    workerInCharge: '张师傅',
    materialStatus: 'ready',
    tasks: [
      { id: 't1', orderNo: 'A23', processName: '开料', workerName: '张师傅', qty: 50, unit: '张', status: 'normal', materialStatus: 'ready', timeSlot: '08:00' },
      { id: 't2', orderNo: 'C31', processName: '开料', workerName: '李师傅', qty: 30, unit: '张', status: 'normal', materialStatus: 'ready', timeSlot: '10:00' },
    ],
  },
  {
    stationId: 'ST02',
    stationName: '钻孔区',
    workerInCharge: '王师傅',
    materialStatus: 'ready',
    tasks: [
      { id: 't3', orderNo: 'B19', processName: '钻孔', workerName: '王师傅', qty: 40, unit: '件', status: 'warning', materialStatus: 'pending', timeSlot: '10:00' },
      { id: 't4', orderNo: 'A23', processName: '钻孔', workerName: '王师傅', qty: 50, unit: '件', status: 'normal', materialStatus: 'ready', timeSlot: '14:00' },
    ],
  },
  {
    stationId: 'ST03',
    stationName: '封边区',
    workerInCharge: '刘师傅',
    materialStatus: 'pending',
    tasks: [
      { id: 't5', orderNo: 'B19', processName: '封边', workerName: '刘师傅', qty: 40, unit: '件', status: 'danger', materialStatus: 'missing', timeSlot: '08:00' },
      { id: 't6', orderNo: 'C31', processName: '封边', workerName: '刘师傅', qty: 30, unit: '件', status: 'warning', materialStatus: 'pending', timeSlot: '14:00' },
    ],
  },
  {
    stationId: 'ST04',
    stationName: '装配区',
    workerInCharge: '陈师傅',
    materialStatus: 'ready',
    tasks: [
      { id: 't7', orderNo: 'A23', processName: '装配', workerName: '陈师傅', qty: 50, unit: '件', status: 'normal', materialStatus: 'ready', timeSlot: '10:00' },
      { id: 't8', orderNo: 'B19', processName: '装配', workerName: '陈师傅', qty: 40, unit: '件', status: 'warning', materialStatus: 'ready', timeSlot: '14:00' },
    ],
  },
];

const MOCK_WORKERS: WorkerCardData[] = [
  {
    workerId: 'W01',
    name: '张师傅',
    avatarInitial: '张',
    station: '开料区',
    taskCount: 2,
    tasks: [
      { timeRange: '08:00 – 10:00', priority: 'normal', description: 'A23 开料 × 50张', status: 'normal' },
      { timeRange: '14:00 – 16:00', priority: 'normal', description: 'C31 开料 × 30张', status: 'normal' },
    ],
  },
  {
    workerId: 'W02',
    name: '王师傅',
    avatarInitial: '王',
    station: '钻孔区',
    taskCount: 2,
    tasks: [
      { timeRange: '10:00 – 12:00', priority: 'high', description: 'B19 钻孔 × 40件（有风险）', status: 'warning' },
      { timeRange: '14:00 – 16:00', priority: 'normal', description: 'A23 钻孔 × 50件', status: 'normal' },
    ],
  },
  {
    workerId: 'W03',
    name: '刘师傅',
    avatarInitial: '刘',
    station: '封边区',
    taskCount: 2,
    tasks: [
      { timeRange: '08:00 – 10:00', priority: 'high', description: 'B19 封边 × 40件（缺料！）', status: 'danger' },
      { timeRange: '14:00 – 16:00', priority: 'normal', description: 'C31 封边 × 30件（待入库）', status: 'warning' },
    ],
  },
  {
    workerId: 'W04',
    name: '陈师傅',
    avatarInitial: '陈',
    station: '装配区',
    taskCount: 2,
    tasks: [
      { timeRange: '10:00 – 12:00', priority: 'normal', description: 'A23 装配 × 50件', status: 'normal' },
      { timeRange: '14:00 – 16:00', priority: 'high', description: 'B19 装配 × 40件', status: 'warning' },
    ],
  },
  {
    workerId: 'W05',
    name: '周师傅',
    avatarInitial: '周',
    station: '开料区',
    taskCount: 1,
    tasks: [
      { timeRange: '10:00 – 12:00', priority: 'low', description: 'D05 开料 × 20张', status: 'normal' },
    ],
  },
  {
    workerId: 'W06',
    name: '吴师傅',
    avatarInitial: '吴',
    station: '装配区',
    taskCount: 1,
    tasks: [
      { timeRange: '08:00 – 10:00', priority: 'normal', description: 'D05 装配 × 20件', status: 'normal' },
    ],
  },
];

// ─── 枚举常量 ─────────────────────────────────────────────

const ORDER_STATUS_VARIANT: Record<ProductionOrderStatus, 'neutral' | 'info' | 'warning' | 'success' | 'error'> = {
  [ProductionOrderStatus.PENDING]:     'neutral',
  [ProductionOrderStatus.DRAFT]:       'neutral',
  [ProductionOrderStatus.SCHEDULED]:   'info',
  [ProductionOrderStatus.IN_PROGRESS]: 'warning',
  [ProductionOrderStatus.PAUSED]:      'info',
  [ProductionOrderStatus.COMPLETED]:   'success',
  [ProductionOrderStatus.CANCELLED]:   'error',
};
const ORDER_STATUS_LABEL: Record<ProductionOrderStatus, string> = {
  [ProductionOrderStatus.PENDING]:     '待生产',
  [ProductionOrderStatus.DRAFT]:       '草稿',
  [ProductionOrderStatus.SCHEDULED]:   '已排产',
  [ProductionOrderStatus.IN_PROGRESS]: '生产中',
  [ProductionOrderStatus.PAUSED]:      '已暂停',
  [ProductionOrderStatus.COMPLETED]:   '已完成',
  [ProductionOrderStatus.CANCELLED]:   '已取消',
};

const TASK_STATUS_VARIANT: Record<TaskStatus, 'neutral' | 'info' | 'warning' | 'success'> = {
  [TaskStatus.PENDING]:     'neutral',
  [TaskStatus.IN_PROGRESS]: 'warning',
  [TaskStatus.COMPLETED]:   'success',
  [TaskStatus.SKIPPED]:     'neutral',
  [TaskStatus.PAUSED]:      'info',
};
const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  [TaskStatus.PENDING]:     '待开始',
  [TaskStatus.IN_PROGRESS]: '进行中',
  [TaskStatus.COMPLETED]:   '已完成',
  [TaskStatus.SKIPPED]:     '已跳过',
  [TaskStatus.PAUSED]:      '已暂停',
};

const SCHEDULE_THINKING_STEPS = [
  '读取今日在产订单',
  '计算各订单工序节拍',
  '检查物料可用性',
  '评估工人产能分配',
  '优化工序顺序，减少等待时间',
];

type CreateOrderForm = {
  skuId: string;
  skuName: string;
  qty: string;
  unit: string;
  plannedStartDate: string;
  plannedEndDate: string;
  bomId: string;
  priority: string;
};

type OrderRecord = ProductionOrder & Record<string, unknown>;

// ─── 页面主组件 ───────────────────────────────────────────

export default function SchedulePage() {
  const { setPageTitle, showToast } = useAppStore();

  // 顶部 Tab：工单列表 / 甘特排产视图
  const [activeTab, setActiveTab] = useState<'orders' | 'schedule'>('schedule');
  // 甘特图内视图切换：工作站甘特 / 工人卡片
  const [scheduleView, setScheduleView] = useState<ScheduleView>('gantt');
  // 是否有未确认的调整（影响 StickyActionBar 显示）
  const [hasPendingChanges, setHasPendingChanges] = useState(true);

  // 工单列表相关
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<ProductionOrderStatus | ''>('');
  const [detailDrawer, setDetailDrawer] = useState<{ open: boolean; orderId: string }>({ open: false, orderId: '' });
  const [createModal, setCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState<CreateOrderForm>({
    skuId: '', skuName: '', qty: '', unit: '', plannedStartDate: '', plannedEndDate: '', bomId: '', priority: '3',
  });
  const [confirmModal, setConfirmModal] = useState(false);

  // 今日日期
  const todayStr = new Date().toISOString().slice(0, 10);

  useEffect(() => { setPageTitle('排产计划'); }, [setPageTitle]);

  const { data: ordersData, isLoading: ordersLoading, error: ordersError } = useProductionOrderList(
    statusFilter as ProductionOrderStatus || undefined,
    page,
    20,
  );
  const { data: detailData, isLoading: detailLoading } = useProductionOrderDetail(
    detailDrawer.orderId,
    { enabled: detailDrawer.open && !!detailDrawer.orderId },
  );
  const { data: scheduleData, isLoading: scheduleLoading } = useSchedule();
  const { data: workerTasksData, isLoading: tasksLoading } = useWorkerTasks(
    { refetchInterval: activeTab === 'schedule' ? 120_000 : false },
  );

  const createMutation   = useCreateProductionOrder();
  const confirmMutation  = useConfirmSchedule();
  const startMutation    = useStartTask();
  const completeMutation = useCompleteTask();

  const openDetail = useCallback((orderId: string) => setDetailDrawer({ open: true, orderId }), []);

  const handleCreate = async () => {
    const { skuId, qty, unit, plannedStartDate, plannedEndDate } = createForm;
    if (!skuId || !qty || !unit || !plannedStartDate || !plannedEndDate) {
      showToast({ type: 'warning', message: '请填写所有必填字段' });
      return;
    }
    try {
      await createMutation.mutateAsync({
        skuId,
        qty: Number(qty),
        unit,
        plannedStartDate,
        plannedEndDate,
        bomId: createForm.bomId || undefined,
        priority: Number(createForm.priority),
      });
      showToast({ type: 'success', message: '生产工单已创建' });
      setCreateModal(false);
      setCreateForm({ skuId: '', skuName: '', qty: '', unit: '', plannedStartDate: '', plannedEndDate: '', bomId: '', priority: '3' });
    } catch (e) {
      showToast({ type: 'error', message: (e as Error).message });
    }
  };

  const handleConfirmSchedule = async () => {
    if (!scheduleData) return;
    try {
      await confirmMutation.mutateAsync(scheduleData.id);
      showToast({ type: 'success', message: '排产方案已下发给工人' });
      setConfirmModal(false);
      setHasPendingChanges(false);
    } catch (e) {
      showToast({ type: 'error', message: (e as Error).message });
    }
  };

  const handleStartTask = async (taskId: string) => {
    try {
      await startMutation.mutateAsync(taskId);
      showToast({ type: 'success', message: '任务已开始' });
    } catch (e) {
      showToast({ type: 'error', message: (e as Error).message });
    }
  };

  const handleCompleteTask = async (taskId: string) => {
    try {
      await completeMutation.mutateAsync({ taskId, actualQty: undefined });
      showToast({ type: 'success', message: '任务已完成' });
    } catch (e) {
      showToast({ type: 'error', message: (e as Error).message });
    }
  };

  const orders = (ordersData?.list ?? []) as OrderRecord[];

  const orderColumns: Column<OrderRecord>[] = [
    {
      key: 'orderNo',
      title: '工单号',
      width: 140,
      render: (_, r) => {
        const o = r as unknown as ProductionOrder;
        return <span style={{ fontFamily: 'var(--font-family-mono)', fontSize: 13 }}>{o.orderNo}</span>;
      },
    },
    {
      key: 'skuName',
      title: '成品 SKU',
      render: (_, r) => {
        const o = r as unknown as ProductionOrder;
        return (
          <div>
            <div style={{ fontWeight: 500 }}>{o.skuName}</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontFamily: 'var(--font-family-mono)' }}>{o.skuCode}</div>
          </div>
        );
      },
    },
    {
      key: 'qty',
      title: '计划数量',
      width: 110,
      render: (_, r) => {
        const o = r as unknown as ProductionOrder;
        return `${formatQtyStr(o.qty, 2)} ${o.unit}`;
      },
    },
    {
      key: 'status',
      title: '状态',
      width: 90,
      render: (_, r) => {
        const o = r as unknown as ProductionOrder;
        return <Tag variant={ORDER_STATUS_VARIANT[o.status]}>{ORDER_STATUS_LABEL[o.status]}</Tag>;
      },
    },
    {
      key: 'priority',
      title: '优先级',
      width: 80,
      render: (_, r) => {
        const o = r as unknown as ProductionOrder;
        const p = o.priority ?? 3;
        const variant = p >= 5 ? 'error' : p >= 4 ? 'warning' : 'neutral';
        return <Tag variant={variant}>P{p}</Tag>;
      },
    },
    {
      key: 'progress',
      title: '进度',
      width: 130,
      render: (_, r) => {
        const o = r as unknown as ProductionOrder;
        const pct = o.qty > 0 ? Math.round(((o.completedQty ?? 0) / o.qty) * 100) : 0;
        return (
          <div className={styles.progress_cell}>
            <div className={styles.progress_bar_wrap}>
              <div className={styles.progress_bar_fill} style={{ width: `${pct}%` }} />
            </div>
            <span className={styles.progress_label}>{pct}%</span>
          </div>
        );
      },
    },
    {
      key: 'plannedEndDate',
      title: '计划完成',
      width: 110,
      render: (_, r) => formatDate((r as unknown as ProductionOrder).plannedEndDate),
    },
    {
      key: 'actions',
      title: '操作',
      width: 80,
      render: (_, r) => (
        <Button variant="ghost" size="sm" onClick={() => openDetail((r as unknown as ProductionOrder).id)}>
          详情
        </Button>
      ),
    },
  ];

  return (
    // 底部固定栏存在时页面需要 padding-bottom
    <div className={`${styles.page} ${hasPendingChanges && activeTab === 'schedule' ? styles['page--has-sticky-bar'] : ''}`}>

      {/* ── 页面头部 ── */}
      <div className="page-header">
        <div className={styles.page_header_left}>
          <h1 className="page-header__title">每日排产计划</h1>
          <span className={styles.page_header_date}>{todayStr} 周三</span>
        </div>
        <div className="page-header__actions">
          <Button variant="ghost" size="md">查看历史</Button>
          <Button variant="primary" size="md" onClick={() => setCreateModal(true)}>新建工单</Button>
        </div>
      </div>

      {/* ── 顶部 Tab ── */}
      <div className={styles.tabs}>
        {([
          { key: 'schedule', label: 'AI 排产视图' },
          { key: 'orders',   label: '生产工单列表' },
        ] as const).map(({ key, label }) => (
          <button
            key={key}
            className={`${styles.tab} ${activeTab === key ? styles['tab--active'] : ''}`}
            onClick={() => setActiveTab(key)}
          >{label}</button>
        ))}
      </div>

      {/* ══════════════════════════════════════════════════
          AI 排产视图 Tab
      ══════════════════════════════════════════════════ */}
      {activeTab === 'schedule' && (
        <div className={styles.schedule_view}>

          {/* T019 — StatusBar：AI 已生成计划状态摘要栏 */}
          <ScheduleStatusBar
            totalOrders={12}
            todayTasks={28}
            capacityLoad={78}
            generatedAt="07:30"
            confirmed={false}
          />

          {/* T019 — AiRiskAlert：AI 风险提示条 */}
          <AiRiskAlert
            message="今日订单 B19 存在延误风险。建议优先安排工序3（封边），可节省约 0.5 天，交期风险从中等降为低。"
            onViewDetail={() => showToast({ type: 'info', message: '详细分析面板（即将上线）' })}
          />

          {/* T019 — ViewToggle：甘特图视图 / 工人卡片视图 切换 */}
          <ViewToggle value={scheduleView} onChange={setScheduleView} />

          {/* T017 + T018 — GanttChart 甘特图（工作站视图） */}
          {scheduleView === 'gantt' && (
            scheduleLoading ? (
              <div className={styles.schedule_thinking}>
                <AiThinkingState
                  steps={SCHEDULE_THINKING_STEPS.map((s, i) => ({
                    id: String(i),
                    label: s,
                    status: i < 2 ? 'done' : i === 2 ? 'active' : 'pending',
                  }))}
                  onCancel={() => { /* 生成中不可取消 */ }}
                />
              </div>
            ) : (
              <GanttChart stations={MOCK_STATIONS} timeSlots={TIME_SLOTS} />
            )
          )}

          {/* T020 — WorkerTaskCards 工人卡片视图 */}
          {scheduleView === 'worker' && (
            <WorkerTaskCards workers={MOCK_WORKERS} loading={tasksLoading} />
          )}

          {/* T021 — StickyActionBar 底部固定确认栏 */}
          {hasPendingChanges && (
            <StickyActionBar
              onCancel={() => {
                setHasPendingChanges(false);
                showToast({ type: 'info', message: '已取消调整，恢复 AI 初始排产' });
              }}
              onConfirm={() => setConfirmModal(true)}
              confirmLoading={confirmMutation.isPending}
            />
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════
          生产工单列表 Tab
      ══════════════════════════════════════════════════ */}
      {activeTab === 'orders' && (
        <>
          <div className={styles.filter_bar}>
            <select
              className={styles.filter_select}
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value as ProductionOrderStatus | ''); setPage(1); }}
              aria-label="状态筛选"
            >
              <option value="">全部状态</option>
              {Object.entries(ORDER_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <Table<OrderRecord>
              columns={orderColumns}
              dataSource={orders}
              rowKey="id"
              loading={ordersLoading}
              error={ordersError ? (ordersError as Error).message : null}
              emptyText="暂无生产工单"
              pagination={ordersData ? { page, pageSize: 20, total: ordersData.total, onChange: setPage } : undefined}
            />
          </div>
        </>
      )}

      {/* ── 工单详情 Drawer ── */}
      <Drawer
        open={detailDrawer.open}
        title="工单详情"
        width={560}
        onClose={() => setDetailDrawer({ open: false, orderId: '' })}
      >
        {detailLoading ? (
          <div className={styles.drawer_loading}>
            <div className="spinner" aria-label="加载中" />
            <span>加载工单详情...</span>
          </div>
        ) : detailData ? (
          <OrderDetailView
            order={detailData}
            onStart={handleStartTask}
            onComplete={handleCompleteTask}
            startLoading={startMutation.isPending}
            completeLoading={completeMutation.isPending}
          />
        ) : (
          <p style={{ padding: 'var(--space-4)', color: 'var(--text-secondary)' }}>暂无数据</p>
        )}
      </Drawer>

      {/* ── 新建工单 Modal ── */}
      <Modal
        open={createModal}
        title="新建生产工单"
        onClose={() => setCreateModal(false)}
        onConfirm={() => void handleCreate()}
        confirmLabel="创建工单"
        confirmLoading={createMutation.isPending}
        size="md"
      >
        <CreateOrderFormUI form={createForm} onChange={setCreateForm} />
      </Modal>

      {/* ── 确认下发 Modal ── */}
      <Modal
        open={confirmModal}
        title="确认并下发排产方案"
        onClose={() => setConfirmModal(false)}
        onConfirm={() => void handleConfirmSchedule()}
        confirmLabel="确认并下发"
        confirmLoading={confirmMutation.isPending}
        size="sm"
      >
        <div className={styles.confirm_body}>
          <p>确认执行当前排产方案并下发给工人？</p>
          <div className="alert alert--warning" style={{ marginTop: 'var(--space-3)' }}>
            确认后将自动推送今日任务至所有相关工人小程序，相关工单状态更新为"已排产"。此操作不可撤销。
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// T019 — ScheduleStatusBar：AI 已生成计划状态摘要栏
// ─────────────────────────────────────────────────────────

interface ScheduleStatusBarProps {
  totalOrders: number;
  todayTasks: number;
  capacityLoad: number;
  generatedAt: string;
  confirmed: boolean;
}

function ScheduleStatusBar({
  totalOrders,
  todayTasks,
  capacityLoad,
  generatedAt,
  confirmed,
}: ScheduleStatusBarProps) {
  // 产能负载率颜色语义：< 60% 正常，60–85% 警告，> 85% 危险
  const loadStatus = capacityLoad >= 85 ? 'danger' : capacityLoad >= 60 ? 'warning' : 'success';

  return (
    <div className={styles.status_bar}>
      <div className={styles.status_bar__left}>
        <span className={styles.status_bar__ai_icon} aria-hidden="true">&#x2728;</span>
        <div className={styles.status_bar__info}>
          <span className={styles.status_bar__title}>AI 已生成今日排产计划</span>
          <span className={styles.status_bar__sub}>生成时间：{generatedAt}</span>
        </div>
      </div>

      <div className={styles.status_bar__stats}>
        <div className={styles.status_bar__stat}>
          <span className={styles.status_bar__stat_value}>{totalOrders}</span>
          <span className={styles.status_bar__stat_label}>覆盖工单</span>
        </div>
        <div className={styles.status_bar__divider} aria-hidden="true" />
        <div className={styles.status_bar__stat}>
          <span className={styles.status_bar__stat_value}>{todayTasks}</span>
          <span className={styles.status_bar__stat_label}>今日任务</span>
        </div>
        <div className={styles.status_bar__divider} aria-hidden="true" />
        <div className={styles.status_bar__stat}>
          <span className={`${styles.status_bar__stat_value} ${styles[`status_bar__stat_value--${loadStatus}`]}`}>
            {capacityLoad}%
          </span>
          <span className={styles.status_bar__stat_label}>产能负载率</span>
        </div>
      </div>

      <div className={styles.status_bar__right}>
        <Tag variant={confirmed ? 'success' : 'warning'}>
          {confirmed ? '已下发' : '未下发'}
        </Tag>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// T019 — AiRiskAlert：AI 风险提示条（橙色左边框）
// ─────────────────────────────────────────────────────────

interface AiRiskAlertProps {
  message: string;
  onViewDetail: () => void;
}

function AiRiskAlert({ message, onViewDetail }: AiRiskAlertProps) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <div className={styles.ai_risk_alert} role="alert" aria-live="polite">
      <span className={styles.ai_risk_alert__icon} aria-label="警告">&#9888;</span>
      <div className={styles.ai_risk_alert__content}>
        <span className={styles.ai_risk_alert__label}>AI 排产风险提示</span>
        <p className={styles.ai_risk_alert__message}>{message}</p>
      </div>
      <div className={styles.ai_risk_alert__actions}>
        <Button variant="ghost" size="sm" onClick={onViewDetail}>
          查看详细分析
        </Button>
        <button
          className={styles.ai_risk_alert__dismiss}
          onClick={() => setDismissed(true)}
          aria-label="关闭提示"
        >
          &#10005;
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// T019 — ViewToggle：视图切换（甘特图 / 工人卡片）
// ─────────────────────────────────────────────────────────

interface ViewToggleProps {
  value: ScheduleView;
  onChange: (v: ScheduleView) => void;
}

function ViewToggle({ value, onChange }: ViewToggleProps) {
  const options: { key: ScheduleView; label: string }[] = [
    { key: 'gantt',  label: '工作站甘特图' },
    { key: 'worker', label: '工人卡片视图' },
  ];

  return (
    <div className={styles.view_toggle} role="group" aria-label="视图切换">
      {options.map((opt) => (
        <label key={opt.key} className={styles.view_toggle__option}>
          <input
            type="radio"
            name="schedule-view"
            value={opt.key}
            checked={value === opt.key}
            onChange={() => onChange(opt.key)}
            className={styles.view_toggle__radio}
          />
          <span className={`${styles.view_toggle__label} ${value === opt.key ? styles['view_toggle__label--active'] : ''}`}>
            <span className={styles.view_toggle__dot} aria-hidden="true" />
            {opt.label}
          </span>
        </label>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// T017 — GanttChart：工作站行 × 时间槽列 网格甘特图
// ─────────────────────────────────────────────────────────

interface GanttChartProps {
  stations: StationRow[];
  timeSlots: TimeSlot[];
}

function GanttChart({ stations, timeSlots }: GanttChartProps) {
  return (
    <div className={styles.gantt_chart}>

      {/* 拖拽提示条（T022 预留，本次静态） */}
      <div className={styles.gantt_hint} aria-label="操作提示">
        <span className={styles.gantt_hint__icon} aria-hidden="true">&#8596;</span>
        拖拽任务块可调整排程（功能即将上线）
      </div>

      {/* 甘特表格 */}
      <div className={styles.gantt_table} role="grid" aria-label="排产甘特图">

        {/* 列头：工作站 + 时间轴 + 备料状态 */}
        <div className={styles.gantt_col_headers} role="row">
          <div className={`${styles.gantt_cell} ${styles['gantt_cell--header']} ${styles['gantt_cell--station']}`} role="columnheader">
            工作站
          </div>
          {timeSlots.map((slot) => (
            <div
              key={slot}
              className={`${styles.gantt_cell} ${styles['gantt_cell--header']} ${styles['gantt_cell--time']}`}
              role="columnheader"
            >
              {slot}
            </div>
          ))}
          <div className={`${styles.gantt_cell} ${styles['gantt_cell--header']} ${styles['gantt_cell--material']}`} role="columnheader">
            备料状态
          </div>
        </div>

        {/* 工作站数据行 */}
        {stations.map((station) => (
          <div key={station.stationId} className={styles.gantt_row} role="row">

            {/* 工作站标签格 */}
            <div className={`${styles.gantt_cell} ${styles['gantt_cell--station']}`} role="rowheader">
              <span className={styles.gantt_station_name}>{station.stationName}</span>
              <span className={styles.gantt_station_worker}>{station.workerInCharge}</span>
            </div>

            {/* 时间槽格：渲染 TaskBlock 或空格 */}
            {timeSlots.map((slot) => {
              const tasksInSlot = station.tasks.filter((t) => t.timeSlot === slot);
              return (
                <div
                  key={slot}
                  className={`${styles.gantt_cell} ${styles['gantt_cell--time']} ${styles['gantt_cell--slot']}`}
                  role="gridcell"
                >
                  {tasksInSlot.map((task) => (
                    <TaskBlock key={task.id} task={task} />
                  ))}
                </div>
              );
            })}

            {/* 备料状态格 */}
            <div className={`${styles.gantt_cell} ${styles['gantt_cell--material']}`} role="gridcell">
              <MaterialStatusCell status={station.materialStatus} />
            </div>
          </div>
        ))}
      </div>

      {/* 图例 SC-08 */}
      <GanttLegend />
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// T018 — TaskBlock：甘特图任务块（3 态）
// ─────────────────────────────────────────────────────────

interface TaskBlockProps {
  task: GanttTask;
}

function TaskBlock({ task }: TaskBlockProps) {
  return (
    <div
      className={`${styles.task_block} ${styles[`task_block--${task.status}`]}`}
      title={`${task.orderNo} ${task.processName} | ${task.workerName} | ${task.qty}${task.unit}`}
      /* T022 预留属性：draggable="true" */
      role="button"
      tabIndex={0}
      aria-label={`工单 ${task.orderNo}，${task.processName}，${task.workerName}，${task.qty}${task.unit}`}
    >
      <div className={styles.task_block__order}>{task.orderNo}</div>
      <div className={styles.task_block__process}>{task.processName}</div>
      <div className={styles.task_block__meta}>
        <span className={styles.task_block__worker}>{task.workerName}</span>
        <MaterialStatusIcon status={task.materialStatus} />
      </div>
    </div>
  );
}

/** 备料状态图标：勾/感叹号/叉 */
function MaterialStatusIcon({ status }: { status: MaterialStatus }) {
  if (status === 'ready')   return <span className={`${styles.material_icon} ${styles['material_icon--ready']}`} aria-label="料已备好" title="料已备好">&#10003;</span>;
  if (status === 'pending') return <span className={`${styles.material_icon} ${styles['material_icon--pending']}`} aria-label="待确认" title="待入库确认">&#33;</span>;
  return                           <span className={`${styles.material_icon} ${styles['material_icon--missing']}`} aria-label="缺料" title="缺料">&#10007;</span>;
}

/** 备料状态单元格（行尾列） */
function MaterialStatusCell({ status }: { status: MaterialStatus }) {
  if (status === 'ready')   return <StatusDot status="success" label="料已备好" />;
  if (status === 'pending') return <StatusDot status="warning" label="待入库" />;
  return                           <StatusDot status="danger"  label="缺料" />;
}

/** SC-08 — GanttLegend：甘特图图例 */
function GanttLegend() {
  return (
    <div className={styles.gantt_legend} aria-label="图例说明">
      <span className={styles.gantt_legend__title}>图例：</span>
      <span className={`${styles.gantt_legend__item} ${styles['gantt_legend__item--normal']}`}>正常</span>
      <span className={`${styles.gantt_legend__item} ${styles['gantt_legend__item--warning']}`}>有风险</span>
      <span className={`${styles.gantt_legend__item} ${styles['gantt_legend__item--danger']}`}>延误风险</span>
      <span className={styles.gantt_legend__divider} aria-hidden="true">|</span>
      <MaterialStatusIcon status="ready"   /> <span className={styles.gantt_legend__text}>料已就绪</span>
      <MaterialStatusIcon status="pending" /> <span className={styles.gantt_legend__text}>待入库</span>
      <MaterialStatusIcon status="missing" /> <span className={styles.gantt_legend__text}>缺料</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// T020 — WorkerTaskCards：工人卡片网格视图
// ─────────────────────────────────────────────────────────

interface WorkerTaskCardsProps {
  workers: WorkerCardData[];
  loading: boolean;
}

function WorkerTaskCards({ workers, loading }: WorkerTaskCardsProps) {
  if (loading) {
    return (
      <div className={styles.drawer_loading}>
        <div className="spinner" aria-label="加载中" />
        <span>加载工人任务...</span>
      </div>
    );
  }
  return (
    <div className={styles.worker_grid} role="list" aria-label="工人任务卡片">
      {workers.map((worker) => (
        <WorkerCard key={worker.workerId} worker={worker} />
      ))}
    </div>
  );
}

interface WorkerCardProps {
  worker: WorkerCardData;
}

function WorkerCard({ worker }: WorkerCardProps) {
  return (
    <article className={styles.worker_card} role="listitem" aria-label={`${worker.name} 的今日任务`}>
      {/* 卡片头：头像 + 基本信息 */}
      <header className={styles.worker_card__header}>
        <div className={styles.worker_card__avatar} aria-hidden="true">
          {worker.avatarInitial}
        </div>
        <div className={styles.worker_card__info}>
          <span className={styles.worker_card__name}>{worker.name}</span>
          <span className={styles.worker_card__station}>{worker.station}</span>
        </div>
        <Tag variant="neutral">{worker.taskCount} 项任务</Tag>
      </header>

      {/* 任务列表 */}
      <ul className={styles.worker_task_list} aria-label="任务明细">
        {worker.tasks.map((task, idx) => (
          <li key={idx} className={`${styles.worker_task_item} ${styles[`worker_task_item--${task.status}`]}`}>
            <div className={styles.worker_task_item__time}>{task.timeRange}</div>
            <div className={styles.worker_task_item__desc}>{task.description}</div>
            {task.priority === 'high' && (
              <span className={styles.worker_task_item__priority_badge} aria-label="高优先级">优先</span>
            )}
          </li>
        ))}
      </ul>
    </article>
  );
}

// ─────────────────────────────────────────────────────────
// T021 — StickyActionBar：底部固定确认操作栏
// ─────────────────────────────────────────────────────────

interface StickyActionBarProps {
  onCancel: () => void;
  onConfirm: () => void;
  confirmLoading: boolean;
}

function StickyActionBar({ onCancel, onConfirm, confirmLoading }: StickyActionBarProps) {
  return (
    <div className={styles.sticky_action_bar} role="toolbar" aria-label="排产确认操作">
      <p className={styles.sticky_action_bar__hint}>
        排产方案已就绪。确认后将推送任务至工人小程序。
      </p>
      <div className={styles.sticky_action_bar__buttons}>
        <Button variant="ghost" size="md" onClick={onCancel}>
          取消调整
        </Button>
        <Button variant="primary" size="md" loading={confirmLoading} onClick={onConfirm}>
          确认并下发给工人
        </Button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// 工单详情视图
// ─────────────────────────────────────────────────────────

function OrderDetailView({
  order,
  onStart,
  onComplete,
  startLoading,
  completeLoading,
}: {
  order: ProductionOrder;
  onStart: (id: string) => void;
  onComplete: (id: string) => void;
  startLoading: boolean;
  completeLoading: boolean;
}) {
  const pct = order.qty > 0 ? Math.round(((order.completedQty ?? 0) / order.qty) * 100) : 0;
  return (
    <div className={styles.order_detail}>
      <div className={styles.detail_grid}>
        <InfoRow label="工单号"   value={order.orderNo} />
        <InfoRow label="成品 SKU" value={`${order.skuName} (${order.skuCode})`} />
        <InfoRow label="计划数量" value={`${formatQtyStr(order.qty, 2)} ${order.unit}`} />
        <InfoRow label="完成数量" value={`${formatQtyStr(order.completedQty ?? 0, 2)} ${order.unit}`} />
        <InfoRow label="状态"     value={ORDER_STATUS_LABEL[order.status]} />
        <InfoRow label="优先级"   value={`P${order.priority ?? 3}`} />
        <InfoRow label="计划开始" value={formatDate(order.plannedStartDate)} />
        <InfoRow label="计划完成" value={formatDate(order.plannedEndDate)} />
        {order.actualStartDate && <InfoRow label="实际开始" value={formatDate(order.actualStartDate)} />}
        {order.actualEndDate   && <InfoRow label="实际完成" value={formatDate(order.actualEndDate)} />}
      </div>

      <div className={styles.detail_progress}>
        <div className={styles.detail_progress_header}>
          <span>生产进度</span>
          <span style={{ fontWeight: 700, color: pct >= 100 ? 'var(--color-success-600)' : 'var(--color-primary-600)' }}>{pct}%</span>
        </div>
        <div className={styles.detail_progress_bar}>
          <div
            className={styles.detail_progress_fill}
            style={{
              width: `${pct}%`,
              background: pct >= 100 ? 'var(--color-success-500)' : 'var(--color-primary-500)',
            }}
          />
        </div>
      </div>

      {order.tasks && order.tasks.length > 0 && (
        <div>
          <div className={styles.detail_section_title}>工序任务</div>
          {order.tasks.map((t) => (
            <div key={t.id} className={styles.task_item}>
              <div className={styles.task_item_header}>
                <span style={{ fontWeight: 500 }}>{t.taskName ?? t.taskNo}</span>
                <Tag variant={TASK_STATUS_VARIANT[t.status]}>{TASK_STATUS_LABEL[t.status]}</Tag>
              </div>
              {t.workerName && (
                <div className={styles.task_item_meta}>负责人：{t.workerName}</div>
              )}
              <div className={styles.task_item_actions}>
                {t.status === TaskStatus.PENDING && (
                  <Button variant="primary" size="sm" loading={startLoading} onClick={() => onStart(t.id)}>
                    开始任务
                  </Button>
                )}
                {t.status === TaskStatus.IN_PROGRESS && (
                  <Button variant="success" size="sm" loading={completeLoading} onClick={() => onComplete(t.id)}>
                    完成任务
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</span>
      <span style={{ fontSize: 'var(--text-body-m)', color: 'var(--text-primary)' }}>{value}</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// 新建工单表单
// ─────────────────────────────────────────────────────────

function CreateOrderFormUI({
  form,
  onChange,
}: {
  form: CreateOrderForm;
  onChange: React.Dispatch<React.SetStateAction<CreateOrderForm>>;
}) {
  const set = (field: keyof CreateOrderForm) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      onChange((f) => ({ ...f, [field]: e.target.value }));

  return (
    <div className={styles.create_form}>
      <div className={styles.form_row}>
        <div className={styles.form_field}>
          <label className={styles.form_label}>成品 SKU ID <span className={styles.required}>*</span></label>
          <input className={styles.form_input} value={form.skuId} onChange={set('skuId')} placeholder="SKU 内部 ID" />
        </div>
        <div className={styles.form_field}>
          <label className={styles.form_label}>BOM ID</label>
          <input className={styles.form_input} value={form.bomId} onChange={set('bomId')} placeholder="留空使用默认 BOM" />
        </div>
      </div>
      <div className={styles.form_row}>
        <div className={styles.form_field}>
          <label className={styles.form_label}>计划数量 <span className={styles.required}>*</span></label>
          <input className={styles.form_input} type="number" min="0" step="0.01" value={form.qty} onChange={set('qty')} placeholder="0.00" />
        </div>
        <div className={styles.form_field}>
          <label className={styles.form_label}>单位 <span className={styles.required}>*</span></label>
          <input className={styles.form_input} value={form.unit} onChange={set('unit')} placeholder="如：件" />
        </div>
      </div>
      <div className={styles.form_row}>
        <div className={styles.form_field}>
          <label className={styles.form_label}>计划开始日期 <span className={styles.required}>*</span></label>
          <input className={styles.form_input} type="date" value={form.plannedStartDate} onChange={set('plannedStartDate')} />
        </div>
        <div className={styles.form_field}>
          <label className={styles.form_label}>计划完成日期 <span className={styles.required}>*</span></label>
          <input className={styles.form_input} type="date" value={form.plannedEndDate} onChange={set('plannedEndDate')} />
        </div>
      </div>
      <div className={styles.form_field}>
        <label className={styles.form_label}>优先级</label>
        <select className={styles.form_input} value={form.priority} onChange={set('priority')}>
          {[1, 2, 3, 4, 5].map((p) => (
            <option key={p} value={p}>P{p}{p === 5 ? '（最高）' : p === 1 ? '（最低）' : ''}</option>
          ))}
        </select>
      </div>
    </div>
  );
}
