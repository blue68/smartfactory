/**
 * [artifact:自动化测试] — 登录页像素级 UI 审计
 *
 * 对照设计系统规范 v1.0，逐一检查：
 *   色彩、字体、间距、圆角、阴影、交互状态、响应式、无障碍
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const BASE = 'http://localhost';
const DIR = path.join(import.meta.dirname, 'screenshots-login-audit');
const ISSUES = [];
let CHECKS = 0;
let PASS = 0;

function check(name, actual, expected, tolerance = 0) {
  CHECKS++;
  const numActual = typeof actual === 'string' ? parseFloat(actual) : actual;
  const numExpected = typeof expected === 'string' ? parseFloat(expected) : expected;
  const isNum = typeof numActual === 'number' && !isNaN(numActual) && typeof numExpected === 'number' && !isNaN(numExpected);

  let ok;
  if (isNum) {
    ok = Math.abs(numActual - numExpected) <= tolerance;
  } else {
    // String comparison — normalize
    const a = String(actual).trim().toLowerCase().replace(/\s+/g, ' ');
    const e = String(expected).trim().toLowerCase().replace(/\s+/g, ' ');
    ok = a === e;
  }

  if (ok) {
    PASS++;
    console.log(`  ✓ ${name}: ${actual}`);
  } else {
    const issue = { name, actual: String(actual), expected: String(expected) };
    ISSUES.push(issue);
    console.log(`  ✗ ${name}: 实际=${actual}  期望=${expected}`);
  }
  return ok;
}

function colorToHex(c) {
  if (!c) return '';
  // handle rgb(r, g, b) / rgba(r, g, b, a)
  const m = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (m) {
    return '#' + [m[1], m[2], m[3]].map(x => (+x).toString(16).padStart(2, '0')).join('').toUpperCase();
  }
  return c.toUpperCase();
}

async function main() {
  fs.mkdirSync(DIR, { recursive: true });

  const browser = await chromium.launch({ headless: false, channel: 'chrome' });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║       登录页像素级 UI 审计（对照设计系统 v1.0）           ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  // ── 1. 加载登录页 ──────────────────────────────────────
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(DIR, '01_login_initial.png'), fullPage: true });

  // ── 2. 页面背景 ──────────────────────────────────────
  console.log('\n─── 页面背景 ───');
  const pageBg = await page.evaluate(() => {
    const el = document.querySelector('[class*="page"]') || document.querySelector('div');
    return window.getComputedStyle(el).backgroundImage;
  });
  // Design: linear-gradient(135deg, --color-primary-900 #1E3A8A, --color-primary-700 #1D4ED8)
  const hasGradient = pageBg.includes('gradient');
  check('背景渐变', hasGradient ? '有渐变' : '无渐变', '有渐变');
  if (hasGradient) {
    // Check gradient contains correct colors
    const has900 = pageBg.toLowerCase().includes('30, 58, 138') || pageBg.toLowerCase().includes('1e3a8a');
    const has700 = pageBg.toLowerCase().includes('29, 78, 216') || pageBg.toLowerCase().includes('1d4ed8');
    check('渐变起点(primary-900)', has900 ? '#1E3A8A' : pageBg.substring(0, 80), '#1E3A8A');
    check('渐变终点(primary-700)', has700 ? '#1D4ED8' : pageBg.substring(0, 80), '#1D4ED8');
  }

  const pageMinH = await page.evaluate(() => {
    const el = document.querySelector('[class*="page"]');
    return el ? window.getComputedStyle(el).minHeight : '';
  });
  check('页面最小高度', pageMinH, '100vh');

  const pageDisplay = await page.evaluate(() => {
    const el = document.querySelector('[class*="page"]');
    return el ? window.getComputedStyle(el).display : '';
  });
  check('页面布局', pageDisplay, 'flex');

  const pageAlign = await page.evaluate(() => {
    const el = document.querySelector('[class*="page"]');
    return el ? window.getComputedStyle(el).alignItems : '';
  });
  check('页面垂直居中', pageAlign, 'center');

  const pageJustify = await page.evaluate(() => {
    const el = document.querySelector('[class*="page"]');
    return el ? window.getComputedStyle(el).justifyContent : '';
  });
  check('页面水平居中', pageJustify, 'center');

  // ── 3. 卡片样式 ──────────────────────────────────────
  console.log('\n─── 登录卡片 ───');
  const cardStyles = await page.evaluate(() => {
    const el = document.querySelector('[class*="card"]');
    if (!el) return null;
    const s = window.getComputedStyle(el);
    return {
      maxWidth: s.maxWidth,
      bg: s.backgroundColor,
      borderRadius: s.borderRadius,
      boxShadow: s.boxShadow,
      paddingTop: s.paddingTop,
      paddingBottom: s.paddingBottom,
      paddingLeft: s.paddingLeft,
      paddingRight: s.paddingRight,
      width: el.getBoundingClientRect().width,
    };
  });

  if (cardStyles) {
    check('卡片最大宽度', cardStyles.maxWidth, '400px');
    check('卡片背景色', colorToHex(cardStyles.bg), '#FFFFFF');
    check('卡片圆角(radius-xl=16px)', cardStyles.borderRadius, '16px');
    // shadow-xl: 0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04)
    const hasShadow = cardStyles.boxShadow && cardStyles.boxShadow !== 'none';
    check('卡片阴影(shadow-xl)', hasShadow ? '有阴影' : '无阴影', '有阴影');
    // padding: space-10(40px) space-8(32px)
    check('卡片上内边距(space-10=40px)', parseFloat(cardStyles.paddingTop), 40, 1);
    check('卡片下内边距(space-10=40px)', parseFloat(cardStyles.paddingBottom), 40, 1);
    check('卡片左内边距(space-8=32px)', parseFloat(cardStyles.paddingLeft), 32, 1);
    check('卡片右内边距(space-8=32px)', parseFloat(cardStyles.paddingRight), 32, 1);
  }

  // ── 4. Logo 区域 ──────────────────────────────────────
  console.log('\n─── Logo 区域 ───');
  const logoStyles = await page.evaluate(() => {
    const logo = document.querySelector('[class*="logo"]');
    if (!logo) return null;
    const s = window.getComputedStyle(logo);
    const icon = logo.querySelector('[class*="icon"]');
    const title = logo.querySelector('h1, [class*="text"]');
    const sub = logo.querySelector('p, [class*="sub"]');
    return {
      textAlign: s.textAlign,
      marginBottom: s.marginBottom,
      iconFontSize: icon ? window.getComputedStyle(icon).fontSize : '',
      iconContent: icon ? icon.textContent?.trim() : '',
      titleFontSize: title ? window.getComputedStyle(title).fontSize : '',
      titleFontWeight: title ? window.getComputedStyle(title).fontWeight : '',
      titleColor: title ? window.getComputedStyle(title).color : '',
      titleText: title ? title.textContent?.trim() : '',
      subFontSize: sub ? window.getComputedStyle(sub).fontSize : '',
      subColor: sub ? window.getComputedStyle(sub).color : '',
      subText: sub ? sub.textContent?.trim() : '',
      subMarginTop: sub ? window.getComputedStyle(sub).marginTop : '',
    };
  });

  if (logoStyles) {
    check('Logo居中对齐', logoStyles.textAlign, 'center');
    check('Logo下方间距(space-8=32px)', parseFloat(logoStyles.marginBottom), 32, 1);
    check('Logo图标字号(3rem=48px)', parseFloat(logoStyles.iconFontSize), 48, 2);
    check('产品名称文字', logoStyles.titleText, '智造管家');
    // Design: H2 = 1.5rem = 24px, weight 700
    check('产品名称字号(H2=24px)', parseFloat(logoStyles.titleFontSize), 24, 1);
    check('产品名称字重(700)', logoStyles.titleFontWeight, '700');
    check('产品名称颜色(text-primary=#1E293B)', colorToHex(logoStyles.titleColor), '#1E293B');
    check('副标题文字', logoStyles.subText, 'SmartFactory Agent');
    // Design: body-s = 0.75rem = 12px
    check('副标题字号(body-s=12px)', parseFloat(logoStyles.subFontSize), 12, 1);
    check('副标题颜色(text-secondary=#64748B)', colorToHex(logoStyles.subColor), '#64748B');
    check('副标题上间距(space-1=4px)', parseFloat(logoStyles.subMarginTop), 4, 1);
  }

  // ── 5. 表单整体布局 ──────────────────────────────────
  console.log('\n─── 表单布局 ───');
  const formStyles = await page.evaluate(() => {
    const form = document.querySelector('form, [class*="form"]');
    if (!form) return null;
    const s = window.getComputedStyle(form);
    return {
      display: s.display,
      flexDirection: s.flexDirection,
      gap: s.gap,
    };
  });

  if (formStyles) {
    check('表单布局方向', formStyles.flexDirection, 'column');
    // Design: gap space-5 = 1.25rem = 20px
    check('表单字段间距(space-5=20px)', parseFloat(formStyles.gap), 20, 1);
  }

  // ── 6. 输入框样式 ──────────────────────────────────────
  console.log('\n─── 输入框样式 ───');
  const inputStyles = await page.evaluate(() => {
    const inputs = document.querySelectorAll('input[class*="input"]');
    if (inputs.length === 0) return null;
    const el = inputs[0];
    const s = window.getComputedStyle(el);
    return {
      count: inputs.length,
      height: s.height,
      paddingLeft: s.paddingLeft,
      paddingRight: s.paddingRight,
      borderWidth: s.borderWidth,
      borderStyle: s.borderStyle,
      borderColor: s.borderColor,
      borderRadius: s.borderRadius,
      fontSize: s.fontSize,
      color: s.color,
      bg: s.backgroundColor,
      width: s.width,
    };
  });

  if (inputStyles) {
    check('输入框数量', inputStyles.count, 3);
    // Design spec 4.2: Web端 height 40px（但 LoginPage.module.css 写了 44px，需对照设计规范修正）
    check('输入框高度(设计规范=40px)', parseFloat(inputStyles.height), 40, 2);
    // padding 0 space-4(16px)
    check('输入框左内边距(16px)', parseFloat(inputStyles.paddingLeft), 16, 1);
    check('输入框右内边距(16px)', parseFloat(inputStyles.paddingRight), 16, 1);
    // border: 1px solid border-default (#E2E8F0)
    check('输入框边框宽度(1px)', inputStyles.borderWidth, '1px');
    check('输入框边框颜色(#E2E8F0)', colorToHex(inputStyles.borderColor), '#E2E8F0');
    // radius-md = 8px
    check('输入框圆角(radius-md=8px)', inputStyles.borderRadius, '8px');
    // font body-m = 14px
    check('输入框字号(body-m=14px)', parseFloat(inputStyles.fontSize), 14, 1);
    check('输入框文字色(text-primary=#1E293B)', colorToHex(inputStyles.color), '#1E293B');
    check('输入框背景色(bg-card=#FFFFFF)', colorToHex(inputStyles.bg), '#FFFFFF');
  }

  // ── 7. 标签样式 ──────────────────────────────────────
  console.log('\n─── 标签样式 ───');
  const labelStyles = await page.evaluate(() => {
    const labels = document.querySelectorAll('label[class*="label"]');
    if (labels.length === 0) return null;
    const el = labels[0];
    const s = window.getComputedStyle(el);
    return {
      count: labels.length,
      fontSize: s.fontSize,
      fontWeight: s.fontWeight,
      color: s.color,
      text0: labels[0]?.textContent?.trim(),
      text1: labels[1]?.textContent?.trim(),
      text2: labels[2]?.textContent?.trim(),
    };
  });

  if (labelStyles) {
    check('标签数量', labelStyles.count, 3);
    // Design: text-label = 0.75rem = 12px, weight 500
    check('标签字号(text-label=12px)', parseFloat(labelStyles.fontSize), 12, 1);
    check('标签字重(500)', labelStyles.fontWeight, '500');
    check('标签颜色(text-secondary=#64748B)', colorToHex(labelStyles.color), '#64748B');
    check('标签1文字', labelStyles.text0, '账号');
    check('标签2文字', labelStyles.text1, '密码');
    check('标签3文字', labelStyles.text2, '工厂编码');
  }

  // ── 8. 字段容器间距 ──────────────────────────────────
  console.log('\n─── 字段容器 ───');
  const fieldStyles = await page.evaluate(() => {
    const fields = document.querySelectorAll('[class*="field"]');
    if (fields.length === 0) return null;
    const s = window.getComputedStyle(fields[0]);
    return {
      display: s.display,
      flexDirection: s.flexDirection,
      gap: s.gap,
    };
  });

  if (fieldStyles) {
    check('字段布局方向', fieldStyles.flexDirection, 'column');
    // gap space-2 = 0.5rem = 8px
    check('标签与输入框间距(space-2=8px)', parseFloat(fieldStyles.gap), 8, 1);
  }

  // ── 9. 登录按钮 ──────────────────────────────────────
  console.log('\n─── 登录按钮 ───');
  const btnStyles = await page.evaluate(() => {
    const btn = document.querySelector('button[type="submit"]');
    if (!btn) return null;
    const s = window.getComputedStyle(btn);
    return {
      text: btn.textContent?.trim(),
      height: s.height,
      fontSize: s.fontSize,
      fontWeight: s.fontWeight,
      bg: s.backgroundColor,
      color: s.color,
      borderRadius: s.borderRadius,
      width: s.width,
      parentWidth: btn.parentElement ? window.getComputedStyle(btn.parentElement).width : '',
      paddingLeft: s.paddingLeft,
      paddingRight: s.paddingRight,
    };
  });

  if (btnStyles) {
    check('按钮文字', btnStyles.text, '登录');
    // Design: btn--lg = 48px height, 20px padding, 16px font
    check('按钮高度(btn-lg=48px)', parseFloat(btnStyles.height), 48, 2);
    check('按钮字号(16px)', parseFloat(btnStyles.fontSize), 16, 1);
    check('按钮字重(500)', btnStyles.fontWeight, '500');
    // primary: bg = primary-500 = #3B82F6
    check('按钮背景(primary-500=#3B82F6)', colorToHex(btnStyles.bg), '#3B82F6');
    check('按钮文字色(白色)', colorToHex(btnStyles.color), '#FFFFFF');
    check('按钮圆角(radius-md=8px)', btnStyles.borderRadius, '8px');
    // fullWidth: btn width == parent width
    const isFullWidth = parseFloat(btnStyles.width) >= parseFloat(btnStyles.parentWidth) - 2;
    check('按钮全宽', isFullWidth ? '全宽' : `${btnStyles.width}/${btnStyles.parentWidth}`, '全宽');
  }

  // ── 10. 底部信息 ──────────────────────────────────────
  console.log('\n─── 底部信息 ───');
  const footerStyles = await page.evaluate(() => {
    const el = document.querySelector('[class*="footer"]');
    if (!el) return null;
    const s = window.getComputedStyle(el);
    return {
      text: el.textContent?.trim(),
      textAlign: s.textAlign,
      fontSize: s.fontSize,
      color: s.color,
      marginTop: s.marginTop,
    };
  });

  if (footerStyles) {
    check('底部文字', footerStyles.text, '智造管家 · 让中小工厂用上 AI');
    check('底部居中', footerStyles.textAlign, 'center');
    // body-s = 12px
    check('底部字号(body-s=12px)', parseFloat(footerStyles.fontSize), 12, 1);
    // text-disabled = #94A3B8
    check('底部颜色(text-disabled=#94A3B8)', colorToHex(footerStyles.color), '#94A3B8');
    // margin-top space-6 = 24px
    check('底部上间距(space-6=24px)', parseFloat(footerStyles.marginTop), 24, 1);
  }

  // ── 11. Focus 状态交互 ──────────────────────────────────
  console.log('\n─── Focus 交互状态 ───');
  await page.click('#username');
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(DIR, '02_input_focus.png') });

  const focusStyles = await page.evaluate(() => {
    const el = document.querySelector('#username');
    if (!el) return null;
    const s = window.getComputedStyle(el);
    return {
      borderColor: s.borderColor,
      borderWidth: s.borderWidth,
      boxShadow: s.boxShadow,
      outlineStyle: s.outlineStyle,
    };
  });

  if (focusStyles) {
    // Design spec 4.2: Focus → border-color primary-500 (#3B82F6) 2px
    // Current CSS: 1px border with border-color change + box-shadow ring
    check('Focus边框色(primary-500=#3B82F6)', colorToHex(focusStyles.borderColor), '#3B82F6');
    const hasFocusRing = focusStyles.boxShadow && focusStyles.boxShadow !== 'none';
    check('Focus蓝光环', hasFocusRing ? '有' : '无', '有');
  }

  // ── 12. Placeholder 文字 ──────────────────────────────
  console.log('\n─── Placeholder ───');
  const placeholders = await page.evaluate(() => {
    return {
      username: document.querySelector('#username')?.getAttribute('placeholder'),
      password: document.querySelector('#password')?.getAttribute('placeholder'),
      tenantCode: document.querySelector('#tenantCode')?.getAttribute('placeholder'),
    };
  });
  check('账号placeholder', placeholders.username, '请输入登录账号');
  check('密码placeholder', placeholders.password, '请输入密码');
  check('工厂编码placeholder', placeholders.tenantCode, '工厂唯一编码');

  // ── 13. 输入框 autocomplete 属性 ──────────────────────
  console.log('\n─── autocomplete 无障碍 ───');
  const autocompletes = await page.evaluate(() => {
    return {
      username: document.querySelector('#username')?.getAttribute('autocomplete'),
      password: document.querySelector('#password')?.getAttribute('autocomplete'),
      tenantCode: document.querySelector('#tenantCode')?.getAttribute('autocomplete'),
    };
  });
  check('username autocomplete', autocompletes.username, 'username');
  check('password autocomplete', autocompletes.password, 'current-password');

  // ── 14. 按钮 Hover 状态 ──────────────────────────────
  console.log('\n─── 按钮 Hover 状态 ───');
  const submitBtn = page.locator('button[type="submit"]');
  await submitBtn.hover();
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(DIR, '03_btn_hover.png') });

  const hoverBg = await page.evaluate(() => {
    const btn = document.querySelector('button[type="submit"]');
    return btn ? window.getComputedStyle(btn).backgroundColor : '';
  });
  // Hover: primary-600 = #2563EB
  check('按钮Hover背景(primary-600=#2563EB)', colorToHex(hoverBg), '#2563EB');

  // ── 15. 错误提示状态 ──────────────────────────────────
  console.log('\n─── 错误提示状态 ───');
  // Submit empty form
  await submitBtn.click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(DIR, '04_error_state.png') });

  const alertStyles = await page.evaluate(() => {
    const alert = document.querySelector('.alert, [class*="alert"], [role="alert"]');
    if (!alert) return null;
    const s = window.getComputedStyle(alert);
    return {
      bg: s.backgroundColor,
      borderLeft: s.borderLeftWidth + ' ' + s.borderLeftStyle + ' ' + s.borderLeftColor,
      borderLeftWidth: s.borderLeftWidth,
      padding: s.padding,
      borderRadius: s.borderRadius,
      text: alert.textContent?.trim(),
    };
  });

  if (alertStyles) {
    check('错误提示文字', alertStyles.text?.replace(/[^\u4e00-\u9fff\w]/g, ''), '请输入账号和密码'.replace(/[^\u4e00-\u9fff\w]/g, ''));
    // Design: alert--error: bg error-50 (#FEF2F2), border-left 4px solid error-500 (#EF4444)
    check('错误提示背景(error-50=#FEF2F2)', colorToHex(alertStyles.bg), '#FEF2F2');
    check('错误提示左边框宽度(4px)', alertStyles.borderLeftWidth, '4px');
    check('错误提示圆角(radius-md=8px)', alertStyles.borderRadius, '8px');
  } else {
    ISSUES.push({ name: '错误提示组件', actual: '未找到', expected: '应显示alert--error' });
    console.log('  ✗ 错误提示组件: 未找到');
  }

  // ── 16. Loading 状态 ──────────────────────────────────
  console.log('\n─── Loading 状态 ───');
  // Fill valid data and submit to trigger loading
  await page.fill('#username', 'admin');
  await page.fill('#password', 'wrong_password_for_loading');

  // Check button disabled during loading by intercepting
  const loadingCheck = await page.evaluate(() => {
    const btn = document.querySelector('button[type="submit"]');
    return btn ? { ariaDisabled: btn.getAttribute('aria-busy') } : {};
  });

  // ── 17. 字体族检查 ──────────────────────────────────
  console.log('\n─── 字体族 ───');
  const fontFamily = await page.evaluate(() => {
    return window.getComputedStyle(document.body).fontFamily;
  });
  const hasPingFang = fontFamily.includes('PingFang');
  check('字体族包含PingFang SC', hasPingFang ? '包含' : fontFamily.substring(0, 60), '包含');

  // ── 18. 暗色模式支持检查 ──────────────────────────────
  console.log('\n─── 暗色模式 ───');
  // Check if CSS has dark mode media query
  const hasDarkMode = await page.evaluate(() => {
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules) {
          if (rule.conditionText?.includes('prefers-color-scheme: dark')) {
            return true;
          }
        }
      } catch {}
    }
    return false;
  });
  check('暗色模式CSS支持', hasDarkMode ? '支持' : '不支持', '支持');

  // ── 19. 响应式断点检查 ──────────────────────────────
  console.log('\n─── 响应式 — 768px 平板 ───');
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(DIR, '05_tablet_768.png') });

  const tablet768Card = await page.evaluate(() => {
    const card = document.querySelector('[class*="card"]');
    if (!card) return null;
    const s = window.getComputedStyle(card);
    return {
      paddingTop: s.paddingTop,
      paddingLeft: s.paddingLeft,
      borderRadius: s.borderRadius,
    };
  });

  if (tablet768Card) {
    // @768px: padding space-8(32px) space-6(24px), radius-lg(12px)
    check('768px卡片上边距(space-8=32px)', parseFloat(tablet768Card.paddingTop), 32, 1);
    check('768px卡片左边距(space-6=24px)', parseFloat(tablet768Card.paddingLeft), 24, 1);
    check('768px卡片圆角(radius-lg=12px)', tablet768Card.borderRadius, '12px');
  }

  console.log('\n─── 响应式 — 480px 手机 ───');
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(DIR, '06_mobile_375.png') });

  const mobile375Card = await page.evaluate(() => {
    const card = document.querySelector('[class*="card"]');
    if (!card) return null;
    const s = window.getComputedStyle(card);
    const rect = card.getBoundingClientRect();
    return {
      maxWidth: s.maxWidth,
      minHeight: s.minHeight,
      borderRadius: s.borderRadius,
      boxShadow: s.boxShadow,
      paddingTop: s.paddingTop,
      paddingLeft: s.paddingLeft,
      width: rect.width,
    };
  });

  if (mobile375Card) {
    // @480px: max-width 100%, min-height 100vh, radius 0, shadow none
    check('375px卡片全宽(100%)', mobile375Card.maxWidth, '100%');
    check('375px卡片全高(100vh)', mobile375Card.minHeight, '100vh');
    check('375px卡片无圆角', mobile375Card.borderRadius, '0px');
    check('375px卡片无阴影', mobile375Card.boxShadow, 'none');
    // padding: space-10(40px) space-5(20px)
    check('375px卡片上边距(space-10=40px)', parseFloat(mobile375Card.paddingTop), 40, 1);
    check('375px卡片左边距(space-5=20px)', parseFloat(mobile375Card.paddingLeft), 20, 1);
  }

  const mobilePage = await page.evaluate(() => {
    const page = document.querySelector('[class*="page"]');
    if (!page) return null;
    const s = window.getComputedStyle(page);
    return { padding: s.padding, alignItems: s.alignItems };
  });
  if (mobilePage) {
    check('375px页面无内边距', mobilePage.padding, '0px');
    check('375px页面拉伸', mobilePage.alignItems, 'stretch');
  }

  // 恢复桌面尺寸
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(500);

  // ── 20. HTML语义化检查 ──────────────────────────────
  console.log('\n─── HTML 语义化 ───');
  const semantics = await page.evaluate(() => {
    const form = document.querySelector('form');
    const labels = document.querySelectorAll('label[for]');
    const h1 = document.querySelector('h1');
    const ariaAlert = document.querySelector('[role="alert"]');
    return {
      hasForm: !!form,
      labelCount: labels.length,
      labelsHaveFor: Array.from(labels).every(l => {
        const forId = l.getAttribute('for');
        return forId && document.getElementById(forId);
      }),
      hasH1: !!h1,
      hasAlertRole: !!ariaAlert,
      inputsHaveId: Array.from(document.querySelectorAll('input')).every(i => !!i.id),
    };
  });

  check('使用<form>标签', semantics.hasForm ? '是' : '否', '是');
  check('所有<label>有for属性', semantics.labelsHaveFor ? '是' : '否', '是');
  check('有<h1>标题', semantics.hasH1 ? '是' : '否', '是');
  check('所有<input>有id', semantics.inputsHaveId ? '是' : '否', '是');

  // ── 21. 键盘导航检查 ──────────────────────────────────
  console.log('\n─── 键盘导航（Tab顺序）───');
  await page.click('#username');
  await page.keyboard.press('Tab');
  const focusAfterTab1 = await page.evaluate(() => document.activeElement?.id);
  check('Tab1聚焦密码框', focusAfterTab1, 'password');

  await page.keyboard.press('Tab');
  const focusAfterTab2 = await page.evaluate(() => document.activeElement?.id);
  check('Tab2聚焦工厂编码', focusAfterTab2, 'tenantCode');

  await page.keyboard.press('Tab');
  const focusAfterTab3 = await page.evaluate(() => document.activeElement?.tagName?.toLowerCase());
  check('Tab3聚焦提交按钮', focusAfterTab3, 'button');

  // ── 22. Enter提交表单 ──────────────────────────────────
  console.log('\n─── Enter 提交 ───');
  await page.fill('#username', 'admin');
  await page.fill('#password', 'admin123');
  await page.fill('#tenantCode', 'FACTORY001');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(3000);
  const afterEnter = page.url();
  check('Enter键可提交登录', afterEnter.includes('/dashboard') ? '跳转成功' : afterEnter, '跳转成功');

  // ── 23. 最终截图 ──────────────────────────────────────
  await page.screenshot({ path: path.join(DIR, '07_after_login.png') });

  // ════════════════════════════════════════════════════════
  // 汇总
  // ════════════════════════════════════════════════════════
  const FAIL = CHECKS - PASS;
  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║              登录页 UI 审计结果                           ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`  总检查点: ${CHECKS}`);
  console.log(`  ✓ PASS: ${PASS}`);
  console.log(`  ✗ FAIL: ${FAIL}`);
  console.log(`  通过率: ${((PASS / CHECKS) * 100).toFixed(1)}%`);

  if (ISSUES.length > 0) {
    console.log('\n  ─── 需修复的问题 ───');
    ISSUES.forEach((iss, i) => {
      console.log(`  ${i + 1}. ${iss.name}`);
      console.log(`     实际: ${iss.actual}`);
      console.log(`     期望: ${iss.expected}`);
    });
  }

  // 保存结果
  fs.writeFileSync(
    path.join(DIR, 'audit-result.json'),
    JSON.stringify({ timestamp: new Date().toISOString(), checks: CHECKS, pass: PASS, fail: FAIL, issues: ISSUES }, null, 2),
  );

  console.log(`\n  截图: ${DIR}/`);

  await browser.close();
}

main().catch(err => {
  console.error('审计脚本失败:', err.message);
  process.exit(1);
});
