# [artifact:工程审批]

**文档类型**: Engineering Manager SDD Review — Remediation Plan
**审批编号**: EM-APPROVAL-2026-0313-001
**审批日期**: 2026-03-13
**审批人**: Engineering Manager
**被审批文档**:
- `docs/v2/v2-remediation-plan.md` v1.0.0
**参照 SDD**:
- `docs/v2/SDD-sprint1.md` v1.0.0
- `docs/v2/SDD-sprint1b-r07-r08.md` v1.0.0

---

## 审批结论

```
APPROVED_WITH_CONDITIONS
```

修复计划整体设计质量合格，架构方向正确，批次划分具备合理的业务依据，可进入编码阶段。但存在 **4 项必须在编码前解决的强制条件（Blocking Conditions）** 和 **5 项建议改进项（Advisory Items）**。所有 Blocking Conditions 必须由责任工程师在开始对应模块编码前完成澄清或补充设计，并报工程经理确认。

---

## 一、总体评估

### 1.1 审查维度评分

| 审查维度 | 评分 | 说明 |
|---------|------|------|
| 缺口覆盖完整性 | 4/5 | 9 个 P0 接口和 4 个 P1 问题均已识别并制定修复方案，但库存实时查询接口设计有遗漏 |
| 批次依赖合理性 | 5/5 | R-07 前置 R-08、R-06 依赖 R-05 taskId 接口、Batch 3 可并行，依赖链清晰 |
| 后端接口设计规范性 | 4/5 | 绝大部分接口与 SDD 契约一致，但 BE-08-01 的 draft/pending 混用问题需澄清 |
| 前端修复可执行性 | 4/5 | 所有修复项均有设计稿文件和交互规范引用，权限控制方式有待明确 |
| 验收标准可度量性 | 5/5 | AC 条目逐条可测试，验收通过率标准（P0: 100% / P1: 95% / P2: 80%）清晰可执行 |
| 非功能需求覆盖 | 4/5 | 错误处理、响应式、无障碍均已覆盖，但旧路由兼容期处理方案与现有技术栈存在兼容疑点 |

---

## 二、Blocking Conditions（必须解决，方可进入编码）

### BC-01 [后端 R-08] BE-08-01 状态约束与 SDD 矛盾

**问题描述**:

修复计划 BE-08-01 规定 `PUT /sales-orders/:id` 仅允许 `draft` / `pending` 状态的订单被编辑。但 SDD-sprint1b-r07-r08.md §4.4.6 明确规定：仅 `status=draft` 的订单可更新，`pending_approval` 状态的订单不支持编辑（订单在审批流中应冻结）。

两个文档的约束冲突，若按修复计划的 `draft/pending` 双状态实现，将产生一个严重安全漏洞：业务员可以在紧急插单进入审批阶段后（`pending_approval`）仍修改订单内容，导致 admin 审批的版本与最终执行版本不一致。

**要求**: 后端工程师必须在开始 BE-08-01 编码前，明确以下业务决策并更新修复计划：

选项 A（推荐）：严格遵循 SDD，仅允许 `draft` 状态编辑。`pending_approval` 状态需先调用 reject（回退到 draft）再编辑。

选项 B：`pending_approval` 状态允许编辑，但必须在 SDD 中补充说明，并增加审批人通知机制（订单内容变更时系统通知审批人重新审阅）。

**责任人**: @senior-backend-engineer
**解决截止**: Batch 1 后端编码开始前

---

### BC-02 [后端 R-08] BE-08-08 库存查询接口路径设计不完整

**问题描述**:

修复计划 §4.2.1 BE-08-08 定义了库存实时查询接口 `GET /sales-orders/inventory-check?skuId=xxx&qty=yyy`，但前端修复项 FE-08-05 使用的路径为 `GET /inventory-check`（省略了 `/sales-orders` 前缀）。两处路径不一致，将导致前后端联调失败。

