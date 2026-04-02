delete (globalThis as any).expect;
import { test, expect, type Page, type Route } from '@playwright/test';

const mockUser = {
  id: 7,
  username: 'buyer',
  realName: '采购员A',
  roles: ['boss', 'purchaser'],
  tenantId: 1,
  tenantName: '测试工厂',
};

const deliveryList = {
  list: [
    {
      id: 101,
      deliveryNo: 'DN-2001',
      poId: 301,
      poNo: 'PO-301',
      supplierName: '华东供应商',
      deliveryDate: '2026-03-20',
      status: 'received',
      inspectionId: 401,
      inspectionNo: 'IQC-401',
      receiptId: 501,
      receiptNo: 'PR-501',
      matchId: 601,
      matchStatus: 'matched',
      totalDelivered: '80',
    },
    {
      id: 102,
      deliveryNo: 'DN-2002',
      poId: 302,
      poNo: 'PO-302',
      supplierName: '华南供应商',
      deliveryDate: '2026-03-21',
      status: 'confirmed',
      inspectionId: null,
      inspectionNo: null,
      receiptId: 502,
      receiptNo: 'PR-502',
      matchId: null,
      matchStatus: null,
      totalDelivered: '24',
    },
  ],
  total: 2,
};

const deliveryDetails: Record<number, Record<string, unknown>> = {
  101: {
    id: 101,
    deliveryNo: 'DN-2001',
    poId: 301,
    poNo: 'PO-301',
    supplierName: '华东供应商',
    deliveryDate: '2026-03-20 09:00:00',
    status: 'received',
    inspectionId: 401,
    inspectionNo: 'IQC-401',
    inspectionCreatedAt: '2026-03-20 10:15:00',
    receiptId: 501,
    receiptNo: 'PR-501',
    receivedAt: '2026-03-20 14:10:00',
    matchId: 601,
    matchStatus: 'matched',
    matchCreatedAt: '2026-03-20 15:00:00',
    matchConfirmedAt: '2026-03-20 15:30:00',
    creatorName: '采购员A',
    createdAt: '2026-03-20 08:40:00',
    items: [
      {
        id: 1,
        skuId: 901,
        skuCode: 'RM-901',
        skuName: '木板A',
        qtyDelivered: '80',
        purchaseUnit: 'pcs',
        unitPrice: '20.00',
        amount: '1600.00',
      },
    ],
  },
  102: {
    id: 102,
    deliveryNo: 'DN-2002',
    poId: 302,
    poNo: 'PO-302',
    supplierName: '华南供应商',
    deliveryDate: '2026-03-21 10:30:00',
    status: 'confirmed',
    inspectionId: null,
    inspectionNo: null,
    inspectionCreatedAt: null,
    receiptId: 502,
    receiptNo: 'PR-502',
    receivedAt: '2026-03-21 16:30:00',
    matchId: null,
    matchStatus: null,
    creatorName: '采购员B',
    createdAt: '2026-03-21 09:45:00',
    items: [
      {
        id: 2,
        skuId: 902,
        skuCode: 'RM-902',
        skuName: '海绵B',
        qtyDelivered: '24',
        purchaseUnit: 'roll',
        unitPrice: '36.00',
        amount: '864.00',
      },
    ],
  },
};

const inspectionRecords = {
  701: {
    id: 701,
    inspectionNo: 'IQC-701',
    poId: 301,
    poNo: 'PO-301',
    deliveryNoteId: 101,
    inspectorId: 1,
    inspectionDate: '2026-03-20',
    status: 'passed',
    overallResult: 'pass',
    receiptTriggered: true,
    returnTriggered: false,
    notes: '已完成质检并触发入库',
    completedAt: '2026-03-20T13:20:00',
    supplierName: '华东供应商',
  },
  702: {
    id: 702,
    inspectionNo: 'IQC-702',
    poId: 302,
    poNo: 'PO-302',
    deliveryNoteId: 102,
    inspectorId: 1,
    inspectionDate: '2026-03-21',
    status: 'in_progress',
    overallResult: null,
    receiptTriggered: false,
    returnTriggered: false,
    notes: '待提交质检结论',
    completedAt: null,
    supplierName: '华南供应商',
  },
} satisfies Record<number, Record<string, unknown>>;

