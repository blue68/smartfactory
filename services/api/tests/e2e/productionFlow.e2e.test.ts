/**
 * E2E 测试 — 半成品生产主链路
 *
 * 覆盖当前真实契约：
 *   1. 从销售订单创建生产工单
 *   2. release 生成组件/工序
 *   3. 生成排产并确认下发
 *   4. 重复 confirm 不得重复造任务
 *   5. 第一工序完工后工单仍为 in_progress，qty_completed 不得提前拉满
 *   6. 首工序完工后写入 1 条半成品 PRODUCTION_IN，最终完工后再写入 1 条成品 PRODUCTION_IN
 *   7. 工资报表可查询到对应报工
 *
 * 依赖：
 *   - TEST_API_URL 指向运行中的 API（默认 http://localhost，经 Nginx 代理到 /api）
 *   - 本地 MySQL 已启动且迁移已完成
 */

import request from 'supertest';
import mysql, { Pool, RowDataPacket } from 'mysql2/promise';
import { authHeader, getUserId } from '../helpers/testAuth';

const BASE_URL = process.env.TEST_API_URL ?? 'http://localhost';

jest.setTimeout(60000);

const TEST_TENANT_ID = 9999;
const TEST_BOSS_ID = getUserId('boss');
const TEST_SUPERVISOR_ID = getUserId('supervisor');
const TEST_WORKER_ID = getUserId('worker');
const TEST_QC_ID = getUserId('qc');

const CUSTOMER_ID = 990901;
const FINISHED_SKU_ID = 990902;
const WIP_SKU_ID = 990903;
const MATERIAL_SKU_ID = 990904;
const BOM_ID = 990905;
const PROCESS_TEMPLATE_ID = 990906;
const CUT_STEP_ID = 990907;
const PACK_STEP_ID = 990908;
const CUT_WORKSTATION_ID = 990909;
const PACK_WORKSTATION_ID = 990910;
const SALES_ORDER_ID = 990911;
const SALES_ORDER_ITEM_ID = 990912;
const URGENT_SALES_ORDER_ID = 990913;
const URGENT_SALES_ORDER_ITEM_ID = 990914;
const RESOLVED_WIP_SKU_ID = 990915;

const SCHEDULE_DATE = '2026-04-05';
const FINISHED_SKU_CODE = 'SKU-PROD-E2E-FG';
const SALES_ORDER_NO = 'SO-PROD-E2E-990911';
const URGENT_SALES_ORDER_NO = 'SO-PROD-E2E-990913';

let dbPool: Pool | null = null;

interface OrderStateRow extends RowDataPacket {
  status: string;
  qty_completed: string;
  actual_end: string | null;
}

interface CountRow extends RowDataPacket {
  cnt: string;
}

interface InventoryRow extends RowDataPacket {
  qty_on_hand: string;
}

interface InventorySnapshotRow extends RowDataPacket {
  snapshot_date: string;
  qty_on_hand: string;
  qty_reserved: string;
  qty_available: string;
}

interface WageTaskReportRow {
  taskId: number | string | null;
  taskStatus: string | null;
  qtyCompleted: string;
  qtyQualified: string;
  qtyDefective: string;
  workHours: string;
  unitPrice: string;
  subtotal: string;
}

interface PreparedOrderContext {
  productionOrderId: number;
  firstTaskId: number;
  finalTaskId: number;
}

function getDbPool(): Pool {
  if (!dbPool) {
    dbPool = mysql.createPool({
      host: process.env.DB_HOST ?? '127.0.0.1',
      port: Number(process.env.DB_PORT ?? '3307'),
      user: process.env.DB_USER ?? 'sf_app',
      password: process.env.DB_PASS ?? process.env.DB_PASSWORD ?? 'TestApp2026!Secure',
      database: process.env.DB_NAME ?? 'smart_factory',
      connectionLimit: 4,
      waitForConnections: true,
    });
  }
  return dbPool;
}

