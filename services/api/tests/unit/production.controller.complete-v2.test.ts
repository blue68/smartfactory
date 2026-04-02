const completeTaskMock = jest.fn();

jest.mock('../../src/modules/production/production.service', () => ({
  ProductionService: jest.fn().mockImplementation(() => ({
    completeTask: (...args: unknown[]) => completeTaskMock(...args),
  })),
}));

jest.mock('../../src/shared/ApiResponse', () => ({
  success: jest.fn(),
  created: jest.fn(),
  buildPaginated: jest.fn(),
}));

import { productionController } from '../../src/modules/production/production.controller';

describe('ProductionController completeTaskV2', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    completeTaskMock.mockResolvedValue(undefined);
  });

  it('accepts actualHours and forwards it to the service layer', async () => {
    const req = {
      params: { id: '123' },
      body: {
        completedQty: '10',
        actualHours: 3.5,
        notes: 'ok',
      },
      tenantId: 1,
      userId: 6,
    } as any;
    const res = {} as any;

    await productionController.completeTaskV2(req, res);

    expect(completeTaskMock).toHaveBeenCalledWith(123, expect.objectContaining({
      completedQty: '10',
      actualHours: 3.5,
      notes: 'ok',
    }));
  });

  it('requires actualHours for complete-v2', async () => {
    const req = {
      params: { id: '123' },
      body: {
        completedQty: '10',
      },
      tenantId: 1,
      userId: 6,
    } as any;
    const res = {} as any;

    await expect(productionController.completeTaskV2(req, res)).rejects.toThrow();
    expect(completeTaskMock).not.toHaveBeenCalled();
  });
});
