# 前端变更技术总结 — 2026-03-12

> 角色：senior-frontend-engineer
> 涉及文件：5 个（页面 2 + API 2 + 基础设施 1）

---

## 1. `services/web/src/pages/master-data/SupplierPage.tsx`

### 1.1 新增：完整供应商详情视图（SupplierDetailView）

- **新增** 供应商详情主视图组件 `SupplierDetailView`，包含顶部信息摘要区（供应商名称、等级徽章、编码、联系人）以及 Tab 切换栏（基础信息 / 关联 SKU / 价格协议 / 绩效数据）。
- **新增** 四个 Tab 子组件，各自独立封装逻辑与 UI：
  - `SupplierInfoTab`：基础信息只读展示，采用 Grid 布局，字段包括名称、级别、联系人、电话、邮箱、品类、账期、交货周期、合作起始时间、最近采购时间、编码、备注。
  - `SupplierSkuTab`：关联 SKU 列表，含"查看物料"跳转（`useNavigate` 导航至 SKU 管理页）、"价格历史" Modal（调用 `usePriceHistory`）、"新增关联 SKU" Modal（`useCreatePrice` + `useSkuList` 搜索防抖 300ms）。
  - `SupplierPriceAgreementsTab`：价格协议列表，含"前往价格管理"导航按钮（`useNavigate` 跳转至 `/purchase/prices`），协议条目展示 SKU 名称、单价、有效期和状态标签。
  - `SupplierPerformanceTab`：绩效数据展示，包含准时交货率、质量合格率、平均交货周期、累计订单数及近期交货记录表格。

### 1.2 新增：调整级别 Modal

- **新增** `AdjustRatingModal` 组件，支持从当前详情视图直接修改供应商级别（A/B/C），调用 `useUpdateSupplier` 提交并即时刷新列表与详情缓存。

### 1.3 修复：ID 类型一致性

- **修复** `supplierId` 和 `skuId` 在跨组件传递时统一通过 `Number()` 进行类型转换，避免字符串/数值混用导致 React Query `queryKey` 不匹配的 cache miss 问题（关键修复点：`SupplierSkuTab.handleAddSku` 内 `skuId: Number(selectedSku.id)` 和 `supplierId: Number(supplierId)`）。

### 1.4 修改：新增关联 SKU 流程

- **新增** `useSkuList` 搜索 hook 引用，用于 SKU 搜索下拉；搜索关键词 300ms 防抖，结果自动过滤已关联 SKU（`skuOptions` 通过 `filter` 排除 `data` 已有条目）。
- **新增** 搜索防抖逻辑：`useEffect` + `setTimeout(300)` + cleanup `clearTimeout`。

### 1.5 依赖引入

- **新增** import：`useNavigate`（react-router-dom）、`useQueryClient`（@tanstack/react-query）、`usePriceHistory`、`useCreatePrice`（@/api/price）、`useSkuList`（@/api/sku）。
- **新增** 类型 import：`SupplierRelatedSku`、`SupplierPriceAgreement`、`SupplierPerformance`（@/api/supplier）、`PriceHistoryItem`（@/api/price）、`Sku`（@/types/models）。

---

## 2. `services/web/src/pages/purchase/PricePage.tsx`

### 2.1 新增：`attachmentUrl` 字段支持

- **新增** `PriceFormData` 类型新增 `attachmentUrl: string` 字段，用于存储上传成功后服务器返回的文件 URL。
- **新增** `EMPTY_PRICE_FORM` 中 `attachmentUrl` 初始化为空字符串。

### 2.2 新增：`MaterialGroup` 类型与按物料查询视图

- **新增** `MaterialGroup` 类型定义：`{ skuId, skuName, skuCode, prices: PriceRow[] }`，用于"按物料"视图分组结构。
- **新增** `materialGroups` memo：从 `priceRows` 计算物料分组，按 `skuId` 归类，去重排序。
- **新增** `MaterialGroupAccordion` 组件：与 `SupplierGroupAccordion` 结构对称，表头列为供应商/等级/单位/含税单价/vs历史均价/有效期/状态/操作，无"新增协议"快捷按钮。

