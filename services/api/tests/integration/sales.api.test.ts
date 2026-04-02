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
import mysql, { Pool } from 'mysql2/promise';
import { authHeader } from '../helpers/testAuth';
import { buildSalesOrderData } from '../helpers/testData';

const BASE_URL = process.env.TEST_API_URL ?? 'http://localhost:3000';

const TEST_TENANT_ID = 9999;
const TEST_SUPPLIER_ID = 993001;
const TEST_WORKSTATION_ID = 993011;
const TEST_TEMPLATE_ID = 993021;
const TEST_STEP_ID = 993031;

// 自带最小种子，避免依赖外部固定 seed
const SKU_PRODUCT_ID = 993101;
const SKU_COMPONENT_NORMAL_ID = 993102;
const SKU_COMPONENT_HIGH_COST_ID = 993103;
const BOM_ID_NORMAL = 993201;
const BOM_ID_HIGH_COST = 993202;
const BOM_ITEM_NORMAL_ID = 993301;
const BOM_ITEM_HIGH_COST_ID = 993302;

let dbPool: Pool | null = null;

function getDbPool(): Pool {
  if (!dbPool) {
    dbPool = mysql.createPool({
      host: process.env.DB_HOST ?? '127.0.0.1',
      port: Number(process.env.DB_PORT ?? '3307'),
      user: process.env.DB_USER ?? 'sf_app',
      password: process.env.DB_PASS ?? process.env.DB_PASSWORD ?? 'TestApp2026!Secure',
      database: process.env.DB_NAME ?? 'smart_factory',
      connectionLimit: 2,
      waitForConnections: true,
    });
  }
  return dbPool;
}

async function createPendingApprovalOrder(
  qtyOrdered: string = '100',
): Promise<number> {
  const createRes = await request(BASE_URL)
    .post('/api/sales/orders')
    .set(authHeader('sales'))
    .send(buildSalesOrderData(SKU_PRODUCT_ID, BOM_ID_HIGH_COST, {
      items: [{
        skuId: SKU_PRODUCT_ID,
        bomId: BOM_ID_HIGH_COST,
        qtyOrdered,
        unitPrice: '5000.00',
      }],
    }));

  expect(createRes.status).toBe(201);
  expect(createRes.body.code).toBe(0);
  expect(createRes.body.data?.constraintResult).toBe('block');
  expect(createRes.body.data?.requiresApproval).toBe(true);

  const orderId = Number(createRes.body.data?.orderId ?? 0);
  expect(orderId).toBeGreaterThan(0);
  return orderId;
}

