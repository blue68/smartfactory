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

interface InventoryQtyRow extends RowDataPacket {
  qty_on_hand: string;
}

interface InventoryCountRow extends RowDataPacket {
  total: number;
}

export interface InventoryScenario {
  skuId: number;
  skuCode: string;
  skuName: string;
  snapshotDate: string;
  initialTransactionNo: string;
  initialReferenceNo: string;
  initialNote: string;
  inboundNote: string;
}

export interface InventoryRegressionScenario {
  skuId: number;
  skuCode: string;
  skuName: string;
  snapshotDate: string;
  initialTransactionNo: string;
  initialReferenceNo: string;
  initialNote: string;
  outboundTransactionNo: string;
  outboundReferenceNo: string;
  outboundNote: string;
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
    skuId: Number(`84${suffix}`),
    txRefId: Number(`85${suffix}`),
    outRefId: Number(`86${suffix}`),
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
      throw new Error('Timed out while polling inventory flow data');
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

export async function closeInventoryFlowDbPool(): Promise<void> {
  if (dbPool) {
    const pool = dbPool;
    dbPool = null;
    await pool.end();
  }
}

export async function seedInventoryScenario(): Promise<InventoryScenario> {
  const pool = getDbPool();
  const { skuId, txRefId, suffix } = nextScenarioIds();
  const skuCode = `FAB-PW-${suffix}`;
  const skuName = `Playwright库存物料-${suffix}`;
  const snapshotDate = new Date().toISOString().slice(0, 10);
  const initialTransactionNo = `IT-PW-${suffix}`;
  const initialReferenceNo = `RCV-PW-${suffix}`;
  const initialNote = `Playwright 初始库存流水 ${suffix}`;
  const inboundNote = `Playwright 手动入库 ${suffix}`;

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
    `INSERT INTO skus
       (id, tenant_id, sku_code, name, category1_id, category2_id,
        stock_unit, purchase_unit, production_unit, has_dye_lot, use_fifo,
        safety_stock, status, created_by, updated_by)
     VALUES (?, ?, ?, ?, 1, 5, '平方米', '平方米', '平方米', 0, 1, 20, 'active', ?, ?)
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
    [skuId, TEST_TENANT_ID, skuCode, skuName, TEST_USER_ID, TEST_USER_ID],
  );

  await pool.execute(
    `INSERT INTO inventory
       (tenant_id, sku_id, qty_on_hand, qty_reserved, qty_in_transit, last_in_at)
     VALUES (?, ?, 12.0000, 2.0000, 0.0000, NOW(3))
     ON DUPLICATE KEY UPDATE
       qty_on_hand = 12.0000,
       qty_reserved = 2.0000,
       qty_in_transit = 0.0000,
       last_in_at = NOW(3)`,
    [TEST_TENANT_ID, skuId],
  );

  await pool.execute(
    `INSERT INTO inventory_transactions
       (tenant_id, transaction_no, sku_id, transaction_type, direction,
        qty_input, input_unit, qty_stock_unit, stock_unit,
        reference_type, reference_id, reference_no, notes, created_by)
     VALUES (?, ?, ?, 'PURCHASE_IN', 'IN', 12.0000, '平方米', 12.0000, '平方米',
             'purchase_receipt', ?, ?, ?, ?)`,
    [TEST_TENANT_ID, initialTransactionNo, skuId, txRefId, initialReferenceNo, initialNote, TEST_USER_ID],
  );

  await pool.execute(
    `INSERT INTO inventory_daily_snapshots
       (tenant_id, snapshot_date, sku_id, qty_on_hand, qty_reserved, qty_available)
     VALUES (?, ?, ?, 12.0000, 2.0000, 10.0000)
     ON DUPLICATE KEY UPDATE
       qty_on_hand = VALUES(qty_on_hand),
       qty_reserved = VALUES(qty_reserved),
       qty_available = VALUES(qty_available)`,
    [TEST_TENANT_ID, snapshotDate, skuId],
  );

  return {
    skuId,
    skuCode,
    skuName,
    snapshotDate,
    initialTransactionNo,
    initialReferenceNo,
    initialNote,
    inboundNote,
  };
}

export async function seedInventoryRegressionScenario(): Promise<InventoryRegressionScenario> {
  const pool = getDbPool();
  const { skuId, txRefId, outRefId, suffix } = nextScenarioIds();
  const skuCode = `FAB-RG-${suffix}`;
  const skuName = `Playwright库存回归物料-${suffix}`;
  const snapshotDate = new Date().toISOString().slice(0, 10);
  const initialTransactionNo = `IT-RG-IN-${suffix}`;
  const initialReferenceNo = `RCV-RG-${suffix}`;
  const initialNote = `Playwright 回归入库流水 ${suffix}`;
  const outboundTransactionNo = `IT-RG-OUT-${suffix}`;
  const outboundReferenceNo = `DEL-RG-${suffix}`;
  const outboundNote = `Playwright 回归出库流水 ${suffix}`;

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
    `INSERT INTO skus
       (id, tenant_id, sku_code, name, category1_id, category2_id,
        stock_unit, purchase_unit, production_unit, has_dye_lot, use_fifo,
        safety_stock, status, created_by, updated_by)
     VALUES (?, ?, ?, ?, 1, 5, '平方米', '平方米', '平方米', 0, 1, 20, 'active', ?, ?)
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
    [skuId, TEST_TENANT_ID, skuCode, skuName, TEST_USER_ID, TEST_USER_ID],
  );

