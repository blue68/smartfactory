import request from 'supertest';
import mysql, { Pool, RowDataPacket } from 'mysql2/promise';
import { authHeader } from '../helpers/testAuth';

const BASE_URL = process.env.TEST_API_URL ?? 'http://localhost:3000';
const TEST_TENANT_ID = 9999;

const SUPPLIER_ID = 996901;
const SKU_ID = 996902;

const PO_CREATE_ID = 996911;
const DN_CREATE_ID = 996912;
const RECEIPT_CREATE_ID = 996913;
const MATCH_CREATE_ID = 996914;
const INSPECTION_CREATE_ID = 996915;
const INSPECTION_ITEM_CREATE_ID = 996916;
const PO_ITEM_CREATE_ID = 996917;

const PO_CONFIRMED_ID = 996921;
const DN_CONFIRMED_ID = 996922;
const RECEIPT_CONFIRMED_ID = 996923;
const MATCH_CONFIRMED_ID = 996924;
const SETTLEMENT_CONFIRMED_ID = 996925;

const PO_CANCEL_ID = 996931;
const DN_CANCEL_ID = 996932;
const RECEIPT_CANCEL_ID = 996933;
const MATCH_CANCEL_ID = 996934;
const SETTLEMENT_CANCEL_ID = 996935;

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

