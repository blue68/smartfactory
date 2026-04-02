import mysql, { type Pool, type RowDataPacket } from '../../services/api/node_modules/mysql2/promise';
import { APP_BASE_URL, seedAuth } from './purchaseFlow';

export { APP_BASE_URL, seedAuth };

const TEST_TENANT_ID = 9999;
const DB_HOST = process.env.DB_HOST ?? '127.0.0.1';
const DB_PORT = Number(process.env.DB_PORT ?? '3307');
const DB_USER = process.env.DB_USER ?? 'sf_app';
const DB_PASS = process.env.DB_PASS ?? process.env.DB_PASSWORD ?? 'TestApp2026!Secure';
const DB_NAME = process.env.DB_NAME ?? 'smart_factory';
const TEST_USER_ID = 99001;

let dbPool: Pool | null = null;

interface SettlementRow extends RowDataPacket {
  status: string;
}

export interface SettlementScenario {
  customerId: number;
  orderId: number;
  settlementId: number;
  customerName: string;
  orderNo: string;
  settlementNo: string;
}

export interface SettlementRegressionScenario {
  primaryCustomerId: number;
  secondaryCustomerId: number;
  overdueDraftOrderId: number;
  overdueConfirmedOrderId: number;
  currentOrderId: number;
  overdueDraftSettlementId: number;
  overdueConfirmedSettlementId: number;
  currentSettlementId: number;
  primaryCustomerName: string;
  secondaryCustomerName: string;
  overdueDraftSettlementNo: string;
  overdueConfirmedSettlementNo: string;
  currentSettlementNo: string;
  primaryReceivableTotal: string;
  primaryPendingCount: number;
}

export interface SettlementAgingSummarySnapshot {
  overdueAmount: string;
  overdueCount: number;
}

function getDbPool(): Pool {
  if (!dbPool) {
    dbPool = mysql.createPool({
      host: DB_HOST,
      port: DB_PORT,
      user: DB_USER,
      password: DB_PASS,
      database: DB_NAME,
      connectionLimit: 4,
      waitForConnections: true,
    });
  }
  return dbPool;
}

function nextScenarioIds() {
  const suffix = `${Date.now().toString().slice(-5)}${Math.floor(Math.random() * 10)}`;
  return {
    customerId: Number(`81${suffix}`),
    orderId: Number(`82${suffix}`),
    settlementId: Number(`83${suffix}`),
    suffix,
  };
}

function nextRegressionScenarioIds() {
  const suffix = `${Date.now().toString().slice(-5)}${Math.floor(Math.random() * 10)}`;
  return {
    primaryCustomerId: Number(`84${suffix}`),
    secondaryCustomerId: Number(`85${suffix}`),
    overdueDraftOrderId: Number(`86${suffix}`),
    overdueConfirmedOrderId: Number(`87${suffix}`),
    currentOrderId: Number(`88${suffix}`),
    overdueDraftSettlementId: Number(`89${suffix}`),
    overdueConfirmedSettlementId: Number(`90${suffix}`),
    currentSettlementId: Number(`91${suffix}`),
    suffix,
  };
}

