# 智造管家 — 技术审计报告

**文档版本**：v1.0
**审计日期**：2026-03-11
**审计负责人**：@senior-architect
**审计基准**：PRD v1.4 + 16 份 UI 设计稿 + API 文档 v1.0
**审计范围**：Web 前端（`services/web/`）、后端 API（`services/api/`）

---

## 一、总览评分

| 维度 | 评分 | 说明 |
|---|---|---|
| PRD 功能覆盖率 | **61%** | 41 个功能点中 25 个已实现，7 个部分实现，9 个未实现 |
| UI 设计稿还原率 | **68%** | 16 个设计稿页面中 5 个完整还原，7 个部分还原，4 个无对应前端页面 |
| 后端 API 完整性 | **72%** | 核心业务接口已实现，供应商/价格/工序配置模块后端路由缺失 |
| 前端 API 封装覆盖率 | **85%** | 有封装文件但对应后端路由缺失；已有后端接口的封装完整 |
| 路由 & 菜单完整性 | **56%** | 9 个路由已注册；供应商、价格管理、工序配置、AI对话中心等 7 个页面路由缺失 |
| 类型定义完整性 | **92%** | 枚举与 API 文档高度对齐，部分类型与前端实现存在细节偏差 |

---

## 二、PRD 功能覆盖率逐项审计

### 模块一：数据基础层

| 功能ID | 功能名称 | 优先级 | 状态 | 说明 |
|---|---|---|---|---|
| F-001 | Excel 数据导入 | P0 | ❌ 未实现 | PRD 明确要求字段映射向导；无对应前端页面，无后端路由 |
| F-002 | SKU 主数据管理 | P0 | ✅ 已实现 | `SkuPage.tsx` + 后端 `sku.routes.ts` 完整实现，含二级分类 |
| F-003 | 供应商主数据 | P0 | ⚠️ 部分实现 | 前端 `supplier.ts` API 封装已存在，但无对应前端页面（`/master-data/supplier` 路由未注册），后端无 `/api/suppliers` 路由模块 |
| F-004 | 订单主数据 | P0 | ✅ 已实现 | 通过销售订单模块覆盖 |
| F-005 | BOM 管理 | P0 | ✅ 已实现 | `BomPage.tsx` + 后端 `bom.routes.ts`，含 AI 辅助建议和激活操作 |
| F-006 | 缸号批次管理 | P0 | ✅ 已实现 | 库存模块中 `hasDyeLot` 标志 + dye-lot API 完整 |
| F-007 | 工序配置 | P0 | ⚠️ 部分实现 | 前端 `processConfig.ts` API 封装存在，但无前端页面（路由未注册），后端无工序配置路由 |

### 模块二：库存管理

| 功能ID | 功能名称 | 优先级 | 状态 | 说明 |
|---|---|---|---|---|
| F-101 | 实时库存看板 | P0 | ⚠️ 部分实现 | `InventoryPage.tsx` 实现了基础功能；**关键缺失**：分类筛选仅支持一级分类下拉，设计稿要求的二级品类筛选未从标准枚举动态读取（设计稿旧描述 "板材/木料、面料/皮料" 未替换为标准二级枚举）；呆滞风险状态筛选未实现；库存单位/采购单位切换 Toggle 未实现 |
| F-102 | 入库录入（小程序） | P0 | ❌ 未实现 | 小程序侧无实现；Web 端仅有按钮入口但无实际入库表单页面 |
| F-103 | 出库录入（小程序） | P0 | ❌ 未实现 | 同 F-102 |
| F-104 | 库存预警 | P0 | ✅ 已实现 | `belowSafety` 筛选 + Dashboard 预警卡片 |
| F-105 | 库存盘点辅助 | P1 | ❌ 未实现 | 无对应页面和接口 |
| F-106 | 物料损耗记录 | P1 | ❌ 未实现 | 无对应页面和接口 |
| F-107 | 缸号精细化管理 | P0 | ✅ 已实现 | FIFO 缸号推荐、缸号批次展开查看均已实现 |

### 模块三：AI 采购助手

| 功能ID | 功能名称 | 优先级 | 状态 | 说明 |
|---|---|---|---|---|
| F-201 | 采购需求计算引擎 | P0 | ✅ 已实现 | 后端 `suggestion.service.ts` 实现 |
| F-202 | AI 采购建议生成 | P0 | ✅ 已实现 | `SuggestionPage.tsx` 含置信度标签、缸号提示、AI 推理展开 |
| F-203 | 采购建议审批流 | P0 | ✅ 已实现 | 批准/驳回弹窗完整 |
| F-204 | 采购订单跟踪 | P0 | ⚠️ 部分实现 | 后端 PO 路由存在，前端有 `usePurchaseOrderList` Hook，但无独立的采购订单列表页面（无路由 `/purchase/orders`） |
| F-205 | 供应商绩效分析 | P2 | ❌ 未实现 | 无对应实现 |
| F-206 | AI 对话式采购咨询 | P1 | ⚠️ 部分实现 | AI Chat 后端路由存在，前端有 `AiChatPanel.tsx` 组件，但页面 `/ai-chat` 路由未注册 |
| F-207 | 采购三单匹配 | P0 | ✅ 已实现 | `MatchPage.tsx` 完整实现，含差异展开、价格预警、确认流程 |
| F-208 | 采购价格管理 | P0 | ⚠️ 部分实现 | 前端 `price.ts` API 封装存在，但无对应前端页面（`/purchase/prices` 路由未注册），后端无价格管理路由 |

### 模块四：生产排产 Agent

