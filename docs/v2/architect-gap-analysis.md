# 技术架构全面差距分析报告

**文档版本**：v1.0
**分析日期**：2026-03-14
**负责人**：@tech-lead-architect
**输入来源**：PRD v2.0（R-01~R-12）、PRD v1.4（F-001~F-707）、gap 分析报告（R-01~R-08）、UI 设计复盘报告、后端路由注册（app.ts）、数据库迁移脚本（10 个 SQL）、前端 API 文件（23 个）、前端页面文件（28 个）、后端 service 模块（26 个）

---

## 一、后端 API 完整性

### 1.1 已注册路由模块总览

根据 `services/api/src/app.ts` 的路由注册，当前后端已挂载 **21 个路由模块**：

| # | 路由前缀 | 模块 | 对应 PRD 功能 |
|---|---|---|---|
| 1 | /api/auth | auth | 登录认证 |
| 2 | /api/skus | sku | F-002 SKU 主数据 |
| 3 | /api/bom | bom | F-005 BOM 管理 + R-04 版本化 |
| 4 | /api/inventory | inventory | F-101~F-107 库存管理 |
| 5 | /api/purchase | purchase | F-201~F-208 采购流程 |
| 6 | /api/sales/orders | sales | F-701~F-707 销售约束引擎 |
| 7 | /api/production | production | F-301~F-308 生产排产 + R-06 任务管理 |
| 8 | /api/quality | quality | F-601~F-605 质量溯源 |
| 9 | /api/ai | ai | F-501~F-502 AI 对话 |
| 10 | /api/suppliers | supplier | F-003 供应商 + R-02 导出对比 |
| 11 | /api/prices | price | F-208 采购价格 + R-03 批量导入 |
| 12 | /api/process-configs | process-config | F-007 工序配置 + R-05 工价 |
| 13 | /api/customers | sales-customer | F-701 客户管理 + R-07 |
| 14 | /api/sales-orders | sales-order | R-08 销售订单 + 审批流 |
| 15 | /api/sku-categories | sku-category | R-01 类目自定义 |
| 16 | /api/reports/wages | report/wage | R-05 工资报表 |
| 17 | /api/analytics | analytics | F-401~F-406 经营分析 |
| 18 | /api/upload | upload | 文件上传 |
| 19 | /api/incoming-inspections | incoming-inspection | R-09 来料质检 |
| 20 | /api/return-orders | return-order | R-09 退货 |
| 21 | /api/mrp | mrp | R-11 物料需求计划 |
| 22 | /api/purchase-suggestions | purchase（子路由） | R-11 采购建议 |
| 23 | /api/schedule-suggestions | schedule-suggestion | R-12 智能调度 |

### 1.2 PRD 要求 vs 实际 API 缺口

| 缺失接口 | 对应需求 | 严重度 | 说明 |
|---|---|---|---|
| `GET /production-tasks/stats` | R-06 统计卡片 | **P0** | 后端无此聚合接口，前端用分页数据本地计算，数据失真 |
| `GET /sales-orders/capacity-check` | R-08 紧急插单产能评估 | **P0** | 设计稿+交互说明明确要求，后端完全未实现 |
| `GET /production-tasks/{id}/logs` | R-06 操作时间线 | **P1** | 任务详情抽屉所需的操作日志接口不存在 |
| `POST /production/tasks/:id/suspend` | R-06 挂起任务 | **P1** | 状态机缺少 suspended 状态处理 |
| `GET /customers/export` | R-07 客户导出 | **P1** | 前后端均未实现 |
| `GET /prices/import/:taskId/status` | R-03 导入进度轮询 | **P1** | 大批量导入场景无进度反馈 |
| 通知推送服务 | R-08 BD-003 | **P1** | 插单审批通知、驳回通知，后端无任何通知推送逻辑 |
| `comparePerformance` 字段扩展 | R-02 绩效对比 | **P1** | 接口仅返回 3 个字段，设计稿需要 9 个指标 |

### 1.3 已存在但存在问题的接口

