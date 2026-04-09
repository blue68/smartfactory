-- Phase 1: 半成品排产 / 工序级投入产出 / 通配解析 / 日结库存

CREATE TABLE IF NOT EXISTS `production_order_components` (
  `id`                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`         BIGINT UNSIGNED NOT NULL,
  `production_order_id` BIGINT UNSIGNED NOT NULL,
  `parent_component_id` BIGINT UNSIGNED DEFAULT NULL,
  `sku_id`            BIGINT UNSIGNED NOT NULL,
  `resolved_sku_id`   BIGINT UNSIGNED DEFAULT NULL,
  `component_type`    ENUM('fg','wip','rm') NOT NULL,
  `qty_required`      DECIMAL(16,4) NOT NULL DEFAULT 0,
  `bom_level`         SMALLINT NOT NULL DEFAULT 0,
  `bom_path`          VARCHAR(255) DEFAULT NULL,
  `wildcard_rule_id`  BIGINT UNSIGNED DEFAULT NULL,
  `created_at`        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by`        BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_by`        BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_tenant_order` (`tenant_id`, `production_order_id`),
  KEY `idx_tenant_resolved_sku` (`tenant_id`, `resolved_sku_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='生产工单冻结后的成品/半成品/原材料结构';

CREATE TABLE IF NOT EXISTS `process_step_materials` (
  `id`                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`         BIGINT UNSIGNED NOT NULL,
  `template_id`       BIGINT UNSIGNED NOT NULL,
  `step_no`           SMALLINT NOT NULL,
  `input_sku_id`      BIGINT UNSIGNED NOT NULL,
  `usage_per_unit`    DECIMAL(16,4) NOT NULL DEFAULT 0,
  `loss_rate`         DECIMAL(8,4) NOT NULL DEFAULT 0,
  `consume_timing`    ENUM('start','complete') NOT NULL DEFAULT 'start',
  `created_at`        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by`        BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_by`        BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_template_step_input` (`tenant_id`, `template_id`, `step_no`, `input_sku_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='工序投入物料定义';

CREATE TABLE IF NOT EXISTS `production_operations` (
  `id`                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`         BIGINT UNSIGNED NOT NULL,
  `production_order_id` BIGINT UNSIGNED NOT NULL,
  `component_id`      BIGINT UNSIGNED NOT NULL,
  `process_step_id`   BIGINT UNSIGNED NOT NULL,
  `output_sku_id`     BIGINT UNSIGNED DEFAULT NULL,
  `planned_qty`       DECIMAL(16,4) NOT NULL DEFAULT 0,
  `completed_qty`     DECIMAL(16,4) NOT NULL DEFAULT 0,
  `status`            ENUM('pending','released','scheduled','in_progress','completed','blocked','cancelled')
                      NOT NULL DEFAULT 'pending',
  `created_at`        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by`        BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_by`        BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_tenant_order_status` (`tenant_id`, `production_order_id`, `status`),
  KEY `idx_tenant_output_sku` (`tenant_id`, `output_sku_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='工单级作业单，作为半成品排产主对象';

CREATE TABLE IF NOT EXISTS `production_operation_dependencies` (
  `id`                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`         BIGINT UNSIGNED NOT NULL,
  `operation_id`      BIGINT UNSIGNED NOT NULL,
  `predecessor_operation_id` BIGINT UNSIGNED NOT NULL,
  `required_qty`      DECIMAL(16,4) NOT NULL DEFAULT 0,
  `created_at`        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_operation_pred` (`tenant_id`, `operation_id`, `predecessor_operation_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='作业单依赖关系';

CREATE TABLE IF NOT EXISTS `production_order_sku_resolutions` (
  `id`                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`         BIGINT UNSIGNED NOT NULL,
  `production_order_id` BIGINT UNSIGNED NOT NULL,
  `component_id`      BIGINT UNSIGNED NOT NULL,
  `base_sku_id`       BIGINT UNSIGNED NOT NULL,
  `resolved_sku_id`   BIGINT UNSIGNED NOT NULL,
  `rule_id`           BIGINT UNSIGNED DEFAULT NULL,
  `resolved_at`       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_by`        BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_order_component` (`tenant_id`, `production_order_id`, `component_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='通配半成品解析冻结结果';

CREATE TABLE IF NOT EXISTS `sku_substitution_rules` (
  `id`                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`         BIGINT UNSIGNED NOT NULL,
  `base_sku_id`       BIGINT UNSIGNED NOT NULL,
  `candidate_sku_id`  BIGINT UNSIGNED NOT NULL,
  `priority`          INT NOT NULL DEFAULT 100,
  `match_attrs`       JSON DEFAULT NULL,
  `effective_from`    DATETIME(3) DEFAULT NULL,
  `effective_to`      DATETIME(3) DEFAULT NULL,
  `status`            ENUM('active','inactive') NOT NULL DEFAULT 'active',
  `created_at`        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by`        BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_by`        BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_base_candidate_priority` (`tenant_id`, `base_sku_id`, `candidate_sku_id`, `priority`),
  KEY `idx_tenant_base_status_window` (`tenant_id`, `base_sku_id`, `status`, `effective_from`, `effective_to`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='半成品通配替代规则';

CREATE TABLE IF NOT EXISTS `task_material_transactions` (
  `id`                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`         BIGINT UNSIGNED NOT NULL,
  `task_id`           BIGINT UNSIGNED NOT NULL,
  `operation_id`      BIGINT UNSIGNED DEFAULT NULL,
  `sku_id`            BIGINT UNSIGNED NOT NULL,
  `io_type`           ENUM('input','output') NOT NULL,
  `planned_qty`       DECIMAL(16,4) NOT NULL DEFAULT 0,
  `actual_qty`        DECIMAL(16,4) NOT NULL DEFAULT 0,
  `inventory_tx_id`   BIGINT UNSIGNED DEFAULT NULL,
  `created_at`        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_by`        BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_tenant_task` (`tenant_id`, `task_id`),
  KEY `idx_tenant_task_io` (`tenant_id`, `task_id`, `io_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='任务级投入产出记录';

CREATE TABLE IF NOT EXISTS `inventory_daily_snapshots` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`       BIGINT UNSIGNED NOT NULL,
  `snapshot_date`   DATE NOT NULL,
  `warehouse_id`    BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `sku_id`          BIGINT UNSIGNED NOT NULL,
  `qty_on_hand`     DECIMAL(16,4) NOT NULL DEFAULT 0,
  `qty_reserved`    DECIMAL(16,4) NOT NULL DEFAULT 0,
  `qty_available`   DECIMAL(16,4) NOT NULL DEFAULT 0,
  `created_at`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_date_wh_sku` (`tenant_id`, `snapshot_date`, `warehouse_id`, `sku_id`),
  KEY `idx_tenant_date_wh` (`tenant_id`, `snapshot_date`, `warehouse_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='库存日结快照';
