#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import mysql from '../services/api/node_modules/mysql2/promise.js';

const BASE_URL = (process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1/api').replace(/\/$/, '');
const TENANT_CODE = process.env.SMOKE_TENANT_CODE ?? 'FACTORY001';
const USERNAME = process.env.SMOKE_USERNAME ?? 'admin';
const PASSWORD = process.env.SMOKE_PASSWORD ?? 'Demo123!';
const DB_HOST = process.env.DB_HOST ?? '127.0.0.1';
const DB_PORT = Number(process.env.DB_PORT ?? '3307');
const DB_USER = process.env.DB_USER ?? 'sf_app';
const DB_PASS = process.env.DB_PASS ?? process.env.DB_PASSWORD ?? 'TestApp2026!Secure';
const DB_NAME = process.env.DB_NAME ?? 'smart_factory';
const TENANT_ID = 1;
const BATCH_MODE = process.env.SMOKE_BATCH_MODE ?? 'compatible_merge';
const ORDER_COUNT = 4;
const ORDER_QTY = Number(process.env.SMOKE_ORDER_QTY ?? '6');
const PURCHASEABLE_CODES = [
  'SIMBED-RM-TOPBOARD',
  'SIMBED-RM-BEAMBOARD',
  'SIMBED-RM-PANELBOARD',
  'SIMBED-RM-HPOSTBOARD',
  'SIMBED-RM-SIDEBOARD',
  'SIMBED-RM-ENDBOARD',
  'SIMBED-RM-WINGBOARD',
  'SIMBED-RM-SLATBOARD',
  'SIMBED-RM-EMBED',
  'SIMBED-RM-FOAM',
  'SIMBED-PK-CARTON',
  'SIMBED-PK-MANUAL',
];
const PRICE_BY_SKU = {
  'SIMBED-RM-TOPBOARD': '120.00',
  'SIMBED-RM-BEAMBOARD': '115.00',
  'SIMBED-RM-PANELBOARD': '118.00',
  'SIMBED-RM-HPOSTBOARD': '130.00',
  'SIMBED-RM-SIDEBOARD': '128.00',
  'SIMBED-RM-ENDBOARD': '125.00',
  'SIMBED-RM-WINGBOARD': '122.00',
  'SIMBED-RM-SLATBOARD': '38.00',
  'SIMBED-RM-EMBED': '2.80',
  'SIMBED-RM-FOAM': '60.00',
  'SIMBED-PK-CARTON': '15.00',
  'SIMBED-PK-MANUAL': '1.50',
};

const pool = mysql.createPool({
  host: DB_HOST,
  port: DB_PORT,
  user: DB_USER,
  password: DB_PASS,
  database: DB_NAME,
  connectionLimit: 4,
  waitForConnections: true,
});
let lastTaskMutationAt = 0;

function log(step, message, extra) {
  const prefix = `[factory001-joint-batch] [${step}]`;
  if (extra === undefined) {
    console.log(`${prefix} ${message}`);
    return;
  }
  console.log(`${prefix} ${message}`, extra);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function localDate(offsetDays = 0) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  now.setDate(now.getDate() + offsetDays);
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function throttleTaskMutation(minIntervalMs = 900) {
  const now = Date.now();
  const elapsed = now - lastTaskMutationAt;
  if (elapsed < minIntervalMs) {
    await sleep(minIntervalMs - elapsed);
  }
  lastTaskMutationAt = Date.now();
}

async function poll(fn, {
  timeoutMs = 30000,
  intervalMs = 500,
  label = 'poll',
} = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await fn();
    if (result) return result;
    if (Date.now() >= deadline) {
      throw new Error(`Timed out while waiting for ${label}`);
    }
    await sleep(intervalMs);
  }
}

async function request(path, {
  method = 'GET',
  token,
  body,
  query,
  retries = 8,
} = {}) {
  const url = new URL(`${BASE_URL}${path}`);
  if (query) {
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    });
  }

  const response = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const payload = await response.json().catch(() => ({}));
  const retryableRateLimit =
    response.status === 429
    || String(payload?.message ?? '').includes('请求过于频繁');
  if (retryableRateLimit && retries > 0) {
    const backoffMs = (9 - retries) * 400;
    await sleep(backoffMs);
    return request(path, { method, token, body, query, retries: retries - 1 });
  }
  if (!response.ok || payload?.code !== 0) {
    const message = payload?.message || `${response.status} ${response.statusText}`;
    throw new Error(`${method} ${path} failed: ${message}`);
  }
  return payload.data;
}