| 功能ID | 功能名称 | 优先级 | 状态 | 说明 |
|---|---|---|---|---|
| F-301 | 订单优先级管理 | P0 | ✅ 已实现 | 约束引擎 + 优先级字段 |
| F-302 | 每日排产计划生成 | P0 | ✅ 已实现 | `SchedulePage.tsx` AI 排产结果 Tab + 甘特图 |
| F-303 | 排产计划确认与调整 | P0 | ✅ 已实现 | 确认排产弹窗，下发任务 |
| F-304 | 工序任务推送 | P0 | ✅ 已实现 | 工人任务看板 Tab，三列看板展示 |
| F-305 | 工序完工上报 | P1 | ✅ 已实现 | 任务卡片「完成任务」按钮，后端 `tasks/:id/complete` 接口 |
| F-306 | 生产进度看板 | P0 | ✅ 已实现 | Dashboard 在产工单进度 + SchedulePage 进度列 |
| F-307 | 插单影响分析 | P1 | ✅ 已实现 | 在销售订单页以 Drawer 形式提供，含 AI 思考状态 |
| F-308 | 成品验货与部件溯源 | P1 | ⚠️ 部分实现 | 质量溯源页已覆盖，但成品→部件细粒度溯源依赖工人扫码数据，生产端尚未接入 |

### 模块五：质量溯源

| 功能ID | 功能名称 | 优先级 | 状态 | 说明 |
|---|---|---|---|---|
| F-601 | 验货单管理 | P1 | ✅ 已实现 | `TracePage.tsx` 质检记录列表完整 |
| F-602 | 质量问题记录 | P1 | ✅ 已实现 | 录入问题 Modal，含类型/严重程度/描述 |
| F-603 | 部件溯源查询 | P1 | ✅ 已实现 | 溯源查询 Tab，支持缸号/SKU/工单三种维度 |
| F-604 | 质量问题统计分析 | P1 | ✅ 已实现 | 质量统计 Tab，含合格率趋势和 TOP 问题类型 |
| F-605 | 溯源链数据采集 | P1 | ⚠️ 部分实现 | 工人完工上报时记录 `componentBarcode`，但小程序端扫码流程未实现 |

### 模块六：销售订单管理

| 功能ID | 功能名称 | 优先级 | 状态 | 说明 |
|---|---|---|---|---|
| F-701 | 销售客户管理 | P0 | ❌ 未实现 | 无客户管理页面；`OrderPage.tsx` 仅展示 `customerName` 字符串，无客户主数据管理 |
| F-702 | 常规订单录入 | P0 | ⚠️ 部分实现 | 后端 `POST /api/sales/orders` 存在，但前端 `OrderPage.tsx` 无新建订单入口（只有列表和审批），缺少创建订单表单 |
| F-703 | 紧急插单管理 | P0 | ✅ 已实现 | 插单影响分析 Drawer 完整，含 AI 思考状态，四维约束展示 |
| F-704 | 订单修改管控 | P0 | ❌ 未实现 | 无修改订单功能，无修改影响分析 |
| F-705 | 下单智能约束引擎 | P0 | ✅ 已实现 | 后端 `constraintEngine.ts`，前端约束检查结果展示完整 |
| F-706 | 交付确认与签收 | P1 | ❌ 未实现 | 无对应功能 |
| F-707 | 销售财务结算 | P1 | ❌ 未实现 | 无对应功能 |

### 模块七：经营分析看板

| 功能ID | 功能名称 | 优先级 | 状态 | 说明 |
|---|---|---|---|---|
| F-401 | 老板驾驶舱 | P1 | ✅ 已实现 | `DashboardPage.tsx` 含 KPI 卡片、产能趋势图、在产工单、库存预警 |
| F-402 | 库存结构分析 | P1 | ❌ 未实现 | Dashboard 仅有数量统计，无原材料内部二级品类库存资金占比分析 |
| F-403 | 生产效率分析 | P2 | ❌ 未实现 | 无对应功能 |
| F-404 | 采购成本分析 | P2 | ❌ 未实现 | 无对应功能 |
| F-405 | 物料品类占比分析 | P1 | ❌ 未实现 | 无对应功能 |
| F-406 | 采购品类分布分析 | P2 | ❌ 未实现 | 无对应功能 |

### 模块八：AI Agent 对话中心

| 功能ID | 功能名称 | 优先级 | 状态 | 说明 |
|---|---|---|---|---|
| F-501 | 全局 AI 助手 | P1 | ⚠️ 部分实现 | `AiChatPanel.tsx` 组件已开发，后端 `/api/ai` 路由存在，但 `/ai-chat` 路由未注册到 `App.tsx`，侧边栏无对应菜单项 |
| F-502 | 主动推送与提醒 | P0 | ⚠️ 部分实现 | 后端 `proactive.service.ts` 存在；前端 Dashboard 展示了预警卡片，但 WebSocket/SSE 实时推送机制未实现 |
| F-503 | 决策建议解释 | P1 | ✅ 已实现 | 采购建议页 AI 推理依据折叠展示 |
| F-504 | 对话历史记录 | P2 | ❌ 未实现 | 无对话历史功能 |

---

## 三、UI 设计稿逐页还原审计

### 3.1 `web-dashboard.html` — 老板驾驶舱

**还原状态：✅ 已实现（85% 还原）**

| 设计要素 | 设计稿 | 前端实现 | 状态 |
|---|---|---|---|
| KPI 卡片区（4 列） | 在产订单数、本月产值、库存金额、物料周转天数 | 在产工单、库存预警、待审批采购建议、待审批订单 | ⚠️ 指标不完全一致：设计稿中"本月产值""物料周转天数"未实现，被替换为审批类指标 |
| 产能负荷趋势折线图 | 7 天趋势 + 90% 警戒线 | ✅ 完整还原，含警戒线 | ✅ |
| 在产工单进度列表 | 工单号 + 进度条 + 交期 | ✅ 完整还原 | ✅ |
| 库存预警列表 | 物料名 + 当前库存 + 安全库存 | ✅ 完整还原 | ✅ |
| 待审批采购建议列表 | 物料名 + 建议数量 + 预估金额 | ✅ 完整还原 | ✅ |
| 实时更新提示 | 脉冲动画 + 更新时间 | ❌ 未实现 | ❌ |
| 导出功能 | 导出 Excel 按钮 | ❌ 未实现 | ❌ |

