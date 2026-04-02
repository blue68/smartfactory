delete (globalThis as any).expect;
import { test, expect, type Page, type Route } from '@playwright/test';

const bossUser = {
  id: 1,
  username: 'boss1',
  realName: '老板A',
  roles: ['boss'],
  tenantId: 1,
  tenantName: '测试工厂',
};

const supervisorUser = {
  id: 2,
  username: 'supervisor1',
  realName: '主管A',
  roles: ['supervisor'],
  tenantId: 1,
  tenantName: '测试工厂',
};

const salesUser = {
  id: 3,
  username: 'sales1',
  realName: '销售A',
  roles: ['sales'],
  tenantId: 1,
  tenantName: '测试工厂',
};

function fulfillJson(route: Route, data: unknown) {
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      code: 0,
      message: 'ok',
      data,
    }),
  });
}

async function mockSettlementApis(page: Page) {
  const settlements = [
    {
      id: 101,
      settlementNo: 'ST-101',
      salesOrderId: 201,
      salesOrderNo: 'SO-201',
      customerId: 11,
      customerName: '华北客户',
      totalAmount: '12800.00',
      paidAmount: '0.00',
      status: 'draft',
      dueDate: '2026-03-10',
      createdAt: '2026-03-24 09:00:00',
      notes: '待确认结算单',
    },
    {
      id: 102,
      settlementNo: 'ST-102',
      salesOrderId: 202,
      salesOrderNo: 'SO-202',
      customerId: 12,
      customerName: '华东客户',
      totalAmount: '5320.00',
      paidAmount: '0.00',
      status: 'confirmed',
      dueDate: '2026-04-12',
      createdAt: '2026-03-24 10:00:00',
      notes: '待付款结算单',
    },
    {
      id: 103,
      settlementNo: 'ST-103',
      salesOrderId: 203,
      salesOrderNo: 'SO-203',
      customerId: 13,
      customerName: '华南客户',
      totalAmount: '8600.00',
      paidAmount: '8600.00',
      status: 'paid',
      dueDate: '2026-04-15',
      createdAt: '2026-03-23 16:00:00',
      notes: '已付款结算单',
    },
  ];

  const state = {
    receivableCalls: [] as string[],
    exportQueries: [] as string[],
  };

  await page.route('**/api/settlements**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const method = route.request().method();

    if (path.endsWith('/export/csv') && method === 'GET') {
      state.exportQueries.push(url.search);
      await route.fulfill({
        status: 200,
        contentType: 'text/csv; charset=utf-8',
        body: '\uFEFF"结算单号","客户名称"\n"ST-101","华北客户"\n',
      });
      return;
    }

    if (path.endsWith('/receivable') && method === 'GET') {
      const groupBy = url.searchParams.get('groupBy');
      state.receivableCalls.push(groupBy ?? 'customer');
      if (groupBy === 'month') {
        await fulfillJson(route, {
          groupBy: 'month',
          data: [
            { month: '2026-03', totalAmount: '273200.00', count: 4 },
            { month: '2026-02', totalAmount: '184600.00', count: 2 },
          ],
        });
        return;
      }

      if (groupBy === 'aging') {
        await fulfillJson(route, {
          groupBy: 'aging',
          overdueAmount: '12800.00',
          overdueCount: 1,
          data: [
            { bucket: 'current', label: '未逾期', totalAmount: '56400.00', count: 1 },
            { bucket: '1_30', label: '逾期 1-30 天', totalAmount: '12800.00', count: 1 },
            { bucket: '31_60', label: '逾期 31-60 天', totalAmount: '0.00', count: 0 },
            { bucket: '61_90', label: '逾期 61-90 天', totalAmount: '0.00', count: 0 },
            { bucket: '90_plus', label: '逾期 90 天以上', totalAmount: '0.00', count: 0 },
          ],
        });
        return;
      }

      await fulfillJson(route, {
        groupBy: 'customer',
        data: [
          { customerId: 11, customerName: '华北客户', totalAmount: '128000.00', pendingCount: 2 },
          { customerId: 12, customerName: '华东客户', totalAmount: '56400.00', pendingCount: 1 },
          { customerId: 13, customerName: '华南客户', totalAmount: '88800.00', pendingCount: 1 },
        ],
      });
      return;
    }

    if (path.endsWith('/confirm') && method === 'PUT') {
      const settlementId = Number(path.split('/').at(-2));
      const settlement = settlements.find((item) => item.id === settlementId);
      if (settlement) settlement.status = 'confirmed';
      await fulfillJson(route, null);
      return;
    }

    if (path.endsWith('/pay') && method === 'PUT') {
      const settlementId = Number(path.split('/').at(-2));
      const settlement = settlements.find((item) => item.id === settlementId);
      if (settlement) settlement.status = 'paid';
      await fulfillJson(route, null);
      return;
    }

    if (path.endsWith('/cancel') && method === 'PUT') {
      const settlementId = Number(path.split('/').at(-2));
      const settlement = settlements.find((item) => item.id === settlementId);
      if (settlement) settlement.status = 'cancelled';
      await fulfillJson(route, null);
      return;
    }

    const status = url.searchParams.get('status');
    const keyword = url.searchParams.get('keyword')?.trim() ?? '';
    const overdueOnly = url.searchParams.get('overdueOnly') === 'true';
    const customerId = url.searchParams.get('customerId');
    const list = settlements.filter((item) => {
      if (status && item.status !== status) return false;
      if (customerId && item.customerId !== Number(customerId)) return false;
      if (keyword) {
        const haystack = [item.settlementNo, item.customerName, item.salesOrderNo].join(' ');
        if (!haystack.includes(keyword)) return false;
      }
      if (overdueOnly && !['draft', 'confirmed'].includes(item.status)) return false;
      if (overdueOnly && !(item.dueDate && new Date(item.dueDate).getTime() < Date.now())) return false;
      return true;
    });
    await fulfillJson(route, {
      list,
      total: list.length,
      page: Number(url.searchParams.get('page') ?? '1'),
      pageSize: Number(url.searchParams.get('pageSize') ?? '20'),
    });
  });

  return state;
}

