delete (globalThis as any).expect;
import { test, expect } from '@playwright/test';
import {
  APP_BASE_URL,
  seedAuth,
  seedProcessConfigScenario,
  seedProcessConfigRegressionScenario,
  cleanupProcessConfigScenario,
  cleanupProcessConfigRegressionScenario,
  waitForProcessStepSnapshot,
  waitForProcessWage,
  closeProcessConfigFlowDbPool,
} from './helpers/processConfigFlow';

test.describe.serial('工序配置前端交互（真实后端）', () => {
  test.setTimeout(120_000);

  test.afterAll(async () => {
    await closeProcessConfigFlowDbPool();
  });

  test('老板可在工序配置页新增工作站类型和工作站 @process-config-smoke', async ({ page }) => {
    const scenario = await seedProcessConfigScenario();

    try {
      await seedAuth(page, 'boss');
      await page.goto(`${APP_BASE_URL}/master-data/process-config`);

      await expect(page.getByRole('heading', { name: '工序配置' })).toBeVisible();
      await page.getByText(scenario.templateName).click();
      await expect(page.getByLabel('模板名称')).toHaveValue(scenario.templateName);

      await page.getByRole('button', { name: `编辑工序 ${scenario.stepName}` }).click();
      const drawer = page.getByRole('dialog', { name: '编辑工序节点' });
      await expect(drawer).toBeVisible();

      await drawer.getByRole('button', { name: '管理工作站' }).click();
      const modal = page.getByRole('dialog', { name: '管理工作站' });
      await expect(modal).toBeVisible();

      await modal.getByPlaceholder('输入新工作站类型').fill(scenario.newTypeName);
      await modal.getByRole('button', { name: '添加类型' }).click();
      await expect(modal.locator('li').filter({ hasText: scenario.newTypeName })).toBeVisible();

      await modal.getByPlaceholder('如：开料区 A 线').fill(scenario.newWorkstationName);
      await modal.locator('select').first().selectOption(scenario.newTypeName);
      await modal.locator('input[type="number"]').first().fill('88');
      await modal.getByRole('button', { name: '新增工作站' }).click();

      const workstationRow = modal.locator('tbody tr').filter({ hasText: scenario.newWorkstationName }).first();
      await expect(workstationRow).toBeVisible();
      await expect(workstationRow.getByRole('cell', { name: scenario.newTypeName })).toBeVisible();
      await expect(workstationRow.getByRole('cell', { name: '88' })).toBeVisible();
      await expect(workstationRow.getByRole('cell', { name: '启用' })).toBeVisible();
    } finally {
      await cleanupProcessConfigScenario(scenario);
    }
  });

  test('老板可编辑工序工作站与最大工时并保存到真实后端 @process-config-regression', async ({ page }) => {
    const scenario = await seedProcessConfigRegressionScenario();

    try {
      await seedAuth(page, 'boss');
      await page.goto(`${APP_BASE_URL}/master-data/process-config`);

      await expect(page.getByRole('heading', { name: '工序配置' })).toBeVisible();
      await page.getByText(scenario.templateName).click();
      await expect(page.getByLabel('模板名称')).toHaveValue(scenario.templateName);

      await page.getByRole('button', { name: `编辑工序 ${scenario.stepName}` }).click();
      const drawer = page.getByRole('dialog', { name: '编辑工序节点' });
      await expect(drawer).toBeVisible();

      await drawer.locator('select').nth(0).selectOption({ label: scenario.targetTypeName });
      await drawer.locator('select').nth(1).selectOption(String(scenario.targetWorkstationId));
      await drawer.locator('input[type="number"]').nth(1).fill('6');
      await drawer.locator('input[type="number"]').nth(2).fill('23.5');
      await drawer.getByRole('button', { name: '完成' }).click();
      await expect(drawer).toBeHidden();

      await page.getByRole('button', { name: '保存模板' }).click();
      await expect(page.getByRole('button', { name: '保存模板' })).toHaveText(/已保存/);

      const savedStep = await waitForProcessStepSnapshot(scenario.templateId, scenario.stepNo, {
        workstationType: scenario.targetTypeName,
        workstationId: scenario.targetWorkstationId,
        maxHours: '6.00',
      });
      await waitForProcessWage(savedStep.id, '23.50');

      await page.reload();
      await page.getByText(scenario.templateName).click();
      await page.getByRole('button', { name: `编辑工序 ${scenario.stepName}` }).click();
      await expect(drawer).toBeVisible();
      await expect(drawer.locator('select').nth(0)).toHaveValue(scenario.targetTypeName);
      await expect(drawer.locator('select').nth(1)).toHaveValue(String(scenario.targetWorkstationId));
      await expect(drawer.locator('input[type="number"]').nth(1)).toHaveValue('6');
      await expect(drawer.getByText(`已关联具体工作站：${scenario.targetWorkstationName}`)).toBeVisible();
    } finally {
      await cleanupProcessConfigRegressionScenario(scenario);
    }
  });
});
