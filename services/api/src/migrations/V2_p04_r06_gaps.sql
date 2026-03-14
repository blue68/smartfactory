-- ═════════════════════════════════════════════════════════════════════════════
-- P0-4 R-06 Gap 补全迁移脚本
-- 修复 R06-G02 / R06-G03 / R06-G05 所需的数据库字段
-- 日期: 2026-03-14
-- ═════════════════════════════════════════════════════════════════════════════

-- ─── 幂等 ADD COLUMN 存储过程（若已存在则跳过创建） ──────────────────────────
DROP PROCEDURE IF EXISTS safe_add_col_r06;
DELIMITER //
CREATE PROCEDURE safe_add_col_r06(
  IN p_table VARCHAR(64),
  IN p_column VARCHAR(64),
  IN p_definition TEXT
)
BEGIN
  SET @col_exists = (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = p_table AND COLUMN_NAME = p_column
  );
  IF @col_exists = 0 THEN
    SET @sql = CONCAT('ALTER TABLE `', p_table, '` ADD COLUMN `', p_column, '` ', p_definition);
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END //
DELIMITER ;

-- ─── production_tasks: 补充 actual_hours（实际工时）字段 ─────────────────────
-- R06-G02: 完工上报携带实际工时，保存至此字段
CALL safe_add_col_r06(
  'production_tasks',
  'actual_hours',
  'DECIMAL(6,2) NULL DEFAULT NULL COMMENT ''实际工时（小时），完工上报时填写'''
);

-- ─── production_tasks: 补充 suspend_reason（挂起原因）字段 ──────────────────
-- R06-G05: 主管将任务挂起时记录原因
CALL safe_add_col_r06(
  'production_tasks',
  'suspend_reason',
  'VARCHAR(500) NULL DEFAULT NULL COMMENT ''任务挂起原因'''
);

-- ─── task_exceptions: 补充 affects_progress（影响进度）字段 ─────────────────
-- R06-G03: 异常上报时记录是否影响生产进度
CALL safe_add_col_r06(
  'task_exceptions',
  'affects_progress',
  'TINYINT(1) NOT NULL DEFAULT 0 COMMENT ''是否影响生产进度：1=是 0=否'''
);

-- ─── 清理临时存储过程 ────────────────────────────────────────────────────────
DROP PROCEDURE IF EXISTS safe_add_col_r06;
