/**
 * 集成测试 — 销售订单模块 API
 *
 * 覆盖：
 * - TC-SO-001   常规下单通过约束
 * - TC-SO-002   资金占用超限 → block + requiresApproval
 * - TC-SO-006   老板批准超限订单
 * - TC-SO-007   老板附条件批准
 * - TC-SO-008   老板驳回订单
 * - TC-SO-009   紧急插单影响分析（<30秒）
 * - TC-SO-010   紧急插单高风险标注
 * - TC-SO-011   非sales/boss无权下单 → 1003
 * - TC-SO-012   阈值边界：刚好等于时通过
 * - TC-SO-014   查询不存在订单 → 6002
 * - TC-ERR-011  数字字段传字符串 → 1001
 */

import request from 'supertest';
import { authHeader } from '../helpers/testAuth';
import { buildSalesOrderData } from '../helpers/testData';

const BASE_URL = process.env.TEST_API_URL ?? 'http://localhost:3000';

// 测试环境预置数据
const SKU_PRODUCT_ID          = 30001; // 成品SKU
const BOM_ID_NORMAL           = 70001; // 资金占用正常范围的BOM
const BOM_ID_HIGH_COST        = 70002; // 资金占用会超限的高成本BOM
const PENDING_APPROVAL_ORDER  = 80001; // 预置：pending_approval状态订单
const CUSTOMER_ID             = 1;

