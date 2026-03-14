# [artifact:架构设计] V2 Sprint 3 全链路贯通 技术架构设计

**文档编号**：ARCH-SPRINT3-V2-001
**版本**：v1.0
**创建日期**：2026-03-13
**作者**：@tech-lead-architect
**输入来源**：PRD-v2-iteration-plan.md（Sprint 3 / R-09 / R-10 / R-11）、init.sql 现有表结构、ARCH-bom-universal-versioning.md（BD-001）
**交付目标**：为 Sprint 3 后端工程师（senior-backend-engineer）和前端工程师（senior-frontend-engineer）提供完整技术约束与设计指导，输出后须经 Engineering Manager 审批方可进入编码阶段。

---

## 目录

1. [生产状态机设计（R-10 核心）](#一生产状态机设计r-10-核心)
2. [数据库变更设计](#二数据库变更设计)
3. [API 接口设计](#三api-接口设计)
4. [关键技术方案](#四关键技术方案)
5. [事件驱动设计](#五事件驱动设计)
6. [模块划分](#六模块划分)
7. [技术风险](#七技术风险)

---

## 一、生产状态机设计（R-10 核心）

### 1.1 销售订单状态机

#### 状态枚举

```
SalesOrderStatus {
  draft              // 草稿
  pending_approval   // 待审批（紧急插单专用）
  confirmed          // 已确认 → 触发工单创建
  in_production      // 生产中（工单已创建并开工）
  completed          // 生产完工（成品已入库）
  shipped            // 已发货（交付确认）
  cancelled          // 已取消
}
```

#### 状态流转规则（Sales Order）

```
draft
  → confirmed        触发条件：普通订单由销售提交确认，无需审批
  → pending_approval 触发条件：紧急插单标记，需车间主管/老板审批
  → cancelled        触发条件：确认前任意时刻，由销售或管理员操作

pending_approval
  → confirmed        触发条件：审批通过（approved_by 记录操作人）
  → cancelled        触发条件：审批拒绝（reject_reason 必填）

confirmed
  → in_production    触发条件：关联 production_order 创建成功，工单首个工序任务开始
  → cancelled        触发条件：V2 限制：此阶段禁止直接取消，需先取消工单

in_production
  → completed        触发条件：所有关联工单均到达 completed 状态，且成品已入库
  → [不可回退]       V2 限制：in_production 不允许退回 confirmed

completed
  → shipped          触发条件：仓库确认发货操作
  → [不可回退]       V2 限制：completed/shipped 为终态，禁止任何状态回退

cancelled
  → [终态]           V2 限制：不支持从 cancelled 恢复
```

#### 不允许的状态回退（V2 限制）

| 禁止操作 | 原因 |
|---|---|
| in_production → confirmed | 工单已创建、原材料已预留，回退会造成库存数据不一致 |
| completed → in_production | 成品已入库，流水已写入，不可逆 |
| shipped → completed | 发货确认后物权已转移 |
| cancelled → 任意状态 | 取消后资源已释放，需重新建单 |

---

### 1.2 生产工单状态机（production_orders）

#### 状态枚举（现有字段扩充）

```
ProductionOrderStatus {
  pending        // 待排产（工单已创建，尚未排产）
  scheduled      // 已排产（production_schedules 已生成）
  material_ready // 原料就绪（库存扣减完成）[新增]
  in_progress    // 生产中（首道工序任务已开始）
  completed      // 完工（所有工序任务完成，成品已入库）
  cancelled      // 已取消
}
```

注：`material_ready` 为 V2 新增中间状态，用于区分"已排产但缺料"与"已排产且备料完成"两种情况，避免工单在缺料状态下意外开工。

#### 状态流转规则（Production Order）

```
pending
  → scheduled        触发条件：排产服务为所有工序步骤生成 production_schedules
  → cancelled        触发条件：关联销售订单取消（级联取消）

scheduled
  → material_ready   触发条件：MRP 缺料检测通过，所有原料 qty_reserved 锁定成功
  → pending          触发条件：排产计划被重置（插单影响重排）
  → cancelled        触发条件：销售订单取消

material_ready
  → in_progress      触发条件：首道工序 production_task 状态变为 started
  → scheduled        触发条件：原料被其他紧急工单抢占，需重新锁料（降级回退，V2 允许此回退）

in_progress
  → completed        触发条件：最后一道工序完工，qty_completed >= qty_planned，成品库存入库成功
  → [不可回退]       V2 限制：in_progress 不可退回 material_ready 或 scheduled

completed / cancelled
  → [终态]
```

---

### 1.3 生产任务状态机（production_tasks）

#### 状态枚举

```
ProductionTaskStatus {
  pending     // 待开始（已分配给工人，尚未开始）
  started     // 进行中（工人已报工开始）
  completed   // 完工（完工记录已提交）
  cancelled   // 已取消
}
```

#### 状态流转规则

```
pending
  → started     触发条件：工人在 Web 端或小程序端点击"开始任务"
  → cancelled   触发条件：排产重排或工单取消

started
  → completed   触发条件：工人提交完工记录（task_completions 写入），completed_qty > 0
  → [不可回退]  V2 限制：started 不可退回 pending（防止打卡记录被篡改）

completed / cancelled
  → [终态]
```

---

### 1.4 工序完工与半成品解锁联动规则

```
工序任务完工事件触发后：
  1. 写入 task_completions 记录
  2. 更新 production_tasks.completed_qty
  3. 判断当前工序是否产出半成品（process_step.output_type = 'semi_finished'）
     → 是：写入 inventory_transactions（SEMI_PRODUCT_IN），更新 inventory.qty_on_hand
     → 否：跳过
  4. 检查下道工序是否存在且状态为 pending
     → 存在且前置工序全部 completed：解锁下道工序，更新 production_tasks.status = pending（允许工人接取）
     → 存在但前置未全完：保持 locked 状态（V2 新增 locked 虚拟状态，通过前置任务 ID 关联判断）
  5. 检查当前工单所有工序是否全部 completed
     → 是：触发 production_order.completed 事件
```

---

## 二、数据库变更设计

### 2.1 新增表

#### 2.1.1 来料质检表 incoming_inspection_records

> 注意：V1 已有 `inspection_records`（成品验货，关联 production_order_id）和 `quality_inspections`（AI 轻量版）。Sprint 3 新增的是**来料**质检，语义不同，需独立建表，避免混淆。

```sql
-- 迁移文件：V2_S3_001_add_incoming_inspection.sql
CREATE TABLE IF NOT EXISTS `incoming_inspection_records` (
  `id`                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`           BIGINT UNSIGNED NOT NULL,
  `inspection_no`       VARCHAR(50)     NOT NULL COMMENT '来料质检单号，格式 IQC-YYYYMMDD-NNNN',
  `po_id`               BIGINT UNSIGNED NOT NULL COMMENT '关联采购订单ID',
  `delivery_note_id`    BIGINT UNSIGNED DEFAULT NULL COMMENT '关联送货单ID',
  `inspector_id`        BIGINT UNSIGNED NOT NULL COMMENT '质检员用户ID',
  `inspection_date`     DATE            NOT NULL,
  `status`              ENUM('draft','in_progress','passed','partially_passed','failed') NOT NULL DEFAULT 'draft',
  `overall_result`      ENUM('pass','fail','conditional_pass') DEFAULT NULL COMMENT '综合质检结论',
  `receipt_triggered`   TINYINT(1)      NOT NULL DEFAULT 0 COMMENT '1=已触发入库单生成',
  `return_triggered`    TINYINT(1)      NOT NULL DEFAULT 0 COMMENT '1=已触发退货单生成',
  `notes`               TEXT            DEFAULT NULL,
  `completed_at`        DATETIME(3)     DEFAULT NULL,
  `created_at`          DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`          DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by`          BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_by`          BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_inspection_no` (`tenant_id`, `inspection_no`),
  KEY `idx_tenant_po` (`tenant_id`, `po_id`),
  KEY `idx_tenant_status` (`tenant_id`, `status`),
  KEY `idx_tenant_date` (`tenant_id`, `inspection_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='来料质检单表';
```

#### 2.1.2 来料质检明细表 incoming_inspection_items

```sql
CREATE TABLE IF NOT EXISTS `incoming_inspection_items` (
  `id`                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`           BIGINT UNSIGNED NOT NULL,
  `inspection_id`       BIGINT UNSIGNED NOT NULL COMMENT '关联来料质检单ID',
  `sku_id`              BIGINT UNSIGNED NOT NULL,
  `po_item_id`          BIGINT UNSIGNED NOT NULL COMMENT '关联采购订单明细ID',
  `qty_delivered`       DECIMAL(16,4)   NOT NULL COMMENT '本次到货数量',
  `qty_sampled`         DECIMAL(16,4)   NOT NULL DEFAULT 0 COMMENT '抽检数量',
  `qty_passed`          DECIMAL(16,4)   NOT NULL DEFAULT 0 COMMENT '合格数量',
  `qty_failed`          DECIMAL(16,4)   NOT NULL DEFAULT 0 COMMENT '不合格数量',
  `result`              ENUM('pass','fail','conditional_pass') DEFAULT NULL,
  `defect_types`        JSON            DEFAULT NULL COMMENT '缺陷类型数组，如 ["尺寸偏差","色差"]',
  `defect_images`       JSON            DEFAULT NULL COMMENT '缺陷图片URL数组',
  `disposition`         ENUM('accept','return','rework','scrap') DEFAULT NULL COMMENT '处置决定',
  `notes`               VARCHAR(500)    DEFAULT NULL,
  `created_at`          DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`          DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by`          BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_by`          BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_tenant_inspection` (`tenant_id`, `inspection_id`),
  KEY `idx_tenant_sku` (`tenant_id`, `sku_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='来料质检明细表';
```

#### 2.1.3 退货单表 return_orders

```sql
-- 迁移文件：V2_S3_002_add_return_orders.sql
CREATE TABLE IF NOT EXISTS `return_orders` (
  `id`                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`           BIGINT UNSIGNED NOT NULL,
  `return_no`           VARCHAR(50)     NOT NULL COMMENT '退货单号，格式 RTN-YYYYMMDD-NNNN',
  `return_type`         ENUM('purchase_return','production_return') NOT NULL DEFAULT 'purchase_return',
  `source_po_id`        BIGINT UNSIGNED DEFAULT NULL COMMENT '来源采购订单ID（采购退货）',
  `source_inspection_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '来源质检单ID',
  `supplier_id`         BIGINT UNSIGNED DEFAULT NULL,
  `status`              ENUM('draft','confirmed','shipped','completed','cancelled') NOT NULL DEFAULT 'draft',
  `return_reason`       VARCHAR(500)    NOT NULL COMMENT '退货原因',
  `total_qty`           DECIMAL(16,4)   NOT NULL DEFAULT 0,
  `notes`               TEXT            DEFAULT NULL,
  `confirmed_at`        DATETIME(3)     DEFAULT NULL,
  `shipped_at`          DATETIME(3)     DEFAULT NULL,
  `completed_at`        DATETIME(3)     DEFAULT NULL,
  `created_at`          DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`          DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by`          BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_by`          BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_return_no` (`tenant_id`, `return_no`),
  KEY `idx_tenant_po` (`tenant_id`, `source_po_id`),
  KEY `idx_tenant_status` (`tenant_id`, `status`),
  KEY `idx_tenant_supplier` (`tenant_id`, `supplier_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='退货单表';
```

#### 2.1.4 退货单明细表 return_order_items

```sql
CREATE TABLE IF NOT EXISTS `return_order_items` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`     BIGINT UNSIGNED NOT NULL,
  `return_id`     BIGINT UNSIGNED NOT NULL,
  `sku_id`        BIGINT UNSIGNED NOT NULL,
  `qty_return`    DECIMAL(16,4)   NOT NULL COMMENT '退货数量',
  `purchase_unit` VARCHAR(20)     NOT NULL,
  `unit_price`    DECIMAL(14,4)   NOT NULL DEFAULT 0,
  `defect_reason` VARCHAR(200)    DEFAULT NULL,
  `created_at`    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by`    BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_tenant_return` (`tenant_id`, `return_id`),
  KEY `idx_tenant_sku` (`tenant_id`, `sku_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='退货单明细表';
```

#### 2.1.5 BOM 快照表 bom_version_snapshots（BD-001）

```sql
-- 迁移文件：V2_S3_003_add_bom_snapshot.sql
-- 说明：工单创建时将激活版本 BOM 展开结果序列化快照，确保后续 BOM 变更不影响已下发工单的原材料计算
CREATE TABLE IF NOT EXISTS `bom_version_snapshots` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`       BIGINT UNSIGNED NOT NULL,
  `bom_header_id`   BIGINT UNSIGNED NOT NULL COMMENT '原始 BOM 表头 ID',
  `snapshot_no`     VARCHAR(50)     NOT NULL COMMENT '快照编号',
  `bom_version`     VARCHAR(20)     NOT NULL COMMENT '快照时的 BOM 版本号',
  `snapshot_data`   JSON            NOT NULL COMMENT '展开后的完整物料清单 JSON（含递归展开的所有层级）',
  `snapshot_hash`   VARCHAR(64)     NOT NULL COMMENT 'snapshot_data 的 SHA256 摘要，用于比对变更',
  `created_at`      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_by`      BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_snapshot_no` (`tenant_id`, `snapshot_no`),
  KEY `idx_tenant_bom` (`tenant_id`, `bom_header_id`),
  KEY `idx_hash` (`snapshot_hash`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='BOM版本快照表（工单创建时生成）';
```

#### 2.1.6 原材料需求计划表 material_requirements

```sql
-- 迁移文件：V2_S3_004_add_material_requirements.sql
-- 说明：工单展开 BOM 后生成的原材料需求明细，用于缺料检测和采购联动
CREATE TABLE IF NOT EXISTS `material_requirements` (
  `id`                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`           BIGINT UNSIGNED NOT NULL,
  `production_order_id` BIGINT UNSIGNED NOT NULL,
  `bom_snapshot_id`     BIGINT UNSIGNED NOT NULL COMMENT '关联 BOM 快照',
  `sku_id`              BIGINT UNSIGNED NOT NULL COMMENT '原材料 SKU',
  `qty_required`        DECIMAL(16,4)   NOT NULL COMMENT 'BOM 展开计算所需数量（含损耗）',
  `qty_reserved`        DECIMAL(16,4)   NOT NULL DEFAULT 0 COMMENT '已从库存预留数量',
  `qty_shortage`        DECIMAL(16,4)   NOT NULL DEFAULT 0 COMMENT '缺口数量 = qty_required - qty_reserved',
  `status`              ENUM('shortage','partial','fulfilled') NOT NULL DEFAULT 'shortage',
  `suggestion_id`       BIGINT UNSIGNED DEFAULT NULL COMMENT '关联采购建议ID（缺料时生成）',
  `created_at`          DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`          DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_tenant_order` (`tenant_id`, `production_order_id`),
  KEY `idx_tenant_sku_status` (`tenant_id`, `sku_id`, `status`),
  KEY `idx_bom_snapshot` (`bom_snapshot_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='生产工单原材料需求计划表';
```

---

### 2.2 现有表结构变更

#### 2.2.1 production_orders 增加 BOM 快照字段（BD-001）

```sql
-- 迁移文件：V2_S3_005_alter_production_orders.sql
ALTER TABLE `production_orders`
  ADD COLUMN `bom_snapshot_id`    BIGINT UNSIGNED DEFAULT NULL
    COMMENT 'BOM版本快照ID（创建工单时锁定，BD-001）'
    AFTER `bom_header_id`,
  ADD COLUMN `material_status`    ENUM('unchecked','shortage','partial','ready') NOT NULL DEFAULT 'unchecked'
    COMMENT '原材料备料状态'
    AFTER `status`,
  ADD KEY `idx_bom_snapshot` (`bom_snapshot_id`);
```

#### 2.2.2 delivery_notes 增加质检关联字段

```sql
-- 迁移文件：V2_S3_006_alter_delivery_notes.sql
ALTER TABLE `delivery_notes`
  ADD COLUMN `inspection_id`  BIGINT UNSIGNED DEFAULT NULL
    COMMENT '关联来料质检单ID'
    AFTER `status`,
  ADD COLUMN `receipt_id`     BIGINT UNSIGNED DEFAULT NULL
    COMMENT '关联入库单ID（质检通过后生成）'
    AFTER `inspection_id`;
```

#### 2.2.3 purchase_order_items 增加质检汇总字段

```sql
-- 迁移文件：V2_S3_007_alter_purchase_order_items.sql
ALTER TABLE `purchase_order_items`
  ADD COLUMN `qty_passed`     DECIMAL(16,4) NOT NULL DEFAULT 0
    COMMENT '累计质检合格入库数量'
    AFTER `qty_received`,
  ADD COLUMN `qty_rejected`   DECIMAL(16,4) NOT NULL DEFAULT 0
    COMMENT '累计质检不合格退货数量'
    AFTER `qty_passed`;
```

#### 2.2.4 process_steps 增加工序输出类型字段

```sql
-- 迁移文件：V2_S3_008_alter_process_steps.sql
ALTER TABLE `process_steps`
  ADD COLUMN `output_type`    ENUM('semi_finished','final_product','none') NOT NULL DEFAULT 'none'
    COMMENT '工序产出类型：半成品/成品/无入库'
    AFTER `workstation_type`,
  ADD COLUMN `output_sku_id`  BIGINT UNSIGNED DEFAULT NULL
    COMMENT '工序产出半成品 SKU ID（output_type=semi_finished 时必填）'
    AFTER `output_type`;
```

---

### 2.3 迁移 SQL 幂等保证

所有迁移文件遵循以下规范：
1. 每个文件使用独立编号（`V2_S3_NNN_描述.sql`），通过 Flyway / 手动版本管理执行
2. `ALTER TABLE ADD COLUMN IF NOT EXISTS`（MySQL 8.0+ 语法，低版本先判断 INFORMATION_SCHEMA 再执行）
3. 所有新表使用 `CREATE TABLE IF NOT EXISTS`
4. 迁移执行前在测试环境完整验证后方可提交生产

---

## 三、API 接口设计

统一返回结构：
```json
{ "code": 200, "data": {}, "message": "success" }
```
认证：所有接口必须携带 `Authorization: Bearer <token>`，tenant_id 从 JWT 中读取。

---

### 3.1 R-09：质检、入库、退货相关接口

| Method | Path | 描述 | 调用方 |
|---|---|---|---|
| POST | `/api/v1/incoming-inspections` | 创建来料质检单 | 质检员 |
| GET | `/api/v1/incoming-inspections` | 查询来料质检单列表 | 仓库/质检员 |
| GET | `/api/v1/incoming-inspections/:id` | 获取质检单详情（含明细） | 仓库/质检员 |
| PUT | `/api/v1/incoming-inspections/:id/items` | 更新质检明细（逐行录入结果） | 质检员 |
| POST | `/api/v1/incoming-inspections/:id/submit` | 提交质检结论（触发入库或退货） | 质检员/主管 |
| GET | `/api/v1/incoming-inspections/:id/preview-receipt` | 预览质检合格品将生成的入库单 | 质检员 |
| POST | `/api/v1/return-orders` | 创建退货单（质检不合格触发，BD-004） | 系统自动/仓库 |
| GET | `/api/v1/return-orders` | 查询退货单列表 | 仓库/采购 |
| GET | `/api/v1/return-orders/:id` | 获取退货单详情 | 仓库/采购 |
| PUT | `/api/v1/return-orders/:id/confirm` | 确认退货（更新库存扣减） | 仓库主管 |
| PUT | `/api/v1/return-orders/:id/ship` | 标记退货已发出 | 仓库 |
| PUT | `/api/v1/purchase-receipts/:id/confirm` | 确认入库（触发库存更新事务） | 仓库 |

**关键接口说明：**

`POST /api/v1/incoming-inspections/:id/submit` 请求体：
```json
{
  "overall_result": "partially_passed",
  "items": [
    { "id": 1, "qty_passed": 50, "qty_failed": 10, "disposition": "return" }
  ]
}
```
响应将包含自动生成的 `receipt_id`（合格品入库单）和 `return_id`（不合格品退货单）。

---

### 3.2 R-10：工单创建、BOM展开、任务分配、报工、完工、交付接口

| Method | Path | 描述 | 调用方 |
|---|---|---|---|
| POST | `/api/v1/production-orders` | 创建生产工单（含 BOM 快照生成） | 车间主管/系统触发 |
| POST | `/api/v1/sales-orders/:id/trigger-production` | 销售订单确认后触发工单创建 | 系统内部（确认事件驱动） |
| GET | `/api/v1/production-orders` | 工单列表（支持按状态/日期/SKU 过滤） | 车间主管/老板 |
| GET | `/api/v1/production-orders/:id` | 工单详情（含工序任务列表） | 全员 |
| GET | `/api/v1/production-orders/:id/bom-expansion` | 查看工单 BOM 展开结果（原材料需求） | 车间主管 |
| GET | `/api/v1/production-orders/:id/material-check` | 缺料检测（实时对比库存） | 车间主管 |
| POST | `/api/v1/production-orders/:id/schedule` | 触发排产（生成工序任务） | 车间主管 |
| POST | `/api/v1/production-orders/:id/assign-tasks` | 批量分配工序任务给工人 | 车间主管 |
| PUT | `/api/v1/production-orders/:id/cancel` | 取消工单（级联取消任务，释放库存预留） | 车间主管/管理员 |
| GET | `/api/v1/production-tasks` | 任务列表（支持按工人/日期/工单过滤） | 工人/车间主管 |
| GET | `/api/v1/production-tasks/:id` | 任务详情 | 工人 |
| PUT | `/api/v1/production-tasks/:id/start` | 开始任务（工人打卡） | 工人 |
| POST | `/api/v1/production-tasks/:id/complete` | 提交完工记录（报工） | 工人 |
| GET | `/api/v1/production-orders/:id/progress` | 工单进度看板（工序完成率汇总） | 车间主管/老板 |
| POST | `/api/v1/production-orders/:id/deliver` | 工单完工交付确认（成品发往销售订单） | 仓库/车间主管 |
| PUT | `/api/v1/sales-orders/:id/ship` | 销售订单发货确认 | 销售/仓库 |

**关键接口说明：**

`POST /api/v1/production-orders` 请求体：
```json
{
  "sales_order_id": 123,
  "sku_id": 456,
  "qty_planned": 100,
  "priority": 80,
  "planned_start": "2026-03-20",
  "planned_end": "2026-03-28"
}
```
后端自动执行：
1. 读取 `bom_headers`（where `sku_id` = 456 AND `is_active` = 1）
2. 递归展开 BOM，生成 `bom_version_snapshots`
3. 生成 `material_requirements` 明细
4. 返回工单 ID + BOM 快照 ID + 缺料摘要

---

### 3.3 R-11：缺料检测、采购建议生成接口

| Method | Path | 描述 | 调用方 |
|---|---|---|---|
| GET | `/api/v1/production-orders/:id/shortage-report` | 获取工单缺料报告（明细级） | 车间主管/采购 |
| GET | `/api/v1/material-requirements/shortage-summary` | 全局缺料汇总（跨工单合并同类项） | 采购/老板 |
| POST | `/api/v1/material-requirements/generate-suggestions` | 基于缺料清单批量生成采购建议 | 采购/系统 |
| GET | `/api/v1/purchase-suggestions` | 采购建议列表（已有接口扩展） | 采购/老板 |
| PUT | `/api/v1/purchase-suggestions/:id/approve` | 审批通过采购建议 | 老板/主管 |
| POST | `/api/v1/purchase-suggestions/batch-to-po` | 批量将审批通过的建议转为采购订单 | 采购 |

---

## 四、关键技术方案

### 4.1 BOM 展开算法（原材料需求计划）

#### 算法描述

采用递归深度优先遍历（DFS），限制最大层级深度为 10（防止循环引用死循环）。

```
function expandBOM(bom_header_id, qty, level = 1, visited = Set()):
  if level > 10: throw Error('BOM 层级超限')
  if bom_header_id in visited: throw Error('BOM 循环引用')
  visited.add(bom_header_id)

  items = SELECT * FROM bom_items WHERE bom_header_id = ?
  result = []

  for item in items:
    adjusted_qty = qty * item.quantity * (1 + item.scrap_rate)

    if item.component_sku_id 对应的 SKU 是半成品 AND 存在对应的激活 BOM:
      // 递归展开半成品，不加入原料需求，只展开其子组件
      sub_result = expandBOM(sub_bom_header_id, adjusted_qty, level + 1, visited)
      result.extend(sub_result)
    else:
      // 原材料，直接计入需求清单
      result.append({ sku_id, qty: adjusted_qty, unit, level })

  // 合并同一 sku_id 的数量
  return mergeBySkuId(result)
```

展开结果序列化为 JSON 存入 `bom_version_snapshots.snapshot_data`，格式：
```json
{
  "bom_header_id": 1,
  "bom_version": "2.0",
  "expanded_at": "2026-03-20T08:00:00.000Z",
  "items": [
    { "sku_id": 10, "sku_code": "FAB-001", "name": "棉布", "qty_per_unit": 1.2, "unit": "米", "scrap_included": true }
  ]
}
```

#### 循环引用检测

展开前通过 `visited` Set 检测，发现循环时立即抛出错误，阻止工单创建并告知操作人 BOM 配置异常。

---

### 4.2 工单创建时 BOM 版本快照机制（BD-001）

**核心原则**：工单一旦创建，BOM 版本即被冻结，后续 BOM 变更（包括激活新版本）不影响已下发工单的原料计算。

**执行步骤**（数据库事务内完成）：

```
BEGIN TRANSACTION;
  1. 查询 bom_headers（WHERE sku_id = ? AND is_active = 1）→ 取得 active_bom
  2. 调用 expandBOM(active_bom.id, qty_planned) → 得到展开清单
  3. 计算 snapshot_hash = SHA256(JSON.stringify(展开清单))
  4. INSERT INTO bom_version_snapshots → 得到 snapshot_id
  5. INSERT INTO production_orders (bom_snapshot_id = snapshot_id, ...)
  6. INSERT INTO material_requirements（逐行写入展开后的原材料需求）
  7. 对每行 material_requirements，执行库存预留（UPDATE inventory SET qty_reserved = qty_reserved + X WHERE sku_id = ? AND qty_on_hand - qty_reserved >= X）
     → 若库存不足，qty_shortage 记录缺口，不阻塞工单创建
  8. 更新 production_orders.material_status（全部满足='ready'，部分='partial'，全部缺='shortage'）
COMMIT;
```

---

### 4.3 质检→入库事务设计

**场景**：来料质检单提交后，合格品触发入库，不合格品触发退货单（BD-004）。

```
BEGIN TRANSACTION;
  // 合格品处理
  if qty_passed > 0:
    1. INSERT INTO purchase_receipts（生成入库单，status='confirmed'）
    2. INSERT INTO inventory_transactions（transaction_type='PURCHASE_IN', qty=qty_passed）
    3. UPDATE inventory SET qty_on_hand = qty_on_hand + qty_passed, last_in_at = NOW()
    4. UPDATE inventory_balances（冗余视图同步）
    5. UPDATE purchase_order_items SET qty_received = qty_received + qty_passed, qty_passed = qty_passed + ?
    6. 检查 PO 是否全量入库 → 更新 purchase_orders.status（partial_received / received）
    7. UPDATE incoming_inspection_records SET receipt_triggered = 1, receipt_id = ?

  // 不合格品处理（BD-004）
  if qty_failed > 0 AND disposition = 'return':
    8. INSERT INTO return_orders（status='confirmed'，source_inspection_id=?）
    9. INSERT INTO return_order_items
    10. UPDATE purchase_order_items SET qty_rejected = qty_rejected + qty_failed
    11. UPDATE incoming_inspection_records SET return_triggered = 1, return_id = ?
    12. 触发事件：PURCHASE_RETURN_CREATED（供应商绩效系统消费）

  // 更新质检单状态
  13. UPDATE incoming_inspection_records SET status = 'passed'/'partially_passed'/'failed'
COMMIT;
```

**幂等保护**：`incoming_inspection_records.receipt_triggered` 和 `return_triggered` 字段防止重复触发入库和退货。提交质检结论前检查标志位，已触发则拒绝重复操作，返回 409 Conflict。

---

### 4.4 质检不合格退货自动流程（BD-004）

**决策依据（BD-004）**：质检不合格数量 `qty_failed > 0` 且明细 `disposition = 'return'` 时，系统自动生成退货单，无需人工干预创建退货单。

**自动触发逻辑**：
```
质检结论提交（submit）
  → 后端 IncomingInspectionService.submit()
  → 内部调用 ReturnOrderService.createFromInspection(inspectionId, failedItems)
    → 生成 return_no = 'RTN-' + YYYYMMDD + '-' + sequence
    → status = 'confirmed'（自动确认，无需二次人工确认）
    → 写入 return_orders + return_order_items
  → 事件发布：RETURN_ORDER_AUTO_CREATED
    → 邮件/站内信通知采购员
    → 供应商绩效记录写入（不合格次数 +1）
```

**库存处理**：不合格品尚未入库（质检前物理上在待检区），因此无需做库存扣减，仅更新 `purchase_order_items.qty_rejected` 字段，标记该部分已决定退货。

---

### 4.5 半成品入库→下道工序解锁机制

```
工序任务完工事件（TASK_COMPLETED）
  ↓
  process_step.output_type == 'semi_finished' ?
  ↓ Yes
  写入 inventory_transactions（SEMI_PRODUCT_IN）
  更新 inventory.qty_on_hand += completed_qty
  ↓
  查询当前工单下序 production_schedule（WHERE step_no = current_step_no + 1）
  ↓
  判断前置工序是否全部完工（sum completed_qty >= 当前工序需要的输入数量）
  ↓ Yes（全部满足）
  更新下道工序 production_tasks：将原 locked 任务（通过 schedule_id 关联）变更为 pending
  发布事件：TASK_UNLOCKED（工人侧实时推送）
  ↓ No（部分完工，数量不满足）
  更新 production_schedules.unlocked_qty（记录已解锁的数量）
  保持任务 pending（允许部分启动）
```

**V2 简化规则**：V2 阶段对于多工人并行同一工序，采用"总完工量达到阈值即解锁下道"策略，不做精细到每个零件粒度的批次追踪（留给 Sprint 4 溯源增强）。

---

### 4.6 库存更新的事务安全性

**并发场景**：多张工单同时对同一 SKU 进行库存预留（qty_reserved 更新），需防止超卖。

**方案**：使用乐观锁 + 行级锁组合策略。

```sql
-- 库存预留（行级锁保护）
SELECT qty_on_hand, qty_reserved
FROM inventory
WHERE tenant_id = ? AND sku_id = ?
FOR UPDATE;

-- 检查可用量 = qty_on_hand - qty_reserved >= qty_required
-- 满足则更新
UPDATE inventory
SET qty_reserved = qty_reserved + ?
WHERE tenant_id = ? AND sku_id = ?
  AND (qty_on_hand - qty_reserved) >= ?;

-- 若受影响行数 = 0，说明并发导致可用量不足，缺料处理
```

**库存入库幂等保证**：`inventory_transactions.transaction_no` 字段具有唯一索引，重复提交入库请求时 MySQL 抛出唯一约束冲突，服务层捕获后返回 409，前端提示"该批次已入库"。

---

## 五、事件驱动设计

Sprint 3 阶段采用**进程内同步事件**（EventEmitter 模式），不引入消息队列（MQ 延至 Sprint 4 或 V3 按需引入）。所有事件在同一数据库事务内同步处理，确保原子性。

### 5.1 业务事件清单

| 事件名称 | 触发时机 | 消费方 | 触发的后续动作 |
|---|---|---|---|
| `SALES_ORDER_CONFIRMED` | 销售订单状态变更为 confirmed | ProductionOrderService | 自动创建生产工单（若配置了自动触发）或提醒车间主管手动创建 |
| `PRODUCTION_ORDER_CREATED` | 生产工单创建成功 | MrpService | BOM 展开 → 生成 material_requirements → 库存预留尝试 |
| `MATERIAL_SHORTAGE_DETECTED` | MRP 检测到缺料（qty_shortage > 0）| PurchaseSuggestionService | 自动生成采购建议（status=pending，等待审批） |
| `INSPECTION_SUBMITTED` | 质检结论提交 | InventoryService, ReturnOrderService | 合格品入库事务 + 不合格品退货单自动创建 |
| `PURCHASE_RECEIPT_CONFIRMED` | 入库单确认 | MrpService | 重新检测关联工单的缺料状态，若已满足则更新 material_status = ready |
| `RETURN_ORDER_AUTO_CREATED` | 退货单自动创建（BD-004）| NotificationService, SupplierPerformanceService | 通知采购员 + 更新供应商绩效不合格计数 |
| `TASK_STARTED` | 工人开始任务 | ProductionOrderService | 若工单状态为 material_ready，更新为 in_progress，记录 actual_start |
| `TASK_COMPLETED` | 工人提交完工记录 | SemiProductService, ScheduleService | 半成品入库（如适用）+ 下道工序解锁 |
| `PRODUCTION_ORDER_COMPLETED` | 工单所有工序完工 | SalesOrderService, InventoryService | 成品入库 + 检查销售订单是否所有工单完工 → 更新 sales_order.status = completed |
| `SALES_ORDER_COMPLETED` | 所有工单完工，订单进入完工状态 | NotificationService | 通知销售员：订单已完工，可安排发货 |
| `SALES_ORDER_SHIPPED` | 销售发货确认 | InventoryService | 成品库存 OUT（SALES_OUT），更新 sales_order_items.qty_delivered |

---

### 5.2 事件流转全链路图

```
用户确认销售订单
  → SALES_ORDER_CONFIRMED
    → 车间主管创建生产工单
      → PRODUCTION_ORDER_CREATED
        → BOM 展开 + 库存预留
          → 若缺料: MATERIAL_SHORTAGE_DETECTED
            → 生成采购建议 → 老板审批 → 采购下单
              → 供应商送货 → 来料质检
                → INSPECTION_SUBMITTED
                  → 合格: PURCHASE_RECEIPT_CONFIRMED → 库存更新 → MRP 重新检测
                  → 不合格: RETURN_ORDER_AUTO_CREATED
          → 若备料完成: production_order.material_status = ready
            → 排产 → 分配任务 → 工人接单
              → TASK_STARTED → production_order.status = in_progress
              → TASK_COMPLETED（循环各工序）
                → 半成品入库 + 解锁下道工序
              → 最终工序完成 → PRODUCTION_ORDER_COMPLETED
                → 成品入库 → SALES_ORDER_COMPLETED
                  → 发货确认 → SALES_ORDER_SHIPPED
```

---

## 六、模块划分

### 6.1 后端新增/增强模块

```
services/api/src/modules/
├── incoming-inspection/               [新增模块 - R-09]
│   ├── incoming-inspection.controller.ts
│   ├── incoming-inspection.service.ts  // 含质检→入库事务、退货自动触发
│   ├── incoming-inspection.repository.ts
│   └── incoming-inspection.dto.ts
│
├── return-order/                      [新增模块 - R-09/BD-004]
│   ├── return-order.controller.ts
│   ├── return-order.service.ts
│   ├── return-order.repository.ts
│   └── return-order.dto.ts
│
├── production/                        [增强模块 - R-10]
│   ├── production-order.controller.ts  [已有，扩展]
│   ├── production-order.service.ts     [已有，增加 createWithBomSnapshot()]
│   ├── production-task.controller.ts   [已有，扩展]
│   ├── production-task.service.ts      [已有，增加完工后半成品入库逻辑]
│   ├── scheduler.service.ts            [已有，增加任务分配接口]
│   ├── bom-expansion.service.ts        [新增 - BOM 展开核心算法]
│   ├── bom-snapshot.service.ts         [新增 - BD-001 快照管理]
│   ├── semi-product.service.ts         [新增 - 半成品入库+工序解锁]
│   └── production.event-handler.ts     [新增 - 生产事件监听]
│
├── mrp/                               [新增模块 - R-10/R-11]
│   ├── mrp.controller.ts               // 缺料报告、全局缺料汇总
│   ├── mrp.service.ts                  // 缺料检测引擎
│   ├── mrp.repository.ts
│   └── material-requirement.dto.ts
│
├── purchase/                          [增强模块 - R-11]
│   ├── purchase-suggestion.service.ts  [已有，增加 generateFromShortage()]
│   └── purchase-order.service.ts       [已有，增加 batchCreateFromSuggestions()]
│
└── events/                            [新增共享事件模块]
    ├── business-events.enum.ts         // 所有业务事件枚举
    └── event-bus.service.ts            // 进程内 EventEmitter 封装
```

**数据库迁移文件目录**：
```
infra/db/migrations/v2-sprint3/
├── V2_S3_001_add_incoming_inspection.sql
├── V2_S3_002_add_return_orders.sql
├── V2_S3_003_add_bom_snapshot.sql
├── V2_S3_004_add_material_requirements.sql
├── V2_S3_005_alter_production_orders.sql
├── V2_S3_006_alter_delivery_notes.sql
├── V2_S3_007_alter_purchase_order_items.sql
└── V2_S3_008_alter_process_steps.sql
```

---

### 6.2 前端新增页面

```
services/web/src/pages/
├── production/
│   ├── ProductionOrderPage.tsx          [新增 - 工单列表+创建]
│   ├── ProductionOrderDetailPage.tsx    [新增 - 工单详情+工序进度看板]
│   ├── ProductionTaskPage.tsx           [新增/增强 - 任务看板（Web端报工）]
│   └── MaterialRequirementPage.tsx      [新增 - 原材料需求/缺料报告]
│
├── purchase/
│   ├── IncomingInspectionPage.tsx       [新增 - 来料质检单列表+创建]
│   ├── IncomingInspectionDetailPage.tsx [新增 - 质检明细录入+结论提交]
│   └── ReturnOrderPage.tsx              [新增 - 退货单列表+详情]
│
└── sales/
    └── SalesOrderDetailPage.tsx         [增强 - 增加生产进度追踪卡片]
```

**微信小程序新增页面**：
```
services/miniprogram/pages/
├── production-task/
│   ├── task-list/index          [增强 - 支持工序解锁后实时刷新]
│   └── task-complete/index      [已有，增加半成品确认步骤]
└── inspection/
    └── incoming-inspect/index   [新增 - 移动端来料质检录入]
```

---

## 七、技术风险

### 7.1 高风险项

| 风险编号 | 风险描述 | 影响范围 | 概率 | 缓解措施 |
|---|---|---|---|---|
| RISK-S3-01 | 生产状态机并发问题：多工人同时完成同一道工序任务，导致 completed_qty 累加错误或多次触发工单完工事件 | R-10 生产任务完工 | 高 | 任务级别加乐观锁（task.version 字段），完工记录写入时校验 task.status != completed；工单完工判断在事务内加行锁（`SELECT ... FOR UPDATE`） |
| RISK-S3-02 | BOM 循环引用：半成品通用化后，若 BOM 配置不当形成 A→B→A 的循环，展开算法死循环 | R-10 工单创建 | 中 | 展开算法内置 visited Set 检测；BOM 保存时增加前置循环检测校验（POST /bom-items 时实时检测） |
| RISK-S3-03 | 库存预留超卖：两张工单同时抢占同一 SKU 库存，导致 qty_reserved 超过 qty_on_hand | R-10/R-11 库存 | 高 | 行级锁（`SELECT ... FOR UPDATE`）+ 条件更新（`WHERE qty_on_hand - qty_reserved >= required`）；事务内检查受影响行数 |
| RISK-S3-04 | 质检结论重复提交：网络超时导致前端重复点击"提交质检"，触发两次入库事务 | R-09 入库 | 中 | `receipt_triggered` 标志位幂等保护；数据库层 `transaction_no` 唯一约束兜底 |
| RISK-S3-05 | BOM 快照存储膨胀：大批量工单创建时，每单生成一份 JSON 快照，长期运行导致 bom_version_snapshots 表膨胀 | R-10 存储 | 低（初期）| snapshot_hash 去重（相同 BOM 内容复用同一快照记录）；Sprint 4 增加快照归档策略 |

### 7.2 中风险项

| 风险编号 | 风险描述 | 缓解措施 |
|---|---|---|
| RISK-S3-06 | 全链路 E2E 测试覆盖不足：Sprint 3 链路最长，单元测试无法覆盖跨模块状态流转边界 | 要求 QA 工程师在 Sprint 3 开始前输出完整 E2E 测试用例，覆盖：销售确认→工单→排产→报工→完工→交付全链路；采购→质检→入库→退货链路 |
| RISK-S3-07 | V1 存量数据兼容：production_orders 表中已有记录无 bom_snapshot_id，ALTER TABLE 后该字段为 NULL，BOM 展开查询需判断空值降级到 bom_header_id 直查 | 迁移脚本执行后对存量工单批量生成快照；BOM 展开服务层增加 `bom_snapshot_id IS NULL` 兜底逻辑 |
| RISK-S3-08 | 工序解锁时序问题：多工人同时完成上道工序，下道工序被重复解锁触发 | 解锁逻辑在事务内检查 `production_tasks.status != pending` 后才执行更新，避免重复通知 |
| RISK-S3-09 | inspection_records 现有表关联 production_order_id（成品验货），与新增的 incoming_inspection_records（来料质检）语义混淆 | 代码层严格区分两个 Service 和 Controller，API 路径明确（`/incoming-inspections` vs `/outgoing-inspections`）；DB 注释明确标注用途差异 |

### 7.3 依赖风险

Sprint 3 所有开发工作依赖 Sprint 2 的以下交付物完整就绪：
- `bom_headers.is_active` 机制完整（激活版本唯一性约束已实现）
- `sales_orders.status` 状态流转基础版已实现
- `customers` 客户主数据 CRUD 完整
- Sprint 2 BOM 展开计算引擎回归测试通过（错误的 BOM 展开会导致 Sprint 3 原料需求计算全面失准）

**开发顺序约束**：
```
R-09（采购质检+入库+退货）← 可并行开始
R-10 后端（工单+BOM快照+状态机）← 最高优先级，其他工作依赖此模块
R-10 前端 ← 依赖后端 API 稳定后开始
R-11（缺料检测+采购联动）← 依赖 R-10 后端 MRP 模块完成
```

---

## 附录：技术选型约束（继承自 CLAUDE.md）

| 层次 | 技术栈 | 说明 |
|---|---|---|
| 后端运行时 | Node.js + TypeScript + Express | 不变 |
| 数据库 | MySQL 8.0 | 利用 `FOR UPDATE`、`JSON` 类型、`IF NOT EXISTS` |
| 缓存 | Redis | 用于库存预留热点数据缓存（后续 Sprint 按需启用） |
| 前端 | React + TypeScript | 不变 |
| 小程序 | 微信原生小程序 | 不变 |
| 事件机制 | Node.js EventEmitter（进程内同步）| Sprint 3 不引入 MQ，保持简单 |
| 十进制计算 | decimal.js | 所有金额/数量计算禁用浮点，继承 V1 规范 |

---

**文档状态**：待 Engineering Manager 审批
**下游交付**：本文档审批通过后，由 @senior-backend-engineer 开始后端开发，@senior-frontend-engineer 同步开始 UI 实现。
