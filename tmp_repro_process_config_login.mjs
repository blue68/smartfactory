import { chromium } from 'playwright';
const browser = await chromium.launch({headless:true});
const page = await browser.newPage();
page.on('console', msg => console.log('CONSOLE', msg.type(), msg.text()));
page.on('pageerror', err => console.log('PAGEERROR', err.stack || err.message));
page.on('requestfailed', req => console.log('REQFAIL', req.url(), req.failure()?.errorText));
await page.goto('http://127.0.0.1/login', {waitUntil:'networkidle'});
await page.getByLabel('账号').fill('Ld_admin').catch(async()=>{ await page.locator('input').nth(0).fill('Ld_admin'); });
await page.getByLabel('密码').fill('123456').catch(async()=>{ await page.locator('input[type="password"]').fill('123456'); });
await page.getByLabel('工厂编码').fill('FACTORY002').catch(async()=>{ await page.locator('input').nth(2).fill('FACTORY002'); });
await page.getByRole('button', {name:'登录'}).click();
await page.waitForLoadState('networkidle', {timeout:30000}).catch(()=>{});
console.log('POSTLOGIN_URL', page.url());
console.log('POSTLOGIN_BODY', (await page.locator('body').innerText()).slice(0,1200));
await page.goto('http://127.0.0.1/master-data/process-config', {waitUntil:'networkidle', timeout:30000}).catch(e=>console.log('GOTOERR',e.message));
console.log('PROCESS_URL', page.url());
console.log('PROCESS_BODY', (await page.locator('body').innerText()).slice(0,1200));
await page.screenshot({path:'/tmp/processcfg_page.png', fullPage:true});
const complete = page.getByRole('button', {name:'完整编辑'});
if (await complete.count()) {
  await complete.click();
  await page.waitForTimeout(1000);
  console.log('AFTER_COMPLETE_URL', page.url());
  console.log('AFTER_COMPLETE_BODY', (await page.locator('body').innerText()).slice(0,1200));
  await page.screenshot({path:'/tmp/processcfg_after_complete.png', fullPage:true});
}
await browser.close();