### 2.3 新增：文件上传——`DrawerFormFields`

- **新增** 本地状态 `selectedFile: File | null` 和 `uploading: boolean` 管理上传过程。
- **新增** 文件选择 `onChange` 异步处理：校验文件大小（>10MB 拒绝）→ 调用 `uploadPriceFile(file)` → 将返回的 `url` 写入 `form.attachmentUrl`；上传失败时清空 `selectedFile` 与 `attachmentUrl`；finally 中重置 `input.value`。
- **新增** 上传中状态展示：按钮 `pointerEvents: none` + `opacity: 0.6`，显示"上传中..."文本。
- **新增** 已有文件回显：`hasFile` 条件判断（`selectedFile !== null || form.attachmentUrl !== ''`），展示文件名（截取 URL 末段）和文件大小（KB），提供 `×` 清除按钮。

### 2.4 修复：`doSave` update payload 字段缺漏

- **修复** 编辑保存（update 分支）payload 补充 `taxRate`、`batchPricing`、`batchRule`、`attachmentUrl` 四个字段，此前这四个字段在编辑时不会写入后端，导致更新丢失。

### 2.5 修复：`openEdit` 加载 `attachmentUrl`

- **修复** `openEdit` 回填逻辑新增 `attachmentUrl: price.attachmentUrl ?? ''`，确保编辑已有协议时文件回显正常。

### 2.6 修复：协议详情区图片/PDF 分支渲染

- **修复** `ChartPanel` 内"关联协议文件"展示区：通过正则 `/\.(jpg|jpeg|png)$/i` 区分图片与 PDF，图片内联渲染 `<img>` 并附"查看原图"链接，PDF 仅渲染"查看文件"链接；此前所有文件均以纯链接形式渲染，图片无法预览。

### 2.7 修复：emoji 转义方式

- **修复** 源码中 emoji 从 HTML entity 写法改为 Unicode 字符字面量（如 `\u{1F4CE}` 对应回形针图标），解决 JSX 中 HTML entity 不正确渲染的问题。

### 2.8 修复：`moq` 默认值

- **修复** `openEdit` 回填 `moq` 字段时，将 `undefined` 回退为 `0` 而非空字符串（`moq: price.moq ?? 0`），防止 number input 显示 NaN。

---

## 3. `services/web/src/api/price.ts`

### 3.1 新增：`uploadPriceFile` 函数

- **新增** 独立异步函数 `uploadPriceFile(file: File): Promise<{ url: string; originalName: string; size: number }>`。
- 实现要点：
  - 构造 `FormData` 并 `append('file', file)`。
  - 直接调用 `request.instance.post('/api/upload', formData, { headers: { 'Content-Type': undefined } })`，显式设置 `Content-Type: undefined` 让浏览器自动填入 `multipart/form-data; boundary=...`，避免手动设置导致 boundary 缺失。
  - 返回 `res.data.data`，类型为 `{ url, originalName, size }`。
- **说明** 此函数为普通 async function，不封装为 React Query mutation（上传为一次性触发行为，不需要缓存或 invalidate）。

### 3.2 既有接口（无变更，供参考）

- `Price` 接口：`attachmentUrl?: string` 字段已在前序迭代中存在，本次无修改。
- `CreatePricePayload` 接口：`attachmentUrl?: string` 字段已存在，本次无修改。
- `useCreatePrice`、`useUpdatePrice`、`usePriceHistory`、`usePriceList` hooks：无变更。

---

## 4. `services/web/src/api/supplier.ts`

### 4.1 新增：详情相关类型定义

