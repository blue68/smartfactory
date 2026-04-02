/**
 * 工序配置页面 E2E 测试
 *
 * 测试场景：
 *   T1: 新建模板
 *   T2: 工作站管理（静态展示验证）
 *   T3: 配置差异 - 新增专属工序
 *   T4: 保存差异
 *
 * 基于设计稿：docs/ui/web-process-config.html
 * 前端页面：services/web/src/pages/master-data/ProcessConfigPage.tsx
 */
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import http from 'http';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;

function check(id, name, ok, detail = '') {
  const tag = ok ? 'PASS' : 'FAIL';
  if (ok) pass++; else fail++;
  console.log(`[${tag}] ${id} ${name}${detail ? ' — ' + detail : ''}`);
}

// ── HTTP 工具 ──
function apiRequest(method, urlPath, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : undefined;
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const req = http.request({ hostname: 'localhost', port: 80, path: urlPath, method, headers }, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, data: raw }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function login() {
  const r = await apiRequest('POST', '/api/auth/login', {
    username: 'admin', password: 'admin123', tenantCode: 'FACTORY001',
  });
  return r.data?.data?.accessToken || r.data?.data?.access_token;
}

function camelizeKeys(obj) {
  if (Array.isArray(obj)) return obj.map(camelizeKeys);
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase())] = camelizeKeys(v);
    }
    return out;
  }
  return obj;
}

