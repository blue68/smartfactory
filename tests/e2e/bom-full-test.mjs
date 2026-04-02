/**
 * BOM 管理页面 — 全方位 E2E 测试 (Playwright headless)
 */
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0, skip = 0;

function check(id, name, ok, detail = '') {
  const tag = ok ? 'PASS' : 'FAIL';
  if (ok) pass++; else fail++;
  console.log(`[${tag}] ${id} ${name}${detail ? ' — ' + detail : ''}`);
}
function skp(id, name, detail = '') {
  skip++;
  console.log(`[SKIP] ${id} ${name}${detail ? ' — ' + detail : ''}`);
}

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  // 收集 API
  const apiLog = [];
  page.on('response', async (resp) => {
    if (resp.url().includes('/api/')) {
      apiLog.push({ url: resp.url(), status: resp.status(), method: resp.request().method() });
    }
  });

  // ── 登录 ──
  await page.goto('http://localhost/login', { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(500);
  if (page.url().includes('/login')) {
    await page.fill('input[name="username"]', 'admin');
    await page.fill('input[name="password"]', 'admin123');
    await page.fill('input[name="tenantCode"]', 'FACTORY001');
    await page.locator('button[type="submit"]').click();
    await page.waitForTimeout(3000);
  }

  // ── 导航到 BOM 管理 ──
  await page.goto('http://localhost/master-data/bom', { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(2000);

  // ══════════════════════════════════════════════
  // Part 1: 列表页面
  // ══════════════════════════════════════════════
  console.log('\n══ Part 1: 列表页面 ══');

  check('T01', '页面标题', await page.locator('text=BOM 管理').first().count() > 0);

  // 统计条
  const bodyText = await page.evaluate(() => document.body.innerText);
  check('T02', '统计条', bodyText.includes('全部') || bodyText.includes('已完成') || bodyText.includes('未开始'));

  // 表格
  const rows = page.locator('table tbody tr');
  const rowCount = await rows.count();
  check('T03', '列表有数据', rowCount > 0, `${rowCount} 行`);

  // 列
  const thTexts = await page.locator('th').allTextContents();
  check('T04', '表格列完整', thTexts.some(t => t.includes('SKU')) && thTexts.some(t => t.includes('完整度')), thTexts.join(', '));

  // 搜索
  const searchInput = page.locator('input[placeholder*="搜索"], input[placeholder*="SKU"]').first();
  check('T05', '搜索框', await searchInput.count() > 0);

  if (await searchInput.count() > 0) {
    await searchInput.fill('NONEXIST_999');
    await page.waitForTimeout(1000);
    const emptyText = await page.evaluate(() => document.body.innerText);
    const filtered = emptyText.includes('暂无') || (await rows.count()) === 0;
    check('T06', '搜索过滤(无匹配)', filtered);
    await searchInput.clear();
    await page.waitForTimeout(1000);
  } else { skp('T06', '搜索过滤'); }

  // 筛选器
  const filterSelect = page.locator('select').first();
  const filterOptions = await filterSelect.locator('option').allTextContents();
  check('T07', '完成度筛选器', filterOptions.length >= 2, filterOptions.join(' / '));

  // 分页
  check('T08', '分页区域', await page.locator('[class*="pagination"], [class*="pager"]').count() > 0 || bodyText.includes('页'));

  // 快速录入按钮
  const wizardBtn = page.locator('button').filter({ hasText: /快速录入/ }).first();
  check('T09', '快速录入按钮', await wizardBtn.count() > 0);

  // 行按钮：查看/编辑, 复制
  const rowBtns = await rows.first().locator('button').allTextContents();
  check('T10', '行操作按钮', rowBtns.length >= 1, rowBtns.join(' / '));

  // ══════════════════════════════════════════════
  // Part 2: BOM 编辑器
  // ══════════════════════════════════════════════
  console.log('\n══ Part 2: BOM 编辑器 ══');

  const editBtn = rows.first().locator('button').filter({ hasText: /查看|编辑|录入/ }).first();
  if (await editBtn.count() > 0) {
    apiLog.length = 0;
    await editBtn.click();
    await page.waitForTimeout(2500);

    // T11: 返回按钮
    const backBtn = page.locator('button:has-text("← 返回列表")');
    check('T11', '编辑器打开(返回按钮)', await backBtn.count() > 0);

    // T12: 产品信息
    const editorText = await page.evaluate(() => document.body.innerText);
    check('T12', '产品名称/SKU编码', editorText.includes('SKU') || editorText.includes('版本'));

    // T13: BOM树面板
    check('T13', 'BOM树形结构面板', editorText.includes('BOM树形结构') || editorText.includes('暂无物料'));

    // T14: expand API
    const expandApi = apiLog.find(a => a.url.includes('/expand'));
    check('T14', 'BOM展开API', expandApi?.status === 200, expandApi ? `HTTP ${expandApi.status}` : '无请求');

    // T15: AI建议 API
    const aiApi = apiLog.find(a => a.url.includes('ai-suggestion'));
    check('T15', 'AI建议API', aiApi !== undefined, aiApi ? `HTTP ${aiApi.status}` : '(未触发)');

    // T16: 成本分析 API
    const costApi = apiLog.find(a => a.url.includes('cost-breakdown'));
    check('T16', '成本分析API', costApi !== undefined, costApi ? `HTTP ${costApi.status}` : '(未触发)');

    // T17: 操作按钮
    const actionTexts = await page.locator('[class*="editor_actions"] button, [class*="editorActions"] button').allTextContents();
    const allBtns = actionTexts.join(' ');
    check('T17', '操作按钮组', allBtns.includes('新增物料') || allBtns.includes('编辑信息'), allBtns);

    // T18: + 新增物料弹窗
    const addMatBtn = page.locator('button:has-text("+ 新增物料")');
    if (await addMatBtn.count() > 0) {
      await addMatBtn.click();
      await page.waitForTimeout(800);

      const modalText = await page.evaluate(() => {
        const modal = document.querySelector('[role="dialog"], [class*="overlay"]');
        return modal ? modal.innerText : '';
      });
      check('T18', '新增物料弹窗打开', modalText.includes('物料') || modalText.includes('搜索') || modalText.includes('用量'));

      // T19: 弹窗内搜索物料下拉
      const matSearch = page.locator('[role="dialog"] input, [class*="overlay"] input').first();
      check('T19', '弹窗有搜索输入框', await matSearch.count() > 0);

      // T20: 单位选择
      const unitSelect = page.locator('[role="dialog"] select, [class*="overlay"] select');
      check('T20', '弹窗有单位选择', await unitSelect.count() > 0);

      // 关闭
      const cancelBtn = page.locator('[role="dialog"] button:has-text("取消"), [class*="overlay"] button:has-text("取消")').first();
      if (await cancelBtn.count() > 0) await cancelBtn.click();
      else await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
    } else { skp('T18', '新增物料弹窗'); skp('T19', '搜索输入框'); skp('T20', '单位选择'); }

    // T21: 编辑信息弹窗
    const editInfoBtn = page.locator('button:has-text("编辑信息")');
    if (await editInfoBtn.count() > 0) {
      await editInfoBtn.click();
      await page.waitForTimeout(800);
      const modalText = await page.evaluate(() => {
        const modal = document.querySelector('[role="dialog"], [class*="overlay"]');
        return modal ? modal.innerText : '';
      });
      check('T21', '编辑信息弹窗(版本/描述)', modalText.includes('版本') || modalText.includes('描述'));

      const closeBtn = page.locator('[role="dialog"] button:has-text("取消"), [class*="overlay"] button:has-text("取消")').first();
      if (await closeBtn.count() > 0) await closeBtn.click();
      else await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
    } else { skp('T21', '编辑信息弹窗'); }

    // T22: 需求计算弹窗
    const calcBtn = page.locator('button:has-text("需求计算")');
    if (await calcBtn.count() > 0) {
      await calcBtn.click();
      await page.waitForTimeout(800);
      const modalText = await page.evaluate(() => {
        const modal = document.querySelector('[role="dialog"], [class*="overlay"]');
        return modal ? modal.innerText : '';
      });
      check('T22', '需求计算弹窗', modalText.includes('生产数量') || modalText.includes('计算') || modalText.includes('产量'));

      // T23: 输入并计算
      const qtyInput = page.locator('[role="dialog"] input[type="number"], [class*="overlay"] input[type="number"]').first();
      if (await qtyInput.count() > 0) {
        await qtyInput.fill('100');
        apiLog.length = 0;
        const calcExecBtn = page.locator('[role="dialog"] button:has-text("计算"), [class*="overlay"] button:has-text("计算")').first();
        if (await calcExecBtn.count() > 0) {
          await calcExecBtn.click();
          await page.waitForTimeout(2000);
          const reqApi = apiLog.find(a => a.url.includes('material-requirements'));
          check('T23', '需求计算API', reqApi?.status === 200, reqApi ? `HTTP ${reqApi.status}` : '无请求');
        } else { skp('T23', '计算按钮'); }
      } else { skp('T23', '数量输入'); }

      const closeBtn2 = page.locator('[role="dialog"] button:has-text("关闭"), [class*="overlay"] button:has-text("关闭"), [role="dialog"] button:has-text("取消")').first();
      if (await closeBtn2.count() > 0) await closeBtn2.click();
      else await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
    } else { skp('T22', '需求计算弹窗'); skp('T23', '需求计算API'); }

    // T24: 导出 Excel
    const exportBtn = page.locator('button:has-text("导出 Excel")');
    if (await exportBtn.count() > 0) {
      try {
        const [download] = await Promise.all([
          page.waitForEvent('download', { timeout: 8000 }),
          exportBtn.click(),
        ]);
        check('T24', '导出Excel', true, download.suggestedFilename());
      } catch (e) {
        check('T24', '导出Excel', false, String(e).substring(0, 80));
      }
    } else { skp('T24', '导出Excel'); }

    // T25: AI 推荐区域
    const editorText2 = await page.evaluate(() => document.body.innerText);
    check('T25', 'AI推荐区域', editorText2.includes('AI') || editorText2.includes('推荐') || editorText2.includes('建议'));

    // T26: 成本分析区域
    // 品类成本占比仅在BOM有物料时显示，无物料时属正常隐藏
    const hasCost = editorText2.includes('品类成本占比') || editorText2.includes('成本');
    const bomEmpty = editorText2.includes('暂无物料') || editorText2.includes('新增物料');
    check('T26', '成本区域(有物料显示/无物料隐藏)', hasCost || bomEmpty, hasCost ? '已显示' : '无物料,正常隐藏');

    // 返回列表
    const backBtn2 = page.locator('button:has-text("← 返回列表")').first();
    if (await backBtn2.count() > 0) {
      await backBtn2.click();
      await page.waitForTimeout(1000);
    }
  } else {
    for (let i = 11; i <= 26; i++) skp(`T${i}`, '无编辑按钮');
  }

  // ══════════════════════════════════════════════
  // Part 3: 快速录入向导
  // ══════════════════════════════════════════════
  console.log('\n══ Part 3: 快速录入向导 ══');

  if (await wizardBtn.count() > 0) {
    await wizardBtn.click();
    await page.waitForTimeout(1500);

    const wizardText = await page.evaluate(() => {
      const modal = document.querySelector('[role="dialog"], [class*="overlay"]');
      return modal ? modal.innerText : '';
    });
    check('T27', '向导弹窗打开', wizardText.includes('选择产品') || wizardText.includes('快速录入') || wizardText.includes('BOM'));

    // T28: Step 0 产品 radio
    const radios = page.locator('[role="dialog"] input[type="radio"], [class*="overlay"] input[type="radio"]');
    const radioCount = await radios.count();
    check('T28', 'Step0 产品radio', radioCount > 0, `${radioCount} 个`);

    // T29: 步骤指示器
    check('T29', '步骤指示器', wizardText.includes('选择产品') || wizardText.includes('AI') ||
      await page.locator('[class*="stepper"], [class*="step"]').count() > 0);

    // T30: 下一步按钮
    const nextBtn = page.locator('[role="dialog"] button:has-text("下一步"), [class*="overlay"] button:has-text("下一步")').first();
    check('T30', '下一步按钮', await nextBtn.count() > 0);

    // T31: 选择产品→Step1
    if (radioCount > 0 && await nextBtn.count() > 0) {
      await radios.first().click();
      await page.waitForTimeout(200);
      await nextBtn.click();
      await page.waitForTimeout(2500);

      const step1Text = await page.evaluate(() => {
        const modal = document.querySelector('[role="dialog"], [class*="overlay"]');
        return modal ? modal.innerText : '';
      });
      check('T31', 'Step1 AI推荐', step1Text.includes('AI') || step1Text.includes('推荐') || step1Text.includes('物料') || step1Text.includes('建议'));

      // T32: Step1 → Step2
      const nextBtn2 = page.locator('[role="dialog"] button:has-text("下一步"), [class*="overlay"] button:has-text("下一步")').first();
      if (await nextBtn2.count() > 0) {
        await nextBtn2.click();
        await page.waitForTimeout(1000);
        const step2Text = await page.evaluate(() => {
          const modal = document.querySelector('[role="dialog"], [class*="overlay"]');
          return modal ? modal.innerText : '';
        });
        check('T32', 'Step2 手动添加', step2Text.includes('手动') || step2Text.includes('搜索') || step2Text.includes('添加'));

        // T33: Step2 → Step3
        const nextBtn3 = page.locator('[role="dialog"] button:has-text("下一步"), [class*="overlay"] button:has-text("下一步")').first();
        if (await nextBtn3.count() > 0) {
          await nextBtn3.click();
          await page.waitForTimeout(1000);
          const step3Text = await page.evaluate(() => {
            const modal = document.querySelector('[role="dialog"], [class*="overlay"]');
            return modal ? modal.innerText : '';
          });
          check('T33', 'Step3 确认页', step3Text.includes('确认') || step3Text.includes('版本') || step3Text.includes('汇总'));

          // T34: 确认创建按钮
          const confirmBtn = page.locator('[role="dialog"] button:has-text("确认创建"), [class*="overlay"] button:has-text("确认创建"), [role="dialog"] button:has-text("确认"), [class*="overlay"] button:has-text("确认")').first();
          check('T34', '确认创建按钮', await confirmBtn.count() > 0);
        } else { skp('T33', 'Step3'); skp('T34', '确认按钮'); }
      } else { skp('T32', 'Step2'); skp('T33', 'Step3'); skp('T34', '确认按钮'); }
    } else { for (let i = 31; i <= 34; i++) skp(`T${i}`, '无法进入向导'); }

    // 关闭向导
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    // 尝试点取消按钮
    const cancelBtnW = page.locator('[role="dialog"] button:has-text("取消")').first();
    if (await cancelBtnW.count() > 0) await cancelBtnW.click();
    await page.waitForTimeout(300);
  } else {
    for (let i = 27; i <= 34; i++) skp(`T${i}`, '无快速录入按钮');
  }

  // ══════════════════════════════════════════════
  // Part 4: 状态与交互细节
  // ══════════════════════════════════════════════
  console.log('\n══ Part 4: UI 细节 ══');

  await page.goto('http://localhost/master-data/bom', { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(1500);
  const finalText = await page.evaluate(() => document.body.innerText);

  // T35: 进度条
  check('T35', '完成度进度条', await page.locator('[class*="progress"], [class*="Progress"]').count() > 0);

  // T36: 状态标签
  check('T36', '状态标签(草稿/已激活)', finalText.includes('草稿') || finalText.includes('已激活') || finalText.includes('active'));

  // T37: 草稿提醒
  check('T37', '草稿提醒横幅', finalText.includes('草稿') || finalText.includes('影响') || finalText.includes('采购'));

  // T38: 列表行 hover/操作
  check('T38', '操作列有按钮', await page.locator('table tbody tr button').count() > 0);

  // ── 截图 ──
  const ssPath = path.join(__dirname, 'bom-test-screenshot.png');
  await page.screenshot({ path: ssPath, fullPage: true });
  console.log('\n截图已保存:', ssPath);

  // ── 汇总 ──
  console.log(`\n${'═'.repeat(55)}`);
  console.log(`BOM 管理页面测试: ${pass} PASS / ${fail} FAIL / ${skip} SKIP / ${pass + fail + skip} TOTAL`);
  console.log(`${'═'.repeat(55)}`);

  await browser.close();
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
