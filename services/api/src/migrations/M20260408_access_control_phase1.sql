-- =============================================================================
-- M20260408_access_control_phase1.sql
-- 权限控制模块一期：权限域主数据表 + 角色扩展 + 预置菜单/功能点
-- =============================================================================

-- ---- helpers ----------------------------------------------------------------
DROP PROCEDURE IF EXISTS `safe_add_column_m20260408_ac`;
DELIMITER $$
CREATE PROCEDURE `safe_add_column_m20260408_ac`(
  IN p_table VARCHAR(64),
  IN p_column VARCHAR(64),
  IN p_definition TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = p_table
      AND column_name = p_column
  ) THEN
    SET @sql = CONCAT('ALTER TABLE `', p_table, '` ADD COLUMN `', p_column, '` ', p_definition);
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END$$
DELIMITER ;

DROP PROCEDURE IF EXISTS `safe_add_index_m20260408_ac`;
DELIMITER $$
CREATE PROCEDURE `safe_add_index_m20260408_ac`(
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
    SET @sql = CONCAT('ALTER TABLE `', p_table, '` ADD INDEX `', p_index, '` ', p_definition);
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END$$
DELIMITER ;

-- ---- roles table extension ---------------------------------------------------
CALL safe_add_column_m20260408_ac(
  'roles',
  'role_type',
  'ENUM(''system'',''custom'') NOT NULL DEFAULT ''custom'' COMMENT ''角色类型：系统预置/租户自定义'' AFTER `description`'
);
CALL safe_add_column_m20260408_ac(
  'roles',
  'status',
  'ENUM(''active'',''inactive'') NOT NULL DEFAULT ''active'' COMMENT ''角色状态'' AFTER `role_type`'
);
CALL safe_add_column_m20260408_ac(
  'roles',
  'role_scope',
  'ENUM(''platform'',''tenant'') NOT NULL DEFAULT ''tenant'' COMMENT ''角色作用域'' AFTER `status`'
);
CALL safe_add_column_m20260408_ac(
  'roles',
  'priority',
  'INT NOT NULL DEFAULT 0 COMMENT ''角色优先级，值越大越靠前'' AFTER `status`'
);
CALL safe_add_column_m20260408_ac(
  'roles',
  'data_scope_template',
  'VARCHAR(50) NOT NULL DEFAULT ''all'' COMMENT ''默认数据范围模板'' AFTER `priority`'
);
CALL safe_add_column_m20260408_ac(
  'roles',
  'assignable',
  'TINYINT(1) NOT NULL DEFAULT 1 COMMENT ''是否允许分配给人员'' AFTER `data_scope_template`'
);
CALL safe_add_column_m20260408_ac(
  'roles',
  'permissions',
  'JSON NULL COMMENT ''兼容期角色权限快照'' AFTER `assignable`'
);
CALL safe_add_column_m20260408_ac(
  'roles',
  'created_by',
  'BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER `updated_at`'
);
CALL safe_add_column_m20260408_ac(
  'roles',
  'updated_by',
  'BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER `created_by`'
);

UPDATE roles
SET role_type = CASE WHEN tenant_id = 0 THEN 'system' ELSE 'custom' END
WHERE role_type IS NOT NULL;

UPDATE roles
SET role_scope = CASE WHEN code = 'platform_super_admin' THEN 'platform' ELSE 'tenant' END
WHERE role_scope IS NOT NULL;

CALL safe_add_index_m20260408_ac(
  'roles',
  'idx_tenant_status',
  '(`tenant_id`, `status`)'
);

-- ---- access control domain tables -------------------------------------------
CREATE TABLE IF NOT EXISTS `permission_menus` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`       BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '0=系统模板，>0=租户实例',
  `parent_id`       BIGINT UNSIGNED DEFAULT NULL COMMENT '父菜单ID',
  `menu_type`       ENUM('group','module','page') NOT NULL DEFAULT 'page',
  `code`            VARCHAR(100) NOT NULL COMMENT '菜单唯一编码',
  `name`            VARCHAR(100) NOT NULL COMMENT '菜单名称',
  `route_path`      VARCHAR(200) DEFAULT NULL COMMENT '前端路由',
  `icon`            VARCHAR(50) DEFAULT NULL COMMENT '图标标识',
  `group_name`      VARCHAR(50) DEFAULT NULL COMMENT '分组',
  `sort_order`      INT NOT NULL DEFAULT 0,
  `status`          ENUM('active','inactive') NOT NULL DEFAULT 'active',
  `is_system`       TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否系统预置',
  `default_visible` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by`      BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_by`      BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_code` (`tenant_id`, `code`),
  KEY `idx_tenant_parent_sort` (`tenant_id`, `parent_id`, `sort_order`),
  KEY `idx_tenant_route` (`tenant_id`, `route_path`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='权限菜单定义';

CREATE TABLE IF NOT EXISTS `permission_actions` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`       BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '0=系统模板，>0=租户实例',
  `menu_id`         BIGINT UNSIGNED NOT NULL COMMENT '所属菜单ID',
  `code`            VARCHAR(120) NOT NULL COMMENT '功能点编码',
  `name`            VARCHAR(100) NOT NULL COMMENT '功能点名称',
  `action_type`     ENUM('view','create','edit','delete','approve','export','print','convert','custom') NOT NULL DEFAULT 'custom',
  `status`          ENUM('active','inactive') NOT NULL DEFAULT 'active',
  `default_enabled` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by`      BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_by`      BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_code` (`tenant_id`, `code`),
  KEY `idx_tenant_menu` (`tenant_id`, `menu_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='权限功能点定义';

CREATE TABLE IF NOT EXISTS `tenant_feature_flags` (
  `id`           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`    BIGINT UNSIGNED NOT NULL,
  `feature_code` VARCHAR(100) NOT NULL,
  `feature_name` VARCHAR(100) DEFAULT NULL,
  `is_enabled`   TINYINT(1) NOT NULL DEFAULT 1,
  `source_type`  ENUM('package','manual') NOT NULL DEFAULT 'manual',
  `expires_at`   DATETIME(3) DEFAULT NULL,
  `remark`       VARCHAR(500) DEFAULT NULL,
  `created_at`   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by`   BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_by`   BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_feature` (`tenant_id`, `feature_code`),
  KEY `idx_tenant_enabled` (`tenant_id`, `is_enabled`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='租户功能开关';

CREATE TABLE IF NOT EXISTS `tenant_menu_overrides` (
  `id`                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`          BIGINT UNSIGNED NOT NULL,
  `menu_id`            BIGINT UNSIGNED NOT NULL,
  `is_visible`         TINYINT(1) NOT NULL DEFAULT 1,
  `is_enabled`         TINYINT(1) NOT NULL DEFAULT 1,
  `sort_order_override` INT DEFAULT NULL,
  `route_override`     VARCHAR(200) DEFAULT NULL,
  `created_at`         DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`         DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by`         BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_by`         BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_menu` (`tenant_id`, `menu_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='租户菜单覆盖配置';

CREATE TABLE IF NOT EXISTS `role_permissions` (
  `id`                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`         BIGINT UNSIGNED NOT NULL,
  `role_id`           BIGINT UNSIGNED NOT NULL,
  `permission_type`   ENUM('menu','action','data_scope') NOT NULL,
  `permission_key`    VARCHAR(120) NOT NULL COMMENT '编码键，例如 system.menu.manage',
  `permission_ref_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '关联菜单/动作ID',
  `scope_type`        VARCHAR(50) DEFAULT NULL COMMENT '数据范围类型',
  `scope_value_json`  JSON DEFAULT NULL COMMENT '数据范围附加值',
  `created_at`        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_by`        BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_role_perm` (`tenant_id`, `role_id`, `permission_type`, `permission_key`),
  KEY `idx_tenant_role_type` (`tenant_id`, `role_id`, `permission_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='角色权限关联';

CREATE TABLE IF NOT EXISTS `user_role_assignments` (
  `id`                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`         BIGINT UNSIGNED NOT NULL,
  `user_id`           BIGINT UNSIGNED NOT NULL,
  `role_id`           BIGINT UNSIGNED NOT NULL,
  `role_scope`        ENUM('platform','tenant') NOT NULL DEFAULT 'tenant',
  `is_primary`        TINYINT(1) NOT NULL DEFAULT 0,
  `effective_from`    DATETIME(3) DEFAULT NULL,
  `effective_to`      DATETIME(3) DEFAULT NULL,
  `assignment_status` ENUM('active','inactive','expired') NOT NULL DEFAULT 'active',
  `source_type`       ENUM('manual','batch','template','migration') NOT NULL DEFAULT 'manual',
  `remark`            VARCHAR(500) DEFAULT NULL,
  `created_at`        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_by`        BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_by`        BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_user_role` (`tenant_id`, `user_id`, `role_id`),
  KEY `idx_tenant_user_active` (`tenant_id`, `user_id`, `assignment_status`),
  KEY `idx_tenant_role_active` (`tenant_id`, `role_id`, `assignment_status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='人员角色分配（含时效）';

CREATE TABLE IF NOT EXISTS `access_audit_logs` (
  `id`           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`    BIGINT UNSIGNED NOT NULL,
  `module`       VARCHAR(50) NOT NULL,
  `action`       VARCHAR(50) NOT NULL,
  `target_type`  VARCHAR(50) NOT NULL,
  `target_id`    BIGINT UNSIGNED DEFAULT NULL,
  `target_code`  VARCHAR(100) DEFAULT NULL,
  `before_json`  JSON DEFAULT NULL,
  `after_json`   JSON DEFAULT NULL,
  `diff_json`    JSON DEFAULT NULL,
  `operator_id`  BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `operator_name` VARCHAR(100) DEFAULT NULL,
  `trace_id`     VARCHAR(100) DEFAULT NULL,
  `created_at`   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_tenant_module_action` (`tenant_id`, `module`, `action`),
  KEY `idx_tenant_target` (`tenant_id`, `target_type`, `target_id`),
  KEY `idx_tenant_created_at` (`tenant_id`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='权限变更审计日志';

-- ---- seed menus --------------------------------------------------------------
INSERT INTO `permission_menus`
(`id`, `tenant_id`, `parent_id`, `menu_type`, `code`, `name`, `route_path`, `icon`, `group_name`, `sort_order`, `status`, `is_system`, `default_visible`, `created_by`, `updated_by`)
VALUES
  (9001001, 0, NULL, 'group',  'system.management',                 '系统管理',          NULL,                                      'setting',      '系统',      900, 'active', 1, 1, 0, 0),
  (9001101, 0, 9001001, 'page', 'system.tenant.config',             '租户配置',          '/system/tenants',                         'apartment',    '平台治理',  10,  'active', 1, 1, 0, 0),
  (9001102, 0, 9001001, 'page', 'system.menu.config',               '菜单与功能',        '/system/menus',                           'menu',         '平台治理',  20,  'active', 1, 1, 0, 0),
  (9001103, 0, 9001001, 'page', 'system.role.config',               '角色配置',          '/system/roles',                           'team',         '组织权限',  30,  'active', 1, 1, 0, 0),
  (9001104, 0, 9001001, 'page', 'system.user.config',               '人员配置',          '/system/users',                           'user',         '人员管理',  40,  'active', 1, 1, 0, 0),
  (9001105, 0, 9001001, 'page', 'system.role.permission.config',    '角色授权',          '/system/role-permissions',                'safety',       '授权中心',  50,  'active', 1, 1, 0, 0),
  (9001106, 0, 9001001, 'page', 'system.user.role.assignment',      '人员角色分配',      '/system/user-role-assignments',           'idcard',       '授权中心',  60,  'active', 1, 1, 0, 0)
ON DUPLICATE KEY UPDATE
  `name` = VALUES(`name`),
  `route_path` = VALUES(`route_path`),
  `group_name` = VALUES(`group_name`),
  `status` = VALUES(`status`),
  `updated_by` = VALUES(`updated_by`);

-- ---- seed actions ------------------------------------------------------------
INSERT INTO `permission_actions`
(`id`, `tenant_id`, `menu_id`, `code`, `name`, `action_type`, `status`, `default_enabled`, `created_by`, `updated_by`)
VALUES
  (9011001, 0, 9001101, 'system.tenant.manage',   '租户管理',   'custom', 'active', 1, 0, 0),
  (9011002, 0, 9001102, 'system.menu.manage',     '菜单管理',   'custom', 'active', 1, 0, 0),
  (9011003, 0, 9001103, 'system.role.manage',     '角色管理',   'custom', 'active', 1, 0, 0),
  (9011004, 0, 9001104, 'system.user.manage',     '人员管理',   'custom', 'active', 1, 0, 0),
  (9011005, 0, 9001105, 'system.role.grant',      '角色授权',   'custom', 'active', 1, 0, 0),
  (9011006, 0, 9001106, 'system.user.assign',     '人员分配',   'custom', 'active', 1, 0, 0),
  (9011007, 0, 9001001, 'system.audit.view',      '审计查看',   'custom', 'active', 1, 0, 0),
  (9011008, 0, 9001101, 'platform.tenant.switch', '切换租户',   'custom', 'active', 1, 0, 0)
ON DUPLICATE KEY UPDATE
  `name` = VALUES(`name`),
  `status` = VALUES(`status`),
  `updated_by` = VALUES(`updated_by`);

-- ---- seed platform super admin role -----------------------------------------
INSERT INTO `roles`
(`tenant_id`, `code`, `name`, `description`, `permissions`, `role_type`, `status`, `role_scope`, `priority`, `data_scope_template`, `assignable`, `created_at`, `updated_at`, `created_by`, `updated_by`)
SELECT
  0,
  'platform_super_admin',
  '平台超级管理员',
  '平台态登录与显式租户代管专用角色',
  JSON_ARRAY(),
  'system',
  'active',
  'platform',
  999,
  'all',
  1,
  NOW(3),
  NOW(3),
  0,
  0
WHERE NOT EXISTS (
  SELECT 1 FROM `roles` WHERE `tenant_id` = 0 AND `code` = 'platform_super_admin'
);

-- ---- seed tenant feature flag ------------------------------------------------
INSERT INTO `tenant_feature_flags`
(`tenant_id`, `feature_code`, `feature_name`, `is_enabled`, `source_type`, `created_by`, `updated_by`)
SELECT t.id, 'rbac_center', '权限中心', 1, 'manual', 0, 0
FROM tenants t
WHERE t.status = 'active'
ON DUPLICATE KEY UPDATE
  `feature_name` = VALUES(`feature_name`),
  `is_enabled` = VALUES(`is_enabled`),
  `updated_by` = VALUES(`updated_by`);

-- ---- seed role permissions for boss/admin -----------------------------------
INSERT INTO `role_permissions`
(`tenant_id`, `role_id`, `permission_type`, `permission_key`, `permission_ref_id`, `created_by`)
SELECT
  r.tenant_id,
  r.id,
  'action',
  pa.code,
  pa.id,
  0
FROM roles r
INNER JOIN permission_actions pa
  ON pa.tenant_id = 0
WHERE r.code IN ('boss', 'admin')
  AND r.tenant_id = 0
ON DUPLICATE KEY UPDATE
  `permission_ref_id` = VALUES(`permission_ref_id`);

-- ---- seed role permissions for platform_super_admin --------------------------
INSERT INTO `role_permissions`
(`tenant_id`, `role_id`, `permission_type`, `permission_key`, `permission_ref_id`, `created_by`)
SELECT
  r.tenant_id,
  r.id,
  'menu',
  pm.code,
  pm.id,
  0
FROM roles r
INNER JOIN permission_menus pm
  ON pm.tenant_id = 0
WHERE r.code = 'platform_super_admin'
  AND r.tenant_id = 0
  AND pm.code IN ('system.management', 'system.tenant.config')
ON DUPLICATE KEY UPDATE
  `permission_ref_id` = VALUES(`permission_ref_id`);

INSERT INTO `role_permissions`
(`tenant_id`, `role_id`, `permission_type`, `permission_key`, `permission_ref_id`, `created_by`)
SELECT
  r.tenant_id,
  r.id,
  'action',
  pa.code,
  pa.id,
  0
FROM roles r
INNER JOIN permission_actions pa
  ON pa.tenant_id = 0
WHERE r.code = 'platform_super_admin'
  AND r.tenant_id = 0
  AND pa.code IN ('system.tenant.manage', 'platform.tenant.switch', 'system.audit.view')
ON DUPLICATE KEY UPDATE
  `permission_ref_id` = VALUES(`permission_ref_id`);

INSERT INTO `role_permissions`
(`tenant_id`, `role_id`, `permission_type`, `permission_key`, `permission_ref_id`, `created_by`)
SELECT
  r.tenant_id,
  r.id,
  'menu',
  pm.code,
  pm.id,
  0
FROM roles r
INNER JOIN permission_menus pm
  ON pm.tenant_id = 0
WHERE r.code IN ('boss', 'admin')
  AND r.tenant_id = 0
ON DUPLICATE KEY UPDATE
  `permission_ref_id` = VALUES(`permission_ref_id`);

-- ---- cleanup -----------------------------------------------------------------
DROP PROCEDURE IF EXISTS `safe_add_column_m20260408_ac`;
DROP PROCEDURE IF EXISTS `safe_add_index_m20260408_ac`;
