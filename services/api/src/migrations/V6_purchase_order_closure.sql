-- ============================================================================
-- V6: Purchase Order Closure Fields
-- 日期: 2026-03-24
--
-- 目的：
-- 1) 为采购订单手动关闭补齐 close_reason / closed_at / closed_by 字段
-- 2) 与 US-S3-004 的“关闭原因必填、关闭留痕”要求对齐
-- ============================================================================

DROP PROCEDURE IF EXISTS safe_add_column;
DELIMITER //
CREATE PROCEDURE safe_add_column(
  IN p_table VARCHAR(64),
  IN p_column VARCHAR(64),
  IN p_definition TEXT
)
BEGIN
  SET @col_exists = (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = p_table
      AND COLUMN_NAME = p_column
  );
  IF @col_exists = 0 THEN
    SET @sql = CONCAT('ALTER TABLE `', p_table, '` ADD COLUMN `', p_column, '` ', p_definition);
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END //
DELIMITER ;

CALL safe_add_column('purchase_orders', 'close_reason', "VARCHAR(200) NULL COMMENT '手动关闭原因'");
CALL safe_add_column('purchase_orders', 'closed_at', "DATETIME(3) NULL COMMENT '关闭时间'");
CALL safe_add_column('purchase_orders', 'closed_by', "BIGINT UNSIGNED NULL COMMENT '关闭人ID'");

DROP PROCEDURE IF EXISTS safe_add_column;
