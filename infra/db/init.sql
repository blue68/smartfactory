-- ─────────────────────────────────────────────────────────────────────────────
-- 智造管家 数据库初始化脚本
-- 执行时机：MySQL 容器首次启动时由 docker-entrypoint-initdb.d 自动执行
--
-- 职责：
--   1. 创建生产数据库（smart_factory）
--   2. 创建只读备份用户（供数据备份脚本使用）
--   3. 设置字符集与时区
--   4. 创建所有业务表结构（含索引）
--   5. 写入初始种子数据
--
-- 注意：
--   - 应用数据库用户（DB_USER / DB_PASS）由 docker-compose.yml 中的
--     MYSQL_USER / MYSQL_PASSWORD 环境变量自动创建，无需在此重复创建
--   - 所有表均使用 CREATE TABLE IF NOT EXISTS，支持幂等重执行
-- ─────────────────────────────────────────────────────────────────────────────

-- 设置客户端字符集为 utf8mb4，确保中文正确写入
SET NAMES utf8mb4;
SET CHARACTER SET utf8mb4;

-- 使用 utf8mb4 字符集，支持 emoji 和中文
CREATE DATABASE IF NOT EXISTS `smart_factory`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

-- 测试数据库（供 CI 集成测试使用，生产环境此库为空，不影响运行）
CREATE DATABASE IF NOT EXISTS `smart_factory_test`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

-- ── 只读备份用户 ─────────────────────────────────────────────────────────────
-- 供 mysqldump 备份脚本使用，仅赋予 SELECT 和 LOCK TABLES 权限
-- 注意：备份账号密码必须在部署后由运维人员单独设置，不在此脚本中硬编码
-- 执行命令：
--   docker exec -it sf_mysql mysql -u root -p
--   CREATE USER 'sf_backup'@'localhost' IDENTIFIED BY '<强密码>';
--   GRANT SELECT, LOCK TABLES, SHOW VIEW ON smart_factory.* TO 'sf_backup'@'localhost';
--   FLUSH PRIVILEGES;

-- ── 授权应用用户访问测试库（方便 CI 环境）────────────────────────────────────
-- 注意：MYSQL_USER 对应的用户由 Docker 环境变量自动创建并授权到 MYSQL_DATABASE，
-- 此处额外授权其访问 test 库，方便本地联调
-- 若 MYSQL_USER 尚未存在（取决于 Docker 启动顺序），此语句会在重试中成功
GRANT ALL PRIVILEGES ON `smart_factory_test`.* TO 'sf_app'@'%';

FLUSH PRIVILEGES;

-- ── 验证初始化结果 ────────────────────────────────────────────────────────────
SELECT schema_name AS '已创建数据库', default_character_set_name AS '字符集'
FROM information_schema.schemata
WHERE schema_name IN ('smart_factory', 'smart_factory_test');

-- ═════════════════════════════════════════════════════════════════════════════
-- 以下为业务表结构定义（均在 smart_factory 库中）
-- ═════════════════════════════════════════════════════════════════════════════

