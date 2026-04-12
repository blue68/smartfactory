ALTER TABLE process_steps
  ADD COLUMN guide_text TEXT NULL COMMENT '工序操作说明文本' AFTER max_hours,
  ADD COLUMN guide_attachment_url VARCHAR(500) NULL COMMENT '工序操作说明附件地址' AFTER guide_text,
  ADD COLUMN guide_attachment_name VARCHAR(255) NULL COMMENT '工序操作说明附件名称' AFTER guide_attachment_url;
