# Sprint 3 后端安全审计报告

**审计角色**: Security Engineer
**审计日期**: 2026-03-14
**审计版本**: Sprint 3 (基于 commit 09eda23)
**审计员**: Security Engineer (claude-sonnet-4-6)

---

## 1. 审计范围

### 1.1 审计文件列表

| 编号 | 文件路径 | 模块 | 代码行数 |
|------|----------|------|----------|
| F-01 | `services/api/src/modules/incoming-inspection/incomingInspection.service.ts` | R-09 来料质检 | 679 |
| F-02 | `services/api/src/modules/incoming-inspection/incomingInspection.controller.ts` | R-09 来料质检 | 97 |
| F-03 | `services/api/src/modules/incoming-inspection/incomingInspection.routes.ts` | R-09 来料质检 | 73 |
| F-04 | `services/api/src/modules/return-order/returnOrder.service.ts` | R-09 退货 | 377 |
| F-05 | `services/api/src/modules/return-order/returnOrder.controller.ts` | R-09 退货 | 82 |
| F-06 | `services/api/src/modules/return-order/returnOrder.routes.ts` | R-09 退货 | 74 |
| F-07 | `services/api/src/modules/mrp/mrp.service.ts` | R-11 MRP | 666 |
| F-08 | `services/api/src/modules/mrp/mrp.controller.ts` | R-11 MRP | 99 |
| F-09 | `services/api/src/modules/mrp/mrp.routes.ts` | R-11 MRP | 43 |
| F-10 | `services/api/src/modules/production/bom-expansion.service.ts` | R-10 BOM展开 | 156 |
| F-11 | `services/api/src/modules/production/bom-snapshot.service.ts` | R-10 BOM快照 | 132 |
| F-12 | `services/api/src/modules/production/production-order.service.ts` | R-10 生产工单 | 669 |
| F-13 | `services/api/src/modules/production/production-order.controller.ts` | R-10 生产工单 | 84 |
| F-14 | `services/api/src/modules/production/workflow-engine.service.ts` | R-10 工作流 | 285 |
| F-15 | `services/api/src/modules/production/production.routes.ts` | R-10 路由 | 93 |
| F-16 | `services/api/src/modules/purchase/purchase-suggestion.service.ts` | R-11 采购建议 | 272 |
| F-17 | `services/api/src/modules/purchase/purchaseSuggestion.controller.ts` | R-11 采购建议 | 54 |
| F-18 | `services/api/src/modules/purchase/purchaseSuggestion.routes.ts` | R-11 采购建议 | 32 |
| F-19 | `services/api/src/modules/events/event-bus.service.ts` | 事件总线 | 40 |
| F-20 | `infra/db/init.sql` (Sprint 3 新增表及 ALTER TABLE 部分) | 数据库 | ~210 |

### 1.2 审计重点

- SQL 注入：所有 SQL 语句是否使用参数化查询
- 权限控制：所有路由是否有 `requireRoles` 中间件保护
- 多租户隔离：所有查询是否携带 `tenant_id`
- 输入校验：Zod schema 是否覆盖所有用户输入
- 数据安全：敏感数据是否有泄露风险
- 并发安全：事务与行锁是否正确使用
- 拒绝服务：BOM 递归深度限制、大批量操作防护
- 业务安全：BD-001 BOM 快照不可篡改、BD-004 不合格品必须退货

---

## 2. 发现问题列表

### 2.1 Critical（阻断级）

> 本次审计未发现 Critical 级别的新问题。

---

### 2.2 High（高危）

#### SA-H-001: 编号生成存在碰撞风险，可致幂等位失效