USE `smart_factory`;
SET NAMES utf8mb4;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. 租户表 tenants
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `tenants` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code`       VARCHAR(50)     NOT NULL COMMENT '租户编码，全局唯一',
  `name`       VARCHAR(100)    NOT NULL COMMENT '租户名称',
  `status`     ENUM('active','inactive','suspended') NOT NULL DEFAULT 'active',
  `settings`   JSON                     DEFAULT NULL  COMMENT '租户级可配置参数（JSON）',
  `created_at` DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='租户表';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. 角色表 roles
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `roles` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`   BIGINT UNSIGNED NOT NULL DEFAULT 0  COMMENT '0 = 系统预置角色，>0 = 租户自定义角色',
  `code`        VARCHAR(50)     NOT NULL COMMENT '角色编码，如 boss / supervisor / warehouse / worker / sales',
  `name`        VARCHAR(100)    NOT NULL COMMENT '角色名称',
  `description` VARCHAR(500)    DEFAULT NULL,
  `created_at`  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_code` (`tenant_id`, `code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='角色表';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. 用户表 users
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `users` (
  `id`             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`      BIGINT UNSIGNED NOT NULL,
  `username`       VARCHAR(50)     NOT NULL,
  `password_hash`  VARCHAR(255)    NOT NULL,
  `real_name`      VARCHAR(100)    NOT NULL DEFAULT '' COMMENT '姓名',
  `wechat_openid`  VARCHAR(100)    DEFAULT NULL COMMENT '微信小程序 OpenID',
  `status`         ENUM('active','inactive','locked') NOT NULL DEFAULT 'active',
  `last_login_at`  DATETIME(3)     DEFAULT NULL,
  `created_at`     DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`     DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by`     BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_by`     BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_username` (`tenant_id`, `username`),
  UNIQUE KEY `uk_wechat_openid` (`wechat_openid`),
  KEY `idx_tenant_status` (`tenant_id`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户表';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. 用户角色关联表 user_roles
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `user_roles` (
  `id`        BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id` BIGINT UNSIGNED NOT NULL,
  `user_id`   BIGINT UNSIGNED NOT NULL,
  `role_id`   BIGINT UNSIGNED NOT NULL,
  `created_at` DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_user_role` (`tenant_id`, `user_id`, `role_id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_role_id` (`role_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户角色关联表';

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. SKU 分类表 sku_categories
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `sku_categories` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`  BIGINT UNSIGNED NOT NULL DEFAULT 0  COMMENT '0 = 系统预置分类，>0 = 租户自定义',
  `level`      TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '层级：1=一级，2=二级',
  `parent_id`  BIGINT UNSIGNED  DEFAULT NULL        COMMENT '父分类 ID，一级为 NULL',
  `code`       VARCHAR(50)      NOT NULL             COMMENT '分类编码，如 FABRIC / LEATHER',
  `name`       VARCHAR(100)     NOT NULL,
  `sort_order` SMALLINT         NOT NULL DEFAULT 0,
  `is_active`  TINYINT(1)       NOT NULL DEFAULT 1,
  `created_at` DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by` BIGINT UNSIGNED  NOT NULL DEFAULT 0,
  `updated_by` BIGINT UNSIGNED  NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_tenant_level` (`tenant_id`, `level`),
  KEY `idx_tenant_parent` (`tenant_id`, `parent_id`),
  KEY `idx_code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='SKU分类表';

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. SKU 主数据表 skus
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `skus` (
  `id`              BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  `tenant_id`       BIGINT UNSIGNED  NOT NULL,
  `sku_code`        VARCHAR(50)      NOT NULL COMMENT 'SKU编码，租户内唯一',
  `barcode`         VARCHAR(100)     DEFAULT NULL,
  `name`            VARCHAR(200)     NOT NULL,
  `spec`            VARCHAR(500)     DEFAULT NULL COMMENT '规格描述',
  `category1_id`    BIGINT UNSIGNED  NOT NULL COMMENT '一级分类ID',
  `category2_id`    BIGINT UNSIGNED  NOT NULL COMMENT '二级分类ID',
  `stock_unit`      VARCHAR(20)      NOT NULL COMMENT '库存单位',
  `purchase_unit`   VARCHAR(20)      NOT NULL COMMENT '采购单位',
  `production_unit` VARCHAR(20)      NOT NULL COMMENT '生产单位',
  `has_dye_lot`     TINYINT(1)       NOT NULL DEFAULT 0 COMMENT '是否启用缸号管理',
  `safety_stock`    DECIMAL(12,4)    NOT NULL DEFAULT 0 COMMENT '安全库存量',
  `status`          ENUM('active','inactive') NOT NULL DEFAULT 'active',
  `description`     TEXT             DEFAULT NULL,
  `created_at`      DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`      DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by`      BIGINT UNSIGNED  NOT NULL DEFAULT 0,
  `updated_by`      BIGINT UNSIGNED  NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_sku_code` (`tenant_id`, `sku_code`),
  KEY `idx_tenant_cat1` (`tenant_id`, `category1_id`),
  KEY `idx_tenant_cat2` (`tenant_id`, `category2_id`),
  FULLTEXT KEY `ft_name_spec` (`name`, `spec`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='SKU主数据表';

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. SKU 单位换算表 sku_unit_conversions
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `sku_unit_conversions` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`       BIGINT UNSIGNED NOT NULL,
  `sku_id`          BIGINT UNSIGNED NOT NULL,
  `from_unit`       VARCHAR(20)     NOT NULL,
  `to_unit`         VARCHAR(20)     NOT NULL,
  `conversion_rate` DECIMAL(16,8)   NOT NULL COMMENT 'from_unit * rate = to_unit',
  `description`     VARCHAR(200)    DEFAULT NULL,
  `created_at`      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by`      BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_by`      BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_sku_units` (`tenant_id`, `sku_id`, `from_unit`, `to_unit`),
  KEY `idx_tenant_sku` (`tenant_id`, `sku_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='SKU单位换算表';

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. BOM 表头 bom_headers
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `bom_headers` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`   BIGINT UNSIGNED NOT NULL,
  `sku_id`      BIGINT UNSIGNED NOT NULL COMMENT '成品SKU ID',
  `version`     VARCHAR(20)     NOT NULL DEFAULT '1.0',
  `status`      ENUM('draft','active','archived') NOT NULL DEFAULT 'draft',
  `description` VARCHAR(500)    DEFAULT NULL,
  `is_active`   TINYINT(1)      NOT NULL DEFAULT 0  COMMENT '1=当前生效版本',
  `created_at`  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by`  BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_by`  BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_tenant_sku` (`tenant_id`, `sku_id`),
  KEY `idx_tenant_status` (`tenant_id`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='BOM表头';

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. BOM 明细 bom_items
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `bom_items` (
  `id`                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`         BIGINT UNSIGNED NOT NULL,
  `bom_header_id`     BIGINT UNSIGNED NOT NULL,
  `parent_item_id`    BIGINT UNSIGNED DEFAULT NULL COMMENT '父明细ID，NULL=顶层',
  `component_sku_id`  BIGINT UNSIGNED NOT NULL COMMENT '物料/半成品SKU ID',
  `material_sku_id`   BIGINT UNSIGNED DEFAULT NULL COMMENT 'AI 成本分析字段别名，同 component_sku_id',
  `quantity`          DECIMAL(16,4)   NOT NULL,
  `qty_per_unit`      DECIMAL(16,4)   DEFAULT NULL COMMENT 'AI成本分析用字段，同 quantity',
  `unit`              VARCHAR(20)     NOT NULL,
  `level`             TINYINT UNSIGNED NOT NULL DEFAULT 1,
  `scrap_rate`        DECIMAL(8,4)    NOT NULL DEFAULT 0 COMMENT '损耗率（0.05 = 5%）',
  `sort_order`        SMALLINT        NOT NULL DEFAULT 0,
  `notes`             VARCHAR(500)    DEFAULT NULL,
  `created_at`        DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`        DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by`        BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_by`        BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_tenant_bom` (`tenant_id`, `bom_header_id`),
  KEY `idx_tenant_parent` (`tenant_id`, `parent_item_id`),
  KEY `idx_component_sku` (`component_sku_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='BOM明细表';

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. 库存快照表 inventory
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `inventory` (
  `id`             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`      BIGINT UNSIGNED NOT NULL,
  `sku_id`         BIGINT UNSIGNED NOT NULL,
  `qty_on_hand`    DECIMAL(16,4)   NOT NULL DEFAULT 0 COMMENT '在库数量',
  `qty_reserved`   DECIMAL(16,4)   NOT NULL DEFAULT 0 COMMENT '已预留数量',
  `qty_in_transit` DECIMAL(16,4)   NOT NULL DEFAULT 0 COMMENT '在途数量',
  `last_in_at`     DATETIME(3)     DEFAULT NULL,
  `last_out_at`    DATETIME(3)     DEFAULT NULL,
  `created_at`     DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`     DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_sku` (`tenant_id`, `sku_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='库存快照表';

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. 库存余额视图兼容表 inventory_balances（AI 模块引用）
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `inventory_balances` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`     BIGINT UNSIGNED NOT NULL,
  `sku_id`        BIGINT UNSIGNED NOT NULL,
  `qty_available` DECIMAL(16,4)   NOT NULL DEFAULT 0 COMMENT '可用数量 = qty_on_hand - qty_reserved',
  `qty_on_hand`   DECIMAL(16,4)   NOT NULL DEFAULT 0,
  `qty_reserved`  DECIMAL(16,4)   NOT NULL DEFAULT 0,
  `updated_at`    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_sku` (`tenant_id`, `sku_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='库存余额汇总（供AI查询优化）';

-- ─────────────────────────────────────────────────────────────────────────────
-- 12. 缸号批次库存表 inventory_dye_lots
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `inventory_dye_lots` (
  `id`           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`    BIGINT UNSIGNED NOT NULL,
  `sku_id`       BIGINT UNSIGNED NOT NULL,
  `dye_lot_no`   VARCHAR(100)    NOT NULL COMMENT '缸号',
  `qty_on_hand`  DECIMAL(16,4)   NOT NULL DEFAULT 0,
  `qty_reserved` DECIMAL(16,4)   NOT NULL DEFAULT 0,
  `status`       ENUM('active','exhausted') NOT NULL DEFAULT 'active',
  `first_in_at`  DATETIME(3)     DEFAULT NULL,
  `last_in_at`   DATETIME(3)     DEFAULT NULL,
  `created_at`   DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`   DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_sku_lot` (`tenant_id`, `sku_id`, `dye_lot_no`),
  KEY `idx_tenant_sku_status` (`tenant_id`, `sku_id`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='缸号批次库存表';

-- ─────────────────────────────────────────────────────────────────────────────
-- 13. 库存流水表 inventory_transactions
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `inventory_transactions` (
  `id`                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`             BIGINT UNSIGNED NOT NULL,
  `transaction_no`        VARCHAR(50)     NOT NULL COMMENT '流水单号',
  `sku_id`                BIGINT UNSIGNED NOT NULL,
  `transaction_type`      VARCHAR(30)     NOT NULL COMMENT 'PURCHASE_IN / PRODUCTION_IN / MATERIAL_OUT 等',
  `direction`             ENUM('IN','OUT') NOT NULL,
  `qty_input`             DECIMAL(16,4)   NOT NULL COMMENT '输入数量（原单位）',
  `input_unit`            VARCHAR(20)     NOT NULL,
  `qty_stock_unit`        DECIMAL(16,4)   NOT NULL COMMENT '换算后库存单位数量',
  `stock_unit`            VARCHAR(20)     NOT NULL,
  `dye_lot_no`            VARCHAR(100)    DEFAULT NULL,
  `reference_type`        VARCHAR(50)     DEFAULT NULL COMMENT '来源单据类型',
  `reference_id`          BIGINT UNSIGNED DEFAULT NULL COMMENT '来源单据ID',
  `reference_no`          VARCHAR(50)     DEFAULT NULL,
  `production_order_id`   BIGINT UNSIGNED DEFAULT NULL COMMENT '关联生产工单ID（出库溯源用）',
  `is_cross_dye_lot`      TINYINT(1)      NOT NULL DEFAULT 0,
  `batch_cost`            DECIMAL(14,4)   DEFAULT NULL,
  `notes`                 VARCHAR(500)    DEFAULT NULL,
  `created_at`            DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_by`            BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_transaction_no` (`tenant_id`, `transaction_no`),
  KEY `idx_tenant_sku_dir` (`tenant_id`, `sku_id`, `direction`),
  KEY `idx_reference` (`tenant_id`, `reference_type`, `reference_id`),
  KEY `idx_production_order` (`tenant_id`, `production_order_id`),
  KEY `idx_created_at` (`tenant_id`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='库存流水表';

-- ─────────────────────────────────────────────────────────────────────────────
-- 14. 生产工单缸号绑定表 order_dye_lot_bindings
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `order_dye_lot_bindings` (
  `id`                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`           BIGINT UNSIGNED NOT NULL,
  `production_order_id` BIGINT UNSIGNED NOT NULL,
  `sku_id`              BIGINT UNSIGNED NOT NULL,
  `dye_lot_no`          VARCHAR(100)    NOT NULL,
  `bound_at`            DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `bound_by`            BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_order_sku` (`production_order_id`, `sku_id`),
  KEY `idx_tenant_order` (`tenant_id`, `production_order_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='生产工单缸号绑定表';

-- ─────────────────────────────────────────────────────────────────────────────
-- 15. 供应商表 suppliers
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `suppliers` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`   BIGINT UNSIGNED NOT NULL,
  `code`        VARCHAR(50)     NOT NULL,
  `name`        VARCHAR(200)    NOT NULL,
  `grade`       ENUM('A','B','C') NOT NULL DEFAULT 'B' COMMENT '供应商等级',
  `status`      ENUM('active','inactive') NOT NULL DEFAULT 'active',
  `contact`     VARCHAR(100)    DEFAULT NULL,
  `phone`       VARCHAR(30)     DEFAULT NULL,
  `address`     VARCHAR(300)    DEFAULT NULL,
  `main_skus`   JSON            DEFAULT NULL COMMENT '主供SKU ID数组（JSON array）',
  `created_at`  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by`  BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_by`  BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_code` (`tenant_id`, `code`),
  KEY `idx_tenant_status` (`tenant_id`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='供应商表';

-- ─────────────────────────────────────────────────────────────────────────────
-- 16. 供应商报价表 supplier_prices
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `supplier_prices` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`   BIGINT UNSIGNED NOT NULL,
  `supplier_id` BIGINT UNSIGNED NOT NULL,
  `sku_id`      BIGINT UNSIGNED NOT NULL,
  `price`       DECIMAL(14,4)   NOT NULL,
  `unit`        VARCHAR(20)     NOT NULL,
  `is_current`  TINYINT(1)      NOT NULL DEFAULT 1 COMMENT '1=当前有效报价',
  `effective_at` DATE           DEFAULT NULL,
  `expired_at`   DATE           DEFAULT NULL,
  `created_at`  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by`  BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_by`  BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_tenant_sku_current` (`tenant_id`, `sku_id`, `is_current`),
  KEY `idx_supplier_sku` (`supplier_id`, `sku_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='供应商报价表';

-- ─────────────────────────────────────────────────────────────────────────────
-- 17. 采购订单表 purchase_orders
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `purchase_orders` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`     BIGINT UNSIGNED NOT NULL,
  `po_no`         VARCHAR(50)     NOT NULL COMMENT '采购订单号',
  `supplier_id`   BIGINT UNSIGNED NOT NULL,
  `suggestion_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '关联采购建议ID',
  `status`        ENUM('draft','confirmed','partial_received','received','cancelled') NOT NULL DEFAULT 'draft',
  `total_amount`  DECIMAL(16,2)   NOT NULL DEFAULT 0,
  `expected_date` DATE            DEFAULT NULL,
  `notes`         VARCHAR(500)    DEFAULT NULL,
  `created_at`    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by`    BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_by`    BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_po_no` (`tenant_id`, `po_no`),
  KEY `idx_tenant_supplier` (`tenant_id`, `supplier_id`),
  KEY `idx_tenant_status` (`tenant_id`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='采购订单表';

-- ─────────────────────────────────────────────────────────────────────────────
-- 18. 采购订单明细 purchase_order_items
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `purchase_order_items` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`     BIGINT UNSIGNED NOT NULL,
  `po_id`         BIGINT UNSIGNED NOT NULL,
  `sku_id`        BIGINT UNSIGNED NOT NULL,
  `qty_ordered`   DECIMAL(16,4)   NOT NULL,
  `qty_received`  DECIMAL(16,4)   NOT NULL DEFAULT 0,
  `purchase_unit` VARCHAR(20)     NOT NULL,
  `unit_price`    DECIMAL(14,4)   NOT NULL,
  `amount`        DECIMAL(16,2)   NOT NULL,
  `created_at`    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by`    BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_by`    BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_tenant_po` (`tenant_id`, `po_id`),
  KEY `idx_tenant_sku` (`tenant_id`, `sku_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='采购订单明细';

-- ─────────────────────────────────────────────────────────────────────────────
-- 19. 送货单表 delivery_notes
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `delivery_notes` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`     BIGINT UNSIGNED NOT NULL,
  `delivery_no`   VARCHAR(50)     NOT NULL,
  `po_id`         BIGINT UNSIGNED NOT NULL,
  `supplier_id`   BIGINT UNSIGNED NOT NULL,
  `delivery_date` DATE            NOT NULL,
  `status`        ENUM('pending','confirmed','rejected') NOT NULL DEFAULT 'pending',
  `notes`         VARCHAR(500)    DEFAULT NULL,
  `created_at`    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by`    BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_by`    BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_delivery_no` (`tenant_id`, `delivery_no`),
  KEY `idx_tenant_po` (`tenant_id`, `po_id`),
  KEY `idx_tenant_supplier` (`tenant_id`, `supplier_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='送货单表';

-- ─────────────────────────────────────────────────────────────────────────────
-- 20. 送货单明细 delivery_note_items
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `delivery_note_items` (
  `id`               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`        BIGINT UNSIGNED NOT NULL,
  `delivery_note_id` BIGINT UNSIGNED NOT NULL,
  `sku_id`           BIGINT UNSIGNED NOT NULL,
  `qty_delivered`    DECIMAL(16,4)   NOT NULL,
  `purchase_unit`    VARCHAR(20)     NOT NULL,
  `unit_price`       DECIMAL(14,4)   NOT NULL,
  `amount`           DECIMAL(16,2)   NOT NULL,
  `created_at`       DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`       DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by`       BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_by`       BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_tenant_dn` (`tenant_id`, `delivery_note_id`),
  KEY `idx_tenant_sku` (`tenant_id`, `sku_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='送货单明细';

-- ─────────────────────────────────────────────────────────────────────────────
-- 21. 入库单表 purchase_receipts
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `purchase_receipts` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`   BIGINT UNSIGNED NOT NULL,
  `receipt_no`  VARCHAR(50)     NOT NULL,
  `po_id`       BIGINT UNSIGNED NOT NULL,
  `dn_id`       BIGINT UNSIGNED DEFAULT NULL COMMENT '关联送货单ID',
  `status`      ENUM('draft','confirmed') NOT NULL DEFAULT 'draft',
  `notes`       VARCHAR(500)    DEFAULT NULL,
  `received_at` DATETIME(3)     DEFAULT NULL,
  `created_at`  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by`  BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_by`  BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_receipt_no` (`tenant_id`, `receipt_no`),
  KEY `idx_tenant_po` (`tenant_id`, `po_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='入库单表';

-- ─────────────────────────────────────────────────────────────────────────────
-- 22. 三单匹配记录表 three_way_match_records
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `three_way_match_records` (
  `id`                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`         BIGINT UNSIGNED NOT NULL,
  `po_id`             BIGINT UNSIGNED NOT NULL,
  `delivery_note_id`  BIGINT UNSIGNED NOT NULL,
  `receipt_id`        BIGINT UNSIGNED NOT NULL,
  `match_status`      ENUM('pending','matched','qty_diff','price_diff','price_warning') NOT NULL DEFAULT 'pending',
  `qty_diff_detail`   JSON            DEFAULT NULL COMMENT '数量差异详情',
  `price_diff_detail` JSON            DEFAULT NULL COMMENT '价格差异详情',
  `diff_reason`       VARCHAR(50)     DEFAULT NULL,
  `diff_notes`        TEXT            DEFAULT NULL,
  `confirmed_by`      BIGINT UNSIGNED DEFAULT NULL,
  `confirmed_at`      DATETIME(3)     DEFAULT NULL,
  `created_at`        DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`        DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by`        BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_by`        BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_tenant_po` (`tenant_id`, `po_id`),
  KEY `idx_tenant_status` (`tenant_id`, `match_status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='三单匹配记录表';

-- ─────────────────────────────────────────────────────────────────────────────
-- 23. 采购建议表 purchase_suggestions
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `purchase_suggestions` (
  `id`                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`            BIGINT UNSIGNED NOT NULL,
  `suggestion_no`        VARCHAR(50)     NOT NULL,
  `sku_id`               BIGINT UNSIGNED NOT NULL,
  `suggested_supplier_id` BIGINT UNSIGNED DEFAULT NULL,
  `suggested_qty`        DECIMAL(16,4)   NOT NULL,
  `purchase_unit`        VARCHAR(20)     NOT NULL,
  `estimated_price`      DECIMAL(14,4)   DEFAULT NULL,
  `estimated_amount`     DECIMAL(16,2)   DEFAULT NULL,
  `shortage_qty`         DECIMAL(16,4)   DEFAULT NULL,
  `reason`               TEXT            DEFAULT NULL,
  `confidence`           ENUM('high','medium','low') NOT NULL DEFAULT 'medium',
  `confidence_detail`    VARCHAR(300)    DEFAULT NULL,
  `dye_lot_requirement`  TEXT            DEFAULT NULL,
  `status`               ENUM('pending','approved','rejected','executed','expired') NOT NULL DEFAULT 'pending',
  `approved_by`          BIGINT UNSIGNED DEFAULT NULL,
  `approved_at`          DATETIME(3)     DEFAULT NULL,
  `reject_reason`        VARCHAR(300)    DEFAULT NULL,
  `expired_at`           DATETIME(3)     DEFAULT NULL,
  `created_at`           DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`           DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by`           BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_by`           BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_no` (`tenant_id`, `suggestion_no`),
  KEY `idx_tenant_sku_status` (`tenant_id`, `sku_id`, `status`),
  KEY `idx_tenant_status_expired` (`tenant_id`, `status`, `expired_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AI采购建议表';

-- ─────────────────────────────────────────────────────────────────────────────
-- 24. 客户表 customers
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `customers` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`  BIGINT UNSIGNED NOT NULL,
  `code`       VARCHAR(50)     NOT NULL,
  `name`       VARCHAR(200)    NOT NULL,
  `status`     ENUM('active','inactive') NOT NULL DEFAULT 'active',
  `contact`    VARCHAR(100)    DEFAULT NULL,
  `phone`      VARCHAR(30)     DEFAULT NULL,
  `address`    VARCHAR(300)    DEFAULT NULL,
  `created_at` DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_by` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_code` (`tenant_id`, `code`),
  KEY `idx_tenant_status` (`tenant_id`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='客户表';

-- ─────────────────────────────────────────────────────────────────────────────
-- 25. 销售订单表 sales_orders
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `sales_orders` (
  `id`                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`         BIGINT UNSIGNED NOT NULL,
  `order_no`          VARCHAR(50)     NOT NULL,
  `customer_id`       BIGINT UNSIGNED NOT NULL,
  `order_type`        ENUM('normal','urgent') NOT NULL DEFAULT 'normal',
  `status`            ENUM('draft','pending_approval','confirmed','in_production','completed','shipped','cancelled') NOT NULL DEFAULT 'draft',
  `priority`          SMALLINT        NOT NULL DEFAULT 50 COMMENT '优先级 0-100',
  `expected_delivery` DATE            NOT NULL,
  `estimated_delivery` DATE           DEFAULT NULL,
  `total_amount`      DECIMAL(16,2)   NOT NULL DEFAULT 0,
  `constraint_passed` TINYINT(1)      NOT NULL DEFAULT 0,
  `approval_status`   ENUM('not_required','pending','approved','rejected','conditional') NOT NULL DEFAULT 'not_required',
  `approved_by`       BIGINT UNSIGNED DEFAULT NULL,
  `approved_at`       DATETIME(3)     DEFAULT NULL,
  `approval_notes`    TEXT            DEFAULT NULL,
  `sales_person_id`   BIGINT UNSIGNED NOT NULL,
  `notes`             TEXT            DEFAULT NULL,
  `created_at`        DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`        DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by`        BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_by`        BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_order_no` (`tenant_id`, `order_no`),
  KEY `idx_tenant_customer` (`tenant_id`, `customer_id`),
  KEY `idx_tenant_status` (`tenant_id`, `status`),
  KEY `idx_tenant_delivery` (`tenant_id`, `expected_delivery`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='销售订单表';

-- ─────────────────────────────────────────────────────────────────────────────
-- 26. 销售订单明细 sales_order_items
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `sales_order_items` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`     BIGINT UNSIGNED NOT NULL,
  `order_id`      BIGINT UNSIGNED NOT NULL,
  `sku_id`        BIGINT UNSIGNED NOT NULL,
  `qty_ordered`   DECIMAL(16,4)   NOT NULL,
  `qty`           DECIMAL(16,4)   DEFAULT NULL COMMENT 'AI查询字段别名，同 qty_ordered',
  `qty_delivered` DECIMAL(16,4)   NOT NULL DEFAULT 0,
  `unit_price`    DECIMAL(14,4)   NOT NULL,
  `amount`        DECIMAL(16,2)   NOT NULL,
  `bom_header_id` BIGINT UNSIGNED DEFAULT NULL,
  `created_at`    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by`    BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_by`    BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_tenant_order` (`tenant_id`, `order_id`),
  KEY `idx_tenant_sku` (`tenant_id`, `sku_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='销售订单明细';

-- ─────────────────────────────────────────────────────────────────────────────
-- 27. 订单约束检查记录表 order_constraint_checks
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `order_constraint_checks` (
  `id`                       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`                BIGINT UNSIGNED NOT NULL,
  `order_id`                 BIGINT UNSIGNED NOT NULL,
  `check_time`               DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `inventory_turnover_check` JSON            DEFAULT NULL,
  `capital_occupation_check` JSON            DEFAULT NULL,
  `production_cost_check`    JSON            DEFAULT NULL,
  `capacity_load_check`      JSON            DEFAULT NULL,
  `overall_result`           ENUM('pass','block','warning') NOT NULL DEFAULT 'pass',
  `blocked_reasons`          JSON            DEFAULT NULL,
  `impact_analysis`          JSON            DEFAULT NULL,
  `created_at`               DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_by`               BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_tenant_order` (`tenant_id`, `order_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='销售订单四维约束检查记录';

-- ─────────────────────────────────────────────────────────────────────────────
-- 28. 工序模板表 process_templates
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `process_templates` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`  BIGINT UNSIGNED NOT NULL,
  `sku_id`     BIGINT UNSIGNED NOT NULL COMMENT '对应成品SKU',
  `name`       VARCHAR(200)    NOT NULL,
  `status`     ENUM('active','inactive') NOT NULL DEFAULT 'active',
  `created_at` DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_by` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_tenant_sku` (`tenant_id`, `sku_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='工序模板表';

-- ─────────────────────────────────────────────────────────────────────────────
-- 29. 工序步骤表 process_steps
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `process_steps` (
  `id`               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`        BIGINT UNSIGNED NOT NULL,
  `template_id`      BIGINT UNSIGNED NOT NULL,
  `step_no`          SMALLINT        NOT NULL COMMENT '步骤序号',
  `step_name`        VARCHAR(100)    NOT NULL,
  `standard_hours`   DECIMAL(8,4)    DEFAULT NULL COMMENT '标准工时（小时/件）',
  `workstation_type` VARCHAR(50)     DEFAULT NULL,
  `created_at`       DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`       DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by`       BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_by`       BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_tenant_template` (`tenant_id`, `template_id`),
  KEY `idx_step_no` (`template_id`, `step_no`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='工序步骤表';

-- ─────────────────────────────────────────────────────────────────────────────
-- 30. 工作站表 workstations
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `workstations` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`  BIGINT UNSIGNED NOT NULL,
  `name`       VARCHAR(100)    NOT NULL,
  `type`       VARCHAR(50)     NOT NULL,
  `capacity`   INT             NOT NULL DEFAULT 100 COMMENT '日产能（件/天）',
  `status`     ENUM('active','inactive') NOT NULL DEFAULT 'active',
  `created_at` DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_tenant_status` (`tenant_id`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='工作站表';

-- ─────────────────────────────────────────────────────────────────────────────
-- 31. 生产工单表 production_orders
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `production_orders` (
  `id`                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`           BIGINT UNSIGNED NOT NULL,
  `work_order_no`       VARCHAR(50)     NOT NULL,
  `sales_order_id`      BIGINT UNSIGNED NOT NULL,
  `sku_id`              BIGINT UNSIGNED NOT NULL,
  `bom_header_id`       BIGINT UNSIGNED NOT NULL,
  `process_template_id` BIGINT UNSIGNED NOT NULL,
  `qty_planned`         DECIMAL(16,4)   NOT NULL,
  `qty_completed`       DECIMAL(16,4)   NOT NULL DEFAULT 0,
  `status`              ENUM('pending','scheduled','in_progress','completed','cancelled') NOT NULL DEFAULT 'pending',
  `priority`            SMALLINT        NOT NULL DEFAULT 50,
  `planned_start`       DATE            DEFAULT NULL,
  `planned_end`         DATE            DEFAULT NULL,
  `actual_start`        DATETIME(3)     DEFAULT NULL,
  `actual_end`          DATETIME(3)     DEFAULT NULL,
  `notes`               TEXT            DEFAULT NULL,
  `created_at`          DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`          DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by`          BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_by`          BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_wo_no` (`tenant_id`, `work_order_no`),
  KEY `idx_tenant_status` (`tenant_id`, `status`),
  KEY `idx_tenant_sales_order` (`tenant_id`, `sales_order_id`),
  KEY `idx_tenant_sku` (`tenant_id`, `sku_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='生产工单表';

-- ─────────────────────────────────────────────────────────────────────────────
-- 32. 排产计划表 production_schedules
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `production_schedules` (
  `id`                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`           BIGINT UNSIGNED NOT NULL,
  `schedule_date`       DATE            NOT NULL,
  `production_order_id` BIGINT UNSIGNED NOT NULL,
  `process_step_id`     BIGINT UNSIGNED NOT NULL,
  `workstation_id`      BIGINT UNSIGNED DEFAULT NULL,
  `worker_id`           BIGINT UNSIGNED DEFAULT NULL,
  `planned_qty`         DECIMAL(16,4)   NOT NULL,
  `status`              ENUM('planned','confirmed','in_progress','completed','cancelled') NOT NULL DEFAULT 'planned',
  `ai_generated`        TINYINT(1)      NOT NULL DEFAULT 0 COMMENT '1=AI自动生成',
  `created_at`          DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`          DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by`          BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_by`          BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_tenant_date_status` (`tenant_id`, `schedule_date`, `status`),
  KEY `idx_tenant_order` (`tenant_id`, `production_order_id`),
  KEY `idx_worker_date` (`tenant_id`, `worker_id`, `schedule_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='排产计划表';

-- ─────────────────────────────────────────────────────────────────────────────
-- 33. 生产任务表 production_tasks
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `production_tasks` (
  `id`                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`           BIGINT UNSIGNED NOT NULL,
  `task_no`             VARCHAR(50)     NOT NULL,
  `schedule_id`         BIGINT UNSIGNED NOT NULL COMMENT '关联排产计划ID',
  `production_order_id` BIGINT UNSIGNED NOT NULL,
  `process_step_id`     BIGINT UNSIGNED NOT NULL,
  `worker_id`           BIGINT UNSIGNED NOT NULL,
  `task_date`           DATE            NOT NULL,
  `planned_qty`         DECIMAL(16,4)   NOT NULL,
  `completed_qty`       DECIMAL(16,4)   NOT NULL DEFAULT 0,
  `status`              ENUM('pending','started','completed','cancelled') NOT NULL DEFAULT 'pending',
  `started_at`          DATETIME(3)     DEFAULT NULL,
  `completed_at`        DATETIME(3)     DEFAULT NULL,
  `created_at`          DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`          DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by`          BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_by`          BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_task_no` (`tenant_id`, `task_no`),
  KEY `idx_tenant_worker_date` (`tenant_id`, `worker_id`, `task_date`),
  KEY `idx_tenant_order` (`tenant_id`, `production_order_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='生产任务表';

-- ─────────────────────────────────────────────────────────────────────────────
-- 34. 完工记录表 task_completions
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `task_completions` (
  `id`                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`         BIGINT UNSIGNED NOT NULL,
  `task_id`           BIGINT UNSIGNED NOT NULL,
  `completed_qty`     DECIMAL(16,4)   NOT NULL,
  `scrap_qty`         DECIMAL(16,4)   NOT NULL DEFAULT 0,
  `scrap_reason`      ENUM('material_defect','operation_error','other') DEFAULT NULL,
  `component_barcode` VARCHAR(100)    DEFAULT NULL,
  `notes`             VARCHAR(500)    DEFAULT NULL,
  `images`            JSON            DEFAULT NULL,
  `created_at`        DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_by`        BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_tenant_task` (`tenant_id`, `task_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='完工记录表';

-- ─────────────────────────────────────────────────────────────────────────────
-- 35. 溯源记录表 traceability_records
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `traceability_records` (
  `id`                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`           BIGINT UNSIGNED NOT NULL,
  `production_order_id` BIGINT UNSIGNED NOT NULL,
  `task_id`             BIGINT UNSIGNED NOT NULL,
  `sku_id`              BIGINT UNSIGNED DEFAULT NULL COMMENT '物料SKU ID（可选）',
  `component_barcode`   VARCHAR(100)    DEFAULT NULL,
  `component_name`      VARCHAR(200)    DEFAULT NULL,
  `process_step_id`     BIGINT UNSIGNED NOT NULL,
  `worker_id`           BIGINT UNSIGNED NOT NULL,
  `dye_lot_no`          VARCHAR(100)    DEFAULT NULL,
  `operation_time`      DATETIME(3)     NOT NULL,
  `has_scan_record`     TINYINT(1)      NOT NULL DEFAULT 0,
  `created_at`          DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_by`          BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_tenant_order` (`tenant_id`, `production_order_id`),
  KEY `idx_tenant_task` (`tenant_id`, `task_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='生产溯源记录表';

-- ─────────────────────────────────────────────────────────────────────────────
-- 36. 验货单表 inspection_records
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `inspection_records` (
  `id`                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`           BIGINT UNSIGNED NOT NULL,
  `inspection_no`       VARCHAR(50)     NOT NULL,
  `production_order_id` BIGINT UNSIGNED NOT NULL,
  `inspector_id`        BIGINT UNSIGNED NOT NULL,
  `inspection_date`     DATE            NOT NULL,
  `qty_inspected`       DECIMAL(16,4)   NOT NULL,
  `qty_passed`          DECIMAL(16,4)   NOT NULL DEFAULT 0,
  `qty_failed`          DECIMAL(16,4)   NOT NULL DEFAULT 0,
  `status`              ENUM('draft','completed') NOT NULL DEFAULT 'draft',
  `created_at`          DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`          DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by`          BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_by`          BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_inspection_no` (`tenant_id`, `inspection_no`),
  KEY `idx_tenant_order` (`tenant_id`, `production_order_id`),
  KEY `idx_tenant_date_status` (`tenant_id`, `inspection_date`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='验货单表';

-- ─────────────────────────────────────────────────────────────────────────────
-- 37. 质量问题表 quality_issues
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `quality_issues` (
  `id`             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`      BIGINT UNSIGNED NOT NULL,
  `inspection_id`  BIGINT UNSIGNED NOT NULL,
  `component_name` VARCHAR(200)    NOT NULL,
  `issue_types`    JSON            NOT NULL COMMENT '问题类型数组',
  `severity`       ENUM('minor','normal','severe') NOT NULL DEFAULT 'normal',
  `description`    TEXT            DEFAULT NULL,
  `images`         JSON            DEFAULT NULL,
  `created_at`     DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`     DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by`     BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_by`     BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_tenant_inspection` (`tenant_id`, `inspection_id`),
  KEY `idx_tenant_created_at` (`tenant_id`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='质量问题表';

-- ─────────────────────────────────────────────────────────────────────────────
-- 38. 质检记录表 quality_inspections（AI 服务使用，轻量版质检）
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `quality_inspections` (
  `id`                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`           BIGINT UNSIGNED NOT NULL,
  `production_order_id` BIGINT UNSIGNED NOT NULL,
  `result`              ENUM('pass','fail','rework') NOT NULL DEFAULT 'pass',
  `issue_type`          VARCHAR(100)    DEFAULT NULL,
  `inspector_id`        BIGINT UNSIGNED DEFAULT NULL,
  `notes`               TEXT            DEFAULT NULL,
  `created_at`          DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`          DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by`          BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_tenant_order` (`tenant_id`, `production_order_id`),
  KEY `idx_tenant_result` (`tenant_id`, `result`),
  KEY `idx_tenant_created_at` (`tenant_id`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='质检结果记录（AI统计用）';

-- ─────────────────────────────────────────────────────────────────────────────
-- 39. 跨色号出库授权申请表 cross_dye_lot_authorize_requests
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `cross_dye_lot_authorize_requests` (
  `id`                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`         BIGINT UNSIGNED NOT NULL,
  `request_user_id`   BIGINT UNSIGNED NOT NULL COMMENT '申请人（仓管员）',
  `authorize_user_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '审批人（主管）',
  `outbound_order_id` BIGINT UNSIGNED NOT NULL COMMENT '关联出库流水或出库申请ID',
  `sku_id`            BIGINT UNSIGNED NOT NULL,
  `mixed_dye_lots`    JSON            NOT NULL COMMENT '{"boundDyeLotNo":"xxx","requestedDyeLotNo":"yyy"}',
  `reason`            VARCHAR(300)    DEFAULT NULL COMMENT '放行原因（approve时填写）',
  `reject_reason`     VARCHAR(300)    DEFAULT NULL,
  `status`            ENUM('pending','approved','rejected','expired') NOT NULL DEFAULT 'pending',
  `decided_at`        DATETIME(3)     DEFAULT NULL,
  `expires_at`        DATETIME(3)     NOT NULL,
  `created_at`        DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`        DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_tenant_status` (`tenant_id`, `status`),
  KEY `idx_tenant_outbound_sku` (`tenant_id`, `outbound_order_id`, `sku_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='跨色号出库授权申请表';

-- ─────────────────────────────────────────────────────────────────────────────
-- 40. AI 主动建议表 ai_suggestions
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `ai_suggestions` (
  `id`           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`    BIGINT UNSIGNED NOT NULL,
  `type`         VARCHAR(50)     NOT NULL COMMENT 'low_stock_alert / order_overdue_risk 等',
  `title`        VARCHAR(200)    NOT NULL,
  `summary`      TEXT            NOT NULL,
  `level`        ENUM('info','warning','error') NOT NULL DEFAULT 'info',
  `status`       ENUM('unread','read','adopted','ignored') NOT NULL DEFAULT 'unread',
  `related_data` JSON            DEFAULT NULL COMMENT '关联业务数据（JSON）',
  `dedup_key`    VARCHAR(32)     NOT NULL COMMENT '幂等去重键（SHA256前16位）',
  `read_at`      DATETIME(3)     DEFAULT NULL,
  `created_at`   DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`   DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by`   BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_tenant_status` (`tenant_id`, `status`),
  KEY `idx_tenant_created_at` (`tenant_id`, `created_at`),
  KEY `idx_tenant_dedup` (`tenant_id`, `dedup_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AI主动建议表';

-- ─────────────────────────────────────────────────────────────────────────────
-- 41. AI 对话消息表 ai_messages（前端可选持久化）
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `ai_messages` (
  `id`           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`    BIGINT UNSIGNED NOT NULL,
  `user_id`      BIGINT UNSIGNED NOT NULL,
  `session_id`   VARCHAR(64)     DEFAULT NULL COMMENT '会话ID（多轮对话用）',
  `role`         ENUM('user','assistant') NOT NULL,
  `content`      TEXT            NOT NULL,
  `intent`       VARCHAR(50)     DEFAULT NULL,
  `created_at`   DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_by`   BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_tenant_user_session` (`tenant_id`, `user_id`, `session_id`),
  KEY `idx_tenant_created_at` (`tenant_id`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AI对话消息记录';

-- ─────────────────────────────────────────────────────────────────────────────
-- 42. AI 反馈表 ai_feedbacks
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `ai_feedbacks` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`  BIGINT UNSIGNED NOT NULL,
  `user_id`    BIGINT UNSIGNED NOT NULL,
  `message_id` VARCHAR(100)    NOT NULL COMMENT '消息ID（前端生成的UUID）',
  `rating`     ENUM('helpful','unhelpful') NOT NULL,
  `comment`    TEXT            DEFAULT NULL,
  `created_at` DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_user_message` (`tenant_id`, `user_id`, `message_id`),
  KEY `idx_tenant_created_at` (`tenant_id`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AI反馈表';

-- ─────────────────────────────────────────────────────────────────────────────
-- 43. 销售发货主表 sales_deliveries
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `sales_deliveries` (
  `id`           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`    INT UNSIGNED    NOT NULL COMMENT '租户ID',
  `order_id`     BIGINT UNSIGNED NOT NULL COMMENT '关联销售订单ID',
  `delivery_no`  VARCHAR(32)     NOT NULL COMMENT '发货单号',
  `tracking_no`  VARCHAR(128)    DEFAULT NULL COMMENT '物流单号',
  `status`       ENUM('pending','received') NOT NULL DEFAULT 'pending' COMMENT '状态：pending=已发货待收货, received=已收货',
  `shipped_at`   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '发货时间',
  `received_at`  DATETIME        DEFAULT NULL COMMENT '收货确认时间',
  `created_by`   INT UNSIGNED    NOT NULL COMMENT '创建人',
  `updated_by`   INT UNSIGNED    NOT NULL COMMENT '最后修改人',
  `created_at`   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_delivery_no` (`tenant_id`, `delivery_no`),
  KEY `idx_tenant_order`  (`tenant_id`, `order_id`),
  KEY `idx_tenant_status` (`tenant_id`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='销售发货主表';

-- ─────────────────────────────────────────────────────────────────────────────
-- 44. 销售发货明细表 sales_delivery_items
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `sales_delivery_items` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`     INT UNSIGNED    NOT NULL COMMENT '租户ID',
  `delivery_id`   BIGINT UNSIGNED NOT NULL COMMENT '关联发货单ID',
  `order_item_id` BIGINT UNSIGNED NOT NULL COMMENT '关联订单明细ID',
  `shipped_qty`   DECIMAL(14,4)   NOT NULL COMMENT '本次发货数量',
  `created_by`    INT UNSIGNED    NOT NULL COMMENT '创建人',
  `created_at`    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_tenant_delivery`   (`tenant_id`, `delivery_id`),
  KEY `idx_order_item`        (`order_item_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='销售发货明细表';

-- ─────────────────────────────────────────────────────────────────────────────
-- 45. 销售结算单表 sales_settlements
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `sales_settlements` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`       INT UNSIGNED    NOT NULL COMMENT '租户ID',
  `order_id`        BIGINT UNSIGNED NOT NULL COMMENT '关联销售订单ID',
  `settlement_no`   VARCHAR(32)     NOT NULL COMMENT '结算单号',
  `total_amount`    DECIMAL(14,2)   NOT NULL COMMENT '应收总金额',
  `paid_amount`     DECIMAL(14,2)   NOT NULL DEFAULT 0 COMMENT '已收金额',
  `status`          ENUM('pending','partial_paid','paid','overdue') NOT NULL DEFAULT 'pending' COMMENT '结算状态',
  `due_date`        DATE            NOT NULL COMMENT '应付款日期',
  `invoice_no`      VARCHAR(64)     DEFAULT NULL COMMENT '发票号',
  `invoice_date`    DATE            DEFAULT NULL COMMENT '开票日期',
  `notes`           TEXT            DEFAULT NULL COMMENT '备注',
  `created_by`      INT UNSIGNED    NOT NULL COMMENT '创建人',
  `updated_by`      INT UNSIGNED    NOT NULL COMMENT '最后修改人',
  `created_at`      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_order`    (`tenant_id`, `order_id`),
  KEY `idx_tenant_status`         (`tenant_id`, `status`),
  KEY `idx_tenant_due_date`       (`tenant_id`, `due_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='销售结算单表';

-- ─────────────────────────────────────────────────────────────────────────────
-- 46. 销售付款记录表 sales_payments
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `sales_payments` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`       INT UNSIGNED    NOT NULL COMMENT '租户ID',
  `settlement_id`   BIGINT UNSIGNED NOT NULL COMMENT '关联结算单ID',
  `payment_amount`  DECIMAL(14,2)   NOT NULL COMMENT '本次付款金额',
  `payment_method`  VARCHAR(32)     NOT NULL DEFAULT 'bank_transfer' COMMENT '付款方式',
  `payment_date`    DATE            NOT NULL COMMENT '付款日期',
  `reference_no`    VARCHAR(64)     DEFAULT NULL COMMENT '付款流水号/参考号',
  `notes`           TEXT            DEFAULT NULL COMMENT '备注',
  `created_by`      INT UNSIGNED    NOT NULL COMMENT '创建人',
  `created_at`      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_tenant_settlement` (`tenant_id`, `settlement_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='销售付款记录表';

-- ═════════════════════════════════════════════════════════════════════════════
-- 种子数据（初始测试数据）
-- ═════════════════════════════════════════════════════════════════════════════

-- ── 1. 系统预置角色 ───────────────────────────────────────────────────────────
INSERT INTO `roles` (`tenant_id`, `code`, `name`, `description`) VALUES
  (0, 'boss',        '老板',   '最高权限，可查看所有报表及审批'),
  (0, 'supervisor',  '主管',   '车间主管，可审批跨色号等操作'),
  (0, 'warehouse',   '仓管员', '负责库存入出库操作'),
  (0, 'worker',      '生产工人', '执行生产任务'),
  (0, 'sales',       '销售员', '录入销售订单'),
  (0, 'purchase',    '采购员', '处理采购订单'),
  (0, 'admin',       '系统管理员', '租户内系统管理权限');

-- ── 2. 测试租户 ───────────────────────────────────────────────────────────────
INSERT INTO `tenants` (`id`, `code`, `name`, `status`, `settings`) VALUES
  (1, 'FACTORY001', '测试工厂', 'active', JSON_OBJECT(
    'cross_dye_lot_authorize_timeout_minutes', 120,
    'maxInventoryTurnoverDays', 90,
    'maxCapitalOccupation', 500000,
    'maxCapacityLoadRatio', 0.9
  ));

-- ── 3. 管理员用户（username=admin, password=admin123） ────────────────────────
-- bcrypt hash: admin123 cost=10
INSERT INTO `users` (`tenant_id`, `username`, `password_hash`, `real_name`, `status`, `created_by`) VALUES
  (1, 'admin',     '$2b$10$IZsRktb.Yn6s9dlAWs/wDeGh0ONF1lFYFBuGWzqA.JWPAx6F7Y4JS', '系统管理员', 'active', 0),
  (1, 'warehouse', '$2b$10$HISC0Ea21DBYBgUCFPHqR.OzspQxqrTo3QZogV0czT9axjIa2W49O', '仓管员',     'active', 1);

-- ── 4. 用户角色绑定 ───────────────────────────────────────────────────────────
INSERT INTO `user_roles` (`tenant_id`, `user_id`, `role_id`)
SELECT 1, u.id, r.id
FROM `users` u, `roles` r
WHERE u.tenant_id = 1 AND u.username = 'admin' AND r.code = 'admin';

INSERT INTO `user_roles` (`tenant_id`, `user_id`, `role_id`)
SELECT 1, u.id, r.id
FROM `users` u, `roles` r
WHERE u.tenant_id = 1 AND u.username = 'admin' AND r.code = 'boss';

INSERT INTO `user_roles` (`tenant_id`, `user_id`, `role_id`)
SELECT 1, u.id, r.id
FROM `users` u, `roles` r
WHERE u.tenant_id = 1 AND u.username = 'warehouse' AND r.code = 'warehouse';

-- ── 5. 系统预置 SKU 分类（level=0/系统级，tenant_id=0） ───────────────────────
INSERT INTO `sku_categories` (`tenant_id`, `level`, `parent_id`, `code`, `name`, `sort_order`) VALUES
  (0, 1, NULL, 'MATERIAL',  '原材料',   10),
  (0, 1, NULL, 'SEMIFIN',   '半成品',   20),
  (0, 1, NULL, 'FINISHED',  '成品',     30),
  (0, 1, NULL, 'PACKING',   '包材辅料', 40);

INSERT INTO `sku_categories` (`tenant_id`, `level`, `parent_id`, `code`, `name`, `sort_order`) VALUES
  (0, 2, 1, 'FABRIC',   '面料',     10),
  (0, 2, 1, 'LEATHER',  '皮料',     20),
  (0, 2, 1, 'SPONGE',   '海绵',     30),
  (0, 2, 1, 'WOOD',     '木架',     40),
  (0, 2, 1, 'METAL',    '五金配件', 50),
  (0, 2, 2, 'SEMIFABRIC','面料半成品', 10),
  (0, 2, 3, 'SOFA',     '沙发成品', 10),
  (0, 2, 3, 'CHAIR',    '椅子成品', 20),
  (0, 2, 4, 'CARTON',   '纸箱',     10);

-- ── 6. 验证种子数据 ───────────────────────────────────────────────────────────
SELECT '=== 种子数据初始化完成 ===' AS info;
SELECT CONCAT('租户数: ', COUNT(*)) AS info FROM `tenants`;
SELECT CONCAT('用户数: ', COUNT(*)) AS info FROM `users`;
SELECT CONCAT('角色数: ', COUNT(*)) AS info FROM `roles`;
SELECT CONCAT('SKU分类数: ', COUNT(*)) AS info FROM `sku_categories`;
