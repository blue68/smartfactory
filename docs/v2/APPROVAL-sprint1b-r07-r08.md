# [artifact:工程审批] Sprint 1b — R-07 销售客户管理 & R-08 销售订单+紧急插单

**审批编号**：APPROVAL-SPRINT1B-001
**审批日期**：2026-03-12
**审批人**：Engineering Manager
**输入文档**：
- `docs/v2/SDD-sprint1b-r07-r08.md` v1.0.0（技术设计）
- `docs/v2/sprint1b-user-stories-r07-r08.md` v1.0（User Story + 验收条件）
- `docs/v2/PRD-v2-iteration-plan.md` v2.0（PRD + 业务决策）

---

## 一、审批结论

```
APPROVED（有条件批准）
```

**结论说明**：

SDD 文档整体质量达到可编码标准。技术设计规范（SDD）在架构约束、数据模型、状态机、权限设计、缓存策略和风险评估方面均有明确描述，API 契约完整，BD-003 紧急插单 admin 权限得到严格落实。

审查过程发现 **8 项需关注问题**，其中 **2 项为编码前必须确认的阻断项（P0）**，**6 项为编码期间需同步跟进的非阻断项（P1）**。P0 问题须由后端工程师确认处理方案并在代码中体现，不阻断编码启动，但代码提交前须经 Code Reviewer 核实。

---

## 二、各需求审查结论

### 2.1 R-07 销售客户管理

**审查结论：通过**

| 审查项 | 状态 | 说明 |
|-------|------|------|
| 需求覆盖度 | 通过 | US-R07-001~004 全部有对应 API 接口和数据模型设计 |
| 数据库设计 | 通过 | `customers` 和 `customer_contacts` DDL 字段类型合理，索引设计完整 |
| API 设计 | 通过 | 11 个接口覆盖 CRUD + 联系人管理 + 选项列表 + 历史订单，RESTful 规范一致 |
| 权限设计 | 基本通过（见问题 P1-01） | 启用/禁用限 admin，其他操作已登录即可，与 User Story 权限矩阵基本一致 |
| 业务约束 | 通过 | 禁用保护、主联系人唯一性、删除保护均在 Service 层有明确说明 |
| 缓存策略 | 通过 | /options 接口 Redis 缓存 + 写操作 invalidate，方案合理 |

**主要差异点（已知晓，非阻断）**：
- User Story AC4（US-R07-001）要求系统**自动生成**客户编码（规则 C+6位数字），SDD 中 `code` 字段为前端传入，非自动生成。两者存在分歧，但 SDD 的设计更具灵活性，本次以 SDD 为准，由后端工程师在 Service 层确认生成策略，前端编辑页应将 `code` 字段设为只读并通过 API 获取。
- User Story 中提到 `DELETE /customers/:id`（物理删除接口），SDD 未设计该接口，改为禁用（PATCH status）。本次以 SDD 为准，此为合理的设计收敛，User Story AC8 的提示文案仍须前端实现。

---

### 2.2 R-08 销售订单（常规流程）

**审查结论：通过**

| 审查项 | 状态 | 说明 |
|-------|------|------|
| 需求覆盖度 | 通过 | US-R08-001 全部验收条件有对应接口和状态机覆盖 |
| 数据库设计 | 通过 | `sales_orders` 和 `sales_order_items` 字段完整，状态 ENUM 与状态机一致 |
| 状态机设计 | 通过 | 状态矩阵完整，TRANSITION_MAP 常量定义清晰，validateTransition 方法有伪代码 |
| 金额精度 | 通过 | DECIMAL(14,2)，decimal.js，与采购模块保持一致 |
| 订单号生成 | 通过 | Redis INCR + fallback 时间戳 + UNIQUE 约束兜底，方案合理 |
| 关联生产工单 | 通过 | 触发建工单接口设计完整，sales_order_item_id 双向关联 |

**差异点（已知晓，非阻断）**：
- User Story AC5 中订单编号规则为 `SO + YYYYMMDD + 4位流水号`（如 SO202603120001），SDD 中为 6 位序列（SO{YYYYMMDD}{6位序列}）。本次以 SDD（6位）为准，更能支撑未来单日高并发场景，前端展示宽度须相应调整。

