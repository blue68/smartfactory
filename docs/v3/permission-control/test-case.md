[artifact:TestCase]
status: READY
owner: senior-qa-engineer
scope:
- 覆盖权限控制模块一期的主流程、异常流与迁移兼容验证
- 覆盖登录返回 permissionSnapshot、系统管理菜单、访问控制、租户/角色/人员/授权/分配接口
inputs:
- [artifact:PRD] `docs/v3/permission-control/prd.md`
- [artifact:Prototype] `docs/v3/permission-control/prototype.md`
- [artifact:APIDoc] `docs/v3/permission-control/api-doc.md`
- [artifact:SystemArch] `docs/v3/permission-control/system-arch.md`
- 当前实现：`services/api/src/modules/access-control/*`
- 当前实现：`services/api/src/middleware/auth.ts`
- 当前实现：`services/api/src/modules/auth/auth.service.ts`
- 当前实现：`services/web/src/App.tsx`
- 当前实现：`services/web/src/components/Layout/Sidebar.tsx`
- 当前实现：`services/web/src/stores/authStore.ts`
- 当前实现：`services/web/src/api/accessControl.ts`
- 当前实现：`services/web/src/hooks/useAccessControlPermission.ts`
deliverables:
- 端到端测试场景集
- 接口级测试场景集
- 异常与回退场景集
risks:
- 当前验证以静态检查和代码审阅为主，未执行完整浏览器 E2E
- 部分页面仍以骨架页形式接入，业务级编辑/保存交互需后续补强
handoff_to:
- senior-qa-engineer
- devops-engineer
exit_criteria:
- 能基于本文直接组织回归验证与发布前验收

# 权限控制模块 Test Case

## 1. 测试目标

验证 PC 端权限控制模块一期实现是否满足以下要求：

1. 登录后返回 `permissionSnapshot`
2. 系统管理菜单可按权限显示
3. 系统页面具备访问控制
4. 租户、角色、人员、授权、分配接口具备主流程
5. 无权限、无功能开关、空数据、迁移未执行场景能够稳定回退

## 2. 测试范围

### 2.1 覆盖功能

- 登录与刷新令牌
- 权限快照缓存与读取
- 侧边栏系统管理菜单显示
- 系统管理 6 个页面入口
- 租户配置
- 菜单与功能
- 角色配置
- 人员配置
- 角色授权
- 人员角色分配
- 权限中间件
- 迁移回退逻辑

### 2.2 不覆盖功能

- SSO、LDAP、企业微信同步
- 字段级权限
- 审计中心前端展示
- 完整浏览器自动化回归
- 真实生产数据迁移演练

## 3. 测试环境

- 本地开发环境
- `services/web`
- `services/api`
- 默认租户与系统预置角色数据
- 权限域 migration 可存在或不存在两种状态

## 4. 测试用例

### TC-AC-001 登录返回权限快照

- 前置条件:
- 账号存在且可登录
- 对应租户已启用 `rbac_center`

- 步骤:
- 打开登录页
- 输入账号、密码、租户编码并登录

- 期望结果:
- 登录成功
- 响应体包含 `accessToken`
- 响应体包含 `user`
- 响应体包含 `permissionSnapshot`
- `permissionSnapshot` 中含 `menuCodes`、`actionCodes`、`featureFlags`

### TC-AC-002 刷新后保留权限快照

- 前置条件:
- 已完成一次登录
- 浏览器中仅保留 `HttpOnly Refresh Token`

- 步骤:
- 触发 access token 刷新

- 期望结果:
- 刷新接口返回新的 `accessToken`
- 刷新接口返回新的 `permissionSnapshot`
- 前端 `authStore` 重新写入快照，不丢失系统管理菜单权限

### TC-AC-003 系统管理菜单显示

- 前置条件:
- 当前用户具备 `system.tenant.config` 或对应回退角色权限

- 步骤:
- 登录后进入主界面
- 查看侧边栏系统管理分组

- 期望结果:
- `系统管理` 分组可见
- `租户配置`、`菜单与功能`、`角色配置`、`人员配置`、`角色授权`、`人员角色分配` 按权限显示
- 用户无权限时，不显示对应入口

### TC-AC-004 系统页面访问控制

- 前置条件:
- 当前用户不具备某系统页面菜单权限

- 步骤:
- 直接访问受限系统页面路由

- 期望结果:
- 页面被重定向到默认可访问页面或展示无权限结果
- 不出现未授权页面内容

### TC-AC-005 租户配置列表主流程

- 前置条件:
- 当前账号具备 `system.tenant.manage`

- 步骤:
- 进入租户配置页
- 查询租户列表
- 新建租户

- 期望结果:
- 列表可正常加载
- 新建提交成功后返回新租户 ID
- 列表刷新后可见新租户

### TC-AC-006 菜单与功能树主流程

- 前置条件:
- 当前账号具备 `system.menu.manage`

- 步骤:
- 进入菜单与功能页
- 查看菜单树
- 选择某菜单节点
- 查看对应功能点列表

