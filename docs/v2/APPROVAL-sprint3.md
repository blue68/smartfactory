# [artifact:工程审批] Sprint 3 全链路贯通 — SDD 审批

**审批编号**：EM-SPRINT3-001
**审批日期**：2026-03-14
**审批人**：@engineering-manager
**审批对象**：ARCH-SPRINT3-V2-001（sprint3-architecture.md）
**关联用户故事**：sprint3-user-stories.md（US-S3-001 ~ US-S3-013）

---

## 审批结论

[artifact:工程审批]
APPROVED WITH CONDITIONS

整体架构设计完整、逻辑严密，状态机、事务边界、BD-001/BD-004 约束均有清晰落地方案。
以下列出 **3 项必须在编码阶段修复的条件**，工程师须在对应模块提交 PR 前确认消除，Code Review 阶段重点复查。

---

## 审查详情

### 1. 架构完整性

**评分：通过**

四条业务状态机（销售订单、生产工单、生产任务、采购订单）均已完整设计：

- 销售订单（7 状态）：终态保护、in_production 不可回退、cancelled 不可恢复，设计合理。
- 生产工单（6 状态）：`material_ready` 中间状态的引入是关键亮点，有效区分"已排产缺料"与"已排产备料完成"两种语义，防止缺料状态下意外开工。该状态允许在原料被抢占时回退到 `scheduled`（降级回退），逻辑清晰且有业务依据。
- 生产任务（4 状态）：`started → completed` 不可回退（防止打卡篡改），设计合理。架构文档中描述了 `locked` 为"虚拟状态"（通过前置任务 ID 关联判断），但 User Story US-S3-008 在状态表中额外定义了 `exception` 和 `suspended` 两个状态（异常上报和主管挂起）。

**发现问题 C1（条件项）**：架构文档（1.3 节）的生产任务状态枚举仅定义 `pending / started / completed / cancelled`，未包含 `exception` 和 `suspended`；而 User Story US-S3-008 的 AC-S3-008-03 明确要求工人可提交"异常上报"、主管可"挂起"任务。两份文档之间存在状态枚举不一致。后端工程师在实现 `production_tasks.status` 字段时，必须以 User Story 为准，将 ENUM 扩展为 `pending / started / completed / exception / suspended / cancelled`，并更新对应的状态流转校验逻辑。

- 采购订单（4 状态）：draft → confirmed → partial_received → received → cancelled，逻辑清晰。
- 全链路事件驱动图（5.2 节）完整覆盖了从销售确认到发货的全路径，以及采购→质检→入库→退货链路，链路闭环设计已实现。

### 2. 数据库设计

**评分：通过**

**新增表审查（6 张表）**：

| 表名 | 评估 | 说明 |
|---|---|---|
| incoming_inspection_records | 通过 | 设计完整，幂等标志位（receipt_triggered / return_triggered）是关键设计，避免重复触发。唯一索引 uk_tenant_inspection_no 有效。 |
| incoming_inspection_items | 通过 | JSON 类型存储 defect_types / defect_images 合理，V2 阶段无需单独建子表。 |
| return_orders | 通过 | 覆盖 purchase_return 和 production_return 两类退货，语义扩展留有余量。 |
| return_order_items | 通过 | 基础字段完整。 |
| bom_version_snapshots | 通过 | snapshot_hash 去重机制（相同 BOM 内容复用快照记录）是有效的存储优化，规避 RISK-S3-05 快照膨胀。 |
| material_requirements | 通过 | status 枚举（shortage / partial / fulfilled）与 production_orders.material_status 枚举（unchecked / shortage / partial / ready）语义一致，两表联动关系清晰。 |

**现有表变更审查（8 个迁移文件）**：

- `production_orders`：新增 `bom_snapshot_id` 和 `material_status` 两个字段，增加对应索引，影响评估低。
- `delivery_notes`：新增 `inspection_id` 和 `receipt_id`，字段语义清晰，允许 NULL（历史数据兼容）。
- `purchase_order_items`：新增 `qty_passed` 和 `qty_rejected`，与质检流程直接关联，字段命名规范。
- `process_steps`：新增 `output_type` 和 `output_sku_id`，是半成品入库解锁机制的数据基础。

