[artifact:SystemArch]
status: READY
owner: tech-lead-architect
scope:
- 设计权限控制模块的系统边界、模块职责、运行时数据流与兼容迁移策略
- 覆盖租户、菜单、功能点、角色、人员、授权、审计的权限域架构
inputs:
- [artifact:PRD] `docs/v3/permission-control/prd.md`
- [artifact:UserStory] `docs/v3/permission-control/user-story.md`
- [artifact:Prototype] `docs/v3/permission-control/prototype.md`
- [artifact:DesignSpec] `docs/v3/permission-control/design-spec.md`
- [artifact:InteractionSpec] `docs/v3/permission-control/interaction-spec.md`
- [artifact:UICode] `docs/v3/permission-control/ui-code.md`
- 现有实现：`services/api/src/modules/auth/auth.service.ts`
- 现有实现：`services/api/src/middleware/auth.ts`
- 现有实现：`services/web/src/stores/authStore.ts`
- 现有实现：`services/web/src/components/Layout/Sidebar.tsx`
deliverables:
- 权限控制模块的系统分层与职责划分
- 登录、菜单渲染、接口鉴权、授权变更的运行时数据流
- 与当前 `roles + requireRoles` 体系的兼容迁移方案
risks:
- 当前大量业务模块仍使用 `requireRoles`，若不做双轨兼容会造成大面积回归
- 组织维度尚不完整，`department` 数据范围需先以占位模型兼容
handoff_to:
- engineering-manager
- senior-frontend-engineer
- senior-backend-engineer
exit_criteria:
- 后端可依据本文建立权限域模块与守卫链路
- 前端可依据本文实施菜单、按钮、路由、页面级权限控制

# 权限控制模块 System Arch

## 1. 入口检查

### 1.1 目标检查

目标明确。本次仅聚焦 PC 端权限控制模块的完整落地链路，不扩展到 SSO、组织同步、字段级权限。

### 1.2 输入检查

输入齐备。产品、原型、交互和 UI 设计文档已具备，可进入架构阶段。

### 1.3 角色权限检查

符合。当前工作仅输出架构文档，不直接修改业务实现。

### 1.4 前置门禁检查

无阻塞。审批在架构产物完成后进行。

## 2. 总体结论

建议采用 `ContextScope + RBAC + Menu + Action + DataScope + TenantFeature` 六层权限架构，并以“兼容双轨”方式接入现有系统：

1. 认证返回继续保留 `roles[]`，新增 `permissions[]`、`menus[]`、`featureFlags[]`。
2. 后端守卫从单一 `requireRoles()` 扩展为 `requirePermissions()`，迁移期支持组合守卫。
3. 前端从 `hasRole()` 扩展为 `hasPermission()`、`hasMenu()`、`hasFeature()`，Sidebar 和按钮逐步从角色硬编码切换到权限点驱动。
4. 数据层新增权限域主模型，不直接复用 `roles.permissions JSON` 作为长期方案；该字段保留为兼容快照。
5. 平台级管理员使用显式 `platform_super_admin` 角色，在 `platform` 作用域下登录，再通过“切换租户上下文”进入 `tenant` 作用域；禁止默认无边界跨租户写操作。

## 3. 模块边界

### 3.1 新增模块

建议新增后端模块：`services/api/src/modules/access-control/`

子域拆分：

1. `tenant-admin`
   - 租户配置
   - 租户功能开关
   - 默认模板应用
2. `permission-catalog`
   - 菜单树
   - 功能点定义
   - 系统预置模板
3. `role-admin`
   - 角色定义
   - 角色启停
   - 系统角色复制
4. `user-admin`
   - 人员配置
   - 人员状态
   - 人员基础资料
5. `authorization`
   - 角色菜单授权
   - 角色功能点授权
   - 数据范围授权
   - 人员角色分配
6. `audit`
   - 授权变更审计
   - 批量操作审计
7. `platform-context`
   - 平台态登录
   - 租户上下文切换
   - 平台代管审计

### 3.2 与现有模块关系

1. `auth` 模块
   - 继续承担登录、刷新、登出
   - 登录后通过权限聚合器补全权限快照
2. 各业务模块
   - 保留现有 `requireRoles`
   - 逐步引入 `requirePermissions`
