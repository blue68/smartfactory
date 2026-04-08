import request from 'supertest';
import mysql, { Pool, RowDataPacket } from 'mysql2/promise';
import { authHeader } from '../helpers/testAuth';

const BASE_URL = process.env.TEST_API_URL ?? 'http://localhost:3000';
const TEST_TENANT_ID = 9999;

const CUSTOMER_ID = 995001;

const ORDER_CREATE_ID = 995101;
const ORDER_DETAIL_ID = 995102;
const ORDER_OVERDUE_ID = 995103;
const ORDER_CONFIRMED_SETTLEMENT_ID = 995104;
const ORDER_CANCEL_SETTLEMENT_ID = 995105;

const SETTLEMENT_DETAIL_ID = 995201;
const SETTLEMENT_CONFIRMED_ID = 995202;
const SETTLEMENT_CANCEL_ID = 995203;

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

async function ensureSettlementTableSchema(pool: Pool): Promise<void> {
  await pool.execute(
    `CREATE TABLE IF NOT EXISTS settlements (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      tenant_id BIGINT UNSIGNED NOT NULL,
      settlement_no VARCHAR(50) NOT NULL,
      customer_id BIGINT UNSIGNED NOT NULL,
      order_id BIGINT UNSIGNED NOT NULL,
      total_amount DECIMAL(16,2) NOT NULL DEFAULT 0.00,
      status ENUM('draft','confirmed','paid','cancelled') NOT NULL DEFAULT 'draft',
      due_date DATE NULL,
      confirmed_by BIGINT UNSIGNED NULL,
      confirmed_at DATETIME(3) NULL,
      paid_at DATETIME(3) NULL,
      notes TEXT NULL,
      created_by BIGINT UNSIGNED NOT NULL DEFAULT 0,
      updated_by BIGINT UNSIGNED NOT NULL DEFAULT 0,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      PRIMARY KEY (id),
      UNIQUE KEY uq_settlements_no (tenant_id, settlement_no),
      KEY idx_settlements_order (tenant_id, order_id),
      KEY idx_settlements_status (tenant_id, status),
      KEY idx_settlements_customer (tenant_id, customer_id),
      KEY idx_settlements_due_date (tenant_id, due_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  );

  const [columns] = await pool.query<Array<RowDataPacket & { Field: string }>>('SHOW COLUMNS FROM settlements');
  const columnNames = new Set(columns.map((column) => column.Field));
  if (!columnNames.has('due_date')) {
    await pool.execute('ALTER TABLE settlements ADD COLUMN due_date DATE NULL AFTER status');
  }
}

describe('销售结算模块 API 集成测试', () => {
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
        (id, tenant_id, code, name, status, created_by, updated_by)
       VALUES (?, ?, 'CUS-SETTLEMENT-INT', '结算集成客户', 'active', 99001, 99001)
       ON DUPLICATE KEY UPDATE
         code = VALUES(code),
         name = VALUES(name),
         status = VALUES(status),
         updated_by = VALUES(updated_by)`,
      [CUSTOMER_ID, TEST_TENANT_ID],
    );

    await ensureSettlementTableSchema(pool);

    await pool.execute(
      'DELETE FROM settlements WHERE tenant_id = ? AND id IN (?, ?, ?)',
      [TEST_TENANT_ID, SETTLEMENT_DETAIL_ID, SETTLEMENT_CONFIRMED_ID, SETTLEMENT_CANCEL_ID],
    );
    await pool.execute(
      'DELETE FROM settlements WHERE tenant_id = ? AND order_id IN (?, ?, ?, ?, ?)',
      [TEST_TENANT_ID, ORDER_CREATE_ID, ORDER_DETAIL_ID, ORDER_OVERDUE_ID, ORDER_CONFIRMED_SETTLEMENT_ID, ORDER_CANCEL_SETTLEMENT_ID],
    );
    await pool.execute(
      'DELETE FROM sales_orders WHERE tenant_id = ? AND id IN (?, ?, ?, ?, ?)',
      [TEST_TENANT_ID, ORDER_CREATE_ID, ORDER_DETAIL_ID, ORDER_OVERDUE_ID, ORDER_CONFIRMED_SETTLEMENT_ID, ORDER_CANCEL_SETTLEMENT_ID],
    );

    await pool.execute(
      `INSERT INTO sales_orders
        (id, tenant_id, order_no, customer_id, order_type, status, priority, expected_delivery, total_amount, constraint_passed, approval_status, sales_person_id, created_by, updated_by)
       VALUES
        (?, ?, 'SO-SET-CREATE', ?, 'normal', 'shipped', 50, DATE_ADD(CURDATE(), INTERVAL 7 DAY), 1888.00, 1, 'approved', 99007, 99001, 99001),
        (?, ?, 'SO-SET-DETAIL', ?, 'normal', 'completed', 50, DATE_ADD(CURDATE(), INTERVAL 5 DAY), 2888.00, 1, 'approved', 99007, 99001, 99001),
        (?, ?, 'SO-SET-OVERDUE', ?, 'normal', 'completed', 50, DATE_SUB(CURDATE(), INTERVAL 12 DAY), 3888.00, 1, 'approved', 99007, 99001, 99001),
        (?, ?, 'SO-SET-CONFIRM', ?, 'normal', 'completed', 50, DATE_ADD(CURDATE(), INTERVAL 3 DAY), 4888.00, 1, 'approved', 99007, 99001, 99001),
        (?, ?, 'SO-SET-CANCEL', ?, 'normal', 'completed', 50, DATE_ADD(CURDATE(), INTERVAL 9 DAY), 5888.00, 1, 'approved', 99007, 99001, 99001)
       ON DUPLICATE KEY UPDATE
         customer_id = VALUES(customer_id),
         status = VALUES(status),
         total_amount = VALUES(total_amount),
         expected_delivery = VALUES(expected_delivery),
         updated_by = VALUES(updated_by)`,
      [
        ORDER_CREATE_ID, TEST_TENANT_ID, CUSTOMER_ID,
        ORDER_DETAIL_ID, TEST_TENANT_ID, CUSTOMER_ID,
        ORDER_OVERDUE_ID, TEST_TENANT_ID, CUSTOMER_ID,
        ORDER_CONFIRMED_SETTLEMENT_ID, TEST_TENANT_ID, CUSTOMER_ID,
        ORDER_CANCEL_SETTLEMENT_ID, TEST_TENANT_ID, CUSTOMER_ID,
      ],
    );

    await pool.execute(
      `INSERT INTO settlements
        (id, tenant_id, settlement_no, customer_id, order_id, total_amount, status, due_date, notes, created_by, updated_by, confirmed_by, confirmed_at, paid_at)
       VALUES
        (?, ?, 'ST-SET-DETAIL', ?, ?, 2888.00, 'draft', DATE_ADD(CURDATE(), INTERVAL 5 DAY), '详情结算单', 99001, 99001, NULL, NULL, NULL),
        (?, ?, 'ST-SET-CONFIRMED', ?, ?, 4888.00, 'confirmed', DATE_ADD(CURDATE(), INTERVAL 3 DAY), '待付款结算单', 99001, 99001, 99001, NOW(3), NULL),
        (?, ?, 'ST-SET-CANCEL', ?, ?, 3888.00, 'draft', DATE_SUB(CURDATE(), INTERVAL 7 DAY), '逾期草稿结算单', 99001, 99001, NULL, NULL, NULL)
       ON DUPLICATE KEY UPDATE
         total_amount = VALUES(total_amount),
         status = VALUES(status),
         due_date = VALUES(due_date),
         notes = VALUES(notes),
         confirmed_by = VALUES(confirmed_by),
         confirmed_at = VALUES(confirmed_at),
         paid_at = VALUES(paid_at),
         updated_by = VALUES(updated_by)`,
      [
        SETTLEMENT_DETAIL_ID, TEST_TENANT_ID, CUSTOMER_ID, ORDER_DETAIL_ID,
        SETTLEMENT_CONFIRMED_ID, TEST_TENANT_ID, CUSTOMER_ID, ORDER_CONFIRMED_SETTLEMENT_ID,
        SETTLEMENT_CANCEL_ID, TEST_TENANT_ID, CUSTOMER_ID, ORDER_OVERDUE_ID,
      ],
    );
  });

  afterAll(async () => {
    await dbPool?.end();
    dbPool = null;
  });

  describe('创建结算单 — POST /api/settlements', () => {
    test('boss 可为已发货订单创建结算单', async () => {
      const res = await request(BASE_URL)
        .post('/api/settlements')
        .set(authHeader('boss'))
        .send({
          orderId: ORDER_CREATE_ID,
          notes: '集成测试创建结算单',
        });

      expect(res.status).toBe(201);
      expect(res.body.code).toBe(0);
      expect(res.body.data.orderId).toBe(ORDER_CREATE_ID);
      expect(res.body.data.status).toBe('draft');
      expect(res.body.data.settlementNo).toMatch(/^ST/);
    });

    test('sales 无权创建结算单 -> 403', async () => {
      const res = await request(BASE_URL)
        .post('/api/settlements')
        .set(authHeader('sales'))
        .send({
          orderId: ORDER_DETAIL_ID,
        });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe(1003);
    });
  });

  describe('结算单列表 / 详情 / 应收汇总', () => {
    test('sales 可查询待结算销售订单列表', async () => {
      const res = await request(BASE_URL)
        .get('/api/settlements/pending-orders?keyword=SO-SET&page=1&pageSize=20')
        .set(authHeader('sales'));

      expect(res.status).toBe(200);
      expect(res.body.code).toBe(0);
      expect(res.body.data.page).toBe(1);
      expect(res.body.data.pageSize).toBe(20);
      const list: Array<Record<string, unknown>> = res.body.data?.list ?? [];
      expect(Array.isArray(list)).toBe(true);
      expect(list.some((item) => Number(item.orderId) === ORDER_CREATE_ID)).toBe(true);
      // ORDER_DETAIL_ID 已经存在有效结算单，不应出现在待结算池
      expect(list.some((item) => Number(item.orderId) === ORDER_DETAIL_ID)).toBe(false);
    });

    test('sales 可按 keyword + overdueOnly 查询结算单列表', async () => {
      const res = await request(BASE_URL)
        .get('/api/settlements?keyword=ST-SET&overdueOnly=true&page=1&pageSize=20')
        .set(authHeader('sales'));

      expect(res.status).toBe(200);
      expect(res.body.code).toBe(0);
      expect(res.body.data.page).toBe(1);
      expect(res.body.data.pageSize).toBe(20);
      const list: Array<Record<string, unknown>> = res.body.data?.list ?? [];
      expect(list.length).toBeGreaterThan(0);
      list.forEach((item) => {
        expect(['draft', 'confirmed']).toContain(String(item.status));
      });
      expect(list.some((item) => Number(item.id) === SETTLEMENT_CANCEL_ID)).toBe(true);
    });

    test('boss 可按 customer 维度查询应收汇总', async () => {
      const res = await request(BASE_URL)
        .get('/api/settlements/receivable?groupBy=customer')
        .set(authHeader('boss'));

      expect(res.status).toBe(200);
      expect(res.body.code).toBe(0);
      expect(res.body.data.groupBy).toBe('customer');
      expect(Array.isArray(res.body.data.data)).toBe(true);
      expect(res.body.data.data.some((item: any) => Number(item.customerId) === CUSTOMER_ID)).toBe(true);
    });

    test('boss 可按 aging 维度查询逾期汇总', async () => {
      const res = await request(BASE_URL)
        .get('/api/settlements/receivable?groupBy=aging')
        .set(authHeader('boss'));

      expect(res.status).toBe(200);
      expect(res.body.code).toBe(0);
      expect(res.body.data.groupBy).toBe('aging');
      expect(res.body.data).toHaveProperty('overdueAmount');
      expect(res.body.data).toHaveProperty('overdueCount');
      expect(Array.isArray(res.body.data.data)).toBe(true);
    });

    test('详情接口返回 customer/order/status 等字段', async () => {
      const res = await request(BASE_URL)
        .get(`/api/settlements/${SETTLEMENT_DETAIL_ID}`)
        .set(authHeader('sales'));

      expect(res.status).toBe(200);
      expect(res.body.code).toBe(0);
      expect(res.body.data).toMatchObject({
        id: SETTLEMENT_DETAIL_ID,
        settlementNo: 'ST-SET-DETAIL',
        customerId: CUSTOMER_ID,
        customerName: '结算集成客户',
        orderId: ORDER_DETAIL_ID,
        orderNo: 'SO-SET-DETAIL',
        status: 'draft',
      });
    });
  });

  describe('状态流转 — confirm / pay / cancel', () => {
    test('boss 可确认 draft 结算单', async () => {
      const res = await request(BASE_URL)
        .put(`/api/settlements/${SETTLEMENT_DETAIL_ID}/confirm`)
        .set(authHeader('boss'));

      expect(res.status).toBe(200);
      expect(res.body.code).toBe(0);
      expect(res.body.data.status).toBe('confirmed');
      expect(res.body.data.confirmedBy).toBe(99001);
    });

    test('boss 可将 confirmed 结算单标记为 paid', async () => {
      const res = await request(BASE_URL)
        .put(`/api/settlements/${SETTLEMENT_CONFIRMED_ID}/pay`)
        .set(authHeader('boss'));

      expect(res.status).toBe(200);
      expect(res.body.code).toBe(0);
      expect(res.body.data.status).toBe('paid');
      expect(res.body.data.paidAt).toBeTruthy();
    });

    test('supervisor 可取消未付款结算单', async () => {
      const res = await request(BASE_URL)
        .put(`/api/settlements/${SETTLEMENT_CANCEL_ID}/cancel`)
        .set(authHeader('supervisor'));

      expect(res.status).toBe(200);
      expect(res.body.code).toBe(0);
      expect(res.body.data.status).toBe('cancelled');
    });
  });
});
