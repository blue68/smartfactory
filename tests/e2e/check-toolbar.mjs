import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: false, channel: 'chrome' });
const ctx = await browser.newContext({ viewport: { width: 768, height: 900 } });
const page = await ctx.newPage();
await page.goto('http://localhost');
await page.fill('input[name="tenantCode"]', 'FACTORY001');
await page.fill('input[name="username"]', 'admin');
await page.fill('input[name="password"]', 'admin123');
await page.click('button[type="submit"]');
await page.waitForTimeout(2000);
await page.evaluate(() => { window.history.pushState({}, '', '/master-data/supplier'); window.dispatchEvent(new PopStateEvent('popstate')); });
await page.waitForTimeout(2000);

const info = await page.evaluate(() => {
  const els = document.querySelectorAll('[class*="toolbar"]');
  return Array.from(els).map(el => ({
    cls: el.className?.substring(0, 60),
    flexDir: window.getComputedStyle(el).flexDirection,
    hasSearch: el.querySelector('[class*="search"]') !== null,
  }));
});
console.log(JSON.stringify(info, null, 2));
await browser.close();
