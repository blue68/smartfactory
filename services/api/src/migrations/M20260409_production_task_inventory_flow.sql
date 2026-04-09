-- M20260409_production_task_inventory_flow.sql
-- 生产任务库存动作映射：领料到线边 / 退料回仓 / 报工消耗 / 报工报废 / 产出入库

CREATE TABLE IF NOT EXISTS `task_inventory_movements` (
  `id`                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`           BIGINT UNSIGNED NOT NULL,
  `task_id`             BIGINT UNSIGNED NOT NULL,
  `task_material_tx_id` BIGINT UNSIGNED DEFAULT NULL,
  `sku_id`              BIGINT UNSIGNED NOT NULL,
  `movement_type`       ENUM('issue','return','consume','scrap','output') NOT NULL,
  `inventory_tx_id`     BIGINT UNSIGNED NOT NULL,
  `qty`                 DECIMAL(16,4) NOT NULL DEFAULT 0,
  `notes`               VARCHAR(255) DEFAULT NULL,
  `created_at`          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_by`          BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_inventory_tx` (`tenant_id`, `inventory_tx_id`),
  KEY `idx_tenant_task_movement` (`tenant_id`, `task_id`, `movement_type`),
  KEY `idx_tenant_task_material` (`tenant_id`, `task_material_tx_id`),
  KEY `idx_tenant_task_sku` (`tenant_id`, `task_id`, `sku_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='生产任务与真实库存流水的映射表';