---

### 2.3 R-08 紧急插单审批（BD-003 核心约束）

**审查结论：通过**

| 审查项 | 状态 | 说明 |
|-------|------|------|
| admin 独占审批权 | 通过 | `requireRoles('admin')` 中间件 + Service 层双重校验，设计完整 |
| 非 admin 调用返回 403 | 通过 | 中间件级拦截，符合 BD-003 强制要求 |
| 驳回后状态处理 | 通过 | 回到 draft，reject_reason 持久化，可修改重提，逻辑合理 |
| 待审批列表专属接口 | 通过 | `GET /api/sales-orders/pending-approvals` 仅 admin 可访问 |
| 撤回插单申请 | 存在缺口（见问题 P0-01） | SDD 未设计撤回接口，User Story 有此需求 |
| 重新提交次数限制 | 存在缺口（见问题 P1-03） | SDD 未体现最多重提 3 次的限制逻辑 |
| 审批操作日志 | 通过 | 9.6 章节有结构化日志规范，审批操作记录完整 |

---

### 2.4 数据/资金闭环

**审查结论：通过（Sprint 1b 范围内）**

| 链路节点 | 状态 | 说明 |
|---------|------|------|
| 客户 → 订单关联 | 通过 | customer_id 外键关联，创建订单时校验客户 active 状态 |
| 订单 → 明细行 | 通过 | sales_order_items 事务写入，total_amount 汇总计算 |
| 订单 → 生产工单 | 通过 | 手动触发接口设计完整，sales_order_item_id 精确追踪到 SKU 行 |
| 状态联动 | 通过 | 订单确认 → 生产中 → 发货 → 完成，状态机覆盖 |
| Sprint 2 自动触发预留 | 通过 | 4.6.3 明确说明事件机制留待 Sprint 2，边界清晰 |
| 资金闭环（应收账款） | Sprint 3 预留 | User Story 中提到应收账款，本 Sprint 不实现，无设计遗漏 |

---

## 三、问题与修改建议

### P0 阻断问题（编码前须确认方案，提交代码前须 Review 核实）

#### P0-01：撤回插单申请接口缺失

**问题描述**：
User Story US-R08-002 AC7 明确要求：销售人员可撤回"待审批"状态的插单申请（admin 尚未操作前），撤回后状态回草稿，可重新编辑。这是完整审批闭环的必要组成部分。

SDD API 接口列表（4.4.1）中完全未设计该接口，状态机矩阵（4.3.3）也无 `pending_approval → draft（由申请人触发）` 的流转路径。

**影响范围**：后端接口设计、状态机 TRANSITION_MAP、前端按钮渲染逻辑。

**修改要求**：

后端须新增接口：

```
POST /api/sales-orders/:id/withdraw
```

业务逻辑：
1. 校验当前用户为订单创建人（`created_by = req.userId`）或 admin
2. 校验订单 `is_urgent=true AND status=pending_approval`
3. 状态流转 `pending_approval → draft`
4. 清空 `reject_reason`，更新 `updated_by`

状态流转矩阵 TRANSITION_MAP 须增加：
```
pending_approval: ['confirmed', 'draft', 'closed']
// draft 在此语义包含：admin 驳回 + 申请人主动撤回
```

权限：申请人（created_by = userId）或 admin。

---

#### P0-02：production_orders ALTER TABLE 迁移风险未完整处置

**问题描述**：
SDD 4.2 章节中指出"MySQL 8.0 不支持 ADD COLUMN IF NOT EXISTS，需应用层迁移脚本处理"，并描述了通过 INFORMATION_SCHEMA 检查字段存在性的方案，但仅停留在注释说明层面，未明确迁移脚本的具体实现位置和执行时机。

若迁移脚本未在部署流程中保障幂等执行，重复部署将导致 production_orders 表 ALTER 失败，引发严重生产事故。

**修改要求**：

后端工程师须在代码交付时提供以下迁移脚本，并在代码 Review 时确认：

