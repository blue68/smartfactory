import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: false, channel: 'chrome' });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.goto('http://localhost');
await page.fill('input[name="tenantCode"]', 'FACTORY001');
await page.fill('input[name="username"]', 'admin');
await page.fill('input[name="password"]', 'admin123');
await page.click('button[type="submit"]');
await page.waitForTimeout(2000);
await page.evaluate(() => { window.history.pushState({}, '', '/master-data/sku'); window.dispatchEvent(new PopStateEvent('popstate')); });
await page.waitForTimeout(2000);

const info = await page.evaluate(() => {
  // Check ALL elements matching [class*="sku_code"]
  const els = document.querySelectorAll('[class*="sku_code"]');
  return Array.from(els).slice(0, 5).map(el => ({
    tag: el.tagName,
    cls: el.className,
    font: window.getComputedStyle(el).fontFamily
  }));
});
console.log(JSON.stringify(info, null, 2));
await browser.close();
