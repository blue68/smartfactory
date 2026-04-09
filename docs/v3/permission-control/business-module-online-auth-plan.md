[artifact:ImplementationPlan]
status: READY
owner: senior-frontend-engineer
scope:
- 将租户态在线授权从“系统管理自身”扩展到概览、采购、销售、生产、仓库、主数据、报表、系统、AI 等业务模块
- 让“菜单与功能”与“角色授权”两个页面可以直接配置业务页面与关键按钮权限
inputs:
- [artifact:PRD] `docs/v3/permission-control/prd.md`
- [artifact:TaskBreakdown] `docs/v3/permission-control/task-breakdown.md`
- [artifact:Approval] `docs/v3/permission-control/approval.md`
- 现有实现：`services/api/src/modules/access-control/access-control.config.ts`
- 现有实现：`services/web/src/components/Layout/Sidebar.tsx`
- 现有实现：`services/web/src/App.tsx`
handoff_to:
- senior-backend-engineer
- senior-qa-engineer
goal:
- 让租户管理员可在线为不同角色配置业务模块可见范围和关键操作按钮权限
changed_areas:
- 权限 seed / fallback 快照 / migration
- 业务菜单 Sidebar 与业务路由守卫
- 关键页面按钮权限映射
- 权限相关单测
steps:
- 补齐业务模块菜单与功能点目录，并提供默认角色授权回退
- 为现有数据库增加业务权限 seed，保证“菜单与功能”“角色授权”可见完整业务目录
- 让前端业务导航和业务路由按 `menuCode` 生效
- 让关键按钮优先按 `permissionSnapshot.actionCodes` 判定，缺失时回退旧角色逻辑
- 补充权限快照与前端页面测试
risks:
- 现有业务接口大部分仍保留 legacy `requireRoles`，本次主要完成在线授权目录、页面显隐和关键按钮联动；更细粒度接口改造需持续推进
- 若线上数据库未执行新增 migration，业务权限目录不会自动出现
validation:
- API 单测覆盖 fallback 快照的业务菜单/按钮授权
- Web 单测覆盖角色授权页能看到业务目录、按钮权限映射可生效
