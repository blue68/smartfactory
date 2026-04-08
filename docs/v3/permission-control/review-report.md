[artifact:ReviewReport]
status: PASS
owner: code-reviewer
scope:
- 基于最新实现重新复审权限控制模块一期后端权限链路
- 重点确认系统角色授权隔离、角色生效区间解析口径、assignUserRoles 校验完整性
inputs:
- docs/v3/permission-control/prd.md
- docs/v3/permission-control/system-arch.md
- docs/v3/permission-control/api-doc.md
- docs/v3/permission-control/task-breakdown.md
- services/api/src/modules/access-control/access-control.service.ts
- services/api/src/modules/auth/auth.service.ts
- services/api/src/middleware/auth.ts
handoff_to:
- senior-backend-engineer
- senior-qa-engineer
verdict: PASS
findings:
- [severity:low] 本次重点复审的 3 个问题均未再发现阻断缺陷：`tenant_id=0` 系统角色已禁止租户侧直接改写；登录、刷新、接口鉴权均统一走 `resolveUserRoleCodes()` 按 `user_role_assignments` 的状态与生效区间解析角色；`assignUserRoles()` 已补齐用户归属、角色归属、`assignable`、`status` 与时间窗口校验。[access-control.service.ts](/Users/kongwen/claude_wk/ai-software-company/services/api/src/modules/access-control/access-control.service.ts#L103) [access-control.service.ts](/Users/kongwen/claude_wk/ai-software-company/services/api/src/modules/access-control/access-control.service.ts#L449) [access-control.service.ts](/Users/kongwen/claude_wk/ai-software-company/services/api/src/modules/access-control/access-control.service.ts#L544) [auth.service.ts](/Users/kongwen/claude_wk/ai-software-company/services/api/src/modules/auth/auth.service.ts#L201) [auth.service.ts](/Users/kongwen/claude_wk/ai-software-company/services/api/src/modules/auth/auth.service.ts#L332) [auth.ts](/Users/kongwen/claude_wk/ai-software-company/services/api/src/middleware/auth.ts#L127)
must_fix:
- None
can_follow_up:
- `listUsers` / `listRoles` 统计仍主要基于 `user_roles` 镜像表，而不是直接基于 `user_role_assignments`；若后续要把“未来生效角色”也体现在管理台统计或主角色展示中，建议再统一查询口径。[access-control.service.ts](/Users/kongwen/claude_wk/ai-software-company/services/api/src/modules/access-control/access-control.service.ts#L367)
risks:
- 当前复审结论仅覆盖本次指定的 3 个问题点，未重新展开前端 CRUD 完整性与审计日志落地范围的全面评估。
exit_criteria:
- 上述 3 个重点问题复审通过，后续可进入 QA 用例补充与回归验证。
