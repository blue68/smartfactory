-- 外协半成品采购兼容（最小侵入）
-- 目标：
--   1) 工序支持执行模式 internal/outsource
--   2) 生产作业支持 execution_mode
--   3) 采购建议与采购明细可回链到 production_operation
--   4) purchase_suggestions.source 增加 outsource_operation

DROP PROCEDURE IF EXISTS safe_add_column_m20260411_outsource;
DELIMITER $$
CREATE PROCEDURE safe_add_column_m20260411_outsource(
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

DROP PROCEDURE IF EXISTS safe_add_index_m20260411_outsource;
DELIMITER $$
CREATE PROCEDURE safe_add_index_m20260411_outsource(
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

-- process_steps: 外协执行模式配置
CALL safe_add_column_m20260411_outsource(
  'process_steps',
  'execution_mode',
  "ENUM('internal','outsource') NOT NULL DEFAULT 'internal' COMMENT '执行模式：internal=厂内，outsource=外协采购' AFTER `output_sku_id`"
);
CALL safe_add_index_m20260411_outsource(
  'process_steps',
  'idx_tenant_template_exec_mode',
  '(`tenant_id`, `template_id`, `execution_mode`)'
);

-- production_operations: 冻结执行模式
CALL safe_add_column_m20260411_outsource(
  'production_operations',
  'execution_mode',
  "ENUM('internal','outsource') NOT NULL DEFAULT 'internal' COMMENT '作业执行模式（release时冻结）' AFTER `status`"
);
CALL safe_add_index_m20260411_outsource(
  'production_operations',
  'idx_tenant_order_mode_status',
  '(`tenant_id`, `production_order_id`, `execution_mode`, `status`)'
);

-- purchase_suggestions: 增加 production_operation_id 回链
CALL safe_add_column_m20260411_outsource(
  'purchase_suggestions',
  'production_operation_id',
  "BIGINT UNSIGNED DEFAULT NULL COMMENT '关联生产作业ID（外协半成品）' AFTER `production_order_id`"
);
CALL safe_add_index_m20260411_outsource(
  'purchase_suggestions',
  'idx_tenant_operation_status',
  '(`tenant_id`, `production_operation_id`, `status`)'
);

-- purchase_order_items: 增加 production_operation_id 回链
CALL safe_add_column_m20260411_outsource(
  'purchase_order_items',
  'production_operation_id',
  "BIGINT UNSIGNED DEFAULT NULL COMMENT '关联生产作业ID（外协半成品）' AFTER `po_id`"
);
CALL safe_add_index_m20260411_outsource(
  'purchase_order_items',
  'idx_tenant_operation',
  '(`tenant_id`, `production_operation_id`)'
);

-- 扩展 purchase_suggestions.source 枚举，兼容外协来源
DROP PROCEDURE IF EXISTS safe_extend_source_enum_m20260411_outsource;
DELIMITER $$
CREATE PROCEDURE safe_extend_source_enum_m20260411_outsource()
BEGIN
  DECLARE v_source_col_type TEXT;

  SELECT COLUMN_TYPE INTO v_source_col_type
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'purchase_suggestions'
    AND column_name = 'source'
  LIMIT 1;

  IF v_source_col_type IS NOT NULL AND v_source_col_type NOT LIKE '%outsource_operation%' THEN
    ALTER TABLE `purchase_suggestions`
      MODIFY COLUMN `source`
      ENUM('ai_schedule','production_shortage','manual','outsource_operation')
      NOT NULL DEFAULT 'ai_schedule'
      COMMENT '建议来源';
  END IF;
END$$
DELIMITER ;
CALL safe_extend_source_enum_m20260411_outsource();
DROP PROCEDURE IF EXISTS safe_extend_source_enum_m20260411_outsource;

-- 尝试将历史 PO 明细回填作业关联（仅可回填 suggestion_id 创建的PO）
UPDATE purchase_order_items poi
INNER JOIN purchase_orders po
  ON po.id = poi.po_id
 AND po.tenant_id = poi.tenant_id
INNER JOIN purchase_suggestions ps
  ON ps.id = po.suggestion_id
 AND ps.tenant_id = po.tenant_id
SET poi.production_operation_id = ps.production_operation_id
WHERE poi.production_operation_id IS NULL
  AND ps.production_operation_id IS NOT NULL;

DROP PROCEDURE IF EXISTS safe_add_column_m20260411_outsource;
DROP PROCEDURE IF EXISTS safe_add_index_m20260411_outsource;
