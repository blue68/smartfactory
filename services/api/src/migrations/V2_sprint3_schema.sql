-- ═════════════════════════════════════════════════════════════════════════════
-- Sprint 3 数据库迁移脚本
-- 版本: V2_sprint3
-- 日期: 2026-03-14
-- 功能: R-09 采购质检入库退货 + R-10 销售生产链路 + R-11 采购数据闭环
-- ═════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- S3-01. 来料质检表 incoming_inspection_records
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `incoming_inspection_records` (
  `id`                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`           BIGINT UNSIGNED NOT NULL,
  `inspection_no`       VARCHAR(50)     NOT NULL COMMENT '来料质检单号，格式 IQC-YYYYMMDD-NNNN',
  `po_id`               BIGINT UNSIGNED NOT NULL COMMENT '关联采购订单ID',
  `delivery_note_id`    BIGINT UNSIGNED DEFAULT NULL COMMENT '关联送货单ID',
  `inspector_id`        BIGINT UNSIGNED NOT NULL COMMENT '质检员用户ID',
  `inspection_date`     DATE            NOT NULL,
  `status`              ENUM('draft','in_progress','passed','partially_passed','failed') NOT NULL DEFAULT 'draft',
  `overall_result`      ENUM('pass','fail','conditional_pass') DEFAULT NULL COMMENT '综合质检结论',
  `receipt_triggered`   TINYINT(1)      NOT NULL DEFAULT 0 COMMENT '1=已触发入库单生成',
  `return_triggered`    TINYINT(1)      NOT NULL DEFAULT 0 COMMENT '1=已触发退货单生成',
  `notes`               TEXT            DEFAULT NULL,
  `completed_at`        DATETIME(3)     DEFAULT NULL,
  `created_at`          DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`          DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by`          BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_by`          BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_inspection_no` (`tenant_id`, `inspection_no`),
  KEY `idx_tenant_po` (`tenant_id`, `po_id`),
  KEY `idx_tenant_status` (`tenant_id`, `status`),
  KEY `idx_tenant_date` (`tenant_id`, `inspection_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='来料质检单表';

-- ─────────────────────────────────────────────────────────────────────────────
-- S3-02. 来料质检明细表 incoming_inspection_items
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `incoming_inspection_items` (
  `id`                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`           BIGINT UNSIGNED NOT NULL,
  `inspection_id`       BIGINT UNSIGNED NOT NULL COMMENT '关联来料质检单ID',
  `sku_id`              BIGINT UNSIGNED NOT NULL,
  `po_item_id`          BIGINT UNSIGNED NOT NULL COMMENT '关联采购订单明细ID',
  `qty_delivered`       DECIMAL(16,4)   NOT NULL COMMENT '本次到货数量',
  `qty_sampled`         DECIMAL(16,4)   NOT NULL DEFAULT 0 COMMENT '抽检数量',
  `qty_passed`          DECIMAL(16,4)   NOT NULL DEFAULT 0 COMMENT '合格数量',
  `qty_failed`          DECIMAL(16,4)   NOT NULL DEFAULT 0 COMMENT '不合格数量',
  `result`              ENUM('pass','fail','conditional_pass') DEFAULT NULL,
  `defect_types`        JSON            DEFAULT NULL COMMENT '缺陷类型数组',
  `defect_images`       JSON            DEFAULT NULL COMMENT '缺陷图片URL数组',
  `disposition`         ENUM('accept','return','rework','scrap') DEFAULT NULL COMMENT '处置决定',
  `notes`               VARCHAR(500)    DEFAULT NULL,
  `created_at`          DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`          DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by`          BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_by`          BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_tenant_inspection` (`tenant_id`, `inspection_id`),
  KEY `idx_tenant_sku` (`tenant_id`, `sku_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='来料质检明细表';

-- ─────────────────────────────────────────────────────────────────────────────
-- S3-03. 退货单表 return_orders
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `return_orders` (
  `id`                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`           BIGINT UNSIGNED NOT NULL,
  `return_no`           VARCHAR(50)     NOT NULL COMMENT '退货单号，格式 RTN-YYYYMMDD-NNNN',
  `return_type`         ENUM('purchase_return','production_return') NOT NULL DEFAULT 'purchase_return',
  `source_po_id`        BIGINT UNSIGNED DEFAULT NULL COMMENT '来源采购订单ID',
  `source_inspection_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '来源质检单ID',
  `supplier_id`         BIGINT UNSIGNED DEFAULT NULL,
  `status`              ENUM('draft','confirmed','shipped','completed','cancelled') NOT NULL DEFAULT 'draft',
  `return_reason`       VARCHAR(500)    NOT NULL COMMENT '退货原因',
  `total_qty`           DECIMAL(16,4)   NOT NULL DEFAULT 0,
  `notes`               TEXT            DEFAULT NULL,
  `confirmed_at`        DATETIME(3)     DEFAULT NULL,
  `shipped_at`          DATETIME(3)     DEFAULT NULL,
  `completed_at`        DATETIME(3)     DEFAULT NULL,
  `created_at`          DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`          DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by`          BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_by`          BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_return_no` (`tenant_id`, `return_no`),
  KEY `idx_tenant_po` (`tenant_id`, `source_po_id`),
  KEY `idx_tenant_status` (`tenant_id`, `status`),
  KEY `idx_tenant_supplier` (`tenant_id`, `supplier_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='退货单表';

-- ─────────────────────────────────────────────────────────────────────────────
-- S3-04. 退货单明细表 return_order_items
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `return_order_items` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`     BIGINT UNSIGNED NOT NULL,
  `return_id`     BIGINT UNSIGNED NOT NULL,
  `sku_id`        BIGINT UNSIGNED NOT NULL,
  `qty_return`    DECIMAL(16,4)   NOT NULL COMMENT '退货数量',
  `purchase_unit` VARCHAR(20)     NOT NULL,
  `unit_price`    DECIMAL(14,4)   NOT NULL DEFAULT 0,
  `defect_reason` VARCHAR(200)    DEFAULT NULL,
  `created_at`    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by`    BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_tenant_return` (`tenant_id`, `return_id`),
  KEY `idx_tenant_sku` (`tenant_id`, `sku_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='退货单明细表';

-- ─────────────────────────────────────────────────────────────────────────────
-- S3-05. BOM 版本快照表 bom_version_snapshots（BD-001）
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `bom_version_snapshots` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`       BIGINT UNSIGNED NOT NULL,
  `bom_header_id`   BIGINT UNSIGNED NOT NULL COMMENT '原始 BOM 表头 ID',
  `snapshot_no`     VARCHAR(50)     NOT NULL COMMENT '快照编号',
  `bom_version`     VARCHAR(20)     NOT NULL COMMENT '快照时的 BOM 版本号',
  `snapshot_data`   JSON            NOT NULL COMMENT '展开后的完整物料清单 JSON',
  `snapshot_hash`   VARCHAR(64)     NOT NULL COMMENT 'snapshot_data 的 SHA256 摘要',
  `created_at`      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_by`      BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_snapshot_no` (`tenant_id`, `snapshot_no`),
  KEY `idx_tenant_bom` (`tenant_id`, `bom_header_id`),
  KEY `idx_hash` (`snapshot_hash`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='BOM版本快照表（工单创建时生成）';

-- ─────────────────────────────────────────────────────────────────────────────
-- S3-06. 原材料需求计划表 material_requirements
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `material_requirements` (
  `id`                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`           BIGINT UNSIGNED NOT NULL,
  `production_order_id` BIGINT UNSIGNED NOT NULL,
  `bom_snapshot_id`     BIGINT UNSIGNED NOT NULL COMMENT '关联 BOM 快照',
  `sku_id`              BIGINT UNSIGNED NOT NULL COMMENT '原材料 SKU',
  `qty_required`        DECIMAL(16,4)   NOT NULL COMMENT 'BOM 展开所需数量（含损耗）',
  `qty_reserved`        DECIMAL(16,4)   NOT NULL DEFAULT 0 COMMENT '已从库存预留数量',
  `qty_shortage`        DECIMAL(16,4)   NOT NULL DEFAULT 0 COMMENT '缺口数量',
  `status`              ENUM('shortage','partial','fulfilled') NOT NULL DEFAULT 'shortage',
  `suggestion_id`       BIGINT UNSIGNED DEFAULT NULL COMMENT '关联采购建议ID',
  `created_at`          DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`          DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_tenant_order` (`tenant_id`, `production_order_id`),
  KEY `idx_tenant_sku_status` (`tenant_id`, `sku_id`, `status`),
  KEY `idx_bom_snapshot` (`bom_snapshot_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='生产工单原材料需求计划表';

-- ═════════════════════════════════════════════════════════════════════════════
-- 现有表结构变更（ALTER TABLE）
-- ═════════════════════════════════════════════════════════════════════════════

-- S3-A1: production_orders 增加 BOM 快照和原料状态字段
SET @sql = IF(
  EXISTS(
    SELECT 1
      FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'production_orders'
       AND COLUMN_NAME = 'bom_snapshot_id'
  ),
  'SELECT 1',
  'ALTER TABLE `production_orders` ADD COLUMN `bom_snapshot_id` BIGINT UNSIGNED DEFAULT NULL COMMENT ''BOM版本快照ID（创建工单时锁定，BD-001）'' AFTER `bom_header_id`'
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
       AND COLUMN_NAME = 'material_status'
  ),
  'SELECT 1',
  'ALTER TABLE `production_orders` ADD COLUMN `material_status` ENUM(''unchecked'',''shortage'',''partial'',''ready'') NOT NULL DEFAULT ''unchecked'' COMMENT ''原材料备料状态'' AFTER `status`'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- S3-A2: production_tasks 增加 version 字段（乐观锁）和 exception/suspended 状态
ALTER TABLE `production_tasks`
  MODIFY COLUMN `status` ENUM('pending','started','completed','cancelled','exception','suspended') NOT NULL DEFAULT 'pending';

SET @sql = IF(
  EXISTS(
    SELECT 1
      FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'production_tasks'
       AND COLUMN_NAME = 'version'
  ),
  'SELECT 1',
  'ALTER TABLE `production_tasks` ADD COLUMN `version` INT UNSIGNED NOT NULL DEFAULT 1 COMMENT ''乐观锁版本号'' AFTER `completed_at`'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- S3-A3: delivery_notes 增加质检关联字段
SET @sql = IF(
  EXISTS(
    SELECT 1
      FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'delivery_notes'
       AND COLUMN_NAME = 'inspection_id'
  ),
  'SELECT 1',
  'ALTER TABLE `delivery_notes` ADD COLUMN `inspection_id` BIGINT UNSIGNED DEFAULT NULL COMMENT ''关联来料质检单ID'' AFTER `status`'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  EXISTS(
    SELECT 1
      FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'delivery_notes'
       AND COLUMN_NAME = 'receipt_id'
  ),
  'SELECT 1',
  'ALTER TABLE `delivery_notes` ADD COLUMN `receipt_id` BIGINT UNSIGNED DEFAULT NULL COMMENT ''关联入库单ID'' AFTER `inspection_id`'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- S3-A4: purchase_order_items 增加质检汇总字段
SET @sql = IF(
  EXISTS(
    SELECT 1
      FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'purchase_order_items'
       AND COLUMN_NAME = 'qty_passed'
  ),
  'SELECT 1',
  'ALTER TABLE `purchase_order_items` ADD COLUMN `qty_passed` DECIMAL(16,4) NOT NULL DEFAULT 0 COMMENT ''累计质检合格入库数量'' AFTER `qty_received`'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  EXISTS(
    SELECT 1
      FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'purchase_order_items'
       AND COLUMN_NAME = 'qty_rejected'
  ),
  'SELECT 1',
  'ALTER TABLE `purchase_order_items` ADD COLUMN `qty_rejected` DECIMAL(16,4) NOT NULL DEFAULT 0 COMMENT ''累计质检不合格退货数量'' AFTER `qty_passed`'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- S3-A5: process_steps 增加工序输出类型字段
SET @sql = IF(
  EXISTS(
    SELECT 1
      FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'process_steps'
       AND COLUMN_NAME = 'output_type'
  ),
  'SELECT 1',
  'ALTER TABLE `process_steps` ADD COLUMN `output_type` ENUM(''semi_finished'',''final_product'',''none'') NOT NULL DEFAULT ''none'' COMMENT ''工序产出类型'' AFTER `workstation_type`'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  EXISTS(
    SELECT 1
      FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'process_steps'
       AND COLUMN_NAME = 'output_sku_id'
  ),
  'SELECT 1',
  'ALTER TABLE `process_steps` ADD COLUMN `output_sku_id` BIGINT UNSIGNED DEFAULT NULL COMMENT ''工序产出半成品 SKU ID'' AFTER `output_type`'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- S3-A6: purchase_suggestions 增加来源字段
SET @sql = IF(
  EXISTS(
    SELECT 1
      FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'purchase_suggestions'
       AND COLUMN_NAME = 'source'
  ),
  'SELECT 1',
  'ALTER TABLE `purchase_suggestions` ADD COLUMN `source` ENUM(''ai_schedule'',''production_shortage'',''manual'') NOT NULL DEFAULT ''ai_schedule'' COMMENT ''建议来源'' AFTER `suggestion_no`'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
  EXISTS(
    SELECT 1
      FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'purchase_suggestions'
       AND COLUMN_NAME = 'production_order_id'
  ),
  'SELECT 1',
  'ALTER TABLE `purchase_suggestions` ADD COLUMN `production_order_id` BIGINT UNSIGNED DEFAULT NULL COMMENT ''关联生产工单ID（缺料触发时）'' AFTER `source`'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ─────────────────────────────────────────────────────────────────────────────
-- 迁移完成验证
-- ─────────────────────────────────────────────────────────────────────────────
SELECT 'Sprint 3 migration completed successfully' AS migration_status;
