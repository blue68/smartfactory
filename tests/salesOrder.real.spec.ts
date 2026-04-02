delete (globalThis as any).expect;
import { test, expect } from '@playwright/test';
import {
  APP_BASE_URL,
  seedAuth,
  seedSalesOrderScenario,
  seedExistingDeliverySalesOrderScenario,
  cleanupSalesOrderScenario,
  waitForSalesOrderSnapshot,
  closeSalesOrderFlowDbPool,
} from './helpers/salesOrderFlow';

test.describe.serial('销售订单前端交互（真实后端） @sales-order-regression', () => {
  test.setTimeout(120_000);

  test.afterAll(async () => {
    await closeSalesOrderFlowDbPool();
  });

  test('老板可在销售订单页完成发货并确认收货完结 @sales-order-smoke @sales-order-regression', async ({ page }) => {
    const scenario = await seedSalesOrderScenario();

    try {
      await seedAuth(page, 'boss');
      await page.goto(`${APP_BASE_URL}/sales/order-list`);

      await expect(page.locator('#main-content').getByRole('heading', { name: '销售订单管理' })).toBeVisible();

      const row = page.locator('tbody tr').filter({ hasText: scenario.orderNo }).first();
      await expect(row).toBeVisible({ timeout: 15_000 });
      await expect(row.getByText('生产中')).toBeVisible();

      await row.getByRole('button', { name: '查看详情' }).click();

      const drawer = page.getByRole('dialog', { name: '订单详情' });
      await expect(drawer).toBeVisible();
      await expect(drawer).toContainText(scenario.customerName);
      await expect(drawer).toContainText(scenario.skuName);

      await drawer.getByRole('button', { name: '标记发货' }).click();

      const shipModal = page.getByRole('dialog', { name: '标记发货' });
      await expect(shipModal).toBeVisible();
      await shipModal.locator('input[placeholder="选填"]').fill(scenario.trackingNo);
      await shipModal.locator('tbody tr').first().locator('input[type="number"]').fill('6');
      await shipModal.getByRole('button', { name: '确认发货' }).click();

      await expect(shipModal).toHaveCount(0);
      await expect(drawer.getByText('已发货').first()).toBeVisible();
      await expect(drawer.getByRole('cell', { name: scenario.trackingNo })).toBeVisible();
      await waitForSalesOrderSnapshot(
        scenario.orderId,
        (snapshot) => snapshot.orderStatus === 'shipped' && snapshot.deliveryStatus === 'pending',
      );

      await drawer.getByRole('button', { name: '确认完成' }).click();

      await expect(drawer.getByText('已完成').first()).toBeVisible();
      await expect(drawer.getByRole('cell', { name: 'received' })).toBeVisible();
      await expect(drawer.getByRole('cell', { name: '确认完成' })).toBeVisible();
      await expect(row.getByText('已完成')).toBeVisible();

      const finalSnapshot = await waitForSalesOrderSnapshot(
        scenario.orderId,
        (snapshot) => snapshot.orderStatus === 'completed' && snapshot.deliveryStatus === 'received',
      );
      expect(finalSnapshot.trackingNo).toBe(scenario.trackingNo);
      expect(finalSnapshot.deliveryNo).toBeTruthy();
      expect(finalSnapshot.deliveryCount).toBe(1);
    } finally {
      await cleanupSalesOrderScenario(scenario);
    }
  });

  test('老板可在已有发货记录的订单上补发剩余数量并收敛为已发货 @sales-order-regression', async ({ page }) => {
    const scenario = await seedExistingDeliverySalesOrderScenario();

    try {
      await seedAuth(page, 'boss');
      await page.goto(`${APP_BASE_URL}/sales/order-list`);

      await expect(page.locator('#main-content').getByRole('heading', { name: '销售订单管理' })).toBeVisible();

      const row = page.locator('tbody tr').filter({ hasText: scenario.orderNo }).first();
      await expect(row).toBeVisible({ timeout: 15_000 });
      await expect(row.getByText('生产中')).toBeVisible();

      await row.getByRole('button', { name: '查看详情' }).click();

      const drawer = page.getByRole('dialog', { name: '订单详情' });
      await expect(drawer).toBeVisible();
      await expect(drawer).toContainText(scenario.customerName);
      await expect(drawer.getByRole('cell', { name: scenario.existingTrackingNo! })).toBeVisible();
      await expect(drawer.getByRole('cell', { name: '2.0000' })).toBeVisible();
      await expect(drawer.getByRole('button', { name: '标记发货' })).toBeVisible();

      await drawer.getByRole('button', { name: '标记发货' }).click();

      const shipModal = page.getByRole('dialog', { name: '标记发货' });
      await expect(shipModal).toBeVisible();
      await shipModal.locator('input[placeholder="选填"]').fill(scenario.trackingNo);
      await shipModal.locator('tbody tr').first().locator('input[type="number"]').fill('4');
      await shipModal.getByRole('button', { name: '确认发货' }).click();

      await expect(shipModal).toHaveCount(0);
      await expect(drawer.getByText('已发货').first()).toBeVisible();
      await expect(drawer.getByRole('cell', { name: scenario.existingTrackingNo! })).toBeVisible();
      await expect(drawer.getByRole('cell', { name: scenario.trackingNo })).toBeVisible();

      const finalSnapshot = await waitForSalesOrderSnapshot(
        scenario.orderId,
        (snapshot) =>
          snapshot.orderStatus === 'shipped'
          && snapshot.deliveryStatus === 'pending'
          && snapshot.trackingNo === scenario.trackingNo
          && snapshot.deliveryCount === 2,
      );
      expect(finalSnapshot.deliveryNo).toBeTruthy();
      await expect(row.getByText('已发货')).toBeVisible();
    } finally {
      await cleanupSalesOrderScenario(scenario);
    }
  });
});
