CREATE TABLE IF NOT EXISTS `uploaded_files` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id` BIGINT UNSIGNED NOT NULL,
  `original_name` VARCHAR(255) NOT NULL COMMENT '原始文件名',
  `stored_name` VARCHAR(255) NOT NULL COMMENT '存储文件名',
  `storage_driver` ENUM('local', 'oss') NOT NULL DEFAULT 'local' COMMENT '存储驱动',
  `storage_path` VARCHAR(500) NOT NULL COMMENT '逻辑存储路径/对象路径',
  `public_url` VARCHAR(500) DEFAULT NULL COMMENT '统一访问地址',
  `mime_type` VARCHAR(120) DEFAULT NULL COMMENT '文件 MIME 类型',
  `file_size` BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '文件大小字节数',
  `bucket_name` VARCHAR(100) DEFAULT NULL COMMENT 'OSS Bucket 名称',
  `object_key` VARCHAR(500) DEFAULT NULL COMMENT 'OSS/Object Key',
  `created_by` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_uploaded_files_tenant_created` (`tenant_id`, `created_at`),
  KEY `idx_uploaded_files_driver` (`tenant_id`, `storage_driver`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='统一上传文件元数据表';
