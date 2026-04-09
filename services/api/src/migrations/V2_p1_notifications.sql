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

DROP PROCEDURE IF EXISTS safe_add_index_v2_p1_notifications;
DELIMITER $$
CREATE PROCEDURE safe_add_index_v2_p1_notifications(
  IN p_table VARCHAR(64),
  IN p_index VARCHAR(64),
  IN p_definition TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM information_schema.statistics
     WHERE table_schema = DATABASE()
       AND table_name = p_table
       AND index_name = p_index
  ) THEN
    SET @sql = CONCAT('CREATE INDEX `', p_index, '` ON `', p_table, '` ', p_definition);
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END$$
DELIMITER ;

-- 用户消息列表（主查询路径：按 tenant + user + 时间倒序）
CALL safe_add_index_v2_p1_notifications(
  'notifications',
  'idx_notif_tenant_user',
  '(`tenant_id`, `user_id`, `created_at` DESC)'
);

-- 未读数量快速统计（覆盖 is_read 过滤）
CALL safe_add_index_v2_p1_notifications(
  'notifications',
  'idx_notif_unread',
  '(`tenant_id`, `user_id`, `is_read`)'
);

DROP PROCEDURE IF EXISTS safe_add_index_v2_p1_notifications;
