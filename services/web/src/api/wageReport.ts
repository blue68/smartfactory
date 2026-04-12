/**
 * [artifact:接口联调代码] — 工资报表 API (R-05)
 *
 * 后端接口：
 *   GET /api/reports/wages      — 管理员视角工资汇总（含工人筛选）
 *   GET /api/reports/my-wages   — 工人自查本人工资
 */

import { useQuery } from '@tanstack/react-query';
import request from '@/utils/request';
import type { PaginatedData } from '@/types/api';

// ─────────────────────────────────────────────
// 类型定义
// ─────────────────────────────────────────────

export type WorkerGrade = 'skilled' | 'apprentice';

export interface WageReportFilter {
  page?: number;
  pageSize?: number;
  dateFrom?: string; // 'YYYY-MM-DD'
  dateTo?: string;   // 'YYYY-MM-DD'
  userId?: number;
  workerGrade?: WorkerGrade | '';
}

export interface WageTaskReportFilter extends WageReportFilter {
  productionOrderId?: number;
  taskId?: number;
}

export interface MyWagesFilter {
  page?: number;
  pageSize?: number;
  dateFrom?: string;
  dateTo?: string;
}

/** 工资报表单行数据 */
export interface WageReportRow {
  userId: number;
  userName: string;
  workerGrade: WorkerGrade;
  stepId: number;
  stepName: string;
  completedCount: number;
  unitPrice: string | null; // null 表示未配置单价
  subtotal: string | null;  // null 表示未配置单价
}

/** 工资报表分页结果（含汇总数据） */
export interface WageReportData {
  list: WageReportRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  /** 总完成件数（含未配置单价的行） */
  totalCount: number;
  /** 总工资合计（仅含已配置单价的行） */
  totalWage: string;
  /** 未配置单价的行数 */
  unconfiguredCount: number;
}

interface RawWageReportRow {
  userId: number;
  userName: string;
  workerGrade: WorkerGrade | '';
  stepId?: number | null;
  stepName: string;
  completedCount?: number | string | null;
  qty?: number | string | null;
  unitPrice: string | number | null;
  subtotal: string | number | null;
}

interface RawWageReportData {
  list: RawWageReportRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  totalCount?: number;
  totalWage?: string;
  unconfiguredCount?: number;
}

export interface WageTaskReportRow {
  reportId: number;
  reportNo: string;
  reportDate: string;
  productionOrderId: number | null;
  orderNo: string | null;
  taskId: number | null;
  taskNo: string | null;
  taskStatus: string | null;
  userId: number;
  userName: string;
  workerGrade: WorkerGrade | '';
  processStepId: number | null;
  stepName: string;
  qtyCompleted: string;
  qtyQualified: string;
  qtyDefective: string;
  workHours: string;
  unitPrice: string;
  subtotal: string;
}

function toNullableString(value: string | number | null | undefined): string | null {
  if (value == null) return null;
  return String(value);
}

