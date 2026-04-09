[artifact:SystemArch]
status: READY
owner: codex
scope:
- 梳理当前系统库存更新的真实落库逻辑
- 覆盖来料入库、工单领料、工序报工、异常损耗、盘点调整、销售出库、采购退货、物料预留
- 输出库存变化矩阵、表级时序与现状风险点
inputs:
- services/api/src/modules/incoming-inspection/incomingInspection.service.ts
- services/api/src/modules/inventory/inventory.service.ts
- services/api/src/modules/inventory/daily-snapshot.util.ts
- services/api/src/modules/production/scheduler.service.ts
- services/api/src/modules/production/workflow-engine.service.ts
- services/api/src/modules/production/production-order.service.ts
- services/api/src/modules/stocktaking/stocktaking.service.ts
- services/api/src/modules/sales/sales.service.ts
- services/api/src/modules/return-order/returnOrder.service.ts
handoff_to:
- senior-backend-engineer
- senior-qa-engineer
- devops-engineer
deliverables:
- 当前库存更新链路总览
- 库存变化矩阵
- 表级时序图
- 风险点与排障建议
risks:
- 工序报工中的 scrapQty 当前未自动映射为库存损耗流水，业务口径容易误判
- task_material_transactions 与 inventory_transactions 仍未建立强关联
- 生产预留目前主要按 SKU 级处理，仓库粒度与真实领料粒度存在差距
exit_criteria:
- 可直接用于排查“库存为什么变了/没变”“某动作改了哪些表”“某字段口径是什么”

# 库存更新逻辑剖析与变化矩阵

## 1. 核心结论

当前系统的库存更新并不是集中在单一服务里统一处理，而是分散在采购、生产、盘点、销售、退货等模块中分别落库。但真正发生库存变化时，整体遵循同一套骨架：

1. 解析仓库和库位。
2. 按 SKU 单位规则做数量换算。
3. 获取 Redis 分布式锁；若不可用，则退化到 DB 行锁。
4. `SELECT ... FOR UPDATE` 锁定库存行。
5. 校验在库或可用库存是否满足业务条件。
6. 写入 `inventory_transactions` 流水。
7. 更新 `inventory` 主表。
8. 同步 `inventory_daily_snapshots` 当日快照。
9. 失效库存缓存。

换句话说，库存是否真实变化，不应只看页面提示或业务单据状态，而要同时看：

- 是否写了 `inventory_transactions`
- 是否改了 `inventory.qty_on_hand`
- 是否仅改了 `inventory.qty_reserved`
- 是否同步了 `inventory_daily_snapshots`

## 2. 核心库存表口径

### 2.1 `inventory`

实时库存主表，当前已经按 `tenant + sku + warehouse + location` 维度存储。

关键字段：

- `qty_on_hand`：物理在库数量
- `qty_reserved`：已预留但尚未实际出库的数量
- `qty_in_transit`：在途数量
- `warehouse_id` / `location_id`：真实仓库与库位维度

### 2.2 `inventory_transactions`

库存流水表。所有正式库存写动作应当先记录流水，再更新主库存。

常见 `transaction_type`：

- `PURCHASE_IN`
- `PRODUCTION_IN`
- `MATERIAL_OUT`
- `DELIVERY_OUT`
- `PURCHASE_RETURN_OUT`
- `STOCKTAKE_ADJUST`
- `waste_out`

### 2.3 `inventory_daily_snapshots`

库存日快照表。当前通过聚合 `inventory` 当日实时值形成，并且已经带 `warehouse_id` 维度。

当前同步逻辑见：

- `services/api/src/modules/inventory/daily-snapshot.util.ts`

### 2.4 `inventory_dye_lots`

面料缸号库存表。对启用缸号管理的 SKU，入库和出库不仅会改 `inventory`，还会同步改缸号库存。

## 3. 统一变化矩阵

