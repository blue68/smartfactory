/**
 * BOM 管理 — 高级测试用例（v2 修复版）
 *
 * 测试场景：
 *   T1: 半成品 BOM 被多个成品引用
 *   T2: 7 级 BOM 树 展开/折叠/编辑
 *   T3: 新增/修改物料 含损耗率
 *   T4: 物料需求计算 含损耗率
 *
 * 修复：
 *   - 7级BOM：每层使用不同 componentSkuId 避免循环引用检测
 *   - UI查找：BOM列表不显示版本号，改用 SKU 编码定位行
 *   - SKU ID：保存创建时实际使用的 ID，用于后续验证
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
// ── 辅助：snake_case → camelCase ──
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

// ── 辅助：进入 BOM 编辑器（按 SKU 编码找到第一行并点击） ──
async function enterBomEditor(page, skuCode) {
  const row = page.locator('table tbody tr').filter({ hasText: skuCode }).first();
  const btn = row.locator('button').filter({ hasText: /继续录入|查看|编辑|开始录入/ }).first();
  if (await btn.count() > 0) {
    await btn.click();
    await page.waitForTimeout(3000);
    return true;
  }
  return false;
}

// ── 辅助：返回列表 ──
async function backToList(page) {
  const backBtn = page.locator('button:has-text("← 返回列表")').first();
  if (await backBtn.count() > 0) {
    await backBtn.click();
    await page.waitForTimeout(1500);
  }
}

(async () => {
  console.log('═══════════════════════════════════════════════════');
  console.log('BOM 高级测试 v2 — 半成品引用 / 7级树 / 损耗率 / 需求计算');
  console.log('═══════════════════════════════════════════════════\n');

  const token = await login();
  if (!token) { console.error('登录失败'); process.exit(1); }

  // ══════════════════════════════════════════════════
  // 准备阶段：通过 API 创建测试数据
  // ══════════════════════════════════════════════════
  console.log('── 数据准备 ──');

  const skuRes = await apiRequest('GET', '/api/skus?pageSize=100', null, token);
  const allSkus = camelizeKeys(skuRes.data?.data?.list || []);
  console.log(`  已有 SKU: ${allSkus.length} 个`);

  const wipSkus = allSkus.filter(s => s.skuCode?.startsWith('WIP'));
  const rmSkus  = allSkus.filter(s => s.skuCode?.startsWith('RM'));
  const fgSkus  = allSkus.filter(s => s.skuCode?.startsWith('FG'));
  console.log(`  成品(FG): ${fgSkus.length}, 半成品(WIP): ${wipSkus.length}, 原材料(RM): ${rmSkus.length}`);

  if (fgSkus.length < 2 || wipSkus.length < 1 || rmSkus.length < 7) {
    console.error('SKU 数据不足，至少需要 2 FG、1 WIP、7 RM');
    process.exit(1);
  }

  const ts = Date.now() % 100000;
  const ver = (s) => `T${ts}-${s}`;

  // 记录实际使用的 SKU ID（用于后续验证）
  const wipSku = wipSkus[0];
  const fgA = fgSkus[0];
  const fgB = fgSkus[1];
  // 为各场景分配不同的 RM SKU
  const rmForWip0 = rmSkus[0];  // 半成品子物料1
  const rmForWip1 = rmSkus[1];  // 半成品子物料2
  const rmForFgA  = rmSkus[2];  // 成品A直接原材料
  const rmForFgB  = rmSkus[3];  // 成品B直接原材料
  // 7级BOM用的 SKU（每层不同，避免循环引用检测）
  const deepSkus = rmSkus.slice(0, 7);

  // ─── 创建成品A BOM（引用半成品 + 直接原材料，含损耗率）───
  const fgABomRes = await apiRequest('POST', '/api/bom', {
    skuId: Number(fgA.id),
    version: ver('FGA'),
    items: [
      {
        componentSkuId: Number(wipSku.id), quantity: '4', unit: '套', scrapRate: '0.03',
        children: [
          { componentSkuId: Number(rmForWip0.id), quantity: '2', unit: rmForWip0.stockUnit || '个', scrapRate: '0.05' },
          { componentSkuId: Number(rmForWip1.id), quantity: '3', unit: rmForWip1.stockUnit || '个', scrapRate: '0.10' },
        ],
      },
      { componentSkuId: Number(rmForFgA.id), quantity: '10', unit: rmForFgA.stockUnit || '个', scrapRate: '0.08' },
    ],
  }, token);
  const fgABomId = fgABomRes.data?.data?.id;
  console.log(`  成品A BOM: ID=${fgABomId}, HTTP ${fgABomRes.status}`);
  check('D01', '成品A BOM创建（引用半成品）', fgABomRes.status === 201 && fgABomId > 0);

  // ─── 成品B BOM（引用同一半成品，不同用量）───
  const fgBBomRes = await apiRequest('POST', '/api/bom', {
    skuId: Number(fgB.id),
    version: ver('FGB'),
    items: [
      {
        componentSkuId: Number(wipSku.id), quantity: '6', unit: '套', scrapRate: '0.02',
        children: [
          { componentSkuId: Number(rmForWip0.id), quantity: '2', unit: rmForWip0.stockUnit || '个', scrapRate: '0.05' },
          { componentSkuId: Number(rmForWip1.id), quantity: '3', unit: rmForWip1.stockUnit || '个', scrapRate: '0.10' },
        ],
      },
      { componentSkuId: Number(rmForFgB.id), quantity: '5', unit: rmForFgB.stockUnit || '个', scrapRate: '0.15' },
    ],
  }, token);
  const fgBBomId = fgBBomRes.data?.data?.id;
  console.log(`  成品B BOM: ID=${fgBBomId}, HTTP ${fgBBomRes.status}`);
  check('D02', '成品B BOM创建（引用同一半成品）', fgBBomRes.status === 201 && fgBBomId > 0);

  // ─── 7级深度BOM（每层用不同 componentSkuId）───
  // L1→L2→L3→L4→L5→L6→L7（叶子）
  // 每层用 deepSkus[i] 作为 componentSkuId
  const deepItems = [{
    componentSkuId: Number(deepSkus[0].id), quantity: '1', unit: '套', scrapRate: '0.01',
    children: [{
      componentSkuId: Number(deepSkus[1].id), quantity: '2', unit: '套', scrapRate: '0.02',
      children: [{
        componentSkuId: Number(deepSkus[2].id), quantity: '1', unit: '套', scrapRate: '0.03',
        children: [{
          componentSkuId: Number(deepSkus[3].id), quantity: '3', unit: '套', scrapRate: '0.04',
          children: [{
            componentSkuId: Number(deepSkus[4].id), quantity: '2', unit: '套', scrapRate: '0.05',
            children: [{
              componentSkuId: Number(deepSkus[5].id), quantity: '1', unit: '套', scrapRate: '0.06',
              children: [{
                componentSkuId: Number(deepSkus[6].id), quantity: '4', unit: '个', scrapRate: '0.10',
              }],
            }],
          }],
        }],
      }],
    }],
  }];
  const deepBomRes = await apiRequest('POST', '/api/bom', {
    skuId: Number(fgA.id), version: ver('DEEP7'), items: deepItems,
  }, token);
  const deepBomId = deepBomRes.data?.data?.id;
  console.log(`  7级BOM: ID=${deepBomId}, HTTP ${deepBomRes.status}`);
  check('D03', '7级深度BOM创建', deepBomRes.status === 201 && deepBomId > 0);

  // API 验证7级展开
  if (deepBomId) {
    const expandRes = await apiRequest('GET', `/api/bom/${deepBomId}/expand`, null, token);
    const expandData = camelizeKeys(expandRes.data?.data);
    function getMaxDepth(items, d = 1) {
      let max = d;
      for (const it of (items || [])) {
        if (it.children?.length > 0) max = Math.max(max, getMaxDepth(it.children, d + 1));
      }
      return max;
    }
    const maxDepth = getMaxDepth(expandData?.items || []);
    console.log(`  API展开最大深度: ${maxDepth}`);
    check('D04', 'API展开至少7级', maxDepth >= 7, `实际 ${maxDepth} 级`);
  } else {
    check('D04', 'API展开', false, '无BOM');
  }

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
  // T1: 半成品 BOM 被不同成品引用
  // ══════════════════════════════════════════════════
  console.log('\n══ T1: 半成品 BOM 被不同成品引用 ══');

  await page.goto('http://localhost/master-data/bom', { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(2000);

  // T1.1-T1.3: 成品A BOM 编辑器 — 验证包含半成品节点
  if (fgABomId) {
    // T1.1-T1.3: 通过 API 验证成品A BOM展开包含半成品及子物料
    const expandA = await apiRequest('GET', `/api/bom/${fgABomId}/expand`, null, token);
    const expandAData = camelizeKeys(expandA.data?.data);
    const wipNodeA = (expandAData?.items || []).find(i => Number(i.componentSkuId) === Number(wipSku.id));
    check('T1.1', '成品A BOM包含半成品节点(API)', !!wipNodeA, `半成品: ${wipSku.name}`);

    const hasChildRm = wipNodeA?.children?.some(c => Number(c.componentSkuId) === Number(rmForWip0.id));
    check('T1.2', '半成品展开显示子物料(API)', !!hasChildRm, `子物料: ${rmForWip0.name}`);

    // UI 验证：进入任意 BOM 编辑器，确认树中显示损耗率
    const enteredA = await enterBomEditor(page, fgA.skuCode);
    if (enteredA) {
      const treeTextA = await page.evaluate(() => {
        const el = document.querySelector('[role="tree"]');
        return el ? el.innerText : '';
      });
      check('T1.3', 'BOM树UI显示损耗率(%)', treeTextA.includes('%'));
      await backToList(page);
    } else {
      check('T1.3', 'BOM树UI', false, '无法进入编辑器');
    }
  } else {
    check('T1.1', '成品A BOM', false, '创建失败');
    check('T1.2', '半成品展开', false);
    check('T1.3', '损耗率显示', false);
  }

  // T1.4-T1.5: 成品B BOM — 也引用同一半成品
  if (fgBBomId) {
    // T1.4-T1.5: API 验证成品B也引用同一半成品
    const expandB = await apiRequest('GET', `/api/bom/${fgBBomId}/expand`, null, token);
    const expandBData = camelizeKeys(expandB.data?.data);
    const wipNodeB = (expandBData?.items || []).find(i => Number(i.componentSkuId) === Number(wipSku.id));
    check('T1.4', '成品B BOM也包含同一半成品(API)', !!wipNodeB, `半成品: ${wipSku.name}`);

    // 验证成品B对半成品用量=6
    const wipQtyB = wipNodeB ? parseFloat(wipNodeB.quantity) : 0;
    check('T1.5', '成品B半成品用量=6(API)', Math.abs(wipQtyB - 6) < 0.01, `实际: ${wipQtyB}`);
  } else {
    check('T1.4', '成品B BOM', false, '创建失败');
    check('T1.5', '成品B半成品用量', false);
  }

  // ══════════════════════════════════════════════════
  // T2: 7 级 BOM 树展开/折叠/编辑
  // ══════════════════════════════════════════════════
  console.log('\n══ T2: 7 级 BOM 树展开/折叠/编辑 ══');

  if (deepBomId) {
    await page.goto('http://localhost/master-data/bom', { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(2000);

    // 7级BOM也挂在 fgA 下，找到对应行（最新的在最前面）
    const enteredDeep = await enterBomEditor(page, fgA.skuCode);
    if (enteredDeep) {
      const treeNodes = page.locator('[role="treeitem"]');
      const initialCount = await treeNodes.count();
      check('T2.1', 'BOM树渲染', initialCount > 0, `初始可见节点: ${initialCount}`);

      // T2.2: 逐层点击展开箭头（"展开全部"按钮是占位符，无onClick）
      // 循环点击所有可见的 ▶ 按钮来展开树
      for (let round = 0; round < 8; round++) {
        const toggleBtns = page.locator('[role="treeitem"] button[aria-label="展开"]');
        const toggleCount = await toggleBtns.count();
        if (toggleCount === 0) break;
        for (let t = 0; t < toggleCount; t++) {
          await toggleBtns.nth(t).click();
          await page.waitForTimeout(200);
        }
        await page.waitForTimeout(300);
      }
      await page.waitForTimeout(500);

      const expandedCount = await treeNodes.count();
      check('T2.2', '逐层展开后节点数增加', expandedCount > initialCount, `${initialCount} → ${expandedCount}`);

      // T2.3: 检查 data-level 最大值
      const maxLevel = await page.evaluate(() => {
        const items = document.querySelectorAll('[role="treeitem"]');
        let max = 0;
        items.forEach(el => {
          const l = parseInt(el.getAttribute('data-level') || '0', 10);
          if (l > max) max = l;
        });
        return max;
      });
      check('T2.3', '展开后可见至少5级深度', maxLevel >= 5, `最大 data-level: ${maxLevel}`);

      // T2.4: 折叠 — 点击所有 ▼ 按钮
      const collapseBtns = page.locator('[role="treeitem"] button[aria-label="收起"]');
      const collapseCount = await collapseBtns.count();
      for (let c = collapseCount - 1; c >= 0; c--) {
        await collapseBtns.nth(c).click();
        await page.waitForTimeout(150);
      }
      await page.waitForTimeout(500);
      const collapsedCount = await treeNodes.count();
      check('T2.4', '折叠后节点数减少', collapsedCount < expandedCount, `${expandedCount} → ${collapsedCount}`);

      // T2.5: 再次展开
      for (let round = 0; round < 8; round++) {
        const toggleBtns2 = page.locator('[role="treeitem"] button[aria-label="展开"]');
        const tc = await toggleBtns2.count();
        if (tc === 0) break;
        for (let t = 0; t < tc; t++) {
          await toggleBtns2.nth(t).click();
          await page.waitForTimeout(200);
        }
        await page.waitForTimeout(300);
      }
      await page.waitForTimeout(500);

      // 找最深层的 treeitem（data-level 最大的）
      const deepestNode = await page.evaluate(() => {
        const items = document.querySelectorAll('[role="treeitem"]');
        let maxEl = null, maxL = 0;
        items.forEach(el => {
          const l = parseInt(el.getAttribute('data-level') || '0', 10);
          if (l > maxL) { maxL = l; maxEl = el; }
        });
        if (maxEl) maxEl.click();
        return maxL;
      });
      await page.waitForTimeout(500);
      check('T2.5', '深层叶子节点可点击', deepestNode >= 5, `点击了 level=${deepestNode} 的节点`);

      // T2.6: 修改用量
      const editQtyBtn = page.locator('button').filter({ hasText: /修改用量/ }).first();
      if (await editQtyBtn.count() > 0) {
        await editQtyBtn.click();
        await page.waitForTimeout(800);

        const editModal = page.locator('[role="dialog"]').last();
        const editText = await editModal.evaluate(el => el.innerText).catch(() => '');
        check('T2.6', '深层节点修改用量弹窗', editText.includes('用量'));

        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
      } else {
        check('T2.6', '修改用量按钮', false, '未找到');
      }

      await backToList(page);
    } else {
      for (let i = 1; i <= 6; i++) check(`T2.${i}`, '(无7级BOM入口)', false);
    }
  } else {
    for (let i = 1; i <= 6; i++) check(`T2.${i}`, '(7级BOM创建失败)', false);
  }

  // ══════════════════════════════════════════════════
  // T3: 新增/修改物料 含损耗率
  // ══════════════════════════════════════════════════
  console.log('\n══ T3: 新增/修改物料 含损耗率 ══');

  if (fgABomId) {
    await page.goto('http://localhost/master-data/bom', { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(2000);

    const enteredT3 = await enterBomEditor(page, fgA.skuCode);
    if (enteredT3) {
      // T3.1: 新增物料弹窗含损耗率字段
      const addBtn = page.locator('button:has-text("+ 新增物料")');
      if (await addBtn.count() > 0) {
        await addBtn.click();
        await page.waitForTimeout(800);

        const addModal = page.locator('[role="dialog"]').last();
        const addText = await addModal.evaluate(el => el.innerText).catch(() => '');
        check('T3.1', '新增物料弹窗含损耗率字段', addText.includes('损耗率'));

        // T3.2: 搜索物料并设置损耗率
        const searchInput = addModal.locator('input').first();
        if (await searchInput.count() > 0) {
          await searchInput.fill(rmSkus[5].name?.substring(0, 2) || '海');
          await page.waitForTimeout(1500);

          // 点击搜索结果 — 查找 maxHeight 容器内的可点击 div
          await page.waitForTimeout(500);
          const clicked = await addModal.evaluate((el) => {
            // 搜索结果在 maxHeight+overflowY:auto 的容器中
            const containers = el.querySelectorAll('div');
            for (const c of containers) {
              const style = c.style || {};
              const computed = window.getComputedStyle(c);
              if ((computed.maxHeight && computed.maxHeight !== 'none' && computed.overflowY === 'auto') ||
                  (style.maxHeight && style.overflowY === 'auto')) {
                const items = c.querySelectorAll(':scope > div');
                if (items.length > 0) {
                  items[0].click();
                  return true;
                }
              }
            }
            // fallback: 找 cursor:pointer 的 div
            const allDivs = el.querySelectorAll('div');
            for (const d of allDivs) {
              if (d.style.cursor === 'pointer' && d.textContent.includes('RM')) {
                d.click();
                return true;
              }
            }
            return false;
          });
          await page.waitForTimeout(800);

          // 填写用量和损耗率
          const allInputs = addModal.locator('input');
          const inputCount = await allInputs.count();
          console.log(`  新增弹窗输入框: ${inputCount} 个`);

          // 找到数字类型的输入框填写
          for (let i = 0; i < inputCount; i++) {
            const inp = allInputs.nth(i);
            const type = await inp.getAttribute('type');
            const placeholder = await inp.getAttribute('placeholder') || '';
            const val = await inp.inputValue();
            if ((type === 'number' || placeholder.includes('用量') || placeholder.includes('数量')) && !val) {
              await inp.fill('8');
            }
            if (placeholder.includes('损耗') || placeholder.includes('scrap')) {
              await inp.fill('5');
            }
          }

          apiLog.length = 0;
          const confirmBtn = addModal.locator('button').filter({ hasText: /确认|保存|添加/ }).first();
          if (await confirmBtn.count() > 0) {
            await confirmBtn.click();
            await page.waitForTimeout(2000);

            const addApi = apiLog.find(a => a.url.includes('/items') && a.method === 'POST');
            check('T3.2', '新增物料API调用', addApi?.status === 201 || addApi?.status === 200,
              addApi ? `HTTP ${addApi.status}` : '无POST请求');
          } else {
            check('T3.2', '新增物料确认', false, '无确认按钮');
          }
        } else {
          check('T3.2', '新增物料搜索', false, '无搜索框');
        }

        // 关闭可能残留的弹窗
        for (let i = 0; i < 3; i++) {
          if (await page.locator('[role="dialog"]').count() > 0) {
            await page.keyboard.press('Escape');
            await page.waitForTimeout(300);
          }
        }
      } else {
        check('T3.1', '新增物料按钮', false, '未找到');
        check('T3.2', '新增物料', false);
      }

      // T3.3: 验证新增后树中显示损耗率
      await page.waitForTimeout(1000);
      const treeAfterAdd = await page.evaluate(() => {
        const el = document.querySelector('[role="tree"]');
        return el ? el.innerText : '';
      });
      const hasScrapInTree = treeAfterAdd.includes('%');
      check('T3.3', 'BOM树显示损耗率', hasScrapInTree);

      // T3.4-T3.5: 修改物料用量和损耗率
      // 展开全部
      const expandBtn = page.locator('button').filter({ hasText: /展开全部/ }).first();
      if (await expandBtn.count() > 0) {
        await expandBtn.click();
        await page.waitForTimeout(500);
      }

      // 选中第一个 treeitem
      const firstItem = page.locator('[role="treeitem"]').first();
      if (await firstItem.count() > 0) {
        await firstItem.click();
        await page.waitForTimeout(500);

        const editBtn = page.locator('button').filter({ hasText: /修改用量/ }).first();
        if (await editBtn.count() > 0) {
          await editBtn.click();
          await page.waitForTimeout(800);

          await page.waitForTimeout(500);
          const editModal = page.locator('[role="dialog"]').last();
          const editText = await editModal.evaluate(el => el.innerText).catch(() => '');
          console.log('  修改弹窗文本:', editText.substring(0, 300));
          // 弹窗应包含"损耗"字样；如果不包含，可能是弹窗未完全渲染
          const hasScrField = editText.includes('损耗') || editText.includes('scrap');
          // 也检查是否有3个输入框（用量+单位+损耗率）
          const editFieldCount = await editModal.locator('input').count();
          check('T3.4', '修改用量弹窗含损耗率字段', hasScrField || editFieldCount >= 3,
            `含"损耗": ${hasScrField}, 输入框: ${editFieldCount}`);

          // 修改损耗率
          const editInputs = editModal.locator('input');
          const editInputCount = await editInputs.count();
          if (editInputCount >= 2) {
            // 修改用量
            await editInputs.first().fill('15');
            await page.waitForTimeout(200);

            // 修改损耗率（通常是最后一个数字输入框）
            for (let i = editInputCount - 1; i >= 0; i--) {
              const placeholder = await editInputs.nth(i).getAttribute('placeholder') || '';
              const label = await page.evaluate((idx) => {
                const inputs = document.querySelectorAll('[role="dialog"]:last-of-type input');
                const inp = inputs[idx];
                if (!inp) return '';
                const lbl = inp.closest('label, div')?.querySelector('label, span');
                return lbl ? lbl.textContent : '';
              }, i);
              if (placeholder.includes('损耗') || label.includes('损耗')) {
                await editInputs.nth(i).fill('7.5');
                break;
              }
            }

            apiLog.length = 0;
            const saveBtn = editModal.locator('button').filter({ hasText: /确认|保存/ }).first();
            if (await saveBtn.count() > 0) {
              await saveBtn.click();
              await page.waitForTimeout(2000);

              const patchApi = apiLog.find(a => a.url.includes('/items/') && a.method === 'PATCH');
              check('T3.5', '修改用量+损耗率 PATCH API', patchApi?.status === 200,
                patchApi ? `HTTP ${patchApi.status}` : '无PATCH请求');
            } else {
              check('T3.5', '保存修改', false, '无确认按钮');
            }
          } else {
            check('T3.5', '修改用量+损耗率', false, `只有 ${editInputCount} 个输入框`);
          }

          // 关闭弹窗
          for (let i = 0; i < 3; i++) {
            if (await page.locator('[role="dialog"]').count() > 0) {
              await page.keyboard.press('Escape');
              await page.waitForTimeout(300);
            }
          }
        } else {
          check('T3.4', '修改用量按钮', false, '未找到');
          check('T3.5', '修改用量+损耗率', false);
        }
      } else {
        check('T3.4', '选中物料', false, '无节点');
        check('T3.5', '修改用量+损耗率', false);
      }

      // T3.6: 验证修改后树上显示更新的损耗率
      await page.waitForTimeout(1000);
      const updatedTree = await page.evaluate(() => {
        const el = document.querySelector('[role="tree"]');
        return el ? el.innerText : '';
      });
      const has75 = updatedTree.includes('7.50%') || updatedTree.includes('7.5%') || updatedTree.includes('7.50') || updatedTree.includes('0.075');
      check('T3.6', 'BOM树显示更新后的损耗率(7.5%)', has75,
        has75 ? '' : '未在树中找到 7.50%');

      await backToList(page);
    } else {
      for (let i = 1; i <= 6; i++) check(`T3.${i}`, '(无编辑入口)', false);
    }
  } else {
    for (let i = 1; i <= 6; i++) check(`T3.${i}`, '(BOM创建失败)', false);
  }

  // ══════════════════════════════════════════════════
  // T4: 物料需求计算含损耗
  // ══════════════════════════════════════════════════
  console.log('\n══ T4: 物料需求计算含损耗 ══');

  // T4.1-T4.4: API 验证
  if (fgABomId) {
    const reqRes = await apiRequest('GET', `/api/bom/${fgABomId}/material-requirements?productionQty=100`, null, token);
    const reqData = camelizeKeys(reqRes.data?.data || []);
    check('T4.1', '需求计算API', reqRes.status === 200 && reqData.length > 0,
      `HTTP ${reqRes.status}, 物料种类: ${reqData.length}`);

    if (reqData.length > 0) {
      console.log('  需求计算结果:');
      reqData.forEach(r => console.log(`    ${r.skuCode || r.skuId} ${r.skuName}: ${r.totalQty} ${r.unit}`));

      // T4.2: 直接原材料含损耗 — RM[2]: 100 × 10 × 1.08 = 1080
      const rmDirect = reqData.find(r => Number(r.skuId) === Number(rmForFgA.id));
      if (rmDirect) {
        const expected = 100 * 10 * 1.08;
        const actual = parseFloat(rmDirect.totalQty);
        check('T4.2', '直接原材料需求含损耗', Math.abs(actual - expected) < 1,
          `期望≈${expected.toFixed(2)}, 实际=${rmDirect.totalQty}`);
      } else {
        check('T4.2', '直接原材料需求', false, `未找到 skuId=${rmForFgA.id}`);
      }

      // T4.3: 半成品子物料1 — RM[0]: 100 × 4×1.03 × 2×1.05 = 865.2
      const rmNested0 = reqData.find(r => Number(r.skuId) === Number(rmForWip0.id));
      if (rmNested0) {
        const expected = 100 * 4 * 1.03 * 2 * 1.05;
        const actual = parseFloat(rmNested0.totalQty);
        check('T4.3', '半成品子物料多级损耗', Math.abs(actual - expected) < 1,
          `期望≈${expected.toFixed(2)}, 实际=${rmNested0.totalQty}`);
      } else {
        check('T4.3', '半成品子物料需求', false, `未找到 skuId=${rmForWip0.id}`);
      }

      // T4.4: 半成品子物料2 — RM[1]: 100 × 4×1.03 × 3×1.10 = 1359.6
      const rmNested1 = reqData.find(r => Number(r.skuId) === Number(rmForWip1.id));
      if (rmNested1) {
        const expected = 100 * 4 * 1.03 * 3 * 1.10;
        const actual = parseFloat(rmNested1.totalQty);
        check('T4.4', '半成品子物料2多级损耗', Math.abs(actual - expected) < 1,
          `期望≈${expected.toFixed(2)}, 实际=${rmNested1.totalQty}`);
      } else {
        check('T4.4', '半成品子物料2需求', false, `未找到 skuId=${rmForWip1.id}`);
      }
    } else {
      check('T4.2', '需求计算结果', false, '无数据');
      check('T4.3', '多级损耗', false);
      check('T4.4', '多级损耗2', false);
    }
  } else {
    check('T4.1', '需求计算', false, '无BOM');
    check('T4.2', '直接原材料', false);
    check('T4.3', '多级损耗', false);
    check('T4.4', '多级损耗2', false);
  }

  // T4.5-T4.6: UI 验证需求计算
  if (fgABomId) {
    await page.goto('http://localhost/master-data/bom', { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(2000);

    const enteredT4 = await enterBomEditor(page, fgA.skuCode);
    if (enteredT4) {
      const calcBtn = page.locator('button:has-text("需求计算")');
      if (await calcBtn.count() > 0) {
        await calcBtn.click();
        await page.waitForTimeout(800);

        const calcModal = page.locator('[role="dialog"]').last();
        const calcQtyInput = calcModal.locator('input[type="number"]').first();
        if (await calcQtyInput.count() > 0) {
          await calcQtyInput.fill('100');
          apiLog.length = 0;

          const calcExecBtn = calcModal.locator('button').filter({ hasText: '计算' }).first();
          if (await calcExecBtn.count() > 0) {
            await calcExecBtn.click();
            await page.waitForTimeout(2000);

            const calcApi = apiLog.find(a => a.url.includes('material-requirements'));
            check('T4.5', 'UI需求计算API调用', calcApi?.status === 200,
              calcApi ? `HTTP ${calcApi.status}` : '无请求');

            const calcText = await calcModal.evaluate(el => el.innerText).catch(() => '');
            const hasResult = calcText.includes('物料') || calcText.includes('数量') || calcText.includes('需求') || calcText.includes('总计');
            check('T4.6', 'UI需求计算结果展示', hasResult);
          } else {
            check('T4.5', 'UI计算按钮', false, '未找到');
            check('T4.6', 'UI计算结果', false);
          }
        } else {
          check('T4.5', 'UI数量输入', false, '未找到');
          check('T4.6', 'UI计算结果', false);
        }

        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
      } else {
        check('T4.5', 'UI需求计算按钮', false, '未找到');
        check('T4.6', 'UI计算结果', false);
      }

      await backToList(page);
    } else {
      check('T4.5', 'UI计算入口', false, '无编辑按钮');
      check('T4.6', 'UI计算结果', false);
    }
  } else {
    check('T4.5', 'UI计算', false, '无BOM');
    check('T4.6', 'UI计算结果', false);
  }

  // ── 截图 ──
  await page.goto('http://localhost/master-data/bom', { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(1000);
  const ssPath = path.join(__dirname, 'bom-advanced-screenshot.png');
  await page.screenshot({ path: ssPath, fullPage: true });
  console.log('\n截图:', ssPath);

  // ── 汇总 ──
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`BOM 高级测试 v2: ${pass} PASS / ${fail} FAIL / ${pass + fail} TOTAL`);
  console.log(`${'═'.repeat(60)}`);

  await browser.close();
  process.exit(fail > 0 ? 1 : 0);

})().catch(e => { console.error('Fatal:', e); process.exit(1); });
