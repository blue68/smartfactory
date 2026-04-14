[artifact:ImplementationPlan]
status: READY
owner: senior-backend-engineer
scope:
- 补损耗品与固定资产收货分流测试
- 输出历史数据核查 SQL
inputs:
- `docs/consumable-fixed-asset-quality-data-approval.md`
- `docs/consumable-fixed-asset-execution-checklist.md`
- `docs/consumable-fixed-asset-ddl-api-draft.md`
handoff_to:
- senior-qa-engineer
- code-reviewer

goal:
- 为 `direct_expense` 和 `asset_capitalization` 分流补关键自动化回归
- 产出发布前可直接执行的历史数据核查 SQL

changed_areas:
- `services/api/tests/unit/incomingInspection.regression.test.ts`
- `docs/sql-drafts`
- `docs`

steps:
- 为损耗品直耗型收货补“不写 inventory / inventory_transactions，只扣减在途”的回归
- 为固定资产资本化收货补“不进库存，但写 receipt control fields”的回归
- 输出历史 SKU 回填、BOM 污染、固定资产错误收货、仓库主数据检查 SQL
- 运行定向测试

risks:
- 当前仍是 unit/regression 级验证，尚未替代完整 integration/e2e

validation:
- `npx jest tests/unit/incomingInspection.regression.test.ts --runInBand --forceExit`