| 业务动作 | 入口服务 | 流水类型 | `qty_on_hand` | `qty_reserved` | 是否带仓库/库位 | 是否同步日快照 | 说明 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 来料质检合格入库 | `incomingInspection.service.ts` | `PURCHASE_IN` | 增加 | 不变 | 是 | 是 | 同时尝试冲减 `qty_in_transit` |
| 通用手工入库 | `inventory.service.ts` | `PURCHASE_IN/PRODUCTION_IN/ADJUSTMENT_IN` | 增加 | 不变 | 是 | 是 | 通用入库底座 |
| 工单领料/物料出库 | `inventory.service.ts` | `MATERIAL_OUT` | 减少 | 不变 | 是 | 是 | 按 `qty_on_hand - qty_reserved` 校验 |
| 销售发货出库 | `sales.service.ts` | `DELIVERY_OUT` | 减少 | 可能先释放预留 | 是 | 是 | 发货前锁库存行 |
| 采购退货出库 | `returnOrder.service.ts` | `PURCHASE_RETURN_OUT` | 减少 | 不变 | 是 | 是 | 本质也是出库 |
| 盘点调整单入账 | `stocktaking.service.ts` | `STOCKTAKE_ADJUST` | 按差异增减 | 不变 | 是 | 是 | `diff_qty` 可正可负 |
| 盘点确认直接调账 | `stocktaking.service.ts` | `STOCKTAKE_ADJUST` | 按差异增减 | 不变 | 是 | 是 | 与调整单同口径 |
| 异常损耗/报废录入 | `inventory.service.ts` | `waste_out` | 减少 | 不变 | 是 | 是 | 独立损耗入口 |
| 工序报工 | `scheduler.service.ts` | 无直接库存流水 | 不变 | 不变 | 间接 | 否 | 主要写任务与报工记录 |
| 半成品自动入库 | `workflow-engine.service.ts` | `PRODUCTION_IN` | 增加 | 不变 | 是 | 是 | 由工艺流转自动触发 |
| 工单整单完工成品入库 | `scheduler.service.ts` | `PRODUCTION_IN` | 增加 | 不变 | 是 | 是 | 所有任务完工后触发 |
| 生产建单预留物料 | `production-order.service.ts` | 无库存流水 | 不变 | 增加 | 当前偏 SKU 级 | 是 | 不是物理出库 |
| 工单取消/释放预留 | `production-order.service.ts` | 无库存流水 | 不变 | 减少 | 当前偏 SKU 级 | 是 | 释放预留量 |

## 4. 关键链路表级时序

### 4.1 来料质检合格入库

入口：

- `IncomingInspectionService.handlePassedItems`

时序：

```text
incoming_inspection.submit
  -> purchase_orders           FOR UPDATE 校验状态
  -> purchase_receipts         新增入库单
  -> delivery_notes            回写 receipt_id 与状态
  -> purchase_receipt_items    新增入库明细
  -> inventory_transactions    写 PURCHASE_IN
  -> inventory                 qty_on_hand += 入库量
                               qty_in_transit = max(qty_in_transit - delta, 0)
  -> inventory_daily_snapshots 重算当日该 SKU 分仓快照
  -> inventory_dye_lots        若启用缸号则增加缸号库存
  -> purchase_order_items      回写 qty_received / qty_passed
```

要点：

- 入库发生在来料质检通过，不是在采购单创建时。
- 会校验仓库范围权限。
- 会把采购单位换算成库存单位后再落库。

## 4.2 通用入库

入口：

- `InventoryService.inbound`

时序：

```text
POST /api/inventory/inbound
  -> inventory                 FOR UPDATE 锁库存行
  -> inventory_transactions    写入库流水
  -> inventory                 UPSERT 并累加 qty_on_hand
  -> inventory_daily_snapshots 重算当日快照
  -> inventory_dye_lots        若有缸号则同步缸号库存
```

要点：

- 这是通用能力底座。
- 若库存行不存在，依赖 `INSERT ... ON DUPLICATE KEY UPDATE` 完成首次入库。

## 4.3 工单领料 / 物料出库

入口：

- `InventoryService.outbound`

时序：

```text
POST /api/inventory/outbound
  -> inventory                 FOR UPDATE 锁 tenant+sku+warehouse+location
  -> inventory_dye_lots        如有缸号则 FOR UPDATE 校验并扣减
  -> inventory_transactions    写 MATERIAL_OUT
  -> inventory                 qty_on_hand -= 领料量
  -> inventory_daily_snapshots 重算当日快照
  -> order_dye_lot_bindings    首次领料时为工单绑定缸号
```

要点：

- 真正的“领料出库”在这里发生，不在报工接口里发生。
- 校验的是可用量：`qty_on_hand - qty_reserved`。
- 对面料类物料有缸号强校验和跨缸号授权机制。

## 4.4 工序报工

入口：

- `SchedulerService.completeTask`

时序：

```text
production.completeTask
  -> production_tasks            置 completed / 写 completed_qty
  -> task_completions            写完工记录、报废数、备注、图片
  -> production_operations       更新工序完成量和状态
  -> task_material_transactions  写 input 记录
  -> task_material_transactions  写 output 记录
  -> workflow-engine             推进工艺流
  -> production_orders           同步工单完成量
  -> work_reports                写报工记录
  -> traceability_records        写追溯记录
```

要点：

- 这里默认不直接改 `inventory`。
- `task_material_transactions` 主要用于工序投入产出记录和追溯，不等价于库存流水。
- `scrapQty` 会进入 `task_completions` 和 `work_reports`，但当前不会自动生成 `waste_out` 库存流水。

## 4.5 半成品自动入库

入口：

- `WorkflowEngineService._autoInboundSemiFinished`

时序：

```text
workflow.onTaskCompleted
  -> inventory_transactions    写 PRODUCTION_IN
  -> inventory                 qty_on_hand += 半成品数量
  -> inventory_daily_snapshots 重算当日快照
```

要点：

- 这是报工后可能触发库存变化的第一类场景。
- 并不是所有报工都会直接改库存，只有命中自动入库逻辑才会。

