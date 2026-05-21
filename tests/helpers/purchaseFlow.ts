import { createHmac } from 'node:crypto';
import type { APIRequestContext, Page, APIResponse } from '@playwright/test';
import mysql from '../../services/api/node_modules/mysql2/promise';

export type TestRole = 'boss' | 'purchaser' | 'warehouse' | 'supervisor' | 'qc';

type InspectionMode = 'pass' | 'partial_return' | 'fail_return';

interface RoleSeed {
  userId: number;
  username: string;
  realName: string;
  roles: string[];
}

export interface SeededFixture {
  supplierId: number;
  skuId: number;
  supplierCode: string;
  supplierName: string;
  skuCode: string;
  skuName: string;
}

export interface PurchaseScenario {
  fixture: SeededFixture;
  poId: number;
  poNo: string;
  deliveryId: number;
  deliveryNo: string;
  inspectionId: number;
  inspectionNo: string;
  receiptId: number | null;
  receiptNo: string | null;
  returnOrderId: number | null;
  returnNo: string | null;
}

export interface PurchaseSuggestionScenario {
  fixture: SeededFixture;
  suggestionId: number;
  suggestionNo: string;
  suggestedQty: string;
  estimatedPrice: string;
  estimatedAmount: string;
  reason: string;
}

const TEST_TENANT_ID = 9999;
const JWT_SECRET = process.env.JWT_SECRET ?? 'local-test-jwt-secret-key-2026-smartfactory-at-least-32-chars';
const TEST_LOGIN_PASSWORD = 'Dev123!2026';
const TEST_LOGIN_PASSWORD_HASH = '$2b$10$MmgwQ9xr9HEolYqOUjcpUumg/M3wle7C3ySCi4ziZSCnJfAl1zacO';
export const APP_BASE_URL = (process.env.PLAYWRIGHT_APP_BASE_URL ?? 'http://localhost').replace(/\/$/, '');
const API_BASE_URL = `${APP_BASE_URL}/api`;
const DB_HOST = process.env.DB_HOST ?? '127.0.0.1';
const DB_PORT = Number(process.env.DB_PORT ?? '3307');
const DB_USER = process.env.DB_USER ?? 'sf_app';
const DB_PASS = process.env.DB_PASS ?? process.env.DB_PASSWORD ?? 'TestApp2026!Secure';
const DB_NAME = process.env.DB_NAME ?? 'smart_factory';

const ROLE_SEEDS: Record<TestRole, RoleSeed> = {
  boss: { userId: 99001, username: 'test_boss', realName: '测试老板', roles: ['boss'] },
  purchaser: { userId: 99002, username: 'test_purchaser', realName: '测试采购员', roles: ['purchaser'] },
  warehouse: { userId: 99003, username: 'test_warehouse', realName: '测试仓库员', roles: ['warehouse'] },
  supervisor: { userId: 99004, username: 'test_supervisor', realName: '测试主管', roles: ['supervisor'] },
  qc: { userId: 99006, username: 'test_qc', realName: '测试质检员', roles: ['qc'] },
};

let dbPool: mysql.Pool | null = null;

