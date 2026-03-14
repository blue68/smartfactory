# Sprint 4 Code Review 报告

**审查人**: code-reviewer
**审查日期**: 2026-03-14
**审查范围**: Sprint 4 P0 新增/修改文件（后端 15 个 + 前端 9 个，约 11000 行）
**分支**: master（commit 09eda23）

---

## 一、审查结论总览

| 严重级别 | 数量 |
|----------|------|
| Critical | 3    |
| High     | 6    |
| Medium   | 9    |
| Low      | 5    |
| **合计** | **23** |

**结论**: 存在 3 个 Critical 问题，不满足质量门禁要求，**禁止当前版本发布**，需修复 Critical 和 High 问题后重新提交审查。

---

## 二、问题明细

| 编号 | 严重级别 | 文件 | 行号 | 问题描述 | 修复建议 |
|------|----------|------|------|----------|----------|
| CR-S4-001 | Critical | `services/api/src/modules/schedule-suggestion/schedule-suggestion.service.ts` | 311–325 | **SQL 注入风险（动态条件字符串拼接）**: `getLatest()` 方法中 `itemTypeCond` 变量由条件逻辑拼接后直接插入 SQL 字符串（`WHERE ssi.suggestion_id = ? AND ssi.tenant_id = ? ${itemTypeCond}`），虽然当前值只有两种固定字符串，但该模式违反参数化查询原则。若后续维护者扩展判断逻辑时引入外部输入，将直接产生 SQL 注入漏洞。 | 将 `itemTypeCond` 改为 `AND ssi.item_type = ?` 并在参数数组中条件性追加 `'purchase'`，完全消除字符串拼接。示例：`const params: unknown[] = [batch.id, this.tenantId]; if (isPurchaseOnly) { itemTypeCond = "AND ssi.item_type = ?"; params.push('purchase'); }` |
| CR-S4-002 | Critical | `services/api/src/index.ts` | 91–95 | **SuggestionWorker 未注册到优雅退出钩子**: `gracefulShutdown()` 中只调用了 `closeMrpWorker()` 和 `closeNotificationWorker()`，未调用 `closeSuggestionWorker()`。进程收到 SIGTERM 时，正在执行的调度建议计算 Job 会被强制中断，导致批次状态卡在 `calculating`，数据库出现僵尸批次，需要人工修复。 | 在 `index.ts` 的 `bootstrap()` 中 import `closeSuggestionWorker`，并在 `gracefulShutdown()` 的 `Promise.all` 数组中补充 `closeSuggestionWorker()`。 |
| CR-S4-003 | Critical | `services/api/src/modules/schedule-suggestion/schedule-suggestion.service.ts` | 159–173 | **并发重复执行未加分布式锁**: `executeCalculation()` 通过检查 `status !== 'pending'` 防止重复执行，但该检查与状态更新（`status='calculating'`）之间存在 TOCTOU 竞态。BullMQ 在极端情况下（Worker 水平扩展或重试时序重叠）可能同时有两个 Worker 通过检查，导致同一批次并发写入明细数据。 | 在 `UPDATE status='calculating'` 时加乐观锁：`UPDATE schedule_suggestions SET status='calculating' WHERE id=? AND tenant_id=? AND status='pending'`，检查 `affectedRows`，若为 0 则说明已被其他 Worker 抢占，直接返回，无需抛出异常。此方案利用数据库行锁实现原子性，无需引入额外 Redis 锁。 |
| CR-S4-004 | High | `services/api/src/modules/schedule-suggestion/purchase-suggestion.engine.ts` | 140–383 | **N+1 查询问题（严重性能缺陷）**: `calculate()` 方法对 `skuRows` 列表中的每条 SKU 逐条执行 4 次独立 SQL 查询（库存查询、最近采购价查询、供应商频次查询、供应商报价查询），若有 50 个缺料 SKU 则产生最多 200 次数据库查询，每次计算对数据库造成极大压力，且超时风险高。 | 将 4 类查询全部改为批量 IN 查询，用 `skuIds` 数组一次性获取全量数据，然后在内存中通过 `Map<skuId, ...>` 做关联计算，将查询次数从 O(n×4) 降为 O(4)。 |
| CR-S4-005 | High | `services/api/src/modules/schedule-suggestion/schedule-suggestion.service.ts` | 197–244 | **明细写入未使用事务**: `executeCalculation()` 中先批量 INSERT 采购建议明细、再 INSERT 排产建议明细、最后 UPDATE 批次状态，三个操作未包裹在数据库事务中。若排产建议写入过程中出现异常，采购建议已写入但批次状态仍为 `calculating`，造成数据不一致（partial write）。 | 将 `DELETE + 两次 INSERT + UPDATE status='completed'` 整体包裹在 `AppDataSource.transaction(async (manager) => { ... })` 中，catch 块中的状态更新（`status='failed'`）在事务外执行。 |
| CR-S4-006 | High | `services/web/src/api/scheduleSuggestion.ts` | 129–131 | **驳回接口未传 reason 参数**: `rejectItem()` API 函数调用时未携带 `reason` 字段（`request.post(...)`，无 body），而后端 `RejectItemSchema` 要求 `reason` 非空（`z.string().min(1)`）。前端每次调用驳回接口均会收到 400 校验错误，驳回功能完全不可用。 | 修改 `rejectItem` 函数签名为 `rejectItem: (itemId: number, reason: string) => request.post<ItemActionResult>(..., { reason })`，并在 `useRejectItem` hook 及调用处同步传入驳回原因。 |
| CR-S4-007 | High | `services/web/src/api/scheduleSuggestion.ts` | 121–123 | **历史批次详情路由路径错误**: `getBatchSnapshot(batchId)` 调用路径为 `/api/schedule-suggestions/history/${batchId}`，但后端路由注册的实际路径为 `/api/schedule-suggestions/:id`（无 `history/` 前缀），导致该接口 404 Not Found，历史批次详情功能无法使用。 | 将 `getBatchSnapshot` 的 URL 修改为 `/api/schedule-suggestions/${batchId}` 以匹配后端路由，或在后端路由中补充 `/history/:id` 路由（需在 `/:id` 之前注册）。 |
| CR-S4-008 | High | `services/web/src/api/scheduleSuggestion.ts` | 133–135 | **批量应用排产建议接口路径不存在**: `applyProduction` 调用 `POST /api/schedule-suggestions/items/apply`（批量路由），但后端路由只定义了 `POST /items/:itemId/apply`（单条路由）。批量应用接口在后端无对应处理器，必然 404。 | 后端需补充批量应用路由 `POST /items/apply`（注意须注册在 `/items/:itemId/apply` 之前），或前端改为循环调用单条接口并聚合结果。 |
| CR-S4-009 | High | `services/api/src/modules/schedule-suggestion/production-suggestion.engine.ts` | 377–402 | **工人负载计算字段语义错误**: `queryWorkerLoads()` 中对 `production_tasks.planned_qty` 求和赋值给 `weekly_hours`，但 `planned_qty` 是生产数量（件数），并非工时（小时）。用数量除以 `WEEKLY_CAPACITY_HOURS=40` 计算利用率，语义完全错误，导致工人推荐结果不可信。 | 查询应使用 `production_tasks.planned_hours`（或等效工时字段）。若表中尚无工时字段，需在 schema 中补充，或通过工序配置表关联计算标准工时。 |
| CR-S4-010 | Medium | `services/api/src/modules/events/event-bus.service.ts` | 62–71 | **降级路径中 shortageItems 丢失**: `QUEUE_NOTIFICATION_SEND` 降级处理器将 `NotificationJobData` 转换为 `MaterialShortagePayload` 时，`shortageItems` 强制设为空数组 `[]`，而下游 `subscribe(MATERIAL_SHORTAGE_DETECTED)` 的 handler 可能依赖此字段生成通知内容。Redis 不可用时，通知内容丢失，用户收到的通知信息不完整。 | 设计 `NotificationJobData` 时保留 `shortageItems` 序列化字段（JSON 字符串），降级时反序列化还原。或在 `MATERIAL_SHORTAGE_DETECTED` 的 handler 中支持 `shortageItems` 为空时的降级展示逻辑（从数据库重新查询）。 |
| CR-S4-011 | Medium | `services/api/src/modules/schedule-suggestion/production-suggestion.engine.ts` | 242–243 | **calcPriorityScore 优先级判断逻辑冲突**: `order_type` 优先级映射中检查 `PRIORITY_SCORE_MAP[order.order_type]` 是否存在，但 `PRIORITY_SCORE_MAP` 键名为 `urgent/high/normal/low`，而 `order_type` 字段按注释可能存储订单类型（如 `standard/rush`）而非优先级标签，两者语义混用会导致评分映射失效，大多数工单回退到 `priority` 数值分支。 | 明确 `order_type` 与优先级字段的语义边界。若销售订单有独立的 `priority` 字段（字符串枚举），应优先使用该字段映射，而非复用 `order_type`。需与产品确认数据库字段设计。 |
| CR-S4-012 | Medium | `services/api/src/modules/schedule-suggestion/schedule-suggestion.service.ts` | 306–327 | **getLatest() 使用 SELECT * 返回全量字段**: `getLatest()` 和 `getHistoryDetail()` 查询 `schedule_suggestion_items` 时使用 `ssi.*`，`calc_steps` 字段为 JSON，单条记录可能有数十 KB，全量返回时若批次含 100 条建议，响应体可能达到数 MB，影响接口性能和前端解析效率。 | 明细列表接口应仅返回摘要字段（排除 `calc_steps`、`suggested_workers`），将计算步骤详情的查询专门放在 `getPurchaseSteps()` 接口中按需加载。 |
| CR-S4-013 | Medium | `services/api/src/workers/suggestion.worker.ts` | 56–58 | **Worker 硬编码系统级角色**: `SuggestionWorker` 构造 Service 时传入 `roles: ['supervisor', 'boss']`，将角色鉴权逻辑渗透到后台异步任务层。若角色逻辑变更（如新增 `admin` 角色或调整权限范围），需同步修改 Worker 代码，违反开闭原则。 | 引入 `SYSTEM_CONTEXT` 常量或 Service 的 `createSystemContext()` 静态工厂方法，明确区分"系统级操作上下文"与"用户操作上下文"，避免在 Worker 中直接硬编码角色字符串。 |
| CR-S4-014 | Medium | `services/api/src/shared/queue-service.ts` | 73–74 | **bullmqAvailable 标志位不可恢复**: `bullmqAvailable` 一旦在 `addJob` 失败时置为 `false`，即使后续 Redis 连接恢复，该标志位也永远不会重置为 `true`。服务进程中 Redis 短暂不可用后恢复，BullMQ 仍不会被重新启用，所有 Job 持续走 EventEmitter 降级路径，丧失持久化和重试能力。 | 增加定期健康检查机制（如每 30 秒 ping 一次 Redis），连接恢复时将 `bullmqAvailable` 重置为 `true`。或移除该标志位，每次 `addJob` 直接 try/catch，依赖 BullMQ 自身的连接重试机制。 |
| CR-S4-015 | Medium | `services/api/src/migrations/V2_sprint4_schedule_tables.sql` | 91–96 | **schedule_suggestion_items 缺少外键约束**: `suggestion_id` 关联 `schedule_suggestions.id`，`sku_id` 关联 `skus.id`，`production_order_id` 关联 `production_orders.id`，均缺少 FOREIGN KEY 声明。应用层 Bug 可能写入孤立明细记录（主批次被删除后明细仍存在），或关联到不存在的 SKU/工单。 | 添加相应外键约束，并设置 `ON DELETE CASCADE`（跟随批次删除明细）或 `ON DELETE RESTRICT`（防止误删有明细的批次）。至少为 `suggestion_id` 添加外键。 |
| CR-S4-016 | Medium | `services/api/src/modules/schedule-suggestion/purchase-suggestion.engine.ts` | 296 | **供应商评分中 Decimal.min/max 参数展开在数组为空时行为未定义**: `Decimal.min(...allPrices)` 当 `allPrices` 为空数组时（所有供应商价格均为 0 或负值被 filter 过滤），展开参数为空，`Decimal.min()` 调用行为取决于库版本，可能抛出异常或返回 `Infinity`。代码虽有 `allPrices.length > 0` 判断，但提供的 fallback `new Decimal(1)` 会使后续 `priceRange = maxPrice.minus(minPrice) = 0`，此时 `priceScore` 固定为 100，评分失真。 | 当 `allPrices` 为空（所有均价为 0）时，将该供应商排除在评分之外，而非给予最高价格分，使评分结果更可信。补充注释说明该边界条件的业务含义。 |
| CR-S4-017 | Medium | `services/api/src/modules/schedule-suggestion/production-suggestion.engine.ts` | 433–449 | **getWeekStart/getWeekEnd 依赖服务器本地时区**: 使用 `new Date()` 和 `toISOString().slice(0,10)` 计算本周起止日期，`toISOString()` 总是返回 UTC 时间。若服务器时区为 UTC+8，周一 00:00-07:59 期间计算会得到上一天的日期（UTC 周日），工人本周工时查询范围错误。 | 改用明确时区的日期计算库（如 `date-fns-tz` 或 `dayjs` 配合 `timezone` 插件），或统一使用 MySQL 的 `WEEK()` 函数在 SQL 层完成本周范围计算，避免跨时区问题。 |
| CR-S4-018 | Medium | `services/web/src/pages/schedule/ScheduleSuggestionPage.tsx` | 全文 | **页面仍使用 Mock 数据，未接入真实 API**: `ScheduleSuggestionPage` 使用静态 `mockPurchaseSuggestions`、`mockProductionSuggestions` 等 Mock 数据渲染，未调用 `useLatestSuggestion`、`useTriggerCalculation` 等已实现的 Hooks。按钮"批准"/"驳回"无事件处理逻辑（无 onClick）。PR 中后端接口和 Hook 层均已实现，但页面层联调缺失，功能为零。 | 替换 Mock 数据为 `useLatestSuggestion()`、`useTriggerCalculation()` 等 Hooks 的真实返回值；为"批准"按钮绑定 `useAcceptItem()`，为"驳回"按钮绑定 `useRejectItem()`（需弹窗输入原因）；移除所有 Mock 常量。 |
| CR-S4-019 | Low | `services/api/src/shared/queue-service.ts` | 147 | **addJob 使用队列名称作为 Job 名称**: `queue.add(queueName, data, options)` 将队列名称（如 `erp.inventory.shortage-recheck`）作为 Job 的 `name` 参数传入，BullMQ 中 Job name 通常用于区分同一队列内不同类型的任务，当前实现语义冗余，且 BullMQ Dashboard 中 Job 名展示会与队列名相同，不便于调试。 | 为每个 Job 类型定义有意义的 name 常量（如 `'shortage-recheck'`、`'suggestion-calculate'`），与队列名保持不同层级的语义。 |
| CR-S4-020 | Low | `services/api/src/modules/schedule-suggestion/schedule-suggestion.service.ts` | 105 | **batchNo 生成后未考虑并发唯一性冲突处理**: `generateNo('schedule_batch', tenantId)` 生成批次编号后直接 INSERT，若并发触发两次计算（如用户快速双击），`uk_tenant_batch_no` 唯一索引会抛出 MySQL Duplicate Key 错误，该异常未被明确捕获转换为业务语义错误，前端会收到 500。 | 在 `triggerCalculation()` 中捕获 `ER_DUP_ENTRY` 错误码，转换为 `AppError.badRequest('计算任务已在进行中，请稍后再试')`，提升错误可读性。 |
| CR-S4-021 | Low | `services/api/src/modules/schedule-suggestion/schedule-suggestion.routes.ts` | 39–43 | **GET /status 路由缺少触发计算角色限制的一致性**: `POST /calculate` 仅允许 `supervisor/boss`，但 `GET /status` 允许额外的 `purchase` 角色。若 `purchase` 角色无法触发计算，也无 jobId 来源，其访问 `/status` 实际意义有限，且角色矩阵不一致容易引起误解。 | 与产品确认 `purchase` 角色是否需要查看计算进度（如查看定时任务进度），若不需要则从 `/status` 路由的 `requireRoles` 中移除 `'purchase'`，保持权限矩阵清晰一致。 |
| CR-S4-022 | Low | `services/api/src/modules/schedule-suggestion/schedule-suggestion.service.ts` | 267–275 | **error_message 截断 2000 字符可能截断多字节字符**: `errMsg.slice(0, 2000)` 对 UTF-8 多字节字符（中文等）按字符截断，但 MySQL `TEXT` 列的字节限制与字符限制不同。若错误信息含大量中文，实际存储字节数可能超出列字节上限。 | 改为先编码后截断：`Buffer.from(errMsg).slice(0, 2000).toString('utf8').replace(/\uFFFD/g, '')`，或直接使用数据库 `TEXT` 类型的实际字节上限（65535 字节），当前 2000 字符的硬截断留有足够余量，可酌情调整但需注意中文场景。 |
| CR-S4-023 | Low | `services/api/src/modules/schedule-suggestion/production-suggestion.engine.ts` | 108–118 | **生产工单查询使用 LEFT JOIN skus 但 sku_name 可能为 NULL**: `LEFT JOIN skus s ON ...` 导致若 SKU 记录被软删除或 `sku_id` 脏数据，`s.sku_name` 为 NULL。代码在 L152 有 `order.sku_name || \`SKU#${order.sku_id}\`` 的 fallback，但 `calcSteps` 中的展示字段未做同样处理，可能向前端透传 null 值。 | 在 SQL 中使用 `COALESCE(s.sku_name, CONCAT('SKU#', po.sku_id))` 做数据库层保底，或确保所有使用 `sku_name` 的地方均有 null 检查。 |

