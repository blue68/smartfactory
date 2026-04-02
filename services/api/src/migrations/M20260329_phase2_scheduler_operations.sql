DROP PROCEDURE IF EXISTS safe_add_column_m20260329_p2;
DELIMITER $$
CREATE PROCEDURE safe_add_column_m20260329_p2(
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

DROP PROCEDURE IF EXISTS safe_add_index_m20260329_p2;
DELIMITER $$
CREATE PROCEDURE safe_add_index_m20260329_p2(
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

CALL safe_add_column_m20260329_p2('production_schedules', 'operation_id',
  'BIGINT UNSIGNED DEFAULT NULL AFTER `production_order_id`');
CALL safe_add_column_m20260329_p2('production_schedules', 'component_id',
  'BIGINT UNSIGNED DEFAULT NULL AFTER `operation_id`');
CALL safe_add_column_m20260329_p2('production_schedules', 'output_sku_id',
  'BIGINT UNSIGNED DEFAULT NULL AFTER `process_step_id`');
CALL safe_add_index_m20260329_p2('production_schedules', 'idx_tenant_date_operation',
  '(`tenant_id`, `schedule_date`, `operation_id`)');
CALL safe_add_index_m20260329_p2('production_schedules', 'idx_tenant_operation',
  '(`tenant_id`, `operation_id`)');

CALL safe_add_column_m20260329_p2('production_tasks', 'operation_id',
  'BIGINT UNSIGNED DEFAULT NULL AFTER `production_order_id`');
CALL safe_add_column_m20260329_p2('production_tasks', 'component_id',
  'BIGINT UNSIGNED DEFAULT NULL AFTER `operation_id`');
CALL safe_add_column_m20260329_p2('production_tasks', 'output_sku_id',
  'BIGINT UNSIGNED DEFAULT NULL AFTER `process_step_id`');
CALL safe_add_index_m20260329_p2('production_tasks', 'idx_tenant_operation',
  '(`tenant_id`, `operation_id`)');

UPDATE production_schedules ps
INNER JOIN production_operations op
  ON op.tenant_id = ps.tenant_id
 AND op.production_order_id = ps.production_order_id
 AND op.process_step_id = ps.process_step_id
SET ps.operation_id = COALESCE(ps.operation_id, op.id),
    ps.component_id = COALESCE(ps.component_id, op.component_id),
    ps.output_sku_id = COALESCE(ps.output_sku_id, op.output_sku_id)
WHERE ps.operation_id IS NULL OR ps.component_id IS NULL OR ps.output_sku_id IS NULL;

UPDATE production_tasks pt
INNER JOIN production_schedules ps
  ON ps.tenant_id = pt.tenant_id
 AND ps.id = pt.schedule_id
SET pt.operation_id = COALESCE(pt.operation_id, ps.operation_id),
    pt.component_id = COALESCE(pt.component_id, ps.component_id),
    pt.output_sku_id = COALESCE(pt.output_sku_id, ps.output_sku_id)
WHERE pt.operation_id IS NULL OR pt.component_id IS NULL OR pt.output_sku_id IS NULL;

DROP PROCEDURE IF EXISTS safe_add_column_m20260329_p2;
DROP PROCEDURE IF EXISTS safe_add_index_m20260329_p2;