| 接口 | 问题 | 严重度 |
|---|---|---|
| `POST /sales-orders/:id/reject` | 驳回后状态回退到 draft，设计稿要求为 closed | **P0** |
| `POST /production/tasks/:id/resolve-exception` | 恢复状态为 pending 而非 in_progress | **P1** |
| `POST /sales-orders/:id/confirm` | 权限为 boss+supervisor+sales，BD-003 要求仅 boss | **P0** |
| `GET /production/tasks` (listTasks) | 返回字段缺少 priority、actualHours、version | **P1** |
| `POST /sales/orders` vs `POST /sales-orders` | 两套 API 路径并存，职责重叠 | **P0** 架构问题 |

### 1.4 双轨 API 问题详解

项目中存在两对路由重叠：

**销售订单双轨**：
- `/api/sales/orders`（sales 模块）：约束引擎、插单分析、发货收货、财务结算
- `/api/sales-orders`（sales-order 模块）：订单 CRUD、状态机、审批工作流

app.ts 中已标注"两个模块均需保留，不做合并"。但前端存在 `sales.ts` 和 `salesOrder.ts` 两个 API 文件，`OrderPage.tsx` 调用 `/api/sales/orders`，`SalesOrderListPage.tsx` 调用 `/api/sales-orders`，React Query key 不同导致缓存不共享。

**客户管理双轨**：
- `/modules/customer/`（简版，4 字段，未挂载路由）
- `/modules/sales-customer/`（完整版，已挂载到 `/api/customers`）

简版模块已确认未挂载路由（app.ts 仅引用 sales-customer），但源码目录仍存在，应在后续清理 Sprint 中删除。

---

## 二、数据库 Schema 完整性

### 2.1 迁移脚本清单

已有 **10 个迁移脚本**，覆盖 Sprint 1~4：

| 文件 | 覆盖范围 |
|---|---|
| `V2_sprint1_r01_r05.sql` | R-01 sku_categories 增强 + R-05 工价字段 |
| `M20260312_sprint1_r02_r03.sql` | R-02 供应商导出 + R-03 价格导入 |
| `V2_sprint1_r06_task_exceptions.sql` | R-06 任务异常表 |
| `V2_sprint1_submit_count.sql` | 完工上报计数字段 |
| `V2_sprint1_work_calendar.sql` | 工作日历表 |
| `V2_sprint1b_r07_r08.sql` | R-07 客户+联系人 + R-08 销售订单增强 |
| `V2_sprint3_schema.sql` | R-09 来料质检 + R-10 生产链路 + R-11 采购闭环 |
| `V2_sprint4_schedule_tables.sql` | R-12 调度建议三张表 + 采购建议扩展 |
| `V2_schema_fixes.sql` | 综合修复脚本（幂等 ADD COLUMN） |
| `V2_p04_r06_gaps.sql` | R-06 gap 修复补丁 |

### 2.2 已创建的核心表

Sprint 3 新增表：
- `incoming_inspection_records` — 来料质检单
- `incoming_inspection_items` — 来料质检明细
- `return_orders` — 退货单（推测）
- `return_order_items` — 退货明细（推测）

Sprint 4 新增表：
- `schedule_suggestions` — 调度建议批次表
- `schedule_suggestion_items` — 调度建议明细表
- `suggestion_audit_logs` — 建议审计日志表

### 2.3 Schema 缺口

| 缺失/不完整 | 对应需求 | 严重度 | 说明 |
|---|---|---|---|
| `production_tasks.actual_hours` 字段 | R-06 完工上报实际工时 | **P0** | 工资核算依赖此字段，完工上报弹窗需要 |
| `production_tasks.version` 字段 | R-06 乐观锁 | **P1** | 双端并发操作冲突检测所需 |
| `users.skill_level` 字段 | BD-002 工人等级 | **P0** | 工价计算区分熟练工/学徒工 |
| `production_orders.bom_version_id` 字段 | BD-001 BOM 快照 | **P0** | 工单创建时锁定 BOM 版本 |
| task_operation_logs 表 | R-06 操作时间线 | **P1** | 任务详情抽屉所需 |
| 通知消息表 (notifications) | R-08 站内通知 | **P1** | 插单审批通知功能所需 |

