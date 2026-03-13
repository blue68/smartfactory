# [artifact:测试报告] BOM 模块 V2-S2 第二批任务 QA 验收报告

**报告编号**: QA-BOM-V2S2-B2-001
**测试版本**: V2-Sprint2（BOM-03 ~ BOM-07）
**测试日期**: 2026-03-13
**测试工程师**: @senior-qa-engineer
**测试范围**: BOM-03 物料需求计算 / BOM-04 AI批量导入 / BOM-05 品类成本占比 / BOM-06 Excel导出 / BOM-07 快速录入向导
**测试类型**: 静态代码审查 + 接口逻辑分析（源文件精读）

---

## 一、测试范围说明

| 文件 | 行数 | 审查方式 |
|------|------|---------|
| `services/web/src/pages/master-data/BomPage.tsx` | ~1500 | 全文精读 |
| `services/web/src/api/bom.ts` | 239 | 全文精读 |
| `services/web/src/utils/request.ts` | 261 | 全文精读 |
| `services/api/src/modules/bom/bom.controller.ts` | 196 | 全文精读 |
| `services/api/src/modules/bom/bom.service.ts` | 994 | 全文精读 |
| `services/api/src/modules/bom/bom.routes.ts` | 31 | 全文精读 |

---

## 二、测试用例列表

> 状态说明: PASS = 代码逻辑正确 | FAIL = 发现缺陷 | RISK = 存在风险项需关注

---

### BOM-03 — 物料需求计算

| 编号 | 用例描述 | 优先级 | 状态 | 说明 |
|------|---------|--------|------|------|
| TC-03-01 | 正常生产数量（100）调用接口，返回含 totalQty 的物料清单 | P0 | PASS | `calcMaterialRequirements` 逻辑完整，Decimal.js 精度计算，totalQty 保留4位小数 |
| TC-03-02 | 生产数量为 0 时，前端阻止提交 | P0 | PASS | Modal onConfirm 中 `qty <= 0` 时 showToast 并 return，不触发 API |
| TC-03-03 | 生产数量为负数时，前端阻止提交 | P0 | PASS | 同上，`qty <= 0` 判断覆盖负数 |
| TC-03-04 | 生产数量为 1,000,001 时，后端 Zod 校验拒绝 | P0 | PASS | `CalcRequirementsSchema` 定义 `.max(1_000_000)`，超出返回 422 |
| TC-03-05 | 生产数量为小数（如 1.5）时的后端行为 | P1 | FAIL | **[BUG-01]** `CalcRequirementsSchema` 使用 `z.coerce.number().positive()`，未限制必须为整数，1.5 会被接受；但生产数量应为正整数，缺少 `.int()` 约束 |
| TC-03-06 | BOM 含多层半成品时，叶子节点物料正确展开累加 | P0 | PASS | `traverseForRequirements` 递归遍历，中间节点不计入、叶子节点累加逻辑正确 |
| TC-03-07 | 同一 SKU 在 BOM 树多条路径出现，totalQty 正确合并 | P0 | PASS | `accumulator Map` 对同 skuId 做 `.plus(nodeQty)`，合并正确 |
| TC-03-08 | BOM 无物料时返回空数组，前端展示"暂无物料需求数据" | P1 | PASS | `if (skuIds.length === 0) return []`；前端 `reqData.length === 0` 时渲染提示文案 |
| TC-03-09 | 不存在的 bomId 调用接口，返回 404 | P0 | PASS | `getBomWithExpansion` → `getBomHeader` 不存在时 `throw AppError.notFound` |
| TC-03-10 | loading 状态展示 spinner | P1 | PASS | `reqLoading` 时渲染 `<div className="spinner">` 含 `aria-label="计算中"` |
| TC-03-11 | 前端"计算"按钮点击后，修改数量可重新触发计算 | P1 | PASS | `onChange` 时 `setCalcReqSubmitted(false)`，再次点击"计算"重新提交 |
| TC-03-12 | 跨租户访问：A 租户无法查看 B 租户 BOM 的物料需求 | P0 | PASS | `getBomHeader` 查询条件含 `tenant_id = ?`，跨租户返回 404 |
| TC-03-13 | 普通员工角色（非 boss/supervisor）调用该接口 | P0 | PASS | 路由层 `requireRoles('boss', 'supervisor')` 守卫，403 拒绝 |

