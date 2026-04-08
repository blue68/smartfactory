-- =============================================================================
-- M20260407_location_rack_compat.sql
-- 库位模型兼容货架坐标：库位类型 + 巷道/货架/层/格
-- =============================================================================

DROP PROCEDURE IF EXISTS `safe_add_column_m20260407_loc`;
DELIMITER $$
CREATE PROCEDURE `safe_add_column_m20260407_loc`(
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

DROP PROCEDURE IF EXISTS `safe_add_index_m20260407_loc`;
DELIMITER $$
CREATE PROCEDURE `safe_add_index_m20260407_loc`(
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

CALL safe_add_column_m20260407_loc(
  'locations',
  'location_type',
  'ENUM(''general'',''zone'',''rack'',''shelf'',''bin'') NOT NULL DEFAULT ''general'' COMMENT ''库位类型：通用/库区/货架/层/格'' AFTER `name`'
);
CALL safe_add_column_m20260407_loc(
  'locations',
  'aisle_code',
  'VARCHAR(30) DEFAULT NULL COMMENT ''巷道编码'' AFTER `location_type`'
);
CALL safe_add_column_m20260407_loc(
  'locations',
  'rack_code',
  'VARCHAR(30) DEFAULT NULL COMMENT ''货架编码'' AFTER `aisle_code`'
);
CALL safe_add_column_m20260407_loc(
  'locations',
  'shelf_code',
  'VARCHAR(30) DEFAULT NULL COMMENT ''货架层编码'' AFTER `rack_code`'
);
CALL safe_add_column_m20260407_loc(
  'locations',
  'bin_code',
  'VARCHAR(30) DEFAULT NULL COMMENT ''货架格编码'' AFTER `shelf_code`'
);

CALL safe_add_index_m20260407_loc(
  'locations',
  'idx_tenant_wh_loc_type_status',
  '(`tenant_id`, `warehouse_id`, `location_type`, `status`)'
);
CALL safe_add_index_m20260407_loc(
  'locations',
  'idx_tenant_wh_rack_coord',
  '(`tenant_id`, `warehouse_id`, `aisle_code`, `rack_code`, `shelf_code`, `bin_code`)'
);

DROP PROCEDURE IF EXISTS `safe_add_column_m20260407_loc`;
DROP PROCEDURE IF EXISTS `safe_add_index_m20260407_loc`;
