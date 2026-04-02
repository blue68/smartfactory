delete (globalThis as any).expect;
import { test, expect } from '@playwright/test';
import {
  APP_BASE_URL,
  seedAuth,
  seedProductionTaskScenario,
  seedProductionOrderCancelScenario,
  seedProductionOrderCreateScenario,
  seedProductionOrderRegressionScenario,
  cleanupProductionTaskScenario,
  cleanupProductionOrderCancelScenario,
  cleanupProductionOrderCreateScenario,
  cleanupProductionOrderRegressionScenario,
  closeProductionTaskFlowDbPool,
  waitForProductionOrderCancelled,
  waitForProductionOrderCreated,
} from './helpers/productionTaskFlow';

test.describe.serial('生产工单前端交互（真实后端）', () => {
  test.setTimeout(120_000);

  test.afterAll(async () => {
    await closeProductionTaskFlowDbPool();
  });

  test('老板可在工单页查看真实结构快照与工序链路 @production-order-smoke', async ({ page }) => {
    const scenario = await seedProductionTaskScenario();

    try {
      await seedAuth(page, 'boss');
      await page.goto(`${APP_BASE_URL}/production/orders`);

      await expect(page.getByText('🏭 生产工单')).toBeVisible();

      const card = page.locator('[class*="orderCard"]').filter({ hasText: scenario.orderNo }).first();
      await expect(card).toBeVisible({ timeout: 15_000 });
      await expect(card).toContainText(scenario.orderNo);
      const detailButton = card.locator('button').filter({ hasText: '查看详情' });
      await expect(detailButton).toHaveCount(1);
      await detailButton.dispatchEvent('click');

      await expect(page.getByText('冻结结构 1 节点')).toBeVisible();
      await expect(page.getByRole('heading', { name: scenario.orderNo })).toBeVisible();
      await expect(page.getByText('工序链 2 道')).toBeVisible();
      await expect(page.getByText('任务 1 条')).toBeVisible();

      await page.getByText('结构快照').click();
      await expect(page.getByText('冻结结构快照')).toBeVisible();
      await expect(page.getByText('冻结 SKU：')).toBeVisible();
      await expect(page.getByText('路径 fg')).toBeVisible();
      await expect(page.getByText('成品', { exact: true })).toBeVisible();

      await page.getByText('工序链路').click();
      await expect(page.getByText('半成品工序链路')).toBeVisible();
      await expect(page.getByText(scenario.predecessorStepName, { exact: true })).toBeVisible();
      await expect(page.getByText(scenario.currentStepName, { exact: true })).toBeVisible();
      await expect(page.getByText(`产出 ${scenario.outputSkuName}`)).toHaveCount(2);
      await expect(page.getByText(scenario.taskNo)).toBeVisible();
      await expect(page.getByText('测试熟练工')).toBeVisible();
    } finally {
      await cleanupProductionTaskScenario(scenario);
    }
  });

  test('老板可在工单详情里查看通配解析结构和多任务折叠提示 @production-order-regression', async ({ page }) => {
    const scenario = await seedProductionOrderRegressionScenario();

    try {
      await seedAuth(page, 'boss');
      await page.goto(`${APP_BASE_URL}/production/orders`);

      await expect(page.getByText('🏭 生产工单')).toBeVisible();

      const card = page.locator('[class*="orderCard"]').filter({ hasText: scenario.orderNo }).first();
      await expect(card).toBeVisible({ timeout: 15_000 });
      await card.locator('button').filter({ hasText: '查看详情' }).dispatchEvent('click');

      await expect(page.getByText('冻结结构 2 节点')).toBeVisible();
      await expect(page.getByText('任务 4 条')).toBeVisible();

      await page.getByText('结构快照').click();
      await expect(page.getByText('冻结结构快照')).toBeVisible();
      await expect(page.getByText(`通配解析：${scenario.wildcardSourceSkuName} → ${scenario.wildcardResolvedSkuName}`)).toBeVisible();
      await expect(page.getByText('路径 fg>wip')).toBeVisible();
      await expect(page.getByText('通配解析', { exact: true })).toBeVisible();

      await page.getByText('工序链路').click();
      await expect(page.getByText('半成品工序链路')).toBeVisible();
      await expect(page.getByText('还有 1 个任务')).toBeVisible();
      await expect(page.getByText(scenario.taskNo, { exact: true })).toBeVisible();
    } finally {
      await cleanupProductionOrderRegressionScenario(scenario);
    }
  });

  test('老板可在待排产工单详情里取消工单并看到状态切到已取消 @production-order-regression', async ({ page }) => {
    const scenario = await seedProductionOrderCancelScenario();

    try {
      await seedAuth(page, 'boss');
      await page.goto(`${APP_BASE_URL}/production/orders`);

      await expect(page.getByText('🏭 生产工单')).toBeVisible();

      const card = page.locator('[class*="orderCard"]').filter({ hasText: scenario.orderNo }).first();
      await expect(card).toBeVisible({ timeout: 15_000 });
      await expect(card).toContainText('待排产');
      await card.locator('button').filter({ hasText: '查看详情' }).dispatchEvent('click');

      await expect(page.getByRole('heading', { name: scenario.orderNo })).toBeVisible();
      await expect(page.getByRole('button', { name: '取消工单' })).toBeVisible();
      await page.getByRole('button', { name: '取消工单' }).click();

      const modal = page.getByRole('dialog', { name: '确认取消工单' });
      await expect(modal).toBeVisible();
      await expect(modal.getByText(`确定要取消工单 ${scenario.orderNo} 吗？`)).toBeVisible();
      await modal.getByRole('button', { name: '确认' }).click();

      await expect(page.getByRole('dialog', { name: '确认取消工单' })).toHaveCount(0);
      await expect(page.getByRole('heading', { name: scenario.orderNo })).toHaveCount(0);
      await expect(card).toContainText('已取消');
      await expect(card).toContainText('工单已取消');

      const cancelled = await waitForProductionOrderCancelled(scenario);
      expect(cancelled.orderStatus).toBe('cancelled');
      expect(cancelled.taskStatus).toBe('cancelled');
    } finally {
      await cleanupProductionOrderCancelScenario(scenario);
    }
  });

  test('老板可从销售订单手动创建工单并看到待排产齐套卡片 @production-order-regression', async ({ page }) => {
    const scenario = await seedProductionOrderCreateScenario();

    try {
      await seedAuth(page, 'boss');
      await page.goto(`${APP_BASE_URL}/production/orders`);

      await expect(page.getByText('🏭 生产工单')).toBeVisible();
      await page.getByRole('button', { name: '+ 手动创建工单' }).click();

      const modal = page.getByRole('dialog', { name: '从销售订单创建工单' });
      await expect(modal).toBeVisible();
      await modal.getByPlaceholder('输入销售订单单号，例如 SO260325-00002').fill(scenario.salesOrderNo);
      await modal.getByRole('button', { name: '确认' }).click();

      await expect(page.getByRole('alert')).toContainText(`已按销售订单 ${scenario.salesOrderNo} 创建生产工单`);
      await expect(page.getByRole('dialog', { name: '从销售订单创建工单' })).toHaveCount(0);

      const created = await waitForProductionOrderCreated(scenario);
      expect(created.orderStatus).toBe('pending');
      expect(created.materialStatus).toBe('ready');
      expect(created.salesOrderStatus).toBe('in_production');
      expect(Number(created.qtyReserved)).toBe(12);
      expect(Number(created.qtyShortage)).toBe(0);
      expect(created.requirementStatus).toBe('fulfilled');
      expect(created.bomSnapshotId).not.toBeNull();

      const card = page.locator('[class*="orderCard"]').filter({ hasText: created.workOrderNo }).first();
      await expect(card).toBeVisible({ timeout: 15_000 });
      await expect(card).toContainText(created.workOrderNo);
      await expect(card).toContainText(scenario.salesOrderNo);
      await expect(card).toContainText(scenario.finishedSkuName);
      await expect(card).toContainText('待排产');
      await expect(card).toContainText('齐套');
    } finally {
      await cleanupProductionOrderCreateScenario(scenario);
    }
  });
});