- **文件**: `F-01` incomingInspection.service.ts:9-29 / `F-04` returnOrder.service.ts:9-18 / `F-11` bom-snapshot.service.ts:86-92 / `F-12` production-order.service.ts:184-191
- **问题描述**: `generateInspectionNo()`、`generateReceiptNo()`、`generateReturnNo()`、快照编号、工单编号均使用 `Math.random() * 9999`（4 位随机数）。单日并发量超过 9999 时，同一天内必然出现重复编号。数据库对 `(tenant_id, inspection_no)` 设有 UNIQUE 约束，重复时会抛出 DB 唯一键冲突异常，但该异常未被捕获为业务友好错误，会以 500 形式透传给调用方，暴露数据库错误堆栈。更深层风险：在极低概率的碰撞场景下，若异常在事务提交前触发，入库/退货等幂等位可能已部分写入，导致数据不一致。
- **修复建议**:
  1. 将随机部分替换为数据库自增序列或 Redis INCR 原子计数器，与日期组合生成全局唯一编号（参考已有的 `generateNo()` 共享工具）。
  2. 所有 Service 统一调用 `generateNo(type, tenantId)`，废弃各模块自行实现的随机编号函数。
  3. 在 Controller 层捕获 DB 唯一键错误（ER_DUP_ENTRY / errno 1062），返回业务友好的 409 Conflict 响应，避免堆栈信息泄露。

#### SA-H-002: 采购建议批量转单 IN 子句未校验 suggestionIds 数组长度上限

- **文件**: `F-16` purchase-suggestion.service.ts:154
- **问题描述**: `batchCreatePOFromSuggestions()` 接收 `suggestionIds: number[]`，Zod schema 仅做 `min(1)` 校验，未设置上限。攻击者可构造包含数万个 ID 的数组，使 `IN (${placeholders})` 子句展开为超长 SQL，导致 MySQL 解析器过载（OOM 风险）或慢查询阻塞数据库连接池。
- **修复建议**:
  1. 在 `BatchToPOSchema` 中添加 `.max(200)` 限制：`z.array(z.number().int().positive()).min(1).max(200)`。
  2. Service 层同步添加防御断言：`if (suggestionIds.length > 200) throw AppError.badRequest(...)`。

#### SA-H-003: 生产工单详情接口暴露客户 customer_id

- **文件**: `F-12` production-order.service.ts:424
- **问题描述**: `getById()` 的 SELECT 语句直接返回 `so.customer_id`，该字段会透传到 API 响应。根据最小权限原则，生产工单详情不应暴露销售订单的客户 ID，否则仓库工人角色（`worker`）可通过工单详情接口遍历获取所有客户 ID，形成数据越权访问。
- **修复建议**:
  1. 从 SELECT 中移除 `so.customer_id` 字段，或在 Controller 层进行字段过滤，仅对 `supervisor`/`boss` 角色返回该字段。
  2. 评估是否需要对 `GET /production/orders/:id` 路由增加 `requireRoles('supervisor', 'boss', 'worker')` 并在 Service 层按角色裁剪返回字段。

---

### 2.3 Medium（中危）

#### SA-M-001: 质检列表和退货列表查询缺少 Enum 白名单校验

- **文件**: `F-02` incomingInspection.controller.ts:40-45 / `F-05` returnOrder.controller.ts:26-31
- **问题描述**: `ListInspectionQuerySchema` 中 `status` 和 `result` 字段使用 `z.string().optional()`，未限定为合法枚举值（如 `draft | in_progress | passed | ...`）。攻击者可传入任意字符串，虽经过参数化查询不会造成 SQL 注入，但会产生无意义的数据库查询，且不符合最小输入验证原则。`ListReturnOrderQuerySchema` 中 `status` 和 `returnType` 同样未做枚举约束。
- **修复建议**:
  将 `z.string().optional()` 改为 `z.enum(['draft','in_progress','passed','partially_passed','failed']).optional()` 等严格枚举类型，拒绝非法值在到达数据库之前即返回 400。

#### SA-M-002: 采购建议控制器 list 接口未使用 Zod 校验查询参数

- **文件**: `F-17` purchaseSuggestion.controller.ts:18-26
- **问题描述**: `list()` 方法中分页参数通过 `Number(req.query.page)` 手动转换，`status`/`source`/`skuId` 直接从 `req.query` 取值后传入 Service，未经 Zod schema 解析。若传入 `skuId=abc`，`Number('abc')` 得到 `NaN`，进入 SQL 参数后行为不确定（MySQL 会将 NaN 转为 0，导致意外的全表扫描条件匹配）。其他模块均统一使用 `z.coerce.number()` 处理该场景。
- **修复建议**:
  在 `list()` 中引入 `PaginationSchema.extend({ status: z.string().optional(), source: z.string().optional(), skuId: z.coerce.number().int().positive().optional() }).parse(req.query)`，与项目其他 Controller 保持一致。

