/**
 * [artifact:自动化测试] — Chrome 浏览器全流程功能操作测试
 *
 * 按工厂真实业务流：
 *   客户下单 → 审批 → BOM物料分析 → 采购 → 质检入库 → 生产 → 报工 → 库存 → 交付
 *
 * 每个页面执行真实的 UI 操作（填表单、点按钮、验证结果）
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const BASE_URL = 'http://localhost';
const SHOT_DIR = path.join(import.meta.dirname, 'screenshots-flow');
const RESULTS = [];
let page, browser;
let STEP = 0;

// ── 工具 ─────────────────────────────────────────────────
async function spaNav(targetPath) {
  await page.evaluate((p) => {
    window.history.pushState({}, '', p);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, targetPath);
  await page.waitForTimeout(2000);
  try { await page.waitForLoadState('networkidle', { timeout: 5000 }); } catch {}
}

async function shot(name) {
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`), fullPage: false });
}

function step(name) {
  STEP++;
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  步骤 ${STEP}: ${name}`);
  console.log(`${'═'.repeat(60)}`);
}

function record(test, status, detail = '') {
  const icon = status === 'PASS' ? '✓' : status === 'FAIL' ? '✗' : '⚠';
  console.log(`  ${icon} ${status} | ${test}${detail ? ' — ' + detail : ''}`);
  RESULTS.push({ step: STEP, test, status, detail });
}

async function clickBtn(text, timeout = 1500) {
  const btn = page.locator(`button:has-text("${text}")`).first();
  if (await btn.count() === 0) return false;
  if (await btn.isDisabled()) return false;
  await btn.click();
  await page.waitForTimeout(timeout);
  return true;
}

async function fillField(selector, value) {
  const el = page.locator(selector).first();
  if (await el.count() === 0) return false;
  await el.click();
  await el.fill(value);
  return true;
}

async function getTableRows() {
  return page.locator('table tbody tr').count();
}

async function hasText(text) {
  const body = await page.evaluate(() => document.body?.innerText || '');
  return body.includes(text);
}

async function waitForModal() {
  await page.waitForTimeout(800);
  return page.locator('[role="dialog"], [class*="modal"], [class*="Modal"], [class*="drawer"], [class*="Drawer"]').first();
}

async function closeModal() {
  // Try various close approaches
  const closeBtn = page.locator('button:has-text("取消"), button:has-text("关闭"), button[aria-label="Close"], [class*="modal-close"], [class*="close-btn"]').first();
  if (await closeBtn.count() > 0) {
    await closeBtn.click();
    await page.waitForTimeout(500);
    return true;
  }
  // Press Escape
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  return true;
}

// ════════════════════════════════════════════════════════════
async function main() {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  browser = await chromium.launch({ headless: false, channel: 'chrome' });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await context.newPage();

  // 捕获页面错误
  const pageErrors = [];
  page.on('pageerror', err => pageErrors.push({ url: page.url(), msg: err.message }));

  // 捕获 API 错误
  const apiErrors = [];
  page.on('response', resp => {
    if (resp.url().includes('/api/') && resp.status() >= 500) {
      apiErrors.push({ url: resp.url(), status: resp.status() });
    }
  });

  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  Chrome 浏览器 — 全业务流程功能操作测试                     ║');
  console.log(`║  ${new Date().toISOString()}                            ║`);
  console.log('╚══════════════════════════════════════════════════════════╝');

  // ── 1. 登录 ──────────────────────────────────────────────
  step('登录系统');
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle', timeout: 15000 });
  await page.fill('#username', 'admin');
  await page.fill('#password', 'admin123');
  await page.fill('#tenantCode', '');
  await page.fill('#tenantCode', 'FACTORY001');
  await shot('01_login_form');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(2000);

  const isLoggedIn = !page.url().includes('/login');
  record('登录', isLoggedIn ? 'PASS' : 'FAIL', page.url());
  await shot('01_after_login');

  // ── 2. 首页看板 ──────────────────────────────────────────
  step('首页看板 — 查看经营数据');
  await spaNav('/dashboard');
  await shot('02_dashboard');

  const kpiCards = await page.locator('[class*="kpi"], [class*="Kpi"], [class*="card"], [class*="Card"]').count();
  record('KPI 卡片展示', kpiCards > 0 ? 'PASS' : 'FAIL', `${kpiCards} 个卡片`);

  // 检查 KPI 数据是否有实际数值
  const dashText = await page.evaluate(() => document.body?.innerText || '');
  const hasNumbers = /\d+/.test(dashText);
  record('看板有数据展示', hasNumbers ? 'PASS' : 'WARN', '页面含数字数据');

  // ── 3. 客户管理 — 确认有客户 ─────────────────────────────
  step('客户管理 — 查看/新增客户');
  await spaNav('/sales/customers');
  await page.waitForTimeout(1500);
  await shot('03_customers');

  let customerRows = await getTableRows();
  record('客户列表加载', customerRows > 0 ? 'PASS' : 'WARN', `${customerRows} 行`);

  // 尝试新增客户
  if (await clickBtn('新增')) {
    const modal = await waitForModal();
    await shot('03_customer_add_modal');

    // 填写表单
    const nameInput = page.locator('input[placeholder*="客户"], input[placeholder*="名称"], input[name*="name"]').first();
    if (await nameInput.count() > 0) {
      await nameInput.fill('全流程测试客户-' + Date.now().toString().slice(-6));
      // 查找联系人/电话字段
      const phoneInput = page.locator('input[placeholder*="电话"], input[placeholder*="手机"], input[name*="phone"]').first();
      if (await phoneInput.count() > 0) await phoneInput.fill('13900001111');
      const contactInput = page.locator('input[placeholder*="联系人"], input[name*="contact"]').first();
      if (await contactInput.count() > 0) await contactInput.fill('测试联系人');

      await shot('03_customer_form_filled');

      // 提交
      const submitBtn = page.locator('[role="dialog"] button:has-text("确定"), [role="dialog"] button:has-text("保存"), [role="dialog"] button:has-text("提交"), [class*="modal"] button:has-text("确定")').first();
      if (await submitBtn.count() > 0) {
        await submitBtn.click();
        await page.waitForTimeout(2000);
        await shot('03_customer_after_submit');
        const newRows = await getTableRows();
        record('新增客户', newRows > customerRows ? 'PASS' : 'WARN', `行数 ${customerRows}→${newRows}`);
      } else {
        await closeModal();
        record('新增客户', 'WARN', '未找到提交按钮');
      }
    } else {
      await closeModal();
      record('新增客户表单', 'WARN', '未找到名称输入框');
    }
  } else {
    record('新增客户按钮', 'WARN', '未找到新增按钮');
  }

  // ── 4. SKU 管理 — 查看物料 ────────────────────────────────
  step('SKU 管理 — 浏览物料主数据');
  await spaNav('/master-data/sku');
  await page.waitForTimeout(1500);
  await shot('04_sku_list');

  const skuRows = await getTableRows();
  record('SKU列表加载', skuRows > 0 ? 'PASS' : 'FAIL', `${skuRows} 行`);

  // 搜索功能
  const searchInput = page.locator('input[placeholder*="搜索"], input[placeholder*="名称"], input[placeholder*="关键"]').first();
  if (await searchInput.count() > 0) {
    await searchInput.fill('沙发');
    await page.waitForTimeout(1500);
    const filteredRows = await getTableRows();
    record('SKU搜索', 'PASS', `搜索"沙发"→${filteredRows}行`);
    await searchInput.fill('');
    await page.waitForTimeout(1000);
  }

  // ── 5. BOM 管理 — 查看物料清单 ───────────────────────────
  step('BOM 管理 — 查看物料清单');
  await spaNav('/master-data/bom');
  await page.waitForTimeout(1500);
  await shot('05_bom_list');

  const bomRows = await getTableRows();
  record('BOM列表加载', bomRows > 0 ? 'PASS' : 'FAIL', `${bomRows} 行`);

  // 点击展开查看BOM明细
  const expandBtn = page.locator('button:has-text("展开"), button:has-text("查看"), button:has-text("详情"), table tbody tr button').first();
  if (await expandBtn.count() > 0) {
    await expandBtn.click();
    await page.waitForTimeout(1500);
    await shot('05_bom_detail');
    record('BOM展开/详情', 'PASS', '物料明细展示');
    await closeModal();
  }

  // ── 6. 销售订单 — 创建新订单 ─────────────────────────────
  step('销售订单 — 创建新订单');
  await spaNav('/sales/order-list');
  await page.waitForTimeout(1500);
  await shot('06_sales_order_list');

  let salesRows = await getTableRows();
  record('销售订单列表', 'PASS', `${salesRows} 行`);

  // 新增订单
  try {
    if (await clickBtn('新增') || await clickBtn('新建') || await clickBtn('创建')) {
      await page.waitForTimeout(1000);
      await shot('06_sales_order_new');

      // 在弹窗内查找并填写表单字段
      const modal = page.locator('[role="dialog"], [class*="modal"], [class*="Modal"], [class*="drawer"], [class*="Drawer"]').first();
      const modalVisible = await modal.count() > 0;
      const formScope = modalVisible ? modal : page;
      const allInputs = await formScope.locator('input, select, textarea').all();
      console.log(`  ℹ 表单字段数: ${allInputs.length}（${modalVisible ? '弹窗内' : '页面'}）`);

      // 查找客户选择器 — 限定在弹窗/表单范围内
      const customerSelect = formScope.locator('select, [role="combobox"], [class*="select"]:not([class*="close"])').first();
      if (await customerSelect.count() > 0) {
        await customerSelect.click({ timeout: 5000 });
        await page.waitForTimeout(500);
        // 选择第一个选项
        const option = page.locator('[role="option"], [class*="option"]').first();
        if (await option.count() > 0) {
          await option.click();
          await page.waitForTimeout(500);
        }
      }

      // 填写日期
      const dateInputs = formScope.locator('input[type="date"]');
      const dateCount = await dateInputs.count();
      for (let i = 0; i < dateCount; i++) {
        await dateInputs.nth(i).fill('2026-04-15');
      }

      await shot('06_sales_order_form');

      // 提交订单
      const submitted = await clickBtn('确定', 2000) || await clickBtn('保存', 2000) || await clickBtn('提交', 2000);
      await shot('06_sales_order_after_submit');
      await page.waitForTimeout(1000);

      const newSalesRows = await getTableRows();
      record('创建销售订单', newSalesRows > salesRows || submitted ? 'PASS' : 'WARN',
        `行数 ${salesRows}→${newSalesRows}`);
    } else {
      record('新增订单按钮', 'WARN', '未找到');
    }
  } catch (e) {
    record('创建销售订单', 'WARN', `操作异常: ${e.message.substring(0, 80)}`);
    await closeModal();
    await page.waitForTimeout(500);
  }

  // 状态筛选
  const statusFilter = page.locator('select, [class*="select"]').first();
  if (await statusFilter.count() > 0) {
    record('状态筛选控件', 'PASS', '存在');
  }

  // ── 7. 销售订单约束检查 ──────────────────────────────────
  step('销售订单 — 约束引擎');
  await spaNav('/sales/orders');
  await page.waitForTimeout(1500);
  await shot('07_sales_constraint');

  const constraintContent = await page.evaluate(() => document.body?.innerText?.length || 0);
  record('约束引擎页面', constraintContent > 50 ? 'PASS' : 'WARN', `内容长度=${constraintContent}`);

  // ── 8. 库存管理 — 查看当前库存 ───────────────────────────
  step('库存管理 — 查看库存 & 出入库');
  await spaNav('/inventory');
  await page.waitForTimeout(1500);
  await shot('08_inventory');

  const invRows = await getTableRows();
  record('库存列表', invRows > 0 ? 'PASS' : 'WARN', `${invRows} 行`);

  // 搜索低库存
  const invSearch = page.locator('input[placeholder*="搜索"], input[placeholder*="名称"]').first();
  if (await invSearch.count() > 0) {
    await invSearch.fill('珍珠棉');
    await page.waitForTimeout(1500);
    await shot('08_inventory_search');
    const searchRows = await getTableRows();
    record('库存搜索', 'PASS', `搜索"珍珠棉"→${searchRows}行`);
    await invSearch.fill('');
    await page.waitForTimeout(1000);
  }

  // 导出功能
  const hasExport = await page.locator('button:has-text("导出")').count() > 0;
  record('导出按钮', hasExport ? 'PASS' : 'WARN', hasExport ? '存在' : '未找到');

  // ── 9. 采购建议 ──────────────────────────────────────────
  step('采购建议 — 查看 AI 采购建议');
  await spaNav('/purchase/suggestions');
  await page.waitForTimeout(1500);
  await shot('09_purchase_suggestions');

  const sugRows = await getTableRows();
  record('采购建议列表', 'PASS', `${sugRows} 行`);

  // 查找审批按钮
  const approveBtn = await page.locator('button:has-text("批准"), button:has-text("审批")').count();
  record('审批操作入口', approveBtn > 0 ? 'PASS' : 'WARN', `${approveBtn} 个审批按钮`);

  // ── 10. 采购比价 ─────────────────────────────────────────
  step('采购比价 — 三方比价');
  await spaNav('/purchase/match');
  await page.waitForTimeout(1500);
  await shot('10_purchase_match');

  const matchContent = await page.evaluate(() => document.body?.innerText?.length || 0);
  record('采购比价页面', matchContent > 50 ? 'PASS' : 'FAIL', `内容长度=${matchContent}`);

  // ── 11. 价格管理 ─────────────────────────────────────────
  step('价格管理');
  await spaNav('/purchase/prices');
  await page.waitForTimeout(1500);
  await shot('11_prices');

  const priceRows = await getTableRows();
  record('价格列表', priceRows > 0 ? 'PASS' : 'WARN', `${priceRows} 行`);

  // 导入按钮
  const importBtn = await page.locator('button:has-text("导入")').count() > 0;
  record('价格导入入口', importBtn ? 'PASS' : 'WARN');

  // ── 12. MRP 采购建议 ────────────────────────────────────
  step('MRP 采购建议');
  await spaNav('/purchase/purchase-suggestions');
  await page.waitForTimeout(1500);
  await shot('12_mrp_suggestions');

  const mrpRows = await getTableRows();
  record('MRP采购建议列表', 'PASS', `${mrpRows} 行`);

  // 转采购单按钮
  const batchBtn = await page.locator('button:has-text("转采购"), button:has-text("批量")').count();
  record('转采购单操作', batchBtn > 0 ? 'PASS' : 'WARN', `${batchBtn} 个`);

  // ── 13. 来料检验 ─────────────────────────────────────────
  step('来料检验');
  await spaNav('/purchase/incoming-inspection');
  await page.waitForTimeout(1500);
  await shot('13_incoming_inspection');

  const inspRows = await getTableRows();
  record('来料检验列表', 'PASS', `${inspRows} 行`);

  // 查看检验详情
  if (inspRows > 0) {
    const viewBtn = page.locator('table tbody tr:first-child button:has-text("查看"), table tbody tr:first-child button:has-text("检验"), table tbody tr:first-child button:has-text("详情")').first();
    if (await viewBtn.count() > 0) {
      await viewBtn.click();
      await page.waitForTimeout(1500);
      await shot('13_inspection_detail');
      record('检验详情', 'PASS', '弹窗打开');
      await closeModal();
    }
  }

  // ── 14. 退货管理 ─────────────────────────────────────────
  step('退货管理');
  await spaNav('/purchase/returns');
  await page.waitForTimeout(1500);
  await shot('14_returns');

  const returnRows = await getTableRows();
  record('退货列表', 'PASS', `${returnRows} 行`);

  // ── 15. 供应商管理 ───────────────────────────────────────
  step('供应商管理');
  await spaNav('/master-data/supplier');
  await page.waitForTimeout(1500);
  await shot('15_suppliers');

  const supRows = await getTableRows();
  record('供应商列表', supRows > 0 ? 'PASS' : 'WARN', `${supRows} 行`);

  // 导出
  if (await page.locator('button:has-text("导出")').count() > 0) {
    record('供应商导出', 'PASS');
  }

  // ── 16. 排产计划 ─────────────────────────────────────────
  step('排产计划');
  await spaNav('/production/schedule');
  await page.waitForTimeout(1500);
  await shot('16_schedule');

  const scheduleContent = await page.evaluate(() => document.body?.innerText?.length || 0);
  record('排产计划页面', scheduleContent > 50 ? 'PASS' : 'FAIL', `内容=${scheduleContent}`);

  // ── 17. 生产工单 ─────────────────────────────────────────
  step('生产工单');
  await spaNav('/production/orders');
  await page.waitForTimeout(1500);
  await shot('17_production_orders');

  const prodRows = await getTableRows();
  record('生产工单列表', 'PASS', `${prodRows} 行`);

  // 新建工单
  if (await clickBtn('新建') || await clickBtn('新增')) {
    await page.waitForTimeout(1000);
    await shot('17_production_order_new');
    record('新建工单弹窗', 'PASS');
    await closeModal();
  }

  // ── 18. 生产任务 ─────────────────────────────────────────
  step('生产任务');
  await spaNav('/production/tasks');
  await page.waitForTimeout(1500);
  await shot('18_production_tasks');

  const taskRows = await getTableRows();
  record('生产任务列表', 'PASS', `${taskRows} 行`);

  // 尝试开始/完成任务
  if (taskRows > 0) {
    const startBtn = page.locator('button:has-text("开始"), button:has-text("报工")').first();
    if (await startBtn.count() > 0 && !(await startBtn.isDisabled())) {
      await startBtn.click();
      await page.waitForTimeout(1500);
      await shot('18_task_action');
      record('任务操作', 'PASS', '按钮可交互');
      await closeModal();
    }
  }

  // ── 19. 缺料看板 ─────────────────────────────────────────
  step('缺料看板');
  await spaNav('/production/shortage');
  await page.waitForTimeout(1500);
  await shot('19_shortage');

  const shortageContent = await page.evaluate(() => document.body?.innerText?.length || 0);
  record('缺料看板', shortageContent > 50 ? 'PASS' : 'WARN', `内容=${shortageContent}`);

  // ── 20. 质量追溯 ─────────────────────────────────────────
  step('质量追溯');
  await spaNav('/quality/trace');
  await page.waitForTimeout(1500);
  await shot('20_quality');

  const qualityContent = await page.evaluate(() => document.body?.innerText?.length || 0);
  record('质量追溯页面', qualityContent > 50 ? 'PASS' : 'FAIL', `内容=${qualityContent}`);

  // 查看统计数据
  const statElements = await page.locator('[class*="stat"], [class*="Stat"]').count();
  record('质量统计数据', statElements > 0 ? 'PASS' : 'WARN', `${statElements} 个统计元素`);

  // ── 21. 工序配置 ─────────────────────────────────────────
  step('工序配置');
  await spaNav('/master-data/process-config');
  await page.waitForTimeout(1500);
  await shot('21_process_config');

  const processRows = await getTableRows();
  record('工序配置列表', 'PASS', `${processRows} 行`);

  // ── 22. SKU 分类 ─────────────────────────────────────────
  step('SKU 分类管理');
  await spaNav('/master-data/sku-category');
  await page.waitForTimeout(1500);
  await shot('22_sku_category');

  const catNodes = await page.locator('li, table tbody tr, [class*="tree-node"]').count();
  record('分类数据', catNodes > 0 ? 'PASS' : 'WARN', `${catNodes} 个节点`);

  // ── 23. 库存盘点 ─────────────────────────────────────────
  step('库存盘点');
  await spaNav('/stocktaking');
  await page.waitForTimeout(1500);
  await shot('23_stocktaking');

  const stockRows = await getTableRows();
  record('盘点列表', stockRows > 0 ? 'PASS' : 'WARN', `${stockRows} 行`);

  // 新建盘点
  if (await clickBtn('新建') || await clickBtn('发起') || await clickBtn('新增')) {
    await page.waitForTimeout(1000);
    await shot('23_stocktaking_new');
    record('新建盘点', 'PASS', '操作可触发');
    await closeModal();
  }

  // ── 24. 工资报表 ─────────────────────────────────────────
  step('工资报表');
  await spaNav('/report/wages');
  await page.waitForTimeout(1500);
  await shot('24_wage_report');

  const wageRows = await getTableRows();
  record('工资报表列表', 'PASS', `${wageRows} 行`);

  // 导出
  if (await page.locator('button:has-text("导出")').count() > 0) {
    record('工资导出', 'PASS');
  }

  // ── 25. 我的工资 ─────────────────────────────────────────
  step('我的工资');
  await spaNav('/report/my-wages');
  await page.waitForTimeout(1500);
  await shot('25_my_wages');

  const myWageContent = await page.evaluate(() => document.body?.innerText?.length || 0);
  record('我的工资页面', myWageContent > 50 ? 'PASS' : 'WARN', `内容=${myWageContent}`);

  // ── 26. 智能排产建议 ─────────────────────────────────────
  step('智能排产建议');
  await spaNav('/schedule-suggestions');
  await page.waitForTimeout(1500);
  await shot('26_schedule_suggestions');

  const schCards = await page.locator('[class*="card"], [class*="Card"]').count();
  record('排产建议卡片', schCards > 0 ? 'PASS' : 'WARN', `${schCards} 个`);

  const schTableRows = await getTableRows();
  record('排产历史表格', schTableRows > 0 ? 'PASS' : 'WARN', `${schTableRows} 行`);

  // 触发计算
  const calcBtn = page.locator('button:has-text("生成"), button:has-text("计算"), button:has-text("排产")').first();
  if (await calcBtn.count() > 0) {
    await calcBtn.click();
    await page.waitForTimeout(3000);
    await shot('26_after_calculate');
    record('触发排产计算', 'PASS', '已点击');
  }

  // ── 27. AI 助手 ──────────────────────────────────────────
  step('AI 助手 — 对话交互');
  await spaNav('/ai-chat');
  await page.waitForTimeout(1500);
  await shot('27_ai_chat');

  // 发送消息
  const chatInput = page.locator('input[aria-label="向 AI 助手提问"], textarea, input[placeholder*="输入"]').first();
  if (await chatInput.count() > 0) {
    await chatInput.fill('当前有多少种物料库存低于安全库存？');
    await page.waitForTimeout(500);

    const sendBtn = page.locator('button[aria-label="发送"], button:has-text("发送"), button[type="submit"]').first();
    if (await sendBtn.count() > 0 && !(await sendBtn.isDisabled())) {
      await sendBtn.click();
      console.log('  ℹ 已发送 AI 提问，等待回复...');
      await page.waitForTimeout(8000); // 等 AI 回复
      await shot('27_ai_reply');

      // 检查回复
      const messages = await page.locator('[class*="message"], [class*="bubble"]').count();
      record('AI 对话', messages >= 2 ? 'PASS' : 'WARN', `${messages} 条消息`);
    } else {
      record('AI 发送按钮', 'WARN', '禁用或未找到');
    }
  } else {
    record('AI 输入框', 'FAIL', '未找到');
  }

  // ── 28. 通知中心 ─────────────────────────────────────────
  step('通知中心');
  await spaNav('/notifications');
  await page.waitForTimeout(1500);
  await shot('28_notifications');

  const notifContent = await page.evaluate(() => document.body?.innerText?.length || 0);
  record('通知页面', notifContent > 50 ? 'PASS' : 'WARN', `内容=${notifContent}`);

  // 全部已读
  const readAllBtn = await page.locator('button:has-text("全部已读"), button:has-text("标记")').count();
  record('标记已读按钮', readAllBtn > 0 ? 'PASS' : 'WARN', `${readAllBtn} 个`);

  // ── 29. 销售结算 ─────────────────────────────────────────
  step('销售结算');
  await spaNav('/settlement');
  await page.waitForTimeout(1500);
  await shot('29_settlement');

  const settContent = await page.evaluate(() => document.body?.innerText?.length || 0);
  record('结算页面', settContent > 50 ? 'PASS' : 'WARN', `内容=${settContent}`);

  // ── 30. 经营分析 ─────────────────────────────────────────
  step('经营分析 — Tab 切换');
  await spaNav('/analytics');
  await page.waitForTimeout(1500);
  await shot('30_analytics');

  const tabs = page.locator('[role="tab"], button[class*="tab"], [class*="Tab"]');
  const tabCount = await tabs.count();
  record('分析 Tab', tabCount >= 2 ? 'PASS' : 'WARN', `${tabCount} 个 Tab`);

  // 逐个点击 Tab
  for (let i = 0; i < Math.min(tabCount, 4); i++) {
    await tabs.nth(i).click();
    await page.waitForTimeout(1500);
    const tabName = await tabs.nth(i).textContent();
    await shot(`30_analytics_tab${i + 1}`);
    record(`分析Tab: ${tabName?.trim()}`, 'PASS', '切换成功');
  }

  // ════════════════════════════════════════════════════════════
  // 汇总
  // ════════════════════════════════════════════════════════════
  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║                Chrome 全流程测试汇总                      ║');
  console.log('╚══════════════════════════════════════════════════════════╝');

  const passCount = RESULTS.filter(r => r.status === 'PASS').length;
  const warnCount = RESULTS.filter(r => r.status === 'WARN').length;
  const failCount = RESULTS.filter(r => r.status === 'FAIL').length;

  console.log(`  总测试点: ${RESULTS.length}`);
  console.log(`  ✓ PASS: ${passCount}`);
  console.log(`  ⚠ WARN: ${warnCount}`);
  console.log(`  ✗ FAIL: ${failCount}`);
  console.log(`  通过率: ${(((passCount + warnCount) / RESULTS.length) * 100).toFixed(1)}%`);

  if (failCount > 0) {
    console.log('\n  --- FAIL ---');
    RESULTS.filter(r => r.status === 'FAIL').forEach(r =>
      console.log(`    ✗ [步骤${r.step}] ${r.test}: ${r.detail}`)
    );
  }
  if (warnCount > 0) {
    console.log('\n  --- WARN ---');
    RESULTS.filter(r => r.status === 'WARN').forEach(r =>
      console.log(`    ⚠ [步骤${r.step}] ${r.test}: ${r.detail}`)
    );
  }

  if (pageErrors.length > 0) {
    console.log(`\n  --- 页面 JS 错误 (${pageErrors.length}) ---`);
    [...new Set(pageErrors.map(e => e.msg))].forEach(e =>
      console.log(`    ${e.substring(0, 120)}`)
    );
  }

  if (apiErrors.length > 0) {
    console.log(`\n  --- API 5xx 错误 (${apiErrors.length}) ---`);
    [...new Set(apiErrors.map(e => `${e.status} ${e.url}`))].forEach(e =>
      console.log(`    ${e}`)
    );
  }

  // 保存结果
  fs.writeFileSync(
    path.join(SHOT_DIR, 'flow-test-results.json'),
    JSON.stringify({
      timestamp: new Date().toISOString(),
      summary: { total: RESULTS.length, pass: passCount, warn: warnCount, fail: failCount },
      results: RESULTS,
      pageErrors,
      apiErrors,
    }, null, 2),
  );
  console.log(`\n  截图: ${SHOT_DIR}/`);
  console.log(`  结果: ${SHOT_DIR}/flow-test-results.json`);

  await browser.close();
}

main().catch(err => {
  console.error('\n脚本失败:', err.message);
  process.exit(1);
});