---

## 三、安全专项审查

### 3.1 SQL 注入

| 检查项 | 状态 | 备注 |
|--------|------|------|
| `purchase-suggestion.engine.ts` 全部查询 | 通过 | 所有 `?` 参数化，含 IN 条件使用 placeholders 动态生成 |
| `production-suggestion.engine.ts` 全部查询 | 通过 | `batchQueryMaterialReadiness` IN 条件正确使用 `orderIds.map(() => '?').join(',')` |
| `schedule-suggestion.service.ts` | **未通过** | `getLatest()` 中 `itemTypeCond` 字符串拼接入 SQL（CR-S4-001） |
| `purchase-suggestion.service.ts` 全部查询 | 通过 | `listSuggestions` 动态 WHERE 构造使用参数数组，未发现注入点 |

### 3.2 XSS

| 检查项 | 状态 | 备注 |
|--------|------|------|
| React 前端渲染 | 通过 | JSX 默认 HTML 转义，未发现 `dangerouslySetInnerHTML` 使用 |
| `calc_steps` JSON 数据渲染 | 待确认 | `calc_steps` 从数据库读取后透传至前端，若前端组件直接 innerHTML 渲染需排查（当前 `ScheduleSuggestionPage` 使用 Mock 数据，实际联调后需复查） |

