-- =============================================================================
-- M20260413_consumable_fixed_asset_phase1.sql
-- 第一阶段：SKU 管控属性 + 损耗品/固定资产档案表
-- 说明：
--   1) 该迁移为前向兼容扩展，不修改现有原材料/半成品/成品主流程语义
--   2) 生产链路守卫由应用层代码生效，数据库层只负责补齐字段和档案表
-- =============================================================================

DROP PROCEDURE IF EXISTS `safe_add_column_m20260413_phase1`;
DELIMITER $$
CREATE PROCEDURE `safe_add_column_m20260413_phase1`(
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

DROP PROCEDURE IF EXISTS `safe_add_index_m20260413_phase1`;
DELIMITER $$
CREATE PROCEDURE `safe_add_index_m20260413_phase1`(
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

CALL safe_add_column_m20260413_phase1(
  'skus',
  'business_class',
  "ENUM('production_material','consumable','fixed_asset') NOT NULL DEFAULT 'production_material' COMMENT '业务大类：生产物料 / 损耗品 / 固定资产'"
);

CALL safe_add_column_m20260413_phase1(
  'skus',
  'control_mode',
  "ENUM('mrp','stock_only','direct_expense','asset') NOT NULL DEFAULT 'mrp' COMMENT '控制模式：MRP驱动 / 仅库存 / 直耗 / 资产'"
);

CALL safe_add_column_m20260413_phase1(
  'skus',
  'allow_bom_component',
  "TINYINT(1) NOT NULL DEFAULT 1 COMMENT '是否允许作为BOM子项'"
);

CALL safe_add_column_m20260413_phase1(
  'skus',
  'allow_purchase',
  "TINYINT(1) NOT NULL DEFAULT 1 COMMENT '是否允许走采购流程'"
);

CALL safe_add_column_m20260413_phase1(
  'skus',
  'allow_inventory',
  "TINYINT(1) NOT NULL DEFAULT 1 COMMENT '是否进入库存账'"
);

CALL safe_add_column_m20260413_phase1(
  'skus',
  'allow_production_issue',
  "TINYINT(1) NOT NULL DEFAULT 1 COMMENT '是否允许生产领料/投料'"
);

CALL safe_add_column_m20260413_phase1(
  'skus',
  'requires_asset_acceptance',
  "TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否必须通过资产验收建卡'"
);

CALL safe_add_column_m20260413_phase1(
  'skus',
  'default_warehouse_type',
  "VARCHAR(30) DEFAULT NULL COMMENT '默认仓库类型'"
);

CALL safe_add_column_m20260413_phase1(
  'skus',
  'approval_policy_code',
  "VARCHAR(50) DEFAULT NULL COMMENT '审批策略编码'"
);

CALL safe_add_column_m20260413_phase1(
  'skus',
  'asset_tracking_mode',
  "ENUM('none','batch','serial') NOT NULL DEFAULT 'none' COMMENT '资产追踪模式'"
);

CALL safe_add_index_m20260413_phase1(
  'skus',
  'idx_tenant_business_class',
  '(`tenant_id`, `business_class`)'
);

CALL safe_add_index_m20260413_phase1(
  'skus',
  'idx_tenant_control_mode',
  '(`tenant_id`, `control_mode`)'
);

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

UPDATE `skus` s
INNER JOIN `sku_categories` c ON c.id = s.category1_id
SET
  s.business_class = CASE
    WHEN c.code IN ('MATERIAL', 'SEMIFIN', 'FINISHED') THEN 'production_material'
    WHEN c.code = 'PACKING' THEN 'consumable'
    WHEN c.code = 'ASSET' THEN 'fixed_asset'
    ELSE s.business_class
  END,
  s.control_mode = CASE
    WHEN c.code IN ('MATERIAL', 'SEMIFIN', 'FINISHED') THEN 'mrp'
    WHEN c.code = 'PACKING' THEN 'stock_only'
    WHEN c.code = 'ASSET' THEN 'asset'
    ELSE s.control_mode
  END,
  s.allow_bom_component = CASE
    WHEN c.code IN ('MATERIAL', 'SEMIFIN') THEN 1
    WHEN c.code IN ('FINISHED', 'PACKING', 'ASSET') THEN 0
    ELSE s.allow_bom_component
  END,
  s.allow_purchase = CASE
    WHEN c.code = 'FINISHED' THEN 0
    WHEN c.code = 'ASSET' THEN 1
    ELSE 1
  END,
  s.allow_inventory = CASE
    WHEN c.code = 'FINISHED' THEN 1
    WHEN c.code = 'ASSET' THEN 0
    ELSE s.allow_inventory
  END,
  s.allow_production_issue = CASE
    WHEN c.code IN ('MATERIAL', 'SEMIFIN') THEN 1
    WHEN c.code IN ('FINISHED', 'PACKING', 'ASSET') THEN 0
    ELSE s.allow_production_issue
  END,
  s.requires_asset_acceptance = CASE
    WHEN c.code = 'ASSET' THEN 1
    ELSE 0
  END,
  s.default_warehouse_type = CASE
    WHEN c.code IN ('MATERIAL', 'SEMIFIN') THEN 'raw_material'
    WHEN c.code = 'FINISHED' THEN 'finished'
    WHEN c.code = 'PACKING' THEN 'consumable'
    WHEN c.code = 'ASSET' THEN 'asset_pending'
    ELSE s.default_warehouse_type
  END,
  s.asset_tracking_mode = CASE
    WHEN c.code = 'ASSET' THEN 'serial'
    ELSE 'none'
  END
WHERE c.code IN ('MATERIAL', 'SEMIFIN', 'FINISHED', 'PACKING', 'ASSET');

DROP PROCEDURE IF EXISTS `safe_add_column_m20260413_phase1`;
DROP PROCEDURE IF EXISTS `safe_add_index_m20260413_phase1`;
