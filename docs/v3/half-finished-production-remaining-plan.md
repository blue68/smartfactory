[artifact:ImplementationPlan]
status: READY
owner: senior-backend-engineer
scope:
- 半成品生产剩余 5 阶段事项重排与新一轮执行顺序
- 基于最新真实进展收敛 Phase 2/3/4 未完项，并明确 Phase 5 前置门禁
inputs:
- [artifact:Approval]
- [artifact:SystemArch]
- [artifact:TaskBreakdown]
- [artifact:BackendCode]
- [artifact:TestReport]
- 当前 `services/api` 与 `services/web` 实现状态
handoff_to:
- engineering-manager
- code-reviewer
- senior-qa-engineer

goal:
- 在不回退已交付主链路的前提下，优先补齐“任务级投入产出 -> 报工闭环 -> 库存口径”三段式缺口
- 将前端 Phase 5 从“大范围重构”拆成可门禁的小阶段，避免再次被范围过大阻断

changed_areas:
- `docs/v3`
- `services/api/src/modules/production`
- `services/api/src/modules/report`
- `services/api/src/modules/inventory`
- `services/web/src/pages/production`
- `services/web/src/pages/report`

steps:
- P0 / Phase 1 收尾：维持现状，只做回归与兼容，不再扩表。当前状态：已完成，剩余仅历史数据兼容回查。
- P1 / Phase 2 未完项：把 `completeTask` 真正接到任务级投入产出。执行顺序：
  1. 先落 output 侧 `task_material_transactions`
  2. 再接 input 侧 `process_step_materials -> task_material_transactions`
  3. 最后把 `WorkflowEngineService` 并入主事务，统一处理半成品入库与下道解锁
- P2 / Phase 3 报工闭环：在已完成 `actualHours -> work_reports -> wages` 基础上补剩余闭环。执行顺序：
  1. 增加任务级报工明细查询
  2. 补返工/异常恢复后的报工一致性
  3. 固化工资报表的任务来源、工时、产量、工价、工资金额校验
- P3 / Phase 4 库存口径：在当前“成品最终入库”基础上补齐半成品与通配口径。执行顺序：
  1. 半成品工序完工库存回写
  2. 通配半成品按 `production_order_sku_resolutions` 固定 SKU 回推
  3. `inventory_daily_snapshots` 查询与回查口径
  4. 库存补偿/幂等保护与回滚策略
- P4 / Phase 5 前端视图：按最小切片逐步放行，而不是一次性重构。执行顺序：
  1. 只读视图：工单详情中的 components / operations / resolution
  2. 生产任务页：显示任务级投入产出、实际工时、报工状态
  3. 工资报表页：展示任务来源与工时构成
  4. 库存页：当前库存 + 日结库存 + 任务/流水追溯

