[artifact:SystemArch]
status: READY
owner: codex
scope:
- 半成品日排产
- 工序级投入产出
- 实际工时与工资核算
- 通配半成品解析与库存回推
inputs:
- [docs/prd/semifinished-execution-phase1.md](/Users/kongwen/claude_wk/ai-software-company/docs/prd/semifinished-execution-phase1.md)
- 当前生产、库存、工资相关实现
handoff_to:
- engineering-manager
- senior-backend-engineer
deliverables:
- 增量架构方案
risks:
- 新旧排产模型并存期间有兼容成本
handoff_to:
- engineering-manager
exit_criteria:
- 成品工单、作业节点、任务实绩、库存账边界清晰

## 核心原则
- 保留 `production_orders` 为成品工单主对象
- 新增工单结构层和作业层，不让 `material_requirements` 承担半成品排产语义
- 任务完工后写工资与库存派生账
- 通配半成品只在工单释放时解析一次

[artifact:DBDesign]
status: READY
owner: codex
scope:
- Phase 1 数据模型
inputs:
- 同上
handoff_to:
- senior-backend-engineer
deliverables:
- 新增/扩展表设计
risks:
- 事实表边界不清会造成重复统计
handoff_to:
- senior-backend-engineer
exit_criteria:
- 可支撑结构生成、作业排产、任务实绩、库存与工资

## 新增表
- `production_order_components`
- `production_operations`
- `production_operation_dependencies`
- `process_step_materials`
- `production_order_sku_resolutions`
- `task_material_transactions`
- `inventory_daily_snapshots`

## 扩展表
- `production_orders`
- `production_schedules`
- `production_tasks`
- `process_wages`
- `work_reports`

[artifact:APIDoc]
status: READY
owner: codex
scope:
- Phase 1 最小接口集
inputs:
- 同上
handoff_to:
- senior-backend-engineer
- senior-frontend-engineer
deliverables:
- 最小接口边界
risks:
- 旧前端依赖需兼容
handoff_to:
- senior-backend-engineer
exit_criteria:
- 先打通结构、配置、查询三条链

## 最小接口
- `GET /api/process-configs/templates/:templateId/step-materials`
- `PUT /api/process-configs/templates/:templateId/step-materials`
- `GET /api/production/orders/:id/structure`
- `POST /api/production/orders/:id/release-structure`

[artifact:TaskBreakdown]
status: READY
owner: codex
scope:
- 分阶段落地
inputs:
- 同上
handoff_to:
- engineering-manager
- senior-backend-engineer
deliverables:
- Phase 1-4 任务拆解
risks:
- 若直接改排产器，会放大改动风险
handoff_to:
- engineering-manager
exit_criteria:
- Phase 1 可独立交付

## Phase 1
- 新增表与实体
- 打通工序投入配置接口
- 对齐工资事实表查询口径

## Phase 2
- 工单释放结构生成
- 通配解析冻结

## Phase 3
- 作业级排产
- 任务级投入产出报工

## Phase 4
- 日库存快照
- 前端逐页接入
