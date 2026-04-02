delete (globalThis as any).expect;
import { test, expect } from '@playwright/test';
import {
  APP_BASE_URL,
  seedAuth,
  seedIncomingInspectionCreateScenario,
  seedIncomingInspectionSubmitScenario,
  waitForIncomingInspectionCreated,
  waitForIncomingInspectionSubmitted,
  cleanupIncomingInspectionScenario,
  closeIncomingInspectionFlowDbPool,
} from './helpers/incomingInspectionFlow';

test.describe.serial('来料质检前端交互（真实后端）', () => {
  test.setTimeout(120_000);

  test.afterAll(async () => {
    await closeIncomingInspectionFlowDbPool();
  });

  test('仓库可在来料质检页直接新建真实质检单并查看详情 @incoming-inspection-smoke', async ({ page, request }) => {
    const scenario = await seedIncomingInspectionCreateScenario(request);
    let cleanupScenario = scenario;

    try {
      await seedAuth(page, 'warehouse');
      await page.goto(`${APP_BASE_URL}/purchase/incoming-inspection`);

      await expect(page.locator('#main-content').getByRole('heading', { name: '来料质检' })).toBeVisible();
      await page.getByRole('button', { name: '+ 新建质检单' }).click();

      const createModal = page.getByRole('dialog', { name: '新建来料质检单' });
      await expect(createModal).toBeVisible();
      await createModal.getByLabel('采购订单号').fill(scenario.poNo);
      await createModal.getByLabel('送货单号').fill(scenario.deliveryNo);
      await createModal.getByPlaceholder('请输入备注（可选）').fill('Playwright 来料质检页直建');
      await createModal.getByRole('button', { name: '创建' }).click();

      await expect(page.getByRole('alert').last()).toContainText('质检单创建成功');

      const created = await waitForIncomingInspectionCreated(scenario);
      expect(created.status).toBe('draft');
      cleanupScenario = {
        ...scenario,
        inspectionId: created.inspectionId,
        inspectionNo: created.inspectionNo,
      };

      await page.locator('#keyword').fill(created.inspectionNo);

      const row = page.locator('tbody tr').filter({ hasText: created.inspectionNo }).first();
      await expect(row).toBeVisible();
      await expect(row).toContainText('草稿');
      await expect(row).toContainText(scenario.poNo);

      await row.getByRole('button', { name: '查看详情' }).click();

      const detailDrawer = page.getByRole('dialog', { name: new RegExp(`质检单详情.*${created.inspectionNo}`) });
      await expect(detailDrawer).toBeVisible();
      await expect(detailDrawer).toContainText(scenario.poNo);
      await expect(detailDrawer).toContainText(scenario.fixture.supplierName);
      await expect(detailDrawer).toContainText(scenario.fixture.skuCode);
      await expect(detailDrawer).toContainText(scenario.fixture.skuName);
      await expect(detailDrawer.getByRole('button', { name: '保存质检明细' })).toBeVisible();
      await expect(detailDrawer.getByRole('button', { name: '提交质检结论' })).toBeVisible();
    } finally {
      await cleanupIncomingInspectionScenario(cleanupScenario);
    }
  });

  test('仓库可在来料质检页提交部分合格质检并同时触发入库与退货副作用 @incoming-inspection-regression', async ({ page, request }) => {
    const scenario = await seedIncomingInspectionSubmitScenario(request);

    try {
      await seedAuth(page, 'warehouse');
      await page.goto(`${APP_BASE_URL}/purchase/incoming-inspection`);

      await expect(page.locator('#main-content').getByRole('heading', { name: '来料质检' })).toBeVisible();
      await page.locator('#keyword').fill(scenario.inspectionNo);

      const row = page.locator('tbody tr').filter({ hasText: scenario.inspectionNo }).first();
      await expect(row).toBeVisible();
      await expect(row).toContainText('质检中');
      await row.getByRole('button', { name: '查看详情' }).click();

      const detailDrawer = page.getByRole('dialog', { name: new RegExp(`质检单详情.*${scenario.inspectionNo}`) });
      await expect(detailDrawer).toBeVisible();
      await expect(detailDrawer).toContainText(scenario.fixture.skuCode);
      await expect(detailDrawer.getByRole('button', { name: '提交质检结论' })).toBeVisible();

      await detailDrawer.getByRole('button', { name: '提交质检结论' }).click();

      const submitModal = page.getByRole('dialog', { name: '提交质检结论' });
      await expect(submitModal).toBeVisible();
      await submitModal.locator('label').filter({ hasText: '不通过' }).first().click();
      await submitModal.getByPlaceholder('请输入质检备注或说明...').fill('Playwright 提交部分合格并生成退货');
      await submitModal.getByRole('button', { name: '提交结论' }).click();

      await expect(page.getByRole('alert').last()).toContainText('质检结论已提交');

      const submitted = await waitForIncomingInspectionSubmitted(scenario);
      expect(submitted.status).toBe('partially_passed');
      expect(submitted.overallResult).toBe('fail');
      expect(submitted.receiptTriggered).toBe(true);
      expect(submitted.returnTriggered).toBe(true);
      expect(submitted.inventoryQtyOnHand).toBe(scenario.expectedInventoryQtyOnHand);
      expect(submitted.qtyReceived).toBe(scenario.expectedReceiptQty);
      expect(submitted.qtyRejected).toBe(scenario.expectedRejectedQty);

      await expect(row).toContainText('部分合格');
      await expect(row).toContainText('不通过');

      await expect(detailDrawer).toContainText('部分合格');
      await expect(detailDrawer).toContainText('不通过');
      await expect(detailDrawer).toContainText(submitted.receiptNo);
      await expect(detailDrawer.getByRole('button', { name: '查看入库单' })).toBeVisible();
      await expect(detailDrawer.getByRole('button', { name: '查看三单匹配' })).toBeVisible();
      await expect(detailDrawer.getByRole('button', { name: '提交质检结论' })).toHaveCount(0);
    } finally {
      await cleanupIncomingInspectionScenario(scenario);
    }
  });
});
