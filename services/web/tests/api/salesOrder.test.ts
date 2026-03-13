/**
 * [artifact:自动化测试] — 销售订单 API Hook 单元测试
 *
 * 覆盖范围：
 *   useSalesOrderList       — GET /api/sales-orders
 *   useSalesOrder           — GET /api/sales-orders/:id
 *   useCreateSalesOrder     — POST /api/sales-orders
 *   useUpdateSalesOrderItems — PUT /api/sales-orders/:id/items
 *   useTransitionSalesOrder  — POST /api/sales-orders/:id/transition
 *   useSubmitSalesOrder     — POST /api/sales-orders/:id/submit
 *   useApproveSalesOrder    — POST /api/sales-orders/:id/approve
 *   useRejectSalesOrder     — POST /api/sales-orders/:id/reject
 *   useWithdrawSalesOrder   — POST /api/sales-orders/:id/withdraw
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { createWrapper } from '../helpers/wrapper';

// ── Mock @/utils/request ─────────────────────────────────────────────────────
vi.mock('@/utils/request', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

import request from '@/utils/request';
import {
  useSalesOrderList,
  useSalesOrder,
  useCreateSalesOrder,
  useUpdateSalesOrderItems,
  useTransitionSalesOrder,
  useSubmitSalesOrder,
  useApproveSalesOrder,
  useRejectSalesOrder,
  useWithdrawSalesOrder,
} from '@/api/salesOrder';
import type {
  SalesOrder,
  SalesOrderItem,
  CreateSalesOrderPayload,
} from '@/api/salesOrder';
import type { PaginatedData } from '@/types/api';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const mockItem: SalesOrderItem = {
  id: 101,
  orderId: 1,
  productName: '产品A',
  quantity: 100,
  unitPrice: 50,
  amount: 5000,
  unit: '件',
};

const mockOrder: SalesOrder = {
  id: 1,
  orderNo: 'SO-2025-0001',
  customerId: 10,
  customerName: '测试客户A',
  orderDate: '2025-01-01',
  deliveryDate: '2025-02-01',
  isUrgent: false,
  status: 'draft',
  totalAmount: 5000,
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
  items: [mockItem],
};

const mockOrderPending: SalesOrder = {
  ...mockOrder,
  id: 2,
  orderNo: 'SO-2025-0002',
  status: 'pending_approval',
};

const mockPaginatedOrders: PaginatedData<SalesOrder> = {
  list: [mockOrder, mockOrderPending],
  total: 2,
  page: 1,
  pageSize: 20,
  totalPages: 1,
};

const mockGet = request.get as ReturnType<typeof vi.fn>;
const mockPost = request.post as ReturnType<typeof vi.fn>;
const mockPut = request.put as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

// ── useSalesOrderList ────────────────────────────────────────────────────────

describe('useSalesOrderList', () => {
  it('无过滤参数时调用 GET /api/sales-orders 并返回分页数据', async () => {
    mockGet.mockResolvedValueOnce(mockPaginatedOrders);

    const { result } = renderHook(() => useSalesOrderList({}), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(mockGet).toHaveBeenCalledWith('/api/sales-orders', {});
    expect(result.current.data?.list).toHaveLength(2);
    expect(result.current.data?.total).toBe(2);
  });

  it('按 status 过滤时正确传参', async () => {
    mockGet.mockResolvedValueOnce({ ...mockPaginatedOrders, list: [mockOrderPending] });

    const query = { status: 'pending_approval' as const, page: 1, pageSize: 10 };
    const { result } = renderHook(() => useSalesOrderList(query), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockGet).toHaveBeenCalledWith('/api/sales-orders', query);
  });

  it('按 isUrgent=true 过滤紧急订单', async () => {
    const urgentOrder: SalesOrder = { ...mockOrder, isUrgent: true };
    mockGet.mockResolvedValueOnce({ ...mockPaginatedOrders, list: [urgentOrder] });

    const query = { isUrgent: true };
    const { result } = renderHook(() => useSalesOrderList(query), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/api/sales-orders', query);
  });

  it('按 keyword 和 customerId 组合过滤', async () => {
    mockGet.mockResolvedValueOnce({ ...mockPaginatedOrders, list: [mockOrder] });

    const query = { keyword: 'SO-2025', customerId: 10 };
    const { result } = renderHook(() => useSalesOrderList(query), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/api/sales-orders', query);
  });

  it('请求失败时 isError 为 true', async () => {
    mockGet.mockRejectedValueOnce(new Error('服务端异常'));

    const { result } = renderHook(() => useSalesOrderList({}), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

// ── useSalesOrder ────────────────────────────────────────────────────────────

describe('useSalesOrder', () => {
  it('id 有效时调用 GET /api/sales-orders/:id 并返回详情', async () => {
    mockGet.mockResolvedValueOnce(mockOrder);

    const { result } = renderHook(() => useSalesOrder(1), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockGet).toHaveBeenCalledWith('/api/sales-orders/1');
    expect(result.current.data?.orderNo).toBe('SO-2025-0001');
    expect(result.current.data?.items).toHaveLength(1);
  });

  it('id 为 null 时不发起请求（enabled: false）', async () => {
    const { result } = renderHook(() => useSalesOrder(null), {
      wrapper: createWrapper(),
    });

    await new Promise((r) => setTimeout(r, 50));

    expect(mockGet).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('订单不存在时服务端返回 404 则 isError 为 true', async () => {
    mockGet.mockRejectedValueOnce(new Error('订单不存在'));

    const { result } = renderHook(() => useSalesOrder(9999), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

// ── useCreateSalesOrder ──────────────────────────────────────────────────────

describe('useCreateSalesOrder', () => {
  const payload: CreateSalesOrderPayload = {
    customerId: 10,
    orderDate: '2025-03-01',
    deliveryDate: '2025-04-01',
    isUrgent: false,
    items: [
      {
        productName: '产品A',
        quantity: 100,
        unitPrice: 50,
      },
    ],
  };

  it('调用 POST /api/sales-orders 并返回新建订单', async () => {
    const created: SalesOrder = { ...mockOrder, id: 99 };
    mockPost.mockResolvedValueOnce(created);

    const { result } = renderHook(() => useCreateSalesOrder(), {
      wrapper: createWrapper(),
    });

    result.current.mutate(payload);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockPost).toHaveBeenCalledWith('/api/sales-orders', payload);
    expect(result.current.data?.id).toBe(99);
  });

  it('创建成功后使 sales-orders 列表缓存失效', async () => {
    mockPost.mockResolvedValueOnce({ ...mockOrder, id: 100 });

    const { result } = renderHook(() => useCreateSalesOrder(), {
      wrapper: createWrapper(),
    });

    result.current.mutate(payload);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // onSuccess 中调用 invalidateQueries(['sales-orders'])
  });

  it('创建紧急订单时 isUrgent=true 正确传递', async () => {
    const urgentPayload: CreateSalesOrderPayload = { ...payload, isUrgent: true };
    mockPost.mockResolvedValueOnce({ ...mockOrder, isUrgent: true });

    const { result } = renderHook(() => useCreateSalesOrder(), {
      wrapper: createWrapper(),
    });

    result.current.mutate(urgentPayload);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPost).toHaveBeenCalledWith('/api/sales-orders', urgentPayload);
  });

  it('创建失败时 isError 为 true', async () => {
    mockPost.mockRejectedValueOnce(new Error('客户信用额度不足'));

    const { result } = renderHook(() => useCreateSalesOrder(), {
      wrapper: createWrapper(),
    });

    result.current.mutate(payload);

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toBe('客户信用额度不足');
  });
});

// ── useUpdateSalesOrderItems ─────────────────────────────────────────────────

describe('useUpdateSalesOrderItems', () => {
  const newItems: SalesOrderItem[] = [
    { productName: '产品B', quantity: 200, unitPrice: 30, amount: 6000 },
  ];

  it('调用 PUT /api/sales-orders/:id/items 并正确包装 items', async () => {
    const updated: SalesOrder = { ...mockOrder, items: newItems, totalAmount: 6000 };
    mockPut.mockResolvedValueOnce(updated);

    const { result } = renderHook(() => useUpdateSalesOrderItems(), {
      wrapper: createWrapper(),
    });

    result.current.mutate({ id: 1, items: newItems });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockPut).toHaveBeenCalledWith('/api/sales-orders/1/items', { items: newItems });
    expect(result.current.data?.totalAmount).toBe(6000);
  });

  it('更新成功后使列表和详情缓存同时失效', async () => {
    mockPut.mockResolvedValueOnce({ ...mockOrder, items: newItems });

    const { result } = renderHook(() => useUpdateSalesOrderItems(), {
      wrapper: createWrapper(),
    });

    result.current.mutate({ id: 1, items: newItems });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // onSuccess 中 invalidateQueries(['sales-orders']) + ['sales-order', 1]
  });

  it('传入空 items 数组时仍发送请求（允许清空）', async () => {
    mockPut.mockResolvedValueOnce({ ...mockOrder, items: [], totalAmount: 0 });

    const { result } = renderHook(() => useUpdateSalesOrderItems(), {
      wrapper: createWrapper(),
    });

    result.current.mutate({ id: 1, items: [] });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPut).toHaveBeenCalledWith('/api/sales-orders/1/items', { items: [] });
  });

  it('订单状态不允许修改时服务端返回错误', async () => {
    mockPut.mockRejectedValueOnce(new Error('订单已确认，不可修改明细'));

    const { result } = renderHook(() => useUpdateSalesOrderItems(), {
      wrapper: createWrapper(),
    });

    result.current.mutate({ id: 1, items: newItems });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

// ── useTransitionSalesOrder ──────────────────────────────────────────────────

describe('useTransitionSalesOrder', () => {
  it('调用 POST /api/sales-orders/:id/transition 并传递 targetStatus', async () => {
    const transitioned: SalesOrder = { ...mockOrder, status: 'confirmed' };
    mockPost.mockResolvedValueOnce(transitioned);

    const { result } = renderHook(() => useTransitionSalesOrder(), {
      wrapper: createWrapper(),
    });

    result.current.mutate({ id: 1, targetStatus: 'confirmed' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockPost).toHaveBeenCalledWith('/api/sales-orders/1/transition', {
      targetStatus: 'confirmed',
    });
    expect(result.current.data?.status).toBe('confirmed');
  });

  it('转换后使列表与详情缓存失效', async () => {
    mockPost.mockResolvedValueOnce({ ...mockOrder, status: 'in_production' });

    const { result } = renderHook(() => useTransitionSalesOrder(), {
      wrapper: createWrapper(),
    });

    result.current.mutate({ id: 1, targetStatus: 'in_production' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('非法状态转换时服务端返回错误', async () => {
    mockPost.mockRejectedValueOnce(new Error('状态流转不合法'));

    const { result } = renderHook(() => useTransitionSalesOrder(), {
      wrapper: createWrapper(),
    });

    result.current.mutate({ id: 1, targetStatus: 'completed' });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

// ── useSubmitSalesOrder ──────────────────────────────────────────────────────

describe('useSubmitSalesOrder', () => {
  it('调用 POST /api/sales-orders/:id/submit', async () => {
    const submitted: SalesOrder = { ...mockOrder, status: 'pending_approval' };
    mockPost.mockResolvedValueOnce(submitted);

    const { result } = renderHook(() => useSubmitSalesOrder(), {
      wrapper: createWrapper(),
    });

    result.current.mutate(1);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockPost).toHaveBeenCalledWith('/api/sales-orders/1/submit');
    expect(result.current.data?.status).toBe('pending_approval');
  });

  it('提交草稿外状态的订单时服务端返回错误', async () => {
    mockPost.mockRejectedValueOnce(new Error('只有草稿状态可提交'));

    const { result } = renderHook(() => useSubmitSalesOrder(), {
      wrapper: createWrapper(),
    });

    result.current.mutate(2);

    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('提交成功后使列表和详情缓存失效（id=1）', async () => {
    mockPost.mockResolvedValueOnce({ ...mockOrder, status: 'pending_approval' });

    const { result } = renderHook(() => useSubmitSalesOrder(), {
      wrapper: createWrapper(),
    });

    result.current.mutate(1);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // onSuccess(_, id=1) 中 invalidateQueries(['sales-order', 1])
  });
});

// ── useApproveSalesOrder ─────────────────────────────────────────────────────

describe('useApproveSalesOrder', () => {
  it('调用 POST /api/sales-orders/:id/approve', async () => {
    const approved: SalesOrder = { ...mockOrderPending, status: 'confirmed' };
    mockPost.mockResolvedValueOnce(approved);

    const { result } = renderHook(() => useApproveSalesOrder(), {
      wrapper: createWrapper(),
    });

    result.current.mutate(2);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockPost).toHaveBeenCalledWith('/api/sales-orders/2/approve');
    expect(result.current.data?.status).toBe('confirmed');
  });

  it('非待审批状态时服务端拒绝审批', async () => {
    mockPost.mockRejectedValueOnce(new Error('订单不处于待审批状态'));

    const { result } = renderHook(() => useApproveSalesOrder(), {
      wrapper: createWrapper(),
    });

    result.current.mutate(1);

    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('审批成功后使列表与详情缓存失效', async () => {
    mockPost.mockResolvedValueOnce({ ...mockOrderPending, status: 'confirmed' });

    const { result } = renderHook(() => useApproveSalesOrder(), {
      wrapper: createWrapper(),
    });

    result.current.mutate(2);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});

// ── useRejectSalesOrder ──────────────────────────────────────────────────────

describe('useRejectSalesOrder', () => {
  it('调用 POST /api/sales-orders/:id/reject 并传递 reason', async () => {
    const rejected: SalesOrder = { ...mockOrderPending, status: 'draft', approvalReason: '库存不足' };
    mockPost.mockResolvedValueOnce(rejected);

    const { result } = renderHook(() => useRejectSalesOrder(), {
      wrapper: createWrapper(),
    });

    result.current.mutate({ id: 2, reason: '库存不足' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockPost).toHaveBeenCalledWith('/api/sales-orders/2/reject', { reason: '库存不足' });
    expect(result.current.data?.approvalReason).toBe('库存不足');
  });

  it('reason 为空时服务端应返回参数校验错误', async () => {
    mockPost.mockRejectedValueOnce(new Error('拒绝原因不能为空'));

    const { result } = renderHook(() => useRejectSalesOrder(), {
      wrapper: createWrapper(),
    });

    result.current.mutate({ id: 2, reason: '' });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toBe('拒绝原因不能为空');
  });

  it('拒绝成功后使列表与详情缓存失效', async () => {
    mockPost.mockResolvedValueOnce({ ...mockOrderPending, status: 'draft' });

    const { result } = renderHook(() => useRejectSalesOrder(), {
      wrapper: createWrapper(),
    });

    result.current.mutate({ id: 2, reason: '产能不足' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('URL 拼接正确且 reason 以 body 形式发送（非 params）', async () => {
    mockPost.mockResolvedValueOnce({ ...mockOrder, status: 'draft' });

    const { result } = renderHook(() => useRejectSalesOrder(), {
      wrapper: createWrapper(),
    });

    result.current.mutate({ id: 5, reason: '交期无法满足' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // 确认 URL 为 /api/sales-orders/5/reject，reason 在 body 中
    expect(mockPost).toHaveBeenCalledWith('/api/sales-orders/5/reject', {
      reason: '交期无法满足',
    });
  });
});

// ── useWithdrawSalesOrder ────────────────────────────────────────────────────

describe('useWithdrawSalesOrder', () => {
  it('调用 POST /api/sales-orders/:id/withdraw', async () => {
    const withdrawn: SalesOrder = { ...mockOrderPending, status: 'draft' };
    mockPost.mockResolvedValueOnce(withdrawn);

    const { result } = renderHook(() => useWithdrawSalesOrder(), {
      wrapper: createWrapper(),
    });

    result.current.mutate(2);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockPost).toHaveBeenCalledWith('/api/sales-orders/2/withdraw');
    expect(result.current.data?.status).toBe('draft');
  });

  it('非待审批状态时撤回失败', async () => {
    mockPost.mockRejectedValueOnce(new Error('当前状态不允许撤回'));

    const { result } = renderHook(() => useWithdrawSalesOrder(), {
      wrapper: createWrapper(),
    });

    result.current.mutate(1);

    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('撤回成功后使列表与详情缓存失效', async () => {
    mockPost.mockResolvedValueOnce({ ...mockOrderPending, status: 'draft' });

    const { result } = renderHook(() => useWithdrawSalesOrder(), {
      wrapper: createWrapper(),
    });

    result.current.mutate(2);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // onSuccess(_, id=2) 中 invalidateQueries(['sales-orders']) + ['sales-order', 2]
  });

  it('不同 id 的撤回请求 URL 各自独立', async () => {
    mockPost
      .mockResolvedValueOnce({ ...mockOrderPending, status: 'draft' })
      .mockResolvedValueOnce({ ...mockOrder, status: 'draft' });

    const wrapper = createWrapper();
    const { result: r1 } = renderHook(() => useWithdrawSalesOrder(), { wrapper });
    const { result: r2 } = renderHook(() => useWithdrawSalesOrder(), { wrapper });

    r1.current.mutate(2);
    await waitFor(() => expect(r1.current.isSuccess).toBe(true));

    r2.current.mutate(3);
    await waitFor(() => expect(r2.current.isSuccess).toBe(true));

    expect(mockPost).toHaveBeenNthCalledWith(1, '/api/sales-orders/2/withdraw');
    expect(mockPost).toHaveBeenNthCalledWith(2, '/api/sales-orders/3/withdraw');
  });
});
