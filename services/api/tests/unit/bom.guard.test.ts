jest.mock('../../src/config/database', () => ({
  AppDataSource: {
    query: jest.fn(),
  },
}));

jest.mock('../../src/config/redis', () => ({
  getRedisClient: () => ({
    del: jest.fn(),
    get: jest.fn(),
    setex: jest.fn(),
  }),
  RedisKeys: {
    bomExpanded: jest.fn(),
  },
  RedisTTL: {},
}));

import { BomService } from '../../src/modules/bom/bom.service';

describe('BomService component guard', () => {
  it('rejects fixed assets as BOM components', async () => {
    const manager = {
      query: jest.fn().mockResolvedValueOnce([
        { id: 9801, business_class: 'fixed_asset', allow_bom_component: 0 },
      ]),
    };

    const svc = new BomService({ tenantId: 7, userId: 11 });
    await expect((svc as any).assertBomComponentAllowed(manager, 9801)).rejects.toThrow(
      '不允许作为BOM子项',
    );
  });

  it('rejects consumables when allow_bom_component is disabled', async () => {
    const manager = {
      query: jest.fn().mockResolvedValueOnce([
        { id: 8801, business_class: 'consumable', allow_bom_component: 0 },
      ]),
    };

    const svc = new BomService({ tenantId: 7, userId: 11 });
    await expect((svc as any).assertBomComponentAllowed(manager, 8801)).rejects.toThrow(
      '不允许作为BOM子项',
    );
  });

  it('allows production materials with bom access enabled', async () => {
    const manager = {
      query: jest.fn().mockResolvedValueOnce([
        { id: 101, business_class: 'production_material', allow_bom_component: 1 },
      ]),
    };

    const svc = new BomService({ tenantId: 7, userId: 11 });
    await expect((svc as any).assertBomComponentAllowed(manager, 101)).resolves.toBeUndefined();
  });
});