describe('采购结算模块 API 集成测试', () => {
  let createdSettlementId = 0;

  beforeAll(async () => {
    const pool = getDbPool();
    const receiptDeliveryColumn = await getPurchaseReceiptDeliveryColumn(pool);

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
        (99002, ?, 'test_purchaser', 'integration-password', '测试采购员', 'active', 99001, 99001),
        (99004, ?, 'test_supervisor', 'integration-password', '测试主管', 'active', 99001, 99001)
       ON DUPLICATE KEY UPDATE
         username = VALUES(username),
         real_name = VALUES(real_name),
         status = VALUES(status),
         updated_by = VALUES(updated_by)`,
      [TEST_TENANT_ID, TEST_TENANT_ID, TEST_TENANT_ID],
    );

    await pool.execute(
      `INSERT INTO suppliers
        (id, tenant_id, code, name, status, created_by, updated_by)
       VALUES (?, ?, 'SUP-PST-INT', '采购结算集成供应商', 'active', 99001, 99001)
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
       VALUES (?, ?, 'SKU-PST-INT', '采购结算集成物料', 1, 1, '箱', '箱', '箱', 0, 1, 0, 'active', 99001, 99001)
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
      'DELETE FROM purchase_settlements WHERE tenant_id = ? AND id IN (?, ?)',
      [TEST_TENANT_ID, SETTLEMENT_CONFIRMED_ID, SETTLEMENT_CANCEL_ID],
    );
    await pool.execute(
      'DELETE FROM purchase_settlements WHERE tenant_id = ? AND match_id IN (?, ?, ?)',
      [TEST_TENANT_ID, MATCH_CREATE_ID, MATCH_CONFIRMED_ID, MATCH_CANCEL_ID],
    );
    await pool.execute(
      'DELETE FROM three_way_match_records WHERE tenant_id = ? AND id IN (?, ?, ?)',
      [TEST_TENANT_ID, MATCH_CREATE_ID, MATCH_CONFIRMED_ID, MATCH_CANCEL_ID],
    );
    await pool.execute(
      'DELETE FROM incoming_inspection_items WHERE tenant_id = ? AND id = ?',
      [TEST_TENANT_ID, INSPECTION_ITEM_CREATE_ID],
    );
    await pool.execute(
      'DELETE FROM incoming_inspection_records WHERE tenant_id = ? AND id = ?',
      [TEST_TENANT_ID, INSPECTION_CREATE_ID],
    );
    await pool.execute(
      'DELETE FROM purchase_receipts WHERE tenant_id = ? AND id IN (?, ?, ?)',
      [TEST_TENANT_ID, RECEIPT_CREATE_ID, RECEIPT_CONFIRMED_ID, RECEIPT_CANCEL_ID],
    );
    await pool.execute(
      'DELETE FROM delivery_notes WHERE tenant_id = ? AND id IN (?, ?, ?)',
      [TEST_TENANT_ID, DN_CREATE_ID, DN_CONFIRMED_ID, DN_CANCEL_ID],
    );
    await pool.execute(
      'DELETE FROM purchase_order_items WHERE tenant_id = ? AND id IN (?, ?, ?)',
      [TEST_TENANT_ID, PO_ITEM_CREATE_ID, PO_CONFIRMED_ID, PO_CANCEL_ID],
    );
    await pool.execute(
      'DELETE FROM purchase_order_items WHERE tenant_id = ? AND po_id IN (?, ?, ?)',
      [TEST_TENANT_ID, PO_CREATE_ID, PO_CONFIRMED_ID, PO_CANCEL_ID],
    );
    await pool.execute(
      'DELETE FROM purchase_orders WHERE tenant_id = ? AND id IN (?, ?, ?)',
      [TEST_TENANT_ID, PO_CREATE_ID, PO_CONFIRMED_ID, PO_CANCEL_ID],
    );

    await pool.execute(
      `INSERT INTO purchase_orders
        (id, tenant_id, po_no, supplier_id, status, total_amount, expected_date, notes, created_by, updated_by)
       VALUES
        (?, ?, 'PO-PST-CREATE', ?, 'confirmed', 880.00, '2026-06-20', '采购结算创建种子', 99002, 99002),
        (?, ?, 'PO-PST-CONFIRMED', ?, 'partial_received', 1320.00, '2026-06-21', '采购结算确认种子', 99002, 99002),
        (?, ?, 'PO-PST-CANCEL', ?, 'received', 1760.00, '2026-06-22', '采购结算取消种子', 99002, 99002)`,
      [
        PO_CREATE_ID, TEST_TENANT_ID, SUPPLIER_ID,
        PO_CONFIRMED_ID, TEST_TENANT_ID, SUPPLIER_ID,
        PO_CANCEL_ID, TEST_TENANT_ID, SUPPLIER_ID,
      ],
    );

    await pool.execute(
      `INSERT INTO purchase_order_items
        (id, tenant_id, po_id, sku_id, qty_ordered, qty_received, purchase_unit, unit_price, amount, created_by, updated_by)
       VALUES
        (?, ?, ?, ?, 10.0000, 0.0000, '箱', 88.0000, 880.00, 99002, 99002),
        (?, ?, ?, ?, 12.0000, 12.0000, '箱', 110.0000, 1320.00, 99002, 99002),
        (?, ?, ?, ?, 16.0000, 16.0000, '箱', 110.0000, 1760.00, 99002, 99002)`,
      [
        PO_ITEM_CREATE_ID, TEST_TENANT_ID, PO_CREATE_ID, SKU_ID,
        PO_CONFIRMED_ID, TEST_TENANT_ID, PO_CONFIRMED_ID, SKU_ID,
        PO_CANCEL_ID, TEST_TENANT_ID, PO_CANCEL_ID, SKU_ID,
      ],
    );

    await pool.execute(
      `INSERT INTO delivery_notes
        (id, tenant_id, delivery_no, po_id, supplier_id, delivery_date, status, notes, created_by, updated_by)
       VALUES
        (?, ?, 'DN-PST-CREATE', ?, ?, '2026-06-01', 'confirmed', '创建结算送货单', 99002, 99002),
        (?, ?, 'DN-PST-CONFIRMED', ?, ?, '2026-06-02', 'confirmed', '确认结算送货单', 99002, 99002),
        (?, ?, 'DN-PST-CANCEL', ?, ?, '2026-06-03', 'confirmed', '取消结算送货单', 99002, 99002)`,
      [
        DN_CREATE_ID, TEST_TENANT_ID, PO_CREATE_ID, SUPPLIER_ID,
        DN_CONFIRMED_ID, TEST_TENANT_ID, PO_CONFIRMED_ID, SUPPLIER_ID,
        DN_CANCEL_ID, TEST_TENANT_ID, PO_CANCEL_ID, SUPPLIER_ID,
      ],
    );

    await pool.execute(
      `INSERT INTO purchase_receipts
        (id, tenant_id, receipt_no, po_id, ${receiptDeliveryColumn}, status, received_at, created_by, updated_by)
       VALUES
        (?, ?, 'RC-PST-CREATE', ?, ?, 'confirmed', '2026-06-01 08:00:00', 99002, 99002),
        (?, ?, 'RC-PST-CONFIRMED', ?, ?, 'confirmed', '2026-06-02 08:00:00', 99002, 99002),
        (?, ?, 'RC-PST-CANCEL', ?, ?, 'confirmed', '2026-06-03 08:00:00', 99002, 99002)`,
      [
        RECEIPT_CREATE_ID, TEST_TENANT_ID, PO_CREATE_ID, DN_CREATE_ID,
        RECEIPT_CONFIRMED_ID, TEST_TENANT_ID, PO_CONFIRMED_ID, DN_CONFIRMED_ID,
        RECEIPT_CANCEL_ID, TEST_TENANT_ID, PO_CANCEL_ID, DN_CANCEL_ID,
      ],
    );

    await pool.execute(
      `INSERT INTO incoming_inspection_records
        (id, tenant_id, inspection_no, po_id, delivery_note_id, inspector_id, inspection_date, status, overall_result, receipt_triggered, return_triggered, created_by, updated_by)
       VALUES (?, ?, 'IQC-PST-CREATE', ?, ?, 99004, '2026-06-01', 'passed', 'pass', 1, 0, 99004, 99004)`,
      [INSPECTION_CREATE_ID, TEST_TENANT_ID, PO_CREATE_ID, DN_CREATE_ID],
    );

    await pool.execute(
      `INSERT INTO incoming_inspection_items
        (id, tenant_id, inspection_id, sku_id, po_item_id, qty_delivered, qty_sampled, qty_passed, qty_failed, result, disposition, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, 10.0000, 10.0000, 10.0000, 0.0000, 'pass', 'accept', 99004, 99004)`,
      [INSPECTION_ITEM_CREATE_ID, TEST_TENANT_ID, INSPECTION_CREATE_ID, SKU_ID, PO_ITEM_CREATE_ID],
    );

    await pool.execute(
      `INSERT INTO three_way_match_records
        (id, tenant_id, po_id, delivery_note_id, receipt_id, match_status, qty_diff_detail, price_diff_detail, diff_reason, diff_notes, created_by, updated_by)
       VALUES
        (?, ?, ?, ?, ?, 'matched', NULL, NULL, NULL, NULL, 99002, 99002),
        (?, ?, ?, ?, ?, 'matched', NULL, NULL, 'supplier_short', '确认后的采购结算', 99002, 99002),
        (?, ?, ?, ?, ?, 'matched', NULL, NULL, 'other', '待取消采购结算', 99002, 99002)`,
      [
        MATCH_CREATE_ID, TEST_TENANT_ID, PO_CREATE_ID, DN_CREATE_ID, RECEIPT_CREATE_ID,
        MATCH_CONFIRMED_ID, TEST_TENANT_ID, PO_CONFIRMED_ID, DN_CONFIRMED_ID, RECEIPT_CONFIRMED_ID,
        MATCH_CANCEL_ID, TEST_TENANT_ID, PO_CANCEL_ID, DN_CANCEL_ID, RECEIPT_CANCEL_ID,
      ],
    );

    await pool.execute(
      `INSERT INTO purchase_settlements
        (id, tenant_id, settlement_no, match_id, po_id, delivery_note_id, receipt_id, supplier_id, total_amount, status, due_date, notes, created_by, updated_by, confirmed_by, confirmed_at, paid_at)
       VALUES
        (?, ?, 'PST-INT-CONFIRMED', ?, ?, ?, ?, ?, 1320.00, 'confirmed', '2026-07-02', '待付款采购结算', 99001, 99001, 99001, NOW(3), NULL),
        (?, ?, 'PST-INT-CANCEL', ?, ?, ?, ?, ?, 1760.00, 'draft', '2026-07-03', '待取消采购结算', 99001, 99001, NULL, NULL, NULL)`,
      [
        SETTLEMENT_CONFIRMED_ID, TEST_TENANT_ID, MATCH_CONFIRMED_ID, PO_CONFIRMED_ID, DN_CONFIRMED_ID, RECEIPT_CONFIRMED_ID, SUPPLIER_ID,
        SETTLEMENT_CANCEL_ID, TEST_TENANT_ID, MATCH_CANCEL_ID, PO_CANCEL_ID, DN_CANCEL_ID, RECEIPT_CANCEL_ID, SUPPLIER_ID,
      ],
    );
  });

  afterAll(async () => {
    await dbPool?.end();
    dbPool = null;
  });

  test('purchaser 可创建采购结算单，重复创建返回已存在结算，warehouse 无权创建', async () => {
    const deniedRes = await request(BASE_URL)
      .post('/api/purchase/settlements')
      .set(authHeader('warehouse'))
      .send({ matchId: MATCH_CREATE_ID });

    expect(deniedRes.status).toBe(403);
    expect(deniedRes.body.code).toBe(1003);

    const createRes = await request(BASE_URL)
      .post('/api/purchase/settlements')
      .set(authHeader('purchaser'))
      .send({
        matchId: MATCH_CREATE_ID,
        notes: '集成测试创建采购结算单',
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.code).toBe(0);
    expect(createRes.body.data.settlementNo).toMatch(/^PST/);
    expect(createRes.body.data.poId).toBe(PO_CREATE_ID);
    expect(createRes.body.data.poNo).toBe('PO-PST-CREATE');
    expect(createRes.body.data.receiptId).toBe(RECEIPT_CREATE_ID);
    expect(createRes.body.data.receiptNo).toBe('RC-PST-CREATE');
    expect(createRes.body.data.supplierId).toBe(SUPPLIER_ID);
    expect(createRes.body.data.supplierName).toBe('采购结算集成供应商');
    expect(createRes.body.data.totalAmount).toBe('880.00');
    expect(createRes.body.data.status).toBe('draft');
    expect(createRes.body.data.notes).toBe('集成测试创建采购结算单');
    createdSettlementId = Number(createRes.body.data.id);
    expect(createdSettlementId).toBeGreaterThan(0);

    const duplicateRes = await request(BASE_URL)
      .post('/api/purchase/settlements')
      .set(authHeader('purchaser'))
      .send({ matchId: MATCH_CREATE_ID });

    expect(duplicateRes.status).toBe(201);
    expect(duplicateRes.body.code).toBe(0);
    expect(Number(duplicateRes.body.data.id)).toBe(createdSettlementId);
  });

  test('supervisor 可按 keyword/status 查询列表并导出 CSV，详情可回查差异字段', async () => {
    const listRes = await request(BASE_URL)
      .get('/api/purchase/settlements?keyword=PST-INT&status=confirmed&page=1&pageSize=20')
      .set(authHeader('supervisor'));

    expect(listRes.status).toBe(200);
    expect(listRes.body.code).toBe(0);
    expect(listRes.body.data.page).toBe(1);
    expect(listRes.body.data.pageSize).toBe(20);
    const list: Array<Record<string, unknown>> = listRes.body.data?.list ?? [];
    expect(list.some((item) => Number(item.id) === SETTLEMENT_CONFIRMED_ID)).toBe(true);
    list.forEach((item) => {
      expect(String(item.status)).toBe('confirmed');
    });

    const detailRes = await request(BASE_URL)
      .get(`/api/purchase/settlements/${SETTLEMENT_CONFIRMED_ID}`)
      .set(authHeader('boss'));

    expect(detailRes.status).toBe(200);
    expect(detailRes.body.code).toBe(0);
    expect(detailRes.body.data).toMatchObject({
      id: SETTLEMENT_CONFIRMED_ID,
      settlementNo: 'PST-INT-CONFIRMED',
      matchId: MATCH_CONFIRMED_ID,
      poId: PO_CONFIRMED_ID,
      poNo: 'PO-PST-CONFIRMED',
      deliveryNoteId: DN_CONFIRMED_ID,
      deliveryNo: 'DN-PST-CONFIRMED',
      receiptId: RECEIPT_CONFIRMED_ID,
      receiptNo: 'RC-PST-CONFIRMED',
      supplierId: SUPPLIER_ID,
      supplierName: '采购结算集成供应商',
      totalAmount: '1320.00',
      status: 'confirmed',
      dueDate: '2026-07-02',
      diffReason: 'supplier_short',
      diffNotes: '确认后的采购结算',
      confirmedBy: 'test_boss',
    });

    const exportRes = await request(BASE_URL)
      .get('/api/purchase/settlements/export/csv?keyword=PST-INT')
      .set(authHeader('purchaser'));

    expect(exportRes.status).toBe(200);
    expect(String(exportRes.headers['content-type'] ?? '')).toContain('text/csv');
    expect(String(exportRes.text)).toContain('结算单号');
    expect(String(exportRes.text)).toContain('PST-INT-CONFIRMED');
    expect(String(exportRes.text)).toContain('采购结算集成供应商');
  });

  test('boss 可确认 draft 结算并付款 confirmed 结算，supervisor 可取消 draft 结算', async () => {
    const confirmRes = await request(BASE_URL)
      .put(`/api/purchase/settlements/${createdSettlementId}/confirm`)
      .set(authHeader('boss'));

    expect(confirmRes.status).toBe(200);
    expect(confirmRes.body.code).toBe(0);
    expect(confirmRes.body.data.status).toBe('confirmed');
    expect(confirmRes.body.data.confirmedBy).toBe('test_boss');
    expect(confirmRes.body.data.confirmedAt).toBeTruthy();

    const payRes = await request(BASE_URL)
      .put(`/api/purchase/settlements/${SETTLEMENT_CONFIRMED_ID}/pay`)
      .set(authHeader('boss'));

    expect(payRes.status).toBe(200);
    expect(payRes.body.code).toBe(0);
    expect(payRes.body.data.status).toBe('paid');
    expect(payRes.body.data.paidAt).toBeTruthy();

    const cancelRes = await request(BASE_URL)
      .put(`/api/purchase/settlements/${SETTLEMENT_CANCEL_ID}/cancel`)
      .set(authHeader('supervisor'));

    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.code).toBe(0);
    expect(cancelRes.body.data.status).toBe('cancelled');

    const pool = getDbPool();
    const [rows] = await pool.query<Array<RowDataPacket & {
      id: number;
      status: string;
      confirmed_by: number | null;
      confirmed_at: string | null;
      paid_at: string | null;
    }>>(
      `SELECT id, status, confirmed_by, confirmed_at, paid_at
       FROM purchase_settlements
       WHERE tenant_id = ? AND id IN (?, ?, ?)
       ORDER BY id`,
      [TEST_TENANT_ID, createdSettlementId, SETTLEMENT_CONFIRMED_ID, SETTLEMENT_CANCEL_ID],
    );

    const rowMap = new Map(rows.map((row) => [Number(row.id), row]));
    expect(rowMap.get(createdSettlementId)).toMatchObject({
      status: 'confirmed',
      confirmed_by: 99001,
    });
    expect(rowMap.get(createdSettlementId)?.confirmed_at).toBeTruthy();
    expect(rowMap.get(SETTLEMENT_CONFIRMED_ID)).toMatchObject({
      status: 'paid',
    });
    expect(rowMap.get(SETTLEMENT_CONFIRMED_ID)?.paid_at).toBeTruthy();
    expect(rowMap.get(SETTLEMENT_CANCEL_ID)).toMatchObject({
      status: 'cancelled',
    });
  });
});
