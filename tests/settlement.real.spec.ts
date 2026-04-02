delete (globalThis as any).expect;
import { test, expect } from '@playwright/test';
import {
  APP_BASE_URL,
  seedAuth,
  seedSettlementScenario,
  seedSettlementRegressionScenario,
  cleanupSettlementScenario,
  cleanupSettlementRegressionScenario,
  fetchSettlementAgingSummarySnapshot,
  waitForSettlementStatus,
  closeSettlementFlowDbPool,
} from './helpers/settlementFlow';

test.describe.serial('销售结算前端交互（真实后端）', () => {
  test.setTimeout(120_000);

  test.afterAll(async () => {
    await closeSettlementFlowDbPool();
  });

  test('老板可在销售结算页确认草稿并标记已付 @settlement-smoke', async ({ page }) => {
    const scenario = await seedSettlementScenario();

    try {
      await seedAuth(page, 'boss');
      await page.goto(`${APP_BASE_URL}/settlement`);

      await expect(page.locator('#main-content').getByRole('heading', { name: '销售结算' })).toBeVisible();
      await expect(page.getByText('按客户汇总')).toBeVisible();
      await expect(page.getByRole('button', { name: new RegExp(scenario.customerName) })).toBeVisible();

      const row = page.locator('tbody tr').filter({ hasText: scenario.settlementNo }).first();
      await expect(row).toBeVisible({ timeout: 15_000 });
      await expect(row.getByText('草稿')).toBeVisible();

      await row.getByRole('button', { name: '确认' }).click();
      await expect(row.getByText('已确认')).toBeVisible();
      await waitForSettlementStatus(scenario.settlementId, 'confirmed');

      await row.getByRole('button', { name: '标记已付' }).click();
      await expect(row.getByText('已付款')).toBeVisible();
      await waitForSettlementStatus(scenario.settlementId, 'paid');
    } finally {
      await cleanupSettlementScenario(scenario);
    }
  });

  test('老板可按客户汇总反向过滤结算单并查看真实账龄汇总 @settlement-regression', async ({ page }) => {
    const scenario = await seedSettlementRegressionScenario();

    try {
      await seedAuth(page, 'boss');
      await page.goto(`${APP_BASE_URL}/settlement`);

      const summarySection = page.getByRole('region', { name: '应收账款汇总' });
      const customerButton = summarySection.getByRole('button', {
        name: new RegExp(`${scenario.primaryCustomerName}.*¥18,000.00.*2 笔`),
      });
      await expect(customerButton).toBeVisible();

      await customerButton.click();
      await expect(page.getByText(`客户：${scenario.primaryCustomerName}`)).toBeVisible();
      await expect(page.locator('tbody tr').filter({ hasText: scenario.overdueDraftSettlementNo })).toHaveCount(1);
      await expect(page.locator('tbody tr').filter({ hasText: scenario.overdueConfirmedSettlementNo })).toHaveCount(1);
      await expect(page.locator('tbody tr').filter({ hasText: scenario.currentSettlementNo })).toHaveCount(0);

      await page.getByLabel('仅看逾期').check();
      await expect(page.locator('tbody tr').filter({ hasText: scenario.overdueDraftSettlementNo })).toHaveCount(1);
      await expect(page.locator('tbody tr').filter({ hasText: scenario.overdueConfirmedSettlementNo })).toHaveCount(1);
      await expect(page.getByText('已逾期').first()).toBeVisible();

      const agingSnapshot = await fetchSettlementAgingSummarySnapshot();
      await page.getByRole('tab', { name: '账龄' }).click();
      await expect(page.getByRole('tab', { name: '账龄' })).toHaveAttribute('aria-selected', 'true');
      const overdueAmountLabel = summarySection.getByText('逾期金额', { exact: true });
      const overdueCountLabel = summarySection.getByText('逾期笔数', { exact: true });
      await expect(overdueAmountLabel).toBeVisible();
      await expect(overdueAmountLabel.locator('xpath=following-sibling::strong[1]')).toHaveText(
        `¥${Number(agingSnapshot.overdueAmount).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}`,
      );
      await expect(overdueCountLabel.locator('xpath=following-sibling::strong[1]')).toHaveText(
        String(agingSnapshot.overdueCount),
      );
      await expect(summarySection.getByText('逾期 1-30 天')).toBeVisible();
    } finally {
      await cleanupSettlementRegressionScenario(scenario);
    }
  });
});