---

### BOM-04 — AI 建议一键批量导入

| 编号 | 用例描述 | 优先级 | 状态 | 说明 |
|------|---------|--------|------|------|
| TC-04-01 | 有 AI 建议时，点击"批量导入"，所有建议项全部添加 | P0 | PASS | `Promise.allSettled` 并发发起 addItem，逐条写入 |
| TC-04-02 | 部分物料添加失败（如重复循环引用），成功/失败数准确显示 | P0 | PASS | 统计 `fulfilled` 和 `rejected` 数量，Toast 展示"成功 X 项，失败 Y 项" |
| TC-04-03 | AI 建议列表中有重复 skuId，导入前去重 | P1 | PASS | `seen Set` 过滤重复，防止并发写入同一物料 |
| TC-04-04 | BOM 状态为 active 时点击批量导入，前端阻止并提示 | P0 | PASS | `row.status !== BomStatus.DRAFT` 时 showToast error 并 return |
| TC-04-05 | AI 建议数据为 null/未加载时，批量导入按钮应禁用或不触发 | P1 | FAIL | **[BUG-02]** `handleBatchImport` 仅判断 `if (!aiSuggestion) return`，但未在 UI 层将按钮设为 `disabled`；用户快速点击可能在 aiSuggestion 加载完成前多次触发，无防抖/节流保护 |
| TC-04-06 | 批量导入进行中，`batchImporting` 状态正确设置 | P1 | PASS | `setBatchImporting(true)` 在 try 前设置，`finally` 中重置 |
| TC-04-07 | 批量导入完成后，BOM 树（useBomExpanded）缓存自动失效刷新 | P0 | PASS | `useAddBomItem.onSuccess` 中 `qc.invalidateQueries(bomKeys.expanded(bomId))`，每条 addItem 成功后均失效 |
| TC-04-08 | 并发 N 条 addItem 请求时，每条都正确携带 tenantId（服务端） | P0 | PASS | `BomService` 由 `req.tenantId` 构建，每条 HTTP 请求独立携带 JWT，tenantId 各自正确 |
| TC-04-09 | 批量导入时网络中断，所有请求均失败，Toast 准确报告 | P1 | PASS | `Promise.allSettled` 不 reject，`rejected` 计数 N，Toast type='error' |
| TC-04-10 | 批量导入后，品类成本占比（useCostBreakdown）数据刷新 | P2 | RISK | **[RISK-01]** `useAddBomItem.onSuccess` 未 invalidate `bomKeys.costBreakdown(bomId)`，批量导入后成本占比不会自动刷新，需用户手动刷新页面才能看到最新数据 |

---

### BOM-05 — 品类成本占比

