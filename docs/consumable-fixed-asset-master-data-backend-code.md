[artifact:BackendCode]
status: READY
owner: senior-backend-engineer
scope:
- 损耗品仓、资产待验收仓、资产仓主数据初始化脚本
- 主数据回滚 SQL 草案与执行清单同步
inputs:
- `docs/consumable-fixed-asset-master-data-approval.md`
- `docs/consumable-fixed-asset-master-data-implementation-plan.md`
- `docs/consumable-fixed-asset-ddl-api-draft.md`
- `services/api/src/migrations/M20260403_inventory_warehouse_alignment.sql`
handoff_to:
- senior-qa-engineer
- devops-engineer
- code-reviewer
deliverables:
- `scripts/bootstrap-consumable-fixed-asset-master-data.sh`
- `docs/sql-drafts/consumable-fixed-asset-master-data-rollback.sql`
- 版本剩余计划与执行清单同步到 WP3-B 最新状态
risks:
- 若租户已复用相同仓库编码但语义不同，bootstrap 会按约定值回写名称/类型
- 回滚 SQL 仅适用于未被正式业务数据引用的环境
exit_criteria:
- QA/运维可按统一脚本创建三类默认仓库与库位
- 发布前具备可审阅的回滚与复核说明

changed_files:
- `scripts/bootstrap-consumable-fixed-asset-master-data.sh`
- `docs/sql-drafts/consumable-fixed-asset-master-data-rollback.sql`
- `docs/consumable-fixed-asset-master-data-approval.md`
- `docs/consumable-fixed-asset-master-data-implementation-plan.md`
- `docs/consumable-fixed-asset-remaining-plan.md`
- `docs/consumable-fixed-asset-execution-checklist.md`

contracts_affected:
- 约定默认仓库编码：`WH-CONS` / `WH-AST-PEND` / `WH-AST`
- 约定默认库位编码：`LOC-CONS-01` / `LOC-AST-PEND-01` / `LOC-AST-01`

tests_run:
- `bash -n scripts/bootstrap-consumable-fixed-asset-master-data.sh`

known_issues:
- 未在真实 MySQL 环境执行脚本，需在 integration 或预发布库验证实际落库结果
- 回滚 SQL 依赖先执行引用检查，不能直接在已承载业务数据的环境裸跑