## 4.6 工单整单完工成品入库

入口：

- `SchedulerService.completeTask`

时序：

```text
production.completeTask
  -> production_tasks           当前任务完工
  -> production_orders          当所有任务都已完成时置 completed
  -> inventory_transactions     写 PRODUCTION_IN
  -> inventory                  qty_on_hand += 成品数量
  -> inventory_daily_snapshots  重算当日快照
```

要点：

- 当前是“整张工单所有任务完工后”自动成品入库。
- 为了幂等，会先检查是否已经存在同一工单的成品入库流水。

## 4.7 异常损耗 / 报废录入

入口：

- `InventoryService.recordWaste`

时序：

```text
POST /api/inventory/waste
  -> inventory                 FOR UPDATE 锁库存行
  -> inventory_transactions    写 waste_out
  -> inventory                 qty_on_hand -= 损耗量
  -> inventory_daily_snapshots 重算当日快照
```

要点：

- 这是独立损耗入口。
- 当前报工中的报废数不会自动走到这里。

## 4.8 盘点调整单入账

入口：

- `StocktakingService.createAdjustmentOrder(execute=true)`

时序：

```text
stocktaking.createAdjustmentOrder
  -> stocktaking_items         读取差异行
  -> inventory                 锁库存行并按 diff_qty 调整 qty_on_hand
  -> inventory_transactions    写 STOCKTAKE_ADJUST
  -> inventory_daily_snapshots 重算当日快照
  -> stocktaking_tasks         置 confirmed
```

要点：

- `diff_qty > 0` 表示盘盈，库存增加。
- `diff_qty < 0` 表示盘亏，库存减少。

## 4.9 盘点确认直接调账

入口：

- `StocktakingService.confirmTask`

时序：

```text
stocktaking.confirmTask
  -> stocktaking_items         读取差异行
  -> inventory                 锁库存行并按 diff_qty 调整 qty_on_hand
  -> inventory_transactions    写 STOCKTAKE_ADJUST
  -> inventory_daily_snapshots 重算当日快照
  -> stocktaking_tasks         置 confirmed
```

要点：

- 与“调整单入账”本质一样，只是入口不同。
- 两条链路最终都会走 `inventory.qty_on_hand` 和 `STOCKTAKE_ADJUST`。

## 4.10 销售发货出库

入口：

- `SalesService.shipOrder`

时序：

```text
sales.shipOrder
  -> inventory                 FOR UPDATE 锁对应 SKU 的库存行
  -> sales_deliveries          新增发货单
  -> sales_delivery_items      新增发货明细
  -> sales_order_items         累加 qty_delivered
  -> inventory_transactions    写 DELIVERY_OUT
  -> inventory                 qty_on_hand -= 发货量
  -> inventory_daily_snapshots 重算当日快照
```

要点：

- 发货前会按仓库和库位校验可用量。
- 是正式物理出库。

## 4.11 采购退货出库

入口：

- `ReturnOrderService.ship`

时序：

```text
return_order.ship
  -> return_orders             置 shipped
  -> inventory_transactions    写 PURCHASE_RETURN_OUT
  -> inventory                 qty_on_hand -= 退货量
  -> inventory_daily_snapshots 重算当日快照
```

要点：

- 与销售发货类似，本质上也是一条物理出库链路。

## 4.12 生产建单预留物料

入口：

- `ProductionOrderService.create`

时序：

```text
production_order.create
  -> material_requirements     写物料需求
  -> inventory                 qty_reserved += 预留量
  -> inventory_daily_snapshots 重算当日快照
  -> material_requirements     回写 qty_reserved / qty_shortage / status
```

要点：

- 这不是实际领料。
- 变化的是 `qty_reserved`，不是 `qty_on_hand`。
- 因为后续出库校验看的是 `qty_on_hand - qty_reserved`，所以预留会直接影响“可用库存”。

## 4.13 生产取消 / 释放预留

入口：

- `ProductionOrderService.cancel` 等释放预留逻辑

时序：

```text
production_order.cancel
  -> material_requirements     找出已预留行
  -> inventory                 qty_reserved -= 已预留量
  -> inventory_daily_snapshots 重算当日快照
  -> material_requirements     回写 shortage 状态
```

要点：

- 释放后不会增加 `qty_on_hand`，因为之前并没有真实扣减在库。

## 5. 快照同步机制

所有正式库存动作最终都会调用：

- `syncInventoryDailySnapshotForSku`

该逻辑不是单纯加减快照，而是：

1. 从 `inventory` 主表重新按 `tenant_id + warehouse_id + sku_id` 聚合。
2. 更新或插入 `inventory_daily_snapshots`。
3. 删除当天已经没有对应库存主记录的旧快照行。

这意味着：

- 日快照是“当前日实时聚合结果”，不是独立维护的另一份主库存。
- 若主库存和快照不一致，原则上优先以 `inventory` 为准，再重建快照。

## 6. 当前最容易被误解的口径