```sql
-- migrations/v2-sprint1b-001-add-sales-order-item-id.sql
SET @col_exists = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'production_orders'
    AND COLUMN_NAME = 'sales_order_item_id'
);

SET @sql = IF(@col_exists = 0,
  'ALTER TABLE production_orders ADD COLUMN sales_order_item_id BIGINT UNSIGNED NULL COMMENT \'关联销售订单明细行，追踪到 SKU 行\'',
  'SELECT 1'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
```

同时须在 CI/CD 部署文档中明确该脚本的执行顺序（在 Sprint 1b 后端服务启动前执行一次）。

---

### P1 非阻断问题（编码期间须跟进，Code Review 时必须体现）

#### P1-01：SDD 权限设计与 User Story 权限矩阵存在细节差异

**问题**：SDD 3.4 章节中"创建/更新客户 | 所有已登录角色（sales/admin）"，但 User Story 权限矩阵第 5.1 条明确：

- supervisor 查看客户列表（只读），**无新增/编辑权限**
- 信用额度/账期天数 **仅 admin 可修改**，sales 只读

SDD 未体现这两个细粒度权限控制，前端和后端如果按 SDD 字面实现，supervisor 将可以创建客户，sales 将可以修改信用额度。

**修改要求**：
- 后端 `PUT /api/customers/:id` 接口：若请求字段包含 `creditLimit` 或 `paymentDays`，须校验 `req.user.role === 'admin'`，否则忽略这两个字段或返回 403（推荐返回 403，明确拒绝）
- 后端 `POST /api/customers` 和 `PUT /api/customers/:id` 接口：增加角色校验，排除 supervisor 和 worker 角色
- 前端：信用额度和账期天数字段在非 admin 角色下渲染为只读文本，不挂载 input 元素

#### P1-02：产能影响查询接口未在 SDD 中设计

**问题**：User Story US-R08-002 AC1~AC3 要求紧急插单时实时展示产能影响（最早可排产日期、预计完工日期、受影响工单列表），这需要一个专属的产能预查接口。

SDD API 列表中无此接口。User Story 任务分发中列出了 `GET /orders/urgent-capacity-check`，但 SDD 完全未设计其 request/response 契约。

**修改要求**：
- **Sprint 1b 范围内**：后端须提供该接口的**简化版**（V2 阶段以"优先级插队估算"为逻辑，PRD v2.0 Sprint 2 风险说明已确认），接口契约须在代码提交前补充到 SDD 附录或单独技术备忘录中
- 建议接口路径：`GET /api/sales-orders/capacity-check?skuIds=...&quantities=...&deliveryDate=...`
- 超时 5 秒时前端降级展示，后端接口超时配置须在实现中体现
- 若本 Sprint 内无法实现精确计算，须在响应体中明确标注 `isEstimated: true` 字段，前端展示时带"估算"标注

#### P1-03：驳回后重新提交次数上限未在 SDD 中体现

**问题**：User Story US-R08-003 AC6 明确要求：单个订单最多允许重新提交 3 次，超出后订单自动关闭并提示"已超出最大重新提交次数，请创建新订单"。

SDD 中 `sales_orders` 表未设计 `submit_count` 或类似计数字段，业务逻辑中也无此判断。

**修改要求**：
- `sales_orders` 表增加字段：`submit_count TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '累计提交审批次数'`
- Service 层 `submitForApproval()` 方法须检查 `submit_count >= 3`，超出时抛出业务错误，并同时将订单状态流转为 `closed`，写入 `notes = '超出最大重新提交次数，自动关闭'`
- 此字段需在本次 `sales_orders` DDL 中增补（须同步更新 SDD 文档，或在代码注释中标注）

#### P1-04：sales_orders 表缺失 FK 外键说明与级联规则

**问题**：SDD 明确"无物理外键（与现有风格一致）"，这是可接受的设计，但 `sales_orders.customer_id` 在 Service 层校验客户存在性时，如果客户被并发删除（虽然有保护逻辑，但逻辑层有竞态窗口），将导致订单关联悬空。

同时，SDD 未说明 `production_orders.sales_order_item_id` 在对应 item 行被误操作时的处理方式。

**修改要求**：
- 后端 Service 层在 `createOrder` 写入 `sales_orders` 时，须将客户校验和订单写入放在同一事务内（当前 SDD 描述的事务仅覆盖 sales_orders + sales_order_items 的写入，未明确客户校验是否在事务中）
- Code Review 须检查事务边界是否正确包含了客户 active 状态的二次确认（行级锁或 SELECT FOR UPDATE）

