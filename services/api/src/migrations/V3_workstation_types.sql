-- [artifact:数据库设计] 工种类型主数据表
CREATE TABLE IF NOT EXISTS `workstation_types` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`   BIGINT UNSIGNED NOT NULL,
  `name`        VARCHAR(100)    NOT NULL,
  `sort_order`  INT             NOT NULL DEFAULT 0,
  `created_at`  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tenant_name` (`tenant_id`, `name`),
  KEY `idx_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 默认工种数据（tenant_id=1）
INSERT IGNORE INTO `workstation_types` (`tenant_id`, `name`, `sort_order`) VALUES
  (1, '开料区', 10),
  (1, '钻孔区', 20),
  (1, '封边区', 30),
  (1, '砂光区', 40),
  (1, '涂装间', 50),
  (1, '装配区', 60),
  (1, 'QC区',   70);
