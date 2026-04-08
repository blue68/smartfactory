[artifact:ImplementationPlan]
status: BLOCKED
owner: senior-backend-engineer
scope:
- 执行默认仓位收敛（映射导入 -> mapping-drill -> repair-by-mapping -> 再巡检）
missing_inputs:
- 业务侧映射数据（至少包含 `sku_code + source_note -> warehouse_code + location_code`）
- 映射导入批次标识与执行责任人信息（用于留痕与回滚）
blocking_reasons:
- 当前默认仓位占比 `100.0000%`，发布门禁阻断。
- 无业务映射输入时，执行修复脚本无法将默认仓位库存迁移到真实仓位。
- 收敛门禁检查结果：`active_non_default_warehouses=0`、`active_non_default_locations=0`、`mapping_csv_filled_rows=0`。
handoff_to:
- senior-ai-agent-pm
- devops-engineer
next_action:
- 上游补齐映射 CSV 后，按以下顺序恢复执行：
  0. 参考模板：`docs/v3/sql/inventory-location-mapping-template.csv`
  0.1 候选数据可由脚本导出：`./scripts/export-inventory-location-mapping-candidates.sh`
  0.2 先执行门禁检查：`./scripts/check-inventory-warehouse-remediation-readiness.sh <mapping_csv>`
  1. 校验/导入映射：`./scripts/import-inventory-location-mappings.sh <mapping_csv> --apply`
  2. 一键执行收敛链路：`./scripts/run-inventory-warehouse-remediation.sh <mapping_csv>`
  3. 审核巡检结果：`docs/v3/release-logs/inventory-warehouse/remediation-*/audit/metrics.tsv`
  4. 仅当 `default_ratio_verdict=PASS` 时解除发布阻断