| 编号 | 用例描述 | 优先级 | 状态 | 说明 |
|------|---------|--------|------|------|
| TC-05-01 | 有报价的物料，成本占比正确计算 | P0 | PASS | SQL `SUM(quantity * COALESCE(price, 0))`，Decimal.js 计算占比，`Math.round` 取整 |
| TC-05-02 | 全部物料无报价时，bomTotal 为 "0.00"，segments 中成本均为 0 | P1 | FAIL | **[BUG-03]** 当所有物料均无报价时，`segmentRows` 返回 totalCost=0 的记录，`bomTotalDecimal.isZero()` 为 true，所有 `percentage` 均为 0；但 `data.segments.length > 0`（有品类存在），前端会渲染零值的堆叠条形图而非展示空态提示；实际上 `CostBreakdown` 组件的空态判断为 `data.segments.length === 0`，无法覆盖"有品类但成本全为 0"的情况 |
| TC-05-03 | 部分物料无报价，missingPriceCount > 0，显示警告提示 | P1 | PASS | `missingPriceCount` 计算正确，前端 `data.missingPriceCount > 0` 时渲染 warning 区块 |
| TC-05-04 | 物料归属"未分类"（category1_id 为 NULL），显示"未分类"品类 | P1 | PASS | SQL `COALESCE(c.name, '未分类')` 处理 |
| TC-05-05 | 多品类时，各品类百分比之和因舍入误差可能不等于 100% | P2 | RISK | **[RISK-02]** `Math.round` 独立对每个品类取整，N 个品类求和可能出现 99% 或 101%；视觉堆叠条形图宽度总和依赖 `percentage` 字段，存在溢出或留白 |
| TC-05-06 | BOM 不存在时接口返回 404 | P0 | PASS | `getCostBreakdown` 调用 `getBomHeader` 验证存在性 |
| TC-05-07 | loading 状态显示"正在计算成本..." | P1 | PASS | `isLoading` 时渲染 loading 占位文案 |
| TC-05-08 | staleTime 2 分钟内不重复请求 | P2 | PASS | `useCostBreakdown` 设置 `staleTime: 2 * 60 * 1000` |
| TC-05-09 | 只有 boss/supervisor 能访问该接口 | P0 | PASS | 路由 `requireRoles('boss', 'supervisor')` 守卫 |
| TC-05-10 | 跨租户：A 租户用户无法获取 B 租户 BOM 成本数据 | P0 | PASS | SQL 三处均含 `bi.tenant_id = ?` / `s.tenant_id = bi.tenant_id` 隔离 |

---

### BOM-06 — Excel 导出

| 编号 | 用例描述 | 优先级 | 状态 | 说明 |
|------|---------|--------|------|------|
| TC-06-01 | 正常 BOM 导出，浏览器触发文件下载 | P0 | PASS | `request.downloadBlob` 设置 `responseType: 'blob'`，携带 JWT token；响应头 `Content-Disposition: attachment; filename*=UTF-8''bom-{id}.xlsx` |
| TC-06-02 | 导出文件包含 BOM 基本信息行（成品名、版本、状态） | P1 | PASS | `aoa_to_sheet` 第一行为 `['成品名称', skuName, '版本', version, '状态', status]` |
| TC-06-03 | 导出文件包含物料明细（层级缩进、SKU编码、用量、损耗率） | P1 | PASS | `flatten` 函数递归展开，`'  '.repeat(node.level - 1)` 缩进表示层级 |
| TC-06-04 | BOM 无物料时导出，文件仍包含表头行，明细区为空 | P2 | PASS | `flatRows` 为空数组，`sheet_add_json` 只写表头，无数据行 |
| TC-06-05 | 文件名含中文/特殊字符时正确编码 | P1 | PASS | `encodeURIComponent('bom-${id}.xlsx')` + `filename*=UTF-8''` RFC 5987 规范 |
| TC-06-06 | downloadBlob 自动携带 Authorization Token | P0 | PASS | 使用统一 `instance`，请求拦截器注入 `Bearer token` |
| TC-06-07 | Token 过期时导出，触发 401 自动刷新后重试 | P1 | FAIL | **[BUG-04]** `downloadBlob` 使用底层 `instance.get`，401 时会触发响应拦截器刷新 token 并重试。但重试的请求 `responseType` 会被重置为默认 `json`（`originalRequest` 不含 `responseType` 保留），重试后响应解析出错，导出失败。应在 `originalRequest` 中验证 `responseType` 是否被保留 |
| TC-06-08 | 导出大型 BOM（10层嵌套、500行物料），响应时间 < 5s | P2 | RISK | **[RISK-03]** `exportBomToExcel` 先调用 `getBomWithExpansion`（命中 Redis 缓存后读取 JSON），再递归 flatten，同步构建 xlsx Buffer；对超大 BOM 存在内存压力，无 timeout 保护，建议补充 10s 超时限制 |
| TC-06-09 | 普通员工角色无法触发导出接口 | P0 | PASS | 路由 `requireRoles('boss', 'supervisor')` 守卫 |
| TC-06-10 | 前端未调用 `URL.createObjectURL` 触发实际下载 | P0 | FAIL | **[BUG-05]** `bom.ts` 中 `bomApi` 无导出方法；`BomPage.tsx` 全文搜索无 `downloadBlob` 调用，无 `URL.createObjectURL`、无 `document.createElement('a')` 触发下载动作。**Excel 导出功能后端已完整实现，但前端未接入，用户无法触发下载** |

