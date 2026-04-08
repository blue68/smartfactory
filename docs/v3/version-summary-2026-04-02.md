## Version Summary — 2026-04-02

1. **Scope**
   - Continued from `docs/v3/version-summary-2026-04-01.md`, `docs/v3/half-finished-production-qa-runbook.md`, and `docs/test-report.md`.
   - Promoted the previously hidden frontend Playwright browser suites into explicit QA entrypoints, and aligned outdated tests with the current UI contract.

2. **Frontend Browser QA Entry**
   - Added root scripts for mock-browser Playwright coverage:
     - `npm run test:web:ui:mock`
     - `npm run test:web:ui:settlement`
     - `npm run test:web:ui:sales-order`
     - `npm run test:web:ui:purchase-delivery`
     - `npm run test:web:ui:process-config`
   - Kept the existing purchase real-backend browser entrypoints (`test:purchase:ui:*`) unchanged, so the QA ladder is now:
     - frontend unit/page tests
     - frontend mock-browser Playwright
     - frontend real-backend Playwright
     - backend integration/e2e
     - deployment smoke

3. **Playwright Regression Alignment**
   - Updated `tests/processConfig.spec.ts` to match the current “管理工作站” UI and mocked the workstation API dependency that the page now requests.
   - Updated `tests/purchaseDelivery.spec.ts` to reflect the current in-page modal workflow instead of the older URL-jump assumptions, and aligned the purchase order detail assertion with the current “履约进度” wording.
   - Confirmed that `tests/settlement.spec.ts` and `tests/salesOrder.spec.ts` remain valid against the current frontend implementation.

4. **Docs**
   - Expanded `docs/v3/half-finished-production-qa-runbook.md` to distinguish:
     - `playwright-ui-mock`
     - `playwright-ui-real`
     - managed backend integration/e2e
     - deployment smoke
   - Updated `docs/test-report.md` appendix commands so the frontend mock-browser scripts are now part of the standard execution reference, rather than undocumented repo knowledge.

5. **CI**
   - Added a dedicated `web-ui-mock` GitHub Actions job that installs root + `services/web` dependencies, installs Playwright Chromium, and runs the frontend mock-browser Playwright coverage.
   - Refined `web-ui-mock` from a single job into a per-spec matrix (`settlement` / `sales-order` / `purchase-delivery` / `process-config`), so CI can parallelize the browser regression without changing local developer commands.
   - Split purchase real-backend browser validation into `purchase-ui-smoke` and `purchase-ui-regression`, so PR 默认只挡 smoke，而 `develop` push 继续补跑 regression。
   - Updated `ci-gate` so core jobs still require `success`, while `purchase-ui-regression` is allowed to be `skipped` on non-`develop` pushes and PRs.
   - Wired `web-ui-mock` and `purchase-ui-smoke` into merge gating, keeping frontend browser regression as a first-class quality gate.
   - Extracted the repeated real-browser UI CI stack bootstrap into `scripts/prepare-real-browser-ui-ci.sh`, so the workflow no longer duplicates the CI `.env` template and local stack rebuild block.
   - Added the composite action `.github/actions/setup-real-browser-ui-ci/action.yml`, and switched the real-browser UI jobs to use it so the remaining install/bootstrap steps are no longer duplicated in workflow YAML.
   - Added the composite action `.github/actions/setup-web-ui-mock-ci/action.yml`, and switched `web-ui-mock` to use it so root/web dependency install plus Playwright browser setup are also pulled out of the workflow body.
   - Added the composite action `.github/actions/setup-api-managed-test-ci/action.yml`, and switched `api-integration` / `api-e2e` to use it so API dependency install plus test DB initialization are no longer duplicated in workflow YAML.
   - Added the reusable workflow `.github/workflows/real-browser-ui-playwright.yml`, and switched `purchase-ui-smoke` / `purchase-ui-regression` in the main CI file to thin wrappers that only pass command, artifact name, and gating conditions.
   - Added the reusable workflow `.github/workflows/api-managed-test.yml`, and switched `api-integration` / `api-e2e` in the main CI file to thin wrappers that only pass job name and managed test command.
   - Expanded CI path triggers from only `ci.yml` to `.github/workflows/**` and `.github/actions/**`, so changes to reusable workflows and composite actions will now correctly retrigger CI.

6. **Validation**
   - `cd services/web && npm run typecheck` passed.
   - `npx playwright test tests/settlement.spec.ts --project=chromium` passed: `7 tests`.
   - `npx playwright test tests/salesOrder.spec.ts --project=chromium` passed: `9 tests`.
   - `npm run test:web:ui:mock` passed: `28 tests`.
   - `npm run redeploy:local` passed.
   - `npm run test:production-task:ui:regression` passed: `1 test`.
   - `npm run test:production-task:ui` passed: `2 tests`.
   - `ruby -e "require 'yaml'; YAML.load_file('.github/workflows/ci.yml'); puts 'ci.yml ok'"` passed.

