-- ============================================================
-- RISK-005 跨色号出库授权表迁移
-- 决策文档：docs/risk-005-decision.md
-- 迁移日期：2026-03-11
-- ============================================================

-- 1. 新增授权申请表
--    管理每一条跨色号出库的申请和审批记录
--    status 生命周期：pending → approved / rejected / expired
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cross_dye_lot_authorize_requests (
  id                INT          AUTO_INCREMENT PRIMARY KEY,
  tenant_id         INT          NOT NULL                    COMMENT '租户ID',
  request_user_id   INT          NOT NULL                    COMMENT '申请人（仓管）用户ID',
  authorize_user_id INT          DEFAULT NULL                COMMENT '审批人（主管）用户ID',
  outbound_order_id INT          NOT NULL                    COMMENT '关联出库单ID（业务追溯用）',
  sku_id            INT          NOT NULL                    COMMENT '物料SKU ID',
  mixed_dye_lots    JSON         NOT NULL                    COMMENT '涉及的色号列表，格式：{"bound":"A-001","requested":"A-002"}',
  reason            VARCHAR(500) DEFAULT NULL                COMMENT '申请理由或放行原因编码（CUSTOMER_APPROVED / STOCK_SHORTAGE / QUALITY_VERIFIED / SAMPLE_ORDER / OTHER）',
  reject_reason     VARCHAR(500) DEFAULT NULL                COMMENT '拒绝说明（reject 时填写）',
  status            ENUM('pending','approved','rejected','expired')
                               DEFAULT 'pending'            COMMENT '审批状态',
  decided_at        DATETIME     DEFAULT NULL                COMMENT '审批操作时间',
  expires_at        DATETIME     NOT NULL                    COMMENT '申请过期时间（默认创建后2小时）',
  created_at        DATETIME     DEFAULT CURRENT_TIMESTAMP  COMMENT '创建时间',

  INDEX idx_tenant_status   (tenant_id, status),
  INDEX idx_outbound        (outbound_order_id),
  INDEX idx_tenant_sku      (tenant_id, sku_id),
  INDEX idx_expires_status  (expires_at, status)            COMMENT '用于惰性过期扫描'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='跨色号出库授权申请表（RISK-005）';


-- 2. inventory_transactions 补充追溯字段
--    cross_dye_lot_authorized_by : 授权主管用户ID
--    cross_dye_lot_reason        : 放行原因编码（对应 cross_dye_lot_authorize_requests.reason）
--    cross_dye_lot_authorized_at : 授权完成时间
--    authorize_id                : 关联 cross_dye_lot_authorize_requests.id（完整追溯链）
-- ------------------------------------------------------------
ALTER TABLE inventory_transactions
  ADD COLUMN IF NOT EXISTS cross_dye_lot_authorized_by  INT          NULL COMMENT '跨色号授权主管ID'        AFTER is_cross_dye_lot,
  ADD COLUMN IF NOT EXISTS cross_dye_lot_reason         VARCHAR(50)  NULL COMMENT '跨色号放行原因编码'      AFTER cross_dye_lot_authorized_by,
  ADD COLUMN IF NOT EXISTS cross_dye_lot_authorized_at  DATETIME     NULL COMMENT '授权时间'                AFTER cross_dye_lot_reason,
  ADD COLUMN IF NOT EXISTS authorize_id                 INT          NULL COMMENT '关联授权申请ID（RISK-005）' AFTER cross_dye_lot_authorized_at;
