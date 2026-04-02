import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import WageReportPage from '@/pages/report/WageReportPage';

const mocks = vi.hoisted(() => ({
  useWageReport: vi.fn(),
  useTaskWageReport: vi.fn(),
  exportWages: vi.fn(),
  setPageTitle: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock('@/api/wage', () => ({
  useWageReport: mocks.useWageReport,
  useTaskWageReport: mocks.useTaskWageReport,
  exportWages: mocks.exportWages,
}));

vi.mock('@/stores/appStore', () => ({
  useAppStore: () => ({
    setPageTitle: mocks.setPageTitle,
    showToast: mocks.showToast,
  }),
}));

vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => ({
    user: { roles: ['boss'] },
  }),
}));

describe('WageReportPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.useWageReport.mockReturnValue({
      data: {
        list: [],
        total: 0,
        page: 1,
        pageSize: 20,
        totalPages: 0,
        totalCount: 0,
        totalWage: '0.00',
        unconfiguredCount: 0,
      },
      isLoading: false,
    });

    mocks.useTaskWageReport.mockReturnValue({
      data: {
        list: [],
        total: 0,
        page: 1,
        pageSize: 20,
        totalPages: 0,
      },
      isLoading: false,
    });
  });

  it('任务报工筛选应输入与查询分离，清空后恢复未筛选状态', async () => {
    render(<WageReportPage />);

    fireEvent.click(screen.getByRole('button', { name: '任务报工' }));

    const orderInput = screen.getByLabelText('工单 ID') as HTMLInputElement;
    const taskInput = screen.getByLabelText('任务 ID') as HTMLInputElement;
    fireEvent.change(orderInput, { target: { value: '1201' } });
    fireEvent.change(taskInput, { target: { value: '3301' } });

    expect(screen.queryByText(/已筛选：工单/)).toBeNull();

    const callsBeforeApply = mocks.useTaskWageReport.mock.calls;
    const lastBeforeApply = callsBeforeApply[callsBeforeApply.length - 1][0] as {
      productionOrderId?: number;
      taskId?: number;
    };
    expect(lastBeforeApply.productionOrderId).toBeUndefined();
    expect(lastBeforeApply.taskId).toBeUndefined();

    fireEvent.click(screen.getByRole('button', { name: '查询' }));

    await waitFor(() => {
      expect(screen.getByText(/已筛选：工单 1201 \/ 任务 3301/)).toBeInTheDocument();
    });

    const callsAfterApply = mocks.useTaskWageReport.mock.calls;
    const lastAfterApply = callsAfterApply[callsAfterApply.length - 1][0] as {
      productionOrderId?: number;
      taskId?: number;
    };
    expect(lastAfterApply.productionOrderId).toBe(1201);
    expect(lastAfterApply.taskId).toBe(3301);

    fireEvent.click(screen.getByRole('button', { name: '清空' }));

    await waitFor(() => {
      expect(screen.queryByText(/已筛选：工单/)).toBeNull();
    });

    const callsAfterClear = mocks.useTaskWageReport.mock.calls;
    const lastAfterClear = callsAfterClear[callsAfterClear.length - 1][0] as {
      productionOrderId?: number;
      taskId?: number;
    };
    expect(lastAfterClear.productionOrderId).toBeUndefined();
    expect(lastAfterClear.taskId).toBeUndefined();
  });

  it('任务报工加载中时应显示专用加载文案', async () => {
    mocks.useTaskWageReport.mockReturnValue({
      data: undefined,
      isLoading: true,
    });

    render(<WageReportPage />);
    fireEvent.click(screen.getByRole('button', { name: '任务报工' }));

    expect(screen.getByText('任务报工加载中…')).toBeInTheDocument();
  });

  it('任务报工空态应显示“暂无任务报工记录”', async () => {
    mocks.useTaskWageReport.mockReturnValue({
      data: {
        list: [],
        total: 0,
        page: 1,
        pageSize: 20,
        totalPages: 0,
      },
      isLoading: false,
    });

    render(<WageReportPage />);
    fireEvent.click(screen.getByRole('button', { name: '任务报工' }));

    expect(screen.getByText('暂无任务报工记录')).toBeInTheDocument();
  });

  it('任务报工筛选按 Enter 时应触发查询', async () => {
    render(<WageReportPage />);
    fireEvent.click(screen.getByRole('button', { name: '任务报工' }));

    const orderInput = screen.getByLabelText('工单 ID') as HTMLInputElement;
    fireEvent.change(orderInput, { target: { value: '2201' } });
    fireEvent.keyDown(orderInput, { key: 'Enter', code: 'Enter' });

    await waitFor(() => {
      expect(screen.getByText(/已筛选：工单 2201 \/ 任务 不限/)).toBeInTheDocument();
    });

    const calls = mocks.useTaskWageReport.mock.calls;
    const lastArg = calls[calls.length - 1][0] as { productionOrderId?: number };
    expect(lastArg.productionOrderId).toBe(2201);
  });
});
