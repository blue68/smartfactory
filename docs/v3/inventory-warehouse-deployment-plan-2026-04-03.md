[artifact:DeploymentPlan]
status: READY
owner: devops-engineer
scope:
- 库存仓库/库位对齐能力发布（后端接口、前端筛选与盘点调整、数据治理 SQL 工具）
- 提供可执行的发布前检查、分阶段发布、回滚与监控策略
inputs:
- [inventory-warehouse-parallel-execution-checklist.md](/Users/kongwen/claude_wk/ai-software-company/docs/v3/inventory-warehouse-parallel-execution-checklist.md)
- [inventory-warehouse-test-report-2026-04-03.md](/Users/kongwen/claude_wk/ai-software-company/docs/v3/inventory-warehouse-test-report-2026-04-03.md)
- [version-summary-2026-04-03.md](/Users/kongwen/claude_wk/ai-software-company/docs/v3/version-summary-2026-04-03.md)
handoff_to:
- devops-engineer
- senior-backend-engineer

precheck:
- `[artifact:Approval]` 已为 `APPROVED`，并行清单 `33/33` 完成
- `[artifact:TestReport]` 为 `PASS`，且无 blocker/high 级问题
- 发布窗口前完成数据库备份：`inventory`、`inventory_transactions`、`stocktaking_tasks`、`stocktaking_items`
- 校验灰度开关配置：`INVENTORY_WAREHOUSE_PHASE` 与默认仓位策略符合当前阶段目标
- 预执行 SQL 检查：`inventory-warehouse-postcheck.sql`、`inventory-warehouse-daily-audit.sql`
- 执行收敛门禁脚本：`scripts/check-inventory-warehouse-remediation-readiness.sh <mapping_csv>`，结果需为 `status=READY`
- 执行治理交互 E2E：
  - `PLAYWRIGHT_APP_BASE_URL=http://127.0.0.1:5173 npm run test:inventory-warehouse:ui:governance`
  - 预期通过 `4` 条用例（缺料看板治理跳转、库存页治理退出+重置、库存页治理退出恢复原筛选、缺料看板治理退出恢复原筛选）

steps:
- Step 1: 发布 API 与 Web 服务到灰度环境，保持阶段 A 配置（允许默认仓位兜底+告警）。
- Step 2: 执行迁移与治理脚本演练，按顺序运行：
  - `docs/v3/sql/inventory-warehouse-mapping-drill.sql`
  - `docs/v3/sql/inventory-warehouse-postcheck.sql`
  - `docs/v3/sql/inventory-warehouse-daily-audit.sql`
- Step 3: 观察 24 小时核心监控（默认仓位新增笔数、缺失仓位请求、无效仓位请求、负库存事件）。
- Step 4: 进入阶段 B，收紧业务写接口默认仓位兜底，仅保留修复通道。
- Step 5: 连续 7 天默认仓位新增为 0 后进入阶段 C，关闭新增默认仓位写入。

rollback:
- 回滚代码版本至上一稳定发布标签（API + Web 同步回滚）。
- 数据回滚按批次执行：`docs/v3/sql/inventory-warehouse-rollback-by-batch.sql`。
- 若仅需修复默认仓位历史流水，执行：`docs/v3/sql/inventory-default-location-repair-by-mapping.sql`。
- 回滚后必须重跑：
  - `docs/v3/sql/inventory-warehouse-postcheck.sql`
  - `docs/v3/sql/inventory-warehouse-daily-audit.sql`

monitoring:
- 指标 1：默认仓位新增写入数（按天、按 referenceType）。
- 指标 2：仓位缺失请求数（`INV_WAREHOUSE_REQUIRED` / `INV_LOCATION_REQUIRED`）。
- 指标 3：无效仓位请求数（`INV_LOCATION_INVALID`）。
- 指标 4：库存负数事件数与跨仓错绑事件数。
- 指标 5：默认仓位库存占比（阈值目标 `< 3%`，超阈值触发人工复核）。

owner:
- 发布责任方：devops-engineer
- 值班协同：senior-backend-engineer / senior-qa-engineer
