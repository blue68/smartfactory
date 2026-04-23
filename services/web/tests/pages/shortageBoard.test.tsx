import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ShortageBoard from '@/pages/production/ShortageBoard';

const mocks = vi.hoisted(() => ({
  useShortageSummary: vi.fn(),
  useSupplyChainDashboard: vi.fn(),
  useShortageReport: vi.fn(),
  useGenerateMrpSuggestions: vi.fn(),
  useJointProductionBatches: vi.fn(),
  useWarehouseOptions: vi.fn(),
  useLocationOptions: vi.fn(),
  setPageTitle: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock('@/api/mrp', () => ({
  useShortageSummary: mocks.useShortageSummary,
  useSupplyChainDashboard: mocks.useSupplyChainDashboard,
  useShortageReport: mocks.useShortageReport,
  useGenerateMrpSuggestions: mocks.useGenerateMrpSuggestions,
  useJointProductionBatches: mocks.useJointProductionBatches,
}));

vi.mock('@/api/inventory', () => ({
  useWarehouseOptions: mocks.useWarehouseOptions,
  useLocationOptions: mocks.useLocationOptions,
}));

vi.mock('@/stores/appStore', () => ({
  useAppStore: (selector: (state: { setPageTitle: typeof mocks.setPageTitle }) => unknown) =>
    selector({
      setPageTitle: mocks.setPageTitle,
    }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mocks.navigate,
  };
});

describe('ShortageBoard', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.useShortageSummary.mockReturnValue({
      data: {
        list: [
          {
            skuId: 101,
            skuCode: 'RM-101',
            skuName: '橡木板',
            stockUnit: 'm',
            totalQtyRequired: '120.0000',
            totalQtyAvailable: '40.0000',
            totalQtyInTransit: '12.0000',
            totalQtyShortage: '68.0000',
            affectedOrderCount: 2,
            affectedOrderIds: [501, 502],
          },
        ],
        total: 1,
        page: 1,
        pageSize: 200,
        totalPages: 1,
      },
      isLoading: false,
    });
    mocks.useSupplyChainDashboard.mockReturnValue({
      data: {
        pendingReceiptPOCount: 2,
        shortageOrderCount: 1,
      },
    });
    mocks.useShortageReport.mockReturnValue({
      data: {
        productionOrderId: 501,
        workOrderNo: 'WO-501',
        materialStatus: 'shortage',
        items: [
          {
            skuId: 101,
            qtyRequired: '60.0000',
            qtyAvailable: '15.0000',
            qtyShortage: '45.0000',
            hasPendingSuggestion: false,
          },
        ],
      },
      isLoading: false,
    });
    mocks.useGenerateMrpSuggestions.mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    });
    mocks.useJointProductionBatches.mockReturnValue({
      data: { list: [], total: 0, page: 1, pageSize: 100, totalPages: 0 },
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
  });

  it('passes warehouse/location query when filters are selected', async () => {
    render(<ShortageBoard />);

    fireEvent.change(screen.getByRole('combobox', { name: '仓库' }), { target: { value: '9' } });

    await waitFor(() => {
      const lastCall = mocks.useShortageSummary.mock.calls.at(-1)?.[0];
      expect(lastCall).toMatchObject({
        warehouseId: 9,
        locationId: undefined,
        onlyDefaultLocation: undefined,
      });
    });

    fireEvent.change(screen.getByRole('combobox', { name: '库位' }), { target: { value: '99' } });

    await waitFor(() => {
      const lastCall = mocks.useShortageSummary.mock.calls.at(-1)?.[0];
      expect(lastCall).toMatchObject({
        warehouseId: 9,
        locationId: 99,
        onlyDefaultLocation: undefined,
      });
    });
  });

  it('enables onlyDefaultLocation and navigates to inventory governance view', async () => {
    render(<ShortageBoard />);

    fireEvent.click(screen.getByRole('checkbox', { name: '仅默认仓位' }));

    await waitFor(() => {
      const lastCall = mocks.useShortageSummary.mock.calls.at(-1)?.[0];
      expect(lastCall).toMatchObject({
        warehouseId: 1,
        locationId: 11,
        onlyDefaultLocation: true,
      });
    });

    fireEvent.click(screen.getByRole('button', { name: '默认仓位治理' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/inventory?onlyDefaultLocation=true&warehouseId=1&locationId=11');
  });

  it('shows governance hint and allows exiting default-location mode', async () => {
    render(<ShortageBoard />);

    fireEvent.click(screen.getByRole('checkbox', { name: '仅默认仓位' }));

    expect(await screen.findByText(/默认仓位治理模式已开启/)).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '仓库' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: '库位' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: '退出治理模式' }));

    await waitFor(() => {
      const lastCall = mocks.useShortageSummary.mock.calls.at(-1)?.[0];
      expect(lastCall).toMatchObject({
        warehouseId: undefined,
        locationId: undefined,
        onlyDefaultLocation: undefined,
      });
    });
    expect(screen.queryByText(/默认仓位治理模式已开启/)).not.toBeInTheDocument();
  });

  it('治理模式下默认库位主数据晚到时应自动补绑默认库位', async () => {
    let defaultLocationReady = false;
    mocks.useLocationOptions.mockImplementation((warehouseId?: number) => {
      if (warehouseId === 1) {
        return {
          data: defaultLocationReady
            ? [
                {
                  id: 11,
                  warehouseId: 1,
                  code: 'DEFAULT-UNKNOWN',
                  name: '默认未知库位',
                  level: 1,
                  status: 'active',
                },
              ]
            : [],
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

    const { rerender } = render(<ShortageBoard />);

    fireEvent.click(screen.getByRole('checkbox', { name: '仅默认仓位' }));

    await waitFor(() => {
      const lastCall = mocks.useShortageSummary.mock.calls.at(-1)?.[0];
      expect(lastCall).toMatchObject({
        warehouseId: 1,
        locationId: undefined,
        onlyDefaultLocation: true,
      });
    });

    defaultLocationReady = true;
    rerender(<ShortageBoard />);

    await waitFor(() => {
      const lastCall = mocks.useShortageSummary.mock.calls.at(-1)?.[0];
      expect(lastCall).toMatchObject({
        warehouseId: 1,
        locationId: 11,
        onlyDefaultLocation: true,
      });
    });
  });

  it('退出治理模式时应恢复进入前的仓库与库位筛选', async () => {
    render(<ShortageBoard />);

    fireEvent.change(screen.getByRole('combobox', { name: '仓库' }), { target: { value: '9' } });

    await waitFor(() => {
      const lastCall = mocks.useShortageSummary.mock.calls.at(-1)?.[0];
      expect(lastCall).toMatchObject({
        warehouseId: 9,
        locationId: undefined,
        onlyDefaultLocation: undefined,
      });
    });

    fireEvent.change(screen.getByRole('combobox', { name: '库位' }), { target: { value: '99' } });

    await waitFor(() => {
      const lastCall = mocks.useShortageSummary.mock.calls.at(-1)?.[0];
      expect(lastCall).toMatchObject({
        warehouseId: 9,
        locationId: 99,
        onlyDefaultLocation: undefined,
      });
    });

    fireEvent.click(screen.getByRole('checkbox', { name: '仅默认仓位' }));

    await waitFor(() => {
      const lastCall = mocks.useShortageSummary.mock.calls.at(-1)?.[0];
      expect(lastCall).toMatchObject({
        warehouseId: 1,
        locationId: 11,
        onlyDefaultLocation: true,
      });
    });

    fireEvent.click(screen.getByRole('button', { name: '退出治理模式' }));

    await waitFor(() => {
      const lastCall = mocks.useShortageSummary.mock.calls.at(-1)?.[0];
      expect(lastCall).toMatchObject({
        warehouseId: 9,
        locationId: 99,
        onlyDefaultLocation: undefined,
      });
    });
  });
});
