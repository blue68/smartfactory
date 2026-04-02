/**
 * 调试白屏页面 — 捕获详细控制台错误
 */
import { chromium } from 'playwright';

const BASE_URL = 'http://localhost';

async function spaNavigate(page, targetPath) {
  await page.evaluate((p) => {
    window.history.pushState({}, '', p);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, targetPath);
  await page.waitForTimeout(3000);
}

async function main() {
  const browser = await chromium.launch({ headless: false, channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  // 登录
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });
  await page.fill('#username', 'admin');
  await page.fill('#password', 'admin123');
  await page.fill('#tenantCode', 'FACTORY001');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(2000);
  console.log('登录成功');

  // 先测一个正常页面确认 app 正常
  console.log('\n=== 测试正常页面 /inventory ===');
  page.on('console', msg => console.log(`  [${msg.type()}] ${msg.text()}`));
  page.on('pageerror', err => console.log(`  [PAGE_ERROR] ${err.message}`));
  await spaNavigate(page, '/inventory');
  const bodyLen1 = await page.evaluate(() => document.body?.innerText?.length || 0);
  console.log(`  body text length: ${bodyLen1}`);

  // 测试排产建议
  console.log('\n=== 测试 /schedule-suggestions ===');
  await spaNavigate(page, '/schedule-suggestions');
  const bodyLen2 = await page.evaluate(() => document.body?.innerText?.length || 0);
  console.log(`  body text length: ${bodyLen2}`);
  const html2 = await page.evaluate(() => document.querySelector('#root')?.innerHTML?.substring(0, 500) || 'empty');
  console.log(`  #root innerHTML: ${html2}`);

  // 测试 AI 助手
  console.log('\n=== 测试 /ai-chat ===');
  await spaNavigate(page, '/ai-chat');
  const bodyLen3 = await page.evaluate(() => document.body?.innerText?.length || 0);
  console.log(`  body text length: ${bodyLen3}`);
  const html3 = await page.evaluate(() => document.querySelector('#root')?.innerHTML?.substring(0, 500) || 'empty');
  console.log(`  #root innerHTML: ${html3}`);

  await browser.close();
}

main().catch(err => { console.error(err.message); process.exit(1); });
