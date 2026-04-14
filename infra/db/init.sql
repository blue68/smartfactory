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
-- 3.1 部门主数据 departments
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `departments` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`  BIGINT UNSIGNED NOT NULL,
  `code`       VARCHAR(50) NOT NULL,
  `name`       VARCHAR(100) NOT NULL,
  `status`     ENUM('active','inactive','locked','archived') NOT NULL DEFAULT 'active',
  `sort_order` INT NOT NULL DEFAULT 0,
  `notes`      VARCHAR(255) DEFAULT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_by` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_department_code` (`tenant_id`, `code`),
  UNIQUE KEY `uk_tenant_department_name` (`tenant_id`, `name`),
  KEY `idx_tenant_status_sort` (`tenant_id`, `status`, `sort_order`, `id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='部门主数据';

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
  `stock_conv_factor` DECIMAL(10,4)  DEFAULT 1 COMMENT '库存换算系数',
  `prod_conv_note`  VARCHAR(200)     DEFAULT NULL COMMENT '生产换算说明',
  `has_dye_lot`     TINYINT(1)       NOT NULL DEFAULT 0 COMMENT '是否启用缸号管理',
  `use_fifo`        TINYINT(1)       NOT NULL DEFAULT 1 COMMENT '启用FIFO出库',
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
  `grade`       ENUM('A','B','C','D') NOT NULL DEFAULT 'B' COMMENT '供应商等级',
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
  `moq`            INT UNSIGNED     DEFAULT NULL COMMENT '最小起订量',
  `notes`          TEXT             DEFAULT NULL COMMENT '备注',
  `tax_rate`       DECIMAL(5,2)     DEFAULT NULL COMMENT '税率',
  `batch_pricing`  TINYINT          NOT NULL DEFAULT 0 COMMENT '是否启用批次定价',
  `batch_rule`     VARCHAR(500)     DEFAULT NULL COMMENT '批次条件规则',
  `attachment_url` VARCHAR(500)     DEFAULT NULL COMMENT '协议文件URL',
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
  `dye_lot_no`       VARCHAR(100)    DEFAULT NULL COMMENT '面料/皮料类到货后确认的缸号',
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
  `address`       VARCHAR(300)    DEFAULT NULL,
  `region`        VARCHAR(100)    DEFAULT NULL COMMENT '区域',
  `email`         VARCHAR(200)    DEFAULT NULL,
  `grade`         ENUM('VIP','A','B','C') NOT NULL DEFAULT 'B',
  `credit_limit`  DECIMAL(14,2)   DEFAULT NULL COMMENT '信用额度',
  `payment_days`  INT             DEFAULT NULL COMMENT '账期天数',
  `notes`         TEXT            DEFAULT NULL,
  `created_at` DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_by` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_code` (`tenant_id`, `code`),
  KEY `idx_tenant_status` (`tenant_id`, `status`),
  KEY `idx_tenant_grade` (`tenant_id`, `grade`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='客户表';

-- ─────────────────────────────────────────────────────────────────────────────
-- 25. 客户联系人表 customer_contacts
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `customer_contacts` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`   BIGINT UNSIGNED NOT NULL,
  `customer_id` BIGINT UNSIGNED NOT NULL,
  `name`        VARCHAR(100)    NOT NULL,
  `title`       VARCHAR(100)    DEFAULT NULL,
  `phone`       VARCHAR(30)     DEFAULT NULL,
  `email`       VARCHAR(200)    DEFAULT NULL,
  `is_primary`  TINYINT(1)      NOT NULL DEFAULT 0,
  `created_at`  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_contact_customer` (`tenant_id`, `customer_id`),
  KEY `idx_contact_primary` (`customer_id`, `is_primary`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='客户联系人表';

-- ─────────────────────────────────────────────────────────────────────────────
-- 26. 销售订单表 sales_orders
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
-- 27. 销售订单明细 sales_order_items
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
  `max_hours`        DECIMAL(6,2)    DEFAULT NULL COMMENT '极限工时（小时/件），超出则触发预警',
  `guide_text`       TEXT            DEFAULT NULL COMMENT '工序操作说明文本',
  `guide_attachment_url`  VARCHAR(500) DEFAULT NULL COMMENT '工序操作说明附件地址',
  `guide_attachment_name` VARCHAR(255) DEFAULT NULL COMMENT '工序操作说明附件名称',
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
CREATE TABLE IF NOT EXISTS `settlements` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`       BIGINT UNSIGNED NOT NULL,
  `settlement_no`   VARCHAR(50)     NOT NULL,
  `customer_id`     BIGINT UNSIGNED NOT NULL,
  `order_id`        BIGINT UNSIGNED NOT NULL,
  `total_amount`    DECIMAL(16,2)   NOT NULL DEFAULT 0.00,
  `status`          ENUM('draft','confirmed','paid','cancelled') NOT NULL DEFAULT 'draft',
  `due_date`        DATE            DEFAULT NULL,
  `confirmed_by`    BIGINT UNSIGNED DEFAULT NULL,
  `confirmed_at`    DATETIME(3)     DEFAULT NULL,
  `paid_at`         DATETIME(3)     DEFAULT NULL,
  `notes`           TEXT            DEFAULT NULL,
  `created_by`      BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_by`      BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `created_at`      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_settlements_no` (`tenant_id`, `settlement_no`),
  KEY `idx_settlements_order` (`tenant_id`, `order_id`),
  KEY `idx_settlements_status` (`tenant_id`, `status`),
  KEY `idx_settlements_customer` (`tenant_id`, `customer_id`),
  KEY `idx_settlements_due_date` (`tenant_id`, `due_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='销售结算单（F-707 settlement 模块）';

-- ─────────────────────────────────────────────────────────────────────────────
-- 47. 销售付款记录表 sales_payments
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
  (0, 'purchaser',   '采购员', '采购员角色别名，兼容前后端角色编码差异'),
  (0, 'qc',          'QC验货员', '负责来料质检与质量检验'),
  (0, 'manager',     '经理', '负责工艺配置与报表管理'),
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
  -- 默认密码: Demo123!
  (1, 'admin',     '$2b$10$zQxH8rv.L5iC.WmFJPi.k.ybfWdEV1LkPcvtm5k1ZZyG5rNv8e4ZO', '系统管理员', 'active', 0),
  (1, 'warehouse', '$2b$10$zQxH8rv.L5iC.WmFJPi.k.ybfWdEV1LkPcvtm5k1ZZyG5rNv8e4ZO', '仓管员',     'active', 1),
  (1, 'smoke_tester', '$2b$10$zQxH8rv.L5iC.WmFJPi.k.ybfWdEV1LkPcvtm5k1ZZyG5rNv8e4ZO', '冒烟测试员', 'active', 1),
  -- 本地开发账号统一密码: Dev123!2026
  (1, 'boss_dev',       '$2b$10$MmgwQ9xr9HEolYqOUjcpUumg/M3wle7C3ySCi4ziZSCnJfAl1zacO', '本地开发-老板', 'active', 0),
  (1, 'admin_dev',      '$2b$10$MmgwQ9xr9HEolYqOUjcpUumg/M3wle7C3ySCi4ziZSCnJfAl1zacO', '本地开发-系统管理员', 'active', 0),
  (1, 'supervisor_dev', '$2b$10$MmgwQ9xr9HEolYqOUjcpUumg/M3wle7C3ySCi4ziZSCnJfAl1zacO', '本地开发-主管', 'active', 0),
  (1, 'warehouse_dev',  '$2b$10$MmgwQ9xr9HEolYqOUjcpUumg/M3wle7C3ySCi4ziZSCnJfAl1zacO', '本地开发-仓管员', 'active', 0),
  (1, 'worker_dev',     '$2b$10$MmgwQ9xr9HEolYqOUjcpUumg/M3wle7C3ySCi4ziZSCnJfAl1zacO', '本地开发-生产工人', 'active', 0),
  (1, 'sales_dev',      '$2b$10$MmgwQ9xr9HEolYqOUjcpUumg/M3wle7C3ySCi4ziZSCnJfAl1zacO', '本地开发-销售员', 'active', 0),
  (1, 'purchaser_dev',  '$2b$10$MmgwQ9xr9HEolYqOUjcpUumg/M3wle7C3ySCi4ziZSCnJfAl1zacO', '本地开发-采购员', 'active', 0),
  (1, 'qc_dev',         '$2b$10$MmgwQ9xr9HEolYqOUjcpUumg/M3wle7C3ySCi4ziZSCnJfAl1zacO', '本地开发-QC验货员', 'active', 0),
  (1, 'manager_dev',    '$2b$10$MmgwQ9xr9HEolYqOUjcpUumg/M3wle7C3ySCi4ziZSCnJfAl1zacO', '本地开发-经理', 'active', 0);

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

INSERT INTO `user_roles` (`tenant_id`, `user_id`, `role_id`)
SELECT 1, u.id, r.id
FROM `users` u, `roles` r
WHERE u.tenant_id = 1 AND u.username = 'smoke_tester' AND r.code = 'boss';

INSERT INTO `user_roles` (`tenant_id`, `user_id`, `role_id`)
SELECT 1, u.id, r.id
FROM `users` u, `roles` r
WHERE u.tenant_id = 1 AND u.username = 'boss_dev' AND r.code = 'boss';

INSERT INTO `user_roles` (`tenant_id`, `user_id`, `role_id`)
SELECT 1, u.id, r.id
FROM `users` u, `roles` r
WHERE u.tenant_id = 1 AND u.username = 'admin_dev' AND r.code = 'admin';

INSERT INTO `user_roles` (`tenant_id`, `user_id`, `role_id`)
SELECT 1, u.id, r.id
FROM `users` u, `roles` r
WHERE u.tenant_id = 1 AND u.username = 'supervisor_dev' AND r.code = 'supervisor';

INSERT INTO `user_roles` (`tenant_id`, `user_id`, `role_id`)
SELECT 1, u.id, r.id
FROM `users` u, `roles` r
WHERE u.tenant_id = 1 AND u.username = 'warehouse_dev' AND r.code = 'warehouse';

INSERT INTO `user_roles` (`tenant_id`, `user_id`, `role_id`)
SELECT 1, u.id, r.id
FROM `users` u, `roles` r
WHERE u.tenant_id = 1 AND u.username = 'worker_dev' AND r.code = 'worker';

INSERT INTO `user_roles` (`tenant_id`, `user_id`, `role_id`)
SELECT 1, u.id, r.id
FROM `users` u, `roles` r
WHERE u.tenant_id = 1 AND u.username = 'sales_dev' AND r.code = 'sales';

INSERT INTO `user_roles` (`tenant_id`, `user_id`, `role_id`)
SELECT 1, u.id, r.id
FROM `users` u, `roles` r
WHERE u.tenant_id = 1 AND u.username = 'purchaser_dev' AND r.code = 'purchase';

INSERT INTO `user_roles` (`tenant_id`, `user_id`, `role_id`)
SELECT 1, u.id, r.id
FROM `users` u, `roles` r
WHERE u.tenant_id = 1 AND u.username = 'purchaser_dev' AND r.code = 'purchaser';

INSERT INTO `user_roles` (`tenant_id`, `user_id`, `role_id`)
SELECT 1, u.id, r.id
FROM `users` u, `roles` r
WHERE u.tenant_id = 1 AND u.username = 'qc_dev' AND r.code = 'qc';

INSERT INTO `user_roles` (`tenant_id`, `user_id`, `role_id`)
SELECT 1, u.id, r.id
FROM `users` u, `roles` r
WHERE u.tenant_id = 1 AND u.username = 'manager_dev' AND r.code = 'manager';

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

-- ── 6. 测试 SKU 数据 ────────────────────────────────────────────────────────
-- category IDs: 1=MATERIAL, 2=SEMIFIN, 3=FINISHED, 4=PACKING
-- category2 IDs: 5=FABRIC, 6=LEATHER, 7=SPONGE, 8=WOOD, 9=METAL, 10=SEMIFABRIC, 11=SOFA, 12=CHAIR, 13=CARTON
INSERT INTO `skus` (`tenant_id`, `sku_code`, `name`, `spec`, `category1_id`, `category2_id`, `stock_unit`, `purchase_unit`, `production_unit`, `has_dye_lot`, `safety_stock`, `status`, `created_by`) VALUES
  (1, 'RM-00012', '红橡木板', '200x2400mm，厚18mm', 1, 8, '张', '张', 'mm²', 0, 10, 'active', 1),
  (1, 'RM-00013', '白色烤漆板', '1220x2440mm', 1, 8, '张', '张', 'mm²', 0, 20, 'active', 1),
  (1, 'RM-00056', '亚麻面料（米白色）', '幅宽150cm，进口', 1, 5, 'm', '卷', 'm²', 1, 0, 'active', 1),
  (1, 'RM-00089', '头层牛皮（深棕）', '幅宽约180cm，厚1.2mm', 1, 6, 'm²', '张', 'm²', 1, 50, 'active', 1),
  (1, 'WIP-00021', '柜体侧板（半成品）', '红橡实木，已开料封边', 2, 10, '套', '套', '套', 0, 5, 'active', 1),
  (1, 'FG-00008', '红橡实木书柜 1.8m', 'W900xD380xH1800', 3, 11, '套', '套', '套', 0, 2, 'active', 1),
  (1, 'RM-00201', '木蜡油', '0.5L/瓶，天然木蜡油', 1, 9, '瓶', '箱', 'ml', 0, 0, 'active', 1),
  (1, 'RM-00014', 'E1级刨花板', '1220x2440mm，厚16mm', 1, 8, '张', '张', 'mm²', 0, 15, 'active', 1),
  (1, 'RM-00015', '多层实木板', '1220x2440mm，厚18mm', 1, 8, '张', '张', 'mm²', 0, 12, 'active', 1),
  (1, 'RM-00057', '涤纶布（灰色）', '幅宽145cm', 1, 5, 'm', '卷', 'm²', 1, 0, 'active', 1),
  (1, 'RM-00058', '棉麻混纺（本白）', '幅宽150cm，混纺比65/35', 1, 5, 'm', '卷', 'm²', 1, 30, 'active', 1),
  (1, 'RM-00090', '二层牛皮（黑色）', '幅宽约160cm', 1, 6, 'm²', '张', 'm²', 1, 40, 'active', 1),
  (1, 'RM-00101', '高密度海绵', '密度40D，厚50mm', 1, 7, '块', '块', 'cm³', 0, 100, 'active', 1),
  (1, 'RM-00102', '再生海绵', '密度28D，厚30mm', 1, 7, '块', '块', 'cm³', 0, 80, 'active', 1),
  (1, 'RM-00150', '铝合金合页', '4寸，不锈钢色', 1, 9, '个', '盒', '个', 0, 200, 'active', 1),
  (1, 'RM-00151', '抽屉滑轨', '45cm，三段式', 1, 9, '副', '盒', '副', 0, 100, 'active', 1),
  (1, 'RM-00202', '水性清漆', '5L/桶，环保水性', 1, 9, '桶', '桶', 'ml', 0, 10, 'active', 1),
  (1, 'WIP-00022', '门板组件', '含合页预装', 2, 10, '套', '套', '套', 0, 8, 'active', 1),
  (1, 'WIP-00023', '沙发框架', '松木框架，已组装', 2, 10, '套', '套', '套', 0, 3, 'active', 1),
  (1, 'FG-00009', '北欧三人沙发', 'W2200xD850xH780', 3, 11, '套', '套', '套', 0, 1, 'active', 1),
  (1, 'FG-00010', '实木餐椅', 'W450xD500xH850，红橡', 3, 12, '把', '把', '把', 0, 6, 'active', 1),
  (1, 'RM-00300', '纸箱（大）', '800x500x600mm，五层瓦楞', 4, 13, '个', '捆', '个', 0, 50, 'active', 1),
  (1, 'RM-00301', 'EPE珍珠棉', '厚20mm，1x50m/卷', 4, 13, 'm', '卷', 'm²', 0, 0, 'active', 1);

-- ── 6A. Analytics 演示业务种子 ──────────────────────────────────────────────
-- 目标：让 /api/analytics 六个接口在默认租户（tenant_id=1）下开箱即有可视化数据。
-- 约束：优先复用 sales.api / production.api 已跑通的插入口径，仅补 analytics 依赖的最小业务链路。
SET @analytics_boss_user_id := (
  SELECT id FROM `users` WHERE tenant_id = 1 AND username = 'boss_dev' LIMIT 1
);
SET @analytics_sales_user_id := (
  SELECT id FROM `users` WHERE tenant_id = 1 AND username = 'sales_dev' LIMIT 1
);
SET @analytics_supervisor_user_id := (
  SELECT id FROM `users` WHERE tenant_id = 1 AND username = 'supervisor_dev' LIMIT 1
);
SET @analytics_worker_user_id := (
  SELECT id FROM `users` WHERE tenant_id = 1 AND username = 'worker_dev' LIMIT 1
);
SET @analytics_purchaser_user_id := (
  SELECT id FROM `users` WHERE tenant_id = 1 AND username = 'purchaser_dev' LIMIT 1
);

SET @analytics_fg_sofa_sku_id := (
  SELECT id FROM `skus` WHERE tenant_id = 1 AND sku_code = 'FG-00009' LIMIT 1
);
SET @analytics_raw_fabric_sku_id := (
  SELECT id FROM `skus` WHERE tenant_id = 1 AND sku_code = 'RM-00058' LIMIT 1
);
SET @analytics_wip_frame_sku_id := (
  SELECT id FROM `skus` WHERE tenant_id = 1 AND sku_code = 'WIP-00023' LIMIT 1
);
SET @analytics_carton_sku_id := (
  SELECT id FROM `skus` WHERE tenant_id = 1 AND sku_code = 'RM-00300' LIMIT 1
);

SET @analytics_customer_id := 910001;
SET @analytics_supplier_a_id := 910101;
SET @analytics_supplier_b_id := 910102;
SET @analytics_workstation_id := 910201;
SET @analytics_template_id := 910301;
SET @analytics_step_cut_id := 910311;
SET @analytics_step_assemble_id := 910312;
SET @analytics_bom_id := 910401;
SET @analytics_sales_order_confirmed_id := 910501;
SET @analytics_sales_order_pending_id := 910502;
SET @analytics_purchase_order_a_id := 910601;
SET @analytics_purchase_order_b_id := 910602;
SET @analytics_production_order_scheduled_id := 910701;
SET @analytics_production_order_in_progress_id := 910702;
SET @analytics_production_order_completed_id := 910703;
SET @analytics_schedule_cut_id := 910721;
SET @analytics_schedule_assemble_id := 910722;
SET @analytics_task_cut_id := 910731;
SET @analytics_task_assemble_id := 910732;

INSERT INTO `customers`
  (`id`, `tenant_id`, `code`, `name`, `status`, `grade`, `contact`, `phone`, `region`, `created_by`, `updated_by`)
VALUES
  (@analytics_customer_id, 1, 'CUS-ANLT-001', '华东直营样板客户', 'active', 'VIP', '陈经理', '13800000001', '华东', @analytics_boss_user_id, @analytics_boss_user_id);

INSERT INTO `suppliers`
  (`id`, `tenant_id`, `code`, `name`, `grade`, `status`, `contact`, `phone`, `created_by`, `updated_by`)
VALUES
  (@analytics_supplier_a_id, 1, 'SUP-ANLT-A', '华东辅料供应商', 'A', 'active', '李采购', '13900000001', @analytics_purchaser_user_id, @analytics_purchaser_user_id),
  (@analytics_supplier_b_id, 1, 'SUP-ANLT-B', '半成品协作供应商', 'A', 'active', '周采购', '13900000002', @analytics_purchaser_user_id, @analytics_purchaser_user_id);

INSERT INTO `supplier_prices`
  (`id`, `tenant_id`, `supplier_id`, `sku_id`, `price`, `unit`, `is_current`, `effective_at`, `created_by`, `updated_by`)
VALUES
  (910111, 1, @analytics_supplier_a_id, @analytics_raw_fabric_sku_id, 12.0000, 'm', 1, CURDATE(), @analytics_purchaser_user_id, @analytics_purchaser_user_id),
  (910112, 1, @analytics_supplier_b_id, @analytics_wip_frame_sku_id, 150.0000, '套', 1, CURDATE(), @analytics_purchaser_user_id, @analytics_purchaser_user_id),
  (910113, 1, @analytics_supplier_a_id, @analytics_carton_sku_id, 5.0000, '个', 1, CURDATE(), @analytics_purchaser_user_id, @analytics_purchaser_user_id);

INSERT INTO `inventory`
  (`tenant_id`, `sku_id`, `qty_on_hand`, `qty_reserved`, `qty_in_transit`, `last_in_at`, `last_out_at`)
VALUES
  (1, @analytics_raw_fabric_sku_id, 18.0000, 2.0000, 0.0000, DATE_SUB(NOW(), INTERVAL 5 DAY), DATE_SUB(NOW(), INTERVAL 2 DAY)),
  (1, @analytics_wip_frame_sku_id, 3.0000, 0.0000, 0.0000, DATE_SUB(NOW(), INTERVAL 4 DAY), NULL),
  (1, @analytics_carton_sku_id, 60.0000, 0.0000, 0.0000, DATE_SUB(NOW(), INTERVAL 3 DAY), NULL);

INSERT INTO `inventory_transactions`
  (`id`, `tenant_id`, `transaction_no`, `sku_id`, `transaction_type`, `direction`, `qty_input`, `input_unit`, `qty_stock_unit`, `stock_unit`, `reference_type`, `reference_id`, `reference_no`, `batch_cost`, `notes`, `created_at`, `created_by`)
VALUES
  (910801, 1, 'ITX-ANLT-001', @analytics_raw_fabric_sku_id, 'PURCHASE_IN', 'IN', 30.0000, 'm', 30.0000, 'm', 'analytics_seed', @analytics_purchase_order_a_id, 'ANLT-PO-A', 12.0000, '经营分析演示入库', DATE_SUB(NOW(), INTERVAL 20 DAY), @analytics_purchaser_user_id),
  (910802, 1, 'ITX-ANLT-002', @analytics_raw_fabric_sku_id, 'MATERIAL_OUT', 'OUT', 8.0000, 'm', 8.0000, 'm', 'analytics_seed', @analytics_production_order_in_progress_id, 'ANLT-WO-IP', 12.0000, '经营分析演示领料', DATE_SUB(NOW(), INTERVAL 12 DAY), @analytics_supervisor_user_id),
  (910803, 1, 'ITX-ANLT-003', @analytics_carton_sku_id, 'PURCHASE_IN', 'IN', 15.0000, '个', 15.0000, '个', 'analytics_seed', @analytics_purchase_order_a_id, 'ANLT-PO-A', 5.0000, '经营分析演示包材入库', DATE_SUB(NOW(), INTERVAL 5 DAY), @analytics_purchaser_user_id);

INSERT INTO `workstations`
  (`id`, `tenant_id`, `name`, `type`, `capacity`, `status`)
VALUES
  (@analytics_workstation_id, 1, '分析演示裁剪站', 'default', 20, 'active');

INSERT INTO `process_templates`
  (`id`, `tenant_id`, `sku_id`, `name`, `status`, `created_by`, `updated_by`)
VALUES
  (@analytics_template_id, 1, @analytics_fg_sofa_sku_id, '分析演示沙发工艺', 'active', @analytics_supervisor_user_id, @analytics_supervisor_user_id);

INSERT INTO `process_steps`
  (`id`, `tenant_id`, `template_id`, `step_no`, `step_name`, `standard_hours`, `workstation_type`, `created_by`, `updated_by`)
VALUES
  (@analytics_step_cut_id, 1, @analytics_template_id, 1, '裁剪', 0.4000, 'default', @analytics_supervisor_user_id, @analytics_supervisor_user_id),
  (@analytics_step_assemble_id, 1, @analytics_template_id, 2, '组装', 0.6000, 'default', @analytics_supervisor_user_id, @analytics_supervisor_user_id);

INSERT INTO `bom_headers`
  (`id`, `tenant_id`, `sku_id`, `version`, `status`, `description`, `is_active`, `created_by`, `updated_by`)
VALUES
  (@analytics_bom_id, 1, @analytics_fg_sofa_sku_id, '1.0', 'active', '经营分析演示BOM', 1, @analytics_supervisor_user_id, @analytics_supervisor_user_id);

INSERT INTO `bom_items`
  (`id`, `tenant_id`, `bom_header_id`, `parent_item_id`, `component_sku_id`, `material_sku_id`, `quantity`, `qty_per_unit`, `unit`, `level`, `scrap_rate`, `sort_order`, `created_by`, `updated_by`)
VALUES
  (910411, 1, @analytics_bom_id, NULL, @analytics_raw_fabric_sku_id, @analytics_raw_fabric_sku_id, 2.0000, 2.0000, 'm', 1, 0.0000, 1, @analytics_supervisor_user_id, @analytics_supervisor_user_id),
  (910412, 1, @analytics_bom_id, NULL, @analytics_wip_frame_sku_id, @analytics_wip_frame_sku_id, 0.5000, 0.5000, '套', 1, 0.0000, 2, @analytics_supervisor_user_id, @analytics_supervisor_user_id),
  (910413, 1, @analytics_bom_id, NULL, @analytics_carton_sku_id, @analytics_carton_sku_id, 1.0000, 1.0000, '个', 1, 0.0000, 3, @analytics_supervisor_user_id, @analytics_supervisor_user_id);

INSERT INTO `sales_orders`
  (`id`, `tenant_id`, `order_no`, `customer_id`, `order_type`, `status`, `priority`, `expected_delivery`, `total_amount`, `constraint_passed`, `approval_status`, `sales_person_id`, `notes`, `created_at`, `updated_at`, `created_by`, `updated_by`)
VALUES
  (@analytics_sales_order_confirmed_id, 1, 'SO-ANLT-001', @analytics_customer_id, 'normal', 'confirmed', 80, DATE_ADD(CURDATE(), INTERVAL 14 DAY), 38800.00, 1, 'approved', @analytics_sales_user_id, '经营分析演示已确认订单', DATE_ADD(DATE_FORMAT(NOW(), '%Y-%m-01'), INTERVAL 1 DAY), DATE_ADD(DATE_FORMAT(NOW(), '%Y-%m-01'), INTERVAL 1 DAY), @analytics_sales_user_id, @analytics_sales_user_id),
  (@analytics_sales_order_pending_id, 1, 'SO-ANLT-002', @analytics_customer_id, 'urgent', 'pending_approval', 95, DATE_ADD(CURDATE(), INTERVAL 7 DAY), 27600.00, 0, 'pending', @analytics_sales_user_id, '经营分析演示待审批订单', DATE_ADD(DATE_FORMAT(NOW(), '%Y-%m-01'), INTERVAL 2 DAY), DATE_ADD(DATE_FORMAT(NOW(), '%Y-%m-01'), INTERVAL 2 DAY), @analytics_sales_user_id, @analytics_sales_user_id);

INSERT INTO `sales_order_items`
  (`id`, `tenant_id`, `order_id`, `sku_id`, `qty_ordered`, `qty`, `qty_delivered`, `unit_price`, `amount`, `bom_header_id`, `created_by`, `updated_by`)
VALUES
  (910511, 1, @analytics_sales_order_confirmed_id, @analytics_fg_sofa_sku_id, 4.0000, 4.0000, 0.0000, 9700.0000, 38800.00, @analytics_bom_id, @analytics_sales_user_id, @analytics_sales_user_id),
  (910512, 1, @analytics_sales_order_pending_id, @analytics_fg_sofa_sku_id, 3.0000, 3.0000, 0.0000, 9200.0000, 27600.00, @analytics_bom_id, @analytics_sales_user_id, @analytics_sales_user_id);

INSERT INTO `purchase_orders`
  (`id`, `tenant_id`, `po_no`, `supplier_id`, `status`, `total_amount`, `expected_date`, `notes`, `created_at`, `updated_at`, `created_by`, `updated_by`)
VALUES
  (@analytics_purchase_order_a_id, 1, 'PO-ANLT-001', @analytics_supplier_a_id, 'confirmed', 290.00, DATE_ADD(CURDATE(), INTERVAL 5 DAY), '经营分析演示原材料/包材采购', DATE_SUB(NOW(), INTERVAL 10 DAY), DATE_SUB(NOW(), INTERVAL 10 DAY), @analytics_purchaser_user_id, @analytics_purchaser_user_id),
  (@analytics_purchase_order_b_id, 1, 'PO-ANLT-002', @analytics_supplier_b_id, 'partial_received', 600.00, DATE_ADD(CURDATE(), INTERVAL 12 DAY), '经营分析演示半成品采购', DATE_SUB(NOW(), INTERVAL 45 DAY), DATE_SUB(NOW(), INTERVAL 45 DAY), @analytics_purchaser_user_id, @analytics_purchaser_user_id);

INSERT INTO `purchase_order_items`
  (`id`, `tenant_id`, `po_id`, `sku_id`, `qty_ordered`, `qty_received`, `purchase_unit`, `unit_price`, `amount`, `created_by`, `updated_by`)
VALUES
  (910611, 1, @analytics_purchase_order_a_id, @analytics_raw_fabric_sku_id, 20.0000, 18.0000, 'm', 12.0000, 240.00, @analytics_purchaser_user_id, @analytics_purchaser_user_id),
  (910612, 1, @analytics_purchase_order_a_id, @analytics_carton_sku_id, 10.0000, 10.0000, '个', 5.0000, 50.00, @analytics_purchaser_user_id, @analytics_purchaser_user_id),
  (910613, 1, @analytics_purchase_order_b_id, @analytics_wip_frame_sku_id, 4.0000, 2.0000, '套', 150.0000, 600.00, @analytics_purchaser_user_id, @analytics_purchaser_user_id);

INSERT INTO `production_orders`
  (`id`, `tenant_id`, `work_order_no`, `sales_order_id`, `sku_id`, `bom_header_id`, `process_template_id`, `qty_planned`, `qty_completed`, `status`, `priority`, `planned_start`, `planned_end`, `actual_start`, `actual_end`, `notes`, `created_at`, `updated_at`, `created_by`, `updated_by`)
VALUES
  (@analytics_production_order_scheduled_id, 1, 'WO-ANLT-001', @analytics_sales_order_confirmed_id, @analytics_fg_sofa_sku_id, @analytics_bom_id, @analytics_template_id, 12.0000, 0.0000, 'scheduled', 80, DATE_SUB(CURDATE(), INTERVAL 1 DAY), DATE_ADD(CURDATE(), INTERVAL 2 DAY), NULL, NULL, '经营分析演示待开工工单', DATE_SUB(NOW(), INTERVAL 6 DAY), DATE_SUB(NOW(), INTERVAL 6 DAY), @analytics_supervisor_user_id, @analytics_supervisor_user_id),
  (@analytics_production_order_in_progress_id, 1, 'WO-ANLT-002', @analytics_sales_order_confirmed_id, @analytics_fg_sofa_sku_id, @analytics_bom_id, @analytics_template_id, 20.0000, 8.0000, 'in_progress', 85, DATE_SUB(CURDATE(), INTERVAL 2 DAY), DATE_ADD(CURDATE(), INTERVAL 1 DAY), DATE_SUB(NOW(), INTERVAL 2 DAY), NULL, '经营分析演示在制工单', DATE_SUB(NOW(), INTERVAL 4 DAY), DATE_SUB(NOW(), INTERVAL 1 DAY), @analytics_supervisor_user_id, @analytics_supervisor_user_id),
  (@analytics_production_order_completed_id, 1, 'WO-ANLT-003', @analytics_sales_order_confirmed_id, @analytics_fg_sofa_sku_id, @analytics_bom_id, @analytics_template_id, 20.0000, 18.0000, 'completed', 70, DATE_SUB(CURDATE(), INTERVAL 6 DAY), DATE_SUB(CURDATE(), INTERVAL 2 DAY), DATE_SUB(NOW(), INTERVAL 4 DAY), DATE_SUB(NOW(), INTERVAL 2 DAY), '经营分析演示完工工单', DATE_SUB(NOW(), INTERVAL 8 DAY), DATE_SUB(NOW(), INTERVAL 2 DAY), @analytics_supervisor_user_id, @analytics_supervisor_user_id);

INSERT INTO `production_schedules`
  (`id`, `tenant_id`, `schedule_date`, `production_order_id`, `process_step_id`, `workstation_id`, `worker_id`, `planned_qty`, `status`, `ai_generated`, `created_by`, `updated_by`)
VALUES
  (@analytics_schedule_cut_id, 1, DATE_SUB(CURDATE(), INTERVAL 3 DAY), @analytics_production_order_completed_id, @analytics_step_cut_id, @analytics_workstation_id, @analytics_worker_user_id, 10.0000, 'completed', 1, @analytics_supervisor_user_id, @analytics_supervisor_user_id),
  (@analytics_schedule_assemble_id, 1, DATE_SUB(CURDATE(), INTERVAL 2 DAY), @analytics_production_order_completed_id, @analytics_step_assemble_id, @analytics_workstation_id, @analytics_worker_user_id, 8.0000, 'completed', 1, @analytics_supervisor_user_id, @analytics_supervisor_user_id);

INSERT INTO `production_tasks`
  (`id`, `tenant_id`, `task_no`, `schedule_id`, `production_order_id`, `process_step_id`, `worker_id`, `task_date`, `planned_qty`, `completed_qty`, `status`, `started_at`, `completed_at`, `created_at`, `updated_at`, `created_by`, `updated_by`)
VALUES
  (@analytics_task_cut_id, 1, 'TASK-ANLT-001', @analytics_schedule_cut_id, @analytics_production_order_completed_id, @analytics_step_cut_id, @analytics_worker_user_id, DATE_SUB(CURDATE(), INTERVAL 3 DAY), 10.0000, 9.0000, 'completed', DATE_SUB(NOW(), INTERVAL 3 DAY), DATE_SUB(NOW(), INTERVAL 3 DAY), DATE_SUB(NOW(), INTERVAL 3 DAY), DATE_SUB(NOW(), INTERVAL 3 DAY), @analytics_supervisor_user_id, @analytics_supervisor_user_id),
  (@analytics_task_assemble_id, 1, 'TASK-ANLT-002', @analytics_schedule_assemble_id, @analytics_production_order_completed_id, @analytics_step_assemble_id, @analytics_worker_user_id, DATE_SUB(CURDATE(), INTERVAL 2 DAY), 8.0000, 8.0000, 'completed', DATE_SUB(NOW(), INTERVAL 2 DAY), DATE_SUB(NOW(), INTERVAL 2 DAY), DATE_SUB(NOW(), INTERVAL 2 DAY), DATE_SUB(NOW(), INTERVAL 2 DAY), @analytics_supervisor_user_id, @analytics_supervisor_user_id);

-- ═════════════════════════════════════════════════════════════════════════════
-- Sprint 3 新增表结构（V2 全链路贯通）
-- ═════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- S3-01. 来料质检表 incoming_inspection_records
-- ─────────────────────────────────────────────────────────────────────────────
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

-- ─────────────────────────────────────────────────────────────────────────────
-- S3-02. 来料质检明细表 incoming_inspection_items
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `incoming_inspection_items` (
  `id`                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`           BIGINT UNSIGNED NOT NULL,
  `inspection_id`       BIGINT UNSIGNED NOT NULL COMMENT '关联来料质检单ID',
  `sku_id`              BIGINT UNSIGNED NOT NULL,
  `po_item_id`          BIGINT UNSIGNED NOT NULL COMMENT '关联采购订单明细ID',
  `dye_lot_no`          VARCHAR(100)    DEFAULT NULL COMMENT '继承送货明细的缸号',
  `qty_delivered`       DECIMAL(16,4)   NOT NULL COMMENT '本次到货数量',
  `qty_sampled`         DECIMAL(16,4)   NOT NULL DEFAULT 0 COMMENT '抽检数量',
  `qty_passed`          DECIMAL(16,4)   NOT NULL DEFAULT 0 COMMENT '合格数量',
  `qty_failed`          DECIMAL(16,4)   NOT NULL DEFAULT 0 COMMENT '不合格数量',
  `result`              ENUM('pass','fail','conditional_pass') DEFAULT NULL,
  `defect_types`        JSON            DEFAULT NULL COMMENT '缺陷类型数组',
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

-- ─────────────────────────────────────────────────────────────────────────────
-- S3-03. 退货单表 return_orders
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `return_orders` (
  `id`                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`           BIGINT UNSIGNED NOT NULL,
  `return_no`           VARCHAR(50)     NOT NULL COMMENT '退货单号，格式 RTN-YYYYMMDD-NNNN',
  `return_type`         ENUM('purchase_return','production_return') NOT NULL DEFAULT 'purchase_return',
  `source_po_id`        BIGINT UNSIGNED DEFAULT NULL COMMENT '来源采购订单ID',
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

-- ─────────────────────────────────────────────────────────────────────────────
-- S3-04. 退货单明细表 return_order_items
-- ─────────────────────────────────────────────────────────────────────────────
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

-- ─────────────────────────────────────────────────────────────────────────────
-- S3-05. BOM 版本快照表 bom_version_snapshots（BD-001）
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `bom_version_snapshots` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`       BIGINT UNSIGNED NOT NULL,
  `bom_header_id`   BIGINT UNSIGNED NOT NULL COMMENT '原始 BOM 表头 ID',
  `snapshot_no`     VARCHAR(50)     NOT NULL COMMENT '快照编号',
  `bom_version`     VARCHAR(20)     NOT NULL COMMENT '快照时的 BOM 版本号',
  `snapshot_data`   JSON            NOT NULL COMMENT '展开后的完整物料清单 JSON',
  `snapshot_hash`   VARCHAR(64)     NOT NULL COMMENT 'snapshot_data 的 SHA256 摘要',
  `created_at`      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_by`      BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_snapshot_no` (`tenant_id`, `snapshot_no`),
  KEY `idx_tenant_bom` (`tenant_id`, `bom_header_id`),
  KEY `idx_hash` (`snapshot_hash`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='BOM版本快照表（工单创建时生成）';

-- ─────────────────────────────────────────────────────────────────────────────
-- S3-06. 原材料需求计划表 material_requirements
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `material_requirements` (
  `id`                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`           BIGINT UNSIGNED NOT NULL,
  `production_order_id` BIGINT UNSIGNED NOT NULL,
  `bom_snapshot_id`     BIGINT UNSIGNED NOT NULL COMMENT '关联 BOM 快照',
  `sku_id`              BIGINT UNSIGNED NOT NULL COMMENT '原材料 SKU',
  `qty_required`        DECIMAL(16,4)   NOT NULL COMMENT 'BOM 展开所需数量（含损耗）',
  `qty_reserved`        DECIMAL(16,4)   NOT NULL DEFAULT 0 COMMENT '已从库存预留数量',
  `qty_shortage`        DECIMAL(16,4)   NOT NULL DEFAULT 0 COMMENT '缺口数量',
  `status`              ENUM('shortage','partial','fulfilled') NOT NULL DEFAULT 'shortage',
  `suggestion_id`       BIGINT UNSIGNED DEFAULT NULL COMMENT '关联采购建议ID',
  `created_at`          DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`          DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_tenant_order` (`tenant_id`, `production_order_id`),
  KEY `idx_tenant_sku_status` (`tenant_id`, `sku_id`, `status`),
  KEY `idx_bom_snapshot` (`bom_snapshot_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='生产工单原材料需求计划表';

-- ═════════════════════════════════════════════════════════════════════════════
-- Sprint 3 现有表结构变更（ALTER TABLE）
-- ═════════════════════════════════════════════════════════════════════════════

-- S3-A1: production_orders 增加 BOM 快照和原料状态字段
ALTER TABLE `production_orders`
  ADD COLUMN IF NOT EXISTS `bom_snapshot_id` BIGINT UNSIGNED DEFAULT NULL
    COMMENT 'BOM版本快照ID（创建工单时锁定，BD-001）'
    AFTER `bom_header_id`,
  ADD COLUMN IF NOT EXISTS `material_status` ENUM('unchecked','shortage','partial','ready') NOT NULL DEFAULT 'unchecked'
    COMMENT '原材料备料状态'
    AFTER `status`;

-- S3-A2: production_tasks 增加 version 字段（乐观锁）和 exception/suspended 状态
-- 注意：MySQL ALTER TABLE MODIFY COLUMN 会重建列定义，先修改 status 枚举扩展
ALTER TABLE `production_tasks`
  MODIFY COLUMN `status` ENUM('pending','started','completed','cancelled','exception','suspended') NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS `version` INT UNSIGNED NOT NULL DEFAULT 1 COMMENT '乐观锁版本号'
    AFTER `completed_at`;

-- S3-A3: delivery_notes 增加质检关联字段
ALTER TABLE `delivery_notes`
  ADD COLUMN IF NOT EXISTS `inspection_id` BIGINT UNSIGNED DEFAULT NULL
    COMMENT '关联来料质检单ID'
    AFTER `status`,
  ADD COLUMN IF NOT EXISTS `receipt_id` BIGINT UNSIGNED DEFAULT NULL
    COMMENT '关联入库单ID'
    AFTER `inspection_id`;

-- S3-A4: purchase_order_items 增加质检汇总字段
ALTER TABLE `purchase_order_items`
  ADD COLUMN IF NOT EXISTS `qty_passed` DECIMAL(16,4) NOT NULL DEFAULT 0
    COMMENT '累计质检合格入库数量'
    AFTER `qty_received`,
  ADD COLUMN IF NOT EXISTS `qty_rejected` DECIMAL(16,4) NOT NULL DEFAULT 0
    COMMENT '累计质检不合格退货数量'
    AFTER `qty_passed`;

-- S3-A5: process_steps 增加工序输出类型字段
ALTER TABLE `process_steps`
  ADD COLUMN IF NOT EXISTS `output_type` ENUM('semi_finished','final_product','none') NOT NULL DEFAULT 'none'
    COMMENT '工序产出类型'
    AFTER `workstation_type`,
  ADD COLUMN IF NOT EXISTS `output_sku_id` BIGINT UNSIGNED DEFAULT NULL
    COMMENT '工序产出半成品 SKU ID'
    AFTER `output_type`;

-- S3-A6: purchase_suggestions 增加来源字段
ALTER TABLE `purchase_suggestions`
  ADD COLUMN IF NOT EXISTS `source` ENUM('ai_schedule','production_shortage','manual') NOT NULL DEFAULT 'ai_schedule'
    COMMENT '建议来源'
    AFTER `suggestion_no`,
  ADD COLUMN IF NOT EXISTS `production_order_id` BIGINT UNSIGNED DEFAULT NULL
    COMMENT '关联生产工单ID（缺料触发时）'
    AFTER `source`;

-- S5-A1: process_steps 增加执行模式（内部 / 外协）
ALTER TABLE `process_steps`
  ADD COLUMN IF NOT EXISTS `execution_mode` ENUM('internal','outsource') NOT NULL DEFAULT 'internal'
    COMMENT '执行模式：internal=厂内，outsource=外协采购'
    AFTER `output_sku_id`;

-- S5-A2: purchase_suggestions 增加外协作业关联字段，并扩展来源枚举
ALTER TABLE `purchase_suggestions`
  ADD COLUMN IF NOT EXISTS `production_operation_id` BIGINT UNSIGNED DEFAULT NULL
    COMMENT '关联生产作业ID（外协半成品）'
    AFTER `production_order_id`;

ALTER TABLE `purchase_suggestions`
  MODIFY COLUMN `source` ENUM('ai_schedule','production_shortage','manual','outsource_operation')
  NOT NULL DEFAULT 'ai_schedule'
  COMMENT '建议来源';

-- S5-A3: purchase_order_items 增加外协作业关联字段
ALTER TABLE `purchase_order_items`
  ADD COLUMN IF NOT EXISTS `production_operation_id` BIGINT UNSIGNED DEFAULT NULL
    COMMENT '关联生产作业ID（外协半成品）'
    AFTER `po_id`;

-- ── 7. 验证种子数据 ───────────────────────────────────────────────────────────
SELECT '=== 种子数据初始化完成 ===' AS info;
SELECT CONCAT('租户数: ', COUNT(*)) AS info FROM `tenants`;
SELECT CONCAT('用户数: ', COUNT(*)) AS info FROM `users`;
SELECT CONCAT('角色数: ', COUNT(*)) AS info FROM `roles`;
SELECT CONCAT('SKU分类数: ', COUNT(*)) AS info FROM `sku_categories`;
SELECT CONCAT('SKU数: ', COUNT(*)) AS info FROM `skus`;
