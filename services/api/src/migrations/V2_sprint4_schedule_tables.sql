-- ═════════════════════════════════════════════════════════════════════════════
-- Sprint 4 数据库迁移脚本
-- 版本: V2_sprint4
-- 日期: 2026-03-14
-- 功能:
--   BE-S4-07  新建三张调度建议表：
--             schedule_suggestions       调度建议批次表
--             schedule_suggestion_items  调度建议明细表
--             suggestion_audit_logs      建议审计日志表
--   BE-S4-08  扩展 purchase_suggestions 表（新增 9 个字段）
--
-- 执行说明:
--   1. 所有 CREATE TABLE 已加 IF NOT EXISTS，可重复执行。
--   2. ALTER TABLE 通过存储过程 + INFORMATION_SCHEMA 查询实现幂等，
--      字段不存在时添加，已存在时跳过。
--   3. Sprint 3 已添加的 `source` 和 `production_order_id` 字段此处不重复处理。
--   4. 本脚本依赖 MySQL 8.0+（使用 INFORMATION_SCHEMA.COLUMNS 幂等检测）。
-- ═════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- BE-S4-07 / S4-01: 调度建议批次表 schedule_suggestions
-- 记录每次调度计算的批次信息，含 BullMQ job 追踪与计算状态
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `schedule_suggestions` (
  `id`               INT             NOT NULL AUTO_INCREMENT,
  `tenant_id`        INT             NOT NULL COMMENT '租户ID',
  `batch_no`         VARCHAR(32)     NOT NULL COMMENT '批次编号，格式 SCH-YYYYMMDD-NNNN',
  `trigger_type`     ENUM('manual','cron','event') NOT NULL DEFAULT 'manual'
                       COMMENT '触发方式：manual=手动触发 cron=定时触发 event=事件触发',
  `triggered_by`     INT             DEFAULT NULL COMMENT '手动触发时的触发人用户ID，定时/事件触发时为NULL',
  `status`           ENUM('pending','calculating','completed','failed') NOT NULL DEFAULT 'pending'
                       COMMENT '批次状态',
  `job_id`           VARCHAR(64)     DEFAULT NULL COMMENT 'BullMQ Job ID，用于追踪异步计算任务',
  `purchase_count`   INT             NOT NULL DEFAULT 0 COMMENT '本批次生成的采购建议数量',
  `production_count` INT             NOT NULL DEFAULT 0 COMMENT '本批次生成的排产建议数量',
  `calc_started_at`  DATETIME        DEFAULT NULL COMMENT '计算开始时间',
  `calc_finished_at` DATETIME        DEFAULT NULL COMMENT '计算结束时间',
  `error_message`    TEXT            DEFAULT NULL COMMENT '失败时的错误信息',
  `created_at`       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at`       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `created_by`       INT             DEFAULT NULL COMMENT '创建人用户ID',
  `updated_by`       INT             DEFAULT NULL COMMENT '最后更新人用户ID',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_batch_no` (`tenant_id`, `batch_no`),
  INDEX `idx_tenant_status`  (`tenant_id`, `status`),
  INDEX `idx_job_id`         (`job_id`),
  INDEX `idx_tenant_created` (`tenant_id`, `created_at` DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='调度建议批次表，记录每次（手动/定时/事件）调度计算的批次信息';

-- ─────────────────────────────────────────────────────────────────────────────
-- BE-S4-07 / S4-02: 调度建议明细表 schedule_suggestion_items
-- 采购建议（purchase）和排产建议（production）共表存储，通过 item_type 区分
-- 计算步骤快照以 JSON 存储，支持四步采购算法和三维排产评分回溯
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `schedule_suggestion_items` (
  `id`                   INT             NOT NULL AUTO_INCREMENT,
  `tenant_id`            INT             NOT NULL COMMENT '租户ID',
  `suggestion_id`        INT             NOT NULL COMMENT '关联 schedule_suggestions.id',
  `item_type`            ENUM('purchase','production') NOT NULL
                           COMMENT '建议类型：purchase=采购建议 production=排产建议',

  -- ── 采购建议字段（item_type = 'purchase' 时有效）─────────────────────────
  `sku_id`               INT             DEFAULT NULL COMMENT '物料SKU ID',
  `suggested_qty`        DECIMAL(15,4)   DEFAULT NULL COMMENT '建议采购数量',
  `purchase_unit`        VARCHAR(20)     DEFAULT NULL COMMENT '采购单位',
  `suggested_supplier_id` INT            DEFAULT NULL COMMENT '建议供应商ID（综合评分最优）',
  `safety_stock_qty`     DECIMAL(15,4)   DEFAULT NULL COMMENT '安全库存数量（快照）',
  `current_stock_qty`    DECIMAL(15,4)   DEFAULT NULL COMMENT '当前库存数量（计算时快照）',
  `shortage_qty`         DECIMAL(15,4)   DEFAULT NULL COMMENT '缺口数量 = 需求量 - 当前库存',
  `capital_cost`         DECIMAL(15,2)   DEFAULT NULL COMMENT '本次采购预计资金占用（元）',

  -- ── 排产建议字段（item_type = 'production' 时有效）───────────────────────
  `production_order_id`  INT             DEFAULT NULL COMMENT '关联生产工单ID',
  `deadline_score`       DECIMAL(5,2)    DEFAULT NULL COMMENT '交期紧迫度得分（0-50分）',
  `priority_score`       DECIMAL(5,2)    DEFAULT NULL COMMENT '订单优先级得分（0-30分，含客户等级/紧急插单加权）',
  `material_score`       DECIMAL(5,2)    DEFAULT NULL COMMENT '物料就绪度得分（0-20分）',
  `total_score`          DECIMAL(5,2)    DEFAULT NULL COMMENT '三维综合总分（0-100分）',
  `suggested_rank`       INT             DEFAULT NULL COMMENT '建议排产顺序（1=最优先）',
  `suggested_workers`    JSON            DEFAULT NULL COMMENT '推荐工人列表，格式：[{worker_id, name, skill_level}]',

  -- ── 通用字段────────────────────────────────────────────────────────────────
  `calc_steps`           JSON            DEFAULT NULL
                           COMMENT '计算步骤详情快照，采购记录四步算法，排产记录三维评分分步数据',
  `status`               ENUM('pending','accepted','modified','rejected') NOT NULL DEFAULT 'pending'
                           COMMENT '建议状态：pending=待处理 accepted=已接受 modified=已修改 rejected=已拒绝',
  `created_at`           DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at`           DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

  PRIMARY KEY (`id`),
  INDEX `idx_tenant_suggestion`    (`tenant_id`, `suggestion_id`),
  INDEX `idx_item_type`            (`item_type`),
  INDEX `idx_sku`                  (`sku_id`),
  INDEX `idx_production_order`     (`production_order_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='调度建议明细表，采购建议和排产建议共表，通过 item_type 区分字段集合';

-- ─────────────────────────────────────────────────────────────────────────────
-- BE-S4-07 / S4-03: 建议审计日志表 suggestion_audit_logs
-- 记录用户对每条调度建议的接受/修改/拒绝/应用全链路操作
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `suggestion_audit_logs` (
  `id`                   INT             NOT NULL AUTO_INCREMENT,
  `tenant_id`            INT             NOT NULL COMMENT '租户ID',
  `suggestion_item_id`   INT             NOT NULL COMMENT '关联 schedule_suggestion_items.id',
  `action`               ENUM('accept','modify','reject','apply') NOT NULL
                           COMMENT '操作类型：accept=接受 modify=修改 reject=拒绝 apply=应用到实际单据',
  `old_value`            JSON            DEFAULT NULL COMMENT '操作前字段快照（仅 modify/reject 时有值）',
  `new_value`            JSON            DEFAULT NULL COMMENT '操作后字段快照（accept/modify/apply 时有值）',
  `reason`               TEXT            DEFAULT NULL COMMENT '操作原因（reject/modify 时建议填写）',
  `operated_by`          INT             NOT NULL COMMENT '操作人用户ID',
  `operated_at`          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '操作时间',

  PRIMARY KEY (`id`),
  INDEX `idx_tenant_item`  (`tenant_id`, `suggestion_item_id`),
  INDEX `idx_operated_by`  (`operated_by`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='调度建议审计日志，记录用户对建议的接受/修改/拒绝/应用操作';

-- ═════════════════════════════════════════════════════════════════════════════
-- BE-S4-08: 扩展 purchase_suggestions 表
--
-- 背景：
--   Sprint 3 (V2_sprint3_schema.sql S3-A6) 已添加：
--     source            ENUM('ai_schedule','production_shortage','manual')
--     production_order_id BIGINT UNSIGNED
--   以上两字段本脚本不重复添加。
--
-- 幂等策略：
--   MySQL 8.0 不支持 ALTER TABLE ... ADD COLUMN IF NOT EXISTS。
--   通过临时存储过程封装 INFORMATION_SCHEMA 检测，字段存在时跳过，不存在时添加。
--   存储过程在执行完毕后立即 DROP，不污染数据库对象。
-- ═════════════════════════════════════════════════════════════════════════════

DROP PROCEDURE IF EXISTS `sp_s4_add_purchase_suggestion_columns`;

DELIMITER $$

CREATE PROCEDURE `sp_s4_add_purchase_suggestion_columns`()
BEGIN
  DECLARE v_db VARCHAR(255) DEFAULT DATABASE();

  -- ── approved_by INT DEFAULT NULL ───────────────────────────────────────────
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = v_db
      AND TABLE_NAME   = 'purchase_suggestions'
      AND COLUMN_NAME  = 'approved_by'
  ) THEN
    ALTER TABLE `purchase_suggestions`
      ADD COLUMN `approved_by` INT DEFAULT NULL
        COMMENT '审批人用户ID（AI调度建议确认时记录）'
        AFTER `status`;
  END IF;

  -- ── approved_at DATETIME DEFAULT NULL ──────────────────────────────────────
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = v_db
      AND TABLE_NAME   = 'purchase_suggestions'
      AND COLUMN_NAME  = 'approved_at'
  ) THEN
    ALTER TABLE `purchase_suggestions`
      ADD COLUMN `approved_at` DATETIME DEFAULT NULL
        COMMENT '审批时间'
        AFTER `approved_by`;
  END IF;

  -- ── capital_cost DECIMAL(15,2) DEFAULT NULL ────────────────────────────────
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = v_db
      AND TABLE_NAME   = 'purchase_suggestions'
      AND COLUMN_NAME  = 'capital_cost'
  ) THEN
    ALTER TABLE `purchase_suggestions`
      ADD COLUMN `capital_cost` DECIMAL(15,2) DEFAULT NULL
        COMMENT '本次采购预计资金占用（元），用于资金闭环管控'
        AFTER `approved_at`;
  END IF;

  -- ── safety_stock_qty DECIMAL(15,4) DEFAULT NULL ───────────────────────────
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = v_db
      AND TABLE_NAME   = 'purchase_suggestions'
      AND COLUMN_NAME  = 'safety_stock_qty'
  ) THEN
    ALTER TABLE `purchase_suggestions`
      ADD COLUMN `safety_stock_qty` DECIMAL(15,4) DEFAULT NULL
        COMMENT '计算时的安全库存数量快照'
        AFTER `capital_cost`;
  END IF;

  -- ── current_stock_qty DECIMAL(15,4) DEFAULT NULL ──────────────────────────
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = v_db
      AND TABLE_NAME   = 'purchase_suggestions'
      AND COLUMN_NAME  = 'current_stock_qty'
  ) THEN
    ALTER TABLE `purchase_suggestions`
      ADD COLUMN `current_stock_qty` DECIMAL(15,4) DEFAULT NULL
        COMMENT '计算时的当前库存数量快照'
        AFTER `safety_stock_qty`;
  END IF;

  -- ── calc_batch_id INT DEFAULT NULL ────────────────────────────────────────
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = v_db
      AND TABLE_NAME   = 'purchase_suggestions'
      AND COLUMN_NAME  = 'calc_batch_id'
  ) THEN
    ALTER TABLE `purchase_suggestions`
      ADD COLUMN `calc_batch_id` INT DEFAULT NULL
        COMMENT '关联调度批次ID（schedule_suggestions.id），AI调度触发时记录'
        AFTER `current_stock_qty`;
  END IF;

  -- ── supplier_score DECIMAL(5,2) DEFAULT NULL ──────────────────────────────
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = v_db
      AND TABLE_NAME   = 'purchase_suggestions'
      AND COLUMN_NAME  = 'supplier_score'
  ) THEN
    ALTER TABLE `purchase_suggestions`
      ADD COLUMN `supplier_score` DECIMAL(5,2) DEFAULT NULL
        COMMENT '供应商综合评分（价格/交期/质量加权，0-100）'
        AFTER `calc_batch_id`;
  END IF;

  -- ── lead_time_days INT DEFAULT NULL ───────────────────────────────────────
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = v_db
      AND TABLE_NAME   = 'purchase_suggestions'
      AND COLUMN_NAME  = 'lead_time_days'
  ) THEN
    ALTER TABLE `purchase_suggestions`
      ADD COLUMN `lead_time_days` INT DEFAULT NULL
        COMMENT '供应商预计交期天数（建议生成时快照）'
        AFTER `supplier_score`;
  END IF;

  -- ── last_purchase_price DECIMAL(15,4) DEFAULT NULL ────────────────────────
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = v_db
      AND TABLE_NAME   = 'purchase_suggestions'
      AND COLUMN_NAME  = 'last_purchase_price'
  ) THEN
    ALTER TABLE `purchase_suggestions`
      ADD COLUMN `last_purchase_price` DECIMAL(15,4) DEFAULT NULL
        COMMENT '最近一次成交价（元），用于价格波动对比'
        AFTER `lead_time_days`;
  END IF;

END$$

DELIMITER ;

-- 执行存储过程
CALL `sp_s4_add_purchase_suggestion_columns`();

-- 清理存储过程，不污染数据库对象
DROP PROCEDURE IF EXISTS `sp_s4_add_purchase_suggestion_columns`;

-- ─────────────────────────────────────────────────────────────────────────────
-- 迁移完成验证
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  'Sprint 4 migration completed successfully' AS migration_status,
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'schedule_suggestions')         AS schedule_suggestions_exists,
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'schedule_suggestion_items')    AS schedule_suggestion_items_exists,
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'suggestion_audit_logs')        AS suggestion_audit_logs_exists,
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'purchase_suggestions'
     AND COLUMN_NAME IN (
       'approved_by','approved_at','capital_cost',
       'safety_stock_qty','current_stock_qty','calc_batch_id',
       'supplier_score','lead_time_days','last_purchase_price'
     ))                                                                             AS purchase_suggestions_new_cols;
