import request from 'supertest';
import mysql, { Pool, RowDataPacket } from 'mysql2/promise';
import { authHeader } from '../helpers/testAuth';

const BASE_URL = process.env.TEST_API_URL ?? 'http://localhost:3000';

jest.setTimeout(60000);

const TEST_TENANT_ID = 9999;
const SEEDED_SKU_ID = 991101;
const SEEDED_ORDER_ID = 991102;
const SEEDED_ORDER_ITEM_ID = 991103;
const SNAPSHOT_DATE = new Date().toISOString().slice(0, 10);

let dbPool: Pool | null = null;

interface InventoryRow extends RowDataPacket {
  qty_on_hand: string;
  qty_reserved: string;
}

interface SnapshotRow extends RowDataPacket {
  snapshot_date: string;
  qty_on_hand: string;
  qty_reserved: string;
  qty_available: string;
}

interface SalesOrderItemRow extends RowDataPacket {
  qty_delivered: string;
}

interface InventoryTxRow extends RowDataPacket {
  transaction_type: string;
  direction: string;
  qty_stock_unit: string;
  reference_type: string;
  reference_id: number;
  reference_no: string;
}

interface SettlementRow extends RowDataPacket {
  status: string;
  paid_amount: string;
  total_amount: string;
  invoice_no: string | null;
}

interface DeliveryStatusRow extends RowDataPacket {
  status: string;
}