7. **Current State**
   - The QA runbook now covers both backend managed tests and frontend browser-level regression with explicit commands.
   - The mock-browser Playwright suites are no longer “best effort” or stale; they match the current UI contract, are runnable through package scripts, and are part of CI merge gating.
   - Purchase real-backend browser checks are also split by risk level: smoke for routine gating, regression for deeper `develop` verification.
   - CI setup reuse is now consistent across the main browser and backend managed-test paths, with composite actions handling repeated preparation blocks and reusable workflows handling the repeated purchase UI / API managed-test job skeletons.
   - Backend managed QA is now unified into `npm run test:api:integration` and `npm run test:api:e2e`, with the same runner shape used locally and in CI.
   - Frontend mock-browser Playwright is now a standard CI-gated layer for four suites: settlement, sales-order, purchase-delivery, and process-config.
   - Frontend real-browser Playwright now covers eleven business domains end to end:
     - purchase
     - incoming-inspection
     - sales-order
     - process-config
     - production-schedule
     - production-order
     - production-task
     - production-shortage
     - inventory
     - stocktaking
     - settlement
   - All eleven real-browser domains now have a smoke entrypoint, and the same eleven domains now also have `develop`-push regression entrypoints.
  - The production read-model browser coverage is no longer limited to a single page; schedule, order detail, task detail, and shortage board all now have smoke + regression depth.
  - Production-task regression now covers historical-compatible empty-state degradation, dependency unblock recovery, mixed wage-board plus exception-timeline states, and the supervisor-side start / complete / resolve-exception / suspend write paths inside the same real task-detail drawer flow.
  - Production-schedule regression now covers both supervisor-side adjustment persistence and confirm-to-task-generation write-through on the real scheduling page.
  - Production-order regression is no longer read-only: it now covers both the pending-order cancel path and manual create-from-sales-order on the real page, with DB-side status/material assertions.
  - Production-shortage regression now covers the boss-side “generate purchase suggestion for the current shortage order” write path directly from the live shortage board.
  - The purchase domain is no longer limited to the fulfillment chain: `purchaseFlow.real.spec.ts` still covers delivery / inspection / match / return / settlement, `incomingInspection.real.spec.ts` now covers the dedicated incoming-inspection page’s create-and-submit browser paths, and `purchaseSuggestion.real.spec.ts` covers the purchase-suggestion approval and convert-to-PO page.
  - The inventory domain is no longer limited to `/inventory`: `stocktaking.real.spec.ts` now covers the dedicated stocktaking page’s create-and-confirm browser paths, and also fixed the shipped frontend mismatches around stocktaking detail loading and confirm-button visibility.

**Addendum — Frontend Contract Closure**
- After this summary snapshot, the previously tracked frontend blocker contracts for notifications and quality traceability were also closed in code.
- Notifications now have a live SSE endpoint (`GET /api/notifications/stream`), and both Notification Center and Dashboard subscribe to it for unread-count and list invalidation.
- Quality traceability now returns `traceCompletionRate`, issue-level `productionOrderId/productionOrderNo`, and trace-level `aiAnalysis`, so the Trace page no longer depends on placeholder copy or warning toasts for those paths.
- The only item left as an optional follow-up from the older P1 contract gap note is a dedicated `purchase_suggestion.pending_changed` event; current implementation instead invalidates related Dashboard queries from the notification stream.

8. **Next Resume Point**
   - The highest-value next move is no longer more CI abstraction; it is adding another real-backend browser business flow, or deepening one of the newly covered production-domain flows.
  - Within the production domain, schedule / order / task / shortage are now all covered with real-browser smoke-regression layers; the next pragmatic move is outside production rather than adding a fifth production page immediately.
   - Outside the production domain, `incoming-inspection`, `purchase-suggestions`, and `stocktaking` are now covered; the next pragmatic move is extracting another backend-heavy page such as `return-order`, or deepening write coverage on an existing non-production page.

9. **Sales Order Real-Backend Playwright**
   - Added `tests/helpers/salesOrderFlow.ts` to seed a minimal tenant-9999 sales order fixture for real-browser validation, including customer / SKU / inventory / in-production sales order setup and cleanup helpers.
   - Added `tests/salesOrder.real.spec.ts` as a bounded real-backend smoke that authenticates as `boss`, opens `/sales/order-list`, executes `标记发货`, then executes `确认完成`, and verifies both UI state and DB state progression (`in_production -> shipped -> completed`, delivery `pending -> received`).
   - Added root scripts:
     - `npm run test:sales-order:ui`
     - `npm run test:sales-order:ui:smoke`
   - Updated the QA runbook and test report so the sales-order real-browser smoke is now an explicit standard entrypoint, not an undocumented local-only test.
   - Wired `sales-order-ui-smoke` into `.github/workflows/ci.yml` via the shared real-browser workflow, and added it to `ci-gate` so this new sales flow is now part of merge-blocking CI rather than local-only verification.

