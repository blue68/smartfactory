import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import InventoryPage from '@/pages/inventory/InventoryPage';

const mocks = vi.hoisted(() => ({
  useInventoryList: vi.fn(),
  useInventorySummary: vi.fn(),
  useInventoryTransactions: vi.fn(),
  useInventoryDailySnapshots: vi.fn(),
  useDyeLots: vi.fn(),
  useInbound: vi.fn(),
  useSkuCategories: vi.fn(),
  exportCsv: vi.fn(),
  setPageTitle: vi.fn(),
}));

vi.mock('@/api/inventory', () => ({
  useInventoryList: mocks.useInventoryList,
  useInventorySummary: mocks.useInventorySummary,
  useInventoryTransactions: mocks.useInventoryTransactions,
  useInventoryDailySnapshots: mocks.useInventoryDailySnapshots,
  useDyeLots: mocks.useDyeLots,
  useInbound: mocks.useInbound,
  inventoryApi: {
    exportCsv: mocks.exportCsv,
  },
}));

vi.mock('@/api/sku', () => ({
  useSkuCategories: mocks.useSkuCategories,
}));

vi.mock('@/stores/appStore', () => ({
  useAppStore: () => ({
    setPageTitle: mocks.setPageTitle,
  }),
}));

describe('InventoryPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.useSkuCategories.mockReturnValue({ data: [] });
    mocks.useInventoryList.mockReturnValue({
      data: {
        list: [],
        total: 0,
        page: 1,
        pageSize: 20,
        totalPages: 0,
      },
      isLoading: false,
      error: null,
    });
    mocks.useInventorySummary.mockReturnValue({
      data: {
        categories: [
          { categoryId: 1, categoryName: '原材料', totalQty: 120, skuCount: 2, alertCount: 1 },
          { categoryId: 2, categoryName: '半成品', totalQty: 48, skuCount: 1, alertCount: 0 },
          { categoryId: 3, categoryName: '成品', totalQty: 24, skuCount: 1, alertCount: 0 },
        ],
        totalSkuCount: 4,
        totalAlertCount: 1,
      },
    });
    mocks.useDyeLots.mockReturnValue({ data: [], isLoading: false });
    mocks.useInbound.mockReturnValue({
      mutateAsync: vi.fn(),
      reset: vi.fn(),
    });
    mocks.useInventoryTransactions.mockImplementation((skuId: number | null) => ({
      data: skuId === 11 ? {
        skuId: 11,
        skuCode: 'SKU-11',
        skuName: '坯布 11',
        stockUnit: 'm',
        list: [
          {
            transactionId: 901,
            transactionNo: 'TX-901',
            transactionType: 'PRODUCTION_IN',
            direction: 'IN',
            qtyChange: '12.0000',
            createdAt: '2026-04-01 09:30:00',
            referenceType: 'production',
            referenceId: 301,
            referenceNo: 'WO-301',
            taskId: 88,
            workOrderNo: 'WO-301',
            processStepName: '裁剪',
            workerName: '张三',
            notes: '首工序入库',
          },
        ],
        total: 1,
        page: 1,
        pageSize: 6,
        totalPages: 1,
      } : undefined,
      isLoading: false,
      error: null,
    }));
    mocks.useInventoryDailySnapshots.mockImplementation((query: { page?: number; pageSize?: number }) => ({
      data: {
        list: [
          {
            snapshotDate: '2026-04-01',
            skuId: 11,
            skuCode: 'SKU-11',
            skuName: '坯布 11',
            stockUnit: 'm',
            qtyOnHand: '100.0000',
            qtyReserved: '10.0000',
            qtyAvailable: '90.0000',
          },
        ],
        total: 12,
        page: query.page ?? 1,
        pageSize: query.pageSize ?? 5,
        totalPages: 3,
        snapshotDate: '2026-04-01',
      },
      isLoading: false,
      error: null,
    }));
  });

  it('日结快照应显示日期标题并支持独立分页', async () => {
    render(<InventoryPage />);

    expect(screen.getByText('日结库存快照（2026-04-01）')).toBeInTheDocument();
    expect(screen.getByText('2 SKU')).toBeInTheDocument();

    const snapshotRegion = screen.getByRole('region', { name: '日结库存快照' });
    fireEvent.click(within(snapshotRegion).getByRole('button', { name: '下一页' }));

    await waitFor(() => {
      const calls = mocks.useInventoryDailySnapshots.mock.calls;
      const lastArg = calls[calls.length - 1][0] as { page?: number };
      expect(lastArg.page).toBe(2);
    });
  });

  it('快照关键词筛选应输入与查询分离', async () => {
    render(<InventoryPage />);

    const searchInput = screen.getByLabelText('筛选日结快照') as HTMLInputElement;
    fireEvent.change(searchInput, { target: { value: 'SKU-11' } });

    const callsBeforeApply = mocks.useInventoryDailySnapshots.mock.calls;
    const lastBeforeApply = callsBeforeApply[callsBeforeApply.length - 1][0] as {
      keyword?: string;
    };
    expect(lastBeforeApply.keyword).toBeUndefined();

    fireEvent.click(screen.getByRole('button', { name: '查询' }));

    await waitFor(() => {
      const callsAfterApply = mocks.useInventoryDailySnapshots.mock.calls;
      const lastAfterApply = callsAfterApply[callsAfterApply.length - 1][0] as {
        keyword?: string;
      };
      expect(lastAfterApply.keyword).toBe('SKU-11');
    });
  });

  it('快照关键词按 Enter 时应触发查询，清空后恢复未筛选状态', async () => {
    render(<InventoryPage />);

    const searchInput = screen.getByLabelText('筛选日结快照') as HTMLInputElement;
    fireEvent.change(searchInput, { target: { value: 'SKU-22' } });
    fireEvent.keyDown(searchInput, { key: 'Enter', code: 'Enter' });

    await waitFor(() => {
      const callsAfterEnter = mocks.useInventoryDailySnapshots.mock.calls;
      const lastAfterEnter = callsAfterEnter[callsAfterEnter.length - 1][0] as {
        keyword?: string;
      };
      expect(lastAfterEnter.keyword).toBe('SKU-22');
    });

    fireEvent.click(screen.getByRole('button', { name: '清空' }));

    await waitFor(() => {
      const callsAfterClear = mocks.useInventoryDailySnapshots.mock.calls;
      const lastAfterClear = callsAfterClear[callsAfterClear.length - 1][0] as {
        keyword?: string;
      };
      expect(lastAfterClear.keyword).toBeUndefined();
    });
  });

  it('日结快照加载中时应显示加载文案', async () => {
    mocks.useInventoryDailySnapshots.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    });

    render(<InventoryPage />);

    expect(screen.getByText('正在加载日结快照…')).toBeInTheDocument();
  });

  it('日结快照错误态应显示错误文案', async () => {
    mocks.useInventoryDailySnapshots.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('boom'),
    });

    render(<InventoryPage />);

    expect(screen.getByText('日结快照加载失败')).toBeInTheDocument();
  });

  it('日结快照空态应显示“当前日期暂无日结快照”', async () => {
    mocks.useInventoryDailySnapshots.mockReturnValue({
      data: {
        list: [],
        total: 0,
        page: 1,
        pageSize: 5,
        totalPages: 0,
        snapshotDate: '2026-04-01',
      },
      isLoading: false,
      error: null,
    });

    render(<InventoryPage />);

    expect(screen.getByText('当前日期暂无日结快照')).toBeInTheDocument();
  });

  it('从日结快照点击追溯后应打开库存追溯抽屉', async () => {
    render(<InventoryPage />);

    const snapshotRegion = screen.getByRole('region', { name: '日结库存快照' });
    fireEvent.click(within(snapshotRegion).getByRole('button', { name: '追溯' }));

    expect(await screen.findByRole('dialog', { name: '库存追溯 — 坯布 11' })).toBeInTheDocument();
    expect(screen.getByText('TX-901')).toBeInTheDocument();

    await waitFor(() => {
      const lastCall = mocks.useInventoryTransactions.mock.calls.at(-1);
      expect(lastCall?.[0]).toBe(11);
    });
  });

  it('库存列表返回字符串 skuId 时仍应以数字提交入库', async () => {
    const mutateAsync = vi.fn().mockResolvedValue(undefined);
    mocks.useInbound.mockReturnValue({
      mutateAsync,
      reset: vi.fn(),
      isPending: false,
    });
    mocks.useInventoryList.mockReturnValue({
      data: {
        list: [
          {
            skuId: '11',
            skuCode: 'FAB-11',
            skuName: '坯布 11',
            stockUnit: 'm',
            purchaseUnit: 'm',
            qtyOnHand: '12.0000',
            qtyReserved: '2.0000',
            qtyInTransit: '0.0000',
            qtyAvailable: '10.0000',
            safetyStock: '20.0000',
            isBelowSafety: true,
            hasDyeLot: false,
          },
        ],
        total: 1,
        page: 1,
        pageSize: 20,
        totalPages: 1,
      },
      isLoading: false,
      error: null,
    });

    render(<InventoryPage />);

    fireEvent.click(screen.getByRole('button', { name: '入库' }));
    fireEvent.change(screen.getByPlaceholderText('请输入入库数量'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: '确认入库' }));

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
        skuId: 11,
        qtyInput: '5',
      }));
    });
  });
});
