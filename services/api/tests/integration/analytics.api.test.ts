import request from 'supertest';
import jwt from 'jsonwebtoken';
import mysql, { Pool } from 'mysql2/promise';

const BASE_URL = process.env.TEST_API_URL ?? 'http://localhost:3000';
const TEST_TENANT_ID = 9998;
const TEST_JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';

const BOSS_USER_ID = 998801;
const PURCHASER_USER_ID = 998802;
const SUPERVISOR_USER_ID = 998804;
const WORKER_USER_ID = 998805;
const SALES_USER_ID = 998807;

const CUSTOMER_ID = 998901;
const SUPPLIER_A_ID = 998911;
const SUPPLIER_B_ID = 998912;
const RAW_SKU_ID = 998921;
const WIP_SKU_ID = 998922;
const PACKING_SKU_ID = 998923;
const FG_SKU_ID = 998924;
const WORKSTATION_ID = 998931;
const TEMPLATE_ID = 998941;
const STEP_CUT_ID = 998942;
const STEP_ASSEMBLE_ID = 998943;
const BOM_ID = 998951;

const SALES_ORDER_CONFIRMED_ID = 998961;
const SALES_ORDER_PENDING_ID = 998962;
const PURCHASE_ORDER_A_ID = 998971;
const PURCHASE_ORDER_B_ID = 998972;
const PRODUCTION_ORDER_SCHEDULED_ID = 998981;
const PRODUCTION_ORDER_IN_PROGRESS_ID = 998982;
const PRODUCTION_ORDER_COMPLETED_ID = 998983;
const SCHEDULE_CUT_ID = 998991;
const SCHEDULE_ASSEMBLE_ID = 998992;
const TASK_CUT_ID = 998993;
const TASK_ASSEMBLE_ID = 998994;

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

type AnalyticsRole = 'boss' | 'supervisor' | 'worker';

function authHeader(role: AnalyticsRole): { Authorization: string } {
  const identities: Record<AnalyticsRole, { userId: number; username: string }> = {
    boss: { userId: BOSS_USER_ID, username: 'analytics_boss' },
    supervisor: { userId: SUPERVISOR_USER_ID, username: 'analytics_supervisor' },
    worker: { userId: WORKER_USER_ID, username: 'analytics_worker' },
  };
  const identity = identities[role];
  const token = jwt.sign(
    {
      userId: identity.userId,
      tenantId: TEST_TENANT_ID,
      username: identity.username,
      roles: [role],
    },
    TEST_JWT_SECRET,
    { expiresIn: '1h' },
  );
  return { Authorization: `Bearer ${token}` };
}

