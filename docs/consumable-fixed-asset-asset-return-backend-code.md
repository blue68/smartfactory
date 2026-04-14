[artifact:BackendCode]
status: READY
owner: senior-backend-engineer
scope:
- 固定资产退回接口实现
- 资产退回单元测试与文档同步
inputs:
- `docs/consumable-fixed-asset-asset-return-approval.md`
- `docs/consumable-fixed-asset-asset-return-implementation-plan.md`
- `docs/consumable-fixed-asset-ddl-api-draft.md`
handoff_to:
- code-reviewer
- senior-qa-engineer
deliverables:
- 新增固定资产退回接口与测试
- 剩余计划同步到最新状态
risks:
- 尚未补齐整版功能测试与集成回归
exit_criteria:
- 退回接口、测试和文档已闭环

changed_files:
- `services/api/src/modules/assets/asset.controller.ts`
- `services/api/src/modules/assets/asset.routes.ts`
- `services/api/src/modules/assets/asset.service.ts`
- `services/api/tests/unit/assets.routes.test.ts`
- `services/api/tests/unit/assets.service.test.ts`
- `docs/consumable-fixed-asset-ddl-api-draft.md`
- `docs/consumable-fixed-asset-remaining-plan.md`
- `docs/consumable-fixed-asset-execution-checklist.md`

contracts_affected:
- 新增 `POST /api/assets/cards/:id/return`
- 新增权限点 `asset:return`

tests_run:
- `npx jest tests/unit/assets.routes.test.ts tests/unit/assets.service.test.ts --runInBand --forceExit`
- `npm run typecheck`

known_issues:
- 尚未补齐资产链路 integration/e2e
- 前端退回入口仍待联调
