-- ═════════════════════════════════════════════════════════════════════════════
-- 综合 Schema 修复迁移脚本
-- 修复所有 Sprint 1/3 中因 MySQL 8.0 不支持 ADD COLUMN IF NOT EXISTS 导致的失败
-- 以及补充缺失的表和列
-- 日期: 2026-03-14
-- ═════════════════════════════════════════════════════════════════════════════

-- ─── 幂等 ADD COLUMN 存储过程 ──────────────────────────────────────────────────
DROP PROCEDURE IF EXISTS safe_add_column;
DELIMITER //
CREATE PROCEDURE safe_add_column(
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

-- ─── 幂等 MODIFY COLUMN 存储过程 ──────────────────────────────────────────────
DROP PROCEDURE IF EXISTS safe_modify_column;
DELIMITER //
CREATE PROCEDURE safe_modify_column(
  IN p_table VARCHAR(64),
  IN p_column VARCHAR(64),
  IN p_definition TEXT
)
BEGIN
  SET @col_exists = (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = p_table AND COLUMN_NAME = p_column
  );
  IF @col_exists > 0 THEN
    SET @sql = CONCAT('ALTER TABLE `', p_table, '` MODIFY COLUMN `', p_column, '` ', p_definition);
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END //
DELIMITER ;

-- ═════════════════════════════════════════════════════════════════════════════
-- Sprint 1 修复：users.skill_level
-- ═════════════════════════════════════════════════════════════════════════════
CALL safe_add_column('users', 'skill_level',
  "ENUM('skilled','apprentice') NULL DEFAULT NULL COMMENT '工人技能等级'");

-- ═════════════════════════════════════════════════════════════════════════════
-- Sprint 3 ALTER TABLE 修复
-- ═════════════════════════════════════════════════════════════════════════════

-- S3-A1: production_orders 增加 BOM 快照和原料状态字段
CALL safe_add_column('production_orders', 'bom_snapshot_id',
  "BIGINT UNSIGNED DEFAULT NULL COMMENT 'BOM版本快照ID'");
CALL safe_add_column('production_orders', 'material_status',
  "ENUM('unchecked','shortage','partial','ready') NOT NULL DEFAULT 'unchecked' COMMENT '原材料备料状态'");

-- S3-A2: production_tasks 修改 status 枚举 + 增加 version 字段
CALL safe_modify_column('production_tasks', 'status',
  "ENUM('pending','started','completed','cancelled','exception','suspended') NOT NULL DEFAULT 'pending'");
CALL safe_add_column('production_tasks', 'version',
  "INT UNSIGNED NOT NULL DEFAULT 1 COMMENT '乐观锁版本号'");

-- S3-A3: delivery_notes 增加质检关联字段
CALL safe_add_column('delivery_notes', 'inspection_id',
  "BIGINT UNSIGNED DEFAULT NULL COMMENT '关联来料质检单ID'");
CALL safe_add_column('delivery_notes', 'receipt_id',
  "BIGINT UNSIGNED DEFAULT NULL COMMENT '关联入库单ID'");

-- S3-A4: purchase_order_items 增加质检汇总字段
CALL safe_add_column('purchase_order_items', 'qty_passed',
  "DECIMAL(16,4) NOT NULL DEFAULT 0 COMMENT '累计质检合格入库数量'");
CALL safe_add_column('purchase_order_items', 'qty_rejected',
  "DECIMAL(16,4) NOT NULL DEFAULT 0 COMMENT '累计质检不合格退货数量'");

-- S3-A5: process_steps 增加工序输出类型字段
CALL safe_add_column('process_steps', 'output_type',
  "ENUM('semi_finished','final_product','none') NOT NULL DEFAULT 'none' COMMENT '工序产出类型'");
CALL safe_add_column('process_steps', 'output_sku_id',
  "BIGINT UNSIGNED DEFAULT NULL COMMENT '工序产出半成品 SKU ID'");

-- S3-A6: purchase_suggestions 增加来源字段
CALL safe_add_column('purchase_suggestions', 'source',
  "ENUM('ai_schedule','production_shortage','manual') NOT NULL DEFAULT 'ai_schedule' COMMENT '建议来源'");
CALL safe_add_column('purchase_suggestions', 'production_order_id',
  "BIGINT UNSIGNED DEFAULT NULL COMMENT '关联生产工单ID'");

-- ═════════════════════════════════════════════════════════════════════════════
-- DB-02: sku_categories 增加 remark 列
-- ═════════════════════════════════════════════════════════════════════════════
CALL safe_add_column('sku_categories', 'remark',
  "VARCHAR(500) DEFAULT NULL COMMENT '备注'");

-- ═════════════════════════════════════════════════════════════════════════════
-- DB-03: production_orders 增加 priority_score 列
-- ═════════════════════════════════════════════════════════════════════════════
CALL safe_add_column('production_orders', 'priority_score',
  "DECIMAL(5,2) DEFAULT NULL COMMENT '排产优先级评分（0-100）'");

-- ═════════════════════════════════════════════════════════════════════════════
-- DB-04: work_reports 表（工资报表模块依赖）
-- ═════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS `work_reports` (
  `id`                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`         BIGINT UNSIGNED NOT NULL,
  `report_no`         VARCHAR(50)     NOT NULL COMMENT '报工单号',
  `worker_id`         BIGINT UNSIGNED NOT NULL COMMENT '工人用户ID',
  `production_order_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '关联生产工单ID',
  `task_id`           BIGINT UNSIGNED DEFAULT NULL COMMENT '关联生产任务ID',
  `process_step_id`   BIGINT UNSIGNED DEFAULT NULL COMMENT '关联工序ID',
  `work_date`         DATE            NOT NULL COMMENT '报工日期',
  `qty_completed`     DECIMAL(16,4)   NOT NULL DEFAULT 0 COMMENT '完成数量',
  `qty_qualified`     DECIMAL(16,4)   NOT NULL DEFAULT 0 COMMENT '合格数量',
  `qty_defective`     DECIMAL(16,4)   NOT NULL DEFAULT 0 COMMENT '不良数量',
  `work_hours`        DECIMAL(8,2)    NOT NULL DEFAULT 0 COMMENT '工时（小时）',
  `unit_wage`         DECIMAL(14,4)   NOT NULL DEFAULT 0 COMMENT '计件单价',
  `wage_amount`       DECIMAL(14,2)   NOT NULL DEFAULT 0 COMMENT '工资金额',
  `status`            ENUM('draft','confirmed','settled') NOT NULL DEFAULT 'draft',
  `notes`             VARCHAR(500)    DEFAULT NULL,
  `confirmed_at`      DATETIME(3)     DEFAULT NULL,
  `settled_at`        DATETIME(3)     DEFAULT NULL,
  `created_at`        DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`        DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by`        BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_by`        BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_report_no` (`tenant_id`, `report_no`),
  KEY `idx_tenant_worker_date` (`tenant_id`, `worker_id`, `work_date`),
  KEY `idx_tenant_order` (`tenant_id`, `production_order_id`),
  KEY `idx_tenant_status` (`tenant_id`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='报工记录表';

-- ═════════════════════════════════════════════════════════════════════════════
-- 清理
-- ═════════════════════════════════════════════════════════════════════════════
DROP PROCEDURE IF EXISTS safe_add_column;
DROP PROCEDURE IF EXISTS safe_modify_column;

-- ═════════════════════════════════════════════════════════════════════════════
-- 验证
-- ═════════════════════════════════════════════════════════════════════════════
SELECT
  'Schema fixes migration completed' AS migration_status,
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'work_reports') AS work_reports_exists,
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sku_categories' AND COLUMN_NAME = 'remark') AS sku_cat_remark_exists,
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'production_orders' AND COLUMN_NAME = 'priority_score') AS prod_priority_score_exists,
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'production_orders' AND COLUMN_NAME = 'bom_snapshot_id') AS prod_bom_snapshot_exists;