10. **CI Naming Cleanup**
   - Renamed the reusable real-browser CI pieces from purchase-specific names to shared UI names:
     - `scripts/prepare-real-browser-ui-ci.sh`
     - `.github/actions/setup-real-browser-ui-ci/action.yml`
     - `.github/workflows/real-browser-ui-playwright.yml`
   - Updated the main CI file so purchase UI and sales-order UI jobs now both point at the shared, accurately named real-browser workflow instead of a purchase-labeled wrapper.

11. **Sales Order Smoke / Regression Split**
   - Expanded `tests/salesOrder.real.spec.ts` from a single smoke into a layered sales-order real-browser suite:
     - `@sales-order-smoke`: full `in_production -> shipped -> completed` happy path
     - `@sales-order-regression`: includes the smoke path plus a “已有发货记录 + 剩余数量补发” 场景
   - Added `npm run test:sales-order:ui:regression` alongside the existing smoke/full commands.
   - Updated `.github/workflows/ci.yml` so:
     - `sales-order-ui-smoke` remains merge-gating in normal CI
     - `sales-order-ui-regression` runs on `develop` pushes, mirroring the purchase regression policy
     - `ci-gate` now validates both purchase and sales-order regression jobs with the same `success on develop / skipped elsewhere` rule.

12. **Process Config Real-Browser Smoke**
   - Added `tests/helpers/processConfigFlow.ts` and `tests/processConfig.real.spec.ts` as the third real-backend Playwright flow beyond purchase and sales-order.
   - The new smoke covers selecting a real process template, opening `管理工作站`, creating a workstation type, and creating a workstation against the live API / DB contract.
   - Added root scripts:
     - `npm run test:process-config:ui`
     - `npm run test:process-config:ui:smoke`
   - Wired `process-config-ui-smoke` into `.github/workflows/ci.yml` and `ci-gate`, so this flow is also merge-blocking instead of local-only.

13. **Settlement Real-Browser Smoke**
   - Added `tests/helpers/settlementFlow.ts` and `tests/settlement.real.spec.ts` as the fourth real-backend Playwright flow.
   - The new smoke covers boss access to `/settlement`, customer receivable summary rendering, and the live status transition `draft -> confirmed -> paid`.
   - Added root scripts:
     - `npm run test:settlement:ui`
     - `npm run test:settlement:ui:smoke`
   - Wired `settlement-ui-smoke` into `.github/workflows/ci.yml` and `ci-gate`, so settlement real-browser validation is also merge-blocking.

14. **Inventory Real-Browser Smoke**
   - Added `tests/helpers/inventoryFlow.ts` and `tests/inventory.real.spec.ts` as the fifth real-backend Playwright flow.
   - The new smoke covers `/inventory` live rendering, daily snapshot search, real transaction trace drawer, manual inbound, and the string `skuId` compatibility gap between inventory API payloads and browser-side mutation submission.
   - Added root scripts:
     - `npm run test:inventory:ui`
     - `npm run test:inventory:ui:smoke`
   - Updated `services/web/src/pages/inventory/InventoryPage.tsx` to normalize incoming `skuId` values before trace / expand / inbound actions, and added `services/web/tests/pages/inventoryPage.test.tsx` regression coverage.
   - Wired `inventory-ui-smoke` into `.github/workflows/ci.yml` and `ci-gate`, so inventory real-browser validation is also merge-blocking.

15. **Settlement Real-Browser Regression**
   - Expanded `tests/helpers/settlementFlow.ts` with a multi-settlement regression seed and DB-side aging summary snapshot helper, so regression assertions can compare against live tenant data instead of assuming a clean tenant.
   - Added a second scenario in `tests/settlement.real.spec.ts` for customer summary reverse-filtering, overdue-only filtering, and aging summary verification against the real settlement read model.
   - Added root script:
     - `npm run test:settlement:ui:regression`
   - Wired `settlement-ui-regression` into `.github/workflows/ci.yml` as a `develop`-push-only real-browser regression job, aligning settlement with the existing purchase / sales-order smoke-vs-regression split.

16. **Inventory Real-Browser Regression**
   - Expanded `tests/helpers/inventoryFlow.ts` with a second scenario that seeds both inbound and outbound inventory transactions against the same SKU, while keeping the live `inventory` aggregate and `inventory_daily_snapshots` aligned.
   - Added a second scenario in `tests/inventory.real.spec.ts` for snapshot-entry source labeling, trace keyword filtering, and filter reset behavior against the real inventory transaction trace API.
   - Added root script:
     - `npm run test:inventory:ui:regression`
   - Wired `inventory-ui-regression` into `.github/workflows/ci.yml` as a `develop`-push-only real-browser regression job, so inventory now follows the same smoke-vs-regression CI pattern as purchase / sales-order / settlement.

17. **Process Config Real-Browser Regression**
   - Expanded `tests/helpers/processConfigFlow.ts` with a second scenario that seeds two workstation types, two concrete workstations, one process template step, and DB polling helpers for `process_steps` / `process_wages`.
   - Added a second scenario in `tests/processConfig.real.spec.ts` for editing an existing step’s workstation type, concrete workstation, max hours, and unit wage, then verifying both browser-side reload persistence and DB-side write-through.
   - Added root script:
     - `npm run test:process-config:ui:regression`
   - Wired `process-config-ui-regression` into `.github/workflows/ci.yml` as a `develop`-push-only real-browser regression job, so process-config also follows the shared smoke-vs-regression CI pattern.