此外，该接口挂载在 `/sales-orders` 路由下的语义存在疑问：库存查询本质上是 inventory 模块的能力，挂在 sales-orders 路由下违反了模块职责单一原则。

**要求**: 明确以下两点并在修复计划中统一路径引用：

1. 接口最终路径是 `/api/sales-orders/inventory-check` 还是 `/api/inventory/check` 或其他形式，前后端必须使用完全一致的路径。
2. 若挂载在 sales-orders 路由下，需说明为何不复用现有 inventory 模块的查询能力。

**责任人**: @senior-backend-engineer + @senior-frontend-engineer 联合确认
**解决截止**: Batch 1 后端编码开始前

---

### BC-03 [后端全局] P1 规范修正的旧路由兼容方案存在技术障碍

**问题描述**:

修复计划 §7.1 要求：`PUT→PATCH` 修正后，旧路由保留 30 天兼容期，返回 301 重定向，并在响应 Header 中添加 `Deprecation: true`。

这个方案存在两个问题：

1. **HTTP 语义错误**：301 是永久重定向，用于 GET 请求语义，对于 PUT/PATCH 变更使用 301 时，大多数 HTTP 客户端（包括 axios、fetch）会在重定向时将请求方法改为 GET，导致请求结构被破坏。正确做法应使用 308（Permanent Redirect）保持请求方法不变，但 Express 默认不支持 308，需要手动设置。

2. **Deprecation Header 规范**: `Deprecation: true` 不是标准 HTTP Header 值，标准写法应为 `Deprecation: {ISO8601日期}` 表示弃用日期，如 `Deprecation: 2026-04-13`，配合 `Sunset: {ISO8601日期}` 使用。

**要求**: 修复计划 §7.1 必须更新兼容方案，明确：

1. 使用 308 状态码（或明确说明放弃重定向方案，改为两套路由并行 30 天后废除旧路由）。
2. 标准化 Deprecation Header 格式。

**责任人**: @senior-backend-engineer
**解决截止**: Batch 2 后端编码开始前（Batch 2 包含 R-01 和 R-05 的 PUT→PATCH 修正）

---

### BC-04 [前端全局] 权限控制实现方式需明确技术约束

**问题描述**:

修复计划前端交付要求中规定："权限控制在组件渲染层实现（条件渲染），不依赖 CSS `display:none`"。这是正确的方向，但对以下两个具体场景缺乏实现规范：

1. **FE-05-03 工价权限绑定**：规定非 admin 角色工价列不在 DOM 中渲染（DevTools 检查不可见）。但如果当前角色信息由前端 context 持有，攻击者可以通过篡改 context 绕过前端渲染限制，直接调用 API 获取工价数据。修复计划未说明后端是否对 `wage-summary` 接口增加了 admin 权限校验。

2. **FE-08-01 订单详情操作按钮矩阵**：按钮渲染依赖状态+角色，但修复计划中未提供角色权限矩阵的完整定义（引用了"BD-003 负向测试"，但该矩阵文档未在修复计划中附录）。

**要求**:

1. 确认 `GET /process-configs/:templateId/wage-summary` 后端接口是否限制仅 admin 可访问，如是须在 BE-05-01 修复项中明确说明。
2. 提供 R-08 订单操作按钮的完整角色权限矩阵表（状态 × 角色 → 可用按钮），作为 FE-08-01 和 AC-08-08 的测试依据。

**责任人**: @senior-backend-engineer（确认 BE-05-01 权限） + @senior-frontend-engineer（提供操作矩阵）
**解决截止**: Batch 1 前端编码开始前（矩阵）；Batch 2 后端编码开始前（BE-05-01 权限）

---

## 三、Advisory Items（建议改进，不阻断编码，须在 QA 验收前完成）

### AI-01 [后端 R-07] 联系人删除最后一人的业务保护需在修复计划中显式覆盖

