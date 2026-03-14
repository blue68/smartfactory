# Sprint 4 智能调度 — 工程经理 SDD 审批报告

**文档编号**：EM-APPROVAL-SPRINT4-V2-001
**版本**：v1.0
**审批日期**：2026-03-14
**审批人**：@engineering-manager
**输入文档**：
- docs/v2/sprint4-prd.md（PRD-SPRINT4-V2-001）
- docs/v2/sprint4-ui-design.md（UI-SPRINT4-V2-001）
- docs/v2/sprint4-architecture.md（ARCH-SPRINT4-V2-001）
- services/api/src/modules/（后端模块扫描）
- services/web/src/pages/（前端页面扫描）
- services/api/src/modules/events/event-bus.service.ts（待改造目标）

---

## 一、审查意见

### 1.1 PRD 完整性审查

**总体评价：合格，可进入编码阶段**

#### User Story 完整性

PRD 共产出 13 个 User Story（US-S4-001 至 US-S4-013），覆盖 P0/P1/P2 全部功能。

逐项检查：

| 检查项 | 结论 |
|---|---|
| 每个 User Story 是否有角色、能力、价值的完整格式 | 通过，格式完整 |
| 验收条件（AC）是否具体、可测试 | 通过，AC 全部包含数字和操作步骤，可直接转为测试用例 |
| 计算场景 A-E 是否可驱动 QA 验收 | 通过，5 个预置场景明确了输入和期望输出 |
| 异步状态是否被需求覆盖 | 通过，AC-S4-007-03/04 明确了 BullMQ 任务失败、超时的处理要求 |
| 冷启动场景是否被覆盖 | 通过，AC-S4-001-05 有明确定义 |
| 人工确认底线是否被强制定义 | 通过，AC-S4-003-04 明确了 403 强制拦截，视为需求红线 |

**一处需要注意**：ACC-002（质检单编号前缀）和 ACC-005（退货单状态机命名）均依赖 @senior-ai-agent-pm 与业务方在 Week 1 前完成书面确认，若确认延误，US-S4-013 对应编码任务需暂缓，不应阻断 P0 功能开发。PM 应在 Sprint 4 Day 1 前完成此决策并同步给后端工程师。

#### 优先级划分合理性

P0（F-S4-001 至 F-S4-007）对应核心价值交付和消息队列架构基础，合理。
P1（F-S4-008 至 F-S4-012）对应分析辅助功能，不阻断核心流程，合理。
P2（F-S4-013 至 F-S4-016）为技术债务修复，合理排在最低优先级。

PRD 优先级审查：**通过**。

---

### 1.2 架构合理性审查

**总体评价：整体合格，有两处需要条件确认后方可进入编码**

#### BullMQ 引入必要性与迁移安全性

**必要性**：通过。现有 EventBusService 为进程内同步 EventEmitter，入库接口响应时间因缺料重评被阻塞（ACC-003），这是实测的性能问题，引入 BullMQ 是合理的根治方案，不属于过度设计。同时 R-12 调度建议计算本身是 < 10 秒的后台任务，也需要队列承载。两个需求合并为一次架构升级，成本合理。

**迁移安全性**：通过。架构师选择门面模式（EventBusFacade）保持 publish/subscribe 方法签名不变，现有 30+ 调用点无需修改，改造范围可控。降级保护（Redis 不可用时回退同步 EventEmitter）设计合理，确保业务不中断。

**一处工程风险确认**：架构文档注意到 package.json 已有 `bull@4.16.0` 依赖，Sprint 4 新增 `bullmq` 包，两个包将并存（bull 用于现有 stock-alert-scan 队列，bullmq 用于新队列）。后端工程师在实施前需确认 bull 和 bullmq 共用同一 Redis 实例时不存在 key 命名冲突（bull 默认 key 前缀为 `bull:`，bullmq 默认为 `bull:`，存在潜在冲突）。**实施前必须为 bullmq 配置 prefix 以区分，建议使用 `{prefix: 'erp_bullmq'}`**。这是一个需要在 Week 1 动工前解决的具体技术问题。

**Redis 恢复不自动切换 BullMQ** 的设计决策（需重启才恢复）在 MVP 阶段可接受，但需在运维文档中说明，并由 @devops-engineer 确认监控告警覆盖此降级状态。