> 注：部分字段可能已在 `V2_schema_fixes.sql` 或 `V2_p04_r06_gaps.sql` 中通过动态 ADD COLUMN 添加，需实际执行迁移后确认。

---

## 三、前端页面 vs 新设计稿差距

### 3.1 总体覆盖率

根据 UI 设计复盘报告，已有 HTML 设计稿 7 个，覆盖率仅 **26.9%**（7/26 页面）。P0 优先级需补设计稿的 5 个核心页面分析如下：

### 3.2 Dashboard（首页驾驶舱）— 无设计稿

**当前实现**：`DashboardPage.tsx` 存在，调用 `/api/analytics/dashboard-kpi` 获取 KPI 数据。

**PRD 要求（F-401 + F-502 + F-S4-012）**：
- KPI 卡片组（在产订单数、本月产值、库存金额、物料周转天数）
- 生产进度总览
- 库存预警列表
- AI 采购建议审批区（待审批徽章）
- 调度建议 Widget（Sprint 4 新增）
- 数据过期提示

**差距评估**：后端 analytics 模块已提供 6 个分析接口（dashboard-kpi、inventory-analysis、production-efficiency、purchase-cost、material-category-ratio、purchase-category），数据源基本完备。主要差距在前端布局和交互：无设计稿约束下，Widget 组件的排列、空态、数据过期提示等交互细节无法验证。

**建议**：P0 补设计稿，确保 Dashboard 数据卡片、预警列表、审批入口的布局和交互规范。

### 3.3 SKU 主数据 — 无设计稿

**当前实现**：`SkuPage.tsx` 存在，调用 `/api/skus` CRUD。

**PRD 要求（F-002 + F-006）**：
- 搜索筛选栏（含二级分类联动）
- 新增/编辑 Modal
- 批量导入入口
- 缸号管理抽屉
- 空态、骨架屏

**差距评估**：后端 SKU CRUD 接口完整，sku-category 接口也已就绪。前端功能基本可用，但缺少设计稿导致以下问题无法确认：
- 二级分类联动下拉的交互行为
- 缸号管理抽屉的展开方式和字段结构
- 批量导入入口是否存在

**建议**：P0 补设计稿。

### 3.4 BOM 管理 — 无设计稿

**当前实现**：`BomPage.tsx` 存在，后端 BOM 模块已支持版本化（activate、copy、list 含版本信息）。

**PRD 要求（F-005 + R-04）**：
- BOM 树形展开视图
- 版本切换标签（草稿/激活/历史）
- 通用件引用标识
- BOM 快速录入向导
- AI 辅助建议状态

**后端已实现接口**：
- `GET /api/bom/` — 列表（含版本）
- `POST /api/bom/` — 创建
- `POST /api/bom/:id/activate` — 激活版本
- `POST /api/bom/:id/copy` — 复制新版本
- `GET /api/bom/:id/expand` — 展开
- `GET /api/bom/ai-suggestion/:skuId` — AI 建议
- `GET /api/bom/:id/cost-breakdown` — 成本分析
- `GET /api/bom/:id/material-requirements` — 物料需求

**差距评估**：后端 API 较完整，R-04 核心功能（版本化、复制、激活、通用件引用）已有接口支撑。前端是否完整实现版本切换 Tab、通用件引用选择器等交互需进一步确认。

**建议**：P0 补设计稿，重点定义版本管理 Tab、通用件引用弹窗、录入向导的交互流程。

### 3.5 库存管理 — 无设计稿

**当前实现**：`InventoryPage.tsx` 存在。

**后端已实现接口**：
- `GET /api/inventory/` — 列表
- `GET /api/inventory/summary` — 汇总
- `GET /api/inventory/check` — 可用性检查
- `GET /api/inventory/:skuId/dye-lots` — 缸号批次
- `GET /api/inventory/:skuId/available` — 可用量
- `GET /api/inventory/:skuId/fifo-dye-lot` — FIFO 推荐
- `POST /api/inventory/inbound` — 入库
- `POST /api/inventory/outbound` — 出库
- `POST /api/inventory/waste` — 损耗
- `POST /api/inventory/stocktake` — 盘点
- `GET /api/inventory/export/csv` — 导出

