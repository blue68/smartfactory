# 智造管家 — 前端 SDD 分析文档

> 文档类型：System Design Document（前端视角）
> 分析日期：2026-03-11
> 分析范围：16 个 UI 设计稿 + 现有前端实现全量对比
> 分析人：@senior-frontend-engineer

---

## 目录

1. [分析方法与约定](#1-分析方法与约定)
2. [全局设计系统对比](#2-全局设计系统对比)
3. [逐页分析](#3-逐页分析)
   - [P01 老板驾驶舱 (web-dashboard)](#p01-老板驾驶舱)
   - [P02 库存总览 (web-inventory)](#p02-库存总览)
   - [P03 SKU 主数据 (web-sku-master)](#p03-sku-主数据)
   - [P04 BOM 管理 (web-bom-manage)](#p04-bom-管理)
   - [P05 AI 采购建议 (web-purchase-suggestion)](#p05-ai-采购建议)
   - [P06 采购三单匹配 (web-purchase-match)](#p06-采购三单匹配)
   - [P07 销售订单 (web-sales-order)](#p07-销售订单)
   - [P08 排产计划 (web-production-schedule)](#p08-排产计划)
   - [P09 质量溯源 (web-quality-trace)](#p09-质量溯源)
   - [P10 AI 对话中心 (web-ai-chat)](#p10-ai-对话中心)
   - [P11 供应商管理 (web-supplier-manage)](#p11-供应商管理)
   - [P12 采购价格管理 (web-price-manage)](#p12-采购价格管理)
   - [P13 工序配置 (web-process-config)](#p13-工序配置)
   - [M01 小程序—仓库入库 (mini-warehouse-inbound)](#m01-小程序仓库入库)
   - [M02 小程序—工人任务 (mini-worker-task)](#m02-小程序工人任务)
   - [M03 小程序—QC 检验 (mini-qc-inspect)](#m03-小程序qc-检验)
4. [通用组件缺口分析](#4-通用组件缺口分析)
5. [需要新建 / 修改 / 重写的组件清单](#5-需要新建--修改--重写的组件清单)
6. [前端开发任务拆解（P0 / P1 / P2）](#6-前端开发任务拆解)
7. [技术债务与风险](#7-技术债务与风险)

---

## 1. 分析方法与约定

### 差距等级定义

| 等级 | 含义 |
|------|------|
| **GAP-L1** | 视觉层差距：颜色/间距/字号与设计稿不符，不影响功能 |
| **GAP-L2** | 组件层差距：组件存在但结构/交互与设计稿不一致 |
| **GAP-L3** | 功能层差距：设计稿中有该功能，当前实现完全缺失 |
| **GAP-L4** | 数据层差距：API 字段映射错误或缺少必要的数据字段 |

### 现有实现状态约定

- `EXISTS` — 已存在实现
- `STUB` — 占位代码，无完整逻辑
- `MISSING` — 完全缺失

---

## 2. 全局设计系统对比

### 2.1 Design Tokens 对比

**设计稿定义的完整 Token 体系（来自 `web-dashboard.html`）：**

```
颜色：primary / accent / success / warning / error / info / stagnant / gray (12级)
间距：space-1 (0.25rem) 到 space-8 (2rem)
圆角：radius-sm(4px) / md(8px) / lg(12px) / xl(16px) / full(9999px)
阴影：shadow-xs / sm / md / lg
字体：--font-family-base / --font-family-number (DIN Alternate/Roboto Mono)
布局：sidebar-width(240px) / header-height(64px) / page-padding(24px) / card-gap(16px)
过渡：transition-fast(150ms) / base(200ms) / slow(300ms)
```

**现有 `variables.css` 的缺口：**

- `--color-stagnant-*` 系列 Token 缺失（库存呆滞状态紫色）
- `--font-family-number` 未定义（数字专用字体）
- `--color-info-*` 系列部分缺失（info-100 缺失）
- `--shadow-xs` 未定义
- `--transition-slow` 未定义
- 设计稿中 SKU 分类的 16 种二级色标（`--tag-sub-board` 等）全部缺失

### 2.2 Sidebar 导航结构差异

**设计稿定义的分组结构：**
- 总览：驾驶舱
- 生产管理：订单管理、排产计划、生产进度
- 物料采购：库存总览、AI采购建议、三单匹配、采购价格
- 数据管理：SKU主数据、BOM管理、工序配置、供应商管理
- 质量管理：质量溯源
- AI助手：AI对话中心

**现有 `Sidebar.tsx` 的缺口（GAP-L2）：**
- 分组标签（section-label）样式与设计稿不符：设计稿用 `sidebar__section-label`（字号 0.625rem，letter-spacing 0.1em），现有实现的分组标签类名和样式不一致
- 侧边栏 active 状态：设计稿用 `border-left: 3px solid var(--color-primary-500)`，现有实现用 `bg-sidebar-active` 背景色，两者并存但视觉权重不一致
- 折叠状态（宽度 60px）时图标显示逻辑：设计稿有明确的响应式折叠规则，现有实现缺少折叠动画过渡

### 2.3 AI 悬浮按钮

设计稿所有 Web 页面均包含右下角 AI 悬浮按钮（`position: fixed; bottom: 32px; right: 32px`，橙色渐变，56px 圆形）。

现有实现：`AppLayout.tsx` 中尚未挂载全局 AI 悬浮按钮（GAP-L3）。

---

## 3. 逐页分析

---

### P01 老板驾驶舱

**设计稿文件：** `docs/ui/web-dashboard.html`
**现有实现：** `services/web/src/pages/dashboard/DashboardPage.tsx`

#### 3.1.1 组件树（设计稿定义）

```
DashboardPage
├── PageHeader
│   ├── 标题"今日概览"
│   ├── 副标题（日期）
│   └── 数据同步状态（脉冲圆点 + 时间）
├── KpiGrid (4列)
│   ├── KpiCard — 在产订单（12单，△ +2）
│   ├── KpiCard — 本月完工产值（¥86,400，进度条 72%）
│   ├── KpiCard — 当前库存金额（¥142,000，警告色）
│   └── KpiCard — 待审批事项（3项，错误色）
├── ContentGrid (2列)
│   ├── ProductionProgressSection
│   │   └── ProgressList
│   │       ├── ProgressItem × 3（订单号、SKU名、进度条、状态标签、预计完工日期）
│   │       └── "查看全部" 链接
│   └── InventoryWarningSection
│       └── WarningList
│           ├── WarningItem（红点 — 严重预警）× 2
│           └── WarningItem（黄点 — 临近预警）× 1
└── AiSuggestionSection
    ├── AlertBanner（AI 分析状态提示，橙色左边框）
    └── AiSuggestionList
        ├── AiSuggestionCard × 2
        │   ├── 标题 + 标签（紧急/置信度）
        │   ├── InfoGrid 3列（建议数量/推荐供应商/预估金额）
        │   ├── ReasonAccordion（<details> 折叠 AI 推理）
        │   └── Actions（采购员反馈 / 批准 / 驳回）
        └── AI 浮动按钮（fixed 右下角）
```

#### 3.1.2 状态设计

| 状态名 | 来源 | 类型 |
|--------|------|------|
| `inProductionCount` | `GET /production/orders?status=IN_PROGRESS` | 页面级 |
| `completedValue` | `GET /dashboard/kpi` | 页面级 |
| `inventoryValue` | `GET /dashboard/kpi` | 页面级 |
| `pendingApprovalCount` | `GET /purchase/suggestions?status=PENDING` | 页面级 |
| `productionProgressList` | `GET /production/orders` | 页面级 |
| `inventoryWarnings` | `GET /inventory?belowSafety=true` | 页面级 |
| `pendingSuggestions` | `GET /purchase/suggestions?status=PENDING` | 页面级 |
| `loading.*` | 各请求状态 | 页面级 |

#### 3.1.3 API 依赖清单

| 接口 | 用途 | 优先级 |
|------|------|--------|
| `GET /api/dashboard/kpi` | 本月产值、库存金额、产能负荷 | P0 |
| `GET /api/production/orders?status=IN_PROGRESS&pageSize=5` | 在产订单进度列表 | P0 |
| `GET /api/inventory?belowSafety=true&pageSize=3` | 库存预警（今日） | P0 |
| `GET /api/purchase/suggestions?status=PENDING&pageSize=5` | 待审批采购建议 | P0 |
| `POST /api/purchase/suggestions/{id}/approve` | 驾驶舱快速批准 | P0 |

#### 3.1.4 差距清单

| 编号 | 级别 | 设计稿要求 | 现有实现状态 | 说明 |
|------|------|------------|--------------|------|
| D-01 | GAP-L3 | KPI 卡片展示"本月完工产值"（¥金额 + 进度条 72%） | `MISSING` | 现有 KpiCard 无 progressBar 子组件；`DashboardKpi` 类型缺 `completedValue` 字段 |
| D-02 | GAP-L3 | KPI 卡片展示"当前库存金额"（¥142,000） | `MISSING` | 现有实现用"库存预警 SKU 数"替代，语义不同 |
| D-03 | GAP-L2 | KPI 卡片有左侧彩色竖线（warning/error/success 三种） | `STUB` | `card--kpi--warning/error` CSS 类名未在 DashboardPage 中应用 |
| D-04 | GAP-L2 | KPI 卡片右上角有图标区域（40×40，带色背景） | `EXISTS` 但尺寸不符 | 现有图标无背景色块，仅 emoji |
| D-05 | GAP-L3 | 生产进度列表每项含"预计完工日期"字段 | `STUB` | `ProductionOrder.plannedEnd` 存在但未在驾驶舱进度列表中渲染 |
| D-06 | GAP-L3 | 库存预警条目含"缺口量"强调显示（`<strong>` 红色） | `MISSING` | 现有仅展示 skuName + 数量，缺差值计算展示 |
| D-07 | GAP-L3 | 待审批区展示 AI 状态 Banner（上次分析时间） | `MISSING` | 无 AI 分析状态展示组件 |
| D-08 | GAP-L3 | 采购建议卡片内联"批准/驳回"操作 | `MISSING` | 驾驶舱无快速审批逻辑，需跳转 SuggestionPage |
| D-09 | GAP-L3 | 采购建议支持折叠式 AI 推理（Accordion） | `MISSING` | 仅文字 reason，无折叠交互 |
| D-10 | GAP-L3 | 页面右上角显示"数据已同步"脉冲圆点 + 时间 | `MISSING` | 页头无同步状态组件 |
| D-11 | GAP-L2 | 产能负荷趋势图（设计稿未含，已在实现中） | `EXISTS` | 实现超出设计稿，可保留 |
| D-12 | GAP-L1 | 内容区两列网格 `grid-template-columns: 1fr 1fr` | `EXISTS` 但比例不同 | 现有 `middle_row / bottom_row` 布局与设计稿列布局逻辑不同 |

---

### P02 库存总览

**设计稿文件：** `docs/ui/web-inventory.html`
**现有实现：** `services/web/src/pages/inventory/InventoryPage.tsx`

#### 3.2.1 组件树（设计稿定义）

```
InventoryPage
├── PageHeader（标题 + 导出Excel按钮 + 手动入库按钮）
├── SummaryBar（原材料/半成品/成品金额占比 + 实时更新时间）
├── FilterBar
│   ├── SearchInput（物料名称/编码）
│   ├── CategorySelect（分类下拉）
│   ├── StatusSelect（库存状态下拉：低于安全/临近/正常/呆滞）
│   └── UnitToggle（按库存单位/按采购单位）
├── InventoryTable
│   ├── TableHead（展开列/状态/物料名称/分类/库存量/安全库存/库存天数/缸号批次/操作）
│   ├── TableBody
│   │   ├── NormalRow（普通物料行）
│   │   ├── ExpandableRow（含缸号物料行，可展开）
│   │   └── DyeLotPanel（缸号批次展开面板）
│   │       └── DyeLotTable（缸号/入库日期/剩余库存/状态/操作）
│   └── TableLegend（图例说明）
└── Pagination
```

#### 3.2.2 状态设计

| 状态名 | 类型 | 说明 |
|--------|------|------|
| `query` | `InventoryListQuery` | 筛选参数（分类/状态/关键字/页码） |
| `unitMode` | `'stock' \| 'purchase'` | 单位切换模式 |
| `expandedRows` | `Set<number>` | 已展开缸号的行 skuId 集合 |
| `dyeLotCache` | `Map<number, DyeLot[]>` | 缸号数据懒加载缓存 |
| `summaryData` | `InventorySummary` | 顶部汇总栏数据 |

#### 3.2.3 API 依赖清单

| 接口 | 用途 |
|------|------|
| `GET /api/inventory` | 库存列表（带分页/筛选） |
| `GET /api/inventory/summary` | 汇总栏（各类型金额占比）|
| `GET /api/inventory/{skuId}/dye-lots` | 懒加载缸号明细 |
| `POST /api/inventory/inbound` | 手动入库 |
| `GET /api/sku/categories` | 分类选项 |

#### 3.2.4 差距清单

| 编号 | 级别 | 设计稿要求 | 现有状态 |
|------|------|------------|----------|
| I-01 | GAP-L3 | SummaryBar：原材料¥89,400(56%) / 半成品¥48,200(30%) / 成品¥22,100(14%) | `MISSING` | 现有顶部仅有简单文字摘要，无金额分类占比 |
| I-02 | GAP-L3 | 库存天数列（stock_days，含颜色状态：danger/warning/normal/stagnant） | `MISSING` | 现有 InventoryItem 类型无 `stockDays` 字段 |
| I-03 | GAP-L3 | 状态使用彩色圆点（status-dot 红/黄/绿/紫），包含"呆滞风险"紫色状态 | `MISSING` | 现有仅有 `isBelowSafety` 布尔值，无4态区分 |
| I-04 | GAP-L3 | UnitToggle 切换：按库存单位 / 按采购单位，影响数量显示 | `MISSING` | 现有无单位切换逻辑 |
| I-05 | GAP-L2 | 缸号展开面板含"操作"列（"查看用途"按钮） | `STUB` | DyeLotExpand 现有表头无操作列，缺"查看用途"功能 |
| I-06 | GAP-L2 | 缸号展开行背景为 `--color-accent-50` 橙色系 | `MISSING` | 现有展开行无特殊背景色 |
| I-07 | GAP-L4 | `InventoryItem` 需增加字段：`stockDays`, `inventoryStatus`（4态枚举），`categoryName`, `stockValueAmount` | `MISSING` | 类型定义不完整 |
| I-08 | GAP-L3 | 呆滞风险物料行有"AI降库建议"按钮（紫色ghost样式） | `MISSING` | 无呆滞标识与对应操作 |
| I-09 | GAP-L3 | 表格底部图例（Legend 组件） | `MISSING` | 无图例组件 |
| I-10 | GAP-L1 | 分类列使用 `tag--neutral` 标签展示，非文字 | `EXISTS` 但 Tag variant 映射不完整 | |
| I-11 | GAP-L1 | 表格 hover 行背景 `--color-primary-50` | `EXISTS` | 已在 Table.module.css 中定义 |
| I-12 | GAP-L3 | 导出 Excel 按钮 | `MISSING` | 现有无导出功能 |

---

### P03 SKU 主数据

**设计稿文件：** `docs/ui/web-sku-master.html`
**现有实现：** `services/web/src/pages/master-data/SkuPage.tsx`

#### 3.3.1 组件树（设计稿定义）

```
SkuPage
├── Breadcrumb（数据管理 / SKU主数据）
├── Toolbar
│   ├── SearchBox（280px，物料名/编码搜索）
│   ├── FilterSelect（一级分类：原材料/半成品/成品）
│   ├── FilterSelect（二级品类，级联）
│   ├── FilterSelect（状态：全部/启用/停用/待审）
│   └── Actions（批量补录按钮 + 新建SKU按钮）
├── SummaryStrip
│   ├── SummaryItem（原材料总数，蓝色数字）
│   ├── SummaryItem（半成品总数，橙色数字）
│   ├── SummaryItem（成品总数，绿色数字）
│   └── AlertItems（低于安全库存N项 + 缺少BOM N项）
├── BackfillBanner（批量补录提示，警告色）
├── DataTable
│   ├── 复选框列
│   ├── SKU编码（彩色标签：RM蓝/WIP橙/FG绿）
│   ├── 物料名称（含规格、分类标签）
│   ├── 一级分类标签
│   ├── 二级品类标签（16种颜色体系）
│   ├── 库存单位
│   ├── 采购单位
│   ├── 当前库存（联查）
│   ├── 安全库存
│   ├── 状态标签
│   └── 操作（编辑/删除）
├── BatchActionBar（选中后出现：批量停用/导出）
├── TableFooter（分页）
└── RightDrawer（新建/编辑SKU）
    ├── DrawerHeader
    ├── DrawerBody
    │   ├── FormSection（基本信息）
    │   ├── FormSection（单位配置：多单位换算Table）
    │   └── FormSection（库存配置：安全库存/FIFO/缸号管控）
    └── DrawerFooter（取消/保存）
```

#### 3.3.2 差距清单

| 编号 | 级别 | 设计稿要求 | 现有状态 |
|------|------|------------|----------|
| S-01 | GAP-L3 | SummaryStrip（原材料N/半成品N/成品N + 预警角标） | `MISSING` | 现有无汇总栏 |
| S-02 | GAP-L3 | BackfillBanner（"有N个SKU缺少BOM，点击批量补录"） | `MISSING` | 无 BOM 完整度提示 |
| S-03 | GAP-L3 | SKU 编码彩色标签（RM蓝/WIP橙/FG绿，`sku-code--rm/wip/fg`） | `MISSING` | 现有 skuCode 仅用 monospace 字体显示 |
| S-04 | GAP-L3 | 二级品类标签 16 种颜色体系（board/hardware/fabric等） | `MISSING` | 现有 Tag 组件无 sub-category 系列 variant |
| S-05 | GAP-L2 | 批量选择（全选复选框 + 行复选框），批量操作栏 | `STUB` | Table 组件有 selection 接口但 SkuPage 未使用 |
| S-06 | GAP-L2 | 右侧抽屉（480px）展示完整 SKU 表单 | `EXISTS` 但用 Modal，非 Drawer | 设计稿明确用 Drawer，现有用 Modal，交互体验差异显著 |
| S-07 | GAP-L2 | 单位换算配置（多行 Table，可增删换算关系） | `STUB` | `useUpdateUnitConversions` 存在，但 SkuPage 中 Form 的换算区仅有静态输入，无动态行管理 |
| S-08 | GAP-L3 | 面包屑导航（数据管理 / SKU主数据） | `MISSING` | Header 组件未渲染面包屑 |
| S-09 | GAP-L4 | `Sku` 类型缺少 `skuName`（现有用 `name`），设计稿字段 `skuName` | `MISSING` | 类型命名不一致，需对齐 |
| S-10 | GAP-L1 | 表格行 hover 背景 `--color-gray-50` | `EXISTS` | Table 组件已实现 |

---

### P04 BOM 管理

**设计稿文件：** `docs/ui/web-bom-manage.html`
**现有实现：** `services/web/src/pages/master-data/BomPage.tsx`

#### 3.4.1 组件树（设计稿定义）

```
BomPage
├── PageView: 列表视图（默认）
│   ├── Toolbar（搜索 + 状态筛选 + 新建BOM按钮）
│   ├── SummaryStrip（完整BOM N / 待补录 N / 无BOM N + 预警Banner）
│   ├── DataTable
│   │   ├── 成品名称（SKU编码绿色标签 + 名称）
│   │   ├── BOM版本
│   │   ├── 物料完整度（BomProgressBar：进度条 + 百分比，4种色彩状态）
│   │   ├── 物料行数
│   │   ├── 更新时间
│   │   ├── 状态标签
│   │   └── 操作（查看/编辑/激活/删除）
│   └── TableFooter（分页）
└── PageView: BOM编辑视图
    └── BomEditor（双栏布局）
        ├── BomTreePanel（左栏 50%）
        │   ├── PanelHeader（BOM标题 + 版本 + 状态）
        │   ├── TreeBody（可滚动）
        │   │   └── TreeNode（递归树，可展开/收起）
        │   │       ├── TreeNode__toggle（▶ 箭头，旋转展开）
        │   │       ├── TreeNode__icon（📦🔧等）
        │   │       ├── TreeNode__label
        │   │       └── TreeNode__qty
        │   └── BomTreeActions（+ 添加物料 / + 添加子级）
        └── BomDetailPanel（右栏 50%）
            ├── PanelHeader（选中节点名称）
            ├── DetailBody
            │   ├── DetailRows（属性键值对）
            │   ├── AiSuggestionPanel（AI匹配建议）
            │   │   ├── ConfidenceBadge
            │   │   ├── AiBomTable（AI建议物料清单）
            │   │   └── ActionButtons（应用建议/忽略）
            │   └── AddMaterialPanel（添加物料表单）
            └── DetailActions（保存/取消）
```

#### 3.4.2 差距清单

| 编号 | 级别 | 设计稿要求 | 现有状态 |
|------|------|------------|----------|
| B-01 | GAP-L3 | BomProgressBar（物料完整度进度条，4色状态：100%绿/高绿/中橙/低红/0灰） | `MISSING` | 现有列表无完整度指标 |
| B-02 | GAP-L3 | SummaryStrip（完整BOM N / 待补录 N / 无BOM N） | `MISSING` | 无汇总栏 |
| B-03 | GAP-L3 | BOM编辑器视图（双栏：树形面板 + 详情面板） | `MISSING` | 现有仅有列表视图，编辑通过 Modal，无树形结构 |
| B-04 | GAP-L3 | TreeNode 递归渲染（支持多层级BOM展开/收起，缩进连线） | `MISSING` | 现有 `BomItem` 类型有 `children` 字段但无树形UI |
| B-05 | GAP-L3 | AI BOM 匹配建议面板（`ai-panel`，含匹配度 Badge + 建议物料清单表格） | `MISSING` | 无AI建议功能 |
| B-06 | GAP-L3 | 页面视图切换（列表视图 ↔ 编辑视图，CSS `page-view--active`） | `MISSING` | 无双视图模式 |
| B-07 | GAP-L2 | 激活 BOM 版本（列表行操作） | `EXISTS` | `useActivateBom` 存在，列表操作列已有，但确认弹窗缺少影响范围说明 |
| B-08 | GAP-L4 | `BomHeader` 需增加 `completionRate`（完整度百分比）字段 | `MISSING` | API 层缺少该字段 |

---

### P05 AI 采购建议

**设计稿文件：** `docs/ui/web-purchase-suggestion.html`
**现有实现：** `services/web/src/pages/purchase/SuggestionPage.tsx`

#### 3.5.1 组件树（设计稿定义）

```
SuggestionPage
├── PageHeader（AI采购建议 + 生成建议按钮）
├── AiStatusPanel（AI图标 + 上次分析时间 + 覆盖订单数）
├── FilterTabs（全部/待审批/已批准/已驳回/已转单）
├── SuggestionList
│   └── SuggestionCard × N
│       ├── CardHeader
│       │   ├── SkuName（大字 + 规格）
│       │   └── Tags（紧急/置信度/缸号标签）
│       ├── InfoGrid（4列：建议数量/缺口量/推荐供应商/预估金额）
│       ├── DyeLotNotice（可选，缸号要求橙色框）
│       ├── ReasonAccordion（AI推理依据折叠展开，动画）
│       └── CardActions（底部：状态标签 + 采购员反馈 + 批准 + 驳回）
├── AiThinkingModal（生成中遮罩，含步骤状态）
└── Pagination
```

#### 3.5.2 差距清单

| 编号 | 级别 | 设计稿要求 | 现有状态 |
|------|------|------------|----------|
| PS-01 | GAP-L3 | AiStatusPanel（上次AI分析时间 + 覆盖订单数 + AI图标） | `MISSING` | 无此组件，现有页头无AI状态信息 |
| PS-02 | GAP-L2 | InfoGrid 为 4 列（建议数量/缺口量/推荐供应商/预估金额） | `STUB` | 现有 `card_amounts` 只有3项（建议数量/预估金额/供应商），缺"缺口量" |
| PS-03 | GAP-L2 | ReasonAccordion：有动画（fadeIn + arrow旋转），trigger背景交互 | `EXISTS` 但简陋 | 现有用简单 `button + state` 展开，无样式动画 |
| PS-04 | GAP-L3 | FilterTabs 含"已转单"状态 | `MISSING` | 现有 SuggestionStatus 枚举无 CONVERTED 状态 |
| PS-05 | GAP-L2 | 建议卡片 hover 效果（`translateY(-1px)` + shadow-md） | `MISSING` | 现有卡片无 hover 动效 |
| PS-06 | GAP-L1 | 卡片左侧 4px 橙色竖线（`border-left: 4px solid --color-accent-500`） | `MISSING` | 现有卡片无左侧强调色条 |
| PS-07 | GAP-L3 | "采购员反馈"按钮（ghost，可录入反馈意见） | `MISSING` | 仅有批准/驳回，无反馈功能 |
| PS-08 | GAP-L3 | AiThinkingModal（生成建议时的遮罩弹窗，含3步骤状态显示） | `MISSING` | 仅用 loading 按钮状态，无专用弹窗 |
| PS-09 | GAP-L4 | `PurchaseSuggestion` 需增加 `shortageQty`（已有）、`lastAnalysisTime`（缺失） | `MISSING` | |

---

### P06 采购三单匹配

**设计稿文件：** `docs/ui/web-purchase-match.html`
**现有实现：** `services/web/src/pages/purchase/MatchPage.tsx`

#### 3.6.1 组件树（设计稿定义）

```
MatchPage
├── PageHeader（三单匹配 + 执行匹配按钮）
├── StatusSummaryBar（已匹配N/数量差异N/价格差异N/价格预警N）
├── FilterTabs
├── MatchTable
│   ├── 采购单号
│   ├── 送货单号
│   ├── 收货单号
│   ├── 匹配状态标签（5种）
│   ├── 差异详情（可展开，DiffTable）
│   │   ├── SKU名称
│   │   ├── 采购数量/送货数量/收货数量
│   │   ├── 采购单价/送货单价
│   │   ├── 差异量（高亮）
│   │   └── 价格异常标志（🔴）
│   ├── 匹配时间
│   └── 操作（确认差异/查看详情）
├── ConfirmDiffModal（差异确认弹窗）
│   ├── 差异原因Select（枚举）
│   └── 备注Textarea
└── ExecuteMatchModal（执行匹配弹窗）
    └── 三单编号输入（PO/DN/RN）
```

#### 3.6.2 差距清单

| 编号 | 级别 | 设计稿要求 | 现有状态 |
|------|------|------------|----------|
| M-01 | GAP-L3 | StatusSummaryBar（各状态计数汇总） | `MISSING` | 现有无汇总栏 |
| M-02 | GAP-L2 | 差异详情展开行（DiffTable，含差异量红色高亮 + 价格异常标志） | `EXISTS` 但不完整 | 现有 MatchPage 有 diffItems 渲染，但无展开行交互（全量展示），差异高亮逻辑缺失 |
| M-03 | GAP-L2 | 价格异常时单价单元格背景红色 + 🔴 标志 | `MISSING` | `isPriceAnomaly` 字段存在但无视觉高亮 |
| M-04 | GAP-L1 | 匹配状态5种 Tag 颜色（matched绿/qty_diff橙/price_diff橙/price_warning红/confirmed蓝） | `EXISTS` 但 variant 映射部分错误 | `MATCH_STATUS_VARIANT` 中 `PRICE_WARNING` 用了 `error` 而非设计稿的"红色边框特殊样式" |
| M-05 | GAP-L3 | 设计稿有"历史均价"对比列（`historicalAvgPrice`） | `EXISTS` 字段 | 字段存在但未在表格中渲染 |

---

### P07 销售订单

**设计稿文件：** `docs/ui/web-sales-order.html`
**现有实现：** `services/web/src/pages/sales/OrderPage.tsx`

#### 3.7.1 组件树（设计稿定义）

```
SalesOrderPage
├── PageHeader（新建销售订单 — 表单模式）
│   （同时含订单列表模式切换）
├── 视图一：新建订单表单
│   ├── OrderBasicForm（客户名/交期/订单类型/备注）
│   ├── OrderItemsSection
│   │   ├── 产品行 × N（SKU选择/BOM选择/数量/单价/小计）
│   │   └── 添加产品行按钮
│   ├── ConstraintResultPanel（约束引擎实时校验结果）
│   │   ├── OverallResult（通过/警告/拦截）
│   │   └── CheckItems（库存周转天数/资金占用/成本/产能 × 4）
│   ├── UrgentAnalysisPanel（紧急分析，可选触发）
│   │   └── AiThinkingState（分析中）
│   └── FormActions（提交/取消）
└── 视图二：订单列表
    ├── FilterBar（状态/日期/关键字）
    ├── OrderTable
    │   ├── 订单号
    │   ├── 客户名
    │   ├── 类型标签（普通/插单/急单）
    │   ├── 约束结果标签（通过/警告/拦截）
    │   ├── 状态标签
    │   ├── 金额
    │   ├── 交期
    │   └── 操作（详情/审批/紧急分析）
    └── DetailDrawer（订单详情右侧抽屉）
```

#### 3.7.2 差距清单

| 编号 | 级别 | 设计稿要求 | 现有状态 |
|------|------|------------|----------|
| SO-01 | GAP-L2 | 产品行动态增删（可添加多行产品） | `EXISTS` 但形态为表格 | 设计稿产品行更像卡片式布局，带分割线 |
| SO-02 | GAP-L2 | 约束引擎结果 Panel 在新建表单内实时联动显示（非弹窗） | `STUB` | 现有 `ConstraintResultDisplay` 是独立组件，但在 OrderPage 中的集成位置是表格行内，非表单内 |
| SO-03 | GAP-L3 | 新建订单表单：SKU 搜索下拉（含库存信息预览） | `MISSING` | 现有 CreateSalesOrderPayload 需要 skuId，但无 SKU 搜索 UI |
| SO-04 | GAP-L3 | 新建订单：BOM 版本选择（每个产品行独立选择） | `MISSING` | 无 BOM 选择器组件 |
| SO-05 | GAP-L3 | 紧急插单分析 Panel（完整展示4项检查 + 影响范围分析） | `EXISTS` | `UrgentAnalysisReport` 组件已实现但样式与设计稿差异较大 |
| SO-06 | GAP-L2 | 订单类型标签（普通蓝/插单橙/急单红） | `STUB` | `OrderType` 枚举存在但 Tag variant 映射缺失 |

---

### P08 排产计划

**设计稿文件：** `docs/ui/web-production-schedule.html`
**现有实现：** `services/web/src/pages/production/SchedulePage.tsx`

#### 3.8.1 组件树（设计稿定义）

```
SchedulePage
├── PageHeader（每日排产计划 + 日期 + 查看历史按钮）
├── StatusBar（AI已生成计划状态 + 覆盖订单/工作站/工人数 + 未下发标签）
├── AiRiskAlert（AI风险提示，橙色左边框，含"查看详细分析"按钮）
├── ViewToggle（工作站视图/订单视图/人员视图，radio选择）
├── GanttChart
│   ├── GanttHint（拖拽提示条）
│   ├── GanttTable
│   │   ├── ColHeaders（时间轴 08:00-10:00等）
│   │   └── StationRows × N
│   │       ├── StationLabel（工作站名 + 负责人）
│   │       ├── TimeSlotCells × 4
│   │       │   └── TaskBlock（可拖拽，3态：normal/warning/danger）
│   │       │       ├── 订单号
│   │       │       ├── 工序名称
│   │       │       ├── 工人 + 数量
│   │       │       └── 备料状态图标
│   │       └── MaterialStatusCell（备料状态列）
│   └── GanttLegend（图例）
├── WorkerTaskCards（人员视图）
│   └── WorkerCard × N
│       ├── Avatar + 姓名 + 工作站 + 任务数
│       └── TaskList（时间/优先级/任务描述）
└── StickyActionBar（底部固定）
    ├── 操作提示文字
    └── Buttons（取消调整 / 确认并下发）
```

#### 3.8.2 差距清单

| 编号 | 级别 | 设计稿要求 | 现有状态 |
|------|------|------------|----------|
| SC-01 | GAP-L3 | GanttChart（甘特图：工作站行 × 时间槽列，TaskBlock 可拖拽） | `MISSING` | 现有 SchedulePage 仅有工单列表+Modal，完全缺失甘特图UI |
| SC-02 | GAP-L3 | TaskBlock 可拖拽交互（`draggable="true"`，drag跨工作站调整） | `MISSING` | |
| SC-03 | GAP-L3 | ViewToggle 三视图（工作站/订单/人员） | `MISSING` | 无视图切换 |
| SC-04 | GAP-L3 | StatusBar（AI已生成状态 + 覆盖统计 + 下发状态标签） | `MISSING` | 无计划状态展示 |
| SC-05 | GAP-L3 | AiRiskAlert（AI风险提示，具体到工序级别建议） | `MISSING` | 有 `AiThinkingState` 组件但无风险告警展示 |
| SC-06 | GAP-L3 | WorkerTaskCards（工人任务卡片网格布局） | `MISSING` | `useWorkerTasks` 已有，但无卡片UI |
| SC-07 | GAP-L3 | StickyActionBar（底部固定，确认并下发给工人） | `MISSING` | |
| SC-08 | GAP-L3 | GanttLegend（图例：正常/有风险/延误风险 + 备料状态说明） | `MISSING` | |
| SC-09 | GAP-L4 | `ScheduleItem` 需增加字段：`timeSlot`（时段），`materialStatus`（备料状态：ready/pending/missing） | `MISSING` | |
| SC-10 | GAP-L2 | 备料状态显示（每行右侧，含3态：料已备好/封边条待入库/缺料） | `MISSING` | |

**备注：** SchedulePage 是差距最大的页面，基本需要重写 UI 层，以甘特图视图为核心。

---

### P09 质量溯源

**设计稿文件：** `docs/ui/web-quality-trace.html`
**现有实现：** `services/web/src/pages/quality/TracePage.tsx`

#### 3.9.1 组件树（设计稿定义）

```
TracePage
├── PageHeader（质量溯源 + 新建质检 + 导出报告按钮）
├── StatsRow（4列KPI卡片）
│   ├── StatCard — 本月质检总数
│   ├── StatCard — 合格率（大字）
│   ├── StatCard — 本月不合格数
│   └── StatCard — 严重问题数
├── ContentGrid（2列）
│   ├── IssueListCard（左）
│   │   ├── IssueList
│   │   └── IssueItem（左侧彩色竖线：severe红/moderate橙/minor绿）
│   │       ├── IssueHeader（问题类型Tags + 严重等级Tag）
│   │       ├── IssueDesc（描述文字）
│   │       └── IssueMeta（工单号/检验时间/工人）
│   └── IssueBarChart（右，问题类型分布纯CSS条形图）
├── TraceSection（溯源链查询区）
│   ├── SearchBar（缸号/SKU/订单号，3种查询类型）
│   ├── TraceChain（水平滚动溯源链）
│   │   └── TraceFlow
│   │       ├── TraceStep × N（含TraceArrow连接）
│   │       └── TraceNode
│   │           ├── NodeIcon（5种类型图标：product/part/material/process/worker）
│   │           └── NodeCard（标题/详情/缸号Tag）
│   └── MissingDataNote（数据缺失提示）
└── InspectionTable（质检记录列表）
```

#### 3.9.2 差距清单

| 编号 | 级别 | 设计稿要求 | 现有状态 |
|------|------|------------|----------|
| QT-01 | GAP-L3 | StatsRow 4个 KPI 统计卡片（合格率大字显示） | `MISSING` | `useQualityStats` 存在，但无 KPI 卡片 UI |
| QT-02 | GAP-L3 | IssueList（问题列表，含左侧彩色竖线区分严重度） | `MISSING` | 现有无问题列表视图，质检记录表格与问题列表是两个不同UI |
| QT-03 | GAP-L3 | IssueBarChart（问题类型分布柱状图） | `MISSING` | 现有有 `QualityStats.issueTypeBreakdown` 数据但无图表渲染 |
| QT-04 | GAP-L3 | TraceChain 水平滚动溯源链（5种节点类型，箭头连接，节点卡片） | `STUB` | `TraceabilityChain.nodes` 字段存在，但 TracePage 无横向链条可视化 UI |
| QT-05 | GAP-L2 | TraceNode 5种图标样式（product蓝/part信息色/material橙/process绿/worker紫/missing灰） | `MISSING` | 现有 TraceNode 仅有文字列表 |
| QT-06 | GAP-L3 | 溯源搜索支持3种类型（缸号/SKU/订单号）切换 | `STUB` | `TraceQuery.type` 存在，但 UI 是 select+input，与设计稿 Tab + 输入框不同 |
| QT-07 | GAP-L3 | "数据缺失"提示节点（`trace-node__icon--missing`，含 missingDataNote） | `MISSING` | 无缺失数据可视化 |
| QT-08 | GAP-L3 | 导出报告按钮 | `MISSING` | |

---

### P10 AI 对话中心

**设计稿文件：** `docs/ui/web-ai-chat.html`
**现有实现：** `services/web/src/components/ai/AiChatPanel.tsx`（当前作为全屏页面路由挂载于 `/ai-chat`）

#### 3.10.1 组件树（设计稿定义）

```
AiChatPage（全屏双栏布局）
├── LeftSidebar（会话历史面板，300px）
│   ├── NewConversationButton（+ 新对话）
│   ├── ConversationList（历史会话列表）
│   │   └── ConversationItem（标题/时间/预览文字）
│   └── BottomActions（设置/帮助）
└── RightChatArea（flex-1）
    ├── ChatHeader（当前会话标题 + 操作：清除/导出/关闭）
    ├── WelcomeBanner（首次进入欢迎卡片，含4个快捷问题）
    ├── MessageList（可滚动）
    │   ├── AiMessage（AI回复，含思考步骤展示、流式文字、数据卡片）
    │   │   ├── AiAvatar（橙色🤖图标）
    │   │   ├── ThinkingSteps（步骤列表，done/active/pending 3态）
    │   │   ├── StreamText（流式输出打字效果）
    │   │   └── DataCard（可选，表格/图表内联结果）
    │   └── UserMessage（用户消息，右对齐）
    ├── QuickReplies（快捷回复建议Chips，上下文相关）
    └── InputArea（底部固定）
        ├── Textarea（多行，自动扩展高度）
        ├── AttachmentButton（附件，可选）
        └── SendButton（橙色，支持 Enter 发送）
```

#### 3.10.2 差距清单

| 编号 | 级别 | 设计稿要求 | 现有状态 |
|------|------|------------|----------|
| AI-01 | GAP-L3 | 左侧会话历史面板（新建会话/历史列表/会话标题） | `MISSING` | 现有 AiChatPanel 无会话历史功能 |
| AI-02 | GAP-L3 | WelcomeBanner（4个快捷问题卡片入口） | `MISSING` | 现有仅有文字欢迎语 |
| AI-03 | GAP-L3 | QuickReplies（上下文快捷回复 Chips） | `MISSING` | 无此功能 |
| AI-04 | GAP-L2 | 双栏布局（历史面板 300px + 对话区弹性） | `MISSING` | 现有单栏布局 |
| AI-05 | GAP-L2 | DataCard（AI回复中内联的表格/数据卡片） | `MISSING` | StreamText 仅输出纯文本 |
| AI-06 | GAP-L2 | Textarea 自动扩展高度（min 2行，max 6行） | `STUB` | 现有 textarea 无自动高度逻辑 |
| AI-07 | GAP-L3 | 导出对话 / 清除对话按钮 | `MISSING` | |
| AI-08 | GAP-L2 | ThinkingSteps 步骤列表在消息气泡内展示（非覆盖全屏） | `EXISTS` 但位置错误 | `AiThinkingState` 是独立组件，在 Panel 中是独占区域，设计稿是内联在消息气泡中 |
| AI-09 | GAP-L3 | 会话持久化（本地 localStorage 或后端存储） | `MISSING` | 刷新后消息丢失 |

---

### P11 供应商管理

**设计稿文件：** `docs/ui/web-supplier-manage.html`
**现有实现：** `services/web/src/pages/master-data/SupplierPage.tsx`

#### 3.11.1 组件树（设计稿定义）

```
SupplierPage
├── Breadcrumb
├── PageHeader（供应商管理 + 新建供应商按钮）
├── Toolbar（搜索 + 等级筛选 + 状态筛选）
├── SummaryStrip（供应商总数/A级/合作中/待评估）
├── SupplierTable
│   ├── 供应商名称（含编码）
│   ├── 联系人/电话
│   ├── 等级标签（A-D，4色）
│   ├── 主要供货品类标签
│   ├── 历史准时率（百分比 + 进度条色条）
│   ├── 账期（天数）
│   ├── 状态标签（合作中/暂停/待评估）
│   └── 操作（编辑/查看价格/禁用）
├── Pagination
└── SupplierDrawer（右侧抽屉，480px）
    ├── 基本信息 Section
    ├── 联系信息 Section
    ├── 供货能力 Section（主要品类 + 交货周期）
    └── 历史绩效 Section（准时率/质量合格率图表）
```

#### 3.11.2 差距清单

| 编号 | 级别 | 设计稿要求 | 现有状态 |
|------|------|------------|----------|
| SU-01 | GAP-L3 | SummaryStrip（各等级/状态统计） | `MISSING` | |
| SU-02 | GAP-L3 | 历史准时率列（百分比 + 迷你进度条） | `MISSING` | `Supplier` 类型缺少 `onTimeRate` 字段 |
| SU-03 | GAP-L4 | `Supplier` 类型缺少：`code`, `rating`, `mainCategories`, `deliveryCycle`, `onTimeRate`, `qualityRate`, `paymentDays`, `status`(active/suspended/pending) | `MISSING` | 现有 Supplier 类型极简，仅有 id/name/contact/phone/address |
| SU-04 | GAP-L2 | 供应商详情使用右侧 Drawer（480px）而非 Modal | `EXISTS` Modal | 需改为 Drawer |
| SU-05 | GAP-L3 | 历史绩效 Section（准时率/质量合格率趋势图） | `MISSING` | |
| SU-06 | GAP-L3 | 主要供货品类标签（多选Tags展示） | `MISSING` | |
| SU-07 | GAP-L3 | "查看价格"按钮（跳转到价格页，带供应商筛选参数） | `MISSING` | |

---

### P12 采购价格管理

**设计稿文件：** `docs/ui/web-price-manage.html`
**现有实现：** `services/web/src/pages/purchase/PricePage.tsx`

#### 3.12.1 组件树（设计稿定义）

```
PricePage
├── Breadcrumb
├── PageHeader（采购价格管理 + 新建协议按钮）
├── ViewToggleBar（按供应商视图 / 按物料视图，Radio组）
├── Toolbar（搜索 + 供应商筛选 + 状态筛选 + SKU分类筛选）
├── 视图一：按供应商
│   └── SupplierAccordion × N（可折叠的供应商分组）
│       ├── 供应商信息Header（名称/等级/价格条数/最近更新）
│       └── PriceTable（该供应商的所有SKU价格）
│           ├── SKU名称/编码
│           ├── 单价（含涨跌幅标识△▽）
│           ├── MOQ
│           ├── 采购单位
│           ├── 有效期
│           ├── 状态
│           └── 操作（编辑/失效/历史）
└── 视图二：按物料
    └── PriceComparisonTable
        ├── SKU名称
        └── 供应商比价列（N列，最低价高亮）
```

#### 3.12.2 差距清单

| 编号 | 级别 | 设计稿要求 | 现有状态 |
|------|------|------------|----------|
| PR-01 | GAP-L3 | 双视图切换（按供应商/按物料），Radio组切换 | `MISSING` | 现有仅单一表格视图 |
| PR-02 | GAP-L3 | 按供应商视图：SupplierAccordion 折叠分组 | `MISSING` | |
| PR-03 | GAP-L3 | 按物料视图：多供应商比价表（最低价高亮） | `MISSING` | |
| PR-04 | GAP-L3 | 单价涨跌幅标识（△红涨/▽绿跌，对比上次价格） | `MISSING` | `Price` 类型缺少 `priceChangePct` 字段 |
| PR-05 | GAP-L4 | `Price` 类型（来自 `api/price.ts`）缺少：`supplierId`, `supplierName`, `priceChangePct`, `historyPrices[]` | `MISSING` | |
| PR-06 | GAP-L3 | 价格历史查看（历史弹窗/抽屉，含折线图） | `MISSING` | |

---

### P13 工序配置

**设计稿文件：** `docs/ui/web-process-config.html`
**现有实现：** `services/web/src/pages/master-data/ProcessConfigPage.tsx`

#### 3.13.1 组件树（设计稿定义）

```
ProcessConfigPage
├── Breadcrumb
├── PageHeader（工序配置 + 新建工序按钮）
├── Toolbar（搜索 + 工序类型筛选 + 工作站筛选）
├── ProcessTemplateTable
│   ├── 工序名称
│   ├── 类型标签
│   ├── 工作站
│   ├── 标准工时（小时/件）
│   ├── 单位成本
│   ├── 排序
│   ├── 启用状态
│   └── 操作（编辑/删除）
├── Pagination
└── SKU工序路由视图（可选，展示某SKU的工序路由图）
    └── ProcessRouteFlow（水平流程图）
        ├── ProcessNode × N（工序节点，4种状态色）
        │   ├── node-inherit（继承自模板）
        │   ├── node-modified（已修改）
        │   ├── node-added（新增）
        │   └── node-deleted（已删除）
        └── RouteArrow（连接箭头）
```

#### 3.13.2 差距清单

| 编号 | 级别 | 设计稿要求 | 现有状态 |
|------|------|------------|----------|
| PC-01 | GAP-L3 | SKU工序路由视图（ProcessRouteFlow水平流程图，4种节点状态） | `MISSING` | 现有完全缺失工序路由可视化 |
| PC-02 | GAP-L3 | ProcessNode 4种差异状态（继承/修改/新增/删除，对应4种颜色） | `MISSING` | 设计稿定义了专用 CSS Token（`--node-inherit-*` 等），现有无此功能 |
| PC-03 | GAP-L2 | 工作站筛选器 | `MISSING` | 现有筛选器无工作站选项 |
| PC-04 | GAP-L4 | `ProcessConfig` 类型需增加 `workstation` 字段（已有）和 `sku_route`（SKU专属路由） | `STUB` | workstation 已有，sku_route 缺失 |

---

### M01 小程序—仓库入库

**设计稿文件：** `docs/ui/mini-warehouse-inbound.html`
**现有实现：** `MISSING`（无小程序代码）

#### 3.14.1 组件树（设计稿定义）

```
WarehouseInboundPage（小程序）
├── NavigationBar（白色顶栏）
├── ScanArea（扫码区域，摄像头预览框 + 手动输入入口）
├── SkuInfoCard（扫码识别结果：SKU编码/名称/规格/当前库存）
├── InboundForm
│   ├── QtyInput（数量，数字键盘）
│   ├── UnitSelector（单位选择）
│   ├── DyeLotInput（缸号，面料类必填）
│   ├── BatchCostInput（批次成本，可选）
│   └── NotesInput（备注）
├── SubmitButton（确认入库，沉底）
└── RecentList（最近入库记录，5条）
```

#### 3.14.2 差距清单

整个小程序模块完全缺失（GAP-L3）。需新建 React Native / 微信小程序工程。

---

### M02 小程序—工人任务

**设计稿文件：** `docs/ui/mini-worker-task.html`
**现有实现：** `MISSING`

#### 3.15.1 组件树（设计稿定义）

```
WorkerTaskPage（小程序）
├── Header（工人姓名/头像/今日任务数/完成数）
├── TaskList（今日任务列表，按优先级排序）
│   └── TaskCard
│       ├── OrderNo + SKU名称
│       ├── 工序名称 + 工作站
│       ├── 计划数量 + 时段
│       ├── 优先级标识（红/黄/绿圆点）
│       └── 操作按钮（开始/完成/暂停）
├── CompleteTaskForm（完成任务弹窗）
│   ├── 完成数量
│   ├── 废料数量
│   ├── 废料原因（枚举）
│   ├── 零件条码扫描（可选）
│   └── 备注/图片上传
└── BottomNav（任务/扫码/我的）
```

---

### M03 小程序—QC 检验

**设计稿文件：** `docs/ui/mini-qc-inspect.html`
**现有实现：** `MISSING`

#### 3.16.1 组件树（设计稿定义）

```
QcInspectPage（小程序）
├── WorkOrderSearch（搜索工单）
├── InspectionForm
│   ├── QtyInspected（检验数量）
│   ├── QtyPassed（合格数量）
│   ├── IssueRecordList（问题记录列表，可动态增加）
│   │   └── IssueRecord
│   │       ├── ComponentName（部件名）
│   │       ├── IssueTypeSelect（多选，枚举）
│   │       ├── SeveritySelect（严重/主要/次要/外观）
│   │       ├── Description
│   │       └── ImageUpload（拍照）
│   └── InspectionResult（合格/不合格）
└── SubmitButton
```

---

## 4. 通用组件缺口分析

### 4.1 现有通用组件清单

| 组件 | 文件 | 完整度 | 说明 |
|------|------|--------|------|
| `Button` | `components/common/Button.tsx` | 80% | 缺少 `variant="ai"` 样式，loading spinner 样式与设计稿略有差异 |
| `Table` | `components/common/Table.tsx` | 75% | 缺少行选择（checkbox）功能、排序功能、expandable 行对设计稿展开样式不符 |
| `Tag` | `components/common/Tag.tsx` | 60% | 缺少 `dye-lot`、`sku-code-rm/wip/fg`、sub-category 16种、`priority-urgent` 等变体 |
| `Modal` | `components/common/Modal.tsx` | 85% | 基本完整，缺少 large 尺寸和 iframe 模式 |
| `Drawer` | `components/common/Drawer.tsx` | 85% | 基本完整 |
| `StatusBadge` | `components/common/StatusBadge.tsx` | 60% | 各状态 variant 映射不完整，需扩展 |
| `ConfidenceTag` | `components/common/ConfidenceTag.tsx` | 90% | 基本对齐设计稿 |
| `EmptyState` | `components/common/EmptyState.tsx` | 90% | 基本完整 |
| `ToastContainer` | `components/common/ToastContainer.tsx` | 90% | 基本完整 |
| `UnitSelector` | `components/common/UnitSelector.tsx` | 70% | 存在但未在多个页面集成 |
| `AiThinkingState` | `components/ai/AiThinkingState.tsx` | 80% | 存在但在部分页面中的集成位置不符合设计稿 |
| `StreamText` | `components/ai/StreamText.tsx` | 85% | 基本完整 |
| `AiChatPanel` | `components/ai/AiChatPanel.tsx` | 40% | 核心功能存在，但缺少会话历史、双栏布局、DataCard 等 |

### 4.2 缺失的通用组件（需新建）

| 组件名 | 优先级 | 用途 |
|--------|--------|------|
| `SummaryStrip` | P0 | 库存/SKU/BOM页面顶部汇总栏（多项统计横排） |
| `KpiCard` | P0 | 驾驶舱KPI卡片（值/单位/delta/进度条/左侧色条/图标） |
| `ProgressBar` | P0 | 通用进度条（带颜色阈值，4态：normal/warning/danger/stagnant） |
| `StatusDot` | P0 | 状态圆点（红/黄/绿/紫，用于库存状态） |
| `AiStatusBanner` | P1 | AI分析状态展示条（上次分析时间/覆盖数量/图标） |
| `AiSuggestionCard` | P0 | AI建议卡（用于驾驶舱内联审批和采购建议页） |
| `ReasonAccordion` | P1 | AI推理折叠展开（动画版） |
| `GanttChart` | P0 | 甘特图主组件（工作站×时间槽，TaskBlock可拖拽） |
| `TaskBlock` | P0 | 甘特图任务块（3态，draggable） |
| `WorkerCard` | P1 | 工人任务卡片 |
| `TraceChain` | P1 | 水平溯源链（节点图，5种类型，箭头连接） |
| `TraceNode` | P1 | 溯源节点（5种类型图标+卡片） |
| `BomTree` | P1 | BOM树形结构组件（递归展开，节点选中） |
| `BomTreeNode` | P1 | BOM树节点 |
| `ProcessRouteFlow` | P2 | 工序路由流程图（水平节点，4种差异状态） |
| `ConversationList` | P2 | AI会话历史列表 |
| `DataCard` | P2 | AI对话内联数据卡片（表格/数字） |
| `BackfillBanner` | P1 | SKU/BOM批量补录提示条 |
| `PriceComparisonTable` | P2 | 多供应商比价表 |
| `UnitToggle` | P1 | 单位切换按钮组（库存页用） |
| `Legend` | P1 | 图例说明组件（库存/甘特图页用） |
| `AiThinkingModal` | P1 | AI生成中的全屏步骤弹窗 |

---

## 5. 需要新建 / 修改 / 重写的组件清单

### 5.1 通用组件 — 需修改

| 组件文件 | 操作类型 | 修改内容 |
|----------|----------|----------|
| `styles/variables.css` | 修改 | 补充缺失 Token：`--color-stagnant-*`、`--font-family-number`、`--color-info-100`、`--shadow-xs`、`--transition-slow`、16种 SKU 子分类色 |
| `components/common/Tag.tsx` | 修改 | 新增 variant：`dye-lot`、`sku-rm/wip/fg`、`priority-urgent`、`confidence-high/medium/low`、16种 sub-category、`stagnant` |
| `components/common/Button.tsx` | 修改 | 新增 variant：`ai`（橙色）；修正 loading spinner 样式 |
| `components/common/Table.tsx` | 修改 | 新增：行复选框选择模式；列排序回调；expandedRow 样式（橙色背景for缸号行）；优化 loading skeleton 动画 |
| `components/Layout/Sidebar.tsx` | 修改 | 对齐设计稿分组标签样式（0.625rem，letter-spacing 0.1em）；active 状态增加左侧竖线；折叠展开动画 |
| `components/Layout/AppLayout.tsx` | 修改 | 挂载全局 AI 悬浮按钮（fixed 右下角）；面包屑导航组件整合 |
| `components/ai/AiThinkingState.tsx` | 修改 | 支持内联在消息气泡模式（非全屏） |
| `components/ai/AiChatPanel.tsx` | 重写 | 改为双栏布局；加入会话历史面板；WelcomeBanner；QuickReplies；Textarea自动高度；会话持久化 |
| `types/models.ts` | 修改 | 扩展字段：`InventoryItem` 增加 `stockDays`、`inventoryStatus(4态)`；`Supplier` 大量补充字段；`BomHeader` 增加 `completionRate`；`DashboardKpi` 增加 `completedValue`、`inventoryValue` |
| `pages/dashboard/DashboardPage.tsx` | 重写 | 按设计稿重构 KpiCard（含进度条/左侧色条）；新增本月产值/库存金额 KPI；生产进度区含完工日期；库存预警区含缺口量；AI建议区内联审批 |

### 5.2 页面组件 — 需新建

| 文件路径 | 说明 |
|----------|------|
| `pages/inventory/components/SummaryBar.tsx` | 库存汇总栏（三类金额占比） |
| `pages/inventory/components/UnitToggle.tsx` | 单位切换组 |
| `pages/inventory/components/InventoryLegend.tsx` | 图例组件 |
| `pages/production/components/GanttChart.tsx` | 甘特图主体 |
| `pages/production/components/TaskBlock.tsx` | 可拖拽任务块 |
| `pages/production/components/WorkerCard.tsx` | 工人任务卡片 |
| `pages/production/components/ScheduleStatusBar.tsx` | 计划状态栏 |
| `pages/production/components/AiRiskAlert.tsx` | AI风险提示条 |
| `pages/quality/components/TraceChain.tsx` | 溯源链可视化 |
| `pages/quality/components/TraceNode.tsx` | 溯源节点 |
| `pages/quality/components/IssueCard.tsx` | 质量问题卡片 |
| `pages/quality/components/QualityStatsRow.tsx` | 质量KPI行 |
| `pages/master-data/components/BomTree.tsx` | BOM树形组件 |
| `pages/master-data/components/BomEditor.tsx` | BOM双栏编辑器 |
| `pages/master-data/components/ProcessRouteFlow.tsx` | 工序路由流程图 |
| `pages/purchase/components/AiStatusPanel.tsx` | AI采购建议状态栏 |
| `pages/purchase/components/PriceViewToggle.tsx` | 价格双视图切换 |
| `pages/ai/AiChatPage.tsx` | 独立AI全屏页面（含双栏布局） |
| `components/common/SummaryStrip.tsx` | 通用汇总条（多页复用） |
| `components/common/KpiCard.tsx` | KPI统计卡（驾驶舱） |
| `components/common/AiSuggestionCard.tsx` | AI采购建议卡片（驾驶舱+建议页复用） |
| `components/common/Breadcrumb.tsx` | 面包屑导航组件 |
| `components/common/AiFloatButton.tsx` | 全局AI悬浮按钮 |

### 5.3 页面组件 — 需重写

| 文件路径 | 原因 |
|----------|------|
| `pages/production/SchedulePage.tsx` | 缺少甘特图视图，当前仅为列表，需从甘特图角度重构主UI |
| `pages/quality/TracePage.tsx` | 溯源链可视化完全缺失，需重构页面布局为2列+TraceSection |
| `pages/master-data/BomPage.tsx` | 缺少BOM编辑器双栏视图，BomTree完全缺失 |

---

## 6. 前端开发任务拆解

### P0 — 核心主干（影响可用性，必须最先完成）

| 任务ID | 任务描述 | 页面/组件 | 工时估算 | 依赖 |
|--------|----------|-----------|----------|------|
| T001 | 补充 Design Tokens 到 `variables.css`（stagnant色/数字字体/shadow-xs等） | 全局 | 2h | — |
| T002 | 扩展 `Tag` 组件新增所有缺失 variant（dye-lot/sku-rm/stagnant/sub-category 16种/priority-urgent） | 通用 | 4h | T001 |
| T003 | `KpiCard` 通用组件（含左侧色条/进度条/delta箭头/右上角图标区） | 通用 | 4h | T001 |
| T004 | `SummaryStrip` 通用组件（横排统计汇总栏，可配置项数） | 通用 | 3h | T001 |
| T005 | `ProgressBar` 通用组件（4态颜色，含百分比标签） | 通用 | 2h | T001 |
| T006 | `StatusDot` 通用组件（红/黄/绿/紫圆点 + 颜色映射） | 通用 | 1h | T001 |
| T007 | `Breadcrumb` 通用组件（路径分段，响应式） | 通用 | 2h | — |
| T008 | `AppLayout` 挂载全局 AI 悬浮按钮（`AiFloatButton`） | Layout | 2h | — |
| T009 | DashboardPage 重构：KPI卡片4个（本月产值/库存金额/在产订单/待审批）对齐设计稿 | 驾驶舱 | 6h | T003 |
| T010 | DashboardPage：生产进度区补充完工日期、库存预警区补充缺口量、AI建议区内联审批 | 驾驶舱 | 4h | T009 |
| T011 | DashboardPage：AI分析状态 Banner 组件 | 驾驶舱 | 2h | — |
| T012 | 扩展 `InventoryItem` 类型（`stockDays`, `inventoryStatus` 4态） | 类型层 | 1h | — |
| T013 | InventoryPage：SummaryBar（三类金额占比） | 库存 | 3h | T004 |
| T014 | InventoryPage：UnitToggle（按库存单位/采购单位切换，影响数量显示逻辑） | 库存 | 3h | — |
| T015 | InventoryPage：StatusDot 4态替换现有布尔值状态，库存天数列，呆滞"AI降库建议"按钮 | 库存 | 4h | T006 T012 |
| T016 | InventoryPage：图例组件，导出Excel功能 | 库存 | 2h | — |
| T017 | GanttChart 组件（工作站行×时间槽格，纯布局，不含拖拽） | 排产 | 10h | T001 |
| T018 | TaskBlock 组件（3态：normal/warning/danger，样式完整） | 排产 | 4h | T001 |
| T019 | SchedulePage 重构：StatusBar + AiRiskAlert + ViewToggle + GanttChart集成（静态数据） | 排产 | 8h | T017 T018 |
| T020 | SchedulePage：WorkerTaskCards视图（网格布局，WorkerCard组件） | 排产 | 4h | T019 |
| T021 | SchedulePage：StickyActionBar（"确认并下发"底部固定栏） | 排产 | 2h | — |
| T022 | SchedulePage：GanttChart TaskBlock 拖拽功能（同行调整时段 + 跨行换站） | 排产 | 12h | T019 |
| T023 | `Table` 组件扩展：行复选框支持，expandedRow 橙色背景 variant | 通用 | 4h | — |

**P0 合计工时估算：~103h（约 13 个工作日）**

---

### P1 — 重要功能（显著影响产品完整度）

| 任务ID | 任务描述 | 页面/组件 | 工时估算 | 依赖 |
|--------|----------|-----------|----------|------|
| T101 | SkuPage：SummaryStrip + BackfillBanner + SKU编码彩色标签（RM/WIP/FG） | SKU | 4h | T004 |
| T102 | SkuPage：二级品类16种颜色 Tag 渲染 | SKU | 3h | T002 |
| T103 | SkuPage：批量复选框行选择 + BatchActionBar | SKU | 4h | T023 |
| T104 | SkuPage：新建/编辑改用 Drawer（480px），单位换算配置动态行管理 | SKU | 5h | — |
| T105 | BomPage：SummaryStrip（完整度分布） + BomProgressBar 组件 | BOM | 4h | T004 T005 |
| T106 | BomTree 组件（递归树形，节点展开/收起，缩进连线，选中状态） | BOM | 10h | — |
| T107 | BomEditor 双栏视图（树形面板 + 详情面板，页面视图切换） | BOM | 8h | T106 |
| T108 | BomEditor：AI BOM匹配建议 Panel（含置信度/建议物料表/应用按钮） | BOM | 5h | T107 |
| T109 | SuggestionPage：AiStatusPanel 组件 | 采购建议 | 2h | — |
| T110 | SuggestionPage：InfoGrid 补充"缺口量"列（共4列） | 采购建议 | 1h | — |
| T111 | SuggestionPage：ReasonAccordion 样式动画（arrow旋转/fadeIn/背景交互） | 采购建议 | 2h | — |
| T112 | SuggestionPage：AiThinkingModal（步骤弹窗，动画） | 采购建议 | 4h | — |
| T113 | SuggestionPage："已转单"状态Tab + 采购员反馈功能 | 采购建议 | 3h | — |
| T114 | SuggestionPage：建议卡片 hover 动效（translateY + shadow） | 采购建议 | 1h | — |
| T115 | MatchPage：StatusSummaryBar（各状态计数） | 三单匹配 | 2h | T004 |
| T116 | MatchPage：DiffTable 差异高亮（红色数量差/价格异常单元格），历史均价列 | 三单匹配 | 3h | — |
| T117 | OrderPage：新建订单表单（SKU搜索下拉+库存预览，BOM版本选择器，动态产品行） | 销售订单 | 8h | — |
| T118 | OrderPage：约束引擎结果 Panel 在表单内联显示 | 销售订单 | 3h | — |
| T119 | QualityPage 重构：StatsRow 4个KPI卡片 + IssueList（左侧彩色竖线） | 质量 | 5h | T003 |
| T120 | QualityPage：IssueBarChart（问题类型分布纯CSS/Recharts条形图） | 质量 | 4h | — |
| T121 | TraceChain 组件（水平滚动，5种节点类型图标，箭头连接） | 质量 | 8h | — |
| T122 | TraceNode 组件（5种类型，含缺失节点灰色样式） | 质量 | 3h | T121 |
| T123 | QualityPage：溯源搜索切换3种类型（Tab + 输入框），集成 TraceChain | 质量 | 4h | T121 T122 |
| T124 | SupplierPage：扩展 Supplier 类型（rating/onTimeRate/status等字段） | 供应商 | 2h | — |
| T125 | SupplierPage：SummaryStrip + 准时率列（迷你进度条） + 供货品类标签 | 供应商 | 4h | T124 |
| T126 | SupplierPage：详情改为 Drawer（480px），历史绩效 Section | 供应商 | 5h | — |
| T127 | Sidebar 对齐设计稿（分组标签/active 竖线/折叠动画） | Layout | 3h | T001 |
| T128 | Header/AppLayout 集成 Breadcrumb 组件（各页面传入路径配置） | Layout | 4h | T007 |

**P1 合计工时估算：~121h（约 15 个工作日）**

---

### P2 — 体验增强（提升用户体验，可迭代完善）

| 任务ID | 任务描述 | 页面/组件 | 工时估算 | 依赖 |
|--------|----------|-----------|----------|------|
| T201 | AiChatPage 重构：双栏布局（历史面板300px + 对话区），ConversationList | AI对话 | 8h | — |
| T202 | AiChatPage：WelcomeBanner（4个快捷问题卡片） + QuickReplies Chips | AI对话 | 3h | T201 |
| T203 | AiChatPage：DataCard（内联数据展示，支持表格/KPI） | AI对话 | 5h | T201 |
| T204 | AiChatPage：Textarea 自动高度 + 会话持久化（localStorage） | AI对话 | 3h | T201 |
| T205 | AiChatPage：导出对话/清除对话功能 | AI对话 | 2h | T201 |
| T206 | PricePage：双视图切换（按供应商/按物料），ViewToggle Radio组 | 价格 | 3h | — |
| T207 | PricePage：SupplierAccordion 分组折叠视图 | 价格 | 5h | T206 |
| T208 | PricePage：PriceComparisonTable（多供应商比价，最低价高亮） | 价格 | 5h | T206 |
| T209 | PricePage：价格涨跌幅标识（△▽），价格历史弹窗（折线图） | 价格 | 6h | — |
| T210 | ProcessConfigPage：ProcessRouteFlow 工序路由流程图（4种节点差异状态） | 工序 | 8h | T001 |
| T211 | 小程序工程初始化（React Native 或 Taro微信小程序框架选型） | 小程序 | 8h | — |
| T212 | 小程序 — 仓库入库页（扫码/表单/缸号/提交） | 小程序 | 16h | T211 |
| T213 | 小程序 — 工人任务页（任务列表/完成表单/拍照上传） | 小程序 | 16h | T211 |
| T214 | 小程序 — QC检验页（检验表单/问题录入/图片上传） | 小程序 | 16h | T211 |
| T215 | 全站响应式适配验证（1200px折叠/768px移动端）及修复 | 全局 | 8h | — |
| T216 | 导出 Excel 功能（库存/质量报告页，`xlsx` 库集成） | 全局 | 4h | — |
| T217 | 全局 Loading Skeleton 统一样式（Shimmer动画，各页面骨架屏对齐设计稿） | 全局 | 4h | — |
| T218 | 空状态页（各页面 EmptyState 图标/文字对齐设计稿） | 全局 | 2h | — |
| T219 | 网络异常/超时统一错误提示组件（重试按钮，与现有 Toast 配合） | 全局 | 3h | — |

**P2 合计工时估算：~125h（约 16 个工作日）**

---

### 总工时汇总

| 优先级 | 工时 | 工作日（按 8h/天） |
|--------|------|-------------------|
| P0 核心主干 | ~103h | ~13 天 |
| P1 重要功能 | ~121h | ~15 天 |
| P2 体验增强 | ~125h | ~16 天 |
| **合计** | **~349h** | **~44 天** |

> 上述工时为单人估算，按前后端并行可压缩时间线。P0+P1 是验收合格的最小集合，P2 可分批迭代。

---

## 7. 技术债务与风险

### 7.1 高风险项

| 风险 | 详情 | 建议 |
|------|------|------|
| **甘特图拖拽（T022）** | 原生 HTML5 Drag & Drop API 在跨浏览器/触摸设备上行为不一致；拖拽后排产结果需原子性提交后端 | 引入 `@dnd-kit/core` 库统一拖拽逻辑；后端需支持批量更新排产接口 |
| **GanttChart 性能** | 若排产数据量大（多工作站×多任务），DOM节点数可能导致渲染卡顿 | 考虑虚拟化滚动；时间槽按需渲染 |
| **BOM 递归树渲染** | 多层级BOM（层级>5）时，递归组件可能栈溢出；大型BOM渲染性能 | 限制最大展开层级+懒加载子节点；使用 `useCallback` 稳定回调引用 |
| **流式输出SSE连接** | 弱网环境下 SSE 断连后的重连逻辑，多 Tab 场景下的连接管理 | 实现 exponential backoff 重连；单 Tab 限制单一 SSE 连接 |
| **小程序独立工程** | React Native 和微信小程序各有技术栈差异，需明确选型 | 建议 Taro + React 统一代码库，一套代码多端编译 |

### 7.2 中等风险项

| 风险 | 详情 | 建议 |
|------|------|------|
| **类型系统不一致** | `Sku.name` vs 设计稿/API 文档期望的 `skuName`，可能导致前后端字段对齐问题 | 统一以 API 文档为准，前端类型层做字段映射 |
| **缸号业务逻辑复杂** | 缸号在库存/采购建议/质量溯源3个模块均有涉及，各处交互逻辑不同 | 抽出 `useDyeLot` 公共 hook，集中管理缸号相关状态 |
| **权限控制粒度** | 设计稿中不同角色可见的功能按钮不同（老板/采购员/仓管等），现有 `usePermission` hook 存在但页面中使用不一致 | 建立统一的权限矩阵文档，每个操作按钮统一过 `usePermission` |
| **CSS Variables vs CSS Modules** | 部分页面用 inline style 覆盖 Token，部分用 Module CSS，不统一 | 规范：布局间距/颜色均走 CSS Variable，组件私有尺寸走 Module CSS |

### 7.3 低风险 / 技术债务

- `InventoryPage.tsx` 底部有一个占位 `navigate` 函数，需替换为真正的 `useNavigate()`
- `DashboardPage` 使用了 `CAPACITY_MOCK` 模拟数据，联调后需替换为 `GET /api/dashboard/kpi` 接口的真实数据
- 多个页面存在重复的 `STATUS_VARIANT` 映射常量，建议统一到 `types/enums.ts` 导出
- 设计稿侧边栏 Logo 图标在部分页面用 emoji（🏭）、部分用 SVG + 数字"智"字，需统一

---

## 附录 A — 设计稿 vs 实现对应关系速查表

| 设计稿文件 | React 页面路径 | 实现状态 |
|-----------|---------------|---------|
| web-dashboard.html | /dashboard → DashboardPage.tsx | 60% 完整 |
| web-inventory.html | /inventory → InventoryPage.tsx | 55% 完整 |
| web-sku-master.html | /master-data/sku → SkuPage.tsx | 50% 完整 |
| web-bom-manage.html | /master-data/bom → BomPage.tsx | 40% 完整 |
| web-purchase-suggestion.html | /purchase/suggestions → SuggestionPage.tsx | 65% 完整 |
| web-purchase-match.html | /purchase/match → MatchPage.tsx | 70% 完整 |
| web-sales-order.html | /sales/orders → OrderPage.tsx | 60% 完整 |
| web-production-schedule.html | /production/schedule → SchedulePage.tsx | 25% 完整 |
| web-quality-trace.html | /quality/trace → TracePage.tsx | 45% 完整 |
| web-ai-chat.html | /ai-chat → AiChatPanel.tsx | 40% 完整 |
| web-supplier-manage.html | /master-data/supplier → SupplierPage.tsx | 45% 完整 |
| web-price-manage.html | /purchase/prices → PricePage.tsx | 50% 完整 |
| web-process-config.html | /master-data/process-config → ProcessConfigPage.tsx | 55% 完整 |
| mini-warehouse-inbound.html | 无 | 0% 完整 |
| mini-worker-task.html | 无 | 0% 完整 |
| mini-qc-inspect.html | 无 | 0% 完整 |

---

## 附录 B — 关键路径图

```
T001(Tokens) → T002(Tag扩展) → T003(KpiCard) → T009/T010(Dashboard重构)
                              → T006(StatusDot) → T013/T015(库存页)
             → T004(SummaryStrip) → 多页面汇总栏
T001 → T017(GanttChart) → T019(SchedulePage) → T022(拖拽)
T106(BomTree) → T107(BomEditor) → T108(AI建议)
T121(TraceChain) → T122(TraceNode) → T123(溯源查询集成)
T211(小程序工程) → T212/T213/T214(各小程序页面)
```

---

*本文档由 @senior-frontend-engineer 完成，作为 SDD 驱动开发的基础文档。*
*后续所有前端开发任务（T001-T219）将基于此文档执行，并在完成后通知 @senior-qa-engineer 进行验收。*
*接口层差距已同步给 @senior-backend-engineer 确认（Supplier 类型扩展、InventoryItem 新字段、DashboardKpi 新字段、ScheduleItem 新字段）。*
