/**
 * [artifact:自动化测试] — 销售订单 Controller 集成测试
 *
 * 覆盖范围：
 *   GET  /api/sales-orders            — 列表
 *   POST /api/sales-orders            — 创建
 *   GET  /api/sales-orders/:id        — 详情
 *   POST /api/sales-orders/:id/submit — 提交审批
 *   POST /api/sales-orders/:id/approve — 审批通过
 *   POST /api/sales-orders/:id/reject  — 驳回
 *   POST /api/sales-orders/:id/withdraw — 撤回
 *   POST /api/sales-orders/:id/transition — 状态流转
 */

import { authHeader } from '../helpers/setup';

jest.mock('../../src/modules/sales-order/salesOrder.service');

import request from 'supertest';
import app from '../../src/app';
import { SalesOrderService } from '../../src/modules/sales-order/salesOrder.service';

const MockService = SalesOrderService as jest.MockedClass<typeof SalesOrderService>;

const mockOrder = {
  id: 1,
  tenantId: 1,
  orderNo: 'SO-2025-0001',
  customerId: 10,
  orderDate: '2025-01-01',
  deliveryDate: '2025-02-01',
  isUrgent: false,
  status: 'draft',
  totalAmount: '5000.00',
  notes: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

beforeEach(() => {
  jest.clearAllMocks();
});

// ── 认证 ─────────────────────────────────────────────────────────────────

describe('Auth', () => {
  it('无 token 时返回 401', async () => {
    const res = await request(app).get('/api/sales-orders');
    expect(res.status).toBe(401);
  });
});

// ── GET /api/sales-orders ─────────────────────────────────────────────────

describe('GET /api/sales-orders', () => {
  it('返回分页订单列表', async () => {
    MockService.prototype.list = jest.fn().mockResolvedValue({
      list: [mockOrder],
      total: 1,
    });

    const res = await request(app)
      .get('/api/sales-orders')
      .set('Authorization', authHeader());

    expect(res.status).toBe(200);
    expect(res.body.code).toBe(0);
    expect(res.body.data.list).toHaveLength(1);
    expect(res.body.data.total).toBe(1);
  });

  it('支持 status 过滤', async () => {
    MockService.prototype.list = jest.fn().mockResolvedValue({ list: [], total: 0 });

    await request(app)
      .get('/api/sales-orders?status=pending_approval')
      .set('Authorization', authHeader());

    expect(MockService.prototype.list).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pending_approval' }),
    );
  });

  it('支持 keyword + customerId 组合过滤', async () => {
    MockService.prototype.list = jest.fn().mockResolvedValue({ list: [], total: 0 });

    await request(app)
      .get('/api/sales-orders?keyword=SO-2025&customerId=10')
      .set('Authorization', authHeader());

    expect(MockService.prototype.list).toHaveBeenCalledWith(
      expect.objectContaining({ keyword: 'SO-2025', customerId: 10 }),
    );
  });

  it('支持 isUrgent 过滤', async () => {
    MockService.prototype.list = jest.fn().mockResolvedValue({ list: [], total: 0 });

    await request(app)
      .get('/api/sales-orders?isUrgent=true')
      .set('Authorization', authHeader());

    expect(MockService.prototype.list).toHaveBeenCalledWith(
      expect.objectContaining({ isUrgent: true }),
    );
  });

  it('无效 status 值返回 400', async () => {
    const res = await request(app)
      .get('/api/sales-orders?status=invalid_status')
      .set('Authorization', authHeader());

    expect(res.status).toBe(400);
    expect(res.body.code).toBe(1001);
  });
});

// ── POST /api/sales-orders ────────────────────────────────────────────────