async function query(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

async function scalar(sql, params = []) {
  const rows = await query(sql, params);
  const first = rows?.[0];
  if (!first) return null;
  return Object.values(first)[0] ?? null;
}

async function getInventoryQty(skuCode) {
  const value = await scalar(
    `SELECT COALESCE(SUM(inv.qty_on_hand), 0)
     FROM inventory inv
     INNER JOIN skus s ON s.id = inv.sku_id AND s.tenant_id = inv.tenant_id
     WHERE inv.tenant_id = ? AND s.sku_code = ?`,
    [TENANT_ID, skuCode],
  );
  return Number(value ?? 0);
}

async function getReceiptCountForPo(poId) {
  const value = await scalar(
    `SELECT COUNT(*)
     FROM purchase_receipts
     WHERE tenant_id = ? AND po_id = ?`,
    [TENANT_ID, poId],
  );
  return Number(value ?? 0);
}

async function getSuggestionStatuses(batchId) {
  return query(
    `SELECT id, suggestion_no AS suggestionNo, status, sku_id AS skuId
     FROM purchase_suggestions
     WHERE tenant_id = ? AND production_batch_id = ?
     ORDER BY id ASC`,
    [TENANT_ID, batchId],
  );
}

async function getProductionOrdersByBatch(batchId) {
  return query(
    `SELECT id, work_order_no AS workOrderNo, qty_planned AS qtyPlanned, status
     FROM production_orders
     WHERE tenant_id = ? AND joint_batch_id = ?
     ORDER BY id ASC`,
    [TENANT_ID, batchId],
  );
}

async function getInspectionCountForOrders(orderIds) {
  if (orderIds.length === 0) return 0;
  const placeholders = orderIds.map(() => '?').join(',');
  const value = await scalar(
    `SELECT COUNT(*)
     FROM inspection_records
     WHERE tenant_id = ? AND production_order_id IN (${placeholders})`,
    [TENANT_ID, ...orderIds],
  );
  return Number(value ?? 0);
}

async function getInventoryTransactionCountByProductionOrders(orderIds) {
  if (orderIds.length === 0) return 0;
  const placeholders = orderIds.map(() => '?').join(',');
  const value = await scalar(
    `SELECT COUNT(*)
     FROM inventory_transactions
     WHERE tenant_id = ? AND production_order_id IN (${placeholders})`,
    [TENANT_ID, ...orderIds],
  );
  return Number(value ?? 0);
}

function splitInHalf(items) {
  const middle = Math.ceil(items.length / 2);
  return [items.slice(0, middle), items.slice(middle)];
}

function addDays(dateText, days) {
  const date = new Date(`${dateText}T00:00:00`);
  date.setDate(date.getDate() + days);
  return localDateFromDate(date);
}

function localDateFromDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function seedScenario() {
  log('seed', 'resetting FACTORY001 SIMBED scenario');
  const cleanupOutput = execFileSync('node', ['services/api/scripts/seed-factory001-bed-scenario.js', '--cleanup'], {
    cwd: process.cwd(),
    stdio: 'pipe',
    encoding: 'utf8',
  }).trim();
  if (cleanupOutput) {
    console.log(cleanupOutput);
  }
  const seedOutput = execFileSync('node', ['services/api/scripts/seed-factory001-bed-scenario.js'], {
    cwd: process.cwd(),
    stdio: 'pipe',
    encoding: 'utf8',
  }).trim();
  if (seedOutput) {
    console.log(seedOutput);
  }
}

async function ensureSupplierPricing() {
  const supplierCode = 'SIMBED-SUP-01';
  const supplierName = '模拟床联合采购供应商';
  await query(
    `INSERT INTO suppliers
       (tenant_id, code, name, grade, status, main_skus, created_by, updated_by)
     VALUES (?, ?, ?, 'A', 'active', JSON_ARRAY(), 1, 1)
     ON DUPLICATE KEY UPDATE
       name = VALUES(name),
       grade = VALUES(grade),
       status = VALUES(status),
       updated_by = VALUES(updated_by)`,
    [TENANT_ID, supplierCode, supplierName],
  );
  const supplierId = Number(
    await scalar('SELECT id FROM suppliers WHERE tenant_id = ? AND code = ? LIMIT 1', [TENANT_ID, supplierCode]),
  );
  assert(supplierId > 0, 'failed to prepare SIMBED supplier');

  const skuRows = await query(
    `SELECT id, sku_code AS skuCode, purchase_unit AS purchaseUnit
     FROM skus
     WHERE tenant_id = ? AND sku_code IN (${PURCHASEABLE_CODES.map(() => '?').join(',')})`,
    [TENANT_ID, ...PURCHASEABLE_CODES],
  );
  assert(skuRows.length === PURCHASEABLE_CODES.length, 'SIMBED purchaseable sku fixture incomplete');

  for (const row of skuRows) {
    await query(
      `INSERT INTO supplier_prices
         (tenant_id, supplier_id, sku_id, price, unit, is_current, effective_at, moq, purchase_cycle_days, transport_cycle_days, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, 1, CURDATE(), 1, 3, 1, 1, 1)
       ON DUPLICATE KEY UPDATE
         price = VALUES(price),
         unit = VALUES(unit),
         is_current = 1,
         effective_at = CURDATE(),
         expired_at = NULL,
         updated_by = VALUES(updated_by)`,
      [
        TENANT_ID,
        supplierId,
        Number(row.id),
        PRICE_BY_SKU[row.skuCode] ?? '99.00',
        row.purchaseUnit || '件',
      ],
    );
  }

  log('seed', 'SIMBED supplier pricing ready', { supplierCode, skuCount: skuRows.length });
}

async function login() {
  const auth = await request('/auth/login', {
    method: 'POST',
    body: {
      tenantCode: TENANT_CODE,
      username: USERNAME,
      password: PASSWORD,
    },
  });
  assert(auth?.accessToken, 'login returned no accessToken');
  return auth.accessToken;
}

async function loadFixtureIds() {
  const rows = await query(
    `SELECT
        MAX(CASE WHEN sku_code = 'SIMBED-FG-01' THEN id END) AS finishedSkuId,
        MAX(CASE WHEN sku_code = 'SIMBED-RM-FOAM' THEN id END) AS foamSkuId,
        MAX(CASE WHEN sku_code = 'SIMBED-PK-CARTON' THEN id END) AS cartonSkuId,
        MAX(CASE WHEN sku_code = 'SIMBED-PK-MANUAL' THEN id END) AS manualSkuId
     FROM skus
     WHERE tenant_id = ? AND sku_code IN ('SIMBED-FG-01', 'SIMBED-RM-FOAM', 'SIMBED-PK-CARTON', 'SIMBED-PK-MANUAL')`,
    [TENANT_ID],
  );
  const customerId = Number(
    await scalar('SELECT id FROM customers WHERE tenant_id = ? AND code = ? LIMIT 1', [TENANT_ID, 'SIMBED-CUST-01']),
  );
  const record = rows[0] ?? {};
  return {
    customerId,
    finishedSkuId: Number(record.finishedSkuId ?? 0),
    foamSkuId: Number(record.foamSkuId ?? 0),
    cartonSkuId: Number(record.cartonSkuId ?? 0),
    manualSkuId: Number(record.manualSkuId ?? 0),
  };
}

async function createSalesOrders(token, fixture) {
  const created = [];
  const orderDate = localDate(0);
  for (let index = 0; index < ORDER_COUNT; index += 1) {
    const payload = {
      customerId: fixture.customerId,
      orderDate,
      deliveryDate: addDays(orderDate, 7 + index),
      isUrgent: false,
      notes: `FACTORY001 joint batch smoke ${Date.now()}-${index + 1}`,
      items: [
        {
          skuId: fixture.finishedSkuId,
          quantity: String(ORDER_QTY),
          unitPrice: '6888.00',
          notes: `container-${index + 1}`,
        },
      ],
    };
    const order = await request('/sales-orders', { token, method: 'POST', body: payload });
    await request(`/sales-orders/${order.id}/confirm`, { token, method: 'POST' });
    created.push({ id: Number(order.id), orderNo: String(order.orderNo), quantity: ORDER_QTY });
  }
  log('sales', `created and confirmed ${created.length} sales orders`, created.map((item) => item.orderNo));
  return created;
}

async function waitForEligibleOrders(token, orderIds) {
  return poll(async () => {
    const page = await request('/production/batches/eligible-sales-orders', {
      token,
      query: { page: 1, pageSize: 100 },
    });
    const picked = (page.list ?? []).filter((item) => orderIds.includes(Number(item.id)));
    return picked.length === orderIds.length ? picked : null;
  }, { timeoutMs: 20000, label: 'eligible sales orders' });
}

async function createBatch(token, salesOrders, name, scheduleDate) {
  const created = await request('/production/batches', {
    token,
    method: 'POST',
    body: {
      mode: BATCH_MODE,
      salesOrderIds: salesOrders.map((item) => Number(item.id)),
      name,
      notes: `schedule:${scheduleDate}`,
    },
  });
  const batchId = Number(created.id);
  await request(`/production/batches/${batchId}/confirm`, { token, method: 'POST' });
  const productionOrders = await poll(
    async () => {
      const page = await request('/production/orders', {
        token,
        query: { batchId, page: 1, pageSize: 100 },
      });
      return (page.list ?? []).length > 0 ? page.list : null;
    },
    { timeoutMs: 20000, label: `production orders for batch ${batchId}` },
  );
  log('batch', `created batch ${created.batchNo}`, {
    batchId,
    orderNos: salesOrders.map((item) => item.orderNo),
    productionOrders: productionOrders.length,
  });
  return { id: batchId, batchNo: String(created.batchNo), scheduleDate };
}

async function generateAndConfirmSchedule(token, batch) {
  const generated = await request('/production/schedule/generate', {
    token,
    query: { date: batch.scheduleDate, force: true, batchId: batch.id },
  });
  assert((generated.schedules?.length ?? 0) > 0, `batch ${batch.batchNo} generated no schedules`);
  await request('/production/schedule/confirm', {
    token,
    method: 'POST',
    body: { date: batch.scheduleDate, batchId: batch.id },
  });
  const tasks = await poll(
    async () => {
      const page = await request('/production/tasks', {
        token,
        query: { batchId: batch.id, page: 1, pageSize: 200 },
      });
      return (page.list ?? []).length > 0 ? page.list : null;
    },
    { timeoutMs: 20000, label: `tasks for batch ${batch.batchNo}` },
  );
  log('schedule', `batch ${batch.batchNo} scheduled`, {
    date: batch.scheduleDate,
    schedules: generated.schedules.length,
    tasks: tasks.length,
  });
}

async function completeBatchTasks(token, batch) {
  let completedRounds = 0;
  for (;;) {
    const page = await request('/production/tasks', {
      token,
      query: { batchId: batch.id, page: 1, pageSize: 200 },
    });
    const tasks = page.list ?? [];
    const unfinished = tasks.filter((item) => item.status !== 'completed');
    if (unfinished.length === 0) {
      log('tasks', `batch ${batch.batchNo} all tasks completed`, { total: tasks.length });
      return tasks;
    }

    let progressed = false;
    const actionable = unfinished
      .filter((item) => item.status === 'in_progress' || item.dependencyBlocked === 0 || item.dependencyBlocked === false)
      .sort((a, b) => Number(a.id) - Number(b.id));

    for (const task of actionable) {
      try {
        if (task.status === 'pending') {
          await throttleTaskMutation();
          await request(`/production/tasks/${task.id}/start`, { token, method: 'POST' });
        }
        const detail = await request(`/production/tasks/${task.id}`, { token });
        const materialsToIssue = (detail.inputMaterials ?? [])
          .map((item) => {
            const requiredQty = Number(item.requiredQty ?? 0);
            const issuedQty = Number(item.issuedQty ?? 0);
            const remainingQty = requiredQty - issuedQty;
            if (remainingQty <= 0) return null;
            return {
              skuId: Number(item.skuId),
              qty: remainingQty.toFixed(4),
              unit: item.unit || item.stockUnit || '件',
              warehouseId: item.warehouseId ? Number(item.warehouseId) : undefined,
              locationId: item.locationId ? Number(item.locationId) : undefined,
              notes: `joint batch smoke issue for ${detail.taskNo}`,
            };
          })
          .filter(Boolean);
        if (materialsToIssue.length > 0) {
          await throttleTaskMutation();
          await request(`/production/tasks/${task.id}/issue-materials`, {
            token,
            method: 'POST',
            body: { items: materialsToIssue },
          });
        }
        await throttleTaskMutation();
        await request(`/production/tasks/${task.id}/complete-v2`, {
          token,
          method: 'POST',
          body: {
            completedQty: String(task.plannedQty),
            actualHours: 1,
            scrapQty: '0',
            notes: `factory001 joint batch smoke ${batch.batchNo}`,
          },
        });
        progressed = true;
        completedRounds += 1;
        await sleep(180);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (
          message.includes('前置任务')
          || message.includes('库存不足')
          || message.includes('任务状态')
          || message.includes('不可完成')
        ) {
          continue;
        }
        throw error;
      }
    }

    if (!progressed) {
      if (completedRounds > 0) {
        await sleep(500);
        completedRounds = 0;
        continue;
      }
      throw new Error(`batch ${batch.batchNo} has unfinished tasks but no actionable progress`);
    }
  }
}

async function createQualityChecks(token, batch) {
  const orders = await getProductionOrdersByBatch(batch.id);
  for (let index = 0; index < orders.length; index += 1) {
    const order = orders[index];
    const inspection = await request('/quality/inspections', {
      token,
      method: 'POST',
      body: {
        productionOrderNo: order.workOrderNo,
        inspectionDate: batch.scheduleDate,
        qtyInspected: String(order.qtyPlanned),
      },
    });

    if (index === 0) {
      await request('/quality/inspections/issues', {
        token,
        method: 'POST',
        body: {
          inspectionNo: inspection.inspectionNo,
          componentName: '包装外箱',
          issueTypes: ['appearance'],
          severity: 'minor',
          description: `joint batch smoke issue for ${order.workOrderNo}`,
        },
      });
    }

    const passedQty = index === 0
      ? Math.max(Number(order.qtyPlanned) - 1, 0)
      : Number(order.qtyPlanned);

    await request(`/quality/inspections/${inspection.id}/complete`, {
      token,
      method: 'POST',
      body: { qtyPassed: String(passedQty) },
    });
  }
  log('quality', `batch ${batch.batchNo} quality inspections completed`, { orderCount: orders.length });
}

async function approveAndConvertSuggestions(token, batchId) {
  await request(`/production/batches/${batchId}/purchase-suggestions/generate`, {
    token,
    method: 'POST',
  });
  const suggestionPage = await request('/purchase-suggestions', {
    token,
    query: { productionBatchId: batchId, page: 1, pageSize: 100 },
  });
  const suggestions = (suggestionPage.list ?? []).filter((item) => item.status === 'pending');
  assert(suggestions.length > 0, `batch ${batchId} generated no purchase suggestions`);

  for (const suggestion of suggestions) {
    await request(`/purchase-suggestions/${suggestion.id}/approve`, {
      token,
      method: 'PUT',
    });
  }

  const result = await request('/purchase-suggestions/batch-to-po', {
    token,
    method: 'POST',
    body: {
      suggestionIds: suggestions.map((item) => Number(item.id)),
    },
  });
  assert((result.createdPOs?.length ?? 0) > 0, `batch ${batchId} converted no purchase order`);
  log('purchase', `batch ${batchId} converted suggestions to PO`, result);
  return { suggestions, createdPOs: result.createdPOs };
}

async function receiptPurchaseOrders(token, poResults) {
  const beforeBySkuCode = new Map();
  for (const po of poResults.createdPOs) {
    const detail = await request(`/purchase/orders/${po.id}`, { token });
    const items = detail.items ?? [];
    assert(items.length > 0, `purchase order ${po.poNo} has no items`);
    for (const item of items) {
      const skuCode = String(item.skuCode ?? item.sku_code ?? '');
      if (!skuCode || beforeBySkuCode.has(skuCode)) continue;
      beforeBySkuCode.set(skuCode, await getInventoryQty(skuCode));
    }

    const delivery = await request(`/purchase/orders/${po.id}/delivery`, {
      token,
      method: 'POST',
      body: {
        poId: po.id,
        deliveryDate: localDate(0),
        notes: `joint batch smoke delivery for ${po.poNo}`,
        items: items.map((item) => ({
          skuId: Number(item.skuId),
          qtyDelivered: String(item.gapQty ?? item.qtyOrdered),
          purchaseUnit: item.purchaseUnit,
          unitPrice: Number(item.unitPrice ?? 0).toFixed(2),
        })),
      },
    });

    const inspection = await request('/incoming-inspections', {
      token,
      method: 'POST',
      body: {
        poId: po.id,
        deliveryNoteId: delivery.id,
        inspectionDate: localDate(0),
        notes: `joint batch smoke incoming inspection for ${po.poNo}`,
      },
    });

    const detailInspection = await request(`/incoming-inspections/${inspection.id}`, { token });
    await request(`/incoming-inspections/${inspection.id}/items`, {
      token,
      method: 'PUT',
      body: {
        items: (detailInspection.items ?? []).map((item) => {
          const qtyDelivered = String(item.qtyDelivered ?? item.qty_delivered ?? '0');
          return {
            id: Number(item.id),
            qtysampled: qtyDelivered,
            qtyPassed: qtyDelivered,
            qtyFailed: '0',
            result: 'pass',
            disposition: 'accept',
            notes: 'joint batch smoke full pass',
          };
        }),
      },
    });

    await request(`/incoming-inspections/${inspection.id}/submit`, {
      token,
      method: 'POST',
      body: {
        overallResult: 'pass',
        notes: `joint batch smoke receipt submit for ${po.poNo}`,
      },
    });

    const preview = await request(`/incoming-inspections/${inspection.id}/preview-receipt`, { token });
    assert(preview.receiptId, `incoming inspection ${inspection.id} produced no receipt`);

    const receiptCount = await getReceiptCountForPo(po.id);
    assert(receiptCount > 0, `purchase order ${po.poNo} still has no receipt record`);
  }

  const receiptDeltas = [];
  for (const [skuCode, beforeQty] of beforeBySkuCode.entries()) {
    const afterQty = await getInventoryQty(skuCode);
    assert(afterQty > beforeQty, `${skuCode} inventory did not increase after receipt`);
    receiptDeltas.push({ skuCode, beforeQty, afterQty });
  }

  log('purchase', 'incoming inspection submitted and inventory increased', receiptDeltas);
}

async function waitForNoBatchShortage(token, batchId) {
  await poll(async () => {
    const shortages = await request(`/production/batches/${batchId}/shortages`, { token });
    const remaining = (shortages ?? []).filter((item) => Number(item.qtyShortage ?? 0) > 0);
    return remaining.length === 0 ? shortages : null;
  }, { timeoutMs: 30000, label: `shortage clearance for batch ${batchId}` });
}

async function replenishBatchShortages(token, batchId) {
  const shortages = await request(`/production/batches/${batchId}/shortages`, { token });
  const remaining = (shortages ?? []).filter((item) => Number(item.qtyShortage ?? 0) > 0);
  if (remaining.length === 0) return false;

  const poResults = await approveAndConvertSuggestions(token, batchId);
  const suggestionStatuses = await getSuggestionStatuses(batchId);
  assert(
    suggestionStatuses.filter((item) => remaining.some((row) => Number(row.skuId) === Number(item.skuId))).every((item) => item.status === 'executed'),
    `not all batch ${batchId} dynamic suggestions executed`,
  );
  await receiptPurchaseOrders(token, poResults);
  await waitForNoBatchShortage(token, batchId);
  return true;
}

async function completeBatchWithDynamicProcurement(token, batch) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await completeBatchTasks(token, batch);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('no actionable progress')) {
        throw error;
      }
      const replenished = await replenishBatchShortages(token, batch.id);
      if (!replenished) {
        throw error;
      }
    }
  }
  throw new Error(`batch ${batch.batchNo} still unfinished after dynamic replenishment`);
}

