# Sprint 4 安全审计报告

**文档编号**: SEC-AUDIT-S4-001
**审计日期**: 2026-03-14
**审计工程师**: Security Engineer
**审计范围**: Sprint 4 P0 核心后端实现（13 个文件）
**依赖前置审计**: sprint3-security-audit.md

---

## 1. 审计概述

### 1.1 综合评分

| 维度 | 得分 | 满分 | 说明 |
|------|------|------|------|
| SQL 注入防护 | 92 | 100 | 存在一处动态 IN 占位符构造，整体合规 |
| 权限控制覆盖率 | 88 | 100 | apply 接口角色边界存在争议，purchase 角色可接受建议存在隐患 |
| 调度建议自动执行旁路防护 | 95 | 100 | AI 建议强制审批已实现，存在一处状态校验缺失 |
| Redis/BullMQ 连接安全 | 80 | 100 | 无 TLS 配置，Redis 密码注入后未二次验证 |
| 敏感数据日志泄露 | 78 | 100 | Worker 日志明文输出 message 字段，存在信息泄露风险 |
| 输入验证完整性 | 90 | 100 | 主要路径 Zod 覆盖良好，jobId 参数缺少格式约束 |
| 整数/精度安全 | 96 | 100 | Decimal.js 全量使用，无明显精度问题 |
| 批量操作 DoS 防护 | 75 | 100 | 批量 IN 查询无上限，batchCreatePOFromSuggestions 无条数限制 |

**综合评分**: 87 / 100

### 1.2 审计结论

**条件通过**

Sprint 4 整体安全设计意识良好，参数化查询覆盖率高，AI 建议强制人工审批机制是本 Sprint 最重要的安全设计亮点，乐观锁防 TOCTOU 竞态的实现也属规范做法。但存在以下必须在发布前修复的问题：

- **1 个高危问题**（FIND-S4-003）：NotificationWorker 明文日志输出通知内容，message 字段可能包含业务敏感信息
- **1 个高危问题**（FIND-S4-007）：批量转单接口无条数上限，可被用于 DoS 攻击
- **3 个中危问题**：Redis 无 TLS、purchase 角色对排产建议可接受、jobId 无格式校验

高危问题修复完毕后方可上线。

---

## 2. 发现列表

### FIND-S4-001
- **严重级别**: 中危
- **文件**: `services/api/src/shared/queue.config.ts`
- **问题描述**: `getBullMQConnectionOptions()` 不支持 Redis TLS（`tls` 字段未配置）。在生产环境中 Redis 与应用服务器若不在同一私有网络，或使用云托管 Redis（如 AWS ElastiCache TLS 模式、阿里云 Redis 加密模式），连接将以明文传输，Redis 认证令牌及队列 Payload（含 tenantId、userId 等）可被网络嗅探截获。
- **受影响代码**:
  ```ts
  // queue.config.ts 第 46-54 行
  return {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: Number(process.env.REDIS_PORT ?? 6379),
    password: process.env.REDIS_PASSWORD ?? undefined,
    // 缺少 tls 配置
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  };
  ```
- **修复建议**: 新增 `REDIS_TLS=true` 环境变量，当其为 `true` 时在连接配置中注入 `tls: {}` 字段。同时在 DevOps 部署规范中明确要求生产环境开启 Redis TLS。

---

### FIND-S4-002
- **严重级别**: 低危
- **文件**: `services/api/src/shared/queue-service.ts`
- **问题描述**: `QueueService.addJob()` 在 BullMQ 异常降级时，通过 `fallbackEmitter.emit()` 同步触发降级处理器。降级路径的 Job Payload 未经过任何模式校验，若上游传入异常 data（如 `skuId` 为 NaN、`tenantId` 为负数），降级处理器会直接将其透传给 `EventBusFacade`，可能引发下游逻辑错误或静默数据污染。此外，`bullmqAvailable` 标记一旦被置为 `false` 后不会自动恢复，即使 Redis 重连成功后所有 Job 仍走降级路径。
- **修复建议**:
  1. 降级 handler 入口增加基础字段存在性校验（tenantId/userId 必须为正整数）。
  2. `bullmqAvailable` 重置机制：在 Queue `error` 事件恢复时（可监听 `ready` 事件）重新置为 `true`。

