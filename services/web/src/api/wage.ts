/**
 * [artifact:接口联调代码] — 工资报表 API (P1 补充)
 * 对 wageReport.ts 的类型适配层，对齐任务说明中的接口签名
 */

export type {
  WageReportRow,
  WageReportFilter as WageReportParams,
  WageTaskReportFilter as WageTaskReportParams,
  WageTaskReportRow,
  MyWagesFilter,
  WageReportData,
  WorkerGrade,
} from './wageReport';

export {
  useWageReport,
  useTaskWageReport,
  useMyWages,
  wageReportApi,
  wageReportKeys,
} from './wageReport';

import request from '@/utils/request';
import type { WageReportFilter } from './wageReport';

/**
 * 导出工资报表（blob 下载）
 * 不含分页参数
 */
export function exportWages(
  params: Omit<WageReportFilter, 'page' | 'pageSize'>,
): Promise<Blob> {
  const cleanParams: Record<string, unknown> = {};
  if (params.dateFrom)    cleanParams.dateFrom = params.dateFrom;
  if (params.dateTo)      cleanParams.dateTo = params.dateTo;
  if (params.userId)      cleanParams.userId = params.userId;
  if (params.workerGrade) cleanParams.workerGrade = params.workerGrade;

  return request.get<Blob>('/api/reports/wages/export', cleanParams, {
    responseType: 'blob',
  });
}
