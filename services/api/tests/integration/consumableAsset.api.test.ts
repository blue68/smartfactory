import request from 'supertest';
import mysql, { Pool, RowDataPacket } from 'mysql2/promise';
import { authHeader } from '../helpers/testAuth';

const BASE_URL = process.env.TEST_API_URL ?? 'http://localhost:3000';
const TEST_TENANT_ID = 9999;

const SUPPLIER_ID = 996801;
const FIXED_ASSET_SKU_ID = 996811;
const CONSUMABLE_SKU_ID = 996812;
const PO_ID = 996821;
const PO_ITEM_ID = 996822;
const DELIVERY_NOTE_ID = 996831;
const DELIVERY_NOTE_ITEM_ID = 996832;
const RECEIPT_ID = 996841;
const RECEIPT_ITEM_ID = 996842;

const WAREHOUSE_ID = 996861;
const LOCATION_ID = 996862;
const ISSUE_ORDER_ID = 996871;
const ISSUE_ITEM_ID = 996872;
const REQUEST_DEPARTMENT_ID = 996881;

let dbPool: Pool | null = null;
let acceptedCardId = 0;
let supportsInventoryTxBusinessColumns = false;

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

async function hasColumn(pool: Pool, tableName: string, columnName: string): Promise<boolean> {
  const [rows] = await pool.query<Array<RowDataPacket & { cnt: number }>>(
    `SELECT COUNT(*) AS cnt
       FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = ?
        AND column_name = ?`,
    [tableName, columnName],
  );
  return Number(rows[0]?.cnt ?? 0) > 0;
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

describe('损耗品 / 固定资产 API 集成测试', () => {
  beforeAll(async () => {
    const pool = getDbPool();
    const supportsReceiptItemControlColumns = await hasColumn(pool, 'purchase_receipt_items', 'receipt_mode');
    supportsInventoryTxBusinessColumns = await hasColumn(pool, 'inventory_transactions', 'business_class');
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
        (99003, ?, 'test_warehouse', 'integration-password', '测试仓库', 'active', 99001, 99001),
        (99004, ?, 'test_supervisor', 'integration-password', '测试主管', 'active', 99001, 99001)
       ON DUPLICATE KEY UPDATE
         username = VALUES(username),
         real_name = VALUES(real_name),
         status = VALUES(status),
         updated_by = VALUES(updated_by)`,
      [TEST_TENANT_ID, TEST_TENANT_ID, TEST_TENANT_ID],
    );

    await pool.execute(
      `DELETE am
       FROM asset_movements am
       INNER JOIN asset_cards ac ON ac.id = am.asset_card_id AND ac.tenant_id = am.tenant_id
       WHERE am.tenant_id = ? AND ac.receipt_item_id = ?`,
      [TEST_TENANT_ID, RECEIPT_ITEM_ID],
    );
    await pool.execute(
      'DELETE FROM asset_cards WHERE tenant_id = ? AND receipt_item_id = ?',
      [TEST_TENANT_ID, RECEIPT_ITEM_ID],
    );
    await pool.execute(
      'DELETE FROM consumable_issue_items WHERE tenant_id = ? AND issue_order_id = ?',
      [TEST_TENANT_ID, ISSUE_ORDER_ID],
    );
    await pool.execute(
      'DELETE FROM consumable_issue_orders WHERE tenant_id = ? AND id = ?',
      [TEST_TENANT_ID, ISSUE_ORDER_ID],
    );
    await pool.execute(
      `DELETE FROM inventory_transactions
       WHERE tenant_id = ?
         AND (
           (reference_type = 'consumable_issue_order' AND reference_id = ?)
           OR sku_id IN (?, ?)
         )`,
      [TEST_TENANT_ID, ISSUE_ORDER_ID, FIXED_ASSET_SKU_ID, CONSUMABLE_SKU_ID],
    );
    await pool.execute(
      `DELETE FROM inventory_daily_snapshots
       WHERE tenant_id = ? AND sku_id IN (?, ?)`,
      [TEST_TENANT_ID, FIXED_ASSET_SKU_ID, CONSUMABLE_SKU_ID],
    );
    await pool.execute(
      `DELETE FROM inventory
       WHERE tenant_id = ? AND sku_id IN (?, ?)`,
      [TEST_TENANT_ID, FIXED_ASSET_SKU_ID, CONSUMABLE_SKU_ID],
    );
    await pool.execute(
      'DELETE FROM locations WHERE tenant_id = ? AND id = ?',
      [TEST_TENANT_ID, LOCATION_ID],
    );
    await pool.execute(
      'DELETE FROM warehouses WHERE tenant_id = ? AND id = ?',
      [TEST_TENANT_ID, WAREHOUSE_ID],
    );
    await pool.execute(
      'DELETE FROM purchase_receipt_items WHERE tenant_id = ? AND receipt_id = ?',
      [TEST_TENANT_ID, RECEIPT_ID],
    );
    await pool.execute(
      'DELETE FROM purchase_receipts WHERE tenant_id = ? AND id = ?',
      [TEST_TENANT_ID, RECEIPT_ID],
    );
    await pool.execute(
      'DELETE FROM delivery_note_items WHERE tenant_id = ? AND id = ?',
      [TEST_TENANT_ID, DELIVERY_NOTE_ITEM_ID],
    );
    await pool.execute(
      'DELETE FROM delivery_notes WHERE tenant_id = ? AND id = ?',
      [TEST_TENANT_ID, DELIVERY_NOTE_ID],
    );
    await pool.execute(
      'DELETE FROM purchase_order_items WHERE tenant_id = ? AND id = ?',
      [TEST_TENANT_ID, PO_ITEM_ID],
    );
    await pool.execute(
      'DELETE FROM purchase_orders WHERE tenant_id = ? AND id = ?',
      [TEST_TENANT_ID, PO_ID],
    );
    await pool.execute(
      'DELETE FROM sku_asset_profiles WHERE tenant_id = ? AND sku_id = ?',
      [TEST_TENANT_ID, FIXED_ASSET_SKU_ID],
    );
    await pool.execute(
      'DELETE FROM sku_consumable_profiles WHERE tenant_id = ? AND sku_id = ?',
      [TEST_TENANT_ID, CONSUMABLE_SKU_ID],
    );
    await pool.execute(
      'DELETE FROM skus WHERE tenant_id = ? AND id IN (?, ?)',
      [TEST_TENANT_ID, FIXED_ASSET_SKU_ID, CONSUMABLE_SKU_ID],
    );
    await pool.execute(
      'DELETE FROM suppliers WHERE tenant_id = ? AND id = ?',
      [TEST_TENANT_ID, SUPPLIER_ID],
    );

    await pool.execute(
      `INSERT INTO suppliers
        (id, tenant_id, code, name, status, created_by, updated_by)
       VALUES (?, ?, 'SUP-CFA-INT', '损耗品固定资产集成供应商', 'active', 99001, 99001)
       ON DUPLICATE KEY UPDATE
         code = VALUES(code),
         name = VALUES(name),
         status = VALUES(status),
         updated_by = VALUES(updated_by)`,
      [SUPPLIER_ID, TEST_TENANT_ID],
    );

    await pool.execute(
      `INSERT INTO skus
        (id, tenant_id, sku_code, name, category1_id, category2_id, stock_unit, purchase_unit, production_unit,
         has_dye_lot, use_fifo, safety_stock, status, business_class, control_mode, allow_bom_component,
         allow_purchase, asset_tracking_mode, requires_asset_acceptance, created_by, updated_by)
       VALUES
        (?, ?, 'SKU-ASSET-INT', '固定资产集成物料', 1, 1, '台', '台', '台', 0, 0, 0, 'active', 'fixed_asset', 'asset_capitalization', 0, 1, 'serial', 1, 99001, 99001),
        (?, ?, 'SKU-CONSUMABLE-INT', '损耗品集成物料', 1, 1, 'pcs', 'pcs', 'pcs', 0, 0, 0, 'active', 'consumable', 'stock_only', 0, 1, 'none', 0, 99001, 99001)
       ON DUPLICATE KEY UPDATE
         sku_code = VALUES(sku_code),
         name = VALUES(name),
         stock_unit = VALUES(stock_unit),
         purchase_unit = VALUES(purchase_unit),
         production_unit = VALUES(production_unit),
         business_class = VALUES(business_class),
         control_mode = VALUES(control_mode),
         asset_tracking_mode = VALUES(asset_tracking_mode),
         requires_asset_acceptance = VALUES(requires_asset_acceptance),
         status = VALUES(status),
         updated_by = VALUES(updated_by)`,
      [FIXED_ASSET_SKU_ID, TEST_TENANT_ID, CONSUMABLE_SKU_ID, TEST_TENANT_ID],
    );

    await pool.execute(
      `INSERT INTO sku_asset_profiles
        (tenant_id, sku_id, asset_category, depreciation_method, useful_life_months, residual_rate, capex_subject,
         requires_serial_no, created_by, updated_by)
       VALUES (?, ?, 'equipment', 'straight_line', 36, 5.00, '固定资产', 1, 99001, 99001)
       ON DUPLICATE KEY UPDATE
         asset_category = VALUES(asset_category),
         depreciation_method = VALUES(depreciation_method),
         useful_life_months = VALUES(useful_life_months),
         residual_rate = VALUES(residual_rate),
         capex_subject = VALUES(capex_subject),
         requires_serial_no = VALUES(requires_serial_no),
         updated_by = VALUES(updated_by)`,
      [TEST_TENANT_ID, FIXED_ASSET_SKU_ID],
    );

    await pool.execute(
      `INSERT INTO sku_consumable_profiles
        (tenant_id, sku_id, issue_mode, approval_level, expense_subject, min_stock, issue_dept_required, created_by, updated_by)
       VALUES (?, ?, 'department_issue', 'normal', '低值易耗品', 0, 1, 99001, 99001)
       ON DUPLICATE KEY UPDATE
         issue_mode = VALUES(issue_mode),
         approval_level = VALUES(approval_level),
         expense_subject = VALUES(expense_subject),
         min_stock = VALUES(min_stock),
         issue_dept_required = VALUES(issue_dept_required),
         updated_by = VALUES(updated_by)`,
      [TEST_TENANT_ID, CONSUMABLE_SKU_ID],
    );

    await pool.execute(
      `INSERT INTO purchase_orders
        (id, tenant_id, po_no, supplier_id, status, total_amount, expected_date, notes, created_by, updated_by)
       VALUES (?, ?, 'PO-CFA-INT', ?, 'confirmed', 9000.00, CURDATE(), '损耗品固定资产集成采购单', 99001, 99001)
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
       VALUES (?, ?, ?, ?, 2.0000, 0.0000, '台', 4500.0000, 9000.00, 99001, 99001)
       ON DUPLICATE KEY UPDATE
         qty_ordered = VALUES(qty_ordered),
         qty_received = VALUES(qty_received),
         purchase_unit = VALUES(purchase_unit),
         unit_price = VALUES(unit_price),
         amount = VALUES(amount),
         updated_by = VALUES(updated_by)`,
      [PO_ITEM_ID, TEST_TENANT_ID, PO_ID, FIXED_ASSET_SKU_ID],
    );

    await pool.execute(
      `INSERT INTO delivery_notes
        (id, tenant_id, delivery_no, po_id, supplier_id, status, delivered_at, created_by, updated_by)
       VALUES (?, ?, 'DN-CFA-INT', ?, ?, 'received', NOW(3), 99001, 99001)
       ON DUPLICATE KEY UPDATE
         po_id = VALUES(po_id),
         supplier_id = VALUES(supplier_id),
         status = VALUES(status),
         delivered_at = VALUES(delivered_at),
         updated_by = VALUES(updated_by)`,
      [DELIVERY_NOTE_ID, TEST_TENANT_ID, PO_ID, SUPPLIER_ID],
    );

    await pool.execute(
      `INSERT INTO delivery_note_items
        (id, tenant_id, delivery_note_id, sku_id, po_item_id, qty_delivered, purchase_unit, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, 2.0000, '台', 99001, 99001)
       ON DUPLICATE KEY UPDATE
         sku_id = VALUES(sku_id),
         po_item_id = VALUES(po_item_id),
         qty_delivered = VALUES(qty_delivered),
         purchase_unit = VALUES(purchase_unit),
         updated_by = VALUES(updated_by)`,
      [DELIVERY_NOTE_ITEM_ID, TEST_TENANT_ID, DELIVERY_NOTE_ID, FIXED_ASSET_SKU_ID, PO_ITEM_ID],
    );

    await pool.execute(
      `INSERT INTO purchase_receipts
        (id, tenant_id, receipt_no, po_id, ${receiptDeliveryColumn}, status, received_at, created_by, updated_by)
       VALUES (?, ?, 'RC-CFA-INT', ?, ?, 'confirmed', NOW(3), 99001, 99001)
       ON DUPLICATE KEY UPDATE
         po_id = VALUES(po_id),
         ${receiptDeliveryColumn} = VALUES(${receiptDeliveryColumn}),
         status = VALUES(status),
         received_at = VALUES(received_at),
         updated_by = VALUES(updated_by)`,
      [RECEIPT_ID, TEST_TENANT_ID, PO_ID, DELIVERY_NOTE_ID],
    );

    if (supportsReceiptItemControlColumns) {
      await pool.execute(
        `INSERT INTO purchase_receipt_items
          (id, tenant_id, receipt_id, sku_id, po_item_id, qty_received, purchase_unit, unit_price, amount,
           business_class, receipt_mode, requires_acceptance, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, 2.0000, '台', 4500.0000, 9000.00, 'fixed_asset', 'asset_capitalization', 1, 99001, 99001)
         ON DUPLICATE KEY UPDATE
           sku_id = VALUES(sku_id),
           po_item_id = VALUES(po_item_id),
           qty_received = VALUES(qty_received),
           purchase_unit = VALUES(purchase_unit),
           unit_price = VALUES(unit_price),
           amount = VALUES(amount),
           business_class = VALUES(business_class),
           receipt_mode = VALUES(receipt_mode),
           requires_acceptance = VALUES(requires_acceptance),
           updated_by = VALUES(updated_by)`,
        [RECEIPT_ITEM_ID, TEST_TENANT_ID, RECEIPT_ID, FIXED_ASSET_SKU_ID, PO_ITEM_ID],
      );
    } else {
      await pool.execute(
        `INSERT INTO purchase_receipt_items
          (id, tenant_id, receipt_id, sku_id, qty_received, purchase_unit, unit_price, amount, created_by, updated_by)
         VALUES (?, ?, ?, ?, 2.0000, '台', 4500.0000, 9000.00, 99001, 99001)
         ON DUPLICATE KEY UPDATE
           sku_id = VALUES(sku_id),
           qty_received = VALUES(qty_received),
           purchase_unit = VALUES(purchase_unit),
           unit_price = VALUES(unit_price),
           amount = VALUES(amount),
           updated_by = VALUES(updated_by)`,
        [RECEIPT_ITEM_ID, TEST_TENANT_ID, RECEIPT_ID, FIXED_ASSET_SKU_ID],
      );
    }

    await pool.execute(
      `INSERT INTO warehouses
        (id, tenant_id, code, name, type, status, created_by, updated_by)
       VALUES (?, ?, 'CONS-INT-WH', '损耗品集成仓', 'consumable', 'active', 99001, 99001)
       ON DUPLICATE KEY UPDATE
         code = VALUES(code),
         name = VALUES(name),
         type = VALUES(type),
         status = VALUES(status),
         updated_by = VALUES(updated_by)`,
      [WAREHOUSE_ID, TEST_TENANT_ID],
    );

    await pool.execute(
      `INSERT INTO locations
        (id, tenant_id, warehouse_id, code, name, level, status, created_by, updated_by)
       VALUES (?, ?, ?, 'CONS-INT-LOC', '损耗品集成库位', 1, 'active', 99001, 99001)
       ON DUPLICATE KEY UPDATE
         warehouse_id = VALUES(warehouse_id),
         code = VALUES(code),
         name = VALUES(name),
         level = VALUES(level),
         status = VALUES(status),
         updated_by = VALUES(updated_by)`,
      [LOCATION_ID, TEST_TENANT_ID, WAREHOUSE_ID],
    );

    await pool.execute(
      `INSERT INTO inventory
        (tenant_id, sku_id, warehouse_id, location_id, qty_on_hand, qty_reserved, qty_in_transit, created_by, updated_by)
       VALUES (?, ?, ?, ?, 20.0000, 0.0000, 0.0000, 99001, 99001)
       ON DUPLICATE KEY UPDATE
         qty_on_hand = VALUES(qty_on_hand),
         qty_reserved = VALUES(qty_reserved),
         qty_in_transit = VALUES(qty_in_transit),
         updated_by = VALUES(updated_by)`,
      [TEST_TENANT_ID, CONSUMABLE_SKU_ID, WAREHOUSE_ID, LOCATION_ID],
    );

    await pool.execute(
      `INSERT INTO consumable_issue_orders
        (id, tenant_id, issue_no, request_department_id, purpose, status, notes, approved_by, approved_at, created_by, updated_by)
       VALUES (?, ?, 'CI-CFA-INT', ?, '产线日常领用', 'approved', '待执行领用单', 99004, NOW(3), 99001, 99001)
       ON DUPLICATE KEY UPDATE
         request_department_id = VALUES(request_department_id),
         purpose = VALUES(purpose),
         status = VALUES(status),
         notes = VALUES(notes),
         approved_by = VALUES(approved_by),
         approved_at = VALUES(approved_at),
         updated_by = VALUES(updated_by)`,
      [ISSUE_ORDER_ID, TEST_TENANT_ID, REQUEST_DEPARTMENT_ID],
    );

    await pool.execute(
      `INSERT INTO consumable_issue_items
        (id, tenant_id, issue_order_id, sku_id, warehouse_id, location_id, qty_requested, qty_issued, issue_unit, budget_code, notes, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, 5.0000, 0.0000, 'pcs', 'BDG-INT', '集成测试领用明细', 99001, 99001)
       ON DUPLICATE KEY UPDATE
         warehouse_id = VALUES(warehouse_id),
         location_id = VALUES(location_id),
         qty_requested = VALUES(qty_requested),
         qty_issued = VALUES(qty_issued),
         issue_unit = VALUES(issue_unit),
         budget_code = VALUES(budget_code),
         notes = VALUES(notes),
         updated_by = VALUES(updated_by)`,
      [ISSUE_ITEM_ID, TEST_TENANT_ID, ISSUE_ORDER_ID, CONSUMABLE_SKU_ID, WAREHOUSE_ID, LOCATION_ID],
    );

    if (supportsInventoryTxBusinessColumns) {
      await pool.execute(
        `DELETE FROM inventory_transactions
         WHERE tenant_id = ? AND sku_id = ? AND business_class = 'consumable'`,
        [TEST_TENANT_ID, CONSUMABLE_SKU_ID],
      );
    }
  });

  afterAll(async () => {
    await dbPool?.end();
    dbPool = null;
  });

  test('warehouse 可对固定资产收货执行验收建卡', async () => {
    const res = await request(BASE_URL)
      .post('/api/assets/acceptance')
      .set(authHeader('warehouse'))
      .send({
        receiptId: RECEIPT_ID,
        items: [
          {
            receiptItemId: RECEIPT_ITEM_ID,
            cards: [
              {
                assetName: '裁床一号',
                serialNo: 'FA-SN-001',
                assetTagNo: 'FA-TAG-001',
                departmentId: REQUEST_DEPARTMENT_ID,
                custodianUserId: 99004,
                locationText: '一车间-A区',
                notes: '首台设备',
              },
              {
                assetName: '裁床二号',
                serialNo: 'FA-SN-002',
                assetTagNo: 'FA-TAG-002',
                departmentId: REQUEST_DEPARTMENT_ID,
                custodianUserId: 99003,
                locationText: '一车间-B区',
              },
            ],
          },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.code).toBe(0);
    expect(res.body.data.receiptId).toBe(RECEIPT_ID);
    expect(res.body.data.createdCount).toBe(2);
    expect(res.body.data.cards).toHaveLength(2);

    acceptedCardId = Number(res.body.data.cards[0].id);
    expect(acceptedCardId).toBeGreaterThan(0);

    const pool = getDbPool();
    const [cards] = await pool.query<Array<RowDataPacket & {
      id: number;
      asset_name: string;
      original_value: string;
      status: string;
      department_id: number | null;
      custodian_user_id: number | null;
    }>>(
      `SELECT id, asset_name, original_value, status, department_id, custodian_user_id
       FROM asset_cards
       WHERE tenant_id = ? AND receipt_item_id = ?
       ORDER BY id ASC`,
      [TEST_TENANT_ID, RECEIPT_ITEM_ID],
    );
    expect(cards).toHaveLength(2);
    expect(cards).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          asset_name: '裁床一号',
          original_value: '4500.00',
          status: 'idle',
          department_id: REQUEST_DEPARTMENT_ID,
          custodian_user_id: 99004,
        }),
        expect.objectContaining({
          asset_name: '裁床二号',
          original_value: '4500.00',
          status: 'idle',
          department_id: REQUEST_DEPARTMENT_ID,
          custodian_user_id: 99003,
        }),
      ]),
    );

    const [movements] = await pool.query<Array<RowDataPacket & { movement_type: string }>>(
      `SELECT movement_type
       FROM asset_movements
       WHERE tenant_id = ? AND asset_card_id IN (?, ?)
       ORDER BY id ASC`,
      [TEST_TENANT_ID, Number(cards[0].id), Number(cards[1].id)],
    );
    expect(movements).toHaveLength(2);
    expect(movements.every((movement) => movement.movement_type === 'acceptance')).toBe(true);
  });

  test('warehouse 可将固定资产退回到待分配状态', async () => {
    const res = await request(BASE_URL)
      .post(`/api/assets/cards/${acceptedCardId}/return`)
      .set(authHeader('warehouse'))
      .send({
        locationText: '资产中转区',
        notes: '项目结束退回',
      });

    expect(res.status).toBe(200);
    expect(res.body.code).toBe(0);

    const pool = getDbPool();
    const [cards] = await pool.query<Array<RowDataPacket & {
      status: string;
      department_id: number | null;
      custodian_user_id: number | null;
      location_text: string | null;
      notes: string | null;
    }>>(
      `SELECT status, department_id, custodian_user_id, location_text, notes
       FROM asset_cards
       WHERE tenant_id = ? AND id = ?
       LIMIT 1`,
      [TEST_TENANT_ID, acceptedCardId],
    );
    expect(cards[0]).toMatchObject({
      status: 'idle',
      department_id: null,
      custodian_user_id: null,
      location_text: '资产中转区',
    });
    expect(String(cards[0].notes ?? '')).toContain('项目结束退回');

    const [movements] = await pool.query<Array<RowDataPacket & {
      movement_type: string;
      to_location_text: string | null;
    }>>(
      `SELECT movement_type, to_location_text
       FROM asset_movements
       WHERE tenant_id = ? AND asset_card_id = ?
       ORDER BY id DESC
       LIMIT 1`,
      [TEST_TENANT_ID, acceptedCardId],
    );
    expect(movements[0]).toMatchObject({
      movement_type: 'return',
      to_location_text: '资产中转区',
    });
  });

  test('warehouse 可执行损耗品领用并回写库存与流水', async () => {
    const res = await request(BASE_URL)
      .post(`/api/consumables/issues/${ISSUE_ORDER_ID}/execute`)
      .set(authHeader('warehouse'))
      .send({
        notes: '集成测试执行发放',
      });

    expect(res.status).toBe(200);
    expect(res.body.code).toBe(0);
    expect(res.body.data).toMatchObject({
      id: ISSUE_ORDER_ID,
      issueNo: 'CI-CFA-INT',
      issuedItemCount: 1,
    });

    const pool = getDbPool();
    const [orders] = await pool.query<Array<RowDataPacket & {
      status: string;
      issued_by: number | null;
    }>>(
      `SELECT status, issued_by
       FROM consumable_issue_orders
       WHERE tenant_id = ? AND id = ?
       LIMIT 1`,
      [TEST_TENANT_ID, ISSUE_ORDER_ID],
    );
    expect(orders[0]).toMatchObject({
      status: 'issued',
      issued_by: 99003,
    });

    const [items] = await pool.query<Array<RowDataPacket & {
      qty_issued: string;
      warehouse_id: number;
      location_id: number;
    }>>(
      `SELECT qty_issued, warehouse_id, location_id
       FROM consumable_issue_items
       WHERE tenant_id = ? AND id = ?
       LIMIT 1`,
      [TEST_TENANT_ID, ISSUE_ITEM_ID],
    );
    expect(items[0]).toMatchObject({
      qty_issued: '5.0000',
      warehouse_id: WAREHOUSE_ID,
      location_id: LOCATION_ID,
    });

    const [inventoryRows] = await pool.query<Array<RowDataPacket & { qty_on_hand: string }>>(
      `SELECT qty_on_hand
       FROM inventory
       WHERE tenant_id = ? AND sku_id = ? AND warehouse_id = ? AND location_id = ?
       LIMIT 1`,
      [TEST_TENANT_ID, CONSUMABLE_SKU_ID, WAREHOUSE_ID, LOCATION_ID],
    );
    expect(inventoryRows[0].qty_on_hand).toBe('15.0000');

    const [transactions] = await pool.query<Array<RowDataPacket & {
      transaction_type: string;
      direction: string;
      business_class?: string;
      department_id?: number | null;
      issue_order_id?: number | null;
      notes: string | null;
    }>>(
      `SELECT transaction_type,
              direction,
              ${supportsInventoryTxBusinessColumns ? 'business_class, department_id, issue_order_id,' : ''}
              notes
       FROM inventory_transactions
       WHERE tenant_id = ? AND reference_type = 'consumable_issue_order' AND reference_id = ?
       ORDER BY id DESC
       LIMIT 1`,
      [TEST_TENANT_ID, ISSUE_ORDER_ID],
    );
    expect(transactions[0].transaction_type).toBe('CONSUMABLE_OUT');
    expect(transactions[0].direction).toBe('OUT');
    if (transactions[0].business_class !== undefined) {
      expect(transactions[0]).toMatchObject({
        business_class: 'consumable',
        department_id: REQUEST_DEPARTMENT_ID,
        issue_order_id: ISSUE_ORDER_ID,
      });
    }
    expect(String(transactions[0].notes ?? '')).toContain('集成测试执行发放');

    const [snapshots] = await pool.query<Array<RowDataPacket & {
      qty_on_hand: string;
      qty_available: string;
    }>>(
      `SELECT qty_on_hand, qty_available
       FROM inventory_daily_snapshots
       WHERE tenant_id = ? AND snapshot_date = CURDATE() AND warehouse_id = ? AND sku_id = ?
       LIMIT 1`,
      [TEST_TENANT_ID, WAREHOUSE_ID, CONSUMABLE_SKU_ID],
    );
    expect(snapshots[0]).toMatchObject({
      qty_on_hand: '15.0000',
      qty_available: '15.0000',
    });
  });
});
