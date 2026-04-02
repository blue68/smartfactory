import request from 'supertest';
import mysql, { Pool, RowDataPacket } from 'mysql2/promise';
import { authHeader } from '../helpers/testAuth';

const BASE_URL = process.env.TEST_API_URL ?? 'http://localhost:3000';
const TEST_TENANT_ID = 9999;

const SUPPLIER_ID = 996501;
const SKU_ID = 996601;
const PO_ID = 996701;
const PO_ITEM_ID = 996702;

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

describe('退货单模块 API 集成测试', () => {
  let createdReturnId = 0;
  let insufficientReturnId = 0;

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
      `INSERT INTO suppliers
        (id, tenant_id, code, name, status, created_by, updated_by)
       VALUES (?, ?, 'SUP-RETURN-INT', '退货集成供应商', 'active', 99001, 99001)
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
       VALUES (?, ?, 'SKU-RETURN-INT', '退货集成物料', 1, 1, '箱', '箱', '箱', 0, 1, 0, 'active', 99001, 99001)
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
       VALUES (?, ?, 10.0000, 2.0000, 0.0000, NOW(3))
       ON DUPLICATE KEY UPDATE
         qty_on_hand = 10.0000,
         qty_reserved = 2.0000,
         qty_in_transit = 0.0000,
         last_in_at = NOW(3)`,
      [TEST_TENANT_ID, SKU_ID],
    );

    await pool.execute(
      'DELETE FROM inventory_transactions WHERE tenant_id = ? AND sku_id = ? AND reference_type = ?',
      [TEST_TENANT_ID, SKU_ID, 'return_order'],
    );
    await pool.execute(
      'DELETE FROM inventory_daily_snapshots WHERE tenant_id = ? AND sku_id = ?',
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
       VALUES (?, ?, 'PO-RETURN-INT', ?, 'confirmed', 1320.00, '2026-06-30', '退货集成采购单', 99001, 99001)
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
       VALUES (?, ?, ?, ?, 15.0000, 10.0000, '箱', 88.0000, 1320.00, 99001, 99001)
       ON DUPLICATE KEY UPDATE
         qty_ordered = VALUES(qty_ordered),
         qty_received = VALUES(qty_received),
         purchase_unit = VALUES(purchase_unit),
         unit_price = VALUES(unit_price),
         amount = VALUES(amount),
         updated_by = VALUES(updated_by)`,
      [PO_ITEM_ID, TEST_TENANT_ID, PO_ID, SKU_ID],
    );
  });

  afterAll(async () => {
    await dbPool?.end();
    dbPool = null;
  });

  test('warehouse 可创建退货单，sales 无权创建，supervisor 可按关键字查询列表与详情', async () => {
    const deniedRes = await request(BASE_URL)
      .post('/api/return-orders')
      .set(authHeader('sales'))
      .send({
        returnType: 'purchase_return',
        sourcePoId: PO_ID,
        supplierId: SUPPLIER_ID,
        returnReason: '角色越权测试',
        items: [{
          skuId: SKU_ID,
          qtyReturn: '1.0000',
          purchaseUnit: '箱',
          unitPrice: '88.00',
        }],
      });

    expect(deniedRes.status).toBe(403);
    expect(deniedRes.body.code).toBe(1003);

    const createRes = await request(BASE_URL)
      .post('/api/return-orders')
      .set(authHeader('warehouse'))
      .send({
        returnType: 'purchase_return',
        sourcePoId: PO_ID,
        supplierId: SUPPLIER_ID,
        returnReason: '面料批次异常，退回供应商',
        notes: '手工创建退货单',
        items: [{
          skuId: SKU_ID,
          qtyReturn: '4.0000',
          purchaseUnit: '箱',
          unitPrice: '88.00',
          defectReason: '批次色差',
        }],
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.code).toBe(0);
    expect(createRes.body.data.returnNo).toMatch(/^RTN/);
    createdReturnId = Number(createRes.body.data.id);
    expect(createdReturnId).toBeGreaterThan(0);

    const listRes = await request(BASE_URL)
      .get('/api/return-orders?returnType=purchase_return&keyword=PO-RETURN-INT&page=1&pageSize=20')
      .set(authHeader('supervisor'));

    expect(listRes.status).toBe(200);
    expect(listRes.body.code).toBe(0);
    const createdOrder = (listRes.body.data?.list ?? []).find(
      (item: any) => Number(item.id) === createdReturnId,
    );
    expect(createdOrder).toBeTruthy();
    expect(createdOrder).toMatchObject({
      returnType: 'purchase_return',
      poNo: 'PO-RETURN-INT',
      supplierName: '退货集成供应商',
      status: 'draft',
      returnReason: '面料批次异常，退回供应商',
      totalQty: '4.0000',
    });

    const detailRes = await request(BASE_URL)
      .get(`/api/return-orders/${createdReturnId}`)
      .set(authHeader('warehouse'));

    expect(detailRes.status).toBe(200);
    expect(detailRes.body.code).toBe(0);
    expect(Number(detailRes.body.data.id)).toBe(createdReturnId);
    expect(detailRes.body.data.items).toHaveLength(1);
    expect(Number(detailRes.body.data.items[0].skuId)).toBe(SKU_ID);
    expect(detailRes.body.data.items[0]).toMatchObject({
      skuCode: 'SKU-RETURN-INT',
      skuName: '退货集成物料',
      qtyReturn: '4.0000',
      purchaseUnit: '箱',
      unitPrice: '88.0000',
      defectReason: '批次色差',
    });
  });

  test('supervisor 确认后，warehouse 发货会扣减库存并写流水/快照，随后可完成', async () => {
    const deniedConfirmRes = await request(BASE_URL)
      .put(`/api/return-orders/${createdReturnId}/confirm`)
      .set(authHeader('warehouse'));

    expect(deniedConfirmRes.status).toBe(403);
    expect(deniedConfirmRes.body.code).toBe(1003);

    const confirmRes = await request(BASE_URL)
      .put(`/api/return-orders/${createdReturnId}/confirm`)
      .set(authHeader('supervisor'));

    expect(confirmRes.status).toBe(200);
    expect(confirmRes.body.code).toBe(0);

    const shipRes = await request(BASE_URL)
      .put(`/api/return-orders/${createdReturnId}/ship`)
      .set(authHeader('warehouse'))
      .send({
        trackingNo: 'SF-RETURN-INT-001',
        notes: '已交承运商',
      });

    expect(shipRes.status).toBe(200);
    expect(shipRes.body.code).toBe(0);

    const completeRes = await request(BASE_URL)
      .put(`/api/return-orders/${createdReturnId}/complete`)
      .set(authHeader('boss'))
      .send({
        notes: '供应商已确认收货',
      });

    expect(completeRes.status).toBe(200);
    expect(completeRes.body.code).toBe(0);

    const pool = getDbPool();

    const [inventoryRows] = await pool.query<Array<RowDataPacket & { qty_on_hand: string; qty_reserved: string }>>(
      `SELECT qty_on_hand, qty_reserved
       FROM inventory
       WHERE tenant_id = ? AND sku_id = ?`,
      [TEST_TENANT_ID, SKU_ID],
    );
    expect(inventoryRows).toEqual([
      expect.objectContaining({
        qty_on_hand: '6.0000',
        qty_reserved: '2.0000',
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
       WHERE tenant_id = ? AND sku_id = ? AND reference_type = 'return_order'
       ORDER BY id DESC
       LIMIT 1`,
      [TEST_TENANT_ID, SKU_ID],
    );
    expect(txRows).toEqual([
      expect.objectContaining({
        transaction_type: 'PURCHASE_RETURN_OUT',
        direction: 'OUT',
        qty_input: '4.0000',
        qty_stock_unit: '4.0000',
        reference_type: 'return_order',
        reference_id: createdReturnId,
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
        qty_on_hand: '6.0000',
        qty_available: '4.0000',
      }),
    ]);

    const [returnRows] = await pool.query<Array<RowDataPacket & {
      status: string;
      notes: string | null;
      confirmed_at: string | null;
      shipped_at: string | null;
      completed_at: string | null;
    }>>(
      `SELECT status, notes, confirmed_at, shipped_at, completed_at
       FROM return_orders
       WHERE tenant_id = ? AND id = ?`,
      [TEST_TENANT_ID, createdReturnId],
    );
    expect(returnRows[0].status).toBe('completed');
    expect(returnRows[0].notes ?? '').toContain('物流单号：SF-RETURN-INT-001');
    expect(returnRows[0].notes ?? '').toContain('发出备注：已交承运商');
    expect(returnRows[0].notes ?? '').toContain('完成备注：供应商已确认收货');
    expect(returnRows[0].confirmed_at).toBeTruthy();
    expect(returnRows[0].shipped_at).toBeTruthy();
    expect(returnRows[0].completed_at).toBeTruthy();
  });

  test('可用库存不足时，confirmed 退货单发货会被拦截', async () => {
    const createRes = await request(BASE_URL)
      .post('/api/return-orders')
      .set(authHeader('warehouse'))
      .send({
        returnType: 'purchase_return',
        sourcePoId: PO_ID,
        supplierId: SUPPLIER_ID,
        returnReason: '超额退货测试',
        items: [{
          skuId: SKU_ID,
          qtyReturn: '5.0000',
          purchaseUnit: '箱',
          unitPrice: '88.00',
        }],
      });

    expect(createRes.status).toBe(201);
    insufficientReturnId = Number(createRes.body.data?.id);
    expect(insufficientReturnId).toBeGreaterThan(0);

    const confirmRes = await request(BASE_URL)
      .put(`/api/return-orders/${insufficientReturnId}/confirm`)
      .set(authHeader('boss'));

    expect(confirmRes.status).toBe(200);

    const shipRes = await request(BASE_URL)
      .put(`/api/return-orders/${insufficientReturnId}/ship`)
      .set(authHeader('warehouse'));

    expect(shipRes.status).toBe(409);
    expect(shipRes.body.message).toMatch(/库存不足/);
  });
});
