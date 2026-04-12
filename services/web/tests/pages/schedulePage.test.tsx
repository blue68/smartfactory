import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SchedulePage from '@/pages/production/SchedulePage';

const mocks = vi.hoisted(() => ({
  useSchedule: vi.fn(),
  useScheduleHistory: vi.fn(),
  useConfirmSchedule: vi.fn(),
  useAdjustSchedule: vi.fn(),
  useProductionWorkCalendar: vi.fn(),
  useUpdateWorkCalendarDay: vi.fn(),
  useProductionWorkers: vi.fn(),
  useProductionWorkstations: vi.fn(),
  setPageTitle: vi.fn(),
  showToast: vi.fn(),
  generateSchedule: vi.fn(),
  permissionCan: vi.fn(),
}));

vi.mock('@/api/production', () => ({
  productionApi: {
    generateSchedule: mocks.generateSchedule,
  },
  productionKeys: {
    schedule: (date: string) => ['production', 'schedule', date],
  },
  useSchedule: mocks.useSchedule,
  useScheduleHistory: mocks.useScheduleHistory,
  useConfirmSchedule: mocks.useConfirmSchedule,
  useAdjustSchedule: mocks.useAdjustSchedule,
  useProductionWorkCalendar: mocks.useProductionWorkCalendar,
  useUpdateWorkCalendarDay: mocks.useUpdateWorkCalendarDay,
  useProductionWorkers: mocks.useProductionWorkers,
  useProductionWorkstations: mocks.useProductionWorkstations,
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => ({
    can: mocks.permissionCan,
    canAny: vi.fn(),
    canAll: vi.fn(),
  }),
}));

