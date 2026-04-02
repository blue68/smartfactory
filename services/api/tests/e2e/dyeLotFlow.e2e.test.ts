import request from 'supertest';
import mysql, { Pool, RowDataPacket } from 'mysql2/promise';
import { authHeader } from '../helpers/testAuth';
import { genDyeLotNo } from '../helpers/testData';

const BASE_URL = process.env.TEST_API_URL ?? 'http://localhost:3000';

jest.setTimeout(60000);

const TEST_TENANT_ID = 9999;
const DYE_LOT_A = `${genDyeLotNo()}A`;
const DYE_LOT_B = `${genDyeLotNo()}B`;
let fabricSkuId = 0;
let productionOrderId = 0;
let skuCode = '';
let workOrderNo = '';

let dbPool: Pool | null = null;

interface DyeLotRow extends RowDataPacket {
  dyeLotNo: string;
  qtyOnHand: string;
}

interface BindingRow extends RowDataPacket {
  dye_lot_no: string;
}

interface TxCountRow extends RowDataPacket {
  total: string;
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

describe('E2E: 面料缸号全链路流程', () => {
  beforeAll(async () => {
    const pool = getDbPool();
    const nonce = Number(String(Date.now()).slice(-6));
    fabricSkuId = 900000 + nonce;
    productionOrderId = 910000 + nonce;
    skuCode = `SKU-E2E-DYE-${nonce}`;
    workOrderNo = `WO-E2E-DYE-${nonce}`;

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
      'DELETE FROM order_dye_lot_bindings WHERE tenant_id = ? AND production_order_id = ? AND sku_id = ?',
      [TEST_TENANT_ID, productionOrderId, fabricSkuId],
    );
    await pool.execute(
      'DELETE FROM inventory_transactions WHERE tenant_id = ? AND production_order_id = ? AND sku_id = ?',
      [TEST_TENANT_ID, productionOrderId, fabricSkuId],
    );
    await pool.execute(
      'DELETE FROM inventory_dye_lots WHERE tenant_id = ? AND sku_id = ?',
      [TEST_TENANT_ID, fabricSkuId],
    );
    await pool.execute(
      'DELETE FROM inventory_daily_snapshots WHERE tenant_id = ? AND sku_id = ?',
      [TEST_TENANT_ID, fabricSkuId],
    );
    await pool.execute(
      'DELETE FROM inventory WHERE tenant_id = ? AND sku_id = ?',
      [TEST_TENANT_ID, fabricSkuId],
    );
    await pool.execute(
      'DELETE FROM production_orders WHERE tenant_id = ? AND id = ?',
      [TEST_TENANT_ID, productionOrderId],
    );
    await pool.execute(
      'DELETE FROM skus WHERE tenant_id = ? AND id = ?',
      [TEST_TENANT_ID, fabricSkuId],
    );

    await pool.execute(
      `INSERT INTO skus
       (id, tenant_id, sku_code, name, category1_id, category2_id,
         stock_unit, purchase_unit, production_unit, has_dye_lot, use_fifo,
         safety_stock, status, created_by, updated_by)
       VALUES (?, ?, ?, 'E2E面料', 1, 1, '米', '米', '米', 1, 1, 0, 'active', 99001, 99001)
       ON DUPLICATE KEY UPDATE
         sku_code = VALUES(sku_code),
         name = VALUES(name),
         stock_unit = VALUES(stock_unit),
         purchase_unit = VALUES(purchase_unit),
         production_unit = VALUES(production_unit),
         has_dye_lot = VALUES(has_dye_lot),
         status = VALUES(status),
         updated_by = VALUES(updated_by)`,
      [fabricSkuId, TEST_TENANT_ID, skuCode],
    );

    await pool.execute(
       `INSERT INTO inventory
         (tenant_id, sku_id, qty_on_hand, qty_reserved, qty_in_transit, last_in_at)
       VALUES (?, ?, 0, 0, 0, NOW(3))`,
      [TEST_TENANT_ID, fabricSkuId],
    );

    await pool.execute(
       `INSERT INTO production_orders
         (id, tenant_id, work_order_no, sales_order_id, sku_id, bom_header_id, process_template_id,
          qty_planned, qty_completed, status, created_by, updated_by)
       VALUES (?, ?, ?, 1, ?, 1, 1, 10, 0, 'in_progress', 99001, 99001)
       ON DUPLICATE KEY UPDATE
         work_order_no = VALUES(work_order_no),
         sku_id = VALUES(sku_id),
         qty_planned = VALUES(qty_planned),
         qty_completed = VALUES(qty_completed),
         status = VALUES(status),
         updated_by = VALUES(updated_by)`,
      [productionOrderId, TEST_TENANT_ID, workOrderNo, fabricSkuId],
    );
  });

  afterAll(async () => {
    await dbPool?.end();
    dbPool = null;
  });

  test('Step 0: 确认面料 SKU 已开启缸号管理', async () => {
    const res = await request(BASE_URL)
      .get(`/api/skus/${fabricSkuId}`)
      .set(authHeader('boss'));

    expect(res.status).toBe(200);
    expect(res.body.code).toBe(0);
    expect([true, 1]).toContain(res.body.data?.hasDyeLot);
  });

  test('Step 1: 仓库录入第一批面料入库，缸号 DL-A，100 米', async () => {
    const res = await request(BASE_URL)
      .post('/api/inventory/inbound')
      .set(authHeader('warehouse'))
      .send({
        skuId: fabricSkuId,
        qtyInput: '100',
        inputUnit: '米',
        transactionType: 'PURCHASE_IN',
        dyeLotNo: DYE_LOT_A,
        notes: `E2E 入库 DL-A ${DYE_LOT_A}`,
      });

    expect(res.status).toBe(201);
    expect(res.body.code).toBe(0);
    expect(Number(res.body.data?.newQtyOnHand ?? 0)).toBeGreaterThanOrEqual(100);
  });

  test('Step 2: 仓库录入第二批面料入库，缸号 DL-B，50 米', async () => {
    const res = await request(BASE_URL)
      .post('/api/inventory/inbound')
      .set(authHeader('warehouse'))
      .send({
        skuId: fabricSkuId,
        qtyInput: '50',
        inputUnit: '米',
        transactionType: 'PURCHASE_IN',
        dyeLotNo: DYE_LOT_B,
        notes: `E2E 入库 DL-B ${DYE_LOT_B}`,
      });

    expect(res.status).toBe(201);
    expect(res.body.code).toBe(0);
  });

  test('Step 3: 缸号分批列表包含 DL-A 和 DL-B 两条记录', async () => {
    const res = await request(BASE_URL)
      .get(`/api/inventory/${fabricSkuId}/dye-lots`)
      .set(authHeader('warehouse'));

    expect(res.status).toBe(200);
    expect(res.body.code).toBe(0);

    const lots: DyeLotRow[] = res.body.data ?? [];
    const lotNos = lots.map((item) => item.dyeLotNo);
    expect(lotNos).toContain(DYE_LOT_A);
    expect(lotNos).toContain(DYE_LOT_B);

    const lotA = lots.find((item) => item.dyeLotNo === DYE_LOT_A);
    const lotB = lots.find((item) => item.dyeLotNo === DYE_LOT_B);
    expect(Number(lotA?.qtyOnHand ?? 0)).toBeGreaterThanOrEqual(100);
    expect(Number(lotB?.qtyOnHand ?? 0)).toBeGreaterThanOrEqual(50);
  });

  test('Step 4: FIFO 缸号推荐，DL-A（先入库）排在首位', async () => {
    const res = await request(BASE_URL)
      .get(`/api/inventory/${fabricSkuId}/fifo-dye-lot?qty=30`)
      .set(authHeader('warehouse'));

    expect(res.status).toBe(200);
    expect(res.body.code).toBe(0);
    const recommended: DyeLotRow[] = res.body.data ?? [];
    expect(recommended.length).toBeGreaterThan(0);
    expect(recommended[0].dyeLotNo).toBe(DYE_LOT_A);
  });

  test('Step 5: 第一次领料出库，指定缸号 DL-A → 成功绑定', async () => {
    const res = await request(BASE_URL)
      .post('/api/inventory/outbound')
      .set(authHeader('warehouse'))
      .send({
        skuId: fabricSkuId,
        qtyInput: '20',
        inputUnit: '米',
        transactionType: 'MATERIAL_OUT',
        dyeLotNo: DYE_LOT_A,
        productionOrderId,
      });

    expect(res.status).toBe(200);
    expect(res.body.code).toBe(0);
    expect(Number(res.body.data?.newQtyOnHand ?? 0)).toBeGreaterThanOrEqual(0);
  });

  test('Step 6: 第二次领料改用 DL-B → 无授权阻断，返回 code=4004', async () => {
    const res = await request(BASE_URL)
      .post('/api/inventory/outbound')
      .set(authHeader('warehouse'))
      .send({
        skuId: fabricSkuId,
        qtyInput: '10',
        inputUnit: '米',
        transactionType: 'MATERIAL_OUT',
        dyeLotNo: DYE_LOT_B,
        productionOrderId,
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe(4004);
    expect(String(res.body.message ?? '')).toMatch(/跨色号|授权/);
  });

  test('Step 7: 面料入库不带 dyeLotNo → code=4002', async () => {
    const res = await request(BASE_URL)
      .post('/api/inventory/inbound')
      .set(authHeader('warehouse'))
      .send({
        skuId: fabricSkuId,
        qtyInput: '10',
        inputUnit: '米',
        transactionType: 'PURCHASE_IN',
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe(4002);
  });

  test('Step 8: 阻断后仍保持首缸绑定，且不存在 DL-B 出库流水', async () => {
    const pool = getDbPool();

    const [bindingRows] = await pool.query<BindingRow[]>(
      `SELECT dye_lot_no
       FROM order_dye_lot_bindings
       WHERE tenant_id = ? AND production_order_id = ? AND sku_id = ?
       LIMIT 1`,
      [TEST_TENANT_ID, productionOrderId, fabricSkuId],
    );
    expect(bindingRows).toHaveLength(1);
    expect(bindingRows[0].dye_lot_no).toBe(DYE_LOT_A);

    const [txRows] = await pool.query<TxCountRow[]>(
      `SELECT COUNT(*) AS total
       FROM inventory_transactions
       WHERE tenant_id = ?
         AND production_order_id = ?
         AND sku_id = ?
         AND direction = 'OUT'
         AND transaction_type = 'MATERIAL_OUT'
         AND dye_lot_no = ?`,
      [TEST_TENANT_ID, productionOrderId, fabricSkuId, DYE_LOT_B],
    );
    expect(Number(txRows[0]?.total ?? 0)).toBe(0);
  });
});
