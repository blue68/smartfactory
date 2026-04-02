/**
 * AI 助手页面功能详细测试
 */
import { chromium } from 'playwright';

const BASE_URL = 'http://localhost';

async function spaNavigate(page, targetPath) {
  await page.evaluate((p) => {
    window.history.pushState({}, '', p);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, targetPath);
  await page.waitForTimeout(2000);
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

  console.log('>> 导航到 AI 助手');
  await spaNavigate(page, '/ai-chat');

  // 1. 检查对话界面
  const chatElements = await page.locator('[class*="chat"]').count();
  console.log(`✓ 聊天区域元素: ${chatElements}`);

  // 2. 检查输入框（input 标签而非 textarea）
  const input = page.locator('input[aria-label="向 AI 助手提问"]');
  const inputCount = await input.count();
  console.log(`✓ 输入框: ${inputCount} (aria-label 定位)`);

  // 3. 检查发送按钮（aria-label="发送"）
  const sendBtn = page.locator('button[aria-label="发送"]');
  const sendCount = await sendBtn.count();
  console.log(`✓ 发送按钮: ${sendCount} (aria-label 定位)`);

  // 4. 输入消息
  if (inputCount > 0) {
    await input.fill('当前库存情况如何？');
    console.log('✓ 已输入消息');
    await page.waitForTimeout(500);

    // 5. 点击发送
    if (sendCount > 0) {
      const isEnabled = await sendBtn.isEnabled();
      console.log(`✓ 发送按钮状态: ${isEnabled ? '可用' : '禁用'}`);

      if (isEnabled) {
        await sendBtn.click();
        console.log('✓ 已点击发送');

        // 等待 AI 响应
        await page.waitForTimeout(5000);

        // 检查消息列表
        const messages = await page.locator('[class*="message"], [class*="Message"], [class*="bubble"]').count();
        console.log(`✓ 消息气泡数: ${messages}`);

        // 检查是否有"思考中"状态
        const thinking = await page.locator('[class*="thinking"], [class*="loading"], [class*="typing"]').count();
        console.log(`✓ 思考中状态: ${thinking}`);

        // 检查 AI 回复内容
        const bodyText = await page.evaluate(() => document.body?.innerText || '');
        const hasResponse = bodyText.includes('库存') || bodyText.includes('AI') || bodyText.length > 500;
        console.log(`✓ AI 回复检测: ${hasResponse ? '有回复' : '未检测到回复'}`);
      }
    }
  }

  // 6. 检查快捷问题按钮
  const quickBtns = await page.locator('button[class*="quick"], button[class*="suggest"], [class*="quick"]').count();
  console.log(`✓ 快捷问题按钮: ${quickBtns}`);

  // 7. 截图
  await page.screenshot({ path: 'tests/e2e/screenshots-functional/func_ai_chat_detailed.png' });
  console.log('✓ 截图已保存');

  console.log('\n>> AI 助手功能测试完成');
  await browser.close();
}

main().catch(err => { console.error(err.message); process.exit(1); });
