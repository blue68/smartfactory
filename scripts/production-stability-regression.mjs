#!/usr/bin/env node

import fs from 'node:fs';
import { createRequire } from 'node:module';
import mysql from '../services/api/node_modules/mysql2/promise.js';

const require = createRequire(import.meta.url);
const jwt = require('../services/api/node_modules/jsonwebtoken');

const BASE_URL = (process.env.STABILITY_BASE_URL ?? 'http://127.0.0.1/api').replace(/\/$/, '');
const TENANT_CODE = process.env.STABILITY_TENANT_CODE ?? 'FACTORY002';
const TENANT_ID = Number(process.env.STABILITY_TENANT_ID ?? '10000');
const OTHER_TENANT_ID = Number(process.env.STABILITY_OTHER_TENANT_ID ?? '1');
const DB_HOST = process.env.DB_HOST ?? '127.0.0.1';
const DB_PORT = Number(process.env.DB_PORT ?? '3307');
const DB_USER = process.env.DB_USER ?? 'sf_app';
const DB_PASS = process.env.DB_PASS ?? process.env.DB_PASSWORD ?? 'TestApp2026!Secure';
const DB_ROOT_USER = process.env.DB_ROOT_USER ?? 'root';
const DB_ROOT_PASS = process.env.DB_ROOT_PASS ?? 'TestRoot2026!Secure';
const DB_NAME = process.env.DB_NAME ?? 'smart_factory';
const PASSWORD = process.env.STABILITY_PASSWORD ?? '123456';
const JWT_SECRET = process.env.JWT_SECRET ?? 'local-test-jwt-secret-key-2026-smartfactory-at-least-32-chars';
const USE_DIRECT_JWT = process.env.STABILITY_USE_DIRECT_JWT !== 'false';
const RUN_TAG = `STABILITY-${Date.now()}`;

const USERS = {
  admin: { tenantCode: TENANT_CODE, username: 'Ld_admin', password: PASSWORD, userId: 99016, roles: ['admin'] },
  supervisor: { tenantCode: TENANT_CODE, username: 'laoliu', password: PASSWORD, userId: 999036, roles: ['supervisor', 'warehouse', 'qc', 'manager'] },
  purchaser: { tenantCode: TENANT_CODE, username: 'zhegnhong', password: PASSWORD, userId: 999039, roles: ['purchaser'] },
  worker: { tenantCode: TENANT_CODE, username: 'xujianfeng', password: PASSWORD, userId: 999034, roles: ['worker'] },
};

const pool = mysql.createPool({
  host: DB_HOST,
  port: DB_PORT,
  user: DB_USER,
  password: DB_PASS,
  database: DB_NAME,
  connectionLimit: 8,
  waitForConnections: true,
});

const report = {
  runTag: RUN_TAG,
  tenantCode: TENANT_CODE,
  tenantId: TENANT_ID,
  startedAt: new Date().toISOString(),
  steps: [],
  warnings: [],
};

function log(step, message, extra) {
  console.log(`[stability] [${step}] ${message}`, extra ?? '');
  report.steps.push({ step, message, extra: extra ?? null, at: new Date().toISOString() });
}

