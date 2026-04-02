delete (globalThis as any).expect;
import { test, expect } from '@playwright/test';
import {
  APP_BASE_URL,
  seedAuth,
  seedProductionScheduleScenario,
  cleanupProductionScheduleScenario,
  closeProductionTaskFlowDbPool,
  waitForProductionScheduleConfirmed,
  waitForProductionSchedulePlannedQty,
} from './helpers/productionTaskFlow';

test.describe.serial('生产排产前端交互（真实后端）', () => {
  test.setTimeout(120_000);

  test.afterAll(async () => {
    await closeProductionTaskFlowDbPool();
  });

  test('老板可在排产页查看真实风险提示与半成品产出语义 @production-schedule-smoke', async ({ page }) => {
    const scenario = await seedProductionScheduleScenario();

    try {
      await seedAuth(page, 'boss');
      await page.goto(
        `${APP_BASE_URL}/production/schedule?date=${scenario.scheduleDate}&workOrderNo=${encodeURIComponent(scenario.orderNo)}`,
      );

      await expect(page.locator('#main-content').getByRole('heading', { name: '每日排产计划' })).toBeVisible();
      await page.getByRole('button', { name: '重新生成' }).click();

      await expect(page.getByText('今日排产风险提示')).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText('今日产能已接近满载')).toBeVisible();
      await expect(page.getByText(`当前聚焦 ${scenario.orderNo}`)).toBeVisible();
      await expect(page.getByText(scenario.orderNo).first()).toBeVisible();
      await expect(page.getByText(scenario.outputSkuName).first()).toBeVisible();
      await expect(page.getByText(scenario.predecessorStepName, { exact: true })).toBeVisible();
      await expect(page.getByText(scenario.currentStepName, { exact: true })).toBeVisible();

      await page.getByRole('button', { name: /人员视图/ }).click();
      await expect(page.getByText('工人任务分配')).toBeVisible();
      await expect(page.getByText('测试熟练工')).toBeVisible();
      await expect(page.getByText(`${scenario.predecessorStepName} · ${scenario.outputSkuName}`)).toBeVisible();
      await expect(page.getByText(`${scenario.currentStepName} · ${scenario.outputSkuName}`)).toBeVisible();
    } finally {
      await cleanupProductionScheduleScenario(scenario);
    }
  });

  test('老板可在排产页调整计划数量并持久化到真实排产行 @production-schedule-regression', async ({ page }) => {
    const scenario = await seedProductionScheduleScenario();

    try {
      await seedAuth(page, 'boss');
      await page.goto(
        `${APP_BASE_URL}/production/schedule?date=${scenario.scheduleDate}&workOrderNo=${encodeURIComponent(scenario.orderNo)}`,
      );

      await expect(page.locator('#main-content').getByRole('heading', { name: '每日排产计划' })).toBeVisible();
      await page.getByRole('button', { name: '重新生成' }).click();
      await expect(page.getByText('今日排产风险提示')).toBeVisible({ timeout: 20_000 });

      const currentStepLine = page.getByRole('button', {
        name: new RegExp(`${scenario.currentStepName}.*${scenario.outputSkuName}.*12套`),
      }).first();
      await expect(currentStepLine).toBeVisible();
      await currentStepLine.click();

      await expect(page.getByText('调整排产任务')).toBeVisible();
      await page.getByLabel('计划数量').fill('9.50');
      const adjustResponsePromise = page.waitForResponse((response) =>
        response.url().includes(`/api/production/schedule/${scenario.scheduleDate}/adjust`) &&
        response.request().method() === 'PUT',
      );
      await page.getByRole('button', { name: '保存调整' }).click();
      const adjustResponse = await adjustResponsePromise;
      expect(adjustResponse.ok()).toBeTruthy();
      const adjustBody = await adjustResponse.json();
      expect(adjustBody.code).toBe(0);
      expect(adjustBody.data.updated).toBe(1);

      const snapshot = await waitForProductionSchedulePlannedQty(
        scenario.scheduleDate,
        scenario.currentOperationId,
        '9.50',
      );

      await expect(page.getByText('调整排产任务')).toBeHidden({ timeout: 10_000 });
      await expect(page.getByRole('button', {
        name: new RegExp(`${scenario.currentStepName}.*${scenario.outputSkuName}.*9\\.50套`),
      }).first()).toBeVisible();
      await expect(page.getByText('计划量 21.50套')).toBeVisible();

      expect(snapshot.status).toBe('planned');
      expect(snapshot.workerId).not.toBeNull();
      expect(snapshot.workstationId).not.toBeNull();
    } finally {
      await cleanupProductionScheduleScenario(scenario);
    }
  });

  test('老板可在排产页确认下发计划并生成正式生产任务 @production-schedule-regression', async ({ page }) => {
    const scenario = await seedProductionScheduleScenario();

    try {
      await seedAuth(page, 'boss');
      await page.goto(
        `${APP_BASE_URL}/production/schedule?date=${scenario.scheduleDate}&workOrderNo=${encodeURIComponent(scenario.orderNo)}`,
      );

      await expect(page.locator('#main-content').getByRole('heading', { name: '每日排产计划' })).toBeVisible();
      await page.getByRole('button', { name: '重新生成' }).click();
      await expect(page.getByText('今日排产风险提示')).toBeVisible({ timeout: 20_000 });

      await expect(page.getByRole('button', { name: '确认并下发给工人' })).toBeVisible();
      await page.getByRole('button', { name: '确认并下发给工人' }).click();

      await expect(page.getByText('确认并下发排产计划')).toBeVisible();
      await expect(page.getByText('任务条数')).toBeVisible();
      await page.getByRole('button', { name: '确认下发' }).click();

      await expect(page.getByRole('alert').filter({ hasText: '计划已下发，1 名工人将收到今日任务' })).toBeVisible();
      await expect(page.getByText('✓ 已确认并下发今日计划')).toBeVisible();
      await expect(page.getByText(/^已下发/)).toBeVisible();
      await expect(page.getByRole('button', { name: '确认并下发给工人' })).toHaveCount(0);

      const confirmed = await waitForProductionScheduleConfirmed(scenario);
      expect(confirmed.status).toBe('confirmed');
      expect(confirmed.workerId).not.toBeNull();
      expect(confirmed.workstationId).not.toBeNull();
      expect(confirmed.taskStatus).toBe('pending');
      expect(confirmed.processStepId).toBe(scenario.currentStepId);
      expect(confirmed.outputSkuId).toBe(scenario.wipSkuId);
      expect(confirmed.plannedQty).toBe('12.0000');
    } finally {
      await cleanupProductionScheduleScenario(scenario);
    }
  });
});