---

### FIND-S4-003
- **严重级别**: 高危
- **文件**: `services/api/src/workers/notification.worker.ts`
- **问题描述**: Worker 明文将 `message` 字段输出到日志：
  ```ts
  // notification.worker.ts 第 36 行
  console.log(`[NotificationWorker] 通知内容: ${message}`);
  ```
  `message` 字段由 `event-bus.service.ts` 构造，内容为 `生产工单 #${p.productionOrderId} 检测到缺料，共 ${p.shortageItems.length} 种物料不足`。虽然当前 MVP 阶段内容较简单，但随着后续迭代对接钉钉/邮件，`message` 极可能包含收件人手机号、邮箱、物料成本等敏感信息。日志聚合系统（ELK/Loki）若未做脱敏，将导致敏感信息大规模持久化泄露。
- **修复建议**: 立即移除或屏蔽完整 `message` 内容的日志输出。仅保留 `type`、`targetId`、`tenantId` 等非敏感标识字段。如需调试，使用 DEBUG 级别日志并要求生产环境 LOG_LEVEL=info。

---

### FIND-S4-004
- **严重级别**: 中危
- **文件**: `services/api/src/workers/suggestion.worker.ts`
- **问题描述**: SuggestionWorker 在构建 `ScheduleSuggestionService` 时硬编码了系统级高权限角色：
  ```ts
  // suggestion.worker.ts 第 56-58 行
  const service = new ScheduleSuggestionService({
    tenantId,
    userId: 0,
    roles: ['supervisor', 'boss'], // 系统级权限，可访问全量数据
  });
  ```
  若 BullMQ 队列被攻击者通过 Redis 未授权访问（FIND-S4-001 的延伸）伪造 Job Payload（篡改 `tenantId`），Worker 将以 supervisor/boss 角色跨租户执行计算，导致跨租户数据越权访问。此问题与 FIND-S4-001 联合利用时上升为高危。
- **修复建议**:
  1. `executeCalculation` 内部需强制校验 `batchId` 与 `tenantId` 的归属关系（已有，第 161-166 行），需确保此校验在任何代码路径下不可被绕过。
  2. 修复 FIND-S4-001（启用 Redis TLS + 密码认证），从根本上消除队列注入风险。
  3. 考虑对 Job Payload 增加 HMAC 签名验证，Worker 消费前验签。

---

### FIND-S4-005
- **严重级别**: 中危
- **文件**: `services/api/src/modules/schedule-suggestion/schedule-suggestion.routes.ts`
- **问题描述**: `purchase` 角色被允许调用接受/驳回建议接口：
  ```ts
  // schedule-suggestion.routes.ts 第 71、81 行
  router.post('/items/:itemId/accept', requireRoles('supervisor', 'boss', 'purchase'), ...)
  router.post('/items/:itemId/reject', requireRoles('supervisor', 'boss', 'purchase'), ...)
  ```
  `getLatest` 中已针对 `purchase` 角色做了数据过滤（只返回 `item_type='purchase'` 的明细），但 `acceptItem`/`rejectItem` 在 Service 层的 `findItem` 仅校验 `tenant_id`，未校验 `item_type`。这意味着 `purchase` 角色可以通过直接构造 `itemId` 来接受/驳回类型为 `production` 的排产建议，越权访问其无权查看的数据。
- **修复建议**: 在 `ScheduleSuggestionService.findItem()` 调用后增加 `item_type` 授权校验：若当前用户仅有 `purchase` 角色，则拒绝操作 `item_type='production'` 的明细。

---

