import { startTransition, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { useAppStore } from '@/stores/appStore';
import {
  productionApi,
  productionKeys,
  useAdjustSchedule,
  useConfirmSchedule,
  useProductionWorkers,
  useProductionWorkstations,
  useSchedule,
} from '@/api/production';
import type { ProductionWorkerOption, WorkstationOption } from '@/api/production';
import { ApiCode, ApiError } from '@/types/api';
import type { ScheduleItem, ScheduleResult } from '@/types/models';
import Button from '@/components/common/Button';
import Tag from '@/components/common/Tag';
import styles from './SchedulePage.module.css';

type ScheduleView = 'station' | 'order' | 'worker';
type TaskBlockVariant = 'normal' | 'warning' | 'danger';
type MaterialStatus = 'ok' | 'warn' | 'err';
type TimeSlotLabel = '08:00 — 10:00' | '10:00 — 12:00' | '13:30 — 15:30' | '15:30 — 17:30';
type RiskLevel = 'info' | 'warning' | 'danger';

interface GanttTask {
  source: ScheduleItem;
  orderLabel: string;
  operation: string;
  outputSkuName: string;
  workerInfo: string;
  materialIcon: string;
  variant: TaskBlockVariant;
}

interface StationRow {
  stationId: string;
  stationName: string;
  workerInCharge: string;
  materialStatus: MaterialStatus;
  materialLabel: string;
  slots: Partial<Record<TimeSlotLabel, GanttTask>>;
  totalTasks: number;
}

interface WorkerTaskItem {
  source: ScheduleItem;
  scheduleId: number;
  workOrderNo: string;
  stepName: string;
  outputSkuName: string;
  stationName: string;
  plannedQty: string;
  estimatedHours: string;
  time: string;
}

interface WorkerCard {
  workerId: string;
  initial: string;
  name: string;
  roleLine: string;
  totalHours: string;
  tasks: WorkerTaskItem[];
}

interface OrderCard {
  productionOrderId: number;
  workOrderNo: string;
  outputSkuNames: string[];
  totalHours: string;
  totalQty: string;
  stepCount: number;
  workerCount: number;
  stationCount: number;
  risk: TaskBlockVariant;
  lines: Array<{
    source: ScheduleItem;
    scheduleId: number;
    stepName: string;
    outputSkuName: string;
    workerName: string;
    workstationName: string;
    plannedQty: string;
    estimatedHours: string;
    status: ScheduleItem['status'];
  }>;
}

const EMPTY_SCHEDULES: ScheduleItem[] = [];

interface ScheduleRisk {
  level: RiskLevel;
  title: string;
  description: string;
}

const TIME_SLOTS: TimeSlotLabel[] = [
  '08:00 — 10:00',
  '10:00 — 12:00',
  '13:30 — 15:30',
  '15:30 — 17:30',
];

const ALERT_STORAGE_KEY = 'schedule-risk-alert-dismissed';

function formatInputDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getNextWorkday(date: Date): string {
  const next = new Date(date);
  next.setDate(next.getDate() + 1);
  while (next.getDay() === 0 || next.getDay() === 6) {
    next.setDate(next.getDate() + 1);
  }
  return formatInputDate(next);
}

function formatScheduleDate(date: string): string {
  const raw = new Date(`${date}T00:00:00`);
  const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][raw.getDay()];
  return `${date} ${week}`;
}