#### 规则引擎设计合理性

**通过，且未过度设计**。采购建议四步规则（缺口→安全库存→资金评估→供应商推荐）和排产建议三维评分（交期紧迫度→订单优先级→物料就绪度）逻辑清晰，均为确定性计算，可测试，可解释。PRD 明确禁止接入 LLM API，这是正确的 MVP 决策。

规则引擎被明确拆分为 PurchaseSuggestionEngine 和 ProductionSuggestionEngine 两个独立计算模块，职责清晰，不与业务服务耦合。

**一处算法边界确认**：排产建议三维评分中，交期紧迫度得分的线性插值公式为 `MAX(0, 50 - (余裕工时 / 80 × 50))`，当工期余裕恰好等于 80 工时时得分为 0，大于 80 工时时始终维持 0 分，而非出现负分。该公式已在架构文档中写明，后端工程师实现时须严格照此实现，Code Review 必须验证边界处理。

#### 数据库设计合理性

**通过，设计规范**。

- 三张新增表（schedule_suggestions、schedule_suggestion_items、suggestion_audit_logs）均包含 tenant_id，满足多租户隔离要求。
- 所有新增字段对现有表仅做 ADD COLUMN（购买建议表新增 10 列），均设置 NULL 默认值，向前兼容。
- 索引设计覆盖核心查询路径：按租户查状态、按 BullMQ JobID 轮询、按批次查明细、按操作人查审计记录。

**一处注意**：架构文档已提示 purchase_suggestions 表 ADD COLUMN 前需先检查是否已存在 approved_by/approved_at 字段（Sprint 3 可能已加过）。后端工程师实施迁移脚本前必须执行 `SHOW COLUMNS FROM purchase_suggestions` 确认，避免迁移脚本报错中断。建议将此确认步骤写入迁移脚本的注释中。

schedule_suggestion_items 表使用单张宽表存储采购建议明细和排产建议明细（通过 item_type 区分，非采购类字段允许 NULL），这是 MVP 阶段的合理简化，后期如两类明细差异扩大可拆分。当前数据量不触发性能问题。

#### API 设计合理性

**通过，RESTful 规范，符合项目现有风格**。

- 统一响应格式 {code, data, message} 与现有接口一致。
- 所有新增接口均有 requireRoles 权限声明，覆盖 ACC-004 遗留问题。
- 角色权限矩阵（admin/supervisor/purchaser/warehouse）清晰定义在接口级别。
- 计算建议触发（POST /calculate）与状态查询（GET /status?jobId=）分离，前端轮询方案合理。

**一处需要补充**：GET /api/schedule-suggestions/latest 接口设计中，服务端需基于 JWT 角色自动过滤返回字段（admin 返回全部，supervisor 仅返回 productionSuggestions，purchaser 仅返回 purchaseSuggestions）。这个服务端字段过滤逻辑需要在控制器层显式实现，不能依赖前端不渲染来保证数据隔离。后端工程师实现时必须在 controller 层根据 req.user.role 做字段过滤，而非在前端做条件渲染。

**缺少的接口**：Dashboard 汇总接口（GET /api/dashboard/schedule-summary）在 PRD 中有定义（US-S4-012），架构文档 Redis Key 设计中也提到了缓存 key，但 API 接口章节未给出完整的 Response 格式示例。后端工程师实现时需补充此接口的完整契约（参考其他 Dashboard 接口格式），并在实现前与前端工程师对齐字段名。

---

### 1.3 UI 设计可行性审查

**总体评价：合格，可实现，与现有设计系统衔接良好**

#### 交互方案可实现性

| 检查项 | 结论 |
|---|---|
| 轮询机制（每 3 秒调用 /status）| 可实现，前端标准轮询模式，设置超时 30 秒后停止并显示错误态 |
| 计算步骤抽屉（Drawer, 480px）| 可实现，现有项目已有 Drawer 组件，宽度通过 Token 配置 |
| 排产建议工单行展开/收起 | 可实现，标准手风琴交互 |
| 产能热力图 | 可实现，但实现复杂度较高（见风险评估）|
| 批量选择 + 批量确认操作栏 | 可实现，现有采购建议页已有类似模式 |
| 移动端底部 Sheet（< 768px）| 可实现，需注意与桌面端 Drawer 的条件渲染切换 |

