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

interface DeliveryStatusRow extends RowDataPacket {
  id: number;
  delivery_no: string;
  tracking_no: string | null;
  status: string;
}

interface OrderStatusRow extends RowDataPacket {
  status: string;
}

export interface SalesOrderScenario {
  customerId: number;
  skuId: number;
  orderId: number;
  orderItemId: number;
  customerName: string;
  skuName: string;
  orderNo: string;
  trackingNo: string;
  existingTrackingNo?: string;
}

export interface SalesOrderSnapshot {
  orderStatus: string;
  deliveryStatus: string | null;
  deliveryNo: string | null;
  trackingNo: string | null;
  deliveryCount: number;
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
    customerId: Number(`93${suffix}`),
    skuId: Number(`94${suffix}`),
    orderId: Number(`95${suffix}`),
    orderItemId: Number(`96${suffix}`),
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
      throw new Error('Timed out while polling sales order flow data');
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

export async function closeSalesOrderFlowDbPool(): Promise<void> {
  if (dbPool) {
    await dbPool.end();
    dbPool = null;
  }
}

export async function seedSalesOrderScenario(): Promise<SalesOrderScenario> {
  const pool = getDbPool();
  const { customerId, skuId, orderId, orderItemId, suffix } = nextScenarioIds();
  const customerName = `Playwright销售客户-${suffix}`;
  const skuName = `Playwright成品-${suffix}`;
  const orderNo = `SO-PW-${suffix}`;
  const trackingNo = `PW-TRACK-${suffix}`;
  const expectedDelivery = new Date().toISOString().slice(0, 10);

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
       (id, tenant_id, code, name, status, grade, created_by, updated_by)
     VALUES (?, ?, ?, ?, 'active', 'A', ?, ?)
     ON DUPLICATE KEY UPDATE
       code = VALUES(code),
       name = VALUES(name),
       status = VALUES(status),
       grade = VALUES(grade),
       updated_by = VALUES(updated_by)`,
    [customerId, TEST_TENANT_ID, `CUS-PW-${suffix}`, customerName, TEST_USER_ID, TEST_USER_ID],
  );

  await pool.execute(
    `INSERT INTO skus
       (id, tenant_id, sku_code, name, category1_id, category2_id,
        stock_unit, purchase_unit, production_unit, has_dye_lot, use_fifo,
        safety_stock, status, created_by, updated_by)
     VALUES (?, ?, ?, ?, 1, 1, '件', '件', '件', 0, 1, 0, 'active', ?, ?)
     ON DUPLICATE KEY UPDATE
       sku_code = VALUES(sku_code),
       name = VALUES(name),
       stock_unit = VALUES(stock_unit),
       purchase_unit = VALUES(purchase_unit),
       production_unit = VALUES(production_unit),
       status = VALUES(status),
       updated_by = VALUES(updated_by)`,
    [skuId, TEST_TENANT_ID, `SKU-PW-${suffix}`, skuName, TEST_USER_ID, TEST_USER_ID],
  );

  await pool.execute(
    `INSERT INTO inventory
       (tenant_id, sku_id, qty_on_hand, qty_reserved, qty_in_transit, last_in_at)
     VALUES (?, ?, 10, 0, 0, NOW(3))
     ON DUPLICATE KEY UPDATE
       qty_on_hand = 10,
       qty_reserved = 0,
       qty_in_transit = 0,
       last_in_at = NOW(3)`,
    [TEST_TENANT_ID, skuId],
  );

  await pool.execute(
    `INSERT INTO sales_orders
       (id, tenant_id, order_no, customer_id, order_type, status, priority,
        expected_delivery, total_amount, constraint_passed, approval_status,
        sales_person_id, notes, created_by, updated_by)
     VALUES (?, ?, ?, ?, 'normal', 'in_production', 80, ?, 528.00, 1, 'approved',
             ?, 'Playwright 销售订单真实浏览器回归', ?, ?)`,
    [orderId, TEST_TENANT_ID, orderNo, customerId, expectedDelivery, TEST_USER_ID, TEST_USER_ID, TEST_USER_ID],
  );

  await pool.execute(
    `INSERT INTO sales_order_items
       (id, tenant_id, order_id, sku_id, qty_ordered, qty, qty_delivered,
        unit_price, amount, bom_header_id, created_by, updated_by)
     VALUES (?, ?, ?, ?, 6.0000, 6.0000, 0.0000, 88.0000, 528.00, 1, ?, ?)`,
    [orderItemId, TEST_TENANT_ID, orderId, skuId, TEST_USER_ID, TEST_USER_ID],
  );

  return {
    customerId,
    skuId,
    orderId,
    orderItemId,
    customerName,
    skuName,
    orderNo,
    trackingNo,
  };
}

export async function seedExistingDeliverySalesOrderScenario(): Promise<SalesOrderScenario> {
  const pool = getDbPool();
  const { customerId, skuId, orderId, orderItemId, suffix } = nextScenarioIds();
  const customerName = `Playwright销售客户-${suffix}`;
  const skuName = `Playwright成品-${suffix}`;
  const orderNo = `SO-PW-PART-${suffix}`;
  const trackingNo = `PW-TRACK-${suffix}`;
  const existingTrackingNo = `PW-OLD-${suffix}`;
  const expectedDelivery = new Date().toISOString().slice(0, 10);

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
       (id, tenant_id, code, name, status, grade, created_by, updated_by)
     VALUES (?, ?, ?, ?, 'active', 'A', ?, ?)
     ON DUPLICATE KEY UPDATE
       code = VALUES(code),
       name = VALUES(name),
       status = VALUES(status),
       grade = VALUES(grade),
       updated_by = VALUES(updated_by)`,
    [customerId, TEST_TENANT_ID, `CUS-PW-${suffix}`, customerName, TEST_USER_ID, TEST_USER_ID],
  );

