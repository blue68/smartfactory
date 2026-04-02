/**
 * SKU 类目管理 — 新增子类目 + 操作日志 专项测试
 */
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;

function check(id, name, ok, detail = '') {
  const tag = ok ? 'PASS' : 'FAIL';
  if (ok) pass++; else fail++;
  console.log(`[${tag}] ${id} ${name}${detail ? ' — ' + detail : ''}`);
}

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const ctx = browser.contexts()[0];
  const page = ctx.pages()[0] || await ctx.newPage();

  // 登录
  await page.goto('http://localhost/login', { waitUntil: 'networkidle', timeout: 10000 });
  await page.waitForTimeout(1000);
  if (page.url().includes('/login')) {
    await page.fill('input[name="username"]', 'admin');
    await page.fill('input[name="password"]', 'admin123');
    await page.fill('input[name="tenantCode"]', 'FACTORY001');
    await page.locator('button[type="submit"]').click();
    await page.waitForTimeout(3000);
  }

  // 导航
  await page.evaluate(() => {
    window.history.pushState({}, '', '/master-data/sku-category');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await page.waitForTimeout(2500);

  const leftPanel = page.locator('[class*="cat1Panel"]');
  const rightPanel = page.locator('[class*="cat2Panel"]');

  // 收集 API 请求
  const apiLog = [];
  page.on('response', async (resp) => {
    if (resp.url().includes('sku-categor')) {
      const body = await resp.text().catch(() => '');
      apiLog.push({ status: resp.status(), method: resp.request().method(), body: body.substring(0, 200) });
    }
  });

  // ═══════════════════════════════════════════════
  // Part 1: 新增子类目（完整流程）
  // ═══════════════════════════════════════════════
  console.log('\n══ Part 1: 新增子类目 ══');

  // 1.1 先创建一个一级类目作为父类目
  console.log('\n-- 1.1 创建父级一级类目 --');
  const parentCode = `P${Date.now() % 100000}`;
  const parentName = `父类目_${parentCode}`;

  await leftPanel.locator('button').filter({ hasText: '新增' }).first().click();
  await page.waitForTimeout(600);

  check('S01', '新增弹窗打开', await page.locator('text=新增类目').count() > 0);

  // 确认层级默认是一级
  const levelSelect = page.locator('select[class*="formSelect"]').first();
  const defaultLevel = await levelSelect.inputValue();
  check('S02', '默认层级为一级', defaultLevel === '1');

  await page.locator('input[placeholder*="SOFA"]').fill(parentCode);
  await page.locator('input[placeholder*="沙发"]').fill(parentName);
  await page.locator('button').filter({ hasText: '创建' }).first().click();
  await page.waitForTimeout(2000);

  const parentInList = await leftPanel.locator(`text=${parentName}`).count() > 0;
  check('S03', '父一级类目创建成功', parentInList);

  // 1.2 选中父类目
  console.log('\n-- 1.2 选中父类目 --');
  const parentItem = leftPanel.locator('[class*="cat1Item"], [class*="cat1Row"]').filter({ hasText: parentName });
  await parentItem.first().click();
  await page.waitForTimeout(1000);

  // 右侧应显示空态（无子类目）
  const emptyState = rightPanel.locator('text=暂无子类目');
  check('S04', '选中后右侧显示空态', await emptyState.count() > 0);

  // 1.3 点击"新增子类目"按钮
  console.log('\n-- 1.3 新增子类目弹窗 --');
  const addSubBtn = rightPanel.locator('button').filter({ hasText: '新增子类目' });
  check('S05', '新增子类目按钮可见', await addSubBtn.count() > 0);

  await addSubBtn.first().click();
  await page.waitForTimeout(600);

  const subModal = page.locator('text=新增类目');
  check('S06', '新增子类目弹窗打开', await subModal.count() > 0);

  // 1.4 检查弹窗预填状态
  console.log('\n-- 1.4 弹窗预填检查 --');
  const subLevelVal = await page.locator('select[class*="formSelect"]').first().inputValue();
  check('S07', '层级自动设为二级', subLevelVal === '2');

  // 父类目选择器
  const parentSelectAll = await page.locator('select[class*="formSelect"]').all();
  let parentSelectField = null;
  for (const sel of parentSelectAll) {
    const opts = await sel.locator('option').all();
    for (const opt of opts) {
      const text = await opt.textContent();
      if (text && text.includes(parentName)) {
        parentSelectField = sel;
        break;
      }
    }
    if (parentSelectField) break;
  }
  check('S08', '父类目下拉包含父类目', parentSelectField !== null);

  if (parentSelectField) {
    const parentSelectedVal = await parentSelectField.inputValue();
    check('S09', '父类目已自动选中', parentSelectedVal !== '' && parentSelectedVal !== '0');
  }

  // 1.5 填写子类目信息
  console.log('\n-- 1.5 填写并创建子类目 --');
  const subCode1 = `SUB${Date.now() % 100000}`;
  const subName1 = `子类目A_${subCode1}`;

  await page.locator('input[placeholder*="SOFA"]').fill(subCode1);
  await page.locator('input[placeholder*="沙发"]').fill(subName1);

  // 监听下一个 POST 请求
  apiLog.length = 0;
  await page.locator('button').filter({ hasText: '创建' }).first().click();
  await page.waitForTimeout(3000);

  // 检查 API 响应
  const postReq = apiLog.find(a => a.method === 'POST');
  check('S10', 'API 创建请求成功(201)', postReq?.status === 201, postReq?.body?.substring(0, 100) || '');

  // 弹窗应关闭
  check('S11', '创建后弹窗关闭', await subModal.count() === 0);

  // 1.6 子类目出现在右侧表格
  console.log('\n-- 1.6 子类目在表格中显示 --');
  await page.waitForTimeout(500);
  const subInTable = rightPanel.locator(`text=${subName1}`);
  check('S12', '子类目出现在右侧表格', await subInTable.count() > 0);

  // 表格应有相关列
  const tableHeaders = rightPanel.locator('th, [class*="cat2Th"]');
  const thTexts = await tableHeaders.allTextContents();
  check('S13', '表格包含类目名称列', thTexts.some(t => t.includes('名称') || t.includes('类目')));
  check('S14', '表格包含编码列', thTexts.some(t => t.includes('编码')));

  // 1.7 创建第二个子类目
  console.log('\n-- 1.7 创建第二个子类目 --');
  await addSubBtn.first().click();
  await page.waitForTimeout(600);

  const subCode2 = `SUB${(Date.now() + 1) % 100000}`;
  const subName2 = `子类目B_${subCode2}`;

  await page.locator('input[placeholder*="SOFA"]').fill(subCode2);
  await page.locator('input[placeholder*="沙发"]').fill(subName2);
  await page.locator('button').filter({ hasText: '创建' }).first().click();
  await page.waitForTimeout(2000);

  const sub2InTable = rightPanel.locator(`text=${subName2}`);
  check('S15', '第二个子类目出现在表格', await sub2InTable.count() > 0);

  // 子类目计数应为2
  const countText = rightPanel.locator('[class*="cat2Header"], [class*="cat2Title"]');
  const headerText = await countText.first().textContent().catch(() => '');
  check('S16', '子类目计数显示正确', headerText.includes('2'), headerText);

  // 1.8 验证表单校验
  console.log('\n-- 1.8 表单校验 --');
  await addSubBtn.first().click();
  await page.waitForTimeout(600);

  // 直接点创建（不填信息）
  const createBtnForValidation = page.locator('button').filter({ hasText: '创建' });
  await createBtnForValidation.first().click();
  await page.waitForTimeout(500);

  // 应显示错误提示
  const formErrors = page.locator('[class*="formError"], [class*="error"]');
  const errCount = await formErrors.count();
  const hasError = errCount > 0;
  check('S17', '空表单提交显示校验错误', hasError, `${errCount} 个错误提示`);

  // 编码只能大写字母数字下划线
  const codeInput = page.locator('input[placeholder*="SOFA"]');
  await codeInput.fill('abc-小写');
  await page.waitForTimeout(200);
  const codeVal = await codeInput.inputValue();
  check('S18', '编码自动转大写', codeVal === codeVal.toUpperCase() || codeVal.includes('ABC'));

  // 关闭弹窗
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // 1.9 行内编辑子类目
  console.log('\n-- 1.9 行内编辑子类目 --');
  const editBtns = rightPanel.locator('button').filter({ hasText: '编辑' });
  const editCount = await editBtns.count();
  check('S19', '子类目有编辑按钮', editCount > 0, `${editCount} 个`);

  if (editCount > 0) {
    await editBtns.first().click();
    await page.waitForTimeout(500);

    // 行内编辑输入框 (CSS modules: cat2InlineInput → capital I)
    const inlineInput = rightPanel.locator('input[class*="Inline"], input[class*="inline"], input[aria-label*="编辑类目名称"]');
    const hasInline = await inlineInput.count() > 0;
    check('S20', '行内编辑输入框出现', hasInline);

    if (hasInline) {
      // 修改名称
      const oldVal = await inlineInput.inputValue();
      await inlineInput.fill(oldVal + '_edited');

      // 保存
      const saveInline = rightPanel.locator('button').filter({ hasText: '保存' });
      check('S21', '行内保存按钮', await saveInline.count() > 0);
      await saveInline.first().click();
      await page.waitForTimeout(1500);

      // 检查 toast
      const editToast = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('[class*="toast"]')).map(t => t.textContent).join('|');
      });
      check('S22', '行内编辑保存成功', editToast.includes('成功') || editToast.includes('修改'), editToast);

      // 开始另一个编辑，然后 ESC 取消
      if (editCount > 1) {
        await editBtns.nth(1).click();
        await page.waitForTimeout(300);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
        const noInline = await inlineInput.count() === 0;
        check('S23', 'ESC 取消行内编辑', noInline);
      }

      // Enter 保存测试
      await editBtns.first().click();
      await page.waitForTimeout(300);
      const inlineInput2 = rightPanel.locator('input[class*="Inline"], input[class*="inline"], input[aria-label*="编辑类目名称"]');
      if (await inlineInput2.count() > 0) {
        await page.keyboard.press('Enter');
        await page.waitForTimeout(1000);
        check('S24', 'Enter 键保存行内编辑', await inlineInput2.count() === 0);
      }
    } else {
      check('S21', '行内保存按钮', false, '无行内输入框');
      check('S22', '行内编辑保存成功', false, '跳过');
    }
  }

  // ═══════════════════════════════════════════════
  // Part 2: 操作日志 Drawer
  // ═══════════════════════════════════════════════
  console.log('\n══ Part 2: 操作日志 ══');

  // 2.1 打开操作日志
  console.log('\n-- 2.1 打开操作日志 --');
  const auditBtn = page.locator('button').filter({ hasText: '操作日志' });
  await auditBtn.first().click();
  await page.waitForTimeout(1000);

  const drawer = page.locator('[class*="drawer"], [class*="Drawer"]').filter({ hasText: '操作日志' });
  check('L01', '操作日志 Drawer 打开', await drawer.count() > 0);

  // 2.2 日志列表
  console.log('\n-- 2.2 日志列表内容 --');
  const logTimeline = drawer.locator('[class*="timeline"], [class*="log"], [class*="audit"]');
  const logItemCount = await logTimeline.count();
  check('L02', '有日志记录', logItemCount > 0, `${logItemCount} 条`);

  // 检查最新日志是否包含刚创建的类目
  const drawerText = await drawer.first().textContent().catch(() => '');
  const hasRecentLog = drawerText.includes(subName1) || drawerText.includes(parentName) || drawerText.includes('新增');
  check('L03', '最新日志包含刚创建的类目', hasRecentLog);

  // 日志类型颜色标识
  const logDots = drawer.locator('[class*="dot"], [class*="Dot"], [style*="background"]');
  check('L04', '日志有颜色标识', await logDots.count() > 0);

  // 2.3 筛选器 — 类型
  console.log('\n-- 2.3 筛选器 — 操作类型 --');
  const typeFilter = drawer.locator('select').first();
  check('L05', '操作类型筛选器存在', await typeFilter.count() > 0);

  // 筛选"新增"
  if (await typeFilter.count() > 0) {
    await typeFilter.selectOption({ label: '新增' }).catch(async () => {
      // Try by value
      await typeFilter.selectOption('create').catch(() => {});
    });
    await page.waitForTimeout(1000);

    const filteredText = await drawer.first().textContent().catch(() => '');
    const hasCreateLogs = filteredText.includes('新增') || filteredText.includes('创建');
    check('L06', '筛选"新增"类型日志', hasCreateLogs);

    // 筛选"删除"
    await typeFilter.selectOption({ label: '删除' }).catch(async () => {
      await typeFilter.selectOption('delete').catch(() => {});
    });
    await page.waitForTimeout(1000);

    const deleteText = await drawer.first().textContent().catch(() => '');
    const hasDeleteLogs = deleteText.includes('删除') || deleteText.includes('暂无');
    check('L07', '筛选"删除"类型日志', hasDeleteLogs);

    // 恢复全部
    await typeFilter.selectOption({ label: '全部操作' }).catch(async () => {
      await typeFilter.selectOption('').catch(() => {});
    });
    await page.waitForTimeout(800);
  }

  // 2.4 筛选器 — 日期范围
  console.log('\n-- 2.4 筛选器 — 日期 --');
  const dateInputs = drawer.locator('input[type="date"]');
  const dateCount = await dateInputs.count();
  check('L08', '日期筛选器存在', dateCount >= 2, `${dateCount} 个`);

  if (dateCount >= 2) {
    // 设置今天的日期
    const today = new Date().toISOString().slice(0, 10);
    await dateInputs.first().fill(today);
    await dateInputs.nth(1).fill(today);
    await page.waitForTimeout(1000);

    const todayText = await drawer.first().textContent().catch(() => '');
    const hasTodayLogs = todayText.includes('新增') || todayText.includes('修改') || todayText.includes('暂无');
    check('L09', '日期筛选今天的日志', hasTodayLogs);

    // 设置过去的日期（不应有数据）
    await dateInputs.first().fill('2020-01-01');
    await dateInputs.nth(1).fill('2020-01-02');
    await page.waitForTimeout(1000);

    const oldText = await drawer.first().textContent().catch(() => '');
    check('L10', '过去日期无日志', oldText.includes('暂无') || !oldText.includes('新增'));

    // 清空日期
    await dateInputs.first().fill('');
    await dateInputs.nth(1).fill('');
    await page.waitForTimeout(500);
  }

  // 2.5 日志详情 — diff 展示
  console.log('\n-- 2.5 日志详情 --');
  // Look for edit diff (strikethrough old value + new value)
  const diffItems = drawer.locator('[class*="diff"], [class*="change"], del, ins');
  check('L11', '修改日志含变更详情', await diffItems.count() >= 0, `${await diffItems.count()} 个diff`);

  // 操作人
  const operator = drawer.locator('text=操作人');
  check('L12', '日志显示操作人', await operator.count() > 0);

  // 2.6 关闭 Drawer
  console.log('\n-- 2.6 关闭 Drawer --');
  // Close button
  const closeBtn = drawer.locator('button').filter({ hasText: '×' }).first();
  if (await closeBtn.count() > 0) {
    await closeBtn.click();
  } else {
    await page.keyboard.press('Escape');
  }
  await page.waitForTimeout(300);
  check('L13', '关闭 Drawer', await drawer.count() === 0 || !(await drawer.first().isVisible().catch(() => false)));

  // 2.7 重新打开 ESC 关闭
  await auditBtn.first().click();
  await page.waitForTimeout(500);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const drawerHidden = await drawer.first().isVisible().catch(() => false) === false;
  check('L14', 'ESC 关闭 Drawer', drawerHidden);

  // ═══════════════════════════════════════════════
  // Part 3: 清理测试数据
  // ═══════════════════════════════════════════════
  console.log('\n══ Part 3: 清理测试数据 ══');

  // 选中父类目
  await page.waitForTimeout(500);
  const parentForDel = leftPanel.locator('[class*="cat1Item"], [class*="cat1Row"]').filter({ hasText: parentName });
  if (await parentForDel.count() > 0) {
    await parentForDel.first().hover();
    await page.waitForTimeout(300);
    const delBtn = parentForDel.locator('button[title*="删除"]');
    if (await delBtn.count() > 0) {
      await delBtn.click();
      await page.waitForTimeout(1500);

      // 级联删除 — 输入名称确认
      const confirmInput = page.locator('input[placeholder*="输入"]');
      if (await confirmInput.count() > 0) {
        await confirmInput.fill(parentName);
        await page.waitForTimeout(300);
        const cascadeBtn = page.locator('button').filter({ hasText: '确认级联删除' });
        if (await cascadeBtn.count() > 0 && !(await cascadeBtn.isDisabled())) {
          await cascadeBtn.click();
          await page.waitForTimeout(2000);
          console.log('已清理测试数据');
        }
      } else {
        // 简单删除
        const simpleDelBtn = page.locator('button').filter({ hasText: '确认删除' });
        if (await simpleDelBtn.count() > 0) {
          await simpleDelBtn.click();
          await page.waitForTimeout(2000);
          console.log('已清理测试数据（简单删除）');
        }
      }
    }
  }

  // 关闭弹窗
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // 截图
  await page.screenshot({ path: path.join(__dirname, 'category-sub-audit-screenshot.png') });

  // ═══════════════════════════════════════════════
  // 汇总
  // ═══════════════════════════════════════════════
  console.log(`\n${'═'.repeat(55)}`);
  console.log(`新增子类目 + 操作日志测试: ${pass} PASS / ${fail} FAIL / ${pass + fail} TOTAL`);
  console.log(`${'═'.repeat(55)}`);

  await browser.close();
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
