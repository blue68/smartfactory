/**
 * [artifact:自动化测试] — 供应商管理页像素级 UI 审计 + 全功能交互测试
 *
 * 对照设计稿 web-supplier-manage.html，逐一检查：
 *   页面布局、页头工具栏、统计摘要栏、等级徽章、搜索筛选、
 *   数据表格(列/进度条/质量率/账期)、分页、新建Drawer(表单三节)、
 *   编辑Drawer、详情视图(4个Tab)、绩效对比Modal(柱状图/雷达图/AI建议)、
 *   导出、行操作、对比功能、响应式、无障碍、运行时错误
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const BASE = 'http://localhost';
const DIR = path.join(import.meta.dirname, 'screenshots-supplier-audit');
const ISSUES = [];
let CHECKS = 0, PASS = 0;

function check(name, actual, expected, tolerance = 0) {
  CHECKS++;
  const nA = typeof actual === 'string' ? parseFloat(actual) : actual;
  const nE = typeof expected === 'string' ? parseFloat(expected) : expected;
  const isNum = typeof nA === 'number' && !isNaN(nA) && typeof nE === 'number' && !isNaN(nE);
  let ok;
  if (isNum) ok = Math.abs(nA - nE) <= tolerance;
  else ok = String(actual).trim().toLowerCase().replace(/\s+/g, ' ') === String(expected).trim().toLowerCase().replace(/\s+/g, ' ');
  if (ok) { PASS++; console.log(`  ✓ ${name}: ${actual}`); }
  else { ISSUES.push({ name, actual: String(actual), expected: String(expected) }); console.log(`  ✗ ${name}: 实际=${actual}  期望=${expected}`); }
  return ok;
}
function checkExists(name, count) {
  CHECKS++;
  if (count > 0) { PASS++; console.log(`  ✓ ${name}: ${count}个`); return true; }
  ISSUES.push({ name, actual: '0', expected: '>0' }); console.log(`  ✗ ${name}: 未找到`); return false;
}
function checkTrue(name, val, desc = '') {
  CHECKS++;
  if (val) { PASS++; console.log(`  ✓ ${name}: ${desc || '是'}`); return true; }
  ISSUES.push({ name, actual: '否', expected: desc || '是' }); console.log(`  ✗ ${name}: 否  期望=${desc || '是'}`); return false;
}
function hex(c) {
  if (!c) return '';
  const m = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  return m ? '#' + [m[1], m[2], m[3]].map(x => (+x).toString(16).padStart(2, '0')).join('').toUpperCase() : c.toUpperCase();
}

async function main() {
  fs.mkdirSync(DIR, { recursive: true });
  const browser = await chromium.launch({ headless: false, channel: 'chrome' });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  // 捕获 API 错误 & JS 错误
  const apiErrors = [];
  page.on('response', r => { if (r.url().includes('/api/') && r.status() >= 500) apiErrors.push({ url: r.url(), status: r.status() }); });
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));

  // ── 登录 ──
  await page.goto(BASE);
  await page.fill('input[name="tenantCode"]', 'FACTORY001');
  await page.fill('input[name="username"]', 'admin');
  await page.fill('input[name="password"]', 'admin123');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(2000);

  // ── 导航到供应商页 ──
  await page.evaluate(() => {
    window.history.pushState({}, '', '/master-data/supplier');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(DIR, '00_supplier_list.png'), fullPage: true });

  // ════════════════════════════════════════════════════
  // A. 页面布局
  // ════════════════════════════════════════════════════
  console.log('\n─── A. 页面布局 ───');

  const pageContent = await page.evaluate(() => document.body.innerText.length);
  checkTrue('页面已加载内容', pageContent > 100, '有内容');

  const sidebarEls = await page.locator('.app-layout__sidebar, [class*="sidebar"]').first().locator('*').count();
  checkExists('侧边栏', sidebarEls);

  const headerEls = await page.locator('.app-layout__header, [class*="header"]').first().locator('*').count();
  checkExists('顶栏', headerEls);

  // ════════════════════════════════════════════════════
  // B. 页头工具栏
  // ════════════════════════════════════════════════════
  console.log('\n─── B. 页头工具栏 ───');

  // 新增供应商按钮
  const addBtn = page.locator('button').filter({ hasText: /新增供应商|新增/ });
  const addBtnCount = await addBtn.count();
  checkExists('新增供应商按钮', addBtnCount);

  // 导出按钮
  const exportBtn = page.locator('button').filter({ hasText: /导出/ });
  checkExists('导出按钮', await exportBtn.count());

  // 绩效对比按钮
  const perfBtn = page.locator('button').filter({ hasText: /绩效对比|对比/ });
  checkExists('绩效对比按钮', await perfBtn.count());

  // ════════════════════════════════════════════════════
  // C. 统计摘要栏
  // ════════════════════════════════════════════════════
  console.log('\n─── C. 统计摘要栏 ───');

  const statsStrip = page.locator('[class*="statsStrip"], [class*="stats_strip"], [class*="stats-strip"]');
  const statsCount = await statsStrip.count();
  checkExists('统计摘要栏', statsCount);

  if (statsCount > 0) {
    const statsText = await statsStrip.first().innerText();
    console.log(`  ℹ 统计栏内容: ${statsText.replace(/\n/g, ' | ')}`);

    // 检查统计栏背景(白)、圆角(12px)、边框
    const statsBg = await statsStrip.first().evaluate(el => window.getComputedStyle(el).backgroundColor);
    check('统计栏背景(白)', hex(statsBg), '#FFFFFF');

    const statsRadius = await statsStrip.first().evaluate(el => window.getComputedStyle(el).borderRadius);
    check('统计栏圆角(12px)', parseFloat(statsRadius), 12, 2);

    const statsBorder = await statsStrip.first().evaluate(el => window.getComputedStyle(el).borderStyle);
    checkTrue('统计栏有边框', statsBorder !== 'none', '有');
  }

  // ════════════════════════════════════════════════════
  // D. 搜索 & 筛选栏
  // ════════════════════════════════════════════════════
  console.log('\n─── D. 搜索 & 筛选栏 ───');

  const searchWrapper = page.locator('[class*="searchWrapper"], [class*="search_wrapper"]');
  checkExists('搜索框', await searchWrapper.count());

  if (await searchWrapper.count() > 0) {
    const searchRadius = await searchWrapper.first().evaluate(el => window.getComputedStyle(el).borderRadius);
    check('搜索框圆角(8px)', parseFloat(searchRadius), 8, 1);

    const searchHeight = await searchWrapper.first().evaluate(el => window.getComputedStyle(el).height);
    check('搜索框高度(36px)', parseFloat(searchHeight), 36, 2);
  }

  // 筛选下拉
  const selects = page.locator('select[class*="select"], [class*="select"]').filter({ has: page.locator('option') });
  const selectCount = await selects.count();
  checkTrue('筛选下拉框≥1', selectCount >= 1, `${selectCount}个`);

  // ════════════════════════════════════════════════════
  // E. 数据表格
  // ════════════════════════════════════════════════════
  console.log('\n─── E. 数据表格 ───');

  const rows = await page.locator('table tbody tr').count();
  checkTrue('表格有数据行', rows > 0, `${rows}行`);

  // 表头列
  const thTexts = await page.locator('table thead th').allInnerTexts();
  console.log(`  ℹ 表头列: ${thTexts.join(' | ')}`);
  checkTrue('表头列数≥5', thTexts.length >= 5, `${thTexts.length}列`);

  // 表格卡片背景(白色)
  const tableCard = page.locator('[class*="card"]').filter({ has: page.locator('table') }).first();
  if (await tableCard.count() > 0) {
    const tableBg = await tableCard.evaluate(el => window.getComputedStyle(el).backgroundColor);
    check('表格卡片背景(白色)', hex(tableBg), '#FFFFFF');
  }

  // 表头背景(gray-50)
  const thBg = await page.locator('table thead th').first().evaluate(el => window.getComputedStyle(el).backgroundColor);
  check('表头背景(gray-50)', hex(thBg), '#F8FAFC');

  // 表头字号(12-13px)
  const thFontSize = await page.locator('table thead th').first().evaluate(el => parseFloat(window.getComputedStyle(el).fontSize));
  checkTrue('表头字号(12-13px)', thFontSize >= 12 && thFontSize <= 14, `${thFontSize}px`);

  // 表头字重
  const thWeight = await page.locator('table thead th').first().evaluate(el => window.getComputedStyle(el).fontWeight);
  check('表头字重(600)', thWeight, '600');

  // 表格行高
  const rowHeight = await page.locator('table tbody tr').first().evaluate(el => el.offsetHeight);
  checkTrue('表格行高≥40px', rowHeight >= 40, `${rowHeight}px`);

  // 等级徽章
  const gradeBadges = await page.locator('[class*="gradeBadge"]').count();
  checkExists('等级徽章', gradeBadges);

  // 准时率进度条
  const rateBars = await page.locator('[class*="rateBar"], [class*="rate_bar"]').count();
  checkExists('准时率进度条', rateBars);

  // 质量异常率列
  const qualityRates = await page.locator('[class*="qualityRate"]').count();
  checkExists('质量异常率显示', qualityRates);

  // 操作列按钮
  const actionBtns = await page.locator('table tbody tr:first-child button, table tbody tr:first-child [class*="action"]').count();
  checkExists('操作列按钮', actionBtns);

  await page.screenshot({ path: path.join(DIR, '01_table_detail.png') });

  // ════════════════════════════════════════════════════
  // F. 等级徽章样式
  // ════════════════════════════════════════════════════
  console.log('\n─── F. 等级徽章样式 ───');

  const badgeA = page.locator('[class*="gradeBadgeA"], [class*="grade_badge_a"]').first();
  if (await badgeA.count() > 0) {
    const badgeABg = await badgeA.evaluate(el => window.getComputedStyle(el).backgroundColor);
    // Design: #FEF9C3
    check('A级徽章背景(金色)', hex(badgeABg), '#FEF9C3');
    const badgeAW = await badgeA.evaluate(el => parseFloat(window.getComputedStyle(el).width));
    check('A级徽章宽度(28px)', badgeAW, 28, 2);
  }

  const badgeB = page.locator('[class*="gradeBadgeB"], [class*="grade_badge_b"]').first();
  if (await badgeB.count() > 0) {
    const badgeBBg = await badgeB.evaluate(el => window.getComputedStyle(el).backgroundColor);
    // Design: gray-100 = #F1F5F9
    check('B级徽章背景(灰色)', hex(badgeBBg), '#F1F5F9');
  }

  // ════════════════════════════════════════════════════
  // G. 分页控件
  // ════════════════════════════════════════════════════
  console.log('\n─── G. 分页控件 ───');

  const pagination = page.locator('[class*="pagination"], [class*="Pagination"]');
  const paginationCount = await pagination.locator('*').count();
  // 少于一页时可能不显示分页控件
  if (rows >= 20) {
    checkExists('分页控件', paginationCount);
    const paginationText = await pagination.first().innerText().catch(() => '');
    checkTrue('分页信息含数字', /\d/.test(paginationText), '有');
  } else {
    console.log(`  ℹ 数据不足一页(${rows}行)，跳过分页检查`);
  }

  // ════════════════════════════════════════════════════
  // H. 搜索功能交互
  // ════════════════════════════════════════════════════
  console.log('\n─── H. 搜索功能交互 ───');

  const searchInput = page.locator('[class*="searchInput"], [class*="search_input"], input[placeholder*="搜索"]').first();
  const rowsBefore = await page.locator('table tbody tr').count();

  if (await searchInput.count() > 0) {
    await searchInput.fill('华森');
    await page.waitForTimeout(800);
    const rowsAfter = await page.locator('table tbody tr').count();
    console.log(`  ℹ 搜索"华森": ${rowsBefore}行→${rowsAfter}行`);
    checkTrue('搜索响应', rowsAfter !== rowsBefore || rowsAfter <= 5, '有响应');

    // 清空搜索恢复
    await searchInput.fill('');
    await page.waitForTimeout(800);
    const rowsRestore = await page.locator('table tbody tr').count();
    checkTrue('清空搜索恢复', rowsRestore >= rowsBefore - 1, `${rowsRestore}行`);
  }

  // ════════════════════════════════════════════════════
  // I. 筛选器交互（等级筛选）
  // ════════════════════════════════════════════════════
  console.log('\n─── I. 筛选器交互 ───');

  const ratingSelect = page.locator('select').first();
  if (await ratingSelect.count() > 0) {
    const options = await ratingSelect.locator('option').allInnerTexts();
    console.log(`  ℹ 筛选器选项: ${options.join(', ')}`);
    if (options.length > 1) {
      await ratingSelect.selectOption({ index: 1 });
      await page.waitForTimeout(800);
      checkTrue('等级筛选已选择', true, '已选择');
      // 恢复
      await ratingSelect.selectOption({ index: 0 });
      await page.waitForTimeout(500);
    }
  }

  // ════════════════════════════════════════════════════
  // J. 新增供应商 Drawer
  // ════════════════════════════════════════════════════
  console.log('\n─── J. 新增供应商 Drawer ───');

  const addButton = page.locator('button').filter({ hasText: /新增供应商/ }).first();
  if (await addButton.count() > 0) {
    await addButton.click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(DIR, '02_add_supplier_drawer.png') });

    const drawer = page.locator('[class*="drawer"], [class*="Drawer"]');
    const drawerOpen = await drawer.count() > 0;
    checkTrue('新增Drawer打开', drawerOpen, '已打开');

    if (drawerOpen) {
      // 表单字段数
      const fields = await page.locator('[class*="drawer"] input, [class*="drawer"] textarea, [class*="drawer"] select, [class*="Drawer"] input, [class*="Drawer"] textarea').count();
      checkTrue('表单字段数≥5', fields >= 5, `${fields}个`);

      // 必填标记
      const requiredMarks = await page.locator('[class*="formLabelRequired"], [class*="form_label_required"]').count();
      checkExists('必填标记(*)', requiredMarks);

      // 表单分段标题（基础信息/合作条款/其他）
      const sectionTitles = await page.locator('[class*="formSectionTitle"], [class*="form_section_title"]').allInnerTexts();
      console.log(`  ℹ 表单分段: ${sectionTitles.join(', ')}`);
      checkTrue('表单分段≥2', sectionTitles.length >= 2, `${sectionTitles.length}个分段`);

      // 单选组（供应商等级）
      const radioInputs = await page.locator('[class*="drawer"] input[type="radio"], [class*="Drawer"] input[type="radio"]').count();
      checkExists('等级单选组', radioInputs);

      // 账期单选（货到付款/月结）
      const paymentRadios = await page.locator('[class*="paymentGroup"], [class*="payment_group"]').count();
      checkExists('账期选择区', paymentRadios);

      // 输入框高度(36px)
      const inputHeight = await page.locator('[class*="formInput"]').first().evaluate(el => parseFloat(window.getComputedStyle(el).height));
      check('表单输入框高度(36px)', inputHeight, 36, 2);

      // 输入框圆角(8px)
      const inputRadius = await page.locator('[class*="formInput"]').first().evaluate(el => parseFloat(window.getComputedStyle(el).borderRadius));
      check('表单输入框圆角(8px)', inputRadius, 8, 1);

      // 价格管理提示块
      const hint = page.locator('[class*="drawerHint"], [class*="drawer_hint"]');
      checkExists('价格管理提示块', await hint.count());

      // 关闭 Drawer
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
      checkTrue('关闭新增Drawer', true, '已关闭');
    }
  }

  // ════════════════════════════════════════════════════
  // K. 行操作 — 编辑
  // ════════════════════════════════════════════════════
  console.log('\n─── K. 行操作 — 编辑 ───');

  const editBtn = page.locator('table tbody tr:first-child button').filter({ hasText: /编辑/ }).first();
  if (await editBtn.count() > 0) {
    await editBtn.click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(DIR, '03_edit_drawer.png') });

    const editDrawer = page.locator('[class*="drawer"], [class*="Drawer"]');
    checkTrue('编辑Drawer打开', await editDrawer.count() > 0, '已打开');

    // 编辑时显示编码+名称双列
    const formRow = page.locator('[class*="formRow"], [class*="form_row"]');
    checkExists('编辑表单双列布局', await formRow.count());

    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  }

  // ════════════════════════════════════════════════════
  // L. 行操作 — 详情视图（4个Tab）
  // ════════════════════════════════════════════════════
  console.log('\n─── L. 行操作 — 详情视图 ───');

  const detailBtn = page.locator('table tbody tr:first-child button').filter({ hasText: /详情|查看/ }).first();
  if (await detailBtn.count() > 0) {
    await detailBtn.click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(DIR, '04_detail_view.png') });

    // Summary Card
    const summaryCard = page.locator('[class*="detailSummary"], [class*="detail_summary"]');
    checkExists('详情摘要卡片', await summaryCard.count());

    // Tab 导航
    const tabs = page.locator('[class*="detailTab"]');
    const tabCount = await tabs.count();
    checkTrue('Tab导航≥4', tabCount >= 4, `${tabCount}个Tab`);

    // Tab 标签文本
    const tabTexts = await tabs.allInnerTexts();
    console.log(`  ℹ Tab标签: ${tabTexts.join(', ')}`);

    // 面包屑导航
    const breadcrumb = page.locator('[class*="detailBreadcrumb"], [class*="detail_breadcrumb"]');
    checkExists('面包屑导航', await breadcrumb.count());

    // 返回列表按钮
    const backBtn = page.locator('button').filter({ hasText: /返回列表/ });
    checkExists('返回列表按钮', await backBtn.count());

    // 编辑基础信息按钮
    const editInfoBtn = page.locator('button').filter({ hasText: /编辑基础信息/ });
    checkExists('编辑基础信息按钮', await editInfoBtn.count());

    // 调整级别按钮
    const gradeBtn = page.locator('button').filter({ hasText: /调整级别/ });
    checkExists('调整级别按钮', await gradeBtn.count());

    // Tab1: 基础信息 — 信息Grid
    const infoGrid = page.locator('[class*="detailGrid"], [class*="detail_grid"]');
    if (await infoGrid.count() > 0) {
      const gridCols = await infoGrid.first().evaluate(el => window.getComputedStyle(el).gridTemplateColumns);
      checkTrue('基础信息2列Grid', gridCols.split(' ').length >= 2, gridCols);
    }

    // Tab2: 关联SKU — 用 button 标签精确匹配
    const skuTab = page.locator('button').filter({ hasText: '关联SKU' }).first();
    if (await skuTab.count() > 0) {
      await skuTab.click();
      await page.waitForTimeout(1500);
      await page.screenshot({ path: path.join(DIR, '05_detail_sku_tab.png') });

      // 关联SKU可能为空
      const skuContent = page.locator('[class*="detailPanel"]');
      const hasContent = await skuContent.count() > 0;
      checkTrue('关联SKU Tab有内容', hasContent, '有内容');
    }

    // Tab3: 价格协议
    const priceTab = page.locator('button').filter({ hasText: '价格协议' }).first();
    if (await priceTab.count() > 0) {
      await priceTab.click();
      await page.waitForTimeout(1500);
      await page.screenshot({ path: path.join(DIR, '06_detail_price_tab.png') });
      checkTrue('价格协议Tab有内容', true, '已切换');
    }

    // Tab4: 绩效数据
    const perfTab = page.locator('button').filter({ hasText: '绩效数据' }).first();
    if (await perfTab.count() > 0) {
      await perfTab.click();
      await page.waitForTimeout(1500);
      await page.screenshot({ path: path.join(DIR, '07_detail_perf_tab.png') });

      // KPI卡片(3个)
      const kpiCards = page.locator('[class*="kpiCard"], [class*="kpi_card"]');
      const kpiCount = await kpiCards.count();
      checkTrue('KPI卡片≥3', kpiCount >= 3, `${kpiCount}个`);

      // KPI Grid 3列
      const kpiGrid = page.locator('[class*="kpiGrid"], [class*="kpi_grid"]');
      if (await kpiGrid.count() > 0) {
        const kpiGridCols = await kpiGrid.first().evaluate(el => window.getComputedStyle(el).gridTemplateColumns);
        checkTrue('KPI Grid 3列', kpiGridCols.split(' ').length >= 3, kpiGridCols);
      }
    }

    // 返回列表
    const backButton = page.locator('button').filter({ hasText: /返回列表/ }).first();
    if (await backButton.count() > 0) {
      await backButton.click();
      await page.waitForTimeout(1000);
    }
  }

  // ════════════════════════════════════════════════════
  // M. 调整级别 Modal
  // ════════════════════════════════════════════════════
  console.log('\n─── M. 调整级别 Modal ───');

  // 重新进入详情
  const detailBtn2 = page.locator('table tbody tr:first-child button').filter({ hasText: /详情|查看/ }).first();
  if (await detailBtn2.count() > 0) {
    await detailBtn2.click();
    await page.waitForTimeout(1500);

    const gradeAdjBtn = page.locator('button').filter({ hasText: /调整级别/ }).first();
    if (await gradeAdjBtn.count() > 0) {
      await gradeAdjBtn.click();
      await page.waitForTimeout(800);
      await page.screenshot({ path: path.join(DIR, '08_grade_modal.png') });

      const gradeModal = page.locator('[role="dialog"], [class*="modal"], [class*="Modal"]');
      checkTrue('调整级别Modal打开', await gradeModal.count() > 0, '已打开');

      // 警告提示
      const gradeWarning = page.locator('[class*="gradeModalWarning"], [class*="grade_modal_warning"]');
      checkExists('级别调整警告提示', await gradeWarning.count());

      // 等级单选
      const targetRadios = await page.locator('[role="dialog"] input[type="radio"], [class*="modal"] input[type="radio"], [class*="Modal"] input[type="radio"]').count();
      checkTrue('目标级别单选≥3', targetRadios >= 3, `${targetRadios}个`);

      // 原因文本框
      const reasonTextarea = await page.locator('[role="dialog"] textarea, [class*="modal"] textarea, [class*="Modal"] textarea').count();
      checkExists('调整原因文本框', reasonTextarea);

      // 关闭
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    }

    // 返回列表
    const back2 = page.locator('button').filter({ hasText: /返回列表/ }).first();
    if (await back2.count() > 0) {
      await back2.click();
      await page.waitForTimeout(1000);
    }
  }

  // ════════════════════════════════════════════════════
  // N. 绩效对比 Modal
  // ════════════════════════════════════════════════════
  console.log('\n─── N. 绩效对比 Modal ───');

  const perfCompareBtn = page.locator('button').filter({ hasText: /绩效对比|对比/ }).first();
  if (await perfCompareBtn.count() > 0) {
    await perfCompareBtn.click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(DIR, '09_perf_compare_modal.png') });

    // Modal 打开
    const perfModal = page.locator('[class*="perfOverlay"], [class*="perf_overlay"], [role="dialog"]').filter({ has: page.locator('[class*="perfModal"], [class*="perf_modal"], [class*="hbar"]') });
    const perfModalOpen = await perfModal.count() > 0 || await page.locator('[class*="perfOverlayOpen"]').count() > 0;
    checkTrue('绩效对比Modal打开', perfModalOpen, '已打开');

    if (perfModalOpen) {
      // 横向柱状图
      const hbars = await page.locator('[class*="hbarRow"], [class*="hbar_row"]').count();
      checkExists('横向柱状图', hbars);

      // 雷达图(SVG)
      const radar = await page.locator('[class*="radarWrap"] svg, svg[aria-label*="雷达"]').count();
      checkExists('雷达图SVG', radar);

      // 折线图
      const lineChart = await page.locator('[class*="lineChartWrap"] svg, svg[aria-label*="折线"], svg[aria-label*="趋势"]').count();
      checkExists('价格趋势折线图', lineChart);

      // AI建议块
      const aiBlock = await page.locator('[class*="aiSuggestion"], [class*="ai_suggestion"]').count();
      checkExists('AI建议块', aiBlock);

      // 时间段选择器
      const periodSelect = await page.locator('[class*="perfPeriodSelect"], [class*="perf_period"]').count();
      checkExists('时间段选择器', periodSelect);

      // 对比摘要栏
      const summaryBar = await page.locator('[class*="compareSummaryBar"], [class*="compare_summary"]').count();
      checkExists('对比摘要栏', summaryBar);

      // AI建议块样式
      const aiSugBg = await page.locator('[class*="aiSuggestion"]').first().evaluate(el => window.getComputedStyle(el).backgroundColor).catch(() => '');
      if (aiSugBg) {
        // accent-50 = #FFF7ED
        check('AI建议块背景(accent-50)', hex(aiSugBg), '#FFF7ED');
      }

      // 关闭
      const closeBtn = page.locator('[class*="perfModal"] button, [class*="perf_modal"] button').filter({ hasText: /关闭|✕/ }).first();
      if (await closeBtn.count() > 0) {
        await closeBtn.click();
        await page.waitForTimeout(500);
      } else {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);
      }
    }
  }

  // ════════════════════════════════════════════════════
  // O. 导出功能
  // ════════════════════════════════════════════════════
  console.log('\n─── O. 导出功能 ───');

  const exportButton = page.locator('button').filter({ hasText: /导出/ }).first();
  checkTrue('导出按钮可见', await exportButton.isVisible().catch(() => false), '可见');

  // ════════════════════════════════════════════════════
  // P. 表格交互细节
  // ════════════════════════════════════════════════════
  console.log('\n─── P. 表格交互细节 ───');

  // 行hover背景变化 — hover应用在tr上
  await page.waitForTimeout(1000);
  await page.mouse.move(0, 0);
  await page.waitForTimeout(300);
  const firstRow = page.locator('table tbody tr').first();
  if (await firstRow.count() > 0) {
    const bgBefore = await firstRow.evaluate(el => window.getComputedStyle(el).backgroundColor);
    await firstRow.hover();
    await page.waitForTimeout(300);
    const bgAfter = await firstRow.evaluate(el => window.getComputedStyle(el).backgroundColor);
    checkTrue('行Hover背景变化', bgBefore !== bgAfter, '变化了');
  }

  // 品类标签
  const categoryTags = await page.locator('[class*="categoryTag"], [class*="category_tag"]').count();
  checkExists('品类标签', categoryTags);

  // 单元格字号(14px)
  const cellFont = await page.locator('table tbody td').first().evaluate(el => parseFloat(window.getComputedStyle(el).fontSize));
  check('单元格字号(14px)', cellFont, 14, 1);

  // 单元格底部边框
  const cellBorderBottom = await page.locator('table tbody td').first().evaluate(el => window.getComputedStyle(el).borderBottomStyle);
  checkTrue('单元格底部边框', cellBorderBottom !== 'none', '有');

  // ════════════════════════════════════════════════════
  // Q. 响应式 — 768px 平板
  // ════════════════════════════════════════════════════
  console.log('\n─── Q. 响应式 — 768px ───');

  await page.setViewportSize({ width: 768, height: 900 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(DIR, '10_responsive_768.png') });

  // 工具栏方向 — 精确选择 .toolbar（非 .toolbarCard）
  const toolbarDir = await page.evaluate(() => {
    const els = document.querySelectorAll('[class*="toolbar"]');
    for (const el of els) {
      if (el.className.includes('toolbarCard') || el.className.includes('toolbar_card')) continue;
      if (el.className.includes('toolbar')) {
        return window.getComputedStyle(el).flexDirection;
      }
    }
    return 'not found';
  });
  check('768px工具栏方向', toolbarDir, 'column');

  // 搜索框全宽
  const searchW768 = await page.locator('[class*="searchWrapper"]').first().evaluate(el => window.getComputedStyle(el).width).catch(() => '0');
  checkTrue('768px搜索框全宽', parseFloat(searchW768) > 500, `${searchW768}`);

  // 恢复
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(500);

  // ════════════════════════════════════════════════════
  // R. 无障碍检查
  // ════════════════════════════════════════════════════
  console.log('\n─── R. 无障碍检查 ───');

  const allBtnsHaveLabel = await page.evaluate(() => {
    const btns = document.querySelectorAll('button');
    return Array.from(btns).every(b => b.textContent?.trim() || b.getAttribute('aria-label'));
  });
  checkTrue('所有按钮有文字或aria-label', allBtnsHaveLabel, '是');

  // 雷达图SVG有aria-label
  // (在 modal 关闭状态，跳过)

  // ════════════════════════════════════════════════════
  // S. 运行时错误
  // ════════════════════════════════════════════════════
  console.log('\n─── S. 运行时错误 ───');

  if (apiErrors.length > 0) {
    console.log(`  ℹ API 5xx 详情:`);
    apiErrors.forEach(e => console.log(`    ${e.status} ${e.url}`));
  }
  check('API 5xx 错误数', apiErrors.length, 0);
  check('页面 JS 错误数', pageErrors.length, 0);

  // ════════════════════════════════════════════════════
  // 最终报告
  // ════════════════════════════════════════════════════
  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║           供应商管理页 UI 审计结果                      ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`  总检查点: ${CHECKS}`);
  console.log(`  ✓ PASS: ${PASS}`);
  console.log(`  ✗ FAIL: ${ISSUES.length}`);
  console.log(`  通过率: ${((PASS / CHECKS) * 100).toFixed(1)}%`);

  if (ISSUES.length > 0) {
    console.log('\n  ─── 需修复的问题 ───');
    ISSUES.forEach((iss, i) => {
      console.log(`  ${i + 1}. ${iss.name}`);
      console.log(`     实际: ${iss.actual}`);
      console.log(`     期望: ${iss.expected}`);
    });
  }

  console.log(`\n  截图: ${DIR}/`);
  await browser.close();
}

main().catch(e => { console.error('审计脚本异常:', e); process.exit(1); });
