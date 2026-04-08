jest.mock('../../src/config/database', () => ({
  AppDataSource: {
    query: jest.fn(),
    transaction: jest.fn(),
  },
}));

import { AppDataSource } from '../../src/config/database';
import { InventoryService } from '../../src/modules/inventory/inventory.service';

const mockQuery = AppDataSource.query as jest.Mock;
const mockTransaction = AppDataSource.transaction as jest.Mock;

describe('InventoryService master data csv import', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('imports warehouses with duplicate-code validation', async () => {
    const managerQuery = jest.fn().mockResolvedValue({ insertId: 1 });
    mockTransaction.mockImplementation(async (handler: (manager: { query: jest.Mock }) => Promise<unknown>) => {
      await handler({ query: managerQuery });
      return undefined;
    });

    const svc = new InventoryService({ tenantId: 1, userId: 9, roles: ['boss'] });
    const result = await svc.importWarehousesFromCsv(Buffer.from([
      'code,name,type,plantCode,status',
      'WH-MAIN,主仓库,physical,PLANT-01,active',
      'WH-MAIN,重复主仓,physical,PLANT-01,active',
    ].join('\n')));

    expect(result.totalRows).toBe(2);
    expect(result.successCount).toBe(1);
    expect(result.failCount).toBe(1);
    expect(result.failures[0]?.reason).toContain('仓库编码重复');
    expect(managerQuery).toHaveBeenCalledTimes(1);
  });

  it('rejects location import rows when parent hierarchy is cyclic', async () => {
    mockQuery
      .mockResolvedValueOnce([{ id: 11, code: 'WH-MAIN' }])
      .mockResolvedValueOnce([]);

    const svc = new InventoryService({ tenantId: 1, userId: 9, roles: ['boss'] });
    const result = await svc.importLocationsFromCsv(Buffer.from([
      'warehouseCode,code,name,level,parentCode,status',
      'WH-MAIN,A,A区,1,B,active',
      'WH-MAIN,B,B区,1,A,active',
    ].join('\n')));

    expect(result.successCount).toBe(0);
    expect(result.failCount).toBe(2);
    expect(result.failures.every((f) => f.reason.includes('循环引用'))).toBe(true);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('imports locations with parent-child rows in the same csv', async () => {
    mockQuery
      .mockResolvedValueOnce([{ id: 11, code: 'WH-MAIN' }])
      .mockResolvedValueOnce([]);

    const managerQuery = jest.fn()
      .mockResolvedValueOnce({ insertId: 101 })
      .mockResolvedValueOnce({ insertId: 102 });
    mockTransaction.mockImplementation(async (handler: (manager: { query: jest.Mock }) => Promise<unknown>) => {
      await handler({ query: managerQuery });
      return undefined;
    });

    const svc = new InventoryService({ tenantId: 1, userId: 9, roles: ['boss'] });
    const result = await svc.importLocationsFromCsv(Buffer.from([
      'warehouseCode,code,name,level,parentCode,status',
      'WH-MAIN,A,A区,1,,active',
      'WH-MAIN,A-01,A区-01货架,2,A,active',
    ].join('\n')));

    expect(result.totalRows).toBe(2);
    expect(result.successCount).toBe(2);
    expect(result.failCount).toBe(0);
    expect(managerQuery).toHaveBeenCalledTimes(2);
  });
});
