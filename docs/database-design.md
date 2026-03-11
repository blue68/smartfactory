# [artifact:数据库设计] 智造管家 — 数据库设计文档

**产品名称**：智造管家（SmartFactory Agent）
**文档版本**：v1.0
**创建日期**：2026-03-11
**负责人**：@senior-backend-engineer
**输入来源**：架构设计 v1.0、PRD v1.4、用户故事 v1.3

---

## 一、ER 模型概要

### 1.1 核心实体关系

```
tenants (1) ──── (*) users
tenants (1) ──── (*) skus
tenants (1) ──── (*) suppliers

skus (*) ──── (1) sku_categories (一级)
skus (*) ──── (1) sku_categories (二级)
skus (1) ──── (*) sku_unit_conversions
skus (1) ──── (*) inventory
skus (1) ──── (*) inventory_dye_lots

bom_headers (1) ──── (*) bom_items
bom_items (*) ──── (1) skus [子物料]
bom_items (*) ──── (1) bom_headers [父BOM，自引用多层]

suppliers (1) ──── (*) supplier_prices
suppliers (1) ──── (*) purchase_orders

purchase_orders (1) ──── (*) purchase_order_items
purchase_orders (1) ──── (*) delivery_notes
delivery_notes (1) ──── (*) delivery_note_items
purchase_orders (1) ──── (*) purchase_receipts
purchase_orders (1) ──── (1) three_way_match_records

customers (1) ──── (*) sales_orders
sales_orders (1) ──── (*) sales_order_items
sales_orders (1) ──── (1) order_constraint_checks

production_orders (*) ──── (1) sales_orders
production_orders (1) ──── (*) production_schedules
production_orders (1) ──── (*) production_tasks
production_tasks (1) ──── (*) task_completions

inspection_records (*) ──── (1) production_orders
inspection_records (1) ──── (*) quality_issues
quality_issues (1) ──── (*) traceability_records
```

### 1.2 多租户隔离策略

- 所有业务表包含 `tenant_id` 字段（行级隔离）
- 所有查询必须携带 `tenant_id` 过滤条件（通过 BaseRepository 自动注入）
- 租户级别的唯一约束采用复合唯一索引 `(tenant_id, business_key)`

### 1.3 通用字段规范

所有业务实体表包含以下标准字段：
```sql
id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY  -- 主键
tenant_id   BIGINT UNSIGNED NOT NULL                   -- 租户ID（行级隔离）
created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
updated_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
created_by  BIGINT UNSIGNED NOT NULL                   -- 创建人ID
updated_by  BIGINT UNSIGNED NOT NULL                   -- 最后修改人ID
```

---

## 二、建表 SQL

### 2.1 用户与权限模块

```sql
-- ============================================================
-- 租户表
-- ============================================================
CREATE TABLE `tenants` (
  `id`           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '租户主键',
  `name`         VARCHAR(100) NOT NULL COMMENT '租户名称（工厂名称）',
  `code`         VARCHAR(50) NOT NULL COMMENT '租户唯一标识码',
  `plan`         ENUM('trial','standard','premium') NOT NULL DEFAULT 'trial' COMMENT '订阅计划',
  `status`       ENUM('active','suspended','cancelled') NOT NULL DEFAULT 'active' COMMENT '租户状态',
  `contact_name` VARCHAR(50) NOT NULL COMMENT '联系人姓名',
  `contact_phone` VARCHAR(20) NOT NULL COMMENT '联系人电话',
  `contact_email` VARCHAR(100) DEFAULT NULL COMMENT '联系人邮箱',
  `deploy_mode`  ENUM('saas','private') NOT NULL DEFAULT 'saas' COMMENT '部署模式',
  `settings`     JSON DEFAULT NULL COMMENT '租户配置项（阈值等）',
  `expires_at`   DATETIME DEFAULT NULL COMMENT '到期时间（SaaS模式）',
  `created_at`   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='租户表';

-- ============================================================
-- 用户表
-- ============================================================
CREATE TABLE `users` (
  `id`           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '用户主键',
  `tenant_id`    BIGINT UNSIGNED NOT NULL COMMENT '所属租户',
  `username`     VARCHAR(50) NOT NULL COMMENT '用户名（登录账号）',
  `password_hash` VARCHAR(255) NOT NULL COMMENT '密码哈希（bcrypt）',
  `real_name`    VARCHAR(50) NOT NULL COMMENT '真实姓名',
  `phone`        VARCHAR(20) DEFAULT NULL COMMENT '手机号',
  `wechat_openid` VARCHAR(100) DEFAULT NULL COMMENT '微信OpenID（小程序绑定）',
  `status`       ENUM('active','inactive','locked') NOT NULL DEFAULT 'active' COMMENT '账号状态',
  `last_login_at` DATETIME DEFAULT NULL COMMENT '最后登录时间',
  `created_at`   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by`   BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_by`   BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_username` (`tenant_id`, `username`),
  UNIQUE KEY `uk_wechat_openid` (`wechat_openid`),
  KEY `idx_tenant_id` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户表';

-- ============================================================
-- 角色表
-- ============================================================
CREATE TABLE `roles` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '角色主键',
  `tenant_id`   BIGINT UNSIGNED NOT NULL COMMENT '所属租户（0表示系统预置）',
  `code`        VARCHAR(50) NOT NULL COMMENT '角色编码（boss/purchaser/warehouse/supervisor/worker/qc/sales）',
  `name`        VARCHAR(50) NOT NULL COMMENT '角色名称',
  `description` VARCHAR(200) DEFAULT NULL COMMENT '角色描述',
  `permissions` JSON NOT NULL COMMENT '权限列表（JSON数组）',
  `is_system`   TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否系统预置角色',
  `created_at`  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by`  BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_by`  BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_code` (`tenant_id`, `code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='角色表';

-- ============================================================
-- 用户角色关联表
-- ============================================================
CREATE TABLE `user_roles` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`  BIGINT UNSIGNED NOT NULL COMMENT '所属租户',
  `user_id`    BIGINT UNSIGNED NOT NULL COMMENT '用户ID',
  `role_id`    BIGINT UNSIGNED NOT NULL COMMENT '角色ID',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_by` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_role` (`user_id`, `role_id`),
  KEY `idx_tenant_user` (`tenant_id`, `user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户角色关联表';
