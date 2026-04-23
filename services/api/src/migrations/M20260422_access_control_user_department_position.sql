-- =============================================================================
-- M20260422_access_control_user_department_position.sql
-- 人员配置补齐部门与岗位字段
-- =============================================================================

DROP PROCEDURE IF EXISTS `safe_add_column_m20260422_user`;
DELIMITER $$
CREATE PROCEDURE `safe_add_column_m20260422_user`(
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

DROP PROCEDURE IF EXISTS `safe_add_index_m20260422_user`;
DELIMITER $$
CREATE PROCEDURE `safe_add_index_m20260422_user`(
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

CALL safe_add_column_m20260422_user(
  'users',
  'department_id',
  'BIGINT UNSIGNED DEFAULT NULL COMMENT ''所属部门ID'' AFTER `real_name`'
);

CALL safe_add_column_m20260422_user(
  'users',
  'position',
  'VARCHAR(100) DEFAULT NULL COMMENT ''岗位'' AFTER `department_id`'
);

CALL safe_add_index_m20260422_user(
  'users',
  'idx_tenant_department',
  '(`tenant_id`, `department_id`)'
);

DROP PROCEDURE IF EXISTS `safe_add_column_m20260422_user`;
DROP PROCEDURE IF EXISTS `safe_add_index_m20260422_user`;
