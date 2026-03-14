# Sprint 4 P0 功能测试用例

**文档编号**：QA-SPRINT4-TC-001
**版本**：v1.0
**创建日期**：2026-03-14
**负责人**：@senior-qa-engineer
**测试范围**：BullMQ 消息队列、采购建议引擎、排产建议引擎、调度建议 API、采购建议强制校验、前端智能调度看板

---

## 目录

1. [测试环境与前置说明](#一测试环境与前置说明)
2. [BullMQ 消息队列测试](#二bullmq-消息队列测试)
3. [采购建议引擎测试](#三采购建议引擎测试)
4. [排产建议引擎测试](#四排产建议引擎测试)
5. [调度建议 API 测试](#五调度建议-api-测试)
6. [采购建议强制校验测试](#六采购建议强制校验测试)
7. [前端智能调度看板测试](#七前端智能调度看板测试)
8. [PRD 预定义场景测试](#八prd-预定义场景测试)
9. [性能与并发测试](#九性能与并发测试)
10. [测试用例汇总统计](#十测试用例汇总统计)

---

## 一、测试环境与前置说明

### 1.1 测试技术栈

- 接口测试：Supertest + Jest
- 单元测试：Jest + ts-jest
- 数值精度验证：Decimal.js（与实现保持一致）
- E2E 思路：Playwright（验证前端五种状态转换）

### 1.2 通用前置条件

- 系统已部署且数据库连接正常
- 测试租户 `tenantId=1` 已初始化
- 角色体系：supervisor（主管）、boss（老板）、purchase（采购员）
- 所有接口调用均携带有效 JWT Token，token 通过 `/api/auth/login` 预先获取
- BullMQ 测试分为"Redis 可用"与"Redis 不可用（降级）"两种环境

### 1.3 测试数据约定

- `NOW` = 2026-03-14 09:00:00（固定基准时间，避免时区差异）
- 数值精度验证保留 4 位小数（suggestedQty）或 2 位小数（capitalCost）
- 评分精度验证保留 2 位小数

---

## 二、BullMQ 消息队列测试

### 模块说明

测试目标：`services/api/src/shared/queue-service.ts` 与 `queue.config.ts`，以及 `workers/suggestion.worker.ts`

---

| 用例ID | 模块 | 优先级 | 标题 | 前置条件 | 测试步骤 | 期望结果 |
|---|---|---|---|---|---|---|
| TC-S4-001 | BullMQ/队列初始化 | P0 | 队列服务单例初始化 | Redis 服务运行中；应用启动 | 1. 导入 `queueService` 单例<br>2. 连续调用 `QueueService.getInstance()` 两次<br>3. 比较两次返回的引用 | 两次返回同一实例（引用相等）；队列名称常量 `QUEUE_SHORTAGE_RECHECK`、`QUEUE_SUGGESTION_CALCULATE`、`QUEUE_NOTIFICATION_SEND` 均可通过 `getQueue()` 获取非空队列实例 |
| TC-S4-002 | BullMQ/队列初始化 | P0 | 三个队列均使用 erp_bullmq prefix | Redis 服务运行中 | 1. 获取 `QUEUE_SUGGESTION_CALCULATE` 队列实例<br>2. 读取队列配置 prefix | prefix 为 `erp_bullmq`，与 legacy `bull:` prefix 完全隔离；Redis Key 格式为 `erp_bullmq:erp.schedule.suggestion-calculate:*` |
| TC-S4-003 | BullMQ/addJob | P0 | 正常添加 Job 并返回 Job 实例 | Redis 可用；队列已初始化 | 1. 调用 `queueService.addJob('erp.schedule.suggestion-calculate', payload, options)`<br>2. 检查返回值 | 返回非 null 的 BullMQ Job 实例；`job.id` 为字符串；`isBullMQAvailable()` 返回 `true` |
| TC-S4-004 | BullMQ/addJob | P0 | addJob 携带 jobId 去重选项 | Redis 可用 | 1. 以相同 `jobId: 'schedule-suggestion-100'` 连续调用 `addJob` 两次 | 第一次调用成功返回 Job；第二次调用因 jobId 已存在不重复创建（BullMQ 幂等性）；数据库批次记录仅存在一条 |
| TC-S4-005 | BullMQ/降级保护 | P0 | Redis 不可用时 addJob 降级到 EventEmitter | 强制使 Redis 连接失败（配置错误的 Redis host）| 1. 注册降级监听 `queueService.onFallback(queueName, handler)`<br>2. 调用 `addJob`<br>3. 检查 handler 是否被触发 | `addJob` 返回 `null`；控制台输出 `WARN` 日志（含"降级到 EventEmitter"字样）；`isBullMQAvailable()` 返回 `false`；降级 handler 被同步调用，传入的 data 与入参一致 |
| TC-S4-006 | BullMQ/降级保护 | P0 | 降级场景下调度建议触发流程不中断 | Redis 不可用 | 1. 以 supervisor 角色调用 `POST /api/schedule-suggestions/calculate`<br>2. 等待响应 | HTTP 201 返回；响应体中 `jobId` 为 null；`batchId` 和 `batchNo` 有效；数据库中批次状态为 `pending`（降级时同步执行或由 EventEmitter 处理） |
| TC-S4-007 | BullMQ/Worker消费 | P0 | SuggestionWorker 正常消费并完成计算 | Redis 可用；已存在 status=pending 的批次记录；数据库中有缺料工单和待排产工单 | 1. 向 `erp.schedule.suggestion-calculate` 队列推入含 `{batchId, tenantId}` 的 Job<br>2. 等待 Worker 完成处理（最多 30 秒）<br>3. 查询批次状态 | 批次状态从 `pending` → `calculating` → `completed`；`calc_started_at` 和 `calc_finished_at` 均不为 null；`purchase_count` 和 `production_count` 与实际写入明细数一致 |
| TC-S4-008 | BullMQ/Worker消费 | P0 | Worker 重复消费防护（状态非 pending 跳过） | 数据库中批次状态已为 `calculating` | 1. 手动触发 Worker 处理同一 `batchId` | Worker 输出 WARN 日志（含"跳过重复执行"）；批次状态不变；不新增 `schedule_suggestion_items` 记录 |
| TC-S4-009 | BullMQ/Worker消费 | P0 | Worker 计算失败时触发重试并更新状态 | 引擎计算抛出异常（mock 数据库断连）| 1. 构造会触发计算异常的场景<br>2. 推入 Job<br>3. 观察重试行为 | 批次状态更新为 `failed`；`error_message` 字段记录异常信息（截断至 2000 字符）；BullMQ 按 `attempts=3, backoff=fixed 30s` 策略重试；三次均失败后 Worker fired 事件 |
| TC-S4-010 | BullMQ/Worker消费 | P1 | Worker 并发控制：同时只处理 1 个 Job | Redis 可用；Worker 配置 `concurrency=1` | 1. 同时向队列推入 3 个 Job<br>2. 观察处理顺序 | 三个 Job 串行处理（不并发）；通过 `calc_started_at` 时间戳确认不重叠 |
| TC-S4-011 | BullMQ/优雅关闭 | P1 | 进程 SIGTERM 时 Worker 优雅关闭 | Worker 正在处理 Job | 1. 向进程发送 SIGTERM<br>2. 等待关闭 | `closeSuggestionWorker()` 被调用；当前 Job 完成后 Worker 才关闭（不强制中断）；控制台输出"已关闭"日志 |
| TC-S4-012 | BullMQ/配置 | P1 | maxRetriesPerRequest=null 配置正确 | 任意 | 1. 读取 `getBullMQConnectionOptions()` 返回值 | `maxRetriesPerRequest` 为 `null`；`enableReadyCheck` 为 `false`；host/port 从环境变量读取，无默认硬编码生产值 |

---

## 三、采购建议引擎测试

### 模块说明

测试目标：`services/api/src/modules/schedule-suggestion/purchase-suggestion.engine.ts`

四步规则引擎：Step1 缺口计算 → Step2 安全库存补充 → Step3 资金评估 → Step4 供应商推荐

---

| 用例ID | 模块 | 优先级 | 标题 | 前置条件 | 测试步骤 | 期望结果 |
|---|---|---|---|---|---|---|
| TC-S4-013 | 采购引擎/Step1 | P0 | 标准缺口计算（场景B） | tenantId=1；SKU-A：qty_on_hand=30，qty_reserved=0，qty_in_transit=20，order_demand=100，safety_stock=50 | 1. 调用 `PurchaseSuggestionEngine.calculate(1)`<br>2. 取 SKU-A 对应结果<br>3. 验证 Step1 result | qtyAvailable = MAX(30-0, 0) = 30.0000<br>shortageQty = MAX(0, 100-30-20) = 50.0000<br>Step1 result.value = "50.0000" |
| TC-S4-014 | 采购引擎/Step2 | P0 | 安全库存补充量计算（场景B） | 同 TC-S4-013，safetyStock=50 | 1. 继续检查 Step2<br>2. 计算 safetyStockComplement<br>3. 验证 suggestedQty | safetyStockComplement = MAX(0, 50-30+50) = 70<br>suggestedQty = MAX(50, 70) = 70.0000<br>Step2 result.value = "70.0000" |
| TC-S4-015 | 采购引擎/Step1 | P0 | 库存充足不产生缺口 | SKU-B：qty_on_hand=200，qty_reserved=10，qty_in_transit=50，order_demand=100，safety_stock=20 | 1. 调用引擎计算<br>2. 检查结果集中是否包含 SKU-B | shortageQty = MAX(0, 100-190-50) = 0；SKU-B 不出现在结果集中（material_requirements.qty_shortage <= 0，被 WHERE 过滤）|
| TC-S4-016 | 采购引擎/Step1 | P0 | qty_reserved 超过 qty_on_hand 时可用库存归零 | SKU-C：qty_on_hand=10，qty_reserved=30，qty_in_transit=0，order_demand=50 | 1. 调用引擎计算 | qtyAvailable = MAX(10-30, 0) = 0；shortageQty = MAX(0, 50-0-0) = 50.0000；不出现负数 |
| TC-S4-017 | 采购引擎/Step1 | P0 | 无库存记录时按零处理 | SKU-D：inventory 表无对应记录，order_demand=80 | 1. 调用引擎计算 | qty_on_hand=0，qty_reserved=0，qty_in_transit=0；shortageQty = 80.0000；引擎不抛出异常 |
| TC-S4-018 | 采购引擎/Step2 | P0 | 安全库存为零时建议量等于缺口量 | SKU-E：safety_stock=0，shortageQty=40 | 1. 调用引擎计算 | safetyStockComplement = MAX(0, 0-可用库存+40) 视具体值而定；suggestedQty >= shortageQty；Step2 公式结果不为负 |
| TC-S4-019 | 采购引擎/Step3 | P0 | 有历史采购记录时资金估算正确 | 历史 purchase_order_items 中 SKU-A 最近单价为 150.00 | 1. 检查 Step3 result | capitalCost = suggestedQty × 150.00；capitalCost 精度保留 2 位小数；lastPurchasePrice.toFixed(4) = "150.0000" |
| TC-S4-020 | 采购引擎/Step3 | P0 | 无历史采购记录时单价按零处理 | SKU-F：purchase_order_items 无记录 | 1. 调用引擎计算 | lastPurchasePrice = "0.0000"；capitalCost = "0.00"；引擎不报错 |
| TC-S4-021 | 采购引擎/Step4 | P0 | 有历史采购记录时推荐最高综合评分供应商 | 供应商A：freq=10，avg_price=100；供应商B：freq=5，avg_price=80 | 1. 调用引擎计算<br>2. 验证 Step4 结果 | freqScore_A=100，priceScore_A=(100-100)/(100-80)×100=0；compositeScore_A=60；freqScore_B=50，priceScore_B=100；compositeScore_B=70；推荐供应商B；supplierScore="70.00" |
| TC-S4-022 | 采购引擎/Step4 | P0 | 单一供应商时价格评分满分 | 只有一个历史采购供应商（priceRange=0）| 1. 调用引擎计算 | priceScore=100（priceRange=0 时取满分）；compositeScore=100×0.6+100×0.4=100.00 |
| TC-S4-023 | 采购引擎/Step4 | P0 | 无历史采购记录降级为报价最低供应商 | purchase_order_items 无记录；supplier_prices 有两条有效报价：供应商X单价=90，供应商Y单价=70 | 1. 调用引擎计算 | 推荐供应商Y（报价最低）；supplierScore="50.00"（基准分）；leadTimeDays 取自 supplier_prices |
| TC-S4-024 | 采购引擎/Step4 | P0 | 无历史采购且无有效报价时不推荐供应商 | purchase_order_items 无记录；supplier_prices 无有效记录（已过期或无数据）| 1. 调用引擎计算 | suggestedSupplierId=null；supplierName=null；supplierScore="0.00"；Step4 result.value="暂无推荐" |
| TC-S4-025 | 采购引擎/计算步骤 | P0 | 返回四步 CalcStep 结构完整 | 任意有缺口的 SKU | 1. 调用引擎并取 calcSteps | calcSteps 数组长度=4；stepNo 依次为 1、2、3、4；每步包含 title、description、inputs、formula、result 字段；inputs 数组非空 |
| TC-S4-026 | 采购引擎/边界 | P0 | 所有工单满足库存时返回空数组 | material_requirements 中无 status=shortage/partial 的记录 | 1. 调用引擎计算 | 返回空数组 `[]`；不抛出异常 |
| TC-S4-027 | 采购引擎/边界 | P1 | 多 SKU 按缺口量降序排列 | 3个 SKU 缺口分别为 100、30、200 | 1. 调用引擎计算<br>2. 检查返回顺序 | 结果按 total_shortage DESC 排序：200 → 100 → 30 |
| TC-S4-028 | 采购引擎/边界 | P1 | 大数值精度验证（Decimal.js）| suggestedQty=999999.9999，unitPrice=9999.9999 | 1. 调用引擎计算 | capitalCost 精度不丢失（Decimal.js 防浮点误差）；结果可与预算值精确比较 |
| TC-S4-029 | 采购引擎/安全 | P0 | 纯计算模块不写入任何表 | 已有完整测试数据 | 1. 记录调用前 purchase_orders 行数<br>2. 调用引擎<br>3. 再次查询行数 | purchase_orders、purchase_order_items 行数不变；schedule_suggestion_items 不被引擎直接写入 |
| TC-S4-030 | 采购引擎/SQL注入 | P0 | tenantId 参数化防注入 | 传入 tenantId="1 OR 1=1" | 1. 调用 `calculate("1 OR 1=1" as any)` | 类型校验层拦截（TypeScript 类型为 number）；若到达 SQL 层，参数化查询使其无法注入；不返回跨租户数据 |

---

## 四、排产建议引擎测试

### 模块说明

测试目标：`services/api/src/modules/schedule-suggestion/production-suggestion.engine.ts`

三维评分：A 交期紧迫度（0-50分）、B 订单优先级（0-30分）、C 物料就绪度（0-20分）

---

| 用例ID | 模块 | 优先级 | 标题 | 前置条件 | 测试步骤 | 期望结果 |
|---|---|---|---|---|---|---|
| TC-S4-031 | 排产引擎/维度A | P0 | 交期紧迫度：余裕16工时（场景C） | 工单交期=NOW+16小时；`DEADLINE_MAX_SLACK_HOURS=80` | 1. 调用 `ProductionSuggestionEngine.calculate(1)`<br>2. 取对应工单的 deadlineScore | deadlineScore = MAX(0, 50-(16/80×50)) = MAX(0, 50-10) = 40.00 |
| TC-S4-032 | 排产引擎/维度A | P0 | 交期紧迫度：已过期（余裕<=0 → 满分） | 工单交期=NOW-1小时（已超期）| 1. 调用引擎 | deadlineScore = 50.00 |
| TC-S4-033 | 排产引擎/维度A | P0 | 交期紧迫度：余裕>=80工时（0分） | 工单交期=NOW+80小时 | 1. 调用引擎 | deadlineScore = 0.00 |
| TC-S4-034 | 排产引擎/维度A | P0 | 交期紧迫度：无交期设置 | 工单 expected_delivery=null，planned_end=null | 1. 调用引擎 | slackHours = DEADLINE_MAX_SLACK_HOURS(80)；deadlineScore = 0.00（视为不紧急）；不抛出异常 |
| TC-S4-035 | 排产引擎/维度A | P1 | 交期优先级：优先使用销售订单 expected_delivery | 销售订单 expected_delivery=NOW+10h；工单 planned_end=NOW+50h | 1. 调用引擎 | 使用 expected_delivery 计算：deadlineScore = MAX(0, 50-(10/80×50)) = 43.75 |
| TC-S4-036 | 排产引擎/维度B | P0 | 订单优先级：urgent=30分 | 销售订单 order_type='urgent' | 1. 调用引擎 | priorityScore = 30.00 |
| TC-S4-037 | 排产引擎/维度B | P0 | 订单优先级：high=22分 | 销售订单 order_type='high' | 1. 调用引擎 | priorityScore = 22.00 |
| TC-S4-038 | 排产引擎/维度B | P0 | 订单优先级：normal=15分 | 销售订单 order_type='normal' | 1. 调用引擎 | priorityScore = 15.00 |
| TC-S4-039 | 排产引擎/维度B | P0 | 订单优先级：low=8分（场景D） | 销售订单 order_type='low' 或 priority<30 | 1. 调用引擎 | priorityScore = 8.00 |
| TC-S4-040 | 排产引擎/维度B | P0 | 无关联销售订单时默认 normal=15分 | 工单 sales_order_id=null | 1. 调用引擎 | priorityScore = 15.00；priorityLabel = 'normal（默认）' |
| TC-S4-041 | 排产引擎/维度B | P1 | 数值型 priority 映射：priority=85 → urgent | 销售订单 priority=85，order_type=null | 1. 调用引擎 | p>=80 → urgent；priorityScore = 30.00 |
| TC-S4-042 | 排产引擎/维度B | P1 | 数值型 priority 映射：priority=65 → high | 销售订单 priority=65，order_type=null | 1. 调用引擎 | 60<=p<80 → high；priorityScore = 22.00 |
| TC-S4-043 | 排产引擎/维度C | P0 | 物料全齐 → 20分（场景D） | 工单 BOM 共3种物料，库存全部满足 | 1. 调用引擎 | readyRate=1.0；materialScore = 1.0×20 = 20.00 |
| TC-S4-044 | 排产引擎/维度C | P0 | 物料半齐 → 10分 | 工单 BOM 共4种物料，库存满足2种 | 1. 调用引擎 | readyRate=0.5；materialScore = 0.5×20 = 10.00 |
| TC-S4-045 | 排产引擎/维度C | P0 | 无 BOM 记录时视为全齐 → 20分 | 工单无 bom_header_id 关联（BOM 表无数据）| 1. 调用引擎 | readyRate=1；materialScore = 20.00；total_materials=0 |
| TC-S4-046 | 排产引擎/总分排序 | P0 | 多工单按总分降序排列并赋予 suggestedRank | 3个工单总分分别为 65、45、78 | 1. 调用引擎 | 结果按 totalScore DESC：78→rank1，65→rank2，45→rank3；suggestedRank 从1开始连续编号 |
| TC-S4-047 | 排产引擎/工人推荐 | P0 | 利用率<80% 的工人才被推荐 | 工人A：weekly_hours=28（利用率70%）；工人B：weekly_hours=36（利用率90%）| 1. 调用引擎 | 仅工人A出现在 suggestedWorkers；utilization="70%"；currentLoad="28.0" |
| TC-S4-048 | 排产引擎/工人推荐 | P0 | 最多推荐3名工人 | 5名工人利用率均<80% | 1. 调用引擎 | suggestedWorkers.length = 3（MAX_RECOMMENDED_WORKERS）；取 weekly_hours 最低的3名 |
| TC-S4-049 | 排产引擎/工人推荐 | P1 | 所有工人超负荷时返回空推荐列表 | 所有工人 weekly_hours>=32（利用率>=80%）| 1. 调用引擎 | suggestedWorkers = []；引擎不抛出异常 |
| TC-S4-050 | 排产引擎/空数据 | P0 | 无待排产工单返回空数组 | production_orders 中无 status=pending/confirmed/scheduled 记录 | 1. 调用引擎 | 返回 `[]`；不抛出异常 |
| TC-S4-051 | 排产引擎/安全 | P0 | 纯计算模块不写入生产工单表 | 已有测试数据 | 1. 记录调用前 production_orders 行数<br>2. 调用引擎<br>3. 再次查询 | production_orders 行数不变；引擎不调用任何 INSERT/UPDATE |
| TC-S4-052 | 排产引擎/边界 | P1 | 余裕工时精确在边界值 80 时得分为 0 | 工单交期=NOW+80小时 | 1. 调用引擎 | slackHours=80 → score=0.00（边界包含：slackHours >= 80 时 score=0）|

---

## 五、调度建议 API 测试

### 模块说明

测试目标：`schedule-suggestion.controller.ts`、`schedule-suggestion.service.ts`、`schedule-suggestion.routes.ts`

基础 URL：`/api/schedule-suggestions`

---

| 用例ID | 模块 | 优先级 | 标题 | 前置条件 | 测试步骤 | 期望结果 |
|---|---|---|---|---|---|---|
| TC-S4-053 | API/触发计算 | P0 | supervisor 成功触发计算 | 以 supervisor 角色登录获取 token | 1. `POST /api/schedule-suggestions/calculate` body: `{}` | HTTP 201；body: `{code:0, data:{batchId, batchNo, jobId}, message:'调度建议计算已触发，请通过 jobId 查询进度'}`；`batchNo` 格式为 `SCH-XXXXXXXX`；数据库 `schedule_suggestions` 新增一条 `status=pending` 记录 |
| TC-S4-054 | API/触发计算 | P0 | boss 角色可触发计算 | 以 boss 角色登录 | 1. `POST /api/schedule-suggestions/calculate` | HTTP 201；与 TC-S4-053 相同 |
| TC-S4-055 | API/触发计算 | P0 | purchase 角色无权触发计算 | 以 purchase 角色登录 | 1. `POST /api/schedule-suggestions/calculate` | HTTP 403；body: `{code:403, message:*权限*}` |
| TC-S4-056 | API/触发计算 | P0 | 未登录用户无权触发计算 | 无 JWT Token | 1. `POST /api/schedule-suggestions/calculate` | HTTP 401 |
| TC-S4-057 | API/触发计算 | P1 | triggerType 参数校验 | supervisor 登录 | 1. `POST /api/schedule-suggestions/calculate` body: `{triggerType: "invalid"}` | HTTP 422/400；Zod 校验错误；message 含 enum 说明 |
| TC-S4-058 | API/状态查询 | P0 | 携带 jobId 查询计算状态 | 已触发计算（有 jobId）；Redis 可用 | 1. `GET /api/schedule-suggestions/status?jobId={jobId}` | HTTP 200；body 含 `batch`（batch_no/status 等字段）和 `jobState`（waiting/active/completed）|
| TC-S4-059 | API/状态查询 | P0 | 不携带 jobId 返回最近一条批次 | 已有批次记录 | 1. `GET /api/schedule-suggestions/status` | HTTP 200；返回最近一条批次的状态；jobState 可能为 null（Redis 不可用时）|
| TC-S4-060 | API/状态查询 | P0 | 无任何批次记录时返回 null | 数据库无 schedule_suggestions 记录 | 1. `GET /api/schedule-suggestions/status` | HTTP 200；body: `{data:{batch:null, jobState:null}}`；不抛 500 |
| TC-S4-061 | API/状态查询 | P1 | purchase 角色可查询状态 | purchase 角色登录 | 1. `GET /api/schedule-suggestions/status` | HTTP 200（purchase 角色有权限查询）|
| TC-S4-062 | API/最新结果 | P0 | supervisor 获取最新完成批次（含全量明细）| 已有 completed 批次，含采购和排产明细 | 1. `GET /api/schedule-suggestions/latest` | HTTP 200；body.data.batch.status='completed'；items 包含 item_type='purchase' 和 item_type='production' 的明细；明细按 suggested_rank ASC, id ASC 排序 |
| TC-S4-063 | API/最新结果 | P0 | purchase 角色仅见采购建议明细 | purchase 角色登录；completed 批次含两类明细 | 1. `GET /api/schedule-suggestions/latest` | HTTP 200；items 中仅有 `item_type='purchase'` 的记录；无 `item_type='production'` 记录 |
| TC-S4-064 | API/最新结果 | P0 | 无已完成批次时返回空结果 | 无 status=completed 的批次 | 1. `GET /api/schedule-suggestions/latest` | HTTP 200；body.data: `{batch: null, items: []}` |
| TC-S4-065 | API/历史记录 | P0 | 历史批次分页查询 | 已有 5 条批次记录 | 1. `GET /api/schedule-suggestions/history?page=1&pageSize=3` | HTTP 200；data.list.length=3；data.total=5；data.page=1；data.pageSize=3 |
| TC-S4-066 | API/历史记录 | P0 | 历史记录按 created_at 降序排列 | 多条批次 | 1. `GET /api/schedule-suggestions/history` | 返回结果中 created_at 降序排列 |
| TC-S4-067 | API/历史详情 | P0 | 获取指定批次详情（含明细）| 已有 id=5 的 completed 批次 | 1. `GET /api/schedule-suggestions/5` | HTTP 200；batch.id=5；items 非空；明细 JOIN 关联 sku_code、sku_name、supplier_name |
| TC-S4-068 | API/历史详情 | P0 | 查询不存在的批次 ID | 无 id=99999 的批次 | 1. `GET /api/schedule-suggestions/99999` | HTTP 404；code=404；message 含"不存在" |
| TC-S4-069 | API/历史详情 | P0 | 批次 ID 参数类型校验 | 任意 | 1. `GET /api/schedule-suggestions/abc` | HTTP 422/400；Zod 校验错误；message 含"正整数" |
| TC-S4-070 | API/接受建议 | P0 | 接受 pending 状态建议（不修改数量）| 存在 status=pending 的明细 itemId=10 | 1. `POST /api/schedule-suggestions/items/10/accept` body: `{}` | HTTP 200；message='建议已接受'；数据库 item status='accepted'；suggestion_audit_logs 新增 action='accept' 记录 |
| TC-S4-071 | API/接受建议 | P0 | 接受并修改数量 | 存在 status=pending 的明细 itemId=10 | 1. `POST /api/schedule-suggestions/items/10/accept` body: `{modifiedQty:"150.0000"}` | HTTP 200；message='建议已修改并接受'；数据库 item status='modified'，suggested_qty='150.0000'；audit_log action='modify'，old_value 含原始 qty，new_value 含新 qty |
| TC-S4-072 | API/接受建议 | P0 | 修改数量格式校验：超过4位小数 | 任意 pending 明细 | 1. `POST .../accept` body: `{modifiedQty:"100.12345"}` | HTTP 400/422；message 含"最多4位小数" |
| TC-S4-073 | API/接受建议 | P0 | 重复接受已接受的建议 | itemId=10 已为 status=accepted | 1. `POST .../accept` | HTTP 400；message 含"不允许重复操作" |
| TC-S4-074 | API/接受建议 | P0 | 接受不存在的明细 ID | 无 id=99999 的明细 | 1. `POST /api/schedule-suggestions/items/99999/accept` | HTTP 404 |
| TC-S4-075 | API/驳回建议 | P0 | 正常驳回 pending 建议 | 存在 status=pending 的明细 itemId=20 | 1. `POST /api/schedule-suggestions/items/20/reject` body: `{reason:"当前资金不足"}` | HTTP 200；message='建议已驳回'；status='rejected'；audit_log action='reject'，reason="当前资金不足" |
| TC-S4-076 | API/驳回建议 | P0 | 驳回时 reason 为空 | 任意 pending 明细 | 1. `POST .../reject` body: `{reason:""}` | HTTP 400/422；Zod 校验错误；message 含"不能为空" |
| TC-S4-077 | API/驳回建议 | P0 | 驳回时 reason 超过500字 | 任意 pending 明细 | 1. `POST .../reject` body: `{reason:"A".repeat(501)}` | HTTP 400/422；message 含"不超过500字" |
| TC-S4-078 | API/驳回建议 | P0 | 重复驳回已驳回建议 | itemId 已为 rejected | 1. `POST .../reject` | HTTP 400；message 含"不允许重复操作" |
| TC-S4-079 | API/应用排产 | P0 | 应用排产建议写入 priority_score | 存在 item_type=production 的 pending 明细，total_score=72.50，production_order_id=5 | 1. `POST /api/schedule-suggestions/items/{id}/apply` | HTTP 200；production_orders.priority_score=72.50（其中 id=5）；明细 status='accepted'；audit_log action='apply' |
| TC-S4-080 | API/应用排产 | P0 | 对采购建议明细调用 apply 接口 | item_type=purchase 的明细 | 1. `POST .../apply` | HTTP 400；message 含"不是排产建议" |
| TC-S4-081 | API/应用排产 | P0 | 仅 supervisor/boss 可应用排产 | purchase 角色登录 | 1. `POST .../apply` | HTTP 403 |
| TC-S4-082 | API/计算步骤 | P0 | 获取采购建议计算步骤 | 存在 item_type=purchase 的明细，calc_steps 已写入 | 1. `GET /api/schedule-suggestions/purchase-steps/{id}` | HTTP 200；data.calcSteps 为长度=4 的数组；每步结构包含 stepNo/title/inputs/formula/result |
| TC-S4-083 | API/计算步骤 | P0 | 获取排产建议明细的计算步骤接口返回 404 | item_type=production 的明细 id | 1. `GET /api/schedule-suggestions/purchase-steps/{productionItemId}` | HTTP 404；message 含"不存在"（SQL 中 WHERE item_type='purchase' 过滤）|
| TC-S4-084 | API/多租户隔离 | P0 | 租户A无法访问租户B的批次 | 租户A登录；存在租户B的批次 id=999 | 1. 租户A访问 `GET /api/schedule-suggestions/999` | HTTP 404（tenant_id 隔离，租户A查不到租户B数据）|
| TC-S4-085 | API/多租户隔离 | P0 | 接受/驳回操作租户隔离 | 租户A登录；存在租户B的明细 itemId=888 | 1. 租户A调用 `POST .../888/accept` | HTTP 404（WHERE tenant_id 过滤）|

---

## 六、采购建议强制校验测试

### 模块说明

测试目标：`services/api/src/modules/purchase/purchase-suggestion.service.ts`
核心逻辑：`batchCreatePOFromSuggestions()` 中的 BE-S4-16 强制审批校验

---

| 用例ID | 模块 | 优先级 | 标题 | 前置条件 | 测试步骤 | 期望结果 |
|---|---|---|---|---|---|---|
| TC-S4-086 | 强制校验/旁路拦截 | P0 | source=ai_schedule 且未审批时禁止转 PO（场景E）| purchase_suggestions 中存在 source='ai_schedule'，approved_by=null，status='approved' 的建议 | 1. 以任意合法角色直接调用批量转单 API<br>2. body: `{suggestionIds: [未审批ai_schedule建议ID]}` | HTTP 403；message 含"尚未经过人工审批，禁止直接转单"；message 含具体建议 ID；数据库无新 purchase_orders 记录 |
| TC-S4-087 | 强制校验/正常流程 | P0 | source=ai_schedule 经人工审批后允许转 PO | 建议 approved_by=用户ID（非null），status='approved' | 1. 调用批量转单 API | HTTP 200；生成新 PO；建议 status 更新为 'executed' |
| TC-S4-088 | 强制校验/正常流程 | P0 | source=mrp 的建议不受强制审批限制 | purchase_suggestions source='mrp'，approved_by=null，status='approved' | 1. 调用批量转单 API | HTTP 200；正常生成 PO（强制审批仅针对 source='ai_schedule'）|
| TC-S4-089 | 强制校验/混合场景 | P0 | 混合 ID 列表中含未审批 ai_schedule 建议时整批拒绝 | 同时传入：已审批 mrp 建议 + 未审批 ai_schedule 建议 | 1. 调用批量转单 API，body: `{suggestionIds: [mrpId, unapprovedAiId]}` | HTTP 403；整批请求被拒绝；数据库无新 PO；message 列出未审批的 ai_schedule 建议 ID |
| TC-S4-090 | 强制校验/状态校验 | P0 | 状态非 approved 的建议无法转 PO | source='mrp'，status='pending' | 1. 调用批量转单 API | HTTP 400；message 含"未处于审批通过状态" |
| TC-S4-091 | 强制校验/无供应商 | P0 | 无供应商的建议无法转 PO | suggested_supplier_id=null | 1. 调用批量转单 API | HTTP 400；message 含"未指定供应商，无法转单" |
| TC-S4-092 | 强制校验/空列表 | P0 | 空 suggestionIds 时返回错误 | 任意 | 1. 调用批量转单 API，body: `{suggestionIds: []}` | HTTP 400；message 含"至少选择一条" |
| TC-S4-093 | 强制校验/事务完整性 | P0 | 多供应商分组转单时 PO 事务原子性 | 3条建议：供应商A×2，供应商B×1；供应商B建议缺失字段导致 INSERT 失败 | 1. 调用批量转单 API | 整个事务回滚；数据库无新 PO；无孤立 purchase_order_items |
| TC-S4-094 | 强制校验/审批操作 | P0 | approveSuggestion 正常审批流程 | 存在 status=pending 的建议 | 1. 调用 `approveSuggestion(id)` | status='approved'；approved_by=操作用户 ID；approved_at 不为 null |
| TC-S4-095 | 强制校验/审批操作 | P0 | 重复审批已审批建议返回错误 | status='approved' 的建议 | 1. 调用 `approveSuggestion(id)` | HTTP 400；message 含"不允许审批操作" |
| TC-S4-096 | 强制校验/SQL注入 | P0 | suggestionIds 数组参数化防注入 | 传入非数字 ID | 1. body: `{suggestionIds: ["1; DROP TABLE purchase_orders --"]}` | 类型校验拦截（number[]）；不执行危险 SQL；不影响数据库 |

---

## 七、前端智能调度看板测试

### 模块说明

测试目标：`ScheduleSuggestionPage.tsx`、`useScheduleSuggestion.ts`
当前状态：页面使用静态 mock 数据，hooks 为未对接状态（待联调）

---

| 用例ID | 模块 | 优先级 | 标题 | 前置条件 | 测试步骤 | 期望结果 |
|---|---|---|---|---|---|---|
| TC-S4-097 | 前端/页面渲染 | P0 | 页面正常加载显示顶部统计卡片 | 浏览器打开调度建议页 | 1. 导航至 `/schedule/suggestions`<br>2. 检查 DOM 结构 | 页面渲染 4 个 ScheduleStatCard；标题显示"智能调度建议"；面包屑为"智能调度 / 调度建议" |
| TC-S4-098 | 前端/页面渲染 | P0 | 采购建议面板与排产建议面板均可见 | 同上 | 1. 检查左右分栏 | 左60% 区域显示"采购建议"面板（含列表）；右40% 区域显示"排产建议"面板（含列表）；面板有 `aria-labelledby` 无障碍标签 |
| TC-S4-099 | 前端/历史Tab | P0 | 历史记录 Tab 切换功能 | 页面已加载 | 1. 点击"采购历史"Tab<br>2. 点击"排产历史"Tab | 切换后对应 tabpanel 显示（`hidden` 属性变化）；Tab 按钮 `aria-selected` 属性正确切换；两个面板内容不同时可见 |
| TC-S4-100 | 前端/UI状态/冷启动 | P0 | 状态1 冷启动：无数据时显示空态 | API 返回 `{batch:null, items:[]}` | 1. 模拟 `useLatestSuggestion` 返回空<br>2. 检查页面内容 | 显示冷启动横幅（提示"系统尚无调度建议数据"或类似文案）；采购建议和排产建议区域显示空态占位符；无报错 |
| TC-S4-101 | 前端/UI状态/计算中 | P0 | 状态2 计算中：显示 loading 指示器 | `useCalculationStatus` 返回 status='active' | 1. 触发计算后进入轮询<br>2. 模拟 status=active | 页面显示"计算中"状态指示（loading spinner 或进度文本）；批准/驳回按钮不可操作或 disabled |
| TC-S4-102 | 前端/UI状态/计算完成 | P0 | 状态3 计算完成：建议列表展示 | `useLatestSuggestion` 返回有效 items | 1. 模拟完成状态数据<br>2. 检查列表渲染 | 采购建议列表显示 SKU 名称、建议数量、紧急程度标签；排产建议列表显示工单号、优先级、交期；"批准"/"驳回"按钮可点击 |
| TC-S4-103 | 前端/UI状态/计算失败 | P0 | 状态4 计算失败：显示错误提示 | batch.status='failed' | 1. 模拟计算失败状态 | 页面显示计算失败提示（含 error_message）；提供重新触发计算的操作入口；不显示过期的旧建议数据 |
| TC-S4-104 | 前端/UI状态/权限限制 | P0 | 状态5 purchase 角色仅见采购建议区 | purchase 角色登录 | 1. 以 purchase 角色访问页面 | 页面不显示排产建议面板或该区域为空；触发计算按钮不可见（purchase 无触发权限）|
| TC-S4-105 | 前端/批量操作 | P0 | 批准按钮触发 acceptItem mutation | 建议列表已加载 | 1. 点击某条采购建议的"批准"按钮<br>2. 观察网络请求 | 发送 `POST /api/schedule-suggestions/items/{id}/accept`；请求成功后列表刷新（invalidateQueries 触发）；该条建议状态变化 |
| TC-S4-106 | 前端/批量操作 | P0 | 驳回按钮打开确认弹窗并填写原因 | 建议列表已加载 | 1. 点击"驳回"按钮 | 弹出原因填写弹窗；reason 为空时禁止提交（前端校验）；确认后发送 `POST .../reject` |
| TC-S4-107 | 前端/计算步骤展示 | P0 | 点击建议条目展开计算步骤 | 完成状态的采购建议明细 | 1. 点击采购建议条目展开按钮<br>2. 等待 `purchase-steps` API 响应 | 显示 4 步计算过程（缺口计算/安全库存/资金评估/供应商推荐）；每步显示 inputs（输入参数）、formula（计算公式）、result（计算结果）；格式可读（非原始 JSON）|
| TC-S4-108 | 前端/轮询策略 | P0 | 计算完成后停止轮询 | jobId 已知；status 变为 completed | 1. 触发计算<br>2. 进入轮询<br>3. 等待 status=completed | `refetchInterval` 返回 `false`；网络请求停止轮询；页面不再发送 `/status` 请求 |
| TC-S4-109 | 前端/轮询策略 | P0 | 计算失败后停止轮询 | status 变为 failed | 1. 同上，但服务端返回 status=failed | `refetchInterval` 返回 `false`；轮询停止；显示失败状态 |
| TC-S4-110 | 前端/历史详情 | P1 | 点击历史批次查看快照详情 | 历史批次列表已加载 | 1. 点击某历史批次<br>2. 等待 `useBatchSnapshot` 响应 | 进入批次详情视图；显示该批次的明细列表（snapshot 数据）；明细状态（accepted/rejected）可见 |
| TC-S4-111 | 前端/无障碍 | P1 | Tab 组件 ARIA 属性正确 | 历史记录 Tab 已渲染 | 1. 检查 DOM 的 ARIA 属性 | Tab 按钮有 `role="tab"`、`aria-selected`、`aria-controls`；Tab 面板有 `role="tabpanel"`、`hidden` 属性；tablist 有 `aria-label` |
| TC-S4-112 | 前端/响应式 | P1 | 页面在移动端宽度下布局正常 | 模拟 375px 宽度 | 1. DevTools 切换到移动端视图<br>2. 访问调度建议页 | 左右分栏变为纵向堆叠；统计卡片换行；按钮可点击（大小 >= 44px touch target）；无横向滚动条 |

---

## 八、PRD 预定义场景测试

### 场景测试说明

以下测试用例直接对应 PRD 中定义的五种典型业务场景，是验收的核心依据。

---

| 用例ID | 模块 | 优先级 | 标题 | 前置条件 | 测试步骤 | 期望结果 |
|---|---|---|---|---|---|---|
| TC-S4-113 | 场景A/冷启动 | P0 | 全新系统：无库存无工单触发计算 | 清空数据：无 production_orders、无 inventory、无 purchase_suggestions、无历史批次 | 1. supervisor 触发 `POST /api/schedule-suggestions/calculate`<br>2. 等待计算完成<br>3. 查询 `GET /api/schedule-suggestions/latest` | 批次 status=completed；purchase_count=0；production_count=0；items=[]；前端显示"冷启动提示横幅"；页面采购/排产建议区显示空态 |
| TC-S4-114 | 场景B/标准缺料 | P0 | 标准缺料：建议采购量精确计算 | SKU-A：qty_on_hand=30，qty_reserved=0，qty_in_transit=20，order_demand=100，safety_stock=50；工单 status=pending，material_requirements.qty_shortage=50 | 1. 触发计算并等待完成<br>2. 查询 SKU-A 的采购建议明细 | shortageQty = MAX(0, 100-30-20) = 50.0000<br>safetyStockComplement = MAX(0, 50-30+50) = 70<br>suggestedQty = MAX(50, 70) = 70.0000<br>calcSteps[0].result.value = "50.0000"<br>calcSteps[1].result.value = "70.0000" |
| TC-S4-115 | 场景C/紧急交期 | P0 | 紧急交期：交期紧迫度精确计算 | 工单交期=NOW+16工时；无销售订单（expected_delivery=null，planned_end=NOW+16h）| 1. 触发计算并等待完成<br>2. 查询该工单排产建议 | slackHours=16；deadlineScore = MAX(0, 50-(16/80×50)) = 40.00；calcSteps[0].result.value = 40 |
| TC-S4-116 | 场景D/全齐料低优 | P0 | 全齐料 + 低优先级销售订单评分 | 所有物料库存充足（materialScore=20）；销售订单 priority=low（priorityScore=8）；工单无紧急交期 | 1. 触发计算并等待完成<br>2. 查询该工单排产建议 | materialScore = 20.00；priorityScore = 8.00；totalScore = deadlineScore + 8 + 20 |
| TC-S4-117 | 场景E/旁路防护 | P0 | API 旁路强制校验：未审批 ai_schedule 建议直接转 PO 被拒 | purchase_suggestions 中存在 source='ai_schedule'，approved_by=null，status='approved' | 1. 绕过前端，直接调用 `POST /api/purchase-suggestions/batch-to-po`<br>2. body: `{suggestionIds: [未审批ai_schedule建议ID]}` | HTTP 403；code=403；message 明确列出未审批建议 ID；数据库 purchase_orders 表无新记录；purchase_suggestions.status 未变化 |

---

## 九、性能与并发测试

---

| 用例ID | 模块 | 优先级 | 标题 | 前置条件 | 测试步骤 | 期望结果 |
|---|---|---|---|---|---|---|
| TC-S4-118 | 性能/计算时间 | P0 | 50 个缺料 SKU + 20 个待排产工单计算完成时间 | 构造50条缺料 SKU 数据，20条待排产工单 | 1. 触发计算<br>2. 记录 calc_started_at 至 calc_finished_at 时间差 | 计算完成时间 <= 30 秒；期间 API 服务无中断 |
| TC-S4-119 | 性能/计算时间 | P1 | 200 个缺料 SKU 计算时间上限 | 构造200条缺料 SKU | 1. 触发计算<br>2. 记录计算耗时 | 计算完成时间 <= 120 秒；内存占用无异常增长 |
| TC-S4-120 | 性能/并发触发 | P0 | 并发触发多次计算时串行处理不竞争 | Worker concurrency=1；Redis 可用 | 1. 在 2 秒内并发发送 5 个触发计算请求<br>2. 等待所有 Job 完成 | 5 个批次均创建成功；Worker 串行处理；calc_started_at 时间戳不重叠；无数据库锁错误 |
| TC-S4-121 | 性能/API响应 | P1 | 历史记录分页 API 响应时间 | 已有 100 条历史批次 | 1. `GET /api/schedule-suggestions/history?page=1&pageSize=20` | 响应时间 <= 500ms；SQL 使用索引（tenant_id, created_at） |
| TC-S4-122 | 性能/物料批量查询 | P1 | 批量查询物料就绪度时不产生 N+1 查询 | 20 个待排产工单 | 1. 开启 SQL 查询日志<br>2. 调用排产引擎计算 | `batchQueryMaterialReadiness` 使用 IN 批量查询；SQL 语句数量 = O(1)；无循环单次查询 |
| TC-S4-123 | 性能/状态轮询 | P1 | 前端轮询间隔 2 秒不过载服务端 | 模拟前端同时有 10 个并发用户轮询状态 | 1. 模拟10个用户同时轮询 `GET /status` 每 2 秒一次<br>2. 持续 60 秒 | 服务端 QPS <= 5（10用户/2s=5QPS）；API 响应时间 <= 200ms；无 503 |

---

## 十、测试用例汇总统计

### 10.1 用例数量

| 模块 | P0 | P1 | P2 | 合计 |
|---|---|---|---|---|
| BullMQ 消息队列 | 9 | 3 | 0 | 12 |
| 采购建议引擎 | 15 | 3 | 0 | 18 |
| 排产建议引擎 | 16 | 6 | 0 | 22 |
| 调度建议 API | 28 | 5 | 0 | 33 |
| 采购建议强制校验 | 11 | 0 | 0 | 11 |
| 前端智能调度看板 | 13 | 3 | 0 | 16 |
| PRD 预定义场景 | 5 | 0 | 0 | 5 |
| 性能与并发 | 2 | 4 | 0 | 6 |
| **合计** | **99** | **24** | **0** | **123** |

### 10.2 覆盖矩阵

| 覆盖维度 | 覆盖情况 | 相关用例 |
|---|---|---|
| 功能测试（正常流程）| 覆盖 | TC-S4-003,007,013,031,053,070,075,079,086,087 等 |
| 异常流程测试 | 覆盖 | TC-S4-009,016,017,020,024,055,068,072,073,074,076,077,078,080,090,092 等 |
| 边界测试 | 覆盖 | TC-S4-015,016,026,032,033,034,043,045,050,052,092,096 等 |
| 状态测试（五种 UI 状态）| 覆盖 | TC-S4-100~109 |
| 安全测试（权限/旁路/SQL注入）| 覆盖 | TC-S4-029,030,051,055,056,081,084,085,086,089,096,117 |
| 性能测试（并发/大数据量）| 覆盖 | TC-S4-118~123 |
| 数据一致性（多租户隔离）| 覆盖 | TC-S4-084,085 |
| 审计日志完整性 | 覆盖 | TC-S4-070,071,075,079,094 |

### 10.3 P0 测试通过标准（上线门控）

以下用例必须全部通过，否则禁止上线：

1. **TC-S4-005**：Redis 降级不中断业务
2. **TC-S4-007**：Worker 正常完成计算流程
3. **TC-S4-013/014**：场景B采购建议计算精确
4. **TC-S4-031**：场景C交期紧迫度精确
5. **TC-S4-053/055**：触发计算角色权限正确
6. **TC-S4-062/063**：purchase 角色数据隔离
7. **TC-S4-070/073**：接受建议状态机正确
8. **TC-S4-086**：场景E强制校验403拦截
9. **TC-S4-084/085**：多租户数据不越权
10. **TC-S4-113~117**：PRD 五种预定义场景全通过

### 10.4 已发现的潜在风险点（待确认）

以下问题在阅读代码后发现，需在测试时重点关注：

| 风险编号 | 描述 | 涉及文件 | 建议操作 |
|---|---|---|---|
| RISK-001 | `ScheduleSuggestionPage.tsx` 当前使用静态 mock 数据，`useScheduleSuggestion.ts` hooks 尚未与页面联调。TC-S4-100~112 中涉及 API 数据的测试用例需等待前后端联调完成后才可完整执行。 | ScheduleSuggestionPage.tsx | 标记为"待联调验证"；与 @senior-frontend-engineer 确认对接时间 |
| RISK-002 | `calcPriorityScore()` 优先判断 `order_type` 字段，当 `order_type` 为 'normal' 但 `priority` 数值为 90（实际为 urgent 级别）时，评分以 `order_type` 为准取 15 分而非 30 分。存在业务语义冲突风险。 | production-suggestion.engine.ts L242 | 与 @senior-ai-agent-pm 确认字段优先级规则 |
| RISK-003 | `rejectItem` 在 `writeAuditLog` 中将 reason 存入 audit_logs，但 `schedule_suggestion_items` 表未直接存储 reason 字段。若审计日志表缺失该字段，驳回原因将丢失。 | schedule-suggestion.service.ts L503-513 | 检查 `suggestion_audit_logs` 表结构，确认 reason 列存在 |
| RISK-004 | BullMQ Worker 降级场景下，`queueService.onFallback()` 同步执行回调，但 `executeCalculation` 为 async 函数，EventEmitter 不 await 异步 handler，可能导致计算流程被"fire and forget"。 | queue-service.ts L193-195 | 与 @senior-backend-engineer 确认降级路径的异步处理是否正确 |
| RISK-005 | `getHistory` 和 `getLatest` 均未对返回的 `calc_steps` JSON 进行解析，原始字符串透传给前端。若前端期望对象而非字符串，需确认是否需要服务层统一解析（`getPurchaseSteps` 中有解析逻辑，但 `getLatest/getHistory` 无）。 | schedule-suggestion.service.ts L294-329 | 与 @senior-frontend-engineer 确认前端期望数据格式 |

---

*文档生成时间：2026-03-14*
*文档状态：草稿（待评审）*
*下一步：提交 @senior-ai-agent-pm 和 @senior-frontend-engineer 评审 RISK-001/002/005*