#### SA-M-003: workflow-engine 半成品入库未校验 completedQty 数值合法性

- **文件**: `F-14` workflow-engine.service.ts:67-70, 163-166
- **问题描述**: `onTaskCompleted()` 接收的 `completedQty: string` 直接用于 SQL INSERT（`qty_input`、`qty_stock_unit`）和库存 UPSERT，未做 Decimal 有效性校验。若调用方传入非数字字符串（如空串 `""`、`"NaN"`），`new Decimal("")` 会抛出 InvalidOperation 异常，该异常未被捕获，会中断整个完工事务并以 500 返回，同时 inventory 更新可能以脏值写入。
- **修复建议**:
  在 `onTaskCompleted()` 入口处添加：
  ```typescript
  const qty = new Decimal(completedQty);
  if (qty.lte(0)) throw AppError.badRequest('完工数量必须大于0');
  ```
  并在 `production.controller.ts` 对应的 `completeTask` 端点的 Zod schema 中校验 `completedQty` 为正数字符串。

#### SA-M-004: MRP 全局缺料汇总接口缺少 requireRoles 权限控制

- **文件**: `F-09` mrp.routes.ts:15-19
- **问题描述**: `GET /api/mrp/shortage-summary` 和 `GET /api/mrp/shortage-report/:productionOrderId` 仅依赖 `authMiddleware`（验证登录态），未设置 `requireRoles`。任意已登录角色（包括仅有查看权限的 `worker` 角色）均可访问跨工单的全局缺料汇总和所有工单的物料缺口详情，该数据属于供应链敏感信息。同一情况也存在于 `GET /api/mrp/supply-chain-dashboard`。
- **修复建议**:
  为三个 GET 只读路由增加角色限制：
  ```typescript
  requireRoles('purchase', 'supervisor', 'boss', 'production')
  ```
  确保一线工人无法直接访问供应链缺料全景数据。

#### SA-M-005: production.routes.ts 多个读取接口缺少 requireRoles

- **文件**: `F-15` production.routes.ts:33, 41, 48-53
- **问题描述**: 以下路由仅有 `authMiddleware` 保护，无角色限制：
  - `GET /production/orders`（工单列表）
  - `GET /production/orders/:id`（工单详情）
  - `GET /production/orders/:id/materials`（物料需求明细）
  - `GET /production/orders/:id/material-check`（实时缺料检测，会触发写操作更新 `material_status`）

  其中 `material-check` 不是纯读接口，它会 `UPDATE production_orders SET material_status`，任何已登录用户均可触发该写操作。
- **修复建议**:
  - 纯读接口（orders 列表、详情、materials）增加 `requireRoles('worker', 'supervisor', 'boss', 'production')` 或相应最小权限集合。
  - `material-check` 接口具有写副作用，应限制为 `requireRoles('supervisor', 'boss', 'production')`。

#### SA-M-006: incoming-inspection GET 路由缺少 requireRoles

- **文件**: `F-03` incomingInspection.routes.ts:16-19, 25-28, 68-71
- **问题描述**: `GET /incoming-inspections`（列表）、`GET /incoming-inspections/:id`（详情）、`GET /incoming-inspections/:id/preview-receipt`（入库单预览）均无 `requireRoles` 保护。虽然 tenant_id 隔离保证了跨租户不可访问，但任何已登录用户（如仅有采购查看权限的角色）均可读取质检单和入库预览数据。
- **修复建议**:
  增加 `requireRoles('warehouse', 'supervisor', 'boss', 'purchase')` 保护三个 GET 路由。

#### SA-M-007: return-order GET 路由缺少 requireRoles

- **文件**: `F-06` returnOrder.routes.ts:16-19, 25-28
- **问题描述**: `GET /return-orders`（退货列表）和 `GET /return-orders/:id`（退货详情）无角色限制，与 SA-M-006 性质相同。退货单包含供应商、采购价格等商业敏感信息，应限制读取权限。
- **修复建议**:
  增加 `requireRoles('warehouse', 'supervisor', 'boss', 'purchase')` 保护两个 GET 路由。

#### SA-M-008: BOM 快照 snapshot_data 存储展开后 JSON，存在 JSON 注入隐患