async function seedProductionFlowData(): Promise<void> {
  const pool = getDbPool();

  const cleanupStatements = [
    'DELETE FROM traceability_records WHERE tenant_id = ?',
    'DELETE FROM quality_issues WHERE tenant_id = ?',
    'DELETE FROM inspection_records WHERE tenant_id = ?',
    'DELETE FROM task_material_transactions WHERE tenant_id = ?',
    'DELETE FROM task_completions WHERE tenant_id = ?',
    'DELETE FROM work_reports WHERE tenant_id = ?',
    'DELETE FROM production_tasks WHERE tenant_id = ?',
    'DELETE FROM production_schedules WHERE tenant_id = ?',
    'DELETE FROM production_operation_dependencies WHERE tenant_id = ?',
    'DELETE FROM production_operations WHERE tenant_id = ?',
    'DELETE FROM production_order_sku_resolutions WHERE tenant_id = ?',
    'DELETE FROM production_order_components WHERE tenant_id = ?',
    'DELETE FROM material_requirements WHERE tenant_id = ?',
    'DELETE FROM purchase_suggestions WHERE tenant_id = ?',
    'DELETE FROM inventory_transactions WHERE tenant_id = ?',
    'DELETE FROM inventory WHERE tenant_id = ?',
    'DELETE FROM production_orders WHERE tenant_id = ?',
    'DELETE FROM bom_version_snapshots WHERE tenant_id = ?',
    'DELETE FROM sales_order_items WHERE tenant_id = ?',
    'DELETE FROM sales_orders WHERE tenant_id = ?',
    'DELETE FROM process_wages WHERE tenant_id = ?',
    'DELETE FROM process_step_materials WHERE tenant_id = ?',
    'DELETE FROM process_steps WHERE tenant_id = ?',
    'DELETE FROM process_templates WHERE tenant_id = ?',
    'DELETE FROM bom_items WHERE tenant_id = ?',
    'DELETE FROM bom_headers WHERE tenant_id = ?',
    'DELETE FROM workstations WHERE tenant_id = ?',
    'DELETE FROM skus WHERE tenant_id = ?',
    'DELETE FROM customers WHERE tenant_id = ?',
    'DELETE FROM user_roles WHERE tenant_id = ?',
    'DELETE FROM users WHERE tenant_id = ?',
    'DELETE FROM tenants WHERE id = ?',
  ];

  for (const sql of cleanupStatements) {
    await pool.execute(sql, [TEST_TENANT_ID]);
  }

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
    `INSERT INTO users
       (id, tenant_id, username, password_hash, real_name, status, skill_level, created_by, updated_by)
     VALUES
       (?, ?, 'test_boss', '$2b$10$zQxH8rv.L5iC.WmFJPi.k.ybfWdEV1LkPcvtm5k1ZZyG5rNv8e4ZO', 'E2E老板', 'active', NULL, 0, 0),
       (?, ?, 'test_supervisor', '$2b$10$zQxH8rv.L5iC.WmFJPi.k.ybfWdEV1LkPcvtm5k1ZZyG5rNv8e4ZO', 'E2E主管', 'active', NULL, 0, 0),
       (?, ?, 'test_worker', '$2b$10$zQxH8rv.L5iC.WmFJPi.k.ybfWdEV1LkPcvtm5k1ZZyG5rNv8e4ZO', 'E2E工人', 'active', 'skilled', 0, 0),
       (?, ?, 'test_qc', '$2b$10$zQxH8rv.L5iC.WmFJPi.k.ybfWdEV1LkPcvtm5k1ZZyG5rNv8e4ZO', 'E2E质检', 'active', NULL, 0, 0)
     ON DUPLICATE KEY UPDATE
       username = VALUES(username),
       real_name = VALUES(real_name),
       status = VALUES(status),
       skill_level = VALUES(skill_level),
       updated_by = VALUES(updated_by)`,
    [
      TEST_BOSS_ID, TEST_TENANT_ID,
      TEST_SUPERVISOR_ID, TEST_TENANT_ID,
      TEST_WORKER_ID, TEST_TENANT_ID,
      TEST_QC_ID, TEST_TENANT_ID,
    ],
  );

  await pool.execute(
    `INSERT IGNORE INTO user_roles (tenant_id, user_id, role_id)
     SELECT ?, ?, id FROM roles WHERE tenant_id = 0 AND code = 'boss'`,
    [TEST_TENANT_ID, TEST_BOSS_ID],
  );
  await pool.execute(
    `INSERT IGNORE INTO user_roles (tenant_id, user_id, role_id)
     SELECT ?, ?, id FROM roles WHERE tenant_id = 0 AND code = 'supervisor'`,
    [TEST_TENANT_ID, TEST_SUPERVISOR_ID],
  );
  await pool.execute(
    `INSERT IGNORE INTO user_roles (tenant_id, user_id, role_id)
     SELECT ?, ?, id FROM roles WHERE tenant_id = 0 AND code = 'worker'`,
    [TEST_TENANT_ID, TEST_WORKER_ID],
  );
  await pool.execute(
    `INSERT IGNORE INTO user_roles (tenant_id, user_id, role_id)
     SELECT ?, ?, id FROM roles WHERE tenant_id = 0 AND code = 'qc'`,
    [TEST_TENANT_ID, TEST_QC_ID],
  );

  await pool.execute(
    `INSERT INTO customers
       (id, tenant_id, code, name, status, grade, created_by, updated_by)
     VALUES (?, ?, 'CUS-PROD-E2E', 'E2E客户', 'active', 'A', ?, ?)
     ON DUPLICATE KEY UPDATE
       name = VALUES(name),
       status = VALUES(status),
       grade = VALUES(grade),
       updated_by = VALUES(updated_by)`,
    [CUSTOMER_ID, TEST_TENANT_ID, TEST_BOSS_ID, TEST_BOSS_ID],
  );

  await pool.execute(
    `INSERT INTO skus
       (id, tenant_id, sku_code, name, category1_id, category2_id,
        stock_unit, purchase_unit, production_unit, has_dye_lot, use_fifo,
        safety_stock, status, created_by, updated_by)
     VALUES
       (?, ?, ?, 'E2E成品', 1, 1, 'pcs', 'pcs', 'pcs', 0, 1, 0, 'active', ?, ?),
       (?, ?, 'SKU-PROD-E2E-WIP', 'E2E半成品', 1, 1, 'pcs', 'pcs', 'pcs', 0, 1, 0, 'active', ?, ?),
       (?, ?, 'SKU-PROD-E2E-RM', 'E2E原材料', 1, 1, 'pcs', 'pcs', 'pcs', 0, 1, 0, 'active', ?, ?),
       (?, ?, 'SKU-PROD-E2E-WIP-ALT', 'E2E半成品替代款', 1, 1, 'pcs', 'pcs', 'pcs', 0, 1, 0, 'active', ?, ?)
     ON DUPLICATE KEY UPDATE
       name = VALUES(name),
       stock_unit = VALUES(stock_unit),
       purchase_unit = VALUES(purchase_unit),
       production_unit = VALUES(production_unit),
       status = VALUES(status),
       updated_by = VALUES(updated_by)`,
    [
      FINISHED_SKU_ID, TEST_TENANT_ID, FINISHED_SKU_CODE, TEST_BOSS_ID, TEST_BOSS_ID,
      WIP_SKU_ID, TEST_TENANT_ID, TEST_BOSS_ID, TEST_BOSS_ID,
      MATERIAL_SKU_ID, TEST_TENANT_ID, TEST_BOSS_ID, TEST_BOSS_ID,
      RESOLVED_WIP_SKU_ID, TEST_TENANT_ID, TEST_BOSS_ID, TEST_BOSS_ID,
    ],
  );

  await pool.execute(
    `INSERT INTO inventory
       (tenant_id, sku_id, qty_on_hand, qty_reserved, qty_in_transit, last_in_at)
     VALUES (?, ?, 20, 0, 0, NOW(3))
     ON DUPLICATE KEY UPDATE
       qty_on_hand = VALUES(qty_on_hand),
       qty_reserved = 0,
       qty_in_transit = 0,
       last_in_at = NOW(3)`,
    [TEST_TENANT_ID, MATERIAL_SKU_ID],
  );

  await pool.execute(
    `INSERT INTO bom_headers
       (id, tenant_id, sku_id, version, status, description, is_active, created_by, updated_by)
     VALUES (?, ?, ?, '1.0', 'active', 'E2E生产BOM', 1, ?, ?)
     ON DUPLICATE KEY UPDATE
       status = VALUES(status),
       is_active = VALUES(is_active),
       updated_by = VALUES(updated_by)`,
    [BOM_ID, TEST_TENANT_ID, FINISHED_SKU_ID, TEST_BOSS_ID, TEST_BOSS_ID],
  );

  await pool.execute(
    `INSERT INTO bom_items
       (tenant_id, bom_header_id, component_sku_id, material_sku_id, quantity, qty_per_unit,
        unit, level, scrap_rate, sort_order, created_by, updated_by)
     VALUES (?, ?, ?, ?, 2.0000, 2.0000, 'pcs', 1, 0, 1, ?, ?)`,
    [TEST_TENANT_ID, BOM_ID, MATERIAL_SKU_ID, MATERIAL_SKU_ID, TEST_BOSS_ID, TEST_BOSS_ID],
  );

  await pool.execute(
    `INSERT INTO process_templates
       (id, tenant_id, sku_id, name, version, is_default, status, created_by, updated_by)
     VALUES (?, ?, ?, 'E2E两道工序', '1.0', 1, 'active', ?, ?)
     ON DUPLICATE KEY UPDATE
       name = VALUES(name),
       version = VALUES(version),
       is_default = VALUES(is_default),
       status = VALUES(status),
       updated_by = VALUES(updated_by)`,
    [PROCESS_TEMPLATE_ID, TEST_TENANT_ID, FINISHED_SKU_ID, TEST_BOSS_ID, TEST_BOSS_ID],
  );

  await pool.execute(
    `INSERT INTO process_steps
       (id, tenant_id, template_id, step_no, step_name, standard_hours, max_hours,
        workstation_type, workstation_id, output_type, output_sku_id, created_by, updated_by)
     VALUES
       (?, ?, ?, 1, '裁切', 0.2000, 1.00, 'cut', ?, 'semi_finished', ?, ?, ?),
       (?, ?, ?, 2, '包装', 0.3000, 1.00, 'pack', ?, 'final_product', ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       step_name = VALUES(step_name),
       standard_hours = VALUES(standard_hours),
       max_hours = VALUES(max_hours),
       workstation_type = VALUES(workstation_type),
       workstation_id = VALUES(workstation_id),
       output_type = VALUES(output_type),
       output_sku_id = VALUES(output_sku_id),
       updated_by = VALUES(updated_by)`,
    [
      CUT_STEP_ID, TEST_TENANT_ID, PROCESS_TEMPLATE_ID, CUT_WORKSTATION_ID, WIP_SKU_ID, TEST_BOSS_ID, TEST_BOSS_ID,
      PACK_STEP_ID, TEST_TENANT_ID, PROCESS_TEMPLATE_ID, PACK_WORKSTATION_ID, FINISHED_SKU_ID, TEST_BOSS_ID, TEST_BOSS_ID,
    ],
  );

  await pool.execute(
    `INSERT INTO process_step_materials
       (tenant_id, template_id, step_no, input_sku_id, usage_per_unit, loss_rate, consume_timing, created_by, updated_by)
     VALUES
       (?, ?, 1, ?, 2.0000, 0.0000, 'start', ?, ?),
       (?, ?, 2, ?, 1.0000, 0.0000, 'complete', ?, ?)
     ON DUPLICATE KEY UPDATE
       usage_per_unit = VALUES(usage_per_unit),
       loss_rate = VALUES(loss_rate),
       consume_timing = VALUES(consume_timing),
       updated_by = VALUES(updated_by)`,
    [
      TEST_TENANT_ID, PROCESS_TEMPLATE_ID, MATERIAL_SKU_ID, TEST_BOSS_ID, TEST_BOSS_ID,
      TEST_TENANT_ID, PROCESS_TEMPLATE_ID, WIP_SKU_ID, TEST_BOSS_ID, TEST_BOSS_ID,
    ],
  );

  await pool.execute(
    `INSERT INTO workstations
       (id, tenant_id, name, type, capacity, status)
     VALUES
       (?, ?, 'E2E裁切工位', 'cut', 100, 'active'),
       (?, ?, 'E2E包装工位', 'pack', 100, 'active')
     ON DUPLICATE KEY UPDATE
       name = VALUES(name),
       type = VALUES(type),
       capacity = VALUES(capacity),
       status = VALUES(status)`,
    [CUT_WORKSTATION_ID, TEST_TENANT_ID, PACK_WORKSTATION_ID, TEST_TENANT_ID],
  );

  await pool.execute(
    `INSERT INTO process_wages
       (tenant_id, step_id, worker_grade, unit_price, created_by, updated_by)
     VALUES
       (?, ?, 'skilled', 2.50, ?, ?),
       (?, ?, 'skilled', 3.00, ?, ?)
     ON DUPLICATE KEY UPDATE
       unit_price = VALUES(unit_price),
       updated_by = VALUES(updated_by)`,
    [
      TEST_TENANT_ID, CUT_STEP_ID, TEST_BOSS_ID, TEST_BOSS_ID,
      TEST_TENANT_ID, PACK_STEP_ID, TEST_BOSS_ID, TEST_BOSS_ID,
    ],
  );

  await pool.execute(
    `INSERT INTO sales_orders
       (id, tenant_id, order_no, customer_id, order_type, status, priority,
        expected_delivery, total_amount, constraint_passed, approval_status,
        sales_person_id, notes, created_by, updated_by)
     VALUES (?, ?, ?, ?, 'normal', 'confirmed', 80,
             '2026-04-10', 500.00, 1, 'approved',
             ?, 'E2E生产主链路销售单', ?, ?)
     ON DUPLICATE KEY UPDATE
       order_no = VALUES(order_no),
       customer_id = VALUES(customer_id),
       status = VALUES(status),
       priority = VALUES(priority),
       expected_delivery = VALUES(expected_delivery),
       constraint_passed = VALUES(constraint_passed),
       approval_status = VALUES(approval_status),
       updated_by = VALUES(updated_by)`,
    [SALES_ORDER_ID, TEST_TENANT_ID, SALES_ORDER_NO, CUSTOMER_ID, TEST_BOSS_ID, TEST_BOSS_ID, TEST_BOSS_ID],
  );

  await pool.execute(
    `INSERT INTO sales_orders
       (id, tenant_id, order_no, customer_id, order_type, status, priority,
        expected_delivery, total_amount, constraint_passed, approval_status,
        sales_person_id, notes, created_by, updated_by)
     VALUES (?, ?, ?, ?, 'urgent', 'confirmed', 95,
             '2026-04-08', 500.00, 1, 'approved',
             ?, 'E2E并发排产紧急单', ?, ?)
     ON DUPLICATE KEY UPDATE
       order_no = VALUES(order_no),
       customer_id = VALUES(customer_id),
       order_type = VALUES(order_type),
       status = VALUES(status),
       priority = VALUES(priority),
       expected_delivery = VALUES(expected_delivery),
       constraint_passed = VALUES(constraint_passed),
       approval_status = VALUES(approval_status),
       updated_by = VALUES(updated_by)`,
    [URGENT_SALES_ORDER_ID, TEST_TENANT_ID, URGENT_SALES_ORDER_NO, CUSTOMER_ID, TEST_BOSS_ID, TEST_BOSS_ID, TEST_BOSS_ID],
  );

  await pool.execute(
    `INSERT INTO sales_order_items
       (id, tenant_id, order_id, sku_id, qty_ordered, qty, qty_delivered,
        unit_price, amount, bom_header_id, created_by, updated_by)
     VALUES (?, ?, ?, ?, 5.0000, 5.0000, 0, 100.0000, 500.00, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       qty_ordered = VALUES(qty_ordered),
       qty = VALUES(qty),
       qty_delivered = VALUES(qty_delivered),
       unit_price = VALUES(unit_price),
       amount = VALUES(amount),
       bom_header_id = VALUES(bom_header_id),
       updated_by = VALUES(updated_by)`,
    [SALES_ORDER_ITEM_ID, TEST_TENANT_ID, SALES_ORDER_ID, FINISHED_SKU_ID, BOM_ID, TEST_BOSS_ID, TEST_BOSS_ID],
  );

  await pool.execute(
    `INSERT INTO sales_order_items
       (id, tenant_id, order_id, sku_id, qty_ordered, qty, qty_delivered,
        unit_price, amount, bom_header_id, created_by, updated_by)
     VALUES (?, ?, ?, ?, 5.0000, 5.0000, 0, 100.0000, 500.00, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       qty_ordered = VALUES(qty_ordered),
       qty = VALUES(qty),
       qty_delivered = VALUES(qty_delivered),
       unit_price = VALUES(unit_price),
       amount = VALUES(amount),
       bom_header_id = VALUES(bom_header_id),
       updated_by = VALUES(updated_by)`,
    [URGENT_SALES_ORDER_ITEM_ID, TEST_TENANT_ID, URGENT_SALES_ORDER_ID, FINISHED_SKU_ID, BOM_ID, TEST_BOSS_ID, TEST_BOSS_ID],
  );
}