function getDbPool(): mysql.Pool {
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

function base64Url(value: string): string {
  return Buffer.from(value).toString('base64url');
}

function signToken(role: TestRole): string {
  const seed = ROLE_SEEDS[role];
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64Url(JSON.stringify({
    userId: seed.userId,
    username: seed.username,
    roles: seed.roles,
    tenantId: TEST_TENANT_ID,
    iat: now,
    exp: now + 3600,
  }));
  const signature = createHmac('sha256', JWT_SECRET)
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${signature}`;
}

function buildUser(role: TestRole) {
  const seed = ROLE_SEEDS[role];
  return {
    id: seed.userId,
    username: seed.username,
    realName: seed.realName,
    roles: seed.roles,
    tenantId: TEST_TENANT_ID,
    tenantName: 'Playwright QA Tenant',
  };
}

export function authHeaders(role: TestRole): Record<string, string> {
  return { Authorization: `Bearer ${signToken(role)}` };
}

async function parseApiData<T>(response: APIResponse): Promise<T> {
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

export function apiUrl(path: string): string {
  return `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

function nextFixtureIds() {
  const suffix = `${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 10)}`;
  return {
    supplierId: Number(`91${suffix}`),
    skuId: Number(`92${suffix}`),
    suffix,
  };
}

function buildExpectedDate(daysFromNow: number): string {
  const date = new Date();
  date.setDate(date.getDate() + daysFromNow);
  return date.toISOString().slice(0, 10);
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
      throw new Error('Timed out while polling purchase flow data');
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

export async function closePurchaseFlowDbPool(): Promise<void> {
  if (dbPool) {
    await dbPool.end();
    dbPool = null;
  }
}

async function ensureAuthUsers(): Promise<void> {
  const pool = getDbPool();
  await pool.execute(
    `INSERT INTO tenants (id, code, name, status, settings)
     VALUES (?, 'TEST9999', 'Playwright QA Tenant', 'active', JSON_OBJECT())
     ON DUPLICATE KEY UPDATE
       code = VALUES(code),
       name = VALUES(name),
       status = VALUES(status),
       settings = VALUES(settings)`,
    [TEST_TENANT_ID],
  );

  for (const seed of Object.values(ROLE_SEEDS)) {
    await pool.execute(
      `INSERT INTO users
         (id, tenant_id, username, password_hash, real_name, status, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, 'active', 0, 0)
       ON DUPLICATE KEY UPDATE
         username = VALUES(username),
         password_hash = VALUES(password_hash),
         real_name = VALUES(real_name),
         status = VALUES(status),
         updated_by = VALUES(updated_by)`,
      [seed.userId, TEST_TENANT_ID, seed.username, TEST_LOGIN_PASSWORD_HASH, seed.realName],
    );

    for (const role of seed.roles) {
      await pool.execute(
        `INSERT IGNORE INTO user_roles (tenant_id, user_id, role_id)
         SELECT ?, ?, id FROM roles WHERE tenant_id = 0 AND code = ?`,
        [TEST_TENANT_ID, seed.userId, role],
      );
    }
  }
}

export async function seedAuth(page: Page, role: TestRole): Promise<void> {
  await ensureAuthUsers();
  const seed = ROLE_SEEDS[role];
  const response = await page.request.post(`${API_BASE_URL}/auth/login`, {
    data: {
      tenantCode: 'TEST9999',
      username: seed.username,
      password: TEST_LOGIN_PASSWORD,
    },
  });
  const payload = await response.json();
  if (!response.ok() || payload?.code !== 0) {
    throw new Error(payload?.message ?? `登录失败: HTTP ${response.status()}`);
  }
  const token = payload.data.accessToken as string;
  const user = payload.data.user ?? buildUser(role);
  const permissionSnapshot = payload.data.permissionSnapshot ?? null;

  await page.addInitScript(({ seededUser, seededToken, seededPermissionSnapshot }) => {
    window.sessionStorage.setItem('__sf_at', seededToken);
    window.localStorage.setItem('sf_user', JSON.stringify(seededUser));
    if (seededPermissionSnapshot) {
      window.localStorage.setItem('sf_permission_snapshot', JSON.stringify(seededPermissionSnapshot));
    }
  }, { seededUser: user, seededToken: token, seededPermissionSnapshot: permissionSnapshot });
}

export async function ensurePurchaseFixture(): Promise<SeededFixture> {
  const pool = getDbPool();
  const { supplierId, skuId, suffix } = nextFixtureIds();
  const supplierCode = `SUP-PW-${suffix}`;
  const supplierName = `Playwright供应商-${suffix}`;
  const skuCode = `SKU-PW-${suffix}`;
  const skuName = `Playwright板材-${suffix}`;

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
     VALUES (?, ?, ?, ?, 1, 1, '张', '张', '张', 0, 1, 0, 'active', ?, ?)
     ON DUPLICATE KEY UPDATE
       sku_code = VALUES(sku_code),
       name = VALUES(name),
       stock_unit = VALUES(stock_unit),
       purchase_unit = VALUES(purchase_unit),
       production_unit = VALUES(production_unit),
       status = VALUES(status),
       updated_by = VALUES(updated_by)`,
    [skuId, TEST_TENANT_ID, skuCode, skuName, 99001, 99001],
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

export async function createPurchaseOrderScenario(
  api: APIRequestContext,
  fixture?: SeededFixture,
): Promise<{ fixture: SeededFixture; poId: number; poNo: string }> {
  const seeded = fixture ?? await ensurePurchaseFixture();
  const response = await api.post(apiUrl('/purchase/orders'), {
    headers: authHeaders('purchaser'),
    data: {
      supplierId: seeded.supplierId,
      expectedDate: buildExpectedDate(10),
      items: [
        {
          skuId: seeded.skuId,
          qtyOrdered: '20',
          purchaseUnit: '张',
          unitPrice: '120.00',
        },
      ],
    },
  });
  const data = await parseApiData<{ id: number; poNo: string }>(response);
  return { fixture: seeded, poId: Number(data.id), poNo: String(data.poNo) };
}

export async function createDeliveryForOrder(
  api: APIRequestContext,
  scenario: { fixture: SeededFixture; poId: number; poNo: string },
): Promise<{ fixture: SeededFixture; poId: number; poNo: string; deliveryId: number; deliveryNo: string }> {
  const response = await api.post(apiUrl(`/purchase/orders/${scenario.poId}/delivery`), {
    headers: authHeaders('purchaser'),
    data: {
      poId: scenario.poId,
      deliveryDate: new Date().toISOString().slice(0, 10),
      items: [
        {
          skuId: scenario.fixture.skuId,
          qtyDelivered: '20',
          purchaseUnit: '张',
          unitPrice: '120.00',
        },
      ],
    },
  });
  const data = await parseApiData<{ id: number; deliveryNo: string }>(response);
  return {
    ...scenario,
    deliveryId: Number(data.id),
    deliveryNo: String(data.deliveryNo),
  };
}

export async function createInspectionForDelivery(
  api: APIRequestContext,
  scenario: { fixture: SeededFixture; poId: number; poNo: string; deliveryId: number; deliveryNo: string },
): Promise<PurchaseScenario> {
  const response = await api.post(apiUrl('/incoming-inspections'), {
    headers: authHeaders('warehouse'),
    data: {
      poId: scenario.poId,
      deliveryNoteId: scenario.deliveryId,
      inspectionDate: new Date().toISOString().slice(0, 10),
      notes: 'Playwright 质检造数',
    },
  });
  const data = await parseApiData<{ id: number; inspectionNo: string }>(response);
  return {
    fixture: scenario.fixture,
    poId: scenario.poId,
    poNo: scenario.poNo,
    deliveryId: scenario.deliveryId,
    deliveryNo: scenario.deliveryNo,
    inspectionId: Number(data.id),
    inspectionNo: String(data.inspectionNo),
    receiptId: null,
    receiptNo: null,
    returnOrderId: null,
    returnNo: null,
  };
}

export async function findInspectionByDelivery(
  api: APIRequestContext,
  deliveryId: number,
): Promise<{ id: number; inspectionNo: string }> {
  return poll(async () => {
    const response = await api.get(apiUrl('/incoming-inspections?page=1&pageSize=50'), {
      headers: authHeaders('warehouse'),
    });
    const data = await parseApiData<{ list: Array<Record<string, unknown>> }>(response);
    const record = data.list.find((item) => Number(item.deliveryNoteId ?? item.delivery_note_id ?? 0) === deliveryId);
    if (!record) return null;
    return {
      id: Number(record.id),
      inspectionNo: String(record.inspectionNo ?? record.inspection_no ?? ''),
    };
  });
}

export async function submitInspectionScenario(
  api: APIRequestContext,
  scenario: PurchaseScenario,
  mode: InspectionMode,
): Promise<PurchaseScenario> {
  await prepareInspectionItems(api, scenario.inspectionId, mode);

  const submitResponse = await api.post(apiUrl(`/incoming-inspections/${scenario.inspectionId}/submit`), {
    headers: authHeaders('warehouse'),
    data: {
      overallResult: mode === 'pass' ? 'pass' : mode === 'partial_return' ? 'conditional_pass' : 'fail',
      notes: mode === 'pass' ? 'Playwright UI 提交合格' : mode === 'partial_return' ? 'Playwright UI 部分合格' : 'Playwright UI 整单退货',
    },
  });
  await parseApiData(submitResponse);

  const previewResponse = await api.get(apiUrl(`/incoming-inspections/${scenario.inspectionId}/preview-receipt`), {
    headers: authHeaders('warehouse'),
  });
  const preview = await parseApiData<{
    receiptId?: number | null;
    receiptNo?: string | null;
  }>(previewResponse);

  const returnOrder = mode === 'pass'
    ? null
    : await findReturnOrderByInspection(api, scenario.inspectionId);

  return {
    ...scenario,
    receiptId: preview.receiptId ? Number(preview.receiptId) : null,
    receiptNo: preview.receiptNo ? String(preview.receiptNo) : null,
    returnOrderId: returnOrder?.id ?? null,
    returnNo: returnOrder?.returnNo ?? null,
  };
}

export async function prepareInspectionItems(
  api: APIRequestContext,
  inspectionId: number,
  mode: InspectionMode,
): Promise<void> {
  const detailResponse = await api.get(apiUrl(`/incoming-inspections/${inspectionId}`), {
    headers: authHeaders('warehouse'),
  });
  const detail = await parseApiData<{ items: Array<Record<string, unknown>> }>(detailResponse);
  const items = detail.items ?? [];

  const updatePayload = {
    items: items.map((item) => {
      const qtyDelivered = String(item.qtyDelivered ?? item.qty_delivered ?? '0');
      if (mode === 'pass') {
        return {
          id: Number(item.id),
          qtysampled: qtyDelivered,
          qtyPassed: qtyDelivered,
          qtyFailed: '0',
          result: 'pass',
          disposition: 'accept',
          notes: '整批合格',
        };
      }
      if (mode === 'partial_return') {
        return {
          id: Number(item.id),
          qtysampled: qtyDelivered,
          qtyPassed: '12',
          qtyFailed: '8',
          result: 'conditional_pass',
          disposition: 'return',
          notes: '8 张不合格退货',
        };
      }
      return {
        id: Number(item.id),
        qtysampled: qtyDelivered,
        qtyPassed: '0',
        qtyFailed: qtyDelivered,
        result: 'fail',
        disposition: 'return',
        notes: '整批不合格退货',
      };
    }),
  };

  const updateResponse = await api.put(apiUrl(`/incoming-inspections/${inspectionId}/items`), {
    headers: authHeaders('warehouse'),
    data: updatePayload,
  });
  await parseApiData(updateResponse);
}

export async function findReturnOrderByInspection(
  api: APIRequestContext,
  inspectionId: number,
): Promise<{ id: number; returnNo: string } | null> {
  return poll(async () => {
    const response = await api.get(apiUrl('/return-orders?returnType=purchase_return&page=1&pageSize=50'), {
      headers: authHeaders('warehouse'),
    });
    const data = await parseApiData<{ list: Array<Record<string, unknown>> }>(response);
    const record = data.list.find((item) => Number(item.sourceInspectionId ?? item.source_inspection_id ?? 0) === inspectionId);
    if (!record) return null;
    return {
      id: Number(record.id),
      returnNo: String(record.returnNo ?? record.return_no ?? ''),
    };
  });
}

export async function findReceiptByInspection(
  api: APIRequestContext,
  inspectionId: number,
): Promise<{ id: number; receiptNo: string } | null> {
  return poll(async () => {
    const response = await api.get(apiUrl(`/incoming-inspections/${inspectionId}/preview-receipt`), {
      headers: authHeaders('warehouse'),
    });
    const data = await parseApiData<{ receiptId?: number | null; receiptNo?: string | null }>(response);
    if (!data.receiptId) return null;
    return { id: Number(data.receiptId), receiptNo: String(data.receiptNo ?? '') };
  });
}

export async function createScenario(
  api: APIRequestContext,
  mode: 'order_only' | 'delivery_only' | 'inspection_only' | InspectionMode,
): Promise<PurchaseScenario | { fixture: SeededFixture; poId: number; poNo: string }> {
  const order = await createPurchaseOrderScenario(api);
  if (mode === 'order_only') {
    return order;
  }
  const delivery = await createDeliveryForOrder(api, order);
  if (mode === 'delivery_only') {
    return {
      fixture: delivery.fixture,
      poId: delivery.poId,
      poNo: delivery.poNo,
      deliveryId: delivery.deliveryId,
      deliveryNo: delivery.deliveryNo,
      inspectionId: 0,
      inspectionNo: '',
      receiptId: null,
      receiptNo: null,
      returnOrderId: null,
      returnNo: null,
    };
  }
  const inspection = await createInspectionForDelivery(api, delivery);
  if (mode === 'inspection_only') {
    return inspection;
  }
  return submitInspectionScenario(api, inspection, mode);
}

export async function seedPurchaseSuggestionScenario(): Promise<PurchaseSuggestionScenario> {
  const pool = getDbPool();
  const fixture = await ensurePurchaseFixture();
  const suffix = `${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 10)}`;
  const suggestionNo = `PS-PW-${suffix}`;
  const suggestedQty = '8.0000';
  const estimatedPrice = '120.0000';
  const estimatedAmount = '960.00';
  const reason = `Playwright 手动采购建议：${fixture.skuCode} 安全库存补货`;

  const [existingRows] = await pool.query<Array<{ id: number }>>(
    `SELECT id
     FROM purchase_orders
     WHERE tenant_id = ? AND notes LIKE ?
     ORDER BY id DESC`,
    [TEST_TENANT_ID, `%${suggestionNo}%`],
  );
  if (existingRows.length > 0) {
    const existingOrderIds = existingRows.map((row) => Number(row.id));
    const placeholders = existingOrderIds.map(() => '?').join(', ');
    await pool.execute(
      `DELETE FROM purchase_order_items
       WHERE tenant_id = ? AND po_id IN (${placeholders})`,
      [TEST_TENANT_ID, ...existingOrderIds],
    );
    await pool.execute(
      `DELETE FROM purchase_orders
       WHERE tenant_id = ? AND id IN (${placeholders})`,
      [TEST_TENANT_ID, ...existingOrderIds],
    );
  }

  await pool.execute(
    `DELETE FROM purchase_suggestions
     WHERE tenant_id = ? AND suggestion_no = ?`,
    [TEST_TENANT_ID, suggestionNo],
  );

  const [insertResult] = await pool.execute<mysql.ResultSetHeader>(
    `INSERT INTO purchase_suggestions
       (tenant_id, suggestion_no, source, production_order_id, sku_id,
        suggested_supplier_id, suggested_qty, purchase_unit,
        estimated_price, estimated_amount, shortage_qty, reason,
        confidence, status, created_by, updated_by)
     VALUES (?, ?, 'manual', NULL, ?, ?, ?, '张', ?, ?, NULL, ?, ?, 'pending', ?, ?)`,
    [
      TEST_TENANT_ID,
      suggestionNo,
      fixture.skuId,
      fixture.supplierId,
      suggestedQty,
      estimatedPrice,
      estimatedAmount,
      reason,
      'medium',
      ROLE_SEEDS.boss.userId,
      ROLE_SEEDS.boss.userId,
    ],
  );

  return {
    fixture,
    suggestionId: Number(insertResult.insertId),
    suggestionNo,
    suggestedQty,
    estimatedPrice,
    estimatedAmount,
    reason,
  };
}

export async function cleanupPurchaseSuggestionScenario(
  scenario: PurchaseSuggestionScenario,
): Promise<void> {
  const pool = getDbPool();

  const [poRows] = await pool.query<Array<{ id: number }>>(
    `SELECT id
     FROM purchase_orders
     WHERE tenant_id = ? AND notes LIKE ?
     ORDER BY id DESC`,
    [TEST_TENANT_ID, `%${scenario.suggestionNo}%`],
  );

  if (poRows.length > 0) {
    const orderIds = poRows.map((row) => Number(row.id));
    const placeholders = orderIds.map(() => '?').join(', ');
    await pool.execute(
      `DELETE FROM purchase_order_items
       WHERE tenant_id = ? AND po_id IN (${placeholders})`,
      [TEST_TENANT_ID, ...orderIds],
    );
    await pool.execute(
      `DELETE FROM purchase_orders
       WHERE tenant_id = ? AND id IN (${placeholders})`,
      [TEST_TENANT_ID, ...orderIds],
    );
  }

  await pool.execute(
    `DELETE FROM purchase_suggestions
     WHERE tenant_id = ? AND id = ?`,
    [TEST_TENANT_ID, scenario.suggestionId],
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

export async function waitForPurchaseSuggestionApproved(
  scenario: PurchaseSuggestionScenario,
): Promise<{
  status: string;
  approvedBy: number | null;
  approvedAt: string | null;
}> {
  const pool = getDbPool();

  return poll(async () => {
    const [rows] = await pool.query<Array<{
      status: string;
      approved_by: number | null;
      approved_at: string | null;
    }>>(
      `SELECT status, approved_by, approved_at
       FROM purchase_suggestions
       WHERE tenant_id = ? AND id = ?
       LIMIT 1`,
      [TEST_TENANT_ID, scenario.suggestionId],
    );

    const row = rows[0];
    if (!row || row.status !== 'approved' || !row.approved_at) {
      return null;
    }

    return {
      status: String(row.status),
      approvedBy: row.approved_by === null ? null : Number(row.approved_by),
      approvedAt: row.approved_at ? String(row.approved_at) : null,
    };
  });
}

export async function waitForPurchaseSuggestionExecuted(
  scenario: PurchaseSuggestionScenario,
): Promise<{
  suggestionStatus: string;
  poId: number;
  poNo: string;
  poStatus: string;
  poItemCount: number;
  qtyOrdered: string;
  qtyInTransit: string;
}> {
  const pool = getDbPool();

  return poll(async () => {
    const [suggestionRows] = await pool.query<Array<{
      status: string;
    }>>(
      `SELECT status
       FROM purchase_suggestions
       WHERE tenant_id = ? AND id = ?
       LIMIT 1`,
      [TEST_TENANT_ID, scenario.suggestionId],
    );
    const [poRows] = await pool.query<Array<{
      id: number;
      po_no: string;
      status: string;
      item_count: number;
      qty_ordered: string;
    }>>(
      `SELECT
         po.id,
         po.po_no,
         po.status,
         COUNT(poi.id) AS item_count,
         COALESCE(MAX(poi.qty_ordered), '0') AS qty_ordered
       FROM purchase_orders po
       LEFT JOIN purchase_order_items poi
         ON poi.po_id = po.id
        AND poi.tenant_id = po.tenant_id
       WHERE po.tenant_id = ? AND po.notes LIKE ?
       GROUP BY po.id, po.po_no, po.status
       ORDER BY po.id DESC
       LIMIT 1`,
      [TEST_TENANT_ID, `%${scenario.suggestionNo}%`],
    );
    const [inventoryRows] = await pool.query<Array<{
      qty_in_transit: string;
    }>>(
      `SELECT qty_in_transit
       FROM inventory
       WHERE tenant_id = ? AND sku_id = ?
       LIMIT 1`,
      [TEST_TENANT_ID, scenario.fixture.skuId],
    );

    const suggestion = suggestionRows[0];
    const po = poRows[0];
    const inventory = inventoryRows[0];
    if (!suggestion || suggestion.status !== 'executed' || !po || !inventory) {
      return null;
    }

    return {
      suggestionStatus: String(suggestion.status),
      poId: Number(po.id),
      poNo: String(po.po_no),
      poStatus: String(po.status),
      poItemCount: Number(po.item_count),
      qtyOrdered: String(po.qty_ordered),
      qtyInTransit: String(inventory.qty_in_transit),
    };
  });
}
