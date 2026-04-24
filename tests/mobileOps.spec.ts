delete (globalThis as any).expect;
import { test, expect, devices, type Page, type Route } from '@playwright/test';
import path from 'node:path';

const iphone13 = devices['iPhone 13'];

test.use({
  viewport: iphone13.viewport,
  userAgent: iphone13.userAgent,
  deviceScaleFactor: iphone13.deviceScaleFactor,
  isMobile: iphone13.isMobile,
  hasTouch: iphone13.hasTouch,
});

const mockUser = {
  id: 18,
  username: 'mobile.ops',
  realName: '移动端联测账号',
  roles: ['worker', 'warehouse', 'qc'],
  tenantId: 1,
  tenantName: '蓝蛋家具厂',
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

async function mockMobileOpsApis(page: Page) {
  const state = {
    startCalls: 0,
    issuePayload: null as Record<string, unknown> | null,
    completePayload: null as Record<string, unknown> | null,
    exceptionPayload: null as Record<string, unknown> | null,
    inboundPayload: null as Record<string, unknown> | null,
    stocktakingSavePayload: null as unknown,
    stocktakingSubmitCalls: 0,
    inspectionSavePayload: null as Record<string, unknown> | null,
    inspectionSubmitPayload: null as Record<string, unknown> | null,
    uploadCalls: 0,
  };

  const workerTask = {
    id: 501,
    taskNo: 'TASK-501',
    taskDate: '2026-04-24',
    status: 'pending',
    plannedQty: 48,
    completedQty: 12,
    orderNo: 'MO-501',
    processName: '电子锯开料',
    workstationName: '开料站-A',
    workerId: 18,
    workerName: '移动端联测账号',
    productName: 'F01 面板',
    outputSkuName: 'F01 面板',
    processGuideText: '按电子锯工艺卡检查尺寸与纹路方向，确认余料回收后再提交报工。',
    actualHours: 2,
    scrapQty: 0,
    inputMaterials: [
      {
        skuId: 901,
        skuCode: 'RM-901',
        skuName: '棉布面料',
        requiredQty: '60',
        issuedQty: '20',
        qtyAvailable: '500',
        unit: '米',
        warehouseId: 1,
        locationId: 101,
      },
    ],
    exceptions: [
      {
        id: 1,
        type: '设备故障',
        description: '历史异常已解除，供详情页展示时间线。',
        createdAt: '2026-04-24 08:30:00',
      },
    ],
  };

  const completedTask = {
    ...workerTask,
    id: 502,
    taskNo: 'TASK-502',
    status: 'completed',
    plannedQty: 36,
    completedQty: 36,
    orderNo: 'MO-502',
    processName: '封边',
    workstationName: '封边站-B',
    processGuideText: '已完成任务，回看封边工艺说明和质检注意事项。',
    exceptions: [],
  };

  const foreignTask = {
    ...workerTask,
    id: 503,
    taskNo: 'TASK-503',
    status: 'in_progress',
    orderNo: 'MO-503',
    processName: '排钻',
    workstationName: '排钻站-C',
    workerId: 99,
    workerName: '李工',
    processGuideText: '该任务由李工负责，其他工人只能查看详情，不能代报工。',
    exceptions: [],
  };

  const taskMap = new Map([
    [501, workerTask],
    [502, completedTask],
    [503, foreignTask],
  ]);

  const stocktakingTask = {
    id: 61,
    taskNo: 'PD-061',
    scope: 'all',
    status: 'in_progress',
    totalItems: 1,
    diffItems: 0,
    createdAt: '2026-04-24 08:00:00',
  };

  const stocktakingDetail = {
    task: stocktakingTask,
    items: [
      {
        id: 611,
        taskId: 61,
        skuId: 901,
        skuCode: 'RM-901',
        skuName: '棉布面料',
        stockUnit: '米',
        systemQty: '100',
        actualQty: '100',
        diffQty: '0',
      },
    ],
  };

  const inspectionDetail = {
    id: 71,
    inspectionNo: 'IQC-071',
    poId: 9001,
    deliveryNoteId: 3001,
    inspectorId: 18,
    inspectionDate: '2026-04-24',
    status: 'draft',
    overallResult: 'pass',
    receiptTriggered: false,
    returnTriggered: false,
    notes: '',
    completedAt: null,
    poNo: 'PO-071',
    supplierName: '晨辉纺织',
    items: [
      {
        id: 711,
        inspectionId: 71,
        skuId: 901,
        poItemId: 801,
        qtyDelivered: '100',
        qtySampled: '10',
        qtyPassed: '10',
        qtyFailed: '0',
        result: 'pass',
        disposition: 'accept',
        notes: '',
        skuCode: 'RM-901',
        skuName: '棉布面料',
      },
    ],
  };

  await page.route('**/api/auth/refresh', async (route) => {
    await fulfillJson(route, { accessToken: 'playwright-token' });
  });

  await page.route('**/api/production/tasks**', async (route) => {
    const url = new URL(route.request().url());
    const pathname = url.pathname;
    const method = route.request().method();

    if (method === 'GET' && pathname === '/api/production/tasks') {
      await fulfillJson(route, {
        list: [workerTask, completedTask, foreignTask],
        total: 3,
        page: 1,
        pageSize: 20,
      });
      return;
    }

    const detailMatch = pathname.match(/^\/api\/production\/tasks\/(\d+)$/);
    if (method === 'GET' && detailMatch) {
      const taskId = Number(detailMatch[1]);
      await fulfillJson(route, taskMap.get(taskId) ?? null);
      return;
    }

    if (method === 'POST' && pathname === '/api/production/tasks/501/start') {
      state.startCalls += 1;
      workerTask.status = 'in_progress';
      await fulfillJson(route, { id: 501, status: 'in_progress' });
      return;
    }

    if (method === 'POST' && pathname === '/api/production/tasks/501/issue-materials') {
      state.issuePayload = route.request().postDataJSON() as Record<string, unknown>;
      await fulfillJson(route, { success: true });
      return;
    }

    if (method === 'POST' && pathname === '/api/production/tasks/501/complete-v2') {
      state.completePayload = route.request().postDataJSON() as Record<string, unknown>;
      await fulfillJson(route, { success: true });
      return;
    }

    if (method === 'POST' && pathname === '/api/production/tasks/501/exception') {
      state.exceptionPayload = route.request().postDataJSON() as Record<string, unknown>;
      await fulfillJson(route, { success: true });
      return;
    }

    await route.fallback();
  });

  await page.route('**/api/inventory/warehouses**', async (route) => {
    await fulfillJson(route, [
      { id: 1, code: 'WH-RAW', name: '原料仓' },
      { id: 2, code: 'WH-QC', name: '质检待处理仓' },
    ]);
  });

  await page.route('**/api/inventory/locations**', async (route) => {
    const url = new URL(route.request().url());
    const warehouseId = url.searchParams.get('warehouseId');
    const allLocations = [
      { id: 101, warehouseId: 1, code: 'A-01', name: '面料区 A-01' },
      { id: 201, warehouseId: 2, code: 'IQC-01', name: '质检暂存区' },
    ];
    await fulfillJson(
      route,
      warehouseId ? allLocations.filter((item) => String(item.warehouseId) === warehouseId) : allLocations,
    );
  });

  await page.route('**/api/skus**', async (route) => {
    await fulfillJson(route, {
      list: [
        {
          id: 901,
          skuCode: 'RM-901',
          name: '棉布面料',
          stockUnit: '米',
          purchaseUnit: '米',
        },
        {
          id: 902,
          skuCode: 'RM-902',
          name: '高弹海绵',
          stockUnit: '张',
          purchaseUnit: '张',
        },
      ],
      total: 2,
      page: 1,
      pageSize: 20,
    });
  });

  await page.route('**/api/inventory/inbound', async (route) => {
    state.inboundPayload = route.request().postDataJSON() as Record<string, unknown>;
    await fulfillJson(route, {
      transactionNo: 'IN-20260424-001',
      newQtyOnHand: '118.5',
    });
  });

  await page.route('**/api/purchase/delivery-notes**', async (route) => {
    await fulfillJson(route, {
      list: [
        {
          id: 3001,
          deliveryNo: 'DN-3001',
          status: 'pending',
          supplierName: '晨辉纺织',
          deliveryDate: '2026-04-24T08:00:00.000Z',
        },
      ],
      total: 1,
      page: 1,
      pageSize: 6,
    });
  });

  await page.route('**/api/purchase/receipts**', async (route) => {
    await fulfillJson(route, {
      list: [
        {
          id: 4001,
          receiptNo: 'GR-4001',
        },
      ],
      total: 1,
      page: 1,
      pageSize: 6,
    });
  });

  await page.route('**/api/stocktaking**', async (route) => {
    const url = new URL(route.request().url());
    const pathname = url.pathname;
    const method = route.request().method();

    if (method === 'GET' && pathname === '/api/stocktaking') {
      await fulfillJson(route, {
        list: [stocktakingTask],
        total: 1,
        page: 1,
        pageSize: 10,
      });
      return;
    }

    if (method === 'GET' && pathname === '/api/stocktaking/61') {
      await fulfillJson(route, stocktakingDetail);
      return;
    }

    if (method === 'PUT' && pathname === '/api/stocktaking/61/items') {
      state.stocktakingSavePayload = route.request().postDataJSON();
      await fulfillJson(route, { updatedCount: 1 });
      return;
    }

    if (method === 'POST' && pathname === '/api/stocktaking/61/submit') {
      state.stocktakingSubmitCalls += 1;
      await fulfillJson(route, { submittedAt: '2026-04-24 10:00:00' });
      return;
    }

    await route.fallback();
  });

  await page.route('**/api/incoming-inspections**', async (route) => {
    const url = new URL(route.request().url());
    const pathname = url.pathname;
    const method = route.request().method();

    if (method === 'GET' && pathname === '/api/incoming-inspections') {
      await fulfillJson(route, {
        list: [
          {
            id: 71,
            inspectionNo: 'IQC-071',
            poNo: 'PO-071',
            supplierName: '晨辉纺织',
            status: 'draft',
            overallResult: 'pass',
          },
        ],
        total: 1,
        page: 1,
        pageSize: 12,
      });
      return;
    }

    if (method === 'GET' && pathname === '/api/incoming-inspections/71') {
      await fulfillJson(route, inspectionDetail);
      return;
    }

    if (method === 'PUT' && pathname === '/api/incoming-inspections/71/items') {
      state.inspectionSavePayload = route.request().postDataJSON() as Record<string, unknown>;
      await fulfillJson(route, null);
      return;
    }

    if (method === 'POST' && pathname === '/api/incoming-inspections/71/submit') {
      state.inspectionSubmitPayload = route.request().postDataJSON() as Record<string, unknown>;
      await fulfillJson(route, null);
      return;
    }

    await route.fallback();
  });

  await page.route('**/api/upload', async (route) => {
    state.uploadCalls += 1;
    await fulfillJson(route, {
      id: 9900 + state.uploadCalls,
      url: `/api/upload/files/${9900 + state.uploadCalls}/content`,
      originalName: `evidence-${state.uploadCalls}.png`,
      size: 1024,
      path: `/uploads/evidence-${state.uploadCalls}.png`,
      storageDriver: 'local',
    });
  });

  return state;
}

test('mobile h5 worker flow shows Chinese statuses, separate detail page and scan entry', async ({ page }) => {
  await seedAuth(page);
  const mockState = await mockMobileOpsApis(page);

  await page.goto('/m');

  await expect(page.getByText('现场移动工作台')).toBeVisible();
  await expect(page.getByTestId('mobile-worker-task-count')).toContainText('3 项');
  await expect(page.getByTestId('mobile-task-status-501')).toContainText('待开始');
  await expect(page.getByTestId('mobile-task-status-502')).toContainText('已完成');
  await expect(page.getByTestId('mobile-task-status-503')).toContainText('进行中');
  await expect(page.getByTestId('mobile-start-task')).toHaveCount(0);

  const viewportFit = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(viewportFit.scrollWidth).toBeLessThanOrEqual(viewportFit.innerWidth + 2);

  await page.getByTestId('mobile-task-card-501').click();
  await expect(page).toHaveURL(/\/m\/tasks\/501$/);
  await expect(page.getByText('任务说明')).toBeVisible();
  await expect(page.getByText('按电子锯工艺卡检查尺寸与纹路方向')).toBeVisible();
  await expect(page.getByTestId('mobile-start-task')).toBeVisible();

  await page.getByTestId('mobile-start-task').click();
  await expect.poll(() => mockState.startCalls).toBe(1);

  await page.getByTestId('mobile-issue-qty').fill('12.5');
  await page.getByRole('button', { name: '确认领料' }).click();
  await expect(page.getByText('领料申请已提交')).toBeVisible();
  expect(mockState.issuePayload).toMatchObject({
    items: [{
      skuId: 901,
      qty: '12.5',
      warehouseId: 1,
      locationId: 101,
    }],
  });

  await page.getByTestId('mobile-complete-qty').fill('20');
  await page.getByTestId('mobile-complete-hours').fill('7.5');
  await page.getByTestId('mobile-complete-submit').click();
  await expect(page.getByText('报工已提交')).toBeVisible();
  expect(mockState.completePayload).toMatchObject({
    completedQty: '20',
    actualHours: '7.5',
    scrapQty: '0',
  });

  await page.getByTestId('mobile-exception-desc').fill('电子锯报警停机，已联系机修到场处理。');
  await page.getByTestId('mobile-exception-submit').click();
  await expect(page.getByText('异常已上报')).toBeVisible();
  expect(mockState.exceptionPayload).toMatchObject({
    type: '设备故障',
    severity: 'medium',
    affectsProgress: true,
  });

  await page.getByRole('button', { name: '返回任务列表' }).click();
  await expect(page).toHaveURL(/\/m$/);

  await page.getByTestId('mobile-scan-entry').click();
  await expect(page).toHaveURL(/\/m\/scan$/);
  const qrImagePath = path.resolve('tests/fixtures/mobile-task-501-qr.png');
  await page.getByTestId('mobile-scan-image-input').setInputFiles(qrImagePath);
  await expect(page.getByText('最近识别图片：mobile-task-501-qr.png')).toBeVisible();
  await page.getByTestId('mobile-scan-manual-input').fill('SMART_FACTORY_TASK|TASK_ID=501|TASK_NO=TASK-501|ORDER_NO=MO-501|TASK_DATE=2026-04-24');
  await page.getByTestId('mobile-scan-manual-submit').click();
  await expect(page).toHaveURL(/\/m\/tasks\/501\?entry=scan$/);

  await page.getByRole('button', { name: '返回任务列表' }).click();
  await page.getByTestId('mobile-task-card-502').click();
  await expect(page).toHaveURL(/\/m\/tasks\/502$/);
  await expect(page.getByText('已完成任务，回看封边工艺说明和质检注意事项。')).toBeVisible();
  await expect(page.getByText('任务操作')).toHaveCount(0);
  await expect(page.getByTestId('mobile-start-task')).toHaveCount(0);

  await page.getByRole('button', { name: '返回任务列表' }).click();
  await page.getByTestId('mobile-task-card-503').click();
  await expect(page).toHaveURL(/\/m\/tasks\/503$/);
  await expect(page.getByText('该任务分配给 李工，当前账号仅可查看，不能代报工。')).toBeVisible();
  await expect(page.getByText('任务操作')).toHaveCount(0);
  await expect(page.getByTestId('mobile-start-task')).toHaveCount(0);
});

test('mobile h5 warehouse and qc flows remain available on phone viewport', async ({ page }) => {
  await seedAuth(page);
  const mockState = await mockMobileOpsApis(page);

  await page.goto('/m');

  await page.getByTestId('mobile-role-warehouse').click();
  await expect(page).toHaveURL(/\/m\/warehouse$/);
  await page.getByTestId('mobile-warehouse-scan-entry').click();
  await expect(page).toHaveURL(/\/m\/warehouse\/scan$/);
  await page.getByTestId('mobile-warehouse-scan-manual-input').fill('SMART_FACTORY_SKU|SKU_ID=901|SKU_CODE=RM-901|DYE_LOT=LOT-01');
  await page.getByTestId('mobile-warehouse-scan-manual-submit').click();
  await expect(page).toHaveURL(/\/m\/warehouse\/inbound\?keyword=RM-901&skuId=901&dyeLotNo=LOT-01$/);
  await expect(page.getByTestId('mobile-inbound-keyword')).toHaveValue('RM-901');
  await page.getByTestId('mobile-inbound-keyword').fill('棉布');
  await page.getByTestId('mobile-inbound-sku').selectOption('901');
  await page.getByTestId('mobile-inbound-qty').fill('18.5');
  await page.getByTestId('mobile-inbound-submit').click();
  await expect(page.getByText('移动端入库已提交')).toBeVisible();
  expect(mockState.inboundPayload).toMatchObject({
    skuCode: 'RM-901',
    skuId: 901,
    qtyInput: '18.5',
    inputUnit: '米',
    warehouseId: 1,
    locationId: 101,
    transactionType: 'PURCHASE_IN',
  });

  await page.getByRole('button', { name: '返回仓库主页' }).click();
  await expect(page).toHaveURL(/\/m\/warehouse$/);
  await page.getByTestId('mobile-warehouse-stocktaking-card-61').click();
  await expect(page).toHaveURL(/\/m\/warehouse\/stocktaking\/61$/);
  await page.getByTestId('mobile-stocktaking-qty-901').fill('106');
  await page.getByTestId('mobile-stocktaking-save').click();
  await expect(page.getByText('盘点结果已保存')).toBeVisible();
  expect(mockState.stocktakingSavePayload).toEqual([{ skuId: 901, actualQty: '106' }]);

  await page.getByTestId('mobile-stocktaking-submit').click();
  await expect(page.getByText('盘点任务已提交确认')).toBeVisible();
  await expect.poll(() => mockState.stocktakingSubmitCalls).toBe(1);

  await page.getByRole('button', { name: '返回仓库主页' }).click();
  await page.getByTestId('mobile-role-qc').click();
  await expect(page).toHaveURL(/\/m\/qc$/);
  await page.getByTestId('mobile-qc-inspection-card-71').click();
  await expect(page).toHaveURL(/\/m\/qc\/inspections\/71$/);
  await page.getByTestId('mobile-qc-image-input-0').setInputFiles(path.resolve('tests/fixtures/mobile-task-501-qr.png'));
  await expect(page.getByText('已上传 1 张留证图')).toBeVisible();
  await expect.poll(() => mockState.uploadCalls).toBe(1);
  await page.getByTestId('mobile-qc-passed-0').fill('96');
  await page.getByTestId('mobile-qc-notes').fill('来料抽检通过，允许放行入库。');
  await page.getByTestId('mobile-qc-save').click();
  await expect(page.getByText('质检明细已保存')).toBeVisible();
  expect(mockState.inspectionSavePayload).toMatchObject({
    items: [{
      id: 711,
      qtysampled: '10',
      qtyPassed: '96',
      qtyFailed: '0',
      result: 'pass',
      defectImages: ['/api/upload/files/9901/content'],
      disposition: 'accept',
    }],
  });

  await page.getByTestId('mobile-qc-submit').click();
  await expect(page.getByText('质检结论已提交并放行入库')).toBeVisible();
  expect(mockState.inspectionSubmitPayload).toMatchObject({
    overallResult: 'pass',
    warehouseId: 1,
    locationId: 101,
    notes: '来料抽检通过，允许放行入库。',
  });
});

test('confirmed mobile stocktaking task is read-only on phone viewport', async ({ page }) => {
  await seedAuth(page);

  await page.route('**/api/auth/refresh', async (route) => {
    await fulfillJson(route, { accessToken: 'playwright-token' });
  });

  await page.route('**/api/stocktaking**', async (route) => {
    const url = new URL(route.request().url());
    const pathname = url.pathname;
    const method = route.request().method();

    if (method === 'GET' && pathname === '/api/stocktaking') {
      await fulfillJson(route, {
        list: [{
          id: 88,
          taskNo: 'PD-088',
          scope: 'location',
          status: 'confirmed',
          totalItems: 1,
          diffItems: 1,
          createdAt: '2026-04-24 08:00:00',
        }],
        total: 1,
        page: 1,
        pageSize: 10,
      });
      return;
    }

    if (method === 'GET' && pathname === '/api/stocktaking/88') {
      await fulfillJson(route, {
        task: {
          id: 88,
          taskNo: 'PD-088',
          scope: 'location',
          status: 'confirmed',
          totalItems: 1,
          diffItems: 1,
          createdAt: '2026-04-24 08:00:00',
        },
        items: [{
          id: 881,
          taskId: 88,
          skuId: 901,
          skuCode: 'RM-901',
          skuName: '棉布面料',
          stockUnit: '米',
          systemQty: '100',
          actualQty: '96',
          diffQty: '-4',
        }],
      });
      return;
    }

    await route.fallback();
  });

  await page.goto('/m/warehouse/stocktaking/88');

  await expect(page.getByText('该盘点任务已完成确认，当前仅支持查看明细。')).toBeVisible();
  await expect(page.getByTestId('mobile-stocktaking-save')).toHaveCount(0);
  await expect(page.getByTestId('mobile-stocktaking-submit')).toHaveCount(0);
  await expect(page.getByTestId('mobile-stocktaking-qty-901')).toBeDisabled();
});
