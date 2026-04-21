SET @db_name = DATABASE();

SET @stmt = IF(
  EXISTS(
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @db_name
      AND TABLE_NAME = 'process_step_materials'
      AND COLUMN_NAME = 'is_key_material'
  ),
  'SELECT 1',
  'ALTER TABLE `process_step_materials` ADD COLUMN `is_key_material` TINYINT(1) NOT NULL DEFAULT 0 AFTER `consume_timing`'
);
PREPARE migration_stmt FROM @stmt;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;

SET @stmt = IF(
  EXISTS(
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @db_name
      AND TABLE_NAME = 'process_step_materials'
      AND COLUMN_NAME = 'spec_text'
  ),
  'SELECT 1',
  'ALTER TABLE `process_step_materials` ADD COLUMN `spec_text` VARCHAR(255) NULL COMMENT ''工序用料规格/尺寸说明'' AFTER `is_key_material`'
);
PREPARE migration_stmt FROM @stmt;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;

SET @stmt = IF(
  EXISTS(
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @db_name
      AND TABLE_NAME = 'process_step_materials'
      AND COLUMN_NAME = 'process_params_json'
  ),
  'SELECT 1',
  'ALTER TABLE `process_step_materials` ADD COLUMN `process_params_json` JSON NULL COMMENT ''工序用料参数JSON，如长宽门幅面积公式'' AFTER `spec_text`'
);
PREPARE migration_stmt FROM @stmt;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;
