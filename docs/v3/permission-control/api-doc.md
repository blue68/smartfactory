[artifact:APIDoc]
status: READY
owner: tech-lead-architect
scope:
- 定义权限控制模块后端接口契约、鉴权要求、返回结构与错误码
- 覆盖租户配置、菜单与功能、角色配置、人员配置、角色授权、人员角色分配
inputs:
- [artifact:SystemArch] `docs/v3/permission-control/system-arch.md`
- [artifact:DBDesign] `docs/v3/permission-control/db-design.md`
- [artifact:Prototype] `docs/v3/permission-control/prototype.md`
deliverables:
- REST 接口清单
- 关键请求/响应字段
- 鉴权模型与错误码约定
risks:
- 若接口粒度过粗，会放大前端一次保存的失败范围
- 授权接口若不做版本控制，可能产生并发覆盖
handoff_to:
- engineering-manager
- senior-backend-engineer
- senior-frontend-engineer
exit_criteria:
- 前后端可直接依据本文联调权限模块

# 权限控制模块 APIDoc

## 1. 通用约定

### 1.1 Base Path

建议新增统一前缀：

- `/api/access-control`

### 1.2 认证

全部接口要求：

- `Authorization: Bearer <token>`

### 1.3 鉴权

建议引入权限点：

- `system.tenant.manage`
- `system.menu.manage`
- `system.role.manage`
- `system.user.manage`
- `system.role.grant`
- `system.user.assign`
- `system.audit.view`
- `platform.tenant.switch`

迁移期高权限兼容接口可同时保留：

- `requireRoles('admin', 'boss')`

### 1.4 通用响应

```json
{
  "code": 0,
  "message": "success",
  "data": {}
}
```

### 1.5 通用错误码

- `1001` 未认证
- `1003` 权限不足
- `1401` 菜单编码重复
- `1402` 功能点编码重复
- `1403` 角色编码重复
- `1404` 用户账号重复
- `1405` 租户编码重复
- `1406` 角色仍被分配，禁止删除
- `1407` 数据范围配置非法
- `1408` 系统预置对象不允许删除
- `1409` 授权版本冲突，请刷新后重试

## 2. 登录返回扩展

### 2.1 `POST /api/auth/login`

请求建议改为：

```json
{
  "loginMode": "tenant",
  "tenantCode": "FACTORY001",
  "username": "admin_dev",
  "password": "Dev123!2026"
}
```

平台超级管理员登录：

```json
{
  "loginMode": "platform",
  "username": "platform_root",
  "password": "Dev123!2026"
}
```

约束：

- `loginMode=tenant` 时必须提供 `tenantCode`
- `loginMode=platform` 时不得要求 `tenantCode`
- 仅 `platform_super_admin` 可使用 `platform` 模式

新增返回字段：

```json
{
  "user": {
    "id": 1,
    "username": "boss001",
    "realName": "张总",
    "roles": ["platform_super_admin"],
    "tenantId": 0,
    "tenantName": "Platform",
    "scopeLevel": "platform",
    "contextTenantId": null
  },
  "permissionSnapshot": {
    "version": "20260408T030000Z",
    "scopeLevel": "platform",
    "menuCodes": ["system.permission.roles", "system.permission.users"],
    "actionCodes": ["system.role.create", "system.role.edit"],
    "dataScopes": [
      { "scopeType": "warehouse_assigned", "scopeValues": [1, 2] }
    ],
    "featureFlags": ["rbac_center", "tenant_admin"]
  }
}
```

### 2.2 `POST /api/auth/switch-tenant`

用途：

- `platform_super_admin` 从平台态切换进入目标租户上下文

Body：

- `targetTenantId`

鉴权：

- `platform.tenant.switch`
- 当前 `scopeLevel` 必须为 `platform` 或已有平台来源上下文

返回：

- 新的 `accessToken`
- 新的 `refreshToken`
- 新的 `user context`
- 新的 `permissionSnapshot`

### 2.3 `POST /api/auth/exit-tenant-context`

用途：

- 从租户态退出回平台态

返回：

- 平台态 `accessToken`
- 平台态 `refreshToken`
- 平台态 `permissionSnapshot`

## 3. 租户配置

### 3.1 `GET /api/access-control/tenants`

用途：

- 分页查询租户列表

Query：

- `page`
- `pageSize`
- `keyword`
- `status`
- `packageType`

说明：

- 平台态可查看所有租户
- 租户态默认只返回当前租户

鉴权：

- `system.tenant.manage`

### 3.2 `POST /api/access-control/tenants`

用途：

- 新建租户

Body：

- `name`
- `code`
- `contactName`
- `contactPhone`
- `status`
- `packageType`
- `expiresAt`
- `defaultTemplateCode`
- `defaultAdmin`
- `featureFlags[]`
- `remark`

### 3.3 `PUT /api/access-control/tenants/:id`

用途：

- 编辑租户

### 3.4 `POST /api/access-control/tenants/:id/status`

用途：

- 启用/停用租户

Body：

- `status`
- `reason`

### 3.5 `GET /api/access-control/tenants/:id/feature-flags`

