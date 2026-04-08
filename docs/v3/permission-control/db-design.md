[artifact:DBDesign]
status: READY
owner: tech-lead-architect
scope:
- 为权限控制模块设计数据库对象、关系、索引与迁移策略
- 覆盖租户、菜单、功能点、角色、权限、人员角色分配、功能开关、审计
inputs:
- [artifact:SystemArch] `docs/v3/permission-control/system-arch.md`
- [artifact:PRD] `docs/v3/permission-control/prd.md`
- 现有库表基线：`docs/database-design.md`
deliverables:
- 权限域 ER 设计
- 新增/调整表结构建议
- 兼容旧 `roles.permissions`、`user_roles` 的迁移策略
risks:
- 若旧角色与新角色双写不一致，会导致登录返回权限漂移
- 数据范围若全部用 JSON，会削弱后续按对象查询能力
handoff_to:
- engineering-manager
- senior-backend-engineer
exit_criteria:
- 后端可据此编写 migration、seed 与 repository

# 权限控制模块 DB Design

## 1. 设计原则

1. 所有业务对象保留 `tenant_id` 行级隔离。
2. 系统预置模板使用 `tenant_id = 0`。
3. 平台级账号与平台级角色同样使用 `tenant_id = 0` 存储。
4. 权限主数据与授权关系分表存储，避免把所有权限压进一个 JSON。
5. 兼容期允许保留旧字段或旧表，但必须定义清晰的双写与退役路径。

## 2. ER 关系概览

```text
tenants
  ├─ users
  │   ├─ user_roles (兼容表)
  │   └─ user_role_assignments
  ├─ roles
  │   └─ role_permissions
  ├─ tenant_feature_flags
  ├─ tenant_menu_overrides
  └─ access_audit_logs

permission_menus
  └─ permission_actions

roles
  └─ role_permissions -> (menu / action / data_scope)

users(tenant_id=0)
  └─ user_role_assignments(tenant_id=0, role_scope=platform)
```

## 3. 表设计

### 3.1 `permission_menus`

用途：

- 系统菜单树与页面节点主表

关键字段：

- `id`
- `tenant_id`
- `parent_id`
- `menu_type`：`group/module/page`
- `code`
- `name`
- `route_path`
- `icon`
- `group_name`
- `sort_order`
- `status`
- `is_system`
- `default_visible`
- `created_at/updated_at`
- `created_by/updated_by`

索引：

- `uk_tenant_code (tenant_id, code)`
- `idx_tenant_parent_sort (tenant_id, parent_id, sort_order)`
- `idx_tenant_route (tenant_id, route_path)`

说明：

- 系统模板使用 `tenant_id=0`
- 租户若未覆盖，则直接继承系统模板

### 3.2 `permission_actions`

用途：

- 页面级功能点定义

关键字段：

- `id`
- `tenant_id`
- `menu_id`
- `code`
- `name`
- `action_type`：`view/create/edit/delete/approve/export/print/convert/custom`
- `status`
- `default_enabled`
- `created_at/updated_at`
- `created_by/updated_by`

索引：

- `uk_tenant_code (tenant_id, code)`
- `idx_tenant_menu (tenant_id, menu_id)`

### 3.3 `tenant_feature_flags`

用途：

- 租户功能包与模块开关

关键字段：

- `id`
- `tenant_id`
- `feature_code`
- `feature_name`
- `is_enabled`
- `source_type`：`package/manual`
- `expires_at`
- `remark`
- `created_at/updated_at`
- `created_by/updated_by`

索引：

- `uk_tenant_feature (tenant_id, feature_code)`

### 3.4 `tenant_menu_overrides`

用途：

- 租户对系统菜单模板的覆盖

关键字段：

- `id`
- `tenant_id`
- `menu_id`
- `is_visible`
- `is_enabled`
- `sort_order_override`
- `route_override`
- `created_at/updated_at`
- `created_by/updated_by`

索引：

- `uk_tenant_menu (tenant_id, menu_id)`

说明：

- 不复制整棵系统菜单到每个租户，优先采用“模板 + 覆盖”策略

### 3.5 `roles` 调整

现状：

- 已存在 `roles.permissions JSON`

建议调整：

新增字段：

- `role_type`：`system/custom`
- `role_scope`：`platform/tenant`
- `status`
- `priority`
- `data_scope_template`
- `assignable`

保留字段：

- `permissions JSON`

兼容策略：

1. `permissions JSON` 仅保留为权限快照或回滚兼容字段
2. 新授权关系以 `role_permissions` 为准
3. `platform_super_admin` 作为系统预置角色，建议 `tenant_id = 0`、`role_scope = platform`

### 3.6 `role_permissions`

用途：

- 角色授权统一关系表

关键字段：

- `id`
- `tenant_id`
- `role_id`
- `permission_type`：`menu/action/data_scope`
- `permission_key`
- `permission_ref_id`
- `scope_type`
- `scope_value_json`
- `created_at`
- `created_by`

索引：

- `uk_role_perm (tenant_id, role_id, permission_type, permission_key)`
- `idx_tenant_role_type (tenant_id, role_id, permission_type)`

说明：

- `menu/action` 通过 `permission_key` 和 `permission_ref_id` 双存，兼顾展示和引用
- `data_scope` 记录范围类型和附加对象

### 3.7 `user_role_assignments`

用途：

- 替代当前无时效的 `user_roles`

关键字段：

- `id`
- `tenant_id`
- `user_id`
- `role_id`
- `role_scope`：`platform/tenant`
- `is_primary`
- `effective_from`
- `effective_to`
- `assignment_status`：`active/inactive/expired`
- `source_type`：`manual/batch/template/migration`
- `remark`
- `created_at/updated_at`
- `created_by/updated_by`

