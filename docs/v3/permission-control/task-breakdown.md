[artifact:TaskBreakdown]
status: READY
owner: tech-lead-architect
scope:
- 将权限控制模块拆分为可执行任务，明确依赖、边界与风险
- 覆盖数据层、接口层、前端页面、鉴权迁移与测试回归
inputs:
- [artifact:SystemArch] `docs/v3/permission-control/system-arch.md`
- [artifact:DBDesign] `docs/v3/permission-control/db-design.md`
- [artifact:APIDoc] `docs/v3/permission-control/api-doc.md`
- [artifact:DesignSpec] `docs/v3/permission-control/design-spec.md`
- [artifact:InteractionSpec] `docs/v3/permission-control/interaction-spec.md`
deliverables:
- 前后端任务拆解
- 依赖顺序
- 风险与里程碑
risks:
- 权限中心本身与业务模块迁移耦合较强，若不拆阶段会导致交付范围失控
handoff_to:
- engineering-manager
- senior-frontend-engineer
- senior-backend-engineer
- senior-qa-engineer
exit_criteria:
- 每项任务都具备明确负责人、输入、输出与验收口径

# 权限控制模块 Task Breakdown

## 1. 任务拆解原则

1. 先建立权限域主数据，再接登录聚合。
2. 先交付权限中心页面，再迁移业务模块。
3. 兼容期必须允许“新老守卫并行”。

## 2. 里程碑

### M0 平台身份与上下文模型修订

目标：

- 明确 `platform_super_admin`
- 增加平台态登录与显式租户切换
- 不破坏现有租户登录链路

### M1 数据底座

目标：

- 完成库表、预置数据、兼容迁移

### M2 权限中心可用

目标：

- 6 个页面可完成基本配置与授权

### M3 登录与前端权限快照

目标：

- 登录返回 `permissionSnapshot`
- 前端具备权限 hook 和菜单过滤

### M4 业务模块迁移

目标：

- Sidebar 与重点业务按钮/接口迁移到权限点驱动

## 3. 后端任务

### BE-01 权限域 Migration

内容：

- 新建 `permission_menus`
- 新建 `permission_actions`
- 新建 `tenant_feature_flags`
- 新建 `tenant_menu_overrides`
- 新建 `role_permissions`
- 新建 `user_role_assignments`
- 新建 `access_audit_logs`
- 调整 `roles`
- 为平台级角色与平台级账号补充 `tenant_id = 0`、`role_scope = platform` 语义

依赖：

- 无

验收：

- migration 可执行、可回滚

### BE-02 预置数据生成

内容：

- 从现有 Sidebar 和业务动作清单生成菜单/功能点 seed
- 生成系统角色 seed
- 生成角色默认授权

依赖：

- BE-01

### BE-03 权限聚合器

内容：

- 按用户聚合菜单、功能点、数据范围、功能开关
- 缓存到 Redis
- 支持 `platform` 与 `tenant` 两种 `scopeLevel`

依赖：

- BE-01
- BE-02

### BE-04 登录返回升级

内容：

- `auth.service` 返回 `permissionSnapshot`
- refresh 后同步更新快照
- 增加 `loginMode`
- 增加平台态返回结构

依赖：

- BE-03

### BE-05 新增守卫中间件

内容：

- `requirePermissions`
- `requireTenantFeature`
- 请求级 access context
- 校验 `scopeLevel`

依赖：

- BE-03

### BE-06 权限中心接口

内容：

- 租户管理接口
- 菜单与功能接口
- 角色接口
- 人员接口
- 角色授权接口
- 人员角色分配接口
- 审计接口

依赖：

- BE-01
- BE-03
- BE-05

### BE-07 兼容双写

内容：

- `user_role_assignments` 与 `user_roles` 双写
- `roles.permissions` 快照同步

依赖：

- BE-01
- BE-04

### BE-08 重点业务接口迁移

内容：

- 选取 Sidebar 对应的系统管理、主数据、审批类接口，逐步引入 `requirePermissions`

依赖：

- BE-05

### BE-09 平台租户切换链路

内容：

- `switch-tenant` 接口
- `exit-tenant-context` 接口
- 切换后重签 access/refresh token
- 审计日志写入

依赖：

- BE-03
- BE-04
- BE-05

## 4. 前端任务

### FE-01 权限中心路由与菜单入口

内容：

- 新增一级菜单 `系统管理`
- 新增 6 个页面路由

依赖：

- 设计产物

### FE-02 权限 API 封装

内容：

- access-control API hooks
- 类型定义

依赖：

- APIDoc

### FE-03 权限快照 Store

内容：

- `authStore` 扩展 `permissionSnapshot`
- 新增 `hasPermission/hasMenu/hasFeature`
- 新增 `scopeLevel/contextTenantId/originTenantId`

依赖：

- 登录返回升级

### FE-04 6 个权限中心页面

内容：

- 租户配置
- 菜单与功能
- 角色配置
- 人员配置
- 角色授权
- 人员角色分配

依赖：

- FE-02
- 设计产物

### FE-05 Sidebar 迁移

内容：

- 由 `roles` 过滤切换为 `menuCodes` 过滤
- 缺失快照时回退旧逻辑
- 平台态不展示租户业务菜单

依赖：

- FE-03

### FE-06 页面按钮权限 hook

内容：

- 重点页面按钮替换为 `hasPermission`

依赖：

- FE-03

### FE-07 平台租户切换入口

内容：

- 登录页支持 `tenant / platform` 两种模式
- 顶部增加“当前上下文租户”切换器
- 提供“退出租户上下文”入口

依赖：

- FE-03
- BE-09

## 5. QA 任务

### QA-01 权限中心主流程测试

- 新建租户
- 新建角色
- 配置角色授权
- 给人员分配角色
- 生效验证

### QA-02 越权回归

- 菜单不可见
- 按钮不可见
- 未授权接口返回 1003
- 跨租户不可见
- 平台态不能直接访问租户业务接口
- 非 `platform_super_admin` 不能调用 `switch-tenant`

### QA-03 兼容回归

- 老账号登录
- 旧菜单保留
- 旧角色接口不回归

## 6. 风险与应对

### R1 双写一致性

应对：

- 兼容期增加对账脚本
- 审计记录双写来源

### R2 菜单/功能点清单不全

应对：

- 从 `Sidebar` 与路由、关键按钮清单双来源生成种子

### R3 数据范围对象主数据不齐

应对：

- 第一阶段只落地仓库/客户/供应商/self/all

## 7. 建议实施顺序

1. BE-01
2. BE-02
3. BE-03
4. BE-04
5. FE-02
6. FE-03
7. FE-01
8. FE-04
9. BE-05
10. BE-06
11. FE-05
12. FE-06
13. BE-07
14. BE-08
15. QA-01 ~ QA-03
