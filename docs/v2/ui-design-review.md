# [artifact:设计规范] 智造管家 UI 设计复盘报告

**文档版本**：v1.0
**创建日期**：2026-03-14
**负责人**：@senior-ui-designer
**输入来源**：PRD v1.4、原型设计说明 v1.4、V2 迭代规划、Sprint 1-4 用户故事、gap 分析报告 R-01~R-08

---

## 目录

1. [设计覆盖率统计](#一设计覆盖率统计)
2. [缺失设计清单（按优先级排序）](#二缺失设计清单)
3. [已有设计 vs 实现差异总结](#三已有设计-vs-实现差异总结)
4. [统一设计规范检查](#四统一设计规范检查)
5. [P0 设计稿创建计划](#五p0-设计稿创建计划)

---

## 一、设计覆盖率统计

### 1.1 总体覆盖率

| 统计项 | 数量 |
|---|---|
| 已实现前端页面（总计） | 26 |
| 已有 HTML 设计稿 | 7 |
| **设计覆盖率** | **26.9%** |
| 无设计稿直接开发的页面 | 19 |

### 1.2 逐页覆盖状态

| # | 页面文件 | 页面名称 | 设计状态 | 对应设计稿 |
|---|---|---|---|---|
| 1 | auth/LoginPage.tsx | 登录页 | 无设计稿 | — |
| 2 | dashboard/DashboardPage.tsx | 首页驾驶舱 | 无设计稿 | — |
| 3 | master-data/SkuPage.tsx | SKU 主数据 | 无设计稿 | — |
| 4 | master-data/BomPage.tsx | BOM 管理 | 无设计稿 | — |
| 5 | master-data/CategoryConfigPage.tsx | SKU 类目管理 | **有设计稿** | design-r01-category-management.html |
| 6 | master-data/ProcessConfigPage.tsx | 工序配置 | **有设计稿** | design-r05-process-wage.html |
| 7 | master-data/SupplierPage.tsx | 供应商管理 | **有设计稿** | design-r02-supplier-export-compare.html |
| 8 | purchase/PricePage.tsx | 采购价格管理 | 无设计稿 | — |
| 9 | purchase/PurchaseSuggestionPage.tsx | 采购建议 | 无设计稿 | — |
| 10 | purchase/SuggestionPage.tsx | 采购建议（另一个） | 无设计稿 | — |
| 11 | purchase/MatchPage.tsx | 三单匹配 | 无设计稿 | — |
| 12 | purchase/IncomingInspectionPage.tsx | 来料质检 | 无设计稿 | — |
| 13 | purchase/ReturnOrderPage.tsx | 退货单 | 无设计稿 | — |
| 14 | inventory/InventoryPage.tsx | 库存管理 | 无设计稿 | — |
| 15 | production/ProductionOrderPage.tsx | 生产工单 | 无设计稿 | — |
| 16 | production/SchedulePage.tsx | 排产计划/生产看板 | 无设计稿 | — |
| 17 | production/TaskPage.tsx | 生产任务 | **有设计稿** | design-r06-web-task-management.html |
| 18 | sales/CustomerPage.tsx | 客户管理 | **有设计稿** | design-r07-customer.html |
| 19 | sales/OrderPage.tsx | 新建销售订单 | **有设计稿** | design-r08-sales-order.html |
| 20 | sales/SalesOrderListPage.tsx | 销售订单列表 | **有设计稿** | design-r08-sales-order.html |
| 21 | schedule/ScheduleSuggestionPage.tsx | 排产建议（智能调度） | 无设计稿 | — |
| 22 | quality/TracePage.tsx | 质量追溯 | 无设计稿 | — |
| 23 | report/MyWagePage.tsx | 我的工资 | 无设计稿 | — |
| 24 | report/WageReportPage.tsx | 工资报表 | 无设计稿 | — |
| 25 | ai/AiChatPage.tsx | AI 对话 | 无设计稿 | — |
| 26 | purchase/PriceImportWizard.tsx | 价格导入向导 | **有设计稿** | design-r03-price-import.html |

> 注：design-r08-sales-order.html 同时覆盖 OrderPage 和 SalesOrderListPage 两个页面。

---

## 二、缺失设计清单

### 2.1 P0 — 核心业务页面，必须补设计稿

| 序号 | 页面名称 | 文件路径 | 对应 PRD 功能 | 关键交互点 | 设计稿目标文件 |
|---|---|---|---|---|---|
| 1 | 首页驾驶舱 | dashboard/DashboardPage.tsx | F-401（老板驾驶舱）、F-502（AI推送预警）、F-S4-012（调度建议Widget） | KPI 卡片组、生产进度总览、库存预警列表、AI 采购建议审批区、待审批徽章、数据过期提示 | design-dashboard.html |
| 2 | SKU 主数据 | master-data/SkuPage.tsx | F-002（SKU主数据管理）、F-006（缸号批次管理） | 搜索筛选栏（含二级分类联动）、新增/编辑 Modal、批量导入入口、缸号管理抽屉、空态、骨架屏 | design-sku-master.html |
| 3 | BOM 管理 | master-data/BomPage.tsx | F-005（BOM管理）、R-04（半成品通用化+版本迭代） | BOM 树形展开视图、版本切换、通用件引用标识、BOM 快速录入向导、AI 辅助建议状态 | design-bom.html |
| 4 | 库存管理 | inventory/InventoryPage.tsx | F-101（实时库存看板）、F-104（库存预警）、F-107（缸号精细化管理） | 四色状态标记（红/黄/绿/蓝）、汇总统计行、二级分类筛选联动、缸号展开子表、导出按钮 | design-inventory.html |
| 5 | 生产工单 | production/ProductionOrderPage.tsx | F-301（订单优先级）、F-306（生产进度看板）、US-S3-005（销售→生产工单创建） | 工单列表（含进度条）、BOM 展开状态、物料齐套状态、工单详情侧边栏、状态机流转 | design-production-order.html |

### 2.2 P1 — 重要业务页面，应补设计稿

| 序号 | 页面名称 | 文件路径 | 对应 PRD 功能 | 关键交互点 |
|---|---|---|---|---|
| 1 | 排产计划/生产看板 | production/SchedulePage.tsx | F-302/F-303（排产计划）、F-306（生产进度看板） | 甘特图/工作站视图切换、AI 建议横幅、拖拽调整、确认下发 |
| 2 | 采购建议页 | purchase/PurchaseSuggestionPage.tsx | F-202（AI采购建议）、F-203（审批流） | AI 思考中状态、建议展开（推理依据）、批准/驳回操作、置信度徽章 |
| 3 | 来料质检 | purchase/IncomingInspectionPage.tsx | R-09（US-S3-001~004）、F-207（三单匹配） | 质检单创建、合格/不合格流转、退货触发、部分到货处理 |
| 4 | 智能调度主看板 | schedule/ScheduleSuggestionPage.tsx | R-12（F-S4-001~007）、F-S4-005 | 采购建议+排产建议分区、规则引擎步骤可视化、计算中状态、一键确认 |
| 5 | AI 对话页 | ai/AiChatPage.tsx | F-501（全局AI助手）、F-206（采购咨询） | 思考中状态（流式点动画）、流式输出光标、业务数据卡片嵌入、错误恢复态 |
| 6 | 登录页 | auth/LoginPage.tsx | — | 表单校验、加载态、错误反馈 |

### 2.3 P2 — 低优先级，可延后补设计

| 序号 | 页面名称 | 文件路径 | 说明 |
|---|---|---|---|
| 1 | 退货单 | purchase/ReturnOrderPage.tsx | 业务频率较低，功能相对简单 |
| 2 | 三单匹配 | purchase/MatchPage.tsx | 采购结算场景，使用频率低 |
| 3 | 质量追溯 | quality/TracePage.tsx | P1 功能，当前核心链路已覆盖 |
| 4 | 我的工资 | report/MyWagePage.tsx | 工人个人视图，功能简单 |
| 5 | 工资报表 | report/WageReportPage.tsx | 已在 design-r05 中部分覆盖 |
| 6 | 采购价格管理（主列表） | purchase/PricePage.tsx | 导入向导已有设计，主列表可参考供应商列表模式 |

---

## 三、已有设计 vs 实现差异总结

以下汇总 gap 分析报告中**尚未修复**的 🔴 重大缺失和 🟡 部分缺失项（截至 2026-03-14）。

### 3.1 R-01 SKU 类目管理（gap-r01-r02.md）

**未修复 🔴 重大缺失（5项）**：

| 编号 | 问题描述 | 修复方向 |
|---|---|---|
| R01-01 | 页面布局：设计稿为左右双面板，实现为单一扁平表格 | FE 重构为左侧一级类目导航面板 + 右侧二级表格 |
| R01-02 | 左侧面板缺少：子类目数量徽章、预置/自定义徽章、hover 才显示操作按钮 | FE 补充 meta 区域和 hover 状态切换逻辑 |
| R01-03 | 右侧表格缺少「关联 SKU 数」和「创建时间」列，多出「层级」「排序值」列 | FE+BE：补充聚合字段，对齐表格列 |
| R01-04 | 右侧面板顶部缺少选中一级类目标题栏和独立「+ 新增子类目」按钮 | FE 新增面板头部区域 |
| R01-05 | 页头缺少「← 返回 SKU 列表」导航按钮 | FE 补充导航按钮 |

**未修复 🟡 部分缺失（3项）**：R01-06（内联编辑控件位置）、R01-07（左侧面板底部新增按钮）、R01-08（骨架屏结构不对应双面板）

---

### 3.2 R-02 供应商导出+绩效对比（gap-r01-r02.md）

**未修复 🔴 重大缺失（5项）**：

| 编号 | 问题描述 | 修复方向 |
|---|---|---|
| R02-01 | 导出 Excel 按钮完全缺失（含 4 种状态机和 Toast 反馈） | FE 新增导出按钮及状态机；BE 确认 export 路由 |
| R02-02 | 对比弹框缺少「核心指标对比表格」（9 行指标，最优值绿色/最差值红色高亮） | FE 新增 compare-table；BE 补充 8 个绩效字段 |
| R02-03 | 无底部浮动选中工具栏；最大对比数 3（设计稿为 5） | FE 重构为浮动 selection-bar；修改 MAX_COMPARE=5 |
| R02-04 | 表格列缺：供应商编码、联系电话、综合评分（星级）；多出：准时率、质量异常率、账期列 | FE 对齐表格列结构 |
| R02-05 | 表格无 checkbox 列，无全选/全不选/indeterminate 三态 | FE 新增 checkbox 列 |

**未修复 🟡 部分缺失（6项）**：R02-06（供应商标签可移除）、R02-07（时间范围分段按钮组）、R02-08（折线图数据源）、R02-09（无数据告警条）、R02-10（副标题统计）、R02-11（筛选器动态品类）

---

### 3.3 R-03 采购价格批量导入（gap-r03-r05.md）

**未修复 🔴 重大缺失（4项）**：

| 编号 | 问题描述 | 修复方向 |
|---|---|---|
| G02 | 模板列 A/B 顺序与设计稿相反（SKU编码 vs 供应商编码） | FE+BE 统一字段顺序；需 PM 最终确认业务字段 |
| G03 | 模板字段「货币单位」「含税标记」被「采购单位」「最小起订量」替换 | 需架构师与 PM 对齐正确业务模型后统一修正 |
| G04 | 「报价日期」字段被「有效期开始/截止」替换，语义不符 | 同 G03，需业务对齐后处理 |
| G14 | 导入执行阶段无进度条、无轮询、无终止按钮（400ms 延迟直跳结果页） | BE 提供轮询接口；FE 实现进度条 + 终止按钮 |

**未修复 🟡 部分缺失（9项）**：G05（已选文件显示行数）、G06（终止解析按钮）、G07（5000行超限状态）、G09（重复追加 chip）、G10（预览表格列不完整）、G11（Step3 缺下载错误明细按钮）、G15（结果页缺跳过错误行卡片）、G16（结果页缺价格偏高告警区）、G17（入口页汇总数据行待核查）

---

### 3.4 R-05 工序工价管理（gap-r03-r05.md）

**未修复 🔴 重大缺失（3项）**：

| 编号 | 问题描述 | 修复方向 |
|---|---|---|
| G18 | 工资核算报表 Tab 切换逻辑可能缺失（设计稿为双 Tab） | FE 确认并实现 Tab 切换 |
| G21 | 工价列权限控制可能缺失（非 admin 应完全不渲染工价列 + 顶部权限 banner） | FE+BE 实现角色级列隐藏；属安全缺陷 |
| G24 | 完工上报弹框完整实现可能缺失（含工资预览、超时预警、实际工时字段） | FE 重新实现完工上报弹框 |

**未修复 🟡 部分缺失（9项）**：G19（行内联编辑极限工时）、G20（未配置行快捷配置按钮）、G22（工价差实时预览）、G23（超时阈值实时预览）、G25（工资报表柱状图视图）、G26（报表合计行 tfoot）、G27（工人等级筛选下拉）、G29（等级未配置 Toast）、G30（工序配置导出按钮）

---

### 3.5 R-06 Web 端任务管理（gap-r06-r07.md）

**未修复 🔴 重大缺失（5项）**：

| 编号 | 问题描述 | 修复方向 |
|---|---|---|
| R06-G01 | 统计卡片数据从当前分页 filter 计算，非全库数量 | BE 新增 GET /production-tasks/stats 接口 |
| R06-G02 | 完工上报弹窗缺「实际工时」字段和工资预览区 | FE+BE 补充字段和计算逻辑 |
| R06-G03 | 异常上报缺「是否影响生产进度」字段和图片上传 | FE+BE 补充字段 |
| R06-G04 | 任务详情抽屉缺 BOM 快照区和操作时间线 | FE+BE 补充抽屉内容区 |
| R06-G05 | 缺「已挂起」状态和主管异常处置流程（标记已处理/挂起任务弹窗） | FE+BE 扩展状态机和角色操作 |

**未修复 🟡 部分缺失（4项）**：R06-G06（统计卡片点击筛选联动）、R06-G08（任务列表缺产品名称列）、R06-G09（多任务并行二次确认）、R06-G10（超时预警行样式）

---

### 3.6 R-07 客户管理（gap-r06-r07.md）

（gap-r06-r07.md 中 R-07 相关问题主要集中在联系人子表交互、客户等级展示、历史订单关联等细节，整体主结构与设计稿一致，待单独记录。）

---

### 3.7 R-08 销售订单（gap-r08.md）

**未修复 🔴 重大缺失（7项）**：

| 编号 | 问题描述 | 修复方向 |
|---|---|---|
| GAP-R08-01 | OrderPage.tsx 客户和产品使用硬编码 MOCK 数据，功能完全不可用 | FE 替换为真实 API 调用 |
| GAP-R08-04 | 统计卡片数据仅为当前分页过滤结果，非全库统计 | BE 返回各状态汇总计数 |
| GAP-R08-08 | 新建订单存在两套并行实现（OrderPage vs CreateOrderModal），路由不清晰 | 架构对齐：统一入口 |
| GAP-R08-09 | 新建弹框缺少「自动生成订单号」只读字段展示 | FE 补充只读字段 |
| GAP-R08-10 | 紧急插单开关开启后缺产能影响横幅（无 capacity-check 接口调用） | BE 实现 capacity-check 端点；FE 实现影响横幅 |
| GAP-R08-13 | 缺独立紧急插单审批弹框（含订单摘要+影响评估+驳回原因） | FE 实现独立 modal-approve |
| GAP-R08-15 | 订单详情 Drawer 缺状态时间线 | FE 实现纵向状态时间线组件 |

**未修复 🟡 部分缺失（5项）**：GAP-R08-02（列顺序）、GAP-R08-03（紧急行浅红背景+闪烁）、GAP-R08-05（统计卡片点击筛选）、GAP-R08-06（日期范围筛选）、GAP-R08-12（保存草稿按钮）

---

### 3.8 差异问题汇总统计

| 模块 | 🔴 重大缺失 | 🟡 部分缺失 | 🟢 细节差异 | 总计 |
|---|---|---|---|---|
| R-01 SKU 类目管理 | 5 | 3 | 2 | 10 |
| R-02 供应商导出+绩效对比 | 5 | 6 | 2 | 13 |
| R-03 采购价格批量导入 | 4 | 9 | 4 | 17 |
| R-05 工序工价管理 | 3 | 9 | 1 | 13 |
| R-06 Web 端任务管理 | 5 | 4 | 1 | 10 |
| R-07 客户管理 | 待深度分析 | — | — | — |
| R-08 销售订单 | 7 | 5 | 2 | 14 |
| **合计** | **29+** | **36+** | **12+** | **77+** |

---

## 四、统一设计规范检查

### 4.1 设计 Token 一致性

检查 7 个已有 HTML 设计稿的 `:root` 变量定义，结论如下：

| 设计 Token 类别 | 一致性状态 | 说明 |
|---|---|---|
| 主色（Primary Blue） | **一致** | 所有稿件均使用 `#3B82F6`（500）/ `#2563EB`（600）/ `#1D4ED8`（700） |
| 背景色 | **一致** | 页面背景 `#F8FAFC`，卡片白 `#FFFFFF`，侧边栏深色 `#1E293B` |
| 中性灰色阶 | **一致** | 全部使用 Slate 灰色体系（50~900）|
| 状态色（成功/警告/错误） | **一致** | success `#22C55E`，warning `#F59E0B`，error `#EF4444` |
| 字体栈 | **一致** | PingFang SC > Noto Sans CJK SC > Microsoft YaHei > 系统字体 |
| 字号阶梯 | **一致** | h2:1.5rem / h3:1.25rem / body-m:0.875rem / caption:0.6875rem |
| 间距系统 | **一致** | 4px 基准网格，space-1(0.25)~space-12(3rem) |
| 圆角 | **一致** | sm:4px / md:8px / lg:12px / xl:16px / full:9999px |
| 阴影 | **一致** | xs~xl 五级阴影体系 |
| 动画时长 | **一致** | fast:150ms / base:200ms / slow:300ms / spring:200ms cubic |
| z-index 层级 | **一致** | dropdown:100 / sticky:200 / overlay:300 / modal:400 / toast:500 |

**结论：7 个已有设计稿的 Design Token 体系完全统一，可作为系统规范基准。**

### 4.2 布局骨架一致性

| 布局模式 | 使用情况 | 一致性 |
|---|---|---|
| 左侧边栏（240px 深色）+ 右侧主区 | 全部 7 个稿件 | **一致** |
| 顶部 Header（64px 白色）+ 面包屑 | 全部 7 个稿件 | **一致** |
| 页面内容区 padding（24px） | 全部 7 个稿件 | **一致** |
| 页头（page-header）= 标题左 + 操作按钮右 | 全部 7 个稿件 | **一致** |

### 4.3 组件样式一致性

| 组件类型 | 一致性状态 | 注意事项 |
|---|---|---|
| 主按钮（btn--primary） | 一致 | bg: primary-600，hover: primary-700，padding: 0.5rem 1rem |
| 次按钮（btn--secondary） | 一致 | border: gray-300，bg: white，hover: gray-50 |
| 危险按钮（btn--danger） | 一致 | bg: error-600，hover: error-700 |
| 输入框 | 一致 | border: gray-300，focus: primary-500 2px outline-offset |
| 表格 | 一致 | thead bg: gray-50，行 hover: gray-50，行 border-bottom: gray-100 |
| Badge/Tag | 基本一致 | 状态 badge 颜色略有差异（R-08 的 urgent tag 闪烁未在所有稿件中一致定义）|
| Modal | 一致 | overlay: rgba(0,0,0,0.5)，container: white/lg-radius/xl-shadow |
| Toast | 一致 | z-index:500，right/top 定位，auto-dismiss 3s |
| 骨架屏 | **不完全一致** | R-01 有完整骨架；R-06 骨架屏结构简单；部分稿件无骨架屏设计 |

### 4.4 AI 专属状态设计一致性

| AI 状态类型 | 是否在设计稿中有规范 | 建议 |
|---|---|---|
| AI 思考中（步骤列表动画） | R-06 任务管理有部分，R-08 插单影响评估有 | 需统一为标准组件 |
| 流式输出（光标闪烁） | 仅原型文档 P-007 有描述，HTML 设计稿未系统化 | 需在 AI 对话页设计稿中定义标准 |
| AI 错误恢复状态 | 原型文档 P-002 有描述，HTML 设计稿未覆盖 | 需补充 |
| 规则引擎步骤可视化（Sprint 4） | 无任何设计稿覆盖 | P1 优先级，排产建议页需新增 |

### 4.5 设计规范问题汇总与建议

**问题 1 — 骨架屏规范缺失**：建议新增独立骨架屏组件规范，明确骨架行高度（1rem/0.75rem）、圆角、动画方式（shimmer 渐变）。

**问题 2 — 响应式规范缺失**：7 个设计稿均以 PC 1440px 宽度为基准，未定义 1024px（中屏）和移动端 768px 以下的响应式折叠规则。建议补充。

**问题 3 — AI 状态组件未系统化**：AI 思考中、流式输出、规则引擎步骤可视化三种状态在各稿件中各自实现，需提炼为可复用组件规范（参考 WCAG 2.1 AA：动态内容须有 aria-live 声明）。

**问题 4 — 空态设计未统一**：各页面空态（empty state）图示和文案不统一，建议定义标准空态组件（图示 + 主文案 + 操作按钮）。

---

## 五、P0 设计稿创建计划

### 5.1 已计划创建的 P0 设计稿

| 设计稿文件 | 页面 | 核心状态覆盖 | 创建状态 |
|---|---|---|---|
| design-dashboard.html | 首页驾驶舱 | KPI 卡片、生产进度、库存预警、AI 采购建议审批区、数据过期提示 | 待创建 |
| design-sku-master.html | SKU 主数据 | 列表（带状态徽章）、搜索筛选栏、新增/编辑 Modal、缸号抽屉、骨架屏、空态 | 待创建 |
| design-bom.html | BOM 管理 | BOM 树形展开、版本切换标签、通用件引用标识、录入向导、AI 辅助建议态 | 待创建 |
| design-inventory.html | 库存管理 | 四色状态标记、汇总统计行、二级分类筛选联动、缸号展开子表、导出按钮 | 待创建 |
| design-production-order.html | 生产工单 | 工单列表（含进度条/状态机）、物料齐套指示、详情侧边栏、状态时间线 | 待创建 |

### 5.2 设计规范约束（所有 P0 设计稿必须遵守）

- Design Tokens 与 design-r01 `:root` 变量完全一致
- 侧边栏导航菜单与原型文档 1.2 节导航结构完全一致
- BEM 命名规范：块__元素--修饰符
- rem 尺寸体系：1rem = 16px 基准
- 所有 Modal/Drawer 须定义 backdrop + z-index:400
- 每个页面必须包含：正常态、加载态（骨架屏）、空态、至少一个关键 Modal/Drawer
- AI 相关状态页面须包含：思考中（步骤列表）、结果展示、错误恢复三态
- 无障碍：所有交互元素须有 `:focus-visible` 样式，颜色对比度满足 WCAG AA
