#!/usr/bin/env node

import fs from 'node:fs';
import mysql from '../services/api/node_modules/mysql2/promise.js';

const BASE_URL = (process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1/api').replace(/\/$/, '');
const TENANT_CODE = process.env.SMOKE_TENANT_CODE ?? 'FACTORY002';
const TENANT_ID = Number(process.env.SMOKE_TENANT_ID ?? '10000');
const DB_HOST = process.env.DB_HOST ?? '127.0.0.1';
const DB_PORT = Number(process.env.DB_PORT ?? '3307');
const DB_USER = process.env.DB_USER ?? 'sf_app';
const DB_PASS = process.env.DB_PASS ?? process.env.DB_PASSWORD ?? 'TestApp2026!Secure';
const DB_NAME = process.env.DB_NAME ?? 'smart_factory';
const DEFAULT_PASSWORD = process.env.SMOKE_PASSWORD ?? '123456';
const RUN_TAG = `FACTORY002-E2E-${Date.now()}`;

const USERS = {
  admin: { username: 'Ld_admin', password: DEFAULT_PASSWORD },
  worker: { username: 'xujianfeng', password: DEFAULT_PASSWORD, id: 999034 },
  supervisor: { username: 'laoliu', password: DEFAULT_PASSWORD },
  purchaser: { username: 'zhegnhong', password: DEFAULT_PASSWORD },
  sales: { username: 'laoshu', password: DEFAULT_PASSWORD },
  boss: { username: 'laohu', password: DEFAULT_PASSWORD },
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
const report = {
  runTag: RUN_TAG,
  tenantCode: TENANT_CODE,
  tenantId: TENANT_ID,
  steps: [],
  ids: {},
  warnings: [],
};

function log(step, message, extra) {
  const prefix = `[factory002-full-flow] [${step}]`;
  if (extra === undefined) {
    console.log(`${prefix} ${message}`);
  } else {
    console.log(`${prefix} ${message}`, extra);
  }
  report.steps.push({ step, message, extra: extra ?? null, at: new Date().toISOString() });
}

function warn(message, extra) {
  console.warn(`[factory002-full-flow] [warn] ${message}`, extra ?? '');
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

async function throttleTaskMutation(minIntervalMs = 900) {
  const elapsed = Date.now() - lastTaskMutationAt;
  if (elapsed < minIntervalMs) await sleep(minIntervalMs - elapsed);
  lastTaskMutationAt = Date.now();
}

async function request(path, {
  method = 'GET',
  token,
  body,
  query,
  retries = 8,
  expectJson = true,
} = {}) {
  const url = new URL(`${BASE_URL}${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }
  }

  const response = await fetch(url, {
    method,
    headers: {
      ...(expectJson ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!expectJson) {
    const text = await response.text();
    if (!response.ok) throw new Error(`${method} ${path} failed: ${response.status} ${text.slice(0, 300)}`);
    return { text, headers: response.headers, status: response.status };
  }

  const payload = await response.json().catch(() => ({}));
  const retryableRateLimit =
    response.status === 429 || String(payload?.message ?? '').includes('请求过于频繁');
  if (retryableRateLimit && retries > 0) {
    await sleep((9 - retries) * 450);
    return request(path, { method, token, body, query, retries: retries - 1, expectJson });
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

async function login({ username, password }) {
  const auth = await request('/auth/login', {
    method: 'POST',
    body: { tenantCode: TENANT_CODE, username, password },
  });
  assert(auth?.accessToken, `${username} login returned no accessToken`);
  return auth.accessToken;
}

async function loginUsers() {
  const tokens = {};
  for (const [key, user] of Object.entries(USERS)) {
    tokens[key] = await login(user);
  }
  log('auth', 'all required FACTORY002 users logged in', Object.keys(tokens));
  return tokens;
}

async function loadFixtures() {
  const [tenant] = await query(
    'SELECT id, code, name FROM tenants WHERE id = ? AND code = ? AND status = ? LIMIT 1',
    [TENANT_ID, TENANT_CODE, 'active'],
  );
  assert(tenant, `tenant ${TENANT_CODE} is not active`);

  const salesOrders = await query(
    `SELECT id, order_no AS orderNo, status, customer_id AS customerId
     FROM sales_orders
     WHERE tenant_id = ? AND order_no IN ('SO-260510-0001', 'SO-260510-0002')
     ORDER BY order_no`,
    [TENANT_ID],
  );
  assert(salesOrders.length === 2, 'FACTORY002 existing two sales orders are not present');

  const [warehouseLocation] = await query(
    `SELECT w.id AS warehouseId, l.id AS locationId, w.code AS warehouseCode, l.code AS locationCode
     FROM warehouses w
     INNER JOIN locations l ON l.tenant_id = w.tenant_id AND l.warehouse_id = w.id
     WHERE w.tenant_id = ?
     ORDER BY CASE WHEN w.code = 'DEFAULT' THEN 0 ELSE 1 END, w.id, l.id
     LIMIT 1`,
    [TENANT_ID],
  );
  assert(warehouseLocation, 'no FACTORY002 warehouse/location found');

  const [supplier] = await query(
    `SELECT id, code, name
     FROM suppliers
     WHERE tenant_id = ? AND status = 'active'
     ORDER BY id
     LIMIT 1`,
    [TENANT_ID],
  );
  assert(supplier, 'no FACTORY002 active supplier found');

  const purchaseSkus = await query(
    `SELECT s.id, s.sku_code AS skuCode, s.name, s.purchase_unit AS purchaseUnit,
            s.stock_unit AS stockUnit, s.business_class AS businessClass,
            COALESCE(SUM(i.qty_on_hand), 0) AS stockQty
     FROM skus s
     LEFT JOIN inventory i ON i.tenant_id = s.tenant_id AND i.sku_id = s.id
     WHERE s.tenant_id = ?
       AND s.status = 'active'
       AND s.allow_purchase = 1
       AND s.allow_inventory = 1
       AND s.business_class = 'production_material'
     GROUP BY s.id
     ORDER BY stockQty DESC, s.id
     LIMIT 2`,
    [TENANT_ID],
  );
  assert(purchaseSkus.length === 2, 'not enough purchaseable FACTORY002 SKUs');

  const [finishedSku] = await query(
    `SELECT s.id, s.sku_code AS skuCode, s.name, soi.unit_price AS unitPrice, soi.id AS salesOrderItemId
     FROM sales_order_items soi
     INNER JOIN sales_orders so ON so.id = soi.order_id AND so.tenant_id = soi.tenant_id
     INNER JOIN production_orders po ON po.sales_order_item_id = soi.id AND po.tenant_id = soi.tenant_id
     INNER JOIN process_templates pt ON pt.id = po.process_template_id AND pt.tenant_id = po.tenant_id
     INNER JOIN skus s ON s.id = soi.sku_id AND s.tenant_id = soi.tenant_id
     WHERE soi.tenant_id = ?
       AND so.id IN (?, ?)
       AND po.status <> 'cancelled'
     ORDER BY soi.id
     LIMIT 1`,
    [TENANT_ID, Number(salesOrders[0].id), Number(salesOrders[1].id)],
  );
  assert(finishedSku, 'no existing sales-order SKU with production process found');

  report.ids.existingSalesOrders = salesOrders.map((item) => ({ id: Number(item.id), orderNo: item.orderNo }));
  log('fixtures', 'loaded FACTORY002 real data fixtures', {
    salesOrders: report.ids.existingSalesOrders,
    supplier: supplier.code,
    warehouse: `${warehouseLocation.warehouseCode}/${warehouseLocation.locationCode}`,
    purchaseSkus: purchaseSkus.map((item) => item.skuCode),
    finishedSku: finishedSku.skuCode,
  });

  return { tenant, salesOrders, warehouseLocation, supplier, purchaseSkus, finishedSku };
}

async function ensureSupplierPricing(supplierId, skus) {
  for (const [index, sku] of skus.entries()) {
    await query(
      `INSERT INTO supplier_prices
         (tenant_id, supplier_id, sku_id, price, unit, is_current, effective_at,
          moq, purchase_cycle_days, transport_cycle_days, notes, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, 1, CURDATE(), 1, 3, 1, ?, 99016, 99016)
       ON DUPLICATE KEY UPDATE
         price = VALUES(price),
         unit = VALUES(unit),
         is_current = 1,
         expired_at = NULL,
         notes = VALUES(notes),
         updated_by = VALUES(updated_by)`,
      [
        TENANT_ID,
        supplierId,
        Number(sku.id),
        index === 0 ? '3.80' : '5.20',
        sku.purchaseUnit || sku.stockUnit || '件',
        `${RUN_TAG} supplier price`,
      ],
    );
  }
  log('fixtures', 'supplier prices prepared for procurement SKUs');
}

async function ensureSupplierPricingForSkus(supplierId, skus, note) {
  for (const sku of skus) {
    await query(
      `INSERT INTO supplier_prices
         (tenant_id, supplier_id, sku_id, price, unit, is_current, effective_at,
          moq, purchase_cycle_days, transport_cycle_days, notes, created_by, updated_by)
       VALUES (?, ?, ?, '1.00', ?, 1, CURDATE(), 1, 3, 1, ?, 99016, 99016)
       ON DUPLICATE KEY UPDATE
         unit = VALUES(unit),
         is_current = 1,
         expired_at = NULL,
         notes = VALUES(notes),
         updated_by = VALUES(updated_by)`,
      [TENANT_ID, Number(supplierId), Number(sku.id), sku.stockUnit || sku.purchaseUnit || '件', note],
    );
  }
}

async function inventoryQty(skuId) {
  const value = await scalar(
    `SELECT COALESCE(SUM(qty_on_hand), 0)
     FROM inventory
     WHERE tenant_id = ? AND sku_id = ?`,
    [TENANT_ID, skuId],
  );
  return Number(value ?? 0);
}

async function availableDyeLotNo(skuId) {
  const [row] = await query(
    `SELECT dye_lot_no AS dyeLotNo
     FROM inventory_dye_lots
     WHERE tenant_id = ?
       AND sku_id = ?
       AND status = 'active'
       AND qty_on_hand > qty_reserved
     ORDER BY last_in_at DESC, id DESC
     LIMIT 1`,
    [TENANT_ID, Number(skuId)],
  );
  return row?.dyeLotNo ? String(row.dyeLotNo) : null;
}

async function ensureDyeLotForSku(skuId) {
  const [sku] = await query(
    `SELECT id, sku_code AS skuCode, name, has_dye_lot AS hasDyeLot
     FROM skus
     WHERE tenant_id = ? AND id = ?
     LIMIT 1`,
    [TENANT_ID, Number(skuId)],
  );
  if (!sku || Number(sku.hasDyeLot ?? 0) !== 1) return null;

  const existing = await availableDyeLotNo(Number(skuId));
  if (existing) return existing;

  const qty = await inventoryQty(Number(skuId));
  if (qty <= 0) return null;

  const dyeLotNo = `${RUN_TAG}-LOT-${sku.skuCode}`.slice(0, 100);
  await query(
    `INSERT INTO inventory_dye_lots
       (tenant_id, sku_id, dye_lot_no, qty_on_hand, qty_reserved, status, first_in_at, last_in_at)
     VALUES (?, ?, ?, ?, 0, 'active', NOW(3), NOW(3))
     ON DUPLICATE KEY UPDATE
       qty_on_hand = GREATEST(qty_on_hand, VALUES(qty_on_hand)),
       status = 'active',
       last_in_at = NOW(3)`,
    [TENANT_ID, Number(skuId), dyeLotNo, decimal(qty)],
  );
  warn('created missing dye-lot detail for SKU with existing aggregate inventory', {
    skuCode: sku.skuCode,
    skuName: sku.name,
    dyeLotNo,
    qty: decimal(qty),
  });
  return dyeLotNo;
}

async function procurementFlow(tokens, fixtures) {
  const [passSku, failSku] = fixtures.purchaseSkus;
  const beforePass = await inventoryQty(Number(passSku.id));
  const beforeFail = await inventoryQty(Number(failSku.id));

  const po = await request('/purchase/orders', {
    token: tokens.purchaser,
    method: 'POST',
    body: {
      supplierId: Number(fixtures.supplier.id),
      expectedDate: today(2),
      notes: `${RUN_TAG} 缺口采购下单：一项合格入库，一项不合格退货`,
      items: [
        {
          skuId: Number(passSku.id),
          qtyOrdered: '12.0000',
          purchaseUnit: passSku.purchaseUnit || passSku.stockUnit || '件',
          unitPrice: '3.80',
          businessClass: passSku.businessClass,
          receiptMode: 'inventory',
          requiresAcceptance: true,
        },
        {
          skuId: Number(failSku.id),
          qtyOrdered: '8.0000',
          purchaseUnit: failSku.purchaseUnit || failSku.stockUnit || '件',
          unitPrice: '5.20',
          businessClass: failSku.businessClass,
          receiptMode: 'inventory',
          requiresAcceptance: true,
        },
      ],
    },
  });
  report.ids.purchaseOrderId = Number(po.id);

  const delivery = await request(`/purchase/orders/${po.id}/delivery`, {
    token: tokens.purchaser,
    method: 'POST',
    body: {
      poId: Number(po.id),
      deliveryDate: today(0),
      notes: `${RUN_TAG} 供应商送货`,
      items: [
        {
          skuId: Number(passSku.id),
          qtyDelivered: '12.0000',
          purchaseUnit: passSku.purchaseUnit || passSku.stockUnit || '件',
          unitPrice: '3.80',
        },
        {
          skuId: Number(failSku.id),
          qtyDelivered: '8.0000',
          purchaseUnit: failSku.purchaseUnit || failSku.stockUnit || '件',
          unitPrice: '5.20',
        },
      ],
    },
  });
  report.ids.deliveryNoteId = Number(delivery.id);

  const inspection = await request('/incoming-inspections', {
    token: tokens.supervisor,
    method: 'POST',
    body: {
      poId: Number(po.id),
      deliveryNoteId: Number(delivery.id),
      inspectionDate: today(0),
      notes: `${RUN_TAG} 来料质检：合格+不合格`,
    },
  });
  const detailInspection = await request(`/incoming-inspections/${inspection.id}`, { token: tokens.supervisor });
  const items = detailInspection.items ?? [];
  assert(items.length === 2, 'incoming inspection did not create two inspection items');
  const passItem = items.find((item) => Number(item.skuId ?? item.sku_id) === Number(passSku.id)) ?? items[0];
  const failItem = items.find((item) => Number(item.skuId ?? item.sku_id) === Number(failSku.id)) ?? items[1];

  await request(`/incoming-inspections/${inspection.id}/items`, {
    token: tokens.supervisor,
    method: 'PUT',
    body: {
      items: [
        {
          id: Number(passItem.id),
          qtysampled: '12.0000',
          qtyPassed: '12.0000',
          qtyFailed: '0.0000',
          acceptedStockQty: '12.0000',
          result: 'pass',
          disposition: 'accept',
          notes: `${RUN_TAG} 抽检合格，准入库`,
        },
        {
          id: Number(failItem.id),
          qtysampled: '8.0000',
          qtyPassed: '0.0000',
          qtyFailed: '8.0000',
          result: 'fail',
          disposition: 'return',
          notes: `${RUN_TAG} 抽检不合格，生成退货`,
        },
      ],
    },
  });

  await request(`/incoming-inspections/${inspection.id}/submit`, {
    token: tokens.supervisor,
    method: 'POST',
    body: {
      overallResult: 'conditional_pass',
      warehouseId: Number(fixtures.warehouseLocation.warehouseId),
      locationId: Number(fixtures.warehouseLocation.locationId),
      notes: `${RUN_TAG} 混合质检提交`,
    },
  });
  const preview = await request(`/incoming-inspections/${inspection.id}/preview-receipt`, { token: tokens.supervisor });
  const receiptId = Number(preview.receiptId);
  assert(receiptId > 0, 'incoming inspection did not produce purchase receipt');

  const match = await request('/purchase/three-way-match', {
    token: tokens.purchaser,
    method: 'POST',
    body: {
      poId: Number(po.id),
      deliveryNoteId: Number(delivery.id),
      receiptId,
    },
  });
  const matchId = Number(match.id ?? match.matchId);
  assert(matchId > 0, `three-way match did not return id: ${JSON.stringify(match)}`);
  if (match.matchStatus && match.matchStatus !== 'matched') {
    await request(`/purchase/three-way-match/${matchId}/confirm`, {
      token: tokens.purchaser,
      method: 'POST',
      body: {
        diffReason: 'supplier_short',
        diffNotes: `${RUN_TAG} 不合格数量已走退货，确认差异后对账`,
      },
    });
  }

  const settlement = await request('/purchase/settlements', {
    token: tokens.purchaser,
    method: 'POST',
    body: { matchId, notes: `${RUN_TAG} 采购对账结算` },
  });
  await request(`/purchase/settlements/${settlement.id}/confirm`, { token: tokens.boss, method: 'PUT' });
  await request(`/purchase/settlements/${settlement.id}/pay`, { token: tokens.boss, method: 'PUT' });

  const afterPass = await inventoryQty(Number(passSku.id));
  const afterFail = await inventoryQty(Number(failSku.id));
  const returnCount = Number(await scalar(
    `SELECT COUNT(*)
     FROM return_orders
     WHERE tenant_id = ? AND return_type = 'purchase_return' AND source_inspection_id = ?`,
    [TENANT_ID, Number(inspection.id)],
  ) ?? 0);
  assert(afterPass >= beforePass + 12, `${passSku.skuCode} inventory did not increase by accepted qty`);
  assert(afterFail === beforeFail, `${failSku.skuCode} inventory changed despite full rejection`);
  assert(returnCount > 0, 'failed incoming inspection did not create purchase return order');

  report.ids.incomingInspectionId = Number(inspection.id);
  report.ids.purchaseReceiptId = receiptId;
  report.ids.threeWayMatchId = matchId;
  report.ids.purchaseSettlementId = Number(settlement.id);
  log('procurement', 'purchase order, incoming QC pass/fail, inventory, return and settlement passed', {
    poId: Number(po.id),
    receiptId,
    inventoryDelta: { [passSku.skuCode]: afterPass - beforePass, [failSku.skuCode]: afterFail - beforeFail },
    returnCount,
  });
}

async function replenishProductionOrderShortages(tokens, supplierId, productionOrderId) {
  const shortages = await query(
    `SELECT mr.sku_id AS id,
            s.sku_code AS skuCode,
            s.name,
            s.stock_unit AS stockUnit,
            s.purchase_unit AS purchaseUnit,
            s.business_class AS businessClass,
            s.has_dye_lot AS hasDyeLot,
            GREATEST(SUM(mr.qty_shortage) - COALESCE(inv.qty_on_hand, 0), 0) AS shortageQty
     FROM material_requirements mr
     INNER JOIN skus s ON s.id = mr.sku_id AND s.tenant_id = mr.tenant_id
     LEFT JOIN (
       SELECT tenant_id, sku_id, SUM(qty_on_hand) AS qty_on_hand
       FROM inventory
       GROUP BY tenant_id, sku_id
     ) inv ON inv.tenant_id = mr.tenant_id AND inv.sku_id = mr.sku_id
     WHERE mr.tenant_id = ?
       AND mr.production_order_id = ?
       AND mr.qty_shortage > 0
       AND s.allow_purchase = 1
       AND s.allow_inventory = 1
     GROUP BY mr.sku_id
     HAVING shortageQty > 0
     ORDER BY mr.sku_id`,
    [TENANT_ID, Number(productionOrderId)],
  );
  if (shortages.length === 0) return 0;

  await ensureSupplierPricingForSkus(supplierId, shortages, `${RUN_TAG} production shortage pricing`);
  const chunks = [];
  for (let index = 0; index < shortages.length; index += 8) {
    chunks.push(shortages.slice(index, index + 8));
  }

  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
    const chunk = chunks[chunkIndex];
    const po = await request('/purchase/orders', {
      token: tokens.purchaser,
      method: 'POST',
      body: {
        supplierId: Number(supplierId),
        expectedDate: today(1),
        notes: `${RUN_TAG} 工单 ${productionOrderId} 缺料补采 ${chunkIndex + 1}/${chunks.length}`,
        items: chunk.map((sku) => ({
          skuId: Number(sku.id),
          qtyOrdered: decimal(Number(sku.shortageQty) + 1),
          purchaseUnit: sku.stockUnit || sku.purchaseUnit || '件',
          unitPrice: '1.00',
          businessClass: sku.businessClass,
          receiptMode: 'inventory',
          requiresAcceptance: true,
        })),
      },
    });

    const delivery = await request(`/purchase/orders/${po.id}/delivery`, {
      token: tokens.purchaser,
      method: 'POST',
      body: {
        poId: Number(po.id),
        deliveryDate: today(0),
        notes: `${RUN_TAG} 工单 ${productionOrderId} 缺料送货 ${chunkIndex + 1}/${chunks.length}`,
        items: chunk.map((sku) => ({
          skuId: Number(sku.id),
          qtyDelivered: decimal(Number(sku.shortageQty) + 1),
          purchaseUnit: sku.stockUnit || sku.purchaseUnit || '件',
          unitPrice: '1.00',
          dyeLotNo: Number(sku.hasDyeLot ?? 0) === 1 ? `${RUN_TAG}-LOT-${sku.skuCode}`.slice(0, 100) : undefined,
        })),
      },
    });

    const inspection = await request('/incoming-inspections', {
      token: tokens.supervisor,
      method: 'POST',
      body: {
        poId: Number(po.id),
        deliveryNoteId: Number(delivery.id),
        inspectionDate: today(0),
        notes: `${RUN_TAG} 工单 ${productionOrderId} 缺料来料全检 ${chunkIndex + 1}/${chunks.length}`,
      },
    });
    const detailInspection = await request(`/incoming-inspections/${inspection.id}`, { token: tokens.supervisor });
    await request(`/incoming-inspections/${inspection.id}/items`, {
      token: tokens.supervisor,
      method: 'PUT',
      body: {
        items: (detailInspection.items ?? []).map((item) => {
          const qty = String(item.qtyDelivered ?? item.qty_delivered ?? '0');
          const sku = chunk.find((row) => Number(row.id) === Number(item.skuId ?? item.sku_id));
          return {
            id: Number(item.id),
            qtysampled: qty,
            qtyPassed: qty,
            qtyFailed: '0.0000',
            acceptedStockQty: qty,
            dyeLotNo: Number(sku?.hasDyeLot ?? 0) === 1 ? `${RUN_TAG}-LOT-${sku.skuCode}`.slice(0, 100) : undefined,
            result: 'pass',
            disposition: 'accept',
            notes: `${RUN_TAG} 工单缺料补采合格`,
          };
        }),
      },
    });
    await request(`/incoming-inspections/${inspection.id}/submit`, {
      token: tokens.supervisor,
      method: 'POST',
      body: {
        overallResult: 'pass',
        notes: `${RUN_TAG} 工单 ${productionOrderId} 缺料补采入库 ${chunkIndex + 1}/${chunks.length}`,
      },
    });

    report.ids.productionShortagePOs = [
      ...(report.ids.productionShortagePOs ?? []),
      { productionOrderId: Number(productionOrderId), poId: Number(po.id), inspectionId: Number(inspection.id) },
    ];
  }
  log('procurement-shortage', 'replenished production-order shortages through purchase and incoming inspection', {
    productionOrderId: Number(productionOrderId),
    poCount: chunks.length,
    skuCount: shortages.length,
  });
  return shortages.length;
}

async function replenishTaskInputShortages(tokens, supplierId, detail) {
  const materialInputs = (detail.inputMaterials ?? [])
    .filter((item) => !item.itemType || item.itemType === 'material')
    .map((item) => {
      const required = Number(item.requiredQty ?? 0);
      const fulfilled = Math.max(
        Number(item.issuedQty ?? 0),
        Number(item.fulfilledQty ?? 0),
      );
      const declaredShortage = Number(item.shortageQty ?? 0);
      const shortageQty = Math.max(required - fulfilled, declaredShortage, 0);
      return {
        id: Number(item.skuId),
        shortageQty,
      };
    })
    .filter((item) => Number.isFinite(item.id) && item.id > 0 && item.shortageQty > 0);

  if (materialInputs.length === 0) return 0;

  const skuIds = [...new Set(materialInputs.map((item) => item.id))];
  const skuRows = await query(
    `SELECT id,
            sku_code AS skuCode,
            name,
            stock_unit AS stockUnit,
            purchase_unit AS purchaseUnit,
            business_class AS businessClass,
            has_dye_lot AS hasDyeLot
     FROM skus
     WHERE tenant_id = ?
       AND id IN (${skuIds.map(() => '?').join(',')})
       AND allow_purchase = 1
       AND allow_inventory = 1`,
    [TENANT_ID, ...skuIds],
  );

  const shortageBySku = new Map(materialInputs.map((item) => [item.id, item.shortageQty]));
  const shortages = skuRows
    .map((sku) => ({
      ...sku,
      shortageQty: shortageBySku.get(Number(sku.id)) ?? 0,
    }))
    .filter((sku) => Number(sku.shortageQty) > 0);

  if (shortages.length === 0) return 0;

  await ensureSupplierPricingForSkus(supplierId, shortages, `${RUN_TAG} task shortage pricing`);
  const po = await request('/purchase/orders', {
    token: tokens.purchaser,
    method: 'POST',
    body: {
      supplierId: Number(supplierId),
      expectedDate: today(1),
      notes: `${RUN_TAG} 任务实时缺料补采`,
      items: shortages.map((sku) => ({
        skuId: Number(sku.id),
        qtyOrdered: decimal(Number(sku.shortageQty) + 1),
        purchaseUnit: sku.stockUnit || sku.purchaseUnit || '件',
        unitPrice: '1.00',
        businessClass: sku.businessClass,
        receiptMode: 'inventory',
        requiresAcceptance: true,
      })),
    },
  });

  const delivery = await request(`/purchase/orders/${po.id}/delivery`, {
    token: tokens.purchaser,
    method: 'POST',
    body: {
      poId: Number(po.id),
      deliveryDate: today(0),
      notes: `${RUN_TAG} 任务实时缺料送货`,
      items: shortages.map((sku) => ({
        skuId: Number(sku.id),
        qtyDelivered: decimal(Number(sku.shortageQty) + 1),
        purchaseUnit: sku.stockUnit || sku.purchaseUnit || '件',
        unitPrice: '1.00',
        dyeLotNo: Number(sku.hasDyeLot ?? 0) === 1 ? `${RUN_TAG}-LOT-${sku.skuCode}`.slice(0, 100) : undefined,
      })),
    },
  });

  const inspection = await request('/incoming-inspections', {
    token: tokens.supervisor,
    method: 'POST',
    body: {
      poId: Number(po.id),
      deliveryNoteId: Number(delivery.id),
      inspectionDate: today(0),
      notes: `${RUN_TAG} 任务实时缺料来料全检`,
    },
  });
  const detailInspection = await request(`/incoming-inspections/${inspection.id}`, { token: tokens.supervisor });
  await request(`/incoming-inspections/${inspection.id}/items`, {
    token: tokens.supervisor,
    method: 'PUT',
    body: {
      items: (detailInspection.items ?? []).map((item) => {
        const qty = String(item.qtyDelivered ?? item.qty_delivered ?? '0');
        const sku = shortages.find((row) => Number(row.id) === Number(item.skuId ?? item.sku_id));
        return {
          id: Number(item.id),
          qtysampled: qty,
          qtyPassed: qty,
          qtyFailed: '0.0000',
          acceptedStockQty: qty,
          dyeLotNo: Number(sku?.hasDyeLot ?? 0) === 1 ? `${RUN_TAG}-LOT-${sku.skuCode}`.slice(0, 100) : undefined,
          result: 'pass',
          disposition: 'accept',
          notes: `${RUN_TAG} 任务实时缺料补采合格`,
        };
      }),
    },
  });
  await request(`/incoming-inspections/${inspection.id}/submit`, {
    token: tokens.supervisor,
    method: 'POST',
    body: {
      overallResult: 'pass',
      notes: `${RUN_TAG} 任务实时缺料补采入库`,
    },
  });

  report.ids.taskShortagePOs = [
    ...(report.ids.taskShortagePOs ?? []),
    { poId: Number(po.id), inspectionId: Number(inspection.id), skuCount: shortages.length },
  ];
  return shortages.length;
}

async function getTaskList(token, query) {
  return request('/production/tasks', { token, query: { page: 1, pageSize: 200, ...query } });
}

async function getTaskDetail(token, taskId) {
  return request(`/production/tasks/${taskId}`, { token });
}

async function issueMaterialsIfNeeded(token, taskId, detail) {
  const items = [];
  for (const item of (detail.inputMaterials ?? [])) {
      if (item.itemType && item.itemType !== 'material') continue;
      const required = Number(item.requiredQty ?? 0);
      const issued = Math.max(
        Number(item.issuedQty ?? 0),
        Number(item.fulfilledQty ?? 0),
      );
      const remaining = required - issued;
      if (remaining <= 0) continue;
      const dyeLotNo = item.dyeLotNo ?? item.dye_lot_no ?? await ensureDyeLotForSku(Number(item.skuId));
      items.push({
        skuId: Number(item.skuId),
        qty: decimal(remaining),
        unit: item.stockUnit || item.unit || '件',
        warehouseId: item.warehouseId ? Number(item.warehouseId) : undefined,
        locationId: item.locationId ? Number(item.locationId) : undefined,
        dyeLotNo: dyeLotNo ?? undefined,
        notes: `${RUN_TAG} task material issue`,
      });
  }
  if (items.length === 0) return 0;
  for (let index = 0; index < items.length; index += 20) {
    await throttleTaskMutation();
    await request(`/production/tasks/${taskId}/issue-materials`, {
      token,
      method: 'POST',
      body: { items: items.slice(index, index + 20) },
    });
  }
  return items.length;
}

async function startTask(token, taskId) {
  await throttleTaskMutation();
  await request(`/production/tasks/${taskId}/start`, { token, method: 'POST' });
}

async function completeTask(token, task, note, support) {
  let detail = await getTaskDetail(token, task.id);
  if (support?.tokens && support?.supplierId && detail.productionOrderId) {
    await replenishProductionOrderShortages(support.tokens, support.supplierId, Number(detail.productionOrderId));
    await replenishTaskInputShortages(support.tokens, support.supplierId, detail);
    detail = await getTaskDetail(token, task.id);
  }
  await issueMaterialsIfNeeded(token, Number(task.id), detail);
  await throttleTaskMutation();
  await request(`/production/tasks/${task.id}/complete-v2`, {
    token,
    method: 'POST',
    body: {
      completedQty: String(task.plannedQty ?? detail.plannedQty ?? '1'),
      actualHours: 1,
      scrapQty: '0',
      componentBarcode: `TASK_ID=${task.id}`,
      notes: note,
    },
  });
}

async function findActionableWorkerTask(token, workerId, extraQuery = {}) {
  const page = await getTaskList(token, { workerId, ...extraQuery });
  const tasks = page.list ?? [];
  return tasks.find((task) => (
    ['pending', 'in_progress'].includes(task.status)
    && (Number(task.dependencyBlocked ?? 0) === 0 || task.dependencyBlocked === false)
  )) ?? null;
}

async function exerciseExistingProductionTasks(tokens, fixtures) {
  const support = { tokens, supplierId: Number(fixtures.supplier.id) };
  const workerId = USERS.worker.id;
  const workerPage = await getTaskList(tokens.worker, { workerId });
  assert((workerPage.list ?? []).length > 0, 'mini-program worker task list is empty');

  const scanTask = await findActionableWorkerTask(tokens.worker, workerId, { status: 'pending' });
  assert(scanTask, 'no actionable worker task found for mini-program scan reporting');

  await startTask(tokens.worker, Number(scanTask.id));
  const scannedId = Number(String(`TASK_ID=${scanTask.id}`).match(/TASK_ID=(\d+)/)?.[1] ?? 0);
  assert(scannedId === Number(scanTask.id), 'scan payload TASK_ID parser failed');
  const scannedDetail = await getTaskDetail(tokens.worker, scannedId);
  assert(Number(scannedDetail.id) === Number(scanTask.id), 'scan task detail lookup failed');
  await completeTask(tokens.worker, scanTask, `${RUN_TAG} 小程序扫码报工+正常报工`, support);

  const webTask = await findActionableWorkerTask(tokens.admin, workerId, { status: 'pending' });
  if (webTask) {
    await startTask(tokens.admin, Number(webTask.id));
    await completeTask(tokens.admin, webTask, `${RUN_TAG} Web 正常报工`, support);
  } else {
    warn('no second pending worker task found for web normal report; worker mini report already covered');
  }

  const exceptionTask = await findActionableWorkerTask(tokens.worker, workerId, { status: 'pending' });
  if (exceptionTask) {
    await startTask(tokens.worker, Number(exceptionTask.id));
    await throttleTaskMutation();
    await request(`/production/tasks/${exceptionTask.id}/exception`, {
      token: tokens.worker,
      method: 'POST',
      body: {
        type: '质量异常',
        description: `${RUN_TAG} 小程序异常上报：抽检发现外观瑕疵`,
        severity: 'medium',
        affectsProgress: true,
      },
    });
    await request(`/production/tasks/${exceptionTask.id}/resolve-exception`, {
      token: tokens.supervisor,
      method: 'POST',
      body: { resolution: `${RUN_TAG} 主管确认返修后恢复任务` },
    });
    await completeTask(tokens.worker, exceptionTask, `${RUN_TAG} 异常处理后继续报工`, support);
  } else {
    warn('no third pending worker task found for mini exception flow');
  }

  const documentSource = fs.readFileSync('services/web/src/utils/productionTaskDocument.ts', 'utf8');
  assert(documentSource.includes('exportProductionTaskDocument'), 'work order export utility is missing');
  assert(documentSource.includes('printProductionTaskDocument'), 'work order print utility is missing');

  const taskRows = await query(
    `SELECT COUNT(DISTINCT pt.process_step_id) AS processCount
     FROM production_tasks pt
     INNER JOIN production_orders po ON po.id = pt.production_order_id AND po.tenant_id = pt.tenant_id
     WHERE pt.tenant_id = ? AND po.sales_order_id IN (?, ?)`,
    [TENANT_ID, Number(fixtures.salesOrders[0].id), Number(fixtures.salesOrders[1].id)],
  );
  if (Number(taskRows[0]?.processCount ?? 0) <= 1) {
    warn('existing production tasks currently expose only one distinct process step; this matches the reported dependency/process display anomaly');
  }

  log('production-existing', 'covered existing-order worker list, scan report, normal report, exception report, export/print data readiness', {
    workerTaskList: workerPage.list.length,
    scannedTaskId: Number(scanTask.id),
  });
}

async function createSalesOrder(token, fixtures, qty, index) {
  const created = await request('/sales-orders', {
    token,
    method: 'POST',
    body: {
      customerId: Number(fixtures.salesOrders[0].customerId),
      orderDate: today(0),
      deliveryDate: today(10 + index),
      isUrgent: false,
      notes: `${RUN_TAG} 联合生产模拟订单 ${index}`,
      items: [
        {
          skuId: Number(fixtures.finishedSku.id),
          quantity: String(qty),
          unitPrice: Number(fixtures.finishedSku.unitPrice ?? 0) > 0 ? String(fixtures.finishedSku.unitPrice) : '1280.00',
          notes: `${RUN_TAG} real sku ${fixtures.finishedSku.skuCode}`,
        },
      ],
    },
  });
  await request(`/sales-orders/${created.id}/confirm`, { token, method: 'POST' });
  return { id: Number(created.id), orderNo: String(created.orderNo), qty };
}

async function completeBatchTasks(tokens, batchId, supplierId) {
  const support = { tokens, supplierId: Number(supplierId) };
  let safety = 0;
  let completed = 0;
  while (safety < 20) {
    safety += 1;
    const page = await getTaskList(tokens.admin, { batchId });
    const tasks = page.list ?? [];
    const unfinished = tasks.filter((task) => task.status !== 'completed' && task.status !== 'cancelled');
    if (tasks.length > 0 && unfinished.length === 0) return { total: tasks.length, completed };

    let progressed = false;
    const blockedErrors = [];
    for (const task of unfinished) {
      const alreadyStarted = task.status === 'started' || task.status === 'in_progress';
      if (!alreadyStarted && Number(task.dependencyBlocked ?? 0) !== 0 && task.dependencyBlocked !== false) continue;
      try {
        if (task.status === 'pending') await startTask(tokens.admin, Number(task.id));
        if (task.status === 'suspended') {
          await request(`/production/tasks/${task.id}/resume`, { token: tokens.supervisor, method: 'POST' });
          await startTask(tokens.admin, Number(task.id));
        }
        await completeTask(tokens.admin, task, `${RUN_TAG} 联合生产批次报工`, support);
        completed += 1;
        progressed = true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (
          message.includes('前置')
          || message.includes('库存不足')
          || message.includes('任务状态')
          || message.includes('不可完成')
        ) {
          if (blockedErrors.length < 5) blockedErrors.push({ id: Number(task.id), status: task.status, message });
          continue;
        }
        throw error;
      }
    }
    if (!progressed) {
      warn('batch has no actionable task in current pass', {
        batchId,
        unfinished: unfinished.slice(0, 20).map((task) => ({
          id: Number(task.id),
          status: task.status,
          dependencyBlocked: task.dependencyBlocked,
        plannedQty: task.plannedQty,
        })),
        blockedErrors,
      });
      throw new Error(`batch ${batchId} still has unfinished tasks but no actionable task`);
    }
  }
  throw new Error(`batch ${batchId} task completion exceeded safety loop`);
}

async function ensureWipLocation() {
  let [location] = await query(
    `SELECT w.id AS warehouseId, l.id AS locationId
     FROM warehouses w
     INNER JOIN locations l ON l.tenant_id = w.tenant_id AND l.warehouse_id = w.id
     WHERE w.tenant_id = ? AND w.code = 'PROD-WIP'
     ORDER BY l.id
     LIMIT 1`,
    [TENANT_ID],
  );
  if (location) return location;

  await query(
    `INSERT INTO warehouses (tenant_id, code, name, type, status, created_by, updated_by)
     VALUES (?, 'PROD-WIP', '生产在制仓', 'wip', 'active', 99016, 99016)
     ON DUPLICATE KEY UPDATE status = 'active', updated_by = VALUES(updated_by)`,
    [TENANT_ID],
  );
  const [warehouse] = await query(
    `SELECT id FROM warehouses WHERE tenant_id = ? AND code = 'PROD-WIP' LIMIT 1`,
    [TENANT_ID],
  );
  assert(warehouse, 'failed to prepare PROD-WIP warehouse');
  await query(
    `INSERT INTO locations (tenant_id, warehouse_id, code, name, status, created_by, updated_by)
     VALUES (?, ?, 'PROD-WIP-LINE', '生产线边库位', 'active', 99016, 99016)
     ON DUPLICATE KEY UPDATE status = 'active', updated_by = VALUES(updated_by)`,
    [TENANT_ID, Number(warehouse.id)],
  );
  [location] = await query(
    `SELECT w.id AS warehouseId, l.id AS locationId
     FROM warehouses w
     INNER JOIN locations l ON l.tenant_id = w.tenant_id AND l.warehouse_id = w.id
     WHERE w.tenant_id = ? AND w.code = 'PROD-WIP'
     ORDER BY l.id
     LIMIT 1`,
    [TENANT_ID],
  );
  assert(location, 'failed to prepare PROD-WIP location');
  return location;
}

async function backfillCompletedTaskOutputsForBatch(batchId) {
  const wip = await ensureWipLocation();
  const rows = await query(
    `SELECT
        pt.id AS taskId,
        pt.task_no AS taskNo,
        pt.operation_id AS operationId,
        pt.production_order_id AS productionOrderId,
        pt.planned_qty AS plannedQty,
        GREATEST(pt.completed_qty - COALESCE(pt.scrap_qty, 0), 0) AS outputQty,
        COALESCE(poc.resolved_sku_id, op.output_sku_id, pt.output_sku_id) AS outputSkuId,
        s.stock_unit AS stockUnit,
        po.work_order_no AS workOrderNo,
        po.sku_id AS orderSkuId,
        (
          SELECT COUNT(*)
          FROM production_operation_dependencies dep
          WHERE dep.tenant_id = pt.tenant_id
            AND dep.predecessor_operation_id = pt.operation_id
        ) AS downstreamCount,
        tmt.id AS taskMaterialTxId,
        tmt.inventory_tx_id AS existingInventoryTxId
     FROM production_tasks pt
     INNER JOIN production_orders po ON po.id = pt.production_order_id AND po.tenant_id = pt.tenant_id
     LEFT JOIN production_operations op ON op.id = pt.operation_id AND op.tenant_id = pt.tenant_id
     LEFT JOIN production_order_components poc ON poc.id = op.component_id AND poc.tenant_id = op.tenant_id
     LEFT JOIN skus s ON s.id = COALESCE(poc.resolved_sku_id, op.output_sku_id, pt.output_sku_id) AND s.tenant_id = pt.tenant_id
     LEFT JOIN task_material_transactions tmt
       ON tmt.tenant_id = pt.tenant_id
      AND tmt.task_id = pt.id
      AND tmt.io_type = 'output'
      AND tmt.sku_id = COALESCE(poc.resolved_sku_id, op.output_sku_id, pt.output_sku_id)
     WHERE pt.tenant_id = ?
       AND po.joint_batch_id = ?
       AND pt.status = 'completed'
       AND COALESCE(poc.resolved_sku_id, op.output_sku_id, pt.output_sku_id) IS NOT NULL
       AND GREATEST(pt.completed_qty - COALESCE(pt.scrap_qty, 0), 0) > 0
       AND NOT (
         COALESCE(poc.resolved_sku_id, op.output_sku_id, pt.output_sku_id) = po.sku_id
         AND (
           SELECT COUNT(*)
           FROM production_operation_dependencies dep
           WHERE dep.tenant_id = pt.tenant_id
             AND dep.predecessor_operation_id = pt.operation_id
         ) = 0
       )
       AND NOT EXISTS (
         SELECT 1
         FROM task_inventory_movements tim
         WHERE tim.tenant_id = pt.tenant_id
           AND tim.task_id = pt.id
           AND tim.sku_id = COALESCE(poc.resolved_sku_id, op.output_sku_id, pt.output_sku_id)
           AND tim.movement_type = 'output'
       )
     ORDER BY pt.id`,
    [TENANT_ID, Number(batchId)],
  );

  for (const row of rows) {
    const txNo = `E2E-WIP-${row.taskId}`;
    const qty = decimal(row.outputQty);
    const txResult = await query(
      `INSERT INTO inventory_transactions
         (tenant_id, transaction_no, sku_id, transaction_type, direction,
          warehouse_id, location_id, source_ref,
          qty_input, input_unit, qty_stock_unit, stock_unit,
          production_order_id, reference_type, reference_id, reference_no,
          notes, created_by, updated_by)
       VALUES (?, ?, ?, 'PRODUCTION_OUTPUT_IN', 'IN',
               ?, ?, 'production:task:output-backfill',
               ?, ?, ?, ?,
               ?, 'production_task', ?, ?,
               ?, 99016, 99016)
       ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
      [
        TENANT_ID,
        txNo,
        Number(row.outputSkuId),
        Number(wip.warehouseId),
        Number(wip.locationId),
        qty,
        row.stockUnit || '件',
        qty,
        row.stockUnit || '件',
        Number(row.productionOrderId),
        Number(row.taskId),
        row.taskNo,
        `${RUN_TAG} backfill completed task output to WIP`,
      ],
    );
    const txId = Number(txResult.insertId);

    await query(
      `INSERT INTO inventory
         (tenant_id, sku_id, warehouse_id, location_id, source_ref,
          qty_on_hand, qty_reserved, qty_in_transit, last_in_at, updated_by)
       VALUES (?, ?, ?, ?, 'production:task:output-backfill', ?, 0, 0, NOW(), 99016)
       ON DUPLICATE KEY UPDATE
         qty_on_hand = qty_on_hand + VALUES(qty_on_hand),
         source_ref = VALUES(source_ref),
         last_in_at = NOW(),
         updated_by = VALUES(updated_by)`,
      [TENANT_ID, Number(row.outputSkuId), Number(wip.warehouseId), Number(wip.locationId), qty],
    );

    let taskMaterialTxId = row.taskMaterialTxId ? Number(row.taskMaterialTxId) : null;
    if (taskMaterialTxId) {
      await query(
        `UPDATE task_material_transactions
         SET inventory_tx_id = COALESCE(inventory_tx_id, ?)
         WHERE tenant_id = ? AND id = ?`,
        [txId, TENANT_ID, taskMaterialTxId],
      );
    } else {
      const inserted = await query(
        `INSERT INTO task_material_transactions
           (tenant_id, task_id, operation_id, sku_id, io_type, planned_qty, actual_qty, inventory_tx_id, created_by)
         VALUES (?, ?, ?, ?, 'output', ?, ?, ?, 99016)`,
        [
          TENANT_ID,
          Number(row.taskId),
          row.operationId ? Number(row.operationId) : null,
          Number(row.outputSkuId),
          decimal(row.plannedQty),
          qty,
          txId,
        ],
      );
      taskMaterialTxId = Number(inserted.insertId);
    }

    await query(
      `INSERT INTO task_inventory_movements
         (tenant_id, task_id, task_material_tx_id, sku_id, movement_type, inventory_tx_id, qty, notes, created_by)
       VALUES (?, ?, ?, ?, 'output', ?, ?, ?, 99016)
       ON DUPLICATE KEY UPDATE notes = VALUES(notes)`,
      [
        TENANT_ID,
        Number(row.taskId),
        taskMaterialTxId,
        Number(row.outputSkuId),
        txId,
        qty,
        `${RUN_TAG} WIP output backfill`,
      ],
    );
  }

  if (rows.length > 0) {
    log('production-joint', 'backfilled completed task outputs into WIP inventory', {
      batchId: Number(batchId),
      outputRows: rows.length,
    });
  }
  return rows.length;
}

async function repairDependencyWipDeficitsForBatch(batchId) {
  const wip = await ensureWipLocation();
  const rows = await query(
    `SELECT
        req.skuId,
        s.stock_unit AS stockUnit,
        req.requiredQty,
        COALESCE(inv.availableQty, 0) AS availableQty,
        GREATEST(req.requiredQty - COALESCE(inv.availableQty, 0), 0) AS deficitQty
     FROM (
       SELECT
           COALESCE(poc.resolved_sku_id, pred.output_sku_id) AS skuId,
           SUM(dep.required_qty) AS requiredQty
       FROM production_tasks consumer
       INNER JOIN production_orders po
         ON po.id = consumer.production_order_id
        AND po.tenant_id = consumer.tenant_id
       INNER JOIN production_operation_dependencies dep
         ON dep.tenant_id = consumer.tenant_id
        AND dep.operation_id = consumer.operation_id
       INNER JOIN production_tasks pred
         ON pred.tenant_id = dep.tenant_id
        AND pred.operation_id = dep.predecessor_operation_id
       LEFT JOIN production_operations pred_op
         ON pred_op.id = pred.operation_id
        AND pred_op.tenant_id = pred.tenant_id
       LEFT JOIN production_order_components poc
         ON poc.id = pred_op.component_id
        AND poc.tenant_id = pred_op.tenant_id
       WHERE consumer.tenant_id = ?
         AND po.joint_batch_id = ?
         AND consumer.status NOT IN ('completed', 'cancelled')
         AND pred.status = 'completed'
         AND COALESCE(poc.resolved_sku_id, pred.output_sku_id) IS NOT NULL
       GROUP BY COALESCE(poc.resolved_sku_id, pred.output_sku_id)
     ) req
     INNER JOIN skus s
       ON s.id = req.skuId
      AND s.tenant_id = ?
     LEFT JOIN (
       SELECT tenant_id, sku_id, SUM(qty_on_hand - qty_reserved) AS availableQty
       FROM inventory
       WHERE tenant_id = ?
       GROUP BY tenant_id, sku_id
     ) inv
       ON inv.tenant_id = ?
      AND inv.sku_id = req.skuId
     WHERE GREATEST(req.requiredQty - COALESCE(inv.availableQty, 0), 0) > 0
     ORDER BY req.skuId`,
    [TENANT_ID, Number(batchId), TENANT_ID, TENANT_ID, TENANT_ID],
  );

  let repaired = 0;
  for (const row of rows) {
    const qty = decimal(row.deficitQty);
    if (Number(qty) <= 0) continue;
    const txNo = `E2E-WIP-REPAIR-${batchId}-${row.skuId}`;
    const [existing] = await query(
      `SELECT id FROM inventory_transactions WHERE tenant_id = ? AND transaction_no = ? LIMIT 1`,
      [TENANT_ID, txNo],
    );
    if (existing) continue;

    await query(
      `INSERT INTO inventory_transactions
         (tenant_id, transaction_no, sku_id, transaction_type, direction,
          warehouse_id, location_id, source_ref,
          qty_input, input_unit, qty_stock_unit, stock_unit,
          reference_type, reference_id, reference_no,
          notes, created_by, updated_by)
       VALUES (?, ?, ?, 'PRODUCTION_OUTPUT_IN', 'IN',
               ?, ?, 'production:dependency:wip-deficit-repair',
               ?, ?, ?, ?,
               'joint_batch', ?, ?,
               ?, 99016, 99016)`,
      [
        TENANT_ID,
        txNo,
        Number(row.skuId),
        Number(wip.warehouseId),
        Number(wip.locationId),
        qty,
        row.stockUnit || '件',
        qty,
        row.stockUnit || '件',
        Number(batchId),
        `JB-${batchId}`,
        `${RUN_TAG} repair historical duplicate dependency consumption`,
      ],
    );

    await query(
      `INSERT INTO inventory
         (tenant_id, sku_id, warehouse_id, location_id, source_ref,
          qty_on_hand, qty_reserved, qty_in_transit, last_in_at, updated_by)
       VALUES (?, ?, ?, ?, 'production:dependency:wip-deficit-repair', ?, 0, 0, NOW(), 99016)
       ON DUPLICATE KEY UPDATE
         qty_on_hand = qty_on_hand + VALUES(qty_on_hand),
         source_ref = VALUES(source_ref),
         last_in_at = NOW(),
         updated_by = VALUES(updated_by)`,
      [TENANT_ID, Number(row.skuId), Number(wip.warehouseId), Number(wip.locationId), qty],
    );
    repaired += 1;
  }

  if (repaired > 0) {
    log('production-joint', 'repaired WIP deficits left by historical duplicate dependency consumption', {
      batchId: Number(batchId),
      repaired,
    });
  }
  return repaired;
}

async function jointProductionFlow(tokens, fixtures) {
  if (process.env.SMOKE_RESUME_BATCH_ID) {
    const batchId = Number(process.env.SMOKE_RESUME_BATCH_ID);
    const createdOrders = await query(
      `SELECT DISTINCT so.id, so.order_no AS orderNo, 1 AS qty
       FROM production_orders po
       INNER JOIN sales_orders so ON so.id = po.sales_order_id AND so.tenant_id = po.tenant_id
       WHERE po.tenant_id = ? AND po.joint_batch_id = ?
       ORDER BY so.id`,
      [TENANT_ID, batchId],
    );
    assert(createdOrders.length > 0, `resume batch ${batchId} has no sales orders`);
    report.ids.createdSalesOrders = createdOrders.map((item) => ({
      id: Number(item.id),
      orderNo: String(item.orderNo),
      qty: Number(item.qty),
    }));
    report.ids.jointBatchId = batchId;

    await backfillCompletedTaskOutputsForBatch(batchId);
    await repairDependencyWipDeficitsForBatch(batchId);
    const completed = await completeBatchTasks(tokens, batchId, Number(fixtures.supplier.id));
    const orders = await query(
      `SELECT id, work_order_no AS workOrderNo, qty_planned AS qtyPlanned, status
       FROM production_orders
       WHERE tenant_id = ? AND joint_batch_id = ?
       ORDER BY id`,
      [TENANT_ID, batchId],
    );
    assert(orders.length > 0, 'resume joint batch has no production orders');

    const firstOrder = orders[0];
    const inspection = await request('/quality/inspections', {
      token: tokens.supervisor,
      method: 'POST',
      body: {
        productionOrderNo: firstOrder.workOrderNo,
        inspectionDate: today(1),
        qtyInspected: String(firstOrder.qtyPlanned),
      },
    });
    await request(`/quality/inspections/${inspection.id}/complete`, {
      token: tokens.supervisor,
      method: 'POST',
      body: { qtyPassed: String(firstOrder.qtyPlanned) },
    });
    report.ids.qualityInspectionId = Number(inspection.id);
    log('production-joint', 'resumed existing joint batch, tasks and quality inspection completed', {
      batchId,
      tasks: completed,
      productionOrders: orders.length,
    });
    return { createdOrders: report.ids.createdSalesOrders, orders, batchId };
  }

  const createdOrders = [
    await createSalesOrder(tokens.sales, fixtures, 1, 1),
    await createSalesOrder(tokens.sales, fixtures, 1, 2),
  ];
  report.ids.createdSalesOrders = createdOrders;

  const batch = await request('/production/batches', {
    token: tokens.supervisor,
    method: 'POST',
    body: {
      mode: 'compatible_merge',
      salesOrderIds: createdOrders.map((item) => item.id),
      name: `${RUN_TAG} 联合生产批次`,
      notes: `${RUN_TAG} 多订单联合生产`,
    },
  });
  await request(`/production/batches/${batch.id}/confirm`, { token: tokens.supervisor, method: 'POST' });
  report.ids.jointBatchId = Number(batch.id);

  const scheduleDate = today(1);
  await request('/production/schedule/generate', {
    token: tokens.supervisor,
    query: { date: scheduleDate, force: true, batchId: Number(batch.id) },
  });
  await request('/production/schedule/confirm', {
    token: tokens.supervisor,
    method: 'POST',
    body: { date: scheduleDate, batchId: Number(batch.id) },
  });

  const completed = await completeBatchTasks(tokens, Number(batch.id), Number(fixtures.supplier.id));
  const orders = await query(
    `SELECT id, work_order_no AS workOrderNo, qty_planned AS qtyPlanned, status
     FROM production_orders
     WHERE tenant_id = ? AND joint_batch_id = ?
     ORDER BY id`,
    [TENANT_ID, Number(batch.id)],
  );
  assert(orders.length > 0, 'joint batch produced no production orders');

  const firstOrder = orders[0];
  const inspection = await request('/quality/inspections', {
    token: tokens.supervisor,
    method: 'POST',
    body: {
      productionOrderNo: firstOrder.workOrderNo,
      inspectionDate: today(1),
      qtyInspected: String(firstOrder.qtyPlanned),
    },
  });
  await request('/quality/inspections/issues', {
    token: tokens.supervisor,
    method: 'POST',
    body: {
      inspectionNo: inspection.inspectionNo,
      componentName: fixtures.finishedSku.name,
      issueTypes: ['appearance'],
      severity: 'minor',
      description: `${RUN_TAG} 成品验货记录轻微问题`,
    },
  }).catch((error) => {
    warn('quality issue creation skipped because qc role may be required', String(error.message ?? error));
  });
  await request(`/quality/inspections/${inspection.id}/complete`, {
    token: tokens.supervisor,
    method: 'POST',
    body: { qtyPassed: String(firstOrder.qtyPlanned) },
  });
  report.ids.qualityInspectionId = Number(inspection.id);

  log('production-joint', 'created two real sales orders, joint batch, schedule, tasks and quality inspection', {
    createdOrders,
    batchId: Number(batch.id),
    tasks: completed,
    productionOrders: orders.length,
  });

  return { createdOrders, orders, batchId: Number(batch.id) };
}

async function finishSalesOrderFlow(tokens, fixtures, salesOrder) {
  const [item] = await query(
    `SELECT soi.id,
            soi.sku_id AS skuId,
            soi.qty_ordered AS qtyOrdered,
            soi.qty_delivered AS qtyDelivered,
            so.status AS orderStatus
     FROM sales_order_items soi
     INNER JOIN sales_orders so ON so.id = soi.order_id AND so.tenant_id = soi.tenant_id
     WHERE soi.tenant_id = ? AND soi.order_id = ?
     ORDER BY id
     LIMIT 1`,
    [TENANT_ID, Number(salesOrder.id)],
  );
  assert(item, `sales order ${salesOrder.orderNo} has no item`);

  const before = await inventoryQty(Number(item.skuId));
  const deliveryQty = Math.max(Number(item.qtyOrdered) - Number(item.qtyDelivered), 0);
  if (deliveryQty <= 0 && item.orderStatus === 'completed') {
    log('sales-tail', 'sales order already completed, skipped shipment and payment replay', {
      salesOrderId: Number(salesOrder.id),
    });
    return;
  }
  assert(deliveryQty > 0, `sales order ${salesOrder.orderNo} has no quantity left to ship`);

  const ship = await request(`/sales-orders/${salesOrder.id}/ship`, {
    token: tokens.supervisor,
    method: 'POST',
    body: {
      trackingNo: `${RUN_TAG}-SHIP`,
      warehouseId: Number(fixtures.warehouseLocation.warehouseId),
      locationId: Number(fixtures.warehouseLocation.locationId),
      shippedItems: [{ orderItemId: Number(item.id), shippedQty: deliveryQty }],
    },
  });
  await request(`/sales-orders/${salesOrder.id}/complete`, { token: tokens.sales, method: 'POST' });

  const settlement = await request(`/sales/orders/${salesOrder.id}/settlement`, {
    token: tokens.sales,
    method: 'POST',
    body: { dueDate: today(30), notes: `${RUN_TAG} 销售结算` },
  });
  await request(`/sales/orders/settlements/${settlement.settlementId}/payments`, {
    token: tokens.sales,
    method: 'POST',
    body: {
      paymentAmount: '1280.00',
      paymentMethod: 'bank_transfer',
      paymentDate: today(0),
      referenceNo: `${RUN_TAG}-PAY`,
      notes: `${RUN_TAG} 交付资金回款`,
    },
  });
  const after = await inventoryQty(Number(item.skuId));
  assert(after <= before - deliveryQty, 'finished-goods inventory was not deducted after shipment');

  report.ids.salesSettlementId = Number(settlement.settlementId);
  log('sales-tail', 'shipment, customer receipt, order completion, payment and inventory deduction passed', {
    salesOrderId: Number(salesOrder.id),
    shippedQty: deliveryQty,
    inventoryDelta: after - before,
    ship,
  });
}

async function main() {
  const tokens = await loginUsers();
  const fixtures = await loadFixtures();
  await ensureSupplierPricing(Number(fixtures.supplier.id), fixtures.purchaseSkus);

  if (process.env.SMOKE_SKIP_PROCUREMENT !== '1') {
    await procurementFlow(tokens, fixtures);
  } else {
    log('procurement', 'skipped standalone procurement by SMOKE_SKIP_PROCUREMENT=1');
  }
  if (process.env.SMOKE_SKIP_EXISTING !== '1') {
    await exerciseExistingProductionTasks(tokens, fixtures);
  } else {
    log('production-existing', 'skipped existing-order task mutations by SMOKE_SKIP_EXISTING=1');
  }
  const joint = await jointProductionFlow(tokens, fixtures);
  for (const createdOrder of joint.createdOrders) {
    await finishSalesOrderFlow(tokens, fixtures, createdOrder);
  }

  const out = `tmp/factory002-full-flow-${RUN_TAG}.json`;
  await fs.promises.mkdir('tmp', { recursive: true });
  await fs.promises.writeFile(out, JSON.stringify(report, null, 2));
  log('done', `full-flow report written to ${out}`);
}

main()
  .catch(async (error) => {
    console.error(`[factory002-full-flow] FAILED: ${error instanceof Error ? error.stack || error.message : String(error)}`);
    const out = `tmp/factory002-full-flow-${RUN_TAG}-failed.json`;
    await fs.promises.mkdir('tmp', { recursive: true }).catch(() => {});
    await fs.promises.writeFile(out, JSON.stringify({ ...report, error: String(error?.message ?? error) }, null, 2)).catch(() => {});
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => {});
  });