**差距评估**：后端接口丰富，涵盖 F-101~F-107 全部功能。前端缺少设计稿约束，以下交互点不确定：
- 四色状态标记（红/黄/绿/蓝）
- 汇总统计行
- 二级分类筛选联动
- 缸号展开子表

**建议**：P0 补设计稿。

### 3.6 生产工单 — 无设计稿

**当前实现**：`ProductionOrderPage.tsx` 存在。

**后端已实现接口**：
- `GET /api/production/orders` — 工单列表
- `POST /api/production/orders` — 创建工单
- `POST /api/production/orders/from-sales-order/:salesOrderId` — 从销售订单创建
- `GET /api/production/orders/:id` — 工单详情
- `GET /api/production/orders/:id/materials` — 物料需求
- `GET /api/production/orders/:id/material-check` — 物料齐套检查
- `PUT /api/production/orders/:id/cancel` — 取消工单
- `GET /api/production/schedule/generate` — 生成排产
- `POST /api/production/schedule/confirm` — 确认排产

**差距评估**：后端具备完整的生产工单管理能力，含物料齐套检查（R-10 核心功能）。前端缺少设计稿导致以下交互不确定：
- 工单列表进度条展示
- BOM 展开状态区域
- 物料齐套状态指示器
- 工单详情侧边栏
- 状态机流转按钮

**建议**：P0 补设计稿。

---

## 四、前后端联调完整性

### 4.1 前端 API 文件覆盖

前端共 **23 个 API 文件**，与后端路由模块基本一一对应：

| 前端 API 文件 | 对应后端模块 | 联调状态 |
|---|---|---|
| auth.ts | auth | 已联调 |
| sku.ts | sku | 已联调 |
| bom.ts | bom | 已联调 |
| inventory.ts | inventory | 已联调 |
| purchase.ts | purchase | 已联调 |
| sales.ts | sales | 已联调（但存在双轨问题） |
| salesOrder.ts | sales-order | 已联调 |
| production.ts | production | 已联调 |
| productionTask.ts | production（子路由） | 已联调 |
| quality.ts | quality | 已联调 |
| supplier.ts | supplier | **部分联调**（导出未接入） |
| price.ts | price | 已联调 |
| processConfig.ts | process-config | 已联调 |
| customer.ts | sales-customer | 已联调 |
| skuCategory.ts | sku-category | 已联调 |
| wage.ts / wageReport.ts | report/wage | 已联调 |
| analytics.ts | analytics | 已联调 |
| incomingInspection.ts | incoming-inspection | 已联调 |
| returnOrder.ts | return-order | 已联调 |
| mrp.ts | mrp | 已联调 |
| purchaseSuggestion.ts | purchase（建议子路由） | 已联调 |
| scheduleSuggestion.ts | schedule-suggestion | 已联调 |

### 4.2 联调阻断问题

| 问题 | 严重度 | 说明 |
|---|---|---|
| OrderPage.tsx 使用硬编码 MOCK 数据 | **P0 阻断** | CUSTOMERS 和 PRODUCTS 为假数据，customerId/skuId 为假值，新建订单写入错误数据 |
| supplier.ts 缺少 exportSuppliers 函数 | **P1** | 后端导出接口已实现，前端 API 层未定义 |
| sales.ts vs salesOrder.ts 双轨 | **P0 架构** | 两个文件指向不同后端路径，React Query key 不同，缓存不共享 |
| 完工上报接口未传 actualHours | **P0** | 前端弹窗无此字段，后端也未接收 |
| 统计卡片（TaskPage + SalesOrderListPage） | **P0** | 均使用分页数据本地计算，非全库聚合统计 |

### 4.3 前端存在但无后端对应的调用