async function poll<T>(
  fn: () => Promise<T | null>,
  timeoutMs = 12_000,
  intervalMs = 300,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await fn();
    if (result) return result;
    if (Date.now() >= deadline) {
      throw new Error('Timed out while polling settlement flow data');
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

export async function closeSettlementFlowDbPool(): Promise<void> {
  if (dbPool) {
    const pool = dbPool;
    dbPool = null;
    await pool.end();
  }
}

export async function seedSettlementScenario(): Promise<SettlementScenario> {
  const pool = getDbPool();
  const { customerId, orderId, settlementId, suffix } = nextScenarioIds();
  const customerName = `Playwright结算客户-${suffix}`;
  const orderNo = `SO-ST-${suffix}`;
  const settlementNo = `ST-PW-${suffix}`;

  await pool.execute(
    `INSERT INTO tenants (id, code, name, status, settings)
     VALUES (?, 'TEST9999', 'Playwright QA Tenant', 'active', JSON_OBJECT())
     ON DUPLICATE KEY UPDATE
       code = VALUES(code),
       name = VALUES(name),
       status = VALUES(status),
       settings = VALUES(settings)`,
    [TEST_TENANT_ID],
  );

  await pool.execute(
    `INSERT INTO customers
       (id, tenant_id, code, name, grade, status, created_by, updated_by)
     VALUES (?, ?, ?, ?, 'A', 'active', ?, ?)
     ON DUPLICATE KEY UPDATE
       code = VALUES(code),
       name = VALUES(name),
       grade = VALUES(grade),
       status = VALUES(status),
       updated_by = VALUES(updated_by)`,
    [customerId, TEST_TENANT_ID, `CUS-ST-${suffix}`, customerName, TEST_USER_ID, TEST_USER_ID],
  );

  await pool.execute(
    `INSERT INTO sales_orders
       (id, tenant_id, order_no, customer_id, order_type, status, priority,
        expected_delivery, total_amount, constraint_passed, approval_status,
        sales_person_id, notes, created_by, updated_by)
     VALUES (?, ?, ?, ?, 'normal', 'shipped', 80, CURDATE(), 12800.00, 1, 'approved',
             ?, 'Playwright 结算真实浏览器回归', ?, ?)`,
    [orderId, TEST_TENANT_ID, orderNo, customerId, TEST_USER_ID, TEST_USER_ID, TEST_USER_ID],
  );

  await pool.execute(
    `INSERT INTO settlements
       (id, tenant_id, settlement_no, customer_id, order_id, total_amount, status,
        due_date, notes, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, 12800.00, 'draft', DATE_ADD(CURDATE(), INTERVAL 7 DAY), ?, ?, ?)`,
    [settlementId, TEST_TENANT_ID, settlementNo, customerId, orderId, 'Playwright 结算单草稿', TEST_USER_ID, TEST_USER_ID],
  );

  return {
    customerId,
    orderId,
    settlementId,
    customerName,
    orderNo,
    settlementNo,
  };
}

export async function cleanupSettlementScenario(scenario: SettlementScenario): Promise<void> {
  const pool = getDbPool();
  await pool.execute(
    'DELETE FROM settlements WHERE tenant_id = ? AND id = ?',
    [TEST_TENANT_ID, scenario.settlementId],
  );
  await pool.execute(
    'DELETE FROM sales_orders WHERE tenant_id = ? AND id = ?',
    [TEST_TENANT_ID, scenario.orderId],
  );
  await pool.execute(
    'DELETE FROM customers WHERE tenant_id = ? AND id = ?',
    [TEST_TENANT_ID, scenario.customerId],
  );
}

export async function seedSettlementRegressionScenario(): Promise<SettlementRegressionScenario> {
  const pool = getDbPool();
  const ids = nextRegressionScenarioIds();
  const primaryCustomerName = `Playwright应收客户-${ids.suffix}`;
  const secondaryCustomerName = `Playwright正常客户-${ids.suffix}`;
  const overdueDraftSettlementNo = `ST-RG-D-${ids.suffix}`;
  const overdueConfirmedSettlementNo = `ST-RG-C-${ids.suffix}`;
  const currentSettlementNo = `ST-RG-N-${ids.suffix}`;

  await pool.execute(
    `INSERT INTO tenants (id, code, name, status, settings)
     VALUES (?, 'TEST9999', 'Playwright QA Tenant', 'active', JSON_OBJECT())
     ON DUPLICATE KEY UPDATE
       code = VALUES(code),
       name = VALUES(name),
       status = VALUES(status),
       settings = VALUES(settings)`,
    [TEST_TENANT_ID],
  );

  await pool.execute(
    `INSERT INTO customers
       (id, tenant_id, code, name, grade, status, created_by, updated_by)
     VALUES (?, ?, ?, ?, 'A', 'active', ?, ?),
            (?, ?, ?, ?, 'A', 'active', ?, ?)
     ON DUPLICATE KEY UPDATE
       code = VALUES(code),
       name = VALUES(name),
       grade = VALUES(grade),
       status = VALUES(status),
       updated_by = VALUES(updated_by)`,
    [
      ids.primaryCustomerId, TEST_TENANT_ID, `CUS-RG-A-${ids.suffix}`, primaryCustomerName, TEST_USER_ID, TEST_USER_ID,
      ids.secondaryCustomerId, TEST_TENANT_ID, `CUS-RG-B-${ids.suffix}`, secondaryCustomerName, TEST_USER_ID, TEST_USER_ID,
    ],
  );

  await pool.execute(
    `INSERT INTO sales_orders
       (id, tenant_id, order_no, customer_id, order_type, status, priority,
        expected_delivery, total_amount, constraint_passed, approval_status,
        sales_person_id, notes, created_by, updated_by)
     VALUES
       (?, ?, ?, ?, 'normal', 'shipped', 80, CURDATE(), 12800.00, 1, 'approved', ?, 'Playwright 结算 regression 草稿逾期', ?, ?),
       (?, ?, ?, ?, 'normal', 'shipped', 80, CURDATE(), 5200.00, 1, 'approved', ?, 'Playwright 结算 regression 已确认逾期', ?, ?),
       (?, ?, ?, ?, 'normal', 'shipped', 80, CURDATE(), 9600.00, 1, 'approved', ?, 'Playwright 结算 regression 未逾期', ?, ?)`,
    [
      ids.overdueDraftOrderId, TEST_TENANT_ID, `SO-RG-D-${ids.suffix}`, ids.primaryCustomerId, TEST_USER_ID, TEST_USER_ID, TEST_USER_ID,
      ids.overdueConfirmedOrderId, TEST_TENANT_ID, `SO-RG-C-${ids.suffix}`, ids.primaryCustomerId, TEST_USER_ID, TEST_USER_ID, TEST_USER_ID,
      ids.currentOrderId, TEST_TENANT_ID, `SO-RG-N-${ids.suffix}`, ids.secondaryCustomerId, TEST_USER_ID, TEST_USER_ID, TEST_USER_ID,
    ],
  );

  await pool.execute(
    `INSERT INTO settlements
       (id, tenant_id, settlement_no, customer_id, order_id, total_amount, status,
        due_date, notes, created_by, updated_by)
     VALUES
       (?, ?, ?, ?, ?, 12800.00, 'draft', DATE_SUB(CURDATE(), INTERVAL 7 DAY), 'Playwright regression 草稿逾期', ?, ?),
       (?, ?, ?, ?, ?, 5200.00, 'confirmed', DATE_SUB(CURDATE(), INTERVAL 2 DAY), 'Playwright regression 已确认逾期', ?, ?),
       (?, ?, ?, ?, ?, 9600.00, 'confirmed', DATE_ADD(CURDATE(), INTERVAL 9 DAY), 'Playwright regression 未逾期', ?, ?)`,
    [
      ids.overdueDraftSettlementId, TEST_TENANT_ID, overdueDraftSettlementNo, ids.primaryCustomerId, ids.overdueDraftOrderId, TEST_USER_ID, TEST_USER_ID,
      ids.overdueConfirmedSettlementId, TEST_TENANT_ID, overdueConfirmedSettlementNo, ids.primaryCustomerId, ids.overdueConfirmedOrderId, TEST_USER_ID, TEST_USER_ID,
      ids.currentSettlementId, TEST_TENANT_ID, currentSettlementNo, ids.secondaryCustomerId, ids.currentOrderId, TEST_USER_ID, TEST_USER_ID,
    ],
  );

  return {
    ...ids,
    primaryCustomerName,
    secondaryCustomerName,
    overdueDraftSettlementNo,
    overdueConfirmedSettlementNo,
    currentSettlementNo,
    primaryReceivableTotal: '18000.00',
    primaryPendingCount: 2,
  };
}

export async function cleanupSettlementRegressionScenario(
  scenario: SettlementRegressionScenario,
): Promise<void> {
  const pool = getDbPool();
  await pool.execute(
    'DELETE FROM settlements WHERE tenant_id = ? AND id IN (?, ?, ?)',
    [
      TEST_TENANT_ID,
      scenario.overdueDraftSettlementId,
      scenario.overdueConfirmedSettlementId,
      scenario.currentSettlementId,
    ],
  );
  await pool.execute(
    'DELETE FROM sales_orders WHERE tenant_id = ? AND id IN (?, ?, ?)',
    [
      TEST_TENANT_ID,
      scenario.overdueDraftOrderId,
      scenario.overdueConfirmedOrderId,
      scenario.currentOrderId,
    ],
  );
  await pool.execute(
    'DELETE FROM customers WHERE tenant_id = ? AND id IN (?, ?)',
    [TEST_TENANT_ID, scenario.primaryCustomerId, scenario.secondaryCustomerId],
  );
}

export async function fetchSettlementAgingSummarySnapshot(): Promise<SettlementAgingSummarySnapshot> {
  const pool = getDbPool();
  const [rows] = await pool.query<Array<{ overdueAmount: string; overdueCount: number }>>(
    `SELECT
       CAST(COALESCE(SUM(CASE
         WHEN status IN ('draft', 'confirmed')
          AND due_date IS NOT NULL
          AND DATE(due_date) < CURDATE()
         THEN total_amount
         ELSE 0
       END), 0) AS CHAR) AS overdueAmount,
       COALESCE(SUM(CASE
         WHEN status IN ('draft', 'confirmed')
          AND due_date IS NOT NULL
          AND DATE(due_date) < CURDATE()
         THEN 1
         ELSE 0
       END), 0) AS overdueCount
     FROM settlements
     WHERE tenant_id = ?`,
    [TEST_TENANT_ID],
  );

  return {
    overdueAmount: Number(rows[0]?.overdueAmount ?? 0).toFixed(2),
    overdueCount: Number(rows[0]?.overdueCount ?? 0),
  };
}

export async function waitForSettlementStatus(
  settlementId: number,
  expectedStatus: string,
  timeoutMs = 12_000,
): Promise<string> {
  return poll(async () => {
    const pool = getDbPool();
    const [rows] = await pool.query<SettlementRow[]>(
      `SELECT status
       FROM settlements
       WHERE tenant_id = ? AND id = ?
       LIMIT 1`,
      [TEST_TENANT_ID, settlementId],
    );
    const status = rows[0]?.status;
    return status === expectedStatus ? status : null;
  }, timeoutMs);
}
