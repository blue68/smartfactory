[artifact:ImplementationPlan]
status: READY
owner: codex
scope:
- 补齐生产领料、报工实际消耗、报工报废转库存损耗、退料回仓四条链路
- 保持现有仓库/库位模型，不新增独立库存表
- 修正半成品/成品自动入库按合格数量落库的口径
inputs:
- docs/v3/inventory-update-logic-analysis-2026-04-09.md
- docs/v3/half-finished-production-architecture.md
- services/api/src/modules/production/scheduler.service.ts
- services/api/src/modules/production/workflow-engine.service.ts
- services/api/src/modules/inventory/inventory.service.ts
- services/web/src/pages/production/TaskPage.tsx
handoff_to:
- senior-backend-engineer
- senior-frontend-engineer
- senior-qa-engineer
goal:
- 让生产库存链路能够区分“已预留”“已领到线边未消耗”“已实际消耗”“已报废损耗”“已退料回仓”
changed_areas:
- 仓库主数据：生产 WIP/线边虚拟仓位
- 任务物料流水：绑定真实库存流水、区分 issue/consume/return/waste
- 生产任务接口：新增领料与退料动作，调整完工报工口径
- 库存流水与快照：新增生产领料/退料/报废场景
- 前端生产任务页：增加领料与退料操作入口、调整报工文案与状态
steps:
- 新增迁移：补齐 task_material_transactions 的动作类型、仓库/库位、关联库存流水字段，并为租户创建默认 WIP/线边仓位
- 后端新增生产任务领料与退料接口，库存上在主仓和 WIP/线边仓位之间做转移，不改变全局总量
- 改造 completeTask：按实际消耗从 WIP/线边扣输入物料；按 qualifiedQty 入半成品/成品；将 scrapQty 转成正式损耗流水
- 改造任务详情聚合：输入项/输出项/报废项优先展示真实库存流水和仓库库位，而不是仅展示统计记录
- 前端生产任务页增加“领料到线边”“退料回仓”入口，并将完工上报说明改成“确认消耗、合格产出与报废”
- 补齐单测与回归测试，覆盖已领未耗、报工报废、退料回仓、整单完工入库等关键场景
risks:
- 现有库存模型按仓库/库位聚合，若 WIP 仓位初始化失败会导致领料链路无法闭环
- 现有自动入库按 completedQty 落账，若未统一改成 qualifiedQty 会造成产成品库存高估
- 生产任务页当前已有未提交改动，前端接线时需谨慎整合，避免覆盖用户或既有本地工作
validation:
- 后端单测：领料转移、退料回仓、报工消耗、报工报废转 waste_out、qualifiedQty 自动入库
- 前端单测：任务页按钮显示逻辑、领料/退料弹窗交互、报工成功后状态刷新
- 类型检查：services/api `npm run typecheck`，services/web `npm run typecheck`
- 定向回归：任务详情的输入/输出仓库库位展示、库存快照与流水口径一致
