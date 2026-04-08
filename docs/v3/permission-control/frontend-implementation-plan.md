[artifact:ImplementationPlan]
status: READY
owner: senior-frontend-engineer
scope:
- 规划权限控制模块前端实现范围、步骤、风险与验证
inputs:
- [artifact:Approval] `docs/v3/permission-control/approval.md`
- [artifact:TaskBreakdown] `docs/v3/permission-control/task-breakdown.md`
- [artifact:DesignSpec] `docs/v3/permission-control/design-spec.md`
- [artifact:InteractionSpec] `docs/v3/permission-control/interaction-spec.md`
- [artifact:UICode] `docs/v3/permission-control/ui-code.md`
- [artifact:APIDoc] `docs/v3/permission-control/api-doc.md`
handoff_to:
- senior-frontend-engineer
goal:
- 完成 PC 端权限中心 6 个页面及权限快照接入
- 完成 Sidebar 权限过滤与关键页面按钮权限 hook
changed_areas:
- `services/web/src/api/*`
- `services/web/src/stores/authStore.ts`
- `services/web/src/components/Layout/Sidebar.tsx`
- `services/web/src/pages/system/*`
- `services/web/src/hooks/*`
- `services/web/src/types/*`
steps:
- 新增 `access-control` API、类型定义与 query hooks
- 扩展 `authStore`，新增 `permissionSnapshot`、`hasPermission`、`hasMenu`、`hasFeature`
- 新增系统管理菜单与 6 个页面路由
- 按设计稿完成 6 个页面的表格、抽屉、弹框、授权树、批量操作交互
- 将 Sidebar 从 `roles` 过滤迁移为 `menuCodes` 过滤，保留回退逻辑
- 为关键按钮引入权限点判断，并处理禁用态/空态/错态
risks:
- 权限树和多面板页面状态复杂，若状态管理散落会导致保存丢失
- 登录快照接口与页面接口的返回格式若不稳定，会放大联调成本
validation:
- `npm run typecheck`
- 关键页面组件测试与权限显隐测试
- Boss、租户管理员、普通业务角色三种登录态回归

