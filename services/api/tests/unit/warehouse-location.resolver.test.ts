const mockQuery = jest.fn();
const mockRedisIncr = jest.fn();
const mockRedisExpire = jest.fn();

jest.mock('../../src/config/database', () => ({
  AppDataSource: {
    query: (...args: unknown[]) => mockQuery(...args),
  },
}));

jest.mock('../../src/config/redis', () => ({
  getRedisClient: () => ({
    incr: (...args: unknown[]) => mockRedisIncr(...args),
    expire: (...args: unknown[]) => mockRedisExpire(...args),
  }),
  RedisKeys: {
    inventoryWarehouseMetric: (tenantId: number, date: string, metric: string, sourceRef: string) =>
      `metric:${tenantId}:${date}:${metric}:${sourceRef}`,
  },
  RedisTTL: {
    METRICS_DAILY: 86400,
  },
}));

import { resolveWarehouseLocationBinding } from '../../src/modules/inventory/warehouse-location.resolver';

describe('resolveWarehouseLocationBinding', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRedisIncr.mockResolvedValue(1);
    mockRedisExpire.mockResolvedValue(1);
  });

  it('accepts bigint ids returned as strings and resolves the bound warehouse/location', async () => {
    mockQuery.mockResolvedValueOnce([
      {
        warehouseId: '996861',
        locationId: '996862',
        warehouseCode: 'CONS-INT-WH',
        locationCode: 'CONS-INT-LOC',
      },
    ]);

    const result = await resolveWarehouseLocationBinding({
      manager: { query: mockQuery },
      tenantId: 9999,
      userId: 99003,
      warehouseId: '996861',
      locationId: '996862',
      sourceRef: 'consumable_issue:execute',
    });

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('FROM warehouses w'),
      [996862, 9999, 996861],
    );
    expect(result).toEqual({
      warehouseId: 996861,
      locationId: 996862,
      warehouseCode: 'CONS-INT-WH',
      locationCode: 'CONS-INT-LOC',
      warningCode: null,
    });
    expect(mockRedisIncr).not.toHaveBeenCalled();
  });
});
