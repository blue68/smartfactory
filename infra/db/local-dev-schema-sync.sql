-- Local dev schema sync
-- Purpose:
-- 1. Bridge gaps between infra/db/init.sql and the current application entities.
-- 2. Keep local Docker redeploy idempotent after data volumes are recreated.

DROP PROCEDURE IF EXISTS local_safe_add_column;
DELIMITER $$
CREATE PROCEDURE local_safe_add_column(
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

DROP PROCEDURE IF EXISTS local_safe_add_index;
DELIMITER $$
CREATE PROCEDURE local_safe_add_index(
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

-- suppliers: entity fields added after init.sql baseline
CALL local_safe_add_column('suppliers', 'contact_email', 'VARCHAR(200) NULL AFTER `phone`');
CALL local_safe_add_column('suppliers', 'payment_days', 'INT NULL AFTER `address`');
CALL local_safe_add_column('suppliers', 'lead_days', 'INT NULL AFTER `payment_days`');
CALL local_safe_add_column('suppliers', 'category', 'VARCHAR(100) NULL AFTER `lead_days`');
CALL local_safe_add_column('suppliers', 'notes', 'TEXT NULL AFTER `category`');

-- process template defaults / production snapshot fields
CALL local_safe_add_column('process_templates', 'is_default', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER `status`');
CALL local_safe_add_column('process_templates', 'template_type', 'ENUM(''standard'',''custom'',''trial'') NOT NULL DEFAULT ''standard'' AFTER `is_default`');
CALL local_safe_add_column('process_templates', 'version', 'VARCHAR(20) NOT NULL DEFAULT ''1.0'' AFTER `template_type`');
CALL local_safe_add_index('process_templates', 'idx_tenant_sku_default', '(`tenant_id`, `sku_id`, `is_default`)');
CALL local_safe_add_column('process_steps', 'max_hours', 'DECIMAL(6,2) NULL DEFAULT NULL COMMENT ''极限工时（小时/件），超出则触发预警'' AFTER `standard_hours`');

CALL local_safe_add_column('production_orders', 'process_snapshot', 'JSON NULL AFTER `process_template_id`');
CALL local_safe_add_column('production_orders', 'dispatched_at', 'DATETIME(3) NULL AFTER `process_snapshot`');
CALL local_safe_add_column('production_tasks', 'workstation_id', 'BIGINT UNSIGNED NULL AFTER `output_sku_id`');
CALL local_safe_add_column('users', 'skill_level', 'ENUM(''skilled'',''apprentice'') NULL DEFAULT NULL COMMENT ''工人技能等级'' AFTER `real_name`');

-- sales order legacy audit support
CALL local_safe_add_column('sales_orders', 'submit_count', 'TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT ''提交审批次数''');

CREATE TABLE IF NOT EXISTS `process_wages` (
  `id`           BIGINT UNSIGNED     NOT NULL AUTO_INCREMENT,
  `tenant_id`    BIGINT UNSIGNED     NOT NULL COMMENT '租户ID',
  `step_id`      BIGINT UNSIGNED     NOT NULL COMMENT '工序步骤ID（process_steps.id）',
  `worker_grade` ENUM('skilled','apprentice') NOT NULL COMMENT '工人等级',
  `unit_price`   DECIMAL(10,2)       NOT NULL DEFAULT 0.00 COMMENT '计件单价（元/件）',
  `created_at`   DATETIME(3)         NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`   DATETIME(3)         NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by`   BIGINT UNSIGNED     NOT NULL DEFAULT 0,
  `updated_by`   BIGINT UNSIGNED     NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_step_grade` (`tenant_id`, `step_id`, `worker_grade`),
  KEY `idx_tenant_step` (`tenant_id`, `step_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='工序工价配置表';

CREATE TABLE IF NOT EXISTS `audit_logs` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`   BIGINT UNSIGNED NOT NULL,
  `module`      VARCHAR(50)     NOT NULL,
  `action`      VARCHAR(30)     NOT NULL,
  `target_id`   BIGINT UNSIGNED NOT NULL,
  `target_code` VARCHAR(100)    DEFAULT NULL,
  `before_data` JSON            DEFAULT NULL,
  `after_data`  JSON            DEFAULT NULL,
  `operator_id` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `created_at`  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_audit_tenant_module` (`tenant_id`, `module`),
  KEY `idx_audit_target` (`tenant_id`, `module`, `target_id`),
  KEY `idx_audit_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='系统操作审计日志';

-- Backfill production task workstation linkage for local demo data and old snapshots.
UPDATE `production_tasks` pt
LEFT JOIN `production_schedules` ps
  ON ps.id = pt.schedule_id
 AND ps.tenant_id = pt.tenant_id
SET pt.workstation_id = ps.workstation_id
WHERE pt.workstation_id IS NULL;

-- Local demo orders seeded in init.sql predate BOM snapshot freezing.
-- Backfill one reusable snapshot per BOM so schedule generation can release legacy orders.
INSERT INTO `bom_version_snapshots`
  (`tenant_id`, `bom_header_id`, `snapshot_no`, `bom_version`, `snapshot_data`, `snapshot_hash`, `created_by`)
SELECT
  bh.tenant_id,
  bh.id,
  CONCAT('LOCAL-BOM-', bh.id),
  bh.version,
  COALESCE((
    SELECT JSON_ARRAYAGG(
      JSON_OBJECT(
        'skuId', ordered.component_sku_id,
        'qty', CAST(ROUND(ordered.quantity * (1 + COALESCE(ordered.scrap_rate, 0)), 6) AS CHAR),
        'unit', ordered.unit,
        'level', ordered.level
      )
    )
    FROM (
      SELECT component_sku_id, quantity, scrap_rate, unit, level
      FROM `bom_items`
      WHERE tenant_id = bh.tenant_id
        AND bom_header_id = bh.id
      ORDER BY sort_order, id
    ) ordered
  ), JSON_ARRAY()),
  SHA2(CAST(COALESCE((
    SELECT JSON_ARRAYAGG(
      JSON_OBJECT(
        'skuId', ordered.component_sku_id,
        'qty', CAST(ROUND(ordered.quantity * (1 + COALESCE(ordered.scrap_rate, 0)), 6) AS CHAR),
        'unit', ordered.unit,
        'level', ordered.level
      )
    )
    FROM (
      SELECT component_sku_id, quantity, scrap_rate, unit, level
      FROM `bom_items`
      WHERE tenant_id = bh.tenant_id
        AND bom_header_id = bh.id
      ORDER BY sort_order, id
    ) ordered
  ), JSON_ARRAY()) AS CHAR(16000)), 256),
  0
FROM `bom_headers` bh
WHERE bh.tenant_id > 0
  AND NOT EXISTS (
    SELECT 1
    FROM `bom_version_snapshots` bvs
    WHERE bvs.tenant_id = bh.tenant_id
      AND bvs.bom_header_id = bh.id
  );

UPDATE `production_orders` po
INNER JOIN `bom_version_snapshots` bvs
  ON bvs.tenant_id = po.tenant_id
 AND bvs.bom_header_id = po.bom_header_id
SET po.bom_snapshot_id = bvs.id
WHERE po.bom_snapshot_id IS NULL
  AND po.bom_header_id IS NOT NULL;

DROP PROCEDURE IF EXISTS local_safe_add_column;
DROP PROCEDURE IF EXISTS local_safe_add_index;

SELECT 'local dev schema sync completed' AS migration_status;
