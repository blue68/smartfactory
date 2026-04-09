DROP PROCEDURE IF EXISTS safe_add_column_m20260409_snapshot;
DROP PROCEDURE IF EXISTS safe_drop_index_m20260409_snapshot;
DROP PROCEDURE IF EXISTS safe_add_index_m20260409_snapshot;

DELIMITER $$

CREATE PROCEDURE safe_add_column_m20260409_snapshot(
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

CREATE PROCEDURE safe_drop_index_m20260409_snapshot(
  IN p_table VARCHAR(64),
  IN p_index VARCHAR(64)
)
BEGIN
  IF EXISTS (
    SELECT 1
      FROM information_schema.statistics
     WHERE table_schema = DATABASE()
       AND table_name = p_table
       AND index_name = p_index
  ) THEN
    SET @sql = CONCAT('ALTER TABLE `', p_table, '` DROP INDEX `', p_index, '`');
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END$$

CREATE PROCEDURE safe_add_index_m20260409_snapshot(
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

CALL safe_add_column_m20260409_snapshot(
  'inventory_daily_snapshots',
  'warehouse_id',
  'BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER `snapshot_date`'
);

UPDATE `inventory_daily_snapshots`
   SET `warehouse_id` = 0
 WHERE `warehouse_id` IS NULL;

CALL safe_drop_index_m20260409_snapshot('inventory_daily_snapshots', 'uk_tenant_date_sku');

SET @has_new_unique := (
  SELECT COUNT(*)
    FROM information_schema.statistics
   WHERE table_schema = DATABASE()
     AND table_name = 'inventory_daily_snapshots'
     AND index_name = 'uk_tenant_date_wh_sku'
);

SET @sql := IF(
  @has_new_unique = 0,
  'ALTER TABLE `inventory_daily_snapshots` ADD UNIQUE INDEX `uk_tenant_date_wh_sku` (`tenant_id`, `snapshot_date`, `warehouse_id`, `sku_id`)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

CALL safe_add_index_m20260409_snapshot(
  'inventory_daily_snapshots',
  'idx_tenant_date_wh',
  '(`tenant_id`, `snapshot_date`, `warehouse_id`)'
);

DELETE FROM `inventory_daily_snapshots`
 WHERE `snapshot_date` = CURDATE()
   AND `warehouse_id` = 0;

INSERT INTO `inventory_daily_snapshots`
  (`tenant_id`, `snapshot_date`, `warehouse_id`, `sku_id`, `qty_on_hand`, `qty_reserved`, `qty_available`)
SELECT
  i.`tenant_id`,
  CURDATE(),
  COALESCE(i.`warehouse_id`, 0) AS `warehouse_id`,
  i.`sku_id`,
  SUM(i.`qty_on_hand`) AS `qty_on_hand`,
  SUM(i.`qty_reserved`) AS `qty_reserved`,
  SUM(i.`qty_on_hand`) - SUM(i.`qty_reserved`) AS `qty_available`
FROM `inventory` i
GROUP BY i.`tenant_id`, COALESCE(i.`warehouse_id`, 0), i.`sku_id`
ON DUPLICATE KEY UPDATE
  `qty_on_hand` = VALUES(`qty_on_hand`),
  `qty_reserved` = VALUES(`qty_reserved`),
  `qty_available` = VALUES(`qty_available`);

DROP PROCEDURE IF EXISTS safe_add_column_m20260409_snapshot;
DROP PROCEDURE IF EXISTS safe_drop_index_m20260409_snapshot;
DROP PROCEDURE IF EXISTS safe_add_index_m20260409_snapshot;
