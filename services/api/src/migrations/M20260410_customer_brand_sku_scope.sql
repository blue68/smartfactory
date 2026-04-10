-- SKU 品牌归属 + 客户 SKU 编码映射 + 销售订单客户编码快照

DROP PROCEDURE IF EXISTS safe_add_column;
DROP PROCEDURE IF EXISTS safe_add_index;

DELIMITER //
CREATE PROCEDURE safe_add_column(
  IN p_table VARCHAR(64),
  IN p_column VARCHAR(64),
  IN p_definition TEXT
)
BEGIN
  SET @col_exists = (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = p_table
      AND COLUMN_NAME = p_column
  );
  IF @col_exists = 0 THEN
    SET @sql = CONCAT('ALTER TABLE `', p_table, '` ADD COLUMN `', p_column, '` ', p_definition);
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END //

CREATE PROCEDURE safe_add_index(
  IN p_table VARCHAR(64),
  IN p_index VARCHAR(64),
  IN p_definition TEXT
)
BEGIN
  SET @idx_exists = (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = p_table
      AND INDEX_NAME = p_index
  );
  IF @idx_exists = 0 THEN
    SET @sql = CONCAT('ALTER TABLE `', p_table, '` ADD INDEX `', p_index, '` ', p_definition);
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END //
DELIMITER ;

CALL safe_add_column(
  'skus',
  'brand_scope',
  "ENUM('factory','customer') NOT NULL DEFAULT 'factory' COMMENT '品牌归属：工厂公共/客户专属' AFTER `production_unit`"
);
CALL safe_add_column(
  'skus',
  'brand_customer_id',
  "BIGINT UNSIGNED NULL COMMENT '客户专属 SKU 所属客户ID' AFTER `brand_scope`"
);
CALL safe_add_index(
  'skus',
  'idx_tenant_brand_scope_status',
  '(tenant_id, brand_scope, status)'
);
CALL safe_add_index(
  'skus',
  'idx_tenant_brand_customer_status',
  '(tenant_id, brand_customer_id, status)'
);

CREATE TABLE IF NOT EXISTS `customer_sku_refs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `tenant_id` BIGINT UNSIGNED NOT NULL COMMENT '所属租户',
  `customer_id` BIGINT UNSIGNED NOT NULL COMMENT '客户ID',
  `sku_id` BIGINT UNSIGNED NOT NULL COMMENT '内部SKU ID',
  `customer_sku_code` VARCHAR(100) NOT NULL COMMENT '客户侧SKU编码',
  `customer_sku_name` VARCHAR(200) DEFAULT NULL COMMENT '客户侧SKU名称',
  `status` ENUM('active','inactive') NOT NULL DEFAULT 'active' COMMENT '状态',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_by` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_customer_sku_code` (`tenant_id`, `customer_id`, `customer_sku_code`),
  UNIQUE KEY `uk_customer_sku_ref` (`tenant_id`, `customer_id`, `sku_id`),
  KEY `idx_customer_sku_refs_sku` (`tenant_id`, `sku_id`, `status`),
  KEY `idx_customer_sku_refs_customer` (`tenant_id`, `customer_id`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='客户SKU编码映射表';

CALL safe_add_column(
  'sales_order_items',
  'customer_sku_code_snapshot',
  "VARCHAR(100) NULL COMMENT '下单时客户侧SKU编码快照' AFTER `sku_id`"
);
CALL safe_add_column(
  'sales_order_items',
  'customer_sku_name_snapshot',
  "VARCHAR(200) NULL COMMENT '下单时客户侧SKU名称快照' AFTER `customer_sku_code_snapshot`"
);

UPDATE `skus`
SET `brand_scope` = 'factory',
    `brand_customer_id` = NULL
WHERE `brand_scope` IS NULL
   OR `brand_scope` NOT IN ('factory', 'customer');

DROP PROCEDURE IF EXISTS safe_add_column;
DROP PROCEDURE IF EXISTS safe_add_index;
