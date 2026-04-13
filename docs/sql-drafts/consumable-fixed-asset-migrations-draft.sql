-- =============================================================================
-- consumable-fixed-asset-migrations-draft.sql
-- 损耗品与固定资产扩展：迁移 SQL 初稿
-- 创建日期：2026-04-13
-- 说明：
--   1) 本文件为设计草案，不应直接在生产环境执行
--   2) 与现有 init.sql / migrations 风格保持一致，使用 safe_add_* 形式保证可重复执行
--   3) 实际上线前应补充 FK、脏数据修复脚本、灰度/回滚脚本
-- =============================================================================

-- =============================================================================
-- M20260413_sku_control_mode_extension.sql
-- =============================================================================

DROP PROCEDURE IF EXISTS `safe_add_column_m20260413`;
DELIMITER $$
CREATE PROCEDURE `safe_add_column_m20260413`(
  IN p_table VARCHAR(64),
  IN p_column VARCHAR(64),
  IN p_definition TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = p_table
      AND column_name = p_column
  ) THEN
    SET @sql = CONCAT('ALTER TABLE `', p_table, '` ADD COLUMN `', p_column, '` ', p_definition);
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END$$
DELIMITER ;

DROP PROCEDURE IF EXISTS `safe_add_index_m20260413`;
DELIMITER $$
CREATE PROCEDURE `safe_add_index_m20260413`(
  IN p_table VARCHAR(64),
  IN p_index VARCHAR(64),
  IN p_definition TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = p_table
      AND index_name = p_index
  ) THEN
    SET @sql = CONCAT('ALTER TABLE `', p_table, '` ADD INDEX `', p_index, '` ', p_definition);
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END$$
DELIMITER ;

CALL safe_add_column_m20260413(
  'skus',
  'business_class',
  "ENUM('production_material','consumable','fixed_asset') NOT NULL DEFAULT 'production_material' COMMENT '业务大类：生产物料 / 损耗品 / 固定资产'"
);

CALL safe_add_column_m20260413(
  'skus',
  'control_mode',
  "ENUM('mrp','stock_only','direct_expense','asset') NOT NULL DEFAULT 'mrp' COMMENT '控制模式：MRP驱动 / 仅库存 / 直耗 / 资产'"
);

CALL safe_add_column_m20260413(
  'skus',
  'allow_bom_component',
  "TINYINT(1) NOT NULL DEFAULT 1 COMMENT '是否允许作为BOM子项'"
);

CALL safe_add_column_m20260413(
  'skus',
  'allow_purchase',
  "TINYINT(1) NOT NULL DEFAULT 1 COMMENT '是否允许走采购流程'"
);

CALL safe_add_column_m20260413(
  'skus',
  'allow_inventory',
  "TINYINT(1) NOT NULL DEFAULT 1 COMMENT '是否进入库存账'"
);

CALL safe_add_column_m20260413(
  'skus',
  'allow_production_issue',
  "TINYINT(1) NOT NULL DEFAULT 1 COMMENT '是否允许生产领料/投料'"
);

CALL safe_add_column_m20260413(
  'skus',
  'requires_asset_acceptance',
  "TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否必须通过资产验收建卡'"
);

CALL safe_add_column_m20260413(
  'skus',
  'default_warehouse_type',
  "VARCHAR(30) DEFAULT NULL COMMENT '默认仓库类型'"
);

CALL safe_add_column_m20260413(
  'skus',
  'approval_policy_code',
  "VARCHAR(50) DEFAULT NULL COMMENT '审批策略编码'"
);

CALL safe_add_column_m20260413(
  'skus',
  'asset_tracking_mode',
  "ENUM('none','batch','serial') NOT NULL DEFAULT 'none' COMMENT '资产追踪模式'"
);

CALL safe_add_index_m20260413(
  'skus',
  'idx_tenant_business_class',
  '(`tenant_id`, `business_class`)'
);

CALL safe_add_index_m20260413(
  'skus',
  'idx_tenant_control_mode',
  '(`tenant_id`, `control_mode`)'
);

