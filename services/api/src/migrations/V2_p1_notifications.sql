-- P1 #18: 站内通知表
-- 创建时间: 2026-03-14

CREATE TABLE IF NOT EXISTS notifications (
  id           INT          NOT NULL AUTO_INCREMENT,
  tenant_id    INT          NOT NULL,
  user_id      INT          NOT NULL,
  type         ENUM('approval_request','approval_result','order_update','system')
               NOT NULL DEFAULT 'system',
  title        VARCHAR(200) NOT NULL,
  content      TEXT         NOT NULL,
  is_read      TINYINT(1)   NOT NULL DEFAULT 0,
  related_type VARCHAR(50)  NULL,
  related_id   INT          NULL,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='站内通知';

-- 用户消息列表（主查询路径：按 tenant + user + 时间倒序）
CREATE INDEX idx_notif_tenant_user
  ON notifications (tenant_id, user_id, created_at DESC);

-- 未读数量快速统计（覆盖 is_read 过滤）
CREATE INDEX idx_notif_unread
  ON notifications (tenant_id, user_id, is_read);