### FIND-S4-006
- **严重级别**: 低危
- **文件**: `services/api/src/modules/schedule-suggestion/schedule-suggestion.controller.ts`
- **问题描述**: `GetStatusQuerySchema` 中 `jobId` 仅声明为 `z.string().optional()`，未做格式约束：
  ```ts
  // schedule-suggestion.controller.ts 第 27-29 行
  const GetStatusQuerySchema = z.object({
    jobId: z.string().optional(),
  });
  ```
  BullMQ 的 Job ID 格式为数字字符串（如 `"schedule-suggestion-123"` 或纯数字）。攻击者可传入超长字符串（如 10000 字符），在 `queueService.getJobStatus()` 中被传递给 Redis `HGET` 命令，浪费连接资源。虽不构成注入，但属于输入验证不完整。
- **修复建议**: 增加 `jobId` 长度限制，例如 `z.string().max(128).optional()`，并可加 `regex(/^[\w\-:]+$/)` 限制字符集。

---

### FIND-S4-007
- **严重级别**: 高危
- **文件**: `services/api/src/modules/purchase/purchase-suggestion.service.ts`
- **问题描述**: `batchCreatePOFromSuggestions()` 对输入的 `suggestionIds` 数组无上限约束：
  ```ts
  // purchase-suggestion.service.ts 第 150-153 行
  async batchCreatePOFromSuggestions(suggestionIds: number[]): Promise<BatchToPOResult> {
    if (suggestionIds.length === 0) {
      throw AppError.badRequest('至少选择一条采购建议', ...);
    }
    // 无最大条数校验
    const placeholders = suggestionIds.map(() => '?').join(',');
  ```
  攻击者（具有 purchase 角色）可传入包含数千个 ID 的数组，触发以下问题：
  1. 超大 `IN (?, ?, ... × 5000)` SQL 语句导致 MySQL 解析超时或 OOM。
  2. 事务内循环 `INSERT` 数千行持有长时间行锁，影响其他业务并发写入。
  3. 大量 `generateNo()` 调用占用序列号资源。
  此问题在 Controller 层未见对应 Zod 校验，漏洞完整暴露。
- **修复建议**: 在 Service 入口增加条数上限校验（建议最大 100 条），并在对应 Controller 的 Zod Schema 中同步限制数组长度：`z.array(z.number().int().positive()).min(1).max(100)`。

---

### FIND-S4-008
- **严重级别**: 低危
- **文件**: `services/api/src/modules/schedule-suggestion/schedule-suggestion.service.ts`
- **问题描述**: `acceptItem()` 接受 `modifiedQty` 参数时，Controller 层已通过 Zod regex 校验格式（`/^\d+(\.\d{1,4})?$/`），但 Service 层的 `acceptItem` 方法签名接受原始 `string`，未对数值范围进行业务约束（如是否允许 modifiedQty 为 `0`，或是否超过合理上限如 `999999.9999`）。当前 Zod regex 允许 `"0"` 和 `"0.0000"` 通过，可能导致建议数量被修改为零从而静默产生无效数据。
- **修复建议**: 在 Controller 的 `AcceptItemSchema` 中将 `modifiedQty` 的 regex 修改为强制要求数值大于 0，例如 `z.string().regex(/^(?!0(\.0+)?$)\d+(\.\d{1,4})?$/, '数量必须大于0')`，或在 Service 层增加 `new Decimal(modifiedQty).lte(0)` 的校验并抛出 badRequest。

---

### FIND-S4-009
- **严重级别**: 低危
- **文件**: `services/api/src/modules/schedule-suggestion/schedule-suggestion.service.ts`
- **问题描述**: `executeCalculation()` 在将错误信息写入数据库时做了截断保护（`errMsg.slice(0, 2000)`），但该错误信息可能包含数据库查询内部错误（如 MySQL 错误消息中携带的 SQL 片段、表结构信息）。这些信息以明文存入 `schedule_suggestions.error_message`，若该字段通过 `getStatus`/`getHistory` API 返回给前端，可能泄露内部数据库结构。
- **修复建议**: 对 `error_message` 进行脱敏处理，生产环境下仅记录通用错误类型（如 `CALCULATION_FAILED`）和错误码，详细堆栈仅写入服务端日志。在 `getStatus`/`getHistory` 响应中对 `error_message` 字段进行过滤，非 supervisor/boss 角色不返回原始错误信息。

