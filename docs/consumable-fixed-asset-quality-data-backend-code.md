[artifact:BackendCode]
status: READY
owner: senior-backend-engineer
scope:
- 收货分流关键回归测试补齐
- 发布前数据核查 SQL 落地
inputs:
- `docs/consumable-fixed-asset-quality-data-approval.md`
- `docs/consumable-fixed-asset-quality-data-implementation-plan.md`
- `docs/consumable-fixed-asset-ddl-api-draft.md`
handoff_to:
- senior-qa-engineer
- code-reviewer
deliverables:
- `incomingInspection` 中 `direct_expense` / `asset_capitalization` 回归
- 发布前数据核查 SQL
- 损耗品 / 固定资产高价值 integration spec
risks:
- integration/e2e 仍依赖可用的本地 MySQL/Redis 测试环境
exit_criteria:
- 关键收货分流与数据核查已具备自动化/脚本基础

changed_files:
- `services/api/tests/unit/incomingInspection.regression.test.ts`
- `services/api/tests/unit/bom.guard.test.ts`
- `services/api/tests/unit/mrp.guard.test.ts`
- `services/api/tests/unit/consumables.service.test.ts`
- `services/api/tests/unit/assets.service.test.ts`
- `services/api/tests/integration/consumableAsset.api.test.ts`
- `docs/sql-drafts/consumable-fixed-asset-validation-checks.sql`
- `docs/consumable-fixed-asset-remaining-plan.md`
- `docs/consumable-fixed-asset-execution-checklist.md`

contracts_affected:
- None

tests_run:
- `npx jest tests/unit/incomingInspection.regression.test.ts --runInBand --forceExit`
- `npx jest tests/unit/bom.guard.test.ts tests/unit/mrp.guard.test.ts --runInBand --forceExit`
- `npx jest tests/unit/consumables.service.test.ts tests/unit/assets.service.test.ts --runInBand --forceExit`
- `npm run typecheck`
- `TEST_DEFAULT_TARGET=tests/integration/consumableAsset.api.test.ts bash ../../scripts/run-api-integration.sh`（Blocked：本地 MySQL `127.0.0.1:3307` 连接超时）

known_issues:
- 已新增 `services/api/tests/integration/consumableAsset.api.test.ts`，但当前环境无法完成托管 integration 执行
