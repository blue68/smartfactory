/**
 * 集成测试 — 采购模块 API
 *
 * 覆盖：
 * - TC-PUR-008  老板审批批准
 * - TC-PUR-009  驳回必须填原因 → 1001
 * - TC-PUR-010  驳回填写原因
 * - TC-PUR-011  非boss角色无权审批 → 1003
 * - TC-PUR-DN-001  需缸号物料录入送货单可携带 dyeLotNo
 * - TC-3WM-001  三单完全匹配
 * - TC-3WM-002  数量差异 → qty_diff
 * - TC-3WM-004  价格预警 → price_warning
 * - TC-3WM-005  差异确认（supplier_short）
 * - TC-3WM-006  已匹配记录不可再确认
 * - TC-3WM-007  送货单与PO不匹配 → 5002
 * - TC-3WM-009  非采购员无权执行匹配 → 1003
 * - TC-3WM-010  匹配记录列表按状态筛选
 */

import request from 'supertest';
import mysql, { Pool, RowDataPacket } from 'mysql2/promise';
import { authHeader } from '../helpers/testAuth';

const BASE_URL = process.env.TEST_API_URL ?? 'http://localhost:3000';
const TEST_TENANT_ID = 9999;
const TEST_SUPPLIER_ID = 1;
const TEST_SKU_ID = 30003;
const TEST_SKU_WARN_ID = 30004;

// 测试环境预置数据 ID
const PENDING_SUGGESTION_ID = 60001; // 预置：pending状态的采购建议
const PO_ID_COMPLETE        = 61001; // 预置：PO、送货单、入库单完全匹配的测试集
const DN_ID_COMPLETE        = 61002;
const RECEIPT_ID_COMPLETE   = 61003;
const PO_ID_QTY_DIFF        = 62001; // 预置：数量差异的测试集
const DN_ID_QTY_DIFF        = 62002;
const RECEIPT_ID_QTY_DIFF   = 62003; // 入库数量少
const PO_ID_PRICE_WARN      = 63001; // 预置：价格预警的测试集
const DN_ID_PRICE_WARN      = 63002;
const RECEIPT_ID_PRICE_WARN = 63003;
const PO_ID_MISMATCH        = 64001; // 预置：送货单关联不同PO
const DN_ID_MISMATCH        = 64002; // 关联PO=64009（与64001不匹配）
const RECEIPT_ID_MISMATCH   = 64003;
const PO_ID_MISMATCH_REF    = 64009;
const PO_ID_PRICE_BASELINE  = 63090;

const PO_ITEM_ID_COMPLETE = 61101;
const PO_ITEM_ID_QTY_DIFF = 62101;
const PO_ITEM_ID_PRICE_WARN = 63101;
const PO_ITEM_ID_MISMATCH = 64101;
const PO_ITEM_ID_MISMATCH_REF = 64109;
const PO_ITEM_ID_PRICE_BASELINE = 63190;

const DN_ITEM_ID_COMPLETE = 61201;
const DN_ITEM_ID_QTY_DIFF = 62201;
const DN_ITEM_ID_PRICE_WARN = 63201;
const DN_ITEM_ID_MISMATCH = 64201;

const RECEIPT_ITEM_ID_COMPLETE = 61301;
const RECEIPT_ITEM_ID_QTY_DIFF = 62301;
const RECEIPT_ITEM_ID_PRICE_WARN = 63301;
const RECEIPT_ITEM_ID_MISMATCH = 64301;

const INSPECTION_ID_COMPLETE = 61401;
const INSPECTION_ID_QTY_DIFF = 62401;
const INSPECTION_ID_PRICE_WARN = 63401;
const INSPECTION_ID_MISMATCH = 64401;

const INSPECTION_ITEM_ID_COMPLETE = 61501;
const INSPECTION_ITEM_ID_QTY_DIFF = 62501;
const INSPECTION_ITEM_ID_PRICE_WARN = 63501;
const INSPECTION_ITEM_ID_MISMATCH = 64501;

let dbPool: Pool | null = null;

interface CountRow extends RowDataPacket {
  cnt: number;
}

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

async function hasTable(pool: Pool, tableName: string): Promise<boolean> {
  const [rows] = await pool.query<CountRow[]>(
    `SELECT COUNT(*) AS cnt
       FROM information_schema.tables
      WHERE table_schema = DATABASE()
        AND table_name = ?`,
    [tableName],
  );
  return Number(rows[0]?.cnt ?? 0) > 0;
}

async function hasColumn(pool: Pool, tableName: string, columnName: string): Promise<boolean> {
  const [rows] = await pool.query<CountRow[]>(
    `SELECT COUNT(*) AS cnt
       FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = ?
        AND column_name = ?`,
    [tableName, columnName],
  );
  return Number(rows[0]?.cnt ?? 0) > 0;
}