**索引设计**：关键查询路径均有覆盖（tenant_id 前缀、状态筛选、po_id 关联），未发现明显缺失。

**发现问题（观察项，非阻断）**：`production_tasks` 表在架构文档中未显式列出 `version` 字段的迁移 SQL，但 US-S3-008 AC-S3-008-05 要求乐观锁依赖该字段。后端工程师须确认该字段是否已在 V1 init.sql 中存在；如不存在，需补充迁移文件 `V2_S3_009_alter_production_tasks_add_version.sql`。

**迁移幂等性**：所有迁移文件遵循 `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ADD COLUMN IF NOT EXISTS` 规范，满足幂等要求。

### 3. API 设计

**评分：通过**

**RESTful 规范符合性**：
- 资源命名（名词复数）、HTTP 动词使用、路径层级均符合 RESTful 规范。
- 状态变更操作采用动作子路径（`/submit`、`/confirm`、`/ship`、`/cancel`），语义明确，符合 RESTful 最佳实践中对无法用 CRUD 映射的动作的处理方式。
- 统一返回结构 `{ code, data, message }` 继承 V1 规范，一致性良好。

**User Story 覆盖率校验**：

| User Story | 关键接口 | 覆盖情况 |
|---|---|---|
| US-S3-001（质检单创建审核） | POST /incoming-inspections, PUT /items, POST /submit | 完整覆盖 |
| US-S3-002（合格入库） | POST /submit（含入库事务）, PUT /purchase-receipts/:id/confirm | 覆盖 |
| US-S3-003（退货自动创建） | POST /return-orders（系统自动触发）| 覆盖 |
| US-S3-004（部分到货完结） | 尾单追踪接口在 3.1 节未列出 | 见下方说明 |
| US-S3-005（销售→工单触发）| POST /sales-orders/:id/trigger-production | 覆盖 |
| US-S3-006（BOM展开）| GET /production-orders/:id/bom-expansion | 覆盖 |
| US-S3-007（排产）| POST /production-orders/:id/schedule, /assign-tasks | 覆盖 |
| US-S3-008（报工双端）| PUT /start, POST /complete | 覆盖 |
| US-S3-009（半成品+解锁）| POST /complete（含事务逻辑）| 覆盖 |
| US-S3-010（交付确认）| POST /production-orders/:id/deliver, PUT /sales-orders/:id/ship | 覆盖 |
| US-S3-011（缺料检测）| GET /shortage-report, /shortage-summary | 覆盖 |
| US-S3-012（建议审批+下单）| PUT /approve, POST /batch-to-po | 覆盖 |
| US-S3-013（入库后通知）| 异步事件驱动，无直接接口暴露 | 合理 |

**发现问题（观察项，非阻断）**：US-S3-004 要求"尾单追踪聚合查询接口"和"手动完结接口 PATCH /purchase-orders/{id}/close"，在 3.1 节 API 接口表中未列出。User Story 任务分发中有提及，但架构文档中未正式定义接口规范（路径、请求/响应结构）。后端工程师在实现前须补充这两个接口的设计说明。

**接口幂等性设计**：质检提交的 `receipt_triggered` 标志、入库的 `transaction_no` 唯一约束、任务完工的 `version` 乐观锁均已明确，幂等保护完整。

### 4. 事务安全

**评分：通过（含重点关注项）**

**质检→入库事务（4.3 节）**：

```
BEGIN TRANSACTION
  合格品路径：purchase_receipts + inventory_transactions + inventory + purchase_order_items + 状态更新
  不合格品路径：return_orders + return_order_items + purchase_order_items.qty_rejected
  幂等检查：receipt_triggered / return_triggered 标志位
COMMIT
```

设计完整，13 步操作全部在同一事务内完成，原子性有保障。幂等标志位在事务提交前检查（409 拦截重复提交），设计合理。

**BOM展开→库存预留事务（4.2 节）**：

8 步操作在同一事务内完成（快照写入 → 工单创建 → 物料需求写入 → 库存预留）。关键设计：库存预留不足时不阻塞工单创建，而是记录 qty_shortage，这一"不阻塞"策略与业务逻辑吻合（工厂可边生产边等料），设计合理。