### 3.3 权限控制

| 路由 | 认证 | 角色限制 | 状态 |
|------|------|----------|------|
| `POST /calculate` | authMiddleware | supervisor, boss | 通过 |
| `GET /status` | authMiddleware | supervisor, boss, purchase | 通过（见 CR-S4-021 低优化建议） |
| `GET /latest` | authMiddleware | supervisor, boss, purchase | 通过 |
| `GET /history` | authMiddleware | supervisor, boss, purchase | 通过 |
| `POST /items/:id/accept` | authMiddleware | supervisor, boss, purchase | 通过 |
| `POST /items/:id/reject` | authMiddleware | supervisor, boss, purchase | 通过 |
| `POST /items/:id/apply` | authMiddleware | supervisor, boss | 通过（排产应用权限收紧） |
| `GET /purchase-steps/:id` | authMiddleware | supervisor, boss, purchase | 通过 |
| `GET /:id` | authMiddleware | supervisor, boss, purchase | 通过 |

### 3.4 AI 建议禁止自动执行

| 检查项 | 状态 | 备注 |
|--------|------|------|
| `PurchaseSuggestionEngine` 不调用 `PurchaseOrderService.create()` | 通过 | 纯计算，仅 SELECT 查询，无任何 INSERT/UPDATE |
| `ProductionSuggestionEngine` 不调用排产确认接口 | 通过 | 仅更新 `production_orders.priority_score`，不触发排产状态机 |
| `applyProductionSuggestion` 仅写 `priority_score` | 通过 | 已验证，不触发工单状态变更 |

