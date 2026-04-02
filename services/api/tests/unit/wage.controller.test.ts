jest.mock('../../src/modules/report/wage.service', () => ({
  WageService: jest.fn(),
}));

import type { Request, Response } from 'express';
import { errorHandler } from '../../src/middleware/errorHandler';
import { wageController } from '../../src/modules/report/wage.controller';
import { WageService } from '../../src/modules/report/wage.service';

const MockService = WageService as jest.MockedClass<typeof WageService>;
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
    path: '/api/reports/wages',
    ...overrides,
  } as Request;
}

function createRes(): Response {
  const res = {
    status: jest.fn(),
    json: jest.fn(),
    setHeader: jest.fn(),
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

describe('WageController.getWageReport', () => {
  it('parses admin wage query and forwards filters to service', async () => {
    MockService.prototype.getWageReport = jest.fn().mockResolvedValue([[], 0]);

    const req = createReq({
      query: {
        page: '1',
        pageSize: '20',
        dateFrom: '2026-03-01',
        dateTo: '2026-03-31',
        userId: '9',
        workerGrade: 'apprentice',
      },
      path: '/api/reports/wages',
    });
    const res = createRes();

    await wageController.getWageReport(req, res);

    expect(MockService.prototype.getWageReport).toHaveBeenCalledWith({
      page: 1,
      pageSize: 20,
      dateFrom: '2026-03-01',
      dateTo: '2026-03-31',
      userId: 9,
      workerGrade: 'apprentice',
    });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('maps invalid admin wage query to 400 response', async () => {
    const req = createReq({
      query: {
        page: '0',
        pageSize: '20',
      },
      path: '/api/reports/wages',
    });
    const res = createRes();

    await runWithErrorHandler(() => wageController.getWageReport(req, res), req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      code: 1001,
    }));
    expect(MockService.prototype.getWageReport).not.toHaveBeenCalled();
  });
});

describe('WageController.getTaskWageReport', () => {
  it('parses query and forwards task-level filters to service', async () => {
    MockService.prototype.getTaskWageReport = jest.fn().mockResolvedValue([[], 0]);

    const req = createReq({
      query: {
        page: '2',
        pageSize: '10',
        dateFrom: '2026-03-01',
        dateTo: '2026-03-31',
        userId: '9',
        workerGrade: 'skilled',
        productionOrderId: '99',
        taskId: '68',
      },
      path: '/api/reports/wages/tasks',
    });
    const res = createRes();

    await wageController.getTaskWageReport(req, res);

    expect(MockService.prototype.getTaskWageReport).toHaveBeenCalledWith({
      page: 2,
      pageSize: 10,
      dateFrom: '2026-03-01',
      dateTo: '2026-03-31',
      userId: 9,
      workerGrade: 'skilled',
      productionOrderId: 99,
      taskId: 68,
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      code: 0,
      data: expect.objectContaining({
        list: [],
        total: 0,
        page: 2,
        pageSize: 10,
      }),
    }));
  });

  it('maps invalid task report query to 400 response', async () => {
    const req = createReq({
      query: {
        page: '0',
        pageSize: '20',
        productionOrderId: '-1',
      },
      path: '/api/reports/wages/tasks',
    });
    const res = createRes();

    await runWithErrorHandler(() => wageController.getTaskWageReport(req, res), req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      code: 1001,
    }));
    expect(MockService.prototype.getTaskWageReport).not.toHaveBeenCalled();
  });
});

describe('WageController.getMyWages', () => {
  it('forces self query and only passes self-allowed filters', async () => {
    MockService.prototype.getMyWages = jest.fn().mockResolvedValue([[], 0]);

    const req = createReq({
      query: {
        page: '1',
        pageSize: '20',
        dateFrom: '2026-03-01',
        dateTo: '2026-03-31',
        userId: '999',
        workerGrade: 'apprentice',
      },
      path: '/api/reports/wages/my',
    });
    const res = createRes();

    await wageController.getMyWages(req, res);

    expect(MockService.prototype.getMyWages).toHaveBeenCalledWith({
      page: 1,
      pageSize: 20,
      dateFrom: '2026-03-01',
      dateTo: '2026-03-31',
    });
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe('WageController.exportExcel', () => {
  it('parses export query, calls service, and sets excel response headers', async () => {
    MockService.prototype.exportWages = jest.fn().mockResolvedValue([
      {
        userId: 9,
        userName: '张三',
        workerGrade: 'skilled',
        stepName: '封边',
        qty: 12,
        unitPrice: '8.00',
        subtotal: '96.00',
        reportDate: '2026-03-30',
      },
    ]);

    const req = createReq({
      query: {
        dateFrom: '2026-03-01',
        dateTo: '2026-03-31',
        userId: '9',
        workerGrade: 'skilled',
      },
      path: '/api/reports/wages/export',
    });
    const res = createRes();

    await wageController.exportExcel(req, res);

    expect(MockService.prototype.exportWages).toHaveBeenCalledWith({
      dateFrom: '2026-03-01',
      dateTo: '2026-03-31',
      userId: 9,
      workerGrade: 'skilled',
    });
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect((res.setHeader as unknown as jest.Mock).mock.calls).toEqual(
      expect.arrayContaining([
        ['Content-Disposition', expect.stringContaining("filename*=")],
      ]),
    );
    expect(res.end).toHaveBeenCalledWith(expect.any(Buffer));
  });

  it('maps invalid export query to 400 response', async () => {
    const req = createReq({
      query: {
        dateFrom: '2026/03/01',
      },
      path: '/api/reports/wages/export',
    });
    const res = createRes();

    await runWithErrorHandler(() => wageController.exportExcel(req, res), req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      code: 1001,
    }));
    expect(MockService.prototype.exportWages).not.toHaveBeenCalled();
  });
});
