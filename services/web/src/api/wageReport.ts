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

// ─────────────────────────────────────────────
// Query Keys
// ─────────────────────────────────────────────

export const wageReportKeys = {
  all: ['wage-reports'] as const,
  reports: () => [...wageReportKeys.all, 'report'] as const,
  report: (filter: WageReportFilter) => [...wageReportKeys.reports(), filter] as const,
  myWages: () => [...wageReportKeys.all, 'my-wages'] as const,
  myWage: (filter: MyWagesFilter) => [...wageReportKeys.myWages(), filter] as const,
};

// ─────────────────────────────────────────────
// 原始 API 函数
// ─────────────────────────────────────────────

export const wageReportApi = {
  getReport: (filter: WageReportFilter) => {
    // 过滤掉空字符串参数，避免后端报错
    const params: Record<string, unknown> = {};
    if (filter.page)        params.page = filter.page;
    if (filter.pageSize)    params.pageSize = filter.pageSize;
    if (filter.dateFrom)    params.dateFrom = filter.dateFrom;
    if (filter.dateTo)      params.dateTo = filter.dateTo;
    if (filter.userId)      params.userId = filter.userId;
    if (filter.workerGrade) params.workerGrade = filter.workerGrade;
    return request.get<WageReportData>('/api/reports/wages', params);
  },

  getMyWages: (filter: MyWagesFilter) => {
    const params: Record<string, unknown> = {};
    if (filter.page)      params.page = filter.page;
    if (filter.pageSize)  params.pageSize = filter.pageSize;
    if (filter.dateFrom)  params.dateFrom = filter.dateFrom;
    if (filter.dateTo)    params.dateTo = filter.dateTo;
    return request.get<PaginatedData<WageReportRow>>('/api/reports/wages/my', params);
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