---

### FIND-S4-010
- **严重级别**: 信息
- **文件**: `services/api/src/workers/mrp.worker.ts`
- **问题描述**: Worker 启动日志输出 `tenantId`、`skuId`、`receiptId`、`poId` 等业务标识符，每次处理 Job 都会产生包含业务 ID 的日志条目。这些信息在日志聚合系统中长期保留，若日志系统访问控制不当可能成为信息收集的来源。
- **修复建议**: 将 Job 处理详情日志降级为 DEBUG 级别，INFO 级别仅保留 `Job #${job.id} 处理完成` 等非业务 ID 的状态信息。生产环境 LOG_LEVEL 配置为 info 即可规避。

---

## 3. 安全检查矩阵

### 3.1 SQL 注入防护

| 检查点 | 文件 | 状态 | 说明 |
|--------|------|------|------|
| purchase-suggestion.engine.ts 主查询 | engine | 通过 | `WHERE mr.tenant_id = ?` 参数化 |
| purchase-suggestion.engine.ts IN 批量查询 | engine | 通过（注意） | `skuPlaceholders = skuIds.map(() => '?').join(',')` 动态构造占位符，值来自数据库查询结果（number[]），无注入风险，但需确保 skuIds 来源始终受控 |
| production-suggestion.engine.ts 所有查询 | engine | 通过 | 全参数化，batchQueryMaterialReadiness IN 构造同上 |
| schedule-suggestion.service.ts 所有查询 | service | 通过 | CR-S4-001 修复后已全参数化，itemTypeFilter 动态拼接安全（值为固定字符串 `'purchase'`，非用户输入） |
| purchase-suggestion.service.ts listSuggestions | service | 通过 | `conds` 数组 + `qParams` 分离构造，`WHERE ${where}` 中的条件均使用 `?` 占位符 |
| purchase-suggestion.service.ts batchCreatePO | service | 通过 | 批量 IN 占位符构造方式同 engine，安全 |

**结论**: SQL 注入防护整体合规。动态 IN 占位符构造模式（`ids.map(() => '?').join(',')`）是已知安全模式，但必须确保 `ids` 数组来源于数据库查询或经过严格类型校验的输入，Sprint 4 代码中均满足此要求。

### 3.2 权限控制覆盖率

| 路由 | 认证 | 角色控制 | 状态 | 备注 |
|------|------|----------|------|------|
| POST /calculate | authMiddleware | supervisor, boss | 通过 | 正确限制触发权限 |
| GET /status | authMiddleware | supervisor, boss, purchase | 通过 | 合理 |
| GET /latest | authMiddleware | supervisor, boss, purchase | 通过 | Service 层有角色过滤 |
| GET /history | authMiddleware | supervisor, boss, purchase | 通过 | |
| GET /:id | authMiddleware | supervisor, boss, purchase | 通过 | |
| POST /items/:itemId/accept | authMiddleware | supervisor, boss, purchase | 待修复 | FIND-S4-005：purchase 可操作排产建议 |
| POST /items/:itemId/reject | authMiddleware | supervisor, boss, purchase | 待修复 | FIND-S4-005：purchase 可操作排产建议 |
| POST /items/:itemId/apply | authMiddleware | supervisor, boss | 通过 | 正确限制应用权限 |
| GET /purchase-steps/:id | authMiddleware | supervisor, boss, purchase | 通过 | |

### 3.3 调度建议禁止自动执行旁路风险

| 控制点 | 实现位置 | 状态 | 说明 |
|--------|----------|------|------|
| AI 建议强制人工审批 | purchase-suggestion.service.ts L166-173 | 通过 | `source='ai_schedule' AND !approved_by` 硬拦截，异常路径为 forbidden |
| 状态机校验（pending 才可操作） | schedule-suggestion.service.ts L462, L505 | 通过 | accept/reject 均校验 `status !== 'pending'` |
| 乐观锁防 Worker 并发竞态 | schedule-suggestion.service.ts L172-181 | 通过 | `WHERE status='pending'` 原子更新，affectedRows=0 时跳过 |
| apply 接口仅更新 priority_score 不触发自动排产 | schedule-suggestion.service.ts L550-566 | 通过 | 符合"建议仅供参考"设计约束 |
| Worker 系统角色越权风险 | suggestion.worker.ts L54-58 | 待修复 | FIND-S4-004：依赖 Redis 安全，需启用 TLS |

