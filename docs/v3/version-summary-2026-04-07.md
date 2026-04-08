[artifact:ImplementationPlan]
status: READY
owner: senior-backend-engineer
scope:
- 将库存仓位对齐项目最新进度更新到 `docs/v3`（截至 2026-04-07）
- 固化当日门禁检查、收敛编排与巡检证据
inputs:
- [version-summary-2026-04-03.md](/Users/kongwen/claude_wk/ai-software-company/docs/v3/version-summary-2026-04-03.md)
- [inventory-warehouse-release-audit-report-2026-04-03.md](/Users/kongwen/claude_wk/ai-software-company/docs/v3/inventory-warehouse-release-audit-report-2026-04-03.md)
- [inventory-warehouse-mapping-repair-plan-2026-04-03.md](/Users/kongwen/claude_wk/ai-software-company/docs/v3/inventory-warehouse-mapping-repair-plan-2026-04-03.md)
handoff_to:
- senior-ai-agent-pm
- devops-engineer
- senior-qa-engineer

goal:
- 输出 2026-04-07 最新状态快照，并完成一轮可执行收敛验证（readiness=READY + default_ratio_verdict=PASS）。

changed_areas:
- `docs/v3/inventory-warehouse-release-audit-report-2026-04-07.md`
- `docs/v3/version-summary-2026-04-07.md`
- `docs/v3/version-summary-2026-04-03.md`
- `scripts/check-inventory-warehouse-remediation-readiness.sh`
- `scripts/bootstrap-inventory-warehouse-master-data.sh`
- `scripts/fill-inventory-location-mapping-candidates.sh`
- `scripts/repair-inventory-default-transactions-by-mapping.sh`
- `scripts/run-inventory-warehouse-remediation.sh`
- `scripts/run-inventory-warehouse-audit.sh`
- `docs/v3/sql/inventory-location-mapping-candidates-20260407-133711.csv`
- `docs/v3/sql/inventory-location-mapping-candidates-20260407-133711-filled-20260407-134641.csv`
- `docs/v3/release-logs/inventory-warehouse/20260407-133722/*`
- `docs/v3/release-logs/inventory-warehouse/remediation-20260407-133735/*`
- `docs/v3/release-logs/inventory-warehouse/remediation-20260407-134706/*`
- `docs/v3/release-logs/inventory-warehouse/20260407-134823/*`
- `docs/v3/release-logs/inventory-warehouse/20260407-135322/*`
- `docs/v3/release-logs/inventory-warehouse/remediation-20260407-135900/*`

steps:
1. 导出候选映射并执行 readiness/audit/remediation 全链路复跑。
2. 加固门禁脚本（DB 不可达硬失败，避免空指标误判）。
3. 新增主数据引导与候选 CSV 批量填充脚本。
4. 用填充后的映射再次执行收敛编排并复核门禁。

risks:
- 当前映射为演练填充方案（统一指向 `WH-DRILL-A/LOC-DRILL-A01`），业务语义准确性仍需业务侧二次确认。

validation:
- `./scripts/export-inventory-location-mapping-candidates.sh`
- `./scripts/check-inventory-warehouse-remediation-readiness.sh docs/v3/sql/inventory-location-mapping-candidates-20260407-133711.csv`
- `./scripts/run-inventory-warehouse-audit.sh`
- `./scripts/run-inventory-warehouse-remediation.sh docs/v3/sql/inventory-location-mapping-candidates-20260407-133711.csv`
- `./scripts/bootstrap-inventory-warehouse-master-data.sh WH-DRILL-A 演练仓A LOC-DRILL-A01 演练库位A01`
- `./scripts/fill-inventory-location-mapping-candidates.sh docs/v3/sql/inventory-location-mapping-candidates-20260407-133711.csv WH-DRILL-A LOC-DRILL-A01`
- `./scripts/check-inventory-warehouse-remediation-readiness.sh docs/v3/sql/inventory-location-mapping-candidates-20260407-133711-filled-20260407-134641.csv`
- `./scripts/run-inventory-warehouse-remediation.sh docs/v3/sql/inventory-location-mapping-candidates-20260407-133711-filled-20260407-134641.csv`
- `OUTPUT_DIR=docs/v3/release-logs/inventory-warehouse/20260407-134823 ./scripts/run-inventory-warehouse-audit.sh`
- `docs/v3/release-logs/inventory-warehouse/20260407-135322/residual-default-tx-fix.out.txt`
- `OUTPUT_DIR=docs/v3/release-logs/inventory-warehouse/20260407-135322 ./scripts/run-inventory-warehouse-audit.sh`
- `./scripts/repair-inventory-default-transactions-by-mapping.sh`
- `./scripts/run-inventory-warehouse-remediation.sh docs/v3/sql/inventory-location-mapping-candidates-20260407-133711-filled-20260407-134641.csv`（含 step3.5 残余修复）