function toNumber(value: string | number | null | undefined): number {
  if (value == null || value === '') return 0;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function normalizeWageReportRow(row: RawWageReportRow): WageReportRow {
  return {
    userId: row.userId,
    userName: row.userName,
    workerGrade: row.workerGrade || 'apprentice',
    stepId: row.stepId ?? 0,
    stepName: row.stepName,
    completedCount: toNumber(row.completedCount ?? row.qty),
    unitPrice: toNullableString(row.unitPrice),
    subtotal: toNullableString(row.subtotal),
  };
}

function normalizeWageReportData(data: RawWageReportData): WageReportData {
  const list = data.list.map(normalizeWageReportRow);
  const fallbackSummary = list.reduce((summary, row) => ({
    totalCount: summary.totalCount + row.completedCount,
    totalWage: summary.totalWage + Number(row.subtotal ?? 0),
    unconfiguredCount: summary.unconfiguredCount + (row.unitPrice == null ? 1 : 0),
  }), {
    totalCount: 0,
    totalWage: 0,
    unconfiguredCount: 0,
  });

  return {
    ...data,
    list,
    totalCount: data.totalCount ?? fallbackSummary.totalCount,
    totalWage: data.totalWage ?? fallbackSummary.totalWage.toFixed(2),
    unconfiguredCount: data.unconfiguredCount ?? fallbackSummary.unconfiguredCount,
  };
}

// ─────────────────────────────────────────────
// Query Keys
// ─────────────────────────────────────────────

export const wageReportKeys = {
  all: ['wage-reports'] as const,
  reports: () => [...wageReportKeys.all, 'report'] as const,
  report: (filter: WageReportFilter) => [...wageReportKeys.reports(), filter] as const,
  taskReports: () => [...wageReportKeys.all, 'task-report'] as const,
  taskReport: (filter: WageTaskReportFilter) => [...wageReportKeys.taskReports(), filter] as const,
  myWages: () => [...wageReportKeys.all, 'my-wages'] as const,
  myWage: (filter: MyWagesFilter) => [...wageReportKeys.myWages(), filter] as const,
};

// ─────────────────────────────────────────────
// 原始 API 函数
// ─────────────────────────────────────────────

export const wageReportApi = {
  getReport: async (filter: WageReportFilter) => {
    // 过滤掉空字符串参数，避免后端报错
    const params: Record<string, unknown> = {};
    if (filter.page)        params.page = filter.page;
    if (filter.pageSize)    params.pageSize = filter.pageSize;
    if (filter.dateFrom)    params.dateFrom = filter.dateFrom;
    if (filter.dateTo)      params.dateTo = filter.dateTo;
    if (filter.userId)      params.userId = filter.userId;
    if (filter.workerGrade) params.workerGrade = filter.workerGrade;
    const data = await request.get<RawWageReportData>('/api/reports/wages', params);
    return normalizeWageReportData(data);
  },

  getTaskReport: (filter: WageTaskReportFilter) => {
    const params: Record<string, unknown> = {};
    if (filter.page) params.page = filter.page;
    if (filter.pageSize) params.pageSize = filter.pageSize;
    if (filter.dateFrom) params.dateFrom = filter.dateFrom;
    if (filter.dateTo) params.dateTo = filter.dateTo;
    if (filter.userId) params.userId = filter.userId;
    if (filter.workerGrade) params.workerGrade = filter.workerGrade;
    if (filter.productionOrderId) params.productionOrderId = filter.productionOrderId;
    if (filter.taskId) params.taskId = filter.taskId;
    return request.get<PaginatedData<WageTaskReportRow>>('/api/reports/wages/tasks', params);
  },

  getMyWages: async (filter: MyWagesFilter) => {
    const params: Record<string, unknown> = {};
    if (filter.page)      params.page = filter.page;
    if (filter.pageSize)  params.pageSize = filter.pageSize;
    if (filter.dateFrom)  params.dateFrom = filter.dateFrom;
    if (filter.dateTo)    params.dateTo = filter.dateTo;
    const data = await request.get<PaginatedData<RawWageReportRow>>('/api/reports/wages/my', params);
    return {
      ...data,
      list: data.list.map(normalizeWageReportRow),
    };
  },
};

// ─────────────────────────────────────────────
// React Query Hooks
// ─────────────────────────────────────────────

/**
 * 工资核算报表（管理员视角）
 * @param filter  筛选条件
 * @param enabled 是否立即查询（默认 true）
 */
export function useWageReport(filter: WageReportFilter, enabled = true) {
  return useQuery({
    queryKey: wageReportKeys.report(filter),
    queryFn: () => wageReportApi.getReport(filter),
    enabled,
    // 保留上一次成功的数据，切换筛选条件时不闪烁
    placeholderData: (prev) => prev,
  });
}

export function useTaskWageReport(filter: WageTaskReportFilter, enabled = true) {
  return useQuery({
    queryKey: wageReportKeys.taskReport(filter),
    queryFn: () => wageReportApi.getTaskReport(filter),
    enabled,
    placeholderData: (prev) => prev,
  });
}

/**
 * 我的工资（工人自查）
 */
export function useMyWages(filter: MyWagesFilter, enabled = true) {
  return useQuery({
    queryKey: wageReportKeys.myWage(filter),
    queryFn: () => wageReportApi.getMyWages(filter),
    enabled,
    placeholderData: (prev) => prev,
  });
}
