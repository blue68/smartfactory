[artifact:ImplementationPlan]
status: READY
owner: senior-backend-engineer
scope:
- 规划权限控制模块后端实现范围、步骤、风险与验证
inputs:
- [artifact:Approval] `docs/v3/permission-control/approval.md`
- [artifact:SystemArch] `docs/v3/permission-control/system-arch.md`
- [artifact:DBDesign] `docs/v3/permission-control/db-design.md`
- [artifact:APIDoc] `docs/v3/permission-control/api-doc.md`
- [artifact:TaskBreakdown] `docs/v3/permission-control/task-breakdown.md`
handoff_to:
- senior-backend-engineer
goal:
- 完成权限域库表、权限中心接口、登录权限快照与兼容守卫
- 保证旧角色体系在迁移期不回归
changed_areas:
- `services/api/src/migrations/*`
- `services/api/src/modules/access-control/*`
- `services/api/src/modules/auth/*`
- `services/api/src/middleware/auth.ts`
- `services/api/src/shared/*`
- `services/api/tests/*`
steps:
- 编写权限域 migration 与 seed 脚本
- 新增 `access-control` 模块及租户、菜单、角色、人员、授权、审计接口
- 实现权限聚合器与 Redis 缓存
- 扩展登录/刷新接口返回 `permissionSnapshot`
- 在 `middleware/auth.ts` 中新增 `requirePermissions`、`requireTenantFeature`
- 实现 `user_roles` 与 `user_role_assignments` 双写兼容
- 迁移 Sidebar 对应的新系统管理接口与部分关键业务接口守卫
risks:
- 双写期间若同步失败会导致权限快照与登录角色不一致
- 菜单/功能点预置数据若遗漏，将直接影响前端菜单显隐
validation:
- migration 执行与回滚验证
- auth 登录/刷新集成测试
- 权限接口单元测试与越权测试
- 跨租户隔离测试与缓存失效测试
