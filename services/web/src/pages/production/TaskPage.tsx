/**
 * [artifact:前端代码] — 生产任务管理页 (R-06)
 *
 * 功能范围：
 *   - 统计卡片行：总任务数 / 进行中 / 已完成 / 异常（独立 stats 接口，countUp 动画）
 *   - 筛选栏：关键词搜索(300ms debounce) + 状态下拉 + 日期范围 + 工序/工人筛选
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
import { ACTION_CODES } from '@/constants/accessControl';
import { usePermission } from '@/hooks/usePermission';
import { useAppStore } from '@/stores/appStore';
import {
  useTaskList,
  useTaskDetail,
  useTaskStats,
  useStartTask,
  useCompleteTask,
  useIssueTaskMaterials,
  useReportException,
  useReturnTaskMaterials,
  useResolveException,
  useSuspendTask,
  taskApi,
} from '@/api/productionTask';
import { useProductionWorkers } from '@/api/production';
import { useLocationOptions, useWarehouseOptions } from '@/api/inventory';
import Modal from '@/components/common/Modal';
import Button from '@/components/common/Button';
import Table from '@/components/common/Table';
import Drawer from '@/components/common/Drawer';
import type { Column } from '@/components/common/Table';
import {
  exportProductionTaskDocument,
  openPrintWindow,
  printProductionTaskDocument,
} from '@/utils/productionTaskDocument';
import { getAccessToken } from '@/utils/request';
import styles from './TaskPage.module.css';

// ─── 类型定义 ─────────────────────────────────────────────

type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'exception' | 'suspended';
type TaskType = 'finished' | 'semi_finished';
type ExecutionMode = 'internal' | 'outsource';

type ExceptionType = '设备故障' | '物料缺失' | '质量异常' | '其他';

interface TaskException {
  id: number;
  type: string;
  description: string;
  severity: string;
  createdAt: string;
  resolvedAt?: string | null;
  resolution?: string | null;
  reporterName?: string | null;
  resolverName?: string | null;
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
  processGuideText?: string | null;
  processGuideAttachmentUrl?: string | null;
  processGuideAttachmentName?: string | null;
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
  taskType?: TaskType;
  executionMode?: 'internal' | 'outsource';
  priority?: number;
  priorityScore?: number;
  priorityLevel?: 'critical' | 'high' | 'medium' | 'normal';
  priorityLabel?: string;
  priorityReason?: string;
  materialIssueStatus?: 'none' | 'pending_issue' | 'partial_issue' | 'fully_issued' | 'line_side_remaining' | string;
  materialIssueLabel?: string;
  downstreamTaskCount?: number;
  activeDownstreamTaskCount?: number;
  dependencyBlocked?: boolean | 0 | 1;
  isOvertime?: boolean;
  maxHours?: number;
  actualHours?: number;
  createdAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  updatedAt?: string | null;
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
      skuId: number | null;
      skuCode: string | null;
      skuName: string | null;
      unit: string | null;
    }>;
  };
  inputMaterials?: Array<{
    itemType: 'material';
    sourceLabel: string;
    skuId: number;
    skuCode: string | null;
    skuName: string | null;
    unit: string | null;
    hasDyeLot?: boolean;
    requiredQty: string;
    issuedQty: string;
    qtyAvailable: string;
    shortageQty: string;
    isShortage: boolean | 0 | 1 | '0' | '1';
    inventoryTxId: number | null;
    movementStatus?: string | null;
    warehouseId?: number | null;
    warehouseCode?: string | null;
    warehouseName?: string | null;
    locationId?: number | null;
    locationCode?: string | null;
    locationName?: string | null;
  }>;
  inputItems?: Array<{
    itemType: 'semi_finished' | 'material';
    sourceLabel: string;
    skuId: number;
    skuCode: string | null;
    skuName: string | null;
    unit: string | null;
    hasDyeLot?: boolean;
    requiredQty: string;
    fulfilledQty: string;
    qtyAvailable: string;
    shortageQty: string;
    isShortage: boolean | 0 | 1 | '0' | '1';
    status: string | null;
    operationId: number | null;
    stepName: string | null;
    inventoryTxId: number | null;
    warehouseId?: number | null;
    warehouseCode?: string | null;
    warehouseName?: string | null;
    locationId?: number | null;
    locationCode?: string | null;
    locationName?: string | null;
  }>;
  outputItems?: Array<{
    itemType: 'finished' | 'semi_finished';
    skuId: number;
    skuCode: string | null;
    skuName: string | null;
    unit: string | null;
    plannedQty: string;
    actualQty: string;
    processStepId?: number | null;
    processName?: string | null;
    warehouseId?: number | null;
    warehouseCode?: string | null;
    warehouseName?: string | null;
    locationId?: number | null;
    locationCode?: string | null;
    locationName?: string | null;
  }>;
  materialTransactions?: Array<{
    id: number;
    ioType: 'input' | 'output';
    movementType?: 'issue' | 'return' | 'consume' | 'scrap' | 'output';
    skuId: number;
    skuCode: string | null;
    skuName: string | null;
    stockUnit: string | null;
    plannedQty: string;
    actualQty: string;
    qtyAvailable: string;
    shortageQty: string;
    isShortage: boolean | 0 | 1 | '0' | '1';
    inventoryTxId: number | null;
    transactionNo: string | null;
    transactionType: string | null;
    direction: 'IN' | 'OUT' | null;
    transactionQty: string | null;
    transactionTime: string | null;
    referenceNo: string | null;
    warehouseId?: number | null;
    warehouseCode?: string | null;
    warehouseName?: string | null;
    locationId?: number | null;
    locationCode?: string | null;
    locationName?: string | null;
    notes?: string | null;
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

interface MaterialActionDraft {
  skuId: number;
  qty: string;
  dyeLotNo?: string;
  warehouseId?: number;
  locationId?: number;
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

const MATERIAL_ISSUE_BADGE_CLASS: Record<string, string> = {
  none: styles.materialIssueBadgeNone,
  pending_issue: styles.materialIssueBadgePending,
  partial_issue: styles.materialIssueBadgePartial,
  fully_issued: styles.materialIssueBadgeReady,
  line_side_remaining: styles.materialIssueBadgeLeftover,
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

function getPriorityLevel(task: Pick<ProductionTask, 'priorityLevel' | 'priorityScore' | 'priority'>): 'critical' | 'high' | 'medium' | 'normal' {
  if (task.priorityLevel) return task.priorityLevel;
  const score = Number(task.priorityScore ?? task.priority ?? 50);
  if (score >= 110) return 'critical';
  if (score >= 85) return 'high';
  if (score >= 60) return 'medium';
  return 'normal';
}

function getPriorityLabel(task: Pick<ProductionTask, 'priorityLabel' | 'priorityLevel' | 'priorityScore' | 'priority'>): string {
  if (task.priorityLabel) return task.priorityLabel;
  switch (getPriorityLevel(task)) {
    case 'critical': return '关键优先';
    case 'high': return '高优先';
    case 'medium': return '优先';
    default: return '普通';
  }
}

function isDependencyBlocked(task: Pick<ProductionTask, 'dependencyBlocked'>): boolean {
  return task.dependencyBlocked === true || task.dependencyBlocked === 1;
}

function formatDate(dateStr: string | undefined): string {
  if (!dateStr) return '—';
  try {
    return dateStr.slice(0, 10);
  } catch {
    return dateStr;
  }
}

function formatDateTime(dateStr: string | undefined | null): string {
  if (!dateStr) return '—';
  try {
    return dateStr.replace('T', ' ').slice(0, 19);
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

function isGuideImage(url?: string | null, fileName?: string | null): boolean {
  const source = `${url ?? ''} ${fileName ?? ''}`.toLowerCase();
  return /\.(jpg|jpeg|png|webp)(\?|$)/i.test(source);
}

function getGuideAttachmentLabel(url?: string | null, fileName?: string | null): string {
  if (fileName) return fileName;
  if (!url) return '操作附件';
  return url.split('/').pop() ?? '操作附件';
}

function openAuthFile(url: string) {
  const token = getAccessToken();
  fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
    .then((r) => {
      if (!r.ok) throw new Error(String(r.status));
      return r.blob();
    })
    .then((blob) => {
      const blobUrl = URL.createObjectURL(blob);
      window.open(blobUrl, '_blank');
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    })
    .catch(() => {
      // noop
    });
}

function formatQtyWithUnit(
  value: string | number | undefined | null,
  unit?: string | null,
): string {
  const formattedQty = formatQty(value);
  return unit ? `${formattedQty} ${unit}` : formattedQty;
}

function formatWarehouseLocation(value: {
  warehouseCode?: string | null;
  warehouseName?: string | null;
  locationCode?: string | null;
  locationName?: string | null;
} | null | undefined): string {
  if (!value) return '未绑定';
  const warehouse = value.warehouseName || value.warehouseCode || null;
  const location = value.locationName || value.locationCode || null;
  if (warehouse && location) {
    return `${warehouse}-${location}`;
  }
  if (warehouse) {
    return warehouse;
  }
  if (location) {
    return location;
  }
  return '未绑定';
}

function getInputItemNumericQty(
  item: NonNullable<ProductionTask['inputItems']>[number],
  label: 'required' | 'fulfilled',
): number {
  const raw = label === 'required' ? item.requiredQty : item.fulfilledQty;
  const value = Number(raw ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function extractLineSideQty(status?: string | null): number {
  if (!status) return 0;
  const matched = status.match(/在线边\s+(\d+(?:\.\d+)?)/);
  const value = matched ? Number(matched[1]) : 0;
  return Number.isFinite(value) ? value : 0;
}

function renderMaterialIssueBadge(task: Pick<ProductionTask, 'materialIssueStatus' | 'materialIssueLabel'>) {
  const label = task.materialIssueLabel || '无需领料';
  const cls = MATERIAL_ISSUE_BADGE_CLASS[task.materialIssueStatus || 'none'] || styles.materialIssueBadgeNone;
  return <span className={`${styles.materialIssueBadge} ${cls}`}>{label}</span>;
}

function isMaterialShortage(item: Pick<NonNullable<ProductionTask['materialTransactions']>[number], 'isShortage'>): boolean {
  return item.isShortage === true || item.isShortage === '1' || item.isShortage === 1;
}

function getInputItemTone(item: Pick<NonNullable<ProductionTask['inputItems']>[number], 'requiredQty' | 'qtyAvailable' | 'isShortage'>): 'danger' | 'warning' | 'healthy' {
  if (isMaterialShortage(item)) return 'danger';
  const required = Number(item.requiredQty ?? 0);
  const available = Number(item.qtyAvailable ?? 0);
  if (required > 0 && available <= required * 1.2) return 'warning';
  return 'healthy';
}

function getTaskPrimaryName(task: Pick<ProductionTask, 'outputSkuName' | 'productName' | 'skuName'>): string {
  return task.outputSkuName || task.productName || task.skuName || '—';
}

function getTaskSecondaryName(task: Pick<ProductionTask, 'outputSkuName' | 'productName' | 'skuName'>): string | null {
  const finalProductName = task.productName || task.skuName || null;
  if (!task.outputSkuName || !finalProductName || task.outputSkuName === finalProductName) {
    return null;
  }
  return `所属成品：${finalProductName}`;
}

function isSemiFinishedTask(task: Pick<ProductionTask, 'outputSkuName' | 'productName' | 'skuName'>): boolean {
  const finalProductName = task.productName || task.skuName || null;
  return Boolean(task.outputSkuName && finalProductName && task.outputSkuName !== finalProductName);
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
  const { can } = usePermission();

  // 是否是主管/管理员视角（可以处理异常）
  const isSupervisor = can(ACTION_CODES.PRODUCTION_TASK_SUPERVISE);
  const canOperateTask = can(ACTION_CODES.PRODUCTION_TASK_OPERATE);

  useEffect(() => { setPageTitle('生产任务管理'); }, [setPageTitle]);

  // ── 筛选状态 ────────────────────────────────────────────
  const [keyword, setKeyword]           = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [page, setPage]                 = useState(1);

  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo]     = useState('');
  const [dateError, setDateError] = useState('');

  const [processFilter, setProcessFilter] = useState('');
  const [workerFilter, setWorkerFilter] = useState('');
  const [taskTypeFilter, setTaskTypeFilter] = useState<TaskType | ''>('');
  const [executionModeFilter, setExecutionModeFilter] = useState<ExecutionMode | ''>('');

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

  const handleWorkerFilterChange = useCallback((v: string) => {
    setWorkerFilter(v);
    setPage(1);
  }, []);

  const handleTaskTypeFilterChange = useCallback((v: TaskType | '') => {
    setTaskTypeFilter(v);
    setPage(1);
  }, []);

  const handleExecutionModeFilterChange = useCallback((v: ExecutionMode | '') => {
    setExecutionModeFilter(v);
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
    workerId: workerFilter ? Number(workerFilter) : undefined,
    taskType: taskTypeFilter || undefined,
    executionMode: executionModeFilter || undefined,
  };

  const { data: rawData, isLoading, isError } = useTaskList(filter);
  const { data: workerOptionsData } = useProductionWorkers();

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

  const workerOptions = useMemo(
    () => (workerOptionsData ?? []).map((worker) => ({
      label: worker.name,
      value: String(worker.id),
    })),
    [workerOptionsData],
  );

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
  const issueMutation     = useIssueTaskMaterials();
  const exceptionMutation = useReportException();
  const returnMutation    = useReturnTaskMaterials();
  const resolveMutation   = useResolveException();
  const suspendMutation   = useSuspendTask();

  // ── 任务详情抽屉状态 ────────────────────────────────────────
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  const { data: taskDetailRaw, isLoading: detailLoading } = useTaskDetail(selectedTaskId);
  const taskDetail = taskDetailRaw as ProductionTask | undefined;
  const [documentAction, setDocumentAction] = useState<{
    taskId: number;
    type: 'export' | 'print';
  } | null>(null);

  const openDrawer = useCallback((task: ProductionTask) => {
    setSelectedTaskId(task.id);
  }, []);

  const closeDrawer = useCallback(() => {
    setSelectedTaskId(null);
  }, []);

  const loadTaskDocument = useCallback(async (taskId: number): Promise<ProductionTask> => {
    if (taskDetail && taskDetail.id === taskId) {
      return taskDetail;
    }
    return taskApi.detail(taskId) as Promise<ProductionTask>;
  }, [taskDetail]);

  const handleExportDocument = useCallback(async (taskId: number) => {
    setDocumentAction({ taskId, type: 'export' });
    try {
      const detail = await loadTaskDocument(taskId);
      exportProductionTaskDocument(detail);
      showToast({ type: 'success', message: `任务 #${taskId} 工单已导出` });
    } catch {
      showToast({ type: 'error', message: '工单导出失败，请稍后重试' });
    } finally {
      setDocumentAction(null);
    }
  }, [loadTaskDocument, showToast]);

  const handlePrintDocument = useCallback(async (taskId: number) => {
    const printWindow = openPrintWindow();
    if (!printWindow) {
      showToast({ type: 'error', message: '浏览器拦截了打印窗口，请允许本站弹出新窗口后重试' });
      return;
    }
    setDocumentAction({ taskId, type: 'print' });
    try {
      const detail = await loadTaskDocument(taskId);
      await printProductionTaskDocument(detail, printWindow);
      showToast({ type: 'success', message: `任务 #${taskId} 打印清单已生成` });
    } catch (error) {
      printWindow.close();
      const message = error instanceof Error ? error.message : '打印失败，请稍后重试';
      showToast({ type: 'error', message });
    } finally {
      setDocumentAction(null);
    }
  }, [loadTaskDocument, showToast]);

  // ── 完成任务弹窗状态 ──────────────────────────────────────
  const [completeOpen, setCompleteOpen]       = useState(false);
  const [selectedTask, setSelectedTask]       = useState<ProductionTask | null>(null);
  const [completeQty, setCompleteQty]         = useState<string>('');
  const [completeScrapQty, setCompleteScrapQty] = useState<string>('');
  const [completeHours, setCompleteHours]     = useState<string>('');
  const [completeNotes, setCompleteNotes]     = useState('');
  const [completeError, setCompleteError]     = useState('');
  const [completeHoursError, setCompleteHoursError] = useState('');
  const [completeSubmitError, setCompleteSubmitError] = useState('');

  const openCompleteModal = useCallback((task: ProductionTask) => {
    setSelectedTask(task);
    setCompleteQty('');
    setCompleteScrapQty('');
    setCompleteHours('');
    setCompleteNotes('');
    setCompleteError('');
    setCompleteHoursError('');
    setCompleteSubmitError('');
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
    setCompleteSubmitError('');

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
    } catch (error) {
      const message = error instanceof Error ? error.message : '操作失败，请稍后重试';
      setCompleteSubmitError(message);
      showToast({ type: 'error', message });
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

  const [materialActionOpen, setMaterialActionOpen] = useState(false);
  const [materialActionMode, setMaterialActionMode] = useState<'issue' | 'return'>('issue');
  const [materialActionTask, setMaterialActionTask] = useState<ProductionTask | null>(null);
  const [materialActionDrafts, setMaterialActionDrafts] = useState<MaterialActionDraft[]>([]);
  const [materialActionError, setMaterialActionError] = useState('');
  const [rowMaterialAction, setRowMaterialAction] = useState<{
    taskId: number;
    mode: 'issue' | 'return';
  } | null>(null);

  const openMaterialActionModal = useCallback((task: ProductionTask, mode: 'issue' | 'return') => {
    const items = (task.inputItems ?? []).filter((item) => item.itemType === 'material');
    const drafts = items.map((item) => {
      const requiredQty = getInputItemNumericQty(item, 'required');
      const fulfilledQty = getInputItemNumericQty(item, 'fulfilled');
      const issueQty = Math.max(requiredQty - fulfilledQty, 0);
      const returnQty = extractLineSideQty(item.status);
      return {
        skuId: item.skuId,
        dyeLotNo: '',
        warehouseId: item.warehouseId ?? undefined,
        locationId: item.locationId ?? undefined,
        qty: mode === 'issue'
          ? (issueQty > 0 ? String(issueQty) : '')
          : (returnQty > 0 ? String(returnQty) : ''),
      };
    });
    setMaterialActionTask(task);
    setMaterialActionMode(mode);
    setMaterialActionDrafts(drafts);
    setMaterialActionError('');
    setMaterialActionOpen(true);
  }, []);

  const handleMaterialActionFromList = useCallback(async (
    task: ProductionTask,
    mode: 'issue' | 'return',
  ) => {
    setRowMaterialAction({ taskId: task.id, mode });
    try {
      const detail = taskDetail && taskDetail.id === task.id
        ? taskDetail
        : await taskApi.detail(task.id) as ProductionTask;
      openMaterialActionModal(detail, mode);
    } catch {
      showToast({ type: 'error', message: '任务详情加载失败，请稍后重试' });
    } finally {
      setRowMaterialAction(null);
    }
  }, [openMaterialActionModal, showToast, taskDetail]);

  const handleMaterialActionDraftChange = useCallback((skuId: number, patch: Partial<MaterialActionDraft>) => {
    setMaterialActionError('');
    setMaterialActionDrafts((current) => current.map((item) => (
      item.skuId === skuId ? { ...item, ...patch } : item
    )));
  }, []);

  const handleMaterialAction = useCallback(async () => {
    if (!materialActionTask) return;
    const materialItems = (materialActionTask.inputItems ?? []).filter((item) => item.itemType === 'material');
    setMaterialActionError('');
    try {
      const payloadItems = materialItems
        .map((item) => {
          const draft = materialActionDrafts.find((entry) => entry.skuId === item.skuId);
          const qty = Number(draft?.qty ?? 0);
          if (!Number.isFinite(qty) || qty <= 0) return null;
          const dyeLotNo = String(draft?.dyeLotNo ?? '').trim();
          if (item.hasDyeLot && !dyeLotNo) {
            throw new Error(`SKU ${item.skuName || item.skuCode || item.skuId} 需要填写缸号`);
          }
          if ((draft?.warehouseId ?? item.warehouseId) && !(draft?.locationId ?? item.locationId)) {
            throw new Error(`SKU ${item.skuName || item.skuCode || item.skuId} 请选择库位`);
          }
          return {
            skuId: item.skuId,
            qty: String(qty),
            ...(dyeLotNo ? { dyeLotNo } : {}),
            warehouseId: draft?.warehouseId ?? item.warehouseId ?? undefined,
            locationId: draft?.locationId ?? item.locationId ?? undefined,
            notes: materialActionMode === 'issue' ? '任务领料到线边' : '任务退料回仓',
          };
        })
        .filter((item): item is NonNullable<typeof item> => Boolean(item));

      if (payloadItems.length === 0) {
        setMaterialActionError(`请至少填写一条有效的${materialActionMode === 'issue' ? '领料' : '退料'}数量`);
        return;
      }

      if (materialActionMode === 'issue') {
        await issueMutation.mutateAsync({
          taskId: materialActionTask.id,
          data: { items: payloadItems },
        });
      } else {
        await returnMutation.mutateAsync({
          taskId: materialActionTask.id,
          data: { items: payloadItems },
        });
      }
      showToast({
        type: 'success',
        message: `任务 #${materialActionTask.id} 已${materialActionMode === 'issue' ? '完成领料' : '完成退料'}`,
      });
      setMaterialActionOpen(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : '操作失败，请稍后重试';
      setMaterialActionError(message);
      showToast({ type: 'error', message });
    }
  }, [issueMutation, materialActionDrafts, materialActionMode, materialActionTask, returnMutation, showToast]);

  const handleIssueFromDrawer = useCallback(() => {
    if (!taskDetail) return;
    openMaterialActionModal(taskDetail as ProductionTask, 'issue');
  }, [openMaterialActionModal, taskDetail]);

  const handleReturnFromDrawer = useCallback(() => {
    if (!taskDetail) return;
    openMaterialActionModal(taskDetail as ProductionTask, 'return');
  }, [openMaterialActionModal, taskDetail]);

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
      title: '当前产出',
      width: 180,
      render: (_, record) => {
        const secondaryName = getTaskSecondaryName(record);
        const modeLabel = record.executionMode === 'outsource' ? '外协采购' : '厂内生产';
        return (
          <div className={styles.processCell}>
            <strong>{getTaskPrimaryName(record)}</strong>
            <span>{secondaryName || '成品任务'}</span>
            <span
              className={[
                styles.executionModeBadge,
                record.executionMode === 'outsource'
                  ? styles['executionModeBadge--outsource']
                  : styles['executionModeBadge--internal'],
              ].join(' ')}
            >
              {modeLabel}
            </span>
          </div>
        );
      },
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
      key:   'workerName',
      title: '工人',
      width: 120,
      render: (_, record) => record.workerName || '—',
    },
    {
      key: 'materialIssueLabel',
      title: '领料状态',
      width: 130,
      render: (_, record) => renderMaterialIssueBadge(record),
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
      width: 180,
      render: (_, record) => {
        const level = getPriorityLevel(record);
        return (
          <div className={styles.priorityCell}>
            <span className={styles[`priorityBadge--${level}`]}>
              {getPriorityLabel(record)}
            </span>
            <span className={styles.priorityMeta}>
              {record.priorityReason || (isHighPriority(record) ? '工单基础优先级较高' : '常规优先级')}
            </span>
          </div>
        );
      },
    },
    {
      key:   '_actions',
      title: '操作',
      width: 460,
      render: (_, record) => (
        <div className={styles.actionGroup}>
          <Button variant="ghost" size="sm" onClick={() => openDrawer(record)}>详情</Button>
          <Button
            variant="ghost"
            size="sm"
            loading={documentAction?.taskId === record.id && documentAction.type === 'export'}
            onClick={() => void handleExportDocument(record.id)}
          >
            导出工单
          </Button>
          <Button
            variant="ghost"
            size="sm"
            loading={documentAction?.taskId === record.id && documentAction.type === 'print'}
            onClick={() => void handlePrintDocument(record.id)}
          >
            打印工单
          </Button>
          {canOperateTask && record.status === 'pending' && (
            <Button
              variant="ghost"
              size="sm"
              loading={rowMaterialAction?.taskId === record.id && rowMaterialAction.mode === 'issue'}
              onClick={() => void handleMaterialActionFromList(record, 'issue')}
            >
              领料到线边
            </Button>
          )}
          {canOperateTask && record.status === 'pending' && (
            <Button
              variant="primary"
              size="sm"
              loading={startMutation.isPending && startMutation.variables === record.id}
              disabled={isDependencyBlocked(record)}
              title={isDependencyBlocked(record) ? '存在未完成前置依赖，暂不能开始' : undefined}
              onClick={() => void handleStart(record)}
            >
              开始
            </Button>
          )}
          {canOperateTask && record.status === 'in_progress' && (
            <Button
              variant="ghost"
              size="sm"
              loading={rowMaterialAction?.taskId === record.id && rowMaterialAction.mode === 'issue'}
              onClick={() => void handleMaterialActionFromList(record, 'issue')}
            >
              继续领料
            </Button>
          )}
          {canOperateTask && record.status === 'in_progress' && (
            <Button
              variant="ghost"
              size="sm"
              loading={rowMaterialAction?.taskId === record.id && rowMaterialAction.mode === 'return'}
              onClick={() => void handleMaterialActionFromList(record, 'return')}
            >
              退料回仓
            </Button>
          )}
          {canOperateTask && record.status === 'in_progress' && (
            <Button
              variant="success"
              size="sm"
              disabled={isDependencyBlocked(record)}
              title={isDependencyBlocked(record) ? '存在未完成前置依赖，暂不能完工上报' : undefined}
              onClick={() => openCompleteModal(record)}
            >
              完成
            </Button>
          )}
          {canOperateTask && (record.status === 'pending' || record.status === 'in_progress') && (
            <Button
              variant="danger"
              size="sm"
              disabled={isDependencyBlocked(record)}
              title={isDependencyBlocked(record) ? '存在未完成前置依赖，暂不能上报异常' : undefined}
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

        <select
          className={styles.select}
          value={workerFilter}
          onChange={(e) => handleWorkerFilterChange(e.target.value)}
          aria-label="工人筛选"
        >
          <option value="">全部工人</option>
          {workerOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>

        <select
          className={styles.select}
          value={taskTypeFilter}
          onChange={(e) => handleTaskTypeFilterChange(e.target.value as TaskType | '')}
          aria-label="任务类型筛选"
        >
          <option value="">全部任务类型</option>
          <option value="finished">成品任务</option>
          <option value="semi_finished">半成品任务</option>
        </select>

        <select
          className={styles.select}
          value={executionModeFilter}
          onChange={(e) => handleExecutionModeFilterChange(e.target.value as ExecutionMode | '')}
          aria-label="执行方式筛选"
        >
          <option value="">全部执行方式</option>
          <option value="internal">厂内生产</option>
          <option value="outsource">外协采购</option>
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
        width="min(1080px, 92vw)"
        footer={
          taskDetail ? (
            <TaskDrawerFooter
              task={taskDetail as ProductionTask}
              canOperateTask={canOperateTask}
              isSupervisor={isSupervisor}
              startLoading={startMutation.isPending}
              completeLoading={completeMutation.isPending}
              issueLoading={issueMutation.isPending}
              returnLoading={returnMutation.isPending}
              onStart={() => void handleStartFromDrawer()}
              onIssue={handleIssueFromDrawer}
              onReturn={handleReturnFromDrawer}
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
          exportLoading={documentAction?.taskId === selectedTaskId && documentAction.type === 'export'}
          printLoading={documentAction?.taskId === selectedTaskId && documentAction.type === 'print'}
          onExport={(taskId) => void handleExportDocument(taskId)}
          onPrint={(taskId) => void handlePrintDocument(taskId)}
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
        submitError={completeSubmitError}
        loading={completeMutation.isPending}
        onQtyChange={(v) => { setCompleteQty(v); setCompleteError(''); setCompleteSubmitError(''); }}
        onScrapQtyChange={setCompleteScrapQty}
        onHoursChange={(v) => { setCompleteHours(v); setCompleteHoursError(''); setCompleteSubmitError(''); }}
        onNotesChange={(v) => { setCompleteNotes(v); setCompleteSubmitError(''); }}
        onClose={() => { setCompleteOpen(false); setCompleteSubmitError(''); }}
        onConfirm={() => void handleComplete()}
      />

      <MaterialActionModal
        open={materialActionOpen}
        mode={materialActionMode}
        task={materialActionTask}
        drafts={materialActionDrafts}
        error={materialActionError}
        loading={issueMutation.isPending || returnMutation.isPending}
        onDraftChange={handleMaterialActionDraftChange}
        onClose={() => setMaterialActionOpen(false)}
        onConfirm={() => void handleMaterialAction()}
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

function useAuthBlobUrl(url: string | null) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!url) {
      setBlobUrl(null);
      return;
    }

    let revokedUrl: string | null = null;
    let cancelled = false;
    const token = getAccessToken();

    fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        revokedUrl = URL.createObjectURL(blob);
        setBlobUrl(revokedUrl);
      })
      .catch(() => {
        if (!cancelled) setBlobUrl(null);
      });

    return () => {
      cancelled = true;
      if (revokedUrl) URL.revokeObjectURL(revokedUrl);
    };
  }, [url]);

  return blobUrl;
}

function TaskGuideAttachment({
  url,
  fileName,
}: {
  url: string;
  fileName?: string | null;
}) {
  const previewable = isGuideImage(url, fileName);
  const blobUrl = useAuthBlobUrl(previewable ? url : null);
  const label = getGuideAttachmentLabel(url, fileName);

  return (
    <div className={styles.guideAttachment}>
      {previewable && blobUrl ? (
        <img
          src={blobUrl}
          alt={label}
          className={styles.guideAttachmentPreview}
          onClick={() => openAuthFile(url)}
        />
      ) : null}
      <button
        type="button"
        className={styles.guideAttachmentLink}
        onClick={() => openAuthFile(url)}
      >
        {previewable ? `查看附件：${label}` : `打开附件：${label}`}
      </button>
    </div>
  );
}

// ─── TaskDetailContent — 抽屉主体内容 ───────────────────

interface TaskDetailContentProps {
  task: ProductionTask | undefined;
  loading: boolean;
  exportLoading: boolean;
  printLoading: boolean;
  onExport: (taskId: number) => void;
  onPrint: (taskId: number) => void;
}

function TaskDetailContent({
  task,
  loading,
  exportLoading,
  printLoading,
  onExport,
  onPrint,
}: TaskDetailContentProps) {
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
  const primaryName = getTaskPrimaryName(task);
  const secondaryName = getTaskSecondaryName(task);
  const semiFinishedTask = task.taskType
    ? task.taskType === 'semi_finished'
    : isSemiFinishedTask(task);
  const predecessors = task.dependencySummary?.predecessors ?? [];
  const inputItems = task.inputItems ?? [];
  const outputItems = task.outputItems ?? [];
  const inputTransactions = task.materialTransactions?.filter((item) => item.ioType === 'input') ?? [];
  const outputTransactions = task.materialTransactions?.filter((item) => item.ioType === 'output') ?? [];
  const hasProcessGuide = Boolean(task.processGuideText || task.processGuideAttachmentUrl);

  return (
    <div className={styles.drawerContent}>
      <section className={styles.drawerSection}>
        <div className={styles.documentActionBar}>
          <div>
            <h3 className={styles.drawerSectionTitle}>任务工单</h3>
            <p className={styles.documentActionHint}>导出清单或直接打印给现场工人执行。</p>
          </div>
          <div className={styles.documentActionButtons}>
            <Button variant="ghost" size="sm" loading={exportLoading} onClick={() => onExport(task.id)}>
              导出工单
            </Button>
            <Button variant="secondary" size="sm" loading={printLoading} onClick={() => onPrint(task.id)}>
              打印工单
            </Button>
          </div>
        </div>
      </section>

      <section className={styles.drawerSection}>
        <h3 className={styles.drawerSectionTitle}>执行概览</h3>
        <div className={styles.executionOverview}>
          <MetricCard label="任务编号" value={formatTaskLabel(task)} />
          <MetricCard label="计划数量" value={formatQty(task.plannedQty)} />
          <MetricCard label="已完成" value={formatQty(task.completedQty ?? 0)} />
          <MetricCard label="实际工时" value={task.actualHours != null ? `${task.actualHours}h` : '未上报'} />
          <MetricCard label="领料状态" value={task.materialIssueLabel || '无需领料'} accent="default" />
          <MetricCard label={semiFinishedTask ? '当前半成品' : '当前产出'} value={primaryName} accent="teal" />
          <MetricCard label="工资结果" value={task.wageReport ? `¥${task.wageReport.subtotal}` : '待生成'} accent="amber" />
        </div>
      </section>

      <section className={styles.drawerSection}>
        <h3 className={styles.drawerSectionTitle}>基本信息</h3>
        <dl className={styles.infoGrid}>
          <DetailItem label="任务日期" value={task.taskDate || '—'} />
          <DetailItem label="期望完成时间" value={formatDateTime(task.plannedFinishTime)} />
          <DetailItem label="工单号" value={task.orderNo || '—'} />
          <DetailItem label="任务编号" value={formatTaskLabel(task)} />
          <DetailItem label="所属成品" value={task.productName || task.skuName || '—'} />
          <DetailItem label="当前工序" value={task.processName || '—'} />
          <DetailItem label="领料状态" value={renderMaterialIssueBadge(task)} />
          <DetailItem label="当前产出" value={primaryName} />
          <DetailItem label="任务类型" value={semiFinishedTask ? '半成品任务' : '成品任务'} />
          <DetailItem label="执行方式" value={task.executionMode === 'outsource' ? '外协采购' : '厂内生产'} />
          {secondaryName && <DetailItem label="说明" value={secondaryName} />}
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

      {hasProcessGuide && (
        <section className={styles.drawerSection}>
          <h3 className={styles.drawerSectionTitle}>工序操作指南</h3>
          <div className={styles.guideCard}>
            {task.processGuideText ? (
              <p className={styles.guideText}>{task.processGuideText}</p>
            ) : (
              <p className={styles.drawerEmptyText}>当前工序未配置文字说明</p>
            )}
            {task.processGuideAttachmentUrl ? (
              <TaskGuideAttachment
                url={task.processGuideAttachmentUrl}
                fileName={task.processGuideAttachmentName}
              />
            ) : (
              <p className={styles.drawerEmptyText}>当前工序未上传附件</p>
            )}
          </div>
        </section>
      )}

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
                  {(item.skuName || item.skuCode) ? (
                    <div className={styles.dependencyCard__summary}>
                      <span className={styles.ioTypeBadge}>半成品</span>
                      <span>{item.skuName || item.skuCode}</span>
                      {item.skuCode && item.skuName ? <span>{item.skuCode}</span> : null}
                    </div>
                  ) : null}
                  <div className={styles.dependencyCard__meta}>
                    <span>SKU {item.skuCode || '—'}</span>
                    <span>需求 {formatQtyWithUnit(item.requiredQty, item.unit)}</span>
                    <span>已完成 {formatQtyWithUnit(item.completedQty, item.unit)}</span>
                    <span>状态 {item.status}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className={styles.drawerSection}>
        <h3 className={styles.drawerSectionTitle}>任务输入 / 输出清单</h3>
        <div className={styles.ioGrid}>
          <div className={styles.taskIOPanel}>
            <div className={styles.tracePanel__title}>输入项</div>
            {inputItems.length === 0 ? (
              <p className={styles.drawerEmptyText}>当前任务没有输入项配置</p>
            ) : (
              <div className={styles.taskIOList}>
                {inputItems.map((item) => {
                  const tone = getInputItemTone(item);
                  return (
                    <div key={`input-${item.itemType}-${item.skuId}-${item.operationId ?? 'na'}`} className={styles.taskIOItem}>
                      <div className={styles.taskIOItem__header}>
                        <strong>{item.skuName || item.skuCode || `SKU#${item.skuId}`}</strong>
                        <span
                          className={[
                            styles.ioTypeBadge,
                            item.itemType === 'semi_finished'
                              ? styles['ioTypeBadge--semi']
                              : styles['ioTypeBadge--material'],
                          ].join(' ')}
                        >
                          {item.itemType === 'semi_finished' ? '半成品输入' : '原材料输入'}
                        </span>
                      </div>
                      <div className={styles.taskIOItem__meta}>
                        <span>SKU {item.skuCode || '—'}</span>
                        <span>{item.stepName ? `来源工序 ${item.stepName}` : `来源 ${item.sourceLabel}`}</span>
                        <span>需求 {formatQtyWithUnit(item.requiredQty, item.unit)}</span>
                      </div>
                      <div className={styles.taskIOItem__meta}>
                        <span>{item.itemType === 'semi_finished' ? '已齐套' : '已投'} {formatQtyWithUnit(item.fulfilledQty, item.unit)}</span>
                        <span>可用数量 {formatQtyWithUnit(item.qtyAvailable, item.unit)}</span>
                        <span>仓库/库位 {formatWarehouseLocation(item)}</span>
                        <span className={styles[`taskIOStock--${tone}`]}>
                          {Number(item.shortageQty ?? 0) > 0 ? `缺口 ${formatQtyWithUnit(item.shortageQty, item.unit)}` : '库存充足'}
                        </span>
                        <span>{item.status || '—'}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className={styles.taskIOPanel}>
            <div className={styles.tracePanel__title}>输出项</div>
            {outputItems.length === 0 ? (
              <p className={styles.drawerEmptyText}>当前任务没有输出项配置</p>
            ) : (
              <div className={styles.taskIOList}>
                {outputItems.map((item) => (
                  <div key={`output-${item.skuId}-${item.itemType}`} className={styles.taskIOItem}>
                    <div className={styles.taskIOItem__header}>
                      <strong>{item.skuName || item.skuCode || `SKU#${item.skuId}`}</strong>
                      <span
                        className={[
                          styles.ioTypeBadge,
                          item.itemType === 'semi_finished'
                            ? styles['ioTypeBadge--semi']
                            : styles['ioTypeBadge--finished'],
                        ].join(' ')}
                      >
                        {item.itemType === 'semi_finished' ? '半成品输出' : '成品输出'}
                      </span>
                    </div>
                    <div className={styles.taskIOItem__meta}>
                      <span>SKU {item.skuCode || `#${item.skuId}`}</span>
                      <span>对应工序 {item.processName || task.processName || '—'}</span>
                      <span>计划产出 {formatQtyWithUnit(item.plannedQty, item.unit)}</span>
                      <span>实际产出 {formatQtyWithUnit(item.actualQty, item.unit)}</span>
                    </div>
                    <div className={styles.taskIOItem__meta}>
                      <span>仓库/库位 {formatWarehouseLocation(item)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
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
              {item.notes ? (
                <div className={styles.traceItem__meta}>
                  <span>说明 {item.notes}</span>
                </div>
              ) : null}
              <div className={styles.traceItem__meta}>
                <span>仓库/库位 {formatWarehouseLocation(item)}</span>
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
  canOperateTask: boolean;
  isSupervisor: boolean;
  startLoading: boolean;
  completeLoading: boolean;
  issueLoading: boolean;
  returnLoading: boolean;
  onStart: () => void;
  onIssue: () => void;
  onReturn: () => void;
  onComplete: () => void;
  onException: () => void;
  onResolve: () => void;
  onSuspend: () => void;
}

function TaskDrawerFooter({
  task,
  canOperateTask,
  isSupervisor,
  startLoading,
  completeLoading,
  issueLoading,
  returnLoading,
  onStart,
  onIssue,
  onReturn,
  onComplete,
  onException,
  onResolve,
  onSuspend,
}: TaskDrawerFooterProps) {
  if (!canOperateTask) {
    return null;
  }

  const dependencyBlocked = Boolean(task.dependencySummary?.blocked);
  const blockingReason = task.dependencySummary?.blockingReason || '存在未完成前置依赖';

  if (task.status === 'pending') {
    return (
      <div className={styles.drawerFooterActions}>
        <Button
          variant="ghost"
          size="md"
          loading={issueLoading}
          onClick={onIssue}
          style={{ flex: 1 }}
        >
          领料到线边
        </Button>
        <Button
          variant="primary"
          size="md"
          loading={startLoading}
          disabled={dependencyBlocked}
          title={dependencyBlocked ? `${blockingReason}，暂不能开始` : undefined}
          onClick={onStart}
          style={{ flex: 1 }}
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
          variant="ghost"
          size="md"
          loading={issueLoading}
          onClick={onIssue}
          style={{ flex: 1 }}
        >
          继续领料
        </Button>
        <Button
          variant="ghost"
          size="md"
          loading={returnLoading}
          onClick={onReturn}
          style={{ flex: 1 }}
        >
          退料回仓
        </Button>
        <Button
          variant="success"
          size="md"
          loading={completeLoading}
          disabled={dependencyBlocked}
          title={dependencyBlocked ? `${blockingReason}，暂不能完工上报` : undefined}
          onClick={onComplete}
          style={{ flex: 1 }}
        >
          完工上报
        </Button>
        <Button
          variant="danger"
          size="md"
          disabled={dependencyBlocked}
          title={dependencyBlocked ? `${blockingReason}，暂不能上报异常` : undefined}
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
  submitError: string;
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
  submitError,
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
      size="lg"
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

          {submitError ? (
            <p className={styles.formError} role="alert">
              {submitError}
            </p>
          ) : null}

          <div className={`${styles.modalFormInner} ${gradeUnconfigured ? styles.modalFormDisabled : ''}`}>
            <section className={styles.completeHero}>
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
                  <span>{isSemiFinishedTask(task) ? '当前半成品' : '当前产出'}</span>
                  <strong>{getTaskPrimaryName(task)}</strong>
                </div>
                <div className={styles.completeSummaryCard}>
                  <span>依赖状态</span>
                  <strong>{task.dependencySummary?.blocked ? '仍有阻塞' : '可正常完工'}</strong>
                </div>
                <div className={styles.completeSummaryCard}>
                  <span>本次计划完成</span>
                  <strong>{formatQtyWithUnit(task.plannedQty, '件')}</strong>
                </div>
              </div>
            </section>

            {/* 超时预警横幅 */}
            {isOvertimeWarning && (
              <div className={styles.overtimeWarningBanner}>
                <span className={styles.overtimeWarningIcon}>⚠</span>
                实际工时超过极限工时的 120%，请确认是否存在异常情况。
              </div>
            )}

            <div className={styles.completeModalGrid}>
              <section className={styles.completeFormPanel}>
                <div className={styles.completePanelHeader}>
                  <h3 className={styles.completePanelTitle}>报工信息</h3>
                  <p className={styles.completePanelHint}>先填写本次产出与工时，再补充损耗和备注。</p>
                </div>

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

                <div className={styles.formGroup}>
                  <label htmlFor="complete-scrap" className={styles.formLabel}>
                    废品数量（件）<span className={styles.formOptional}>选填</span>
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
                  <p className={styles.formAssistText}>
                    废品数量将记录为实际损耗，用于成本核算。
                  </p>
                </div>

                <div className={styles.formGroup}>
                  <label htmlFor="complete-notes" className={styles.formLabel}>
                    备注<span className={styles.formOptional}>选填</span>
                  </label>
                  <textarea
                    id="complete-notes"
                    className={styles.formTextarea}
                    rows={4}
                    placeholder="请填写完成说明、质量情况等..."
                    value={notes}
                    onChange={(e) => onNotesChange(e.target.value)}
                    disabled={gradeUnconfigured}
                  />
                </div>
              </section>

              {task.unitPrice != null && (
                <aside className={styles.completeSidePanel}>
                  <div className={styles.completePanelHeader}>
                    <h3 className={styles.completePanelTitle}>工资预览</h3>
                    <p className={styles.completePanelHint}>根据当前输入实时估算本次报工工资。</p>
                  </div>

                  <div className={styles.wagePreview}>
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
                </aside>
              )}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

