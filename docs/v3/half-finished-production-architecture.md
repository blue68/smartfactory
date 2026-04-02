[artifact:SystemArch]
status: READY
owner: tech-lead-architect
scope:
- 在现有生产、库存、工资模块上演进支持半成品作业与通配解析
inputs:
- [artifact:PRD]
- [artifact:UserStory]
- [artifact:Prototype]
- 现有生产/BOM/库存/工资模块代码
handoff_to:
- engineering-manager
- senior-backend-engineer

deliverables:
- 分层架构方案
- 保留/扩展/新增模块边界

architecture_decisions:
- 保留 `production_orders` 作为成品工单，不改主对象粒度
- 将排产主对象从“工单每道工序”升级为“工单下的半成品作业单/工序作业单”
- 将通配解析前移到工单释放阶段，解析后冻结
- 将工资核算数据源统一到任务完工自动生成的 `work_reports`
- 将当前库存与日结库存分为两套口径：`inventory` 为实时，`inventory_daily_snapshots` 为报表

module_boundary:
- ProductionOrderService
  保留：成品工单创建
  扩展：创建工单时生成结构快照、作业单、通配解析记录
- SchedulerService
  改造：排产输入改为 `production_operations`，不再直接对整单所有工序平铺
- WorkflowEngine
  扩展：统一接管任务完工后的投入产出、库存回写、下道解锁、工资报工生成
- InventoryService
  保留：库存快照/流水权威
  扩展：支持半成品生产入库、任务投入出库、日结快照
- WageService
  改造：只读取标准化后的 `work_reports`

risks:
- 现有 `material_requirements` 只能表达原材料缺口，不能继续承担半成品作业结构
- 现有 `scheduler.service.ts` 的排产算法与新对象粒度不一致

handoff_to:
- engineering-manager
- senior-backend-engineer
exit_criteria:
- 模块职责与边界清晰

[artifact:DBDesign]
status: READY
owner: tech-lead-architect
scope:
- 关键表设计与索引建议
inputs:
- [artifact:SystemArch]
handoff_to:
- engineering-manager
- senior-backend-engineer

deliverables:
- 新增表与扩展字段建议

new_tables:
- `production_order_components`
  用途：冻结成品/半成品/原材料结构快照
  关键字段：`id` `tenant_id` `production_order_id` `parent_component_id` `sku_id` `resolved_sku_id` `component_type` `qty_required` `bom_level` `bom_path` `wildcard_rule_id`
  索引：`idx_order_component(tenant_id, production_order_id)` `idx_resolved_sku(tenant_id, resolved_sku_id)`
- `process_step_materials`
  用途：工序投入模型
  关键字段：`id` `tenant_id` `template_id` `step_no` `input_sku_id` `usage_per_unit` `loss_rate` `consume_timing`
  索引：`uk_template_step_sku(tenant_id, template_id, step_no, input_sku_id)`
- `production_operations`
  用途：排产主对象
  关键字段：`id` `tenant_id` `production_order_id` `component_id` `process_step_id` `output_sku_id` `planned_qty` `completed_qty` `status`
  索引：`idx_order_status(tenant_id, production_order_id, status)` `idx_output_sku(tenant_id, output_sku_id)`
- `production_operation_dependencies`
  用途：前后工序/前置作业依赖
  关键字段：`operation_id` `predecessor_operation_id` `required_qty`
  索引：`uk_op_pred(operation_id, predecessor_operation_id)`
- `production_order_sku_resolutions`
  用途：通配解析冻结
  关键字段：`id` `tenant_id` `production_order_id` `component_id` `base_sku_id` `resolved_sku_id` `rule_id` `resolved_at`
  索引：`uk_order_component(tenant_id, production_order_id, component_id)`
- `sku_substitution_rules`
  用途：通配半成品候选与匹配规则
  关键字段：`id` `tenant_id` `base_sku_id` `candidate_sku_id` `priority` `match_attrs` `effective_from` `effective_to` `status`
  索引：`idx_base_priority(tenant_id, base_sku_id, priority)`
- `task_material_transactions`
  用途：任务级投入产出记录
  关键字段：`id` `tenant_id` `task_id` `operation_id` `sku_id` `io_type` `planned_qty` `actual_qty` `inventory_tx_id`
  索引：`idx_task(tenant_id, task_id)` `idx_task_io(tenant_id, task_id, io_type)`