### 3.5 BE-S4-16：source=ai_schedule 强制审批校验

| 检查项 | 状态 | 备注 |
|--------|------|------|
| `batchCreatePOFromSuggestions` 中 `approved_by` 非空校验 | 通过 | L166–174 明确 filter 出 `source='ai_schedule' && !approved_by` 的记录并抛 403 |
| 非 AI 建议跳过该校验 | 通过 | 仅对 `source === 'ai_schedule'` 生效，不影响其他来源建议 |

---

## 四、架构专项审查

### 4.1 模块职责

| 模块 | 评价 |
|------|------|
| `queue.config.ts` | 职责单一，仅负责连接配置和常量定义，合格 |
| `queue-service.ts` | 职责清晰，封装队列操作和降级逻辑，但 `bullmqAvailable` 状态不可恢复是设计缺陷（CR-S4-014） |
| `event-bus.service.ts` | 向前兼容设计良好，`subscribe()` 签名未变更；降级路径存在数据丢失（CR-S4-010） |
| `purchase-suggestion.engine.ts` | 职责单一，纯计算无副作用，四步算法清晰；N+1 查询是性能严重问题（CR-S4-004） |
| `production-suggestion.engine.ts` | 三维评分算法结构清晰；工人负载字段语义错误（CR-S4-009）和时区问题（CR-S4-017）需修复 |
| `schedule-suggestion.service.ts` | 职责涵盖触发、执行、查询、操作，略显臃肿；核心问题是明细写入缺事务（CR-S4-005）和竞态（CR-S4-003） |
| `schedule-suggestion.controller.ts` | 符合薄 Controller 原则，Zod 校验完整，无业务逻辑渗透 |
| `schedule-suggestion.routes.ts` | 路由注册顺序正确（固定路径在参数路由之前），权限配置合理 |

