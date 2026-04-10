const mockQuery = jest.fn();

jest.mock('../../src/config/database', () => ({
  AppDataSource: {
    query: (...args: unknown[]) => mockQuery(...args),
    getRepository: () => ({
      create: jest.fn(),
      save: jest.fn(),
      findOne: jest.fn(),
      find: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      createQueryBuilder: jest.fn(),
    }),
  },
}));

jest.mock('../../src/config/redis', () => ({
  getRedisClient: () => ({
    del: jest.fn(),
    get: jest.fn(),
    setex: jest.fn(),
  }),
  RedisKeys: {
    skuList: jest.fn(),
  },
  RedisTTL: {},
}));

import { SkuService } from '../../src/modules/sku/sku.service';

describe('SkuService.generateSkuCode', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('generates a 7-digit sequence for the first sku in a category', async () => {
    mockQuery
      .mockResolvedValueOnce([{ code: 'WOOD' }])
      .mockResolvedValueOnce([{ max_code: null }]);

    const svc = new SkuService({ tenantId: 7, userId: 11 });
    const skuCode = await (svc as any).generateSkuCode(1, 8);

    expect(skuCode).toBe('WOO0000001');
  });

  it('continues from the largest existing sku code using a 7-digit sequence', async () => {
    mockQuery
      .mockResolvedValueOnce([{ code: 'FABRIC' }])
      .mockResolvedValueOnce([{ max_code: 'FAB0000123' }]);

    const svc = new SkuService({ tenantId: 7, userId: 11 });
    const skuCode = await (svc as any).generateSkuCode(1, 5);

    expect(skuCode).toBe('FAB0000124');
  });
});