- **文件**: `F-11` bom-snapshot.service.ts:58, 130
- **问题描述**: `createSnapshot()` 将 `JSON.stringify(sortedItems)` 直接存入 `snapshot_data` 列（JSON 类型），`getSnapshotItems()` 取出后直接 `JSON.parse()` 并作为 `ExpandedMaterial[]` 使用，未做结构校验。若数据库数据被内部人员篡改（`snapshot_data` 列直接修改），或 JSON 解析后的对象不满足 `ExpandedMaterial` 接口约束，会导致后续物料计算产生错误结果。该问题与 BD-001（快照不可篡改）直接相关。
- **修复建议**:
  1. 在 `getSnapshotItems()` 读出 JSON 后，使用 Zod schema 做结构验证：
     ```typescript
     const ExpandedMaterialSchema = z.array(z.object({ skuId: z.number(), qty: z.string(), unit: z.string(), level: z.number() }));
     return ExpandedMaterialSchema.parse(JSON.parse(rows[0].snapshot_data));
     ```
  2. 数据库层面对 `bom_version_snapshots` 表仅授予应用账号 INSERT/SELECT 权限，撤销 UPDATE/DELETE 权限，从 DB 权限层实现不可篡改。

#### SA-M-009: 事件总线异步错误未被捕获，可导致静默失败

- **文件**: `F-19` event-bus.service.ts:35-37
- **问题描述**: `subscribe()` 接受的 handler 返回类型为 `void | Promise<void>`，但 `EventEmitter.on()` 不会等待 Promise resolve，也不会捕获 Promise rejection。若订阅者为 async 函数并抛出异常（如数据库写失败），该错误将成为 UnhandledPromiseRejection，不会回滚触发事件的原始事务，业务数据可能处于不一致状态。
- **修复建议**:
  在 `publish()` 中对 handler 返回值做异常捕获：
  ```typescript
  this.on(event, (payload) => {
    const result = handler(payload);
    if (result instanceof Promise) {
      result.catch((err) => logger.error(`EventBus handler error [${event}]:`, err));
    }
  });
  ```
  中期方案：Sprint 4 引入消息队列（RabbitMQ / Redis Streams）替换进程内 EventEmitter，保证事件持久化和事务一致性。

---

### 2.4 Low（低危）

#### SA-L-001: 编号生成函数使用本地时间，存在时区敏感问题

- **文件**: `F-01` incomingInspection.service.ts:10 / `F-04` returnOrder.service.ts:10 / `F-12` production-order.service.ts:185
- **问题描述**: 编号日期部分使用 `new Date()`，依赖运行环境的本地时区。若服务器时区配置与业务预期不符（如部署到 UTC 时区服务器），会导致跨午夜时段生成的编号日期与业务日期不一致，影响单据追溯。
- **修复建议**: 统一使用 `new Date().toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' })` 或在环境变量中强制设置 `TZ=Asia/Shanghai`，并在 Docker 镜像中固定时区。

#### SA-L-002: purchaseSuggestion.controller.ts 使用 `(req as any)` 类型断言

- **文件**: `F-17` purchaseSuggestion.controller.ts:16, 31, 39, 46
- **问题描述**: Controller 中 4 处使用 `(req as any).tenantId` 和 `(req as any).userId` 绕过 TypeScript 类型检查。其他模块（如 `mrp.controller.ts`）已直接使用 `req.tenantId`，说明 Express Request 类型已被扩展。此处残留的 `as any` 类型断言降低了类型安全性，若中间件未正确注入 `tenantId`，运行时得到的是 `undefined` 而非编译期错误。
- **修复建议**: 将四处 `(req as any).tenantId` 改为 `req.tenantId`，与项目其他 Controller 保持一致。

#### SA-L-003: bom_version_snapshots 表缺少 UPDATE/DELETE 权限撤销的 DDL 注释说明

- **文件**: `F-20` infra/db/init.sql:1285-1299
- **问题描述**: BD-001 要求 BOM 快照不可篡改，但 DDL 中未包含对应的权限撤销语句（REVOKE UPDATE, DELETE ON bom_version_snapshots）或注释说明，DBA 在初始化数据库时可能遗漏此配置。
- **修复建议**: 在 init.sql 的 `bom_version_snapshots` 建表语句后增加注释说明和 REVOKE 语句（或在独立的权限脚本中处理），明确该表仅允许 INSERT/SELECT。

