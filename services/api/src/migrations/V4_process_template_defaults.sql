-- T-01: process_templates 新增默认模板字段
SET @sql = IF(
  EXISTS(
    SELECT 1
      FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'process_templates'
       AND COLUMN_NAME = 'is_default'
  ),
  'SELECT 1',
  'ALTER TABLE process_templates ADD COLUMN is_default TINYINT(1) NOT NULL DEFAULT 0 AFTER status'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  EXISTS(
    SELECT 1
      FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'process_templates'
       AND COLUMN_NAME = 'template_type'
  ),
  'SELECT 1',
  'ALTER TABLE process_templates ADD COLUMN template_type ENUM(''standard'',''custom'',''trial'') NOT NULL DEFAULT ''standard'' AFTER is_default'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  EXISTS(
    SELECT 1
      FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'process_templates'
       AND COLUMN_NAME = 'version'
  ),
  'SELECT 1',
  'ALTER TABLE process_templates ADD COLUMN version VARCHAR(20) NOT NULL DEFAULT ''1.0'' AFTER template_type'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  EXISTS(
    SELECT 1
      FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'process_templates'
       AND INDEX_NAME = 'idx_tenant_sku_default'
  ),
  'SELECT 1',
  'CREATE INDEX idx_tenant_sku_default ON process_templates (tenant_id, sku_id, is_default)'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- T-03: production_orders 新增工艺快照字段
SET @sql = IF(
  EXISTS(
    SELECT 1
      FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'production_orders'
       AND COLUMN_NAME = 'process_snapshot'
  ),
  'SELECT 1',
  'ALTER TABLE production_orders ADD COLUMN process_snapshot JSON NULL AFTER process_template_id'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  EXISTS(
    SELECT 1
      FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'production_orders'
       AND COLUMN_NAME = 'dispatched_at'
  ),
  'SELECT 1',
  'ALTER TABLE production_orders ADD COLUMN dispatched_at DATETIME(3) NULL AFTER process_snapshot'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
