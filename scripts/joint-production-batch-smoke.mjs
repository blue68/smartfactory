#!/usr/bin/env node

const BASE_URL = (process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1/api').replace(/\/$/, '');
const TENANT_CODE = process.env.SMOKE_TENANT_CODE ?? 'FACTORY001';
const USERNAME = process.env.SMOKE_USERNAME ?? 'admin';
const PASSWORD = process.env.SMOKE_PASSWORD ?? 'Demo123!';
const SCHEDULE_DATE = process.env.SMOKE_SCHEDULE_DATE ?? new Date().toISOString().slice(0, 10);
const MODE = process.env.SMOKE_BATCH_MODE ?? 'priority_sequential';
const ORDER_LIMIT = Math.max(1, Number(process.env.SMOKE_ORDER_LIMIT ?? 2));
const DEFAULT_CUSTOMER_CODE = process.env.SMOKE_CUSTOMER_CODE ?? 'CUS-ANLT-001';
const PREFERRED_SKU_CODES = (process.env.SMOKE_SKU_CODES ?? 'SIMBED-FG-01,FG-00009')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

function log(step, message, extra) {
  const prefix = `[joint-batch-smoke] [${step}]`;
  if (extra === undefined) {
    console.log(`${prefix} ${message}`);
    return;
  }
  console.log(`${prefix} ${message}`, extra);
}

async function request(path, { method = 'GET', token, body, query } = {}) {
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
  if (!response.ok || payload?.code !== 0) {
    const message = payload?.message || `${response.status} ${response.statusText}`;
    throw new Error(`${method} ${path} failed: ${message}`);
  }
  return payload.data;
}

function addDays(dateText, days) {
  const date = new Date(`${dateText}T00:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

async function loadEligibleOrders(token) {
  const eligiblePage = await request('/production/batches/eligible-sales-orders', {
    token,
    query: { page: 1, pageSize: 20 },
  });
  return eligiblePage.list ?? [];
}

async function bootstrapSalesOrders(token, requiredCount) {
  const customers = await request('/customers/options', { token });
  const customer = customers.find((item) => item.code === DEFAULT_CUSTOMER_CODE) ?? customers[0];
  if (!customer) {
    throw new Error('no active customer available for smoke bootstrap');
  }

  const skuPage = await request('/skus', {
    token,
    query: { page: 1, pageSize: 20, skuType: 'finished' },
  });
  const allSkus = skuPage.list ?? [];
  const preferredSkus = PREFERRED_SKU_CODES
    .map((skuCode) => allSkus.find((item) => item.sku_code === skuCode && item.status === 'active'))
    .filter(Boolean);
  const fallbackSkus = allSkus.filter((item) => item.status === 'active' && item.brand_scope === 'factory');
  const selectedSkus = [...new Map([...preferredSkus, ...fallbackSkus].map((item) => [String(item.id), item])).values()]
    .slice(0, 2);

  if (selectedSkus.length === 0) {
    throw new Error('no finished sku available for smoke bootstrap');
  }

  log('bootstrap', `creating ${requiredCount} confirmed sales orders`, {
    customer: customer.code ?? customer.name,
    skus: selectedSkus.map((item) => item.sku_code),
  });

  const createdOrderIds = [];
  for (let index = 0; index < requiredCount; index += 1) {
    const payload = {
      customerId: Number(customer.id),
      orderDate: SCHEDULE_DATE,
      deliveryDate: addDays(SCHEDULE_DATE, 7 + index),
      isUrgent: false,
      notes: `joint-batch-smoke bootstrap order ${Date.now()}-${index + 1}`,
      items: selectedSkus.map((sku, skuIndex) => ({
        skuId: Number(sku.id),
        quantity: skuIndex === 0 ? String(index + 1) : String(index + 2),
        unitPrice: skuIndex === 0 ? '1000.00' : '2000.00',
        notes: 'joint-batch-smoke',
      })),
    };
    const created = await request('/sales-orders', {
      token,
      method: 'POST',
      body: payload,
    });
    await request(`/sales-orders/${created.id}/confirm`, {
      token,
      method: 'POST',
    });
    createdOrderIds.push(Number(created.id));
    log('bootstrap', `created and confirmed sales order ${created.orderNo}`, payload.items.map((item) => item.skuId));
  }

  return createdOrderIds;
}

async function main() {
  log('auth', `login ${TENANT_CODE}/${USERNAME}`);
  const auth = await request('/auth/login', {
    method: 'POST',
    body: { tenantCode: TENANT_CODE, username: USERNAME, password: PASSWORD },
  });
  const token = auth.accessToken;
  if (!token) {
    throw new Error('login succeeded but accessToken missing');
  }

  const bootstrappedOrderIds = await bootstrapSalesOrders(token, ORDER_LIMIT);
  const eligibleAfterBootstrap = await loadEligibleOrders(token);
  let eligibleOrders = eligibleAfterBootstrap.filter((item) => bootstrappedOrderIds.includes(Number(item.id)));
  if (eligibleOrders.length < ORDER_LIMIT) {
    const fallbackOrders = eligibleAfterBootstrap.filter(
      (item) => !eligibleOrders.some((picked) => Number(picked.id) === Number(item.id)),
    );
    eligibleOrders = [...eligibleOrders, ...fallbackOrders].slice(0, ORDER_LIMIT);
  }
  if (eligibleOrders.length === 0) {
    throw new Error('no eligible sales orders after bootstrap');
  }
  if (eligibleOrders.length < ORDER_LIMIT) {
    throw new Error(`expected at least ${ORDER_LIMIT} eligible sales orders, got ${eligibleOrders.length}`);
  }
  log('eligible', `picked ${eligibleOrders.length} eligible orders`, eligibleOrders.map((item) => item.orderNo));

  const createResult = await request('/production/batches', {
    token,
    method: 'POST',
    body: {
      mode: MODE,
      salesOrderIds: eligibleOrders.map((item) => Number(item.id)),
      name: `Smoke-${Date.now()}`,
      notes: '自动 smoke 脚本创建',
    },
  });
  log('create', `created batch ${createResult.batchNo}`, createResult);

  const batchId = Number(createResult.id);
  const detailBeforeConfirm = await request(`/production/batches/${batchId}`, { token });
  if ((detailBeforeConfirm.orders ?? []).length !== eligibleOrders.length) {
    throw new Error(`batch order count mismatch: expected ${eligibleOrders.length}, got ${(detailBeforeConfirm.orders ?? []).length}`);
  }
  log('detail', 'batch detail loaded before confirm', {
    orders: detailBeforeConfirm.orders?.length ?? 0,
    items: detailBeforeConfirm.items?.length ?? 0,
  });

  const confirmResult = await request(`/production/batches/${batchId}/confirm`, {
    token,
    method: 'POST',
  });
  if ((confirmResult.createdProductionOrderIds?.length ?? 0) === 0 && (confirmResult.skippedItemIds?.length ?? 0) === 0) {
    throw new Error('batch confirm created neither production orders nor skipped existing items');
  }
  log('confirm', 'batch confirmed', confirmResult);

  const productionOrders = await request('/production/orders', {
    token,
    query: { batchId, page: 1, pageSize: 100 },
  });
  if ((productionOrders.list ?? []).length === 0) {
    throw new Error('no production orders found for confirmed batch');
  }
  log('orders', `found ${(productionOrders.list ?? []).length} production orders for batch`);

  const schedule = await request('/production/schedule/generate', {
    token,
    query: { date: SCHEDULE_DATE, force: true, batchId },
  });
  log('schedule-generate', `generated schedule for ${SCHEDULE_DATE}`, {
    schedules: schedule.schedules?.length ?? 0,
    totalOrders: schedule.summary?.totalOrders ?? 0,
    totalSteps: schedule.summary?.totalSteps ?? 0,
  });
  if ((schedule.schedules?.length ?? 0) === 0) {
    throw new Error('schedule generation returned no schedule rows for batch');
  }

  await request('/production/schedule/confirm', {
    token,
    method: 'POST',
    body: { date: SCHEDULE_DATE, batchId },
  });
  log('schedule-confirm', `confirmed schedule for ${SCHEDULE_DATE}`);

  const tasks = await request('/production/tasks', {
    token,
    query: { batchId, page: 1, pageSize: 100 },
  });
  if ((tasks.list ?? []).length === 0) {
    throw new Error('no production tasks found after schedule confirmation');
  }
  log('tasks', `found ${(tasks.list ?? []).length} production tasks for batch`);

  const shortageSummary = await request('/mrp/shortage-summary', {
    token,
    query: { batchId, page: 1, pageSize: 100 },
  });
  log('shortage', `loaded shortage summary`, {
    total: shortageSummary.total ?? 0,
    listed: shortageSummary.list?.length ?? 0,
  });

  const generatedSuggestions = await request(`/production/batches/${batchId}/purchase-suggestions/generate`, {
    token,
    method: 'POST',
  });
  log('purchase-generate', 'generated batch purchase suggestions', generatedSuggestions);

  const suggestionPage = await request('/purchase-suggestions', {
    token,
    query: { productionBatchId: batchId, page: 1, pageSize: 100 },
  });
  log('purchase-list', `loaded ${(suggestionPage.list ?? []).length} purchase suggestions for batch`);

  if ((suggestionPage.list ?? []).length > 0) {
    const firstSuggestionId = suggestionPage.list[0].id;
    const sources = await request(`/purchase-suggestions/${firstSuggestionId}/sources`, { token });
    if (!Array.isArray(sources) || sources.length === 0) {
      throw new Error(`suggestion #${firstSuggestionId} has no source trace rows`);
    }
    log('purchase-sources', `loaded ${sources.length} source rows for suggestion ${firstSuggestionId}`);
  }

  log('done', `joint production batch smoke passed for batch #${batchId}`);
}

main().catch((error) => {
  console.error('[joint-batch-smoke] FAIL', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
