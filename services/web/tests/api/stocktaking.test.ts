import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/utils/request', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
  },
}));

import request from '@/utils/request';
import { stocktakingApi } from '@/api/stocktaking';

const mockGet = request.get as ReturnType<typeof vi.fn>;
const mockPost = request.post as ReturnType<typeof vi.fn>;
const mockPut = request.put as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('stocktakingApi.updateItems', () => {
  it('should send array payload expected by backend schema', async () => {
    mockPut.mockResolvedValueOnce({ updatedCount: 1 });

    await stocktakingApi.updateItems(11, {
      items: [{ skuId: 101, actualQty: '15.0000' }],
    });

    expect(mockPut).toHaveBeenCalledWith('/api/stocktaking/11/items', [
      { skuId: 101, actualQty: '15.0000' },
    ]);
  });
});

describe('stocktakingApi.getList', () => {
  it('should map backend completed status to pending_confirm', async () => {
    mockGet.mockResolvedValueOnce({
      list: [{
        id: 9,
        taskNo: 'PD-9',
        scope: 'all',
        status: 'completed',
        totalItems: 1,
        diffItems: 0,
        createdAt: '2026-04-07T10:00:00.000Z',
      }],
      total: 1,
      page: 1,
      pageSize: 20,
    });

    const result = await stocktakingApi.getList(1, 20);

    expect(result.list[0]?.status).toBe('pending_confirm');
  });
});

describe('stocktakingApi.submit', () => {
  it('should post submit endpoint', async () => {
    mockPost.mockResolvedValueOnce({ submittedAt: '2026-04-07T12:00:00.000Z' });

    await stocktakingApi.submit(88);

    expect(mockPost).toHaveBeenCalledWith(
      '/api/stocktaking/88/submit',
      undefined,
      { timeout: 120000 },
    );
  });
});
