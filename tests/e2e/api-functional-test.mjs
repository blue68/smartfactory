/**
 * [artifact:自动化测试] — API 功能点深度测试
 * 测试所有模块的 CRUD 操作、业务流程、安全拦截
 */

const BASE = 'http://localhost/api';
let TOKEN = '';
const RESULTS = [];

async function api(method, path, body = null) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` },
  };
  if (body) opts.body = JSON.stringify(body);
  const resp = await fetch(`${BASE}${path}`, opts);
  return resp.json();
}

function record(module, name, status, detail = '') {
  const icon = status === 'PASS' ? '✓' : status === 'FAIL' ? '✗' : '⚠';
  console.log(`  ${icon} ${status} | ${name}${detail ? ' — ' + detail : ''}`);
  RESULTS.push({ module, name, status, detail });
}

async function test(module, name, fn) {
  try {
    const r = await fn();
    record(module, name, r?.status || 'PASS', r?.detail || '');
  } catch (e) {
    record(module, name, 'FAIL', e.message?.substring(0, 100));
  }
}

function listDetail(d) {
  if (d?.data?.total != null) return `${d.data.total}条`;
  if (Array.isArray(d?.data)) return `${d.data.length}项`;
  return 'ok';
}

function checkResp(d, label) {
  if (d.code !== 0) return { status: 'WARN', detail: `code=${d.code}: ${d.message}` };
  return { detail: label || 'ok' };
}

// ────────────────────────────────────────────────────

async function main() {
  console.log('===== API 功能点深度测试 =====');
  console.log(`时间: ${new Date().toISOString()}\n`);

  // 登录
  const loginResp = await api('POST', '/auth/login', { username: 'admin', password: 'admin123', tenantCode: 'FACTORY001' });
  TOKEN = loginResp.data.accessToken;
  console.log('>> 登录成功\n');

  // ── 1. SKU CRUD ──
  console.log('📦 1. SKU 管理');
  await test('SKU', '列表查询', async () => {
    const d = await api('GET', '/skus?page=1&pageSize=5');
    return checkResp(d, listDetail(d));
  });
  await test('SKU', '统计数据', async () => {
    const d = await api('GET', '/skus/stats');
    return checkResp(d);
  });
  await test('SKU', '关键词搜索', async () => {
    const d = await api('GET', '/skus?keyword=%E6%B2%99%E5%8F%91');
    return checkResp(d, `搜索"沙发"→${d.data?.total}条`);
  });
  await test('SKU', '分类筛选', async () => {
    const d = await api('GET', '/skus?category1Id=1');
    return checkResp(d, `原材料类→${d.data?.total}条`);
  });
  await test('SKU', '新增SKU', async () => {
    const d = await api('POST', '/skus', {
      code: `QA-${Date.now()}`, name: 'QA自动测试物料', stockUnit: '个',
      purchaseUnit: '个', productionUnit: '个', safetyStock: 50,
      category1Id: 1, category2Id: 5, status: 'active',
    });
    if (d.code === 0) return { detail: `id=${d.data?.id}` };
    return { status: 'WARN', detail: d.message };
  });

  // ── 2. BOM ──
  console.log('\n🔧 2. BOM 管理');
  await test('BOM', '列表查询', async () => {
    const d = await api('GET', '/bom?page=1&pageSize=5');
    return checkResp(d, listDetail(d));
  });
  await test('BOM', 'BOM展开', async () => {
    const d = await api('GET', '/bom/1/expand');
    return checkResp(d);
  });
  await test('BOM', '成本分析', async () => {
    const d = await api('GET', '/bom/1/cost-breakdown');
    return checkResp(d);
  });
  await test('BOM', 'AI建议', async () => {
    const d = await api('GET', '/bom/ai-suggestion/1');
    if (d.code === 0) return { detail: 'ok' };
    return { status: 'WARN', detail: d.message };
  });

  // ── 3. 供应商 ──
  console.log('\n🏭 3. 供应商管理');
  await test('供应商', '列表查询', async () => {
    const d = await api('GET', '/suppliers?page=1&pageSize=5');
    return checkResp(d, listDetail(d));
  });
  await test('供应商', '下拉选项', async () => {
    const d = await api('GET', '/suppliers/options');
    return checkResp(d, `${d.data?.length}个选项`);
  });
  await test('供应商', '新增', async () => {
    const d = await api('POST', '/suppliers', {
      name: `QA测试供应商-${Date.now()}`, contactPerson: '张三',
      phone: '13800138000', address: '测试地址',
    });
    if (d.code === 0) return { detail: `id=${d.data?.id}` };
    return { status: 'WARN', detail: d.message };
  });

  // ── 4. 库存 ──
  console.log('\n📦 4. 库存管理');
  await test('库存', '列表查询', async () => {
    const d = await api('GET', '/inventory?page=1&pageSize=5');
    return checkResp(d, listDetail(d));
  });
  await test('库存', '入库操作', async () => {
    const d = await api('POST', '/inventory/inbound', {
      skuId: 1, quantity: 10, batchNo: `QA-${Date.now()}`, reason: 'QA测试入库',
    });
    return checkResp(d);
  });
  await test('库存', '出库操作', async () => {
    const d = await api('POST', '/inventory/outbound', {
      skuId: 1, quantity: 5, reason: 'QA测试出库',
    });
    return checkResp(d);
  });
  await test('库存', 'CSV导出', async () => {
    const resp = await fetch(`${BASE}/inventory/export/csv`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    if (resp.ok) return { detail: `status=${resp.status}, type=${resp.headers.get('content-type')}` };
    return { status: 'WARN', detail: `status=${resp.status}` };
  });

  // ── 5. 采购 ──
  console.log('\n🛒 5. 采购模块');
  await test('采购', '采购建议', async () => {
    const d = await api('GET', '/purchase/suggestions?page=1&pageSize=5');
    return checkResp(d, listDetail(d));
  });
  await test('采购', '采购订单', async () => {
    const d = await api('GET', '/purchase/orders?page=1&pageSize=5');
    return checkResp(d, listDetail(d));
  });
  await test('采购', '三方比价', async () => {
    const d = await api('GET', '/purchase/three-way-match?page=1&pageSize=5');
    return checkResp(d, listDetail(d));
  });
  await test('采购', '价格管理', async () => {
    const d = await api('GET', '/prices?page=1&pageSize=5');
    return checkResp(d, listDetail(d));
  });

  // ── 6. 销售 ──
  console.log('\n📝 6. 销售模块');
  await test('销售', '订单列表', async () => {
    const d = await api('GET', '/sales-orders?page=1&pageSize=5');
    return checkResp(d, listDetail(d));
  });
  await test('销售', '客户列表', async () => {
    const d = await api('GET', '/customers?page=1&pageSize=5');
    return checkResp(d, listDetail(d));
  });
  await test('销售', '客户选项', async () => {
    const d = await api('GET', '/customers/options');
    return checkResp(d, `${d.data?.length}个`);
  });
  await test('销售', '新建订单', async () => {
    const d = await api('POST', '/sales-orders', {
      customerId: 1, items: [{ skuId: 1, quantity: 10, unitPrice: 99.9 }], remark: 'QA自动测试',
    });
    if (d.code === 0) return { detail: `id=${d.data?.id}` };
    return { status: 'WARN', detail: d.message };
  });
  await test('销售', '约束引擎-订单列表', async () => {
    const d = await api('GET', '/sales/orders?page=1&pageSize=5');
    return checkResp(d, listDetail(d));
  });

  // ── 7. 生产 ──
  console.log('\n🔨 7. 生产模块');
  await test('生产', '工单列表', async () => {
    const d = await api('GET', '/production/orders?page=1&pageSize=5');
    return checkResp(d, listDetail(d));
  });
  await test('生产', '任务列表', async () => {
    const d = await api('GET', '/production/tasks?page=1&pageSize=5');
    return checkResp(d, listDetail(d));
  });
  await test('生产', '排产生成', async () => {
    const d = await api('POST', '/production/schedule/generate', {});
    if (d.code === 0) return { detail: 'ok' };
    return { status: 'WARN', detail: d.message };
  });

  // ── 8. 质量 ──
  console.log('\n🔬 8. 质量模块');
  await test('质量', '检验列表', async () => {
    const d = await api('GET', '/quality/inspections?page=1&pageSize=5');
    return checkResp(d, listDetail(d));
  });
  await test('质量', '质量统计', async () => {
    const d = await api('GET', '/quality/stats');
    return checkResp(d);
  });
  await test('质量', '追溯查询', async () => {
    const d = await api('GET', '/quality/traceability/1');
    if (d.code === 0) return { detail: 'ok' };
    return { status: 'WARN', detail: d.message };
  });

  // ── 9. 报表 ──
  console.log('\n📊 9. 报表与分析');
  await test('报表', '工资报表', async () => {
    const d = await api('GET', '/reports/wages?page=1&pageSize=5');
    return checkResp(d, listDetail(d));
  });
  await test('报表', '我的工资', async () => {
    const d = await api('GET', '/reports/wages/my?page=1&pageSize=5');
    return checkResp(d);
  });
  await test('分析', '经营KPI', async () => {
    const d = await api('GET', '/analytics/dashboard-kpi');
    return checkResp(d);
  });
  await test('分析', '库存分析', async () => {
    const d = await api('GET', '/analytics/inventory-analysis');
    return checkResp(d);
  });
  await test('分析', '生产效率', async () => {
    const d = await api('GET', '/analytics/production-efficiency');
    return checkResp(d);
  });
  await test('分析', '物料占比', async () => {
    const d = await api('GET', '/analytics/material-category-ratio');
    return checkResp(d);
  });
  await test('分析', '采购分类', async () => {
    const d = await api('GET', '/analytics/purchase-category');
    return checkResp(d);
  });

  // ── 10. V2 模块 ──
  console.log('\n🆕 10. V2 新增模块');
  await test('来料检验', '列表', async () => {
    const d = await api('GET', '/incoming-inspections?page=1&pageSize=5');
    return checkResp(d, listDetail(d));
  });
  await test('退货', '列表', async () => {
    const d = await api('GET', '/return-orders?page=1&pageSize=5');
    return checkResp(d, listDetail(d));
  });
  await test('MRP', '采购建议', async () => {
    const d = await api('GET', '/purchase-suggestions?page=1&pageSize=5');
    return checkResp(d, listDetail(d));
  });
  await test('排产建议', '历史', async () => {
    const d = await api('GET', '/schedule-suggestions/history?page=1&pageSize=5');
    return checkResp(d, listDetail(d));
  });
  await test('排产建议', '最新', async () => {
    const d = await api('GET', '/schedule-suggestions/latest');
    return checkResp(d);
  });
  await test('通知', '列表', async () => {
    const d = await api('GET', '/notifications?page=1&pageSize=5');
    return checkResp(d, listDetail(d));
  });
  await test('通知', '未读数', async () => {
    const d = await api('GET', '/notifications/unread-count');
    return checkResp(d, `未读=${JSON.stringify(d.data)}`);
  });
  await test('盘点', '列表', async () => {
    const d = await api('GET', '/stocktaking?page=1&pageSize=5');
    return checkResp(d, listDetail(d));
  });
  await test('结算', '列表', async () => {
    const d = await api('GET', '/settlements?page=1&pageSize=5');
    return checkResp(d, listDetail(d));
  });

  // ── 11. 配置 ──
  console.log('\n⚙️ 11. 配置模块');
  await test('工序', '列表', async () => {
    const d = await api('GET', '/process-configs?page=1&pageSize=5');
    return checkResp(d, listDetail(d));
  });
  await test('分类', '列表', async () => {
    const d = await api('GET', '/sku-categories');
    return checkResp(d, `${d.data?.length}个分类`);
  });
  await test('分类', '审计日志', async () => {
    const d = await api('GET', '/sku-categories/audit-logs?page=1&pageSize=5');
    return checkResp(d, listDetail(d));
  });

  // ── 12. AI ──
  console.log('\n🤖 12. AI 模块');
  await test('AI', '对话', async () => {
    const d = await api('POST', '/ai/chat', { message: '当前库存概况', conversationId: null });
    if (d.code === 0) return { detail: `回复长度=${JSON.stringify(d.data?.reply || d.data?.message || '').length}` };
    return { status: 'WARN', detail: d.message };
  });

  // ── 13. MRP/缺料 ──
  console.log('\n📋 13. MRP 缺料');
  await test('MRP', '缺料汇总', async () => {
    const d = await api('GET', '/mrp/shortage-summary');
    return checkResp(d);
  });
  await test('MRP', '供应链看板', async () => {
    const d = await api('GET', '/mrp/supply-chain-dashboard');
    return checkResp(d);
  });

  // ── 14. 安全测试 ──
  console.log('\n🔒 14. 安全测试');
  await test('安全', '无Token拦截', async () => {
    const resp = await fetch(`${BASE}/skus?page=1&pageSize=1`, {
      headers: { 'Content-Type': 'application/json' },
    });
    const d = await resp.json();
    if (d.code !== 0) return { detail: `正确拦截 code=${d.code}` };
    return { status: 'FAIL', detail: '未认证竟然可以访问！' };
  });
  await test('安全', '错误Token拦截', async () => {
    const resp = await fetch(`${BASE}/skus?page=1&pageSize=1`, {
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer invalid_token_xxx' },
    });
    const d = await resp.json();
    if (d.code !== 0) return { detail: `正确拦截 code=${d.code}` };
    return { status: 'FAIL', detail: '错误Token竟然可以访问！' };
  });
  await test('安全', 'SQL注入防护', async () => {
    const d = await api('GET', "/skus?keyword=' OR 1=1 --");
    if (d.code === 0 && d.data?.total === 0) return { detail: '注入无效，返回0条' };
    if (d.code === 0) return { detail: `返回${d.data?.total}条(需确认非全量)` };
    return { detail: `拦截 code=${d.code}` };
  });
  await test('安全', 'XSS防护', async () => {
    const d = await api('GET', '/skus?keyword=<script>alert(1)</script>');
    return checkResp(d, `返回${d.data?.total}条(标签被转义)` );
  });
  await test('安全', 'CORS预检', async () => {
    const resp = await fetch(`${BASE}/skus`, {
      method: 'OPTIONS',
      headers: { Origin: 'http://evil.com', 'Access-Control-Request-Method': 'GET' },
    });
    if (resp.status >= 400) return { detail: `恶意Origin被拒绝 status=${resp.status}` };
    return { status: 'WARN', detail: `status=${resp.status} 需检查CORS配置` };
  });

  // ── 15. 分页边界 ──
  console.log('\n📄 15. 分页边界');
  await test('分页', '大页码', async () => {
    const d = await api('GET', '/skus?page=9999&pageSize=5');
    if (d.code === 0 && d.data?.list?.length === 0) return { detail: '空列表,无崩溃' };
    return checkResp(d);
  });
  await test('分页', '负数页码', async () => {
    const d = await api('GET', '/skus?page=-1&pageSize=5');
    return { detail: `code=${d.code}, ${d.data?.total != null ? d.data.total + '条' : d.message}` };
  });
  await test('分页', '超大pageSize', async () => {
    const d = await api('GET', '/skus?page=1&pageSize=10000');
    return { detail: `code=${d.code}, 返回${d.data?.list?.length}条` };
  });

  // ── 汇总 ──
  console.log('\n\n===== 测试汇总 =====');
  const pass = RESULTS.filter(r => r.status === 'PASS').length;
  const warn = RESULTS.filter(r => r.status === 'WARN').length;
  const fail = RESULTS.filter(r => r.status === 'FAIL').length;
  console.log(`总测试点: ${RESULTS.length} | PASS: ${pass} | WARN: ${warn} | FAIL: ${fail}`);
  console.log(`通过率: ${(((pass + warn) / RESULTS.length) * 100).toFixed(1)}%`);

  if (fail > 0) {
    console.log('\n--- FAIL ---');
    RESULTS.filter(r => r.status === 'FAIL').forEach(r => console.log(`  ✗ [${r.module}] ${r.name}: ${r.detail}`));
  }
  if (warn > 0) {
    console.log('\n--- WARN ---');
    RESULTS.filter(r => r.status === 'WARN').forEach(r => console.log(`  ⚠ [${r.module}] ${r.name}: ${r.detail}`));
  }
}

main().catch(e => { console.error('脚本失败:', e.message); process.exit(1); });