### 6.1 “报工”不等于“领料”

- 领料出库：真实扣减 `inventory.qty_on_hand`
- 报工完成：主要更新任务、工序、报工单
- 报工后只有命中半成品自动入库或整单完工入库时，库存才会增加

因此，“为什么报工后库存没扣减”通常不是 bug，而是因为扣减动作应该发生在领料时，而不是报工时。

### 6.2 `scrapQty` 不等于 `waste_out`

当前系统中：

- `scrapQty` 写入 `task_completions` 和 `work_reports`
- `waste_out` 只由独立的损耗接口生成

所以如果业务口径要求“报工报废自动扣减库存”，当前代码还没有打通。

### 6.3 预留不等于已出库

`qty_reserved` 只代表占用，不代表已经离开仓库。

因此：

- 预留增加后，可用量下降
- 但在库量 `qty_on_hand` 不变
- 真正领料后，才会看到 `qty_on_hand` 减少

## 7. 现状风险点

### 7.1 报工报废与库存损耗口径割裂

风险：

- 生产页面看到已有报废数量，但库存层面没有自动扣减
- 财务、车间、仓库在对账时容易出现“报废已记、库存未减”的争议

建议：

- 若后续要统一口径，应明确设计“报工时自动损耗”还是“必须单独报损”
- 两种模式不能同时模糊存在

### 7.2 任务投入产出记录未与真实库存流水强关联

当前 `task_material_transactions.inventory_tx_id` 仍为 `NULL`。

影响：

- 无法直接从任务投入产出记录追到真实库存流水
- 排查“某次领料是否已经实际出库”需要跨表二次推断

### 7.3 生产预留与真实仓库粒度存在差异

当前生产建单预留主要是 SKU 级 `qty_reserved` 操作，和真实领料使用的仓库/库位粒度不完全一致。

影响：

- 可用量判断是对的，但对“预留在哪个仓”这件事表达仍然偏粗

## 8. 排障建议

遇到“库存为什么不对”时，建议按以下顺序排查：

1. 先查业务动作是否真的触发了对应入口。
2. 查 `inventory_transactions` 是否存在对应流水。
3. 查 `inventory` 的 `qty_on_hand / qty_reserved / qty_in_transit` 是否按预期变化。
4. 查 `inventory_daily_snapshots` 是否已经同步。
5. 若是生产链路，再区分：
   - 是领料问题
   - 是报工问题
   - 是半成品自动入库问题
   - 是整单完工入库问题

建议的排障问题模板：

- 这次动作属于“物理库存变更”还是“预留量变更”？
- 该动作预期写哪一种 `transaction_type`？
- 该动作应该改 `qty_on_hand` 还是 `qty_reserved`？
- 该动作是否需要带仓库和库位？
- 该动作后是否应该立刻看到日快照变化？

## 9. 代码入口索引

- 来料质检入库：`services/api/src/modules/incoming-inspection/incomingInspection.service.ts`
- 通用库存入出库与损耗：`services/api/src/modules/inventory/inventory.service.ts`
- 日快照同步：`services/api/src/modules/inventory/daily-snapshot.util.ts`
- 工序报工与整单完工入库：`services/api/src/modules/production/scheduler.service.ts`
- 半成品自动入库：`services/api/src/modules/production/workflow-engine.service.ts`
- 生产预留：`services/api/src/modules/production/production-order.service.ts`
- 盘点调整：`services/api/src/modules/stocktaking/stocktaking.service.ts`
- 销售发货：`services/api/src/modules/sales/sales.service.ts`
- 采购退货：`services/api/src/modules/return-order/returnOrder.service.ts`

## 10. 当前版本结论

当前系统库存逻辑已经具备以下特征：

- 真实库存写路径基本都已带仓库和库位
- 大部分正式库存动作均写流水、改主库存、同步日快照
- 领料、入库、损耗、盘点调整的主链路已经闭环

但仍有 3 个边界需要明确：

1. 报工报废尚未自动联动损耗库存。
2. 任务投入产出与库存流水尚未强绑定。
3. 生产预留仍以 SKU 级为主，未完全下沉到仓库粒度。

## 11. 附录：页面按钮 -> 后端接口 -> 表变更

本附录面向运营、实施、测试和一线排障人员，按“页面上点了什么按钮”反推“后端调用什么接口、最终改了哪些表”。

### 11.1 页面入口矩阵

