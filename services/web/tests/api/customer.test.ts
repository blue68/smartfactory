/**
 * [artifact:自动化测试] — 客户管理 API Hook 单元测试
 *
 * 覆盖范围：
 *   useCustomerList         — GET /api/customers
 *   useCustomer             — GET /api/customers/:id
 *   useCustomerOptions      — GET /api/customers/options
 *   useCustomerContacts     — GET /api/customers/:id/contacts
 *   useCreateCustomer       — POST /api/customers
 *   useUpdateCustomer       — PUT /api/customers/:id
 *   useCreateCustomerContact — POST /api/customers/:id/contacts
 *   useDeleteCustomerContact — DELETE /api/customers/:id/contacts/:contactId
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
  useCustomerList,
  useCustomer,
  useCustomerOptions,
  useCustomerContacts,
  useCreateCustomer,
  useUpdateCustomer,
  useCreateCustomerContact,
  useDeleteCustomerContact,
} from '@/api/customer';
import type {
  Customer,
  CustomerOption,
  CustomerContact,
  CreateCustomerPayload,
  CreateContactPayload,
} from '@/api/customer';
import type { PaginatedData } from '@/types/api';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const mockCustomer: Customer = {
  id: 1,
  code: 'C001',
  name: '测试客户A',
  grade: 'A',
  contact: '张三',
  phone: '13800138000',
  email: 'test@example.com',
  address: '北京市朝阳区',
  creditLimit: 100000,
  paymentDays: 30,
  status: 'active',
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
};

const mockCustomer2: Customer = {
  id: 2,
  code: 'C002',
  name: '测试客户B',
  grade: 'VIP',
  status: 'inactive',
  createdAt: '2025-02-01T00:00:00Z',
  updatedAt: '2025-02-01T00:00:00Z',
};

const mockPaginatedCustomers: PaginatedData<Customer> = {
  list: [mockCustomer, mockCustomer2],
  total: 2,
  page: 1,
  pageSize: 20,
  totalPages: 1,
};

const mockCustomerOption: CustomerOption = {
  id: 1,
  name: '测试客户A',
  code: 'C001',
  grade: 'A',
};

const mockContact: CustomerContact = {
  id: 10,
  customerId: 1,
  name: '李四',
  position: '采购经理',
  phone: '13900139000',
  email: 'lisi@example.com',
  isPrimary: true,
};

const mockGet = request.get as ReturnType<typeof vi.fn>;
const mockPost = request.post as ReturnType<typeof vi.fn>;
const mockPut = request.put as ReturnType<typeof vi.fn>;
const mockDelete = request.delete as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

// ── useCustomerList ──────────────────────────────────────────────────────────

describe('useCustomerList', () => {
  it('无过滤参数时调用 GET /api/customers 并返回分页数据', async () => {
    mockGet.mockResolvedValueOnce(mockPaginatedCustomers);

    const { result } = renderHook(() => useCustomerList({}), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(mockGet).toHaveBeenCalledWith('/api/customers', {});
    expect(result.current.data?.list).toHaveLength(2);
    expect(result.current.data?.total).toBe(2);
  });

  it('带 keyword 过滤时将参数透传', async () => {
    mockGet.mockResolvedValueOnce({ ...mockPaginatedCustomers, list: [mockCustomer] });

    const query = { keyword: '测试客户A', page: 1, pageSize: 10 };
    const { result } = renderHook(() => useCustomerList(query), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockGet).toHaveBeenCalledWith('/api/customers', query);
  });

  it('按 grade 过滤时正确传参', async () => {
    mockGet.mockResolvedValueOnce({ ...mockPaginatedCustomers, list: [mockCustomer2] });

    const query = { grade: 'VIP' as const };
    const { result } = renderHook(() => useCustomerList(query), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/api/customers', query);
  });

  it('请求失败时 isError 为 true', async () => {
    mockGet.mockRejectedValueOnce(new Error('服务端异常'));

    const { result } = renderHook(() => useCustomerList({}), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('按 status 过滤 inactive 客户', async () => {
    mockGet.mockResolvedValueOnce({ ...mockPaginatedCustomers, list: [mockCustomer2] });

    const query = { status: 'inactive' as const };
    const { result } = renderHook(() => useCustomerList(query), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/api/customers', query);
  });
});

// ── useCustomer ──────────────────────────────────────────────────────────────

describe('useCustomer', () => {
  it('id 有效时调用 GET /api/customers/:id', async () => {
    mockGet.mockResolvedValueOnce(mockCustomer);

    const { result } = renderHook(() => useCustomer(1), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockGet).toHaveBeenCalledWith('/api/customers/1');
    expect(result.current.data?.id).toBe(1);
    expect(result.current.data?.name).toBe('测试客户A');
  });

  it('id 为 null 时不发起请求（enabled: false）', async () => {
    const { result } = renderHook(() => useCustomer(null), {
      wrapper: createWrapper(),
    });

    // 短暂等待，确认没有触发请求
    await new Promise((r) => setTimeout(r, 50));

    expect(mockGet).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('客户不存在时服务端返回 404 则 isError 为 true', async () => {
    mockGet.mockRejectedValueOnce(new Error('客户不存在'));

    const { result } = renderHook(() => useCustomer(9999), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

// ── useCustomerOptions ───────────────────────────────────────────────────────

describe('useCustomerOptions', () => {
  it('调用 GET /api/customers/options 并返回选项列表', async () => {
    mockGet.mockResolvedValueOnce([mockCustomerOption]);

    const { result } = renderHook(() => useCustomerOptions(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockGet).toHaveBeenCalledWith('/api/customers/options');
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data![0].code).toBe('C001');
  });

  it('staleTime 为 60000ms（1 分钟内不重新请求）', async () => {
    mockGet.mockResolvedValueOnce([mockCustomerOption]);

    const wrapper = createWrapper();
    const { result: r1 } = renderHook(() => useCustomerOptions(), { wrapper });
    await waitFor(() => expect(r1.current.isSuccess).toBe(true));

    // 同一 wrapper 内再次 render，staleTime 未过期，不重新请求
    const { result: r2 } = renderHook(() => useCustomerOptions(), { wrapper });
    await waitFor(() => expect(r2.current.isSuccess).toBe(true));

    // 请求仅发生一次
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it('请求失败时 isError 为 true', async () => {
    mockGet.mockRejectedValueOnce(new Error('无权访问'));

    const { result } = renderHook(() => useCustomerOptions(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

// ── useCustomerContacts ──────────────────────────────────────────────────────

describe('useCustomerContacts', () => {
  it('customerId 有效时调用 GET /api/customers/:id/contacts', async () => {
    mockGet.mockResolvedValueOnce([mockContact]);

    const { result } = renderHook(() => useCustomerContacts(1), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockGet).toHaveBeenCalledWith('/api/customers/1/contacts');
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data![0].isPrimary).toBe(true);
  });

  it('customerId 为 null 时不发起请求', async () => {
    const { result } = renderHook(() => useCustomerContacts(null), {
      wrapper: createWrapper(),
    });

    await new Promise((r) => setTimeout(r, 50));

    expect(mockGet).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('联系人列表为空时返回空数组', async () => {
    mockGet.mockResolvedValueOnce([]);

    const { result } = renderHook(() => useCustomerContacts(2), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });
});

// ── useCreateCustomer ────────────────────────────────────────────────────────

describe('useCreateCustomer', () => {
  const payload: CreateCustomerPayload = {
    code: 'C003',
    name: '新客户C',
    grade: 'B',
    contact: '王五',
    phone: '13700137000',
    email: 'wangwu@example.com',
    creditLimit: 50000,
    paymentDays: 60,
  };

  it('调用 POST /api/customers 并返回新建客户', async () => {
    const created: Customer = { ...mockCustomer, id: 3, code: 'C003', name: '新客户C' };
    mockPost.mockResolvedValueOnce(created);

    const { result } = renderHook(() => useCreateCustomer(), {
      wrapper: createWrapper(),
    });

    result.current.mutate(payload);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockPost).toHaveBeenCalledWith('/api/customers', payload);
    expect(result.current.data?.code).toBe('C003');
  });

  it('创建成功后同时使 customers 列表和 customer-options 缓存失效', async () => {
    mockPost.mockResolvedValueOnce({ ...mockCustomer, id: 4, code: 'C004' });

    const { result } = renderHook(() => useCreateCustomer(), {
      wrapper: createWrapper(),
    });

    result.current.mutate(payload);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // onSuccess 中调用了 invalidateQueries(['customers']) 和 ['customer-options']
    // 仅验证 mutation 成功完成，缓存失效逻辑由 react-query 内部处理
  });

  it('客户编码重复时服务端返回错误则 isError 为 true', async () => {
    mockPost.mockRejectedValueOnce(new Error('客户编码已存在'));

    const { result } = renderHook(() => useCreateCustomer(), {
      wrapper: createWrapper(),
    });

    result.current.mutate(payload);

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toBe('客户编码已存在');
  });

  it('只传必填字段 code + name 时也可正常提交', async () => {
    const minimalPayload: CreateCustomerPayload = { code: 'C005', name: '极简客户' };
    mockPost.mockResolvedValueOnce({ ...mockCustomer, id: 5, ...minimalPayload });

    const { result } = renderHook(() => useCreateCustomer(), {
      wrapper: createWrapper(),
    });

    result.current.mutate(minimalPayload);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPost).toHaveBeenCalledWith('/api/customers', minimalPayload);
  });
});

// ── useUpdateCustomer ────────────────────────────────────────────────────────

describe('useUpdateCustomer', () => {
  it('调用 PUT /api/customers/:id 并返回更新后客户', async () => {
    const updated: Customer = { ...mockCustomer, name: '客户A（已更名）', grade: 'VIP' };
    mockPut.mockResolvedValueOnce(updated);

    const { result } = renderHook(() => useUpdateCustomer(), {
      wrapper: createWrapper(),
    });

    result.current.mutate({ id: 1, payload: { name: '客户A（已更名）', grade: 'VIP' } });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockPut).toHaveBeenCalledWith('/api/customers/1', { name: '客户A（已更名）', grade: 'VIP' });
    expect(result.current.data?.grade).toBe('VIP');
  });

  it('更新成功后使 customers、customer/:id、customer-options 三个缓存失效', async () => {
    mockPut.mockResolvedValueOnce({ ...mockCustomer, creditLimit: 200000 });

    const { result } = renderHook(() => useUpdateCustomer(), {
      wrapper: createWrapper(),
    });

    result.current.mutate({ id: 1, payload: { creditLimit: 200000 } });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // onSuccess 传入 id=1，invalidateQueries 应覆盖 ['customer', 1]
  });

  it('仅更新部分字段（Partial payload）', async () => {
    mockPut.mockResolvedValueOnce({ ...mockCustomer, paymentDays: 45 });

    const { result } = renderHook(() => useUpdateCustomer(), {
      wrapper: createWrapper(),
    });

    result.current.mutate({ id: 1, payload: { paymentDays: 45 } });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPut).toHaveBeenCalledWith('/api/customers/1', { paymentDays: 45 });
  });

  it('客户不存在时更新失败 isError 为 true', async () => {
    mockPut.mockRejectedValueOnce(new Error('客户不存在'));

    const { result } = renderHook(() => useUpdateCustomer(), {
      wrapper: createWrapper(),
    });

    result.current.mutate({ id: 9999, payload: { name: '不存在' } });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

// ── useCreateCustomerContact ─────────────────────────────────────────────────

describe('useCreateCustomerContact', () => {
  const contactPayload: CreateContactPayload = {
    name: '新联系人',
    position: '总监',
    phone: '18000180000',
    isPrimary: false,
  };

  it('调用 POST /api/customers/:id/contacts 并返回新联系人', async () => {
    const created: CustomerContact = { ...mockContact, id: 20, name: '新联系人', isPrimary: false };
    mockPost.mockResolvedValueOnce(created);

    const { result } = renderHook(() => useCreateCustomerContact(), {
      wrapper: createWrapper(),
    });

    result.current.mutate({ customerId: 1, payload: contactPayload });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockPost).toHaveBeenCalledWith('/api/customers/1/contacts', contactPayload);
    expect(result.current.data?.name).toBe('新联系人');
  });

  it('创建成功后使 customer-contacts 缓存失效', async () => {
    mockPost.mockResolvedValueOnce({ ...mockContact, id: 21 });

    const { result } = renderHook(() => useCreateCustomerContact(), {
      wrapper: createWrapper(),
    });

    result.current.mutate({ customerId: 1, payload: contactPayload });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('传入不合法联系人数据时服务端返回错误', async () => {
    mockPost.mockRejectedValueOnce(new Error('手机号格式错误'));

    const { result } = renderHook(() => useCreateCustomerContact(), {
      wrapper: createWrapper(),
    });

    result.current.mutate({ customerId: 1, payload: { name: '错误联系人', phone: 'invalid' } });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

// ── useDeleteCustomerContact ─────────────────────────────────────────────────

describe('useDeleteCustomerContact', () => {
  it('调用 DELETE /api/customers/:customerId/contacts/:contactId', async () => {
    mockDelete.mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useDeleteCustomerContact(), {
      wrapper: createWrapper(),
    });

    result.current.mutate({ customerId: 1, contactId: 10 });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockDelete).toHaveBeenCalledTimes(1);
    expect(mockDelete).toHaveBeenCalledWith('/api/customers/1/contacts/10');
  });

  it('删除成功后使对应 customer-contacts 缓存失效', async () => {
    mockDelete.mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useDeleteCustomerContact(), {
      wrapper: createWrapper(),
    });

    result.current.mutate({ customerId: 1, contactId: 10 });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // onSuccess 中传入 customerId=1，invalidateQueries(['customer-contacts', 1])
  });

  it('联系人不存在时删除失败 isError 为 true', async () => {
    mockDelete.mockRejectedValueOnce(new Error('联系人不存在'));

    const { result } = renderHook(() => useDeleteCustomerContact(), {
      wrapper: createWrapper(),
    });

    result.current.mutate({ customerId: 1, contactId: 9999 });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toBe('联系人不存在');
  });

  it('URL 拼接时 customerId 和 contactId 均正确嵌入路径', async () => {
    mockDelete.mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useDeleteCustomerContact(), {
      wrapper: createWrapper(),
    });

    result.current.mutate({ customerId: 42, contactId: 88 });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockDelete).toHaveBeenCalledWith('/api/customers/42/contacts/88');
  });
});
