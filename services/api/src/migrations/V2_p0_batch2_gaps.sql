-- V2 P0 Batch 2: 补全 production_tasks 缺失字段
-- scrap_qty, scrap_reason, affects_progress

-- 使用存储过程安全添加列（MySQL 8.0 不支持 ADD COLUMN IF NOT EXISTS）
DROP PROCEDURE IF EXISTS safe_add_col_p0b2;

DELIMITER //
CREATE PROCEDURE safe_add_col_p0b2(
  IN tbl VARCHAR(64),
  IN col VARCHAR(64),
  IN col_def VARCHAR(255)
)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = tbl AND column_name = col
  ) THEN
    SET @sql = CONCAT('ALTER TABLE `', tbl, '` ADD COLUMN `', col, '` ', col_def);
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END//
DELIMITER ;

CALL safe_add_col_p0b2('production_tasks', 'scrap_qty', 'INT DEFAULT 0 AFTER completed_qty');
CALL safe_add_col_p0b2('production_tasks', 'scrap_reason', 'VARCHAR(500) DEFAULT NULL AFTER scrap_qty');
CALL safe_add_col_p0b2('production_tasks', 'affects_progress', 'TINYINT(1) DEFAULT 0 AFTER suspend_reason');

DROP PROCEDURE IF EXISTS safe_add_col_p0b2;