| 页面 | 用户操作/按钮 | 前端 API | 后端接口 | 主要变更表 | 是否真实改库存 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 库存总览 | 手动入库 / 行内入库 / 确认入库 | `inventoryApi.inbound` | `POST /api/inventory/inbound` | `inventory_transactions`、`inventory`、`inventory_daily_snapshots`、可选 `inventory_dye_lots` | 是 |
| 盘点任务 | 调整单入账 | `stocktakingApi.createAdjustmentOrder` | `POST /api/stocktaking/:id/adjustment-order` | `inventory`、`inventory_transactions`、`inventory_daily_snapshots`、`stocktaking_tasks` | 是 |
| 盘点任务 | 确认盘点 | `stocktakingApi.confirm` | `POST /api/stocktaking/:id/confirm` | `inventory`、`inventory_transactions`、`inventory_daily_snapshots`、`stocktaking_tasks` | 是 |
| 来料质检 | 提交质检结论（通过并接受） | `incomingInspectionApi.submit` | `POST /api/incoming-inspections/:id/submit` | `purchase_receipts`、`purchase_receipt_items`、`inventory_transactions`、`inventory`、`inventory_daily_snapshots`、可选 `inventory_dye_lots` | 是 |
| 生产任务 | 完工上报 | `productionApi.completeTask` | `POST /api/production/tasks/:id/complete` | `production_tasks`、`task_completions`、`production_operations`、`task_material_transactions`、`work_reports`、`traceability_records`，特定场景还会写库存表 | 间接 |
| 销售订单列表 | 标记发货 / 确认发货 | 销售发货 API | `POST /api/sales/orders/:id/ship` 等发货接口 | `sales_deliveries`、`sales_delivery_items`、`sales_order_items`、`inventory_transactions`、`inventory`、`inventory_daily_snapshots` | 是 |
| 退货管理 | 发出退货 | `returnOrderApi.ship` | `PUT /api/return-orders/:id/ship` | `return_orders`、`inventory_transactions`、`inventory`、`inventory_daily_snapshots` | 是 |
| 退货管理 | 确认退货 | 退货确认 API | `PUT /api/return-orders/:id/confirm` | `return_orders` 等业务单据表 | 否 |
| 退货管理 | 完成退货 | `returnOrderApi.complete` | `PUT /api/return-orders/:id/complete` | `return_orders` 等业务单据表 | 否 |

说明：

- “是否真实改库存”看的是是否会直接写 `inventory` 主表。
- “生产任务 -> 完工上报”不是每次都改库存，只有命中半成品自动入库或整单完工成品入库时，才会继续写 `inventory_transactions` 和 `inventory`。
- 当前“库存损耗”后端接口已经存在，但在现有 PC 页面中没有发现成熟、固定的业务按钮入口，更像保留给后续页面或外部调用的能力接口。

### 11.2 页面动作详解

#### A. 库存总览 -> “确认入库”

页面入口：

- `services/web/src/pages/inventory/InventoryPage.tsx`

前端接口：

- `inventoryApi.inbound`
- `POST /api/inventory/inbound`

后端落表：

```text
InventoryPage.confirmInbound
  -> inventory_transactions    写入库流水
  -> inventory                 qty_on_hand += 入库量
  -> inventory_daily_snapshots 重算当日快照
  -> inventory_dye_lots        若有缸号则同步缸号库存
```

运营判断：

- 点了“确认入库”后，属于真实库存增加。
- 若页面提示成功但库存未变，先查 `inventory_transactions` 是否有对应 `IN` 流水。

#### B. 盘点任务 -> “调整单入账”

页面入口：

- `services/web/src/pages/stocktaking/StocktakingPage.tsx`

前端接口：

- `stocktakingApi.createAdjustmentOrder`
- `POST /api/stocktaking/:id/adjustment-order`

后端落表：

```text
StocktakingPage.adjustmentOrder
  -> inventory                 qty_on_hand +=/-= diff_qty
  -> inventory_transactions    写 STOCKTAKE_ADJUST
  -> inventory_daily_snapshots 重算当日快照
  -> stocktaking_tasks         status -> confirmed
```

运营判断：

- 这是正式调账动作，不是预览。
- 如果任务状态从“待确认”变成“已确认”，理论上库存已经同步改变。

#### C. 盘点任务 -> “确认盘点”

页面入口：

- `services/web/src/pages/stocktaking/StocktakingPage.tsx`

前端接口：

- `stocktakingApi.confirm`
- `POST /api/stocktaking/:id/confirm`

后端落表：

```text
StocktakingPage.confirmTask
  -> inventory                 qty_on_hand +=/-= diff_qty
  -> inventory_transactions    写 STOCKTAKE_ADJUST
  -> inventory_daily_snapshots 重算当日快照
  -> stocktaking_tasks         status -> confirmed
```

运营判断：

- 与“调整单入账”本质都是盘点差异落账。
- 两者主要区别在操作入口和页面表达，不在库存口径。

#### D. 来料质检 -> “提交”

页面入口：

- `services/web/src/pages/purchase/IncomingInspectionPage.tsx`

前端接口：

- `incomingInspectionApi.submit`
- `POST /api/incoming-inspections/:id/submit`

后端落表：

```text
IncomingInspectionPage.submit
  -> purchase_receipts         新增入库单
  -> purchase_receipt_items    新增入库明细
  -> inventory_transactions    写 PURCHASE_IN
  -> inventory                 qty_on_hand += 合格入库量
  -> inventory_daily_snapshots 重算当日快照
  -> inventory_dye_lots        若有缸号则同步缸号库存
  -> purchase_order_items      更新累计收货/合格量
```

