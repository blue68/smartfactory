[artifact:ImplementationPlan]
status: READY
owner: senior-backend-engineer
scope:
- 跟进 `docs/v3/permission-control/*.md` 中“采用 `platform_super_admin`，而不是让普通系统管理员天然跨租户”方案的实现进度
- 固化 2026-04-08 本轮已落地能力、验证结果与剩余缺口
inputs:
- [prd.md](/Users/kongwen/claude_wk/ai-software-company/docs/v3/permission-control/prd.md)
- [system-arch.md](/Users/kongwen/claude_wk/ai-software-company/docs/v3/permission-control/system-arch.md)
- [api-doc.md](/Users/kongwen/claude_wk/ai-software-company/docs/v3/permission-control/api-doc.md)
- [task-breakdown.md](/Users/kongwen/claude_wk/ai-software-company/docs/v3/permission-control/task-breakdown.md)
handoff_to:
- senior-qa-engineer
- devops-engineer

goal:
- 将 `platform_super_admin` 平台态登录、显式切换租户上下文、普通租户管理员跨租户收口推进到可编译、可回归的实现状态。

changed_areas:
- `services/api/src/modules/auth/*`
- `services/api/src/middleware/auth.ts`
- `services/api/src/modules/access-control/*`
- `services/api/src/migrations/M20260408_access_control_phase1.sql`
- `services/api/tests/unit/accessControl.auth.test.ts`
- `services/api/tests/integration/accessControl.api.test.ts`
- `services/api/tests/unit/auth.service.permission.test.ts`
- `services/web/src/pages/auth/LoginPage.tsx`
- `services/web/src/pages/system/TenantConfigPage.tsx`
- `services/web/src/components/Layout/Header.tsx`
- `services/web/src/api/auth.ts`
- `services/web/src/types/{models,enums,accessControl}.ts`
- `services/web/src/utils/request.ts`
- `scripts/bootstrap-platform-super-admin.sh`
- `scripts/verify-platform-super-admin-bootstrap.sh`
- `scripts/run-permission-control-ui-ci-check.sh`
- `package.json`
- `scripts/prepare-real-browser-ui-ci.sh`
- `tests/helpers/accessControlFlow.ts`
- `tests/permissionControl.real.spec.ts`
- `.github/workflows/real-browser-ui-playwright.yml`
- `.github/workflows/ci.yml`

steps:
1. 将登录模型扩展为 `tenant | platform` 双模式。
2. 在 JWT / refresh token / permissionSnapshot 中补齐 `scopeLevel + originTenantId + contextTenantId`。
3. 新增 `POST /api/auth/switch-tenant` 与 `POST /api/auth/exit-tenant-context`。
4. 收口 `access-control` 租户查询与修改接口，禁止普通租户管理员天然跨租户。
5. 前端补齐平台登录、进入租户、退出租户态的基础操作闭环。
6. 补 migration seed、单测与 API 集成用例，并执行定向验证。

risks:
- 当前代码路径已支持 `platform_super_admin`，但数据库仍需要存在 `tenant_id=0` 的平台账号与该角色分配，才能在真实环境启用。
- 自动化回归已收敛到稳定通过，但真实环境仍需保证 JWT/Redis/MySQL 与平台账号 seed 一致，否则平台态登录与 refresh 链路会出现环境级偏差。

validation:
- `cd services/api && npm run typecheck`
- `cd services/api && npm run test:unit:access-control`
- `cd services/web && npm run typecheck`
- `cd services/api && npm run test:integration:access-control`
- `npm run bootstrap:platform-admin`
- `npm run test:permission-control:bootstrap`
- `npm run test:permission-control:ui:ci:regression`
- `npx playwright test tests/permissionControl.real.spec.ts --list`
- `npx playwright test tests/permissionControl.real.spec.ts --project=chromium --grep "platform_super_admin"`

## 最新推进（2026-04-08）