- **新增** `SupplierRelatedSku` 接口：`{ id, skuCode, name, spec?, currentPrice, priceUnit, isMainSupplier }`，对应 `GET /api/suppliers/:id/skus` 返回结构。
- **新增** `SupplierPriceAgreement` 接口：`{ id, skuId, skuName, unitPrice, purchaseUnit, moq?, validFrom, validTo, isCurrent, status }`，对应 `GET /api/suppliers/:id/price-agreements` 返回结构。
- **新增** `SupplierDeliveryRecord` 接口：`{ orderId, skuName, scheduledDate, actualDate, remark }`，作为 `SupplierPerformance.recentDeliveries` 子类型。
- **新增** `SupplierPerformance` 接口：`{ onTimeRate, qualityRate, avgLeadDays, totalOrders, recentDeliveries }`，对应 `GET /api/suppliers/:id/performance` 返回结构。

### 4.2 新增：Query Keys

- **新增** `supplierKeys.skus(id)`、`supplierKeys.priceAgreements(id)`、`supplierKeys.performance(id)` 三个 query key 生成器，格式统一为 `['suppliers', '<type>', id]`。

### 4.3 新增：API 调用函数

- **新增** `supplierApi.getRelatedSkus(id)`：`GET /api/suppliers/:id/skus`。
- **新增** `supplierApi.getPriceAgreements(id)`：`GET /api/suppliers/:id/price-agreements`。
- **新增** `supplierApi.getPerformance(id)`：`GET /api/suppliers/:id/performance`。

### 4.4 新增：React Query Hooks

- **新增** `useSupplierSkus(id: number | null)`：`enabled: id !== null`，`staleTime: 2min`。
- **新增** `useSupplierPriceAgreements(id: number | null)`：`enabled: id !== null`，`staleTime: 2min`。
- **新增** `useSupplierPerformance(id: number | null)`：`enabled: id !== null`，`staleTime: 2min`。

---

## 5. `services/web/nginx.conf`

### 5.1 新增：`/uploads/` 反向代理规则

- **新增** `location ^~ /uploads/` 块，将所有 `/uploads/` 路径请求反向代理至 `http://api:3000`，用于展示服务端存储的协议附件文件（图片/PDF）。
- 使用 `^~` 前缀修饰符保证优先级高于正则 `location ~* \.(js|css|...)$`，防止被静态资源缓存规则拦截。
- 配置 `expires 7d` + `Cache-Control: public`，对附件文件启用 CDN 缓存。
- 标准 proxy header 透传：`Host`、`X-Real-IP`、`X-Forwarded-For`、`X-Forwarded-Proto`。

### 5.2 新增：上传文件大小限制

- **新增** 顶层 `client_max_body_size 12m`（原缺省值 Nginx 默认 1m），支持前端最大 10MB 文件上传要求，12m 预留 Base64 编码开销余量。

---

## 变更影响范围

| 影响维度 | 描述 |
|---|---|
| 新页面/视图 | SupplierDetailView（供应商详情视图，含 4 个 Tab） |
| 新组件 | MaterialGroupAccordion、AdjustRatingModal、SupplierInfoTab、SupplierSkuTab、SupplierPriceAgreementsTab、SupplierPerformanceTab |
| 新 API 调用 | uploadPriceFile、getRelatedSkus、getPriceAgreements、getPerformance |
| 新类型 | SupplierRelatedSku、SupplierPriceAgreement、SupplierDeliveryRecord、SupplierPerformance、MaterialGroup |
| Bug 修复 | 5 项（doSave 字段缺漏、openEdit 回填、图片/PDF 预览分支、emoji 转义、moq undefined） |
| 基础设施 | nginx.conf 新增 /uploads/ 代理和 12m body size |

---

## 技术债与后续建议

1. `SupplierDetailView` 中的绩效图表（准时率、质量率）目前为纯文本展示，可后续替换为 SVG 微型柱状图，与 `PriceTrendSvg` 风格保持一致。
2. `SupplierSkuTab` 内 `useSkuList` 搜索每次键入均发起请求，建议后续评估是否在后端支持按 `supplierId` 过滤，减少前端过滤计算。
3. `uploadPriceFile` 缺少错误提示回调，目前 catch 静默清空，建议在 `DrawerFormFields` 调用层加 Toast 通知。