18. **Production Task Real-Browser Smoke**
   - Added `tests/helpers/productionTaskFlow.ts` and `tests/productionTask.real.spec.ts` as the sixth real-backend Playwright flow, focused on the read-only task detail drawer.
   - The new smoke seeds a minimal live production task aggregate with dependency edges, task material transactions, inventory transactions, work report data, and task exception data, then verifies the browser renders dependency, inventory trace, wage, and exception blocks from the real backend.
   - Added root scripts:
     - `npm run test:production-task:ui`
     - `npm run test:production-task:ui:smoke`
   - Wired `production-task-ui-smoke` into `.github/workflows/ci.yml` and `ci-gate`, so production task detail aggregation is also merge-gating instead of local-only verification.

19. **Production Order Real-Browser Smoke**
   - Added `tests/productionOrder.real.spec.ts` as the seventh real-backend Playwright flow, reusing the existing production task seed to verify the production order detail drawer rather than creating a second production-domain fixture factory.
   - The new smoke covers `/production/orders` live list rendering plus detail-drawer structure snapshot and operation-lane rendering against the real backend, including frozen structure counts, operation counts, and task landing cards.
   - Added root scripts:
     - `npm run test:production-order:ui`
     - `npm run test:production-order:ui:smoke`
   - Wired `production-order-ui-smoke` into `.github/workflows/ci.yml` and `ci-gate`, so production order detail aggregation is also merge-gating instead of local-only verification.

20. **Production Schedule Real-Browser Smoke**
   - Expanded `tests/helpers/productionTaskFlow.ts` so the shared production fixture now also seeds the `worker` role mapping needed by the real scheduler, and added a schedule-specific wrapper that attaches a deterministic next-workday date plus cleanup for generated `production_schedules` rows.
   - Added `tests/productionSchedule.real.spec.ts` as the eighth real-backend Playwright flow, covering `/production/schedule` browser-side regenerate, AI risk prompt rendering, work-order focus filtering, and worker-view preservation of semi-finished output labels against the live scheduling API.
   - Added root scripts:
     - `npm run test:production-schedule:ui`
     - `npm run test:production-schedule:ui:smoke`
   - Wired `production-schedule-ui-smoke` into `.github/workflows/ci.yml` and `ci-gate`, so the production scheduling read path is also merge-gating instead of local-only verification.

21. **Production Schedule Real-Browser Regression**
   - Expanded `tests/helpers/productionTaskFlow.ts` with schedule-row snapshot polling, so the real-browser suite can verify `production_schedules` persistence instead of only trusting the UI refresh.
   - Added a second scenario in `tests/productionSchedule.real.spec.ts` for the supervisor-adjustment path: regenerate live schedule rows, open the real adjust modal from the order view, change `plannedQty`, verify the browser rerenders the updated per-line quantity and total order quantity, then assert the backing `production_schedules.planned_qty` row is updated in MySQL.
   - Added root script:
     - `npm run test:production-schedule:ui:regression`
   - Wired `production-schedule-ui-regression` into `.github/workflows/ci.yml` as a `develop`-push-only real-browser regression job, so production scheduling now follows the same smoke-vs-regression CI pattern as purchase / sales-order / process-config / inventory / settlement.

22. **Production Order Real-Browser Regression**
   - Expanded `tests/helpers/productionTaskFlow.ts` with an order-detail regression scenario that reuses the base production seed, then adds one child frozen-structure node plus three extra tasks on the same operation.
   - Added a second scenario in `tests/productionOrder.real.spec.ts` for production-order detail regression: verify the drawer header reflects `冻结结构 2 节点 / 任务 4 条`, the structure tab renders a real wildcard-resolution node and deeper `bomPath`, and the operation lane shows task-folding text `还有 1 个任务`.
   - Added root script:
     - `npm run test:production-order:ui:regression`
   - Wired `production-order-ui-regression` into `.github/workflows/ci.yml` as a `develop`-push-only real-browser regression job, so production order detail now follows the same smoke-vs-regression CI pattern as production scheduling and the other major real-browser domains.

23. **Production Task Real-Browser Regression**
   - Expanded `tests/helpers/productionTaskFlow.ts` with a task-detail regression scenario that reuses the base production seed, removes the live material transaction / inventory transaction / wage-report rows, and adds one extra resolved exception on the same task.
   - Added a second scenario in `tests/productionTask.real.spec.ts` for production-task detail regression: verify the drawer safely degrades to `尚无投入记录` / `尚无产出记录` / `尚未生成工资报工记录...` when historical compatible tasks lack newer aggregates, while still rendering both unresolved and resolved exception timeline entries from the real backend.
   - Added root script:
     - `npm run test:production-task:ui:regression`
   - Wired `production-task-ui-regression` into `.github/workflows/ci.yml` as a `develop`-push-only real-browser regression job, so production task detail now follows the same smoke-vs-regression CI pattern as production scheduling, production order, and the other major real-browser domains.

