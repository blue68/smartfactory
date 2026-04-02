import request from 'supertest';
import mysql, { Pool, RowDataPacket } from 'mysql2/promise';
import { authHeader } from '../helpers/testAuth';

const BASE_URL = process.env.TEST_API_URL ?? 'http://localhost:3000';
const TEST_TENANT_ID = 9999;

const SUPPLIER_ID = 996101;
const SKU_ID = 996201;
const PO_ID = 996301;
const PO_ITEM_ID = 996302;
const DELIVERY_NOTE_ID = 996401;
const DELIVERY_NOTE_ITEM_ID = 996402;

const INSPECTION_DATE = '2026-06-11';
const UNIT_PRICE = '88.0000';

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

async function getPurchaseReceiptDeliveryColumn(pool: Pool): Promise<'delivery_note_id' | 'dn_id'> {
  const [rows] = await pool.query<Array<RowDataPacket & { column_name: string }>>(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'purchase_receipts'
        AND column_name IN ('delivery_note_id', 'dn_id')`,
  );
  const columns = new Set(rows.map((row) => String(row.column_name)));
  return columns.has('delivery_note_id') ? 'delivery_note_id' : 'dn_id';
}

describe('来料质检模块 API 集成测试', () => {
  let inspectionId = 0;
  let inspectionItemId = 0;

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
      `INSERT INTO users
        (id, tenant_id, username, password_hash, real_name, status, created_by, updated_by)
       VALUES
        (99001, ?, 'test_boss', 'integration-password', '测试老板', 'active', 99001, 99001),
        (99003, ?, 'test_warehouse', 'integration-password', '测试仓库', 'active', 99001, 99001),
        (99004, ?, 'test_supervisor', 'integration-password', '测试主管', 'active', 99001, 99001),
        (99007, ?, 'test_sales', 'integration-password', '测试销售', 'active', 99001, 99001)
       ON DUPLICATE KEY UPDATE
         username = VALUES(username),
         real_name = VALUES(real_name),
         status = VALUES(status),
         updated_by = VALUES(updated_by)`,
      [TEST_TENANT_ID, TEST_TENANT_ID, TEST_TENANT_ID, TEST_TENANT_ID],
    );

    await pool.execute(
      `INSERT INTO suppliers
        (id, tenant_id, code, name, status, created_by, updated_by)
       VALUES (?, ?, 'SUP-IQC-INT', '来料质检集成供应商', 'active', 99001, 99001)
       ON DUPLICATE KEY UPDATE
         code = VALUES(code),
         name = VALUES(name),
         status = VALUES(status),
         updated_by = VALUES(updated_by)`,
      [SUPPLIER_ID, TEST_TENANT_ID],
    );

    await pool.execute(
      `INSERT INTO skus
        (id, tenant_id, sku_code, name, category1_id, category2_id, stock_unit, purchase_unit, production_unit, has_dye_lot, use_fifo, safety_stock, status, created_by, updated_by)
       VALUES (?, ?, 'SKU-IQC-INT', '来料质检集成物料', 1, 1, '箱', '箱', '箱', 0, 1, 0, 'active', 99001, 99001)
       ON DUPLICATE KEY UPDATE
         sku_code = VALUES(sku_code),
         name = VALUES(name),
         stock_unit = VALUES(stock_unit),
         purchase_unit = VALUES(purchase_unit),
         production_unit = VALUES(production_unit),
         status = VALUES(status),
         updated_by = VALUES(updated_by)`,
      [SKU_ID, TEST_TENANT_ID],
    );

    await pool.execute(
      `INSERT INTO inventory
        (tenant_id, sku_id, qty_on_hand, qty_reserved, qty_in_transit, last_in_at)
       VALUES (?, ?, 0.0000, 0.0000, 0.0000, NOW(3))
       ON DUPLICATE KEY UPDATE
         qty_on_hand = 0.0000,
         qty_reserved = 0.0000,
         qty_in_transit = 0.0000,
         last_in_at = NOW(3)`,
      [TEST_TENANT_ID, SKU_ID],
    );

    await pool.execute(
      `DELETE roi
       FROM return_order_items roi
       INNER JOIN return_orders ro ON ro.id = roi.return_id
       WHERE roi.tenant_id = ? AND ro.source_po_id = ?`,
      [TEST_TENANT_ID, PO_ID],
    );
    await pool.execute(
      'DELETE FROM return_orders WHERE tenant_id = ? AND source_po_id = ?',
      [TEST_TENANT_ID, PO_ID],
    );
    await pool.execute(
      `DELETE FROM inventory_transactions
       WHERE tenant_id = ? AND sku_id = ? AND reference_type IN ('purchase_receipt', 'stocktaking_task')`,
      [TEST_TENANT_ID, SKU_ID],
    );
    await pool.execute(
      'DELETE FROM inventory_daily_snapshots WHERE tenant_id = ? AND sku_id = ?',
      [TEST_TENANT_ID, SKU_ID],
    );
    await pool.execute(
      `DELETE ii
       FROM incoming_inspection_items ii
       INNER JOIN incoming_inspection_records ir ON ir.id = ii.inspection_id
       WHERE ii.tenant_id = ? AND ir.po_id = ?`,
      [TEST_TENANT_ID, PO_ID],
    );
    await pool.execute(
      'DELETE FROM incoming_inspection_records WHERE tenant_id = ? AND po_id = ?',
      [TEST_TENANT_ID, PO_ID],
    );
    await pool.execute(
      'DELETE FROM purchase_receipts WHERE tenant_id = ? AND po_id = ?',
      [TEST_TENANT_ID, PO_ID],
    );
    await pool.execute(
      'DELETE FROM delivery_note_items WHERE tenant_id = ? AND delivery_note_id = ?',
      [TEST_TENANT_ID, DELIVERY_NOTE_ID],
    );
    await pool.execute(
      'DELETE FROM delivery_notes WHERE tenant_id = ? AND id = ?',
      [TEST_TENANT_ID, DELIVERY_NOTE_ID],
    );
    await pool.execute(
      'DELETE FROM purchase_order_items WHERE tenant_id = ? AND po_id = ?',
      [TEST_TENANT_ID, PO_ID],
    );
    await pool.execute(
      'DELETE FROM purchase_orders WHERE tenant_id = ? AND id = ?',
      [TEST_TENANT_ID, PO_ID],
    );

    await pool.execute(
      `INSERT INTO purchase_orders
        (id, tenant_id, po_no, supplier_id, status, total_amount, expected_date, notes, created_by, updated_by)
       VALUES (?, ?, 'PO-IQC-INT', ?, 'confirmed', 1760.00, '2026-06-20', '来料质检集成采购单', 99001, 99001)
       ON DUPLICATE KEY UPDATE
         supplier_id = VALUES(supplier_id),
         status = VALUES(status),
         total_amount = VALUES(total_amount),
         expected_date = VALUES(expected_date),
         notes = VALUES(notes),
         updated_by = VALUES(updated_by)`,
      [PO_ID, TEST_TENANT_ID, SUPPLIER_ID],
    );

    await pool.execute(
      `INSERT INTO purchase_order_items
        (id, tenant_id, po_id, sku_id, qty_ordered, qty_received, purchase_unit, unit_price, amount, created_by, updated_by)
       VALUES (?, ?, ?, ?, 20.0000, 0.0000, '箱', 88.0000, 1760.00, 99001, 99001)
       ON DUPLICATE KEY UPDATE
         qty_ordered = VALUES(qty_ordered),
         qty_received = VALUES(qty_received),
         purchase_unit = VALUES(purchase_unit),
         unit_price = VALUES(unit_price),
         amount = VALUES(amount),
         updated_by = VALUES(updated_by)`,
      [PO_ITEM_ID, TEST_TENANT_ID, PO_ID, SKU_ID],
    );

    await pool.execute(
      `INSERT INTO delivery_notes
        (id, tenant_id, delivery_no, po_id, supplier_id, delivery_date, status, notes, created_by, updated_by, inspection_id, receipt_id)
       VALUES (?, ?, 'DN-IQC-INT', ?, ?, '2026-06-10', 'confirmed', '来料质检集成送货单', 99001, 99001, NULL, NULL)
       ON DUPLICATE KEY UPDATE
         po_id = VALUES(po_id),
         supplier_id = VALUES(supplier_id),
         delivery_date = VALUES(delivery_date),
         status = VALUES(status),
         notes = VALUES(notes),
         inspection_id = VALUES(inspection_id),
         receipt_id = VALUES(receipt_id),
         updated_by = VALUES(updated_by)`,
      [DELIVERY_NOTE_ID, TEST_TENANT_ID, PO_ID, SUPPLIER_ID],
    );

    await pool.execute(
      `INSERT INTO delivery_note_items
        (id, tenant_id, delivery_note_id, sku_id, qty_delivered, purchase_unit, unit_price, amount, created_by, updated_by)
       VALUES (?, ?, ?, ?, 20.0000, '箱', 88.0000, 1760.00, 99001, 99001)
       ON DUPLICATE KEY UPDATE
         qty_delivered = VALUES(qty_delivered),
         purchase_unit = VALUES(purchase_unit),
         unit_price = VALUES(unit_price),
         amount = VALUES(amount),
         updated_by = VALUES(updated_by)`,
      [DELIVERY_NOTE_ITEM_ID, TEST_TENANT_ID, DELIVERY_NOTE_ID, SKU_ID],
    );
  });

  afterAll(async () => {
    await dbPool?.end();
    dbPool = null;
  });

  test('warehouse 可创建质检单，sales 无权查询，重复创建会冲突', async () => {
    const deniedRes = await request(BASE_URL)
      .get('/api/incoming-inspections?page=1&pageSize=20')
      .set(authHeader('sales'));

    expect(deniedRes.status).toBe(403);
    expect(deniedRes.body.code).toBe(1003);

    const createRes = await request(BASE_URL)
      .post('/api/incoming-inspections')
      .set(authHeader('warehouse'))
      .send({
        poId: PO_ID,
        deliveryNoteId: DELIVERY_NOTE_ID,
        inspectionDate: INSPECTION_DATE,
        notes: '集成测试创建来料质检单',
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.code).toBe(0);
    expect(createRes.body.data.inspectionNo).toMatch(/^IQC/);
    inspectionId = Number(createRes.body.data.id);
    expect(inspectionId).toBeGreaterThan(0);

    const duplicateRes = await request(BASE_URL)
      .post('/api/incoming-inspections')
      .set(authHeader('warehouse'))
      .send({
        poId: PO_ID,
        deliveryNoteId: DELIVERY_NOTE_ID,
        inspectionDate: INSPECTION_DATE,
      });

    expect(duplicateRes.status).toBe(409);

    const listRes = await request(BASE_URL)
      .get(`/api/incoming-inspections?page=1&pageSize=20&poId=${PO_ID}&status=draft`)
      .set(authHeader('supervisor'));

    expect(listRes.status).toBe(200);
    expect(listRes.body.code).toBe(0);
    const createdInspection = (listRes.body.data?.list ?? []).find(
      (item: any) => Number(item.id) === inspectionId,
    );
    expect(createdInspection).toBeTruthy();
    expect(Number(createdInspection.id)).toBe(inspectionId);
    expect(Number(createdInspection.po_id)).toBe(PO_ID);
    expect(createdInspection.poNo).toBe('PO-IQC-INT');
    expect(createdInspection.supplierName).toBe('来料质检集成供应商');
    expect(createdInspection.deliveryNo).toBe('DN-IQC-INT');
    expect(createdInspection.status).toBe('draft');

    const detailRes = await request(BASE_URL)
      .get(`/api/incoming-inspections/${inspectionId}`)
      .set(authHeader('warehouse'));

    expect(detailRes.status).toBe(200);
    expect(detailRes.body.code).toBe(0);
    expect(detailRes.body.data.status).toBe('draft');
    expect(detailRes.body.data.items).toHaveLength(1);
    expect(detailRes.body.data.items[0]).toMatchObject({
      skuId: SKU_ID,
      skuCode: 'SKU-IQC-INT',
      skuName: '来料质检集成物料',
      qtyDelivered: '20.0000',
      qtyPassed: '0.0000',
      qtyFailed: '0.0000',
      stockUnit: '箱',
    });
    inspectionItemId = Number(detailRes.body.data.items[0].id);
    expect(inspectionItemId).toBeGreaterThan(0);
  });

  test('更新质检明细时校验数量上限', async () => {
    const invalidRes = await request(BASE_URL)
      .put(`/api/incoming-inspections/${inspectionId}/items`)
      .set(authHeader('warehouse'))
      .send({
        items: [{
          id: inspectionItemId,
          qtysampled: '20.0000',
          qtyPassed: '15.0000',
          qtyFailed: '6.0000',
          result: 'conditional_pass',
          disposition: 'return',
          notes: '数量越界测试',
        }],
      });

    expect(invalidRes.status).toBe(400);
    expect(invalidRes.body.message).toMatch(/超过到货数量/);
  });

  test('不合格品若不是 return 处置，提交时会被拦截', async () => {
    const updateRes = await request(BASE_URL)
      .put(`/api/incoming-inspections/${inspectionId}/items`)
      .set(authHeader('warehouse'))
      .send({
        items: [{
          id: inspectionItemId,
          qtysampled: '20.0000',
          qtyPassed: '0.0000',
          qtyFailed: '20.0000',
          result: 'fail',
          disposition: 'accept',
          notes: '故意构造非法处置',
        }],
      });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.code).toBe(0);

    const submitRes = await request(BASE_URL)
      .post(`/api/incoming-inspections/${inspectionId}/submit`)
      .set(authHeader('warehouse'))
      .send({
        overallResult: 'fail',
        notes: '不合法提交应失败',
      });

    expect(submitRes.status).toBe(400);
    expect(submitRes.body.message).toMatch(/不合格品仅允许退货处置/);
  });

  test('partial pass 提交后会生成入库与退货副作用，并可预览入库单', async () => {
    const updateRes = await request(BASE_URL)
      .put(`/api/incoming-inspections/${inspectionId}/items`)
      .set(authHeader('warehouse'))
      .send({
        items: [{
          id: inspectionItemId,
          qtysampled: '20.0000',
          qtyPassed: '12.0000',
          qtyFailed: '8.0000',
          result: 'conditional_pass',
          disposition: 'return',
          notes: '12箱合格、8箱退货',
        }],
      });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.code).toBe(0);

    const submitRes = await request(BASE_URL)
      .post(`/api/incoming-inspections/${inspectionId}/submit`)
      .set(authHeader('warehouse'))
      .send({
        overallResult: 'conditional_pass',
        notes: '部分合格自动入库并退货',
      });

    expect(submitRes.status).toBe(200);
    expect(submitRes.body.code).toBe(0);

    const previewRes = await request(BASE_URL)
      .get(`/api/incoming-inspections/${inspectionId}/preview-receipt`)
      .set(authHeader('warehouse'));

    expect(previewRes.status).toBe(200);
    expect(previewRes.body.code).toBe(0);
    expect(previewRes.body.data.poNo).toBe('PO-IQC-INT');
    expect(previewRes.body.data.deliveryNo).toBe('DN-IQC-INT');
    expect(previewRes.body.data.receiptTriggered).toBe(true);
    expect(previewRes.body.data.totalAmount).toBe('1056.00');
    expect(previewRes.body.data.items).toHaveLength(1);
    expect(Number(previewRes.body.data.items[0].sku_id)).toBe(SKU_ID);
    expect(previewRes.body.data.items[0]).toMatchObject({
      skuCode: 'SKU-IQC-INT',
      skuName: '来料质检集成物料',
      qty_passed: '12.0000',
      purchase_unit: '箱',
      unit_price: UNIT_PRICE,
      amount: '1056.00000000',
      dyeLotNo: null,
    });
    expect(Number(previewRes.body.data.receiptId)).toBeGreaterThan(0);
    expect(String(previewRes.body.data.receiptNo)).toMatch(/^RK|^RC|^RE|^PR|^IN/);

    const listRes = await request(BASE_URL)
      .get('/api/incoming-inspections?page=1&pageSize=20&status=partially_passed&result=conditional_pass')
      .set(authHeader('supervisor'));

    expect(listRes.status).toBe(200);
    expect(listRes.body.data.list.some((item: any) => Number(item.id) === inspectionId)).toBe(true);

    const pool = getDbPool();
    const receiptDeliveryColumn = await getPurchaseReceiptDeliveryColumn(pool);

    const [receiptRows] = await pool.query<Array<RowDataPacket & { id: number; receipt_no: string }>>(
      `SELECT id, receipt_no
       FROM purchase_receipts
       WHERE tenant_id = ? AND po_id = ? AND ${receiptDeliveryColumn} = ?`,
      [TEST_TENANT_ID, PO_ID, DELIVERY_NOTE_ID],
    );
    expect(receiptRows).toHaveLength(1);

    const [returnRows] = await pool.query<Array<RowDataPacket & { id: number; status: string; total_qty: string }>>(
      `SELECT id, status, total_qty
       FROM return_orders
       WHERE tenant_id = ? AND source_po_id = ? AND source_inspection_id = ?`,
      [TEST_TENANT_ID, PO_ID, inspectionId],
    );
    expect(returnRows).toHaveLength(1);
    expect(returnRows[0]).toMatchObject({
      status: 'confirmed',
      total_qty: '8.0000',
    });

    const [returnItemRows] = await pool.query<Array<RowDataPacket & { qty_return: string }>>(
      `SELECT qty_return
       FROM return_order_items
       WHERE tenant_id = ? AND return_id = ?`,
      [TEST_TENANT_ID, Number(returnRows[0].id)],
    );
    expect(returnItemRows).toEqual([
      expect.objectContaining({ qty_return: '8.0000' }),
    ]);

    const [inventoryRows] = await pool.query<Array<RowDataPacket & { qty_on_hand: string; qty_in_transit: string }>>(
      `SELECT qty_on_hand, qty_in_transit
       FROM inventory
       WHERE tenant_id = ? AND sku_id = ?`,
      [TEST_TENANT_ID, SKU_ID],
    );
    expect(inventoryRows).toEqual([
      expect.objectContaining({
        qty_on_hand: '12.0000',
        qty_in_transit: '0.0000',
      }),
    ]);

    const [txRows] = await pool.query<Array<RowDataPacket & {
      transaction_type: string;
      direction: string;
      qty_input: string;
      qty_stock_unit: string;
      reference_type: string;
      reference_id: number;
    }>>(
      `SELECT transaction_type, direction, qty_input, qty_stock_unit, reference_type, reference_id
       FROM inventory_transactions
       WHERE tenant_id = ? AND sku_id = ? AND reference_type = 'purchase_receipt'
       ORDER BY id DESC
       LIMIT 1`,
      [TEST_TENANT_ID, SKU_ID],
    );
    expect(txRows).toEqual([
      expect.objectContaining({
        transaction_type: 'PURCHASE_IN',
        direction: 'IN',
        qty_input: '12.0000',
        qty_stock_unit: '12.0000',
        reference_type: 'purchase_receipt',
        reference_id: Number(receiptRows[0].id),
      }),
    ]);

    const [snapshotRows] = await pool.query<Array<RowDataPacket & { qty_on_hand: string; qty_available: string }>>(
      `SELECT qty_on_hand, qty_available
       FROM inventory_daily_snapshots
       WHERE tenant_id = ? AND sku_id = ? AND snapshot_date = CURDATE()`,
      [TEST_TENANT_ID, SKU_ID],
    );
    expect(snapshotRows).toEqual([
      expect.objectContaining({
        qty_on_hand: '12.0000',
        qty_available: '12.0000',
      }),
    ]);

    const [poItemRows] = await pool.query<Array<RowDataPacket & {
      qty_received: string;
      qty_passed: string;
      qty_rejected: string;
    }>>(
      `SELECT qty_received, qty_passed, qty_rejected
       FROM purchase_order_items
       WHERE tenant_id = ? AND id = ?`,
      [TEST_TENANT_ID, PO_ITEM_ID],
    );
    expect(poItemRows).toEqual([
      expect.objectContaining({
        qty_received: '12.0000',
        qty_passed: '12.0000',
        qty_rejected: '8.0000',
      }),
    ]);

    const [recordRows] = await pool.query<Array<RowDataPacket & {
      status: string;
      overall_result: string;
      receipt_triggered: number;
      return_triggered: number;
    }>>(
      `SELECT status, overall_result, receipt_triggered, return_triggered
       FROM incoming_inspection_records
       WHERE tenant_id = ? AND id = ?`,
      [TEST_TENANT_ID, inspectionId],
    );
    expect(recordRows).toEqual([
      expect.objectContaining({
        status: 'partially_passed',
        overall_result: 'conditional_pass',
        receipt_triggered: 1,
        return_triggered: 1,
      }),
    ]);

    const [deliveryRows] = await pool.query<Array<RowDataPacket & {
      inspection_id: number;
      receipt_id: number;
      status: string;
    }>>(
      `SELECT inspection_id, receipt_id, status
       FROM delivery_notes
       WHERE tenant_id = ? AND id = ?`,
      [TEST_TENANT_ID, DELIVERY_NOTE_ID],
    );
    expect(deliveryRows).toEqual([
      expect.objectContaining({
        inspection_id: inspectionId,
        receipt_id: Number(receiptRows[0].id),
        status: 'confirmed',
      }),
    ]);
  });
});
