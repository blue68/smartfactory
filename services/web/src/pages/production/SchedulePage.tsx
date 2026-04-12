import { startTransition, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { ACTION_CODES } from '@/constants/accessControl';
import { usePermission } from '@/hooks/usePermission';
import { useAppStore } from '@/stores/appStore';
import {
  productionApi,
  productionKeys,
  useAdjustSchedule,
  useConfirmSchedule,
  useProductionWorkCalendar,
  useProductionWorkers,
  useProductionWorkstations,
  useSchedule,
  useScheduleHistory,
  useUpdateWorkCalendarDay,
} from '@/api/production';
import type {
  ProductionWorkerOption,
  ProductionWorkCalendarDay,
  ScheduleHistoryEntry,
  WorkTimeRange,
  WorkstationOption,
} from '@/api/production';
import { ApiCode, ApiError } from '@/types/api';
import type { ScheduleItem, ScheduleResult } from '@/types/models';
import Button from '@/components/common/Button';
import Modal from '@/components/common/Modal';
import Tag from '@/components/common/Tag';
import styles from './SchedulePage.module.css';

type ScheduleView = 'station' | 'order' | 'worker';
type TaskBlockVariant = 'normal' | 'warning' | 'danger';
type MaterialStatus = 'ok' | 'warn' | 'err';
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
  slots: Partial<Record<string, GanttTask>>;
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
const DEFAULT_NORMAL_RANGES: WorkTimeRange[] = [
  { startTime: '08:00', endTime: '12:00' },
  { startTime: '13:30', endTime: '17:30' },
];

interface CalendarFormState {
  isWorkday: boolean;
  holidayName: string;
  normalRanges: WorkTimeRange[];
  overtimeRanges: WorkTimeRange[];
}

interface ScheduleRisk {
  level: RiskLevel;
  title: string;
  description: string;
}

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

function makeDefaultCalendarForm(isWorkday = true): CalendarFormState {
  return {
    isWorkday,
    holidayName: '',
    normalRanges: isWorkday ? DEFAULT_NORMAL_RANGES.map((range) => ({ ...range })) : [],
    overtimeRanges: [],
  };
}

function formatScheduleDate(date: string): string {
  const raw = new Date(`${date}T00:00:00`);
  const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][raw.getDay()];
  return `${date} ${week}`;
}