async function prepareScheduledOrder(
  date: string,
  salesOrderId = SALES_ORDER_ID,
): Promise<PreparedOrderContext> {
  const productionOrderId = await createReleasedOrder(salesOrderId);

  const genRes = await request(BASE_URL)
    .get(`/api/production/schedule/generate?date=${date}&force=true`)
    .set(authHeader('supervisor'));

  expect(genRes.status).toBe(200);
  expect(genRes.body.code).toBe(0);

  const confirmRes = await request(BASE_URL)
    .post('/api/production/schedule/confirm')
    .set(authHeader('supervisor'))
    .send({ date });

  expect(confirmRes.status).toBe(200);
  expect(confirmRes.body.code).toBe(0);

  const tasksRes = await request(BASE_URL)
    .get(`/api/production/tasks/worker/${TEST_WORKER_ID}?date=${date}`)
    .set(authHeader('worker'));

  expect(tasksRes.status).toBe(200);
  expect(tasksRes.body.code).toBe(0);
  expect(tasksRes.body.data).toHaveLength(2);

  const tasks: Array<{ id: number; processStepName: string }> = tasksRes.body.data;
  const cutTask = tasks.find((task) => task.processStepName === '裁切');
  const packTask = tasks.find((task) => task.processStepName === '包装');

  expect(cutTask).toBeDefined();
  expect(packTask).toBeDefined();

  return {
    productionOrderId,
    firstTaskId: Number(cutTask!.id),
    finalTaskId: Number(packTask!.id),
  };
}

async function createReleasedOrder(salesOrderId: number): Promise<number> {
  const createRes = await request(BASE_URL)
    .post(`/api/production/orders/from-sales-order/${salesOrderId}`)
    .set(authHeader('supervisor'))
    .send();

  expect(createRes.status).toBe(201);
  expect(createRes.body.code).toBe(0);

  const productionOrderId = Number(createRes.body.data[0]?.id);
  expect(productionOrderId).toBeGreaterThan(0);

  const releaseRes = await request(BASE_URL)
    .post(`/api/production/orders/${productionOrderId}/release`)
    .set(authHeader('supervisor'))
    .send();

  expect(releaseRes.status).toBe(200);
  expect(releaseRes.body.code).toBe(0);
  await applyResolvedWipSku(productionOrderId);
  return productionOrderId;
}

async function applyResolvedWipSku(productionOrderId: number): Promise<void> {
  const pool = getDbPool();
  const [componentRows] = await pool.query<Array<RowDataPacket & { id: number }>>(
    `SELECT id
     FROM production_order_components
     WHERE tenant_id = ?
       AND production_order_id = ?
       AND sku_id = ?
       AND component_type = 'wip'
     ORDER BY id ASC
     LIMIT 1`,
    [TEST_TENANT_ID, productionOrderId, WIP_SKU_ID],
  );

  expect(componentRows).toHaveLength(1);

  const componentId = Number(componentRows[0].id);
  await pool.execute(
    `UPDATE production_order_components
     SET resolved_sku_id = ?, updated_by = ?
     WHERE tenant_id = ? AND id = ?`,
    [RESOLVED_WIP_SKU_ID, TEST_SUPERVISOR_ID, TEST_TENANT_ID, componentId],
  );
  await pool.execute(
    `UPDATE production_order_sku_resolutions
     SET resolved_sku_id = ?, rule_id = 1, created_by = ?
     WHERE tenant_id = ? AND production_order_id = ? AND component_id = ?`,
    [RESOLVED_WIP_SKU_ID, TEST_SUPERVISOR_ID, TEST_TENANT_ID, productionOrderId, componentId],
  );
}

