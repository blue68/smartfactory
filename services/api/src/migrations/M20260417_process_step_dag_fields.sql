DELIMITER $$

DROP PROCEDURE IF EXISTS `sp_m20260417_process_step_dag_fields`$$

CREATE PROCEDURE `sp_m20260417_process_step_dag_fields`()
BEGIN
  DECLARE v_db VARCHAR(128);
  SET v_db = DATABASE();

  IF NOT EXISTS (
    SELECT 1
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = v_db
      AND TABLE_NAME = 'process_steps'
      AND COLUMN_NAME = 'predecessor_step_nos_json'
  ) THEN
    ALTER TABLE `process_steps`
      ADD COLUMN `predecessor_step_nos_json` JSON NULL
      COMMENT '前置步骤编号集合（支持并行/汇合 DAG）'
      AFTER `output_sku_id`;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = v_db
      AND TABLE_NAME = 'process_steps'
      AND COLUMN_NAME = 'route_group_key'
  ) THEN
    ALTER TABLE `process_steps`
      ADD COLUMN `route_group_key` VARCHAR(120) NULL
      COMMENT '工艺分支键（对应 BOM 半成品分支）'
      AFTER `predecessor_step_nos_json`;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = v_db
      AND TABLE_NAME = 'process_steps'
      AND COLUMN_NAME = 'route_level'
  ) THEN
    ALTER TABLE `process_steps`
      ADD COLUMN `route_level` SMALLINT NULL
      COMMENT '工艺分支层级'
      AFTER `route_group_key`;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = v_db
      AND TABLE_NAME = 'process_steps'
      AND INDEX_NAME = 'idx_process_steps_route_group'
  ) THEN
    ALTER TABLE `process_steps`
      ADD INDEX `idx_process_steps_route_group` (`tenant_id`, `template_id`, `route_group_key`);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = v_db
      AND TABLE_NAME = 'process_steps'
      AND INDEX_NAME = 'idx_process_steps_route_level'
  ) THEN
    ALTER TABLE `process_steps`
      ADD INDEX `idx_process_steps_route_level` (`tenant_id`, `template_id`, `route_level`);
  END IF;
END$$

DELIMITER ;

CALL `sp_m20260417_process_step_dag_fields`();
DROP PROCEDURE IF EXISTS `sp_m20260417_process_step_dag_fields`;
