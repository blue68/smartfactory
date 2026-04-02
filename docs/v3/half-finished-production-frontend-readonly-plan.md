[artifact:ImplementationPlan]
status: READY
owner: senior-frontend-engineer
scope:
- 工资报表页任务报工只读接线
- 库存页日结库存快照只读接线
inputs:
- [artifact:TaskBreakdown]
- [artifact:DesignSpec]
- [artifact:UICode]
- [artifact:InteractionSpec]
- [artifact:APIDoc]
- [artifact:Approval]
handoff_to:
- code-reviewer
- senior-qa-engineer

goal:
- 在不改动原有主页面信息架构的前提下，把 Phase 3/4 已落地的只读后端能力接到现有前端

changed_areas:
- `services/web/src/api/wage.ts`
- `services/web/src/api/wageReport.ts`
- `services/web/src/api/inventory.ts`
- `services/web/src/types/models.ts`
- `services/web/src/pages/report/WageReportPage.tsx`
- `services/web/src/pages/inventory/InventoryPage.tsx`
- `services/web/src/pages/inventory/InventoryPage.module.css`

steps:
- 在工资 API 层补任务报工类型与 hook
- 在库存 API 层补日结库存类型与 hook
- 在工资报表页新增“工资汇总 / 任务报工”二级只读切换
- 在库存页新增“日结库存快照”只读卡片
- 运行 `npm run typecheck`，必要时补 `npm run build`

risks:
- 工资页当前图表视图仅适用于工资汇总，不应错误复用于任务报工表格
- 库存页现有筛选为实时库存查询，日结快照卡片需明确只做旁路只读回查，避免误导为同口径

validation:
- `cd services/web && npm run typecheck`
- `cd services/web && npm run build`
