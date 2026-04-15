DELIMITER $$

DROP PROCEDURE IF EXISTS `sp_m20260416_add_supplier_price_cycles`$$

CREATE PROCEDURE `sp_m20260416_add_supplier_price_cycles`()
BEGIN
  DECLARE v_db VARCHAR(128);
  SET v_db = DATABASE();

  IF NOT EXISTS (
    SELECT 1
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = v_db
      AND TABLE_NAME = 'supplier_prices'
      AND COLUMN_NAME = 'purchase_cycle_days'
  ) THEN
    ALTER TABLE `supplier_prices`
      ADD COLUMN `purchase_cycle_days` INT UNSIGNED DEFAULT NULL
      COMMENT '采购周期（天）'
      AFTER `moq`;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = v_db
      AND TABLE_NAME = 'supplier_prices'
      AND COLUMN_NAME = 'transport_cycle_days'
  ) THEN
    ALTER TABLE `supplier_prices`
      ADD COLUMN `transport_cycle_days` INT UNSIGNED DEFAULT NULL
      COMMENT '运输周期（天）'
      AFTER `purchase_cycle_days`;
  END IF;
END$$

DELIMITER ;

CALL `sp_m20260416_add_supplier_price_cycles`();
DROP PROCEDURE IF EXISTS `sp_m20260416_add_supplier_price_cycles`;