  await pool.execute(
    `INSERT INTO skus
       (id, tenant_id, sku_code, name, category1_id, category2_id,
        stock_unit, purchase_unit, production_unit, has_dye_lot, use_fifo,
        safety_stock, status, created_by, updated_by)
     VALUES (?, ?, ?, ?, 1, 1, '件', '件', '件', 0, 1, 0, 'active', ?, ?)
     ON DUPLICATE KEY UPDATE
       sku_code = VALUES(sku_code),
       name = VALUES(name),
       stock_unit = VALUES(stock_unit),
       purchase_unit = VALUES(purchase_unit),
       production_unit = VALUES(production_unit),
       status = VALUES(status),
       updated_by = VALUES(updated_by)`,
    [skuId, TEST_TENANT_ID, `SKU-PW-${suffix}`, skuName, TEST_USER_ID, TEST_USER_ID],
  );

  await pool.execute(
    `INSERT INTO inventory
       (tenant_id, sku_id, qty_on_hand, qty_reserved, qty_in_transit, last_in_at)
     VALUES (?, ?, 10, 0, 0, NOW(3))
     ON DUPLICATE KEY UPDATE
       qty_on_hand = 10,
       qty_reserved = 0,
       qty_in_transit = 0,
       last_in_at = NOW(3)`,
    [TEST_TENANT_ID, skuId],
  );

  await pool.execute(
    `INSERT INTO sales_orders
       (id, tenant_id, order_no, customer_id, order_type, status, priority,
        expected_delivery, total_amount, constraint_passed, approval_status,
        sales_person_id, notes, created_by, updated_by)
     VALUES (?, ?, ?, ?, 'normal', 'in_production', 80, ?, 528.00, 1, 'approved',
             ?, 'Playwright 销售订单历史发货真实浏览器回归', ?, ?)`,
    [orderId, TEST_TENANT_ID, orderNo, customerId, expectedDelivery, TEST_USER_ID, TEST_USER_ID, TEST_USER_ID],
  );

  await pool.execute(
    `INSERT INTO sales_order_items
       (id, tenant_id, order_id, sku_id, qty_ordered, qty, qty_delivered,
        unit_price, amount, bom_header_id, created_by, updated_by)
     VALUES (?, ?, ?, ?, 6.0000, 6.0000, 2.0000, 88.0000, 528.00, 1, ?, ?)`,
    [orderItemId, TEST_TENANT_ID, orderId, skuId, TEST_USER_ID, TEST_USER_ID],
  );

  const [deliveryResult] = await pool.query<RowDataPacket[]>(
    `INSERT INTO sales_deliveries
       (tenant_id, order_id, delivery_no, tracking_no, status, shipped_at, created_by, updated_by)
     VALUES (?, ?, ?, ?, 'pending', NOW(3), ?, ?)`,
    [TEST_TENANT_ID, orderId, `DO-PW-${suffix}`, existingTrackingNo, TEST_USER_ID, TEST_USER_ID],
  );
  const deliveryId = Number((deliveryResult as unknown as { insertId?: number }).insertId ?? 0);