#### SA-L-004: MRP 生成采购建议 reason 字段包含原始业务数据，长度未限制

- **文件**: `F-07` mrp.service.ts:519-523
- **问题描述**: `reason` 字段通过模板字符串拼接工单编号、SKU 单位等数据生成，内容长度理论上无限制，但 `purchase_suggestions.reason` 列的数据库定义（原始 Sprint 2 表）通常为 VARCHAR(500)，超长时会触发 Data too long 错误而非业务友好提示。
- **修复建议**: 对 `reason` 字符串截断至 490 字符：`reason.substring(0, 490)`，并在 Sprint 4 评估是否将该字段改为 TEXT 类型。

#### SA-L-005: 返回数据中包含 defect_images URL 数组，未校验 URL 安全性

- **文件**: `F-02` incomingInspection.controller.ts:23-24 / `F-01` incomingInspection.service.ts:317
- **问题描述**: `defectImages` 字段接受 `z.array(z.string())` 而非 `z.array(z.string().url())`，攻击者可写入 `javascript:` 协议 URL 或内网 IP 地址。在前端未做过滤的情况下，若用户点击图片链接，可能触发 XSS 或 SSRF。
- **修复建议**: 将 Zod 校验改为 `z.array(z.string().url().startsWith('https://'))` 或使用白名单域名校验，拒绝非 HTTPS URL。

---

## 3. 安全合规矩阵