async function seedAuth(page: Page, user: typeof bossUser) {
  await page.addInitScript((seedUser) => {
    window.sessionStorage.setItem('__sf_at', 'playwright-token');
    window.localStorage.setItem('sf_user', JSON.stringify(seedUser));
  }, user);
}

test.describe('销售结算页冒烟', () => {
  test('boss 可确认草稿并标记已付', async ({ page }) => {
    await seedAuth(page, bossUser);
    await mockSettlementApis(page);

    await page.goto('/settlement');

    await expect(page.locator('#main-content').getByRole('heading', { name: '销售结算' })).toBeVisible();
    await expect(page.getByRole('button', { name: '+ 新建结算' })).toBeVisible();
    await expect(page.getByText('按客户汇总')).toBeVisible();
    await expect(page.getByText('应收合计')).toBeVisible();
    await expect(page.getByText('¥273,200.00').first()).toBeVisible();

    const draftRow = page.locator('tbody tr').filter({ hasText: 'ST-101' }).first();
    await draftRow.getByRole('button', { name: '确认' }).click();
    await expect(draftRow.getByText('已确认')).toBeVisible();

    const confirmedRow = page.locator('tbody tr').filter({ hasText: 'ST-102' }).first();
    await confirmedRow.getByRole('button', { name: '标记已付' }).click();
    await expect(confirmedRow.getByText('已付款')).toBeVisible();
  });

  test('supervisor 只可取消，不可确认或付款', async ({ page }) => {
    await seedAuth(page, supervisorUser);
    await mockSettlementApis(page);

    await page.goto('/settlement');

    await expect(page.getByRole('button', { name: '+ 新建结算' })).toBeVisible();
    await expect(page.getByText('按客户汇总')).toBeVisible();

    const draftRow = page.locator('tbody tr').filter({ hasText: 'ST-101' }).first();
    await expect(draftRow.getByRole('button', { name: '确认' })).toHaveCount(0);
    await expect(draftRow.getByRole('button', { name: '标记已付' })).toHaveCount(0);
    await draftRow.getByRole('button', { name: '取消' }).click();
    await expect(draftRow.getByText('已取消')).toBeVisible();
  });

  test('sales 仅可查看，无创建和操作按钮', async ({ page }) => {
    await seedAuth(page, salesUser);
    await mockSettlementApis(page);

    await page.goto('/settlement');

    await expect(page.locator('#main-content').getByRole('heading', { name: '销售结算' })).toBeVisible();
    await expect(page.getByRole('button', { name: '+ 新建结算' })).toHaveCount(0);
    await expect(page.getByText('按客户汇总')).toHaveCount(0);
    await expect(page.getByText('应收合计')).toHaveCount(0);

    const draftRow = page.locator('tbody tr').filter({ hasText: 'ST-101' }).first();
    await expect(draftRow.getByRole('button', { name: '确认' })).toHaveCount(0);
    await expect(draftRow.getByRole('button', { name: '标记已付' })).toHaveCount(0);
    await expect(draftRow.getByRole('button', { name: '取消' })).toHaveCount(0);
  });

  test('boss 可切换应收汇总维度并刷新数据', async ({ page }) => {
    await seedAuth(page, bossUser);
    const state = await mockSettlementApis(page);

    await page.goto('/settlement');
    const summarySection = page.getByRole('region', { name: '应收账款汇总' });

    await expect(page.getByRole('tab', { name: '按客户' })).toHaveAttribute('aria-selected', 'true');
    await expect(summarySection.getByText('华北客户')).toBeVisible();

    await page.getByRole('tab', { name: '按月份' }).click();

    await expect(page.getByRole('tab', { name: '按月份' })).toHaveAttribute('aria-selected', 'true');
    await expect(summarySection.getByText('2026-03')).toBeVisible();
    await expect(summarySection.getByText('华北客户')).toHaveCount(0);
    await expect.poll(() => state.receivableCalls).toEqual(['customer', 'month']);
  });

  test('boss 可按关键字筛选逾期结算并导出 CSV', async ({ page }) => {
    await seedAuth(page, bossUser);
    const state = await mockSettlementApis(page);

    await page.goto('/settlement');

    await page.getByLabel('筛选结算单').fill('华北客户');
    await page.getByRole('button', { name: '查询' }).click();
    await expect(page.locator('tbody tr').filter({ hasText: 'ST-101' })).toHaveCount(1);
    await expect(page.locator('tbody tr').filter({ hasText: 'ST-102' })).toHaveCount(0);

    await page.getByLabel('仅看逾期').check();
    await expect(page.getByText('已逾期')).toBeVisible();

    await page.getByRole('button', { name: '导出 CSV' }).click();
    await expect.poll(() => state.exportQueries.length).toBe(1);
    await expect(state.exportQueries[0]).toContain('keyword=%E5%8D%8E%E5%8C%97%E5%AE%A2%E6%88%B7');
    await expect(state.exportQueries[0]).toContain('overdueOnly=true');
  });

  test('boss 可从客户汇总反向过滤结算单列表', async ({ page }) => {
    await seedAuth(page, bossUser);
    await mockSettlementApis(page);

    await page.goto('/settlement');

    const summarySection = page.getByRole('region', { name: '应收账款汇总' });
    await summarySection.getByRole('button', { name: /华北客户/ }).click();

    await expect(page.getByText('客户：华北客户')).toBeVisible();
    await expect(page.locator('tbody tr').filter({ hasText: 'ST-101' })).toHaveCount(1);
    await expect(page.locator('tbody tr').filter({ hasText: 'ST-102' })).toHaveCount(0);
    await expect(page.locator('tbody tr').filter({ hasText: 'ST-103' })).toHaveCount(0);

    await page.getByRole('button', { name: '清除客户过滤' }).click();
    await expect(page.getByText('客户：华北客户')).toHaveCount(0);
    await expect(page.locator('tbody tr').filter({ hasText: 'ST-102' })).toHaveCount(1);
  });

  test('boss 可查看应收账龄和逾期金额汇总', async ({ page }) => {
    await seedAuth(page, bossUser);
    const state = await mockSettlementApis(page);

    await page.goto('/settlement');

    await page.getByRole('tab', { name: '账龄' }).click();

    await expect(page.getByRole('tab', { name: '账龄' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText('逾期金额')).toBeVisible();
    await expect(page.locator('strong').filter({ hasText: '¥12,800.00' })).toBeVisible();
    await expect(page.getByText('逾期 1-30 天')).toBeVisible();
    await expect.poll(() => state.receivableCalls).toEqual(['customer', 'aging']);
  });
});