describe('POST /api/sales-orders', () => {
  const validPayload = {
    customerId: 10,
    orderDate: '2025-03-01',
    deliveryDate: '2025-04-01',
    isUrgent: false,
    items: [
      { skuId: 1, quantity: 100, unitPrice: '50.00' },
    ],
  };

  it('创建订单返回 201', async () => {
    MockService.prototype.create = jest.fn().mockResolvedValue(mockOrder);

    const res = await request(app)
      .post('/api/sales-orders')
      .set('Authorization', authHeader())
      .send(validPayload);

    expect(res.status).toBe(201);
    expect(res.body.code).toBe(0);
    expect(res.body.data.orderNo).toBe('SO-2025-0001');
  });

  it('quantity 被转换为 string 传给 service', async () => {
    MockService.prototype.create = jest.fn().mockResolvedValue(mockOrder);

    await request(app)
      .post('/api/sales-orders')
      .set('Authorization', authHeader())
      .send(validPayload);

    const callArgs = (MockService.prototype.create as jest.Mock).mock.calls[0][0];
    expect(callArgs.items[0].quantity).toBe('100');
  });

  it('缺少 customerId 返回 400', async () => {
    const res = await request(app)
      .post('/api/sales-orders')
      .set('Authorization', authHeader())
      .send({ orderDate: '2025-03-01', deliveryDate: '2025-04-01' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe(1001);
  });

  it('日期格式错误返回 400', async () => {
    const res = await request(app)
      .post('/api/sales-orders')
      .set('Authorization', authHeader())
      .send({ ...validPayload, orderDate: '2025/03/01' });

    expect(res.status).toBe(400);
  });

  it('无 items 时默认为空数组', async () => {
    MockService.prototype.create = jest.fn().mockResolvedValue(mockOrder);

    await request(app)
      .post('/api/sales-orders')
      .set('Authorization', authHeader())
      .send({
        customerId: 10,
        orderDate: '2025-03-01',
        deliveryDate: '2025-04-01',
      });

    const callArgs = (MockService.prototype.create as jest.Mock).mock.calls[0][0];
    expect(callArgs.items).toEqual([]);
  });
});

// ── GET /api/sales-orders/:id ─────────────────────────────────────────────

describe('GET /api/sales-orders/:id', () => {
  it('返回订单详情', async () => {
    MockService.prototype.getById = jest.fn().mockResolvedValue(mockOrder);

    const res = await request(app)
      .get('/api/sales-orders/1')
      .set('Authorization', authHeader());

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(1);
  });
});

// ── POST /api/sales-orders/:id/submit ─────────────────────────────────────

describe('POST /api/sales-orders/:id/submit', () => {
  it('提交审批返回 200', async () => {
    MockService.prototype.submitForApproval = jest.fn().mockResolvedValue(undefined);

    const res = await request(app)
      .post('/api/sales-orders/1/submit')
      .set('Authorization', authHeader());

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('已提交审批');
  });
});

// ── POST /api/sales-orders/:id/approve ────────────────────────────────────

describe('POST /api/sales-orders/:id/approve', () => {
  it('boss 角色可审批通过', async () => {
    MockService.prototype.approve = jest.fn().mockResolvedValue(undefined);

    const res = await request(app)
      .post('/api/sales-orders/1/approve')
      .set('Authorization', authHeader({ roles: ['boss'] }));

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('订单已审批通过');
  });

  it('非 boss 角色返回 403', async () => {
    const res = await request(app)
      .post('/api/sales-orders/1/approve')
      .set('Authorization', authHeader({ roles: ['worker'] }));

    expect(res.status).toBe(403);
  });
});

// ── POST /api/sales-orders/:id/reject ─────────────────────────────────────

describe('POST /api/sales-orders/:id/reject', () => {
  it('boss 角色可驳回并需提供 reason', async () => {
    MockService.prototype.reject = jest.fn().mockResolvedValue(undefined);

    const res = await request(app)
      .post('/api/sales-orders/1/reject')
      .set('Authorization', authHeader({ roles: ['boss'] }))
      .send({ reason: '交期无法满足' });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('订单已驳回');
  });

  it('缺少 reason 返回 400', async () => {
    const res = await request(app)
      .post('/api/sales-orders/1/reject')
      .set('Authorization', authHeader({ roles: ['boss'] }))
      .send({});

    expect(res.status).toBe(400);
  });

  it('非 boss 角色返回 403', async () => {
    const res = await request(app)
      .post('/api/sales-orders/1/reject')
      .set('Authorization', authHeader({ roles: ['sales'] }))
      .send({ reason: '测试' });

    expect(res.status).toBe(403);
  });
});

// ── POST /api/sales-orders/:id/withdraw ───────────────────────────────────

describe('POST /api/sales-orders/:id/withdraw', () => {
  it('撤回审批返回 200', async () => {
    MockService.prototype.withdraw = jest.fn().mockResolvedValue(undefined);

    const res = await request(app)
      .post('/api/sales-orders/1/withdraw')
      .set('Authorization', authHeader());

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('审批已撤回');
  });
});

// ── POST /api/sales-orders/:id/transition ─────────────────────────────────

describe('POST /api/sales-orders/:id/transition', () => {
  it('状态流转返回 200', async () => {
    MockService.prototype.transition = jest.fn().mockResolvedValue(undefined);

    const res = await request(app)
      .post('/api/sales-orders/1/transition')
      .set('Authorization', authHeader())
      .send({ targetStatus: 'confirmed' });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('订单状态已更新');
  });

  it('无效 targetStatus 返回 400', async () => {
    const res = await request(app)
      .post('/api/sales-orders/1/transition')
      .set('Authorization', authHeader())
      .send({ targetStatus: 'invalid' });

    expect(res.status).toBe(400);
  });
});