**工序完工→半成品入库→下道工序解锁（4.5 节）**：

架构文档描述该逻辑由事件触发，但未明确说明"半成品入库 + 下道工序解锁"是否在同一个数据库事务内完成。

**发现问题 C2（条件项，阻断）**：US-S3-009 AC-S3-009-04 明确要求："任务状态更新 + 库存更新 + 下道工序解锁在同一数据库事务中执行，任意步骤失败时全部回滚。"架构文档 4.5 节将该逻辑描述为事件驱动（`TASK_COMPLETED` 事件触发后依次执行），而 Sprint 3 阶段采用进程内同步 EventEmitter（5.1 节），事件消费在同一进程内同步执行。后端工程师必须确保：`TASK_COMPLETED` 事件消费函数（SemiProductService + ScheduleService）的全部数据库操作被包裹在同一个数据库事务连接中，而非各自独立事务。如果使用 EventEmitter 模式，事务上下文（数据库连接对象）须从调用方显式传递给事件消费方，不得各自获取新连接。

**成品完工→销售订单状态联动（5.1 节 `PRODUCTION_ORDER_COMPLETED`）**：

成品入库与销售订单状态更新通过事件驱动。同 C2 问题，需确认两者在同一事务内。如果设计上允许成品入库成功但销售订单状态更新失败（最终一致性可接受），须在架构文档注释中明确说明，并在 QA 测试用例中覆盖失败恢复路径。

### 5. 并发保护

**评分：通过**

**库存预留并发（4.6 节）**：

采用行级锁（`SELECT ... FOR UPDATE`）+ 条件更新（`WHERE qty_on_hand - qty_reserved >= required`）方案，通过受影响行数判断是否发生并发抢占。这是 MySQL 下处理库存超卖的标准模式，设计合理。

**任务完工并发（RISK-S3-01）**：

乐观锁（`task.version` 字段）+ 任务状态校验（`task.status != completed`）双重保护，防止多工人重复完工。与 US-S3-008 AC-S3-008-05 的乐观锁要求一致。

**工序解锁重复触发（RISK-S3-08）**：

事务内检查 `production_tasks.status != pending` 后才执行更新，避免重复解锁通知。设计合理，但需注意：若检查和更新不在同一行级锁保护范围内，仍可能在高并发下出现 TOCTOU（检查后更新前状态被其他并发修改）。后端工程师应在解锁更新操作中使用 `UPDATE ... WHERE status = 'locked_state' AND id = ?` 的条件更新模式（而非先 SELECT 后 UPDATE），通过受影响行数 = 0 来判断竞争失败。

**幂等设计汇总**：三层幂等保护（业务标志位、乐观锁版本号、数据库唯一约束），层次清晰，覆盖面完整。

### 6. 业务决策约束（BD-001/BD-004）

**评分：通过**

**BD-001（BOM版本快照）落地验证**：

- 工单创建时在事务内完成快照生成（4.2 节），snapshot_hash 去重避免重复存储。
- `production_orders.bom_snapshot_id` 字段创建后不可修改，由业务层强制约束。
- BOM展开引擎使用 `bom_header_id`（快照版本），不读取当前激活版本（4.1 节），与 BD-001 精神一致。
- US-S3-006 AC-S3-006-04 明确要求 QA 覆盖"工单创建后激活新版本，工单物料需求不变"的回归测试，设计与测试要求匹配。
- RISK-S3-07（V1 存量数据 bom_snapshot_id 为 NULL）已有缓解措施：批量回填 + 服务层降级逻辑。

**BD-004（质检不合格强制拦截）落地验证**：

- 后端接口层强制拦截（`POST /inventory/in` 检查质检状态，rejected 返回 409）。
- 前端隐藏"强制入库"选项，但后端为终审防线，设计层次正确。
- 质检单结果枚举仅有 `pass / fail / conditional_pass`（架构文档）和 `qualified / rejected`（User Story），两份文档枚举值命名不完全一致。