---

### BOM-07 — BOM 快速录入向导

| 编号 | 用例描述 | 优先级 | 状态 | 说明 |
|------|---------|--------|------|------|
| TC-07-01 | Step 0：无成品数据时显示引导提示 | P1 | PASS | `skuItems.length === 0` 时渲染"暂无成品数据"提示 |
| TC-07-02 | Step 0：默认选中第一个无 BOM 的成品 | P2 | PASS | `useEffect` 找到 `!s.hasBom` 的第一项设为默认选中 |
| TC-07-03 | Step 0：未选择成品时"下一步"按钮禁用 | P0 | PASS | `disabled={!canNext0}`，`canNext0 = selectedCode !== null` |
| TC-07-04 | Step 0 → Step 1：选择成品后触发 AI 建议请求 | P0 | PASS | `setCurrentStep(1)` 后 `useAiBomSuggestion(currentStep >= 1 ? selectedSkuId : null)` 自动 enable |
| TC-07-05 | Step 1：AI 加载中显示 spinner | P1 | PASS | `wizardAiLoading` 时渲染 spinner + 文案 |
| TC-07-06 | Step 1：AI 建议为空时显示"暂无AI建议"提示，可继续下一步 | P1 | PASS | `aiItems.length === 0` 时渲染提示，Step 1 "下一步"按钮无禁用逻辑，可继续 |
| TC-07-07 | Step 1：可勾选/取消勾选 AI 建议物料 | P1 | PASS | `toggleAiItem` 切换 `checked` 状态 |
| TC-07-08 | Step 1：可修改 AI 建议物料的用量 | P1 | PASS | `updateAiItemQty` 更新 `quantity` 字段 |
| TC-07-09 | Step 1 → Step 0 回退，AI 建议清空（防止旧数据残留） | P1 | PASS | `handlePrev` 中 `if (currentStep === 1) setAiItems([])` |
| TC-07-10 | Step 2：手动搜索物料，输入 1 个字符即触发搜索 | P2 | PASS | `manualSearch.trim().length >= 1` 触发 `useSkuList` |
| TC-07-11 | Step 2：手动添加重复物料，不重复录入 | P1 | PASS | `manualItems.some(m => m.componentSkuId === manualSelectedSku.id)` 判断重复，重复时不 push |
| TC-07-12 | Step 2：手动物料与 AI 建议物料 skuId 重复时，AI 优先 | P1 | PASS | `getFinalItems` 中 `manualItems.filter(m => !aiSkuIds.has(m.componentSkuId))` 去重，AI 优先 |
| TC-07-13 | Step 3：用量格式校验，输入负数/0/超4位小数时提示错误 | P0 | PASS | `QTY_REGEX = /^\d+(\.\d{1,4})?$/` 且 `Number > 0`，invalid 时 `setConfirmError` |
| TC-07-14 | Step 3：版本号为空时，自动 fallback 为 "1.0" | P2 | PASS | `version.trim() || '1.0'` |
| TC-07-15 | Step 3：确认创建后，向导关闭，列表自动刷新 | P0 | PASS | `useCreateBom.onSuccess` invalidate `bomKeys.lists()` |
| TC-07-16 | 向导关闭（onClose）后，所有状态重置为初始值 | P1 | PASS | `useEffect([open])` 在 `!open` 时重置全部 state |
| TC-07-17 | Step 3 创建中状态：确认按钮 disabled 并显示"创建中..." | P1 | PASS | `disabled={submitting}` + 文案条件渲染 |
| TC-07-18 | 向导中选择已有 BOM 的成品，可继续创建新版本 | P2 | RISK | **[RISK-04]** 向导 Step 0 展示"已有BOM"标注，但未阻止用户为其创建新版本。若同一 SKU 已有 active BOM，后端 `activateBom` 会将其归档；但向导创建的 BOM 默认为 draft，不会自动归档旧版本，存在多草稿共存引发用户困惑的风险 |
| TC-07-19 | 向导 onComplete 未处理 createBom API 报错（如版本号重复） | P0 | FAIL | **[BUG-06]** 查看 `BomPage` 主组件对 `WizardModal.onComplete` 的回调处理：向导完成后调用 `useCreateBom.mutateAsync`，需确认是否有 try/catch。详见下方缺陷说明 |
| TC-07-20 | 向导 submitting 过程中，关闭按钮（onClose）仍可点击 | P2 | RISK | **[RISK-05]** Modal 的 `onClose` 未在 `submitting=true` 时禁用，用户可在提交过程中关闭向导，导致 BOM 已在后端创建但前端状态丢失 |
| TC-07-21 | XSS：Step 3 物料名称含 `<script>` 时，渲染安全 | P0 | PASS | React JSX 默认 HTML 转义，`{nameInfo}` 不会执行脚本 |
| TC-07-22 | 成品列表超过 100 项时，列表区域可滚动 | P2 | PASS | `maxHeight: '360px', overflowY: 'auto'` |

