import mysql, { type Pool, type RowDataPacket } from '../../services/api/node_modules/mysql2/promise';
import { APP_BASE_URL, seedAuth } from './purchaseFlow';

export { APP_BASE_URL, seedAuth };

const TEST_TENANT_ID = 9999;
const DB_HOST = process.env.DB_HOST ?? '127.0.0.1';
const DB_PORT = Number(process.env.DB_PORT ?? '3307');
const DB_USER = process.env.DB_USER ?? 'sf_app';
const DB_PASS = process.env.DB_PASS ?? process.env.DB_PASSWORD ?? 'TestApp2026!Secure';
const DB_NAME = process.env.DB_NAME ?? 'smart_factory';
const TEST_BOSS_ID = 99001;
const TEST_WAREHOUSE_ID = 99003;

let dbPool: Pool | null = null;

export interface StocktakingCreateScenario {
  skuId: number;
  skuCode: string;
  skuName: string;
  systemQty: string;
}

export interface StocktakingTaskSnapshot {
  taskId: number;
  taskNo: string;
  status: string;
  totalItems: number;
  diffItems: number;
}

export interface StocktakingConfirmScenario extends StocktakingCreateScenario {
  taskId: number;
  taskNo: string;
  actualQty: string;
  diffQty: string;
  expectedQtyOnHand: string;
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
    skuId: Number(`87${suffix}`),
    taskId: Number(`88${suffix}`),
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
      throw new Error('Timed out while polling stocktaking flow data');
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

async function ensureTenantAndSku(
  skuId: number,
  skuCode: string,
  skuName: string,
  qtyOnHand: string,
): Promise<void> {
  const pool = getDbPool();

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
     VALUES (?, ?, ?, ?, 1, 9, 'pcs', 'pcs', 'pcs', 0, 1, 0, 'active', ?, ?)
     ON DUPLICATE KEY UPDATE
       sku_code = VALUES(sku_code),
       name = VALUES(name),
       stock_unit = VALUES(stock_unit),
       purchase_unit = VALUES(purchase_unit),
       production_unit = VALUES(production_unit),
       status = VALUES(status),
       updated_by = VALUES(updated_by)`,
    [skuId, TEST_TENANT_ID, skuCode, skuName, TEST_BOSS_ID, TEST_BOSS_ID],
  );

  await pool.execute(
    `INSERT INTO inventory
       (tenant_id, sku_id, qty_on_hand, qty_reserved, qty_in_transit, last_in_at)
     VALUES (?, ?, ?, 0.0000, 0.0000, NOW(3))
     ON DUPLICATE KEY UPDATE
       qty_on_hand = VALUES(qty_on_hand),
       qty_reserved = 0.0000,
       qty_in_transit = 0.0000,
       last_in_at = NOW(3)`,
    [TEST_TENANT_ID, skuId, qtyOnHand],
  );
}

export async function closeStocktakingFlowDbPool(): Promise<void> {
  if (dbPool) {
    const pool = dbPool;
    dbPool = null;
    await pool.end();
  }
}

export async function seedStocktakingCreateScenario(): Promise<StocktakingCreateScenario> {
  const { skuId, suffix } = nextScenarioIds();
  const skuCode = `STK-PW-${suffix}`;
  const skuName = `Playwright盘点物料-${suffix}`;
  const systemQty = '9.0000';

  await ensureTenantAndSku(skuId, skuCode, skuName, systemQty);

  return { skuId, skuCode, skuName, systemQty };
}

export async function seedStocktakingConfirmScenario(): Promise<StocktakingConfirmScenario> {
  const pool = getDbPool();
  const { skuId, taskId, suffix } = nextScenarioIds();
  const skuCode = `STK-CF-${suffix}`;
  const skuName = `Playwright待确认盘点-${suffix}`;
  const systemQty = '10.0000';
  const actualQty = '13.0000';
  const diffQty = '3.0000';
  const expectedQtyOnHand = '13.0000';
  const taskNo = `PD-PW-${suffix}`;

  await ensureTenantAndSku(skuId, skuCode, skuName, systemQty);

  await pool.execute(
    `DELETE FROM stocktaking_items WHERE tenant_id = ? AND task_id = ?`,
    [TEST_TENANT_ID, taskId],
  );
  await pool.execute(
    `DELETE FROM stocktaking_tasks WHERE tenant_id = ? AND id = ?`,
    [TEST_TENANT_ID, taskId],
  );

  await pool.execute(
    `INSERT INTO stocktaking_tasks
       (id, tenant_id, task_no, scope, scope_value, status, total_items, diff_items, created_by)
     VALUES (?, ?, ?, 'all', NULL, 'in_progress', 1, 0, ?)`,
    [taskId, TEST_TENANT_ID, taskNo, TEST_WAREHOUSE_ID],
  );

  await pool.execute(
    `INSERT INTO stocktaking_items
       (tenant_id, task_id, sku_id, system_qty, actual_qty, notes)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [TEST_TENANT_ID, taskId, skuId, systemQty, actualQty, 'Playwright 盘点盘盈 3 件'],
  );

  return {
    skuId,
    skuCode,
    skuName,
    systemQty,
    taskId,
    taskNo,
    actualQty,
    diffQty,
    expectedQtyOnHand,
  };
}