interface SalesOrderStatusRow extends RowDataPacket {
  status: string;
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

describe('E2E: 销售发货库存主链路', () => {
  let stockQtyBefore = 0;
  let deliveryId = 0;
  let deliveryNo = '';
  let settlementId = 0;

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
      `INSERT INTO customers
         (id, tenant_id, code, name, status, grade, created_by, updated_by)
       VALUES (1, ?, 'CUS-E2E-SALES-SHIP', 'E2E销售客户', 'active', 'A', 99007, 99007)
       ON DUPLICATE KEY UPDATE
         code = VALUES(code),
         name = VALUES(name),
         status = VALUES(status),
         grade = VALUES(grade),
         updated_by = VALUES(updated_by)`,
      [TEST_TENANT_ID],
    );

    await pool.execute(
      `DELETE sp
       FROM sales_payments sp
       INNER JOIN sales_settlements ss
          ON ss.tenant_id = sp.tenant_id AND ss.id = sp.settlement_id
       WHERE ss.tenant_id = ? AND ss.order_id = ?`,
      [TEST_TENANT_ID, SEEDED_ORDER_ID],
    );
    await pool.execute(
      'DELETE FROM sales_settlements WHERE tenant_id = ? AND order_id = ?',
      [TEST_TENANT_ID, SEEDED_ORDER_ID],
    );

    await pool.execute(
      `DELETE sdi
       FROM sales_delivery_items sdi
       INNER JOIN sales_deliveries sd
          ON sd.tenant_id = sdi.tenant_id AND sd.id = sdi.delivery_id
       WHERE sd.tenant_id = ? AND sd.order_id = ?`,
      [TEST_TENANT_ID, SEEDED_ORDER_ID],
    );
    await pool.execute(
      'DELETE FROM sales_deliveries WHERE tenant_id = ? AND order_id = ?',
      [TEST_TENANT_ID, SEEDED_ORDER_ID],
    );
    await pool.execute(
      `DELETE FROM inventory_transactions
       WHERE tenant_id = ? AND sku_id = ? AND reference_type = 'sales_delivery'`,
      [TEST_TENANT_ID, SEEDED_SKU_ID],
    );
    await pool.execute(
      'DELETE FROM sales_order_items WHERE tenant_id = ? AND order_id = ?',
      [TEST_TENANT_ID, SEEDED_ORDER_ID],
    );
    await pool.execute(
      'DELETE FROM sales_orders WHERE tenant_id = ? AND id = ?',
      [TEST_TENANT_ID, SEEDED_ORDER_ID],
    );
    await pool.execute(
      'DELETE FROM inventory_daily_snapshots WHERE tenant_id = ? AND sku_id = ?',
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
       VALUES (?, ?, 'SKU-E2E-SALES-SHIP', 'E2E销售发货物料', 1, 1, 'pcs', 'pcs', 'pcs', 0, 1, 0, 'active', 99001, 99001)`,
      [SEEDED_SKU_ID, TEST_TENANT_ID],
    );

    await pool.execute(
      `INSERT INTO inventory
         (tenant_id, sku_id, qty_on_hand, qty_reserved, qty_in_transit, last_in_at)
       VALUES (?, ?, 10, 0, 0, NOW(3))`,
      [TEST_TENANT_ID, SEEDED_SKU_ID],
    );

    await pool.execute(
      `INSERT INTO sales_orders
         (id, tenant_id, order_no, customer_id, order_type, status, priority,
          expected_delivery, total_amount, constraint_passed, approval_status,
          sales_person_id, notes, created_by, updated_by)
       VALUES (?, ?, 'SO-E2E-SALES-SHIP', 1, 'normal', 'in_production', 80,
               ?, 528.00, 1, 'approved', 99007, 'E2E销售发货链路测试', 99007, 99007)`,
      [SEEDED_ORDER_ID, TEST_TENANT_ID, SNAPSHOT_DATE],
    );

    await pool.execute(
      `INSERT INTO sales_order_items
         (id, tenant_id, order_id, sku_id, qty_ordered, qty, qty_delivered,
          unit_price, amount, bom_header_id, created_by, updated_by)
       VALUES (?, ?, ?, ?, 6.0000, 6.0000, 0.0000, 88.0000, 528.00, 1, 99007, 99007)`,
      [SEEDED_ORDER_ITEM_ID, TEST_TENANT_ID, SEEDED_ORDER_ID, SEEDED_SKU_ID],
    );
  });

  afterAll(async () => {
    await dbPool?.end();
    dbPool = null;
  });

  test('Step 0: 预热库存快照并记录发货前库存', async () => {
    const rebuildRes = await request(BASE_URL)
      .post('/api/inventory/snapshots/rebuild')
      .set(authHeader('supervisor'))
      .send({
        skuId: SEEDED_SKU_ID,
        snapshotDate: SNAPSHOT_DATE,
        dryRun: false,
      });
    expect(rebuildRes.status).toBe(200);

    const stockRes = await request(BASE_URL)
      .get(`/api/inventory/${SEEDED_SKU_ID}/available`)
      .set(authHeader('warehouse'));

    expect(stockRes.status).toBe(200);
    expect(stockRes.body.data?.qtyOnHand).toBe('10.0000');
    expect(stockRes.body.data?.qtyReserved).toBe('0.0000');
    expect(stockRes.body.data?.qtyAvailable).toBe('10.0000');
    stockQtyBefore = Number(stockRes.body.data?.qtyAvailable ?? 0);
  });

  test('Step 1: 仓库发货，创建 delivery 并返回 shipped 状态', async () => {
    const shipRes = await request(BASE_URL)
      .post(`/api/sales/orders/${SEEDED_ORDER_ID}/ship`)
      .set(authHeader('warehouse'))
      .send({
        trackingNo: 'TRACK-E2E-SALES-SHIP',
        shippedItems: [
          {
            orderItemId: SEEDED_ORDER_ITEM_ID,
            shippedQty: 6,
          },
        ],
      });

    expect(shipRes.status).toBe(200);
    expect(shipRes.body.code).toBe(0);

    deliveryId = Number(shipRes.body.data?.deliveryId ?? 0);
    deliveryNo = String(shipRes.body.data?.deliveryNo ?? '');

    expect(deliveryId).toBeGreaterThan(0);
    expect(deliveryNo).toMatch(/^(DL|DO)/);
    expect(shipRes.body.data?.orderStatus).toBe('shipped');
  });

  test('Step 2: 验证发货出库流水、库存扣减与订单行累计发货', async () => {
    const pool = getDbPool();

    const [inventoryRows] = await pool.query<InventoryRow[]>(
      `SELECT qty_on_hand, qty_reserved
       FROM inventory
       WHERE tenant_id = ? AND sku_id = ?
       LIMIT 1`,
      [TEST_TENANT_ID, SEEDED_SKU_ID],
    );
    expect(inventoryRows).toHaveLength(1);
    expect(Number(inventoryRows[0].qty_on_hand)).toBeCloseTo(stockQtyBefore - 6);
    expect(Number(inventoryRows[0].qty_reserved)).toBeCloseTo(0);

    const [itemRows] = await pool.query<SalesOrderItemRow[]>(
      `SELECT qty_delivered
       FROM sales_order_items
       WHERE tenant_id = ? AND id = ?
       LIMIT 1`,
      [TEST_TENANT_ID, SEEDED_ORDER_ITEM_ID],
    );
    expect(itemRows).toHaveLength(1);
    expect(Number(itemRows[0].qty_delivered)).toBeCloseTo(6);

    const [txRows] = await pool.query<InventoryTxRow[]>(
      `SELECT transaction_type, direction, qty_stock_unit, reference_type, reference_id, reference_no
       FROM inventory_transactions
       WHERE tenant_id = ? AND sku_id = ? AND reference_type = 'sales_delivery' AND reference_id = ?
       ORDER BY id DESC
       LIMIT 1`,
      [TEST_TENANT_ID, SEEDED_SKU_ID, deliveryId],
    );
    expect(txRows).toHaveLength(1);
    expect(txRows[0].transaction_type).toBe('DELIVERY_OUT');
    expect(txRows[0].direction).toBe('OUT');
    expect(Number(txRows[0].qty_stock_unit)).toBeCloseTo(6);
    expect(txRows[0].reference_type).toBe('sales_delivery');
    expect(Number(txRows[0].reference_id)).toBe(deliveryId);
    expect(txRows[0].reference_no).toBe(deliveryNo);
  });

  test('Step 3: 验证日结快照与可用库存读取同步更新', async () => {
    const pool = getDbPool();
    const [snapshotRows] = await pool.query<SnapshotRow[]>(
      `SELECT snapshot_date, qty_on_hand, qty_reserved, qty_available
       FROM inventory_daily_snapshots
       WHERE tenant_id = ? AND sku_id = ?
       ORDER BY snapshot_date DESC
       LIMIT 1`,
      [TEST_TENANT_ID, SEEDED_SKU_ID],
    );
    expect(snapshotRows).toHaveLength(1);
    expect(Number(snapshotRows[0].qty_on_hand)).toBeCloseTo(stockQtyBefore - 6);
    expect(Number(snapshotRows[0].qty_reserved)).toBeCloseTo(0);
    expect(Number(snapshotRows[0].qty_available)).toBeCloseTo(stockQtyBefore - 6);

    const stockRes = await request(BASE_URL)
      .get(`/api/inventory/${SEEDED_SKU_ID}/available`)
      .set(authHeader('warehouse'));

    expect(stockRes.status).toBe(200);
    expect(stockRes.body.data?.qtyOnHand).toBe('4.0000');
    expect(stockRes.body.data?.qtyReserved).toBe('0.0000');
    expect(stockRes.body.data?.qtyAvailable).toBe('4.0000');
  });

  test('Step 4: 销售确认收货后，发货单置为 received 且订单置为 completed', async () => {
    const confirmRes = await request(BASE_URL)
      .post(`/api/sales/orders/${SEEDED_ORDER_ID}/deliveries/${deliveryId}/confirm`)
      .set(authHeader('boss'))
      .send({});

    expect(confirmRes.status).toBe(200);
    expect(confirmRes.body.code).toBe(0);
    expect(confirmRes.body.data?.orderCompleted).toBe(true);
    expect(confirmRes.body.data?.orderStatus).toBe('completed');

    const pool = getDbPool();
    const [deliveryRows] = await pool.query<DeliveryStatusRow[]>(
      `SELECT status
       FROM sales_deliveries
       WHERE tenant_id = ? AND id = ?
       LIMIT 1`,
      [TEST_TENANT_ID, deliveryId],
    );
    expect(deliveryRows).toHaveLength(1);
    expect(deliveryRows[0].status).toBe('received');

    const [orderRows] = await pool.query<SalesOrderStatusRow[]>(
      `SELECT status
       FROM sales_orders
       WHERE tenant_id = ? AND id = ?
       LIMIT 1`,
      [TEST_TENANT_ID, SEEDED_ORDER_ID],
    );
    expect(orderRows).toHaveLength(1);
    expect(orderRows[0].status).toBe('completed');
  });

  test('Step 5: 创建结算单并录入部分付款，应收汇总包含该结算单', async () => {
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 7);

    const settlementRes = await request(BASE_URL)
      .post(`/api/sales/orders/${SEEDED_ORDER_ID}/settlement`)
      .set(authHeader('boss'))
      .send({
        dueDate: dueDate.toISOString().slice(0, 10),
        notes: 'E2E 结算单',
      });

    expect(settlementRes.status).toBe(201);
    expect(settlementRes.body.code).toBe(0);
    settlementId = Number(settlementRes.body.data?.settlementId ?? 0);
    expect(settlementId).toBeGreaterThan(0);
    expect(String(settlementRes.body.data?.settlementNo ?? '')).toMatch(/^ST/);

    const partialPayRes = await request(BASE_URL)
      .post(`/api/sales/orders/settlements/${settlementId}/payments`)
      .set(authHeader('boss'))
      .send({
        paymentAmount: '2.00',
        paymentDate: SNAPSHOT_DATE,
        paymentMethod: 'bank_transfer',
        referenceNo: 'PAY-E2E-1',
      });

    expect(partialPayRes.status).toBe(200);
    expect(partialPayRes.body.code).toBe(0);
    expect(partialPayRes.body.data?.settlementStatus).toBe('partial_paid');

    const pool = getDbPool();
    const [settlementRows] = await pool.query<SettlementRow[]>(
      `SELECT status, paid_amount, total_amount, invoice_no
       FROM sales_settlements
       WHERE tenant_id = ? AND id = ?
       LIMIT 1`,
      [TEST_TENANT_ID, settlementId],
    );
    expect(settlementRows).toHaveLength(1);
    expect(settlementRows[0].status).toBe('partial_paid');
    expect(Number(settlementRows[0].paid_amount)).toBeCloseTo(2);
    expect(Number(settlementRows[0].total_amount)).toBeCloseTo(528);
    expect(settlementRows[0].invoice_no).toBeNull();

    const receivablesRes = await request(BASE_URL)
      .get('/api/sales/orders/receivables')
      .set(authHeader('boss'));

    expect(receivablesRes.status).toBe(200);
    expect(receivablesRes.body.code).toBe(0);
    const settlements: any[] = receivablesRes.body.data?.settlements ?? [];
    const found = settlements.find((item: any) => Number(item.id) === settlementId);
    expect(found).toBeTruthy();
  });

  test('Step 6: 补齐尾款并登记开票，结算单应变为 paid', async () => {
    const payAllRes = await request(BASE_URL)
      .post(`/api/sales/orders/settlements/${settlementId}/payments`)
      .set(authHeader('boss'))
      .send({
        paymentAmount: '526.00',
        paymentDate: SNAPSHOT_DATE,
        paymentMethod: 'bank_transfer',
        referenceNo: 'PAY-E2E-2',
      });

    expect(payAllRes.status).toBe(200);
    expect(payAllRes.body.code).toBe(0);
    expect(payAllRes.body.data?.settlementStatus).toBe('paid');

    const invoiceRes = await request(BASE_URL)
      .put(`/api/sales/orders/settlements/${settlementId}/invoice`)
      .set(authHeader('boss'))
      .send({
        invoiceNo: 'INV-E2E-SALES-SHIP',
        invoiceDate: SNAPSHOT_DATE,
      });

    expect(invoiceRes.status).toBe(200);
    expect(invoiceRes.body.code).toBe(0);

    const pool = getDbPool();
    const [settlementRows] = await pool.query<SettlementRow[]>(
      `SELECT status, paid_amount, total_amount, invoice_no
       FROM sales_settlements
       WHERE tenant_id = ? AND id = ?
       LIMIT 1`,
      [TEST_TENANT_ID, settlementId],
    );
    expect(settlementRows).toHaveLength(1);
    expect(settlementRows[0].status).toBe('paid');
    expect(Number(settlementRows[0].paid_amount)).toBeCloseTo(528);
    expect(Number(settlementRows[0].total_amount)).toBeCloseTo(528);
    expect(settlementRows[0].invoice_no).toBe('INV-E2E-SALES-SHIP');
  });

  test('Step 7: 全额付款后应收汇总不再包含该结算单', async () => {
    const receivablesRes = await request(BASE_URL)
      .get('/api/sales/orders/receivables')
      .set(authHeader('boss'));

    expect(receivablesRes.status).toBe(200);
    expect(receivablesRes.body.code).toBe(0);
    const settlements: any[] = receivablesRes.body.data?.settlements ?? [];
    const found = settlements.find((item: any) => Number(item.id) === settlementId);
    expect(found).toBeFalsy();
  });
});