priorities:
- `P0` 最高优先：Phase 2 未完项中的任务级 output IO。原因：它是报工闭环和库存口径的共同前置。当前状态：已完成。
- `P1` 次高优先：Phase 2 未完项中的 input IO 与 WorkflowEngine 并入。原因：不补这层，Phase 4 无法称为完成。当前状态：`consume_timing='start'` 与 `consume_timing='complete'` input IO 已完成，`WorkflowEngineService` 也已并入主事务中的半成品入库、下道解锁、通配半成品固定 SKU 回推、`inventory_daily_snapshots` 写入与基础防重；同时已补支持 `skuIds[]` 与 `dryRun` 的批量快照修复入口、支持按账本预览/回写 `qty_on_hand` / `qty_reserved` / `qty_in_transit` 的 `inventory/reconcile` 基础对账工具，以及统一的 `inventory/repair` 一键修复入口，且修复后会自动失效 Redis 缓存。`inventory` 模块、采购质检入库、盘点确认、采购单创建/关闭、采购建议转单、销售发货、手工采购退货发货以及已识别的 `qty_reserved` 预留/释放入口都已自动维护对应库存口径；服务层也已补齐跨入口缓存回滚（含 commit-fail）统一回归，并新增 `inventoryRepairFlow.e2e`、采购三条 E2E、`salesShipFlow.e2e` 与稳定化后的 `dyeLotFlow.e2e` 真实库补跑。剩余主要收敛到其他场景的 integration/e2e 持续扩充。
- `P2` 中优先：Phase 3 报工明细与返工一致性。原因：当前工资已可查，但任务级追溯还不完整。当前状态：已补 `productionFlow.e2e` 的异常恢复后任务工资明细一致性断言（`wages/tasks` 对齐 `work_reports`），并补齐 `wage.controller/wage.routes` 接口层回归与 `wage.service` 任务维度筛选口径回归（参数校验、筛选透传、角色门禁、路由顺序、筛选条件参数顺序）；`GET /api/reports/wages` 管理员汇总入口与 `GET /api/reports/wages/export` 导出入口都已补控制器透传/校验回归，且已补 `wage.auth` 运行时鉴权回归（`/wages*` 的 `401/403/200` 行为，含 `/wages/export` 门禁）。另外已补“旧字段口径 + 任务字段并存”兼容回归（`report_date/user_id/step_id`），并新增 `wage.api` 真实集成回归（管理员汇总 / 任务明细 / 导出 / 个人自查 / 角色门禁），同时把工资报表返回中的数值 ID 字段统一归一为数字。`2026-04-01` 已完成 `productionFlow.e2e` 全量复跑（含 `Step 11-B`），当前该项已闭环。
- `P3` 中优先：Phase 4 半成品/通配库存回推与日结口径。当前状态：库存修复工具 `reconcile/repair` 已补 controller/routes 接口层回归（默认参数、互斥校验、角色门禁与路由顺序），`daily-snapshots` / `snapshots/rebuild` 也已补 controller 参数校验与 `dryRun` 文案分支回归；并已补 `inventory.auth` 运行时鉴权回归（`daily-snapshots` 登录态读取与 `snapshots/rebuild/reconcile/repair` 的 `401/403/200` 门禁行为）。`inventory.api` 集成层现也已补“`reconcile` dryRun 预览 -> `repair` 执行 -> `daily-snapshots` 回查”组合回归，且独立脏数据种子可稳定复跑。真实库 E2E 现已新增“主库存行缺失但账本/预留/在途仍在时的 `inventory/repair` 重建”、“销售发货库存主链路（`DELIVERY_OUT`/库存扣减/快照回写）+ 收货结算闭环（收货/结算/收款/开票/应收移除）”，以及稳定化后的“面料缸号链路（自带种子 + 无授权跨色号阻断 4004）”场景；并已完成 `tests/e2e` 全量 7 套复跑（69 tests）全部通过。`sales.api` integration（25/25）、`purchase.api` integration（20/20）、`settlement.api` integration（9/9）、`wage.api` integration（5/5）、`stocktaking.api` integration（3/3）、`incomingInspection.api` integration（4/4）、`returnOrder.api` integration（3/3）与 `purchaseSettlement.api` integration（3/3）已完成自带种子稳定化；其中盘点链路同时补平了录入接口因 UPDATE 结果误解构导致 500，以及确认接口因 `inventory_transactions` 强制字段缺失导致 500 两处真实缺口。来料质检链路则已补到 `create/list/detail/update/submit/preview-receipt` 主链路，以及 `purchase_receipts / return_orders / inventory / inventory_daily_snapshots` 的真实副作用回查；退货单链路也已补到手工采购退货 `create/confirm/ship/complete` 主链路，以及 `PURCHASE_RETURN_OUT` 出库流水、库存扣减与快照刷新回查；采购结算链路则已补到 `create/list/detail/export/confirm/pay/cancel` 主链路，并顺手修复了 `dueDate` 因 `DATE -> Date` 时区转换产生的日期左移。`ConstraintEngine.loadThresholds` 对象/字符串双形态解析也已在运行态回归验证。`production.api` 现也已补齐自带种子并通过，且在“非生产 + 本机回环地址跳过全局限流”后，历史 `tests/integration/` 全量 8 套 161 条已全部通过；新增 `incomingInspection.api`、`returnOrder.api` 与 `purchaseSettlement.api` 已完成定向复跑通过，待后续再并入下一轮全量盘点。
- `P4` 低优先：Phase 5 前端视图；当前审批边界内的只读最小切片已完成并做过一轮后续收敛（任务报工工单/任务筛选、任务筛选输入与查询分离、任务口径提示、日结快照独立关键词筛选与分页、快照日期显式标题、移动端展示优化）。剩余“工单详情大改/生产任务编辑流/写操作入口”仍未获批，需新增审批后再进入。
- `P4` 门禁补充：审批外后续项已落地阻塞产物 `docs/v3/half-finished-production-phase5-next-blocked-plan.md`，可直接作为下一轮补设计/补审批的输入。