#### 组件复用性

UI 设计文档明确标注了与现有组件的复用关系：
- 统计卡片（复用 KpiCard 结构）
- Skeleton 骨架屏（复用现有 Skeleton 组件 card variant）
- Tag 组件（新增 ai_schedule/production_shortage/manual 三个 variant）
- Drawer 组件（复用，新增 480px 宽度配置）

Design Token 扩展仅在 variables.css 的 :root 块追加新变量，不修改现有变量，向前兼容，合理。

**PulseWaveIndicator（脉冲波浪动画）**是新增组件，区别于现有旋转 spinner，实现工作量约半天，不复杂。

#### 状态设计完整性

UI 文档覆盖了 PRD 要求的全部五种状态：

| 状态 | PRD 要求 | UI 设计覆盖情况 |
|---|---|---|
| Loading（计算中）| 骨架屏 + 脉冲波浪 | 已覆盖，脉冲波浪动画规格完整 |
| Success（计算完成）| 结果列表 + result-appear 动画 | 已覆盖 |
| Error（计算失败）| 保留旧数据 + 错误条 + 重试按钮 | 已覆盖，StaleDataOverlay 组件规格完整 |
| Empty（无数据）| 插图 + 文案 | 已覆盖 |
| Warning（冷启动）| 黄色横幅，不阻断主内容 | 已覆盖，ColdStartBanner 规格完整 |

**状态机设计：完整，通过**。

---

## 二、风险评估与改进建议

### 风险 1：BullMQ 与 bull 包的 Redis Key 前缀冲突（高风险）

**风险描述**：现有系统使用 `bull@4.16.0`（stock-alert-scan 队列），Sprint 4 引入 `bullmq`。两个库默认都使用 `bull:` 前缀存储 Redis Key，若不显式区分，两套队列的 metadata key 可能冲突，导致队列数据损坏或 Worker 消费错误 job。

**改进建议**：
1. 在 QueueService 初始化 BullMQ 时，必须配置 `prefix: 'erp_bullmq'`（或其他与 bull 不同的前缀）。
2. 现有 bull 队列的 prefix 如果未配置，默认为 `bull:`，两者就不会冲突（erp_bullmq: vs bull:）。
3. 后端工程师在 Week 1 实施前必须验证两套队列的实际 Redis key 不重叠（可在 Redis CLI 执行 `KEYS bull*` 确认现有 stock-alert-scan 的 key 前缀）。

**处置**：本项为阻断性技术风险，必须在 Week 1 开始编码前完成验证并确认方案，由后端工程师记录验证结果后方可启动 QueueService 实现。

---

### 风险 2：产能热力图前端实现复杂度（中风险）

**风险描述**：产能利用率热力图（CapacityHeatmap.tsx）需要按工人/按日期渲染二维格子矩阵，并支持 hover 展示当日任务列表。该组件无现有可复用基础，从零实现估计需要 2-3 天，可能压缩 Week 3 的联调时间。

**改进建议**：
1. 将 CapacityHeatmap 视为 P1 功能，若 Week 3 进度紧张，优先完成 P0 功能联调，热力图可在发布后作为 Hotfix 补充。
2. 前端工程师评估是否可使用轻量的第三方热力图库（如 d3-scale-chromatic 配合自定义 table 渲染），减少自研工作量，但需确认不引入新的 UI 库（PRD 约束：前端不引入新 UI 库；d3 辅助工具属于数据工具而非 UI 库，可酌情使用）。

---

### 风险 3：Dashboard /schedule-summary 接口契约缺失（中风险）

**风险描述**：架构文档未给出 GET /api/dashboard/schedule-summary 的完整 Response 格式定义，前后端可能在 Week 3 联调时因字段名不一致产生返工。

**改进建议**：后端工程师在实现此接口前，须在内部先确定字段结构并通知前端工程师，确保 Dashboard Widget（ScheduleSuggestionWidget.tsx）的 API 调用字段与后端返回一致。建议在代码注释或简短 Slack 消息中完成对齐，无需写正式文档。

---

### 风险 4：ACC-002/005 业务决策延误（低风险）

**风险描述**：质检单编号前缀（IQC/QC）和退货单状态命名的最终业务确认依赖产品经理与业务方沟通，若超出 Week 1，会影响 US-S4-013 的编码。

