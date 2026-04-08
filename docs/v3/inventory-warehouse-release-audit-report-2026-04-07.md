[artifact:TestReport]
status: PASS
owner: senior-qa-engineer
scope:
- 2026-04-07 库存仓位收敛发布门禁巡检（readiness + postcheck + daily-audit + remediation drill）
- 更新最新门禁结论与证据路径
inputs:
- [version-summary-2026-04-03.md](/Users/kongwen/claude_wk/ai-software-company/docs/v3/version-summary-2026-04-03.md)
- [inventory-warehouse-release-audit-report-2026-04-03.md](/Users/kongwen/claude_wk/ai-software-company/docs/v3/inventory-warehouse-release-audit-report-2026-04-03.md)
- [run-inventory-warehouse-audit.sh](/Users/kongwen/claude_wk/ai-software-company/scripts/run-inventory-warehouse-audit.sh)
- [run-inventory-warehouse-remediation.sh](/Users/kongwen/claude_wk/ai-software-company/scripts/run-inventory-warehouse-remediation.sh)
- [check-inventory-warehouse-remediation-readiness.sh](/Users/kongwen/claude_wk/ai-software-company/scripts/check-inventory-warehouse-remediation-readiness.sh)
- [bootstrap-inventory-warehouse-master-data.sh](/Users/kongwen/claude_wk/ai-software-company/scripts/bootstrap-inventory-warehouse-master-data.sh)
- [fill-inventory-location-mapping-candidates.sh](/Users/kongwen/claude_wk/ai-software-company/scripts/fill-inventory-location-mapping-candidates.sh)
- [repair-inventory-default-transactions-by-mapping.sh](/Users/kongwen/claude_wk/ai-software-company/scripts/repair-inventory-default-transactions-by-mapping.sh)
handoff_to:
- devops-engineer
- senior-backend-engineer

verdict: PASS
findings:
- [severity:low] 收敛门禁已通过：`status=READY`，`active_non_default_warehouses=1`，`active_non_default_locations=1`，`mapping_csv_filled_rows=45`。
- [severity:low] 收敛编排已生效：映射行数 `total_mapping_rows=45`，默认仓位迁移与回补链路可重复执行。
- [severity:low] 发布阈值已达成：`default_ratio_pct=0.0000`，`default_ratio_verdict=PASS`。
- [severity:low] 结构完整性检查通过：`inventory_invalid_binding=0`、`tx_invalid_binding_daily=0`、`default_tx_count_total=0`。
- [severity:low] 残余默认流水修复已脚本化并集成到主编排 `step3.5`，最新回归 `candidate_tx_rows=0`、`repaired_default_tx_rows=0`。
- [severity:low] 前端治理交互已补齐“退出治理恢复原筛选上下文”，并通过单测与治理聚合回归。
- [severity:low] 治理聚合前端回归已扩展到 `4` 条场景，覆盖库存页与缺料看板双页面治理恢复链路。
must_fix:
- None
can_follow_up:
- 用真实业务仓位映射替换当前演练映射（`WH-DRILL-A/LOC-DRILL-A01`），并复跑同链路验证。
- 评估是否将 `inventory-warehouse-mapping-drill.sql` 的 `imported_mapping_rows` 指标改为读取已导入映射表，减少误读。
- 将 `step3.5` 的执行摘要（candidate/repaired/after）纳入日巡检看板。

deliverables:
- 主数据引导命令：
  - `./scripts/bootstrap-inventory-warehouse-master-data.sh WH-DRILL-A 演练仓A LOC-DRILL-A01 演练库位A01`
- 候选映射填充命令：
  - `./scripts/fill-inventory-location-mapping-candidates.sh docs/v3/sql/inventory-location-mapping-candidates-20260407-133711.csv WH-DRILL-A LOC-DRILL-A01`
- readiness 检查命令：
  - `./scripts/check-inventory-warehouse-remediation-readiness.sh docs/v3/sql/inventory-location-mapping-candidates-20260407-133711-filled-20260407-134641.csv`
- remediation 编排命令：
  - `./scripts/run-inventory-warehouse-remediation.sh docs/v3/sql/inventory-location-mapping-candidates-20260407-133711-filled-20260407-134641.csv`
- 残余默认流水自动修复命令：
  - `./scripts/repair-inventory-default-transactions-by-mapping.sh --apply --repair-tag <batch_no>`
- audit 执行命令：
  - `OUTPUT_DIR=docs/v3/release-logs/inventory-warehouse/20260407-135322 ./scripts/run-inventory-warehouse-audit.sh`
- 残余默认流水修复证据：
  - `docs/v3/release-logs/inventory-warehouse/20260407-135322/residual-default-tx-fix.out.txt`
- 修复后 audit 执行命令：
  - `OUTPUT_DIR=docs/v3/release-logs/inventory-warehouse/20260407-135322 ./scripts/run-inventory-warehouse-audit.sh`
- 最新证据目录：
  - `docs/v3/release-logs/inventory-warehouse/remediation-20260407-135900/*`
  - `docs/v3/release-logs/inventory-warehouse/20260407-135322/*`
- 前端治理交互回归命令：
  - `PLAYWRIGHT_APP_BASE_URL=http://127.0.0.1:5173 npm run test:inventory-warehouse:ui:governance`
  - 最新结果：`4 passed`
  - 覆盖：
    - `tests/productionShortage.real.spec.ts`：缺料看板“默认仓位治理”跳转库存页
    - `tests/inventory.real.spec.ts`：库存页“退出治理模式 + 重置筛选”
    - `tests/inventory.real.spec.ts`：库存页“退出治理模式后恢复进入前仓位筛选”
    - `tests/productionShortage.real.spec.ts`：缺料看板“退出治理模式后恢复进入前仓位筛选”
- 前端治理退出恢复筛选回归：
  - `cd services/web && npm run test -- tests/pages/inventoryPage.test.tsx tests/pages/shortageBoard.test.tsx`
  - 覆盖：
    - 退出治理模式恢复进入前仓库/库位筛选（库存页、缺料看板）

risks:
- 当前映射为演练批量填充，可能与真实仓位作业口径存在偏差；上线前应替换为业务确认映射。

exit_criteria:
- `default_ratio_verdict=PASS` 且 readiness `status=READY`（已满足）。
