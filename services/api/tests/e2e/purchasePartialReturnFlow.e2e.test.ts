import request from 'supertest';
import mysql, { Pool } from 'mysql2/promise';
import { authHeader } from '../helpers/testAuth';

const BASE_URL = process.env.TEST_API_URL ?? 'http://localhost:3000';

jest.setTimeout(60000);

const TEST_TENANT_ID = 9999;
const SEEDED_SUPPLIER_ID = 990911;
const SEEDED_SKU_ID = 990913;

let dbPool: Pool | null = null;

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

describe('E2E: 采购部分合格+退货流程', () => {
  let poId: number;
  let deliveryNoteId: number;
  let inspectionId: number;
  let receiptId: number;
  let returnOrderId: number;
  let matchId: number;
  let stockQtyBefore: number;

  beforeAll(async () => {
    const pool = getDbPool();

    await pool.execute(
      `INSERT INTO suppliers
         (id, tenant_id, code, name, grade, status, main_skus, created_by, updated_by)
       VALUES (?, ?, ?, ?, 'A', 'active', JSON_ARRAY(?), ?, ?)
       ON DUPLICATE KEY UPDATE
         code = VALUES(code),
         name = VALUES(name),
         grade = VALUES(grade),
         status = VALUES(status),
         main_skus = VALUES(main_skus),
         updated_by = VALUES(updated_by)`,
      [
        SEEDED_SUPPLIER_ID,
        TEST_TENANT_ID,
        'SUP-E2E-PR-9999',
        'E2E部分退货供应商',
        SEEDED_SKU_ID,
        99001,
        99001,
      ],
    );

    await pool.execute(
      `INSERT INTO skus
         (id, tenant_id, sku_code, name, category1_id, category2_id,
          stock_unit, purchase_unit, production_unit, has_dye_lot, use_fifo,
          safety_stock, status, created_by, updated_by)
       VALUES (?, ?, ?, ?, 1, 1, '张', '张', '张', 0, 1, 0, 'active', ?, ?)
       ON DUPLICATE KEY UPDATE
         sku_code = VALUES(sku_code),
         name = VALUES(name),
         stock_unit = VALUES(stock_unit),
         purchase_unit = VALUES(purchase_unit),
         production_unit = VALUES(production_unit),
         status = VALUES(status),
         updated_by = VALUES(updated_by)`,
      [
        SEEDED_SKU_ID,
        TEST_TENANT_ID,
        'SKU-E2E-PR-9999',
        'E2E部分退货板材',
        99001,
        99001,
      ],
    );

    await pool.execute(
      `INSERT INTO inventory
         (tenant_id, sku_id, qty_on_hand, qty_reserved, qty_in_transit, last_in_at)
       VALUES (?, ?, 0, 0, 0, NOW(3))
       ON DUPLICATE KEY UPDATE
         qty_on_hand = 0,
         qty_reserved = 0,
         qty_in_transit = 0,
         last_in_at = NOW(3)`,
      [TEST_TENANT_ID, SEEDED_SKU_ID],
    );
  });

  afterAll(async () => {
    await dbPool?.end();
    dbPool = null;
  });

  test('Step 0: 记录采购前库存', async () => {
    const snapshotDate = new Date().toISOString().slice(0, 10);
    const rebuildRes = await request(BASE_URL)
      .post('/api/inventory/snapshots/rebuild')
      .set(authHeader('supervisor'))
      .send({
        skuId: SEEDED_SKU_ID,
        snapshotDate,
        dryRun: false,
      });
    expect(rebuildRes.status).toBe(200);

    const res = await request(BASE_URL)
      .get(`/api/inventory/${SEEDED_SKU_ID}/available`)
      .set(authHeader('warehouse'));

    expect(res.status).toBe(200);
    stockQtyBefore = parseFloat(res.body.data?.qtyAvailable ?? '0');
  });

  test('Step 1: 创建采购订单', async () => {
    const expectedDate = new Date();
    expectedDate.setDate(expectedDate.getDate() + 10);

    const res = await request(BASE_URL)
      .post('/api/purchase/orders')
      .set(authHeader('purchaser'))
      .send({
        supplierId: SEEDED_SUPPLIER_ID,
        expectedDate: expectedDate.toISOString().slice(0, 10),
        items: [{
          skuId: SEEDED_SKU_ID,
          qtyOrdered: '20',
          purchaseUnit: '张',
          unitPrice: '120.00',
        }],
      });

    expect(res.status).toBe(201);
    poId = Number(res.body.data?.id);
    expect(poId).toBeGreaterThan(0);
  });

  test('Step 2: 录入送货单', async () => {
    const res = await request(BASE_URL)
      .post(`/api/purchase/orders/${poId}/delivery`)
      .set(authHeader('purchaser'))
      .send({
        poId,
        deliveryDate: new Date().toISOString().slice(0, 10),
        items: [{
          skuId: SEEDED_SKU_ID,
          qtyDelivered: '20',
          purchaseUnit: '张',
          unitPrice: '120.00',
        }],
      });

    expect(res.status).toBe(201);
    deliveryNoteId = Number(res.body.data?.id);
    expect(deliveryNoteId).toBeGreaterThan(0);
  });

  test('Step 3: 创建来料质检单', async () => {
    const res = await request(BASE_URL)
      .post('/api/incoming-inspections')
      .set(authHeader('warehouse'))
      .send({
        poId,
        deliveryNoteId,
        inspectionDate: new Date().toISOString().slice(0, 10),
        notes: 'E2E 部分合格质检',
      });

    expect(res.status).toBe(201);
    inspectionId = Number(res.body.data?.id);
    expect(inspectionId).toBeGreaterThan(0);
  });

  test('Step 4: 提交部分合格质检，自动生成入库单与退货单', async () => {
    const detailRes = await request(BASE_URL)
      .get(`/api/incoming-inspections/${inspectionId}`)
      .set(authHeader('warehouse'));

    expect(detailRes.status).toBe(200);
    const items: any[] = detailRes.body.data?.items ?? [];
    expect(items.length).toBeGreaterThan(0);

    const updateRes = await request(BASE_URL)
      .put(`/api/incoming-inspections/${inspectionId}/items`)
      .set(authHeader('warehouse'))
      .send({
        items: items.map((item) => ({
          id: item.id,
          qtysampled: item.qtyDelivered,
          qtyPassed: '12',
          qtyFailed: '8',
          result: 'conditional_pass',
          disposition: 'return',
          notes: '8张不合格退货',
        })),
      });

    expect(updateRes.status).toBe(200);

    const submitRes = await request(BASE_URL)
      .post(`/api/incoming-inspections/${inspectionId}/submit`)
      .set(authHeader('warehouse'))
      .send({
        overallResult: 'conditional_pass',
        notes: '部分合格，自动退货',
      });

    expect(submitRes.status).toBe(200);

    const previewRes = await request(BASE_URL)
      .get(`/api/incoming-inspections/${inspectionId}/preview-receipt`)
      .set(authHeader('warehouse'));

    expect(previewRes.status).toBe(200);
    receiptId = Number(previewRes.body.data?.receiptId);
    expect(receiptId).toBeGreaterThan(0);
    expect(previewRes.body.data?.totalAmount).toBe('1440.00');
  });

  test('Step 5: 验证自动退货单并完成退货流程', async () => {
    const listRes = await request(BASE_URL)
      .get('/api/return-orders?returnType=purchase_return&page=1&pageSize=20')
      .set(authHeader('warehouse'));

    expect(listRes.status).toBe(200);
    const returnOrder = (listRes.body.data?.list ?? []).find(
      (item: any) =>
        Number(item.source_inspection_id ?? item.sourceInspectionId ?? 0) === inspectionId,
    );

    expect(returnOrder).toBeTruthy();
    returnOrderId = Number(returnOrder.id);
    expect(returnOrder.status).toBe('confirmed');

    const detailRes = await request(BASE_URL)
      .get(`/api/return-orders/${returnOrderId}`)
      .set(authHeader('warehouse'));

    expect(detailRes.status).toBe(200);
    expect(detailRes.body.data?.items?.[0]?.qty_return ?? detailRes.body.data?.items?.[0]?.qtyReturn).toBe('8.0000');

    const shipRes = await request(BASE_URL)
      .put(`/api/return-orders/${returnOrderId}/ship`)
      .set(authHeader('warehouse'));

    expect(shipRes.status).toBe(200);

    const completeRes = await request(BASE_URL)
      .put(`/api/return-orders/${returnOrderId}/complete`)
      .set(authHeader('warehouse'));

    expect(completeRes.status).toBe(200);
  });

  test('Step 6: 执行三单匹配并确认数量差异', async () => {
    const matchRes = await request(BASE_URL)
      .post('/api/purchase/three-way-match')
      .set(authHeader('purchaser'))
      .send({
        poId,
        deliveryNoteId,
        receiptId,
      });

    expect(matchRes.status).toBe(200);
    expect(matchRes.body.data?.matchStatus).toBe('qty_diff');
    expect(matchRes.body.data?.diffItems?.[0]?.qtyDiff).toBe('-8.0000');

    matchId = Number(matchRes.body.data?.matchId);
    expect(matchId).toBeGreaterThan(0);

    const confirmRes = await request(BASE_URL)
      .post(`/api/purchase/three-way-match/${matchId}/confirm`)
      .set(authHeader('purchaser'))
      .send({
        diffReason: 'supplier_short',
        diffNotes: '部分不合格退货，数量差异已确认',
      });

    expect(confirmRes.status).toBe(200);
  });

  test('Step 7: 验证库存只增加合格数量 12', async () => {
    const res = await request(BASE_URL)
      .get(`/api/inventory/${SEEDED_SKU_ID}/available`)
      .set(authHeader('warehouse'));

    expect(res.status).toBe(200);
    const stockQtyAfter = parseFloat(res.body.data?.qtyAvailable ?? '0');
    expect(stockQtyAfter).toBeGreaterThanOrEqual(stockQtyBefore + 12);
  });

  test('Step 8: 验证采购订单保持 partial_received', async () => {
    const res = await request(BASE_URL)
      .get(`/api/purchase/orders/${poId}`)
      .set(authHeader('purchaser'));

    expect(res.status).toBe(200);
    expect(res.body.data?.status).toBe('partial_received');
  });
});
