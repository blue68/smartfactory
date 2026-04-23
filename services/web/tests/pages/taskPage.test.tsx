import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import TaskPage from '@/pages/production/TaskPage';

const mocks = vi.hoisted(() => ({
  useTaskList: vi.fn(),
  useTaskDetail: vi.fn(),
  useProductionWorkers: vi.fn(),
  useProductionBatchList: vi.fn(),
  taskApiDetail: vi.fn(),
  useTaskStats: vi.fn(),
  useStartTask: vi.fn(),
  useCompleteTask: vi.fn(),
  completeMutateAsync: vi.fn(),
  useIssueTaskMaterials: vi.fn(),
  issueMutateAsync: vi.fn(),
  useLocationOptions: vi.fn(),
  useReportException: vi.fn(),
  useReturnTaskMaterials: vi.fn(),
  returnMutateAsync: vi.fn(),
  useResolveException: vi.fn(),
  useSuspendTask: vi.fn(),
  useWarehouseOptions: vi.fn(),
  setPageTitle: vi.fn(),
  showToast: vi.fn(),
  hasAnyRole: vi.fn(),
  permissionCan: vi.fn(),
}));

vi.mock('@/api/productionTask', () => ({
  useTaskList: mocks.useTaskList,
  useTaskDetail: mocks.useTaskDetail,
  useTaskStats: mocks.useTaskStats,
  useStartTask: mocks.useStartTask,
  useCompleteTask: mocks.useCompleteTask,
  useIssueTaskMaterials: mocks.useIssueTaskMaterials,
  useLocationOptions: mocks.useLocationOptions,
  useReportException: mocks.useReportException,
  useReturnTaskMaterials: mocks.useReturnTaskMaterials,
  useResolveException: mocks.useResolveException,
  useSuspendTask: mocks.useSuspendTask,
  taskApi: {
    detail: mocks.taskApiDetail,
  },
}));

vi.mock('@/api/production', () => ({
  useProductionWorkers: mocks.useProductionWorkers,
  useProductionBatchList: mocks.useProductionBatchList,
}));

vi.mock('@/api/inventory', () => ({
  useWarehouseOptions: mocks.useWarehouseOptions,
  useLocationOptions: mocks.useLocationOptions,
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

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => ({
    can: mocks.permissionCan,
    canAny: vi.fn(),
    canAll: vi.fn(),
  }),
}));