  if (deliveryId > 0) {
    await pool.execute(
      `INSERT INTO sales_delivery_items
         (tenant_id, delivery_id, order_item_id, shipped_qty, created_by)
       VALUES (?, ?, ?, 2.0000, ?)`,
      [TEST_TENANT_ID, deliveryId, orderItemId, TEST_USER_ID],
    );
  }

  return {
    customerId,
    skuId,
    orderId,
    orderItemId,
    customerName,
    skuName,
    orderNo,
    trackingNo,
    existingTrackingNo,
  };
}

export async function cleanupSalesOrderScenario(scenario: SalesOrderScenario): Promise<void> {
  const pool = getDbPool();

  await pool.execute(
    `DELETE sdi
     FROM sales_delivery_items sdi
     INNER JOIN sales_deliveries sd
       ON sd.tenant_id = sdi.tenant_id AND sd.id = sdi.delivery_id
     WHERE sd.tenant_id = ? AND sd.order_id = ?`,
    [TEST_TENANT_ID, scenario.orderId],
  );
  await pool.execute(
    'DELETE FROM sales_deliveries WHERE tenant_id = ? AND order_id = ?',
    [TEST_TENANT_ID, scenario.orderId],
  );
  await pool.execute(
    `DELETE FROM inventory_transactions
     WHERE tenant_id = ? AND sku_id = ? AND reference_type = 'sales_delivery'`,
    [TEST_TENANT_ID, scenario.skuId],
  );
  await pool.execute(
    'DELETE FROM audit_logs WHERE tenant_id = ? AND module = ? AND target_id = ?',
    [TEST_TENANT_ID, 'sales_order', scenario.orderId],
  );
  await pool.execute(
    'DELETE FROM sales_order_items WHERE tenant_id = ? AND order_id = ?',
    [TEST_TENANT_ID, scenario.orderId],
  );
  await pool.execute(
    'DELETE FROM sales_orders WHERE tenant_id = ? AND id = ?',
    [TEST_TENANT_ID, scenario.orderId],
  );
  await pool.execute(
    'DELETE FROM inventory WHERE tenant_id = ? AND sku_id = ?',
    [TEST_TENANT_ID, scenario.skuId],
  );
  await pool.execute(
    'DELETE FROM skus WHERE tenant_id = ? AND id = ?',
    [TEST_TENANT_ID, scenario.skuId],
  );
  await pool.execute(
    'DELETE FROM customers WHERE tenant_id = ? AND id = ?',
    [TEST_TENANT_ID, scenario.customerId],
  );
}

export async function getSalesOrderSnapshot(orderId: number): Promise<SalesOrderSnapshot | null> {
  const pool = getDbPool();
  const [orderRows] = await pool.query<OrderStatusRow[]>(
    `SELECT status
     FROM sales_orders
     WHERE tenant_id = ? AND id = ?
     LIMIT 1`,
    [TEST_TENANT_ID, orderId],
  );
  if (orderRows.length === 0) {
    return null;
  }

  const [deliveryRows] = await pool.query<DeliveryStatusRow[]>(
    `SELECT id, delivery_no, tracking_no, status
     FROM sales_deliveries
     WHERE tenant_id = ? AND order_id = ?
     ORDER BY id DESC
     LIMIT 10`,
    [TEST_TENANT_ID, orderId],
  );

  const latestDelivery = deliveryRows[0];
  return {
    orderStatus: orderRows[0].status,
    deliveryStatus: latestDelivery?.status ?? null,
    deliveryNo: latestDelivery?.delivery_no ?? null,
    trackingNo: latestDelivery?.tracking_no ?? null,
    deliveryCount: deliveryRows.length,
  };
}

export async function waitForSalesOrderSnapshot(
  orderId: number,
  predicate: (snapshot: SalesOrderSnapshot) => boolean,
  timeoutMs = 12_000,
): Promise<SalesOrderSnapshot> {
  return poll(async () => {
    const snapshot = await getSalesOrderSnapshot(orderId);
    return snapshot && predicate(snapshot) ? snapshot : null;
  }, timeoutMs);
}
