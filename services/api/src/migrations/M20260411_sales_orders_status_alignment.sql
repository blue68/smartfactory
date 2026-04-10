-- M20260411: Align sales_orders.status enum with sales-order workflow states.
-- Fixes local/runtime failures when closing draft orders to `closed`.

DROP PROCEDURE IF EXISTS safe_modify_column;
DELIMITER //
CREATE PROCEDURE safe_modify_column(
  IN p_table VARCHAR(64),
  IN p_column VARCHAR(64),
  IN p_definition TEXT
)
BEGIN
  IF EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = p_table
       AND column_name = p_column
  ) THEN
    SET @sql = CONCAT(
      'ALTER TABLE `', p_table, '` MODIFY COLUMN `', p_column, '` ', p_definition
    );
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END //
DELIMITER ;

CALL safe_modify_column(
  'sales_orders',
  'status',
  "ENUM('draft','pending_approval','confirmed','in_production','produced','partial_shipped','shipped','completed','closed','cancelled') NOT NULL DEFAULT 'draft'"
);

DROP PROCEDURE IF EXISTS safe_modify_column;