#### P1-05：操作日志（审计日志）接口缺失

**问题**：
- User Story US-R07-001 AC9 要求客户操作记录操作日志
- User Story US-R08-003 AC7 要求审批操作记录审计日志
- User Story US-R08-004 AC6 要求订单状态变更操作日志区域

SDD 仅在 9.6 章节定义了审批操作的 console.log 结构化日志，但没有设计专用的审计日志表或接口（用于前端"操作日志区"展示）。

**修改要求**：

以下两个方案选其一，须在代码提交前确认：

**方案 A（推荐，更完整）**：新建 `audit_logs` 表，记录 entity_type、entity_id、action、operator_id、change_detail、created_at，提供查询接口供前端"操作日志区"使用。

**方案 B（Sprint 1b 降级方案）**：本 Sprint 仅实现服务端结构化日志（console.log），前端"操作日志区"展示 N/A 或"暂无记录"，Sprint 2 补充完整审计日志功能。须在前端设计中明确标注"未来能力"，避免用户误解为功能缺陷。

无论选择哪种方案，须在代码提交时明确说明，并告知 QA 相应测试范围调整。

#### P1-06：sales_order_items 表更新逻辑（全量替换）的边界未完整定义

**问题**：SDD 4.4.6 中说明更新订单时"先删旧行，再插新行，事务执行"。但未说明以下边界情况：

1. 订单已处于 `in_production`、`shipped` 状态时，对应 item 已有关联的 production_orders（通过 sales_order_item_id），此时若 item 被删除重建，production_orders 的关联 ID 将失效（悬空外键）。
2. SDD 4.4.6 明确"仅 draft 状态可更新"，但未在状态机矩阵中体现"只有 draft 可以编辑 items"这一约束。

**修改要求**：
- Service 层的 item 更新逻辑须在更新前校验 `status === 'draft'`（SDD 已有文字说明，须确保代码中有明确的状态前置断言，不依赖前端拦截）
- 代码 Review 须检查删旧行 + 插新行的事务中，是否有对 production_orders 关联关系的保护逻辑（理论上 draft 状态不应有关联工单，但须加断言防御）

---

## 四、后端编码任务清单

### 4.1 R-07 销售客户管理后端任务

| 编号 | 任务 | 对应 SDD | 优先级 |
|------|------|---------|--------|
| BE-R07-01 | 创建 `sales-customer` 模块目录结构，定义 customer.entity.ts 和 customer-contact.entity.ts（TypeORM 实体） | 3.5 | P1 |
| BE-R07-02 | 执行 DDL：CREATE TABLE customers + customer_contacts | 3.2 | P1 |
| BE-R07-03 | 实现 CustomerService：create / update / findAll（分页+筛选）/ findById / patchStatus | 3.1 + 3.3 | P1 |
| BE-R07-04 | `patchStatus` 中实现禁用保护逻辑（检查进行中订单） | 3.3.7 | P1 |
| BE-R07-05 | 实现联系人 CRUD：createContact / updateContact / deleteContact（含主联系人事务逻辑和最后一个保护） | 3.3.9~3.3.11 | P1 |
| BE-R07-06 | 实现 getCustomerOrders（历史订单概要，分页） | 3.3.12 | P1 |
| BE-R07-07 | 实现 getOptions（/options 接口，Redis 缓存 + invalidate） | 3.3.3 + 7 | P1 |
| BE-R07-08 | 实现 CustomerController + customer.routes.ts（Zod 校验，authMiddleware，requireRoles 按 SDD 3.4 配置）| 3.3 + 3.4 | P1 |
| BE-R07-09 | 补充信用额度/账期天数 admin-only 字段修改校验（P1-01 要求） | P1-01 | P1 |
| BE-R07-10 | 注册路由至 app.ts：`app.use('/api/customers', salesCustomerRoutes)` | 9.5 | P1 |
| BE-R07-11 | 扩展 ResponseCode：新增 6004~6009 错误码 | 5 | P1 |

### 4.2 R-08 销售订单后端任务