vi.mock('@/stores/appStore', () => ({
  useAppStore: () => ({
    setPageTitle: mocks.setPageTitle,
    showToast: mocks.showToast,
  }),
}));

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/production/schedule?date=2099-01-02&workOrderNo=WO-001']}>
        <SchedulePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('SchedulePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.useSchedule.mockReturnValue({
      data: {
        date: '2099-01-02',
        schedules: [
          {
            scheduleId: 1,
            productionOrderId: 101,
            operationId: 201,
            componentId: 301,
            workOrderNo: 'WO-001',
            processStepId: 11,
            stepName: '开料',
            outputSkuId: 501,
            outputSkuName: '半成品框架',
            workerId: 9,
            workerName: '张三',
            workstationId: 6,
            workstationName: '裁剪台 1',
            plannedQty: '12',
            estimatedHours: '3.5',
            status: 'planned',
            updatedAt: '2099-01-02 09:00:00',
          },
          {
            scheduleId: 2,
            productionOrderId: 101,
            operationId: 202,
            componentId: 302,
            workOrderNo: 'WO-001',
            processStepId: 12,
            stepName: '封边',
            outputSkuId: 502,
            outputSkuName: '半成品侧板',
            workerId: null,
            workerName: null,
            workstationId: null,
            workstationName: null,
            plannedQty: '12',
            estimatedHours: '2.0',
            status: 'planned',
            updatedAt: '2099-01-02 09:00:00',
          },
        ],
        summary: {
          totalOrders: 1,
          totalSteps: 2,
          capacityLoadRate: '96%',
          confirmed: false,
          confirmedAt: null,
        },
      },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });

    const mutation = { mutateAsync: vi.fn(), isPending: false };
    mocks.useConfirmSchedule.mockReturnValue(mutation);
    mocks.useAdjustSchedule.mockReturnValue(mutation);
    mocks.useUpdateWorkCalendarDay.mockReturnValue(mutation);
    mocks.permissionCan.mockReturnValue(true);
    mocks.useScheduleHistory.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
    });
    mocks.useProductionWorkCalendar.mockReturnValue({
      data: [
        {
          date: '2099-01-02',
          isWorkday: true,
          isHoliday: false,
          normalRanges: [
            { startTime: '08:00', endTime: '12:00' },
            { startTime: '13:30', endTime: '17:30' },
          ],
          overtimeRanges: [
            { startTime: '18:30', endTime: '20:30' },
          ],
          normalHours: '8.0',
          overtimeHours: '2.0',
          totalHours: '10.0',
        },
      ],
    });
    mocks.useProductionWorkers.mockReturnValue({ data: [] });
    mocks.useProductionWorkstations.mockReturnValue({ data: [] });
  });

  it('renders risk panel and preserves output sku semantics across order and worker views', async () => {
    renderPage();

    expect(screen.getByText('今日排产风险提示')).toBeInTheDocument();
    expect(screen.getByText('今日产能已接近满载')).toBeInTheDocument();
    expect(screen.getByText('存在待补排资源的工序')).toBeInTheDocument();

    expect(screen.getByText('半成品框架')).toBeInTheDocument();
    expect(screen.getByText('半成品侧板')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /人员视图/ }));
    expect(await screen.findByText('工人任务分配')).toBeInTheDocument();
    expect(screen.getByText('开料 · 半成品框架')).toBeInTheDocument();
    expect(screen.getByText('以当日 10.0 小时工时为基准')).toBeInTheDocument();
  });

  it('normalizes runtime string schedule ids before submitting schedule adjustment', async () => {
    const adjustMutation = { mutateAsync: vi.fn().mockResolvedValue({ updated: 1 }), isPending: false };
    mocks.useAdjustSchedule.mockReturnValue(adjustMutation);
    mocks.useProductionWorkers.mockReturnValue({ data: [{ id: 9, name: '张三' }] });
    mocks.useProductionWorkstations.mockReturnValue({ data: [{ id: 6, name: '裁剪台 1', type: 'cut', capacity: 80, status: 'active', linkedProcessCount: 1 }] });
    mocks.useSchedule.mockReturnValue({
      data: {
        date: '2099-01-02',
        schedules: [
          {
            scheduleId: '2',
            productionOrderId: 101,
            operationId: 202,
            componentId: 302,
            workOrderNo: 'WO-001',
            processStepId: 12,
            stepName: '封边',
            outputSkuId: 502,
            outputSkuName: '半成品侧板',
            workerId: '9',
            workerName: '张三',
            workstationId: '6',
            workstationName: '裁剪台 1',
            plannedQty: '12',
            estimatedHours: '2.0',
            status: 'planned',
            updatedAt: '2099-01-02 09:00:00',
          },
        ],
        summary: {
          totalOrders: 1,
          totalSteps: 1,
          capacityLoadRate: '40%',
          confirmed: false,
          confirmedAt: null,
        },
      },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /封边/ }));
    fireEvent.change(screen.getByLabelText('计划数量'), { target: { value: '9.50' } });
    fireEvent.click(screen.getByRole('button', { name: '保存调整' }));

    expect(adjustMutation.mutateAsync).toHaveBeenCalledWith({
      date: '2099-01-02',
      adjustments: [
        {
          scheduleId: 2,
          workerId: 9,
          workstationId: 6,
          plannedQty: '9.50',
          expectedUpdatedAt: '2099-01-02 09:00:00',
        },
      ],
    });
  });

  it('opens work calendar modal and submits daily work ranges', async () => {
    const calendarMutation = { mutateAsync: vi.fn().mockResolvedValue(null), isPending: false };
    mocks.useUpdateWorkCalendarDay.mockReturnValue(calendarMutation);

    renderPage();

    fireEvent.click(screen.getByRole('button', { name: '生产日历' }));
    expect(screen.getByText('生产日历配置')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '保存配置' }));

    expect(calendarMutation.mutateAsync).toHaveBeenCalledWith({
      date: '2099-01-02',
      isWorkday: true,
      name: undefined,
      normalRanges: [
        { startTime: '08:00', endTime: '12:00' },
        { startTime: '13:30', endTime: '17:30' },
      ],
      overtimeRanges: [
        { startTime: '18:30', endTime: '20:30' },
      ],
    });
  });
});