24. **Production Task Dependency Unblock Regression**
   - Expanded `tests/helpers/productionTaskFlow.ts` with a dependency-recovery helper that updates the predecessor operation from unmet to completed against the live test DB.
   - Added a third scenario in `tests/productionTask.real.spec.ts` for production-task detail regression: open a blocked task drawer, verify the initial `未满足` dependency state and blocking banner, then refresh after the predecessor operation is completed and verify the drawer flips to `已满足` with the blocking banner removed.
   - Updated `docs/v3/half-finished-production-qa-runbook.md` and `docs/test-report.md` so `production-task` regression coverage now explicitly includes dependency unblock recovery, not just historical empty-state degradation.

25. **Production Task Mixed Wage / Exception Regression**
   - Expanded `tests/helpers/productionTaskFlow.ts` with a mixed timeline seed that keeps the live wage report, bumps task actual hours into the overtime band, and adds both one resolved and one additional unresolved exception on the same task.
   - Added a fourth scenario in `tests/productionTask.real.spec.ts` for production-task detail regression: verify the drawer shows `超时`, renders the updated wage board fields, and simultaneously keeps one `已处理` exception plus multiple unresolved exception entries from the real backend timeline.
   - Added a focused backend guard in `services/api/tests/unit/production.task-detail.service.test.ts` so the task-detail aggregation path now explicitly preserves mixed resolved/unresolved exception rows together with the wage summary payload.
   - Updated `docs/v3/half-finished-production-qa-runbook.md` and `docs/test-report.md` so `production-task` regression scope now explicitly covers mixed wage-board plus exception-timeline states.

26. **Production Task Resolve-Exception Write Path**
   - Expanded `tests/helpers/productionTaskFlow.ts` with an exception-state seed plus DB polling helper for the task status and exception resolution fields after browser-side recovery.
   - Added a fifth scenario in `tests/productionTask.real.spec.ts` for production-task regression: open an `exception` task drawer as `boss`, trigger `标记已处理`, submit the real resolution modal, verify the success toast and drawer footer switch back to the in-progress action set, then assert the backing `production_tasks.status` becomes `started` and the unresolved `task_exceptions` row is filled with `resolved_at` and `resolution`.
   - Updated `docs/v3/half-finished-production-qa-runbook.md` and `docs/test-report.md` so production-task regression coverage now explicitly includes the supervisor-side exception recovery write path rather than only read-only drawer aggregation.

27. **Production Task Suspend Write Path**
   - Fixed a contract mismatch between frontend and backend: the task drawer exposed `挂起任务` in `exception` state, but `ProductionService.suspendTask` only accepted `started` / `pending`; it now also accepts `exception`, aligning the live API with the shipped UI.
   - Added a matching unit guard in `services/api/tests/unit/production.service.task-state.test.ts` so suspending an `exception` task remains supported going forward.
   - Expanded `tests/helpers/productionTaskFlow.ts` with an exception-state suspend seed plus DB polling helper for `production_tasks.status = suspended` and `suspend_reason`.
   - Added a sixth scenario in `tests/productionTask.real.spec.ts` for production-task regression: open an `exception` task drawer as `boss`, trigger `挂起任务`, submit the real suspend modal, verify the success toast and drawer state switch to `已挂起`, then assert the backing `production_tasks` row is updated with the expected `suspend_reason`.

28. **Production Task Start Write Path**
   - Expanded `tests/helpers/productionTaskFlow.ts` with a pending-task start seed that strips previously seeded started-state aggregates, adds a `process_step_materials` start-consumption rule, and polls for both task/order status changes plus the new input material row.
   - Added a seventh scenario in `tests/productionTask.real.spec.ts` for production-task regression: log in as `supervisor`, open a `pending` task drawer, trigger `开始生产`, verify the success toast and drawer footer switch to the in-progress action set, then assert the drawer renders the newly inserted input material row as `未落库存流水 / 待生成流水号` and the backing DB rows flip to `production_tasks.status = started` and `production_orders.status = in_progress`.
   - Updated `docs/v3/half-finished-production-qa-runbook.md` and `docs/test-report.md` so production-task regression coverage now explicitly includes the pending-task start path and its first input-material write-through.