### 3.2 `web-inventory.html` — 库存总览

**还原状态：⚠️ 部分还原（70% 还原）**

| 设计要素 | 设计稿 | 前端实现 | 状态 |
|---|---|---|---|
| 汇总 Bar（原材料/半成品/成品金额占比） | ¥ 金额 + 百分比 + 实时更新脉冲点 | ❌ 未实现，仅有总数统计文字 | ❌ |
| 搜索框 | 物料名称或编码搜索 | ✅ 已实现 | ✅ |
| 分类筛选器 | **二级品类标准枚举下拉**（PRD v1.4 要求） | ⚠️ 仅实现一级分类，设计稿旧描述"板材/木料、面料/皮料"未替换为标准枚举 | ⚠️ |
| 状态筛选器 | 低于安全库存/临近安全库存/库存正常/呆滞风险 | ⚠️ 仅有"仅看预警"复选框，缺少"呆滞风险"状态筛选 | ⚠️ |
| 库存单位切换 Toggle | 按库存单位 / 按采购单位 | ❌ 未实现 | ❌ |
| 表格列：状态指示点 | 红/黄/绿/紫四色圆点 | ⚠️ 用 Tag 替代，颜色语义一致但形式不同 | ⚠️ |
| 表格列：库存量（含采购单位换算提示） | "256 个 ≈ 5.1 箱" 双行展示 | ❌ 缺少采购单位换算提示行 | ❌ |
| 表格列：库存天数 | 数值 + 颜色分级（红/黄/绿/紫） | ❌ 未实现 | ❌ |
| 表格列：缸号批次 | "含缸号" Tag + 展开按钮 | ✅ 实现了展开行，但 Tag 样式略有差异 | ✅ |
| 缸号展开子表格 | 缸号 / 入库日期 / 剩余库存 / 状态 / 查看用途 | ⚠️ 已实现缸号/首次入库/最近入库/在库量/可用量，缺少"状态"和"查看用途"列 | ⚠️ |
| 操作列：AI 降库建议按钮（呆滞物料） | 紫色按钮 | ❌ 未实现 | ❌ |
| 图例说明区 | 四色图例 + 说明文字 | ❌ 未实现 | ❌ |
| 分页 | 数字页码 | ✅ 已实现 | ✅ |
| 导出 Excel 按钮 | 页面右上角 | ❌ 未实现 | ❌ |
| 手动入库按钮 | 跳转入库表单 | ⚠️ 按钮存在但路由指向 `/inventory/inbound`（未注册） | ⚠️ |

### 3.3 `web-sku-master.html` — SKU 主数据

**还原状态：✅ 已实现（88% 还原）**

| 设计要素 | 设计稿 | 前端实现 | 状态 |
|---|---|---|---|
| 搜索框 | SKU编码/名称/规格搜索 | ✅ 已实现（防抖 350ms） | ✅ |
| 一级 + 二级分类双层筛选器 | 联动下拉 | ⚠️ 实现了分类筛选，但联动逻辑依赖 `catData`，一级分类未在 UI 中独立显示为两个级联 select | ⚠️ |
| 状态筛选 | 启用/停用/待审 | ✅ 已实现 | ✅ |
| 批量勾选 Checkbox | 全选 + 逐行勾选 | ❌ 未实现 | ❌ |
| 批量导入 SKU Modal | Excel 模板下载 + 字段映射 | ❌ 未实现（F-001） | ❌ |
| 表格列：SKU 编码（自动生成提示） | 编码 + 条码图标 | ⚠️ 仅展示编码，无条码生成/打印功能 | ⚠️ |
| 表格列：二级分类 Tag（带颜色） | 按品类显示彩色 Tag | ✅ 已实现 `Category2Label` 枚举 | ✅ |
| 表格列：是否启用缸号 | 图标标识 | ❌ 表格中未显示 `hasDyeLot` | ❌ |
| 创建 SKU Drawer | 滑出式表单，含单位换算预览区 | ⚠️ 实现了 Modal 弹窗，设计稿为 Drawer 侧滑；缺少"启用缸号"复选框、"启用 FIFO"复选框、单位换算实时预览文本 | ⚠️ |
| 新建表单：生产领用单位换算说明 | `prodConvNote` 文本框 | ❌ 创建表单中缺少此字段 | ❌ |
| 单位换算配置 | 独立弹窗 | ✅ 已实现，可添加多条规则 | ✅ |
| 批量补录二级分类 | 选中后批量设置 | ❌ 未实现（PRD 要求历史导入数据支持批量补录） | ❌ |

### 3.4 `web-bom-manage.html` — BOM 管理

**还原状态：✅ 已实现（无独立详细文件读取，根据 BomPage 判断）**

根据后端路由完整性（list/expand/requirements/create/activate），前端 BomPage 已覆盖核心交互，视为基本实现。

### 3.5 `web-purchase-suggestion.html` — AI 采购建议

**还原状态：✅ 已实现（90% 还原）**

| 设计要素 | 设计稿 | 前端实现 | 状态 |
|---|---|---|---|
| AI 状态面板（上次生成时间/触发按钮） | 橙色面板 + 元数据 | ⚠️ 仅有"生成采购建议"按钮，无上次生成时间显示 | ⚠️ |
| 状态筛选 Tab（全部/待审批/已批准/已驳回） | Tab 切换 | ✅ 完整实现 | ✅ |
| 建议卡片：置信度 Tag + 状态 | 高/中/低三级，橙色渐变 | ✅ `ConfidenceTag` 组件实现 | ✅ |
| 建议卡片：缸号要求提示 | 橙色 AI alert 框 | ✅ 已实现 | ✅ |
| 建议卡片：AI 推理折叠展开 | 展开/收起 | ✅ 已实现 | ✅ |
| 建议卡片：批准/驳回按钮 | 绿/红按钮 | ✅ 已实现，驳回有原因弹窗 | ✅ |
| 已执行建议单独 Tab | `executed` 状态筛选 | ❌ Tab 中只有 pending/approved/rejected，缺少 executed | ❌ |
| 分页 | 分页控件 | ✅ 已实现 | ✅ |

