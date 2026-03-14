-- V2 QA 缺陷修复：DEF-003 customers 表缺失字段
-- 实体定义了 grade/email/region/credit_limit/payment_days/notes 但数据库无这些列

-- 使用存储过程安全添加列（MySQL 8.0 不支持 ADD COLUMN IF NOT EXISTS）
DELIMITER //
CREATE PROCEDURE IF NOT EXISTS add_column_if_not_exists(
  IN tbl VARCHAR(64), IN col VARCHAR(64), IN col_def VARCHAR(512))
BEGIN
  SET @db = DATABASE();
  SELECT COUNT(*) INTO @cnt FROM information_schema.columns
    WHERE table_schema = @db AND table_name = tbl AND column_name = col;
  IF @cnt = 0 THEN
    SET @sql = CONCAT('ALTER TABLE `', tbl, '` ADD COLUMN `', col, '` ', col_def);
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END//
DELIMITER ;

CALL add_column_if_not_exists('customers', 'grade',        'ENUM("VIP","A","B","C") NOT NULL DEFAULT "B" AFTER `name`');
CALL add_column_if_not_exists('customers', 'email',        'VARCHAR(200) NULL AFTER `phone`');
CALL add_column_if_not_exists('customers', 'region',       'VARCHAR(100) NULL AFTER `address`');
CALL add_column_if_not_exists('customers', 'credit_limit', 'DECIMAL(14,2) NULL AFTER `region`');
CALL add_column_if_not_exists('customers', 'payment_days', 'INT NULL AFTER `credit_limit`');
CALL add_column_if_not_exists('customers', 'notes',        'TEXT NULL AFTER `status`');

DROP PROCEDURE IF EXISTS add_column_if_not_exists;
