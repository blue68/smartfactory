delete (globalThis as any).expect;
import { test, expect } from '@playwright/test';
import {
  APP_BASE_URL,
  seedAuth,
  seedInventoryScenario,
  seedInventoryRegressionScenario,
  cleanupInventoryScenario,
  waitForInventoryQtyOnHand,
  waitForInventoryTransactionCount,
  closeInventoryFlowDbPool,
} from './helpers/inventoryFlow';

test.describe.serial('库存总览前端交互（真实后端）', () => {
  test.setTimeout(120_000);

  test.afterAll(async () => {
    await closeInventoryFlowDbPool();
  });

  test('老板可在库存页查看快照追溯并完成手动入库 @inventory-smoke', async ({ page }) => {
    const scenario = await seedInventoryScenario();

    try {
      await seedAuth(page, 'boss');
      await page.goto(`${APP_BASE_URL}/inventory`);

      await expect(page.locator('#main-content').getByRole('heading', { name: '库存总览' })).toBeVisible();
      await expect(page.getByRole('region', { name: '库存汇总' })).toBeVisible();

      const snapshotCard = page.getByRole('region', { name: '日结库存快照' });
      await snapshotCard.getByPlaceholder('按 SKU 编码/名称筛选快照').fill(scenario.skuCode);
      await snapshotCard.getByRole('button', { name: '查询' }).click();
      await expect(snapshotCard.getByText(scenario.skuName)).toBeVisible();
      await expect(snapshotCard.getByText(`日期 ${scenario.snapshotDate}`)).toBeVisible();

      await page.getByLabel('搜索物料').fill(scenario.skuCode);
      await page.getByRole('button', { name: '执行搜索' }).click();

      const row = page.locator('tbody tr').filter({ hasText: scenario.skuName }).first();
      await expect(row).toBeVisible({ timeout: 15_000 });
      await expect(row.getByRole('button', { name: '追溯' })).toBeVisible();
      await expect(row.getByRole('button', { name: '入库' })).toBeVisible();

      await row.getByRole('button', { name: '追溯' }).click();
      const traceDrawer = page.getByRole('dialog', { name: `库存追溯 — ${scenario.skuName}` });
      await expect(traceDrawer).toBeVisible();
      await expect(traceDrawer.getByText(scenario.initialTransactionNo)).toBeVisible();
      await expect(traceDrawer.getByText(scenario.initialReferenceNo)).toBeVisible();
      await expect(traceDrawer.getByText(scenario.initialNote)).toBeVisible();
      await traceDrawer.getByRole('button', { name: '关闭抽屉' }).click();
      await expect(traceDrawer).toBeHidden();

      await row.getByRole('button', { name: '入库' }).click();
      const inboundModal = page.getByRole('dialog', { name: `入库 — ${scenario.skuName}` });
      await expect(inboundModal).toBeVisible();
      await inboundModal.getByPlaceholder('请输入入库数量').fill('5');
      await inboundModal.getByPlaceholder('可选备注信息').fill(scenario.inboundNote);
      await inboundModal.getByRole('button', { name: '确认入库' }).click();
      await expect(inboundModal).toBeHidden();

      await waitForInventoryQtyOnHand(scenario.skuId, '17.0000');
      await waitForInventoryTransactionCount(scenario.skuId, 2);

      await row.getByRole('button', { name: '追溯' }).click();
      await expect(traceDrawer).toBeVisible();
      await expect(traceDrawer.getByText('记录数 2')).toBeVisible();
      await expect(traceDrawer.getByText(scenario.inboundNote)).toBeVisible();
      await expect(traceDrawer.getByText('PURCHASE_IN')).toHaveCount(2);
    } finally {
      await cleanupInventoryScenario(scenario);
    }
  });

  test('老板可从日结快照入口筛选库存追溯流水并重置过滤 @inventory-regression', async ({ page }) => {
    const scenario = await seedInventoryRegressionScenario();

    try {
      await seedAuth(page, 'boss');
      await page.goto(`${APP_BASE_URL}/inventory`);

      const snapshotCard = page.getByRole('region', { name: '日结库存快照' });
      await snapshotCard.getByPlaceholder('按 SKU 编码/名称筛选快照').fill(scenario.skuCode);
      await snapshotCard.getByRole('button', { name: '查询' }).click();
      await expect(snapshotCard.getByText(scenario.skuName)).toBeVisible();

      await snapshotCard.getByRole('button', { name: '追溯' }).click();
      const traceDrawer = page.getByRole('dialog', { name: `库存追溯 — ${scenario.skuName}` });
      await expect(traceDrawer).toBeVisible();
      await expect(traceDrawer.getByText(`来自 ${scenario.snapshotDate} 日结快照入口`)).toBeVisible();
      await expect(traceDrawer.getByText('记录数 2')).toBeVisible();
      await expect(traceDrawer.getByText(scenario.initialTransactionNo)).toBeVisible();
      await expect(traceDrawer.getByText(scenario.outboundTransactionNo)).toBeVisible();

      await traceDrawer.getByLabel('筛选库存追溯').fill(scenario.outboundReferenceNo);
      await traceDrawer.getByRole('button', { name: '查询' }).click();
      await expect(traceDrawer.getByText('记录数 1')).toBeVisible();
      await expect(traceDrawer.getByText(scenario.outboundTransactionNo)).toBeVisible();
      await expect(traceDrawer.getByText(scenario.outboundNote)).toBeVisible();
      await expect(traceDrawer.getByText(scenario.initialTransactionNo)).toHaveCount(0);

      await traceDrawer.getByRole('button', { name: '清空' }).click();
      await expect(traceDrawer.getByText('记录数 2')).toBeVisible();
      await expect(traceDrawer.getByText(scenario.initialTransactionNo)).toBeVisible();
      await expect(traceDrawer.getByText(scenario.outboundTransactionNo)).toBeVisible();
    } finally {
      await cleanupInventoryScenario(scenario);
    }
  });
});
