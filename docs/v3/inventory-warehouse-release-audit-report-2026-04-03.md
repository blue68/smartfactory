[artifact:TestReport]
status: FAIL
owner: senior-qa-engineer
scope:
- 本地灰度环境执行库存仓位治理发布前巡检（postcheck + daily-audit）
- 输出是否满足发布阈值（默认仓位占比 `< 3%`）的结论
inputs:
- [inventory-warehouse-postcheck.sql](/Users/kongwen/claude_wk/ai-software-company/docs/v3/sql/inventory-warehouse-postcheck.sql)
- [inventory-warehouse-daily-audit.sql](/Users/kongwen/claude_wk/ai-software-company/docs/v3/sql/inventory-warehouse-daily-audit.sql)
- [run-inventory-warehouse-audit.sh](/Users/kongwen/claude_wk/ai-software-company/scripts/run-inventory-warehouse-audit.sh)
- [inventory-warehouse-deployment-plan-2026-04-03.md](/Users/kongwen/claude_wk/ai-software-company/docs/v3/inventory-warehouse-deployment-plan-2026-04-03.md)
handoff_to:
- senior-backend-engineer
- devops-engineer

verdict: FAIL
findings:
- [severity:blocker] 默认仓位占比 `100.0000%`，超过治理阈值 `< 3%`，不满足上线门禁。
- [severity:medium] `inventory` 与 `inventory_transactions` 存在台账差异（示例：`sku_id=24/25/30/31` 仅库存有量，`sku_id=46` 差异 `-10`），需在发布前完成差异复核。
- [severity:low] 本轮巡检中无无效仓位引用（`inventory_invalid_binding=0`、`tx_invalid_binding_daily=0`），结构性完整性已达标。
must_fix:
- 完成业务映射导入并执行 `inventory-warehouse-mapping-drill.sql`（演练环境）或等效生产流程，降低默认仓位占比至 `< 3%`。
- 对 postcheck 输出中的 SKU 台账差异逐项复核，确认是预期初始化差异还是数据异常，并形成处理记录。
can_follow_up:
- 将 `scripts/run-inventory-warehouse-audit.sh` 纳入日巡检计划任务，按日归档 `metrics.tsv` 趋势。

deliverables:
- 本地迁移执行：`services/api/src/migrations/M20260403_inventory_warehouse_alignment.sql` 已在 `smart_factory` 落库。
- 发布巡检输出目录：
  - `docs/v3/release-logs/inventory-warehouse/20260403-173003/postcheck.out.txt`
  - `docs/v3/release-logs/inventory-warehouse/20260403-173003/daily-audit.out.txt`
  - `docs/v3/release-logs/inventory-warehouse/20260403-173003/metrics.tsv`
- 收敛编排演练输出目录：
  - `docs/v3/release-logs/inventory-warehouse/remediation-20260403-174445/mapping-import/validation.out.txt`
  - `docs/v3/release-logs/inventory-warehouse/remediation-20260403-174445/mapping-import/apply.out.txt`
  - `docs/v3/release-logs/inventory-warehouse/remediation-20260403-174445/mapping-drill.out.txt`
  - `docs/v3/release-logs/inventory-warehouse/remediation-20260403-174445/audit/metrics.tsv`
- 核心指标：
  - `inventory_invalid_binding=0`
  - `tx_invalid_binding_daily=0`
  - `default_ratio_pct=100.0000`
  - `default_ratio_verdict=FAIL`
  - `default_tx_count_daily=0`

risks:
- 若在默认仓位占比未收敛前进入阶段 B/C 强校验，可能导致业务写入被拒绝或库存口径偏差放大。

exit_criteria:
- 仅当 `default_ratio_verdict=PASS` 且无 blocker/high 问题时，本轮发布巡检可转为 `PASS`。