async function completeScheduledOrder(date: string): Promise<{ productionOrderId: number }> {
  const prepared = await prepareScheduledOrder(date);

  const firstStartRes = await request(BASE_URL)
    .post(`/api/production/tasks/${prepared.firstTaskId}/start`)
    .set(authHeader('worker'))
    .send();

  expect(firstStartRes.status).toBe(200);
  expect(firstStartRes.body.code).toBe(0);

  const firstCompleteRes = await request(BASE_URL)
    .post(`/api/production/tasks/${prepared.firstTaskId}/complete-v2`)
    .set(authHeader('worker'))
    .send({
      completedQty: '5',
      actualHours: 1.6,
      notes: 'E2E 质量流首工序完工',
    });

  expect(firstCompleteRes.status).toBe(200);
  expect(firstCompleteRes.body.code).toBe(0);

  const finalStartRes = await request(BASE_URL)
    .post(`/api/production/tasks/${prepared.finalTaskId}/start`)
    .set(authHeader('worker'))
    .send();

  expect(finalStartRes.status).toBe(200);
  expect(finalStartRes.body.code).toBe(0);

  const finalCompleteRes = await request(BASE_URL)
    .post(`/api/production/tasks/${prepared.finalTaskId}/complete-v2`)
    .set(authHeader('worker'))
    .send({
      completedQty: '5',
      actualHours: 2.4,
      notes: 'E2E 质量流最终工序完工',
    });

  expect(finalCompleteRes.status).toBe(200);
  expect(finalCompleteRes.body.code).toBe(0);

  return { productionOrderId: prepared.productionOrderId };
}

afterAll(async () => {
  await dbPool?.end();
  dbPool = null;
});

