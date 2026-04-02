/**
 * [artifact:自动化测试] — Playwright 全页面自动巡检脚本
 *
 * 关键：Access Token 存在 JS 内存变量中，page.goto() 会触发全量刷新丢失 token。
 * 解决：登录后通过 SPA 内部导航（history.pushState + popstate）切换路由，
 *       避免全量刷新，保持内存中的 token 状态。
 */

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const BASE_URL = 'http://localhost';
const SCREENSHOT_DIR = path.join(import.meta.dirname, 'screenshots');

const PAGES = [
  { path: '/stocktaking', name: '库存盘点' },
  { path: '/settlement', name: '销售结算' },
  { path: '/analytics', name: '经营分析' },
  { path: '/notifications', name: '通知中心' },
  { path: '/dashboard', name: '首页看板' },
  { path: '/inventory', name: '库存管理' },
  { path: '/master-data/sku', name: 'SKU管理' },
  { path: '/master-data/bom', name: 'BOM管理' },
  { path: '/master-data/supplier', name: '供应商管理' },
  { path: '/master-data/process-config', name: '工序配置' },
  { path: '/master-data/sku-category', name: 'SKU分类' },
  { path: '/purchase/suggestions', name: '采购建议' },
  { path: '/purchase/match', name: '采购比价' },
  { path: '/purchase/prices', name: '价格管理' },
  { path: '/purchase/purchase-suggestions', name: 'MRP采购建议' },
  { path: '/purchase/incoming-inspection', name: '来料检验' },
  { path: '/purchase/returns', name: '退货管理' },
  { path: '/sales/orders', name: '销售订单(约束)' },
  { path: '/sales/order-list', name: '销售订单列表' },
  { path: '/sales/customers', name: '客户管理' },
  { path: '/production/schedule', name: '排产计划' },
  { path: '/production/tasks', name: '生产任务' },
  { path: '/production/orders', name: '生产工单' },
  { path: '/production/shortage', name: '缺料看板' },
  { path: '/quality/trace', name: '质量追溯' },
  { path: '/report/wages', name: '工资报表' },
  { path: '/report/my-wages', name: '我的工资' },
  { path: '/schedule-suggestions', name: '智能排产建议' },
  { path: '/ai-chat', name: 'AI助手' },
];

/**
 * SPA 内部导航：通过 React Router 的 history API 切换路由，不触发全量刷新
 */
