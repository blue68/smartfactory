delete (globalThis as any).expect;
import { test, expect } from '@playwright/test';
import {
  APP_BASE_URL,
  cleanupAccessControlScenario,
  closeAccessControlFlowDbPool,
  ensurePlatformSuperAdminAccount,
  loginAsPlatformSuperAdmin,
  loginAsSystemAdmin,
  seedAccessControlScenario,
  waitForAuditLog,
  waitForFeatureFlagState,
} from './helpers/accessControlFlow';

test.describe.serial('权限中心前端交互（真实后端）', () => {
  test.setTimeout(120_000);

  test.afterAll(async () => {
    await closeAccessControlFlowDbPool();
  });

  test('platform_super_admin 可维护租户功能开关并生成审计记录 @permission-control-smoke', async ({ page }) => {
    const scenario = await seedAccessControlScenario();
    await ensurePlatformSuperAdminAccount();

    try {
      await loginAsPlatformSuperAdmin(page);
      await page.goto(`${APP_BASE_URL}/system/tenants`);

      const content = page.locator('#main-content');
      await expect(content.getByRole('heading', { name: '租户配置' })).toBeVisible();
      await expect(page.getByText('平台态')).toBeVisible();

      const row = content.locator('tbody tr').filter({ hasText: scenario.tenantCode }).first();
      await expect(row).toBeVisible();
      await row.getByRole('button', { name: '功能开关' }).click();

      const modal = page.getByRole('dialog', { name: `租户功能开关 · ${scenario.tenantName}` });
      await expect(modal).toBeVisible();

      const featureRow = modal.locator('tbody tr').filter({ hasText: scenario.toggleFeatureCode }).first();
      await expect(featureRow).toBeVisible();
      const featureToggle = featureRow.getByRole('checkbox');
      await expect(featureToggle).toBeChecked();
      await featureToggle.uncheck();

      await Promise.all([
        page.waitForResponse((response) => (
          response.url().includes(`/api/access-control/tenants/${scenario.tenantId}/feature-flags`)
          && response.request().method() === 'PUT'
          && response.ok()
        )),
        modal.getByRole('button', { name: '保存开关' }).click(),
      ]);
      await expect(modal).toBeHidden();

      await waitForFeatureFlagState(scenario.tenantId, scenario.toggleFeatureCode, false);
      const auditLog = await waitForAuditLog(scenario.tenantCode);
      expect(auditLog.action).toBe('update');
      expect(auditLog.module).toBe('tenant_feature');
    } finally {
      await cleanupAccessControlScenario(scenario);
    }
  });

  test('platform_super_admin 可在权限审计页筛选功能开关变更并重置筛选 @permission-control-regression', async ({ page }) => {
    const scenario = await seedAccessControlScenario();
    await ensurePlatformSuperAdminAccount();

    try {
      await loginAsPlatformSuperAdmin(page);
      await page.goto(`${APP_BASE_URL}/system/tenants`);

      const tenantPage = page.locator('#main-content');
      const row = tenantPage.locator('tbody tr').filter({ hasText: scenario.tenantCode }).first();
      await expect(row).toBeVisible();
      await row.getByRole('button', { name: '功能开关' }).click();

      const modal = page.getByRole('dialog', { name: `租户功能开关 · ${scenario.tenantName}` });
      const featureRow = modal.locator('tbody tr').filter({ hasText: scenario.toggleFeatureCode }).first();
      await featureRow.getByRole('checkbox').uncheck();
      await Promise.all([
        page.waitForResponse((response) => (
          response.url().includes(`/api/access-control/tenants/${scenario.tenantId}/feature-flags`)
          && response.request().method() === 'PUT'
          && response.ok()
        )),
        modal.getByRole('button', { name: '保存开关' }).click(),
      ]);
      await waitForAuditLog(scenario.tenantCode);

      await page.goto(`${APP_BASE_URL}/system/audit-logs`);
      const auditPage = page.locator('#main-content');
      await expect(auditPage.getByRole('heading', { name: '权限审计' })).toBeVisible();

      await auditPage.locator('select').first().selectOption(String(scenario.tenantId));
      await auditPage.getByPlaceholder('搜索对象编码/操作人').fill(scenario.tenantCode);
      await auditPage.locator('select').nth(1).selectOption('tenant_feature');

      const auditRow = auditPage.locator('tbody tr').filter({ hasText: scenario.tenantCode }).first();
      await expect(auditRow).toBeVisible();
      await expect(auditRow).toContainText('tenant_feature');
      await expect(auditRow).toContainText(`tenant / ${scenario.tenantCode}`);
      await expect(auditRow).toContainText(scenario.toggleFeatureCode);

      await auditPage.getByRole('button', { name: '重置筛选' }).click();
      await expect(auditPage.getByPlaceholder('搜索对象编码/操作人')).toHaveValue('');
      await expect(auditPage.locator('select').nth(1)).toHaveValue('');
    } finally {
      await cleanupAccessControlScenario(scenario);
    }
  });

  test('platform_super_admin 可进入租户并返回平台态 @permission-control-regression', async ({ page }) => {
    const scenario = await seedAccessControlScenario();
    await ensurePlatformSuperAdminAccount();

    try {
      await loginAsPlatformSuperAdmin(page);
      await page.goto(`${APP_BASE_URL}/system/tenants`);

      const content = page.locator('#main-content');
      await expect(content.getByRole('heading', { name: '租户配置' })).toBeVisible();
      await expect(page.getByText('平台态')).toBeVisible();

      const row = content.locator('tbody tr').filter({ hasText: scenario.tenantCode }).first();
      await expect(row).toBeVisible();

      await Promise.all([
        page.waitForResponse((response) => (
          response.url().includes('/api/auth/switch-tenant')
          && response.request().method() === 'POST'
          && response.ok()
        )),
        row.getByRole('button', { name: '进入租户' }).click(),
      ]);

      await page.waitForURL(/\/system\/roles$/);
      await expect(page.getByText(`代管租户 · ${scenario.tenantName}`)).toBeVisible();

      await page.getByRole('button', { name: '用户菜单' }).click();
      await Promise.all([
        page.waitForResponse((response) => (
          response.url().includes('/api/auth/exit-tenant-context')
          && response.request().method() === 'POST'
          && response.ok()
        )),
        page.getByRole('menuitem', { name: /返回平台态/ }).click(),
      ]);

      await page.waitForURL(/\/system\/tenants$/);
      await expect(page.getByText('平台态')).toBeVisible();
      await expect(content.getByRole('heading', { name: '租户配置' })).toBeVisible();
    } finally {
      await cleanupAccessControlScenario(scenario);
    }
  });
});
