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

describe('SkuService.importSkus', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('imports rows without skuCode and defaults productionUnit to stockUnit', async () => {
    const svc = new SkuService({ tenantId: 7, userId: 11 });
    const createSkuMock = jest.spyOn(svc, 'createSku').mockResolvedValue({ id: 1 } as any);

    (svc as any).loadCategoryMap = jest.fn().mockResolvedValue(new Map([
      ['成品', { id: 3, level: 1, parentId: null, code: 'FINISHED' }],
      ['沙发成品', { id: 31, level: 2, parentId: 3, code: 'SOFA' }],
      ['FINISHED', { id: 3, level: 1, parentId: null, code: 'FINISHED' }],
      ['SOFA', { id: 31, level: 2, parentId: 3, code: 'SOFA' }],
    ]));
    (svc as any).loadCustomerMap = jest.fn().mockResolvedValue({
      byCode: new Map(),
      byName: new Map(),
    });

    const result = await svc.importSkus([{
      name: '品牌沙发成品-01',
      spec: '三人位',
      category1Code: '成品',
      category2Code: '沙发成品',
      stockUnit: '套',
      purchaseUnit: '套',
      safetyStock: '3',
    }]);

    expect(result).toEqual({ imported: 1, failed: 0, errors: [] });
    expect(createSkuMock).toHaveBeenCalledWith(expect.objectContaining({
      skuCode: undefined,
      name: '品牌沙发成品-01',
      stockUnit: '套',
      purchaseUnit: '套',
      productionUnit: '套',
      safetyStock: '3',
    }));
  });

  it('resolves finished-goods branding fields from imported customer code', async () => {
    const svc = new SkuService({ tenantId: 7, userId: 11 });
    const createSkuMock = jest.spyOn(svc, 'createSku').mockResolvedValue({ id: 2 } as any);

    (svc as any).loadCategoryMap = jest.fn().mockResolvedValue(new Map([
      ['成品', { id: 3, level: 1, parentId: null, code: 'FINISHED' }],
      ['沙发成品', { id: 31, level: 2, parentId: 3, code: 'SOFA' }],
    ]));
    (svc as any).loadCustomerMap = jest.fn().mockResolvedValue({
      byCode: new Map([['CUST-001', { id: 88, code: 'CUST-001', name: '华东家居' }]]),
      byName: new Map([['华东家居', { id: 88, code: 'CUST-001', name: '华东家居' }]]),
    });

    const result = await svc.importSkus([{
      name: '品牌沙发成品-客户款',
      category1Code: '成品',
      category2Code: '沙发成品',
      stockUnit: '套',
      purchaseUnit: '套',
      brandScope: '客户专属',
      brandCustomerCode: 'CUST-001',
      customerSkuCode: 'CUS-SKU-001',
      customerSkuName: '华东沙发-A款',
    }]);

    expect(result).toEqual({ imported: 1, failed: 0, errors: [] });
    expect(createSkuMock).toHaveBeenCalledWith(expect.objectContaining({
      brandScope: 'customer',
      brandCustomerId: 88,
      customerRefs: [{
        customerId: 88,
        customerSkuCode: 'CUS-SKU-001',
        customerSkuName: '华东沙发-A款',
        status: 'active',
      }],
    }));
  });
});