29. **Production Task UX / Demo Closure**
   - Fixed a live permission mismatch on `/production/tasks`: the UI exposed task actions to system administrators, but the backend task execution routes previously only allowed `worker` / `supervisor`. The production task execution routes now include `admin` and `boss` for start / complete / complete-v2 / exception, while suspend / resume / resolve-exception also include `admin`.
   - Added `UserRole.ADMIN` to the frontend role enum, expanded production navigation and permission maps to include the admin role, and aligned task action visibility with the real backend route contract so the page no longer shows misleading write buttons to roles that cannot execute them.
   - Updated the production task list so the main business column now emphasizes `当前产出` rather than only the final product name, and the task detail drawer now distinguishes `所属成品` / `当前产出` / `任务类型`, making semi-finished tasks visually recognizable instead of being buried under the process secondary line.
   - Added a new task-type query path across backend and frontend: `GET /api/production/tasks` now supports `taskType=finished|semi_finished`, and the page filter bar now exposes `全部任务类型 / 成品任务 / 半成品任务`.
   - Extended the task detail drawer’s `依赖与阻塞` block so it now shows not only predecessor operation demand / completion / status, but also the task’s required input materials, including planned demand, already issued quantity, current available stock, shortage gap, and stock-state color coding.
   - Added stock-state visual semantics for task materials:
     - healthy: inventory sufficient
     - warning: inventory only slightly above the planned requirement
     - danger: shortage exists and the detail card is marked `缺料`
   - Normalized the frontend shortage-state handling so MySQL `0/1` return values do not get misread as generic truthy strings in the browser.

30. **Local Demo Data for Production Tasks**
   - The local demo tenant (`FACTORY001`) was updated so the first page of pending production tasks now includes visible semi-finished outputs, instead of only finished-goods labels.
   - Demo semi-finished outputs were normalized to readable names:
     - `Sofa Cover WIP`
     - `Cabinet Panel WIP`
     - `Sofa Frame WIP`
   - Demo task-detail input materials were also seeded for direct browser verification:
     - task `#15`: `Foam Sheet`, `Oak Panel`
     - task `#100`: `Leather Roll`, `Adhesive`
   - Demo inventory balances were seeded to make the stock-state UI directly observable:
     - `Foam Sheet` / `Leather Roll`: sufficient stock
     - `Oak Panel` / `Adhesive`: deliberate shortage

31. **Validation Addendum**
   - `cd services/api && npm run typecheck` passed after the production-task filter and material-stock extensions.
   - `cd services/web && npm run typecheck` passed after the task-type filter, material-stock visual states, and admin-role alignment changes.
   - `docker compose up -d --build api web` passed after the production-task page changes.
   - Runtime API validation confirmed:
     - `POST /api/production/tasks/14/start` succeeds for `admin_dev`
     - `GET /api/production/tasks?status=pending&taskType=semi_finished&page=1&pageSize=8` returns only semi-finished tasks
     - `GET /api/production/tasks/15` returns input materials with stock sufficiency / shortage fields
     - `GET /api/production/tasks/100` returns a blocked semi-finished task with both predecessor dependency state and input-material shortage data

32. **Production Task Complete Write Path**
   - Expanded `tests/helpers/productionTaskFlow.ts` with a started-task complete seed that removes preseeded aggregates, injects a `process_wages` rule for the current step, and polls for the completed task/order state plus the newly written `work_reports` and output `task_material_transactions` rows.
   - Added an eighth scenario in `tests/productionTask.real.spec.ts` for production-task regression: log in as `supervisor`, open an `in_progress` task drawer, trigger `完工上报`, submit completed qty / actual hours / scrap / notes, verify the success toast and drawer wage-output sections, then assert the backing DB rows flip to `production_tasks.status = completed`, `production_orders.status = completed`, and persist the expected wage + output snapshot.
   - Updated `docs/v3/half-finished-production-qa-runbook.md` and `docs/test-report.md` so production-task regression coverage now explicitly includes the in-progress complete-report write path in addition to start / exception recovery / suspend.

33. **Production Schedule Confirm Write Path**
   - Expanded `tests/helpers/productionTaskFlow.ts` with a schedule-confirm polling helper that waits for the live `production_schedules` row to flip to `confirmed` and for the generated `production_tasks` row to appear with the stable `TK{date}{scheduleId}` task number, plus cleanup for confirmed schedule-generated tasks.
   - Added a third scenario in `tests/productionSchedule.real.spec.ts` for production-schedule regression: log in as `boss`, regenerate the live schedule, trigger `确认并下发给工人`, submit the real confirm modal, verify the success toast and `已下发` state, then assert the backing `production_schedules.status = confirmed` and a formal `production_tasks` row is generated from the confirmed schedule.
   - Updated `docs/v3/half-finished-production-qa-runbook.md` and `docs/test-report.md` so production-schedule regression coverage now explicitly includes the supervisor-side confirm-and-release write path, not only regenerate/adjust persistence.

34. **Production Order Cancel Write Path**
   - Expanded `tests/helpers/productionTaskFlow.ts` with a pending-order seed that strips started-state aggregates back to a clean `pending` order/task shape, plus a DB polling helper for `production_orders.status = cancelled` and the cascaded `production_tasks.status = cancelled` result.
   - Added a third scenario in `tests/productionOrder.real.spec.ts` for production-order regression: log in as `boss`, open a `pending` order drawer, trigger `取消工单`, submit the real confirm modal, verify the drawer closes and the order card flips to `已取消`, then assert the backing order/task rows are both cancelled.
   - Updated `docs/v3/half-finished-production-qa-runbook.md` and `docs/test-report.md` so production-order regression coverage now explicitly includes the pending-order cancel path, not only structure and operation-lane read aggregation.