function formatScheduleDateTime(value: string | null): string {
  if (!value) return '—';
  return value.replace('T', ' ').slice(0, 16);
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

function formatRangeLabel(range: WorkTimeRange): string {
  return `${range.startTime} — ${range.endTime}`;
}

function buildTimeSlotsFromCalendar(day?: ProductionWorkCalendarDay): string[] {
  if (day && !day.isWorkday) {
    return [];
  }
  const source = day?.isWorkday
    ? [...(day.normalRanges ?? []), ...(day.overtimeRanges ?? [])]
    : [];
  const normalized = source.length > 0 ? source : DEFAULT_NORMAL_RANGES;
  return normalized.map(formatRangeLabel);
}

function buildFallbackCalendarDay(date: string): ProductionWorkCalendarDay {
  return {
    date,
    isWorkday: true,
    isHoliday: false,
    normalRanges: DEFAULT_NORMAL_RANGES.map((range) => ({ ...range })),
    overtimeRanges: [],
    normalHours: '8.0',
    overtimeHours: '0.0',
    totalHours: '8.0',
  };
}

function getMonthKey(date: string): { year: number; month: number } {
  const [year, month] = date.split('-').map(Number);
  return { year, month };
}

function getNextWorkdayFromCalendar(date: string, entries: ProductionWorkCalendarDay[] | undefined): string {
  if (!entries || entries.length === 0) {
    return getNextWorkday(new Date(`${date}T00:00:00`));
  }
  const sorted = [...entries].sort((left, right) => left.date.localeCompare(right.date));
  const next = sorted.find((entry) => entry.date > date && entry.isWorkday);
  return next?.date ?? getNextWorkday(new Date(`${date}T00:00:00`));
}

function validateCalendarRanges(form: CalendarFormState): string | null {
  const validateGroup = (ranges: WorkTimeRange[], label: string): string | null => {
    for (let index = 0; index < ranges.length; index += 1) {
      const range = ranges[index];
      if (!/^\d{2}:\d{2}$/.test(range.startTime) || !/^\d{2}:\d{2}$/.test(range.endTime)) {
        return `${label}时间段格式必须为 HH:mm`;
      }
      if (range.endTime <= range.startTime) {
        return `${label}时间段结束时间必须晚于开始时间`;
      }
      if (index > 0 && range.startTime < ranges[index - 1].endTime) {
        return `${label}时间段不能重叠`;
      }
    }
    return null;
  };

  if (!form.isWorkday) return null;
  if (form.normalRanges.length === 0) {
    return '工作日必须至少配置一个正常班次时间段';
  }
  return validateGroup(form.normalRanges, '正常班次') ?? validateGroup(form.overtimeRanges, '加班');
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

function buildStationRows(schedules: ScheduleItem[], loadRate: number, timeSlots: string[]): StationRow[] {
  const groups = new Map<string, ScheduleItem[]>();

  schedules.forEach((item) => {
    const key = item.workstationId ? String(item.workstationId) : `pending-${item.processStepId}`;
    const current = groups.get(key) ?? [];
    current.push(item);
    groups.set(key, current);
  });

  return [...groups.entries()].map(([stationId, items]) => {
    const slots: Partial<Record<string, GanttTask>> = {};
    items.forEach((item, index) => {
      if (index >= timeSlots.length) return;
      const slot = timeSlots[index];
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

function buildWorkerCards(schedules: ScheduleItem[], timeSlots: string[]): WorkerCard[] {
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
        tasks: group.tasks.slice(0, timeSlots.length).map((item, index) => ({
          source: item,
          scheduleId: item.scheduleId,
          workOrderNo: item.workOrderNo,
          stepName: item.stepName,
          outputSkuName: item.outputSkuName ?? '未配置产出',
          stationName: item.workstationName ?? '待分配工位',
          plannedQty: item.plannedQty,
          estimatedHours: item.estimatedHours,
          time: timeSlots[index] ?? timeSlots[timeSlots.length - 1] ?? '待排时段',
        })),
      };
    })
    .sort((left, right) => parseNumeric(right.totalHours) - parseNumeric(left.totalHours));
}

function buildOrderCards(schedules: ScheduleItem[], timeSlots: string[]): OrderCard[] {
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
      const hasCrowded = timeSlots.length > 0 && items.length >= timeSlots.length;
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

function deriveRisks(schedules: ScheduleItem[], loadRate: number, timeSlots: string[]): ScheduleRisk[] {
  const risks: ScheduleRisk[] = [];
  const unassigned = schedules.filter((item) => !item.workerId || !item.workstationId).length;
  const crowded = new Set(
    timeSlots.length > 0
      ? schedules.filter((_, index) => index >= timeSlots.length * 2).map((item) => item.workstationName ?? '待分配工位')
      : [],
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
  const { can } = usePermission();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const today = formatInputDate(new Date());
  const initialDate = isValidDateString(searchParams.get('date')) ? searchParams.get('date')! : today;
  const focusWorkOrderNo = searchParams.get('workOrderNo') ?? searchParams.get('workOrderId') ?? '';

  const [selectedDate, setSelectedDate] = useState(initialDate);
  const [scheduleView, setScheduleView] = useState<ScheduleView>(focusWorkOrderNo ? 'order' : 'station');
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<ScheduleItem | null>(null);
  const [calendarModalOpen, setCalendarModalOpen] = useState(false);
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
  const [calendarForm, setCalendarForm] = useState<CalendarFormState>(makeDefaultCalendarForm());

  const canManageCalendar = can(ACTION_CODES.PRODUCTION_CALENDAR_MANAGE);
  const { year: calendarYear, month: calendarMonth } = getMonthKey(selectedDate);

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
  const scheduleHistoryQuery = useScheduleHistory(14, historyOpen);
  const confirmMutation = useConfirmSchedule();
  const adjustMutation = useAdjustSchedule();
  const calendarQuery = useProductionWorkCalendar(calendarYear, calendarMonth);
  const updateCalendarMutation = useUpdateWorkCalendarDay();
  const workersQuery = useProductionWorkers();
  const workstationsQuery = useProductionWorkstations();

  const schedules = scheduleQuery.data?.schedules ?? EMPTY_SCHEDULES;
  const loadRate = parseLoadRate(scheduleQuery.data?.summary.capacityLoadRate);
  const selectedCalendarDay = useMemo(
    () => calendarQuery.data?.find((entry) => entry.date === selectedDate) ?? buildFallbackCalendarDay(selectedDate),
    [calendarQuery.data, selectedDate],
  );
  const timeSlots = useMemo(
    () => buildTimeSlotsFromCalendar(selectedCalendarDay),
    [selectedCalendarDay],
  );

  useEffect(() => {
    setCalendarForm({
      isWorkday: selectedCalendarDay.isWorkday,
      holidayName: selectedCalendarDay.holidayName ?? '',
      normalRanges: selectedCalendarDay.normalRanges.map((range) => ({ ...range })),
      overtimeRanges: selectedCalendarDay.overtimeRanges.map((range) => ({ ...range })),
    });
  }, [selectedCalendarDay]);

  const filteredSchedules = useMemo(() => {
    if (!focusWorkOrderNo) return schedules;
    return schedules.filter((item) => item.workOrderNo === focusWorkOrderNo);
  }, [focusWorkOrderNo, schedules]);

  const stationRows = useMemo(
    () => buildStationRows(filteredSchedules, loadRate, timeSlots),
    [filteredSchedules, loadRate, timeSlots],
  );
  const workerCards = useMemo(() => buildWorkerCards(filteredSchedules, timeSlots), [filteredSchedules, timeSlots]);
  const orderCards = useMemo(() => buildOrderCards(filteredSchedules, timeSlots), [filteredSchedules, timeSlots]);
  const risks = useMemo(() => deriveRisks(filteredSchedules, loadRate, timeSlots), [filteredSchedules, loadRate, timeSlots]);

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

  const updateCalendarRange = (
    key: 'normalRanges' | 'overtimeRanges',
    index: number,
    field: keyof WorkTimeRange,
    value: string,
  ) => {
    setCalendarForm((current) => ({
      ...current,
      [key]: current[key].map((range, currentIndex) => (
        currentIndex === index ? { ...range, [field]: value } : range
      )),
    }));
  };

  const addCalendarRange = (key: 'normalRanges' | 'overtimeRanges') => {
    setCalendarForm((current) => ({
      ...current,
      [key]: [...current[key], { startTime: '18:30', endTime: '20:30' }],
    }));
  };

  const removeCalendarRange = (key: 'normalRanges' | 'overtimeRanges', index: number) => {
    setCalendarForm((current) => ({
      ...current,
      [key]: current[key].filter((_, currentIndex) => currentIndex !== index),
    }));
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

  const handleSaveCalendar = async () => {
    const validationMessage = validateCalendarRanges(calendarForm);
    if (validationMessage) {
      showToast({ type: 'error', message: validationMessage });
      return;
    }
    try {
      await updateCalendarMutation.mutateAsync({
        date: selectedDate,
        isWorkday: calendarForm.isWorkday,
        name: calendarForm.holidayName || undefined,
        normalRanges: calendarForm.isWorkday ? calendarForm.normalRanges : [],
        overtimeRanges: calendarForm.isWorkday ? calendarForm.overtimeRanges : [],
      });
      setCalendarModalOpen(false);
      showToast({ type: 'success', message: '生产日历已更新' });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: productionKeys.workCalendar(calendarYear, calendarMonth) }),
        queryClient.invalidateQueries({ queryKey: productionKeys.schedule(selectedDate) }),
      ]);
    } catch (error) {
      showToast({
        type: 'error',
        message: error instanceof ApiError ? error.message : '生产日历更新失败，请稍后重试',
      });
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
          onJumpNextWorkday={() => handleDateChange(getNextWorkdayFromCalendar(selectedDate, calendarQuery.data))}
          onRefresh={() => setManualGenerate(true)}
          onHistory={() => setHistoryOpen(true)}
          canManageCalendar={canManageCalendar}
          onOpenCalendar={() => setCalendarModalOpen(true)}
        />
        <div className={styles.pre_generate_state}>
          <div className={styles.empty_emoji}>🗓</div>
          <h2>今日排产计划将于 07:30 自动生成</h2>
          <p>当前还未到自动生成时段。如需提前查看，可手动触发一次今日排产计算。</p>
          <div className={styles.empty_actions}>
            <Button variant="ghost" onClick={() => handleDateChange(getNextWorkdayFromCalendar(selectedDate, calendarQuery.data))}>查看下一工作日</Button>
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
        onJumpNextWorkday={() => handleDateChange(getNextWorkdayFromCalendar(selectedDate, calendarQuery.data))}
        onRefresh={() => void handleRegenerate()}
        onHistory={() => setHistoryOpen(true)}
        canManageCalendar={canManageCalendar}
        onOpenCalendar={() => setCalendarModalOpen(true)}
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
            workdayHours={selectedCalendarDay.totalHours}
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
                <StationView rows={stationRows} timeSlots={timeSlots} onTaskClick={openAdjustModal} />
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
                <Button variant="ghost" onClick={() => handleDateChange(getNextWorkdayFromCalendar(selectedDate, calendarQuery.data))}>查看下一工作日</Button>
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

      <ScheduleHistoryModal
        open={historyOpen}
        currentDate={selectedDate}
        entries={scheduleHistoryQuery.data ?? []}
        loading={scheduleHistoryQuery.isLoading}
        error={scheduleHistoryQuery.isError}
        onClose={() => setHistoryOpen(false)}
        onSelect={(date) => {
          setHistoryOpen(false);
          handleDateChange(date);
        }}
      />

      <WorkCalendarModal
        open={calendarModalOpen}
        date={selectedDate}
        form={calendarForm}
        loading={updateCalendarMutation.isPending}
        canEdit={canManageCalendar}
        onChange={setCalendarForm}
        onRangeChange={updateCalendarRange}
        onAddRange={addCalendarRange}
        onRemoveRange={removeCalendarRange}
        onClose={() => setCalendarModalOpen(false)}
        onSave={() => void handleSaveCalendar()}
      />

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

function ScheduleHistoryModal(props: {
  open: boolean;
  currentDate: string;
  entries: ScheduleHistoryEntry[];
  loading: boolean;
  error: boolean;
  onClose: () => void;
  onSelect: (date: string) => void;
}) {
  return (
    <Modal
      open={props.open}
      onClose={props.onClose}
      title="历史排产记录"
      size="lg"
      hideFooter
    >
      <div className={styles.history_modal}>
        <p className={styles.history_hint}>
          选择任一历史日期后，页面会切换到该日排产结果，支持继续查看工位、工单和工人视图。
        </p>

        {props.loading ? (
          <div className={styles.history_empty}>正在加载历史排产记录...</div>
        ) : props.error ? (
          <div className={styles.history_empty}>历史排产记录加载失败，请稍后重试。</div>
        ) : props.entries.length === 0 ? (
          <div className={styles.history_empty}>暂无可查看的历史排产记录。</div>
        ) : (
          <div className={styles.history_list}>
            {props.entries.map((entry) => (
              <button
                key={entry.date}
                type="button"
                className={`${styles.history_item} ${entry.date === props.currentDate ? styles.history_item_active : ''}`}
                onClick={() => props.onSelect(entry.date)}
              >
                <div className={styles.history_item_top}>
                  <div className={styles.history_heading}>
                    <strong>{formatScheduleDate(entry.date)}</strong>
                    <span className={styles.history_meta}>生成于 {formatScheduleDateTime(entry.generatedAt)}</span>
                  </div>
                  <Tag variant={entry.confirmed ? 'success' : 'warning'}>
                    {entry.confirmed ? '已确认下发' : '待主管确认'}
                  </Tag>
                </div>
                <div className={styles.history_stats}>
                  <span>{entry.orderCount} 个工单</span>
                  <span>{entry.taskCount} 道工序</span>
                  <span>{entry.stationCount} 个工位</span>
                  <span>{entry.workerCount} 名工人</span>
                  <span>{entry.totalHours}h</span>
                </div>
                <div className={styles.history_footer}>
                  <span>确认时间：{formatScheduleDateTime(entry.confirmedAt)}</span>
                  <span>点击查看完整排产</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

function PageHeader(props: {
  selectedDate: string;
  onDateChange: (value: string) => void;
  onJumpToday: () => void;
  onJumpNextWorkday: () => void;
  onRefresh: () => void;
  onHistory: () => void;
  canManageCalendar: boolean;
  onOpenCalendar: () => void;
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
        {props.canManageCalendar && <Button variant="ghost" onClick={props.onOpenCalendar}>生产日历</Button>}
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
  workdayHours: string;
}) {
  const cards = [
    { label: '产能负荷率', value: `${props.loadRate.toFixed(1)}%`, hint: `以当日 ${props.workdayHours} 小时工时为基准`, accent: props.loadRate >= 90 ? 'danger' : props.loadRate >= 75 ? 'warning' : 'normal' },
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

function StationView(props: { rows: StationRow[]; timeSlots: string[]; onTaskClick: (task: ScheduleItem) => void }) {
  return (
    <div className={styles.gantt_wrap}>
      <div className={styles.gantt_hint}>点击任务块可微调工人、工位或计划数量；确认后统一下发给工人。</div>
      <div className={styles.gantt_scroll}>
        <table className={styles.gantt_table}>
          <thead>
            <tr>
              <th>工作站</th>
              {props.timeSlots.map((slot) => (
                <th key={slot}>{slot}</th>
              ))}
              <th>备料状态</th>
            </tr>
          </thead>
          <tbody>
            {props.rows.map((row) => (
              <tr key={row.stationId}>
                <td className={styles.station_cell}>
                  <strong>{row.stationName}</strong>
                  <span>{row.workerInCharge}</span>
                  <small>{row.totalTasks} 项任务</small>
                </td>
                {props.timeSlots.map((slot) => {
                  const task = row.slots[slot];
                  return (
                    <td key={slot} className={styles.gantt_slot}>
                      {task ? <TaskBlock task={task} onClick={() => props.onTaskClick(task.source)} /> : <div className={styles.empty_slot}>空档</div>}
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

function WorkCalendarModal(props: {
  open: boolean;
  date: string;
  form: CalendarFormState;
  loading: boolean;
  canEdit: boolean;
  onChange: Dispatch<SetStateAction<CalendarFormState>>;
  onRangeChange: (key: 'normalRanges' | 'overtimeRanges', index: number, field: keyof WorkTimeRange, value: string) => void;
  onAddRange: (key: 'normalRanges' | 'overtimeRanges') => void;
  onRemoveRange: (key: 'normalRanges' | 'overtimeRanges', index: number) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  if (!props.open) return null;

  return (
    <div className={styles.modal_overlay} onClick={props.onClose}>
      <div className={`${styles.modal_panel} ${styles['modal_panel--wide']}`} onClick={(event) => event.stopPropagation()}>
        <div className={styles.modal_header}>
          <div>
            <strong>生产日历配置</strong>
            <p>{formatScheduleDate(props.date)}</p>
          </div>
          <button type="button" className={styles.modal_close} onClick={props.onClose}>×</button>
        </div>

        <div className={styles.calendar_summary}>
          <article>
            <span>工作日状态</span>
            <strong>{props.form.isWorkday ? '工作日' : '停工/放假'}</strong>
          </article>
          <article>
            <span>正常班次</span>
            <strong>{props.form.normalRanges.length} 段</strong>
          </article>
          <article>
            <span>加班时段</span>
            <strong>{props.form.overtimeRanges.length} 段</strong>
          </article>
        </div>

        <div className={styles.calendar_form}>
          <label className={styles.calendar_toggle}>
            <input
              type="checkbox"
              checked={props.form.isWorkday}
              disabled={!props.canEdit}
              onChange={(event) => props.onChange((current) => ({
                ...current,
                isWorkday: event.target.checked,
                normalRanges: event.target.checked && current.normalRanges.length === 0
                  ? DEFAULT_NORMAL_RANGES.map((range) => ({ ...range }))
                  : current.normalRanges,
              }))}
            />
            <div>
              <strong>当天为工作日</strong>
              <span>关闭后当天不参与排产，工作时段将清空。</span>
            </div>
          </label>

          <label className={styles.form_field}>
            <span>备注名称</span>
            <input
              value={props.form.holidayName}
              disabled={!props.canEdit}
              placeholder={props.form.isWorkday ? '如：调休上班 / 加班日' : '如：清明节 / 厂休'}
              onChange={(event) => props.onChange((current) => ({ ...current, holidayName: event.target.value }))}
            />
          </label>

          <CalendarRangeEditor
            title="正常班次"
            description="用于排产基准工时，例如上午和下午两个班段。"
            ranges={props.form.normalRanges}
            disabled={!props.canEdit || !props.form.isWorkday}
            onAdd={() => props.onAddRange('normalRanges')}
            onChange={(index, field, value) => props.onRangeChange('normalRanges', index, field, value)}
            onRemove={(index) => props.onRemoveRange('normalRanges', index)}
          />

          <CalendarRangeEditor
            title="加班时段"
            description="当天有额外加班时补充配置，排产容量会同步增加。"
            ranges={props.form.overtimeRanges}
            disabled={!props.canEdit || !props.form.isWorkday}
            onAdd={() => props.onAddRange('overtimeRanges')}
            onChange={(index, field, value) => props.onRangeChange('overtimeRanges', index, field, value)}
            onRemove={(index) => props.onRemoveRange('overtimeRanges', index)}
          />
        </div>

        <div className={styles.modal_actions}>
          <Button variant="ghost" onClick={props.onClose}>关闭</Button>
          {props.canEdit && (
            <Button variant="primary" loading={props.loading} onClick={props.onSave}>保存配置</Button>
          )}
        </div>
      </div>
    </div>
  );
}

function CalendarRangeEditor(props: {
  title: string;
  description: string;
  ranges: WorkTimeRange[];
  disabled: boolean;
  onAdd: () => void;
  onChange: (index: number, field: keyof WorkTimeRange, value: string) => void;
  onRemove: (index: number) => void;
}) {
  return (
    <section className={styles.calendar_section}>
      <div className={styles.calendar_section_head}>
        <div>
          <strong>{props.title}</strong>
          <p>{props.description}</p>
        </div>
        <Button variant="ghost" disabled={props.disabled} onClick={props.onAdd}>新增时段</Button>
      </div>
      {props.ranges.length === 0 ? (
        <div className={styles.calendar_empty}>未配置时段</div>
      ) : (
        <div className={styles.calendar_ranges}>
          {props.ranges.map((range, index) => (
            <div key={`${props.title}-${index}`} className={styles.calendar_range_row}>
              <label className={styles.form_field}>
                <span>开始</span>
                <input
                  type="time"
                  value={range.startTime}
                  disabled={props.disabled}
                  onChange={(event) => props.onChange(index, 'startTime', event.target.value)}
                />
              </label>
              <label className={styles.form_field}>
                <span>结束</span>
                <input
                  type="time"
                  value={range.endTime}
                  disabled={props.disabled}
                  onChange={(event) => props.onChange(index, 'endTime', event.target.value)}
                />
              </label>
              <Button variant="ghost" disabled={props.disabled} onClick={() => props.onRemove(index)}>删除</Button>
            </div>
          ))}
        </div>
      )}
    </section>
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