| 安全维度 | 检查项 | 状态 | 说明 |
|----------|--------|------|------|
| **SQL 注入** | incomingInspection.service.ts 所有 SQL | PASS | 全部使用参数化查询 `?` 占位符 |
| **SQL 注入** | returnOrder.service.ts 所有 SQL | PASS | 全部使用参数化查询 |
| **SQL 注入** | mrp.service.ts 所有 SQL | PASS | 全部使用参数化查询；IN 子句通过 `map(() => '?')` 动态生成占位符 |
| **SQL 注入** | production-order.service.ts 所有 SQL | PASS | 全部使用参数化查询 |
| **SQL 注入** | workflow-engine.service.ts IN 子句 | PASS | L220-226 动态 IN 使用 `placeholders = nextTaskIds.map(() => '?').join(',')` |
| **SQL 注入** | purchase-suggestion.service.ts (CR-001) | PASS | supplierId 已参数化，IN 子句动态占位符构建 |
| **XSS** | 所有 API 响应字段 | PASS | 无服务端渲染，JSON API 不直接渲染 HTML |
| **XSS** | defectImages URL 字段 | WARN | 未校验 URL 协议，见 SA-L-005 |
| **CSRF** | 状态变更接口 | PASS | 依赖 JWT Bearer Token，天然防 CSRF（无 Cookie 认证） |
| **权限控制** | incoming-inspection 写操作路由 | PASS | POST/PUT 均有 `requireRoles` |
| **权限控制** | incoming-inspection 读操作路由 | FAIL | GET 路由缺少 requireRoles，见 SA-M-006 |
| **权限控制** | return-order 写操作路由 | PASS | POST/PUT 均有 `requireRoles` |
| **权限控制** | return-order 读操作路由 | FAIL | GET 路由缺少 requireRoles，见 SA-M-007 |
| **权限控制** | mrp 写操作路由 (CR-007) | PASS | reevaluate 已添加 `requireRoles('supervisor','boss')` |
| **权限控制** | mrp 读操作路由 | FAIL | shortage-report/shortage-summary/dashboard 缺少角色限制，见 SA-M-004 |
| **权限控制** | production-order 写操作路由 | PASS | cancel/createFromSalesOrder 均有 `requireRoles` |
| **权限控制** | production-order 读操作路由 | FAIL | orders 列表/详情/materials/material-check 缺少角色限制，见 SA-M-005 |
| **权限控制** | purchase-suggestion 路由 | PARTIAL | 审批/驳回/转单有保护；list GET 无角色限制，见 SA-M-004 周边 |
| **多租户隔离** | incoming-inspection 所有查询 | PASS | 每条 SQL WHERE 均含 `tenant_id = ?`，事务内同步校验 |
| **多租户隔离** | return-order 所有查询 | PASS | 全部包含 `tenant_id` 条件 |
| **多租户隔离** | mrp 所有查询 | PASS | 全部包含 `tenant_id` 条件，包括 JOIN 条件 |
| **多租户隔离** | production-order 所有查询 | PASS | 全部包含 `tenant_id`，库存预留 UPDATE 含双重条件 |
| **多租户隔离** | bom-expansion 递归查询 | PASS | 每层递归均传递 `this.tenantId` 至查询 |
| **多租户隔离** | workflow-engine 所有查询 | PASS | 全部含 `tenant_id` |
| **输入校验** | incoming-inspection 请求体 | PASS | Zod schema 覆盖全部字段；数量正则 `/^\d+(\.\d{1,4})?$/` |
| **输入校验** | incoming-inspection 查询参数 | PARTIAL | status/result 未枚举约束，见 SA-M-001 |
| **输入校验** | return-order 请求体 | PASS | Zod schema 覆盖全部字段 |
| **输入校验** | return-order 查询参数 | PARTIAL | status/returnType 未枚举约束，见 SA-M-001 |
| **输入校验** | mrp Controller 参数 | PASS | 使用 Zod coerce 处理路径参数和 body |
| **输入校验** | purchase-suggestion list 查询参数 | FAIL | 手动 Number() 转换，未使用 Zod，见 SA-M-002 |
| **输入校验** | purchase-suggestion BatchToPO | PARTIAL | 缺少数组长度上限，见 SA-H-002 |
| **并发安全** | 质检提交 submit (CR-002) | PASS | 事务内 `SELECT ... FOR UPDATE` 行锁，幂等位在锁保护下检查 |
| **并发安全** | 库存预留 production-order | PASS | `UPDATE ... WHERE qty_on_hand - qty_reserved >= ?` 原子条件更新，并发安全 |
| **并发安全** | 批量转单 batchCreatePOFromSuggestions | PASS | 事务包裹，status = 'approved' 前置校验 |
| **拒绝服务** | BOM 递归展开深度限制 | PASS | `level > 10` 抛出异常，循环引用通过 visited Set 检测 |
| **拒绝服务** | BOM 循环引用检测 | PASS | 兄弟节点使用克隆 visited Set，无误报 |
| **拒绝服务** | 分页接口最大 pageSize | PASS | PaginationSchema 限制 pageSize 上限（需确认具体值） |
| **拒绝服务** | 批量转单数组长度 | FAIL | 无上限，见 SA-H-002 |
| **数据安全** | BOM 快照 BD-001 不可篡改 | PARTIAL | 应用层仅 INSERT，无 DB 权限撤销保障，见 SA-M-008 和 SA-L-003 |
| **业务安全** | BD-004 不合格品必须退货 (BUG-S3-002) | PASS | `submit()` 提交前校验 `result=fail` 时 `disposition` 必须为 `return` |
| **数据安全** | customer_id 字段泄露 | FAIL | 生产工单详情返回 customer_id，见 SA-H-003 |
| **数据安全** | 错误响应堆栈泄露 | PARTIAL | 编号碰撞时 DB 异常未被捕获，见 SA-H-001 |

---

## 4. 已修复问题确认

以下问题经代码核查，确认已在本次 Sprint 3 代码中正确修复：

### CR-001 — SQL 注入（purchase-suggestion.service.ts）

- **修复状态**: CONFIRMED FIXED
- **核查位置**: `purchase-suggestion.service.ts:154-158`
- **核查结论**: `batchCreatePOFromSuggestions()` 使用 `suggestionIds.map(() => '?').join(',')` 动态生成 IN 子句占位符，参数通过 `[...suggestionIds, this.tenantId]` 绑定，未发现任何字符串拼接 SQL 的残留代码。

### CR-002 — 并发入库竞态（incomingInspection.service.ts）

- **修复状态**: CONFIRMED FIXED
- **核查位置**: `incomingInspection.service.ts:366-374`
- **核查结论**: `submit()` 在 `AppDataSource.transaction()` 内使用 `SELECT ... FOR UPDATE` 获取行级锁，锁保护下读取 `receipt_triggered` / `return_triggered` 幂等位，并在同一事务内完成条件检查和写入，满足序列化隔离要求。

### CR-007 — MRP reevaluate 路由权限缺失（mrp.routes.ts）

