[artifact:ImplementationPlan]
status: READY
owner: senior-backend-engineer
scope:
- 损耗品与固定资产默认仓库/库位主数据初始化脚本
- 回滚 SQL 草案与执行文档同步
inputs:
- `docs/consumable-fixed-asset-master-data-approval.md`
- `docs/consumable-fixed-asset-ddl-api-draft.md`
- `docs/consumable-fixed-asset-backend-task-breakdown.md`
- `scripts/bootstrap-inventory-warehouse-master-data.sh`
handoff_to:
- senior-qa-engineer
- devops-engineer
- code-reviewer

goal:
- 为损耗品仓、资产待验收仓、资产仓提供一键可重复执行的主数据初始化脚本
- 为发布前演练提供可审阅的主数据回滚 SQL 草案

changed_areas:
- `scripts/bootstrap-consumable-fixed-asset-master-data.sh`
- `docs/sql-drafts/consumable-fixed-asset-master-data-rollback.sql`
- `docs`

steps:
- 基于现有仓库/库位 bootstrap 脚本复用幂等插入模式
- 固化三类默认仓库与默认库位编码、名称、类型
- 输出回滚前置检查和删除顺序，避免误删已被库存/资产数据引用的主数据
- 同步剩余计划、执行清单和后端交付文档

risks:
- 若租户已自定义同编码仓库但业务语义不同，脚本会以幂等更新方式覆盖名称和类型
- 回滚 SQL 仅适用于未承载正式业务数据或已确认无引用的环境

validation:
- `bash -n scripts/bootstrap-consumable-fixed-asset-master-data.sh`