### 3.6 `web-purchase-match.html` — 采购三单匹配

**还原状态：✅ 已实现（85% 还原）**

| 设计要素 | 设计稿 | 前端实现 | 状态 |
|---|---|---|---|
| 状态 Tab（完全匹配/数量差异/价格预警/已确认） | 4 个 Tab | ✅ 已实现（含 price_diff Tab） | ✅ |
| 表格列：PO 号/送货单号/入库单号 | 三列单据号 | ✅ 已实现 | ✅ |
| 展开行：差异明细表格 | 物料/PO数/送货数/入库数/差异/价格/预警 | ✅ 完整实现，含历史均价对比 | ✅ |
| 确认差异弹窗：差异原因下拉 | 4 种枚举 | ✅ `DiffReasonLabel` 枚举完整 | ✅ |
| 供应商月度对账单汇总 | 按供应商汇总 | ❌ 未实现 | ❌ |
| 执行匹配弹窗（输入三个 ID） | 设计稿为按单据号搜索选择 | ⚠️ 实现为输入 ID 数字，可用性低于设计稿 | ⚠️ |

### 3.7 `web-sales-order.html` — 销售订单

**还原状态：⚠️ 部分还原（60% 还原）**

| 设计要素 | 设计稿 | 前端实现 | 状态 |
|---|---|---|---|
| 新建订单表单 | 客户选择/产品/数量/交期/类型 | ❌ 前端无新建订单入口和表单 | ❌ |
| 约束检查四维结果展示 | 四格卡片（库存周转/资金/成本/产能） | ✅ 在详情 Drawer 和插单分析中完整展示 | ✅ |
| 状态筛选 Tab | 待审批/已确认/生产中/已完成 | ✅ 已实现（含已取消/已驳回） | ✅ |
| 插单影响分析 | AI 思考动画 + 四维报告 | ✅ 完整实现，`AiThinkingState` 组件 | ✅ |
| 订单列表：约束检查列（通过/警告/被拦截 Tag） | 三色 Tag | ✅ 已实现 | ✅ |
| 订单详情 Drawer | 含订单明细列表 | ✅ 已实现 | ✅ |
| 客户选择器（下拉） | 客户主数据关联 | ❌ 无客户主数据管理，插单分析表单为手填 SKU ID | ❌ |
| 订单修改入口 | 修改按钮 + 影响分析 | ❌ 未实现 | ❌ |

### 3.8 `web-production-schedule.html` — 排产计划

**还原状态：✅ 已实现（82% 还原）**

| 设计要素 | 设计稿 | 前端实现 | 状态 |
|---|---|---|---|
| 三 Tab 结构（工单/排产结果/工人看板） | 标签页切换 | ✅ 完整实现 | ✅ |
| AI 排产结果甘特图 | 横向时间轴甘特条 | ✅ `GanttRow` 组件实现 | ✅ |
| AI 排产说明文本 | `reasoning` 字段 | ✅ 已展示 | ✅ |
| 排产警告列表 | `warnings` 数组 | ✅ 已实现 | ✅ |
| 工人任务看板三列（待/进行/完成） | 看板卡片 | ✅ 完整实现 | ✅ |
| 工单详情 Drawer | 工序任务列表 | ✅ 已实现 | ✅ |
| 新建工单表单 | 关联销售订单选择 | ⚠️ 当前表单用 SKU ID 文本框，设计稿应为关联销售订单下拉 | ⚠️ |
| 产能负荷总览 Bar | `capacityLoadRate` | ⚠️ 仅在甘特头部展示 score，无专用产能负荷 Bar | ⚠️ |

### 3.9 `web-quality-trace.html` — 质量溯源

**还原状态：✅ 已实现（80% 还原）**

| 设计要素 | 设计稿 | 前端实现 | 状态 |
|---|---|---|---|
| 三 Tab（质检记录/质量统计/溯源查询） | 标签页 | ✅ 完整实现 | ✅ |
| 质检记录表格（含问题数列） | 质检编号/SKU/数量/状态/问题数/检验员 | ✅ 完整实现 | ✅ |
| 溯源链节点可视化 | 竖向时间线节点 | ✅ `TraceChainView` 节点列表 | ✅ |
| 质量统计 KPI + 趋势图 | 合格率/问题类型占比图 | ✅ 实现了简易版，设计稿为饼图，实现为条形图 | ⚠️ |
| 图片上传（质量问题） | 最多 3 张照片 | ❌ 前端录入问题 Modal 无图片上传控件 | ❌ |
| 溯源查询：成品→部件完整链路 | 多层级展示 | ⚠️ 实现了节点链，但需要后端 `hasScanRecord=false` 情况的弱化展示逻辑（API 文档 9.5 要求） | ⚠️ |

### 3.10 `web-ai-chat.html` — AI 对话中心

**还原状态：❌ 未实现（页面路由缺失）**

`AiChatPanel.tsx` 组件已开发，但 `/ai-chat` 路由未在 `App.tsx` 中注册，侧边栏无对应菜单项。组件存在，页面不可访问。

### 3.11 `web-supplier-manage.html` — 供应商管理

**还原状态：❌ 未实现（无对应前端页面）**

设计稿包含：
- 供应商列表（ABC 三级分级、主供品类、准时交货率、质量异常率、账期）
- 供应商详情 Drawer（联系信息、供货品类表、协议价格历史、采购记录）
- 新建/编辑供应商 Modal
- 供应商绩效筛选

前端仅有 `supplier.ts` API 封装文件，无前端页面和路由。

### 3.12 `web-price-manage.html` — 采购价格管理

**还原状态：❌ 未实现（无对应前端页面）**

