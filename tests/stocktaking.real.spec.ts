delete (globalThis as any).expect;
import { test, expect } from '@playwright/test';
import {
  APP_BASE_URL,
  seedAuth,
  seedStocktakingCreateScenario,
  seedStocktakingConfirmScenario,
  waitForStocktakingTaskCreated,
  waitForStocktakingConfirmed,
  cleanupStocktakingScenario,
  closeStocktakingFlowDbPool,
} from './helpers/stocktakingFlow';

test.describe.serial('库存盘点前端交互（真实后端）', () => {
  test.setTimeout(120_000);

  test.afterAll(async () => {
    await closeStocktakingFlowDbPool();
  });

  test('仓库可在库存盘点页创建真实盘点任务并查看明细 @stocktaking-smoke', async ({ page }) => {
    const scenario = await seedStocktakingCreateScenario();

    try {
      await seedAuth(page, 'warehouse');
      await page.goto(`${APP_BASE_URL}/stocktaking`);

      await expect(page.locator('#main-content').getByRole('heading', { name: '库存盘点' })).toBeVisible();
      await page.getByRole('button', { name: '+ 新建盘点' }).click();

      const created = await waitForStocktakingTaskCreated(scenario);
      expect(created.status).toBe('draft');

      const row = page.locator('tbody tr').filter({ hasText: created.taskNo }).first();
      await expect(row).toBeVisible();
      await expect(row).toContainText('草稿');

      await row.getByRole('button', { name: '查看盘点明细' }).click();
      await expect(page.getByText('盘点明细')).toBeVisible();
      await expect(page.getByText(scenario.skuCode)).toBeVisible();
      await expect(page.getByText(scenario.skuName)).toBeVisible();
      await expect(page.getByText(scenario.systemQty)).toBeVisible();
    } finally {
      await cleanupStocktakingScenario(scenario);
    }
  });

  test('老板可在库存盘点页确认在盘任务并回写库存调整 @stocktaking-regression', async ({ page }) => {
    const scenario = await seedStocktakingConfirmScenario();

    try {
      await seedAuth(page, 'boss');
      await page.goto(`${APP_BASE_URL}/stocktaking`);

      await expect(page.locator('#main-content').getByRole('heading', { name: '库存盘点' })).toBeVisible();

      const row = page.locator('tbody tr').filter({ hasText: scenario.taskNo }).first();
      await expect(row).toBeVisible();
      await expect(row).toContainText('盘点中');
      await row.getByRole('button', { name: `确认盘点任务 ${scenario.taskNo}` }).click();

      const confirmed = await waitForStocktakingConfirmed(scenario);
      expect(confirmed.taskStatus).toBe('confirmed');
      expect(confirmed.diffItems).toBe(1);
      expect(confirmed.confirmedBy).toBe(99001);
      expect(confirmed.inventoryQtyOnHand).toBe(scenario.expectedQtyOnHand);
      expect(confirmed.snapshotQtyOnHand).toBe(scenario.expectedQtyOnHand);
      expect(confirmed.snapshotQtyAvailable).toBe(scenario.expectedQtyOnHand);
      expect(confirmed.transactionDirection).toBe('IN');
      expect(confirmed.transactionQty).toBe(scenario.diffQty);

      await expect(row).toContainText('已确认');
      await expect(row.getByRole('button', { name: `确认盘点任务 ${scenario.taskNo}` })).toHaveCount(0);

      await row.getByRole('button', { name: '查看盘点明细' }).click();
      await expect(page.getByText(scenario.skuCode)).toBeVisible();
      await expect(page.getByText(scenario.actualQty)).toBeVisible();
      await expect(page.getByText(`+${Number(scenario.diffQty)}`)).toBeVisible();
    } finally {
      await cleanupStocktakingScenario(scenario);
    }
  });
});