- **修复状态**: CONFIRMED FIXED
- **核查位置**: `mrp.routes.ts:31-34`
- **核查结论**: `POST /api/mrp/reevaluate` 路由已添加 `requireRoles('supervisor', 'boss')` 中间件，与注释说明一致。

### BUG-S3-002 — BD-004 不合格品 disposition 校验缺失（incomingInspection.service.ts）

- **修复状态**: CONFIRMED FIXED
- **核查位置**: `incomingInspection.service.ts:359-364`
- **核查结论**: `submit()` 在提交事务前执行 `items.filter(i => i.result === 'fail' && i.disposition !== 'return')`，若存在不合格品未标记为退货，抛出 `AppError.badRequest('不合格品仅允许退货处置(BD-004)')`，业务规则得到后端强制保障。

---

## 5. 最终结论

### 5.1 综合评分

| 维度 | 评分 |
|------|------|
| SQL 注入防护 | 9.5 / 10 |
| 权限控制完整性 | 6.0 / 10 |
| 多租户隔离 | 10 / 10 |
| 输入校验覆盖率 | 7.5 / 10 |
| 并发安全性 | 9.0 / 10 |
| 拒绝服务防护 | 7.5 / 10 |
| 业务规则安全 | 9.0 / 10 |
| 数据安全 | 7.0 / 10 |
| **综合评分** | **7.6 / 10** |

### 5.2 上线判定

**当前状态: 条件可上线（需修复 2 项 High 问题后方可发布）**

#### 必须修复后方可上线（阻断上线的 High 级问题）

| 编号 | 问题 | 工作量估计 |
|------|------|-----------|
| SA-H-001 | 编号生成碰撞风险 — 改用 `generateNo()` 统一工具 | 2h |
| SA-H-002 | 批量转单 suggestionIds 数组无上限 — Zod 添加 max(200) | 0.5h |
| SA-H-003 | 工单详情泄露 customer_id — 移除或按角色裁剪字段 | 1h |

> 说明：SA-H-003 虽不直接造成数据篡改，但属于数据越权访问，已违反最小权限原则，必须修复后上线。

#### 建议在本 Sprint 内同步修复的 Medium 问题（不阻断上线，但需在下个迭代前完成）

| 编号 | 问题 | 优先级 |
|------|------|--------|
| SA-M-001 | 查询参数枚举约束缺失 | P2 |
| SA-M-002 | 采购建议 list 未用 Zod 校验 | P2 |
| SA-M-004 | MRP 读接口缺少角色限制 | P1 |
| SA-M-005 | 生产工单读接口缺少角色限制 + material-check 写副作用 | P1 |
| SA-M-006 | 质检读接口缺少角色限制 | P1 |
| SA-M-007 | 退货读接口缺少角色限制 | P1 |
| SA-M-008 | BOM 快照读取后缺少 Zod 结构校验 | P2 |
| SA-M-009 | 事件总线异步错误静默失败 | P2 |

> SA-M-004 至 SA-M-007 共 4 项读取接口缺少角色控制问题，在内网部署场景风险可控，但互联网暴露场景下应视为高优先级修复。

### 5.3 安全工程师结论

Sprint 3 后端代码整体安全基线良好：

- SQL 注入方面全面采用参数化查询，无直接注入风险
- 多租户隔离执行彻底，每个查询均携带 tenant_id
- 并发安全方面 SELECT FOR UPDATE 行锁设计正确，幂等位机制完备
- BOM 递归展开有深度上限（10 层）和循环引用检测，无 DoS 风险
- CR-001/CR-002/CR-007/BUG-S3-002 四项历史修复项均已正确落地

主要安全弱点集中在**权限控制粒度**（多个读取路由缺少角色限制）和**编号生成可靠性**（随机碰撞风险）两个领域，需要在正式上线前完成修复。

建议 Backend Engineer 优先处理 SA-H-001、SA-H-002、SA-H-003 三项 High 问题，并同步推进 SA-M-004 至 SA-M-007 四项读取权限修复，预计总修复工时约 6-8 小时。完成修复并通过 QA 回归测试后，安全工程师确认可以安全上线。

---

*本报告由 Security Engineer subagent 生成，审计依据 Zero Trust / Least Privilege / Defense in Depth 三项安全原则。*
*报告有效期至下次代码变更，建议每个 Sprint 结束后重新执行安全审计。*
