delete (globalThis as any).expect;
import { test, expect, type Page, type Route } from '@playwright/test';

const PAGE_PATH = '/master-data/process-config';

const mockUser = {
  id: 5,
  username: 'boss',
  realName: '老板A',
  roles: ['boss'],
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

async function seedAuth(page: Page) {
  await page.addInitScript((user) => {
    window.sessionStorage.setItem('__sf_at', 'playwright-token');
    window.localStorage.setItem('sf_user', JSON.stringify(user));
  }, mockUser);
}

async function mockProcessConfigApis(page: Page) {
  const skuList = [
    { id: 2001, skuId: 2001, skuCode: 'FG-2001', name: '功能沙发A', category1Name: '成品' },
    { id: 2002, skuId: 2002, skuCode: 'FG-2002', name: '实木餐椅B', category1Name: '成品' },
    { id: 2003, skuId: 2003, skuCode: 'FG-2003', name: '茶几C', category1Name: '成品' },
    { id: 3101, skuId: 3101, skuCode: 'SF-3101', name: '左护翼半成品', category1Name: '半成品' },
    { id: 3102, skuId: 3102, skuCode: 'SF-3102', name: '右护翼半成品', category1Name: '半成品' },
    { id: 3103, skuId: 3103, skuCode: 'SF-3103', name: '加宽护翼半成品', category1Name: '半成品' },
  ];

  const templates = [
    {
      id: 1,
      name: '实木椅标准模板',
      skuId: 2002,
      skuName: '实木餐椅B',
      skuCode: 'FG-2002',
      status: 'active',
      isDefault: true,
      createdAt: '2026-03-20 09:00:00',
      updatedAt: '2026-03-24 10:00:00',
    },
    {
      id: 2,
      name: '沙发装配模板',
      skuId: 2001,
      skuName: '功能沙发A',
      skuCode: 'FG-2001',
      status: 'active',
      isDefault: false,
      createdAt: '2026-03-21 09:00:00',
      updatedAt: '2026-03-24 11:00:00',
    },
  ];

  const templateDetails = new Map<number, {
    template: {
      id: number;
      tenantId: number;
      skuId: number;
      name: string;
      status: 'active' | 'inactive';
      createdAt: string;
      updatedAt: string;
      createdBy: number;
      updatedBy: number;
    };
    steps: Array<{
      id: number;
      tenantId: number;
      templateId: number;
      stepNo: number;
      stepName: string;
      standardHours: string | null;
      maxHours: string | null;
      workstationType: string | null;
      outputType?: 'semi_finished' | 'final_product' | 'none';
      outputSkuId?: number | null;
      createdAt: string;
    }>;
  }>([
    [1, {
      template: {
        id: 1,
        tenantId: 1,
        skuId: 2002,
        name: '实木椅标准模板',
        status: 'active',
        createdAt: '2026-03-20 09:00:00',
        updatedAt: '2026-03-24 10:00:00',
        createdBy: 1,
        updatedBy: 1,
      },
      steps: [
        {
          id: 101,
          tenantId: 1,
          templateId: 1,
          stepNo: 1,
          stepName: '开料',
          standardHours: '1.50',
          maxHours: '2.00',
          workstationType: '开料区',
          outputType: 'semi_finished',
          outputSkuId: 3101,
          createdAt: '2026-03-20 09:10:00',
        },
        {
          id: 102,
          tenantId: 1,
          templateId: 1,
          stepNo: 2,
          stepName: '打磨',
          standardHours: '1.00',
          maxHours: '1.50',
          workstationType: '砂光区',
          createdAt: '2026-03-20 09:20:00',
        },
      ],
    }],
    [2, {
      template: {
        id: 2,
        tenantId: 1,
        skuId: 2001,
        name: '沙发装配模板',
        status: 'active',
        createdAt: '2026-03-21 09:00:00',
        updatedAt: '2026-03-24 11:00:00',
        createdBy: 1,
        updatedBy: 1,
      },
      steps: [
        {
          id: 201,
          tenantId: 1,
          templateId: 2,
          stepNo: 1,
          stepName: '裁剪',
          standardHours: '1.25',
          maxHours: '1.50',
          workstationType: '开料区',
          createdAt: '2026-03-21 09:10:00',
        },
      ],
    }],
  ]);

  const workstationTypes = [
    { id: 1, name: '开料区', sortOrder: 10, createdAt: '2026-03-20 08:00:00' },
    { id: 2, name: '砂光区', sortOrder: 20, createdAt: '2026-03-20 08:05:00' },
    { id: 3, name: '装配区', sortOrder: 30, createdAt: '2026-03-20 08:10:00' },
  ];
  const workstations = [
    { id: 11, name: '开料站-A', type: '开料区', capacity: 120, status: 'active', createdAt: '2026-03-20 08:20:00' },
    { id: 12, name: '砂光站-A', type: '砂光区', capacity: 80, status: 'active', createdAt: '2026-03-20 08:25:00' },
    { id: 13, name: '装配站-A', type: '装配区', capacity: 60, status: 'active', createdAt: '2026-03-20 08:30:00' },
  ];
  const wagesByStepId = new Map<number, Array<{
    id: number;
    stepId: number;
    workerGrade: string;
    unitPrice: string;
    updatedAt: string;
  }>>([
    [101, [{
      id: 1010,
      stepId: 101,
      workerGrade: 'skilled',
      unitPrice: '12.5',
      updatedAt: '2026-03-25 10:05:00',
    }]],
  ]);

  let nextTemplateId = 3;
  let nextStepId = 300;
  let nextWorkstationId = 10;

  await page.route('**/api/auth/refresh', async (route) => {
    await fulfillJson(route, { accessToken: 'playwright-token' });
  });

  await page.route(/\/api\/bom(?:\?.*)?$/, async (route) => {
    await fulfillJson(route, []);
  });

  await page.route('**/api/bom/*/expand', async (route) => {
    await fulfillJson(route, { items: [] });
  });

  await page.route('**/api/bom/*/material-requirements**', async (route) => {
    await fulfillJson(route, []);
  });

  await page.route('**/api/process-configs/templates/*/step-materials', async (route) => {
    if (route.request().method() === 'GET') {
      await fulfillJson(route, []);
      return;
    }

    const payload = route.request().postDataJSON() as { items?: unknown[] };
    await fulfillJson(route, payload.items ?? []);
  });

  await page.route('**/api/process-configs/workstation-types**', async (route) => {
    const method = route.request().method();

    if (method === 'GET') {
      await fulfillJson(route, workstationTypes);
      return;
    }

    if (method === 'POST') {
      const payload = route.request().postDataJSON() as { name: string; sortOrder?: number };
      const created = {
        id: nextWorkstationId,
        name: payload.name,
        sortOrder: payload.sortOrder ?? workstationTypes.length * 10 + 10,
        createdAt: '2026-03-25 10:00:00',
      };
      nextWorkstationId += 1;
      workstationTypes.push(created);
      await fulfillJson(route, created);
    }
  });

  await page.route('**/api/production/workstations**', async (route) => {
    const method = route.request().method();

    if (method === 'GET') {
      await fulfillJson(route, workstations);
      return;
    }

    if (method === 'POST') {
      const payload = route.request().postDataJSON() as { name: string; type: string; capacity: number; status?: 'active' | 'inactive' };
      const created = {
        id: nextWorkstationId,
        name: payload.name,
        type: payload.type,
        capacity: payload.capacity,
        status: payload.status ?? 'active',
        createdAt: '2026-03-25 10:10:00',
      };
      nextWorkstationId += 1;
      workstations.push(created);
      await fulfillJson(route, created);
      return;
    }
  });

  await page.route('**/api/process-configs/steps/*/max-hours', async (route) => {
    const stepId = Number(route.request().url().split('/').at(-2));
    const payload = route.request().postDataJSON() as { maxHours: number };
    await fulfillJson(route, { stepId, maxHours: payload.maxHours });
  });

  await page.route('**/api/process-configs/steps/*/wages', async (route) => {
    const stepId = Number(route.request().url().split('/').at(-2));

    if (route.request().method() === 'GET') {
      await fulfillJson(route, wagesByStepId.get(stepId) ?? []);
      return;
    }

    const payload = route.request().postDataJSON() as { workerGrade: string; unitPrice: number };
    const nextRow = {
      id: stepId * 10,
      stepId,
      workerGrade: payload.workerGrade,
      unitPrice: String(payload.unitPrice),
      updatedAt: '2026-03-25 10:05:00',
    };
    wagesByStepId.set(stepId, [nextRow]);
    await fulfillJson(route, nextRow);
  });

  await page.route('**/api/skus**', async (route) => {
    const url = new URL(route.request().url());
    const keyword = url.searchParams.get('keyword')?.trim() ?? '';
    const pageNo = Number(url.searchParams.get('page') ?? '1') || 1;
    const requestedPageSize = Number(url.searchParams.get('pageSize') ?? '30') || 30;
    const skuTypes = (url.searchParams.get('skuTypes') ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);

    let list = keyword
      ? skuList.filter((sku) => `${sku.skuCode} ${sku.name}`.includes(keyword))
      : skuList;

    if (skuTypes.length > 0) {
      list = list.filter((sku) => {
        if (sku.category1Name === '成品') return skuTypes.includes('finished');
        if (sku.category1Name === '半成品') return skuTypes.includes('semi_finished');
        return true;
      });
    }

    const effectivePageSize = keyword === '护翼' && skuTypes.includes('semi_finished') ? 2 : requestedPageSize;
    const pagedList = list.slice((pageNo - 1) * effectivePageSize, pageNo * effectivePageSize);

    await fulfillJson(route, {
      list: pagedList,
      total: list.length,
      page: pageNo,
      pageSize: effectivePageSize,
      totalPages: Math.max(Math.ceil(list.length / effectivePageSize), 1),
    });
  });

  await page.route(/\/api\/process-configs(?:\?.*)?$/, async (route) => {
    const method = route.request().method();

    if (method === 'GET') {
      await fulfillJson(route, {
        list: templates,
        total: templates.length,
        page: 1,
        pageSize: 100,
      });
      return;
    }

    if (method === 'POST') {
      const payload = route.request().postDataJSON() as {
        name: string;
        skuId: number;
        steps?: Array<{
          stepNo: number;
          stepName: string;
          standardHours?: number;
          workstationType?: string;
        }>;
      };
      const sku = skuList.find((item) => item.id === payload.skuId);
      const created = {
        id: nextTemplateId,
        name: payload.name,
        skuId: payload.skuId,
        skuName: sku?.name ?? null,
        skuCode: sku?.skuCode ?? null,
        status: 'active',
        isDefault: false,
        createdAt: '2026-03-25 09:30:00',
        updatedAt: '2026-03-25 09:30:00',
      };
      templates.unshift(created);
      templateDetails.set(created.id, {
        template: {
          id: created.id,
          tenantId: 1,
          skuId: payload.skuId,
          name: created.name,
          status: 'active',
          createdAt: created.createdAt,
          updatedAt: created.updatedAt,
          createdBy: 1,
          updatedBy: 1,
        },
        steps: (payload.steps ?? []).map((step) => {
          nextStepId += 1;
          return {
            id: nextStepId,
            tenantId: 1,
            templateId: created.id,
            stepNo: step.stepNo,
            stepName: step.stepName,
            standardHours: step.standardHours ? step.standardHours.toFixed(2) : null,
            maxHours: null,
            workstationType: step.workstationType ?? null,
            createdAt: '2026-03-25 09:30:00',
          };
        }),
      });
      nextTemplateId += 1;
      await fulfillJson(route, created);
    }
  });

  await page.route(/\/api\/process-configs\/\d+(?:\?.*)?$/, async (route) => {
    const url = new URL(route.request().url());
    const templateId = Number(url.pathname.split('/').at(-1));
    const method = route.request().method();

    if (!Number.isFinite(templateId) || templateId <= 0) return;

    if (method === 'GET') {
      await fulfillJson(route, templateDetails.get(templateId));
      return;
    }

    if (method === 'PUT') {
      const payload = route.request().postDataJSON() as {
        name?: string;
        skuId?: number;
        steps?: Array<{
          stepNo: number;
          stepName: string;
          standardHours?: number;
          workstationType?: string;
        }>;
      };
      const detail = templateDetails.get(templateId);
      if (!detail) return;

      detail.template = {
        ...detail.template,
        name: payload.name ?? detail.template.name,
        skuId: payload.skuId ?? detail.template.skuId,
        updatedAt: '2026-03-25 10:20:00',
      };
      detail.steps = (payload.steps ?? []).map((step) => {
        const existing = detail.steps.find((item) => Number(item.stepNo) === Number(step.stepNo));
        if (existing) {
          return {
            ...existing,
            stepName: step.stepName,
            standardHours: step.standardHours ? step.standardHours.toFixed(2) : null,
            workstationType: step.workstationType ?? null,
          };
        }

        nextStepId += 1;
        return {
          id: nextStepId,
          tenantId: 1,
          templateId,
          stepNo: step.stepNo,
          stepName: step.stepName,
          standardHours: step.standardHours ? step.standardHours.toFixed(2) : null,
          maxHours: null,
          workstationType: step.workstationType ?? null,
          createdAt: '2026-03-25 10:20:00',
        };
      });

      const listItem = templates.find((item) => item.id === templateId);
      if (listItem) {
        const sku = skuList.find((item) => item.id === detail.template.skuId);
        listItem.name = detail.template.name;
        listItem.skuId = detail.template.skuId;
        listItem.skuName = sku?.name ?? null;
        listItem.skuCode = sku?.skuCode ?? null;
        listItem.updatedAt = detail.template.updatedAt;
      }

      await fulfillJson(route, listItem ?? detail.template);
      return;
    }

    if (method === 'DELETE') {
      const idx = templates.findIndex((item) => item.id === templateId);
      if (idx >= 0) templates.splice(idx, 1);
      templateDetails.delete(templateId);
      await fulfillJson(route, { id: templateId });
    }
  });
}

test.describe('工序配置页面功能测试', () => {
  test.beforeEach(async ({ page }) => {
    await seedAuth(page);
    await mockProcessConfigApis(page);
    await page.goto(PAGE_PATH);
    await expect(page.getByRole('heading', { name: '工序配置' })).toBeVisible();
  });

  test('新建模板后进入编辑态', async ({ page }) => {
    await page.getByRole('button', { name: '新建工序模板' }).first().click();

    const modal = page.getByRole('dialog', { name: '新建工序模板' });
    await expect(modal).toBeVisible();

    await modal.locator('input[type="text"]').fill('茶几包装模板');
    await modal.locator('input[type="search"]').fill('茶几');
    await modal.getByText('FG-2003').click();

    const [response] = await Promise.all([
      page.waitForResponse((resp) =>
        resp.url().includes('/api/process-configs') && resp.request().method() === 'POST'),
      modal.getByRole('button', { name: '创建' }).click(),
    ]);

    expect(response.ok()).toBeTruthy();
    await page.getByLabel('工序模板列表').getByText('茶几包装模板').click();
    await expect(page.getByLabel('模板名称')).toHaveValue('茶几包装模板');
    await expect(page.getByRole('button', { name: '添加工序' }).first()).toBeVisible();
  });

  test('可打开工种管理并新增工种', async ({ page }) => {
    await page.getByLabel('工序模板列表').getByText('实木椅标准模板').click();
    await expect(page.getByLabel('模板名称')).toHaveValue('实木椅标准模板');

    await page.getByRole('button', { name: '完整编辑' }).click();
    const drawer = page.getByRole('dialog', { name: '编辑工序节点' });
    await expect(drawer).toBeVisible();

    await drawer.getByRole('button', { name: '管理工作站' }).click();

    const modal = page.getByRole('dialog', { name: '管理工作站' });
    await expect(modal).toBeVisible();
    await modal.getByPlaceholder('输入新工作站类型').fill('包装区');
    await modal.getByRole('button', { name: '添加类型' }).click();
    await expect(modal.locator('li').filter({ hasText: '包装区' })).toBeVisible();

    await modal.getByRole('button', { name: '关闭' }).click();
    await expect(page.getByRole('dialog', { name: '管理工作站' })).toHaveCount(0);
  });

  test('可新增工序并进入编辑态', async ({ page }) => {
    await page.getByLabel('工序模板列表').getByText('实木椅标准模板').click();
    await expect(page.getByLabel('模板名称')).toHaveValue('实木椅标准模板');

    await page.getByRole('button', { name: '添加工序' }).first().click();
    const modal = page.getByRole('dialog', { name: '新增工序' });
    await expect(modal).toBeVisible();

    await modal.getByPlaceholder('请输入工序名称').fill('包装');
    await modal.getByRole('combobox').first().selectOption('internal');
    await modal.getByRole('button', { name: '创建工序' }).click();
    await expect(page.getByRole('dialog', { name: '新增工序' })).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: '编辑工序节点' })).toBeVisible();
  });

  test('输出对象搜索会继续拉取后端后续分页的半成品 SKU', async ({ page }) => {
    await page.getByLabel('工序模板列表').getByText('实木椅标准模板').click();
    await expect(page.getByLabel('模板名称')).toHaveValue('实木椅标准模板');

    const outputSearch = page.getByPlaceholder('搜索输出对象');
    await outputSearch.fill('护翼');

    await expect(page.getByRole('button', { name: /SF-3103 · 加宽护翼半成品/ })).toBeVisible();
  });

  test('工时配置支持录入小数中间态并在失焦后转成数值', async ({ page }) => {
    await page.getByLabel('工序模板列表').getByText('实木椅标准模板').click();
    await expect(page.getByLabel('模板名称')).toHaveValue('实木椅标准模板');

    const standardHoursInput = page.getByText('标准工时 (h)').first().locator('xpath=following::input[1]');
    const maxHoursInput = page.getByText('极限工时 (h)').first().locator('xpath=following::input[1]');

    await standardHoursInput.fill('.23');
    await expect(standardHoursInput).toHaveValue('.23');
    await standardHoursInput.blur();
    await expect(standardHoursInput).toHaveValue('0.23');

    await maxHoursInput.fill('0.');
    await expect(maxHoursInput).toHaveValue('0.');
    await maxHoursInput.blur();
    await expect(maxHoursInput).toHaveValue('0');
  });

  test('计件单价支持录入小数中间态并在失焦后转成数值', async ({ page }) => {
    await page.getByLabel('工序模板列表').getByText('实木椅标准模板').click();
    await expect(page.getByLabel('模板名称')).toHaveValue('实木椅标准模板');

    const unitPriceInput = page.getByText('标准工价(元)').first().locator('xpath=following::input[1]');
    await unitPriceInput.fill('.8');
    await expect(unitPriceInput).toHaveValue('.8');
    await unitPriceInput.blur();
    await expect(unitPriceInput).toHaveValue('0.8');
  });

  test('标准工价保存后重新进入模板仍会从工价接口回填', async ({ page }) => {
    await page.getByLabel('工序模板列表').getByText('实木椅标准模板').click();
    await expect(page.getByLabel('模板名称')).toHaveValue('实木椅标准模板');

    const unitPriceInput = page.getByText('标准工价(元)').first().locator('xpath=following::input[1]');
    await expect(unitPriceInput).toHaveValue('12.5');

    await unitPriceInput.fill('3.6');
    await unitPriceInput.blur();
    await expect(unitPriceInput).toHaveValue('3.6');

    await Promise.all([
      page.waitForResponse((resp) =>
        resp.url().includes('/api/process-configs/steps/101/wages') && resp.request().method() === 'PATCH'),
      page.getByRole('button', { name: '保存模板' }).click(),
    ]);

    await page.getByLabel('工序模板列表').getByText('沙发装配模板').click();
    await page.getByLabel('工序模板列表').getByText('实木椅标准模板').click();

    await expect(page.getByText('标准工价(元)').first().locator('xpath=following::input[1]')).toHaveValue('3.6');
  });
});