function parseNumeric(value?: string | number | null): number {
  if (typeof value === 'number') return value;
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseOptionalId(value?: string | number | null): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function patchAdjustedScheduleResult(
  current: ScheduleResult | undefined,
  selectedTask: ScheduleItem,
  adjustment: {
    scheduleId: number;
    workerId?: number;
    workstationId?: number;
    plannedQty?: string;
  },
  workers: ProductionWorkerOption[],
  workstations: WorkstationOption[],
): ScheduleResult | undefined {
  if (!current) return current;

  const previousPlannedQty = parseNumeric(selectedTask.plannedQty);
  const previousEstimatedHours = parseNumeric(selectedTask.estimatedHours);
  const nextWorker = adjustment.workerId
    ? workers.find((worker) => Number(worker.id) === adjustment.workerId)
    : null;
  const nextWorkstation = adjustment.workstationId
    ? workstations.find((workstation) => Number(workstation.id) === adjustment.workstationId)
    : null;

  return {
    ...current,
    schedules: current.schedules.map((item) => {
      if (parseOptionalId(item.scheduleId) !== adjustment.scheduleId) {
        return item;
      }

      const nextPlannedQty = adjustment.plannedQty ?? item.plannedQty;
      const nextEstimatedHours =
        adjustment.plannedQty !== undefined && previousPlannedQty > 0
          ? ((parseNumeric(nextPlannedQty) / previousPlannedQty) * previousEstimatedHours).toFixed(2)
          : item.estimatedHours;

      return {
        ...item,
        plannedQty: nextPlannedQty,
        estimatedHours: nextEstimatedHours,
        workerId: adjustment.workerId ?? item.workerId,
        workerName: adjustment.workerId !== undefined ? nextWorker?.name ?? null : item.workerName,
        workstationId: adjustment.workstationId ?? item.workstationId,
        workstationName:
          adjustment.workstationId !== undefined ? nextWorkstation?.name ?? null : item.workstationName,
      };
    }),
  };
}

function formatQty(value: string): string {
  const numeric = parseNumeric(value);
  return Number.isInteger(numeric) ? `${numeric}` : numeric.toFixed(2);
}

function formatHours(value: string): string {
  return `${parseNumeric(value).toFixed(1)}h`;
}

function parseLoadRate(rate?: string | null): number {
  if (!rate) return 0;
  return Number(String(rate).replace('%', '')) || 0;
}

function isValidDateString(value: string | null): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function getTaskVariant(item: ScheduleItem, slotIndex: number, loadRate: number): TaskBlockVariant {
  if (!item.workerId || !item.workstationId) return 'danger';
  if (loadRate >= 92 && slotIndex >= 2) return 'danger';
  if (loadRate >= 80 && slotIndex >= 1) return 'warning';
  return 'normal';
}

function getMaterialStatusForStation(items: ScheduleItem[]): { status: MaterialStatus; label: string } {
  if (items.some((item) => !item.workstationId)) {
    return { status: 'err', label: '待补排工位' };
  }
  if (items.some((item) => !item.workerId)) {
    return { status: 'warn', label: '待补排工人' };
  }
  return { status: 'ok', label: '料已备好' };
}

function buildStationRows(schedules: ScheduleItem[], loadRate: number): StationRow[] {
  const groups = new Map<string, ScheduleItem[]>();

  schedules.forEach((item) => {
    const key = item.workstationId ? String(item.workstationId) : `pending-${item.processStepId}`;
    const current = groups.get(key) ?? [];
    current.push(item);
    groups.set(key, current);
  });

  return [...groups.entries()].map(([stationId, items]) => {
    const slots: Partial<Record<TimeSlotLabel, GanttTask>> = {};
    items.forEach((item, index) => {
      if (index >= TIME_SLOTS.length) return;
      const slot = TIME_SLOTS[index];
      slots[slot] = {
        source: item,
        orderLabel: item.workOrderNo,
        operation: item.stepName,
        outputSkuName: item.outputSkuName ?? '未配置产出',
        workerInfo: item.workerName
          ? `${item.workerName} · ${formatQty(item.plannedQty)}套`
          : `${formatQty(item.plannedQty)}套 · 待分配`,
        materialIcon: item.workerId && item.workstationId ? '✓ 备料就绪' : '⚠ 待补排资源',
        variant: getTaskVariant(item, index, loadRate),
      };
    });

    const material = getMaterialStatusForStation(items);
    const names = [...new Set(items.map((item) => item.workerName).filter(Boolean))] as string[];

    return {
      stationId,
      stationName: items[0]?.workstationName ?? '待分配工位',
      workerInCharge: names.length > 0 ? names.join(' / ') : '待分配',
      materialStatus: material.status,
      materialLabel: material.label,
      slots,
      totalTasks: items.length,
    };
  });
}

function buildWorkerCards(schedules: ScheduleItem[]): WorkerCard[] {
  const groups = new Map<string, { name: string; tasks: ScheduleItem[] }>();

  schedules.forEach((item) => {
    const key = item.workerId ? String(item.workerId) : `pending-${item.scheduleId}`;
    const name = item.workerName || '待分配工人';
    const current = groups.get(key) ?? { name, tasks: [] };
    current.tasks.push(item);
    groups.set(key, current);
  });

  return [...groups.entries()]
    .map(([workerId, group]) => {
      const totalHours = group.tasks.reduce((sum, item) => sum + parseNumeric(item.estimatedHours), 0);
      return {
        workerId,
        initial: group.name.charAt(0) || '?',
        name: group.name,
        roleLine: `${group.tasks[0]?.workstationName ?? '待排工位'} · ${group.tasks.length} 项任务`,
        totalHours: totalHours.toFixed(1),
        tasks: group.tasks.slice(0, TIME_SLOTS.length).map((item, index) => ({
          source: item,
          scheduleId: item.scheduleId,
          workOrderNo: item.workOrderNo,
          stepName: item.stepName,
          outputSkuName: item.outputSkuName ?? '未配置产出',
          stationName: item.workstationName ?? '待分配工位',
          plannedQty: item.plannedQty,
          estimatedHours: item.estimatedHours,
          time: TIME_SLOTS[index] ?? TIME_SLOTS[TIME_SLOTS.length - 1],
        })),
      };
    })
    .sort((left, right) => parseNumeric(right.totalHours) - parseNumeric(left.totalHours));
}

function buildOrderCards(schedules: ScheduleItem[]): OrderCard[] {
  const groups = new Map<number, ScheduleItem[]>();

  schedules.forEach((item) => {
    const current = groups.get(item.productionOrderId) ?? [];
    current.push(item);
    groups.set(item.productionOrderId, current);
  });

  return [...groups.entries()]
    .map(([productionOrderId, items]) => {
      const totalHours = items.reduce((sum, item) => sum + parseNumeric(item.estimatedHours), 0);
      const totalQty = items.reduce((sum, item) => sum + parseNumeric(item.plannedQty), 0);
      const hasGap = items.some((item) => !item.workerId || !item.workstationId);
      const hasCrowded = items.length >= TIME_SLOTS.length;
      const risk: TaskBlockVariant = hasGap ? 'danger' : hasCrowded ? 'warning' : 'normal';

      return {
        productionOrderId,
        workOrderNo: items[0]?.workOrderNo ?? `WO-${productionOrderId}`,
        outputSkuNames: [...new Set(items.map((item) => item.outputSkuName).filter(Boolean))] as string[],
        totalHours: totalHours.toFixed(1),
        totalQty: totalQty.toFixed(2),
        stepCount: items.length,
        workerCount: new Set(items.map((item) => item.workerId).filter(Boolean)).size,
        stationCount: new Set(items.map((item) => item.workstationId).filter(Boolean)).size,
        risk,
        lines: items.map((item) => ({
          source: item,
          scheduleId: item.scheduleId,
          stepName: item.stepName,
          outputSkuName: item.outputSkuName ?? '未配置产出',
          workerName: item.workerName ?? '待分配',
          workstationName: item.workstationName ?? '待分配工位',
          plannedQty: item.plannedQty,
          estimatedHours: item.estimatedHours,
          status: item.status,
        })),
      };
    })
    .sort((left, right) => right.stepCount - left.stepCount || parseNumeric(right.totalHours) - parseNumeric(left.totalHours));
}

function deriveRisks(schedules: ScheduleItem[], loadRate: number): ScheduleRisk[] {
  const risks: ScheduleRisk[] = [];
  const unassigned = schedules.filter((item) => !item.workerId || !item.workstationId).length;
  const crowded = new Set(
    schedules.filter((_, index) => index >= TIME_SLOTS.length * 2).map((item) => item.workstationName ?? '待分配工位'),
  );

  if (loadRate >= 95) {
    risks.push({
      level: 'danger',
      title: '今日产能已接近满载',
      description: `当前排产负荷 ${loadRate.toFixed(1)}%，建议主管优先确认瓶颈工位并提前锁定首班任务。`,
    });
  } else if (loadRate >= 80) {
    risks.push({
      level: 'warning',
      title: '今日排产存在高负荷工位',
      description: `当前排产负荷 ${loadRate.toFixed(1)}%，建议优先关注下午时段的工序堆叠。`,
    });
  }

  if (unassigned > 0) {
    risks.push({
      level: 'danger',
      title: '存在待补排资源的工序',
      description: `还有 ${unassigned} 条排产记录未补齐工人或工作站，确认下发前需要先完成资源指派。`,
    });
  }

  if (crowded.size > 0) {
    risks.push({
      level: 'info',
      title: '部分工位任务集中在单日内',
      description: `建议重点查看 ${[...crowded].slice(0, 2).join('、')} 等工位，避免后半日排程拥堵。`,
    });
  }

  return risks;
}

function getRiskTagVariant(level: RiskLevel): 'info' | 'warning' | 'error' {
  if (level === 'danger') return 'error';
  if (level === 'warning') return 'warning';
  return 'info';
}

function getOrderRiskLabel(variant: TaskBlockVariant): string {
  if (variant === 'danger') return '需优先处理';
  if (variant === 'warning') return '注意时段堆叠';
  return '按计划推进';
}

export default function SchedulePage() {
  const { setPageTitle, showToast } = useAppStore();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const today = formatInputDate(new Date());
  const initialDate = isValidDateString(searchParams.get('date')) ? searchParams.get('date')! : today;
  const focusWorkOrderNo = searchParams.get('workOrderNo') ?? searchParams.get('workOrderId') ?? '';

  const [selectedDate, setSelectedDate] = useState(initialDate);
  const [scheduleView, setScheduleView] = useState<ScheduleView>(focusWorkOrderNo ? 'order' : 'station');
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<ScheduleItem | null>(null);
  const [manualGenerate, setManualGenerate] = useState(false);
  const [riskDismissed, setRiskDismissed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.sessionStorage.getItem(ALERT_STORAGE_KEY) === '1';
  });
  const [adjustForm, setAdjustForm] = useState({
    workerId: '',
    workstationId: '',
    plannedQty: '',
  });

  useEffect(() => {
    setPageTitle('排产计划');
  }, [setPageTitle]);

  useEffect(() => {
    if (searchParams.get('date') === selectedDate) return;
    const next = new URLSearchParams(searchParams);
    next.set('date', selectedDate);
    setSearchParams(next, { replace: true });
  }, [selectedDate, searchParams, setSearchParams]);

  useEffect(() => {
    setManualGenerate(false);
  }, [selectedDate]);

  const now = new Date();
  const isBeforeAutoWindow =
    selectedDate === today &&
    now.getHours() * 60 + now.getMinutes() < 7 * 60 + 30 &&
    !manualGenerate;

  const scheduleDate = isBeforeAutoWindow ? null : selectedDate;
  const scheduleQuery = useSchedule(scheduleDate);
  const confirmMutation = useConfirmSchedule();
  const adjustMutation = useAdjustSchedule();
  const workersQuery = useProductionWorkers();
  const workstationsQuery = useProductionWorkstations();

  const schedules = scheduleQuery.data?.schedules ?? EMPTY_SCHEDULES;
  const loadRate = parseLoadRate(scheduleQuery.data?.summary.capacityLoadRate);

  const filteredSchedules = useMemo(() => {
    if (!focusWorkOrderNo) return schedules;
    return schedules.filter((item) => item.workOrderNo === focusWorkOrderNo);
  }, [focusWorkOrderNo, schedules]);

  const stationRows = useMemo(
    () => buildStationRows(filteredSchedules, loadRate),
    [filteredSchedules, loadRate],
  );
  const workerCards = useMemo(() => buildWorkerCards(filteredSchedules), [filteredSchedules]);
  const orderCards = useMemo(() => buildOrderCards(filteredSchedules), [filteredSchedules]);
  const risks = useMemo(() => deriveRisks(filteredSchedules, loadRate), [filteredSchedules, loadRate]);

  const metrics = useMemo(() => {
    const totalOrders = new Set(filteredSchedules.map((item) => item.productionOrderId)).size;
    const assignedWorkers = new Set(filteredSchedules.map((item) => item.workerId).filter(Boolean)).size;
    const assignedStations = new Set(filteredSchedules.map((item) => item.workstationId).filter(Boolean)).size;
    const unassignedCount = filteredSchedules.filter((item) => !item.workerId || !item.workstationId).length;
    const totalHours = filteredSchedules.reduce((sum, item) => sum + parseNumeric(item.estimatedHours), 0);
    return {
      totalOrders,
      totalSteps: filteredSchedules.length,
      assignedWorkers,
      assignedStations,
      unassignedCount,
      totalHours: totalHours.toFixed(1),
    };
  }, [filteredSchedules]);

  const hasSchedule = filteredSchedules.length > 0;
  const confirmed = Boolean(scheduleQuery.data?.summary.confirmed);
  const confirmedAt = scheduleQuery.data?.summary.confirmedAt ?? null;
  const alertVisible = !riskDismissed && risks.length > 0;

  const canAdjust = !confirmed && hasSchedule;
  const hasAdjustChanges =
    selectedTask !== null &&
    (adjustForm.workerId !== String(selectedTask.workerId ?? '') ||
      adjustForm.workstationId !== String(selectedTask.workstationId ?? '') ||
      adjustForm.plannedQty !== selectedTask.plannedQty);

  const confirmationStats = useMemo(
    () => ({
      workerCount: metrics.assignedWorkers,
      taskCount: metrics.totalSteps,
    }),
    [metrics],
  );

  const openAdjustModal = (task: ScheduleItem) => {
    if (confirmed) return;
    setSelectedTask(task);
    setAdjustForm({
      workerId: task.workerId ? String(task.workerId) : '',
      workstationId: task.workstationId ? String(task.workstationId) : '',
      plannedQty: task.plannedQty,
    });
  };

  const closeAdjustModal = () => {
    setSelectedTask(null);
  };

  const handleRegenerate = async () => {
    try {
      const nextResult = await productionApi.generateSchedule(selectedDate, true);
      queryClient.setQueryData(productionKeys.schedule(selectedDate), nextResult);
      closeAdjustModal();
      showToast({ type: 'success', message: '已重新生成当日排产方案' });
    } catch {
      showToast({ type: 'error', message: '重新生成失败，请稍后重试' });
    }
  };

  const handleAdjustSave = async () => {
    if (!selectedTask || !hasAdjustChanges) return;
    const scheduleId = parseOptionalId(selectedTask.scheduleId);
    if (!scheduleId) {
      showToast({ type: 'error', message: '排产任务标识无效，请刷新后重试' });
      return;
    }
    try {
      const adjustment = {
        scheduleId,
        workerId: parseOptionalId(adjustForm.workerId) ?? undefined,
        workstationId: parseOptionalId(adjustForm.workstationId) ?? undefined,
        plannedQty: adjustForm.plannedQty,
      };
      await adjustMutation.mutateAsync({
        date: selectedDate,
        adjustments: [
          {
            ...adjustment,
            expectedUpdatedAt: selectedTask.updatedAt,
          },
        ],
      });
      queryClient.setQueryData<ScheduleResult | undefined>(
        productionKeys.schedule(selectedDate),
        (current) =>
          patchAdjustedScheduleResult(
            current,
            selectedTask,
            adjustment,
            workersQuery.data ?? [],
            workstationsQuery.data ?? [],
          ),
      );
      showToast({ type: 'success', message: '排产任务已更新' });
      closeAdjustModal();
    } catch (error) {
      if (error instanceof ApiError && error.code === ApiCode.CONFLICT) {
        await queryClient.invalidateQueries({ queryKey: productionKeys.schedule(selectedDate) });
        closeAdjustModal();
        showToast({ type: 'warning', message: error.message || '排产已被他人修改，已刷新后请重试' });
        return;
      }
      showToast({ type: 'error', message: '排产调整失败，请稍后重试' });
    }
  };

  const handleConfirmSchedule = async () => {
    try {
      await confirmMutation.mutateAsync(selectedDate);
      showToast({
        type: 'success',
        message: `计划已下发，${confirmationStats.workerCount} 名工人将收到今日任务`,
      });
      setConfirmModalOpen(false);
      closeAdjustModal();
    } catch {
      showToast({ type: 'error', message: '下发失败，请稍后重试' });
    }
  };

  const handleDismissRisk = () => {
    setRiskDismissed(true);
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem(ALERT_STORAGE_KEY, '1');
    }
  };

  const handleRestoreRisk = () => {
    setRiskDismissed(false);
    if (typeof window !== 'undefined') {
      window.sessionStorage.removeItem(ALERT_STORAGE_KEY);
    }
  };

  const handleDateChange = (value: string) => {
    startTransition(() => {
      setSelectedDate(value);
      closeAdjustModal();
    });
  };

  if (isBeforeAutoWindow) {
    return (
      <div className={styles.page}>
        <PageHeader
          selectedDate={selectedDate}
          onDateChange={handleDateChange}
          onJumpToday={() => handleDateChange(today)}
          onJumpNextWorkday={() => handleDateChange(getNextWorkday(new Date()))}
          onRefresh={() => setManualGenerate(true)}
          onHistory={() => showToast({ type: 'info', message: '历史排产记录即将上线' })}
        />
        <div className={styles.pre_generate_state}>
          <div className={styles.empty_emoji}>🗓</div>
          <h2>今日排产计划将于 07:30 自动生成</h2>
          <p>当前还未到自动生成时段。如需提前查看，可手动触发一次今日排产计算。</p>
          <div className={styles.empty_actions}>
            <Button variant="ghost" onClick={() => handleDateChange(getNextWorkday(new Date()))}>查看下一工作日</Button>
            <Button variant="ai" onClick={() => setManualGenerate(true)}>立即生成今日计划</Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`${styles.page} ${canAdjust ? styles['page--has-action-bar'] : ''}`}>
      <PageHeader
        selectedDate={selectedDate}
        onDateChange={handleDateChange}
        onJumpToday={() => handleDateChange(today)}
        onJumpNextWorkday={() => handleDateChange(getNextWorkday(new Date()))}
        onRefresh={() => void handleRegenerate()}
        onHistory={() => showToast({ type: 'info', message: '历史排产记录即将上线' })}
      />

      {scheduleQuery.isLoading && (
        <div className={styles.loading_state} role="status" aria-live="polite">
          <span className={styles.loading_spinner} aria-hidden="true" />
          <div>
            <strong>AI 正在分析今日可执行排产</strong>
            <p>正在读取工单优先级、产能和资源占用，通常需要 3-10 秒。</p>
          </div>
        </div>
      )}

      {scheduleQuery.isError && (
        <div className={styles.error_state} role="alert">
          <div>
            <strong>排产计划加载失败</strong>
            <p>可能是排产缓存失效或当前计划生成异常，请重新拉取当日计划。</p>
          </div>
          <Button variant="danger" onClick={() => void handleRegenerate()}>
            重新生成
          </Button>
        </div>
      )}

      {!scheduleQuery.isLoading && !scheduleQuery.isError && (
        <>
          <StatusBar
            dateLabel={formatScheduleDate(selectedDate)}
            totalOrders={metrics.totalOrders}
            stationCount={metrics.assignedStations}
            workerCount={metrics.assignedWorkers}
            confirmed={confirmed}
            confirmedAt={confirmedAt}
            focusWorkOrderNo={focusWorkOrderNo}
          />

          <StatsGrid
            loadRate={loadRate}
            totalSteps={metrics.totalSteps}
            assignedStations={metrics.assignedStations}
            assignedWorkers={metrics.assignedWorkers}
            totalHours={metrics.totalHours}
            unassignedCount={metrics.unassignedCount}
          />

          {alertVisible && <RiskPanel risks={risks} onDismiss={handleDismissRisk} />}
          {!alertVisible && risks.length > 0 && (
            <button type="button" className={styles.restore_alert} onClick={handleRestoreRisk}>
              重新显示 AI 风险提示
            </button>
          )}

          {hasSchedule ? (
            <>
              <ViewToggle value={scheduleView} onChange={setScheduleView} />

              {scheduleView === 'station' && (
                <StationView rows={stationRows} onTaskClick={openAdjustModal} />
              )}

              {scheduleView === 'order' && (
                <OrderView
                  cards={orderCards}
                  focusWorkOrderNo={focusWorkOrderNo}
                  onTaskClick={openAdjustModal}
                />
              )}

              {scheduleView === 'worker' && (
                <WorkerView cards={workerCards} onTaskClick={openAdjustModal} />
              )}
            </>
          ) : (
            <div className={styles.empty_state}>
              <div className={styles.empty_emoji}>🧩</div>
              <h2>今日暂无待排产工单</h2>
              <p>当前所有生产工单可能已全部下发，或还没有达到可排产状态。</p>
              <div className={styles.empty_actions}>
                <Button variant="ghost" onClick={() => handleDateChange(getNextWorkday(new Date()))}>查看下一工作日</Button>
                <Button variant="primary" onClick={() => void handleRegenerate()}>重新拉取计划</Button>
              </div>
            </div>
          )}

          {canAdjust && (
            <StickyActionBar
              onReset={() => void handleRegenerate()}
              onConfirm={() => setConfirmModalOpen(true)}
              loading={confirmMutation.isPending}
            />
          )}
        </>
      )}

      {confirmModalOpen && (
        <ConfirmModal
          workerCount={confirmationStats.workerCount}
          taskCount={confirmationStats.taskCount}
          dateLabel={formatScheduleDate(selectedDate)}
          loading={confirmMutation.isPending}
          onClose={() => setConfirmModalOpen(false)}
          onConfirm={() => void handleConfirmSchedule()}
        />
      )}

      {selectedTask && (
        <TaskAdjustModal
          task={selectedTask}
          workers={workersQuery.data ?? []}
          workstations={workstationsQuery.data ?? []}
          form={adjustForm}
          loading={adjustMutation.isPending}
          canSave={hasAdjustChanges}
          onChange={setAdjustForm}
          onClose={closeAdjustModal}
          onSave={() => void handleAdjustSave()}
        />
      )}
    </div>
  );
}