| 编号 | 任务 | 对应 SDD | 优先级 |
|------|------|---------|--------|
| BE-R08-01 | 执行 DDL：CREATE TABLE sales_orders + sales_order_items（注意增加 submit_count 字段，P1-03） | 4.2 + P1-03 | P1 |
| BE-R08-02 | 执行迁移脚本：幂等 ALTER TABLE production_orders（P0-02 要求） | P0-02 | P0 |
| BE-R08-03 | 实现 ORDER_TRANSITION_MAP 常量和 OrderStatus 类型 | 9.3 | P1 |
| BE-R08-04 | 实现 generateOrderNo（Redis INCR + fallback，TTL 当日过期） | 9.2 | P1 |
| BE-R08-05 | 实现 SalesOrderService.create（事务：校验客户+SKU + 计算金额 + 生成订单号 + 写入两表） | 4.4.5 + 9.1 | P1 |
| BE-R08-06 | 实现 SalesOrderService.update（仅 draft 状态可改，items 全量替换，事务） | 4.4.6 + P1-06 | P1 |
| BE-R08-07 | 实现 submit（draft→pending_approval，is_urgent=true 校验） | 4.4.7 | P1 |
| BE-R08-08 | 实现 confirm（draft→confirmed，is_urgent=false 校验） | 4.4.8 | P1 |
| BE-R08-09 | 实现 approve（pending_approval→confirmed，requireRoles('admin')，写 approved_by/at） | 4.4.9 | P1 |
| BE-R08-10 | 实现 reject（pending_approval→draft，requireRoles('admin')，rejectReason 必填，清空 approved_by/at） | 4.4.10 | P1 |
| BE-R08-11 | 实现 **withdraw**（pending_approval→draft，申请人/admin，P0-01 要求） | P0-01 | P0 |
| BE-R08-12 | 实现 ship（in_production→shipped） | 4.4.11 | P1 |
| BE-R08-13 | 实现 complete（shipped→completed） | 4.4.12 | P1 |
| BE-R08-14 | 实现 close（多状态→closed，requireRoles('admin')，notes 必填） | 4.4.13 | P1 |
| BE-R08-15 | 实现 createProductionOrders（POST /:id/production-orders，调用 ProductionService，状态联动） | 4.4.14 | P1 |
| BE-R08-16 | 实现 findAll（分页+筛选：keyword/customerId/status/isUrgent/startDate/endDate） | 4.4.2 | P1 |
| BE-R08-17 | 实现 pendingApprovals（GET /pending-approvals，仅 admin，按 created_at ASC） | 4.4.3 | P1 |
| BE-R08-18 | 实现 findById（含 items + productionOrders + customerName/grade JOIN） | 4.4.4 | P1 |
| BE-R08-19 | 实现**简化版**产能影响查询接口（P1-02 要求，补充接口契约） | P1-02 | P1 |
| BE-R08-20 | 实现 submit_count 限制逻辑（>= 3 时自动 close，P1-03 要求） | P1-03 | P1 |
| BE-R08-21 | 实现 SalesOrderController + sales-order.routes.ts（Zod 校验，authMiddleware，requireRoles） | 4.4 + 4.5 | P1 |
| BE-R08-22 | 注册路由至 app.ts：`app.use('/api/sales-orders', salesOrderRoutes)` | 9.5 | P1 |
| BE-R08-23 | 扩展 ResponseCode：新增 6010~6012 错误码 | 5 | P1 |
| BE-R08-24 | 并发状态流转保护：关键状态变更使用 `UPDATE ... WHERE status=? AND id=?` 乐观更新，检查 affectedRows | 8.1 | P1 |

---

## 五、前端编码任务清单

### 5.1 R-07 销售客户管理前端任务