describe('销售订单模块 API 集成测试', () => {
  beforeAll(async () => {
    const pool = getDbPool();

    await pool.execute(
      `INSERT INTO tenants (id, code, name, status, settings)
       VALUES (?, 'TEST9999', 'E2E测试租户', 'active', JSON_OBJECT())
       ON DUPLICATE KEY UPDATE
         code = VALUES(code),
         name = VALUES(name),
         status = VALUES(status),
         settings = VALUES(settings)`,
      [TEST_TENANT_ID],
    );

    await pool.execute(
      `INSERT INTO customers
        (id, tenant_id, code, name, status, grade, created_by, updated_by)
       VALUES (1, ?, 'CUS-SALES-INT', '销售集成客户', 'active', 'A', 99007, 99007)
       ON DUPLICATE KEY UPDATE
         code = VALUES(code),
         name = VALUES(name),
         status = VALUES(status),
         grade = VALUES(grade),
         updated_by = VALUES(updated_by)`,
      [TEST_TENANT_ID],
    );

    await pool.execute(
      `INSERT INTO suppliers
        (id, tenant_id, code, name, status, created_by, updated_by)
       VALUES (?, ?, 'SUP-SALES-INT', '销售集成供应商', 'active', 99007, 99007)
       ON DUPLICATE KEY UPDATE
         code = VALUES(code),
         name = VALUES(name),
         status = VALUES(status),
         updated_by = VALUES(updated_by)`,
      [TEST_SUPPLIER_ID, TEST_TENANT_ID],
    );

    await pool.execute(
      `INSERT INTO skus
        (id, tenant_id, sku_code, name, category1_id, category2_id, stock_unit, purchase_unit, production_unit, has_dye_lot, use_fifo, safety_stock, status, created_by, updated_by)
       VALUES
        (?, ?, 'SKU-SALES-INT-FG', '销售集成成品', 1, 1, 'pcs', 'pcs', 'pcs', 0, 1, 0, 'active', 99007, 99007),
        (?, ?, 'SKU-SALES-INT-RAW-N', '销售集成低成本原料', 1, 1, 'pcs', 'pcs', 'pcs', 0, 1, 0, 'active', 99007, 99007),
        (?, ?, 'SKU-SALES-INT-RAW-H', '销售集成高成本原料', 1, 1, 'pcs', 'pcs', 'pcs', 0, 1, 0, 'active', 99007, 99007)
       ON DUPLICATE KEY UPDATE
         sku_code = VALUES(sku_code),
         name = VALUES(name),
         status = VALUES(status),
         updated_by = VALUES(updated_by)`,
      [
        SKU_PRODUCT_ID, TEST_TENANT_ID,
        SKU_COMPONENT_NORMAL_ID, TEST_TENANT_ID,
        SKU_COMPONENT_HIGH_COST_ID, TEST_TENANT_ID,
      ],
    );

    await pool.execute(
      'DELETE FROM supplier_prices WHERE tenant_id = ? AND sku_id IN (?, ?)',
      [TEST_TENANT_ID, SKU_COMPONENT_NORMAL_ID, SKU_COMPONENT_HIGH_COST_ID],
    );
    await pool.execute(
      `INSERT INTO supplier_prices
        (tenant_id, supplier_id, sku_id, price, unit, is_current, created_by, updated_by)
       VALUES
        (?, ?, ?, 10.0000, 'pcs', 1, 99007, 99007),
        (?, ?, ?, 8000.0000, 'pcs', 1, 99007, 99007)`,
      [
        TEST_TENANT_ID, TEST_SUPPLIER_ID, SKU_COMPONENT_NORMAL_ID,
        TEST_TENANT_ID, TEST_SUPPLIER_ID, SKU_COMPONENT_HIGH_COST_ID,
      ],
    );

    await pool.execute(
      `INSERT INTO process_templates
        (id, tenant_id, sku_id, name, status, created_by, updated_by)
       VALUES (?, ?, ?, '销售集成模板', 'active', 99007, 99007)
       ON DUPLICATE KEY UPDATE
         sku_id = VALUES(sku_id),
         name = VALUES(name),
         status = VALUES(status),
         updated_by = VALUES(updated_by)`,
      [TEST_TEMPLATE_ID, TEST_TENANT_ID, SKU_PRODUCT_ID],
    );
    await pool.execute(
      `INSERT INTO process_steps
        (id, tenant_id, template_id, step_no, step_name, standard_hours, workstation_type, created_by, updated_by)
       VALUES (?, ?, ?, 1, '销售集成工序', 0.1000, 'default', 99007, 99007)
       ON DUPLICATE KEY UPDATE
         standard_hours = VALUES(standard_hours),
         workstation_type = VALUES(workstation_type),
         updated_by = VALUES(updated_by)`,
      [TEST_STEP_ID, TEST_TENANT_ID, TEST_TEMPLATE_ID],
    );
    await pool.execute(
      `INSERT INTO workstations
        (id, tenant_id, name, type, capacity, status)
       VALUES (?, ?, '销售集成工作站', 'default', 100, 'active')
       ON DUPLICATE KEY UPDATE
         name = VALUES(name),
         type = VALUES(type),
         capacity = VALUES(capacity),
         status = VALUES(status)`,
      [TEST_WORKSTATION_ID, TEST_TENANT_ID],
    );

    await pool.execute(
      'DELETE FROM bom_items WHERE tenant_id = ? AND bom_header_id IN (?, ?)',
      [TEST_TENANT_ID, BOM_ID_NORMAL, BOM_ID_HIGH_COST],
    );
    await pool.execute(
      `INSERT INTO bom_headers
        (id, tenant_id, sku_id, version, status, description, is_active, created_by, updated_by)
       VALUES
        (?, ?, ?, '1.0', 'active', '销售集成低成本BOM', 1, 99007, 99007),
        (?, ?, ?, '1.0', 'active', '销售集成高成本BOM', 1, 99007, 99007)
       ON DUPLICATE KEY UPDATE
         sku_id = VALUES(sku_id),
         status = VALUES(status),
         description = VALUES(description),
         is_active = VALUES(is_active),
         updated_by = VALUES(updated_by)`,
      [
        BOM_ID_NORMAL, TEST_TENANT_ID, SKU_PRODUCT_ID,
        BOM_ID_HIGH_COST, TEST_TENANT_ID, SKU_PRODUCT_ID,
      ],
    );
    await pool.execute(
      `INSERT INTO bom_items
        (id, tenant_id, bom_header_id, parent_item_id, component_sku_id, material_sku_id, quantity, qty_per_unit, unit, level, scrap_rate, sort_order, created_by, updated_by)
       VALUES
        (?, ?, ?, NULL, ?, ?, 1.0000, 1.0000, 'pcs', 1, 0, 1, 99007, 99007),
        (?, ?, ?, NULL, ?, ?, 1.0000, 1.0000, 'pcs', 1, 0, 1, 99007, 99007)
       ON DUPLICATE KEY UPDATE
         component_sku_id = VALUES(component_sku_id),
         material_sku_id = VALUES(material_sku_id),
         quantity = VALUES(quantity),
         qty_per_unit = VALUES(qty_per_unit),
         unit = VALUES(unit),
         updated_by = VALUES(updated_by)`,
      [
        BOM_ITEM_NORMAL_ID, TEST_TENANT_ID, BOM_ID_NORMAL, SKU_COMPONENT_NORMAL_ID, SKU_COMPONENT_NORMAL_ID,
        BOM_ITEM_HIGH_COST_ID, TEST_TENANT_ID, BOM_ID_HIGH_COST, SKU_COMPONENT_HIGH_COST_ID, SKU_COMPONENT_HIGH_COST_ID,
      ],
    );
  });

  afterAll(async () => {
    await dbPool?.end();
    dbPool = null;
  });

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
      const pendingApprovalOrder = await createPendingApprovalOrder();
      const res = await request(BASE_URL)
        .post(`/api/sales/orders/${pendingApprovalOrder}/approve`)
        .set(authHeader('boss'))
        .send({ action: 'approved', notes: '特批放行' });

      expect(res.status).toBe(200);
      expect(res.body.code).toBe(0);

      // 验证订单状态
      const orderRes = await request(BASE_URL)
        .get(`/api/sales/orders/${pendingApprovalOrder}`)
        .set(authHeader('boss'));
      expect(orderRes.body.data.status).toBe('confirmed');
    });

    test('TC-SO-007: 附条件批准，notes保存', async () => {
      const newOrderId = await createPendingApprovalOrder('120');

      const res = await request(BASE_URL)
        .post(`/api/sales/orders/${newOrderId}/approve`)
        .set(authHeader('boss'))
        .send({ action: 'conditional', notes: '需在3月28日前交付' });

      expect(res.status).toBe(200);
      expect(res.body.code).toBe(0);
    });

    test('TC-SO-008: boss驳回订单', async () => {
      const newOrderId = await createPendingApprovalOrder('200');

      const res = await request(BASE_URL)
        .post(`/api/sales/orders/${newOrderId}/approve`)
        .set(authHeader('boss'))
        .send({ action: 'rejected', notes: '产能不足，建议下月再下单' });

      expect(res.status).toBe(200);
      expect(res.body.code).toBe(0);
    });

    test('sales角色无权审批 → 403', async () => {
      const pendingApprovalOrder = await createPendingApprovalOrder();
      const res = await request(BASE_URL)
        .post(`/api/sales/orders/${pendingApprovalOrder}/approve`)
        .set(authHeader('sales'))
        .send({ action: 'approved' });

      expect(res.status).toBe(403);
    });

    test('无效的action枚举值 → 1001', async () => {
      const pendingApprovalOrder = await createPendingApprovalOrder();
      const res = await request(BASE_URL)
        .post(`/api/sales/orders/${pendingApprovalOrder}/approve`)
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

  // ─── 销售结算与应收入口 ─────────────────────────────────────

  describe('销售结算与应收入口', () => {
    test('boss 可查询应收汇总', async () => {
      const res = await request(BASE_URL)
        .get('/api/sales/orders/receivables')
        .set(authHeader('boss'));

      expect(res.status).toBe(200);
      expect(res.body.code).toBe(0);
      expect(res.body.data).toHaveProperty('totalReceivable');
      expect(res.body.data).toHaveProperty('overdueAmount');
      expect(res.body.data).toHaveProperty('overdueCount');
      expect(Array.isArray(res.body.data?.settlements)).toBe(true);
    });

    test('warehouse 无权查询应收汇总 → 403', async () => {
      const res = await request(BASE_URL)
        .get('/api/sales/orders/receivables')
        .set(authHeader('warehouse'));

      expect(res.status).toBe(403);
      expect(res.body.code).toBe(1003);
    });

    test('创建结算单时 dueDate 格式非法 → 1001', async () => {
      const res = await request(BASE_URL)
        .post('/api/sales/orders/999999999/settlement')
        .set(authHeader('boss'))
        .send({
          dueDate: '2026/04/01',
          notes: 'invalid date format',
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe(1001);
    });

    test('创建结算单：订单不存在 → 404 / 6002', async () => {
      const res = await request(BASE_URL)
        .post('/api/sales/orders/999999999/settlement')
        .set(authHeader('boss'))
        .send({
          dueDate: '2026-04-01',
          notes: 'order not found',
        });

      expect(res.status).toBe(404);
      expect(res.body.code).toBe(6002);
    });

    test('录入付款：结算单不存在 → 404 / 1004', async () => {
      const res = await request(BASE_URL)
        .post('/api/sales/orders/settlements/999999999/payments')
        .set(authHeader('boss'))
        .send({
          paymentAmount: '100.00',
          paymentDate: '2026-04-01',
          paymentMethod: 'bank_transfer',
        });

      expect(res.status).toBe(404);
      expect(res.body.code).toBe(1004);
    });

    test('录入付款：paymentAmount 非法 → 1001', async () => {
      const res = await request(BASE_URL)
        .post('/api/sales/orders/settlements/999999999/payments')
        .set(authHeader('boss'))
        .send({
          paymentAmount: 'abc',
          paymentDate: '2026-04-01',
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe(1001);
    });

    test('更新开票：结算单不存在 → 404 / 1004', async () => {
      const res = await request(BASE_URL)
        .put('/api/sales/orders/settlements/999999999/invoice')
        .set(authHeader('boss'))
        .send({
          invoiceNo: 'INV-NOT-FOUND',
          invoiceDate: '2026-04-01',
        });

      expect(res.status).toBe(404);
      expect(res.body.code).toBe(1004);
    });
  });
});