修复计划 BE-07-05 定义了联系人编辑接口，但没有明确说明删除联系人的保护逻辑（禁止删除最后一个联系人、禁止删除主联系人）。这个逻辑在 SDD-sprint1b §3.3.11 中有明确约束，但修复计划未将其列为独立的后端修复项，容易被遗漏实现。

建议：在后端交付 checklist 中明确 BE-07-05 的实现必须包含 SDD §3.3.11 中的两条业务约束，并在 QA 验收用例中增加对应的负向测试。

---

### AI-02 [后端 R-08] production_orders 表 ALTER 操作需要迁移脚本说明

修复计划引用了 SDD 中的 `ALTER TABLE production_orders ADD COLUMN sales_order_item_id`，SDD 也标注了 MySQL 8.0 不支持 `ADD COLUMN IF NOT EXISTS` 需要应用层迁移脚本处理。但修复计划中的任务分发章节（§九）未明确该迁移脚本由谁负责交付、何时执行。

建议：在 BE-08-06（触发建工单接口）中明确前置依赖：迁移脚本必须先于 BE-08-06 实现，由 @senior-backend-engineer 交付，并在 Batch 1 后端冒烟测试前执行。

---

### AI-03 [前端 R-08] FE-08-09 闪烁动画的无障碍降级与 AC-08 验收条目不对应

修复计划 FE-08-09 定义了紧急订单行闪烁动画和 `prefers-reduced-motion` 降级行为，这是正确设计。但 AC-08 验收条目（AC-08-01 ~ AC-08-10）中没有对应的验收标准条目覆盖该降级行为，QA 可能遗漏测试。

建议：在 R-08 验收标准中增加 AC-08-11：在 `prefers-reduced-motion: reduce` 环境下，紧急订单行无闪烁动画，显示静态红色标签，视觉识别度不降低。

---

### AI-04 [后端 R-05] wage-summary 接口的 Excel 导出（BE-05-04）文件命名格式需确认

修复计划 BE-05-04 定义文件名格式为 `工资核算_{from}_{to}.xlsx`，其中 `{from}` 和 `{to}` 来自查询参数。当用户未传入日期参数时（使用默认当月），后端需要有明确的 fallback 文件名生成逻辑，否则可能生成 `工资核算_undefined_undefined.xlsx` 的文件名。

建议：BE-05-04 实现说明中补充：日期参数缺省时，使用当月第一天和最后一天作为 from/to，文件名对应替换为月份范围，如 `工资核算_2026-03-01_2026-03-31.xlsx`。

---

### AI-05 [整体] Batch 3 与 Batch 2 的并行推进需要明确 API 依赖

修复计划 §六 规定 Batch 3（R-02、R-03）"无跨批次依赖，可在 Batch 2 进行中并行推进"，并标注"前端 UI 未还原（后端已有）"。这意味着 R-02 和 R-03 的后端接口在 Batch 1 开始前已可用，前端可直接联调。

建议：在里程碑表中增加一行：`Batch 3 前端联调可开始` 的进入条件明确标注为 `Batch 3 后端接口已验证可用（非 Batch 2 完成）`，避免前端工程师误解为需等待 Batch 2 通过才能启动 Batch 3 工作。

---

## 四、已确认通过的设计项

以下设计项经审查无重大问题，可直接进入编码：

### 4.1 批次划分逻辑

R-07 → R-08 的前置依赖关系正确（客户字段是订单创建的前提），Batch 1 优先于 Batch 2 的策略合理。R-06 依赖 R-05 的 `GET /production/tasks/:taskId` 接口，已体现在 Batch 2 内部的实现顺序中。

### 4.2 R-08 状态机设计

修复计划新增接口（confirm/ship/complete/close）与 SDD-sprint1b §4.3 状态流转矩阵完全吻合，关闭订单对非终态的覆盖范围（draft / pending_approval / confirmed / in_production / shipped）也与 SDD §4.4.13 一致。事务保障要求已在任务分发章节中明确。

### 4.3 PUT→PATCH 规范修正范围