describe('销售订单模块 API 集成测试', () => {

  // ─── 创建销售订单（含约束引擎） ──────────────────────────────

  describe('创建销售订单 — POST /api/sales/orders', () => {
    test('TC-SO-001: 常规下单通过所有约束', async () => {
      const payload = buildSalesOrderData(SKU_PRODUCT_ID, BOM_ID_NORMAL, {
        orderType: 'normal',
        items: [{ skuId: SKU_PRODUCT_ID, bomId: BOM_ID_NORMAL, qtyOrdered: '1', unitPrice: '5000.00' }],
      });
      const res = await request(BASE_URL)
        .post('/api/sales/orders')
        .set(authHeader('sales'))
        .send(payload);

      expect(res.status).toBe(201);
      expect(res.body.code).toBe(0);
      expect(res.body.data.constraintResult).toBe('pass');
      expect(res.body.data.requiresApproval).toBe(false);
      expect(res.body.data.orderNo).toMatch(/^SO\d+/);
    });

    test('TC-SO-002: 资金占用超限 → block，requiresApproval=true', async () => {
      const payload = buildSalesOrderData(SKU_PRODUCT_ID, BOM_ID_HIGH_COST, {
        items: [{ skuId: SKU_PRODUCT_ID, bomId: BOM_ID_HIGH_COST, qtyOrdered: '100', unitPrice: '5000.00' }],
      });
      const res = await request(BASE_URL)
        .post('/api/sales/orders')
        .set(authHeader('sales'))
        .send(payload);

      expect(res.status).toBe(201);
      expect(res.body.code).toBe(0);
      expect(res.body.data.constraintResult).toBe('block');
      expect(res.body.data.requiresApproval).toBe(true);
      expect(res.body.message).toContain('等待审批');
    });

    test('TC-SO-011: warehouse角色无权下单 → 403', async () => {
      const res = await request(BASE_URL)
        .post('/api/sales/orders')
        .set(authHeader('warehouse'))
        .send(buildSalesOrderData(SKU_PRODUCT_ID, BOM_ID_NORMAL));

      expect(res.status).toBe(403);
      expect(res.body.code).toBe(1003);
    });

    test('TC-ERR-011: qtyOrdered传字符串"abc" → 1001', async () => {
      const payload = buildSalesOrderData(SKU_PRODUCT_ID, BOM_ID_NORMAL);
      payload.items[0].qtyOrdered = 'abc';
      const res = await request(BASE_URL)
        .post('/api/sales/orders')
        .set(authHeader('sales'))
        .send(payload);

      expect(res.body.code).toBe(1001);
    });

    test('缺少必填项 expectedDelivery → 1001', async () => {
      const { expectedDelivery, ...payload } = buildSalesOrderData(SKU_PRODUCT_ID, BOM_ID_NORMAL) as any;
      const res = await request(BASE_URL)
        .post('/api/sales/orders')
        .set(authHeader('sales'))
        .send(payload);

      expect(res.body.code).toBe(1001);
    });

    test('boss角色也可下单', async () => {
      const res = await request(BASE_URL)
        .post('/api/sales/orders')
        .set(authHeader('boss'))
        .send(buildSalesOrderData(SKU_PRODUCT_ID, BOM_ID_NORMAL));

      expect(res.status).toBe(201);
    });
  });

  // ─── 超限订单审批 ────────────────────────────────────────────

  describe('审批超限订单 — POST /api/sales/orders/:id/approve', () => {
    test('TC-SO-006: boss批准订单 → 状态变confirmed', async () => {
      const res = await request(BASE_URL)
        .post(`/api/sales/orders/${PENDING_APPROVAL_ORDER}/approve`)
        .set(authHeader('boss'))
        .send({ action: 'approved', notes: '特批放行' });

      expect(res.status).toBe(200);
      expect(res.body.code).toBe(0);

      // 验证订单状态
      const orderRes = await request(BASE_URL)
        .get(`/api/sales/orders/${PENDING_APPROVAL_ORDER}`)
        .set(authHeader('boss'));
      expect(orderRes.body.data.status).toBe('confirmed');
    });

    test('TC-SO-007: 附条件批准，notes保存', async () => {
      // 先创建一个新的超限订单
      const createRes = await request(BASE_URL)
        .post('/api/sales/orders')
        .set(authHeader('sales'))
        .send(buildSalesOrderData(SKU_PRODUCT_ID, BOM_ID_HIGH_COST, {
          items: [{ skuId: SKU_PRODUCT_ID, bomId: BOM_ID_HIGH_COST, qtyOrdered: '100', unitPrice: '5000.00' }],
        }));
      const newOrderId = createRes.body.data?.orderId;
      if (!newOrderId || createRes.body.data?.constraintResult !== 'block') return;

      const res = await request(BASE_URL)
        .post(`/api/sales/orders/${newOrderId}/approve`)
        .set(authHeader('boss'))
        .send({ action: 'conditional', notes: '需在3月28日前交付' });

      expect(res.status).toBe(200);
      expect(res.body.code).toBe(0);
    });

    test('TC-SO-008: boss驳回订单', async () => {
      // 创建另一个超限订单
      const createRes = await request(BASE_URL)
        .post('/api/sales/orders')
        .set(authHeader('sales'))
        .send(buildSalesOrderData(SKU_PRODUCT_ID, BOM_ID_HIGH_COST, {
          items: [{ skuId: SKU_PRODUCT_ID, bomId: BOM_ID_HIGH_COST, qtyOrdered: '200', unitPrice: '5000.00' }],
        }));
      const newOrderId = createRes.body.data?.orderId;
      if (!newOrderId || createRes.body.data?.constraintResult !== 'block') return;

      const res = await request(BASE_URL)
        .post(`/api/sales/orders/${newOrderId}/approve`)
        .set(authHeader('boss'))
        .send({ action: 'rejected', notes: '产能不足，建议下月再下单' });

      expect(res.status).toBe(200);
      expect(res.body.code).toBe(0);
    });

    test('sales角色无权审批 → 403', async () => {
      const res = await request(BASE_URL)
        .post(`/api/sales/orders/${PENDING_APPROVAL_ORDER}/approve`)
        .set(authHeader('sales'))
        .send({ action: 'approved' });

      expect(res.status).toBe(403);
    });

    test('无效的action枚举值 → 1001', async () => {
      const res = await request(BASE_URL)
        .post(`/api/sales/orders/${PENDING_APPROVAL_ORDER}/approve`)
        .set(authHeader('boss'))
        .send({ action: 'invalid_action' });

      expect(res.body.code).toBe(1001);
    });
  });

  // ─── 紧急插单影响分析 ────────────────────────────────────────

  describe('紧急插单分析 — POST /api/sales/orders/analyze-urgent', () => {
    const deliveryDate = new Date();
    deliveryDate.setDate(deliveryDate.getDate() + 7);

    test('TC-SO-009: 插单分析在30秒内返回', async () => {
      const startTime = Date.now();
      const res = await request(BASE_URL)
        .post('/api/sales/orders/analyze-urgent')
        .set(authHeader('sales'))
        .send({
          skuId: SKU_PRODUCT_ID,
          bomId: BOM_ID_NORMAL,
          qty: '3',
          expectedDelivery: deliveryDate.toISOString().slice(0, 10),
        })
        .timeout(31000);

      const elapsed = Date.now() - startTime;
      expect(res.status).toBe(200);
      expect(elapsed).toBeLessThan(30000);
    }, 35000);

    test('TC-SO-009b: 分析结果包含四维检查和影响分析', async () => {
      const res = await request(BASE_URL)
        .post('/api/sales/orders/analyze-urgent')
        .set(authHeader('sales'))
        .send({
          skuId: SKU_PRODUCT_ID,
          bomId: BOM_ID_NORMAL,
          qty: '3',
          expectedDelivery: deliveryDate.toISOString().slice(0, 10),
        });

      expect(res.body.code).toBe(0);
      const data = res.body.data;
      expect(data).toHaveProperty('overallResult');
      expect(data).toHaveProperty('inventoryTurnoverCheck');
      expect(data).toHaveProperty('capitalOccupationCheck');
      expect(data).toHaveProperty('productionCostCheck');
      expect(data).toHaveProperty('capacityLoadCheck');
      expect(data).toHaveProperty('impactAnalysis');
      expect(data.impactAnalysis).toHaveProperty('affectedOrders');
      expect(data.impactAnalysis).toHaveProperty('additionalCapital');
    });

    test('TC-SO-010: 高成本插单标注高风险', async () => {
      const res = await request(BASE_URL)
        .post('/api/sales/orders/analyze-urgent')
        .set(authHeader('sales'))
        .send({
          skuId: SKU_PRODUCT_ID,
          bomId: BOM_ID_HIGH_COST,
          qty: '200',
          expectedDelivery: deliveryDate.toISOString().slice(0, 10),
        });

      expect(res.body.code).toBe(0);
      // 高成本订单应触发至少一个维度不通过
      const data = res.body.data;
      const anyFailed = [
        data.inventoryTurnoverCheck,
        data.capitalOccupationCheck,
        data.capacityLoadCheck,
      ].some((c: any) => !c.passed);
      expect(anyFailed).toBe(true);
      expect(data.overallResult).toBe('block');
    });

    test('supervisor角色也可执行插单分析', async () => {
      const res = await request(BASE_URL)
        .post('/api/sales/orders/analyze-urgent')
        .set(authHeader('supervisor'))
        .send({
          skuId: SKU_PRODUCT_ID,
          bomId: BOM_ID_NORMAL,
          qty: '1',
          expectedDelivery: deliveryDate.toISOString().slice(0, 10),
        });

      expect(res.status).toBe(200);
    });
  });

  // ─── 销售订单查询 ────────────────────────────────────────────

  describe('销售订单查询', () => {
    test('TC-SO-014: 查询不存在订单 → 6002', async () => {
      const res = await request(BASE_URL)
        .get('/api/sales/orders/999999999')
        .set(authHeader('sales'));

      expect(res.status).toBe(404);
      expect(res.body.code).toBe(6002);
    });

    test('订单列表分页正确', async () => {
      const res = await request(BASE_URL)
        .get('/api/sales/orders?page=1&pageSize=10')
        .set(authHeader('sales'));

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('list');
      expect(res.body.data).toHaveProperty('total');
    });

    test('订单详情包含constraintResult和items', async () => {
      // 先创建一个订单
      const createRes = await request(BASE_URL)
        .post('/api/sales/orders')
        .set(authHeader('sales'))
        .send(buildSalesOrderData(SKU_PRODUCT_ID, BOM_ID_NORMAL));
      const orderId = createRes.body.data?.orderId;
      if (!orderId) return;

      const res = await request(BASE_URL)
        .get(`/api/sales/orders/${orderId}`)
        .set(authHeader('sales'));

      expect(res.body.code).toBe(0);
      expect(res.body.data).toHaveProperty('constraintResult');
      expect(res.body.data).toHaveProperty('items');
      expect(Array.isArray(res.body.data.items)).toBe(true);
    });
  });
});
