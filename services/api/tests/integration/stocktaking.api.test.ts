import request from 'supertest';
import mysql, { Pool, RowDataPacket } from 'mysql2/promise';
import * as XLSX from 'xlsx';
import { authHeader } from '../helpers/testAuth';

const BASE_URL = process.env.TEST_API_URL ?? 'http://localhost:3000';
const TEST_TENANT_ID = 9999;

const STOCKTAKING_CATEGORY_ID = 995551;
const SKU_OVER_ID = 99555101;
const SKU_SHORT_ID = 99555102;

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

function binaryParser(
  res: NodeJS.ReadableStream & {
    setEncoding: (encoding: BufferEncoding) => void;
    on: (event: string, listener: (...args: any[]) => void) => void;
  },
  callback: (err: Error | null, body: Buffer) => void,
): void {
  res.setEncoding('binary');
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  res.on('end', () => {
    callback(null, Buffer.from(data, 'binary'));
  });
}

describe('库存盘点模块 API 集成测试', () => {
  let taskId = 0;

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
      `INSERT INTO skus
        (id, tenant_id, sku_code, name, category1_id, category2_id, stock_unit, purchase_unit, production_unit, has_dye_lot, use_fifo, safety_stock, status, created_by, updated_by)
       VALUES
        (?, ?, 'SKU-STOCKTAKE-OVER', '盘点集成溢余SKU', 1, ?, 'pcs', 'pcs', 'pcs', 0, 1, 0, 'active', 99001, 99001),
        (?, ?, 'SKU-STOCKTAKE-SHORT', '盘点集成亏损SKU', 1, ?, 'pcs', 'pcs', 'pcs', 0, 1, 0, 'active', 99001, 99001)
       ON DUPLICATE KEY UPDATE
         sku_code = VALUES(sku_code),
         name = VALUES(name),
         category2_id = VALUES(category2_id),
         stock_unit = VALUES(stock_unit),
         status = VALUES(status),
         updated_by = VALUES(updated_by)`,
      [
        SKU_OVER_ID, TEST_TENANT_ID, STOCKTAKING_CATEGORY_ID,
        SKU_SHORT_ID, TEST_TENANT_ID, STOCKTAKING_CATEGORY_ID,
      ],
    );

    await pool.execute(
      `INSERT INTO inventory
        (tenant_id, sku_id, qty_on_hand, qty_reserved, qty_in_transit)
       VALUES
        (?, ?, 10.0000, 1.0000, 0.0000),
        (?, ?, 5.0000, 0.0000, 0.0000)
       ON DUPLICATE KEY UPDATE
         qty_on_hand = VALUES(qty_on_hand),
         qty_reserved = VALUES(qty_reserved),
         qty_in_transit = VALUES(qty_in_transit)`,
      [
        TEST_TENANT_ID, SKU_OVER_ID,
        TEST_TENANT_ID, SKU_SHORT_ID,
      ],
    );

    await pool.execute(
      `DELETE si
       FROM stocktaking_items si
       INNER JOIN stocktaking_tasks st ON st.id = si.task_id
       WHERE si.tenant_id = ? AND st.scope = 'category' AND st.scope_value = ?`,
      [TEST_TENANT_ID, String(STOCKTAKING_CATEGORY_ID)],
    );
    await pool.execute(
      `DELETE FROM stocktaking_tasks
       WHERE tenant_id = ? AND scope = 'category' AND scope_value = ?`,
      [TEST_TENANT_ID, String(STOCKTAKING_CATEGORY_ID)],
    );
    await pool.execute(
      `DELETE FROM inventory_transactions
       WHERE tenant_id = ? AND reference_type = 'stocktaking_task' AND sku_id IN (?, ?)`,
      [TEST_TENANT_ID, SKU_OVER_ID, SKU_SHORT_ID],
    );
    await pool.execute(
      `DELETE FROM inventory_daily_snapshots
       WHERE tenant_id = ? AND sku_id IN (?, ?) AND snapshot_date = CURDATE()`,
      [TEST_TENANT_ID, SKU_OVER_ID, SKU_SHORT_ID],
    );
  });

  afterAll(async () => {
    await dbPool?.end();
    dbPool = null;
  });

  test('warehouse 可按 category 创建盘点任务并导出模板', async () => {
    const createRes = await request(BASE_URL)
      .post('/api/stocktaking')
      .set(authHeader('warehouse'))
      .send({
        scope: 'category',
        scopeValue: String(STOCKTAKING_CATEGORY_ID),
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.code).toBe(0);
    expect(createRes.body.data.scope).toBe('category');
    expect(createRes.body.data.scopeValue).toBe(String(STOCKTAKING_CATEGORY_ID));
    expect(createRes.body.data.totalItems).toBe(2);
    expect(createRes.body.data.status).toBe('draft');
    taskId = Number(createRes.body.data.id);
    expect(taskId).toBeGreaterThan(0);

    const exportRes = await request(BASE_URL)
      .post(`/api/stocktaking/${taskId}/export`)
      .set(authHeader('warehouse'))
      .buffer(true)
      .parse(binaryParser as any);

    expect(exportRes.status).toBe(200);
    const workbook = XLSX.read(exportRes.body, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0] ?? ''];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as Array<Array<unknown>>;
    expect(rows[0]).toEqual(['SKU编码', 'SKU名称', '单位', '系统数量', '实盘数量', '差异数量', '备注']);
    expect(rows.some((row) => row[0] === 'SKU-STOCKTAKE-OVER')).toBe(true);
    expect(rows.some((row) => row[0] === 'SKU-STOCKTAKE-SHORT')).toBe(true);
  });

  test('supervisor 可查询盘点任务列表与详情', async () => {
    const listRes = await request(BASE_URL)
      .get('/api/stocktaking?page=1&pageSize=20&status=draft')
      .set(authHeader('supervisor'));

    expect(listRes.status).toBe(200);
    expect(listRes.body.code).toBe(0);
    expect(listRes.body.data.list.some((item: any) => Number(item.id) === taskId)).toBe(true);

    const detailRes = await request(BASE_URL)
      .get(`/api/stocktaking/${taskId}`)
      .set(authHeader('supervisor'));

    expect(detailRes.status).toBe(200);
    expect(detailRes.body.code).toBe(0);
    expect(Number(detailRes.body.data.task.id)).toBe(taskId);
    expect(detailRes.body.data.items).toHaveLength(2);
    expect(detailRes.body.data.items).toMatchObject([
      expect.objectContaining({
        skuId: SKU_OVER_ID,
        skuCode: 'SKU-STOCKTAKE-OVER',
        systemQty: '10.0000',
      }),
      expect.objectContaining({
        skuId: SKU_SHORT_ID,
        skuCode: 'SKU-STOCKTAKE-SHORT',
        systemQty: '5.0000',
      }),
    ]);
  });

  test('warehouse 录入实盘后可查看差异分析，boss 可确认并回写库存', async () => {
    const updateRes = await request(BASE_URL)
      .put(`/api/stocktaking/${taskId}/items`)
      .set(authHeader('warehouse'))
      .send([
        { skuId: SKU_OVER_ID, actualQty: '12.0000', notes: '盘盈两件' },
        { skuId: SKU_SHORT_ID, actualQty: '3.0000', notes: '盘亏两件' },
      ]);

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.code).toBe(0);
    expect(updateRes.body.data.updatedCount).toBe(2);

    const diffRes = await request(BASE_URL)
      .get(`/api/stocktaking/${taskId}/diff`)
      .set(authHeader('warehouse'));

    expect(diffRes.status).toBe(200);
    expect(diffRes.body.code).toBe(0);
    expect(diffRes.body.data.totalItems).toBe(2);
    expect(diffRes.body.data.diffCount).toBe(2);
    expect(diffRes.body.data.diffRate).toBe('100.0%');
    expect(diffRes.body.data.diffItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          skuId: SKU_OVER_ID,
          actualQty: '12.0000',
          diffQty: '2.0000',
          diffType: 'over',
        }),
        expect.objectContaining({
          skuId: SKU_SHORT_ID,
          actualQty: '3.0000',
          diffQty: '-2.0000',
          diffType: 'short',
        }),
      ]),
    );

    const deniedRes = await request(BASE_URL)
      .post(`/api/stocktaking/${taskId}/confirm`)
      .set(authHeader('warehouse'));
    expect(deniedRes.status).toBe(403);
    expect(deniedRes.body.code).toBe(1003);

    const confirmRes = await request(BASE_URL)
      .post(`/api/stocktaking/${taskId}/confirm`)
      .set(authHeader('boss'));

    expect(confirmRes.status).toBe(200);
    expect(confirmRes.body.code).toBe(0);
    expect(confirmRes.body.data.confirmedAt).toBeTruthy();

    const pool = getDbPool();
    const [inventoryRowsRaw] = await pool.query<Array<RowDataPacket & { sku_id: number | string; qty_on_hand: string }>>(
      `SELECT sku_id, qty_on_hand
       FROM inventory
       WHERE tenant_id = ? AND sku_id IN (?, ?)
       ORDER BY sku_id`,
      [TEST_TENANT_ID, SKU_OVER_ID, SKU_SHORT_ID],
    );
    const inventoryRows = inventoryRowsRaw.map((row) => ({
      skuId: Number(row.sku_id),
      qtyOnHand: row.qty_on_hand,
    }));
    expect(inventoryRows).toEqual([
      { skuId: SKU_OVER_ID, qtyOnHand: '12.0000' },
      { skuId: SKU_SHORT_ID, qtyOnHand: '3.0000' },
    ]);

    const [snapshotRowsRaw] = await pool.query<Array<RowDataPacket & { sku_id: number | string; qty_on_hand: string; qty_available: string }>>(
      `SELECT sku_id, qty_on_hand, qty_available
       FROM inventory_daily_snapshots
       WHERE tenant_id = ? AND snapshot_date = CURDATE() AND sku_id IN (?, ?)
       ORDER BY sku_id`,
      [TEST_TENANT_ID, SKU_OVER_ID, SKU_SHORT_ID],
    );
    const snapshotRows = snapshotRowsRaw.map((row) => ({
      skuId: Number(row.sku_id),
      qtyOnHand: row.qty_on_hand,
      qtyAvailable: row.qty_available,
    }));
    expect(snapshotRows).toEqual([
      { skuId: SKU_OVER_ID, qtyOnHand: '12.0000', qtyAvailable: '11.0000' },
      { skuId: SKU_SHORT_ID, qtyOnHand: '3.0000', qtyAvailable: '3.0000' },
    ]);

    const [txRowsRaw] = await pool.query<Array<RowDataPacket & { sku_id: number | string; direction: string; qty_stock_unit: string }>>(
      `SELECT sku_id, direction, qty_stock_unit
       FROM inventory_transactions
       WHERE tenant_id = ? AND reference_type = 'stocktaking_task' AND reference_id = ?
       ORDER BY sku_id`,
      [TEST_TENANT_ID, taskId],
    );
    const txRows = txRowsRaw.map((row) => ({
      skuId: Number(row.sku_id),
      direction: row.direction,
      qty: row.qty_stock_unit,
    }));
    expect(txRows).toEqual([
      { skuId: SKU_OVER_ID, direction: 'IN', qty: '2.0000' },
      { skuId: SKU_SHORT_ID, direction: 'OUT', qty: '2.0000' },
    ]);
  });
});