- 已落地：
  - `POST /api/auth/login` 支持 `loginMode=platform`，仅 `platform_super_admin` 可进入平台态。
  - `POST /api/auth/switch-tenant` / `POST /api/auth/exit-tenant-context` 已接通，切换后会重签 access/refresh token。
  - JWT、Refresh Token、`permissionSnapshot`、前端 `User` 模型均已携带 `scopeLevel / originTenantId / contextTenantId`。
  - 租户列表页已增加“进入租户”操作；顶部用户菜单已增加“返回平台态”。
  - 普通租户管理员访问 `access-control` 的租户查询/变更接口时，已被限制在当前租户内，不再天然跨租户。
  - 切换/退出租户上下文会尝试写入 `access_audit_logs.module=platform_context` 审计记录。
  - `M20260408_access_control_phase1.sql` 已补 `platform_super_admin` 预置角色、`platform.tenant.switch` 功能点，以及最小平台态菜单/动作授权。
  - `accessControl.api.test.ts` 已新增平台态登录/切租户/退出平台态集成用例，以及普通租户管理员跨租户访问拦截用例。
  - 新增 [bootstrap-platform-super-admin.sh](/Users/kongwen/claude_wk/ai-software-company/scripts/bootstrap-platform-super-admin.sh)，可重复执行地初始化平台账号、角色授权和角色分配；根脚本入口为 `npm run bootstrap:platform-admin`。
  - 新增 `tests/permissionControl.real.spec.ts` 中的平台态浏览器回归用例，覆盖“平台登录 -> 进入租户 -> 返回平台态”；`tests/helpers/accessControlFlow.ts` 已改为按真实测试库表结构自适应 seed 平台账号，不再强依赖 `role_scope` 等新列已存在。
  - 已修复两处导致浏览器回归不稳定的前端问题：
    - `TenantConfigPage.tsx` 在功能开关弹窗未打开时不再因空数组默认值触发 `Maximum update depth exceeded`
    - `Header.tsx` 退出租户态后改为先落平台态 token/user，再强制回到 `/system/tenants`，避免被当前租户态页面守卫抢先重定向到 `/dashboard`
  - 已修正真实回归 helper 的默认站点地址为 `http://127.0.0.1:5173`，不再误打本机 `80` 端口的历史 nginx 页面。
  - 已修复后端鉴权上下文中的 ID 类型漂移问题：`authMiddleware` 现在会将 JWT 中的 `userId / tenantId / originTenantId / contextTenantId` 统一归一化为数字，避免普通租户管理员因 `"9997" !== 9997` 被误判为跨租户。
  - 已修复集成测试与预置平台角色冲突的问题：`accessControl.api.test.ts` 不再硬编码复用一个可能与现有 `platform_super_admin` 冲突的 role id，而是优先复用现存平台角色，仅在缺失时按需创建测试角色。
  - `auth.service.ts` 已统一归一化登录、refresh、切租户、退出租户态链路中的用户/租户 ID，平台态切租户返回体、JWT 与 `permissionSnapshot` 不再混入字符串型租户 ID。
  - 仓库根级 Playwright 权限控制脚本已显式改为访问 `http://127.0.0.1:80` 的容器化本地栈，避免继续依赖“默认端口”语义。
  - `.github/workflows/ci.yml` 已新增 `permission-control-ui-smoke`，将权限中心真实浏览器 smoke 回归纳入统一 real-browser Playwright 流水线。
  - `scripts/prepare-real-browser-ui-ci.sh` 现在会先加载现有 `.env` 再写回默认值，避免本地复用旧 MySQL 数据卷时因 DB 凭据被 CI 默认值覆盖而导致 `Access denied`。
  - `M20260408_access_control_phase1.sql` 已去掉对 `roles.is_system` 的硬依赖，兼容当前本地库里没有该列的角色表结构。
  - `tests/permissionControl.real.spec.ts` 的功能开关 smoke / regression 用例已从普通系统管理员调整为 `platform_super_admin`，与“普通系统管理员不再天然跨租户”的版本语义保持一致。
  - 平台态最小授权已补 `system.audit.view`，`platform_super_admin` 现在可在平台态进入权限审计页查看自己发起的租户治理变更，不必先切入租户态。
  - `.github/workflows/ci.yml` 已继续补齐 `permission-control-ui-regression`，并纳入 `ci-gate` 的 develop 分支回归门禁。
  - `scripts/bootstrap-platform-super-admin.sh`、`tests/helpers/accessControlFlow.ts` 与 migration seed 已同步补齐平台态审计查看权限，避免真实环境、bootstrap 环境与 Playwright seed 行为不一致。
  - `scripts/prepare-real-browser-ui-ci.sh` 现已具备 `.env` 备份与自动恢复能力，本地执行 real-browser 准备流程后不会再把开发环境配置永久改写成 CI 版本。
  - 新增 [verify-platform-super-admin-bootstrap.sh](/Users/kongwen/claude_wk/ai-software-company/scripts/verify-platform-super-admin-bootstrap.sh)，会以临时平台账号执行 `bootstrap-platform-super-admin.sh`、校验数据库角色分配与关键权限、再调用 `/api/auth/login` 断言平台态 token/user 快照，并在结束后自动清理临时账号。
  - 根级脚本新增 `npm run test:permission-control:bootstrap`，用于把平台账号 bootstrap 从一次性手工联调收敛成可重复执行的验收入口。
  - `real-browser-ui-playwright.yml` 已支持可选 `pre_test_command`，权限中心 smoke / regression 任务现会在跑 Playwright 前先执行一次平台管理员 bootstrap 验证，避免 CI 只验证“已存在账号”的 happy path。
  - 新增 [run-permission-control-ui-ci-check.sh](/Users/kongwen/claude_wk/ai-software-company/scripts/run-permission-control-ui-ci-check.sh)，可在本地一条命令复现 CI 权限链路：准备容器栈、校验 `platform_super_admin` bootstrap、执行 smoke / regression / full Playwright 回归，并在结束后自动清理容器栈。
  - 根级脚本新增 `npm run test:permission-control:ui:ci:smoke`、`npm run test:permission-control:ui:ci:regression` 与 `npm run test:permission-control:ui:ci`，联调与预发环境可直接复用，不必手工拼接验证命令。
  - 已修复平台态被租户功能开关误拦截的问题：`buildPermissionSnapshot` 仅在 `scopeLevel=tenant` 时才以 `tenant_feature_flags` 作为权威来源，平台态 `platform_super_admin` 不再因某个租户关闭 `rbac_center` 而无法查看租户配置或租户列表。
  - 已收紧“租户配置”语义：`system.tenant.config` 与 `system.tenant.manage` 现在明确归属平台治理，普通租户管理员与平台管理员切入租户后的代管态都不会再拿到这组权限。
  - 已同步收紧平台专属动作：`platform.tenant.switch` 不再下发到任何租户态 `permissionSnapshot`，避免租户管理员和代管租户态误持有平台切租户能力。
  - 已修复租户态菜单管理页仍暴露平台菜单的问题：`getMenuTree` / `getMenuActions` 会按当前 `scopeLevel` 过滤平台专属菜单与动作，租户态“菜单与功能”页面不再出现“租户配置”“租户管理”“切换租户”等平台项。
  - 已补针对“平台态不受租户 feature flag 约束”“租户态裁掉平台专属菜单/动作”“租户态菜单树不再显示租户配置”的后端单测，避免后续再次回退到“侧边栏已隐藏、菜单树仍可见”的半收口状态。