| 前端调用 | 后端状态 | 说明 |
|---|---|---|
| `usePendingApprovals()` (salesOrder.ts) | 后端已实现 `GET /pending-approvals` | 前端 Hook 已定义但页面未使用 |
| 产能检查 capacity-check | 后端未实现 | 前端无调用，后端无接口 |

---

## 五、业务链路完整性

### 5.1 链路一：销售 -> 生产 -> 报工 -> 交付（R-10）

```
销售订单创建 ─> 审批确认 ─> 生产工单创建 ─> BOM 展开 ─> 工序任务分配 ─>
工人报工 ─> 工序完工 ─> 成品完工 ─> 发货 ─> 交付确认
```

| 环节 | 后端 | 前端 | 状态 |
|---|---|---|---|
| 销售订单 CRUD | `/api/sales-orders` 完整 CRUD + 状态机 | SalesOrderListPage 已实现 | **基本可用** |
| 审批流程 | submit/confirm/reject/withdraw 均有 | 抽屉内操作按钮有，独立审批弹框缺失 | **部分可用** |
| 生产工单创建 | `POST /production/orders/from-sales-order/:id` 已实现 | SalesOrderListPage 有"触发建工单"按钮 | **可用** |
| BOM 展开 | `GET /bom/:id/expand` + bom-expansion.service 已实现 | BomPage 有展开视图 | **可用** |
| 工序任务分配 | scheduler.service 已实现 | SchedulePage 存在 | **可用** |
| 工人报工（Web） | `POST /production/tasks/:id/complete` 已实现 | TaskPage 有完工弹窗 | **部分可用**（缺 actualHours） |
| 工序完工 -> 半成品入库 | 需确认事件驱动是否实现 | — | **待确认** |
| 成品完工 | 需确认 | — | **待确认** |
| 发货 | `POST /sales-orders/:id/ship` 已实现 | SalesOrderListPage 有标记发货按钮 | **可用** |
| 交付确认 | `POST /sales-orders/:id/complete` 已实现 | 有完成按钮 | **可用** |

**链路评估**：核心路径（订单 -> 工单 -> 任务 -> 完工 -> 发货）的后端接口链基本打通。主要断点在：
1. 完工上报缺少实际工时字段，工资核算无法闭环
2. 工序完工 -> 半成品自动入库的事件驱动链路待确认
3. 审批弹框前端缺失，审批流程体验不完整

### 5.2 链路二：采购 -> 质检 -> 入库 -> 库存更新（R-09 + R-11）

```
采购建议生成 ─> 审批 ─> 采购订单 ─> 到货 ─> 来料质检 ─>
合格入库 / 不合格退货 ─> 库存数量更新
```

| 环节 | 后端 | 前端 | 状态 |
|---|---|---|---|
| 采购建议生成 | purchaseSuggestion 模块已实现 | PurchaseSuggestionPage 已实现 | **可用** |
| 审批 | purchase 模块已有审批接口 | SuggestionPage 已实现 | **可用** |
| 采购订单跟踪 | purchase 模块已实现 | — | **可用** |
| 来料质检 | incoming-inspection 模块已实现（Sprint 3 新增） | IncomingInspectionPage 已实现 | **可用** |
| 合格 -> 入库 | inspection 表有 receipt_triggered 标记 | — | **待确认事件链** |
| 不合格 -> 退货 | return-order 模块已实现 + return_triggered 标记 | ReturnOrderPage 已实现 | **可用** |
| 库存数量更新 | inventory 模块 inbound 接口已实现 | — | **待确认自动触发** |
| 三单匹配 | purchase 模块（推测已实现） | MatchPage 已实现 | **可用** |

**链路评估**：Sprint 3 迁移脚本和后端模块已基本支撑完整采购链路。关键待确认点：
1. 质检通过后是否自动触发入库事件（`events` 模块已存在）
2. 退货后采购订单状态回滚是否自动处理
3. BD-004（不合格料禁止入库的强制拦截）是否在后端落实

### 5.3 链路三：BOM 变更 -> 计算引擎更新（R-04）