索引：

- `idx_tenant_user_active (tenant_id, user_id, assignment_status, effective_from, effective_to)`
- `idx_tenant_role_active (tenant_id, role_id, assignment_status)`

### 3.8 `user_roles` 兼容策略

现状：

- 登录链依赖 `user_roles`

建议：

1. 第一阶段保留 `user_roles`
2. 对 `user_role_assignments` 的生效记录做双写同步
3. 登录查询可先读取 `user_role_assignments`，若无数据则回退 `user_roles`
4. 全模块迁移稳定后再评估下线 `user_roles`
5. 平台级账号不写入租户级 `user_roles`，只在 `user_role_assignments(tenant_id=0)` 中维护

### 3.9 `access_audit_logs`

用途：

- 记录权限、角色、人员、租户的关键变更

建议补充字段：

- `operator_scope_level`：`platform/tenant`
- `origin_tenant_id`
- `context_tenant_id`
- `target_tenant_id`
- `event_code`：如 `switch_tenant / exit_tenant_context / grant_role / update_feature_flag`

说明：

- `platform_super_admin` 切换租户上下文时必须写入独立审计事件
- 后续可据此追踪“是谁以平台代管身份进入了哪个租户”

关键字段：

- `id`
- `tenant_id`
- `module`
- `action`
- `target_type`
- `target_id`
- `target_code`
- `before_json`
- `after_json`
- `diff_json`
- `operator_id`
- `operator_name`
- `trace_id`
- `created_at`

索引：

- `idx_tenant_target (tenant_id, target_type, target_id)`
- `idx_tenant_created (tenant_id, created_at)`
- `idx_operator (tenant_id, operator_id, created_at)`

## 4. 建议 SQL 草案

### 4.1 `permission_menus`

```sql
CREATE TABLE permission_menus (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
  parent_id BIGINT UNSIGNED DEFAULT NULL,
  menu_type ENUM('group','module','page') NOT NULL DEFAULT 'page',
  code VARCHAR(80) NOT NULL,
  name VARCHAR(80) NOT NULL,
  route_path VARCHAR(160) DEFAULT NULL,
  icon VARCHAR(40) DEFAULT NULL,
  group_name VARCHAR(40) DEFAULT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  status ENUM('active','inactive') NOT NULL DEFAULT 'active',
  is_system TINYINT(1) NOT NULL DEFAULT 0,
  default_visible TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  created_by BIGINT UNSIGNED NOT NULL DEFAULT 0,
  updated_by BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uk_tenant_code (tenant_id, code),
  KEY idx_tenant_parent_sort (tenant_id, parent_id, sort_order)
);
```

### 4.2 `permission_actions`

```sql
CREATE TABLE permission_actions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
  menu_id BIGINT UNSIGNED NOT NULL,
  code VARCHAR(120) NOT NULL,
  name VARCHAR(80) NOT NULL,
  action_type ENUM('view','create','edit','delete','approve','export','print','convert','custom') NOT NULL DEFAULT 'custom',
  status ENUM('active','inactive') NOT NULL DEFAULT 'active',
  default_enabled TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  created_by BIGINT UNSIGNED NOT NULL DEFAULT 0,
  updated_by BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uk_tenant_code (tenant_id, code),
  KEY idx_tenant_menu (tenant_id, menu_id)
);
```

### 4.3 `role_permissions`

```sql
CREATE TABLE role_permissions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id BIGINT UNSIGNED NOT NULL,
  role_id BIGINT UNSIGNED NOT NULL,
  permission_type ENUM('menu','action','data_scope') NOT NULL,
  permission_key VARCHAR(120) NOT NULL,
  permission_ref_id BIGINT UNSIGNED DEFAULT NULL,
  scope_type VARCHAR(40) DEFAULT NULL,
  scope_value_json JSON DEFAULT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  created_by BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uk_role_perm (tenant_id, role_id, permission_type, permission_key),
  KEY idx_tenant_role_type (tenant_id, role_id, permission_type)
);
```

### 4.4 `user_role_assignments`

```sql
CREATE TABLE user_role_assignments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  role_id BIGINT UNSIGNED NOT NULL,
  is_primary TINYINT(1) NOT NULL DEFAULT 0,
  effective_from DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  effective_to DATETIME(3) DEFAULT NULL,
  assignment_status ENUM('active','inactive','expired') NOT NULL DEFAULT 'active',
  source_type ENUM('manual','batch','template','migration') NOT NULL DEFAULT 'manual',
  remark VARCHAR(255) DEFAULT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  created_by BIGINT UNSIGNED NOT NULL DEFAULT 0,
  updated_by BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_tenant_user_active (tenant_id, user_id, assignment_status, effective_from, effective_to),
  KEY idx_tenant_role_active (tenant_id, role_id, assignment_status)
);
```

## 5. 预置数据策略

需要预置：

1. 系统菜单树
2. 页面功能点
3. 系统角色
4. 系统角色默认授权
5. 标准功能包

预置角色至少包含：

- `admin`
- `boss`
- `purchaser`
- `warehouse`
- `supervisor`
- `worker`
- `qc`
- `sales`
- `tenant_admin`

## 6. 迁移步骤

1. 新建权限域表
2. 从 `Sidebar` 与业务接口清单生成菜单/功能点种子
3. 从现有 `UserRole` 生成系统角色种子
4. 将现有 `user_roles` 同步写入 `user_role_assignments`
5. 为系统角色写入 `role_permissions`
6. 登录聚合器切换到新关系表

## 7. 回滚策略

1. 保留 `roles.permissions JSON`
2. 保留 `user_roles`
3. 登录聚合器支持回退旧查询链
4. 新增表仅作为增量数据，不覆盖现有核心业务表