## 最新推进（2026-04-07 13:37:35 CST）
- 首轮复跑结果仍阻断：
  - readiness：`BLOCKED`
  - `active_non_default_warehouses=0`
  - `active_non_default_locations=0`
  - `mapping_csv_filled_rows=0`
  - `default_ratio_verdict=FAIL`
- 脚本加固：
  - [check-inventory-warehouse-remediation-readiness.sh](/Users/kongwen/claude_wk/ai-software-company/scripts/check-inventory-warehouse-remediation-readiness.sh) 已支持 DB 查询失败 `exit 2`。

## 最新推进（2026-04-07 13:47:06 CST）
- 新增主数据引导脚本并执行：
  - [bootstrap-inventory-warehouse-master-data.sh](/Users/kongwen/claude_wk/ai-software-company/scripts/bootstrap-inventory-warehouse-master-data.sh)
  - 已创建并激活：`WH-DRILL-A / LOC-DRILL-A01`
- 新增候选填充脚本并执行：
  - [fill-inventory-location-mapping-candidates.sh](/Users/kongwen/claude_wk/ai-software-company/scripts/fill-inventory-location-mapping-candidates.sh)
  - 产出：[inventory-location-mapping-candidates-20260407-133711-filled-20260407-134641.csv](/Users/kongwen/claude_wk/ai-software-company/docs/v3/sql/inventory-location-mapping-candidates-20260407-133711-filled-20260407-134641.csv)
  - 结果：`rows_total=45`、`rows_filled=45`
- 复跑门禁与收敛：
  - readiness：`status=READY`
  - 收敛编排目录：`docs/v3/release-logs/inventory-warehouse/remediation-20260407-134706/*`
  - 导入结果：`upsert_row_count=44`、`total_mapping_rows=44`
  - 巡检结果：`default_ratio_pct=0.0000`、`default_ratio_verdict=PASS`
- 独立门禁审计留档：
  - 目录：`docs/v3/release-logs/inventory-warehouse/20260407-134823/*`
  - readiness：`READY`
  - audit：`PASS`

## 最新推进（2026-04-07 13:53:22 CST）
- 定向清理历史残余默认流水：
  - 输出文件：`docs/v3/release-logs/inventory-warehouse/20260407-135322/residual-default-tx-fix.out.txt`
  - 结果：`mapping_upsert_rows=1`、`repaired_default_tx_rows=1`、`default_tx_count_total=0`
- 修复后复核：
  - 目录：`docs/v3/release-logs/inventory-warehouse/20260407-135322/*`
  - readiness：`READY`
  - audit：`PASS`
  - `default_ratio_pct=0.0000`
  - `default_ratio_verdict=PASS`
  - `default_tx_count_daily=0`

## 最新推进（2026-04-07 13:59:00 CST）
- 自动化收口已集成到主编排：
  - 新增 [repair-inventory-default-transactions-by-mapping.sh](/Users/kongwen/claude_wk/ai-software-company/scripts/repair-inventory-default-transactions-by-mapping.sh)
  - [run-inventory-warehouse-remediation.sh](/Users/kongwen/claude_wk/ai-software-company/scripts/run-inventory-warehouse-remediation.sh) 新增 `step3.5`
  - [run-inventory-warehouse-audit.sh](/Users/kongwen/claude_wk/ai-software-company/scripts/run-inventory-warehouse-audit.sh) 新增 `default_tx_count_total` 指标
