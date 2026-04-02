/**
 * [artifact:前端代码] — 生产任务管理页 (R-06)
 *
 * 功能范围：
 *   - 统计卡片行：总任务数 / 进行中 / 已完成 / 异常（独立 stats 接口，countUp 动画）
 *   - 筛选栏：关键词搜索(300ms debounce) + 状态下拉 + 日期范围 + 工序筛选
 *   - 任务列表表格（含产品名称、计划完成时间列）—— 点击行打开详情抽屉
 *   - 超时预警行级背景高亮（红色左边框 + #FFF1F0 背景）
 *   - 任务详情侧边抽屉：基本信息 / 生产数据 / SKU信息 / 异常记录 / 操作按钮
 *   - 开始任务：多任务并行确认弹窗
 *   - 完成任务弹窗：完成件数 + 实际工时 + 工资预览卡片 + 超时预警横幅
 *   - 上报异常弹窗：卡片式单选类型 + 影响生产进度 + 10字最少描述
 *   - 已挂起状态：主管视角抽屉底部「标记已处理」「挂起任务」按钮
 *   - 统计卡片点击筛选联动
 *
 * R06-G01: 统计卡片改用独立接口 + countUp 动画
 * R06-G02: 完工上报弹窗补充实际工时 + 工资预览 + 超时预警
 * R06-G03: 异常上报改为卡片式单选 + 影响进度 + 10字校验
 * R06-G05: 已挂起状态 + 主管处置弹窗
 * R06-G06: 统计卡片点击筛选联动
 * R06-G08: 表格增加产品名称、计划完成时间列
 * R06-G09: 开始生产多任务并行确认
 */

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useAppStore } from '@/stores/appStore';
import { useAuthStore } from '@/stores/authStore';
import { UserRole } from '@/types/enums';
import {
  useTaskList,
  useTaskDetail,
  useTaskStats,
  useStartTask,
  useCompleteTask,
  useReportException,
  useResolveException,
  useSuspendTask,
} from '@/api/productionTask';
import Modal from '@/components/common/Modal';
import Button from '@/components/common/Button';
import Table from '@/components/common/Table';
import Drawer from '@/components/common/Drawer';
import type { Column } from '@/components/common/Table';
import styles from './TaskPage.module.css';

// ─── 类型定义 ─────────────────────────────────────────────

type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'exception' | 'suspended';

type ExceptionType = '设备故障' | '物料缺失' | '质量异常' | '其他';

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
  taskNo?: string;
  taskDate: string;
  orderNo: string;
  productName?: string;
  plannedFinishTime?: string;
  processStepId?: number;
  processName: string;
  operationId?: number | null;
  outputSkuId?: number | null;
  outputSkuName?: string | null;
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
  unitPrice?: number;
  workerGrade?: string;
  workerGradeConfigured?: boolean;
  dependencySummary?: {
    blocked: boolean;
    blockingReason: string | null;
    predecessors: Array<{
      operationId: number;
      stepName: string;
      requiredQty: string;
      completedQty: string;
      status: string;
    }>;
  };
  materialTransactions?: Array<{
    id: number;
    ioType: 'input' | 'output';
    skuId: number;
    skuCode: string | null;
    skuName: string | null;
    plannedQty: string;
    actualQty: string;
    inventoryTxId: number | null;
    transactionNo: string | null;
    transactionType: string | null;
    direction: 'IN' | 'OUT' | null;
    transactionQty: string | null;
    transactionTime: string | null;
    referenceNo: string | null;
  }>;
  wageReport?: {
    reportId: number;
    reportNo: string;
    reportDate: string;
    workerGrade: string;
    stepName: string;
    qtyQualified: string;
    workHours: string;
    unitPrice: string;
    subtotal: string;
  } | null;
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
  suspended:   '已挂起',
};

const STATUS_BADGE_CLASS: Record<TaskStatus, string> = {
  pending:     styles.badgePending,
  in_progress: styles.badgeInProgress,
  completed:   styles.badgeCompleted,
  exception:   styles.badgeException,
  suspended:   styles.badgeSuspended,
};

const EXCEPTION_TYPES: { value: ExceptionType; icon: string; desc: string }[] = [
  { value: '设备故障', icon: '⚙', desc: '机器设备损坏或故障导致停产' },
  { value: '物料缺失', icon: '📦', desc: '原材料不足或配件缺货' },
  { value: '质量异常', icon: '🔍', desc: '产品质量不达标需返工' },
  { value: '其他',     icon: '📝', desc: '其他未分类的生产异常' },
];

const PAGE_SIZE = 20;

// ─── 工具函数 ─────────────────────────────────────────────

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

function isHighPriority(task: ProductionTask): boolean {
  return typeof task.priority === 'number' && task.priority >= 80;
}

function formatDate(dateStr: string | undefined): string {
  if (!dateStr) return '—';
  try {
    return dateStr.slice(0, 10);
  } catch {
    return dateStr;
  }
}

function formatTaskLabel(task: Pick<ProductionTask, 'id' | 'taskNo'> | null | undefined): string {
  if (!task) return '—';
  return task.taskNo || `任务 #${task.id}`;
}

function formatQty(value: string | number | undefined | null): string {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) return '0';
  return Number.isInteger(numeric) ? `${numeric}` : numeric.toFixed(2);
}

// ─── countUp hook ─────────────────────────────────────────

function useCountUp(target: number, duration = 600): number {
  const [value, setValue] = useState(0);
  const rafRef = useRef<number | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const startValueRef = useRef(0);

  useEffect(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
    }
    startValueRef.current = value;
    startTimeRef.current = null;

    const animate = (timestamp: number) => {
      if (startTimeRef.current === null) {
        startTimeRef.current = timestamp;
      }
      const elapsed = timestamp - startTimeRef.current;
      const progress = Math.min(elapsed / duration, 1);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(startValueRef.current + (target - startValueRef.current) * eased);
      setValue(current);
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(animate);
      }
    };

    rafRef.current = requestAnimationFrame(animate);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
    // only re-run when target changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, duration]);

  return value;
}