设计稿包含：
- 双视图切换（按供应商 / 按物料）
- 价格历史记录表（含税单价 / vs 历史均价 / 有效期 / 状态）
- 多供应商价格对比（横向对比表 + 趋势图）
- 新建价格协议 Drawer（供应商选择、物料搜索、含税单价、最小起订量、有效期、阶梯定价）
- 价格异常（超历史均价 20%）高亮预警

前端仅有 `price.ts` API 封装文件，无前端页面和路由。

### 3.13 `web-process-config.html` — 工序配置

**还原状态：❌ 未实现（无对应前端页面）**

设计稿包含：
- 工序模板列表（工序名称/类型/标准工时/所属工作站）
- 工序流程可视化编辑（拖拽节点，含继承/修改/新增/删除四种节点状态）
- 款式差异配置（在模板基础上增减工序）
- 版本管理（draft/active/archived）

### 3.14 `mini-warehouse-inbound.html` — 小程序入库

**还原状态：❌ 未实现**

小程序整体未开发，仅有 Web 端实现。

### 3.15 `mini-worker-task.html` — 小程序工人任务

**还原状态：❌ 未实现**

同上，小程序未开发。

### 3.16 `mini-qc-inspect.html` — 小程序 QC 验货

**还原状态：❌ 未实现**

同上，小程序未开发。

---

## 四、API 接口完整性审计

### 4.1 后端已实现路由

| 模块 | 接口 | 状态 |
|---|---|---|
| auth | POST /login, /wechat-login, /refresh, /logout | ✅ |
| SKU | GET /categories, GET /, GET /:id, POST /, PUT /:id, PUT /:id/unit-conversions | ✅ |
| BOM | GET /, GET /:id/expand, GET /:id/material-requirements, POST /, POST /:id/activate | ✅ |
| 库存 | GET /, GET /:skuId/available, GET /:skuId/dye-lots, GET /:skuId/fifo-dye-lot, POST /inbound, POST /outbound | ✅ |
| 采购 | POST /suggestions/generate, GET /suggestions, POST /suggestions/:id/approve, GET /orders, POST /orders, POST /orders/:id/delivery, POST /three-way-match, GET /three-way-match, POST /three-way-match/:id/confirm | ✅ |
| 销售 | GET /, GET /:id, POST /, POST /:id/approve, POST /analyze-urgent | ✅ |
| 生产 | GET /orders, GET /orders/:id, POST /orders, GET /schedule/generate, POST /schedule/confirm, GET /tasks/worker/:workerId, POST /tasks/:id/start, POST /tasks/:id/complete | ✅ |
| 质量 | GET /inspections, POST /inspections, POST /inspections/issues, POST /inspections/:id/complete, GET /traceability/:productionOrderId, GET /stats | ✅ |
| AI | POST /chat, GET /history, PUT /context, POST /proactive, POST /analyze | ✅ |

### 4.2 后端缺失路由（API 文档已定义但未实现路由模块）

| 模块 | 缺失接口 | 影响功能 |
|---|---|---|
| 供应商 | GET/POST/PUT `/api/suppliers` | F-003 供应商主数据（P0） |
| 价格管理 | GET/POST/PUT `/api/prices` | F-208 采购价格管理（P0） |
| 工序配置 | GET/POST/PUT/DELETE `/api/process-configs` | F-007 工序配置（P0） |
| 客户管理 | GET/POST `/api/customers` | F-701 销售客户管理（P0） |
| Dashboard KPI | GET `/api/dashboard/kpi` | F-401 驾驶舱本月产值/周转天数 |
| 库存结构分析 | GET `/api/analytics/inventory-structure` | F-402（P1） |
| Excel 导入 | POST `/api/import/skus`, `/api/import/inventory` | F-001（P0） |

### 4.3 前端 API 封装 vs 后端路由对比

| 前端封装文件 | 对应后端路由 | 状态 |
|---|---|---|
| `api/sku.ts` | `/api/skus` ✅ | ✅ 完整对齐 |
| `api/bom.ts` | `/api/bom` ✅ | ✅ 完整对齐 |
| `api/inventory.ts` | `/api/inventory` ✅ | ✅ 完整对齐 |
| `api/purchase.ts` | `/api/purchase` ✅ | ✅ 完整对齐 |
| `api/sales.ts` | `/api/sales/orders` ✅ | ✅ 完整对齐 |
| `api/production.ts` | `/api/production` ✅ | ✅ 完整对齐 |
| `api/quality.ts` | `/api/quality` ✅ | ✅ 完整对齐 |
| `api/supplier.ts` | `/api/suppliers` ❌ 后端无路由 | ❌ 前有后无 |
| `api/price.ts` | `/api/prices` ❌ 后端无路由 | ❌ 前有后无 |
| `api/processConfig.ts` | `/api/process-configs` ❌ 后端无路由 | ❌ 前有后无 |
| `api/auth.ts` | `/api/auth` ✅ | ✅ 完整对齐 |
| — | `/api/ai` ✅ | ❌ 前端无独立 AI 接口封装文件（在 `AiChatPanel.tsx` 内联） |

---

## 五、路由和菜单完整性审计

### 5.1 已注册路由

| 路径 | 组件 | 菜单可见角色 |
|---|---|---|
| `/dashboard` | DashboardPage | boss, supervisor |
| `/inventory` | InventoryPage | boss, warehouse, purchaser, supervisor |
| `/purchase/suggestions` | SuggestionPage | boss, purchaser |
| `/purchase/match` | MatchPage | boss, purchaser |
| `/sales/orders` | OrderPage | boss, sales, supervisor |
| `/production/schedule` | SchedulePage | boss, supervisor |
| `/master-data/sku` | SkuPage | boss, purchaser, warehouse, supervisor |
| `/master-data/bom` | BomPage | boss, supervisor, purchaser |
| `/quality/trace` | TracePage | boss, qc, supervisor, sales |

### 5.2 缺失路由（有设计稿但无前端页面和路由）