const inspectionItemsById = {
  701: [
    {
      id: 31,
      inspectionId: 701,
      skuId: 901,
      poItemId: 401,
      qtyDelivered: '80',
      qtySampled: '8',
      qtyPassed: '8',
      qtyFailed: '0',
      result: 'pass',
      defectTypes: null,
      defectImages: null,
      disposition: 'accept',
      notes: null,
      skuCode: 'RM-901',
      skuName: '木板A',
    },
  ],
  702: [
    {
      id: 32,
      inspectionId: 702,
      skuId: 902,
      poItemId: 402,
      qtyDelivered: '24',
      qtySampled: '6',
      qtyPassed: '24',
      qtyFailed: '0',
      result: 'pass',
      defectTypes: null,
      defectImages: null,
      disposition: 'accept',
      notes: null,
      skuCode: 'RM-902',
      skuName: '海绵B',
    },
  ],
} satisfies Record<number, Record<string, unknown>[]>;

const receiptList = {
  list: [
    {
      id: 501,
      receiptNo: 'PR-501',
      poId: 301,
      poNo: 'PO-301',
      poStatus: 'received',
      deliveryNoteId: 101,
      deliveryNo: 'DN-2001',
      status: 'confirmed',
      totalAmount: '1600.00',
      totalQty: '80',
      notes: '质检通过后入库',
      receivedAt: '2026-03-20 14:10:00',
      supplierName: '华东供应商',
      inspectionNo: 'IQC-701',
      operatorName: '仓库A',
    },
  ],
  total: 1,
};

const receiptDetail = {
  id: 501,
  receiptNo: 'PR-501',
  poId: 301,
  poNo: 'PO-301',
  poStatus: 'received',
  deliveryNoteId: 101,
  deliveryNo: 'DN-2001',
  status: 'confirmed',
  totalAmount: '1600.00',
  totalQty: '80',
  notes: '质检通过后入库',
  receivedAt: '2026-03-20 14:10:00',
  supplierName: '华东供应商',
  inspectionNo: 'IQC-701',
  operatorName: '仓库A',
  items: [
    {
      id: 41,
      skuId: 901,
      skuCode: 'RM-901',
      skuName: '木板A',
      qtyReceived: '80',
      purchaseUnit: 'pcs',
      unitPrice: '20.00',
      amount: '1600.00',
    },
  ],
};

const purchaseOrderList = {
  list: [
    {
      id: 301,
      poNo: 'PO-301',
      supplierId: 21,
      supplierName: '华东供应商',
      status: 'received',
      expectedDate: '2026-03-22',
      totalAmount: '1600.00',
      notes: '首批木板采购',
      totalOrdered: '80',
      totalReceived: '80',
      totalGap: '0',
      createdAt: '2026-03-18 10:00:00',
      items: [],
    },
  ],
  total: 1,
};

const purchaseOrderDetail = {
  id: 301,
  poNo: 'PO-301',
  supplierId: 21,
  supplierName: '华东供应商',
  status: 'received',
  expectedDate: '2026-03-22',
  totalAmount: '1600.00',
  notes: '首批木板采购',
  totalOrdered: '80',
  totalReceived: '80',
  totalGap: '0',
  createdAt: '2026-03-18 10:00:00',
  items: [
    {
      id: 401,
      skuId: 901,
      skuCode: 'RM-901',
      skuName: '木板A',
      qtyOrdered: '80',
      qtyReceived: '80',
      gapQty: '0',
      progressPct: 100,
      purchaseUnit: 'pcs',
      unitPrice: '20.00',
      amount: '1600.00',
      deliveryHistory: [
        {
          deliveryId: 101,
          deliveryNo: 'DN-2001',
          deliveryDate: '2026-03-20',
          deliveryStatus: 'received',
          qtyDelivered: '80',
          receiptId: 501,
          receiptNo: 'PR-501',
          receiptStatus: 'confirmed',
          qtyReceived: '80',
          receivedAt: '2026-03-20 14:10:00',
        },
      ],
    },
  ],
  deliveries: [
    {
      id: 101,
      deliveryNo: 'DN-2001',
      deliveryDate: '2026-03-20',
      status: 'received',
      totalDelivered: '80',
      receiptId: 501,
      receiptNo: 'PR-501',
      receiptStatus: 'confirmed',
      receivedAt: '2026-03-20 14:10:00',
      notes: '首批到货',
    },
  ],
};

