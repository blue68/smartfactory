# [artifact:UserStory] 智造管家 V2 — Sprint 3 用户故事详细文档

**文档版本**：v1.0
**创建日期**：2026-03-13
**负责人**：@senior-ai-agent-pm
**所属 Sprint**：Sprint 3（全链路贯通，第 6-8 周）
**关联 PRD**：docs/v2/PRD-v2-iteration-plan.md
**业务决策基准**：PRD 第十章「业务决策确认记录」（BD-001、BD-004 为本 Sprint 核心约束）
**前置依赖**：Sprint 2 全部完成（R-04 BOM版本化、R-07 客户管理、R-08 销售订单均已就绪）

---

## 目录

1. [需求对应关系](#需求对应关系)
2. [R-09：采购完整流程（质检+入库）](#r-09采购完整流程质检入库)
   - [US-S3-001 来料质检单创建与审核](#us-s3-001-来料质检单创建与审核)
   - [US-S3-002 质检合格触发自动入库](#us-s3-002-质检合格触发自动入库)
   - [US-S3-003 质检不合格退货处理（BD-004）](#us-s3-003-质检不合格退货处理bd-004)
   - [US-S3-004 部分到货与采购订单完结](#us-s3-004-部分到货与采购订单完结)
3. [R-10：销售→生产数据链路](#r-10销售生产数据链路)
   - [US-S3-005 销售订单确认触发生产工单创建](#us-s3-005-销售订单确认触发生产工单创建)
   - [US-S3-006 生产工单 BOM 展开与原材料需求计划（BD-001）](#us-s3-006-生产工单-bom-展开与原材料需求计划bd-001)
   - [US-S3-007 工序任务分配与排产](#us-s3-007-工序任务分配与排产)
   - [US-S3-008 工人报工（Web+小程序双端）](#us-s3-008-工人报工web小程序双端)
   - [US-S3-009 工序完工→半成品入库→下道工序解锁](#us-s3-009-工序完工半成品入库下道工序解锁)
   - [US-S3-010 成品完工与交付确认](#us-s3-010-成品完工与交付确认)
4. [R-11：采购数据链路（完整闭环）](#r-11采购数据链路完整闭环)
   - [US-S3-011 生产缺料检测与采购建议自动生成](#us-s3-011-生产缺料检测与采购建议自动生成)
   - [US-S3-012 采购建议审批与采购订单创建](#us-s3-012-采购建议审批与采购订单创建)
   - [US-S3-013 采购入库后库存更新与生产模块通知](#us-s3-013-采购入库后库存更新与生产模块通知)
5. [生产状态机设计说明](#生产状态机设计说明)
6. [Sprint 3 验收门禁检查表](#sprint-3-验收门禁检查表)
7. [任务分发汇总](#任务分发汇总)

---

## 需求对应关系

| 需求编号 | 需求名称 | 对应 User Story | 优先级 |
|---|---|---|---|
| R-09 | 采购完整流程（质检+入库） | US-S3-001 ~ US-S3-004 | P0 |
| R-10 | 销售→生产数据链路 | US-S3-005 ~ US-S3-010 | P0 |
| R-11 | 采购数据链路（完整闭环）| US-S3-011 ~ US-S3-013 | P0 |

**关键业务决策约束**：
- **BD-001**：生产工单创建时必须锁定 BOM 版本快照，工单执行期间 BOM 版本变更不影响已创建工单（影响 US-S3-006）
- **BD-004**：来料质检不合格不允许降级使用，只能退货，系统强制拦截不合格料入库（影响 US-S3-002、US-S3-003）

---

## R-09：采购完整流程（质检+入库）

---

### US-S3-001 来料质检单创建与审核

**优先级**：P0
**前置依赖**：采购订单（purchase_orders）已处于 confirmed 或 partial_received 状态；送货单（delivery_notes）已由供应商/仓管录入

```
As a 仓管员 / 质检员
I want 在供应商送货到厂后，依据送货单创建来料质检单，并填写质检结果
So that 每批来料都有完整的质检记录存档，确保不合格原材料不会流入生产环节
```

#### 背景说明

V1 已具备 delivery_notes、purchase_receipts、inspection_records 表结构基础，但缺少来料质检的完整业务流程。本 Story 在现有表结构上增加专门面向来料（采购到货）的质检单流程，与生产验货（production_orders 关联的 inspection_records）明确区分入库来源类型，防止库存溯源混乱。

来料质检单对应新增表 `incoming_inspection_records`（或在 inspection_records 基础上通过 `inspection_type` 枚举字段区分 INCOMING / PRODUCTION），具体由 tech-lead-architect 在架构设计中确认。

#### 验收条件

**AC-S3-001-01 质检单创建入口**
- 采购管理 > 到货管理页面，对状态为 pending 的送货单，仓管员可点击"创建质检单"按钮
- 创建质检单时，系统自动从送货单明细中带入：SKU信息、本次到货数量、采购订单号、供应商信息
- 质检单编号自动生成（格式：QC-YYYYMMDD-XXXX），不可手动修改

**AC-S3-001-02 质检单填写字段**

| 字段 | 必填 | 说明 |
|---|---|---|
| 质检日期 | 必填 | 默认当天，可修改 |
| 质检员 | 必填 | 从系统用户（质检员/仓管员角色）中选择 |
| 到货数量（复核） | 必填 | 从送货单带入，可修改实际清点数量 |
| 质检结果 | 必填 | 枚举：合格（qualified）/ 不合格（rejected），不提供"降级使用"选项（BD-004） |
| 不合格原因 | 条件必填 | 当质检结果为"不合格"时必填，枚举：尺寸偏差 / 材质不符 / 外观瑕疵 / 数量短少 / 其他 |
| 不合格详情 | 选填 | 文本，最大 500 字 |
| 附件图片 | 选填 | 最多 5 张，JPG/PNG，单张最大 5MB |
| 备注 | 选填 | 最大 200 字 |

**AC-S3-001-03 质检单保存与提交**
- 质检单支持"暂存"（draft 状态）和"提交审核"两种操作
- 暂存时不触发任何库存和采购订单状态变更
- 提交审核后，质检单状态变为 pending_review；若当前租户未启用质检审核流程，可配置为自动通过（直接进入 AC-S3-001-04 的审核通过逻辑）

**AC-S3-001-04 质检审核（主管/仓管主管）**
- 仓管主管（supervisor 角色）进入"待审核质检单"列表，可审核质检结果
- 审核操作：通过 / 驳回（须填写驳回原因）
- 驳回后质检单返回 draft 状态，质检员收到站内通知："质检单 {QC-XXX} 被驳回，原因：{驳回原因}"

**AC-S3-001-05 一个送货单支持多次质检**
- 当送货单包含多个 SKU 明细时，可以为每个 SKU 明细分别创建质检单
- 同一 SKU 明细，若分批质检（先质检一部分），支持多次创建质检单，每次填写本批质检数量；所有批次质检完成后，送货单状态才能完结

**AC-S3-001-06 质检单列表与查询**
- 采购管理 > 质检管理页面，展示所有质检单列表（字段：质检单号、关联采购订单号、SKU名称、到货数量、质检结果、状态、质检日期、质检员）
- 支持按质检结果（合格/不合格）、状态、日期范围、供应商筛选

#### 任务分发

- @senior-backend-engineer：来料质检单 API（POST /incoming-inspections，GET /incoming-inspections，PATCH /incoming-inspections/{id}/submit，PATCH /incoming-inspections/{id}/review）；质检单与送货单、采购订单的关联逻辑；审核驳回通知推送
- @senior-frontend-engineer：QCInspectionPage.tsx（质检单列表）、QCInspectionFormPage.tsx（质检单填写）、质检审核操作组件
- @senior-qa-engineer：验证不合格原因在结果为"不合格"时必填（BD-004）；验证一个送货单多SKU分批质检场景；验证驳回流程和通知推送

---

### US-S3-002 质检合格触发自动入库

**优先级**：P0
**前置依赖**：US-S3-001 质检单审核通过（结果为 qualified）

```
As a 仓管员
I want 质检结果审核通过后，系统自动生成入库单并更新库存数量
So that 合格来料能及时反映到库存中，生产备料时能看到真实可用库存，减少手工记账误差
```

#### 背景说明

基于 BD-004 约束，只有质检结果为 qualified 时才允许触发入库。入库事件需区分入库来源类型（PURCHASE_IN），在 inventory_transactions 表的 transaction_type 字段中明确标记，与生产半成品入库（PRODUCTION_IN）区分，确保库存溯源清晰。

#### 验收条件

**AC-S3-002-01 自动触发入库的条件**
- 来料质检单审核通过（状态变为 approved）且质检结果为 qualified 时，系统自动触发入库流程
- 入库触发是系统自动行为，不需要仓管员手动点击"入库"按钮（降低操作步骤，减少遗漏风险）
- 系统自动创建 purchase_receipts 入库单记录，关联对应的采购订单（po_id）和送货单（dn_id）

**AC-S3-002-02 库存数量更新**
- 入库后，对应 SKU 在 inventory 表的 qty_on_hand 增加入库数量
- 同步更新 inventory_balances 的 qty_available 字段
- 在 inventory_transactions 表写入一条流水记录，字段：
  - transaction_type = 'PURCHASE_IN'
  - direction = 'IN'
  - reference_type = 'purchase_receipt'
  - reference_id = 入库单ID
  - reference_no = 入库单号

**AC-S3-002-03 采购订单明细 qty_received 更新**
- 入库完成后，对应 purchase_order_items 的 qty_received 字段增加本次入库数量
- 若某明细的 qty_received = qty_ordered，该明细标记为"已全量到货"

**AC-S3-002-04 入库单查看**
- 入库单自动生成后，仓管员可在"采购管理 > 入库记录"页面查看
- 入库单字段：入库单号、采购订单号、SKU名称、入库数量、关联质检单号、入库时间、操作人（系统自动）
- 仓管员可手动补充备注（入库单创建后 24 小时内可追加备注）

**AC-S3-002-05 BD-004 强制拦截不合格料入库**
- 后端接口 POST /inventory/in（入库接口）：若 reference_type = 'purchase_receipt' 且关联质检单状态为 rejected，接口必须返回业务错误码 409，错误信息：「质检结果为不合格，不允许执行入库操作」
- 此拦截逻辑在后端强制执行，前端不提供"强制入库"的绕过选项（前端亦隐藏入库按钮，但后端是终审防线）

**AC-S3-002-06 入库通知**
- 入库完成后，系统向相关采购员推送站内通知：「采购订单 {PO-XXX} 的 {SKU名称} 已完成入库，入库数量：{X}，当前在库：{Y}」

#### 任务分发

- @senior-backend-engineer：质检审核通过事件监听（Event），自动触发入库事务（原子操作：创建 purchase_receipts + 更新 inventory + 更新 purchase_order_items + 写入 inventory_transactions）；BD-004 拦截逻辑必须在 POST /inventory/in 接口层实现
- @senior-frontend-engineer：入库记录列表页（ReceiptListPage.tsx 或在现有页面扩展）；库存查询页显示入库来源溯源信息
- @senior-qa-engineer：验证 qualified 质检单审核通过后库存自动增加正确数量；验证 rejected 质检单后端拦截入库（BD-004 核心场景）；验证 inventory_transactions 流水 transaction_type 字段为 PURCHASE_IN

---

### US-S3-003 质检不合格退货处理（BD-004）

**优先级**：P0
**前置依赖**：US-S3-001 质检单审核通过（结果为 rejected）

```
As a 采购员
I want 质检不合格的来料自动生成退货单，系统通知我跟进供应商补货
So that 不合格料能被及时退回供应商，不占用仓储空间，同时确保采购缺口有人跟进直至补货完成
```

#### 背景说明

BD-004 明确规定：来料质检结果为不合格时，只能执行退货处理，不允许降级使用。退货后采购订单的未入库数量保持不变，采购员需跟进供应商重新发货。本 Story 实现退货单自动创建和状态联动。

#### 验收条件

**AC-S3-003-01 退货单自动创建**
- 来料质检单审核通过且质检结果为 rejected 时，系统自动创建退货单（return_orders 表，若表不存在需新增）
- 退货单字段：退货单号（格式：RO-YYYYMMDD-XXXX）、关联采购订单号、关联质检单号、SKU信息、退货数量（= 本次质检数量）、退货原因（从质检单的不合格原因字段映射）、状态（初始：pending_return）
- 退货单创建后不需要人工干预即可展示在"采购管理 > 退货管理"列表中

**AC-S3-003-02 采购订单状态回滚**
- 退货事件触发后：
  - 对应 purchase_order_items 的 qty_received 不增加（因为本次未入库）
  - 若采购订单原处于 partial_received 状态，退货后订单状态回退为 partial_received（未变更）或 confirmed（视未入库数量判断）
  - 若本次到货数量 = 采购订单剩余未到货数量，则退货后采购订单重新进入 confirmed（等待供应商补发）状态

**AC-S3-003-03 通知采购员和供应商联系人**
- 退货单创建后，系统自动推送站内通知至对应采购员：「采购订单 {PO-XXX} 的 {SKU名称} 质检不合格，已自动创建退货单 {RO-XXX}，请联系供应商安排退货和补货」
- 若系统配置了供应商联系人邮件（扩展功能，V2 阶段仅站内通知，邮件通知延至 V3）

**AC-S3-003-04 退货单状态流转**
- 退货单状态机：pending_return（待退货）→ returning（退货中，仓管确认已交运）→ returned（已退回供应商确认）→ replaced（供应商已补货，关联新的入库单后自动关闭）
- 退货单各状态可手动推进（仓管员操作 pending_return → returning → returned；系统关联入库自动推进 → replaced）

**AC-S3-003-05 退货单与采购缺口追踪**
- 退货管理页面展示：退货单号、采购订单号、SKU名称、退货数量、退货原因、当前状态、创建时间、预计补货日期（可填）
- 采购员可在退货单上记录"与供应商沟通记录"（文本备注，支持多次追加，带时间戳）
- 当关联采购订单有新的到货入库（补货到位），退货单自动标记为 replaced 并关闭

**AC-S3-003-06 禁止降级使用（BD-004 强制）**
- 质检单结果字段枚举值仅有：qualified / rejected，数据库层面不存在"降级使用"选项
- 后端接口对 rejected 质检单的后续操作只暴露"生成退货单"，不暴露任何形式的"部分入库"或"接受"操作
- QA 须验证：直接通过 API 尝试对 rejected 质检单触发入库，系统返回 409 错误

#### 任务分发

- @senior-backend-engineer：return_orders 表设计与 CRUD 接口；rejected 质检单审核通过时的自动退货单创建事务；采购订单状态回滚逻辑；通知推送
- @senior-frontend-engineer：退货管理页面（ReturnOrderPage.tsx）；退货单详情及状态推进操作；沟通记录追加功能
- @senior-qa-engineer：验证 rejected 质检单触发退货单自动创建（含字段值正确性）；验证采购订单 qty_received 不增加；验证后端 API 拦截 rejected 入库（BD-004）；验证退货单状态机各节点流转

---

### US-S3-004 部分到货与采购订单完结

**优先级**：P0
**前置依赖**：US-S3-001 ~ US-S3-003

```
As a 采购员
I want 系统能处理供应商分批到货的场景，准确跟踪每次到货和质检情况，并在满足完结条件时关闭采购订单
So that 采购数据始终反映真实到货状态，老板能准确掌握资金支付节点和未结尾款
```

#### 背景说明

工厂采购场景中，供应商常见分批发货（如一次采购 100 米布料，分两批各 50 米到货）。V1 purchase_orders 已有 partial_received 状态和 purchase_order_items.qty_received 字段，本 Story 在此基础上补全完整的多次到货和订单完结业务逻辑。

#### 验收条件

**AC-S3-004-01 多次到货状态追踪**
- 每次供应商送货，仓管员创建新的送货单（delivery_notes）关联同一采购订单
- 每次送货后创建来料质检单，质检通过后触发入库（见 US-S3-002）
- purchase_orders 状态自动计算：
  - 所有明细 qty_received = 0：状态 confirmed（待到货）
  - 至少一个明细 qty_received > 0 但未全量：状态 partial_received（部分到货）
  - 所有明细 qty_received >= qty_ordered：状态 received（已全量到货）

**AC-S3-004-02 部分到货页面展示**
- 采购订单详情页，明细表格中每行展示：
  - 已到货数量（qty_received）/ 订单数量（qty_ordered）的进度条
  - 各次到货记录列表（可展开）：每次到货的送货单号、到货数量、质检结果、入库数量、到货日期

**AC-S3-004-03 采购订单手动关闭**
- 采购主管（supervisor 或 admin）可手动将任意状态的采购订单设为 cancelled（手动关闭）
- 手动关闭时须填写关闭原因（必填，最大 200 字）
- 已有入库记录的采购订单手动关闭后，历史入库记录保持不变，仅停止后续到货处理

**AC-S3-004-04 采购订单完结逻辑**
- 自动完结：所有明细 qty_received >= qty_ordered 时，系统自动将状态更新为 received，并向采购员推送通知："采购订单 {PO-XXX} 已全量到货并完结"
- 手动完结：部分到货情况下，采购主管可选择"确认完结"（同 cancelled，但记录尾款处理情况），完结后采购订单不再接受新的送货单关联

**AC-S3-004-05 尾单缺口追踪**
- 采购管理首页或报表中，展示"采购尾单追踪"视图：列出所有处于 partial_received 状态、超过预期到货日期（expected_date）的采购订单，标注缺口数量和超期天数
- 此视图帮助采购员识别需要催货的订单

#### 任务分发

- @senior-backend-engineer：采购订单状态自动计算服务（根据 qty_received 汇总触发状态更新）；手动完结接口 PATCH /purchase-orders/{id}/close；尾单追踪聚合查询接口
- @senior-frontend-engineer：采购订单详情页多次到货进度展示；采购尾单追踪视图
- @senior-qa-engineer：验证三种状态（confirmed / partial_received / received）的自动切换边界；验证手动关闭权限（仅 supervisor/admin）；验证超期尾单追踪数据准确性

---

## R-10：销售→生产数据链路

---

### US-S3-005 销售订单确认触发生产工单创建

**优先级**：P0
**前置依赖**：Sprint 2 销售订单（sales_orders）已就绪；R-04 BOM版本化已完成

```
As a 车间主管 / 生产计划员
I want 销售订单被确认后，系统自动创建对应的生产工单
So that 销售和生产之间的数据自动流转，不再依赖人工手动新建工单，消除订单漏排和数据不一致的问题
```

#### 背景说明

这是 R-10 链路的起点。sales_orders 表已有 status 枚举含 confirmed，production_orders 表已有 sales_order_id 外键关联。本 Story 实现"销售订单确认"事件触发"生产工单自动创建"的核心业务逻辑，并根据 BD-001 在创建时锁定当前激活 BOM 版本快照。

#### 验收条件

**AC-S3-005-01 销售订单确认操作**
- 销售订单状态为 pending_approval 时，admin 用户点击"确认订单"后，订单状态变为 confirmed
- 紧急插单（order_type = urgent）的确认需经 BD-003 约束（仅 admin 可确认），此场景由 Sprint 2 US-V2-008 覆盖，本 Story 聚焦普通订单确认链路

**AC-S3-005-02 生产工单自动创建**
- 销售订单状态变为 confirmed 后，系统为订单中的每个 SKU 明细自动创建一个生产工单
- 一个销售订单可能包含多个 SKU（多行明细），每个 SKU 创建一个独立生产工单
- 工单编号自动生成（格式：WO-YYYYMMDD-XXXX）
- 工单初始状态：pending（待排产）

**AC-S3-005-03 工单创建时字段赋值**

| 工单字段 | 赋值来源 |
|---|---|
| sales_order_id | 触发的销售订单 ID |
| sku_id | 销售订单明细的 SKU ID |
| qty_planned | 销售订单明细的 qty_ordered |
| bom_header_id | 当前时刻该 SKU 的激活 BOM 版本 ID（BD-001 快照，必填） |
| process_template_id | 该 SKU 对应的激活工序模板 ID |
| priority | 继承销售订单的 priority 字段值 |
| planned_end | 继承销售订单的 expected_delivery 日期 |
| status | pending |

**AC-S3-005-04 BD-001 快照校验**
- 工单创建时，若对应 SKU 没有激活的 BOM 版本（bom_headers 中该 sku_id 无 is_active=1 的记录），系统拒绝创建工单，返回业务错误：「SKU {sku_code} 无激活 BOM 版本，无法创建生产工单，请先在 BOM 管理中激活对应版本」
- 工单创建后，bom_header_id 字段不可修改（快照锁定），即使该 SKU 后续激活了新 BOM 版本，已有工单仍使用创建时锁定的版本
- 工单详情页明显展示"BOM版本：{version}"，让操作人员知晓当前工单使用的 BOM 版本

**AC-S3-005-05 无工序模板时的处理**
- 若对应 SKU 无激活工序模板，系统创建工单但标注"无工序模板"警告，工单进入 pending 状态后提示车间主管需手动配置工序模板后才能进行排产

**AC-S3-005-06 生产工单列表**
- 生产管理 > 工单管理页面展示所有工单列表（字段：工单号、关联销售订单号、产品名称/SKU、计划数量、已完成数量、状态、计划完工日、优先级）
- 支持按状态、SKU、日期范围、优先级筛选；紧急工单以红色标签高亮

#### 任务分发

- @senior-backend-engineer：销售订单 confirmed 事件监听，自动触发生产工单创建服务（WorkOrderService.createFromSalesOrder）；BD-001 激活 BOM 版本查询与快照写入；无激活版本时的错误返回
- @senior-frontend-engineer：ProductionOrderPage.tsx（生产工单列表）；工单详情页显示 BOM 版本信息；订单确认操作触发工单创建的状态反馈提示
- @senior-qa-engineer：验证销售订单确认后工单自动创建（字段值与 AC-S3-005-03 对齐）；验证 BD-001 无激活 BOM 版本时拒绝创建；验证多 SKU 订单创建多个工单的场景

---

### US-S3-006 生产工单 BOM 展开与原材料需求计划（BD-001）

**优先级**：P0
**前置依赖**：US-S3-005 生产工单已创建；R-04 BOM通用件+版本化已完成

```
As a 车间主管 / 生产计划员
I want 生产工单创建后，系统基于锁定的 BOM 版本展开原材料需求清单
So that 生产备料前能清楚知道哪些原材料需要多少数量，提前安排领料或触发采购，避免开工后才发现缺料
```

#### 背景说明

BD-001 规定：BOM展开计算必须以工单关联的 bom_header_id 版本快照为准，不得动态取当前激活版本。这与 Sprint 2 采购建议引擎（总是使用激活版本）有所区别——生产工单走快照，采购建议走激活版本，两条逻辑并行但独立。

#### 验收条件

**AC-S3-006-01 BOM 展开触发时机**
- 生产工单创建成功后（status = pending），系统自动执行 BOM 展开计算，生成该工单的原材料需求明细
- 展开结果存储在生产工单关联的物料需求表中（新增 production_material_requirements 表，或复用已有数据结构）
- BOM 展开使用工单的 bom_header_id 字段对应的版本，不使用当前激活版本（BD-001 核心约束）

**AC-S3-006-02 BOM 展开规则**
- 多层 BOM 展开（最多 10 层），将所有原材料（非半成品叶节点）展平为一个需求列表
- 通用件（被多个成品引用的半成品）按引用数量展开，不重复创建独立物料需求记录
- 展开数量公式：原材料需求量 = qty_planned × bom_items.quantity × (1 + bom_items.scrap_rate)
- 计算结果保留 4 位小数，最终取整策略：向上取整（生产宁可多备料）

**AC-S3-006-03 原材料需求明细展示**
- 工单详情页新增"物料需求"Tab，展示展开后的原材料需求明细：
  - SKU编码、SKU名称、需求数量、单位、当前库存（qty_on_hand - qty_reserved）、可用缺口（需求量 - 可用库存，负值表示有缺口）
  - 有库存缺口的物料行标红高亮，并显示"缺料"标签
- 点击"刷新库存"按钮可重新查询最新库存数量（BOM展开数量不重新计算，仅更新库存对比数据）

**AC-S3-006-04 BOM 版本变更不影响已有工单**
- 场景测试（QA 必须覆盖）：工单 A 创建于 BOM v1.0 激活时期 → 之后 BOM v2.0 被激活 → 工单 A 的物料需求明细仍按 BOM v1.0 展开结果展示，不发生变化
- 工单详情页顶部醒目展示：「本工单使用 BOM 版本：v{X.X}（创建时锁定）」

**AC-S3-006-05 BOM 展开性能**
- 对于不超过 10 层的 BOM，展开计算响应时间 < 3 秒（PRD 非功能需求要求）
- 若 BOM 层数超过 10 层，系统返回警告并拒绝展开，提示配置人员检查 BOM 结构

#### 任务分发

- @senior-backend-engineer：BOM 展开计算引擎（生产工单版，基于 bom_header_id 版本快照，非激活版本）；production_material_requirements 表设计与写入；库存缺口计算逻辑；性能优化（最多 10 层递归）
- @senior-frontend-engineer：工单详情页"物料需求"Tab，含缺口高亮和库存刷新功能
- @senior-qa-engineer：BD-001 版本快照回归测试（工单执行期间 BOM 版本变更，工单计算结果不变）；多层 BOM 展开正确性；性能测试（3 秒以内）；10层超出限制的错误处理

---

### US-S3-007 工序任务分配与排产

**优先级**：P0
**前置依赖**：US-S3-005 工单创建完成（status = pending）；process_templates 已配置工序步骤

```
As a 车间主管
I want 对待排产的生产工单分配工序任务（指定工人、排产日期、计划数量），生成可执行的任务列表
So that 每个工人都清楚自己每天的工作安排，生产进度得到系统化追踪
```

#### 背景说明

production_orders、production_schedules、production_tasks 三表已有完整结构，但 V1 仅实现了任务的查看和报工，未实现"排产"这一工序任务分配流程。本 Story 补全车间主管的排产操作，将工单从 pending 状态推进至 scheduled / in_progress 状态。

#### 验收条件

**AC-S3-007-01 排产操作入口**
- 工单列表中，状态为 pending 的工单操作栏提供"开始排产"按钮
- 点击后进入排产页面，展示该工单的工序步骤列表（来自关联的 process_template_id）

**AC-S3-007-02 工序任务分配**
- 对每道工序步骤，车间主管可填写：
  - 计划排产日期
  - 指定工人（从在职工人列表中选择，支持多人分工，多人时需填写各人计划数量）
  - 计划数量（默认为工单计划数量，可调整）
- 分配完成后，系统创建对应的 production_schedules 记录和 production_tasks 记录

**AC-S3-007-03 工单状态流转**
- 工单所有工序步骤均完成分配后，工单状态变为 scheduled（已排产）
- 至少一道工序已开始生产（有工人开始任务），工单状态变为 in_progress（生产中）

**AC-S3-007-04 排产冲突检测（轻量版）**
- 分配工人时，系统检测该工人在同一排产日期是否已有任务（查询 production_tasks 表）
- 若存在冲突（该工人当日已有任务），显示黄色警告提示："该工人 {姓名} 在 {日期} 已有 {X} 个任务，确认仍要分配？"（警告不阻断，由主管决定）

**AC-S3-007-05 工序前置关系**
- 若工序模板配置了工序顺序（step_no），系统按顺序展示工序步骤
- V2 阶段：前道工序未完工时，后道工序任务允许提前创建和分配，但在任务详情中标注"等待前置工序完成"；工序解锁逻辑在 US-S3-009 中实现

**AC-S3-007-06 排产看板**
- 生产管理 > 排产看板：以周视图或月视图展示所有工人的任务分配情况（甘特图风格）
- 可按工人、工序类型筛选；任务块颜色区分工单（不同工单颜色不同）
- 任务块上显示：任务状态、工单号、SKU名称、计划数量

#### 任务分发

- @senior-backend-engineer：排产接口 POST /production-schedules/batch（批量创建工序任务）；工单状态自动流转服务；工人冲突检测查询
- @senior-frontend-engineer：排产页面（SchedulingPage.tsx，含工序分配表单）；排产看板（ScheduleBoard.tsx，甘特图组件）
- @senior-qa-engineer：验证排产完成后工单状态从 pending 到 scheduled；验证工人冲突警告触发（不阻断）；验证排产看板数据正确性

---

### US-S3-008 工人报工（Web+小程序双端）

**优先级**：P0
**前置依赖**：US-S3-007 工序任务已分配给工人；Sprint 1 US-S1-009/010/011 Web端任务管理已完成

```
As a 生产工人
I want 在 Web 端或小程序端查看我的任务，开始任务、提交完工上报，并查看系统核算的工资
So that 无论在哪个端操作，我的生产产出都能及时记录，不遗漏，且数据在两端保持一致
```

#### 背景说明

Sprint 1 已完成 Web 端完工上报基础功能（US-S1-009/010/011），本 Story 在此基础上确保 Sprint 3 生产链路创建的任务能够在双端正确流转，并覆盖生产链路特有的场景（BOM版本快照只读展示、工序依赖状态感知）。

#### 验收条件

**AC-S3-008-01 任务列表显示工单上下文**
- 工人任务列表新增字段：所属工单号、产品名称、工序名称（step_name）、所属销售订单号（可选展示）
- 紧急订单的任务以红色"紧急"标签高亮

**AC-S3-008-02 任务详情显示 BOM 版本信息（只读）**
- 任务详情页的"物料信息"区块展示该工单锁定的 BOM 版本号和对应原材料明细（只读，不可修改）
- 工人可通过此信息了解本次生产需要使用哪些原材料规格

**AC-S3-008-03 任务状态流转（完整）**

| 当前状态 | 可执行操作 | 执行后状态 |
|---|---|---|
| pending（待开始） | 开始生产 | started（进行中） |
| started（进行中） | 完工上报 | completed（已完成） |
| started（进行中） | 异常上报 | exception（异常待处理） |
| exception | 主管标记处理完成 | started（恢复进行中） |
| exception | 主管挂起 | suspended（已挂起） |

**AC-S3-008-04 工序等待状态感知**
- 若当前任务所属工序依赖前置工序（上一道工序 step_no 更小），且前置工序未完工，任务详情页显示"等待前置工序（{step_name}）完成"提示横幅（橙色）
- 提示不阻断工人查看任务，但在工序完工触发半成品入库后（US-S3-009），此提示自动消失

**AC-S3-008-05 双端数据一致性（乐观锁）**
- 所有状态变更请求携带任务的 version 字段（production_tasks 表需增加 version 字段，初始值 1，每次更新 +1）
- 后端检测 version 冲突时返回 409，前端提示"任务已被更新，请刷新后重新操作"
- 双端（Web + 小程序）使用同一套后端接口，确保数据源唯一

**AC-S3-008-06 小程序端任务状态同步**
- 小程序端（此功能在 V1 有 HTML 原型，V2 Sprint 3 对应原生小程序开发）：下拉刷新任务列表时获取最新状态
- 完工上报、异常上报操作与 Web 端逻辑一致，共用同一套后端接口

#### 任务分发

- @senior-backend-engineer：production_tasks 表增加 version 字段；确认 PATCH /production-tasks/{id}/start、/complete、/exception 接口乐观锁正确实现；任务详情接口返回 BOM 版本和工序等待状态
- @senior-frontend-engineer：Web 端 TaskPage.tsx 扩展：增加工单上下文字段、BOM 版本只读展示、工序等待提示横幅
- @senior-qa-engineer：验证双端并发完工上报的乐观锁冲突处理（后者收到 409）；验证紧急任务红色标签；验证工序等待状态的展示和自动消失

---

### US-S3-009 工序完工→半成品入库→下道工序解锁

**优先级**：P0
**前置依赖**：US-S3-008 报工完成（工序任务状态为 completed）

```
As a 车间主管 / 仓管员
I want 某道工序的生产任务完工后，系统自动将半成品入库，并解锁下道工序任务（工人可以开始下道工序）
So that 半成品流转过程有完整记录，下道工序不会因遗漏通知而延误，全链路数据保持实时准确
```

#### 背景说明

工序完工产出的半成品入库需与来料采购入库明确区分：transaction_type 使用 PRODUCTION_IN（半成品工序产出）而非 PURCHASE_IN（采购到货）。工序完工→半成品入库→下道工序解锁是 R-10 链路中最复杂的中间环节，需设计原子事务保证数据一致性。

#### 验收条件

**AC-S3-009-01 工序完工确认**
- 工人提交完工上报（filled qty、actual hours）后，production_tasks 状态变为 completed
- 若当前工序是该工单的中间工序（非最终工序），触发"半成品入库"事件
- 若当前工序是最终工序，触发"成品入库"事件（成品完工，进入 US-S3-010 流程）

**AC-S3-009-02 中间工序半成品自动入库**
- 中间工序完工后，系统自动创建半成品入库流水：
  - inventory_transactions：transaction_type = 'PRODUCTION_IN'，direction = 'IN'，reference_type = 'production_task'，reference_id = 任务ID
  - 对应半成品 SKU 的 inventory.qty_on_hand 增加完工数量
- 半成品入库不需要人工确认，系统自动执行（降低操作复杂度）

**AC-S3-009-03 下道工序任务解锁**
- 中间工序半成品入库完成后，系统查询该工单的下一道工序任务（step_no + 1）
- 将下一道工序任务的状态从"等待前置工序（pending_prerequisite）"变为"待开始（pending）"
- 同时向该任务分配的工人推送站内通知："前置工序已完成，你的任务 {task_no} 可以开始了"

**AC-S3-009-04 工序完工的幂等性保护**
- 并发场景：多工人同时对同一任务提交完工上报时，后端通过 production_tasks.version 乐观锁确保只有一次完工被接受，其余返回 409
- 完工入库事务必须是原子操作：任务状态更新 + 库存更新 + 下道工序解锁在同一数据库事务中执行，任意步骤失败时全部回滚

**AC-S3-009-05 工单进度更新**
- 每次工序完工后，生产工单（production_orders）的 qty_completed 字段更新：以最终工序的已完工数量为准
- 工单详情页进度条实时展示：已完成件数 / 计划件数

**AC-S3-009-06 半成品与成品库存来源区分**
- 库存溯源视图中，可按 transaction_type 筛选查看：
  - PURCHASE_IN：来料采购入库
  - PRODUCTION_IN：工序半成品/成品产出入库
- 库存详情页的流水列表中，每条 PRODUCTION_IN 流水展示关联工单号和工序名称

#### 任务分发

- @senior-backend-engineer：工序完工事件处理服务（WorkflowEngine.onTaskCompleted）；半成品/成品入库事务；下道工序解锁通知；幂等性保护（乐观锁 + 数据库事务）
- @senior-frontend-engineer：工单详情页工序进度列表（显示各工序状态及解锁状态）；库存溯源筛选功能
- @senior-qa-engineer：验证并发完工上报幂等性（模拟两个工人同时完工，仅一次成功）；验证原子事务回滚（模拟库存更新失败时任务状态不变）；验证下道工序解锁通知到达

---

### US-S3-010 成品完工与交付确认

**优先级**：P0
**前置依赖**：US-S3-009 工单最终工序已完工；成品已入库

```
As a 仓管员 / 销售人员
I want 生产工单所有工序完工后进行交付确认，将成品出库并关联到对应销售订单
So that 老板能实时看到哪些销售订单已完成交付，资金结算有据可查，订单生命周期完整闭环
```

#### 背景说明

交付确认是销售→生产链路的最后一个节点，将生产工单与销售订单完成闭环关联。sales_orders 表有 qty_delivered 字段（在 sales_order_items 中），production_orders 有 qty_completed，通过此步骤完成两者的匹配和成品出库。

#### 验收条件

**AC-S3-010-01 工单完工确认**
- 当生产工单最终工序的 production_tasks 全部 completed，且 qty_completed = qty_planned 时，工单自动变为 completed 状态
- 若 qty_completed < qty_planned（存在报废或未完工数量），工单进入 partial_completed 状态，车间主管需手动确认是否接受欠量完工

**AC-S3-010-02 交付确认操作**
- 销售管理或生产管理页面，对状态为 completed 的生产工单，销售/仓管员可点击"交付确认"
- 交付确认表单字段：
  - 交付数量（必填，默认 = qty_completed，可调整但不超过 qty_completed）
  - 交付日期（必填，默认当天）
  - 物流单号（选填）
  - 备注（选填）

**AC-S3-010-03 交付后库存和订单状态更新**
- 交付确认提交后，系统原子执行：
  - 成品 SKU 的 inventory.qty_on_hand 减少交付数量
  - 写入 inventory_transactions（transaction_type = 'SALES_OUT'，direction = 'OUT'，reference_type = 'sales_order'，reference_id = 销售订单ID）
  - sales_order_items.qty_delivered 增加交付数量
  - 若 qty_delivered >= qty_ordered，该明细标记为已交付

**AC-S3-010-04 销售订单状态更新**
- 所有明细 qty_delivered >= qty_ordered 时，销售订单状态自动变为 shipped
- 若部分明细已交付但未全部完成，订单状态为 in_production（仍有未完工部分）或保持现有状态（视业务而定）

**AC-S3-010-05 交付确认页面（DeliveryConfirmPage.tsx）**
- 页面展示：
  - 销售订单基本信息（订单号、客户名称、期望交付日）
  - 生产工单明细（工单号、SKU名称、计划数量、已完成数量、可交付数量）
  - 交付历史记录（该销售订单历次交付记录）
- 提交后展示成功消息并刷新状态

**AC-S3-010-06 全链路状态追踪视图**
- 销售订单详情页新增"生产进度"区块，展示：关联工单号、工单状态、各工序完成情况（进度百分比）、预计完工日
- 老板（admin 角色）在首页 Dashboard 可看到"待交付工单"统计数量，点击跳转交付确认页

#### 任务分发

- @senior-backend-engineer：工单完工自动状态流转；交付确认接口 POST /delivery-confirmations（原子事务：出库 + 订单更新）；销售订单状态联动服务
- @senior-frontend-engineer：DeliveryConfirmPage.tsx（交付确认操作页）；销售订单详情页生产进度区块；Dashboard 待交付统计 Widget
- @senior-qa-engineer：验证交付确认后库存正确减少（SALES_OUT 流水）；验证销售订单 shipped 状态自动切换；验证部分交付场景下的状态和数量；验证全链路端到端（销售订单确认→工单创建→报工→完工→交付）

---

## R-11：采购数据链路（完整闭环）

---

### US-S3-011 生产缺料检测与采购建议自动生成

**优先级**：P0
**前置依赖**：US-S3-006 BOM展开与原材料需求计划已实现；purchase_suggestions 表已有完整结构

```
As a 采购员 / 工厂老板
I want 系统自动检测生产工单的原材料缺口，并生成采购建议
So that 不需要手动查库存、对 BOM 计算缺口，系统主动告知"需要采购什么、多少数量"，减少缺料停产风险
```

#### 背景说明

V1 已有 purchase_suggestions 表和采购建议引擎，但 V1 的建议生成基于全局库存和安全库存阈值，未与具体生产工单的 BOM 需求直接关联。R-11 要求在 R-10 链路打通后，建议生成逻辑升级为"生产工单缺料驱动"——以工单物料需求（US-S3-006 展开结果）为基准，对照当前可用库存计算真实缺口，触发精准采购建议。

#### 验收条件

**AC-S3-011-01 缺料检测触发时机**
- 触发时机（以下任一）：
  1. 生产工单创建时（BOM 展开完成后），系统自动执行缺料检测
  2. 工单状态变为 scheduled（已排产）时，重新执行缺料检测（确认备料状态）
  3. 采购员或主管在工单详情页手动点击"检测缺料"按钮

**AC-S3-011-02 缺料计算逻辑**
- 对工单的每种原材料，计算：
  - 需求量 = production_material_requirements 中该工单该 SKU 的需求数量
  - 可用库存 = inventory.qty_on_hand - inventory.qty_reserved
  - 在途数量 = inventory.qty_in_transit（已下采购订单但未入库的数量）
  - 净缺口 = 需求量 - 可用库存 - 在途数量
  - 若净缺口 > 0，则该物料存在缺口，需触发采购建议

**AC-S3-011-03 采购建议自动生成**
- 对有缺口的每种物料，系统自动在 purchase_suggestions 表创建建议记录：
  - shortage_qty = 净缺口数量
  - suggested_qty = max(净缺口, 安全库存阈值 - 当前库存)（建议采购量不低于补充至安全库存线）
  - suggested_supplier_id = 该 SKU 当前有效报价中价格最低的供应商（若有多家有效报价）
  - estimated_price = 推荐供应商的最新有效单价
  - reason = 自动生成文本：「生产工单 {WO-XXX} 需要 {需求量} {单位}，当前可用库存 {X}，在途 {Y}，缺口 {净缺口}」
  - confidence = 'high'（基于确定性计算）
  - status = pending

**AC-S3-011-04 避免重复建议**
- 若某 SKU 已有 pending 状态的采购建议（shortage_qty 覆盖当前缺口），不重复创建新建议
- 若现有 pending 建议的 suggested_qty < 新缺口量，更新现有建议的 suggested_qty 并添加备注说明变更原因

**AC-S3-011-05 缺料看板**
- 生产管理 > 缺料看板页面，展示所有有缺口的工单和对应物料信息：
  - 工单号、产品名称、缺料 SKU、需求量、可用库存、在途量、缺口量、是否已有采购建议
  - 按缺口严重程度排序（缺口越大、工单交期越近，优先级越高）
- 采购员可在缺料看板一键"创建采购建议"（若未自动创建），或"查看已有建议"

**AC-S3-011-06 缺料影响时间线**
- 工单详情页"物料需求"Tab 增加预警色：
  - 绿色：库存充足（可用库存 >= 需求量）
  - 黄色：依赖在途库存（可用库存不足但加上在途量可满足）
  - 红色：严重缺料（可用库存 + 在途 < 需求量）

#### 任务分发

- @senior-backend-engineer：缺料检测服务（MaterialShortageDetector），接收工单 ID，基于 production_material_requirements 和 inventory 计算净缺口；采购建议自动生成逻辑（防重复，更新已有建议）；缺料看板聚合查询接口
- @senior-frontend-engineer：缺料看板页面（ShortageBoard.tsx）；工单详情物料需求Tab增加预警色
- @senior-qa-engineer：验证在途数量纳入缺口计算（不过度采购）；验证重复建议防重逻辑；验证自动触发时机（工单创建、工单排产、手动触发）；验证建议 reason 字段文本正确

---

### US-S3-012 采购建议审批与采购订单创建

**优先级**：P0
**前置依赖**：US-S3-011 采购建议已生成；V1 采购建议审批流程已有基础实现

```
As a 工厂老板（admin）/ 采购主管
I want 在系统中审批采购建议，通过后直接生成采购订单
So that 采购决策有审批留痕，资金流出受控，采购订单能快速到位，不耽误生产
```

#### 背景说明

V1 已有 purchase_suggestions 的审批状态流转（pending → approved/rejected）和 purchase_orders 的创建功能。本 Story 打通"建议审批通过后自动或一键创建采购订单"的步骤，同时确保由生产缺料触发的建议（R-11）与 V1 的 AI 调度建议（R-12 预置）在审批流程上保持一致。

#### 验收条件

**AC-S3-012-01 采购建议列表（来源区分）**
- 采购管理 > 采购建议页面，列表新增"建议来源"字段，区分：
  - 生产缺料（source = production_shortage，R-11 触发）
  - AI 调度建议（source = ai_schedule，Sprint 4 R-12 触发）
  - 手动创建（source = manual）
- 支持按来源、状态、SKU、供应商筛选

**AC-S3-012-02 审批操作**
- admin 或 supervisor 角色点击"通过"审批：
  - purchase_suggestions.status 变为 approved
  - approved_by = 审批人 ID，approved_at = 当前时间
  - 触发采购订单创建（见 AC-S3-012-03）
- 点击"驳回"：status 变为 rejected，须填写 reject_reason（必填）
- 审批操作写入审计日志

**AC-S3-012-03 审批通过自动创建采购订单**
- 建议通过审批后，系统自动（或由采购员一键触发）创建采购订单：
  - supplier_id = purchase_suggestions.suggested_supplier_id
  - 采购明细：sku_id、qty_ordered = suggested_qty、unit_price = estimated_price
  - suggestion_id = 建议 ID（溯源关联）
  - status = confirmed（跳过 draft 直接确认，因为建议已经过审批）
- 若建议无推荐供应商（suggested_supplier_id 为 NULL），采购员需手动选择供应商后才能创建订单

**AC-S3-012-04 一批建议合并下单**
- 若多条采购建议针对同一供应商，采购员可选中多条建议，点击"合并创建采购订单"
- 合并后生成一张采购订单，含多个明细行（每条建议对应一个明细）
- 合并操作仅对 approved 状态的建议开放

**AC-S3-012-05 采购建议与生产工单关联追踪**
- 采购建议详情页展示：触发该建议的生产工单列表（一条建议可能由多个工单的缺口合并产生）
- 采购订单详情页展示：关联的采购建议编号和对应的生产工单
- 实现从生产工单 → 采购建议 → 采购订单 的完整追溯链路

#### 任务分发

- @senior-backend-engineer：采购建议来源字段扩展（source 字段）；审批通过后自动创建采购订单服务；多建议合并下单接口；溯源关联查询接口
- @senior-frontend-engineer：采购建议列表增加来源筛选；审批操作UI；合并下单功能；溯源追踪链路展示
- @senior-qa-engineer：验证审批通过后采购订单自动创建（字段值正确）；验证多建议合并下单（多明细行）；验证审批日志记录；验证无推荐供应商时的手动选择流程

---

### US-S3-013 采购入库后库存更新与生产模块通知

**优先级**：P0
**前置依赖**：US-S3-002（质检合格入库）；US-S3-011（缺料检测已运行）

```
As a 车间主管 / 生产计划员
I want 采购物料完成入库后，系统自动通知相关生产工单物料已到位，并更新工单的缺料状态
So that 物料到位后车间第一时间得知，可以立即安排备料和生产，减少因信息滞后导致的等待时间
```

#### 背景说明

R-11 的最后一公里：采购到货入库（US-S3-002 已完成）→ 库存数据更新 → 生产模块的缺料状态重新评估 → 通知相关工单和工人。这是采购链路与生产链路的汇合点，需要两个模块的联动事件处理。

#### 验收条件

**AC-S3-013-01 入库后触发缺料状态重评**
- 当 PURCHASE_IN 类型的库存流水写入后（即采购来料入库完成），系统异步触发缺料状态重新计算
- 重新计算范围：所有 status 为 pending 或 scheduled 的生产工单中，涉及该 SKU 的物料需求
- 重新计算逻辑与 US-S3-011 AC-S3-011-02 一致（可用库存 + 在途量 vs 需求量）

**AC-S3-013-02 缺料状态更新**
- 重评后，若某工单的某物料缺口已消除（可用库存 >= 需求量），更新该工单物料的预警状态为绿色
- 若缺口仍存在但有所减少，更新缺口数量显示
- 工单详情页"物料需求"Tab 的预警色实时反映最新库存状态

**AC-S3-013-03 通知相关工单和人员**
- 入库后，系统查询因该 SKU 缺料而处于"待备料"或"等待物料"状态的工单
- 向对应的车间主管推送站内通知：「SKU {sku_name} 已入库 {qty}，工单 {WO-XXX} 的物料缺口已满足，可安排生产」
- 若一次入库影响多个工单，合并为一条通知（列出所有受益工单）

**AC-S3-013-04 采购→库存→生产链路仪表板**
- Dashboard 新增"供应链状态"看板区块（或在现有 Dashboard 扩展），展示：
  - 待入库物料数（purchase_orders 状态为 confirmed/partial_received 的数量）
  - 当前有缺料的工单数
  - 本周已完成入库批次数
  - 本周采购建议待审批数

**AC-S3-013-05 完整链路端到端可追溯**
- 从一个具体物料 SKU 出发，在库存流水页面能追溯：
  - 该物料的采购订单（来自哪个供应商，何时下单）
  - 对应的质检单（质检结果、质检员）
  - 入库时间和数量
  - 消耗到哪些生产工单（通过 inventory_transactions.production_order_id 字段）

**AC-S3-013-06 异步处理性能要求**
- 缺料状态重评为异步操作（非同步阻塞），入库接口响应时间不受重评计算影响（< 200ms）
- 重评计算在后台任务队列中执行，完成后触发通知推送
- 若重评过程中发生错误，记录错误日志但不影响入库事务已提交的结果

#### 任务分发

- @senior-backend-engineer：入库事件监听（PURCHASE_IN 流水写入后发布域事件）；缺料状态重评异步任务；工单影响范围查询；通知推送服务；供应链状态聚合接口
- @senior-frontend-engineer：Dashboard 供应链状态看板区块；库存溯源详情页（来源+去向完整追踪）
- @senior-qa-engineer：验证入库后缺料状态异步更新（延迟不超过 30 秒）；验证多工单合并通知；验证库存溯源链路（从 SKU 追查到工单）；验证异步失败不影响入库事务

---

## 生产状态机设计说明

以下是 Sprint 3 全链路涉及的核心状态机，供 @tech-lead-architect 参考并输出正式 [artifact:架构设计] 文档。

### 销售订单状态机

```
draft（草稿）
  → pending_approval（待审批）    [销售人员提交]
  → confirmed（已确认）           [admin 审批通过，触发生产工单创建]
  → in_production（生产中）       [关联工单进入 in_progress]
  → completed（已完工）           [所有工单完工]
  → shipped（已发货）             [交付确认完成]
  → cancelled（已取消）           [任意状态均可取消，进行中工单须处理]
```

### 生产工单状态机

```
pending（待排产）
  → scheduled（已排产）           [所有工序任务分配完成]
  → in_progress（生产中）         [至少一个工序任务已 started]
  → completed（已完工）           [qty_completed = qty_planned]
  → partial_completed（欠量完工） [主管确认欠量接受]
  → cancelled（已取消）           [仅 pending 状态可直接取消，in_progress 只能异常中止]
```

**V2 阶段限制**：不支持工序回退（只允许前进状态流转）。

### 生产任务状态机

```
pending（待开始）
  → started（进行中）             [工人点击开始生产]
  → completed（已完成）           [工人提交完工上报]
  → exception（异常待处理）        [工人提交异常上报]
  → suspended（已挂起）           [主管挂起，不计入进度]

exception
  → started（恢复进行中）         [主管标记处理完成]
  → suspended（已挂起）           [主管挂起]
```

### 采购订单状态机

```
draft（草稿）
  → confirmed（已确认）           [采购员确认]
  → partial_received（部分到货）  [至少一个明细有入库记录]
  → received（已全量到货）        [所有明细 qty_received >= qty_ordered]
  → cancelled（已取消/关闭）      [主管手动关闭]
```

---

## Sprint 3 验收门禁检查表

以下所有项目须在 Sprint 3 结束前全部通过，方可进入 Sprint 4。

| 检查项 | 标准 | 负责方 |
|---|---|---|
| BD-001 快照机制 | 工单执行期间 BOM 版本变更，工单物料需求计算结果不变（必须有自动化回归测试覆盖）| @senior-qa-engineer |
| BD-004 质检拦截 | rejected 质检单触发后端入库接口返回 409，前端无"强制入库"选项；QA 正向测试（合格入库）和反向测试（不合格拦截）均须通过 | @senior-qa-engineer |
| 全链路 E2E 测试 | 完整执行：销售订单确认 → 生产工单创建 → BOM展开 → 工序排产 → 报工 → 完工 → 成品入库 → 交付确认，链路中无手动补录数据 | @senior-qa-engineer |
| 采购链路 E2E 测试 | 完整执行：生产缺料检测 → 采购建议生成 → 审批 → 采购订单 → 送货 → 质检 → 入库 → 库存更新 → 生产缺料消除通知 | @senior-qa-engineer |
| 库存来源区分 | PURCHASE_IN 和 PRODUCTION_IN 流水在 inventory_transactions 正确区分，溯源查询准确 | @senior-qa-engineer |
| 幂等性保护 | 并发完工上报场景（模拟双端同时提交），乐观锁 version 冲突保护生效，只有一次成功 | @senior-qa-engineer |
| 状态机完整性 | 生产工单、生产任务、采购订单的所有状态流转路径均有测试用例覆盖，无非法状态跳转 | @senior-qa-engineer |
| 性能要求 | BOM 展开（最多 10 层）< 3 秒；关键业务操作响应 < 2 秒；缺料状态重评异步完成 < 30 秒 | @senior-backend-engineer |
| Code Review | 所有代码通过 @code-reviewer 评审（架构合理、状态机逻辑无漏洞、事务原子性、测试覆盖率 ≥ 80%）| @code-reviewer |
| 安全审计 | 新增接口通过 @security-engineer SQL注入/XSS/权限越权扫描；生产任务状态变更接口确认工人只能操作自己的任务 | @security-engineer |
| 架构评审通过 | tech-lead-architect 输出生产状态机 [artifact:架构设计]，经 system-designer 评审通过，并有 [artifact:工程审批] APPROVED 才能进入编码 | @tech-lead-architect / @engineering-manager |

---

## 任务分发汇总

### @senior-ui-designer

Sprint 3 需设计以下原型（按优先级顺序）：

- [artifact:Prototype] 来料质检单页面（质检单创建表单、质检结果选择、不合格原因必填状态、BD-004 无降级选项的设计规范）— P0，Sprint 3 Week 1
- [artifact:Prototype] 采购入库记录页（入库单列表、溯源入口、来源类型标签）— P0，Sprint 3 Week 1
- [artifact:Prototype] 退货管理页面（退货单列表、状态流转操作、沟通记录时间线）— P0，Sprint 3 Week 1
- [artifact:Prototype] 生产工单管理页（工单列表含状态机颜色、工单详情页含BOM版本标注、物料需求Tab含预警色）— P0，Sprint 3 Week 1-2
- [artifact:Prototype] 排产操作页（工序步骤分配表单、工人选择、日期选择）+ 排产看板（甘特图周视图）— P0，Sprint 3 Week 2
- [artifact:Prototype] 缺料看板页（按缺口严重程度排序、预警色、一键创建建议入口）— P0，Sprint 3 Week 2
- [artifact:Prototype] 交付确认页（工单信息 + 交付表单 + 历史交付记录）— P0，Sprint 3 Week 2
- [artifact:Prototype] 供应链状态 Dashboard 区块（待入库、有缺料工单、本周入库、待审批建议统计卡片）— P1，Sprint 3 Week 3

### @senior-backend-engineer

Sprint 3 后端交付清单（按依赖顺序）：

**R-09 采购完整流程（Week 1-2）**：
1. 来料质检单 API（CRUD + 提交 + 审核），BD-004 拦截逻辑
2. return_orders 表设计 + 退货单自动创建事务
3. 质检通过入库事务（原子操作：purchase_receipts + inventory + inventory_transactions + purchase_order_items）
4. 采购订单状态自动计算服务（qty_received 聚合触发状态变更）
5. 尾单追踪聚合查询接口

**R-10 销售→生产链路（Week 1-3）**：
6. 生产工单创建服务（销售订单 confirmed 事件触发，BD-001 BOM版本快照）
7. BOM 展开计算引擎（工单版，基于快照版本，不使用当前激活版本）
8. production_material_requirements 表设计 + 写入
9. 排产接口（批量创建 production_schedules + production_tasks）
10. 工序任务状态机服务（start / complete / exception / suspend / resume）
11. 工序完工事件处理（半成品入库事务 + 下道工序解锁 + 幂等保护）
12. 交付确认接口（成品出库事务 + 销售订单状态联动）

**R-11 采购数据链路（Week 2-3）**：
13. 缺料检测服务（MaterialShortageDetector，基于工单物料需求 vs 可用库存）
14. 采购建议自动生成服务（防重复、更新已有建议逻辑）
15. 采购建议来源字段扩展 + 审批通过自动创建采购订单服务
16. 入库事件→缺料状态重评异步任务（队列处理，30秒内完成）
17. 通知推送服务（仓管通知、主管通知、采购员通知）
18. 供应链状态聚合接口（Dashboard 看板数据）

### @senior-frontend-engineer

Sprint 3 前端交付清单：

1. QCInspectionPage.tsx（来料质检单列表）+ QCInspectionFormPage.tsx（质检单填写，含BD-004约束）
2. ReceiptListPage.tsx 扩展（入库记录 + 溯源入口）
3. ReturnOrderPage.tsx（退货管理列表 + 退货单详情 + 状态推进 + 沟通记录）
4. ProductionOrderPage.tsx（生产工单列表 + 工单详情页，含 BOM 版本显示、物料需求Tab、预警色）
5. SchedulingPage.tsx（排产操作，工序步骤分配表单）
6. ScheduleBoard.tsx（排产看板，甘特图周视图）
7. ShortageBoard.tsx（缺料看板，预警色 + 建议创建入口）
8. DeliveryConfirmPage.tsx（交付确认操作页 + 历史记录）
9. Dashboard 扩展：供应链状态区块 + 待交付工单 Widget
10. TaskPage.tsx 扩展（Sprint 1 基础上扩展：工单上下文字段、BOM版本只读、工序等待提示横幅）

### @senior-qa-engineer

Sprint 3 测试重点与产出：

**[artifact:测试用例] R-09 测试套件**：
- BD-004 正向测试：合格质检单 → 自动入库 → 库存增加正确
- BD-004 负向测试：不合格质检单 → 后端 API 直接调入库接口返回 409（模拟绕过前端）
- 退货单自动创建：字段值验证、采购订单 qty_received 不变
- 部分到货三种状态自动切换边界值测试
- 一个送货单多 SKU 分批质检场景

**[artifact:测试用例] R-10 测试套件**：
- BD-001 回归测试：工单创建后 BOM 被激活新版本，工单物料需求不变（必须自动化）
- 多 SKU 销售订单创建多工单
- 无激活 BOM 版本时拒绝创建工单
- 排产冲突黄色警告（不阻断）
- 并发完工上报乐观锁冲突（模拟双端同时完工，后者收到 409）
- 工序完工→半成品入库→下道工序解锁的原子性（模拟库存更新失败，验证事务回滚）
- 成品完工→交付确认→库存减少→销售订单 shipped 完整链路

**[artifact:自动化测试] 全链路 E2E 测试**：
- 销售→生产链路：从销售订单确认 到 交付确认的完整 E2E 脚本
- 采购链路：从生产缺料检测 到 入库完成缺料消除 的完整 E2E 脚本

**[artifact:测试用例] R-11 测试套件**：
- 在途库存纳入缺口计算（不过度采购）
- 重复建议防重逻辑（已有 pending 建议时不重复创建）
- 多建议合并下单（多明细行验证）
- 入库后缺料异步重评（异步完成时间 < 30 秒）
- 供应链状态仪表板统计数据准确性

---

*文档版本*：v1.0
*创建日期*：2026-03-13
*负责人*：@senior-ai-agent-pm
*关联文档*：
- docs/v2/PRD-v2-iteration-plan.md
- docs/v2/sprint1-user-stories.md
- infra/db/init.sql

**下一步行动**：
- @tech-lead-architect：在编码启动前，必须产出生产状态机 [artifact:架构设计] 文档（含状态机图、并发保护设计、事务边界定义、库存来源区分方案），提交 @system-designer 评审
- @engineering-manager：完成 SDD 审批，输出 [artifact:工程审批] APPROVED 后方可进入编码阶段
- @senior-ui-designer：立即启动 Sprint 3 原型设计，优先交付质检单页面、生产工单页面、缺料看板页面（对应 P0 功能）
- @senior-backend-engineer：待架构设计和工程审批完成后，按后端交付清单顺序开发（R-09 优先，然后 R-10，R-11 在此基础上扩展）
- @senior-qa-engineer：立即准备 E2E 测试数据集和测试脚本框架，不等编码完成后再开始