UPDATE `skus` s
INNER JOIN `sku_categories` c ON c.id = s.category1_id
SET
  s.business_class = CASE
    WHEN c.code IN ('MATERIAL', 'SEMIFIN', 'FINISHED') THEN 'production_material'
    WHEN c.code = 'PACKING' THEN 'consumable'
    ELSE s.business_class
  END,
  s.control_mode = CASE
    WHEN c.code IN ('MATERIAL', 'SEMIFIN', 'FINISHED') THEN 'mrp'
    WHEN c.code = 'PACKING' THEN 'stock_only'
    ELSE s.control_mode
  END,
  s.allow_bom_component = CASE
    WHEN c.code IN ('MATERIAL', 'SEMIFIN') THEN 1
    WHEN c.code IN ('FINISHED', 'PACKING') THEN 0
    ELSE s.allow_bom_component
  END,
  s.allow_purchase = CASE
    WHEN c.code = 'FINISHED' THEN 0
    ELSE 1
  END,
  s.allow_inventory = 1,
  s.allow_production_issue = CASE
    WHEN c.code IN ('MATERIAL', 'SEMIFIN') THEN 1
    ELSE 0
  END,
  s.requires_asset_acceptance = 0,
  s.default_warehouse_type = CASE
    WHEN c.code = 'MATERIAL' THEN 'raw_material'
    WHEN c.code = 'SEMIFIN' THEN 'raw_material'
    WHEN c.code = 'FINISHED' THEN 'finished'
    WHEN c.code = 'PACKING' THEN 'consumable'
    ELSE s.default_warehouse_type
  END,
  s.asset_tracking_mode = 'none'
WHERE c.code IN ('MATERIAL', 'SEMIFIN', 'FINISHED', 'PACKING');

-- =============================================================================
-- M20260413_consumable_issue_tables.sql
-- =============================================================================

