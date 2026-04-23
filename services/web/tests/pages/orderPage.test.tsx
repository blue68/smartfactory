import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import OrderPage from '@/pages/sales/OrderPage';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  setPageTitle: vi.fn(),
  showToast: vi.fn(),
  useCustomerOptions: vi.fn(),
  useSkuList: vi.fn(),
  useCreateSalesOrder: vi.fn(),
  useConfirmSalesOrder: vi.fn(),
  useUrgentAnalysis: vi.fn(),
  createMutateAsync: vi.fn(),
  confirmMutateAsync: vi.fn(),
  urgentMutateAsync: vi.fn(),
  checkInventory: vi.fn(),
  checkSalesOrderCapacity: vi.fn(),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mocks.navigate,
  };
});

vi.mock('@/stores/appStore', () => ({
  useAppStore: () => ({
    setPageTitle: mocks.setPageTitle,
    showToast: mocks.showToast,
  }),
}));

vi.mock('@/api/customer', () => ({
  useCustomerOptions: mocks.useCustomerOptions,
}));

vi.mock('@/api/sku', () => ({
  useSkuList: mocks.useSkuList,
}));

vi.mock('@/api/salesOrder', () => ({
  useCreateSalesOrder: mocks.useCreateSalesOrder,
  useConfirmSalesOrder: mocks.useConfirmSalesOrder,
  checkInventory: mocks.checkInventory,
  checkSalesOrderCapacity: mocks.checkSalesOrderCapacity,
}));

vi.mock('@/api/sales', () => ({
  useUrgentAnalysis: mocks.useUrgentAnalysis,
}));

vi.mock('@/api/bom', () => ({
  bomApi: {
    getList: vi.fn(),
  },
}));

describe('OrderPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.useCustomerOptions.mockReturnValue({
      data: [
        { id: 11, name: '华北客户', code: 'CUST-011' },
        { id: 12, name: '华东客户', code: 'CUST-012' },
      ],
    });

    const skuPage = {
      list: [
        {
          id: 901,
          skuCode: 'FG-901',
          name: '功能沙发A',
          stockUnit: '套',
          category1Code: 'FINISHED',
        },
        {
          id: 902,
          skuCode: 'FG-902',
          name: '餐椅B',
          stockUnit: '把',
          category1Code: 'FINISHED',
        },
        {
          id: 903,
          skuCode: 'FG-903',
          name: '休闲椅C',
          stockUnit: '把',
          category1Code: 'FINISHED',
        },
      ],
      total: 3,
      page: 1,
      pageSize: 200,
    };

    mocks.useSkuList.mockReturnValue({ data: skuPage });
    mocks.useCreateSalesOrder.mockReturnValue({ mutateAsync: mocks.createMutateAsync, isPending: false });
    mocks.useConfirmSalesOrder.mockReturnValue({ mutateAsync: mocks.confirmMutateAsync, isPending: false });
    mocks.useUrgentAnalysis.mockReturnValue({ mutateAsync: mocks.urgentMutateAsync, isPending: false });
    mocks.checkInventory.mockResolvedValue({ available: 100, sufficient: true, stockUnit: '件' });
    mocks.checkSalesOrderCapacity.mockResolvedValue({
      available: true,
      currentLoad: 20,
      maxCapacity: 100,
      estimatedCompletionDate: '2026-04-03',
      conflictingOrders: [],
    });
    mocks.createMutateAsync.mockResolvedValue({ id: 301, orderNo: 'SO-301' });
    mocks.confirmMutateAsync.mockResolvedValue(undefined);
  });

  it('submits multiple sku lines from the order page', async () => {
    render(
      <MemoryRouter>
        <OrderPage />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText('客户名称'), { target: { value: '11' } });
    fireEvent.change(screen.getByLabelText('期望交期'), { target: { value: '2026-04-03' } });

    const firstProductInput = screen.getByPlaceholderText('搜索产品名称 / 编码');
    fireEvent.focus(firstProductInput);
    fireEvent.change(firstProductInput, { target: { value: '功能沙发' } });
    fireEvent.mouseDown(screen.getByRole('button', { name: /功能沙发A/ }));
    fireEvent.change(screen.getByTestId('line-qty-0'), { target: { value: '9' } });
    fireEvent.change(screen.getByTestId('line-price-0'), { target: { value: '680' } });

    fireEvent.click(screen.getByRole('button', { name: '+ 添加SKU' }));

    const productInputs = screen.getAllByPlaceholderText('搜索产品名称 / 编码');
    fireEvent.focus(productInputs[1]);
    fireEvent.change(productInputs[1], { target: { value: '休闲椅' } });
    fireEvent.mouseDown(screen.getByRole('button', { name: /休闲椅C/ }));
    fireEvent.change(screen.getByTestId('line-qty-1'), { target: { value: '4' } });
    fireEvent.change(screen.getByTestId('line-price-1'), { target: { value: '760' } });

    fireEvent.click(screen.getByRole('button', { name: '确认订单' }));

    await waitFor(() => {
      expect(mocks.createMutateAsync).toHaveBeenCalledWith({
        customerId: 11,
        orderDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        deliveryDate: '2026-04-03',
        isUrgent: false,
        notes: undefined,
        items: [
          {
            skuId: 901,
            productName: '功能沙发A',
            quantity: 9,
            unit: '套',
            unitPrice: '680',
          },
          {
            skuId: 903,
            productName: '休闲椅C',
            quantity: 4,
            unit: '把',
            unitPrice: '760',
          },
        ],
      });
    });

    await waitFor(() => {
      expect(mocks.confirmMutateAsync).toHaveBeenCalledWith(301);
      expect(mocks.navigate).toHaveBeenCalledWith('/sales/order-list');
    });
  });
});