运营判断：

- 来料质检提交后，如果处理方式是“接受”，库存会真实增加。
- 如果是不合格退货，则不会增加库存，而是转去生成退货链路。

#### E. 生产任务 -> “完工上报”

页面入口：

- `services/web/src/pages/production/TaskPage.tsx`

前端接口：

- `productionApi.completeTask`
- `POST /api/production/tasks/:id/complete`

后端落表：

```text
TaskPage.completeTask
  -> production_tasks            任务置 completed
  -> task_completions            写报工记录
  -> production_operations       更新工序完成量
  -> task_material_transactions  写 input/output 工序投入产出
  -> work_reports                写工资/报工单
  -> traceability_records        写追溯链
  -> workflow-engine             若命中半成品自动入库，则继续写库存表
  -> production_orders           若整单完工，则继续写成品入库库存表
```

运营判断：

- “完工上报成功”不必然代表库存已变化。
- 先分两类看：
  - 只是普通工序报工：通常只改生产表，不改库存表。
  - 触发半成品或成品自动入库：才会继续写 `inventory_transactions` 和 `inventory`。

特别提醒：

- 报工里的 `scrapQty` 当前只写生产统计，不会自动形成 `waste_out` 库存损耗。

#### F. 销售订单 -> “标记发货 / 确认发货”

页面入口：

- `services/web/src/pages/sales/SalesOrderListPage.tsx`

前端接口：

- 销售发货 API
- 后端为销售发货接口，当前核心服务逻辑在 `SalesService.shipOrder`

后端落表：

```text
SalesOrderListPage.ship
  -> sales_deliveries          新增发货主表
  -> sales_delivery_items      新增发货明细
  -> sales_order_items         更新 qty_delivered
  -> inventory_transactions    写 DELIVERY_OUT
  -> inventory                 qty_on_hand -= 发货量
  -> inventory_daily_snapshots 重算当日快照
```

运营判断：

- 这是正式出库动作。
- 如果订单状态已变“已发货”但库存未减，需要重点排查发货事务是否中途失败回滚。

#### G. 退货管理 -> “发出退货”

页面入口：

- `services/web/src/pages/purchase/ReturnOrderPage.tsx`

前端接口：

- `returnOrderApi.ship`
- `PUT /api/return-orders/:id/ship`

后端落表：

```text
ReturnOrderPage.ship
  -> return_orders             status -> shipped
  -> inventory_transactions    写 PURCHASE_RETURN_OUT
  -> inventory                 qty_on_hand -= 退货量
  -> inventory_daily_snapshots 重算当日快照
```

运营判断：

- “发出退货”会真实扣减库存。
- “确认退货”与“完成退货”主要改单据流程状态，不是库存动作本身。

#### H. 库存损耗 -> “登记库存损耗”

当前状态：

- 后端接口已存在：`POST /api/inventory/waste`
- 权限点已存在：`inventory:waste`
- 现有 PC 端页面中未看到稳定的显式操作入口

后端落表：

```text
inventory/waste
  -> inventory_transactions    写 waste_out
  -> inventory                 qty_on_hand -= 损耗量
  -> inventory_daily_snapshots 重算当日快照
```

运营判断：

- 这是独立库存扣减链路。
- 当前不能把“报工里的废品数量”直接视作它已经执行。

### 11.3 从页面反查库存变化的最短路径

如果运营同事在页面上点击了某个按钮，想确认库存到底有没有变，可以按下面的顺序反查：

1. 确认按钮对应的是“真实库存动作”还是“业务状态动作”。
2. 查是否调用到了正确接口。
3. 查 `inventory_transactions` 是否生成了预期 `transaction_type`。
4. 查 `inventory` 是否改了预期字段：
   - 入库/出库看 `qty_on_hand`
   - 预留/释放看 `qty_reserved`
5. 查 `inventory_daily_snapshots` 是否同步。

一线快速判断表：

| 页面提示 | 通常是否应改库存 | 首先查什么 |
| :--- | :--- | :--- |
| 入库成功 | 是 | `inventory_transactions` 的 `IN` 流水 |
| 调整单入账成功 | 是 | `STOCKTAKE_ADJUST` 流水 |
| 确认盘点成功 | 是 | `STOCKTAKE_ADJUST` 流水 |
| 完工上报成功 | 不一定 | 是否触发 `PRODUCTION_IN` |
| 标记发货成功 | 是 | `DELIVERY_OUT` 流水 |
| 发出退货成功 | 是 | `PURCHASE_RETURN_OUT` 流水 |
| 确认退货成功 | 否 | `return_orders.status` |
| 完成退货成功 | 否 | `return_orders.status` |

### 11.4 当前运营口径注意事项

为避免口径混乱，当前版本建议统一对外说明：