3. 前端 `authStore`
   - 从仅缓存 `roles` 扩展到缓存“权限快照”
4. `Sidebar`
   - 从静态 `roles` 过滤切换为菜单编码过滤

## 4. 分层设计

### 4.1 后端分层

1. Controller
   - 仅处理输入校验、响应包装、HTTP 状态码
2. Service
   - 处理租户、菜单、角色、人员、授权、审计的业务逻辑
3. Repository / Query
   - 使用 `BaseRepository` 或统一 query helper 注入 `tenant_id`
4. Guard / Middleware
   - `authMiddleware`
   - `requireRoles`
   - `requirePermissions`
   - `requireTenantFeature`
5. Aggregator
   - 登录后聚合用户可见菜单、功能点、数据范围、功能开关

### 4.2 前端分层

1. `api/accessControl.ts`
   - 统一封装权限控制接口
2. `hooks/useAccessControl.ts`
   - `hasRole`
   - `hasPermission`
   - `hasMenu`
   - `hasFeature`
3. `stores/authStore.ts`
   - 维护 `permissionSnapshot`
4. `pages/system/*`
   - 租户配置
   - 菜单与功能
   - 角色配置
   - 人员配置
   - 角色授权
   - 人员角色分配
5. `components/permission/*`
   - 授权树
   - 功能点面板
   - 数据范围面板

## 5. 核心模型关系

建议统一使用以下概念：

1. `ContextScope`
   - 运行时作用域
   - `platform` 表示平台态
   - `tenant` 表示租户态
2. `Tenant`
   - 业务隔离边界
   - 拥有功能开关、角色、人员、菜单覆盖
3. `Menu`
   - 页面入口、导航节点、虚拟分组节点
4. `Action`
   - 页面内的按钮、入口或业务操作点
5. `Role`
   - 权限授予载体
6. `RolePermission`
   - 角色与菜单/功能点/数据范围的绑定关系
7. `User`
   - 系统登录主体
8. `UserRoleAssignment`
   - 用户与角色的时效性绑定关系
9. `TenantFeatureFlag`
   - 租户功能包与模块开关
10. `AuditLog`
   - 权限与组织变更审计

## 6. 运行时数据流

### 6.1 登录流

1. 用户选择登录模式：
   - `tenant`：输入 `tenantCode + username + password`
   - `platform`：输入 `username + password`
2. `auth.service` 根据模式查询：
   - `tenant`：`tenants -> users -> user_role_assignments/user_roles -> roles`
   - `platform`：`users(tenant_id=0) -> user_role_assignments -> roles`
3. 权限聚合器加载：
   - 生效角色
   - 角色权限
   - 可见菜单
   - 功能点
   - 数据范围
   - 功能开关
4. 返回：
   - `accessToken`
   - `user`
   - `roles`
   - `permissionSnapshot`
5. 若为 `platform` 模式，`permissionSnapshot.scopeLevel = platform`，不返回租户业务菜单。

### 6.2 租户上下文切换流

1. `platform_super_admin` 在平台态调用 `switch-tenant`
2. 后端校验平台角色、目标租户状态、目标租户是否可进入
3. 重新按“目标租户 + 平台角色映射”构建租户态 `permissionSnapshot`
4. 返回新的 `accessToken / refreshToken / user context`
5. 写入审计日志：操作人、原作用域、目标租户、切换时间、来源 IP

### 6.3 前端渲染流

1. `authStore.setAuth()` 写入 `user + permissionSnapshot`
2. `Sidebar` 根据 `menuCodes` 过滤可见导航
3. 页面按钮根据 `actionCodes` 控制显隐/禁用
4. 数据筛选默认带入 `dataScopes`
5. 顶部上下文栏根据 `scopeLevel` 显示“平台态 / 租户态 / 当前代管租户”

### 6.4 接口鉴权流

1. `authMiddleware` 解出 `userId / scopeLevel / originTenantId / contextTenantId / roles`
2. 新增 `permissionMiddleware` 从缓存或数据库读取当前请求权限快照
3. 路由层执行：
   - `requireRoles(...)`
   - 或 `requirePermissions(...)`
   - 或组合 `requireTenantFeature(...)`