| 编号 | 任务 | 对应 User Story | 优先级 |
|------|------|----------------|--------|
| FE-R07-01 | `CustomerPage.tsx`：客户列表（分页表格、搜索筛选、等级标签、状态徽章、新增按钮、导出按钮） | US-R07-001 AC2/AC3 | P1 |
| FE-R07-02 | `CustomerPage.tsx`：禁用/启用操作（PATCH status），含进行中订单的阻断错误提示 | US-R07-001 AC7/AC8 | P1 |
| FE-R07-03 | `CustomerDetailPage.tsx`：基本信息 Tab（含信用额度/账期天数 admin-only 编辑，非 admin 只读渲染） | US-R07-001 + P1-01 | P1 |
| FE-R07-04 | `CustomerContactsPanel.tsx`：联系人子面板（列表/新增/编辑/删除），主联系人标记切换交互（切换时弹出确认提示） | US-R07-002 AC3/AC4/AC5 | P1 |
| FE-R07-05 | `CustomerDetailPage.tsx`：历史订单 Tab（分页列表、状态筛选、日期范围筛选、点击跳转订单详情） | US-R07-003 AC1/AC4 | P1 |
| FE-R07-06 | 等级字段 inline edit 交互（VIP/A/B/C 快速切换，立即保存） | US-R07-003 AC5 | P1 |
| FE-R07-07 | 导出功能（按当前筛选条件全量导出，超 1000 条 loading 提示，命名规则须与 US-R07-004 AC3 一致） | US-R07-004 | P2 |
| FE-R07-08 | 客户选择下拉组件封装（调用 /options 接口，用于销售订单关联客户，仅展示 active 客户） | SDD 3.3.3 | P1 |
| FE-R07-09 | 侧边导航增加"销售管理 > 客户管理"菜单项（worker 角色不可见） | US-R07-001 AC1 | P1 |

### 5.2 R-08 销售订单前端任务

| 编号 | 任务 | 对应 User Story | 优先级 |
|------|------|----------------|--------|
| FE-R08-01 | `OrderListPage.tsx`：订单列表（分页表格、多条件筛选、紧急标签红色高亮、待审批橙色标签、默认订单日期倒序） | US-R08-001 AC9/AC10 | P1 |
| FE-R08-02 | `OrderListPage.tsx`：导航顶部"待审批紧急插单数量"红点角标（仅 admin 可见，调用 /pending-approvals 实时查询） | US-R08-003 AC1 | P1 |
| FE-R08-03 | `OrderFormPage.tsx`：创建/编辑订单表单（订单头+动态明细行+金额实时汇总+保存草稿/确认按钮） | US-R08-001 AC1~AC6 | P1 |
| FE-R08-04 | `OrderFormPage.tsx`：优先级选择"紧急"后展示 `UrgentCapacityAlert` 产能影响组件 | US-R08-002 AC1~AC3 | P1 |
| FE-R08-05 | `UrgentCapacityAlert.tsx`：三态封装（Loading / 产能充足 / 交期紧张），5秒超时降级提示 | US-R08-002 AC1~AC3 | P1 |
| FE-R08-06 | `OrderDetailPage.tsx`：订单基本信息 + 状态时间线 + 明细行 + 关联生产工单区（进入生产中后显示） | US-R08-004 AC1~AC3 | P1 |
| FE-R08-07 | `OrderDetailPage.tsx`：审批记录区（紧急插单时展示：审批状态/审批人/时间/备注或驳回原因） | US-R08-004 AC4 | P1 |
| FE-R08-08 | `OrderDetailPage.tsx`：操作按钮区动态渲染（根据 status + role 条件渲染，非 disabled 方式，严格不挂载非权限按钮） | US-R08-004 AC5 | P1 |
| FE-R08-09 | 撤回插单申请按钮（仅 sales 本人/admin 且订单为 pending_approval 状态时渲染，调用 POST /:id/withdraw） | US-R08-002 AC7 + P0-01 | P0 |
| FE-R08-10 | `UrgentApprovalPage.tsx`（或 Admin 审批视图）：待审批列表 + 审批详情（订单信息/产能影响/申请人信息），通过/驳回按钮仅对 admin 渲染（条件渲染，非 disabled） | US-R08-003 AC2~AC5 + BD-003 | P1 |
| FE-R08-11 | 驳回对话框：驳回原因必填（min 10 字，max 200 字，与 US-R08-003 AC5 要求对齐，SDD 中为 max 500，以 User Story 200 字为准） | US-R08-003 AC5 | P1 |
| FE-R08-12 | 已驳回订单"重新编辑提交"入口（驳回详情可见驳回原因，提供"重新编辑"按钮进入编辑页，submit_count >= 3 时展示"超出最大次数"提示） | US-R08-003 AC6 + P1-03 | P1 |
| FE-R08-13 | `OrderDetailPage.tsx`：操作日志区（根据 P1-05 方案 A/B 确认后实现；若选方案 B 则展示"审计日志功能即将上线"占位） | US-R08-004 AC6 + P1-05 | P1 |
| FE-R08-14 | 触发建生产工单弹窗（订单 confirmed 状态下，展示明细行选择 + 排产优先级默认值 + 提交） | SDD 4.4.14 + 4.6.4 | P1 |