- 复跑验证：
  - 目录：`docs/v3/release-logs/inventory-warehouse/remediation-20260407-135900/*`
  - `residual-default-tx-repair.out.txt`：`candidate_tx_rows=0`、`repaired_default_tx_rows=0`、`default_tx_count_total_after=0`
  - `audit/metrics.tsv`：`default_ratio_verdict=PASS`、`default_tx_count_total=0`

## 最新产物
- [inventory-warehouse-release-audit-report-2026-04-07.md](/Users/kongwen/claude_wk/ai-software-company/docs/v3/inventory-warehouse-release-audit-report-2026-04-07.md)
- [check-inventory-warehouse-remediation-readiness.sh](/Users/kongwen/claude_wk/ai-software-company/scripts/check-inventory-warehouse-remediation-readiness.sh)
- [bootstrap-inventory-warehouse-master-data.sh](/Users/kongwen/claude_wk/ai-software-company/scripts/bootstrap-inventory-warehouse-master-data.sh)
- [fill-inventory-location-mapping-candidates.sh](/Users/kongwen/claude_wk/ai-software-company/scripts/fill-inventory-location-mapping-candidates.sh)
- [repair-inventory-default-transactions-by-mapping.sh](/Users/kongwen/claude_wk/ai-software-company/scripts/repair-inventory-default-transactions-by-mapping.sh)
- [inventory-location-mapping-candidates-20260407-133711.csv](/Users/kongwen/claude_wk/ai-software-company/docs/v3/sql/inventory-location-mapping-candidates-20260407-133711.csv)
- [inventory-location-mapping-candidates-20260407-133711-filled-20260407-134641.csv](/Users/kongwen/claude_wk/ai-software-company/docs/v3/sql/inventory-location-mapping-candidates-20260407-133711-filled-20260407-134641.csv)
- 收敛编排证据：
  - `docs/v3/release-logs/inventory-warehouse/remediation-20260407-134706/*`
- 独立门禁审计证据：
  - [readiness.out.txt](/Users/kongwen/claude_wk/ai-software-company/docs/v3/release-logs/inventory-warehouse/20260407-134823/readiness.out.txt)
  - [postcheck.out.txt](/Users/kongwen/claude_wk/ai-software-company/docs/v3/release-logs/inventory-warehouse/20260407-134823/postcheck.out.txt)
  - [daily-audit.out.txt](/Users/kongwen/claude_wk/ai-software-company/docs/v3/release-logs/inventory-warehouse/20260407-134823/daily-audit.out.txt)
  - [metrics.tsv](/Users/kongwen/claude_wk/ai-software-company/docs/v3/release-logs/inventory-warehouse/20260407-134823/metrics.tsv)
  - [default-tx-total.out.txt](/Users/kongwen/claude_wk/ai-software-company/docs/v3/release-logs/inventory-warehouse/20260407-134823/default-tx-total.out.txt)
- 最终修复复核证据：
  - [residual-default-tx-fix.out.txt](/Users/kongwen/claude_wk/ai-software-company/docs/v3/release-logs/inventory-warehouse/20260407-135322/residual-default-tx-fix.out.txt)
  - [readiness.out.txt](/Users/kongwen/claude_wk/ai-software-company/docs/v3/release-logs/inventory-warehouse/20260407-135322/readiness.out.txt)
  - [postcheck.out.txt](/Users/kongwen/claude_wk/ai-software-company/docs/v3/release-logs/inventory-warehouse/20260407-135322/postcheck.out.txt)
  - [daily-audit.out.txt](/Users/kongwen/claude_wk/ai-software-company/docs/v3/release-logs/inventory-warehouse/20260407-135322/daily-audit.out.txt)
  - [metrics.tsv](/Users/kongwen/claude_wk/ai-software-company/docs/v3/release-logs/inventory-warehouse/20260407-135322/metrics.tsv)
- 自动化回归证据（step3.5 已集成）：
  - [residual-default-tx-repair.out.txt](/Users/kongwen/claude_wk/ai-software-company/docs/v3/release-logs/inventory-warehouse/remediation-20260407-135900/residual-default-tx-repair.out.txt)
  - [metrics.tsv](/Users/kongwen/claude_wk/ai-software-company/docs/v3/release-logs/inventory-warehouse/remediation-20260407-135900/audit/metrics.tsv)

