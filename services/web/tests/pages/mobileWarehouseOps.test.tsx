import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import MobileWarehouseOps from '@/pages/mobile/MobileWarehouseOps';

const mocks = vi.hoisted(() => ({
  showToast: vi.fn(),
  updateMutateAsync: vi.fn(),
  submitMutateAsync: vi.fn(),
}));

vi.mock('qr-scanner', () => ({
  default: vi.fn(),
}));

vi.mock('@/stores/appStore', () => ({
  useAppStore: (selector: (state: { showToast: typeof mocks.showToast }) => unknown) =>
    selector({ showToast: mocks.showToast }),
}));

vi.mock('@/api/inventory', () => ({
  useWarehouseOptions: vi.fn(() => ({ data: [] })),
  useLocationOptions: vi.fn(() => ({ data: [] })),
  inventoryApi: {
    createTransaction: vi.fn(),
  },
}));

vi.mock('@/api/sku', () => ({
  useSkuList: vi.fn(() => ({ data: { list: [] } })),
}));

vi.mock('@/api/purchase', () => ({
  usePurchaseDeliveryList: vi.fn(() => ({ data: { list: [] } })),
  usePurchaseReceiptList: vi.fn(() => ({ data: { list: [] } })),
}));

vi.mock('@/api/stocktaking', () => ({
  useStocktakingList: vi.fn(() => ({ data: { list: [] } })),
  useStocktakingDetail: vi.fn(() => ({
    data: {
      task: {
        id: 7,
        taskNo: 'STK-007',
        scope: 'all',
        status: 'in_progress',
        totalItems: 12,
      },
      items: Array.from({ length: 12 }, (_, index) => ({
        id: index + 1,
        taskId: 7,
        skuId: index + 101,
        skuCode: `SKU-${index + 1}`,
        skuName: `盘点物料 ${index + 1}`,
        stockUnit: '件',
        systemQty: String(index + 1),
        actualQty: null,
        diffQty: null,
      })),
    },
  })),
  useUpdateStocktakingItems: vi.fn(() => ({
    mutateAsync: mocks.updateMutateAsync,
    isPending: false,
  })),
  useSubmitStocktaking: vi.fn(() => ({
    mutateAsync: mocks.submitMutateAsync,
    isPending: false,
  })),
}));

describe('MobileWarehouseOps stocktaking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateMutateAsync.mockResolvedValue({ updatedCount: 12 });
  });

  it('renders and saves all stocktaking items on mobile', async () => {
    render(
      <MemoryRouter>
        <MobileWarehouseOps mode="stocktaking" stocktakingId={7} />
      </MemoryRouter>,
    );

    expect(screen.getByText('SKU-12')).toBeInTheDocument();

    const lastQtyInput = screen.getByTestId('mobile-stocktaking-qty-112') as HTMLInputElement;
    fireEvent.change(lastQtyInput, { target: { value: '18.5' } });
    fireEvent.click(screen.getByTestId('mobile-stocktaking-save'));

    await waitFor(() => expect(mocks.updateMutateAsync).toHaveBeenCalledTimes(1));
    expect(mocks.updateMutateAsync).toHaveBeenCalledWith({
      items: expect.arrayContaining([
        { skuId: 112, actualQty: '18.5' },
      ]),
    });
    expect(mocks.updateMutateAsync.mock.calls[0][0].items).toHaveLength(12);
  });
});
