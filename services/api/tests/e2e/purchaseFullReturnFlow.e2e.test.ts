import request from 'supertest';
import mysql, { Pool } from 'mysql2/promise';
import { authHeader } from '../helpers/testAuth';

const BASE_URL = process.env.TEST_API_URL ?? 'http://localhost:3000';

jest.setTimeout(60000);

const TEST_TENANT_ID = 9999;
const SEEDED_SUPPLIER_ID = 990921;
const SEEDED_SKU_ID = 990923;

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

describe('E2E: 采购整单不合格退货流程', () => {
  let poId: number;
  let deliveryNoteId: number;
  let inspectionId: number;
  let returnOrderId: number;
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
        'SUP-E2E-FR-9999',
        'E2E整单退货供应商',
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
        'SKU-E2E-FR-9999',
        'E2E整单退货板材',
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
    const res = await request(BASE_URL)
      .get(`/api/inventory/${SEEDED_SKU_ID}/available`)
      .set(authHeader('warehouse'));

    expect(res.status).toBe(200);
    stockQtyBefore = parseFloat(res.body.data?.qtyAvailable ?? '0');
  });

  test('Step 1: 创建采购订单', async () => {
    const expectedDate = new Date();
    expectedDate.setDate(expectedDate.getDate() + 7);

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
          unitPrice: '99.00',
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
          unitPrice: '99.00',
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
        notes: 'E2E 整单不合格质检',
      });

    expect(res.status).toBe(201);
    inspectionId = Number(res.body.data?.id);
    expect(inspectionId).toBeGreaterThan(0);
  });

  test('Step 4: 提交整单不合格质检，只生成退货单不生成入库单', async () => {
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
          qtyPassed: '0',
          qtyFailed: item.qtyDelivered,
          result: 'fail',
          disposition: 'return',
          notes: '整批不合格退货',
        })),
      });

    expect(updateRes.status).toBe(200);

    const submitRes = await request(BASE_URL)
      .post(`/api/incoming-inspections/${inspectionId}/submit`)
      .set(authHeader('warehouse'))
      .send({
        overallResult: 'fail',
        notes: '整单不合格，全部退货',
      });

    expect(submitRes.status).toBe(200);

    const previewRes = await request(BASE_URL)
      .get(`/api/incoming-inspections/${inspectionId}/preview-receipt`)
      .set(authHeader('warehouse'));

    expect(previewRes.status).toBe(200);
    expect(previewRes.body.data?.receiptId ?? null).toBeNull();
    expect(previewRes.body.data?.receiptNo ?? null).toBeNull();
    expect(previewRes.body.data?.items ?? []).toHaveLength(0);
    expect(previewRes.body.data?.totalAmount).toBe('0.00');
    expect(previewRes.body.data?.receiptTriggered).toBe(false);
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
    expect(detailRes.body.data?.items?.[0]?.qty_return ?? detailRes.body.data?.items?.[0]?.qtyReturn).toBe('20.0000');

    const shipRes = await request(BASE_URL)
      .put(`/api/return-orders/${returnOrderId}/ship`)
      .set(authHeader('warehouse'));

    expect(shipRes.status).toBe(200);

    const completeRes = await request(BASE_URL)
      .put(`/api/return-orders/${returnOrderId}/complete`)
      .set(authHeader('warehouse'));

    expect(completeRes.status).toBe(200);
  });

  test('Step 6: 验证库存保持不变', async () => {
    const res = await request(BASE_URL)
      .get(`/api/inventory/${SEEDED_SKU_ID}/available`)
      .set(authHeader('warehouse'));

    expect(res.status).toBe(200);
    const stockQtyAfter = parseFloat(res.body.data?.qtyAvailable ?? '0');
    expect(stockQtyAfter).toBe(stockQtyBefore);
  });

  test('Step 7: 验证采购订单仍为 confirmed', async () => {
    const res = await request(BASE_URL)
      .get(`/api/purchase/orders/${poId}`)
      .set(authHeader('purchaser'));

    expect(res.status).toBe(200);
    expect(res.body.data?.status).toBe('confirmed');
  });

  test('Step 8: 无法执行三单匹配，因为没有入库单', async () => {
    const matchRes = await request(BASE_URL)
      .post('/api/purchase/three-way-match')
      .set(authHeader('purchaser'))
      .send({
        poId,
        deliveryNoteId,
      });

    expect(matchRes.status).toBe(400);
  });
});
