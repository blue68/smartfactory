-- =============================================================================
-- M20260403_inventory_warehouse_alignment.sql
-- 库存仓库/库位对齐：主数据、引用字段、迁移映射与默认仓位回填
-- =============================================================================

CREATE TABLE IF NOT EXISTS `warehouses` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`     BIGINT UNSIGNED NOT NULL,
  `code`          VARCHAR(50)     NOT NULL,
  `name`          VARCHAR(100)    NOT NULL,
  `type`          VARCHAR(30)     DEFAULT NULL,
  `plant_code`    VARCHAR(50)     DEFAULT NULL,
  `status`        ENUM('active','inactive','locked','archived') NOT NULL DEFAULT 'active',
  `created_at`    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by`    BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_by`    BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_code` (`tenant_id`, `code`),
  KEY `idx_tenant_status` (`tenant_id`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='仓库主数据';

CREATE TABLE IF NOT EXISTS `locations` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`     BIGINT UNSIGNED NOT NULL,
  `warehouse_id`  BIGINT UNSIGNED NOT NULL,
  `code`          VARCHAR(50)     NOT NULL,
  `name`          VARCHAR(100)    NOT NULL,
  `level`         SMALLINT        NOT NULL DEFAULT 1,
  `parent_id`     BIGINT UNSIGNED DEFAULT NULL,
  `status`        ENUM('active','inactive','locked','archived') NOT NULL DEFAULT 'active',
  `created_at`    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by`    BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_by`    BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_wh_code` (`tenant_id`, `warehouse_id`, `code`),
  KEY `idx_tenant_wh_status` (`tenant_id`, `warehouse_id`, `status`),
  KEY `idx_tenant_parent` (`tenant_id`, `parent_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='库位主数据';

CREATE TABLE IF NOT EXISTS `inventory_location_mappings` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`       BIGINT UNSIGNED NOT NULL,
  `sku_code`        VARCHAR(50)     NOT NULL,
  `source_note`     VARCHAR(200)    NOT NULL COMMENT '来源标记（例如 reference_no / source_note）',
  `warehouse_code`  VARCHAR(50)     NOT NULL,
  `location_code`   VARCHAR(50)     NOT NULL,
  `status`          ENUM('active','inactive') NOT NULL DEFAULT 'active',
  `created_at`      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by`      BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_by`      BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_sku_source` (`tenant_id`, `sku_code`, `source_note`),
  KEY `idx_tenant_status` (`tenant_id`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='库存迁移映射表';

CREATE TABLE IF NOT EXISTS `migration_unmapped_records` (
  `id`                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`             BIGINT UNSIGNED NOT NULL,
  `batch_no`              VARCHAR(50)     NOT NULL,
  `entity_type`           VARCHAR(40)     NOT NULL COMMENT 'inventory | inventory_transaction',
  `entity_id`             BIGINT UNSIGNED NOT NULL,
  `sku_id`                BIGINT UNSIGNED DEFAULT NULL,
  `sku_code`              VARCHAR(50)     DEFAULT NULL,
  `source_note`           VARCHAR(500)    DEFAULT NULL,
  `fallback_warehouse_code` VARCHAR(50)   NOT NULL DEFAULT 'DEFAULT',
  `fallback_location_code`  VARCHAR(50)   NOT NULL DEFAULT 'DEFAULT-UNKNOWN',
  `created_at`            DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_batch_entity` (`batch_no`, `entity_type`, `entity_id`),
  KEY `idx_tenant_batch` (`tenant_id`, `batch_no`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='库存迁移未匹配记录';

DROP PROCEDURE IF EXISTS `safe_add_column_m20260403`;
DELIMITER $$
CREATE PROCEDURE `safe_add_column_m20260403`(
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

DROP PROCEDURE IF EXISTS `safe_add_index_m20260403`;
DELIMITER $$
CREATE PROCEDURE `safe_add_index_m20260403`(
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

CALL safe_add_column_m20260403('inventory', 'warehouse_id', 'BIGINT UNSIGNED NULL AFTER `sku_id`');
CALL safe_add_column_m20260403('inventory', 'location_id', 'BIGINT UNSIGNED NULL AFTER `warehouse_id`');
CALL safe_add_column_m20260403('inventory', 'source_ref', 'VARCHAR(100) NULL AFTER `qty_in_transit`');
CALL safe_add_column_m20260403('inventory', 'updated_by', 'BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER `updated_at`');
CALL safe_add_index_m20260403('inventory', 'idx_tenant_wh_loc_sku', '(`tenant_id`, `warehouse_id`, `location_id`, `sku_id`)');

CALL safe_add_column_m20260403('inventory_transactions', 'warehouse_id', 'BIGINT UNSIGNED NULL AFTER `sku_id`');
CALL safe_add_column_m20260403('inventory_transactions', 'location_id', 'BIGINT UNSIGNED NULL AFTER `warehouse_id`');
CALL safe_add_column_m20260403('inventory_transactions', 'source_ref', 'VARCHAR(100) NULL AFTER `reference_no`');
CALL safe_add_column_m20260403('inventory_transactions', 'updated_by', 'BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER `created_by`');
CALL safe_add_index_m20260403('inventory_transactions', 'idx_tenant_wh_loc_created', '(`tenant_id`, `warehouse_id`, `location_id`, `created_at`)');

CALL safe_add_column_m20260403('stocktaking_tasks', 'warehouse_id', 'BIGINT UNSIGNED NULL AFTER `scope_value`');
CALL safe_add_column_m20260403('stocktaking_tasks', 'location_id', 'BIGINT UNSIGNED NULL AFTER `warehouse_id`');
CALL safe_add_index_m20260403('stocktaking_tasks', 'idx_tenant_wh_loc_status', '(`tenant_id`, `warehouse_id`, `location_id`, `status`)');

CALL safe_add_column_m20260403('stocktaking_items', 'warehouse_id', 'BIGINT UNSIGNED NULL AFTER `sku_id`');
CALL safe_add_column_m20260403('stocktaking_items', 'location_id', 'BIGINT UNSIGNED NULL AFTER `warehouse_id`');
CALL safe_add_index_m20260403('stocktaking_items', 'idx_tenant_task_wh_loc', '(`tenant_id`, `task_id`, `warehouse_id`, `location_id`)');

INSERT INTO `warehouses`
  (`tenant_id`, `code`, `name`, `type`, `plant_code`, `status`, `created_by`, `updated_by`)
SELECT t.id, 'DEFAULT', '默认仓库', 'virtual', NULL, 'active', 0, 0
FROM `tenants` t
LEFT JOIN `warehouses` w
  ON w.tenant_id = t.id
 AND w.code = 'DEFAULT'
WHERE w.id IS NULL;

INSERT INTO `locations`
  (`tenant_id`, `warehouse_id`, `code`, `name`, `level`, `parent_id`, `status`, `created_by`, `updated_by`)
SELECT w.tenant_id, w.id, 'DEFAULT-UNKNOWN', '默认未知库位', 1, NULL, 'active', 0, 0
FROM `warehouses` w
LEFT JOIN `locations` l
  ON l.tenant_id = w.tenant_id
 AND l.warehouse_id = w.id
 AND l.code = 'DEFAULT-UNKNOWN'
WHERE w.code = 'DEFAULT'
  AND l.id IS NULL;

UPDATE `inventory_transactions` it
INNER JOIN `skus` s
  ON s.tenant_id = it.tenant_id
 AND s.id = it.sku_id
INNER JOIN `inventory_location_mappings` m
  ON m.tenant_id = it.tenant_id
 AND m.sku_code = s.sku_code
 AND m.status = 'active'
 AND m.source_note = COALESCE(NULLIF(it.reference_no, ''), NULLIF(it.notes, ''), '__EMPTY__')
INNER JOIN `warehouses` w
  ON w.tenant_id = it.tenant_id
 AND w.code = m.warehouse_code
 AND w.status = 'active'
INNER JOIN `locations` l
  ON l.tenant_id = it.tenant_id
 AND l.warehouse_id = w.id
 AND l.code = m.location_code
 AND l.status = 'active'
SET it.warehouse_id = w.id,
    it.location_id = l.id,
    it.source_ref = COALESCE(it.source_ref, CONCAT('mapping:', m.id))
WHERE it.warehouse_id IS NULL
   OR it.location_id IS NULL;

UPDATE `inventory` existing
INNER JOIN (
  SELECT
    existing.id AS target_id,
    SUM(legacy.qty_on_hand) AS merge_qty_on_hand,
    SUM(legacy.qty_reserved) AS merge_qty_reserved,
    SUM(legacy.qty_in_transit) AS merge_qty_in_transit,
    MAX(legacy.last_in_at) AS merge_last_in_at,
    MAX(legacy.last_out_at) AS merge_last_out_at
  FROM `inventory` legacy
  INNER JOIN `warehouses` dw
    ON dw.tenant_id = legacy.tenant_id
   AND dw.code = 'DEFAULT'
  INNER JOIN `locations` dl
    ON dl.tenant_id = legacy.tenant_id
   AND dl.warehouse_id = dw.id
   AND dl.code = 'DEFAULT-UNKNOWN'
  INNER JOIN `inventory` existing
    ON existing.tenant_id = legacy.tenant_id
   AND existing.sku_id = legacy.sku_id
   AND existing.warehouse_id = dw.id
   AND existing.location_id = dl.id
  WHERE (legacy.warehouse_id IS NULL OR legacy.location_id IS NULL)
    AND legacy.id <> existing.id
  GROUP BY existing.id
) merged
  ON merged.target_id = existing.id
SET existing.qty_on_hand = existing.qty_on_hand + merged.merge_qty_on_hand,
    existing.qty_reserved = existing.qty_reserved + merged.merge_qty_reserved,
    existing.qty_in_transit = existing.qty_in_transit + merged.merge_qty_in_transit,
    existing.last_in_at = CASE
      WHEN existing.last_in_at IS NULL THEN merged.merge_last_in_at
      WHEN merged.merge_last_in_at IS NULL THEN existing.last_in_at
      ELSE GREATEST(existing.last_in_at, merged.merge_last_in_at)
    END,
    existing.last_out_at = CASE
      WHEN existing.last_out_at IS NULL THEN merged.merge_last_out_at
      WHEN merged.merge_last_out_at IS NULL THEN existing.last_out_at
      ELSE GREATEST(existing.last_out_at, merged.merge_last_out_at)
    END,
    existing.source_ref = COALESCE(existing.source_ref, 'migration:default-location'),
    existing.updated_by = COALESCE(existing.updated_by, 0);

DELETE legacy
FROM `inventory` legacy
INNER JOIN `warehouses` dw
  ON dw.tenant_id = legacy.tenant_id
 AND dw.code = 'DEFAULT'
INNER JOIN `locations` dl
  ON dl.tenant_id = legacy.tenant_id
 AND dl.warehouse_id = dw.id
 AND dl.code = 'DEFAULT-UNKNOWN'
INNER JOIN `inventory` existing
  ON existing.tenant_id = legacy.tenant_id
 AND existing.sku_id = legacy.sku_id
 AND existing.warehouse_id = dw.id
 AND existing.location_id = dl.id
WHERE (legacy.warehouse_id IS NULL OR legacy.location_id IS NULL)
  AND legacy.id <> existing.id;

UPDATE `inventory` inv
INNER JOIN `warehouses` dw
  ON dw.tenant_id = inv.tenant_id
 AND dw.code = 'DEFAULT'
INNER JOIN `locations` dl
  ON dl.tenant_id = inv.tenant_id
 AND dl.warehouse_id = dw.id
 AND dl.code = 'DEFAULT-UNKNOWN'
SET inv.warehouse_id = COALESCE(inv.warehouse_id, dw.id),
    inv.location_id = COALESCE(inv.location_id, dl.id),
    inv.source_ref = COALESCE(inv.source_ref, 'migration:default-location'),
    inv.updated_by = COALESCE(inv.updated_by, 0)
WHERE inv.warehouse_id IS NULL
   OR inv.location_id IS NULL;

UPDATE `inventory_transactions` it
INNER JOIN `warehouses` dw
  ON dw.tenant_id = it.tenant_id
 AND dw.code = 'DEFAULT'
INNER JOIN `locations` dl
  ON dl.tenant_id = it.tenant_id
 AND dl.warehouse_id = dw.id
 AND dl.code = 'DEFAULT-UNKNOWN'
SET it.warehouse_id = COALESCE(it.warehouse_id, dw.id),
    it.location_id = COALESCE(it.location_id, dl.id),
    it.source_ref = COALESCE(it.source_ref, 'migration:default-location'),
    it.updated_by = COALESCE(it.updated_by, it.created_by, 0)
WHERE it.warehouse_id IS NULL
   OR it.location_id IS NULL;

UPDATE `stocktaking_tasks` st
INNER JOIN `warehouses` dw
  ON dw.tenant_id = st.tenant_id
 AND dw.code = 'DEFAULT'
INNER JOIN `locations` dl
  ON dl.tenant_id = st.tenant_id
 AND dl.warehouse_id = dw.id
 AND dl.code = 'DEFAULT-UNKNOWN'
SET st.warehouse_id = COALESCE(st.warehouse_id, dw.id),
    st.location_id = COALESCE(st.location_id, dl.id)
WHERE st.warehouse_id IS NULL
   OR st.location_id IS NULL;

UPDATE `stocktaking_items` si
INNER JOIN `stocktaking_tasks` st
  ON st.id = si.task_id
 AND st.tenant_id = si.tenant_id
SET si.warehouse_id = COALESCE(si.warehouse_id, st.warehouse_id),
    si.location_id = COALESCE(si.location_id, st.location_id)
WHERE si.warehouse_id IS NULL
   OR si.location_id IS NULL;

SET @migration_batch_no := CONCAT('M20260403_', DATE_FORMAT(NOW(3), '%Y%m%d%H%i%s'));

INSERT IGNORE INTO `migration_unmapped_records`
  (`tenant_id`, `batch_no`, `entity_type`, `entity_id`, `sku_id`, `sku_code`, `source_note`,
   `fallback_warehouse_code`, `fallback_location_code`)
SELECT
  inv.tenant_id,
  @migration_batch_no,
  'inventory',
  inv.id,
  inv.sku_id,
  s.sku_code,
  inv.source_ref,
  'DEFAULT',
  'DEFAULT-UNKNOWN'
FROM `inventory` inv
LEFT JOIN `skus` s
  ON s.tenant_id = inv.tenant_id
 AND s.id = inv.sku_id
WHERE inv.source_ref = 'migration:default-location';

INSERT IGNORE INTO `migration_unmapped_records`
  (`tenant_id`, `batch_no`, `entity_type`, `entity_id`, `sku_id`, `sku_code`, `source_note`,
   `fallback_warehouse_code`, `fallback_location_code`)
SELECT
  it.tenant_id,
  @migration_batch_no,
  'inventory_transaction',
  it.id,
  it.sku_id,
  s.sku_code,
  COALESCE(NULLIF(it.reference_no, ''), NULLIF(it.notes, ''), it.source_ref),
  'DEFAULT',
  'DEFAULT-UNKNOWN'
FROM `inventory_transactions` it
LEFT JOIN `skus` s
  ON s.tenant_id = it.tenant_id
 AND s.id = it.sku_id
WHERE it.source_ref = 'migration:default-location';

DROP PROCEDURE IF EXISTS `safe_add_column_m20260403`;
DROP PROCEDURE IF EXISTS `safe_add_index_m20260403`;
