import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import TaskPage from '@/pages/production/TaskPage';

const mocks = vi.hoisted(() => ({
  useTaskList: vi.fn(),
  useTaskDetail: vi.fn(),
  useTaskStats: vi.fn(),
  useStartTask: vi.fn(),
  useCompleteTask: vi.fn(),
  useReportException: vi.fn(),
  useResolveException: vi.fn(),
  useSuspendTask: vi.fn(),
  setPageTitle: vi.fn(),
  showToast: vi.fn(),
  hasAnyRole: vi.fn(),
}));

vi.mock('@/api/productionTask', () => ({
  useTaskList: mocks.useTaskList,
  useTaskDetail: mocks.useTaskDetail,
  useTaskStats: mocks.useTaskStats,
  useStartTask: mocks.useStartTask,
  useCompleteTask: mocks.useCompleteTask,
  useReportException: mocks.useReportException,
  useResolveException: mocks.useResolveException,
  useSuspendTask: mocks.useSuspendTask,
}));

vi.mock('@/stores/appStore', () => ({
  useAppStore: () => ({
    setPageTitle: mocks.setPageTitle,
    showToast: mocks.showToast,
  }),
}));

vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => ({
    hasAnyRole: mocks.hasAnyRole,
  }),
}));

describe('TaskPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.hasAnyRole.mockReturnValue(true);
    mocks.useTaskList.mockReturnValue({
      data: {
        list: [{
          id: 1,
          taskNo: 'TASK-001',
          taskDate: '2026-04-01',
          orderNo: 'WO-001',
          productName: '主柜体',
          processName: '裁剪',
          workstationName: '裁剪台 1',
          workerName: '张三',
          plannedQty: 12,
          completedQty: 6,
          status: 'in_progress',
        }],
        total: 1,
      },
      isLoading: false,
      isError: false,
    });
    mocks.useTaskStats.mockReturnValue({
      data: {
        total: 1,
        byStatus: {
          pending: 0,
          in_progress: 1,
          completed: 0,
          exception: 0,
          suspended: 0,
        },
      },
    });
    mocks.useTaskDetail.mockImplementation((id: number | null) => ({
      data: id === 1 ? {
        id: 1,
        taskNo: 'TASK-001',
        taskDate: '2026-04-01',
        orderNo: 'WO-001',
        productName: '主柜体',
        processName: '裁剪',
        workstationName: '裁剪台 1',
        workerName: '张三',
        plannedQty: 12,
        completedQty: 6,
        scrapQty: 1,
        actualHours: 2.5,
        outputSkuName: '半成品框架',
        status: 'in_progress',
        dependencySummary: {
          blocked: true,
          blockingReason: '开料 未达到可开工数量（需 12，当前 6）',
          predecessors: [
            {
              operationId: 88,
              stepName: '开料',
              requiredQty: '12',
              completedQty: '6',
              status: 'started',
            },
          ],
        },
        materialTransactions: [
          {
            id: 501,
            ioType: 'input',
            skuId: 11,
            skuCode: 'RM-11',
            skuName: '橡木板',
            plannedQty: '12',
            actualQty: '6',
            inventoryTxId: 701,
            transactionNo: 'TX-701',
            transactionType: 'MATERIAL_OUT',
            direction: 'OUT',
            transactionQty: '6',
            transactionTime: '2026-04-01 09:00:00',
            referenceNo: 'WO-001',
          },
          {
            id: 502,
            ioType: 'output',
            skuId: 12,
            skuCode: 'WIP-12',
            skuName: '半成品框架',
            plannedQty: '12',
            actualQty: '6',
            inventoryTxId: 702,
            transactionNo: 'TX-702',
            transactionType: 'PRODUCTION_IN',
            direction: 'IN',
            transactionQty: '6',
            transactionTime: '2026-04-01 11:30:00',
            referenceNo: 'WO-001',
          },
        ],
        wageReport: {
          reportId: 1001,
          reportNo: 'WR-1001',
          reportDate: '2026-04-01',
          workerGrade: 'skilled',
          stepName: '裁剪',
          qtyQualified: '5',
          workHours: '2.5',
          unitPrice: '8',
          subtotal: '40',
        },
        exceptions: [],
      } : undefined,
      isLoading: false,
    }));

    const mutation = { mutateAsync: vi.fn(), isPending: false };
    mocks.useStartTask.mockReturnValue(mutation);
    mocks.useCompleteTask.mockReturnValue(mutation);
    mocks.useReportException.mockReturnValue(mutation);
    mocks.useResolveException.mockReturnValue(mutation);
    mocks.useSuspendTask.mockReturnValue(mutation);
  });

  it('opens task drawer and renders dependency, material trace and wage sections', async () => {
    render(<TaskPage />);

    fireEvent.click(screen.getByRole('button', { name: '详情' }));

    expect(await screen.findByRole('dialog', { name: '任务详情' })).toBeInTheDocument();
    expect(screen.getByText('依赖与阻塞')).toBeInTheDocument();
    expect(screen.getByText('开料 未达到可开工数量（需 12，当前 6）')).toBeInTheDocument();
    expect(screen.getByText('投入产出与库存流水')).toBeInTheDocument();
    expect(screen.getByText('橡木板')).toBeInTheDocument();
    expect(screen.getAllByText('半成品框架').length).toBeGreaterThan(0);
    expect(screen.getByText('工资与工时')).toBeInTheDocument();
    expect(screen.getByText('来源 WR-1001 · 裁剪')).toBeInTheDocument();
  });
});
