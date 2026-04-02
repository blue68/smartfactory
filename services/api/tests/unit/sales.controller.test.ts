jest.mock('../../src/modules/sales/sales.service');

import type { Request, Response } from 'express';
import { errorHandler } from '../../src/middleware/errorHandler';
import { salesController } from '../../src/modules/sales/sales.controller';
import { SalesService } from '../../src/modules/sales/sales.service';

const MockService = SalesService as jest.MockedClass<typeof SalesService>;
let consoleErrorSpy: jest.SpyInstance;

function createReq(overrides: Partial<Request> = {}): Request {
  return {
    tenantId: 1,
    userId: 9,
    roles: ['sales'],
    body: {},
    params: {},
    query: {},
    method: 'POST',
    path: '/api/sales/orders',
    ...overrides,
  } as Request;
}

function createRes(): Response {
  const res = {
    status: jest.fn(),
    json: jest.fn(),
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
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
});

describe('SalesController.create', () => {
  const validPayload = {
    customerId: 12,
    orderType: 'normal',
    expectedDelivery: '2026-04-03',
    notes: '常规订单自动确认',
    items: [
      {
        skuId: 901,
        bomId: 11,
        qtyOrdered: '9',
        unitPrice: '680.00',
      },
    ],
  };

  it('returns created response for normal orders', async () => {
    MockService.prototype.createOrder = jest.fn().mockResolvedValue({
      orderId: 501,
      orderNo: 'SO-NORMAL-1',
      constraintResult: 'pass',
      estimatedDelivery: null,
      requiresApproval: false,
    });

    const req = createReq({ body: validPayload });
    const res = createRes();

    await salesController.create(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      code: 0,
      data: {
        orderId: 501,
        orderNo: 'SO-NORMAL-1',
        constraintResult: 'pass',
        estimatedDelivery: null,
        requiresApproval: false,
      },
      message: '订单创建成功',
    });
    expect(MockService.prototype.createOrder).toHaveBeenCalledWith(validPayload);
  });

  it('returns approval message for blocked urgent orders', async () => {
    MockService.prototype.createOrder = jest.fn().mockResolvedValue({
      orderId: 502,
      orderNo: 'SO-URGENT-1',
      constraintResult: 'block',
      estimatedDelivery: null,
      requiresApproval: true,
    });

    const req = createReq({
      body: {
        ...validPayload,
        customerId: 13,
        orderType: 'urgent',
        expectedDelivery: '2026-03-29',
      },
    });
    const res = createRes();

    await salesController.create(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      code: 0,
      data: {
        orderId: 502,
        orderNo: 'SO-URGENT-1',
        constraintResult: 'block',
        estimatedDelivery: null,
        requiresApproval: true,
      },
      message: '订单已提交，等待审批',
    });
  });

  it('maps validation errors to 400 response', async () => {
    const req = createReq({
      body: {
        customerId: 12,
        orderType: 'normal',
        expectedDelivery: '2026/04/03',
        items: [],
      },
    });
    const res = createRes();

    await runWithErrorHandler(() => salesController.create(req, res), req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 1001,
        message: expect.stringContaining('参数校验失败'),
      }),
    );
  });
});

describe('SalesController.analyzeUrgent', () => {
  const validPayload = {
    skuId: 903,
    bomId: 15,
    qty: '7',
    expectedDelivery: '2026-03-29',
  };

  it('returns analysis result with success wrapper', async () => {
    MockService.prototype.analyzeUrgentOrder = jest.fn().mockResolvedValue({
      overallResult: 'warn',
      inventoryTurnoverCheck: { passed: true, currentValue: '28天', threshold: '45天', detail: '库存周转正常' },
      capitalOccupationCheck: { passed: true, currentValue: '18万', threshold: '25万', detail: '资金占用可控' },
      productionCostCheck: { passed: true, currentValue: '6120', threshold: '7000', detail: '成本增加有限' },
      capacityLoadCheck: { passed: false, currentValue: '92%', threshold: '85%', detail: '未来三天产能负荷偏高' },
      blockedReasons: ['未来三天产能负荷偏高'],
      impactAnalysis: {
        affectedOrders: [{ orderId: 202, orderNo: 'SO-202', delayDays: 1 }],
        additionalCapital: '180000.00',
        turnoverDaysChange: '+2',
        additionalProductionCost: '1200.00',
      },
    });

    const req = createReq({
      body: validPayload,
      path: '/api/sales/orders/analyze-urgent',
    });
    const res = createRes();

    await salesController.analyzeUrgent(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 0,
        message: '插单影响分析完成',
        data: expect.objectContaining({
          overallResult: 'warn',
          capacityLoadCheck: expect.objectContaining({
            detail: '未来三天产能负荷偏高',
          }),
        }),
      }),
    );
    expect(MockService.prototype.analyzeUrgentOrder).toHaveBeenCalledWith(validPayload);
  });

  it('maps invalid payload to 400 response', async () => {
    const req = createReq({
      body: {
        skuId: 903,
        bomId: 15,
        qty: '7.12345',
        expectedDelivery: '2026/03/29',
      },
      path: '/api/sales/orders/analyze-urgent',
    });
    const res = createRes();

    await runWithErrorHandler(() => salesController.analyzeUrgent(req, res), req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 1001,
        message: expect.stringContaining('参数校验失败'),
      }),
    );
  });
});

