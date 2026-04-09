-- ============================================================
-- V2 Sprint 1b — R-07 销售客户管理 + R-08 销售订单与紧急插单
-- 执行方式：幂等脚本，首次部署时完整执行一次
-- ============================================================

DROP PROCEDURE IF EXISTS safe_add_column_v2_sprint1b_r07_r08;
DELIMITER $$
CREATE PROCEDURE safe_add_column_v2_sprint1b_r07_r08(
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

-- ============================================================
-- R-07: 销售客户管理 DDL
-- ============================================================

CREATE TABLE IF NOT EXISTS customers (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id      BIGINT UNSIGNED NOT NULL COMMENT '租户ID',
  code           VARCHAR(50)     NOT NULL COMMENT '客户编码',
  name           VARCHAR(200)    NOT NULL COMMENT '客户名称',
  grade          ENUM('VIP','A','B','C') NOT NULL DEFAULT 'B' COMMENT '客户等级',
  contact        VARCHAR(100)    NULL COMMENT '主联系人',
  phone          VARCHAR(30)     NULL COMMENT '主联系电话',
  email          VARCHAR(200)    NULL COMMENT '主联系邮箱',
  address        VARCHAR(300)    NULL COMMENT '地址',
  credit_limit   DECIMAL(14,2)   NULL     COMMENT '授信额度，NULL=不限',
  payment_days   INT             NULL     COMMENT '账期天数',
  status         ENUM('active','inactive') NOT NULL DEFAULT 'active' COMMENT '状态',
  notes          TEXT            NULL     COMMENT '备注',
  created_by     BIGINT UNSIGNED NOT NULL DEFAULT 0,
  updated_by     BIGINT UNSIGNED NOT NULL DEFAULT 0,
  created_at     DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at     DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_customer_code (tenant_id, code),
  KEY idx_customer_status (tenant_id, status),
  KEY idx_customer_grade  (tenant_id, grade)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='销售客户主数据';

CREATE TABLE IF NOT EXISTS customer_contacts (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id   BIGINT UNSIGNED NOT NULL COMMENT '租户ID',
  customer_id BIGINT UNSIGNED NOT NULL COMMENT '关联 customers.id',
  name        VARCHAR(100)    NOT NULL COMMENT '联系人姓名',
  title       VARCHAR(100)    NULL     COMMENT '职务',
  phone       VARCHAR(30)     NULL     COMMENT '电话',
  email       VARCHAR(200)    NULL     COMMENT '邮箱',
  is_primary  TINYINT(1)      NOT NULL DEFAULT 0 COMMENT '是否主要联系人',
  created_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_contact_customer (tenant_id, customer_id),
  KEY idx_contact_primary  (customer_id, is_primary)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='客户联系人';

-- ============================================================
-- R-08: 销售订单 DDL
-- ============================================================

CREATE TABLE IF NOT EXISTS sales_orders (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id      BIGINT UNSIGNED NOT NULL COMMENT '租户ID',
  order_no       VARCHAR(30)     NOT NULL COMMENT '订单号 SO{YYYYMMDD}{6位序列}',
  customer_id    BIGINT UNSIGNED NOT NULL COMMENT '客户ID',
  order_date     DATE            NOT NULL COMMENT '下单日期',
  delivery_date  DATE            NOT NULL COMMENT '要求交货日期',
  is_urgent      TINYINT(1)      NOT NULL DEFAULT 0 COMMENT '是否紧急插单',
  status         ENUM(
    'draft',
    'pending_approval',
    'confirmed',
    'in_production',
    'shipped',
    'completed',
    'closed'
  ) NOT NULL DEFAULT 'draft' COMMENT '订单状态',
  total_amount   DECIMAL(14,2)   NOT NULL DEFAULT 0.00 COMMENT '订单总金额',
  approved_by    BIGINT UNSIGNED NULL     COMMENT '审批人用户ID',
  approved_at    DATETIME(3)     NULL     COMMENT '审批时间',
  reject_reason  VARCHAR(500)    NULL     COMMENT '驳回原因',
  notes          TEXT            NULL     COMMENT '备注',
  created_by     BIGINT UNSIGNED NOT NULL DEFAULT 0,
  updated_by     BIGINT UNSIGNED NOT NULL DEFAULT 0,
  created_at     DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at     DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_sales_order_no   (tenant_id, order_no),
  KEY idx_sales_order_status     (tenant_id, status),
  KEY idx_sales_order_customer   (tenant_id, customer_id),
  KEY idx_sales_urgent_status    (tenant_id, is_urgent, status),
  KEY idx_sales_delivery_date    (delivery_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='销售订单主表';

CREATE TABLE IF NOT EXISTS sales_order_items (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id   BIGINT UNSIGNED NOT NULL COMMENT '租户ID',
  order_id    BIGINT UNSIGNED NOT NULL COMMENT '关联 sales_orders.id',
  sku_id      BIGINT UNSIGNED NOT NULL COMMENT '关联 skus.id',
  quantity    DECIMAL(14,3)   NOT NULL COMMENT '数量',
  unit_price  DECIMAL(14,2)   NOT NULL COMMENT '单价',
  amount      DECIMAL(14,2)   NOT NULL COMMENT '行金额（quantity * unit_price）',
  notes       VARCHAR(500)    NULL     COMMENT '行备注',
  sort_order  INT             NOT NULL DEFAULT 0 COMMENT '排序',
  created_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_soi_order (tenant_id, order_id),
  KEY idx_soi_sku   (tenant_id, sku_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='销售订单明细行';

-- ============================================================
-- production_orders 存量表新增关联字段（幂等检查由应用层执行）
-- 注意: MySQL 8.0 不支持 ADD COLUMN IF NOT EXISTS
-- 迁移工具执行前需先查询 INFORMATION_SCHEMA 确认字段不存在：
--   SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
--   WHERE TABLE_SCHEMA = DATABASE()
--     AND TABLE_NAME = 'production_orders'
--     AND COLUMN_NAME = 'sales_order_item_id';
-- 若返回 0 则执行以下 ALTER，否则跳过。
-- ============================================================
CALL safe_add_column_v2_sprint1b_r07_r08(
  'production_orders',
  'sales_order_item_id',
  'BIGINT UNSIGNED NULL COMMENT ''关联销售订单明细行，追踪到 SKU 行'''
);

DROP PROCEDURE IF EXISTS safe_add_column_v2_sprint1b_r07_r08;