### 4.2 BullMQ 降级保护

降级机制设计思路正确（Redis 不可用时回退到同步 EventEmitter），但存在以下问题：

1. `bullmqAvailable` 标志不可自动恢复（CR-S4-014）——进程级别的永久性能退化
2. 降级路径下 `shortageItems` 信息丢失（CR-S4-010）——功能降级
3. 降级日志级别为 `WARN`，符合运维告警要求

### 4.3 EventBus 向前兼容性

- `subscribe()` 方法签名完全未变更，调用方代码无需修改，向前兼容设计合格
- 新增 `publish()` 对迁移事件的路由分发逻辑清晰，`default` 分支保持原有 `emit()` 行为
- 无未迁移事件被意外路由到 BullMQ 的风险

---

## 五、性能专项审查

| 检查项 | 状态 | 说明 |
|--------|------|------|
| 采购建议引擎 N+1 查询 | **不通过** | 每个缺料 SKU 产生 4 次独立查询（CR-S4-004），生产环境 50 个 SKU = 200 次 DB 查询 |
| 批量物料就绪度查询 | 通过 | `batchQueryMaterialReadiness` 一次 IN 查询获取全部工单数据，正确 |
| 工人负载查询 | 通过 | 单次查询，不随工单数量增长 |
| `getLatest()` 明细全量返回 | **不通过** | 含 `calc_steps` 大 JSON 字段的 SELECT * 响应体过大（CR-S4-012） |
| 数据库索引设计 | 通过 | `idx_tenant_status`、`idx_tenant_created`、`idx_job_id` 等关键索引均已创建 |
| React Query 缓存策略 | 通过 | `staleTime` 配置合理（latest: 30s，history: 60s，snapshot: 5min） |
| 轮询间隔 | 通过 | 2 秒轮询，任务完成/失败后自动停止 |