const matchRecord = {
  matchId: 601,
  poId: 301,
  poNo: 'PO-301',
  deliveryNoteId: 101,
  deliveryNo: 'DN-2001',
  receiptId: 501,
  receiptNo: 'PR-501',
  matchStatus: 'qty_diff',
  createdAt: '2026-03-20 15:00:00',
  confirmedAt: null,
  confirmedBy: null,
  diffReason: null,
  diffNotes: null,
  supplierName: '华东供应商',
  diffItems: [
    {
      skuId: 901,
      skuName: '木板A',
      poQty: '80',
      poUnit: 'pcs',
      poPrice: '20.00',
      dnQty: '80',
      dnPrice: '20.00',
      receiptQty: '78',
      qtyDiff: '-2',
      priceDiff: '0.00',
      isPriceAnomaly: false,
      historicalAvgPrice: '19.80',
    },
  ],
};

function buildMatchRecord(confirmed = false) {
  return {
    ...matchRecord,
    matchStatus: confirmed ? 'confirmed' : matchRecord.matchStatus,
    confirmedAt: confirmed ? '2026-03-20 16:00:00' : null,
    confirmedBy: confirmed ? '采购员A' : null,
    diffReason: confirmed ? 'receipt_miss' : null,
    diffNotes: confirmed ? '仓库已补录差异原因' : null,
  };
}

async function fulfillJson(route: Route, data: unknown) {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      code: 0,
      message: 'ok',
      data,
    }),
  });
}

