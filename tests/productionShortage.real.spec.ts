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
});