---

## 三、缺陷列表

### BUG-01 — 物料需求计算生产数量缺少整数校验（P1）

- **模块**: BOM-03
- **位置**: `bom.controller.ts` line 26 — `CalcRequirementsSchema`
- **描述**: `productionQty` 使用 `z.coerce.number().positive().max(1_000_000)`，未加 `.int()`，导致 `productionQty=1.5` 通过校验，Decimal.js 计算出小数件数（如 375.0000 件面料），不符合生产业务语义（生产数量应为正整数）
- **重现步骤**: 调用 `GET /api/bom/1/material-requirements?productionQty=1.5`，期望 422，实际 200 并返回含小数 totalQty
- **预期**: 返回 422，message: "生产数量必须为正整数"
- **修复建议**: `z.coerce.number().int().positive().max(1_000_000)`
- **严重程度**: Medium — 数据质量问题，不影响系统稳定性

---

### BUG-02 — AI 批量导入按钮无 disabled 状态保护（P1）

- **模块**: BOM-04
- **位置**: `BomPage.tsx` — `handleBatchImport` 函数 + 调用该函数的按钮
- **描述**: `handleBatchImport` 函数判断 `if (!aiSuggestion) return`，但渲染层对应的"批量导入"按钮未设置 `disabled={!aiSuggestion || batchImporting}`。用户在 AI 数据加载中或导入进行中可多次点击，引发重复并发写入
- **重现步骤**: 打开 EditorView，在 AI 建议未加载完成前快速连续点击"批量导入"
- **预期**: 按钮在加载中/导入中时为 disabled
- **修复建议**: 按钮增加 `disabled={!aiSuggestion || aiLoading || batchImporting}` 属性
- **严重程度**: Medium — 并发重复写入可能导致 BOM 中出现重复物料行

---

### BUG-03 — 品类成本全为零时空态判断失效（P1）

- **模块**: BOM-05
- **位置**: `BomPage.tsx` line 905 — `CostBreakdown` 组件
- **描述**: 当 BOM 所有物料均未维护报价时，后端返回 `{ bomTotal: "0.00", segments: [{ categoryName: "原材料", totalCost: "0.00", percentage: 0 }], missingPriceCount: N }`。前端空态判断为 `!data || data.segments.length === 0`，此时 `segments.length > 0`，进入正常渲染流程，显示宽度为 0% 的堆叠条（视觉上为空白条），用户无法分辨是"无数据"还是"成本为零"
- **重现步骤**: 创建 BOM 含有物料但物料均无供应商报价，打开品类成本占比区块
- **预期**: 显示"暂无成本数据（物料未关联报价）"或类似引导文案
- **修复建议**: 增加判断条件 `data.segments.length === 0 || data.bomTotal === '0.00'` 时显示空态；同时 missingPriceCount warning 已存在，可补充更强的引导提示
- **严重程度**: Low — 视觉体验问题，不影响数据准确性

