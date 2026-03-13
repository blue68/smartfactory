-- ============================================================
-- Migration: Sprint 1 — R-02 & R-03
-- 日期: 2026-03-12
-- 作者: senior-backend-engineer
-- 描述:
--   1. 新建 import_tasks 表（R-03 异步导入任务，支持 5000 行）
--   2. 为 suppliers 表补充绩效相关字段索引（R-02 性能优化）
-- ============================================================

-- ──────────────────────────────────────────────────────────
-- 1. import_tasks 表
--    用于异步批量导入（价格/SKU）的任务跟踪
--    P0-R03-01: 上限 5000 行，异步队列处理，进度可查
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `import_tasks` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`     BIGINT UNSIGNED NOT NULL COMMENT '租户ID',
  `type`          ENUM('price', 'sku') NOT NULL COMMENT '导入类型',
  `status`        ENUM('pending', 'processing', 'completed', 'failed')
                    NOT NULL DEFAULT 'pending' COMMENT '任务状态',
  `total_rows`    INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '总行数（不含表头）',
  `success_count` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '成功写入行数',
  `fail_count`    INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '失败行数',
  `skip_count`    INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '主动跳过行数（错误行跳过）',
  `warning_count` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '警告行数（价格偏高等不阻断警告）',
  `error_details` JSON NULL COMMENT '错误详情，格式: [{row, column?, message, type?}]',
  `warning_details` JSON NULL COMMENT '警告详情，格式: [{row, column?, message, type?}]',
  `file_path`     VARCHAR(500) NULL COMMENT '上传文件临时路径',
  `file_name`     VARCHAR(255) NULL COMMENT '原始文件名',
  `created_by`    BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '操作人ID',
  `created_at`    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `idx_import_tasks_tenant_status` (`tenant_id`, `status`),
  INDEX `idx_import_tasks_tenant_type` (`tenant_id`, `type`),
  INDEX `idx_import_tasks_created_by` (`tenant_id`, `created_by`)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci
  COMMENT='批量导入任务表（支持 5000 行异步处理）';

-- ──────────────────────────────────────────────────────────
-- 2. suppliers 表：绩效查询辅助索引（R-02 compare 接口）
--    purchase_orders 表上的多供应商并发绩效聚合优化
-- ──────────────────────────────────────────────────────────
-- 注意：索引添加前请确认 purchase_orders 表存在，若不存在则跳过
-- ALTER TABLE `purchase_orders`
--   ADD INDEX IF NOT EXISTS `idx_po_tenant_supplier_status`
--     (`tenant_id`, `supplier_id`, `status`),
--   ADD INDEX IF NOT EXISTS `idx_po_tenant_supplier_month`
--     (`tenant_id`, `supplier_id`, `created_at`);
-- （若 purchase_orders 已有此索引则无需重复执行）
