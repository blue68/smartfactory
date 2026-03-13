/**
 * [artifact:自动化测试] — 客户管理 Controller 集成测试
 *
 * 覆盖范围：
 *   GET    /api/customers          — 列表（分页 + 筛选）
 *   GET    /api/customers/options  — 下拉选项
 *   POST   /api/customers          — 新建客户
 *   GET    /api/customers/:id      — 客户详情
 *   PUT    /api/customers/:id      — 更新客户
 *   POST   /api/customers/:id/contacts       — 新增联系人
 *   DELETE /api/customers/:id/contacts/:cid  — 删除联系人
 */

import { authHeader } from '../helpers/setup';

// Mock CustomerService before importing app
jest.mock('../../src/modules/sales-customer/customer.service');

import request from 'supertest';
import app from '../../src/app';
import { CustomerService } from '../../src/modules/sales-customer/customer.service';

const MockCustomerService = CustomerService as jest.MockedClass<typeof CustomerService>;

const mockCustomer = {
  id: 1,
  tenantId: 1,
  code: 'C001',
  name: '测试客户',
  grade: 'A',
  contact: '张三',
  phone: '13800138000',
  email: 'test@example.com',
  address: '北京市',
  creditLimit: '100000.00',
  paymentDays: 30,
  status: 'active',
  notes: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockContact = {
  id: 10,
  customerId: 1,
  tenantId: 1,
  name: '李四',
  title: '采购经理',
  phone: '13900139000',
  email: 'lisi@example.com',
  isPrimary: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

beforeEach(() => {
  jest.clearAllMocks();
});

// ── 认证 ─────────────────────────────────────────────────────────────────

describe('Auth', () => {
  it('无 token 时返回 401', async () => {
    const res = await request(app).get('/api/customers');
    expect(res.status).toBe(401);
    expect(res.body.code).not.toBe(0);
  });

  it('无效 token 时返回 401', async () => {
    const res = await request(app)
      .get('/api/customers')
      .set('Authorization', 'Bearer invalid-token');
    expect(res.status).toBe(401);
  });
});

// ── GET /api/customers ────────────────────────────────────────────────────

describe('GET /api/customers', () => {
  it('返回分页客户列表', async () => {
    MockCustomerService.prototype.list = jest.fn().mockResolvedValue([[mockCustomer], 1]);

    const res = await request(app)
      .get('/api/customers')
      .set('Authorization', authHeader());

    expect(res.status).toBe(200);
    expect(res.body.code).toBe(0);
    expect(res.body.data.list).toHaveLength(1);
    expect(res.body.data.total).toBe(1);
    expect(res.body.data.page).toBe(1);
    expect(res.body.data.pageSize).toBe(20);
  });

  it('支持 keyword 过滤', async () => {
    MockCustomerService.prototype.list = jest.fn().mockResolvedValue([[], 0]);

    await request(app)
      .get(`/api/customers?keyword=${encodeURIComponent('测试')}`)
      .set('Authorization', authHeader());

    expect(MockCustomerService.prototype.list).toHaveBeenCalledWith(
      expect.objectContaining({ keyword: '测试' }),
    );
  });

  it('支持 grade 过滤', async () => {
    MockCustomerService.prototype.list = jest.fn().mockResolvedValue([[], 0]);

    await request(app)
      .get('/api/customers?grade=VIP')
      .set('Authorization', authHeader());

    expect(MockCustomerService.prototype.list).toHaveBeenCalledWith(
      expect.objectContaining({ grade: 'VIP' }),
    );
  });

  it('无效 grade 值返回 400', async () => {
    const res = await request(app)
      .get('/api/customers?grade=INVALID')
      .set('Authorization', authHeader());

    expect(res.status).toBe(400);
    expect(res.body.code).toBe(1001);
  });
});

// ── GET /api/customers/options ────────────────────────────────────────────

describe('GET /api/customers/options', () => {
  it('返回客户选项列表', async () => {
    const options = [{ id: 1, name: '测试客户', code: 'C001' }];
    MockCustomerService.prototype.getOptions = jest.fn().mockResolvedValue(options);

    const res = await request(app)
      .get('/api/customers/options')
      .set('Authorization', authHeader());

    expect(res.status).toBe(200);
    expect(res.body.code).toBe(0);
    expect(res.body.data).toEqual(options);
  });
});

// ── POST /api/customers ────────────────────────────────────────────────────

describe('POST /api/customers', () => {
  it('创建客户返回 201', async () => {
    MockCustomerService.prototype.create = jest.fn().mockResolvedValue(mockCustomer);

    const res = await request(app)
      .post('/api/customers')
      .set('Authorization', authHeader())
      .send({ code: 'C001', name: '测试客户' });

    expect(res.status).toBe(201);
    expect(res.body.code).toBe(0);
    expect(res.body.data.code).toBe('C001');
  });

  it('缺少 code 返回 400', async () => {
    const res = await request(app)
      .post('/api/customers')
      .set('Authorization', authHeader())
      .send({ name: '仅有名称' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe(1001);
  });

  it('缺少 name 返回 400', async () => {
    const res = await request(app)
      .post('/api/customers')
      .set('Authorization', authHeader())
      .send({ code: 'C002' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe(1001);
  });

  it('含可选字段时全部传递给 service', async () => {
    MockCustomerService.prototype.create = jest.fn().mockResolvedValue(mockCustomer);

    await request(app)
      .post('/api/customers')
      .set('Authorization', authHeader())
      .send({
        code: 'C003',
        name: '完整客户',
        grade: 'VIP',
        contact: '王五',
        phone: '13700137000',
        creditLimit: '50000.00',
        paymentDays: 60,
      });

    expect(MockCustomerService.prototype.create).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'C003',
        name: '完整客户',
        grade: 'VIP',
        paymentDays: 60,
      }),
    );
  });
});

// ── GET /api/customers/:id ──────────────────────────────────────────────

describe('GET /api/customers/:id', () => {
  it('返回客户详情', async () => {
    MockCustomerService.prototype.getById = jest.fn().mockResolvedValue(mockCustomer);

    const res = await request(app)
      .get('/api/customers/1')
      .set('Authorization', authHeader());

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(1);
  });
});

// ── PUT /api/customers/:id ──────────────────────────────────────────────

describe('PUT /api/customers/:id', () => {
  it('更新客户返回 200', async () => {
    MockCustomerService.prototype.update = jest.fn().mockResolvedValue({
      ...mockCustomer,
      name: '更新后客户',
    });

    const res = await request(app)
      .put('/api/customers/1')
      .set('Authorization', authHeader())
      .send({ name: '更新后客户' });

    expect(res.status).toBe(200);
    expect(res.body.code).toBe(0);
  });
});

// ── POST /api/customers/:id/contacts ────────────────────────────────────

describe('POST /api/customers/:id/contacts', () => {
  it('新增联系人返回 201', async () => {
    MockCustomerService.prototype.addContact = jest.fn().mockResolvedValue(mockContact);

    const res = await request(app)
      .post('/api/customers/1/contacts')
      .set('Authorization', authHeader())
      .send({ name: '李四', title: '采购经理', phone: '13900139000' });

    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('李四');
  });

  it('缺少 name 返回 400', async () => {
    const res = await request(app)
      .post('/api/customers/1/contacts')
      .set('Authorization', authHeader())
      .send({ title: '经理' });

    expect(res.status).toBe(400);
  });
});

// ── DELETE /api/customers/:id/contacts/:contactId ───────────────────────

describe('DELETE /api/customers/:id/contacts/:contactId', () => {
  it('删除联系人返回 200', async () => {
    MockCustomerService.prototype.removeContact = jest.fn().mockResolvedValue(undefined);

    const res = await request(app)
      .delete('/api/customers/1/contacts/10')
      .set('Authorization', authHeader());

    expect(res.status).toBe(200);
    expect(res.body.code).toBe(0);
  });
});