describe('E2E: 半成品生产主链路', () => {
  let productionOrderId: number;
  let firstTaskId: number;
  let finalTaskId: number;

  beforeAll(async () => {
    await seedProductionFlowData();
  });

  test('Step 1: supervisor 从销售订单创建生产工单', async () => {
    const res = await request(BASE_URL)
      .post(`/api/production/orders/from-sales-order/${SALES_ORDER_ID}`)
      .set(authHeader('supervisor'))
      .send();

    expect(res.status).toBe(201);
    expect(res.body.code).toBe(0);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].materialStatus).toBe('ready');

    productionOrderId = res.body.data[0].id;
    expect(productionOrderId).toBeGreaterThan(0);
  });

  test('Step 2: release 生成组件和工序', async () => {
    const releaseRes = await request(BASE_URL)
      .post(`/api/production/orders/${productionOrderId}/release`)
      .set(authHeader('supervisor'))
      .send();

    expect(releaseRes.status).toBe(200);
    expect(releaseRes.body.code).toBe(0);
    expect(releaseRes.body.data.reused).toBe(false);
    expect(releaseRes.body.data.componentCount).toBeGreaterThanOrEqual(3);
    expect(releaseRes.body.data.operationCount).toBe(2);

    await applyResolvedWipSku(productionOrderId);
  });

  test('Step 3: 生成并确认排产，重复 confirm 不得重复建任务', async () => {
    const genRes = await request(BASE_URL)
      .get(`/api/production/schedule/generate?date=${SCHEDULE_DATE}&force=true`)
      .set(authHeader('supervisor'));

    expect(genRes.status).toBe(200);
    expect(genRes.body.code).toBe(0);
    expect(genRes.body.data.summary.totalOrders).toBe(1);
    expect(genRes.body.data.summary.totalSteps).toBe(2);

    const confirmRes1 = await request(BASE_URL)
      .post('/api/production/schedule/confirm')
      .set(authHeader('supervisor'))
      .send({ date: SCHEDULE_DATE });

    expect(confirmRes1.status).toBe(200);
    expect(confirmRes1.body.code).toBe(0);

    const confirmRes2 = await request(BASE_URL)
      .post('/api/production/schedule/confirm')
      .set(authHeader('supervisor'))
      .send({ date: SCHEDULE_DATE });

    expect(confirmRes2.status).toBe(200);
    expect(confirmRes2.body.code).toBe(0);

    const tasksRes = await request(BASE_URL)
      .get(`/api/production/tasks/worker/${TEST_WORKER_ID}?date=${SCHEDULE_DATE}`)
      .set(authHeader('worker'));

    expect(tasksRes.status).toBe(200);
    expect(tasksRes.body.code).toBe(0);
    expect(tasksRes.body.data).toHaveLength(2);

    const tasks: Array<{ id: number; processStepName: string; status: string }> = tasksRes.body.data;
    const cutTask = tasks.find((task) => task.processStepName === '裁切');
    const packTask = tasks.find((task) => task.processStepName === '包装');

    expect(cutTask).toBeDefined();
    expect(packTask).toBeDefined();

    firstTaskId = Number(cutTask!.id);
    finalTaskId = Number(packTask!.id);
  });

  test('Step 4: 重复 start 会被拒绝，避免同一任务被重复开工', async () => {
    const startRes = await request(BASE_URL)
      .post(`/api/production/tasks/${firstTaskId}/start`)
      .set(authHeader('worker'))
      .send();

    expect(startRes.status).toBe(200);
    expect(startRes.body.code).toBe(0);

    const duplicateStartRes = await request(BASE_URL)
      .post(`/api/production/tasks/${firstTaskId}/start`)
      .set(authHeader('worker'))
      .send();

    expect(duplicateStartRes.status).toBe(409);
    expect(duplicateStartRes.body.code).not.toBe(0);

    const pool = getDbPool();
    const [inputRows] = await pool.query<Array<RowDataPacket & {
      sku_id: number;
      io_type: string;
      planned_qty: string;
      actual_qty: string;
    }>>(
      `SELECT sku_id, io_type, planned_qty, actual_qty
       FROM task_material_transactions
       WHERE tenant_id = ? AND task_id = ? AND io_type = 'input'
       ORDER BY id`,
      [TEST_TENANT_ID, firstTaskId],
    );

    expect(inputRows).toHaveLength(1);
    expect(inputRows[0].sku_id).toBe(MATERIAL_SKU_ID);
    expect(inputRows[0].io_type).toBe('input');
    expect(inputRows[0].planned_qty).toBe('10.0000');
    expect(inputRows[0].actual_qty).toBe('10.0000');
  });

  test('Step 5: 第一工序完工后，工单仍为 in_progress 且 qty_completed=0', async () => {

    const completeRes = await request(BASE_URL)
      .post(`/api/production/tasks/${firstTaskId}/complete-v2`)
      .set(authHeader('worker'))
      .send({
        completedQty: '5',
        actualHours: 1.5,
        notes: 'E2E 第一工序完工',
      });

    expect(completeRes.status).toBe(200);
    expect(completeRes.body.code).toBe(0);

    const orderRes = await request(BASE_URL)
      .get(`/api/production/orders/${productionOrderId}`)
      .set(authHeader('supervisor'));

    expect(orderRes.status).toBe(200);
    expect(orderRes.body.code).toBe(0);
    expect(orderRes.body.data.status).toBe('in_progress');

    const pool = getDbPool();
    const [orderRows] = await pool.query<OrderStateRow[]>(
      `SELECT status, qty_completed, actual_end
       FROM production_orders
       WHERE id = ? AND tenant_id = ?`,
      [productionOrderId, TEST_TENANT_ID],
    );

    expect(orderRows[0].status).toBe('in_progress');
    expect(orderRows[0].qty_completed).toBe('0.0000');

    const [outputRows] = await pool.query<Array<RowDataPacket & {
      sku_id: number;
      io_type: string;
      planned_qty: string;
      actual_qty: string;
    }>>(
      `SELECT sku_id, io_type, planned_qty, actual_qty
       FROM task_material_transactions
       WHERE tenant_id = ? AND task_id = ? AND io_type = 'output'
       ORDER BY id`,
      [TEST_TENANT_ID, firstTaskId],
    );

    expect(outputRows).toHaveLength(1);
    expect(outputRows[0].sku_id).toBe(RESOLVED_WIP_SKU_ID);
    expect(outputRows[0].io_type).toBe('output');
    expect(outputRows[0].planned_qty).toBe('5.0000');
    expect(outputRows[0].actual_qty).toBe('5.0000');

    const [inputRows] = await pool.query<CountRow[]>(
      `SELECT COUNT(*) AS cnt
       FROM task_material_transactions
       WHERE tenant_id = ? AND task_id = ? AND io_type = 'input'`,
      [TEST_TENANT_ID, firstTaskId],
    );

    expect(Number(inputRows[0].cnt)).toBe(1);

    const [wipTxRows] = await pool.query<CountRow[]>(
      `SELECT COUNT(*) AS cnt
       FROM inventory_transactions
       WHERE tenant_id = ?
         AND transaction_type = 'PRODUCTION_IN'
         AND sku_id = ?
         AND reference_id = ?`,
      [TEST_TENANT_ID, RESOLVED_WIP_SKU_ID, productionOrderId],
    );

    expect(Number(wipTxRows[0].cnt)).toBe(1);

    const [wipInventoryRows] = await pool.query<InventoryRow[]>(
      `SELECT qty_on_hand
       FROM inventory
       WHERE tenant_id = ? AND sku_id = ?`,
      [TEST_TENANT_ID, RESOLVED_WIP_SKU_ID],
    );

    expect(wipInventoryRows[0].qty_on_hand).toBe('5.0000');

    const [wipSnapshotRows] = await pool.query<InventorySnapshotRow[]>(
      `SELECT snapshot_date, qty_on_hand, qty_reserved, qty_available
       FROM inventory_daily_snapshots
       WHERE tenant_id = ? AND sku_id = ?
       ORDER BY snapshot_date DESC, id DESC
       LIMIT 1`,
      [TEST_TENANT_ID, RESOLVED_WIP_SKU_ID],
    );

    expect(wipSnapshotRows).toHaveLength(1);
    expect(wipSnapshotRows[0].qty_on_hand).toBe('5.0000');
    expect(wipSnapshotRows[0].qty_reserved).toBe('0.0000');
    expect(wipSnapshotRows[0].qty_available).toBe('5.0000');
  });

  test('Step 6: 全部任务完工后，整单 completed 且形成半成品+成品两段入库', async () => {
    const startRes = await request(BASE_URL)
      .post(`/api/production/tasks/${finalTaskId}/start`)
      .set(authHeader('worker'))
      .send();

    expect(startRes.status).toBe(200);
    expect(startRes.body.code).toBe(0);

    const completeRes = await request(BASE_URL)
      .post(`/api/production/tasks/${finalTaskId}/complete-v2`)
      .set(authHeader('worker'))
      .send({
        completedQty: '5',
        actualHours: 2.5,
        notes: 'E2E 最终工序完工',
      });

    expect(completeRes.status).toBe(200);
    expect(completeRes.body.code).toBe(0);

    const pool = getDbPool();

    const [orders] = await pool.query<OrderStateRow[]>(
      `SELECT status, qty_completed, actual_end
       FROM production_orders
       WHERE id = ? AND tenant_id = ?`,
      [productionOrderId, TEST_TENANT_ID],
    );

    expect(orders[0].status).toBe('completed');
    expect(orders[0].qty_completed).toBe('5.0000');
    expect(orders[0].actual_end).not.toBeNull();

    const [txRows] = await pool.query<CountRow[]>(
      `SELECT COUNT(*) AS cnt
       FROM inventory_transactions
       WHERE tenant_id = ?
         AND transaction_type = 'PRODUCTION_IN'
         AND reference_id = ?`,
      [TEST_TENANT_ID, productionOrderId],
    );

    expect(Number(txRows[0].cnt)).toBe(2);

    const [wipTxRows] = await pool.query<CountRow[]>(
      `SELECT COUNT(*) AS cnt
       FROM inventory_transactions
       WHERE tenant_id = ?
         AND transaction_type = 'PRODUCTION_IN'
         AND sku_id = ?
         AND reference_id = ?`,
      [TEST_TENANT_ID, RESOLVED_WIP_SKU_ID, productionOrderId],
    );

    expect(Number(wipTxRows[0].cnt)).toBe(1);

    const [finishedTxRows] = await pool.query<CountRow[]>(
      `SELECT COUNT(*) AS cnt
       FROM inventory_transactions
       WHERE tenant_id = ?
         AND transaction_type = 'PRODUCTION_IN'
         AND sku_id = ?
         AND reference_id = ?`,
      [TEST_TENANT_ID, FINISHED_SKU_ID, productionOrderId],
    );

    expect(Number(finishedTxRows[0].cnt)).toBe(1);

    const [inventoryRows] = await pool.query<InventoryRow[]>(
      `SELECT qty_on_hand
       FROM inventory
       WHERE tenant_id = ? AND sku_id = ?`,
      [TEST_TENANT_ID, FINISHED_SKU_ID],
    );

    expect(inventoryRows[0].qty_on_hand).toBe('5.0000');

    const [finishedSnapshotRows] = await pool.query<InventorySnapshotRow[]>(
      `SELECT snapshot_date, qty_on_hand, qty_reserved, qty_available
       FROM inventory_daily_snapshots
       WHERE tenant_id = ? AND sku_id = ?
       ORDER BY snapshot_date DESC, id DESC
       LIMIT 1`,
      [TEST_TENANT_ID, FINISHED_SKU_ID],
    );

    expect(finishedSnapshotRows).toHaveLength(1);
    expect(finishedSnapshotRows[0].qty_on_hand).toBe('5.0000');
    expect(finishedSnapshotRows[0].qty_reserved).toBe('0.0000');
    expect(finishedSnapshotRows[0].qty_available).toBe('5.0000');

    const [outputRows] = await pool.query<Array<RowDataPacket & {
      sku_id: number;
      io_type: string;
      actual_qty: string;
    }>>(
      `SELECT sku_id, io_type, actual_qty
       FROM task_material_transactions
       WHERE tenant_id = ? AND task_id = ? AND io_type = 'output'
       ORDER BY id`,
      [TEST_TENANT_ID, finalTaskId],
    );

    expect(outputRows).toHaveLength(1);
    expect(outputRows[0].sku_id).toBe(FINISHED_SKU_ID);
    expect(outputRows[0].io_type).toBe('output');
    expect(outputRows[0].actual_qty).toBe('5.0000');

    const [inputRows] = await pool.query<Array<RowDataPacket & {
      sku_id: number;
      io_type: string;
      actual_qty: string;
    }>>(
      `SELECT sku_id, io_type, actual_qty
       FROM task_material_transactions
       WHERE tenant_id = ? AND task_id = ? AND io_type = 'input'
       ORDER BY id`,
      [TEST_TENANT_ID, finalTaskId],
    );

    expect(inputRows).toHaveLength(1);
    expect(inputRows[0].sku_id).toBe(RESOLVED_WIP_SKU_ID);
    expect(inputRows[0].io_type).toBe('input');
    expect(inputRows[0].actual_qty).toBe('5.0000');
  });

  test('Step 7: 重复 complete-v2 会被拒绝，且不会重复写报工或新增任何阶段入库', async () => {
    const duplicateRes = await request(BASE_URL)
      .post(`/api/production/tasks/${finalTaskId}/complete-v2`)
      .set(authHeader('worker'))
      .send({
        completedQty: '5',
        actualHours: 2.5,
        notes: 'E2E 重复提交完工',
      });

    expect(duplicateRes.status).toBe(409);
    expect(duplicateRes.body.code).not.toBe(0);

    const pool = getDbPool();
    const [txRows] = await pool.query<CountRow[]>(
      `SELECT COUNT(*) AS cnt
       FROM inventory_transactions
       WHERE tenant_id = ?
         AND transaction_type = 'PRODUCTION_IN'
         AND reference_id = ?`,
      [TEST_TENANT_ID, productionOrderId],
    );
    expect(Number(txRows[0].cnt)).toBe(2);

    const [wipTxRows] = await pool.query<CountRow[]>(
      `SELECT COUNT(*) AS cnt
       FROM inventory_transactions
       WHERE tenant_id = ?
         AND transaction_type = 'PRODUCTION_IN'
         AND sku_id = ?
         AND reference_id = ?`,
      [TEST_TENANT_ID, RESOLVED_WIP_SKU_ID, productionOrderId],
    );
    expect(Number(wipTxRows[0].cnt)).toBe(1);

    const [finishedTxRows] = await pool.query<CountRow[]>(
      `SELECT COUNT(*) AS cnt
       FROM inventory_transactions
       WHERE tenant_id = ?
         AND transaction_type = 'PRODUCTION_IN'
         AND sku_id = ?
         AND reference_id = ?`,
      [TEST_TENANT_ID, FINISHED_SKU_ID, productionOrderId],
    );
    expect(Number(finishedTxRows[0].cnt)).toBe(1);

    const [reportRows] = await pool.query<CountRow[]>(
      `SELECT COUNT(*) AS cnt
       FROM work_reports
       WHERE tenant_id = ? AND production_order_id = ?`,
      [TEST_TENANT_ID, productionOrderId],
    );
    expect(Number(reportRows[0].cnt)).toBe(2);
  });

  test('Step 8: 工资报表与报工记录可查询', async () => {
    const wagesRes = await request(BASE_URL)
      .get(`/api/reports/wages?page=1&pageSize=20&userId=${TEST_WORKER_ID}`)
      .set(authHeader('boss'));

    expect(wagesRes.status).toBe(200);
    expect(wagesRes.body.code).toBe(0);
    expect(wagesRes.body.data.total).toBe(2);

    const rows: Array<{ userId: number; userName: string; stepName: string }> = wagesRes.body.data.list;
    expect(rows.every((row) => Number(row.userId) === TEST_WORKER_ID)).toBe(true);
    expect(rows.map((row) => row.stepName).sort()).toEqual(['包装', '裁切']);

    const pool = getDbPool();
    const [reportRows] = await pool.query<CountRow[]>(
      `SELECT COUNT(*) AS cnt
       FROM work_reports
       WHERE tenant_id = ? AND production_order_id = ?`,
      [TEST_TENANT_ID, productionOrderId],
    );

    expect(Number(reportRows[0].cnt)).toBe(2);
  });
});

