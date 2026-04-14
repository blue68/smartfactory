import { AppDataSource } from '../../src/config/database';
import { MrpService } from '../../src/modules/mrp/mrp.service';

jest.mock('../../src/config/database', () => ({
  AppDataSource: {
    query: jest.fn(),
    transaction: jest.fn(),
  },
}));

const mockAppDataSource = AppDataSource as unknown as {
  query: jest.Mock;
  transaction: jest.Mock;
};

describe('MrpService query guards', () => {
  it('detectShortage only queries production materials in mrp mode', async () => {
    const manager = {
      query: jest
        .fn()
        .mockResolvedValueOnce([{ id: 1001, work_order_no: 'WO-1001', material_status: 'ready' }])
        .mockResolvedValueOnce([]),
    };

    const svc = new MrpService({ tenantId: 7, userId: 11 });
    const result = await svc.detectShortage(1001, manager as any);

    expect(result).toEqual({ shortageItems: [], materialStatus: 'ready' });
    expect(String(manager.query.mock.calls[1][0])).toContain(`s.business_class = 'production_material'`);
    expect(String(manager.query.mock.calls[1][0])).toContain(`s.control_mode = 'mrp'`);
    expect(manager.query.mock.calls[1][1]).toEqual([1001, 7]);
  });

  it('getGlobalShortages only aggregates production materials in mrp mode', async () => {
    mockAppDataSource.query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ total: 0 }]);

    const svc = new MrpService({ tenantId: 7, userId: 11 });
    const result = await svc.getGlobalShortageSummary({ page: 1, pageSize: 20 });

    expect(result).toEqual({ list: [], total: 0 });
    expect(String(mockAppDataSource.query.mock.calls[0][0])).toContain(`s.business_class = 'production_material'`);
    expect(String(mockAppDataSource.query.mock.calls[0][0])).toContain(`s.control_mode = 'mrp'`);
    expect(mockAppDataSource.query.mock.calls[0][1]).toEqual([7, 20, 0]);
    expect(String(mockAppDataSource.query.mock.calls[1][0])).toContain(`s.business_class = 'production_material'`);
    expect(String(mockAppDataSource.query.mock.calls[1][0])).toContain(`s.control_mode = 'mrp'`);
    expect(mockAppDataSource.query.mock.calls[1][1]).toEqual([7]);
  });
});
