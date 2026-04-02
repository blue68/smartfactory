[artifact:FrontendCode]
status: READY
owner: senior-frontend-engineer
scope:
- 工资报表页接入任务报工只读视图
- 库存页接入日结库存快照只读卡片
inputs:
- [artifact:ImplementationPlan]
- [artifact:Approval]
- [artifact:APIDoc]
- `services/web/src/pages/report/WageReportPage.tsx`
- `services/web/src/pages/inventory/InventoryPage.tsx`
handoff_to:
- code-reviewer
- senior-qa-engineer

deliverables:
- 工资报表页在现有“日工资明细”tab 内新增“工资汇总 / 任务报工”二级切换
- 任务报工视图已接 `GET /api/reports/wages/tasks`，展示日期、工单号、任务号、工人、工序、完成数、合格数、不良数、工时、单价、小计
- 任务报工视图补充工单 ID / 任务 ID 只读筛选（输入与查询分离，支持清空），并在表格区域显式提示“任务报工口径来自已确认报工记录”
- 库存页在 Summary Bar 下新增“日结库存快照”只读卡片，已接 `GET /api/inventory/daily-snapshots`
- 日结库存快照卡片已拆分为独立关键词筛选与独立分页，并在标题中显式展示当前快照日期
- API 层与前端类型已补齐任务报工、日结快照的 query key、hook 与模型声明
- 前端 lint 门禁已进一步收敛为 `0 error / 0 warnings`

risks:
- 日结库存卡片当前同步的是关键词与日期，不包含分类/状态等实时库存筛选口径
handoff_to:
- code-reviewer
- senior-qa-engineer
exit_criteria:
- 两处只读前端切片已可在现有页面结构中使用

changed_files:
- `docs/v3/half-finished-production-frontend-readonly-design.md`
- `docs/v3/half-finished-production-frontend-readonly-approval.md`
- `docs/v3/half-finished-production-frontend-readonly-plan.md`
- `services/web/.eslintrc.cjs`
- `services/web/package.json`
- `services/web/src/api/wageReport.ts`
- `services/web/src/api/wage.ts`
- `services/web/src/api/inventory.ts`
- `services/web/src/types/models.ts`
- `services/web/src/pages/ai/AiChatPage.tsx`
- `services/web/src/pages/report/WageReportPage.tsx`
- `services/web/src/pages/inventory/InventoryPage.tsx`
- `services/web/src/pages/inventory/InventoryPage.module.css`
- `services/web/src/pages/master-data/ProcessConfigPage.tsx`
- `services/web/src/pages/master-data/SupplierPage.tsx`
- `services/web/src/pages/production/ProductionOrderPage.tsx`
- `services/web/src/pages/production/SchedulePage.tsx`
- `services/web/src/pages/production/TaskPage.tsx`
- `services/web/src/pages/purchase/IncomingInspectionPage.tsx`
- `services/web/src/pages/purchase/PricePage.tsx`
- `services/web/src/pages/purchase/PurchaseDeliveryPage.tsx`
- `services/web/src/pages/purchase/PurchaseOrderPage.tsx`
- `services/web/src/pages/purchase/PurchaseReceiptPage.tsx`
- `services/web/src/pages/purchase/PurchaseSettlementPage.tsx`
- `services/web/src/pages/purchase/ReturnOrderPage.tsx`
- `services/web/src/pages/settlement/SettlementPage.tsx`
- `services/web/tests/api/wageReport.test.ts`
- `services/web/tests/api/inventory.test.ts`
- `services/web/tests/api/skuCategory.test.ts`
- `services/web/tests/pages/wageReportPage.test.tsx`
- `services/web/tests/pages/inventoryPage.test.tsx`

contracts_affected:
- `GET /api/reports/wages/tasks`
- `GET /api/inventory/daily-snapshots`
- 前端数据契约：`WageTaskReportRow`
- 前端数据契约：`DailyInventorySnapshotItem`

tests_run:
- `cd services/web && npm run build`
- `cd services/web && npm run typecheck`
- `cd services/web && npx tsc --noEmit --pretty false 2>&1 | rg "WageReportPage|InventoryPage|api/wageReport|api/inventory|types/models"`（无命中，说明本次改动文件未新增 TS 错误）
- `docker compose up -d --build web`
- Playwright 浏览器联调：`/report/wages` 已验证“工资汇总 / 任务报工”二级切换、任务报工表头与真实任务数据渲染
- Playwright 浏览器联调：`/inventory` 已验证“日结库存快照”卡片加载、按 `snapshotDate` 请求接口，以及空态文案展示
- 评审后回归：`cd services/web && npm run typecheck`
- 评审后回归：`cd services/web && npm run build`
- 评审后浏览器复核：`/report/wages` 任务视图文案已更新为“本页工时 / 本页产量 / 本页工资”
- 后续项回归：`cd services/web && npm run typecheck`
- 后续项回归：`cd services/web && npm run build`
- 后续项回归：`cd services/web && npm run lint`（已恢复并收敛至 0 error / 0 warnings）
- 后续项回归：`/report/wages` 已验证任务筛选“输入/查询/清空”与回车触发行为
- 后续项回归：`cd services/web && npx vitest run tests/api/wageReport.test.ts tests/api/inventory.test.ts`（2 files / 8 tests passed）
- 后续项回归：`cd services/web && npx vitest run tests/api/wageReport.test.ts tests/api/inventory.test.ts tests/pages/wageReportPage.test.tsx tests/pages/inventoryPage.test.tsx`（4 files / 11 tests passed）
- 后续项回归：`cd services/web && npx vitest run tests/api/wageReport.test.ts tests/api/inventory.test.ts tests/pages/wageReportPage.test.tsx tests/pages/inventoryPage.test.tsx`（4 files / 16 tests passed，已覆盖任务报工与日结快照的加载/空态/错误态）
- 后续项回归：`cd services/web && npm run typecheck`
- 后续项回归：`cd services/web && npm run build`
- 后续项回归：`cd services/web && npx vitest run tests/api/skuCategory.test.ts`（1 file / 21 tests passed，已对齐 `PATCH /api/sku-categories/:id`）
- 后续项回归：`cd services/web && npx vitest run tests/pages/wageReportPage.test.tsx tests/pages/inventoryPage.test.tsx`（2 files / 10 tests passed，已覆盖回车触发与清空回退）
- 后续项回归：`cd services/web && npm test`（7 files / 101 tests passed）
- 后续项回归：`cd services/web && npm run typecheck`
- 后续项回归：`cd services/web && npm run build`

known_issues:
- `vite build` 仍提示主 chunk 超过 500kB，当前不阻断发布，但需后续拆包