- `inventory_daily_snapshots`
  用途：日结库存
  关键字段：`id` `tenant_id` `snapshot_date` `sku_id` `qty_on_hand` `qty_reserved` `qty_available`
  索引：`uk_date_sku(tenant_id, snapshot_date, sku_id)`

extended_tables:
- `production_schedules`
  新增：`operation_id` `component_id` `output_sku_id`
- `production_tasks`
  新增：`operation_id` `component_id` `output_sku_id` `actual_hours`
- `work_reports`
  校准：字段口径与工资服务统一，至少保证 `worker_id` `task_id` `process_step_id` `work_date` `qty_completed` `work_hours` `wage_amount`
- `process_wages`
  新增：`settlement_mode` `piece_rate` `hourly_rate`

data_rules:
- 通配解析必须在工单 released 前唯一确定
- `resolved_sku_id` 一经写入不得修改
- 任务完工写入 `task_material_transactions` 后，才允许更新库存与工资

risks:
- 若直接复用 `material_requirements` 存半成品，会与缺料/MRP 语义混淆

handoff_to:
- engineering-manager
- senior-backend-engineer
exit_criteria:
- 关键表、字段、索引明确

[artifact:APIDoc]
status: READY
owner: tech-lead-architect
scope:
- Phase 1 最小接口集
inputs:
- [artifact:SystemArch]
- [artifact:DBDesign]
handoff_to:
- engineering-manager
- senior-backend-engineer

deliverables:
- 最小接口集定义

phase1_api:
- `POST /api/production/orders/:id/release`
  作用：执行结构快照、通配解析、作业单生成
- `GET /api/production/orders/:id/components`
  作用：查看工单冻结后的成品/半成品/原材料结构
- `GET /api/production/orders/:id/operations`
  作用：查看工单级作业单
- `POST /api/production/operations/schedule/generate`
  作用：按作业单生成日排产
- `POST /api/production/tasks/:id/complete-v2`
  作用：提交完工、投入产出、实际工时
- `GET /api/reports/wages/tasks`
  作用：按任务维度查询工资
- `GET /api/inventory/daily-snapshots`
  作用：查询指定日期日结库存

api_rules:
- `release` 前若通配解析不唯一，返回阻塞错误
- `complete-v2` 必须提交实际工时；投入产出可按工序规则预填后修正
- 日结库存接口只读，不回算实时库存

risks:
- Phase 1 同时保留旧接口与新接口，前后端需明确切换边界

handoff_to:
- engineering-manager
- senior-backend-engineer
exit_criteria:
- Phase 1 接口边界清晰

[artifact:TaskBreakdown]
status: READY
owner: tech-lead-architect
scope:
- 分阶段落地任务拆解
inputs:
- [artifact:SystemArch]
- [artifact:DBDesign]
- [artifact:APIDoc]
handoff_to:
- engineering-manager
- senior-backend-engineer
- senior-frontend-engineer

deliverables:
- 可执行任务分期

tasks:
- T1
  阶段：Phase 1
  内容：新增结构快照、作业单、通配解析、任务 IO、日结库存相关表与迁移
- T2
  阶段：Phase 1
  内容：工单 release 服务，生成 components / resolutions / operations
- T3
  阶段：Phase 1
  内容：工资口径校准，统一 `work_reports` 与 `wage.service.ts`
- T4
  阶段：Phase 2
  内容：排产器改造为按 `production_operations` 排产
- T5
  阶段：Phase 2
  内容：任务完工改造为写任务级投入产出并由 WorkflowEngine 回写库存
- T6
  阶段：Phase 3
  内容：前端半成品排产视图、任务执行页、工资报表、日结库存视图
- T7
  阶段：Phase 3
  内容：QA 回归与历史数据兼容校验

dependencies:
- T2 依赖 T1
- T4 依赖 T2
- T5 依赖 T1 T3
- T6 依赖 T2 T4 T5

risks:
- 直接改现有排产器风险高，需先把 Phase 1 的数据准备层做出来

handoff_to:
- engineering-manager
- senior-backend-engineer
- senior-frontend-engineer
exit_criteria:
- 任务已拆解到实现粒度