35. **Production Order Create Write Path**
   - Expanded `tests/helpers/productionTaskFlow.ts` with a create-only seed for a confirmed sales order, active BOM, default process template, and ready inventory, plus cleanup/polling helpers for the resulting `production_orders`, `material_requirements`, and `sales_orders` state.
   - Added a fourth scenario in `tests/productionOrder.real.spec.ts` for production-order regression: log in as `boss`, open `+ 手动创建工单`, submit a real sales-order number in `从销售订单创建工单`, verify the success toast and the new `待排产 / 齐套` card, then assert the backing order is created with `status = pending`, `material_status = ready`, and the sales order flips to `in_production`.
   - Fixed two real-regression contract mismatches along the way: the new customer seed now writes `customers.code` to satisfy the live schema, and the browser test targets the create modal textbox by placeholder because the shipped label is not programmatically bound to the input.
   - Verified with:
     - `git diff --check -- tests/helpers/productionTaskFlow.ts tests/productionOrder.real.spec.ts`
     - `npm run test:production-order:ui:regression`
   - Updated `docs/v3/half-finished-production-qa-runbook.md` and `docs/test-report.md` so production-order regression coverage now explicitly includes the manual create-from-sales-order write path.

36. **Production Shortage Real-Browser Flow**
   - Added `tests/productionShortage.real.spec.ts` as a ninth real-backend Playwright page, focused on `/production/shortage`.
   - Expanded `tests/helpers/productionTaskFlow.ts` with a shortage-specific scenario that reuses the production task seed, then adds a live `material_requirements` row, BOM snapshot, supplier, and supplier price so the shortage board can render a real shortage SKU and generate a deterministic purchase suggestion.
   - Added two page scenarios:
     - `@production-shortage-smoke`: render shortage aggregation, focus a real shortage SKU, and verify the linked order-detail panel
     - `@production-shortage-regression`: click `生成该工单采购建议`, verify the toast plus browser-side pending-suggestion state, then assert the backing `purchase_suggestions` row and `material_requirements.suggestion_id`
   - Added root scripts:
     - `npm run test:production-shortage:ui`
     - `npm run test:production-shortage:ui:smoke`
     - `npm run test:production-shortage:ui:regression`
   - Wired `production-shortage-ui-smoke` and `production-shortage-ui-regression` into `.github/workflows/ci.yml` and `ci-gate`, so the shortage board now follows the same smoke-vs-regression CI pattern as the other real-browser domains.
   - Verified with:
     - `ruby -e "require 'yaml'; YAML.load_file('.github/workflows/ci.yml'); puts 'ci.yml ok'"`
     - `npm run test:production-shortage:ui`
   - Updated `docs/v3/half-finished-production-qa-runbook.md` and `docs/test-report.md` so shortage-board smoke/regression is now an explicit standard entrypoint instead of an uncovered production page.

37. **Purchase Suggestion Real-Browser Flow**
   - Expanded `tests/helpers/purchaseFlow.ts` with a purchase-suggestion-specific seed, cleanup, and DB polling helpers so the real-browser suite can create a deterministic pending suggestion, wait for browser-side approval, and then verify convert-to-PO write-through in the live DB.
   - Added `tests/purchaseSuggestion.real.spec.ts` as a dedicated real-backend Playwright page for `/purchase/purchase-suggestions`.
   - Added two page scenarios:
     - `@purchase-suggestion-smoke`: render a live pending suggestion and verify the detail drawer
     - `@purchase-suggestion-regression`: approve a pending suggestion, convert it to a purchase order, verify the browser-side executed state, then assert the backing `purchase_suggestions`, `purchase_orders`, `purchase_order_items`, and `inventory.qty_in_transit`
   - Added root scripts:
     - `npm run test:purchase-suggestion:ui`
     - `npm run test:purchase-suggestion:ui:smoke`
     - `npm run test:purchase-suggestion:ui:regression`
   - Wired `purchase-suggestion-ui-smoke` and `purchase-suggestion-ui-regression` into `.github/workflows/ci.yml` and `ci-gate`, so the dedicated purchase-suggestion page now follows the same smoke-vs-regression CI pattern as the other real-browser pages.
   - Updated `docs/v3/half-finished-production-qa-runbook.md` and `docs/test-report.md` so purchase-suggestion smoke/regression is now an explicit standard entrypoint rather than implicit purchase-domain coverage.