async function mockPurchaseDeliveryApis(page: Page) {
  let matchConfirmed = false;
  const inspectionState = new Map<number, Record<string, unknown>>(
    Object.values(inspectionRecords).map((record) => [Number(record.id), { ...record }]),
  );
  const previewReceiptState = new Map<number, { receiptId: number; receiptNo: string }>([
    [701, { receiptId: 501, receiptNo: 'PR-501' }],
  ]);

  await page.route('**/api/purchase/delivery-notes**', async (route) => {
    const url = new URL(route.request().url());
    const parts = url.pathname.split('/');
    const maybeId = Number(parts.at(-1));
    if (Number.isFinite(maybeId) && maybeId > 0) {
      await fulfillJson(route, deliveryDetails[maybeId]);
      return;
    }
    await fulfillJson(route, deliveryList);
  });

  await page.route('**/api/purchase/three-way-match**', async (route) => {
    if (route.request().method() === 'POST') {
      await fulfillJson(route, null);
      return;
    }
    const url = new URL(route.request().url());
    const parts = url.pathname.split('/');
    const maybeId = Number(parts.at(-1));
    if (Number.isFinite(maybeId) && maybeId > 0) {
      await fulfillJson(route, buildMatchRecord(matchConfirmed));
      return;
    }
    const poId = url.searchParams.get('poId');
    const receiptId = url.searchParams.get('receiptId');
    if (poId === '301' && receiptId === '501') {
      await fulfillJson(route, { list: [buildMatchRecord(matchConfirmed)], total: 1 });
      return;
    }
    await fulfillJson(route, { list: [], total: 0 });
  });

  await page.route('**/api/purchase/three-way-match/*/confirm', async (route) => {
    matchConfirmed = true;
    await fulfillJson(route, null);
  });

  await page.route('**/api/incoming-inspections**', async (route) => {
    const url = new URL(route.request().url());
    const parts = url.pathname.split('/');
    const maybeId = Number(parts.at(-1));
    const maybePreviewId = Number(parts.at(-2));

    if (route.request().method() === 'POST') {
      if (parts.at(-1) === 'submit' && Number.isFinite(maybePreviewId) && maybePreviewId > 0) {
        const existing = inspectionState.get(maybePreviewId);
        if (existing) {
          inspectionState.set(maybePreviewId, {
            ...existing,
            status: 'passed',
            overallResult: 'pass',
            receiptTriggered: true,
            notes: '质检结论已提交，自动生成入库单',
            completedAt: '2026-03-21T17:10:00',
          });
          previewReceiptState.set(maybePreviewId, { receiptId: 501, receiptNo: 'PR-501' });
        }
        await fulfillJson(route, null);
        return;
      }
      await fulfillJson(route, { id: 702, inspectionNo: 'IQC-702' });
      return;
    }
    if (parts.at(-1) === 'preview-receipt' && Number.isFinite(maybePreviewId) && maybePreviewId > 0) {
      await fulfillJson(route, previewReceiptState.get(maybePreviewId) ?? null);
      return;
    }
    if (Number.isFinite(maybeId) && maybeId > 0) {
      const detail = inspectionState.get(maybeId);
      await fulfillJson(route, detail ? { ...detail, items: inspectionItemsById[maybeId] ?? [] } : null);
      return;
    }
    await fulfillJson(route, {
      list: Array.from(inspectionState.values()),
      total: inspectionState.size,
    });
  });

  await page.route('**/api/purchase/receipts**', async (route) => {
    const url = new URL(route.request().url());
    const parts = url.pathname.split('/');
    const maybeId = Number(parts.at(-1));
    if (Number.isFinite(maybeId) && maybeId > 0) {
      await fulfillJson(route, receiptDetail);
      return;
    }
    await fulfillJson(route, receiptList);
  });

  await page.route('**/api/purchase/orders**', async (route) => {
    const url = new URL(route.request().url());
    const parts = url.pathname.split('/');
    const last = parts.at(-1);
    if (last === 'tail-tracking') {
      await fulfillJson(route, { list: [], total: 0 });
      return;
    }
    const maybeId = Number(last);
    if (Number.isFinite(maybeId) && maybeId > 0) {
      await fulfillJson(route, purchaseOrderDetail);
      return;
    }
    await fulfillJson(route, purchaseOrderList);
  });
}