async function main() {
  const batch1Date = localDate(0);
  const batch2Date = localDate(1);

  seedScenario();
  await ensureSupplierPricing();

  const fixture = await loadFixtureIds();
  assert(fixture.customerId > 0, 'SIMBED customer missing');
  assert(fixture.finishedSkuId > 0, 'SIMBED finished sku missing');

  const baseline = {
    foam: await getInventoryQty('SIMBED-RM-FOAM'),
    carton: await getInventoryQty('SIMBED-PK-CARTON'),
    manual: await getInventoryQty('SIMBED-PK-MANUAL'),
    finished: await getInventoryQty('SIMBED-FG-01'),
  };
  log('inventory', 'baseline inventory loaded', baseline);

  const token = await login();
  const salesOrders = await createSalesOrders(token, fixture);
  const eligible = await waitForEligibleOrders(token, salesOrders.map((item) => item.id));
  const [batch1Orders, batch2Orders] = splitInHalf(eligible);
  assert(batch1Orders.length === 2 && batch2Orders.length === 2, 'expected two orders per batch');

  const batch1 = await createBatch(token, batch1Orders, `FACTORY001-批次A-${Date.now()}`, batch1Date);
  const batch2 = await createBatch(token, batch2Orders, `FACTORY001-批次B-${Date.now()}`, batch2Date);

  await generateAndConfirmSchedule(token, batch1);
  await completeBatchTasks(token, batch1);
  await createQualityChecks(token, batch1);

  const afterBatch1 = {
    foam: await getInventoryQty('SIMBED-RM-FOAM'),
    carton: await getInventoryQty('SIMBED-PK-CARTON'),
    manual: await getInventoryQty('SIMBED-PK-MANUAL'),
    finished: await getInventoryQty('SIMBED-FG-01'),
  };
  assert(afterBatch1.finished === baseline.finished + 12, `finished goods mismatch after batch1: ${afterBatch1.finished}`);
  assert(afterBatch1.foam === baseline.foam - 12, `foam mismatch after batch1: ${afterBatch1.foam}`);
  assert(afterBatch1.carton === baseline.carton - 12, `carton mismatch after batch1: ${afterBatch1.carton}`);
  assert(afterBatch1.manual === baseline.manual - 12, `manual mismatch after batch1: ${afterBatch1.manual}`);

  const batch2Suggestions = await approveAndConvertSuggestions(token, batch2.id);
  const suggestionStatuses = await getSuggestionStatuses(batch2.id);
  assert(suggestionStatuses.every((item) => item.status === 'executed'), 'not all batch2 suggestions executed');

  await receiptPurchaseOrders(token, batch2Suggestions);
  await waitForNoBatchShortage(token, batch2.id);

  await generateAndConfirmSchedule(token, batch2);
  await completeBatchWithDynamicProcurement(token, batch2);
  await createQualityChecks(token, batch2);

  const finalInventory = {
    foam: await getInventoryQty('SIMBED-RM-FOAM'),
    carton: await getInventoryQty('SIMBED-PK-CARTON'),
    manual: await getInventoryQty('SIMBED-PK-MANUAL'),
    finished: await getInventoryQty('SIMBED-FG-01'),
  };
  assert(finalInventory.finished === baseline.finished + 24, `finished goods mismatch after both batches: ${finalInventory.finished}`);
  assert(finalInventory.foam === 0, `foam expected 0 after both batches, got ${finalInventory.foam}`);
  assert(finalInventory.carton === 0, `carton expected 0 after both batches, got ${finalInventory.carton}`);
  assert(finalInventory.manual === baseline.manual - 24, `manual mismatch after both batches: ${finalInventory.manual}`);

  const batchOrderIds = [
    ...(await getProductionOrdersByBatch(batch1.id)).map((item) => Number(item.id)),
    ...(await getProductionOrdersByBatch(batch2.id)).map((item) => Number(item.id)),
  ];
  const inspectionCount = await getInspectionCountForOrders(batchOrderIds);
  assert(inspectionCount >= batchOrderIds.length, 'quality inspections missing for production orders');

  const taskMovementCount = await getInventoryTransactionCountByProductionOrders(batchOrderIds);
  assert(taskMovementCount > 0, 'no production inventory transactions recorded');

  log('done', 'FACTORY001 joint batch full flow passed', {
    salesOrders: salesOrders.map((item) => item.orderNo),
    batches: [batch1.batchNo, batch2.batchNo],
    inspectionCount,
    finalInventory,
  });
}

main()
  .catch((error) => {
    console.error('[factory001-joint-batch] FAIL', error instanceof Error ? error.stack || error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
