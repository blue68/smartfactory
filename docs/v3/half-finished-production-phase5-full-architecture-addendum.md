[artifact:APIDoc]
status: READY
owner: tech-lead-architect
scope:
- T6 全量前端补齐所需查询契约增量
- 不新增写路径，仅补读模型
inputs:
- [artifact:SystemArch]
- [artifact:DBDesign]
- [artifact:Prototype]
- `services/api/src/modules/production`
- `services/api/src/modules/inventory`
handoff_to:
- engineering-manager
- senior-backend-engineer
- senior-frontend-engineer

deliverables:
- 任务详情聚合响应
- 库存流水追溯响应

contracts:
- `GET /api/production/tasks/:taskId`
  说明：保留现有基础字段，新增 `statusLabel`、`operationId`、`outputSkuId`、`outputSkuName`、`dependencySummary`、`materialTransactions`、`wageReport`
- `dependencySummary`
  字段：`blocked` `blockingReason` `predecessors[]`
- `predecessors[]`
  字段：`operationId` `stepName` `requiredQty` `completedQty` `status`
- `materialTransactions[]`
  字段：`id` `ioType` `skuId` `skuCode` `skuName` `plannedQty` `actualQty` `inventoryTxId` `transactionNo` `transactionType` `direction` `transactionQty` `transactionTime` `referenceNo`
- `wageReport`
  字段：`reportId` `reportNo` `workDate` `workerGrade` `workHours` `unitWage` `wageAmount` `qtyCompleted` `qtyQualified` `qtyDefective`
- `GET /api/inventory/:skuId/transactions`
  查询参数：`page` `pageSize` `dateFrom?` `dateTo?` `keyword?`
- `GET /api/inventory/:skuId/transactions`
  返回：`skuId` `skuCode` `skuName` `stockUnit` `list[]`
- `list[]`
  字段：`transactionId` `transactionNo` `transactionType` `direction` `qtyChange` `createdAt` `referenceType` `referenceId` `referenceNo` `taskId` `workOrderNo` `processStepName` `workerName` `notes`
- `GET /api/inventory/summary`
  继续沿用既有接口，前端改为真实接线，不再使用 mock 汇总

risks:
- 任务详情聚合依赖 `task_material_transactions.inventory_tx_id` 与 `work_reports.task_id`，历史老任务若缺字段时应安全降级为空数组/空对象
- 库存追溯查询必须始终带 `tenant_id` 与 `sku_id` 过滤，避免跨租户与全表扫描

handoff_to:
- engineering-manager
- senior-backend-engineer
- senior-frontend-engineer
exit_criteria:
- 前后端查询契约明确，兼容降级策略明确

[artifact:TaskBreakdown]
status: READY
owner: tech-lead-architect
scope:
- T6 剩余页面实现
- T7 对应验证闭环
inputs:
- [artifact:PRD]
- [artifact:Prototype]
- [artifact:DesignSpec]
- [artifact:APIDoc]
- 现有 Phase 1-2 后端能力
handoff_to:
- engineering-manager
- senior-backend-engineer
- senior-frontend-engineer
- senior-qa-engineer

deliverables:
- 可执行任务拆解与边界

tasks:
- T6-FE-01：生产工单详情接入 `components / operations`，补结构快照与工序链路 tab
- T6-BE-01：扩展 `GET /api/production/tasks/:taskId` 聚合依赖、投入产出、工资与库存流水
- T6-FE-02：任务页修正状态与动作接口契约，并渲染依赖/投入产出/工资/追溯视图
- T6-FE-03：排产页三种视图补半成品产出语义、风险提示与移动端卡片降级
- T6-BE-02：新增 `GET /api/inventory/:skuId/transactions`，供库存页和快照追溯复用
- T6-FE-04：库存页接真实 summary、补追溯抽屉，并允许从实时库存与日结快照两侧进入
- T7-QA-01：补 Web API/page tests，覆盖工单详情、任务详情、库存追溯、排产视图关键状态
- T7-QA-02：补 API unit/integration 回归，覆盖新聚合读接口与历史空数据降级
- T7-QA-03：输出本地历史数据兼容演练记录，至少覆盖“老任务无 operations/material tx/work report 扩展字段”的安全读取

dependencies:
- `T6-BE-01` 完成后 `T6-FE-02` 才能完整落地
- `T6-BE-02` 完成后 `T6-FE-04` 才能进入联调
- `T7-QA-*` 依赖前述前后端改动完成

risks:
- 若继续忽略历史 `started` 状态与前端 `in_progress` 语义差异，任务页仍会产生错误按钮状态
- 若库存追溯只给流水不给任务映射，库存管理员仍无法完成“账本 -> 任务”反查

handoff_to:
- engineering-manager
- senior-backend-engineer
- senior-frontend-engineer
- senior-qa-engineer
exit_criteria:
- 任务拆到可编码与可测试粒度
