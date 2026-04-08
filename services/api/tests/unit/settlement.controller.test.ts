jest.mock('../../src/modules/settlement/settlement.service', () => {
  const actual = jest.requireActual('../../src/modules/settlement/settlement.service');
  return {
    ...actual,
    SettlementService: jest.fn(),
  };
});

import type { Request, Response } from 'express';
import { errorHandler } from '../../src/middleware/errorHandler';
import { settlementController } from '../../src/modules/settlement/settlement.controller';
import { SettlementService } from '../../src/modules/settlement/settlement.service';

const MockService = SettlementService as jest.MockedClass<typeof SettlementService>;
let consoleErrorSpy: jest.SpyInstance;
let consoleWarnSpy: jest.SpyInstance;

function createReq(overrides: Partial<Request> = {}): Request {
  return {
    tenantId: 1,
    userId: 9,
    roles: ['boss'],
    body: {},
    params: {},
    query: {},
    method: 'GET',
    path: '/api/settlements',
    ...overrides,
  } as Request;
}

function createRes(): Response {
  const res = {
    status: jest.fn(),
    json: jest.fn(),
    setHeader: jest.fn(),
    write: jest.fn(),
    end: jest.fn(),
  } as unknown as Response;

  (res.status as unknown as jest.Mock).mockReturnValue(res);
  return res;
}

async function runWithErrorHandler(
  fn: () => Promise<void>,
  req: Request,
  res: Response,
): Promise<void> {
  try {
    await fn();
  } catch (err) {
    errorHandler(err, req, res, jest.fn());
  }
}

beforeEach(() => {
  jest.clearAllMocks();
  consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
  consoleWarnSpy.mockRestore();
});

describe('SettlementController.listSettlements', () => {
  it('passes keyword and overdueOnly filters to service', async () => {
    MockService.prototype.listSettlements = jest.fn().mockResolvedValue({
      list: [],
      total: 0,
      page: 1,
      pageSize: 20,
    });

    const req = createReq({
      query: {
        page: '1',
        pageSize: '20',
        keyword: '华北客户',
        overdueOnly: 'true',
      },
    });
    const res = createRes();

    await settlementController.listSettlements(req, res);

    expect(MockService.prototype.listSettlements).toHaveBeenCalledWith({
      page: 1,
      pageSize: 20,
      keyword: '华北客户',
      overdueOnly: true,
    });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('maps invalid query to 400 response', async () => {
    const req = createReq({
      query: {
        page: '0',
        pageSize: '101',
      },
    });
    const res = createRes();

    await runWithErrorHandler(() => settlementController.listSettlements(req, res), req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 1001,
      }),
    );
  });
});

describe('SettlementController.listPendingOrders', () => {
  it('passes customerId and keyword filters to service', async () => {
    MockService.prototype.listPendingSettlementOrders = jest.fn().mockResolvedValue({
      list: [],
      total: 0,
      page: 1,
      pageSize: 8,
    });

    const req = createReq({
      query: {
        page: '1',
        pageSize: '8',
        customerId: '12',
        keyword: 'SO-202604',
      },
    });
    const res = createRes();

    await settlementController.listPendingOrders(req, res);

    expect(MockService.prototype.listPendingSettlementOrders).toHaveBeenCalledWith({
      page: 1,
      pageSize: 8,
      customerId: 12,
      keyword: 'SO-202604',
    });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('maps invalid query to 400 response', async () => {
    const req = createReq({
      query: {
        page: '0',
      },
    });
    const res = createRes();

    await runWithErrorHandler(() => settlementController.listPendingOrders(req, res), req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 1001,
      }),
    );
  });
});

describe('SettlementController.exportCsv', () => {
  it('writes CSV headers and rows from service data', async () => {
    MockService.prototype.listSettlementExportRows = jest.fn().mockResolvedValue([
      {
        id: 101,
        settlementNo: 'ST-101',
        customerId: 11,
        customerName: '华北客户',
        orderId: 201,
        orderNo: 'SO-201',
        totalAmount: '12800.00',
        status: 'draft',
        dueDate: '2026-03-10',
        confirmedBy: null,
        confirmedAt: null,
        paidAt: null,
        notes: null,
        createdBy: 9,
        createdAt: '2026-03-24 09:00:00',
        updatedAt: '2026-03-24 09:00:00',
      },
    ]);

    const req = createReq({
      query: {
        keyword: '华北客户',
        overdueOnly: 'true',
      },
      path: '/api/settlements/export/csv',
    });
    const res = createRes();

    await settlementController.exportCsv(req, res);

    expect(MockService.prototype.listSettlementExportRows).toHaveBeenCalledWith({
      page: 1,
      pageSize: 20,
      keyword: '华北客户',
      overdueOnly: true,
    });
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv; charset=utf-8');
    expect(res.write).toHaveBeenCalledWith(expect.stringContaining('结算单号'));
    expect(res.write).toHaveBeenCalledWith(expect.stringContaining('ST-101'));
    expect(res.write).toHaveBeenCalledWith(expect.stringContaining('草稿'));
    expect(res.write).toHaveBeenCalledWith(expect.stringContaining('2026-03-24 09:00:00'));
    expect(res.end).toHaveBeenCalled();
  });
});