async function getReceiptDeliveryColumn(pool: Pool): Promise<'delivery_note_id' | 'dn_id'> {
  const [rows] = await pool.query<CountRow[]>(
    `SELECT COUNT(*) AS cnt
       FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'purchase_receipts'
        AND column_name = 'delivery_note_id'`,
  );
  return Number(rows[0]?.cnt ?? 0) > 0 ? 'delivery_note_id' : 'dn_id';
}

describe('采购模块 API 集成测试', () => {
  beforeAll(async () => {
    const pool = getDbPool();
    const hasReceiptItems = await hasTable(pool, 'purchase_receipt_items');
    const receiptDeliveryColumn = await getReceiptDeliveryColumn(pool);

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
       VALUES (?, ?, 'SUP-PUR-INT', '采购集成供应商', 'active', 99002, 99002)
       ON DUPLICATE KEY UPDATE
         code = VALUES(code),
         name = VALUES(name),
         status = VALUES(status),
         updated_by = VALUES(updated_by)`,
      [TEST_SUPPLIER_ID, TEST_TENANT_ID],
    );

    await pool.execute(
      `INSERT INTO skus
        (id, tenant_id, sku_code, name, category1_id, category2_id, stock_unit, purchase_unit, production_unit, has_dye_lot, use_fifo, safety_stock, status, created_by, updated_by)
       VALUES
        (?, ?, 'SKU-PUR-INT', '采购集成物料', 1, 1, '箱', '箱', '箱', 0, 1, 0, 'active', 99002, 99002),
        (?, ?, 'SKU-PUR-INT-WARN', '采购集成价格预警物料', 1, 1, '箱', '箱', '箱', 0, 1, 0, 'active', 99002, 99002)
       ON DUPLICATE KEY UPDATE
         sku_code = VALUES(sku_code),
         name = VALUES(name),
         status = VALUES(status),
         updated_by = VALUES(updated_by)`,
      [TEST_SKU_ID, TEST_TENANT_ID, TEST_SKU_WARN_ID, TEST_TENANT_ID],
    );

    await pool.execute(
      'DELETE FROM three_way_match_records WHERE tenant_id = ? AND po_id IN (?, ?, ?, ?, ?, ?)',
      [TEST_TENANT_ID, PO_ID_COMPLETE, PO_ID_QTY_DIFF, PO_ID_PRICE_WARN, PO_ID_MISMATCH, PO_ID_MISMATCH_REF, PO_ID_PRICE_BASELINE],
    );

    if (hasReceiptItems) {
      await pool.execute(
        'DELETE FROM purchase_receipt_items WHERE tenant_id = ? AND receipt_id IN (?, ?, ?, ?)',
        [TEST_TENANT_ID, RECEIPT_ID_COMPLETE, RECEIPT_ID_QTY_DIFF, RECEIPT_ID_PRICE_WARN, RECEIPT_ID_MISMATCH],
      );
    } else {
      await pool.execute(
        'DELETE FROM incoming_inspection_items WHERE tenant_id = ? AND inspection_id IN (?, ?, ?, ?)',
        [TEST_TENANT_ID, INSPECTION_ID_COMPLETE, INSPECTION_ID_QTY_DIFF, INSPECTION_ID_PRICE_WARN, INSPECTION_ID_MISMATCH],
      );
      await pool.execute(
        'DELETE FROM incoming_inspection_records WHERE tenant_id = ? AND id IN (?, ?, ?, ?)',
        [TEST_TENANT_ID, INSPECTION_ID_COMPLETE, INSPECTION_ID_QTY_DIFF, INSPECTION_ID_PRICE_WARN, INSPECTION_ID_MISMATCH],
      );
    }

    await pool.execute(
      'DELETE FROM purchase_receipts WHERE tenant_id = ? AND id IN (?, ?, ?, ?)',
      [TEST_TENANT_ID, RECEIPT_ID_COMPLETE, RECEIPT_ID_QTY_DIFF, RECEIPT_ID_PRICE_WARN, RECEIPT_ID_MISMATCH],
    );
    await pool.execute(
      'DELETE FROM delivery_note_items WHERE tenant_id = ? AND delivery_note_id IN (?, ?, ?, ?)',
      [TEST_TENANT_ID, DN_ID_COMPLETE, DN_ID_QTY_DIFF, DN_ID_PRICE_WARN, DN_ID_MISMATCH],
    );
    await pool.execute(
      'DELETE FROM delivery_notes WHERE tenant_id = ? AND id IN (?, ?, ?, ?)',
      [TEST_TENANT_ID, DN_ID_COMPLETE, DN_ID_QTY_DIFF, DN_ID_PRICE_WARN, DN_ID_MISMATCH],
    );
    await pool.execute(
      'DELETE FROM purchase_order_items WHERE tenant_id = ? AND po_id IN (?, ?, ?, ?, ?, ?)',
      [TEST_TENANT_ID, PO_ID_COMPLETE, PO_ID_QTY_DIFF, PO_ID_PRICE_WARN, PO_ID_MISMATCH, PO_ID_MISMATCH_REF, PO_ID_PRICE_BASELINE],
    );
    await pool.execute(
      'DELETE FROM purchase_orders WHERE tenant_id = ? AND id IN (?, ?, ?, ?, ?, ?)',
      [TEST_TENANT_ID, PO_ID_COMPLETE, PO_ID_QTY_DIFF, PO_ID_PRICE_WARN, PO_ID_MISMATCH, PO_ID_MISMATCH_REF, PO_ID_PRICE_BASELINE],
    );

    await pool.execute('DELETE FROM purchase_suggestions WHERE tenant_id = ? AND id = ?', [TEST_TENANT_ID, PENDING_SUGGESTION_ID]);

    await pool.execute(
      `INSERT INTO purchase_orders
        (id, tenant_id, po_no, supplier_id, status, total_amount, expected_date, notes, created_by, updated_by)
       VALUES
        (?, ?, 'PO-INT-COMPLETE', ?, 'confirmed', 1000.00, CURDATE(), '三单匹配完整一致', 99002, 99002),
        (?, ?, 'PO-INT-QTY-DIFF', ?, 'confirmed', 1000.00, CURDATE(), '三单匹配数量差异', 99002, 99002),
        (?, ?, 'PO-INT-PRICE-WARN', ?, 'confirmed', 1300.00, CURDATE(), '三单匹配价格预警', 99002, 99002),
        (?, ?, 'PO-INT-MISMATCH', ?, 'confirmed', 1000.00, CURDATE(), '送货单不匹配', 99002, 99002),
        (?, ?, 'PO-INT-MISMATCH-REF', ?, 'confirmed', 1000.00, CURDATE(), '送货单实际关联PO', 99002, 99002),
        (?, ?, 'PO-INT-WARN-BASELINE', ?, 'confirmed', 100.00, CURDATE(), '价格预警基线', 99002, 99002)`,
      [
        PO_ID_COMPLETE, TEST_TENANT_ID, TEST_SUPPLIER_ID,
        PO_ID_QTY_DIFF, TEST_TENANT_ID, TEST_SUPPLIER_ID,
        PO_ID_PRICE_WARN, TEST_TENANT_ID, TEST_SUPPLIER_ID,
        PO_ID_MISMATCH, TEST_TENANT_ID, TEST_SUPPLIER_ID,
        PO_ID_MISMATCH_REF, TEST_TENANT_ID, TEST_SUPPLIER_ID,
        PO_ID_PRICE_BASELINE, TEST_TENANT_ID, TEST_SUPPLIER_ID,
      ],
    );

    await pool.execute(
      `INSERT INTO purchase_order_items
        (id, tenant_id, po_id, sku_id, qty_ordered, qty_received, purchase_unit, unit_price, amount, created_by, updated_by)
       VALUES
        (?, ?, ?, ?, 10.0000, 0.0000, '箱', 100.0000, 1000.00, 99002, 99002),
        (?, ?, ?, ?, 10.0000, 0.0000, '箱', 100.0000, 1000.00, 99002, 99002),
        (?, ?, ?, ?, 10.0000, 0.0000, '箱', 10000.0000, 100000.00, 99002, 99002),
        (?, ?, ?, ?, 10.0000, 0.0000, '箱', 100.0000, 1000.00, 99002, 99002),
        (?, ?, ?, ?, 10.0000, 0.0000, '箱', 100.0000, 1000.00, 99002, 99002),
        (?, ?, ?, ?, 10.0000, 0.0000, '箱', 100.0000, 1000.00, 99002, 99002)`,
      [
        PO_ITEM_ID_COMPLETE, TEST_TENANT_ID, PO_ID_COMPLETE, TEST_SKU_ID,
        PO_ITEM_ID_QTY_DIFF, TEST_TENANT_ID, PO_ID_QTY_DIFF, TEST_SKU_ID,
        PO_ITEM_ID_PRICE_WARN, TEST_TENANT_ID, PO_ID_PRICE_WARN, TEST_SKU_WARN_ID,
        PO_ITEM_ID_MISMATCH, TEST_TENANT_ID, PO_ID_MISMATCH, TEST_SKU_ID,
        PO_ITEM_ID_MISMATCH_REF, TEST_TENANT_ID, PO_ID_MISMATCH_REF, TEST_SKU_ID,
        PO_ITEM_ID_PRICE_BASELINE, TEST_TENANT_ID, PO_ID_PRICE_BASELINE, TEST_SKU_WARN_ID,
      ],
    );

    await pool.execute(
      `INSERT INTO delivery_notes
        (id, tenant_id, delivery_no, po_id, supplier_id, delivery_date, status, notes, created_by, updated_by)
       VALUES
        (?, ?, 'DN-INT-COMPLETE', ?, ?, CURDATE(), 'confirmed', '完整匹配', 99002, 99002),
        (?, ?, 'DN-INT-QTY-DIFF', ?, ?, CURDATE(), 'confirmed', '数量差异', 99002, 99002),
        (?, ?, 'DN-INT-PRICE-WARN', ?, ?, CURDATE(), 'confirmed', '价格预警', 99002, 99002),
        (?, ?, 'DN-INT-MISMATCH', ?, ?, CURDATE(), 'confirmed', '与目标PO不匹配', 99002, 99002)`,
      [
        DN_ID_COMPLETE, TEST_TENANT_ID, PO_ID_COMPLETE, TEST_SUPPLIER_ID,
        DN_ID_QTY_DIFF, TEST_TENANT_ID, PO_ID_QTY_DIFF, TEST_SUPPLIER_ID,
        DN_ID_PRICE_WARN, TEST_TENANT_ID, PO_ID_PRICE_WARN, TEST_SUPPLIER_ID,
        DN_ID_MISMATCH, TEST_TENANT_ID, PO_ID_MISMATCH_REF, TEST_SUPPLIER_ID,
      ],
    );

    await pool.execute(
      `INSERT INTO delivery_note_items
        (id, tenant_id, delivery_note_id, sku_id, qty_delivered, purchase_unit, unit_price, amount, created_by, updated_by)
       VALUES
        (?, ?, ?, ?, 10.0000, '箱', 100.0000, 1000.00, 99002, 99002),
        (?, ?, ?, ?, 10.0000, '箱', 100.0000, 1000.00, 99002, 99002),
        (?, ?, ?, ?, 10.0000, '箱', 10000.0000, 100000.00, 99002, 99002),
        (?, ?, ?, ?, 10.0000, '箱', 100.0000, 1000.00, 99002, 99002)`,
      [
        DN_ITEM_ID_COMPLETE, TEST_TENANT_ID, DN_ID_COMPLETE, TEST_SKU_ID,
        DN_ITEM_ID_QTY_DIFF, TEST_TENANT_ID, DN_ID_QTY_DIFF, TEST_SKU_ID,
        DN_ITEM_ID_PRICE_WARN, TEST_TENANT_ID, DN_ID_PRICE_WARN, TEST_SKU_WARN_ID,
        DN_ITEM_ID_MISMATCH, TEST_TENANT_ID, DN_ID_MISMATCH, TEST_SKU_ID,
      ],
    );

    await pool.execute(
      `INSERT INTO purchase_receipts
        (id, tenant_id, receipt_no, po_id, ${receiptDeliveryColumn}, status, received_at, created_by, updated_by)
       VALUES
        (?, ?, 'RC-INT-COMPLETE', ?, ?, 'confirmed', NOW(3), 99002, 99002),
        (?, ?, 'RC-INT-QTY-DIFF', ?, ?, 'confirmed', NOW(3), 99002, 99002),
        (?, ?, 'RC-INT-PRICE-WARN', ?, ?, 'confirmed', NOW(3), 99002, 99002),
        (?, ?, 'RC-INT-MISMATCH', ?, ?, 'confirmed', NOW(3), 99002, 99002)`,
      [
        RECEIPT_ID_COMPLETE, TEST_TENANT_ID, PO_ID_COMPLETE, DN_ID_COMPLETE,
        RECEIPT_ID_QTY_DIFF, TEST_TENANT_ID, PO_ID_QTY_DIFF, DN_ID_QTY_DIFF,
        RECEIPT_ID_PRICE_WARN, TEST_TENANT_ID, PO_ID_PRICE_WARN, DN_ID_PRICE_WARN,
        RECEIPT_ID_MISMATCH, TEST_TENANT_ID, PO_ID_MISMATCH, DN_ID_MISMATCH,
      ],
    );

    if (hasReceiptItems) {
      await pool.execute(
        `INSERT INTO purchase_receipt_items
          (id, tenant_id, receipt_id, sku_id, qty_received, purchase_unit, unit_price, amount, created_by, updated_by)
         VALUES
          (?, ?, ?, ?, 10.0000, '箱', 100.0000, 1000.00, 99002, 99002),
          (?, ?, ?, ?, 9.0000, '箱', 100.0000, 900.00, 99002, 99002),
          (?, ?, ?, ?, 10.0000, '箱', 10000.0000, 100000.00, 99002, 99002),
          (?, ?, ?, ?, 10.0000, '箱', 100.0000, 1000.00, 99002, 99002)`,
        [
          RECEIPT_ITEM_ID_COMPLETE, TEST_TENANT_ID, RECEIPT_ID_COMPLETE, TEST_SKU_ID,
          RECEIPT_ITEM_ID_QTY_DIFF, TEST_TENANT_ID, RECEIPT_ID_QTY_DIFF, TEST_SKU_ID,
          RECEIPT_ITEM_ID_PRICE_WARN, TEST_TENANT_ID, RECEIPT_ID_PRICE_WARN, TEST_SKU_WARN_ID,
          RECEIPT_ITEM_ID_MISMATCH, TEST_TENANT_ID, RECEIPT_ID_MISMATCH, TEST_SKU_ID,
        ],
      );
    } else {
      await pool.execute(
        `INSERT INTO incoming_inspection_records
          (id, tenant_id, inspection_no, po_id, delivery_note_id, inspector_id, inspection_date, status, overall_result, receipt_triggered, return_triggered, created_by, updated_by)
         VALUES
          (?, ?, 'IQC-INT-COMPLETE', ?, ?, 99006, CURDATE(), 'passed', 'pass', 1, 0, 99006, 99006),
          (?, ?, 'IQC-INT-QTY-DIFF', ?, ?, 99006, CURDATE(), 'passed', 'pass', 1, 0, 99006, 99006),
          (?, ?, 'IQC-INT-PRICE-WARN', ?, ?, 99006, CURDATE(), 'passed', 'pass', 1, 0, 99006, 99006),
          (?, ?, 'IQC-INT-MISMATCH', ?, ?, 99006, CURDATE(), 'passed', 'pass', 1, 0, 99006, 99006)`,
        [
          INSPECTION_ID_COMPLETE, TEST_TENANT_ID, PO_ID_COMPLETE, DN_ID_COMPLETE,
          INSPECTION_ID_QTY_DIFF, TEST_TENANT_ID, PO_ID_QTY_DIFF, DN_ID_QTY_DIFF,
          INSPECTION_ID_PRICE_WARN, TEST_TENANT_ID, PO_ID_PRICE_WARN, DN_ID_PRICE_WARN,
          INSPECTION_ID_MISMATCH, TEST_TENANT_ID, PO_ID_MISMATCH, DN_ID_MISMATCH,
        ],
      );
      await pool.execute(
        `INSERT INTO incoming_inspection_items
          (id, tenant_id, inspection_id, sku_id, po_item_id, qty_delivered, qty_sampled, qty_passed, qty_failed, result, disposition, created_by, updated_by)
         VALUES
          (?, ?, ?, ?, ?, 10.0000, 1.0000, 10.0000, 0.0000, 'pass', 'accept', 99006, 99006),
          (?, ?, ?, ?, ?, 10.0000, 1.0000, 9.0000, 1.0000, 'conditional_pass', 'accept', 99006, 99006),
          (?, ?, ?, ?, ?, 10.0000, 1.0000, 10.0000, 0.0000, 'pass', 'accept', 99006, 99006),
          (?, ?, ?, ?, ?, 10.0000, 1.0000, 10.0000, 0.0000, 'pass', 'accept', 99006, 99006)`,
        [
          INSPECTION_ITEM_ID_COMPLETE, TEST_TENANT_ID, INSPECTION_ID_COMPLETE, TEST_SKU_ID, PO_ITEM_ID_COMPLETE,
          INSPECTION_ITEM_ID_QTY_DIFF, TEST_TENANT_ID, INSPECTION_ID_QTY_DIFF, TEST_SKU_ID, PO_ITEM_ID_QTY_DIFF,
          INSPECTION_ITEM_ID_PRICE_WARN, TEST_TENANT_ID, INSPECTION_ID_PRICE_WARN, TEST_SKU_WARN_ID, PO_ITEM_ID_PRICE_WARN,
          INSPECTION_ITEM_ID_MISMATCH, TEST_TENANT_ID, INSPECTION_ID_MISMATCH, TEST_SKU_ID, PO_ITEM_ID_MISMATCH,
        ],
      );
    }

    await pool.execute(
      `INSERT INTO purchase_suggestions
        (id, tenant_id, suggestion_no, sku_id, suggested_supplier_id, suggested_qty, purchase_unit, estimated_price, estimated_amount, shortage_qty, reason, confidence, confidence_detail, status, created_by, updated_by)
       VALUES (?, ?, 'PS-INT-PENDING', ?, ?, 5.0000, '箱', 100.0000, 500.00, 5.0000, '集成测试待审批建议', 'medium', 'seeded', 'pending', 99002, 99002)
       ON DUPLICATE KEY UPDATE
         status = 'pending',
         approved_by = NULL,
         approved_at = NULL,
         reject_reason = NULL,
         updated_by = VALUES(updated_by)`,
      [PENDING_SUGGESTION_ID, TEST_TENANT_ID, TEST_SKU_ID, TEST_SUPPLIER_ID],
    );
  });

  afterAll(async () => {
    await dbPool?.end();
    dbPool = null;
  });

  // ─── 采购建议生成 ────────────────────────────────────────────

  describe('触发生成采购建议 — POST /api/purchase/suggestions/generate', () => {
    test('boss角色可触发生成 → 返回建议列表', async () => {
      const res = await request(BASE_URL)
        .post('/api/purchase/suggestions/generate')
        .set(authHeader('boss'));

      expect(res.status).toBe(200);
      expect(res.body.code).toBe(0);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    test('purchaser角色可触发生成', async () => {
      const res = await request(BASE_URL)
        .post('/api/purchase/suggestions/generate')
        .set(authHeader('purchaser'));

      expect(res.status).toBe(200);
    });

    test('每条建议包含必要字段', async () => {
      const res = await request(BASE_URL)
        .post('/api/purchase/suggestions/generate')
        .set(authHeader('boss'));

      const suggestions: any[] = res.body.data ?? [];
      if (suggestions.length > 0) {
        const s = suggestions[0];
        expect(s).toHaveProperty('skuId');
        expect(s).toHaveProperty('skuName');
        expect(s).toHaveProperty('suggestedQty');
        expect(s).toHaveProperty('confidence');
        expect(s).toHaveProperty('confidenceDetail');
        expect(s).toHaveProperty('reason');
        expect(['high', 'medium', 'low']).toContain(s.confidence);
      }
    });

    test('warehouse角色无权触发 → 403', async () => {
      const res = await request(BASE_URL)
        .post('/api/purchase/suggestions/generate')
        .set(authHeader('warehouse'));

      expect(res.status).toBe(403);
      expect(res.body.code).toBe(1003);
    });
  });

  // ─── 采购建议审批 ────────────────────────────────────────────

  describe('审批采购建议 — POST /api/purchase/suggestions/:id/approve', () => {
    test('TC-PUR-008: boss批准建议 → status变为approved', async () => {
      const res = await request(BASE_URL)
        .post(`/api/purchase/suggestions/${PENDING_SUGGESTION_ID}/approve`)
        .set(authHeader('boss'))
        .send({ approved: true });

      expect(res.status).toBe(200);
      expect(res.body.code).toBe(0);

      // 验证状态已变更
      const listRes = await request(BASE_URL)
        .get('/api/purchase/suggestions?status=approved')
        .set(authHeader('boss'));
      const found = listRes.body.data?.list?.some(
        (s: any) => Number(s.id) === PENDING_SUGGESTION_ID,
      );
      expect(found).toBe(true);
    });

    test('TC-PUR-009: 驳回时不填rejectReason → 1001', async () => {
      const res = await request(BASE_URL)
        .post(`/api/purchase/suggestions/${PENDING_SUGGESTION_ID}/approve`)
        .set(authHeader('boss'))
        .send({ approved: false }); // 无 rejectReason

      expect(res.body.code).toBe(1001);
    });

    test('TC-PUR-010: 驳回并填写原因 → status变为rejected', async () => {
      // 先创建新的待审批建议（避免状态已变）
      await request(BASE_URL)
        .post('/api/purchase/suggestions/generate')
        .set(authHeader('boss'));

      const listRes = await request(BASE_URL)
        .get('/api/purchase/suggestions?status=pending')
        .set(authHeader('boss'));
      const pendingId = listRes.body.data?.list?.[0]?.id;

      if (!pendingId) return; // 若无待审批建议则跳过

      const res = await request(BASE_URL)
        .post(`/api/purchase/suggestions/${pendingId}/approve`)
        .set(authHeader('boss'))
        .send({ approved: false, rejectReason: '价格偏高，暂缓采购' });

      expect(res.status).toBe(200);
      expect(res.body.code).toBe(0);
    });

    test('TC-PUR-011: purchaser无权审批 → 403', async () => {
      const res = await request(BASE_URL)
        .post(`/api/purchase/suggestions/${PENDING_SUGGESTION_ID}/approve`)
        .set(authHeader('purchaser'))
        .send({ approved: true });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe(1003);
    });
  });

  // ─── 采购建议列表 ────────────────────────────────────────────

  describe('采购建议列表 — GET /api/purchase/suggestions', () => {
    test('按状态筛选pending', async () => {
      const res = await request(BASE_URL)
        .get('/api/purchase/suggestions?status=pending')
        .set(authHeader('purchaser'));

      expect(res.status).toBe(200);
      const list: any[] = res.body.data?.list ?? [];
      list.forEach((s) => expect(s.status).toBe('pending'));
    });

    test('分页结构正确', async () => {
      const res = await request(BASE_URL)
        .get('/api/purchase/suggestions?page=1&pageSize=10')
        .set(authHeader('purchaser'));

      expect(res.body.data).toHaveProperty('list');
      expect(res.body.data).toHaveProperty('total');
      expect(res.body.data).toHaveProperty('totalPages');
    });
  });

  // ─── 采购订单创建 ────────────────────────────────────────────

  describe('创建采购订单 — POST /api/purchase/orders', () => {
    test('purchaser可创建采购订单', async () => {
      const deliveryDate = new Date();
      deliveryDate.setDate(deliveryDate.getDate() + 7);

      const res = await request(BASE_URL)
        .post('/api/purchase/orders')
        .set(authHeader('purchaser'))
        .send({
          supplierId: 1,
          expectedDate: deliveryDate.toISOString().slice(0, 10),
          items: [{
            skuId: 30003,
            qtyOrdered: '5',
            purchaseUnit: '箱',
            unitPrice: '600.00',
          }],
        });

      expect(res.status).toBe(201);
      expect(res.body.code).toBe(0);
      expect(res.body.data.poNo).toMatch(/^PO\d+/);
    });
  });

  describe('创建送货单 — POST /api/purchase/orders/:id/delivery', () => {
    test('TC-PUR-DN-001: 需缸号物料可携带 dyeLotNo 创建送货单', async () => {
      const pool = getDbPool();
      const supportsDeliveryItemDyeLot = await hasColumn(pool, 'delivery_note_items', 'dye_lot_no');
      const uniqueSuffix = Date.now();
      const poId = Number(`91${String(uniqueSuffix).slice(-6)}`);
      const poItemId = poId + 1;
      let deliveryId: number | null = null;

      await pool.execute(
        `UPDATE skus
         SET has_dye_lot = 1, updated_by = 99002
         WHERE tenant_id = ? AND id = ?`,
        [TEST_TENANT_ID, TEST_SKU_ID],
      );

      try {
        await pool.execute(
          `INSERT INTO purchase_orders
            (id, tenant_id, po_no, supplier_id, status, total_amount, expected_date, notes, created_by, updated_by)
           VALUES (?, ?, ?, ?, 'confirmed', 1000.00, CURDATE(), '缸号送货单集成回归', 99002, 99002)`,
          [poId, TEST_TENANT_ID, `PO-INT-DYE-${uniqueSuffix}`, TEST_SUPPLIER_ID],
        );
        await pool.execute(
          `INSERT INTO purchase_order_items
            (id, tenant_id, po_id, sku_id, qty_ordered, qty_received, purchase_unit, unit_price, amount, created_by, updated_by)
           VALUES (?, ?, ?, ?, 10.0000, 0.0000, '箱', 100.0000, 1000.00, 99002, 99002)`,
          [poItemId, TEST_TENANT_ID, poId, TEST_SKU_ID],
        );

        const res = await request(BASE_URL)
          .post(`/api/purchase/orders/${poId}/delivery`)
          .set(authHeader('boss'))
          .send({
            poId,
            deliveryDate: '2026-04-10',
            notes: '缸号回归测试',
            items: [
              {
                skuId: TEST_SKU_ID,
                qtyDelivered: '5',
                purchaseUnit: '箱',
                unitPrice: '100.00',
                dyeLotNo: 'DY-INT-20260410-A01',
              },
            ],
          });

        expect(res.status).toBe(201);
        expect(res.body.code).toBe(0);
        expect(res.body.data.deliveryNo).toMatch(/^DN/);
        deliveryId = Number(res.body.data.id);

        const [rows] = await pool.query<Array<RowDataPacket & {
          qty_delivered: string;
          dye_lot_no?: string | null;
        }>>(
          `SELECT qty_delivered${supportsDeliveryItemDyeLot ? ', dye_lot_no' : ''}
             FROM delivery_note_items
            WHERE tenant_id = ? AND delivery_note_id = ?`,
          [TEST_TENANT_ID, deliveryId],
        );

        expect(rows).toHaveLength(1);
        expect(String(rows[0].qty_delivered)).toBe('5.0000');
        if (supportsDeliveryItemDyeLot) {
          expect(String(rows[0].dye_lot_no ?? '')).toBe('DY-INT-20260410-A01');
        }
      } finally {
        await pool.execute(
          'DELETE FROM delivery_note_items WHERE tenant_id = ? AND delivery_note_id = ?',
          [TEST_TENANT_ID, deliveryId ?? -1],
        );
        await pool.execute(
          'DELETE FROM delivery_notes WHERE tenant_id = ? AND id = ?',
          [TEST_TENANT_ID, deliveryId ?? -1],
        );
        await pool.execute(
          'DELETE FROM purchase_order_items WHERE tenant_id = ? AND id = ?',
          [TEST_TENANT_ID, poItemId],
        );
        await pool.execute(
          'DELETE FROM purchase_orders WHERE tenant_id = ? AND id = ?',
          [TEST_TENANT_ID, poId],
        );
        await pool.execute(
          `UPDATE skus
           SET has_dye_lot = 0, updated_by = 99002
           WHERE tenant_id = ? AND id = ?`,
          [TEST_TENANT_ID, TEST_SKU_ID],
        );
      }
    });
  });

  // ─── 三单匹配 ───────────────────────────────────────────────

  describe('三单匹配 — POST /api/purchase/three-way-match', () => {
    test('TC-3WM-001: 三单完全匹配 → matched', async () => {
      const res = await request(BASE_URL)
        .post('/api/purchase/three-way-match')
        .set(authHeader('purchaser'))
        .send({
          poId: PO_ID_COMPLETE,
          deliveryNoteId: DN_ID_COMPLETE,
          receiptId: RECEIPT_ID_COMPLETE,
        });

      expect(res.status).toBe(200);
      expect(res.body.code).toBe(0);
      expect(res.body.data.matchStatus).toBe('matched');
      expect(res.body.data.diffItems[0].qtyDiff).toBe('0.0000');
    });

    test('TC-3WM-002: 数量差异 → qty_diff，qtyDiff为负数', async () => {
      const res = await request(BASE_URL)
        .post('/api/purchase/three-way-match')
        .set(authHeader('purchaser'))
        .send({
          poId: PO_ID_QTY_DIFF,
          deliveryNoteId: DN_ID_QTY_DIFF,
          receiptId: RECEIPT_ID_QTY_DIFF,
        });

      expect(res.status).toBe(200);
      expect(res.body.data.matchStatus).toBe('qty_diff');
      const qtyDiff = parseFloat(res.body.data.diffItems[0].qtyDiff);
      expect(qtyDiff).toBeLessThan(0);
    });

    test('TC-3WM-004: 价格超历史均价20% → price_warning，isPriceAnomaly=true', async () => {
      const res = await request(BASE_URL)
        .post('/api/purchase/three-way-match')
        .set(authHeader('purchaser'))
        .send({
          poId: PO_ID_PRICE_WARN,
          deliveryNoteId: DN_ID_PRICE_WARN,
          receiptId: RECEIPT_ID_PRICE_WARN,
        });

      expect(res.status).toBe(200);
      expect(res.body.data.matchStatus).toBe('price_warning');
      expect(res.body.data.diffItems[0].isPriceAnomaly).toBe(true);
    });

    test('TC-3WM-007: 送货单与PO不匹配 → 5002', async () => {
      const res = await request(BASE_URL)
        .post('/api/purchase/three-way-match')
        .set(authHeader('purchaser'))
        .send({
          poId: PO_ID_MISMATCH,
          deliveryNoteId: DN_ID_MISMATCH, // 关联的是不同PO
          receiptId: RECEIPT_ID_MISMATCH,
        });

      expect(res.body.code).toBe(5002);
    });

    test('TC-3WM-009: worker角色无权执行匹配 → 403', async () => {
      const res = await request(BASE_URL)
        .post('/api/purchase/three-way-match')
        .set(authHeader('worker'))
        .send({
          poId: PO_ID_COMPLETE,
          deliveryNoteId: DN_ID_COMPLETE,
          receiptId: RECEIPT_ID_COMPLETE,
        });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe(1003);
    });
  });

  // ─── 差异确认 ───────────────────────────────────────────────

  describe('确认差异 — POST /api/purchase/three-way-match/:id/confirm', () => {
    let matchId: number;

    beforeAll(async () => {
      // 先执行一次数量差异的匹配，获得matchId
      const res = await request(BASE_URL)
        .post('/api/purchase/three-way-match')
        .set(authHeader('purchaser'))
        .send({
          poId: PO_ID_QTY_DIFF,
          deliveryNoteId: DN_ID_QTY_DIFF,
          receiptId: RECEIPT_ID_QTY_DIFF,
        });
      matchId = res.body.data?.matchId;
    });

    test('TC-3WM-005: 差异确认（supplier_short）→ 状态变为matched', async () => {
      const res = await request(BASE_URL)
        .post(`/api/purchase/three-way-match/${matchId}/confirm`)
        .set(authHeader('purchaser'))
        .send({
          diffReason: 'supplier_short',
          diffNotes: '供应商确认少发1箱，下次补货',
        });

      expect(res.status).toBe(200);
      expect(res.body.code).toBe(0);
    });

    test('TC-3WM-006: 已matched记录不可再确认', async () => {
      // 再次确认同一个已matched的记录
      const res = await request(BASE_URL)
        .post(`/api/purchase/three-way-match/${matchId}/confirm`)
        .set(authHeader('purchaser'))
        .send({
          diffReason: 'other',
          diffNotes: '重复确认测试',
        });

      expect(res.body.code).not.toBe(0);
      expect(res.body.message).toMatch(/已.*匹配/);
    });

    // DEF-004 回归说明：
    // 已迁移到环境无关用例 purchase.confirmDiff.local.test.ts，
    // 避免 TEST_API_URL / 预置账号差异导致误报。
    // 该文件保留 E2E 风格的外部链路验证（TC-3WM-005 / TC-3WM-006）。
  });

  // ─── 三单匹配列表 ────────────────────────────────────────────

  describe('三单匹配列表 — GET /api/purchase/three-way-match', () => {
    test('TC-3WM-010: 按状态筛选qty_diff', async () => {
      const res = await request(BASE_URL)
        .get('/api/purchase/three-way-match?status=qty_diff')
        .set(authHeader('purchaser'));

      expect(res.status).toBe(200);
      const list: any[] = res.body.data?.list ?? [];
      list.forEach((m) => expect(m.matchStatus).toBe('qty_diff'));
    });

    test('每条匹配记录包含poNo和deliveryNo', async () => {
      const res = await request(BASE_URL)
        .get('/api/purchase/three-way-match')
        .set(authHeader('purchaser'));

      const list: any[] = res.body.data?.list ?? [];
      if (list.length > 0) {
        expect(list[0]).toHaveProperty('poNo');
        expect(list[0]).toHaveProperty('deliveryNo');
      }
    });
  });
});
