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
const importBtn = page.locator('button').filter({ hasText: /导入/ });
await importBtn.first().click();
await page.waitForTimeout(1500);

// Broader search for upload elements
const info = await page.evaluate(() => {
  // Search entire page
  const allUpload = document.querySelectorAll('[class*="upload"]');
  const results = Array.from(allUpload).map(el => ({
    tag: el.tagName,
    cls: el.className?.substring?.(0, 80) || '',
    parent: el.parentElement?.className?.substring?.(0, 50) || ''
  }));
  // Also the drawer
  const drawer = document.querySelector('[class*="drawer"]');
  const drawerHTML = drawer ? drawer.innerHTML.substring(0, 500) : 'no drawer';
  return { uploadEls: results, drawerSnippet: drawerHTML };
});
console.log(JSON.stringify(info, null, 2));
await browser.close();