```
BOM 版本创建（草稿）─> 编辑明细 ─> 激活 ─> 旧版本自动归档 ─>
采购需求引擎按激活版本展开 ─> 在产工单不受影响（快照机制 BD-001）
```

| 环节 | 后端 | 前端 | 状态 |
|---|---|---|---|
| BOM 版本 CRUD | `/api/bom` 含 create/copy/activate | BomPage 已实现 | **可用** |
| 激活版本唯一性 | activate 接口已实现 | — | **可用** |
| 通用件引用 | addItem 接口支持引用半成品 SKU | 需确认前端选择器 | **待确认** |
| BOM 展开计算 | bom-expansion.service 已实现 | — | **可用** |
| 快照机制 | bom-snapshot.service 已实现 | — | **可用** |
| 工单锁定 BOM 版本 | production-order.service 需确认 | — | **待确认** |

**链路评估**：后端 BOM 版本化基础设施较完善（expansion + snapshot + activate），核心数据模型变更已完成。待确认工单创建时是否将 bom_version_id 写入工单记录。

### 5.4 链路四：智能调度（R-12）

```
库存数据 + 生产进度 + 销售订单 + BOM 展开 ─> 规则引擎计算 ─>
采购建议 + 排产建议 ─> 人工审批确认 ─> 执行
```

| 环节 | 后端 | 前端 | 状态 |
|---|---|---|---|
| 调度计算触发 | `POST /schedule-suggestions/trigger` | ScheduleSuggestionPage 已实现 | **可用** |
| 批次状态追踪 | schedule_suggestions 表 + BullMQ job | 前端有轮询 | **可用** |
| 采购建议生成 | purchaseSuggestion + 9 字段扩展 | PurchaseSuggestionPage | **可用** |
| 排产建议生成 | schedule-suggestion 模块 | ScheduleSuggestionPage | **可用** |
| 建议审批 | approve/reject 接口已实现 | 前端有按钮 | **可用** |
| Dashboard Widget | analytics 模块 dashboard-kpi 已实现 | DashboardPage 已实现 | **待确认集成** |

**链路评估**：Sprint 4 的智能调度模块从数据库设计到后端接口到前端页面均已实现基本框架。核心风险在于调度算法的数据输入质量依赖链路一、二的完整性。

---

## 六、修复优先级建议

### P0 — 阻断上线，必须立即修复（14 项）

| # | 问题 | 模块 | 修复范围 | 预估工时 |
|---|---|---|---|---|
| 1 | GAP-R08-01: OrderPage MOCK 数据替换为真实 API | FE | 前端 | 1d |
| 2 | GAP-R08-08 + R08-22: 销售订单双轨 API 合并统一 | FE+架构 | 前端+路由 | 1.5d |
| 3 | GAP-R08-14: 驳回后状态 draft -> closed 修正 | BE | 后端 | 0.5d |
| 4 | R08-10 + R08-23: 产能查询接口实现 + 紧急插单影响横幅 | BE+FE | 前后端 | 3d |
| 5 | R06-G02: 完工上报弹窗补充 actualHours + 工资预览 | FE+BE | 前后端 | 2d |
| 6 | R06-G05: 补充 suspended 状态 + 主管处置弹窗 | FE+BE | 前后端 | 2d |
| 7 | BD-002: users 表补充 skill_level 字段 + 工价计算区分等级 | BE+DB | 后端+数据库 | 1d |
| 8 | BD-001: production_orders 表确认 bom_version_id 字段写入 | BE+DB | 后端 | 0.5d |
| 9 | BD-003: 插单确认权限收紧为仅 boss（当前含 supervisor+sales） | BE | 后端路由 | 0.5d |
| 10 | R08-04 + R06-G01: 统计卡片改用全库聚合接口 | FE+BE | 前后端 | 1.5d |
| 11 | R01-01: SKU 类目管理重构为双面板布局 | FE | 前端 | 2d |
| 12 | R02-01: 供应商导出按钮接入（4 状态机 + 文件下载） | FE | 前端 | 1d |
| 13 | R02-02: 对比弹框核心指标表格 + 后端字段扩展 | FE+BE | 前后端 | 2d |
| 14 | 5 个 P0 设计稿创建（Dashboard/SKU/BOM/Inventory/ProductionOrder） | UI | 设计 | 5d |

