import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import ProductionOrderPage from '@/pages/production/ProductionOrderPage';

const mocks = vi.hoisted(() => ({
  useProductionOrderList: vi.fn(),
  useProductionOrderDetail: vi.fn(),
  useProductionOrderComponents: vi.fn(),
  useProductionOrderOperations: vi.fn(),
  useProductionBatchList: vi.fn(),
  useCreateFromSalesOrder: vi.fn(),
  useMaterialRequirements: vi.fn(),
  useCancelOrder: vi.fn(),
  useShortageSummary: vi.fn(),
  useGenerateMrpSuggestions: vi.fn(),
  fetchSalesOrders: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock('@/api/production', () => ({
  useProductionOrderList: mocks.useProductionOrderList,
  useProductionOrderDetail: mocks.useProductionOrderDetail,
  useProductionOrderComponents: mocks.useProductionOrderComponents,
  useProductionOrderOperations: mocks.useProductionOrderOperations,
  useProductionBatchList: mocks.useProductionBatchList,
  useCreateFromSalesOrder: mocks.useCreateFromSalesOrder,
  useMaterialRequirements: mocks.useMaterialRequirements,
  useCancelOrder: mocks.useCancelOrder,
}));

vi.mock('@/api/salesOrder', () => ({
  fetchSalesOrders: mocks.fetchSalesOrders,
}));

vi.mock('@/api/mrp', () => ({
  useShortageSummary: mocks.useShortageSummary,
  useGenerateMrpSuggestions: mocks.useGenerateMrpSuggestions,
}));

vi.mock('@/stores/appStore', () => ({
  useAppStore: () => ({
    showToast: mocks.showToast,
  }),
}));

describe('ProductionOrderPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.useProductionOrderList.mockImplementation((params?: { status?: string }) => {
      if (params?.status === 'in_progress') {
        return { data: { list: [], total: 1, page: 1, pageSize: 1, totalPages: 1 }, isLoading: false };
      }
      return {
        data: {
          list: [{
            id: 1,
            workOrderNo: 'WO-001',
            salesOrderNo: 'SO-001',
            skuName: '主柜体',
            qtyPlanned: '12',
            qtyCompleted: '6',
            status: 'in_progress',
            plannedStart: '2026-04-01',
            plannedEnd: '2026-04-05',
            progressPct: 50,
            materialStatus: 'ready',
          }],
          total: 1,
          page: 1,
          pageSize: 20,
          totalPages: 1,
        },
        isLoading: false,
      };
    });

    mocks.useProductionOrderDetail.mockImplementation((id: number | null) => ({
      data: id === 1 ? {
        id: 1,
        workOrderNo: 'WO-001',
        salesOrderNo: 'SO-001',
        skuName: '主柜体',
        qtyPlanned: '12',
        qtyCompleted: '6',
        status: 'in_progress',
        plannedStart: '2026-04-01',
        plannedEnd: '2026-04-05',
        progressPct: 50,
        materialStatus: 'ready',
        tasks: [
          { id: 201, taskNo: 'TASK-201', operationId: 301, status: 'started' },
        ],
      } : undefined,
    }));

    mocks.useProductionOrderComponents.mockImplementation((id: number | null) => ({
      data: id === 1 ? [
        {
          id: 11,
          parentComponentId: null,
          skuId: 501,
          skuName: '半成品框架',
          resolvedSkuId: 601,
          resolvedSkuName: '替代半成品框架',
          componentType: 'wip',
          qtyRequired: '12.0000',
          bomLevel: 1,
          bomPath: '1',
        },
      ] : [],
    }));

    mocks.useProductionOrderOperations.mockImplementation((id: number | null) => ({
      data: id === 1 ? [
        {
          id: 301,
          componentId: 11,
          componentType: 'wip',
          processStepId: 21,
          stepNo: 1,
          stepName: '开料',
          outputSkuId: 601,
          outputSkuName: '替代半成品框架',
          plannedQty: '12.0000',
          completedQty: '6.0000',
          status: 'started',
        },
      ] : [],
    }));

    mocks.useMaterialRequirements.mockReturnValue({ data: [] });
    mocks.useProductionBatchList.mockReturnValue({ data: { list: [], total: 0 } });
    mocks.useCreateFromSalesOrder.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
    mocks.useCancelOrder.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
    mocks.useShortageSummary.mockReturnValue({ data: [] });
    mocks.useGenerateMrpSuggestions.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
  });

  it('opens drawer and renders structure snapshot and operation lane tabs', async () => {
    render(<ProductionOrderPage />);

    fireEvent.click(screen.getByRole('button', { name: '查看详情' }));

    expect(await screen.findByRole('dialog', { name: 'WO-001' })).toBeInTheDocument();
    expect(screen.getByText('冻结结构 1 节点')).toBeInTheDocument();
    expect(screen.getByText('工序链 1 道')).toBeInTheDocument();

    fireEvent.click(screen.getByText('结构快照'));
    expect(screen.getByText('冻结结构快照')).toBeInTheDocument();
    expect(screen.getByText('通配解析：半成品框架 → 替代半成品框架')).toBeInTheDocument();

    fireEvent.click(screen.getByText('工序链路'));
    expect(screen.getByText('半成品工序链路')).toBeInTheDocument();
    expect(screen.getByText('产出 替代半成品框架')).toBeInTheDocument();
    expect(screen.getByText('TASK-201')).toBeInTheDocument();
  });
});
