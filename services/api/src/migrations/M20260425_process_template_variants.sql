DROP PROCEDURE IF EXISTS `safe_add_column_m20260425_ptv`;
DELIMITER $$
CREATE PROCEDURE `safe_add_column_m20260425_ptv`(
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

CALL safe_add_column_m20260425_ptv(
  'process_templates',
  'base_template_id',
  'BIGINT UNSIGNED NULL COMMENT ''关联的标准模板 ID'' AFTER `sku_id`'
);

SET @modify_process_template_sku_nullable := (
  SELECT CASE
    WHEN EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'process_templates'
        AND column_name = 'sku_id'
        AND is_nullable = 'NO'
    )
    THEN 'ALTER TABLE `process_templates` MODIFY COLUMN `sku_id` BIGINT UNSIGNED NULL COMMENT ''对应成品SKU（标准模板可为空）'''
    ELSE 'SELECT 1'
  END
);
PREPARE stmt FROM @modify_process_template_sku_nullable;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @create_process_template_base_index := (
  SELECT CASE
    WHEN EXISTS (
      SELECT 1
      FROM information_schema.statistics
      WHERE table_schema = DATABASE()
        AND table_name = 'process_templates'
        AND index_name = 'idx_tenant_base_template'
    )
    THEN 'SELECT 1'
    ELSE 'CREATE INDEX `idx_tenant_base_template` ON `process_templates` (`tenant_id`, `base_template_id`)'
  END
);
PREPARE stmt FROM @create_process_template_base_index;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

DROP PROCEDURE IF EXISTS `safe_add_column_m20260425_ptv`;
