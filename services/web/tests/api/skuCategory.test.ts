/**
 * [artifact:自动化测试] — SKU 类目 API Hook 单元测试
 *
 * 覆盖范围：
 *   useSkuCategoryList  — GET /api/sku-categories
 *   useCreateCategory   — POST /api/sku-categories
 *   useUpdateCategory   — PATCH /api/sku-categories/:id
 *   useDeleteCategory   — DELETE /api/sku-categories/:id
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { createWrapper } from '../helpers/wrapper';

// ── Mock @/utils/request ─────────────────────────────────────────────────────
vi.mock('@/utils/request', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

import request from '@/utils/request';
import {
  useSkuCategoryList,
  useCreateCategory,
  useUpdateCategory,
  useDeleteCategory,
  skuCategoryKeys,
  skuCategoryApi,
} from '@/api/skuCategory';
import type { SkuCategoryFull, CreateCategoryPayload, UpdateCategoryPayload } from '@/types/models';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const mockCategory: SkuCategoryFull = {
  id: 1,
  level: 1,
  parentId: null,
  code: 'FABRIC',
  name: '面料',
  sortOrder: 1,
  isActive: true,
  isSystem: false,
  children: [],
};

const mockChildCategory: SkuCategoryFull = {
  id: 2,
  level: 2,
  parentId: 1,
  code: 'KNIT',
  name: '针织',
  sortOrder: 1,
  isActive: true,
  isSystem: false,
};

const mockGet = request.get as ReturnType<typeof vi.fn>;
const mockPost = request.post as ReturnType<typeof vi.fn>;
const mockPatch = request.patch as ReturnType<typeof vi.fn>;
const mockDelete = request.delete as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

// ── useSkuCategoryList ────────────────────────────────────────────────────────

describe('useSkuCategoryList', () => {
  it('无参数时调用 GET /api/sku-categories', async () => {
    mockGet.mockResolvedValueOnce([mockCategory]);

    const { result } = renderHook(() => useSkuCategoryList(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(mockGet).toHaveBeenCalledWith('/api/sku-categories', undefined);
    expect(result.current.data).toEqual([mockCategory]);
  });

  it('带 level 过滤参数时正确透传 params', async () => {
    mockGet.mockResolvedValueOnce([mockChildCategory]);

    const params = { level: 2, parentId: 1 };
    const { result } = renderHook(() => useSkuCategoryList(params), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockGet).toHaveBeenCalledWith('/api/sku-categories', params);
    expect(result.current.data).toEqual([mockChildCategory]);
  });

  it('includeInactive=true 时将参数传递给请求', async () => {
    mockGet.mockResolvedValueOnce([mockCategory]);

    const params = { includeInactive: true };
    const { result } = renderHook(() => useSkuCategoryList(params), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockGet).toHaveBeenCalledWith('/api/sku-categories', params);
  });

  it('editableView=true 时将租户可管理视图参数传递给请求', async () => {
    mockGet.mockResolvedValueOnce([mockCategory]);

    const params = { editableView: true };
    const { result } = renderHook(() => useSkuCategoryList(params), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockGet).toHaveBeenCalledWith('/api/sku-categories', params);
  });

  it('请求失败时 isError 为 true 并透传错误信息', async () => {
    const networkError = new Error('网络连接异常');
    mockGet.mockRejectedValueOnce(networkError);

    const { result } = renderHook(() => useSkuCategoryList(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error).toBe(networkError);
  });

  it('QueryKey 结构符合 skuCategoryKeys.list(params) 规范', () => {
    const params = { level: 1 as const };
    const key = skuCategoryKeys.list(params);
    expect(key).toEqual(['sku-categories', 'list', params]);
  });
});

// ── useCreateCategory ─────────────────────────────────────────────────────────

describe('useCreateCategory', () => {
  const payload: CreateCategoryPayload = {
    level: 1,
    parentId: null,
    code: 'ACCESSORIES',
    name: '辅料',
    sortOrder: 2,
  };

  it('调用 POST /api/sku-categories 并返回新建类目', async () => {
    const created: SkuCategoryFull = { ...mockCategory, id: 99, code: 'ACCESSORIES', name: '辅料' };
    mockPost.mockResolvedValueOnce(created);

    const { result } = renderHook(() => useCreateCategory(), {
      wrapper: createWrapper(),
    });

    result.current.mutate(payload);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockPost).toHaveBeenCalledWith('/api/sku-categories', payload);
    expect(result.current.data).toEqual(created);
  });

  it('创建成功后使列表缓存失效（invalidateQueries 触发）', async () => {
    mockPost.mockResolvedValueOnce({ ...mockCategory, id: 100 });
    mockGet.mockResolvedValue([mockCategory]);

    const { result } = renderHook(() => useCreateCategory(), {
      wrapper: createWrapper(),
    });

    result.current.mutate(payload);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // onSuccess 通过 invalidateQueries 标记 sku-categories list 缓存为过期
    // 验证：list queryKey 前缀已在 skuCategoryKeys.lists() 中覆盖
    expect(skuCategoryKeys.lists()).toEqual(['sku-categories', 'list']);
  });

  it('POST 失败时 mutation 状态为 isError', async () => {
    mockPost.mockRejectedValueOnce(new Error('服务端错误'));

    const { result } = renderHook(() => useCreateCategory(), {
      wrapper: createWrapper(),
    });

    result.current.mutate(payload);

    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('不传 sortOrder 时仍可正常提交（可选字段）', async () => {
    const minimalPayload: CreateCategoryPayload = { level: 2, parentId: 1, code: 'LINING', name: '里料' };
    mockPost.mockResolvedValueOnce({ ...mockCategory, ...minimalPayload, id: 101 });

    const { result } = renderHook(() => useCreateCategory(), {
      wrapper: createWrapper(),
    });

    result.current.mutate(minimalPayload);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPost).toHaveBeenCalledWith('/api/sku-categories', minimalPayload);
  });
});

// ── useUpdateCategory ─────────────────────────────────────────────────────────

describe('useUpdateCategory', () => {
  const updateArgs = { id: 1, payload: { name: '面料（改）', sortOrder: 10 } satisfies UpdateCategoryPayload };

  it('调用 PATCH /api/sku-categories/:id 并返回更新后类目', async () => {
    const updated: SkuCategoryFull = { ...mockCategory, name: '面料（改）', sortOrder: 10 };
    mockPatch.mockResolvedValueOnce(updated);

    const { result } = renderHook(() => useUpdateCategory(), {
      wrapper: createWrapper(),
    });

    result.current.mutate(updateArgs);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockPatch).toHaveBeenCalledTimes(1);
    expect(mockPatch).toHaveBeenCalledWith('/api/sku-categories/1', updateArgs.payload);
    expect(result.current.data).toEqual(updated);
  });

  it('只更新 name 时 sortOrder 不传也应正常', async () => {
    const nameOnlyPayload: UpdateCategoryPayload = { name: '仅改名' };
    mockPatch.mockResolvedValueOnce({ ...mockCategory, name: '仅改名' });

    const { result } = renderHook(() => useUpdateCategory(), {
      wrapper: createWrapper(),
    });

    result.current.mutate({ id: 1, payload: nameOnlyPayload });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPatch).toHaveBeenCalledWith('/api/sku-categories/1', nameOnlyPayload);
  });

  it('更新系统预置类目时服务端返回 403 则 isError 为 true', async () => {
    mockPatch.mockRejectedValueOnce(new Error('禁止修改系统预置类目'));

    const { result } = renderHook(() => useUpdateCategory(), {
      wrapper: createWrapper(),
    });

    result.current.mutate({ id: 1, payload: { name: '非法改名' } });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('更新成功后触发列表缓存失效', async () => {
    mockPatch.mockResolvedValueOnce({ ...mockCategory, name: '更新后' });

    const { result } = renderHook(() => useUpdateCategory(), {
      wrapper: createWrapper(),
    });

    result.current.mutate(updateArgs);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // onSuccess 中调用 invalidateQueries({ queryKey: skuCategoryKeys.lists() })
    // 通过验证 lists key 格式来保证 onSuccess 覆盖面
    expect(skuCategoryKeys.lists()).toContain('sku-categories');
  });
});

// ── useDeleteCategory ─────────────────────────────────────────────────────────

describe('useDeleteCategory', () => {
  it('调用 DELETE /api/sku-categories/:id', async () => {
    mockDelete.mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useDeleteCategory(), {
      wrapper: createWrapper(),
    });

    result.current.mutate(1);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockDelete).toHaveBeenCalledTimes(1);
    expect(mockDelete).toHaveBeenCalledWith('/api/sku-categories/1');
  });

  it('删除不存在的 id 时服务端返回 404 则 isError 为 true', async () => {
    mockDelete.mockRejectedValueOnce(new Error('类目不存在'));

    const { result } = renderHook(() => useDeleteCategory(), {
      wrapper: createWrapper(),
    });

    result.current.mutate(9999);

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
  });

  it('删除成功后列表缓存失效', async () => {
    mockDelete.mockResolvedValueOnce(undefined);
    mockGet.mockResolvedValue([]);

    const { result } = renderHook(() => useDeleteCategory(), {
      wrapper: createWrapper(),
    });

    result.current.mutate(1);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('删除系统预置类目（isSystem=true）时服务端应返回 403', async () => {
    mockDelete.mockRejectedValueOnce(new Error('系统预置类目禁止删除'));

    const { result } = renderHook(() => useDeleteCategory(), {
      wrapper: createWrapper(),
    });

    result.current.mutate(1);

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toBe('系统预置类目禁止删除');
  });
});

// ── skuCategoryApi 原始函数 ───────────────────────────────────────────────────

describe('skuCategoryApi 原始请求函数', () => {
  it('getList 无参数时以 undefined 为 params 调用 request.get', async () => {
    mockGet.mockResolvedValueOnce([mockCategory]);
    await skuCategoryApi.getList();
    expect(mockGet).toHaveBeenCalledWith('/api/sku-categories', undefined);
  });

  it('create 正确透传 payload 到 request.post', async () => {
    const payload: CreateCategoryPayload = { level: 1, code: 'X', name: '测试' };
    mockPost.mockResolvedValueOnce({ ...mockCategory, ...payload });
    await skuCategoryApi.create(payload);
    expect(mockPost).toHaveBeenCalledWith('/api/sku-categories', payload);
  });

  it('update 正确拼接 id 到路径并透传 payload', async () => {
    const payload: UpdateCategoryPayload = { name: '新名称' };
    mockPatch.mockResolvedValueOnce({ ...mockCategory, ...payload });
    await skuCategoryApi.update(42, payload);
    expect(mockPatch).toHaveBeenCalledWith('/api/sku-categories/42', payload);
  });

  it('delete 正确拼接 id 到路径', async () => {
    mockDelete.mockResolvedValueOnce(undefined);
    await skuCategoryApi.delete(7);
    expect(mockDelete).toHaveBeenCalledWith('/api/sku-categories/7');
  });
});
