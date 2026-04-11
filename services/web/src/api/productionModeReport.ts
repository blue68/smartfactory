import { useQuery } from '@tanstack/react-query';
import request from '@/utils/request';
import type { PaginatedData } from '@/types/api';

export type SemiFinishedModeTag = 'internal_only' | 'outsource_only' | 'mixed' | 'no_operation';

export interface SemiFinishedModeReportFilter {
  page?: number;
  pageSize?: number;
  from?: string;
  to?: string;
  keyword?: string;
  modeTag?: SemiFinishedModeTag | '';
}

export interface SemiFinishedModeReportRow {
  skuId: number;
  skuCode: string;
  skuName: string;
  skuSpec: string | null;
  internalPlannedQty: string;
  outsourcePlannedQty: string;
  internalCompletedQty: string;
  outsourceCompletedQty: string;
  modeTag: SemiFinishedModeTag;
}

export const productionModeReportKeys = {
  all: ['production-mode-reports'] as const,
  semiFinished: () => [...productionModeReportKeys.all, 'semi-finished'] as const,
  semiFinishedList: (filter: SemiFinishedModeReportFilter) => (
    [...productionModeReportKeys.semiFinished(), filter] as const
  ),
};

export const productionModeReportApi = {
  getSemiFinishedReport: (filter: SemiFinishedModeReportFilter) => {
    const params: Record<string, unknown> = {};
    if (filter.page) params.page = filter.page;
    if (filter.pageSize) params.pageSize = filter.pageSize;
    if (filter.from) params.from = filter.from;
    if (filter.to) params.to = filter.to;
    if (filter.keyword) params.keyword = filter.keyword;
    if (filter.modeTag) params.modeTag = filter.modeTag;
    return request.get<PaginatedData<SemiFinishedModeReportRow>>(
      '/api/reports/production-modes/semi-finished',
      params,
    );
  },
};

export function useSemiFinishedModeReport(filter: SemiFinishedModeReportFilter, enabled = true) {
  return useQuery({
    queryKey: productionModeReportKeys.semiFinishedList(filter),
    queryFn: () => productionModeReportApi.getSemiFinishedReport(filter),
    enabled,
    placeholderData: (prev) => prev,
  });
}