test.describe('采购到货管理冒烟', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript((user) => {
      window.sessionStorage.setItem('__sf_at', 'playwright-token');
      window.localStorage.setItem('sf_user', JSON.stringify(user));
    }, mockUser);
    await mockPurchaseDeliveryApis(page);
  });

  test('送货单详情展示送货到匹配的关键节点', async ({ page }) => {
    await page.goto('/purchase/deliveries');

    await expect(page.locator('#main-content').getByRole('heading', { name: '到货管理' })).toBeVisible();

    const row = page.locator('tbody tr').filter({ hasText: 'DN-2001' }).first();
    await row.getByRole('button', { name: '详情' }).click();

    const drawer = page.getByRole('dialog', { name: '送货单详情 - DN-2001' });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText('关键节点', { exact: true })).toBeVisible();
    await expect(drawer.getByText('送货单登记', { exact: true })).toBeVisible();
    await expect(drawer.getByText('供应商送货', { exact: true })).toBeVisible();
    await expect(drawer.getByText('来料质检', { exact: true })).toBeVisible();
    await expect(drawer.getByText('入库完成', { exact: true })).toBeVisible();
    await expect(drawer.getByText('三单匹配完成', { exact: true })).toBeVisible();
  });

  test('未匹配送货单可直接打开执行匹配弹窗并预填单据上下文', async ({ page }) => {
    await page.goto('/purchase/deliveries');

    const row = page.locator('tbody tr').filter({ hasText: 'DN-2002' }).first();
    await row.getByRole('button', { name: '执行匹配' }).click();

    const dialog = page.getByRole('dialog', { name: '执行三单匹配' });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('input').nth(0)).toHaveValue('PO-302');
    await expect(dialog.locator('input').nth(1)).toHaveValue('DN-2002');
    await expect(dialog.locator('input').nth(2)).toHaveValue('PR-502');
  });

  test('从送货单发起质检后会在当前页完成创建并关闭弹窗', async ({ page }) => {
    await page.goto('/purchase/deliveries');

    const row = page.locator('tbody tr').filter({ hasText: 'DN-2002' }).first();
    await row.getByRole('button', { name: '创建质检单' }).click();

    const dialog = page.getByRole('dialog', { name: '新建来料质检单' });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('input').nth(0)).toHaveValue('PO-302');
    await expect(dialog.locator('input').nth(1)).toHaveValue('DN-2002');
    await expect(dialog.locator('input').nth(3)).toHaveValue('华南供应商');

    await dialog.getByRole('button', { name: '创建' }).click();

    await expect(page.getByText('来料质检单 IQC-702 已创建')).toBeVisible();
    await expect(page.getByRole('dialog', { name: '新建来料质检单' })).toHaveCount(0);
  });

  test('质检详情可继续跳入库单并进入三单匹配详情', async ({ page }) => {
    await page.goto('/purchase/incoming-inspection');

    await expect(page.locator('#main-content').getByRole('heading', { name: '来料质检' })).toBeVisible();

    const row = page.locator('tbody tr').filter({ hasText: 'IQC-701' }).first();
    await row.getByRole('button', { name: '查看详情' }).click();

    const inspectionDrawer = page.getByRole('dialog', { name: '质检单详情 — IQC-701' });
    await expect(inspectionDrawer).toBeVisible();
    await inspectionDrawer.getByRole('button', { name: '查看入库单' }).click();

    await page.waitForURL(/\/purchase\/receipts\?receiptId=501&poId=301/);
    const receiptDrawer = page.getByRole('dialog', { name: '入库单详情 - PR-501' });
    await expect(receiptDrawer).toBeVisible();
    await receiptDrawer.getByRole('button', { name: '查看三单匹配' }).click();

    await page.waitForURL(/\/purchase\/match\?poId=301&receiptId=501/);
    await expect(page.locator('#main-content').getByRole('heading', { name: '三单匹配' })).toBeVisible();
    await expect(page.getByRole('dialog', { name: '三单差异详情 — PO-301' })).toBeVisible();
  });

  test('质检提交后会刷新详情并可继续查看入库单', async ({ page }) => {
    await page.goto('/purchase/incoming-inspection');

    const row = page.locator('tbody tr').filter({ hasText: 'IQC-702' }).first();
    await row.getByRole('button', { name: '查看详情' }).click();

    const inspectionDrawer = page.getByRole('dialog', { name: '质检单详情 — IQC-702' });
    await expect(inspectionDrawer).toBeVisible();
    await inspectionDrawer.getByRole('button', { name: '提交质检结论' }).click();

    const submitDialog = page.getByRole('dialog', { name: '提交质检结论' });
    await expect(submitDialog).toBeVisible();
    await submitDialog.getByText('通过', { exact: true }).click();
    await submitDialog.locator('#submit-notes').fill('本批次抽检通过，允许自动入库');
    await submitDialog.getByRole('button', { name: '提交结论' }).click();

    await expect(page.getByText('质检结论已提交')).toBeVisible();
    await expect(inspectionDrawer.getByText('关联入库单', { exact: true })).toBeVisible();
    await expect(inspectionDrawer.getByText('PR-501')).toBeVisible();
    await inspectionDrawer.getByRole('button', { name: '查看入库单' }).click();

    await page.waitForURL(/\/purchase\/receipts\?receiptId=501&poId=302/);
    await expect(page.getByRole('dialog', { name: '入库单详情 - PR-501' })).toBeVisible();
  });

  test('三单差异可确认并给出成功反馈', async ({ page }) => {
    await page.goto('/purchase/match?poId=301&receiptId=501');

    await expect(page.locator('#main-content').getByRole('heading', { name: '三单匹配' })).toBeVisible();
    const dialog = page.getByRole('dialog', { name: '三单差异详情 — PO-301' });
    await expect(dialog).toBeVisible();

    await dialog.getByText('入库漏录', { exact: true }).click();
    await dialog.locator('#diffRemark').fill('仓库盘点后确认属于漏录，允许继续结算');
    await dialog.getByRole('button', { name: /确认差异/ }).click();

    await expect(page.getByText('差异已确认，采购单已进入结算流程')).toBeVisible();
  });

  test('差异确认后再次进入详情显示只读确认记录', async ({ page }) => {
    await page.goto('/purchase/match?poId=301&receiptId=501');

    let dialog = page.getByRole('dialog', { name: '三单差异详情 — PO-301' });
    await expect(dialog).toBeVisible();
    await dialog.getByText('入库漏录', { exact: true }).click();
    await dialog.locator('#diffRemark').fill('仓库已补录差异原因');
    await dialog.getByRole('button', { name: /确认差异/ }).click();

    await expect(page.getByText('差异已确认，采购单已进入结算流程')).toBeVisible();

    await page.goto('/purchase/match?poId=301&receiptId=501&matchId=601');
    dialog = page.getByRole('dialog', { name: '三单差异详情 — PO-301' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('确认记录', { exact: true })).toBeVisible();
    await expect(dialog.getByText('确认人：采购员A')).toBeVisible();
    await expect(dialog.getByText('差异原因：receipt_miss')).toBeVisible();
    await expect(dialog.getByText('仓库已补录差异原因')).toBeVisible();
    await expect(dialog.getByRole('button', { name: /确认差异/ })).toHaveCount(0);
  });

  test('入库单可继续跳转并打开采购订单详情', async ({ page }) => {
    await page.goto('/purchase/receipts?receiptId=501&poId=301');

    await expect(page.locator('#main-content').getByRole('heading', { name: '入库记录' })).toBeVisible();
    const receiptDrawer = page.getByRole('dialog', { name: '入库单详情 - PR-501' });
    await expect(receiptDrawer).toBeVisible();

    await receiptDrawer.getByRole('button', { name: '查看采购订单' }).click();

    await page.waitForURL(/\/purchase\/orders\?orderId=301/);
    const orderDrawer = page.getByRole('dialog', { name: '采购订单详情 - PO-301' });
    await expect(orderDrawer).toBeVisible();
    await expect(orderDrawer.getByText('履约进度', { exact: true })).toBeVisible();
    await expect(orderDrawer.getByText('首批木板采购')).toBeVisible();
  });

  test('采购订单详情可继续回看送货单和入库单', async ({ page }) => {
    await page.goto('/purchase/orders?orderId=301');

    await expect(page.locator('#main-content').getByRole('heading', { name: '采购订单' })).toBeVisible();
    const orderDrawer = page.getByRole('dialog', { name: '采购订单详情 - PO-301' });
    await expect(orderDrawer).toBeVisible();

    await orderDrawer.getByRole('button', { name: '查看送货' }).first().click();

    await page.waitForURL(/\/purchase\/deliveries\?deliveryId=101&poId=301/);
    const deliveryDrawer = page.getByRole('dialog', { name: '送货单详情 - DN-2001' });
    await expect(deliveryDrawer).toBeVisible();

    await deliveryDrawer.getByRole('button', { name: '查看入库单' }).click();

    await page.waitForURL(/\/purchase\/receipts\?receiptId=501&poId=301/);
    const receiptDrawer = page.getByRole('dialog', { name: '入库单详情 - PR-501' });
    await expect(receiptDrawer).toBeVisible();
    await expect(receiptDrawer.getByText('入库备注', { exact: true })).toBeVisible();
  });
});
