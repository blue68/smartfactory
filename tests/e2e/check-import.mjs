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

// Click import button
const importBtn = page.locator('button').filter({ hasText: /导入/ });
await importBtn.first().click();
await page.waitForTimeout(1500);

// Check what's in the modal
const info = await page.evaluate(() => {
  const modal = document.querySelector('[role="dialog"], [class*="modal"], [class*="Modal"]');
  if (!modal) return 'no modal found';
  // Get all class names containing "upload"
  const els = modal.querySelectorAll('*');
  const uploadEls = [];
  for (const el of els) {
    if (el.className && typeof el.className === 'string' && el.className.includes('upload')) {
      uploadEls.push({ tag: el.tagName, cls: el.className.substring(0, 80) });
    }
  }
  // Also check for input type file
  const files = modal.querySelectorAll('input[type="file"]');
  return { uploadEls, fileInputs: files.length, modalClass: modal.className?.substring(0, 80) };
});
console.log(JSON.stringify(info, null, 2));
await browser.close();