4. Service 层依据 `dataScopes` 做范围约束
5. 租户级系统管理接口要求 `scopeLevel = tenant`；平台态仅允许访问租户列表、模板、平台审计等接口

### 6.5 授权变更流

1. 租户管理员修改角色授权或人员角色
2. 系统写入授权主表与审计日志
3. 失效相关缓存
4. 对已登录用户：
   - 立即刷新快照缓存
   - 或在下一次请求中懒刷新

## 7. 缓存与性能策略

建议引入 Redis 权限缓存：

1. `perm:user:{scopeLevel}:{tenantId}:{userId}`
   - 用户权限快照
2. `perm:role:{tenantId}:{roleId}`
   - 角色权限展开结果
3. `perm:menu-tree:{tenantId}`
   - 租户菜单树实例

对于平台态账号：

- 平台态快照使用 `tenantId=0`
- 租户态切换后，按目标租户单独生成快照缓存

失效策略：

1. 角色授权变化
   - 清理角色缓存
   - 清理关联用户缓存
2. 人员角色变化
   - 清理用户缓存
3. 菜单或功能点变化
   - 清理租户菜单缓存
   - 清理受影响用户缓存
4. 平台态切换租户
   - 吊销旧租户态 refresh token
   - 生成新上下文缓存

## 8. 兼容迁移架构

### 8.1 JWT Payload 演进

现状：

- `userId`
- `tenantId`
- `username`
- `roles`

建议：

- 保持 JWT 只携带轻量字段，不直接塞入完整权限快照
- JWT 新增 `scopeLevel`
- JWT 新增 `homeTenantId`
- JWT 新增 `contextTenantId`
- JWT 新增可选 `snapshotVersion`

理由：

1. 权限快照变化频繁，不适合长期固化在 Token 中
2. 使用缓存或数据库可做动态失效
3. 平台态与租户态需要在请求链路上明确区分，避免把“平台身份”误当成“当前租户上下文”

### 8.2 登录返回演进

现状登录返回：

- `user.roles[]`

建议新增：

- `permissionSnapshot.menuCodes[]`
- `permissionSnapshot.actionCodes[]`
- `permissionSnapshot.dataScopes[]`
- `permissionSnapshot.featureFlags[]`
- `permissionSnapshot.version`
- `permissionSnapshot.scopeLevel`
- `permissionSnapshot.contextTenant`

### 8.3 前端兼容层

第一阶段：

1. 保留 `hasRole()`
2. 新增 `hasPermission() / hasMenu() / hasFeature()`
3. Sidebar 优先读取 `menuCodes`，缺失时回退 `roles`

第二阶段：

1. 页面按钮统一切到 `hasPermission`
2. 路由守卫改为菜单编码或权限点校验

### 8.4 后端兼容层

第一阶段：

1. 保留 `requireRoles`
2. 新增 `requirePermissions`
3. 关键新模块只使用 `requirePermissions`

第二阶段：

1. 旧业务接口逐步把角色守卫替换为权限点守卫
2. `requireRoles` 仅保留极少数系统管理兼容入口

## 9. 数据范围策略

### 9.1 范围表达

建议拆两层：

1. `scope_type`
   - `all/self/department/warehouse_assigned/customer_assigned/supplier_assigned/custom_tags`
2. `scope_value`
   - JSON 数组或关联表引用目标对象

### 9.2 当前降级策略

由于系统尚无完整部门中心：

1. `department` 允许配置，但前端提示“待组织中心接入”
2. 本期优先落地：
   - `all`
   - `self`
   - `warehouse_assigned`
   - `customer_assigned`
   - `supplier_assigned`

## 10. 审计与安全

1. 所有授权变更必须记录：
   - 操作人
   - 租户
   - 对象类型
   - 对象 ID
   - 变更前
   - 变更后
   - 来源页面
2. 系统预置角色与菜单不允许物理删除
3. `platform_super_admin` 与租户管理员的接口必须分域控制
4. 所有查询与写入统一附加 `tenant_id`

## 11. 推荐实施顺序

1. 先建权限域数据模型与预置数据迁移
2. 再扩登录返回与前端权限快照
3. 先上权限中心页面
4. 再逐页替换 Sidebar、按钮和接口守卫
