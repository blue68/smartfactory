# Sprint 4 智能调度系统架构设计

**文档编号**：ARCH-SPRINT4-V2-001
**版本**：v1.0
**创建日期**：2026-03-14
**作者**：@tech-lead-architect
**输入来源**：
- docs/v2/sprint4-prd.md（PRD-SPRINT4-V2-001）
- services/api/src/modules/mrp/mrp.service.ts（现有 MRP 服务）
- services/api/src/modules/purchase/purchase-suggestion.service.ts（现有采购建议服务）
- services/api/src/modules/production/production.service.ts（现有排产服务）
- services/api/src/modules/events/event-bus.service.ts（现有事件总线）
- services/api/package.json（现有依赖，已有 bull@4.16.0）
**交付目标**：为 @senior-backend-engineer、@senior-frontend-engineer 提供完整技术约束与设计指导，输出后须经 @engineering-manager 审批方可进入编码阶段。

---

## 目录

1. [系统架构概览](#一系统架构概览)
2. [BullMQ 消息队列架构](#二bullmq-消息队列架构)
3. [智能采购建议引擎设计](#三智能采购建议引擎设计)
4. [智能排产建议引擎设计](#四智能排产建议引擎设计)
5. [数据库设计](#五数据库设计)
6. [API 接口设计](#六api-接口设计)
7. [模块划分与目录结构](#七模块划分与目录结构)
8. [技术规范](#八技术规范)
9. [扩展策略与技术风险](#九扩展策略与技术风险)

---

## [artifact:架构设计]

---

## 一、系统架构概览

### 1.1 整体架构图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              客户端层                                          │
│   React Web (Admin/Supervisor/Purchaser)   微信小程序 (Worker)               │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               │ HTTPS / REST
┌──────────────────────────────▼──────────────────────────────────────────────┐
│                           Express API 服务                                    │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────────────────┐  │
│  │  Auth 中间件  │  │ Tenant 中间件 │  │  requireRoles 权限中间件           │  │
│  └──────────────┘  └──────────────┘  └───────────────────────────────────┘  │
│                                                                               │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │                        业务模块层 (Modules)                               │ │
│  │  ┌────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │ │
│  │  │  schedule- │  │  mrp         │  │  purchase    │  │  production  │  │ │
│  │  │  suggestion│  │  Service     │  │  suggestion  │  │  Service     │  │ │
│  │  │  Service   │  │  (现有)      │  │  Service(现有)│  │  (现有)      │  │ │
│  │  │  (新增)    │  └──────────────┘  └──────────────┘  └──────────────┘  │ │
│  │  └─────┬──────┘                                                          │ │
│  │        │ 发布事件                                                          │ │
│  │  ┌─────▼──────────────────────────────────────────────────────────────┐  │ │
│  │  │                   BullMQ 队列服务层 (QueueService)                   │  │ │
│  │  │                                                                      │  │ │
│  │  │  ┌────────────────────────┐  ┌─────────────────────────────────┐   │  │ │
│  │  │  │ erp.inventory.         │  │ erp.schedule.                   │   │  │ │
│  │  │  │ shortage-recheck       │  │ suggestion-calculate             │   │  │ │
│  │  │  │ (缺料重评队列)          │  │ (调度建议计算队列)               │   │  │ │
│  │  │  │ retry: 3次，指数退避   │  │ retry: 2次，固定30s             │   │  │ │
│  │  │  └────────────────────────┘  └─────────────────────────────────┘   │  │ │
│  │  │                                                                      │  │ │
│  │  │  ┌────────────────────────┐                                         │  │ │
│  │  │  │ erp.notification.send  │                                         │  │ │
│  │  │  │ (通知发送队列)          │                                         │  │ │
│  │  │  │ retry: 5次，固定10s   │                                         │  │ │
│  │  │  └────────────────────────┘                                         │  │ │
│  │  │                                                                      │  │ │
│  │  │  降级保护：Redis 不可用 → 回退 in-process EventEmitter              │  │ │
│  │  └──────────────────────────────────────────────────────────────────────┘  │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│                                                                               │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │                  规则引擎层 (Rule Engine)                                  │ │
│  │  ┌────────────────────────────┐  ┌──────────────────────────────────┐   │ │
│  │  │ PurchaseSuggestionEngine   │  │ ProductionSuggestionEngine        │   │ │
│  │  │ 四步规则引擎               │  │ 三维评分引擎                      │   │ │
│  │  │ Step1: 缺口计算            │  │ Dim1: 交期紧迫度 (50分)           │   │ │
│  │  │ Step2: 安全库存补充        │  │ Dim2: 订单优先级 (30分)           │   │ │
│  │  │ Step3: 资金占用评估        │  │ Dim3: 物料就绪度 (20分)           │   │ │
│  │  │ Step4: 供应商推荐          │  │                                   │   │ │
│  │  └────────────────────────────┘  └──────────────────────────────────┘   │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               │
         ┌─────────────────────┼─────────────────────┐
         │                     │                     │
┌────────▼────────┐  ┌────────▼────────┐  ┌────────▼────────┐
│   MySQL 8.0     │  │  Redis 7.x      │  │  (可选)本地文件  │
│  (主数据存储)    │  │  (队列+缓存)    │  │  (日志归档)      │
│                 │  │  BullMQ 队列    │  └─────────────────┘
│  新增表：       │  │  计算结果缓存   │
│  schedule_      │  │  Redis Key前缀: │
│  suggestions    │  │  erp.{domain}   │
│  schedule_      │  └─────────────────┘
│  suggestion_    │
│  items          │
│  suggestion_    │
│  audit_logs     │
└─────────────────┘
```

### 1.2 核心设计决策

| 决策点 | 方案选择 | 决策理由 |
|---|---|---|
| 队列实现 | BullMQ（基于 Redis）| 现有系统已有 Redis + bull@4 依赖，升级到 BullMQ 成本最低；BullMQ 是 bull v4 的继任者，API 更现代 |
| EventBus 迁移策略 | 门面模式（Facade）兼容保留 | 方法签名不变，内部路由到 BullMQ；现有 30+ 调用点无需修改 |
| Worker 部署模式 | 同进程 Worker（非独立进程）| MVP 阶段，避免引入 PM2 cluster 复杂度；Redis 宕机降级更易实现 |
| 调度建议计算 | 后台队列 + 轮询状态 | 建议计算 < 10s，轮询（3s 间隔）比 WebSocket/SSE 实现成本低；后期可升级为 SSE |
| AI 建议实现 | 纯规则引擎（TypeScript）| PRD 明确 MVP 不接入 LLM，规则引擎确定性更高、可测试性更强 |
| 建议快照存储 | JSON 列（MySQL JSON 类型）| 便于历史回溯，无需额外序列化，MySQL 8.x 对 JSON 列查询性能良好 |
| 建议防重逻辑 | 同 SKU 同源 pending 建议更新不新建 | 防止重复计算产生冗余建议，与现有 purchase_suggestions 逻辑一致 |

### 1.3 服务划分

| 服务/模块 | 职责 | 依赖 |
|---|---|---|
| `QueueService` | BullMQ 队列管理、降级保护、Worker 注册 | Redis、BullMQ |
| `ScheduleSuggestionService` | 调度建议编排、触发计算、状态管理、历史查询 | QueueService、PurchaseSuggestionEngine、ProductionSuggestionEngine |
| `PurchaseSuggestionEngine` | 四步采购建议规则引擎计算 | MrpService、SupplierPriceService、InventoryService |
| `ProductionSuggestionEngine` | 三维评分排产建议规则引擎计算 | ProductionService、MrpService |
| `InventoryTurnoverService` | 库存周转分析、滞销预警、资金占用 | InventoryService |
| `CapacityAnalysisService` | 工人产能利用率计算、过载检测 | ProductionService |
| `SuggestionAuditService` | 审计日志写入、确认操作记录 | 所有涉及人工确认的操作 |

---

## 二、BullMQ 消息队列架构

### 2.1 迁移背景

现有系统使用 `EventBusService`（进程内 EventEmitter）处理跨模块异步事件，存在以下问题：
- 入库接口响应被缺料重评（同步）阻塞，P95 响应时间 > 1s（ACC-003）
- Handler 异常静默失败，无法追踪（ACC-008）
- 无法跨进程通信，不具备水平扩展能力

> **注意**：当前 `package.json` 已有 `bull@4.16.0` 依赖，但仍使用的是旧版 Bull API。Sprint 4 升级为 BullMQ（bull 的后继者），需新增 `bullmq` 依赖，并保留 `bull` 用于现有 `stock-alert-scan` 队列，待后续统一迁移。

### 2.2 队列拓扑设计

```
队列命名规范：erp.{domain}.{action}

┌────────────────────────────────────────────────────────────────────────────┐
│  队列名称                    │ 生产者            │ 消费者              │
├────────────────────────────────────────────────────────────────────────────┤
│  erp.inventory.shortage-     │ 入库审核通过       │ MrpWorker           │
│  recheck                     │ (IncomingInspect) │ → MrpService        │
│                              │                   │   .reevaluateAfter  │
│                              │                   │   Receipt()         │
│  重试：3次，指数退避(5s/10s/30s)│               │                     │
│  失败后：记录日志+告警       │                   │                     │
├────────────────────────────────────────────────────────────────────────────┤
│  erp.notification.send       │ 各业务模块        │ NotificationWorker  │
│                              │                   │ → 推送/短信/邮件    │
│  重试：5次，固定10s         │                   │                     │
│  失败后：记录日志            │                   │                     │
├────────────────────────────────────────────────────────────────────────────┤
│  erp.schedule.suggestion-    │ 手动触发/定时调度  │ SuggestionWorker    │
│  calculate                   │ /业务事件          │ → ScheduleSuggestion│
│                              │                   │   Service.calculate()│
│  重试：2次，固定30s         │                   │                     │
│  失败后：记录日志+更新建议   │                   │                     │
│           状态=failed        │                   │                     │
└────────────────────────────────────────────────────────────────────────────┘
```

### 2.3 EventBus 向前兼容方案（门面模式）

**设计目标**：`eventBus.publish()` 和 `eventBus.subscribe()` 方法签名不变，所有现有调用点代码不需修改。

```
改造前（Sprint 3）：
  BusinessEvent → EventEmitter.emit() → 同步 handler

改造后（Sprint 4）：
  BusinessEvent → EventBusFacade.publish() ──┐
                                              ├──[BullMQ 可用]→ BullMQ Job 入队 → Worker 异步消费
                                              └──[BullMQ 不可用]→ EventEmitter.emit() 同步降级

事件到队列路由映射表：
  PURCHASE_RECEIPT_CONFIRMED  → erp.inventory.shortage-recheck
  PRODUCTION_ORDER_CREATED    → erp.schedule.suggestion-calculate
  TASK_COMPLETED              → erp.schedule.suggestion-calculate
  其余事件                    → erp.notification.send（或保留同步处理）
```

**文件改造路径**：
- `src/modules/events/event-bus.service.ts` — 重构为 EventBusFacade，保留外部接口，内部路由到 QueueService
- `src/shared/queue-service.ts` — 新增，BullMQ 队列管理单例
- `src/workers/mrp.worker.ts` — 新增，缺料重评 Worker
- `src/workers/suggestion.worker.ts` — 新增，调度建议计算 Worker
- `src/workers/notification.worker.ts` — 新增，通知发送 Worker

### 2.4 降级保护机制

```
启动流程：
  1. 服务启动时，尝试连接 Redis 并初始化 BullMQ
  2. 连接成功 → 使用 BullMQ 模式
  3. 连接失败 → 输出 WARN 日志，切换到 EventEmitter 同步模式
  4. 运行期间 Redis 断线 → BullMQ job.add() 抛出异常，被 EventBusFacade 捕获，
     降级到同步 EventEmitter.emit()

降级日志格式：
  [BullMQ] Redis connection failed, falling back to in-process EventEmitter
  级别：WARN（不影响业务，但标记降级状态）

恢复流程：
  Redis 恢复后不自动切换回 BullMQ（避免状态不一致）
  需要服务重启才能切回 BullMQ 模式
  （MVP 阶段简化，后续可加入健康检查自动恢复）
```

### 2.5 Worker 重试策略详细设计

```typescript
// erp.inventory.shortage-recheck
{
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 5000,       // 5s -> 10s -> 30s（指数退避）
  },
  removeOnComplete: 100,
  removeOnFail: 500,
}

// erp.notification.send
{
  attempts: 5,
  backoff: {
    type: 'fixed',
    delay: 10000,      // 固定 10s 重试
  },
  removeOnComplete: 200,
  removeOnFail: 500,
}

// erp.schedule.suggestion-calculate
{
  attempts: 2,
  backoff: {
    type: 'fixed',
    delay: 30000,      // 固定 30s 重试
  },
  removeOnComplete: 50,
  removeOnFail: 200,
  // 失败后更新 schedule_suggestions.status = 'failed'
}
```

### 2.6 定时任务注册（每日 06:00 全量计算）

```
定时计算任务通过 BullMQ repeatableJob 注册：
  队列：erp.schedule.suggestion-calculate
  cron：0 6 * * *（每天 06:00，时区 Asia/Shanghai）
  jobId：schedule-daily-suggestion（幂等，重启不重复注册）
  payload：{ trigger: 'cron', tenantId: '*' }（注：多租户遍历在 Worker 内处理）

Worker 处理逻辑：
  若 payload.tenantId === '*'，查询所有 active 租户，逐个计算
  若 payload.tenantId 为具体值，仅计算该租户
```

### 2.7 Job 状态与前端轮询

```
Job 生命周期：
  waiting → active → completed / failed / delayed（重试等待中）

前端轮询端点：
  GET /api/schedule-suggestions/status?jobId={bullJobId}

  响应：
  {
    "jobId": "xxx",
    "status": "active" | "completed" | "failed" | "waiting",
    "progress": 60,           // 0-100，Worker 手动上报
    "result": { ... } | null, // completed 时返回建议摘要
    "error": "..." | null     // failed 时返回错误描述
  }

轮询频率：3秒/次（前端）
超时判定：30秒后若未完成，前端展示超时错误态（后台 Job 继续运行）
```

---

## 三、智能采购建议引擎设计

### 3.1 模块架构

```
ScheduleSuggestionService（编排层）
  │
  ├── 触发计算（三种入口）
  │     ├── 手动：POST /schedule-suggestions/calculate
  │     ├── 定时：BullMQ cron job（每日 06:00）
  │     └── 事件：BusinessEvent → BullMQ → Worker → calculate()
  │
  └── PurchaseSuggestionEngine（规则引擎）
        │
        ├── Step 1: ShortageCalculator（缺口计算）
        │     输入：material_requirements + inventory + purchase_orders(在途)
        │     输出：shortageQty per SKU
        │
        ├── Step 2: SafetyStockCalculator（安全库存补充）
        │     输入：sku.safety_stock + 当前库存 + 在途 + Step1结果
        │     输出：safetyReplenishQty per SKU
        │
        ├── Step 3: CapitalEvaluator（资金占用评估）
        │     输入：Step1+Step2总采购量 + supplier_prices.unit_price
        │     输入：配置参数 monthly_budget_threshold（可配置，默认 100000 元）
        │     输出：capitalWarning: boolean + capitalAmount: Decimal
        │     规则：超预算 → suggestedQty 降为仅 shortageQty（安全库存补充暂缓）
        │
        └── Step 4: SupplierRecommender（供应商推荐）
              输入：sku_id + supplier_prices（有效期内）
              计算：综合评分 = 价格权重 0.6 × 价格得分 + 交货及时率权重 0.4 × 及时率
              输出：recommendedSupplierId + supplierScore（0-100）
              降级：无有效报价 → status = 'pending_supplier'
```

### 3.2 数据输入源

| 数据 | 来源表 | 说明 |
|---|---|---|
| 工单物料需求 | `material_requirements` + `production_orders` | status IN ('pending', 'scheduled', 'in_progress') |
| 当前库存 | `inventory` | qty_on_hand - qty_reserved = 可用量 |
| 在途采购量 | `purchase_orders` + `purchase_order_items` | status IN ('confirmed', 'partial_received') |
| 安全库存阈值 | `skus.safety_stock` | 已有字段 |
| 供应商报价 | `supplier_prices` | status='active' AND 有效期内 |
| 供应商交货及时率 | `purchase_orders`（历史数据计算）| 近 90 天已完成 PO 中按时到货率 |
| 月度预算阈值 | `schedule_config`（新增配置表）或环境变量 | MVP 阶段用环境变量，默认 100000 元 |
| 历史数据天数 | `production_orders.created_at` | 最早工单日期到今日的天数 |

### 3.3 计算结果存储

```
计算触发
  │
  ├── 写入 schedule_suggestions 表
  │     suggestion_type = 'purchase_suggestion'
  │     status = 'calculating' → 计算完成后更新为 'completed' / 'failed'
  │     result_snapshot JSON：完整建议数组（含每条建议的四步计算数据）
  │
  ├── 写入 / 更新 purchase_suggestions 表
  │     source = 'ai_schedule'（已有枚举值）
  │     新增字段：engine_version, step1_shortage_qty, step2_safety_qty,
  │               step3_capital_warning, step3_capital_amount,
  │               step4_supplier_score, data_basis_days, calculated_at
  │     防重逻辑：同 SKU 已有 pending + source='ai_schedule' 建议 → UPDATE，否则 INSERT
  │
  └── 写入 schedule_suggestion_items 表
        每条建议的快照（含输入数据），关联 schedule_suggestions.id
```

### 3.4 防止自动执行的架构约束

```
架构层面强制约束（禁止绕过）：

1. ScheduleSuggestionEngine 和 PurchaseSuggestionEngine 均为纯计算服务：
   - 只负责读数据、计算、写建议表
   - 代码中严禁 import 或调用 PurchaseOrderService.create()
   - Code Review 必须检查此约束

2. purchase_suggestions 表 source='ai_schedule' 的建议，
   approved_by 字段为 NULL 时，PurchaseSuggestionService.batchCreatePOFromSuggestions()
   在 approved 状态校验前额外校验 approved_by 不为 NULL
   （后端强制，不可被前端绕过）

3. 若 source='ai_schedule' 且 approved_by IS NULL，后端返回：
   HTTP 403，message: "AI 调度建议必须经人工确认后才能创建采购订单"

4. 审计日志（suggestion_audit_logs）写入确认操作人和时间，
   无此记录则视为未经人工确认
```

---

## 四、智能排产建议引擎设计

### 4.1 三维评分算法设计

```
总分 = min(交期紧迫度得分, 50) + 订单优先级得分 + 物料就绪度得分

┌──────────────────────────────────────────────────────────────────┐
│ 维度一：交期紧迫度得分（满分 50 分）                               │
│                                                                  │
│ 剩余工作日 = DATEDIFF(planned_end, TODAY) -- 自然日               │
│ 剩余工时需求 = SUM(未完成工序的 process_steps.standard_hours)     │
│ 每日可排产工时 = 8 小时（可配置）                                  │
│ 工期余裕 = 剩余工作日 × 8 - 剩余工时需求                          │
│                                                                  │
│ 得分映射（线性插值）：                                             │
│   工期余裕 ≤ 0（已超期或当日必须完工）→ 50 分                     │
│   工期余裕 = 1 工时                   → 45 分                    │
│   工期余裕 = 8 工时（1天）            → 40 分                    │
│   工期余裕 = 40 工时（5天）           → 20 分                    │
│   工期余裕 ≥ 80 工时（10天+）         → 0 分                     │
│   中间值线性插值：得分 = MAX(0, 50 - (余裕工时 / 80 × 50))       │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│ 维度二：销售订单优先级得分（满分 30 分）                            │
│                                                                  │
│ 关联 sales_orders.priority = 'urgent'  → 30 分                  │
│ 关联 sales_orders.priority = 'normal'  → 0 分                   │
│ 无关联销售订单                          → 0 分                   │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│ 维度三：物料就绪度得分（满分 20 分）                               │
│                                                                  │
│ 数据来源：production_orders.material_status                      │
│   material_status = 'ready'    → 20 分（物料齐套）               │
│   material_status = 'partial'  → 10 分（有缺口但部分在途）        │
│   material_status = 'shortage' → 0 分（有缺口且无在途）          │
└──────────────────────────────────────────────────────────────────┘
```

### 4.2 工人产能匹配算法

```
工人产能数据来源：
  已分配工时 = SUM(production_tasks.planned_hours)
  过滤条件：task_date 在当前周（周一至周日）且 status != 'cancelled'

每周可用工时 = 40 小时（5天 × 8小时，可配置）

利用率 = 已分配工时 / 40 × 100%

过载判定：利用率 > 100%（已分配 > 40小时）

工序匹配规则（MVP 简化版）：
  若 process_steps 有 skill_type 字段 → 按技能类型筛选工人（扩展预留）
  MVP 阶段：返回所有 active 工人 + 各自本周利用率，由主管自行选择

推荐优先级（不强制，仅标注）：
  利用率 < 50%   → "空闲"标签（绿色）
  50% ~ 80%     → "正常"标签（黄色）
  80% ~ 100%    → "较忙"标签（橙色）
  > 100%        → "过载"标签（红色）+ 不推荐，但仍可选择
```

### 4.3 排产建议触发事件映射

| 触发事件 | 路由队列 | 延迟处理 |
|---|---|---|
| 新工单创建（PRODUCTION_ORDER_CREATED）| erp.schedule.suggestion-calculate | 无延迟，立即计算 |
| 工单 planned_end 修改 | erp.schedule.suggestion-calculate | 5s 防抖（同一工单多次修改合并为一次计算）|
| 工单优先级修改 | erp.schedule.suggestion-calculate | 5s 防抖 |
| 工序任务完工（TASK_COMPLETED）| erp.schedule.suggestion-calculate | 无延迟 |
| 新缺料检测完成（MATERIAL_SHORTAGE_DETECTED）| erp.schedule.suggestion-calculate | 10s 延迟（等缺料重评完成）|

**防抖实现**：BullMQ `jobId` 机制，同一租户、同一触发类型的计算任务，5s 内重复入队会替换原有 Job（`removeOnWait: true` + 固定 jobId）

### 4.4 与现有排产服务集成

```
现有服务（不修改）：
  ProductionService.generateSchedule()  → 自动排产（具体工人+日期分配）
  ProductionService.confirmSchedule()   → 确认排产（具体到工人）

新增服务（Sprint 4）：
  ProductionSuggestionEngine.calculate()  → 优先级排序建议（不分配具体工人）

集成边界：
  - 排产建议引擎不调用 generateSchedule() 或 confirmSchedule()
  - 排产建议只写入 schedule_suggestions 表（priority_score 建议值）
  - 人工确认后，调用 POST /schedule-suggestions/{id}/apply，
    仅更新 production_orders.priority_score 字段
  - 具体工人分配仍在 SchedulingPage 通过 adjustSchedule() 完成
```

---

## 五、数据库设计

## [artifact:数据库设计]

### 5.1 新增表设计

**设计原则**：
- 所有新增表包含 `tenant_id` 字段（多租户隔离）
- 不修改 Sprint 1-3 已有表的主键和外键约束
- purchase_suggestions 表仅新增列，不修改现有列

---

#### 5.1.1 schedule_suggestions（调度建议批次表）

```sql
CREATE TABLE schedule_suggestions (
  id                 BIGINT       NOT NULL AUTO_INCREMENT,
  tenant_id          INT          NOT NULL,
  suggestion_type    VARCHAR(50)  NOT NULL COMMENT 'purchase_suggestion | production_schedule | combined',
  trigger_type       VARCHAR(30)  NOT NULL COMMENT 'manual | cron | event',
  trigger_event      VARCHAR(100) NULL     COMMENT '触发来源事件名称，如 production_order.created',
  status             VARCHAR(20)  NOT NULL DEFAULT 'calculating'
                                           COMMENT 'calculating | completed | failed | partial',
  engine_version     VARCHAR(50)  NOT NULL DEFAULT 'rule_engine_v1',
  bullmq_job_id      VARCHAR(100) NULL     COMMENT 'BullMQ Job ID，用于前端轮询状态',
  purchase_count     INT          NOT NULL DEFAULT 0 COMMENT '本批次采购建议数',
  production_count   INT          NOT NULL DEFAULT 0 COMMENT '本批次排产建议数',
  data_basis_days    INT          NULL     COMMENT '计算所基于的历史数据天数',
  input_snapshot     JSON         NULL     COMMENT '计算输入数据快照：工单列表、库存状态、参数',
  result_snapshot    JSON         NULL     COMMENT '计算结果完整快照，用于历史回溯',
  error_message      VARCHAR(500) NULL     COMMENT '计算失败时的错误描述',
  calculated_at      DATETIME     NULL     COMMENT '计算完成时间',
  expires_at         DATETIME     NULL     COMMENT '快照归档时间（created_at + 90天）',
  is_archived        TINYINT(1)   NOT NULL DEFAULT 0,
  created_by         INT          NOT NULL,
  updated_by         INT          NOT NULL,
  created_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  INDEX idx_tenant_status        (tenant_id, status),
  INDEX idx_tenant_type_created  (tenant_id, suggestion_type, created_at DESC),
  INDEX idx_tenant_not_archived  (tenant_id, is_archived, created_at DESC),
  INDEX idx_bullmq_job_id        (bullmq_job_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='调度建议批次表，每次触发计算生成一条记录';
```

---

#### 5.1.2 schedule_suggestion_items（调度建议明细表）

```sql
CREATE TABLE schedule_suggestion_items (
  id                       BIGINT          NOT NULL AUTO_INCREMENT,
  tenant_id                INT             NOT NULL,
  suggestion_id            BIGINT          NOT NULL COMMENT '关联 schedule_suggestions.id',
  item_type                VARCHAR(30)     NOT NULL COMMENT 'purchase | production',

  -- 采购建议字段（item_type = 'purchase' 时有值）
  sku_id                   INT             NULL,
  purchase_suggestion_id   INT             NULL     COMMENT '关联 purchase_suggestions.id',
  step1_shortage_qty       DECIMAL(20, 4)  NULL     COMMENT '步骤一：缺口量',
  step1_affected_orders    JSON            NULL     COMMENT '步骤一：关联工单 [{orderId, workOrderNo, qtyRequired}]',
  step2_safety_qty         DECIMAL(20, 4)  NULL     COMMENT '步骤二：安全库存补充量',
  step2_safety_threshold   DECIMAL(20, 4)  NULL     COMMENT '步骤二：安全库存阈值',
  step3_capital_warning    TINYINT(1)      NULL     COMMENT '步骤三：是否触发资金占用预警',
  step3_capital_amount     DECIMAL(20, 2)  NULL     COMMENT '步骤三：预估采购金额',
  step3_budget_threshold   DECIMAL(20, 2)  NULL     COMMENT '步骤三：月度预算阈值',
  step4_supplier_id        INT             NULL     COMMENT '步骤四：推荐供应商 ID',
  step4_supplier_name      VARCHAR(200)    NULL     COMMENT '步骤四：推荐供应商名称',
  step4_supplier_score     DECIMAL(5, 2)   NULL     COMMENT '步骤四：供应商综合评分 0-100',
  step4_unit_price         DECIMAL(20, 6)  NULL     COMMENT '步骤四：供应商单价',
  step4_delivery_rate      DECIMAL(5, 2)   NULL     COMMENT '步骤四：供应商交货及时率 %',
  suggested_qty            DECIMAL(20, 4)  NULL     COMMENT '最终建议采购数量',

  -- 排产建议字段（item_type = 'production' 时有值）
  production_order_id      INT             NULL,
  work_order_no            VARCHAR(100)    NULL,
  priority_score           DECIMAL(5, 2)   NULL     COMMENT '优先级总分 0-100',
  dim1_urgency_score       DECIMAL(5, 2)   NULL     COMMENT '维度一：交期紧迫度得分 0-50',
  dim1_days_remaining      INT             NULL     COMMENT '维度一：剩余天数',
  dim1_hours_remaining     DECIMAL(10, 2)  NULL     COMMENT '维度一：剩余工时需求',
  dim1_schedule_slack      DECIMAL(10, 2)  NULL     COMMENT '维度一：工期余裕（小时）',
  dim2_order_priority_score DECIMAL(5, 2)  NULL     COMMENT '维度二：订单优先级得分 0-30',
  dim2_sales_order_priority VARCHAR(20)    NULL     COMMENT '维度二：销售订单优先级',
  dim3_material_score      DECIMAL(5, 2)   NULL     COMMENT '维度三：物料就绪度得分 0-20',
  dim3_material_status     VARCHAR(30)     NULL     COMMENT '维度三：物料状态',
  suggested_workers        JSON            NULL     COMMENT '建议工人列表 [{workerId, workerName, utilization}]',
  sort_rank                INT             NULL     COMMENT '建议排序名次（1=最优先）',

  -- 通用字段
  item_snapshot            JSON            NULL     COMMENT '该明细项的完整输入数据快照',
  created_at               DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  INDEX idx_suggestion_id        (suggestion_id),
  INDEX idx_tenant_sku           (tenant_id, sku_id),
  INDEX idx_tenant_order         (tenant_id, production_order_id),
  INDEX idx_purchase_suggestion  (purchase_suggestion_id),

  FOREIGN KEY (suggestion_id) REFERENCES schedule_suggestions(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='调度建议明细表，存储每条建议的分步计算数据';
```

---

#### 5.1.3 suggestion_audit_logs（建议审计日志表）

```sql
CREATE TABLE suggestion_audit_logs (
  id                    BIGINT          NOT NULL AUTO_INCREMENT,
  tenant_id             INT             NOT NULL,
  operator_id           INT             NOT NULL COMMENT '操作人 user_id',
  operator_name         VARCHAR(100)    NOT NULL COMMENT '操作人姓名（冗余，避免用户改名后失去可追溯性）',
  operated_at           DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  action_type           VARCHAR(30)     NOT NULL
                                        COMMENT 'accept | accept_modified | reject | apply_production | batch_accept',
  entity_type           VARCHAR(30)     NOT NULL COMMENT 'purchase_suggestion | production_suggestion',
  entity_id             INT             NOT NULL COMMENT '关联的建议 ID（purchase_suggestions.id 或 schedule_suggestions.id）',
  suggestion_item_id    BIGINT          NULL     COMMENT '关联的 schedule_suggestion_items.id（快照溯源）',

  -- 采购建议相关
  original_qty          DECIMAL(20, 4)  NULL     COMMENT '原始建议数量',
  final_qty             DECIMAL(20, 4)  NULL     COMMENT '最终 PO 数量（accept_modified 时可能不同）',
  reject_reason         VARCHAR(500)    NULL     COMMENT '驳回原因（reject 时必填）',
  modify_reason         VARCHAR(500)    NULL     COMMENT '修改原因（accept_modified 时必填）',
  created_po_id         INT             NULL     COMMENT '确认后创建的 PO ID',

  -- 排产建议相关
  applied_order_ids     JSON            NULL     COMMENT '应用的工单 ID 列表',
  priority_changes      JSON            NULL     COMMENT '优先级变更记录 [{orderId, beforeScore, afterScore}]',

  -- 通用
  suggestion_snapshot   JSON            NULL     COMMENT '操作时的建议完整快照（含计算步骤数据）',
  ip_address            VARCHAR(45)     NULL     COMMENT '操作 IP（审计合规）',
  created_at            DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  INDEX idx_tenant_entity        (tenant_id, entity_type, entity_id),
  INDEX idx_tenant_operator      (tenant_id, operator_id, operated_at DESC),
  INDEX idx_tenant_action        (tenant_id, action_type, created_at DESC),
  INDEX idx_suggestion_item      (suggestion_item_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='调度建议操作审计日志，记录所有人工确认、修改、驳回操作';
```

---

#### 5.1.4 purchase_suggestions 表新增列（ALTER TABLE）

```sql
-- 在 purchase_suggestions 表新增 Sprint 4 字段
-- 注意：不修改现有列，不影响现有数据，新列均允许 NULL（向前兼容）

ALTER TABLE purchase_suggestions
  ADD COLUMN engine_version        VARCHAR(50)     NULL
                                   COMMENT '规则引擎版本，rule_engine_v1 或 null（老数据）'
                                   AFTER confidence,
  ADD COLUMN step1_shortage_qty    DECIMAL(20, 4)  NULL
                                   COMMENT '步骤一：缺口量'
                                   AFTER engine_version,
  ADD COLUMN step2_safety_qty      DECIMAL(20, 4)  NULL
                                   COMMENT '步骤二：安全库存补充量'
                                   AFTER step1_shortage_qty,
  ADD COLUMN step3_capital_warning TINYINT(1)      NULL     DEFAULT 0
                                   COMMENT '步骤三：资金占用预警标志'
                                   AFTER step2_safety_qty,
  ADD COLUMN step3_capital_amount  DECIMAL(20, 2)  NULL
                                   COMMENT '步骤三：预估采购金额'
                                   AFTER step3_capital_warning,
  ADD COLUMN step4_supplier_score  DECIMAL(5, 2)   NULL
                                   COMMENT '步骤四：推荐供应商综合评分 0-100'
                                   AFTER step3_capital_amount,
  ADD COLUMN data_basis_days       INT             NULL
                                   COMMENT '计算所基于的历史数据天数'
                                   AFTER step4_supplier_score,
  ADD COLUMN calculated_at         DATETIME        NULL
                                   COMMENT '建议计算时间戳'
                                   AFTER data_basis_days,
  ADD COLUMN schedule_suggestion_id BIGINT         NULL
                                   COMMENT '关联的 schedule_suggestions.id（批次溯源）'
                                   AFTER calculated_at,
  ADD COLUMN approved_by           INT             NULL
                                   COMMENT '人工确认操作人 user_id（source=ai_schedule 必须非 NULL 才能转 PO）'
                                   AFTER schedule_suggestion_id,
  ADD COLUMN approved_at           DATETIME        NULL
                                   COMMENT '人工确认时间'
                                   AFTER approved_by,

  ADD INDEX idx_source_status_engine (source, status, engine_version),
  ADD INDEX idx_schedule_suggestion  (schedule_suggestion_id);
```

> **注意**：若 purchase_suggestions 表已存在 `approved_by` / `approved_at` 字段，跳过对应 ADD COLUMN。执行前须检查现有表结构。

---

#### 5.1.5 索引设计总结

| 表名 | 索引 | 用途 |
|---|---|---|
| schedule_suggestions | `(tenant_id, status)` | 查询当前计算中的 Job |
| schedule_suggestions | `(tenant_id, suggestion_type, created_at DESC)` | 历史记录列表（按时间倒序）|
| schedule_suggestions | `(bullmq_job_id)` | 轮询状态接口 |
| schedule_suggestion_items | `(suggestion_id)` | 批次明细查询 |
| schedule_suggestion_items | `(tenant_id, sku_id)` | 按 SKU 查历史建议 |
| schedule_suggestion_items | `(tenant_id, production_order_id)` | 按工单查历史建议 |
| suggestion_audit_logs | `(tenant_id, entity_type, entity_id)` | 按建议查审计记录 |
| suggestion_audit_logs | `(tenant_id, operator_id, operated_at DESC)` | 按操作人查操作历史 |

---

### 5.2 缓存设计（Redis Key 规范）

新增以下 Redis Key，统一在 `config/redis.ts` 的 `RedisKeys` 对象中维护：

```typescript
// 新增到 RedisKeys 常量对象
scheduleSuggestionStatus: (tenantId: number, jobId: string) =>
  `schedule_suggestion:status:${tenantId}:${jobId}`,  // TTL: 1小时

dashboardScheduleSummary: (tenantId: number) =>
  `dashboard:schedule_summary:${tenantId}`,           // TTL: 5分钟

inventoryTurnover: (tenantId: number) =>
  `inventory:turnover:${tenantId}`,                   // TTL: 30分钟

capacityUtilization: (tenantId: number, weekStart: string) =>
  `capacity:utilization:${tenantId}:${weekStart}`,    // TTL: 15分钟
```

---

## 六、API 接口设计

## [artifact:API文档]

### 6.1 统一响应格式

所有接口遵循现有规范：
```json
{
  "code": 200,
  "data": {},
  "message": "success"
}
```

错误码扩展（Sprint 4 新增）：
```
SCHEDULE_SUGGESTION_NOT_FOUND    = 40401  // 调度建议不存在
SUGGESTION_APPROVAL_REQUIRED     = 40301  // AI建议须经人工确认才能执行
SUGGESTION_STATUS_INVALID        = 40002  // 建议状态不允许此操作
CALCULATION_IN_PROGRESS          = 40901  // 计算任务正在进行中
PURCHASE_SUGGESTION_APPROVED_BY_REQUIRED = 40302  // ai_schedule 来源建议须有 approved_by
```

---

### 6.2 调度建议核心接口

#### 6.2.1 触发调度建议计算

```
POST /api/schedule-suggestions/calculate

描述：手动触发全量调度建议计算（采购建议+排产建议）
权限：requireRoles(['admin'])

Request Body：
{
  "type": "combined" | "purchase_only" | "production_only"  // 默认 "combined"
}

Response 200：
{
  "code": 200,
  "data": {
    "suggestionId": 123,          // schedule_suggestions.id
    "bullJobId": "xxx-yyy-zzz",   // BullMQ Job ID，用于轮询状态
    "status": "calculating",
    "message": "调度建议计算任务已提交，预计 10 秒内完成"
  },
  "message": "success"
}

Response 409（已有计算任务在运行）：
{
  "code": 40901,
  "data": {
    "runningJobId": "aaa-bbb",
    "startedAt": "2026-03-14T10:30:00Z"
  },
  "message": "当前已有调度建议计算任务正在运行，请等待完成后再触发"
}
```

#### 6.2.2 查询计算状态（轮询端点）

```
GET /api/schedule-suggestions/status?jobId={bullJobId}

描述：前端轮询，每 3 秒调用一次，查询 BullMQ Job 状态
权限：requireRoles(['admin', 'supervisor', 'purchaser'])

Response 200：
{
  "code": 200,
  "data": {
    "jobId": "xxx-yyy-zzz",
    "suggestionId": 123,
    "status": "waiting" | "active" | "completed" | "failed" | "delayed",
    "progress": 75,                  // 0-100，Worker 上报
    "calculatedAt": "2026-03-14T10:30:15Z",  // completed 时有值
    "summary": {                     // completed 时有值
      "purchaseCount": 12,
      "productionCount": 5,
      "dataBasisDays": 30
    },
    "error": null | "计算失败原因描述"   // failed 时有值
  },
  "message": "success"
}
```

#### 6.2.3 获取最新调度建议列表

```
GET /api/schedule-suggestions/latest

描述：获取最新一次计算完成的调度建议（分角色返回数据）
权限：requireRoles(['admin', 'supervisor', 'purchaser'])

Query Params：
  type    string  可选，'purchase' | 'production'，不传则返回全部（角色自动过滤）

Response 200（admin 视角）：
{
  "code": 200,
  "data": {
    "suggestionId": 123,
    "calculatedAt": "2026-03-14T10:30:15Z",
    "triggerType": "manual",
    "dataBasisDays": 30,
    "engineVersion": "rule_engine_v1",
    "dataColdStart": false,            // 经营数据不足14天时为 true
    "summary": {
      "pendingPurchaseCount": 12,
      "pendingProductionCount": 5,
      "inventoryAlertCount": 3,
      "overloadWorkerCount": 2
    },
    "purchaseSuggestions": [           // purchaser/admin 可见
      {
        "id": 456,                      // purchase_suggestions.id
        "suggestionNo": "PUS202603140001",
        "skuId": 789,
        "skuCode": "SKU-001",
        "skuName": "不锈钢管 Φ25",
        "purchaseUnit": "根",
        "suggestedQty": "150.0000",
        "estimatedPrice": "30.000000",
        "estimatedAmount": "4500.00",
        "status": "pending",
        "step3CapitalWarning": false,
        "step4SupplierName": "上海钢铁供应商A",
        "step4SupplierScore": 87.5,
        "calculatedAt": "2026-03-14T10:30:15Z",
        "dataBasisDays": 30
      }
    ],
    "productionSuggestions": [         // supervisor/admin 可见
      {
        "productionOrderId": 101,
        "workOrderNo": "WO-2026-001",
        "skuName": "软包大床 1.8m",
        "plannedEnd": "2026-03-17",
        "priorityScore": 95.0,
        "sortRank": 1,
        "isUrgent": true,
        "dim1UrgencyScore": 50.0,
        "dim2OrderPriorityScore": 30.0,
        "dim3MaterialScore": 15.0,
        "suggestedWorkers": [
          {
            "workerId": 201,
            "workerName": "王师傅",
            "utilizationPct": 50.0,
            "status": "idle"
          }
        ]
      }
    ]
  },
  "message": "success"
}
```

#### 6.2.4 获取采购建议计算步骤详情

```
GET /api/schedule-suggestions/purchase/{purchaseSuggestionId}/steps

描述：获取单条采购建议的四步计算详情（用于抽屉展示）
权限：requireRoles(['admin', 'purchaser'])

Response 200：
{
  "code": 200,
  "data": {
    "purchaseSuggestionId": 456,
    "skuId": 789,
    "skuCode": "SKU-001",
    "skuName": "不锈钢管 Φ25",
    "engineVersion": "rule_engine_v1",
    "calculatedAt": "2026-03-14T10:30:15Z",
    "dataBasisDays": 30,
    "steps": {
      "step1": {
        "title": "生产缺口计算",
        "affectedOrders": [
          {
            "orderId": 101,
            "workOrderNo": "WO-2026-001",
            "qtyRequired": "80.0000"
          }
        ],
        "totalRequired": "80.0000",
        "currentAvailable": "20.0000",
        "inTransitQty": "30.0000",
        "shortageQty": "30.0000",
        "formula": "80 - 20 - 30 = 30 件"
      },
      "step2": {
        "title": "安全库存补充",
        "safetyThreshold": "100.0000",
        "projectedStock": "80.0000",
        "safetyReplenishQty": "20.0000",
        "formula": "100 - 80 = 20 件"
      },
      "step3": {
        "title": "资金占用评估",
        "totalPurchaseQty": "50.0000",
        "unitPrice": "30.000000",
        "capitalAmount": "1500.00",
        "budgetThreshold": "100000.00",
        "capitalWarning": false,
        "conclusion": "在本月预算范围内，建议完整采购"
      },
      "step4": {
        "title": "推荐供应商",
        "candidates": [
          {
            "supplierId": 11,
            "supplierName": "上海钢铁供应商A",
            "unitPrice": "30.000000",
            "deliveryRate": 95.0,
            "priceScore": 85.0,
            "compositeScore": 87.0,
            "isRecommended": true,
            "lastPurchaseDate": "2026-02-10"
          },
          {
            "supplierId": 12,
            "supplierName": "江苏钢材经销商",
            "unitPrice": "28.000000",
            "deliveryRate": 80.0,
            "priceScore": 90.0,
            "compositeScore": 86.0,
            "isRecommended": false
          }
        ],
        "conclusion": "推荐上海钢铁供应商A，综合评分最高"
      }
    }
  },
  "message": "success"
}
```

#### 6.2.5 确认采购建议（人工确认接口）

```
POST /api/schedule-suggestions/purchase/{purchaseSuggestionId}/confirm

描述：人工确认采购建议（接受/修改接受/驳回），写入审计日志
权限：requireRoles(['admin'])

Request Body：
{
  "action": "accept" | "accept_modified" | "reject",
  "finalQty": "150.0000",          // accept_modified 时必填，不超过 suggested_qty × 2
  "modifyReason": "实际需要更多",    // accept_modified 时必填
  "rejectReason": "库存数据有误"    // reject 时必填
}

Response 200（accept / accept_modified）：
{
  "code": 200,
  "data": {
    "purchaseSuggestionId": 456,
    "action": "accept",
    "auditLogId": 789,
    "nextStep": "可前往采购建议列表进行转 PO 操作"
  },
  "message": "建议已确认，可转为采购订单"
}

Response 200（reject）：
{
  "code": 200,
  "data": {
    "purchaseSuggestionId": 456,
    "action": "reject",
    "auditLogId": 790
  },
  "message": "建议已驳回"
}
```

#### 6.2.6 批量确认采购建议

```
POST /api/schedule-suggestions/purchase/batch-confirm

描述：批量接受多条采购建议（完整接受，不支持批量修改数量）
权限：requireRoles(['admin'])

Request Body：
{
  "purchaseSuggestionIds": [456, 457, 458],
  "action": "accept"    // 批量仅支持 accept
}

Response 200：
{
  "code": 200,
  "data": {
    "accepted": 3,
    "auditLogIds": [789, 790, 791],
    "totalEstimatedAmount": "15000.00",
    "nextStep": "可前往采购建议列表批量转 PO"
  },
  "message": "已批量确认 3 条采购建议"
}
```

#### 6.2.7 应用排产建议（人工确认接口）

```
POST /api/schedule-suggestions/{suggestionId}/apply-production

描述：应用排产建议，更新选中工单的 priority_score 字段（不分配工人，不创建任务）
权限：requireRoles(['admin', 'supervisor'])

Request Body：
{
  "applyOrderIds": [101, 102, 103]   // 要应用的工单 ID 列表（可选择性应用）
}

Response 200：
{
  "code": 200,
  "data": {
    "appliedCount": 3,
    "priorityChanges": [
      {
        "orderId": 101,
        "workOrderNo": "WO-2026-001",
        "beforeScore": 50,
        "afterScore": 95
      }
    ],
    "auditLogId": 791,
    "nextStep": "可前往排产看板按新优先级进行具体排产"
  },
  "message": "排产建议已应用，工单优先级已更新"
}
```

#### 6.2.8 获取调度建议历史记录

```
GET /api/schedule-suggestions/history?page=1&pageSize=20&type=purchase

描述：历史建议批次列表（按计算时间倒序）
权限：requireRoles(['admin', 'supervisor', 'purchaser'])

Response 200：
{
  "code": 200,
  "data": {
    "list": [
      {
        "id": 123,
        "suggestionType": "combined",
        "triggerType": "manual",
        "status": "completed",
        "purchaseCount": 12,
        "productionCount": 5,
        "dataBasisDays": 30,
        "calculatedAt": "2026-03-14T10:30:15Z",
        "isArchived": false
      }
    ],
    "total": 47,
    "page": 1,
    "pageSize": 20
  },
  "message": "success"
}
```

#### 6.2.9 获取历史建议详情（快照回溯）

```
GET /api/schedule-suggestions/{suggestionId}/history-detail

描述：查看历史批次的完整建议内容（从快照渲染，不依赖实时数据）
权限：requireRoles(['admin', 'supervisor', 'purchaser'])

Response 200：
{
  "code": 200,
  "data": {
    "suggestionId": 120,
    "calculatedAt": "2026-03-13T06:00:00Z",
    "triggerType": "cron",
    "engineVersion": "rule_engine_v1",
    "dataBasisDays": 29,
    "isArchived": false,
    "purchaseSuggestions": [ /* 从 result_snapshot 反序列化 */ ],
    "productionSuggestions": [ /* 从 result_snapshot 反序列化 */ ],
    "auditDecisions": [        /* 该批次各条建议的人工决策记录 */
      {
        "purchaseSuggestionId": 456,
        "action": "accept",
        "operatorName": "张老板",
        "operatedAt": "2026-03-13T08:15:00Z",
        "originalQty": "150.0000",
        "finalQty": "150.0000"
      }
    ]
  },
  "message": "success"
}
```

---

### 6.3 数据分析接口

#### 6.3.1 库存周转分析

```
GET /api/inventory/turnover?page=1&pageSize=50&sortBy=capital_amount&alertOnly=false

描述：各 SKU 库存周转天数、滞销预警、资金占用分析
权限：requireRoles(['admin', 'warehouse'])

Response 200：
{
  "code": 200,
  "data": {
    "summary": {
      "totalCapitalAmount": "285000.00",
      "slowMovingSkuCount": 3,
      "staleInventoryCount": 1,
      "belowSafetyStockCount": 5
    },
    "list": [
      {
        "skuId": 789,
        "skuCode": "SKU-001",
        "skuName": "不锈钢管 Φ25",
        "currentStock": "500.0000",
        "stockUnit": "根",
        "latestPurchasePrice": "30.000000",
        "capitalAmount": "15000.00",
        "avgDailyConsumption": "5.5556",     // 近30天日均消耗
        "turnoverDays": 90,                   // 库存周转天数，null 表示近期无消耗
        "safetyStock": "100.0000",
        "safetyStockAchievement": 500.0,      // 达成率 %
        "safetyStockStatus": "normal",        // normal | warning | danger
        "slowMovingAlert": false,             // 周转天数 > 90
        "staleInventoryAlert": false,         // 无出库超60天
        "lastOutboundDate": "2026-03-10"
      }
    ],
    "total": 120,
    "page": 1,
    "pageSize": 50
  },
  "message": "success"
}
```

#### 6.3.2 工人产能利用率

```
GET /api/production/capacity?weekStart=2026-03-09

描述：当周工人产能利用率热力图数据
权限：requireRoles(['admin', 'supervisor'])

Response 200：
{
  "code": 200,
  "data": {
    "weekStart": "2026-03-09",
    "weekEnd": "2026-03-15",
    "weeklyCapacityHours": 40,
    "workers": [
      {
        "workerId": 201,
        "workerName": "王师傅",
        "totalAllocatedHours": 20.0,
        "utilizationPct": 50.0,
        "status": "idle",
        "isOverloaded": false,
        "dailyDetail": [
          {
            "date": "2026-03-09",
            "allocatedHours": 4.0,
            "tasks": [
              {
                "taskId": 501,
                "workOrderNo": "WO-2026-001",
                "processName": "裁切",
                "plannedHours": 4.0
              }
            ]
          }
        ]
      }
    ],
    "overloadedWorkerCount": 0
  },
  "message": "success"
}
```

#### 6.3.3 Dashboard 调度建议摘要 Widget

```
GET /api/dashboard/schedule-summary

描述：首页 Dashboard 调度建议 Widget 数据
权限：requireRoles(['admin', 'supervisor', 'purchaser'])

Response 200：
{
  "code": 200,
  "data": {
    "pendingPurchaseCount": 12,
    "pendingProductionCount": 5,
    "inventoryAlertSkuCount": 3,
    "overloadedWorkerCount": 2,
    "lastCalculatedAt": "2026-03-14T06:00:00Z",
    "lastJobStatus": "completed",
    "allNormal": false
  },
  "message": "success"
}
```

---

### 6.4 安全要求（所有新增接口）

| 接口路径前缀 | 允许角色 | 校验中间件 |
|---|---|---|
| POST /schedule-suggestions/calculate | admin | requireRoles(['admin']) |
| GET /schedule-suggestions/status | admin, supervisor, purchaser | requireRoles([...]) |
| GET /schedule-suggestions/latest | admin, supervisor, purchaser | requireRoles([...]) + 数据按角色过滤 |
| GET /schedule-suggestions/purchase/*/steps | admin, purchaser | requireRoles(['admin','purchaser']) |
| POST /schedule-suggestions/purchase/*/confirm | admin | requireRoles(['admin']) |
| POST /schedule-suggestions/purchase/batch-confirm | admin | requireRoles(['admin']) |
| POST /schedule-suggestions/*/apply-production | admin, supervisor | requireRoles(['admin','supervisor']) |
| GET /schedule-suggestions/history | admin, supervisor, purchaser | requireRoles([...]) + 数据按角色过滤 |
| GET /schedule-suggestions/*/history-detail | admin, supervisor, purchaser | requireRoles([...]) |
| GET /inventory/turnover | admin, warehouse | requireRoles(['admin','warehouse']) |
| GET /production/capacity | admin, supervisor | requireRoles(['admin','supervisor']) |
| GET /dashboard/schedule-summary | admin, supervisor, purchaser | requireRoles([...]) |

---

## 七、模块划分与目录结构

### 7.1 新增文件目录

```
services/api/src/
│
├── shared/
│   └── queue-service.ts          [新增] BullMQ 队列管理单例，三个队列的初始化、降级、监控
│
├── modules/
│   ├── events/
│   │   ├── event-bus.service.ts  [改造] 重构为 EventBusFacade，内部路由到 QueueService
│   │   └── business-events.enum.ts [改造] 新增 Sprint 4 业务事件枚举值
│   │
│   ├── schedule-suggestion/      [新增模块]
│   │   ├── schedule-suggestion.service.ts      编排服务：触发计算、状态管理、历史查询
│   │   ├── schedule-suggestion.controller.ts   HTTP 控制器：路由 + 权限校验
│   │   ├── schedule-suggestion.routes.ts       路由注册
│   │   ├── suggestion-audit.service.ts         审计日志写入服务
│   │   └── engines/
│   │       ├── purchase-suggestion.engine.ts   采购建议四步规则引擎（纯计算，无副作用）
│   │       └── production-suggestion.engine.ts 排产建议三维评分规则引擎（纯计算）
│   │
│   ├── inventory/
│   │   └── inventory-turnover.service.ts       [新增] 库存周转分析、滞销预警
│   │
│   ├── production/
│   │   └── capacity-analysis.service.ts        [新增] 工人产能利用率计算
│   │
│   └── purchase/
│       └── purchase-suggestion.service.ts      [改造] 新增 ai_schedule 来源校验逻辑
│
├── workers/                      [新增目录]
│   ├── mrp.worker.ts             缺料重评 Worker（消费 erp.inventory.shortage-recheck）
│   ├── suggestion.worker.ts      调度建议计算 Worker（消费 erp.schedule.suggestion-calculate）
│   └── notification.worker.ts   通知发送 Worker（消费 erp.notification.send）
│
└── index.ts                      [改造] 注册 BullMQ Workers，初始化定时任务
```

### 7.2 模块边界与禁止依赖

```
禁止的依赖关系（架构约束，Code Review 必须检查）：

PurchaseSuggestionEngine    ──禁止──→  PurchaseOrderService（创建采购订单）
PurchaseSuggestionEngine    ──禁止──→  任何写 purchase_orders 的方法

ProductionSuggestionEngine  ──禁止──→  ProductionService.generateSchedule()
ProductionSuggestionEngine  ──禁止──→  ProductionService.confirmSchedule()
ProductionSuggestionEngine  ──禁止──→  任何写 production_tasks 的方法

Workers（所有 Worker）       ──禁止──→  直接调用 HTTP 接口（禁止 axios/fetch 内部调用）
Workers（所有 Worker）       ──禁止──→  直接操作 purchase_orders / production_tasks 写操作

允许的依赖关系：
PurchaseSuggestionEngine    ──允许──→  MrpService（只读方法）
PurchaseSuggestionEngine    ──允许──→  InventoryService（只读方法）
PurchaseSuggestionEngine    ──允许──→  只读 SQL 查询（AppDataSource.query SELECT）

ScheduleSuggestionService   ──允许──→  PurchaseSuggestionEngine（调用计算方法）
ScheduleSuggestionService   ──允许──→  ProductionSuggestionEngine（调用计算方法）
ScheduleSuggestionService   ──允许──→  PurchaseSuggestionService（读取现有建议）
ScheduleSuggestionService   ──允许──→  QueueService（发布任务）
```

---

## 八、技术规范

### 8.1 代码规范

**命名规范**：
- 引擎类：`XxxEngine`（如 `PurchaseSuggestionEngine`）
- 服务类：`XxxService`（如 `ScheduleSuggestionService`）
- Worker 文件：`xxx.worker.ts`（如 `suggestion.worker.ts`）
- 队列名常量：`QUEUE_xxx`（如 `QUEUE_SHORTAGE_RECHECK`）
- 事件名枚举：`BusinessEvent.XXX_YYY`（大写下划线）
- 接口返回字段：camelCase

**错误处理规范**：
- Worker 内所有数据库操作必须 try-catch，异常通过 `job.log()` 记录
- Worker 异常必须 throw（让 BullMQ 感知，触发重试和 failed 事件）
- 引擎计算异常不得静默失败，必须向上抛出，由 Worker 处理
- 降级场景（Redis 不可用）必须有日志：`logger.warn('[BullMQ] ...')`

**日志规范**：
```
[BullMQ:erp.schedule.suggestion-calculate] Job #xxx started, tenantId=1
[BullMQ:erp.schedule.suggestion-calculate] Job #xxx completed in 8.3s, purchase=12, production=5
[BullMQ:erp.schedule.suggestion-calculate] Job #xxx failed (attempt 1/2): Database timeout
[BullMQ] Redis connection failed, falling back to in-process EventEmitter
[PurchaseSuggestionEngine] SKU-001 计算完成: shortageQty=30, safetyQty=20, capitalWarning=false
[ProductionSuggestionEngine] WO-001 优先级得分: 95 (紧迫度50 + 订单优先级30 + 物料就绪度15)
```

**SQL 规范**：
- 所有 SQL 参数化（禁止字符串拼接）
- 所有 INSERT/UPDATE 带 tenant_id 条件
- JSON 字段使用 MySQL `JSON_OBJECT` 函数或 TypeScript 序列化后作为参数绑定
- 快照 JSON 存储前必须通过 `JSON.stringify()` 序列化，不直接插入 JS 对象

**TypeScript 规范**：
- 引擎类的计算方法返回类型必须明确声明接口（不使用 `any`）
- 所有 Decimal 计算使用 `decimal.js`（禁止 JS 原生浮点运算）
- Worker processor 函数类型：`Processor<JobPayload, JobResult>`（BullMQ 泛型）

---

### 8.2 测试规范

| 测试类型 | 覆盖要求 | 重点场景 |
|---|---|---|
| 单元测试 | 引擎层覆盖率 ≥ 90% | 五个 QA 验收场景（场景A-E），边界值（缺口=0，在途覆盖）|
| 集成测试 | Worker 完整链路 | 入库 → BullMQ 入队 → Worker 消费 → 缺料重评，全链路 < 30s |
| 降级测试 | Redis 宕机场景 | 模拟 Redis 连接失败，验证 EventEmitter 降级路径 |
| 性能测试 | 入库接口 P95 < 200ms | k6 并发 10 请求，P95 响应时间 |

---

## 九、扩展策略与技术风险

### 9.1 扩展策略

**向 LLM AI 版本扩展**（系统积累 4-8 周数据后）：
- `engine_version` 字段已预留版本区分（`rule_engine_v1` → `llm_v1`）
- `PurchaseSuggestionEngine` 接口不变，仅替换内部计算逻辑
- 新增 LLM 引擎类实现相同接口，通过配置切换（功能开关）
- 规则引擎结果可作为 LLM Prompt 的基础上下文

**水平扩展**（业务增长后）：
- Worker 可独立进程部署（当前同进程，后期抽取为独立服务）
- BullMQ 支持多 Worker 并发消费（Worker 并发数可配置）
- MySQL 读写分离：分析类查询（库存周转、产能利用率）走只读副本

**多租户计算隔离**（租户数增长后）：
- 当前：同一 Worker 串行处理多租户（单次 cron 触发）
- 扩展：每租户独立入队，BullMQ 支持优先级队列（付费租户优先）

### 9.2 技术风险与缓解

| 风险 | 概率 | 影响 | 缓解措施 |
|---|---|---|---|
| BullMQ 与现有 Bull@4 版本冲突 | 中 | 高 | 两者共存（不同包名），BullMQ 为全新依赖；bull@4 仅保留用于 stock-alert 队列 |
| MySQL JSON 列大快照查询性能 | 低 | 中 | 快照 JSON 只在详情接口查询（不在列表接口），列表只查摘要字段 |
| 大数据量下计算超时（>10s）| 低 | 中 | Worker 设置 lockDuration=60000（60s 心跳超时），BullMQ 不会将未超时 Job 判定为 stalled |
| Redis 长时间不可用时历史 Job 丢失 | 低 | 低 | 降级到同步处理，历史记录仍写 MySQL；手动触发可在 Redis 恢复后重新计算 |
| 多租户同时触发全量计算导致 DB 压力 | 低 | 中 | BullMQ 队列天然串行（单 Worker），防止并发；后期可加 DB 连接池限流 |

### 9.3 注意事项（后端工程师）

1. **BullMQ 依赖安装**：`npm install bullmq`（bull@4 保留，不删除）
2. **Bull vs BullMQ**：两者 API 不同，注意不要混用。`shared/queue.ts` 中的 `getStockAlertQueue()` 继续使用 Bull v4；新增的三个队列使用 BullMQ
3. **purchase_suggestions 表改造**：ALTER TABLE 前检查表中是否已有 `approved_by` 字段（Sprint 3 部分实现可能已添加）
4. **JSON 快照大小限制**：MySQL JSON 列单行上限约 1GB，实际快照应控制在 1MB 以内；若工单数超过 200 个，result_snapshot 只保存摘要，完整数据存 schedule_suggestion_items
5. **时区处理**：定时任务 cron 表达式需明确时区（`Asia/Shanghai`），BullMQ 的 `repeat.tz` 参数
6. **Worker 启动顺序**：Worker 必须在 `AppDataSource.initialize()` 完成后再启动（避免数据库未就绪时 Worker 接到消息）

---

## 附录：数据流完整时序图

### A. 入库触发缺料重评（BullMQ 改造后）

```
客户端 → POST /incoming-inspections/{id}/approve
  │
  └── IncomingInspectionController
        ├── 执行入库事务（写 inventory、purchase_order_items）
        ├── 事务 COMMIT（< 100ms）
        ├── EventBusFacade.publish(PURCHASE_RECEIPT_CONFIRMED, payload)
        │     └── QueueService.enqueue('erp.inventory.shortage-recheck', payload)
        │           └── [BullMQ 异步入队，接口立即返回]
        └── 返回 HTTP 200（< 200ms）

[后台 - BullMQ Worker - 异步执行]
erp.inventory.shortage-recheck 队列消费
  └── MrpWorker.process(job)
        └── MrpService.reevaluateAfterReceipt(skuId)
              └── [缺料重评，更新 material_requirements 和 production_orders]
              └── EventBusFacade.publish(MATERIAL_SHORTAGE_DETECTED, ...)
                    └── [进一步触发排产建议重新计算]
```

### B. 手动触发调度建议计算

```
客户端 → POST /schedule-suggestions/calculate
  │
  └── ScheduleSuggestionController
        ├── 写 schedule_suggestions（status='calculating'）
        ├── QueueService.enqueue('erp.schedule.suggestion-calculate', {suggestionId, tenantId})
        └── 返回 HTTP 200（含 bullJobId）

[前端开始轮询 GET /schedule-suggestions/status?jobId=xxx，每 3 秒]

[后台 - BullMQ Worker]
erp.schedule.suggestion-calculate 队列消费
  └── SuggestionWorker.process(job)
        └── ScheduleSuggestionService.calculate(suggestionId, tenantId)
              ├── PurchaseSuggestionEngine.calculate(tenantId)
              │     ├── Step1: 缺口计算（读 material_requirements + inventory）
              │     ├── Step2: 安全库存补充（读 skus.safety_stock）
              │     ├── Step3: 资金占用评估（读 supplier_prices）
              │     └── Step4: 供应商推荐（读 supplier_prices，计算综合评分）
              ├── ProductionSuggestionEngine.calculate(tenantId)
              │     ├── Dim1: 交期紧迫度（读 production_orders, process_steps）
              │     ├── Dim2: 订单优先级（读 sales_orders）
              │     └── Dim3: 物料就绪度（读 production_orders.material_status）
              ├── 写 purchase_suggestions（UPDATE or INSERT）
              ├── 写 schedule_suggestion_items（明细+快照）
              └── 更新 schedule_suggestions（status='completed', result_snapshot=...）

[前端轮询响应：status='completed']
→ 前端刷新建议列表
```

---

*文档版本*：v1.0
*创建日期*：2026-03-14
*作者*：@tech-lead-architect
*状态*：待 @system-designer 架构评审 → 待 @engineering-manager 工程审批

**下一步行动**：
- @system-designer：评审本架构文档，重点检查：BullMQ 降级策略合理性、数据库索引完整性、缓存策略是否覆盖主要热点
- @engineering-manager：SDD 审批，确认调度建议与采购/排产执行动作之间的架构隔离是否满足"禁止自动执行"要求
- @senior-backend-engineer：对照本文档，Week 1 优先实施 BullMQ 改造（US-S4-008），Week 2 实施规则引擎
- @senior-frontend-engineer：对照本文档第六节 API 接口设计，同步进行前端联调方案设计