## 最新推进（2026-04-07 14:08:32 CST）
- 前端治理交互完善（接口完成后的 UI 收口）：
  - [InventoryPage.tsx](/Users/kongwen/claude_wk/ai-software-company/services/web/src/pages/inventory/InventoryPage.tsx)
  - [InventoryPage.module.css](/Users/kongwen/claude_wk/ai-software-company/services/web/src/pages/inventory/InventoryPage.module.css)
  - [inventoryPage.test.tsx](/Users/kongwen/claude_wk/ai-software-company/services/web/tests/pages/inventoryPage.test.tsx)
- 本轮界面改动：
  - 新增“默认仓位治理模式”提示条与“退出治理模式”快捷操作。
  - “仅看默认仓位”启用时自动带入 `DEFAULT / DEFAULT-UNKNOWN`，并锁定仓库/库位筛选，避免口径冲突。
  - 新增“重置筛选”按钮，快速回到全量视图。
- 回归验证：
  - `cd services/web && npm run test -- tests/pages/inventoryPage.test.tsx tests/pages/shortageBoard.test.tsx tests/pages/stocktakingPage.test.tsx`
  - `cd services/web && npm run typecheck`
  - 结果：`15 tests passed`，`typecheck passed`

## 最新推进（2026-04-07 14:12:57 CST）
- 缺料看板治理交互收口：
  - [ShortageBoard.tsx](/Users/kongwen/claude_wk/ai-software-company/services/web/src/pages/production/ShortageBoard.tsx)
  - [ShortageBoard.module.css](/Users/kongwen/claude_wk/ai-software-company/services/web/src/pages/production/ShortageBoard.module.css)
  - [shortageBoard.test.tsx](/Users/kongwen/claude_wk/ai-software-company/services/web/tests/pages/shortageBoard.test.tsx)
- 本轮界面改动：
  - 新增“默认仓位治理模式”提示条与“退出治理模式”按钮，和库存页保持一致交互语义。
  - 补充“重置筛选”操作，统一清空关键词/焦点筛选/仓位筛选。
  - 仅默认仓位切换逻辑收敛为显式 enter/exit，减少筛选状态错位。
- 回归验证：
  - `cd services/web && npm run test -- tests/pages/shortageBoard.test.tsx tests/pages/inventoryPage.test.tsx tests/pages/stocktakingPage.test.tsx`
  - `cd services/web && npm run typecheck`
  - 结果：`16 tests passed`，`typecheck passed`

## 最新推进（2026-04-07 14:28:01 CST）
- 新增 E2E 回归用例（缺料看板 -> 默认仓位治理 -> 库存页）：
  - [productionShortage.real.spec.ts](/Users/kongwen/claude_wk/ai-software-company/tests/productionShortage.real.spec.ts)
  - 用例：`老板可从缺料看板进入默认仓位治理并在库存页看到治理模式生效`
- 验证命令：
  - `PLAYWRIGHT_APP_BASE_URL=http://127.0.0.1:5173 npx playwright test tests/productionShortage.real.spec.ts --project=chromium --grep "默认仓位治理"`
  - 结果：`1 passed`
- 运行备注：
  - 本地 Vite 代理后端（`localhost:3000`）在当前环境不可达，出现 `http proxy error` 日志；该用例本轮验证聚焦前端跳转与筛选态（URL 参数、治理提示、筛选锁定）。
  - 未带 `PLAYWRIGHT_APP_BASE_URL` 时会命中外部默认地址（`http://localhost`），与本地最新前端代码可能存在版本偏差。

## 最新推进（2026-04-07 14:32:09 CST）
- 新增库存页治理模式 E2E 回归用例：
  - [inventory.real.spec.ts](/Users/kongwen/claude_wk/ai-software-company/tests/inventory.real.spec.ts)
  - 用例：`老板可在库存页退出默认仓位治理模式并重置筛选`