- “完工上报”是生产进度动作，不默认代表库存扣减或损耗已入账。
- “领料出库”才是原材料真实离库动作。
- “报工废品数量”是生产统计口径，不等同于库存损耗口径。
- “确认退货/完成退货”是退货流程状态，不等于库存已经再次变化。

## 12. 两个关键澄清

### 12.1 完成报工时，半成品或成品自动入库在什么时机触发

当前代码里，自动入库分成两类，而且触发时机不同。

#### 半成品自动入库

触发时机：

- 每次执行 `completeTask`
- 且当前任务对应的 `process_steps.output_type = 'semi_finished'`
- 且能解析出有效的 `resolved_output_sku_id`

触发位置：

- `SchedulerService.completeTask`
- 调用 `WorkflowEngineService.onTaskCompleted`
- 在工作流的 Step 3 里执行半成品自动入库

结论：

- 半成品自动入库是“任务级触发”
- 不是等整张工单结束才入库

#### 成品自动入库

触发时机：

- 当前任务完成后
- 系统检查同一 `production_order_id` 下是否还有未完成、未取消任务
- 若剩余任务数为 0，则认为整张工单完工
- 且 `production_orders.qty_completed > 0`

触发位置：

- `SchedulerService.completeTask`
- 在工作流处理和报工记录落库之后，继续检查整单完成状态
- 满足条件时写 `PRODUCTION_IN`

结论：

- 成品自动入库是“工单级触发”
- 不是每个成品任务完成都自动入库，而是“最后一个任务完成、整单闭环”时才入库

### 12.2 当前没有独立领料动作接线时，输入项/输出项库存如何变化

当前实际情况要分“真实库存表”和“任务投入产出记录”两层看。

#### 真实库存层

从当前 Web 页面接线看：

- 生产任务页只有“开始生产 / 完工上报 / 上报异常”
- 没有接线到 `/api/inventory/outbound` 的独立“领料出库”按钮

因此：

- 如果没有其他地方显式调用库存出库接口
- 那么报工完成本身不会自动扣减输入项原材料库存
- 如果也没有触发半成品或成品自动入库
- 那么报工完成也不会自动增加输出项库存

换句话说：

- 输入项库存不会因为“完工上报”自动减少
- 输出项库存不会因为“完工上报”自动增加
- 唯一会变化的，通常只是任务/工序/报工相关业务表

#### 任务投入产出记录层

虽然真实库存可能不动，但 `completeTask` 仍会写：

- `task_material_transactions` 的 input 记录
- `task_material_transactions` 的 output 记录

这些记录承载的是：

- 工序理论投入/实际投入数量
- 工序理论产出/实际产出数量

但当前关键限制是：

- 这两类记录写入时 `inventory_tx_id` 仍是 `NULL`
- 它们默认不是已经发生的真实库存流水

所以当前页面上看到的：

- 输入项已投/实际数量
- 输出项实际产出数量

更接近“工序执行记录”或“生产统计记录”，而不是“已经入出库完成”的库存台账。

#### 预留层

虽然未必发生真实领料，但生产建单时通常已经做过：

- `inventory.qty_reserved += 预留量`

所以有可能出现这种现象：

- `qty_on_hand` 没减少
- 但可用库存 `qty_on_hand - qty_reserved` 已经下降

这不是领料发生了，而是物料被预留占用了。

### 12.3 异常上报是否影响库存结果

当前答案是：不会。

异常上报链路只做两件事：

- 更新 `production_tasks.status = 'exception'`
- 新增 `task_exceptions`

不会写：

- `inventory_transactions`
- `inventory`
- `inventory_daily_snapshots`

因此：

- 单独执行“上报异常”不会增减库存
- 单独执行“标记已处理”也不会增减库存

### 12.4 报工里的废品数量是否影响库存结果

当前答案也是：不会直接影响库存。

`scrapQty` 当前只会进入：

- `task_completions.scrap_qty`
- `work_reports.qty_defective`

不会自动触发：

- `inventory/waste`
- `waste_out`
- `inventory.qty_on_hand` 扣减

因此当前系统里：

- “异常上报”不会改库存
- “报工填写废品数量”也不会自动改库存
- 只有单独走库存损耗接口，才会真实扣减损耗库存

## 13. 建议补齐方案

结合当前业务现状与车间真实过程，建议把生产物料状态明确拆成 4 段，而不是继续把“领料”“消耗”“报废”混在一个动作里。

### 13.1 建议采用的状态模型

建议统一口径为：

1. `reserved`
   - 已为工单占用，但还在主仓库
   - 对应当前已有 `inventory.qty_reserved`
2. `issued_to_wip`
   - 已从仓库发到车间/线边，但还未被实际消耗
   - 这是当前系统缺失的状态
3. `consumed`
   - 已在报工时被实际消耗
   - 应在完工/报工时落真实消耗
4. `wasted_or_returned`
   - 已确认损耗，或退回仓库
   - 应拆成“报废损耗”和“退料回仓”两条独立动作

### 13.2 是否需要单独开放“领料”动作

