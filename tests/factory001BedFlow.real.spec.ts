delete (globalThis as any).expect;
import { test, expect } from '@playwright/test';
import mysql, { type Pool, type RowDataPacket } from '../services/api/node_modules/mysql2/promise';
import { execFileSync } from 'child_process';
import path from 'path';
import { APP_BASE_URL, closeAccessControlFlowDbPool, loginAsTenantUser } from './helpers/accessControlFlow';

const ROOT = path.resolve(__dirname, '..');
const DB_HOST = process.env.DB_HOST ?? '127.0.0.1';
const DB_PORT = Number(process.env.DB_PORT ?? '3307');
const DB_USER = process.env.DB_USER ?? 'sf_app';
const DB_PASS = process.env.DB_PASS ?? process.env.DB_PASSWORD ?? 'TestApp2026!Secure';
const DB_NAME = process.env.DB_NAME ?? 'smart_factory';
const SALES_DEADLINE = '2026-04-30';

type LoginUser = 'sales' | 'boss' | 'worker' | 'qc';

const USERS: Record<LoginUser, { username: string; password: string; tenantCode: string }> = {
  sales: { username: 'sales_dev', password: 'Dev123!2026', tenantCode: 'FACTORY001' },
  boss: { username: 'boss_dev', password: 'Dev123!2026', tenantCode: 'FACTORY001' },
  worker: { username: 'worker_dev', password: 'Dev123!2026', tenantCode: 'FACTORY001' },
  qc: { username: 'qc_dev', password: 'Dev123!2026', tenantCode: 'FACTORY001' },
};

interface CountRow extends RowDataPacket {
  total: number;
}

interface InventoryRow extends RowDataPacket {
  skuId: number;
  qtyOnHand: string;
}

interface SalesOrderRow extends RowDataPacket {
  id: number;
  orderNo: string;
  status: string;
}

interface IdRow extends RowDataPacket {
  id: number;
}

interface WorkOrderRow extends RowDataPacket {
  id: number;
  workOrderNo: string;
  status: string;
}

interface TaskRow extends RowDataPacket {
  id: number;
  taskNo: string;
  workOrderNo: string;
  status: string;
  stepName: string;
  outputSkuCode: string;
  outputSkuName: string;
  plannedQty: string;
}

interface InspectionRow extends RowDataPacket {
  id: number;
  inspectionNo: string;
  status: string;
}

let dbPool: Pool | null = null;

function getDbPool(): Pool {
  if (!dbPool) {
    dbPool = mysql.createPool({
      host: DB_HOST,
      port: DB_PORT,
      user: DB_USER,
      password: DB_PASS,
      database: DB_NAME,
      waitForConnections: true,
      connectionLimit: 4,
    });
  }
  return dbPool;
}

async function closeDbPool() {
  if (dbPool) {
    const pool = dbPool;
    dbPool = null;
    await pool.end();
  }
}