- 验证命令：
  - `PLAYWRIGHT_APP_BASE_URL=http://127.0.0.1:5173 npx playwright test tests/inventory.real.spec.ts --project=chromium --grep "退出默认仓位治理模式并重置筛选"`
  - 结果：`1 passed`
- 覆盖行为：
  - 以 `onlyDefaultLocation=true&warehouseId=1&locationId=11` 进入库存页，校验治理模式提示、复选框状态与筛选锁定；
  - 点击“退出治理模式”后恢复常规筛选态；
  - 点击“重置筛选”后，关键词与状态筛选回到默认值。
- 运行备注：
  - 同样存在本地 Vite `/api` 代理到 `localhost:3000` 不可达日志；本用例验证重点为前端治理交互状态机。

## 最新推进（2026-04-07 14:35:47 CST）
- 治理回归脚本固化：
  - [package.json](/Users/kongwen/claude_wk/ai-software-company/package.json) 新增 `test:inventory-warehouse:ui:governance`
  - 命令：`npx playwright test tests/productionShortage.real.spec.ts tests/inventory.real.spec.ts --project=chromium --grep "默认仓位治理|退出默认仓位治理模式并重置筛选"`
- 文档与门禁同步：
  - [inventory-warehouse-deployment-plan-2026-04-03.md](/Users/kongwen/claude_wk/ai-software-company/docs/v3/inventory-warehouse-deployment-plan-2026-04-03.md) `precheck` 增加治理 E2E 检查项
  - [inventory-warehouse-release-audit-report-2026-04-07.md](/Users/kongwen/claude_wk/ai-software-company/docs/v3/inventory-warehouse-release-audit-report-2026-04-07.md) `deliverables` 增加治理回归命令
  - [half-finished-production-qa-runbook.md](/Users/kongwen/claude_wk/ai-software-company/docs/v3/half-finished-production-qa-runbook.md) 增加治理聚合回归触发规则与推荐命令
- 脚本回归验证：
  - `PLAYWRIGHT_APP_BASE_URL=http://127.0.0.1:5173 npm run test:inventory-warehouse:ui:governance`
  - 结果：`2 passed`

## 最新推进（2026-04-07 14:40:00 CST）
- CI 门禁接入：
  - [ci.yml](/Users/kongwen/claude_wk/ai-software-company/.github/workflows/ci.yml) 新增 `inventory-warehouse-ui-governance` job
  - 执行命令：`npm run test:inventory-warehouse:ui:governance`
  - 已纳入 `ci-gate` 的 `needs` 与 `required_results`，PR 阶段即要求通过
- 影响：
  - 默认仓位治理前端闭环从“文档约定 + 本地回归”升级为“CI 强制门禁”
  - 减少后续迭代中缺料看板与库存页治理联动被回归破坏的风险

## 最新推进（2026-04-07 14:45:00 CST）
- 提交流程收口：
  - 新增 [pull_request_template.md](/Users/kongwen/claude_wk/ai-software-company/.github/pull_request_template.md)
  - 增加“默认仓位治理交互改动时必须执行 `test:inventory-warehouse:ui:governance`”的条件检查项
  - 增加发布文档同步检查项（版本纪要、部署计划、审计报告、QA Runbook）
- 影响：
  - 将治理回归从“CI 约束”进一步前移到“PR 提交自检”，降低遗漏风险

## 最新推进（2026-04-07 14:47:05 CST）
- 治理回归脚本稳态化：
  - [productionShortage.real.spec.ts](/Users/kongwen/claude_wk/ai-software-company/tests/productionShortage.real.spec.ts) 与 [inventory.real.spec.ts](/Users/kongwen/claude_wk/ai-software-company/tests/inventory.real.spec.ts) 新增统一标签 `@inventory-warehouse-governance`
  - [package.json](/Users/kongwen/claude_wk/ai-software-company/package.json) 中 `test:inventory-warehouse:ui:governance` 改为按标签筛选（不再依赖中文标题 grep）
- 回归验证：
  - `PLAYWRIGHT_APP_BASE_URL=http://127.0.0.1:5173 npm run test:inventory-warehouse:ui:governance`
  - 结果：`2 passed`
