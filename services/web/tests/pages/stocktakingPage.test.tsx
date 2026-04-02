import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import StocktakingPage from '@/pages/stocktaking/StocktakingPage';

const mocks = vi.hoisted(() => ({
  useStocktakingList: vi.fn(),
  useStocktakingItems: vi.fn(),
  useCreateStocktaking: vi.fn(),
  useConfirmStocktaking: vi.fn(),
  setPageTitle: vi.fn(),
  createMutate: vi.fn(),
  confirmMutate: vi.fn(),
}));

vi.mock('@/api/stocktaking', () => ({
  useStocktakingList: mocks.useStocktakingList,
  useStocktakingItems: mocks.useStocktakingItems,
  useCreateStocktaking: mocks.useCreateStocktaking,
  useConfirmStocktaking: mocks.useConfirmStocktaking,
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
  }),
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
    mocks.useStocktakingItems.mockImplementation((taskId: number | null) => ({
      data: taskId === 11
        ? [{
            id: 101,
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

  it('应允许对 in_progress 任务显示确认按钮并触发确认', async () => {
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

    fireEvent.click(screen.getByRole('button', { name: '确认盘点任务 PD-11' }));

    await waitFor(() => {
      expect(mocks.confirmMutate).toHaveBeenCalledWith(11);
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
    expect(screen.getByText('13.0000')).toBeInTheDocument();
  });
});