- 期望结果:
- 菜单树返回可展示的层级结构
- 功能点与菜单节点联动
- 空数据时显示空态提示

### TC-AC-007 角色配置主流程

- 前置条件:
- 当前账号具备 `system.role.manage`

- 步骤:
- 进入角色配置页
- 查看角色列表

- 期望结果:
- 角色分页列表正常返回
- 系统预置角色与自定义角色均可展示
- 统计卡与列表数据一致

### TC-AC-008 人员配置主流程

- 前置条件:
- 当前账号具备 `system.user.manage`

- 步骤:
- 进入人员配置页
- 查询人员列表

- 期望结果:
- 人员列表可分页显示
- 主角色、角色数、状态字段正确渲染

### TC-AC-009 角色授权读取与保存

- 前置条件:
- 当前账号具备 `system.role.grant`

- 步骤:
- 进入角色授权页
- 选择某角色
- 查看授权详情
- 保存授权变更

- 期望结果:
- `GET /roles/:id/permissions` 返回菜单、功能点、数据范围
- `PUT /roles/:id/permissions` 接口可保存变更
- 保存后可再次读取到更新结果

### TC-AC-010 人员角色分配读取与保存

- 前置条件:
- 当前账号具备 `system.user.assign`

- 步骤:
- 进入人员角色分配页
- 选择某人员
- 查看当前分配
- 提交角色分配

### TC-AC-011 平台管理员 bootstrap 校验闭环

- 前置条件:
- 本地或联调环境 API、MySQL、Redis 可访问
- 数据库存在 `tenant_id=0` 平台域

- 步骤:
- 执行 `npm run test:permission-control:bootstrap`

- 期望结果:
- 脚本会创建临时平台管理员账号
- 数据库中存在 `platform_super_admin` 主角色分配
- 角色授权包含 `system.tenant.manage`、`platform.tenant.switch`、`system.audit.view`
- `POST /api/auth/login` 使用 `loginMode=platform` 登录成功
- 返回体中的 `user.scopeLevel=platform`、`originTenantId=0`、`contextTenantId=null`
- 脚本结束后自动清理临时账号

### TC-AC-012 权限中心本地 CI 复现闭环

- 前置条件:
- 本地可执行 Docker Compose
- 当前仓库根目录存在 `scripts/prepare-real-browser-ui-ci.sh`

- 步骤:
- 执行 `npm run test:permission-control:ui:ci:smoke` 或 `npm run test:permission-control:ui:ci:regression`

- 期望结果:
- 脚本自动准备 real-browser UI 容器栈
- 在执行 Playwright 前会先完成 `platform_super_admin` bootstrap 校验
- smoke / regression 用例执行通过
- 脚本结束后自动执行 `docker compose down -v`

- 期望结果:
- `GET /users/:id/role-assignments` 返回人员角色列表
- `POST /users/:id/role-assignments` 可保存分配结果
- 主角色、有效期字段可被正确回显

### TC-AC-011 无权限异常

- 前置条件:
- 当前账号不具备目标权限

- 步骤:
- 请求受限接口或访问受限页面

- 期望结果:
- 后端返回权限不足错误
- 前端不泄露页面内容

### TC-AC-012 无功能开关异常

- 前置条件:
- 当前租户未启用 `rbac_center`

- 步骤:
- 请求权限中心接口

- 期望结果:
- 后端返回租户功能未启用错误
- 前端不显示对应系统管理入口

### TC-AC-013 空数据回退

- 前置条件:
- 权限域表为空或相关表尚未创建

- 步骤:
- 登录并访问系统管理菜单

- 期望结果:
- 登录仍可成功
- 系统菜单回退到角色预置映射
- 页面可展示空态或骨架态，不崩溃

### TC-AC-014 迁移未执行 fallback

- 前置条件:
- `role_permissions` 或 `tenant_feature_flags` 表不存在

- 步骤:
- 调用权限快照构建逻辑

- 期望结果:
- 使用 fallback snapshot
- 现有固定角色仍可完成登录和基础导航
- 无数据库表时报错不影响认证主流程

### TC-AC-015 命名一致性回归

- 前置条件:
- 前后端权限模块已接入

- 步骤:
- 检查系统管理相关路由、菜单编码与后端 seed

- 期望结果:
- 前端路由、侧边栏菜单编码、后端 seed 使用同一套命名
- 不存在 `menus-actions`、`role-grants` 这类历史漂移命名

## 5. 重点回归清单

- 登录返回 `permissionSnapshot`
- Sidebar 系统管理入口是否显示
- `/system/tenants`
- `/system/menus`
- `/system/roles`
- `/system/users`
- `/system/role-permissions`
- `/system/user-role-assignments`
- `/api/access-control/tenants`
- `/api/access-control/menus/tree`
- `/api/access-control/menus/:id/actions`
- `/api/access-control/roles`
- `/api/access-control/roles/:id/permissions`
- `/api/access-control/users`
- `/api/access-control/users/:id/role-assignments`
- `requirePermissions`
- `requireTenantFeature`
- migration fallback