describe('经营分析模块 API 集成测试', () => {
  beforeAll(async () => {
    const pool = getDbPool();

    await pool.execute(
      `INSERT INTO tenants (id, code, name, status, settings)
       VALUES (?, 'TEST9998', 'Analytics集成测试租户', 'active', JSON_OBJECT())
       ON DUPLICATE KEY UPDATE
         code = VALUES(code),
         name = VALUES(name),
         status = VALUES(status),
         settings = VALUES(settings)`,
      [TEST_TENANT_ID],
    );

    await pool.execute('DELETE FROM production_tasks WHERE tenant_id = ?', [TEST_TENANT_ID]);
    await pool.execute('DELETE FROM production_schedules WHERE tenant_id = ?', [TEST_TENANT_ID]);
    await pool.execute('DELETE FROM production_orders WHERE tenant_id = ?', [TEST_TENANT_ID]);
    await pool.execute('DELETE FROM sales_order_items WHERE tenant_id = ?', [TEST_TENANT_ID]);
    await pool.execute('DELETE FROM sales_orders WHERE tenant_id = ?', [TEST_TENANT_ID]);
    await pool.execute('DELETE FROM purchase_order_items WHERE tenant_id = ?', [TEST_TENANT_ID]);
    await pool.execute('DELETE FROM purchase_orders WHERE tenant_id = ?', [TEST_TENANT_ID]);
    await pool.execute('DELETE FROM inventory_transactions WHERE tenant_id = ?', [TEST_TENANT_ID]);
    await pool.execute('DELETE FROM inventory WHERE tenant_id = ?', [TEST_TENANT_ID]);
    await pool.execute('DELETE FROM supplier_prices WHERE tenant_id = ?', [TEST_TENANT_ID]);
    await pool.execute('DELETE FROM bom_items WHERE tenant_id = ?', [TEST_TENANT_ID]);
    await pool.execute('DELETE FROM bom_headers WHERE tenant_id = ?', [TEST_TENANT_ID]);
    await pool.execute('DELETE FROM process_steps WHERE tenant_id = ?', [TEST_TENANT_ID]);
    await pool.execute('DELETE FROM process_templates WHERE tenant_id = ?', [TEST_TENANT_ID]);
    await pool.execute('DELETE FROM workstations WHERE tenant_id = ?', [TEST_TENANT_ID]);
    await pool.execute('DELETE FROM suppliers WHERE tenant_id = ?', [TEST_TENANT_ID]);
    await pool.execute('DELETE FROM customers WHERE tenant_id = ?', [TEST_TENANT_ID]);
    await pool.execute('DELETE FROM skus WHERE tenant_id = ?', [TEST_TENANT_ID]);
    await pool.execute('DELETE FROM users WHERE tenant_id = ?', [TEST_TENANT_ID]);

    await pool.execute(
      `INSERT INTO users
        (id, tenant_id, username, password_hash, real_name, status, created_by, updated_by)
       VALUES
        (?, ?, 'analytics_boss', 'integration-password', '分析老板', 'active', ?, ?),
        (?, ?, 'analytics_purchaser', 'integration-password', '分析采购', 'active', ?, ?),
        (?, ?, 'analytics_supervisor', 'integration-password', '分析主管', 'active', ?, ?),
        (?, ?, 'analytics_worker', 'integration-password', '分析工人', 'active', ?, ?),
        (?, ?, 'analytics_sales', 'integration-password', '分析销售', 'active', ?, ?)
       ON DUPLICATE KEY UPDATE
         username = VALUES(username),
         real_name = VALUES(real_name),
         status = VALUES(status),
         updated_by = VALUES(updated_by)`,
      [
        BOSS_USER_ID, TEST_TENANT_ID, BOSS_USER_ID, BOSS_USER_ID,
        PURCHASER_USER_ID, TEST_TENANT_ID, BOSS_USER_ID, BOSS_USER_ID,
        SUPERVISOR_USER_ID, TEST_TENANT_ID, BOSS_USER_ID, BOSS_USER_ID,
        WORKER_USER_ID, TEST_TENANT_ID, BOSS_USER_ID, BOSS_USER_ID,
        SALES_USER_ID, TEST_TENANT_ID, BOSS_USER_ID, BOSS_USER_ID,
      ],
    );

    await pool.execute(
      `INSERT INTO customers
        (id, tenant_id, code, name, status, grade, created_by, updated_by)
       VALUES (?, ?, 'CUS-ANLT-INT', '分析集成客户', 'active', 'A', ?, ?)
       ON DUPLICATE KEY UPDATE
         code = VALUES(code),
         name = VALUES(name),
         status = VALUES(status),
         grade = VALUES(grade),
         updated_by = VALUES(updated_by)`,
      [CUSTOMER_ID, TEST_TENANT_ID, BOSS_USER_ID, BOSS_USER_ID],
    );

    await pool.execute(
      `INSERT INTO suppliers
        (id, tenant_id, code, name, status, grade, created_by, updated_by)
       VALUES
        (?, ?, 'SUP-ANLT-INT-A', '分析辅料供应商', 'active', 'A', ?, ?),
        (?, ?, 'SUP-ANLT-INT-B', '分析协作供应商', 'active', 'A', ?, ?)
       ON DUPLICATE KEY UPDATE
         code = VALUES(code),
         name = VALUES(name),
         status = VALUES(status),
         grade = VALUES(grade),
         updated_by = VALUES(updated_by)`,
      [
        SUPPLIER_A_ID, TEST_TENANT_ID, PURCHASER_USER_ID, PURCHASER_USER_ID,
        SUPPLIER_B_ID, TEST_TENANT_ID, PURCHASER_USER_ID, PURCHASER_USER_ID,
      ],
    );

    await pool.execute(
      `INSERT INTO skus
        (id, tenant_id, sku_code, name, category1_id, category2_id, stock_unit, purchase_unit, production_unit, has_dye_lot, use_fifo, safety_stock, status, created_by, updated_by)
       VALUES
        (?, ?, 'SKU-ANLT-RAW', '分析原材料', 1, 1, 'm', 'm', 'm', 0, 1, 25, 'active', ?, ?),
        (?, ?, 'SKU-ANLT-WIP', '分析半成品', 2, 10, '套', '套', '套', 0, 1, 3, 'active', ?, ?),
        (?, ?, 'SKU-ANLT-PACK', '分析包材', 4, 13, '个', '个', '个', 0, 1, 50, 'active', ?, ?),
        (?, ?, 'SKU-ANLT-FG', '分析成品', 3, 11, '套', '套', '套', 0, 1, 0, 'active', ?, ?)
       ON DUPLICATE KEY UPDATE
         sku_code = VALUES(sku_code),
         name = VALUES(name),
         category1_id = VALUES(category1_id),
         category2_id = VALUES(category2_id),
         stock_unit = VALUES(stock_unit),
         purchase_unit = VALUES(purchase_unit),
         production_unit = VALUES(production_unit),
         safety_stock = VALUES(safety_stock),
         status = VALUES(status),
         updated_by = VALUES(updated_by)`,
      [
        RAW_SKU_ID, TEST_TENANT_ID, SUPERVISOR_USER_ID, SUPERVISOR_USER_ID,
        WIP_SKU_ID, TEST_TENANT_ID, SUPERVISOR_USER_ID, SUPERVISOR_USER_ID,
        PACKING_SKU_ID, TEST_TENANT_ID, SUPERVISOR_USER_ID, SUPERVISOR_USER_ID,
        FG_SKU_ID, TEST_TENANT_ID, SUPERVISOR_USER_ID, SUPERVISOR_USER_ID,
      ],
    );

    await pool.execute(
      `INSERT INTO supplier_prices
        (tenant_id, supplier_id, sku_id, price, unit, is_current, created_by, updated_by)
       VALUES
        (?, ?, ?, 12.0000, 'm', 1, ?, ?),
        (?, ?, ?, 150.0000, '套', 1, ?, ?),
        (?, ?, ?, 5.0000, '个', 1, ?, ?)`,
      [
        TEST_TENANT_ID, SUPPLIER_A_ID, RAW_SKU_ID, PURCHASER_USER_ID, PURCHASER_USER_ID,
        TEST_TENANT_ID, SUPPLIER_B_ID, WIP_SKU_ID, PURCHASER_USER_ID, PURCHASER_USER_ID,
        TEST_TENANT_ID, SUPPLIER_A_ID, PACKING_SKU_ID, PURCHASER_USER_ID, PURCHASER_USER_ID,
      ],
    );

    await pool.execute(
      `INSERT INTO inventory
        (tenant_id, sku_id, qty_on_hand, qty_reserved, qty_in_transit, last_in_at)
       VALUES
        (?, ?, 18.0000, 2.0000, 0.0000, DATE_SUB(NOW(), INTERVAL 5 DAY)),
        (?, ?, 3.0000, 0.0000, 0.0000, DATE_SUB(NOW(), INTERVAL 4 DAY)),
        (?, ?, 60.0000, 0.0000, 0.0000, DATE_SUB(NOW(), INTERVAL 3 DAY))
       ON DUPLICATE KEY UPDATE
         qty_on_hand = VALUES(qty_on_hand),
         qty_reserved = VALUES(qty_reserved),
         qty_in_transit = VALUES(qty_in_transit),
         last_in_at = VALUES(last_in_at)`,
      [
        TEST_TENANT_ID, RAW_SKU_ID,
        TEST_TENANT_ID, WIP_SKU_ID,
        TEST_TENANT_ID, PACKING_SKU_ID,
      ],
    );

    await pool.execute(
      `INSERT INTO inventory_transactions
        (tenant_id, transaction_no, sku_id, transaction_type, direction, qty_input, input_unit, qty_stock_unit, stock_unit, reference_type, reference_id, created_by, created_at)
       VALUES
        (?, 'ITX-ANLT-INT-001', ?, 'PURCHASE_IN', 'IN', 30.0000, 'm', 30.0000, 'm', 'analytics_test', 1, ?, DATE_SUB(NOW(), INTERVAL 20 DAY)),
        (?, 'ITX-ANLT-INT-002', ?, 'MATERIAL_OUT', 'OUT', 8.0000, 'm', 8.0000, 'm', 'analytics_test', 2, ?, DATE_SUB(NOW(), INTERVAL 12 DAY)),
        (?, 'ITX-ANLT-INT-003', ?, 'PURCHASE_IN', 'IN', 15.0000, '个', 15.0000, '个', 'analytics_test', 3, ?, DATE_SUB(NOW(), INTERVAL 5 DAY))`,
      [
        TEST_TENANT_ID, RAW_SKU_ID, PURCHASER_USER_ID,
        TEST_TENANT_ID, RAW_SKU_ID, SUPERVISOR_USER_ID,
        TEST_TENANT_ID, PACKING_SKU_ID, PURCHASER_USER_ID,
      ],
    );

    await pool.execute(
      `INSERT INTO workstations
        (id, tenant_id, name, type, capacity, status)
       VALUES (?, ?, '分析工位', 'default', 20, 'active')
       ON DUPLICATE KEY UPDATE
         name = VALUES(name),
         type = VALUES(type),
         capacity = VALUES(capacity),
         status = VALUES(status)`,
      [WORKSTATION_ID, TEST_TENANT_ID],
    );

    await pool.execute(
      `INSERT INTO process_templates
        (id, tenant_id, sku_id, name, status, created_by, updated_by)
       VALUES (?, ?, ?, '分析工艺模板', 'active', ?, ?)
       ON DUPLICATE KEY UPDATE
         sku_id = VALUES(sku_id),
         name = VALUES(name),
         status = VALUES(status),
         updated_by = VALUES(updated_by)`,
      [TEMPLATE_ID, TEST_TENANT_ID, FG_SKU_ID, SUPERVISOR_USER_ID, SUPERVISOR_USER_ID],
    );

    await pool.execute(
      `INSERT INTO process_steps
        (id, tenant_id, template_id, step_no, step_name, standard_hours, workstation_type, created_by, updated_by)
       VALUES
        (?, ?, ?, 1, '裁剪', 0.4000, 'default', ?, ?),
        (?, ?, ?, 2, '组装', 0.6000, 'default', ?, ?)
       ON DUPLICATE KEY UPDATE
         standard_hours = VALUES(standard_hours),
         workstation_type = VALUES(workstation_type),
         updated_by = VALUES(updated_by)`,
      [
        STEP_CUT_ID, TEST_TENANT_ID, TEMPLATE_ID, SUPERVISOR_USER_ID, SUPERVISOR_USER_ID,
        STEP_ASSEMBLE_ID, TEST_TENANT_ID, TEMPLATE_ID, SUPERVISOR_USER_ID, SUPERVISOR_USER_ID,
      ],
    );

    await pool.execute(
      `INSERT INTO bom_headers
        (id, tenant_id, sku_id, version, status, description, is_active, created_by, updated_by)
       VALUES (?, ?, ?, '1.0', 'active', '分析BOM', 1, ?, ?)
       ON DUPLICATE KEY UPDATE
         sku_id = VALUES(sku_id),
         version = VALUES(version),
         status = VALUES(status),
         description = VALUES(description),
         is_active = VALUES(is_active),
         updated_by = VALUES(updated_by)`,
      [BOM_ID, TEST_TENANT_ID, FG_SKU_ID, SUPERVISOR_USER_ID, SUPERVISOR_USER_ID],
    );

    await pool.execute(
      `INSERT INTO bom_items
        (id, tenant_id, bom_header_id, parent_item_id, component_sku_id, material_sku_id, quantity, qty_per_unit, unit, level, scrap_rate, sort_order, created_by, updated_by)
       VALUES
        (?, ?, ?, NULL, ?, ?, 2.0000, 2.0000, 'm', 1, 0, 1, ?, ?),
        (?, ?, ?, NULL, ?, ?, 0.5000, 0.5000, '套', 1, 0, 2, ?, ?),
        (?, ?, ?, NULL, ?, ?, 1.0000, 1.0000, '个', 1, 0, 3, ?, ?)
       ON DUPLICATE KEY UPDATE
         component_sku_id = VALUES(component_sku_id),
         material_sku_id = VALUES(material_sku_id),
         quantity = VALUES(quantity),
         qty_per_unit = VALUES(qty_per_unit),
         unit = VALUES(unit),
         updated_by = VALUES(updated_by)`,
      [
        998952, TEST_TENANT_ID, BOM_ID, RAW_SKU_ID, RAW_SKU_ID, SUPERVISOR_USER_ID, SUPERVISOR_USER_ID,
        998953, TEST_TENANT_ID, BOM_ID, WIP_SKU_ID, WIP_SKU_ID, SUPERVISOR_USER_ID, SUPERVISOR_USER_ID,
        998954, TEST_TENANT_ID, BOM_ID, PACKING_SKU_ID, PACKING_SKU_ID, SUPERVISOR_USER_ID, SUPERVISOR_USER_ID,
      ],
    );

    await pool.execute(
      `INSERT INTO sales_orders
        (id, tenant_id, order_no, customer_id, order_type, status, priority, expected_delivery, total_amount, constraint_passed, approval_status, sales_person_id, created_by, updated_by, created_at, updated_at)
       VALUES
        (?, ?, 'SO-ANLT-INT-001', ?, 'normal', 'confirmed', 80, DATE_ADD(CURDATE(), INTERVAL 14 DAY), 38800.00, 1, 'approved', ?, ?, ?, DATE_ADD(DATE_FORMAT(NOW(), '%Y-%m-01'), INTERVAL 1 DAY), DATE_ADD(DATE_FORMAT(NOW(), '%Y-%m-01'), INTERVAL 1 DAY)),
        (?, ?, 'SO-ANLT-INT-002', ?, 'urgent', 'pending_approval', 95, DATE_ADD(CURDATE(), INTERVAL 7 DAY), 27600.00, 0, 'pending', ?, ?, ?, DATE_ADD(DATE_FORMAT(NOW(), '%Y-%m-01'), INTERVAL 2 DAY), DATE_ADD(DATE_FORMAT(NOW(), '%Y-%m-01'), INTERVAL 2 DAY))`,
      [
        SALES_ORDER_CONFIRMED_ID, TEST_TENANT_ID, CUSTOMER_ID, SALES_USER_ID, SALES_USER_ID, SALES_USER_ID,
        SALES_ORDER_PENDING_ID, TEST_TENANT_ID, CUSTOMER_ID, SALES_USER_ID, SALES_USER_ID, SALES_USER_ID,
      ],
    );

    await pool.execute(
      `INSERT INTO sales_order_items
        (id, tenant_id, order_id, sku_id, qty_ordered, qty, qty_delivered, unit_price, amount, bom_header_id, created_by, updated_by)
       VALUES
        (?, ?, ?, ?, 4.0000, 4.0000, 0.0000, 9700.0000, 38800.00, ?, ?, ?),
        (?, ?, ?, ?, 3.0000, 3.0000, 0.0000, 9200.0000, 27600.00, ?, ?, ?)`,
      [
        998963, TEST_TENANT_ID, SALES_ORDER_CONFIRMED_ID, FG_SKU_ID, BOM_ID, SALES_USER_ID, SALES_USER_ID,
        998964, TEST_TENANT_ID, SALES_ORDER_PENDING_ID, FG_SKU_ID, BOM_ID, SALES_USER_ID, SALES_USER_ID,
      ],
    );

    await pool.execute(
      `INSERT INTO purchase_orders
        (id, tenant_id, po_no, supplier_id, status, total_amount, expected_date, notes, created_by, updated_by, created_at, updated_at)
       VALUES
        (?, ?, 'PO-ANLT-INT-001', ?, 'confirmed', 290.00, DATE_ADD(CURDATE(), INTERVAL 5 DAY), '分析采购A', ?, ?, DATE_SUB(NOW(), INTERVAL 10 DAY), DATE_SUB(NOW(), INTERVAL 10 DAY)),
        (?, ?, 'PO-ANLT-INT-002', ?, 'partial_received', 600.00, DATE_ADD(CURDATE(), INTERVAL 12 DAY), '分析采购B', ?, ?, DATE_SUB(NOW(), INTERVAL 45 DAY), DATE_SUB(NOW(), INTERVAL 45 DAY))`,
      [
        PURCHASE_ORDER_A_ID, TEST_TENANT_ID, SUPPLIER_A_ID, PURCHASER_USER_ID, PURCHASER_USER_ID,
        PURCHASE_ORDER_B_ID, TEST_TENANT_ID, SUPPLIER_B_ID, PURCHASER_USER_ID, PURCHASER_USER_ID,
      ],
    );

    await pool.execute(
      `INSERT INTO purchase_order_items
        (id, tenant_id, po_id, sku_id, qty_ordered, qty_received, purchase_unit, unit_price, amount, created_by, updated_by)
       VALUES
        (?, ?, ?, ?, 20.0000, 18.0000, 'm', 12.0000, 240.00, ?, ?),
        (?, ?, ?, ?, 10.0000, 10.0000, '个', 5.0000, 50.00, ?, ?),
        (?, ?, ?, ?, 4.0000, 2.0000, '套', 150.0000, 600.00, ?, ?)`,
      [
        998973, TEST_TENANT_ID, PURCHASE_ORDER_A_ID, RAW_SKU_ID, PURCHASER_USER_ID, PURCHASER_USER_ID,
        998974, TEST_TENANT_ID, PURCHASE_ORDER_A_ID, PACKING_SKU_ID, PURCHASER_USER_ID, PURCHASER_USER_ID,
        998975, TEST_TENANT_ID, PURCHASE_ORDER_B_ID, WIP_SKU_ID, PURCHASER_USER_ID, PURCHASER_USER_ID,
      ],
    );

    await pool.execute(
      `INSERT INTO production_orders
        (id, tenant_id, work_order_no, sales_order_id, sku_id, bom_header_id, process_template_id, qty_planned, qty_completed, status, priority, planned_start, planned_end, actual_start, actual_end, created_by, updated_by, created_at, updated_at)
       VALUES
        (?, ?, 'WO-ANLT-INT-001', ?, ?, ?, ?, 12.0000, 0.0000, 'scheduled', 80, DATE_SUB(CURDATE(), INTERVAL 1 DAY), DATE_ADD(CURDATE(), INTERVAL 2 DAY), NULL, NULL, ?, ?, DATE_SUB(NOW(), INTERVAL 6 DAY), DATE_SUB(NOW(), INTERVAL 6 DAY)),
        (?, ?, 'WO-ANLT-INT-002', ?, ?, ?, ?, 20.0000, 8.0000, 'in_progress', 85, DATE_SUB(CURDATE(), INTERVAL 2 DAY), DATE_ADD(CURDATE(), INTERVAL 1 DAY), DATE_SUB(NOW(), INTERVAL 2 DAY), NULL, ?, ?, DATE_SUB(NOW(), INTERVAL 4 DAY), DATE_SUB(NOW(), INTERVAL 1 DAY)),
        (?, ?, 'WO-ANLT-INT-003', ?, ?, ?, ?, 20.0000, 18.0000, 'completed', 70, DATE_SUB(CURDATE(), INTERVAL 6 DAY), DATE_SUB(CURDATE(), INTERVAL 2 DAY), DATE_SUB(NOW(), INTERVAL 4 DAY), DATE_SUB(NOW(), INTERVAL 2 DAY), ?, ?, DATE_SUB(NOW(), INTERVAL 8 DAY), DATE_SUB(NOW(), INTERVAL 2 DAY))`,
      [
        PRODUCTION_ORDER_SCHEDULED_ID, TEST_TENANT_ID, SALES_ORDER_CONFIRMED_ID, FG_SKU_ID, BOM_ID, TEMPLATE_ID, SUPERVISOR_USER_ID, SUPERVISOR_USER_ID,
        PRODUCTION_ORDER_IN_PROGRESS_ID, TEST_TENANT_ID, SALES_ORDER_CONFIRMED_ID, FG_SKU_ID, BOM_ID, TEMPLATE_ID, SUPERVISOR_USER_ID, SUPERVISOR_USER_ID,
        PRODUCTION_ORDER_COMPLETED_ID, TEST_TENANT_ID, SALES_ORDER_CONFIRMED_ID, FG_SKU_ID, BOM_ID, TEMPLATE_ID, SUPERVISOR_USER_ID, SUPERVISOR_USER_ID,
      ],
    );

    await pool.execute(
      `INSERT INTO production_schedules
        (id, tenant_id, schedule_date, production_order_id, process_step_id, workstation_id, worker_id, planned_qty, status, ai_generated, created_by, updated_by)
       VALUES
        (?, ?, DATE_SUB(CURDATE(), INTERVAL 3 DAY), ?, ?, ?, ?, 10.0000, 'completed', 1, ?, ?),
        (?, ?, DATE_SUB(CURDATE(), INTERVAL 2 DAY), ?, ?, ?, ?, 8.0000, 'completed', 1, ?, ?)`,
      [
        SCHEDULE_CUT_ID, TEST_TENANT_ID, PRODUCTION_ORDER_COMPLETED_ID, STEP_CUT_ID, WORKSTATION_ID, WORKER_USER_ID, SUPERVISOR_USER_ID, SUPERVISOR_USER_ID,
        SCHEDULE_ASSEMBLE_ID, TEST_TENANT_ID, PRODUCTION_ORDER_COMPLETED_ID, STEP_ASSEMBLE_ID, WORKSTATION_ID, WORKER_USER_ID, SUPERVISOR_USER_ID, SUPERVISOR_USER_ID,
      ],
    );

    await pool.execute(
      `INSERT INTO production_tasks
        (id, tenant_id, task_no, schedule_id, production_order_id, process_step_id, worker_id, task_date, planned_qty, completed_qty, status, started_at, completed_at, created_by, updated_by, created_at, updated_at)
       VALUES
        (?, ?, 'TASK-ANLT-INT-001', ?, ?, ?, ?, DATE_SUB(CURDATE(), INTERVAL 3 DAY), 10.0000, 9.0000, 'completed', DATE_SUB(NOW(), INTERVAL 3 DAY), DATE_SUB(NOW(), INTERVAL 3 DAY), ?, ?, DATE_SUB(NOW(), INTERVAL 3 DAY), DATE_SUB(NOW(), INTERVAL 3 DAY)),
        (?, ?, 'TASK-ANLT-INT-002', ?, ?, ?, ?, DATE_SUB(CURDATE(), INTERVAL 2 DAY), 8.0000, 8.0000, 'completed', DATE_SUB(NOW(), INTERVAL 2 DAY), DATE_SUB(NOW(), INTERVAL 2 DAY), ?, ?, DATE_SUB(NOW(), INTERVAL 2 DAY), DATE_SUB(NOW(), INTERVAL 2 DAY))`,
      [
        TASK_CUT_ID, TEST_TENANT_ID, SCHEDULE_CUT_ID, PRODUCTION_ORDER_COMPLETED_ID, STEP_CUT_ID, WORKER_USER_ID, SUPERVISOR_USER_ID, SUPERVISOR_USER_ID,
        TASK_ASSEMBLE_ID, TEST_TENANT_ID, SCHEDULE_ASSEMBLE_ID, PRODUCTION_ORDER_COMPLETED_ID, STEP_ASSEMBLE_ID, WORKER_USER_ID, SUPERVISOR_USER_ID, SUPERVISOR_USER_ID,
      ],
    );
  });

  afterAll(async () => {
    await dbPool?.end();
    dbPool = null;
  });

  test('dashboard-kpi 返回自带种子汇总', async () => {
    const res = await request(BASE_URL)
      .get('/api/analytics/dashboard-kpi')
      .set(authHeader('supervisor'));

    expect(res.status).toBe(200);
    expect(res.body.code).toBe(0);
    expect(res.body.data).toEqual({
      monthlyRevenue: '66400.00',
      inventoryValue: '966.00',
      inProgressOrders: 2,
      pendingApproval: 1,
      belowSafetyCount: 1,
      capacityLoadRate: '80.0%',
    });
  });

  test('库存分析与生产效率返回非空业务数据', async () => {
    const inventoryRes = await request(BASE_URL)
      .get('/api/analytics/inventory-analysis')
      .set(authHeader('boss'));

    expect(inventoryRes.status).toBe(200);
    expect(inventoryRes.body.code).toBe(0);

    const categoryMap = new Map(
      (inventoryRes.body.data.categoryBreakdown as Array<any>).map((item) => [item.category, item]),
    );
    expect(categoryMap.get('原材料')).toMatchObject({ skuCount: 1, totalQty: '18.00', pct: '22.2%' });
    expect(categoryMap.get('半成品')).toMatchObject({ skuCount: 1, totalQty: '3.00', pct: '3.7%' });
    expect(categoryMap.get('包材辅料')).toMatchObject({ skuCount: 1, totalQty: '60.00', pct: '74.1%' });
    expect(inventoryRes.body.data.trendLast30).toHaveLength(3);

    const efficiencyRes = await request(BASE_URL)
      .get('/api/analytics/production-efficiency')
      .set(authHeader('boss'));

    expect(efficiencyRes.status).toBe(200);
    expect(efficiencyRes.body.code).toBe(0);
    expect(efficiencyRes.body.data.avgCompletionRate).toBe('90.0%');
    expect(efficiencyRes.body.data.avgCycleTime).toBe('2.0 天');
    expect(efficiencyRes.body.data.workerEfficiency).toEqual([
      {
        workerName: '分析工人',
        completedTasks: 2,
        avgRate: '95.0%',
      },
    ]);
  });

  test('物料占比、采购分类和采购成本按自带种子聚合', async () => {
    const materialRes = await request(BASE_URL)
      .get('/api/analytics/material-category-ratio?period_days=90')
      .set(authHeader('boss'));

    expect(materialRes.status).toBe(200);
    expect(materialRes.body.code).toBe(0);
    expect(materialRes.body.data.totalMaterialCost).toBe('104.00');

    const materialMap = new Map(
      (materialRes.body.data.categories as Array<any>).map((item) => [item.categoryName, item]),
    );
    expect(materialMap.get('半成品')).toMatchObject({ skuCount: 1, totalCost: '75.00', percentage: '72.1%' });
    expect(materialMap.get('原材料')).toMatchObject({ skuCount: 1, totalCost: '24.00', percentage: '23.1%' });
    expect(materialMap.get('包材辅料')).toMatchObject({ skuCount: 1, totalCost: '5.00', percentage: '4.8%' });

    const purchaseCategoryRes = await request(BASE_URL)
      .get('/api/analytics/purchase-category?periodDays=90')
      .set(authHeader('boss'));

    expect(purchaseCategoryRes.status).toBe(200);
    expect(purchaseCategoryRes.body.code).toBe(0);
    expect(purchaseCategoryRes.body.data.totalPurchaseAmount).toBe('890.00');

    const purchaseCategoryMap = new Map(
      (purchaseCategoryRes.body.data.categories as Array<any>).map((item) => [item.categoryName, item]),
    );
    expect(purchaseCategoryMap.get('半成品')).toMatchObject({ orderCount: 1, totalAmount: '600.00', percentage: '67.4%' });
    expect(purchaseCategoryMap.get('原材料')).toMatchObject({ orderCount: 1, totalAmount: '240.00', percentage: '27.0%' });
    expect(purchaseCategoryMap.get('包材辅料')).toMatchObject({ orderCount: 1, totalAmount: '50.00', percentage: '5.6%' });
    expect(purchaseCategoryRes.body.data.period.days).toBe(90);

    const purchaseCostRes = await request(BASE_URL)
      .get('/api/analytics/purchase-cost')
      .set(authHeader('boss'));

    expect(purchaseCostRes.status).toBe(200);
    expect(purchaseCostRes.body.code).toBe(0);
    expect(purchaseCostRes.body.data.monthlyTrend).toHaveLength(2);
    expect(purchaseCostRes.body.data.topSuppliers).toEqual([
      {
        supplierName: '分析协作供应商',
        totalAmount: '600.00',
        orderCount: 1,
      },
      {
        supplierName: '分析辅料供应商',
        totalAmount: '290.00',
        orderCount: 1,
      },
    ]);
  });

  test('非 boss / supervisor 无权访问 analytics', async () => {
    const res = await request(BASE_URL)
      .get('/api/analytics/dashboard-kpi')
      .set(authHeader('worker'));

    expect(res.status).toBe(403);
    expect(res.body.code).toBe(1003);
  });
});