interface MaterialActionModalProps {
  open: boolean;
  mode: 'issue' | 'return';
  task: ProductionTask | null;
  drafts: MaterialActionDraft[];
  error: string;
  loading: boolean;
  onDraftChange: (skuId: number, patch: Partial<MaterialActionDraft>) => void;
  onClose: () => void;
  onConfirm: () => void;
}

function MaterialActionModal({
  open,
  mode,
  task,
  drafts,
  error,
  loading,
  onDraftChange,
  onClose,
  onConfirm,
}: MaterialActionModalProps) {
  const materialItems = (task?.inputItems ?? []).filter((item) => item.itemType === 'material');
  const actionLabel = mode === 'issue' ? '领料到线边' : '退料回仓';

  return (
    <Modal
      open={open}
      title={actionLabel}
      onClose={onClose}
      onConfirm={onConfirm}
      confirmLabel={actionLabel}
      confirmVariant={mode === 'issue' ? 'primary' : 'success'}
      confirmLoading={loading}
      size="lg"
    >
      {task && (
        <div className={styles.modalForm}>
          <div className={styles.modalTaskInfo}>
            <span className={styles.modalTaskLabel}>任务</span>
            <span className={styles.modalTaskValue}>{formatTaskLabel(task)}</span>
            <span className={styles.modalTaskSep}>·</span>
            <span className={styles.modalTaskValue}>{task.processName}</span>
          </div>

          {materialItems.length === 0 ? (
            <p className={styles.drawerEmptyText}>当前任务没有可操作的原材料输入项</p>
          ) : (
            <div className={styles.taskIOList}>
              {materialItems.map((item) => {
                const draft = drafts.find((entry) => entry.skuId === item.skuId);
                return (
                  <MaterialActionRowEditor
                    key={`material-action-${item.skuId}`}
                    item={item}
                    draft={draft}
                    mode={mode}
                    onDraftChange={onDraftChange}
                  />
                );
              })}
            </div>
          )}

          {error ? (
            <p className={styles.formError} role="alert">
              {error}
            </p>
          ) : null}
        </div>
      )}
    </Modal>
  );
}