---

## 六、修复优先级建议

**必须在合并前修复（阻断）**:

1. CR-S4-001 — SQL 注入风险（`getLatest` 字符串拼接）
2. CR-S4-002 — SuggestionWorker 未注册到优雅退出，数据损坏风险
3. CR-S4-003 — 并发重复执行竞态，明细数据错乱
4. CR-S4-004 — N+1 查询，生产环境性能不可接受
5. CR-S4-005 — 明细写入无事务，partial write 数据不一致
6. CR-S4-006 — 驳回接口缺少 reason 参数，功能完全不可用
7. CR-S4-007 — 历史批次详情路由路径错误，功能完全不可用
8. CR-S4-008 — 批量应用排产接口路由不存在，功能完全不可用
9. CR-S4-009 — 工人负载字段语义错误，工人推荐结果不可信

**应在本 Sprint 修复（高优）**:

- CR-S4-010 — 降级路径 shortageItems 丢失
- CR-S4-012 — getLatest 全量返回 calc_steps 大字段
- CR-S4-014 — bullmqAvailable 不可恢复
- CR-S4-017 — 时区问题导致工人工时范围计算错误
- CR-S4-018 — 页面未接入真实 API，功能为零

**下一 Sprint 跟进（中/低优）**:

- CR-S4-011、CR-S4-013、CR-S4-015、CR-S4-016、CR-S4-019～CR-S4-023

---

*报告生成于 2026-03-14，审查人：code-reviewer（Claude Code Review Agent）*