```

### 2.2 基础数据模块

```sql
-- ============================================================
-- SKU分类表（支持一级+二级两级分类）
-- ============================================================
CREATE TABLE `sku_categories` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '分类主键',
  `tenant_id`   BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '租户ID（0为系统预置）',
  `level`       TINYINT NOT NULL COMMENT '分类级别（1=一级，2=二级）',
  `parent_id`   BIGINT UNSIGNED DEFAULT NULL COMMENT '父分类ID（一级分类为NULL）',
  `code`        VARCHAR(50) NOT NULL COMMENT '分类编码',
  `name`        VARCHAR(50) NOT NULL COMMENT '分类名称',
  `sort_order`  INT NOT NULL DEFAULT 0 COMMENT '排序权重',
  `is_active`   TINYINT(1) NOT NULL DEFAULT 1 COMMENT '是否启用',
  `created_at`  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by`  BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_by`  BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_code` (`code`),
  KEY `idx_parent_id` (`parent_id`),
  KEY `idx_level` (`level`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='SKU分类表（两级）';

-- 预置分类数据
INSERT INTO `sku_categories` (`id`,`tenant_id`,`level`,`parent_id`,`code`,`name`,`sort_order`) VALUES
-- 一级分类
(1, 0, 1, NULL, 'RAW_MATERIAL',  '原材料', 1),
(2, 0, 1, NULL, 'SEMI_FINISHED', '半成品',  2),
(3, 0, 1, NULL, 'FINISHED',      '成品',   3),
-- 原材料二级分类
(10, 0, 2, 1, 'BOARD',      '板材类',   1),
(11, 0, 2, 1, 'HARDWARE',   '五金类',   2),
(12, 0, 2, 1, 'FABRIC',     '面料类',   3),
(13, 0, 2, 1, 'SPONGE',     '海绵类',   4),
(14, 0, 2, 1, 'PAINT',      '油漆涂料类', 5),
(15, 0, 2, 1, 'ADHESIVE',   '胶粘剂类', 6),
(16, 0, 2, 1, 'PACKAGING',  '包装材料类', 7),
(17, 0, 2, 1, 'OTHER_AUX',  '其他辅料', 8),
-- 半成品二级分类
(20, 0, 2, 2, 'FRAME',      '框架类',   1),
(21, 0, 2, 2, 'COVER',      '面套类',   2),
(22, 0, 2, 2, 'ASSEMBLY',   '组合件类', 3),
-- 成品二级分类
(30, 0, 2, 3, 'SOFA',       '沙发类',   1),
(31, 0, 2, 3, 'CABINET',    '柜类',     2),
(32, 0, 2, 3, 'TABLE',      '桌类',     3),
(33, 0, 2, 3, 'BED',        '床类',     4),
(34, 0, 2, 3, 'OTHER_CUSTOM','其他定制品', 5);

-- ============================================================
-- SKU主数据表
-- ============================================================
CREATE TABLE `skus` (
  `id`                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'SKU主键',
  `tenant_id`           BIGINT UNSIGNED NOT NULL COMMENT '所属租户',
  `sku_code`            VARCHAR(50) NOT NULL COMMENT 'SKU内部编码（系统自动生成）',
  `barcode`             VARCHAR(100) DEFAULT NULL COMMENT '条码/二维码（打印标签用）',
  `name`                VARCHAR(200) NOT NULL COMMENT 'SKU名称',
  `spec`                VARCHAR(500) DEFAULT NULL COMMENT '规格描述',
  `category1_id`        BIGINT UNSIGNED NOT NULL COMMENT '一级分类ID',
  `category2_id`        BIGINT UNSIGNED NOT NULL COMMENT '二级分类ID',
  `stock_unit`          VARCHAR(20) NOT NULL COMMENT '库存单位（库存维度）',
  `purchase_unit`       VARCHAR(20) NOT NULL COMMENT '采购单位',
  `production_unit`     VARCHAR(20) NOT NULL COMMENT '生产领用单位',
  `has_dye_lot`         TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否启用缸号管理（面料类必须为1）',
  `safety_stock`        DECIMAL(12,4) NOT NULL DEFAULT 0 COMMENT '安全库存（库存单位）',
  `status`              ENUM('active','inactive') NOT NULL DEFAULT 'active' COMMENT '状态',
  `description`         TEXT DEFAULT NULL COMMENT '备注',
  `created_at`          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by`          BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_by`          BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_sku_code` (`tenant_id`, `sku_code`),
  KEY `idx_tenant_id` (`tenant_id`),
  KEY `idx_category1` (`tenant_id`, `category1_id`),
  KEY `idx_category2` (`tenant_id`, `category2_id`),
  KEY `idx_has_dye_lot` (`tenant_id`, `has_dye_lot`),
  FULLTEXT KEY `ft_name_spec` (`name`, `spec`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='SKU主数据表';

-- ============================================================
-- SKU单位换算关系表
-- ============================================================
CREATE TABLE `sku_unit_conversions` (
  `id`             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `tenant_id`      BIGINT UNSIGNED NOT NULL COMMENT '所属租户',
  `sku_id`         BIGINT UNSIGNED NOT NULL COMMENT 'SKU ID',
  `from_unit`      VARCHAR(20) NOT NULL COMMENT '来源单位',
  `to_unit`        VARCHAR(20) NOT NULL COMMENT '目标单位（通常为库存单位）',
  `conversion_rate` DECIMAL(10,6) NOT NULL COMMENT '换算系数（from_unit * rate = to_unit）',
  `description`    VARCHAR(100) DEFAULT NULL COMMENT '换算说明（如"1箱=50个"）',
  `created_at`     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by`     BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_by`     BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_sku_unit_pair` (`tenant_id`, `sku_id`, `from_unit`, `to_unit`),
  KEY `idx_sku_id` (`sku_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='SKU单位换算关系表';

-- ============================================================
-- 供应商表（A/B/C三级分级）
-- ============================================================
CREATE TABLE `suppliers` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '供应商主键',
  `tenant_id`       BIGINT UNSIGNED NOT NULL COMMENT '所属租户',
  `supplier_code`   VARCHAR(50) NOT NULL COMMENT '供应商编码',
  `name`            VARCHAR(200) NOT NULL COMMENT '供应商名称',
  `grade`           ENUM('A','B','C') NOT NULL DEFAULT 'C' COMMENT '供应商等级（A优先/B备选/C临时）',
  `contact_name`    VARCHAR(50) DEFAULT NULL COMMENT '联系人',
  `contact_phone`   VARCHAR(20) DEFAULT NULL COMMENT '联系电话',
  `contact_wechat`  VARCHAR(100) DEFAULT NULL COMMENT '微信号',
  `payment_days`    INT NOT NULL DEFAULT 0 COMMENT '账期（天）',
  `lead_time_days`  INT NOT NULL DEFAULT 7 COMMENT '交货周期（天）',
  `main_skus`       JSON DEFAULT NULL COMMENT '主供SKU ID列表',
  `status`          ENUM('active','inactive') NOT NULL DEFAULT 'active' COMMENT '状态',
  `on_time_rate`    DECIMAL(5,2) DEFAULT NULL COMMENT '准时交货率（%，缓存统计值）',
  `quality_pass_rate` DECIMAL(5,2) DEFAULT NULL COMMENT '质量合格率（%，缓存统计值）',
  `notes`           TEXT DEFAULT NULL COMMENT '备注',
  `created_at`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by`      BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_by`      BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_supplier_code` (`tenant_id`, `supplier_code`),
  KEY `idx_tenant_id` (`tenant_id`),
  KEY `idx_grade` (`tenant_id`, `grade`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='供应商表';

-- ============================================================
-- 供应商价格协议表（按批次/时间段维护价格）
-- ============================================================
CREATE TABLE `supplier_prices` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `tenant_id`       BIGINT UNSIGNED NOT NULL COMMENT '所属租户',
  `supplier_id`     BIGINT UNSIGNED NOT NULL COMMENT '供应商ID',
  `sku_id`          BIGINT UNSIGNED NOT NULL COMMENT 'SKU ID',
  `price`           DECIMAL(12,2) NOT NULL COMMENT '价格（元/采购单位）',
  `purchase_unit`   VARCHAR(20) NOT NULL COMMENT '价格对应采购单位',
  `min_order_qty`   DECIMAL(12,4) DEFAULT NULL COMMENT '最小起订量',
  `price_type`      ENUM('period','batch') NOT NULL DEFAULT 'period' COMMENT '价格类型（时间段/批次）',
  `effective_from`  DATE NOT NULL COMMENT '生效开始日期',
  `effective_to`    DATE DEFAULT NULL COMMENT '生效结束日期（NULL表示长期有效）',
  `batch_no`        VARCHAR(50) DEFAULT NULL COMMENT '批次号（price_type=batch时使用）',
  `is_current`      TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否当前有效价格（冗余字段，加速查询）',
  `created_at`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by`      BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_by`      BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_supplier_sku` (`tenant_id`, `supplier_id`, `sku_id`),
  KEY `idx_sku_current` (`tenant_id`, `sku_id`, `is_current`),
  KEY `idx_effective_period` (`effective_from`, `effective_to`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='供应商价格协议表';

-- ============================================================
-- BOM表头（一个成品/半成品对应一个BOM）
-- ============================================================
CREATE TABLE `bom_headers` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'BOM主键',
  `tenant_id`   BIGINT UNSIGNED NOT NULL COMMENT '所属租户',
  `sku_id`      BIGINT UNSIGNED NOT NULL COMMENT '产品SKU ID（成品或半成品）',
  `version`     VARCHAR(20) NOT NULL DEFAULT '1.0' COMMENT 'BOM版本',
  `status`      ENUM('draft','active','archived') NOT NULL DEFAULT 'draft' COMMENT 'BOM状态',
  `description` TEXT DEFAULT NULL COMMENT '备注',
  `created_at`  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by`  BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_by`  BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_tenant_sku` (`tenant_id`, `sku_id`),
  KEY `idx_tenant_status` (`tenant_id`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='BOM表头';

-- ============================================================
-- BOM明细表（支持多层嵌套：父BOM引用子BOM）
-- ============================================================
CREATE TABLE `bom_items` (
  `id`               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'BOM明细主键',
  `tenant_id`        BIGINT UNSIGNED NOT NULL COMMENT '所属租户',
  `bom_header_id`    BIGINT UNSIGNED NOT NULL COMMENT '所属BOM表头ID',
  `parent_item_id`   BIGINT UNSIGNED DEFAULT NULL COMMENT '父BOM明细ID（NULL=第一层）',
  `component_sku_id` BIGINT UNSIGNED NOT NULL COMMENT '子物料SKU ID',
  `quantity`         DECIMAL(12,4) NOT NULL COMMENT '用量（生产领用单位）',
  `unit`             VARCHAR(20) NOT NULL COMMENT '用量单位（生产领用单位）',
  `level`            TINYINT NOT NULL DEFAULT 1 COMMENT '层级（1=第一层，2=第二层...）',
  `sort_order`       INT NOT NULL DEFAULT 0 COMMENT '同层排序',
  `scrap_rate`       DECIMAL(5,4) NOT NULL DEFAULT 0 COMMENT '损耗率（小数，如0.05表示5%）',
  `notes`            VARCHAR(500) DEFAULT NULL COMMENT '备注',
  `created_at`       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by`       BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_by`       BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_bom_header` (`bom_header_id`),
  KEY `idx_parent_item` (`parent_item_id`),
  KEY `idx_component_sku` (`component_sku_id`),
  KEY `idx_tenant_bom` (`tenant_id`, `bom_header_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='BOM明细表（多层嵌套）';

-- ============================================================
-- 工序模板表
-- ============================================================
CREATE TABLE `process_templates` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '模板主键',
  `tenant_id`   BIGINT UNSIGNED NOT NULL COMMENT '所属租户',
  `sku_id`      BIGINT UNSIGNED NOT NULL COMMENT '适用产品SKU ID',
  `name`        VARCHAR(100) NOT NULL COMMENT '模板名称',
  `version`     VARCHAR(20) NOT NULL DEFAULT '1.0' COMMENT '版本',
  `status`      ENUM('draft','active','archived') NOT NULL DEFAULT 'draft' COMMENT '状态',
  `description` TEXT DEFAULT NULL COMMENT '说明',
  `created_at`  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by`  BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_by`  BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_tenant_sku` (`tenant_id`, `sku_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='工序模板表';

-- ============================================================
-- 工序步骤表
-- ============================================================
CREATE TABLE `process_steps` (
  `id`                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '工序步骤主键',
  `tenant_id`           BIGINT UNSIGNED NOT NULL COMMENT '所属租户',
  `template_id`         BIGINT UNSIGNED NOT NULL COMMENT '所属模板ID',
  `step_no`             INT NOT NULL COMMENT '工序序号',
  `step_name`           VARCHAR(100) NOT NULL COMMENT '工序名称',
  `standard_hours`      DECIMAL(8,2) DEFAULT NULL COMMENT '标准工时（小时）',
  `required_skill`      VARCHAR(100) DEFAULT NULL COMMENT '所需技能描述',
  `workstation_type`    VARCHAR(50) DEFAULT NULL COMMENT '工作站类型',
  `description`         TEXT DEFAULT NULL COMMENT '工序描述',
  `created_at`          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by`          BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_by`          BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_template_id` (`template_id`),
  UNIQUE KEY `uk_template_step` (`template_id`, `step_no`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='工序步骤表';

-- ============================================================
-- 工作站表
-- ============================================================
CREATE TABLE `workstations` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '工作站主键',
  `tenant_id`   BIGINT UNSIGNED NOT NULL COMMENT '所属租户',
  `code`        VARCHAR(50) NOT NULL COMMENT '工作站编码',
  `name`        VARCHAR(100) NOT NULL COMMENT '工作站名称',
  `type`        VARCHAR(50) NOT NULL COMMENT '工作站类型（裁切/缝纫/组装等）',
  `capacity`    INT NOT NULL DEFAULT 1 COMMENT '日产能（件/天）',
  `status`      ENUM('active','maintenance','inactive') NOT NULL DEFAULT 'active' COMMENT '状态',
  `created_at`  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by`  BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_by`  BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_code` (`tenant_id`, `code`),
  KEY `idx_tenant_id` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='工作站表';
```

### 2.3 库存管理模块

```sql
-- ============================================================
-- 库存主表（快照，每个SKU一条记录）
-- ============================================================
CREATE TABLE `inventory` (
  `id`               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `tenant_id`        BIGINT UNSIGNED NOT NULL COMMENT '所属租户',
  `sku_id`           BIGINT UNSIGNED NOT NULL COMMENT 'SKU ID',
  `qty_on_hand`      DECIMAL(12,4) NOT NULL DEFAULT 0 COMMENT '在库数量（库存单位）',
  `qty_reserved`     DECIMAL(12,4) NOT NULL DEFAULT 0 COMMENT '已预留数量（被生产订单占用）',
  `qty_in_transit`   DECIMAL(12,4) NOT NULL DEFAULT 0 COMMENT '在途数量（已下PO未到货）',
  `qty_available`    DECIMAL(12,4) GENERATED ALWAYS AS (`qty_on_hand` - `qty_reserved`) STORED COMMENT '可用数量（虚拟列）',
  `last_in_at`       DATETIME DEFAULT NULL COMMENT '最后入库时间',
  `last_out_at`      DATETIME DEFAULT NULL COMMENT '最后出库时间',
  `updated_at`       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_sku` (`tenant_id`, `sku_id`),
  KEY `idx_tenant_id` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='库存主表（实时快照）';

-- ============================================================
-- 缸号批次库存表（面料/皮料类SKU专用）
-- ============================================================
CREATE TABLE `inventory_dye_lots` (
  `id`             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `tenant_id`      BIGINT UNSIGNED NOT NULL COMMENT '所属租户',
  `sku_id`         BIGINT UNSIGNED NOT NULL COMMENT 'SKU ID',
  `dye_lot_no`     VARCHAR(50) NOT NULL COMMENT '缸号',
  `qty_on_hand`    DECIMAL(12,4) NOT NULL DEFAULT 0 COMMENT '该缸号在库数量（库存单位）',
  `qty_reserved`   DECIMAL(12,4) NOT NULL DEFAULT 0 COMMENT '已预留数量',
  `first_in_at`    DATETIME NOT NULL COMMENT '首次入库时间（用于先进先出排序）',
  `last_in_at`     DATETIME NOT NULL COMMENT '最后入库时间',
  `status`         ENUM('active','archived') NOT NULL DEFAULT 'active' COMMENT '状态（数量耗尽后归档）',
  `created_at`     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_sku_dyelot` (`tenant_id`, `sku_id`, `dye_lot_no`),
  KEY `idx_sku_fifo` (`tenant_id`, `sku_id`, `first_in_at`),
  KEY `idx_status` (`tenant_id`, `sku_id`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='缸号批次库存表';

-- ============================================================
-- 出入库流水表（不可删除，只能申请撤销）
-- ============================================================
CREATE TABLE `inventory_transactions` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '流水主键',
  `tenant_id`       BIGINT UNSIGNED NOT NULL COMMENT '所属租户',
  `transaction_no`  VARCHAR(50) NOT NULL COMMENT '流水单号',
  `sku_id`          BIGINT UNSIGNED NOT NULL COMMENT 'SKU ID',
  `transaction_type` ENUM('PURCHASE_IN','PRODUCTION_IN','ADJUSTMENT_IN',
                          'MATERIAL_OUT','DELIVERY_OUT','ADJUSTMENT_OUT',
                          'TRANSFER','STOCKTAKE_ADJUST') NOT NULL COMMENT '流水类型',
  `direction`       ENUM('IN','OUT') NOT NULL COMMENT '方向',
  `qty_input`       DECIMAL(12,4) NOT NULL COMMENT '录入数量',
  `input_unit`      VARCHAR(20) NOT NULL COMMENT '录入单位',
  `qty_stock_unit`  DECIMAL(12,4) NOT NULL COMMENT '换算后库存单位数量',
  `stock_unit`      VARCHAR(20) NOT NULL COMMENT '库存单位',
  `dye_lot_no`      VARCHAR(50) DEFAULT NULL COMMENT '缸号（面料类必填）',
  `reference_type`  VARCHAR(50) DEFAULT NULL COMMENT '关联单据类型（purchase_order/sales_order/production_order）',
  `reference_id`    BIGINT UNSIGNED DEFAULT NULL COMMENT '关联单据ID',
  `reference_no`    VARCHAR(50) DEFAULT NULL COMMENT '关联单据号',
  `batch_cost`      DECIMAL(12,2) DEFAULT NULL COMMENT '批次成本（入库时记录）',
  `status`          ENUM('active','cancelled') NOT NULL DEFAULT 'active' COMMENT '状态',
  `cancelled_at`    DATETIME DEFAULT NULL COMMENT '撤销时间',
  `cancel_reason`   VARCHAR(500) DEFAULT NULL COMMENT '撤销原因',
  `notes`           VARCHAR(500) DEFAULT NULL COMMENT '备注',
  `is_cross_dye_lot` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否跨缸号操作（面料类警告标记）',
  `created_at`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_by`      BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_transaction_no` (`tenant_id`, `transaction_no`),
  KEY `idx_tenant_sku` (`tenant_id`, `sku_id`),
  KEY `idx_reference` (`reference_type`, `reference_id`),
  KEY `idx_created_at` (`tenant_id`, `created_at`),
  KEY `idx_dye_lot` (`tenant_id`, `sku_id`, `dye_lot_no`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='出入库流水表';

-- ============================================================
-- 领料申请表
-- ============================================================
CREATE TABLE `material_requisitions` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `tenant_id`       BIGINT UNSIGNED NOT NULL COMMENT '所属租户',
  `requisition_no`  VARCHAR(50) NOT NULL COMMENT '领料单号',
  `production_order_id` BIGINT UNSIGNED NOT NULL COMMENT '关联生产工单ID',
  `status`          ENUM('pending','partial','fulfilled','rejected') NOT NULL DEFAULT 'pending',
  `requested_by`    BIGINT UNSIGNED NOT NULL COMMENT '申请人（车间主管）',
  `fulfilled_by`    BIGINT UNSIGNED DEFAULT NULL COMMENT '发料人（仓管）',
  `notes`           TEXT DEFAULT NULL COMMENT '备注',
  `created_at`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by`      BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_by`      BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_req_no` (`tenant_id`, `requisition_no`),
  KEY `idx_production_order` (`production_order_id`),
  KEY `idx_tenant_status` (`tenant_id`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='领料申请表';

-- ============================================================
-- 领料申请明细表
-- ============================================================
CREATE TABLE `material_requisition_items` (
  `id`               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `tenant_id`        BIGINT UNSIGNED NOT NULL COMMENT '所属租户',
  `requisition_id`   BIGINT UNSIGNED NOT NULL COMMENT '领料申请ID',
  `sku_id`           BIGINT UNSIGNED NOT NULL COMMENT 'SKU ID',
  `requested_qty`    DECIMAL(12,4) NOT NULL COMMENT '申请数量',
  `request_unit`     VARCHAR(20) NOT NULL COMMENT '申请单位',
  `actual_qty`       DECIMAL(12,4) DEFAULT NULL COMMENT '实际发料数量',
  `dye_lot_no`       VARCHAR(50) DEFAULT NULL COMMENT '指定缸号',
  `is_cross_dye_lot` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否跨缸号',
  `cross_dye_reason` VARCHAR(500) DEFAULT NULL COMMENT '跨缸号原因',
  `status`           ENUM('pending','fulfilled','partial','rejected') NOT NULL DEFAULT 'pending',
  `created_at`       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by`       BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_by`       BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_requisition_id` (`requisition_id`),
  KEY `idx_sku_id` (`sku_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='领料申请明细表';
```

### 2.4 采购管理模块

```sql
-- ============================================================
-- AI采购建议表
-- ============================================================
CREATE TABLE `purchase_suggestions` (
  `id`                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `tenant_id`         BIGINT UNSIGNED NOT NULL COMMENT '所属租户',
  `suggestion_no`     VARCHAR(50) NOT NULL COMMENT '建议单号',
  `sku_id`            BIGINT UNSIGNED NOT NULL COMMENT '物料SKU ID',
  `suggested_supplier_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '推荐供应商ID',
  `suggested_qty`     DECIMAL(12,4) NOT NULL COMMENT '建议采购数量（采购单位）',
  `purchase_unit`     VARCHAR(20) NOT NULL COMMENT '采购单位',
  `estimated_price`   DECIMAL(12,2) DEFAULT NULL COMMENT '预估单价',
  `estimated_amount`  DECIMAL(12,2) DEFAULT NULL COMMENT '预估总金额',
  `shortage_qty`      DECIMAL(12,4) NOT NULL COMMENT '缺口数量',
  `reason`            TEXT NOT NULL COMMENT 'AI建议原因（中文说明）',
  `confidence`        ENUM('high','medium','low') NOT NULL DEFAULT 'medium' COMMENT '置信度',
  `confidence_detail` TEXT DEFAULT NULL COMMENT '置信度说明',
  `dye_lot_requirement` VARCHAR(200) DEFAULT NULL COMMENT '缸号要求说明（面料类）',
  `status`            ENUM('pending','approved','rejected','executed','expired')
                      NOT NULL DEFAULT 'pending' COMMENT '审批状态',
  `approved_by`       BIGINT UNSIGNED DEFAULT NULL COMMENT '审批人',
  `approved_at`       DATETIME DEFAULT NULL COMMENT '审批时间',
  `reject_reason`     TEXT DEFAULT NULL COMMENT '驳回原因',
  `expired_at`        DATETIME DEFAULT NULL COMMENT '建议过期时间',
  `created_at`        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by`        BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_by`        BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_suggestion_no` (`tenant_id`, `suggestion_no`),
  KEY `idx_tenant_status` (`tenant_id`, `status`),
  KEY `idx_sku_id` (`sku_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AI采购建议表';

-- ============================================================
-- 采购订单表（PO）
-- ============================================================
CREATE TABLE `purchase_orders` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'PO主键',
  `tenant_id`       BIGINT UNSIGNED NOT NULL COMMENT '所属租户',
  `po_no`           VARCHAR(50) NOT NULL COMMENT '采购订单号',
  `supplier_id`     BIGINT UNSIGNED NOT NULL COMMENT '供应商ID',
  `suggestion_id`   BIGINT UNSIGNED DEFAULT NULL COMMENT '来源采购建议ID',
  `status`          ENUM('draft','confirmed','partial_received','received','cancelled')
                    NOT NULL DEFAULT 'draft' COMMENT 'PO状态',
  `total_amount`    DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT 'PO总金额',
  `expected_date`   DATE DEFAULT NULL COMMENT '预期到货日期',
  `notes`           TEXT DEFAULT NULL COMMENT '备注',
  `created_at`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by`      BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_by`      BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_po_no` (`tenant_id`, `po_no`),
  KEY `idx_supplier_id` (`supplier_id`),
  KEY `idx_tenant_status` (`tenant_id`, `status`),
  KEY `idx_suggestion_id` (`suggestion_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='采购订单表（PO）';

-- ============================================================
-- 采购订单明细
-- ============================================================
CREATE TABLE `purchase_order_items` (
  `id`             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `tenant_id`      BIGINT UNSIGNED NOT NULL COMMENT '所属租户',
  `po_id`          BIGINT UNSIGNED NOT NULL COMMENT 'PO ID',
  `sku_id`         BIGINT UNSIGNED NOT NULL COMMENT 'SKU ID',
  `qty_ordered`    DECIMAL(12,4) NOT NULL COMMENT '订购数量（采购单位）',
  `qty_received`   DECIMAL(12,4) NOT NULL DEFAULT 0 COMMENT '累计到货数量',
  `purchase_unit`  VARCHAR(20) NOT NULL COMMENT '采购单位',
  `unit_price`     DECIMAL(12,2) NOT NULL COMMENT '单价',
  `amount`         DECIMAL(12,2) NOT NULL COMMENT '金额',
  `created_at`     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by`     BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_by`     BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_po_id` (`po_id`),
  KEY `idx_sku_id` (`sku_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='采购订单明细';

-- ============================================================
-- 送货单表（供应商送货单）
-- ============================================================
CREATE TABLE `delivery_notes` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `tenant_id`       BIGINT UNSIGNED NOT NULL COMMENT '所属租户',
  `delivery_no`     VARCHAR(50) NOT NULL COMMENT '送货单号',
  `po_id`           BIGINT UNSIGNED NOT NULL COMMENT '关联PO ID',
  `supplier_id`     BIGINT UNSIGNED NOT NULL COMMENT '供应商ID',
  `delivery_date`   DATE NOT NULL COMMENT '送货日期',
  `status`          ENUM('pending','received','rejected') NOT NULL DEFAULT 'pending',
  `notes`           TEXT DEFAULT NULL COMMENT '备注',
  `created_at`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by`      BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_by`      BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_delivery_no` (`tenant_id`, `delivery_no`),
  KEY `idx_po_id` (`po_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='送货单表';

-- ============================================================
-- 送货单明细
-- ============================================================
CREATE TABLE `delivery_note_items` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `tenant_id`       BIGINT UNSIGNED NOT NULL COMMENT '所属租户',
  `delivery_note_id` BIGINT UNSIGNED NOT NULL COMMENT '送货单ID',
  `sku_id`          BIGINT UNSIGNED NOT NULL COMMENT 'SKU ID',
  `qty_delivered`   DECIMAL(12,4) NOT NULL COMMENT '送货数量（采购单位）',
  `purchase_unit`   VARCHAR(20) NOT NULL COMMENT '采购单位',
  `unit_price`      DECIMAL(12,2) NOT NULL COMMENT '单价',
  `amount`          DECIMAL(12,2) NOT NULL COMMENT '金额',
  `created_at`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by`      BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_by`      BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_delivery_note_id` (`delivery_note_id`),
  KEY `idx_sku_id` (`sku_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='送货单明细';

-- ============================================================
-- 采购入库单表
-- ============================================================
CREATE TABLE `purchase_receipts` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `tenant_id`       BIGINT UNSIGNED NOT NULL COMMENT '所属租户',
  `receipt_no`      VARCHAR(50) NOT NULL COMMENT '入库单号',
  `po_id`           BIGINT UNSIGNED NOT NULL COMMENT '关联PO ID',
  `delivery_note_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '关联送货单ID',
  `receipt_date`    DATE NOT NULL COMMENT '入库日期',
  `status`          ENUM('pending','confirmed') NOT NULL DEFAULT 'pending',
  `notes`           TEXT DEFAULT NULL COMMENT '备注',
  `created_at`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by`      BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_by`      BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_receipt_no` (`tenant_id`, `receipt_no`),
  KEY `idx_po_id` (`po_id`),
  KEY `idx_delivery_note_id` (`delivery_note_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='采购入库单表';

-- ============================================================
-- 三单匹配记录表（PO-送货单-入库单）
-- ============================================================
CREATE TABLE `three_way_match_records` (
  `id`                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `tenant_id`         BIGINT UNSIGNED NOT NULL COMMENT '所属租户',
  `po_id`             BIGINT UNSIGNED NOT NULL COMMENT 'PO ID',
  `delivery_note_id`  BIGINT UNSIGNED NOT NULL COMMENT '送货单ID',
  `receipt_id`        BIGINT UNSIGNED NOT NULL COMMENT '入库单ID',
  `match_status`      ENUM('matched','qty_diff','price_diff','price_warning','pending')
                      NOT NULL DEFAULT 'pending' COMMENT '匹配状态',
  `qty_diff_detail`   JSON DEFAULT NULL COMMENT '数量差异明细',
  `price_diff_detail` JSON DEFAULT NULL COMMENT '价格差异明细',
  `confirmed_by`      BIGINT UNSIGNED DEFAULT NULL COMMENT '确认人',
  `confirmed_at`      DATETIME DEFAULT NULL COMMENT '确认时间',
  `diff_reason`       ENUM('supplier_short','receipt_miss','price_adjust','other') DEFAULT NULL,
  `diff_notes`        TEXT DEFAULT NULL COMMENT '差异说明',
  `created_at`        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by`        BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_by`        BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_po_dn_receipt` (`po_id`, `delivery_note_id`, `receipt_id`),
  KEY `idx_tenant_status` (`tenant_id`, `match_status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='三单匹配记录表';
```

### 2.5 销售订单模块

```sql
-- ============================================================
-- 销售客户表
-- ============================================================
CREATE TABLE `customers` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '客户主键',
  `tenant_id`       BIGINT UNSIGNED NOT NULL COMMENT '所属租户',
  `customer_code`   VARCHAR(50) NOT NULL COMMENT '客户编码',
  `name`            VARCHAR(200) NOT NULL COMMENT '客户名称',
  `contact_name`    VARCHAR(50) DEFAULT NULL COMMENT '联系人',
  `contact_phone`   VARCHAR(20) DEFAULT NULL COMMENT '联系电话',
  `payment_days`    INT NOT NULL DEFAULT 0 COMMENT '账期（天）',
  `credit_limit`    DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT '信用额度',
  `importance`      ENUM('vip','normal','trial') NOT NULL DEFAULT 'normal' COMMENT '客户重要性',
  `status`          ENUM('active','inactive') NOT NULL DEFAULT 'active' COMMENT '状态',
  `notes`           TEXT DEFAULT NULL COMMENT '备注',
  `created_at`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by`      BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_by`      BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_customer_code` (`tenant_id`, `customer_code`),
  KEY `idx_tenant_id` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='销售客户表';

-- ============================================================
-- 销售订单表
-- ============================================================
CREATE TABLE `sales_orders` (
  `id`                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '销售订单主键',
  `tenant_id`          BIGINT UNSIGNED NOT NULL COMMENT '所属租户',
  `order_no`           VARCHAR(50) NOT NULL COMMENT '订单号',
  `customer_id`        BIGINT UNSIGNED NOT NULL COMMENT '客户ID',
  `order_type`         ENUM('normal','urgent') NOT NULL DEFAULT 'normal' COMMENT '订单类型（常规/紧急插单）',
  `status`             ENUM('pending_approval','confirmed','in_production',
                           'partial_delivered','delivered','cancelled')
                       NOT NULL DEFAULT 'confirmed' COMMENT '订单状态',
  `priority`           INT NOT NULL DEFAULT 50 COMMENT '订单优先级（1-100，越大越优先）',
  `expected_delivery`  DATE NOT NULL COMMENT '期望交期',
  `estimated_delivery` DATE DEFAULT NULL COMMENT '系统预估交期',
  `actual_delivery`    DATE DEFAULT NULL COMMENT '实际完工日期',
  `total_amount`       DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT '订单总金额',
  `constraint_passed`  TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否通过约束检查',
  `approval_status`    ENUM('not_required','pending','approved','rejected','conditional')
                       DEFAULT 'not_required' COMMENT '审批状态',
  `approved_by`        BIGINT UNSIGNED DEFAULT NULL COMMENT '审批人',
  `approved_at`        DATETIME DEFAULT NULL COMMENT '审批时间',
  `approval_notes`     TEXT DEFAULT NULL COMMENT '审批备注（附条件内容）',
  `sales_person_id`    BIGINT UNSIGNED NOT NULL COMMENT '销售人员ID',
  `notes`              TEXT DEFAULT NULL COMMENT '备注',
  `created_at`         DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`         DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by`         BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_by`         BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_order_no` (`tenant_id`, `order_no`),
  KEY `idx_customer_id` (`customer_id`),
  KEY `idx_tenant_status` (`tenant_id`, `status`),
  KEY `idx_tenant_priority` (`tenant_id`, `priority` DESC),
  KEY `idx_expected_delivery` (`tenant_id`, `expected_delivery`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='销售订单表';

-- ============================================================
-- 销售订单明细
-- ============================================================
CREATE TABLE `sales_order_items` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `tenant_id`       BIGINT UNSIGNED NOT NULL COMMENT '所属租户',
  `order_id`        BIGINT UNSIGNED NOT NULL COMMENT '销售订单ID',
  `sku_id`          BIGINT UNSIGNED NOT NULL COMMENT '产品SKU ID（成品）',
  `qty_ordered`     DECIMAL(12,4) NOT NULL COMMENT '订购数量',
  `qty_delivered`   DECIMAL(12,4) NOT NULL DEFAULT 0 COMMENT '已交付数量',
  `unit_price`      DECIMAL(12,2) NOT NULL COMMENT '单价',
  `amount`          DECIMAL(12,2) NOT NULL COMMENT '金额',
  `bom_header_id`   BIGINT UNSIGNED DEFAULT NULL COMMENT '关联BOM ID',
  `created_at`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by`      BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_by`      BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_order_id` (`order_id`),
  KEY `idx_sku_id` (`sku_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='销售订单明细';

-- ============================================================
-- 订单约束检查记录表
-- ============================================================
CREATE TABLE `order_constraint_checks` (
  `id`                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `tenant_id`            BIGINT UNSIGNED NOT NULL COMMENT '所属租户',
  `order_id`             BIGINT UNSIGNED NOT NULL COMMENT '销售订单ID',
  `check_time`           DATETIME NOT NULL COMMENT '检查时间',
  `inventory_turnover_check` JSON DEFAULT NULL COMMENT '库存周转天数检查结果',
  `capital_occupation_check` JSON DEFAULT NULL COMMENT '资金占用检查结果',
  `production_cost_check`    JSON DEFAULT NULL COMMENT '生产成本检查结果',
  `capacity_load_check`      JSON DEFAULT NULL COMMENT '产能负荷检查结果',
  `overall_result`       ENUM('pass','block','warning') NOT NULL COMMENT '综合检查结果',
  `blocked_reasons`      JSON DEFAULT NULL COMMENT '拦截原因列表',
  `impact_analysis`      JSON DEFAULT NULL COMMENT '影响分析（受影响订单、资金变化等）',
  `created_at`           DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_by`           BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_order_id` (`order_id`),
  KEY `idx_tenant_time` (`tenant_id`, `check_time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='订单约束检查记录表';

-- ============================================================
-- 交付记录表
-- ============================================================
CREATE TABLE `delivery_records` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `tenant_id`       BIGINT UNSIGNED NOT NULL COMMENT '所属租户',
  `delivery_no`     VARCHAR(50) NOT NULL COMMENT '出货单号',
  `order_id`        BIGINT UNSIGNED NOT NULL COMMENT '销售订单ID',
  `delivery_date`   DATE NOT NULL COMMENT '出货日期',
  `status`          ENUM('shipped','signed','returned') NOT NULL DEFAULT 'shipped',
  `signed_at`       DATETIME DEFAULT NULL COMMENT '客户签收时间',
  `notes`           TEXT DEFAULT NULL COMMENT '备注',
  `created_at`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by`      BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_by`      BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_delivery_no` (`tenant_id`, `delivery_no`),
  KEY `idx_order_id` (`order_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='交付记录表';
```

### 2.6 生产管理模块

```sql
-- ============================================================
-- 生产工单表
-- ============================================================
CREATE TABLE `production_orders` (
  `id`                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '生产工单主键',
  `tenant_id`         BIGINT UNSIGNED NOT NULL COMMENT '所属租户',
  `work_order_no`     VARCHAR(50) NOT NULL COMMENT '工单号',
  `sales_order_id`    BIGINT UNSIGNED NOT NULL COMMENT '关联销售订单ID',
  `sku_id`            BIGINT UNSIGNED NOT NULL COMMENT '生产产品SKU ID',
  `bom_header_id`     BIGINT UNSIGNED NOT NULL COMMENT '使用BOM ID',
  `process_template_id` BIGINT UNSIGNED NOT NULL COMMENT '使用工序模板ID',
  `qty_planned`       DECIMAL(12,4) NOT NULL COMMENT '计划生产数量',
  `qty_completed`     DECIMAL(12,4) NOT NULL DEFAULT 0 COMMENT '已完工数量',
  `status`            ENUM('pending','scheduled','in_progress','completed','cancelled')
                      NOT NULL DEFAULT 'pending' COMMENT '工单状态',
  `priority`          INT NOT NULL DEFAULT 50 COMMENT '优先级（继承自销售订单）',
  `planned_start`     DATE DEFAULT NULL COMMENT '计划开始日期',
  `planned_end`       DATE DEFAULT NULL COMMENT '计划完工日期',
  `actual_start`      DATETIME DEFAULT NULL COMMENT '实际开始时间',
  `actual_end`        DATETIME DEFAULT NULL COMMENT '实际完工时间',
  `notes`             TEXT DEFAULT NULL COMMENT '备注',
  `created_at`        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by`        BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_by`        BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_work_order_no` (`tenant_id`, `work_order_no`),
  KEY `idx_sales_order_id` (`sales_order_id`),
  KEY `idx_tenant_status` (`tenant_id`, `status`),
  KEY `idx_tenant_priority` (`tenant_id`, `priority` DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='生产工单表';

-- ============================================================
-- 排产计划表
-- ============================================================
CREATE TABLE `production_schedules` (
  `id`                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `tenant_id`            BIGINT UNSIGNED NOT NULL COMMENT '所属租户',
  `schedule_date`        DATE NOT NULL COMMENT '排产日期',
  `production_order_id`  BIGINT UNSIGNED NOT NULL COMMENT '生产工单ID',
  `process_step_id`      BIGINT UNSIGNED NOT NULL COMMENT '工序步骤ID',
  `workstation_id`       BIGINT UNSIGNED DEFAULT NULL COMMENT '工作站ID',
  `worker_id`            BIGINT UNSIGNED DEFAULT NULL COMMENT '分配工人ID',
  `planned_qty`          DECIMAL(12,4) NOT NULL COMMENT '计划产量',
  `status`               ENUM('planned','confirmed','in_progress','completed','skipped')
                         NOT NULL DEFAULT 'planned',
  `ai_generated`         TINYINT(1) NOT NULL DEFAULT 1 COMMENT '是否AI生成',
  `manually_adjusted`    TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否被人工调整',
  `adjust_reason`        VARCHAR(500) DEFAULT NULL COMMENT '调整原因',
  `created_at`           DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`           DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by`           BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_by`           BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_tenant_date` (`tenant_id`, `schedule_date`),
  KEY `idx_production_order` (`production_order_id`),
  KEY `idx_worker_date` (`worker_id`, `schedule_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='排产计划表';

-- ============================================================
-- 工人任务表
-- ============================================================
CREATE TABLE `production_tasks` (
  `id`                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `tenant_id`            BIGINT UNSIGNED NOT NULL COMMENT '所属租户',
  `task_no`              VARCHAR(50) NOT NULL COMMENT '任务单号',
  `schedule_id`          BIGINT UNSIGNED NOT NULL COMMENT '排产计划ID',
  `production_order_id`  BIGINT UNSIGNED NOT NULL COMMENT '生产工单ID',
  `process_step_id`      BIGINT UNSIGNED NOT NULL COMMENT '工序步骤ID',
  `worker_id`            BIGINT UNSIGNED NOT NULL COMMENT '工人ID',
  `task_date`            DATE NOT NULL COMMENT '任务日期',
  `planned_qty`          DECIMAL(12,4) NOT NULL COMMENT '计划数量',
  `completed_qty`        DECIMAL(12,4) NOT NULL DEFAULT 0 COMMENT '完成数量',
  `status`               ENUM('pending','started','completed','abnormal')
                         NOT NULL DEFAULT 'pending',
  `started_at`           DATETIME DEFAULT NULL COMMENT '开始时间',
  `completed_at`         DATETIME DEFAULT NULL COMMENT '完成时间',
  `created_at`           DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`           DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by`           BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_by`           BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_task_no` (`tenant_id`, `task_no`),
  KEY `idx_worker_date` (`worker_id`, `task_date`),
  KEY `idx_production_order` (`production_order_id`),
  KEY `idx_tenant_status` (`tenant_id`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='工人任务表';

-- ============================================================
-- 任务完工记录表
-- ============================================================
CREATE TABLE `task_completions` (
  `id`                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `tenant_id`           BIGINT UNSIGNED NOT NULL COMMENT '所属租户',
  `task_id`             BIGINT UNSIGNED NOT NULL COMMENT '任务ID',
  `completed_qty`       DECIMAL(12,4) NOT NULL COMMENT '完工数量',
  `scrap_qty`           DECIMAL(12,4) NOT NULL DEFAULT 0 COMMENT '损耗数量',
  `scrap_reason`        ENUM('material_defect','operation_error','other') DEFAULT NULL,
  `component_barcode`   VARCHAR(100) DEFAULT NULL COMMENT '部件条码（扫码溯源）',
  `material_lot_ids`    JSON DEFAULT NULL COMMENT '使用的物料批次ID列表',
  `dye_lot_no`          VARCHAR(50) DEFAULT NULL COMMENT '面料缸号（自动从领料记录关联）',
  `notes`               TEXT DEFAULT NULL COMMENT '备注',
  `images`              JSON DEFAULT NULL COMMENT '图片URL列表',
  `created_at`          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_by`          BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_task_id` (`task_id`),
  KEY `idx_component_barcode` (`component_barcode`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='任务完工记录表';

-- ============================================================
-- 订单缸号绑定表（同订单缸号一致性约束）
-- ============================================================
CREATE TABLE `order_dye_lot_bindings` (
  `id`                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `tenant_id`           BIGINT UNSIGNED NOT NULL COMMENT '所属租户',
  `production_order_id` BIGINT UNSIGNED NOT NULL COMMENT '生产工单ID',
  `sku_id`              BIGINT UNSIGNED NOT NULL COMMENT '面料SKU ID',
  `dye_lot_no`          VARCHAR(50) NOT NULL COMMENT '绑定缸号',
  `bound_at`            DATETIME NOT NULL COMMENT '绑定时间（首次领用时）',
  `bound_by`            BIGINT UNSIGNED NOT NULL COMMENT '绑定人',
  `created_at`          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_order_sku` (`production_order_id`, `sku_id`),
  KEY `idx_tenant_order` (`tenant_id`, `production_order_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='订单缸号绑定表';
```

### 2.7 质量溯源模块

```sql
-- ============================================================
-- 验货记录表
-- ============================================================
CREATE TABLE `inspection_records` (
  `id`                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `tenant_id`           BIGINT UNSIGNED NOT NULL COMMENT '所属租户',
  `inspection_no`       VARCHAR(50) NOT NULL COMMENT '验货单号',
  `production_order_id` BIGINT UNSIGNED NOT NULL COMMENT '关联生产工单ID',
  `inspector_id`        BIGINT UNSIGNED NOT NULL COMMENT '验货员ID',
  `inspection_date`     DATE NOT NULL COMMENT '验货日期',
  `qty_inspected`       DECIMAL(12,4) NOT NULL COMMENT '验货数量',
  `qty_passed`          DECIMAL(12,4) NOT NULL DEFAULT 0 COMMENT '合格数量',
  `qty_failed`          DECIMAL(12,4) NOT NULL DEFAULT 0 COMMENT '不合格数量',
  `pass_rate`           DECIMAL(5,2) GENERATED ALWAYS AS (
                          CASE WHEN `qty_inspected` > 0
                               THEN ROUND(`qty_passed` / `qty_inspected` * 100, 2)
                               ELSE 0 END
                        ) STORED COMMENT '合格率（虚拟列）',
  `status`              ENUM('draft','completed') NOT NULL DEFAULT 'draft',
  `notes`               TEXT DEFAULT NULL COMMENT '备注',
  `created_at`          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by`          BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_by`          BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_inspection_no` (`tenant_id`, `inspection_no`),
  KEY `idx_production_order` (`production_order_id`),
  KEY `idx_tenant_date` (`tenant_id`, `inspection_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='验货记录表';

-- ============================================================
-- 质量问题记录表
-- ============================================================
CREATE TABLE `quality_issues` (
  `id`                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `tenant_id`           BIGINT UNSIGNED NOT NULL COMMENT '所属租户',
  `inspection_id`       BIGINT UNSIGNED NOT NULL COMMENT '验货单ID',
  `component_name`      VARCHAR(200) NOT NULL COMMENT '问题部件名称',
  `issue_types`         JSON NOT NULL COMMENT '问题类型列表（外观/尺寸/功能/材质）',
  `severity`            ENUM('minor','normal','severe') NOT NULL COMMENT '严重程度',
  `description`         TEXT DEFAULT NULL COMMENT '问题描述',
  `images`              JSON DEFAULT NULL COMMENT '图片URL列表',
  `created_at`          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by`          BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_by`          BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_inspection_id` (`inspection_id`),
  KEY `idx_tenant_severity` (`tenant_id`, `severity`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='质量问题记录表';

-- ============================================================
-- 溯源链记录表（成品→部件→物料批次→工序→工人）
-- ============================================================
CREATE TABLE `traceability_records` (
  `id`                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `tenant_id`            BIGINT UNSIGNED NOT NULL COMMENT '所属租户',
  `production_order_id`  BIGINT UNSIGNED NOT NULL COMMENT '生产工单ID',
  `task_id`              BIGINT UNSIGNED DEFAULT NULL COMMENT '关联任务ID',
  `component_barcode`    VARCHAR(100) DEFAULT NULL COMMENT '部件条码',
  `component_name`       VARCHAR(200) DEFAULT NULL COMMENT '部件名称',
  `process_step_id`      BIGINT UNSIGNED NOT NULL COMMENT '工序步骤ID',
  `worker_id`            BIGINT UNSIGNED NOT NULL COMMENT '操作工人ID',
  `sku_id`               BIGINT UNSIGNED DEFAULT NULL COMMENT '使用物料SKU ID',
  `dye_lot_no`           VARCHAR(50) DEFAULT NULL COMMENT '面料缸号',
  `lot_id`               BIGINT UNSIGNED DEFAULT NULL COMMENT '物料批次ID（入库流水ID）',
  `operation_time`       DATETIME NOT NULL COMMENT '操作时间',
  `has_scan_record`      TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否有扫码记录',
  `created_at`           DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_by`           BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_production_order` (`production_order_id`),
  KEY `idx_component_barcode` (`component_barcode`),
  KEY `idx_worker_id` (`worker_id`),
  KEY `idx_dye_lot` (`tenant_id`, `dye_lot_no`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='溯源链记录表';
```

### 2.8 通知模块

```sql
-- ============================================================
-- 通知消息表
-- ============================================================
CREATE TABLE `notifications` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `tenant_id`     BIGINT UNSIGNED NOT NULL COMMENT '所属租户',
  `user_id`       BIGINT UNSIGNED NOT NULL COMMENT '接收用户ID',
  `type`          VARCHAR(50) NOT NULL COMMENT '通知类型（shortage_alert/approval_request/task_assigned等）',
  `title`         VARCHAR(200) NOT NULL COMMENT '通知标题',
  `content`       TEXT NOT NULL COMMENT '通知内容',
  `data`          JSON DEFAULT NULL COMMENT '附加数据（跳转参数等）',
  `channel`       ENUM('wechat','in_app','both') NOT NULL DEFAULT 'both' COMMENT '推送渠道',
  `is_read`       TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否已读',
  `read_at`       DATETIME DEFAULT NULL COMMENT '已读时间',
  `sent_at`       DATETIME DEFAULT NULL COMMENT '发送时间',
  `send_status`   ENUM('pending','sent','failed') NOT NULL DEFAULT 'pending',
  `created_at`    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_user_unread` (`user_id`, `is_read`),
  KEY `idx_tenant_type` (`tenant_id`, `type`),
  KEY `idx_created_at` (`tenant_id`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='通知消息表';

-- ============================================================
-- 预警规则表
-- ============================================================
CREATE TABLE `alert_rules` (
  `id`             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `tenant_id`      BIGINT UNSIGNED NOT NULL COMMENT '所属租户',
  `rule_code`      VARCHAR(50) NOT NULL COMMENT '规则编码',
  `rule_name`      VARCHAR(100) NOT NULL COMMENT '规则名称',
  `rule_type`      VARCHAR(50) NOT NULL COMMENT '规则类型',
  `threshold`      JSON NOT NULL COMMENT '阈值配置（JSON）',
  `notify_roles`   JSON NOT NULL COMMENT '通知角色列表',
  `is_enabled`     TINYINT(1) NOT NULL DEFAULT 1 COMMENT '是否启用',
  `created_at`     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by`     BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_by`     BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_rule_code` (`tenant_id`, `rule_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='预警规则表';
```

---

## 三、索引设计说明

### 3.1 索引设计原则

1. **多租户首要原则**：所有高频查询索引以 `tenant_id` 为前缀，防止全表扫描
2. **覆盖索引**：列表查询使用覆盖索引，避免回表
3. **联合唯一**：业务唯一约束使用 `(tenant_id, business_key)` 复合唯一索引
4. **FULLTEXT**：SKU名称和规格字段使用全文索引支持模糊搜索（MySQL FULLTEXT + ngram parser）
5. **生成列索引**：inventory 表的 qty_available 使用 STORED 虚拟列，直接索引

### 3.2 关键查询优化

| 查询场景 | 涉及索引 |
|---|---|
| 获取租户下某分类的SKU列表 | `idx_category2(tenant_id, category2_id)` |
| 按缸号查询面料库存 | `uk_tenant_sku_dyelot(tenant_id, sku_id, dye_lot_no)` |
| 先进先出出库推荐 | `idx_sku_fifo(tenant_id, sku_id, first_in_at)` |
| 查询工人当日任务 | `idx_worker_date(worker_id, task_date)` |
| 订单优先级排产 | `idx_tenant_priority(tenant_id, priority DESC)` |
| 三单匹配查询 | `idx_po_id(po_id)` on delivery_notes + purchase_receipts |
| SKU全文搜索 | `ft_name_spec(name, spec)` |
| 溯源链查询 | `idx_production_order(production_order_id)` + `idx_component_barcode` |

### 3.3 分区策略（数据量增长后）

当 `inventory_transactions` 超过500万行时，按 `created_at` 按月分区：

```sql
ALTER TABLE `inventory_transactions` PARTITION BY RANGE (YEAR(created_at) * 100 + MONTH(created_at)) (
  PARTITION p202601 VALUES LESS THAN (202602),
  PARTITION p202602 VALUES LESS THAN (202603),
  -- ...
  PARTITION p_future VALUES LESS THAN MAXVALUE
);
```

---

## 四、关键业务约束说明

### 4.1 面料缸号约束
- `skus.has_dye_lot = 1` 时，所有入库/出库操作必须填写 `dye_lot_no`
- `order_dye_lot_bindings` 记录每个生产工单对每种面料SKU绑定的基准缸号
- 领料时系统查询 `order_dye_lot_bindings`，若已有绑定缸号，选择不同缸号须记录 `is_cross_dye_lot=1`

### 4.2 BOM循环引用防护
- `bom_items.level` 最大深度限制为10层（应用层校验）
- 新增BOM明细时，递归检查祖先链，若发现 `component_sku_id` 已在祖先链中则拒绝

### 4.3 库存并发控制
- 所有库存扣减操作通过 Redis 分布式锁串行化：`lock:inventory:{tenantId}:{skuId}`
- MySQL UPDATE 使用乐观锁：`WHERE qty_on_hand >= :qty AND id = :id`

### 4.4 价格有效期管理
- `supplier_prices.is_current = 1` 由触发器或应用层维护
- 查询当前有效价格：`WHERE tenant_id=? AND sku_id=? AND effective_from <= CURDATE() AND (effective_to IS NULL OR effective_to >= CURDATE())`

### 4.5 流水不可删除
- `inventory_transactions` 无 DELETE 权限，只能更新 `status='cancelled'`
- 撤销需上级审批后记录 `cancelled_at` 和 `cancel_reason`