38. **Stocktaking Real-Browser Flow**
   - Fixed two shipped frontend/backend contract mismatches before adding browser coverage:
     - `services/web/src/api/stocktaking.ts` now loads detail rows from the real `GET /api/stocktaking/:id` response instead of the nonexistent `/api/stocktaking/:id/items`
     - `services/web/src/pages/stocktaking/StocktakingPage.tsx` now exposes the `确认` action for real `in_progress` tasks, which is what the backend and DB schema actually produce
   - Added `services/web/tests/pages/stocktakingPage.test.tsx` so the in-progress confirm button and expanded detail row rendering are guarded at the frontend unit/page layer.
   - Added `tests/helpers/stocktakingFlow.ts` and `tests/stocktaking.real.spec.ts` as the next real-backend Playwright page for `/stocktaking`.
   - Added two page scenarios:
     - `@stocktaking-smoke`: create a live stocktaking task from the browser and verify the expanded detail row renders the seeded SKU snapshot
     - `@stocktaking-regression`: open a seeded in-progress task as `boss`, confirm it from the browser, then assert the backing `stocktaking_tasks`, `inventory`, `inventory_daily_snapshots`, and `inventory_transactions`
   - Added root scripts:
     - `npm run test:stocktaking:ui`
     - `npm run test:stocktaking:ui:smoke`
     - `npm run test:stocktaking:ui:regression`
   - Wired `stocktaking-ui-smoke` and `stocktaking-ui-regression` into `.github/workflows/ci.yml` and `ci-gate`, so stocktaking now follows the same smoke-vs-regression CI pattern as the other real-browser pages.
   - Updated `docs/v3/half-finished-production-qa-runbook.md` and `docs/test-report.md` so stocktaking smoke/regression is now an explicit standard entrypoint.

39. **Incoming Inspection Real-Browser Flow**
   - Added `tests/helpers/incomingInspectionFlow.ts` and `tests/incomingInspection.real.spec.ts` as a dedicated real-backend Playwright page for `/purchase/incoming-inspection`, instead of leaving inspection coverage hidden inside the broader `purchaseFlow.real.spec.ts`.
   - Added two page scenarios:
     - `@incoming-inspection-smoke`: create a live inspection directly from the incoming-inspection page using the seeded PO / delivery business numbers, then verify the draft row and detail drawer render the real supplier / SKU payload.
     - `@incoming-inspection-regression`: open a seeded in-progress inspection from the page, submit the conclusion from the browser, then assert the backing inspection status plus both receipt and return-order side effects.
   - Added root scripts:
     - `npm run test:incoming-inspection:ui`
     - `npm run test:incoming-inspection:ui:smoke`
     - `npm run test:incoming-inspection:ui:regression`
   - Wired `incoming-inspection-ui-smoke` and `incoming-inspection-ui-regression` into `.github/workflows/ci.yml` and `ci-gate`, so the dedicated incoming-inspection page now follows the same smoke-vs-regression CI pattern as the other real-browser pages.
   - Updated `docs/v3/half-finished-production-qa-runbook.md` and `docs/test-report.md` so incoming-inspection smoke/regression is now an explicit standard entrypoint rather than implicit purchase-domain coverage.

40. **Production Task Detailed IO Manifest**
   - Extended `GET /api/production/tasks/:taskId` so each task detail now returns explicit `inputMaterials` and `outputItems`, in addition to predecessor dependency status.
   - Dependency predecessors now include the upstream semi-finished SKU context (`skuId / skuCode / skuName / unit`), so finished-product tasks can show the required semi-finished inputs instead of only step names.
   - Input-material aggregation now follows a three-level fallback:
     - `process_step_materials` configured on the current step
     - existing task-level `task_material_transactions`
     - scaled `material_requirements` for finished-product tasks when no step/task material rows exist yet
   - The production task detail drawer now renders:
     - `依赖与阻塞`: predecessor demand/completion/status plus the required raw-material cards
     - `任务输入 / 输出清单`: unified semi-finished inputs, raw-material inputs, and task output SKU/qty/unit
   - Runtime verification on the local stack confirmed:
     - finished task `#103` returns a semi-finished predecessor (`WIP-00022 / Sofa Cover WIP`), multiple raw-material inputs, and a finished output item (`FG-00009 / 北欧三人沙发`)
     - semi-finished task `#100` returns raw-material inputs plus a semi-finished output item (`WIP-00022 / Sofa Cover WIP`)

41. **Production Task Drawer Widening And Unified Input List**
   - Increased the production-task detail drawer width to a wide responsive panel so the current task overview, dependency cards, and IO manifest can fit on one screen without premature wrapping.
   - Removed the duplicated raw-material block from `依赖与阻塞`; raw materials are now rendered only inside the unified `任务输入 / 输出清单`.
   - Added a new `inputItems` contract to task detail, so the frontend can render one mixed input list covering:
     - predecessor semi-finished inputs for finished-product tasks
     - first-level BOM semi-finished inputs for semi-finished tasks
     - first-level BOM raw-material inputs
   - Semi-finished tasks now prefer the current output SKU’s active BOM top-level children when building the input list, instead of only relying on task material transactions.
   - Seeded a local demo active BOM for `WIP-00022 / Sofa Cover WIP`, so task `#100` now visibly renders:
     - one first-level semi-finished input: `WIP-00023 / Cabinet Panel WIP`
     - two first-level raw-material inputs: `RM-00201 / Leather Roll`, `RM-00014 / Adhesive`