**发现问题（观察项，非阻断）**：架构文档 2.1.2 节 `incoming_inspection_items.result` 枚举为 `pass / fail / conditional_pass`，而 User Story US-S3-001 AC-S3-001-02 和 US-S3-003 AC-S3-003-06 中描述枚举仅为 `qualified / rejected`（不提供降级选项）。BD-004 禁止降级使用，但数据库 DDL 中仍保留了 `conditional_pass` 选项，与 BD-004 约束存在潜在矛盾。后端工程师须与产品确认：是否完全移除 `conditional_pass`；如果保留（用于未来扩展），须在 `incoming_inspection_service` 的提交逻辑中明确 `conditional_pass` 走合格路径还是退货路径，并在 API 文档中说明。

**退货自动触发逻辑**（4.4 节）：`qty_failed > 0 AND disposition = 'return'` 时系统自动生成退货单，状态直接为 `confirmed`（无需二次确认），符合 BD-004 的"强制退货、无需人工干预"精神。

### 7. 风险评估

**评分：通过**

架构文档识别了 5 项高/中风险（RISK-S3-01 ~ RISK-S3-05）和 4 项中风险（RISK-S3-06 ~ RISK-S3-09），覆盖并发、循环引用、存储、幂等、兼容性、时序等关键维度，风险识别全面。

各风险缓解措施评估：

| 风险编号 | 缓解措施评估 |
|---|---|
| RISK-S3-01（并发完工） | 乐观锁 + 行锁方案完整，可接受 |
| RISK-S3-02（BOM循环引用） | visited Set 运行时检测 + BOM 保存前置检测，双重防护，充分 |
| RISK-S3-03（库存超卖） | 行级锁 + 条件更新标准方案，充分 |
| RISK-S3-04（质检重复提交） | 标志位 + 数据库唯一约束双重保护，充分 |
| RISK-S3-05（快照膨胀） | snapshot_hash 去重在 Sprint 3 足够，Sprint 4 归档策略留有规划 |
| RISK-S3-06（E2E覆盖不足） | 已要求 QA 预置完整 E2E 用例，缓解措施合理 |
| RISK-S3-07（存量数据兼容） | 批量回填 + 降级逻辑，完整 |
| RISK-S3-08（解锁时序） | 条件更新防重，但见并发保护章节补充建议 |
| RISK-S3-09（质检表语义混淆） | API 路径区分 + 代码层 Service 隔离，充分 |

**额外风险提示（未在文档中列出）**：

RISK-EM-01（进程内 EventEmitter 的事务边界风险）：Sprint 3 采用进程内同步 EventEmitter，所有事件在同一数据库事务内同步处理（5.1 节声明）。但 Node.js EventEmitter 本身不传递事务上下文，若事件消费方各自获取新的数据库连接，将导致事务边界断裂。这是 C2 条件项的根本原因，后端工程师须在架构实现中明确事务上下文传递方案（推荐：将 `db connection` 或 `queryRunner` 作为参数传递给事件消费函数，而非通过 EventEmitter 的 payload 全量携带）。

RISK-EM-02（异步缺料重评的错误处理）：US-S3-013 AC-S3-013-06 要求缺料重评为异步操作，失败时"记录错误日志但不影响入库事务"。但架构文档中未说明异步任务的重试策略（失败后是否重试？重试次数？重试延迟？）。Sprint 3 阶段可接受"失败仅记录日志、不自动重试"（运维人工干预），但须在代码中明确注释此策略，避免未来误判为 Bug。

### 8. 模块划分

**评分：通过**

**后端模块边界审查**：

```
incoming-inspection/   [新增 - R-09]      职责：来料质检单生命周期管理，含入库/退货事务触发
return-order/          [新增 - R-09/BD-004] 职责：退货单 CRUD 及状态流转
production/            [增强 - R-10]      职责：工单、任务、排产；增加 BOM 快照、半成品解锁
  bom-expansion.service.ts               职责：BOM 递归展开算法（单一职责，可独立测试）
  bom-snapshot.service.ts                职责：快照生成与 hash 去重
  semi-product.service.ts                职责：半成品入库 + 下道工序解锁（独立出来避免 scheduler.service 过重）
mrp/                   [新增 - R-10/R-11] 职责：缺料检测引擎，全局短缺汇总
purchase/              [增强 - R-11]      职责：建议生成 + 批量转采购订单
events/                [新增 - 跨模块]    职责：业务事件枚举 + EventEmitter 封装（单一事件总线）
```

