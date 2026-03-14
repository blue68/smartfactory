/**
 * [artifact:前端代码] — 生产任务管理页 (R-06)
 *
 * 功能范围：
 *   - 统计卡片行：总任务数 / 进行中 / 已完成 / 异常
 *   - 筛选栏：关键词搜索 + 状态下拉 + 日期范围 + 工序筛选
 *   - 任务列表表格（带分页）—— 点击行打开详情抽屉
 *   - 优先级标签（高优先级 / 普通）
 *   - 超时预警角标
 *   - 任务详情侧边抽屉：基本信息 / 生产数据 / SKU信息 / 异常记录 / 操作按钮
 *   - 开始任务：一键将 pending → in_progress
 *   - 完成任务弹窗：填写完成数量 + 备注
 *   - 上报异常弹窗：异常类型 / 严重程度 / 描述
 *   - 状态徽章：pending=待开始(grey) / in_progress=进行中(blue) / completed=已完成(green) / exception=异常(red)
 *
 * FE-06-01: 任务详情 Drawer
 * FE-06-02: 日期范围筛选
 * FE-06-03: 工序筛选下拉
 * FE-06-04: 优先级标签
 * FE-06-05: 超时预警角标
 *
 * API 来源：/api/productionTask.ts
 *   hooks: useTaskList / useTaskDetail / useStartTask / useCompleteTask / useReportException
 */

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useAppStore } from '@/stores/appStore';
import {
  useTaskList,
  useTaskDetail,
  useStartTask,
  useCompleteTask,
  useReportException,
} from '@/api/productionTask';
import Modal from '@/components/common/Modal';
import Button from '@/components/common/Button';
import Table from '@/components/common/Table';
import Drawer from '@/components/common/Drawer';
import type { Column } from '@/components/common/Table';
import styles from './TaskPage.module.css';

// ─── 类型定义 ─────────────────────────────────────────────

type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'exception';

type ExceptionType = '设备故障' | '物料缺失' | '质量异常' | '其他';
type ExceptionSeverity = 'low' | 'medium' | 'high';

interface TaskException {
  id: number;
  type: string;
  description: string;
  severity: string;
  createdAt: string;
  resolvedAt?: string;
}

interface ProductionTask {
  id: number;
  taskDate: string;
  orderNo: string;
  processName: string;
  workstationName: string;
  workerName: string;
  plannedQty: number;
  completedQty: number;
  scrapQty?: number;
  skuCode?: string;
  skuName?: string;
  status: TaskStatus;
  priority?: number;
  isOvertime?: boolean;
  maxHours?: number;
  actualHours?: number;
  exceptions?: TaskException[];
  [key: string]: unknown;
}

interface TaskListResponse {
  list: ProductionTask[];
  total: number;
}

// ─── 常量映射 ─────────────────────────────────────────────

const STATUS_LABEL: Record<TaskStatus, string> = {
  pending:     '待开始',
  in_progress: '进行中',
  completed:   '已完成',
  exception:   '异常',
};

const STATUS_BADGE_CLASS: Record<TaskStatus, string> = {
  pending:     styles.badgePending,
  in_progress: styles.badgeInProgress,
  completed:   styles.badgeCompleted,
  exception:   styles.badgeException,
};

const EXCEPTION_TYPES: ExceptionType[] = ['设备故障', '物料缺失', '质量异常', '其他'];

