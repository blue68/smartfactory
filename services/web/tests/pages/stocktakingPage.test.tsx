import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import StocktakingPage from '@/pages/stocktaking/StocktakingPage';

const mocks = vi.hoisted(() => ({
  useStocktakingList: vi.fn(),
  useStocktakingItems: vi.fn(),
  useCreateStocktaking: vi.fn(),
  useSubmitStocktaking: vi.fn(),
  useConfirmStocktaking: vi.fn(),
  useCreateStocktakingAdjustmentOrder: vi.fn(),
  useUpdateStocktakingItems: vi.fn(),
  useWarehouseOptions: vi.fn(),
  useLocationOptions: vi.fn(),
  setPageTitle: vi.fn(),
  showToast: vi.fn(),
  createMutate: vi.fn(),
  submitMutate: vi.fn(),
  confirmMutate: vi.fn(),
  createAdjustmentMutate: vi.fn(),
  updateItemsMutate: vi.fn(),
}));

vi.mock('@/api/stocktaking', () => ({
  useStocktakingList: mocks.useStocktakingList,
  useStocktakingItems: mocks.useStocktakingItems,
  useCreateStocktaking: mocks.useCreateStocktaking,
  useSubmitStocktaking: mocks.useSubmitStocktaking,
  useConfirmStocktaking: mocks.useConfirmStocktaking,
  useCreateStocktakingAdjustmentOrder: mocks.useCreateStocktakingAdjustmentOrder,
  useUpdateStocktakingItems: mocks.useUpdateStocktakingItems,
  StocktakingStatusLabel: {
    draft: '草稿',
    in_progress: '盘点中',
    pending_confirm: '待确认',
    confirmed: '已确认',
    cancelled: '已取消',
  },
  StocktakingScopeLabel: {
    all: '全库盘点',
    category: '按品类盘点',
    location: '按库位盘点',
  },
}));

vi.mock('@/stores/appStore', () => ({
  useAppStore: () => ({
    setPageTitle: mocks.setPageTitle,
    showToast: mocks.showToast,
  }),
}));

vi.mock('@/api/inventory', () => ({
  useWarehouseOptions: mocks.useWarehouseOptions,
  useLocationOptions: mocks.useLocationOptions,
}));