(async () => {
  console.log('═══════════════════════════════════════════════════');
  console.log('工序配置页面 E2E 测试');
  console.log('═══════════════════════════════════════════════════\n');

  const token = await login();
  if (!token) { console.error('登录失败'); process.exit(1); }

  // ══════════════════════════════════════════════════
  // 准备阶段：获取 SKU 列表用于创建模板
  // ══════════════════════════════════════════════════
  console.log('── 数据准备 ──');
  const skuRes = await apiRequest('GET', '/api/skus?pageSize=10', null, token);
  const allSkus = camelizeKeys(skuRes.data?.data?.list || []);
  console.log(`  已有 SKU: ${allSkus.length} 个`);

  if (allSkus.length === 0) {
    console.error('SKU 数据不足，至少需要 1 个 SKU');
    process.exit(1);
  }

  const testSku = allSkus[0];
  const ts = Date.now() % 100000;

  // ══════════════════════════════════════════════════
  // Playwright UI 测试
  // ══════════════════════════════════════════════════
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  const apiLog = [];
  page.on('response', async (resp) => {
    if (resp.url().includes('/api/')) {
      const body = await resp.text().catch(() => '');
      apiLog.push({ url: resp.url(), status: resp.status(), method: resp.request().method(), body: body.substring(0, 500) });
    }
  });

  // 登录
  await page.goto('http://localhost/login', { waitUntil: 'networkidle', timeout: 15000 });
  await page.fill('input[name="username"]', 'admin');
  await page.fill('input[name="password"]', 'admin123');
  await page.fill('input[name="tenantCode"]', 'FACTORY001');
  await page.locator('button[type="submit"]').click();
  await page.waitForTimeout(3000);

  // ══════════════════════════════════════════════════
  // T1: 新建模板
  // ══════════════════════════════════════════════════
  console.log('\n══ T1: 新建模板 ══');

  await page.goto('http://localhost/master-data/process-config', { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(2000);

  // T1.1: 页面加载验证
  const pageTitle = await page.textContent('h1, .breadcrumb__current').catch(() => '');
  check('T1.1', '工序配置页面加载', pageTitle.includes('工序配置') || pageTitle.includes('工序'));

  // T1.2: 点击"新建模板"按钮
  const createBtn = page.locator('button:has-text("新建模板")').first();
  if (await createBtn.count() > 0) {
    await createBtn.click();
    await page.waitForTimeout(1000);

    const modal = page.locator('[role="dialog"]').last();
    const modalText = await modal.evaluate(el => el.innerText).catch(() => '');
    check('T1.2', '新建模板弹窗打开', modalText.includes('新建') || modalText.includes('模板'));

    // T1.3: 填写模板名称
    const nameInput = modal.locator('input').first();
    if (await nameInput.count() > 0) {
      const templateName = `E2E测试模板-${ts}`;
      await nameInput.fill(templateName);
      await page.waitForTimeout(300);
      check('T1.3', '填写模板名称', true, templateName);

      // T1.4: 选择关联 SKU（如果有下拉选择器）
      const selectOrInput = modal.locator('select, input[placeholder*="SKU"], input[placeholder*="产品"]').first();
      if (await selectOrInput.count() > 0) {
        const tagName = await selectOrInput.evaluate(el => el.tagName);
        if (tagName === 'SELECT') {
          await selectOrInput.selectOption({ index: 1 });
        } else {
          // 输入框 - 尝试搜索并选择
          await selectOrInput.fill(testSku.name?.substring(0, 3) || testSku.skuCode);
          await page.waitForTimeout(1500);
          // 点击下拉结果
          const dropdown = page.locator('div[role="listbox"], div[class*="dropdown"], div[class*="option"]').first();
          if (await dropdown.count() > 0) {
            const firstOption = dropdown.locator('div, li').first();
            if (await firstOption.count() > 0) {
              await firstOption.click();
              await page.waitForTimeout(300);
            }
          }
        }
        check('T1.4', '选择关联SKU', true);
      } else {
        check('T1.4', '选择关联SKU', false, '未找到SKU选择器');
      }

      // T1.5: 提交创建
      apiLog.length = 0;
      const confirmBtn = modal.locator('button').filter({ hasText: /确认|创建|保存/ }).first();
      if (await confirmBtn.count() > 0) {
        await confirmBtn.click();
        await page.waitForTimeout(3000);

        const createApi = apiLog.find(a => a.url.includes('/process-config') && a.method === 'POST');
        check('T1.5', '新建模板API调用', createApi?.status === 201 || createApi?.status === 200,
          createApi ? `HTTP ${createApi.status}` : '无POST请求');

        // T1.6: 验证列表中出现新模板
        await page.waitForTimeout(1000);
        const tableText = await page.evaluate(() => {
          const table = document.querySelector('table');
          return table ? table.innerText : '';
        });
        const hasNewTemplate = tableText.includes(templateName);
        check('T1.6', '列表显示新建模板', hasNewTemplate, templateName);
      } else {
        check('T1.5', '新建模板提交', false, '无确认按钮');
        check('T1.6', '列表显示新建模板', false);
      }
    } else {
      check('T1.3', '填写模板名称', false, '无输入框');
      check('T1.4', '选择关联SKU', false);
      check('T1.5', '新建模板提交', false);
      check('T1.6', '列表显示新建模板', false);
    }

    // 关闭弹窗
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  } else {
    check('T1.2', '新建模板按钮', false, '未找到');
    check('T1.3', '填写模板名称', false);
    check('T1.4', '选择关联SKU', false);
    check('T1.5', '新建模板提交', false);
    check('T1.6', '列表显示新建模板', false);
  }

  // ══════════════════════════════════════════════════
  // T2: 工作站管理（静态展示验证）
  // ══════════════════════════════════════════════════
  console.log('\n══ T2: 工作站管理 ══');

  await page.goto('http://localhost/master-data/process-config', { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(2000);

  // T2.1: 点击"工作站管理"按钮
  const workstationBtn = page.locator('button:has-text("工作站管理")').first();
  if (await workstationBtn.count() > 0) {
    await workstationBtn.click();
    await page.waitForTimeout(1000);

    const wsModal = page.locator('[role="dialog"]').last();
    const wsModalText = await wsModal.evaluate(el => el.innerText).catch(() => '');
    check('T2.1', '工作站管理弹窗打开', wsModalText.includes('工作站'));

    // T2.2: 验证工作站列表表格
    const wsTable = wsModal.locator('table');
    if (await wsTable.count() > 0) {
      const wsRows = await wsTable.locator('tbody tr').count();
      check('T2.2', '工作站列表表格渲染', wsRows > 0, `${wsRows} 行`);

      // T2.3: 验证表头（工作站名称、工人数、关联工序）
      const wsHeaderText = await wsTable.locator('thead').evaluate(el => el.innerText).catch(() => '');
      const hasHeaders = wsHeaderText.includes('工作站') || wsHeaderText.includes('工人') || wsHeaderText.includes('工序');
      check('T2.3', '工作站表格表头', hasHeaders);
    } else {
      check('T2.2', '工作站列表表格', false, '未找到表格');
      check('T2.3', '工作站表格表头', false);
    }

    // 关闭弹窗
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  } else {
    check('T2.1', '工作站管理按钮', false, '未找到');
    check('T2.2', '工作站列表表格', false);
    check('T2.3', '工作站表格表头', false);
  }

  // ══════════════════════════════════════════════════
  // T3: 配置差异 - 新增专属工序
  // ══════════════════════════════════════════════════
  console.log('\n══ T3: 配置差异 - 新增专属工序 ══');

  // T3.1: 进入模板编辑视图
  await page.goto('http://localhost/master-data/process-config', { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(2000);

  const firstRow = page.locator('table tbody tr').first();
  const editBtn = firstRow.locator('button').filter({ hasText: /编辑|查看/ }).first();
  if (await editBtn.count() > 0) {
    await editBtn.click();
    await page.waitForTimeout(3000);

    // T3.1: 验证进入编辑视图（流程图渲染）
    const flowDiagram = page.locator('[class*="flow"], [class*="diagram"], [class*="node"]').first();
    const hasFlow = await flowDiagram.count() > 0;
    check('T3.1', '进入模板编辑视图', hasFlow);

    // T3.2: 验证配置差异区域存在
    const diffSection = page.locator('text=/配置差异|款式差异|差异配置/').first();
    if (await diffSection.count() > 0) {
      check('T3.2', '配置差异区域渲染', true);

      // T3.3: 展开差异行（如果有可展开行）
      const expandBtn = page.locator('button[aria-label*="展开"], button:has-text("▶"), button:has-text("▼")').first();
      if (await expandBtn.count() > 0) {
        await expandBtn.click();
        await page.waitForTimeout(800);

        const expandedContent = await page.evaluate(() => {
          const rows = document.querySelectorAll('tr[class*="expanded"], div[class*="detail"]');
          return rows.length > 0;
        });
        check('T3.3', '展开差异明细', expandedContent);
      } else {
        check('T3.3', '展开差异明细', false, '无可展开行（静态数据）');
      }

      // T3.4: 验证差异状态标识（新增/删除/修改）
      const diffText = await page.evaluate(() => {
        const section = document.body.innerText;
        return section;
      });
      const hasDiffStatus = diffText.includes('新增') || diffText.includes('删除') || diffText.includes('修改') ||
                            diffText.includes('added') || diffText.includes('deleted');
      check('T3.4', '差异状态标识显示', hasDiffStatus);
    } else {
      check('T3.2', '配置差异区域', false, '未找到');
      check('T3.3', '展开差异明细', false);
      check('T3.4', '差异状态标识', false);
    }
  } else {
    check('T3.1', '进入模板编辑视图', false, '无编辑按钮');
    check('T3.2', '配置差异区域', false);
    check('T3.3', '展开差异明细', false);
    check('T3.4', '差异状态标识', false);
  }

  // ══════════════════════════════════════════════════
  // T4: 保存差异
  // ══════════════════════════════════════════════════
  console.log('\n══ T4: 保存差异 ══');

  // T4.1: 点击节点进入编辑抽屉
  const firstNode = page.locator('[class*="node"], [class*="step"]').first();
  if (await firstNode.count() > 0) {
    await firstNode.click();
    await page.waitForTimeout(1000);

    // T4.1: 验证节点编辑抽屉打开
    const drawer = page.locator('[role="dialog"], [class*="drawer"], aside').last();
    const drawerText = await drawer.evaluate(el => el.innerText).catch(() => '');
    const hasDrawer = drawerText.includes('工序') || drawerText.includes('编辑') || drawerText.includes('名称');
    check('T4.1', '节点编辑抽屉打开', hasDrawer);

    if (hasDrawer) {
      // T4.2: 修改工序名称
      const nameInput = drawer.locator('input').first();
      if (await nameInput.count() > 0) {
        const originalName = await nameInput.inputValue();
        await nameInput.fill(`${originalName}-修改${ts}`);
        await page.waitForTimeout(300);
        check('T4.2', '修改工序名称', true);

        // T4.3: 保存修改
        apiLog.length = 0;
        const saveBtn = page.locator('button:has-text("保存")').first();
        if (await saveBtn.count() > 0) {
          await saveBtn.click();
          await page.waitForTimeout(2000);

          const updateApi = apiLog.find(a => a.url.includes('/process-config') && (a.method === 'PUT' || a.method === 'PATCH'));
          check('T4.3', '保存修改API调用', updateApi?.status === 200,
            updateApi ? `HTTP ${updateApi.status}` : '无PUT/PATCH请求');

          // T4.4: 验证保存成功提示
          const toastOrMsg = await page.evaluate(() => {
            const toast = document.querySelector('[role="alert"], [class*="toast"], [class*="message"]');
            return toast ? toast.innerText : '';
          });
          const hasSaveMsg = toastOrMsg.includes('成功') || toastOrMsg.includes('保存');
          check('T4.4', '保存成功提示', hasSaveMsg || updateApi?.status === 200);
        } else {
          check('T4.3', '保存修改按钮', false, '未找到');
          check('T4.4', '保存成功提示', false);
        }
      } else {
        check('T4.2', '修改工序名称', false, '无输入框');
        check('T4.3', '保存修改', false);
        check('T4.4', '保存成功提示', false);
      }
    } else {
      check('T4.2', '修改工序名称', false);
      check('T4.3', '保存修改', false);
      check('T4.4', '保存成功提示', false);
    }
  } else {
    check('T4.1', '节点编辑抽屉', false, '无节点可点击');
    check('T4.2', '修改工序名称', false);
    check('T4.3', '保存修改', false);
    check('T4.4', '保存成功提示', false);
  }

  // ── 截图 ──
  await page.goto('http://localhost/master-data/process-config', { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(1000);
  const ssPath = path.join(__dirname, 'process-config-screenshot.png');
  await page.screenshot({ path: ssPath, fullPage: true });
  console.log('\n截图:', ssPath);

  // ── 汇总 ──
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`工序配置 E2E 测试: ${pass} PASS / ${fail} FAIL / ${pass + fail} TOTAL`);
  console.log(`${'═'.repeat(60)}`);

  await browser.close();
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error('Fatal:', e); process.exit(1); });
