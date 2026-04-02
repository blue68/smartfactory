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
  const btns = document.querySelectorAll('button');
  for (const btn of btns) {
    if (btn.className && btn.className.includes('sku_code')) {
      const cs = window.getComputedStyle(btn);
      return {
        className: btn.className,
        computedFont: cs.fontFamily,
        parentFont: btn.parentElement ? window.getComputedStyle(btn.parentElement).fontFamily : 'no parent',
        element: btn.tagName,
      };
    }
  }
  const el = document.querySelector('[class*="sku_code"]');
  if (el) {
    const cs = window.getComputedStyle(el);
    return { className: el.className, computedFont: cs.fontFamily, parentFont: el.parentElement ? window.getComputedStyle(el.parentElement).fontFamily : 'no parent', element: el.tagName };
  }
  return 'not found';
});
console.log(JSON.stringify(info, null, 2));
await browser.close();
