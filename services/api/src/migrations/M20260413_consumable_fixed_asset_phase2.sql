-- =============================================================================
-- M20260413_consumable_fixed_asset_phase2.sql
-- 第二阶段/第三阶段：采购收货控制字段、损耗品领用、固定资产台账
-- 说明：
--   1) 所有变更均保持前向兼容，不改写现有生产物料流程
--   2) purchase_receipt_items 若历史不存在，则在本迁移内补建
-- =============================================================================

DROP PROCEDURE IF EXISTS `safe_add_column_m20260413_phase2`;
DELIMITER $$
CREATE PROCEDURE `safe_add_column_m20260413_phase2`(
  IN p_table VARCHAR(64),
  IN p_column VARCHAR(64),
  IN p_definition TEXT
)
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = DATABASE()
      AND table_name = p_table
  ) AND NOT EXISTS (
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

DROP PROCEDURE IF EXISTS `safe_add_index_m20260413_phase2`;
DELIMITER $$
CREATE PROCEDURE `safe_add_index_m20260413_phase2`(
  IN p_table VARCHAR(64),
  IN p_index VARCHAR(64),
  IN p_definition TEXT
)
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = DATABASE()
      AND table_name = p_table
  ) AND NOT EXISTS (
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

CALL safe_add_column_m20260413_phase2(
  'purchase_order_items',
  'business_class',
  "ENUM('production_material','finished_goods','consumable','fixed_asset') NOT NULL DEFAULT 'production_material' COMMENT '采购明细业务大类' AFTER `sku_id`"
);
CALL safe_add_column_m20260413_phase2(
  'purchase_order_items',
  'receipt_mode',
  "ENUM('inventory','direct_expense','asset_capitalization') NOT NULL DEFAULT 'inventory' COMMENT '收货入账模式' AFTER `business_class`"
);
CALL safe_add_column_m20260413_phase2(
  'purchase_order_items',
  'requires_acceptance',
  "TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否要求验收' AFTER `receipt_mode`"
);
CALL safe_add_column_m20260413_phase2(
  'purchase_order_items',
  'request_department_id',
  "BIGINT UNSIGNED DEFAULT NULL COMMENT '需求部门ID' AFTER `requires_acceptance`"
);
CALL safe_add_column_m20260413_phase2(
  'purchase_order_items',
  'budget_code',
  "VARCHAR(50) DEFAULT NULL COMMENT '预算编号' AFTER `request_department_id`"
);
CALL safe_add_index_m20260413_phase2(
  'purchase_order_items',
  'idx_tenant_business_receipt',
  '(`tenant_id`, `business_class`, `receipt_mode`)'
);

CREATE TABLE IF NOT EXISTS `purchase_receipt_items` (
  `id`                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`             BIGINT UNSIGNED NOT NULL,
  `receipt_id`            BIGINT UNSIGNED NOT NULL,
  `sku_id`                BIGINT UNSIGNED NOT NULL,
  `po_item_id`            BIGINT UNSIGNED DEFAULT NULL,
  `business_class`        ENUM('production_material','finished_goods','consumable','fixed_asset') NOT NULL DEFAULT 'production_material',
  `receipt_mode`          ENUM('inventory','direct_expense','asset_capitalization') NOT NULL DEFAULT 'inventory',
  `requires_acceptance`   TINYINT(1) NOT NULL DEFAULT 0,
  `request_department_id` BIGINT UNSIGNED DEFAULT NULL,
  `budget_code`           VARCHAR(50) DEFAULT NULL,
  `dye_lot_no`            VARCHAR(100) DEFAULT NULL,
  `qty_received`          DECIMAL(16,4) NOT NULL,
  `purchase_unit`         VARCHAR(20) NOT NULL,
  `unit_price`            DECIMAL(14,4) NOT NULL,
  `amount`                DECIMAL(16,2) NOT NULL,
  `created_at`            DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`            DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by`            BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_by`            BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_tenant_receipt` (`tenant_id`, `receipt_id`),
  KEY `idx_tenant_sku` (`tenant_id`, `sku_id`),
  KEY `idx_tenant_po_item` (`tenant_id`, `po_item_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='采购入库明细表';

CALL safe_add_column_m20260413_phase2(
  'purchase_receipt_items',
  'po_item_id',
  "BIGINT UNSIGNED DEFAULT NULL COMMENT '关联采购明细ID' AFTER `sku_id`"
);
CALL safe_add_column_m20260413_phase2(
  'purchase_receipt_items',
  'business_class',
  "ENUM('production_material','finished_goods','consumable','fixed_asset') NOT NULL DEFAULT 'production_material' COMMENT '入库明细业务大类' AFTER `po_item_id`"
);
CALL safe_add_column_m20260413_phase2(
  'purchase_receipt_items',
  'receipt_mode',
  "ENUM('inventory','direct_expense','asset_capitalization') NOT NULL DEFAULT 'inventory' COMMENT '收货入账模式' AFTER `business_class`"
);
CALL safe_add_column_m20260413_phase2(
  'purchase_receipt_items',
  'requires_acceptance',
  "TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否要求资产验收' AFTER `receipt_mode`"
);
CALL safe_add_column_m20260413_phase2(
  'purchase_receipt_items',
  'request_department_id',
  "BIGINT UNSIGNED DEFAULT NULL COMMENT '需求部门ID' AFTER `requires_acceptance`"
);
CALL safe_add_column_m20260413_phase2(
  'purchase_receipt_items',
  'budget_code',
  "VARCHAR(50) DEFAULT NULL COMMENT '预算编号' AFTER `request_department_id`"
);
CALL safe_add_index_m20260413_phase2(
  'purchase_receipt_items',
  'idx_tenant_receipt_mode',
  '(`tenant_id`, `business_class`, `receipt_mode`)'
);

CALL safe_add_column_m20260413_phase2(
  'inventory_transactions',
  'business_class',
  "ENUM('production_material','finished_goods','consumable') NOT NULL DEFAULT 'production_material' COMMENT '库存流水业务大类' AFTER `sku_id`"
);
CALL safe_add_column_m20260413_phase2(
  'inventory_transactions',
  'department_id',
  "BIGINT UNSIGNED DEFAULT NULL COMMENT '损耗品领用部门ID' AFTER `business_class`"
);
CALL safe_add_column_m20260413_phase2(
  'inventory_transactions',
  'issue_order_id',
  "BIGINT UNSIGNED DEFAULT NULL COMMENT '关联损耗品领用单ID' AFTER `department_id`"
);
CALL safe_add_index_m20260413_phase2(
  'inventory_transactions',
  'idx_tenant_business_created',
  '(`tenant_id`, `business_class`, `created_at`)'
);

CREATE TABLE IF NOT EXISTS `consumable_issue_orders` (
  `id`                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`          BIGINT UNSIGNED NOT NULL,
  `issue_no`           VARCHAR(50) NOT NULL,
  `request_department_id` BIGINT UNSIGNED DEFAULT NULL,
  `purpose`            VARCHAR(200) DEFAULT NULL,
  `status`             ENUM('draft','approved','issued','rejected','cancelled') NOT NULL DEFAULT 'draft',
  `notes`              VARCHAR(500) DEFAULT NULL,
  `approved_by`        BIGINT UNSIGNED DEFAULT NULL,
  `approved_at`        DATETIME(3) DEFAULT NULL,
  `issued_by`          BIGINT UNSIGNED DEFAULT NULL,
  `issued_at`          DATETIME(3) DEFAULT NULL,
  `created_at`         DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`         DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by`         BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_by`         BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_issue_no` (`tenant_id`, `issue_no`),
  KEY `idx_tenant_department_status` (`tenant_id`, `request_department_id`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='损耗品领用单';

CREATE TABLE IF NOT EXISTS `consumable_issue_items` (
  `id`                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`          BIGINT UNSIGNED NOT NULL,
  `issue_order_id`     BIGINT UNSIGNED NOT NULL,
  `sku_id`             BIGINT UNSIGNED NOT NULL,
  `warehouse_id`       BIGINT UNSIGNED DEFAULT NULL,
  `location_id`        BIGINT UNSIGNED DEFAULT NULL,
  `qty_requested`      DECIMAL(16,4) NOT NULL,
  `qty_issued`         DECIMAL(16,4) NOT NULL DEFAULT 0,
  `issue_unit`         VARCHAR(20) NOT NULL,
  `budget_code`        VARCHAR(50) DEFAULT NULL,
  `notes`              VARCHAR(500) DEFAULT NULL,
  `created_at`         DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`         DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by`         BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_by`         BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_tenant_issue_order` (`tenant_id`, `issue_order_id`),
  KEY `idx_tenant_sku` (`tenant_id`, `sku_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='损耗品领用单明细';

CREATE TABLE IF NOT EXISTS `asset_cards` (
  `id`                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`          BIGINT UNSIGNED NOT NULL,
  `asset_no`           VARCHAR(50) NOT NULL,
  `sku_id`             BIGINT UNSIGNED NOT NULL,
  `receipt_id`         BIGINT UNSIGNED DEFAULT NULL,
  `receipt_item_id`    BIGINT UNSIGNED DEFAULT NULL,
  `purchase_order_id`  BIGINT UNSIGNED DEFAULT NULL,
  `purchase_item_id`   BIGINT UNSIGNED DEFAULT NULL,
  `asset_name`         VARCHAR(200) NOT NULL,
  `asset_category`     VARCHAR(50) DEFAULT NULL,
  `tracking_mode`      ENUM('none','batch','serial') NOT NULL DEFAULT 'serial',
  `serial_no`          VARCHAR(100) DEFAULT NULL,
  `asset_tag_no`       VARCHAR(100) DEFAULT NULL,
  `status`             ENUM('idle','in_use','repair','scrapped') NOT NULL DEFAULT 'idle',
  `department_id`      BIGINT UNSIGNED DEFAULT NULL,
  `custodian_user_id`  BIGINT UNSIGNED DEFAULT NULL,
  `location_text`      VARCHAR(200) DEFAULT NULL,
  `original_value`     DECIMAL(16,2) NOT NULL DEFAULT 0,
  `net_value`          DECIMAL(16,2) NOT NULL DEFAULT 0,
  `capitalized_at`     DATETIME(3) DEFAULT NULL,
  `notes`              VARCHAR(500) DEFAULT NULL,
  `created_at`         DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`         DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by`         BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_by`         BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_asset_no` (`tenant_id`, `asset_no`),
  UNIQUE KEY `uk_tenant_serial_no` (`tenant_id`, `serial_no`),
  UNIQUE KEY `uk_tenant_asset_tag_no` (`tenant_id`, `asset_tag_no`),
  KEY `idx_tenant_status` (`tenant_id`, `status`),
  KEY `idx_tenant_department` (`tenant_id`, `department_id`),
  KEY `idx_tenant_receipt_item` (`tenant_id`, `receipt_item_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='固定资产卡片台账';

CREATE TABLE IF NOT EXISTS `asset_movements` (
  `id`                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`          BIGINT UNSIGNED NOT NULL,
  `asset_card_id`      BIGINT UNSIGNED NOT NULL,
  `movement_no`        VARCHAR(50) NOT NULL,
  `movement_type`      ENUM('acceptance','transfer','repair','return','scrap') NOT NULL,
  `from_department_id` BIGINT UNSIGNED DEFAULT NULL,
  `to_department_id`   BIGINT UNSIGNED DEFAULT NULL,
  `from_location_text` VARCHAR(200) DEFAULT NULL,
  `to_location_text`   VARCHAR(200) DEFAULT NULL,
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

DROP PROCEDURE IF EXISTS `safe_add_column_m20260413_phase2`;
DROP PROCEDURE IF EXISTS `safe_add_index_m20260413_phase2`;