function PageHeader(props: {
  selectedDate: string;
  onDateChange: (value: string) => void;
  onJumpToday: () => void;
  onJumpNextWorkday: () => void;
  onRefresh: () => void;
  onHistory: () => void;
}) {
  return (
    <div className={styles.page_header}>
      <div>
        <p className={styles.page_eyebrow}>PRODUCTION SCHEDULING</p>
        <h1 className={styles.page_title}>每日排产计划</h1>
        <p className={styles.page_subtitle}>基于现有生产工单、人员和工作站数据，生成主管可确认的正式排产。</p>
      </div>
      <div className={styles.page_actions}>
        <div className={styles.date_control}>
          <span>排产日期</span>
          <input type="date" value={props.selectedDate} onChange={(event) => props.onDateChange(event.target.value)} />
        </div>
        <Button variant="ghost" onClick={props.onJumpToday}>今天</Button>
        <Button variant="ghost" onClick={props.onJumpNextWorkday}>下一工作日</Button>
        <Button variant="ghost" onClick={props.onHistory}>查看历史</Button>
        <Button variant="ai" onClick={props.onRefresh}>重新生成</Button>
      </div>
    </div>
  );
}

function StatusBar(props: {
  dateLabel: string;
  totalOrders: number;
  stationCount: number;
  workerCount: number;
  confirmed: boolean;
  confirmedAt: string | null;
  focusWorkOrderNo: string;
}) {
  return (
    <div className={styles.status_bar}>
      <div className={styles.status_primary}>
        <span>状态：</span>
        <strong>{props.confirmed ? '✓ 已确认并下发今日计划' : '✓ AI 已生成今日计划'}</strong>
      </div>
      <div className={styles.status_divider} />
      <div className={styles.status_secondary}>
        {props.dateLabel} · 覆盖 <strong>{props.totalOrders}</strong> 个工单 · <strong>{props.stationCount}</strong> 个工作站 · <strong>{props.workerCount}</strong> 名工人
      </div>
      {props.focusWorkOrderNo ? (
        <Tag variant="info">当前聚焦 {props.focusWorkOrderNo}</Tag>
      ) : null}
      <Tag variant={props.confirmed ? 'success' : 'warning'}>
        {props.confirmed ? `已下发${props.confirmedAt ? ` · ${props.confirmedAt}` : ''}` : '待主管确认'}
      </Tag>
    </div>
  );
}