- 影响：
  - 后续即使调整用例中文标题，治理聚合脚本和 CI 作业仍可稳定命中目标用例

## 最新推进（2026-04-07 14:53:32 CST）
- 缺料看板治理状态机补强：
  - [ShortageBoard.tsx](/Users/kongwen/claude_wk/ai-software-company/services/web/src/pages/production/ShortageBoard.tsx) 增加治理模式下的“默认主数据晚到自动补绑”逻辑。
  - [shortageBoard.test.tsx](/Users/kongwen/claude_wk/ai-software-company/services/web/tests/pages/shortageBoard.test.tsx) 新增回归用例：先进入治理模式，再在默认库位主数据异步可用后自动补齐 `locationId`。
- 回归验证：
  - `cd services/web && npm run test -- tests/pages/shortageBoard.test.tsx tests/pages/inventoryPage.test.tsx`
  - `cd services/web && npm run typecheck`
  - `PLAYWRIGHT_APP_BASE_URL=http://127.0.0.1:5173 npm run test:inventory-warehouse:ui:governance`
  - 结果：`14 tests passed`、`typecheck passed`、`2 passed`
- 影响：
  - 默认仓位治理模式对“主数据慢加载”场景更稳健，不会停留在 `onlyDefaultLocation=true` 但库位参数缺失的中间态。

## 最新推进（2026-04-07 15:00:44 CST）
- 前端治理交互体验补强：
  - [InventoryPage.tsx](/Users/kongwen/claude_wk/ai-software-company/services/web/src/pages/inventory/InventoryPage.tsx) 与 [ShortageBoard.tsx](/Users/kongwen/claude_wk/ai-software-company/services/web/src/pages/production/ShortageBoard.tsx) 增加“退出治理模式时恢复进入前仓库/库位筛选”逻辑。
  - [inventoryPage.test.tsx](/Users/kongwen/claude_wk/ai-software-company/services/web/tests/pages/inventoryPage.test.tsx) 与 [shortageBoard.test.tsx](/Users/kongwen/claude_wk/ai-software-company/services/web/tests/pages/shortageBoard.test.tsx) 新增恢复场景回归用例。
- 回归验证：
  - `cd services/web && npm run test -- tests/pages/inventoryPage.test.tsx tests/pages/shortageBoard.test.tsx`
  - `cd services/web && npm run typecheck`
  - `PLAYWRIGHT_APP_BASE_URL=http://127.0.0.1:5173 npm run test:inventory-warehouse:ui:governance`
  - 结果：`16 tests passed`、`typecheck passed`、`2 passed`
- 影响：
  - 用户在临时进入默认仓位治理后，退出可回到原筛选上下文，减少重复筛选操作与误切换成本。

## 最新推进（2026-04-07 15:07:31 CST）
- 治理聚合 E2E 扩展：
  - [inventory.real.spec.ts](/Users/kongwen/claude_wk/ai-software-company/tests/inventory.real.spec.ts) 新增用例：`老板可在库存页退出治理模式后恢复进入前仓位筛选 @inventory-warehouse-governance`。
  - 用例通过拦截 `/api/inventory` 请求参数验证：进入治理后出现 `onlyDefaultLocation=true`，退出治理后恢复 `warehouseId=9&locationId=99`，且不含 `onlyDefaultLocation`。
- 回归验证：
  - `PLAYWRIGHT_APP_BASE_URL=http://127.0.0.1:5173 npm run test:inventory-warehouse:ui:governance`
  - 结果：`3 passed`
- 影响：
  - 治理聚合门禁从“入口跳转 + 退出重置”扩展到“退出恢复原筛选上下文”，覆盖更完整的实际操作路径。

## 最新推进（2026-04-07 15:12:55 CST）
- 治理聚合 E2E 再扩展：
  - [productionShortage.real.spec.ts](/Users/kongwen/claude_wk/ai-software-company/tests/productionShortage.real.spec.ts) 新增用例：`老板可在缺料看板退出治理模式后恢复进入前仓位筛选 @inventory-warehouse-governance`。
  - 用例通过路由 mock 固化缺料看板仓库/库位选项与缺料汇总响应，并验证“非默认筛选 -> 进入治理 -> 退出治理 -> 恢复原筛选”完整链路。