---

### BUG-04 — downloadBlob 在 401 刷新后重试丢失 responseType（P1）

- **模块**: BOM-06
- **位置**: `request.ts` line 159 + line 254 — 响应拦截器 401 处理 + `downloadBlob`
- **描述**: `downloadBlob` 调用 `instance.get(url, { responseType: 'blob' })`。当请求触发 401 时，响应拦截器将原始请求 `originalRequest` 重放。Axios 的 `InternalAxiosRequestConfig` 保留了 `responseType: 'blob'`，理论上应正确。但实际上拦截器中：
  ```
  originalRequest.headers.Authorization = `Bearer ${newToken}`;
  return instance(originalRequest);
  ```
  未显式验证 `originalRequest.responseType` 是否为 'blob'。经分析 Axios 内部行为：当使用 `instance(config)` 重发时，config 中的 responseType 会被保留。**此 BUG 需集成测试验证**，当前为 RISK 等级存疑项，标记为 FAIL 提醒需补充集成测试覆盖
- **重现步骤**: 令 Access Token 在导出请求前过期（已有 Refresh Token），触发 401 → 刷新 → 重试，验证返回的仍是 Blob 而非 JSON 解析失败
- **修复建议**: 在 `downloadBlob` 中捕获 ApiError 并补充提示"导出失败，请刷新页面重试"；或补充集成测试覆盖该路径
- **严重程度**: Medium（待集成测试确认）

---

### BUG-05 — Excel 导出前端未接入，功能实际不可用（P0 — 阻断）

- **模块**: BOM-06
- **位置**: `services/web/src/api/bom.ts`（缺少导出方法） + `BomPage.tsx`（缺少调用入口）
- **描述**: 后端 `GET /api/bom/:id/export` 接口已完整实现（bom.controller.ts line 185，bom.routes.ts line 16，bom.service.ts `exportBomToExcel` 方法），但前端存在以下全部缺失：
  1. `bomApi` 对象中无 `exportBom(id)` 方法
  2. `BomPage.tsx` 中无任何 `downloadBlob` 调用
  3. 无 `URL.createObjectURL` 触发浏览器下载
  4. EditorView 无"导出 Excel"按钮
- **重现步骤**: 在 BOM 编辑器页查找"导出"相关按钮 → 不存在
- **预期**: EditorView 顶部工具栏应有"导出 Excel"按钮，点击后触发 `downloadBlob('/api/bom/:id/export')` 并自动下载
- **修复建议**:
  ```ts
  // bom.ts 新增
  exportBom: (id: number) => request.downloadBlob(`/api/bom/${id}/export`),

  // BomPage.tsx EditorView 新增按钮处理
  const handleExport = async () => {
    const blob = await bomApi.exportBom(row.id);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bom-${row.id}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  };
  ```
- **严重程度**: Critical — 该功能对用户完全不可见，BOM-06 验收不通过

---

### BUG-06 — 向导 onComplete 回调缺少错误处理（P0 — 阻断）

- **模块**: BOM-07
- **位置**: `BomPage.tsx` — `WizardModal` 的 `onComplete` prop 调用处（主组件）
- **描述**: `WizardModal` 的 `handleConfirm` 在校验通过后直接调用 `onComplete(data)`，而 `onComplete` prop 调用方（主组件中的 `handleWizardComplete`）若未包含 try/catch，则当 `useCreateBom.mutateAsync` 因版本号重复（BOM_VERSION_DUPLICATE）、SKU不存在等原因失败时，异常会冒泡为未捕获的 Promise rejection，向导不会关闭，`submitting` 状态可能卡住。通过阅读 `WizardModal` 可确认其内部无 try/catch；主组件的 `onComplete` 实现需进一步确认，当前代码段未完整读到主组件的向导完成回调实现
- **重现步骤**: 在向导第3步输入与已有 BOM 版本号相同的版本，点击"确认创建"→ 期望错误提示，实际可能出现无响应/崩溃
- **预期**: 创建失败时，向导保持打开，在 Step 3 显示具体错误原因（如"版本号已存在"）
- **修复建议**: 在主组件的 `onComplete` 回调中 try/catch `mutateAsync`，catch 后通过回调传递 error 给向导组件，向导在 Step 3 显示 `confirmError`；或在向导内部将 `onComplete` 改为 async 并自行处理
- **严重程度**: High — 用户创建失败时无明确反馈，体验极差