function StatsGrid(props: {
  loadRate: number;
  totalSteps: number;
  assignedStations: number;
  assignedWorkers: number;
  totalHours: string;
  unassignedCount: number;
}) {
  const cards = [
    { label: '产能负荷率', value: `${props.loadRate.toFixed(1)}%`, hint: '以 8 小时工时为基准', accent: props.loadRate >= 90 ? 'danger' : props.loadRate >= 75 ? 'warning' : 'normal' },
    { label: '排产工序', value: `${props.totalSteps}`, hint: '今日已纳入正式排产的工序数', accent: 'normal' },
    { label: '排产工位', value: `${props.assignedStations}`, hint: '已占用的工作站数量', accent: 'normal' },
    { label: '排产工人', value: `${props.assignedWorkers}`, hint: '已分配任务的工人数量', accent: 'normal' },
    { label: '总工时', value: `${props.totalHours}h`, hint: '按标准工时折算', accent: 'normal' },
    { label: '待补排资源', value: `${props.unassignedCount}`, hint: '需在确认下发前先补齐', accent: props.unassignedCount > 0 ? 'warning' : 'normal' },
  ] as const;

  return (
    <div className={styles.stats_grid}>
      {cards.map((card) => (
        <article
          key={card.label}
          className={`${styles.stat_card} ${card.accent === 'warning' ? styles['stat_card--warning'] : ''} ${card.accent === 'danger' ? styles['stat_card--danger'] : ''}`}
        >
          <span className={styles.stat_label}>{card.label}</span>
          <strong className={styles.stat_value}>{card.value}</strong>
          <span className={styles.stat_hint}>{card.hint}</span>
        </article>
      ))}
    </div>
  );
}