BE-01-01（sku-categories）和 BE-05-02（process-config steps max-hours）的 PUT→PATCH 修正，与 SDD-sprint1.md §3.3.3 和 §6.x 的 PATCH 方法定义一致，修正方向正确。

### 4.4 R-07 客户停用保护逻辑

BE-07-01 停用时检查进行中订单的实现约束，与 SDD-sprint1b §3.3.7 的业务约束一致（检查 status IN ('draft','pending_approval','confirmed','in_production')）。前端 FE-07-03 内联确认流程设计也与交互规范对应。

### 4.5 验收标准设计质量

全部 45 条 AC 条目（AC-07 10条、AC-08 10条、AC-01 7条、AC-05 7条、AC-06 6条、AC-02 6条、AC-03 5条）均为可直接执行的测试步骤，验收通过率分层标准清晰（P0: 100% / P1: 95% / P2: 80%），QA 可执行性良好。

### 4.6 非功能需求设计

错误处理（10s 超时 + Toast + 重试）、指数退避重试（2s/4s/8s）、响应式最小宽度 1280px、focus trap、`prefers-reduced-motion` 降级均已覆盖，符合工程质量标准。

### 4.7 R-02/R-03 设计完整性

R-02 对比按钮 3 态设计（未选中/已加入/已满）、雷达图和折线图数据来源（复用已有后端绩效接口）、R-03 大文件进度条（>500KB 触发）和错误上限（>50 条切换状态）的阈值设计均有明确的可测试边界值。

---

## 五、编码授权范围

基于上述审查结果，授权如下：

| 批次 | 可授权开始 | 前提条件 |
|------|---------|---------|
| Batch 1 后端（BE-07-xx） | 立即可开始 | BE-07 全部项无阻断问题 |
| Batch 1 后端（BE-08-xx） | BC-01 和 BC-02 解决后 | 状态约束和库存接口路径需先澄清 |
| Batch 1 前端（FE-07-xx） | 立即可开始 | 等待 BE-07 接口可用后联调 |
| Batch 1 前端（FE-08-xx） | BC-04 操作矩阵补充后 | 需完整权限矩阵作为实现依据 |
| Batch 2 后端（BE-01/05/06） | Batch 1 QA 通过后，BC-03 解决后 | |
| Batch 2 前端（FE-01/05/06） | Batch 2 后端接口可用后 | |
| Batch 3 前端（FE-02/03） | 可与 Batch 2 并行，后端接口已就绪 | 无需等待 Batch 2 完成 |

---

## 六、审批摘要

```
审批结果: APPROVED_WITH_CONDITIONS

强制条件（Blocking Conditions）: 4 项
  BC-01: BE-08-01 编辑状态约束与 SDD 矛盾，需明确 draft-only 或 pending 可编辑+通知机制
  BC-02: 库存查询接口路径前后端不一致，需统一路径定义
  BC-03: 旧路由 301 重定向方案存在 HTTP 语义错误，需改为 308 或并行路由方案
  BC-04: 工价权限后端校验缺失确认，R-08 操作按钮权限矩阵未提供

建议改进（Advisory Items）: 5 项
  AI-01: 联系人删除保护逻辑需显式列入后端 checklist
  AI-02: production_orders 迁移脚本责任人和执行时机未明确
  AI-03: FE-08-09 无障碍降级缺少对应 AC 验收条目
  AI-04: wage-summary 导出文件名 fallback 逻辑缺失
  AI-05: Batch 3 并行启动条件描述不够清晰

整体评估: 修复计划设计质量合格，对审计缺口的覆盖完整，
          批次依赖关系合理，验收标准可执行性高。
          4 项 Blocking Conditions 解决后可全面进入编码阶段。
```

---

*工程审批文档版本*: 1.0.0
*审批日期*: 2026-03-13
*审批人*: Engineering Manager
*下一步*: 责任工程师在开始对应模块编码前，逐一解决 Blocking Conditions 并回报工程经理确认