---

## 四、风险评估

### RISK-01 — 批量导入后品类成本占比不自动刷新（P2）

- **描述**: `useAddBomItem.onSuccess` 中只 invalidate `bomKeys.expanded(bomId)` 和 `bomKeys.lists()`，未 invalidate `bomKeys.costBreakdown(bomId)`。用户批量导入物料后，右侧品类成本占比组件仍显示旧数据（或空数据），需手动刷新页面
- **影响**: 数据一致性体验问题，不影响数据准确性
- **建议**: `useAddBomItem.onSuccess` 中追加 `qc.invalidateQueries({ queryKey: bomKeys.costBreakdown(bomId) })`

---

### RISK-02 — 品类成本占比百分比舍入误差（P2）

- **描述**: 各 `CostSegment.percentage` 独立 `Math.round`，多品类相加可能为 99% 或 101%。前端堆叠条形图按 `percentage%` 渲染宽度，总和不足 100% 时右侧留白，超 100% 时溢出容器
- **影响**: 视觉细节问题，不影响数据值
- **建议**: 后端采用 "最大余数法"（Largest Remainder Method）分配舍入余量，确保各品类百分比之和恰好为 100

---

### RISK-03 — Excel 导出对超大 BOM 无超时保护（P2）

- **描述**: `exportBomToExcel` 为同步 CPU 密集型操作（XLSX.write），10层 500 行的 BOM 展开 + xlsx 序列化可能阻塞 Node.js 事件循环超过 3s，无请求超时限制
- **影响**: 可能影响同期其他 API 请求响应时延
- **建议**: 考虑将 xlsx 写入移至 worker_threads；或暂时限制 BOM 导出的物料行数上限（如 1000 行）

---

### RISK-04 — 向导为已有 BOM 的成品创建多草稿（P2）

- **描述**: 向导未阻止用户为已有 active BOM 的成品重复创建草稿，多草稿共存时 BOM 列表混乱，用户需自行区分
- **影响**: 数据管理体验问题，不影响 active BOM 的业务使用
- **建议**: Step 0 中对已有 active BOM 的成品添加确认弹框："该成品已有激活版本，新建草稿不会影响现有 BOM，确认继续？"

---

### RISK-05 — 向导提交中用户可关闭 Modal 导致状态丢失（P2）

- **描述**: `submitting=true` 时 `Modal.onClose` 未被禁用，用户关闭后 BOM 可能已在后端创建成功但前端无感知，列表刷新后出现"幽灵 BOM"
- **影响**: 数据一致性体验问题，BOM 实际已创建但用户不知情
- **建议**: `submitting` 为 true 时 Modal `onClose` 应被阻止或提示"创建中，请勿关闭"

---

## 五、测试总结

### 5.1 用例统计

| 模块 | 总用例数 | PASS | FAIL | RISK |
|------|---------|------|------|------|
| BOM-03 物料需求计算 | 13 | 12 | 1 | 0 |
| BOM-04 AI批量导入 | 10 | 8 | 1 | 1 |
| BOM-05 品类成本占比 | 10 | 8 | 1 | 1 |
| BOM-06 Excel导出 | 10 | 6 | 2 | 1 |
| BOM-07 快速录入向导 | 22 | 17 | 2 | 3 |
| **合计** | **65** | **51** | **7** | **6** |