**改进建议**：将此两项决策设置明确的截止时间（Sprint 4 Day 3 前），超时则采用临时方案（维持现状，下个 Sprint 再统一），不阻断 P0/P1 开发进度。后端工程师无需等待此决策才开始 Week 1 工作（BullMQ 改造与此无关）。

---

### 风险 5：Worker 同进程部署与内存压力（低风险）

**风险描述**：三个 BullMQ Worker（MrpWorker、SuggestionWorker、NotificationWorker）与 Express API 运行于同一进程。当调度建议计算（SuggestionWorker）执行密集 DB 查询时，可能与 API 请求争抢数据库连接池。

**改进建议**：MVP 阶段可接受（50 个 pending 工单、200 个 SKU 的计算量不大）。但需确保 DB 连接池大小设置合理（建议配置 pool max: 20，且 Worker 使用独立连接池配置，避免耗尽 API 的连接）。后期如计算量增大，可将 Worker 迁移到独立进程（PM2 cluster），当前架构已预留此升级路径。

---

## 三、任务拆解

### 3.1 后端任务（senior-backend-engineer）

**Week 1 — 消息队列改造（架构基础，优先完成）**

| 任务ID | 描述 | 优先级 | 预估工作量 | 主要文件 |
|---|---|---|---|---|
| BE-S4-01 | 安装 bullmq 依赖，配置 prefix 规避与 bull 冲突，验证 Redis key 不重叠 | P0 | 0.5 天 | package.json, src/shared/queue.config.ts（新建）|
| BE-S4-02 | 实现 QueueService：三队列初始化、降级保护逻辑（Redis 不可用回退 EventEmitter）、WARN 日志 | P0 | 1.5 天 | src/shared/queue-service.ts（新建）|
| BE-S4-03 | 改造 EventBusFacade：publish() 内部路由到 QueueService，subscribe() 保持签名，现有调用方代码不改 | P0 | 1 天 | src/modules/events/event-bus.service.ts（改造）|
| BE-S4-04 | 实现 MrpWorker：消费 erp.inventory.shortage-recheck，调用 MrpService.reevaluateAfterReceipt()，配置指数退避重试，failed 事件写 ERROR 日志（修复 ACC-008）| P0 | 1 天 | src/workers/mrp.worker.ts（新建）|
| BE-S4-05 | 实现 NotificationWorker：消费 erp.notification.send，固定 10s 重试，failed 写日志 | P0 | 0.5 天 | src/workers/notification.worker.ts（新建）|
| BE-S4-06 | 应用启动入口注册三个 Worker，注册每日 06:00 定时计算 cron job（BullMQ repeatableJob）| P0 | 0.5 天 | src/app.ts 或 src/main.ts（修改）|

**Week 1-2 — 数据库迁移 + 采购建议引擎**

| 任务ID | 描述 | 优先级 | 预估工作量 | 主要文件 |
|---|---|---|---|---|
| BE-S4-07 | 编写数据库迁移脚本：创建 schedule_suggestions、schedule_suggestion_items、suggestion_audit_logs 三张新表 | P0 | 1 天 | migrations/YYYYMMDD_sprint4_schedule_tables.sql（新建）|
| BE-S4-08 | purchase_suggestions 表 ALTER TABLE（先检查现有字段，新增 10 列），包含 approved_by 字段 | P0 | 0.5 天 | migrations/YYYYMMDD_purchase_suggestion_extend.sql（新建）|
| BE-S4-09 | 实现 PurchaseSuggestionEngine 四步规则引擎（ShortageCalculator、SafetyStockCalculator、CapitalEvaluator、SupplierRecommender），纯计算，禁止调用 PurchaseOrderService | P0 | 2 天 | src/modules/schedule-suggestion/purchase-suggestion.engine.ts（新建）|
| BE-S4-10 | 实现 ScheduleSuggestionService（编排层）：触发计算、写 schedule_suggestions 状态、写计算结果到 purchase_suggestions（防重逻辑）、写 schedule_suggestion_items 快照 | P0 | 1.5 天 | src/modules/schedule-suggestion/schedule-suggestion.service.ts（新建）|
| BE-S4-11 | 实现 SuggestionWorker：消费 erp.schedule.suggestion-calculate，调用 ScheduleSuggestionService.calculate()，计算失败更新 status=failed，固定 30s 重试 | P0 | 1 天 | src/workers/suggestion.worker.ts（新建）|