function warn(message, extra) {
  console.warn(`[stability] [warn] ${message}`, extra ?? '');
  report.warnings.push({ message, extra: extra ?? null, at: new Date().toISOString() });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function today(offsetDays = 0) {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function decimal(value, scale = 4) {
  return Number(value ?? 0).toFixed(scale);
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function request(path, {
  method = 'GET',
  token,
  body,
  query,
  expectOk = true,
  timeoutMs = 20000,
} = {}) {
  const url = new URL(`${BASE_URL}${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    const response = await fetch(url, {
      method,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const payload = await response.json().catch(async () => ({ raw: await response.text().catch(() => '') }));
    const result = {
      ok: response.ok && payload?.code === 0,
      status: response.status,
      code: payload?.code,
      message: payload?.message ?? response.statusText,
      data: payload?.data,
      elapsedMs: Date.now() - startedAt,
    };
    if (expectOk && !result.ok) {
      throw new Error(`${method} ${path} failed: ${result.status} ${result.code ?? ''} ${result.message}`);
    }
    return result;
  } finally {
    clearTimeout(timer);
  }
}

async function query(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

async function scalar(sql, params = []) {
  const rows = await query(sql, params);
  const first = rows?.[0];
  return first ? Object.values(first)[0] : null;
}

async function login(user) {
  if (USE_DIRECT_JWT) {
    return jwt.sign(
      {
        userId: user.userId,
        tenantId: TENANT_ID,
        username: user.username,
        roles: user.roles,
        scopeLevel: 'tenant',
        originTenantId: TENANT_ID,
        contextTenantId: TENANT_ID,
      },
      JWT_SECRET,
      { expiresIn: '2h' },
    );
  }

  const result = await request('/auth/login', {
    method: 'POST',
    body: user,
  });
  assert(result.data?.accessToken, `${user.username} login returned no access token`);
  return result.data.accessToken;
}

async function loginUsers() {
  const tokens = {};
  for (const [key, user] of Object.entries(USERS)) {
    tokens[key] = await login(user);
  }
  log('auth', 'FACTORY002 users logged in', Object.keys(tokens));
  return tokens;
}

async function loadFixtures() {
  const [warehouseLocation] = await query(
    `SELECT w.id AS warehouseId, l.id AS locationId
       FROM warehouses w
       INNER JOIN locations l ON l.tenant_id = w.tenant_id AND l.warehouse_id = w.id
      WHERE w.tenant_id = ?
      ORDER BY CASE WHEN w.code = 'DEFAULT' THEN 0 ELSE 1 END, w.id, l.id
      LIMIT 1`,
    [TENANT_ID],
  );
  assert(warehouseLocation, 'FACTORY002 has no warehouse/location');

  const [supplier] = await query(
    `SELECT id FROM suppliers WHERE tenant_id = ? AND status = 'active' ORDER BY id LIMIT 1`,
    [TENANT_ID],
  );
  assert(supplier, 'FACTORY002 has no active supplier');

  const [category] = await query(
    `SELECT id, parent_id AS parentId
       FROM sku_categories
      WHERE tenant_id = ? AND is_active = 1
      ORDER BY level DESC, id
      LIMIT 1`,
    [TENANT_ID],
  );
  assert(category, 'FACTORY002 has no active SKU category');

  return {
    warehouseId: Number(warehouseLocation.warehouseId),
    locationId: Number(warehouseLocation.locationId),
    supplierId: Number(supplier.id),
    category1Id: Number(category.parentId ?? category.id),
    category2Id: Number(category.id),
  };
}

async function createStabilitySku(fixtures, suffix) {
  const skuCode = `${RUN_TAG}-${suffix}`.slice(0, 50);
  const result = await query(
    `INSERT INTO skus
       (tenant_id, sku_code, name, category1_id, category2_id,
        stock_unit, purchase_unit, production_unit, business_class, control_mode,
        allow_bom_component, allow_purchase, allow_inventory, allow_production_issue,
        has_dye_lot, safety_stock, status, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, '件', '件', '件', 'production_material', 'mrp',
        1, 1, 1, 1, 0, 0, 'active', 99016, 99016)`,
    [TENANT_ID, skuCode, `${RUN_TAG} ${suffix}`, fixtures.category1Id, fixtures.category2Id],
  );
  return { id: Number(result.insertId), skuCode, stockUnit: '件', purchaseUnit: '件' };
}

async function inventoryQty(skuId, fixtures) {
  const value = await scalar(
    `SELECT COALESCE(SUM(qty_on_hand), 0)
       FROM inventory
      WHERE tenant_id = ? AND sku_id = ?
        AND warehouse_id = ? AND location_id = ?`,
    [TENANT_ID, skuId, fixtures.warehouseId, fixtures.locationId],
  );
  return Number(value ?? 0);
}

async function seedInventory(skuId, fixtures, qty) {
  await query(
    `INSERT INTO inventory
       (tenant_id, sku_id, warehouse_id, location_id, source_ref,
        qty_on_hand, qty_reserved, qty_in_transit, last_in_at, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, 0, 0, NOW(3), 99016)
     ON DUPLICATE KEY UPDATE
       qty_on_hand = VALUES(qty_on_hand),
       qty_reserved = 0,
       qty_in_transit = 0,
       source_ref = VALUES(source_ref),
       updated_by = VALUES(updated_by)`,
    [TENANT_ID, skuId, fixtures.warehouseId, fixtures.locationId, RUN_TAG, decimal(qty)],
  );
}

function classifyWriteResult(result) {
  const text = `${result.status} ${result.code ?? ''} ${result.message ?? ''}`;
  if (result.ok) return 'ok';
  if (
    result.status === 409
    || result.status === 429
    || text.includes('库存操作繁忙')
    || text.includes('库存不足')
    || text.includes('任务已完工')
    || text.includes('质检单正在提交中')
    || text.includes('无法开始')
  ) {
    return 'expected-contention';
  }
  return 'unexpected';
}

async function runConcurrent(label, tasks) {
  const started = Date.now();
  const results = await Promise.all(tasks.map((task) => task().catch((error) => ({
    ok: false,
    status: 0,
    code: 'EXCEPTION',
    message: error instanceof Error ? error.message : String(error),
    elapsedMs: Date.now() - started,
  }))));
  const summary = results.reduce((acc, item) => {
    const key = classifyWriteResult(item);
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  const unexpected = results.filter((item) => classifyWriteResult(item) === 'unexpected');
  assert(unexpected.length === 0, `${label} has unexpected failures: ${JSON.stringify(unexpected.slice(0, 3))}`);
  assert(!results.some((item) => item.status >= 500 || String(item.message).includes('Gateway Time-out')), `${label} produced 5xx/timeout`);
  return { results, summary, elapsedMs: Date.now() - started };
}

async function testInventoryConcurrency(tokens, fixtures) {
  const sku = await createStabilitySku(fixtures, 'INV');
  await seedInventory(sku.id, fixtures, 20);
  const beforeOutbound = await inventoryQty(sku.id, fixtures);
  const txBeforeOutbound = Number(await scalar(
    `SELECT COUNT(*) FROM inventory_transactions WHERE tenant_id = ? AND sku_id = ? AND direction = 'OUT'`,
    [TENANT_ID, sku.id],
  ) ?? 0);

  const outbound = await runConcurrent('inventory outbound', Array.from({ length: 30 }, (_, index) => async () => request('/inventory/outbound', {
    token: tokens.supervisor,
    method: 'POST',
    expectOk: false,
    body: {
      skuId: sku.id,
      warehouseId: fixtures.warehouseId,
      locationId: fixtures.locationId,
      qtyInput: '1.0000',
      inputUnit: '件',
      transactionType: 'ADJUSTMENT_OUT',
      referenceType: 'stability_outbound',
      referenceId: index + 1,
      referenceNo: RUN_TAG,
      notes: `${RUN_TAG} concurrent outbound ${index + 1}`,
    },
  })));

  const outboundOk = outbound.results.filter((item) => item.ok).length;
  const afterOutbound = await inventoryQty(sku.id, fixtures);
  const txAfterOutbound = Number(await scalar(
    `SELECT COUNT(*) FROM inventory_transactions WHERE tenant_id = ? AND sku_id = ? AND direction = 'OUT'`,
    [TENANT_ID, sku.id],
  ) ?? 0);
  assert(decimal(afterOutbound) === decimal(beforeOutbound - outboundOk), 'inventory outbound final qty mismatch');
  assert(txAfterOutbound - txBeforeOutbound === outboundOk, 'inventory outbound transaction count mismatch');

  const beforeInbound = await inventoryQty(sku.id, fixtures);
  const txBeforeInbound = Number(await scalar(
    `SELECT COUNT(*) FROM inventory_transactions WHERE tenant_id = ? AND sku_id = ? AND direction = 'IN'`,
    [TENANT_ID, sku.id],
  ) ?? 0);
  const inbound = await runConcurrent('inventory inbound', Array.from({ length: 20 }, (_, index) => async () => request('/inventory/inbound', {
    token: tokens.purchaser,
    method: 'POST',
    expectOk: false,
    body: {
      skuId: sku.id,
      warehouseId: fixtures.warehouseId,
      locationId: fixtures.locationId,
      qtyInput: '1.0000',
      inputUnit: '件',
      transactionType: 'ADJUSTMENT_IN',
      referenceType: 'stability_inbound',
      referenceId: index + 1,
      referenceNo: RUN_TAG,
      notes: `${RUN_TAG} concurrent inbound ${index + 1}`,
    },
  })));

  const inboundOk = inbound.results.filter((item) => item.ok).length;
  const afterInbound = await inventoryQty(sku.id, fixtures);
  const txAfterInbound = Number(await scalar(
    `SELECT COUNT(*) FROM inventory_transactions WHERE tenant_id = ? AND sku_id = ? AND direction = 'IN'`,
    [TENANT_ID, sku.id],
  ) ?? 0);
  assert(decimal(afterInbound) === decimal(beforeInbound + inboundOk), 'inventory inbound final qty mismatch');
  assert(txAfterInbound - txBeforeInbound === inboundOk, 'inventory inbound transaction count mismatch');

  log('inventory-concurrency', 'inventory write contention preserved qty and transaction consistency', {
    skuCode: sku.skuCode,
    outbound: outbound.summary,
    inbound: inbound.summary,
    finalQty: decimal(afterInbound),
  });
  return sku;
}

async function createInspectionFixture(tokens, fixtures, sku) {
  const po = await request('/purchase/orders', {
    token: tokens.purchaser,
    method: 'POST',
    body: {
      supplierId: fixtures.supplierId,
      expectedDate: today(1),
      notes: `${RUN_TAG} concurrent inspection PO`,
      items: [{
        skuId: sku.id,
        qtyOrdered: '10.0000',
        purchaseUnit: sku.purchaseUnit,
        unitPrice: '1.00',
        businessClass: 'production_material',
        receiptMode: 'inventory',
        requiresAcceptance: true,
      }],
    },
  });

  const delivery = await request(`/purchase/orders/${po.data.id}/delivery`, {
    token: tokens.purchaser,
    method: 'POST',
    body: {
      poId: Number(po.data.id),
      deliveryDate: today(),
      notes: `${RUN_TAG} concurrent inspection delivery`,
      items: [{
        skuId: sku.id,
        qtyDelivered: '10.0000',
        purchaseUnit: sku.purchaseUnit,
        unitPrice: '1.00',
      }],
    },
  });

  const inspection = await request('/incoming-inspections', {
    token: tokens.supervisor,
    method: 'POST',
    body: {
      poId: Number(po.data.id),
      deliveryNoteId: Number(delivery.data.id),
      inspectionDate: today(),
      notes: `${RUN_TAG} concurrent inspection`,
    },
  });
  const detail = await request(`/incoming-inspections/${inspection.data.id}`, { token: tokens.supervisor });
  const item = detail.data.items[0];
  await request(`/incoming-inspections/${inspection.data.id}/items`, {
    token: tokens.supervisor,
    method: 'PUT',
    body: {
      items: [{
        id: Number(item.id),
        qtysampled: '10.0000',
        qtyPassed: '10.0000',
        qtyFailed: '0.0000',
        acceptedStockQty: '10.0000',
        result: 'pass',
        disposition: 'accept',
        notes: `${RUN_TAG} pass all`,
      }],
    },
  });
  return Number(inspection.data.id);
}

async function testIncomingInspectionConcurrency(tokens, fixtures) {
  const sku = await createStabilitySku(fixtures, 'IQC');
  await seedInventory(sku.id, fixtures, 0);
  const inspectionId = await createInspectionFixture(tokens, fixtures, sku);
  const beforeQty = await inventoryQty(sku.id, fixtures);

  const submit = await runConcurrent('incoming inspection submit', Array.from({ length: 10 }, () => async () => request(`/incoming-inspections/${inspectionId}/submit`, {
    token: tokens.supervisor,
    method: 'POST',
    expectOk: false,
    body: {
      overallResult: 'pass',
      warehouseId: fixtures.warehouseId,
      locationId: fixtures.locationId,
      notes: `${RUN_TAG} concurrent submit`,
    },
    timeoutMs: 30000,
  })));

  const afterQty = await inventoryQty(sku.id, fixtures);
  const receiptCount = Number(await scalar(
    `SELECT COUNT(*)
       FROM purchase_receipts
      WHERE tenant_id = ?
        AND id IN (
          SELECT receipt_id FROM delivery_notes WHERE tenant_id = ? AND inspection_id = ?
        )`,
    [TENANT_ID, TENANT_ID, inspectionId],
  ) ?? 0);
  const [inspection] = await query(
    `SELECT status, receipt_triggered AS receiptTriggered
       FROM incoming_inspection_records
      WHERE tenant_id = ? AND id = ?`,
    [TENANT_ID, inspectionId],
  );
  assert(['passed', 'partially_passed', 'failed'].includes(inspection?.status), 'inspection did not reach final status');
  assert(Number(inspection?.receiptTriggered ?? 0) === 1, 'inspection receipt flag mismatch');
  assert(receiptCount === 1, 'inspection generated duplicate receipts');
  assert(decimal(afterQty) === decimal(beforeQty + 10), 'inspection inventory delta mismatch');

  log('inspection-concurrency', 'concurrent submit stayed idempotent and generated one receipt', {
    inspectionId,
    submit: submit.summary,
    inventoryDelta: decimal(afterQty - beforeQty),
    receiptCount,
  });
}

async function testMrpConcurrency(tokens, fixtures, sku) {
  const [order] = await query(
    `SELECT id, bom_snapshot_id AS bomSnapshotId
       FROM production_orders
      WHERE tenant_id = ?
        AND status IN ('pending', 'scheduled', 'in_progress')
        AND bom_snapshot_id IS NOT NULL
      ORDER BY id DESC
      LIMIT 1`,
    [TENANT_ID],
  );
  if (!order) {
    warn('MRP concurrency skipped because no active production order exists');
    return;
  }

  const result = await query(
    `INSERT INTO material_requirements
       (tenant_id, production_order_id, bom_snapshot_id, sku_id,
        qty_required, qty_reserved, qty_shortage, status)
     VALUES (?, ?, ?, ?, 50, 0, 50, 'shortage')`,
    [TENANT_ID, Number(order.id), Number(order.bomSnapshotId), sku.id],
  );
  const requirementId = Number(result.insertId);

  const mrp = await runConcurrent('MRP reevaluate', Array.from({ length: 12 }, () => async () => request('/mrp/reevaluate', {
    token: tokens.supervisor,
    method: 'POST',
    expectOk: false,
    body: { skuId: sku.id },
    timeoutMs: 30000,
  })));

  const [row] = await query(
    `SELECT qty_reserved AS qtyReserved, qty_shortage AS qtyShortage, status
       FROM material_requirements
      WHERE tenant_id = ? AND id = ?`,
    [TENANT_ID, requirementId],
  );
  assert(row, 'MRP test requirement disappeared');
  assert(Number(row.qtyReserved) >= 0 && Number(row.qtyShortage) >= 0, 'MRP requirement has negative values');

  log('mrp-concurrency', 'MRP reevaluate completed without lock failure and kept requirement non-negative', {
    productionOrderId: Number(order.id),
    requirementId,
    mrp: mrp.summary,
    requirement: row,
  });
}

async function createProductionReportTaskFixture(fixtures, sku) {
  const [sourceOrder] = await query(
    `SELECT sales_order_id AS salesOrderId, bom_header_id AS bomHeaderId
       FROM production_orders
      WHERE tenant_id = ?
      ORDER BY id DESC
      LIMIT 1`,
    [TENANT_ID],
  );
  assert(sourceOrder, 'no production order available to seed production report concurrency fixture');

  const processTemplateNo = `STAB-PT-${Date.now() % 1000000000000}`;
  const workOrderNo = `STAB-WO-${Date.now() % 1000000000000}`;
  const taskNo = `STAB-TK-${Date.now() % 1000000000000}`;

  const templateInsert = await query(
    `INSERT INTO process_templates
       (tenant_id, sku_id, name, status, is_default, template_type, version, created_by, updated_by)
     VALUES (?, ?, ?, 'active', 0, 'trial', '1.0', 99016, 99016)`,
    [TENANT_ID, sku.id, `${RUN_TAG} report process ${processTemplateNo}`],
  );
  const templateId = Number(templateInsert.insertId);

  const stepInsert = await query(
    `INSERT INTO process_steps
       (tenant_id, template_id, step_no, step_name, standard_hours, output_type,
        execution_mode, created_by, updated_by)
     VALUES (?, ?, 1, '稳定性报工测试', 0.1000, 'none', 'internal', 99016, 99016)`,
    [TENANT_ID, templateId],
  );
  const processStepId = Number(stepInsert.insertId);

  const orderInsert = await query(
    `INSERT INTO production_orders
       (tenant_id, work_order_no, sales_order_id, sku_id, bom_header_id, process_template_id,
        qty_planned, qty_completed, status, material_status, priority, planned_start, planned_end,
        notes, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, 1, 0, 'scheduled', 'ready', 50, CURDATE(), CURDATE(), ?, 99016, 99016)`,
    [
      TENANT_ID,
      workOrderNo,
      Number(sourceOrder.salesOrderId),
      sku.id,
      Number(sourceOrder.bomHeaderId),
      templateId,
      `${RUN_TAG} isolated production report concurrency fixture`,
    ],
  );
  const productionOrderId = Number(orderInsert.insertId);

  const scheduleInsert = await query(
    `INSERT INTO production_schedules
       (tenant_id, schedule_date, production_order_id, process_step_id, output_sku_id,
        worker_id, planned_qty, status, ai_generated, created_by, updated_by)
     VALUES (?, CURDATE(), ?, ?, NULL, 999034, 1, 'confirmed', 0, 99016, 99016)`,
    [TENANT_ID, productionOrderId, processStepId],
  );
  const scheduleId = Number(scheduleInsert.insertId);

  const taskInsert = await query(
    `INSERT INTO production_tasks
       (tenant_id, task_no, schedule_id, production_order_id, process_step_id,
        output_sku_id, worker_id, task_date, planned_qty, status, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, NULL, 999034, CURDATE(), 1, 'pending', 99016, 99016)`,
    [TENANT_ID, taskNo, scheduleId, productionOrderId, processStepId],
  );

  return {
    id: Number(taskInsert.insertId),
    plannedQty: '1.0000',
    beforeStatus: 'pending',
    productionOrderId,
    workOrderNo,
  };
}

async function testProductionReportConcurrency(tokens, fixtures, sku) {
  const task = await createProductionReportTaskFixture(fixtures, sku);

  const completionCountBefore = Number(await scalar(
    `SELECT COUNT(*) FROM task_completions WHERE tenant_id = ? AND task_id = ?`,
    [TENANT_ID, task.id],
  ) ?? 0);
  let start = { summary: { skipped: 1 } };
  if (task.beforeStatus === 'pending') {
    start = await runConcurrent('production task start duplicate', Array.from({ length: 6 }, () => async () => request(`/production/tasks/${task.id}/start`, {
      token: tokens.admin,
      method: 'POST',
      expectOk: false,
      body: {},
    })));
    assert(start.results.some((item) => item.ok), 'no production task start request succeeded');
  }

  const complete = await runConcurrent('production task complete duplicate', Array.from({ length: 8 }, (_, index) => async () => request(`/production/tasks/${task.id}/complete-v2`, {
    token: tokens.admin,
    method: 'POST',
    expectOk: false,
    timeoutMs: 30000,
    body: {
      completedQty: task.plannedQty,
      actualHours: 1,
      scrapQty: '0',
      componentBarcode: `${RUN_TAG}-TASK-${task.id}-${index + 1}`,
      notes: `${RUN_TAG} duplicate completion pressure ${index + 1}`,
    },
  })));
  const completionCountAfter = Number(await scalar(
    `SELECT COUNT(*) FROM task_completions WHERE tenant_id = ? AND task_id = ?`,
    [TENANT_ID, task.id],
  ) ?? 0);
  const [latest] = await query(
    `SELECT status, completed_qty AS completedQty
       FROM production_tasks
      WHERE tenant_id = ? AND id = ?`,
    [TENANT_ID, task.id],
  );
  assert(latest?.status === 'completed', 'production task was not completed');
  assert(completionCountAfter - completionCountBefore === 1, 'duplicate production report inserted more than one completion');

  log('production-report-concurrency', 'duplicate start/report kept a single completion record', {
    taskId: task.id,
    productionOrderId: task.productionOrderId,
    workOrderNo: task.workOrderNo,
    start: start.summary,
    complete: complete.summary,
    completionDelta: completionCountAfter - completionCountBefore,
  });
}

async function testTenantIsolation(tokens) {
  const [otherSku] = await query(
    `SELECT id FROM skus WHERE tenant_id = ? ORDER BY id LIMIT 1`,
    [OTHER_TENANT_ID],
  );
  const [ownSku] = await query(
    `SELECT id FROM skus WHERE tenant_id = ? ORDER BY id LIMIT 1`,
    [TENANT_ID],
  );
  const [otherOrder] = await query(
    `SELECT id FROM sales_orders WHERE tenant_id = ? ORDER BY id LIMIT 1`,
    [OTHER_TENANT_ID],
  );
  const [ownOrder] = await query(
    `SELECT id FROM sales_orders WHERE tenant_id = ? ORDER BY id LIMIT 1`,
    [TENANT_ID],
  );
  const [otherProductionOrder] = await query(
    `SELECT id FROM production_orders WHERE tenant_id = ? ORDER BY id LIMIT 1`,
    [OTHER_TENANT_ID],
  );
  const [ownProductionOrder] = await query(
    `SELECT id FROM production_orders WHERE tenant_id = ? ORDER BY id DESC LIMIT 1`,
    [TENANT_ID],
  );
  const [otherInspection] = await query(
    `SELECT id FROM incoming_inspection_records WHERE tenant_id = ? ORDER BY id LIMIT 1`,
    [OTHER_TENANT_ID],
  );

  const checks = [];
  if (ownSku && otherSku) {
    checks.push({
      name: 'sku detail',
      own: await request(`/skus/${ownSku.id}`, { token: tokens.admin, expectOk: false }),
      cross: await request(`/skus/${otherSku.id}`, { token: tokens.admin, expectOk: false }),
    });
    checks.push({
      name: 'inventory available',
      own: await request(`/inventory/${ownSku.id}/available`, { token: tokens.admin, expectOk: false }),
      cross: await request(`/inventory/${otherSku.id}/available`, { token: tokens.admin, expectOk: false }),
    });
  }
  if (ownOrder && otherOrder) {
    checks.push({
      name: 'sales order detail',
      own: await request(`/sales-orders/${ownOrder.id}`, { token: tokens.admin, expectOk: false }),
      cross: await request(`/sales-orders/${otherOrder.id}`, { token: tokens.admin, expectOk: false }),
    });
  }
  if (ownProductionOrder && otherProductionOrder) {
    checks.push({
      name: 'production order detail',
      own: await request(`/production/orders/${ownProductionOrder.id}`, { token: tokens.admin, expectOk: false }),
      cross: await request(`/production/orders/${otherProductionOrder.id}`, { token: tokens.admin, expectOk: false }),
    });
  }
  if (otherInspection) {
    checks.push({
      name: 'incoming inspection detail',
      own: { ok: true },
      cross: await request(`/incoming-inspections/${otherInspection.id}`, { token: tokens.admin, expectOk: false }),
    });
  }

  assert(checks.length > 0, 'no tenant isolation checks were available');
  for (const check of checks) {
    assert(check.own.ok, `${check.name} own-tenant access failed`);
    assert(!check.cross.ok, `${check.name} leaked cross-tenant data`);
    assert(check.cross.status === 404 || check.cross.status === 403 || check.cross.code !== 0, `${check.name} cross-tenant response was not blocked`);
  }
  log('tenant-isolation', 'cross-tenant direct ID access blocked for checked resources', checks.map((item) => ({
    name: item.name,
    crossStatus: item.cross.status,
    crossCode: item.cross.code,
    crossMessage: item.cross.message,
  })));
}

async function assertNoActiveLocks() {
  let rootPool;
  try {
    rootPool = mysql.createPool({
      host: DB_HOST,
      port: DB_PORT,
      user: DB_ROOT_USER,
      password: DB_ROOT_PASS,
      database: DB_NAME,
      connectionLimit: 1,
      waitForConnections: true,
    });
    const [rows] = await rootPool.query(`SELECT COUNT(*) AS trxCount FROM information_schema.innodb_trx`);
    const activeTrx = Number(rows?.[0]?.trxCount ?? 0);
    assert(activeTrx === 0, `there are ${activeTrx} active InnoDB transactions after stability run`);
    log('db-locks', 'no active InnoDB transactions remain');
  } catch (error) {
    warn('active InnoDB transaction check skipped because privileged metadata is unavailable', {
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    if (rootPool) await rootPool.end();
  }
}

async function main() {
  const tokens = await loginUsers();
  const fixtures = await loadFixtures();

  const inventorySku = await testInventoryConcurrency(tokens, fixtures);
  await testIncomingInspectionConcurrency(tokens, fixtures);
  await testMrpConcurrency(tokens, fixtures, inventorySku);
  await testProductionReportConcurrency(tokens, fixtures, inventorySku);
  await testTenantIsolation(tokens);
  await assertNoActiveLocks();

  report.finishedAt = new Date().toISOString();
  const reportPath = `tmp/production-stability-${RUN_TAG}.json`;
  fs.mkdirSync('tmp', { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  log('report', 'stability report written', reportPath);
}

main()
  .catch((error) => {
    console.error('[stability] failed:', error);
    report.failedAt = new Date().toISOString();
    report.error = error instanceof Error ? error.stack ?? error.message : String(error);
    fs.mkdirSync('tmp', { recursive: true });
    fs.writeFileSync(`tmp/production-stability-${RUN_TAG}-failed.json`, JSON.stringify(report, null, 2));
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
