const mockQuery = jest.fn();

jest.mock('../../src/config/database', () => ({
  AppDataSource: {
    query: (...args: unknown[]) => mockQuery(...args),
  },
}));

jest.mock('../../src/config/redis', () => ({
  acquireLock: jest.fn(),
  releaseLock: jest.fn(),
  getRedisClient: () => ({
    del: jest.fn(),
    get: jest.fn(),
    setex: jest.fn(),
  }),
  RedisKeys: {
    inventoryLock: jest.fn(),
    inventorySnapshot: jest.fn(),
    alertSent: jest.fn(),
  },
  RedisTTL: {
    INVENTORY: 300,
    ALERT_SENT: 86400,
  },
}));

import { InventoryService } from '../../src/modules/inventory/inventory.service';

describe('InventoryService.listInventory regression', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('prefers purchase-to-stock conversion from sku_unit_conversions for list display metrics', async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT s.id AS skuId')) {
        expect(sql).toContain('COALESCE(uc.conversion_rate, s.stock_conv_factor) AS stockConvFactor');
        expect(sql).toContain('LEFT JOIN sku_unit_conversions uc');
        expect(sql).toContain('uc.from_unit = s.purchase_unit');
        expect(sql).toContain('uc.to_unit = s.stock_unit');
        return [
          {
            skuId: 101,
            skuCode: 'RM-00058',
            skuName: '棉麻混纺（本白）',
            stockUnit: '米',
            purchaseUnit: '卷',
            stockConvFactor: '25.000000',
            safetyStock: '30.0000',
            hasDyeLot: 1,
            qtyOnHand: '5003.0000',
            qtyReserved: '0.0000',
            qtyInTransit: '0.0000',
            warehouseId: 1,
            warehouseCode: 'DEFAULT',
            warehouseName: '默认仓',
            locationId: 2,
            locationCode: 'DEFAULT-UNKNOWN',
            locationName: '默认库位',
          },
        ];
      }
      if (sql.includes('SELECT COUNT(*) AS total FROM skus s')) {
        return [{ total: 1 }];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const svc = new InventoryService({ tenantId: 7, userId: 11, roles: ['boss'] });
    (svc as any).getWarehouseDataScope = jest.fn().mockResolvedValue({ mode: 'all', warehouseIds: [] });

    const result = await svc.listInventory({ page: 1, pageSize: 20 });

    expect(result.total).toBe(1);
    expect(result.list).toHaveLength(1);
    expect(result.list[0]).toMatchObject({
      skuId: 101,
      purchaseUnit: '卷',
      stockUnit: '米',
      stockConvFactor: '25.000000',
      qtyAvailable: '5003.0000',
      isBelowSafety: false,
      isDefaultLocation: true,
    });
  });
});