### 3.4 BullMQ Redis 连接安全

| 检查点 | 状态 | 说明 |
|--------|------|------|
| Redis 密码认证 | 通过 | `REDIS_PASSWORD` 环境变量注入，未设置时为 undefined（不传 AUTH） |
| Redis prefix 隔离 | 通过 | `erp_bullmq` 与 `bull:` 完全隔离，避免 Key 冲突 |
| Redis TLS 加密传输 | 待修复 | FIND-S4-001：无 TLS 配置 |
| 连接参数来源 | 通过 | 全部来自环境变量，无硬编码 |
| maxRetriesPerRequest=null 合规性 | 通过 | BullMQ 官方要求，符合规范 |
| 队列名称白名单 | 通过 | `addJob` 通过 `this.queues.get(queueName)` 检查，未注册队列返回 null |

### 3.5 敏感数据日志泄露

| 检查点 | 文件 | 状态 | 说明 |
|--------|------|------|------|
| 通知 message 完整输出 | notification.worker.ts L36 | 待修复 | FIND-S4-003 高危 |
| Job Payload 业务 ID 输出 | mrp.worker.ts L29-33 | 信息 | FIND-S4-010，建议降级 DEBUG |
| 数据库错误信息暴露 | schedule-suggestion.service.ts L277 | 待修复 | FIND-S4-009，需脱敏 |
| Redis 密码不在日志中 | queue.config.ts | 通过 | 连接配置不打印 password |
| JWT payload 不在日志中 | auth.ts | 通过 | 无 payload 打印 |

### 3.6 输入验证（Zod Schema 完整性）

| 接口/参数 | Schema | 状态 | 说明 |
|-----------|--------|------|------|
| POST /calculate body | TriggerCalculationSchema | 通过 | enum 限制 triggerType |
| GET /status query.jobId | GetStatusQuerySchema | 待修复 | FIND-S4-006：无长度/格式限制 |
| GET /history query | PaginationSchema | 通过 | 复用已有分页校验 |
| POST /items/:itemId/accept body.modifiedQty | AcceptItemSchema regex | 通过（注意） | regex 允许 "0"，见 FIND-S4-008 |
| POST /items/:itemId/reject body.reason | RejectItemSchema | 通过 | min(1) max(500) 合规 |
| POST batchCreatePO body.suggestionIds | 未见 Controller 代码 | 待修复 | FIND-S4-007：无数组上限校验 |
| params.id / params.itemId | z.coerce.number().int().positive() | 通过 | 全路由覆盖 |

### 3.7 整数溢出与精度安全

| 检查点 | 状态 | 说明 |
|--------|------|------|
| 金额计算（capitalCost、totalAmount） | 通过 | 全程 Decimal.js，无 float 运算 |
| 评分计算（deadlineScore、priorityScore 等） | 通过 | Decimal.js，结果 toFixed(2) 约束精度 |
| 库存缺口计算（shortageQty） | 通过 | `Decimal.max(..., 0)` 防负值 |
| 分页 offset 计算 | 通过 | `(page - 1) * pageSize`，page/pageSize 均为 z.coerce.number().int() |
| Job Payload 数值字段 | 通过 | TypeScript 类型约束为 number |
| DECIMAL(15,4) 列最大值安全 | 通过 | 15 位精度足够覆盖 ERP 业务场景 |

### 3.8 批量操作 DoS 风险

