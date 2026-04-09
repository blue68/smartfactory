import type { APIRequestContext } from '@playwright/test';
import mysql, { type Pool, type RowDataPacket } from '../../services/api/node_modules/mysql2/promise';
import {
  APP_BASE_URL,
  seedAuth,
  authHeaders,
  apiUrl,
  closePurchaseFlowDbPool,
  createScenario,
  prepareInspectionItems,
  type PurchaseScenario,
  type SeededFixture,
} from './purchaseFlow';

export { APP_BASE_URL, seedAuth };

const TEST_TENANT_ID = 9999;
const DB_HOST = process.env.DB_HOST ?? '127.0.0.1';
const DB_PORT = Number(process.env.DB_PORT ?? '3307');
const DB_USER = process.env.DB_USER ?? 'sf_app';
const DB_PASS = process.env.DB_PASS ?? process.env.DB_PASSWORD ?? 'TestApp2026!Secure';
const DB_NAME = process.env.DB_NAME ?? 'smart_factory';

let dbPool: Pool | null = null;

async function parseApiData<T>(response: Awaited<ReturnType<APIRequestContext['get']>>): Promise<T> {
  const text = await response.text();
  const json = text ? JSON.parse(text) : {};
  if (!response.ok()) {
    throw new Error(json?.message ?? `HTTP ${response.status()}`);
  }
  if (json?.code !== 0) {
    throw new Error(json?.message ?? `API ${response.status()}`);
  }
  return json.data as T;
}

export interface IncomingInspectionCreateSnapshot {
  inspectionId: number;
  inspectionNo: string;
  status: string;
  poNo: string;
  supplierName: string;
}

export interface IncomingInspectionSubmitScenario extends PurchaseScenario {
  expectedReceiptQty: string;
  expectedRejectedQty: string;
  expectedInventoryQtyOnHand: string;
}