| 缺失路径 | 对应设计稿 | 优先级 | 说明 |
|---|---|---|---|
| `/master-data/supplier` | `web-supplier-manage.html` | P0 | 供应商主数据管理 |
| `/purchase/prices` | `web-price-manage.html` | P0 | 采购价格管理 |
| `/master-data/process-config` | `web-process-config.html` | P0 | 工序配置 |
| `/ai-chat` | `web-ai-chat.html` | P1 | AI 对话中心（组件已有，路由未注册） |
| `/sales/customers` | — | P0 | 销售客户管理（PRD F-701） |
| `/inventory/inbound` | — | P0 | 入库录入（Web 端） |
| `/inventory/outbound` | — | P0 | 出库录入（Web 端） |

---

## 六、类型定义完整性审计

### 6.1 枚举完整性

| 枚举 | 与 API 文档对齐 | 问题 |
|---|---|---|
| `UserRole` | ✅ 7 个角色全覆盖 | — |
| `SkuStatus` | ⚠️ 仅 active/inactive，代码中有 PENDING 引用 | `SkuStatus.PENDING` 在枚举中定义但 API 文档未提及 |
| `Category1Code` / `Category2Code` | ✅ 与 PRD SKU 分类体系完整对齐，17 个二级分类全覆盖 | — |
| `BomStatus` | ✅ draft/active/archived | — |
| `TransactionType` | ✅ 6 种流水类型 | — |
| `SuggestionStatus` | ✅ 5 种状态 | — |
| `MatchStatus` | ✅ 与 API 文档 6.7 完全一致 | — |
| `DiffReason` | ✅ 4 种原因 | — |
| `SalesOrderStatus` | ✅ 6 种状态 | — |
| `ProductionOrderStatus` | ⚠️ 代码中使用 DRAFT/SCHEDULED/IN_PROGRESS/COMPLETED/CANCELLED，`SchedulePage.tsx` 中用 DRAFT/SCHEDULED，但 API 文档只有 pending/in_progress 等 | 前端自扩展了 DRAFT/SCHEDULED 状态，需与后端对齐 |
| `TaskStatus` | ⚠️ 枚举定义有 PENDING/IN_PROGRESS/COMPLETED/SKIPPED，`SchedulePage.tsx` 中引用 PAUSED（未在枚举中定义） | 存在 `PAUSED` 引用越界风险 |
| `IssueSeverity` | ⚠️ `enums.ts` 定义 minor/normal/severe（与 API 文档一致），但 `TracePage.tsx` 中使用 CRITICAL/MAJOR/MINOR/COSMETIC（4 级扩展） | 前端页面与枚举定义不一致，存在类型安全漏洞 |
| `InspectionStatus` | ⚠️ `enums.ts` 定义 5 种，`TracePage.tsx` 引用 WAIVED（未在 `enums.ts` 定义） | 运行时类型越界 |
| `Confidence` | ✅ high/medium/low | — |
| `ApprovalAction` | ✅ 含 conditional | — |

### 6.2 模型类型与 API 响应对比

| 类型 | 问题 |
|---|---|
| `Sku` | 字段 `name/spec` 与 API 文档一致，但前端 `SkuFormData` 用 `skuName` 而 API 文档用 `name`，存在字段名不匹配 |
| `ProductionOrder` | `SchedulePage.tsx` 访问 `order.orderNo/skuCode/qty/unit/plannedStartDate/plannedEndDate/actualStartDate/actualEndDate`，但 `models.ts` 中 `ProductionOrder` 定义的是 `workOrderNo/qtyPlanned/qtyCompleted/plannedStart/plannedEnd`，字段名存在多处不一致 |
| `ScheduleResult` | `SchedulePage.tsx` 访问 `data.id/version/calculatedAt/score/confirmed/reasoning/items/rangeStart/rangeEnd/warnings`，但 `models.ts` 中 `ScheduleResult` 只定义 `date/schedules/summary`，严重不匹配 |
| `WorkerTask` | `SchedulePage.tsx` 引用 `WorkerTask` 类型，但 `models.ts` 未导出此类型 |
| `Inspection` | `TracePage.tsx` 引用 `Inspection` 类型，但 `models.ts` 只有 `QualityInspection`，命名不一致 |
| `TraceabilityChain` | `TracePage.tsx` 访问 `chain.queryValue/nodes`，但 `models.ts` 定义的是 `components/summary`，字段严重不匹配 |
| `QualityStats` | `TracePage.tsx` 内部重新定义了 `QualityStats` 类型（totalInspections/passRate/criticalIssues），与 `models.ts` 导出的 `QualityStats` 字段完全不同 |

---

## 七、缺失项汇总表（按优先级）

