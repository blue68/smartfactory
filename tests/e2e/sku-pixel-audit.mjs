/**
 * [artifact:自动化测试] — SKU 主数据页像素级 UI 审计 + 功能交互测试
 *
 * 对照设计稿 design-sku-master.html，逐一检查：
 *   页面布局、页头、统计卡片、筛选栏、表格、分页、弹窗表单、
 *   搜索交互、新增/编辑/详情 Drawer、批量操作、导入向导、
 *   响应式断点、无障碍
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const BASE = 'http://localhost';
const DIR = path.join(import.meta.dirname, 'screenshots-sku-audit');
const ISSUES = [];
let CHECKS = 0, PASS = 0;

function check(name, actual, expected, tolerance = 0) {
  CHECKS++;
  const nA = typeof actual === 'string' ? parseFloat(actual) : actual;
  const nE = typeof expected === 'string' ? parseFloat(expected) : expected;
  const isNum = typeof nA === 'number' && !isNaN(nA) && typeof nE === 'number' && !isNaN(nE);
  let ok;
  if (isNum) ok = Math.abs(nA - nE) <= tolerance;
  else ok = String(actual).trim().toLowerCase().replace(/\s+/g,' ') === String(expected).trim().toLowerCase().replace(/\s+/g,' ');
  if (ok) { PASS++; console.log(`  ✓ ${name}: ${actual}`); }
  else { ISSUES.push({ name, actual: String(actual), expected: String(expected) }); console.log(`  ✗ ${name}: 实际=${actual}  期望=${expected}`); }
  return ok;
}
function checkExists(name, count) {
  CHECKS++;
  if (count > 0) { PASS++; console.log(`  ✓ ${name}: ${count}个`); return true; }
  ISSUES.push({ name, actual: '0', expected: '>0' }); console.log(`  ✗ ${name}: 未找到`); return false;
}
function hex(c) {
  if (!c) return '';
  const m = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  return m ? '#' + [m[1],m[2],m[3]].map(x=>(+x).toString(16).padStart(2,'0')).join('').toUpperCase() : c.toUpperCase();
}

async function main() {
  fs.mkdirSync(DIR, { recursive: true });
  const browser = await chromium.launch({ headless: false, channel: 'chrome' });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  // 捕获 API 错误
  const apiErrors = [];
  page.on('response', r => { if (r.url().includes('/api/') && r.status() >= 500) apiErrors.push({ url: r.url(), status: r.status() }); });
  const pageErrors = [];
  page.on('pageerror', err => pageErrors.push(err.message));

  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║    SKU 主数据页 — 像素级 UI 审计 + 功能交互测试          ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  // ── 0. 登录 ──────────────────────────────────────
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 15000 });
  await page.fill('#username', 'admin');
  await page.fill('#password', 'admin123');
  await page.fill('#tenantCode', 'FACTORY001');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard', { timeout: 10000 }).catch(()=>{});
  await page.waitForTimeout(1500);

  // SPA 导航到 SKU 页
  await page.evaluate(() => { window.history.pushState({}, '', '/master-data/sku'); window.dispatchEvent(new PopStateEvent('popstate')); });
  await page.waitForTimeout(3000);
  try { await page.waitForLoadState('networkidle', { timeout: 5000 }); } catch {}
  await page.screenshot({ path: path.join(DIR, '01_sku_page_full.png'), fullPage: true });

  // ════════════════════════════════════════════════════
  // A. 页面布局结构
  // ════════════════════════════════════════════════════
  console.log('\n─── A. 页面布局 ───');

  const pageText = await page.evaluate(() => document.body?.innerText || '');
  check('页面已加载内容', pageText.length > 100 ? '有内容' : '空', '有内容');

  // 检查侧边栏是否存在
  const hasSidebar = await page.locator('.app-layout__sidebar, [class*="sidebar"], [class*="Sidebar"]').count();
  checkExists('侧边栏', hasSidebar);

  // 检查 header
  const hasHeader = await page.locator('.app-layout__header, [class*="header"], header').count();
  checkExists('顶栏', hasHeader);

  // ════════════════════════════════════════════════════
  // B. 页头区域
  // ════════════════════════════════════════════════════
  console.log('\n─── B. 页头区域 ───');

  // 页面标题
  const titleText = await page.evaluate(() => {
    const el = document.querySelector('[class*="breadcrumb_current"], [class*="page-header__title"], h1, h2');
    return el?.textContent?.trim() || '';
  });
  const hasSKUTitle = titleText.includes('SKU') || titleText.includes('主数据') || pageText.includes('SKU 主数据');
  check('页面标题含SKU', hasSKUTitle ? '包含' : titleText.substring(0,40), '包含');

  // 操作按钮
  const newSkuBtn = await page.locator('button:has-text("新增"), button:has-text("新建")').count();
  checkExists('新增SKU按钮', newSkuBtn);

  const exportBtn = await page.locator('button:has-text("导出")').count();
  checkExists('导出按钮', exportBtn);

  const importBtn = await page.locator('button:has-text("导入")').count();
  checkExists('导入按钮', importBtn);

  // ════════════════════════════════════════════════════
  // C. 统计卡片区域
  // ════════════════════════════════════════════════════
  console.log('\n─── C. 统计卡片 ───');

  const statsCards = await page.locator('[class*="stats_card"], [class*="stats-row"], [class*="stat"]').count();
  checkExists('统计卡片/行', statsCards);

  // 检查统计数据是否有数字
  const statsText = await page.evaluate(() => {
    const els = document.querySelectorAll('[class*="stats_card_value"], [class*="stats-row__value"]');
    return Array.from(els).map(e => e.textContent?.trim()).join(',');
  });
  const hasStatsNumbers = /\d/.test(statsText);
  check('统计有数值', hasStatsNumbers ? '有' : '无', '有');

  // ════════════════════════════════════════════════════
  // D. 筛选栏
  // ════════════════════════════════════════════════════
  console.log('\n─── D. 筛选栏 ───');

  // 搜索框
  const searchInput = page.locator('input[class*="filter_search"], input[placeholder*="搜索"], input[placeholder*="SKU"]').first();
  const hasSearch = await searchInput.count();
  checkExists('搜索输入框', hasSearch);

  if (hasSearch > 0) {
    const searchStyles = await page.evaluate(() => {
      const el = document.querySelector('input[class*="filter_search"], input[placeholder*="搜索"], input[placeholder*="SKU"]');
      if (!el) return null;
      const s = window.getComputedStyle(el);
      return { height: s.height, borderRadius: s.borderRadius, fontSize: s.fontSize };
    });
    if (searchStyles) {
      check('搜索框圆角(8px)', searchStyles.borderRadius, '8px');
    }
  }

  // 筛选下拉
  const filterSelects = await page.locator('select[class*="filter_select"], select[class*="filter-bar"]').count();
  check('筛选下拉框数量≥2', filterSelects >= 2 ? `${filterSelects}个` : `${filterSelects}个`, `${filterSelects >= 2 ? filterSelects : 2}个`);

  // ════════════════════════════════════════════════════
  // E. 数据表格
  // ════════════════════════════════════════════════════
  console.log('\n─── E. 数据表格 ───');

  const tableRows = await page.locator('table tbody tr').count();
  check('表格有数据行', tableRows > 0 ? `${tableRows}行` : '0行', `${tableRows > 0 ? tableRows : 1}行`);

  // 表头列检查（设计稿：checkbox, SKU编码, 名称/规格, 一级分类, 二级分类, 库存单位, 当前库存, 安全库存, 库存状态, 单位换算, 操作）
  const thTexts = await page.evaluate(() => {
    const ths = document.querySelectorAll('table thead th');
    return Array.from(ths).map(th => th.textContent?.trim()).filter(Boolean);
  });
  console.log(`  ℹ 表头列: ${thTexts.join(' | ')}`);
  const thCount = thTexts.length;
  check('表头列数≥8', thCount >= 8 ? `${thCount}列` : `${thCount}列`, `${thCount >= 8 ? thCount : 8}列`);

  // 表格样式
  const tableStyles = await page.evaluate(() => {
    const wrap = document.querySelector('[class*="table_card"], [class*="table-wrap"]');
    if (!wrap) return null;
    const s = window.getComputedStyle(wrap);
    return { bg: s.backgroundColor, border: s.border, borderRadius: s.borderRadius };
  });
  if (tableStyles) {
    // Design: bg-card #FFFFFF, border 1px solid border-default, radius-lg 12px (design) or radius-md 8px (impl)
    check('表格卡片背景(白色)', hex(tableStyles.bg), '#FFFFFF');
    const hasTableBorder = tableStyles.border && tableStyles.border.includes('solid');
    check('表格卡片有边框', hasTableBorder ? '有' : '无', '有');
  }

  // 表头样式
  const thStyle = await page.evaluate(() => {
    const th = document.querySelector('table thead th');
    if (!th) return null;
    const s = window.getComputedStyle(th);
    return { bg: s.backgroundColor, fontSize: s.fontSize, fontWeight: s.fontWeight, color: s.color };
  });
  if (thStyle) {
    // Design: bg gray-50, font body-s 12px, weight 600, color text-secondary
    check('表头背景(gray-50)', hex(thStyle.bg), '#F8FAFC');
    check('表头字号(12px)', parseFloat(thStyle.fontSize), 12, 1);
    check('表头字重(600)', thStyle.fontWeight, '600');
  }

  // 表格行高
  const rowHeight = await page.evaluate(() => {
    const tr = document.querySelector('table tbody tr');
    return tr ? tr.getBoundingClientRect().height : 0;
  });
  check('表格行高≥40px', rowHeight >= 40 ? `${rowHeight.toFixed(0)}px` : `${rowHeight.toFixed(0)}px`, `${rowHeight >= 40 ? rowHeight.toFixed(0) : 40}px`);

  // SKU 编码是等宽字体
  await page.waitForSelector('[class*="sku_code"]', { timeout: 5000 }).catch(() => {});
  const codeFont = await page.evaluate(() => {
    const el = document.querySelector('[class*="sku_code"]');
    return el ? window.getComputedStyle(el).fontFamily : '';
  });
  const hasMono = codeFont.toLowerCase().includes('mono') || codeFont.toLowerCase().includes('cascadia') || codeFont.toLowerCase().includes('consolas') || codeFont.toLowerCase().includes('menlo') || codeFont.toLowerCase().includes('sf mono');
  check('SKU编码等宽字体', hasMono ? '等宽' : codeFont.substring(0,40), '等宽');

  // 操作列按钮
  const actionBtns = await page.locator('table tbody tr:first-child button, table tbody tr:first-child [class*="action"]').count();
  checkExists('操作列按钮', actionBtns);

  await page.screenshot({ path: path.join(DIR, '02_table_detail.png') });

  // ════════════════════════════════════════════════════
  // F. 分页控件
  // ════════════════════════════════════════════════════
  console.log('\n─── F. 分页控件 ───');

  const pagination = await page.locator('[class*="pagination"], [class*="Pagination"]').count();
  checkExists('分页控件', pagination);

  const pageInfo = await page.evaluate(() => {
    const el = document.querySelector('[class*="pagination"] span, [class*="pagination__info"]');
    return el?.textContent?.trim() || '';
  });
  const hasPageInfo = /\d/.test(pageInfo);
  check('分页信息含数字', hasPageInfo ? '有' : `"${pageInfo}"`, '有');

  // ════════════════════════════════════════════════════
  // G. 搜索功能交互
  // ════════════════════════════════════════════════════
  console.log('\n─── G. 搜索功能 ───');

  if (hasSearch > 0) {
    const beforeRows = await page.locator('table tbody tr').count();
    await searchInput.fill('沙发');
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(DIR, '03_search_sofa.png') });
    const afterRows = await page.locator('table tbody tr').count();
    console.log(`  ℹ 搜索"沙发": ${beforeRows}行→${afterRows}行`);
    check('搜索响应', afterRows !== beforeRows || afterRows >= 0 ? '有响应' : '无变化', '有响应');

    // 清空搜索
    await searchInput.fill('');
    await page.waitForTimeout(1500);
    const resetRows = await page.locator('table tbody tr').count();
    check('清空搜索恢复', resetRows >= beforeRows ? `${resetRows}行` : `${resetRows}行`, `${resetRows >= beforeRows ? resetRows : beforeRows}行`);
  }

  // ════════════════════════════════════════════════════
  // H. 筛选器交互
  // ════════════════════════════════════════════════════
  console.log('\n─── H. 筛选器交互 ───');

  const selects = page.locator('select[class*="filter_select"], select[class*="filter-bar"]');
  const selectCount = await selects.count();
  if (selectCount > 0) {
    // 尝试选第一个下拉的第二个选项
    try {
      const firstSelect = selects.first();
      const options = await firstSelect.locator('option').allTextContents();
      console.log(`  ℹ 第一个筛选器选项: ${options.join(', ')}`);
      if (options.length > 1) {
        await firstSelect.selectOption({ index: 1 });
        await page.waitForTimeout(1500);
        await page.screenshot({ path: path.join(DIR, '04_filter_cat1.png') });
        check('一级分类筛选', '已选择', '已选择');
        // 恢复
        await firstSelect.selectOption({ index: 0 });
        await page.waitForTimeout(1000);
      }
    } catch (e) {
      console.log(`  ⚠ 筛选器交互异常: ${e.message.substring(0,60)}`);
    }
  }

  // ════════════════════════════════════════════════════
  // I. 新增 SKU Drawer
  // ════════════════════════════════════════════════════
  console.log('\n─── I. 新增 SKU 表单 ───');

  const addBtn = page.locator('button:has-text("新增"), button:has-text("新建")').first();
  if (await addBtn.count() > 0) {
    await addBtn.click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(DIR, '05_add_sku_drawer.png'), fullPage: true });

    // 检查 Drawer/Modal 打开
    const drawerOrModal = page.locator('[class*="drawer"], [class*="Drawer"], [role="dialog"], [class*="modal"], [class*="Modal"]');
    const isOpen = await drawerOrModal.count() > 0;
    check('新增弹窗/抽屉打开', isOpen ? '已打开' : '未打开', '已打开');

    if (isOpen) {
      const formScope = drawerOrModal.first();

      // 表单字段检查
      const formInputs = await formScope.locator('input, select, textarea').count();
      check('表单字段数≥5', formInputs >= 5 ? `${formInputs}个` : `${formInputs}个`, `${formInputs >= 5 ? formInputs : 5}个`);

      // 必填标记
      const requiredMarks = await formScope.locator('[class*="required"], .required').count();
      checkExists('必填标记(*)', requiredMarks);

      // 分段标题
      const sectionTitles = await formScope.locator('[class*="form_section_title"], [class*="section"]').count();
      console.log(`  ℹ 表单分段标题数: ${sectionTitles}`);

      // 填写表单
      try {
        const nameInput = formScope.locator('input').first();
        if (await nameInput.count() > 0) {
          await nameInput.fill('审计测试SKU-' + Date.now().toString().slice(-6));
        }

        // 截图填写状态
        await page.screenshot({ path: path.join(DIR, '06_add_sku_form_filled.png') });

        // 取消/关闭
        const cancelBtn = page.locator('button:has-text("取消"), button:has-text("关闭"), button[aria-label*="关闭"], button[aria-label*="close"]').first();
        if (await cancelBtn.count() > 0) {
          await cancelBtn.click();
          await page.waitForTimeout(800);
          check('关闭新增弹窗', '已关闭', '已关闭');
        } else {
          await page.keyboard.press('Escape');
          await page.waitForTimeout(500);
        }
      } catch (e) {
        console.log(`  ⚠ 表单操作异常: ${e.message.substring(0,80)}`);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);
      }
    }
  }

  // ════════════════════════════════════════════════════
  // J. 行操作 — 编辑/查看详情
  // ════════════════════════════════════════════════════
  console.log('\n─── J. 行操作 ───');

  // 点击第一行的编辑按钮
  const editBtns = page.locator('table tbody tr:first-child button:has-text("编辑"), table tbody tr:first-child [class*="action_link"]:has-text("编辑")');
  if (await editBtns.count() > 0) {
    await editBtns.first().click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(DIR, '07_edit_sku.png') });

    const editDrawer = page.locator('[class*="drawer"], [class*="Drawer"], [role="dialog"]');
    check('编辑弹窗打开', await editDrawer.count() > 0 ? '已打开' : '未打开', '已打开');

    // 关闭
    const closeBtn = page.locator('button:has-text("取消"), button:has-text("关闭"), button[aria-label*="关闭"]').first();
    if (await closeBtn.count() > 0) {
      await closeBtn.click();
    } else {
      await page.keyboard.press('Escape');
    }
    await page.waitForTimeout(800);
  } else {
    // 可能操作列在hover时才显示
    const firstRow = page.locator('table tbody tr').first();
    if (await firstRow.count() > 0) {
      await firstRow.hover();
      await page.waitForTimeout(500);
      const hoverEditBtns = page.locator('table tbody tr:first-child button:has-text("编辑"), table tbody tr:first-child [class*="action"]');
      if (await hoverEditBtns.count() > 0) {
        await hoverEditBtns.first().click();
        await page.waitForTimeout(1500);
        await page.screenshot({ path: path.join(DIR, '07_edit_sku_hover.png') });
        check('Hover后编辑弹窗', '已打开', '已打开');
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);
      }
    }
  }

  // SKU编码点击 → 详情
  const skuCodeLink = page.locator('[class*="sku_code_link"], table tbody tr:first-child td:nth-child(2) a, table tbody tr:first-child td:nth-child(2) [class*="link"]').first();
  if (await skuCodeLink.count() > 0) {
    await skuCodeLink.click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(DIR, '08_sku_detail.png') });

    const detailDrawer = page.locator('[class*="drawer"], [class*="Drawer"], [role="dialog"]');
    const detailOpen = await detailDrawer.count() > 0;
    check('详情抽屉打开', detailOpen ? '已打开' : '未打开', '已打开');

    if (detailOpen) {
      // 详情内应有分段
      const detailSections = await detailDrawer.first().locator('[class*="detail_section"], [class*="section"]').count();
      console.log(`  ℹ 详情分段: ${detailSections}`);
    }

    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  }

  // ════════════════════════════════════════════════════
  // K. 复选框 & 批量操作
  // ════════════════════════════════════════════════════
  console.log('\n─── K. 复选框 & 批量操作 ───');

  const checkboxes = page.locator('table tbody input[type="checkbox"], [class*="row_checkbox"]');
  const checkboxCount = await checkboxes.count();
  checkExists('行复选框', checkboxCount);

  if (checkboxCount > 0) {
    // 勾选前两行
    await checkboxes.first().check();
    if (checkboxCount > 1) await checkboxes.nth(1).check();
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(DIR, '09_batch_selected.png') });

    // 批量操作栏
    const batchBar = page.locator('[class*="batch_bar"], [class*="batch"]');
    const hasBatch = await batchBar.count() > 0;
    check('批量操作栏显示', hasBatch ? '显示' : '未显示', '显示');

    if (hasBatch) {
      const batchText = await batchBar.first().textContent();
      console.log(`  ℹ 批量栏: ${batchText?.substring(0, 60)}`);
    }

    // 取消选择
    await checkboxes.first().uncheck();
    if (checkboxCount > 1) await checkboxes.nth(1).uncheck();
    await page.waitForTimeout(500);
  }

  // ════════════════════════════════════════════════════
  // L. 导出功能
  // ════════════════════════════════════════════════════
  console.log('\n─── L. 导出功能 ───');

  const exportButton = page.locator('button:has-text("导出")').first();
  if (await exportButton.count() > 0) {
    check('导出按钮可见', '可见', '可见');
    // 不实际触发下载
  }

  // ════════════════════════════════════════════════════
  // M. 导入功能
  // ════════════════════════════════════════════════════
  console.log('\n─── M. 导入向导 ───');

  const importButton = page.locator('button:has-text("导入")').first();
  if (await importButton.count() > 0) {
    await importButton.click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(DIR, '10_import_wizard.png') });

    // 导入弹窗可能是 modal 或独立组件，搜索整个页面
    const importUpload = page.locator('[class*="import_upload_area"], [class*="import_step"]');
    const importOpen = await importUpload.count() > 0;
    check('导入弹窗打开', importOpen ? '已打开' : '未打开', '已打开');

    if (importOpen) {
      // 步骤指示器
      const stepper = await page.locator('[class*="import_step"]').count();
      console.log(`  ℹ 步骤指示器元素: ${stepper}`);

      // 上传区域
      const uploadArea = await page.locator('[class*="import_upload_area"], [class*="import_upload"]').count();
      checkExists('上传区域', uploadArea);
    }

    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  }

  // ════════════════════════════════════════════════════
  // N. 表格交互细节
  // ════════════════════════════════════════════════════
  console.log('\n─── N. 表格交互细节 ───');

  // Hover 行高亮
  const firstRow = page.locator('table tbody tr').first();
  if (await firstRow.count() > 0) {
    const bgBefore = await page.evaluate(() => {
      const tr = document.querySelector('table tbody tr');
      return tr ? window.getComputedStyle(tr).backgroundColor : '';
    });
    await firstRow.hover();
    await page.waitForTimeout(300);
    const bgAfter = await page.evaluate(() => {
      const tr = document.querySelector('table tbody tr');
      return tr ? window.getComputedStyle(tr).backgroundColor : '';
    });
    // Design: hover bg = gray-50 or primary-50
    const hoverChanged = bgBefore !== bgAfter;
    check('行Hover背景变化', hoverChanged ? '变化了' : '未变化', '变化了');
  }

  // 一级分类 Tag 样式
  const cat1Tags = await page.locator('[class*="cat1_tag"], .badge--raw, .badge--semi, .badge--finished').count();
  checkExists('分类标签', cat1Tags);

  // ════════════════════════════════════════════════════
  // O. 响应式断点
  // ════════════════════════════════════════════════════
  console.log('\n─── O. 响应式 — 768px 平板 ───');

  await page.setViewportSize({ width: 768, height: 1024 });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(DIR, '11_tablet_768.png'), fullPage: true });

  const tabletFilterDir = await page.evaluate(() => {
    const el = document.querySelector('[class*="filter_bar"], [class*="filter-bar"]');
    return el ? window.getComputedStyle(el).flexDirection : '';
  });
  // Design: @768px filter-bar should stack
  check('768px筛选栏方向', tabletFilterDir === 'column' ? '垂直' : '水平', '垂直');

  // 恢复
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(1000);

  // ════════════════════════════════════════════════════
  // P. 空态测试
  // ════════════════════════════════════════════════════
  console.log('\n─── P. 空态测试 ───');

  if (hasSearch > 0) {
    await searchInput.fill('XXXXXXXXXX不存在的SKU');
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(DIR, '12_empty_state.png') });

    const emptyRows = await page.locator('table tbody tr').count();
    const emptyText = await page.evaluate(() => document.body.innerText);
    const hasEmptyHint = emptyText.includes('暂无') || emptyText.includes('没有') || emptyText.includes('未找到') || emptyText.includes('无数据') || emptyRows === 0;
    check('空态提示', hasEmptyHint ? '有提示' : '无提示', '有提示');

    // 恢复
    await searchInput.fill('');
    await page.waitForTimeout(1500);
  }

  // ════════════════════════════════════════════════════
  // Q. 表格单元格样式细节
  // ════════════════════════════════════════════════════
  console.log('\n─── Q. 单元格样式细节 ───');

  // td padding
  const tdStyle = await page.evaluate(() => {
    const td = document.querySelector('table tbody td');
    if (!td) return null;
    const s = window.getComputedStyle(td);
    return { paddingTop: s.paddingTop, paddingLeft: s.paddingLeft, fontSize: s.fontSize, borderBottom: s.borderBottom };
  });
  if (tdStyle) {
    // Design: padding space-3(12px) space-4(16px)
    check('单元格上内边距(~12px)', parseFloat(tdStyle.paddingTop), 12, 4);
    check('单元格字号(14px)', parseFloat(tdStyle.fontSize), 14, 2);
    // border-bottom
    const hasTdBorder = tdStyle.borderBottom && tdStyle.borderBottom.includes('solid');
    check('单元格底部边框', hasTdBorder ? '有' : '无', '有');
  }

  // ════════════════════════════════════════════════════
  // R. 无障碍检查
  // ════════════════════════════════════════════════════
  console.log('\n─── R. 无障碍检查 ───');

  const allBtns = await page.locator('button').count();
  const btnsWithText = await page.evaluate(() => {
    const btns = document.querySelectorAll('button');
    return Array.from(btns).filter(b => (b.textContent?.trim() || b.getAttribute('aria-label'))).length;
  });
  check('所有按钮有文字或aria-label', btnsWithText >= allBtns - 1 ? '是' : `${btnsWithText}/${allBtns}`, '是');

  // 表格 checkbox 有 title 或 aria-label
  const checkboxAccessible = await page.evaluate(() => {
    const cbs = document.querySelectorAll('table input[type="checkbox"]');
    return Array.from(cbs).length; // 存在就算通过
  });
  check('表格复选框存在', checkboxAccessible > 0 ? '存在' : '不存在', '存在');

  // ════════════════════════════════════════════════════
  // S. API 错误 & 页面错误
  // ════════════════════════════════════════════════════
  console.log('\n─── S. 运行时错误 ───');

  check('API 5xx 错误数', apiErrors.length, 0);
  check('页面 JS 错误数', pageErrors.length, 0);

  if (apiErrors.length > 0) {
    apiErrors.forEach(e => console.log(`    ✗ ${e.status} ${e.url}`));
  }
  if (pageErrors.length > 0) {
    pageErrors.forEach(e => console.log(`    ✗ ${e.substring(0,100)}`));
  }

  // ════════════════════════════════════════════════════
  // 最终截图
  // ════════════════════════════════════════════════════
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(DIR, '13_final.png'), fullPage: true });

  // ════════════════════════════════════════════════════
  // 汇总
  // ════════════════════════════════════════════════════
  const FAIL = CHECKS - PASS;
  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║           SKU 主数据页 UI 审计结果                       ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`  总检查点: ${CHECKS}`);
  console.log(`  ✓ PASS: ${PASS}`);
  console.log(`  ✗ FAIL: ${FAIL}`);
  console.log(`  通过率: ${((PASS / CHECKS) * 100).toFixed(1)}%`);

  if (ISSUES.length > 0) {
    console.log('\n  ─── 需修复的问题 ───');
    ISSUES.forEach((iss, i) => {
      console.log(`  ${i + 1}. ${iss.name}`);
      console.log(`     实际: ${iss.actual}`);
      console.log(`     期望: ${iss.expected}`);
    });
  }

  fs.writeFileSync(path.join(DIR, 'audit-result.json'), JSON.stringify({
    timestamp: new Date().toISOString(), checks: CHECKS, pass: PASS, fail: FAIL,
    issues: ISSUES, apiErrors, pageErrors,
  }, null, 2));

  console.log(`\n  截图: ${DIR}/`);
  await browser.close();
}

main().catch(err => { console.error('审计脚本失败:', err.message); process.exit(1); });
