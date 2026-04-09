import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import InventoryPage from '@/pages/inventory/InventoryPage';

const mocks = vi.hoisted(() => ({
  useInventoryList: vi.fn(),
  useInventorySummary: vi.fn(),
  useInventoryTransactions: vi.fn(),
  useInventoryDailySnapshots: vi.fn(),
  useDyeLots: vi.fn(),
  useInbound: vi.fn(),
  useWarehouseOptions: vi.fn(),
  useLocationOptions: vi.fn(),
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
  useWarehouseOptions: mocks.useWarehouseOptions,
  useLocationOptions: mocks.useLocationOptions,
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

function renderPage(initialEntry = '/inventory') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <InventoryPage />
    </MemoryRouter>,
  );
}

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
      isPending: false,
    });
    mocks.useWarehouseOptions.mockReturnValue({
      data: [
        { id: 1, code: 'DEFAULT', name: '默认仓库', type: 'virtual', status: 'active' },
        { id: 9, code: 'WH-A', name: 'A仓', type: 'normal', status: 'active' },
      ],
    });
    mocks.useLocationOptions.mockImplementation((warehouseId?: number) => {
      if (warehouseId === 1) {
        return {
          data: [
            { id: 11, warehouseId: 1, code: 'DEFAULT-UNKNOWN', name: '默认未知库位', level: 1, status: 'active' },
          ],
        };
      }
      if (warehouseId === 9) {
        return {
          data: [
            { id: 99, warehouseId: 9, code: 'A-01', name: 'A-01', level: 1, status: 'active' },
          ],
        };
      }
      return { data: [] };
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
    renderPage();

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
    renderPage();

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
    renderPage();

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

    renderPage();

    expect(screen.getByText('正在加载日结快照…')).toBeInTheDocument();
  });

  it('日结快照错误态应显示错误文案', async () => {
    mocks.useInventoryDailySnapshots.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('boom'),
    });

    renderPage();

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

    renderPage();

    expect(screen.getByText('当前日期暂无日结快照')).toBeInTheDocument();
  });

  it('从日结快照点击追溯后应打开库存追溯抽屉', async () => {
    renderPage();

    const snapshotRegion = screen.getByRole('region', { name: '日结库存快照' });
    fireEvent.click(within(snapshotRegion).getByRole('button', { name: '追溯' }));

    expect(await screen.findByRole('dialog', { name: '库存追溯 — 坯布 11' })).toBeInTheDocument();
    expect(screen.getByText('TX-901')).toBeInTheDocument();

    await waitFor(() => {
      const lastCall = mocks.useInventoryTransactions.mock.calls.at(-1);
      expect(lastCall?.[0]).toBe(11);
    });
  });

  it('库存列表行内入库应按 skuCode 提交', async () => {
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
            warehouseId: 1,
            locationId: 11,
            warehouseCode: 'DEFAULT',
            locationCode: 'DEFAULT-UNKNOWN',
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

    renderPage();

    fireEvent.click(screen.getByRole('button', { name: '入库' }));
    fireEvent.change(screen.getByPlaceholderText('请输入入库数量'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: '确认入库' }));

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
        skuCode: 'FAB-11',
        qtyInput: '5',
      }));
    });
  });

  it('手动入库未选择仓库库位时应允许提交并显示默认库位提示', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({
      transactionNo: 'IN-001',
      newQtyOnHand: '8.0000',
      warehouseId: 1,
      locationId: 11,
      warningCode: 'INV_FALLBACK_DEFAULT_LOCATION',
    });
    mocks.useInbound.mockReturnValue({
      mutateAsync,
      reset: vi.fn(),
      isPending: false,
    });

    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /手动入库/ }));
    fireEvent.change(screen.getByPlaceholderText('请输入物料 SKU 编码'), { target: { value: 'SKU-11' } });
    fireEvent.change(screen.getByPlaceholderText('请输入入库数量'), { target: { value: '8' } });
    fireEvent.change(screen.getByPlaceholderText('如：平方米、kg、个'), { target: { value: 'm' } });
    fireEvent.click(screen.getByRole('button', { name: '确认入库' }));

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledTimes(1);
    });

    const payload = mutateAsync.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload).toMatchObject({
      skuCode: 'SKU-11',
      qtyInput: '8',
      inputUnit: 'm',
    });
    expect(payload).not.toHaveProperty('warehouseId');
    expect(payload).not.toHaveProperty('locationId');

    expect(await screen.findByText('未命中有效库位，已自动落到默认库位 DEFAULT-UNKNOWN')).toBeInTheDocument();
  });

  it('默认仓位治理模式应自动锁定默认仓位并支持退出', async () => {
    renderPage('/inventory?onlyDefaultLocation=true');

    await waitFor(() => {
      const query = mocks.useInventoryList.mock.calls.at(-1)?.[0];
      expect(query).toMatchObject({
        onlyDefaultLocation: true,
        warehouseId: 1,
        locationId: 11,
      });
    });

    expect(screen.getByText(/默认仓位治理模式已开启/)).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '筛选仓库' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: '筛选库位' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: '退出治理模式' }));

    await waitFor(() => {
      const query = mocks.useInventoryList.mock.calls.at(-1)?.[0];
      expect(query?.onlyDefaultLocation).toBeUndefined();
      expect(query?.warehouseId).toBeUndefined();
      expect(query?.locationId).toBeUndefined();
    });
    expect(screen.queryByText(/默认仓位治理模式已开启/)).not.toBeInTheDocument();
  });

  it('勾选仅看默认仓位时应自动带上默认仓位筛选参数', async () => {
    renderPage();

    fireEvent.click(screen.getByRole('checkbox', { name: '仅看默认仓位' }));

    await waitFor(() => {
      const query = mocks.useInventoryList.mock.calls.at(-1)?.[0];
      expect(query).toMatchObject({
        onlyDefaultLocation: true,
        warehouseId: 1,
        locationId: 11,
      });
    });
  });

  it('退出治理模式时应恢复进入前的仓库与库位筛选', async () => {
    renderPage();

    fireEvent.change(screen.getByRole('combobox', { name: '筛选仓库' }), { target: { value: '9' } });

    await waitFor(() => {
      const query = mocks.useInventoryList.mock.calls.at(-1)?.[0];
      expect(query).toMatchObject({
        warehouseId: 9,
        locationId: undefined,
        onlyDefaultLocation: undefined,
      });
    });

    fireEvent.change(screen.getByRole('combobox', { name: '筛选库位' }), { target: { value: '99' } });

    await waitFor(() => {
      const query = mocks.useInventoryList.mock.calls.at(-1)?.[0];
      expect(query).toMatchObject({
        warehouseId: 9,
        locationId: 99,
        onlyDefaultLocation: undefined,
      });
    });

    fireEvent.click(screen.getByRole('checkbox', { name: '仅看默认仓位' }));

    await waitFor(() => {
      const query = mocks.useInventoryList.mock.calls.at(-1)?.[0];
      expect(query).toMatchObject({
        warehouseId: 1,
        locationId: 11,
        onlyDefaultLocation: true,
      });
    });

    fireEvent.click(screen.getByRole('button', { name: '退出治理模式' }));

    await waitFor(() => {
      const query = mocks.useInventoryList.mock.calls.at(-1)?.[0];
      expect(query).toMatchObject({
        warehouseId: 9,
        locationId: 99,
        onlyDefaultLocation: undefined,
      });
    });
  });

  it('点击重置筛选后应清空分类筛选值', async () => {
    mocks.useSkuCategories.mockReturnValue({
      data: [
        { id: 101, name: '原材料', level: 1 },
      ],
    });

    renderPage();

    const categorySelect = screen.getByRole('combobox', { name: '筛选物料分类' }) as HTMLSelectElement;
    fireEvent.change(categorySelect, { target: { value: '101' } });

    await waitFor(() => {
      const query = mocks.useInventoryList.mock.calls.at(-1)?.[0];
      expect(query?.category1Id).toBe(101);
    });

    fireEvent.click(screen.getByRole('button', { name: '重置库存筛选' }));

    await waitFor(() => {
      const query = mocks.useInventoryList.mock.calls.at(-1)?.[0];
      expect(query?.category1Id).toBeUndefined();
    });
    expect(categorySelect.value).toBe('');
  });

  it('切换按采购单位后应按换算系数展示库存量和安全库存', async () => {
    mocks.useInventoryList.mockReturnValue({
      data: {
        list: [
          {
            skuId: 2101,
            skuCode: 'FAB-2101',
            skuName: '单位换算测试物料',
            stockUnit: '米',
            purchaseUnit: '卷',
            stockConvFactor: 50,
            qtyOnHand: '100.0000',
            qtyReserved: '0.0000',
            qtyInTransit: '0.0000',
            qtyAvailable: '100.0000',
            safetyStock: '50.0000',
            isBelowSafety: false,
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

    renderPage();

    expect(screen.getByText('50 米')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '按采购单位' }));

    expect(screen.getByText('1 卷')).toBeInTheDocument();
  });

  it('呆滞库存点击 AI降库建议 应打开建议抽屉', async () => {
    mocks.useInventoryList.mockReturnValue({
      data: {
        list: [
          {
            skuId: 2001,
            skuCode: 'STG-2001',
            skuName: '呆滞测试物料',
            stockUnit: '米',
            qtyOnHand: '1000.0000',
            qtyReserved: '0.0000',
            qtyInTransit: '0.0000',
            qtyAvailable: '1000.0000',
            safetyStock: '10.0000',
            isBelowSafety: false,
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

    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'AI降库建议' }));

    expect(await screen.findByText('呆滞库存处置建议')).toBeInTheDocument();
    expect(screen.getByText('查看库存追溯')).toBeInTheDocument();
  });

  it('缸号批次点击 查看用途 应打开追溯并带缸号关键词', async () => {
    mocks.useInventoryList.mockReturnValue({
      data: {
        list: [
          {
            skuId: 3001,
            skuCode: 'FAB-3001',
            skuName: '缸号物料',
            stockUnit: '米',
            qtyOnHand: '120.0000',
            qtyReserved: '0.0000',
            qtyInTransit: '0.0000',
            qtyAvailable: '120.0000',
            safetyStock: '40.0000',
            isBelowSafety: false,
            hasDyeLot: true,
            warehouseId: 1,
            locationId: 11,
            warehouseCode: 'DEFAULT',
            locationCode: 'DEFAULT-UNKNOWN',
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
    mocks.useDyeLots.mockReturnValue({
      data: [
        {
          dyeLotNo: 'LOT-001',
          firstInAt: '2026-04-07',
          lastInAt: '2026-04-07',
          qtyOnHand: '80.0000',
          qtyReserved: '0.0000',
          qtyAvailable: '80.0000',
        },
      ],
      isLoading: false,
    });

    renderPage();

    fireEvent.click(screen.getByRole('button', { name: '查看缸号明细' }));
    fireEvent.click(screen.getByRole('button', { name: '查看用途' }));

    expect(await screen.findByRole('dialog', { name: '库存追溯 — 缸号物料' })).toBeInTheDocument();
    await waitFor(() => {
      const lastCall = mocks.useInventoryTransactions.mock.calls.at(-1);
      expect(lastCall?.[0]).toBe(3001);
      expect(lastCall?.[1]).toMatchObject({ keyword: 'LOT-001' });
    });
  });

  it('缸号批次明细的剩余库存应显示当前 SKU 的库存单位', async () => {
    mocks.useInventoryList.mockReturnValue({
      data: {
        list: [
          {
            skuId: 3002,
            skuCode: 'RM-00058',
            skuName: '棉麻混纺（本白）',
            stockUnit: 'm',
            qtyOnHand: '5003.0000',
            qtyReserved: '0.0000',
            qtyInTransit: '0.0000',
            qtyAvailable: '5003.0000',
            safetyStock: '30.0000',
            isBelowSafety: false,
            hasDyeLot: true,
            warehouseId: 1,
            locationId: 11,
            warehouseCode: 'DEFAULT',
            locationCode: 'DEFAULT-UNKNOWN',
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
    mocks.useDyeLots.mockReturnValue({
      data: [
        {
          dyeLotNo: '11111',
          firstInAt: '2026-04-10',
          lastInAt: '2026-04-10',
          qtyOnHand: '2000.0000',
          qtyReserved: '0.0000',
          qtyAvailable: '2000.0000',
        },
      ],
      isLoading: false,
    });

    renderPage();

    fireEvent.click(screen.getByRole('button', { name: '查看缸号明细' }));

    const table = await screen.findByRole('table', { name: '缸号批次详情' });
    const lotRow = within(table).getByText('11111').closest('tr');
    expect(lotRow).not.toBeNull();
    expect(within(lotRow as HTMLElement).getByText('2000.0000')).toBeInTheDocument();
    expect(within(lotRow as HTMLElement).getByText(/\bm\b/)).toBeInTheDocument();
    expect(screen.queryByText('平方米')).not.toBeInTheDocument();
  });
});