**P0 预估总工时：约 23.5 人天**

### P1 — 核心功能完善，Sprint 内修复（18 项）

| # | 问题 | 模块 | 修复范围 |
|---|---|---|---|
| 1 | R08-13: Admin 独立审批弹框 | FE | 前端 |
| 2 | R08-15: 订单详情状态时间线 | FE | 前端 |
| 3 | R08-18: Admin 待审批横幅（usePendingApprovals 已有 Hook 未使用） | FE | 前端 |
| 4 | R08-21: BD-003 权限矩阵前端完整实现 | FE | 前端 |
| 5 | R06-G01: GET /production-tasks/stats 聚合接口 | BE | 后端 |
| 6 | R06-G03: 异常上报补充 affectsProgress + 图片上传 | FE+BE | 前后端 |
| 7 | R06-G04: 任务详情 BOM 快照 + 操作时间线 | FE+BE | 前后端 |
| 8 | R06-G12: listTasks 补充 priority/actualHours/version 字段 | BE | 后端 |
| 9 | R07-G01: 客户编码改只读 + 联系人分段表单 | FE | 前端 |
| 10 | R07-G02: 客户导出 Excel | FE+BE | 前后端 |
| 11 | R07-G03: 停用客户错误信息展示给用户 | FE | 前端 |
| 12 | R07-G07: 删除冗余 customer 模块 | BE | 后端清理 |
| 13 | R03-G02/G03/G04: 价格导入模板字段定义对齐设计稿 | FE+BE | 前后端+PM 确认 |
| 14 | R03-G14: 导入进度轮询接口 + 前端进度条 | FE+BE | 前后端 |
| 15 | R05-G18: 工资核算报表 Tab 实现 | FE | 前端 |
| 16 | R05-G21: 工价列权限控制（非 admin 隐藏） | FE+BE | 前后端 |
| 17 | R05-G24: 完工上报弹框完整实现 | FE | 前端 |
| 18 | 站内通知推送服务基础实现 | BE | 后端 |

### P2 — 体验优化，可进入下一迭代（30+ 项）

涵盖以下类别：
- R-01 剩余 7 项（R01-02~R01-10）
- R-02 剩余 8 项（R02-03~R02-13）
- R-03 剩余 9 项（G05~G17）
- R-05 剩余 8 项（G19~G30）
- R-06 剩余 4 项（G06~G11）
- R-07 剩余 4 项（G04~G09）
- R-08 剩余 10 项（R08-02/03/05/06/07/11/12/16/17/19/20/24/25）
- 骨架屏规范统一
- 响应式布局规范补充
- AI 状态组件系统化
- 空态设计统一

---

## 附录：关键文件索引

| 类别 | 文件路径 |
|---|---|
| 后端路由注册 | `services/api/src/app.ts` |
| 生产模块 | `services/api/src/modules/production/` (9 个文件) |
| 销售订单模块 | `services/api/src/modules/sales-order/` |
| 调度建议模块 | `services/api/src/modules/schedule-suggestion/` |
| BOM 模块 | `services/api/src/modules/bom/` |
| 来料质检模块 | `services/api/src/modules/incoming-inspection/` |
| 分析模块 | `services/api/src/modules/analytics/` |
| 迁移脚本目录 | `services/api/src/migrations/` (10 个 SQL) |
| 前端 API 目录 | `services/web/src/api/` (23 个文件) |
| Gap 分析报告 | `docs/v2/gap-r01-r02.md`、`gap-r03-r05.md`、`gap-r06-r07.md`、`gap-r08.md` |
| UI 设计复盘 | `docs/v2/ui-design-review.md` |
| V2 PRD | `docs/v2/PRD-v2-iteration-plan.md` |
| V1 PRD | `docs/prd-smart-factory-agent.md` |

---

*文档版本：v1.0*
*最后更新：2026-03-14*
*作者：@tech-lead-architect*
