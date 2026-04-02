import request from 'supertest';
import mysql, { Pool, RowDataPacket } from 'mysql2/promise';
import { authHeader } from '../helpers/testAuth';

const BASE_URL = process.env.TEST_API_URL ?? 'http://localhost';

jest.setTimeout(60000);

const TEST_TENANT_ID = 9999;
const SEEDED_SKU_ID = 990933;
const SEEDED_PRODUCTION_ORDER_ID = 990934;
const SEEDED_PURCHASE_ORDER_ID = 990935;
const SEEDED_PURCHASE_ORDER_ITEM_ID = 990936;
const SNAPSHOT_DATE = new Date().toISOString().slice(0, 10);

let dbPool: Pool | null = null;

interface InventoryRow extends RowDataPacket {
  qty_on_hand: string;
  qty_reserved: string;
  qty_in_transit: string;
}

interface SnapshotRow extends RowDataPacket {
  qty_on_hand: string;
  qty_reserved: string;
  qty_available: string;
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

describe('E2E: inventory/repair 跨入口库存补偿', () => {
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
      'DELETE FROM material_requirements WHERE tenant_id = ? AND production_order_id = ?',
      [TEST_TENANT_ID, SEEDED_PRODUCTION_ORDER_ID],
    );
    await pool.execute(
      'DELETE FROM production_orders WHERE tenant_id = ? AND id = ?',
      [TEST_TENANT_ID, SEEDED_PRODUCTION_ORDER_ID],
    );
    await pool.execute(
      'DELETE FROM purchase_order_items WHERE tenant_id = ? AND po_id = ?',
      [TEST_TENANT_ID, SEEDED_PURCHASE_ORDER_ID],
    );
    await pool.execute(
      'DELETE FROM purchase_orders WHERE tenant_id = ? AND id = ?',
      [TEST_TENANT_ID, SEEDED_PURCHASE_ORDER_ID],
    );
    await pool.execute(
      'DELETE FROM inventory_daily_snapshots WHERE tenant_id = ? AND sku_id = ?',
      [TEST_TENANT_ID, SEEDED_SKU_ID],
    );
    await pool.execute(
      'DELETE FROM inventory_transactions WHERE tenant_id = ? AND sku_id = ?',
      [TEST_TENANT_ID, SEEDED_SKU_ID],
    );
    await pool.execute(
      'DELETE FROM inventory WHERE tenant_id = ? AND sku_id = ?',
      [TEST_TENANT_ID, SEEDED_SKU_ID],
    );
    await pool.execute(
      'DELETE FROM skus WHERE tenant_id = ? AND id = ?',
      [TEST_TENANT_ID, SEEDED_SKU_ID],
    );

    await pool.execute(
      `INSERT INTO skus
         (id, tenant_id, sku_code, name, category1_id, category2_id,
          stock_unit, purchase_unit, production_unit, has_dye_lot, use_fifo,
          safety_stock, status, created_by, updated_by)
       VALUES (?, ?, 'SKU-E2E-INV-REPAIR', 'E2E库存修复物料', 1, 1, 'pcs', 'pcs', 'pcs', 0, 1, 0, 'active', 99001, 99001)`,
      [SEEDED_SKU_ID, TEST_TENANT_ID],
    );

    await pool.execute(
      `INSERT INTO inventory
         (tenant_id, sku_id, qty_on_hand, qty_reserved, qty_in_transit, last_in_at)
       VALUES (?, ?, 30, 0, 0, NOW(3))`,
      [TEST_TENANT_ID, SEEDED_SKU_ID],
    );

    await pool.execute(
      `INSERT INTO inventory_transactions
         (tenant_id, transaction_no, sku_id, transaction_type, direction,
          qty_input, input_unit, qty_stock_unit, stock_unit, reference_type, reference_id, created_by)
       VALUES
         (?, 'ITX-E2E-INV-REPAIR-IN', ?, 'ADJUSTMENT_IN', 'IN', 10, 'pcs', 10, 'pcs', 'e2e_inventory_repair', 1, 99001),
         (?, 'ITX-E2E-INV-REPAIR-OUT', ?, 'ADJUSTMENT_OUT', 'OUT', 3, 'pcs', 3, 'pcs', 'e2e_inventory_repair', 2, 99001)`,
      [TEST_TENANT_ID, SEEDED_SKU_ID, TEST_TENANT_ID, SEEDED_SKU_ID],
    );

    await pool.execute(
      `INSERT INTO production_orders
         (id, tenant_id, work_order_no, sales_order_id, sku_id, bom_header_id, process_template_id,
          qty_planned, qty_completed, status, created_by, updated_by)
       VALUES (?, ?, 'WO-E2E-INV-REPAIR', 1, ?, 1, 1, 1, 0, 'in_progress', 99001, 99001)`,
      [SEEDED_PRODUCTION_ORDER_ID, TEST_TENANT_ID, SEEDED_SKU_ID],
    );

    await pool.execute(
      `INSERT INTO material_requirements
         (tenant_id, production_order_id, bom_snapshot_id, sku_id, qty_required, qty_reserved, qty_shortage, status)
       VALUES (?, ?, 1, ?, 2, 2, 0, 'fulfilled')`,
      [TEST_TENANT_ID, SEEDED_PRODUCTION_ORDER_ID, SEEDED_SKU_ID],
    );

    await pool.execute(
      `INSERT INTO purchase_orders
         (id, tenant_id, po_no, supplier_id, status, total_amount, created_by, updated_by)
       VALUES (?, ?, 'PO-E2E-INV-REPAIR', 1, 'confirmed', 12.00, 99001, 99001)`,
      [SEEDED_PURCHASE_ORDER_ID, TEST_TENANT_ID],
    );

    await pool.execute(
      `INSERT INTO purchase_order_items
         (id, tenant_id, po_id, sku_id, qty_ordered, qty_received, purchase_unit, unit_price, amount, created_by, updated_by)
       VALUES (?, ?, ?, ?, 12, 4, 'pcs', 1, 12.00, 99001, 99001)`,
      [SEEDED_PURCHASE_ORDER_ITEM_ID, TEST_TENANT_ID, SEEDED_PURCHASE_ORDER_ID, SEEDED_SKU_ID],
    );

    await pool.execute(
      `INSERT INTO inventory_daily_snapshots
         (tenant_id, snapshot_date, sku_id, qty_on_hand, qty_reserved, qty_available)
       VALUES (?, ?, ?, 30, 0, 30)
       ON DUPLICATE KEY UPDATE
         qty_on_hand = VALUES(qty_on_hand),
         qty_reserved = VALUES(qty_reserved),
         qty_available = VALUES(qty_available)`,
      [TEST_TENANT_ID, SNAPSHOT_DATE, SEEDED_SKU_ID],
    );
  });

  afterAll(async () => {
    await dbPool?.end();
    dbPool = null;
  });

  test('Step 0: 预热缓存并确认初始漂移库存', async () => {
    const rebuildRes = await request(BASE_URL)
      .post('/api/inventory/snapshots/rebuild')
      .set(authHeader('supervisor'))
      .send({
        skuId: SEEDED_SKU_ID,
        snapshotDate: SNAPSHOT_DATE,
        dryRun: false,
      });
    expect(rebuildRes.status).toBe(200);

    const res = await request(BASE_URL)
      .get(`/api/inventory/${SEEDED_SKU_ID}/available`)
      .set(authHeader('warehouse'));

    expect(res.status).toBe(200);
    expect(res.body.data?.qtyOnHand).toBe('30.0000');
    expect(res.body.data?.qtyReserved).toBe('0.0000');
    expect(res.body.data?.qtyAvailable).toBe('30.0000');
  });

  test('Step 1: dryRun 预览库存修复差异，不改变当前库存', async () => {
    const previewRes = await request(BASE_URL)
      .post('/api/inventory/repair')
      .set(authHeader('supervisor'))
      .send({
        skuId: SEEDED_SKU_ID,
        dryRun: true,
      });

    expect(previewRes.status).toBe(200);
    expect(previewRes.body.data?.dryRun).toBe(true);
    expect(previewRes.body.data?.reconcile?.changedCount).toBe(1);
    expect(previewRes.body.data?.reconcile?.items?.[0]?.expectedQtyOnHand).toBe('7.0000');
    expect(previewRes.body.data?.reconcile?.items?.[0]?.expectedQtyReserved).toBe('2.0000');
    expect(previewRes.body.data?.reconcile?.items?.[0]?.expectedQtyInTransit).toBe('8.0000');

    const stockRes = await request(BASE_URL)
      .get(`/api/inventory/${SEEDED_SKU_ID}/available`)
      .set(authHeader('warehouse'));

    expect(stockRes.status).toBe(200);
    expect(stockRes.body.data?.qtyOnHand).toBe('30.0000');
    expect(stockRes.body.data?.qtyAvailable).toBe('30.0000');
  });

  test('Step 2: 执行 repair，回写库存与日结快照', async () => {
    const repairRes = await request(BASE_URL)
      .post('/api/inventory/repair')
      .set(authHeader('supervisor'))
      .send({
        skuId: SEEDED_SKU_ID,
        snapshotDate: SNAPSHOT_DATE,
        dryRun: false,
      });

    expect(repairRes.status).toBe(200);
    expect(repairRes.body.data?.dryRun).toBe(false);
    expect(repairRes.body.data?.reconcile?.changedCount).toBe(1);
    expect(repairRes.body.data?.reconcile?.items?.[0]?.expectedQtyOnHand).toBe('7.0000');
    expect(repairRes.body.data?.reconcile?.items?.[0]?.expectedQtyReserved).toBe('2.0000');
    expect(repairRes.body.data?.reconcile?.items?.[0]?.expectedQtyInTransit).toBe('8.0000');
    expect(Number(repairRes.body.data?.snapshots?.rebuiltCount ?? 0)).toBeGreaterThanOrEqual(1);
  });

  test('Step 3: 验证修复后库存、快照与可用库存读取一致', async () => {
    const pool = getDbPool();

    const [inventoryRows] = await pool.query<InventoryRow[]>(
      `SELECT qty_on_hand, qty_reserved, qty_in_transit
       FROM inventory
       WHERE tenant_id = ? AND sku_id = ?
       LIMIT 1`,
      [TEST_TENANT_ID, SEEDED_SKU_ID],
    );
    expect(inventoryRows).toHaveLength(1);
    expect(Number(inventoryRows[0].qty_on_hand)).toBeCloseTo(7);
    expect(Number(inventoryRows[0].qty_reserved)).toBeCloseTo(2);
    expect(Number(inventoryRows[0].qty_in_transit)).toBeCloseTo(8);

    const [snapshotRows] = await pool.query<SnapshotRow[]>(
      `SELECT qty_on_hand, qty_reserved, qty_available
       FROM inventory_daily_snapshots
       WHERE tenant_id = ? AND sku_id = ? AND snapshot_date = ?
       LIMIT 1`,
      [TEST_TENANT_ID, SEEDED_SKU_ID, SNAPSHOT_DATE],
    );
    expect(snapshotRows).toHaveLength(1);
    expect(Number(snapshotRows[0].qty_on_hand)).toBeCloseTo(7);
    expect(Number(snapshotRows[0].qty_reserved)).toBeCloseTo(2);
    expect(Number(snapshotRows[0].qty_available)).toBeCloseTo(5);

    const stockRes = await request(BASE_URL)
      .get(`/api/inventory/${SEEDED_SKU_ID}/available`)
      .set(authHeader('warehouse'));

    expect(stockRes.status).toBe(200);
    expect(stockRes.body.data?.qtyOnHand).toBe('7.0000');
    expect(stockRes.body.data?.qtyReserved).toBe('2.0000');
    expect(stockRes.body.data?.qtyAvailable).toBe('5.0000');
  });

  test('Step 4: 主库存行缺失时，repair 仍可按账本/预留/在途重建库存与快照', async () => {
    const pool = getDbPool();

    // 模拟异常：主库存行与当日快照被误删，但账本、预留、在途仍保留
    await pool.execute(
      'DELETE FROM inventory_daily_snapshots WHERE tenant_id = ? AND sku_id = ? AND snapshot_date = ?',
      [TEST_TENANT_ID, SEEDED_SKU_ID, SNAPSHOT_DATE],
    );
    await pool.execute(
      'DELETE FROM inventory WHERE tenant_id = ? AND sku_id = ?',
      [TEST_TENANT_ID, SEEDED_SKU_ID],
    );

    const repairRes = await request(BASE_URL)
      .post('/api/inventory/repair')
      .set(authHeader('supervisor'))
      .send({
        skuId: SEEDED_SKU_ID,
        snapshotDate: SNAPSHOT_DATE,
        dryRun: false,
      });

    expect(repairRes.status).toBe(200);
    expect(repairRes.body.data?.dryRun).toBe(false);
    expect(repairRes.body.data?.reconcile?.changedCount).toBe(1);
    expect(Number(repairRes.body.data?.snapshots?.rebuiltCount ?? 0)).toBeGreaterThanOrEqual(1);

    const [inventoryRows] = await pool.query<InventoryRow[]>(
      `SELECT qty_on_hand, qty_reserved, qty_in_transit
       FROM inventory
       WHERE tenant_id = ? AND sku_id = ?
       LIMIT 1`,
      [TEST_TENANT_ID, SEEDED_SKU_ID],
    );
    expect(inventoryRows).toHaveLength(1);
    expect(Number(inventoryRows[0].qty_on_hand)).toBeCloseTo(7);
    expect(Number(inventoryRows[0].qty_reserved)).toBeCloseTo(2);
    expect(Number(inventoryRows[0].qty_in_transit)).toBeCloseTo(8);

    const [snapshotRows] = await pool.query<SnapshotRow[]>(
      `SELECT qty_on_hand, qty_reserved, qty_available
       FROM inventory_daily_snapshots
       WHERE tenant_id = ? AND sku_id = ? AND snapshot_date = ?
       LIMIT 1`,
      [TEST_TENANT_ID, SEEDED_SKU_ID, SNAPSHOT_DATE],
    );
    expect(snapshotRows).toHaveLength(1);
    expect(Number(snapshotRows[0].qty_on_hand)).toBeCloseTo(7);
    expect(Number(snapshotRows[0].qty_reserved)).toBeCloseTo(2);
    expect(Number(snapshotRows[0].qty_available)).toBeCloseTo(5);

    const stockRes = await request(BASE_URL)
      .get(`/api/inventory/${SEEDED_SKU_ID}/available`)
      .set(authHeader('warehouse'));

    expect(stockRes.status).toBe(200);
    expect(stockRes.body.data?.qtyOnHand).toBe('7.0000');
    expect(stockRes.body.data?.qtyReserved).toBe('2.0000');
    expect(stockRes.body.data?.qtyAvailable).toBe('5.0000');
  });
});