---

## 六、联调计划

| 阶段 | 内容 | 前置条件 |
|------|------|---------|
| 联调 1 | R-07 客户 CRUD + 联系人管理 | BE-R07-01~R07-11 完成，接口可访问 |
| 联调 2 | R-08 订单创建/编辑 + 草稿保存 | BE-R08-01~R08-06 完成，R-07 客户 /options 接口可用 |
| 联调 3 | 普通订单确认 + 状态流转（confirm/ship/complete/close） | BE-R08-08~R08-14 完成 |
| 联调 4 | 紧急插单全流程（submit → approve/reject → withdraw） | BE-R08-09~R08-11 完成，P0-01 withdraw 接口就绪 |
| 联调 5 | 产能影响查询（UrgentCapacityAlert 组件联调） | BE-R08-19 简化版接口就绪，P1-02 契约确认 |
| 联调 6 | 触发建生产工单（联调 ProductionService） | BE-R08-15 完成，ProductionService.createProductionOrder 接口对接确认 |

---

## 七、QA 交付要求

1. 负向测试必须覆盖（BD-003 强制）：
   - supervisor 调用 `POST /api/sales-orders/:id/approve` → 期望 HTTP 403
   - sales 调用 `POST /api/sales-orders/:id/approve` → 期望 HTTP 403
   - worker 调用 `POST /api/sales-orders/:id/approve` → 期望 HTTP 403
   - sales 调用 `POST /api/sales-orders/:id/reject` → 期望 HTTP 403

2. submit_count 上限测试：第 3 次被驳回后，sales 再次调用 submit → 期望订单自动关闭并返回业务错误码。

3. 撤回接口测试（P0-01）：
   - 申请人调用 withdraw（自己的 pending_approval 订单）→ 期望状态回 draft
   - 非申请人 sales 调用 withdraw（他人订单）→ 期望 403
   - admin 调用 withdraw（任意 pending_approval 订单）→ 期望状态回 draft

4. 状态机非法流转测试：尝试从 completed/closed 触发任意操作 → 期望 HTTP 422 + 错误码 6012

5. 并发写入测试：两个用户同时 approve 同一订单 → 期望其中一个返回 409（乐观更新，affectedRows 检查）

---

## 八、风险承接说明

以下风险在 SDD 中已识别，工程经理承接并监控：

| 风险 | 等级 | 监控方式 |
|------|------|---------|
| 状态机并发竞争 | 中 | Code Review 检查 UPDATE WHERE 乐观更新实现是否完整 |
| 紧急插单绕过风险 | 中 | QA 负向测试用例覆盖（见上方 QA 要求第 1 条） |
| production_orders 迁移脚本幂等性 | 低 | P0-02 修改要求落地后，Deploy 流程文档复核 |
| 手动建工单遗漏 | 中 | 前端 FE-R08-14 "未关联工单" warning badge 实现到位；Sprint 2 自动触发预留 |
| 审计日志不完整 | 低 | P1-05 方案确认后，QA 相应调整测试范围 |

---

*文档版本*：1.0.0
*审批日期*：2026-03-12
*审批人*：Engineering Manager
*下一步动作*：
- @senior-backend-engineer 确认 P0-01（withdraw 接口）和 P0-02（迁移脚本幂等方案），并在 P1-02（产能查询接口契约）补充后启动编码
- @senior-frontend-engineer 确认 P1-05（操作日志方案 A/B）选择后启动编码，FE-R08-09（撤回按钮）列为 P0 任务
- @senior-qa-engineer 以本文档第七章 QA 交付要求为基准补充测试用例，特别是 BD-003 负向测试场景