function RiskPanel({ risks, onDismiss }: { risks: ScheduleRisk[]; onDismiss: () => void }) {
  return (
    <div className={styles.risk_panel}>
      <div className={styles.risk_header}>
        <div>
          <p className={styles.risk_eyebrow}>AI RISK SIGNAL</p>
          <h2>今日排产风险提示</h2>
        </div>
        <button type="button" className={styles.risk_close} onClick={onDismiss}>收起</button>
      </div>
      <div className={styles.risk_list}>
        {risks.map((risk) => (
          <article key={`${risk.level}-${risk.title}`} className={`${styles.risk_item} ${styles[`risk_item--${risk.level}`]}`}>
            <Tag variant={getRiskTagVariant(risk.level)}>
              {risk.level === 'danger' ? '高优先级' : risk.level === 'warning' ? '需重点关注' : '建议跟进'}
            </Tag>
            <div>
              <h3>{risk.title}</h3>
              <p>{risk.description}</p>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function ViewToggle({ value, onChange }: { value: ScheduleView; onChange: (view: ScheduleView) => void }) {
  const options: Array<{ key: ScheduleView; label: string; hint: string }> = [
    { key: 'station', label: '工作站视图', hint: '看工位和时段占用' },
    { key: 'order', label: '工单视图', hint: '看工单拆解结果' },
    { key: 'worker', label: '人员视图', hint: '看工人今日任务' },
  ];

  return (
    <div className={styles.view_toggle}>
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          className={`${styles.view_toggle_item} ${value === option.key ? styles['view_toggle_item--active'] : ''}`}
          onClick={() => onChange(option.key)}
        >
          <span>{option.label}</span>
          <small>{option.hint}</small>
        </button>
      ))}
    </div>
  );
}

function StationView({ rows, onTaskClick }: { rows: StationRow[]; onTaskClick: (task: ScheduleItem) => void }) {
  return (
    <div className={styles.gantt_wrap}>
      <div className={styles.gantt_hint}>点击任务块可微调工人、工位或计划数量；确认后统一下发给工人。</div>
      <div className={styles.gantt_scroll}>
        <table className={styles.gantt_table}>
          <thead>
            <tr>
              <th>工作站</th>
              {TIME_SLOTS.map((slot) => (
                <th key={slot}>{slot}</th>
              ))}
              <th>备料状态</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.stationId}>
                <td className={styles.station_cell}>
                  <strong>{row.stationName}</strong>
                  <span>{row.workerInCharge}</span>
                  <small>{row.totalTasks} 项任务</small>
                </td>
                {TIME_SLOTS.map((slot) => {
                  const task = row.slots[slot];
                  return (
                    <td key={slot} className={styles.gantt_slot}>
                      {task ? <TaskBlock task={task} onClick={() => onTaskClick(task.source)} /> : <div className={styles.empty_slot}>空档</div>}
                    </td>
                  );
                })}
                <td className={styles.material_cell}>
                  <span className={`${styles.material_badge} ${styles[`material_badge--${row.materialStatus}`]}`}>{row.materialLabel}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={styles.legend}>
        <span><i className={`${styles.legend_block} ${styles['legend_block--normal']}`} /> 正常</span>
        <span><i className={`${styles.legend_block} ${styles['legend_block--warning']}`} /> 有风险</span>
        <span><i className={`${styles.legend_block} ${styles['legend_block--danger']}`} /> 待优先处理</span>
      </div>
    </div>
  );
}

function TaskBlock({ task, onClick }: { task: GanttTask; onClick: () => void }) {
  return (
    <button
      type="button"
      className={`${styles.task_block} ${styles[`task_block--${task.variant}`]}`}
      onClick={onClick}
    >
      <span className={styles.task_order}>{task.orderLabel}</span>
      <strong className={styles.task_operation}>{task.operation}</strong>
      <span className={styles.task_output}>{task.outputSkuName}</span>
      <span className={styles.task_worker}>{task.workerInfo}</span>
      <span className={styles.task_material}>{task.materialIcon}</span>
    </button>
  );
}

function OrderView(props: {
  cards: OrderCard[];
  focusWorkOrderNo: string;
  onTaskClick: (task: ScheduleItem) => void;
}) {
  return (
    <div className={styles.order_grid}>
      {props.cards.map((card) => (
        <article
          key={card.productionOrderId}
          className={`${styles.order_card} ${props.focusWorkOrderNo === card.workOrderNo ? styles['order_card--focused'] : ''}`}
        >
          <header className={styles.order_card_header}>
            <div>
              <strong>{card.workOrderNo}</strong>
              <p>{getOrderRiskLabel(card.risk)}</p>
            </div>
            <Tag variant={card.risk === 'danger' ? 'error' : card.risk === 'warning' ? 'warning' : 'success'}>
              {card.risk === 'danger' ? '存在缺口' : card.risk === 'warning' ? '工序集中' : '排产平稳'}
            </Tag>
          </header>
          <div className={styles.order_metrics}>
            <span>工序 {card.stepCount}</span>
            <span>工位 {card.stationCount}</span>
            <span>工人 {card.workerCount}</span>
            <span>工时 {card.totalHours}h</span>
            <span>计划量 {formatQty(card.totalQty)}套</span>
          </div>
          <div className={styles.order_outputs}>
            {card.outputSkuNames.slice(0, 4).map((outputSkuName) => (
              <span key={outputSkuName} className={styles.order_output_chip}>{outputSkuName}</span>
            ))}
          </div>
          <div className={styles.order_lines}>
            {card.lines.map((line) => (
              <button
                key={line.scheduleId}
                type="button"
                className={styles.order_line}
                onClick={() => props.onTaskClick(line.source)}
              >
                <div>
                  <strong>{line.stepName}</strong>
                  <span>{line.outputSkuName} · {line.workstationName} · {line.workerName}</span>
                </div>
                <div className={styles.order_line_meta}>
                  <span>{formatQty(line.plannedQty)}套</span>
                  <span>{formatHours(line.estimatedHours)}</span>
                </div>
              </button>
            ))}
          </div>
        </article>
      ))}
    </div>
  );
}

function WorkerView({ cards, onTaskClick }: { cards: WorkerCard[]; onTaskClick: (task: ScheduleItem) => void }) {
  return (
    <div className={styles.worker_section}>
      <div className={styles.worker_section_head}>
        <h2>工人任务分配</h2>
        <p>主管可快速核对每位工人的今日任务负荷，并对异常分配做微调。</p>
      </div>
      <div className={styles.worker_grid}>
        {cards.map((card) => (
          <article key={card.workerId} className={styles.worker_card}>
            <header className={styles.worker_card_header}>
              <div className={styles.worker_avatar}>{card.initial}</div>
              <div>
                <strong>{card.name}</strong>
                <p>{card.roleLine}</p>
              </div>
              <Tag variant="info">{card.totalHours}h</Tag>
            </header>
            <div className={styles.worker_tasks}>
              {card.tasks.map((task) => (
                <button
                  key={task.scheduleId}
                  type="button"
                  className={styles.worker_task}
                  onClick={() => onTaskClick(task.source)}
                >
                  <div>
                    <strong>{task.workOrderNo}</strong>
                    <span>{task.stepName} · {task.outputSkuName}</span>
                    <span>{task.stationName}</span>
                  </div>
                  <div className={styles.worker_task_meta}>
                    <span>{task.time}</span>
                    <span>{formatQty(task.plannedQty)}套</span>
                  </div>
                </button>
              ))}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function StickyActionBar(props: { onReset: () => void; onConfirm: () => void; loading: boolean }) {
  return (
    <div className={styles.action_bar}>
      <div>
        <strong>今日计划尚未正式下发</strong>
        <p>确认后将创建工人任务并同步更新工单排产状态。</p>
      </div>
      <div className={styles.action_buttons}>
        <Button variant="ghost" onClick={props.onReset}>恢复 AI 初始方案</Button>
        <Button variant="success" loading={props.loading} onClick={props.onConfirm}>确认并下发给工人</Button>
      </div>
    </div>
  );
}

function ConfirmModal(props: {
  workerCount: number;
  taskCount: number;
  dateLabel: string;
  loading: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className={styles.modal_overlay} onClick={props.onClose}>
      <div className={styles.modal_panel} onClick={(event) => event.stopPropagation()}>
        <div className={styles.modal_header}>
          <div>
            <strong>确认并下发排产计划</strong>
            <p>{props.dateLabel}</p>
          </div>
          <button type="button" className={styles.modal_close} onClick={props.onClose}>×</button>
        </div>
        <div className={styles.modal_summary}>
          <div>
            <span>涉及工人</span>
            <strong>{props.workerCount}</strong>
          </div>
          <div>
            <span>任务条数</span>
            <strong>{props.taskCount}</strong>
          </div>
        </div>
        <p className={styles.modal_text}>确认后将把当前排产方案写入正式任务，并同步到工人端。已下发计划不会再被重新生成覆盖。</p>
        <div className={styles.modal_actions}>
          <Button variant="ghost" onClick={props.onClose}>取消</Button>
          <Button variant="success" loading={props.loading} onClick={props.onConfirm}>确认下发</Button>
        </div>
      </div>
    </div>
  );
}

function TaskAdjustModal(props: {
  task: ScheduleItem;
  workers: ProductionWorkerOption[];
  workstations: WorkstationOption[];
  form: { workerId: string; workstationId: string; plannedQty: string };
  loading: boolean;
  canSave: boolean;
  onChange: Dispatch<SetStateAction<{ workerId: string; workstationId: string; plannedQty: string }>>;
  onClose: () => void;
  onSave: () => void;
}) {
  return (
    <div className={styles.modal_overlay} onClick={props.onClose}>
      <div className={`${styles.modal_panel} ${styles['modal_panel--wide']}`} onClick={(event) => event.stopPropagation()}>
        <div className={styles.modal_header}>
          <div>
            <strong>调整排产任务</strong>
            <p>{props.task.workOrderNo} · {props.task.stepName}</p>
          </div>
          <button type="button" className={styles.modal_close} onClick={props.onClose}>×</button>
        </div>

        <div className={styles.adjust_grid}>
          <label className={styles.form_field}>
            <span>工单号</span>
            <input value={props.task.workOrderNo} disabled />
          </label>
          <label className={styles.form_field}>
            <span>工序</span>
            <input value={props.task.stepName} disabled />
          </label>
          <label className={styles.form_field}>
            <span>分配工人</span>
            <select
              value={props.form.workerId}
              onChange={(event) => props.onChange((current) => ({ ...current, workerId: event.target.value }))}
            >
              <option value="">待分配</option>
              {props.workers.map((worker) => (
                <option key={worker.id} value={worker.id}>{worker.name}</option>
              ))}
            </select>
          </label>
          <label className={styles.form_field}>
            <span>工作站</span>
            <select
              value={props.form.workstationId}
              onChange={(event) => props.onChange((current) => ({ ...current, workstationId: event.target.value }))}
            >
              <option value="">待分配</option>
              {props.workstations.map((station) => (
                <option key={station.id} value={station.id}>{station.name} / 产能 {station.capacity}</option>
              ))}
            </select>
          </label>
          <label className={styles.form_field}>
            <span>计划数量</span>
            <input
              value={props.form.plannedQty}
              onChange={(event) => props.onChange((current) => ({ ...current, plannedQty: event.target.value }))}
            />
          </label>
          <div className={styles.adjust_note}>
            <span>当前工时</span>
            <strong>{formatHours(props.task.estimatedHours)}</strong>
            <small>当前调整直接写入排产计划，确认下发前仍可继续修改。</small>
          </div>
        </div>

        <div className={styles.modal_actions}>
          <Button variant="ghost" onClick={props.onClose}>取消</Button>
          <Button variant="primary" loading={props.loading} disabled={!props.canSave} onClick={props.onSave}>保存调整</Button>
        </div>
      </div>
    </div>
  );
}