describe('E2E: 生产任务异常流', () => {
  const exceptionScheduleDate = '2026-04-06';
  let productionOrderId: number;
  let firstTaskId: number;
  let finalTaskId: number;

  beforeAll(async () => {
    await seedProductionFlowData();
    const prepared = await prepareScheduledOrder(exceptionScheduleDate);
    productionOrderId = prepared.productionOrderId;
    firstTaskId = prepared.firstTaskId;
    finalTaskId = prepared.finalTaskId;
  });

  test('Step 9: supervisor 可挂起并恢复任务', async () => {
    const startRes = await request(BASE_URL)
      .post(`/api/production/tasks/${firstTaskId}/start`)
      .set(authHeader('worker'))
      .send();

    expect(startRes.status).toBe(200);
    expect(startRes.body.code).toBe(0);

    const suspendRes = await request(BASE_URL)
      .post(`/api/production/tasks/${firstTaskId}/suspend`)
      .set(authHeader('supervisor'))
      .send({ reason: '设备点检' });

    expect(suspendRes.status).toBe(200);
    expect(suspendRes.body.code).toBe(0);
    expect(suspendRes.body.data.status).toBe('suspended');
    expect(suspendRes.body.data.suspendReason).toBe('设备点检');

    const resumeRes = await request(BASE_URL)
      .post(`/api/production/tasks/${firstTaskId}/resume`)
      .set(authHeader('supervisor'))
      .send();

    expect(resumeRes.status).toBe(200);
    expect(resumeRes.body.code).toBe(0);
    expect(resumeRes.body.data.status).toBe('pending');
    expect(resumeRes.body.data.suspendReason).toBeNull();
  });

  test('Step 10: 异常上报后可恢复到 started，且异常记录被闭环', async () => {
    const restartRes = await request(BASE_URL)
      .post(`/api/production/tasks/${firstTaskId}/start`)
      .set(authHeader('worker'))
      .send();

    expect(restartRes.status).toBe(200);
    expect(restartRes.body.code).toBe(0);

    const exceptionRes = await request(BASE_URL)
      .post(`/api/production/tasks/${firstTaskId}/exception`)
      .set(authHeader('worker'))
      .send({
        type: '设备故障',
        description: '裁切机停机待处理',
        severity: 'high',
        affectsProgress: true,
      });

    expect(exceptionRes.status).toBe(200);
    expect(exceptionRes.body.code).toBe(0);

    const detailAfterException = await request(BASE_URL)
      .get(`/api/production/tasks/${firstTaskId}`)
      .set(authHeader('supervisor'));

    expect(detailAfterException.status).toBe(200);
    expect(detailAfterException.body.code).toBe(0);
    expect(detailAfterException.body.data.status).toBe('exception');
    expect(detailAfterException.body.data.exceptions).toHaveLength(1);
    expect(detailAfterException.body.data.exceptions[0].type).toBe('设备故障');
    expect(detailAfterException.body.data.exceptions[0].resolvedAt).toBeNull();

    const resolveRes = await request(BASE_URL)
      .post(`/api/production/tasks/${firstTaskId}/resolve-exception`)
      .set(authHeader('supervisor'))
      .send({ resolution: '更换刀片后恢复生产' });

    expect(resolveRes.status).toBe(200);
    expect(resolveRes.body.code).toBe(0);

    const detailAfterResolve = await request(BASE_URL)
      .get(`/api/production/tasks/${firstTaskId}`)
      .set(authHeader('supervisor'));

    expect(detailAfterResolve.status).toBe(200);
    expect(detailAfterResolve.body.code).toBe(0);
    expect(detailAfterResolve.body.data.status).toBe('in_progress');
    expect(detailAfterResolve.body.data.exceptions).toHaveLength(1);
    expect(detailAfterResolve.body.data.exceptions[0].resolution).toBe('更换刀片后恢复生产');
    expect(detailAfterResolve.body.data.exceptions[0].resolvedAt).not.toBeNull();

    const pool = getDbPool();
    const [taskRows] = await pool.query<Array<RowDataPacket & { status: string }>>(
      `SELECT status
       FROM production_tasks
       WHERE id = ? AND tenant_id = ?`,
      [firstTaskId, TEST_TENANT_ID],
    );

    expect(taskRows[0].status).toBe('started');
  });

  test('Step 11: 异常解决后任务仍可继续完工，并最终完成整单入库', async () => {
    const firstCompleteRes = await request(BASE_URL)
      .post(`/api/production/tasks/${firstTaskId}/complete-v2`)
      .set(authHeader('worker'))
      .send({
        completedQty: '5',
        actualHours: 1.8,
        notes: 'E2E 异常恢复后继续完工',
      });

    expect(firstCompleteRes.status).toBe(200);
    expect(firstCompleteRes.body.code).toBe(0);

    const middleOrderRes = await request(BASE_URL)
      .get(`/api/production/orders/${productionOrderId}`)
      .set(authHeader('supervisor'));

    expect(middleOrderRes.status).toBe(200);
    expect(middleOrderRes.body.code).toBe(0);
    expect(middleOrderRes.body.data.status).toBe('in_progress');

    const finalStartRes = await request(BASE_URL)
      .post(`/api/production/tasks/${finalTaskId}/start`)
      .set(authHeader('worker'))
      .send();

    expect(finalStartRes.status).toBe(200);
    expect(finalStartRes.body.code).toBe(0);

    const finalCompleteRes = await request(BASE_URL)
      .post(`/api/production/tasks/${finalTaskId}/complete-v2`)
      .set(authHeader('worker'))
      .send({
        completedQty: '5',
        actualHours: 2.2,
        notes: 'E2E 异常流最终工序完工',
      });

    expect(finalCompleteRes.status).toBe(200);
    expect(finalCompleteRes.body.code).toBe(0);

    const pool = getDbPool();
    const [orderRows] = await pool.query<OrderStateRow[]>(
      `SELECT status, qty_completed, actual_end
       FROM production_orders
       WHERE id = ? AND tenant_id = ?`,
      [productionOrderId, TEST_TENANT_ID],
    );

    expect(orderRows[0].status).toBe('completed');
    expect(orderRows[0].qty_completed).toBe('5.0000');
    expect(orderRows[0].actual_end).not.toBeNull();

    const [txRows] = await pool.query<CountRow[]>(
      `SELECT COUNT(*) AS cnt
       FROM inventory_transactions
       WHERE tenant_id = ?
         AND transaction_type = 'PRODUCTION_IN'
         AND reference_id = ?`,
      [TEST_TENANT_ID, productionOrderId],
    );

    expect(Number(txRows[0].cnt)).toBe(2);
  });

  test('Step 11-B: 异常恢复链路的任务工资明细保持一致且无重复报工', async () => {
    const taskWagesRes = await request(BASE_URL)
      .get(`/api/reports/wages/tasks?page=1&pageSize=20&productionOrderId=${productionOrderId}&userId=${TEST_WORKER_ID}`)
      .set(authHeader('boss'));

    expect(taskWagesRes.status).toBe(200);
    expect(taskWagesRes.body.code).toBe(0);
    expect(Number(taskWagesRes.body.data.total)).toBe(2);

    const rows: WageTaskReportRow[] = taskWagesRes.body.data.list ?? [];
    expect(rows).toHaveLength(2);

    const rowByTaskId = new Map(
      rows.map((row) => [Number(row.taskId), row]),
    );
    expect(Array.from(rowByTaskId.keys()).sort((a, b) => a - b)).toEqual(
      [Number(firstTaskId), Number(finalTaskId)].sort((a, b) => a - b),
    );

    const firstTaskRow = rowByTaskId.get(Number(firstTaskId));
    const finalTaskRow = rowByTaskId.get(Number(finalTaskId));
    expect(firstTaskRow).toBeDefined();
    expect(finalTaskRow).toBeDefined();

    expect(firstTaskRow?.taskStatus).toBe('completed');
    expect(firstTaskRow?.qtyCompleted).toBe('5.0000');
    expect(firstTaskRow?.qtyQualified).toBe('5.0000');
    expect(firstTaskRow?.qtyDefective).toBe('0.0000');
    expect(firstTaskRow?.workHours).toBe('1.80');
    expect(firstTaskRow?.unitPrice).toBe('2.5000');
    expect(firstTaskRow?.subtotal).toBe('12.50');

    expect(finalTaskRow?.taskStatus).toBe('completed');
    expect(finalTaskRow?.qtyCompleted).toBe('5.0000');
    expect(finalTaskRow?.qtyQualified).toBe('5.0000');
    expect(finalTaskRow?.qtyDefective).toBe('0.0000');
    expect(finalTaskRow?.workHours).toBe('2.20');
    expect(finalTaskRow?.unitPrice).toBe('3.0000');
    expect(finalTaskRow?.subtotal).toBe('15.00');

    const pool = getDbPool();
    const [reportRows] = await pool.query<CountRow[]>(
      `SELECT COUNT(*) AS cnt
       FROM work_reports
       WHERE tenant_id = ? AND production_order_id = ?`,
      [TEST_TENANT_ID, productionOrderId],
    );
    expect(Number(reportRows[0].cnt)).toBe(2);
  });
});

