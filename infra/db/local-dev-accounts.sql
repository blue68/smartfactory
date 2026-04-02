-- 本地开发角色 / 账号同步脚本
-- 目标：
-- 1. 补齐代码实际使用但 init 历史未初始化的角色
-- 2. 为每个常用业务角色提供一套稳定可登录的本地开发账号
-- 3. 允许重复执行，不依赖清空数据库

INSERT INTO `roles` (`tenant_id`, `code`, `name`, `description`) VALUES
  (0, 'boss',        '老板', '最高权限，可查看所有报表及审批'),
  (0, 'supervisor',  '主管', '车间主管，可审批跨色号等操作'),
  (0, 'warehouse',   '仓管员', '负责库存入出库操作'),
  (0, 'worker',      '生产工人', '执行生产任务'),
  (0, 'sales',       '销售员', '录入销售订单'),
  (0, 'purchase',    '采购员', '处理采购订单'),
  (0, 'purchaser',   '采购员', '采购员角色别名，兼容前后端角色编码差异'),
  (0, 'qc',          'QC验货员', '负责来料质检与质量检验'),
  (0, 'manager',     '经理', '负责工艺配置与报表管理'),
  (0, 'admin',       '系统管理员', '租户内系统管理权限')
ON DUPLICATE KEY UPDATE
  `name` = VALUES(`name`),
  `description` = VALUES(`description`);

INSERT INTO `users` (`tenant_id`, `username`, `password_hash`, `real_name`, `status`, `created_by`) VALUES
  (1, 'boss_dev',       '$2b$10$MmgwQ9xr9HEolYqOUjcpUumg/M3wle7C3ySCi4ziZSCnJfAl1zacO', '本地开发-老板', 'active', 0),
  (1, 'admin_dev',      '$2b$10$MmgwQ9xr9HEolYqOUjcpUumg/M3wle7C3ySCi4ziZSCnJfAl1zacO', '本地开发-系统管理员', 'active', 0),
  (1, 'supervisor_dev', '$2b$10$MmgwQ9xr9HEolYqOUjcpUumg/M3wle7C3ySCi4ziZSCnJfAl1zacO', '本地开发-主管', 'active', 0),
  (1, 'warehouse_dev',  '$2b$10$MmgwQ9xr9HEolYqOUjcpUumg/M3wle7C3ySCi4ziZSCnJfAl1zacO', '本地开发-仓管员', 'active', 0),
  (1, 'worker_dev',     '$2b$10$MmgwQ9xr9HEolYqOUjcpUumg/M3wle7C3ySCi4ziZSCnJfAl1zacO', '本地开发-生产工人', 'active', 0),
  (1, 'sales_dev',      '$2b$10$MmgwQ9xr9HEolYqOUjcpUumg/M3wle7C3ySCi4ziZSCnJfAl1zacO', '本地开发-销售员', 'active', 0),
  (1, 'purchaser_dev',  '$2b$10$MmgwQ9xr9HEolYqOUjcpUumg/M3wle7C3ySCi4ziZSCnJfAl1zacO', '本地开发-采购员', 'active', 0),
  (1, 'qc_dev',         '$2b$10$MmgwQ9xr9HEolYqOUjcpUumg/M3wle7C3ySCi4ziZSCnJfAl1zacO', '本地开发-QC验货员', 'active', 0),
  (1, 'manager_dev',    '$2b$10$MmgwQ9xr9HEolYqOUjcpUumg/M3wle7C3ySCi4ziZSCnJfAl1zacO', '本地开发-经理', 'active', 0)
ON DUPLICATE KEY UPDATE
  `password_hash` = VALUES(`password_hash`),
  `real_name` = VALUES(`real_name`),
  `status` = VALUES(`status`),
  `updated_by` = 0;

INSERT IGNORE INTO `user_roles` (`tenant_id`, `user_id`, `role_id`)
SELECT 1, u.id, r.id FROM `users` u JOIN `roles` r ON r.code = 'boss'
WHERE u.tenant_id = 1 AND u.username = 'boss_dev';

INSERT IGNORE INTO `user_roles` (`tenant_id`, `user_id`, `role_id`)
SELECT 1, u.id, r.id FROM `users` u JOIN `roles` r ON r.code = 'admin'
WHERE u.tenant_id = 1 AND u.username = 'admin_dev';

INSERT IGNORE INTO `user_roles` (`tenant_id`, `user_id`, `role_id`)
SELECT 1, u.id, r.id FROM `users` u JOIN `roles` r ON r.code = 'supervisor'
WHERE u.tenant_id = 1 AND u.username = 'supervisor_dev';

INSERT IGNORE INTO `user_roles` (`tenant_id`, `user_id`, `role_id`)
SELECT 1, u.id, r.id FROM `users` u JOIN `roles` r ON r.code = 'warehouse'
WHERE u.tenant_id = 1 AND u.username = 'warehouse_dev';

INSERT IGNORE INTO `user_roles` (`tenant_id`, `user_id`, `role_id`)
SELECT 1, u.id, r.id FROM `users` u JOIN `roles` r ON r.code = 'worker'
WHERE u.tenant_id = 1 AND u.username = 'worker_dev';

INSERT IGNORE INTO `user_roles` (`tenant_id`, `user_id`, `role_id`)
SELECT 1, u.id, r.id FROM `users` u JOIN `roles` r ON r.code = 'sales'
WHERE u.tenant_id = 1 AND u.username = 'sales_dev';

INSERT IGNORE INTO `user_roles` (`tenant_id`, `user_id`, `role_id`)
SELECT 1, u.id, r.id FROM `users` u JOIN `roles` r ON r.code = 'purchase'
WHERE u.tenant_id = 1 AND u.username = 'purchaser_dev';

INSERT IGNORE INTO `user_roles` (`tenant_id`, `user_id`, `role_id`)
SELECT 1, u.id, r.id FROM `users` u JOIN `roles` r ON r.code = 'purchaser'
WHERE u.tenant_id = 1 AND u.username = 'purchaser_dev';

INSERT IGNORE INTO `user_roles` (`tenant_id`, `user_id`, `role_id`)
SELECT 1, u.id, r.id FROM `users` u JOIN `roles` r ON r.code = 'qc'
WHERE u.tenant_id = 1 AND u.username = 'qc_dev';

INSERT IGNORE INTO `user_roles` (`tenant_id`, `user_id`, `role_id`)
SELECT 1, u.id, r.id FROM `users` u JOIN `roles` r ON r.code = 'manager'
WHERE u.tenant_id = 1 AND u.username = 'manager_dev';