async function poll<T>(fn: () => Promise<T | null>, timeoutMs = 30_000, intervalMs = 500): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await fn();
    if (result) return result;
    if (Date.now() >= deadline) {
      throw new Error('Timed out while polling FACTORY001 bed scenario');
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

function seedFactory001BedScenario() {
  execFileSync('node', ['services/api/scripts/seed-factory001-bed-scenario.js', '--cleanup'], {
    cwd: ROOT,
    stdio: 'pipe',
  });
  execFileSync('node', ['services/api/scripts/seed-factory001-bed-scenario.js'], {
    cwd: ROOT,
    stdio: 'pipe',
  });
}

async function login(page: Parameters<typeof loginAsTenantUser>[0], role: LoginUser) {
  await loginAsTenantUser(page, USERS[role]);
}

async function getInventoryQty(skuCode: string): Promise<number> {
  const [rows] = await getDbPool().query<InventoryRow[]>(
    `SELECT i.sku_id AS skuId, CAST(i.qty_on_hand AS CHAR) AS qtyOnHand
       FROM inventory i
       JOIN skus s ON s.id = i.sku_id
      WHERE s.tenant_id = 1
        AND s.sku_code = ?
      ORDER BY i.id
      LIMIT 1`,
    [skuCode],
  );
  return Number(rows[0]?.qtyOnHand ?? 0);
}

async function getCustomerId(code: string): Promise<number> {
  const [rows] = await getDbPool().query<IdRow[]>(
    `SELECT id
       FROM customers
      WHERE tenant_id = 1
        AND code = ?
      LIMIT 1`,
    [code],
  );
  if (!rows[0]?.id) {
    throw new Error(`Customer not found in FACTORY001: ${code}`);
  }
  return Number(rows[0].id);
}

async function getSkuId(skuCode: string): Promise<number> {
  const [rows] = await getDbPool().query<IdRow[]>(
    `SELECT id
       FROM skus
      WHERE tenant_id = 1
        AND sku_code = ?
      LIMIT 1`,
    [skuCode],
  );
  if (!rows[0]?.id) {
    throw new Error(`SKU not found in FACTORY001: ${skuCode}`);
  }
  return Number(rows[0].id);
}

async function waitForSalesOrder(notes: string): Promise<SalesOrderRow> {
  return poll(async () => {
    const [rows] = await getDbPool().query<SalesOrderRow[]>(
      `SELECT id, order_no AS orderNo, status
         FROM sales_orders
        WHERE tenant_id = 1
          AND notes = ?
        ORDER BY id DESC
        LIMIT 1`,
      [notes],
    );
    return rows[0] ?? null;
  });
}

async function waitForProductionOrder(salesOrderId: number): Promise<WorkOrderRow> {
  return poll(async () => {
    const [rows] = await getDbPool().query<WorkOrderRow[]>(
      `SELECT id, work_order_no AS workOrderNo, status
         FROM production_orders
        WHERE tenant_id = 1
          AND sales_order_id = ?
        ORDER BY id DESC
        LIMIT 1`,
      [salesOrderId],
    );
    return rows[0] ?? null;
  }, 40_000);
}

async function waitForTaskCount(orderId: number, minimum: number): Promise<number> {
  const row = await poll(async () => {
    const [rows] = await getDbPool().query<CountRow[]>(
      `SELECT COUNT(*) AS total
         FROM production_tasks
        WHERE tenant_id = 1
          AND production_order_id = ?`,
      [orderId],
    );
    const total = Number(rows[0]?.total ?? 0);
    return total >= minimum ? rows[0] : null;
  }, 60_000);
  return Number(row.total);
}

async function listRunnableTasks(orderId: number): Promise<TaskRow[]> {
  const [rows] = await getDbPool().query<TaskRow[]>(
    `SELECT
       pt.id,
       pt.task_no AS taskNo,
       po.work_order_no AS workOrderNo,
       pt.status,
       COALESCE(ps.step_name, '') AS stepName,
       COALESCE(s.sku_code, '') AS outputSkuCode,
       COALESCE(s.name, '') AS outputSkuName,
       CAST(pt.planned_qty AS CHAR) AS plannedQty
     FROM production_tasks pt
     JOIN production_orders po ON po.id = pt.production_order_id
     LEFT JOIN process_steps ps ON ps.id = pt.process_step_id
     LEFT JOIN skus s ON s.id = pt.output_sku_id
     WHERE pt.tenant_id = 1
       AND pt.production_order_id = ?
       AND pt.status IN ('pending', 'started', 'in_progress')
       AND NOT EXISTS (
         SELECT 1
           FROM production_operation_dependencies dep
           JOIN production_tasks pred
             ON pred.operation_id = dep.predecessor_operation_id
         WHERE dep.operation_id = pt.operation_id
           AND pred.production_order_id = pt.production_order_id
           AND pred.status <> 'completed'
       )
     ORDER BY
       CASE pt.status WHEN 'in_progress' THEN 0 WHEN 'started' THEN 1 ELSE 2 END,
       ps.step_no,
       pt.id`,
    [orderId],
  );
  return rows;
}

async function waitForOrderCompleted(orderId: number): Promise<void> {
  await poll(async () => {
    const [rows] = await getDbPool().query<WorkOrderRow[]>(
      `SELECT id, work_order_no AS workOrderNo, status
         FROM production_orders
        WHERE id = ?`,
      [orderId],
    );
    return rows[0]?.status === 'completed' ? rows[0] : null;
  }, 60_000);
}

async function waitForInspection(orderId: number): Promise<InspectionRow> {
  return poll(async () => {
    const [rows] = await getDbPool().query<InspectionRow[]>(
      `SELECT id, inspection_no AS inspectionNo, status
         FROM inspection_records
        WHERE tenant_id = 1
          AND production_order_id = ?
        ORDER BY id DESC
        LIMIT 1`,
      [orderId],
    );
    return rows[0] ?? null;
  }, 20_000);
}

async function getTaskStatus(taskId: number): Promise<string | null> {
  const [rows] = await getDbPool().query<Array<RowDataPacket & { status: string }>>(
    `SELECT status
       FROM production_tasks
      WHERE tenant_id = 1
        AND id = ?
      LIMIT 1`,
    [taskId],
  );
  return rows[0]?.status ?? null;
}

async function getIssueCount(inspectionId: number): Promise<number> {
  const [rows] = await getDbPool().query<CountRow[]>(
    `SELECT COUNT(*) AS total
       FROM quality_issues
      WHERE tenant_id = 1
        AND inspection_id = ?`,
    [inspectionId],
  );
  return Number(rows[0]?.total ?? 0);
}

async function selectOptionByText(selectLocator: import('@playwright/test').Locator, matchText: string) {
  const optionValue = await selectLocator.locator('option').evaluateAll((options, expected) => {
    const hit = options.find((option) => option.textContent?.includes(String(expected)));
    return hit ? (hit as HTMLOptionElement).value : null;
  }, matchText);
  if (optionValue === null) {
    throw new Error(`Option not found: ${matchText}`);
  }
  await selectLocator.selectOption(optionValue);
}

function formatDateIso(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(baseDateIso: string, days: number): string {
  const date = new Date(`${baseDateIso}T00:00:00`);
  date.setDate(date.getDate() + days);
  return formatDateIso(date);
}

async function findSchedulableDate(
  page: import('@playwright/test').Page,
  workOrderNo: string,
  startDateIso: string,
  lookaheadDays = 60,
): Promise<string> {
  for (let offset = 0; offset <= lookaheadDays; offset += 1) {
    const date = addDays(startDateIso, offset);
    await page.goto(`${APP_BASE_URL}/production/schedule?date=${date}&workOrderNo=${encodeURIComponent(workOrderNo)}`);
    await expect(page.locator('#main-content').getByRole('heading', { name: '每日排产计划' })).toBeVisible();
    await page.waitForTimeout(1200);
    const regenerateButton = page.getByRole('button', { name: '重新生成' });
    if (!(await regenerateButton.count())) {
      continue;
    }
    await regenerateButton.click();
    await page.waitForTimeout(1500);
    const confirmButton = page.getByRole('button', { name: '确认并下发给工人' });
    if (await confirmButton.count()) {
      return date;
    }
  }
  throw new Error(`No schedulable date found for ${workOrderNo} within ${lookaheadDays + 1} days from ${startDateIso}`);
}

async function findTaskRow(page: import('@playwright/test').Page, task: TaskRow) {
  await page.goto(`${APP_BASE_URL}/production/tasks`);
  await expect(page.locator('#main-content').getByRole('heading', { name: '生产任务管理' })).toBeVisible();
  await selectOptionByText(page.getByLabel('工人筛选'), '全部工人');
  await page.waitForTimeout(400);
  await page.getByLabel('关键词搜索').fill(task.workOrderNo);
  await page.waitForTimeout(1200);
  let row = page.locator('tbody tr').filter({ hasText: task.taskNo }).first();
  for (let pageGuard = 0; pageGuard < 12; pageGuard += 1) {
    if (await row.count()) {
      await expect(row).toBeVisible({ timeout: 20_000 });
      return row;
    }
    const nextButton = page.getByRole('button', { name: '›' });
    if (!(await nextButton.count()) || await nextButton.isDisabled()) {
      throw new Error(`Task row not found in task list pagination: ${task.taskNo}`);
    }
    await nextButton.click();
    await page.waitForTimeout(600);
    row = page.locator('tbody tr').filter({ hasText: task.taskNo }).first();
  }
  throw new Error(`Task row not found in task list pagination: ${task.taskNo}`);
}

async function openTaskDrawer(page: import('@playwright/test').Page, task: TaskRow) {
  const row = await findTaskRow(page, task);
  await row.getByRole('button', { name: '详情' }).click();
  const drawer = page.getByRole('dialog', { name: '任务详情' });
  await expect(drawer).toBeVisible();
  return drawer;
}

async function fillMaterialActionModal(
  page: import('@playwright/test').Page,
  title: '领料到线边' | '退料回仓',
  overrides?: Record<number, string>,
) {
  const modal = page.getByRole('dialog').filter({ hasText: title }).last();
  await expect(modal).toBeVisible();
  const qtyInputs = modal.locator('input[id^="material-qty-"]');
  const count = await qtyInputs.count();
  for (let index = 0; index < count; index += 1) {
    const qtyInput = qtyInputs.nth(index);
    const qty = overrides?.[index] ?? await qtyInput.evaluate((node) => {
      const host = node.closest('[class*="taskIOItem"]');
      const text = host?.textContent ?? '';
      const match = text.match(/需求\s*([0-9.]+)/);
      return match?.[1] ?? '';
    });
    if (!qty) continue;
    await qtyInput.fill(qty);

    const warehouseSelect = modal.locator('select[id^="material-warehouse-"]').nth(index);
    if ((await warehouseSelect.count()) > 0 && (await warehouseSelect.inputValue()) === '') {
      const warehouseValue = await warehouseSelect.locator('option').evaluateAll((options) => {
        const hit = options.find((option) => (option as HTMLOptionElement).value);
        return (hit as HTMLOptionElement | undefined)?.value ?? '';
      });
      if (warehouseValue) {
        await warehouseSelect.selectOption(warehouseValue);
      }
    }

    const locationSelect = modal.locator('select[id^="material-location-"]').nth(index);
    if ((await locationSelect.count()) > 0 && !(await locationSelect.isDisabled()) && (await locationSelect.inputValue()) === '') {
      const locationValue = await locationSelect.locator('option').evaluateAll((options) => {
        const hit = options.find((option) => (option as HTMLOptionElement).value);
        return (hit as HTMLOptionElement | undefined)?.value ?? '';
      });
      if (locationValue) {
        await locationSelect.selectOption(locationValue);
      }
    }
  }
  await modal.getByRole('button', { name: title }).click();
  await expect(modal).toBeHidden({ timeout: 20_000 });
}

async function processTask(
  page: import('@playwright/test').Page,
  task: TaskRow,
  options: {
    overIssueFirstMaterial?: string;
    returnFirstMaterial?: string;
    raiseException?: boolean;
  } = {},
): Promise<boolean> {
  let row = await findTaskRow(page, task);
  let actionTaken = false;

  if (task.status === 'pending') {
    const issueButton = row.getByRole('button', { name: '领料到线边' });
    if (await issueButton.count() && await issueButton.isVisible() && await issueButton.isEnabled()) {
      await issueButton.click();
      const issueOverrides = options.overIssueFirstMaterial ? { 0: options.overIssueFirstMaterial } : undefined;
      await fillMaterialActionModal(page, '领料到线边', issueOverrides);
      actionTaken = true;
      row = await findTaskRow(page, task);
    }
    const startButton = row.getByRole('button', { name: '开始' });
    if (await startButton.count() && await startButton.isVisible()) {
      if (!(await startButton.isEnabled())) {
        return false;
      }
      await startButton.click();
      const parallelConfirm = page.getByRole('dialog', { name: '多任务并行确认' });
      if (await parallelConfirm.count()) {
        await expect(parallelConfirm).toBeVisible({ timeout: 5_000 });
        await parallelConfirm.getByRole('button', { name: '确认开始' }).click();
      }
      await expect
        .poll(async () => {
          if (await page.getByRole('alert').filter({ hasText: '已开始' }).count()) {
            return 'alert';
          }
          row = await findTaskRow(page, task);
          if (await row.getByRole('button', { name: '完成' }).count()) {
            return 'complete';
          }
          const taskStatus = await getTaskStatus(task.id);
          if (taskStatus === 'started' || taskStatus === 'in_progress') {
            return taskStatus;
          }
          const rowText = await row.innerText();
          if (rowText.includes('进行中')) {
            return 'in_progress';
          }
          return '';
        }, { timeout: 20_000 })
        .not.toBe('');
      actionTaken = true;
    }
  }

  row = await findTaskRow(page, task);

  const exceptionButton = row.getByRole('button', { name: '上报异常' });
  if (options.raiseException && await exceptionButton.count() && await exceptionButton.isVisible()) {
    await exceptionButton.click();
    const exceptionModal = page.getByRole('dialog').filter({ hasText: '上报生产异常' }).last();
    await expect(exceptionModal).toBeVisible();
    await exceptionModal.getByRole('button', { name: '设备故障' }).click();
    await exceptionModal.getByRole('button', { name: '否，不影响' }).click();
    await exceptionModal.getByLabel('异常描述').fill('模拟床流程自动验证：开料设备短暂停顿，已现场恢复。');
    await exceptionModal.getByRole('button', { name: '确认上报' }).click();
    await expect(page.getByRole('alert').filter({ hasText: '异常已上报' })).toBeVisible({ timeout: 20_000 });
    row = await findTaskRow(page, task);
    const resolveButton = row.getByRole('button', { name: '标记已处理' });
    await expect(resolveButton).toBeVisible({ timeout: 20_000 });
    await resolveButton.click();
    const resolveModal = page.getByRole('dialog').filter({ hasText: '标记异常已处理' }).last();
    await expect(resolveModal).toBeVisible();
    await resolveModal.getByLabel('处理说明').fill('已完成巡检与复位，本次异常不再影响排程。');
    await resolveModal.getByRole('button', { name: '确认处理' }).click();
    await expect(page.getByRole('alert').filter({ hasText: '异常已标记处理' })).toBeVisible({ timeout: 20_000 });
    actionTaken = true;
  }

  row = await findTaskRow(page, task);
  const returnButton = row.getByRole('button', { name: '退料回仓' });
  if (options.returnFirstMaterial && await returnButton.count() && await returnButton.isVisible()) {
    await returnButton.click();
    await fillMaterialActionModal(page, '退料回仓', { 0: options.returnFirstMaterial });
    actionTaken = true;
  }

  row = await findTaskRow(page, task);
  const completeButton = row.getByRole('button', { name: '完成' });
  if (await completeButton.count() && await completeButton.isVisible()) {
    await completeButton.click();
    const completeModal = page.getByRole('dialog').filter({ hasText: '完工上报' }).last();
    await expect(completeModal).toBeVisible();
    await completeModal.getByLabel('完成件数').fill(String(Number(task.plannedQty)));
    await completeModal.getByLabel('实际工时（小时）').fill('1');
    const scrapInput = completeModal.getByLabel('废品数量（件）');
    if (await scrapInput.count()) {
      await scrapInput.fill('0');
    }
    await completeModal.getByLabel('备注').fill(`FACTORY001 模拟床流程自动验证：${task.stepName}`);
    await completeModal.getByRole('button', { name: '确认完成' }).click();
    await expect
      .poll(async () => {
        if (await page.getByRole('alert').filter({ hasText: '已标记完成' }).count()) {
          return 'alert';
        }
        const taskStatus = await getTaskStatus(task.id);
        if (taskStatus === 'completed') {
          return 'completed';
        }
        row = await findTaskRow(page, task);
        const rowText = await row.innerText();
        if (rowText.includes('已完成')) {
          return 'completed';
        }
        return '';
      }, { timeout: 20_000 })
      .not.toBe('');
    actionTaken = true;
  }

  return actionTaken;
}

test.describe.serial('FACTORY001 模拟床真实全链路验证', () => {
  test.setTimeout(600_000);

  test.beforeAll(async () => {
    seedFactory001BedScenario();
  });

  test.afterAll(async () => {
    await closeDbPool();
    await closeAccessControlFlowDbPool();
  });

  test('从销售订单到生产、质量和库存全链路可运行 @factory001-bed-e2e', async ({ page }) => {
    const beforeSideBoard = await getInventoryQty('SIMBED-RM-SIDEBOARD');
    const beforeFoam = await getInventoryQty('SIMBED-RM-FOAM');
    const beforeCarton = await getInventoryQty('SIMBED-PK-CARTON');
    const beforeManual = await getInventoryQty('SIMBED-PK-MANUAL');
    const beforeFinishedBed = await getInventoryQty('SIMBED-FG-01');
    const simulatedCustomerId = await getCustomerId('SIMBED-CUST-01');
    const simulatedFinishedSkuId = await getSkuId('SIMBED-FG-01');
    const orderNotes = `FACTORY001 模拟床 UI 验证 ${Date.now()}`;

    await login(page, 'boss');

    await page.goto(`${APP_BASE_URL}/master-data/sku`);
    const skuSearch = page.getByPlaceholder('搜索SKU编码 / 名称 / 规格...');
    await expect(skuSearch).toBeVisible();
    await skuSearch.fill('SIMBED-FG-01');
    await expect(page.locator('tbody tr').filter({ hasText: 'SIMBED-FG-01' }).first()).toBeVisible();
    await skuSearch.fill('SIMBED-SF-HEAD');
    await expect(page.locator('tbody tr').filter({ hasText: 'SIMBED-SF-HEAD' }).first()).toBeVisible();

    await page.goto(`${APP_BASE_URL}/master-data/bom`);
    const bomSearch = page.getByPlaceholder('搜索成品名称 / 编码…');
    await expect(bomSearch).toBeVisible();
    await bomSearch.fill('SIMBED-FG-01');
    await expect(page.locator('tbody tr').filter({ hasText: 'SIMBED-FG-01' }).first()).toBeVisible();

    await page.goto(`${APP_BASE_URL}/master-data/sku-process`);
    const skuProcessSearch = page.getByPlaceholder('搜索 SKU 名称或编码...');
    await expect(skuProcessSearch).toBeVisible();
    await skuProcessSearch.fill('SIMBED-FG-01');
    await page.locator('[role="listitem"]').filter({ hasText: 'SIMBED-FG-01' }).first().click();
    await expect(page.getByText('SIMBED-FG-01').last()).toBeVisible();
    await expect(page.getByRole('button', { name: '新建工序模板' })).toBeVisible();
    await expect(page.getByRole('button', { name: '查看 / 编辑' }).first()).toBeVisible();

    await page.goto(`${APP_BASE_URL}/master-data/process-config`);
    const processConfigSearch = page.getByPlaceholder('搜索模板名称...');
    await expect(processConfigSearch).toBeVisible();
    await processConfigSearch.fill('模拟床-成品床默认工艺');
    await expect(page.getByRole('region', { name: '工艺路线配置工作台' })).toBeVisible();

    await login(page, 'sales');
    await page.goto(`${APP_BASE_URL}/sales/orders`);
    await expect(page.locator('#main-content').getByText('新建订单')).toBeVisible();
    await page.locator('#customer').selectOption(String(simulatedCustomerId));
    await expect(page.locator('#product')).toBeEnabled();
    await page.locator('#product').selectOption(String(simulatedFinishedSkuId));
    await page.locator('#qty').fill('1');
    await page.locator('#unitPrice').fill('5999');
    await page.locator('#deadline').fill(SALES_DEADLINE);
    await page.locator('#notes').fill(orderNotes);
    await Promise.all([
      page.waitForURL(/\/sales\/order-list$/),
      page.getByRole('button', { name: '确认订单' }).click(),
    ]);
    await expect(page.locator('#main-content').getByRole('heading', { name: '销售订单管理' })).toBeVisible();

    const salesOrder = await waitForSalesOrder(orderNotes);
    expect(['confirmed', 'in_production']).toContain(salesOrder.status);

    await login(page, 'boss');
    await page.goto(`${APP_BASE_URL}/production/orders`);
    await expect(page.getByText('🏭 生产工单')).toBeVisible();
    await page.getByRole('button', { name: '+ 手动创建工单' }).click();
    const createWorkOrderModal = page.getByRole('dialog', { name: '从销售订单创建工单' });
    await expect(createWorkOrderModal).toBeVisible();
    await createWorkOrderModal.getByPlaceholder('输入销售订单单号，例如 SO260325-00002').fill(salesOrder.orderNo);
    await createWorkOrderModal.getByRole('button', { name: '确认' }).click();

    const workOrder = await waitForProductionOrder(salesOrder.id);
    await expect(page.locator('[class*="orderCard"]').filter({ hasText: workOrder.workOrderNo }).first()).toBeVisible();

    const scheduleDate = await findSchedulableDate(page, workOrder.workOrderNo, SALES_DEADLINE);
    await page.goto(`${APP_BASE_URL}/production/schedule?date=${scheduleDate}&workOrderNo=${encodeURIComponent(workOrder.workOrderNo)}`);
    await expect(page.locator('#main-content').getByRole('heading', { name: '每日排产计划' })).toBeVisible();
    await page.getByRole('button', { name: '重新生成' }).click();
    await expect(page.getByRole('button', { name: '确认并下发给工人' })).toBeEnabled({ timeout: 20_000 });
    await page.getByRole('button', { name: '确认并下发给工人' }).click();
    const confirmDispatchDialog = page.getByRole('dialog').filter({ hasText: '确认并下发排产计划' }).last();
    if (await confirmDispatchDialog.count()) {
      await expect(confirmDispatchDialog).toBeVisible({ timeout: 5_000 });
      await confirmDispatchDialog.getByRole('button', { name: '确认下发' }).click();
    }

    const taskCount = await waitForTaskCount(workOrder.id, 10);
    expect(taskCount).toBeGreaterThanOrEqual(10);

    await login(page, 'worker');

    let handledSpecialTask = false;
    for (let guard = 0; guard < 40; guard += 1) {
      const runnable = await listRunnableTasks(workOrder.id);
      if (runnable.length === 0) break;
      let progressed = false;
      for (const current of runnable) {
        const isSideCut = !handledSpecialTask
          && current.stepName.includes('开料')
          && current.outputSkuCode === 'SIMBED-SF-SIDE';

        const handled = await processTask(page, current, isSideCut ? {
          overIssueFirstMaterial: '3',
          returnFirstMaterial: '1',
          raiseException: true,
        } : {});

        if (handled) {
          if (isSideCut) {
            handledSpecialTask = true;
          }
          progressed = true;
          break;
        }
      }
      if (!progressed) {
        throw new Error(`No actionable task found for work order ${workOrder.workOrderNo} in current runnable set`);
      }
    }

    await waitForOrderCompleted(workOrder.id);

    await login(page, 'qc');
    await page.goto(`${APP_BASE_URL}/quality/trace`);
    await expect(page.locator('#main-content').getByRole('heading', { name: '质量追溯' })).toBeVisible();
    await page.getByRole('button', { name: '+ 新建验货单' }).click();
    const createInspectionModal = page.getByRole('dialog', { name: '新建验货单' });
    await expect(createInspectionModal).toBeVisible();
    await createInspectionModal.getByLabel('生产工单号').fill(workOrder.workOrderNo);
    await createInspectionModal.getByLabel('验货日期').fill(scheduleDate);
    await createInspectionModal.getByLabel('验货数量').fill('1');
    await createInspectionModal.getByRole('button', { name: '创建' }).click();
    await expect(page.getByRole('alert').filter({ hasText: '验货单' })).toBeVisible({ timeout: 20_000 });

    const inspection = await waitForInspection(workOrder.id);

    await page.getByRole('button', { name: '+ 录入问题' }).click();
    const createIssueModal = page.getByRole('dialog', { name: '录入质量问题' });
    await expect(createIssueModal).toBeVisible();
    await createIssueModal.getByLabel('验货单号').fill(inspection.inspectionNo);
    await createIssueModal.getByLabel('问题部件').fill('包装外箱');
    await createIssueModal.getByRole('button', { name: '外观' }).click();
    await createIssueModal.getByRole('radio', { name: '次要' }).check();
    await createIssueModal.getByLabel('问题说明').fill('模拟床自动验证：外箱角部有轻微压痕，已记录用于验货链路验证。');
    await createIssueModal.getByRole('button', { name: '提交问题' }).click();
    await expect(page.getByRole('alert').filter({ hasText: '质量问题' })).toBeVisible({ timeout: 20_000 });

    const afterSideBoard = await getInventoryQty('SIMBED-RM-SIDEBOARD');
    const afterFoam = await getInventoryQty('SIMBED-RM-FOAM');
    const afterCarton = await getInventoryQty('SIMBED-PK-CARTON');
    const afterManual = await getInventoryQty('SIMBED-PK-MANUAL');
    const afterFinishedBed = await getInventoryQty('SIMBED-FG-01');
    const issueCount = await getIssueCount(inspection.id);

    expect(afterSideBoard).toBe(beforeSideBoard - 2);
    expect(afterFoam).toBe(beforeFoam - 1);
    expect(afterCarton).toBe(beforeCarton - 1);
    expect(afterManual).toBe(beforeManual - 1);
    expect(afterFinishedBed).toBe(beforeFinishedBed + 1);
    expect(issueCount).toBeGreaterThanOrEqual(1);
  });
});
