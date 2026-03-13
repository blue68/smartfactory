-- =============================================================================
-- Migration: V2_sprint1_r01_r05.sql
-- Sprint 1: R-01 SKU类目自定义配置 + R-05 工序极限工时与工价计算
-- Author:    senior-backend-engineer
-- Date:      2026-03-12
-- =============================================================================

-- -----------------------------------------------------------------------------
-- R-01: sku_categories 表补充联合唯一索引
-- 防止同一租户同 level 下 code 重复（含系统预置 tenant_id=0）
-- -----------------------------------------------------------------------------
ALTER TABLE `sku_categories`
  ADD UNIQUE KEY `uk_tenant_level_code` (`tenant_id`, `level`, `code`);

-- -----------------------------------------------------------------------------
-- R-05-A: process_steps 表添加 max_hours 字段（极限工时）
-- -----------------------------------------------------------------------------
ALTER TABLE `process_steps`
  ADD COLUMN `max_hours` DECIMAL(6,2) NULL DEFAULT NULL
    COMMENT '极限工时（小时/件），超出则触发预警' AFTER `standard_hours`;

-- -----------------------------------------------------------------------------
-- R-05-B: 新建 process_wages 表（工价配置，区分工人等级）
-- uk_tenant_step_grade: 同一租户同工序同等级只允许一条有效记录，UPSERT 用
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `process_wages` (
  `id`           BIGINT UNSIGNED     NOT NULL AUTO_INCREMENT,
  `tenant_id`    BIGINT UNSIGNED     NOT NULL COMMENT '租户ID',
  `step_id`      BIGINT UNSIGNED     NOT NULL COMMENT '工序步骤ID（process_steps.id）',
  `worker_grade` ENUM('skilled','apprentice') NOT NULL COMMENT '工人等级：skilled=熟练工 apprentice=学徒',
  `unit_price`   DECIMAL(10,2)       NOT NULL DEFAULT 0.00 COMMENT '计件单价（元/件）',
  `created_at`   DATETIME(3)         NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`   DATETIME(3)         NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by`   BIGINT UNSIGNED     NOT NULL DEFAULT 0,
  `updated_by`   BIGINT UNSIGNED     NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_step_grade` (`tenant_id`, `step_id`, `worker_grade`),
  KEY `idx_tenant_step`  (`tenant_id`, `step_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='工序工价配置表';

-- -----------------------------------------------------------------------------
-- R-05-C（P0-R05-01 修正项）: users 表添加 skill_level 字段
-- 用于工资核算时匹配对应等级单价
-- -----------------------------------------------------------------------------
ALTER TABLE `users`
  ADD COLUMN `skill_level` ENUM('skilled','apprentice') NULL DEFAULT NULL
    COMMENT '工人技能等级：skilled=熟练工 apprentice=学徒，非生产工人可为 NULL' AFTER `role`;
