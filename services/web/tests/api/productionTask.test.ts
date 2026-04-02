import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { createWrapper } from '../helpers/wrapper';

vi.mock('@/utils/request', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

import request from '@/utils/request';
import { taskApi, useTaskDetail } from '@/api/productionTask';

const mockGet = request.get as ReturnType<typeof vi.fn>;

describe('productionTask api', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('detail should normalize started status to in_progress', async () => {
    mockGet.mockResolvedValueOnce({
      id: 1,
      taskNo: 'TASK-001',
      status: 'started',
    });

    const result = await taskApi.detail(1);

    expect(mockGet).toHaveBeenCalledWith('/api/production/tasks/1');
    expect(result.status).toBe('in_progress');
  });

  it('useTaskDetail should stay idle when taskId is null', async () => {
    const { result } = renderHook(() => useTaskDetail(null), {
      wrapper: createWrapper(),
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(mockGet).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });
});
