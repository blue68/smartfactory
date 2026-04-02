delete (globalThis as any).expect;
import { test, expect } from '@playwright/test';
import {
  APP_BASE_URL,
  closePurchaseFlowDbPool,
  cleanupPurchaseSuggestionScenario,
  seedAuth,
  seedPurchaseSuggestionScenario,
  waitForPurchaseSuggestionApproved,
  waitForPurchaseSuggestionExecuted,
} from './helpers/purchaseFlow';

test.describe.serial('采购建议管理前端交互（真实后端）', () => {
  test.setTimeout(120_000);

  test.afterAll(async () => {
    await closePurchaseFlowDbPool();
  });

  test('老板可在采购建议管理页查看真实待审批建议与详情抽屉 @purchase-suggestion-smoke', async ({ page }) => {
    const scenario = await seedPurchaseSuggestionScenario();

    try {
      await seedAuth(page, 'boss');
      await page.goto(`${APP_BASE_URL}/purchase/purchase-suggestions`);

      await expect(
        page.locator('#main-content').getByRole('heading', { name: '采购建议管理' }),
      ).toBeVisible();
      await page.getByLabel('搜索物料').fill(scenario.suggestionNo);

      const row = page.locator('tbody tr').filter({ hasText: scenario.suggestionNo }).first();
      await expect(row).toBeVisible();
      await expect(row).toContainText(scenario.fixture.skuCode);
      await expect(row).toContainText(scenario.fixture.supplierName);
      await expect(row).toContainText('待审批');

      await row.getByRole('button', { name: scenario.suggestionNo }).click();

      const detailDrawer = page.getByRole('dialog', { name: '采购建议详情' });
      await expect(detailDrawer).toBeVisible();
      await expect(detailDrawer).toContainText(scenario.suggestionNo);
      await expect(detailDrawer).toContainText(scenario.fixture.skuCode);
      await expect(detailDrawer).toContainText(scenario.fixture.skuName);
      await expect(detailDrawer).toContainText(scenario.fixture.supplierName);
      await expect(detailDrawer).toContainText('待审批');
      await expect(detailDrawer).toContainText(scenario.reason);
      await expect(detailDrawer.getByRole('button', { name: '通过建议' })).toBeVisible();
    } finally {
      await cleanupPurchaseSuggestionScenario(scenario);
    }
  });

  test('老板可在采购建议管理页审批通过并转采购订单 @purchase-suggestion-regression', async ({ page }) => {
    const scenario = await seedPurchaseSuggestionScenario();

    try {
      await seedAuth(page, 'boss');
      await page.goto(`${APP_BASE_URL}/purchase/purchase-suggestions`);

      await expect(
        page.locator('#main-content').getByRole('heading', { name: '采购建议管理' }),
      ).toBeVisible();
      await page.getByLabel('搜索物料').fill(scenario.suggestionNo);

      const row = page.locator('tbody tr').filter({ hasText: scenario.suggestionNo }).first();
      await expect(row).toBeVisible();

      await row.getByRole('button', { name: '通过' }).click();

      const reviewPanel = page.getByRole('dialog', { name: '审批采购建议' });
      await expect(reviewPanel).toBeVisible();
      await reviewPanel.getByPlaceholder('补充说明（可选）...').fill('Playwright 审批通过并转采购订单');
      await reviewPanel.getByRole('button', { name: '确认通过' }).click();

      await expect(page.getByRole('alert')).toContainText('采购建议已通过');

      const approved = await waitForPurchaseSuggestionApproved(scenario);
      expect(approved.status).toBe('approved');
      expect(approved.approvedBy).toBe(99001);

      await expect(row).toContainText('已通过');
      await row.getByRole('button', { name: '转采购单' }).click();

      await expect(page.getByRole('alert').last()).toContainText('已转 1 条建议，生成 1 张采购单');

      const executed = await waitForPurchaseSuggestionExecuted(scenario);
      expect(executed.suggestionStatus).toBe('executed');
      expect(executed.poStatus).toBe('confirmed');
      expect(executed.poItemCount).toBe(1);
      expect(executed.qtyOrdered).toBe(scenario.suggestedQty);
      expect(executed.qtyInTransit).toBe(scenario.suggestedQty);

      await expect(row).toContainText('已执行');
      await row.getByRole('button', { name: '查看采购单' }).click();
      await expect(page).toHaveURL(new RegExp(`/purchase/orders\\?orderId=${executed.poId}`));
      await expect(page.getByRole('heading', { name: '采购订单履约中心' })).toBeVisible();
    } finally {
      await cleanupPurchaseSuggestionScenario(scenario);
    }
  });
});