// ─── 主页面组件 ───────────────────────────────────────────

export default function TaskPage() {
  const { setPageTitle, showToast } = useAppStore();
  const { hasAnyRole } = useAuthStore();

  // 是否是主管/管理员视角（可以处理异常）
  const isSupervisor = hasAnyRole([UserRole.SUPERVISOR, UserRole.BOSS]);

  useEffect(() => { setPageTitle('生产任务管理'); }, [setPageTitle]);

  // ── 筛选状态 ────────────────────────────────────────────
  const [keyword, setKeyword]           = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [page, setPage]                 = useState(1);

  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo]     = useState('');
  const [dateError, setDateError] = useState('');

  const [processFilter, setProcessFilter] = useState('');

  // R06-G07: 300ms debounce（设计稿要求）
  const [debouncedKeyword, setDebouncedKeyword] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => { setDebouncedKeyword(keyword); setPage(1); }, 300);
    return () => clearTimeout(timer);
  }, [keyword]);

  const handleStatusChange = useCallback((v: string) => {
    setStatusFilter(v);
    setPage(1);
  }, []);

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

  const taskData: TaskListResponse = (() => {
    if (!rawData) return { list: [], total: 0 };
    if (Array.isArray(rawData)) return { list: rawData as ProductionTask[], total: (rawData as unknown[]).length };
    const d = rawData as unknown as TaskListResponse;
    return { list: d.list ?? [], total: d.total ?? 0 };
  })();

  // ── 工序筛选选项（从列表动态提取）
  const processOptions = useMemo(() => {
    const seen = new Set<number>();
    const opts: { label: string; value: string }[] = [];
    taskData.list.forEach((t) => {
      const key = Number(t.processStepId ?? 0);
      if (key > 0 && !seen.has(key)) {
        seen.add(key);
        opts.push({ label: t.processName, value: String(key) });
      }
    });
    return opts;
  }, [taskData.list]);

  // ── R06-G01: 统计卡片使用独立 stats 接口 ──────────────────
  const { data: statsData } = useTaskStats();
  const stats = {
    total:      statsData?.total                    ?? taskData.total,
    inProgress: statsData?.byStatus?.in_progress    ?? 0,
    completed:  statsData?.byStatus?.completed      ?? 0,
    exception:  statsData?.byStatus?.exception      ?? 0,
    suspended:  statsData?.byStatus?.suspended      ?? 0,
  };

  // ── 操作 mutations ─────────────────────────────────────────
  const startMutation     = useStartTask();
  const completeMutation  = useCompleteTask();
  const exceptionMutation = useReportException();
  const resolveMutation   = useResolveException();
  const suspendMutation   = useSuspendTask();

  // ── 任务详情抽屉状态 ────────────────────────────────────────
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
  const [completeOpen, setCompleteOpen]       = useState(false);
  const [selectedTask, setSelectedTask]       = useState<ProductionTask | null>(null);
  const [completeQty, setCompleteQty]         = useState<string>('');
  const [completeScrapQty, setCompleteScrapQty] = useState<string>('');
  const [completeHours, setCompleteHours]     = useState<string>('');
  const [completeNotes, setCompleteNotes]     = useState('');
  const [completeError, setCompleteError]     = useState('');
  const [completeHoursError, setCompleteHoursError] = useState('');

  const openCompleteModal = useCallback((task: ProductionTask) => {
    setSelectedTask(task);
    setCompleteQty('');
    setCompleteScrapQty('');
    setCompleteHours('');
    setCompleteNotes('');
    setCompleteError('');
    setCompleteHoursError('');
    setCompleteOpen(true);
  }, []);

  const handleComplete = useCallback(async () => {
    if (!selectedTask) return;
    const qty = Number(completeQty);
    const hours = Number(completeHours);
    let hasError = false;
    if (!completeQty || isNaN(qty) || qty <= 0) {
      setCompleteError('请输入有效的完成数量（大于0的整数）');
      hasError = true;
    }
    if (!completeHours || isNaN(hours) || hours <= 0) {
      setCompleteHoursError('请输入有效的实际工时（大于0）');
      hasError = true;
    }
    if (hasError) return;

    try {
      const scrap = Number(completeScrapQty);
      await completeMutation.mutateAsync({
        taskId: selectedTask.id,
        data:   {
          completedQty: String(qty),
          actualHours:  String(hours),
          notes:        completeNotes || undefined,
          ...(completeScrapQty && !isNaN(scrap) && scrap >= 0 && { scrapQty: String(scrap) }),
        },
      });
      showToast({ type: 'success', message: `任务 #${selectedTask.id} 已标记完成` });
      setCompleteOpen(false);
    } catch {
      showToast({ type: 'error', message: '操作失败，请稍后重试' });
    }
  }, [selectedTask, completeQty, completeHours, completeNotes, completeScrapQty, completeMutation, showToast]);

  // ── 上报异常弹窗状态 ─────────────────────────────────────
  const [exceptionOpen, setExceptionOpen]             = useState(false);
  const [exceptionTask, setExceptionTask]             = useState<ProductionTask | null>(null);
  const [exceptionType, setExceptionType]             = useState<ExceptionType>('设备故障');
  const [exceptionAffects, setExceptionAffects]       = useState<boolean | null>(null);
  const [exceptionDesc, setExceptionDesc]             = useState('');
  const [exceptionError, setExceptionError]           = useState('');

  const openExceptionModal = useCallback((task: ProductionTask) => {
    setExceptionTask(task);
    setExceptionType('设备故障');
    setExceptionAffects(null);
    setExceptionDesc('');
    setExceptionError('');
    setExceptionOpen(true);
  }, []);

  const handleReportException = useCallback(async () => {
    if (!exceptionTask) return;
    if (exceptionDesc.trim().length < 10) {
      setExceptionError('异常描述至少需要10个字符');
      return;
    }
    if (exceptionAffects === null) {
      setExceptionError('请选择是否影响生产进度');
      return;
    }
    try {
      await exceptionMutation.mutateAsync({
        taskId: exceptionTask.id,
        data:   {
          type:            exceptionType,
          description:     exceptionDesc,
          affectsProgress: exceptionAffects,
          severity:        exceptionAffects ? 'high' : 'medium',
        },
      });
      showToast({ type: 'success', message: `任务 #${exceptionTask.id} 异常已上报` });
      setExceptionOpen(false);
    } catch {
      showToast({ type: 'error', message: '上报失败，请稍后重试' });
    }
  }, [exceptionTask, exceptionType, exceptionAffects, exceptionDesc, exceptionMutation, showToast]);

  // ── R06-G05: 标记已处理弹窗状态 ──────────────────────────
  const [resolveOpen, setResolveOpen]       = useState(false);
  const [resolveTask, setResolveTask]       = useState<ProductionTask | null>(null);
  const [resolveText, setResolveText]       = useState('');
  const [resolveError, setResolveError]     = useState('');

  const openResolveModal = useCallback((task: ProductionTask) => {
    setResolveTask(task);
    setResolveText('');
    setResolveError('');
    setResolveOpen(true);
  }, []);

  const handleResolve = useCallback(async () => {
    if (!resolveTask) return;
    if (!resolveText.trim()) {
      setResolveError('请填写处理说明');
      return;
    }
    try {
      await resolveMutation.mutateAsync({
        taskId: resolveTask.id,
        data:   { resolution: resolveText },
      });
      showToast({ type: 'success', message: `异常已标记处理，任务恢复进行中` });
      setResolveOpen(false);
    } catch {
      showToast({ type: 'error', message: '操作失败，请稍后重试' });
    }
  }, [resolveTask, resolveText, resolveMutation, showToast]);

  // ── R06-G05: 挂起任务弹窗状态 ─────────────────────────────
  const [suspendOpen, setSuspendOpen]       = useState(false);
  const [suspendTask, setSuspendTask]       = useState<ProductionTask | null>(null);
  const [suspendReason, setSuspendReason]   = useState('');
  const [suspendError, setSuspendError]     = useState('');

  const openSuspendModal = useCallback((task: ProductionTask) => {
    setSuspendTask(task);
    setSuspendReason('');
    setSuspendError('');
    setSuspendOpen(true);
  }, []);

  const handleSuspend = useCallback(async () => {
    if (!suspendTask) return;
    if (!suspendReason.trim()) {
      setSuspendError('请填写挂起原因（必填）');
      return;
    }
    try {
      await suspendMutation.mutateAsync({
        taskId: suspendTask.id,
        data:   { reason: suspendReason },
      });
      showToast({ type: 'success', message: `任务 #${suspendTask.id} 已挂起` });
      setSuspendOpen(false);
    } catch {
      showToast({ type: 'error', message: '操作失败，请稍后重试' });
    }
  }, [suspendTask, suspendReason, suspendMutation, showToast]);

  // ── R06-G09: 开始任务（多任务并行确认） ─────────────────────
  const [parallelConfirmOpen, setParallelConfirmOpen] = useState(false);
  const [parallelTask, setParallelTask]               = useState<ProductionTask | null>(null);
  const parallelCount = taskData.list.filter((t) => t.status === 'in_progress').length;

  const handleStart = useCallback(async (task: ProductionTask) => {
    // 检查是否有并行中的任务（此处取当前列表中 in_progress 数量作为检测）
    if (parallelCount > 0) {
      setParallelTask(task);
      setParallelConfirmOpen(true);
      return;
    }
    await doStart(task);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parallelCount]);

  const doStart = useCallback(async (task: ProductionTask) => {
    try {
      await startMutation.mutateAsync(task.id);
      showToast({ type: 'success', message: `任务 ${task.id} 已开始` });
    } catch {
      showToast({ type: 'error', message: '操作失败，请稍后重试' });
    }
  }, [startMutation, showToast]);

  const handleParallelConfirm = useCallback(async () => {
    if (!parallelTask) return;
    setParallelConfirmOpen(false);
    await doStart(parallelTask);
  }, [parallelTask, doStart]);

  // ── 从抽屉发起操作 ──────────────────────────────────────
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

  const handleResolveFromDrawer = useCallback(() => {
    if (!taskDetail) return;
    openResolveModal(taskDetail as ProductionTask);
  }, [taskDetail, openResolveModal]);

  const handleSuspendFromDrawer = useCallback(() => {
    if (!taskDetail) return;
    openSuspendModal(taskDetail as ProductionTask);
  }, [taskDetail, openSuspendModal]);

  // ── R06-G06: 统计卡片点击筛选联动 ────────────────────────
  const handleStatCardClick = useCallback((status: string) => {
    const newStatus = statusFilter === status ? '' : status;
    setStatusFilter(newStatus);
    setPage(1);
  }, [statusFilter]);

  // ── R06-G08: 表格列定义（新增产品名称、计划完成时间） ───────
  const columns: Column<ProductionTask>[] = [
    {
      key:   'orderNo',
      title: '工单号',
      width: 130,
      render: (_, record) => (
        <div className={styles.orderCell}>
          <span className={styles.orderNo}>{record.orderNo || '—'}</span>
          <span className={styles.taskMicroLabel}>{formatTaskLabel(record)}</span>
        </div>
      ),
    },
    {
      key:   'productName',
      title: '产品名称',
      width: 140,
      render: (_, record) => record.productName || record.skuName || '—',
    },
    {
      key:   'processName',
      title: '工序',
      width: 110,
      render: (_, record) => (
        <div className={styles.processCell}>
          <strong>{record.processName || '—'}</strong>
          <span>{record.outputSkuName || '未配置产出半成品'}</span>
        </div>
      ),
    },
    {
      key:   'plannedFinishTime',
      title: '计划完成',
      width: 110,
      render: (_, record) => formatDate(record.plannedFinishTime || record.taskDate),
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
          {isTaskOvertime(record) && (
            <span className={styles.overtimeBadge} title="实际工时超出计划工时 20%">超时</span>
          )}
        </div>
      ),
    },
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
          {record.status === 'suspended' && (
            <span className={styles.suspendedLabel}>已挂起</span>
          )}
        </div>
      ),
    },
  ];

  // 超时行样式
  const rowClassName = useCallback((record: ProductionTask) => {
    return isTaskOvertime(record) ? styles.overtimeRow : '';
  }, []);

  return (
    <div className={styles.page}>
      {/* ── 页面头部 ── */}
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>生产任务管理</h1>
          <p className={styles.pageSubtitle}>查看和管理今日生产任务，实时跟踪执行进度</p>
        </div>
      </div>

      {/* ── R06-G01: 统计卡片行（独立接口 + countUp + 点击筛选联动） ── */}
      <div className={styles.statsRow} role="region" aria-label="任务统计">
        <StatCard
          label="总任务数"
          value={stats.total}
          iconClass={styles.iconTotal}
          icon="📋"
          active={statusFilter === ''}
          onClick={() => handleStatCardClick('')}
        />
        <StatCard
          label="进行中"
          value={stats.inProgress}
          iconClass={styles.iconInProgress}
          icon="⚡"
          variant="blue"
          active={statusFilter === 'in_progress'}
          onClick={() => handleStatCardClick('in_progress')}
        />
        <StatCard
          label="已完成"
          value={stats.completed}
          iconClass={styles.iconCompleted}
          icon="✓"
          variant="green"
          active={statusFilter === 'completed'}
          onClick={() => handleStatCardClick('completed')}
        />
        <StatCard
          label="异常待处理"
          value={stats.exception}
          iconClass={styles.iconException}
          icon="⚠"
          variant="red"
          active={statusFilter === 'exception'}
          onClick={() => handleStatCardClick('exception')}
        />
      </div>

      {/* ── 筛选栏 ── */}
      <div className={styles.filterBar}>
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
          <option value="suspended">已挂起</option>
        </select>

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
          rowClassName={rowClassName}
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

      {/* ── 任务详情侧边抽屉 ── */}
      <Drawer
        open={selectedTaskId !== null}
        title="任务详情"
        onClose={closeDrawer}
        width={640}
        footer={
          taskDetail ? (
            <TaskDrawerFooter
              task={taskDetail as ProductionTask}
              isSupervisor={isSupervisor}
              startLoading={startMutation.isPending}
              completeLoading={completeMutation.isPending}
              onStart={() => void handleStartFromDrawer()}
              onComplete={handleCompleteFromDrawer}
              onException={handleExceptionFromDrawer}
              onResolve={handleResolveFromDrawer}
              onSuspend={handleSuspendFromDrawer}
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
        scrapQty={completeScrapQty}
        hours={completeHours}
        notes={completeNotes}
        error={completeError}
        hoursError={completeHoursError}
        loading={completeMutation.isPending}
        onQtyChange={(v) => { setCompleteQty(v); setCompleteError(''); }}
        onScrapQtyChange={setCompleteScrapQty}
        onHoursChange={(v) => { setCompleteHours(v); setCompleteHoursError(''); }}
        onNotesChange={setCompleteNotes}
        onClose={() => setCompleteOpen(false)}
        onConfirm={() => void handleComplete()}
      />

      {/* ── 上报异常弹窗 ── */}
      <ExceptionModal
        open={exceptionOpen}
        task={exceptionTask}
        exceptionType={exceptionType}
        affectsProgress={exceptionAffects}
        description={exceptionDesc}
        error={exceptionError}
        loading={exceptionMutation.isPending}
        onTypeChange={setExceptionType}
        onAffectsProgressChange={setExceptionAffects}
        onDescriptionChange={(v) => { setExceptionDesc(v); setExceptionError(''); }}
        onClose={() => setExceptionOpen(false)}
        onConfirm={() => void handleReportException()}
      />

      {/* ── R06-G05: 标记已处理弹窗 ── */}
      <ResolveExceptionModal
        open={resolveOpen}
        task={resolveTask}
        resolution={resolveText}
        error={resolveError}
        loading={resolveMutation.isPending}
        onResolutionChange={(v) => { setResolveText(v); setResolveError(''); }}
        onClose={() => setResolveOpen(false)}
        onConfirm={() => void handleResolve()}
      />

      {/* ── R06-G05: 挂起任务弹窗 ── */}
      <SuspendTaskModal
        open={suspendOpen}
        task={suspendTask}
        reason={suspendReason}
        error={suspendError}
        loading={suspendMutation.isPending}
        onReasonChange={(v) => { setSuspendReason(v); setSuspendError(''); }}
        onClose={() => setSuspendOpen(false)}
        onConfirm={() => void handleSuspend()}
      />

      {/* ── R06-G09: 多任务并行确认 ── */}
      <Modal
        open={parallelConfirmOpen}
        title="多任务并行确认"
        onClose={() => setParallelConfirmOpen(false)}
        onConfirm={() => void handleParallelConfirm()}
        confirmLabel="确认开始"
        confirmVariant="primary"
        size="sm"
      >
        <div className={styles.parallelConfirmContent}>
          <p className={styles.parallelConfirmText}>
            你已有 <strong>{parallelCount}</strong> 个进行中任务，确认同时开展？
          </p>
          <p className={styles.parallelConfirmHint}>
            同时处理多个任务可能影响任务质量，请确认是否继续。
          </p>
        </div>
      </Modal>
    </div>
  );
}

// ─── StatCard — 统计卡片（countUp 动画 + 点击联动） ──────

interface StatCardProps {
  label: string;
  value: number;
  icon: string;
  iconClass: string;
  variant?: 'default' | 'blue' | 'green' | 'red';
  active?: boolean;
  onClick?: () => void;
}

function StatCard({ label, value, icon, iconClass, variant = 'default', active, onClick }: StatCardProps) {
  const displayValue = useCountUp(value);
  return (
    <button
      type="button"
      className={[
        styles.statCard,
        styles[`statCard--${variant}`],
        active ? styles['statCard--active'] : '',
        onClick ? styles['statCard--clickable'] : '',
      ].filter(Boolean).join(' ')}
      onClick={onClick}
      aria-pressed={active}
    >
      <div className={`${styles.statIconWrap} ${iconClass}`} aria-hidden="true">
        {icon}
      </div>
      <div className={styles.statContent}>
        <div className={styles.statValue}>{displayValue}</div>
        <div className={styles.statLabel}>{label}</div>
      </div>
    </button>
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
  const predecessors = task.dependencySummary?.predecessors ?? [];
  const inputTransactions = task.materialTransactions?.filter((item) => item.ioType === 'input') ?? [];
  const outputTransactions = task.materialTransactions?.filter((item) => item.ioType === 'output') ?? [];

  return (
    <div className={styles.drawerContent}>
      <section className={styles.drawerSection}>
        <h3 className={styles.drawerSectionTitle}>执行概览</h3>
        <div className={styles.executionOverview}>
          <MetricCard label="任务编号" value={formatTaskLabel(task)} />
          <MetricCard label="计划数量" value={formatQty(task.plannedQty)} />
          <MetricCard label="已完成" value={formatQty(task.completedQty ?? 0)} />
          <MetricCard label="实际工时" value={task.actualHours != null ? `${task.actualHours}h` : '未上报'} />
          <MetricCard label="产出半成品" value={task.outputSkuName || '未配置'} accent="teal" />
          <MetricCard label="工资结果" value={task.wageReport ? `¥${task.wageReport.subtotal}` : '待生成'} accent="amber" />
        </div>
      </section>

      <section className={styles.drawerSection}>
        <h3 className={styles.drawerSectionTitle}>基本信息</h3>
        <dl className={styles.infoGrid}>
          <DetailItem label="任务日期" value={task.taskDate || '—'} />
          <DetailItem label="工单号" value={task.orderNo || '—'} />
          <DetailItem label="任务编号" value={formatTaskLabel(task)} />
          <DetailItem label="产品名称" value={task.productName || task.skuName || '—'} />
          <DetailItem label="工序名称" value={task.processName || '—'} />
          <DetailItem label="产出 SKU" value={task.outputSkuName || '未配置'} />
          <DetailItem label="工作站" value={task.workstationName || '—'} />
          <DetailItem label="工人" value={task.workerName || '—'} />
          <DetailItem
            label="状态"
            value={
              <span className={`${styles.statusBadge} ${STATUS_BADGE_CLASS[task.status] ?? styles.badgePending}`}>
                {STATUS_LABEL[task.status] ?? task.status}
              </span>
            }
          />
        </dl>
      </section>

      <section className={styles.drawerSection}>
        <h3 className={styles.drawerSectionTitle}>依赖与阻塞</h3>
        {task.dependencySummary?.blocked && task.dependencySummary.blockingReason ? (
          <div className={styles.dependencyBanner}>{task.dependencySummary.blockingReason}</div>
        ) : null}
        {predecessors.length === 0 ? (
          <p className={styles.drawerEmptyText}>当前任务没有前置工序依赖</p>
        ) : (
          <div className={styles.dependencyList}>
            {predecessors.map((item) => {
              const blocked = Number(item.completedQty ?? 0) < Number(item.requiredQty ?? 0);
              return (
                <div key={item.operationId} className={styles.dependencyCard}>
                  <div className={styles.dependencyCard__header}>
                    <strong>{item.stepName}</strong>
                    <span className={`${styles.dependencyStatus} ${blocked ? styles['dependencyStatus--blocked'] : styles['dependencyStatus--ready']}`}>
                      {blocked ? '未满足' : '已满足'}
                    </span>
                  </div>
                  <div className={styles.dependencyCard__meta}>
                    <span>需求 {formatQty(item.requiredQty)}</span>
                    <span>已完成 {formatQty(item.completedQty)}</span>
                    <span>状态 {item.status}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className={styles.drawerSection}>
        <h3 className={styles.drawerSectionTitle}>生产数据</h3>
        <dl className={styles.infoGrid}>
          <DetailItem label="计划数量" value={String(task.plannedQty ?? '—')} />
          <DetailItem label="已完成" value={String(task.completedQty ?? 0)} />
          <DetailItem label="报废数量" value={String(task.scrapQty ?? 0)} />
          {task.maxHours != null && (
            <DetailItem label="极限工时" value={`${task.maxHours}h`} />
          )}
          {task.actualHours != null && (
            <DetailItem label="实际工时" value={`${task.actualHours}h`} />
          )}
          {task.unitPrice != null && (
            <DetailItem label="计件单价" value={`¥${task.unitPrice}`} />
          )}
          {overtime && (
            <DetailItem
              label="超时预警"
              value={<span className={styles.overtimeBadge}>超时</span>}
            />
          )}
        </dl>
      </section>

      {(task.skuCode || task.skuName) && (
        <section className={styles.drawerSection}>
          <h3 className={styles.drawerSectionTitle}>SKU 信息</h3>
          <dl className={styles.infoGrid}>
            {task.skuCode && <DetailItem label="SKU 编码" value={task.skuCode} />}
            {task.skuName && <DetailItem label="SKU 名称" value={task.skuName} />}
          </dl>
        </section>
      )}

      <section className={styles.drawerSection}>
        <h3 className={styles.drawerSectionTitle}>投入产出与库存流水</h3>
        <div className={styles.ioGrid}>
          <MaterialTracePanel title="投入" items={inputTransactions} emptyText="尚无投入记录" />
          <MaterialTracePanel title="产出" items={outputTransactions} emptyText="尚无产出记录" />
        </div>
      </section>

      <section className={styles.drawerSection}>
        <h3 className={styles.drawerSectionTitle}>工资与工时</h3>
        {task.wageReport ? (
          <div className={styles.wageBoard}>
            <div className={styles.wageBoard__grid}>
              <div>
                <span>报工日期</span>
                <strong>{task.wageReport.reportDate}</strong>
              </div>
              <div>
                <span>工人等级</span>
                <strong>{task.wageReport.workerGrade || '未配置'}</strong>
              </div>
              <div>
                <span>工时</span>
                <strong>{task.wageReport.workHours}h</strong>
              </div>
              <div>
                <span>单价</span>
                <strong>¥{task.wageReport.unitPrice}</strong>
              </div>
              <div>
                <span>合格数</span>
                <strong>{task.wageReport.qtyQualified}</strong>
              </div>
              <div>
                <span>工资金额</span>
                <strong>¥{task.wageReport.subtotal}</strong>
              </div>
            </div>
            <div className={styles.wageBoard__footer}>
              来源 {task.wageReport.reportNo} · {task.wageReport.stepName}
            </div>
          </div>
        ) : (
          <p className={styles.drawerEmptyText}>尚未生成工资报工记录，历史兼容任务会在这里安全降级为空。</p>
        )}
      </section>

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

function MetricCard({
  label,
  value,
  accent = 'default',
}: {
  label: string;
  value: string;
  accent?: 'default' | 'teal' | 'amber';
}) {
  return (
    <div className={`${styles.metricCard} ${styles[`metricCard--${accent}`]}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function MaterialTracePanel({
  title,
  items,
  emptyText,
}: {
  title: string;
  items: NonNullable<ProductionTask['materialTransactions']>;
  emptyText: string;
}) {
  return (
    <div className={styles.tracePanel}>
      <div className={styles.tracePanel__title}>{title}</div>
      {items.length === 0 ? (
        <p className={styles.drawerEmptyText}>{emptyText}</p>
      ) : (
        <div className={styles.traceList}>
          {items.map((item) => (
            <div key={item.id} className={styles.traceItem}>
              <div className={styles.traceItem__header}>
                <strong>{item.skuName || item.skuCode || `SKU#${item.skuId}`}</strong>
                <span>{formatQty(item.actualQty)}</span>
              </div>
              <div className={styles.traceItem__meta}>
                <span>计划 {formatQty(item.plannedQty)}</span>
                <span>{item.transactionType || '未落库存流水'}</span>
                <span>{item.transactionNo || '待生成流水号'}</span>
              </div>
              <div className={styles.traceItem__meta}>
                <span>{item.direction === 'OUT' ? '出库' : item.direction === 'IN' ? '入库' : '未同步'}</span>
                <span>{item.transactionTime || '未写账本时间'}</span>
                <span>{item.referenceNo || '无关联单号'}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── TaskDrawerFooter — 抽屉底部操作按钮 ────────────────

interface TaskDrawerFooterProps {
  task: ProductionTask;
  isSupervisor: boolean;
  startLoading: boolean;
  completeLoading: boolean;
  onStart: () => void;
  onComplete: () => void;
  onException: () => void;
  onResolve: () => void;
  onSuspend: () => void;
}

function TaskDrawerFooter({
  task,
  isSupervisor,
  startLoading,
  completeLoading,
  onStart,
  onComplete,
  onException,
  onResolve,
  onSuspend,
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
          上报异常
        </Button>
      </div>
    );
  }

  // R06-G05: 异常状态下，主管视角显示「标记已处理」和「挂起任务」
  if (task.status === 'exception') {
    if (isSupervisor) {
      return (
        <div className={styles.drawerFooterActions}>
          <Button
            variant="success"
            size="md"
            onClick={onResolve}
            style={{ flex: 1 }}
          >
            标记已处理
          </Button>
          <Button
            variant="warning"
            size="md"
            onClick={onSuspend}
            style={{ flex: 1 }}
          >
            挂起任务
          </Button>
        </div>
      );
    }
    return (
      <div className={styles.drawerFooterActions}>
        <Button
          variant="danger"
          size="md"
          onClick={onException}
          style={{ width: '100%' }}
        >
          补充上报
        </Button>
      </div>
    );
  }

  return null;
}

// ─── CompleteTaskModal — 完工上报弹窗 ────────────────────

interface CompleteTaskModalProps {
  open: boolean;
  task: ProductionTask | null;
  qty: string;
  scrapQty: string;
  hours: string;
  notes: string;
  error: string;
  hoursError: string;
  loading: boolean;
  onQtyChange: (v: string) => void;
  onScrapQtyChange: (v: string) => void;
  onHoursChange: (v: string) => void;
  onNotesChange: (v: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}

function CompleteTaskModal({
  open,
  task,
  qty,
  scrapQty,
  hours,
  notes,
  error,
  hoursError,
  loading,
  onQtyChange,
  onScrapQtyChange,
  onHoursChange,
  onNotesChange,
  onClose,
  onConfirm,
}: CompleteTaskModalProps) {
  const qtyNum = Number(qty);
  const hoursNum = Number(hours);

  // 工资预览计算
  const estimatedWage = useMemo(() => {
    if (!task?.unitPrice || isNaN(qtyNum) || qtyNum <= 0) return null;
    return (task.unitPrice * qtyNum).toFixed(2);
  }, [task, qtyNum]);

  // 超时预警检测：实际工时 >= 极限工时 × 1.2
  const isOvertimeWarning = useMemo(() => {
    if (!task?.maxHours || isNaN(hoursNum) || hoursNum <= 0) return false;
    return hoursNum >= task.maxHours * 1.2;
  }, [task, hoursNum]);

  // 工人等级未配置
  const gradeUnconfigured = task?.workerGradeConfigured === false;

  return (
    <Modal
      open={open}
      title="完工上报"
      onClose={onClose}
      onConfirm={onConfirm}
      confirmLabel="确认完成"
      confirmVariant="success"
      confirmLoading={loading}
      /* confirmDisabled not in ModalProps — use CSS opacity on inner form instead */
      size="sm"
    >
      {task && (
        <div className={styles.modalForm}>
          {/* 工人等级未配置错误横幅 */}
          {gradeUnconfigured && (
            <div className={styles.gradeBanner}>
              <span className={styles.gradeBannerIcon}>!</span>
              工人等级未配置，无法计算工资。请联系主管完善工人信息后再进行完工上报。
            </div>
          )}

          <div className={`${styles.modalFormInner} ${gradeUnconfigured ? styles.modalFormDisabled : ''}`}>
            <div className={styles.modalTaskInfo}>
              <span className={styles.modalTaskLabel}>任务</span>
              <span className={styles.modalTaskValue}>{formatTaskLabel(task)}</span>
              <span className={styles.modalTaskSep}>·</span>
              <span className={styles.modalTaskValue}>{task.processName}</span>
              <span className={styles.modalTaskSep}>·</span>
              <span className={styles.modalTaskSecondary}>计划 {task.plannedQty} 件</span>
            </div>

            <div className={styles.completeSummary}>
              <div className={styles.completeSummaryCard}>
                <span>产出半成品</span>
                <strong>{task.outputSkuName || '未配置产出'}</strong>
              </div>
              <div className={styles.completeSummaryCard}>
                <span>依赖状态</span>
                <strong>{task.dependencySummary?.blocked ? '仍有阻塞' : '可正常完工'}</strong>
              </div>
            </div>

            {/* 超时预警横幅 */}
            {isOvertimeWarning && (
              <div className={styles.overtimeWarningBanner}>
                <span className={styles.overtimeWarningIcon}>⚠</span>
                实际工时超过极限工时的 120%，请确认是否存在异常情况。
              </div>
            )}

            <div className={styles.formRow}>
              <div className={styles.formGroup}>
                <label htmlFor="complete-qty" className={styles.formLabel}>
                  完成件数 <span className={styles.formRequired} aria-label="必填">*</span>
                </label>
                <input
                  id="complete-qty"
                  type="number"
                  min="1"
                  step="1"
                  className={`${styles.formInput} ${error ? styles.formInputError : ''}`}
                  placeholder={`计划 ${task.plannedQty} 件`}
                  value={qty}
                  onChange={(e) => onQtyChange(e.target.value)}
                  aria-describedby={error ? 'complete-qty-error' : undefined}
                  autoFocus
                  disabled={gradeUnconfigured}
                />
                {error && (
                  <p id="complete-qty-error" className={styles.formError} role="alert">
                    {error}
                  </p>
                )}
              </div>

              <div className={styles.formGroup}>
                <label htmlFor="complete-hours" className={styles.formLabel}>
                  实际工时（小时）<span className={styles.formRequired} aria-label="必填">*</span>
                </label>
                <input
                  id="complete-hours"
                  type="number"
                  min="0"
                  step="0.5"
                  className={`${styles.formInput} ${hoursError ? styles.formInputError : ''} ${isOvertimeWarning ? styles.formInputWarning : ''}`}
                  placeholder="请输入实际工时"
                  value={hours}
                  onChange={(e) => onHoursChange(e.target.value)}
                  aria-describedby={hoursError ? 'complete-hours-error' : undefined}
                  disabled={gradeUnconfigured}
                />
                {hoursError && (
                  <p id="complete-hours-error" className={styles.formError} role="alert">
                    {hoursError}
                  </p>
                )}
              </div>
            </div>

            {/* 废品/损耗数量 */}
            <div className={styles.formGroup}>
              <label htmlFor="complete-scrap" className={styles.formLabel}>
                废品数量（件）<span style={{ color: '#9ca3af', fontWeight: 400, marginLeft: '0.25rem' }}>选填</span>
              </label>
              <input
                id="complete-scrap"
                type="number"
                min="0"
                step="1"
                className={styles.formInput}
                placeholder="0"
                value={scrapQty}
                onChange={(e) => onScrapQtyChange(e.target.value)}
                disabled={gradeUnconfigured}
              />
              <p style={{ fontSize: '0.75rem', color: '#9ca3af', marginTop: '0.25rem' }}>
                废品数量将记录为实际损耗，用于成本核算
              </p>
            </div>

            {/* 工资预览卡片 */}
            {task.unitPrice != null && (
              <div className={styles.wagePreview}>
                <div className={styles.wagePreviewTitle}>工资预览</div>
                <div className={styles.wagePreviewGrid}>
                  <div className={styles.wagePreviewItem}>
                    <span className={styles.wagePreviewLabel}>工人等级</span>
                    <span className={styles.wagePreviewValue}>
                      {task.workerGrade || (gradeUnconfigured ? '未配置' : '—')}
                    </span>
                  </div>
                  <div className={styles.wagePreviewItem}>
                    <span className={styles.wagePreviewLabel}>计件单价</span>
                    <span className={styles.wagePreviewValue}>¥{task.unitPrice}/件</span>
                  </div>
                  <div className={styles.wagePreviewItem}>
                    <span className={styles.wagePreviewLabel}>计算公式</span>
                    <span className={styles.wagePreviewValue}>
                      {qtyNum > 0 ? `${qtyNum} 件 × ¥${task.unitPrice}` : '—'}
                    </span>
                  </div>
                  <div className={`${styles.wagePreviewItem} ${styles.wagePreviewTotal}`}>
                    <span className={styles.wagePreviewLabel}>预计工资</span>
                    <span className={styles.wagePreviewAmount}>
                      {estimatedWage ? `¥${estimatedWage}` : '—'}
                    </span>
                  </div>
                </div>
              </div>
            )}

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
                disabled={gradeUnconfigured}
              />
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ─── ExceptionModal — 上报异常弹窗（卡片式单选） ──────────

interface ExceptionModalProps {
  open: boolean;
  task: ProductionTask | null;
  exceptionType: ExceptionType;
  affectsProgress: boolean | null;
  description: string;
  error: string;
  loading: boolean;
  onTypeChange: (v: ExceptionType) => void;
  onAffectsProgressChange: (v: boolean) => void;
  onDescriptionChange: (v: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}

function ExceptionModal({
  open,
  task,
  exceptionType,
  affectsProgress,
  description,
  error,
  loading,
  onTypeChange,
  onAffectsProgressChange,
  onDescriptionChange,
  onClose,
  onConfirm,
}: ExceptionModalProps) {
  const charCount = description.trim().length;
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
            <span className={styles.modalTaskValue}>{formatTaskLabel(task)}</span>
            <span className={styles.modalTaskSep}>·</span>
            <span className={styles.modalTaskValue}>{task.processName}</span>
          </div>

          {/* R06-G03: 卡片式单选异常类型 */}
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>
              异常类型 <span className={styles.formRequired} aria-label="必填">*</span>
            </label>
            <div className={styles.exceptionTypeGrid}>
              {EXCEPTION_TYPES.map((et) => (
                <button
                  key={et.value}
                  type="button"
                  title={et.desc}
                  className={[
                    styles.exceptionTypeCard,
                    exceptionType === et.value ? styles.exceptionTypeCardActive : '',
                  ].filter(Boolean).join(' ')}
                  onClick={() => onTypeChange(et.value)}
                >
                  <span className={styles.exceptionTypeCardIcon}>{et.icon}</span>
                  <span className={styles.exceptionTypeCardLabel}>{et.value}</span>
                </button>
              ))}
            </div>
          </div>

          {/* R06-G03: 是否影响生产进度 */}
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>
              是否影响生产进度 <span className={styles.formRequired} aria-label="必填">*</span>
            </label>
            <div className={styles.yesNoGroup}>
              <button
                type="button"
                className={[
                  styles.yesNoBtn,
                  affectsProgress === true ? styles.yesNoBtnActive : '',
                ].filter(Boolean).join(' ')}
                onClick={() => onAffectsProgressChange(true)}
              >
                是，影响进度
              </button>
              <button
                type="button"
                className={[
                  styles.yesNoBtn,
                  affectsProgress === false ? styles.yesNoBtnActive : '',
                ].filter(Boolean).join(' ')}
                onClick={() => onAffectsProgressChange(false)}
              >
                否，不影响
              </button>
            </div>
          </div>

          {/* R06-G03: 描述最少10字校验 */}
          <div className={styles.formGroup}>
            <div className={styles.formLabelRow}>
              <label htmlFor="exception-desc" className={styles.formLabel}>
                异常描述 <span className={styles.formRequired} aria-label="必填">*</span>
              </label>
              <span className={`${styles.charCount} ${charCount < 10 ? styles.charCountInsufficient : styles.charCountSufficient}`}>
                {charCount}/10 字最少
              </span>
            </div>
            <textarea
              id="exception-desc"
              className={`${styles.formTextarea} ${error ? styles.formInputError : ''}`}
              rows={4}
              placeholder="请详细描述异常情况，至少10个字，包括发现时间、影响范围等..."
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

// ─── ResolveExceptionModal — 标记已处理弹窗 ─────────────

interface ResolveExceptionModalProps {
  open: boolean;
  task: ProductionTask | null;
  resolution: string;
  error: string;
  loading: boolean;
  onResolutionChange: (v: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}

function ResolveExceptionModal({
  open,
  task,
  resolution,
  error,
  loading,
  onResolutionChange,
  onClose,
  onConfirm,
}: ResolveExceptionModalProps) {
  return (
    <Modal
      open={open}
      title="标记异常已处理"
      onClose={onClose}
      onConfirm={onConfirm}
      confirmLabel="确认处理"
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
          </div>
          <div className={styles.formGroup}>
            <label htmlFor="resolve-text" className={styles.formLabel}>
              处理说明 <span className={styles.formRequired} aria-label="必填">*</span>
            </label>
            <textarea
              id="resolve-text"
              className={`${styles.formTextarea} ${error ? styles.formInputError : ''}`}
              rows={4}
              placeholder="请填写异常处理经过及结果..."
              value={resolution}
              onChange={(e) => onResolutionChange(e.target.value)}
              aria-describedby={error ? 'resolve-error' : undefined}
              autoFocus
            />
            {error && (
              <p id="resolve-error" className={styles.formError} role="alert">
                {error}
              </p>
            )}
          </div>
          <p className={styles.resolveHint}>
            处理后任务状态将恢复为「进行中」，工人可继续生产。
          </p>
        </div>
      )}
    </Modal>
  );
}

// ─── SuspendTaskModal — 挂起任务弹窗 ─────────────────────

interface SuspendTaskModalProps {
  open: boolean;
  task: ProductionTask | null;
  reason: string;
  error: string;
  loading: boolean;
  onReasonChange: (v: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}

function SuspendTaskModal({
  open,
  task,
  reason,
  error,
  loading,
  onReasonChange,
  onClose,
  onConfirm,
}: SuspendTaskModalProps) {
  return (
    <Modal
      open={open}
      title="挂起任务"
      onClose={onClose}
      onConfirm={onConfirm}
      confirmLabel="确认挂起"
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
          <div className={styles.formGroup}>
            <label htmlFor="suspend-reason" className={styles.formLabel}>
              挂起原因 <span className={styles.formRequired} aria-label="必填">*</span>
            </label>
            <textarea
              id="suspend-reason"
              className={`${styles.formTextarea} ${error ? styles.formInputError : ''}`}
              rows={4}
              placeholder="请填写挂起原因，例如：等待材料到货、设备维修中..."
              value={reason}
              onChange={(e) => onReasonChange(e.target.value)}
              aria-describedby={error ? 'suspend-error' : undefined}
              autoFocus
            />
            {error && (
              <p id="suspend-error" className={styles.formError} role="alert">
                {error}
              </p>
            )}
          </div>
          <p className={styles.suspendHint}>
            挂起后任务将变为「已挂起」状态（橙色），需主管手动恢复。
          </p>
        </div>
      )}
    </Modal>
  );
}