const SEVERITY_OPTIONS: { value: ExceptionSeverity; label: string }[] = [
  { value: 'low',    label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high',   label: '高' },
];

const SEVERITY_LABEL: Record<string, string> = {
  low:    '低',
  medium: '中',
  high:   '高',
};

const PAGE_SIZE = 20;

// ─── 工具函数 ─────────────────────────────────────────────

/** 判断任务是否超时：completedQty > 0 且实际工时 > maxHours × 1.2 */
function isTaskOvertime(task: ProductionTask): boolean {
  if (task.isOvertime === true) return true;
  if (
    task.completedQty > 0 &&
    task.maxHours != null &&
    task.actualHours != null &&
    task.actualHours > task.maxHours * 1.2
  ) {
    return true;
  }
  return false;
}

/** 优先级是否为高优：priority >= 80 */
function isHighPriority(task: ProductionTask): boolean {
  return typeof task.priority === 'number' && task.priority >= 80;
}

// ─── 主页面组件 ───────────────────────────────────────────

export default function TaskPage() {
  const { setPageTitle, showToast } = useAppStore();

  useEffect(() => { setPageTitle('生产任务管理'); }, [setPageTitle]);

  // ── 筛选状态 ────────────────────────────────────────────
  const [keyword, setKeyword]           = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [page, setPage]                 = useState(1);

  // FE-06-02: 日期范围
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo]     = useState('');
  const [dateError, setDateError] = useState('');

  // FE-06-03: 工序筛选
  const [processFilter, setProcessFilter] = useState('');

  // 防抖搜索关键词
  const [debouncedKeyword, setDebouncedKeyword] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => { setDebouncedKeyword(keyword); setPage(1); }, 400);
    return () => clearTimeout(timer);
  }, [keyword]);

  // 状态切换时重置分页
  const handleStatusChange = useCallback((v: string) => {
    setStatusFilter(v);
    setPage(1);
  }, []);

  // FE-06-02: 日期范围变化时验证并重置分页
  const handleDateFromChange = useCallback((v: string) => {
    setDateFrom(v);
    setDateError('');
    setPage(1);
  }, []);

  const handleDateToChange = useCallback((v: string) => {
    if (dateFrom && v && v < dateFrom) {
      setDateError('结束日期不能早于开始日期');
    } else {
      setDateError('');
    }
    setDateTo(v);
    setPage(1);
  }, [dateFrom]);

  const handleClearDates = useCallback(() => {
    setDateFrom('');
    setDateTo('');
    setDateError('');
    setPage(1);
  }, []);

  // FE-06-03: 工序筛选变化
  const handleProcessFilterChange = useCallback((v: string) => {
    setProcessFilter(v);
    setPage(1);
  }, []);

  // ── 数据查询 ──────────────────────────────────────────────
  const filter = {
    page,
    pageSize: PAGE_SIZE,
    status:   statusFilter || undefined,
    keyword:  debouncedKeyword || undefined,
    dateFrom: dateFrom || undefined,
    dateTo:   (dateTo && !dateError) ? dateTo : undefined,
    processId: processFilter ? Number(processFilter) : undefined,
  };

  const { data: rawData, isLoading, isError } = useTaskList(filter);

  // API 返回 {list, total} 或直接是数组 — 兼容两种格式
  const taskData: TaskListResponse = (() => {
    if (!rawData) return { list: [], total: 0 };
    if (Array.isArray(rawData)) return { list: rawData as ProductionTask[], total: (rawData as unknown[]).length };
    const d = rawData as unknown as TaskListResponse;
    return { list: d.list ?? [], total: d.total ?? 0 };
  })();

  // ── FE-06-03: 从任务列表提取唯一工序列表作为筛选选项
  const processOptions = useMemo(() => {
    const seen = new Set<string>();
    const opts: { label: string; value: string }[] = [];
    taskData.list.forEach((t) => {
      const key = t.processName;
      if (key && !seen.has(key)) {
        seen.add(key);
        opts.push({ label: key, value: key });
      }
    });
    return opts;
  }, [taskData.list]);

  // ── 统计卡片数据（从当前列表计算）
  const stats = {
    total:      taskData.total,
    inProgress: taskData.list.filter((t) => t.status === 'in_progress').length,
    completed:  taskData.list.filter((t) => t.status === 'completed').length,
    exception:  taskData.list.filter((t) => t.status === 'exception').length,
  };

  // ── 操作 mutations ─────────────────────────────────────────
  const startMutation    = useStartTask();
  const completeMutation = useCompleteTask();
  const exceptionMutation = useReportException();

  // ── FE-06-01: 任务详情抽屉状态 ────────────────────────────
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  const { data: taskDetailRaw, isLoading: detailLoading } = useTaskDetail(selectedTaskId);
  const taskDetail = taskDetailRaw as ProductionTask | undefined;

  const openDrawer = useCallback((task: ProductionTask) => {
    setSelectedTaskId(task.id);
  }, []);

  const closeDrawer = useCallback(() => {
    setSelectedTaskId(null);
  }, []);

  // ── 完成任务弹窗状态 ──────────────────────────────────────
  const [completeOpen, setCompleteOpen]   = useState(false);
  const [selectedTask, setSelectedTask]   = useState<ProductionTask | null>(null);
  const [completeQty, setCompleteQty]     = useState<string>('');
  const [completeNotes, setCompleteNotes] = useState('');
  const [completeError, setCompleteError] = useState('');

  const openCompleteModal = useCallback((task: ProductionTask) => {
    setSelectedTask(task);
    setCompleteQty('');
    setCompleteNotes('');
    setCompleteError('');
    setCompleteOpen(true);
  }, []);

  const handleComplete = useCallback(async () => {
    if (!selectedTask) return;
    const qty = Number(completeQty);
    if (!completeQty || isNaN(qty) || qty <= 0) {
      setCompleteError('请输入有效的完成数量（大于0的整数）');
      return;
    }
    try {
      await completeMutation.mutateAsync({
        taskId: selectedTask.id,
        data:   { completedQty: String(qty), notes: completeNotes || undefined },
      });
      showToast({ type: 'success', message: `任务 #${selectedTask.id} 已标记完成` });
      setCompleteOpen(false);
    } catch {
      showToast({ type: 'error', message: '操作失败，请稍后重试' });
    }
  }, [selectedTask, completeQty, completeNotes, completeMutation, showToast]);

  // ── 上报异常弹窗状态 ─────────────────────────────────────
  const [exceptionOpen, setExceptionOpen]         = useState(false);
  const [exceptionTask, setExceptionTask]         = useState<ProductionTask | null>(null);
  const [exceptionType, setExceptionType]         = useState<ExceptionType>('设备故障');
  const [exceptionSeverity, setExceptionSeverity] = useState<ExceptionSeverity>('medium');
  const [exceptionDesc, setExceptionDesc]         = useState('');
  const [exceptionError, setExceptionError]       = useState('');

  const openExceptionModal = useCallback((task: ProductionTask) => {
    setExceptionTask(task);
    setExceptionType('设备故障');
    setExceptionSeverity('medium');
    setExceptionDesc('');
    setExceptionError('');
    setExceptionOpen(true);
  }, []);

  const handleReportException = useCallback(async () => {
    if (!exceptionTask) return;
    if (!exceptionDesc.trim()) {
      setExceptionError('请填写异常描述');
      return;
    }
    try {
      await exceptionMutation.mutateAsync({
        taskId: exceptionTask.id,
        data:   { type: exceptionType, description: exceptionDesc, severity: exceptionSeverity },
      });
      showToast({ type: 'success', message: `任务 #${exceptionTask.id} 异常已上报` });
      setExceptionOpen(false);
    } catch {
      showToast({ type: 'error', message: '上报失败，请稍后重试' });
    }
  }, [exceptionTask, exceptionType, exceptionSeverity, exceptionDesc, exceptionMutation, showToast]);

  // ── 开始任务 ─────────────────────────────────────────────
  const handleStart = useCallback(async (task: ProductionTask) => {
    try {
      await startMutation.mutateAsync(task.id);
      showToast({ type: 'success', message: `任务 ${task.id} 已开始` });
    } catch {
      showToast({ type: 'error', message: '操作失败，请稍后重试' });
    }
  }, [startMutation, showToast]);

  // ── 从抽屉发起操作（与表格操作共用 handlers） ──────────────
  const handleStartFromDrawer = useCallback(async () => {
    if (!taskDetail) return;
    await handleStart(taskDetail as ProductionTask);
  }, [taskDetail, handleStart]);

  const handleCompleteFromDrawer = useCallback(() => {
    if (!taskDetail) return;
    openCompleteModal(taskDetail as ProductionTask);
  }, [taskDetail, openCompleteModal]);

  const handleExceptionFromDrawer = useCallback(() => {
    if (!taskDetail) return;
    openExceptionModal(taskDetail as ProductionTask);
  }, [taskDetail, openExceptionModal]);

  // ── 表格列定义 ───────────────────────────────────────────
  const columns: Column<ProductionTask>[] = [
    {
      key:   'taskDate',
      title: '任务日期',
      width: 110,
      render: (_, record) => (
        <span className={styles.taskNo}>{record.taskDate || '—'}</span>
      ),
    },
    {
      key:   'orderNo',
      title: '订单号',
      width: 130,
      render: (_, record) => (
        <span className={styles.orderNo}>{record.orderNo || '—'}</span>
      ),
    },
    {
      key:   'processName',
      title: '工序名称',
      width: 120,
      render: (_, record) => record.processName || '—',
    },
    {
      key:   'workstationName',
      title: '工作站',
      width: 110,
      render: (_, record) => record.workstationName || '—',
    },
    {
      key:   'workerName',
      title: '工人',
      width: 90,
      render: (_, record) => record.workerName || '—',
    },
    {
      key:   'plannedQty',
      title: '计划数量',
      width: 90,
      align: 'right',
      render: (_, record) => (
        <span className={styles.qtyValue}>{record.plannedQty ?? '—'}</span>
      ),
    },
    {
      key:   'completedQty',
      title: '已完成',
      width: 90,
      align: 'right',
      render: (_, record) => {
        const pct = record.plannedQty > 0
          ? Math.round((record.completedQty / record.plannedQty) * 100)
          : 0;
        return (
          <span className={styles.completedQty}>
            {record.completedQty ?? 0}
            {record.plannedQty > 0 && (
              <span className={styles.qtyPct}> ({pct}%)</span>
            )}
          </span>
        );
      },
    },
    // FE-06-04: 优先级列
    {
      key:   'priority',
      title: '优先级',
      width: 90,
      render: (_, record) => (
        isHighPriority(record)
          ? <span className={styles.priorityBadgeHigh}>高优先级</span>
          : <span className={styles.priorityBadgeNormal}>普通</span>
      ),
    },
    {
      key:   'status',
      title: '状态',
      width: 130,
      render: (_, record) => (
        <div className={styles.statusCell}>
          <span
            className={`${styles.statusBadge} ${STATUS_BADGE_CLASS[record.status] ?? styles.badgePending}`}
            aria-label={STATUS_LABEL[record.status] ?? record.status}
          >
            {STATUS_LABEL[record.status] ?? record.status}
          </span>
          {/* FE-06-05: 超时预警角标 */}
          {isTaskOvertime(record) && (
            <span className={styles.overtimeBadge} title="实际工时超出计划工时 20%">超时</span>
          )}
        </div>
      ),
    },
    {
      key:   '_actions',
      title: '操作',
      width: 200,
      render: (_, record) => (
        <div className={styles.actionGroup}>
          <Button variant="ghost" size="sm" onClick={() => openDrawer(record)}>详情</Button>
          {record.status === 'pending' && (
            <Button
              variant="primary"
              size="sm"
              loading={startMutation.isPending && startMutation.variables === record.id}
              onClick={() => void handleStart(record)}
            >
              开始
            </Button>
          )}
          {record.status === 'in_progress' && (
            <Button
              variant="success"
              size="sm"
              onClick={() => openCompleteModal(record)}
            >
              完成
            </Button>
          )}
          {(record.status === 'pending' || record.status === 'in_progress') && (
            <Button
              variant="danger"
              size="sm"
              onClick={() => openExceptionModal(record)}
            >
              上报异常
            </Button>
          )}
          {record.status === 'completed' && (
            <span className={styles.noAction}>—</span>
          )}
          {record.status === 'exception' && (
            <span className={styles.exceptionLabel}>已上报</span>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className={styles.page}>
      {/* ── 页面头部 ── */}
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>生产任务管理</h1>
          <p className={styles.pageSubtitle}>查看和管理今日生产任务，实时跟踪执行进度</p>
        </div>
      </div>

      {/* ── 统计卡片行 ── */}
      <div className={styles.statsRow} role="region" aria-label="任务统计">
        <StatCard
          label="总任务数"
          value={stats.total}
          iconClass={styles.iconTotal}
          icon="📋"
        />
        <StatCard
          label="进行中"
          value={stats.inProgress}
          iconClass={styles.iconInProgress}
          icon="⚡"
          variant="blue"
        />
        <StatCard
          label="已完成"
          value={stats.completed}
          iconClass={styles.iconCompleted}
          icon="✓"
          variant="green"
        />
        <StatCard
          label="异常"
          value={stats.exception}
          iconClass={styles.iconException}
          icon="⚠"
          variant="red"
        />
      </div>

      {/* ── 筛选栏 ── */}
      <div className={styles.filterBar}>
        {/* 关键词搜索 */}
        <div className={styles.searchWrap}>
          <span className={styles.searchIcon} aria-hidden="true">🔍</span>
          <input
            className={styles.searchInput}
            type="search"
            placeholder="搜索任务编号、订单号、工序..."
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            aria-label="关键词搜索"
          />
        </div>

        {/* 状态筛选 */}
        <select
          className={styles.select}
          value={statusFilter}
          onChange={(e) => handleStatusChange(e.target.value)}
          aria-label="状态筛选"
        >
          <option value="">全部状态</option>
          <option value="pending">待开始</option>
          <option value="in_progress">进行中</option>
          <option value="completed">已完成</option>
          <option value="exception">异常</option>
        </select>

        {/* FE-06-03: 工序筛选 */}
        <select
          className={styles.select}
          value={processFilter}
          onChange={(e) => handleProcessFilterChange(e.target.value)}
          aria-label="工序筛选"
        >
          <option value="">全部工序</option>
          {processOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>

        {/* FE-06-02: 日期范围筛选 */}
        <div className={styles.dateRangeWrap}>
          <label className={styles.dateRangeLabel} htmlFor="date-from">日期</label>
          <input
            id="date-from"
            className={`${styles.dateInput} ${dateError ? styles.dateInputError : ''}`}
            type="date"
            value={dateFrom}
            onChange={(e) => handleDateFromChange(e.target.value)}
            aria-label="开始日期"
          />
          <span className={styles.dateRangeSep}>至</span>
          <input
            id="date-to"
            className={`${styles.dateInput} ${dateError ? styles.dateInputError : ''}`}
            type="date"
            value={dateTo}
            min={dateFrom || undefined}
            onChange={(e) => handleDateToChange(e.target.value)}
            aria-label="结束日期"
            aria-describedby={dateError ? 'date-error' : undefined}
          />
          {(dateFrom || dateTo) && (
            <button
              type="button"
              className={styles.dateClearBtn}
              onClick={handleClearDates}
              aria-label="清除日期筛选"
            >
              ×
            </button>
          )}
          {dateError && (
            <span id="date-error" className={styles.dateError} role="alert">{dateError}</span>
          )}
        </div>
      </div>

      {/* ── 任务表格 ── */}
      <div className={styles.tableCard}>
        <Table<ProductionTask>
          columns={columns}
          dataSource={taskData.list}
          rowKey={(r) => r.id}
          loading={isLoading}
          error={isError ? '任务列表加载失败，请刷新重试' : null}
          emptyText="暂无符合条件的生产任务"
          pagination={
            taskData.total > PAGE_SIZE
              ? {
                  page,
                  pageSize: PAGE_SIZE,
                  total: taskData.total,
                  onChange: setPage,
                }
              : undefined
          }
        />
      </div>

      {/* ── FE-06-01: 任务详情侧边抽屉 ── */}
      <Drawer
        open={selectedTaskId !== null}
        title="任务详情"
        onClose={closeDrawer}
        width={480}
        footer={
          taskDetail ? (
            <TaskDrawerFooter
              task={taskDetail as ProductionTask}
              startLoading={startMutation.isPending}
              completeLoading={completeMutation.isPending}
              onStart={() => void handleStartFromDrawer()}
              onComplete={handleCompleteFromDrawer}
              onException={handleExceptionFromDrawer}
            />
          ) : null
        }
      >
        <TaskDetailContent
          task={taskDetail as ProductionTask | undefined}
          loading={detailLoading}
        />
      </Drawer>

      {/* ── 完成任务弹窗 ── */}
      <CompleteTaskModal
        open={completeOpen}
        task={selectedTask}
        qty={completeQty}
        notes={completeNotes}
        error={completeError}
        loading={completeMutation.isPending}
        onQtyChange={(v) => { setCompleteQty(v); setCompleteError(''); }}
        onNotesChange={setCompleteNotes}
        onClose={() => setCompleteOpen(false)}
        onConfirm={() => void handleComplete()}
      />

      {/* ── 上报异常弹窗 ── */}
      <ExceptionModal
        open={exceptionOpen}
        task={exceptionTask}
        exceptionType={exceptionType}
        severity={exceptionSeverity}
        description={exceptionDesc}
        error={exceptionError}
        loading={exceptionMutation.isPending}
        onTypeChange={setExceptionType}
        onSeverityChange={setExceptionSeverity}
        onDescriptionChange={(v) => { setExceptionDesc(v); setExceptionError(''); }}
        onClose={() => setExceptionOpen(false)}
        onConfirm={() => void handleReportException()}
      />
    </div>
  );
}

// ─── StatCard — 统计卡片 ─────────────────────────────────

interface StatCardProps {
  label: string;
  value: number;
  icon: string;
  iconClass: string;
  variant?: 'default' | 'blue' | 'green' | 'red';
}

function StatCard({ label, value, icon, iconClass, variant = 'default' }: StatCardProps) {
  return (
    <div className={`${styles.statCard} ${styles[`statCard--${variant}`]}`}>
      <div className={`${styles.statIconWrap} ${iconClass}`} aria-hidden="true">
        {icon}
      </div>
      <div className={styles.statContent}>
        <div className={styles.statValue}>{value}</div>
        <div className={styles.statLabel}>{label}</div>
      </div>
    </div>
  );
}

// ─── TaskDetailContent — 抽屉主体内容 ───────────────────

interface TaskDetailContentProps {
  task: ProductionTask | undefined;
  loading: boolean;
}

function TaskDetailContent({ task, loading }: TaskDetailContentProps) {
  if (loading) {
    return (
      <div className={styles.drawerLoading}>
        <div className={styles.skeletonLine} style={{ width: '60%' }} />
        <div className={styles.skeletonLine} style={{ width: '80%' }} />
        <div className={styles.skeletonLine} style={{ width: '50%' }} />
        <div className={styles.skeletonLine} style={{ width: '70%' }} />
      </div>
    );
  }

  if (!task) {
    return <div className={styles.drawerEmpty}>暂无任务详情</div>;
  }

  const overtime = isTaskOvertime(task);

  return (
    <div className={styles.drawerContent}>
      {/* 基本信息 */}
      <section className={styles.drawerSection}>
        <h3 className={styles.drawerSectionTitle}>基本信息</h3>
        <dl className={styles.infoGrid}>
          <DetailItem label="任务日期" value={task.taskDate || '—'} />
          <DetailItem label="订单号"   value={task.orderNo || '—'} />
          <DetailItem label="工序名称" value={task.processName || '—'} />
          <DetailItem label="工作站"   value={task.workstationName || '—'} />
          <DetailItem label="工人"     value={task.workerName || '—'} />
          <DetailItem
            label="状态"
            value={
              <span
                className={`${styles.statusBadge} ${STATUS_BADGE_CLASS[task.status] ?? styles.badgePending}`}
              >
                {STATUS_LABEL[task.status] ?? task.status}
              </span>
            }
          />
        </dl>
      </section>

      {/* 生产数据 */}
      <section className={styles.drawerSection}>
        <h3 className={styles.drawerSectionTitle}>生产数据</h3>
        <dl className={styles.infoGrid}>
          <DetailItem label="计划数量" value={String(task.plannedQty ?? '—')} />
          <DetailItem label="已完成"   value={String(task.completedQty ?? 0)} />
          <DetailItem label="报废数量" value={String(task.scrapQty ?? 0)} />
          {overtime && (
            <DetailItem
              label="超时预警"
              value={<span className={styles.overtimeBadge}>超时</span>}
            />
          )}
        </dl>
      </section>

      {/* SKU 信息 */}
      {(task.skuCode || task.skuName) && (
        <section className={styles.drawerSection}>
          <h3 className={styles.drawerSectionTitle}>SKU 信息</h3>
          <dl className={styles.infoGrid}>
            {task.skuCode && <DetailItem label="SKU 编码" value={task.skuCode} />}
            {task.skuName && <DetailItem label="SKU 名称" value={task.skuName} />}
          </dl>
        </section>
      )}

      {/* 异常记录 */}
      <section className={styles.drawerSection}>
        <h3 className={styles.drawerSectionTitle}>异常记录</h3>
        {(!task.exceptions || task.exceptions.length === 0) ? (
          <p className={styles.drawerEmptyText}>暂无异常记录</p>
        ) : (
          <ul className={styles.exceptionTimeline}>
            {task.exceptions.map((exc) => (
              <li key={exc.id} className={styles.exceptionTimelineItem}>
                <span className={styles.exceptionDot} />
                <div className={styles.exceptionTimelineBody}>
                  <div className={styles.exceptionTimelineHeader}>
                    <span className={styles.exceptionTypeTag}>{exc.type}</span>
                    <span className={styles.exceptionSeverityTag} data-severity={exc.severity}>
                      严重度：{SEVERITY_LABEL[exc.severity] ?? exc.severity}
                    </span>
                    {exc.resolvedAt && (
                      <span className={styles.exceptionResolvedTag}>已处理</span>
                    )}
                  </div>
                  <p className={styles.exceptionDesc}>{exc.description}</p>
                  <time className={styles.exceptionTime} dateTime={exc.createdAt}>
                    上报时间：{exc.createdAt}
                  </time>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// ─── DetailItem — 信息条目 ──────────────────────────────

interface DetailItemProps {
  label: string;
  value: string | React.ReactNode;
}

function DetailItem({ label, value }: DetailItemProps) {
  return (
    <>
      <dt className={styles.infoLabel}>{label}</dt>
      <dd className={styles.infoValue}>{value}</dd>
    </>
  );
}

// ─── TaskDrawerFooter — 抽屉底部操作按钮 ────────────────

interface TaskDrawerFooterProps {
  task: ProductionTask;
  startLoading: boolean;
  completeLoading: boolean;
  onStart: () => void;
  onComplete: () => void;
  onException: () => void;
}

function TaskDrawerFooter({
  task,
  startLoading,
  completeLoading,
  onStart,
  onComplete,
  onException,
}: TaskDrawerFooterProps) {
  if (task.status === 'pending') {
    return (
      <div className={styles.drawerFooterActions}>
        <Button
          variant="primary"
          size="md"
          loading={startLoading}
          onClick={onStart}
          style={{ width: '100%' }}
        >
          开始生产
        </Button>
      </div>
    );
  }

  if (task.status === 'in_progress') {
    return (
      <div className={styles.drawerFooterActions}>
        <Button
          variant="success"
          size="md"
          loading={completeLoading}
          onClick={onComplete}
          style={{ flex: 1 }}
        >
          完工上报
        </Button>
        <Button
          variant="danger"
          size="md"
          onClick={onException}
          style={{ flex: 1 }}
        >
          处理异常
        </Button>
      </div>
    );
  }

  if (task.status === 'exception') {
    return (
      <div className={styles.drawerFooterActions}>
        <Button
          variant="danger"
          size="md"
          onClick={onException}
          style={{ width: '100%' }}
        >
          处理异常
        </Button>
      </div>
    );
  }

  return null;
}

// ─── CompleteTaskModal — 完成任务弹窗 ────────────────────

interface CompleteTaskModalProps {
  open: boolean;
  task: ProductionTask | null;
  qty: string;
  notes: string;
  error: string;
  loading: boolean;
  onQtyChange: (v: string) => void;
  onNotesChange: (v: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}

function CompleteTaskModal({
  open,
  task,
  qty,
  notes,
  error,
  loading,
  onQtyChange,
  onNotesChange,
  onClose,
  onConfirm,
}: CompleteTaskModalProps) {
  return (
    <Modal
      open={open}
      title="标记任务完成"
      onClose={onClose}
      onConfirm={onConfirm}
      confirmLabel="确认完成"
      confirmVariant="success"
      confirmLoading={loading}
      size="sm"
    >
      {task && (
        <div className={styles.modalForm}>
          <div className={styles.modalTaskInfo}>
            <span className={styles.modalTaskLabel}>任务</span>
            <span className={styles.modalTaskValue}>{task.id}</span>
            <span className={styles.modalTaskSep}>·</span>
            <span className={styles.modalTaskValue}>{task.processName}</span>
            <span className={styles.modalTaskSep}>·</span>
            <span className={styles.modalTaskSecondary}>计划 {task.plannedQty} 件</span>
          </div>

          <div className={styles.formGroup}>
            <label htmlFor="complete-qty" className={styles.formLabel}>
              完成数量 <span className={styles.formRequired} aria-label="必填">*</span>
            </label>
            <input
              id="complete-qty"
              type="number"
              min="1"
              step="1"
              className={`${styles.formInput} ${error ? styles.formInputError : ''}`}
              placeholder={`请输入完成数量（计划 ${task.plannedQty}）`}
              value={qty}
              onChange={(e) => onQtyChange(e.target.value)}
              aria-describedby={error ? 'complete-qty-error' : undefined}
              autoFocus
            />
            {error && (
              <p id="complete-qty-error" className={styles.formError} role="alert">
                {error}
              </p>
            )}
          </div>

          <div className={styles.formGroup}>
            <label htmlFor="complete-notes" className={styles.formLabel}>
              备注（选填）
            </label>
            <textarea
              id="complete-notes"
              className={styles.formTextarea}
              rows={3}
              placeholder="请填写完成说明、质量情况等..."
              value={notes}
              onChange={(e) => onNotesChange(e.target.value)}
            />
          </div>
        </div>
      )}
    </Modal>
  );
}

// ─── ExceptionModal — 上报异常弹窗 ──────────────────────

interface ExceptionModalProps {
  open: boolean;
  task: ProductionTask | null;
  exceptionType: ExceptionType;
  severity: ExceptionSeverity;
  description: string;
  error: string;
  loading: boolean;
  onTypeChange: (v: ExceptionType) => void;
  onSeverityChange: (v: ExceptionSeverity) => void;
  onDescriptionChange: (v: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}

function ExceptionModal({
  open,
  task,
  exceptionType,
  severity,
  description,
  error,
  loading,
  onTypeChange,
  onSeverityChange,
  onDescriptionChange,
  onClose,
  onConfirm,
}: ExceptionModalProps) {
  return (
    <Modal
      open={open}
      title="上报生产异常"
      onClose={onClose}
      onConfirm={onConfirm}
      confirmLabel="确认上报"
      confirmVariant="danger"
      confirmLoading={loading}
      size="sm"
    >
      {task && (
        <div className={styles.modalForm}>
          <div className={styles.modalTaskInfo}>
            <span className={styles.modalTaskLabel}>任务</span>
            <span className={styles.modalTaskValue}>{task.id}</span>
            <span className={styles.modalTaskSep}>·</span>
            <span className={styles.modalTaskValue}>{task.processName}</span>
          </div>

          <div className={styles.formRow}>
            <div className={styles.formGroup}>
              <label htmlFor="exception-type" className={styles.formLabel}>
                异常类型 <span className={styles.formRequired} aria-label="必填">*</span>
              </label>
              <select
                id="exception-type"
                className={styles.formSelect}
                value={exceptionType}
                onChange={(e) => onTypeChange(e.target.value as ExceptionType)}
              >
                {EXCEPTION_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="exception-severity" className={styles.formLabel}>
                严重程度 <span className={styles.formRequired} aria-label="必填">*</span>
              </label>
              <select
                id="exception-severity"
                className={`${styles.formSelect} ${styles[`formSelectSeverity--${severity}`]}`}
                value={severity}
                onChange={(e) => onSeverityChange(e.target.value as ExceptionSeverity)}
              >
                {SEVERITY_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className={styles.formGroup}>
            <label htmlFor="exception-desc" className={styles.formLabel}>
              异常描述 <span className={styles.formRequired} aria-label="必填">*</span>
            </label>
            <textarea
              id="exception-desc"
              className={`${styles.formTextarea} ${error ? styles.formInputError : ''}`}
              rows={4}
              placeholder="请详细描述异常情况，包括发现时间、影响范围等..."
              value={description}
              onChange={(e) => onDescriptionChange(e.target.value)}
              aria-describedby={error ? 'exception-desc-error' : undefined}
              autoFocus
            />
            {error && (
              <p id="exception-desc-error" className={styles.formError} role="alert">
                {error}
              </p>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