模块划分清晰，单一职责原则执行良好。将 `bom-expansion`、`bom-snapshot`、`semi-product` 从 `production.service.ts` 独立出来的决策正确，避免大服务类（God Class）问题，利于单元测试覆盖。

**前端模块边界审查**：

新增页面（10 个 Web 页面 + 2 个小程序页面）分布在 `production/`、`purchase/`、`sales/` 三个目录下，层级清晰，与后端模块对应关系明确。

**与现有代码库兼容性评估**：

已确认以下现有模块可支撑扩展（见代码库实际文件）：
- `services/api/src/modules/production/`：已有 `production.service.ts`、`production.controller.ts`、`scheduler.service.ts`，Sprint 3 在此基础上扩展新增服务文件，不需要推倒重来。
- `services/api/src/modules/purchase/`：已有 `purchase.service.ts`、`suggestion.service.ts`，Sprint 3 在 `suggestion.service.ts` 中增加 `generateFromShortage()` 方法，扩展路径清晰。
- `services/api/src/modules/sales-order/`：已有完整的 `salesOrder.service.ts`（含状态流转 `TRANSITION_MAP`），Sprint 3 需要在其中增加 `in_production → completed → shipped` 的联动触发。现有 `TRANSITION_MAP` 中 `in_production` 允许流转到 `shipped` 和 `closed`，与架构设计的 `in_production → completed → shipped` 三段式不完全一致，后端工程师须确认并对齐状态机实现。
- `services/api/src/modules/bom/`：已有 `bom.service.ts` 含 `BomItemNode` 展开结构，Sprint 3 的 BOM 展开算法可复用现有数据结构，不需要重新设计。

**开发顺序约束符合性**：架构文档（7.3 节末尾）定义的开发优先级（R-09 并行 → R-10 后端 → R-10 前端 → R-11）合理，依赖关系清晰，可执行。

---

## 阻断条件（Blocking Conditions）

**共 2 项阻断条件，必须在对应模块代码提交前解决：**

### C1：生产任务状态枚举不一致（必须在 production_tasks 开发前解决）

**问题**：架构文档（1.3 节）定义的 `production_tasks.status` 枚举为 `pending / started / completed / cancelled`，缺少 `exception` 和 `suspended` 状态；User Story US-S3-008 AC-S3-008-03 要求支持异常上报（exception）和主管挂起（suspended）。

**解决要求**：

1. `production_tasks` 表的 `status` ENUM 字段迁移 SQL 必须包含完整 6 个状态：`pending / started / completed / exception / suspended / cancelled`
2. 后端 `production-task.service.ts` 状态流转校验逻辑必须实现 `exception → started`（恢复）和 `exception → suspended`（挂起）两条路径
3. API 接口须暴露异常上报（`POST /production-tasks/:id/report-exception`）和恢复/挂起操作（`PUT /production-tasks/:id/resume`、`PUT /production-tasks/:id/suspend`）
4. 架构文档无需正式修订（以本审批文档为准），但后端工程师须在 PR 描述中说明此扩展

### C2：工序完工事务边界须在同一数据库连接内（必须在 semi-product.service.ts 开发前确认）

**问题**：US-S3-009 AC-S3-009-04 要求"任务状态更新 + 库存更新 + 下道工序解锁"在同一数据库事务中执行。Sprint 3 采用进程内 EventEmitter，但 Node.js EventEmitter 不自动传递事务上下文，存在事务边界断裂风险。

**解决要求**：

1. `ProductionTaskService.completeTask()` 方法须显式开启数据库事务（`queryRunner.startTransaction()`），并将 `queryRunner` 对象作为参数传递给 `SemiProductService.handleTaskCompleted(queryRunner, ...)` 和 `ScheduleService.unlockNextTask(queryRunner, ...)`
2. 禁止在 EventEmitter 消费函数内部重新获取数据库连接（`AppDataSource.query()` 或 `AppDataSource.createQueryRunner()`），所有操作必须使用同一个 `queryRunner`
3. 事务提交和回滚逻辑集中在 `ProductionTaskService` 的调用方控制，不分散到各消费函数内
4. Code Review 阶段必须重点检查此事务边界，reviewer 须查看 `queryRunner` 是否正确传递