async function spaNavigate(page, targetPath) {
  await page.evaluate((p) => {
    window.history.pushState({}, '', p);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, targetPath);
  // 等待 React 组件渲染 + 数据请求完成
  await page.waitForTimeout(2000);
  // 额外等待网络空闲
  try {
    await page.waitForLoadState('networkidle', { timeout: 5000 });
  } catch {
    // networkidle 超时不阻断
  }
}

async function main() {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

  const browser = await chromium.launch({
    headless: false,
    channel: 'chrome',
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });

  const page = await context.newPage();

  console.log('===== 智造管家 V1+V2 全页面自动巡检 =====');
  console.log(`时间: ${new Date().toISOString()}`);
  console.log('');

  // ── Step 1: 真实 UI 登录 ───────────────────────────
  console.log('>> 登录中（通过 UI 表单）...');
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle', timeout: 15000 });
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '00_login_page.png') });

  await page.fill('#username', 'admin');
  await page.fill('#password', 'admin123');
  await page.fill('#tenantCode', '');
  await page.fill('#tenantCode', 'FACTORY001');
  await page.click('button[type="submit"]');

  try {
    await page.waitForURL('**/dashboard', { timeout: 10000 });
    console.log('>> 登录成功，已跳转到 /dashboard');
  } catch {
    await page.waitForTimeout(3000);
    const currentUrl = page.url();
    if (currentUrl.includes('/login')) {
      console.error('>> 登录失败！');
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, '00_login_failed.png') });
      await browser.close();
      process.exit(1);
    }
    console.log(`>> 登录后位于: ${currentUrl}`);
  }

  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '01_dashboard_after_login.png') });

  // ── Step 2: SPA 内部导航逐页巡检 ──────────────────
  console.log('');
  console.log('>> 开始页面巡检（SPA 内部导航，保持 token）...');
  console.log('');

  const results = [];

  for (const pg of PAGES) {
    const consoleErrors = [];
    const networkErrors = [];

    const consoleHandler = (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        // 过滤非关键错误
        if (!text.includes('favicon') && !text.includes('net::ERR')) {
          consoleErrors.push(text);
        }
      }
    };
    page.on('console', consoleHandler);

    const responseHandler = (response) => {
      const url = response.url();
      if (response.status() >= 500 && url.includes('/api/')) {
        networkErrors.push(`${response.status()} ${url.split('/api/')[1] || url}`);
      }
    };
    page.on('response', responseHandler);

    try {
      // SPA 内部导航（不刷新页面，保持 token）
      await spaNavigate(page, pg.path);

      const currentUrl = page.url();
      const redirectedToLogin = currentUrl.includes('/login');

      // 检查页面内容
      const bodyText = await page.evaluate(() => document.body?.innerText?.trim() || '');
      const isBlank = bodyText.length < 10;
      const hasTable = await page.locator('table').count() > 0;
      const hasCards = await page.locator('[class*="card"], [class*="Card"], [class*="kpi"], [class*="stat"], [class*="panel"]').count() > 0;
      const hasButtons = await page.locator('button').count() > 0;
      const hasForm = await page.locator('form, input, select, textarea').count() > 0;
      const hasList = await page.locator('[class*="list"], [class*="List"], ul, ol').count() > 0;
      const hasContent = hasTable || hasCards || hasButtons || hasForm || hasList;

      // 截图
      const screenshotName = pg.path.replace(/\//g, '_').replace(/^_/, '');
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, `${screenshotName}.png`),
        fullPage: false,
      });

      let status = 'PASS';
      const issues = [];

      if (redirectedToLogin) {
        status = 'FAIL';
        issues.push('被重定向到登录页');
      } else if (isBlank) {
        status = 'FAIL';
        issues.push('白屏');
      }

      if (networkErrors.length > 0) {
        if (status === 'PASS') status = 'WARN';
        issues.push(`${networkErrors.length}个5xx: ${networkErrors.join(', ')}`);
      }

      if (consoleErrors.length > 0) {
        if (status === 'PASS') status = 'WARN';
        issues.push(`${consoleErrors.length}个控制台错误`);
      }

      if (!hasContent && status === 'PASS') {
        status = 'WARN';
        issues.push('页面内容较少');
      }

      const elements = [
        hasTable && '表格',
        hasCards && '卡片',
        hasButtons && '按钮',
        hasForm && '表单',
        hasList && '列表',
      ].filter(Boolean).join('+');

      results.push({
        name: pg.name,
        path: pg.path,
        status,
        elements,
        consoleErrors: consoleErrors.length,
        networkErrors: networkErrors.length,
        issues: issues.join('; ') || '-',
      });

      const icon = status === 'PASS' ? '✓' : status === 'WARN' ? '⚠' : '✗';
      console.log(`${icon} ${status.padEnd(4)} | ${pg.name.padEnd(14)} | ${pg.path.padEnd(35)} | ${elements || '无'} | ${issues.join('; ') || 'OK'}`);

    } catch (err) {
      results.push({
        name: pg.name,
        path: pg.path,
        status: 'FAIL',
        elements: '',
        consoleErrors: 0,
        networkErrors: 0,
        issues: `异常: ${err.message?.substring(0, 80)}`,
      });
      console.log(`✗ FAIL | ${pg.name.padEnd(14)} | ${pg.path.padEnd(35)} | 异常: ${err.message?.substring(0, 60)}`);
    }

    page.removeListener('console', consoleHandler);
    page.removeListener('response', responseHandler);
  }

  // ── Step 3: 汇总 ──────────────────────────────────
  console.log('');
  console.log('===== 测试汇总 =====');
  const pass = results.filter(r => r.status === 'PASS').length;
  const warn = results.filter(r => r.status === 'WARN').length;
  const fail = results.filter(r => r.status === 'FAIL').length;
  console.log(`总页面: ${results.length} | PASS: ${pass} | WARN: ${warn} | FAIL: ${fail}`);
  console.log(`通过率（PASS+WARN）: ${(((pass + warn) / results.length) * 100).toFixed(1)}%`);

  if (fail > 0) {
    console.log('');
    console.log('--- FAIL 详情 ---');
    results.filter(r => r.status === 'FAIL').forEach(r => {
      console.log(`  ${r.name} (${r.path}): ${r.issues}`);
    });
  }

  if (warn > 0) {
    console.log('');
    console.log('--- WARN 详情 ---');
    results.filter(r => r.status === 'WARN').forEach(r => {
      console.log(`  ${r.name} (${r.path}): ${r.issues}`);
    });
  }

  fs.writeFileSync(
    path.join(SCREENSHOT_DIR, 'results.json'),
    JSON.stringify({ timestamp: new Date().toISOString(), summary: { total: results.length, pass, warn, fail }, results }, null, 2),
  );

  console.log('');
  console.log(`截图保存: ${SCREENSHOT_DIR}/`);

  await browser.close();
}

main().catch(err => {
  console.error('脚本执行失败:', err.message);
  process.exit(1);
});