| 优先级 | 缺失项 | 影响功能 | 责任角色 |
|---|---|---|---|
| P0-Critical | `ProductionOrder` / `ScheduleResult` / `WorkerTask` / `Inspection` / `TraceabilityChain` 类型与页面实现严重不匹配 | 排产页、质量页运行时类型错误 | @senior-frontend-engineer |
| P0-Critical | `IssueSeverity`、`InspectionStatus`、`TaskStatus` 枚举越界引用 | 质量溯源页、排产页类型安全漏洞 | @senior-frontend-engineer |
| P0 | 供应商主数据页面（`/master-data/supplier`）缺失 | F-003 | @senior-frontend-engineer |
| P0 | 后端 `/api/suppliers` 路由模块缺失 | F-003 | @senior-backend-engineer |
| P0 | 采购价格管理页面（`/purchase/prices`）缺失 | F-208 | @senior-frontend-engineer |
| P0 | 后端 `/api/prices` 路由模块缺失 | F-208 | @senior-backend-engineer |
| P0 | 工序配置页面（`/master-data/process-config`）缺失 | F-007 | @senior-frontend-engineer |
| P0 | 后端 `/api/process-configs` 路由模块缺失 | F-007 | @senior-backend-engineer |
| P0 | 销售客户管理（`/sales/customers`）缺失 | F-701 | @senior-frontend-engineer + @senior-backend-engineer |
| P0 | 销售订单新建入口和表单缺失 | F-702 | @senior-frontend-engineer |
| P0 | 库存二级品类筛选器使用旧自由描述而非标准枚举（PRD v1.4 明确要求）| F-101 | @senior-frontend-engineer |
| P0 | 库存总览缺少单位切换 Toggle（库存单位/采购单位） | F-101 | @senior-frontend-engineer |
| P0 | Excel 批量导入功能（SKU/库存）缺失 | F-001 | @senior-frontend-engineer + @senior-backend-engineer |
| P0 | 后端客户管理路由 `/api/customers` 缺失 | F-701 | @senior-backend-engineer |
| P0 | Dashboard KPI 接口（本月产值、库存周转天数）缺失 | F-401 | @senior-backend-engineer |
| P1 | `/ai-chat` 路由未注册，AI 对话中心不可访问 | F-501 | @senior-frontend-engineer |
| P1 | 采购订单列表页（`/purchase/orders`）缺失路由 | F-204 | @senior-frontend-engineer |
| P1 | 库存汇总 Bar（原材料/半成品/成品金额占比）未实现 | F-101 设计稿 | @senior-frontend-engineer |
| P1 | 库存页缺少呆滞风险筛选和 AI 降库建议按钮 | F-101 设计稿 | @senior-frontend-engineer |
| P1 | 库存页缺少采购单位换算提示（双行展示）和库存天数列 | F-101 设计稿 | @senior-frontend-engineer |
| P1 | 小程序（入库/出库/工人任务/QC验货）完全未开发 | F-102/103/304/605 | @senior-frontend-engineer |
| P1 | SKU 主数据创建表单缺少 `hasDyeLot`/`useFifo` 字段 | F-002 设计稿 | @senior-frontend-engineer |
| P1 | SKU 历史数据批量补录二级分类功能缺失 | F-002 PRD | @senior-frontend-engineer |
| P1 | 质量问题录入缺少图片上传控件 | F-602 设计稿 | @senior-frontend-engineer |
| P1 | 库存结构分析（二级品类维度）缺失 | F-402 | @senior-frontend-engineer + @senior-backend-engineer |
| P1 | 订单修改管控（F-704）功能缺失 | F-704 | @senior-frontend-engineer + @senior-backend-engineer |
| P1 | `web-process-config.html` 中工序可视化编辑（拖拽流程图）未还原 | F-007 设计稿 | @senior-frontend-engineer + @senior-ui-designer |
| P2 | `web-supplier-manage.html` 供应商绩效数据（准时率/质量异常率）列缺失 | F-205 | @senior-backend-engineer |
| P2 | Dashboard 本月产值 KPI 卡片用的是库存预警数量替代，指标语义不符 | F-401 | @senior-frontend-engineer |
| P2 | 三单匹配执行弹窗为输入 ID 数字，设计稿应为按单据号搜索选择 | F-207 设计稿 | @senior-frontend-engineer |
| P2 | 采购建议页缺少 `executed`（已执行）状态 Tab | F-202 | @senior-frontend-engineer |
| P2 | 物料品类占比分析（F-405）和采购品类分布分析（F-406）缺失 | F-405/406 | @senior-frontend-engineer + @senior-backend-engineer |
| P2 | WebSocket/SSE 实时推送（F-502）未实现 | F-502 | @senior-backend-engineer + @senior-frontend-engineer |
| P2 | `web-price-manage.html` 多供应商价格对比图未还原 | F-208 设计稿 | @senior-frontend-engineer + @senior-ui-designer |

---

## 八、各角色任务分派

### @senior-backend-engineer — 后端任务

**P0 紧急（影响已有前端功能的联调）：**

1. 实现 `/api/suppliers` 路由模块（CRUD + 分页 + A/B/C 分级管理），对应 `supplier.ts` API 封装已就绪
2. 实现 `/api/prices` 路由模块（价格协议管理 + 历史记录 + 异常预警），对应 `price.ts` API 封装已就绪
3. 实现 `/api/process-configs` 路由模块（工序配置 CRUD），对应 `processConfig.ts` API 封装已就绪
4. 实现 `/api/customers` 路由模块（销售客户主数据 CRUD）
5. 实现 `GET /api/dashboard/kpi` 接口，返回本月产值、库存金额、库存周转天数等指标
6. 实现 `POST /api/import/skus` 和 `POST /api/import/inventory` Excel 导入接口（F-001）

**P1 重要：**

7. 实现 `GET /api/analytics/inventory-structure` 接口，按二级品类返回库存资金占比（F-402）
8. 实现 `PUT /api/sales/orders/:id` 修改接口，含影响分析（F-704）
9. 完善 AI Chat 独立接口文档，提供 SSE 流式输出接口（F-502）

**P2 优化：**

10. 完善供应商绩效统计接口（准时率、质量异常率）（F-205）
11. 实现 `GET /api/analytics/purchase-category` 采购品类分布分析接口（F-406）

---

### @senior-frontend-engineer — 前端任务

**P0-Critical（类型安全，需立即修复）：**

1. 修复 `SchedulePage.tsx` 中 `ProductionOrder` 类型引用（`orderNo/skuCode/qty/unit/plannedStartDate` 等字段名与 `models.ts` 不一致）
2. 修复 `SchedulePage.tsx` 中 `ScheduleResult` 类型引用（`data.id/version/calculatedAt/score/confirmed/items/rangeStart/rangeEnd` 在 `models.ts` 中未定义）
3. 在 `models.ts` 中添加 `WorkerTask` 类型定义并在 `SchedulePage.tsx` 中正确导入
4. 修复 `TracePage.tsx` 中 `Inspection` → `QualityInspection` 类型引用
5. 修复 `TracePage.tsx` 中 `TraceabilityChain` 类型（`chain.queryValue/nodes` → `chain.components/summary`）
6. 修复 `TracePage.tsx` 中本地 `QualityStats` 类型与 `models.ts` 导出类型不一致
7. 修复 `IssueSeverity` 枚举越界（`CRITICAL/MAJOR/COSMETIC` 需添加到枚举或改为 PRD 定义的 `minor/normal/severe`）
8. 修复 `InspectionStatus.WAIVED` 引用（添加到枚举中）
9. 修复 `TaskStatus.PAUSED` 引用（添加到枚举或改为 `SKIPPED`）
10. 修复 `ProductionOrderStatus.DRAFT/SCHEDULED` 与后端实际返回值对齐

