-- =============================================================================
-- Migration: V2_sprint1_r06_task_exceptions.sql
-- Sprint 1: R-06 生产任务异常上报表
-- Date:      2026-03-13
-- =============================================================================

CREATE TABLE IF NOT EXISTS `task_exceptions` (
  `id`              BIGINT UNSIGNED     NOT NULL AUTO_INCREMENT,
  `tenant_id`       BIGINT UNSIGNED     NOT NULL COMMENT '租户ID',
  `task_id`         BIGINT UNSIGNED     NOT NULL COMMENT '生产任务ID（production_tasks.id）',
  `exception_type`  VARCHAR(50)         NOT NULL COMMENT '异常类型：设备故障/物料缺失/质量异常/其他',
  `description`     TEXT                NOT NULL COMMENT '异常描述',
  `severity`        ENUM('low','medium','high') NOT NULL DEFAULT 'medium' COMMENT '严重程度',
  `reported_by`     BIGINT UNSIGNED     NOT NULL COMMENT '上报人ID',
  `resolved_at`     DATETIME(3)         NULL COMMENT '解决时间',
  `resolved_by`     BIGINT UNSIGNED     NULL COMMENT '解决人ID',
  `resolution`      TEXT                NULL COMMENT '解决方案',
  `created_at`      DATETIME(3)         NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`      DATETIME(3)         NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_tenant_task` (`tenant_id`, `task_id`),
  KEY `idx_tenant_type` (`tenant_id`, `exception_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='生产任务异常记录表';