  await pool.execute(
    `INSERT INTO inventory
       (tenant_id, sku_id, qty_on_hand, qty_reserved, qty_in_transit, last_in_at, last_out_at)
     VALUES (?, ?, 12.0000, 2.0000, 0.0000, NOW(3), NOW(3))
     ON DUPLICATE KEY UPDATE
       qty_on_hand = 12.0000,
       qty_reserved = 2.0000,
       qty_in_transit = 0.0000,
       last_in_at = NOW(3),
       last_out_at = NOW(3)`,
    [TEST_TENANT_ID, skuId],
  );

  await pool.execute(
    `INSERT INTO inventory_transactions
       (tenant_id, transaction_no, sku_id, transaction_type, direction,
        qty_input, input_unit, qty_stock_unit, stock_unit,
        reference_type, reference_id, reference_no, notes, created_at, created_by)
     VALUES
       (?, ?, ?, 'PURCHASE_IN', 'IN', 20.0000, '平方米', 20.0000, '平方米',
        'purchase_receipt', ?, ?, ?, DATE_SUB(NOW(3), INTERVAL 2 DAY), ?),
       (?, ?, ?, 'DELIVERY_OUT', 'OUT', 8.0000, '平方米', 8.0000, '平方米',
        'sales_delivery', ?, ?, ?, DATE_SUB(NOW(3), INTERVAL 1 DAY), ?)`,
    [
      TEST_TENANT_ID, initialTransactionNo, skuId, txRefId, initialReferenceNo, initialNote, TEST_USER_ID,
      TEST_TENANT_ID, outboundTransactionNo, skuId, outRefId, outboundReferenceNo, outboundNote, TEST_USER_ID,
    ],
  );

  await pool.execute(
    `INSERT INTO inventory_daily_snapshots
       (tenant_id, snapshot_date, sku_id, qty_on_hand, qty_reserved, qty_available)
     VALUES (?, ?, ?, 12.0000, 2.0000, 10.0000)
     ON DUPLICATE KEY UPDATE
       qty_on_hand = VALUES(qty_on_hand),
       qty_reserved = VALUES(qty_reserved),
       qty_available = VALUES(qty_available)`,
    [TEST_TENANT_ID, snapshotDate, skuId],
  );

  return {
    skuId,
    skuCode,
    skuName,
    snapshotDate,
    initialTransactionNo,
    initialReferenceNo,
    initialNote,
    outboundTransactionNo,
    outboundReferenceNo,
    outboundNote,
  };
}

export async function cleanupInventoryScenario(scenario: InventoryScenario): Promise<void> {
  const pool = getDbPool();

  await pool.execute(
    'DELETE FROM inventory_daily_snapshots WHERE tenant_id = ? AND sku_id = ?',
    [TEST_TENANT_ID, scenario.skuId],
  );
  await pool.execute(
    'DELETE FROM inventory_transactions WHERE tenant_id = ? AND sku_id = ?',
    [TEST_TENANT_ID, scenario.skuId],
  );
  await pool.execute(
    'DELETE FROM inventory_dye_lots WHERE tenant_id = ? AND sku_id = ?',
    [TEST_TENANT_ID, scenario.skuId],
  );
  await pool.execute(
    'DELETE FROM inventory WHERE tenant_id = ? AND sku_id = ?',
    [TEST_TENANT_ID, scenario.skuId],
  );
  await pool.execute(
    'DELETE FROM skus WHERE tenant_id = ? AND id = ?',
    [TEST_TENANT_ID, scenario.skuId],
  );
}

export async function waitForInventoryQtyOnHand(
  skuId: number,
  expectedQtyOnHand: string,
  timeoutMs = 12_000,
): Promise<string> {
  return poll(async () => {
    const pool = getDbPool();
    const [rows] = await pool.query<InventoryQtyRow[]>(
      `SELECT CAST(qty_on_hand AS CHAR) AS qty_on_hand
       FROM inventory
       WHERE tenant_id = ? AND sku_id = ?
       LIMIT 1`,
      [TEST_TENANT_ID, skuId],
    );
    const qty = rows[0]?.qty_on_hand;
    return qty === expectedQtyOnHand ? qty : null;
  }, timeoutMs);
}

export async function waitForInventoryTransactionCount(
  skuId: number,
  expectedCount: number,
  timeoutMs = 12_000,
): Promise<number> {
  return poll(async () => {
    const pool = getDbPool();
    const [rows] = await pool.query<InventoryCountRow[]>(
      `SELECT COUNT(*) AS total
       FROM inventory_transactions
       WHERE tenant_id = ? AND sku_id = ?`,
      [TEST_TENANT_ID, skuId],
    );
    const total = Number(rows[0]?.total ?? 0);
    return total >= expectedCount ? total : null;
  }, timeoutMs);
}