describe('TaskPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.hasAnyRole.mockReturnValue(true);
    mocks.permissionCan.mockReturnValue(true);
    const taskDetail = {
      id: 1,
      taskNo: 'TASK-001',
      taskDate: '2026-04-01',
      orderNo: 'WO-001',
      productName: '主柜体',
      plannedFinishTime: '2026-04-02 18:00:00',
      processName: '裁剪',
      processGuideText: '先校准裁切尺寸，再确认防护罩关闭。\n完成后检查边缘毛刺。',
      processGuideAttachmentUrl: '/uploads/process-guide.pdf',
      processGuideAttachmentName: '裁剪工序指导书.pdf',
      workstationName: '裁剪台 1',
      workerName: '张三',
      plannedQty: 12,
      completedQty: 6,
      scrapQty: 1,
      actualHours: 2.5,
      outputSkuName: '半成品框架',
      materialIssueStatus: 'line_side_remaining',
      materialIssueLabel: '线边有余料',
      status: 'in_progress',
      inputItems: [
        {
          itemType: 'material',
          sourceLabel: '工序开工投料',
          skuId: 11,
          skuCode: 'RM-11',
          skuName: '橡木板',
          unit: '张',
          hasDyeLot: true,
          requiredQty: '12',
          fulfilledQty: '6',
          qtyAvailable: '20',
          shortageQty: '0',
          isShortage: false,
          status: '已领 12.0000 / 已耗 6.0000 / 在线边 6.0000',
          operationId: null,
          stepName: null,
          inventoryTxId: 701,
          warehouseId: 21,
          warehouseCode: 'WH-RM',
          warehouseName: '原料仓',
          locationId: 31,
          locationCode: 'RM-01',
          locationName: 'RM-01',
        },
      ],
      outputItems: [
        {
          itemType: 'semi_finished',
          skuId: 12,
          skuCode: 'WIP-12',
          skuName: '半成品框架',
          unit: '件',
          plannedQty: '12',
          actualQty: '6',
          processStepId: 12,
          processName: '裁剪',
          warehouseCode: 'WH-WIP',
          warehouseName: '半成品仓',
          locationCode: 'WIP-01',
          locationName: 'WIP-01',
        },
      ],
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
          warehouseCode: 'WH-RM',
          warehouseName: '原料仓',
          locationCode: 'RM-01',
          locationName: 'RM-01',
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
          warehouseCode: 'WH-WIP',
          warehouseName: '半成品仓',
          locationCode: 'WIP-01',
          locationName: 'WIP-01',
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
    };
    mocks.useTaskList.mockReturnValue({
      data: {
        list: [{
          id: 1,
          taskNo: 'TASK-001',
          taskDate: '2026-04-01',
          orderNo: 'WO-001',
          productName: '主柜体',
          plannedFinishTime: '2026-04-02 18:00:00',
          processName: '裁剪',
          workstationName: '裁剪台 1',
          workerName: '张三',
          plannedQty: 12,
          completedQty: 6,
          materialIssueStatus: 'line_side_remaining',
          materialIssueLabel: '线边有余料',
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
    mocks.useProductionWorkers.mockReturnValue({
      data: [
        { id: 7, name: '张三' },
        { id: 8, name: '李四' },
      ],
    });
    mocks.useProductionBatchList.mockReturnValue({ data: { list: [], total: 0 } });
    mocks.useTaskDetail.mockImplementation((id: number | null) => ({
      data: id === 1 ? taskDetail : undefined,
      isLoading: false,
    }));
    mocks.taskApiDetail.mockResolvedValue(taskDetail);

    const mutation = { mutateAsync: vi.fn(), isPending: false };
    mocks.useStartTask.mockReturnValue(mutation);
    mocks.useCompleteTask.mockReturnValue({
      mutateAsync: mocks.completeMutateAsync,
      isPending: false,
    });
    mocks.useIssueTaskMaterials.mockReturnValue({
      mutateAsync: mocks.issueMutateAsync,
      isPending: false,
    });
    mocks.useWarehouseOptions.mockReturnValue({
      data: [{ id: 21, name: '原料仓', code: 'WH-RM' }],
    });
    mocks.useLocationOptions.mockReturnValue({
      data: [{ id: 31, name: 'RM-01', code: 'RM-01' }],
    });
    mocks.useReportException.mockReturnValue(mutation);
    mocks.useReturnTaskMaterials.mockReturnValue({
      mutateAsync: mocks.returnMutateAsync,
      isPending: false,
    });
    mocks.useResolveException.mockReturnValue(mutation);
    mocks.useSuspendTask.mockReturnValue(mutation);
  });

  it('opens task drawer and renders dependency, material trace and wage sections', async () => {
    render(<TaskPage />);

    expect(screen.getAllByText('张三').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: '详情' }));

    expect(await screen.findByRole('dialog', { name: '任务详情' })).toBeInTheDocument();
    expect(screen.getByText('期望完成时间')).toBeInTheDocument();
    expect(screen.getAllByText('线边有余料').length).toBeGreaterThan(0);
    expect(screen.getByText('依赖与阻塞')).toBeInTheDocument();
    expect(screen.getByText('开料 未达到可开工数量（需 12，当前 6）')).toBeInTheDocument();
    expect(screen.getAllByText((_, el) => el?.textContent?.includes('原料仓-RM-01') ?? false).length).toBeGreaterThan(0);
    expect(screen.getAllByText((_, el) => el?.textContent?.includes('半成品仓-WIP-01') ?? false).length).toBeGreaterThan(0);
    expect(screen.getAllByText((_, el) => el?.textContent?.includes('对应工序 裁剪') ?? false).length).toBeGreaterThan(0);
    expect(screen.getByText('工序操作指南')).toBeInTheDocument();
    expect(screen.getByText(/先校准裁切尺寸/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '打开附件：裁剪工序指导书.pdf' })).toBeInTheDocument();
    expect(screen.getByText('投入产出与库存流水')).toBeInTheDocument();
    expect(screen.getAllByText('橡木板').length).toBeGreaterThan(0);
    expect(screen.getAllByText('半成品框架').length).toBeGreaterThan(0);
    expect(screen.getByText('工资与工时')).toBeInTheDocument();
    expect(screen.getByText('来源 WR-1001 · 裁剪')).toBeInTheDocument();
    const drawer = screen.getByRole('dialog', { name: '任务详情' });
    expect(within(drawer).getByRole('button', { name: '继续领料' })).toBeInTheDocument();
    expect(within(drawer).getByRole('button', { name: '退料回仓' })).toBeInTheDocument();
  });

  it('opens material action modals from list actions after loading task detail', async () => {
    render(<TaskPage />);

    const row = screen.getByText('TASK-001').closest('tr');
    expect(row).not.toBeNull();

    fireEvent.click(within(row as HTMLTableRowElement).getByRole('button', { name: '继续领料' }));
    const issueDialog = await screen.findByRole('dialog', { name: '领料到线边' });
    expect(issueDialog).toBeInTheDocument();
    expect(mocks.taskApiDetail).toHaveBeenCalledWith(1);
    expect(screen.getByLabelText('缸号')).toBeInTheDocument();
    expect(screen.getByLabelText('仓库')).toHaveValue('21');
    expect(screen.getByLabelText('库位')).toHaveValue('31');

    fireEvent.click(within(issueDialog).getByRole('button', { name: '取消' }));
    fireEvent.click(within(row as HTMLTableRowElement).getByRole('button', { name: '退料回仓' }));
    expect(await screen.findByRole('dialog', { name: '退料回仓' })).toBeInTheDocument();
  });

  it('blocks issue submit when a dye-lot-managed material has no dye lot input', async () => {
    render(<TaskPage />);

    fireEvent.click(screen.getByRole('button', { name: '详情' }));
    const drawer = await screen.findByRole('dialog', { name: '任务详情' });

    fireEvent.click(within(drawer).getByRole('button', { name: '继续领料' }));
    const issueDialog = await screen.findByRole('dialog', { name: '领料到线边' });

    fireEvent.click(within(issueDialog).getByRole('button', { name: '领料到线边' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('SKU 橡木板 需要填写缸号');
    expect(mocks.issueMutateAsync).not.toHaveBeenCalled();
    expect(mocks.showToast).toHaveBeenCalledWith({
      type: 'error',
      message: 'SKU 橡木板 需要填写缸号',
    });
  });

  it('blocks return submit when a dye-lot-managed material has no dye lot input', async () => {
    render(<TaskPage />);

    fireEvent.click(screen.getByRole('button', { name: '详情' }));
    const drawer = await screen.findByRole('dialog', { name: '任务详情' });

    fireEvent.click(within(drawer).getByRole('button', { name: '退料回仓' }));
    const returnDialog = await screen.findByRole('dialog', { name: '退料回仓' });

    fireEvent.click(within(returnDialog).getByRole('button', { name: '退料回仓' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('SKU 橡木板 需要填写缸号');
    expect(mocks.returnMutateAsync).not.toHaveBeenCalled();
    expect(mocks.showToast).toHaveBeenCalledWith({
      type: 'error',
      message: 'SKU 橡木板 需要填写缸号',
    });
  });

  it('shows backend error details when complete-task submission fails', async () => {
    mocks.completeMutateAsync.mockRejectedValueOnce(new Error('任务线边库存不足：橡木板 仅有 6.0000 张，需要 12.0000 张'));

    render(<TaskPage />);

    const row = screen.getByText('TASK-001').closest('tr');
    expect(row).not.toBeNull();

    fireEvent.click(within(row as HTMLTableRowElement).getByRole('button', { name: '完成' }));
    const completeDialog = await screen.findByRole('dialog', { name: '完工上报' });

    fireEvent.change(within(completeDialog).getByLabelText(/完成件数/), { target: { value: '12' } });
    fireEvent.change(within(completeDialog).getByLabelText(/实际工时（小时）/), { target: { value: '2.5' } });
    fireEvent.click(within(completeDialog).getByRole('button', { name: '确认完成' }));

    expect(await within(completeDialog).findByRole('alert')).toHaveTextContent('任务线边库存不足：橡木板 仅有 6.0000 张，需要 12.0000 张');
    expect(mocks.showToast).toHaveBeenCalledWith({
      type: 'error',
      message: '任务线边库存不足：橡木板 仅有 6.0000 张，需要 12.0000 张',
    });
  });

  it('passes workerId when worker filter changes', () => {
    render(<TaskPage />);

    expect(mocks.useTaskList).toHaveBeenLastCalledWith(expect.objectContaining({
      workerId: undefined,
    }));

    fireEvent.change(screen.getByLabelText('工人筛选'), { target: { value: '7' } });

    expect(mocks.useTaskList).toHaveBeenLastCalledWith(expect.objectContaining({
      workerId: 7,
    }));
  });
});