CREATE TABLE IF NOT EXISTS `sku_consumable_profiles` (
  `id`                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`           BIGINT UNSIGNED NOT NULL,
  `sku_id`              BIGINT UNSIGNED NOT NULL,
  `issue_mode`          ENUM('department_issue','direct_expense') NOT NULL DEFAULT 'department_issue',
  `approval_level`      ENUM('none','normal','strict') NOT NULL DEFAULT 'normal',
  `expense_subject`     VARCHAR(100) DEFAULT NULL,
  `min_stock`           DECIMAL(16,4) NOT NULL DEFAULT 0,
  `max_stock`           DECIMAL(16,4) DEFAULT NULL,
  `purchase_lead_days`  SMALLINT UNSIGNED DEFAULT NULL,
  `issue_dept_required` TINYINT(1) NOT NULL DEFAULT 1,
  `notes`               VARCHAR(500) DEFAULT NULL,
  `created_at`          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by`          BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_by`          BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_sku` (`tenant_id`, `sku_id`),
  KEY `idx_tenant_issue_mode` (`tenant_id`, `issue_mode`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='损耗品控制档案';

CALL safe_add_column_m20260413(
  'purchase_order_items',
  'business_class',
  "ENUM('production_material','consumable','fixed_asset') NOT NULL DEFAULT 'production_material' COMMENT '采购明细业务大类'"
);

CALL safe_add_column_m20260413(
  'purchase_order_items',
  'receipt_mode',
  "ENUM('inventory','direct_expense','asset_capitalization') NOT NULL DEFAULT 'inventory' COMMENT '收货入账模式'"
);

CALL safe_add_column_m20260413(
  'purchase_order_items',
  'requires_acceptance',
  "TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否要求验收'"
);

CALL safe_add_column_m20260413(
  'purchase_order_items',
  'request_department_id',
  "BIGINT UNSIGNED DEFAULT NULL COMMENT '需求部门'"
);

CALL safe_add_column_m20260413(
  'purchase_order_items',
  'budget_code',
  "VARCHAR(50) DEFAULT NULL COMMENT '预算编号'"
);

CALL safe_add_index_m20260413(
  'purchase_order_items',
  'idx_tenant_business_class',
  '(`tenant_id`, `business_class`)'
);

CALL safe_add_column_m20260413(
  'inventory_transactions',
  'business_class',
  "ENUM('production_material','consumable') NOT NULL DEFAULT 'production_material' COMMENT '库存流水业务大类'"
);

CALL safe_add_column_m20260413(
  'inventory_transactions',
  'department_id',
  "BIGINT UNSIGNED DEFAULT NULL COMMENT '损耗品领用部门'"
);

CALL safe_add_column_m20260413(
  'inventory_transactions',
  'issue_order_id',
  "BIGINT UNSIGNED DEFAULT NULL COMMENT '关联损耗品领用单'"
);

CALL safe_add_index_m20260413(
  'inventory_transactions',
  'idx_tenant_business_created',
  '(`tenant_id`, `business_class`, `created_at`)'
);

CREATE TABLE IF NOT EXISTS `consumable_issue_orders` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`       BIGINT UNSIGNED NOT NULL,
  `issue_no`        VARCHAR(50) NOT NULL,
  `department_id`   BIGINT UNSIGNED NOT NULL,
  `purpose`         VARCHAR(200) DEFAULT NULL,
  `status`          ENUM('draft','approved','issued','cancelled') NOT NULL DEFAULT 'draft',
  `requested_by`    BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `approved_by`     BIGINT UNSIGNED DEFAULT NULL,
  `approved_at`     DATETIME(3) DEFAULT NULL,
  `issued_by`       BIGINT UNSIGNED DEFAULT NULL,
  `issued_at`       DATETIME(3) DEFAULT NULL,
  `notes`           VARCHAR(500) DEFAULT NULL,
  `created_at`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by`      BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_by`      BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_issue_no` (`tenant_id`, `issue_no`),
  KEY `idx_tenant_department_status` (`tenant_id`, `department_id`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='损耗品领用单';

CREATE TABLE IF NOT EXISTS `consumable_issue_items` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`       BIGINT UNSIGNED NOT NULL,
  `issue_order_id`  BIGINT UNSIGNED NOT NULL,
  `sku_id`          BIGINT UNSIGNED NOT NULL,
  `warehouse_id`    BIGINT UNSIGNED DEFAULT NULL,
  `location_id`     BIGINT UNSIGNED DEFAULT NULL,
  `qty_issued`      DECIMAL(16,4) NOT NULL,
  `stock_unit`      VARCHAR(20) NOT NULL,
  `expense_subject` VARCHAR(100) DEFAULT NULL,
  `notes`           VARCHAR(500) DEFAULT NULL,
  `created_at`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by`      BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_by`      BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_tenant_issue_order` (`tenant_id`, `issue_order_id`),
  KEY `idx_tenant_sku` (`tenant_id`, `sku_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='损耗品领用明细';

-- =============================================================================
-- M20260413_asset_ledger_tables.sql
-- =============================================================================

CREATE TABLE IF NOT EXISTS `sku_asset_profiles` (
  `id`                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`             BIGINT UNSIGNED NOT NULL,
  `sku_id`                BIGINT UNSIGNED NOT NULL,
  `asset_category`        VARCHAR(50) NOT NULL,
  `depreciation_method`   ENUM('straight_line','manual','none') NOT NULL DEFAULT 'straight_line',
  `useful_life_months`    SMALLINT UNSIGNED DEFAULT NULL,
  `residual_rate`         DECIMAL(5,2) NOT NULL DEFAULT 0,
  `capex_subject`         VARCHAR(100) DEFAULT NULL,
  `requires_serial_no`    TINYINT(1) NOT NULL DEFAULT 1,
  `maintenance_cycle_days` SMALLINT UNSIGNED DEFAULT NULL,
  `warranty_months`       SMALLINT UNSIGNED DEFAULT NULL,
  `notes`                 VARCHAR(500) DEFAULT NULL,
  `created_at`            DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`            DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by`            BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_by`            BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_sku` (`tenant_id`, `sku_id`),
  KEY `idx_tenant_asset_category` (`tenant_id`, `asset_category`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='固定资产控制档案';

CREATE TABLE IF NOT EXISTS `asset_cards` (
  `id`                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`          BIGINT UNSIGNED NOT NULL,
  `sku_id`             BIGINT UNSIGNED NOT NULL,
  `asset_no`           VARCHAR(50) NOT NULL,
  `asset_name`         VARCHAR(200) NOT NULL,
  `spec`               VARCHAR(500) DEFAULT NULL,
  `serial_no`          VARCHAR(100) DEFAULT NULL,
  `purchase_order_id`  BIGINT UNSIGNED DEFAULT NULL,
  `purchase_item_id`   BIGINT UNSIGNED DEFAULT NULL,
  `receipt_id`         BIGINT UNSIGNED DEFAULT NULL,
  `warehouse_id`       BIGINT UNSIGNED DEFAULT NULL,
  `location_id`        BIGINT UNSIGNED DEFAULT NULL,
  `department_id`      BIGINT UNSIGNED DEFAULT NULL,
  `custodian_user_id`  BIGINT UNSIGNED DEFAULT NULL,
  `original_value`     DECIMAL(16,2) NOT NULL,
  `capitalized_at`     DATETIME(3) DEFAULT NULL,
  `status`             ENUM('in_storage','in_use','idle','repair','scrapped') NOT NULL DEFAULT 'in_storage',
  `notes`              VARCHAR(500) DEFAULT NULL,
  `created_at`         DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`         DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by`         BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_by`         BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_asset_no` (`tenant_id`, `asset_no`),
  UNIQUE KEY `uk_tenant_serial_no` (`tenant_id`, `serial_no`),
  KEY `idx_tenant_status` (`tenant_id`, `status`),
  KEY `idx_tenant_department` (`tenant_id`, `department_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='固定资产卡片台账';

CREATE TABLE IF NOT EXISTS `asset_movements` (
  `id`                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`          BIGINT UNSIGNED NOT NULL,
  `asset_card_id`      BIGINT UNSIGNED NOT NULL,
  `movement_no`        VARCHAR(50) NOT NULL,
  `movement_type`      ENUM('receipt','assign','transfer','return','repair','scrap') NOT NULL,
  `from_department_id` BIGINT UNSIGNED DEFAULT NULL,
  `to_department_id`   BIGINT UNSIGNED DEFAULT NULL,
  `from_location_id`   BIGINT UNSIGNED DEFAULT NULL,
  `to_location_id`     BIGINT UNSIGNED DEFAULT NULL,
  `reference_type`     VARCHAR(50) DEFAULT NULL,
  `reference_id`       BIGINT UNSIGNED DEFAULT NULL,
  `notes`              VARCHAR(500) DEFAULT NULL,
  `occurred_at`        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_at`         DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_by`         BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_movement_no` (`tenant_id`, `movement_no`),
  KEY `idx_tenant_asset_time` (`tenant_id`, `asset_card_id`, `occurred_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='固定资产流转流水';

-- =============================================================================
-- M20260413_bom_mrp_guard_by_business_class.sql
-- =============================================================================
-- 注意：
--   该文件对应的是服务端代码守卫，不是纯 DDL 迁移。
--   这里仅补充数据修复检查 SQL，供上线前巡检使用。

-- 检查：是否已有非生产型 SKU 被放入 BOM
SELECT
  bi.id AS bom_item_id,
  bi.bom_header_id,
  bi.component_sku_id,
  s.sku_code,
  s.name,
  s.business_class,
  s.allow_bom_component
FROM bom_items bi
INNER JOIN skus s
  ON s.id = bi.component_sku_id
 AND s.tenant_id = bi.tenant_id
WHERE s.business_class <> 'production_material'
   OR s.allow_bom_component = 0;

-- 检查：是否有固定资产被错误配置为库存型收货
SELECT
  poi.id,
  poi.po_id,
  poi.sku_id,
  poi.business_class,
  poi.receipt_mode
FROM purchase_order_items poi
WHERE poi.business_class = 'fixed_asset'
  AND poi.receipt_mode = 'inventory';

-- 建议默认仓库（按租户补齐，以下为示例插入）
INSERT INTO warehouses
  (tenant_id, code, name, type, status, created_by, updated_by)
SELECT
  t.id, 'WH-CONS', '损耗品仓', 'consumable', 'active', 0, 0
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1
  FROM warehouses w
  WHERE w.tenant_id = t.id AND w.code = 'WH-CONS'
);

INSERT INTO warehouses
  (tenant_id, code, name, type, status, created_by, updated_by)
SELECT
  t.id, 'WH-AST-PEND', '资产待验收仓', 'asset_pending', 'active', 0, 0
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1
  FROM warehouses w
  WHERE w.tenant_id = t.id AND w.code = 'WH-AST-PEND'
);

INSERT INTO warehouses
  (tenant_id, code, name, type, status, created_by, updated_by)
SELECT
  t.id, 'WH-AST', '资产仓', 'asset', 'active', 0, 0
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1
  FROM warehouses w
  WHERE w.tenant_id = t.id AND w.code = 'WH-AST'
);

DROP PROCEDURE IF EXISTS `safe_add_column_m20260413`;
DROP PROCEDURE IF EXISTS `safe_add_index_m20260413`;