describe('StocktakingPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useCreateStocktaking.mockReturnValue({
      mutate: mocks.createMutate,
      isPending: false,
    });
    mocks.useConfirmStocktaking.mockReturnValue({
      mutate: mocks.confirmMutate,
      isPending: false,
    });
    mocks.useSubmitStocktaking.mockReturnValue({
      mutate: mocks.submitMutate,
      isPending: false,
    });
    mocks.useCreateStocktakingAdjustmentOrder.mockReturnValue({
      mutate: mocks.createAdjustmentMutate,
      isPending: false,
    });
    mocks.useUpdateStocktakingItems.mockReturnValue({
      mutate: mocks.updateItemsMutate,
      isPending: false,
    });
    mocks.useWarehouseOptions.mockReturnValue({
      data: [{ id: 1, code: 'DEFAULT', name: '默认仓库' }],
      isLoading: false,
    });
    mocks.useLocationOptions.mockReturnValue({
      data: [{ id: 2, warehouseId: 1, code: 'DEFAULT-UNKNOWN', name: '默认未知库位' }],
      isLoading: false,
    });
    mocks.useStocktakingItems.mockImplementation((taskId: number | null) => ({
      data: taskId === 11
        ? [{
            id: 101,
            skuId: 11,
            skuCode: 'STK-11',
            skuName: '盘点物料 11',
            stockUnit: 'pcs',
            systemQty: '10.0000',
            actualQty: '13.0000',
            diffQty: '3.0000',
          }]
        : [],
      isLoading: false,
    }));
  });

  it('应允许对 in_progress 任务提交确认', async () => {
    mocks.useStocktakingList.mockReturnValue({
      data: {
        list: [{
          id: 11,
          taskNo: 'PD-11',
          scope: 'all',
          status: 'in_progress',
          totalItems: 1,
          diffItems: 0,
          createdAt: '2026-04-02T10:00:00.000Z',
        }],
        total: 1,
        page: 1,
        pageSize: 20,
      },
      isLoading: false,
      error: null,
    });

    render(<StocktakingPage />);

    fireEvent.click(screen.getByRole('button', { name: '提交盘点任务 PD-11' }));

    await waitFor(() => {
      expect(mocks.submitMutate).toHaveBeenCalledWith(11, expect.any(Object));
    });
  });

  it('应允许对 pending_confirm 任务触发一键调整单入账', async () => {
    mocks.useStocktakingList.mockReturnValue({
      data: {
        list: [{
          id: 12,
          taskNo: 'PD-12',
          scope: 'all',
          status: 'pending_confirm',
          totalItems: 1,
          diffItems: 1,
          createdAt: '2026-04-02T10:00:00.000Z',
        }],
        total: 1,
        page: 1,
        pageSize: 20,
      },
      isLoading: false,
      error: null,
    });

    render(<StocktakingPage />);

    fireEvent.click(screen.getByRole('button', { name: '生成盘点差异调整单 PD-12' }));

    await waitFor(() => {
      expect(mocks.createAdjustmentMutate).toHaveBeenCalledWith({
        taskId: 12,
        payload: { execute: true },
      }, expect.any(Object));
    });
  });

  it('应允许对 pending_confirm 任务触发确认', async () => {
    mocks.useStocktakingList.mockReturnValue({
      data: {
        list: [{
          id: 13,
          taskNo: 'PD-13',
          scope: 'all',
          status: 'pending_confirm',
          totalItems: 1,
          diffItems: 0,
          createdAt: '2026-04-02T10:00:00.000Z',
        }],
        total: 1,
        page: 1,
        pageSize: 20,
      },
      isLoading: false,
      error: null,
    });

    render(<StocktakingPage />);

    fireEvent.click(screen.getByRole('button', { name: '确认盘点任务 PD-13' }));

    await waitFor(() => {
      expect(mocks.confirmMutate).toHaveBeenCalledWith(13, expect.any(Object));
    });
  });

  it('展开明细时应渲染盘点物料明细', async () => {
    mocks.useStocktakingList.mockReturnValue({
      data: {
        list: [{
          id: 11,
          taskNo: 'PD-11',
          scope: 'all',
          status: 'draft',
          totalItems: 1,
          diffItems: 0,
          createdAt: '2026-04-02T10:00:00.000Z',
        }],
        total: 1,
        page: 1,
        pageSize: 20,
      },
      isLoading: false,
      error: null,
    });

    render(<StocktakingPage />);

    fireEvent.click(screen.getByRole('button', { name: '查看盘点明细' }));

    expect(await screen.findByText('盘点明细')).toBeInTheDocument();
    expect(screen.getByText('STK-11')).toBeInTheDocument();
    expect(screen.getByText('盘点物料 11')).toBeInTheDocument();
    expect(screen.getByDisplayValue('13.0000')).toBeInTheDocument();
  });

  it('保存实盘数量应触发更新并显示成功提示', async () => {
    mocks.useStocktakingList.mockReturnValue({
      data: {
        list: [{
          id: 11,
          taskNo: 'PD-11',
          scope: 'all',
          status: 'draft',
          totalItems: 1,
          diffItems: 0,
          createdAt: '2026-04-02T10:00:00.000Z',
        }],
        total: 1,
        page: 1,
        pageSize: 20,
      },
      isLoading: false,
      error: null,
    });
    mocks.updateItemsMutate.mockImplementation((_payload, options) => {
      options?.onSuccess?.({ updatedCount: 1 });
    });

    render(<StocktakingPage />);

    fireEvent.click(screen.getByRole('button', { name: '查看盘点明细' }));
    fireEvent.change(await screen.findByDisplayValue('13.0000'), { target: { value: '15' } });
    fireEvent.click(screen.getByRole('button', { name: '保存实盘数量' }));

    await waitFor(() => {
      expect(mocks.updateItemsMutate).toHaveBeenCalledWith(
        { items: [{ skuId: 11, actualQty: '15' }] },
        expect.any(Object),
      );
    });
    expect(screen.getByText('实盘数量已保存（1 条）')).toBeInTheDocument();
  });
});