describe('SalesController settlements', () => {
  it('createSettlement wraps created response', async () => {
    MockService.prototype.createSettlement = jest.fn().mockResolvedValue({
      settlementId: 801,
      settlementNo: 'ST-0001',
    });

    const req = createReq({
      params: { id: '21' },
      body: { dueDate: '2026-04-10', notes: '首张结算单' },
      path: '/api/sales/orders/21/settlement',
    });
    const res = createRes();

    await salesController.createSettlement(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      code: 0,
      data: { settlementId: 801, settlementNo: 'ST-0001' },
      message: '结算单创建成功',
    });
  });

  it('recordPayment wraps success response', async () => {
    MockService.prototype.recordPayment = jest.fn().mockResolvedValue({
      paymentId: 901,
      settlementStatus: 'partial_paid',
    });

    const req = createReq({
      params: { settlementId: '31' },
      body: {
        paymentAmount: '300.00',
        paymentMethod: 'bank_transfer',
        paymentDate: '2026-03-24',
      },
      path: '/api/sales/orders/settlements/31/payments',
    });
    const res = createRes();

    await salesController.recordPayment(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      code: 0,
      data: { paymentId: 901, settlementStatus: 'partial_paid' },
      message: '付款记录已录入',
    });
  });

  it('recordPayment maps invalid payload to 400 response', async () => {
    const req = createReq({
      params: { settlementId: '31' },
      body: {
        paymentAmount: '300.123',
        paymentDate: '2026/03/24',
      },
      path: '/api/sales/orders/settlements/31/payments',
    });
    const res = createRes();

    await runWithErrorHandler(() => salesController.recordPayment(req, res), req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 1001,
        message: expect.stringContaining('参数校验失败'),
      }),
    );
  });

  it('updateInvoice validates payload and returns success response', async () => {
    MockService.prototype.updateInvoice = jest.fn().mockResolvedValue(undefined);

    const req = createReq({
      params: { settlementId: '31' },
      body: {
        invoiceNo: 'INV-20260324-01',
        invoiceDate: '2026-03-24',
      },
      path: '/api/sales/orders/settlements/31/invoice',
    });
    const res = createRes();

    await salesController.updateInvoice(req, res);

    expect(MockService.prototype.updateInvoice).toHaveBeenCalledWith(31, {
      invoiceNo: 'INV-20260324-01',
      invoiceDate: '2026-03-24',
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      code: 0,
      data: null,
      message: '开票信息已更新',
    });
  });

  it('updateInvoice maps invalid payload to 400 response', async () => {
    const req = createReq({
      params: { settlementId: '31' },
      body: {
        invoiceNo: 'INV-20260324-01',
        invoiceDate: '2026/03/24',
      },
      path: '/api/sales/orders/settlements/31/invoice',
    });
    const res = createRes();

    await runWithErrorHandler(() => salesController.updateInvoice(req, res), req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 1001,
        message: expect.stringContaining('参数校验失败'),
      }),
    );
  });

  it('getReceivables returns receivable summary', async () => {
    MockService.prototype.getReceivableSummary = jest.fn().mockResolvedValue({
      totalReceivable: '1300.00',
      overdueAmount: '800.00',
      overdueCount: 1,
      settlements: [{ id: 41, order_no: 'SO-41' }],
    });

    const req = createReq({
      method: 'GET',
      path: '/api/sales/orders/receivables',
    });
    const res = createRes();

    await salesController.getReceivables(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      code: 0,
      data: {
        totalReceivable: '1300.00',
        overdueAmount: '800.00',
        overdueCount: 1,
        settlements: [{ id: 41, order_no: 'SO-41' }],
      },
      message: '操作成功',
    });
  });
});