---

## 编码阶段授权

满足以上 2 项阻断条件的前提下，授权如下：

- @senior-backend-engineer：按照架构设计文档和本审批文档的补充说明进入后端编码阶段
- @senior-frontend-engineer：R-09、R-10 前端页面可在后端 API 路径和 DTO 定义完成后并行开始，不需要等待后端接口联调完成

### 开发顺序约束

以下顺序为强制约束，不得跳跃：

```
阶段 1（Week 1-2，可并行）：
  后端：R-09 来料质检 + 退货单 + 入库事务（先行，后续所有链路依赖库存数据）
  后端：R-10 工单创建服务 + BOM 快照机制（最高优先级，其他工作依赖此模块）

阶段 2（Week 2，串行等待阶段 1 后端完成）：
  后端：R-10 排产 + 任务状态机 + 工序完工事务（C2 必须在此阶段落实）
  前端：R-09 质检/退货页面（等待后端接口路径和 DTO 定义完成）

阶段 3（Week 2-3，串行等待阶段 2 后端完成）：
  后端：R-11 缺料检测引擎 + 采购建议生成 + 异步重评任务
  前端：R-10 工单/排产/缺料看板页面（等待 R-10 后端 API 稳定）

阶段 4（Week 3）：
  前端：R-11 Dashboard 供应链看板区块
  联调：全链路 E2E 测试执行
```

**跨模块接口联调约定**：
- 后端须在 API 路径和请求/响应 DTO 定义完成后，立即更新 `docs/v2/` 目录下的 API 文档，前端不得依赖口头约定开发
- `US-S3-004` 缺失的两个接口（尾单追踪 + 手动完结）须在阶段 1 结束前补充接口定义

### 质量门禁

以下为编码阶段强制质量要求，Code Review 必须逐项确认：

| 检查项 | 标准 | 负责方 |
|---|---|---|
| C1 阻断条件 | production_tasks 状态枚举完整（6 个状态），状态流转覆盖 exception/suspended | @code-reviewer |
| C2 阻断条件 | 工序完工事务内 queryRunner 显式传递，无跨事务操作 | @code-reviewer |
| BD-001 快照隔离 | BOM 展开引擎读取 snapshot_data 而非实时 bom_items 表 | @code-reviewer |
| BD-004 拦截 | 入库接口 rejected 质检单返回 409，无旁路绕过路径 | @code-reviewer + @security-engineer |
| 乐观锁实现 | production_tasks.version 字段存在；update 时 WHERE version = ? 且检查受影响行数 | @code-reviewer |
| 库存条件更新 | 库存预留使用 FOR UPDATE + WHERE qty_on_hand - qty_reserved >= ? 模式 | @code-reviewer |
| 事务原子性 | 质检→入库 13 步操作在单事务内，测试覆盖失败回滚场景 | @senior-qa-engineer |
| 单元测试覆盖率 | BOM 展开算法、缺料检测引擎、状态机流转覆盖率 >= 80% | @code-reviewer |
| conditional_pass 语义 | 与产品确认并在代码中明确处理路径 | @senior-backend-engineer |
| 异步任务重试策略 | 缺料重评失败的处理策略在代码注释中明确说明 | @senior-backend-engineer |

---

**审批备注**：

Sprint 3 是 V2 迭代中链路最长、事务复杂度最高的一个 Sprint，架构设计整体质量优秀。两项阻断条件均属于设计文档与 User Story 之间的局部不一致，不影响整体架构方向的正确性。工程师在编码前须认真阅读本审批文档的条件项说明，确保实现与条件一致后方可提交 PR。

**下游行动**：
- @senior-backend-engineer：确认 `production_tasks.version` 字段现状，补充迁移 SQL（如需要）；制定事务上下文传递方案后开始编码
- @senior-qa-engineer：立即准备 E2E 测试数据集和脚本框架；BD-001 和 BD-004 的自动化回归测试用例须在阶段 2 开始前完成脚本设计
- @code-reviewer：Sprint 3 所有 PR 须重点审查 C1、C2 两项阻断条件的实现是否满足本文档要求
