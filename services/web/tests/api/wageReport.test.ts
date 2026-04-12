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
import { wageReportApi, useMyWages, useTaskWageReport } from '@/api/wageReport';
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

describe('wageReportApi.getReport', () => {
  it('应兼容旧工资接口字段并归一化为页面所需结构', async () => {
    mockGet.mockResolvedValueOnce({
      list: [
        {
          userId: 9,
          userName: '张三',
          workerGrade: 'skilled',
          stepName: '裁剪',
          qty: '12.5',
          unitPrice: '3.50',
          subtotal: '43.75',
        },
        {
          userId: 10,
          userName: '李四',
          workerGrade: 'apprentice',
          stepName: '缝制',
          qty: '6',
          unitPrice: null,
          subtotal: null,
        },
      ],
      total: 2,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    });

    const data = await wageReportApi.getReport({ page: 1, pageSize: 20 });

    expect(data.list[0]).toMatchObject({
      userId: 9,
      userName: '张三',
      stepName: '裁剪',
      completedCount: 12.5,
      unitPrice: '3.50',
      subtotal: '43.75',
    });
    expect(data.list[1]).toMatchObject({
      userId: 10,
      userName: '李四',
      stepName: '缝制',
      completedCount: 6,
      unitPrice: null,
      subtotal: null,
    });
    expect(data.totalCount).toBe(18.5);
    expect(data.totalWage).toBe('43.75');
    expect(data.unconfiguredCount).toBe(1);
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

describe('useMyWages', () => {
  it('应将旧字段 qty 归一化为 completedCount', async () => {
    mockGet.mockResolvedValueOnce({
      list: [
        {
          userId: 11,
          userName: '王五',
          workerGrade: 'skilled',
          stepName: '包装',
          qty: '8',
          unitPrice: '1.20',
          subtotal: '9.60',
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    });

    const { result } = renderHook(
      () => useMyWages({ page: 1, pageSize: 20 }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.list[0]).toMatchObject({
      userId: 11,
      stepName: '包装',
      completedCount: 8,
      unitPrice: '1.20',
      subtotal: '9.60',
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
