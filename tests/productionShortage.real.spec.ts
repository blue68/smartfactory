delete (globalThis as any).expect;
import { test, expect } from '@playwright/test';
import {
  APP_BASE_URL,
  seedAuth,
  closeProductionTaskFlowDbPool,
  seedProductionShortageScenario,
  cleanupProductionShortageScenario,
  waitForProductionShortageSuggestionCreated,
} from './helpers/productionTaskFlow';

test.describe.serial('生产缺料看板前端交互（真实后端）', () => {
  test.setTimeout(120_000);

  test.afterAll(async () => {
    await closeProductionTaskFlowDbPool();
  });

  test('老板可在缺料看板查看真实缺料聚合与工单联动详情 @production-shortage-smoke', async ({ page }) => {
    const scenario = await seedProductionShortageScenario();

    try {
      await seedAuth(page, 'boss');
      await page.goto(`${APP_BASE_URL}/production/shortage`);

      await expect(page.getByRole('heading', { name: '缺料指挥台' })).toBeVisible();
      await expect(page.getByRole('button', { name: '一键生成采购建议' })).toBeVisible();
      await expect(page.getByText('缺料清单')).toBeVisible();
      await expect(page.getByText('处置建议')).toBeVisible();
      await expect(page.locator('div').filter({ hasText: /^受影响工单$/ }).first()).toBeVisible();

      await page.getByRole('button', { name: scenario.materialSkuCode }).click();
      await expect(page.locator('[class*="focusName"]')).toContainText(scenario.materialSkuName);
      await expect(page.getByRole('button', { name: '生成该工单采购建议' })).toBeVisible();
      await expect(page.getByRole('button', { name: `工单 #${scenario.productionOrderId}` })).toBeVisible();
      await expect(page.getByText(scenario.orderNo, { exact: true })).toBeVisible();
      await expect(page.getByText('严重缺料')).toBeVisible();
      await expect(page.getByText('该工单下当前物料尚无待处理采购建议，可从本页直接触发生成。')).toBeVisible();
    } finally {
      await cleanupProductionShortageScenario(scenario);
    }
  });

  test('老板可在缺料看板为当前工单生成采购建议并看到待处理态 @production-shortage-regression', async ({ page }) => {
    const scenario = await seedProductionShortageScenario();

    try {
      await seedAuth(page, 'boss');
      await page.goto(`${APP_BASE_URL}/production/shortage`);

      await expect(page.getByRole('heading', { name: '缺料指挥台' })).toBeVisible();
      await page.getByRole('button', { name: scenario.materialSkuCode }).click();
      await expect(page.getByText(scenario.orderNo, { exact: true })).toBeVisible();

      await page.getByRole('button', { name: '生成该工单采购建议' }).click();
      await expect(page.getByRole('alert')).toContainText('采购建议已生成：新增 1 条');

      const created = await waitForProductionShortageSuggestionCreated(scenario);
      expect(created.suggestionStatus).toBe('pending');
      expect(created.suggestionSource).toBe('production_shortage');
      expect(created.suggestedQty).toBe(scenario.expectedSuggestedQty);
      expect(created.shortageQty).toBe(scenario.expectedShortageQty);
      expect(created.supplierId).toBe(scenario.supplierId);
      expect(created.productionOrderId).toBe(scenario.productionOrderId);
      expect(created.requirementSuggestionId).toBe(created.suggestionId);

      await expect(page.getByRole('button', { name: '该工单已有待处理采购建议' })).toBeVisible();
      await expect(page.getByText('该工单当前物料已有待处理采购建议，建议直接进入采购建议页跟进审批、下单或执行状态。')).toBeVisible();
      await expect(page.getByText('该工单下当前物料已有待处理采购建议，建议优先跟进审批与下单。')).toBeVisible();
    } finally {
      await cleanupProductionShortageScenario(scenario);
    }
  });

  test('老板可从缺料看板进入默认仓位治理并在库存页看到治理模式生效 @production-shortage-regression @inventory-warehouse-governance', async ({ page }) => {
    await seedAuth(page, 'boss');
    await page.goto(`${APP_BASE_URL}/production/shortage`);

    await expect(page.getByRole('heading', { name: '缺料指挥台' })).toBeVisible();
    await page.getByRole('checkbox', { name: '仅默认仓位' }).check();
    await expect(page.getByText('默认仓位治理模式已开启')).toBeVisible();

    await page.getByRole('button', { name: '默认仓位治理' }).click();
    await expect(page).toHaveURL(/\/inventory\?/);

    const current = new URL(page.url());
    expect(current.pathname).toBe('/inventory');
    expect(current.searchParams.get('onlyDefaultLocation')).toBe('true');

    const warehouseId = current.searchParams.get('warehouseId');
    const locationId = current.searchParams.get('locationId');
    if (warehouseId !== null) {
      expect(Number.isInteger(Number(warehouseId))).toBe(true);
      expect(Number(warehouseId)).toBeGreaterThan(0);
    }
    if (locationId !== null) {
      expect(Number.isInteger(Number(locationId))).toBe(true);
      expect(Number(locationId)).toBeGreaterThan(0);
    }

    await expect(page.getByText('默认仓位治理模式已开启')).toBeVisible();
    await expect(page.getByRole('checkbox', { name: '仅看默认仓位' })).toBeChecked();
    await expect(page.getByRole('combobox', { name: '筛选仓库' })).toBeDisabled();
    await expect(page.getByRole('combobox', { name: '筛选库位' })).toBeDisabled();
  });

  test('老板可在缺料看板退出治理模式后恢复进入前仓位筛选 @production-shortage-regression @inventory-warehouse-governance', async ({ page }) => {
    const ok = (data: unknown) => ({
      code: 0,
      message: 'ok',
      data,
    });

    await page.route('**/api/inventory/warehouses**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(ok([
          { id: 1, code: 'DEFAULT', name: '默认仓库', type: 'virtual', status: 'active' },
          { id: 9, code: 'WH-A', name: 'A仓', type: 'normal', status: 'active' },
        ])),
      });
    });
    await page.route('**/api/inventory/locations**', async (route) => {
      const url = new URL(route.request().url());
      const warehouseId = url.searchParams.get('warehouseId');
      const data = warehouseId === '1'
        ? [{ id: 11, warehouseId: 1, code: 'DEFAULT-UNKNOWN', name: '默认未知库位', level: 1, status: 'active' }]
        : warehouseId === '9'
          ? [{ id: 99, warehouseId: 9, code: 'A-01', name: 'A-01', level: 1, status: 'active' }]
          : [];
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(ok(data)),
      });
    });
    await page.route('**/api/mrp/supply-chain-dashboard**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(ok({
          pendingReceiptPOCount: 2,
          shortageOrderCount: 1,
        })),
      });
    });
    await page.route('**/api/mrp/shortage-summary**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(ok({
          list: [
            {
              skuId: 101,
              skuCode: 'RM-101',
              skuName: '橡木板',
              stockUnit: 'm',
              totalQtyRequired: '120.0000',
              totalQtyAvailable: '40.0000',
              totalQtyInTransit: '12.0000',
              totalQtyShortage: '68.0000',
              affectedOrderCount: 1,
              affectedOrderIds: [501],
            },
          ],
          total: 1,
          page: 1,
          pageSize: 200,
          totalPages: 1,
        })),
      });
    });
    await page.route('**/api/mrp/shortage-report/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(ok({
          productionOrderId: 501,
          workOrderNo: 'WO-501',
          materialStatus: 'shortage',
          items: [
            {
              skuId: 101,
              qtyRequired: '60.0000',
              qtyAvailable: '15.0000',
              qtyShortage: '45.0000',
              hasPendingSuggestion: false,
            },
          ],
          generatedAt: new Date().toISOString(),
        })),
      });
    });

    const summaryRequests: URL[] = [];
    page.on('request', (request) => {
      if (!request.url().includes('/api/mrp/shortage-summary?')) return;
      summaryRequests.push(new URL(request.url()));
    });

    await seedAuth(page, 'boss');
    await page.goto(`${APP_BASE_URL}/production/shortage`);

    await expect(page.getByRole('heading', { name: '缺料指挥台' })).toBeVisible();
    await page.getByRole('combobox', { name: '仓库' }).selectOption('9');
    await page.getByRole('combobox', { name: '库位' }).selectOption('99');

    const isOriginalFilterRequest = (url: URL) => (
      url.searchParams.get('warehouseId') === '9'
      && url.searchParams.get('locationId') === '99'
      && url.searchParams.get('onlyDefaultLocation') === null
    );

    await expect.poll(() => summaryRequests.some(isOriginalFilterRequest)).toBe(true);

    const enterGovernanceRequestStart = summaryRequests.length;
    await page.getByRole('checkbox', { name: '仅默认仓位' }).check();
    await expect(page.getByText('默认仓位治理模式已开启')).toBeVisible();
    await expect(page.getByRole('combobox', { name: '仓库' })).toBeDisabled();
    await expect(page.getByRole('combobox', { name: '库位' })).toBeDisabled();

    await expect
      .poll(() => summaryRequests.slice(enterGovernanceRequestStart).some((url) => (
        url.searchParams.get('warehouseId') === '1'
        && url.searchParams.get('locationId') === '11'
        && url.searchParams.get('onlyDefaultLocation') === 'true'
      )))
      .toBe(true);

    await page.getByRole('button', { name: '退出治理模式' }).click();
    await expect(page.getByText('默认仓位治理模式已开启')).toHaveCount(0);
    await expect(page.getByRole('checkbox', { name: '仅默认仓位' })).not.toBeChecked();
    await expect(page.getByRole('combobox', { name: '仓库' })).toBeEnabled();
    await expect(page.getByRole('combobox', { name: '仓库' })).toHaveValue('9');
    await expect(page.getByRole('combobox', { name: '库位' })).toHaveValue('99');
  });
});
