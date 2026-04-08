import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { createWrapper } from '../helpers/wrapper';

vi.mock('@/utils/request', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

import request from '@/utils/request';
import { mrpApi, useShortageSummary } from '@/api/mrp';

const mockGet = request.get as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('mrpApi.getShortageSummary', () => {
  it('should forward warehouse/location/default filters', async () => {
    mockGet.mockResolvedValueOnce({
      list: [],
      total: 0,
      page: 1,
      pageSize: 200,
      totalPages: 0,
    });

    await mrpApi.getShortageSummary({
      page: 1,
      pageSize: 200,
      warehouseId: 9,
      locationId: 99,
      onlyDefaultLocation: true,
    });

    expect(mockGet).toHaveBeenCalledWith('/api/mrp/shortage-summary', {
      page: 1,
      pageSize: 200,
      warehouseId: 9,
      locationId: 99,
      onlyDefaultLocation: true,
    });
  });
});

describe('useShortageSummary', () => {
  it('should call GET shortage-summary with query params', async () => {
    mockGet.mockResolvedValueOnce({
      list: [],
      total: 0,
      page: 1,
      pageSize: 200,
      totalPages: 0,
    });

    const query = {
      page: 1,
      pageSize: 200,
      warehouseId: 3,
      onlyDefaultLocation: false,
    };
    const { result } = renderHook(() => useShortageSummary(query), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGet).toHaveBeenCalledWith('/api/mrp/shortage-summary', query);
  });
});
