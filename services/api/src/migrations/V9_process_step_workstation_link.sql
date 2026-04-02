SET @has_process_step_workstation_id := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'process_steps'
    AND column_name = 'workstation_id'
);

SET @sql_add_process_step_workstation_id := IF(
  @has_process_step_workstation_id = 0,
  'ALTER TABLE `process_steps` ADD COLUMN `workstation_id` BIGINT UNSIGNED DEFAULT NULL COMMENT ''关联具体工作站'' AFTER `workstation_type`',
  'SELECT 1'
);
PREPARE stmt_add_process_step_workstation_id FROM @sql_add_process_step_workstation_id;
EXECUTE stmt_add_process_step_workstation_id;
DEALLOCATE PREPARE stmt_add_process_step_workstation_id;

SET @has_process_step_workstation_idx := (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'process_steps'
    AND index_name = 'idx_workstation_id'
);

SET @sql_add_process_step_workstation_idx := IF(
  @has_process_step_workstation_idx = 0,
  'ALTER TABLE `process_steps` ADD INDEX `idx_workstation_id` (`workstation_id`)',
  'SELECT 1'
);
PREPARE stmt_add_process_step_workstation_idx FROM @sql_add_process_step_workstation_idx;
EXECUTE stmt_add_process_step_workstation_idx;
DEALLOCATE PREPARE stmt_add_process_step_workstation_idx;
