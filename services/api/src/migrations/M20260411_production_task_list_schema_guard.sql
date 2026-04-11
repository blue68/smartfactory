-- 生产任务列表结构兜底迁移（幂等）
-- 目标：
-- 1) 补齐 /api/production/tasks 查询依赖字段
-- 2) 补齐依赖关系表，恢复完整优先级与阻塞链路能力
-- 3) 对历史数据做最小回填，避免新字段为空导致展示异常

DROP PROCEDURE IF EXISTS safe_add_column_m20260411_task_list;
DELIMITER $$
CREATE PROCEDURE safe_add_column_m20260411_task_list(
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

DROP PROCEDURE IF EXISTS safe_add_index_m20260411_task_list;
DELIMITER $$
CREATE PROCEDURE safe_add_index_m20260411_task_list(
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

-- process_steps：任务类型、执行方式判断依赖
CALL safe_add_column_m20260411_task_list(
  'process_steps',
  'output_sku_id',
  'BIGINT UNSIGNED DEFAULT NULL AFTER `output_type`'
);
CALL safe_add_column_m20260411_task_list(
  'process_steps',
  'execution_mode',
  "ENUM('internal','outsource') NOT NULL DEFAULT 'internal' AFTER `output_sku_id`"
);

-- production_schedules：历史任务回填依赖
CALL safe_add_column_m20260411_task_list(
  'production_schedules',
  'operation_id',
  'BIGINT UNSIGNED DEFAULT NULL AFTER `production_order_id`'
);
CALL safe_add_column_m20260411_task_list(
  'production_schedules',
  'component_id',
  'BIGINT UNSIGNED DEFAULT NULL AFTER `operation_id`'
);
CALL safe_add_column_m20260411_task_list(
  'production_schedules',
  'output_sku_id',
  'BIGINT UNSIGNED DEFAULT NULL AFTER `process_step_id`'
);
CALL safe_add_index_m20260411_task_list(
  'production_schedules',
  'idx_tenant_date_operation',
  '(`tenant_id`, `schedule_date`, `operation_id`)'
);

-- production_tasks：任务列表主查询依赖
CALL safe_add_column_m20260411_task_list(
  'production_tasks',
  'operation_id',
  'BIGINT UNSIGNED DEFAULT NULL AFTER `production_order_id`'
);
CALL safe_add_column_m20260411_task_list(
  'production_tasks',
  'component_id',
  'BIGINT UNSIGNED DEFAULT NULL AFTER `operation_id`'
);
CALL safe_add_column_m20260411_task_list(
  'production_tasks',
  'output_sku_id',
  'BIGINT UNSIGNED DEFAULT NULL AFTER `process_step_id`'
);
CALL safe_add_column_m20260411_task_list(
  'production_tasks',
  'execution_mode',
  "ENUM('internal','outsource') NOT NULL DEFAULT 'internal' AFTER `output_sku_id`"
);
CALL safe_add_column_m20260411_task_list(
  'production_tasks',
  'workstation_id',
  'BIGINT UNSIGNED DEFAULT NULL AFTER `output_sku_id`'
);
CALL safe_add_column_m20260411_task_list(
  'production_tasks',
  'version',
  'INT UNSIGNED NOT NULL DEFAULT 1 AFTER `completed_at`'
);
CALL safe_add_column_m20260411_task_list(
  'production_tasks',
  'actual_hours',
  'DECIMAL(6,2) NULL DEFAULT NULL AFTER `version`'
);
CALL safe_add_column_m20260411_task_list(
  'production_tasks',
  'suspend_reason',
  'VARCHAR(500) NULL DEFAULT NULL AFTER `actual_hours`'
);
CALL safe_add_index_m20260411_task_list(
  'production_tasks',
  'idx_tenant_operation',
  '(`tenant_id`, `operation_id`)'
);

-- 扩展状态枚举（兼容旧库）
ALTER TABLE `production_tasks`
  MODIFY COLUMN `status` ENUM('pending','started','completed','cancelled','exception','suspended') NOT NULL DEFAULT 'pending';

-- 作业依赖关系表：优先级链路计算依赖
CREATE TABLE IF NOT EXISTS `production_operation_dependencies` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id` BIGINT UNSIGNED NOT NULL,
  `operation_id` BIGINT UNSIGNED NOT NULL,
  `predecessor_operation_id` BIGINT UNSIGNED NOT NULL,
  `required_qty` DECIMAL(16,4) NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_operation_pred` (`tenant_id`, `operation_id`, `predecessor_operation_id`),
  KEY `idx_tenant_operation` (`tenant_id`, `operation_id`),
  KEY `idx_tenant_predecessor` (`tenant_id`, `predecessor_operation_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='作业依赖关系';

-- 历史数据回填：任务缺少工作站时从排产表补齐
UPDATE `production_tasks` pt
LEFT JOIN `production_schedules` ps
  ON ps.id = pt.schedule_id
 AND ps.tenant_id = pt.tenant_id
SET pt.workstation_id = ps.workstation_id
WHERE pt.workstation_id IS NULL;

DROP PROCEDURE IF EXISTS safe_add_column_m20260411_task_list;
DROP PROCEDURE IF EXISTS safe_add_index_m20260411_task_list;