export interface IncomingInspectionRollMeterScenario extends PurchaseScenario {
  segmentDyeLots: [string, string];
  segmentMeters: [string, string];
  expectedInventoryQtyOnHand: string;
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

async function hasTable(tableName: string): Promise<boolean> {
  const pool = getDbPool();
  const [rows] = await pool.query<Array<RowDataPacket & { total: number }>>(
    `SELECT COUNT(*) AS total
     FROM information_schema.tables
     WHERE table_schema = DATABASE()
       AND table_name = ?`,
    [tableName],
  );
  return Number(rows[0]?.total ?? 0) > 0;
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
      throw new Error('Timed out while polling incoming inspection flow data');
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

export async function closeIncomingInspectionFlowDbPool(): Promise<void> {
  if (dbPool) {
    const pool = dbPool;
    dbPool = null;
    await pool.end();
  }
  await closePurchaseFlowDbPool();
}

export async function seedIncomingInspectionCreateScenario(
  api: APIRequestContext,
): Promise<PurchaseScenario> {
  return createScenario(api, 'delivery_only') as Promise<PurchaseScenario>;
}

export async function seedIncomingInspectionSubmitScenario(
  api: APIRequestContext,
): Promise<IncomingInspectionSubmitScenario> {
  const scenario = await createScenario(api, 'inspection_only') as PurchaseScenario;
  await prepareInspectionItems(api, scenario.inspectionId, 'partial_return');
  return {
    ...scenario,
    expectedReceiptQty: '12.0000',
    expectedRejectedQty: '8.0000',
    expectedInventoryQtyOnHand: '12.0000',
  };
}

async function ensureRollMeterDyeLotFixture(): Promise<SeededFixture> {
  const pool = getDbPool();
  const suffix = `${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 10)}`;
  const supplierId = Number(`93${suffix}`);
  const skuId = Number(`94${suffix}`);
  const supplierCode = `SUP-ROLL-${suffix}`;
  const supplierName = `Playwright面料供应商-${suffix}`;
  const skuCode = `RM-PW-${suffix}`;
  const skuName = `Playwright棉麻混纺-${suffix}`;

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
    [supplierId, TEST_TENANT_ID, supplierCode, supplierName, skuId, 99001, 99001],
  );

  await pool.execute(
    `INSERT INTO skus
       (id, tenant_id, sku_code, name, category1_id, category2_id,
        stock_unit, purchase_unit, production_unit, has_dye_lot, use_fifo,
        safety_stock, status, created_by, updated_by)
     VALUES (?, ?, ?, ?, 1, 1, '米', '卷', '米', 1, 1, 0, 'active', ?, ?)
     ON DUPLICATE KEY UPDATE
       sku_code = VALUES(sku_code),
       name = VALUES(name),
       stock_unit = VALUES(stock_unit),
       purchase_unit = VALUES(purchase_unit),
       production_unit = VALUES(production_unit),
       has_dye_lot = VALUES(has_dye_lot),
       status = VALUES(status),
       updated_by = VALUES(updated_by)`,
    [skuId, TEST_TENANT_ID, skuCode, skuName, 99001, 99001],
  );

  await pool.execute(
    `DELETE FROM inventory_transactions
     WHERE tenant_id = ? AND sku_id = ?`,
    [TEST_TENANT_ID, skuId],
  );
  await pool.execute(
    `DELETE FROM inventory_daily_snapshots
     WHERE tenant_id = ? AND sku_id = ?`,
    [TEST_TENANT_ID, skuId],
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
    [TEST_TENANT_ID, skuId],
  );

  return { supplierId, skuId, supplierCode, supplierName, skuCode, skuName };
}

export async function seedIncomingInspectionRollMeterScenario(
  api: APIRequestContext,
): Promise<IncomingInspectionRollMeterScenario> {
  const fixture = await ensureRollMeterDyeLotFixture();
  const segmentDyeLots: [string, string] = ['DL-PW-ROLL-A', 'DL-PW-ROLL-B'];
  const segmentMeters: [string, string] = ['47.3000', '48.2000'];

  const orderResponse = await api.post(apiUrl('/purchase/orders'), {
    headers: authHeaders('boss'),
    data: {
      supplierId: fixture.supplierId,
      expectedDate: new Date(Date.now() + 10 * 24 * 3600 * 1000).toISOString().slice(0, 10),
      items: [
        {
          skuId: fixture.skuId,
          qtyOrdered: '2',
          purchaseUnit: '卷',
          unitPrice: '88.00',
        },
      ],
    },
  });
  const orderData = await parseApiData<{ id: number; poNo: string }>(orderResponse);

  const deliveryResponse = await api.post(apiUrl(`/purchase/orders/${orderData.id}/delivery`), {
    headers: authHeaders('boss'),
    data: {
      poId: orderData.id,
      deliveryDate: new Date().toISOString().slice(0, 10),
      items: [
        {
          skuId: fixture.skuId,
          qtyDelivered: '2',
          purchaseUnit: '卷',
          unitPrice: '88.00',
          dyeLotNo: 'DL-PW-SEED',
        },
      ],
    },
  });
  const deliveryData = await parseApiData<{ id: number; deliveryNo: string }>(deliveryResponse);

  const inspectionResponse = await api.post(apiUrl('/incoming-inspections'), {
    headers: authHeaders('boss'),
    data: {
      poId: orderData.id,
      deliveryNoteId: deliveryData.id,
      inspectionDate: new Date().toISOString().slice(0, 10),
      notes: 'Playwright 卷转米质检造数',
    },
  });
  const inspectionData = await parseApiData<{ id: number; inspectionNo: string }>(inspectionResponse);

  return {
    fixture,
    poId: Number(orderData.id),
    poNo: String(orderData.poNo),
    deliveryId: Number(deliveryData.id),
    deliveryNo: String(deliveryData.deliveryNo),
    inspectionId: Number(inspectionData.id),
    inspectionNo: String(inspectionData.inspectionNo),
    receiptId: null,
    receiptNo: null,
    returnOrderId: null,
    returnNo: null,
    segmentDyeLots,
    segmentMeters,
    expectedInventoryQtyOnHand: '95.5000',
  };
}

export async function waitForIncomingInspectionCreated(
  scenario: Pick<PurchaseScenario, 'deliveryId'>,
): Promise<IncomingInspectionCreateSnapshot> {
  const pool = getDbPool();

  return poll(async () => {
    const [rows] = await pool.query<Array<RowDataPacket & {
      inspection_id: number;
      inspection_no: string;
      status: string;
      po_no: string;
      supplier_name: string | null;
    }>>(
      `SELECT
         r.id AS inspection_id,
         r.inspection_no,
         r.status,
         po.po_no,
         sup.name AS supplier_name
       FROM incoming_inspection_records r
       INNER JOIN purchase_orders po
         ON po.id = r.po_id
        AND po.tenant_id = r.tenant_id
       LEFT JOIN suppliers sup
         ON sup.id = po.supplier_id
        AND sup.tenant_id = po.tenant_id
       WHERE r.tenant_id = ? AND r.delivery_note_id = ?
       ORDER BY r.id DESC
       LIMIT 1`,
      [TEST_TENANT_ID, scenario.deliveryId],
    );

    const row = rows[0];
    if (!row) return null;

    return {
      inspectionId: Number(row.inspection_id),
      inspectionNo: String(row.inspection_no),
      status: String(row.status),
      poNo: String(row.po_no),
      supplierName: String(row.supplier_name ?? ''),
    };
  });
}

export async function waitForIncomingInspectionSubmitted(
  scenario: IncomingInspectionSubmitScenario,
): Promise<{
  status: string;
  overallResult: string | null;
  receiptTriggered: boolean;
  returnTriggered: boolean;
  receiptId: number;
  receiptNo: string;
  returnId: number;
  returnNo: string;
  inventoryQtyOnHand: string;
  qtyReceived: string;
  qtyRejected: string;
}> {
  const pool = getDbPool();

  return poll(async () => {
    const [rows] = await pool.query<Array<RowDataPacket & {
      status: string;
      overall_result: string | null;
      receipt_triggered: number;
      return_triggered: number;
      receipt_id: number | null;
      receipt_no: string | null;
      return_id: number | null;
      return_no: string | null;
      qty_on_hand: string | null;
      qty_received: string | null;
      qty_rejected: string | null;
    }>>(
      `SELECT
         r.status,
         r.overall_result,
         r.receipt_triggered,
         r.return_triggered,
         dn.receipt_id,
         pr.receipt_no,
         ro.id AS return_id,
         ro.return_no,
         inv.qty_on_hand,
         poi.qty_received,
         poi.qty_rejected
       FROM incoming_inspection_records r
       LEFT JOIN delivery_notes dn
         ON dn.id = r.delivery_note_id
        AND dn.tenant_id = r.tenant_id
       LEFT JOIN purchase_receipts pr
         ON pr.id = dn.receipt_id
        AND pr.tenant_id = r.tenant_id
       LEFT JOIN return_orders ro
         ON ro.source_inspection_id = r.id
        AND ro.tenant_id = r.tenant_id
       LEFT JOIN inventory inv
         ON inv.sku_id = ?
        AND inv.tenant_id = r.tenant_id
       LEFT JOIN purchase_order_items poi
         ON poi.po_id = r.po_id
        AND poi.sku_id = ?
        AND poi.tenant_id = r.tenant_id
       WHERE r.tenant_id = ? AND r.id = ?
       LIMIT 1`,
      [scenario.fixture.skuId, scenario.fixture.skuId, TEST_TENANT_ID, scenario.inspectionId],
    );

    const row = rows[0];
    if (
      !row
      || row.status !== 'partially_passed'
      || !row.receipt_id
      || !row.receipt_no
      || !row.return_id
      || !row.return_no
    ) {
      return null;
    }

    return {
      status: String(row.status),
      overallResult: row.overall_result ? String(row.overall_result) : null,
      receiptTriggered: Boolean(row.receipt_triggered),
      returnTriggered: Boolean(row.return_triggered),
      receiptId: Number(row.receipt_id),
      receiptNo: String(row.receipt_no),
      returnId: Number(row.return_id),
      returnNo: String(row.return_no),
      inventoryQtyOnHand: String(row.qty_on_hand ?? '0'),
      qtyReceived: String(row.qty_received ?? '0'),
      qtyRejected: String(row.qty_rejected ?? '0'),
    };
  });
}

export async function waitForIncomingInspectionRollMeterSubmitted(
  scenario: IncomingInspectionRollMeterScenario,
): Promise<{
  status: string;
  overallResult: string | null;
  receiptTriggered: boolean;
  receiptId: number;
  receiptNo: string;
  inventoryQtyOnHand: string;
  inspectionItems: Array<{ dyeLotNo: string; qtyPassed: string; acceptedStockQty: string }>;
  receiptItems: Array<{ dyeLotNo: string; qtyReceived: string; purchaseUnit: string }>;
}> {
  const pool = getDbPool();
  const receiptItemsTableSupported = await hasTable('purchase_receipt_items');

  return poll(async () => {
    const [rows] = await pool.query<Array<RowDataPacket & {
      status: string;
      overall_result: string | null;
      receipt_triggered: number;
      receipt_id: number | null;
      receipt_no: string | null;
      qty_on_hand: string | null;
    }>>(
      `SELECT
         r.status,
         r.overall_result,
         r.receipt_triggered,
         dn.receipt_id,
         pr.receipt_no,
         inv.qty_on_hand
       FROM incoming_inspection_records r
       LEFT JOIN delivery_notes dn
         ON dn.id = r.delivery_note_id
        AND dn.tenant_id = r.tenant_id
       LEFT JOIN purchase_receipts pr
         ON pr.id = dn.receipt_id
        AND pr.tenant_id = r.tenant_id
       LEFT JOIN inventory inv
         ON inv.sku_id = ?
        AND inv.tenant_id = r.tenant_id
       WHERE r.tenant_id = ? AND r.id = ?
       LIMIT 1`,
      [scenario.fixture.skuId, TEST_TENANT_ID, scenario.inspectionId],
    );

    const row = rows[0];
    if (
      !row
      || row.status !== 'passed'
      || !row.receipt_id
      || !row.receipt_no
      || String(row.qty_on_hand ?? '0') !== scenario.expectedInventoryQtyOnHand
    ) {
      return null;
    }

    const [inspectionItemRows] = await pool.query<Array<RowDataPacket & {
      dye_lot_no: string | null;
      qty_passed: string;
      accepted_stock_qty: string | null;
    }>>(
      `SELECT
         NULLIF(TRIM(dye_lot_no), '') AS dye_lot_no,
         CAST(qty_passed AS CHAR) AS qty_passed,
         CAST(accepted_stock_qty AS CHAR) AS accepted_stock_qty
       FROM incoming_inspection_items
       WHERE tenant_id = ? AND inspection_id = ?
       ORDER BY dye_lot_no ASC`,
      [TEST_TENANT_ID, scenario.inspectionId],
    );

    const receiptItemRows = receiptItemsTableSupported
      ? (await pool.query<Array<RowDataPacket & {
          dye_lot_no: string | null;
          qty_received: string;
          purchase_unit: string | null;
        }>>(
          `SELECT
             NULLIF(TRIM(dye_lot_no), '') AS dye_lot_no,
             CAST(qty_received AS CHAR) AS qty_received,
             purchase_unit
           FROM purchase_receipt_items
           WHERE tenant_id = ? AND receipt_id = ?
           ORDER BY dye_lot_no ASC`,
          [TEST_TENANT_ID, Number(row.receipt_id)],
        ))[0]
      : [];

    if (inspectionItemRows.length !== 2 || (receiptItemsTableSupported && receiptItemRows.length !== 2)) {
      return null;
    }

    return {
      status: String(row.status),
      overallResult: row.overall_result ? String(row.overall_result) : null,
      receiptTriggered: Boolean(row.receipt_triggered),
      receiptId: Number(row.receipt_id),
      receiptNo: String(row.receipt_no),
      inventoryQtyOnHand: String(row.qty_on_hand ?? '0'),
      inspectionItems: inspectionItemRows.map((item) => ({
        dyeLotNo: String(item.dye_lot_no ?? ''),
        qtyPassed: String(item.qty_passed ?? '0'),
        acceptedStockQty: String(item.accepted_stock_qty ?? '0'),
      })),
      receiptItems: receiptItemRows.map((item) => ({
        dyeLotNo: String(item.dye_lot_no ?? ''),
        qtyReceived: String(item.qty_received ?? '0'),
        purchaseUnit: String(item.purchase_unit ?? ''),
      })),
    };
  });
}

export async function cleanupIncomingInspectionScenario(
  scenario: Pick<PurchaseScenario, 'fixture' | 'poId' | 'deliveryId' | 'inspectionId'>,
): Promise<void> {
  const pool = getDbPool();

  const [receiptRows] = await pool.query<Array<RowDataPacket & { id: number }>>(
    `SELECT id
     FROM purchase_receipts
     WHERE tenant_id = ? AND po_id = ?`,
    [TEST_TENANT_ID, scenario.poId],
  );
  const receiptIds = receiptRows.map((row) => Number(row.id));

  if (receiptIds.length > 0) {
    const placeholders = receiptIds.map(() => '?').join(', ');
    await pool.execute(
      `DELETE FROM inventory_transactions
       WHERE tenant_id = ? AND reference_type = 'purchase_receipt' AND reference_id IN (${placeholders})`,
      [TEST_TENANT_ID, ...receiptIds],
    );
    if (await hasTable('purchase_receipt_items')) {
      await pool.execute(
        `DELETE FROM purchase_receipt_items
         WHERE tenant_id = ? AND receipt_id IN (${placeholders})`,
        [TEST_TENANT_ID, ...receiptIds],
      );
    }
    await pool.execute(
      `DELETE FROM purchase_receipts
       WHERE tenant_id = ? AND id IN (${placeholders})`,
      [TEST_TENANT_ID, ...receiptIds],
    );
  }

  await pool.execute(
    `DELETE roi
     FROM return_order_items roi
     INNER JOIN return_orders ro
       ON ro.id = roi.return_id
      AND ro.tenant_id = roi.tenant_id
     WHERE roi.tenant_id = ? AND ro.source_inspection_id = ?`,
    [TEST_TENANT_ID, scenario.inspectionId],
  );
  await pool.execute(
    `DELETE FROM return_orders
     WHERE tenant_id = ? AND source_inspection_id = ?`,
    [TEST_TENANT_ID, scenario.inspectionId],
  );
  await pool.execute(
    `DELETE FROM inventory_daily_snapshots
     WHERE tenant_id = ? AND sku_id = ?`,
    [TEST_TENANT_ID, scenario.fixture.skuId],
  );
  await pool.execute(
    `DELETE FROM incoming_inspection_items
     WHERE tenant_id = ? AND inspection_id = ?`,
    [TEST_TENANT_ID, scenario.inspectionId],
  );
  await pool.execute(
    `DELETE FROM incoming_inspection_records
     WHERE tenant_id = ? AND id = ?`,
    [TEST_TENANT_ID, scenario.inspectionId],
  );
  await pool.execute(
    `UPDATE delivery_notes
     SET inspection_id = NULL, receipt_id = NULL
     WHERE tenant_id = ? AND id = ?`,
    [TEST_TENANT_ID, scenario.deliveryId],
  );
  await pool.execute(
    `DELETE FROM delivery_note_items
     WHERE tenant_id = ? AND delivery_note_id = ?`,
    [TEST_TENANT_ID, scenario.deliveryId],
  );
  await pool.execute(
    `DELETE FROM delivery_notes
     WHERE tenant_id = ? AND id = ?`,
    [TEST_TENANT_ID, scenario.deliveryId],
  );
  await pool.execute(
    `DELETE FROM purchase_order_items
     WHERE tenant_id = ? AND po_id = ?`,
    [TEST_TENANT_ID, scenario.poId],
  );
  await pool.execute(
    `DELETE FROM purchase_orders
     WHERE tenant_id = ? AND id = ?`,
    [TEST_TENANT_ID, scenario.poId],
  );
  await pool.execute(
    `DELETE FROM inventory
     WHERE tenant_id = ? AND sku_id = ?`,
    [TEST_TENANT_ID, scenario.fixture.skuId],
  );
  await pool.execute(
    `DELETE FROM skus
     WHERE tenant_id = ? AND id = ?`,
    [TEST_TENANT_ID, scenario.fixture.skuId],
  );
  await pool.execute(
    `DELETE FROM suppliers
     WHERE tenant_id = ? AND id = ?`,
    [TEST_TENANT_ID, scenario.fixture.supplierId],
  );
}
