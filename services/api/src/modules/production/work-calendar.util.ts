import Decimal from 'decimal.js';
import { AppDataSource } from '../../config/database';

export interface WorkTimeRange {
  startTime: string;
  endTime: string;
}

export interface WorkCalendarDayConfig {
  date: string;
  isWorkday: boolean;
  isHoliday: boolean;
  holidayName?: string;
  normalRanges: WorkTimeRange[];
  overtimeRanges: WorkTimeRange[];
  normalMinutes: number;
  overtimeMinutes: number;
  totalMinutes: number;
  normalHours: string;
  overtimeHours: string;
  totalHours: string;
}

interface WorkCalendarOverride {
  isWorkday: boolean;
  holidayName?: string;
  normalRanges?: WorkTimeRange[];
  overtimeRanges?: WorkTimeRange[];
}

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const DEFAULT_NORMAL_RANGES: WorkTimeRange[] = [
  { startTime: '08:00', endTime: '12:00' },
  { startTime: '13:30', endTime: '17:30' },
];

export const DEFAULT_OVERTIME_RANGES: WorkTimeRange[] = [];

function cloneRanges(ranges: WorkTimeRange[]): WorkTimeRange[] {
  return ranges.map((range) => ({ ...range }));
}

export function isValidTimeValue(value: string): boolean {
  return TIME_RE.test(value);
}

export function toMinutes(value: string): number {
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}

export function normalizeRanges(ranges: WorkTimeRange[]): WorkTimeRange[] {
  return [...ranges]
    .map((range) => ({
      startTime: range.startTime.trim(),
      endTime: range.endTime.trim(),
    }))
    .sort((left, right) => toMinutes(left.startTime) - toMinutes(right.startTime));
}

export function calculateRangeMinutes(ranges: WorkTimeRange[]): number {
  return ranges.reduce(
    (total, range) => total + Math.max(0, toMinutes(range.endTime) - toMinutes(range.startTime)),
    0,
  );
}

function formatHours(minutes: number): string {
  return new Decimal(minutes).div(60).toFixed(1);
}

function parseStoredRanges(raw: unknown): WorkTimeRange[] | undefined {
  if (raw === null || raw === undefined || raw === '') return undefined;
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return undefined;
    }
  }
  if (!Array.isArray(parsed)) return undefined;
  const ranges = parsed
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .map((item) => ({
      startTime: String(item.startTime ?? ''),
      endTime: String(item.endTime ?? ''),
    }))
    .filter((item) =>
      isValidTimeValue(item.startTime)
      && isValidTimeValue(item.endTime)
      && toMinutes(item.endTime) > toMinutes(item.startTime),
    );
  return normalizeRanges(ranges);
}

export async function loadWorkCalendarOverrides(
  tenantId: number,
  startDate: string,
  endDate: string,
): Promise<Map<string, WorkCalendarOverride>> {
  type ModernRow = {
    date: string;
    is_workday: number;
    holiday_name: string | null;
    normal_ranges: string | null;
    overtime_ranges: string | null;
  };
  type LegacyRow = {
    date: string;
    is_workday: number;
    holiday_name: string | null;
  };

  let rows: Array<ModernRow | LegacyRow> = [];
  try {
    rows = await AppDataSource.query<Array<ModernRow>>(
      `SELECT DATE_FORMAT(date, '%Y-%m-%d') AS date,
              is_workday,
              holiday_name,
              normal_ranges,
              overtime_ranges
       FROM work_calendar
       WHERE tenant_id = ? AND date BETWEEN ? AND ?`,
      [tenantId, startDate, endDate],
    );
  } catch (error) {
    const message = String((error as { message?: string })?.message ?? '').toLowerCase();
    if (!message.includes('unknown column') && !message.includes('unknown table') && !message.includes('doesn\'t exist')) {
      throw error;
    }
    try {
      rows = await AppDataSource.query<Array<LegacyRow>>(
        `SELECT DATE_FORMAT(date, '%Y-%m-%d') AS date,
                is_workday,
                holiday_name
         FROM work_calendar
         WHERE tenant_id = ? AND date BETWEEN ? AND ?`,
        [tenantId, startDate, endDate],
      );
    } catch {
      return new Map();
    }
  }

  const map = new Map<string, WorkCalendarOverride>();
  for (const row of rows) {
    const modernRow = row as ModernRow;
    map.set(row.date, {
      isWorkday: row.is_workday === 1,
      holidayName: row.holiday_name ?? undefined,
      normalRanges: parseStoredRanges(modernRow.normal_ranges),
      overtimeRanges: parseStoredRanges(modernRow.overtime_ranges),
    });
  }
  return map;
}

export function resolveWorkCalendarDay(date: string, override?: WorkCalendarOverride): WorkCalendarDayConfig {
  const rawDate = new Date(`${date}T00:00:00Z`);
  const dayOfWeek = rawDate.getUTCDay();
  const defaultIsWorkday = dayOfWeek !== 0 && dayOfWeek !== 6;
  const isWorkday = override?.isWorkday ?? defaultIsWorkday;
  const normalRanges = isWorkday
    ? cloneRanges(override?.normalRanges && override.normalRanges.length > 0 ? override.normalRanges : DEFAULT_NORMAL_RANGES)
    : [];
  const overtimeRanges = isWorkday
    ? cloneRanges(override?.overtimeRanges ?? DEFAULT_OVERTIME_RANGES)
    : [];
  const normalMinutes = calculateRangeMinutes(normalRanges);
  const overtimeMinutes = calculateRangeMinutes(overtimeRanges);
  const totalMinutes = normalMinutes + overtimeMinutes;

  return {
    date,
    isWorkday,
    isHoliday: !isWorkday,
    holidayName: override?.holidayName,
    normalRanges,
    overtimeRanges,
    normalMinutes,
    overtimeMinutes,
    totalMinutes,
    normalHours: formatHours(normalMinutes),
    overtimeHours: formatHours(overtimeMinutes),
    totalHours: formatHours(totalMinutes),
  };
}

export async function getResolvedWorkCalendarDay(tenantId: number, date: string): Promise<WorkCalendarDayConfig> {
  const overrides = await loadWorkCalendarOverrides(tenantId, date, date);
  return resolveWorkCalendarDay(date, overrides.get(date));
}

export async function sumWorkCalendarHours(
  tenantId: number,
  startDate: string,
  endDate: string,
): Promise<Decimal> {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);

  if (start > end) return new Decimal(0);

  const overrides = await loadWorkCalendarOverrides(tenantId, startDate, endDate);
  const cursor = new Date(start);
  let totalMinutes = 0;

  while (cursor <= end) {
    const date = cursor.toISOString().slice(0, 10);
    const config = resolveWorkCalendarDay(date, overrides.get(date));
    if (config.isWorkday) {
      totalMinutes += config.totalMinutes;
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return new Decimal(totalMinutes).div(60);
}

export async function findNextWorkday(tenantId: number, fromDate: string): Promise<string> {
  const start = new Date(`${fromDate}T00:00:00Z`);
  const queryEnd = new Date(start);
  queryEnd.setUTCDate(queryEnd.getUTCDate() + 60);
  const endDate = queryEnd.toISOString().slice(0, 10);
  const overrides = await loadWorkCalendarOverrides(tenantId, fromDate, endDate);
  const cursor = new Date(start);

  for (let i = 0; i < 60; i += 1) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const date = cursor.toISOString().slice(0, 10);
    const config = resolveWorkCalendarDay(date, overrides.get(date));
    if (config.isWorkday) {
      return date;
    }
  }

  return start.toISOString().slice(0, 10);
}