**Week 2 — 排产建议引擎 + 确认接口**

| 任务ID | 描述 | 优先级 | 预估工作量 | 主要文件 |
|---|---|---|---|---|
| BE-S4-12 | 实现 ProductionSuggestionEngine 三维评分引擎（DeadlineScorer、OrderPriorityScorer、MaterialReadinessScorer），注意交期紧迫度线性插值边界处理 | P0 | 1.5 天 | src/modules/schedule-suggestion/production-suggestion.engine.ts（新建）|
| BE-S4-13 | 实现调度建议 Controller + Routes：POST /calculate、GET /status、GET /latest、GET /history、GET /{id}/history-detail，全部加 requireRoles 中间件，GET /latest 服务端按角色过滤字段 | P0 | 1.5 天 | src/modules/schedule-suggestion/schedule-suggestion.controller.ts + routes.ts（新建）|
| BE-S4-14 | 实现采购建议确认接口：POST /purchase/{id}/confirm（接受/修改/驳回，写 suggestion_audit_logs）、POST /purchase/batch-confirm（批量接受）| P0 | 1 天 | src/modules/schedule-suggestion/schedule-suggestion.controller.ts（扩展）|
| BE-S4-15 | 实现排产建议应用接口：POST /{suggestionId}/apply-production，更新 production_orders.priority_score，写审计日志，不调用排产接口 | P0 | 0.5 天 | src/modules/schedule-suggestion/schedule-suggestion.controller.ts（扩展）|
| BE-S4-16 | 在 purchase-suggestion.service.ts 的 batchCreatePOFromSuggestions() 中增加强制校验：source=ai_schedule 时 approved_by 不得为 NULL，否则返回 HTTP 403 | P0 | 0.5 天 | src/modules/purchase/purchase-suggestion.service.ts（修改）|
| BE-S4-17 | 实现采购建议步骤详情接口：GET /purchase/{purchaseSuggestionId}/steps，从 schedule_suggestion_items 查计算步骤数据 | P0 | 0.5 天 | src/modules/schedule-suggestion/schedule-suggestion.controller.ts（扩展）|

**Week 2-3 — 数据分析接口 + P1 功能 + ACC 修复**

| 任务ID | 描述 | 优先级 | 预估工作量 | 主要文件 |
|---|---|---|---|---|
| BE-S4-18 | 实现 InventoryTurnoverService：周转天数计算、滞销预警、呆滞库存、资金占用、安全库存达成率 | P1 | 1 天 | src/modules/schedule-suggestion/inventory-turnover.service.ts（新建）|
| BE-S4-19 | 实现库存周转分析接口：GET /inventory/turnover，Redis 缓存 30 分钟，requireRoles(['admin','warehouse'])| P1 | 0.5 天 | src/modules/inventory/inventory.controller.ts（扩展）|
| BE-S4-20 | 实现 CapacityAnalysisService：工人本周已分配工时、利用率计算、过载判定 | P1 | 0.5 天 | src/modules/schedule-suggestion/capacity-analysis.service.ts（新建）|
| BE-S4-21 | 实现产能利用率接口：GET /production/capacity?weekStart=，Redis 缓存 15 分钟，requireRoles(['admin','supervisor'])| P1 | 0.5 天 | src/modules/production/production.controller.ts（扩展）|
| BE-S4-22 | 实现 Dashboard 汇总接口：GET /dashboard/schedule-summary，Redis 缓存 5 分钟，在实现前与前端工程师对齐 Response 字段 | P1 | 0.5 天 | src/modules/analytics/analytics.controller.ts（扩展）|
| BE-S4-23 | ACC-002 修复：质检单编号前缀统一（等 PM 业务确认后执行）| P2 | 0.5 天 | src/modules/quality/quality.service.ts（修改）|
| BE-S4-24 | ACC-005 修复：退货单状态机命名统一，若需修改 DB 字段值须提供数据迁移脚本（等 PM 业务确认后执行）| P2 | 0.5 天 | src/modules/return-order/returnOrder.service.ts（修改）|

