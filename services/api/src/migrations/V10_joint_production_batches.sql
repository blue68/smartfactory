-- 联合生产批次规划层（前向兼容）

CREATE TABLE IF NOT EXISTS `joint_production_batches` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id` BIGINT UNSIGNED NOT NULL,
  `batch_no` VARCHAR(50) NOT NULL,
  `name` VARCHAR(120) DEFAULT NULL,
  `mode` ENUM('priority_sequential','compatible_merge') NOT NULL DEFAULT 'priority_sequential',
  `status` ENUM('draft','confirmed','order_generated','cancelled','closed') NOT NULL DEFAULT 'draft',
  `order_count` INT NOT NULL DEFAULT 0,
  `item_count` INT NOT NULL DEFAULT 0,
  `total_planned_qty` DECIMAL(16,4) NOT NULL DEFAULT 0,
  `notes` TEXT DEFAULT NULL,
  `confirmed_at` DATETIME(3) DEFAULT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_by` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_batch_no` (`tenant_id`, `batch_no`),
  KEY `idx_tenant_status_created` (`tenant_id`, `status`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='联合生产批次表';

CREATE TABLE IF NOT EXISTS `joint_production_batch_orders` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id` BIGINT UNSIGNED NOT NULL,
  `batch_id` BIGINT UNSIGNED NOT NULL,
  `sales_order_id` BIGINT UNSIGNED NOT NULL,
  `order_priority` SMALLINT NOT NULL DEFAULT 50,
  `sequence_no` INT NOT NULL DEFAULT 1,
  `locked_expected_delivery` DATE DEFAULT NULL,
  `status` ENUM('bound','released','cancelled') NOT NULL DEFAULT 'bound',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_by` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_batch_order` (`tenant_id`, `batch_id`, `sales_order_id`),
  KEY `idx_tenant_batch_seq` (`tenant_id`, `batch_id`, `sequence_no`),
  KEY `idx_tenant_order` (`tenant_id`, `sales_order_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='联合生产批次订单绑定表';

CREATE TABLE IF NOT EXISTS `joint_production_batch_items` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id` BIGINT UNSIGNED NOT NULL,
  `batch_id` BIGINT UNSIGNED NOT NULL,
  `batch_order_id` BIGINT UNSIGNED NOT NULL,
  `sales_order_id` BIGINT UNSIGNED NOT NULL,
  `sales_order_item_id` BIGINT UNSIGNED NOT NULL,
  `sku_id` BIGINT UNSIGNED NOT NULL,
  `bom_header_id` BIGINT UNSIGNED DEFAULT NULL,
  `process_template_id` BIGINT UNSIGNED DEFAULT NULL,
  `qty_open` DECIMAL(16,4) NOT NULL DEFAULT 0,
  `qty_planned` DECIMAL(16,4) NOT NULL DEFAULT 0,
  `mode` ENUM('priority_sequential','compatible_merge') NOT NULL DEFAULT 'priority_sequential',
  `priority_rank` SMALLINT NOT NULL DEFAULT 50,
  `sequence_no` INT NOT NULL DEFAULT 1,
  `merge_group_key` VARCHAR(150) DEFAULT NULL,
  `expected_delivery_snapshot` DATE DEFAULT NULL,
  `snapshot_json` JSON DEFAULT NULL,
  `status` ENUM('planned','released','closed','cancelled') NOT NULL DEFAULT 'planned',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_by` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_batch_so_item` (`tenant_id`, `batch_id`, `sales_order_item_id`),
  KEY `idx_batch_merge` (`tenant_id`, `batch_id`, `merge_group_key`),
  KEY `idx_sales_item` (`tenant_id`, `sales_order_item_id`),
  KEY `idx_sales_order` (`tenant_id`, `sales_order_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='联合生产批次明细表';

CREATE TABLE IF NOT EXISTS `production_order_source_allocations` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id` BIGINT UNSIGNED NOT NULL,
  `production_order_id` BIGINT UNSIGNED NOT NULL,
  `batch_id` BIGINT UNSIGNED DEFAULT NULL,
  `batch_item_id` BIGINT UNSIGNED DEFAULT NULL,
  `sales_order_id` BIGINT UNSIGNED NOT NULL,
  `sales_order_item_id` BIGINT UNSIGNED NOT NULL,
  `allocated_qty` DECIMAL(16,4) NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_by` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_po_batch_item` (`tenant_id`, `production_order_id`, `batch_item_id`),
  KEY `idx_tenant_po` (`tenant_id`, `production_order_id`),
  KEY `idx_tenant_batch_item` (`tenant_id`, `batch_item_id`),
  KEY `idx_tenant_so_item` (`tenant_id`, `sales_order_item_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='生产工单来源分配表';

CREATE TABLE IF NOT EXISTS `purchase_suggestion_sources` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id` BIGINT UNSIGNED NOT NULL,
  `suggestion_id` BIGINT UNSIGNED NOT NULL,
  `source_type` ENUM('material_requirement','production_order','batch_item','sales_order_item') NOT NULL,
  `source_id` BIGINT UNSIGNED NOT NULL,
  `batch_id` BIGINT UNSIGNED DEFAULT NULL,
  `production_order_id` BIGINT UNSIGNED DEFAULT NULL,
  `sales_order_id` BIGINT UNSIGNED DEFAULT NULL,
  `sales_order_item_id` BIGINT UNSIGNED DEFAULT NULL,
  `sku_id` BIGINT UNSIGNED NOT NULL,
  `required_qty` DECIMAL(16,4) NOT NULL DEFAULT 0,
  `shortage_qty` DECIMAL(16,4) NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_suggestion_source` (`tenant_id`, `suggestion_id`, `source_type`, `source_id`),
  KEY `idx_tenant_suggestion` (`tenant_id`, `suggestion_id`),
  KEY `idx_tenant_batch` (`tenant_id`, `batch_id`),
  KEY `idx_tenant_po` (`tenant_id`, `production_order_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='采购建议来源追溯表';

SET @sql = IF(
  EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'production_orders'
      AND COLUMN_NAME = 'sales_order_item_id'
  ),
  'SELECT 1',
  'ALTER TABLE `production_orders` ADD COLUMN `sales_order_item_id` BIGINT UNSIGNED DEFAULT NULL COMMENT ''关联销售订单明细行'' AFTER `sales_order_id`'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'production_orders'
      AND COLUMN_NAME = 'joint_batch_id'
  ),
  'SELECT 1',
  'ALTER TABLE `production_orders` ADD COLUMN `joint_batch_id` BIGINT UNSIGNED DEFAULT NULL COMMENT ''联合生产批次ID'' AFTER `sales_order_item_id`'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'production_orders'
      AND COLUMN_NAME = 'joint_batch_item_id'
  ),
  'SELECT 1',
  'ALTER TABLE `production_orders` ADD COLUMN `joint_batch_item_id` BIGINT UNSIGNED DEFAULT NULL COMMENT ''联合生产批次明细ID'' AFTER `joint_batch_id`'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'production_orders'
      AND COLUMN_NAME = 'batch_sequence_no'
  ),
  'SELECT 1',
  'ALTER TABLE `production_orders` ADD COLUMN `batch_sequence_no` INT DEFAULT NULL COMMENT ''批次内顺序'' AFTER `joint_batch_item_id`'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'production_orders'
      AND COLUMN_NAME = 'plan_mode'
  ),
  'SELECT 1',
  'ALTER TABLE `production_orders` ADD COLUMN `plan_mode` ENUM(''priority_sequential'',''compatible_merge'') DEFAULT NULL COMMENT ''批次规划模式'' AFTER `batch_sequence_no`'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'production_orders'
      AND COLUMN_NAME = 'merge_group_key'
  ),
  'SELECT 1',
  'ALTER TABLE `production_orders` ADD COLUMN `merge_group_key` VARCHAR(150) DEFAULT NULL COMMENT ''兼容合批分组键'' AFTER `plan_mode`'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'production_orders'
      AND INDEX_NAME = 'idx_tenant_batch'
  ),
  'SELECT 1',
  'ALTER TABLE `production_orders` ADD KEY `idx_tenant_batch` (`tenant_id`, `joint_batch_id`, `status`)'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'production_orders'
      AND INDEX_NAME = 'idx_tenant_batch_item'
  ),
  'SELECT 1',
  'ALTER TABLE `production_orders` ADD KEY `idx_tenant_batch_item` (`tenant_id`, `joint_batch_item_id`)'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'material_requirements'
      AND COLUMN_NAME = 'joint_batch_id'
  ),
  'SELECT 1',
  'ALTER TABLE `material_requirements` ADD COLUMN `joint_batch_id` BIGINT UNSIGNED DEFAULT NULL COMMENT ''联合生产批次ID'' AFTER `production_order_id`'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'material_requirements'
      AND COLUMN_NAME = 'joint_batch_item_id'
  ),
  'SELECT 1',
  'ALTER TABLE `material_requirements` ADD COLUMN `joint_batch_item_id` BIGINT UNSIGNED DEFAULT NULL COMMENT ''联合生产批次明细ID'' AFTER `joint_batch_id`'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'material_requirements'
      AND INDEX_NAME = 'idx_tenant_joint_batch'
  ),
  'SELECT 1',
  'ALTER TABLE `material_requirements` ADD KEY `idx_tenant_joint_batch` (`tenant_id`, `joint_batch_id`)'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'material_requirements'
      AND INDEX_NAME = 'idx_tenant_joint_batch_item'
  ),
  'SELECT 1',
  'ALTER TABLE `material_requirements` ADD KEY `idx_tenant_joint_batch_item` (`tenant_id`, `joint_batch_item_id`)'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'purchase_suggestions'
      AND COLUMN_NAME = 'production_batch_id'
  ),
  'SELECT 1',
  'ALTER TABLE `purchase_suggestions` ADD COLUMN `production_batch_id` BIGINT UNSIGNED DEFAULT NULL COMMENT ''联合生产批次ID'' AFTER `production_operation_id`'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'purchase_suggestions'
      AND COLUMN_NAME = 'primary_source_type'
  ),
  'SELECT 1',
  'ALTER TABLE `purchase_suggestions` ADD COLUMN `primary_source_type` ENUM(''material_requirement'',''production_order'',''batch_item'',''sales_order_item'') DEFAULT NULL COMMENT ''主来源类型'' AFTER `production_batch_id`'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'purchase_suggestions'
      AND COLUMN_NAME = 'primary_source_id'
  ),
  'SELECT 1',
  'ALTER TABLE `purchase_suggestions` ADD COLUMN `primary_source_id` BIGINT UNSIGNED DEFAULT NULL COMMENT ''主来源ID'' AFTER `primary_source_type`'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'purchase_suggestions'
      AND INDEX_NAME = 'idx_tenant_batch_status'
  ),
  'SELECT 1',
  'ALTER TABLE `purchase_suggestions` ADD KEY `idx_tenant_batch_status` (`tenant_id`, `production_batch_id`, `status`)'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

ALTER TABLE `purchase_suggestions`
  MODIFY COLUMN `source` ENUM('ai_schedule','production_shortage','manual','outsource_operation','production_batch_shortage')
  NOT NULL DEFAULT 'ai_schedule'
  COMMENT '建议来源';