### 3.6 `PUT /api/access-control/tenants/:id/feature-flags`

用途：

- 读取/更新租户功能开关

## 4. 菜单与功能

### 4.1 `GET /api/access-control/menus/tree`

用途：

- 获取菜单树

Query：

- `tenantId` 可选，`platform_super_admin` 可查看模板或租户实例
- `includeActions=true|false`
- `keyword`

### 4.2 `POST /api/access-control/menus`

用途：

- 新增菜单节点

Body：

- `tenantId`
- `parentId`
- `menuType`
- `code`
- `name`
- `routePath`
- `icon`
- `groupName`
- `sortOrder`
- `status`
- `defaultVisible`

### 4.3 `PUT /api/access-control/menus/:id`

### 4.4 `DELETE /api/access-control/menus/:id`

### 4.5 `POST /api/access-control/menus/reorder`

用途：

- 保存菜单排序

Body：

- `tenantId`
- `items: [{ id, parentId, sortOrder }]`

### 4.6 `GET /api/access-control/menus/:id/actions`

### 4.7 `POST /api/access-control/actions`

用途：

- 新增功能点

Body：

- `tenantId`
- `menuId`
- `code`
- `name`
- `actionType`
- `status`
- `defaultEnabled`

### 4.8 `PUT /api/access-control/actions/:id`

### 4.9 `DELETE /api/access-control/actions/:id`

## 5. 角色配置

### 5.1 `GET /api/access-control/roles`

Query：

- `tenantId`
- `keyword`
- `status`
- `roleType`

### 5.2 `POST /api/access-control/roles`

Body：

- `tenantId`
- `code`
- `name`
- `description`
- `roleType`
- `priority`
- `status`
- `dataScopeTemplate`
- `assignable`

### 5.3 `PUT /api/access-control/roles/:id`

### 5.4 `POST /api/access-control/roles/:id/copy`

用途：

- 复制系统角色或租户角色

Body：

- `targetTenantId`
- `newCode`
- `newName`

### 5.5 `POST /api/access-control/roles/:id/status`

### 5.6 `DELETE /api/access-control/roles/:id`

## 6. 人员配置

### 6.1 `GET /api/access-control/users`

Query：

- `tenantId`
- `keyword`
- `status`
- `roleId`
- `department`

### 6.2 `POST /api/access-control/users`

Body：

- `tenantId`
- `username`
- `realName`
- `phone`
- `email`
- `department`
- `position`
- `initialPassword`
- `status`
- `isTenantAdmin`
- `remark`

### 6.3 `PUT /api/access-control/users/:id`

### 6.4 `POST /api/access-control/users/:id/status`

### 6.5 `POST /api/access-control/users/:id/reset-password`

### 6.6 `POST /api/access-control/users/batch-import`

## 7. 角色授权

### 7.1 `GET /api/access-control/roles/:id/permissions`

返回：

- `role`
- `menuCodes[]`
- `actionCodes[]`
- `dataScopes[]`
- `version`

### 7.2 `PUT /api/access-control/roles/:id/permissions`

用途：

- 保存角色授权

Body：

- `version`
- `menuCodes[]`
- `actionCodes[]`
- `dataScopes[]`

`dataScopes[]` 结构：

```json
[
  {
    "scopeType": "warehouse_assigned",
    "scopeValues": [1, 2],
    "note": "仓库 A/B"
  }
]
```

### 7.3 `POST /api/access-control/roles/:id/permissions/reset`

用途：

- 重置到系统模板

## 8. 人员角色分配

### 8.1 `GET /api/access-control/users/:id/role-assignments`

### 8.2 `PUT /api/access-control/users/:id/role-assignments`

用途：

- 单人角色分配

Body：

- `version`
- `mode`：`append|replace`
- `assignments`

`assignments[]`：

```json
[
  {
    "roleId": 12,
    "isPrimary": true,
    "effectiveFrom": "2026-04-08 08:00:00",
    "effectiveTo": null,
    "remark": "常设主角色"
  }
]
```

### 8.3 `POST /api/access-control/role-assignments/batch`

用途：

- 批量分配角色

Body：

- `tenantId`
- `userIds[]`
- `mode`
- `assignments[]`

## 9. 审计接口

### 9.1 `GET /api/access-control/audit-logs`

Query：

- `tenantId`
- `module`
- `targetType`
- `operatorId`
- `dateFrom`
- `dateTo`

鉴权：

- `system.audit.view`

## 10. 内部聚合接口

### 10.1 `GET /api/access-control/me/snapshot`

用途：

- 获取当前登录用户最新权限快照

用途场景：

- 登录后懒加载
- 授权更新后前端主动刷新

## 11. 守卫接口演进建议

新增中间件：

1. `requirePermissions(...codes: string[])`
2. `requireTenantFeature(...codes: string[])`
3. `buildRequestAccessContext()`

请求上下文建议新增：

```ts
req.access = {
  roleCodes: string[],
  menuCodes: string[],
  actionCodes: string[],
  dataScopes: [],
  featureFlags: []
}
```
