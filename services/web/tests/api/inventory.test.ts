import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { createWrapper } from '../helpers/wrapper';

vi.mock('@/utils/request', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    postWithLockRetry: vi.fn(),
  },
  getAccessToken: vi.fn(() => null),
}));

import request from '@/utils/request';
import { inventoryApi, useInventoryDailySnapshots, useInventoryTransactions } from '@/api/inventory';

const mockGet = request.get as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('inventoryApi.getList', () => {
  it('belowSafety 布尔值应序列化为字符串', async () => {
    mockGet.mockResolvedValueOnce({
      list: [],
      total: 0,
      page: 1,
      pageSize: 20,
      totalPages: 0,
    });

    await inventoryApi.getList({
      page: 1,
      pageSize: 20,
      keyword: '坯布',
      belowSafety: false,
    });

    expect(mockGet).toHaveBeenCalledWith('/api/inventory', {
      page: 1,
      pageSize: 20,
      keyword: '坯布',
      belowSafety: 'false',
    });
  });
});

describe('inventoryApi.getDailySnapshots', () => {
  it('应透传快照分页与筛选并过滤空关键词', async () => {
    mockGet.mockResolvedValueOnce({
      list: [],
      total: 0,
      page: 1,
      pageSize: 5,
      totalPages: 0,
      snapshotDate: '2026-04-01',
    });

    await inventoryApi.getDailySnapshots({
      snapshotDate: '2026-04-01',
      keyword: '',
      page: 2,
      pageSize: 5,
    });

    expect(mockGet).toHaveBeenCalledWith('/api/inventory/daily-snapshots', {
      snapshotDate: '2026-04-01',
      page: 2,
      pageSize: 5,
    });
  });
});

describe('inventoryApi.getTransactions', () => {
  it('应透传追溯查询参数并过滤空关键词', async () => {
    mockGet.mockResolvedValueOnce({
      skuId: 11,
      skuCode: 'SKU-11',
      skuName: '坯布 11',
      stockUnit: 'm',
      list: [],
      total: 0,
      page: 1,
      pageSize: 6,
      totalPages: 0,
    });

    await inventoryApi.getTransactions(11, {
      keyword: '',
      dateFrom: '2026-04-01',
      dateTo: '2026-04-02',
      page: 2,
      pageSize: 6,
    });

    expect(mockGet).toHaveBeenCalledWith('/api/inventory/11/transactions', {
      dateFrom: '2026-04-01',
      dateTo: '2026-04-02',
      page: 2,
      pageSize: 6,
    });
  });
});

describe('useInventoryDailySnapshots', () => {
  it('enabled=false 时不应发起请求', async () => {
    const { result } = renderHook(
      () =>
        useInventoryDailySnapshots(
          {
            snapshotDate: '2026-04-01',
            page: 1,
            pageSize: 5,
          },
          false,
        ),
      { wrapper: createWrapper() },
    );

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(mockGet).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('enabled=true 时应请求日结快照列表', async () => {
    mockGet.mockResolvedValueOnce({
      list: [],
      total: 0,
      page: 1,
      pageSize: 5,
      totalPages: 0,
      snapshotDate: '2026-04-01',
    });

    const { result } = renderHook(
      () =>
        useInventoryDailySnapshots(
          {
            snapshotDate: '2026-04-01',
            keyword: 'SKU',
            page: 1,
            pageSize: 5,
          },
          true,
        ),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockGet).toHaveBeenCalledWith('/api/inventory/daily-snapshots', {
      snapshotDate: '2026-04-01',
      keyword: 'SKU',
      page: 1,
      pageSize: 5,
    });
  });
});

describe('useInventoryTransactions', () => {
  it('skuId 为空时不应发起请求', async () => {
    const { result } = renderHook(
      () =>
        useInventoryTransactions(
          null,
          {
            page: 1,
            pageSize: 6,
          },
          true,
        ),
      { wrapper: createWrapper() },
    );

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(mockGet).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });
});
