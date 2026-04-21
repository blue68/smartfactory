import { chromium } from 'playwright';
import fs from 'node:fs';
const auth = JSON.parse(fs.readFileSync('/tmp/factory002_auth.json','utf8'));
const data = auth.data;
const browser = await chromium.launch({headless:true});
const context = await browser.newContext();
const page = await context.newPage();
page.on('console', msg => console.log('CONSOLE', msg.type(), msg.text()));
page.on('pageerror', err => console.log('PAGEERROR', err.stack || err.message));
page.on('requestfailed', req => console.log('REQFAIL', req.url(), req.failure()?.errorText));
await page.addInitScript((payload) => {
  window.sessionStorage.setItem('sf_access_token', payload.accessToken);
  window.localStorage.setItem('sf_user', JSON.stringify(payload.user));
  window.localStorage.setItem('sf_permission_snapshot', JSON.stringify(payload.permissionSnapshot));
}, data);
await page.goto('http://127.0.0.1/master-data/process-config', {waitUntil:'networkidle', timeout: 30000});
console.log('TITLE', await page.title());
console.log('URL', page.url());
console.log('BODY_START', (await page.locator('body').innerText()).slice(0,500));
await page.screenshot({path:'/tmp/process_config_loaded.png', fullPage:true});
// click 完整编辑 if exists
const complete = page.getByRole('button', {name: '完整编辑'});
if (await complete.count()) {
  await complete.click();
  await page.waitForTimeout(1000);
  console.log('AFTER_COMPLETE_URL', page.url());
  console.log('AFTER_COMPLETE_BODY', (await page.locator('body').innerText()).slice(0,500));
  await page.screenshot({path:'/tmp/process_config_after_complete.png', fullPage:true});
}
// go back if nav happened
if (!page.url().includes('/master-data/process-config')) {
  await page.goto('http://127.0.0.1/master-data/process-config', {waitUntil:'networkidle', timeout:30000});
}
const addBtn = page.getByRole('button', {name: '添加工序'}).first();
if (await addBtn.count()) {
  await addBtn.click();
  await page.waitForTimeout(1000);
  console.log('AFTER_ADD_URL', page.url());
  console.log('AFTER_ADD_BODY', (await page.locator('body').innerText()).slice(0,500));
  await page.screenshot({path:'/tmp/process_config_after_add.png', fullPage:true});
}
await browser.close();
