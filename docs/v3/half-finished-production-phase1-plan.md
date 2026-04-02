[artifact:ImplementationPlan]
status: READY
owner: senior-backend-engineer
scope:
- Phase 1 数据模型与后端骨架落地
inputs:
- [artifact:Approval]
- [artifact:DBDesign]
- [artifact:APIDoc]
- 现有生产/库存/工资模块代码
handoff_to:
- code-reviewer
- senior-qa-engineer

goal:
- 为半成品日排产、工序级投入产出、工资闭环和通配解析建立最小后端骨架

changed_areas:
- `services/api/src/migrations`
- `services/api/src/modules/production`
- `services/api/src/modules/report`
- `services/api/src/modules/process-config`

steps:
- 新增 Phase 1 迁移，创建 `production_order_components` `process_step_materials` `production_operations` `production_operation_dependencies` `production_order_sku_resolutions` `sku_substitution_rules` `task_material_transactions` `inventory_daily_snapshots`
- 在工单模块补充 release 服务骨架
- 在工资模块先修正 `work_reports` 查询口径，避免继续基于错误字段
- 为后续排产器改造预留 `operation_id/component_id/output_sku_id`

risks:
- 现有生产模块存在大量未提交改动，需避免覆盖
- 旧排产逻辑与新作业单逻辑会并存一段时间

validation:
- 迁移文件静态检查
- 关键 TypeScript 编译检查
- 对新增服务做最小单元/集成覆盖