**后端任务合计**：约 17 个任务，估算工期 15-16 个工作日（含 ACC 修复），与 3 周计划匹配。

---

### 3.2 前端任务（senior-frontend-engineer）

**Week 2 — P0 主体页面**

| 任务ID | 描述 | 优先级 | 预估工作量 | 主要文件 |
|---|---|---|---|---|
| FE-S4-01 | 在 variables.css 追加 Sprint 4 新增 Design Token（AI 色彩、冷启动色、热力图色、步骤卡片 Token），不修改现有变量 | P0 | 0.5 天 | src/styles/variables.css（扩展）|
| FE-S4-02 | 实现 PulseWaveIndicator 组件（三柱脉冲波浪动画，用于计算中状态） | P0 | 0.5 天 | src/components/PulseWaveIndicator.tsx（新建）|
| FE-S4-03 | 实现 StepCalculationCard 组件（四步规则引擎展示，支持展开/收起，步骤一工单数字可点击弹出 popover）| P0 | 1.5 天 | src/components/StepCalculationCard.tsx（新建）|
| FE-S4-04 | 实现 ScheduleStatCard 组件（顶部四格统计卡片，复用 KpiCard 结构，扩展 normal/info/warning/danger/loading/error 六种变体）| P0 | 0.5 天 | src/components/ScheduleStatCard.tsx（新建）|
| FE-S4-05 | 实现 ScheduleSuggestionPage 骨架（路由注册 /schedule-suggestions，角色权限守卫，页面三区块布局）| P0 | 0.5 天 | src/pages/schedule/ScheduleSuggestionPage.tsx（新建）|
| FE-S4-06 | 实现采购建议区块（轮询逻辑，批量选择/批量确认操作栏，五种状态：Loading/Success/Error/Empty/ColdStart）| P0 | 2 天 | src/pages/schedule/ScheduleSuggestionPage.tsx（扩展）|
| FE-S4-07 | 实现 ScheduleWorkOrderRow 组件（排产建议工单行：折叠态/展开态，三维得分明细，工人推荐卡片，跳转排产链接）| P0 | 1.5 天 | src/components/ScheduleWorkOrderRow.tsx（新建）|
| FE-S4-08 | 实现排产建议区块 + 应用建议确认弹窗（ConfirmApplyModal，展示将调整的工单列表）| P0 | 1 天 | src/pages/schedule/ScheduleSuggestionPage.tsx（扩展）|
| FE-S4-09 | 实现 ColdStartBanner 组件（冷启动提示横幅，sessionStorage 记录关闭状态）| P0 | 0.5 天 | src/components/ColdStartBanner.tsx（新建）|
| FE-S4-10 | 实现 StaleDataOverlay 组件（错误态旧数据叠加层，opacity 遮罩 + 错误条 + 重试按钮）| P0 | 0.5 天 | src/components/StaleDataOverlay.tsx（新建）|
| FE-S4-11 | 改造 PurchaseSuggestionPage（现有页面）：新增 source 来源标签（智能计算/缺料触发/手动创建），新增"查看计算步骤"图标按钮 | P0 | 0.5 天 | src/pages/purchase/PurchaseSuggestionPage.tsx（修改）|
| FE-S4-12 | 实现计算步骤 Drawer（480px，内嵌 StepCalculationCard 四步展示，抽屉底部操作栏：接受/修改/驳回）、ConfirmSuggestionModal 弹窗组件 | P0 | 1 天 | src/pages/purchase/PurchaseSuggestionPage.tsx（扩展）|
| FE-S4-13 | 实现历史记录 Tab（ScheduleSuggestionPage 内，按计算时间倒序展示批次列表，点击查看历史快照详情）| P0 | 1 天 | src/pages/schedule/ScheduleSuggestionPage.tsx（扩展）|
| FE-S4-14 | 主导航新增"智能调度"菜单入口（位于生产管理和采购管理之间，语义图标，不使用 AI 文字）| P0 | 0.5 天 | src/components/Navigation.tsx 或 Sidebar.tsx（修改）|

**Week 3 — P1 分析面板 + Dashboard Widget**

