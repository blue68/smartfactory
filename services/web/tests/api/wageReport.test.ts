import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { createWrapper } from '../helpers/wrapper';

vi.mock('@/utils/request', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

import request from '@/utils/request';
import { wageReportApi, useTaskWageReport } from '@/api/wageReport';
import { exportWages } from '@/api/wage';

const mockGet = request.get as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('wageReportApi.getTaskReport', () => {
  it('应透传任务报工筛选并过滤空字符串字段', async () => {
    mockGet.mockResolvedValueOnce({
      list: [],
      total: 0,
      page: 1,
      pageSize: 20,
      totalPages: 0,
    });

    await wageReportApi.getTaskReport({
      page: 1,
      pageSize: 20,
      dateFrom: '2026-03-01',
      dateTo: '2026-03-31',
      userId: 7,
      workerGrade: '',
      productionOrderId: 1201,
      taskId: 3301,
    });

    expect(mockGet).toHaveBeenCalledWith('/api/reports/wages/tasks', {
      page: 1,
      pageSize: 20,
      dateFrom: '2026-03-01',
      dateTo: '2026-03-31',
      userId: 7,
      productionOrderId: 1201,
      taskId: 3301,
    });
  });
});

describe('useTaskWageReport', () => {
  it('enabled=false 时不应发起请求', async () => {
    const { result } = renderHook(
      () =>
        useTaskWageReport(
          {
            page: 1,
            pageSize: 20,
            dateFrom: '2026-03-01',
            dateTo: '2026-03-31',
          },
          false,
        ),
      { wrapper: createWrapper() },
    );

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(mockGet).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('enabled=true 时应发起任务报工查询', async () => {
    mockGet.mockResolvedValueOnce({
      list: [],
      total: 0,
      page: 1,
      pageSize: 20,
      totalPages: 0,
    });

    const { result } = renderHook(
      () =>
        useTaskWageReport(
          {
            page: 1,
            pageSize: 20,
            productionOrderId: 1201,
          },
          true,
        ),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockGet).toHaveBeenCalledWith('/api/reports/wages/tasks', {
      page: 1,
      pageSize: 20,
      productionOrderId: 1201,
    });
  });
});

describe('exportWages', () => {
  it('应只透传非空导出筛选并附带 blob 配置', async () => {
    const blob = new Blob(['ok'], { type: 'application/octet-stream' });
    mockGet.mockResolvedValueOnce(blob);

    await exportWages({
      dateFrom: '',
      dateTo: '2026-03-31',
      userId: 0,
      workerGrade: '',
    });

    expect(mockGet).toHaveBeenCalledWith(
      '/api/reports/wages/export',
      { dateTo: '2026-03-31' },
      { responseType: 'blob' },
    );
  });
});