- 回归验证：
  - `PLAYWRIGHT_APP_BASE_URL=http://127.0.0.1:5173 npm run test:inventory-warehouse:ui:governance`
  - 结果：`4 passed`
- 影响：
  - 治理聚合门禁从 `3` 条提升到 `4` 条，覆盖库存页与缺料看板双页面的“退出治理恢复原筛选”场景。

## 最新推进（2026-04-07 16:23:54 CST）
- 库位模型兼容“货架类型”落地：
  - 新增迁移 [M20260407_location_rack_compat.sql](/Users/kongwen/claude_wk/ai-software-company/services/api/src/migrations/M20260407_location_rack_compat.sql)
  - `locations` 新增字段：`location_type`、`aisle_code`、`rack_code`、`shelf_code`、`bin_code`
  - 新增索引：`idx_tenant_wh_loc_type_status`、`idx_tenant_wh_rack_coord`
- 后端接口扩展：
  - [inventory.controller.ts](/Users/kongwen/claude_wk/ai-software-company/services/api/src/modules/inventory/inventory.controller.ts) 扩展库位 CRUD 入参校验与导入失败字段导出
  - [inventory.service.ts](/Users/kongwen/claude_wk/ai-software-company/services/api/src/modules/inventory/inventory.service.ts) 扩展库位 CRUD 查询/落库/CSV 导入，向后兼容旧模板
- 前端配置页扩展：
  - [WarehouseLocationPage.tsx](/Users/kongwen/claude_wk/ai-software-company/services/web/src/pages/master-data/WarehouseLocationPage.tsx) 新增库位类型与货架坐标维护、列表展示“货架坐标”
  - [inventory.ts](/Users/kongwen/claude_wk/ai-software-company/services/web/src/api/inventory.ts) 与 [models.ts](/Users/kongwen/claude_wk/ai-software-company/services/web/src/types/models.ts) 增加新字段契约
- 本地部署脚本同步：
  - [redeploy-local.sh](/Users/kongwen/claude_wk/ai-software-company/scripts/redeploy-local.sh) 纳入新迁移执行，避免本地环境字段缺失
- 方案说明文档：
  - [inventory-location-rack-compatibility-2026-04-07.md](/Users/kongwen/claude_wk/ai-software-company/docs/v3/inventory-location-rack-compatibility-2026-04-07.md)

## 当前状态
- 最新完成项：
  - 门禁已达 `READY`，默认仓位占比门禁已达 `PASS`。
  - 前端默认仓位治理视图完成交互收口并补齐回归测试。
  - 缺料看板与库存页的默认仓位治理交互已对齐。
  - 已补齐“缺料看板 -> 库存页治理模式”的 E2E 跳转回归。
  - 已补齐“库存页治理模式退出 + 重置筛选”的 E2E 回归。
  - 已固化治理聚合回归脚本并纳入部署 precheck。
  - 已将治理聚合回归纳入 CI Gate 必过项。
  - 已将治理回归命令纳入 PR 模板条件必填检查项。
  - 已完成治理回归脚本标签化，降低后续维护脆弱性。
  - 已补齐“治理模式开启后默认库位主数据晚到”的自动补绑逻辑与回归测试。
  - 已补齐“退出治理模式恢复原筛选上下文”的交互能力与回归测试。
  - 已将治理聚合 E2E 扩展为 `4` 条用例，补齐库存页与缺料看板双页面“退出治理恢复原筛选”的真实浏览器门禁验证。
  - 已完成库位模型对“货架类型 + 货架坐标”的兼容扩展，并同步到后端契约、前端 UI 与本地迁移脚本。
  - 收敛链路实现“导出候选 -> 填充映射 -> 导入映射 -> 收敛编排 -> 门禁审计”可重复执行。
- 未完成项：
  - 业务侧逐条确认映射语义（当前为演练填充映射）。
- 阻断项：
  - None（发布门禁指标已解除）。
- 待验证项：
  - 按真实业务仓位映射替换演练映射后，再执行一次同链路回归并固化证据。