| 任务ID | 描述 | 优先级 | 预估工作量 | 主要文件 |
|---|---|---|---|---|
| FE-S4-15 | 实现 InventoryTurnoverPanel 组件（库存周转分析面板：周转天数、滞销预警标签、资金占用排序、安全库存达成率色标）| P1 | 1.5 天 | src/components/InventoryTurnoverPanel.tsx（新建）|
| FE-S4-16 | 实现 CapacityHeatmap 组件（工人 × 日期二维热力图，4 档色，hover 展示当日任务列表，移动端横向滚动）| P1 | 2 天 | src/components/CapacityHeatmap.tsx（新建）|
| FE-S4-17 | 实现 ScheduleSuggestionWidget（Dashboard 新增卡片：四格统计 + 前往调度看板入口 + 无数据态 + 计算失败态）| P1 | 1 天 | src/components/ScheduleSuggestionWidget.tsx（新建）+ DashboardPage.tsx（修改）|
| FE-S4-18 | ACC-002/005 前端展示文案统一（等后端和 PM 确认命名后执行，修改质检单编号展示前缀、退货单状态展示文案）| P2 | 0.5 天 | src/pages/quality/TracePage.tsx + src/pages/purchase/ReturnOrderPage.tsx（修改）|

**前端任务合计**：约 18 个任务，估算工期 15-16 个工作日，与 3 周计划匹配。

---

### 3.3 前后端联调顺序

```
Week 2 Day 1-2：
  后端 BE-S4-13（调度建议接口）完成后，前端即可对接 FE-S4-06（采购建议区块）

Week 2 Day 3-4：
  后端 BE-S4-15/16/17（确认、步骤详情接口）完成后，前端对接 FE-S4-12（计算步骤 Drawer）

Week 3 Day 1-2：
  后端 BE-S4-18/19/20/21/22（分析接口）完成后，前端对接 FE-S4-15/16/17（分析面板）

Dashboard /schedule-summary 接口：
  后端在实现 BE-S4-22 前，须与前端工程师口头/消息对齐 Response 字段，避免联调返工
```

---

## 四、特别说明事项

### 关于调度建议禁止自动执行的工程红线

以下两项约束在 Code Review 阶段必须强制验证，不得遗漏：

1. PurchaseSuggestionEngine 和 ProductionSuggestionEngine 的代码中，禁止出现对 PurchaseOrderService.create()、ProductionService.generateSchedule()、ProductionService.confirmSchedule() 的任何 import 或调用。Code Review 发现此类调用必须打回。

2. purchase-suggestion.service.ts 的 batchCreatePOFromSuggestions() 方法中，source=ai_schedule 时的 approved_by 非空校验必须存在于后端，不得仅依赖前端 UI 控制。QA 测试时须直接调用 API（Postman/curl）绕过前端验证，确认返回 403。

---

## 五、审批结论

```
[artifact:工程审批]
CONDITIONAL APPROVED
```

**条件内容**：

满足以下两个前置条件后，方可正式进入编码阶段：

**条件 1（必须在 Week 1 开始编码前完成）**：
后端工程师验证并记录 bull 和 bullmq 在现有 Redis 实例上的 key 前缀不冲突，并确认 QueueService 初始化时配置了独立 prefix（建议 `erp_bullmq`）。验证结果以代码注释或简短说明记录在 queue.config.ts 文件中即可，无需正式文档。

**条件 2（Week 1 Day 3 前，不影响后端开工）**：
@senior-ai-agent-pm 完成 ACC-002（质检单编号前缀）和 ACC-005（退货单状态命名）的业务决策，并书面同步给后端工程师。若截止时间前未完成决策，US-S4-013 编码任务暂缓，不阻断 P0/P1 功能开发。

**其余非阻断性改进建议**（无需等待，可在编码过程中持续关注）：
- BE-S4-22 实现前与前端对齐 /dashboard/schedule-summary 接口字段
- CapacityHeatmap 若 Week 3 进度紧张可推迟为 Hotfix，不阻断发布

**P0 任务可立即开始**：BE-S4-01 至 BE-S4-06（消息队列改造）、FE-S4-01 至 FE-S4-04（基础组件）。

---

*审批人*：@engineering-manager
*审批日期*：2026-03-14
*有效范围*：Sprint 4（Week 9-11），V2 最终 Sprint
*下一审批节点*：Code Review（@code-reviewer），Security 审计（@security-engineer）
