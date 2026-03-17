-- =============================================================================
-- V2_f105_f707_analytics.sql
-- F-105 库存盘点 / F-707 销售结算 数据库迁移
-- =============================================================================

-- ─── F-105: 库存盘点任务主表 ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS stocktaking_tasks (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id       BIGINT UNSIGNED NOT NULL,
  task_no         VARCHAR(50)     NOT NULL,
  scope           ENUM('all','category','location') NOT NULL DEFAULT 'all',
  scope_value     VARCHAR(100)    NULL COMMENT '品类ID 或 库位编码',
  status          ENUM('draft','in_progress','completed','confirmed') NOT NULL DEFAULT 'draft',
  total_items     INT             NOT NULL DEFAULT 0,
  diff_items      INT             NOT NULL DEFAULT 0,
  created_by      BIGINT UNSIGNED NOT NULL,
  confirmed_by    BIGINT UNSIGNED NULL,
  confirmed_at    DATETIME(3)     NULL,
  created_at      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX idx_tenant_status (tenant_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='库存盘点任务主表';

-- ─── F-105: 库存盘点明细表 ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS stocktaking_items (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id   BIGINT UNSIGNED NOT NULL,
  task_id     BIGINT UNSIGNED NOT NULL,
  sku_id      BIGINT UNSIGNED NOT NULL,
  system_qty  DECIMAL(16,4)   NOT NULL DEFAULT 0 COMMENT '系统库存数量（快照）',
  actual_qty  DECIMAL(16,4)   NULL     COMMENT '实盘数量（NULL 表示未录入）',
  diff_qty    DECIMAL(16,4) GENERATED ALWAYS AS (COALESCE(actual_qty, 0) - system_qty) STORED
                              COMMENT '差异数量 = 实盘 - 系统（负数为亏库）',
  notes       VARCHAR(500)    NULL,
  created_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX idx_task       (task_id),
  INDEX idx_tenant_sku (tenant_id, sku_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='库存盘点明细表';

-- ─── F-707: 销售财务结算单 ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS settlements (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id       BIGINT UNSIGNED NOT NULL,
  settlement_no   VARCHAR(50)     NOT NULL,
  customer_id     BIGINT UNSIGNED NOT NULL,
  order_id        BIGINT UNSIGNED NOT NULL,
  total_amount    DECIMAL(16,2)   NOT NULL,
  status          ENUM('draft','confirmed','paid','cancelled') NOT NULL DEFAULT 'draft',
  confirmed_by    BIGINT UNSIGNED NULL,
  confirmed_at    DATETIME(3)     NULL,
  paid_at         DATETIME(3)     NULL,
  notes           TEXT            NULL,
  created_by      BIGINT UNSIGNED NOT NULL,
  updated_by      BIGINT UNSIGNED NOT NULL,
  created_at      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX idx_tenant_status (tenant_id, status),
  INDEX idx_customer      (tenant_id, customer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='销售财务结算单';
