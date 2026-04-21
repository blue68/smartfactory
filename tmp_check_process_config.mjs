import { chromium } from 'playwright';
const browser = await chromium.launch({headless:true});
const page = await browser.newPage();
page.on('console', msg => console.log('CONSOLE', msg.type(), msg.text()));
page.on('pageerror', err => console.log('PAGEERROR', err.stack || err.message));
page.on('requestfailed', req => console.log('REQFAIL', req.url(), req.failure()?.errorText));
try {
  await page.goto('http://127.0.0.1/master-data/process-config', {waitUntil:'networkidle', timeout: 30000});
} catch (e) { console.log('GOTOERR', e.message); }
console.log('TITLE', await page.title());
console.log('URL', page.url());
console.log('BODY', (await page.locator('body').innerText().catch(()=>'' )).slice(0,1000));
await page.screenshot({path:'/tmp/check_process_config.png', fullPage:true}).catch(e => console.log('SHOTERR', e.message));
await browser.close();