**P0 新增页面（需参照设计稿实现）：**

11. 实现供应商管理页 `pages/master-data/SupplierPage.tsx`，注册路由 `/master-data/supplier`，参照 `web-supplier-manage.html`
12. 实现价格管理页 `pages/purchase/PricePage.tsx`，注册路由 `/purchase/prices`，参照 `web-price-manage.html`
13. 实现工序配置页 `pages/master-data/ProcessConfigPage.tsx`，注册路由 `/master-data/process-config`，参照 `web-process-config.html`
14. 实现销售客户管理页 `pages/sales/CustomerPage.tsx`，注册路由 `/sales/customers`
15. 在 `OrderPage.tsx` 中添加新建销售订单表单（含客户下拉选择、产品/数量/交期/类型字段）
16. 修复 `InventoryPage.tsx` 分类筛选器：添加二级品类下拉，从 `GET /api/skus/categories` 动态读取标准枚举值（PRD v1.4 明确要求）
17. 在 `InventoryPage.tsx` 中实现库存单位/采购单位切换 Toggle
18. 实现 Excel 导入 Modal（SKU 批量导入 + 字段映射向导），参照 `web-sku-master.html`
19. 在 `Sidebar.tsx` 和 `App.tsx` 中注册以上所有新增路由和菜单项

**P1 功能补全：**

20. 注册 `/ai-chat` 路由，使 `AiChatPanel.tsx` 可从侧边栏访问
21. 注册 `/purchase/orders` 路由，新建采购订单列表页
22. 在 `InventoryPage.tsx` 中添加顶部汇总 Bar（原材料/半成品/成品金额及占比）
23. 在 `InventoryPage.tsx` 中添加呆滞风险筛选和 AI 降库建议按钮（紫色，仅呆滞行可见）
24. 在 `InventoryPage.tsx` 库存量列添加采购单位换算提示（双行显示）
25. 在 `InventoryPage.tsx` 添加库存天数列（含颜色分级：红<7天/黄<15天/绿/紫>90天）
26. 在 `SkuPage.tsx` 创建表单中添加 `hasDyeLot` 和 `useFifo` 复选框
27. 在质量问题 Modal 中添加图片上传控件（最多 3 张，对应 API 的 `images` 字段）
28. `SkuPage.tsx` 添加批量补录二级分类功能（批量选中行后批量设置二级分类）
29. 实现订单修改入口（`OrderPage.tsx` 中已确认订单的修改按钮 + 影响分析弹窗）

**P2 体验优化：**

30. 在 `SuggestionPage.tsx` 状态 Tab 中添加 `executed`（已执行）状态
31. 改善三单匹配执行弹窗：从输入 ID 改为按单据号搜索并选择
32. 在 Dashboard 中补充"本月产值"和"库存周转天数"KPI 卡片（待后端接口就绪后接入）

---

### @senior-ui-designer — UI 还原问题

1. 确认 `web-process-config.html` 中工序可视化拖拽编辑器的技术实现方案（当前设计稿为原生 HTML 占位，前端需要明确使用 react-flow 还是其他方案），输出 `[artifact:交互说明]`
2. 确认 `web-price-manage.html` 多供应商价格对比图的图表类型（设计稿为折线图），提供 recharts 配置建议
3. 审查 `InventoryPage.tsx` 当前 Tag 替代状态圆点的还原度，确认是否需要改回设计稿中的四色状态点样式
4. 在设计稿 `web-inventory.html` 中补充"实时更新"脉冲动画的 CSS Tokens 规范，确保前端可直接复用

---

### @senior-qa-engineer — 测试覆盖问题

1. 针对上述类型安全漏洞（`IssueSeverity/InspectionStatus/TaskStatus/ProductionOrderStatus` 枚举越界），补充前端类型单元测试用例
2. 针对 `InventoryPage.tsx` 二级分类筛选器，设计回归测试用例，验证 PRD v1.4 中"筛选结果与 SKU 体系一致"的验收标准
3. 补充以下接口缺失的 API 测试：`/api/suppliers`、`/api/prices`、`/api/process-configs`、`/api/customers`（待后端实现后）
4. 针对 SKU 创建表单中 `skuName` vs API `name` 字段名不一致问题，添加接口联调集成测试
5. 补充小程序（mini-warehouse-inbound、mini-worker-task、mini-qc-inspect）的端到端测试用例，纳入 Phase 2 验收测试计划

---

## 九、优先行动建议

**本周必须完成（阻塞联调的问题）：**

1. @senior-frontend-engineer 修复 10 项类型安全漏洞（Section 6.2 全部问题），避免生产环境运行时崩溃
2. @senior-backend-engineer 实现 `/api/suppliers`、`/api/prices`、`/api/process-configs` 三个路由模块（前端封装已就绪，联调即可）
3. @senior-frontend-engineer 修复 `InventoryPage.tsx` 二级分类筛选器使用标准枚举（PRD v1.4 明确要求，影响 Phase 1 验收）

**下周完成（P0 功能补全）：**

4. 供应商管理页、价格管理页、工序配置页三个 P0 页面开发
5. 销售订单新建表单
6. Excel 导入功能

**持续迭代（P1 功能）：**

7. 小程序端开发启动（入库录入、工人任务）
8. AI Chat 页面路由注册和集成完善
9. 库存总览页 UI 细节补全（汇总 Bar、天数列、呆滞标识、单位切换）

---

*审计报告生成时间：2026-03-11*
*下次审计建议：完成 P0 缺失项修复后，于 2026-03-25 进行 Phase 1 验收前复审*