建议：需要单独开放，但语义必须从“直接扣减消耗”改成“发料到线边 / 工单领料”。

原因：

- 真实车间里，领出的料并不一定当下被全部消耗
- 可能只是先移到工位、线边、周转区
- 如果没有单独领料动作，系统就无法表达“已领未耗”
- 如果把领料和消耗混成一个动作，会导致以下问题：
  - 未报工但已拿走的料，系统仍显示在主仓
  - 车间现场有料，库存台账却看不到在制占用位置
  - 退料、补料、异常损耗都没有中间承接层

因此，不建议继续依赖“报工时顺带扣减”来替代领料。

### 13.3 建议的动作链

建议把生产链路明确拆成 5 个动作：

1. 建单预留
   - 当前保留
   - 作用：占用可用库存，不代表离库
2. 工单领料
   - 新增/补齐
   - 作用：把物料从仓库移到车间在制/线边
3. 完工报工
   - 保留
   - 作用：确认本次实际消耗、实际合格产出、实际报废
4. 异常报损
   - 保留但要与报工口径打通
   - 作用：对已领未耗或报工报废造成的损耗做正式落账
5. 退料回仓
   - 新增/补齐
   - 作用：把已领但未消耗的剩余材料退回仓库

### 13.4 推荐实现口径

#### 方案主张

建议采用：

- “单独开放领料”
- “领料 = 库存转移到 WIP/线边位置”
- “报工 = 从 WIP/线边位置做实际消耗，并对合格产出做入库”
- “报工报废 = 不入合格品库存，同时把损耗正式记录下来”

不建议采用：

- “不开放领料，只在报工时直接扣主仓库存”

因为那样无法表达“已领未耗”。

#### 推荐的数据口径

建议新增“生产在制库位 / 线边库位”概念，优先复用现有 `warehouse + location` 模型，而不是再造一套独立库存表。

推荐库存变化如下：

##### A. 领料到线边

```text
主仓库位     qty_on_hand -= issueQty
WIP/线边库位 qty_on_hand += issueQty
```

解释：

- 对全厂总库存不变
- 对主仓库存减少
- 对车间在制库存增加
- 这样系统就能表达“已领但还没消耗”

##### B. 完工报工

```text
WIP/线边库位      qty_on_hand -= actualConsumedQty
成品/半成品库位   qty_on_hand += qualifiedQty
```

其中：

- `actualConsumedQty` 是本次实际消耗的输入物料
- `qualifiedQty = completedQty - scrapQty`

解释：

- 真正的消耗应发生在报工时，而不是领料时
- 输出入库应按合格数量，不应按总完成数量

##### C. 报工报废

```text
qualifiedQty = completedQty - scrapQty
scrapQty     -> 记正式损耗/报废记录
```

解释：

- 报废部分不能继续按成品/半成品入库
- 报废必须形成正式损耗记录，便于成本、追溯和对账

##### D. 退料回仓

```text
WIP/线边库位 qty_on_hand -= returnQty
主仓库位     qty_on_hand += returnQty
```

解释：

- 这是“已领未耗”的闭环动作
- 没有退料动作，就会长期积累账实不清的线边库存

### 13.5 对现有代码必须同步修的地方

如果按上述方案落地，至少要同步修 4 件事。

#### 1. 自动入库口径改为合格数量

当前风险：

- 现有自动入库链路使用的是 `completedQty`
- 没有扣掉 `scrapQty`

这会导致：

- 报工有废品时，成品/半成品库存被高估

因此必须改成：

- `qualifiedQty = completedQty - scrapQty`
- 半成品自动入库与成品自动入库都统一使用 `qualifiedQty`

#### 2. 任务投入产出记录要绑定真实库存流水

当前风险：

- `task_material_transactions.inventory_tx_id` 仍是 `NULL`

因此必须补齐：

- 领料流水绑定到 input 项
- 入库流水绑定到 output 项
- 损耗流水绑定到报废项

这样任务详情才能真正区分：

- 只是工艺记录
- 还是已经发生真实库存动作

#### 3. 增加“WIP/线边库存”承接层

当前风险：

- 只有主仓库存，没有“已领未耗”状态

因此必须补齐：

- 生产线边仓或 WIP 库位
- 或同等语义的库存位置承接方案

#### 4. 异常上报与库存仍然解耦

建议口径：

- “异常上报”本身仍不直接改库存
- 但异常处理流里应允许主管决定：
  - 继续生产
  - 转报损
  - 退料回仓

这样才符合现场真实处理方式。

### 13.6 最终建议

最终建议是：

- 要单独开放“领料”动作
- 但它不是“直接消耗”，而是“从主仓转移到 WIP/线边”
- 报工时再做实际消耗与合格品入库
- 报工里的报废必须同步转库存损耗
- 已领未耗必须有“退料回仓”动作闭环

如果不这么拆，系统永远无法准确表达这 3 种不同状态：

- 还在仓库
- 已领到车间但未消耗
- 已经真正消耗或损耗