describe('E2E: 质量检验与溯源', () => {
  const qualityScheduleDate = '2026-04-08';
  let productionOrderId: number;
  let inspectionId: number;
  let issueId: number;

  beforeAll(async () => {
    await seedProductionFlowData();
    const completed = await completeScheduledOrder(qualityScheduleDate);
    productionOrderId = completed.productionOrderId;
  });

  test('Step 12: qc 可创建验货单、登记缺陷并完成验货', async () => {
    const createRes = await request(BASE_URL)
      .post('/api/quality/inspections')
      .set(authHeader('qc'))
      .send({
        productionOrderId,
        inspectionDate: qualityScheduleDate,
        qtyInspected: '5',
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.code).toBe(0);
    inspectionId = Number(createRes.body.data.id);
    expect(inspectionId).toBeGreaterThan(0);

    const listRes = await request(BASE_URL)
      .get(`/api/quality/inspections?page=1&pageSize=20&productionOrderId=${productionOrderId}`)
      .set(authHeader('qc'));

    expect(listRes.status).toBe(200);
    expect(listRes.body.code).toBe(0);
    expect(listRes.body.data.total).toBe(1);
    expect(listRes.body.data.list[0].inspectorName).toBe('E2E质检');

    const issueRes = await request(BASE_URL)
      .post('/api/quality/inspections/issues')
      .set(authHeader('qc'))
      .send({
        inspectionId,
        componentName: 'E2E成品外观',
        issueTypes: ['appearance'],
        severity: 'normal',
        description: '边缘有轻微毛边',
      });

    expect(issueRes.status).toBe(201);
    expect(issueRes.body.code).toBe(0);
    issueId = Number(issueRes.body.data.issueId);
    expect(issueId).toBeGreaterThan(0);

    const completeRes = await request(BASE_URL)
      .post(`/api/quality/inspections/${inspectionId}/complete`)
      .set(authHeader('qc'))
      .send({ qtyPassed: '4' });

    expect(completeRes.status).toBe(200);
    expect(completeRes.body.code).toBe(0);

    const pool = getDbPool();
    const [inspectionRows] = await pool.query<Array<RowDataPacket & {
      status: string;
      qty_failed: string;
      qty_passed: string;
    }>>(
      `SELECT status, qty_failed, qty_passed
       FROM inspection_records
       WHERE id = ? AND tenant_id = ?`,
      [inspectionId, TEST_TENANT_ID],
    );

    expect(inspectionRows[0].status).toBe('completed');
    expect(inspectionRows[0].qty_failed).toBe('1.0000');
    expect(inspectionRows[0].qty_passed).toBe('4.0000');
  });

  test('Step 13: 质量问题明细与列表可查询', async () => {
    const issueDetailRes = await request(BASE_URL)
      .get(`/api/quality/issues/${issueId}`)
      .set(authHeader('qc'));

    expect(issueDetailRes.status).toBe(200);
    expect(issueDetailRes.body.code).toBe(0);
    expect(Number(issueDetailRes.body.data.inspectionId)).toBe(inspectionId);
    expect(issueDetailRes.body.data.componentName).toBe('E2E成品外观');
    expect(issueDetailRes.body.data.issueTypes).toEqual(['appearance']);

    const listRes = await request(BASE_URL)
      .get('/api/quality/issues?page=1&pageSize=20&severity=normal&issueType=appearance')
      .set(authHeader('qc'));

    expect(listRes.status).toBe(200);
    expect(listRes.body.code).toBe(0);
    expect(listRes.body.data.total).toBe(1);
    expect(Number(listRes.body.data.list[0].id)).toBe(issueId);
  });

  test('Step 14: 完工工单可查询溯源链', async () => {
    const traceRes = await request(BASE_URL)
      .get(`/api/quality/traceability/${productionOrderId}`)
      .set(authHeader('qc'));

    expect(traceRes.status).toBe(200);
    expect(traceRes.body.code).toBe(0);
    expect(Number(traceRes.body.data.productionOrderId)).toBe(productionOrderId);
    expect(traceRes.body.data.summary.totalComponents).toBeGreaterThanOrEqual(2);

    const stepNames = traceRes.body.data.components.map((item: { processStepName: string }) => item.processStepName).sort();
    expect(stepNames).toEqual(['包装', '裁切']);
    expect(traceRes.body.data.components.every((item: { workerName: string }) => item.workerName === 'E2E工人')).toBe(true);
  });
});

describe('E2E: 多工单并发排产', () => {
  const multiOrderScheduleDate = '2026-04-07';

  beforeAll(async () => {
    await seedProductionFlowData();
  });

  test('Step 15: 紧急高优先工单在排产结果中优先于普通工单', async () => {
    const normalProductionOrderId = await createReleasedOrder(SALES_ORDER_ID);
    const urgentProductionOrderId = await createReleasedOrder(URGENT_SALES_ORDER_ID);

    const genRes = await request(BASE_URL)
      .get(`/api/production/schedule/generate?date=${multiOrderScheduleDate}&force=true`)
      .set(authHeader('supervisor'));

    expect(genRes.status).toBe(200);
    expect(genRes.body.code).toBe(0);
    expect(genRes.body.data.summary.totalOrders).toBe(2);
    expect(genRes.body.data.summary.totalSteps).toBe(4);

    const schedules: Array<{ productionOrderId: number | string; workOrderNo: string }> = genRes.body.data.schedules;
    const urgentIndex = schedules.findIndex(
      (item) => Number(item.productionOrderId) === urgentProductionOrderId,
    );
    const normalIndex = schedules.findIndex(
      (item) => Number(item.productionOrderId) === normalProductionOrderId,
    );

    expect(urgentIndex).toBeGreaterThanOrEqual(0);
    expect(normalIndex).toBeGreaterThanOrEqual(0);
    expect(urgentIndex).toBeLessThan(normalIndex);
  });
});

describe('E2E: 并发确认排产', () => {
  const concurrentConfirmDate = '2026-04-09';

  beforeAll(async () => {
    await seedProductionFlowData();
  });

  test('Step 16: 两个主管并发 confirm 同一日期排产时，只会下发一份任务', async () => {
    await createReleasedOrder(SALES_ORDER_ID);

    const genRes = await request(BASE_URL)
      .get(`/api/production/schedule/generate?date=${concurrentConfirmDate}&force=true`)
      .set(authHeader('supervisor'));

    expect(genRes.status).toBe(200);
    expect(genRes.body.code).toBe(0);
    expect(genRes.body.data.summary.totalSteps).toBe(2);

    const [confirmRes1, confirmRes2] = await Promise.all([
      request(BASE_URL)
        .post('/api/production/schedule/confirm')
        .set(authHeader('supervisor'))
        .send({ date: concurrentConfirmDate }),
      request(BASE_URL)
        .post('/api/production/schedule/confirm')
        .set(authHeader('boss'))
        .send({ date: concurrentConfirmDate }),
    ]);

    expect(confirmRes1.status).toBe(200);
    expect(confirmRes1.body.code).toBe(0);
    expect(confirmRes2.status).toBe(200);
    expect(confirmRes2.body.code).toBe(0);

    const tasksRes = await request(BASE_URL)
      .get(`/api/production/tasks/worker/${TEST_WORKER_ID}?date=${concurrentConfirmDate}`)
      .set(authHeader('worker'));

    expect(tasksRes.status).toBe(200);
    expect(tasksRes.body.code).toBe(0);
    expect(tasksRes.body.data).toHaveLength(2);

    const pool = getDbPool();
    const [taskRows] = await pool.query<CountRow[]>(
      `SELECT COUNT(*) AS cnt
       FROM production_tasks
       WHERE tenant_id = ? AND task_date = ?`,
      [TEST_TENANT_ID, concurrentConfirmDate],
    );

    expect(Number(taskRows[0].cnt)).toBe(2);
  });
});

describe('E2E: 并发调整排产', () => {
  const concurrentAdjustDate = '2026-04-10';

  beforeAll(async () => {
    await seedProductionFlowData();
  });

  test('Step 17: 两个主管并发调整同一日期的不同排产行时，调整结果都能保留并正确下发', async () => {
    await createReleasedOrder(SALES_ORDER_ID);

    const genRes = await request(BASE_URL)
      .get(`/api/production/schedule/generate?date=${concurrentAdjustDate}&force=true`)
      .set(authHeader('supervisor'));

    expect(genRes.status).toBe(200);
    expect(genRes.body.code).toBe(0);
    expect(genRes.body.data.schedules).toHaveLength(2);

    const schedules: Array<{ scheduleId: number | string; stepName: string }> = genRes.body.data.schedules;
    const cutSchedule = schedules.find((item) => item.stepName === '裁切');
    const packSchedule = schedules.find((item) => item.stepName === '包装');

    expect(cutSchedule).toBeDefined();
    expect(packSchedule).toBeDefined();

    const [adjustRes1, adjustRes2] = await Promise.all([
      request(BASE_URL)
        .put(`/api/production/schedule/${concurrentAdjustDate}/adjust`)
        .set(authHeader('supervisor'))
        .send({
          adjustments: [
            {
              scheduleId: Number(cutSchedule!.scheduleId),
              plannedQty: '6.50',
            },
          ],
        }),
      request(BASE_URL)
        .put(`/api/production/schedule/${concurrentAdjustDate}/adjust`)
        .set(authHeader('boss'))
        .send({
          adjustments: [
            {
              scheduleId: Number(packSchedule!.scheduleId),
              plannedQty: '4.50',
            },
          ],
        }),
    ]);

    expect(adjustRes1.status).toBe(200);
    expect(adjustRes1.body.code).toBe(0);
    expect(adjustRes1.body.data.updated).toBe(1);
    expect(adjustRes2.status).toBe(200);
    expect(adjustRes2.body.code).toBe(0);
    expect(adjustRes2.body.data.updated).toBe(1);

    const confirmRes = await request(BASE_URL)
      .post('/api/production/schedule/confirm')
      .set(authHeader('supervisor'))
      .send({ date: concurrentAdjustDate });

    expect(confirmRes.status).toBe(200);
    expect(confirmRes.body.code).toBe(0);

    const tasksRes = await request(BASE_URL)
      .get(`/api/production/tasks/worker/${TEST_WORKER_ID}?date=${concurrentAdjustDate}`)
      .set(authHeader('worker'));

    expect(tasksRes.status).toBe(200);
    expect(tasksRes.body.code).toBe(0);
    expect(tasksRes.body.data).toHaveLength(2);

    const taskQtys = tasksRes.body.data.map((item: { planned_qty?: string; plannedQty?: string }) =>
      Number(item.plannedQty ?? item.planned_qty ?? 0),
    ).sort((a: number, b: number) => a - b);

    expect(taskQtys).toEqual([4.5, 6.5]);

    const pool = getDbPool();
    const [scheduleRows] = await pool.query<Array<RowDataPacket & { id: number; planned_qty: string }>>(
      `SELECT id, planned_qty
       FROM production_schedules
       WHERE tenant_id = ? AND schedule_date = ? AND id IN (?, ?)
       ORDER BY id`,
      [
        TEST_TENANT_ID,
        concurrentAdjustDate,
        Number(cutSchedule!.scheduleId),
        Number(packSchedule!.scheduleId),
      ],
    );

    expect(scheduleRows).toHaveLength(2);
    expect(scheduleRows.map((row) => Number(row.planned_qty)).sort((a, b) => a - b)).toEqual([4.5, 6.5]);
  });
});

describe('E2E: 同行并发调整排产', () => {
  const sameRowAdjustDate = '2026-04-11';

  beforeAll(async () => {
    await seedProductionFlowData();
  });

  test('Step 18: 两个主管并发调整同一排产行时，接口不会报错，最终计划量会被串行写入并用于任务下发', async () => {
    await createReleasedOrder(SALES_ORDER_ID);

    const genRes = await request(BASE_URL)
      .get(`/api/production/schedule/generate?date=${sameRowAdjustDate}&force=true`)
      .set(authHeader('supervisor'));

    expect(genRes.status).toBe(200);
    expect(genRes.body.code).toBe(0);
    expect(genRes.body.data.schedules).toHaveLength(2);

    const schedules: Array<{ scheduleId: number | string; stepName: string }> = genRes.body.data.schedules;
    const cutSchedule = schedules.find((item) => item.stepName === '裁切');

    expect(cutSchedule).toBeDefined();

    const requestedQtys = ['6.25', '7.25'];
    const [adjustRes1, adjustRes2] = await Promise.all([
      request(BASE_URL)
        .put(`/api/production/schedule/${sameRowAdjustDate}/adjust`)
        .set(authHeader('supervisor'))
        .send({
          adjustments: [
            {
              scheduleId: Number(cutSchedule!.scheduleId),
              plannedQty: requestedQtys[0],
            },
          ],
        }),
      request(BASE_URL)
        .put(`/api/production/schedule/${sameRowAdjustDate}/adjust`)
        .set(authHeader('boss'))
        .send({
          adjustments: [
            {
              scheduleId: Number(cutSchedule!.scheduleId),
              plannedQty: requestedQtys[1],
            },
          ],
        }),
    ]);

    expect(adjustRes1.status).toBe(200);
    expect(adjustRes1.body.code).toBe(0);
    expect(adjustRes1.body.data.updated).toBe(1);
    expect(adjustRes2.status).toBe(200);
    expect(adjustRes2.body.code).toBe(0);
    expect(adjustRes2.body.data.updated).toBe(1);

    const pool = getDbPool();
    const [scheduleRows] = await pool.query<Array<RowDataPacket & { planned_qty: string }>>(
      `SELECT planned_qty
       FROM production_schedules
       WHERE tenant_id = ? AND schedule_date = ? AND id = ?
       LIMIT 1`,
      [TEST_TENANT_ID, sameRowAdjustDate, Number(cutSchedule!.scheduleId)],
    );

    expect(scheduleRows).toHaveLength(1);
    const finalScheduleQty = Number(scheduleRows[0].planned_qty);
    expect([6.25, 7.25]).toContain(finalScheduleQty);

    const confirmRes = await request(BASE_URL)
      .post('/api/production/schedule/confirm')
      .set(authHeader('supervisor'))
      .send({ date: sameRowAdjustDate });

    expect(confirmRes.status).toBe(200);
    expect(confirmRes.body.code).toBe(0);

    const [taskRows] = await pool.query<Array<RowDataPacket & { planned_qty: string }>>(
      `SELECT planned_qty
       FROM production_tasks
       WHERE tenant_id = ? AND schedule_id = ?
       LIMIT 1`,
      [TEST_TENANT_ID, Number(cutSchedule!.scheduleId)],
    );

    expect(taskRows).toHaveLength(1);
    expect(Number(taskRows[0].planned_qty)).toBe(finalScheduleQty);
  });
});
