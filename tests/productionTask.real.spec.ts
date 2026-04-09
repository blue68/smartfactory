delete (globalThis as any).expect;
import { test, expect } from '@playwright/test';
import {
  APP_BASE_URL,
  seedAuth,
  seedProductionTaskScenario,
  seedProductionTaskDependencyRecoveryScenario,
  seedProductionTaskCompleteScenario,
  seedProductionTaskMixedTimelineScenario,
  seedProductionTaskResolveExceptionScenario,
  seedProductionTaskStartScenario,
  seedProductionTaskSuspendScenario,
  seedProductionTaskRegressionScenario,
  unblockProductionTaskDependency,
  cleanupProductionTaskScenario,
  cleanupProductionTaskCompleteScenario,
  cleanupProductionTaskMixedTimelineScenario,
  cleanupProductionTaskResolveExceptionScenario,
  cleanupProductionTaskStartScenario,
  cleanupProductionTaskSuspendScenario,
  cleanupProductionTaskRegressionScenario,
  closeProductionTaskFlowDbPool,
  waitForProductionTaskCompleted,
  waitForProductionTaskExceptionResolved,
  waitForProductionTaskStarted,
  waitForProductionTaskSuspended,
} from './helpers/productionTaskFlow';

test.describe.serial('生产任务前端交互（真实后端）', () => {
  test.setTimeout(120_000);

  test.afterAll(async () => {
    await closeProductionTaskFlowDbPool();
  });

  test('老板可在任务页查看真实详情聚合 @production-task-smoke', async ({ page }) => {
    const scenario = await seedProductionTaskScenario();

    try {
      await seedAuth(page, 'boss');
      await page.goto(`${APP_BASE_URL}/production/tasks`);

      await expect(page.locator('#main-content').getByRole('heading', { name: '生产任务管理' })).toBeVisible();
      await page.getByLabel('关键词搜索').fill(scenario.taskNo);

      const row = page.locator('tbody tr').filter({ hasText: scenario.taskNo }).first();
      await expect(row).toBeVisible({ timeout: 15_000 });
      await expect(row.getByText(scenario.orderNo)).toBeVisible();
      await expect(row.getByText(scenario.currentStepName)).toBeVisible();
      await row.getByRole('button', { name: '详情' }).click();

      const drawer = page.getByRole('dialog', { name: '任务详情' });
      await expect(drawer).toBeVisible();
      await expect(drawer.getByText('依赖与阻塞')).toBeVisible();
      await expect(drawer.getByText(scenario.blockingReason)).toBeVisible();
      await expect(drawer.getByText(scenario.predecessorStepName, { exact: true })).toBeVisible();
      await expect(drawer.getByText('投入产出与库存流水')).toBeVisible();
      await expect(drawer.getByText(scenario.materialSkuName).first()).toBeVisible();
      await expect(drawer.getByText(scenario.outputSkuName).first()).toBeVisible();
      await expect(drawer.getByText(scenario.inputTransactionNo)).toBeVisible();
      await expect(drawer.getByText(scenario.outputTransactionNo)).toBeVisible();
      await expect(drawer.getByText('工资与工时')).toBeVisible();
      await expect(drawer.getByText(`来源 ${scenario.reportNo} · ${scenario.currentStepName}`)).toBeVisible();
      await expect(drawer.getByText('¥40.00').first()).toBeVisible();
      await expect(drawer.getByText('异常记录')).toBeVisible();
      await expect(drawer.getByText(scenario.exceptionDescription)).toBeVisible();
    } finally {
      await cleanupProductionTaskScenario(scenario);
    }
  });

  test('老板可在任务详情里看到兼容降级空态和已处理异常时间线 @production-task-regression', async ({ page }) => {
    const scenario = await seedProductionTaskRegressionScenario();

    try {
      await seedAuth(page, 'boss');
      await page.goto(`${APP_BASE_URL}/production/tasks`);

      await expect(page.locator('#main-content').getByRole('heading', { name: '生产任务管理' })).toBeVisible();
      await page.getByLabel('关键词搜索').fill(scenario.taskNo);

      const row = page.locator('tbody tr').filter({ hasText: scenario.taskNo }).first();
      await expect(row).toBeVisible({ timeout: 15_000 });
      await row.getByRole('button', { name: '详情' }).click();

      const drawer = page.getByRole('dialog', { name: '任务详情' });
      await expect(drawer).toBeVisible();
      await expect(drawer.getByText('投入产出与库存流水')).toBeVisible();
      await expect(drawer.getByText('尚无投入记录')).toBeVisible();
      await expect(drawer.getByText('尚无产出记录')).toBeVisible();

      await expect(drawer.getByText('工资与工时')).toBeVisible();
      await expect(drawer.getByText('尚未生成工资报工记录，历史兼容任务会在这里安全降级为空。')).toBeVisible();

      await expect(drawer.getByText('异常记录')).toBeVisible();
      await expect(drawer.getByText(scenario.exceptionDescription)).toBeVisible();
      await expect(drawer.getByText(scenario.resolvedExceptionDescription)).toBeVisible();
      await expect(drawer.getByText('已处理', { exact: true })).toBeVisible();
    } finally {
      await cleanupProductionTaskRegressionScenario(scenario);
    }
  });

  test('老板可在任务详情里看到前置工序解除阻塞后的恢复状态 @production-task-regression', async ({ page }) => {
    const scenario = await seedProductionTaskDependencyRecoveryScenario();

    try {
      await seedAuth(page, 'boss');
      await page.goto(`${APP_BASE_URL}/production/tasks`);

      await expect(page.locator('#main-content').getByRole('heading', { name: '生产任务管理' })).toBeVisible();
      await page.getByLabel('关键词搜索').fill(scenario.taskNo);

      const row = page.locator('tbody tr').filter({ hasText: scenario.taskNo }).first();
      await expect(row).toBeVisible({ timeout: 15_000 });
      await row.getByRole('button', { name: '详情' }).click();

      const drawer = page.getByRole('dialog', { name: '任务详情' });
      await expect(drawer).toBeVisible();
      await expect(drawer.getByText('依赖与阻塞')).toBeVisible();
      await expect(drawer.getByText(scenario.blockingReason)).toBeVisible();
      await expect(drawer.getByText('未满足', { exact: true })).toBeVisible();

      await unblockProductionTaskDependency(scenario);

      await page.reload();
      await expect(page.locator('#main-content').getByRole('heading', { name: '生产任务管理' })).toBeVisible();
      await page.getByLabel('关键词搜索').fill(scenario.taskNo);

      const recoveredRow = page.locator('tbody tr').filter({ hasText: scenario.taskNo }).first();
      await expect(recoveredRow).toBeVisible({ timeout: 15_000 });
      await recoveredRow.getByRole('button', { name: '详情' }).click();

      const recoveredDrawer = page.getByRole('dialog', { name: '任务详情' });
      await expect(recoveredDrawer).toBeVisible();
      await expect(recoveredDrawer.getByText('依赖与阻塞')).toBeVisible();
      await expect(recoveredDrawer.getByText(scenario.predecessorStepName, { exact: true })).toBeVisible();
      await expect(recoveredDrawer.getByText('已满足', { exact: true })).toBeVisible();
      await expect(recoveredDrawer.getByText('状态 completed')).toBeVisible();
      await expect(recoveredDrawer.getByText(scenario.blockingReason)).toHaveCount(0);
      await expect(recoveredDrawer.getByText('未满足', { exact: true })).toHaveCount(0);
    } finally {
      await cleanupProductionTaskScenario(scenario);
    }
  });

  test('老板可在任务详情里看到工资板块与混合异常时间线并存 @production-task-regression', async ({ page }) => {
    const scenario = await seedProductionTaskMixedTimelineScenario();

    try {
      await seedAuth(page, 'boss');
      await page.goto(`${APP_BASE_URL}/production/tasks`);

      await expect(page.locator('#main-content').getByRole('heading', { name: '生产任务管理' })).toBeVisible();
      await page.getByLabel('关键词搜索').fill(scenario.taskNo);

      const row = page.locator('tbody tr').filter({ hasText: scenario.taskNo }).first();
      await expect(row).toBeVisible({ timeout: 15_000 });
      await row.getByRole('button', { name: '详情' }).click();

      const drawer = page.getByRole('dialog', { name: '任务详情' });
      await expect(drawer).toBeVisible();

      await expect(drawer.getByText('生产数据')).toBeVisible();
      await expect(drawer.getByText('超时', { exact: true })).toBeVisible();

      await expect(drawer.getByText('工资与工时')).toBeVisible();
      await expect(drawer.getByText('skilled')).toBeVisible();
      await expect(drawer.getByText(`${scenario.expectedWorkHours}h`)).toBeVisible();
      await expect(drawer.getByText(`¥${scenario.expectedUnitPrice}`)).toBeVisible();
      await expect(drawer.getByText(`¥${scenario.expectedSubtotal}`).first()).toBeVisible();
      await expect(drawer.getByText(`来源 ${scenario.reportNo} · ${scenario.currentStepName}`)).toBeVisible();

      await expect(drawer.getByText('异常记录')).toBeVisible();
      await expect(drawer.getByText(scenario.resolvedExceptionDescription)).toBeVisible();
      await expect(drawer.getByText(scenario.extraExceptionDescription)).toBeVisible();
      await expect(drawer.getByText(scenario.exceptionDescription)).toBeVisible();
      await expect(drawer.getByText('已处理', { exact: true })).toHaveCount(1);
    } finally {
      await cleanupProductionTaskMixedTimelineScenario(scenario);
    }
  });

  test('老板可在任务详情里标记异常已处理并看到任务恢复进行中 @production-task-regression', async ({ page }) => {
    const scenario = await seedProductionTaskResolveExceptionScenario();

    try {
      await seedAuth(page, 'boss');
      await page.goto(`${APP_BASE_URL}/production/tasks`);

      await expect(page.locator('#main-content').getByRole('heading', { name: '生产任务管理' })).toBeVisible();
      await page.getByLabel('关键词搜索').fill(scenario.taskNo);

      const row = page.locator('tbody tr').filter({ hasText: scenario.taskNo }).first();
      await expect(row).toBeVisible({ timeout: 15_000 });
      await expect(row.getByText('异常')).toBeVisible();
      await row.getByRole('button', { name: '详情' }).click();

      const drawer = page.getByRole('dialog', { name: '任务详情' });
      await expect(drawer).toBeVisible();
      await expect(drawer.getByRole('button', { name: '标记已处理' })).toBeVisible();
      await drawer.getByRole('button', { name: '标记已处理' }).click();

      const modal = page.getByRole('dialog', { name: '标记异常已处理' });
      await expect(modal).toBeVisible();
      await modal.getByLabel('处理说明').fill(scenario.resolution);
      await modal.getByRole('button', { name: '确认处理' }).click();

      await expect(page.getByRole('alert').filter({ hasText: '异常已标记处理，任务恢复进行中' })).toBeVisible();
      await expect(drawer.getByRole('button', { name: '完工上报' })).toBeVisible();
      await expect(drawer.getByRole('button', { name: '上报异常' })).toBeVisible();
      await expect(drawer.getByRole('button', { name: '标记已处理' })).toHaveCount(0);
      await expect(drawer.getByText('已处理', { exact: true })).toBeVisible();

      const resolved = await waitForProductionTaskExceptionResolved(scenario);
      expect(resolved.taskStatus).toBe('started');
      expect(resolved.affectsProgress).toBe(0);
      expect(resolved.resolution).toBe(scenario.resolution);
    } finally {
      await cleanupProductionTaskResolveExceptionScenario(scenario);
    }
  });

  test('老板可在异常任务详情里挂起任务并看到状态切到已挂起 @production-task-regression', async ({ page }) => {
    const scenario = await seedProductionTaskSuspendScenario();

    try {
      await seedAuth(page, 'boss');
      await page.goto(`${APP_BASE_URL}/production/tasks`);

      await expect(page.locator('#main-content').getByRole('heading', { name: '生产任务管理' })).toBeVisible();
      await page.getByLabel('关键词搜索').fill(scenario.taskNo);

      const row = page.locator('tbody tr').filter({ hasText: scenario.taskNo }).first();
      await expect(row).toBeVisible({ timeout: 15_000 });
      await expect(row.getByText('异常')).toBeVisible();
      await row.getByRole('button', { name: '详情' }).click();

      const drawer = page.getByRole('dialog', { name: '任务详情' });
      await expect(drawer).toBeVisible();
      await expect(drawer.getByRole('button', { name: '挂起任务' })).toBeVisible();
      await drawer.getByRole('button', { name: '挂起任务' }).click();

      const modal = page.getByRole('dialog', { name: '挂起任务' });
      await expect(modal).toBeVisible();
      await modal.getByLabel('挂起原因').fill(scenario.suspendReason);
      await modal.getByRole('button', { name: '确认挂起' }).click();

      await expect(page.getByRole('alert').filter({ hasText: `任务 #${scenario.taskId} 已挂起` })).toBeVisible();
      await expect(drawer.getByText('已挂起', { exact: true })).toBeVisible();
      await expect(drawer.getByRole('button', { name: '挂起任务' })).toHaveCount(0);
      await expect(drawer.getByRole('button', { name: '标记已处理' })).toHaveCount(0);

      const suspended = await waitForProductionTaskSuspended(scenario);
      expect(suspended.taskStatus).toBe('suspended');
      expect(suspended.suspendReason).toBe(scenario.suspendReason);
    } finally {
      await cleanupProductionTaskSuspendScenario(scenario);
    }
  });

  test('主管可在待开始任务详情里开始生产并看到首批投入记录 @production-task-regression', async ({ page }) => {
    const scenario = await seedProductionTaskStartScenario();

    try {
      await seedAuth(page, 'supervisor');
      await page.goto(`${APP_BASE_URL}/production/tasks`);

      await expect(page.locator('#main-content').getByRole('heading', { name: '生产任务管理' })).toBeVisible();
      await page.getByLabel('关键词搜索').fill(scenario.taskNo);

      const row = page.locator('tbody tr').filter({ hasText: scenario.taskNo }).first();
      await expect(row).toBeVisible({ timeout: 15_000 });
      await expect(row.getByText('待开始')).toBeVisible();
      await row.getByRole('button', { name: '详情' }).click();

      const drawer = page.getByRole('dialog', { name: '任务详情' });
      await expect(drawer).toBeVisible();
      await expect(drawer.getByRole('button', { name: '开始生产' })).toBeVisible();
      await drawer.getByRole('button', { name: '开始生产' }).click();

      await expect(page.getByRole('alert').filter({ hasText: `任务 ${scenario.taskId} 已开始` })).toBeVisible();
      await expect(drawer.getByRole('button', { name: '完工上报' })).toBeVisible();
      await expect(drawer.getByRole('button', { name: '上报异常' })).toBeVisible();
      await expect(drawer.getByRole('button', { name: '开始生产' })).toHaveCount(0);
      await expect(drawer.getByText(scenario.materialSkuName)).toBeVisible();
      await expect(drawer.getByText('未落库存流水')).toBeVisible();
      await expect(drawer.getByText('待生成流水号')).toBeVisible();

      const started = await waitForProductionTaskStarted(scenario);
      expect(started.taskStatus).toBe('started');
      expect(started.orderStatus).toBe('in_progress');
      expect(started.plannedQty).toBe(scenario.expectedInputQty);
      expect(started.actualQty).toBe(scenario.expectedInputQty);
      expect(started.inventoryTxId).toBeNull();
    } finally {
      await cleanupProductionTaskStartScenario(scenario);
    }
  });

  test('主管可在进行中任务详情里完工上报并看到工资与产出写入 @production-task-regression', async ({ page }) => {
    const scenario = await seedProductionTaskCompleteScenario();

    try {
      await seedAuth(page, 'supervisor');
      await page.goto(`${APP_BASE_URL}/production/tasks`);

      await expect(page.locator('#main-content').getByRole('heading', { name: '生产任务管理' })).toBeVisible();
      await page.getByLabel('关键词搜索').fill(scenario.taskNo);

      const row = page.locator('tbody tr').filter({ hasText: scenario.taskNo }).first();
      await expect(row).toBeVisible({ timeout: 15_000 });
      await expect(row.getByText('进行中')).toBeVisible();
      await row.getByRole('button', { name: '详情' }).click();

      const drawer = page.getByRole('dialog', { name: '任务详情' });
      await expect(drawer).toBeVisible();
      await expect(drawer.getByRole('button', { name: '完工上报' })).toBeVisible();
      await drawer.getByRole('button', { name: '完工上报' }).click();

      const modal = page.getByRole('dialog', { name: '完工上报' });
      await expect(modal).toBeVisible();
      await modal.getByLabel('完成件数').fill(scenario.completedQty);
      await modal.getByLabel('实际工时（小时）').fill(scenario.actualHours);
      await modal.getByLabel('废品数量（件）').fill(scenario.scrapQty);
      await modal.getByLabel('备注（选填）').fill(scenario.notes);
      await modal.getByRole('button', { name: '确认完成' }).click();

      await expect(page.getByRole('alert').filter({ hasText: `任务 #${scenario.taskId} 已标记完成` })).toBeVisible();
      await expect(drawer.getByRole('button', { name: '完工上报' })).toHaveCount(0);
      await expect(drawer.getByText('工资与工时')).toBeVisible();
      await expect(drawer.getByText('待生成流水号')).toBeVisible();

      const completed = await waitForProductionTaskCompleted(scenario);
      expect(completed.taskStatus).toBe('completed');
      expect(completed.orderStatus).toBe('completed');
      expect(completed.orderQtyCompleted).toBe('12.0000');
      expect(completed.qtyQualified).toBe(scenario.expectedQualifiedQty);
      expect(completed.workHours).toBe('2.50');
      expect(completed.unitWage).toBe(scenario.expectedUnitWage);
      expect(completed.wageAmount).toBe(scenario.expectedSubtotal);
      expect(completed.outputSkuId).toBe(scenario.finishedSkuId);
      expect(completed.outputActualQty).toBe('12.0000');
      expect(completed.outputInventoryTxId).toBeNull();

      await expect(drawer.getByText(`来源 ${completed.reportNo} · ${scenario.currentStepName}`)).toBeVisible();
      await expect(drawer.getByText(`¥${scenario.expectedSubtotal}`).first()).toBeVisible();
    } finally {
      await cleanupProductionTaskCompleteScenario(scenario);
    }
  });
});
