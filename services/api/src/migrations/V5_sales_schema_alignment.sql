-- ============================================================================
-- V5: Sales Schema Alignment (code-first compatibility)
-- 日期: 2026-03-24
--
-- 目的：
-- 1) 对齐 sales_orders / sales_order_items 与当前服务代码使用的列名
-- 2) 对旧列做幂等数据回填（delivery_date/is_urgent/quantity -> 新列）
-- 3) 补齐 sales 模块依赖但历史迁移缺失的业务表
-- ============================================================================

-- ─── 幂等 DDL helpers ────────────────────────────────────────────────────────
DROP PROCEDURE IF EXISTS safe_add_column;
DELIMITER //
CREATE PROCEDURE safe_add_column(
  IN p_table VARCHAR(64),
  IN p_column VARCHAR(64),
  IN p_definition TEXT
)
BEGIN
  SET @col_exists = (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
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
DELIMITER ;

DROP PROCEDURE IF EXISTS safe_modify_column;
DELIMITER //
CREATE PROCEDURE safe_modify_column(
  IN p_table VARCHAR(64),
  IN p_column VARCHAR(64),
  IN p_definition TEXT
)
BEGIN
  SET @col_exists = (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = p_table
      AND COLUMN_NAME = p_column
  );
  IF @col_exists > 0 THEN
    SET @sql = CONCAT('ALTER TABLE `', p_table, '` MODIFY COLUMN `', p_column, '` ', p_definition);
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END //
DELIMITER ;

-- ─── sales_orders: 补齐当前代码依赖列 ─────────────────────────────────────────
CALL safe_add_column('sales_orders', 'expected_delivery', "DATE NULL COMMENT '要求交期（新字段）'");
CALL safe_add_column('sales_orders', 'order_type', "ENUM('normal','urgent') NULL DEFAULT 'normal' COMMENT '订单类型'");
CALL safe_add_column('sales_orders', 'estimated_delivery', "DATE NULL COMMENT '预计交期'");
CALL safe_add_column('sales_orders', 'constraint_passed', "TINYINT(1) NOT NULL DEFAULT 0 COMMENT '约束检查是否通过'");
CALL safe_add_column('sales_orders', 'approval_status', "ENUM('not_required','pending','approved','rejected','conditional') NOT NULL DEFAULT 'not_required' COMMENT '审批状态'");
CALL safe_add_column('sales_orders', 'approval_notes', "TEXT NULL COMMENT '审批备注'");
CALL safe_add_column('sales_orders', 'sales_person_id', "BIGINT UNSIGNED NULL COMMENT '销售员ID'");

-- 状态枚举对齐：兼容 sales 与 sales-order 两套流程
CALL safe_modify_column(
  'sales_orders',
  'status',
  "ENUM('draft','pending_approval','confirmed','in_production','produced','partial_shipped','shipped','completed','closed','cancelled') NOT NULL DEFAULT 'draft'"
);

-- ─── sales_order_items: 补齐当前代码依赖列 ────────────────────────────────────
CALL safe_add_column('sales_order_items', 'qty_ordered', "DECIMAL(14,3) NULL COMMENT '订购数量（新字段）'");
CALL safe_add_column('sales_order_items', 'qty_delivered', "DECIMAL(14,3) NOT NULL DEFAULT 0 COMMENT '累计发货数量'");
CALL safe_add_column('sales_order_items', 'bom_header_id', "BIGINT UNSIGNED NULL COMMENT '关联 BOM 版本'");
CALL safe_add_column('sales_order_items', 'created_by', "BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '创建人'");
CALL safe_add_column('sales_order_items', 'updated_by', "BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '更新人'");

-- ─── 数据回填（仅在源列存在时执行）────────────────────────────────────────────
DROP PROCEDURE IF EXISTS sync_sales_schema_data;
DELIMITER //
CREATE PROCEDURE sync_sales_schema_data()
BEGIN
  DECLARE has_delivery_date INT DEFAULT 0;
  DECLARE has_expected_delivery INT DEFAULT 0;
  DECLARE has_is_urgent INT DEFAULT 0;
  DECLARE has_order_type INT DEFAULT 0;
  DECLARE has_created_by INT DEFAULT 0;
  DECLARE has_sales_person_id INT DEFAULT 0;
  DECLARE has_quantity INT DEFAULT 0;
  DECLARE has_qty_ordered INT DEFAULT 0;
  DECLARE has_status INT DEFAULT 0;
  DECLARE has_approval_status INT DEFAULT 0;

  SELECT COUNT(*) INTO has_delivery_date
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sales_orders' AND COLUMN_NAME = 'delivery_date';

  SELECT COUNT(*) INTO has_expected_delivery
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sales_orders' AND COLUMN_NAME = 'expected_delivery';

  IF has_delivery_date > 0 AND has_expected_delivery > 0 THEN
    SET @sql = 'UPDATE sales_orders SET expected_delivery = COALESCE(expected_delivery, delivery_date) WHERE expected_delivery IS NULL';
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;

  SELECT COUNT(*) INTO has_is_urgent
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sales_orders' AND COLUMN_NAME = 'is_urgent';

  SELECT COUNT(*) INTO has_order_type
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sales_orders' AND COLUMN_NAME = 'order_type';

  IF has_is_urgent > 0 AND has_order_type > 0 THEN
    SET @sql = "UPDATE sales_orders SET order_type = CASE WHEN is_urgent = 1 THEN 'urgent' ELSE 'normal' END WHERE order_type IS NULL";
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;

  SELECT COUNT(*) INTO has_created_by
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sales_orders' AND COLUMN_NAME = 'created_by';

  SELECT COUNT(*) INTO has_sales_person_id
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sales_orders' AND COLUMN_NAME = 'sales_person_id';

  IF has_created_by > 0 AND has_sales_person_id > 0 THEN
    SET @sql = 'UPDATE sales_orders SET sales_person_id = created_by WHERE sales_person_id IS NULL';
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;

  SELECT COUNT(*) INTO has_status
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sales_orders' AND COLUMN_NAME = 'status';

  SELECT COUNT(*) INTO has_approval_status
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sales_orders' AND COLUMN_NAME = 'approval_status';

  IF has_status > 0 AND has_approval_status > 0 THEN
    SET @sql = "UPDATE sales_orders SET approval_status = CASE WHEN status = 'pending_approval' THEN 'pending' ELSE 'not_required' END WHERE approval_status IS NULL";
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;

  SELECT COUNT(*) INTO has_quantity
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sales_order_items' AND COLUMN_NAME = 'quantity';

  SELECT COUNT(*) INTO has_qty_ordered
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sales_order_items' AND COLUMN_NAME = 'qty_ordered';

  IF has_quantity > 0 AND has_qty_ordered > 0 THEN
    SET @sql = 'UPDATE sales_order_items SET qty_ordered = COALESCE(qty_ordered, quantity) WHERE qty_ordered IS NULL';
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END //
DELIMITER ;

CALL sync_sales_schema_data();

-- 回填完成后，对关键列收紧约束
CALL safe_modify_column('sales_orders', 'order_type', "ENUM('normal','urgent') NOT NULL DEFAULT 'normal'");
CALL safe_modify_column('sales_orders', 'expected_delivery', "DATE NOT NULL");
CALL safe_modify_column('sales_orders', 'sales_person_id', "BIGINT UNSIGNED NOT NULL");
CALL safe_modify_column('sales_order_items', 'qty_ordered', "DECIMAL(14,3) NOT NULL");

-- ─── 补齐缺失业务表（sales 模块）────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS order_constraint_checks (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id BIGINT UNSIGNED NOT NULL,
  order_id BIGINT UNSIGNED NOT NULL,
  check_time DATETIME NOT NULL,
  inventory_turnover_check JSON NULL,
  capital_occupation_check JSON NULL,
  production_cost_check JSON NULL,
  capacity_load_check JSON NULL,
  overall_result ENUM('pass','warning','block') NOT NULL DEFAULT 'pass',
  blocked_reasons JSON NULL,
  impact_analysis JSON NULL,
  created_by BIGINT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_occ_order (tenant_id, order_id),
  KEY idx_occ_time (tenant_id, check_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='销售订单约束检查记录';

CREATE TABLE IF NOT EXISTS sales_deliveries (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id BIGINT UNSIGNED NOT NULL,
  order_id BIGINT UNSIGNED NOT NULL,
  delivery_no VARCHAR(32) NOT NULL,
  tracking_no VARCHAR(128) NULL,
  status ENUM('pending','received') NOT NULL DEFAULT 'pending',
  shipped_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  received_at DATETIME NULL,
  created_by BIGINT UNSIGNED NOT NULL DEFAULT 0,
  updated_by BIGINT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sales_deliveries_no (tenant_id, delivery_no),
  KEY idx_sales_deliveries_order (tenant_id, order_id),
  KEY idx_sales_deliveries_status (tenant_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='销售发货主表';

CREATE TABLE IF NOT EXISTS sales_delivery_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id BIGINT UNSIGNED NOT NULL,
  delivery_id BIGINT UNSIGNED NOT NULL,
  order_item_id BIGINT UNSIGNED NOT NULL,
  shipped_qty DECIMAL(14,3) NOT NULL,
  created_by BIGINT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_sales_delivery_items_delivery (tenant_id, delivery_id),
  KEY idx_sales_delivery_items_order_item (tenant_id, order_item_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='销售发货明细';

CREATE TABLE IF NOT EXISTS sales_settlements (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id BIGINT UNSIGNED NOT NULL,
  order_id BIGINT UNSIGNED NOT NULL,
  settlement_no VARCHAR(50) NOT NULL,
  total_amount DECIMAL(16,2) NOT NULL DEFAULT 0.00,
  paid_amount DECIMAL(16,2) NOT NULL DEFAULT 0.00,
  status ENUM('pending','partial_paid','paid','overdue') NOT NULL DEFAULT 'pending',
  due_date DATE NULL,
  notes TEXT NULL,
  invoice_no VARCHAR(100) NULL,
  invoice_date DATE NULL,
  created_by BIGINT UNSIGNED NOT NULL DEFAULT 0,
  updated_by BIGINT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sales_settlements_no (tenant_id, settlement_no),
  KEY idx_sales_settlements_order (tenant_id, order_id),
  KEY idx_sales_settlements_status (tenant_id, status),
  KEY idx_sales_settlements_due_date (tenant_id, due_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='销售结算单';

-- ─── 清理 helper procedures ──────────────────────────────────────────────────
DROP PROCEDURE IF EXISTS sync_sales_schema_data;
DROP PROCEDURE IF EXISTS safe_add_column;
DROP PROCEDURE IF EXISTS safe_modify_column;

-- ─── 迁移结果校验输出 ─────────────────────────────────────────────────────────
SELECT
  'V5 sales schema alignment completed' AS migration_status,
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sales_orders' AND COLUMN_NAME = 'expected_delivery') AS sales_orders_expected_delivery,
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sales_orders' AND COLUMN_NAME = 'order_type') AS sales_orders_order_type,
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sales_order_items' AND COLUMN_NAME = 'qty_ordered') AS sales_order_items_qty_ordered,
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'order_constraint_checks') AS order_constraint_checks_exists,
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sales_deliveries') AS sales_deliveries_exists,
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sales_settlements') AS sales_settlements_exists;
