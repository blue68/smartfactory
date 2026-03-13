# SDD — Sprint 1b 技术设计规范文档（R-07 销售客户管理 + R-08 销售订单与紧急插单）

**版本**: 1.0.0
**日期**: 2026-03-12
**作者**: tech-lead-architect
**状态**: 待工程经理审批
**关联 PRD**: PRD-v2-iteration-plan.md R-07 / R-08

---

## 目录

1. [文档说明](#1-文档说明)
2. [架构约束与前置条件](#2-架构约束与前置条件)
3. [R-07: 销售客户管理](#3-r-07-销售客户管理)
   - 3.1 数据模型设计
   - 3.2 DDL SQL
   - 3.3 API 接口设计
   - 3.4 权限设计
   - 3.5 模块结构
4. [R-08: 销售订单 + 紧急插单](#4-r-08-销售订单--紧急插单)
   - 4.1 数据模型设计
   - 4.2 DDL SQL（含 production_orders 变更）
   - 4.3 状态机设计
   - 4.4 API 接口设计
   - 4.5 权限设计
   - 4.6 与生产模块关联点
5. [错误码扩展](#5-错误码扩展)
6. [与现有模块的关联点汇总](#6-与现有模块的关联点汇总)
7. [缓存策略](#7-缓存策略)
8. [风险评估](#8-风险评估)
9. [技术规范附录](#9-技术规范附录)

---

## 1. 文档说明

### 1.1 编写目的

本文档为 Sprint 1b 两项需求（R-07、R-08）的 Specification Driven Development 设计规范。所有后端工程师、前端工程师在进入编码阶段前必须以本文档为唯一技术输入。后端工程师交付后须向前端工程师同步 API 契约。

### 1.2 范围

| 需求编号 | 需求名称 | 涉及服务 |
|---------|---------|---------|
| R-07 | 销售客户管理 | API: sales-customer, Web: 客户管理页 |
| R-08 | 销售订单 + 紧急插单 | API: sales-order, Web: 订单管理页 + 审批页 |

### 1.3 关键业务决策（已锁定）

| 决策项 | 结论 | 依据 |
|-------|------|------|
| 紧急插单审批角色 | 仅 `admin`（公司老板） | 产品经理确认 |
| 审批驳回后状态 | 回到 `draft`（不销毁，可修改重提） | 降低业务损失 |
| 订单确认触发排产 | 支持手动触发 + 批量确认后可手动批量建工单 | V2 Sprint1b 范围：手动触发；自动触发留 Sprint2 |
| 金额精度 | `DECIMAL(14,2)` | 与采购模块保持一致，使用 decimal.js 计算 |
| 订单号生成规则 | `SO{YYYYMMDD}{6位序列}` | 全局唯一，按 tenant_id 隔离 |

---

## 2. 架构约束与前置条件

### 2.1 现有技术栈

```
后端:  Node.js 18 + TypeScript + Express + TypeORM + MySQL 8.0 + Redis 7
前端:  React + TypeScript
部署:  Docker Compose，Nginx 反向代理
```

### 2.2 现有模块边界（与本次变更相关）

```
services/api/src/modules/
  supplier/         供应商（参考实体/服务/控制器/路由风格）
  purchase/         采购单（参考金额计算、状态流转、事务处理风格）
  production/       生产工单（关联点：production_orders.sales_order_id 已存在）
  inventory/        库存（未来交付关联点）
  sales-customer/   【新增 R-07】
  sales-order/      【新增 R-08，V1 已有表结构，本次扩展接口与状态机】
```

### 2.3 统一响应格式（继承现有规范）

```json
{
  "code": 0,
  "data": {},
  "message": "操作成功"
}
```

所有 Handler 使用已有 `success()` / `created()` / `buildPaginated()` helper。错误通过 `AppError` 抛出，全局 error handler 捕获。

### 2.4 多租户约束

- 所有查询必须携带 `tenant_id = :tenantId` 条件，不得遗漏
- Service 构造函数接收 `TenantContext` (`{ tenantId, userId }`)，与 supplier / purchase 模块一致
- Controller 通过 `req.tenantId` / `req.userId` 构建 context

### 2.5 权限中间件使用方式

```typescript
// 仅 admin 可操作（紧急插单审批）
router.post('/:id/approve', authMiddleware, requireRoles('admin'), asyncHandler(...));

// 已登录用户均可操作
router.get('/', authMiddleware, asyncHandler(...));
```

---

## 3. R-07: 销售客户管理

### 3.1 数据模型设计

#### 3.1.1 customers 表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | BIGINT UNSIGNED PK | 自增主键 |
| tenant_id | BIGINT UNSIGNED NOT NULL | 多租户隔离 |
| code | VARCHAR(50) NOT NULL | 客户编码，tenant_id 内唯一 |
| name | VARCHAR(200) NOT NULL | 客户名称 |
| grade | ENUM('VIP','A','B','C') | 客户等级，默认 B |
| contact | VARCHAR(100) | 主联系人姓名 |
| phone | VARCHAR(30) | 主联系电话 |
| email | VARCHAR(200) | 主联系邮箱 |
| address | VARCHAR(300) | 地址 |
| credit_limit | DECIMAL(14,2) | 授信额度，NULL 表示不限 |
| payment_days | INT | 账期天数（0=现款，30/60/90…） |
| status | ENUM('active','inactive') | 状态，默认 active |
| notes | TEXT | 备注 |
| created_by | BIGINT UNSIGNED | 创建人 |
| updated_by | BIGINT UNSIGNED | 最近更新人 |
| created_at | DATETIME(3) | 创建时间 |
| updated_at | DATETIME(3) | 更新时间 |

索引：
- UNIQUE(`tenant_id`, `code`)
- INDEX(`tenant_id`, `status`)
- INDEX(`tenant_id`, `grade`)

#### 3.1.2 customer_contacts 表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | BIGINT UNSIGNED PK | 自增主键 |
| tenant_id | BIGINT UNSIGNED NOT NULL | 多租户隔离 |
| customer_id | BIGINT UNSIGNED NOT NULL | 关联 customers.id |
| name | VARCHAR(100) NOT NULL | 联系人姓名 |
| title | VARCHAR(100) | 职务 |
| phone | VARCHAR(30) | 电话 |
| email | VARCHAR(200) | 邮箱 |
| is_primary | TINYINT(1) | 是否主要联系人（0/1） |
| created_at | DATETIME(3) | 创建时间 |

索引：
- INDEX(`tenant_id`, `customer_id`)
- INDEX(`customer_id`, `is_primary`)

业务约束：每个客户有且只有一个 `is_primary=1` 的联系人（Service 层强制校验）。

### 3.2 DDL SQL

```sql
-- ============================================================
-- R-07: 销售客户管理 DDL
-- ============================================================

CREATE TABLE IF NOT EXISTS customers (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id      BIGINT UNSIGNED NOT NULL COMMENT '租户ID',
  code           VARCHAR(50)     NOT NULL COMMENT '客户编码',
  name           VARCHAR(200)    NOT NULL COMMENT '客户名称',
  grade          ENUM('VIP','A','B','C') NOT NULL DEFAULT 'B' COMMENT '客户等级',
  contact        VARCHAR(100)    NULL COMMENT '主联系人',
  phone          VARCHAR(30)     NULL COMMENT '主联系电话',
  email          VARCHAR(200)    NULL COMMENT '主联系邮箱',
  address        VARCHAR(300)    NULL COMMENT '地址',
  credit_limit   DECIMAL(14,2)   NULL     COMMENT '授信额度，NULL=不限',
  payment_days   INT             NULL     COMMENT '账期天数',
  status         ENUM('active','inactive') NOT NULL DEFAULT 'active' COMMENT '状态',
  notes          TEXT            NULL     COMMENT '备注',
  created_by     BIGINT UNSIGNED NOT NULL DEFAULT 0,
  updated_by     BIGINT UNSIGNED NOT NULL DEFAULT 0,
  created_at     DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at     DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_customer_code (tenant_id, code),
  KEY idx_customer_status (tenant_id, status),
  KEY idx_customer_grade  (tenant_id, grade)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='销售客户主数据';

CREATE TABLE IF NOT EXISTS customer_contacts (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id   BIGINT UNSIGNED NOT NULL COMMENT '租户ID',
  customer_id BIGINT UNSIGNED NOT NULL COMMENT '关联 customers.id',
  name        VARCHAR(100)    NOT NULL COMMENT '联系人姓名',
  title       VARCHAR(100)    NULL     COMMENT '职务',
  phone       VARCHAR(30)     NULL     COMMENT '电话',
  email       VARCHAR(200)    NULL     COMMENT '邮箱',
  is_primary  TINYINT(1)      NOT NULL DEFAULT 0 COMMENT '是否主要联系人',
  created_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_contact_customer (tenant_id, customer_id),
  KEY idx_contact_primary  (customer_id, is_primary)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='客户联系人';
```

### 3.3 API 接口设计

**基础路径**: `/api/customers`

#### 3.3.1 接口列表总览

| Method | Path | 说明 | 权限 |
|--------|------|------|------|
| GET | `/api/customers` | 分页查询客户列表 | 已登录 |
| GET | `/api/customers/options` | 下拉选项列表（仅活跃客户） | 已登录 |
| GET | `/api/customers/:id` | 获取客户详情 | 已登录 |
| POST | `/api/customers` | 创建客户 | 已登录 |
| PUT | `/api/customers/:id` | 更新客户信息 | 已登录 |
| PATCH | `/api/customers/:id/status` | 启用/禁用客户 | 已登录 |
| GET | `/api/customers/:id/contacts` | 获取联系人列表 | 已登录 |
| POST | `/api/customers/:id/contacts` | 新增联系人 | 已登录 |
| PUT | `/api/customers/:id/contacts/:contactId` | 更新联系人 | 已登录 |
| DELETE | `/api/customers/:id/contacts/:contactId` | 删除联系人 | 已登录 |
| GET | `/api/customers/:id/orders` | 获取客户关联订单（概要） | 已登录 |

#### 3.3.2 GET /api/customers — 分页查询

**Query Parameters**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| page | number | 否 | 默认 1 |
| pageSize | number | 否 | 默认 20，最大 100 |
| keyword | string | 否 | 搜索客户名称/编码 |
| grade | enum | 否 | VIP/A/B/C |
| status | enum | 否 | active/inactive |

**Response 200**

```json
{
  "code": 0,
  "data": {
    "list": [
      {
        "id": 1,
        "code": "C001",
        "name": "星辰家居有限公司",
        "grade": "VIP",
        "contact": "张三",
        "phone": "13800138000",
        "email": "zhangsan@xingchen.com",
        "address": "广东省广州市天河区...",
        "creditLimit": "500000.00",
        "paymentDays": 30,
        "status": "active",
        "notes": null,
        "createdAt": "2026-03-12T08:00:00.000Z",
        "updatedAt": "2026-03-12T08:00:00.000Z"
      }
    ],
    "total": 50,
    "page": 1,
    "pageSize": 20,
    "totalPages": 3
  },
  "message": "操作成功"
}
```

#### 3.3.3 GET /api/customers/options — 下拉选项

**Response 200**

```json
{
  "code": 0,
  "data": [
    { "id": 1, "code": "C001", "name": "星辰家居有限公司", "grade": "VIP", "paymentDays": 30 }
  ],
  "message": "操作成功"
}
```

说明：仅返回 `status=active` 的客户，字段精简，用于销售订单创建时的下拉选择。

#### 3.3.4 GET /api/customers/:id — 客户详情

**Response 200**

```json
{
  "code": 0,
  "data": {
    "id": 1,
    "code": "C001",
    "name": "星辰家居有限公司",
    "grade": "VIP",
    "contact": "张三",
    "phone": "13800138000",
    "email": "zhangsan@xingchen.com",
    "address": "广东省广州市天河区...",
    "creditLimit": "500000.00",
    "paymentDays": 30,
    "status": "active",
    "notes": null,
    "contacts": [
      {
        "id": 10,
        "name": "张三",
        "title": "采购经理",
        "phone": "13800138000",
        "email": "zhangsan@xingchen.com",
        "isPrimary": true
      }
    ],
    "createdAt": "2026-03-12T08:00:00.000Z",
    "updatedAt": "2026-03-12T08:00:00.000Z"
  },
  "message": "操作成功"
}
```

#### 3.3.5 POST /api/customers — 创建客户

**Request Body**

```json
{
  "code": "C001",
  "name": "星辰家居有限公司",
  "grade": "VIP",
  "contact": "张三",
  "phone": "13800138000",
  "email": "zhangsan@xingchen.com",
  "address": "广东省广州市天河区...",
  "creditLimit": 500000.00,
  "paymentDays": 30,
  "notes": "重要客户，优先排产"
}
```

**字段校验规则（Zod Schema）**

| 字段 | 规则 |
|------|------|
| code | min(1) max(50)，tenant 内唯一 |
| name | min(1) max(200) |
| grade | enum VIP/A/B/C，默认 B |
| contact | max(100)，可选 |
| phone | max(30)，可选 |
| email | email 格式，max(200)，可选 |
| address | max(300)，可选 |
| creditLimit | number >= 0，可选 |
| paymentDays | int >= 0 <= 365，可选 |
| notes | max(2000)，可选 |

**Response 201**

```json
{
  "code": 0,
  "data": { /* 同详情结构 */ },
  "message": "客户已创建"
}
```

**Error Codes**

| code | HTTP | 说明 |
|------|------|------|
| 1001 | 400 | 参数校验失败（Zod 错误） |
| 1005 | 409 | 客户编码已存在 |

#### 3.3.6 PUT /api/customers/:id — 更新客户

**Request Body**: 同创建，所有字段可选（Partial）。`code` 变更时重新校验唯一性。

**Response 200**: 返回更新后的完整客户对象。

#### 3.3.7 PATCH /api/customers/:id/status — 启用/禁用

**Request Body**

```json
{ "status": "inactive" }
```

**业务约束**：禁用前检查是否存在 `status IN ('draft','pending_approval','confirmed','in_production')` 的销售订单，如有则拒绝禁用，返回错误提示客户有进行中订单无法禁用。

**Response 200**

```json
{
  "code": 0,
  "data": { "id": 1, "status": "inactive" },
  "message": "操作成功"
}
```

#### 3.3.8 GET /api/customers/:id/contacts — 联系人列表

**Response 200**

```json
{
  "code": 0,
  "data": [
    {
      "id": 10,
      "customerId": 1,
      "name": "张三",
      "title": "采购经理",
      "phone": "13800138000",
      "email": "zhangsan@xingchen.com",
      "isPrimary": true,
      "createdAt": "2026-03-12T08:00:00.000Z"
    }
  ],
  "message": "操作成功"
}
```

#### 3.3.9 POST /api/customers/:id/contacts — 新增联系人

**Request Body**

```json
{
  "name": "李四",
  "title": "财务总监",
  "phone": "13900139000",
  "email": "lisi@xingchen.com",
  "isPrimary": false
}
```

**业务约束**：若 `isPrimary=true`，先将该客户所有联系人的 `is_primary` 设为 0，再插入新记录（事务操作）。

#### 3.3.10 PUT /api/customers/:id/contacts/:contactId — 更新联系人

同新增规则，`isPrimary` 切换时执行事务更新。

#### 3.3.11 DELETE /api/customers/:id/contacts/:contactId — 删除联系人

**业务约束**：禁止删除最后一个联系人（客户至少保留一个联系人）。禁止删除 `is_primary=1` 的联系人（需先设置其他主联系人）。

#### 3.3.12 GET /api/customers/:id/orders — 客户订单概要

**Query Parameters**: `page`, `pageSize`, `status`

**Response 200**（分页，字段精简）

```json
{
  "code": 0,
  "data": {
    "list": [
      {
        "id": 100,
        "orderNo": "SO20260312000001",
        "orderDate": "2026-03-12",
        "deliveryDate": "2026-04-01",
        "isUrgent": false,
        "status": "confirmed",
        "totalAmount": "128000.00"
      }
    ],
    "total": 5,
    "page": 1,
    "pageSize": 20,
    "totalPages": 1
  },
  "message": "操作成功"
}
```

### 3.4 权限设计

| 操作 | 角色要求 |
|------|---------|
| 查看列表/详情/选项 | 所有已登录角色 |
| 创建/更新客户 | 所有已登录角色（sales/admin） |
| 启用/禁用客户 | admin |
| 联系人 CRUD | 所有已登录角色 |
| 查看客户订单概要 | 所有已登录角色 |

### 3.5 模块结构

```
services/api/src/modules/sales-customer/
  customer.entity.ts          -- TypeORM 实体（customers）
  customer-contact.entity.ts  -- TypeORM 实体（customer_contacts）
  customer.service.ts         -- 业务逻辑
  customer.controller.ts      -- 请求处理/Zod 校验
  customer.routes.ts          -- 路由注册
```

---

## 4. R-08: 销售订单 + 紧急插单

### 4.1 数据模型设计

#### 4.1.1 sales_orders 表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | BIGINT UNSIGNED PK | 自增主键 |
| tenant_id | BIGINT UNSIGNED NOT NULL | 多租户隔离 |
| order_no | VARCHAR(30) NOT NULL | 订单号，全局唯一（含 tenant） |
| customer_id | BIGINT UNSIGNED NOT NULL | 关联 customers.id |
| order_date | DATE NOT NULL | 下单日期 |
| delivery_date | DATE NOT NULL | 要求交货日期（列名对齐生产模块 expected_delivery） |
| is_urgent | TINYINT(1) NOT NULL DEFAULT 0 | 是否紧急插单 |
| status | ENUM(...) NOT NULL DEFAULT 'draft' | 见状态机 |
| total_amount | DECIMAL(14,2) NOT NULL DEFAULT 0.00 | 订单总金额（汇总自明细） |
| approved_by | BIGINT UNSIGNED NULL | 审批人（admin 用户 ID） |
| approved_at | DATETIME(3) NULL | 审批时间 |
| reject_reason | VARCHAR(500) NULL | 驳回原因 |
| notes | TEXT NULL | 备注 |
| created_by | BIGINT UNSIGNED NOT NULL DEFAULT 0 |  |
| updated_by | BIGINT UNSIGNED NOT NULL DEFAULT 0 |  |
| created_at | DATETIME(3) NOT NULL |  |
| updated_at | DATETIME(3) NOT NULL |  |

status ENUM 值: `'draft','pending_approval','confirmed','in_production','shipped','completed','closed'`

索引：
- UNIQUE(`tenant_id`, `order_no`)
- INDEX(`tenant_id`, `status`)
- INDEX(`tenant_id`, `customer_id`)
- INDEX(`tenant_id`, `is_urgent`, `status`)（用于审批待处理查询）
- INDEX(`delivery_date`)（排产优先级排序）

#### 4.1.2 sales_order_items 表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | BIGINT UNSIGNED PK | 自增主键 |
| tenant_id | BIGINT UNSIGNED NOT NULL | 多租户隔离 |
| order_id | BIGINT UNSIGNED NOT NULL | 关联 sales_orders.id |
| sku_id | BIGINT UNSIGNED NOT NULL | 关联 skus.id |
| quantity | DECIMAL(14,3) NOT NULL | 数量（支持小数） |
| unit_price | DECIMAL(14,2) NOT NULL | 单价 |
| amount | DECIMAL(14,2) NOT NULL | 金额（由 Service 层计算 = quantity * unit_price） |
| notes | VARCHAR(500) NULL | 行备注 |
| sort_order | INT NOT NULL DEFAULT 0 | 排序序号 |
| created_at | DATETIME(3) NOT NULL |  |
| updated_at | DATETIME(3) NOT NULL |  |

索引：
- INDEX(`tenant_id`, `order_id`)
- INDEX(`tenant_id`, `sku_id`)

#### 4.1.3 production_orders 表变更（存量表 ALTER）

V1 的 `production_orders` 表已有 `sales_order_id` 字段（代码中确认），本次增加对 `sales_order_item_id` 的精确关联：

```sql
-- 仅在字段不存在时执行（幂等 DDL）
ALTER TABLE production_orders
  ADD COLUMN IF NOT EXISTS sales_order_item_id BIGINT UNSIGNED NULL
    COMMENT '关联销售订单明细行 ID，精确追踪到 SKU 行';
```

### 4.2 DDL SQL

```sql
-- ============================================================
-- R-08: 销售订单 DDL
-- ============================================================

CREATE TABLE IF NOT EXISTS sales_orders (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id      BIGINT UNSIGNED NOT NULL COMMENT '租户ID',
  order_no       VARCHAR(30)     NOT NULL COMMENT '订单号 SO{YYYYMMDD}{6位序列}',
  customer_id    BIGINT UNSIGNED NOT NULL COMMENT '客户ID',
  order_date     DATE            NOT NULL COMMENT '下单日期',
  delivery_date  DATE            NOT NULL COMMENT '要求交货日期',
  is_urgent      TINYINT(1)      NOT NULL DEFAULT 0 COMMENT '是否紧急插单',
  status         ENUM(
    'draft',
    'pending_approval',
    'confirmed',
    'in_production',
    'shipped',
    'completed',
    'closed'
  ) NOT NULL DEFAULT 'draft' COMMENT '订单状态',
  total_amount   DECIMAL(14,2)   NOT NULL DEFAULT 0.00 COMMENT '订单总金额',
  approved_by    BIGINT UNSIGNED NULL     COMMENT '审批人用户ID',
  approved_at    DATETIME(3)     NULL     COMMENT '审批时间',
  reject_reason  VARCHAR(500)    NULL     COMMENT '驳回原因',
  notes          TEXT            NULL     COMMENT '备注',
  created_by     BIGINT UNSIGNED NOT NULL DEFAULT 0,
  updated_by     BIGINT UNSIGNED NOT NULL DEFAULT 0,
  created_at     DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at     DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_sales_order_no   (tenant_id, order_no),
  KEY idx_sales_order_status     (tenant_id, status),
  KEY idx_sales_order_customer   (tenant_id, customer_id),
  KEY idx_sales_urgent_status    (tenant_id, is_urgent, status),
  KEY idx_sales_delivery_date    (delivery_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='销售订单主表';

CREATE TABLE IF NOT EXISTS sales_order_items (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id   BIGINT UNSIGNED NOT NULL COMMENT '租户ID',
  order_id    BIGINT UNSIGNED NOT NULL COMMENT '关联 sales_orders.id',
  sku_id      BIGINT UNSIGNED NOT NULL COMMENT '关联 skus.id',
  quantity    DECIMAL(14,3)   NOT NULL COMMENT '数量',
  unit_price  DECIMAL(14,2)   NOT NULL COMMENT '单价',
  amount      DECIMAL(14,2)   NOT NULL COMMENT '行金额（quantity * unit_price）',
  notes       VARCHAR(500)    NULL     COMMENT '行备注',
  sort_order  INT             NOT NULL DEFAULT 0 COMMENT '排序',
  created_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_soi_order (tenant_id, order_id),
  KEY idx_soi_sku   (tenant_id, sku_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='销售订单明细行';

-- production_orders 存量表新增关联字段（幂等）
-- 注：MySQL 8.0 不支持 ADD COLUMN IF NOT EXISTS，需应用层迁移脚本处理
-- 迁移脚本在执行前先查询 INFORMATION_SCHEMA 确认字段不存在
ALTER TABLE production_orders
  ADD COLUMN sales_order_item_id BIGINT UNSIGNED NULL
    COMMENT '关联销售订单明细行，追踪到 SKU 行';
```

> **迁移注意**：`ALTER TABLE production_orders` 在 V2 首次部署时执行一次。迁移脚本应先用 `SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='production_orders' AND COLUMN_NAME='sales_order_item_id'` 检查字段存在性，避免重复执行报错。

### 4.3 状态机设计

#### 4.3.1 常规订单状态流转

```
[创建]
  │
  ▼
DRAFT ──────────────────────────────────────────────────► CLOSED
  │
  │  (用户手动确认，is_urgent=false)
  ▼
CONFIRMED ──────────────────────────────────────────────► CLOSED
  │
  │  (手动触发建工单 / 生产模块写入)
  ▼
IN_PRODUCTION ──────────────────────────────────────────► CLOSED
  │
  │  (出库/发货操作)
  ▼
SHIPPED ─────────────────────────────────────────────────► CLOSED
  │
  │  (客户签收 / 手动完结)
  ▼
COMPLETED
```

#### 4.3.2 紧急插单状态流转

```
[创建，is_urgent=true]
  │
  ▼
DRAFT ──────────────────────────────────────────────────► CLOSED
  │
  │  (业务员提交审批)
  ▼
PENDING_APPROVAL ───────────────────────────────────────► CLOSED
  │                      │
  │  admin 审批通过        │  admin 驳回
  ▼                      ▼
CONFIRMED            DRAFT（回到草稿，可修改重提）
  │
  │  (手动触发建工单 / 生产模块写入)
  ▼
IN_PRODUCTION ──────────────────────────────────────────► CLOSED
  │
  │  (出库/发货)
  ▼
SHIPPED ─────────────────────────────────────────────────► CLOSED
  │
  ▼
COMPLETED
```

#### 4.3.3 状态流转合法性矩阵

| 当前状态 | 目标状态 | 触发操作 | 角色限制 |
|---------|---------|---------|---------|
| draft | pending_approval | submitForApproval（is_urgent=true 时有效） | 已登录 |
| draft | confirmed | confirm（is_urgent=false 时有效） | 已登录 |
| draft | closed | close | admin |
| pending_approval | confirmed | approve | admin |
| pending_approval | draft | reject（需填 reject_reason） | admin |
| pending_approval | closed | close | admin |
| confirmed | in_production | markInProduction（生产模块写入或手动触发） | 已登录 / 系统内部 |
| confirmed | closed | close | admin |
| in_production | shipped | ship | 已登录 |
| in_production | closed | close | admin |
| shipped | completed | complete | 已登录 |
| shipped | closed | close | admin |

**关闭（closed）规则**：
- 除 `completed` 外，任何活跃状态均可被 admin 关闭
- 关闭操作不可逆，`completed` 状态不支持关闭（业务完结）

**Service 层校验逻辑**：

```typescript
private validateTransition(current: OrderStatus, target: OrderStatus, isUrgent: boolean): void {
  const allowed = TRANSITION_MAP[current];
  if (!allowed?.includes(target)) {
    throw AppError.businessError(
      `订单状态不允许从 ${current} 流转至 ${target}`,
      ResponseCode.ORDER_CANNOT_MODIFY
    );
  }
  if (target === 'pending_approval' && !isUrgent) {
    throw AppError.businessError('仅紧急插单需要提交审批', ResponseCode.ORDER_CONSTRAINT_BLOCKED);
  }
  if (target === 'confirmed' && isUrgent && current === 'draft') {
    throw AppError.businessError('紧急插单必须经过审批才能确认', ResponseCode.ORDER_CONSTRAINT_BLOCKED);
  }
}
```

### 4.4 API 接口设计

**基础路径**: `/api/sales-orders`

#### 4.4.1 接口列表总览

| Method | Path | 说明 | 权限 |
|--------|------|------|------|
| GET | `/api/sales-orders` | 分页查询订单列表 | 已登录 |
| GET | `/api/sales-orders/pending-approvals` | 待审批紧急插单列表 | admin |
| GET | `/api/sales-orders/:id` | 订单详情（含明细行） | 已登录 |
| POST | `/api/sales-orders` | 创建订单 | 已登录 |
| PUT | `/api/sales-orders/:id` | 更新订单（仅 draft 状态） | 已登录 |
| POST | `/api/sales-orders/:id/submit` | 提交审批（紧急插单） | 已登录 |
| POST | `/api/sales-orders/:id/confirm` | 直接确认（常规订单） | 已登录 |
| POST | `/api/sales-orders/:id/approve` | 审批通过 | admin |
| POST | `/api/sales-orders/:id/reject` | 审批驳回 | admin |
| POST | `/api/sales-orders/:id/ship` | 标记发货 | 已登录 |
| POST | `/api/sales-orders/:id/complete` | 标记完成 | 已登录 |
| POST | `/api/sales-orders/:id/close` | 关闭订单 | admin |
| POST | `/api/sales-orders/:id/production-orders` | 触发建生产工单 | 已登录 |

#### 4.4.2 GET /api/sales-orders — 分页查询

**Query Parameters**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| page | number | 否 | 默认 1 |
| pageSize | number | 否 | 默认 20，最大 100 |
| keyword | string | 否 | 搜索订单号 |
| customerId | number | 否 | 按客户筛选 |
| status | string | 否 | 订单状态 |
| isUrgent | boolean | 否 | 是否紧急插单 |
| startDate | string | 否 | 下单日期起（YYYY-MM-DD） |
| endDate | string | 否 | 下单日期止（YYYY-MM-DD） |

**Response 200**

```json
{
  "code": 0,
  "data": {
    "list": [
      {
        "id": 100,
        "orderNo": "SO20260312000001",
        "customerId": 1,
        "customerName": "星辰家居有限公司",
        "orderDate": "2026-03-12",
        "deliveryDate": "2026-04-01",
        "isUrgent": false,
        "status": "confirmed",
        "totalAmount": "128000.00",
        "approvedBy": null,
        "approvedAt": null,
        "createdAt": "2026-03-12T08:00:00.000Z"
      }
    ],
    "total": 30,
    "page": 1,
    "pageSize": 20,
    "totalPages": 2
  },
  "message": "操作成功"
}
```

#### 4.4.3 GET /api/sales-orders/pending-approvals — 待审批列表

仅返回 `is_urgent=1 AND status='pending_approval'` 的订单，供 admin 审批工作台使用。结构同列表接口，按 `created_at ASC`（先进先出）排序。

**权限**: 仅 admin。

#### 4.4.4 GET /api/sales-orders/:id — 订单详情

**Response 200**

```json
{
  "code": 0,
  "data": {
    "id": 100,
    "orderNo": "SO20260312000001",
    "customerId": 1,
    "customerName": "星辰家居有限公司",
    "customerGrade": "VIP",
    "orderDate": "2026-03-12",
    "deliveryDate": "2026-04-01",
    "isUrgent": false,
    "status": "confirmed",
    "totalAmount": "128000.00",
    "approvedBy": null,
    "approvedAt": null,
    "rejectReason": null,
    "notes": "客户要求红色包装",
    "items": [
      {
        "id": 200,
        "skuId": 50,
        "skuCode": "SKU-001",
        "skuName": "实木茶几 A款",
        "quantity": "100.000",
        "unitPrice": "800.00",
        "amount": "80000.00",
        "notes": null,
        "sortOrder": 1
      },
      {
        "id": 201,
        "skuId": 51,
        "skuCode": "SKU-002",
        "skuName": "实木书架 B款",
        "quantity": "60.000",
        "unitPrice": "800.00",
        "amount": "48000.00",
        "notes": null,
        "sortOrder": 2
      }
    ],
    "productionOrders": [
      {
        "id": 300,
        "workOrderNo": "WO20260312001",
        "skuName": "实木茶几 A款",
        "status": "in_progress",
        "progressPct": 35.5
      }
    ],
    "createdAt": "2026-03-12T08:00:00.000Z",
    "updatedAt": "2026-03-12T08:30:00.000Z"
  },
  "message": "操作成功"
}
```

#### 4.4.5 POST /api/sales-orders — 创建订单

**Request Body**

```json
{
  "customerId": 1,
  "orderDate": "2026-03-12",
  "deliveryDate": "2026-04-01",
  "isUrgent": false,
  "notes": "客户要求红色包装",
  "items": [
    {
      "skuId": 50,
      "quantity": 100,
      "unitPrice": 800.00,
      "notes": null,
      "sortOrder": 1
    },
    {
      "skuId": 51,
      "quantity": 60,
      "unitPrice": 800.00,
      "notes": null,
      "sortOrder": 2
    }
  ]
}
```

**字段校验规则**

| 字段 | 规则 |
|------|------|
| customerId | 必填，正整数，客户必须存在且 active |
| orderDate | 必填，YYYY-MM-DD 格式 |
| deliveryDate | 必填，YYYY-MM-DD 格式，必须 >= orderDate |
| isUrgent | boolean，默认 false |
| items | 数组，至少 1 条，最多 100 条 |
| items[].skuId | 必填，正整数，SKU 必须存在 |
| items[].quantity | 必填，Decimal > 0 |
| items[].unitPrice | 必填，Decimal >= 0 |
| items[].sortOrder | 整数，默认按数组顺序 1,2,3... |

**Service 层处理**：
1. 验证 customerId 存在且 status=active
2. 验证所有 skuId 存在（批量查询）
3. 计算每行 amount = quantity * unitPrice（decimal.js）
4. 汇总 total_amount
5. 生成 order_no：`SO{YYYYMMDD}{6位自增序列}`（Redis 计数器 `order_no:so:{tenantId}:{YYYYMMDD}` INCR，格式化 6 位补零，Redis 不可用时 fallback 为 `SO{YYYYMMDD}{timestamp末6位}`）
6. 事务写入 sales_orders + sales_order_items

**Response 201**: 返回完整订单详情（含 items）

#### 4.4.6 PUT /api/sales-orders/:id — 更新订单

**业务约束**：仅 `status=draft` 的订单可更新。更新包含完整明细行替换（先删旧行，再插新行，事务执行），重新计算 total_amount。

**Request Body**: 同创建，所有字段可选（至少包含 items 时才更新明细）。

#### 4.4.7 POST /api/sales-orders/:id/submit — 提交审批（紧急插单）

**Request Body**: 空（无需 body）

**业务逻辑**：
1. 加载订单，校验 `is_urgent=true AND status=draft`
2. 执行状态流转 draft → pending_approval
3. 更新 updated_by

**Response 200**

```json
{
  "code": 0,
  "data": { "id": 100, "status": "pending_approval" },
  "message": "已提交审批，等待老板审核"
}
```

#### 4.4.8 POST /api/sales-orders/:id/confirm — 直接确认（常规订单）

**业务约束**：仅 `is_urgent=false AND status=draft` 的订单可直接确认。

**Response 200**

```json
{
  "code": 0,
  "data": { "id": 100, "status": "confirmed" },
  "message": "订单已确认"
}
```

#### 4.4.9 POST /api/sales-orders/:id/approve — 审批通过（admin）

**Request Body**: 空（无需 body）

**业务逻辑**：
1. 校验当前用户 roles 含 `admin`（由 `requireRoles('admin')` 中间件保障）
2. 加载订单，校验 `is_urgent=true AND status=pending_approval`
3. 状态流转 pending_approval → confirmed
4. 写入 `approved_by=req.userId`，`approved_at=NOW()`

**Response 200**

```json
{
  "code": 0,
  "data": {
    "id": 100,
    "status": "confirmed",
    "approvedBy": 1,
    "approvedAt": "2026-03-12T10:00:00.000Z"
  },
  "message": "审批通过，订单已确认"
}
```

#### 4.4.10 POST /api/sales-orders/:id/reject — 审批驳回（admin）

**Request Body**

```json
{
  "rejectReason": "交期过于紧张，无法保障质量，请重新评估"
}
```

**字段校验**: `rejectReason` 必填，min(10) max(500)。

**业务逻辑**：
1. 校验 admin 角色
2. 校验 `status=pending_approval`
3. 状态流转 pending_approval → draft
4. 写入 `reject_reason`，清空 `approved_by / approved_at`

**Response 200**

```json
{
  "code": 0,
  "data": { "id": 100, "status": "draft", "rejectReason": "交期过于紧张..." },
  "message": "已驳回，订单回到草稿状态"
}
```

#### 4.4.11 POST /api/sales-orders/:id/ship — 标记发货

**业务约束**：`status=in_production` 时可触发（生产完成后出库发货）。

**Response 200**

```json
{
  "code": 0,
  "data": { "id": 100, "status": "shipped" },
  "message": "订单已标记发货"
}
```

#### 4.4.12 POST /api/sales-orders/:id/complete — 标记完成

**业务约束**：`status=shipped` 时可触发。

#### 4.4.13 POST /api/sales-orders/:id/close — 关闭订单（admin）

**Request Body**

```json
{
  "notes": "客户取消订单"
}
```

**业务约束**：`status IN ('draft','pending_approval','confirmed','in_production','shipped')` 时 admin 可关闭。

#### 4.4.14 POST /api/sales-orders/:id/production-orders — 触发建生产工单

**说明**：订单 `status=confirmed` 后，手动触发为指定明细行创建生产工单。此接口调用 `ProductionService.createProductionOrder()`，并建立双向关联。

**Request Body**

```json
{
  "items": [
    {
      "salesOrderItemId": 200,
      "skuId": 50,
      "bomHeaderId": 10,
      "processTemplateId": 5,
      "qtyPlanned": "100",
      "priority": 80,
      "plannedStart": "2026-03-15",
      "plannedEnd": "2026-03-28",
      "notes": "优先排产"
    }
  ]
}
```

**业务逻辑**：
1. 校验 `status=confirmed`
2. 校验每个 salesOrderItemId 属于本订单
3. 调用 `ProductionService.createProductionOrder()` 传入 salesOrderId + salesOrderItemId
4. 更新订单 `status=in_production`（所有明细行均已建工单时自动流转，否则保持 confirmed）
5. 返回创建的工单列表

**Response 201**

```json
{
  "code": 0,
  "data": {
    "created": [
      { "id": 300, "workOrderNo": "WO20260315001", "salesOrderItemId": 200 }
    ],
    "orderStatus": "in_production"
  },
  "message": "生产工单已创建"
}
```

### 4.5 权限设计

| 操作 | 角色要求 |
|------|---------|
| 查看列表/详情 | 所有已登录 |
| 创建/更新订单（draft） | 所有已登录 |
| 提交审批（紧急插单） | 所有已登录 |
| 直接确认（常规订单） | 所有已登录 |
| 审批通过 | **admin 独占** |
| 审批驳回 | **admin 独占** |
| 待审批列表 | **admin 独占** |
| 标记发货/完成 | 所有已登录 |
| 关闭订单 | **admin 独占** |
| 触发建工单 | 所有已登录 |

### 4.6 与生产模块关联点

#### 4.6.1 数据关联

```
sales_orders (1) ──────────────── (N) production_orders
                                        ├── sales_order_id      (已存在)
                                        └── sales_order_item_id (新增)

sales_order_items (1) ────────── (N) production_orders
                                        └── sales_order_item_id
```

#### 4.6.2 调用关系

`SalesOrderService.createProductionOrders()` 内部调用 `ProductionService.createProductionOrder()`，保持单向调用（Sales → Production），不引入循环依赖。

#### 4.6.3 生产状态反馈（Sprint 2 预留）

订单详情接口 `GET /api/sales-orders/:id` 已包含关联生产工单的 `progressPct` 汇总。
Sprint 2 中生产完成时，`ProductionService.completeProductionOrder()` 可通过事件或直接调用更新销售订单 `status` 至 `shipped` 准备态（本 Sprint 暂不实现自动触发）。

#### 4.6.4 排产优先级映射

| 销售订单属性 | 生产工单 priority 建议值 |
|------------|------------------------|
| is_urgent=true | 90（高优先级） |
| is_urgent=false, grade=VIP | 70 |
| is_urgent=false, grade=A | 60 |
| is_urgent=false, grade=B/C | 50（默认） |

此映射由前端在填写"触发建工单"表单时提供默认值，用户可手动覆盖。

### 4.7 模块结构

```
services/api/src/modules/sales-order/
  sales-order.service.ts        -- 业务逻辑（含状态机、金额计算、工单触发）
  sales-order.controller.ts     -- 请求处理/Zod 校验
  sales-order.routes.ts         -- 路由注册
```

> 不新增 entity 文件，直接使用原生 SQL（与 purchase 模块风格一致，保持灵活的 JOIN 查询能力）。

---

## 5. 错误码扩展

在 `services/api/src/shared/ApiResponse.ts` 的 `ResponseCode` 中追加以下销售模块错误码：

```typescript
// 销售模块 6xxx（已有 6001-6003，本次追加）
CUSTOMER_NOT_FOUND:       6004,
CUSTOMER_CODE_DUPLICATE:  6005,
CUSTOMER_HAS_ACTIVE_ORDERS: 6006,   // 禁用客户时存在进行中订单
CONTACT_NOT_FOUND:        6007,
CONTACT_LAST_ONE:         6008,     // 不允许删除最后一个联系人
CONTACT_IS_PRIMARY:       6009,     // 不允许删除主联系人
ORDER_URGENT_NEED_APPROVAL: 6010,   // 紧急插单必须走审批流程
ORDER_NOT_DRAFT:          6011,     // 订单不在草稿状态，无法修改
ORDER_INVALID_TRANSITION: 6012,     // 非法状态流转
```

---

## 6. 与现有模块的关联点汇总

| 关联模块 | 关联方式 | 说明 |
|---------|---------|------|
| production | SalesOrderService 调用 ProductionService.createProductionOrder() | 单向依赖，Sales → Production |
| production | production_orders.sales_order_id + sales_order_item_id 外键关联 | 数据层关联，无物理外键（与现有风格一致） |
| sku | sales_order_items.sku_id 关联 skus.id | 创建明细行时校验 SKU 存在性 |
| inventory | 未来 Sprint：shipped 触发出库扣减 | 本 Sprint 不实现 |
| auth | requireRoles('admin') 控制审批接口 | 现有中间件直接复用 |

---

## 7. 缓存策略

| 场景 | 策略 | TTL |
|------|------|-----|
| 客户下拉选项（/options） | Redis 缓存 key: `cache:customers:options:{tenantId}`，写操作后 invalidate | 5 分钟 |
| 订单号序列计数器 | Redis INCR key: `counter:so:{tenantId}:{YYYYMMDD}`，Redis 不可用时 fallback 时间戳 | 当日 23:59:59 过期 |
| 待审批数量 badge | 不缓存，实时查询（数据量小，重要性高） | N/A |
| 订单详情 | 不缓存（状态变更频繁，缓存收益低于一致性风险） | N/A |

---

## 8. 风险评估

### 8.1 技术风险

| 风险项 | 等级 | 描述 | 缓解措施 |
|-------|------|------|---------|
| 状态机并发竞争 | 中 | 多用户同时操作同一订单状态流转，可能导致重复审批或状态错误 | Service 层使用 `UPDATE ... WHERE status=? AND id=?` 乐观更新，检查 affectedRows=1，失败则抛 409 |
| 订单号重复 | 低 | Redis 故障时 fallback 使用时间戳，高并发下可能重复 | order_no 有 UNIQUE 约束，INSERT 失败时重试一次；生产环境保障 Redis 高可用 |
| production_orders 表变更 | 低 | ALTER TABLE 需在低峰期执行，大表可能锁表 | production_orders 为新表，V1 数据量小，影响极低；V2 上线前发布维护窗口 |
| 紧急插单绕过风险 | 中 | 业务员直接调用 confirm 接口绕过审批 | confirm 接口 Service 层强制校验 is_urgent=false，若 is_urgent=true 则抛错；requireRoles 中间件仅 admin 可执行 approve |
| 客户禁用影响已有订单 | 低 | 禁用客户时订单仍在进行中 | PATCH status 接口检查进行中订单，有则拒绝，返回明确提示 |

### 8.2 业务风险

| 风险项 | 等级 | 描述 | 缓解措施 |
|-------|------|------|---------|
| 手动建工单遗漏 | 中 | 订单确认后未及时建工单，导致排产遗漏 | 前端在订单详情页显示"未关联工单"警告 badge；Sprint 2 实现自动触发 |
| 金额精度丢失 | 低 | JavaScript 浮点数计算导致金额错误 | 强制使用 decimal.js 计算，与采购模块保持一致 |
| 驳回信息丢失 | 低 | 驳回后回到 draft，历史驳回记录丢失 | reject_reason 字段持久化保存，详情接口返回；Sprint 2 可增加审批日志表 |

### 8.3 向前兼容说明

- `sales_orders` 表在 V1 中已存在（production.service.ts 中 JOIN 查询已证实）。本次 DDL 使用 `CREATE TABLE IF NOT EXISTS`，仅在表不存在时创建，不影响 V1 已有数据。
- 若 V1 的 `sales_orders` 表字段与本设计不完全一致（如缺少 `is_urgent`、`pending_approval` 状态等），需在迁移脚本中执行 `ALTER TABLE` 补充字段，并为存量数据设置合理默认值（`is_urgent=0`，存量 status 映射规则由后端工程师确认后执行）。

---

## 9. 技术规范附录

### 9.1 Service 层设计规范

```typescript
// 模板：SalesOrderService 构造函数签名
export class SalesOrderService {
  private readonly tenantId: number;
  private readonly userId: number;

  constructor(ctx: { tenantId: number; userId: number }) {
    this.tenantId = ctx.tenantId;
    this.userId = ctx.userId;
  }
}

// Controller 中实例化方式
private svc(req: Request): SalesOrderService {
  return new SalesOrderService({ tenantId: req.tenantId, userId: req.userId });
}
```

### 9.2 订单号生成规范

```typescript
private async generateOrderNo(manager?: EntityManager): Promise<string> {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, ''); // YYYYMMDD
  const redisKey = `counter:so:${this.tenantId}:${today}`;

  let seq: number;
  if (isRedisAvailable()) {
    const client = getRedisClient();
    seq = await client.incr(redisKey);
    // 首次创建时设置过期时间
    if (seq === 1) {
      const endOfDay = new Date();
      endOfDay.setHours(23, 59, 59, 999);
      const ttl = Math.floor((endOfDay.getTime() - Date.now()) / 1000);
      await client.expire(redisKey, ttl);
    }
  } else {
    // fallback: 基于时间戳后6位（降级方案，低概率重复由 UNIQUE 约束兜底）
    seq = parseInt(Date.now().toString().slice(-6));
  }

  return `SO${today}${String(seq).padStart(6, '0')}`;
}
```

### 9.3 状态流转常量定义

```typescript
export type OrderStatus =
  | 'draft'
  | 'pending_approval'
  | 'confirmed'
  | 'in_production'
  | 'shipped'
  | 'completed'
  | 'closed';

// 允许的状态流转图（key=当前状态，value=可流转目标状态集合）
export const ORDER_TRANSITION_MAP: Record<OrderStatus, OrderStatus[]> = {
  draft:              ['pending_approval', 'confirmed', 'closed'],
  pending_approval:   ['confirmed', 'draft', 'closed'],
  confirmed:          ['in_production', 'closed'],
  in_production:      ['shipped', 'closed'],
  shipped:            ['completed', 'closed'],
  completed:          [],   // 终态，不可再流转
  closed:             [],   // 终态，不可再流转
};
```

### 9.4 金额计算规范

```typescript
import Decimal from 'decimal.js';

// 行金额计算
const amount = new Decimal(item.quantity).mul(item.unitPrice).toFixed(2);

// 汇总总金额
const totalAmount = items
  .reduce((sum, i) => sum.plus(new Decimal(i.amount)), new Decimal(0))
  .toFixed(2);
```

### 9.5 目录结构规范

```
services/api/src/modules/
  sales-customer/
    customer.entity.ts
    customer-contact.entity.ts
    customer.service.ts
    customer.controller.ts
    customer.routes.ts
  sales-order/
    sales-order.service.ts
    sales-order.controller.ts
    sales-order.routes.ts
```

路由注册位置：`services/api/src/app.ts` 中追加：

```typescript
import salesCustomerRoutes from './modules/sales-customer/customer.routes';
import salesOrderRoutes    from './modules/sales-order/sales-order.routes';

app.use('/api/customers',    salesCustomerRoutes);
app.use('/api/sales-orders', salesOrderRoutes);
```

### 9.6 日志规范

关键操作必须打印结构化日志，格式与现有模块保持一致：

```typescript
// 审批操作日志（便于审计追溯）
console.log(JSON.stringify({
  level: 'info',
  event: 'sales_order.approved',
  tenantId: this.tenantId,
  orderId: id,
  orderNo: order.order_no,
  approvedBy: this.userId,
  timestamp: new Date().toISOString(),
}));
```

---

*文档版本 1.0.0 | 技术架构负责人 tech-lead-architect | 2026-03-12*