export async function waitForStocktakingTaskCreated(
  scenario: StocktakingCreateScenario,
): Promise<StocktakingTaskSnapshot> {
  const pool = getDbPool();

  return poll(async () => {
    const [rows] = await pool.query<Array<RowDataPacket & {
      task_id: number;
      task_no: string;
      status: string;
      total_items: number;
      diff_items: number;
    }>>(
      `SELECT
         st.id AS task_id,
         st.task_no,
         st.status,
         st.total_items,
         st.diff_items
       FROM stocktaking_tasks st
       INNER JOIN stocktaking_items si
         ON si.task_id = st.id
        AND si.tenant_id = st.tenant_id
       WHERE st.tenant_id = ? AND si.sku_id = ?
       ORDER BY st.id DESC
       LIMIT 1`,
      [TEST_TENANT_ID, scenario.skuId],
    );

    const row = rows[0];
    if (!row) return null;

    return {
      taskId: Number(row.task_id),
      taskNo: String(row.task_no),
      status: String(row.status),
      totalItems: Number(row.total_items),
      diffItems: Number(row.diff_items),
    };
  });
}

export async function waitForStocktakingConfirmed(
  scenario: StocktakingConfirmScenario,
): Promise<{
  taskStatus: string;
  diffItems: number;
  confirmedBy: number | null;
  inventoryQtyOnHand: string;
  snapshotQtyOnHand: string;
  snapshotQtyAvailable: string;
  transactionDirection: string;
  transactionQty: string;
}> {
  const pool = getDbPool();

  return poll(async () => {
    const [taskRows] = await pool.query<Array<RowDataPacket & {
      status: string;
      diff_items: number;
      confirmed_by: number | null;
    }>>(
      `SELECT status, diff_items, confirmed_by
       FROM stocktaking_tasks
       WHERE tenant_id = ? AND id = ?
       LIMIT 1`,
      [TEST_TENANT_ID, scenario.taskId],
    );
    const [inventoryRows] = await pool.query<Array<RowDataPacket & {
      qty_on_hand: string;
    }>>(
      `SELECT qty_on_hand
       FROM inventory
       WHERE tenant_id = ? AND sku_id = ?
       LIMIT 1`,
      [TEST_TENANT_ID, scenario.skuId],
    );
    const [snapshotRows] = await pool.query<Array<RowDataPacket & {
      qty_on_hand: string;
      qty_available: string;
    }>>(
      `SELECT qty_on_hand, qty_available
       FROM inventory_daily_snapshots
       WHERE tenant_id = ? AND sku_id = ? AND snapshot_date = CURDATE()
       LIMIT 1`,
      [TEST_TENANT_ID, scenario.skuId],
    );
    const [txRows] = await pool.query<Array<RowDataPacket & {
      direction: string;
      qty_stock_unit: string;
    }>>(
      `SELECT direction, qty_stock_unit
       FROM inventory_transactions
       WHERE tenant_id = ? AND reference_type = 'stocktaking_task' AND reference_id = ? AND sku_id = ?
       ORDER BY id DESC
       LIMIT 1`,
      [TEST_TENANT_ID, scenario.taskId, scenario.skuId],
    );

    const task = taskRows[0];
    const inventory = inventoryRows[0];
    const snapshot = snapshotRows[0];
    const tx = txRows[0];
    if (!task || !inventory || !snapshot || !tx || task.status !== 'confirmed') {
      return null;
    }

    return {
      taskStatus: String(task.status),
      diffItems: Number(task.diff_items),
      confirmedBy: task.confirmed_by === null ? null : Number(task.confirmed_by),
      inventoryQtyOnHand: String(inventory.qty_on_hand),
      snapshotQtyOnHand: String(snapshot.qty_on_hand),
      snapshotQtyAvailable: String(snapshot.qty_available),
      transactionDirection: String(tx.direction),
      transactionQty: String(tx.qty_stock_unit),
    };
  });
}

export async function cleanupStocktakingScenario(
  scenario: StocktakingCreateScenario,
): Promise<void> {
  const pool = getDbPool();

  const [taskRows] = await pool.query<Array<RowDataPacket & { task_id: number }>>(
    `SELECT DISTINCT si.task_id
     FROM stocktaking_items si
     WHERE si.tenant_id = ? AND si.sku_id = ?`,
    [TEST_TENANT_ID, scenario.skuId],
  );
  const taskIds = taskRows.map((row) => Number(row.task_id));

  if (taskIds.length > 0) {
    const placeholders = taskIds.map(() => '?').join(',');
    await pool.execute(
      `DELETE FROM inventory_transactions
       WHERE tenant_id = ? AND reference_type = 'stocktaking_task' AND reference_id IN (${placeholders})`,
      [TEST_TENANT_ID, ...taskIds],
    );
    await pool.execute(
      `DELETE FROM stocktaking_items
       WHERE tenant_id = ? AND task_id IN (${placeholders})`,
      [TEST_TENANT_ID, ...taskIds],
    );
    await pool.execute(
      `DELETE FROM stocktaking_tasks
       WHERE tenant_id = ? AND id IN (${placeholders})`,
      [TEST_TENANT_ID, ...taskIds],
    );
  }

  await pool.execute(
    `DELETE FROM inventory_daily_snapshots
     WHERE tenant_id = ? AND sku_id = ?`,
    [TEST_TENANT_ID, scenario.skuId],
  );
  await pool.execute(
    `DELETE FROM inventory
     WHERE tenant_id = ? AND sku_id = ?`,
    [TEST_TENANT_ID, scenario.skuId],
  );
  await pool.execute(
    `DELETE FROM skus
     WHERE tenant_id = ? AND id = ?`,
    [TEST_TENANT_ID, scenario.skuId],
  );
}
