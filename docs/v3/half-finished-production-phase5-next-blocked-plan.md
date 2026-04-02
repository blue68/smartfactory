[artifact:ImplementationPlan]
status: BLOCKED
owner: senior-frontend-engineer
scope:
- Phase 5 审批边界外后续项（工单详情只读重构、生产任务页任务级投入产出可视化、库存任务/流水追溯视图）
missing_inputs:
- 新的 [artifact:Approval]（覆盖上述三块前端范围）
- [artifact:DesignSpec]（上述三块页面的增量视觉与组件规则）
- [artifact:UICode]（上述三块页面的高保真增量稿）
- [artifact:InteractionSpec]（上述三块页面的加载/空态/错误态/切换语义）
- [artifact:TaskBreakdown]（实现任务拆解与边界）
blocking_reasons:
- 当前唯一有效审批 `docs/v3/half-finished-production-frontend-readonly-approval.md` 仅放行工资报表任务报工与库存日结快照只读接线
- 依据 `AGENTS.md` 编码前置门禁，审批范围外功能不得进入实现
handoff_to:
- senior-ui-designer
- tech-lead-architect
- engineering-manager
next_action:
- 先补三块页面的增量设计与任务拆解，再由 engineering-manager 输出新的 [artifact:Approval]
- 审批通过后由 senior-frontend-engineer 输出对应 [artifact:ImplementationPlan] 并进入实现
