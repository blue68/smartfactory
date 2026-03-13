-- ============================================================
-- V2 Sprint 1 — submit_count 字段 + audit_logs 表
-- 执行方式：幂等脚本，首次部署时完整执行一次
-- ============================================================

-- ── 1. sales_orders 新增提交审批计数字段 ──────────────────────────────────
-- MySQL 8.0 不支持 ADD COLUMN IF NOT EXISTS，执行前请先检查：
--   SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
--   WHERE TABLE_SCHEMA = DATABASE()
--     AND TABLE_NAME   = 'sales_orders'
--     AND COLUMN_NAME  = 'submit_count';
-- 若返回 0 则执行以下 ALTER，否则跳过。
ALTER TABLE sales_orders
  ADD COLUMN submit_count TINYINT UNSIGNED NOT NULL DEFAULT 0
    COMMENT '提交审批次数，达到上限（3）时自动关闭订单，防止反复滥提';

-- ── 2. audit_logs 审计日志表 ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_logs (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id   BIGINT UNSIGNED NOT NULL COMMENT '租户ID',
  module      VARCHAR(50)     NOT NULL COMMENT '业务模块标识，如 sku_category',
  action      VARCHAR(30)     NOT NULL COMMENT '操作类型：CREATE / UPDATE / DELETE',
  target_id   BIGINT UNSIGNED NOT NULL COMMENT '操作目标主键',
  target_code VARCHAR(100)    NULL     COMMENT '目标编码，冗余字段便于可读性检索',
  before_data JSON            NULL     COMMENT '变更前数据快照',
  after_data  JSON            NULL     COMMENT '变更后数据快照',
  operator_id BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '操作人用户ID',
  created_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_audit_tenant_module (tenant_id, module),
  KEY idx_audit_target        (tenant_id, module, target_id),
  KEY idx_audit_created       (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='系统操作审计日志（目前覆盖 sku_category 模块）';