function MaterialActionRowEditor({
  item,
  draft,
  mode,
  onDraftChange,
}: {
  item: NonNullable<ProductionTask['inputItems']>[number];
  draft: MaterialActionDraft | undefined;
  mode: 'issue' | 'return';
  onDraftChange: (skuId: number, patch: Partial<MaterialActionDraft>) => void;
}) {
  const { data: warehouseOptions = [] } = useWarehouseOptions(true);
  const selectedWarehouseId = draft?.warehouseId ?? item.warehouseId ?? undefined;
  const { data: locationOptions = [] } = useLocationOptions(selectedWarehouseId, true);
  const selectedLocationId = draft?.locationId ?? item.locationId ?? undefined;

  const handleWarehouseChange = useCallback((value: string) => {
    const warehouseId = value ? Number(value) : undefined;
    onDraftChange(item.skuId, {
      warehouseId,
      locationId: undefined,
    });
  }, [item.skuId, onDraftChange]);

  const handleLocationChange = useCallback((value: string) => {
    const locationId = value ? Number(value) : undefined;
    onDraftChange(item.skuId, { locationId });
  }, [item.skuId, onDraftChange]);

  return (
    <div className={styles.taskIOItem}>
      <div className={styles.taskIOItem__header}>
        <strong>{item.skuName || item.skuCode || `SKU#${item.skuId}`}</strong>
        <span className={`${styles.ioTypeBadge} ${styles['ioTypeBadge--material']}`}>
          原材料
        </span>
      </div>
      <div className={styles.taskIOItem__meta}>
        <span>需求 {formatQtyWithUnit(item.requiredQty, item.unit)}</span>
        <span>当前状态 {item.status || '—'}</span>
        <span>默认仓库/库位 {formatWarehouseLocation(item)}</span>
        {item.hasDyeLot ? <span>需缸号</span> : null}
      </div>
      <div className={styles.formRow}>
        <div className={styles.formGroup}>
          <label className={styles.formLabel} htmlFor={`material-qty-${item.skuId}`}>
            {mode === 'issue' ? '本次领料数量' : '本次退料数量'}
          </label>
          <input
            id={`material-qty-${item.skuId}`}
            type="number"
            min="0"
            step="0.0001"
            className={styles.formInput}
            placeholder="0"
            value={draft?.qty ?? ''}
            onChange={(e) => onDraftChange(item.skuId, { qty: e.target.value })}
          />
        </div>
        {item.hasDyeLot ? (
          <div className={styles.formGroup}>
            <label className={styles.formLabel} htmlFor={`material-dye-lot-${item.skuId}`}>
              缸号
            </label>
            <input
              id={`material-dye-lot-${item.skuId}`}
              type="text"
              className={styles.formInput}
              placeholder="请输入缸号"
              value={draft?.dyeLotNo ?? ''}
              onChange={(e) => onDraftChange(item.skuId, { dyeLotNo: e.target.value })}
            />
          </div>
        ) : null}
        <div className={styles.formGroup}>
          <label className={styles.formLabel} htmlFor={`material-warehouse-${item.skuId}`}>
            仓库
          </label>
          <select
            id={`material-warehouse-${item.skuId}`}
            className={styles.select}
            value={selectedWarehouseId ?? ''}
            onChange={(e) => handleWarehouseChange(e.target.value)}
          >
            <option value="">请选择仓库</option>
            {warehouseOptions.map((warehouse) => (
              <option key={warehouse.id} value={warehouse.id}>
                {warehouse.name} ({warehouse.code})
              </option>
            ))}
          </select>
        </div>
        <div className={styles.formGroup}>
          <label className={styles.formLabel} htmlFor={`material-location-${item.skuId}`}>
            库位
          </label>
          <select
            id={`material-location-${item.skuId}`}
            className={styles.select}
            value={selectedLocationId ?? ''}
            onChange={(e) => handleLocationChange(e.target.value)}
            disabled={!selectedWarehouseId}
          >
            <option value="">请选择库位</option>
            {locationOptions.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name} ({location.code})
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
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
                  aria-pressed={exceptionType === et.value}
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
                aria-pressed={affectsProgress === true}
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
                aria-pressed={affectsProgress === false}
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
