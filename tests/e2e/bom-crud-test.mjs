/**
 * BOM 管理 — 模拟数据全流程 CRUD 测试
 * 覆盖：快速录入向导创建BOM → 继续录入 → 新增物料 → 编辑信息 → 需求计算 → 导出Excel →
 *       展开/折叠全部 → 复制BOM → 激活BOM
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
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  // API 日志
  const apiLog = [];
  page.on('response', async (resp) => {
    if (resp.url().includes('/api/')) {
      const body = await resp.text().catch(() => '');
      apiLog.push({ url: resp.url(), status: resp.status(), method: resp.request().method(), body: body.substring(0, 300) });
    }
  });

  // ── 登录 ──
  await page.goto('http://localhost/login', { waitUntil: 'networkidle', timeout: 15000 });
  await page.fill('input[name="username"]', 'admin');
  await page.fill('input[name="password"]', 'admin123');
  await page.fill('input[name="tenantCode"]', 'FACTORY001');
  await page.locator('button[type="submit"]').click();
  await page.waitForTimeout(3000);

  // ── 导航到 BOM ──
  await page.goto('http://localhost/master-data/bom', { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(2000);

  // ══════════════════════════════════════════════════
  // Part 1: 快速录入向导 — 创建新 BOM
  // ══════════════════════════════════════════════════
  console.log('\n══ Part 1: 快速录入向导创建 BOM ══');

  const wizardBtn = page.locator('button').filter({ hasText: '快速录入' }).first();
  await wizardBtn.click();
  await page.waitForTimeout(1500);

  // Step 0: 选择产品
  const dialog = page.locator('[role="dialog"], [class*="overlay"]').filter({ hasText: /选择产品|快速录入|BOM/ });
  check('W01', '向导弹窗打开', await dialog.count() > 0);

  const radios = dialog.locator('input[type="radio"]');
  const radioCount = await radios.count();
  check('W02', '产品列表展示', radioCount > 0, `${radioCount} 个产品`);

  // 选择第一个产品
  if (radioCount > 0) {
    await radios.first().click();
    await page.waitForTimeout(200);
  }

  // 记录选中的产品名
  const selectedProduct = await page.evaluate(() => {
    const checked = document.querySelector('[role="dialog"] input[type="radio"]:checked');
    if (!checked) return '';
    const row = checked.closest('label, tr, div, li');
    return row ? row.textContent.trim().substring(0, 50) : '';
  });
  console.log('  选中产品:', selectedProduct || '(无)');

  // 下一步
  const nextBtn = dialog.locator('button').filter({ hasText: '下一步' }).first();
  await nextBtn.click();
  await page.waitForTimeout(2500);

  // Step 1: AI 推荐
  const step1Text = await dialog.evaluate(el => el.innerText).catch(() => '');
  check('W03', 'Step1 AI推荐页面', step1Text.includes('AI') || step1Text.includes('推荐') || step1Text.includes('物料'));

  // 检查 AI 推荐是否有物料
  const aiCheckboxes = dialog.locator('input[type="checkbox"]');
  const aiCount = await aiCheckboxes.count();
  console.log(`  AI推荐物料: ${aiCount} 个`);

  // 下一步到 Step 2
  const nextBtn2 = dialog.locator('button').filter({ hasText: '下一步' }).first();
  await nextBtn2.click();
  await page.waitForTimeout(1000);

  // Step 2: 手动添加物料
  const step2Text = await dialog.evaluate(el => el.innerText).catch(() => '');
  check('W04', 'Step2 手动添加页面', step2Text.includes('手动') || step2Text.includes('添加') || step2Text.includes('搜索'));

  // 搜索并添加一个物料
  const manualSearch = dialog.locator('input[placeholder*="搜索"], input[placeholder*="物料"], input[placeholder*="名称"]').first();
  if (await manualSearch.count() > 0) {
    await manualSearch.fill('木');
    await page.waitForTimeout(1500);

    // 点选搜索结果（下拉是 absolute div 容器内的 div 子项）
    // 使用 evaluate 直接查找并点击，避免 CSS attribute selector 匹配问题
    const clicked = await dialog.evaluate((el) => {
      // 查找 position:absolute 的容器中的可点击 div
      const allDivs = el.querySelectorAll('div');
      for (const d of allDivs) {
        if (d.style.position === 'absolute' && d.style.zIndex) {
          const items = d.querySelectorAll(':scope > div');
          if (items.length > 0) {
            items[0].click();
            return true;
          }
        }
      }
      return false;
    });
    if (clicked) {
      await page.waitForTimeout(500);
      check('W05', '手动搜索并选择物料', true);
    } else {
      check('W05', '手动搜索并选择物料', false, '无搜索结果下拉');
    }
  } else {
    check('W05', '手动搜索并选择物料', false, '无搜索框');
  }

  // 下一步到 Step 3
  const nextBtn3 = dialog.locator('button').filter({ hasText: '下一步' }).first();
  await nextBtn3.click();
  await page.waitForTimeout(1000);

  // Step 3: 确认创建
  const step3Text = await dialog.evaluate(el => el.innerText).catch(() => '');
  check('W06', 'Step3 确认页面', step3Text.includes('确认') || step3Text.includes('版本') || step3Text.includes('汇总'));

  // 点击确认创建
  apiLog.length = 0;
  const confirmBtn = dialog.locator('button').filter({ hasText: /确认创建|确认/ }).first();
  if (await confirmBtn.count() > 0) {
    await confirmBtn.click();
    await page.waitForTimeout(3000);

    const createApi = apiLog.find(a => a.url.includes('/api/bom') && a.method === 'POST' && !a.url.includes('/items'));
    check('W07', 'BOM创建API调用', createApi !== undefined, createApi ? `HTTP ${createApi.status} ${createApi.body.substring(0, 80)}` : '无请求');

    // 创建成功后应自动进入编辑器
    const inEditor = await page.locator('button:has-text("← 返回列表")').count() > 0;
    check('W08', '创建后自动进入编辑器', inEditor);

    // 返回列表
    if (inEditor) {
      await page.locator('button:has-text("← 返回列表")').click();
      await page.waitForTimeout(1000);
    }
  } else {
    check('W07', 'BOM创建API调用', false, '无确认按钮');
    check('W08', '创建后自动进入编辑器', false);
    // 关闭向导
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  }

  // ══════════════════════════════════════════════════
  // Part 2: 继续录入 — 进入编辑器
  // ══════════════════════════════════════════════════
  console.log('\n══ Part 2: 继续录入 + 编辑器功能 ══');

  await page.goto('http://localhost/master-data/bom', { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(2000);

  // 找到一个草稿状态的BOM（优先点击"继续录入"按钮）
  const continueBtn = page.locator('table tbody tr button').filter({ hasText: /继续录入|开始录入|查看|编辑/ }).first();
  check('E01', '找到录入/编辑按钮', await continueBtn.count() > 0);

  if (await continueBtn.count() > 0) {
    const btnText = await continueBtn.textContent();
    apiLog.length = 0;
    await continueBtn.click();
    await page.waitForTimeout(3000);

    check('E02', `点击"${btnText.trim()}"进入编辑器`, await page.locator('button:has-text("← 返回列表")').count() > 0);

    // ── E03: 新增物料 ──
    console.log('\n-- 新增物料 --');
    const addMatBtn = page.locator('button:has-text("+ 新增物料")');
    if (await addMatBtn.count() > 0) {
      await addMatBtn.click();
      await page.waitForTimeout(800);

      // 搜索物料
      const matModal = page.locator('[role="dialog"], [class*="overlay"]').last();
      const matSearch = matModal.locator('input').first();
      if (await matSearch.count() > 0) {
        await matSearch.fill('木');
        await page.waitForTimeout(1000);

        // 选择搜索结果（下拉是 div 容器内带 cursor:pointer 的 div 子项）
        const dropdown = matModal.locator('div[style*="max-height"] > div[style*="cursor"], div[style*="maxHeight"] > div[style*="cursor"]').first();
        if (await dropdown.count() > 0) {
          await dropdown.click();
          await page.waitForTimeout(500);
        }
      }

      // 填写用量
      const qtyInput = matModal.locator('input[type="number"]').first();
      if (await qtyInput.count() > 0) {
        await qtyInput.fill('5.5');
      }

      // 确认添加
      apiLog.length = 0;
      const addConfirm = matModal.locator('button').filter({ hasText: /确认|添加|保存/ }).first();
      if (await addConfirm.count() > 0) {
        await addConfirm.click();
        await page.waitForTimeout(2000);

        const addApi = apiLog.find(a => a.url.includes('/items') && a.method === 'POST');
        check('E03', '新增物料API', addApi !== undefined, addApi ? `HTTP ${addApi.status}` : '无请求');
      } else {
        check('E03', '新增物料API', false, '无确认按钮');
      }
      // 确保弹窗关闭
      for (let i = 0; i < 3; i++) {
        const openDialog = page.locator('[role="dialog"]');
        if (await openDialog.count() > 0) {
          await page.keyboard.press('Escape');
          await page.waitForTimeout(400);
        } else break;
      }
    } else {
      check('E03', '新增物料API', false, '无+新增物料按钮');
    }

    // ── E04: 编辑信息 ──
    console.log('\n-- 编辑信息 --');
    const editInfoBtn = page.locator('button:has-text("编辑信息")');
    if (await editInfoBtn.count() > 0) {
      await editInfoBtn.click();
      await page.waitForTimeout(800);

      const infoModal = page.locator('[role="dialog"], [class*="overlay"]').last();
      const infoText = await infoModal.evaluate(el => el.innerText).catch(() => '');
      check('E04', '编辑信息弹窗打开', infoText.includes('版本') || infoText.includes('描述'));

      // 修改版本号
      const versionInput = infoModal.locator('input').first();
      if (await versionInput.count() > 0) {
        await versionInput.fill('v2.0-test');
      }

      // 保存
      apiLog.length = 0;
      const saveBtn = infoModal.locator('button').filter({ hasText: /保存|确认|确定/ }).first();
      if (await saveBtn.count() > 0) {
        await saveBtn.click();
        await page.waitForTimeout(1500);

        const updateApi = apiLog.find(a => a.url.includes('/api/bom/') && (a.method === 'PUT' || a.method === 'PATCH'));
        check('E05', '编辑信息保存API', updateApi !== undefined, updateApi ? `HTTP ${updateApi.status}` : '无请求');
      } else {
        check('E05', '编辑信息保存API', false, '无保存按钮');
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
      }
    } else {
      check('E04', '编辑信息弹窗打开', false, '无编辑信息按钮');
      check('E05', '编辑信息保存API', false);
    }

    // 确保所有弹窗关闭
    for (let i = 0; i < 5; i++) {
      const openDialog = page.locator('[role="dialog"]');
      if (await openDialog.count() > 0) {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);
      } else break;
    }
    await page.waitForTimeout(300);

    // ── E06: 需求计算 ──
    console.log('\n-- 需求计算 --');
    const calcBtn = page.locator('button:has-text("需求计算")');
    if (await calcBtn.count() > 0) {
      await calcBtn.click();
      await page.waitForTimeout(800);

      const calcModal = page.locator('[role="dialog"], [class*="overlay"]').last();
      const calcText = await calcModal.evaluate(el => el.innerText).catch(() => '');
      check('E06', '需求计算弹窗打开', calcText.includes('生产数量') || calcText.includes('计算') || calcText.includes('产量'));

      // 输入数量
      const calcQty = calcModal.locator('input[type="number"]').first();
      if (await calcQty.count() > 0) {
        await calcQty.fill('200');
        apiLog.length = 0;

        const calcExecBtn = calcModal.locator('button').filter({ hasText: '计算' }).first();
        if (await calcExecBtn.count() > 0) {
          await calcExecBtn.click();
          await page.waitForTimeout(2000);

          const reqApi = apiLog.find(a => a.url.includes('material-requirements'));
          check('E07', '需求计算API返回', reqApi?.status === 200, reqApi ? `HTTP ${reqApi.status}` : '无请求');

          // 检查结果表格
          const resultText = await calcModal.evaluate(el => el.innerText).catch(() => '');
          const hasResult = resultText.includes('物料') || resultText.includes('需求') || resultText.includes('数量') || resultText.includes('暂无');
          check('E08', '需求计算结果展示', hasResult);
        } else {
          check('E07', '需求计算API返回', false, '无计算按钮');
          check('E08', '需求计算结果展示', false);
        }
      } else {
        check('E07', '需求计算API返回', false, '无数量输入');
        check('E08', '需求计算结果展示', false);
      }

      // 关闭
      const closeCalcBtn = calcModal.locator('button').filter({ hasText: /关闭|取消/ }).first();
      if (await closeCalcBtn.count() > 0) await closeCalcBtn.click();
      else await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
    } else {
      check('E06', '需求计算弹窗', false, '无按钮');
      check('E07', '需求计算API', false);
      check('E08', '需求计算结果', false);
    }

    // ── E09: 导出 Excel ──
    console.log('\n-- 导出 Excel --');
    const exportBtn = page.locator('button:has-text("导出 Excel")');
    if (await exportBtn.count() > 0) {
      try {
        const [download] = await Promise.all([
          page.waitForEvent('download', { timeout: 8000 }),
          exportBtn.click(),
        ]);
        check('E09', '导出Excel下载', true, download.suggestedFilename());
      } catch (e) {
        check('E09', '导出Excel下载', false, String(e).substring(0, 80));
      }
    } else {
      check('E09', '导出Excel', false, '无按钮');
    }

    // ── E10/E11: 展开全部 / 折叠全部 ──
    console.log('\n-- 展开/折叠全部 --');
    const treePanel = page.locator('[class*="tree_panel"], [class*="treePanel"]');
    const expandAllBtn = treePanel.locator('button').filter({ hasText: /展开全部|全部展开|Expand/ }).first();
    const collapseAllBtn = treePanel.locator('button').filter({ hasText: /折叠全部|全部折叠|Collapse/ }).first();

    // 也检查页面级别的按钮
    const expandAllBtn2 = page.locator('button').filter({ hasText: /展开全部|全部展开/ }).first();
    const collapseAllBtn2 = page.locator('button').filter({ hasText: /折叠全部|全部折叠/ }).first();

    const hasExpand = await expandAllBtn.count() > 0 || await expandAllBtn2.count() > 0;
    const hasCollapse = await collapseAllBtn.count() > 0 || await collapseAllBtn2.count() > 0;

    if (hasExpand) {
      const btn = await expandAllBtn.count() > 0 ? expandAllBtn : expandAllBtn2;
      await btn.click();
      await page.waitForTimeout(500);
      check('E10', '展开全部按钮点击', true);
    } else {
      // 树面板可能没有多层级节点，按钮不显示
      const treeText = await treePanel.evaluate(el => el.innerText).catch(() => '');
      const isEmpty = treeText.includes('暂无物料') || treeText === '';
      check('E10', '展开全部按钮', isEmpty, isEmpty ? 'BOM无物料，按钮正常不显示' : '按钮缺失');
    }

    if (hasCollapse) {
      const btn = await collapseAllBtn.count() > 0 ? collapseAllBtn : collapseAllBtn2;
      await btn.click();
      await page.waitForTimeout(500);
      check('E11', '折叠全部按钮点击', true);
    } else {
      const treeText = await treePanel.evaluate(el => el.innerText).catch(() => '');
      const isEmpty = treeText.includes('暂无物料') || treeText === '';
      check('E11', '折叠全部按钮', isEmpty, isEmpty ? 'BOM无物料，按钮正常不显示' : '按钮缺失');
    }

    // 返回列表
    await page.locator('button:has-text("← 返回列表")').first().click();
    await page.waitForTimeout(1000);
  } else {
    for (let i = 2; i <= 11; i++) check(`E${String(i).padStart(2, '0')}`, '(无编辑入口)', false);
  }

  // ══════════════════════════════════════════════════
  // Part 3: 复制 BOM
  // ══════════════════════════════════════════════════
  console.log('\n══ Part 3: 复制 BOM ══');

  // 回到列表
  await page.goto('http://localhost/master-data/bom', { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(2000);

  const copyBtns = page.locator('table tbody tr button').filter({ hasText: '复制' });
  const copyCount = await copyBtns.count();
  check('C01', '列表有复制按钮', copyCount > 0, `${copyCount} 个`);

  if (copyCount > 0) {
    await copyBtns.first().click();
    await page.waitForTimeout(800);

    const copyModal = page.locator('[role="dialog"], [class*="overlay"]').last();
    const copyText = await copyModal.evaluate(el => el.innerText).catch(() => '');
    check('C02', '复制弹窗打开', copyText.includes('版本') || copyText.includes('复制'));

    // 填写新版本号
    const copyVersionInput = copyModal.locator('input').first();
    if (await copyVersionInput.count() > 0) {
      await copyVersionInput.fill(`copy-${Date.now() % 10000}`);
    }

    // 确认复制
    apiLog.length = 0;
    const copyConfirm = copyModal.locator('button').filter({ hasText: /确认|复制|保存/ }).first();
    if (await copyConfirm.count() > 0) {
      await copyConfirm.click();
      await page.waitForTimeout(2000);

      const copyApi = apiLog.find(a => a.url.includes('/copy') && a.method === 'POST');
      check('C03', '复制BOM API', copyApi !== undefined, copyApi ? `HTTP ${copyApi.status}` : '无请求');

      // 检查成功 toast
      const toastText = await page.evaluate(() => {
        const t = document.querySelectorAll('[class*="toast"]');
        return Array.from(t).map(e => e.textContent).join('|');
      });
      check('C04', '复制成功提示', toastText.includes('成功') || toastText.includes('复制') || (copyApi && copyApi.status < 300), toastText || '');
    } else {
      check('C03', '复制BOM API', false, '无确认按钮');
      check('C04', '复制成功提示', false);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }
  } else {
    check('C02', '复制弹窗', false, '无复制按钮');
    check('C03', '复制BOM API', false);
    check('C04', '复制成功提示', false);
  }

  // ══════════════════════════════════════════════════
  // Part 4: 激活 BOM
  // ══════════════════════════════════════════════════
  console.log('\n══ Part 4: 激活 BOM ══');

  // 找一个草稿 BOM 进入编辑器
  await page.goto('http://localhost/master-data/bom', { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(2000);

  // 找草稿行的按钮
  const draftEditBtn = page.locator('table tbody tr').filter({ hasText: /草稿/ }).locator('button').filter({ hasText: /继续录入|开始录入|查看|编辑/ }).first();
  if (await draftEditBtn.count() > 0) {
    await draftEditBtn.click();
    await page.waitForTimeout(2500);

    const activateBtn = page.locator('button').filter({ hasText: /^激活$|激活中/ }).first();
    check('A01', '激活按钮(草稿可见)', await activateBtn.count() > 0);

    if (await activateBtn.count() > 0) {
      await activateBtn.click();
      await page.waitForTimeout(800);

      // 确认弹窗
      const activateModal = page.locator('[role="dialog"], [class*="overlay"]').last();
      const activateText = await activateModal.evaluate(el => el.innerText).catch(() => '');
      check('A02', '激活确认弹窗', activateText.includes('激活') || activateText.includes('确认'));

      // 点击确认激活
      apiLog.length = 0;
      const activateConfirm = activateModal.locator('button').filter({ hasText: /确认激活|确认|激活/ }).last();
      if (await activateConfirm.count() > 0) {
        await activateConfirm.click();
        await page.waitForTimeout(2000);

        const activateApi = apiLog.find(a => a.url.includes('/activate') && a.method === 'POST');
        check('A03', '激活API调用', activateApi !== undefined, activateApi ? `HTTP ${activateApi.status}` : '无请求');

        // 激活后状态变化
        const editorText = await page.evaluate(() => document.body.innerText);
        check('A04', '激活后状态显示', editorText.includes('已激活') || editorText.includes('active') || !editorText.includes('草稿'));
      } else {
        check('A03', '激活API调用', false, '无确认按钮');
        check('A04', '激活后状态', false);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
      }
    } else {
      check('A02', '激活确认弹窗', false, '无激活按钮');
      check('A03', '激活API调用', false);
      check('A04', '激活后状态', false);
    }
  } else {
    // 没有草稿行，尝试直接进编辑器检查
    check('A01', '激活按钮', false, '无草稿BOM可激活');
    check('A02', '激活确认弹窗', false);
    check('A03', '激活API调用', false);
    check('A04', '激活后状态', false);
  }

  // ── 截图 ──
  await page.goto('http://localhost/master-data/bom', { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(1000);
  const ssPath = path.join(__dirname, 'bom-crud-screenshot.png');
  await page.screenshot({ path: ssPath, fullPage: true });
  console.log('\n截图已保存:', ssPath);

  // ── 汇总 ──
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`BOM CRUD 全流程测试: ${pass} PASS / ${fail} FAIL / ${pass + fail} TOTAL`);
  console.log(`${'═'.repeat(60)}`);

  await browser.close();
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