- 本轮验证结果：
  - 后端类型检查：通过
  - 前端类型检查：通过
  - 后端定向单测：通过（当前已扩充到 `19 tests passed`）
  - 后端集成测试：通过（`6 tests passed`，`DB_HOST=127.0.0.1 DB_PORT=3307`）
  - Playwright 用例枚举：通过，已识别 3 条真实后端回归用例，其中包含 `platform_super_admin` 平台态流转用例
  - Playwright 平台态单用例：已通过（在 API=`127.0.0.1:3000`、Web=`127.0.0.1:5173` 常驻环境下执行 `PLAYWRIGHT_SKIP_WEBSERVER=1 npx playwright test tests/permissionControl.real.spec.ts --project=chromium --grep "platform_super_admin" --reporter=line`，结果 `1 passed (9.8s)`）
  - 权限中心真实浏览器 smoke 脚本入口：已纳入 CI，且已在容器化本地栈上通过 `npm run test:permission-control:ui:smoke` 验证（`1 passed`）
  - 权限中心真实浏览器 regression 脚本入口：已在容器化本地栈上通过 `npm run test:permission-control:ui:regression` 验证（`2 passed`）
  - real-browser 环境准备脚本：已验证执行完成后自动恢复本地 `.env`
  - 平台管理员 bootstrap 自动校验脚本：已在容器化本地栈上通过 `npm run test:permission-control:bootstrap` 验证；脚本完成了“创建临时平台账号 -> 校验平台角色授权 -> 平台态登录 -> 自动清理临时账号”的完整闭环
  - 权限中心本地 CI 复现脚本：已通过 `npm run test:permission-control:ui:ci:regression` 验证；脚本完成了“prepare-real-browser-ui-ci -> bootstrap verify -> Playwright regression -> docker compose down -v”的整链路闭环
  - 本地最新手工验收：已验证 `FACTORY001` 在开启 `rbac_center` 后，租户管理员仍可见“菜单与功能 / 角色配置 / 人员配置 / 角色授权 / 人员角色分配 / 权限审计”，但不再可见“租户配置”；直接访问 `/system/tenants` 会被重定向回 `/dashboard`；“菜单与功能”页的菜单树也不再显示 `system.tenant.config`。

- 当前仍待推进：
  - 在联调/预发环境执行一次 `npm run test:permission-control:bootstrap`，确认平台账号 bootstrap 校验脚本与真实数据库、Redis/JWT 配置一致。
  - 在 CI 上实跑一轮新增的 `permission-control-ui-regression`，确认运行时长与容器资源占用在可接受范围内。
