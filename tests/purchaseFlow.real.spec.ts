delete (globalThis as any).expect;
import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import {
  APP_BASE_URL,
  seedAuth,
  createScenario,
  findInspectionByDelivery,
  findReceiptByInspection,
  prepareInspectionItems,
  closePurchaseFlowDbPool,
} from './helpers/purchaseFlow';

test.describe.serial('采购链路前端交互（真实后端） @purchase-regression', () => {
  test.setTimeout(120_000);

  test.afterAll(async () => {
    await closePurchaseFlowDbPool();
  });

  async function createPurchaseSettlementViaUi(page: import('@playwright/test').Page, request: import('@playwright/test').APIRequestContext) {
    const scenario = await createScenario(request, 'pass');
    if (!scenario.receiptId) {
      throw new Error('Happy path scenario did not produce a receipt');
    }

    await seedAuth(page, 'purchaser');
    await page.goto(`${APP_BASE_URL}/purchase/match?execute=1&poId=${scenario.poId}&deliveryNoteId=${scenario.deliveryId}&receiptId=${scenario.receiptId}`);

    const executeModal = page.getByRole('dialog', { name: '执行三单匹配' });
    await expect(executeModal).toBeVisible();
    await executeModal.getByRole('button', { name: '执行匹配' }).click();

    const row = page.locator('tbody tr').filter({ hasText: scenario.poNo }).first();
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: '采购结算' }).click();

    await expect(page).toHaveURL(new RegExp(`/purchase/settlements\\?poId=${scenario.poId}`));
    await expect(page.locator('#main-content').getByRole('heading', { name: '采购结算' })).toBeVisible();
    const settlementRow = page.locator('tbody tr').filter({ hasText: scenario.poNo }).first();
    await expect(settlementRow).toBeVisible({ timeout: 15_000 });

    return { scenario, settlementRow };
  }

  test('采购员可从采购订单进入到货管理并创建送货单 @purchase-smoke', async ({ page, request }) => {
    const scenario = await createScenario(request, 'order_only');

    await seedAuth(page, 'purchaser');
    await page.goto(`${APP_BASE_URL}/purchase/orders?orderId=${scenario.poId}`);

    await expect(page.getByRole('heading', { name: '采购订单履约中心' })).toBeVisible();

    const orderDrawer = page.getByRole('dialog', { name: new RegExp(`采购订单详情.*${scenario.poNo}`) });
    await expect(orderDrawer).toBeVisible();
    await expect(orderDrawer).toContainText(scenario.fixture.supplierName);

    await orderDrawer.getByRole('button', { name: '录入送货' }).click();

    const createModal = page.getByRole('dialog', { name: '新建送货单' });
    await expect(createModal).toBeVisible();
    await expect(createModal.locator(`input[value="${scenario.poId}"]`)).toBeVisible();
    await createModal.getByPlaceholder('可填写本次送货批次、车次、包装情况等说明').fill('Playwright UI 创建送货单');
    await createModal.getByRole('button', { name: '创建送货单' }).click();

    await expect(page).toHaveURL(new RegExp(`/purchase/deliveries\\?poId=${scenario.poId}`));

    const deliveryRow = page.locator('tbody tr').filter({ hasText: scenario.poNo }).first();
    await expect(deliveryRow).toBeVisible();
    await deliveryRow.getByRole('button', { name: '详情' }).click();

    const deliveryDrawer = page.getByRole('dialog', { name: /送货单详情/ });
    await expect(deliveryDrawer).toBeVisible();
    await expect(deliveryDrawer).toContainText(scenario.poNo);
    await expect(deliveryDrawer.getByRole('button', { name: '创建质检单' })).toBeVisible();
  });

  test('仓库可从到货管理创建质检单并在来料质检页查看详情 @purchase-smoke', async ({ page, request }) => {
    const scenario = await createScenario(request, 'delivery_only');

    await seedAuth(page, 'warehouse');
    await page.goto(`${APP_BASE_URL}/purchase/deliveries?deliveryId=${scenario.deliveryId}&poId=${scenario.poId}`);

    const deliveryDrawer = page.getByRole('dialog', { name: new RegExp(`送货单详情.*${scenario.deliveryNo}`) });
    await expect(deliveryDrawer).toBeVisible();
    await deliveryDrawer.getByRole('button', { name: '创建质检单' }).click();

    const createModal = page.getByRole('dialog', { name: '新建来料质检单' });
    await expect(createModal).toBeVisible();
    await expect(createModal.locator(`input[value="${scenario.poId}"]`)).toBeVisible();
    await expect(createModal.locator(`input[value="${scenario.deliveryId}"]`)).toBeVisible();
    await createModal.getByPlaceholder('请输入备注（可选）').fill('Playwright UI 创建质检单');
    await createModal.getByRole('button', { name: '创建' }).click();

    const inspection = await findInspectionByDelivery(request, scenario.deliveryId);

    await page.goto(`${APP_BASE_URL}/purchase/incoming-inspection`);
    await expect(page.locator('#main-content').getByRole('heading', { name: '来料质检' })).toBeVisible();
    await page.locator('#keyword').fill(inspection.inspectionNo);

    const row = page.locator('tbody tr').filter({ hasText: inspection.inspectionNo }).first();
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: '查看详情' }).click();

    const detailDrawer = page.getByRole('dialog', { name: new RegExp(`质检单详情.*${inspection.inspectionNo}`) });
    await expect(detailDrawer).toBeVisible();
    await expect(detailDrawer).toContainText(scenario.poNo);
    await expect(detailDrawer).toContainText(scenario.fixture.supplierName);
  });

  test('仓库提交合格质检后可查看入库并补充备注 @purchase-smoke', async ({ page, request }) => {
    const scenario = await createScenario(request, 'inspection_only');
    await prepareInspectionItems(request, scenario.inspectionId, 'pass');

    await seedAuth(page, 'warehouse');
    await page.goto(`${APP_BASE_URL}/purchase/incoming-inspection`);
    await page.locator('#keyword').fill(scenario.inspectionNo);

    const row = page.locator('tbody tr').filter({ hasText: scenario.inspectionNo }).first();
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: '查看详情' }).click();

    const detailDrawer = page.getByRole('dialog', { name: new RegExp(`质检单详情.*${scenario.inspectionNo}`) });
    await expect(detailDrawer).toBeVisible();
    await detailDrawer.getByRole('button', { name: '提交质检结论' }).click();

    const submitModal = page.getByRole('dialog', { name: '提交质检结论' });
    await expect(submitModal).toBeVisible();
    await submitModal.locator('label').filter({ hasText: '通过' }).first().click();
    await submitModal.getByPlaceholder('请输入质检备注或说明...').fill('Playwright 提交整批合格');
    await submitModal.getByRole('button', { name: '提交结论' }).click();

    const receipt = await findReceiptByInspection(request, scenario.inspectionId);
    await expect(detailDrawer.getByRole('button', { name: '查看入库单' })).toBeVisible();
    await detailDrawer.getByRole('button', { name: '查看入库单' }).click();

    const receiptDrawer = page.getByRole('dialog', { name: new RegExp(`入库单详情.*${receipt.receiptNo}`) });
    await expect(receiptDrawer).toBeVisible();
    await expect(receiptDrawer).toContainText(scenario.poNo);
    await expect(receiptDrawer).toContainText(scenario.fixture.supplierName);
    await expect(receiptDrawer).toContainText('入库数量：20');

    const noteInput = receiptDrawer.getByPlaceholder('可在入库单创建 24 小时内补充备注，例如现场收货情况、批次说明');
    await noteInput.fill('Playwright 收货备注');
    await receiptDrawer.getByRole('button', { name: '保存备注' }).click();
    await expect(noteInput).toHaveValue('Playwright 收货备注');
  });

  test('采购员可执行三单匹配并看到已匹配状态 @purchase-smoke', async ({ page, request }) => {
    const scenario = await createScenario(request, 'pass');
    if (!scenario.receiptId) {
      throw new Error('Happy path scenario did not produce a receipt');
    }

    await seedAuth(page, 'purchaser');
    await page.goto(`${APP_BASE_URL}/purchase/match?execute=1&poId=${scenario.poId}&deliveryNoteId=${scenario.deliveryId}&receiptId=${scenario.receiptId}`);

    const executeModal = page.getByRole('dialog', { name: '执行三单匹配' });
    await expect(executeModal).toBeVisible();
    await expect(executeModal.locator(`input[value="${scenario.poId}"]`)).toBeVisible();
    await expect(executeModal.locator(`input[value="${scenario.deliveryId}"]`)).toBeVisible();
    await expect(executeModal.locator(`input[value="${scenario.receiptId}"]`)).toBeVisible();
    await executeModal.getByRole('button', { name: '执行匹配' }).click();

    const row = page.locator('tbody tr').filter({ hasText: scenario.poNo }).first();
    await expect(row).toBeVisible();
    await expect(row.getByText('已匹配')).toBeVisible();
  });

  test('采购员可确认部分合格场景的三单差异', async ({ page, request }) => {
    const scenario = await createScenario(request, 'partial_return');
    if (!scenario.receiptId) {
      throw new Error('Partial return scenario did not produce a receipt');
    }

    await seedAuth(page, 'purchaser');
    await page.goto(`${APP_BASE_URL}/purchase/match?execute=1&poId=${scenario.poId}&deliveryNoteId=${scenario.deliveryId}&receiptId=${scenario.receiptId}`);

    const executeModal = page.getByRole('dialog', { name: '执行三单匹配' });
    await expect(executeModal).toBeVisible();
    await executeModal.getByRole('button', { name: '执行匹配' }).click();

    const diffModal = page.getByRole('dialog', { name: new RegExp(`三单差异详情.*${scenario.poNo}`) });
    await expect(diffModal).toBeVisible();
    await expect(diffModal).toContainText('三单数据对比');
    await diffModal.getByPlaceholder('补充说明差异详情，如联系供应商结果、盘点记录编号等…').fill('Playwright 确认数量差异');
    await diffModal.getByRole('button', { name: /确认差异/ }).click();

    const row = page.locator('tbody tr').filter({ hasText: scenario.poNo }).first();
    await expect(row).toBeVisible();
    await expect(row.getByText('已匹配')).toBeVisible();
  });

  test('仓库可完成部分合格自动退货单 @purchase-smoke', async ({ page, request }) => {
    const scenario = await createScenario(request, 'partial_return');
    if (!scenario.returnNo) {
      throw new Error('Partial return scenario did not produce a return order');
    }

    await seedAuth(page, 'warehouse');
    await page.goto(`${APP_BASE_URL}/purchase/returns`);

    const row = page.locator('tbody tr').filter({ hasText: scenario.returnNo }).first();
    await expect(row).toBeVisible();
    await expect(row.getByText('已确认')).toBeVisible();
    await row.getByRole('button', { name: '发出' }).click();
    await expect(row.getByText('已发出')).toBeVisible();
    await row.getByRole('button', { name: '完成' }).click();
    await expect(row.getByText('已完成')).toBeVisible();
  });

  test('仓库可查看整单不合格质检结果且无入库入口，并完成自动退货 @purchase-smoke', async ({ page, request }) => {
    const scenario = await createScenario(request, 'fail_return');
    if (!scenario.returnNo) {
      throw new Error('Full return scenario did not produce a return order');
    }

    await seedAuth(page, 'warehouse');
    await page.goto(`${APP_BASE_URL}/purchase/incoming-inspection`);
    await page.locator('#keyword').fill(scenario.inspectionNo);

    const inspectionRow = page.locator('tbody tr').filter({ hasText: scenario.inspectionNo }).first();
    await expect(inspectionRow).toBeVisible();
    await inspectionRow.getByRole('button', { name: '查看详情' }).click();

    const detailDrawer = page.getByRole('dialog', { name: new RegExp(`质检单详情.*${scenario.inspectionNo}`) });
    await expect(detailDrawer).toBeVisible();
    await expect(detailDrawer).toContainText('已触发入库');
    await expect(detailDrawer).toContainText('否');
    await expect(detailDrawer.getByRole('button', { name: '查看入库单' })).toHaveCount(0);

    await page.goto(`${APP_BASE_URL}/purchase/returns`);
    const returnRow = page.locator('tbody tr').filter({ hasText: scenario.returnNo }).first();
    await expect(returnRow).toBeVisible();
    await returnRow.getByRole('button', { name: '发出' }).click();
    await expect(returnRow.getByText('已发出')).toBeVisible();
    await returnRow.getByRole('button', { name: '完成' }).click();
    await expect(returnRow.getByText('已完成')).toBeVisible();
  });

  test('采购员可发起采购结算，老板可确认并标记已付款 @purchase-smoke', async ({ page, request }) => {
    const scenario = await createScenario(request, 'pass');
    if (!scenario.receiptId) {
      throw new Error('Happy path scenario did not produce a receipt');
    }

    await seedAuth(page, 'purchaser');
    await page.goto(`${APP_BASE_URL}/purchase/match?execute=1&poId=${scenario.poId}&deliveryNoteId=${scenario.deliveryId}&receiptId=${scenario.receiptId}`);

    const executeModal = page.getByRole('dialog', { name: '执行三单匹配' });
    await expect(executeModal).toBeVisible();
    await executeModal.getByRole('button', { name: '执行匹配' }).click();

    const row = page.locator('tbody tr').filter({ hasText: scenario.poNo }).first();
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: '采购结算' }).click();

    await expect(page).toHaveURL(new RegExp(`/purchase/settlements\\?poId=${scenario.poId}`));
    await expect(page.locator('#main-content').getByRole('heading', { name: '采购结算' })).toBeVisible();

    const settlementRow = page.locator('tbody tr').filter({ hasText: scenario.poNo }).first();
    await expect(settlementRow).toBeVisible();
    await expect(settlementRow.getByText('草稿')).toBeVisible();

    await seedAuth(page, 'boss');
    await page.goto(`${APP_BASE_URL}/purchase/settlements?poId=${scenario.poId}`);

    const bossRow = page.locator('tbody tr').filter({ hasText: scenario.poNo }).first();
    await expect(bossRow).toBeVisible();
    await bossRow.getByRole('button', { name: '确认' }).click();
    await expect(bossRow.getByText('已确认')).toBeVisible();
    await bossRow.getByRole('button', { name: '标记已付' }).click();
    await expect(bossRow.getByText('已付款')).toBeVisible();
  });

  test('老板取消采购结算后，采购员可重新发起新的采购结算单', async ({ page, request }) => {
    const scenario = await createScenario(request, 'pass');
    if (!scenario.receiptId) {
      throw new Error('Happy path scenario did not produce a receipt');
    }

    await seedAuth(page, 'purchaser');
    await page.goto(`${APP_BASE_URL}/purchase/match?execute=1&poId=${scenario.poId}&deliveryNoteId=${scenario.deliveryId}&receiptId=${scenario.receiptId}`);

    const executeModal = page.getByRole('dialog', { name: '执行三单匹配' });
    await expect(executeModal).toBeVisible();
    await executeModal.getByRole('button', { name: '执行匹配' }).click();

    const matchRow = page.locator('tbody tr').filter({ hasText: scenario.poNo }).first();
    await expect(matchRow).toBeVisible();
    await matchRow.getByRole('button', { name: '采购结算' }).click();

    await expect(page).toHaveURL(new RegExp(`/purchase/settlements\\?poId=${scenario.poId}`));
    const firstSettlementRow = page.locator('tbody tr').filter({ hasText: scenario.poNo }).first();
    await expect(firstSettlementRow).toBeVisible();
    await expect(firstSettlementRow.getByText('草稿')).toBeVisible();

    await seedAuth(page, 'boss');
    await page.goto(`${APP_BASE_URL}/purchase/settlements?poId=${scenario.poId}`);
    const cancelRow = page.locator('tbody tr').filter({ hasText: scenario.poNo }).first();
    await expect(cancelRow).toBeVisible();
    await cancelRow.getByRole('button', { name: '取消' }).click();
    await expect(cancelRow.getByText('已取消')).toBeVisible();

    await seedAuth(page, 'purchaser');
    await page.goto(`${APP_BASE_URL}/purchase/match?poId=${scenario.poId}`);
    const recreateRow = page.locator('tbody tr').filter({ hasText: scenario.poNo }).first();
    await expect(recreateRow).toBeVisible();
    await recreateRow.getByRole('button', { name: '采购结算' }).click();

    await expect(page).toHaveURL(new RegExp(`/purchase/settlements\\?poId=${scenario.poId}`));
    const settlementRows = page.locator('tbody tr').filter({ hasText: scenario.poNo });
    await expect(settlementRows).toHaveCount(2);
    await expect(settlementRows.nth(0).getByText('草稿')).toBeVisible();
    await expect(settlementRows.nth(1).getByText('已取消')).toBeVisible();
  });

  test('采购员可导出采购结算 CSV', async ({ page, request }) => {
    const { scenario } = await createPurchaseSettlementViaUi(page, request);

    await page.goto(`${APP_BASE_URL}/purchase/settlements?poId=${scenario.poId}`);
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出 CSV' }).click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toContain('采购结算_');
    expect(download.suggestedFilename()).toContain('.csv');
  });

  test('采购结算页筛选条件可写入 URL 并在刷新后保持', async ({ page, request }) => {
    const { scenario } = await createPurchaseSettlementViaUi(page, request);

    await page.goto(`${APP_BASE_URL}/purchase/settlements`);
    await expect(page.locator('#main-content').getByRole('heading', { name: '采购结算' })).toBeVisible();

    const keywordInput = page.getByLabel('筛选采购结算单');
    await keywordInput.fill(scenario.poNo);
    await page.getByRole('tab', { name: '草稿' }).click();
    await page.getByRole('button', { name: '查询' }).click();

    await expect(page).toHaveURL(new RegExp(`status=draft`));
    await expect(page).toHaveURL(new RegExp(`keyword=${scenario.poNo}`));

    await page.reload();

    await expect(page.locator('#main-content').getByRole('heading', { name: '采购结算' })).toBeVisible();
    await expect(page.getByRole('tab', { name: '草稿' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByLabel('筛选采购结算单')).toHaveValue(scenario.poNo);

    const row = page.locator('tbody tr').filter({ hasText: scenario.poNo }).first();
    await expect(row).toBeVisible();
    await expect(row.getByText('草稿')).toBeVisible();
  });

  test('采购结算页无匹配结果时展示空态，重置后可恢复列表', async ({ page, request }) => {
    const { scenario } = await createPurchaseSettlementViaUi(page, request);

    await page.goto(`${APP_BASE_URL}/purchase/settlements`);
    await expect(page.locator('#main-content').getByRole('heading', { name: '采购结算' })).toBeVisible();

    const keywordInput = page.getByLabel('筛选采购结算单');
    await keywordInput.fill('NO_MATCH_SETTLEMENT_KEYWORD');
    await page.getByRole('button', { name: '查询' }).click();

    await expect(page).toHaveURL(/keyword=NO_MATCH_SETTLEMENT_KEYWORD/);
    await expect(page.getByText('暂无采购结算单')).toBeVisible();

    await page.getByRole('button', { name: '重置' }).click();

    await expect(page).not.toHaveURL(/keyword=NO_MATCH_SETTLEMENT_KEYWORD/);
    await expect(page.getByLabel('筛选采购结算单')).toHaveValue('');
    await expect(page.locator('tbody tr').filter({ hasText: scenario.poNo }).first()).toBeVisible();
  });

  test('老板取消采购结算后导出 CSV 包含取消记录', async ({ page, request }) => {
    const { scenario, settlementRow } = await createPurchaseSettlementViaUi(page, request);
    const settlementNo = (await settlementRow.locator('td').nth(0).textContent())?.trim();
    expect(settlementNo).toBeTruthy();

    await seedAuth(page, 'boss');
    await page.goto(`${APP_BASE_URL}/purchase/settlements?poId=${scenario.poId}`);

    const cancelRow = page.locator('tbody tr').filter({ hasText: scenario.poNo }).first();
    await expect(cancelRow).toBeVisible();
    await cancelRow.getByRole('button', { name: '取消' }).click();
    await expect(cancelRow.getByText('已取消')).toBeVisible();

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出 CSV' }).click();
    const download = await downloadPromise;
    const path = await download.path();
    expect(path).toBeTruthy();

    const csv = await readFile(path!, 'utf8');
    expect(csv).toContain(String(settlementNo));
    expect(csv).toContain(scenario.poNo);
    expect(csv).toContain('cancelled');
  });

  test('采购员在采购结算页仅可查看，不可确认、付款或取消', async ({ page, request }) => {
    const { scenario } = await createPurchaseSettlementViaUi(page, request);

    await page.goto(`${APP_BASE_URL}/purchase/settlements?poId=${scenario.poId}`);
    await expect(page.locator('#main-content').getByRole('heading', { name: '采购结算' })).toBeVisible();

    const row = page.locator('tbody tr').filter({ hasText: scenario.poNo }).first();
    await expect(row).toBeVisible();
    await expect(row.getByRole('button', { name: '查看匹配' })).toBeVisible();
    await expect(row.getByRole('button', { name: '确认' })).toHaveCount(0);
    await expect(row.getByRole('button', { name: '标记已付' })).toHaveCount(0);
    await expect(row.getByRole('button', { name: '取消' })).toHaveCount(0);
  });

  test('主管可取消采购结算，但不可确认或付款', async ({ page, request }) => {
    const { scenario } = await createPurchaseSettlementViaUi(page, request);

    await seedAuth(page, 'supervisor');
    await page.goto(`${APP_BASE_URL}/purchase/settlements?poId=${scenario.poId}`);
    await expect(page.locator('#main-content').getByRole('heading', { name: '采购结算' })).toBeVisible();

    const row = page.locator('tbody tr').filter({ hasText: scenario.poNo }).first();
    await expect(row).toBeVisible();
    await expect(row.getByRole('button', { name: '确认' })).toHaveCount(0);
    await expect(row.getByRole('button', { name: '标记已付' })).toHaveCount(0);
    await expect(row.getByRole('button', { name: '取消' })).toBeVisible();

    await row.getByRole('button', { name: '取消' }).click();
    await expect(row.getByText('已取消')).toBeVisible();
  });

  test('老板将采购结算标记已付款后，不可再确认、付款或取消', async ({ page, request }) => {
    const { scenario } = await createPurchaseSettlementViaUi(page, request);

    await seedAuth(page, 'boss');
    await page.goto(`${APP_BASE_URL}/purchase/settlements?poId=${scenario.poId}`);
    await expect(page.locator('#main-content').getByRole('heading', { name: '采购结算' })).toBeVisible();

    const row = page.locator('tbody tr').filter({ hasText: scenario.poNo }).first();
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: '确认' }).click();
    await expect(row.getByText('已确认')).toBeVisible();
    await row.getByRole('button', { name: '标记已付' }).click();
    await expect(row.getByText('已付款')).toBeVisible();

    await expect(row.getByRole('button', { name: '确认' })).toHaveCount(0);
    await expect(row.getByRole('button', { name: '标记已付' })).toHaveCount(0);
    await expect(row.getByRole('button', { name: '取消' })).toHaveCount(0);
    await expect(row.getByRole('button', { name: '查看匹配' })).toBeVisible();
  });

  test('采购结算页可通过查看匹配回跳到对应三单匹配记录', async ({ page, request }) => {
    const { scenario } = await createPurchaseSettlementViaUi(page, request);

    await page.goto(`${APP_BASE_URL}/purchase/settlements?poId=${scenario.poId}`);
    await expect(page.locator('#main-content').getByRole('heading', { name: '采购结算' })).toBeVisible();

    const row = page.locator('tbody tr').filter({ hasText: scenario.poNo }).first();
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: '查看匹配' }).click();

    await expect(page).toHaveURL(new RegExp(`/purchase/match\\?poId=${scenario.poId}.*matchId=`));
    await expect(page.locator('#main-content').getByRole('heading', { name: '三单匹配' })).toBeVisible();

    const matchRow = page.locator('tbody tr').filter({ hasText: scenario.poNo }).first();
    await expect(matchRow).toBeVisible();
    await expect(matchRow.getByText('已匹配')).toBeVisible();

    const detailModal = page.getByRole('dialog', { name: new RegExp(`三单差异详情.*${scenario.poNo}`) });
    await expect(detailModal).toBeVisible();
    await expect(detailModal).toContainText(scenario.fixture.supplierName);
    await expect(detailModal.getByRole('button', { name: '查看采购订单' })).toBeVisible();
    await expect(detailModal.getByRole('button', { name: '查看入库单' })).toBeVisible();
  });
});