risks:
- `WorkflowEngineService` 已接入半成品入库、下道解锁、通配半成品 SKU 固定、日结快照写入与基础防重，且已有支持 `skuIds[]` / `dryRun` 的批量快照修复入口、基础账本对账工具和 `inventory/repair` 一键修复入口；`inventory/reconcile` 现也可在显式开启时校正 `qty_reserved` / `qty_in_transit`，采购单创建/关闭、采购建议转单、销售发货与手工采购退货发货也已回到默认库存维护主链路。当前主要风险已收敛到其余业务入口的真实库 integration/e2e 覆盖深度
- `adjustSchedule` 已补可选 `expectedUpdatedAt` 冲突契约，`SchedulePage` 调整入口也已透传；剩余风险收敛到旧客户端/脚本未透传该字段时仍会退化为最后写入生效
- Phase 5 当前不在已批准的大范围前端改造范围内，必须先补审批边界
- `2026-04-01` 本地 Docker daemon 曾出现无响应并导致 `3307` 拒连；已通过重启 Docker Desktop 恢复，`productionFlow.e2e` 全量复跑通过。当前风险回落为其余业务入口 integration/e2e 覆盖深度。
- 销售域 integration 已完成稳定化（自带种子 + 25/25 通过）；当前风险进一步收敛到其余业务域的 integration/e2e 覆盖深度。
- 采购域 integration 也已完成稳定化（自带种子 + 20/20 通过）；当前已无失败套件，剩余风险转为新增业务场景覆盖深度与回归成本。
- 结算域 integration 也已完成稳定化（自带种子 + 9/9 通过）；当前剩余风险继续收敛到其余业务域与更长链路组合场景。
- 工资域 integration 也已完成首轮稳定化（自带种子 + 5/5 通过）；当前剩余风险继续收敛到其余业务域与更长链路组合场景。
- 盘点域 integration 也已完成首轮稳定化（自带种子 + 3/3 通过）；当前剩余风险继续收敛到其余业务域与更长链路组合场景。
- 来料质检域 integration 也已完成首轮稳定化（自带种子 + 4/4 通过）；当前剩余风险继续收敛到其余业务域与更长链路组合场景。
- 退货单域 integration 也已完成首轮稳定化（自带种子 + 3/3 通过）；当前剩余风险继续收敛到其余业务域与更长链路组合场景。
- 采购结算域 integration 也已完成首轮稳定化（自带种子 + 3/3 通过）；当前剩余风险继续收敛到其余业务域与更长链路组合场景。

validation:
- 每一小步都要求 `npm run typecheck`
- 后端主路径变更必须补单测 + `productionFlow.e2e`
- 涉及库存口径变更时，必须增加 MySQL 实库回查
- 前端进入实现前，需先补新的 `[artifact:Approval]` 或显式缩小到只读范围
- 销售域 integration 变更需补跑：`npm run test:api:integration -- tests/integration/sales.api.test.ts`
- 采购域 integration 变更需补跑：`npm run test:api:integration -- tests/integration/purchase.api.test.ts`
- 集成全量盘点命令：`npm run test:api:integration`
- E2E 全量盘点命令：`npm run test:api:e2e`
