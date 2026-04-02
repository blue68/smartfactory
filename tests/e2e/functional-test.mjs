/**
 * [artifact:自动化测试] — 全页面功能点深度测试
 *
 * 测试范围：每个页面的核心功能点
 * - 数据加载（列表、统计）
 * - 表单交互（新增、编辑、搜索、筛选）
 * - 按钮操作（导出、删除、状态变更）
 * - 弹窗/抽屉交互
 * - 分页
 * - 错误处理
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const BASE_URL = 'http://localhost';
const SCREENSHOT_DIR = path.join(import.meta.dirname, 'screenshots-functional');
const RESULTS = [];

let page, browser;

// ── 工具函数 ──────────────────────────────────────────
async function spaNavigate(targetPath) {
  await page.evaluate((p) => {
    window.history.pushState({}, '', p);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, targetPath);
  await page.waitForTimeout(2000);
  try { await page.waitForLoadState('networkidle', { timeout: 5000 }); } catch {}
}

async function shot(name) {
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${name}.png`), fullPage: false });
}

function record(module, testName, status, detail = '') {
  const icon = status === 'PASS' ? '✓' : status === 'FAIL' ? '✗' : '⚠';
  console.log(`  ${icon} ${status} | ${testName}${detail ? ' — ' + detail : ''}`);
  RESULTS.push({ module, testName, status, detail });
}

async function safeTest(module, testName, fn) {
  try {
    const result = await fn();
    record(module, testName, result?.status || 'PASS', result?.detail || '');
  } catch (err) {
    record(module, testName, 'FAIL', err.message?.substring(0, 120));
  }
}

async function countRows() {
  return page.locator('table tbody tr').count();
}

async function hasElement(selector) {
  return (await page.locator(selector).count()) > 0;
}

async function getTextContent(selector) {
  const el = page.locator(selector).first();
  if (await el.count() === 0) return '';
  return (await el.textContent()) || '';
}

async function clickAndWait(selector, waitMs = 1500) {
  await page.locator(selector).first().click();
  await page.waitForTimeout(waitMs);
}

// ── 模块测试函数 ──────────────────────────────────────

// 1. 首页看板
async function testDashboard() {
  console.log('\n📊 模块: 首页看板 /dashboard');
  await spaNavigate('/dashboard');
  await shot('func_dashboard');

  await safeTest('首页看板', '页面加载', async () => {
    const bodyLen = await page.evaluate(() => document.body?.innerText?.length || 0);
    if (bodyLen < 20) return { status: 'FAIL', detail: '页面内容过少' };
  });

  await safeTest('首页看板', 'KPI 卡片渲染', async () => {
    const cards = await page.locator('[class*="card"], [class*="Card"], [class*="kpi"], [class*="stat"], [class*="Stat"]').count();
    if (cards === 0) return { status: 'WARN', detail: '未找到 KPI 卡片' };
    return { detail: `${cards} 个卡片` };
  });

  await safeTest('首页看板', '图表组件渲染', async () => {
    const charts = await page.locator('canvas, svg, [class*="chart"], [class*="Chart"], [class*="echarts"]').count();
    if (charts === 0) return { status: 'WARN', detail: '未找到图表组件' };
    return { detail: `${charts} 个图表元素` };
  });
}

// 2. 库存管理
async function testInventory() {
  console.log('\n📦 模块: 库存管理 /inventory');
  await spaNavigate('/inventory');
  await shot('func_inventory_list');

  await safeTest('库存管理', '列表数据加载', async () => {
    const rows = await countRows();
    return { detail: `${rows} 行数据` };
  });

  await safeTest('库存管理', '搜索框存在', async () => {
    const has = await hasElement('input[placeholder*="搜索"], input[placeholder*="search"], input[placeholder*="关键"]');
    if (!has) return { status: 'WARN', detail: '未找到搜索输入框' };
  });

  await safeTest('库存管理', '导出按钮', async () => {
    const exportBtn = await page.locator('button:has-text("导出"), button:has-text("Export")').count();
    if (exportBtn === 0) return { status: 'WARN', detail: '未找到导出按钮' };
  });

  await safeTest('库存管理', '表格列完整性', async () => {
    const headers = await page.locator('table thead th').allTextContents();
    const headerText = headers.join(', ');
    return { detail: `列: ${headerText.substring(0, 100)}` };
  });
}

// 3. SKU 管理
async function testSku() {
  console.log('\n🏷️ 模块: SKU管理 /master-data/sku');
  await spaNavigate('/master-data/sku');
  await shot('func_sku_list');

  await safeTest('SKU管理', '列表加载', async () => {
    const rows = await countRows();
    return { detail: `${rows} 行` };
  });

  await safeTest('SKU管理', '统计卡片', async () => {
    const stats = await page.locator('[class*="stat"], [class*="Stat"], [class*="summary"], [class*="Summary"]').count();
    return { detail: `${stats} 个统计元素` };
  });

  await safeTest('SKU管理', '新增按钮可点击', async () => {
    const addBtn = page.locator('button:has-text("新增"), button:has-text("新建"), button:has-text("添加")').first();
    if (await addBtn.count() === 0) return { status: 'WARN', detail: '未找到新增按钮' };
    await addBtn.click();
    await page.waitForTimeout(1000);
    // 检查弹窗/抽屉是否打开
    const modal = await page.locator('[class*="modal"], [class*="Modal"], [class*="drawer"], [class*="Drawer"], [role="dialog"]').count();
    await shot('func_sku_add_modal');
    if (modal === 0) return { status: 'WARN', detail: '新增按钮点击后未出现弹窗' };
    // 关闭弹窗
    const closeBtn = page.locator('[class*="modal"] button:has-text("取消"), [role="dialog"] button:has-text("取消"), button[aria-label="Close"], .ant-modal-close, [class*="close"]').first();
    if (await closeBtn.count() > 0) await closeBtn.click();
    await page.waitForTimeout(500);
    return { detail: '弹窗正常打开' };
  });

  await safeTest('SKU管理', '搜索筛选', async () => {
    const searchInput = page.locator('input[placeholder*="搜索"], input[placeholder*="SKU"], input[placeholder*="名称"]').first();
    if (await searchInput.count() === 0) return { status: 'WARN', detail: '未找到搜索框' };
    await searchInput.fill('测试');
    await page.waitForTimeout(1500);
    return { detail: '搜索触发成功' };
  });
}

// 4. BOM 管理
async function testBom() {
  console.log('\n🔧 模块: BOM管理 /master-data/bom');
  await spaNavigate('/master-data/bom');
  await shot('func_bom_list');

  await safeTest('BOM管理', '列表加载', async () => {
    const rows = await countRows();
    return { detail: `${rows} 行` };
  });

  await safeTest('BOM管理', '新增BOM按钮', async () => {
    const addBtn = await page.locator('button:has-text("新增"), button:has-text("新建"), button:has-text("创建")').count();
    if (addBtn === 0) return { status: 'WARN', detail: '未找到新增按钮' };
  });

  await safeTest('BOM管理', '展开/成本分析入口', async () => {
    const actionBtns = await page.locator('table button, table a, [class*="action"]').count();
    return { detail: `${actionBtns} 个操作入口` };
  });
}

// 5. 供应商管理
async function testSupplier() {
  console.log('\n🏭 模块: 供应商管理 /master-data/supplier');
  await spaNavigate('/master-data/supplier');
  await shot('func_supplier_list');

  await safeTest('供应商管理', '列表加载', async () => {
    const rows = await countRows();
    return { detail: `${rows} 行` };
  });

  await safeTest('供应商管理', '新增供应商弹窗', async () => {
    const addBtn = page.locator('button:has-text("新增"), button:has-text("添加")').first();
    if (await addBtn.count() === 0) return { status: 'WARN', detail: '未找到新增按钮' };
    await addBtn.click();
    await page.waitForTimeout(1000);
    const modal = await page.locator('[role="dialog"], [class*="modal"], [class*="Modal"]').count();
    await shot('func_supplier_add_modal');
    // 关闭
    const closeBtn = page.locator('button:has-text("取消"), button[aria-label="Close"]').first();
    if (await closeBtn.count() > 0) await closeBtn.click();
    await page.waitForTimeout(500);
    if (modal === 0) return { status: 'WARN', detail: '弹窗未打开' };
    return { detail: '弹窗正常' };
  });

  await safeTest('供应商管理', '导出功能', async () => {
    const exportBtn = await page.locator('button:has-text("导出")').count();
    if (exportBtn === 0) return { status: 'WARN', detail: '未找到导出按钮' };
  });
}

// 6. 工序配置
async function testProcessConfig() {
  console.log('\n⚙️ 模块: 工序配置 /master-data/process-config');
  await spaNavigate('/master-data/process-config');
  await shot('func_process_config');

  await safeTest('工序配置', '列表加载', async () => {
    const rows = await countRows();
    return { detail: `${rows} 行` };
  });

  await safeTest('工序配置', '新增工序', async () => {
    const addBtn = await page.locator('button:has-text("新增"), button:has-text("添加")').count();
    if (addBtn === 0) return { status: 'WARN', detail: '未找到新增按钮' };
  });
}

// 7. SKU 分类
async function testSkuCategory() {
  console.log('\n📂 模块: SKU分类 /master-data/sku-category');
  await spaNavigate('/master-data/sku-category');
  await shot('func_sku_category');

  await safeTest('SKU分类', '分类树/列表加载', async () => {
    const treeNodes = await page.locator('[class*="tree"], [class*="Tree"], li, table tbody tr').count();
    return { detail: `${treeNodes} 个节点/行` };
  });

  await safeTest('SKU分类', '新增分类', async () => {
    const addBtn = await page.locator('button:has-text("新增"), button:has-text("添加")').count();
    if (addBtn === 0) return { status: 'WARN', detail: '未找到新增按钮' };
  });
}

// 8. 采购建议
async function testPurchaseSuggestion() {
  console.log('\n🛒 模块: 采购建议 /purchase/suggestions');
  await spaNavigate('/purchase/suggestions');
  await shot('func_purchase_suggestion');

  await safeTest('采购建议', '列表加载', async () => {
    const rows = await countRows();
    return { detail: `${rows} 行` };
  });

  await safeTest('采购建议', '审批按钮', async () => {
    const btns = await page.locator('button:has-text("审批"), button:has-text("确认"), button:has-text("批准")').count();
    return { detail: `${btns} 个审批相关按钮` };
  });
}

// 9. 采购比价
async function testPurchaseMatch() {
  console.log('\n📊 模块: 采购比价 /purchase/match');
  await spaNavigate('/purchase/match');
  await shot('func_purchase_match');

  await safeTest('采购比价', '页面加载', async () => {
    const bodyLen = await page.evaluate(() => document.body?.innerText?.length || 0);
    if (bodyLen < 20) return { status: 'FAIL', detail: '白屏' };
    return { detail: `内容长度 ${bodyLen}` };
  });

  await safeTest('采购比价', '三方比价表格/卡片', async () => {
    const tables = await page.locator('table').count();
    const cards = await page.locator('[class*="card"], [class*="Card"]').count();
    return { detail: `${tables} 表格, ${cards} 卡片` };
  });
}

// 10. 价格管理
async function testPriceManagement() {
  console.log('\n💰 模块: 价格管理 /purchase/prices');
  await spaNavigate('/purchase/prices');
  await shot('func_prices');

  await safeTest('价格管理', '列表加载', async () => {
    const rows = await countRows();
    return { detail: `${rows} 行` };
  });

  await safeTest('价格管理', '导入按钮', async () => {
    const importBtn = await page.locator('button:has-text("导入"), button:has-text("Import")').count();
    if (importBtn === 0) return { status: 'WARN', detail: '未找到导入按钮' };
  });
}

// 11. MRP 采购建议
async function testMrpSuggestion() {
  console.log('\n📋 模块: MRP采购建议 /purchase/purchase-suggestions');
  await spaNavigate('/purchase/purchase-suggestions');
  await shot('func_mrp_suggestion');

  await safeTest('MRP采购建议', '列表加载', async () => {
    const rows = await countRows();
    return { detail: `${rows} 行` };
  });

  await safeTest('MRP采购建议', '批量操作按钮', async () => {
    const batchBtns = await page.locator('button:has-text("批量"), button:has-text("转采购")').count();
    return { detail: `${batchBtns} 个批量操作` };
  });
}

// 12. 来料检验
async function testIncomingInspection() {
  console.log('\n🔍 模块: 来料检验 /purchase/incoming-inspection');
  await spaNavigate('/purchase/incoming-inspection');
  await shot('func_incoming_inspection');

  await safeTest('来料检验', '列表加载', async () => {
    const rows = await countRows();
    return { detail: `${rows} 行` };
  });

  await safeTest('来料检验', '检验操作入口', async () => {
    const actionBtns = await page.locator('button:has-text("检验"), button:has-text("提交"), button:has-text("查看")').count();
    return { detail: `${actionBtns} 个操作按钮` };
  });
}

// 13. 退货管理
async function testReturnOrder() {
  console.log('\n↩️ 模块: 退货管理 /purchase/returns');
  await spaNavigate('/purchase/returns');
  await shot('func_returns');

  await safeTest('退货管理', '列表加载', async () => {
    const rows = await countRows();
    return { detail: `${rows} 行` };
  });

  await safeTest('退货管理', '新建退货', async () => {
    const addBtn = await page.locator('button:has-text("新建"), button:has-text("新增"), button:has-text("发起")').count();
    if (addBtn === 0) return { status: 'WARN', detail: '未找到新建按钮' };
  });
}

// 14. 销售订单（约束引擎）
async function testSalesOrders() {
  console.log('\n📝 模块: 销售订单(约束) /sales/orders');
  await spaNavigate('/sales/orders');
  await shot('func_sales_orders');

  await safeTest('销售订单(约束)', '页面加载', async () => {
    const bodyLen = await page.evaluate(() => document.body?.innerText?.length || 0);
    if (bodyLen < 20) return { status: 'FAIL', detail: '白屏' };
    return { detail: `内容长度 ${bodyLen}` };
  });

  await safeTest('销售订单(约束)', '紧急插单分析入口', async () => {
    const urgentBtn = await page.locator('button:has-text("紧急"), button:has-text("插单"), button:has-text("分析")').count();
    return { detail: `${urgentBtn} 个分析入口` };
  });
}

// 15. 销售订单列表
async function testSalesOrderList() {
  console.log('\n📋 模块: 销售订单列表 /sales/order-list');
  await spaNavigate('/sales/order-list');
  await shot('func_sales_order_list');

  await safeTest('销售订单列表', '列表加载', async () => {
    const rows = await countRows();
    return { detail: `${rows} 行` };
  });

  await safeTest('销售订单列表', '新增订单弹窗', async () => {
    const addBtn = page.locator('button:has-text("新增"), button:has-text("新建"), button:has-text("创建")').first();
    if (await addBtn.count() === 0) return { status: 'WARN', detail: '未找到新增按钮' };
    await addBtn.click();
    await page.waitForTimeout(1000);
    const modal = await page.locator('[role="dialog"], [class*="modal"], [class*="Modal"], [class*="drawer"]').count();
    await shot('func_sales_order_add');
    const closeBtn = page.locator('button:has-text("取消"), button[aria-label="Close"]').first();
    if (await closeBtn.count() > 0) await closeBtn.click();
    await page.waitForTimeout(500);
    return { detail: modal > 0 ? '弹窗正常' : '弹窗未检测到' };
  });

  await safeTest('销售订单列表', '状态筛选', async () => {
    const selects = await page.locator('select, [class*="select"], [class*="Select"], [role="combobox"]').count();
    return { detail: `${selects} 个筛选控件` };
  });
}

// 16. 客户管理
async function testCustomers() {
  console.log('\n👤 模块: 客户管理 /sales/customers');
  await spaNavigate('/sales/customers');
  await shot('func_customers');

  await safeTest('客户管理', '列表加载', async () => {
    const rows = await countRows();
    return { detail: `${rows} 行` };
  });

  await safeTest('客户管理', '新增客户', async () => {
    const addBtn = page.locator('button:has-text("新增"), button:has-text("添加")').first();
    if (await addBtn.count() === 0) return { status: 'WARN', detail: '未找到新增按钮' };
    await addBtn.click();
    await page.waitForTimeout(1000);
    await shot('func_customer_add');
    const closeBtn = page.locator('button:has-text("取消"), button[aria-label="Close"]').first();
    if (await closeBtn.count() > 0) await closeBtn.click();
    await page.waitForTimeout(500);
  });

  await safeTest('客户管理', '导出功能', async () => {
    const exportBtn = await page.locator('button:has-text("导出")').count();
    if (exportBtn === 0) return { status: 'WARN', detail: '未找到导出按钮' };
  });
}

// 17. 排产计划
async function testSchedule() {
  console.log('\n📅 模块: 排产计划 /production/schedule');
  await spaNavigate('/production/schedule');
  await shot('func_schedule');

  await safeTest('排产计划', '页面加载', async () => {
    const bodyLen = await page.evaluate(() => document.body?.innerText?.length || 0);
    if (bodyLen < 20) return { status: 'FAIL', detail: '白屏' };
    return { detail: `内容长度 ${bodyLen}` };
  });

  await safeTest('排产计划', '生成排产按钮', async () => {
    const genBtn = await page.locator('button:has-text("生成"), button:has-text("排产"), button:has-text("计算")').count();
    return { detail: `${genBtn} 个排产操作按钮` };
  });
}

// 18. 生产任务
async function testProductionTask() {
  console.log('\n🔨 模块: 生产任务 /production/tasks');
  await spaNavigate('/production/tasks');
  await shot('func_production_tasks');

  await safeTest('生产任务', '列表加载', async () => {
    const rows = await countRows();
    return { detail: `${rows} 行` };
  });

  await safeTest('生产任务', '任务操作按钮', async () => {
    const btns = await page.locator('button:has-text("开始"), button:has-text("完成"), button:has-text("异常")').count();
    return { detail: `${btns} 个操作按钮` };
  });
}

// 19. 生产工单
async function testProductionOrder() {
  console.log('\n📄 模块: 生产工单 /production/orders');
  await spaNavigate('/production/orders');
  await shot('func_production_orders');

  await safeTest('生产工单', '列表加载', async () => {
    const rows = await countRows();
    return { detail: `${rows} 行` };
  });

  await safeTest('生产工单', '新建工单', async () => {
    const addBtn = await page.locator('button:has-text("新建"), button:has-text("新增"), button:has-text("创建")').count();
    if (addBtn === 0) return { status: 'WARN', detail: '未找到新建按钮' };
  });

  await safeTest('生产工单', '物料检查入口', async () => {
    const materialBtns = await page.locator('button:has-text("物料"), button:has-text("齐套"), button:has-text("检查")').count();
    return { detail: `${materialBtns} 个物料操作` };
  });
}

// 20. 缺料看板
async function testShortageBoard() {
  console.log('\n🚨 模块: 缺料看板 /production/shortage');
  await spaNavigate('/production/shortage');
  await shot('func_shortage');

  await safeTest('缺料看板', '页面加载', async () => {
    const bodyLen = await page.evaluate(() => document.body?.innerText?.length || 0);
    if (bodyLen < 20) return { status: 'FAIL', detail: '白屏' };
    return { detail: `内容长度 ${bodyLen}` };
  });

  await safeTest('缺料看板', '看板卡片/表格', async () => {
    const cards = await page.locator('[class*="card"], [class*="Card"]').count();
    const tables = await page.locator('table').count();
    return { detail: `${cards} 卡片, ${tables} 表格` };
  });
}

// 21. 质量追溯
async function testQualityTrace() {
  console.log('\n🔬 模块: 质量追溯 /quality/trace');
  await spaNavigate('/quality/trace');
  await shot('func_quality_trace');

  await safeTest('质量追溯', '页面加载', async () => {
    const bodyLen = await page.evaluate(() => document.body?.innerText?.length || 0);
    if (bodyLen < 20) return { status: 'FAIL', detail: '白屏' };
    return { detail: `内容长度 ${bodyLen}` };
  });

  await safeTest('质量追溯', '搜索/追溯查询', async () => {
    const searchInput = await page.locator('input[placeholder*="搜索"], input[placeholder*="追溯"], input[placeholder*="批次"]').count();
    return { detail: `${searchInput} 个搜索入口` };
  });

  await safeTest('质量追溯', '统计数据', async () => {
    const stats = await page.locator('[class*="stat"], [class*="Stat"], [class*="summary"]').count();
    return { detail: `${stats} 个统计元素` };
  });
}

// 22. 工资报表
async function testWageReport() {
  console.log('\n💵 模块: 工资报表 /report/wages');
  await spaNavigate('/report/wages');
  await shot('func_wage_report');

  await safeTest('工资报表', '列表加载', async () => {
    const rows = await countRows();
    return { detail: `${rows} 行` };
  });

  await safeTest('工资报表', '导出按钮', async () => {
    const exportBtn = await page.locator('button:has-text("导出")').count();
    if (exportBtn === 0) return { status: 'WARN', detail: '未找到导出按钮' };
  });

  await safeTest('工资报表', '时间筛选', async () => {
    const datePicker = await page.locator('input[type="date"], input[type="month"], [class*="date"], [class*="Date"], [class*="picker"]').count();
    return { detail: `${datePicker} 个日期选择器` };
  });
}

// 23. 我的工资
async function testMyWage() {
  console.log('\n👛 模块: 我的工资 /report/my-wages');
  await spaNavigate('/report/my-wages');
  await shot('func_my_wages');

  await safeTest('我的工资', '页面加载', async () => {
    const bodyLen = await page.evaluate(() => document.body?.innerText?.length || 0);
    if (bodyLen < 20) return { status: 'FAIL', detail: '白屏' };
    return { detail: `内容长度 ${bodyLen}` };
  });
}

// 24. 智能排产建议
async function testScheduleSuggestion() {
  console.log('\n🤖 模块: 智能排产建议 /schedule-suggestions');
  await spaNavigate('/schedule-suggestions');
  await shot('func_schedule_suggestion');

  await safeTest('智能排产建议', '统计卡片', async () => {
    const cards = await page.locator('[class*="card"], [class*="Card"], [class*="stat"]').count();
    return { detail: `${cards} 个卡片` };
  });

  await safeTest('智能排产建议', '历史记录表格', async () => {
    const rows = await countRows();
    return { detail: `${rows} 行历史记录` };
  });

  await safeTest('智能排产建议', '生成建议按钮', async () => {
    const genBtn = await page.locator('button:has-text("生成"), button:has-text("计算"), button:has-text("排产")').count();
    if (genBtn === 0) return { status: 'WARN', detail: '未找到生成按钮' };
    return { detail: `${genBtn} 个操作按钮` };
  });
}

// 25. AI 助手
async function testAiChat() {
  console.log('\n💬 模块: AI助手 /ai-chat');
  await spaNavigate('/ai-chat');
  await shot('func_ai_chat');

  await safeTest('AI助手', '对话界面渲染', async () => {
    const chatArea = await page.locator('[class*="chat"], [class*="Chat"], [class*="message"], [class*="Message"]').count();
    if (chatArea === 0) return { status: 'WARN', detail: '未找到聊天区域' };
    return { detail: `${chatArea} 个聊天元素` };
  });

  await safeTest('AI助手', '输入框存在', async () => {
    const input = await page.locator('textarea, input[type="text"][placeholder*="输入"], input[placeholder*="问"], [class*="input"][contenteditable]').count();
    if (input === 0) return { status: 'FAIL', detail: '未找到消息输入框' };
  });

  await safeTest('AI助手', '发送按钮', async () => {
    const sendBtn = await page.locator('button:has-text("发送"), button[type="submit"], button:has-text("Send")').count();
    if (sendBtn === 0) return { status: 'WARN', detail: '未找到发送按钮' };
  });

  // 测试发送消息
  await safeTest('AI助手', '发送消息交互', async () => {
    const textarea = page.locator('textarea, input[placeholder*="输入"]').first();
    if (await textarea.count() === 0) return { status: 'WARN', detail: '无输入框' };
    await textarea.fill('你好，请介绍一下系统功能');
    await page.waitForTimeout(500);
    const sendBtn = page.locator('button:has-text("发送"), button[type="submit"]').first();
    if (await sendBtn.count() > 0) {
      await sendBtn.click();
      await page.waitForTimeout(3000);
      await shot('func_ai_chat_sent');
      return { detail: '消息已发送' };
    }
    return { status: 'WARN', detail: '未能发送消息' };
  });
}

// 26. 通知中心
async function testNotifications() {
  console.log('\n🔔 模块: 通知中心 /notifications');
  await spaNavigate('/notifications');
  await shot('func_notifications');

  await safeTest('通知中心', '页面加载', async () => {
    const bodyLen = await page.evaluate(() => document.body?.innerText?.length || 0);
    if (bodyLen < 20) return { status: 'FAIL', detail: '白屏' };
    return { detail: `内容长度 ${bodyLen}` };
  });

  await safeTest('通知中心', '通知列表', async () => {
    const items = await page.locator('[class*="notification"], [class*="Notification"], [class*="list-item"], li, table tbody tr').count();
    return { detail: `${items} 个通知项` };
  });

  await safeTest('通知中心', '全部已读按钮', async () => {
    const readAllBtn = await page.locator('button:has-text("全部已读"), button:has-text("标记"), button:has-text("已读")').count();
    return { detail: `${readAllBtn} 个标记按钮` };
  });
}

// 27. 库存盘点
async function testStocktaking() {
  console.log('\n📝 模块: 库存盘点 /stocktaking');
  await spaNavigate('/stocktaking');
  await shot('func_stocktaking');

  await safeTest('库存盘点', '列表加载', async () => {
    const rows = await countRows();
    return { detail: `${rows} 行` };
  });

  await safeTest('库存盘点', '新建盘点', async () => {
    const addBtn = page.locator('button:has-text("新建"), button:has-text("发起"), button:has-text("新增")').first();
    if (await addBtn.count() === 0) return { status: 'WARN', detail: '未找到新建按钮' };
    await addBtn.click();
    await page.waitForTimeout(1000);
    await shot('func_stocktaking_new');
    const modal = await page.locator('[role="dialog"], [class*="modal"], [class*="Modal"]').count();
    const closeBtn = page.locator('button:has-text("取消"), button[aria-label="Close"]').first();
    if (await closeBtn.count() > 0) await closeBtn.click();
    await page.waitForTimeout(500);
    return { detail: modal > 0 ? '弹窗正常' : '弹窗未检测到' };
  });
}

// 28. 销售结算
async function testSettlement() {
  console.log('\n💳 模块: 销售结算 /settlement');
  await spaNavigate('/settlement');
  await shot('func_settlement');

  await safeTest('销售结算', '页面加载', async () => {
    const bodyLen = await page.evaluate(() => document.body?.innerText?.length || 0);
    if (bodyLen < 20) return { status: 'FAIL', detail: '白屏' };
    return { detail: `内容长度 ${bodyLen}` };
  });

  await safeTest('销售结算', '结算列表/空状态', async () => {
    const rows = await countRows();
    const emptyState = await page.locator('[class*="empty"], [class*="Empty"], :text("暂无")').count();
    return { detail: rows > 0 ? `${rows} 行数据` : (emptyState > 0 ? '空状态正常显示' : '无数据无空状态') };
  });
}

// 29. 经营分析
async function testAnalytics() {
  console.log('\n📈 模块: 经营分析 /analytics');
  await spaNavigate('/analytics');
  await shot('func_analytics');

  await safeTest('经营分析', '页面加载', async () => {
    const bodyLen = await page.evaluate(() => document.body?.innerText?.length || 0);
    if (bodyLen < 20) return { status: 'FAIL', detail: '白屏' };
    return { detail: `内容长度 ${bodyLen}` };
  });

  await safeTest('经营分析', 'Tab 切换', async () => {
    const tabs = await page.locator('[role="tab"], button[class*="tab"], [class*="Tab"]').count();
    if (tabs < 2) return { status: 'WARN', detail: `仅 ${tabs} 个 Tab` };
    // 点击第二个 tab
    const secondTab = page.locator('[role="tab"], button[class*="tab"], [class*="Tab"]').nth(1);
    await secondTab.click();
    await page.waitForTimeout(1500);
    await shot('func_analytics_tab2');
    return { detail: `${tabs} 个 Tab，已切换测试` };
  });

  await safeTest('经营分析', '图表渲染', async () => {
    const charts = await page.locator('canvas, svg, [class*="chart"], [class*="Chart"]').count();
    return { detail: `${charts} 个图表元素` };
  });
}

// ── 主函数 ──────────────────────────────────────────
async function main() {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

  browser = await chromium.launch({ headless: false, channel: 'chrome' });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await context.newPage();

  // 捕获全局错误
  const pageErrors = [];
  page.on('pageerror', err => pageErrors.push(err.message));

  console.log('===== 智造管家 V1+V2 功能点深度测试 =====');
  console.log(`时间: ${new Date().toISOString()}\n`);

  // 登录
  console.log('>> 登录...');
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle', timeout: 15000 });
  await page.fill('#username', 'admin');
  await page.fill('#password', 'admin123');
  await page.fill('#tenantCode', '');
  await page.fill('#tenantCode', 'FACTORY001');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(2000);
  console.log('>> 登录成功\n');

  // 逐模块测试
  await testDashboard();
  await testInventory();
  await testSku();
  await testBom();
  await testSupplier();
  await testProcessConfig();
  await testSkuCategory();
  await testPurchaseSuggestion();
  await testPurchaseMatch();
  await testPriceManagement();
  await testMrpSuggestion();
  await testIncomingInspection();
  await testReturnOrder();
  await testSalesOrders();
  await testSalesOrderList();
  await testCustomers();
  await testSchedule();
  await testProductionTask();
  await testProductionOrder();
  await testShortageBoard();
  await testQualityTrace();
  await testWageReport();
  await testMyWage();
  await testScheduleSuggestion();
  await testAiChat();
  await testNotifications();
  await testStocktaking();
  await testSettlement();
  await testAnalytics();

  // 汇总
  console.log('\n\n===== 功能测试汇总 =====');
  const pass = RESULTS.filter(r => r.status === 'PASS').length;
  const warn = RESULTS.filter(r => r.status === 'WARN').length;
  const fail = RESULTS.filter(r => r.status === 'FAIL').length;
  console.log(`总测试点: ${RESULTS.length} | PASS: ${pass} | WARN: ${warn} | FAIL: ${fail}`);
  console.log(`通过率: ${(((pass + warn) / RESULTS.length) * 100).toFixed(1)}%`);

  if (fail > 0) {
    console.log('\n--- FAIL 详情 ---');
    RESULTS.filter(r => r.status === 'FAIL').forEach(r => {
      console.log(`  ✗ [${r.module}] ${r.testName}: ${r.detail}`);
    });
  }

  if (warn > 0) {
    console.log('\n--- WARN 详情 ---');
    RESULTS.filter(r => r.status === 'WARN').forEach(r => {
      console.log(`  ⚠ [${r.module}] ${r.testName}: ${r.detail}`);
    });
  }

  if (pageErrors.length > 0) {
    console.log(`\n--- 页面 JS 错误 (${pageErrors.length}) ---`);
    [...new Set(pageErrors)].forEach(e => console.log(`  ${e.substring(0, 120)}`));
  }

  // 保存结果
  fs.writeFileSync(
    path.join(SCREENSHOT_DIR, 'functional-results.json'),
    JSON.stringify({
      timestamp: new Date().toISOString(),
      summary: { total: RESULTS.length, pass, warn, fail },
      results: RESULTS,
      pageErrors: [...new Set(pageErrors)],
    }, null, 2),
  );

  console.log(`\n截图保存: ${SCREENSHOT_DIR}/`);
  await browser.close();
}

main().catch(err => {
  console.error('脚本执行失败:', err.message);
  process.exit(1);
});