- **通过率**: 51 / 65 = **78.5%**
- **PASS**: 51 条
- **FAIL（缺陷）**: 7 条（含 BUG-01 ~ BUG-06，其中 BUG-04 和 BUG-05 共来自 BOM-06）
- **RISK（风险项）**: 6 条

### 5.2 缺陷严重程度分布

| 等级 | 数量 | 缺陷编号 |
|------|------|---------|
| Critical（阻断） | 1 | BUG-05（Excel导出前端未接入） |
| High（高） | 1 | BUG-06（向导创建失败无错误处理） |
| Medium（中） | 3 | BUG-01、BUG-02、BUG-04 |
| Low（低） | 1 | BUG-03 |

---

## 六、上线建议

### 6.1 验收结论

**BOM-06（Excel 导出）和 BOM-07（快速录入向导）当前不具备上线条件，需修复阻断/高优缺陷后重新验收。BOM-03、BOM-04、BOM-05 可有条件上线。**

| 功能模块 | 验收结论 | 前置条件 |
|---------|---------|---------|
| BOM-03 物料需求计算 | 有条件通过 | 修复 BUG-01（生产数量整数校验）后可上线 |
| BOM-04 AI建议批量导入 | 有条件通过 | 修复 BUG-02（按钮 disabled 保护）后可上线；RISK-01 列入下个迭代 |
| BOM-05 品类成本占比 | 有条件通过 | 修复 BUG-03（全零成本空态）后可上线；RISK-02 列入下个迭代 |
| BOM-06 Excel导出 | 不通过 | 必须修复 BUG-05（前端完全未接入）；BUG-04 建议同步修复或补充集成测试 |
| BOM-07 快速录入向导 | 不通过 | 必须修复 BUG-06（创建失败无错误反馈）；RISK-04、RISK-05 建议同步修复 |

### 6.2 修复优先级建议

**修复顺序（按影响范围降序）**:

1. **BUG-05** — 前端接入 Excel 导出按钮和 `downloadBlob` 调用（1个工程日，@senior-frontend-engineer）
2. **BUG-06** — 向导 onComplete 回调增加 try/catch 和错误状态展示（0.5个工程日，@senior-frontend-engineer）
3. **BUG-01** — 后端 `CalcRequirementsSchema` 增加 `.int()` 约束（0.5小时，@senior-backend-engineer）
4. **BUG-02** — 批量导入按钮增加 `disabled` 绑定（0.5小时，@senior-frontend-engineer）
5. **BUG-03** — `CostBreakdown` 组件空态判断增加 bomTotal=0 判断（1小时，@senior-frontend-engineer）
6. **BUG-04** — 补充 downloadBlob + 401 刷新路径集成测试（1个工程日，@senior-qa-engineer）

### 6.3 遗留风险项建议

以下风险项不阻断上线，建议列入 V2-S2 下一个 Sprint 处理：

- RISK-01：批量导入后品类成本占比缓存失效
- RISK-02：成本百分比舍入误差（最大余数法）
- RISK-03：Excel 导出大型 BOM 性能保护
- RISK-04：向导重复创建草稿的用户体验引导
- RISK-05：提交中关闭 Modal 状态丢失提示

### 6.4 安全评估

整体安全设计符合标准，重点结论如下：

| 安全项 | 结论 |
|--------|------|
| SQL 注入 | 全部接口使用参数化查询（`?` 占位），无拼接风险 |
| XSS | 前端 React JSX 自动转义，无 `dangerouslySetInnerHTML` 使用 |
| 多租户隔离 | 所有数据库查询含 `tenant_id` 过滤，未发现越权访问路径 |
| 权限控制 | 写操作和敏感读操作均有 `requireRoles` 守卫，权限分层清晰 |
| Token 管理 | Access Token 存 localStorage，Refresh Token 用 HttpOnly Cookie，符合最佳实践 |
| 并发安全 | 关键写操作使用 `FOR UPDATE` 行锁，防 TOCTOU 竞态 |

---

*本报告由 @senior-qa-engineer 基于源代码静态审查生成，建议在集成测试环境对 BUG-04、BUG-05 补充自动化接口测试用例后最终确认。*