| 检查点 | 状态 | 说明 |
|--------|------|------|
| batchCreatePOFromSuggestions 无条数上限 | 待修复 | FIND-S4-007 高危 |
| purchase-suggestion.engine.ts skuIds IN 查询 | 通过（注意） | skuIds 来源于数据库查询结果，受限于实际缺料 SKU 数量，极端情况下仍可能产生大型 IN 语句，建议监控 |
| production-suggestion.engine.ts orderIds IN 查询 | 通过（注意） | 同上，来源受限于数据库工单数量 |
| SuggestionWorker concurrency=1 | 通过 | 重量级计算单并发，防止数据库竞争 |
| MrpWorker concurrency=3 | 通过 | 合理并发限制 |
| NotificationWorker concurrency=5 | 通过 | 轻量 I/O 合理 |
| BullMQ removeOnComplete/removeOnFail | 通过 | 分别保留 200/500 条，防止 Redis Key 无限增长 |

---

## 4. 结论

### 4.1 安全亮点

1. **AI 建议强制人工审批机制**（FIND 无）：`purchase-suggestion.service.ts` 中对 `source='ai_schedule'` 的建议强制校验 `approved_by`，从根本上防止 AI 自动执行旁路，是本 Sprint 最重要的安全设计。

2. **参数化查询全量覆盖**：13 个文件中所有 SQL 均使用参数化查询，动态 IN 占位符采用 `ids.map(() => '?').join(',')` 安全模式，SQL 注入风险极低。

3. **乐观锁防 TOCTOU 竞态**：`executeCalculation` 通过 `WHERE status='pending'` 原子更新防止并发 Worker 重复计算，是正确的并发安全实现。

4. **多租户隔离一致性**：所有查询均携带 `tenant_id` 过滤，`findItem` 等私有方法也严格隔离，跨租户越权风险低。

5. **Decimal.js 全量使用**：所有金额和评分计算均使用 Decimal.js，无 JavaScript 浮点精度问题。

### 4.2 必须修复项（上线阻断）

| 编号 | 级别 | 文件 | 问题摘要 | 预计工作量 |
|------|------|------|----------|-----------|
| FIND-S4-003 | 高危 | notification.worker.ts | 通知 message 明文日志 | 0.5h |
| FIND-S4-007 | 高危 | purchase-suggestion.service.ts | 批量转单无条数上限 DoS | 1h |

### 4.3 建议修复项（上线前完成）

| 编号 | 级别 | 文件 | 问题摘要 | 预计工作量 |
|------|------|------|----------|-----------|
| FIND-S4-001 | 中危 | queue.config.ts | Redis 无 TLS 配置 | 2h（含 DevOps 配置） |
| FIND-S4-004 | 中危 | suggestion.worker.ts | Worker 系统角色越权风险（依赖 FIND-S4-001） | 3h |
| FIND-S4-005 | 中危 | schedule-suggestion.routes.ts | purchase 角色可操作排产建议 | 1h |

### 4.4 优化建议（下一迭代）

| 编号 | 级别 | 问题摘要 |
|------|------|----------|
| FIND-S4-002 | 低危 | BullMQ 降级路径 Payload 缺少校验 + bullmqAvailable 无法自动恢复 |
| FIND-S4-006 | 低危 | jobId 查询参数无格式/长度约束 |
| FIND-S4-008 | 低危 | modifiedQty 允许为 0 的边界问题 |
| FIND-S4-009 | 低危 | error_message 可能泄露数据库内部信息 |
| FIND-S4-010 | 信息 | Worker 日志 DEBUG 级别隔离 |

### 4.5 最终审计结论

**条件通过**：FIND-S4-003（高危，30 分钟修复）和 FIND-S4-007（高危，1 小时修复）完成修复并经过代码复核后，Sprint 4 P0 实现可进入 DevOps 部署流程。

---

*本报告由 Security Engineer 基于代码静态分析生成，不替代运行时渗透测试。建议在正式发布前配合 QA 工程师执行边界用例验证。*

**审计通过状态**: 条件通过（2 个高危问题待修复）
**下一步**: 将 FIND-S4-003 和 FIND-S4-007 提交至缺陷跟踪系统，由 Backend Engineer 修复后由 Code Reviewer 复核。
